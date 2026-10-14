import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCollectionSimulation, makeCollectionLevel, makeNavigation, COLLECTION_LEVELS } from "../src/collection-world.mjs";

const tick = (sim, frames, input = {}) => { for (let i = 0; i < frames; i++) sim.step(input); };
const place = (sim, p) => { sim.body.setTranslation(p, true); sim.body.setNextKinematicTranslation(p); sim.state.velocityY = 0; tick(sim, 2); };
async function withSim(mode, index, run) { const sim = await createCollectionSimulation(mode, index); try { await run(sim); } finally { sim.dispose(); } }

test("only Apple Drop and Coin Dash are converted, with three valid stages", () => {
  assert.deepEqual(Object.keys(COLLECTION_LEVELS), ["catcher", "coin-rush"]);
  for (const mode of ["dodger", "laser-dodge", "crystal-isles-3d", "dead-route-3d", "online-catcher", "constructor"]) assert.throws(() => makeCollectionLevel(mode));
  for (const index of [-1, 3, NaN, Infinity, 0.4, "1"]) assert.throws(() => makeCollectionLevel("catcher", index));
  for (let i = 0; i < 3; i++) {
    const level = makeCollectionLevel("catcher", i);
    assert.ok(level.drops.filter(d => d.kind === "apple").length >= level.target);
    assert.equal(new Set(level.drops.map(d => d.id)).size, level.drops.length);
  }
});

test("ground, jumping, and arena boundaries use real collision physics", () => withSim("catcher", 0, sim => {
  tick(sim, 30); const floor = sim.body.translation().y;
  assert.ok(sim.state.grounded && floor > 0.44 && floor < 0.51);
  tick(sim, 18, { jump: true }); assert.ok(sim.body.translation().y > floor + 1);
  tick(sim, 70, { jump: true }); assert.ok(Math.abs(sim.body.translation().y - floor) < 0.02);
  tick(sim, 180, { x: 1 }); assert.ok(sim.body.translation().x > 11 && sim.body.translation().x < 11.4);
}));

test("non-finite input is ignored and diagonal speed is normalized", async () => {
  const lengths = [];
  for (const input of [{ x: 1 }, { x: 1, z: -1 }, { x: 999, z: -999 }]) await withSim("catcher", 0, sim => {
    place(sim, { x: 0, y: 8, z: 0 }); const p = sim.body.translation(); tick(sim, 30, input);
    const end = sim.body.translation(); lengths.push(Math.hypot(end.x - p.x, end.z - p.z));
  });
  assert.ok(Math.abs(lengths[0] - 3.7) < 0.02); assert.ok(Math.abs(lengths[0] - lengths[1]) < 0.02); assert.ok(Math.abs(lengths[1] - lengths[2]) < 0.02);
  await withSim("catcher", 0, sim => { tick(sim, 30, { x: NaN, z: Infinity }); assert.ok(Math.abs(sim.body.translation().x) < 0.01); });
});

for (let stage = 0; stage < 3; stage++) test(`Apple Drop stage ${stage + 1} is winnable through normal movement`, () => withSim("catcher", stage, sim => {
  for (let frame = 0; frame < sim.level.duration * 60 + 2 && sim.state.status === "playing"; frame++) {
    const p = sim.body.translation(), next = sim.state.drops.find(d => d.kind === "apple");
    sim.step(next ? { x: next.x - p.x, z: next.z - p.z } : {});
  }
  assert.equal(sim.state.status, "won", JSON.stringify({ caught: sim.state.caught, lives: sim.state.lives, missed: sim.state.missed }));
  assert.equal(sim.state.caught, sim.level.target); assert.ok(sim.state.score >= sim.state.caught);
  const score = sim.state.score, elapsed = sim.state.elapsed; tick(sim, 60); assert.equal(sim.state.score, score); assert.equal(sim.state.elapsed, elapsed);
}));

test("falling objects are forecast, fall under gravity, and cannot award twice", () => withSim("catcher", 0, sim => {
  place(sim, { x: 0, y: 0.5, z: 0 }); tick(sim, 61);
  assert.equal(sim.state.drops[0].phase, "warning"); assert.equal(sim.state.caught, 0);
  tick(sim, 70); assert.equal(sim.state.drops[0].phase, "falling"); assert.ok(sim.state.drops[0].y < 8);
  tick(sim, 100); assert.equal(sim.state.caught, 1);
  tick(sim, 30); assert.equal(sim.state.caught, 1);
}));

test("missed fruit does not award points and resolved physics bodies are removed", () => withSim("catcher", 2, sim => {
  let peak = 0;
  for (let i = 0; i < sim.level.duration * 60 + 2; i++) { sim.step(); peak = Math.max(peak, sim.world.bodies.len()); }
  assert.equal(sim.state.status, "lost"); assert.equal(sim.state.caught, 0); assert.equal(sim.state.score, 0);
  assert.ok(sim.state.missed > 20); assert.ok(peak <= 5, `bounded body count: ${peak}`);
}));

test("rocks cost one life per contact and damage has a grace period", () => withSim("catcher", 0, sim => {
  const rock = sim.level.drops.find(d => d.kind === "rock");
  place(sim, { x: rock.x, y: 0.5, z: rock.z }); tick(sim, Math.ceil((rock.at + 3) * 60));
  assert.equal(sim.state.lives, 2); sim.damage(); assert.equal(sim.state.lives, 2);
  sim.state.invulnerable = 0; sim.damage(); sim.state.invulnerable = 0; sim.damage();
  assert.equal(sim.state.status, "lost"); assert.equal(sim.state.lives, 0);
}));

