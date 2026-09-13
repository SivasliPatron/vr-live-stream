import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createPreviewServer } from "../scripts/serve.mjs";

const base = "/vr-live-stream";
const root = resolve(import.meta.dirname, "..");

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "vr-live-http-"));
  let server;
  t.after(async () => {
    if (server?.listening) {
      await new Promise((resolveClose) => server.close(resolveClose));
    }
    assert.ok(resolve(directory).startsWith(join(resolve(tmpdir()), "vr-live-http-")));
    await rm(directory, { recursive: true, force: true });
  });
  const publicDirectory = join(directory, "public");
  await mkdir(join(publicDirectory, "nested"), { recursive: true });
  await mkdir(join(directory, "public-other"));
  await writeFile(join(publicDirectory, "index.html"), "<!doctype html><title>Vorschau</title>");
  await writeFile(join(publicDirectory, "styles.css"), "body { color: green; }");
  await writeFile(join(publicDirectory, "app.js"), 'export const title = "Vorschau";');
  await writeFile(join(publicDirectory, "Grüße.txt"), "Grüße!");
  await writeFile(join(publicDirectory, "nested", "index.html"), "Nested page");
  await writeFile(join(publicDirectory, ".hidden"), "hidden-only-data");
  await writeFile(join(directory, "outside.txt"), "outside-only-data");
  await writeFile(join(directory, "public-other", "index.html"), "outside-only-data");
  server = createPreviewServer({ rootDirectory: publicDirectory });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  return { directory, publicDirectory, port, get: (path, options) => get(port, path, options) };
}

function get(port, path, { method = "GET", headers = {} } = {}) {
  return new Promise((resolveResponse, reject) => {
    const outgoing = request({ hostname: "127.0.0.1", port, path, method, headers, agent: false }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => resolveResponse({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    outgoing.setTimeout(5_000, () => outgoing.destroy(new Error("HTTP test timed out")));
    outgoing.on("error", reject);
    outgoing.end();
  });
}

test("HTTP-Vorschau liefert Startseite, Assets und HEAD mit korrekten Headern", async (t) => {
  const app = await fixture(t);
  for (const [path, contentType, body] of [
    [`${base}/?v=1`, "text/html; charset=utf-8", "<!doctype html><title>Vorschau</title>"],
    [`${base}/styles.css?v=2`, "text/css; charset=utf-8", "body { color: green; }"],
    [`${base}/app.js`, "text/javascript; charset=utf-8", 'export const title = "Vorschau";'],
    [`${base}/Gr%C3%BC%C3%9Fe.txt`, "text/plain; charset=utf-8", "Grüße!"],
  ]) {
    const response = await app.get(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.body, body);
    assert.equal(response.headers["content-type"], contentType);
    assert.equal(response.headers["content-length"], String(Buffer.byteLength(body)));
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    const head = await app.get(path, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.body, "");
    assert.equal(head.headers["content-length"], response.headers["content-length"]);
    assert.equal(head.headers["content-type"], contentType);
  }
});

test("HTTP-Weiterleitungen erhalten Query und Verzeichnis-Basispfade", async (t) => {
  const app = await fixture(t);
  for (const path of ["/", base]) {
    const response = await app.get(`${path}?v=2`);
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, `${base}/?v=2`);
  }
  const directory = await app.get(`${base}/nested?v=3`);
  assert.equal(directory.status, 302);
  assert.equal(directory.headers.location, `${base}/nested/?v=3`);
  assert.equal((await app.get(directory.headers.location)).body, "Nested page");
});

test("HTTP gibt 400 für kaputte URL-Kodierung zurück und bleibt anschließend erreichbar", async (t) => {
  const app = await fixture(t);
  for (const malformed of ["%", "%GG", "%E0%A4%A", "%C0%AF", "%00", "%0d%0a", "%5cindex.html", "app.js%3Adata", "index.html%23fragment"]) {
    const response = await app.get(`${base}/${malformed}`);
    assert.equal(response.status, 400, malformed);
    assert.equal((await app.get(`${base}/`)).status, 200);
  }
  assert.equal((await app.get(`${base}/`, { headers: { host: "[invalid-host" } })).status, 200);
});

test("HTTP blockiert Pfad-Traversal, versteckte Dateien und Windows-Aliase", async (t) => {
  const app = await fixture(t);
  for (const path of [
    "/outside.txt", "/vr-live-streaming/index.html", `${base}/missing`,
    `${base}/../outside.txt`, `${base}/%2e%2e/outside.txt`,
    `${base}/%2e%2e%2foutside.txt`, `${base}/nested/../../outside.txt`,
    `${base}/.hidden`, `${base}/%2ehidden`, `${base}/index.html.`,
    `${base}/index.html%20`, `${base}/NUL`, `${base}/COM1.txt`,
  ]) {
    const response = await app.get(path);
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(response.body, /outside-only-data|hidden-only-data/);
  }
  const response = await app.get(`${base}/missing`, { method: "HEAD" });
  assert.equal(response.status, 404);
  assert.equal(response.body, "");
});

test("HTTP folgt keinen Verzeichnislinks außerhalb des öffentlichen Ordners", async (t) => {
  const app = await fixture(t);
  const linkType = process.platform === "win32" ? "junction" : "dir";
  await symlink(join(app.directory, "public-other"), join(app.publicDirectory, "outside"), linkType);
  await symlink(join(app.publicDirectory, "nested"), join(app.publicDirectory, "inside"), linkType);
  for (const path of [`${base}/outside/`, `${base}/outside/index.html`]) {
    assert.equal((await app.get(path)).status, 404, path);
  }
  assert.equal((await app.get(`${base}/inside/`)).body, "Nested page");
});

test("HTTP akzeptiert nur GET und HEAD", async (t) => {
  const app = await fixture(t);
  for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
    const response = await app.get(`${base}/`, { method });
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.allow, "GET, HEAD");
  }
  assert.equal((await app.get(`${base}/`)).status, 200);
});

