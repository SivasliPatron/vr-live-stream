// WebKit with an iPhone viewport is not physical iOS/AVKit. No real stream joined.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { webkit, devices } from "playwright";
import { once } from "node:events";
import { preview } from "../scripts/preview.mjs";
import { transport } from "../docs/protocol.js";

let browser, server, base;
before(async()=>{
  server=preview();server.listen(0,"127.0.0.1");await once(server,"listening");
  base=`http://127.0.0.1:${server.address().port}/vr-live-stream/`;
  browser=await webkit.launch({headless:true});
});
after(async()=>{await browser?.close();if(server) await new Promise(resolve=>server.close(resolve));});

test("WebKit touch viewer: join, native-controls capability, orientation and stop",async t=>{
  const context=await browser.newContext({...devices["iPhone 13"]});t.after(()=>context.close());
  const page=await context.newPage(), errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.route(`${transport.base}**`,route=>route.fulfill({contentType:"text/html",body:`<!doctype html><p>Simulierter Videodienst</p><script>
    addEventListener('message',event=>{if(event.data.getStats)parent.postMessage({stats:null,cib:event.data.cib},event.origin);});
  </script>`}));
  await page.goto(base);await page.waitForFunction(()=>!document.querySelector("#join").disabled);
  const nativeVideo=await page.evaluate(()=>typeof document.createElement("video").webkitEnterFullscreen==="function");
  await page.locator("#code").fill("0042");await page.locator("#join").tap();
  await page.waitForFunction(()=>document.querySelector("#status").dataset.state==="waiting");
  const url=new URL(await page.locator("iframe[data-active]").getAttribute("src"));
  assert.equal(url.searchParams.has("videocontrols"),nativeVideo);
  assert.equal(url.searchParams.has("push"),false);assert.equal(url.hash,"#password=0042");
  assert.equal(await page.locator("iframe[data-active]").getAttribute("allow"),"autoplay; fullscreen");
  for(const viewport of [{width:390,height:844},{width:844,height:390}]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.equal(await page.locator("#sound").isVisible(),true);
  }
  await page.locator("#sound").tap();assert.equal(await page.locator("#sound").getAttribute("aria-pressed"),"false");
  await page.locator("#stop").tap();assert.equal(await page.locator("#code").isDisabled(),false);
  assert.equal(await page.locator("#fullscreenHelp").isVisible(),false);
  assert.deepEqual(errors,[]);
});