for (let stage = 0; stage < 3; stage++) {
  test(`Coin Dash stage ${stage + 1} has reachable coins and distinct obstacles`, () => {
    const level = makeCollectionLevel("coin-rush", stage), navigate = makeNavigation(level);
    assert.equal(level.coins.length, 16);
    for (const point of [...level.coins, ...level.shields, ...level.enemies]) {
      assert.ok(navigate(level.spawn, point).length > 0);
      assert.ok(level.obstacles.every(b => Math.abs(point.x - b.x) >= b.w / 2 + 0.55 || Math.abs(point.z - b.z) >= b.d / 2 + 0.55));
    }
  });
  test(`Coin Dash stage ${stage + 1} can be completed through movement, jumps and dash`, () => withSim("coin-rush", stage, sim => {
    const navigate = makeNavigation(sim.level), order = [8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 15, 12, 14, 13];
    const targets = [...order.map(i => sim.level.coins[i]), sim.level.spawn]; let target = 0, route = [];
    for (let frame = 0; frame < 7200 && sim.state.status === "playing"; frame++) {
      const p = sim.body.translation();
      if (target < 16 && sim.state.collected.has(order[target])) { target++; route = []; }
      if (!route.length) route = navigate(p, targets[target]);
      while (route.length > 1 && Math.hypot(route[0].x - p.x, route[0].z - p.z) < 0.55) route.shift();
      const next = route[0] || targets[target];
      const jump = sim.state.grounded && sim.state.enemies.some(e => Math.hypot(e.x - p.x, e.z - p.z) < 2);
      sim.step({ x: next.x - p.x, z: next.z - p.z, dash: sim.state.cooldown === 0, jump });
    }
    assert.equal(sim.state.status, "won", JSON.stringify({ target, collected: [...sim.state.collected], lives: sim.state.lives, pos: sim.body.translation() }));
  }));
}

test("dash recharges, cannot be held to repeat, and cannot pass through walls", () => withSim("coin-rush", 0, sim => {
  tick(sim, 30); tick(sim, 15, { x: 1, dash: true }); assert.ok(sim.body.translation().x > 2.5); assert.ok(sim.state.cooldown > 3);
  tick(sim, 300, { x: 1, dash: true }); assert.equal(sim.state.cooldown, 0); assert.equal(sim.state.dash, 0); assert.ok(sim.body.translation().x < 11.4);
  sim.step({}); sim.step({ dash: true }); assert.ok(sim.state.cooldown > 3.9);
}));

test("orchard does not gain the Coin Dash ability", () => withSim("catcher", 0, sim => { tick(sim, 30, { dash: true }); assert.equal(sim.state.dash, 0); assert.equal(sim.state.cooldown, 0); }));

test("chasers navigate around solid buildings and can catch a stationary player", () => withSim("coin-rush", 1, sim => {
  for (let i = 0; i < 3600 && sim.state.status === "playing"; i++) {
    sim.step();
    for (const e of sim.state.enemies) for (const b of sim.level.obstacles) {
      const x = Math.max(0, Math.abs(e.x - b.x) - b.w / 2), z = Math.max(0, Math.abs(e.z - b.z) - b.d / 2);
      assert.ok(Math.hypot(x, z) > 0.52);
    }
  }
  assert.equal(sim.state.status, "lost"); assert.equal(sim.state.lives, 0);
}));

test("shield protection expires and cannot be collected twice", () => withSim("coin-rush", 0, sim => {
  place(sim, { x: -9, y: 0.5, z: 0 }); assert.equal(sim.state.usedShields.size, 1); assert.ok(sim.state.shield > 4);
  sim.damage(); assert.equal(sim.state.lives, 3); tick(sim, 310); assert.equal(sim.state.shield, 0);
  place(sim, { x: -9, y: 0.5, z: 0 }); assert.equal(sim.state.shield, 0);
}));

test("gate stays locked, pickup scores award once, and restart clears run state", async () => {
  await withSim("coin-rush", 0, sim => {
    tick(sim, 60); assert.equal(sim.state.gateOpen, false); assert.equal(sim.state.status, "playing");
    place(sim, sim.level.coins[0]); assert.equal(sim.state.collected.size, 1); const score = sim.state.score; tick(sim, 10); assert.equal(sim.state.score, score);
    sim.dispose(); sim.dispose(); sim.step();
  });
  await withSim("coin-rush", 0, sim => { assert.equal(sim.state.collected.size, 0); assert.equal(sim.state.lives, 3); assert.equal(sim.state.cooldown, 0); });
});

test("both distribution builds and offline cache include the new engine and art", () => {
  for (const file of ["prepare-vercel.mjs", "prepare-tauri.mjs", "serve.mjs"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const asset of ["collection-games.js", "collection-games.css", "collection-games.js.LEGAL.txt", "apple-drop-3d.png", "coin-dash-3d.png"]) assert.ok(source.includes(`assets/${asset}`));
  }
  const worker = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8"); assert.match(worker, /COLLECTION_ASSETS = \[".\/assets\/collection-games.js"\]/);
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /import\(`\.\/assets\/collection-games.js/); assert.match(html, /bestKey: "catcher-best"/); assert.match(html, /bestKey: "coin-rush-best"/);
});
