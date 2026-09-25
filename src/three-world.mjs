import RAPIER from "@dimforge/rapier3d-compat";
import { LEVELS } from "./three-levels.mjs";

export const STEP = 1 / 60;
let ready;

export function makeLevel(mode, levelIndex = 0) {
  if (mode === "crystal-isles-3d") {
    if (!Number.isInteger(levelIndex) || !LEVELS[levelIndex]) throw new Error("Unknown 3D level.");
    const { islands, name, theme } = LEVELS[levelIndex];
    return {
      mode, levelIndex, name, theme, title: "Crystal Isles 3D", spawn: { x: 0, y: 1.2, z: 13 },
      boxes: islands.map(([x, y, z, w, d]) => ({ x, y, z, w, h: 1.2, d, kind: "island" })),
      gems: islands.map(([x, y, z]) => ({ x, y: y + 1.75, z })),
      portal: { x: 3, y: 1.3, z: 12 }, hazards: []
    };
  }
  throw new Error("Unknown 3D game.");
}

export async function createSimulation(mode, levelIndex = 0) {
  ready ||= RAPIER.init().catch((error) => { ready = null; throw error; });
  await ready;
  const level = makeLevel(mode, levelIndex);
  const world = new RAPIER.World({ x: 0, y: -22, z: 0 });
  world.timestep = STEP;
  for (const box of level.boxes) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(box.w / 2, box.h / 2, box.d / 2).setTranslation(box.x, box.y, box.z));
  }
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(level.spawn.x, level.spawn.y, level.spawn.z));
  const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(0.42, 0.45, 0.42), body);
  const controller = world.createCharacterController(0.025);
  controller.enableAutostep(0.25, 0.3, false);
  controller.enableSnapToGround(0.22);
  const sensor = (point, radius) => world.createCollider(RAPIER.ColliderDesc.ball(radius).setTranslation(point.x, point.y, point.z)
    .setSensor(true).setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL));
  const gems = level.gems.map((point) => sensor(point, 0.85));
  const portal = sensor(level.portal, 1.05);
  const hazards = level.hazards.map((point) => sensor(point, 0.5));
  const state = { elapsed: 0, collected: new Set(), lives: 3, status: "playing", grounded: false, velocityY: 0, checkpoint: { ...level.spawn }, invulnerable: 0, score: 0 };
  let coyote = 0, jumpBuffer = 0, disposed = false;
  world.step();

  function damage() {
    if (state.status !== "playing" || state.invulnerable > 0) return;
    state.lives--;
    if (state.lives <= 0) { state.status = "lost"; state.score = state.collected.size * 100; return; }
    body.setTranslation(state.checkpoint, true);
    body.setNextKinematicTranslation(state.checkpoint);
    state.velocityY = 0;
    state.grounded = false;
    coyote = jumpBuffer = 0;
    state.invulnerable = 1;
  }

  function step(input = {}) {
    if (disposed || state.status !== "playing") return state;
    state.elapsed += STEP;
    state.invulnerable = Math.max(0, state.invulnerable - STEP);
    if (input.jump) jumpBuffer = 0.12;
    else jumpBuffer = Math.max(0, jumpBuffer - STEP);
    coyote = state.grounded ? 0.1 : Math.max(0, coyote - STEP);
    if (jumpBuffer > 0 && coyote > 0) { state.velocityY = 9.3; jumpBuffer = coyote = 0; state.grounded = false; }
    state.velocityY = Math.max(-25, state.velocityY - 22 * STEP);
    const x = Number.isFinite(input.x) ? Math.max(-1, Math.min(1, input.x)) : 0;
    const z = Number.isFinite(input.z) ? Math.max(-1, Math.min(1, input.z)) : 0;
    const length = Math.max(1, Math.hypot(x, z));
    const desired = { x: x / length * 6.4 * STEP, y: state.velocityY * STEP, z: z / length * 6.4 * STEP };
    controller.computeColliderMovement(collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    const movement = controller.computedMovement();
    const position = body.translation();
    body.setNextKinematicTranslation({ x: position.x + movement.x, y: position.y + movement.y, z: position.z + movement.z });
    state.grounded = controller.computedGrounded();
    if (state.grounded && state.velocityY < 0 || state.velocityY > 0 && movement.y < desired.y - 0.001) state.velocityY = 0;
    hazards.forEach((hazard, i) => {
      const def = level.hazards[i];
      const point = { x: def.x, y: def.y, z: def.z };
      point[def.axis] += Math.sin(state.elapsed * 1.25 + i) * def.range;
      hazard.setTranslation(point);
    });
    world.step();
    if (body.translation().y < -7) { damage(); return state; }
    gems.forEach((gem, i) => {
      if (!state.collected.has(i) && world.intersectionPair(collider, gem)) {
        state.collected.add(i);
        state.checkpoint = { ...level.gems[i], y: level.gems[i].y + 0.15 };
      }
    });
    if (hazards.some((hazard) => world.intersectionPair(collider, hazard))) damage();
    if (state.status === "playing" && state.collected.size === gems.length && world.intersectionPair(collider, portal)) {
      state.status = "won";
      state.score = gems.length * 100 + Math.max(0, 600 - Math.floor(state.elapsed * 2));
    }
    return state;
  }
  return { level, state, body, hazards, step, damage, dispose() { if (!disposed) { disposed = true; world.free(); } } };
}
