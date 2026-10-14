import RAPIER from "@dimforge/rapier3d-compat";
import PF from "pathfinding";

export const STEP = 1 / 60;
export const COLLECTION_LEVELS = {
  catcher: ["Meadow Orchard", "Cherry Grove", "Harvest Festival"],
  "coin-rush": ["Harbor Quarter", "Market Lanes", "Clockwork Docks"]
};
let ready;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const axis = n => Number.isFinite(n) ? Math.max(-1, Math.min(1, n)) : 0;

export function makeCollectionLevel(mode, index = 0) {
  if (!Object.hasOwn(COLLECTION_LEVELS, mode) || !Number.isInteger(index) || index < 0 || index > 2) throw new Error("Unknown collection stage");
  const orchard = mode === "catcher";
  const layouts = [
    [[-4, -4, 3, 3], [4, -4, 3, 3], [-4, 4, 3, 3], [4, 4, 3, 3]],
    [[-6, -6, 3.2, 3.2], [0, -6, 3.2, 3.2], [6, -6, 3.2, 3.2], [-6, 2, 3.2, 3.2], [0, 2, 3.2, 3.2], [6, 2, 3.2, 3.2]],
    [[-5, -5, 4, 4], [5, -5, 4, 4], [-5, 5, 4, 4], [5, 5, 4, 4], [0, 0, 3, 3]]
  ];
  const ring = [[-9, -9], [-3, -9], [3, -9], [9, -9], [9, -3], [9, 3], [9, 9], [3, 9], [-3, 9], [-9, 9], [-9, 3], [-9, -3]];
  const inner = index === 1 ? [[-3, -3], [3, -3], [-3, 5], [3, 5]] : [[0, -5], [0, 5], [-5, 0], [5, 0]];
  const duration = orchard ? 75 - index * 5 : 120 - index * 10;
  const dropPoints = [[0, 0], [4, 0], [4, 4], [0, 4], [-4, 4], [-4, 0], [-4, -4], [0, -4], [4, -4]];
  const interval = 1.8 - index * 0.2;
  return {
    mode, index, title: orchard ? "Apple Drop 3D" : "Coin Dash 3D", name: COLLECTION_LEVELS[mode][index], duration,
    spawn: { x: 0, y: 0.7, z: orchard ? 6 : 9 }, target: orchard ? 16 + index * 6 : 16,
    obstacles: orchard ? [] : layouts[index].map(([x, z, w, d], i) => ({ x, z, w, d, h: 2.8 + (i % 3) * 0.35 })),
    coins: orchard ? [] : [...ring, ...inner].map(([x, z]) => ({ x, y: 0.8, z })),
    shields: orchard ? [] : [{ x: -9, y: 0.8, z: 0 }, { x: 9, y: 0.8, z: 0 }],
    enemies: orchard ? [] : [{ x: -9, y: 0.6, z: -9 }, ...(index > 0 ? [{ x: 9, y: 0.6, z: -9 }] : [])],
    drops: orchard ? Array.from({ length: Math.floor((duration - 4) / interval) }, (_, i) => {
      const point = dropPoints[i % dropPoints.length];
      return { id: i, x: point[0], z: point[1], at: 1 + i * interval, kind: i % (index === 2 ? 4 : 5) === 3 ? "rock" : "apple" };
    }) : []
  };
}

export function makeNavigation(level) {
  const grid = new PF.Grid(23, 23);
  for (let z = 0; z < 23; z++) for (let x = 0; x < 23; x++) {
    if (level.obstacles.some(b => Math.abs(x - 11 - b.x) < b.w / 2 + 0.7 && Math.abs(z - 11 - b.z) < b.d / 2 + 0.7)) grid.setWalkableAt(x, z, false);
  }
  const cell = point => {
    const x = Math.max(0, Math.min(22, Math.round(point.x + 11))), z = Math.max(0, Math.min(22, Math.round(point.z + 11)));
    if (grid.isWalkableAt(x, z)) return [x, z];
    let best = null, bestDistance = Infinity;
    for (let row = 0; row < 23; row++) for (let col = 0; col < 23; col++) {
      const d = Math.hypot(col - x, row - z);
      if (grid.isWalkableAt(col, row) && d < bestDistance) { best = [col, row]; bestDistance = d; }
    }
    return best;
  };
  const finder = new PF.AStarFinder({ allowDiagonal: true, dontCrossCorners: true });
  return (from, to) => {
    const a = cell(from), b = cell(to);
    return finder.findPath(a[0], a[1], b[0], b[1], grid.clone()).map(([x, z]) => ({ x: x - 11, z: z - 11 }));
  };
}

