import { STREAM_CONFIG } from "./stream-config.js?v=20260904-1";
import {
  getHealthStatsStatus,
  isSameStreamId,
  isTargetVideoEvent,
  nextConfirmedMissingCount,
  normalizeConnectionState,
} from "./player-health.js?v=20260824-2";
import { buildViewerUrl, CONNECTION_MODE } from "./viewer-url.js?v=20260828-1";
import { createFullscreenTransitionGate } from "./fullscreen-transition.js?v=20260826-2";

const elements = {
  statusPill: document.querySelector("#statusPill"),
  statusLabel: document.querySelector("#statusLabel"),
  playerFrame: document.querySelector("#playerFrame"),
  playerSlot: document.querySelector("#playerSlot"),
  playerPlaceholder: document.querySelector("#playerPlaceholder"),
  placeholderKicker: document.querySelector("#placeholderKicker"),
  placeholderTitle: document.querySelector("#placeholderTitle"),
  placeholderText: document.querySelector("#placeholderText"),
  accessForm: document.querySelector("#accessForm"),
  accessCodeInput: document.querySelector("#accessCodeInput"),
  accessError: document.querySelector("#accessError"),
  primaryAction: document.querySelector("#primaryAction"),
  primaryActionLabel: document.querySelector("#primaryActionLabel"),
  soundButton: document.querySelector("#soundButton"),
  soundLabel: document.querySelector("#soundLabel"),
  fullscreenButton: document.querySelector("#fullscreenButton"),
  fullscreenIcon: document.querySelector("#fullscreenButton .fullscreen-icon"),
  fullscreenLabel: document.querySelector("#fullscreenButton span:last-child"),
  exitFullscreenButton: document.querySelector("#exitFullscreenButton"),
  reconnectButton: document.querySelector("#reconnectButton"),
  controlNote: document.querySelector("#controlNote"),
};

const VDO_ORIGIN = new URL(STREAM_CONFIG.viewerBaseUrl).origin;
const STATS_INTERVAL_MS = 4_000;
const MAX_CONFIRMED_MISSING_STATS = 25;
const DISCONNECT_GRACE_MS = 90_000;
const FULLSCREEN_CHANGE_TIMEOUT_MS = 1_200;
const FULLSCREEN_TOGGLE_COOLDOWN_MS = 450;
const START_MUTED = true;
const LIVE_CONTROL_NOTE = "Direkte Zuschauer-Verbindung · keine Kamera · kein Mikrofon";
const COMPATIBILITY_CONTROL_NOTE =
  "Kompatibilitätsverbindung über Relay · keine Kamera · kein Mikrofon";

let player = null;
let state = "offline";
let viewerStarted = false;
let muted = START_MUTED;
let connectionTimer = null;
let disconnectTimer = null;
let reconnectTimer = null;
let statsTimer = null;
let confirmedMissingStats = 0;
let fallbackFullscreen = false;
let fullscreenWasActive = false;
let connectionMode = CONNECTION_MODE.direct;
let recoveringConnection = false;
let accessCode = "";

const fullscreenTransition = createFullscreenTransitionGate({
  cooldownMs: FULLSCREEN_TOGGLE_COOLDOWN_MS,
});

function hasUsableValue(value) {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    !value.startsWith("PENDING_")
  );
}

function hasViewerCredentials() {
  return /^[0-9]{4}$/.test(accessCode);
}

function setAccessError(message = "") {
  elements.accessError.textContent = message;
  elements.accessError.hidden = !message;
  elements.accessCodeInput.setAttribute("aria-invalid", String(Boolean(message)));
}

function applyViewerCredentialsFromInputs() {
  const nextAccessCode = elements.accessCodeInput.value.trim();

  if (!/^[0-9]{4}$/.test(nextAccessCode)) {
    setAccessError("Der Zugangscode muss genau vier Ziffern haben.");
    elements.accessCodeInput.focus({ preventScroll: true });
    elements.accessCodeInput.select();
    return false;
  }

  accessCode = nextAccessCode;
  setAccessError();
  return true;
}

function handleCredentialEdit() {
  accessCode = elements.accessCodeInput.value.trim();
  viewerStarted = false;
  connectionMode = CONNECTION_MODE.direct;
  clearReconnectTimer();
  setAccessError();

  if (state === "connecting") {
    removePlayer();
  }

  if (state !== "live") {
    setState("offline");
  }
}

