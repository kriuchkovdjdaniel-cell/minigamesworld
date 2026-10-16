import { spatialMix } from "./zombie-audio.mjs";

export const COLLECTION_SOUNDS = Object.freeze({ step: 0.12, jump: 0.22, land: 0.16, apple: 0.24, coin: 0.38, warning: 0.3, miss: 0.18, hurt: 0.3, dash: 0.4, ready: 0.28, shield: 0.65, gate: 0.65, win: 1.15, lose: 0.8 });
const clamp = (v, min, max) => Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));

// Original short PCM effects: soft impacts, metallic pickups and filtered air.
export function makeCollectionSound(context, name) {
  if (!Object.hasOwn(COLLECTION_SOUNDS, name)) throw new Error("Unknown collection sound");
  const duration = COLLECTION_SOUNDS[name], buffer = context.createBuffer(1, Math.ceil(duration * context.sampleRate), context.sampleRate), data = buffer.getChannelData(0);
  let seed = 1637, low = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / context.sampleRate, tau = Math.PI * 2;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1; low += (noise - low) * 0.12;
    const tone = (hz, decay, start = 0) => t < start ? 0 : Math.sin(tau * hz * (t - start)) * Math.exp(-(t - start) * decay) * Math.min(1, (t - start) / 0.006);
    let value = 0;
    if (["step", "land", "miss", "hurt"].includes(name)) value = low * (name === "hurt" ? 2 : 0.8) * Math.exp(-t * 35) + tone(name === "hurt" ? 85 : 125, 35) * 0.25;
    if (name === "apple") value = tone(280, 25) * 0.4 + tone(730, 28) * 0.13 + low * Math.exp(-t * 60) * 0.6;
    if (name === "coin") value = tone(1260, 17) * 0.24 + tone(1983, 22) * 0.13 + tone(830, 24, 0.055) * 0.17;
    if (name === "warning") value = (tone(245, 45) + tone(190, 45, 0.12)) * 0.28 + low * Math.exp(-t * 40) * 0.5;
    if (name === "jump" || name === "dash") value = low * Math.sin(Math.PI * t / duration) ** 2 * (name === "dash" ? 1.6 : 1) + Math.sin(tau * (150 * t + 400 * t * t)) * 0.1 * Math.sin(Math.PI * t / duration);
    if (name === "ready") value = (tone(620, 26) + tone(930, 26, 0.08)) * 0.18;
    if (name === "shield" || name === "gate") value = (tone(330, 9) + tone(495, 9, 0.07) + tone(name === "gate" ? 660 : 825, 9, 0.14)) * 0.17;
    if (name === "win") value = [262, 330, 392, 524].reduce((sum, hz, n) => sum + tone(hz, 6, n * 0.15) * 0.2, 0);
    if (name === "lose") value = (tone(220, 8) + tone(165, 8, 0.18) + tone(110, 8, 0.36)) * 0.23;
    data[i] = clamp(value * Math.min(1, t / 0.004, (duration - t) / 0.03), -0.8, 0.8);
  }
  return buffer;
}

