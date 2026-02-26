const http = require("http");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const port = Number(process.env.PORT) || 5173;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mid": "audio/midi",
  ".midi": "audio/midi",
  ".ico": "image/x-icon"
};

function safeResolve(requestPath) {
  const cleanPath = decodeURIComponent(requestPath.split("?")[0]);
  const resolved = path.resolve(rootDir, "." + cleanPath);
  if (!resolved.startsWith(rootDir)) {
    return null;
  }
  return resolved;
}

const server = http.createServer((req, res) => {
  if (!req.url) {
    res.writeHead(400);
    res.end("Bad Request");
    return;
  }

  let filePath = safeResolve(req.url === "/" ? "/index.html" : req.url);
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    if (stats.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(500);
        res.end("Server Error");
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const mime = mimeTypes[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime });
      res.end(data);
    });
  });
});

server.listen(port, () => {
  console.log(`Dev server running at http://localhost:${port}`);
});
