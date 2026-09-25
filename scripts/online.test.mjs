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
    "trimGameEffects", "advanceGameEffects", "resetGameEffects", "isThreeGame",
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

test("standalone 3D games do not schedule the legacy 2D renderer", () => {
  for (const game of ["crystal-isles-3d", "dead-route-3d"]) {
    let paints = 0;
    const ctx = effectsContext({ currentGame: game, paintGame: () => { paints++; } });
    ctx.draw(); ctx.renderGameFrame(1000);
    assert.equal(ctx.pendingFrames(), 0);
    assert.equal(paints, 0);
  }
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

function friendRoomContext() {
  return load([
    "getOnlinePlayerEntries", "addPlayerToRoom", "findFriendRoom", "roomRequestRecipientPresent",
    "queueFriendRoomRequest", "resolveFriendRoomRequest", "consumeFriendRoomApproval",
    "areRoomFriends", "releaseFriendRoomMembership"
  ], {
    usernameKey: (name) => name.toLowerCase(),
    onlineGameNames: { "online-bomb-tag": "Online Bomb Tag" }
  });
}

function friendRoom() {
  const room = fullRoom();
  for (const slot of ["p3", "p4", "p5"]) {
    delete room.members[slot];
    delete room.playersState[slot];
  }
  room.players = 2;
  room.createdAt = 100;
  room.isPublic = false;
  room.playersState.p2.username = "Alice";
  return room;
}

function joinRequest(extra = {}) {
  return {
    id: "request-1", requesterId: "bob-device", requesterKey: "bob", requesterName: "Bob",
    recipientId: "member2", recipientKey: "alice", roomCreatedAt: 100,
    status: "pending", createdAt: 200, expiresAt: 2000, ...extra
  };
}

test("friends can find private rooms, but stale player records are not presence", () => {
  const ctx = friendRoomContext();
  const room = friendRoom();
  assert.equal(ctx.findFriendRoom({ PRIVATE: room }, "alice").code, "PRIVATE");
  room.members.p2 = "replacement-device";
  assert.equal(ctx.findFriendRoom({ PRIVATE: room }, "alice"), null);
  assert.equal(ctx.roomRequestRecipientPresent(room, joinRequest()), false);
  delete room.members.p2;
  assert.equal(ctx.findFriendRoom({ PRIVATE: room }, "alice"), null);
  assert.equal(ctx.findFriendRoom({ EMPTY: null, SOLO: { game: "snake" } }, "alice"), null);
  assert.equal(ctx.areRoomFriends({ friends: { alice: true } }, { friends: { bob: true } }, "bob", "alice"), true);
  assert.equal(ctx.areRoomFriends({ friends: { alice: true } }, {}, "bob", "alice"), false);
});

test("requests require the same active recipient and room, with capacity and duplicate checks", () => {
  const ctx = friendRoomContext();
  const room = friendRoom();
  const request = joinRequest();
  const pending = ctx.queueFriendRoomRequest(room, request, 500);
  assert.equal(pending.joinRequests[request.requesterId], request);
  assert.equal(ctx.getOnlinePlayerEntries(pending).length, 2);
  assert.equal(ctx.queueFriendRoomRequest(pending, request, 500), undefined);
  assert.equal(ctx.queueFriendRoomRequest(room, { ...request, recipientId: "other-device" }, 500), undefined);
  assert.equal(ctx.queueFriendRoomRequest(room, { ...request, roomCreatedAt: 99 }, 500), undefined);
  assert.equal(ctx.queueFriendRoomRequest(room, request, 2000), undefined);
  const full = fullRoom();
  full.createdAt = 100;
  full.playersState.p2.username = "Alice";
  assert.equal(ctx.queueFriendRoomRequest(full, request, 500), undefined);
});

test("only the addressed friend can accept or decline a current request", () => {
  const ctx = friendRoomContext();
  const room = ctx.queueFriendRoomRequest(friendRoom(), joinRequest(), 500);
  for (const args of [
    ["wrong", "member2", "alice", "accepted", 500],
    ["request-1", "host", "alice", "accepted", 500],
    ["request-1", "member2", "other", "accepted", 500],
    ["request-1", "member2", "alice", "accepted", 2000],
    ["request-1", "member2", "alice", "invalid", 500]
  ]) assert.equal(ctx.resolveFriendRoomRequest(room, "bob-device", ...args), undefined);
  const declined = ctx.resolveFriendRoomRequest(room, "bob-device", "request-1", "member2", "alice", "declined", 500);
  assert.equal(declined.joinRequests["bob-device"].status, "declined");
  assert.equal(ctx.consumeFriendRoomApproval(declined, "bob-device", "bob", "request-1", makePlayer, 500), undefined);
  assert.equal(ctx.getOnlinePlayerEntries(declined).length, 2);
  assert.ok(ctx.queueFriendRoomRequest(declined, joinRequest({ id: "retry" }), 600));
});

test("approval is consumed once, never before acceptance or after expiry/friend departure", () => {
  const ctx = friendRoomContext();
  const pending = ctx.queueFriendRoomRequest(friendRoom(), joinRequest(), 500);
  assert.equal(ctx.consumeFriendRoomApproval(pending, "bob-device", "bob", "request-1", makePlayer, 500), undefined);
  const approved = ctx.resolveFriendRoomRequest(pending, "bob-device", "request-1", "member2", "alice", "accepted", 500);
  assert.equal(ctx.consumeFriendRoomApproval(approved, "bob-device", "other-account", "request-1", makePlayer, 500), undefined);
  assert.equal(ctx.consumeFriendRoomApproval(approved, "bob-device", "bob", "request-1", makePlayer, 2000), undefined);
  const joined = ctx.consumeFriendRoomApproval(approved, "bob-device", "bob", "request-1", makePlayer, 500);
  assert.equal(ctx.getOnlinePlayerEntries(joined).length, 3);
  assert.equal(joined.joinRequests["bob-device"], undefined);
  assert.equal(ctx.consumeFriendRoomApproval(joined, "bob-device", "bob", "request-1", makePlayer, 500), undefined);
  delete approved.members.p2;
  assert.equal(ctx.consumeFriendRoomApproval(approved, "bob-device", "bob", "request-1", makePlayer, 500), undefined);
});

test("two approvals competing for the last slot cannot add a sixth player", () => {
  const ctx = friendRoomContext();
  let room = friendRoom();
  room = ctx.addPlayerToRoom(room, "third", makePlayer);
  room = ctx.addPlayerToRoom(room, "fourth", makePlayer);
  const first = joinRequest();
  const second = joinRequest({ id: "request-2", requesterId: "eve-device", requesterKey: "eve" });
  for (const request of [first, second]) {
    room = ctx.queueFriendRoomRequest(room, request, 500);
    room = ctx.resolveFriendRoomRequest(room, request.requesterId, request.id, "member2", "alice", "accepted", 500);
  }
  room = ctx.consumeFriendRoomApproval(room, first.requesterId, first.requesterKey, first.id, makePlayer, 500);
  assert.equal(ctx.getOnlinePlayerEntries(room).length, 5);
  assert.equal(ctx.consumeFriendRoomApproval(room, second.requesterId, second.requesterKey, second.id, makePlayer, 500), undefined);
});

test("expired requests are pruned and live request queues remain bounded", () => {
  const ctx = friendRoomContext();
  const room = friendRoom();
  room.joinRequests = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`r${i}`, joinRequest({ expiresAt: 2000 })]));
  assert.equal(ctx.queueFriendRoomRequest(room, joinRequest(), 500), undefined);
  room.joinRequests.r0.expiresAt = 500;
  const queued = ctx.queueFriendRoomRequest(room, joinRequest(), 500);
  assert.equal(Object.keys(queued.joinRequests).length, 20);
  assert.equal(queued.joinRequests.r0, undefined);
});