const isConfigured =
  hasUsableValue(STREAM_CONFIG.streamId) &&
  hasUsableValue(STREAM_CONFIG.audienceToken) &&
  VDO_ORIGIN === "https://vdo.ninja";

elements.playerSlot.removeAttribute("aria-live");
elements.placeholderText.setAttribute("role", "status");
elements.placeholderText.setAttribute("aria-live", "polite");
elements.placeholderText.setAttribute("aria-atomic", "true");
elements.fullscreenButton.setAttribute("aria-controls", "playerFrame");
elements.exitFullscreenButton.setAttribute("aria-controls", "playerFrame");
elements.exitFullscreenButton.setAttribute("aria-label", "Vollbild schließen");
elements.fullscreenIcon.textContent = "⛶";
elements.playerFrame.dataset.connectionHealth = "stable";

function clearTimer(timer) {
  if (timer !== null) {
    window.clearTimeout(timer);
    window.clearInterval(timer);
  }
}

function clearConnectionTimers() {
  clearTimer(connectionTimer);
  clearTimer(disconnectTimer);
  clearTimer(statsTimer);
  connectionTimer = null;
  disconnectTimer = null;
  statsTimer = null;
}

function clearReconnectTimer() {
  clearTimer(reconnectTimer);
  reconnectTimer = null;
}

function updateSoundLabel() {
  elements.soundLabel.textContent = muted ? "Ton einschalten" : "Ton ausschalten";
  elements.soundButton.setAttribute("aria-pressed", String(!muted));
  elements.soundButton.setAttribute(
    "aria-label",
    muted ? "Ton einschalten" : "Ton ausschalten",
  );

  if (state === "live") {
    elements.controlNote.textContent = getLiveControlNote();
  }
}

function updatePrimaryAction(label, hint) {
  elements.primaryActionLabel.textContent = label;
  elements.primaryAction.dataset.hint = hint;
  elements.primaryAction.setAttribute("aria-label", `${label}. ${hint}`);
}

function getLiveControlNote() {
  const connectionNote = connectionMode === CONNECTION_MODE.compatibility
    ? COMPATIBILITY_CONTROL_NOTE
    : LIVE_CONTROL_NOTE;

  return muted ? `${connectionNote} · Ton ist aus` : connectionNote;
}

function getNativeFullscreenElement() {
  return document.fullscreenElement ?? document.webkitFullscreenElement ?? null;
}

function isFullscreenActive() {
  return Boolean(getNativeFullscreenElement()) || fallbackFullscreen;
}

function setFallbackFullscreen(enabled, { moveFocus = true } = {}) {
  fallbackFullscreen = enabled;
  elements.playerFrame.classList.toggle("is-window-fullscreen", enabled);
  document.documentElement.classList.toggle("has-window-fullscreen", enabled);
  document.body.classList.toggle("has-window-fullscreen", enabled);
  syncFullscreenUi({ moveFocus });
}

function syncFullscreenUi({ moveFocus = true, forceFocus = false } = {}) {
  const active = isFullscreenActive();
  const transitionPending = fullscreenTransition.isPending();
  const fullscreenLabel = active ? "Vollbild schließen" : "Vollbild öffnen";

  elements.fullscreenButton.setAttribute("aria-pressed", String(active));
  elements.fullscreenButton.setAttribute("aria-label", fullscreenLabel);
  elements.fullscreenButton.setAttribute("aria-hidden", String(active));
  elements.fullscreenButton.disabled = state !== "live" || transitionPending || active;
  if (active) {
    elements.fullscreenButton.tabIndex = -1;
  } else {
    elements.fullscreenButton.removeAttribute("tabindex");
  }
  elements.exitFullscreenButton.disabled = transitionPending;
  elements.fullscreenLabel.textContent = active ? "Vollbild schließen" : "Vollbild";

  if (moveFocus && (forceFocus || active !== fullscreenWasActive)) {
    const target = active ? elements.exitFullscreenButton : elements.fullscreenButton;
    window.requestAnimationFrame(() => {
      if (target.isConnected && !target.disabled) {
        target.focus({ preventScroll: true });
      }
    });
  }

  fullscreenWasActive = active;
}

