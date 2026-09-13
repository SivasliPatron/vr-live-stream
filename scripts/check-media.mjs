// Opt-in integration check. Publishes ONLY a generated canvas and synthetic tone.
// Not part of npm test; never accesses physical capture devices.
import { chromium } from "playwright";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { streamUrl, transport } from "../docs/protocol.js";
import { preview } from "./preview.mjs";
const local=JSON.parse(await readFile(new URL("../.private/session.json",import.meta.url),"utf8"));
const primary=process.argv.includes("--primary"), serviceBase=primary?"https://vdo.ninja/":transport.base;
let browser, server, publisher, viewer, observe, seededId;
const report={syntheticOnly:true,service:serviceBase,publisherLoaded:false,captureStarted:false,viewerReady:false,live:false,decodedFrames:0,width:0,height:0,playing:false};
function redact(text) { for(const secret of [local.id,local.publisher,local.viewer,local.code]) text=text.replaceAll(secret,"[redacted]");return text; }
function watchSockets(page,role) {
  const pending=new Map();
  page.on("request",request=>{if(["fetch","xhr"].includes(request.resourceType()))pending.set(request,redact(request.url()));});
  page.on("requestfinished",request=>pending.delete(request));
  page.on("requestfailed",request=>{pending.delete(request);(report.failedRequests??=[]).push({role,url:redact(request.url()).slice(0,200),error:request.failure()?.errorText});});
  const snapshot=setInterval(()=>{report[`${role}Pending`]=[...pending.values()];},1000);
  page.on("close",()=>clearInterval(snapshot));
  page.on("websocket",socket=>{
    const summary={role,host:new URL(socket.url()).hostname,sent:[],received:[],closed:false};
    (report.sockets??=[]).push(summary);
    socket.on("framesent",event=>{try {const data=JSON.parse(event.payload);if(data.request==="seed")seededId=data.streamID;if(data.request==="play")report.requestedSeedMatches=seededId===data.streamID;if(summary.sent.length<20)summary.sent.push({keys:Object.keys(data),request:data.request??null});}catch{}});
    socket.on("framereceived",event=>{try {const data=JSON.parse(event.payload);if(data.token)report.audienceTokenMatches=data.token===local.viewer;if(summary.received.length<20)summary.received.push({keys:Object.keys(data),request:data.request??null});}catch{}});
    socket.on("close",()=>{summary.closed=true;});
  });
}
async function waitUntil(predicate,milliseconds) {
  const deadline=Date.now()+milliseconds;
  while(Date.now()<deadline) {if(predicate())return true;await new Promise(resolve=>setTimeout(resolve,250));}
  return false;
}
try {
  server=preview();server.listen(0,"127.0.0.1");await once(server,"listening");
  browser=await chromium.launch({channel:"chrome",headless:true});
  const sendContext=await browser.newContext();
  await sendContext.addInitScript(()=>{
    navigator.mediaDevices.getUserMedia=()=>Promise.reject(new Error("Physical devices disabled for this test"));
    navigator.mediaDevices.getDisplayMedia=async()=>{
      window.syntheticCaptureRequested=true;
      const canvas=document.createElement("canvas");canvas.width=1280;canvas.height=720;
      const ctx=canvas.getContext("2d");let count=0;
      const draw=()=>{ctx.fillStyle="#171127";ctx.fillRect(0,0,1280,720);ctx.fillStyle="#bca8ff";ctx.font="42px sans-serif";ctx.fillText("VR LIVE — TECHNIKTEST, KEINE QUEST",70,120);ctx.fillText(String(++count),70,200);ctx.fillRect(70+count%1050,330,70,70);};
      draw();setInterval(draw,1000/60);
      const stream=canvas.captureStream(60);
      const ac=new AudioContext(), oscillator=ac.createOscillator(), gain=ac.createGain(), destination=ac.createMediaStreamDestination();
      gain.gain.value=.01;oscillator.connect(gain);gain.connect(destination);oscillator.start();void ac.resume();
      stream.addTrack(destination.stream.getAudioTracks()[0]);
      window.syntheticCapture=true;return stream;
    };
  });
  publisher=await sendContext.newPage();
  watchSockets(publisher,"publisher");
  publisher.setDefaultTimeout(10000);
  const senderUrl=streamUrl({id:local.id,audience:local.publisher},local.code,{publisher:true}).replace(transport.base,serviceBase);
  await publisher.goto(senderUrl,{waitUntil:"domcontentloaded",timeout:45000});report.publisherLoaded=true;
  await publisher.waitForFunction(()=>document.readyState==="complete",{},{timeout:45000});
  // Inspect only button labels, never URLs, inputs, raw service messages or keys.
  if(!await publisher.evaluate(()=>Boolean(window.syntheticCapture))) {
    const share=publisher.locator(".mainScreenShareButton").first();
    await share.waitFor({state:"visible",timeout:30000}).catch(()=>{});
    // Upstream continuously animates this button; skip only stability waiting.
    if(await share.isVisible()) await share.click({force:true});
  }
  report.captureStarted=await publisher.waitForFunction(()=>Boolean(window.syntheticCapture),{},{timeout:10000}).then(()=>true,()=>false);
  console.log(JSON.stringify({stage:"capture",started:report.captureStarted,requested:await publisher.evaluate(()=>Boolean(window.syntheticCaptureRequested))}));
  if(!report.captureStarted) {
    let ui=await publisher.locator("body").innerText();
    for(const secret of [local.id,local.publisher,local.viewer,local.code,senderUrl]) ui=ui.replaceAll(secret,"[redacted]");
    console.log(JSON.stringify({stage:"publisher-wait",ui:ui.slice(0,1800)}));
    throw Error("synthetic-capture-not-started");
  }
  report.publisherSeedConfirmed=await waitUntil(()=>report.sockets?.some(s=>s.role==="publisher"&&s.sent.some(m=>m.request==="seed")&&s.received.some(m=>m.keys.includes("token"))),60000);
  console.log(JSON.stringify({stage:"publisher-signaling",ready:report.publisherSeedConfirmed}));
  if(!report.publisherSeedConfirmed) throw Error("publisher-seed-not-confirmed");
  const viewContext=await browser.newContext();viewer=await viewContext.newPage();
  if(primary) {
    const replaceBase=text=>text.replaceAll(transport.base,serviceBase);
    await viewer.route("**/vr-live-stream/protocol.js*",async route=>route.fulfill({contentType:"application/javascript",body:replaceBase(await readFile(new URL("../docs/protocol.js",import.meta.url),"utf8"))}));
    await viewer.route("**/vr-live-stream/",async route=>route.fulfill({contentType:"text/html",body:replaceBase(await readFile(new URL("../docs/index.html",import.meta.url),"utf8"))}));
  }
  watchSockets(viewer,"viewer");
  await viewer.goto(`http://127.0.0.1:${server.address().port}/vr-live-stream/`);
  await viewer.evaluate(()=>{
    window.vrStats=null;window.vrAllStats=null;
    addEventListener("message",event=>{
      if(event.source!==document.querySelector("iframe[data-active]")?.contentWindow || !event.data || !("stats" in event.data))return;
      if(event.data.cib==="vr-diagnostic")window.vrAllStats=event.data.stats;else window.vrStats=event.data.stats;
    });
  });
  await viewer.locator("#code").fill(local.code);const started=Date.now();await viewer.locator("#join").click();
  observe=setInterval(async()=>{
    try {
      const frame=viewer.frames().find(f=>f.url().startsWith(serviceBase));
      const videos=frame?await frame.evaluate(()=>[...document.querySelectorAll("video")].map(v=>({width:v.videoWidth,height:v.videoHeight,paused:v.paused,decoded:v.getVideoPlaybackQuality?.().totalVideoFrames??0}))):[];
      const statsShape=await viewer.evaluate(({origin,id})=>{
        document.querySelector("iframe[data-active]")?.contentWindow.postMessage({getStats:true,cib:"vr-diagnostic"},origin);
        const tracks=[];
        const walk=(value,depth=0)=>{if(!value||typeof value!=="object"||depth>5)return;
          if("_type" in value||"FPS" in value||"_framesDecoded" in value||"_frameWidth" in value) {
            const record={};for(const key of ["_type","type","FPS","_framesDecoded","_last_time","_last_bytes","_frameWidth","_frameHeight"])if(key in value)record[key]=value[key];tracks.push(record);
          }
          for(const child of Object.values(value))if(child&&typeof child==="object")walk(child,depth+1);
        };
        walk(window.vrAllStats);
        return {targetedNull:window.vrStats===null,rootPresent:Boolean(window.vrAllStats?.inbound?.[id]),screenPresent:Boolean(window.vrAllStats?.inbound?.[id+":s"]),keys:Object.keys(window.vrAllStats?.inbound??{}).map(key=>({same:key===id,starts:key.startsWith(id),extra:key.length-id.length})),tracks};
      },{origin:new URL(serviceBase).origin,id:local.id});
      console.log(JSON.stringify({stage:"receiving",state:await viewer.locator("#status").getAttribute("data-state"),videos,statsShape}));
    } catch { /* Probe teardown may overlap with this read-only sample. */ }
  },10000);
  await viewer.waitForFunction(()=>document.querySelector("#status").dataset.state==="live",{},{timeout:60000});
  report.live=true;report.joinMilliseconds=Date.now()-started;
  const frame=viewer.frames().find(f=>f.url().startsWith(serviceBase));
  report.viewerReady=Boolean(frame);
  await new Promise(resolve=>setTimeout(resolve,20000));
  if(frame) Object.assign(report,await frame.evaluate(()=>{
    const video=[...document.querySelectorAll("video")].find(v=>v.videoWidth>0);
    return video?{decodedFrames:video.getVideoPlaybackQuality?.().totalVideoFrames??0,width:video.videoWidth,height:video.videoHeight,playing:!video.paused,mediaTime:video.currentTime,audioTracks:video.srcObject?.getAudioTracks().length??0}:{decodedFrames:0};
  }));
  await mkdir(new URL("../test-results/",import.meta.url),{recursive:true});
  // Stage only: avoids photographing the locally entered PIN.
  await viewer.locator("#stage").screenshot({path:fileURLToPath(new URL("../test-results/synthetic-video.png",import.meta.url))});
} catch(error) {
  report.failed=true;
  let detail=String(error?.message??"Unknown test failure");
  for(const secret of [local.id,local.publisher,local.viewer,local.code]) detail=detail.replaceAll(secret,"[redacted]");
  report.detail=detail.slice(0,1800);
  if(publisher) {
    report.publisherUi=redact(await publisher.locator("body").innerText()).slice(0,1000);
    report.publisherVideos=await publisher.evaluate(()=>[...document.querySelectorAll("video")].map(v=>({width:v.videoWidth,height:v.videoHeight,paused:v.paused})));
  }
  if(viewer) {
    report.viewerState=await viewer.locator("#status").getAttribute("data-state").catch(()=>"unavailable");
    const frame=viewer.frames().find(f=>f.url().startsWith(serviceBase));
    if(frame) report.receivedVideos=await frame.evaluate(()=>[...document.querySelectorAll("video")].map(v=>({width:v.videoWidth,height:v.videoHeight,paused:v.paused,readyState:v.readyState,decoded:v.getVideoPlaybackQuality?.().totalVideoFrames??0})));
  }
} finally {
  clearInterval(observe);
  await browser?.close();if(server) await new Promise(resolve=>server.close(resolve));
}
await mkdir(new URL("../test-results/",import.meta.url),{recursive:true});
await writeFile(new URL("../test-results/service-media.json",import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
process.exit(report.live&&report.decodedFrames>0&&report.playing?0:1);
