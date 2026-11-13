import test from "node:test";
import assert from "node:assert/strict";
import { MAX_FURNITURE, ROOM_COLORS, FURNITURE, furnitureBounds, validPlacement, placementError, findFreePlacement, normalizeClubhouse, defaultClubhouse } from "../src/clubhouse-model.mjs";

const item = (patch = {}) => ({ id: "test-item", kind: "sofa", x: 0, z: 0, rotation: 0, color: ROOM_COLORS[0], ...patch });

test("starter room is valid, independent and serializable", () => {
  const room = defaultClubhouse(); assert.equal(room.items.length, 4);
  assert.deepEqual(normalizeClubhouse(JSON.parse(JSON.stringify(room))), room);
  room.items[0].x = 100; assert.notEqual(defaultClubhouse().items[0].x, 100);
});

test("quarter turns swap the complete furniture footprint", () => {
  assert.deepEqual(furnitureBounds(item()), { x: 0, z: 0, w: 3, d: 1 });
  assert.deepEqual(furnitureBounds(item({ rotation: 1 })), { x: 0, z: 0, w: 1, d: 3 });
  assert.equal(furnitureBounds(item({ rotation: 2 })).w, 3);
  assert.equal(furnitureBounds(item({ rotation: 3 })).w, 1);
});

test("room edges include touching furniture, not protrusions", () => {
  assert.equal(validPlacement([], item({ x: 6, z: 6 })), true);
  assert.match(placementError([], item({ x: 7 })), /outside/);
  assert.equal(validPlacement([], item({ x: 7, z: 5, rotation: 1 })), true);
  assert.equal(validPlacement([], item({ x: 7, z: 6, rotation: 1 })), false);
  for (const sign of [-1, 1]) assert.equal(validPlacement([], item({ kind: "plant", x: sign * 7, z: sign * 6 })), true);
});

test("collisions block moves and rotations; touching edges are allowed", () => {
  const a = item({ id: "first" });
  assert.match(placementError([a], item({ id: "second", z: 0 })), /occupied/);
  assert.equal(validPlacement([a], item({ id: "second", z: 1 })), true);
  assert.equal(validPlacement([a], item({ id: "second", z: 1, rotation: 1 })), false);
  assert.equal(validPlacement([a], { ...a, x: 1 }), true, "moving ignores its previous footprint");
});

test("malformed input never becomes a placement or throws", () => {
  for (const value of [null, undefined, false, "sofa", {}, item({ kind: "unknown" }), item({ x: NaN }), item({ x: Infinity }), item({ z: "1" }), item({ rotation: -1 }), item({ rotation: 4 }), item({ rotation: 0.5 }), item({ x: 0.1 })]) {
    assert.equal(furnitureBounds(value), null); assert.equal(validPlacement([], value), false);
  }
  assert.equal(validPlacement(null, item()), true);
  assert.equal(validPlacement([null, {}, item({ id: "other", x: 4 })], item()), true);
});

test("normalizer rejects unknown, duplicate, overlapping and injected items", () => {
  const room = normalizeClubhouse({ accent: "javascript:bad", items: [null, item(), item({ id: "test-item", x: 4 }), item({ id: "overlap" }), item({ id: "bad", kind: "unlisted" }), item({ id: "<script>" }), item({ id: "valid", x: 4, color: "red", extra: true })] });
  assert.equal(room.items.length, 2); assert.equal(room.accent, ROOM_COLORS[0]); assert.equal(room.items[1].color, ROOM_COLORS[0]);
  assert.equal("extra" in room.items[1], false);
  for (const value of [null, [], "x", { items: {} }]) assert.deepEqual(normalizeClubhouse(value), { version: 1, accent: ROOM_COLORS[0], items: [] });
});

test("trophies require explicit mastery authorization, including imported saves", () => {
  const value = { items: [item({ kind: "trophy" })] };
  for (const flag of [undefined, false, 1, "true", {}]) assert.equal(normalizeClubhouse(value, flag).items.length, 0);
  assert.equal(normalizeClubhouse(value, true).items.length, 1);
});

