import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createBombBrowserQA } from "./online-bomb.browser.mjs";
import { canvasCheck } from "./expansion.browser.mjs";

export async function runAdventureQA(browser, base = "http://127.0.0.1:4173", capture = async () => {}) {
  const qa = await createBombBrowserQA(browser, base), checks = [];
  try {
    const host = await qa.client(); await host.locator("#startAdventuresButton").click(); await host.locator("[data-weekly-play]").waitFor({ state: "visible" });
    await capture(host, "adventures-desktop");
    for (const width of [390, 844]) { await host.setViewportSize({ width, height: width === 390 ? 844 : 390 }); assert.ok(await host.locator("#startAdventuresMenu").evaluate(node => node.scrollWidth <= node.clientWidth + 1)); await capture(host, `adventures-${width}`); }
    await host.setViewportSize({ width: 1280, height: 800 });
    await host.locator('[data-adventure-tab="secrets"]').click(); assert.equal(await host.locator(".adventure-relic").count(), 10);
    await host.locator('[data-adventure-tab="mastery"]').click(); assert.equal(await host.locator(".adventure-reward").count(), 7);
    checks.push("adventure navigation, relic/mastery lists, responsive layout");

    await qa.patch("users/adventurer", { username: "Adventurer", coins: 100, ownedItems: { "skin-round": true } });
    await host.evaluate(async () => { currentAccount = { username: "Adventurer" }; await refreshCurrentUserData(); await renderAdventures("secrets"); });
    await host.evaluate(async () => { const core = await getAdventureCore(); await Promise.all(core.SECRET_IDS.slice(0, 3).map(id => recordAdventureEvent(getUserKeyFromAccount(), { type: "secret", id }))); await renderAdventures("secrets"); });
    assert.equal(Object.keys(qa.get("users/adventurer/adventure/secrets")).length, 3);
    await host.locator('[data-reward="explorer-3"]').click(); await host.waitForFunction(() => currentUserData?.ownedItems?.["color-relic"] === true);
    assert.equal(qa.get("users/adventurer/coins"), 100); await host.getByRole("button", { name: "Equip", exact: true }).click(); await host.waitForFunction(() => playerStyle.color === "relic");
    assert.equal(await host.locator("#startColorSelect").inputValue(), "relic"); assert.equal(await host.locator('#startColorSelect option[value="relic"]').isDisabled(), false);
    await host.evaluate(async () => { const core = await getAdventureCore(), w = core.weeklyChallenge(); await recordAdventureEvent(getUserKeyFromAccount(), { type: "finish", game: w.game, level: w.level, won: true, seconds: 90, challenge: w.id }); await renderAdventures("weekly"); });
    await host.locator("[data-weekly-claim]").click(); await host.waitForFunction(() => currentUserData.coins === 250); assert.equal(await host.locator("[data-weekly-claim]").isDisabled(), true);
    await host.locator("[data-weekly-play]").click(); await host.waitForFunction(() => !!threeGameSession); assert.ok((await canvasCheck(host)).colors > 50); await capture(host, "weekly-game");
    await host.evaluate(() => showMainMenu()); checks.push("saved relic claim/equip, weekly claim and playable challenge");

    await host.evaluate(async () => { await createPartyLobby("private"); }); await host.locator("[data-party-code]").waitFor({ state: "visible" });
    const code = await host.evaluate(() => onlineRoomCode); assert.equal(qa.get(`rooms/${code}/party/phase`), "lobby"); assert.equal(await host.evaluate(() => !!threeGameSession), false);
    const clients = [host];
    for (let i = 0; i < 4; i++) { const page = await qa.client(); clients.push(page); await page.evaluate(code => joinPartyLobby(code), code); await page.locator("[data-party-ready]").waitFor({ state: "visible" }); }
    await host.waitForFunction(() => document.querySelectorAll(".party-members li").length === 5); await capture(host, "party-five-player");
    const sixth = await qa.client(); await sixth.evaluate(code => joinPartyLobby(code), code); assert.equal(await sixth.evaluate(() => onlineRoomCode), ""); await sixth.context().close();
    await host.getByLabel("Party game vote").selectOption("online-bomb-tag"); await host.getByLabel("Party map vote").selectOption("factory"); await host.locator("[data-party-vote]").click();
    for (const page of clients) { await page.locator("[data-party-ready]").click(); await page.waitForFunction(() => partySnapshot.party.ready[onlinePlayerSlot] === playerId); }
    await host.locator("[data-party-start]").click();
    for (const page of clients) await page.waitForFunction(() => currentGame === "online-bomb-tag" && !!threeGameSession && !partyLobbyActive);
    assert.equal(qa.get(`rooms/${code}/bomb/map`), "factory"); assert.equal(Object.keys(qa.get(`rooms/${code}/members`)).length, 5); await capture(host, "party-bomb-tag");
    await host.locator('[data-action="menu"]').click();
    await host.waitForFunction(() => document.getElementById("partyReturnButton")?.closest("dialog"));
    host.once("dialog", dialog => dialog.accept()); await host.locator("#partyReturnButton").click();
    for (const page of clients) await page.locator("[data-party-ready]").waitFor({ state: "visible" });
    for (const page of clients.slice(0, 3)) { await page.getByLabel("Party game vote").selectOption("online-snake"); await page.getByLabel("Party map vote").selectOption("park"); await page.locator("[data-party-vote]").click(); await page.waitForFunction(() => partySnapshot.party.votes[onlinePlayerSlot]?.game === "online-snake"); }
    for (const page of clients) { await page.locator("[data-party-ready]").click(); await page.waitForFunction(() => partySnapshot.party.ready[onlinePlayerSlot] === playerId); }
    await host.locator("[data-party-start]").click(); for (const page of clients) await page.waitForFunction(() => currentGame === "online-snake" && !partyLobbyActive);
    assert.equal(qa.get(`rooms/${code}/party/round`), 2); assert.equal(Object.keys(qa.get(`rooms/${code}/members`)).length, 5);
    await clients[1].evaluate(async () => { paused = true; await patchRoom(onlineRoomCode, { chat: [{ username: "Guest", text: "Party chat", at: Date.now() }], [`playersState/${onlinePlayerSlot}`]: { ...onlineState.playersState[onlinePlayerSlot], score: 0 } }); });
    await host.waitForFunction(() => onlineState.chat.some(message => message.text === "Party chat"));
    await host.evaluate(() => updateParty("lobby")); await clients[4].locator("[data-party-leave]").waitFor({ state: "visible" }); await clients[4].locator("[data-party-leave]").click(); await host.waitForFunction(() => document.querySelectorAll(".party-members li").length === 4);
    const outsider = await qa.client(); await outsider.evaluate(code => joinPartyLobby(code), code); await host.waitForFunction(() => document.querySelectorAll(".party-members li").length === 5);
    assert.equal(await outsider.evaluate(() => partySnapshot.party.ready[onlinePlayerSlot] === playerId), false);
    await host.locator("[data-party-leave]").click(); await outsider.waitForFunction(() => !onlineRoomCode); checks.push("five-player party, full rejection, ready/vote, two game switches, slot reuse, host closure");

    const weeklyPage = await qa.client();
    for (const [file, mount] of [["three-games", "mountThreeGame"], ["arcade-games", "mountArcadeGame"]]) {
      const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL("..", import.meta.url)), contents: `
        import { ${mount} as mount } from './src/${file}.mjs'; export * from './src/${file}.mjs';
        export function ${mount}(host, options) { globalThis.__weeklyFinish = options.onFinish; return mount(host, options); }
      ` }, bundle: true, write: false, outfile: "qa.js", external: ["../assets/*.png"], format: "esm", platform: "browser", target: "es2022" });
      await weeklyPage.route(`**/assets/${file}.js?*`, route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
    }
    await qa.patch("users/weeklytester", { username: "WeeklyTester", coins: 20, bestScores: { dodger: 3, "laser-dodge": 4, "crystal-isles-3d": 5 } });
    await weeklyPage.evaluate(async () => { currentAccount = { username: "WeeklyTester" }; await refreshCurrentUserData(); });
    for (let week = 0; week < 3; week++) {
      await weeklyPage.clock.setFixedTime(new Date(Date.UTC(2026, 10, 2 + week * 7, 12)));
      const state = await weeklyPage.evaluate(async () => {
        const core = await getAdventureCore(), weekly = core.weeklyChallenge();
        const before = { best: getLocalBestScore(weekly.game), progress: localStorage.getItem("crystal-isles-3d-progress-weeklytester") };
        if (weekly.game === "crystal-isles-3d") await startThreeGame(weekly.level, false, weekly); else await startArcadeGame(weekly.game, weekly.level, false, weekly);
        __weeklyFinish({ won: true, score: 9999, seconds: 60, levelIndex: weekly.level, flawless: true });
        return { weekly, before };
      });
      await weeklyPage.waitForFunction(id => currentUserData?.adventure?.weeks?.[id], state.weekly.id);
      const after = await weeklyPage.evaluate(game => ({ best: getLocalBestScore(game), progress: localStorage.getItem("crystal-isles-3d-progress-weeklytester") }), state.weekly.game);
      assert.deepEqual(after, state.before);
      assert.equal(qa.get("users/weeklytester/coins"), 20);
      assert.deepEqual(qa.get("users/weeklytester/bestScores"), { dodger: 3, "laser-dodge": 4, "crystal-isles-3d": 5 });
      await weeklyPage.evaluate(() => showMainMenu());
    }
    checks.push("concurrent relic saves and all three weekly modifiers isolated from normal best scores, level progress and coins");
    assert.deepEqual(qa.errors, []); return checks;
  } finally { await qa.dispose(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import("playwright-core"), { mkdir } = await import("node:fs/promises"), { tmpdir } = await import("node:os"), { join } = await import("node:path");
  const directory = join(tmpdir(), "minigameworld-adventures-qa"); await mkdir(directory, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--mute-audio"] });
  try { console.log(await runAdventureQA(browser, process.argv[2], (page, name) => page.screenshot({ path: join(directory, `${name}.png`) }))); console.log(`Screenshots: ${directory}`); }
  finally { await browser.close(); }
}
