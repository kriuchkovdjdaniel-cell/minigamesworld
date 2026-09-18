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
function effectsContext(extra = {}) {
  const context = load([
    "isValidEffectOrigin", "spawnScoreBurst", "spawnCoinFlame", "spawnImpactEffect",
    "trimGameEffects", "advanceGameEffects", "resetGameEffects",
    "drawScoreBursts", "drawCoinFlames", "drawImpactEffects", "draw", "renderGameFrame"
  ], {
    scoreBursts: [], coinFlames: [], impactEffects: [], effectTime: 0,
    lastShieldEffectTime: -Infinity, gameFrameRequest: null, lastGameFrameTime: null,
    effectSceneKey: "snake::560:560", currentGame: "snake", onlineRoomCode: "",
    onlineEffectSnapshot: new Map(), paused: false, waitingToPlay: false, gameOver: false,
    reducedGameMotion: { matches: false }, getGraphicsEffectCount: (low, normal) => normal,
    getGraphicsQualityRank: () => 1, getGraphicsShadowBlur: () => 0,
    hasCoinFlamesEquipped: () => true, hasStartShield: () => false,
    getPointEffectPosition: () => ({ x: 200, y: 200 }),
    document: { hidden: false }, startScreen: { classList: { contains: () => true } },
    ctx: new Proxy({}, { get: (target, key) => key === "measureText" ? () => ({ width: 20 }) : target[key] ?? (() => {}) }),
    paintGame() {},
    ...extra
  });
  const frames = new Map();
  let frameId = 0;
  context.requestAnimationFrame = (callback) => { frames.set(++frameId, callback); return frameId; };
  context.cancelAnimationFrame = (id) => frames.delete(id);
  context.flushFrame = (time) => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((fn) => fn(time));
  };
  context.pendingFrames = () => frames.size;
  return context;
}
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

test("removed directional pad has no dangling translation or event bindings", () => {
  assert.doesNotMatch(html, /data-direction|aria-label="Touch controls"|"board pad"/);
});

test("particle motion and lifetime are consistent at 30 and 60 FPS", () => {
  const simulate = (steps) => {
    const ctx = effectsContext();
    const particle = { x: 200, y: 200, dx: 80, dy: -100, life: 1000, maxLife: 1000, size: 4 };
    ctx.scoreBursts.push({ ...particle });
    ctx.coinFlames.push({ ...particle });
    for (let i = 0; i < steps; i++) ctx.advanceGameEffects(400 / steps);
    return ctx;
  };
  const slow = simulate(12);
  const fast = simulate(24);
  for (const collection of ["scoreBursts", "coinFlames"]) {
    for (const key of ["x", "y", "dx", "dy", "life"]) {
      assert.ok(Math.abs(slow[collection][0][key] - fast[collection][0][key]) < 1e-8, `${collection}.${key}`);
    }
  }
  assert.ok(Math.abs(slow.effectTime - 400) < 1e-8);
});

test("effect queues stay bounded and adapt immediately to reduced motion", () => {
  const ctx = effectsContext();
  for (let i = 0; i < 100; i++) {
    ctx.spawnScoreBurst();
    ctx.spawnCoinFlame();
    ctx.spawnImpactEffect({ x: i * 20, y: 10 });
  }
  assert.equal(ctx.scoreBursts.length, 128);
  assert.equal(ctx.coinFlames.length, 80);
  assert.equal(ctx.impactEffects.length, 20);
  ctx.reducedGameMotion.matches = true;
  ctx.advanceGameEffects(0);
  ctx.spawnScoreBurst();
  ctx.spawnCoinFlame();
  assert.equal(ctx.scoreBursts.length + ctx.coinFlames.length, 0);
  ctx.spawnImpactEffect({ x: 20, y: 20 });
  assert.equal(ctx.impactEffects.at(-1).life, 240);
  for (let i = 0; i < 8; i++) ctx.advanceGameEffects(100);
  assert.equal(ctx.impactEffects.length, 0);
});

test("simultaneous score text merges and malformed positions cannot create effects", () => {
  const ctx = effectsContext();
  for (const text of ["+1", "+1", "x3"]) ctx.spawnImpactEffect({ x: 200, y: 200 }, "#fff", text);
  assert.equal(ctx.impactEffects.length, 1);
  assert.equal(ctx.impactEffects[0].text, "x3");
  for (const point of [null, { x: NaN, y: 4 }, { x: 0, y: Infinity }]) {
    ctx.spawnScoreBurst(point);
    ctx.spawnCoinFlame(point);
    ctx.spawnImpactEffect(point);
  }
  assert.equal(ctx.scoreBursts.length + ctx.coinFlames.length, 0);
  assert.equal(ctx.impactEffects.length, 1);
});

