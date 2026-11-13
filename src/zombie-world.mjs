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

export const ROUTE_BOSSES = Object.freeze([
  { name: "Scrapyard Bruiser", attackName: "Ground Slam", kind: "slam", hp: 160, windup: 1.5, recovery: 2.6, range: 4.5, radius: 4.2, damage: 20, busDamage: 16, color: "#e7b16b" },
  { name: "Pinewood Howler", attackName: "Spore Barrage", kind: "blast", hp: 220, windup: 1.8, recovery: 3.2, range: 22, radius: 3.4, damage: 24, busDamage: 18, color: "#b3ce79" },
  { name: "Quarantine Warden", attackName: "Siege Charge", kind: "charge", hp: 320, windup: 1.6, recovery: 2.8, range: 11, radius: 1.8, damage: 30, busDamage: 24, color: "#ca9edc" }
]);
export const ROUTE_UPGRADES = Object.freeze([
  { id: "reinforced", name: "Fortified Chassis", description: "+50 bus capacity, repair 80, 12% less bus damage per tier" },
  { id: "overdrive", name: "Weapon Overdrive", description: "+6 shot and melee damage, faster reload, +36 team ammo" },
  { id: "field-medic", name: "Field Medic", description: "+20 survivor capacity, heal 50 each, +2 team medkits" }
]);
const LOOT_IDS = ["fuel", "supplies", "scrap", "spares", "emergency"];
export function normalizeRouteUpgrades(value, stopIndex = 2, stopCleared = true) {
  return Array.from({ length: 3 }, (_, index) => index <= stopIndex && (index < stopIndex || stopCleared) &&
    Array.isArray(value) && ROUTE_UPGRADES.some(item => item.id === value[index]) ? value[index] : null);
}
export function routeUpgradeStats(value) {
  const choices = normalizeRouteUpgrades(value);
  const count = id => choices.filter(choice => choice === id).length;
  return { busCapacity: count("reinforced") * 50, busResistance: count("reinforced") * 0.12,
    damage: count("overdrive") * 6, reload: 1.25 - count("overdrive") * 0.15, health: count("field-medic") * 20 };
}
// The host/simulation owns this transition; neither client stats nor rewards are accepted.
export function claimRouteUpgrade(state, id, stopIndex, survivors) {
  if (state.status !== "playing" || !Number.isInteger(stopIndex) || stopIndex !== state.stopIndex || !state.stopCleared ||
      stopIndex < 0 || stopIndex >= STOPS.length || !Array.isArray(state.routeUpgrades) ||
      state.routeUpgrades[stopIndex] || !ROUTE_UPGRADES.some(item => item.id === id)) return false;
  state.routeUpgrades[stopIndex] = id;
  if (id === "reinforced") { state.maxBusHealth += 50; state.busHealth = Math.min(state.maxBusHealth, state.busHealth + 80); }
  if (id === "overdrive") state.ammo = Math.min(600, state.ammo + 36);
  if (id === "field-medic") {
    state.medkits = Math.min(20, state.medkits + 2);
    for (const survivor of survivors) {
      survivor.maxHealth += 20;
      if (survivor.health > 0) survivor.health = Math.min(survivor.maxHealth, survivor.health + 50);
    }
  }
  state.fuel = Math.min(100, state.fuel + 20);
  return true;
}
export function bossState(stopIndex, teamSize = 1) {
  const spec = ROUTE_BOSSES[stopIndex], maxHp = spec.hp + Math.max(0, Math.min(4, teamSize - 1)) * 45;
  return { boss: true, bossName: spec.name, hp: maxHp, maxHp, bossPhase: "advance", bossTimer: 1.5, bossCycle: 0, telegraph: null };
}
export function normalizeBossTelegraph(value, stopIndex) {
  const spec = ROUTE_BOSSES[stopIndex];
  if (!spec || !value || ![value.x, value.z, value.dx, value.dz].every(Number.isFinite) ||
      Math.abs(value.x) > 29 || value.z < STOPS[stopIndex].z - 45 || value.z > STOPS[stopIndex].z + 24) return null;
  const length = Math.hypot(value.dx, value.dz);
  return { x: value.x, z: value.z, dx: length > 0.01 ? value.dx / length : 0, dz: length > 0.01 ? value.dz / length : -1,
    radius: spec.radius, length: spec.kind === "charge" ? 11 : 0, kind: spec.kind };
}
export function bossZoneContains(zone, point, padding = 0.35) {
  if (!zone) return false;
  if (zone.kind !== "charge") return distance(zone, point) <= zone.radius + padding;
  const x = point.x - zone.x, z = point.z - zone.z, along = x * zone.dx + z * zone.dz;
  return along >= -padding && along <= zone.length + padding && Math.abs(x * zone.dz - z * zone.dx) <= zone.radius + padding;
}
export function bossZoneHitsBus(zone, point, yaw = 0) {
  for (const x of [-1.65, 0, 1.65]) for (const z of [-4.2, -2.1, 0, 2.1, 4.2]) {
    if (bossZoneContains(zone, { x: point.x + Math.cos(yaw) * x + Math.sin(yaw) * z,
      z: point.z - Math.sin(yaw) * x + Math.cos(yaw) * z }, 0)) return true;
  }
  return false;
}
// Shared deterministic telegraphs; physics, line-of-sight and damage stay with the owning world.
export function stepRouteBoss(enemy, { stopIndex, dt, position, busPosition, survivors, move, strike, emit }) {
  const spec = ROUTE_BOSSES[stopIndex];
  if (enemy.hp <= 0) { enemy.bossPhase = "defeated"; enemy.telegraph = null; return true; }
  const remaining = enemy.bossTimer;
  enemy.bossTimer = Math.max(0, enemy.bossTimer - dt);
  if (enemy.bossPhase === "windup") {
    if (enemy.bossTimer > 0) return true;
    enemy.bossPhase = "strike"; enemy.bossTimer = spec.kind === "charge" ? 0.5 : 0.22; enemy.bossHits = new Set();
    emit("boss-strike", `${spec.name}: ${spec.attackName}`, { x: position.x, z: position.z });
    return true;
  }
  if (enemy.bossPhase === "strike") {
    if (spec.kind === "charge") move(enemy.telegraph.dx * 22 * Math.min(dt, remaining), enemy.telegraph.dz * 22 * Math.min(dt, remaining));
    strike(enemy.telegraph, spec, enemy.bossHits);
    if (!enemy.bossTimer) { enemy.bossPhase = "recover"; enemy.bossTimer = spec.recovery; enemy.telegraph = null; }
    return true;
  }
  if (enemy.bossPhase === "recover") {
    if (enemy.bossTimer) return true;
    enemy.bossPhase = "advance";
  }
  if (enemy.bossTimer || distance(position, busPosition) > spec.range + 2.5) return false;
  const nearest = survivors.filter(p => distance(position, p) < spec.range).sort((a, b) => distance(position, a) - distance(position, b))[0];
  const target = enemy.bossCycle % 2 && nearest ? nearest : busPosition;
  const origin = spec.kind === "blast" ? target : position, dx = target.x - position.x, dz = target.z - position.z, len = Math.hypot(dx, dz) || 1;
  enemy.telegraph = normalizeBossTelegraph({ x: origin.x, z: origin.z, dx: dx / len, dz: dz / len }, stopIndex);
  if (!enemy.telegraph) return false;
  enemy.bossCycle++; enemy.bossPhase = "windup"; enemy.bossTimer = spec.windup;
  enemy.yaw = Math.atan2(-dx, -dz);
  emit("boss-warning", `${spec.name}: ${spec.attackName} incoming`, { x: origin.x, z: origin.z });
  return true;
}

