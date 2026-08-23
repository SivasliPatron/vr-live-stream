import { STREAM_CONFIG } from "./stream-config.js?v=20260824-2";
import {
  getHealthStatsStatus,
  isSameStreamId,
  isTargetVideoEvent,
  nextConfirmedMissingCount,
  normalizeConnectionState,
} from "./player-health.js?v=20260824-2";
import { buildViewerUrl, CONNECTION_MODE } from "./viewer-url.js?v=20260824-2";

const elements = {
  statusPill: document.querySelector("#statusPill"),
  statusLabel: document.querySelector("#statusLabel"),
  playerFrame: document.querySelector("#playerFrame"),
  playerSlot: document.querySelector("#playerSlot"),
  placeholderKicker: document.querySelector("#placeholderKicker"),
  placeholderTitle: document.querySelector("#placeholderTitle"),
  placeholderText: document.querySelector("#placeholderText"),
  primaryAction: document.querySelector("#primaryAction"),
  primaryActionLabel: document.querySelector("#primaryActionLabel"),
  soundButton: document.querySelector("#soundButton"),
  soundLabel: document.querySelector("#soundLabel"),
  fullscreenButton: document.querySelector("#fullscreenButton"),
  exitFullscreenButton: document.querySelector("#exitFullscreenButton"),
  reconnectButton: document.querySelector("#reconnectButton"),
  controlNote: document.querySelector("#controlNote"),
};

const VDO_ORIGIN = new URL(STREAM_CONFIG.viewerBaseUrl).origin;
const STATS_INTERVAL_MS = 4_000;
const MAX_CONFIRMED_MISSING_STATS = 25;
const DISCONNECT_GRACE_MS = 90_000;
const FULLSCREEN_CHANGE_TIMEOUT_MS = 450;
const LIVE_CONTROL_NOTE = "Direkte Zuschauer-Verbindung · keine Kamera · kein Mikrofon";
const COMPATIBILITY_CONTROL_NOTE =
  "Kompatibilitätsverbindung über Relay · keine Kamera · kein Mikrofon";

let player = null;
let state = "offline";
let viewerStarted = false;
let muted = false;
let connectionTimer = null;
let disconnectTimer = null;
let reconnectTimer = null;
let statsTimer = null;
let confirmedMissingStats = 0;
let fallbackFullscreen = false;
let fullscreenWasActive = false;
let connectionMode = CONNECTION_MODE.direct;

function hasUsableValue(value) {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    !value.startsWith("PENDING_")
  );
}

const isConfigured =
  hasUsableValue(STREAM_CONFIG.streamId) &&
  hasUsableValue(STREAM_CONFIG.audienceToken) &&
  VDO_ORIGIN === "https://vdo.ninja";

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
  elements.soundLabel.textContent = "Ton";
  elements.soundButton.setAttribute("aria-pressed", String(!muted));
  elements.soundButton.setAttribute(
    "aria-label",
    muted ? "Ton einschalten" : "Ton ausschalten",
  );
}

function getLiveControlNote() {
  return connectionMode === CONNECTION_MODE.compatibility
    ? COMPATIBILITY_CONTROL_NOTE
    : LIVE_CONTROL_NOTE;
}

function getNativeFullscreenElement() {
  return document.fullscreenElement ?? document.webkitFullscreenElement ?? null;
}

function setFallbackFullscreen(enabled, { moveFocus = true } = {}) {
  fallbackFullscreen = enabled;
  elements.playerFrame.classList.toggle("is-window-fullscreen", enabled);
  document.body.classList.toggle("has-window-fullscreen", enabled);
  syncFullscreenUi({ moveFocus });
}

function syncFullscreenUi({ moveFocus = true } = {}) {
  const active = Boolean(getNativeFullscreenElement()) || fallbackFullscreen;
  elements.fullscreenButton.setAttribute("aria-pressed", String(active));
  elements.fullscreenButton.setAttribute(
    "aria-label",
    active ? "Vollbild schließen" : "Vollbild öffnen",
  );

  if (moveFocus && active !== fullscreenWasActive) {
    const target = active ? elements.exitFullscreenButton : elements.fullscreenButton;
    window.requestAnimationFrame(() => {
      if (target.isConnected && !target.disabled) {
        target.focus({ preventScroll: true });
      }
    });
  }

  fullscreenWasActive = active;
}

