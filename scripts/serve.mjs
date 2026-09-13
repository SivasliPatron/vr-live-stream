import { realpathSync } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const hostname = "127.0.0.1";
const defaultRoot = fileURLToPath(new URL("../docs/", import.meta.url));
const basePath = "/vr-live-stream";
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

export function createPreviewServer({ rootDirectory = defaultRoot } = {}) {
  const root = realpathSync(rootDirectory);
  const isInsideRoot = (filePath) => {
    const pathFromRoot = relative(root, filePath);
    return pathFromRoot !== ".."
      && !pathFromRoot.startsWith(`..${sep}`)
      && !isAbsolute(pathFromRoot);
  };

  return createServer(async (request, response) => {
    const reply = (status, body, headers = {}) => {
      response.writeHead(status, {
        "content-type": "text/plain; charset=utf-8",
        "content-length": Buffer.byteLength(body),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        ...headers,
      });
      response.end(request.method === "HEAD" ? undefined : body);
    };

    let file;
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        reply(405, "Method not allowed", { allow: "GET, HEAD" });
        return;
      }

      // Keep the raw path until validation: URL parsing normalizes dot segments.
      // A fixed local server does not need to parse or trust the Host header.
      const requestTarget = request.url || "/";
      const queryIndex = requestTarget.indexOf("?");
      const rawPath = queryIndex < 0 ? requestTarget : requestTarget.slice(0, queryIndex);
      const query = queryIndex < 0 ? "" : requestTarget.slice(queryIndex);
      let pathname;
      try {
        pathname = decodeURIComponent(rawPath);
      } catch {
        reply(400, "Bad request");
        return;
      }

      if (!pathname.startsWith("/") || /[\\\u0000-\u001f\u007f:#<>"|?*]/.test(pathname)) {
        reply(400, "Bad request");
        return;
      }

      if (pathname === "/" || pathname === basePath) {
        reply(302, "Redirecting", { location: `${basePath}/${query}` });
        return;
      }

      if (!pathname.startsWith(`${basePath}/`)) {
        reply(404, "Not found");
        return;
      }

      const segments = pathname.slice(basePath.length + 1).split("/");
      // Also reject Windows aliases, device names, and hidden files on every OS.
      const invalidSegment = segments.some((segment) => (
        segment.startsWith(".")
        || /[ .]$/.test(segment)
        || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)
      ));
      if (invalidSegment) {
        reply(404, "Not found");
        return;
      }

      let filePath = await realpath(join(root, ...segments));
      if (!isInsideRoot(filePath)) {
        reply(404, "Not found");
        return;
      }

      let fileInfo = await stat(filePath);
      if (fileInfo.isDirectory()) {
        if (!pathname.endsWith("/")) {
          reply(302, "Redirecting", { location: `${rawPath}/${query}` });
          return;
        }
        filePath = await realpath(join(filePath, "index.html"));
        if (!isInsideRoot(filePath)) {
          reply(404, "Not found");
          return;
        }
        fileInfo = await stat(filePath);
      }

      if (!fileInfo.isFile()) {
        reply(404, "Not found");
        return;
      }

      file = await open(filePath, "r");
      const info = await file.stat();
      if (!info.isFile()) {
        reply(404, "Not found");
        return;
      }

      response.writeHead(200, {
        "content-type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
        "content-length": info.size,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      });
      if (request.method === "HEAD") {
        response.end();
      } else {
        // pipeline closes the file on errors and when the browser disconnects.
        await pipeline(file.createReadStream(), response);
      }
    } catch (error) {
      if (response.headersSent || response.destroyed) {
        response.destroy();
      } else if (["ENOENT", "ENOTDIR", "EISDIR", "ELOOP"].includes(error.code)) {
        reply(404, "Not found");
      } else if (["EACCES", "EPERM"].includes(error.code)) {
        reply(403, "Forbidden");
      } else {
        reply(500, "Internal server error");
      }
    } finally {
      await file?.close().catch(() => {});
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const configuredPort = process.env.PORT || "4173";
  const port = Number(configuredPort);
  if (!/^\d+$/.test(configuredPort) || !Number.isSafeInteger(port) || port > 65535) {
    console.error("PORT muss eine ganze Zahl zwischen 0 und 65535 sein.");
    process.exitCode = 1;
  } else {
    const reportStartupError = (error) => {
      console.error(`Vorschau-Server konnte nicht starten (${error.code || "unbekannter Fehler"}).`);
      process.exitCode = 1;
    };
    try {
      const server = createPreviewServer();
      server.on("error", reportStartupError);
      server.listen(port, hostname, () => {
        console.log(`VR Live: http://${hostname}:${server.address().port}${basePath}/`);
      });
    } catch (error) {
      reportStartupError(error);
    }
  }
}
