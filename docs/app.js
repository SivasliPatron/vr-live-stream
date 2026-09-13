import { STREAM_CONFIG } from "./stream-config.js?v=20260913-stall-1";
import {
  getHealthStatsStatus,
  getTargetVideoStats,
  isSameStreamId,
  isTargetVideoEvent,
  nextConfirmedMissingCount,
  normalizeConnectionState,
} from "./player-health.js?v=20260905-connect-1";
import { buildViewerUrl, CONNECTION_MODE, isTrustedViewerBaseUrl } from "./viewer-url.js?v=20260913-stall-1";
import { createVideoProgressMonitor } from "./video-progress.js?v=20260913-stall-1";
import {
  getPreferredConnectionMode,
  getReconnectDelay,
  otherConnectionMode,
  rememberConnectionMode,
} from "./connection-policy.js?v=20260905-connect-1";
import { createFullscreenTransitionGate } from "./fullscreen-transition.js?v=20260905-1";

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
  connectionCancelButton: document.querySelector("#connectionCancelButton"),
  soundButton: document.querySelector("#soundButton"),
  soundLabel: document.querySelector("#soundLabel"),
  playerSoundButton: document.querySelector("#playerSoundButton"),
  playerSoundLabel: document.querySelector("#playerSoundLabel"),
  retrySoundButton: document.querySelector("#retrySoundButton"),
  audioHelp: document.querySelector("#audioHelp"),
  fullscreenButton: document.querySelector("#fullscreenButton"),
  fullscreenIcon: document.querySelector("#fullscreenButton .fullscreen-icon"),
  fullscreenLabel: document.querySelector("#fullscreenButton span:last-child"),
  exitFullscreenButton: document.querySelector("#exitFullscreenButton"),
  reconnectButton: document.querySelector("#reconnectButton"),
  controlNote: document.querySelector("#controlNote"),
};

// Ein unvollständiger Konfigurationswert darf die Bedienoberfläche nicht abbrechen.
let VDO_ORIGIN = "";
try {
  VDO_ORIGIN = new URL(STREAM_CONFIG.viewerBaseUrl).origin;
} catch {
  // setState zeigt die fehlende Einrichtung an.
}
const STATS_INTERVAL_MS = 2_000;
const MAX_CONFIRMED_MISSING_STATS = 4;
const DISCONNECT_GRACE_MS = 15_000;
const PLAYER_RETIRE_TIMEOUT_MS = 1_200;
const FULLSCREEN_CHANGE_TIMEOUT_MS = 1_200;
const FULLSCREEN_TOGGLE_COOLDOWN_MS = 450;
const START_MUTED = false;
const PLAYER_LOAD_TIMEOUT_MS = Number.isFinite(STREAM_CONFIG.playerLoadTimeoutMs) && STREAM_CONFIG.playerLoadTimeoutMs > 0
  ? STREAM_CONFIG.playerLoadTimeoutMs : 90_000;
const CONNECT_TIMEOUT_MS = Number.isFinite(STREAM_CONFIG.connectTimeoutMs) && STREAM_CONFIG.connectTimeoutMs > 0
  ? STREAM_CONFIG.connectTimeoutMs : 60_000;
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
const videoProgress = createVideoProgressMonitor();
let stallKeyframeRequested = false;
let retryAttempt = 0;
const attemptedModes = new Set();
const retiredPlayers = new Map();
let fallbackFullscreen = false;
let fullscreenWasActive = false;
let connectionMode = CONNECTION_MODE.direct;
let recoveringConnection = false;
let accessCode = "";
let connectionPhase = "idle";
let connectionFailure = "";
let manualRetryRequired = false;
let automaticReconnect = false;
let hasPlayed = false;
let fullscreenReturnFocus = null;
let fullscreenRequested = false;
const fullscreenBackground = new Map();

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
  hasPlayed = false;
  connectionFailure = "";
  manualRetryRequired = false;
  automaticReconnect = false;
  retryAttempt = 0;
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
  isTrustedViewerBaseUrl(STREAM_CONFIG.viewerBaseUrl);

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
  const label = muted ? "Ton einschalten" : "Ton ausschalten";
  elements.soundLabel.textContent = label;
  elements.playerSoundLabel.textContent = label;
  for (const button of [elements.soundButton, elements.playerSoundButton]) {
    button.setAttribute("aria-pressed", String(!muted));
    button.setAttribute("aria-label", label);
  }

  if (state === "live" && !recoveringConnection) {
    elements.controlNote.textContent = getLiveControlNote();
  }
}

