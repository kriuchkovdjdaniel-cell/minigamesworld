import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBombBrowserQA } from "./online-bomb.browser.mjs";
import { canvasCheck } from "./expansion.browser.mjs";

export async function runBossQA(browser, base = "http://127.0.0.1:4173", capture = async () => {}) {
  // Expose only isolated QA simulations; no diagnostic hooks enter shipped assets.
  const bundle = await build({ absWorkingDir: fileURLToPath(new URL("..", import.meta.url)), stdin: { resolveDir: fileURLToPath(new URL("..", import.meta.url)), contents: `
    import { mountZombieGame as mount } from './src/zombie-game.mjs';
    import { createZombieSimulation, normalizeCheckpoint } from './src/zombie-world.mjs';
    export { normalizeCheckpoint };
    export async function mountZombieGame(host, options) {
      const simulation = await createZombieSimulation(options.checkpoint); globalThis.__bossQA = simulation;
      return mount(host, { ...options, simulation });
    }` }, bundle: true, format: "esm", platform: "browser", target: "es2022", write: false });
  const qa = await createBombBrowserQA(browser, base), checks = [];
  const ready = page => page.waitForFunction(() => !!threeGameSession);
  try {
    const page = await qa.client();
    await page.route("**/assets/zombie-game.js?*", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
    for (let stop = 0; stop < 3; stop++) {
      await page.evaluate(async stop => {
        localStorage.setItem("dead-route-3d-checkpoint-guest", JSON.stringify({ version: 1, stopIndex: stop })); await startZombieGame();
      }, stop); await ready(page);
      await page.locator(".route-boss").waitFor({ state: "visible" });
      assert.ok((await canvasCheck(page)).colors > 50);
      await page.evaluate(() => {
        const sim = __bossQA, boss = sim.state.enemies.find(enemy => enemy.boss), b = sim.bus.body.translation();
        for (const enemy of sim.state.enemies) if (enemy !== boss) { enemy.hp = 0; enemy.collider.setEnabled(false); }
        boss.body.setTranslation({ x: b.x, y: 0.95, z: b.z - 7 }, true); boss.body.setNextKinematicTranslation({ x: b.x, y: 0.95, z: b.z - 7 }); boss.bossTimer = 0;
      });
      await page.waitForFunction(() => threeGameSession.snapshot().boss?.phase === "windup");
      const notice = await page.locator(".zombie-notice").boundingBox(), bossHud = await page.locator(".route-boss").boundingBox();
      assert.ok(!notice || notice.y >= bossHud.y + bossHud.height, "attack notice must not cover boss health");
      await capture(page, `boss-${stop + 1}-warning`);
      await page.evaluate(() => { for (const enemy of __bossQA.state.enemies) { enemy.hp = 0; enemy.collider.setEnabled(false); } });
      await page.locator("[data-route-upgrades]").waitFor({ state: "visible" });
      assert.equal(await page.locator("[data-route-choice]:enabled").count(), 3);
      if (stop === 0) for (const [width, height] of [[390, 844], [844, 390], [1280, 800]]) {
        await page.setViewportSize({ width, height }); await capture(page, `boss-upgrades-${width}`);
        const overflow = await page.locator(".zombie-menu").evaluate(menu => menu.scrollWidth > menu.clientWidth + 1); assert.equal(overflow, false);
        await page.locator('[data-route-choice="overdrive"]').scrollIntoViewIfNeeded();
      }
      const selected = ["reinforced", "overdrive", "field-medic"][stop]; await page.locator(`[data-route-choice="${selected}"]`).click();
      await page.waitForFunction(({ stop, selected }) => threeGameSession.snapshot().routeUpgrades[stop] === selected && !threeGameSession.snapshot().paused, { stop, selected });
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("dead-route-3d-checkpoint-guest")));
      assert.equal(saved.routeUpgrades[stop], selected); assert.equal(saved.stopCleared, true);
      await page.evaluate(() => showMainMenu());
      await page.evaluate(() => startZombieGame()); await ready(page);
      assert.equal(await page.evaluate(() => threeGameSession.snapshot().enemies), 0);
      assert.equal(await page.locator("[data-route-upgrades]").isVisible(), false);
      await page.evaluate(() => showMainMenu());
    }
    checks.push("three distinct boss scenes/warnings, responsive upgrade menus, choice/save/reload without duplicate rewards");

    const host = await qa.client(), guest = await qa.client();
    await host.evaluate(async () => { selectedOnlineGame = "online-dead-route"; await createRoom(); }); await ready(host);
    const code = await host.evaluate(() => onlineRoomCode);
    await guest.evaluate(async code => { roomCodeInput.value = code; await joinRoom(); }, code); await ready(guest);
    await guest.waitForFunction(() => threeGameSession.snapshot().boss?.hp > 0);
    assert.equal(await guest.locator(".mgw-photo-open").count(), 0, "shared live simulation cannot be paused for photos");
    for (let stop = 0; stop < 3; stop++) {
      await host.evaluate(() => { for (const enemy of onlineCoopRuntime.world.enemies) { enemy.hp = 0; enemy.collider.setEnabled(false); } });
      for (const client of [host, guest]) await client.locator("[data-route-upgrades]").waitFor({ state: "visible" });
      assert.equal(await guest.locator("[data-route-choice]:enabled").count(), 0);
      await capture(guest, `boss-coop-guest-${stop + 1}`);
      const selected = ["reinforced", "overdrive", "field-medic"][stop]; await host.locator(`[data-route-choice="${selected}"]`).click();
      for (const client of [host, guest]) await client.waitForFunction(({ stop, selected }) => threeGameSession.snapshot().routeUpgrades[stop] === selected && !threeGameSession.snapshot().paused, { stop, selected });
      if (stop < 2) {
        await host.evaluate(() => {
          const world = onlineCoopRuntime.world; world.state.fuelFound = true; world.bus.driver = "p1";
          for (const player of world.players.values()) { player.inBus = true; player.collider.setEnabled(false); }
          const p = { x: 0, y: 1.5, z: -(world.state.stopIndex + 1) * 100 + 7 }; world.bus.body.setTranslation(p, true); world.bus.body.setNextKinematicTranslation(p);
        });
        await guest.waitForFunction(stop => threeGameSession.snapshot().stop === stop + 1, stop);
      }
    }
    await host.evaluate(() => returnToMainMenu()); await guest.waitForFunction(() => !threeGameSession);
    checks.push("host-only co-op upgrades, guest waiting/acknowledgment, three stops synchronized, host closure");
    assert.deepEqual(qa.errors, []); return checks;
  } finally { await qa.dispose(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import("playwright-core"), { mkdir } = await import("node:fs/promises"), { tmpdir } = await import("node:os"), { join } = await import("node:path");
  const directory = join(tmpdir(), "minigameworld-boss-qa"); await mkdir(directory, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--mute-audio"] });
  try { console.log(await runBossQA(browser, process.argv[2], (page, name) => page.screenshot({ path: join(directory, `${name}.png`) }))); console.log(`Screenshots: ${directory}`); }
  finally { await browser.close(); }
}
