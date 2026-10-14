import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import { createArcadeSimulation, makeArcadeLevel, beamAt, ARCADE_LEVELS } from "../src/arcade-world.mjs";

const tick = (sim, count, input = {}) => { for (let i = 0; i < count; i++) sim.step(input); };
const place = (sim, point) => { sim.body.setTranslation(point, true); sim.body.setNextKinematicTranslation(point); sim.state.velocityY = 0; tick(sim, 2); };
async function withSim(mode, index, run) { const sim = await createArcadeSimulation(mode, index); try { await run(sim); } finally { sim.dispose(); } }

test("only two existing 2D games are remade, with three stages each", () => {
  assert.deepEqual(Object.keys(ARCADE_LEVELS), ["dodger", "laser-dodge"]);
  for (const mode of Object.keys(ARCADE_LEVELS)) for (let i = 0; i < 3; i++) assert.equal(makeArcadeLevel(mode, i).index, i);
  for (const mode of ["crystal-isles-3d", "dead-route-3d", "snake"]) assert.throws(() => makeArcadeLevel(mode), /Unknown/);
  for (const i of [-1, 3, NaN, "1", 0.5]) assert.throws(() => makeArcadeLevel("dodger", i), /Unknown/);
});

test("Rapier ground and perimeter constrain movement without sinking or escaping", () => withSim("laser-dodge", 0, sim => {
  tick(sim, 60); assert.ok(sim.state.grounded); assert.ok(sim.body.translation().y > 0.44 && sim.body.translation().y < 0.51);
  tick(sim, 180, { x: 1 }); const x = sim.body.translation().x;
  assert.ok(x > 11 && x < 11.5);
  tick(sim, 30, { x: 1, jump: true }); assert.ok(sim.body.translation().x < 11.5);
}));

test("movement is normalized and ignores non-finite input", async () => {
  const distances = [];
  for (const input of [{ x: 1 }, { x: 1, z: -1 }, { x: 999, z: -999 }]) await withSim("laser-dodge", 0, sim => {
    // Test input normalization in the air, independently of ground contact correction.
    place(sim, { x: 0, y: 5, z: 0 }); const start = sim.body.translation(); tick(sim, 30, input); const p = sim.body.translation();
    const distance = Math.hypot(p.x - start.x, p.z - start.z); distances.push(distance);
    assert.ok(Math.abs(distance - 3) < 0.02, JSON.stringify({ input, start, p }));
  });
  assert.ok(distances[1] <= distances[0] + 0.1); assert.ok(Math.abs(distances[2] - distances[1]) < 0.01);
  await withSim("laser-dodge", 0, sim => { tick(sim, 30, { x: NaN, z: Infinity }); assert.ok(Math.abs(sim.body.translation().x) < 0.01); });
});

test("jump lifts above floor lasers and holding jump never repeats in midair", () => withSim("laser-dodge", 0, sim => {
  tick(sim, 30); const floor = sim.body.translation().y; tick(sim, 20, { jump: true }); assert.ok(sim.body.translation().y > floor + 1);
  tick(sim, 90, { jump: true }); assert.ok(Math.abs(sim.body.translation().y - floor) < 0.02); assert.ok(sim.state.grounded);
}));

test("vault plinths block movement using real colliders", () => withSim("dodger", 0, sim => {
  place(sim, { x: -4, y: 0.5, z: 3 }); tick(sim, 30, { z: -1 });
  assert.ok(sim.body.translation().z > 1.5); assert.ok(sim.body.translation().z < 1.8);
}));

for (let index = 0; index < 3; index++) {
  test(`Gem Dash stage ${index + 1}: collect once, unlock gate, return and finish`, () => withSim("dodger", index, sim => {
    tick(sim, 10); assert.equal(sim.state.status, "playing"); assert.equal(sim.state.gateOpen, false);
    sim.state.invulnerable = 120;
    for (const gem of sim.level.gems) { place(sim, gem); const count = sim.state.collected.size; tick(sim, 3); assert.equal(sim.state.collected.size, count); }
    assert.equal(sim.state.collected.size, 12); assert.equal(sim.state.gateOpen, true); assert.equal(sim.state.status, "playing");
    place(sim, sim.level.exit); assert.equal(sim.state.status, "won"); assert.ok(sim.state.score >= 60);
    const elapsed = sim.state.elapsed, score = sim.state.score; tick(sim, 120); assert.equal(sim.state.elapsed, elapsed); assert.equal(sim.state.score, score);
  }));
}

test("guards cause bounded damage with a grace period, and defeat is terminal", () => withSim("dodger", 0, sim => {
  tick(sim, 1); place(sim, sim.state.guards[0]); assert.equal(sim.state.lives, 2);
  sim.damage(); assert.equal(sim.state.lives, 2);
  sim.state.invulnerable = 0; sim.damage(); sim.state.invulnerable = 0; sim.damage();
  assert.equal(sim.state.status, "lost"); assert.equal(sim.state.lives, 0); const elapsed = sim.state.elapsed; tick(sim, 60); assert.equal(sim.state.elapsed, elapsed);
}));

test("guard patrols never pass through vault plinths", () => withSim("dodger", 2, sim => {
  for (let frame = 0; frame < 900; frame++) {
    sim.step();
    for (const guard of sim.state.guards) for (const block of sim.level.obstacles) {
      const dx = Math.max(0, Math.abs(guard.x - block.x) - block.w / 2);
      const dz = Math.max(0, Math.abs(guard.z - block.z) - block.d / 2);
      assert.ok(Math.hypot(dx, dz) > 0.64);
    }
  }
}));

