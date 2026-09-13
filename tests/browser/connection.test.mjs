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
const timeoutMs = 60_000;
const playerLoadTimeoutMs = 90_000;
const viewerOrigin = new URL(STREAM_CONFIG.viewerBaseUrl).origin;
let server;
let baseUrl;
let messageSequence = 0;

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
        } else if (url.origin === viewerOrigin) {
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
      // Acknowledge delivery after the production message listener has run.
      // Cross-process WebKit delivery need not finish after one clock tick.
      await page.evaluate((origin) => addEventListener("message", (event) => {
        if (event.origin === origin && event.data?.__fixtureMessageId) {
          window.__lastFixtureMessageId = event.data.__fixtureMessageId;
        }
      }), viewerOrigin);
      await page.clock.install(clockTime === undefined ? {} : { time: new Date(clockTime) });
      return { page, context, requests };
    }

    async function active(page, { reportReady = true } = {}) {
      const handle = await page.locator(activeSelector).elementHandle();
      assert.ok(handle, "Ein aktiver Player ist vorhanden");
      const frame = await handle.contentFrame();
      await frame.waitForFunction(() => window.ready);
      if (reportReady) {
        await send(page, frame, { cib: "health", stats: { inbound: {} } });
        await page.waitForFunction(() =>
          document.querySelector("#playerFrame").dataset.connectionPhase === "signaling");
      }
      return { handle, frame };
    }

    async function state(page, expected) {
      await page.waitForFunction((value) =>
        document.querySelector("#playerFrame").dataset.playerState === value, expected);
    }

    async function start(page, options) {
      await page.locator("#accessCodeInput").fill("0042");
      await page.locator("#primaryAction").click();
      await state(page, "connecting");
      return active(page, options);
    }

    async function send(page, frame, message) {
      const id = ++messageSequence;
      await frame.evaluate((data) => parent.postMessage(data, "*"), {
        ...message, __fixtureMessageId: id,
      });
      await page.clock.runFor(1);
      await page.waitForFunction((expected) => window.__lastFixtureMessageId === expected, id);
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

    async function decoded(page, frame, frames = 60, bytes = 6000) {
      await send(page, frame, { cib: "health", stats: { inbound: {
        [STREAM_CONFIG.streamId]: {
          _bytesReceived_video: bytes,
          video: { _type: "video", _framesDecoded: frames, _last_bytes: bytes },
        },
      } } });
    }

    test("Eingefrorene Bilder trotz steigender Bytes: ein Bild anfordern, dann einmal neu verbinden", async (t) => {
      const { page, requests } = await open(t);
      const { frame } = await start(page);
      assert.equal(requests[0].origin, viewerOrigin);
      assert.equal(requests[0].searchParams.get("salt"), "vdo.ninja");
      assert.equal(requests[0].searchParams.get("iframetarget"), new URL(baseUrl).origin);
      await decoded(page, frame);
      await state(page, "live");
      await page.locator("#soundButton").click();
      for (let index = 1; index <= 6; index++) {
        await page.clock.runFor(2000);
        await decoded(page, frame, 60, 6000 + index * 1000);
      }
      assert.equal(await page.locator("#statusLabel").textContent(), "NEU VERBINDEN");
      assert.equal(requests.length, 1, "Kurzer Hänger zerstört den Player nicht");
      assert.equal(await frame.evaluate(() => commands.filter(command => command.sendRequest?.keyframe).length), 1);
      for (let index = 7; index <= 15; index++) {
        await page.clock.runFor(2000);
        await decoded(page, frame, 60, 6000 + index * 1000);
      }
      await state(page, "offline");
      await page.clock.runFor(3001);
      await state(page, "connecting");
      const replacement = await active(page);
      assert.equal(requests.length, 2);
      assert.equal(requests[1].searchParams.get("mutespeaker"), "1");
      const replacementUrl = new URL(await page.locator(activeSelector).getAttribute("src"));
      assert.equal(new URLSearchParams(replacementUrl.hash.slice(1)).get("password"), "0042");
      await decoded(page, replacement.frame, 2, 1000);
      await state(page, "live");
    });

    test("Neue Bilder beenden die Hängerwarnung ohne Playerwechsel", async (t) => {
      const { page, requests } = await open(t);
      const { frame } = await start(page);
      await decoded(page, frame);
      await state(page, "live");
      for (let index = 0; index < 7; index++) {
        await page.clock.runFor(2000);
        await decoded(page, frame);
      }
      assert.equal(await page.locator("#statusLabel").textContent(), "NEU VERBINDEN");
      await decoded(page, frame, 61, 7000);
      assert.equal(await page.locator("#statusLabel").textContent(), "LIVE");
      for (let index = 0; index < 20; index++) {
        await page.clock.runFor(2000);
        await decoded(page, frame, 62 + index, 8000 + index * 1000);
      }
      assert.equal(requests.length, 1);
      assert.equal(await frame.evaluate(() => commands.filter(command => command.sendRequest?.keyframe).length), 1);
    });

    test("Fehlende Statistiken und Hintergrundzeit bestätigen keinen Videostillstand", async (t) => {
      const { page, requests } = await open(t);
      const { frame } = await start(page);
      await decoded(page, frame);
      await state(page, "live");
      await page.clock.runFor(60_000);
      await decoded(page, frame);
      assert.equal(await page.locator("#statusLabel").textContent(), "LIVE");
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      for (let index = 0; index < 20; index++) {
        await page.clock.runFor(2000);
        await decoded(page, frame);
      }
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, value: false });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await decoded(page, frame);
      assert.equal(requests.length, 1);
      assert.equal(await frame.evaluate(() => commands.filter(command => command.sendRequest?.keyframe).length), 0);
      assert.equal(await page.locator("#statusLabel").textContent(), "LIVE");
    });

    test("Null dekodierte Bilder werden durch empfangene Bytes nicht zu LIVE", async (t) => {
      const { page } = await open(t);
      const { frame } = await start(page);
      await decoded(page, frame, 0, 10_000);
      await decoded(page, frame, 0, 20_000);
      await state(page, "connecting");
      await decoded(page, frame, 1, 21_000);
      await state(page, "live");
    });

    test("Erste Videobilder im Hintergrund beenden die Startfrist ohne Neustart", async (t) => {
      const { page, requests } = await open(t);
      const { frame } = await start(page);
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await decoded(page, frame, 1);
      await state(page, "live");
      for (let index = 0; index < 35; index++) {
        await page.clock.runFor(2000);
        await decoded(page, frame, 1);
      }
      assert.equal(requests.length, 1);
      assert.equal(await page.locator("#statusLabel").textContent(), "LIVE");
      assert.equal(await frame.evaluate(() => commands.filter(command => command.sendRequest?.keyframe).length), 0);
    });

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
      await page.clock.fastForward(180_000);
      await state(page, "offline");
      assert.equal(await page.locator(activeSelector).count(), 0,
        "Ein fehlgeschlagener Erststart wiederholt sich nicht endlos");
      await page.locator("#primaryAction").click();
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

      // A restarted browser inherits wall time, including our simulated deadline.
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

    test("Langsames Laden über 25 Sekunden behält den Player bis zur API-Bereitschaft", async (t) => {
      const { page, requests } = await open(t);
      const original = await start(page, { reportReady: false });
      assert.equal(await page.locator("#playerFrame").getAttribute("data-connection-phase"), "loading");
      await page.clock.fastForward(65_000);
      assert.equal(requests.length, 1);
      assert.equal(await original.handle.getAttribute("data-active-player"), "true");
      await send(page, original.frame, { cib: "health", stats: { inbound: {} } });
      assert.equal(await page.locator("#playerFrame").getAttribute("data-connection-phase"), "signaling");
      await page.clock.fastForward(30_000);
      assert.equal(requests.length, 1, "Der ursprüngliche Lade-Timeout ist aufgehoben");
      await becomeLive(page, original.frame);
      assert.equal(await page.locator("#playerFrame").getAttribute("data-connection-phase"), "live");
    });

    test("Frame-Load und defekte Health-Antworten starten die Medienfrist nicht", async (t) => {
      const { page, context, requests } = await open(t);
      const original = await start(page, { reportReady: false });
      await original.handle.evaluate((element) => element.dispatchEvent(new Event("load")));
      for (const stats of [{}, { inbound: null }, { error: "unavailable" }]) {
        await send(page, original.frame, { cib: "health", stats });
      }
      await send(page, original.frame, { action: "new-video-track-added", value: true, streamID: "different-stream" });
      await page.clock.fastForward(timeoutMs + 1);
      assert.equal(requests.length, 1);
      assert.equal(await page.locator("#playerFrame").getAttribute("data-connection-phase"), "loading");
      await page.clock.fastForward(playerLoadTimeoutMs - timeoutMs + 1);
      await state(page, "offline");
      assert.equal(await page.locator("#placeholderTitle").textContent(), "VDO.Ninja konnte nicht geladen werden.");
      await page.clock.fastForward(180_000);
      assert.equal(requests.length, 1, "Kein Relay-Wechsel oder Endlos-Neuladen bei blockiertem Player");
      assert.equal(await page.locator(activeSelector).count(), 0);
      await context.setOffline(true);
      await page.waitForFunction(() => !navigator.onLine);
      await context.setOffline(false);
      await page.waitForFunction(() => navigator.onLine);
      await page.evaluate(() => {
        dispatchEvent(new Event("online"));
        document.dispatchEvent(new Event("visibilitychange"));
        dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
        dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
      });
      await page.clock.fastForward(180_000);
      assert.equal(requests.length, 1, "Netzrückkehr und Seitencache umgehen den manuellen Stopp nicht");
      assert.equal(await page.locator("#placeholderTitle").textContent(), "VDO.Ninja konnte nicht geladen werden.");
      await page.locator("#primaryAction").click();
      await state(page, "connecting");
      await active(page, { reportReady: false });
      assert.equal(requests.length, 2, "Ein manueller neuer Versuch bleibt möglich");
    });

    test("Wiederholte Bereitschaftsantworten verlängern die Medienfrist nicht", async (t) => {
      const { page, context, requests } = await open(t);
      const original = await start(page, { reportReady: false });
      await page.clock.fastForward(40_000);
      await send(page, original.frame, { cib: "health", stats: { inbound: {} } });
      await page.waitForFunction(() =>
        document.querySelector("#playerFrame").dataset.connectionPhase === "signaling");
      for (let index = 0; index < 5; index++) {
        await page.clock.fastForward(10_000);
        await send(page, original.frame, { cib: "health", stats: { inbound: {} } });
      }
      assert.equal(requests.length, 1);
      await page.clock.fastForward(10_010);
      await assertRelay(page, true);
      await active(page);
      assert.equal(requests.length, 2);
      await page.clock.fastForward(timeoutMs + 1);
      await state(page, "offline");
      await context.setOffline(true);
      await page.waitForFunction(() => !navigator.onLine);
      await context.setOffline(false);
      await page.waitForFunction(() => navigator.onLine);
      await page.clock.fastForward(180_000);
      assert.equal(requests.length, 2, "Beide erfolglosen Startwege enden mit manuellem Neustart");
    });

    test("Abbrechen und Codeänderung während des Ladens löschen beide Fristen", async (t) => {
      for (const action of ["cancel", "edit"]) {
        const { page, requests } = await open(t);
        await start(page, { reportReady: false });
        await page.clock.fastForward(35_000);
        if (action === "cancel") await page.locator("#connectionCancelButton").click();
        else await page.locator("#accessCodeInput").fill("0043");
        await state(page, "offline");
        await page.clock.fastForward(playerLoadTimeoutMs + timeoutMs + 180_000);
        assert.equal(requests.length, 1);
        assert.equal(await page.locator("#playerSlot iframe").count(), 0);
        assert.equal(await page.locator("#accessCodeInput").isEnabled(), true);
      }
    });
  });
}
