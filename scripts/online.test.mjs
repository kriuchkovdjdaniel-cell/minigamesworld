import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import assert from "node:assert/strict";
import test from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
const source = scripts.join("\n");
function load(names, values = {}) {
  const context = createContext({
    ONLINE_MAX_PLAYERS: 5,
    ONLINE_PLAYER_SLOTS: ["p1", "p2", "p3", "p4", "p5"],
    canvas: { width: 560, height: 560 },
    onlineSharedDirty: false,
    ...values
  });
  for (const name of names) {
    const fn = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?^      }`, "m"));
    assert.ok(fn, `Function ${name} exists`);
    new Script(fn[0]).runInContext(context);
  }
  return context;
}
const makePlayer = (slot) => ({ username: slot, score: 0, x: 30, y: 30, size: 28 });
function fullRoom() {
  let room = { createdBy: "host", game: "online-bomb-tag", members: { p1: "host" }, playersState: { p1: { ...makePlayer("p1"), memberId: "host" } } };
  const ctx = load(["getOnlinePlayerEntries", "addPlayerToRoom"]);
  for (let i = 2; i <= 5; i++) room = ctx.addPlayerToRoom(room, `member${i}`, makePlayer);
  return room;
}

test("all inline scripts parse", () => {
  scripts.forEach((script) => new Script(script));
  new Script(readFileSync(new URL("../service-worker.js", import.meta.url), "utf8"));
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.protocol_handlers[0].protocol, "web+minigameworld");
});
test("room admits five distinct players and rejects sixth, including transaction retries", () => {
  const ctx = load(["getOnlinePlayerEntries", "addPlayerToRoom"]);
  const room = fullRoom();
  assert.equal(ctx.getOnlinePlayerEntries(room).length, 5);
  assert.equal(ctx.addPlayerToRoom(room, "sixth", makePlayer), undefined);
  assert.equal(ctx.addPlayerToRoom(room, "member4", makePlayer), room);
  assert.equal(ctx.addPlayerToRoom(null, "sixth", makePlayer), null);
  assert.equal(ctx.addPlayerToRoom(room, "host", makePlayer), undefined);
});
test("leaving frees only that slot; late state writes cannot occupy it again", () => {
  const ctx = load(["getOnlinePlayerEntries", "addPlayerToRoom"]);
  const room = fullRoom();
  delete room.members.p3;
  assert.equal(ctx.getOnlinePlayerEntries(room).length, 4);
  const joined = ctx.addPlayerToRoom(room, "replacement", makePlayer);
  assert.equal(joined.playersState.p3.memberId, "replacement");
  assert.equal(joined.playersState.p4.memberId, "member4");
  assert.equal(joined.players, 5);
});
test("snake food avoids all five bodies and spawn positions are distinct", () => {
  const room = fullRoom();
  Object.values(room.playersState).forEach((player, i) => { player.snake = [{ x: i, y: i }]; });
  const ctx = load(["getOnlinePlayerEntries", "getOnlineSnakeBlockedCells", "getOnlineSpawn", "getOnlineTeam"], { onlineState: room });
  assert.equal(ctx.getOnlineSnakeBlockedCells().length, 5);
  for (const game of ["online-tanks", "online-tag", "online-maze", "online-soccer", "online-bomb-tag"]) {
    const positions = ctx.ONLINE_PLAYER_SLOTS.map((slot) => ctx.getOnlineSpawn(slot, game));
    assert.equal(new Set(positions.map((p) => `${p.x},${p.y}`)).size, 5);
    assert.ok(positions.every((p) => p.x >= 0 && p.y >= 0 && p.x + 28 <= 560 && p.y + 28 <= 560));
  }
});
test("bomb passes between p3 and p5; explosion awards every survivor", () => {
  const room = fullRoom();
  Object.values(room.playersState).forEach((p, i) => { p.x = 20 + i * 90; });
  room.playersState.p5.x = room.playersState.p3.x;
  room.bomb = { holder: "p3", ticks: 30, cooldown: 0 };
  const ctx = load(["getOnlinePlayerEntries", "getOnlineTeam", "getOnlineSpawn", "resetOnlinePosition", "playersTouch", "rectsTouch", "makeOnlineBombState", "updateOnlineBombTagGame"], { onlineState: room, onlinePlayerSlot: "p1", currentGame: "online-bomb-tag" });
  ctx.updateOnlineBombTagGame();
  assert.equal(room.bomb.holder, "p5");
  room.bomb.ticks = 1;
  ctx.updateOnlineBombTagGame();
  for (const [slot, player] of Object.entries(room.playersState)) assert.equal(player.score, slot === "p5" ? 0 : 1);
  assert.notEqual(room.bomb.holder, "p5");
});
test("bomb recovers when its holder leaves and does not explode in an empty match", () => {
  const room = fullRoom();
  delete room.playersState.p5;
  delete room.members.p5;
  room.bomb = { holder: "p5", ticks: 1, cooldown: 0 };
  const ctx = load(["getOnlinePlayerEntries", "getOnlineTeam", "getOnlineSpawn", "resetOnlinePosition", "playersTouch", "rectsTouch", "makeOnlineBombState", "updateOnlineBombTagGame"], { onlineState: room, onlinePlayerSlot: "p1", currentGame: "online-bomb-tag" });
  ctx.updateOnlineBombTagGame();
  assert.ok(room.members[room.bomb.holder]);
  room.members = { p1: "host" };
  room.bomb.ticks = 1;
  ctx.updateOnlineBombTagGame();
  assert.equal(room.bomb.ticks, 1);
});
test("phone gameplay blocked while desktop standalone app can play", () => {
  const ctx = load(["isPhoneDevice", "isInstalledWebApp", "isDesktopRuntime", "canPlayGames"], {
    navigator: { userAgent: "Windows Chrome", maxTouchPoints: 0 },
    window: { location: { hostname: "example.com", protocol: "https:" }, matchMedia: () => ({ matches: false }) }
  });
  assert.equal(ctx.canPlayGames(), false);
  ctx.window.matchMedia = () => ({ matches: true });
  assert.equal(ctx.canPlayGames(), true);
  ctx.navigator.userAgent = "Android Mobile";
  assert.equal(ctx.canPlayGames(), false);
  ctx.navigator.userAgent = "Macintosh";
  ctx.navigator.maxTouchPoints = 5;
  assert.equal(ctx.canPlayGames(), false);
  ctx.navigator.userAgent = "Windows";
  ctx.window.matchMedia = () => ({ matches: false });
  ctx.window.__TAURI_INTERNALS__ = {};
  assert.equal(ctx.canPlayGames(), true);
});

test("cold app launch waits for the hub and ignores duplicate startup delivery", () => {
  const launches = [];
  const ctx = load(["handleAppLaunch", "showLoadedStartMenu"], {
    URL, canPlayGames: () => true, onlineRoomCode: "", appUiReady: false,
    pendingAppLaunch: "", lastAppLaunch: { value: "", at: 0 },
    games: { snake: {} }, isSinglePlayerGame: () => true,
    showMainMenu: () => {}, closeStartScreen: () => {},
    startGame: (game) => launches.push(game)
  });
  const launch = "web+minigameworld://play?game=snake";
  ctx.handleAppLaunch(launch);
  assert.equal(launches.length, 0);
  ctx.showLoadedStartMenu();
  assert.deepEqual(launches, ["snake"]);
  ctx.handleAppLaunch(launch);
  ctx.handleAppLaunch("https://example.com/?game=snake");
  assert.equal(launches.length, 1);
});

test("movement patches reuse appearance data and guests cannot overwrite shared scores", () => {
  const room = fullRoom();
  room.playersState.p5.pixelSkin64 = "1".repeat(4096);
  const ctx = load(["getOnlinePlayerEntries", "onlineUsesHostScores", "isOnlineArcadeGame", "buildOnlinePatch"], {
    onlineState: room, currentGame: "online-bomb-tag", onlinePlayerSlot: "p5",
    onlineLocalDirty: true, onlineSharedDirty: false, lastOnlineAppearanceKey: ""
  });
  const first = ctx.buildOnlinePatch();
  room.playersState.p5.x += 10;
  const next = ctx.buildOnlinePatch();
  assert.equal(first["playersState/p5/pixelSkin64"].length, 4096);
  assert.equal(next["playersState/p5/pixelSkin64"], undefined);
  assert.equal(next["playersState/p5/x"], room.playersState.p5.x);
  assert.equal(next["playersState/p5/score"], undefined);
  assert.ok(JSON.stringify(next).length < JSON.stringify(first).length / 4);
});
