import assert from "node:assert/strict";
import test from "node:test";
import { createVideoProgressMonitor } from "../docs/video-progress.js";
import {
  buildViewerUrl,
  CONNECTION_MODE,
  isTrustedViewerBaseUrl,
} from "../docs/viewer-url.js";

const frames = (count, bytesReceived = 1000) => ({ framesDecoded: count, bytesReceived });
const bytes = (count) => ({ framesDecoded: null, bytesReceived: count });

function observeThrough(monitor, sample, start, end, step = 2000) {
  let result;
  for (let now = start; now <= end; now += step) result = monitor.observe(sample, now);
  return result;
}

test("Positive decodierte Frames bestaetigen Fortschritt; Null nicht", () => {
  const monitor = createVideoProgressMonitor();
  assert.deepEqual(monitor.observe(frames(0, 5000), 0), { progressed: false, status: "waiting" });
  assert.deepEqual(monitor.observe(frames(0, 10000), 2000), { progressed: false, status: "waiting" });
  assert.deepEqual(monitor.observe(frames(1, 10000), 4000), { progressed: true, status: "progressing" });
  assert.deepEqual(monitor.observe(frames(2, 10000), 6000), { progressed: true, status: "progressing" });
});

test("Ein erster positiver Videozaehler wird als Empfang erkannt", () => {
  for (const sample of [frames(1), bytes(1)]) {
    const monitor = createVideoProgressMonitor();
    assert.deepEqual(monitor.observe(sample, 1000), { progressed: true, status: "progressing" });
  }
});

test("Wachsende Videobytes verdecken keine eingefrorenen decodierten Frames", () => {
  const monitor = createVideoProgressMonitor();
  assert.equal(monitor.observe(frames(10, 1000), 0).progressed, true);
  for (let now = 2000; now <= 10000; now += 2000) {
    assert.deepEqual(monitor.observe(frames(10, 1000 + now), now), { progressed: false, status: "waiting" });
  }
  assert.deepEqual(monitor.observe(frames(10, 20000), 12000), { progressed: false, status: "recovering" });
  assert.equal(observeThrough(monitor, frames(10, 30000), 14000, 28000).status, "recovering");
  assert.deepEqual(monitor.observe(frames(10, 40000), 30000), { progressed: false, status: "stalled" });
});

test("Warnung beginnt exakt nach 12 Sekunden, Neuverbindung nach 30 Sekunden", () => {
  const monitor = createVideoProgressMonitor();
  monitor.observe(frames(10), 0);
  observeThrough(monitor, frames(10), 2000, 10000);
  assert.equal(monitor.observe(frames(10), 11999).status, "waiting");
  assert.equal(monitor.observe(frames(10), 12000).status, "recovering");
  observeThrough(monitor, frames(10), 14000, 28000);
  assert.equal(monitor.observe(frames(10), 29999).status, "recovering");
  assert.equal(monitor.observe(frames(10), 30000).status, "stalled");
  assert.equal(monitor.observe(frames(10), 32000).status, "stalled");
});

test("Videobytes dienen nur ohne bekannte Framezaehler als Rueckfall", () => {
  const monitor = createVideoProgressMonitor();
  assert.equal(monitor.observe(bytes(100), 0).progressed, true);
  assert.equal(monitor.observe(bytes(200), 2000).progressed, true);
  assert.equal(observeThrough(monitor, bytes(200), 4000, 12000).status, "waiting");
  assert.equal(monitor.observe(bytes(200), 14000).status, "recovering");
  assert.equal(observeThrough(monitor, bytes(200), 16000, 32000).status, "stalled");
  assert.deepEqual(monitor.observe(bytes(201), 34000), { progressed: true, status: "progressing" });
});

test("Gelegentlich neue Frames setzen die Stagnationsfrist zurueck", () => {
  const monitor = createVideoProgressMonitor();
  for (let now = 0; now <= 100000; now += 2000) {
    const result = monitor.observe(frames(1 + Math.floor(now / 10000)), now);
    assert.ok(["waiting", "progressing"].includes(result.status), `Kein Ausfall bei ${now} ms`);
  }
});

test("Fortschritt beendet Warnung und einen bestaetigten Stillstand", () => {
  const monitor = createVideoProgressMonitor();
  monitor.observe(frames(10), 0);
  assert.equal(observeThrough(monitor, frames(10), 2000, 12000).status, "recovering");
  assert.deepEqual(monitor.observe(frames(11), 14000), { progressed: true, status: "progressing" });
  assert.equal(observeThrough(monitor, frames(11), 16000, 24000).status, "waiting");
  assert.equal(monitor.observe(frames(11), 26000).status, "recovering");
  assert.equal(observeThrough(monitor, frames(11), 28000, 44000).status, "stalled");
  assert.deepEqual(monitor.observe(frames(12), 46000), { progressed: true, status: "progressing" });
});

