import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build3d } from "./build-3d.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "public");
const staticFiles = [
  "index.html",
  "manifest.json",
  "service-worker.js",
  "minigameworld-icon.png",
  "sigma-icon.svg",
  "loading-music.mp3",
  "assets/three-games.js",
  "assets/three-games.js.LEGAL.txt",
  "assets/crystal-isles-3d.png"
];

await build3d();
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const file of staticFiles) {
  mkdirSync(dirname(join(output, file)), { recursive: true });
  copyFileSync(join(root, file), join(output, file));
}

console.log(`Prepared ${staticFiles.length} MiniGameWorld files for Vercel.`);
