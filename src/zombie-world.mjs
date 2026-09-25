import RAPIER from "@dimforge/rapier3d-compat";
import PF from "pathfinding";

export const STEP = 1 / 60;
export const STOPS = [
  { name: "Service Station", z: 0, enemies: 4, color: "#428b7d", shops: ["FUEL & REPAIRS", "ROADSIDE SUPPLY"] },
  { name: "Pinewood Town", z: -100, enemies: 6, color: "#b6825f", shops: ["PINEWOOD MARKET", "RANGER OUTPOST"] },
  { name: "Quarantine Crossing", z: -200, enemies: 7, color: "#8193a1", shops: ["FIELD HOSPITAL", "LAST CHECKPOINT"] }
];
const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v) || 0));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
let ready;

export function normalizeCheckpoint(value) {
  const data = value?.version === 1 ? value : {};
  const level = Math.floor(clamp(data.level ?? 1, 1, 10));
  const armor = Math.floor(clamp(data.armor, 0, 2));
  return {
    version: 1, stopIndex: Math.floor(clamp(data.stopIndex, 0, 2)), level,
    xp: clamp(data.xp, 0, level * 40 - 1), health: clamp(data.health ?? 100, 1, 100 + (level - 1) * 15),
    armor, busHealth: clamp(data.busHealth ?? 140, 1, 140 + armor * 40), fuel: clamp(data.fuel ?? 40, 0, 100),
    scrap: Math.floor(clamp(data.scrap, 0, 999)), ammo: Math.floor(clamp(data.ammo ?? 72, 0, 600)),
    medkits: Math.floor(clamp(data.medkits ?? 2, 0, 20)), weapon: data.weapon === 1 ? 1 : 0,
    kills: Math.floor(clamp(data.kills, 0, 99)), score: Math.floor(clamp(data.score, 0, 99999))
  };
}

export function makeRoad() {
  const walls = [], buildings = [];
  STOPS.forEach((stop, index) => {
    [-1, 1].forEach((side, shop) => {
      const x = side * 17, z = stop.z - 8;
      buildings.push({ x, z, side, color: stop.color, name: stop.shops[shop], stopIndex: index });
      const box = (bx, bz, w, d) => walls.push({ x: bx, y: 2, z: bz, w, h: 4, d });
      box(x, z - 5, 12, 0.5); box(x - 6, z, 0.5, 10); box(x + 6, z, 0.5, 10);
      // The street-facing facade has a generous real doorway, not a painted entrance.
      box(x - 4.5, z + 5, 3, 0.5); box(x + 4.5, z + 5, 3, 0.5);
    });
  });
  walls.push({ x: -30, y: 2, z: -140, w: 1, h: 4, d: 370 }, { x: 30, y: 2, z: -140, w: 1, h: 4, d: 370 });
  return { walls, buildings };
}

