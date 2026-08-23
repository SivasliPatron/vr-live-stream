import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  getHealthStatsStatus,
  hasTargetInboundStream,
  isSameStreamId,
  isTargetVideoEvent,
  nextConfirmedMissingCount,
  normalizeConnectionState,
} from "../docs/player-health.js";
import { STREAM_CONFIG } from "../docs/stream-config.js";
import { buildViewerUrl, CONNECTION_MODE } from "../docs/viewer-url.js";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("GitHub-Pages-Dateien und Unterpfade sind vollständig", () => {
  const html = read("docs/index.html");

  assert.equal(existsSync(resolve(root, "docs/.nojekyll")), true);
  assert.equal(existsSync(resolve(root, "docs/viewer-url.js")), true);
  assert.match(html, /href="\.\/styles\.css\?v=[^"]+"/);
  assert.match(html, /src="\.\/app\.js\?v=[^"]+"/);
  assert.doesNotMatch(html, /(?:href|src)="\/(?!\/)/);
  assert.match(html, /frame-src https:\/\/vdo\.ninja/);
  assert.match(html, /content="https:\/\/sivaslipatron\.github\.io\/vr-live-stream\/"/);
});

test("Viewer hat nur die vorgesehenen Zustände und Bedienelemente", () => {
  const html = read("docs/index.html");
  const app = read("docs/app.js");
  const viewerUrl = read("docs/viewer-url.js");

  for (const label of ["OFFLINE", "VERBINDEN", "LIVE", "Neu verbinden", "Vollbild"]) {
    assert.match(`${html}\n${app}`, new RegExp(label, "i"));
  }

  assert.match(viewerUrl, /searchParams\.set\("view"/);
  assert.match(viewerUrl, /searchParams\.set\("audience"/);
  assert.match(viewerUrl, /searchParams\.set\("cleanoutput"/);
  assert.match(viewerUrl, /searchParams\.set\("screensharestereo"/);
  assert.match(viewerUrl, /searchParams\.set\("retry"/);
  assert.match(app, /scheduleReconnect/);
  assert.match(app, /event\.origin !== VDO_ORIGIN/);
  assert.match(app, /event\.source !== player\?\.contentWindow/);
});

test("schwierige Netze erhalten automatische Wiederherstellung und Relay-Fallback", () => {
  const directUrl = new URL(buildViewerUrl(STREAM_CONFIG, CONNECTION_MODE.direct));
  const compatibilityUrl = new URL(
    buildViewerUrl(STREAM_CONFIG, CONNECTION_MODE.compatibility),
  );
  const app = read("docs/app.js");

  assert.equal(directUrl.searchParams.get("view"), STREAM_CONFIG.streamId);
  assert.equal(directUrl.searchParams.get("audience"), STREAM_CONFIG.audienceToken);
  assert.equal(directUrl.searchParams.get("autorecover"), "1");
  assert.equal(directUrl.searchParams.get("autorelay"), "1");
  assert.equal(directUrl.searchParams.get("p2pfailtimeout"), "12000");
  assert.equal(directUrl.searchParams.get("pendingicettl"), "20000");
  assert.equal(directUrl.searchParams.has("relay"), false);
  assert.equal(compatibilityUrl.searchParams.has("relay"), true);
  assert.ok(STREAM_CONFIG.connectTimeoutMs >= 60_000);
  assert.match(app, /MAX_CONFIRMED_MISSING_STATS = 25/);
  assert.match(app, /DISCONNECT_GRACE_MS = 90_000/);
  assert.match(app, /connect\(\{ mode: CONNECTION_MODE\.compatibility \}\)/);
});

test("Vollbild hat einen browserunabhängigen Rückfallmodus", () => {
  const html = read("docs/index.html");
  const app = read("docs/app.js");
  const css = read("docs/styles.css");

  assert.match(html, /id="exitFullscreenButton"/);
  assert.match(app, /requestFullscreen/);
  assert.match(app, /webkitRequestFullscreen/);
  assert.match(app, /setFallbackFullscreen\(true\)/);
  assert.match(app, /event\.key === "Escape"/);
  assert.match(app, /exitFullscreenButton : elements\.fullscreenButton/);
  assert.match(app, /FULLSCREEN_CHANGE_TIMEOUT_MS/);
  assert.match(css, /\.player-frame\.is-window-fullscreen/);
  assert.match(css, /body\.has-window-fullscreen/);
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /outline: 2px solid var\(--text\)/);
});

test("eingebetteter Player erhält keine Kamera- oder Mikrofonrechte", () => {
  const app = read("docs/app.js");
  const permissionLine = app.match(/player\.allow = "([^"]+)"/);

  assert.ok(permissionLine, "Iframe-Berechtigungen fehlen");
  assert.equal(permissionLine[1], "autoplay; fullscreen");
  assert.doesNotMatch(permissionLine[1], /camera|microphone|display-capture/i);
  assert.match(app, /sandbox/);
});

test("nur der konfigurierte Videostream kann den Live-Zustand auslösen", () => {
  const target = "vr-TestStream";

  assert.equal(isSameStreamId("VR-teststream", target), false);
  assert.equal(isSameStreamId(target, target), true);
  assert.equal(
    isTargetVideoEvent(
      { action: "new-video-track-added", value: true, streamID: target },
      target,
    ),
    true,
  );
  assert.equal(
    isTargetVideoEvent(
      { action: "new-video-track-added", value: true, streamID: "anderer-stream" },
      target,
    ),
    false,
  );
  assert.equal(
    isTargetVideoEvent(
      { action: "push-connection", value: true, streamID: target },
      target,
    ),
    false,
  );
  assert.equal(
    hasTargetInboundStream({ stats: { inbound: { [target]: {} } } }, target),
    true,
  );
  assert.equal(
    hasTargetInboundStream(
      { stats: { inbound: { "anderer-stream": {} }, total_inbound_connections: 1 } },
      target,
    ),
    false,
  );
  assert.equal(
    hasTargetInboundStream(
      { inbound_stats: [{ streamID: target }] },
      target,
    ),
    true,
  );
});

test("Health-Check zählt nur bestätigte Antworten ohne Zielstream", () => {
  const target = "vr-AbCd1234";
  let confirmedMissing = 0;

  const noReply = getHealthStatsStatus({ action: "unrelated" }, target);
  const malformedReply = getHealthStatsStatus({ cib: "health", stats: null }, target);
  const missingReply = getHealthStatsStatus(
    { cib: "health", stats: { inbound: {} } },
    target,
  );
  const presentReply = getHealthStatsStatus(
    { cib: "health", stats: { inbound: { [target]: {} } } },
    target,
  );

  confirmedMissing = nextConfirmedMissingCount(confirmedMissing, noReply);
  confirmedMissing = nextConfirmedMissingCount(confirmedMissing, malformedReply);
  assert.equal(confirmedMissing, 0, "Schweigen oder kaputte Antworten zählen nicht");

  confirmedMissing = nextConfirmedMissingCount(confirmedMissing, missingReply);
  assert.equal(confirmedMissing, 1);
  confirmedMissing = nextConfirmedMissingCount(confirmedMissing, presentReply);
  assert.equal(confirmedMissing, 0, "der Zielstream setzt den Zähler zurück");

  assert.equal(normalizeConnectionState(true), true);
  assert.equal(normalizeConnectionState("true"), true);
  assert.equal(normalizeConnectionState(false), false);
  assert.equal(normalizeConnectionState("false"), false);
  assert.equal(normalizeConnectionState("unknown"), null);
});

test("öffentliche Stream-Konfiguration ist vollständig", () => {
  const config = read("docs/stream-config.js");

  assert.doesNotMatch(config, /PENDING_STREAM_ID/);
  assert.doesNotMatch(config, /PENDING_AUDIENCE_TOKEN/);
  assert.match(config, /viewerBaseUrl: "https:\/\/vdo\.ninja\/"/);
});

test("keine Sender-URL und kein Publisher-Token können committed werden", () => {
  const listed = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);

  assert.ok(listed.length > 0, "Keine öffentlichen Projektdateien gefunden");
  assert.equal(listed.some((path) => path.startsWith(".private/")), false);

  const publisherSecretPath = resolve(root, ".private/stream-secrets.json");
  const publisherToken = existsSync(publisherSecretPath)
    ? JSON.parse(readFileSync(publisherSecretPath, "utf8")).publisherToken
    : null;

  for (const relativePath of listed) {
    const body = readFileSync(resolve(root, relativePath), "utf8");
    assert.doesNotMatch(body, /[?&]push(?:=|%3d)/i, `${relativePath} enthält eine Sender-URL`);
    if (publisherToken) {
      assert.equal(body.includes(publisherToken), false, `${relativePath} enthält den Publisher-Token`);
    }
  }
});