export function normalizeCheckpoint(value) {
  const data = value?.version === 1 || value?.version === 2 ? value : {};
  const stopIndex = Math.floor(clamp(data.stopIndex, 0, 2)), stopCleared = data.version === 2 && data.stopCleared === true;
  const routeUpgrades = normalizeRouteUpgrades(data.version === 2 ? data.routeUpgrades : [], stopIndex, stopCleared);
  const bonuses = routeUpgradeStats(routeUpgrades);
  const level = Math.floor(clamp(data.level ?? 1, 1, 10));
  const armor = Math.floor(clamp(data.armor, 0, 2));
  return {
    version: 2, stopIndex, level, stopCleared, routeUpgrades,
    fuelFound: stopCleared && data.fuelFound === true,
    takenLoot: stopCleared && Array.isArray(data.takenLoot) ? LOOT_IDS.filter(id => data.takenLoot.includes(id)) : [],
    xp: clamp(data.xp, 0, level * 40 - 1), health: clamp(data.health ?? 100, 1, 100 + (level - 1) * 15 + bonuses.health),
    armor, busHealth: clamp(data.busHealth ?? 140, 1, 140 + armor * 40 + bonuses.busCapacity), fuel: clamp(data.fuel ?? 40, 0, 100),
    scrap: Math.floor(clamp(data.scrap, 0, 999)), ammo: Math.floor(clamp(data.ammo ?? 72, 0, 600)),
    medkits: Math.floor(clamp(data.medkits ?? 2, 0, 20)), weapon: data.weapon === 1 ? 1 : 0,
    kills: Math.floor(clamp(data.kills, 0, 99)), score: Math.floor(clamp(data.score, 0, 99999))
  };
}

