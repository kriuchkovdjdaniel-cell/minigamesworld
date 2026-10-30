import test from "node:test";
import assert from "node:assert/strict";
import { createCoopRouteWorld, normalizeRouteInput } from "../src/coop-route-world.mjs";
import { createRouteView } from "../src/coop-route-view.mjs";

const members = (count = 2) => Array.from({ length: count }, (_, i) => ({ slot: `p${i + 1}`, memberId: `member-${i}`, username: `Player ${i + 1}`, headColor: "#56b79c", routeInput: { seq: 0, actionSeq: 0 } }));
const teleport = (entity, x, z) => { const p = { x, y: 0.86, z }; entity.body.setTranslation(p, true); entity.body.setNextKinematicTranslation(p); };
function command(sim, people, slot, input) { const person = people.find(p => p.slot === slot); person.routeInput = { ...person.routeInput, ...input, seq: (person.routeInput.seq || 0) + 1 }; if (input.action) person.routeInput.actionSeq++; sim.reconcile(people); sim.step(); }

test("co-op sanitizes controls and never accepts a client position or damage value", () => {
  const value = normalizeRouteInput({ x: 999, z: 999, health: 999, damage: 1e8, throttle: Infinity, action: "kill", aim: { x: NaN, z: 1 } });
  assert.ok(Math.hypot(value.x, value.z) <= 1.001); assert.equal(value.throttle, 0); assert.equal(value.action, ""); assert.equal(value.damage, undefined); assert.equal(value.health, undefined);
  assert.ok(Number.isFinite(value.aim.x) && Number.isFinite(value.aim.z));
});
test("co-op waits for two players, caps capacity and removes disconnected actors", async () => {
  const sim = await createCoopRouteWorld();
  try {
    sim.reconcile(members(1)); for (let i = 0; i < 60; i++) sim.step(); assert.equal(sim.state.elapsed, 0); assert.equal(sim.state.status, "waiting");
    sim.reconcile(members(6)); assert.equal(sim.players.size, 5); assert.equal(sim.state.status, "playing"); assert.equal(sim.enemies.length, 9);
    sim.reconcile(members(2)); assert.equal(sim.players.size, 2); assert.ok(JSON.stringify(sim.snapshot()).length < 20000);
    const people = members(2); people[1].memberId = "replacement"; sim.players.get("p2").health = 1; sim.reconcile(people); assert.equal(sim.players.get("p2").health, 100);
  } finally { sim.dispose(); }
});
test("shared supplies can only be collected once and command retries do not buy twice", async () => {
  const sim = await createCoopRouteWorld(), people = members(); sim.reconcile(people);
  try {
    const item = sim.state.loot.find(item => item.kind === "supplies"); teleport(sim.players.get("p1"), item.x - 0.5, item.z); teleport(sim.players.get("p2"), item.x + 0.5, item.z); sim.world.step();
    command(sim, people, "p1", { action: "interact" }); command(sim, people, "p2", { action: "interact" });
    assert.equal(sim.state.ammo, 264); assert.equal(sim.state.medkits, 6); assert.equal(sim.state.score, 50);
    teleport(sim.players.get("p1"), 4, 9); sim.state.busHealth = 50;
    command(sim, people, "p1", { action: "repair" }); const scrap = sim.state.scrap, health = sim.state.busHealth;
    for (let i = 0; i < 10; i++) { sim.reconcile(people); sim.step(); }
    assert.equal(sim.state.scrap, scrap); assert.equal(sim.state.busHealth, health);
  } finally { sim.dispose(); }
});
test("a teammate can revive a downed survivor with exactly one shared medkit", async () => {
  const sim = await createCoopRouteWorld(), people = members(); sim.reconcile(people);
  try {
    const ally = sim.players.get("p2"); ally.health = 0; ally.collider.setEnabled(false); teleport(ally, 5, 9);
    const kits = sim.state.medkits; command(sim, people, "p1", { action: "interact" });
    assert.equal(ally.health, 60); assert.equal(sim.state.medkits, kits - 1); assert.equal(ally.collider.isEnabled(), true);
  } finally { sim.dispose(); }
});
test("one driver owns the bus while passengers cannot steer it; stale input stops movement", async () => {
  const sim = await createCoopRouteWorld(), people = members(); sim.reconcile(people);
  try {
    command(sim, people, "p1", { action: "interact" }); command(sim, people, "p2", { action: "interact" });
    assert.equal(sim.bus.driver, "p1"); assert.equal(sim.players.get("p2").inBus, true);
    command(sim, people, "p2", { throttle: 1, steer: 1 }); for (let i = 0; i < 30; i++) sim.step(); assert.equal(sim.bus.speed, 0);
    command(sim, people, "p1", { throttle: 1, steer: 0 }); for (let i = 0; i < 20; i++) sim.step(); assert.ok(sim.bus.speed > 1);
    for (let i = 0; i < 180; i++) sim.step(); assert.equal(sim.bus.speed, 0);
    sim.reconcile([people[1]]); assert.equal(sim.bus.driver, ""); assert.equal(sim.state.status, "waiting");
  } finally { sim.dispose(); }
});
test("journey checkpoints require fuel, a cleared stop and all living survivors aboard", async () => {
  const sim = await createCoopRouteWorld(), people = members(); sim.reconcile(people);
  try {
    for (const enemy of sim.enemies) { enemy.hp = 0; enemy.collider.setEnabled(false); }
    sim.state.fuelFound = true; command(sim, people, "p1", { action: "interact" });
    for (let i = 0; i < 360; i++) command(sim, people, "p1", { throttle: 1, steer: 0 });
    assert.ok(sim.bus.body.translation().z >= -28.1); assert.equal(sim.state.stopIndex, 0);
    const passenger = sim.players.get("p2"); passenger.inBus = true; passenger.collider.setEnabled(false);
    for (let i = 0; i < 480 && sim.state.stopIndex === 0; i++) command(sim, people, "p1", { throttle: 1, steer: 0 });
    assert.equal(sim.state.stopIndex, 1); assert.equal(sim.state.fuelFound, false); assert.equal(sim.bus.driver, ""); assert.equal(passenger.inBus, false);
  } finally { sim.dispose(); }
});
test("co-op view retries discrete actions until acknowledged, and restart resets terminal state", async () => {
  const sim = await createCoopRouteWorld(), people = members(); sim.reconcile(people); let data = sim.snapshot(), input;
  const view = createRouteView({ read: () => data, write: value => { input = value; }, slot: "p1" });
  try {
    view.interact(); const action = input.actionSeq; view.clearInput(); assert.equal(input.action, "interact"); assert.equal(input.actionSeq, action);
    data.players.p1.lastAction = action; view.refresh(); view.clearInput(); assert.equal(input.action, "");
    data.status = "lost"; view.refresh(); assert.equal(view.state.events.filter(event => event.type === "finish").length, 1); view.state.events.length = 0; view.refresh(); assert.equal(view.state.events.length, 0);
    data = { ...data, runId: "new", status: "playing" }; view.refresh(); assert.equal(view.state.status, "playing");
    data.status = "won"; view.refresh(); assert.equal(view.state.events.filter(event => event.type === "finish").length, 1);
  } finally { view.dispose(); sim.dispose(); }
});

