import { STREAM_CONFIG } from "./stream-config.js";
import {
  hasTargetInboundStream,
  isSameStreamId,
  isTargetVideoEvent,
} from "./player-health.js";

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
  reconnectButton: document.querySelector("#reconnectButton"),
  controlNote: document.querySelector("#controlNote"),
};

const VDO_ORIGIN = new URL(STREAM_CONFIG.viewerBaseUrl).origin;
const STATS_INTERVAL_MS = 4_000;
const MAX_MISSED_STATS = 5;
const DISCONNECT_GRACE_MS = 16_000;

let player = null;
let state = "offline";
let viewerStarted = false;
let muted = false;
let connectionTimer = null;
let disconnectTimer = null;
let reconnectTimer = null;
let statsTimer = null;
let missedStats = 0;

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
    elements.controlNote.textContent = "Direkte Zuschauer-Verbindung · keine Kamera · kein Mikrofon";
    updateSoundLabel();
    return;
  }

  if (nextState === "connecting") {
    elements.statusLabel.textContent = "VERBINDEN";
    elements.placeholderKicker.textContent = "VERBINDUNG WIRD AUFGEBAUT";
    elements.placeholderTitle.textContent = "Die Quest wird gesucht …";
    elements.placeholderText.textContent = "Das dauert normalerweise nur wenige Sekunden.";
    elements.primaryActionLabel.textContent = "Bitte warten";
    elements.primaryAction.disabled = true;
    elements.controlNote.textContent = "Sichere Verbindung zu VDO.Ninja wird hergestellt";
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

function buildViewerUrl() {
  const url = new URL(STREAM_CONFIG.viewerBaseUrl);
  url.searchParams.set("view", STREAM_CONFIG.streamId);
  url.searchParams.set("audience", STREAM_CONFIG.audienceToken);
  url.searchParams.set("cleanoutput", "");
  url.searchParams.set("screensharestereo", "");
  url.searchParams.set("retry", "15");
  url.searchParams.set("retrytimeout", "5000");
  return url.toString();
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
    connect();
  }, STREAM_CONFIG.reconnectDelayMs);
}

function markOffline({ reconnect = true } = {}) {
  removePlayer();
  missedStats = 0;
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
  missedStats = 0;
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

  if (state === "live") {
    missedStats += 1;
    if (missedStats >= MAX_MISSED_STATS) {
      markOffline();
      return;
    }
  }

  sendToPlayer({ getStats: true, cib: "health" });
}

function connect() {
  if (!isConfigured || !navigator.onLine) {
    setState("offline");
    return;
  }

  viewerStarted = true;
  clearReconnectTimer();
  removePlayer();
  missedStats = 0;
  setState("connecting");

  player = document.createElement("iframe");
  player.title = "VR-Livestream";
  player.src = buildViewerUrl();
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
    if (state === "connecting") {
      markOffline();
    }
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

  if (
    isTargetVideoEvent(message, STREAM_CONFIG.streamId) ||
    hasTargetInboundStream(message, STREAM_CONFIG.streamId)
  ) {
    missedStats = 0;
    markLive();
    return;
  }

  const isTargetConnectionEvent =
    message.action === "push-connection" &&
    isSameStreamId(message.streamID ?? message.streamId, STREAM_CONFIG.streamId);

  if (isTargetConnectionEvent && message.value === true) {
    clearTimer(disconnectTimer);
    disconnectTimer = null;
    return;
  }

  if (isTargetConnectionEvent && message.value === false && state === "live") {
    clearTimer(disconnectTimer);
    disconnectTimer = window.setTimeout(() => {
      if (state === "live") {
        markOffline();
      }
    }, DISCONNECT_GRACE_MS);
  }
});

elements.primaryAction.addEventListener("click", connect);
elements.reconnectButton.addEventListener("click", connect);

elements.soundButton.addEventListener("click", () => {
  muted = !muted;
  sendToPlayer({ mute: muted });
  updateSoundLabel();
});

elements.fullscreenButton.addEventListener("click", async () => {
  try {
    await elements.playerFrame.requestFullscreen();
  } catch {
    elements.controlNote.textContent = "Vollbild wurde vom Browser blockiert";
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
    connect();
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && viewerStarted && state === "offline") {
    connect();
  }
});

window.addEventListener("beforeunload", () => {
  clearReconnectTimer();
  removePlayer();
});

setState("offline");
