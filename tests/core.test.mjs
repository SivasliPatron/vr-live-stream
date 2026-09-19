import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readdir } from "node:fs/promises";
import { join, dirname, basename, resolve } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { streamUrl, codeIsValid, identityIsValid, videoSample, sampleAdvanced, transport } from "../docs/protocol.js";
import { freshIdentity, setup } from "../scripts/setup.mjs";
import { nextCode, startHost } from "../scripts/host.mjs";
import { preview } from "../scripts/preview.mjs";

const identity = { id:"test_stream_123456", audience:"test_viewer_123456" };
const sample = overrides => ({ frames:null, bytes:null, stamp:null, fps:null, ...overrides });
async function temp(t) {
  const directory = await mkdtemp(join(tmpdir(),"vr-live-test-"));
  t.after(() => {
    assert.equal(dirname(resolve(directory)),resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("vr-live-test-"));
    return rm(directory,{recursive:true,force:true});
  });
  return directory;
}
async function hostFixture(t) {
  const directory = await temp(t);
  await mkdir(join(directory,".private"));
  const session = { id:"test_stream_123456",publisher:"test_publisher_123456",viewer:"test_viewer_123456",code:"0042" };
  const path = join(directory,".private/session.json"), display = join(directory,".private/ZUGANGSCODE.txt");
  await writeFile(path,JSON.stringify(session)); await writeFile(display,"0042");
  const calls = [], deps = {chrome:async()=>"chrome-test",nextCode:()=>"0731",open:async(exe,args)=>{calls.push({exe,args});}};
  return {directory,session,path,display,calls,deps};
}

