import assert from "node:assert/strict";
import test from "node:test";
import { createSimulation, makeLevel, STEP } from "../src/three-world.mjs";
import { LEVELS, normalizeProgress, recordLevelResult } from "../src/three-levels.mjs";

const mode = "crystal-isles-3d";
const tick = (sim, count, input) => { for (let i = 0; i < count; i++) sim.step(input); };
const teleport = (sim, point) => {
  sim.body.setTranslation(point, true);
  sim.body.setNextKinematicTranslation(point);
  sim.state.velocityY = 0;
  tick(sim, 3);
};
async function withSimulation(fn, levelIndex = 0) {
  const sim = await createSimulation(mode, levelIndex);
  try { await fn(sim); } finally { sim.dispose(); }
}

test("a separate 3D course has eight crystals and reachable platform gaps", () => {
  const level = makeLevel(mode);
  assert.equal(level.gems.length, 8);
  assert.throws(() => makeLevel("snake"), /Unknown/);
  const boxes = level.boxes;
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i], b = boxes[(i + 1) % boxes.length];
    const dx = Math.max(0, Math.abs(a.x - b.x) - (a.w + b.w) / 2);
    const dz = Math.max(0, Math.abs(a.z - b.z) - (a.d + b.d) / 2);
    assert.ok(Math.hypot(dx, dz) < 3.5, `jump ${i} has enough horizontal reach`);
    assert.ok(b.y - a.y < 1, `jump ${i} has enough vertical reach`);
  }
});

test("gravity lands the player on a solid platform without sinking", () => withSimulation((sim) => {
  tick(sim, 180);
  assert.ok(sim.state.grounded);
  assert.ok(sim.body.translation().y > 0.44 && sim.body.translation().y < 0.51);
  assert.equal(sim.state.lives, 3);
  assert.ok(Math.abs(sim.state.elapsed - 180 * STEP) < 1e-9);
}));

for (const [levelIndex, level] of LEVELS.entries()) {
test(`${level.name} can be completed through movement and jumps without teleporting`, () => withSimulation((sim) => {
  const walkTo = (target, jump = false) => {
    for (let n = 0; n < 300; n++) {
      if (sim.state.status === "won") return;
      const pos = sim.body.translation();
      const dx = target.x - pos.x, dz = target.z - pos.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.15 && sim.state.grounded) return;
      sim.step({ x: distance > 0.1 ? dx / distance : 0, z: distance > 0.1 ? dz / distance : 0, jump: jump && n === 0 });
    }
    assert.fail("Could not reach platform");
  };
  tick(sim, 60);
  walkTo(sim.level.gems[0]);
  for (let i = 0; i < sim.level.boxes.length; i++) {
    const a = sim.level.boxes[i], b = sim.level.boxes[(i + 1) % sim.level.boxes.length];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const x = (b.x - a.x) / length, z = (b.z - a.z) / length;
    const edge = Math.min(a.w / 2 / Math.abs(x), a.d / 2 / Math.abs(z));
    walkTo({ x: a.x + x * (edge - 0.4), z: a.z + z * (edge - 0.4) });
    walkTo(b, true);
    assert.equal(sim.state.lives, 3, `jump ${i} lands without losing a life`);
  }
  walkTo(sim.level.portal);
  assert.equal(sim.state.status, "won");
}, levelIndex));
}

test("new courses have distinct routes, names and scenery, and reject invalid indexes", () => {
  assert.equal(LEVELS.length, 4);
  assert.equal(new Set(LEVELS.map(level => level.name)).size, 4);
  assert.equal(new Set(LEVELS.map(level => JSON.stringify(level.islands))).size, 4);
  assert.equal(new Set(LEVELS.map(level => level.theme.sky)).size, 4);
  for (const index of [-1, 4, NaN, Infinity, "1", 1.5]) assert.throws(() => makeLevel(mode, index), /Unknown 3D level/);
});

test("saved level progress is bounded and completing or replaying a level cannot erase other clears", () => {
  for (const value of [null, "corrupt", { selected: 99 }, { selected: -1 }, { selected: "2", completed: ["true", 1] }]) {
    assert.deepEqual(normalizeProgress(value), { selected: 0, completed: [false, false, false, false] });
  }
  const original = { selected: 1, completed: [true, false, false, false] };
  const won = recordLevelResult(original, { levelIndex: 1, won: true });
  assert.deepEqual(won.completed, [true, true, false, false]);
  assert.deepEqual(original.completed, [true, false, false, false]);
  assert.deepEqual(recordLevelResult(won, { levelIndex: 0, won: false }).completed, won.completed);
  assert.deepEqual(recordLevelResult(won, { levelIndex: 1, won: true }), won);
  assert.deepEqual(recordLevelResult(won, { levelIndex: 40, won: true }), won);
});

