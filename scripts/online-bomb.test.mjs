import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import { bombFrame, cameraMovement, smoothPlayer, createBombEvents } from "../src/online-bomb-model.mjs";

const player = (slot, extra = {}) => ({ slot, memberId: slot, username: slot, x: 266, y: 266, size: 28, totalScore: 0, ...extra });
const frame = extra => bombFrame({ players: [player("p1"), player("p2", { x: 400 })], local: "p1", bomb: { holder: "p1", ticks: 300, round: 1 }, ...extra });
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
function load(names, values = {}) {
  const ctx = createContext({ ONLINE_PLAYER_SLOTS: ["p1", "p2", "p3", "p4", "p5"], ONLINE_MAX_PLAYERS: 5, ...values });
  for (const name of names) new Script(html.match(new RegExp(`(?:async )?function ${name}\\([^]*?^      }`, "m"))[0]).runInContext(ctx);
  return ctx;
}

test("network pixels map to the 3D floor without changing the input", () => {
  const input = { players: [player("p1"), player("p2", { x: 8, y: 524 })] }, before = structuredClone(input);
  const view = bombFrame(input);
  assert.equal(view.width, 28); assert.equal(view.depth, 28);
  assert.equal(view.players[0].x, 0); assert.equal(view.players[0].z, 0);
  assert.equal(view.players[1].x, -12.9); assert.equal(view.players[1].z, 12.9);
  assert.deepEqual(input, before);
});

