import assert from "node:assert/strict";
import test from "node:test";
import {
  getHealthStatsStatus,
  getTargetVideoStats,
  hasTargetInboundStream,
  isSameStreamId,
  isTargetVideoEvent,
  nextConfirmedMissingCount,
} from "../docs/player-health.js";
import { STREAM_CONFIG } from "../docs/stream-config.js";
import { buildViewerUrl, CONNECTION_MODE } from "../docs/viewer-url.js";

const target = "vr-regression-stream";

test("Videofortschritt liest VDO-Zaehler aus allen unterstuetzten Health-Formaten", () => {
  const stream = {
    _bytesReceived_video: 2048,
    videoTrack: { _type: "video", _framesDecoded: 12, _last_bytes: 1024 },
    audioTrack: { _type: "audio", _framesDecoded: 99, _last_bytes: 8192 },
  };
  for (const stats of [
    { inbound: { [target]: stream } },
    { inbound_stats: { [target]: stream } },
    { inbound_stats: [{ streamID: target, ...stream }] },
    { inbound: { peer1: { streamId: target, ...stream } } },
    { inbound: null, inbound_stats: { [target]: stream } },
  ]) {
    for (const reply of [stats, { stats }, { value: { stats } }, { value: stats }]) {
      assert.deepEqual(getTargetVideoStats(reply, target), {
        framesDecoded: 12, bytesReceived: 2048,
      });
    }
  }
});

test("Videofortschritt akzeptiert Null und Video-Tracks ohne globale Zaehler", () => {
  const samples = [
    [{ _bytesReceived_video: 0 }, { framesDecoded: null, bytesReceived: 0 }],
    [{ track: { _type: "video", _framesDecoded: 0 } }, { framesDecoded: 0, bytesReceived: null }],
    [{ track: { type: "Video Stream", _last_bytes: 123 } }, { framesDecoded: null, bytesReceived: 123 }],
    [{
      first: { _type: "video", _framesDecoded: 10, _last_bytes: 500 },
      second: { _type: "video", _framesDecoded: 20, _last_bytes: 700 },
    }, { framesDecoded: 30, bytesReceived: 1200 }],
  ];
  for (const [stream, expected] of samples) {
    assert.deepEqual(getTargetVideoStats({ inbound: { [target]: stream } }, target), expected);
  }
});

test("Leere Metadaten, Audio und Transportdaten beweisen keinen Videoempfang", () => {
  for (const stream of [
    {},
    { streamID: target },
    { _bytesReceived_audio: 12345 },
    { framesDecoded: 20, bytesReceived: 12345 },
    { "Peer-to-Peer_Connection": { _bytesReceived: 12345 } },
    { audio: { _type: "audio", _last_bytes: 12345, _framesDecoded: 20 } },
    { untyped: { _last_bytes: 12345, _framesDecoded: 20 } },
    { contradictory: { _type: "audio", type: "Video Stream", _last_bytes: 12345 } },
    { track: { _type: "video", FPS: 60, Bitrate_in_kbps: 6000 } },
  ]) {
    assert.equal(getTargetVideoStats({ inbound: { [target]: stream } }, target), null);
  }
});

test("VDO-Videodimensionen erkennen Tracks ohne veraltetes mediaType-Feld", () => {
  // processStats copies these fields before checking RTCStats.mediaType.
  // This covers browsers that supply kind, while VDO has not assigned _type.
  const stream = {
    video: { _frameWidth: 1280, _frameHeight: 720, _last_bytes: 4096 },
    audio: { _last_bytes: 500000 },
    "Peer-to-Peer_Connection": { _bytesReceived: 600000 },
  };
  assert.deepEqual(getTargetVideoStats({ inbound: { [target]: stream } }, target), {
    framesDecoded: null, bytesReceived: 4096,
  });
  assert.deepEqual(getTargetVideoStats({ inbound: { [target]: {
    video: { type: "Video Track", _last_bytes: 512 },
  } } }, target), { framesDecoded: null, bytesReceived: 512 });

  for (const video of [
    { _frameWidth: 1280 },
    { _frameHeight: 720 },
    { _frameWidth: 0, _frameHeight: 720 },
    { _frameWidth: "1280", _frameHeight: 720 },
    { _frameWidth: Infinity, _frameHeight: 720 },
    { _type: "audio", _frameWidth: 1280, _frameHeight: 720 },
    { type: "Audio Stream", _frameWidth: 1280, _frameHeight: 720 },
    { _type: "unknown", _frameWidth: 1280, _frameHeight: 720 },
  ]) {
    assert.equal(getTargetVideoStats({ inbound: { [target]: {
      video: { ...video, _last_bytes: 4096 },
    } } }, target), null);
  }
});