function handleNativeFullscreenChange() {
  if (getNativeFullscreenElement() && fallbackFullscreen) {
    fallbackFullscreen = false;
    elements.playerFrame.classList.remove("is-window-fullscreen");
    document.body.classList.remove("has-window-fullscreen");
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

async function exitFullscreen() {
  const wasFallbackFullscreen = fallbackFullscreen;
  if (wasFallbackFullscreen) {
    setFallbackFullscreen(false);
  }

  const exit = document.exitFullscreen ?? document.webkitExitFullscreen;
  if (getNativeFullscreenElement() && typeof exit === "function") {
    try {
      await Promise.resolve(exit.call(document));
    } catch (error) {
      logFullscreenFallback(error);
    }
  }

  syncFullscreenUi();
  if (wasFallbackFullscreen && state === "live") {
    elements.controlNote.textContent = getLiveControlNote();
  }
}

async function toggleFullscreen() {
  if (getNativeFullscreenElement() || fallbackFullscreen) {
    await exitFullscreen();
    return;
  }

  const request =
    elements.playerFrame.requestFullscreen ?? elements.playerFrame.webkitRequestFullscreen;
  const nativeFullscreenBlocked =
    document.fullscreenEnabled === false && document.webkitFullscreenEnabled !== true;

  if (!nativeFullscreenBlocked && typeof request === "function") {
    try {
      await Promise.resolve(request.call(elements.playerFrame));
      if (getNativeFullscreenElement() || (await waitForNativeFullscreen())) {
        syncFullscreenUi();
        return;
      }
    } catch (error) {
      logFullscreenFallback(error);
    }
  }

  setFallbackFullscreen(true);
  elements.controlNote.textContent = "Fensterfüllender Modus aktiv · mit × wieder schließen";
}

function setState(nextState) {
  state = nextState;
  elements.statusPill.dataset.state = nextState;
  elements.playerFrame.dataset.playerState = nextState;
  elements.playerFrame.setAttribute("aria-busy", String(nextState === "connecting"));

  const live = nextState === "live";
  elements.soundButton.disabled = !live;
  elements.fullscreenButton.disabled = !live;
  elements.reconnectButton.disabled = !isConfigured;

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
    elements.primaryActionLabel.textContent = "Bitte warten";
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
    elements.primaryActionLabel.textContent = "Noch nicht eingerichtet";
    elements.controlNote.textContent = "Keine Zugangsdaten oder Sender-Tokens auf dieser Seite";
    return;
  }

  elements.placeholderKicker.textContent = "STREAM OFFLINE";
  elements.placeholderTitle.textContent = "Die Quest sendet im Moment kein Bild.";
  elements.placeholderText.textContent = viewerStarted
    ? "Die Seite versucht es automatisch erneut. Du kannst auch sofort neu verbinden."
    : "Starte die reine Zuschauer-Verbindung, sobald der VR-Stream läuft.";
  elements.primaryActionLabel.textContent = viewerStarted ? "Jetzt neu verbinden" : "Stream ansehen";
  elements.controlNote.textContent = viewerStarted
    ? "Automatische Wiederverbindung ist aktiv"
    : "Nur ansehen · keine Kamera · kein Mikrofon";
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

  if (!viewerStarted || !navigator.onLine || document.hidden || !isConfigured) {
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
  setState("offline");

  if (reconnect) {
    scheduleReconnect();
  }
}

function markLive() {
  if (!player) {
    return;
  }

  clearTimer(connectionTimer);
  connectionTimer = null;
  clearTimer(disconnectTimer);
  disconnectTimer = null;
  confirmedMissingStats = 0;
  if (state !== "live") {
    setState("live");
    sendToPlayer({ mute: muted });
    sendToPlayer({ volume: 1 });
  }
}

function requestStats() {
  if (!player) {
    return;
  }

  sendToPlayer({ getStats: true, cib: "health" });
}

function connect({ mode = CONNECTION_MODE.direct } = {}) {
  if (!isConfigured || !navigator.onLine) {
    setState("offline");
    return;
  }

  viewerStarted = true;
  clearReconnectTimer();
  removePlayer();
  confirmedMissingStats = 0;
  connectionMode = mode;
  setState("connecting");

  player = document.createElement("iframe");
  player.title = "VR-Livestream";
  player.src = buildViewerUrl(STREAM_CONFIG, connectionMode);
  player.allow = "autoplay; fullscreen";
  player.referrerPolicy = "no-referrer";
  player.setAttribute("allowfullscreen", "");
  player.setAttribute(
    "sandbox",
    "allow-scripts allow-same-origin allow-forms allow-presentation",
  );

  player.addEventListener("load", () => {
    sendToPlayer({ mute: muted });
    sendToPlayer({ volume: 1 });
    requestStats();
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
    } else if (
      healthStatus === "missing" &&
      state === "live" &&
      confirmedMissingStats >= MAX_CONFIRMED_MISSING_STATS
    ) {
      markOffline();
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
    clearTimer(disconnectTimer);
    disconnectTimer = window.setTimeout(() => {
      if (state === "live") {
        markOffline();
      }
    }, DISCONNECT_GRACE_MS);
  }
});

elements.primaryAction.addEventListener("click", () => {
  connect({ mode: CONNECTION_MODE.direct });
});
elements.reconnectButton.addEventListener("click", () => {
  connect({ mode: CONNECTION_MODE.direct });
});

elements.soundButton.addEventListener("click", () => {
  muted = !muted;
  sendToPlayer({ mute: muted });
  updateSoundLabel();
});

elements.fullscreenButton.addEventListener("click", toggleFullscreen);
elements.exitFullscreenButton.addEventListener("click", exitFullscreen);

document.addEventListener("fullscreenchange", handleNativeFullscreenChange);
document.addEventListener("webkitfullscreenchange", handleNativeFullscreenChange);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && fallbackFullscreen) {
    exitFullscreen();
  }
});

window.addEventListener("offline", () => {
  if (viewerStarted) {
    markOffline({ reconnect: false });
    elements.controlNote.textContent = "Keine Internetverbindung";
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

setState("offline");
