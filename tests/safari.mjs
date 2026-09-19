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
  assert.equal(url.searchParams.has("cleanish"),true);
  assert.equal(url.searchParams.has("cleanoutput"),false);
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

test("WebKit touch reaches the embedded Play control after waiting, without reloading",async t=>{
  const context=await browser.newContext({...devices["iPhone 13"]});t.after(()=>context.close());
  const page=await context.newPage();
  // Simulate the documented VDO autoplay prompt, not real iOS media decoding.
  await page.route(`${transport.base}**`,route=>route.fulfill({contentType:"text/html",body:`<!doctype html>
    <button id="play" style="font-size:24px;padding:20px">Play</button><script>
    const query=new URLSearchParams(location.search);
    document.querySelector('#play').hidden=query.has('cleanoutput')&&!query.has('cleanish');
    let playing=false, frames=0;
    document.querySelector('#play').addEventListener('click',()=>{playing=true;document.querySelector('#play').hidden=true;});
    addEventListener('message',event=>{
      if(event.data.getStats)parent.postMessage({stats:playing?{video:{_type:'video',_framesDecoded:++frames}}:null,cib:event.data.cib},event.origin);
    });
  </script>`}));
  await page.goto(base);await page.clock.install();
  await page.locator("#code").fill("0042");await page.locator("#join").tap();
  await page.waitForFunction(()=>document.querySelector("#status").dataset.state==="waiting");
  const frame=page.frames().find(frame=>frame.url().startsWith(transport.base));
  assert.ok(frame);
  const original=frame.url();
  // Neither the outer sound button nor a long wait must cover/remove this control.
  await page.locator("#sound").tap();
  assert.equal(await page.locator("#status").getAttribute("data-state"),"waiting");
  await page.clock.runFor(64000);
  await page.waitForFunction(()=>document.querySelector("#status").dataset.state==="error");
  assert.equal(frame.url(),original);
  await frame.locator("#play").tap();
  await page.clock.runFor(2100);
  await page.waitForFunction(()=>document.querySelector("#status").dataset.state==="live");
  assert.equal(page.frames().filter(frame=>frame.url().startsWith(transport.base)).length,1);
  await page.locator("#stop").tap();
  await page.clock.runFor(2100);
  assert.equal(await page.locator("iframe").count(),0);
});
