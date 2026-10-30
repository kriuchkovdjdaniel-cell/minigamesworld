export const BOMB_MAPS = Object.freeze([
  { id: "rooftops", name: "Rooftops", floor: "#9caebb", trim: "#526b80", obstacles: [[0.27, 0.3, 0.13, 0.09], [0.6, 0.6, 0.13, 0.09], [0.42, 0.45, 0.16, 0.1]] },
  { id: "factory", name: "Factory", floor: "#b2afa1", trim: "#8c7160", obstacles: [[0.25, 0.26, 0.09, 0.23], [0.62, 0.5, 0.07, 0.23], [0.43, 0.31, 0.14, 0.09], [0.43, 0.6, 0.14, 0.09]] },
  { id: "park", name: "Park", floor: "#9ebc95", trim: "#55836e", obstacles: [[0.24, 0.3, 0.16, 0.08], [0.57, 0.62, 0.13, 0.08], [0.45, 0.42, 0.1, 0.16]] }
]);
export function getBombMap(id) { return BOMB_MAPS.find(map => map.id === id) || null; }
export function bombMapObstacles(id, width = 560, height = 560) {
  return (getBombMap(id)?.obstacles || []).map(([x, y, w, h]) => ({ x: x * width, y: y * height, w: w * width, h: h * height }));
}
export function chooseBombMap(players, round, current) {
  const counts = Object.fromEntries(BOMB_MAPS.map(map => [map.id, 0]));
  for (const player of players.slice(0, 5)) if (player.mapVote?.round === round && getBombMap(player.mapVote.map)) counts[player.mapVote.map]++;
  const max = Math.max(...Object.values(counts)), start = (BOMB_MAPS.findIndex(map => map.id === current) + 1) % BOMB_MAPS.length;
  return Array.from({ length: 3 }, (_, i) => BOMB_MAPS[(start + i) % 3]).find(map => counts[map.id] === max).id;
}