export async function createCollectionSimulation(mode, index = 0) {
  const level = makeCollectionLevel(mode, index), orchard = mode === "catcher";
  ready ||= RAPIER.init().catch(error => { ready = null; throw error; });
  await ready;
  const world = new RAPIER.World({ x: 0, y: -22, z: 0 }); world.timestep = STEP;
  const fixedBox = (x, y, z, w, h, d) => world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x, y, z));
  fixedBox(0, -0.5, 0, 24, 1, 24);
  for (const side of [-1, 1]) { fixedBox(side * 12, 2, 0, 0.5, 4, 24); fixedBox(0, 2, side * 12, 24, 4, 0.5); }
  for (const b of level.obstacles) fixedBox(b.x, b.h / 2, b.z, b.w, b.h, b.d);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(level.spawn.x, level.spawn.y, level.spawn.z));
  const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(0.42, 0.45, 0.42), body);
  const controller = world.createCharacterController(0.025); controller.enableSnapToGround(0.2);
  const sensor = (desc, parent) => world.createCollider(desc.setSensor(true).setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL), parent);
  const basket = orchard ? sensor(RAPIER.ColliderDesc.cuboid(0.7, 0.16, 0.7).setTranslation(0, 0.65, 0), body) : null;
  const coins = level.coins.map(p => sensor(RAPIER.ColliderDesc.ball(0.55).setTranslation(p.x, p.y, p.z)));
  const shields = level.shields.map(p => sensor(RAPIER.ColliderDesc.ball(0.6).setTranslation(p.x, p.y, p.z)));
  const enemies = level.enemies.map(p => {
    const enemyBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y, p.z));
    const enemyCollider = sensor(RAPIER.ColliderDesc.ball(0.55), enemyBody);
    const movement = world.createCharacterController(0.025); movement.enableSnapToGround(0.2);
    return { body: enemyBody, collider: enemyCollider, movement, path: [], nextPath: 0 };
  });
  const navigate = makeNavigation(level);
  const state = { elapsed: 0, status: "playing", lives: 3, score: 0, caught: 0, missed: 0, combo: 0, collected: new Set(), usedShields: new Set(),
    drops: [], enemies: level.enemies.map(p => ({ ...p })), grounded: false, velocityY: 0, invulnerable: 0, shield: 0, dash: 0, cooldown: 0, gateOpen: false };
  let disposed = false, wasJump = false, wasDash = false, nextDrop = 0;
  world.step();
  const damage = () => {
    if (disposed || state.status !== "playing" || state.invulnerable > 0 || state.shield > 0) return;
    state.lives--; state.invulnerable = 1.5; state.combo = 0;
    if (state.lives <= 0) state.status = "lost";
  };
  function step(input = {}) {
    if (disposed || state.status !== "playing") return state;
    state.elapsed += STEP;
    for (const timer of ["invulnerable", "shield", "dash", "cooldown"]) state[timer] = Math.max(0, state[timer] - STEP);
    if (input.jump && !wasJump && state.grounded) { state.velocityY = 8; state.grounded = false; }
    if (!orchard && input.dash && !wasDash && state.cooldown === 0) { state.dash = 0.4; state.cooldown = 4; }
    wasJump = Boolean(input.jump); wasDash = Boolean(input.dash);
    state.velocityY = Math.max(-25, state.velocityY - 22 * STEP);
    const x = axis(input.x), z = axis(input.z), length = Math.max(1, Math.hypot(x, z)), speed = state.dash > 0 ? 13 : 7.4;
    const desired = { x: x / length * speed * STEP, y: state.velocityY * STEP, z: z / length * speed * STEP };
    controller.computeColliderMovement(collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    const delta = controller.computedMovement(), pos = body.translation();
    body.setNextKinematicTranslation({ x: pos.x + delta.x, y: pos.y + delta.y, z: pos.z + delta.z });
    state.grounded = controller.computedGrounded();
    if ((state.grounded && state.velocityY < 0) || (state.velocityY > 0 && delta.y < desired.y - 0.001)) state.velocityY = 0;
    for (const enemy of enemies) {
      const p = enemy.body.translation();
      if (state.elapsed >= enemy.nextPath) {
        enemy.path = navigate(p, pos);
        if (enemy.path.length > 1 && distance(p, enemy.path[0]) < 0.75) enemy.path.shift();
        enemy.nextPath = state.elapsed + 0.4;
      }
      while (enemy.path.length && distance(p, enemy.path[0]) < 0.25) enemy.path.shift();
      const target = enemy.path[0] || pos, d = Math.max(1, distance(p, target));
      enemy.movement.computeColliderMovement(enemy.collider, { x: (target.x - p.x) / d * (3.2 + index * 0.55) * STEP, y: -0.15, z: (target.z - p.z) / d * (3.2 + index * 0.55) * STEP }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, candidate => candidate.handle !== collider.handle);
      const m = enemy.movement.computedMovement(); enemy.body.setNextKinematicTranslation({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z });
    }
    while (nextDrop < level.drops.length && state.elapsed >= level.drops[nextDrop].at) state.drops.push({ ...level.drops[nextDrop++], phase: "warning", y: 8, body: null, collider: null });
    for (const drop of state.drops) if (!drop.body && state.elapsed >= drop.at + 1.1) {
      drop.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(drop.x, 8, drop.z).setGravityScale(0.25));
      drop.collider = sensor(RAPIER.ColliderDesc.ball(drop.kind === "rock" ? 0.45 : 0.35), drop.body); drop.phase = "falling";
    }
    world.step();
    state.enemies = enemies.map(e => ({ ...e.body.translation() }));
    coins.forEach((coin, i) => { if (!state.collected.has(i) && world.intersectionPair(collider, coin)) { state.collected.add(i); state.score += 5; } });
    shields.forEach((shield, i) => { if (!state.usedShields.has(i) && world.intersectionPair(collider, shield)) { state.usedShields.add(i); state.shield = 5; } });
    if (enemies.some(e => world.intersectionPair(collider, e.collider))) damage();
    for (const drop of state.drops) {
      if (!drop.body) continue;
      drop.y = drop.body.translation().y;
      const touches = world.intersectionPair(basket, drop.collider) || world.intersectionPair(collider, drop.collider);
      if (touches || drop.y < 0.25) {
        if (touches && drop.kind === "apple") { state.caught++; state.combo++; state.score += 1 + Math.floor(Math.min(10, state.combo) / 5); }
        else if (touches) damage();
        else if (drop.kind === "apple") { state.missed++; state.combo = 0; }
        world.removeRigidBody(drop.body); drop.phase = "done";
      }
    }
    state.drops = state.drops.filter(drop => drop.phase !== "done");
    if (body.translation().y < -5) { damage(); body.setTranslation(level.spawn, true); body.setNextKinematicTranslation(level.spawn); state.velocityY = 0; }
    if (state.status !== "playing") return state;
    state.gateOpen = !orchard && state.collected.size === level.coins.length;
    if ((orchard && state.caught >= level.target) || (state.gateOpen && distance(body.translation(), level.spawn) < 1.2)) { state.status = "won"; state.score += Math.max(0, Math.ceil((level.duration - state.elapsed) / 5)); }
    else if (state.elapsed >= level.duration) state.status = "lost";
    return state;
  }
  return { level, state, world, body, collider, step, damage, dispose() { if (!disposed) { disposed = true; world.free(); } } };
}
