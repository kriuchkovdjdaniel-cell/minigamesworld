export function paintStroke(data, size, from, to, color, brush = 1, mirror = false, resolution = size) {
  const pixels = data.split("");
  const scale = size / resolution;
  let [x, y] = from.map(Math.floor);
  const [tx, ty] = to.map(Math.floor);
  if (![x, y, tx, ty].every(Number.isFinite)) return data;
  const dx = Math.abs(tx - x), dy = -Math.abs(ty - y), sx = x < tx ? 1 : -1, sy = y < ty ? 1 : -1;
  let error = dx + dy;
  const stamp = (px, py) => {
    for (let by = 0; by < brush; by++) for (let bx = 0; bx < brush; bx++) {
      const gx = px + bx - Math.floor((brush - 1) / 2), gy = py + by - Math.floor((brush - 1) / 2);
      if (gx < 0 || gy < 0 || gx >= resolution || gy >= resolution) continue;
      for (let yy = 0; yy < scale; yy++) for (let xx = 0; xx < scale; xx++) {
        const ax = gx * scale + xx, ay = gy * scale + yy;
        pixels[ay * size + ax] = color;
        if (mirror) pixels[ay * size + size - 1 - ax] = color;
      }
    }
  };
  // Bresenham interpolation keeps fast pointer strokes continuous.
  for (let steps = 0; steps < resolution * 4; steps++) {
    stamp(x, y);
    if (x === tx && y === ty) break;
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x += sx; }
    if (twice <= dx) { error += dx; y += sy; }
  }
  return pixels.join("");
}

export function fillPixels(data, size, x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) return data;
  const start = y * size + x, original = data[start];
  if (original === color) return data;
  const pixels = data.split(""), stack = [start];
  pixels[start] = color;
  while (stack.length) {
    const index = stack.pop(), px = index % size;
    for (const next of [px > 0 ? index - 1 : -1, px < size - 1 ? index + 1 : -1, index - size, index + size]) {
      if (next >= 0 && next < pixels.length && pixels[next] === original) {
        pixels[next] = color;
        stack.push(next);
      }
    }
  }
  return pixels.join("");
}

export function transformPixels(data, size, operation) {
  return Array.from({ length: data.length }, (_, index) => {
    const x = index % size, y = Math.floor(index / size);
    if (operation === "flip-h") return data[y * size + size - 1 - x];
    if (operation === "flip-v") return data[(size - 1 - y) * size + x];
    return data[(size - 1 - x) * size + y];
  }).join("");
}

export function createHistory(limit = 60) {
  const past = [], future = [];
  return {
    commit(before, after) { if (before !== after) { past.push(before); if (past.length > limit) past.shift(); future.length = 0; } },
    undo(current) { if (!past.length) return current; future.push(current); return past.pop(); },
    redo(current) { if (!future.length) return current; past.push(current); return future.pop(); },
    clear() { past.length = 0; future.length = 0; },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; }
  };
}
