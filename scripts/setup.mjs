import { randomBytes, randomInt } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { codeIsValid } from "../docs/protocol.js";

const root = fileURLToPath(new URL("../",import.meta.url));
export function freshIdentity() {
  return { id:`quest_${randomBytes(12).toString("base64url")}`, publisher:randomBytes(32).toString("base64url"),
    code:String(randomInt(10000)).padStart(4,"0"), viewer:null, created:new Date().toISOString() };
}
export async function setup(directory = root, { request = fetch } = {}) {
  const privateDir = resolve(directory,".private");
  const path = resolve(privateDir,"session.json");
  await mkdir(privateDir,{recursive:true});
  let session, created = false;
  try { session = JSON.parse(await readFile(path,"utf8")); }
  catch (error) {
    if (error.code !== "ENOENT") throw new Error("Die lokale Einrichtung konnte nicht gelesen werden.");
    session = freshIdentity();
    created = true;
    await writeFile(path,JSON.stringify(session,null,2),{flag:"wx",mode:0o600});
  }
  if (!/^[A-Za-z0-9_-]{30,128}$/.test(session.publisher) || !/^quest_[A-Za-z0-9_-]{16}$/.test(session.id) || !codeIsValid(session.code)) {
    throw new Error("Die lokale Einrichtung ist ungültig.");
  }
  // VDO's HTTP token endpoint. Only the returned, distinct audience key is public.
  const response = await request(`https://audience.vdo.ninja/publish/${session.publisher}/token`,{signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error("Der Zugangsdienst ist nicht erreichbar.");
  const data = await response.json();
  if (typeof data.token !== "string" || !/^[A-Za-z0-9_-]{12,128}$/.test(data.token) || data.token === session.publisher) {
    throw new Error("Der Zugangsdienst lieferte keinen getrennten Zuschauer-Schlüssel.");
  }
  session.viewer = data.token;
  const temporary = `${path}.tmp`;
  await writeFile(temporary,JSON.stringify(session,null,2),{mode:0o600}); await rename(temporary,path);
  await writeFile(resolve(directory,"docs/channel.js"),
    `// Only the audience identity is public.\nexport const channel = Object.freeze(${JSON.stringify({id:session.id,audience:session.viewer})});\n`);
  await writeFile(resolve(privateDir,"ZUGANGSCODE.txt"),`VR LIVE – AKTUELLER CODE\n\n${session.code}\n\nhttps://sivaslipatron.github.io/vr-live-stream/\n`,{mode:0o600});
  return { ready:true, newIdentity:created };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await setup(); console.log("Neue lokale Senderdaten und öffentliche Zuschauer-Konfiguration sind eingerichtet."); }
  catch { console.error("Einrichtung nicht abgeschlossen. Die privaten Daten bleiben für einen erneuten Versuch erhalten."); process.exitCode=1; }
}