test("shared combat uses real raycasts, kill rewards once, and bounded reloads", async () => {
  const sim = await createCoopRouteWorld(), people = members(); sim.reconcile(people);
  try {
    const enemy = sim.enemies[0]; for (const other of sim.enemies.slice(1)) { other.hp = 0; other.collider.setEnabled(false); }
    teleport(enemy, 5, -10); teleport(sim.players.get("p1"), 5, -5); sim.world.step();
    command(sim, people, "p1", { aim: { x: 0, z: -1 }, shoot: true }); assert.equal(enemy.hp, 24);
    for (let i = 0; i < 25; i++) sim.step(); assert.equal(enemy.hp, 0); assert.equal(sim.state.kills, 1); assert.equal(sim.state.score, 100);
    command(sim, people, "p1", { shoot: false }); const player = sim.players.get("p1"); player.magazine = 0; sim.state.ammo = 2;
    command(sim, people, "p1", { action: "reload" }); for (let i = 0; i < 80; i++) sim.step();
    assert.equal(player.magazine, 2); assert.equal(sim.state.ammo, 0); assert.equal(sim.state.kills, 1);
  } finally { sim.dispose(); }
});

test("co-op bullets cannot damage infected through building walls", async () => {
  const sim = await createCoopRouteWorld(), people = members(); sim.reconcile(people);
  try {
    const enemy = sim.enemies[0]; teleport(enemy, -17, -8); teleport(sim.players.get("p1"), -25, -8); sim.world.step();
    command(sim, people, "p1", { aim: { x: 1, z: 0 }, shoot: true }); assert.equal(enemy.hp, enemy.maxHp);
  } finally { sim.dispose(); }
});

