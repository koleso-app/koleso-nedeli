// Serves app/ on http://127.0.0.1:5178 to try the phone version in a browser. Run: npm run web
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..", "app"), port = Number(process.env.PORT) || 5178;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".json": "application/json", ".txt": "text/plain; charset=utf-8" };
http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
  const file = path.join(root, rel);
  if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" }).end(buf);
  });
}).listen(port, "127.0.0.1", () => console.log(`Колесо недели: http://127.0.0.1:${port}`));
