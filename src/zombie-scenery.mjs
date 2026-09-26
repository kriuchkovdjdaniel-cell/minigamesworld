import * as THREE from "three";
import { STOPS } from "./zombie-world.mjs";

const LOOKS = {
  garage: ["#447c73", "#ded7b6", "#405660"], diner: ["#ac6869", "#e4dace", "#596674"],
  motel: ["#c5ad89", "#eee1bd", "#557b7a"], workshop: ["#789292", "#bfc6bb", "#4e666b"],
  market: ["#72987f", "#ead4aa", "#596a64"], ranger: ["#9b8065", "#d1cdb4", "#547263"],
  bakery: ["#9a839c", "#e6d4c0", "#775e72"], house: ["#819aa5", "#d8d8c9", "#586e87"],
  clinic: ["#c6d1c7", "#dfdfc9", "#57868b"], security: ["#70868a", "#c2c8b6", "#495d62"],
  warehouse: ["#8f9991", "#c4c4b0", "#5d6968"], radio: ["#bba886", "#e0d4b3", "#627985"]
};

export function buildRoadScenery({ scene, road, box, material, label, boxGeo, cylinderGeo, coneGeo, geometries, textures, quality }) {
  const roofs = [], transform = new THREE.Object3D();
  const put = (x, y, z, w, h, d, color) => box(scene, x, y, z, w, h, d, color, true);
  const batches = (records, parent) => {
    const colors = new Map();
    for (const item of records) { const color = item[6]; if (!colors.has(color)) colors.set(color, []); colors.get(color).push(item); }
    for (const [color, items] of colors) {
      const batch = new THREE.InstancedMesh(boxGeo, material(color), items.length);
      items.forEach(([x, y, z, w, h, d], i) => { transform.position.set(x, y, z); transform.scale.set(w, h, d); transform.updateMatrix(); batch.setMatrixAt(i, transform.matrix); });
      batch.castShadow = batch.receiveShadow = true; parent.add(batch);
    }
  };
  const groundCanvas = document.createElement("canvas"); groundCanvas.width = groundCanvas.height = 128;
  const groundContext = groundCanvas.getContext("2d"); groundContext.fillStyle = "#93aa91"; groundContext.fillRect(0, 0, 128, 128);
  let seed = 2345;
  for (let i = 0; i < 450; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const x = seed >>> 25;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const y = seed >>> 25;
    groundContext.fillStyle = i % 2 ? "#8aa28b" : "#9eb196"; groundContext.fillRect(x, y, 2, 2);
  }
  const groundTexture = new THREE.CanvasTexture(groundCanvas); groundTexture.colorSpace = THREE.SRGBColorSpace; groundTexture.wrapS = groundTexture.wrapT = THREE.RepeatWrapping; groundTexture.repeat.set(32, 65); textures.push(groundTexture);
  const groundGeo = new THREE.PlaneGeometry(190, 410); geometries.add(groundGeo);
  const groundMaterial = material("#83a08c"); groundMaterial.map = groundTexture;
  const ground = new THREE.Mesh(groundGeo, groundMaterial); ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.015, -145); ground.receiveShadow = true; scene.add(ground);
  put(0, 0.015, -145, 13, 0.04, 380, "#4c565b");
  for (const side of [-1, 1]) { put(side * 6.15, 0.043, -145, 0.13, 0.025, 370, "#dedbc6"); put(side * 7.25, 0.025, -145, 1.4, 0.05, 375, "#999f96"); }
  for (let z = 28; z > -320; z -= 9) put(0, 0.045, z, 0.16, 0.025, 4, "#d3c58d");

  for (const b of road.buildings) {
    const [wall, trim, roofColor] = LOOKS[b.kind], front = b.z + b.d / 2, upper = [];
    const up = (...args) => upper.push(args);
    const roof = new THREE.Group(); scene.add(roof); roofs.push({ mesh: roof, building: b });
    put(b.x, 0.03, b.z + 1, b.w + 1.6, 0.06, b.d + 4.5, "#adb6af");
    for (const w of road.walls.filter(w => w.buildingId === b.id)) put(w.x, w.y, w.z, w.w, w.h, w.d, wall);
    for (const side of [-1, 1]) {
      put(b.x + side * b.w / 2, 0.25, b.z, 0.6, 0.5, b.d, trim);
      put(b.x + side * b.w / 2, 3.9, b.z, 0.6, 0.18, b.d + 0.3, trim);
      for (const dz of [-2.8, 1]) {
        put(b.x + side * (b.w / 2 + 0.28), 2.1, b.z + dz, 0.09, 1.7, 2, trim);
        put(b.x + side * (b.w / 2 + 0.34), 2.1, b.z + dz, 0.05, 1.4, 1.65, "#466c79");
        put(b.x + side * (b.w / 2 + 0.38), 2.1, b.z + dz, 0.06, 0.09, 1.7, trim);
      }
      const panelX = b.x + side * (b.w / 2 - 0.85);
      put(panelX, 1.9, front + 0.28, 1.4, 1.9, 0.06, trim);
      put(panelX, 1.9, front + 0.33, 1.12, 1.6, 0.05, "#375b69");
      put(panelX, 1.9, front + 0.37, 1.14, 0.09, 0.04, trim);
      put(b.x + side * 3.1, 1.6, front + 0.05, 0.17, 3.2, 0.6, trim);
    }
    put(b.x, 3.2, front + 0.2, 6.3, 0.24, 0.8, trim);
    const sign = label(b.name, "#f1e6c8", roofColor);
    sign.position.set(b.x, b.kind === "garage" ? 4.15 : 3.63, front + (b.kind === "garage" ? 5.5 : 0.38));
    sign.scale.set(b.w / (b.kind === "garage" ? 7.5 : 5.8), b.kind === "garage" ? 0.42 : 0.66, 1); scene.add(sign);
    const tiled = ["diner", "clinic", "bakery", "market"].includes(b.kind);
    for (let row = 0; row < 4; row++) for (let col = 0; col < 5; col++) put(b.x - b.w / 2 + 1 + col * (b.w - 2) / 4, 0.025, b.z - 3 + row * 2, (b.w - 2) / 4, 0.025, 2, tiled ? (row + col) % 2 ? "#cbd1c5" : "#93a6a0" : "#b1aa95");
    put(b.x, 0.65, b.z - b.d / 2 + 1.1, b.w - 2, 1.3, 0.9, roofColor);
    put(b.x, 1.35, b.z - b.d / 2 + 1.1, b.w - 1.8, 0.12, 1.05, trim);
    for (let i = -1; i <= 1; i++) {
      put(b.x + i * 2.6, 1.7, b.z - b.d / 2 + 1.1, 0.75, 0.55, 0.65, i === 0 ? "#a08074" : "#739889");
      put(b.x + i * 2.6, 2.7, b.z - b.d / 2 + 0.4, 1.8, 0.12, 0.65, trim);
    }
    up(b.x, 4.15, b.z, b.w + 0.7, 0.3, b.d + 0.7, trim);
    if (["motel", "house", "bakery", "market", "radio"].includes(b.kind)) {
      up(b.x, 5.55, b.z, b.w - 0.2, 2.7, b.d - 0.2, wall);
      for (let i = -1; i <= 1; i++) {
        up(b.x + i * 2.8, 5.5, front + 0.04, 1.7, 1.6, 0.12, trim);
        up(b.x + i * 2.8, 5.5, front + 0.12, 1.4, 1.32, 0.08, "#476575");
        up(b.x + i * 2.8, 5.5, front + 0.18, 0.09, 1.35, 0.06, trim);
      }
      for (let i = 0; i < 4; i++) up(b.x, 7 + i * 0.22, b.z, b.w + 1 - i * 1.3, 0.24, b.d + 1, roofColor);
      up(b.x + b.w / 2 - 1.8, 7.9, b.z - 2, 0.8, 1.5, 0.8, "#8f8177");
    } else {
      up(b.x, 4.4, b.z, b.w + 1, 0.25, b.d + 1, roofColor);
      up(b.x + 2.5, 4.9, b.z - 1.5, 1.8, 0.9, 1.8, "#adb6ae");
      for (let i = -2; i <= 2; i++) up(b.x + 2.5 + i * 0.25, 5.4, b.z - 1.5, 0.1, 0.08, 1.4, "#647773");
    }
    if (["diner", "market", "bakery"].includes(b.kind)) {
      for (let i = 0; i < 8; i++) up(b.x - b.w / 2 + (i + 0.5) * b.w / 8, 3.03, front + 1.2, b.w / 8, 0.22, 2.4, i % 2 ? trim : wall);
      for (const side of [-1, 1]) {
        put(b.x + side * 3.8, 0.8, front + 2.4, 1.5, 0.12, 1.1, roofColor);
        put(b.x + side * 3.8, 0.4, front + 2.4, 0.2, 0.8, 0.2, "#5d6c69");
        put(b.x + side * 3.8, 0.43, front + 3.25, 1.5, 0.18, 0.45, wall);
      }
    }
    if (b.kind === "clinic") {
      up(b.x, 5.3, b.z, 1.7, 0.48, 0.4, "#a76872"); up(b.x, 5.3, b.z, 0.48, 1.7, 0.4, "#a76872");
    }
    if (b.kind === "garage") {
      for (const dx of [-2, 2]) {
        put(b.x + dx, 0.9, front + 4, 0.9, 1.8, 0.65, "#d2c5a4"); put(b.x + dx, 1.3, front + 4.36, 0.65, 0.55, 0.08, "#243c3e");
        put(b.x + dx + 0.5, 0.85, front + 4, 0.08, 1.2, 0.15, "#394b49");
      }
      up(b.x, 4.2, front + 3.9, 9, 0.4, 3, "#d2c5a4"); up(b.x, 4.15, front + 5.42, 9.1, 0.35, 0.07, wall);
      for (const side of [-1, 1]) put(b.x + side * 4.1, 2, front + 4, 0.22, 4, 0.22, "#758982");
    }
    batches(upper, roof);
  }

  // Backdrop streets extend the settlement beyond the playable, fenced roadside.
  for (let i = 0; i < 10; i++) {
    const side = i % 2 ? 1 : -1, x = side * (40 + i % 3 * 7), z = 4 - Math.floor(i / 2) * 67, height = 4 + i % 3 * 2;
    const color = ["#8d9a96", "#98879a", "#83a0a1"][i % 3];
    put(x, height / 2, z, 11, height, 13, color); put(x, height + 0.2, z, 12, 0.4, 14, "#546d74");
    for (const dx of [-3, 0, 3]) { put(x + dx, height - 1.4, z + 6.55, 1.5, 1.7, 0.1, "#b8cbbf"); put(x + dx, height - 1.4, z + 6.62, 1.2, 1.4, 0.06, "#466677"); }
  }
  for (let z = 28; z > -320; z -= 8) for (const side of [-1, 1]) {
    put(side * 29.4, 0.75, z, 0.16, 1.5, 0.16, "#7e8f83");
    for (const y of [0.48, 1.13]) put(side * 29.4, y, z - 4, 0.09, 0.14, 8, "#93a697");
  }
  for (const [index, stop] of STOPS.entries()) {
    const sign = label(stop.name.toUpperCase(), "#f3e3b4", "#395e61"); sign.position.set(9, 3.6, stop.z + 17); sign.scale.setScalar(0.9); scene.add(sign);
    put(9, 1.8, stop.z + 17, 0.14, 3.6, 0.14, "#707b77");
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const z = stop.z + 15 - i * 10;
        put(side * 8.2, 0.1, z, 0.25, 0.2, 9.3, "#c2c8b7");
      }
      put(side * 9.5, 3, stop.z + 7, 0.14, 6, 0.14, "#536b6b");
      put(side * 8.8, 6, stop.z + 7, 1.5, 0.15, 0.18, "#536b6b");
      put(side * 8.2, 5.86, stop.z + 7, 0.5, 0.12, 0.5, "#e0d6af");
      if (index === 2) for (let i = 0; i < 3; i++) { put(side * (9.8 + i * 2.8), 0.5, stop.z - 37, 2.6, 1, 1, "#a6a894"); put(side * (9.8 + i * 2.8), 0.65, stop.z - 36.48, 1.6, 0.16, 0.06, "#d0ba81"); }
    }
  }
  for (let i = 0; i < 12; i++) {
    const z = 18 - i * 29;
    put(27.5, 4.5, z, 0.22, 9, 0.22, "#766c5a"); put(27.5, 8.4, z, 3.2, 0.18, 0.18, "#766c5a"); put(26.5, 8.7, z - 14.5, 0.035, 0.035, 29, "#5c665d");
  }
  const quarantine = label("QUARANTINE ZONE", "#ecddb1", "#575b65"); quarantine.position.set(0, 5.8, -239); quarantine.scale.setScalar(1.6); scene.add(quarantine);
  for (const x of [-8, 8]) put(x, 3, -239, 0.3, 6, 0.3, "#8f9890");
  const sanctuary = label("SAFE HAVEN", "#d4edca", "#315a4c"); sanctuary.position.set(0, 6.5, -304); sanctuary.scale.setScalar(2); scene.add(sanctuary);
  for (const x of [-8, 8]) put(x, 3, -304, 0.6, 6, 0.6, "#626f66");
  put(0, 3, -321, 35, 6, 1, "#8c9b87");
  for (const x of [-26, 26]) {
    put(x, 4.5, -244, 4, 1.3, 4, "#6f8581"); put(x, 6, -244, 4.6, 0.25, 4.6, "#ccd2be");
    for (const dx of [-1.5, 1.5]) for (const dz of [-1.5, 1.5]) put(x + dx, 2.5, -244 + dz, 0.18, 5, 0.18, "#637f77");
  }
  const tank = new THREE.Mesh(cylinderGeo, material("#96b0b3")); tank.position.set(38, 9, -117); tank.scale.set(2.8, 3.5, 2.8); tank.castShadow = true; scene.add(tank);
  for (const dx of [-2, 2]) for (const dz of [-2, 2]) put(38 + dx, 3.8, -117 + dz, 0.22, 7.6, 0.22, "#657a76");
  const count = quality > 0 ? 140 : 80;
  const trunks = new THREE.InstancedMesh(cylinderGeo, material("#72695e"), count);
  const crowns = new THREE.InstancedMesh(coneGeo, material("#487669"), count * 2);
  for (let i = 0; i < count; i++) {
    const x = (i % 2 ? -1 : 1) * (32 + i % 7 * 5), z = 36 - Math.floor(i / 2) * 380 / (count / 2), h = 5 + i % 4;
    transform.position.set(x, 1.8, z); transform.scale.set(0.25, 3.6, 0.25); transform.updateMatrix(); trunks.setMatrixAt(i, transform.matrix);
    for (let layer = 0; layer < 2; layer++) {
      transform.position.set(x, h / 2 + 1.5 + layer * 2, z); transform.scale.set(2.9 - layer * 0.6, h * 0.75, 2.9 - layer * 0.6); transform.updateMatrix(); crowns.setMatrixAt(i * 2 + layer, transform.matrix);
      crowns.setColorAt(i * 2 + layer, new THREE.Color(["#7aa690", "#8ab4a0", "#6d9391"][i % 3]));
    }
  }
  trunks.castShadow = crowns.castShadow = true; scene.add(trunks, crowns);
  for (let i = 0; i < 14; i++) {
    const mountain = new THREE.Mesh(coneGeo, material(i % 2 ? "#7e96a6" : "#9fa4b2"));
    mountain.position.set((i % 2 ? 1 : -1) * (78 + i % 3 * 10), 8, 10 - Math.floor(i / 2) * 55); mountain.scale.set(35, 40 + i % 3 * 10, 40); scene.add(mountain);
  }
  return { roofs, buildingCount: road.buildings.length + 10 };
}
