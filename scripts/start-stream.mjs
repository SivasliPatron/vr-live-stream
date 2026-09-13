import { spawn } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { access, readFile, writeFile, rename, unlink, open } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--fps" && options.fps === undefined) {
      const value = args[++index];
      if (!["30", "60"].includes(value)) throw new Error("Die Bildrate muss 30 oder 60 sein.");
      options.fps = Number(value);
    } else if (argument === "--new-session" && !options.newSession) options.newSession = true;
    else if (argument === "--show-code" && !options.showCode) options.showCode = true;
    else if (argument === "--check" && !options.checkOnly) options.checkOnly = true;
    else throw new Error("Unbekannte Startoption. Bitte die VR-Live-Verknuepfung verwenden.");
  }
  if ((options.showCode || options.checkOnly) && (options.fps || options.newSession) ||
      options.showCode && options.checkOnly || options.newSession && options.fps !== 60 ||
      !options.showCode && !options.checkOnly && !options.fps) {
    throw new Error("Ungueltige Startoptionen. Bitte die VR-Live-Verknuepfung verwenden.");
  }
  return options;
}

function validateSecrets(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !["streamId", "publisherToken", "viewerToken"].every((key) =>
        typeof value[key] === "string" && value[key].length >= 8 && value[key].length <= 1024 &&
        !/[\s\x00-\x1f\x7f]/.test(value[key])) ||
      typeof value.accessCode !== "string" || !/^[0-9]{4}$/.test(value.accessCode)) {
    throw new Error("Die lokalen Senderdaten sind unvollstaendig oder ungueltig.");
  }
}

export function buildSenderUrl(secrets, fps) {
  validateSecrets(secrets);
  if (![30, 60].includes(fps)) throw new Error("Die Bildrate muss 30 oder 60 sein.");
  const url = new URL("https://vdo.ninja/");
  const settings = {
    push: secrets.streamId, audience: secrets.publisherToken,
    screenshare: "", screensharequality: "1", screensharefps: String(fps),
    screensharestereo: "", screensharecontenthint: "motion",
    displaysurface: "browser", systemaudio: "exclude", maxviewers: "6",
    autorecover: "1", autorelay: "1", p2pfailtimeout: "7000",
    peerrecoversteps: "5", pendingicettl: "20000",
  };
  for (const [key, value] of Object.entries(settings)) url.searchParams.set(key, value);
  url.hash = new URLSearchParams({ password: secrets.accessCode }).toString();
  return url.toString();
}

async function findChrome() {
  for (const base of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA]) {
    if (!base) continue;
    const candidate = join(base, "Google", "Chrome", "Application", "chrome.exe");
    try { await access(candidate, constants.F_OK); return candidate; } catch { /* next location */ }
  }
  throw new Error("Google Chrome wurde nicht gefunden. Bitte Chrome installieren oder reparieren.");
}

function launchApplication(executable, args) {
  // No command shell: the private URL stays one argument, regardless of its content.
  return new Promise((accept, reject) => {
    const child = spawn(executable, args, { detached: true, stdio: "ignore", windowsHide: false });
    child.once("error", () => reject(new Error("Die Anwendung konnte nicht gestartet werden.")));
    child.once("spawn", () => { child.unref(); accept(); });
  });
}

function copyToClipboard(code) {
  return new Promise((accept, reject) => {
    const child = spawn(join(process.env.SystemRoot || "C:\\Windows", "System32", "clip.exe"), [], {
      windowsHide: true, stdio: ["pipe", "ignore", "ignore"],
    });
    child.once("error", () => reject(new Error("Zwischenablage nicht verfuegbar.")));
    child.stdin.on("error", () => reject(new Error("Zwischenablage nicht verfuegbar.")));
    child.once("exit", (code) => code === 0 ? accept() : reject(new Error("Zwischenablage nicht verfuegbar.")));
    child.stdin.end(code);
  });
}

async function atomicWrite(path, content) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

async function acquireLock(path) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, "wx");
      await handle.writeFile(String(process.pid));
      await handle.close();
      return async () => {
        if (await readFile(path, "utf8").catch(() => "") === String(process.pid)) {
          await unlink(path).catch(() => {});
        }
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw new Error("Der lokale Startordner ist nicht beschreibbar.");
      const owner = Number(await readFile(path, "utf8").catch(() => ""));
      if (Number.isSafeInteger(owner) && owner > 0) {
        try { process.kill(owner, 0); }
        catch (checkError) {
          if (checkError.code === "ESRCH") {
            await unlink(path).catch(() => {});
            continue;
          }
        }
      }
      throw new Error("Ein VR-Streamstart laeuft bereits. Bitte kurz warten und erneut versuchen.");
    }
  }
  throw new Error("Die Startdatei ist noch gesperrt. Bitte erneut versuchen.");
}

