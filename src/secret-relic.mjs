import * as THREE from "three";
export function relicPosition(game, level) {
  if (game === "crystal-isles-3d") { const box = level.boxes?.[level.boxes.length - 2]; return box ? { x: box.x + box.w / 2 - 0.9, y: box.y + box.h / 2 + 0.8, z: box.z - box.d / 2 + 0.9 } : null; }
  if (game === "dodger") return { x: -10, y: 0.85, z: -10 };
  if (game === "coin-rush") return { x: 10, y: 0.85, z: -10 };
  return null;
}
export function mountRelic(scene, game, level, options, signal) {
  const point = relicPosition(game, level), id = `${game}:${level.levelIndex ?? level.index ?? 0}`;
  if (signal.aborted || !point || options?.found?.includes(id)) return { update() {} };
  const geometry = new THREE.OctahedronGeometry(0.42), material = new THREE.MeshStandardMaterial({ color: "#73d9b1", metalness: 0.6, roughness: 0.25, emissive: "#174d3c", emissiveIntensity: 0.25 });
  const mesh = new THREE.Mesh(geometry, material); mesh.position.copy(point); mesh.castShadow = true; scene.add(mesh);
  let claimed = false, pending = false, retry = 0, disposed = false;
  signal.addEventListener("abort", () => { disposed = true; scene.remove(mesh); geometry.dispose(); material.dispose(); }, { once: true });
  return { id, position: point, update(position, elapsed) {
    if (disposed || claimed) return;
    mesh.rotation.y = elapsed * 0.8; mesh.position.y = point.y + Math.sin(elapsed * 2) * 0.12;
    if (pending || elapsed < retry || !options?.collect || Math.hypot(position.x - point.x, position.y - point.y, position.z - point.z) > 1.1) return;
    pending = true;
    Promise.resolve().then(() => options.collect(id)).then(() => { claimed = true; mesh.visible = false; }, () => { retry = elapsed + 5; }).finally(() => { pending = false; });
  } };
}