export function createCollectionAudio({ volume = 0.7, contextFactory = () => new (window.AudioContext || window.webkitAudioContext)() } = {}) {
  let context, master, limiter, unlocking = null, muted = false, paused = false, disposed = false;
  const buffers = new Map(), voices = new Set();
  const level = () => disposed || muted || paused ? 0 : clamp(typeof volume === "function" ? volume() : volume, 0, 1);
  function sync() {
    if (master && context.state !== "closed") {
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setTargetAtTime(level(), context.currentTime, 0.015);
    }
  }
  function remove(voice) {
    voice.source.onended = null;
    for (const node of [voice.source, voice.gain, voice.pan]) node.disconnect();
    voices.delete(voice);
  }
  function stop() {
    for (const voice of [...voices]) { try { voice.source.stop(); } catch {} remove(voice); }
  }
  function closeContext() {
    master?.disconnect(); limiter?.disconnect(); buffers.clear();
    if (context?.state !== "closed") context?.close().catch(() => {});
    context = master = limiter = null;
  }
  async function unlock() {
    if (!level()) return;
    if (unlocking) return unlocking;
    unlocking = (async () => {
      await Promise.resolve();
      if (!level()) return;
      try {
        if (!context) {
          try {
            context = contextFactory(); master = context.createGain(); master.gain.value = level();
            limiter = context.createDynamicsCompressor(); limiter.threshold.value = -15; limiter.ratio.value = 5;
            master.connect(limiter); limiter.connect(context.destination);
          } catch (error) { closeContext(); throw error; }
        }
        const active = context;
        if (active.state === "suspended") await active.resume();
        if (disposed || active !== context) return;
        sync();
        if (paused && active.state === "running") await active.suspend();
      } catch { /* A blocked audio device must never block the game. Retry on the next gesture. */ }
    })();
    try { await unlocking; } finally { unlocking = null; }
  }
  function play(name, mix = {}) {
    sync();
    if (!level() || context?.state !== "running" || !Object.hasOwn(COLLECTION_SOUNDS, name)) return false;
    if (name === "win" || name === "lose") stop();
    if (voices.size >= 12) return false;
    let voice;
    try {
      if (!buffers.has(name)) buffers.set(name, makeCollectionSound(context, name));
      voice = { source: context.createBufferSource(), gain: context.createGain(), pan: context.createStereoPanner() };
      voice.source.buffer = buffers.get(name); voice.source.playbackRate.value = clamp(mix.rate ?? 1, 0.7, 1.4);
      voice.gain.gain.value = clamp(mix.gain ?? 0.65, 0, 1); voice.pan.pan.value = clamp(mix.pan ?? 0, -1, 1);
      voice.source.connect(voice.gain); voice.gain.connect(voice.pan); voice.pan.connect(master);
      voices.add(voice); voice.source.onended = () => remove(voice); voice.source.start(); return true;
    } catch { if (voice) remove(voice); return false; }
  }
  return {
    unlock, play, sync,
    setMuted(value) { muted = Boolean(value); stop(); sync(); if (!muted && !paused) void unlock(); },
    setPaused(value) { paused = Boolean(value); stop(); sync(); if (paused) context?.suspend().catch(() => {}); else void unlock(); },
    snapshot: () => ({ state: context?.state || (disposed ? "closed" : "idle"), muted, paused, voices: voices.size, buffers: buffers.size, disposed, volume: level() }),
    dispose() { if (disposed) return; disposed = true; stop(); closeContext(); }
  };
}

// Observe fixed physics steps, not redraws, so resize and camera movement cannot replay sounds.
export function createCollectionSoundTracker(mode, emit) {
  let previous = null, stride = 0, lastRock = -1;
  return (s, p, yaw = 0) => {
    if (previous && s.elapsed <= previous.elapsed) return;
    const current = { elapsed: s.elapsed, status: s.status, lives: s.lives, caught: s.caught, missed: s.missed, coins: s.collected.size, shields: s.usedShields.size,
      cooldown: s.cooldown, grounded: s.grounded, velocityY: s.velocityY, gateOpen: s.gateOpen, x: p.x, z: p.z };
    const old = previous; previous = current;
    if (!old || old.status !== "playing") return;
    if (s.status !== "playing") { emit(s.status === "won" ? "win" : "lose"); return; }
    if (s.lives < old.lives) emit("hurt");
    if (s.caught > old.caught) emit("apple", { rate: 1 + Math.min(10, s.combo) * 0.025 });
    if (s.missed > old.missed) emit("miss", { gain: 0.3 });
    if (s.collected.size > old.coins) emit("coin");
    if (s.usedShields.size > old.shields) emit("shield");
    if (s.gateOpen && !old.gateOpen) emit("gate");
    if (s.cooldown > old.cooldown) emit("dash");
    if (old.cooldown > 0 && s.cooldown === 0) emit("ready", { gain: 0.4 });
    if (old.grounded && !s.grounded && s.velocityY > 0) emit("jump", { gain: 0.4 });
    if (!old.grounded && s.grounded && old.velocityY < -2) emit("land", { gain: 0.4 });
    const distance = Math.hypot(p.x - old.x, p.z - old.z);
    if (s.grounded && old.grounded && distance < 1) {
      stride += distance;
      if (stride >= 1.5) { emit("step", { gain: mode === "catcher" ? 0.28 : 0.4, rate: mode === "catcher" ? 0.9 : 1.15 }); stride %= 1.5; }
    } else stride = 0;
    for (const drop of s.drops) if (drop.kind === "rock" && drop.id > lastRock) {
      lastRock = drop.id;
      const mix = spatialMix(drop, p, yaw);
      emit("warning", { ...mix, gain: Math.max(0.2, mix.gain) * 0.6 });
    }
  };
}