function setSoundMuted(value) {
  muted = value;
  // VDO nutzt hier 0..1. Entstummen versucht auch blockierte Wiedergabe erneut.
  sendToPlayer({ mute: muted });
  sendToPlayer({ volume: 1 });
  updateSoundLabel();
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
  return getNativeFullscreenElement() === elements.playerFrame || fallbackFullscreen;
}

function setFallbackFullscreen(enabled, { moveFocus = true } = {}) {
  if (enabled && !fallbackFullscreen) {
    // Nur der Player bleibt im Tastatur- und Screenreader-Fokus erreichbar.
    for (let node = elements.playerFrame; node.parentElement; node = node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling !== node && !fullscreenBackground.has(sibling)) {
          fullscreenBackground.set(sibling, sibling.inert);
          sibling.inert = true;
        }
      }
      if (node.parentElement === document.body) break;
    }
    elements.playerFrame.setAttribute("role", "dialog");
    elements.playerFrame.setAttribute("aria-modal", "true");
    elements.playerFrame.setAttribute("aria-label", "VR-Livestream im Vollbild");
  } else if (!enabled) {
    for (const [element, inert] of fullscreenBackground) element.inert = inert;
    fullscreenBackground.clear();
    elements.playerFrame.removeAttribute("role");
    elements.playerFrame.removeAttribute("aria-modal");
    elements.playerFrame.removeAttribute("aria-label");
  }
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
  // Die native Wiedergabefreigabe im fremden Player bleibt per Tastatur erreichbar.
  if (player) player.tabIndex = state === "live" && !fallbackFullscreen ? 0 : -1;

  if (moveFocus && (forceFocus || active !== fullscreenWasActive)) {
    const returnTarget = fullscreenReturnFocus?.isConnected && !fullscreenReturnFocus.disabled
      ? fullscreenReturnFocus
      : state === "live" ? elements.fullscreenButton : elements.accessCodeInput;
    const target = active ? elements.exitFullscreenButton : returnTarget;
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
  const nativeFullscreenActive = getNativeFullscreenElement() === elements.playerFrame;
  if (nativeFullscreenActive && (!fullscreenRequested || state !== "live")) {
    void exitFullscreen({ bypassCooldown: true });
    return;
  }
  if (!nativeFullscreenActive && !fallbackFullscreen) fullscreenRequested = false;
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
  fullscreenRequested = false;
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

  fullscreenReturnFocus = elements.fullscreenButton;
  fullscreenRequested = true;
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
          const request = typeof standardRequest === "function"
            ? standardRequest.call(elements.playerFrame, { navigationUI: "hide" })
            : webkitRequest.call(elements.playerFrame);
          // Manche Browser liefern ein Promise, das ohne Ereignis hängen bleibt.
          const active = await Promise.race([
            Promise.resolve(request).then(waitForNativeFullscreen),
            waitForNativeFullscreen(),
          ]);
          if (active) {
            await lockFullscreenOrientation();
            return;
          }
        } catch (error) {
          logFullscreenFallback(error);
        }
      }
    }

    if (state === "live" && fullscreenRequested && !getNativeFullscreenElement()) {
      setFallbackFullscreen(true, { moveFocus: false });
      elements.controlNote.textContent =
        "Fensterfüllender Modus aktiv · mit × wieder schließen";
    }
  } finally {
    fullscreenTransition.finish();
    syncFullscreenUi({ forceFocus: true });
    if (state !== "live" && isFullscreenActive()) {
      void exitFullscreen({ bypassCooldown: true });
    }
  }
}

