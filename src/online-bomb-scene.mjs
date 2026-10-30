import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createCustomAccessory } from "./skin-studio-accessory.mjs";
import { getBombMap, bombMapObstacles } from "./bomb-maps.mjs";

export function makeBombScene(parent, width, depth, mapId = "") {
  const scene = new THREE.Group(); parent.add(scene);
  const map = getBombMap(mapId);
  const geometries = new Set(), materials = new Map();
  const geo = g => { geometries.add(g); return g; };
  const material = color => { if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.85 })); return materials.get(color); };
  const unit = geo(new THREE.BoxGeometry(1, 1, 1));
  const box = (x, y, z, w, h, d, color) => {
    const mesh = new THREE.Mesh(unit, material(color)); mesh.position.set(x, y, z); mesh.scale.set(w, h, d); scene.add(mesh); return mesh;
  };
  box(0, mapId === "rooftops" ? -10 : -0.6, 0, width + 1, mapId === "rooftops" ? 20 : 1.2, depth + 1, "#637e79");
  box(0, mapId === "rooftops" ? -21 : -1.6, 0, 240, 0.2, 240, mapId === "factory" ? "#849593" : "#7eaa9e");
  for (let x = 0; x < 14; x++) for (let z = 0; z < 14; z++) box((x - 6.5) * width / 14, 0.01, (z - 6.5) * depth / 14, width / 14 - 0.025, 0.03, depth / 14 - 0.025, (x + z) % 2 ? "#b6c9bd" : "#a7bcb1");
  for (const sign of [-1, 1]) {
    box(sign * (width / 2 - 0.3), 0.45, 0, 0.25, 0.9, depth, "#5b8582");
    box(0, 0.45, sign * (depth / 2 - 0.3), width, 0.9, 0.25, "#5b8582");
    for (let i = -6; i <= 6; i += 2) {
      box(i * width / 14, 0.95, sign * (depth / 2 - 0.3), 0.45, 0.12, 0.4, "#e0cc98");
      box(sign * (width / 2 - 0.3), 0.95, i * depth / 14, 0.4, 0.12, 0.45, "#e0cc98");
    }
    for (let row = 0; row < 3; row++) {
      box(sign * (width / 2 + 4 + row), row * 0.6, 0, 1, 0.6, depth - 2, row % 2 ? "#b699af" : "#76949c");
    }
    for (const z of [-depth / 2 - 4, depth / 2 + 4]) {
      box(sign * (width / 2 + 2), 4, z, 0.3, 10, 0.3, "#4f7274");
      box(sign * (width / 2 + 2), 9, z, 2, 0.4, 1, "#d8d6b5");
    }
    for (let i = -2; i <= 2; i++) {
      const x = i * 8, z = sign * (depth / 2 + 16), h = 6 + (i + 3) % 3 * 3;
      box(x, h / 2 - 1, z, 6, h, 5, ["#96a9bc", "#b799ac", "#afbb9e"][(i + 3) % 3]);
      box(x, h - 0.7, z, 6.3, 0.4, 5.3, "#567e7a");
      for (let floor = 1; floor < h - 1; floor += 2) for (const dx of [-1.5, 1.5]) box(x + dx, floor, z - sign * 2.53, 0.9, 1.2, 0.05, "#d8ddc3");
    }
    for (const x of [-width / 2 - 3, width / 2 + 3]) {
      box(x, 0, sign * (depth / 2 + 7), 4, 1.6, 3, "#92a3a0");
      const canopy = new THREE.Mesh(geo(new THREE.IcosahedronGeometry(2, 1)), material("#699881")); canopy.position.set(x, 1.4, sign * (depth / 2 + 7)); scene.add(canopy);
    }
  }
  const marking = new THREE.Mesh(geo(new THREE.RingGeometry(3.8, 3.9, 64)), material("#e1cfaa")); marking.rotation.x = -Math.PI / 2; marking.position.y = 0.04; scene.add(marking);
  box(0, 0.05, 0, 0.08, 0.02, depth - 1, "#d1d7be");
  if (map) {
    box(0, 0.07, 0, width - 1, 0.05, depth - 1, map.floor);
    for (const obstacle of bombMapObstacles(map.id, width, depth)) {
      const x = obstacle.x + obstacle.w / 2 - width / 2, z = obstacle.y + obstacle.h / 2 - depth / 2;
      box(x, 0.65, z, obstacle.w, 1.3, obstacle.h, map.trim);
      if (map.id === "rooftops") {
        box(x, 1.35, z, obstacle.w + 0.1, 0.12, obstacle.h + 0.1, "#d2d9d8");
        for (let i = -1; i <= 1; i++) box(x + i * obstacle.w / 4, 1.44, z, 0.1, 0.06, obstacle.h * 0.8, "#4b6471");
      } else if (map.id === "factory") {
        box(x, 1.35, z, obstacle.w, 0.1, obstacle.h, "#cfb979");
        for (let i = -1; i <= 1; i++) box(x, 1.43, z + i * obstacle.h / 4, obstacle.w * 0.8, 0.06, 0.13, "#545d61");
      } else {
        box(x, 1.4, z, obstacle.w * 0.88, 0.25, obstacle.h * 0.88, "#67975b");
        for (const sign of [-1, 1]) box(x + sign * obstacle.w / 4, 1.62, z, 0.3, 0.18, 0.3, "#cbb1cf");
      }
    }
    if (map.id === "factory") {
      for (const side of [-1, 1]) {
        box(side * (width / 2 + 9), 4, -depth / 2 - 7, 10, 10, 8, "#728991");
        box(side * (width / 2 + 9), 9.2, -depth / 2 - 7, 10.5, 0.5, 8.5, "#a6b2b3");
        box(side * (width / 2 + 9), 1.8, -depth / 2 - 2.9, 5, 5, 0.1, "#b3a47f");
        for (let h = 0; h < 5; h++) box(side * (width / 2 + 9), h - 0.2, -depth / 2 - 2.8, 5, 0.06, 0.1, "#728184");
        box(side * (width / 2 + 12), 10, -depth / 2 - 9, 1.7, 22, 1.7, "#a99b8f");
        box(side * (width / 2 + 12), 19, -depth / 2 - 9, 1.85, 1.5, 1.85, "#c9c9b5");
      }
    }
    if (map.id === "rooftops") {
      for (const side of [-1, 1]) for (let i = -2; i <= 2; i++) {
        box(side * (width / 2 + 0.55), -9, i * 4.7, 0.05, 14, 2, "#9cb2bc");
        box(i * 4.7, -9, side * (depth / 2 + 0.55), 2, 14, 0.05, "#9cb2bc");
      }
    }
    if (map.id === "park") {
      for (const side of [-1, 1]) for (let i = -2; i <= 2; i++) {
        box(i * 5, 0.4, side * (depth / 2 + 5), 2.5, 0.18, 0.8, "#a79279");
        box(i * 5, 0.85, side * (depth / 2 + 5.3), 2.5, 0.7, 0.1, "#a79279");
        box(i * 5 - 0.9, 0, side * (depth / 2 + 5), 0.12, 0.8, 0.7, "#526e6d");
        box(i * 5 + 0.9, 0, side * (depth / 2 + 5), 0.12, 0.8, 0.7, "#526e6d");
      }
    }
  }
  // All fixed scenery is grouped by material to keep the multiplayer view inexpensive.
  const batches = new Map();
  for (const object of [...scene.children]) if (object.isMesh) {
    object.updateMatrix(); const part = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone(); part.applyMatrix4(object.matrix);
    if (!batches.has(object.material)) batches.set(object.material, []);
    batches.get(object.material).push(part); scene.remove(object);
  }
  for (const [mat, parts] of batches) { const object = new THREE.Mesh(geo(mergeGeometries(parts)), mat); object.castShadow = object.receiveShadow = true; scene.add(object); parts.forEach(p => p.dispose()); }
  const bomb = new THREE.Group(); scene.add(bomb);
  const shell = new THREE.Mesh(geo(new THREE.SphereGeometry(0.48, 18, 12)), material("#35454b")); shell.castShadow = true; bomb.add(shell);
  const fuse = new THREE.Mesh(geo(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.45, 0), new THREE.Vector3(0.5, 0.8, 0), new THREE.Vector3(0.35, 1, 0)), 8, 0.045, 5, false)), material("#ddbf83")); bomb.add(fuse);
  const ember = new THREE.Mesh(geo(new THREE.IcosahedronGeometry(0.1, 0)), new THREE.MeshBasicMaterial({ color: "#ffcb76" })); ember.position.set(0.35, 1, 0); bomb.add(ember); materials.set("ember", ember.material);
  const ring = new THREE.Mesh(geo(new THREE.TorusGeometry(1.05, 0.055, 6, 48)), material("#cf7b83")); ring.rotation.x = -Math.PI / 2; scene.add(ring);
  const burstMaterial = new THREE.MeshBasicMaterial({ color: "#e7b479", transparent: true, opacity: 0, depthWrite: false }); materials.set("burst", burstMaterial);
  const burst = new THREE.Mesh(geo(new THREE.SphereGeometry(1, 16, 8)), burstMaterial); scene.add(burst); burst.visible = false;
  return { bomb, ring, ember, burst, dispose() { parent.remove(scene); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); } };
}

