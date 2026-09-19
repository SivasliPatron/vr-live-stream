import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { preview } from "../scripts/preview.mjs";
import { transport } from "../docs/protocol.js";

let browser, server, base;
before(async()=>{
  server=preview(); server.listen(0,"127.0.0.1"); await once(server,"listening");
  base=`http://127.0.0.1:${server.address().port}/vr-live-stream/`;
  browser=await chromium.launch({channel:"chrome",headless:true});
  await mkdir(new URL("../test-results/",import.meta.url),{recursive:true});
});
after(async()=>{await browser?.close(); if(server) await new Promise(resolve=>server.close(resolve));});
const fixture=`<!doctype html><html><body style="background:#080810;color:white"><p>Simulierter Videodienst</p><script>
window.reply=true; window.stats=null; window.commands=[];
addEventListener('message',event=>{
  window.commands.push(event.data);
  if(event.data.getStats) { window.last=event.data;
    if(window.reply) parent.postMessage({stats:window.stats,cib:event.data.cib},event.origin);
  }
});
</script></body></html>`;
async function pageFor(t,width=1440,{nativeVideo=false,container=true}={}) {
  const context=await browser.newContext({viewport:{width,height:1000}});
  t.after(()=>context.close());
  if (nativeVideo) await context.addInitScript(({container})=>{
    // Capability simulation only: Chrome is not an iPhone's native video UI.
    HTMLVideoElement.prototype.webkitEnterFullscreen=function(){};
    if (!container) {
      Element.prototype.requestFullscreen=undefined;
      Element.prototype.webkitRequestFullscreen=undefined;
      Object.defineProperty(document,"fullscreenEnabled",{configurable:true,get:()=>false});
    }
  },{container});
  const page=await context.newPage();
  await page.route(`${transport.base}**`,route=>route.fulfill({contentType:"text/html",body:fixture}));
  await page.goto(base); await page.waitForFunction(()=>!document.querySelector("#join").disabled);
  return {page,context};
}
async function start(page) {
  await page.locator("#code").fill("0042"); await page.locator("#join").click();
  await page.waitForFunction(()=>document.querySelector("#status").dataset.state==="waiting");
  return page.frames().find(frame=>frame.url().startsWith(transport.base));
}
// referrer is intentionally suppressed; the explicit iframe target is authoritative.
async function emit(frame,stats) {
  await frame.evaluate(stats=>{window.stats=stats;parent.postMessage({stats,cib:window.last.cib},new URL(location.href).searchParams.get("iframetarget"));},stats);
}
async function state(page,name) { await page.waitForFunction(name=>document.querySelector("#status").dataset.state===name,name); }