export function makeRoad() {
  const walls = [], buildings = [];
  const styles = [["garage", "diner", "motel", "workshop"], ["market", "ranger", "bakery", "house"], ["clinic", "security", "warehouse", "radio"]];
  const extraNames = [["SUNSET MOTEL", "AUTO SALVAGE"], ["CORNER BAKERY", "PINEWOOD RESIDENCE"], ["RELIEF DEPOT", "RADIO CONTROL"]];
  STOPS.forEach((stop, index) => {
    [-1, 1, -1, 1].forEach((side, shop) => {
      const extra = shop > 1, x = side * (extra ? 20 : 17), z = stop.z - (extra ? 28 : 8), w = extra ? 10 : 12, d = extra ? 9 : 10;
      const id = `${index}-${shop}`;
      buildings.push({ id, x, z, w, d, side, color: stop.color, name: extra ? extraNames[index][shop - 2] : stop.shops[shop], kind: styles[index][shop], stopIndex: index });
      const box = (bx, bz, width, depth) => walls.push({ buildingId: id, x: bx, y: 2, z: bz, w: width, h: 4, d: depth });
      box(x, z - d / 2, w, 0.5); box(x - w / 2, z, 0.5, d); box(x + w / 2, z, 0.5, d);
      const facade = (w - 6) / 2;
      box(x - w / 2 + facade / 2, z + d / 2, facade, 0.5); box(x + w / 2 - facade / 2, z + d / 2, facade, 0.5);
    });
  });
  walls.push({ x: -30, y: 2, z: -140, w: 1, h: 4, d: 370 }, { x: 30, y: 2, z: -140, w: 1, h: 4, d: 370 });
  return { walls, buildings };
}

