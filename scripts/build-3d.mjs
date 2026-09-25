import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export async function build3d() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  await build({
    absWorkingDir: root,
    entryPoints: ["src/three-games.mjs", "src/zombie-game.mjs"], outdir: "assets",
    bundle: true, format: "esm", platform: "browser", target: "es2022",
    minify: true, legalComments: "external"
  });
  const license = name => readFileSync(join(root, "node_modules", name, "LICENSE"), "utf8");
  const common = ["three", "lucide", "@dimforge/rapier3d-compat"].map(name => `\n${name}\n${license(name)}\n`).join("\n");
  const readmeLicense = name => {
    const readme = readFileSync(join(root, "node_modules", name, "README.md"), "utf8");
    const sections = readme.split(/\r?\nLicense\r?\n-+\r?\n/);
    if (sections.length !== 2) throw new Error(`Missing ${name} license section`);
    return `\n${name}\n${sections[1]}\n`;
  };
  appendFileSync(join(root, "assets/three-games.js.LEGAL.txt"), common);
  appendFileSync(join(root, "assets/zombie-game.js.LEGAL.txt"), common + readmeLicense("pathfinding") + readmeLicense("heap") + "\nheap.js is Xueqiao Xu's JavaScript port of Python heapq, bundled and minified here without algorithm changes.\n");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await build3d();