function setState(nextState) {
  state = nextState;
  elements.statusPill.dataset.state = nextState;
  elements.playerFrame.dataset.playerState = nextState;
  elements.playerFrame.dataset.connectionPhase = nextState === "connecting"
    ? connectionPhase : nextState === "live" ? "live" : "idle";
  elements.playerFrame.setAttribute("aria-busy", String(nextState === "connecting"));
  elements.accessForm.setAttribute("aria-busy", String(nextState === "connecting"));

  const live = nextState === "live";
  const accessInputsEnabled = nextState !== "live" && isConfigured;
  elements.accessCodeInput.disabled = !accessInputsEnabled;
  elements.soundButton.disabled = !live;
  elements.playerSoundButton.disabled = !live;
  elements.retrySoundButton.disabled = !live;
  elements.audioHelp.hidden = !live;
  elements.connectionCancelButton.hidden = nextState !== "connecting";
  elements.reconnectButton.disabled = !isConfigured || !navigator.onLine ||
    !hasViewerCredentials() || nextState === "connecting";
  syncFullscreenUi({ moveFocus: false });

  if (nextState === "live") {
    elements.statusLabel.textContent = "LIVE";
    elements.controlNote.textContent = getLiveControlNote();
    updateSoundLabel();
    return;
  }

  if (nextState === "connecting") {
    if (connectionPhase === "loading") {
      elements.statusLabel.textContent = "VERBINDEN";
      elements.placeholderKicker.textContent = "VIDEOPLAYER WIRD GELADEN";
      elements.placeholderTitle.textContent = "Der Videoplayer wird geladen…";
      elements.placeholderText.textContent =
        `VDO.Ninja wird geöffnet. Bei langsamer Verbindung kann das bis zu ${Math.ceil(PLAYER_LOAD_TIMEOUT_MS / 1000)} Sekunden dauern. Du kannst jederzeit abbrechen.`;
      updatePrimaryAction("Videoplayer wird geladen", "Bitte geöffnet lassen");
      elements.primaryAction.disabled = true;
      elements.controlNote.textContent = "VDO.Ninja lädt · noch keine Verbindung zum Sender";
      return;
    }
    const compatibilityMode = connectionMode === CONNECTION_MODE.compatibility;
    elements.statusLabel.textContent = "VERBINDEN";
    elements.placeholderKicker.textContent = compatibilityMode
      ? "KOMPATIBILITÄTSVERBINDUNG"
      : "VERBINDUNG WIRD AUFGEBAUT";
    elements.placeholderTitle.textContent = compatibilityMode
      ? "Die Quest wird verbunden…"
      : "Die Quest wird gesucht…";
    elements.placeholderText.textContent = compatibilityMode
      ? "Die Seite verwendet jetzt automatisch einen Relay-Server für dieses Netzwerk."
      : "Die Verbindung wird geprüft. Falls sie nicht klappt, folgt automatisch ein anderer Netzwerkweg.";
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

  if (!navigator.onLine) {
    showNetworkOfflineState();
    return;
  }

  if (connectionFailure === "player-load") {
    elements.placeholderKicker.textContent = "VIDEOPLAYER NICHT ERREICHBAR";
    elements.placeholderTitle.textContent = "VDO.Ninja konnte nicht geladen werden.";
    elements.placeholderText.textContent =
      "Der externe Player hat nicht rechtzeitig geantwortet. Der Versuch wurde beendet. Prüfe die Erreichbarkeit von VDO.Ninja und versuche es danach erneut.";
    updatePrimaryAction("Erneut versuchen", "Videoplayer neu laden");
    elements.controlNote.textContent = "Laden abgebrochen · kein automatischer Neustart";
    return;
  }

  if (connectionFailure === "stream-unreachable" && manualRetryRequired) {
    elements.placeholderKicker.textContent = "KEIN STREAM EMPFANGEN";
    elements.placeholderTitle.textContent = "Der Player ist bereit, aber es kommt kein Bild.";
    elements.placeholderText.textContent =
      "Beide Netzwerkwege wurden geprüft. Prüfe, ob der Sender noch überträgt und ob du seinen aktuellen Zugangscode verwendest. Es erfolgt kein endloser Neustart.";
    updatePrimaryAction("Erneut versuchen", "Verbindung neu prüfen");
    elements.controlNote.textContent = "Kein Bild empfangen · Sender, Zugangscode oder Netzwerk prüfen";
    return;
  }

  elements.placeholderKicker.textContent = "STREAM OFFLINE";
  elements.placeholderTitle.textContent = viewerStarted
    ? "Der Stream ist gerade nicht erreichbar."
    : "Bereit zum Zuschauen.";
  elements.placeholderText.textContent = viewerStarted
    ? automaticReconnect
      ? "Die Seite versucht es automatisch erneut. Prüfe bei Bedarf den aktuellen Zugangscode."
      : "Prüfe den aktuellen Zugangscode und starte die Verbindung erneut."
    : "Gib den aktuellen vierstelligen Zugangscode ein.";
  updatePrimaryAction(
    viewerStarted ? "Jetzt neu verbinden" : "Stream ansehen",
    viewerStarted
      ? "Verbindung neu starten"
      : "Mit Spielton starten",
  );
  elements.controlNote.textContent = viewerStarted
    ? automaticReconnect ? "Automatische Wiederverbindung ist aktiv" : "Verbindung beendet · erneut versuchen möglich"
    : "Nur ansehen · keine Kamera · kein Mikrofon";
}

function showNetworkOfflineState() {
  elements.placeholderKicker.textContent = "KEINE INTERNETVERBINDUNG";
  elements.placeholderTitle.textContent = "Dieses Gerät ist gerade offline.";
  elements.placeholderText.textContent =
    manualRetryRequired
      ? "Verbinde dieses Gerät wieder mit dem Internet. Starte den Stream danach mit Erneut versuchen."
      : viewerStarted
      ? "Sobald die Internetverbindung zurück ist, versucht die Seite den Stream automatisch erneut."
      : "Du kannst den Code bereits eingeben und den Stream starten, sobald du wieder online bist.";
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

function finishRetiringPlayer(source) {
  const retired = retiredPlayers.get(source);
  if (!retired) return;
  clearTimer(retired.timer);
  retired.element.remove();
  retiredPlayers.delete(source);
}

function removePlayer() {
  clearConnectionTimers();
  videoProgress.reset();
  stallKeyframeRequested = false;
  const previous = player;
  player = null;
  if (!previous) return;
  previous.hidden = true;
  previous.tabIndex = -1;
  previous.removeAttribute("data-active-player");
  const source = previous.contentWindow;
  if (!source) {
    previous.remove();
    return;
  }
  // Im DOM lassen, bis VDO aufgelegt hat. Sofortiges Entfernen verschluckt
  // postMessage und kann beim Sender vorübergehend einen Zuschauerplatz belegen.
  retiredPlayers.set(source, {
    element: previous,
    timer: window.setTimeout(() => finishRetiringPlayer(source), PLAYER_RETIRE_TIMEOUT_MS),
  });
  source.postMessage({ mute: true }, VDO_ORIGIN);
  source.postMessage({ hangup: true }, VDO_ORIGIN);
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
    if (viewerStarted && !document.hidden && navigator.onLine && hasViewerCredentials()) {
      connect();
    }
  }, getReconnectDelay(retryAttempt++, STREAM_CONFIG));
}

