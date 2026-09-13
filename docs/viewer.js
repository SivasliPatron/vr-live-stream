import { channel } from "./channel.js?v=2";
import { transport, codeIsValid, identityIsValid, streamUrl, videoSample, sampleAdvanced } from "./protocol.js?v=2";

const $ = id => document.getElementById(id);
const ui = Object.fromEntries(["status","statusText","screen","stage","welcome","joinForm","code","join","sound","fullscreen","exitFull","reconnect","stop","notice"].map(id => [id,$(id)]));
const origin = new URL(transport.base).origin;
const labels = { idle:"OFFLINE", offline:"OFFLINE", loading:"PLAYER LÄDT", waiting:"VERBINDEN", live:"LIVE", recovering:"NEU VERBINDEN", error:"KEIN BILD" };
let frame = null, poll = null, generation = 0, phase = "idle", muted = false;
let started = 0, readyAt = null, lastProgress = 0, lastSample = null, hasVideo = false, nudgeAt = 0;
let fullPending = false, fullRequested = false, fullToken = 0;
const background = new Map();

function state(next, message) {
  phase = next;
  ui.status.dataset.state = next;
  ui.statusText.textContent = labels[next];
  if (message !== undefined) ui.notice.textContent = message;
  ui.notice.dataset.error = String(next === "error");
}
function send(data, target = frame) { target?.contentWindow?.postMessage(data, origin); }
function sound() {
  send({ mute: muted }); send({ volume: 1 });
  ui.sound.textContent = muted ? "Ton aus" : "Ton an";
  ui.sound.setAttribute("aria-pressed", String(!muted));
  ui.sound.setAttribute("aria-label", muted ? "Ton einschalten" : "Ton ausschalten / Wiedergabe freigeben");
}
function retire() {
  const old = frame; frame = null;
  clearInterval(poll); poll = null;
  if (!old) return;
  old.hidden = true; old.removeAttribute("data-active");
  send({ mute:true }, old); send({ hangup:true }, old);
  setTimeout(() => old.remove(), 1000);
}
function controls(active) {
  ui.code.disabled = active;
  ui.join.disabled = active || !identityIsValid(channel);
  ui.sound.disabled = !active; ui.fullscreen.disabled = !active;
  ui.reconnect.disabled = !active; ui.stop.hidden = !active;
  ui.welcome.hidden = active;
}
function stop(message = "Stream beendet. Du kannst jederzeit neu starten.") {
  generation++; retire(); hasVideo = false; lastSample = null;
  controls(false); void exitFull(); state("idle", message);
}
function tick() {
  if (!frame) return;
  const now = performance.now();
  send({ getStats:true, streamID:channel.id, cib:`vr2:${generation}` });
  if (!navigator.onLine) { state("recovering", "Dein Gerät ist offline. Die Verbindung wird bei Rückkehr weiter versucht."); return; }
  if (document.hidden) { lastProgress = now; return; }
  if (readyAt === null && now - started > 45000) {
    state("error", "Der Videodienst antwortet nicht. Neu verbinden oder später erneut versuchen.");
  } else if (!hasVideo && readyAt !== null && now - readyAt > 60000) {
    state("error", "Noch kein Bild. Prüfe Sender und aktuellen Code. Der Player bleibt geöffnet.");
  } else if (hasVideo && now - lastProgress > 60000) {
    state("offline", "Kein Streamempfang mehr. Prüfe den Sender. Der Player wartet weiter auf eine Rückkehr.");
  } else if (hasVideo && now - lastProgress > 12000) {
    state("recovering", "Keine neuen Videobilder. Die Verbindung wird wiederhergestellt.");
    if (!nudgeAt) { send({ sendRequest:{ keyframe:true } }); nudgeAt = now; }
  }
}
function join() {
  const code = ui.code.value.trim();
  if (!codeIsValid(code)) {
    ui.code.setAttribute("aria-invalid","true"); ui.code.focus();
    state("idle", "Bitte genau vier Ziffern eingeben."); return;
  }
  if (!identityIsValid(channel)) { state("error", "Der Stream ist noch nicht eingerichtet."); return; }
  if (!navigator.onLine) { state("error", "Dein Gerät ist offline. Prüfe deine Internetverbindung."); return; }
  ui.code.setAttribute("aria-invalid","false");
  generation++; retire();
  readyAt = null; started = performance.now(); lastProgress = started;
  lastSample = null; hasVideo = false; nudgeAt = 0;
  frame = document.createElement("iframe");
  frame.dataset.active = "true"; frame.title = "VR Live – Zuschauer";
  frame.allow = "autoplay; fullscreen";
  frame.setAttribute("allowfullscreen", "");
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-presentation");
  frame.referrerPolicy = "no-referrer";
  const current = frame;
  current.addEventListener("load", () => { if (frame === current) { sound(); tick(); } });
  current.src = streamUrl(channel, code, { muted, parent:location.origin });
  ui.screen.append(current); controls(true); sound();
  state("loading", "Der Player startet. Er fragt weder Kamera noch Mikrofon ab.");
  poll = setInterval(tick, 2000); tick();
}

