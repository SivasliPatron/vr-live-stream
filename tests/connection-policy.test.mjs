import assert from "node:assert/strict";
import test from "node:test";
import {
  getPreferredConnectionMode,
  getReconnectDelay,
  otherConnectionMode,
  rememberConnectionMode,
} from "../docs/connection-policy.js";
import { STREAM_CONFIG } from "../docs/stream-config.js";
import { buildViewerUrl, CONNECTION_MODE } from "../docs/viewer-url.js";

const key = "vr-live.connection-mode.v1";
const day = 24 * 60 * 60 * 1000;
const now = 1700000000000;

function createStorage() {
  const values = new Map();
  return {
    values,
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => values.set(name, String(value)),
  };
}

test("Beide Verbindungswege haben einen jeweils anderen Rueckfall", () => {
  assert.equal(otherConnectionMode(CONNECTION_MODE.direct), CONNECTION_MODE.compatibility);
  assert.equal(otherConnectionMode(CONNECTION_MODE.compatibility), CONNECTION_MODE.direct);
});

test("Playerstart und Verbindung haben getrennte Zeitfenster; Wiederholungen eine begrenzte Pause", () => {
  assert.equal(STREAM_CONFIG.playerLoadTimeoutMs, 90_000);
  assert.equal(STREAM_CONFIG.connectTimeoutMs, 60_000);
  assert.deepEqual(
    [0, 1, 2, 3, 4, 100000].map((attempt) => getReconnectDelay(attempt, STREAM_CONFIG)),
    [3000, 6000, 12000, 20000, 20000, 20000],
  );
  assert.deepEqual(
    [0, 1, 2, 3].map((attempt) => getReconnectDelay(attempt, {
      reconnectDelayMs: 10, maxReconnectDelayMs: 50,
    })),
    [10, 20, 40, 50],
  );
  for (const attempt of [-1, NaN, Infinity, undefined]) {
    assert.equal(getReconnectDelay(attempt), 3000);
  }
  assert.equal(getReconnectDelay(0, { reconnectDelayMs: 25000, maxReconnectDelayMs: 20000 }), 20000);
});

test("Ein erfolgreicher Weg wird ohne Zugangsdaten fuer genau einen Tag gemerkt", () => {
  const storage = createStorage();
  assert.equal(getPreferredConnectionMode(storage, now), CONNECTION_MODE.direct);
  rememberConnectionMode(CONNECTION_MODE.compatibility, storage, now);
  assert.equal(storage.values.size, 1);
  assert.deepEqual(JSON.parse(storage.values.get(key)), {
    mode: CONNECTION_MODE.compatibility,
    expiresAt: now + day,
  });
  assert.equal(getPreferredConnectionMode(storage, now), CONNECTION_MODE.compatibility);
  assert.equal(getPreferredConnectionMode(storage, now + day - 1), CONNECTION_MODE.compatibility);
  assert.equal(getPreferredConnectionMode(storage, now + day), CONNECTION_MODE.direct);
  assert.equal(getPreferredConnectionMode(storage, now + day + 1), CONNECTION_MODE.direct);
  rememberConnectionMode(CONNECTION_MODE.direct, storage, now + 1);
  assert.equal(getPreferredConnectionMode(storage, now + 1), CONNECTION_MODE.direct);
});

test("Beschaedigte, fremde und abgelaufene Speicherwerte beginnen direkt", () => {
  const storage = createStorage();
  for (const value of [
    "{", "null", "false", "42", "[]", '"compatibility"',
    JSON.stringify({ mode: "unknown", expiresAt: now + day }),
    JSON.stringify({ mode: "compatibility" }),
    JSON.stringify({ mode: "compatibility", expiresAt: String(now + day) }),
    JSON.stringify({ mode: "compatibility", expiresAt: now }),
    JSON.stringify({ mode: "compatibility", expiresAt: now + day + 1 }),
    JSON.stringify({ mode: "compatibility", expiresAt: now + day, streamId: "unrelated" }),
  ]) {
    storage.setItem(key, value);
    assert.equal(getPreferredConnectionMode(storage, now), CONNECTION_MODE.direct);
  }
  const prior = storage.getItem(key);
  rememberConnectionMode("unknown", storage, now);
  rememberConnectionMode(CONNECTION_MODE.compatibility, storage, NaN);
  assert.equal(storage.getItem(key), prior);
});

test("Fehlender oder blockierter Browserspeicher verhindert keine Verbindung", () => {
  const blocked = {
    getItem() { throw new Error("Storage denied"); },
    setItem() { throw new Error("Storage denied"); },
  };
  for (const storage of [null, {}, blocked]) {
    assert.equal(getPreferredConnectionMode(storage, now), CONNECTION_MODE.direct);
    assert.doesNotThrow(() => rememberConnectionMode(CONNECTION_MODE.compatibility, storage, now));
  }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() { throw new Error("SecurityError"); },
    });
    assert.equal(getPreferredConnectionMode(), CONNECTION_MODE.direct);
    assert.doesNotThrow(() => rememberConnectionMode(CONNECTION_MODE.compatibility));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
});

test("Schnellere Wiederherstellung behaelt Tonwahl und beide Verbindungswege", () => {
  const config = { viewerBaseUrl: "https://vdo.ninja/", streamId: "test-stream", audienceToken: "test-audience" };
  for (const mode of Object.values(CONNECTION_MODE)) {
    for (const muted of [true, false]) {
      const url = new URL(buildViewerUrl(config, mode, { accessCode: "1234", muted }));
      assert.equal(url.searchParams.get("retry"), "10");
      assert.equal(url.searchParams.get("retrytimeout"), "5000");
      assert.equal(url.searchParams.get("autorecover"), "1");
      assert.equal(url.searchParams.get("autorelay"), "1");
      assert.equal(url.searchParams.get("p2pfailtimeout"), "7000");
      assert.equal(url.searchParams.get("peerrecoversteps"), "5");
      assert.equal(url.searchParams.get("pendingicettl"), "20000");
      assert.equal(url.searchParams.get("mutespeaker"), muted ? "1" : "0");
      assert.equal(url.searchParams.has("relay"), mode === CONNECTION_MODE.compatibility);
      assert.equal(url.searchParams.has("password"), false);
      assert.equal(url.hash, "#password=1234");
    }
  }
});
