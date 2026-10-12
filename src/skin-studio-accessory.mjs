import * as THREE from "three";

export function createCustomAccessory(pixels, palette) {
  const cells = [...pixels].slice(0, 256).flatMap((value, index) =>
    /^[0-7]$/.test(value) ? [{ x: index % 16, y: Math.floor(index / 16), color: palette[Number(value)] }] : []);
  if (!cells.length) return null;

  const pitch = 2.24 / 16;
  const brim = cells.filter(cell => cell.y === 15 && cell.x >= 4 && cell.x <= 11);
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 }),
    cells.length + brim.length
  );
  const matrix = new THREE.Matrix4();
  const stamp = (cell, index, height, depth, z) => {
    matrix.makeScale(pitch, height, depth);
    matrix.setPosition((cell.x - 7.5) * pitch, 1 + height / 2, z);
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, new THREE.Color(cell.color || palette[0]));
  };
  // The drawing is a top view: rows run back-to-front across a flat cap.
  cells.forEach((cell, index) => stamp(cell, index, 0.16, pitch, (cell.y - 7.5) * pitch));
  // Extend only painted front-edge pixels into a short, lower brim.
  brim.forEach((cell, index) => stamp(cell, cells.length + index, 0.08, 0.42, 1.12 + 0.21));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return mesh;
}