test("Zaehlerreset ist eine neue Basis und noch kein Fortschritt", () => {
  for (const sample of [frames, bytes]) {
    const monitor = createVideoProgressMonitor();
    monitor.observe(sample(1000), 0);
    assert.equal(observeThrough(monitor, sample(1000), 2000, 30000).status, "stalled");
    assert.deepEqual(monitor.observe(sample(5), 32000), { progressed: false, status: "waiting" });
    assert.deepEqual(monitor.observe(sample(5), 34000), { progressed: false, status: "waiting" });
    assert.deepEqual(monitor.observe(sample(6), 36000), { progressed: true, status: "progressing" });
  }
});

test("Wechsel von Bytes auf Frames vergleicht keine verschiedenen Einheiten", () => {
  const monitor = createVideoProgressMonitor();
  monitor.observe(bytes(1000), 0);
  assert.equal(observeThrough(monitor, bytes(1000), 2000, 30000).status, "stalled");
  assert.deepEqual(monitor.observe(frames(2000, 1000), 32000), { progressed: false, status: "waiting" });
  assert.deepEqual(monitor.observe(frames(2000, 99999), 34000), { progressed: false, status: "waiting" });
  assert.deepEqual(monitor.observe(frames(2001, 99999), 36000), { progressed: true, status: "progressing" });
});

test("Voruebergehend fehlende Frames werden nach Decodererkennung nicht durch Bytes ersetzt", () => {
  const monitor = createVideoProgressMonitor();
  monitor.observe(frames(10), 0);
  assert.equal(observeThrough(monitor, frames(10), 2000, 12000).status, "recovering");
  assert.deepEqual(monitor.observe(bytes(90000), 14000), { progressed: false, status: "unknown" });
  assert.deepEqual(monitor.observe(bytes(100000), 60000), { progressed: false, status: "unknown" });
  assert.deepEqual(monitor.observe(frames(10, 110000), 62000), { progressed: false, status: "waiting" });
  assert.equal(monitor.observe(frames(11, 120000), 64000).progressed, true);
});

test("Defekte oder fachfremde Stichproben bestaetigen weder Fortschritt noch Stillstand", () => {
  for (const sample of [
    null, undefined, false, {},
    { framesDecoded: NaN, bytesReceived: Infinity },
    { framesDecoded: -1, bytesReceived: -2 },
    { framesDecoded: "20", bytesReceived: "1000" },
    { _bytesReceived_audio: 10000, transportBytes: 20000 },
  ]) {
    const monitor = createVideoProgressMonitor();
    monitor.observe(frames(10), 0);
    observeThrough(monitor, frames(10), 2000, 12000);
    assert.deepEqual(monitor.observe(sample, 14000), { progressed: false, status: "unknown" });
    assert.deepEqual(monitor.observe(frames(10), 16000), { progressed: false, status: "waiting" });
  }
});

test("Unbekannte Zeitwerte unterbrechen die Messreihe", () => {
  for (const now of [NaN, Infinity, undefined, "14000"]) {
    const monitor = createVideoProgressMonitor();
    monitor.observe(frames(10), 0);
    observeThrough(monitor, frames(10), 2000, 12000);
    assert.deepEqual(monitor.observe(frames(10), now), { progressed: false, status: "unknown" });
    assert.equal(monitor.observe(frames(10), 16000).status, "waiting");
  }
});

test("Lange Statistikpausen loesen bei Rueckkehr keinen sofortigen Neustart aus", () => {
  const monitor = createVideoProgressMonitor();
  monitor.observe(frames(10), 0);
  assert.equal(observeThrough(monitor, frames(10), 2000, 12000).status, "recovering");
  assert.deepEqual(monitor.observe(frames(10), 72000), { progressed: false, status: "waiting" });
  assert.equal(observeThrough(monitor, frames(10), 74000, 82000).status, "waiting");
  assert.equal(monitor.observe(frames(10), 84000).status, "recovering");
});

test("Eine Luecke von sechs Sekunden ist erlaubt, mehr unterbricht die Messreihe", () => {
  const continuous = createVideoProgressMonitor();
  continuous.observe(frames(10), 0);
  assert.equal(continuous.observe(frames(10), 6000).status, "waiting");
  assert.equal(continuous.observe(frames(10), 12000).status, "recovering");
  const interrupted = createVideoProgressMonitor();
  interrupted.observe(frames(10), 0);
  interrupted.observe(frames(10), 6000);
  assert.equal(interrupted.observe(frames(10), 12001).status, "waiting");
});

test("Rueckwaerts laufende Zeit erzeugt keinen negativen oder sofortigen Ausfall", () => {
  const monitor = createVideoProgressMonitor();
  monitor.observe(frames(10), 10000);
  observeThrough(monitor, frames(10), 12000, 22000);
  assert.deepEqual(monitor.observe(frames(10), 1000), { progressed: false, status: "waiting" });
  assert.equal(observeThrough(monitor, frames(10), 3000, 11000).status, "waiting");
  assert.equal(monitor.observe(frames(10), 13000).status, "recovering");
});