test("failed joins release only their own membership, not a host or reused room", () => {
  const ctx = friendRoomContext();
  const request = joinRequest();
  const room = ctx.addPlayerToRoom(friendRoom(), "bob-device", () => ({ ...makePlayer("p3"), username: "Bob" }));
  const released = ctx.releaseFriendRoomMembership(room, request);
  assert.equal(ctx.getOnlinePlayerEntries(released).length, 2);
  assert.equal(released.members.p1, "host");
  assert.equal(ctx.getOnlinePlayerEntries(room).length, 3);
  assert.equal(ctx.releaseFriendRoomMembership({ ...room, createdAt: 101 }, request), undefined);
  assert.equal(ctx.releaseFriendRoomMembership(room, { ...request, requesterKey: "other-account" }), undefined);
  assert.equal(ctx.releaseFriendRoomMembership(room, { ...request, requesterId: "host" }), undefined);
});

test("account refresh ignores a reply that arrives after logout", async () => {
  let finishRead;
  const ctx = load(["refreshCurrentUserData"], {
    currentAccount: { username: "Bob" }, currentUserData: null,
    getUserKeyFromAccount: () => ctx.currentAccount?.username.toLowerCase() || "",
    getUser: () => new Promise((resolve) => { finishRead = resolve; })
  });
  const refreshing = ctx.refreshCurrentUserData();
  ctx.currentAccount = null;
  finishRead({ username: "Bob", friends: { alice: true } });
  assert.equal(await refreshing, null);
  assert.equal(ctx.currentUserData, null);
});