test("only five valid slots are rendered and malformed data is bounded", () => {
  const result = frame({ players: [...Array.from({ length: 6 }, (_, i) => player(`p${i + 1}`, { x: Infinity, y: -100, size: 999, totalScore: NaN, headColor: "url(evil)", username: "x".repeat(80) })), null], bomb: { ticks: Infinity }, chat: [null, { text: "y".repeat(100) }] });
  assert.equal(result.players.length, 5);
  result.players.forEach(p => { assert.ok(Number.isFinite(p.x)); assert.equal(p.size, 4); assert.equal(p.score, 0); assert.equal(p.name.length, 24); assert.match(p.color, /^#[a-f0-9]{6}$/i); });
  assert.equal(result.ticks, 0); assert.equal(result.chat[1].text.length, 80);
  assert.equal(bombFrame({ players: {} }).players.length, 0);
});

test("valid custom skins, palettes and flat accessories are retained", () => {
  const result = frame({ players: [player("p1", { skin: "custom64", pixelSkin64: "2".repeat(4096), customPalette: ["#abcdef"], accessory: "custom", customAccessory16: "3".repeat(256) })] });
  assert.equal(result.players[0].skin.length, 4096); assert.equal(result.players[0].palette[0], "#abcdef"); assert.equal(result.players[0].palette.length, 8); assert.equal(result.players[0].accessory.length, 256);
  const bad = frame({ players: [player("p1", { skin: "custom64", pixelSkin64: "x", accessory: "custom", customAccessory16: "x" })] }).players[0];
  assert.equal(bad.skin, ""); assert.equal(bad.accessory, "");
});

test("camera-relative movement preserves speed at every angle", () => {
  for (const yaw of [0, Math.PI / 2, Math.PI, -1.23]) for (const [x, y] of [[1, 0], [0, -1], [1, 1]]) {
    const move = cameraMovement(x, y, yaw); assert.ok(Math.abs(Math.hypot(move.x, move.y) - 1) < 1e-10);
  }
  const move = cameraMovement(0, -1, Math.PI / 2); assert.ok(Math.abs(move.x + 1) < 1e-10); assert.ok(Math.abs(move.y) < 1e-10);
  assert.deepEqual(cameraMovement(0, 0, 1), { x: 0, y: 0 });
});

test("remote interpolation is frame-rate independent and snaps on respawn or slot reuse", () => {
  const start = frame().players[0], target = { ...start, x: 2 };
  const one = smoothPlayer(start, target, 0.1); let many = start;
  for (let i = 0; i < 10; i++) many = smoothPlayer(many, target, 0.01);
  assert.ok(Math.abs(one.x - many.x) < 1e-10);
  for (const p of [{ ...target, respawn: "new" }, { ...target, id: "new-member" }, { ...target, x: 9 }]) assert.equal(smoothPlayer(start, p, 0.01).x, p.x);
});

test("bomb effects ignore initial join, waiting and duplicate snapshots", () => {
  const observe = createBombEvents(), initial = frame();
  assert.deepEqual(observe(initial), []); assert.deepEqual(observe(initial), []);
  assert.deepEqual(observe(frame({ players: [player("p1")] })), []);
  assert.deepEqual(observe(frame({ bomb: { holder: "p2", ticks: 10, round: 2 } })), []);
});

test("passes, countdown and scored explosions emit once", () => {
  const observe = createBombEvents(); observe(frame());
  const pass = frame({ bomb: { holder: "p2", ticks: 290, round: 1 } });
  assert.equal(observe(pass)[0].type, "pass"); assert.deepEqual(observe(pass), []);
  const tick = frame({ bomb: { holder: "p2", ticks: 100, round: 1 } });
  assert.equal(observe(tick)[0].type, "tick"); assert.deepEqual(observe(tick), []);
  const end = frame({ players: [player("p1", { totalScore: 1 }), player("p2")], bomb: { holder: "p1", ticks: 360, round: 2 } });
  const event = observe(end)[0]; assert.equal(event.type, "burst"); assert.equal(event.player.slot, "p2"); assert.equal(event.won, true);
  assert.deepEqual(observe(end), []);
});

test("restarts and a new occupant's score never produce a false explosion", () => {
  const observe = createBombEvents(); observe(frame());
  assert.deepEqual(observe(frame({ bomb: { holder: "p2", ticks: 360, round: 2 } })), []);
  assert.deepEqual(observe(frame({ players: [player("p1", { memberId: "replacement", totalScore: 15 }), player("p2")], bomb: { holder: "p1", ticks: 360, round: 3 } })), []);
});

test("only Bomb Tag joins the existing 3D games; all other online games remain 2D", () => {
  const ctx = load(["isThreeGame"]);
  for (const game of ["online-bomb-tag", "catcher", "coin-rush", "dodger", "laser-dodge", "crystal-isles-3d", "dead-route-3d"]) assert.equal(ctx.isThreeGame(game), true);
  for (const game of ["online-snake", "online-catcher", "online-tanks", "online-pong", "online-tag", "online-soccer", "online-maze", "online-battle"]) assert.equal(ctx.isThreeGame(game), false);
});

test("2-5 player rooms preserve host bomb passing and survivor scoring", () => {
  for (let count = 2; count <= 5; count++) {
    const playersState = Object.fromEntries(Array.from({ length: count }, (_, i) => [`p${i + 1}`, { ...player(`p${i + 1}`, { x: i * 80 }), score: 0 }]));
    const ctx = load(["getOnlinePlayerEntries", "updateOnlineBombTagGame", "makeOnlineBombState", "playersTouch", "rectsTouch"], {
      currentGame: "online-bomb-tag", onlineState: { playersState, bomb: { holder: "p1", ticks: 40, cooldown: 0, round: 1 } }, resetOnlinePosition() {}, onlineSharedDirty: false
    });
    playersState.p2.x = 0; ctx.updateOnlineBombTagGame(); assert.equal(ctx.onlineState.bomb.holder, "p2");
    ctx.onlineState.bomb.ticks = 1; ctx.updateOnlineBombTagGame();
    for (const [slot, p] of Object.entries(playersState)) assert.equal(p.score, slot === "p2" ? 0 : 1);
    assert.equal(ctx.onlineState.bomb.ticks, 360);
  }
});

test("waiting rooms cannot advance bomb rounds", () => {
  const ctx = load(["getOnlinePlayerEntries", "updateOnlineBombTagGame"], { currentGame: "online-bomb-tag", onlineState: { playersState: { p1: player("p1") }, bomb: { ticks: 10 } } });
  ctx.updateOnlineBombTagGame(); assert.equal(ctx.onlineState.bomb.ticks, 10);
});

test("the async view checks room ownership, cancels loading and exits through room cleanup", () => {
  const source = html.match(/async function startOnlineBomb3D\([^]*?^      }/m)[0];
  assert.match(source, /onlineRoomCode === code/); assert.match(source, /controller.signal.throwIfAborted/);
  assert.match(source, /Promise.race/); assert.match(source, /await returnToMainMenu\(\)/);
  assert.match(source, /getOnlinePlayerEntries\(\).map/); assert.doesNotMatch(source, /firebaseDb|setInterval|makeOnlineBombState/);
  const renderer = readFileSync(new URL("../src/online-bomb.mjs", import.meta.url), "utf8");
  assert.match(renderer, /audio.dispose\(\)/); assert.match(renderer, /observer.disconnect\(\)/); assert.match(renderer, /abort.abort\(\)/);
});

test("web and desktop build paths include the same lazy online assets", () => {
  for (const file of ["prepare-vercel.mjs", "prepare-tauri.mjs", "serve.mjs"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const asset of ["online-bomb.js", "online-bomb.css", "online-bomb.js.LEGAL.txt", "online-bomb-3d.png"]) assert.ok(source.includes(asset), `${file}: ${asset}`);
  }
  const worker = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");
  assert.match(worker, /const LAZY_ASSETS = .*online-bomb.js/);
});
