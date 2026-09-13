import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { createPreviewServer } from "../../scripts/serve.mjs";
import { STREAM_CONFIG } from "../../docs/stream-config.js";

// Die echte Oberfläche läuft im Browser; der fremde Player wird lokal simuliert.
// Es wird weder VDO.Ninja kontaktiert noch Kamera-/Mikrofonmaterial übertragen.
const fixture = `<!doctype html><html lang="de"><meta charset="utf-8">
<style>html,body{height:100%;margin:0;background:#101b29;color:#b6cbd9;font:16px system-ui}
body{display:grid;place-content:center;text-align:center}small{display:block;margin-top:10px}</style>
<body>Simulierter Quest-Stream<small>Lokaler Oberflächentest · kein Livebild</small>
<script>window.commands=[];addEventListener('message',event=>commands.push(event.data));</script>`;
let server;
let baseUrl;

before(async () => {
  server = createPreviewServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/vr-live-stream/`;
  await mkdir("test-results", { recursive: true });
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

for (const engine of [chromium, webkit]) {
  describe(engine.name(), () => {
    let browser;
    before(async () => { browser = await engine.launch({ headless: true }); });
    after(async () => { await browser?.close(); });

    async function open(t, { viewport = { width: 1440, height: 1000 }, init, config } = {}) {
      const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
      const errors = [];
      const requests = [];
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === new URL(baseUrl).origin) {
          if (config && url.pathname.endsWith("/stream-config.js")) {
            await route.fulfill({ contentType: "text/javascript", body: `export const STREAM_CONFIG = ${JSON.stringify(config)};` });
          } else await route.continue();
        } else if (url.origin === new URL(STREAM_CONFIG.viewerBaseUrl).origin) {
          requests.push(url);
          await route.fulfill({ contentType: "text/html", body: fixture });
        } else {
          errors.push(`Unerwartete externe Anfrage: ${url.origin}`);
          await route.abort();
        }
      });
      const page = await context.newPage();
      page.setDefaultTimeout(7_000);
      page.on("pageerror", (error) => errors.push(error.message));
      t.after(async () => {
        await context.close();
        assert.deepEqual(errors, [], "Keine JavaScriptfehler oder unerwarteten externen Anfragen");
      });
      if (init) await page.addInitScript(init);
      await page.goto(baseUrl);
      await page.waitForFunction(() => document.querySelector("#accessCodeInput").hasAttribute("aria-invalid") ||
        document.querySelector("#primaryAction").dataset.hint);
      return { page, context, requests };
    }

    async function state(page, expected) {
      await page.waitForFunction((value) => document.querySelector("#playerFrame").dataset.playerState === value, expected);
    }
    async function start(page) {
      await page.locator("#accessCodeInput").fill("0042");
      await page.locator("#primaryAction").click();
      await state(page, "connecting");
      const frame = await page.locator("#playerSlot iframe[data-active-player]").elementHandle();
      const content = await frame.contentFrame();
      await content.waitForFunction(() => Array.isArray(window.commands));
      await send(content, { cib: "health", stats: { inbound: {} } });
      await page.waitForFunction(() => document.querySelector("#playerFrame").dataset.connectionPhase === "signaling");
      return content;
    }

    async function reportActivePlayerReady(page) {
      const handle = await page.locator("iframe[data-active-player]").elementHandle();
      const frame = await handle.contentFrame();
      await frame.waitForFunction(() => Array.isArray(window.commands));
      await send(frame, { cib: "health", stats: { inbound: {} } });
      await page.waitForFunction(() => document.querySelector("#playerFrame").dataset.connectionPhase === "signaling");
    }
    async function send(frame, data) {
      await frame.evaluate((message) => parent.postMessage(message, "*"), data);
    }
    async function live(page, frame) {
      await send(frame, { action: "new-video-track-added", value: true, streamID: STREAM_CONFIG.streamId });
      await send(frame, { cib: "health", stats: { inbound: { [STREAM_CONFIG.streamId]: { video: { _type: "video", _last_bytes: 100 } } } } });
      await state(page, "live");
    }

    test("Codevalidierung und Start ohne vorzeitige Fremdverbindung", async (t) => {
      const { page, requests } = await open(t);
      assert.equal(requests.length, 0);
      assert.equal(await page.locator("#reconnectButton").isDisabled(), true);
      await page.locator("#primaryAction").click();
      assert.equal(await page.locator("#accessError").isVisible(), true);
      assert.equal(await page.locator("#accessCodeInput").getAttribute("aria-invalid"), "true");
      await page.locator("#accessCodeInput").fill("0a42");
      assert.equal(await page.locator("#accessCodeInput").inputValue(), "042");
      await start(page);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].searchParams.has("password"), false);
      assert.equal(requests[0].searchParams.has("prompt"), false);
      assert.equal(await page.locator("#playerSlot iframe[data-active-player]").getAttribute("allow"), "autoplay; fullscreen");
    });

    test("Offline-Start und Codeänderung entsperren sich nach Internet-Rückkehr", async (t) => {
      const { page, context, requests } = await open(t);
      await context.setOffline(true);
      await page.waitForFunction(() => !navigator.onLine);
      assert.equal(await page.locator("#primaryAction").isDisabled(), true);
      await page.locator("#accessCodeInput").fill("0042");
      await context.setOffline(false);
      await page.waitForFunction(() => !document.querySelector("#primaryAction").disabled);
      assert.equal(requests.length, 0);
      const frame = await start(page);
      await live(page, frame);
      await context.setOffline(true);
      await state(page, "offline");
      await page.locator("#accessCodeInput").fill("0043");
      await context.setOffline(false);
      await page.waitForFunction(() => !document.querySelector("#primaryAction").disabled);
      assert.equal(await page.locator("#accessCodeInput").isEnabled(), true);
      assert.equal(await page.locator("#playerSlot iframe[data-active-player]").count(), 0);
    });

    test("Fremde Nachrichten und defekte Health-Daten erzeugen keinen falschen Status", async (t) => {
      const { page } = await open(t);
      const frame = await start(page);
      await page.evaluate(({ streamID, origin }) => {
        const data = { action: "new-video-track-added", value: true, streamID };
        dispatchEvent(new MessageEvent("message", { origin, source: window, data }));
        dispatchEvent(new MessageEvent("message", { origin: "https://example.invalid", source: document.querySelector("iframe[data-active-player]").contentWindow, data }));
      }, { streamID: STREAM_CONFIG.streamId, origin: new URL(STREAM_CONFIG.viewerBaseUrl).origin });
      await send(frame, { action: "new-video-track-added", value: true, streamID: "different-stream" });
      await state(page, "connecting");
      await live(page, frame);
      for (let index = 0; index < 26; index++) await send(frame, { cib: "health", stats: {} });
      assert.equal(await page.locator("#statusLabel").textContent(), "LIVE");
      await send(frame, { cib: "health", stats: { inbound: {} } });
      await send(frame, { cib: "health", stats: { inbound: {} } });
      await page.waitForFunction(() => document.querySelector("#statusLabel").textContent === "NEU VERBINDEN");
      await page.locator("#soundButton").click();
      assert.match(await page.locator("#controlNote").textContent(), /unterbrochen/);
      await send(frame, { cib: "health", stats: { inbound: { [STREAM_CONFIG.streamId]: { _bytesReceived_video: 200 } } } });
      await page.waitForFunction(() => document.querySelector("#statusLabel").textContent === "LIVE");
    });

    test("Direkt-Timeout, Relay, manueller Neustart und Abbruch durch Codeänderung", async (t) => {
      const { page } = await open(t);
      await page.clock.install();
      await start(page);
      await page.clock.fastForward(STREAM_CONFIG.connectTimeoutMs + 1);
      await page.waitForFunction(() => new URL(document.querySelector("iframe[data-active-player]").src).searchParams.has("relay"));
      await reportActivePlayerReady(page);
      await page.clock.fastForward(STREAM_CONFIG.connectTimeoutMs + 1);
      await state(page, "offline");
      await page.clock.fastForward(180_000);
      await state(page, "offline");
      await page.locator("#primaryAction").click();
      await state(page, "connecting");
      assert.equal(await page.locator("iframe[data-active-player]").evaluate((element) => new URL(element.src).searchParams.has("relay")), false);
      await page.locator("#accessCodeInput").fill("0043");
      await page.clock.fastForward(180_000);
      await state(page, "offline");
      assert.equal(await page.locator("iframe[data-active-player]").count(), 0);
    });

    test("Wiederholte Abbruchmeldungen verlängern die Schonfrist nicht", async (t) => {
      const { page } = await open(t);
      await page.clock.install();
      const frame = await start(page);
      await live(page, frame);
      const disconnect = { action: "view-connection", value: false, streamID: STREAM_CONFIG.streamId };
      await send(frame, disconnect);
      await page.waitForFunction(() => document.querySelector("#playerFrame").dataset.connectionHealth === "recovering");
      await page.clock.fastForward(10_000);
      await send(frame, disconnect);
      await page.clock.fastForward(5_001);
      await state(page, "offline");
      assert.equal(await page.locator("iframe[data-active-player]").count(), 0);
    });

    test("Tonwahl bleibt bei spätem Iframe-Load erhalten", async (t) => {
      const { page } = await open(t);
      const frame = await start(page);
      await live(page, frame);
      await page.locator("#soundButton").click();
      await page.locator("#soundButton").click();
      await page.locator("iframe[data-active-player]").evaluate((element) => element.dispatchEvent(new Event("load")));
      await frame.waitForFunction(() => window.commands.filter((command) => "mute" in command).at(-1)?.mute === false);
      assert.equal(await page.locator("#soundButton").getAttribute("aria-pressed"), "true");
    });

    test("Netzrückkehr verbindet automatisch, versteckte Seiten warten auf Sichtbarkeit", async (t) => {
      const { page, context } = await open(t);
      await page.clock.install();
      const frame = await start(page);
      await live(page, frame);
      await context.setOffline(true);
      await state(page, "offline");
      await context.setOffline(false);
      await state(page, "connecting");
      await reportActivePlayerReady(page);
      await page.clock.fastForward(STREAM_CONFIG.connectTimeoutMs + 1);
      await page.waitForFunction(() => new URL(document.querySelector("iframe[data-active-player]").src).searchParams.has("relay"));
      await reportActivePlayerReady(page);
      await page.clock.fastForward(STREAM_CONFIG.connectTimeoutMs + 1);
      await state(page, "offline");
      await page.evaluate(() => Object.defineProperty(document, "hidden", { configurable: true, value: true }));
      await page.clock.fastForward(STREAM_CONFIG.reconnectDelayMs + 1);
      assert.equal(await page.locator("iframe[data-active-player]").count(), 0);
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, value: false });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await state(page, "connecting");
    });

    test("Fenster-Vollbild hält Fokus und gibt ihn bei Escape und Netzverlust zurück", async (t) => {
      const { page, context } = await open(t, { init: () => {
        Object.defineProperty(document, "fullscreenEnabled", { value: false });
        Object.defineProperty(document, "webkitFullscreenEnabled", { value: false });
      } });
      await page.clock.install();
      const frame = await start(page);
      await live(page, frame);
      await page.locator("#fullscreenButton").click();
      await page.waitForFunction(() => document.activeElement.id === "exitFullscreenButton");
      assert.equal(await page.locator(".site-header").evaluate((element) => element.inert), true);
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement.id), "playerSoundButton");
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement.id), "exitFullscreenButton");
      await page.keyboard.press("Shift+Tab");
      assert.equal(await page.evaluate(() => document.activeElement.id), "playerSoundButton");
      await page.screenshot({ path: `test-results/${engine.name()}-fullscreen.png` });
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => document.activeElement.id === "fullscreenButton");
      assert.equal(await page.locator(".site-header").evaluate((element) => element.inert), false);
      await page.clock.fastForward(500);
      await page.locator("#fullscreenButton").click();
      await page.waitForFunction(() => document.querySelector("#playerFrame").classList.contains("is-window-fullscreen"));
      await context.setOffline(true);
      await page.waitForFunction(() => !document.querySelector("#playerFrame").classList.contains("is-window-fullscreen"));
      assert.equal(await page.locator("#accessCodeInput").isEnabled(), true);
    });

    test("Hängender nativer Vollbildaufruf erreicht den Rückfallmodus", async (t) => {
      const { page } = await open(t, { init: () => {
        Object.defineProperty(document, "fullscreenEnabled", { value: true });
        Element.prototype.requestFullscreen = () => new Promise(() => {});
      } });
      await page.clock.install();
      const frame = await start(page);
      await live(page, frame);
      await page.locator("#fullscreenButton").click();
      await page.clock.fastForward(1_250);
      await page.waitForFunction(() => document.querySelector("#playerFrame").classList.contains("is-window-fullscreen"));
      assert.equal(await page.locator("#exitFullscreenButton").isEnabled(), true);
    });

    if (engine === chromium) test("Natives Chromium-Vollbild öffnet und schließt ohne API-Simulation", async (t) => {
      const { page, context } = await open(t);
      const frame = await start(page);
      await live(page, frame);
      await page.locator("#fullscreenButton").click();
      await page.waitForFunction(() => document.fullscreenElement?.id === "playerFrame");
      assert.equal(await page.locator("#playerFrame").evaluate((element) => element.classList.contains("is-window-fullscreen")), false);
      await page.locator("#exitFullscreenButton").click();
      await page.waitForFunction(() => !document.fullscreenElement && document.activeElement.id === "fullscreenButton");
      // Der echte Browser nutzt auch für diesen kurzen Doppelklickschutz seine Uhr.
      await page.waitForTimeout(460);
      await page.locator("#fullscreenButton").click();
      await page.waitForFunction(() => document.fullscreenElement?.id === "playerFrame");
      await context.setOffline(true);
      await page.waitForFunction(() => !document.fullscreenElement && document.activeElement.id === "accessCodeInput");
    });

    test("Verspätetes natives Vollbild bleibt nach Schließen oder Netzverlust geschlossen", async (t) => {
      for (const action of ["close", "offline"]) {
        const { page, context } = await open(t, { init: () => {
          let fullscreenElement = null;
          let finishRequest;
          Object.defineProperty(document, "fullscreenEnabled", { value: true });
          Object.defineProperty(document, "fullscreenElement", { get: () => fullscreenElement });
          Element.prototype.requestFullscreen = () => new Promise((resolve) => { finishRequest = resolve; });
          document.exitFullscreen = async () => {
            fullscreenElement = null;
            document.dispatchEvent(new Event("fullscreenchange"));
          };
          window.delayedEnter = () => {
            fullscreenElement = document.querySelector("#playerFrame");
            finishRequest();
            document.dispatchEvent(new Event("fullscreenchange"));
          };
        } });
        await page.clock.install();
        const frame = await start(page);
        await live(page, frame);
        await page.locator("#fullscreenButton").click();
        await page.clock.fastForward(1_250);
        await page.waitForFunction(() => document.querySelector("#playerFrame").classList.contains("is-window-fullscreen"));
        if (action === "close") await page.locator("#exitFullscreenButton").click();
        else await context.setOffline(true);
        await page.waitForFunction(() => !document.querySelector("#playerFrame").classList.contains("is-window-fullscreen"));
        await page.evaluate(() => window.delayedEnter());
        await page.waitForFunction(() => !document.fullscreenElement && document.querySelector("#fullscreenButton").getAttribute("aria-pressed") === "false");
        assert.equal(await page.locator(".site-header").evaluate((element) => element.inert), false);
      }
    });

    test("Browser-Zurück aus dem Seitencache stellt den Viewer wieder her", async (t) => {
      const { page } = await open(t);
      const frame = await start(page);
      await live(page, frame);
      await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
      await state(page, "offline");
      assert.equal(await page.locator("iframe[data-active-player]").count(), 0);
      await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
      await state(page, "connecting");
      assert.equal(await page.locator("iframe[data-active-player]").count(), 1);
    });

    test("Ungültige Konfiguration zeigt eine bedienbare Fehleransicht", async (t) => {
      const { page } = await open(t, { config: { ...STREAM_CONFIG, viewerBaseUrl: "invalid" } });
      assert.match(await page.locator("#placeholderKicker").textContent(), /EINRICHTUNG/);
      assert.equal(await page.locator("#primaryAction").isDisabled(), true);
    });

    test("Responsive Ansicht: Formular passt und Livebild bleibt 16:9", async (t) => {
      const { page } = await open(t);
      for (const width of [320, 390, 540, 768, 820, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const fits = await page.evaluate(() => {
          const frame = document.querySelector("#playerFrame").getBoundingClientRect();
          const button = document.querySelector("#primaryAction").getBoundingClientRect();
          return document.documentElement.scrollWidth <= innerWidth && button.bottom <= frame.bottom && button.top >= frame.top;
        });
        assert.equal(fits, true, `Formular passt bei ${width}px`);
        await page.screenshot({ path: `test-results/${engine.name()}-${width}-entry.png`, fullPage: true });
      }
      const frame = await start(page);
      for (const width of [320, 820]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const fits = await page.locator("#connectionCancelButton").evaluate((button) => {
          const bounds = button.getBoundingClientRect();
          const player = document.querySelector("#playerFrame").getBoundingClientRect();
          return getComputedStyle(document.querySelector("#playerSlot")).opacity === "0" &&
            !button.hidden && bounds.height > 0 && bounds.bottom <= player.bottom &&
            document.documentElement.scrollWidth <= innerWidth;
        });
        assert.equal(fits, true, `Abbrechen passt bei ${width}px`);
        await page.screenshot({ path: `test-results/${engine.name()}-${width}-connecting.png`, fullPage: true });
      }
      await live(page, frame);
      for (const width of [320, 390, 540, 768, 820, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const bounds = await page.locator("#playerFrame").boundingBox();
        assert.ok(Math.abs(bounds.width / bounds.height - 16 / 9) < 0.03, `16:9 bei ${width}px`);
        await page.screenshot({ path: `test-results/${engine.name()}-${width}-live.png`, fullPage: true });
      }
    });
  });
}
