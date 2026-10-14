import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

const root = resolve("output/mobile-preview");
const port = Number(process.env.PREVIEW_PORT || 8082);
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".json": "application/json",
};

try {
  await stat(resolve(root, "index.html"));
} catch {
  console.error("Missing web export. Run npm run export:web first.");
  process.exit(1);
}

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
    const file = resolve(root, "." + pathname);
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const candidates =
      pathname === "/"
        ? [resolve(root, "index.html")]
        : [file, file + ".html", resolve(file, "index.html")];
    for (const candidate of candidates) {
      try {
        if (!(await stat(candidate)).isFile()) continue;
        const body = await readFile(candidate);
        response
          .writeHead(200, {
            "Content-Type":
              types[extname(candidate)] || "application/octet-stream",
            "Cache-Control": "no-store",
          })
          .end(body);
        return;
      } catch {
        /* Try the next static route representation. */
      }
    }
    response.writeHead(404).end("Not found");
  } catch {
    response.writeHead(400).end("Invalid request");
  }
}).listen(port, "127.0.0.1", () =>
  console.log(`AGM mobile preview: http://localhost:${port}/app/home`),
);