test("profile pictures accept bounded raster data, never remote URLs, SVG or markup", () => {
  const ctx = load(["normalizeProfilePicture", "profileInitials", "profileAvatarMarkup"], {
    PROFILE_PICTURE_MAX_LENGTH: 65536,
    escapeHtml: (value) => String(value).replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  });
  for (const type of ["jpeg", "png", "webp"]) {
    const value = `data:image/${type};base64,AAAA`;
    assert.equal(ctx.normalizeProfilePicture(value), value);
  }
  for (const value of [null, {}, "https://example.com/photo.png", "data:image/svg+xml;base64,AAAA", 'data:image/png;base64,AAAA" onerror="alert(1)', "data:image/jpeg;base64," + "A".repeat(65536)]) {
    assert.equal(ctx.normalizeProfilePicture(value), "");
  }
  assert.equal(ctx.profileInitials("Long_Player_Name"), "LN");
  assert.equal(ctx.profileInitials("Alice"), "AL");
  assert.equal(ctx.profileInitials("---"), "?");
  assert.equal(ctx.profileAvatarMarkup({ picture: "javascript:alert(1)" }, "Bob"), "BO");
  assert.doesNotMatch(ctx.profileAvatarMarkup({}, "<script>"), /<script/);
});

test("avatar processing rejects invalid uploads before decoding and crops to a small square", async () => {
  let decoded = 0;
  let closed = 0;
  let drawArgs;
  const bitmap = { width: 400, height: 200, close: () => { closed++; } };
  const ctx = load(["normalizeProfilePicture", "prepareProfilePicture"], {
    PROFILE_PICTURE_MAX_LENGTH: 65536,
    createImageBitmap: async () => { decoded++; return bitmap; },
    document: { createElement: () => ({
      getContext: () => ({ fillRect() {}, drawImage: (...args) => { drawArgs = args; } }),
      toDataURL: (type) => `data:${type};base64,AAAA`
    }) }
  });
  await assert.rejects(ctx.prepareProfilePicture({ type: "image/svg+xml", size: 500 }), /PNG, JPG, or WebP/);
  await assert.rejects(ctx.prepareProfilePicture({ type: "image/png", size: 6 * 1024 * 1024 }), /5 MB/);
  assert.equal(decoded, 0);
  assert.equal(await ctx.prepareProfilePicture({ type: "image/png", size: 500 }), "data:image/jpeg;base64,AAAA");
  assert.deepEqual(drawArgs.slice(1), [100, 0, 200, 200, 0, 0, 192, 192]);
  assert.equal(closed, 1);
  bitmap.width = bitmap.height = 10000;
  await assert.rejects(ctx.prepareProfilePicture({ type: "image/png", size: 500 }), /25 megapixels/);
  assert.equal(closed, 2);
});

