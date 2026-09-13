import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildSenderUrl, parseArgs, runLauncher } from "../scripts/start-stream.mjs";
import { buildViewerUrl } from "../docs/viewer-url.js";
import { STREAM_CONFIG } from "../docs/stream-config.js";

// All files and browser/clipboard adapters in these tests are synthetic.
// Never run the real launcher, inspect the user's credentials, or open a browser.
const secrets = Object.freeze({
  streamId: "vr_synthetic_fixture",
  publisherToken: "synthetic_publisher_token_for_local_tests",
  viewerToken: "synthetic_viewer_token",
  accessCode: "0123",
  createdUtc: "2026-01-01T00:00:00.0000000Z",
  accessCodeCreatedUtc: "2026-01-01T00:00:00.0000000Z",
});
const testDate = new Date("2026-09-13T10:00:00.000Z");

async function fixture(t) {
  const rootDirectory = await mkdtemp(join(tmpdir(), "vr-live-launcher-test-"));
  t.after(() => rm(rootDirectory, { recursive: true, force: true }));
  const privateDirectory = join(rootDirectory, ".private");
  await mkdir(privateDirectory);
  const secretsPath = join(privateDirectory, "stream-secrets.json");
  const codeFilePath = join(privateDirectory, "AKTUELLER-ZUGANGSCODE.txt");
  const originalJson = `${JSON.stringify(secrets, null, 2)}\n`;
  const originalCode = `Synthetischer Zugangscode: ${secrets.accessCode}\r\n`;
  await writeFile(secretsPath, originalJson, "utf8");
  await writeFile(codeFilePath, originalCode, "utf8");
  const calls = { chrome: 0, browser: [], codeFile: [], clipboard: [] };
  const dependencies = {
    findChrome: async () => { calls.chrome += 1; return "C:\\synthetic\\chrome.exe"; },
    launchBrowser: async (chrome, url) => { calls.browser.push({ chrome, url }); },
    showCodeFile: async (path) => { calls.codeFile.push(path); },
    copyCode: async (code) => { calls.clipboard.push(code); },
    nextCode: (old) => old === "4567" ? "8901" : "4567",
    now: () => testDate,
  };
  return { rootDirectory, secretsPath, codeFilePath, originalJson, originalCode, calls, dependencies };
}

function assertNoCredentials(value, extra = []) {
  const output = typeof value === "string" ? value : JSON.stringify(value);
  for (const secret of [secrets.publisherToken, secrets.viewerToken, secrets.accessCode, ...extra]) {
    assert.ok(!output.includes(secret), "Public status/error must not contain credentials");
  }
}

test("60-FPS-Neustart dreht nur den Code; 30 FPS behaelt dieselbe Sitzung", async (t) => {
  const f = await fixture(t);
  const result60 = await runLauncher({ rootDirectory: f.rootDirectory, fps: 60, newSession: true }, f.dependencies);
  const after60 = JSON.parse(await readFile(f.secretsPath, "utf8"));
  assert.equal(result60.status, "opened");
  assert.equal(result60.codeFilePath, f.codeFilePath);
  assert.match(after60.accessCode, /^\d{4}$/);
  assert.notEqual(after60.accessCode, secrets.accessCode);
  assert.equal(after60.accessCode, "4567");
  assert.equal(new Date(after60.accessCodeCreatedUtc).getTime(), testDate.getTime());
  for (const field of ["streamId", "publisherToken", "viewerToken", "createdUtc"]) {
    assert.equal(after60[field], secrets[field]);
  }
  assert.match(await readFile(f.codeFilePath, "utf8"), /4567/);
  const json60 = await readFile(f.secretsPath, "utf8");
  const result30 = await runLauncher({ rootDirectory: f.rootDirectory, fps: 30 }, f.dependencies);
  assert.equal(await readFile(f.secretsPath, "utf8"), json60);
  assert.equal(result30.status, "opened");
  assert.equal(f.calls.browser.length, 2);
  assert.deepEqual(f.calls.clipboard, ["4567", "4567"]);
  for (const [index, fps] of [60, 30].entries()) {
    const url = new URL(f.calls.browser[index].url);
    assert.equal(url.searchParams.get("screensharefps"), String(fps));
    assert.equal(new URLSearchParams(url.hash.slice(1)).get("password"), "4567");
  }
  assertNoCredentials(result60, ["4567"]);
  assertNoCredentials(result30, ["4567"]);
});

