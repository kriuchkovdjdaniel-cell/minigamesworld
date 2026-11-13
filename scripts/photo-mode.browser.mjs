import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createEmoteBrowserQA } from "./emotes.browser.mjs";
import { canvasCheck } from "./expansion.browser.mjs";

export async function runPhotoQA(browser, base = "http://127.0.0.1:4173", capture = async () => {}) {
  const qa = await createEmoteBrowserQA(browser, base), checks = [];
  const ready = page => page.waitForFunction(() => !!threeGameSession);
  const state = page => page.evaluate(() => threeGameSession.snapshot());
  const open = async page => { await page.getByRole("button", { name: "Photo mode", exact: true }).click(); await page.waitForFunction(() => document.querySelector("#threeGameHost").dataset.photo === "true"); };
  const drag = async (page, button = "right") => {
    const r = await page.locator("#threeGameHost > canvas").first().boundingBox();
    await page.mouse.move(r.x + r.width * 0.42, r.y + r.height * 0.35); await page.mouse.down({ button });
    await page.mouse.move(r.x + r.width * 0.57, r.y + r.height * 0.42, { steps: 8 }); await page.mouse.up({ button });
  };
  const range = (page, name, value) => page.getByRole("slider", { name }).evaluate((input, value) => { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); }, String(value));
  const frozen = async page => {
    const before = await state(page); await page.keyboard.press("KeyW"); await page.waitForTimeout(180); const after = await state(page);
    assert.equal(after.paused, true); assert.equal(after.elapsed, before.elapsed); assert.deepEqual(after.position, before.position);
    assert.equal(after.photo.active, true);
  };
  try {
    const page = await qa.client();
    await page.evaluate(() => startThreeGame(0)); await ready(page); await page.waitForTimeout(120);
    const normal = await state(page); await open(page); await frozen(page);
    assert.equal(await page.locator("dialog[open]").count(), 0);
    assert.equal(await page.locator(".three-hud").evaluate(node => getComputedStyle(node).visibility), "hidden");
    assert.deepEqual(await page.getByLabel("Photo pose", { exact: true }).locator("option").evaluateAll(options => options.map(option => option.value)), ["", "bounce", "spin", "bow"]);
    await drag(page); assert.ok(Math.abs((await state(page)).camera.yaw - normal.camera.yaw) > 0.1, "right drag rotates camera");
    const beforePan = (await state(page)).photo.target; await drag(page, "left"); assert.notDeepEqual((await state(page)).photo.target, beforePan, "left drag pans camera");
    const beforeZoom = (await state(page)).camera.distance; await page.mouse.wheel(0, -250); await page.waitForTimeout(100);
    assert.ok((await state(page)).camera.distance < beforeZoom, "wheel zoom works");
    await range(page, "Photo lens", 70); await range(page, "Photo light", 0.7);
    assert.equal((await state(page)).photo.fov, 70); assert.equal((await state(page)).photo.exposure, 0.7);
    await page.getByLabel("Photo pose", { exact: true }).selectOption("bow"); const pose = (await state(page)).photo.avatar;
    assert.ok(Math.abs(pose.rotation[0]) > 0.1);
    await page.getByRole("button", { name: "Reset photo camera" }).click();
    assert.ok(Math.abs((await state(page)).camera.yaw - normal.camera.yaw) < 0.001);
    await page.evaluate(() => window.dispatchEvent(new Event("blur"))); await page.waitForTimeout(80);
    assert.equal((await state(page)).photo.suspended, true); assert.equal(await page.locator("dialog[open]").count(), 0); await frozen(page);
    await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await frozen(page);
    assert.equal((await state(page)).photo.suspended, false);
    await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
    assert.equal((await state(page)).photo.suspended, true); await frozen(page);
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); }); await frozen(page);
    assert.equal((await state(page)).photo.suspended, false);
    for (const [width, height] of [[1280, 800], [390, 844], [844, 390]]) {
      await page.setViewportSize({ width, height }); await page.waitForTimeout(120); await frozen(page);
      assert.deepEqual((await state(page)).photo.avatar, pose, "resize preserves photo pose");
      const fit = await page.locator(".mgw-photo-tools").evaluate(panel => [...panel.querySelectorAll("button,input,select")].every(node => {
        const r = node.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
      })); assert.ok(fit, `${width}: photo controls fit`);
      assert.ok((await canvasCheck(page)).colors > 50, "photo scene not blank"); await capture(page, `photo-${width}`);
    }
    const dimensions = await page.locator("#threeGameHost > canvas").first().evaluate(canvas => [canvas.width, canvas.height]);
    const downloaded = page.waitForEvent("download"); await page.getByRole("button", { name: "Download photo" }).click();
    const download = await downloaded, bytes = await readFile(await download.path());
    assert.match(download.suggestedFilename(), /^MiniGameWorld-.*\.png$/); assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], dimensions); assert.ok(bytes.length > 10000);
    const colors = await page.evaluate(async data => {
      const image = new Image(); image.src = "data:image/png;base64," + data; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64; const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0, 64, 64);
      const rgba = ctx.getImageData(0, 0, 64, 64).data, colors = new Set(); for (let i = 0; i < rgba.length; i += 4) colors.add(`${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`); return colors.size;
    }, bytes.toString("base64")); assert.ok(colors > 50, "export contains real scene pixels");
    await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(80);
    await page.keyboard.press("Escape"); const restored = await state(page);
    assert.equal(restored.paused, false); assert.equal(restored.photo.active, false); assert.equal(restored.photo.pan, normal.photo.pan);
    assert.equal(restored.photo.fov, normal.photo.fov); assert.equal(restored.photo.exposure, normal.photo.exposure); assert.equal(restored.photo.controlsEnabled, true);
    assert.ok(Math.abs(restored.camera.yaw - normal.camera.yaw) < 0.001);
    const start = restored.position; await page.keyboard.down("KeyD"); await page.waitForTimeout(200); await page.keyboard.up("KeyD");
    assert.ok(Math.abs((await state(page)).position.x - start.x) > 0.1, "movement restored");
    await drag(page); assert.ok(Math.abs((await state(page)).camera.yaw - normal.camera.yaw) > 0.1, "game camera controls restored");
    const music = await page.evaluate(() => ({ disabled: gameSettings.musicDisabled, pack: selectedMusicPack, paused: builtInMusicAudio?.paused ?? true }));
    assert.deepEqual(music, { disabled: true, pack: "none", paused: true });
    await open(page); await page.evaluate(() => showMainMenu()); assert.equal(await page.locator(".mgw-photo-tools,.mgw-photo-open").count(), 0);
    assert.equal(await page.locator('#threeGameHost[data-photo="true"]').count(), 0);
    checks.push("desktop/narrow photo framing, orbit/pan/zoom, lens/light/pose, PNG dimensions/pixels, pause/visibility, restore and None music");

    await qa.patch("users/photographer", { username: "Photographer", coins: 0, ownedItems: { "emote-shuffle": true, "emote-levitate": true } });
    await page.evaluate(async () => { currentAccount = { username: "Photographer" }; await refreshCurrentUserData(); });
    for (const mode of ["catcher", "coin-rush", "dodger", "laser-dodge", "coastline-karts"]) {
      await page.evaluate(mode => startArcadeGame(mode), mode); await ready(page);
      if (mode === "coastline-karts") await page.locator('[data-action="resume"]').click();
      await open(page); await frozen(page);
      const poses = await page.getByLabel("Photo pose", { exact: true }).locator("option").evaluateAll(nodes => nodes.map(node => node.value));
      assert.ok(poses.includes("shuffle") && poses.includes("levitate") && !poses.includes("sway"));
      await page.getByLabel("Photo pose", { exact: true }).selectOption("levitate");
      const before = (await state(page)).camera.yaw; await drag(page); assert.ok(Math.abs((await state(page)).camera.yaw - before) > 0.1);
      await page.evaluate(() => window.dispatchEvent(new Event("blur"))); await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await frozen(page);
      await page.getByRole("button", { name: "Close photo mode" }).click(); assert.equal((await state(page)).paused, false);
      await open(page); await page.evaluate(() => showMainMenu()); assert.equal(await page.locator(".mgw-photo-tools").count(), 0);
    }
    checks.push("all other solo cube engines: owned poses, pause, camera, blur, resume and active disposal");
    await page.evaluate(() => startZombieGame(true)); await ready(page); await open(page); await frozen(page);
    assert.equal(await page.getByLabel("Photo pose", { exact: true }).isVisible(), false);
    const routeYaw = (await state(page)).camera.yaw; await drag(page); assert.ok(Math.abs((await state(page)).camera.yaw - routeYaw) > 0.1);
    await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
    await frozen(page); assert.equal(await page.locator("dialog[open]").count(), 0);
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); });
    await page.getByRole("button", { name: "Close photo mode" }).click(); assert.equal((await state(page)).paused, false);
    await page.evaluate(() => showMainMenu()); checks.push("Dead Route solo photo camera, pause/visibility and restore");
    await page.evaluate(() => startThreeGame(0)); await ready(page); await open(page);
    await page.locator("#threeGameHost > canvas").first().evaluate(canvas => canvas.getContext("webgl2").getExtension("WEBGL_lose_context").loseContext());
    await page.waitForFunction(() => !threeGameSession.snapshot().photo.active);
    assert.equal((await state(page)).paused, true); assert.equal((await state(page)).photo.contextLost, true);
    assert.equal(await page.getByRole("button", { name: "Photo mode", exact: true }).isDisabled(), true);
    await page.evaluate(() => showMainMenu()); assert.deepEqual(qa.errors, []);
    checks.push("GPU context loss exits photo without resuming or leaking controls");
    return checks;
  } finally { await qa.dispose(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import("playwright-core"), { mkdir } = await import("node:fs/promises"), { tmpdir } = await import("node:os"), { join } = await import("node:path");
  const directory = join(tmpdir(), "minigameworld-photo-qa"); await mkdir(directory, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--mute-audio"] });
  try { console.log(await runPhotoQA(browser, process.argv[2], (page, name) => page.screenshot({ path: join(directory, `${name}.png`) }))); console.log(`Screenshots: ${directory}`); }
  finally { await browser.close(); }
}
