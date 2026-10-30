import test from "node:test";
import assert from "node:assert/strict";
import { createRecorder, normalizeReplay, replayPose } from "../src/ghost-replay.mjs";
import { emotePose, validEmote } from "../src/avatar-emotes.mjs";
import { BOMB_MAPS, bombMapObstacles, chooseBombMap } from "../src/bomb-maps.mjs";
import { createKartWorld, kartAI, TRACKS, trackPoint } from "../src/kart-world.mjs";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";

test("ghost recording validates timing, interpolates and stays bounded", () => {
  const recorder = createRecorder(0, { x: 0, y: 1, z: 0 });
  for (let t = 0.1; t <= 2.01; t += 0.1) recorder.sample(t, { x: t, y: 1, z: 0 }, 0);
  const replay = recorder.finish(2, true); assert.ok(replay); assert.ok(replay.frames.length <= 21);
  assert.equal(replayPose(replay, 1.05).x, 1.05); assert.equal(replayPose(replay, 3), null);
  assert.equal(normalizeReplay(replay, 1), null);
  assert.equal(normalizeReplay({ ...replay, frames: [[0, 0, NaN, 0, 0], [2, 2, 1, 0, 0]] }, 0), null);
  assert.equal(normalizeReplay({ ...replay, frames: [[0, 0, 1, 0, 0], [0, 2, 1, 0, 0]] }, 0), null);
});
test("failed, paused and overlong trials never replace a replay", () => {
  const recorder = createRecorder(1, { x: 0, y: 1, z: 0 }); recorder.sample(1, { x: 1, y: 1, z: 0 }, 0);
  assert.equal(recorder.finish(1, false), null); recorder.invalidate(); assert.equal(recorder.finish(1, true), null);
  const long = createRecorder(1, { x: 0, y: 1, z: 0 }); long.sample(601, { x: 1, y: 1, z: 0 }, 0); assert.equal(long.valid, false);
});
test("ghost respawns snap and rotation interpolates over the short arc", () => {
  const replay = { seconds: 1, frames: [[0, 0, 1, 0, 3.1], [1, 1, 1, 0, -3.1]] };
  assert.ok(Math.abs(replayPose(replay, 0.5).yaw - Math.PI) < 0.01);
  replay.frames[1][1] = 20; assert.equal(replayPose(replay, 0.5).x, 0);
});
test("emotes are bounded visual offsets and unknown choices are inert", () => {
  for (const id of ["bounce", "spin", "bow"]) { assert.equal(validEmote(id), true); for (let t = 0; t < 3; t += 0.1) { const p = emotePose(id, t); assert.ok(Math.abs(p.y) <= 0.5); assert.ok(p.squash > 0.8 && p.squash < 1.2); } }
  assert.deepEqual(emotePose("invalid", 1), { y: 0, yaw: 0, tilt: 0, squash: 1 });
});
test("map voting ignores stale/invalid ballots, resolves ties by rotation and changes layouts", () => {
  assert.equal(chooseBombMap([], 2, "park"), "rooftops");
  assert.equal(chooseBombMap([{ mapVote: { round: 1, map: "park" } }, { mapVote: { round: 2, map: "factory" } }, { mapVote: { round: 2, map: "unknown" } }], 2, "park"), "factory");
  assert.equal(new Set(BOMB_MAPS.map(map => JSON.stringify(bombMapObstacles(map.id)))).size, 3);
  for (const map of BOMB_MAPS) for (const box of bombMapObstacles(map.id)) { assert.ok(box.x > 0 && box.y > 0); assert.ok(box.x + box.w < 560 && box.y + box.h < 560); }
});
test("every map leaves all five player spawns outside solid obstacles", () => {
  for (const map of BOMB_MAPS) for (let slot = 0; slot < 5; slot++) {
    const angle = Math.PI + slot * Math.PI * 2 / 5, x = 266 + Math.cos(angle) * 560 * 0.32, y = 266 + Math.sin(angle) * 560 * 0.32;
    assert.ok(!bombMapObstacles(map.id).some(b => x < b.x + b.w && x + 28 > b.x && y < b.y + b.h && y + 28 > b.y), `${map.id} slot ${slot}`);
  }
});
test("Bomb Tag voting freezes the fuse and broadcasts the winning map", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const players = { p1: { mapVote: { round: 2, map: "factory" } }, p2: { mapVote: { round: 2, map: "factory" } } };
  let resets = 0;
  const ctx = createContext({ currentGame: "online-bomb-tag", onlineState: { playersState: players, bomb: { phase: "voting", voteTicks: 2, round: 2, map: "park", ticks: 360 } }, onlineSharedDirty: false, onlineBombModule: { chooseBombMap }, getOnlinePlayerEntries: () => Object.entries(players), resetOnlinePosition: () => resets++ });
  new Script(html.match(/function updateOnlineBombTagGame\([^]*?^      }/m)[0]).runInContext(ctx);
  ctx.updateOnlineBombTagGame(); assert.equal(ctx.onlineState.bomb.ticks, 360); assert.equal(ctx.onlineState.bomb.phase, "voting");
  ctx.updateOnlineBombTagGame(); assert.equal(ctx.onlineState.bomb.map, "factory"); assert.equal(ctx.onlineState.bomb.phase, "playing"); assert.equal(resets, 2); assert.equal(ctx.onlineSharedDirty, true);
});
test("kart physics clamps acceleration, collisions and drift boost", async () => {
  const sim = await createKartWorld();
  try {
    assert.equal(sim.karts.length, 4); for (let i = 0; i < 181; i++) sim.step();
    for (let i = 0; i < 40; i++) sim.step({ throttle: 1 });
    const kart = sim.karts[0]; kart.body.setLinvel({ x: 0, y: 0, z: 12 }, true);
    for (let i = 0; i < 45; i++) sim.step({ throttle: 1, steer: 0.5, drift: true });
    assert.ok(kart.drift > 0.35); sim.step({ throttle: 1 }); assert.ok(kart.boosting > 0);
    for (let i = 0; i < 300; i++) sim.step({ throttle: 999, steer: NaN });
    assert.ok(Math.abs(kart.speed) <= 28); const p = kart.body.translation(); assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
    assert.ok(Math.abs(p.x) < sim.track.rx + 6 && Math.abs(p.z) < sim.track.rz + 6);
  } finally { sim.dispose(); sim.dispose(); }
});
test("all three kart circuits support a complete three-lap race with real AI", async () => {
  for (let track = 0; track < TRACKS.length; track++) {
    const sim = await createKartWorld(track);
    try {
      for (let step = 0; step < 60 * 200 && sim.state.status !== "finished"; step++) sim.step(kartAI(sim.karts[0], sim.track));
      assert.equal(sim.state.status, "finished", `${sim.track.name}: lap ${sim.karts[0].lap}, gate ${sim.karts[0].nextGate}`);
      assert.equal(sim.karts[0].lap, 3); assert.ok(sim.state.place >= 1 && sim.state.place <= 4);
    } finally { sim.dispose(); }
  }
});
test("crossing the finish repeatedly cannot skip kart checkpoints", async () => {
  const sim = await createKartWorld();
  try {
    for (let i = 0; i < 181; i++) sim.step(); const kart = sim.karts[0];
    for (let i = 0; i < 10; i++) { const p = trackPoint(sim.track, 0); kart.body.setTranslation({ ...p, y: 0.65 }, true); kart.body.setLinvel({ x: 0, y: 0, z: 5 }, true); sim.step({ throttle: 1 }); }
    assert.equal(kart.lap, 0); assert.equal(kart.passed, 1);
  } finally { sim.dispose(); }
});

test("web, desktop and offline builds include both new engines, styles and the racing thumbnail", () => {
  for (const path of ["scripts/prepare-tauri.mjs", "scripts/prepare-vercel.mjs", "scripts/serve.mjs", "service-worker.js"]) {
    const text = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    for (const asset of ["kart-game.js", "kart-game.css", "coop-route.js", "coop-route.css", "coastline-karts-3d.png"]) assert.ok(text.includes(asset), `${path}: missing ${asset}`);
  }
  const image = readFileSync(new URL("../assets/coastline-karts-3d.png", import.meta.url));
  assert.equal(image.toString("hex", 0, 8), "89504e470d0a1a0a");
  const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  assert.equal(JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")).version, version);
  assert.ok(readFileSync(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8").includes(`version = "${version}"`));
});
