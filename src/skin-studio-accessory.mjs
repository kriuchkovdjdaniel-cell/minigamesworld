import * as THREE from "three";

export function createCustomAccessory(pixels, palette) {
  const cells = [...pixels].slice(0, 256).flatMap((value, index) =>
    /^[0-7]$/.test(value) ? [{ x: index % 16, y: Math.floor(index / 16), color: palette[Number(value)] }] : []);
  if (!cells.length) return null;

  const left = Math.min(...cells.map(cell => cell.x));
  const right = Math.max(...cells.map(cell => cell.x));
  const bottom = Math.max(...cells.map(cell => cell.y));
  const pitch = 1.36 / 16;
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(pitch, pitch, 0.28),
    new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 }),
    cells.length
  );
  const matrix = new THREE.Matrix4();
  // Keep pixel scale fixed, but anchor the painted bounds to the top of the cube.
  cells.forEach((cell, index) => {
    matrix.makeTranslation((cell.x - (left + right) / 2) * pitch, 1 + (bottom - cell.y + 0.5) * pitch, 0);
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, new THREE.Color(cell.color || palette[0]));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return mesh;
}