async function lockFullscreenOrientation() {
  if (
    navigator.maxTouchPoints < 1 ||
    typeof screen.orientation?.lock !== "function"
  ) {
    return;
  }

  try {
    await screen.orientation.lock("landscape");
  } catch {
    // Nicht jeder mobile Browser erlaubt eine Orientierungssperre.
  }
}

function unlockFullscreenOrientation() {
  if (typeof screen.orientation?.unlock !== "function") {
    return;
  }

  try {
    screen.orientation.unlock();
  } catch {
    // Der Browser verwaltet die Orientierung in diesem Fall selbst.
  }
}

function handleNativeFullscreenChange() {
  const nativeFullscreenActive = Boolean(getNativeFullscreenElement());
  if (nativeFullscreenActive && fallbackFullscreen) {
    setFallbackFullscreen(false, { moveFocus: false });
  }

  if (nativeFullscreenActive) {
    void lockFullscreenOrientation();
  } else {
    unlockFullscreenOrientation();
  }
  syncFullscreenUi();
}

function waitForNativeFullscreen() {
  if (getNativeFullscreenElement()) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let finished = false;
    const events = [
      "fullscreenchange",
      "webkitfullscreenchange",
      "fullscreenerror",
      "webkitfullscreenerror",
    ];

    const finish = () => {
      if (finished) {
        return;
      }

      finished = true;
      window.clearTimeout(timeout);
      for (const eventName of events) {
        document.removeEventListener(eventName, finish);
      }
      resolve(Boolean(getNativeFullscreenElement()));
    };

    const timeout = window.setTimeout(finish, FULLSCREEN_CHANGE_TIMEOUT_MS);
    for (const eventName of events) {
      document.addEventListener(eventName, finish, { once: true });
    }
  });
}

function logFullscreenFallback(error) {
  const reason = error instanceof Error ? error.name : "FullscreenUnavailable";
  console.debug(`[VR Live] ${reason}; fensterfüllender Modus wird verwendet.`);
}

async function exitFullscreen({ bypassCooldown = false } = {}) {
  if (!isFullscreenActive()) {
    syncFullscreenUi({ moveFocus: false });
    return;
  }

  if (!fullscreenTransition.tryStart({ bypassCooldown })) {
    return;
  }

  syncFullscreenUi({ moveFocus: false });
  const wasFallbackFullscreen = fallbackFullscreen;
  try {
    if (wasFallbackFullscreen) {
      setFallbackFullscreen(false, { moveFocus: false });
    }

    const exit = document.exitFullscreen ?? document.webkitExitFullscreen;
    if (getNativeFullscreenElement() && typeof exit === "function") {
      await Promise.resolve(exit.call(document));
    }
  } catch (error) {
    logFullscreenFallback(error);
  } finally {
    fullscreenTransition.finish();
    if (!getNativeFullscreenElement()) {
      unlockFullscreenOrientation();
    }
    syncFullscreenUi({ forceFocus: true });
  }

  if (wasFallbackFullscreen && state === "live") {
    elements.controlNote.textContent = getLiveControlNote();
  }
}

async function toggleFullscreen() {
  if (isFullscreenActive()) {
    await exitFullscreen();
    return;
  }

  if (state !== "live" || !fullscreenTransition.tryStart()) {
    return;
  }

  syncFullscreenUi({ moveFocus: false });
  const nativeFullscreenBlocked =
    document.fullscreenEnabled === false && document.webkitFullscreenEnabled !== true;

  try {
    if (!nativeFullscreenBlocked) {
      const standardRequest = elements.playerFrame.requestFullscreen;
      const webkitRequest = elements.playerFrame.webkitRequestFullscreen;
      const nativeRequestAvailable =
        typeof standardRequest === "function" || typeof webkitRequest === "function";

      if (nativeRequestAvailable) {
        try {
          if (typeof standardRequest === "function") {
            await Promise.resolve(
              standardRequest.call(elements.playerFrame, { navigationUI: "hide" }),
            );
          } else {
            await Promise.resolve(webkitRequest.call(elements.playerFrame));
          }

          if (getNativeFullscreenElement() || (await waitForNativeFullscreen())) {
            await lockFullscreenOrientation();
            return;
          }
        } catch (error) {
          logFullscreenFallback(error);
        }
      }
    }

    if (!getNativeFullscreenElement()) {
      setFallbackFullscreen(true, { moveFocus: false });
      elements.controlNote.textContent =
        "Fensterfüllender Modus aktiv · mit × wieder schließen";
    }
  } finally {
    fullscreenTransition.finish();
    syncFullscreenUi({ forceFocus: true });
  }
}

