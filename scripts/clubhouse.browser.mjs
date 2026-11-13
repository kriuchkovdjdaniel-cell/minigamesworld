import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBombBrowserQA } from "./online-bomb.browser.mjs";

const state = page => page.evaluate(() => clubhouseSession.snapshot());
const ready = page => page.waitForFunction(() => clubhouseSession?.snapshot().renderedFrames > 0);
const settle = page => page.waitForFunction(() => !clubhouseSession.snapshot().framePending);

export async function clubhouseCanvasCheck(page) {
  const bytes = await page.locator(".mgw-clubhouse > canvas").screenshot();
  return page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
    const { viewport } = clubhouseSession.snapshot(), canvas = document.createElement("canvas"); canvas.width = 128; canvas.height = 96;
    const ctx = canvas.getContext("2d"), scale = image.height / viewport.height;
    ctx.drawImage(image, 0, viewport.top * scale, image.width, (viewport.bottom - viewport.top) * scale, 0, 0, 128, 96);
    const rgba = ctx.getImageData(0, 0, 128, 96).data, colors = new Map();
    for (let i = 0; i < rgba.length; i += 4) { const key = `${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`; colors.set(key, (colors.get(key) || 0) + 1); }
    return { colors: colors.size, variedPixels: 1 - Math.max(...colors.values()) / (128 * 96) };
  }, bytes.toString("base64"));
}