export async function createZombieSimulation(saved) {
  ready ||= RAPIER.init().catch(error => { ready = null; throw error; });
  await ready;
  const initial = normalizeCheckpoint(saved);
  const initialBonuses = routeUpgradeStats(initial.routeUpgrades);
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
    maxHealth: 100 + (initial.level - 1) * 15 + initialBonuses.health, maxBusHealth: 140 + initial.armor * 40 + initialBonuses.busCapacity,
    enemies: [], loot: [], events: [], stopCleared: false
  };
  let disposed = false, grid, checkpoint;
  const finder = new PF.AStarFinder({ allowDiagonal: true, dontCrossCorners: true });
  const emit = (type, message, extra = {}) => state.events.push({ type, message, ...extra });
  const position = () => state.inBus ? bus.body.translation() : player.body.translation();
  function teleport(actor, point) { actor.body.setTranslation(point, true); actor.body.setNextKinematicTranslation(point); }
  function saveCheckpoint() {
    checkpoint = normalizeCheckpoint({ ...state, takenLoot: state.loot.filter(item => item.taken).map(item => item.id) });
    emit("checkpoint", "Checkpoint saved", { checkpoint: normalizeCheckpoint(checkpoint) });
  }
  function populateStop(index, save = true) {
    for (const enemy of state.enemies) { world.removeCharacterController(enemy.controller); world.removeRigidBody(enemy.body); }
    state.stopIndex = index; state.inBus = false; state.fuelFound = state.stopCleared = false;
    state.reload = 0; state.magazine = 12;
    player.collider.setEnabled(true);
    const stop = STOPS[index];
    teleport(player, { x: 4, y: 0.95, z: stop.z + 9 });
    teleport(bus, { x: 0, y: 1.5, z: stop.z + 8 });
    bus.yaw = bus.speed = 0; bus.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true); bus.body.setNextKinematicRotation({ x: 0, y: 0, z: 0, w: 1 });
    const spawns = [[-9, -3], [10, -14], [-17, -10], [17, -9], [-8, -23], [8, -28], [0, -33]];
    state.enemies = spawns.slice(0, stop.enemies).map(([x, z], i) => {
      const boss = i === stop.enemies - 1;
      return { ...makeActor(boss ? 0 : x, stop.z + (boss ? -22 : z), boss ? 0.6 : 0.35), id: `${index}-${i}`, boss,
        hp: 48 + index * 8, maxHp: 48 + index * 8, ...(boss ? bossState(index) : {}), attack: 0, pathTimer: i * 0.11, path: [], yaw: 0, flash: 0 };
    });
    state.loot = [
      { id: "fuel", kind: "Fuel cache", x: -17, z: stop.z - 10, color: "#d0b261" },
      { id: "supplies", kind: "Supply crate", x: 17, z: stop.z - 10, color: "#659caf" },
      { id: "scrap", kind: "Salvage", x: -9, z: stop.z + 10, color: "#a38cc6" },
      { id: "spares", kind: "Spare parts", x: -20, z: stop.z - 29, color: "#9e87ba" },
      { id: "emergency", kind: "Emergency ammo", x: 20, z: stop.z - 29, color: "#729eae" }
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
  populateStop(initial.stopIndex, false);
  if (initial.stopCleared) {
    state.stopCleared = true; state.fuelFound = initial.fuelFound;
    for (const enemy of state.enemies) { enemy.hp = 0; enemy.collider.setEnabled(false); if (enemy.boss) enemy.bossPhase = "defeated"; }
    for (const item of state.loot) item.taken = initial.takenLoot.includes(item.id);
  }
  saveCheckpoint();

  function chooseUpgrade(id, stopIndex = state.stopIndex) {
    if (disposed || !claimRouteUpgrade(state, id, stopIndex, [state])) return false;
    saveCheckpoint(); emit("upgrade", `${ROUTE_UPGRADES.find(item => item.id === id).name} installed`); return true;
  }

  function objective() {
    const alive = state.enemies.filter(e => e.hp > 0).length;
    if (state.status === "won") return "Safe Haven reached";
    if (state.status === "lost") return state.health <= 0 ? "Survivor down" : "Bus destroyed";
    if (alive) return `Defend the bus / ${alive} infected remaining`;
    if (!state.routeUpgrades[state.stopIndex]) return "Stop secured / Choose a route upgrade";
    if (!state.fuelFound) return "Find the fuel cache before departing";
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
        state.inBus = false; player.collider.setEnabled(true); teleport(player, point); emit("door", "On foot"); return true;
      }
      emit("notice", "Exit blocked. Move the bus to open ground."); return false;
    }
    if (target.action === "board") {
      state.inBus = true; state.reload = 0; player.collider.setEnabled(false); emit("door", "Bus boarded"); return true;
    }
    const item = state.loot.find(item => item.id === target.action);
    item.taken = true;
    if (item.id === "fuel") { state.fuel = Math.min(100, state.fuel + 45); state.fuelFound = true; state.scrap += 10; }
    if (item.id === "supplies") { state.ammo += 48; state.medkits += 1; state.scrap += 10; }
    if (item.id === "scrap") state.scrap += 16;
    if (item.id === "spares") state.scrap += 8;
    if (item.id === "emergency") state.ammo += 12;
    state.score += 50;
    emit("loot", { fuel: "+45 fuel / +10 scrap", supplies: "+48 ammo / +1 medkit / +10 scrap", scrap: "+16 scrap", spares: "+8 scrap", emergency: "+12 ammo" }[item.id]);
    if (state.stopCleared) saveCheckpoint();
    return true;
  }
  function purchase(action) {
    if (state.status !== "playing") return false;
    if (action === "heal") {
      if (!state.medkits || state.health >= state.maxHealth) return false;
      state.medkits--; state.health = Math.min(state.maxHealth, state.health + 60); emit("heal", "+60 health");
      if (state.stopCleared) saveCheckpoint();
      return true;
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
    emit("upgrade", "Workshop complete"); if (state.stopCleared) saveCheckpoint(); return true;
  }
  function damageEnemy(enemy, amount) {
    if (!enemy || enemy.hp <= 0) return;
    enemy.hp = Math.max(0, enemy.hp - amount); enemy.flash = 0.12;
    emit("hit", "", { x: enemy.body.translation().x, z: enemy.body.translation().z });
    if (enemy.hp) return;
    emit("kill", "", { id: enemy.id, x: enemy.body.translation().x, z: enemy.body.translation().z });
    enemy.collider.setEnabled(false); if (enemy.boss) { enemy.bossPhase = "defeated"; enemy.telegraph = null; }
    state.kills++; state.scrap += enemy.boss ? 24 : 5;
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
    if (hit) damageEnemy(state.enemies.find(e => e.collider.handle === hit.collider.handle), (state.weapon ? 32 : 24) + (state.level - 1) * 4 + routeUpgradeStats(state.routeUpgrades).damage);
  }
  function reload() {
    if (state.inBus || state.reload || state.magazine === 12 || !state.ammo) return false;
    state.reload = routeUpgradeStats(state.routeUpgrades).reload; emit("reload", ""); return true;
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
    if (hit?.collider.handle === enemy.collider.handle) damageEnemy(enemy, 25 + state.level * 3 + routeUpgradeStats(state.routeUpgrades).damage);
  }
  function move(actor, x, z, filter) {
    actor.controller.computeColliderMovement(actor.collider, { x, y: -0.15, z }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, filter);
    const p = actor.body.translation(), delta = actor.controller.computedMovement();
    actor.body.setNextKinematicTranslation({ x: p.x + delta.x, y: p.y + delta.y, z: p.z + delta.z });
    return delta;
  }
  function bossStrike(enemy, zone, spec, hits) {
    const origin = enemy.body.translation(), busPos = bus.body.translation(), playerPos = player.body.translation();
    const visible = (actor, point) => {
      const len = distance(origin, point);
      if (len < 0.01) return true;
      const hit = world.castRay(new RAPIER.Ray({ x: origin.x, y: 1.25, z: origin.z }, { x: (point.x - origin.x) / len, y: 0, z: (point.z - origin.z) / len }), len + 0.5, true,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, enemy.collider, undefined,
        collider => collider.handle === actor.collider.handle || collider.handle === bus.collider.handle || !collider.parent());
      return hit?.collider.handle === actor.collider.handle;
    };
    if (!hits.has("bus") && bossZoneHitsBus(zone, busPos, bus.yaw) && (spec.kind !== "charge" || distance(origin, busPos) < 6.5) && visible(bus, busPos)) {
      hits.add("bus"); state.busHealth = Math.max(0, state.busHealth - spec.busDamage * (1 - routeUpgradeStats(state.routeUpgrades).busResistance));
      emit("hurt", "Bus under attack", { x: busPos.x, z: busPos.z });
    }
    if (!state.inBus && !hits.has("player") && bossZoneContains(zone, playerPos) && (spec.kind !== "charge" || distance(origin, playerPos) < 2.4) && visible(player, playerPos)) {
      hits.add("player"); state.health = Math.max(0, state.health - spec.damage); state.damageFlash = 0.2;
      emit("hurt", "", { x: playerPos.x, z: playerPos.z });
    }
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
      const lower = state.fuelFound && state.stopCleared && state.routeUpgrades[state.stopIndex] ? -310 : STOPS[state.stopIndex].z - 28;
      const moved = move(bus, Math.max(-26 - b.x, Math.min(26 - b.x, dx)), Math.max(lower - b.z, Math.min(STOPS[state.stopIndex].z + 18 - b.z, dz)));
      state.fuel = Math.max(0, state.fuel - Math.hypot(moved.x, moved.z) * 0.19);
      bus.wheels += bus.speed * STEP;
      if (b.z <= lower + 0.1 && lower !== -310 && throttle > 0 && state.elapsed % 2 < STEP) emit("notice", "Clear the stop, choose an upgrade and secure fuel first");
    } else {
      const x = clamp(input.x, -1, 1), z = clamp(input.z, -1, 1), length = Math.max(1, Math.hypot(x, z));
      const p = player.body.translation(), stop = STOPS[state.stopIndex];
      const forwardLimit = Math.min(stop.z - 39, bus.body.translation().z - 18);
      move(player, x / length * 6.5 * STEP, Math.max(forwardLimit - p.z, Math.min(stop.z + 21 - p.z, z / length * 6.5 * STEP)));
    }
    for (const enemy of state.enemies) {
      if (enemy.hp <= 0) continue;
      enemy.attack = Math.max(0, enemy.attack - STEP); enemy.flash = Math.max(0, enemy.flash - STEP);
      const p = enemy.body.translation(), target = enemy.boss ? bus.body.translation() : position(), len = distance(p, target);
      if (enemy.boss && stepRouteBoss(enemy, { stopIndex: state.stopIndex, dt: STEP, position: p, busPosition: target,
        survivors: state.inBus ? [] : [player.body.translation()], emit,
        move: (x, z) => move(enemy, clamp(x, -28 - p.x, 28 - p.x), clamp(z, STOPS[state.stopIndex].z - 39 - p.z, STOPS[state.stopIndex].z + 22 - p.z)),
        strike: (zone, spec, hits) => bossStrike(enemy, zone, spec, hits) })) continue;
      let range = len;
      if (state.inBus) {
        const dx = p.x - target.x, dz = p.z - target.z;
        const localX = Math.cos(bus.yaw) * dx - Math.sin(bus.yaw) * dz;
        const localZ = Math.sin(bus.yaw) * dx + Math.cos(bus.yaw) * dz;
        range = Math.hypot(Math.max(0, Math.abs(localX) - 1.65), Math.max(0, Math.abs(localZ) - 4.2));
      }
      if (!enemy.boss && range < (state.inBus ? 1 : 1.55)) {
        if (!enemy.attack) {
          const direction = { x: (target.x - p.x) / Math.max(len, 0.01), y: 0, z: (target.z - p.z) / Math.max(len, 0.01) };
          const hit = world.castRay(new RAPIER.Ray({ x: p.x, y: 1.25, z: p.z }, direction), len, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, enemy.collider);
          if (hit?.collider.handle !== (state.inBus ? bus.collider.handle : player.collider.handle)) continue;
          enemy.attack = enemy.boss ? 1.15 : 1.35;
          if (state.inBus) state.busHealth -= 6 * (1 - routeUpgradeStats(state.routeUpgrades).busResistance);
          else { state.health -= enemy.boss ? 20 : 8; state.damageFlash = 0.2; }
          emit("hurt", "", { x: p.x, z: p.z });
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
    } else {
      if (!state.stopCleared && state.enemies.every(e => e.hp <= 0)) {
        state.stopCleared = true; saveCheckpoint(); emit("stop-clear", "Stop secured. Choose a route upgrade.");
      }
      if (!(state.inBus && state.fuelFound && state.stopCleared && state.routeUpgrades[state.stopIndex])) return state;
      const nextZ = STOPS[state.stopIndex + 1]?.z ?? -300;
      if (bus.body.translation().z <= nextZ + 8) {
        if (state.stopIndex < 2) { state.score += 250; populateStop(state.stopIndex + 1); }
        else { state.status = "won"; state.score += 1000 + Math.round(state.busHealth); emit("finish", "Safe Haven reached"); }
      }
    }
    return state;
  }
  return {
    state, world, player, bus, road, step, interact, purchase, reload, objective, prompt, position, chooseUpgrade,
    checkpoint: () => normalizeCheckpoint(checkpoint),
    dispose() { if (!disposed) { disposed = true; world.free(); } }
  };
}
