// Local pre-push guard; never logs private material.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const directory=fileURLToPath(new URL("../",import.meta.url));
const local=JSON.parse(await readFile(new URL("../.private/session.json",import.meta.url),"utf8"));
const git=args=>execFileSync("git",args,{cwd:directory,encoding:"utf8"});
const files=git(["ls-files","-z"]).split("\0").filter(Boolean);
if(files.length===0) throw Error("Keine Dateien zur Veröffentlichung vorgemerkt.");
for(const file of files) {
  if(/(^|\/)(\.private|node_modules|test-results)(\/|$)|\.lnk$|START-HIER/.test(file)) throw Error("Lokale Datei im Git-Index gefunden.");
  const text=git(["show",`:${file}`]);
  if(text.includes(local.publisher)) throw Error("Privater Schlüssel im Git-Index gefunden.");
  if(file.startsWith("docs/") && /[?&]push=/.test(text)) throw Error("Sender-Link in öffentlichen Webdateien gefunden.");
}
const config=git(["show",":docs/channel.js"]);
if(!config.includes(local.id)||!config.includes(local.viewer)||local.viewer===local.publisher) throw Error("Öffentliche und private Identität passen nicht zusammen.");
console.log(`Freigabeprüfung bestanden: ${files.length} Dateien, keine lokalen Senderdaten oder Senderlinks in öffentlichen Webdateien.`);