export async function runClubhouseQA(browser, base = "http://localhost:4173", capture = async () => {}) {
  // Serve fresh source in memory so this isolated suite never rewrites shared assets.
  const bundle = await build({ absWorkingDir: fileURLToPath(new URL("..", import.meta.url)), entryPoints: ["src/adventures.mjs"], outdir: "assets", bundle: true, format: "esm", platform: "browser", target: "es2022", write: false });
  const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).text, css = bundle.outputFiles.find(file => file.path.endsWith(".css")).text;
  const qa = await createBombBrowserQA(browser, base), checks = [], pixels = [];
  async function client(options) {
    const page = await qa.client(options);
    await page.route("**/assets/adventures.js*", route => route.fulfill({ contentType: "text/javascript", body: js }));
    await page.route("**/assets/adventures.css*", route => route.fulfill({ contentType: "text/css", body: css }));
    await page.locator("#startAdventuresButton").click();
    await page.locator("[data-adventure-tab='clubhouse']").click();
    await page.locator("[data-open-clubhouse]").click(); await ready(page);
    return page;
  }
  async function fixture(page, options = {}) {
    await page.evaluate(async options => {
      clubhouseSession?.dispose(); adventureView?.dispose(); adventureView = null;
      const host = document.getElementById("startAdventuresMenu"); host.classList.add("clubhouse-open");
      window.__clubQA = { saves: [], exits: 0, failure: false, hold: false };
      clubhouseSession = (await getAdventuresUi()).mountClubhouse(host, {
        ...options, name: "A deliberately long owner name that must not resize the toolbar",
        onSave: async value => { const qa = window.__clubQA; qa.saves.push(structuredClone(value)); if (qa.hold) await new Promise(resolve => { qa.release = resolve; }); if (qa.failure) throw new Error("Offline"); },
        onExit: () => { window.__clubQA.exits++; }
      });
    }, options);
    await ready(page);
  }
  async function view(page, name) {
    await page.getByRole("button", { name: "Reset clubhouse camera", exact: true }).click(); await settle(page);
    const snapshot = await state(page), layout = await page.locator(".mgw-clubhouse").evaluate(host => {
      const r = host.getBoundingClientRect(), toolbar = host.querySelector(".club-toolbar").getBoundingClientRect(), dock = host.querySelector(".club-dock").getBoundingClientRect();
      return { overflow: host.scrollWidth > host.clientWidth + 1, gap: dock.top - toolbar.bottom,
        fit: [toolbar, dock].every(b => b.left >= r.left && b.right <= r.right + 1 && b.top >= r.top && b.bottom <= r.bottom + 1),
        viewportFit: r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1 };
    });
    assert.equal(layout.overflow, false, `${name}: horizontal overflow`); assert.ok(layout.fit && layout.viewportFit, `${name}: controls clipped ${JSON.stringify(layout)}`);
    assert.ok(layout.gap >= 80, `${name}: no room left for canvas: ${layout.gap}`);
    assert.ok(snapshot.roomScreens.every(p => p.x >= 0 && p.x <= snapshot.viewport.width && p.y >= snapshot.viewport.top - 1 && p.y <= snapshot.viewport.bottom + 1), `${name}: room obscured by UI`);
    const result = await clubhouseCanvasCheck(page);
    assert.ok(result.colors > 100 && result.variedPixels > 0.1, `${name}: blank or tiny scene ${JSON.stringify(result)}`);
    pixels.push({ name, ...result, drawCalls: snapshot.drawCalls, canvas: snapshot.canvas }); await capture(page, name);
  }
  const choose = (page, id) => page.getByLabel("Selected furniture", { exact: true }).selectOption(id);
  const number = async (page, axis, value) => { const input = page.getByLabel(`Furniture ${axis}`, { exact: true }); await input.fill(String(value)); await input.press("Tab"); };
  try {
    const page = await client();
    assert.equal(await page.locator('[data-furniture="trophy"]').isDisabled(), true);
    const original = await state(page); assert.equal(original.items.length, 4); assert.equal(original.dirty, false);
    await view(page, "clubhouse-desktop");
    const canvas = page.locator(".mgw-clubhouse > canvas"), rect = await canvas.boundingBox();
    const tableScreen = (await state(page)).itemScreens.find(item => item.id === "starter-table");
    await page.mouse.click(rect.x + tableScreen.x, rect.y + tableScreen.y);
    assert.equal((await state(page)).selected, "starter-table", "ray selection");
    await page.getByRole("button", { name: "Furniture color: Rose", exact: true }).click();
    await number(page, "X", 3); await number(page, "Z", 2);
    await page.getByRole("button", { name: "Rotate furniture", exact: true }).click();
    let current = (await state(page)).items.find(item => item.id === "starter-table");
    assert.deepEqual([current.x, current.z, current.rotation, current.color], [3, 2, 1, "#bd819b"]);
    await number(page, "X", 99); assert.match((await state(page)).message, /outside/); assert.equal(await page.getByLabel("Furniture X", { exact: true }).inputValue(), "3");
    await number(page, "Z", ""); assert.match((await state(page)).message, /whole-number/);
    await choose(page, "starter-sofa"); await number(page, "X", 3); await number(page, "Z", 2); assert.match((await state(page)).message, /occupied/);
    await choose(page, "starter-table"); await canvas.focus(); await page.keyboard.press("ArrowRight"); await page.keyboard.press("r");
    current = (await state(page)).items.find(item => item.id === "starter-table"); assert.equal(current.x, 4); assert.equal(current.rotation, 2);
    await page.getByRole("button", { name: "Room color: Sky", exact: true }).click();
    await page.getByRole("button", { name: "Save clubhouse", exact: true }).click(); await page.waitForFunction(() => !clubhouseSession.snapshot().dirty);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("mgw-clubhouse-guest")));
    assert.equal(saved.accent, "#6298bb"); assert.equal(saved.items.find(item => item.id === "starter-table").x, 4);
    await page.getByRole("button", { name: "Close clubhouse", exact: true }).click(); await page.locator("[data-open-clubhouse]").click(); await ready(page);
    assert.deepEqual((await state(page)).items, saved.items); checks.push("guest save/reopen, canvas select, numeric/keyboard move, rotate, room/item colors, invalid placement");

    await page.getByRole("button", { name: "Room color: Rose", exact: true }).click();
    page.once("dialog", dialog => dialog.dismiss()); await page.locator("#startGamesButton").click();
    assert.equal((await state(page)).dirty, true); assert.equal(await page.evaluate(() => document.body.dataset.hubSection), "adventures");
    page.once("dialog", dialog => dialog.accept()); await page.locator("#startGamesButton").click();
    assert.equal(await page.evaluate(() => clubhouseSession), null);
    await page.locator("#startAdventuresButton").click(); await page.locator("[data-adventure-tab='clubhouse']").click();
    await page.locator("[data-open-clubhouse]").click(); await ready(page);
    assert.equal((await state(page)).accent, saved.accent); checks.push("navigation confirms unsaved changes and preserves the last saved room");

    await fixture(page, { trophies: true });
    await page.locator('[data-furniture="trophy"]').click(); assert.equal((await state(page)).items.at(-1).kind, "trophy");
    await page.getByRole("button", { name: "Remove furniture", exact: true }).click(); assert.equal((await state(page)).items.length, 4);
    await page.getByRole("button", { name: "Room color: Gold", exact: true }).click();
    await page.evaluate(() => { __clubQA.failure = true; }); await page.getByRole("button", { name: "Save clubhouse", exact: true }).click();
    await page.waitForFunction(() => clubhouseSession.snapshot().state === "error"); assert.equal((await state(page)).dirty, true);
    await capture(page, "clubhouse-save-error");
    await page.evaluate(() => { __clubQA.failure = false; __clubQA.hold = true; }); await page.getByRole("button", { name: "Save clubhouse", exact: true }).click();
    await page.waitForFunction(() => clubhouseSession.snapshot().busy);
    for (const selector of ["[data-club-save]", "[data-club-exit]", '[data-target="room"]', "[data-furniture]"]) assert.equal(await page.locator(selector).first().isDisabled(), true);
    await canvas.focus(); await page.keyboard.press("Control+s"); assert.equal(await page.evaluate(() => __clubQA.saves.length), 2);
    await page.evaluate(() => __clubQA.release()); await page.waitForFunction(() => !clubhouseSession.snapshot().busy);
    assert.equal((await state(page)).dirty, false); assert.equal((await state(page)).state, "saved");
    await page.getByRole("button", { name: "Room color: Emerald", exact: true }).click();
    page.once("dialog", dialog => dialog.dismiss()); await page.getByRole("button", { name: "Close clubhouse", exact: true }).click(); assert.equal(await page.evaluate(() => __clubQA.exits), 0);
    page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Close clubhouse", exact: true }).click(); assert.equal(await page.evaluate(() => __clubQA.exits), 1);
    checks.push("trophy authorization, delete, save error/retry/pending lock, unsaved exit cancel/confirm");

    await fixture(page);
    await page.getByRole("button", { name: "Room color: Violet", exact: true }).click();
    await page.getByRole("tab", { name: "Selected", exact: true }).click(); await choose(page, "starter-table"); await settle(page);
    const initialResources = (await state(page)).resources;
    for (let i = 0; i < 8; i++) { await page.getByRole("tab", { name: "Furniture", exact: true }).click(); await page.locator('[data-furniture="lamp"]').click(); await page.getByRole("button", { name: "Furniture color: Rose", exact: true }).click(); await page.getByRole("button", { name: "Remove furniture", exact: true }).click(); }
    await settle(page); assert.deepEqual((await state(page)).resources, initialResources, "add/remove/recolor does not accumulate GPU resources");
    const frameCount = (await state(page)).renderedFrames; await page.waitForTimeout(150); assert.equal((await state(page)).renderedFrames, frameCount, "idle renderer sleeps");
    await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
    const hiddenFrames = (await state(page)).renderedFrames; await page.getByRole("button", { name: "Room color: Gold", exact: true }).click();
    assert.equal((await state(page)).renderedFrames, hiddenFrames);
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); }); await settle(page);
    await page.evaluate(() => { const canvas = document.querySelector(".mgw-clubhouse > canvas"); window.__clubContext = canvas.getContext("webgl2").getExtension("WEBGL_lose_context"); __clubContext.loseContext(); });
    await page.waitForFunction(() => !clubhouseSession.snapshot().available);
    assert.equal(await page.getByRole("button", { name: "Save clubhouse", exact: true }).isDisabled(), false);
    await page.getByRole("button", { name: "Save clubhouse", exact: true }).click(); await page.waitForFunction(() => !clubhouseSession.snapshot().dirty);
    await page.evaluate(() => __clubContext.restoreContext()); await page.waitForFunction(() => clubhouseSession.snapshot().available); await settle(page);
    assert.ok((await clubhouseCanvasCheck(page)).colors > 100);
    checks.push("stable GPU resources, idle/hidden rendering, context loss/save/restore");

    await fixture(page);
    const beforeCamera = (await state(page)).camera.position;
    let bounds = await canvas.boundingBox(), safe = (await state(page)).viewport;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + (safe.top + safe.bottom) / 2); await page.mouse.down({ button: "right" });
    await page.mouse.move(bounds.x + bounds.width / 2 + 70, bounds.y + (safe.top + safe.bottom) / 2 + 25, { steps: 8 }); await page.mouse.up({ button: "right" }); await settle(page);
    assert.notDeepEqual((await state(page)).camera.position, beforeCamera); assert.equal((await state(page)).selected, "");
    const beforeZoom = (await state(page)).camera.position; await page.mouse.wheel(0, -200); await settle(page); assert.notDeepEqual((await state(page)).camera.position, beforeZoom);
    await view(page, "clubhouse-camera-reset");
    await page.getByRole("button", { name: "Collapse editor", exact: true }).click(); assert.equal((await state(page)).collapsed, true);
    await view(page, "clubhouse-collapsed"); await page.getByRole("button", { name: "Expand editor", exact: true }).click();
    for (const [width, height] of [[1920, 1080], [390, 844], [320, 740], [844, 390]]) { await page.setViewportSize({ width, height }); await view(page, `clubhouse-${width}`); }
    checks.push("orbit/zoom/reset, collapse/expand, desktop/narrow/landscape framing and canvas pixels");

    await page.setViewportSize({ width: 1280, height: 800 }); await fixture(page);
    await page.getByRole("button", { name: "Room color: Rose", exact: true }).click();
    assert.equal(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }), true);
    await page.evaluate(() => { __clubQA.hold = true; }); await page.getByRole("button", { name: "Save clubhouse", exact: true }).click(); await page.waitForFunction(() => clubhouseSession.snapshot().busy);
    await page.evaluate(() => { window.__oldClub = clubhouseSession; window.__oldRelease = __clubQA.release; window.__staleClubButton = document.querySelector("[data-club-save]"); __oldClub.dispose(); __oldClub.dispose(); });
    const disposed = await page.evaluate(() => __oldClub.snapshot()); assert.equal(disposed.disposed, true); assert.equal(disposed.framePending, false);
    for (const key of ["geometries", "materials", "textures", "models", "gpuGeometries"]) assert.equal(disposed.resources[key], 0, `dispose frees ${key}`);
    assert.equal(disposed.contextLost, true, "destroying the WebGL context releases internal renderer textures too");
    assert.equal(await page.locator(".mgw-clubhouse").count(), 0);
    assert.equal(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }), false);
    await fixture(page); await page.evaluate(() => { __oldRelease(); __staleClubButton.click(); document.dispatchEvent(new Event("visibilitychange")); });
    assert.equal((await state(page)).dirty, false); assert.equal(await page.evaluate(() => __oldClub.snapshot().renderedFrames), disposed.renderedFrames);
    const coldResources = (await state(page)).resources;
    for (let i = 0; i < 3; i++) { await fixture(page); assert.deepEqual((await state(page)).resources, coldResources); }
    checks.push("idempotent disposal, listener/RAF/GPU cleanup, pending save isolation, repeated remounts");

    const trophy = { id: "unearned", kind: "trophy", x: 0, z: 0, rotation: 0, color: "#4f9b83" };
    for (const trophies of [false, "true", 1]) { await fixture(page, { trophies, value: { items: [trophy] } }); assert.equal((await state(page)).items.length, 0); assert.equal(await page.locator('[data-furniture="trophy"]').isDisabled(), true); }
    await fixture(page, { trophies: true, value: { items: [trophy] } }); assert.equal((await state(page)).items.length, 1);
    const full = Array.from({ length: 24 }, (_, n) => ({ ...trophy, id: `item-${n}`, kind: "plant", x: n % 8 - 4, z: Math.floor(n / 8) - 2 }));
    await fixture(page, { value: { items: full } }); assert.equal(await page.locator("[data-furniture]:enabled").count(), 0);
    await page.getByRole("tab", { name: "Selected", exact: true }).click(); await choose(page, "item-0"); await page.getByRole("button", { name: "Remove furniture", exact: true }).click();
    await page.getByRole("tab", { name: "Furniture", exact: true }).click(); assert.equal(await page.locator('[data-furniture="plant"]').isDisabled(), false);
    checks.push("imported trophy gate and 24-item limit");

    const mobile = await client({ mobile: true, width: 390, height: 844 }); await view(mobile, "clubhouse-mobile-touch");
    const mobileCanvas = mobile.locator(".mgw-clubhouse > canvas"); bounds = await mobileCanvas.boundingBox();
    const point = (await state(mobile)).itemScreens.find(item => item.id === "starter-table");
    await mobile.touchscreen.tap(bounds.x + point.x, bounds.y + point.y); assert.equal((await state(mobile)).selected, "starter-table");
    await capture(mobile, "clubhouse-mobile-before-edit");
    await mobile.getByRole("button", { name: "Furniture color: Gold", exact: true }).click(); await number(mobile, "X", 0);
    await mobile.getByRole("button", { name: "Rotate furniture", exact: true }).click(); await mobile.getByRole("button", { name: "Save clubhouse", exact: true }).click(); await mobile.waitForFunction(() => !clubhouseSession.snapshot().dirty);
    await view(mobile, "clubhouse-mobile-selected");
    await mobile.setViewportSize({ width: 844, height: 390 }); await view(mobile, "clubhouse-mobile-landscape");
    checks.push("touch selection, mobile editing/save and orientation changes");

    await page.evaluate(async () => { clubhouseSession.dispose(); clubhouseSession = null; await renderAdventures(); });
    const headerStyle = await page.locator(".adventure-heading").evaluate(node => { const c = getComputedStyle(node); return { shadow: c.boxShadow, background: c.backgroundImage, radius: c.borderRadius }; });
    assert.deepEqual(headerStyle, { shadow: "none", background: "none", radius: "0px" });
    await capture(page, "adventures-scoped-heading");
    await page.evaluate(async () => createPartyLobby("private")); await page.locator("[data-party-status]").waitFor({ state: "visible" });
    const statusStyle = await page.locator("[data-party-status]").evaluate(node => { const c = getComputedStyle(node); return { weight: c.fontWeight, shadow: c.textShadow, color: c.color }; });
    assert.equal(statusStyle.weight, "400"); assert.equal(statusStyle.shadow, "none"); assert.notEqual(statusStyle.color, "rgb(255, 255, 85)");
    await capture(page, "party-scoped-heading"); await page.locator("[data-party-leave]").click();
    checks.push("scoped unframed Adventures/Party headings and muted status");
    assert.deepEqual(qa.errors, []); return { checks, pixels };
  } finally { await qa.dispose(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import("playwright-core"), { mkdir } = await import("node:fs/promises"), { tmpdir } = await import("node:os"), { join } = await import("node:path");
  const directory = join(tmpdir(), "minigameworld-clubhouse-qa"); await mkdir(directory, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--mute-audio"] });
  try { console.log(JSON.stringify(await runClubhouseQA(browser, process.argv[2], (page, name) => page.screenshot({ path: join(directory, `${name}.png`) })), null, 2)); console.log(`Screenshots: ${directory}`); }
  finally { await browser.close(); }
}
