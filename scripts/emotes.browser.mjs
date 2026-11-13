import assert from "node:assert/strict";
import { createBombBrowserQA } from "./online-bomb.browser.mjs";
import { canvasCheck } from "./expansion.browser.mjs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { basename } from "node:path";
import { build } from "esbuild";

// Serve the current sources without overwriting another agent's generated assets.
export async function createEmoteBrowserQA(browser, base) {
  const result = await build({
    absWorkingDir: fileURLToPath(new URL("..", import.meta.url)),
    entryPoints: ["three-games", "arcade-games", "collection-games", "kart-game", "online-bomb", "adventures", "adventure-model"].map(name => `src/${name}.mjs`),
    outdir: "assets", write: false, bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true,
    external: ["../assets/*.png"]
  });
  const outputs = new Map(result.outputFiles.map(file => [basename(file.path), file.contents]));
  const qa = await createBombBrowserQA(browser, base), client = qa.client;
  qa.client = async options => {
    const page = await client(options);
    await page.route("**/assets/*", route => {
      const name = new URL(route.request().url()).pathname.split("/").pop(), body = outputs.get(name);
      return body ? route.fulfill({ body: Buffer.from(body), contentType: name.endsWith(".css") ? "text/css" : "text/javascript" }) : route.fallback();
    });
    return page;
  };
  return qa;
}