test("Videofortschritt ignoriert defekte Zaehler und fremde Stream-IDs", () => {
  for (const invalid of [undefined, null, false, -1, NaN, Infinity, "123", {}, []]) {
    const stream = {
      _bytesReceived_video: invalid,
      video: { _type: "video", _last_bytes: invalid, _framesDecoded: invalid },
    };
    assert.equal(getTargetVideoStats({ inbound: { [target]: stream } }, target), null);
  }
  for (const stats of [
    {}, { inbound: null }, { inbound: { [target]: null } },
    { inbound: { other: { _bytesReceived_video: 100 } } },
    { inbound: { [target]: { streamID: "other", _bytesReceived_video: 100 } } },
    { inbound_stats: [{ _bytesReceived_video: 100 }] },
  ]) {
    assert.equal(getTargetVideoStats(stats, target), null);
  }
  assert.equal(getTargetVideoStats({ inbound: { "": { _bytesReceived_video: 100 } } }, ""), null);
});

test("unvollständige und defekte Health-Antworten bestätigen keinen Ausfall", () => {
  for (const stats of [
    {},
    { error: "stats unavailable" },
    { total_inbound_connections: 0 },
    { inbound: null },
    { inbound: false },
    { inbound: "unavailable" },
    { inbound: { [target]: null } },
    { inbound_stats: [null] },
    { inbound: new Map() },
  ]) {
    const status = getHealthStatsStatus({ cib: "health", stats }, target);
    assert.equal(status, "malformed");
    assert.equal(nextConfirmedMissingCount(24, status), 24);
  }
});

test("Health-Antworten erkennen aktuelle und ältere gültige Inbound-Formate", () => {
  for (const stats of [
    { inbound: { [target]: {} } },
    { inbound_stats: { [target]: {} } },
    { inbound_stats: [{ streamID: target }] },
    { inbound: { peer1: { streamId: target } } },
    { inbound: null, inbound_stats: { [target]: {} } },
  ]) {
    for (const reply of [{ stats }, { value: { stats } }, { value: stats }]) {
      assert.equal(getHealthStatsStatus({ cib: "health", ...reply }, target), "present");
    }
  }

  for (const stats of [{ inbound: {} }, { inbound_stats: [] }]) {
    assert.equal(getHealthStatsStatus({ cib: "health", stats }, target), "missing");
  }
});

test("leere, widersprüchliche oder defekte Stream-IDs bestätigen keinen Live-Stream", () => {
  assert.equal(isSameStreamId("", ""), false);
  assert.equal(hasTargetInboundStream({ inbound: { [target]: null } }, target), false);
  assert.equal(
    hasTargetInboundStream({ inbound: { [target]: { streamID: "other" } } }, target),
    false,
  );
  for (const value of [false, "false"]) {
    assert.equal(
      isTargetVideoEvent({ action: "new-video-track-added", streamID: target, value }, target),
      false,
    );
  }
  for (const value of [undefined, true, "true"]) {
    assert.equal(
      isTargetVideoEvent({ action: "new-video-track-added", streamID: target, value }, target),
      true,
    );
  }
});

test("Viewer-URL entfernt veraltete Einladungseinstellungen und Query-Passwörter", () => {
  const staleUrl = new URL("https://vdo.ninja/");
  staleUrl.search = new URLSearchParams({
    password: "1111", label: "old", prompt: "", relay: "", push: "old",
  }).toString();
  staleUrl.hash = new URLSearchParams({ password: "2222", label: "old" }).toString();
  const config = {
    ...STREAM_CONFIG,
    viewerBaseUrl: staleUrl.toString(),
  };
  const url = new URL(buildViewerUrl(config, CONNECTION_MODE.direct, { accessCode: "0042" }));
  assert.equal(new URLSearchParams(url.hash.slice(1)).get("password"), "0042");
  assert.equal(new URLSearchParams(url.hash.slice(1)).size, 1);
  assert.equal(url.searchParams.get("view"), STREAM_CONFIG.streamId);
  for (const name of ["password", "label", "prompt", "relay", "push"]) {
    assert.equal(url.searchParams.has(name), false);
  }

  const relayUrl = new URL(buildViewerUrl(config, CONNECTION_MODE.compatibility, { accessCode: "0042" }));
  assert.equal(relayUrl.searchParams.has("relay"), true);
  assert.equal(relayUrl.hash, url.hash);

  for (const accessCode of ["", "123", "12345", "12a4", "１２３４", "1234\n", 1234, null, ["1234"]]) {
    const invalidUrl = new URL(buildViewerUrl(config, CONNECTION_MODE.direct, { accessCode }));
    assert.equal(invalidUrl.hash, "");
    assert.equal(invalidUrl.searchParams.has("password"), false);
  }
});
