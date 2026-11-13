export const MAX_FURNITURE = 24;
export const ROOM_BOUNDS = { x: 7.5, z: 6.5 };
export const FURNITURE = [
  { id: "sofa", name: "Sofa", w: 3, d: 1 }, { id: "table", name: "Table", w: 2, d: 2 },
  { id: "arcade", name: "Arcade Cabinet", w: 1, d: 1 }, { id: "plant", name: "Plant", w: 1, d: 1 },
  { id: "shelf", name: "Shelf", w: 2, d: 1 }, { id: "lamp", name: "Floor Lamp", w: 1, d: 1 },
  { id: "trophy", name: "Mastery Trophy", w: 1, d: 1 }
];
export const ROOM_COLORS = ["#4f9b83", "#6298bb", "#a68bbd", "#c9b06c", "#bd819b"];
export const COLOR_NAMES = ["Emerald", "Sky", "Violet", "Gold", "Rose"];
const color = value => ROOM_COLORS.includes(value) ? value : ROOM_COLORS[0];
export function furnitureBounds(item) {
  const f = FURNITURE.find(f => f.id === item?.kind);
  if (!f || !Number.isInteger(item.x) || !Number.isInteger(item.z) || !Number.isInteger(item.rotation) || item.rotation < 0 || item.rotation > 3) return null;
  return { x: item.x, z: item.z, w: item.rotation % 2 ? f.d : f.w, d: item.rotation % 2 ? f.w : f.d };
}
export function placementError(items, item) {
  const b = furnitureBounds(item);
  if (!b) return "Use whole-number positions and quarter turns.";
  if (Math.abs(b.x) + b.w / 2 > ROOM_BOUNDS.x || Math.abs(b.z) + b.d / 2 > ROOM_BOUNDS.z) return "That item would be outside the room.";
  if ((Array.isArray(items) ? items : []).some(other => {
    if (item.id && other?.id === item.id) return false;
    const a = furnitureBounds(other);
    return a && Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2;
  })) return "That space is occupied. Choose an empty spot.";
  return "";
}
export function validPlacement(items, item) { return !placementError(items, item); }
export function findFreePlacement(items, item) {
  if (!furnitureBounds({ ...item, x: 0, z: 0 })) return null;
  const positions = [];
  for (let z = -6; z <= 6; z++) for (let x = -7; x <= 7; x++) positions.push({ x, z });
  positions.sort((a, b) => a.x ** 2 + a.z ** 2 - b.x ** 2 - b.z ** 2 || a.z - b.z || a.x - b.x);
  for (const position of positions) {
    const next = { ...item, ...position };
    if (validPlacement(items, next)) return next;
  }
  return null;
}
export function normalizeClubhouse(value, trophies = false) {
  const items = [];
  for (const item of (Array.isArray(value?.items) ? value.items : []).slice(0, 256)) {
    if (items.length >= MAX_FURNITURE) break;
    if (typeof item?.id !== "string" || !/^[a-z0-9-]{1,40}$/.test(item.id) || items.some(i => i.id === item.id) || item.kind === "trophy" && trophies !== true) continue;
    const next = { id: item.id, kind: item.kind, x: item.x, z: item.z, rotation: item.rotation, color: color(item.color) };
    if (validPlacement(items, next)) items.push(next);
  }
  return { version: 1, accent: color(value?.accent), items };
}
export function defaultClubhouse() {
  return normalizeClubhouse({ items: [
    { id: "starter-sofa", kind: "sofa", x: -4, z: -4, rotation: 0 },
    { id: "starter-table", kind: "table", x: -4, z: -1, rotation: 0 },
    { id: "starter-arcade", kind: "arcade", x: 5, z: -5, rotation: 0, color: "#a68bbd" },
    { id: "starter-plant", kind: "plant", x: -6, z: -5, rotation: 0 }
  ] });
}