for (let stage = 0; stage < 3; stage++) test(`Gem Dash stage ${stage + 1} is winnable with normal movement and jumping`, () => withSim("dodger", stage, sim => {
  const route = [[0, 7], [8, 8], [8, 0], [8, -8], [0, -8], [-8, -8], [-8, 0], [-8, 8], [-4, 4], [-6, 3], [-6, -4], [-4, -4], [-3, -6], [4, -6], [4, -4], [6, -3], [6, 4], [4, 4], [3, 7], [0, 9]];
  let waypoint = 0, previousGuards = [];
  for (let frame = 0; frame < 7200 && sim.state.status === "playing"; frame++) {
    const p = sim.body.translation(), [x, z] = route[Math.min(waypoint, route.length - 1)];
    if (Math.hypot(x - p.x, z - p.z) < 0.15) waypoint++;
    const input = { x: Math.max(-1, Math.min(1, x - p.x)), z: Math.max(-1, Math.min(1, z - p.z)) };
    const speed = 6 / Math.max(1, Math.hypot(input.x, input.z));
    const jump = sim.state.grounded && sim.state.guards.some((g, i) => {
      const old = previousGuards[i] || g;
      const relativeX = (g.x - old.x) * 60 - input.x * speed;
      const relativeZ = (g.z - old.z) * 60 - input.z * speed;
      return Math.hypot(g.x - p.x + relativeX * 0.28, g.z - p.z + relativeZ * 0.28) < 1.25;
    });
    previousGuards = sim.state.guards.map(g => ({ ...g }));
    sim.step({ ...input, jump });
  }
  assert.equal(sim.state.status, "won", JSON.stringify({ waypoint, collected: [...sim.state.collected], lives: sim.state.lives }));
  assert.equal(sim.state.collected.size, 12);
}));

test("first laser stage can be won by timing real jumps without invulnerability", () => withSim("laser-dodge", 0, sim => {
  for (let frame = 0; frame < 2500 && sim.state.status === "playing"; frame++) {
    const p = sim.body.translation();
    const jump = sim.state.grounded && sim.state.beams.some(b => b.active && b.height < 1 && Math.abs((b.axis === "x" ? p.x : p.z) - b.coordinate) < 1.8);
    sim.step({ jump });
  }
  assert.equal(sim.state.status, "won"); assert.equal(sim.state.lives, 3);
}));

test("laser cycles have startup grace, warnings, both axes and overhead beams", () => {
  assert.equal(beamAt(2, 0, 0).active, false); assert.equal(beamAt(3.5, 0, 0).warning, true);
  assert.equal(beamAt(4.2, 0, 0).active, true);
  const states = Array.from({ length: 180 }, (_, i) => beamAt(i / 10, 0, 1));
  assert.ok(states.some(s => s.active && s.axis === "x")); assert.ok(states.some(s => s.active && s.axis === "z")); assert.ok(states.some(s => s.active && s.height > 1));
  assert.ok(states.every(s => !(s.active && s.warning)));
});

test("laser sensors hit on the ground but can be jumped over", async () => {
  await withSim("laser-dodge", 0, sim => { tick(sim, 349); place(sim, { x: 0, y: 0.47, z: 2 }); tick(sim, 12); assert.ok(sim.state.lives < 3); });
  await withSim("laser-dodge", 0, sim => { tick(sim, 349); place(sim, { x: 0, y: 2, z: 2 }); tick(sim, 12); assert.equal(sim.state.lives, 3); });
});

for (let index = 0; index < 3; index++) test(`Laser Escape stage ${index + 1} completes at its time limit`, () => withSim("laser-dodge", index, sim => {
  sim.state.invulnerable = 100; tick(sim, sim.level.duration * 60 + 2);
  assert.equal(sim.state.status, "won"); assert.equal(sim.state.lives, 3); assert.equal(sim.state.score, sim.level.duration + 15);
}));

test("vault timer ends the round, restart is fresh, and disposal is idempotent", async () => {
  await withSim("dodger", 2, sim => { sim.state.invulnerable = 200; tick(sim, sim.level.duration * 60 + 2); assert.equal(sim.state.status, "lost"); sim.dispose(); sim.dispose(); sim.step(); });
  await withSim("dodger", 2, sim => { assert.equal(sim.state.lives, 3); assert.equal(sim.state.collected.size, 0); assert.equal(sim.state.score, 0); });
});

test("both build flows and the offline worker include the lazy arcade bundle", () => {
  for (const file of ["prepare-vercel.mjs", "prepare-tauri.mjs", "serve.mjs"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const asset of ["assets/arcade-games.js", "assets/arcade-games.css", "assets/arcade-games.js.LEGAL.txt", "assets/gem-dash-3d.png", "assets/laser-escape-3d.png"]) assert.ok(source.includes(asset));
  }
  const sw = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8"); assert.match(sw, /ARCADE_ASSETS = \[".\/assets\/arcade-games.js"\]/);
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8"); assert.match(html, /import\(`\.\/assets\/arcade-games.js/);
});

test("converted games bypass the legacy canvas loop without changing the other 3D modes", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const context = createContext({ currentGame: "dodger" });
  new Script(html.match(/function isThreeGame\([^]*?^      }/m)[0]).runInContext(context);
  for (const mode of ["dodger", "laser-dodge", "crystal-isles-3d", "dead-route-3d", "catcher", "coin-rush"]) assert.equal(context.isThreeGame(mode), true);
  for (const mode of ["snake", "online-snake", "online-catcher"]) assert.equal(context.isThreeGame(mode), false);
});