function markOffline({ reconnect = true, failure = "" } = {}) {
  fullscreenRequested = false;
  connectionFailure = failure;
  manualRetryRequired = Boolean(failure) && !reconnect;
  automaticReconnect = reconnect && viewerStarted;
  connectionPhase = "idle";
  clearReconnectTimer();
  removePlayer();
  confirmedMissingStats = 0;
  recoveringConnection = false;
  elements.playerFrame.dataset.connectionHealth = "stable";
  setState("offline");
  if (isFullscreenActive()) void exitFullscreen({ bypassCooldown: true });

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
  connectionPhase = "live";
  connectionFailure = "";
  manualRetryRequired = false;
  hasPlayed = true;
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
    retryAttempt = 0;
    rememberConnectionMode(connectionMode);
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

function handleConnectionDeadline() {
  if (!player || state !== "connecting") return;
  if (connectionPhase === "loading") {
    // A relay cannot repair missing scripts. Do not repeatedly discard a cold
    // player before it has even reached VDO's own 30-second socket handshake.
    markOffline({ reconnect: false, failure: "player-load" });
    return;
  }
  const nextMode = otherConnectionMode(connectionMode);
  if (!attemptedModes.has(nextMode)) {
    connect({ mode: nextMode, continuingCycle: true });
    return;
  }
  // Recover established streams automatically. An unsuccessful first join must
  // instead leave an actionable error and editable code, not loop indefinitely.
  markOffline({ reconnect: hasPlayed, failure: "stream-unreachable" });
}

function markPlayerReady() {
  if (!player || state !== "connecting" || connectionPhase !== "loading") return;
  connectionPhase = "signaling";
  clearTimer(connectionTimer);
  connectionTimer = window.setTimeout(handleConnectionDeadline, CONNECT_TIMEOUT_MS);
  setState("connecting");
}

function connect({ mode = getPreferredConnectionMode(), continuingCycle = false } = {}) {
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
    setState("offline");
    return;
  }

  viewerStarted = true;
  manualRetryRequired = false;
  connectionFailure = "";
  if (!continuingCycle) attemptedModes.clear();
  attemptedModes.add(mode);
  clearReconnectTimer();
  removePlayer();
  connectionPhase = "loading";
  updateSoundLabel();
  confirmedMissingStats = 0;
  videoProgress.reset();
  recoveringConnection = false;
  elements.playerFrame.dataset.connectionHealth = "stable";
  connectionMode = mode;
  setAccessError();
  setState("connecting");

  player = document.createElement("iframe");
  player.dataset.activePlayer = "true";
  player.title = "VR-Livestream";
  player.tabIndex = -1;
  player.allow = "autoplay; fullscreen";
  player.referrerPolicy = "no-referrer";
  player.setAttribute("allowfullscreen", "");
  player.setAttribute(
    "sandbox",
    "allow-scripts allow-same-origin allow-forms allow-presentation",
  );

  const currentPlayer = player;
  player.addEventListener("load", () => {
    if (player !== currentPlayer) return;
    sendToPlayer({ mute: muted });
    sendToPlayer({ volume: 1 });
    requestStats();
  });

  player.src = buildViewerUrl(STREAM_CONFIG, connectionMode, {
    accessCode,
    muted,
    parentOrigin: window.location.origin,
  });
  elements.playerSlot.append(player);

  statsTimer = window.setInterval(requestStats, STATS_INTERVAL_MS);
  connectionTimer = window.setTimeout(handleConnectionDeadline, PLAYER_LOAD_TIMEOUT_MS);
}

