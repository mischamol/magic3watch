import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = 8765;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
    const name = pathname === "/" ? "index.html" : pathname.slice(1);
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error("Ongeldig pad");
    const data = await readFile(join(root, name));
    res.writeHead(200, { "Content-Type": types[extname(name)] || "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Niet gevonden");
  }
});

server.listen(port, "127.0.0.1", () => console.log(`Magic3-flasher draait op http://localhost:${port}/\nLaat dit venster open. Stop later met Ctrl+C.`));
