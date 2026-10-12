import RAPIER from "@dimforge/rapier3d-compat";

export const STEP = 1 / 60;
export const ARCADE_LEVELS = {
  dodger: ["Garden Vault", "Sentinel Court", "Crystal Citadel"],
  "laser-dodge": ["Reactor Hall", "Crossfire", "Overload"]
};
let ready;

export function makeArcadeLevel(mode, index = 0) {
  if (!ARCADE_LEVELS[mode] || !Number.isInteger(index) || !ARCADE_LEVELS[mode][index]) throw new Error("Unknown arcade course");
  const gems = mode === "dodger";
  return {
    mode, index, title: gems ? "Gem Dash 3D" : "Laser Escape 3D", name: ARCADE_LEVELS[mode][index],
    spawn: { x: 0, y: 0.7, z: 9 }, duration: gems ? 120 - index * 15 : 40 + index * 10,
    obstacles: gems ? [[-4, 0], [4, 0], [0, -4], [0, 4]].map(([x, z]) => ({ x, z, w: 2.2, h: 1.6, d: 2.2 })) : [],
    gems: gems ? [[-8, 8], [0, 7], [8, 8], [8, 0], [8, -8], [0, -8], [-8, -8], [-8, 0], [-4, 4], [4, 4], [4, -4], [-4, -4]].map(([x, z]) => ({ x, y: 0.7, z })) : [],
    guardCount: gems ? 3 + index : 0, beamCount: gems ? 0 : index === 0 ? 1 : 2,
    exit: { x: 0, y: 0.7, z: 9 }
  };
}

export function beamAt(time, index, difficulty) {
  const period = 5.5 - difficulty * 0.45, offset = 3 + index * period / 2;
  if (time < offset) return { active: false, warning: false, axis: "z", coordinate: -11.4, height: 0.38 };
  const cycle = Math.floor((time - offset) / period), phase = (time - offset) % period;
  const axis = (cycle + index) % 2 ? "x" : "z";
  const direction = cycle % 2 ? -1 : 1;
  const progress = Math.max(0, Math.min(1, (phase - 1.1) / 3));
  return { active: phase >= 1.1 && phase < 4.1, warning: phase < 1.1, axis,
    coordinate: direction * (-11.4 + 22.8 * progress), height: difficulty > 0 && (cycle + index) % 3 === 2 ? 1.9 : 0.38 };
}

export async function createArcadeSimulation(mode, index = 0) {
  const level = makeArcadeLevel(mode, index);
  ready ||= RAPIER.init().catch(error => { ready = null; throw error; });
  await ready;
  const world = new RAPIER.World({ x: 0, y: -22, z: 0 }); world.timestep = STEP;
  const box = (x, y, z, w, h, d) => world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x, y, z));
  box(0, -0.5, 0, 24, 1, 24);
  for (const side of [-1, 1]) { box(side * 12, 2, 0, 0.5, 4, 24); box(0, 2, side * 12, 24, 4, 0.5); }
  level.obstacles.forEach(o => box(o.x, o.h / 2, o.z, o.w, o.h, o.d));
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(level.spawn.x, level.spawn.y, level.spawn.z));
  const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(0.42, 0.45, 0.42), body);
  const controller = world.createCharacterController(0.025);
  controller.enableSnapToGround(0.2);
  const sensor = desc => world.createCollider(desc.setSensor(true).setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL));
  const pickups = level.gems.map(g => sensor(RAPIER.ColliderDesc.ball(0.65).setTranslation(g.x, g.y, g.z)));
  const guards = Array.from({ length: level.guardCount }, () => sensor(RAPIER.ColliderDesc.ball(0.64).setTranslation(0, -20, 0)));
  const beams = Array.from({ length: level.beamCount }, () => sensor(RAPIER.ColliderDesc.cuboid(11.6, 0.12, 0.12).setTranslation(0, -20, 0)));
  const state = { elapsed: 0, lives: 3, score: 0, status: "playing", collected: new Set(), grounded: false, velocityY: 0, invulnerable: 0, beams: [], guards: [], gateOpen: false };
  let disposed = false, wasJump = false;
  world.step();
  function damage() {
    if (disposed || state.status !== "playing" || state.invulnerable > 0) return;
    state.lives--; state.invulnerable = 1.5;
    if (state.lives <= 0) state.status = "lost";
  }
  function step(input = {}) {
    if (disposed || state.status !== "playing") return state;
    state.elapsed += STEP; state.invulnerable = Math.max(0, state.invulnerable - STEP);
    if (input.jump && !wasJump && state.grounded) { state.velocityY = 8; state.grounded = false; }
    wasJump = Boolean(input.jump);
    state.velocityY = Math.max(-25, state.velocityY - 22 * STEP);
    const axis = value => Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    const x = axis(input.x), z = axis(input.z), length = Math.max(1, Math.hypot(x, z));
    const desired = { x: x / length * 6 * STEP, y: state.velocityY * STEP, z: z / length * 6 * STEP };
    controller.computeColliderMovement(collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    const movement = controller.computedMovement(), position = body.translation();
    body.setNextKinematicTranslation({ x: position.x + movement.x, y: position.y + movement.y, z: position.z + movement.z });
    state.grounded = controller.computedGrounded();
    if (state.grounded && state.velocityY < 0 || state.velocityY > 0 && movement.y < desired.y - 0.001) state.velocityY = 0;
    guards.forEach((guard, i) => {
      const t = state.elapsed * (0.65 + level.index * 0.12) + i * 1.4;
      const point = i < 3 ? { x: Math.sin(t) * 9, y: 0.65, z: [-7, -2, 7][i] } : { x: i === 3 ? -6 : 6, y: 0.65, z: Math.sin(t) * 9 };
      guard.setTranslation(point); state.guards[i] = point;
    });
    beams.forEach((beam, i) => {
      const b = beamAt(state.elapsed, i, level.index); state.beams[i] = b;
      beam.setTranslation({ x: b.axis === "x" ? b.coordinate : 0, y: b.active ? b.height : -20, z: b.axis === "z" ? b.coordinate : 0 });
      beam.setRotation(b.axis === "x" ? { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 } : { x: 0, y: 0, z: 0, w: 1 });
    });
    world.step();
    pickups.forEach((pickup, i) => { if (!state.collected.has(i) && world.intersectionPair(collider, pickup)) state.collected.add(i); });
    if ([...guards, ...beams].some(h => world.intersectionPair(collider, h))) damage();
    if (body.translation().y < -5) { damage(); body.setTranslation(level.spawn, true); body.setNextKinematicTranslation(level.spawn); state.velocityY = 0; }
    state.score = mode === "dodger" ? state.collected.size * 5 : Math.floor(state.elapsed);
    if (state.status !== "playing") return state;
    if (mode === "dodger") {
      state.gateOpen = state.collected.size === pickups.length;
      const p = body.translation();
      if (state.gateOpen && Math.hypot(p.x - level.exit.x, p.z - level.exit.z) < 1.2) { state.status = "won"; state.score += Math.max(0, Math.ceil((level.duration - state.elapsed) / 5)); }
      else if (state.elapsed >= level.duration) state.status = "lost";
    } else if (state.elapsed >= level.duration) { state.status = "won"; state.score += state.lives * 5; }
    return state;
  }
  return { level, state, body, collider, world, step, damage, dispose() { if (!disposed) { disposed = true; world.free(); } } };
}