window.addEventListener("message", (event) => {
  if (event.origin !== VDO_ORIGIN) {
    return;
  }

  const message = event.data;
  if (!message || typeof message !== "object") {
    return;
  }

  if (retiredPlayers.has(event.source)) {
    if (message.action === "hungup" && message.value === true) {
      finishRetiringPlayer(event.source);
    }
    return;
  }
  if (event.source !== player?.contentWindow) return;

  if (isTargetVideoEvent(message, STREAM_CONFIG.streamId)) {
    markPlayerReady();
    // Track-Erstellung beweist noch keinen Empfang. Erst Videodaten zählen.
    requestStats();
    return;
  }

  const healthStatus = getHealthStatsStatus(message, STREAM_CONFIG.streamId);
  if (healthStatus !== "unrelated") {
    if (healthStatus === "present" || healthStatus === "missing") markPlayerReady();
    confirmedMissingStats = nextConfirmedMissingCount(
      confirmedMissingStats,
      healthStatus,
    );

    if (healthStatus === "present") {
      const sample = getTargetVideoStats(message, STREAM_CONFIG.streamId);
      if (document.hidden) {
        videoProgress.suspend();
      }
      const progress = videoProgress.observe(sample, performance.now());
      if (progress.progressed) {
        stallKeyframeRequested = false;
        markLive();
      } else if (!document.hidden && state === "live" && progress.status === "recovering") {
        showRecoveringState();
        elements.controlNote.textContent = "Keine neuen Videobilder · Wiederherstellung wird versucht";
        if (!stallKeyframeRequested) {
          // Viewer-to-sender request, not VDO's publisher-side scene command.
          sendToPlayer({ sendRequest: { keyframe: true } });
          stallKeyframeRequested = true;
        }
      } else if (!document.hidden && state === "live" && progress.status === "stalled") {
        markOffline();
      }
    } else if (healthStatus === "missing" && state === "live") {
      videoProgress.suspend();
      if (confirmedMissingStats >= 2) {
        showRecoveringState();
      }
      if (confirmedMissingStats >= MAX_CONFIRMED_MISSING_STATS) {
        markOffline();
      }
    } else {
      videoProgress.suspend();
    }
    return;
  }

  const isTargetConnectionEvent =
    ["push-connection", "view-connection"].includes(message.action) &&
    isSameStreamId(message.streamID ?? message.streamId, STREAM_CONFIG.streamId);
  const connectionState = normalizeConnectionState(message.value);

  if (isTargetConnectionEvent && connectionState !== null) markPlayerReady();

  if (isTargetConnectionEvent && connectionState === true) {
    requestStats();
    return;
  }

  if (isTargetConnectionEvent && connectionState === false && state === "live") {
    showRecoveringState();
    if (disconnectTimer !== null) return;
    disconnectTimer = window.setTimeout(() => {
      if (state === "live") {
        markOffline();
      }
    }, DISCONNECT_GRACE_MS);
  }
});

