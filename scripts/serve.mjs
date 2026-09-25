import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const types = {
  "index.html": "text/html; charset=utf-8",
  "manifest.json": "application/manifest+json",
  "service-worker.js": "text/javascript; charset=utf-8",
  "minigameworld-icon.png": "image/png",
  "sigma-icon.svg": "image/svg+xml",
  "loading-music.mp3": "audio/mpeg",
  "assets/three-games.js": "text/javascript; charset=utf-8",
  "assets/three-games.js.LEGAL.txt": "text/plain; charset=utf-8",
  "assets/crystal-isles-3d.png": "image/png",
  "assets/dead-route-3d.png": "image/png",
  "assets/zombie-game.js": "text/javascript; charset=utf-8",
  "assets/zombie-game.js.LEGAL.txt": "text/plain; charset=utf-8"
};
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const name = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!["GET", "HEAD"].includes(request.method) || !Object.hasOwn(types, name)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const data = await readFile(new URL(`../${name}`, import.meta.url));
    response.writeHead(200, { "Content-Type": types[name], "Cache-Control": "no-cache" });
    response.end(request.method === "HEAD" ? undefined : data);
  } catch {
    response.writeHead(500).end();
  }
});
let port = 4173;
server.on("error", (error) => {
  if (error.code !== "EADDRINUSE" || port >= 4183) throw error;
  server.listen(++port, "127.0.0.1");
});
server.on("listening", () => console.log(`MiniGameWorld: http://127.0.0.1:${port}`));
server.listen(port, "127.0.0.1");
