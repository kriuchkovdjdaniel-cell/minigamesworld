import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createCustomAccessory } from "./skin-studio-accessory.mjs";

export function createCollectionScene(scene, level, options) {
  const orchard = level.mode === "catcher", geometries = new Set(), materials = new Map();
  const geo = geometry => { geometries.add(geometry); return geometry; };
  const unit = geo(new THREE.BoxGeometry(1, 1, 1));
  const mat = (color, extra = {}) => {
    const key = color + JSON.stringify(extra);
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.82, ...extra }));
    return materials.get(key);
  };
  const mesh = (geometry, color, x = 0, y = 0, z = 0, parent = scene, extra) => {
    const object = new THREE.Mesh(geometry, mat(color, extra)); object.position.set(x, y, z);
    object.castShadow = object.receiveShadow = true; parent.add(object); return object;
  };
  const box = (x, y, z, w, h, d, color, parent = scene) => { const object = mesh(unit, color, x, y, z, parent); object.scale.set(w, h, d); return object; };
  const ground = orchard ? ["#94b18b", "#9eae93", "#95a790"][level.index] : "#c0c8bf";
  box(0, -0.5, 0, 24, 1, 24, orchard ? "#758f79" : "#708c8b");
  const tiles = new THREE.InstancedMesh(unit, mat(ground), 144), stamp = new THREE.Object3D();
  for (let i = 0; i < 144; i++) {
    stamp.position.set((i % 12 - 5.5) * 2, 0.01, (Math.floor(i / 12) - 5.5) * 2); stamp.scale.set(1.98, 0.03, 1.98); stamp.updateMatrix();
    tiles.setMatrixAt(i, stamp.matrix); tiles.setColorAt(i, new THREE.Color((i + Math.floor(i / 12)) % 2 ? "#ffffff" : "#d6e0d8"));
  }
  tiles.receiveShadow = true; scene.add(tiles);
  box(0, -1.2, 0, 220, 0.2, 220, orchard ? "#739f8a" : "#5c999e");
  for (const side of [-1, 1]) {
    for (const along of [-10, -6, -2, 2, 6, 10]) for (const [x, z] of [[side * 12, along], [along, side * 12]]) {
      box(x, 1.55, z, 0.28, 3.1, 0.28, "#d8d9bd");
      box(x, 3.15, z, 0.42, 0.15, 0.42, orchard ? "#b77788" : "#649eab");
    }
    for (const y of [0.55, 2.8]) { box(side * 12, y, 0, 0.12, 0.12, 24, "#c8d1bc"); box(0, y, side * 12, 24, 0.12, 0.12, "#c8d1bc"); }
  }
  if (orchard) {
    const trunk = geo(new THREE.CylinderGeometry(0.3, 0.45, 3, 6));
    const leaves = geo(new THREE.IcosahedronGeometry(2, 1)), fruit = geo(new THREE.IcosahedronGeometry(0.22, 1));
    const colors = [["#527f64", "#a5bd8a"], ["#8a9d79", "#c7a3ae"], ["#638e80", "#b6ad7c"]][level.index];
    for (let i = 0; i < 24; i++) {
      const angle = i * Math.PI / 12, radius = 18 + i % 3 * 5, x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
      mesh(trunk, "#787965", x, 1.2, z); mesh(leaves, colors[i % 2], x, 3.4, z);
      for (let n = 0; n < 3; n++) mesh(fruit, "#c8677d", x + Math.cos(n * 2) * 1.6, 3.3, z + Math.sin(n * 2) * 1.6);
    }
    for (const x of [-22, 22]) {
      box(x, 1, -8, 7, 4, 7, x < 0 ? "#c98f9b" : "#a1b9c1");
      const roof = mesh(geo(new THREE.ConeGeometry(5.4, 2.5, 4)), "#657b7e", x, 4.2, -8); roof.rotation.y = Math.PI / 4;
      box(x, 0.6, -4.47, 1.6, 3, 0.1, "#566f6a");
      for (const offset of [-2, 2]) box(x + offset, 2, -4.44, 1, 1.2, 0.12, "#d5e4cb");
    }
    for (let i = 0; i < 5; i++) { const hill = mesh(geo(new THREE.IcosahedronGeometry(14, 1)), "#7f9f8d", -45 + i * 22, -4, -48); hill.scale.y = 0.65; }
  } else {
    const colors = ["#719f9c", "#b3a7bd", "#d0bf9a", "#91a8bf"];
    level.obstacles.forEach((building, i) => {
      const b = building; box(b.x, b.h / 2, b.z, b.w, b.h, b.d, colors[i % colors.length]);
      box(b.x, b.h + 0.08, b.z, b.w + 0.1, 0.16, b.d + 0.1, "#4f7877");
      for (const side of [-1, 1]) for (const offset of [-0.65, 0.65]) box(b.x + offset, 1.6, b.z + side * (b.d / 2 + 0.02), 0.6, 0.85, 0.04, "#d7e6d9");
      box(b.x, 0.65, b.z + b.d / 2 + 0.03, 0.7, 1.3, 0.05, "#435d61");
      box(b.x, b.h + 0.45, b.z, 0.3, 0.9, 0.3, "#647b7d");
    });
    for (const side of [-1, 1]) {
      box(side * 21, -0.5, 0, 10, 0.65, 46, "#a5ac99");
      for (let i = 0; i < 5; i++) {
        const z = -18 + i * 9;
        box(side * 22, 1 + i % 2, z, 5, 3 + i % 2 * 2, 4, colors[i % 4]);
        for (let n = 0; n < 4; n++) box(side * 19.45, 1.2, z - 1.5 + n, 0.1, 1.2, 0.08, "#e1d6bb");
      }
      box(side * 17, 6, -17, 0.6, 13, 0.6, "#c7b878");
      box(side * 17, 12.5, -13, 0.5, 0.5, 13, "#c7b878");
      box(side * 17, 8.5, -7, 0.07, 8, 0.07, "#55777c");
      box(side * 17, 4.5, -7, 1.2, 0.2, 1.2, "#55777c");
    }
    for (const x of [-10, 10]) {
      box(x, -0.5, -30, 5, 1.5, 12, "#3e727f"); box(x, 1.1, -31, 3, 2, 4, "#d5dacb");
      box(x, 4, -32, 0.15, 8, 0.15, "#d0c49e");
    }
  }
  // Immobile scenery shares material batches; gameplay objects stay independent.
  const batches = new Map();
  for (const object of [...scene.children]) {
    if (!object.isMesh || object.isInstancedMesh) continue;
    object.updateMatrix();
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone(); geometry.applyMatrix4(object.matrix);
    if (!batches.has(object.material)) batches.set(object.material, []);
    batches.get(object.material).push(geometry); scene.remove(object);
  }
  for (const [material, parts] of batches) {
    const object = new THREE.Mesh(geo(mergeGeometries(parts)), material); object.castShadow = object.receiveShadow = true; scene.add(object);
    parts.forEach(part => part.dispose());
  }
  const player = new THREE.Group(); scene.add(player);
  let playerMaterial = mat(options.color || "#4ba6a4");
  if (/^[0-7]{4096}$/.test(options.pixelSkin || "")) {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64; const ctx = canvas.getContext("2d");
    for (let i = 0; i < 4096; i++) { ctx.fillStyle = options.palette?.[+options.pixelSkin[i]] || "#4ba6a4"; ctx.fillRect(i % 64, Math.floor(i / 64), 1, 1); }
    const texture = new THREE.CanvasTexture(canvas); texture.magFilter = texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false; texture.colorSpace = THREE.SRGBColorSpace;
    playerMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8 }); materials.set("player", playerMaterial);
  }
  const cube = new THREE.Mesh(geo(new RoundedBoxGeometry(0.88, 0.9, 0.88, 2, 0.05)), playerMaterial); cube.castShadow = cube.receiveShadow = true; player.add(cube);
  for (const x of [-0.19, 0.19]) box(x, 0.07, -0.45, 0.12, 0.18, 0.05, "#f2f0db", player);
  if (orchard) {
    box(0, 0.5, 0, 1.4, 0.1, 1.4, "#c7b888", player);
    for (const side of [-1, 1]) { box(side * 0.68, 0.65, 0, 0.08, 0.3, 1.4, "#b7a67f", player); box(0, 0.65, side * 0.68, 1.4, 0.3, 0.08, "#b7a67f", player); }
  }
  if (options.accessory === "custom" && /^[.0-7]{256}$/.test(options.accessoryPixels || "")) {
    const cap = createCustomAccessory(options.accessoryPixels, options.palette || []);
    if (cap) { cap.scale.setScalar(0.45); cap.rotation.y = Math.PI; cap.position.y = orchard ? 0.35 : 0; player.add(cap); geometries.add(cap.geometry); materials.set("cap", cap.material); }
  }
  const coinGeo = geo(new THREE.CylinderGeometry(0.43, 0.43, 0.13, 14)), coinRim = geo(new THREE.TorusGeometry(0.29, 0.035, 4, 14));
  const coins = level.coins.map(p => {
    const group = new THREE.Group(); group.position.copy(p); scene.add(group);
    mesh(coinGeo, "#e0ca79", 0, 0, 0, group, { metalness: 0.35, roughness: 0.4 }).rotation.x = Math.PI / 2;
    mesh(coinRim, "#fcf0b9", 0, 0, 0.08, group); return group;
  });
  const shields = level.shields.map(p => mesh(geo(new THREE.OctahedronGeometry(0.65)), "#87cce5", p.x, p.y, p.z, scene, { emissive: "#347e98", emissiveIntensity: 0.25 }));
  const enemies = level.enemies.map(() => {
    const group = new THREE.Group(); scene.add(group);
    mesh(geo(new RoundedBoxGeometry(1.05, 1, 1.05, 1, 0.1)), "#b5677c", 0, 0, 0, group);
    box(0, 0.12, 0.54, 0.75, 0.2, 0.06, "#f1d593", group);
    box(0, 0.58, 0, 0.3, 0.16, 0.3, "#dc9baa", group); return group;
  });
  const gate = orchard ? null : mesh(geo(new THREE.TorusGeometry(1.15, 0.13, 6, 36)), "#a3a8b8", level.spawn.x, 1.3, level.spawn.z);
  const aura = mesh(geo(new THREE.TorusGeometry(0.95, 0.05, 5, 40)), "#94d7e5", 0, 0.08, 0); aura.rotation.x = Math.PI / 2;
  const appleGeo = geo(new THREE.SphereGeometry(0.32, 10, 8)), rockGeo = geo(new THREE.IcosahedronGeometry(0.45, 0)), leafGeo = geo(new THREE.SphereGeometry(0.13, 5, 4));
  const ringGeo = geo(new THREE.RingGeometry(0.63, 0.73, 28)), dropMeshes = new Map();
  function update(sim) {
    const s = sim.state; player.position.copy(sim.body.translation()); player.visible = s.invulnerable <= 0 || Math.floor(s.elapsed * 12) % 2 === 0;
    aura.visible = s.shield > 0 || s.dash > 0; aura.position.set(player.position.x, 0.1, player.position.z);
    coins.forEach((m, i) => { m.visible = !s.collected.has(i); m.rotation.y = s.elapsed * 1.5; m.position.y = 0.8 + Math.sin(s.elapsed * 2 + i) * 0.12; });
    shields.forEach((m, i) => { m.visible = !s.usedShields.has(i); m.rotation.y = s.elapsed; });
    enemies.forEach((m, i) => { m.position.copy(s.enemies[i]); m.rotation.y = Math.atan2(player.position.x - m.position.x, player.position.z - m.position.z); });
    if (gate) gate.material.color.set(s.gateOpen ? "#d8eeb2" : "#a3a8b8");
    const live = new Set(s.drops.map(d => d.id));
    for (const [id, item] of dropMeshes) if (!live.has(id)) { scene.remove(item.fruit, item.marker); dropMeshes.delete(id); }
    for (const drop of s.drops) {
      if (!dropMeshes.has(drop.id)) {
        const fruit = new THREE.Group(); scene.add(fruit);
        if (drop.kind === "apple") {
          const apple = mesh(appleGeo, "#d45f77", 0, 0, 0, fruit); apple.scale.y = 0.9;
          box(0, 0.33, 0, 0.06, 0.22, 0.06, "#697b5f", fruit);
          const leaf = mesh(leafGeo, "#719b68", 0.12, 0.36, 0, fruit); leaf.scale.set(1.5, 0.25, 0.7);
        } else mesh(rockGeo, "#697d8c", 0, 0, 0, fruit);
        const marker = mesh(ringGeo, drop.kind === "apple" ? "#d9eed1" : "#e19caa", drop.x, 0.06, drop.z, scene, { side: THREE.DoubleSide }); marker.rotation.x = -Math.PI / 2;
        dropMeshes.set(drop.id, { fruit, marker });
      }
      const { fruit, marker } = dropMeshes.get(drop.id);
      fruit.visible = drop.phase === "falling"; fruit.position.set(drop.x, drop.y, drop.z); fruit.rotation.y = s.elapsed;
      marker.scale.setScalar(drop.phase === "warning" ? 1 + Math.sin(s.elapsed * 5) * 0.12 : 1);
    }
  }
  return { player, update, dispose() {
    scene.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
    geometries.forEach(g => g.dispose()); materials.forEach(m => { m.map?.dispose(); m.dispose(); }); dropMeshes.clear();
  } };
}
