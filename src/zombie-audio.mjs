export const SOUND_LENGTHS = Object.freeze({ shot: 0.22, reload: 0.7, footstep: 0.14, groan: 1.1, hit: 0.15, hurt: 0.25, melee: 0.2, door: 0.5, loot: 0.32, upgrade: 0.45, heal: 0.35, engine: 1, wind: 3 });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : 0));

export function spatialMix(source, listener, yaw = 0) {
  const dx = source.x - listener.x, dz = source.z - listener.z, distance = Math.hypot(dx, dz);
  return { gain: Math.max(0, 1 - distance / 32) ** 2, pan: clamp((dx * Math.cos(yaw) - dz * Math.sin(yaw)) / Math.max(3, distance), -0.85, 0.85) };
}

// Original, deterministic PCM effects. No downloads, music tracks, or per-shot buffer allocations.
export function makeSoundBuffer(context, name) {
  const duration = SOUND_LENGTHS[name];
  if (!duration) throw new Error("Unknown route sound");
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate), data = buffer.getChannelData(0);
  let seed = 1977, smooth = 0, rumble = 0;
  const pulse = (time, start, decay) => time < start ? 0 : Math.exp(-(time - start) * decay);
  for (let i = 0; i < data.length; i++) {
    const t = i / context.sampleRate, end = Math.min(1, (duration - t) / 0.025), tau = Math.PI * 2;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    smooth += (noise - smooth) * 0.14; rumble += (noise - rumble) * 0.009;
    let value = 0;
    if (name === "shot") value = noise * 0.65 * pulse(t, 0, 70) + smooth * 1.3 * pulse(t, 0.008, 30) + Math.sin(tau * (95 * t - 70 * t * t)) * 0.35 * pulse(t, 0, 23);
    if (name === "reload") value = (noise * 0.35 + Math.sin(tau * 420 * t) * 0.1) * (pulse(t, 0.02, 100) + pulse(t, 0.32, 75) + pulse(t, 0.53, 100));
    if (name === "footstep") value = smooth * 1.3 * pulse(t, 0, 33) + Math.sin(tau * 70 * t) * 0.18 * pulse(t, 0, 45);
    if (name === "groan") value = (Math.sin(tau * 59 * t + Math.sin(t * 11) * 2) * 0.13 + smooth * 0.7 + Math.sin(tau * 177 * t) * 0.05) * Math.sin(Math.PI * t / duration) ** 2;
    if (name === "hit" || name === "hurt") value = (smooth * 1.3 + Math.sin(tau * 82 * t) * 0.3) * pulse(t, 0, 28);
    if (name === "melee") value = smooth * Math.sin(Math.PI * t / duration) ** 2;
    if (name === "door") value = smooth * 0.8 * pulse(t, 0, 15) + (noise * 0.4 + Math.sin(tau * 65 * t) * 0.3) * pulse(t, 0.24, 40);
    if (["loot", "upgrade", "heal"].includes(name)) {
      const pitch = name === "heal" ? 220 : 330;
      value = (Math.sin(tau * pitch * t) * 0.12 + Math.sin(tau * pitch * 1.5 * t) * 0.08) * Math.sin(Math.PI * t / duration) ** 2 * pulse(t, 0, 4) + smooth * 0.4 * pulse(t, 0, 50);
    }
    if (name === "engine") value = Math.sin(tau * 45 * t) * 0.24 + Math.sin(tau * 90 * t) * 0.1 + smooth * (0.2 + 0.3 * Math.sin(tau * 15 * t) ** 2);
    if (name === "wind") value = rumble * 2 * (0.7 + 0.3 * Math.sin(tau * t / duration));
    const envelope = name === "engine" || name === "wind" ? Math.min(1, t / 0.02, (duration - t) / 0.02) : Math.min(1, t / 0.001) * end;
    data[i] = clamp(value * envelope, -0.9, 0.9);
  }
  return buffer;
}