window.addEventListener("message", event => {
  if (event.origin !== origin || event.source !== frame?.contentWindow || !frame) return;
  const data = event.data;
  if (!data || typeof data !== "object" || data.cib !== `vr2:${generation}` || !("stats" in data)) return;
  // VDO explicitly replies with null when its API is ready but no stream exists.
  if (data.stats !== null && (typeof data.stats !== "object" || Array.isArray(data.stats))) return;
  const now = performance.now();
  if (readyAt === null) { readyAt = now; state("waiting", "Player bereit. Verbindung zum Sender wird aufgebaut."); }
  const sample = videoSample(data.stats);
  if (!sample) return;
  if (sampleAdvanced(lastSample, sample)) {
    hasVideo = true; lastProgress = now; nudgeAt = 0;
    if (phase !== "live") state("live", "Du bist live dabei. Falls der Browser Ton blockiert, Ton an/aus antippen.");
  }
  // Do not downgrade decoded-frame evidence to bytes after a missing metric.
  if (lastSample?.frames == null || sample.frames !== null || (sample.fps !== null && sample.stamp !== null)) lastSample = sample;
});

function fullscreenActive() { return document.fullscreenElement === ui.stage || document.webkitFullscreenElement === ui.stage || ui.stage.classList.contains("window-full"); }
function fullUi() {
  const active = Boolean(frame) && fullscreenActive();
  ui.exitFull.hidden = !active;
  ui.fullscreen.setAttribute("aria-pressed", String(active));
  if (active && !background.size) {
    for (const node of document.querySelectorAll(".topbar,.controls,#notice")) { background.set(node,node.inert); node.inert = true; }
    ui.stage.setAttribute("role","dialog"); ui.stage.setAttribute("aria-modal","true");
    ui.exitFull.focus({ preventScroll:true });
  } else if (!active) {
    for (const [node,inert] of background) node.inert = inert;
    const restore = background.size > 0; background.clear();
    ui.stage.removeAttribute("role"); ui.stage.removeAttribute("aria-modal");
    if (restore) (frame ? ui.fullscreen : ui.code).focus({ preventScroll:true });
  }
}
async function exitFull() {
  fullRequested = false; fullToken++; fullPending = false;
  ui.stage.classList.remove("window-full"); document.body.classList.remove("full");
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    try {
      const exit = document.exitFullscreen ?? document.webkitExitFullscreen;
      if (exit) await Promise.race([Promise.resolve(exit.call(document)), new Promise(resolve => setTimeout(resolve,1200))]);
    } catch { /* Window mode remains usable. */ }
  }
  fullUi();
}
async function enterFull() {
  if (!frame || fullPending) return;
  if (fullscreenActive()) { await exitFull(); return; }
  fullPending = true; fullRequested = true;
  const token = ++fullToken;
  try {
    const request = ui.stage.requestFullscreen ?? ui.stage.webkitRequestFullscreen;
    if (request) await Promise.race([Promise.resolve(request.call(ui.stage)), new Promise(resolve => setTimeout(resolve,1200))]);
  } catch { /* Browser denies native fullscreen: use the whole window. */ }
  if (token !== fullToken || !fullRequested || !frame) return;
  if (!fullscreenActive()) { ui.stage.classList.add("window-full"); document.body.classList.add("full"); }
  fullPending = false; fullUi();
}
for (const name of ["fullscreenchange","webkitfullscreenchange"]) document.addEventListener(name, () => {
  if ((document.fullscreenElement || document.webkitFullscreenElement) && (!fullRequested || !frame)) void exitFull();
  else fullUi();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && fullscreenActive()) { event.preventDefault(); void exitFull(); }
  if (event.key === "Tab" && ui.stage.classList.contains("window-full") && document.activeElement === ui.exitFull) { event.preventDefault(); frame?.focus(); }
});
ui.joinForm.addEventListener("submit", event => { event.preventDefault(); if (!frame) join(); });
ui.code.addEventListener("input", () => { ui.code.value = ui.code.value.replace(/\D/g,"").slice(0,4); ui.code.setAttribute("aria-invalid","false"); });
ui.reconnect.addEventListener("click", join);
ui.stop.addEventListener("click", () => stop());
ui.sound.addEventListener("click", () => { muted = !muted; sound(); });
ui.fullscreen.addEventListener("click", () => void enterFull());
ui.exitFull.addEventListener("click", () => void exitFull());
window.addEventListener("offline", () => { if (frame) state("recovering", "Dein Gerät ist offline. Warte auf die Internetverbindung."); });
window.addEventListener("online", () => { if (frame) { state("waiting", "Internet wieder da. Verbindung wird wiederhergestellt."); tick(); } });
document.addEventListener("visibilitychange", () => { lastProgress = performance.now(); if (!document.hidden) tick(); });
window.addEventListener("pagehide", () => stop());
controls(false);
if (!identityIsValid(channel)) state("idle", "Der neue Stream wird noch eingerichtet.");
