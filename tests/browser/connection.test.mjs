import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { chromium, webkit } from "playwright";
import { createPreviewServer } from "../../scripts/serve.mjs";
import { STREAM_CONFIG } from "../../docs/stream-config.js";

// Actual browser and production UI; all VDO responses are local fixtures.
// These tests verify viewer recovery, not a live Quest or external WebRTC route.
const fixture = `<!doctype html><html lang="de"><meta charset="utf-8">
<body>Lokaler Verbindungstest – kein Livebild
<script>
window.commands = [];
addEventListener('message', event => window.commands.push(event.data));
window.ready = true;
</script>`;
const activeSelector = '#playerSlot iframe[data-active-player="true"]';
const timeoutMs = 25_000;
let server;
let baseUrl;

before(async () => {
  server = createPreviewServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/vr-live-stream/`;
});
after(async () => { await new Promise((resolve) => server.close(resolve)); });

for (const engine of [chromium, webkit]) {
  describe(`${engine.name()} · Verbindungsstart und Wiederherstellung`, () => {
    let browser;
    before(async () => { browser = await engine.launch({ headless: true }); });
    after(async () => { await browser?.close(); });

    async function open(t, { storageState, clockTime } = {}) {
      const context = await browser.newContext({ storageState });
      const requests = [];
      const errors = [];
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === new URL(baseUrl).origin) {
          await route.continue();
        } else if (url.origin === "https://vdo.ninja") {
          requests.push(url);
          await route.fulfill({ contentType: "text/html", body: fixture });
        } else {
          errors.push(`Unerwartete externe Anfrage: ${url.origin}`);
          await route.abort();
        }
      });
      const page = await context.newPage();
      page.setDefaultTimeout(5_000);
      page.on("pageerror", (error) => errors.push(error.message));
      t.after(async () => {
        await context.close();
        assert.deepEqual(errors, [], "Keine JavaScriptfehler oder externen Verbindungen");
      });
      await page.goto(baseUrl);
      await page.waitForFunction(() => document.querySelector("#primaryAction").dataset.hint);
      await page.clock.install(clockTime === undefined ? {} : { time: new Date(clockTime) });
      return { page, context, requests };
    }

    async function active(page) {
      const handle = await page.locator(activeSelector).elementHandle();
      assert.ok(handle, "Ein aktiver Player ist vorhanden");
      const frame = await handle.contentFrame();
      await frame.waitForFunction(() => window.ready);
      return { handle, frame };
    }

    async function state(page, expected) {
      await page.waitForFunction((value) =>
        document.querySelector("#playerFrame").dataset.playerState === value, expected);
    }

    async function start(page) {
      await page.locator("#accessCodeInput").fill("0042");
      await page.locator("#primaryAction").click();
      await state(page, "connecting");
      return active(page);
    }

    async function send(page, frame, message) {
      await frame.evaluate((data) => parent.postMessage(data, "*"), message);
      // Deliver queued cross-origin messages before advancing a long deadline.
      await page.clock.runFor(1);
    }

    async function video(page, frame, bytesReceived = 1024) {
      await send(page, frame, {
        cib: "health", stats: { inbound: {
          [STREAM_CONFIG.streamId]: { _bytesReceived_video: bytesReceived },
        } },
      });
    }

    async function becomeLive(page, frame) {
      await video(page, frame, 1024);
      await video(page, frame, 2048);
      await state(page, "live");
    }

    async function assertRelay(page, expected) {
      await page.waitForFunction(({ selector, relay }) => {
        const frame = document.querySelector(selector);
        return frame && new URL(frame.src).searchParams.has("relay") === relay;
      }, { selector: activeSelector, relay: expected });
    }

    test("Leere Metadaten und ein Track-Ereignis stoppen den Start-Timeout nicht", async (t) => {
      const { page } = await open(t);
      const { frame } = await start(page);
      await send(page, frame, {
        cib: "health", stats: { inbound: { [STREAM_CONFIG.streamId]: {} } },
      });
      await send(page, frame, {
        action: "new-video-track-added", value: true, streamID: STREAM_CONFIG.streamId,
      });
      await state(page, "connecting");
      await page.clock.fastForward(timeoutMs + 1);
      await assertRelay(page, true);
      await active(page);
      await page.clock.fastForward(timeoutMs + 1);
      await state(page, "offline");
      await page.clock.fastForward(3_001);
      await state(page, "connecting");
      await assertRelay(page, false);
    });

    test("Ein neuer Browser-Kontext merkt sich Relay und versucht bei Ausfall auch direkt", async (t) => {
      const first = await open(t);
      await start(first.page);
      await first.page.clock.fastForward(timeoutMs + 1);
      await assertRelay(first.page, true);
      const relay = await active(first.page);
      await becomeLive(first.page, relay.frame);
      const storageState = await first.context.storageState();
      const clockTime = await first.page.evaluate(() => Date.now());
      const saved = storageState.origins.flatMap((origin) => origin.localStorage);
      assert.ok(saved.length > 0, "Der erfolgreiche Netzwerkweg wird gespeichert");
      assert.equal(saved.some(({ value }) => value === "0042" || value.includes('"password"')), false,
        "Der Zugangscode wird nicht gespeichert");
      await first.context.close();

      // A restarted browser inherits wall time, including our simulated 25s.
      const second = await open(t, { storageState, clockTime });
      assert.equal(second.requests.length, 0, "Browser-Neustart stellt keine Verbindung ohne Codeeingabe her");
      await start(second.page);
      await assertRelay(second.page, true);
      await second.page.clock.fastForward(timeoutMs + 1);
      await assertRelay(second.page, false);
      await active(second.page);
      assert.equal(second.requests.length, 2, "Beide Netzwerkwege werden genau einmal versucht");
    });

    test("Ausgemusterte Player werden beendet und ihre Nachrichten aktivieren keinen neuen Player", async (t) => {
      const { page } = await open(t);
      const old = await start(page);
      await page.clock.fastForward(timeoutMs + 1);
      await assertRelay(page, true);
      const current = await active(page);
      assert.equal(await old.handle.getAttribute("data-active-player"), null);
      assert.equal(await old.handle.evaluate((element) => element.hidden), true);
      await old.frame.waitForFunction(() =>
        window.commands.some((command) => command.mute === true) &&
        window.commands.some((command) => command.hangup === true));

      await video(page, old.frame, 99999);
      await send(page, old.frame, {
        action: "new-video-track-added", value: true, streamID: STREAM_CONFIG.streamId,
      });
      await state(page, "connecting");
      assert.equal(await page.locator(activeSelector).count(), 1);
      await send(page, old.frame, { action: "hungup", value: true });
      await page.waitForFunction(() => document.querySelectorAll("#playerSlot iframe").length === 1);
      assert.equal(await current.handle.evaluate((element) => element.dataset.activePlayer), "true");
      await becomeLive(page, current.frame);
    });

    test("Ohne Hangup-Antwort wird nur der alte Player nach kurzer Frist entfernt", async (t) => {
      const { page } = await open(t);
      const old = await start(page);
      await page.clock.fastForward(timeoutMs + 1);
      await assertRelay(page, true);
      const current = await active(page);
      assert.equal(await page.locator("#playerSlot iframe").count(), 2);
      await page.clock.fastForward(1_201);
      assert.equal(await old.handle.evaluate((element) => element.isConnected), false);
      assert.equal(await page.locator("#playerSlot iframe").count(), 1);
      assert.equal(await current.handle.evaluate((element) => element.dataset.activePlayer), "true");
    });

    test("Abbrechen beendet auch alle späteren automatischen Verbindungsversuche", async (t) => {
      const { page, requests } = await open(t);
      await start(page);
      await page.clock.fastForward(timeoutMs + 1);
      await assertRelay(page, true);
      await active(page);
      await page.locator("#connectionCancelButton").click();
      await state(page, "offline");
      assert.equal(await page.locator("#accessCodeInput").isEnabled(), true);
      assert.equal(await page.locator("#primaryAction").isEnabled(), true);
      await page.clock.fastForward(180_000);
      assert.equal(requests.length, 2);
      assert.equal(await page.locator("#playerSlot iframe").count(), 0);
      await page.evaluate(() => {
        dispatchEvent(new Event("online"));
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.clock.fastForward(180_000);
      assert.equal(requests.length, 2);
      await start(page);
      assert.equal(requests.length, 3, "Ein bewusster neuer Start bleibt möglich");
    });

    test("Mehrfache Formularübermittlung während des Starts ersetzt den Player nicht", async (t) => {
      const { page, requests } = await open(t);
      const original = await start(page);
      await page.evaluate(() => {
        for (let index = 0; index < 3; index++) {
          document.querySelector("#accessForm").dispatchEvent(new Event("submit", {
            bubbles: true, cancelable: true,
          }));
        }
      });
      await page.clock.runFor(10);
      assert.equal(requests.length, 1);
      assert.equal(await original.handle.evaluate((element) => element.dataset.activePlayer), "true");
      assert.equal(await page.locator("#playerSlot iframe").count(), 1);
    });

    test("Wiederholte Abbrüche und alte Videostatistiken verlängern die 15-Sekunden-Frist nicht", async (t) => {
      const { page } = await open(t);
      const original = await start(page);
      await becomeLive(page, original.frame);
      const disconnect = { action: "view-connection", value: false, streamID: STREAM_CONFIG.streamId };
      await send(page, original.frame, disconnect);
      for (let index = 0; index < 4; index++) {
        await page.clock.fastForward(3_000);
        await video(page, original.frame, 2048);
        await send(page, original.frame, {
          cib: "health", stats: { inbound: { [STREAM_CONFIG.streamId]: {} } },
        });
        await send(page, original.frame, disconnect);
      }
      await page.clock.fastForward(3_010);
      assert.notEqual(await original.handle.getAttribute("data-active-player"), "true");
      await page.clock.fastForward(3_001);
      await state(page, "connecting");
      assert.equal(await page.locator(activeSelector).count(), 1);
    });

    test("Neue Videodaten stellen eine unterbrochene Verbindung innerhalb der Frist wieder her", async (t) => {
      const { page, requests } = await open(t);
      const original = await start(page);
      await becomeLive(page, original.frame);
      await send(page, original.frame, {
        action: "view-connection", value: false, streamID: STREAM_CONFIG.streamId,
      });
      await page.waitForFunction(() => document.querySelector("#playerFrame").dataset.connectionHealth === "recovering");
      await page.clock.fastForward(10_000);
      await video(page, original.frame, 4096);
      await page.waitForFunction(() => document.querySelector("#playerFrame").dataset.connectionHealth === "stable");
      await page.clock.fastForward(6_001);
      await state(page, "live");
      assert.equal(requests.length, 1);
      assert.equal(await original.handle.evaluate((element) => element.dataset.activePlayer), "true");
    });

    test("Ein zurückgesetzter Videozähler braucht neuen Fortschritt, aber nicht den alten Höchstwert", async (t) => {
      const { page, requests } = await open(t);
      const original = await start(page);
      await becomeLive(page, original.frame);
      await send(page, original.frame, {
        action: "view-connection", value: false, streamID: STREAM_CONFIG.streamId,
      });
      await video(page, original.frame, 128);
      assert.equal(await page.locator("#playerFrame").getAttribute("data-connection-health"), "recovering");
      await video(page, original.frame, 256);
      await page.waitForFunction(() => document.querySelector("#playerFrame").dataset.connectionHealth === "stable");
      await state(page, "live");
      assert.equal(requests.length, 1);
    });
  });
}