elements.accessForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (state === "connecting" || state === "live") return;

  if (!applyViewerCredentialsFromInputs()) {
    return;
  }

  retryAttempt = 0;
  connect();
});

elements.connectionCancelButton.addEventListener("click", () => {
  viewerStarted = false;
  retryAttempt = 0;
  markOffline({ reconnect: false });
  elements.accessCodeInput.focus({ preventScroll: true });
});

elements.accessCodeInput.addEventListener("input", () => {
  elements.accessCodeInput.value = elements.accessCodeInput.value
    .replace(/[^0-9]/g, "")
    .slice(0, 4);
  handleCredentialEdit();
});

elements.reconnectButton.addEventListener("click", () => {
  if (state === "connecting") return;
  if (!applyViewerCredentialsFromInputs()) {
    return;
  }

  retryAttempt = 0;
  connect();
});

elements.soundButton.addEventListener("click", () => setSoundMuted(!muted));
elements.playerSoundButton.addEventListener("click", () => setSoundMuted(!muted));
elements.retrySoundButton.addEventListener("click", () => setSoundMuted(false));

elements.fullscreenButton.addEventListener("click", toggleFullscreen);
elements.exitFullscreenButton.addEventListener("click", () => {
  exitFullscreen({ bypassCooldown: true });
});

document.addEventListener("fullscreenchange", handleNativeFullscreenChange);
document.addEventListener("webkitfullscreenchange", handleNativeFullscreenChange);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && fallbackFullscreen) {
    event.preventDefault();
    exitFullscreen({ bypassCooldown: true });
  }
  if (event.key === "Tab" && fallbackFullscreen) {
    const targets = [...elements.playerFrame.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')]
      .filter((element) => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
    const first = targets[0];
    const last = targets.at(-1);
    if (first && (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus({ preventScroll: true });
    }
  }
});

window.addEventListener("offline", () => {
  markOffline({ reconnect: false, failure: manualRetryRequired ? connectionFailure : "" });
});

window.addEventListener("online", () => {
  if (viewerStarted && state === "offline" && !manualRetryRequired) {
    connect();
  } else {
    setState(state);
  }
});

document.addEventListener("visibilitychange", () => {
  videoProgress.suspend();
  if (!document.hidden && state === "live") requestStats();
  if (!document.hidden && viewerStarted && state === "offline" && !manualRetryRequired) {
    connect();
  }
});

window.addEventListener("pagehide", () => {
  setFallbackFullscreen(false, { moveFocus: false });
  markOffline({ reconnect: false, failure: manualRetryRequired ? connectionFailure : "" });
});

window.addEventListener("pageshow", (event) => {
  if (event.persisted && viewerStarted && !manualRetryRequired) connect();
});

updateSoundLabel();
setState("offline");
