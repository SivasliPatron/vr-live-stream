import { CONNECTION_MODE } from "./viewer-url.js";

const PREFERRED_MODE_KEY = "vr-live.connection-mode.v1";
const PREFERRED_MODE_TTL_MS = 24 * 60 * 60 * 1000;

function isConnectionMode(mode) {
  return mode === CONNECTION_MODE.direct || mode === CONNECTION_MODE.compatibility;
}

export function otherConnectionMode(mode) {
  return mode === CONNECTION_MODE.compatibility
    ? CONNECTION_MODE.direct
    : CONNECTION_MODE.compatibility;
}

export function getReconnectDelay(attempt, config = {}) {
  const base = Number.isFinite(config.reconnectDelayMs) && config.reconnectDelayMs > 0
    ? config.reconnectDelayMs
    : 3000;
  const maximum = Number.isFinite(config.maxReconnectDelayMs) && config.maxReconnectDelayMs > 0
    ? config.maxReconnectDelayMs
    : 20000;
  // Attempt zero is the first retry; cap the exponent before multiplying.
  const step = Number.isFinite(attempt) ? Math.max(0, Math.min(30, Math.floor(attempt))) : 0;
  return Math.min(maximum, base * 2 ** step);
}

export function getPreferredConnectionMode(storage, now = Date.now()) {
  try {
    const targetStorage = storage === undefined ? globalThis.localStorage : storage;
    const saved = JSON.parse(targetStorage.getItem(PREFERRED_MODE_KEY));
    if (
      saved &&
      !Array.isArray(saved) &&
      Object.keys(saved).every((key) => key === "mode" || key === "expiresAt") &&
      isConnectionMode(saved.mode) &&
      Number.isFinite(now) &&
      Number.isFinite(saved.expiresAt) &&
      saved.expiresAt > now &&
      saved.expiresAt <= now + PREFERRED_MODE_TTL_MS
    ) {
      return saved.mode;
    }
  } catch {
    // Browser privacy settings and unavailable storage must never block joining.
  }
  return CONNECTION_MODE.direct;
}

export function rememberConnectionMode(mode, storage, now = Date.now()) {
  if (!isConnectionMode(mode) || !Number.isFinite(now)) return;
  try {
    const targetStorage = storage === undefined ? globalThis.localStorage : storage;
    targetStorage.setItem(PREFERRED_MODE_KEY, JSON.stringify({
      mode,
      expiresAt: now + PREFERRED_MODE_TTL_MS,
    }));
  } catch {
    // Persisting a successful route is optional; access details are never stored.
  }
}