export function makeBombAvatar(player) {
  const group = new THREE.Group(), geometries = [], materials = [], textures = [];
  const add = (geometry, material, x, y, z) => {
    geometries.push(geometry); materials.push(material);
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); return mesh;
  };
  const mat = new THREE.MeshStandardMaterial({ color: player.color, roughness: 0.8 });
  if (player.skin) {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64; const ctx = canvas.getContext("2d");
    [...player.skin].forEach((value, i) => { ctx.fillStyle = player.palette[+value]; ctx.fillRect(i % 64, Math.floor(i / 64), 1, 1); });
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false;
    mat.map = texture; mat.color.set("#ffffff"); textures.push(texture);
  }
  add(new RoundedBoxGeometry(1, 1, 1, 2, 0.05), mat, 0, 0.5, 0);
  for (const x of [-0.21, 0.21]) add(new THREE.BoxGeometry(0.13, 0.18, 0.04), new THREE.MeshStandardMaterial({ color: "#eff7e8" }), x, 0.57, -0.51);
  if (player.accessory) {
    const cap = createCustomAccessory(player.accessory, player.palette);
    if (cap) { cap.scale.setScalar(0.5); cap.position.y = 0.5; cap.rotation.y = Math.PI; group.add(cap); geometries.push(cap.geometry); materials.push(cap.material); }
  }
  group.scale.setScalar(player.size);
  group.rotation.y = Math.PI;
  const canvas = document.createElement("canvas"); const ctx = canvas.getContext("2d");
  let size = 48; ctx.font = `600 ${size}px Arial`; while (ctx.measureText(player.name).width > 480 && size > 24) ctx.font = `600 ${--size}px Arial`;
  canvas.width = Math.ceil(Math.min(512, ctx.measureText(player.name).width + 32)); canvas.height = 80;
  ctx.fillStyle = "#203c36e6"; ctx.beginPath(); ctx.roundRect(0, 0, canvas.width, 80, 12); ctx.fill();
  ctx.font = `600 ${size}px Arial`; ctx.fillStyle = "#f3f7ed"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(player.name, canvas.width / 2, 40);
  const labelTexture = new THREE.CanvasTexture(canvas); labelTexture.colorSpace = THREE.SRGBColorSpace; textures.push(labelTexture);
  const labelMaterial = new THREE.SpriteMaterial({ map: labelTexture, depthTest: false }); materials.push(labelMaterial);
  const label = new THREE.Sprite(labelMaterial); label.scale.set(canvas.width / 80, 1, 1);
  return { group, label, dispose() { group.traverse(o => { if (o.isInstancedMesh) o.dispose(); }); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); } };
}
