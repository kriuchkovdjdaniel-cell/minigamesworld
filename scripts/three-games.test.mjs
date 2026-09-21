import assert from "node:assert/strict";
import test from "node:test";
import { createSimulation, makeLevel, STEP } from "../src/three-world.mjs";

const mode = "crystal-isles-3d";
const tick = (sim, count, input) => { for (let i = 0; i < count; i++) sim.step(input); };
const teleport = (sim, point) => {
  sim.body.setTranslation(point, true);
  sim.body.setNextKinematicTranslation(point);
  sim.state.velocityY = 0;
  tick(sim, 3);
};
async function withSimulation(fn) {
  const sim = await createSimulation(mode);
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

test("the entire course can be completed through movement and jumps without teleporting", () => withSimulation((sim) => {
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
}));

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