export function createRouteAudio({ volume = 0.7, contextFactory = () => new (window.AudioContext || window.webkitAudioContext)() } = {}) {
  let context, master, engine, wind, muted = false, paused = false, disposed = false, unlocking = null;
  let previousPosition, stride = 0, groanTime = 2, controlTime = 0;
  const buffers = new Map(), voices = new Set();
  const gain = () => !disposed && !muted && !paused ? clamp(typeof volume === "function" ? volume() : volume, 0, 1) : 0;
  const buffer = name => { if (!buffers.has(name)) buffers.set(name, makeSoundBuffer(context, name)); return buffers.get(name); };
  function loop(name, initial) {
    const source = context.createBufferSource(), level = context.createGain(); source.buffer = buffer(name); source.loop = true; level.gain.value = initial;
    source.connect(level); level.connect(master); source.start(); return { source, level };
  }
  function setLevel() {
    if (!master || context.state === "closed") return;
    master.gain.cancelScheduledValues(context.currentTime); master.gain.setTargetAtTime(gain(), context.currentTime, 0.025);
  }
  async function unlock() {
    if (disposed || !gain()) return;
    if (unlocking) return unlocking;
    unlocking = (async () => {
      await Promise.resolve();
      if (disposed) { unlocking = null; return; }
      try {
        if (!context) {
          context = contextFactory(); master = context.createGain(); master.gain.value = gain();
          const limiter = context.createDynamicsCompressor(); limiter.threshold.value = -16; limiter.ratio.value = 6;
          master.connect(limiter); limiter.connect(context.destination);
          engine = loop("engine", 0); wind = loop("wind", 0.12);
        }
        if (context.state === "suspended") await context.resume();
        setLevel();
        if (paused && context.state === "running") await context.suspend();
      } catch { /* Audio failure never blocks gameplay or retries. */ }
      finally { unlocking = null; }
    })();
    return unlocking;
  }
  function play(name, mix = {}) {
    if (!context || context.state !== "running" || !gain() || !SOUND_LENGTHS[name] || voices.size >= 16) return false;
    const source = context.createBufferSource(), level = context.createGain(), pan = context.createStereoPanner();
    source.buffer = buffer(name); source.playbackRate.value = clamp(mix.rate ?? 1, 0.6, 1.8);
    level.gain.value = clamp(mix.gain ?? 0.55, 0, 1); pan.pan.value = clamp(mix.pan ?? 0, -1, 1);
    source.connect(level); level.connect(pan); pan.connect(master);
    const voice = { source, level, pan }; voices.add(voice);
    source.onended = () => { source.disconnect(); level.disconnect(); pan.disconnect(); voices.delete(voice); };
    source.start(); return true;
  }
  function clearVoices() { for (const voice of [...voices]) { voice.source.onended = null; try { voice.source.stop(); } catch {} voice.source.disconnect(); voice.level.disconnect(); voice.pan.disconnect(); voices.delete(voice); } }
  function update({ position, inBus, speed, fuel, enemies, yaw }, dt) {
    if (disposed || paused) return;
    controlTime += dt;
    if (controlTime >= 0.08 && context?.state === "running") {
      controlTime = 0; setLevel();
      engine.level.gain.setTargetAtTime(inBus && fuel > 0 ? 0.28 + Math.abs(speed) * 0.012 : 0, context.currentTime, 0.15);
      engine.source.playbackRate.setTargetAtTime(0.85 + Math.abs(speed) * 0.055, context.currentTime, 0.12);
      wind.level.gain.setTargetAtTime(inBus ? 0.07 : 0.12, context.currentTime, 0.2);
    }
    if (previousPosition && !inBus) {
      const distance = Math.hypot(position.x - previousPosition.x, position.z - previousPosition.z);
      if (distance < 2) stride += distance; else stride = 0;
      if (stride > 1.75) { play("footstep", { gain: Math.abs(position.x) < 7 ? 0.4 : 0.24, rate: stride % 0.2 + 0.9 }); stride %= 1.75; }
    }
    previousPosition = { x: position.x, z: position.z };
    groanTime -= dt;
    if (groanTime <= 0) {
      groanTime = 3.2;
      const near = enemies.filter(e => e.hp > 0).map(e => ({ enemy: e, mix: spatialMix(e.body.translation(), position, yaw) })).sort((a, b) => b.mix.gain - a.mix.gain)[0];
      if (near?.mix.gain > 0.02) play("groan", { ...near.mix, gain: near.mix.gain * 0.55, rate: near.enemy.boss ? 0.72 : 0.94 });
    }
  }
  return {
    unlock, play, update,
    setMuted(value) { muted = Boolean(value); clearVoices(); setLevel(); if (!muted && !paused) void unlock(); },
    setPaused(value) { paused = Boolean(value); previousPosition = null; stride = 0; clearVoices(); setLevel(); if (context) { if (paused) context.suspend().catch(() => {}); else void unlock(); } },
    snapshot: () => ({ state: context?.state || "idle", muted, paused, voices: voices.size, buffers: buffers.size, disposed }),
    dispose() { if (disposed) return; disposed = true; clearVoices(); for (const item of [engine, wind]) if (item) { try { item.source.stop(); } catch {} item.source.disconnect(); item.level.disconnect(); } master?.disconnect(); buffers.clear(); if (context?.state !== "closed") context?.close().catch(() => {}); }
  };
}
