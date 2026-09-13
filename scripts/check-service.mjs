// Explicit, opt-in check of the newly configured Audience service.
// No camera, microphone, screen capture or SDP is involved.
import { readFile } from "node:fs/promises";
const session=JSON.parse(await readFile(new URL("../.private/session.json",import.meta.url),"utf8"));
const result={websocketOpened:false,tokenReceived:false,viewerTokenMatches:false,seedSent:false};
await new Promise(resolve=>{
  let socket, finished=false, seedTimer;
  const end=()=>{if(finished)return;finished=true;clearTimeout(seedTimer);clearTimeout(deadline);socket?.close();resolve();};
  const deadline=setTimeout(end,20000);
  try {
    socket=new WebSocket(`wss://audience.vdo.ninja/publish/${session.publisher}`);
    socket.addEventListener("open",()=>{
      result.websocketOpened=true;
      seedTimer=setTimeout(()=>{
        if(socket.readyState===WebSocket.OPEN) { socket.send(JSON.stringify({request:"seed",streamID:session.id})); result.seedSent=true; }
      },3000);
    });
    socket.addEventListener("message",event=>{
      try {
        const data=JSON.parse(event.data);
        if(typeof data.token==="string") {result.tokenReceived=true;result.viewerTokenMatches=data.token===session.viewer;end();}
      } catch { /* Never log raw service messages or keys. */ }
    });
    socket.addEventListener("error",end);
    socket.addEventListener("close",end);
  } catch { end(); }
});
console.log(JSON.stringify(result));
// Undici may retain a close-handshake socket; this one-shot diagnostic is done.
process.exit(result.viewerTokenMatches?0:1);