test("HTTP behandelt entfernte Dateien und Verzeichnisse ohne Startseite als 404", async (t) => {
  const app = await fixture(t);
  await rm(join(app.publicDirectory, "styles.css"));
  await mkdir(join(app.publicDirectory, "empty"));
  await mkdir(join(app.publicDirectory, "invalid-index", "index.html"), { recursive: true });
  for (const path of ["styles.css", "empty/", "invalid-index/", "app.js/child"]) {
    assert.equal((await app.get(`${base}/${path}`)).status, 404, path);
  }
  assert.equal((await app.get(`${base}/`)).status, 200);
});

test("ein abgebrochener Download beendet den Vorschau-Server nicht", async (t) => {
  const app = await fixture(t);
  await writeFile(join(app.publicDirectory, "large.txt"), Buffer.alloc(4 * 1024 * 1024, 65));
  await new Promise((resolveAbort, reject) => {
    const outgoing = request({ hostname: "127.0.0.1", port: app.port, path: `${base}/large.txt`, agent: false }, (response) => {
      response.once("data", () => {
        response.destroy();
        resolveAbort();
      });
      response.on("error", (error) => {
        if (error.code !== "ECONNRESET") reject(error);
      });
    });
    outgoing.setTimeout(5_000, () => outgoing.destroy(new Error("HTTP test timed out")));
    outgoing.on("error", reject);
    outgoing.end();
  });
  assert.equal((await app.get(`${base}/`)).status, 200);
});

function launch(port, script = join(root, "scripts", "serve.mjs")) {
  const child = spawn(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return { child, output: () => ({ stdout, stderr }) };
}

test("CLI meldet ungültige oder belegte Ports ohne ungefangenen Fehler", { timeout: 10_000 }, async (t) => {
  const app = await fixture(t);
  for (const port of ["invalid", "-1", "65536", "1.5", app.port]) {
    const processResult = launch(port);
    t.after(() => processResult.child.kill());
    const [code] = await once(processResult.child, "close");
    assert.equal(code, 1, String(port));
    assert.match(processResult.output().stderr, port === app.port ? /EADDRINUSE/ : /PORT muss/);
    assert.doesNotMatch(processResult.output().stderr, /\n\s+at /);
  }
});

test("CLI meldet einen fehlenden öffentlichen Ordner verständlich", { timeout: 10_000 }, async (t) => {
  const app = await fixture(t);
  const isolatedScript = join(app.directory, "scripts", "serve.mjs");
  await mkdir(join(app.directory, "scripts"));
  await copyFile(join(root, "scripts", "serve.mjs"), isolatedScript);
  const processResult = launch(0, isolatedScript);
  t.after(() => processResult.child.kill());
  const [code] = await once(processResult.child, "close");
  assert.equal(code, 1);
  assert.match(processResult.output().stderr, /Vorschau-Server konnte nicht starten \(ENOENT\)/);
  assert.doesNotMatch(processResult.output().stderr, /\n\s+at /);
});

test("CLI startet mit PORT=0 und zeigt den tatsächlich gebundenen Port", { timeout: 10_000 }, async (t) => {
  const processResult = launch(0);
  t.after(async () => {
    if (processResult.child.exitCode === null) {
      processResult.child.kill();
      await once(processResult.child, "exit");
    }
  });
  await once(processResult.child.stdout, "data");
  const match = processResult.output().stdout.match(/http:\/\/127\.0\.0\.1:(\d+)\/vr-live-stream\//);
  assert.ok(match, processResult.output().stdout);
  assert.ok(Number(match[1]) > 0);
  assert.equal((await get(Number(match[1]), `${base}/`)).status, 200);
});