test("Sender-URL erhaelt Quest-Tab-Audio, Senderdaten und begrenzte Recovery", () => {
  for (const fps of [30, 60]) {
    const url = new URL(buildSenderUrl(secrets, fps));
    assert.equal(url.origin + url.pathname, "https://steveseguin.github.io/vdo.ninja/");
    const viewerUrl = new URL(buildViewerUrl(STREAM_CONFIG));
    assert.equal(url.origin + url.pathname, viewerUrl.origin + viewerUrl.pathname);
    const q = url.searchParams;
    assert.equal(q.get("salt"), "vdo.ninja");
    assert.equal(q.get("turn"), "steve;setupYourOwnPlease;turns:turn.obs.ninja:443");
    assert.equal(q.get("turn"), viewerUrl.searchParams.get("turn"));
    assert.equal(q.has("relay"), false, "Sender wird nicht dauerhaft auf Relay gezwungen");
    assert.equal(q.get("push"), secrets.streamId);
    assert.equal(q.get("audience"), secrets.publisherToken);
    assert.equal(new URLSearchParams(url.hash.slice(1)).get("password"), secrets.accessCode);
    assert.equal(q.has("password"), false);
    assert.equal(url.href.includes(secrets.viewerToken), false);
    assert.equal(q.get("screensharefps"), String(fps));
    assert.equal(q.get("screensharequality"), "1");
    assert.equal(q.get("screensharecontenthint"), "motion");
    assert.equal(q.has("screensharestereo"), true);
    assert.equal(q.get("displaysurface"), "browser");
    assert.equal(q.get("systemaudio"), "exclude");
    for (const [key, value] of Object.entries({
      autorecover: "1", autorelay: "1", p2pfailtimeout: "7000", peerrecoversteps: "5",
      pendingicettl: "20000", maxviewers: "6",
    })) assert.equal(q.get(key), value, key);
    for (const key of ["prompt", "screensharevideoonly", "ssvideoonly", "ssvo", "muted", "audiodevice", "screenshareaudio"]) {
      assert.equal(q.has(key), false, key);
    }
  }
});

test("CLI akzeptiert bekannte Optionen und lehnt ungueltige Werte eindeutig ab", () => {
  assert.throws(() => parseArgs([]));
  const launch = parseArgs(["--fps", "60", "--new-session"]);
  assert.equal(launch.fps, 60);
  assert.equal(launch.newSession, true);
  assert.equal(parseArgs(["--fps", "30"]).fps, 30);
  assert.equal(parseArgs(["--show-code"]).showCode, true);
  assert.equal(parseArgs(["--check"]).checkOnly, true);
  for (const args of [
    ["--unknown"], ["--fps"], ["--fps", "abc"], ["--fps", "60oops"],
    ["--fps", "0"], ["--fps", "120"], ["extra"],
    ["--new-session"], ["--fps", "30", "--new-session"],
    ["--show-code", "--check"], ["--fps", "60", "--fps", "30"],
    ["--show-code", "--show-code"], ["--check", "--fps", "60"],
  ]) assert.throws(() => parseArgs(args), undefined, args.join(" "));
});

test("Code anzeigen braucht weder Chrome noch eine Aenderung der Sitzung", async (t) => {
  const f = await fixture(t);
  f.dependencies.findChrome = async () => { assert.fail("Chrome must not be searched when showing the code"); };
  const result = await runLauncher({ rootDirectory: f.rootDirectory, showCode: true }, f.dependencies);
  assert.equal(result.status, "opened");
  assert.equal(await readFile(f.secretsPath, "utf8"), f.originalJson);
  assert.deepEqual(f.calls.codeFile, [f.codeFilePath]);
  assert.deepEqual(f.calls.browser, []);
  assert.deepEqual(f.calls.clipboard, [secrets.accessCode]);
  assertNoCredentials(result);
});

test("Pruefmodus oeffnet keine Anwendungen und aendert weder Code noch Zwischenablage", async (t) => {
  const f = await fixture(t);
  const result = await runLauncher({ rootDirectory: f.rootDirectory, checkOnly: true }, f.dependencies);
  assert.equal(result.status, "checked");
  assert.equal(await readFile(f.secretsPath, "utf8"), f.originalJson);
  assert.equal(await readFile(f.codeFilePath, "utf8"), f.originalCode);
  assert.deepEqual(f.calls.browser, []);
  assert.deepEqual(f.calls.codeFile, []);
  assert.deepEqual(f.calls.clipboard, []);
  assertNoCredentials(result);
});

test("Blockierte Zwischenablage verhindert keinen Senderstart", async (t) => {
  const f = await fixture(t);
  f.dependencies.copyCode = async () => { throw new Error(`Synthetic clipboard failure ${secrets.accessCode}`); };
  const result = await runLauncher({ rootDirectory: f.rootDirectory, fps: 30 }, f.dependencies);
  assert.equal(result.status, "opened");
  assert.equal(f.calls.browser.length, 1);
  assert.ok(Array.isArray(result.warnings) && result.warnings.length > 0);
  assertNoCredentials(result);
  assert.equal(await readFile(f.secretsPath, "utf8"), f.originalJson);
});

