import { build } from "esbuild";
import { fileURLToPath } from "node:url";

export async function build3d() {
  await build({
    absWorkingDir: fileURLToPath(new URL("..", import.meta.url)),
    entryPoints: ["src/three-games.mjs"], outfile: "assets/three-games.js",
    bundle: true, format: "esm", platform: "browser", target: "es2022",
    minify: true, legalComments: "external"
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await build3d();
