import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createZombieSimulation, normalizeCheckpoint, STOPS, STEP } from "../src/zombie-world.mjs";

function teleport(sim, actor, x, z, y = 0.95) {
  actor.body.setTranslation({ x, y, z }, true);
  actor.body.setNextKinematicTranslation({ x, y, z });
  sim.world.step();
}
function tick(sim, seconds, input = {}) {
  for (let i = 0; i < seconds / STEP; i++) sim.step(typeof input === "function" ? input() : input);
}
function isolateEnemy(sim) {
  for (const enemy of sim.state.enemies.slice(1)) { enemy.hp = 0; enemy.collider.setEnabled(false); }
  return sim.state.enemies[0];
}

test("checkpoints are versioned and constrain malformed persisted values", () => {
  assert.equal(normalizeCheckpoint(null).ammo, 72);
  assert.equal(normalizeCheckpoint({ version: 9, stopIndex: 2 }).stopIndex, 0);
  const c = normalizeCheckpoint({ version: 1, stopIndex: 999, level: 3, xp: Infinity, armor: 999, health: 9999, fuel: -4, weapon: "yes", scrap: -50 });
  assert.deepEqual([c.stopIndex, c.level, c.xp, c.armor, c.health, c.fuel, c.weapon, c.scrap], [2, 3, 119, 2, 130, 0, 0, 0]);
});

test("all three stops create colliding worlds with distinct encounters and loot", async () => {
  for (let i = 0; i < STOPS.length; i++) {
    const sim = await createZombieSimulation({ version: 1, stopIndex: i });
    try {
      assert.equal(sim.state.enemies.length, STOPS[i].enemies);
      assert.equal(sim.state.loot.length, 3);
      assert.equal(sim.state.enemies.filter(e => e.boss).length, i === 2 ? 1 : 0);
      assert.equal(sim.checkpoint().stopIndex, i);
      assert.equal(sim.bus.body.translation().z, STOPS[i].z + 8);
      tick(sim, 0.5, { x: 1 });
      assert.ok(sim.player.body.translation().x > 6);
      assert.ok(sim.player.body.translation().y > 0.8);
    } finally { sim.dispose(); }
  }
});

test("fuel and supplies collect once, while out-of-range interactions do nothing", async () => {
  const sim = await createZombieSimulation();
  try {
    teleport(sim, sim.player, -17, -9);
    assert.equal(sim.prompt().action, "fuel");
    assert.equal(sim.interact(), true);
    assert.equal(sim.state.fuel, 85);
    assert.equal(sim.state.fuelFound, true);
    assert.equal(sim.interact(), false);
    assert.equal(sim.state.scrap, 10);
    teleport(sim, sim.player, 17, -9);
    sim.interact();
    assert.equal(sim.state.ammo, 120);
    assert.equal(sim.state.medkits, 3);
    teleport(sim, sim.player, 27, 16);
    assert.equal(sim.interact(), false);
  } finally { sim.dispose(); }
});

test("Rapier walls block walking and bullets", async () => {
  const sim = await createZombieSimulation();
  try {
    const enemy = isolateEnemy(sim);
    teleport(sim, sim.player, -8, -8); teleport(sim, enemy, -14, -8);
    const hp = enemy.hp;
    sim.step({ shoot: true, aim: { x: -1, z: 0 } });
    assert.equal(enemy.hp, hp);
    tick(sim, 1, { x: -1 });
    assert.ok(sim.player.body.translation().x > -10.5);
  } finally { sim.dispose(); }
});

test("pistol, reload, kills and level rewards run through real raycasts", async () => {
  const sim = await createZombieSimulation();
  try {
    const enemy = isolateEnemy(sim);
    teleport(sim, sim.player, 5, 8); teleport(sim, enemy, 5, 0);
    tick(sim, 0.6, { shoot: true, aim: { x: 0, z: -1 } });
    assert.equal(enemy.hp, 0);
    assert.equal(sim.state.kills, 1); assert.equal(sim.state.xp, 20); assert.equal(sim.state.scrap, 5);
    sim.state.magazine = 0; sim.state.ammo = 7;
    assert.equal(sim.reload(), true);
    tick(sim, 1.4);
    assert.equal(sim.state.magazine, 7); assert.equal(sim.state.ammo, 0);
    assert.equal(sim.reload(), false);
  } finally { sim.dispose(); }
});

test("zombies cannot attack through walls and navigate out through a doorway", async () => {
  const sim = await createZombieSimulation();
  try {
    const enemy = isolateEnemy(sim);
    teleport(sim, sim.player, -10.35, -8); teleport(sim, enemy, -11.65, -8);
    sim.step(); assert.equal(sim.state.health, 100);
    teleport(sim, sim.player, -9, -8); teleport(sim, enemy, -16, -8);
    tick(sim, 18);
    assert.ok(enemy.body.translation().x > -10.5);
    assert.ok(sim.state.health < 100);
  } finally { sim.dispose(); }
});

test("melee works without ammunition and respects cooldowns", async () => {
  const sim = await createZombieSimulation();
  try {
    const enemy = isolateEnemy(sim);
    teleport(sim, sim.player, 5, 8); teleport(sim, enemy, 5, 6);
    sim.state.ammo = sim.state.magazine = 0;
    sim.step({ melee: true }); const hp = enemy.hp;
    assert.ok(hp < enemy.maxHp);
    sim.step({ melee: true }); assert.equal(enemy.hp, hp);
    tick(sim, 0.8, { melee: true }); assert.equal(enemy.hp, 0);
  } finally { sim.dispose(); }
});

