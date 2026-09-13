import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { chromium, webkit } from "playwright";
import { createPreviewServer } from "../../scripts/serve.mjs";
import { syntheticAudioFixture } from "./fixtures/synthetic-audio.mjs";

// Real browser media decoding and signal checks against the production controls.
// The cross-origin player is entirely simulated; no Quest, VDO transport,
// microphone, camera, or actual game/music source is involved.
const testConfig = {
  viewerBaseUrl: "https://vdo.ninja/",
  streamId: "synthetic_audio_test",
  audienceToken: "synthetic_audio_audience",
  connectTimeoutMs: 30_000,
  reconnectDelayMs: 10_000,
};
let server;
let baseUrl;

before(async () => {
  server = createPreviewServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/vr-live-stream/`;
});
after(async () => { await new Promise((resolve) => server.close(resolve)); });

for (const engine of [chromium, webkit]) {
  describe(`${engine.name()} · synthetische Audiowiedergabe`, () => {
    let browser;
    let signalAnalysisSupported;
    before(async () => {
      // Intentionally no autoplay bypass flags or granted device permissions.
      browser = await engine.launch({ headless: true });
      const probePage = await browser.newPage();
      signalAnalysisSupported = await probePage.evaluate(() =>
        typeof window.AudioContext === "function" || typeof window.webkitAudioContext === "function");
      await probePage.close();
    });
    after(async () => { await browser?.close(); });

    function requireSignalAnalysis(t) {
      if (signalAnalysisSupported) return true;
      t.skip("Dieser Browser-Build bietet keine Web-Audio-API: keine decodierte Signalprüfung und kein stummer Analyser-Ausgang möglich. UI-/Nachrichtentests sind separat abgedeckt.");
      return false;
    }

    async function open(t) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const errors = [];
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === new URL(baseUrl).origin) {
          if (url.pathname.endsWith("/stream-config.js")) {
            await route.fulfill({ contentType: "text/javascript", body: `export const STREAM_CONFIG = ${JSON.stringify(testConfig)};` });
          } else await route.continue();
        } else if (url.origin === "https://vdo.ninja") {
          await route.fulfill({ contentType: "text/html", body: syntheticAudioFixture });
        } else {
          errors.push(`Unerwartete externe Anfrage: ${url.origin}`);
          await route.abort();
        }
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      page.on("pageerror", (error) => errors.push(error.message));
      // Keep this check independent of the host window's native fullscreen API.
      await page.addInitScript(() => {
        Object.defineProperty(document, "fullscreenEnabled", { value: false });
        Object.defineProperty(document, "webkitFullscreenEnabled", { value: false });
      });
      t.after(async () => {
        await context.close();
        assert.deepEqual(errors, [], "Keine JavaScriptfehler oder externen Verbindungen");
      });
      await page.goto(baseUrl);
      await page.locator("#accessCodeInput").fill("0042");
      await page.locator("#primaryAction").click();
      return { page, context };
    }

    async function currentFrame(page) {
      await page.waitForFunction(() => document.querySelector("#playerFrame").dataset.playerState === "live");
      const frame = await (await page.locator("#playerSlot iframe[data-active-player]").elementHandle()).contentFrame();
      await frame.waitForFunction(() => !!window.audioProbe);
      return frame;
    }

    async function ensurePlayback(frame, t) {
      await frame.waitForFunction(() => window.audioProbe.played || window.audioProbe.blocked);
      const initial = await frame.evaluate(() => window.audioProbe.snapshot());
      if (initial.blocked || initial.contextState !== "running") {
        // WebKit may require the gesture inside the cross-origin player. This
        // is a real click on its fallback button, not a simulated gesture.
        t.diagnostic(`Native Testplayer-Freigabe erforderlich: ${JSON.stringify(initial)}`);
        await frame.locator("#nativeAudioStart").click();
      }
      await frame.waitForFunction(() => {
        const state = window.audioProbe.snapshot();
        return !state.paused && state.contextState === "running" && state.currentTime > 0;
      });
    }

    async function expectSignal(frame, audible) {
      await frame.waitForFunction((expected) => {
        const state = window.audioProbe.snapshot();
        return state.muted === !expected && (expected ? state.rms > 0.05 : state.rms < 0.00001);
      }, audible);
      const result = await frame.evaluate(() => window.audioProbe.snapshot());
      assert.equal(result.outputGain, 0, "Testsignal gelangt nicht an die Lautsprecher");
      assert.equal(result.volume, 1, "Produktionssteuerung hält 100 Prozent Lautstärke");
      assert.equal(result.paused, false, "Das echte Mediaelement läuft weiter");
      assert.ok(result.readyState >= 2, "PCM wurde vom Browser decodiert");
      return result;
    }

    test("Start, Tonknopf und Vollbild steuern ein decodiertes Audiosignal", async (t) => {
      if (!requireSignalAnalysis(t)) return;
      const { page } = await open(t);
      const frame = await currentFrame(page);
      assert.equal(new URL(frame.url()).searchParams.get("mutespeaker"), "0");
      await ensurePlayback(frame, t);
      const initial = await expectSignal(frame, true);
      t.diagnostic(`Synthetisches Eingangssignal RMS=${initial.rms.toFixed(3)}, native Freigaben=${initial.nativeStarts}`);
      await page.locator("#soundButton").click();
      await expectSignal(frame, false);
      await page.locator("#soundButton").click();
      await ensurePlayback(frame, t);
      await expectSignal(frame, true);

      await page.locator("#fullscreenButton").click();
      await page.locator("#playerSoundButton").click();
      await expectSignal(frame, false);
      await page.locator("#playerSoundButton").click();
      await ensurePlayback(frame, t);
      await expectSignal(frame, true);
      await page.keyboard.press("Escape");
    });

    test("Ton erneut aktivieren startet ein angehaltenes Mediaelement wieder", async (t) => {
      if (!requireSignalAnalysis(t)) return;
      const { page } = await open(t);
      const frame = await currentFrame(page);
      await ensurePlayback(frame, t);
      await expectSignal(frame, true);
      await frame.evaluate(() => {
        window.audioProbe.media.pause();
        window.audioProbe.media.volume = 0;
      });
      assert.equal(await frame.evaluate(() => window.audioProbe.media.paused), true);
      await page.locator("#audioHelp summary").click();
      await page.locator("#retrySoundButton").click();
      await ensurePlayback(frame, t);
      await expectSignal(frame, true);
    });

    test("Stummwahl und Tonfreigabe bleiben bei neuen Playerverbindungen erhalten", async (t) => {
      if (!requireSignalAnalysis(t)) return;
      const { page } = await open(t);
      let frame = await currentFrame(page);
      await ensurePlayback(frame, t);
      await expectSignal(frame, true);
      await page.locator("#soundButton").click();
      await expectSignal(frame, false);
      await page.locator("#reconnectButton").click();
      frame = await currentFrame(page);
      assert.equal(new URL(frame.url()).searchParams.get("mutespeaker"), "1");
      await ensurePlayback(frame, t);
      await expectSignal(frame, false);
      await page.locator("#soundButton").click();
      await ensurePlayback(frame, t);
      await expectSignal(frame, true);
      await page.locator("#reconnectButton").click();
      frame = await currentFrame(page);
      assert.equal(new URL(frame.url()).searchParams.get("mutespeaker"), "0");
      await ensurePlayback(frame, t);
      await expectSignal(frame, true);
    });
  });
}