test("normalizer enforces 24 furniture without mutating source", () => {
  const items = [];
  for (let z = -6; z < 0; z++) for (let x = -7; x < 7; x++) items.push(item({ id: `item-${items.length}`, kind: "lamp", x, z }));
  const value = { items }, before = structuredClone(value), normalized = normalizeClubhouse(value);
  assert.equal(normalized.items.length, MAX_FURNITURE); assert.deepEqual(value, before);
  normalized.items[0].x = 99; assert.deepEqual(value, before);
});

test("new furniture chooses nearest open spot, deterministically", () => {
  const first = findFreePlacement([], item()); assert.equal(first.x, 0); assert.equal(first.z, 0);
  const second = findFreePlacement([first], item({ id: "second" }));
  assert.equal(validPlacement([first], second), true);
  assert.deepEqual(findFreePlacement([first], item({ id: "second" })), second);
  for (const furniture of FURNITURE) assert.ok(findFreePlacement(defaultClubhouse().items, item({ kind: furniture.id })));
});

test("full room and invalid furniture cannot produce a placement", () => {
  const items = [];
  for (let z = -6; z <= 6; z++) for (let x = -7; x <= 7; x++) items.push(item({ kind: "plant", id: `p-${items.length}`, x, z }));
  assert.equal(findFreePlacement(items, item({ id: "new" })), null);
  assert.equal(findFreePlacement([], item({ kind: "unknown" })), null);
});

test("a normalized room remains nonoverlapping after repeated additions and JSON reload", () => {
  const items = [];
  for (let n = 0; n < MAX_FURNITURE; n++) {
    const next = findFreePlacement(items, item({ id: `item-${n}`, kind: FURNITURE[n % FURNITURE.length].id, rotation: n % 4, color: ROOM_COLORS[n % ROOM_COLORS.length] }));
    if (next) items.push(next);
  }
  const room = normalizeClubhouse({ items }, true);
  assert.equal(room.items.length, MAX_FURNITURE);
  for (const furniture of room.items) assert.equal(validPlacement(room.items, furniture), true);
  assert.deepEqual(normalizeClubhouse(JSON.parse(JSON.stringify(room)), true), room);
});

test("every furniture footprint respects all four rotated room edges", () => {
  for (const furniture of FURNITURE) for (let rotation = 0; rotation < 4; rotation++) {
    const value = item({ kind: furniture.id, rotation }), bounds = furnitureBounds(value);
    const x = Math.floor(7.5 - bounds.w / 2), z = Math.floor(6.5 - bounds.d / 2);
    for (const sign of [-1, 1]) {
      assert.equal(validPlacement([], { ...value, x: x * sign, z: z * sign }), true);
      assert.match(placementError([], { ...value, x: (x + 1) * sign }), /outside/);
      assert.match(placementError([], { ...value, z: (z + 1) * sign }), /outside/);
    }
  }
});

test("normalization is idempotent and filters untrusted trophy data without dropping other items", () => {
  const source = { accent: ROOM_COLORS[4], items: [item({ id: "trophy", kind: "trophy" }), item({ id: "sofa", x: 4 }), item({ id: "bad", x: Number.MAX_SAFE_INTEGER })] };
  const before = structuredClone(source), locked = normalizeClubhouse(source), unlocked = normalizeClubhouse(source, true);
  assert.deepEqual(locked.items.map(i => i.id), ["sofa"]);
  assert.deepEqual(unlocked.items.map(i => i.id), ["trophy", "sofa"]);
  assert.deepEqual(normalizeClubhouse(unlocked), locked);
  assert.deepEqual(normalizeClubhouse(unlocked, true), unlocked);
  assert.deepEqual(source, before);
});

test("placement search preserves caller objects and returns only legal quarter turns", () => {
  const room = defaultClubhouse(), candidate = item({ rotation: 3, x: -4, z: -4 });
  const before = structuredClone({ room, candidate });
  const placed = findFreePlacement(room.items, candidate);
  assert.ok(placed && validPlacement(room.items, placed));
  assert.equal(placed.rotation, 3);
  assert.notEqual(placed, candidate);
  assert.deepEqual({ room, candidate }, before);
  for (const rotation of [undefined, NaN, Infinity, -1, 4, "1"]) assert.equal(findFreePlacement([], item({ rotation })), null);
});