test("drawing particles never advances them or leaks saved canvas state", () => {
  let depth = 0;
  const ctx = effectsContext();
  ctx.ctx.save = () => { depth++; };
  ctx.ctx.restore = () => { depth--; assert.ok(depth >= 0); };
  ctx.spawnScoreBurst();
  ctx.spawnCoinFlame();
  ctx.spawnImpactEffect({ x: 200, y: 200 }, "#fff", "+1");
  const before = JSON.stringify([ctx.scoreBursts, ctx.coinFlames, ctx.impactEffects]);
  for (let i = 0; i < 10; i++) {
    ctx.drawScoreBursts(); ctx.drawCoinFlames(); ctx.drawImpactEffects();
  }
  assert.equal(JSON.stringify([ctx.scoreBursts, ctx.coinFlames, ctx.impactEffects]), before);
  assert.equal(depth, 0);
});

test("redraw requests coalesce, effects freeze while paused and finish after game over", () => {
  let paints = 0;
  const ctx = effectsContext({ paintGame: () => { paints++; } });
  ctx.spawnImpactEffect({ x: 10, y: 20 });
  for (let i = 0; i < 100; i++) ctx.draw();
  assert.equal(ctx.pendingFrames(), 1);
  ctx.flushFrame(0);
  assert.equal(paints, 1);
  assert.equal(ctx.pendingFrames(), 1);
  ctx.paused = true;
  ctx.flushFrame(100);
  assert.equal(ctx.impactEffects[0].life, 620);
  assert.equal(ctx.pendingFrames(), 0);
  ctx.paused = false;
  ctx.gameOver = true;
  ctx.draw();
  for (let i = 0; i < 10; i++) ctx.flushFrame(200 + i * 100);
  assert.equal(ctx.impactEffects.length, 0);
  assert.equal(ctx.pendingFrames(), 0);
});

test("scene changes clear stale particles, and hidden pages do not keep rendering", () => {
  const ctx = effectsContext();
  ctx.spawnScoreBurst();
  ctx.spawnCoinFlame();
  ctx.draw();
  ctx.currentGame = "coin-rush";
  ctx.draw();
  assert.equal(ctx.scoreBursts.length + ctx.coinFlames.length, 0);
  assert.equal(ctx.pendingFrames(), 1);
  ctx.document.hidden = true;
  ctx.flushFrame(1000);
  ctx.draw();
  assert.equal(ctx.pendingFrames(), 0);
  ctx.resetGameEffects();
  assert.equal(ctx.lastGameFrameTime, null);
  assert.equal(ctx.effectTime, 0);
});

test("online effects fire once per score or respawn, not per redraw or joining player", () => {
  const impacts = [];
  const room = fullRoom();
  const ctx = load(["observeOnlineEffects", "getOnlineEffectOrigin", "getOnlinePlayerEntries"], {
    currentGame: "online-bomb-tag", onlineState: room, onlinePlayerSlot: "p3",
    onlineEffectSnapshot: new Map(), paused: false, waitingToPlay: false,
    spawnScoreBurst() {}, spawnCoinFlame() {},
    spawnImpactEffect: (...args) => impacts.push(args)
  });
  ctx.observeOnlineEffects();
  assert.equal(impacts.length, 0);
  room.playersState.p3.score++;
  ctx.observeOnlineEffects();
  ctx.observeOnlineEffects();
  assert.equal(impacts.length, 1);
  room.playersState.p4.respawn = { id: 1 };
  ctx.observeOnlineEffects();
  ctx.observeOnlineEffects();
  assert.equal(impacts.length, 3);
  room.playersState.p3 = { ...makePlayer("new-member"), memberId: "new-member", score: 99 };
  room.members.p3 = "new-member";
  ctx.observeOnlineEffects();
  assert.equal(impacts.length, 3);
  delete room.members.p5;
  ctx.observeOnlineEffects();
  assert.equal(ctx.onlineEffectSnapshot.has("p5"), false);
  room.playersState.p2.alive = false;
  ctx.observeOnlineEffects();
  ctx.observeOnlineEffects();
  assert.equal(impacts.length, 4);
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
