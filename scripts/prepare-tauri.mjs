import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "desktop", "frontend");
const staticFiles = [
  "index.html",
  "manifest.json",
  "service-worker.js",
  "minigameworld-icon.png",
  "sigma-icon.svg",
  "loading-music.mp3"
];

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const file of staticFiles) {
  copyFileSync(join(root, file), join(output, file));
}

console.log(`Prepared ${staticFiles.length} MiniGameWorld files for Tauri.`);
