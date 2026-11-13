import RAPIER from "@dimforge/rapier3d-compat";
import PF from "pathfinding";
import { makeRoad, STOPS, bossState, stepRouteBoss, bossZoneContains, bossZoneHitsBus, routeUpgradeStats, claimRouteUpgrade, ROUTE_UPGRADES } from "./zombie-world.mjs";
export const COOP_STEP = 1 / 60;
export const COOP_PROTOCOL = 2;
const SLOTS = ["p1", "p2", "p3", "p4", "p5"];
const clamp = (n, min, max) => Math.max(min, Math.min(max, Number.isFinite(n) ? n : 0));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
let initialization;
export function normalizeRouteInput(input = {}) {
  if (!input || typeof input !== "object") input = {};
  const x = clamp(input.x, -1, 1), z = clamp(input.z, -1, 1), length = Math.max(1, Math.hypot(x, z));
  const ax = clamp(input.aim?.x, -1e6, 1e6), az = clamp(input.aim?.z, -1e6, 1e6), aimLength = Math.hypot(ax, az);
  return { x: x / length, z: z / length, throttle: clamp(input.throttle, -1, 1), steer: clamp(input.steer, -1, 1),
    aim: aimLength > 0 ? { x: ax / aimLength, z: az / aimLength } : { x: 0, z: -1 },
    shoot: input.shoot === true, melee: input.melee === true,
    action: ["interact", "reload", "heal", "repair", "armor", "weapon", "refuel", "ammo", ...ROUTE_UPGRADES.map(item => `upgrade:${item.id}`)].includes(input.action) ? input.action : "",
    upgradeStop: Number.isInteger(input.upgradeStop) && input.upgradeStop >= 0 && input.upgradeStop < 3 ? input.upgradeStop : -1,
    upgradeRun: typeof input.upgradeRun === "string" ? input.upgradeRun.slice(0, 100) : "",
    actionSeq: Math.floor(clamp(input.actionSeq, 0, Number.MAX_SAFE_INTEGER)), seq: Math.floor(clamp(input.seq, 0, Number.MAX_SAFE_INTEGER)) };
}
export async function createCoopRouteWorld() {
  await (initialization ||= RAPIER.init().catch(error => { initialization = null; throw error; }));
  const world = new RAPIER.World({ x: 0, y: -20, z: 0 }); world.timestep = COOP_STEP;
  const road = makeRoad(), players = new Map(), enemies = [], finder = new PF.AStarFinder({ allowDiagonal: true, dontCrossCorners: true });
  const ground = world.createCollider(RAPIER.ColliderDesc.cuboid(31, 0.5, 190).setTranslation(0, -0.5, -145));
  for (const wall of road.walls) world.createCollider(RAPIER.ColliderDesc.cuboid(wall.w / 2, wall.h / 2, wall.d / 2).setTranslation(wall.x, wall.h / 2, wall.z));
  function actor(x, z, radius = 0.35) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, 0.86, z));
    const collider = world.createCollider(RAPIER.ColliderDesc.capsule(0.5, radius), body), controller = world.createCharacterController(0.015); controller.enableSnapToGround(0.2);
    return { body, collider, controller };
  }
  const busBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1.5, 8));
  const bus = { body: busBody, collider: world.createCollider(RAPIER.ColliderDesc.cuboid(1.65, 1.45, 4.2), busBody), controller: world.createCharacterController(0.04), yaw: 0, speed: 0, wheels: 0, driver: "" };
  const state = { version: COOP_PROTOCOL, runId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, status: "waiting", stopIndex: 0, elapsed: 0, score: 0, kills: 0, level: 1, xp: 0, ammo: 180, scrap: 20, medkits: 4, busHealth: 200, maxBusHealth: 200, armor: 0, weapon: 0, fuel: 70, fuelFound: false, stopCleared: false, routeUpgrades: [null, null, null], loot: [], events: [], tick: 0 };
  let grid, disposed = false, populated = false, eventId = 0;
  const emit = (type, message = "", extra = {}) => { state.events.push({ id: ++eventId, type, message, ...extra }); state.events = state.events.slice(-24); };
  const teleport = (body, p) => { body.setTranslation(p, true); body.setNextKinematicTranslation(p); };
  function populate() {
    for (const enemy of enemies) { world.removeCharacterController(enemy.controller); world.removeRigidBody(enemy.body); } enemies.length = 0;
    const stop = STOPS[state.stopIndex]; state.fuelFound = state.stopCleared = false; bus.driver = ""; bus.speed = bus.yaw = 0;
    teleport(bus.body, { x: 0, y: 1.5, z: stop.z + 8 }); bus.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true); bus.body.setNextKinematicRotation({ x: 0, y: 0, z: 0, w: 1 });
    let i = 0;
    for (const player of players.values()) { player.inBus = false; player.health = Math.max(50, player.health); player.collider.setEnabled(true); teleport(player.body, { x: 4 + i++ * 1.2, y: 0.86, z: stop.z + 9 }); }
    const count = 4 + players.size + state.stopIndex * 2;
    for (let n = 0; n < count; n++) {
      const boss = n === count - 1, maxHp = 48 + state.stopIndex * 8;
      enemies.push({ ...actor(boss ? 0 : (n % 2 ? -1 : 1) * (5 + n % 3 * 2), stop.z - (boss ? 24 : 10 + Math.floor(n / 2) * 4), boss ? 0.6 : 0.35), id: `${state.stopIndex}-${n}`, boss,
        hp: maxHp, maxHp, ...(boss ? bossState(state.stopIndex, players.size) : {}), yaw: 0, flash: 0, attack: 0, path: [], pathTimer: n * 0.07 });
    }
    state.loot = [
      { id: "fuel", name: "Fuel drums", kind: "fuel", x: -17, z: stop.z - 8, color: "#e0ba79" },
      { id: "supplies", name: "Supply crate", kind: "supplies", x: 17, z: stop.z - 8, color: "#9dc2ac" },
      { id: "scrap", name: "Scrap cache", kind: "scrap", x: -20, z: stop.z - 28, color: "#bca6cb" },
      { id: "spares", name: "Spare parts", kind: "scrap", x: 20, z: stop.z - 28, color: "#94b9ce" }
    ].map(item => ({ ...item, taken: false }));
    grid = new PF.Grid(64, 64);
    for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++) {
      const wx = x - 32, wz = z + stop.z - 40;
      if (Math.abs(wx) > 28 || road.walls.some(w => Math.abs(wx - w.x) < w.w / 2 + 0.7 && Math.abs(wz - w.z) < w.d / 2 + 0.7)) grid.setWalkableAt(x, z, false);
    }
    populated = true; emit("stop", stop.name); world.step();
  }
  function reconcile(members) {
    const active = (Array.isArray(members) ? members : []).filter((member, i, list) => member && SLOTS.includes(member.slot) && typeof member.memberId === "string" &&
      list.findIndex(other => other?.slot === member.slot || other?.memberId === member.memberId) === i).slice(0, 5), seen = new Set(active.map(m => m.slot));
    for (const [slot, player] of players) if (!seen.has(slot) || active.find(m => m.slot === slot)?.memberId !== player.memberId) {
      world.removeCharacterController(player.controller); world.removeRigidBody(player.body); players.delete(slot); if (bus.driver === slot) { bus.driver = ""; bus.speed = 0; }
    }
    for (const member of active) {
      let player = players.get(member.slot);
      if (!player) {
        const p = bus.body.translation(); player = { ...actor(p.x + 4 + (SLOTS.indexOf(member.slot) % 2) * 1.2, p.z + SLOTS.indexOf(member.slot) * 1.2), slot: member.slot, memberId: member.memberId, health: 100, maxHealth: 100, inBus: false, magazine: 12, reload: 0, shotCooldown: 0, meleeCooldown: 0, damageFlash: 0, aim: { x: 0, z: -1 }, lastAction: 0, lastSeq: -1, stale: 99, input: normalizeRouteInput() };
        players.set(member.slot, player);
        player.maxHealth = 100 + routeUpgradeStats(state.routeUpgrades).health; player.health = player.maxHealth;
        player.lastAction = normalizeRouteInput(member.routeInput).actionSeq;
        if (populated && (Math.abs(bus.speed) > 1 || p.z < STOPS[state.stopIndex].z - 28)) { player.inBus = true; player.collider.setEnabled(false); teleport(player.body, { x: p.x, y: 0.86, z: p.z }); }
      }
      player.username = String(member.username || member.slot).slice(0, 24); player.color = /^#[0-9a-f]{6}$/i.test(member.headColor) ? member.headColor : "#62aa97";
      const input = normalizeRouteInput(member.routeInput);
      if (input.seq > player.lastSeq) { player.input = input; player.lastSeq = input.seq; player.stale = 0; }
    }
    if (!populated && players.size >= 2) populate();
    if (!["won", "lost"].includes(state.status)) state.status = players.size >= 2 ? "playing" : "waiting";
  }
  function move(entity, x, z) {
    // The route is flat: keep the wide bus chassis above the road instead of ground-snapping its corners.
    const driving = entity === bus;
    entity.controller.computeColliderMovement(entity.collider, { x, y: driving ? 0 : -0.15, z }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, driving ? collider => collider.handle !== ground.handle : undefined);
    const p = entity.body.translation(), d = entity.controller.computedMovement(); entity.body.setNextKinematicTranslation({ x: p.x + d.x, y: p.y + d.y, z: p.z + d.z }); return d;
  }
  function purchase(player, action) {
    const near = player.inBus || distance(player.body.translation(), bus.body.translation()) < 7;
    if (action === "heal" && state.medkits > 0 && player.health < player.maxHealth && player.health > 0) { state.medkits--; player.health = Math.min(player.maxHealth, player.health + 60); emit("heal", "Medkit used"); return; }
    if (!near) return;
    if (action === "repair" && state.scrap >= 8 && state.busHealth < state.maxBusHealth) { state.scrap -= 8; state.busHealth = Math.min(state.maxBusHealth, state.busHealth + 50); }
    else if (action === "armor" && state.scrap >= 18 && state.armor < 2) { state.scrap -= 18; state.armor++; state.maxBusHealth += 40; state.busHealth += 40; }
    else if (action === "weapon" && state.scrap >= 22 && !state.weapon) { state.scrap -= 22; state.weapon = 1; }
    else if (action === "refuel" && state.scrap >= 5 && state.fuel < 100) { state.scrap -= 5; state.fuel = Math.min(100, state.fuel + 35); }
    else if (action === "ammo" && state.scrap >= 5 && state.ammo < 300) { state.scrap -= 5; state.ammo += 48; }
    else return;
    emit("upgrade", "Team supplies updated");
  }
  function interact(player) {
    const p = player.body.translation(), b = bus.body.translation();
    if (player.inBus) {
      if (Math.abs(bus.speed) > 1) return;
      for (const side of [1, -1]) {
        const exit = { x: b.x + side * 3.5, y: 0.86, z: b.z + 1.5 };
        const blocked = world.intersectionWithShape(exit, { x: 0, y: 0, z: 0, w: 1 }, player.collider.shape, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, player.collider);
        if (blocked) continue;
        player.inBus = false; player.collider.setEnabled(true); teleport(player.body, exit); if (bus.driver === player.slot) { bus.driver = ""; bus.speed = 0; } emit("door"); return;
      }
      return;
    }
    const ally = [...players.values()].find(other => other.health <= 0 && distance(other.body.translation(), p) < 2.5);
    if (ally && state.medkits) { state.medkits--; ally.health = 60; ally.collider.setEnabled(true); emit("heal", `${ally.username} revived`); return; }
    const item = state.loot.find(item => !item.taken && distance(item, p) < 2.5);
    if (item) {
      item.taken = true; state.score += 50;
      if (item.kind === "fuel") { state.fuelFound = true; state.fuel = Math.min(100, state.fuel + 45); state.scrap += 10; }
      else if (item.kind === "supplies") { state.ammo += 84; state.medkits += 2; state.scrap += 10; }
      else state.scrap += 20;
      emit("loot", `${player.username}: ${item.name}`); return;
    }
    if (distance(p, b) < 6.8 && Math.abs(bus.speed) < 1) { player.inBus = true; player.collider.setEnabled(false); if (!bus.driver) bus.driver = player.slot; emit("door", bus.driver === player.slot ? `${player.username} is driving` : `${player.username} boarded`); }
  }
  function hurtEnemy(enemy, damage) {
    if (!enemy || enemy.hp <= 0) return;
    enemy.hp = Math.max(0, enemy.hp - damage); enemy.flash = 0.12; const p = enemy.body.translation(); emit("hit", "", { x: p.x, z: p.z });
    if (!enemy.hp) {
      if (enemy.boss) { enemy.bossPhase = "defeated"; enemy.telegraph = null; }
      enemy.collider.setEnabled(false); state.kills++; state.scrap += enemy.boss ? 24 : 5; state.score += enemy.boss ? 500 : 100; state.xp += enemy.boss ? 80 : 20;
      while (state.level < 10 && state.xp >= state.level * 40) { state.xp -= state.level * 40; state.level++; emit("level", `Team level ${state.level}`); }
      state.xp = Math.min(state.xp, state.level * 40);
      emit("kill", "", { enemyId: enemy.id, x: p.x, z: p.z });
    }
  }
  function bossStrike(enemy, zone, spec, hits) {
    const origin = enemy.body.translation(), b = bus.body.translation();
    const visible = (actor, point) => {
      const len = distance(origin, point);
      if (len < 0.01) return true;
      const hit = world.castRay(new RAPIER.Ray({ x: origin.x, y: 1.25, z: origin.z }, { x: (point.x - origin.x) / len, y: 0, z: (point.z - origin.z) / len }), len + 0.5, true,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, enemy.collider, undefined,
        collider => collider.handle === actor.collider.handle || collider.handle === bus.collider.handle || !collider.parent());
      return hit?.collider.handle === actor.collider.handle;
    };
    if (!hits.has("bus") && bossZoneHitsBus(zone, b, bus.yaw) && (spec.kind !== "charge" || distance(origin, b) < 6.5) && visible(bus, b)) {
      hits.add("bus"); state.busHealth = Math.max(0, state.busHealth - spec.busDamage * (1 - routeUpgradeStats(state.routeUpgrades).busResistance));
      emit("hurt", "Bus under attack", { x: b.x, z: b.z });
    }
    for (const player of players.values()) {
      const p = player.body.translation();
      if (player.inBus || player.health <= 0 || hits.has(player.slot) || !bossZoneContains(zone, p) || spec.kind === "charge" && distance(origin, p) > 2.4 || !visible(player, p)) continue;
      hits.add(player.slot); player.health = Math.max(0, player.health - spec.damage); player.damageFlash = 0.2;
      if (!player.health) { player.collider.setEnabled(false); emit("notice", `${player.username} is down`); }
      emit("hurt", "", { x: p.x, z: p.z });
    }
  }
  function step() {
    if (disposed || state.status !== "playing") return;
    state.elapsed += COOP_STEP; state.tick++;
    for (const player of players.values()) {
      player.stale += COOP_STEP;
      for (const key of ["shotCooldown", "meleeCooldown", "damageFlash"]) player[key] = Math.max(0, player[key] - COOP_STEP);
      if (player.reload > 0) { player.reload = Math.max(0, player.reload - COOP_STEP); if (!player.reload) { const amount = Math.min(12 - player.magazine, state.ammo); state.ammo -= amount; player.magazine += amount; } }
      const input = player.stale > 0.6 ? normalizeRouteInput() : player.input; player.aim = input.aim;
      if (input.actionSeq > player.lastAction) {
        player.lastAction = input.actionSeq;
        if (input.action.startsWith("upgrade:")) {
          const id = input.action.slice(8);
          if (player.slot === "p1" && input.upgradeRun === state.runId && claimRouteUpgrade(state, id, input.upgradeStop, players.values())) emit("upgrade", `Team upgrade: ${ROUTE_UPGRADES.find(item => item.id === id).name}`);
        }
        else if (player.health <= 0) continue;
        else if (input.action === "interact") interact(player);
        else if (input.action === "reload") { if (!player.reload && !player.inBus && player.magazine < 12 && state.ammo > 0) { player.reload = routeUpgradeStats(state.routeUpgrades).reload; emit("reload"); } }
        else purchase(player, input.action);
      }
      if (player.health <= 0 || player.inBus) continue;
      const p = player.body.translation(), origin = { x: p.x, y: 1.25, z: p.z };
      if (input.shoot && !player.reload && !player.shotCooldown && player.magazine > 0) {
        player.magazine--; player.shotCooldown = state.weapon ? 0.16 : 0.28;
        const hit = world.castRay(new RAPIER.Ray(origin, { ...player.aim, y: 0 }), 42, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, player.collider), len = hit?.timeOfImpact ?? 42;
        hurtEnemy(enemies.find(enemy => enemy.collider.handle === hit?.collider.handle), (state.weapon ? 36 : 24) + (state.level - 1) * 4 + routeUpgradeStats(state.routeUpgrades).damage);
        emit("shot", "", { slot: player.slot, from: origin, to: { x: p.x + player.aim.x * len, y: 1.25, z: p.z + player.aim.z * len } });
      }
      if (input.melee && !player.meleeCooldown) {
        player.meleeCooldown = 0.65;
        const enemy = enemies.filter(e => e.hp > 0 && distance(e.body.translation(), p) < 2.5).sort((a, b) => distance(a.body.translation(), p) - distance(b.body.translation(), p))[0];
        if (enemy) { const ep = enemy.body.translation(), len = Math.max(0.01, distance(p, ep)); const hit = world.castRay(new RAPIER.Ray(origin, { x: (ep.x - p.x) / len, y: 0, z: (ep.z - p.z) / len }), len + 0.2, true, undefined, undefined, player.collider); if (hit?.collider.handle === enemy.collider.handle) hurtEnemy(enemy, 30 + routeUpgradeStats(state.routeUpgrades).damage); }
        emit("melee");
      }
      const stop = STOPS[state.stopIndex];
      const forwardLimit = Math.min(stop.z - 39, bus.body.translation().z - 18);
      move(player, clamp(input.x * 6.5 * COOP_STEP, -28 - p.x, 28 - p.x), clamp(input.z * 6.5 * COOP_STEP, forwardLimit - p.z, stop.z + 22 - p.z));
    }
    const driver = players.get(bus.driver);
    if (driver?.inBus && driver.health > 0) {
      const input = driver.stale > 0.6 ? normalizeRouteInput() : driver.input, throttle = state.fuel > 0 ? input.throttle : 0;
      bus.speed += clamp(throttle * (throttle < 0 ? 6 : 18) - bus.speed, -0.22, 0.22); bus.yaw = clamp(bus.yaw - input.steer * bus.speed * 0.002, -0.55, 0.55);
      const b = bus.body.translation(), ready = state.fuelFound && state.stopCleared && state.routeUpgrades[state.stopIndex] && [...players.values()].every(player => player.health <= 0 || player.inBus);
      const limit = ready ? -310 : Math.min(b.z, STOPS[state.stopIndex].z - 28);
      bus.body.setNextKinematicRotation({ x: 0, y: Math.sin(bus.yaw / 2), z: 0, w: Math.cos(bus.yaw / 2) });
      const d = move(bus, clamp(-Math.sin(bus.yaw) * bus.speed * COOP_STEP, -26 - b.x, 26 - b.x), clamp(-Math.cos(bus.yaw) * bus.speed * COOP_STEP, limit - b.z, STOPS[state.stopIndex].z + 18 - b.z));
      state.fuel = Math.max(0, state.fuel - Math.hypot(d.x, d.z) * 0.19); bus.wheels += bus.speed * COOP_STEP;
    } else bus.speed = 0;
    for (const enemy of enemies) {
      if (enemy.hp <= 0) continue;
      enemy.flash = Math.max(0, enemy.flash - COOP_STEP); enemy.attack = Math.max(0, enemy.attack - COOP_STEP);
      const p = enemy.body.translation(), targets = [...players.values()].filter(player => player.health > 0);
      if (enemy.boss && stepRouteBoss(enemy, { stopIndex: state.stopIndex, dt: COOP_STEP, position: p, busPosition: bus.body.translation(),
        survivors: targets.filter(player => !player.inBus).map(player => player.body.translation()), emit,
        move: (x, z) => move(enemy, clamp(x, -28 - p.x, 28 - p.x), clamp(z, STOPS[state.stopIndex].z - 39 - p.z, STOPS[state.stopIndex].z + 22 - p.z)),
        strike: (zone, spec, hits) => bossStrike(enemy, zone, spec, hits) })) continue;
      const target = targets.sort((a, b) => distance(p, a.inBus ? bus.body.translation() : a.body.translation()) - distance(p, b.inBus ? bus.body.translation() : b.body.translation()))[0];
      if (!target) continue;
      const t = enemy.boss || target.inBus ? bus.body.translation() : target.body.translation(), len = distance(p, t);
      const range = target.inBus ? Math.hypot(Math.max(0, Math.abs(p.x - t.x) - 1.65), Math.max(0, Math.abs(p.z - t.z) - 4.2)) : len;
      if (!enemy.boss && range < (target.inBus ? 1 : 1.55)) {
        if (!enemy.attack) {
          const hit = world.castRay(new RAPIER.Ray({ x: p.x, y: 1.25, z: p.z }, { x: (t.x - p.x) / Math.max(len, 0.01), y: 0, z: (t.z - p.z) / Math.max(len, 0.01) }), len, true, undefined, undefined, enemy.collider);
          if (hit?.collider.handle !== (target.inBus ? bus.collider.handle : target.collider.handle)) continue;
          enemy.attack = 1.3;
          if (target.inBus) state.busHealth = Math.max(0, state.busHealth - 6 * (1 - routeUpgradeStats(state.routeUpgrades).busResistance));
          else { target.health = Math.max(0, target.health - (enemy.boss ? 20 : 8)); target.damageFlash = 0.2; if (!target.health) { target.collider.setEnabled(false); emit("notice", `${target.username} is down`); } }
          emit("hurt", "", { x: p.x, z: p.z });
        }
        continue;
      }
      if (len > 45) continue;
      enemy.pathTimer -= COOP_STEP;
      if (enemy.pathTimer <= 0) {
        enemy.pathTimer = 0.75;
        const cell = v => [Math.floor(clamp(v.x + 32, 0, 63)), Math.floor(clamp(v.z - STOPS[state.stopIndex].z + 40, 0, 63))], [sx, sz] = cell(p), [tx, tz] = cell(t), working = grid.clone(); working.setWalkableAt(sx, sz, true); working.setWalkableAt(tx, tz, true);
        enemy.path = finder.findPath(sx, sz, tx, tz, working).slice(1).map(([x, z]) => ({ x: x - 32, z: z + STOPS[state.stopIndex].z - 40 }));
      }
      while (enemy.path.length && distance(p, enemy.path[0]) < 0.6) enemy.path.shift();
      const goal = enemy.path[0] || t, dx = goal.x - p.x, dz = goal.z - p.z, d = Math.hypot(dx, dz) || 1; enemy.yaw = Math.atan2(-dx, -dz); const speed = enemy.boss ? 2.1 : 2.5;
      move(enemy, dx / d * speed * COOP_STEP, dz / d * speed * COOP_STEP);
    }
    world.step();
    for (const player of players.values()) if (player.inBus) { const p = bus.body.translation(); teleport(player.body, { x: p.x, y: 0.86, z: p.z }); }
    if (state.busHealth <= 0 || [...players.values()].every(player => player.health <= 0)) { state.status = "lost"; emit("finish", state.busHealth <= 0 ? "Bus destroyed" : "Team down"); }
    else {
      if (!state.stopCleared && enemies.every(enemy => enemy.hp <= 0)) { state.stopCleared = true; emit("stop-clear", "Stop secured. The host chooses a team upgrade."); }
      if (!(bus.driver && state.fuelFound && state.stopCleared && state.routeUpgrades[state.stopIndex] &&
        [...players.values()].every(player => player.health <= 0 || player.inBus) && bus.body.translation().z <= (STOPS[state.stopIndex + 1]?.z ?? -300) + 8)) return;
      state.score += 250;
      if (state.stopIndex < 2) { state.stopIndex++; populate(); }
      else { state.status = "won"; state.score += 1000; emit("finish", "Safe Haven reached together"); }
    }
  }
  function snapshot() {
    const pose = entity => { const p = entity.body.translation(); return { x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000, z: Math.round(p.z * 1000) / 1000 }; };
    return { ...state, routeUpgrades: [...state.routeUpgrades], loot: state.loot.map(item => ({ ...item })), events: state.events.map(event => ({ ...event })),
      bus: { ...pose(bus), yaw: bus.yaw, speed: bus.speed, wheels: bus.wheels, driver: bus.driver },
      players: Object.fromEntries([...players].map(([slot, player]) => [slot, { ...pose(player), memberId: player.memberId, username: player.username, color: player.color, health: player.health, maxHealth: player.maxHealth, inBus: player.inBus, magazine: player.magazine, reload: player.reload, shotCooldown: player.shotCooldown, meleeCooldown: player.meleeCooldown, damageFlash: player.damageFlash, aim: { ...player.aim }, lastAction: player.lastAction, lastSeq: player.lastSeq }])),
      enemies: enemies.map(enemy => ({ ...pose(enemy), id: enemy.id, boss: enemy.boss, hp: enemy.hp, maxHp: enemy.maxHp, yaw: enemy.yaw, flash: enemy.flash, attack: enemy.attack,
        ...(enemy.boss ? { bossName: enemy.bossName, bossPhase: enemy.bossPhase, bossTimer: enemy.bossTimer, bossCycle: enemy.bossCycle, telegraph: enemy.telegraph ? { ...enemy.telegraph } : null } : {}) })) };
  }
  return { state, bus, players, enemies, world, road, reconcile, step, snapshot, dispose() { if (!disposed) { disposed = true; world.free(); } } };
}