export async function runEmoteQA(browser, base = "http://127.0.0.1:4173", capture = async () => {}) {
  const qa = await createEmoteBrowserQA(browser, base), checks = [];
  const ready = page => page.waitForFunction(() => !!threeGameSession);
  const open = async page => { await page.keyboard.press("KeyM"); await page.locator(".mgw-emote-wheel").waitFor({ state: "visible" }); };
  try {
    const page = await qa.client(); await page.evaluate(() => startThreeGame(0)); await ready(page);
    await page.keyboard.down("KeyW"); await page.waitForTimeout(80); await open(page); await page.keyboard.up("KeyW");
    const start = await page.evaluate(() => threeGameSession.snapshot().position); await page.waitForTimeout(220);
    const end = await page.evaluate(() => threeGameSession.snapshot().position); assert.ok(Math.hypot(end.x - start.x, end.z - start.z) < 0.01, "opening clears held movement");
    for (const [width, height] of [[1280, 800], [390, 844], [844, 390]]) {
      await page.setViewportSize({ width, height }); await page.waitForTimeout(100);
      await page.locator('[data-wheel-emote=""]').first().evaluate(button => button.click());
      assert.equal(await page.locator('[data-wheel-emote=""]').count(), 3);
      const fits = await page.locator(".mgw-emote-wheel").evaluate(wheel => {
        const nodes = [wheel, ...wheel.querySelectorAll("button:not([hidden])")], boxes = nodes.map(e => e.getBoundingClientRect());
        return boxes.every(r => r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight) && wheel.scrollWidth <= wheel.clientWidth;
      }); assert.ok(fits, `${width}x${height} wheel fits`); await capture(page, `emote-wheel-${width}`);
    }
    assert.equal(await page.locator('[data-emote-buy]').isHidden(), true);
    await page.keyboard.press("KeyM"); assert.equal(await page.evaluate(() => threeGameSession.snapshot().paused), false);
    await open(page); await page.keyboard.press("Escape"); assert.equal(await page.locator("dialog[open]").count(), 0);
    await open(page); await page.keyboard.press("Digit2"); await page.waitForFunction(() => threeGameSession.snapshot().emote === "spin");
    assert.equal(await page.locator(".mgw-emote-wheel[open]").count(), 0); checks.push("six positions, owned-only guest favorites, keyboard, movement reset, responsive layout");
    await page.evaluate(() => showMainMenu()); assert.equal(await page.locator(".mgw-emote-wheel").count(), 0);
    await page.setViewportSize({ width: 1280, height: 800 });

    await qa.patch("users/emotebuyer", { username: "EmoteBuyer", coins: 1000, flameCoins: 50, ownedItems: { "skin-round": true } });
    await page.evaluate(async () => { currentAccount = { username: "EmoteBuyer" }; await refreshCurrentUserData(); startShopButton.click(); });
    const groove = page.locator('[data-shop-id="emote-groove"]'); await groove.waitFor({ state: "visible" }); await groove.click();
    await page.waitForFunction(() => currentUserData?.ownedItems?.["emote-groove"] === true && document.querySelector('[data-shop-id="emote-groove"]').textContent === "Owned");
    assert.equal(qa.get("users/emotebuyer/coins"), 800); assert.equal(await groove.isDisabled(), true); await capture(page, "emote-shop");
    await page.locator('[data-shop-id="emote-twirl"]').click();
    await page.waitForFunction(() => currentUserData?.ownedItems?.["emote-twirl"] === true); assert.equal(qa.get("users/emotebuyer/coins"), 450);
    const failure = await page.evaluate(async () => { try { await buyEmote("flip"); } catch (error) { return error.message; } });
    assert.match(failure, /Not enough/); assert.equal(qa.get("users/emotebuyer/coins"), 450);
    await page.evaluate(() => startThreeGame(0)); await ready(page); await open(page);
    assert.equal(await page.locator('[data-wheel-emote="groove"]').getAttribute("data-locked"), "false");
    await page.locator('[data-wheel-emote="groove"]').click(); await page.waitForTimeout(160);
    const pose = await page.evaluate(() => threeGameSession.snapshot()); assert.equal(pose.emote, "groove"); assert.ok(Math.abs(pose.emoteVisual.tilt) > 0.01 || pose.emoteVisual.y > 0.01); assert.ok((await canvasCheck(page)).colors > 50);
    await page.keyboard.press("Escape"); await page.getByLabel("Victory pose", { exact: true }).selectOption("twirl"); await page.locator('[data-action="restart"]').click(); await ready(page);
    await page.keyboard.press("Escape"); assert.equal(await page.getByLabel("Victory pose", { exact: true }).inputValue(), "twirl");
    await page.evaluate(() => showMainMenu()); checks.push("shop purchases, balance, insufficient funds, owned animation, saved victory");

    // A stale/edited favorite may name an earned emote, but never bypasses ownership.
    await page.evaluate(() => localStorage.setItem("mgw-victory-pose-emotebuyer-wheel", JSON.stringify(["levitate", "levitate", "invalid", "spin"])));
    await page.evaluate(() => startThreeGame(0)); await ready(page); await open(page);
    assert.equal(await page.locator("[data-wheel-emote]").count(), 6);
    assert.equal(await page.locator('[data-wheel-emote="levitate"]').count(), 0);
    assert.equal(await page.locator("[data-emote-buy]").isHidden(), true);
    await page.locator("[data-emote-buy]").evaluate(button => button.click());
    assert.equal(qa.get("users/emotebuyer/coins"), 450);
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    await page.locator(".emote-favorites summary").click();
    assert.equal(await page.getByLabel("Emote slot 1", { exact: true }).locator("option").count(), 10);
    assert.equal(await page.getByLabel("Emote slot 1", { exact: true }).locator('[value="levitate"]').evaluate(option => option.disabled), true);
    assert.match(await page.locator('[data-emote="levitate"]').getAttribute("title"), /10 secret relics/);
    await page.evaluate(() => showMainMenu());

    await qa.patch("users/emotebuyer", { coins: 1900 });
    await page.evaluate(async () => { await refreshCurrentUserData(); startShopButton.click(); });
    for (const id of ["shuffle", "sway"]) {
      await page.locator(`[data-shop-id="emote-${id}"]`).click();
      await page.waitForFunction(id => currentUserData?.ownedItems?.[`emote-${id}`] === true, id);
    }
    assert.equal(qa.get("users/emotebuyer/coins"), 450);
    assert.equal(await page.locator('[data-shop-id="emote-levitate"]').count(), 0);
    await page.evaluate(async () => {
      const core = await getAdventureCore(), owner = getUserKeyFromAccount();
      for (const id of core.SECRET_IDS.slice(0, 9)) await recordAdventureEvent(owner, { type: "secret", id });
    });
    assert.notEqual(qa.get("users/emotebuyer/ownedItems/emote-levitate"), true);
    await page.evaluate(async () => {
      const core = await getAdventureCore();
      await recordAdventureEvent(getUserKeyFromAccount(), { type: "secret", id: core.SECRET_IDS[9] });
      showStartSection("adventures");
      await renderAdventures("secrets");
    });
    await page.locator('[data-reward="explorer-10"]').click();
    await page.waitForFunction(() => currentUserData?.ownedItems?.["emote-levitate"] === true);
    await page.evaluate(async () => { await refreshCurrentUserData(); startThreeGame(0); }); await ready(page);
    await page.keyboard.press("Escape"); await page.locator(".emote-favorites summary").click();
    const favorites = ["shuffle", "levitate", "bounce", "groove", "twirl", "sway"];
    for (const [index, id] of favorites.entries()) await page.getByLabel(`Emote slot ${index + 1}`, { exact: true }).selectOption(id);
    await page.getByLabel("Emote slot 1", { exact: true }).selectOption("levitate");
    assert.equal(await page.getByLabel("Emote slot 2", { exact: true }).inputValue(), "shuffle");
    await page.getByLabel("Emote slot 1", { exact: true }).selectOption("shuffle");
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("mgw-victory-pose-emotebuyer-wheel"))), favorites);
    await page.locator('[data-action="restart"]').click(); await ready(page); await open(page);
    assert.deepEqual(await page.locator("[data-wheel-emote]").evaluateAll(nodes => nodes.map(node => node.dataset.wheelEmote)), favorites);
    await page.locator('[data-wheel-emote="levitate"]').click(); await page.waitForFunction(() => threeGameSession.snapshot().emote === "levitate");
    await page.evaluate(() => showMainMenu());
    await page.evaluate(() => { currentAccount = { username: "Other" }; currentUserData = { coins: 0, ownedItems: {} }; startThreeGame(0); }); await ready(page); await open(page);
    assert.deepEqual(await page.locator("[data-wheel-emote]").evaluateAll(nodes => nodes.map(node => node.dataset.wheelEmote)), ["bounce", "spin", "bow", "", "", ""]);
    await page.evaluate(() => showMainMenu());
    await page.evaluate(async () => { currentAccount = { username: "EmoteBuyer" }; await refreshCurrentUserData(); });
    checks.push("nine emotes, unique six-slot favorites, account-specific persistence, earned-only Levitate gating");

    for (const mode of ["catcher", "coin-rush", "dodger", "laser-dodge", "coastline-karts"]) {
      await page.evaluate(mode => startArcadeGame(mode), mode); await ready(page);
      if (mode === "coastline-karts") await page.locator('[data-action="resume"]').click();
      await open(page); await page.locator('[data-wheel-emote="bounce"]').click(); assert.equal(await page.locator('.mgw-emote-wheel[open]').count(), 0);
      await page.evaluate(() => showMainMenu()); assert.equal(await page.locator('.mgw-emote-wheel').count(), 0);
    }
    checks.push("all five other solo cube games and cleanup");

    await page.evaluate(async () => { selectedOnlineGame = "online-bomb-tag"; await createRoom(); }); await ready(page);
    const code = await page.evaluate(() => onlineRoomCode), guest = await qa.client(); await guest.evaluate(async code => { roomCodeInput.value = code; await joinRoom(); }, code); await ready(guest); await ready(page);
    const muted = await page.evaluate(() => threeGameSession.snapshot().audio.muted); await open(page);
    assert.equal(await page.evaluate(() => threeGameSession.snapshot().audio.muted), muted);
    await page.locator('[data-wheel-emote="groove"]').click(); await guest.waitForFunction(() => onlineState.playersState.p1.emote?.id === "groove");
    await page.keyboard.press("KeyN"); assert.notEqual(await page.evaluate(() => threeGameSession.snapshot().audio.muted), muted);
    await page.locator('[data-action="chat"]').click(); await page.getByRole("textbox", { name: "Chat message" }).fill("m"); await page.keyboard.press("KeyM");
    assert.equal(await page.getByRole("textbox", { name: "Chat message" }).inputValue(), "mm"); assert.equal(await page.locator('.mgw-emote-wheel[open]').count(), 0);
    await page.evaluate(() => returnToMainMenu()); await guest.waitForFunction(() => !threeGameSession); await guest.context().close();
    checks.push("remote paid emote, M does not mute, N mute, chat typing");

    const web = await qa.client({ app: false }); await web.evaluate(async () => { currentAccount = { username: "EmoteBuyer" }; await refreshCurrentUserData(); startShopButton.click(); });
    await web.locator('[data-shop-id="emote-twirl"]').waitFor({ state: "visible" }); assert.equal(await web.locator('[data-shop-id="emote-twirl"]').textContent(), "Owned");
    await web.context().close(); await page.context().close(); assert.deepEqual(qa.errors, []); return checks;
  } finally { await qa.dispose(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import("playwright-core"), { mkdir } = await import("node:fs/promises"), { tmpdir } = await import("node:os"), { join } = await import("node:path");
  const directory = join(tmpdir(), "minigameworld-emote-qa"); await mkdir(directory, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--mute-audio"] });
  try { console.log(await runEmoteQA(browser, process.argv[2], (page, name) => page.screenshot({ path: join(directory, `${name}.png`) }))); console.log(`Screenshots: ${directory}`); }
  finally { await browser.close(); }
}