test("Only exact four-digit strings and bounded identities are accepted",()=>{
  for (const code of ["0000","0042","9999"]) assert.equal(codeIsValid(code),true);
  for (const code of ["123",1234,"12345"," 1234","12e3","１２３４"]) assert.equal(codeIsValid(code),false);
  assert.equal(identityIsValid(identity),true);
  assert.equal(identityIsValid({...identity,audience:"https://evil.example"}),false);
  assert.throws(()=>streamUrl(identity,"no"));
  assert.throws(()=>streamUrl(identity,"0042",{fps:24}));
  assert.throws(()=>streamUrl(identity,"0042",{parent:"javascript:evil"}));
});
test("Viewer URL: separate audience role, fragment-only PIN, no capture",()=>{
  const url = new URL(streamUrl(identity,"0042",{parent:"https://example.com/path"}));
  assert.equal(url.origin,new URL(transport.base).origin);
  assert.equal(url.searchParams.get("view"),identity.id);
  assert.equal(url.searchParams.get("audience"),identity.audience);
  assert.equal(url.hash,"#password=0042");
  for (const key of ["push","password","screenshare","room","webcam","mic"]) assert.equal(url.searchParams.has(key),false,key);
  assert.equal(url.searchParams.get("iframetarget"),"https://example.com");
  assert.equal(url.searchParams.get("screensharebitrate"),"6000");
  assert.equal(url.searchParams.get("videobitrate"),"6000");
  assert.equal(url.searchParams.get("scale"),"100");
  assert.equal(url.searchParams.get("buffer"),"500");
  assert.equal(url.searchParams.get("mutespeaker"),"0");
});
test("Sender URLs: 720p60 / 30 use same identity, PIN and transport",()=>{
  for (const fps of [30,60]) {
    const url = new URL(streamUrl(identity,"0042",{publisher:true,fps}));
    assert.equal(url.searchParams.get("push"),identity.id);
    assert.equal(url.searchParams.has("view"),false);
    assert.equal(url.searchParams.get("screensharequality"),"1");
    assert.equal(url.searchParams.get("screensharefps"),String(fps));
    assert.equal(url.searchParams.get("systemaudio"),"exclude");
    assert.equal(url.searchParams.get("salt"),transport.salt);
    assert.equal(url.searchParams.has("turn"),false);
    assert.equal(url.hash,"#password=0042");
  }
});
test("Both roles use VDO's current TURN selection without obsolete fixed credentials or ignored recovery flags",()=>{
  for(const options of [{},{nativeControls:true},{publisher:true,fps:60},{publisher:true,fps:30}]) {
    const url=new URL(streamUrl(identity,"0042",options));
    for(const key of ["turn","relay","privacy","autorecover","autorelay"]) {
      assert.equal(url.searchParams.has(key),false,key);
    }
    assert.equal(url.searchParams.get("audience"),identity.audience);
    assert.equal(url.searchParams.get("salt"),transport.salt);
    assert.equal(url.hash,"#password=0042");
  }
});
test("Every sender and viewer disables VDO history rewrites and keeps the PIN fragment-only",()=>{
  for (const options of [{publisher:true,fps:60},{publisher:true,fps:30},{},{nativeControls:true}]) {
    const url = new URL(streamUrl(identity,"0042",options));
    assert.equal(url.searchParams.has("nohistory"),true);
    assert.equal(url.searchParams.has("history"),false);
    assert.equal(new URLSearchParams(url.hash.slice(1)).get("password"),"0042");
    assert.equal(url.searchParams.has("password"),false);
  }
});
test("Native video controls change only the viewer presentation",()=>{
  const normal = new URL(streamUrl(identity,"0042"));
  const safari = new URL(streamUrl(identity,"0042",{nativeControls:true}));
  assert.equal(safari.searchParams.has("videocontrols"),true);
  assert.equal(safari.searchParams.has("cleanish"),true);
  assert.equal(safari.searchParams.has("cleanoutput"),false);
  assert.equal(safari.searchParams.has("fullscreenbutton"),false);
  safari.searchParams.delete("videocontrols");
  assert.equal(safari.href,normal.href);
  assert.equal(streamUrl(identity,"0042",{publisher:true,nativeControls:true}),streamUrl(identity,"0042",{publisher:true}));
});
test("Viewer keeps the in-player Play recovery button without changing sender presentation",()=>{
  for (const nativeControls of [false,true]) {
    const viewer = new URL(streamUrl(identity,"0042",{nativeControls}));
    assert.equal(viewer.searchParams.has("cleanish"),true);
    for (const parameter of ["cleanoutput","clean","hideplaybutton"]) {
      assert.equal(viewer.searchParams.has(parameter),false,parameter);
    }
  }
  for (const fps of [30,60]) {
    const sender = new URL(streamUrl(identity,"0042",{publisher:true,fps}));
    for (const parameter of ["cleanish","cleanoutput","clean","hideplaybutton","videocontrols"]) {
      assert.equal(sender.searchParams.has(parameter),false,parameter);
    }
  }
});
test("Stats reject malformed, transport, audio and contradictory records",()=>{
  for (const stats of [null,[],"bad",{}, {audio:{_type:"audio",_last_bytes:100}},
    {bad:{_type:"audio",type:"Video Stream",_framesDecoded:10}},
    {bad:{_frameWidth:"1280",_frameHeight:"720",_last_bytes:5}}]) assert.equal(videoSample(stats),null);
  assert.deepEqual(videoSample({v:{_type:"video",_framesDecoded:12}}),sample({frames:12}));
  assert.deepEqual(videoSample({v:{type:"Video Stream",FPS:60,_last_time:100}}),sample({fps:60,stamp:100}));
});
test("Only advancing video metrics count; zero frames and cached FPS do not",()=>{
  assert.equal(sampleAdvanced(null,sample({frames:0,bytes:100})),false);
  assert.equal(sampleAdvanced(null,sample({frames:1})),true);
  assert.equal(sampleAdvanced(sample({frames:5}),sample({frames:5,bytes:200})),false);
  assert.equal(sampleAdvanced(sample({frames:5}),sample({frames:2})),false);
  assert.equal(sampleAdvanced(sample({frames:5}),sample({bytes:200})),false);
  assert.equal(sampleAdvanced(sample({fps:60,stamp:10}),sample({fps:60,stamp:10})),false);
  assert.equal(sampleAdvanced(sample({fps:60,stamp:10}),sample({fps:60,stamp:11})),true);
  assert.equal(sampleAdvanced(sample({fps:60,stamp:10}),sample({fps:0,stamp:11})),false);
  assert.equal(sampleAdvanced(sample({bytes:100}),sample({bytes:101})),true);
});
test("Fresh native FPS overrides VDO's cached legacy decoded-frame counter",()=>{
  assert.equal(sampleAdvanced(sample({frames:0,stamp:1,fps:0}),sample({frames:0,stamp:2,fps:60})),true);
  assert.equal(sampleAdvanced(sample({frames:0,stamp:2,fps:60}),sample({frames:0,stamp:2,fps:60})),false);
  assert.equal(sampleAdvanced(sample({frames:100,stamp:2,fps:60}),sample({frames:100,stamp:3,fps:0})),false);
});
test("Random identity and code generation preserve leading zeroes and differ",()=>{
  const identities = Array.from({length:100},freshIdentity);
  assert.equal(new Set(identities.map(item=>item.publisher)).size,100);
  assert.equal(new Set(identities.map(item=>item.id)).size,100);
  for (const item of identities) {
    assert.ok(identityIsValid({id:item.id,audience:item.publisher}));
    assert.match(item.id,/^quest_[a-f0-9]{24}$/);
    assert.equal(item.id,item.id.replace(/[\W]+/g,"_"),"VDO must not normalize a newly generated stream ID");
    assert.ok(codeIsValid(item.code)); assert.equal(item.viewer,null);
  }
  for (let i=0;i<100;i++) { const code=nextCode("0000"); assert.ok(codeIsValid(code)); assert.notEqual(code,"0000"); }
});
test("Fresh setup publishes only viewer identity and reuses private identity",async t=>{
  const directory=await temp(t);await mkdir(join(directory,"docs"));
  let publisher;
  const request=async url=>{const endpoint=new URL(url);assert.equal(endpoint.origin,"https://audience.vdo.ninja");publisher=endpoint.pathname.split("/")[2];return {ok:true,json:async()=>({token:"test_viewer_123456"})};};
  assert.equal((await setup(directory,{request})).newIdentity,true);
  const original=JSON.parse(await readFile(join(directory,".private/session.json")));
  const publicText=await readFile(join(directory,"docs/channel.js"),"utf8");
  assert.equal(publicText.includes(publisher),false);assert.match(publicText,/test_viewer_123456/);
  assert.equal((await setup(directory,{request})).newIdentity,false);
  const current=JSON.parse(await readFile(join(directory,".private/session.json")));
  assert.equal(current.publisher,original.publisher);assert.equal(current.id,original.id);assert.equal(current.code,original.code);
});
test("Setup keeps legacy stream IDs and their publisher keys instead of silently rotating them",async t=>{
  const directory=await temp(t);await mkdir(join(directory,"docs"));await mkdir(join(directory,".private"));
  const original={id:"quest_AbCd_01234-56789",publisher:"test_publisher_0123456789abcdef012345",viewer:"test_viewer_123456",code:"0042",created:"2026-09-13T00:00:00.000Z"};
  const path=join(directory,".private/session.json");
  await writeFile(path,JSON.stringify(original));
  const request=async url=>{
    assert.equal(new URL(url).pathname,`/publish/${original.publisher}/token`);
    return {ok:true,json:async()=>({token:original.viewer})};
  };
  assert.equal((await setup(directory,{request})).newIdentity,false);
  assert.deepEqual(JSON.parse(await readFile(path)),original);
  const publicText=await readFile(join(directory,"docs/channel.js"),"utf8");
  assert.ok(publicText.includes(original.id));assert.equal(publicText.includes(original.publisher),false);
});
test("Setup never publishes the publisher key returned as audience token",async t=>{
  const directory=await temp(t);await mkdir(join(directory,"docs"));
  await assert.rejects(setup(directory,{request:async url=>({ok:true,json:async()=>({token:new URL(url).pathname.split("/")[2]})})}),/getrennten/);
  await assert.rejects(readFile(join(directory,"docs/channel.js")),{code:"ENOENT"});
});
test("Normal sender start rotates PIN; publisher URL remains local",async t=>{
  const f=await hostFixture(t);
  assert.deepEqual(await startHost({directory:f.directory},f.deps),{status:"opened",fps:60});
  assert.equal(JSON.parse(await readFile(f.path)).code,"0731");
  assert.match(await readFile(f.display,"utf8"),/0731/);
  const url=new URL(f.calls[0].args[1]);
  assert.equal(url.searchParams.get("audience"),f.session.publisher);
  assert.equal(url.searchParams.get("screensharefps"),"60");
  assert.equal(f.calls[1].exe,"notepad.exe");
  assert.equal((await readdir(join(f.directory,".private"))).includes("host.lock"),false);
});
test("Fallback keeps PIN; check and code display never rotate it",async t=>{
  const f=await hostFixture(t);
  await startHost({directory:f.directory,fps:30},f.deps);
  assert.equal(JSON.parse(await readFile(f.path)).code,"0042");
  assert.equal(new URL(f.calls[0].args[1]).searchParams.get("screensharefps"),"30");
  f.calls.length=0;
  await startHost({directory:f.directory,check:true},f.deps);
  assert.equal(f.calls.length,0);
  await startHost({directory:f.directory,show:true},f.deps);
  assert.equal(f.calls[0].exe,"notepad.exe");
  assert.equal(JSON.parse(await readFile(f.path)).code,"0042");
});
test("A failed browser start rolls back both local files",async t=>{
  const f=await hostFixture(t), original=await readFile(f.path,"utf8");
  await assert.rejects(startHost({directory:f.directory},{...f.deps,open:async()=>{throw Error("failed");}}),/wiederhergestellt/);
  assert.equal(await readFile(f.path,"utf8"),original);
  assert.equal(await readFile(f.display,"utf8"),"0042");
});
test("Invalid configuration and concurrent start do not change access code",async t=>{
  const f=await hostFixture(t);
  await writeFile(join(f.directory,".private/host.lock"),"");
  await assert.rejects(startHost({directory:f.directory},f.deps),/bereits/);
  assert.equal(f.calls.length,0);
  assert.equal(JSON.parse(await readFile(f.path)).code,"0042");
});
test("Preview serves HTTPS-compatible subpaths and blocks private/traversal/write requests",async t=>{
  const directory=await temp(t), root=join(directory,"docs"); await mkdir(root);
  await writeFile(join(root,"index.html"),"<h1>test</h1>"); await writeFile(join(root,"viewer.js"),"export {};");
  const server=preview(root); server.listen(0,"127.0.0.1"); await once(server,"listening");
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const good=await fetch(`${base}/vr-live-stream/viewer.js?v=2`);
  assert.equal(good.status,200); assert.match(good.headers.get("content-type"),/javascript/);
  assert.equal((await fetch(`${base}/vr-live-stream/`,{method:"HEAD"})).status,200);
  assert.equal((await fetch(`${base}/vr-live-stream`,{redirect:"manual"})).status,308);
  for (const path of ["/.private/session.json","/%2e%2e%2fsecret.js","/vr-live-stream/package.json","/foo/viewer.js"]) assert.equal((await fetch(base+path)).status,404,path);
  assert.equal((await fetch(base+"/%ZZ")).status,400);
  assert.equal((await fetch(base+"/",{method:"POST"})).status,405);
  const outside=join(directory,"private.js"); await writeFile(outside,"secret");
  try { await symlink(outside,join(root,"leak.js")); }
  catch(error) { if (["EPERM","EACCES"].includes(error.code)) { t.diagnostic("Symlink subcheck unavailable without Windows symlink privilege."); return; } throw error; }
  assert.equal((await fetch(base+"/leak.js")).status,404);
});