export async function createZombieSimulation(saved) {
  ready ||= RAPIER.init().catch(error => { ready = null; throw error; });
  await ready;
  const initial = normalizeCheckpoint(saved);
  const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
  world.timestep = STEP;
  const road = makeRoad();
  world.createCollider(RAPIER.ColliderDesc.cuboid(31, 0.5, 190).setTranslation(0, -0.5, -145));
  for (const wall of road.walls) world.createCollider(RAPIER.ColliderDesc.cuboid(wall.w / 2, wall.h / 2, wall.d / 2).setTranslation(wall.x, wall.y, wall.z));
  const makeActor = (x, z, radius = 0.35) => {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, 0.95, z));
    const collider = world.createCollider(RAPIER.ColliderDesc.capsule(0.5, radius), body);
    const controller = world.createCharacterController(0.025);
    controller.enableSnapToGround(0.2);
    return { body, collider, controller };
  };
  const player = makeActor(4, 9);
  const bus = {
    body: world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1.5, 8)),
    yaw: 0, speed: 0, wheels: 0
  };
  bus.collider = world.createCollider(RAPIER.ColliderDesc.cuboid(1.65, 1.45, 4.2), bus.body);
  bus.controller = world.createCharacterController(0.04);
  const state = {
    ...initial, status: "playing", elapsed: 0, inBus: false, fuelFound: false,
    magazine: 12, reload: 0, shotCooldown: 0, meleeCooldown: 0, damageFlash: 0, aim: { x: 0, z: -1 },
    maxHealth: 100 + (initial.level - 1) * 15, maxBusHealth: 140 + initial.armor * 40,
    enemies: [], loot: [], events: [], stopCleared: false
  };
  let disposed = false, grid, checkpoint;
  const finder = new PF.AStarFinder({ allowDiagonal: true, dontCrossCorners: true });
  const emit = (type, message, extra = {}) => state.events.push({ type, message, ...extra });
  const position = () => state.inBus ? bus.body.translation() : player.body.translation();
  function teleport(actor, point) { actor.body.setTranslation(point, true); actor.body.setNextKinematicTranslation(point); }
  function saveCheckpoint() {
    checkpoint = normalizeCheckpoint(state);
    emit("checkpoint", "Checkpoint saved", { checkpoint: { ...checkpoint } });
  }
  function populateStop(index, save = true) {
    for (const enemy of state.enemies) { world.removeCharacterController(enemy.controller); world.removeRigidBody(enemy.body); }
    state.stopIndex = index; state.inBus = false; state.fuelFound = state.stopCleared = false;
    state.reload = 0; state.magazine = 12;
    player.collider.setEnabled(true);
    const stop = STOPS[index];
    teleport(player, { x: 4, y: 0.95, z: stop.z + 9 });
    teleport(bus, { x: 0, y: 1.5, z: stop.z + 8 });
    bus.yaw = bus.speed = 0; bus.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    const spawns = [[-9, -3], [10, -14], [-17, -10], [17, -9], [-8, -23], [8, -28], [0, -33]];
    state.enemies = spawns.slice(0, stop.enemies).map(([x, z], i) => {
      const boss = index === 2 && i === stop.enemies - 1;
      return { ...makeActor(x, stop.z + z, boss ? 0.6 : 0.35), id: `${index}-${i}`, boss, hp: boss ? 240 : 48 + index * 8,
        maxHp: boss ? 240 : 48 + index * 8, attack: 0, pathTimer: i * 0.11, path: [], yaw: 0, flash: 0 };
    });
    state.loot = [
      { id: "fuel", kind: "Fuel cache", x: -17, z: stop.z - 10, color: "#d0b261" },
      { id: "supplies", kind: "Supply crate", x: 17, z: stop.z - 10, color: "#659caf" },
      { id: "scrap", kind: "Salvage", x: -9, z: stop.z + 10, color: "#a38cc6" }
    ].map(item => ({ ...item, taken: false }));
    grid = new PF.Grid(64, 64);
    for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++) {
      const px = x - 32, pz = z + stop.z - 40;
      if (Math.abs(px) > 28 || road.walls.some(w => Math.abs(px - w.x) < w.w / 2 + 0.7 && Math.abs(pz - w.z) < w.d / 2 + 0.7)) grid.setWalkableAt(x, z, false);
    }
    world.step();
    if (save) saveCheckpoint();
    emit("stop", stop.name);
  }
  populateStop(initial.stopIndex);

  function objective() {
    const alive = state.enemies.filter(e => e.hp > 0).length;
    if (state.status === "won") return "Safe Haven reached";
    if (state.status === "lost") return state.health <= 0 ? "Survivor down" : "Bus destroyed";
    if (alive || !state.fuelFound) return `${alive} infected remaining / Fuel ${state.fuelFound ? "secured" : "missing"}`;
    return `Drive to ${STOPS[state.stopIndex + 1]?.name || "Safe Haven"}`;
  }
  function prompt() {
    if (state.status !== "playing") return null;
    if (state.inBus) return { action: "exit", text: Math.abs(bus.speed) > 1 ? "Bus moving" : "Exit bus" };
    const pos = player.body.translation();
    const item = state.loot.find(item => !item.taken && distance(pos, item) < 2.4);
    if (item) return { action: item.id, text: item.kind };
    if (distance(pos, bus.body.translation()) < 6.8) return { action: "board", text: "Board bus" };
    return null;
  }
  function interact() {
    const target = prompt();
    if (!target) return false;
    if (target.action === "exit") {
      if (Math.abs(bus.speed) > 1) { emit("notice", "Stop the bus before exiting"); return false; }
      const b = bus.body.translation();
      // Reject obstructed exits using the same collider shape as the survivor.
      for (const side of [1, -1]) {
        const point = { x: b.x + Math.cos(bus.yaw) * 3.2 * side, y: 0.95, z: b.z - Math.sin(bus.yaw) * 3.2 * side };
        if (world.intersectionWithShape(point, { x: 0, y: 0, z: 0, w: 1 }, player.collider.shape, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, player.collider)) continue;
        state.inBus = false; player.collider.setEnabled(true); teleport(player, point); emit("notice", "On foot"); return true;
      }
      emit("notice", "Exit blocked. Move the bus to open ground."); return false;
    }
    if (target.action === "board") {
      state.inBus = true; state.reload = 0; player.collider.setEnabled(false); emit("notice", "Bus boarded"); return true;
    }
    const item = state.loot.find(item => item.id === target.action);
    item.taken = true;
    if (item.id === "fuel") { state.fuel = Math.min(100, state.fuel + 45); state.fuelFound = true; state.scrap += 10; }
    if (item.id === "supplies") { state.ammo += 48; state.medkits += 1; state.scrap += 10; }
    if (item.id === "scrap") state.scrap += 16;
    state.score += 50;
    emit("loot", item.id === "fuel" ? "+45 fuel / +10 scrap" : item.id === "supplies" ? "+48 ammo / +1 medkit / +10 scrap" : "+16 scrap");
    return true;
  }
  function purchase(action) {
    if (state.status !== "playing") return false;
    if (action === "heal") {
      if (!state.medkits || state.health >= state.maxHealth) return false;
      state.medkits--; state.health = Math.min(state.maxHealth, state.health + 60); emit("notice", "+60 health"); return true;
    }
    if (!state.inBus && distance(player.body.translation(), bus.body.translation()) > 7) { emit("notice", "Return to the bus for workshop upgrades"); return false; }
    const offers = { repair: [8, () => state.busHealth < state.maxBusHealth], armor: [18, () => state.armor < 2], weapon: [22, () => !state.weapon], refuel: [5, () => state.fuel < 100], ammo: [5, () => state.ammo < 300] };
    const offer = offers[action];
    if (!offer || state.scrap < offer[0] || !offer[1]()) return false;
    state.scrap -= offer[0];
    if (action === "repair") state.busHealth = Math.min(state.maxBusHealth, state.busHealth + 50);
    if (action === "armor") { state.armor++; state.maxBusHealth += 40; state.busHealth += 40; }
    if (action === "weapon") state.weapon = 1;
    if (action === "refuel") state.fuel = Math.min(100, state.fuel + 35);
    if (action === "ammo") state.ammo += 36;
    emit("notice", "Workshop complete"); return true;
  }
  function damageEnemy(enemy, amount) {
    if (!enemy || enemy.hp <= 0) return;
    enemy.hp = Math.max(0, enemy.hp - amount); enemy.flash = 0.12;
    emit("hit", "", { x: enemy.body.translation().x, z: enemy.body.translation().z });
    if (enemy.hp) return;
    enemy.collider.setEnabled(false); state.kills++; state.scrap += enemy.boss ? 24 : 5;
    state.xp += enemy.boss ? 80 : 20; state.score += enemy.boss ? 500 : 100;
    while (state.xp >= state.level * 40 && state.level < 10) {
      state.xp -= state.level * 40; state.level++; state.maxHealth += 15;
      state.health = Math.min(state.maxHealth, state.health + 30); emit("level", `Level ${state.level}`);
    }
  }
  function cast(origin, direction, length) {
    return world.castRay(new RAPIER.Ray(origin, direction), length, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, player.collider);
  }
  function shoot() {
    if (state.inBus || state.reload > 0 || state.shotCooldown > 0) return;
    if (state.magazine <= 0) { reload(); return; }
    state.magazine--; state.shotCooldown = state.weapon ? 0.15 : 0.28;
    const p = player.body.translation(), origin = { x: p.x, y: 1.25, z: p.z };
    const dir = { ...state.aim, y: 0 };
    const hit = cast(origin, dir, 42);
    const length = hit?.timeOfImpact ?? 42;
    emit("shot", "", { from: origin, to: { x: origin.x + dir.x * length, y: 1.25, z: origin.z + dir.z * length } });
    if (hit) damageEnemy(state.enemies.find(e => e.collider.handle === hit.collider.handle), (state.weapon ? 32 : 24) + (state.level - 1) * 4);
  }
  function reload() {
    if (state.inBus || state.reload || state.magazine === 12 || !state.ammo) return false;
    state.reload = 1.25; return true;
  }
  function melee() {
    if (state.inBus || state.meleeCooldown > 0) return;
    state.meleeCooldown = 0.65;
    const p = player.body.translation();
    const enemy = state.enemies.filter(e => e.hp > 0 && distance(p, e.body.translation()) < 2.5)
      .sort((a, b) => distance(p, a.body.translation()) - distance(p, b.body.translation()))[0];
    emit("melee", "");
    if (!enemy) return;
    const target = enemy.body.translation(), len = Math.max(0.01, distance(p, target));
    const hit = cast({ x: p.x, y: 1.25, z: p.z }, { x: (target.x - p.x) / len, y: 0, z: (target.z - p.z) / len }, 2.5);
    if (hit?.collider.handle === enemy.collider.handle) damageEnemy(enemy, 25 + state.level * 3);
  }
  function move(actor, x, z, filter) {
    actor.controller.computeColliderMovement(actor.collider, { x, y: -0.15, z }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, filter);
    const p = actor.body.translation(), delta = actor.controller.computedMovement();
    actor.body.setNextKinematicTranslation({ x: p.x + delta.x, y: p.y + delta.y, z: p.z + delta.z });
    return delta;
  }
  function step(input = {}) {
    if (disposed || state.status !== "playing") return state;
    state.elapsed += STEP;
    for (const key of ["shotCooldown", "meleeCooldown", "damageFlash"]) state[key] = Math.max(0, state[key] - STEP);
    if (state.reload > 0) {
      state.reload = Math.max(0, state.reload - STEP);
      if (!state.reload) { const amount = Math.min(12 - state.magazine, state.ammo); state.ammo -= amount; state.magazine += amount; }
    }
    if (input.aim && Number.isFinite(input.aim.x) && Number.isFinite(input.aim.z)) {
      const len = Math.hypot(input.aim.x, input.aim.z);
      if (len > 0.01) state.aim = { x: input.aim.x / len, z: input.aim.z / len };
    }
    if (input.interact) interact();
    if (input.reload) reload();
    if (input.heal) purchase("heal");
    if (input.shoot) shoot();
    if (input.melee) melee();
    if (state.inBus) {
      const throttle = clamp(input.throttle, -1, 1), steer = clamp(input.steer, -1, 1);
      const targetSpeed = state.fuel > 0 ? throttle * (throttle < 0 ? 6 : 18) : 0;
      bus.speed += Math.max(-0.22, Math.min(0.22, targetSpeed - bus.speed));
      bus.yaw = clamp(bus.yaw - steer * bus.speed * 0.002, -0.55, 0.55);
      const b = bus.body.translation();
      bus.body.setNextKinematicRotation({ x: 0, y: Math.sin(bus.yaw / 2), z: 0, w: Math.cos(bus.yaw / 2) });
      const dx = -Math.sin(bus.yaw) * bus.speed * STEP, dz = -Math.cos(bus.yaw) * bus.speed * STEP;
      const lower = state.fuelFound && state.enemies.every(e => e.hp <= 0) ? -310 : STOPS[state.stopIndex].z - 28;
      const moved = move(bus, Math.max(-26 - b.x, Math.min(26 - b.x, dx)), Math.max(lower - b.z, Math.min(STOPS[state.stopIndex].z + 18 - b.z, dz)));
      state.fuel = Math.max(0, state.fuel - Math.hypot(moved.x, moved.z) * 0.19);
      bus.wheels += bus.speed * STEP;
      if (b.z <= lower + 0.1 && lower !== -310 && throttle > 0 && state.elapsed % 2 < STEP) emit("notice", "Secure the fuel and clear this stop first");
    } else {
      const x = clamp(input.x, -1, 1), z = clamp(input.z, -1, 1), length = Math.max(1, Math.hypot(x, z));
      const p = player.body.translation(), stop = STOPS[state.stopIndex];
      const forwardLimit = Math.min(stop.z - 39, bus.body.translation().z - 18);
      move(player, x / length * 6.5 * STEP, Math.max(forwardLimit - p.z, Math.min(stop.z + 21 - p.z, z / length * 6.5 * STEP)));
    }
    const target = position();
    for (const enemy of state.enemies) {
      if (enemy.hp <= 0) continue;
      enemy.attack = Math.max(0, enemy.attack - STEP); enemy.flash = Math.max(0, enemy.flash - STEP);
      const p = enemy.body.translation(), len = distance(p, target);
      let range = len;
      if (state.inBus) {
        const dx = p.x - target.x, dz = p.z - target.z;
        const localX = Math.cos(bus.yaw) * dx - Math.sin(bus.yaw) * dz;
        const localZ = Math.sin(bus.yaw) * dx + Math.cos(bus.yaw) * dz;
        range = Math.hypot(Math.max(0, Math.abs(localX) - 1.65), Math.max(0, Math.abs(localZ) - 4.2));
      }
      if (range < (state.inBus ? 1 : 1.55)) {
        if (!enemy.attack) {
          const direction = { x: (target.x - p.x) / Math.max(len, 0.01), y: 0, z: (target.z - p.z) / Math.max(len, 0.01) };
          const hit = world.castRay(new RAPIER.Ray({ x: p.x, y: 1.25, z: p.z }, direction), len, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, enemy.collider);
          if (hit?.collider.handle !== (state.inBus ? bus.collider.handle : player.collider.handle)) continue;
          enemy.attack = enemy.boss ? 1.15 : 1.35;
          if (state.inBus) state.busHealth -= enemy.boss ? 16 : 6;
          else { state.health -= enemy.boss ? 20 : 8; state.damageFlash = 0.2; }
        }
        continue;
      }
      if (len > 44) continue;
      enemy.pathTimer -= STEP;
      if (enemy.pathTimer <= 0) {
        enemy.pathTimer = 0.7;
        const cell = point => [Math.floor(clamp(Math.round(point.x + 32), 0, 63)), Math.floor(clamp(Math.round(point.z - STOPS[state.stopIndex].z + 40), 0, 63))];
        const [sx, sz] = cell(p), [tx, tz] = cell(target), working = grid.clone();
        working.setWalkableAt(sx, sz, true); working.setWalkableAt(tx, tz, true);
        enemy.path = finder.findPath(sx, sz, tx, tz, working).slice(1).map(([x, z]) => ({ x: x - 32, z: z + STOPS[state.stopIndex].z - 40 }));
      }
      while (enemy.path.length && distance(p, enemy.path[0]) < 0.6) enemy.path.shift();
      const goal = enemy.path[0] || target, dx = goal.x - p.x, dz = goal.z - p.z, d = Math.hypot(dx, dz) || 1;
      const speed = enemy.boss ? 2.1 : 2.5 + state.stopIndex * 0.15;
      enemy.yaw = Math.atan2(-dx, -dz);
      move(enemy, dx / d * speed * STEP, dz / d * speed * STEP);
    }
    world.step();
    if (state.health <= 0 || state.busHealth <= 0) {
      state.status = "lost"; state.health = Math.max(0, state.health); state.busHealth = Math.max(0, state.busHealth); emit("finish", objective());
    } else if (state.inBus && state.fuelFound && state.enemies.every(e => e.hp <= 0)) {
      if (!state.stopCleared) { state.stopCleared = true; emit("notice", "Route clear"); }
      const nextZ = STOPS[state.stopIndex + 1]?.z ?? -300;
      if (bus.body.translation().z <= nextZ + 8) {
        if (state.stopIndex < 2) { state.score += 250; populateStop(state.stopIndex + 1); }
        else { state.status = "won"; state.score += 1000 + Math.round(state.busHealth); emit("finish", "Safe Haven reached"); }
      }
    }
    return state;
  }
  return {
    state, world, player, bus, road, step, interact, purchase, reload, objective, prompt, position,
    checkpoint: () => ({ ...checkpoint }),
    dispose() { if (!disposed) { disposed = true; world.free(); } }
  };
}