for (let levelIndex = 1; levelIndex < LEVELS.length; levelIndex++) {
  test(`${LEVELS[levelIndex].name} resets crystals and lives, and keeps the portal locked until complete`, () => withSimulation((sim) => {
    assert.equal(sim.state.collected.size, 0);
    assert.equal(sim.state.lives, 3);
    teleport(sim, sim.level.portal);
    assert.equal(sim.state.status, "playing");
    for (const gem of sim.level.gems) teleport(sim, gem);
    teleport(sim, sim.level.portal);
    assert.equal(sim.state.status, "won");
    assert.equal(sim.state.collected.size, sim.level.gems.length);
  }, levelIndex));
}

test("movement is bounded, diagonals are normalized and invalid input is ignored", async () => {
  const distance = async (input) => {
    let value;
    await withSimulation((sim) => {
      tick(sim, 60);
      const before = sim.body.translation();
      tick(sim, 12, input);
      const after = sim.body.translation();
      value = Math.hypot(after.x - before.x, after.z - before.z);
    });
    return value;
  };
  const straight = await distance({ x: 1 });
  assert.ok(Math.abs(straight - await distance({ x: 1, z: -1 })) < 0.01);
  assert.ok(Math.abs(straight - await distance({ x: 100 })) < 0.01);
  assert.ok(await distance({ x: NaN, z: Infinity }) < 1e-6);
});

test("jump rises, cannot be repeated midair, and lands again", () => withSimulation((sim) => {
  tick(sim, 60);
  const floor = sim.body.translation().y;
  sim.step({ jump: true });
  tick(sim, 12);
  assert.ok(sim.body.translation().y > floor + 1);
  const velocity = sim.state.velocityY;
  sim.step({ jump: true });
  assert.ok(sim.state.velocityY < velocity);
  tick(sim, 90);
  assert.ok(sim.state.grounded);
  assert.ok(Math.abs(sim.body.translation().y - floor) < 0.02);
}));

test("crystals award once, save checkpoints, and falling costs one life", () => withSimulation((sim) => {
  teleport(sim, sim.level.gems[1]);
  assert.equal(sim.state.collected.size, 1);
  tick(sim, 30);
  assert.equal(sim.state.collected.size, 1);
  const checkpoint = { ...sim.state.checkpoint };
  teleport(sim, { x: 100, y: -10, z: 100 });
  assert.equal(sim.state.lives, 2);
  assert.ok(Math.abs(sim.body.translation().x - checkpoint.x) < 0.01);
  assert.ok(Math.abs(sim.body.translation().z - checkpoint.z) < 0.01);
  sim.damage();
  assert.equal(sim.state.lives, 2, "respawn has temporary protection");
}));

test("portal stays locked until every crystal is collected and completion freezes time", () => withSimulation((sim) => {
  teleport(sim, sim.level.portal);
  assert.equal(sim.state.status, "playing");
  for (const gem of sim.level.gems) teleport(sim, gem);
  assert.equal(sim.state.collected.size, 8);
  teleport(sim, sim.level.portal);
  assert.equal(sim.state.status, "won");
  assert.ok(sim.state.score >= 800 && sim.state.score <= 1400);
  const finished = sim.state.elapsed;
  tick(sim, 120, { x: 1, jump: true });
  assert.equal(sim.state.elapsed, finished);
}));

test("three falls finish the round, and disposal is idempotent", () => withSimulation((sim) => {
  for (let i = 0; i < 3; i++) {
    tick(sim, 90);
    teleport(sim, { x: 100, y: -10, z: 100 });
  }
  assert.equal(sim.state.status, "lost");
  assert.equal(sim.state.lives, 0);
  const elapsed = sim.state.elapsed;
  tick(sim, 60);
  assert.equal(sim.state.elapsed, elapsed);
  sim.dispose();
  sim.dispose();
  assert.equal(sim.step().elapsed, elapsed);
}));