async function loadSecrets(path) {
  let raw;
  let value;
  try {
    raw = await readFile(path);
    value = JSON.parse(raw.toString("utf8").replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("Die lokale Secret-Datei kann nicht gelesen werden. Bitte .private/stream-secrets.json pruefen.");
  }
  validateSecrets(value);
  return { raw, value };
}

export async function runLauncher({ rootDirectory = projectRoot, fps = 60, newSession = false,
  showCode = false, checkOnly = false } = {}, dependencies = {}) {
  if (![30, 60].includes(fps) || newSession && (fps !== 60 || showCode || checkOnly) || showCode && checkOnly) {
    throw new Error("Ungueltige Startoptionen.");
  }
  const privateDirectory = join(resolve(rootDirectory), ".private");
  const secretsPath = join(privateDirectory, "stream-secrets.json");
  const codeFilePath = join(privateDirectory, "AKTUELLER-ZUGANGSCODE.txt");
  const adapters = {
    findChrome,
    launchBrowser: (chrome, url) => launchApplication(chrome, ["--new-window", url]),
    showCodeFile: (path) => launchApplication(join(process.env.SystemRoot || "C:\\Windows", "System32", "notepad.exe"), [path]),
    copyCode: copyToClipboard,
    nextCode: (previous) => {
      let code;
      do { code = String(randomInt(10_000)).padStart(4, "0"); } while (code === previous);
      return code;
    },
    now: () => new Date(),
    ...dependencies,
  };
  let chrome;
  if (!showCode) {
    try { chrome = await adapters.findChrome(); }
    catch { throw new Error("Google Chrome wurde nicht gefunden. Bitte Chrome installieren oder reparieren."); }
    if (!chrome) throw new Error("Google Chrome wurde nicht gefunden.");
  }
  if (checkOnly) {
    const { value } = await loadSecrets(secretsPath);
    buildSenderUrl(value, fps);
    return { status: "checked", codeFilePath, warnings: [] };
  }

  const release = await acquireLock(join(privateDirectory, ".launcher.lock"));
  try {
    const { raw, value } = await loadSecrets(secretsPath);
    const current = { ...value };
    if (newSession) {
      current.accessCode = adapters.nextCode(value.accessCode);
      if (typeof current.accessCode !== "string" || !/^[0-9]{4}$/.test(current.accessCode) || current.accessCode === value.accessCode) {
        throw new Error("Es konnte kein neuer vierstelliger Code erzeugt werden.");
      }
      current.accessCodeCreatedUtc = adapters.now().toISOString();
    }
    const url = showCode ? null : buildSenderUrl(current, fps);
    const previousCodeFile = await readFile(codeFilePath).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw new Error("Die Code-Anzeigedatei kann nicht gelesen werden.");
    });
    const nextRaw = Buffer.from(JSON.stringify(current, null, 2) + "\n");
    const codeText = `AKTUELLER VR-LIVE-ZUGANGSCODE\r\n\r\n${current.accessCode}\r\n\r\nZuschauer-Link: https://sivaslipatron.github.io/vr-live-stream/\r\nDen Code nur an deine Zuschauer weitergeben.\r\n`;
    let wroteSecrets = false;
    let wroteCode = false;
    try {
      if (!(await readFile(secretsPath)).equals(raw)) throw new Error("Senderdaten wurden zwischenzeitlich geaendert.");
      if (newSession) { await atomicWrite(secretsPath, nextRaw); wroteSecrets = true; }
      await atomicWrite(codeFilePath, codeText);
      wroteCode = true;
      if (!showCode) await adapters.launchBrowser(chrome, url);
    } catch {
      // Restore only our own writes if the browser could not be launched.
      if (wroteSecrets && (await readFile(secretsPath)).equals(nextRaw)) await atomicWrite(secretsPath, raw);
      if (wroteCode && (await readFile(codeFilePath, "utf8")) === codeText) {
        if (previousCodeFile === null) await unlink(codeFilePath);
        else await atomicWrite(codeFilePath, previousCodeFile);
      }
      throw new Error("Der Streamstart ist fehlgeschlagen. Bitte Chrome und Schreibzugriff auf .private pruefen.");
    }
    const warnings = [];
    try { await adapters.copyCode(current.accessCode); }
    catch { warnings.push("Zwischenablage nicht verfuegbar. Den Code aus der Textdatei kopieren."); }
    try { await adapters.showCodeFile(codeFilePath); }
    catch { warnings.push("Codeanzeige konnte nicht geoeffnet werden. Bitte .private/AKTUELLER-ZUGANGSCODE.txt oeffnen."); }
    return { status: "opened", fps: showCode ? undefined : fps, newSession, codeFilePath, warnings };
  } finally {
    await release();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runLauncher(parseArgs(process.argv.slice(2)));
    console.log(result.status === "checked" ? "VR Live: Chrome und lokale Senderdaten sind bereit." :
      "VR Live: Start abgeschlossen. Der aktuelle Zugangscode steht in der Code-Anzeigedatei.");
    for (const warning of result.warnings) console.warn(warning);
  } catch (error) {
    console.error(`VR Live: ${error.message}`);
    process.exitCode = 1;
    if (process.stdin.isTTY) {
      console.error("Zum Schliessen die Eingabetaste druecken.");
      await new Promise((accept) => { process.stdin.resume(); process.stdin.once("data", accept); });
      process.stdin.pause();
    }
  }
}