test("Suspend fuer Hintergrundtabs verwirft die Frist, behaelt aber die Vergleichsbasis", () => {
  const monitor = createVideoProgressMonitor();
  monitor.observe(frames(10), 0);
  assert.equal(observeThrough(monitor, frames(10), 2000, 30000).status, "stalled");
  monitor.suspend();
  assert.deepEqual(monitor.observe(frames(10), 90000), { progressed: false, status: "waiting" });
  assert.equal(observeThrough(monitor, frames(10), 92000, 100000).status, "waiting");
  assert.equal(monitor.observe(frames(10), 102000).status, "recovering");
  monitor.suspend();
  assert.equal(monitor.observe(bytes(500000), 104000).status, "unknown", "Suspend vergisst Decodererkennung nicht");
});

test("Reset trennt neue Iframes vollstaendig von alten Messwerten", () => {
  const monitor = createVideoProgressMonitor();
  monitor.observe(frames(1000), 0);
  observeThrough(monitor, frames(1000), 2000, 30000);
  monitor.reset();
  assert.deepEqual(monitor.observe(bytes(1), 32000), { progressed: true, status: "progressing" });
  monitor.reset();
  assert.deepEqual(monitor.observe(frames(0), 34000), { progressed: false, status: "waiting" });
  assert.equal(monitor.observe(frames(1), 36000).progressed, true);
});

test("Angepasste Fristen funktionieren ohne Abhaengigkeit von der realen Uhr", () => {
  const monitor = createVideoProgressMonitor({ warningMs: 4, reconnectMs: 10, maxSampleGapMs: 3 });
  monitor.observe(bytes(10), 0);
  assert.equal(observeThrough(monitor, bytes(10), 1, 3, 1).status, "waiting");
  assert.equal(monitor.observe(bytes(10), 4).status, "recovering");
  assert.equal(observeThrough(monitor, bytes(10), 5, 9, 1).status, "recovering");
  assert.equal(monitor.observe(bytes(10), 10).status, "stalled");
});

test("Nur die beiden exakt freigegebenen Viewer-Basisadressen sind erlaubt", () => {
  for (const base of ["https://vdo.ninja/", "https://steveseguin.github.io/vdo.ninja/"]) {
    assert.equal(isTrustedViewerBaseUrl(base), true);
  }
  for (const base of [
    undefined, null, "", "https://vdo.ninja", "http://vdo.ninja/",
    "https://vdo.ninja.example/", "https://vdo.ninja@evil.example/",
    "https://steveseguin.github.io/other/", "https://other.github.io/vdo.ninja/",
    "https://vdo.ninja/?view=old", "https://vdo.ninja/#password=1234",
    "https://vdo.ninja/path/", "javascript:alert(1)",
  ]) assert.equal(isTrustedViewerBaseUrl(base), false);
});

test("Mirror behaelt Sender-Salt, Codefragment, Zuschauerrolle und Eltern-Origin", () => {
  for (const viewerBaseUrl of ["https://vdo.ninja/", "https://steveseguin.github.io/vdo.ninja/"]) {
    for (const mode of Object.values(CONNECTION_MODE)) {
      for (const muted of [false, true]) {
        const config = { viewerBaseUrl, streamId: "synthetic-stream", audienceToken: "synthetic-audience" };
        const url = new URL(buildViewerUrl(config, mode, {
          accessCode: "0042", muted, parentOrigin: "https://sivaslipatron.github.io/vr-live-stream/",
        }));
        assert.equal(url.searchParams.get("view"), config.streamId);
        assert.equal(url.searchParams.get("audience"), config.audienceToken);
        assert.equal(url.searchParams.get("salt"), "vdo.ninja");
        assert.equal(url.searchParams.get("iframetarget"), "https://sivaslipatron.github.io");
        assert.equal(url.searchParams.get("mutespeaker"), muted ? "1" : "0");
        assert.equal(url.searchParams.has("relay"), mode === CONNECTION_MODE.compatibility);
        for (const key of ["push", "password", "prompt", "label"]) assert.equal(url.searchParams.has(key), false, key);
        assert.equal(url.hash, "#password=0042");
        assert.equal(url.origin + url.pathname, viewerBaseUrl);
      }
    }
  }
});

test("Lokale Origin wird mit Port bewahrt und fehlende Origin nicht erfunden", () => {
  const config = { viewerBaseUrl: "https://steveseguin.github.io/vdo.ninja/", streamId: "synthetic-stream", audienceToken: "synthetic-audience" };
  const local = new URL(buildViewerUrl(config, CONNECTION_MODE.direct, { parentOrigin: "http://127.0.0.1:4173/vr-live-stream/" }));
  assert.equal(local.searchParams.get("iframetarget"), "http://127.0.0.1:4173");
  for (const parentOrigin of [undefined, "", "null", "file:///viewer.html"]) {
    const url = new URL(buildViewerUrl(config, CONNECTION_MODE.direct, { parentOrigin }));
    assert.equal(url.searchParams.has("iframetarget"), false);
  }
});