test("workshop checks distance, resources, caps and medkit usage", async () => {
  const sim = await createZombieSimulation();
  try {
    assert.equal(sim.purchase("armor"), false);
    sim.state.scrap = 100;
    assert.equal(sim.purchase("armor"), true); assert.equal(sim.state.maxBusHealth, 180);
    assert.equal(sim.purchase("armor"), true); assert.equal(sim.purchase("armor"), false);
    assert.equal(sim.purchase("weapon"), true); assert.equal(sim.purchase("weapon"), false);
    sim.state.busHealth = 100; assert.equal(sim.purchase("repair"), true); assert.equal(sim.state.busHealth, 150);
    teleport(sim, sim.player, 25, 10);
    assert.equal(sim.purchase("repair"), false);
    sim.state.health = 30; assert.equal(sim.purchase("heal"), true); assert.equal(sim.state.health, 90);
    assert.equal(sim.state.medkits, 1);
  } finally { sim.dispose(); }
});

test("zombies navigate and damage the player; defeat is terminal", async () => {
  const sim = await createZombieSimulation();
  try {
    const enemy = isolateEnemy(sim); teleport(sim, sim.player, 7, 8); teleport(sim, enemy, 7, 0);
    tick(sim, 6); assert.ok(sim.state.health < 100); assert.ok(enemy.body.translation().z > 3);
    sim.state.health = 1; tick(sim, 2); assert.equal(sim.state.status, "lost");
    const elapsed = sim.state.elapsed; tick(sim, 1); assert.equal(sim.state.elapsed, elapsed);
  } finally { sim.dispose(); }
});

test("bus cannot skip an uncleared stop and must stop before exiting", async () => {
  const sim = await createZombieSimulation();
  try {
    for (const enemy of sim.state.enemies) { enemy.hp = 0; enemy.collider.setEnabled(false); }
    assert.equal(sim.interact(), true); assert.equal(sim.state.inBus, true);
    tick(sim, 1, { throttle: 1 }); assert.equal(sim.interact(), false);
    tick(sim, 5, { throttle: 1 });
    assert.equal(sim.state.stopIndex, 0); assert.ok(sim.bus.body.translation().z >= -28.1);
    tick(sim, 2); assert.equal(sim.interact(), true); assert.equal(sim.state.inBus, false);
  } finally { sim.dispose(); }
});

test("complete three-stop journey with shooting, real driving, checkpoints and final boss", async () => {
  const sim = await createZombieSimulation();
  try {
    for (let stop = 0; stop < STOPS.length; stop++) {
      assert.equal(sim.state.stopIndex, stop);
      // Position combat fixtures in a clear firing lane, preserving real AI, raycasts and health.
      for (const enemy of sim.state.enemies) {
        if (enemy.hp <= 0) continue;
        const z = STOPS[stop].z;
        teleport(sim, sim.player, 7, z + 14); teleport(sim, enemy, 7, z + 4);
        for (let frame = 0; frame < 600 && enemy.hp > 0; frame++) {
          const p = sim.player.body.translation(), e = enemy.body.translation();
          sim.step({ shoot: true, aim: { x: e.x - p.x, z: e.z - p.z }, heal: sim.state.health < 65 });
        }
        assert.equal(enemy.hp, 0, `encounter ${enemy.id}`);
      }
      teleport(sim, sim.player, -17, STOPS[stop].z - 9); sim.interact();
      teleport(sim, sim.player, 17, STOPS[stop].z - 9); sim.interact();
      teleport(sim, sim.player, 4, STOPS[stop].z + 9); assert.equal(sim.interact(), true);
      sim.purchase("repair"); sim.purchase("armor"); sim.purchase("weapon");
      tick(sim, 9, () => sim.state.stopIndex === stop && sim.state.status === "playing" ? { throttle: 1 } : {});
      if (stop < 2) {
        assert.equal(sim.state.stopIndex, stop + 1);
        assert.equal(sim.checkpoint().stopIndex, stop + 1);
        assert.equal(sim.state.inBus, false);
      }
    }
    assert.equal(sim.state.status, "won"); assert.equal(sim.state.kills, 17);
    assert.ok(sim.state.level >= 4); assert.ok(sim.state.score > 3000);
    assert.ok(sim.state.fuel > 0);
    const restored = await createZombieSimulation(sim.checkpoint());
    assert.equal(restored.state.stopIndex, 2); assert.equal(restored.state.enemies.length, 7);
    assert.equal(restored.state.loot.some(item => item.taken), false); restored.dispose();
  } finally { sim.dispose(); }
});

test("new game stays lazy-loaded and is copied by both existing web/app builds", () => {
  const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const html = read("index.html");
  assert.match(html, /data-start-game="dead-route-3d"/);
  assert.match(html, /function isThreeGame[\s\S]*?dead-route-3d/);
  assert.match(html, /async function startZombieGame[\s\S]*?requireDesktopGameplay\(\)/);
  assert.match(html, /import\(`\.\/assets\/zombie-game.js\?v=route-1&attempt=/);
  for (const script of ["scripts/prepare-vercel.mjs", "scripts/prepare-tauri.mjs", "scripts/serve.mjs"]) assert.match(read(script), /assets\/zombie-game.js/);
  assert.match(read("service-worker.js"), /LAZY_ASSETS = \[.*zombie-game.js/);
});
