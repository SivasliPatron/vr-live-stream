import { createServer } from "node:http";
import { readFile, readdir, realpath } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const defaultRoot = fileURLToPath(new URL("../docs/", import.meta.url));
const types = { html:"text/html", css:"text/css", js:"application/javascript" };
export function preview(root = defaultRoot) {
  return createServer(async (request,response) => {
    response.setHeader("Cache-Control","no-store");
    response.setHeader("X-Content-Type-Options","nosniff");
    if (!["GET","HEAD"].includes(request.method)) { response.writeHead(405,{Allow:"GET, HEAD"}).end(); return; }
    try {
      let path = decodeURIComponent(new URL(request.url,"http://localhost").pathname);
      if (path === "/vr-live-stream") { response.writeHead(308,{Location:"/vr-live-stream/"}).end(); return; }
      path = path.replace(/^\/vr-live-stream\//,"/");
      const name = path === "/" ? "index.html" : path.slice(1);
      if (!/^[a-zA-Z0-9_-]+\.(html|js|css)$/.test(name) || !(await readdir(root)).includes(name)) { response.writeHead(404).end(); return; }
      const canonicalRoot = await realpath(root), canonicalFile = await realpath(join(root,name));
      if (dirname(canonicalFile) !== canonicalRoot) { response.writeHead(404).end(); return; }
      const body = await readFile(canonicalFile);
      response.writeHead(200,{"Content-Type":`${types[name.split(".").at(-1)]}; charset=utf-8`,"Content-Length":body.length});
      response.end(request.method === "HEAD" ? undefined : body);
    } catch (error) { response.writeHead(error instanceof URIError ? 400 : 404).end(); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = preview();
  server.on("error", () => { console.error("Vorschau konnte nicht gestartet werden."); process.exitCode=1; });
  server.listen(0,"127.0.0.1",() => console.log(`VR Live: http://127.0.0.1:${server.address().port}/vr-live-stream/`));
}