test("infected damage the nearby teammate, not a distant host", async () => {
  const sim = await createCoopRouteWorld(), people = members(); sim.reconcile(people);
  try {
    const enemy = sim.enemies[0]; teleport(enemy, 5, -10); teleport(sim.players.get("p2"), 5, -11.2); sim.world.step(); sim.step();
    assert.equal(sim.players.get("p1").health, 100); assert.equal(sim.players.get("p2").health, 92);
  } finally { sim.dispose(); }
});

test("a full three-stop co-op journey reaches Safe Haven and ends once", async () => {
  const sim = await createCoopRouteWorld(), people = members(); sim.reconcile(people);
  try {
    for (let stop = 0; stop < 3; stop++) {
      for (const enemy of sim.enemies) { enemy.hp = 0; enemy.collider.setEnabled(false); }
      sim.state.fuelFound = true;
      command(sim, people, "p1", { action: "interact", throttle: 0 }); command(sim, people, "p2", { action: "interact" });
      for (let i = 0; i < 1000 && sim.state.stopIndex === stop && sim.state.status === "playing"; i++) command(sim, people, "p1", { throttle: 1, steer: 0 });
      assert.ok(sim.state.stopIndex > stop || sim.state.status === "won", `Bus stalled at stop ${stop}: ${JSON.stringify(sim.bus.body.translation())}`);
    }
    assert.equal(sim.state.status, "won"); assert.equal(sim.state.stopIndex, 2); assert.equal(sim.state.events.filter(e => e.type === "finish").length, 1);
    const score = sim.state.score; sim.step(); assert.equal(sim.state.score, score);
  } finally { sim.dispose(); }
});

test("late arrivals board a moving bus and exiting mid-route does not teleport the team", async () => {
  const sim = await createCoopRouteWorld(), people = members(); sim.reconcile(people);
  try {
    for (const enemy of sim.enemies) { enemy.hp = 0; enemy.collider.setEnabled(false); }
    sim.state.fuelFound = true;
    command(sim, people, "p1", { action: "interact" }); command(sim, people, "p2", { action: "interact" });
    for (let i = 0; i < 230; i++) command(sim, people, "p1", { throttle: 1 });
    assert.ok(sim.bus.body.translation().z < -40);
    people.push(members(3)[2]); sim.reconcile(people); assert.equal(sim.players.get("p3").inBus, true);
    for (let i = 0; i < 90; i++) command(sim, people, "p1", { throttle: 0 });
    command(sim, people, "p2", { action: "interact" }); assert.equal(sim.players.get("p2").inBus, false);
    const busZ = sim.bus.body.translation().z, passengerZ = sim.players.get("p2").body.translation().z;
    for (let i = 0; i < 30; i++) command(sim, people, "p1", { throttle: 1 });
    assert.ok(Math.abs(sim.bus.body.translation().z - busZ) < 0.1);
    assert.ok(Math.abs(sim.players.get("p2").body.translation().z - passengerZ) < 0.1);
  } finally { sim.dispose(); }
});

test("spectators follow one survivor without duplicating its avatar or sending commands", async () => {
  const sim = await createCoopRouteWorld(); sim.reconcile(members(3)); let writes = 0;
  const view = createRouteView({ read: () => sim.snapshot(), write: () => writes++, slot: "" });
  try {
    assert.equal(view.playerCount, 3); assert.equal(view.teammates.size, 2); assert.equal(view.teammates.has("p1"), false);
    view.step({ x: 1 }); view.interact(); assert.equal(writes, 0);
  } finally { view.dispose(); sim.dispose(); }
});