test("friend status uses live heartbeats, prefers room sessions and expires stale activity", () => {
  const ctx = load(["getFriendActivity"], {
    PROFILE_PRESENCE_TTL: 120000,
    onlineGameNames: { "online-bomb-tag": "Online Bomb Tag" },
    games: { snake: { title: "Neon Snake" } }
  });
  const now = 200000;
  const sessions = { hub: { updatedAt: now, game: "" }, app: { updatedAt: now - 1000, game: "online-bomb-tag", roomCode: "CODE1234" } };
  assert.equal(ctx.getFriendActivity({ sessions }, now).label, "Online Bomb Tag");
  assert.equal(ctx.getFriendActivity({ sessions }, now).roomCode, "CODE1234");
  delete sessions.app;
  assert.equal(ctx.getFriendActivity({ sessions }, now).label, "Online");
  sessions.hub.game = "snake";
  assert.equal(ctx.getFriendActivity({ sessions }, now).label, "Neon Snake");
  assert.equal(ctx.getFriendActivity({ sessions }, now + 120001).online, false);
  for (const updatedAt of [NaN, Infinity, "200000", now + 60000]) {
    assert.equal(ctx.getFriendActivity({ sessions: { bad: { updatedAt } } }, now).online, false);
  }
  assert.equal(ctx.getFriendActivity({ sessions: { invalid: { updatedAt: now, game: "__proto__", roomCode: "CODE1234" } } }, now).roomCode, "");
  assert.equal(ctx.getFriendActivity({ unavailable: true }, now).label, "Status unavailable");
});

test("switching accounts cannot reuse another account's cached profile picture", () => {
  const ctx = load(["ownPublicProfile"], {
    usernameKey: (value) => value.toLowerCase(), getUserKeyFromAccount: () => "bob",
    currentUserData: { username: "Alice", publicProfile: { picture: "private-draft" } }
  });
  assert.equal(ctx.ownPublicProfile().picture, undefined);
  ctx.currentUserData.username = "Bob";
  assert.equal(ctx.ownPublicProfile().picture, "private-draft");
});

test("failed picture saves retain the draft, and retry updates only the public profile", async () => {
  let fail = true;
  const writes = [];
  const ctx = load(["saveProfilePicture", "normalizeProfilePicture"], {
    PROFILE_PICTURE_MAX_LENGTH: 65536,
    profilePictureDraft: { key: "bob", picture: "data:image/jpeg;base64,AAAA" },
    profilePictureBusy: false, profilePictureEditVersion: 0,
    currentAccount: { username: "Bob" }, currentUserData: { publicProfile: { sessions: { test: { updatedAt: 123 } } } },
    profilePictureStatus: { textContent: "" }, getUserKeyFromAccount: () => "bob", renderOwnProfilePicture() {},
    patchUser: async (...args) => { if (fail) throw Error("Denied"); writes.push(args); }
  });
  await ctx.saveProfilePicture();
  assert.ok(ctx.profilePictureDraft);
  assert.equal(ctx.profilePictureBusy, false);
  assert.match(ctx.profilePictureStatus.textContent, /Could not save/);
  fail = false;
  await ctx.saveProfilePicture();
  assert.equal(ctx.profilePictureDraft, null);
  assert.equal(ctx.currentUserData.publicProfile.picture, "data:image/jpeg;base64,AAAA");
  assert.equal(ctx.currentUserData.publicProfile.sessions.test.updatedAt, 123);
  assert.deepEqual(Object.keys(writes[0][1]), ["publicProfile/username", "publicProfile/picture"]);
});

test("a late picture-save result cannot update a newly logged-in account", async () => {
  let finish;
  let key = "bob";
  const ctx = load(["saveProfilePicture", "normalizeProfilePicture"], {
    PROFILE_PICTURE_MAX_LENGTH: 65536,
    profilePictureDraft: { key: "bob", picture: "data:image/jpeg;base64,AAAA" },
    profilePictureBusy: false, profilePictureEditVersion: 0,
    currentAccount: { username: "Bob" }, currentUserData: { publicProfile: {} },
    profilePictureStatus: { textContent: "" }, getUserKeyFromAccount: () => key, renderOwnProfilePicture() {},
    patchUser: () => new Promise((resolve) => { finish = resolve; })
  });
  const saving = ctx.saveProfilePicture();
  key = "alice";
  ctx.currentAccount = { username: "Alice" };
  ctx.currentUserData = { publicProfile: { picture: "alice-picture" } };
  ctx.profilePictureDraft = null;
  ctx.profilePictureBusy = false;
  ctx.profilePictureEditVersion++;
  ctx.profilePictureStatus.textContent = "";
  finish();
  await saving;
  assert.equal(ctx.currentUserData.publicProfile.picture, "alice-picture");
  assert.equal(ctx.profilePictureStatus.textContent, "");
});
