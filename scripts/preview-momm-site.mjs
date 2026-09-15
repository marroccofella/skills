#!/usr/bin/env node
// Local public-docs preview only. Never serves the repository or private ledgers.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../docs"));
const port = Number(process.argv[2] || 8842);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Choose a local port from 1024 to 65535");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".mp4": "video/mp4", ".vtt": "text/vtt" };
http.createServer((req, res) => {
  if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405, { "Allow": "GET, HEAD" }); res.end(); return; }
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    let file = path.resolve(root, "." + decodeURIComponent(url.pathname));
    if (file !== root && !file.startsWith(root + path.sep)) throw new Error("outside docs");
    if (fs.statSync(file).isDirectory()) {
      if (!url.pathname.endsWith("/")) {
        // A document at /momm resolves site.css to /site.css, not /momm/site.css.
        res.writeHead(308, { "Location": url.pathname + "/" + url.search, "Cache-Control": "no-store" });
        res.end(); return;
      }
      file = path.join(file, "index.html");
    }
    const real = fs.realpathSync(file);
    if (!real.startsWith(root + path.sep)) throw new Error("outside docs");
    const size=fs.statSync(real).size,range=req.headers?.range;
    let start=0,end=size-1,status=200;
    if(range){
      const match=/^bytes=(\d*)-(\d*)$/.exec(range);
      const reject=()=>{res.writeHead(416,{"Content-Range":`bytes */${size}`});res.end();};
      if(!match||(!match[1]&&!match[2])){reject();return;}
      if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<=0){reject();return;}start=Math.max(0,size-suffix);}
      else {start=Number(match[1]);if(match[2])end=Math.min(Number(match[2]),size-1);}
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start){reject();return;}
      status=206;
    }
    res.writeHead(status, { "Content-Type": types[path.extname(file)] || "text/plain; charset=utf-8", "Content-Length":Math.max(0,end-start+1),"Accept-Ranges":"bytes",...(status===206?{"Content-Range":`bytes ${start}-${end}/${size}`}:{ }), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    if (req.method === "HEAD") res.end();
    else {
      const stream = fs.createReadStream(real,status===206?{start,end}:undefined);
      // Headers may already be sent. End the failed response, not the server.
      stream.once("error", () => res.destroy());
      res.once("close", () => stream.destroy());
      stream.pipe(res);
    }
  } catch { res.writeHead(404); res.end("Not found"); }
}).listen(port, "127.0.0.1", () => process.stdout.write(`MOMM site preview: http://127.0.0.1:${port}/momm/\n`));
