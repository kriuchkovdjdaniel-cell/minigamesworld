import assert from "node:assert/strict";
import { createBombBrowserQA } from "./online-bomb.browser.mjs";
import { pathToFileURL } from "node:url";

export async function canvasCheck(page) {
  return page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
    const canvas = document.querySelector("#threeGameHost > canvas"), copy = document.createElement("canvas"); copy.width = copy.height = 64;
    const ctx = copy.getContext("2d"); ctx.drawImage(canvas, 0, 0, 64, 64); const pixels = ctx.getImageData(0, 0, 64, 64).data, colors = new Set();
    for (let i = 0; i < pixels.length; i += 4) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
    resolve({ colors: colors.size, overflow: document.documentElement.scrollWidth > innerWidth, scene: threeGameSession?.snapshot() });
  }))));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import("playwright-core");
  const { mkdir } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = join(tmpdir(), "minigameworld-expansion-qa"); await mkdir(directory, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--mute-audio"] });
  try { console.log(JSON.stringify(await runExpansionQA(browser, process.argv[2], (page, name) => page.screenshot({ path: join(directory, `${name}.png`) })), null, 2)); console.log(`Screenshots: ${directory}`); }
  finally { await browser.close(); }
}

export async function runExpansionQA(browser, base = "http://127.0.0.1:4173", capture = async () => {}) {
  const qa = await createBombBrowserQA(browser, base), report = [];
  const ready = page => page.waitForFunction(() => !!threeGameSession);
  const check = async (page, name) => { const result = await canvasCheck(page); assert.ok(result.colors > 50, `${name}: blank canvas`); assert.equal(result.overflow, false, `${name}: overflow`); report.push({ name, colors: result.colors, drawCalls: result.scene.drawCalls }); await capture(page, name); };
  try {
    const page = await qa.client();
    await page.evaluate(() => startArcadeGame("coastline-karts")); await ready(page);
    await page.locator("[data-paint]").fill("#ab6bd3"); await page.locator("[data-body]").selectOption("touring");
    await page.locator('#threeGameHost [data-action="resume"]').click();
    await page.waitForFunction(() => threeGameSession.snapshot().status === "racing");
    const cameraBefore = await page.evaluate(() => threeGameSession.snapshot().camera.yaw);
    await page.mouse.move(620, 370); await page.mouse.down({ button: "right" }); await page.mouse.move(790, 390, { steps: 8 });
    assert.ok(Math.abs(await page.evaluate(() => threeGameSession.snapshot().camera.yaw) - cameraBefore) > 0.1);
    await page.keyboard.press("Escape"); assert.equal(await page.evaluate(() => threeGameSession.snapshot().camera.dragging), false);
    await page.mouse.up({ button: "right" }); await page.locator('[data-action="resume"]').click();
    const initial = await page.evaluate(() => threeGameSession.snapshot().position);
    await page.keyboard.down("KeyW"); await page.waitForTimeout(850); await page.keyboard.up("KeyW");
    const moved = await page.evaluate(() => threeGameSession.snapshot()); assert.ok(Math.hypot(moved.position.x - initial.x, moved.position.z - initial.z) > 1); assert.ok(moved.speed > 1);
    await check(page, "kart-desktop");
    await page.keyboard.press("Escape"); await page.locator('[data-action="restart"]').click(); await ready(page);
    assert.equal(await page.locator('[data-body]').inputValue(), "touring"); assert.equal(await page.locator('[data-paint]').inputValue(), "#ab6bd3");
    for (const track of [1, 2]) {
      await page.locator('[data-action="menu"]').click(); await page.locator('[data-track]').selectOption(String(track)); await page.locator('[data-action="restart"]').click();
      await page.waitForFunction(track => threeGameSession?.snapshot().trackIndex === track, track); await check(page, `kart-track-${track + 1}`);
    }
    for (const [width, height] of [[390, 844], [844, 390]]) { await page.setViewportSize({ width, height }); await page.waitForTimeout(150); await check(page, `kart-${width}`); }
    await page.evaluate(() => showMainMenu()); await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => startThreeGame(0, true)); await ready(page);
    assert.equal(await page.evaluate(() => threeGameSession.snapshot().trial), true); await check(page, "trial-desktop");
    await page.waitForTimeout(200); await page.keyboard.press("Escape"); assert.equal(await page.evaluate(() => threeGameSession.snapshot().replayValid), false);
    await page.locator('[data-emote="bounce"]').click(); await page.waitForTimeout(100); assert.equal(await page.evaluate(() => threeGameSession.snapshot().paused), false);
    await page.evaluate(() => {
      const p = threeGameSession.snapshot().position;
      localStorage.setItem("crystal-isles-3d-progress-guest-replay-0", JSON.stringify({ version: 1, course: 0, seconds: 30, frames: [[0, p.x + 1, p.y, p.z, 0], [30, p.x + 1, p.y, p.z - 2, 1]] }));
      showMainMenu();
    });
    await page.evaluate(() => startThreeGame(0, true)); await ready(page); await page.waitForFunction(() => threeGameSession.snapshot().ghost);
    await check(page, "trial-ghost"); await page.keyboard.press("Escape"); await page.locator('[data-ghost]').uncheck(); await page.locator('[data-action="resume"]').click();
    await page.waitForFunction(() => !threeGameSession.snapshot().ghost);
    await page.evaluate(() => showMainMenu());
    for (const mode of ["catcher", "dodger"]) {
      await page.evaluate(mode => startArcadeGame(mode), mode); await ready(page); await page.keyboard.press("Escape"); await page.locator('[data-emote="spin"]').click(); await page.waitForTimeout(100); await check(page, `${mode}-emote`); await page.evaluate(() => showMainMenu());
    }
    await page.context().close();

    const host = await qa.client();
    await host.evaluate(async () => { selectedOnlineGame = "online-dead-route"; startRoomVisibilitySelect.value = "public"; await createRoom(); }); await ready(host);
    const code = await host.evaluate(() => onlineRoomCode), guests = [];
    for (let i = 0; i < 4; i++) { const guest = await qa.client(); await guest.evaluate(async code => { roomCodeInput.value = code; await joinRoom(); }, code); await ready(guest); guests.push(guest); }
    await host.waitForFunction(() => Object.keys(onlineState.route?.players || {}).length === 5); await ready(host);
    const rejected = await qa.client(); await rejected.evaluate(async code => { roomCodeInput.value = code; await joinRoom(); }, code);
    assert.match(await rejected.evaluate(() => roomNoteEl.textContent), /full/); await rejected.context().close();
    // The broker is isolated from Firebase. Freeze only enemies to test UI/network controls deterministically.
    await host.evaluate(() => { for (const enemy of onlineCoopRuntime.world.enemies) { enemy.hp = 0; enemy.collider.setEnabled(false); } });
    const guest = guests[0], before = await guest.evaluate(() => threeGameSession.snapshot().position);
    await guest.locator('#threeGameHost > canvas').first().focus(); await guest.keyboard.down("KeyD"); await guest.waitForTimeout(700); await guest.keyboard.up("KeyD");
    await guest.waitForTimeout(200); const after = await guest.evaluate(() => threeGameSession.snapshot().position);
    assert.ok(Math.hypot(after.x - before.x, after.z - before.z) > 1);
    const authoritative = await host.evaluate(() => onlineState.route.players.p2); assert.ok(Math.hypot(after.x - authoritative.x, after.z - authoritative.z) < 0.5);
    await check(host, "coop-five-player");
    const oldRun = await host.evaluate(() => onlineState.route.runId);
    await host.locator('[data-action="pause"]').click(); await host.locator('[data-action="restart"]').click(); await host.locator('[data-action="restart"]').click();
    await host.waitForFunction(old => onlineState.route?.runId !== old, oldRun); await ready(host);
    await guest.waitForFunction(old => onlineState.route?.runId !== old, oldRun);
    assert.equal(await guest.evaluate(() => threeGameSession.snapshot().status), "playing");
    await host.evaluate(() => { for (const enemy of onlineCoopRuntime.world.enemies) { enemy.hp = 0; enemy.collider.setEnabled(false); } });
    for (const [width, height] of [[390, 844], [844, 390]]) { await guest.setViewportSize({ width, height }); await guest.waitForTimeout(150); await check(guest, `coop-${width}`); }
    const departing = guests.pop(); await departing.evaluate(() => returnToMainMenu()); await host.waitForFunction(() => Object.keys(onlineState.route.players).length === 4);
    await host.evaluate(() => returnToMainMenu());
    for (const member of guests) await member.waitForFunction(() => !onlineRoomCode && !threeGameSession);
    await departing.context().close(); for (const member of guests) await member.context().close(); await host.context().close();

    const bombHost = await qa.client(), bombGuest = await qa.client();
    await bombHost.evaluate(async () => { selectedOnlineGame = "online-bomb-tag"; await createRoom(); }); await ready(bombHost);
    const bombCode = await bombHost.evaluate(() => onlineRoomCode);
    await bombGuest.evaluate(async code => { roomCodeInput.value = code; await joinRoom(); }, bombCode); await ready(bombGuest); await ready(bombHost);
    await bombHost.evaluate(() => { onlineState.bomb.ticks = 1; onlineSharedDirty = true; });
    await bombGuest.locator('.bomb-ballot').waitFor({ state: "visible" }); await bombGuest.locator('[data-vote="factory"]').click();
    await bombHost.waitForFunction(() => onlineState.playersState.p2.mapVote?.map === "factory");
    await check(bombGuest, "bomb-voting"); await bombHost.evaluate(() => { onlineState.bomb.voteTicks = 1; });
    await bombGuest.waitForFunction(() => threeGameSession?.snapshot().map === "factory" && !threeGameSession.snapshot().voting); await check(bombGuest, "bomb-factory");
    await bombGuest.locator('[data-action="menu"]').click(); await bombGuest.locator('[data-emote="bow"]').click();
    await bombHost.waitForFunction(() => onlineState.playersState.p2.emote?.id === "bow");
    for (const map of ["rooftops", "park"]) {
      await bombHost.evaluate(() => { onlineState.bomb.ticks = 1; onlineSharedDirty = true; });
      await bombGuest.locator('.bomb-ballot').waitFor({ state: "visible" }); await bombGuest.locator(`[data-vote="${map}"]`).click();
      await bombHost.waitForFunction(map => onlineState.playersState.p2.mapVote?.map === map && onlineState.playersState.p2.mapVote.round === onlineState.bomb.round, map);
      await bombHost.evaluate(() => { onlineState.bomb.voteTicks = 1; });
      await bombGuest.waitForFunction(map => threeGameSession?.snapshot().map === map && !threeGameSession.snapshot().voting, map); await check(bombGuest, `bomb-${map}`);
    }
    await bombHost.evaluate(() => returnToMainMenu()); await bombGuest.waitForFunction(() => !onlineRoomCode && !threeGameSession); await bombHost.context().close(); await bombGuest.context().close();

    for (const mode of ["coastline-karts", "online-dead-route"]) {
      const retry = await qa.client(), asset = mode === "coastline-karts" ? "kart-game" : "coop-route";
      let attempts = 0;
      await retry.route(`**/assets/${asset}.js?*`, route => ++attempts === 1 ? route.abort() : route.continue());
      await retry.evaluate(async mode => {
        if (mode === "coastline-karts") await startArcadeGame(mode);
        else { selectedOnlineGame = mode; await createRoom(); }
      }, mode);
      await retry.locator('[data-three-retry]').waitFor({ state: "visible" }); await retry.locator('[data-three-retry]').click(); await ready(retry);
      assert.ok(attempts >= 2, `${mode}: retry must request a fresh module`);
      await retry.evaluate(() => returnToMainMenu()); assert.equal(await retry.evaluate(() => !!threeGameSession), false); await retry.context().close();
    }
    const cancel = await qa.client(); let release;
    const delayed = new Promise(resolve => { release = resolve; });
    await cancel.route("**/assets/kart-game.js?*", async route => { await delayed; await route.continue(); });
    await cancel.evaluate(() => { void startArcadeGame("coastline-karts"); });
    await cancel.locator('[data-three-cancel]').click(); release(); await cancel.waitForTimeout(700);
    assert.equal(await cancel.evaluate(() => !!threeGameSession || !threeGameHost.hidden), false, "canceled load must not reopen"); await cancel.context().close();

    const web = await qa.client({ app: false }); await web.evaluate(() => startArcadeGame("coastline-karts")); assert.equal(await web.evaluate(() => !!threeGameSession), false, "web play gate"); await web.context().close();
    const phone = await qa.client({ app: true, mobile: true }); await phone.evaluate(() => startArcadeGame("coastline-karts")); assert.equal(await phone.evaluate(() => !!threeGameSession), false, "phone play gate"); await phone.context().close();
    assert.deepEqual(qa.errors, []); return report;
  } finally { await qa.dispose(); }
}
