import { makeRoad, STOPS } from "./zombie-world.mjs";
import { COOP_PROTOCOL, normalizeRouteInput } from "./coop-route-world.mjs";

const number = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const validPosition = value => value && [value.x, value.y, value.z].every(n => Number.isFinite(n) && Math.abs(n) < 1000);

export function createRouteView({ read, write, slot }) {
  let snapshot = null, lastEvent = null, sentAt = -Infinity, seq = 0, actionSeq = 0, disposed = false, localInput = {}, previousStop = -1, ended = false;
  const poses = new Map(), actions = [];
  const state = { stopIndex: 0, status: "playing", elapsed: 0, health: 100, maxHealth: 100, busHealth: 200, maxBusHealth: 200, fuel: 70, level: 1, xp: 0, weapon: 0, armor: 0, score: 0, kills: 0, ammo: 180, scrap: 20, medkits: 4, inBus: false, magazine: 12, reload: 0, shotCooldown: 0, meleeCooldown: 0, damageFlash: 0, aim: { x: 0, z: -1 }, events: [], enemies: [], loot: [] };
  const body = key => ({ translation: () => poses.get(key) || { x: 4, y: 0.86, z: 9 } });
  const bus = { body: body("bus"), yaw: 0, speed: 0, wheels: 0 }, player = { body: body("local") };
  const teammates = new Map();
  function refresh(dt = 1 / 60) {
    if (disposed) return;
    const data = read();
    if (!data || data.version !== COOP_PROTOCOL || !validPosition(data.bus) || !data.players || !Array.isArray(data.enemies || [])) return;
    if (snapshot && snapshot.runId !== data.runId) { poses.clear(); actions.length = 0; lastEvent = null; previousStop = -1; ended = false; state.events.length = 0; localInput = {}; }
    snapshot = data;
    const updatePose = (key, p) => {
      if (!validPosition(p)) return;
      const old = poses.get(key), snap = previousStop !== data.stopIndex || !old || Math.hypot(p.x - old.x, p.z - old.z) > 6;
      const a = snap ? 1 : 1 - Math.exp(-Math.max(0, Math.min(dt, 0.1)) * 25);
      poses.set(key, { x: old ? old.x + (p.x - old.x) * a : p.x, y: old ? old.y + (p.y - old.y) * a : p.y, z: old ? old.z + (p.z - old.z) * a : p.z });
    };
    const viewedSlot = data.players[slot] ? slot : Object.keys(data.players)[0];
    const local = data.players[viewedSlot];
    if (!local || !validPosition(local)) return;
    updatePose("local", local); updatePose("bus", data.bus);
    for (const key of ["stopIndex", "elapsed", "busHealth", "maxBusHealth", "fuel", "level", "xp", "weapon", "armor", "score", "kills", "ammo", "scrap", "medkits"]) state[key] = number(data[key], state[key]);
    state.stopIndex = Math.max(0, Math.min(2, Math.floor(state.stopIndex)));
    for (const key of ["health", "maxHealth", "magazine", "reload", "shotCooldown", "meleeCooldown", "damageFlash"]) state[key] = number(local[key], state[key]);
    state.status = ["won", "lost"].includes(data.status) ? data.status : "playing"; state.inBus = !!local.inBus; state.aim = normalizeRouteInput({ aim: local.aim }).aim;
    bus.yaw = number(data.bus.yaw); bus.speed = number(data.bus.speed); bus.wheels = number(data.bus.wheels);
    teammates.clear();
    for (const [id, p] of Object.entries(data.players).slice(0, 5)) if (validPosition(p)) {
      updatePose(id, p); if (id !== viewedSlot) teammates.set(id, { ...p, slot: id, body: body(id) });
    }
    state.enemies = (data.enemies || []).slice(0, 16).filter(e => validPosition(e) && typeof e.id === "string").map(e => {
      updatePose(`enemy-${e.id}`, e); return { ...e, hp: number(e.hp), maxHp: Math.max(1, number(e.maxHp, 48)), yaw: number(e.yaw), flash: number(e.flash), attack: number(e.attack), body: body(`enemy-${e.id}`) };
    });
    state.loot = (Array.isArray(data.loot) ? data.loot : []).slice(0, 8).filter(item => Number.isFinite(item.x) && Number.isFinite(item.z));
    previousStop = data.stopIndex;
    if (lastEvent === null) lastEvent = Math.max(0, ...(data.events || []).map(event => number(event.id)));
    for (const event of (data.events || []).slice(-24)) if (number(event.id) > lastEvent) {
      lastEvent = event.id;
      if (event.type !== "finish" && event.type !== "checkpoint") state.events.push(event.type === "kill" ? { ...event, id: event.enemyId } : event);
    }
    if (state.status !== "playing" && !ended) { ended = true; state.events.push({ type: "finish", message: data.status === "won" ? "Safe Haven reached together" : "Journey interrupted" }); }
    while (actions.length && actions[0].actionSeq <= number(local.lastAction)) actions.shift();
    actionSeq = Math.max(actionSeq, number(local.lastAction));
  }
  function send(force = false) {
    const now = performance.now();
    if (disposed || !slot || !force && now - sentAt < 50) return;
    sentAt = now; write({ ...normalizeRouteInput(localInput), ...(actions[0] || { action: "", actionSeq }), seq: ++seq });
  }
  function queue(action) {
    if (!slot || state.health <= 0 || actions.length >= 8) return false;
    actions.push({ action, actionSeq: ++actionSeq }); send(true); return true;
  }
  function objective() {
    if (!snapshot) return "Connecting to the host...";
    if (snapshot.status === "waiting") return "Waiting for another survivor (2-5 players)";
    if (snapshot.status === "won") return "Safe Haven reached together";
    if (snapshot.status === "lost") return snapshot.busHealth <= 0 ? "Bus destroyed" : "Team down";
    if (state.health <= 0) return "Downed / Waiting for a teammate to revive you";
    const count = state.enemies.filter(e => e.hp > 0).length;
    if (count || !snapshot.fuelFound) return `${count} infected remaining / ${snapshot.fuelFound ? "Fuel secured" : "Find fuel"}`;
    if (Object.values(snapshot.players).some(p => p.health > 0 && !p.inBus)) return "Route clear / All survivors must board";
    return `Drive to ${STOPS[state.stopIndex + 1]?.name || "Safe Haven"}`;
  }
  function prompt() {
    if (!slot || !snapshot || snapshot.status !== "playing" || state.health <= 0) return null;
    if (state.inBus) return { action: "exit", text: Math.abs(bus.speed) > 1 ? "Bus is moving" : "E / Leave bus" };
    const p = player.body.translation(), near = item => Math.hypot(item.x - p.x, item.z - p.z);
    const ally = Object.entries(snapshot.players).find(([id, other]) => id !== slot && other.health <= 0 && near(other) < 2.5);
    if (ally) return { action: "revive", text: state.medkits ? `E / Revive ${String(ally[1].username).slice(0, 24)}` : "No team medkits" };
    const item = state.loot.find(item => !item.taken && near(item) < 2.5);
    if (item) return { action: "loot", text: `E / ${item.name}` };
    if (near(bus.body.translation()) < 6.8 && Math.abs(bus.speed) < 1) return { action: "board", text: snapshot.bus.driver ? "E / Board as passenger" : "E / Drive bus" };
    return null;
  }
  refresh();
  return { state, player, bus, teammates, road: makeRoad(), refresh, objective, prompt,
    get epoch() { return snapshot?.runId; },
    get playerCount() { return Object.keys(snapshot?.players || {}).length; },
    position: () => state.inBus ? bus.body.translation() : player.body.translation(), checkpoint: () => null,
    clearInput() { localInput = {}; send(true); },
    step(input = {}) {
      if (state.health <= 0) input = {};
      localInput = input;
      for (const action of ["interact", "reload", "heal"]) if (input[action]) queue(action);
      send();
    },
    purchase: action => queue(action), interact: () => queue("interact"), reload: () => queue("reload"),
    dispose() { if (!disposed) { localInput = {}; actions.length = 0; send(true); disposed = true; } }
  };
}