test("Fehlendes Chrome laesst beide Sitzungsdateien unveraendert", async (t) => {
  const f = await fixture(t);
  f.dependencies.findChrome = async () => null;
  await assert.rejects(runLauncher({ rootDirectory: f.rootDirectory, fps: 60, newSession: true }, f.dependencies), (error) => {
    assertNoCredentials(error.message);
    return true;
  });
  assert.equal(await readFile(f.secretsPath, "utf8"), f.originalJson);
  assert.equal(await readFile(f.codeFilePath, "utf8"), f.originalCode);
  assert.deepEqual(f.calls.browser, []);
  assert.deepEqual(f.calls.clipboard, []);
});

test("Beschaedigte Zugangsdaten bleiben erhalten und erscheinen nicht im Fehler", async (t) => {
  const f = await fixture(t);
  const malformed = `{"publisherToken":"${secrets.publisherToken}","accessCode":"${secrets.accessCode}",broken}`;
  await writeFile(f.secretsPath, malformed, "utf8");
  await assert.rejects(runLauncher({ rootDirectory: f.rootDirectory, fps: 60, newSession: true }, f.dependencies), (error) => {
    assertNoCredentials(error.message);
    return true;
  });
  assert.equal(await readFile(f.secretsPath, "utf8"), malformed);
  assert.equal(await readFile(f.codeFilePath, "utf8"), f.originalCode);
  assert.deepEqual(f.calls.browser, []);
  assert.deepEqual(f.calls.clipboard, []);
});

test("Fehlgeschlagener Browserstart stellt Code und Sitzung bytegenau wieder her", async (t) => {
  const f = await fixture(t);
  f.dependencies.launchBrowser = async (_chrome, url) => { throw new Error(`Synthetic spawn failure ${url}`); };
  await assert.rejects(runLauncher({ rootDirectory: f.rootDirectory, fps: 60, newSession: true }, f.dependencies), (error) => {
    assertNoCredentials(error.message, ["4567"]);
    return true;
  });
  assert.equal(await readFile(f.secretsPath, "utf8"), f.originalJson);
  assert.equal(await readFile(f.codeFilePath, "utf8"), f.originalCode);
  assert.deepEqual(f.calls.clipboard, []);
  assert.deepEqual(f.calls.codeFile, []);
});

test("Ein neuer Code muss vierstellig und vom alten Code verschieden sein", async (t) => {
  for (const candidate of [secrets.accessCode, "12", "abcd", "12345", 4567]) {
    const f = await fixture(t);
    f.dependencies.nextCode = () => candidate;
    await assert.rejects(runLauncher({ rootDirectory: f.rootDirectory, fps: 60, newSession: true }, f.dependencies));
    assert.equal(await readFile(f.secretsPath, "utf8"), f.originalJson);
    assert.equal(await readFile(f.codeFilePath, "utf8"), f.originalCode);
    assert.deepEqual(f.calls.browser, []);
  }
});

test("Doppelklick kann keinen zweiten Code ueber den laufenden Start schreiben", async (t) => {
  const f = await fixture(t);
  let allowBrowserStart;
  let enteredBrowserStart;
  const browserGate = new Promise((resolve) => { allowBrowserStart = resolve; });
  const browserEntered = new Promise((resolve) => { enteredBrowserStart = resolve; });
  f.dependencies.launchBrowser = async (_chrome, url) => {
    f.calls.browser.push({ url });
    enteredBrowserStart();
    await browserGate;
  };
  const first = runLauncher({ rootDirectory: f.rootDirectory, fps: 60, newSession: true }, f.dependencies);
  try {
    await browserEntered;
    const firstJson = await readFile(f.secretsPath, "utf8");
    await assert.rejects(runLauncher({ rootDirectory: f.rootDirectory, fps: 60, newSession: true }, f.dependencies), (error) => {
      assertNoCredentials(error.message, ["4567"]);
      return true;
    });
    assert.equal(await readFile(f.secretsPath, "utf8"), firstJson);
    assert.equal(f.calls.browser.length, 1);
  } finally {
    allowBrowserStart();
    await first;
  }
  await assert.rejects(readFile(join(f.rootDirectory, ".private", ".launcher.lock")), { code: "ENOENT" });
  const after = await runLauncher({ rootDirectory: f.rootDirectory, fps: 30 }, f.dependencies);
  assert.equal(after.status, "opened");
  assert.equal(f.calls.browser.length, 2);
});

test("Browserfehler entfernt eine zuvor fehlende Code-Datei und gibt die Sperre frei", async (t) => {
  const f = await fixture(t);
  await rm(f.codeFilePath);
  f.dependencies.launchBrowser = async () => { throw new Error("Synthetic launch failure"); };
  await assert.rejects(runLauncher({ rootDirectory: f.rootDirectory, fps: 60, newSession: true }, f.dependencies));
  assert.equal(await readFile(f.secretsPath, "utf8"), f.originalJson);
  await assert.rejects(readFile(f.codeFilePath), { code: "ENOENT" });
  await assert.rejects(readFile(join(f.rootDirectory, ".private", ".launcher.lock")), { code: "ENOENT" });
});