test("No auto-join; validation, one click, viewer-only permissions and no PIN storage",async t=>{
  const {page}=await pageFor(t);
  assert.equal(page.frames().length,1);
  await page.locator("#code").fill("12"); await page.locator("#join").click();
  assert.equal(await page.locator("#code").getAttribute("aria-invalid"),"true");
  const frame=await start(page);
  assert.equal(await page.locator("iframe[data-active]").count(),1);
  assert.equal(await page.locator("#welcome").isVisible(),false);
  assert.equal(await page.locator("iframe").getAttribute("allow"),"autoplay; fullscreen");
  const url=new URL(frame.url()); assert.equal(url.searchParams.has("push"),false); assert.equal(url.hash,"#password=0042");
  assert.equal(url.searchParams.has("videocontrols"),false);
  assert.deepEqual(await page.evaluate(()=>[localStorage.length,sessionStorage.length]),[0,0]);
});
test("Null stats prove API readiness, not live video; audio ignored",async t=>{
  const {page}=await pageFor(t); const frame=await start(page);
  await emit(frame,{audio:{_type:"audio",_last_bytes:1000}});
  assert.equal(await page.locator("#status").getAttribute("data-state"),"waiting");
  await emit(frame,{v:{_type:"video",_framesDecoded:1}}); await state(page,"live");
});
test("Cached FPS stalls without iframe churn; fresh samples recover",async t=>{
  const {page}=await pageFor(t); await page.clock.install(); const frame=await start(page);
  const original=frame.url();
  await emit(frame,{v:{_type:"video",FPS:60,_last_time:10}}); await state(page,"live");
  await page.clock.runFor(15000); await state(page,"recovering");
  assert.equal(page.frames().filter(f=>f.url().startsWith(transport.base)).length,1);
  assert.equal(frame.url(),original);
  const nudges=await frame.evaluate(()=>commands.filter(c=>c.sendRequest?.keyframe).length);
  assert.equal(nudges,1);
  await emit(frame,{v:{_type:"video",FPS:60,_last_time:20}}); await state(page,"live");
});
test("Decoder evidence cannot silently downgrade to bytes across missing metrics",async t=>{
  const {page}=await pageFor(t); await page.clock.install(); const frame=await start(page);
  await emit(frame,{v:{_type:"video",_framesDecoded:10}});
  await emit(frame,{v:{_type:"video",_last_bytes:100}});
  await page.clock.runFor(14000); await state(page,"recovering");
  await emit(frame,{v:{_type:"video",_last_bytes:200}});
  assert.equal(await page.locator("#status").getAttribute("data-state"),"recovering");
  await emit(frame,{v:{_type:"video",_framesDecoded:11}}); await state(page,"live");
});
test("A cached initial frame counter cannot hide fresh video FPS",async t=>{
  const {page}=await pageFor(t);await page.clock.install();const frame=await start(page);
  await emit(frame,{v:{_type:"video",_framesDecoded:0,FPS:0,_last_time:1}});
  await emit(frame,{v:{_type:"video",_framesDecoded:0,FPS:60,_last_time:2}});await state(page,"live");
  await page.clock.runFor(14000);await state(page,"recovering");
  await emit(frame,{v:{_type:"video",FPS:60,_last_time:3}});await state(page,"live");
});
test("Waiting deadline keeps player alive and accepts late video",async t=>{
  const {page}=await pageFor(t); await page.clock.install(); const frame=await start(page);
  await page.clock.runFor(64000); await state(page,"error");
  assert.equal(await page.locator("iframe[data-active]").count(),1);
  await emit(frame,{v:{_type:"video",_framesDecoded:1}}); await state(page,"live");
});
test("Long stream loss becomes OFFLINE; a resumed sender returns without reload",async t=>{
  const {page}=await pageFor(t);await page.clock.install();const frame=await start(page);
  await emit(frame,{v:{_type:"video",_framesDecoded:10}});await state(page,"live");
  await page.clock.runFor(64000);await state(page,"offline");
  assert.equal(await page.locator("iframe[data-active]").count(),1);
  await emit(frame,{v:{_type:"video",_framesDecoded:11}});await state(page,"live");
});
test("Unresponsive service has a distinct boot timeout without reload",async t=>{
  const {page}=await pageFor(t); await page.clock.install();
  await page.route(`${transport.base}**`,route=>route.fulfill({contentType:"text/html",body:"<body>Silent service</body>"}));
  await page.locator("#code").fill("0042"); await page.locator("#join").click();
  await page.clock.runFor(48000); await state(page,"error");
  assert.match(await page.locator("#notice").textContent(),/Videodienst antwortet nicht/);
  assert.equal(await page.locator("iframe[data-active]").count(),1);
});
test("Reconnect respects mute; stale messages and explicit stop cannot revive player",async t=>{
  const {page}=await pageFor(t); await page.clock.install(); const old=await start(page);
  await page.locator("#sound").click(); assert.equal(await page.locator("#sound").getAttribute("aria-pressed"),"false");
  await page.locator("#reconnect").click(); await state(page,"waiting");
  await old.evaluate(()=>parent.postMessage({stats:{v:{_type:"video",_framesDecoded:20}},cib:window.last.cib},new URL(location.href).searchParams.get("iframetarget")));
  assert.equal(await page.locator("#status").getAttribute("data-state"),"waiting");
  const current=page.frames().find(f=>f!==old&&f.url().startsWith(transport.base));
  assert.equal(new URL(current.url()).searchParams.get("mutespeaker"),"1");
  await page.locator("#stop").click();
  await page.evaluate(()=>{window.dispatchEvent(new Event("online"));document.dispatchEvent(new Event("visibilitychange"));});
  await page.clock.runFor(70000);
  assert.equal(await page.locator("iframe").count(),0); await state(page,"idle");
  assert.equal(await page.locator("#code").isDisabled(),false);
});
test("Messages from wrong window cannot fabricate LIVE",async t=>{
  const {page}=await pageFor(t); await start(page);
  await page.evaluate(origin=>window.dispatchEvent(new MessageEvent("message",{origin,source:window,data:{cib:"vr2:1",stats:{v:{_type:"video",_framesDecoded:10}}}})),new URL(transport.base).origin);
  assert.equal(await page.locator("#status").getAttribute("data-state"),"waiting");
});
test("Offline prevents joining; network changes preserve current frame",async t=>{
  const {page,context}=await pageFor(t);
  await context.setOffline(true); await page.locator("#code").fill("0042"); await page.locator("#join").click(); await state(page,"error");
  assert.equal(page.frames().length,1);
  await context.setOffline(false); const frame=await start(page);
  await context.setOffline(true); await state(page,"recovering");
  assert.ok(page.frames().includes(frame));
  await context.setOffline(false);
});
test("Blocked native fullscreen never enlarges the window and keeps persistent help",async t=>{
  const {page}=await pageFor(t,390); const frame=await start(page);
  const before=await page.locator("#stage").boundingBox();
  await page.evaluate(()=>{document.querySelector("#stage").requestFullscreen=()=>Promise.reject(Error("blocked"));});
  await page.locator("#fullscreen").click(); await page.locator("#fullscreenHelp").waitFor({state:"visible"});
  assert.equal(await page.locator("#stage").evaluate(el=>getComputedStyle(el).position),"relative");
  assert.deepEqual(await page.locator("#stage").boundingBox(),before);
  assert.equal(await page.locator("#fullscreen").getAttribute("aria-pressed"),"false");
  assert.equal(await page.locator("#exitFull").isVisible(),false);
  assert.equal(await page.locator(".controls").evaluate(el=>el.inert),false);
  assert.equal(await page.locator("#stage").getAttribute("aria-modal"),null);
  await emit(frame,{v:{_type:"video",_framesDecoded:1}});await state(page,"live");
  assert.equal(await page.locator("#fullscreenHelp").isVisible(),true);
});
test("Video-only fullscreen capability enables native viewer controls without a false outer button",async t=>{
  const {page}=await pageFor(t,390,{nativeVideo:true,container:false});
  assert.equal(await page.locator("#fullscreen").isVisible(),false);
  assert.equal(await page.locator("#fullscreenHelp").isVisible(),false);
  const frame=await start(page);const original=frame.url();
  assert.equal(new URL(original).searchParams.has("videocontrols"),true);
  assert.equal(new URL(original).searchParams.has("cleanish"),true);
  assert.equal(new URL(original).searchParams.has("cleanoutput"),false);
  assert.equal(new URL(original).searchParams.has("fullscreenbutton"),false);
  assert.equal(await page.locator("#fullscreen").isVisible(),false);
  assert.match(await page.locator("#fullscreenHelp").textContent(),/tippe ins Video.*Vollbild-Symbol/);
  await emit(frame,{v:{_type:"video",_framesDecoded:1}});await state(page,"live");
  assert.equal(await page.locator("#fullscreenHelp").isVisible(),true);
  assert.equal(frame.url(),original);
  assert.equal(await page.locator(".controls").evaluate(el=>el.inert),false);
  assert.equal(await page.locator("#stage").getAttribute("aria-modal"),null);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator("#sound").click();await page.locator("#reconnect").click();await state(page,"waiting");
  const current=new URL(await page.locator("iframe[data-active]").getAttribute("src"));
  assert.equal(current.searchParams.has("videocontrols"),true);
  assert.equal(current.searchParams.get("mutespeaker"),"1");assert.equal(current.hash,"#password=0042");
  await page.locator("#stop").click();
  assert.equal(await page.locator("#fullscreenHelp").isVisible(),false);
});
test("Video API alongside container fullscreen retains the real outer fullscreen path",async t=>{
  const {page}=await pageFor(t,768,{nativeVideo:true});await start(page);
  assert.equal(await page.locator("#fullscreen").isVisible(),true);
  await page.locator("#fullscreen").click();await page.waitForFunction(()=>document.fullscreenElement?.id==="stage");
  assert.equal(await page.locator("#fullscreenHelp").isVisible(),false);
  await page.locator("#exitFull").click();await page.waitForFunction(()=>!document.fullscreenElement);
});
test("Failed container fullscreen on a video-capable browser explains native controls without reconnecting",async t=>{
  const {page}=await pageFor(t,390,{nativeVideo:true});const frame=await start(page);const original=frame.url();
  await page.evaluate(()=>{document.querySelector("#stage").requestFullscreen=()=>Promise.reject(Error("blocked"));});
  await page.locator("#fullscreen").click();await page.locator("#fullscreenHelp").waitFor({state:"visible"});
  assert.match(await page.locator("#fullscreenHelp").textContent(),/Vollbild-Symbol/);
  assert.equal(frame.url(),original);assert.equal(await page.locator("iframe[data-active]").count(),1);
  assert.equal(await page.locator("#fullscreen").getAttribute("aria-pressed"),"false");
});
test("Unavailable and policy-disabled fullscreen produce help without a request",async t=>{
  const {page}=await pageFor(t);await start(page);
  await page.evaluate(()=>{
    window.fullCalls=0;
    document.querySelector("#stage").requestFullscreen=()=>{window.fullCalls++;};
    Object.defineProperty(document,"fullscreenEnabled",{configurable:true,get:()=>false});
  });
  await page.locator("#fullscreen").click();assert.equal(await page.evaluate(()=>window.fullCalls),0);
  assert.equal(await page.locator("#fullscreenHelp").isVisible(),true);
  await page.evaluate(()=>{
    delete document.fullscreenEnabled;
    document.querySelector("#stage").requestFullscreen=undefined;
    document.querySelector("#stage").webkitRequestFullscreen=undefined;
  });
  await page.locator("#fullscreen").click();assert.equal(await page.locator("#fullscreenHelp").isVisible(),true);
  assert.equal(await page.locator(".controls").evaluate(el=>el.inert),false);
});
test("Synchronous failure can be retried with a native hide-navigation request",async t=>{
  const {page}=await pageFor(t);await start(page);
  await page.evaluate(()=>{document.querySelector("#stage").requestFullscreen=()=>{throw Error("blocked");};});
  await page.locator("#fullscreen").click();assert.equal(await page.locator("#fullscreenHelp").isVisible(),true);
  await page.evaluate(()=>{
    document.querySelector("#stage").requestFullscreen=function(options){window.fullOptions=options;return Element.prototype.requestFullscreen.call(this,options);};
  });
  await page.locator("#fullscreen").click();await page.waitForFunction(()=>document.fullscreenElement?.id==="stage");
  assert.deepEqual(await page.evaluate(()=>window.fullOptions),{navigationUI:"hide"});
  assert.equal(await page.locator("#fullscreenHelp").isVisible(),false);
  await page.locator("#exitFull").click();
});
test("Prefixed fullscreen may complete after its void return",async t=>{
  const {page}=await pageFor(t);await page.clock.install();await start(page);
  await page.evaluate(()=>{
    const stage=document.querySelector("#stage");stage.requestFullscreen=undefined;
    stage.webkitRequestFullscreen=()=>{setTimeout(()=>{Object.defineProperty(document,"webkitFullscreenElement",{configurable:true,get:()=>stage});document.dispatchEvent(new Event("webkitfullscreenchange"));},2000);};
  });
  await page.locator("#fullscreen").click();await page.clock.runFor(2100);
  assert.equal(await page.locator("#fullscreen").getAttribute("aria-pressed"),"true");
  assert.equal(await page.locator("#fullscreenHelp").isVisible(),false);
  assert.equal(await page.locator("#exitFull").isVisible(),true);
});
test("A timed-out native request cannot create fake or late fullscreen",async t=>{
  const {page}=await pageFor(t);await page.clock.install();await start(page);
  await page.evaluate(()=>{
    document.querySelector("#stage").requestFullscreen=()=>new Promise(()=>{});
    document.exitFullscreen=()=>{delete document.fullscreenElement;document.dispatchEvent(new Event("fullscreenchange"));return Promise.resolve();};
  });
  await page.locator("#fullscreen").click();await page.clock.runFor(5100);
  assert.equal(await page.locator("#fullscreenHelp").isVisible(),true);
  assert.equal(await page.locator("#fullscreen").getAttribute("aria-pressed"),"false");
  await page.evaluate(()=>{
    Object.defineProperty(document,"fullscreenElement",{configurable:true,get:()=>document.querySelector("#stage")});document.dispatchEvent(new Event("fullscreenchange"));
  });
  assert.equal(await page.evaluate(()=>Boolean(document.fullscreenElement)),false);
  assert.equal(await page.locator(".controls").evaluate(el=>el.inert),false);
});
test("Stop cancels pending fullscreen and ignores a later failure",async t=>{
  const {page}=await pageFor(t);await page.clock.install();await start(page);
  await page.evaluate(()=>{document.querySelector("#stage").requestFullscreen=()=>new Promise((resolve,reject)=>{window.rejectFull=reject;});});
  await page.locator("#fullscreen").click();await page.locator("#stop").click();
  await page.evaluate(()=>window.rejectFull(Error("late")));await page.clock.runFor(6000);
  await state(page,"idle");assert.equal(await page.locator("#fullscreenHelp").isVisible(),false);
  assert.equal(await page.locator(".controls").evaluate(el=>el.inert),false);
  assert.equal(await page.locator("#stage").getAttribute("aria-modal"),null);
});
test("Hung fullscreen exit does not leave stopped controls inert",async t=>{
  const {page}=await pageFor(t); await page.clock.install(); await start(page);
  await page.evaluate(()=>{
    const stage=document.querySelector("#stage"); stage.requestFullscreen=()=>{Object.defineProperty(document,"fullscreenElement",{configurable:true,get:()=>stage});document.dispatchEvent(new Event("fullscreenchange"));return Promise.resolve();};
    document.exitFullscreen=()=>new Promise(()=>{});
  });
  await page.locator("#fullscreen").click();
  await page.evaluate(()=>document.querySelector("#stop").click()); await page.clock.runFor(1500);
  assert.equal(await page.locator(".controls").evaluate(el=>el.inert),false);
  await state(page,"idle");
});
test("Native fullscreen opens and closes in installed Chrome",async t=>{
  const {page}=await pageFor(t); await start(page);
  await page.locator("#fullscreen").click();
  await page.waitForFunction(()=>document.fullscreenElement?.id==="stage");
  assert.ok(await page.locator("#stage").evaluate(el=>{
    const box=el.getBoundingClientRect();return box.x===0&&box.y===0&&Math.abs(box.width-innerWidth)<1&&Math.abs(box.height-innerHeight)<1;
  }));
  assert.equal(await page.locator("#stage").evaluate(el=>getComputedStyle(el).borderRadius),"0px");
  await page.locator("#exitFull").click(); await page.waitForFunction(()=>!document.fullscreenElement);
  assert.equal(await page.locator(".controls").evaluate(el=>el.inert),false);
  assert.equal(await page.locator("#fullscreen").evaluate(el=>document.activeElement===el),true);
});
test("Native fullscreen initiated inside the player remains open",async t=>{
  const {page}=await pageFor(t);const frame=await start(page);
  await frame.evaluate(()=>{document.body.addEventListener("click",()=>document.body.requestFullscreen());});
  await frame.locator("p").click();
  await page.waitForFunction(()=>document.fullscreenElement===document.querySelector("iframe[data-active]"));
  assert.equal(await frame.evaluate(()=>document.fullscreenElement===document.body),true);
  assert.equal(await page.locator("#fullscreen").getAttribute("aria-pressed"),"true");
  assert.equal(await page.locator("#exitFull").getAttribute("hidden"),"");
  await frame.evaluate(()=>document.exitFullscreen());
  await page.waitForFunction(()=>!document.fullscreenElement);
  assert.equal(await page.locator(".controls").evaluate(el=>el.inert),false);
});
test("Simulated nested events preserve accepted stage fullscreen ownership",async t=>{
  const {page}=await pageFor(t);await start(page);
  await page.locator("#fullscreen").click();await page.waitForFunction(()=>document.fullscreenElement?.id==="stage");
  await page.evaluate(()=>{
    Object.defineProperty(document,"fullscreenElement",{configurable:true,get:()=>document.querySelector("iframe[data-active]")});
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  assert.equal(await page.locator("#exitFull").getAttribute("hidden"),"");
  await page.evaluate(()=>{delete document.fullscreenElement;document.dispatchEvent(new Event("fullscreenchange"));});
  await page.waitForFunction(()=>document.fullscreenElement?.id==="stage");
  assert.equal(await page.locator("#exitFull").isVisible(),true);
  assert.equal(await page.locator(".controls").evaluate(el=>el.inert),true);
  await page.locator("#exitFull").click();await page.waitForFunction(()=>!document.fullscreenElement);
  assert.equal(await page.locator(".controls").evaluate(el=>el.inert),false);
});
test("Responsive layout has no horizontal overflow at 320–1440px",async t=>{
  const {page}=await pageFor(t);
  for (const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:1000});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}px`);
    assert.equal(await page.locator("#join").isVisible(),true);
    if([390,1440].includes(width)) await page.screenshot({path:fileURLToPath(new URL(`../test-results/viewer-${width}.png`,import.meta.url)),fullPage:true});
  }
});