function setState(nextState) {
  state = nextState;
  elements.statusPill.dataset.state = nextState;
  elements.playerFrame.dataset.playerState = nextState;
  elements.playerFrame.setAttribute("aria-busy", String(nextState === "connecting"));
  elements.accessForm.setAttribute("aria-busy", String(nextState === "connecting"));

  const live = nextState === "live";
  const accessInputsEnabled = nextState !== "live" && isConfigured && navigator.onLine;
  elements.accessCodeInput.disabled = !accessInputsEnabled;
  elements.soundButton.disabled = !live;
  elements.reconnectButton.disabled = !isConfigured || nextState === "connecting";
  syncFullscreenUi({ moveFocus: false });

  if (nextState === "live") {
    elements.statusLabel.textContent = "LIVE";
    elements.controlNote.textContent = getLiveControlNote();
    updateSoundLabel();
    return;
  }

  if (nextState === "connecting") {
    const compatibilityMode = connectionMode === CONNECTION_MODE.compatibility;
    elements.statusLabel.textContent = "VERBINDEN";
    elements.placeholderKicker.textContent = compatibilityMode
      ? "KOMPATIBILITÄTSVERBINDUNG"
      : "VERBINDUNG WIRD AUFGEBAUT";
    elements.placeholderTitle.textContent = compatibilityMode
      ? "Ein anderer Netzwerkweg wird ausprobiert …"
      : "Die Quest wird gesucht …";
    elements.placeholderText.textContent = compatibilityMode
      ? "Die Seite verwendet jetzt automatisch einen Relay-Server für dieses Netzwerk."
      : "Bei schwierigen WLAN- oder Mobilfunknetzen kann das bis zu einer Minute dauern.";
    updatePrimaryAction(
      compatibilityMode ? "Ersatzverbindung wird geprüft" : "Verbindung wird aufgebaut",
      compatibilityMode
        ? "Bitte geöffnet lassen"
        : "Danach wird bei Bedarf automatisch ein anderer Netzwerkweg versucht",
    );
    elements.primaryAction.disabled = true;
    elements.controlNote.textContent = compatibilityMode
      ? "Automatischer Ersatzweg wird hergestellt"
      : "Sichere Direktverbindung zu VDO.Ninja wird hergestellt";
    return;
  }

  elements.statusLabel.textContent = "OFFLINE";
  elements.primaryAction.disabled = !isConfigured;

  if (!isConfigured) {
    elements.placeholderKicker.textContent = "EINRICHTUNG NOCH OFFEN";
    elements.placeholderTitle.textContent = "Der Zuschauer-Link wird einmalig vorbereitet.";
    elements.placeholderText.textContent = "Danach bleibt diese Seite dauerhaft einsatzbereit.";
    updatePrimaryAction("Noch nicht eingerichtet", "Der Zuschauer-Link wird vorbereitet");
    elements.controlNote.textContent = "Keine Zugangsdaten oder Sender-Tokens auf dieser Seite";
    return;
  }

  elements.placeholderKicker.textContent = "STREAM OFFLINE";
  elements.placeholderTitle.textContent = viewerStarted
    ? "Der Stream ist gerade nicht erreichbar."
    : "Bereit zum Zuschauen.";
  elements.placeholderText.textContent = viewerStarted
    ? "Die Seite versucht es automatisch erneut. Prüfe bei Bedarf den aktuellen Zugangscode."
    : "Gib den aktuellen vierstelligen Zugangscode ein.";
  updatePrimaryAction(
    viewerStarted ? "Jetzt neu verbinden" : "Stream ansehen",
    viewerStarted
      ? "Direktverbindung neu starten"
      : "Vierstelligen Code eingeben",
  );
  elements.controlNote.textContent = viewerStarted
    ? "Automatische Wiederverbindung ist aktiv"
    : "Nur ansehen · keine Kamera · kein Mikrofon";
}

