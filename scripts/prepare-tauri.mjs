import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build3d } from "./build-3d.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "desktop", "frontend");
const staticFiles = [
  "index.html",
  "manifest.json",
  "service-worker.js",
  "minigameworld-icon.png",
  "sigma-icon.svg",
  "loading-music.mp3",
  "assets/music/neon-cartridge.mp3",
  "assets/music/neon-coin-slot.mp3",
  "assets/music/continue-countdown.mp3",
  "assets/music/blox-fruits-drift.mp3",
  "assets/music/skibidi-drift.mp3",
  "assets/music/neon-arcade-drift.mp3",
  "assets/three-games.js",
  "assets/skin-studio.js",
  "assets/skin-studio.css",
  "assets/skin-studio.js.LEGAL.txt",
  "assets/three-games.js.LEGAL.txt",
  "assets/crystal-isles-3d.png",
  "assets/zombie-game.js",
  "assets/zombie-game.js.LEGAL.txt",
  "assets/dead-route-3d.png"
];

await build3d();
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const file of staticFiles) {
  mkdirSync(dirname(join(output, file)), { recursive: true });
  copyFileSync(join(root, file), join(output, file));
}

console.log(`Prepared ${staticFiles.length} MiniGameWorld files for Tauri.`);
