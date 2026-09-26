import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createZombieSimulation, normalizeCheckpoint, makeRoad, STOPS, STEP } from "../src/zombie-world.mjs";
import { SOUND_LENGTHS, makeSoundBuffer, spatialMix, createRouteAudio } from "../src/zombie-audio.mjs";

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
      assert.equal(sim.state.loot.length, 5);
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
  assert.match(html, /import\(`\.\/assets\/zombie-game.js\?v=route-2&attempt=/);
  for (const script of ["scripts/prepare-vercel.mjs", "scripts/prepare-tauri.mjs", "scripts/serve.mjs"]) assert.match(read(script), /assets\/zombie-game.js/);
  assert.match(read("service-worker.js"), /LAZY_ASSETS = \[.*zombie-game.js/);
});

test("twelve distinct buildings have real walls and wide, unobstructed doorways", () => {
  const road = makeRoad();
  assert.equal(road.buildings.length, 12);
  assert.equal(new Set(road.buildings.map(b => b.kind)).size, 12);
  for (const b of road.buildings) {
    const walls = road.walls.filter(w => w.buildingId === b.id);
    assert.equal(walls.length, 5);
    assert.ok(Math.abs(b.x) - b.w / 2 > 9, "Driving lane stays clear");
    assert.ok(!walls.some(w => Math.abs(b.x - w.x) < w.w / 2 && Math.abs(b.z + b.d / 2 - w.z) < w.d / 2));
  }
});

test("new side buildings can be entered and their bonus loot only pays once", async () => {
  const sim = await createZombieSimulation();
  try {
    for (const enemy of sim.state.enemies) { enemy.hp = 0; enemy.collider.setEnabled(false); }
    teleport(sim, sim.player, -20, -21);
    tick(sim, 1.2, { z: -1 });
    assert.ok(sim.player.body.translation().z < -28);
    assert.equal(sim.prompt().action, "spares");
    sim.interact(); assert.equal(sim.state.scrap, 8);
    sim.interact(); assert.equal(sim.state.scrap, 8);
    teleport(sim, sim.player, 20, -29); sim.interact();
    assert.equal(sim.state.ammo, 84);
    sim.interact(); assert.equal(sim.state.ammo, 84);
    teleport(sim, sim.player, -13, -28); tick(sim, 0.8, { x: -1 });
    assert.ok(sim.player.body.translation().x > -14.5, "New side wall blocks movement");
  } finally { sim.dispose(); }
});

const sampleContext = {
  sampleRate: 22050,
  createBuffer: (channels, length, rate) => { const data = new Float32Array(length); return { length, duration: length / rate, getChannelData: () => data }; }
};
test("all thirteen original effects are bounded, non-silent PCM without clicks at their ends", () => {
  for (const name of Object.keys(SOUND_LENGTHS)) {
    const data = makeSoundBuffer(sampleContext, name).getChannelData(0);
    let energy = 0;
    for (const value of data) { assert.ok(Number.isFinite(value) && Math.abs(value) <= 0.901); energy += value * value; }
    assert.ok(Math.sqrt(energy / data.length) > 0.001, `${name} is audible`);
    assert.ok(Math.abs(data[0]) < 0.001 && Math.abs(data.at(-1)) < 0.01, name);
  }
  assert.throws(() => makeSoundBuffer(sampleContext, "invalid"));
});

test("positional zombie sound attenuates with distance and follows camera orientation", () => {
  const listener = { x: 0, z: 0 };
  assert.equal(spatialMix({ x: 40, z: 0 }, listener).gain, 0);
  assert.ok(spatialMix({ x: 5, z: 0 }, listener).pan > 0);
  assert.ok(spatialMix({ x: -5, z: 0 }, listener).pan < 0);
  assert.ok(Math.abs(spatialMix({ x: 5, z: 0 }, listener, Math.PI / 2).pan) < 0.01);
  assert.equal(spatialMix(listener, listener).gain, 1);
});

class FakeAudioContext {
  constructor() { this.state = "suspended"; this.sampleRate = sampleContext.sampleRate; this.currentTime = 0; this.destination = {}; this.nodes = []; }
  param() { return { value: 0, cancelScheduledValues() {}, setTargetAtTime(value) { this.value = value; } }; }
  node() { const node = { connect() {}, disconnect() {}, start() {}, stop() { this.stopped = true; }, gain: this.param(), pan: this.param(), playbackRate: this.param(), threshold: this.param(), ratio: this.param() }; this.nodes.push(node); return node; }
  createBuffer(...args) { return sampleContext.createBuffer(...args); }
  createGain() { return this.node(); }
  createDynamicsCompressor() { return this.node(); }
  createBufferSource() { return this.node(); }
  createStereoPanner() { return this.node(); }
  async resume() { this.state = "running"; }
  async suspend() { this.state = "suspended"; }
  async close() { this.state = "closed"; }
}

test("audio caps voices, reuses buffers, pauses, resumes, mutes and disposes", async () => {
  const context = new FakeAudioContext();
  const sound = createRouteAudio({ contextFactory: () => context });
  await sound.unlock(); assert.equal(sound.snapshot().state, "running");
  for (let i = 0; i < 25; i++) sound.play("shot");
  assert.equal(sound.snapshot().voices, 16); assert.equal(sound.snapshot().buffers, 3);
  sound.setMuted(true); assert.equal(sound.snapshot().voices, 0); assert.equal(sound.play("shot"), false);
  sound.setMuted(false); await sound.unlock(); assert.equal(sound.play("shot"), true);
  sound.setPaused(true); assert.equal(context.state, "suspended"); assert.equal(sound.snapshot().voices, 0);
  sound.setPaused(false); await sound.unlock(); assert.equal(context.state, "running");
  sound.dispose(); sound.dispose(); assert.equal(context.state, "closed"); assert.equal(sound.snapshot().buffers, 0);
  await sound.unlock(); assert.equal(context.state, "closed");
});

test("zero volume and failed audio startup do not block play or later retries", async () => {
  let attempts = 0;
  const silent = createRouteAudio({ volume: 0, contextFactory: () => { attempts++; throw new Error("blocked"); } });
  await silent.unlock(); assert.equal(attempts, 0); silent.dispose();
  const sound = createRouteAudio({ contextFactory: () => { if (++attempts === 1) throw new Error("blocked"); return new FakeAudioContext(); } });
  await sound.unlock(); assert.equal(sound.snapshot().state, "idle");
  await sound.unlock(); assert.equal(sound.snapshot().state, "running"); sound.dispose();
  const canceled = createRouteAudio({ contextFactory: () => { throw new Error("Must not initialize after disposal"); } });
  const pending = canceled.unlock(); canceled.dispose(); await pending; assert.equal(canceled.snapshot().state, "idle");
});