function showNetworkOfflineState() {
  setState("offline");
  elements.placeholderKicker.textContent = "KEINE INTERNETVERBINDUNG";
  elements.placeholderTitle.textContent = "Dieses Gerät ist gerade offline.";
  elements.placeholderText.textContent =
    "Sobald die Internetverbindung zurück ist, versucht die Seite den Stream automatisch erneut.";
  updatePrimaryAction("Auf Internet warten", "Automatischer neuer Versuch");
  elements.primaryAction.disabled = true;
  elements.reconnectButton.disabled = true;
  elements.controlNote.textContent = "Keine Internetverbindung";
}

function sendToPlayer(message) {
  if (!player?.contentWindow) {
    return;
  }

  player.contentWindow.postMessage(message, VDO_ORIGIN);
}

function removePlayer() {
  clearConnectionTimers();
  player?.remove();
  player = null;
  elements.playerSlot.replaceChildren();
}

function scheduleReconnect() {
  clearReconnectTimer();

  if (
    !viewerStarted ||
    !hasViewerCredentials() ||
    !navigator.onLine ||
    document.hidden ||
    !isConfigured
  ) {
    return;
  }

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connect({ mode: CONNECTION_MODE.direct });
  }, STREAM_CONFIG.reconnectDelayMs);
}

function markOffline({ reconnect = true } = {}) {
  removePlayer();
  confirmedMissingStats = 0;
  recoveringConnection = false;
  elements.playerFrame.dataset.connectionHealth = "stable";
  setState("offline");

  if (reconnect) {
    scheduleReconnect();
  }
}

function markLive() {
  if (!player) {
    return;
  }

  const focusWasInPlaceholder = elements.playerPlaceholder.contains(document.activeElement);
  const becameLive = state !== "live";
  const recovered = recoveringConnection;
  clearTimer(connectionTimer);
  connectionTimer = null;
  clearTimer(disconnectTimer);
  disconnectTimer = null;
  confirmedMissingStats = 0;
  recoveringConnection = false;
  setAccessError();
  elements.playerFrame.dataset.connectionHealth = "stable";
  if (becameLive || recovered) {
    setState("live");
  }
  if (becameLive) {
    sendToPlayer({ mute: muted });
    sendToPlayer({ volume: 1 });
  }

  if (focusWasInPlaceholder) {
    window.requestAnimationFrame(() => {
      if (!elements.soundButton.disabled) {
        elements.soundButton.focus({ preventScroll: true });
      }
    });
  }
}

function showRecoveringState() {
  if (state !== "live" || recoveringConnection) {
    return;
  }

  recoveringConnection = true;
  elements.statusPill.dataset.state = "connecting";
  elements.statusLabel.textContent = "NEU VERBINDEN";
  elements.playerFrame.dataset.connectionHealth = "recovering";
  elements.controlNote.textContent =
    "Verbindung unterbrochen · automatische Wiederherstellung läuft";
}

function requestStats() {
  if (!player) {
    return;
  }

  sendToPlayer({ getStats: true, cib: "health" });
}

function connect({ mode = CONNECTION_MODE.direct } = {}) {
  if (!isConfigured) {
    setState("offline");
    return;
  }

  if (!hasViewerCredentials()) {
    setState("offline");
    setAccessError("Der Zugangscode muss genau vier Ziffern haben.");
    elements.accessCodeInput.focus({ preventScroll: true });
    elements.accessCodeInput.select();
    return;
  }

  if (!navigator.onLine) {
    viewerStarted = true;
    clearReconnectTimer();
    removePlayer();
    showNetworkOfflineState();
    return;
  }

  viewerStarted = true;
  clearReconnectTimer();
  removePlayer();
  muted = START_MUTED;
  updateSoundLabel();
  confirmedMissingStats = 0;
  recoveringConnection = false;
  elements.playerFrame.dataset.connectionHealth = "stable";
  connectionMode = mode;
  setAccessError();
  setState("connecting");

  player = document.createElement("iframe");
  player.title = "VR-Livestream";
  player.allow = "autoplay; fullscreen";
  player.referrerPolicy = "no-referrer";
  player.setAttribute("allowfullscreen", "");
  player.setAttribute(
    "sandbox",
    "allow-scripts allow-same-origin allow-forms allow-presentation",
  );

  player.addEventListener("load", () => {
    sendToPlayer({ mute: true });
    sendToPlayer({ volume: 1 });
    requestStats();
  });

  player.src = buildViewerUrl(STREAM_CONFIG, connectionMode, {
    accessCode,
  });
  elements.playerSlot.append(player);

  statsTimer = window.setInterval(requestStats, STATS_INTERVAL_MS);
  connectionTimer = window.setTimeout(() => {
    if (state !== "connecting") {
      return;
    }

    if (connectionMode === CONNECTION_MODE.direct) {
      connect({ mode: CONNECTION_MODE.compatibility });
      return;
    }

    markOffline();
  }, STREAM_CONFIG.connectTimeoutMs);
}

