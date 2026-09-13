import { spawn } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink, open, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { streamUrl, codeIsValid } from "../docs/protocol.js";
const root = fileURLToPath(new URL("../",import.meta.url));
export function nextCode(previous) {
  let code; do { code = String(randomInt(10000)).padStart(4,"0"); } while (code === previous);
  return code;
}
export function openApp(executable,args) {
  return new Promise((done,failed) => {
    const child = spawn(executable,args,{detached:true,stdio:"ignore",windowsHide:false});
    child.once("error",() => failed(new Error("Die Anwendung konnte nicht geöffnet werden.")));
    child.once("spawn",() => { child.unref(); done(); });
  });
}
async function chromePath() {
  for (const base of [process.env.ProgramFiles,process.env["ProgramFiles(x86)"],process.env.LOCALAPPDATA]) {
    if (!base) continue;
    const path = join(base,"Google","Chrome","Application","chrome.exe");
    try { await access(path); return path; } catch { /* try next installation */ }
  }
  throw new Error("Google Chrome wurde nicht gefunden.");
}
async function atomic(path,text) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary,text,{flag:"wx",mode:0o600}); await rename(temporary,path); }
  finally { await unlink(temporary).catch(() => {}); }
}
export async function startHost({ directory=root, fps=60, show=false, check=false } = {}, deps={}) {
  const privateDir = resolve(directory,".private");
  await mkdir(privateDir,{recursive:true});
  const path = resolve(privateDir,"session.json"), codePath = resolve(privateDir,"ZUGANGSCODE.txt");
  const lock = resolve(privateDir,"host.lock");
  let handle;
  try { handle = await open(lock,"wx"); }
  catch { throw new Error("Ein Start läuft bereits. Falls keiner läuft: VR Live neu öffnen und die lokale host.lock prüfen."); }
  try {
    const original = await readFile(path,"utf8");
    const session = JSON.parse(original);
    if (!codeIsValid(session.code) || typeof session.viewer !== "string" || session.viewer === session.publisher) throw new Error("Lokale Stream-Daten fehlen oder sind ungültig.");
    const sender = { id:session.id, audience:session.publisher };
    streamUrl(sender,session.code,{publisher:true,fps});
    if (show) { await (deps.open ?? openApp)("notepad.exe",[codePath]); return { status:"code" }; }
    const chrome = await (deps.chrome ?? chromePath)();
    if (check) return { status:"ready" };
    const previousDisplay = await readFile(codePath,"utf8").catch(() => null);
    if (fps === 60) session.code = (deps.nextCode ?? nextCode)(session.code);
    if (!codeIsValid(session.code)) throw new Error("Ungültiger neuer Code.");
    await atomic(path,JSON.stringify(session,null,2));
    try {
      await atomic(codePath,`VR LIVE – AKTUELLER CODE\n\n${session.code}\n\nhttps://sivaslipatron.github.io/vr-live-stream/\n`);
      await (deps.open ?? openApp)(chrome,["--new-window",streamUrl(sender,session.code,{publisher:true,fps})]);
    } catch {
      await atomic(path,original);
      if (previousDisplay !== null) await atomic(codePath,previousDisplay); else await unlink(codePath).catch(() => {});
      throw new Error("Senderstart fehlgeschlagen. Der bisherige Code wurde wiederhergestellt.");
    }
    await (deps.open ?? openApp)("notepad.exe",[codePath]).catch(() => {});
    return { status:"opened", fps };
  } finally { await handle.close(); await unlink(lock).catch(() => {}); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] ?? "--60";
  try {
    if (process.argv.length > 3 || !["--60","--30","--code","--check"].includes(mode)) throw new Error("Bitte eine VR-Live-Verknüpfung verwenden.");
    const result = await startHost({fps:mode === "--30" ? 30:60,show:mode === "--code",check:mode === "--check"});
    console.log(result.status === "ready" ? "Chrome und Senderdaten sind bereit." : "VR Live geöffnet. Alte Sender-Tabs vorher schließen; Casting-Tab mit Tab-Audio teilen.");
  } catch (error) {
    console.error(error instanceof SyntaxError ? "Die lokalen Stream-Daten sind beschädigt." : error.message);
    process.exitCode=1;
    if (process.stdin.isTTY) {
      const terminal = createInterface({input:process.stdin,output:process.stdout});
      await terminal.question("Zum Schließen Eingabetaste drücken."); terminal.close();
    }
  }
}