window.addEventListener("message", (event) => {
  if (event.origin !== VDO_ORIGIN || event.source !== player?.contentWindow) {
    return;
  }

  const message = event.data;
  if (!message || typeof message !== "object") {
    return;
  }

  if (isTargetVideoEvent(message, STREAM_CONFIG.streamId)) {
    confirmedMissingStats = 0;
    markLive();
    return;
  }

  const healthStatus = getHealthStatsStatus(message, STREAM_CONFIG.streamId);
  if (healthStatus !== "unrelated") {
    confirmedMissingStats = nextConfirmedMissingCount(
      confirmedMissingStats,
      healthStatus,
    );

    if (healthStatus === "present") {
      markLive();
    } else if (healthStatus === "missing" && state === "live") {
      if (confirmedMissingStats >= 2) {
        showRecoveringState();
      }
      if (confirmedMissingStats >= MAX_CONFIRMED_MISSING_STATS) {
        markOffline();
      }
    }
    return;
  }

  const isTargetConnectionEvent =
    ["push-connection", "view-connection"].includes(message.action) &&
    isSameStreamId(message.streamID ?? message.streamId, STREAM_CONFIG.streamId);
  const connectionState = normalizeConnectionState(message.value);

  if (isTargetConnectionEvent && connectionState === true) {
    clearTimer(disconnectTimer);
    disconnectTimer = null;
    return;
  }

  if (isTargetConnectionEvent && connectionState === false && state === "live") {
    showRecoveringState();
    clearTimer(disconnectTimer);
    disconnectTimer = window.setTimeout(() => {
      if (state === "live") {
        markOffline();
      }
    }, DISCONNECT_GRACE_MS);
  }
});

elements.accessForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!applyViewerCredentialsFromInputs()) {
    return;
  }

  connect({ mode: CONNECTION_MODE.direct });
});

elements.accessCodeInput.addEventListener("input", () => {
  elements.accessCodeInput.value = elements.accessCodeInput.value
    .replace(/[^0-9]/g, "")
    .slice(0, 4);
  handleCredentialEdit();
});

elements.reconnectButton.addEventListener("click", () => {
  if (!applyViewerCredentialsFromInputs()) {
    return;
  }

  connect({ mode: CONNECTION_MODE.direct });
});

elements.soundButton.addEventListener("click", () => {
  muted = !muted;
  sendToPlayer({ mute: muted });
  sendToPlayer({ volume: 1 });
  updateSoundLabel();
});

elements.fullscreenButton.addEventListener("click", toggleFullscreen);
elements.exitFullscreenButton.addEventListener("click", () => {
  exitFullscreen({ bypassCooldown: true });
});

document.addEventListener("fullscreenchange", handleNativeFullscreenChange);
document.addEventListener("webkitfullscreenchange", handleNativeFullscreenChange);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && fallbackFullscreen) {
    exitFullscreen({ bypassCooldown: true });
  }
});

window.addEventListener("offline", () => {
  if (viewerStarted) {
    markOffline({ reconnect: false });
    showNetworkOfflineState();
  }
});

window.addEventListener("online", () => {
  if (viewerStarted && state === "offline") {
    connect({ mode: CONNECTION_MODE.direct });
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && viewerStarted && state === "offline") {
    connect({ mode: CONNECTION_MODE.direct });
  }
});

window.addEventListener("beforeunload", () => {
  setFallbackFullscreen(false, { moveFocus: false });
  clearReconnectTimer();
  removePlayer();
});

updateSoundLabel();
setState("offline");
