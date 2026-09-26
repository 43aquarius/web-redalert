// ============================================================
// RA2 Web - Part 1: Core constants, utilities, asset management
// ============================================================
'use strict';

const TILE_W = 60, TILE_H = 30;            // native iso tile
const SCALE = 2;                            // render scale
const TW = TILE_W * SCALE, TH = TILE_H * SCALE;
const MAP_W = 70, MAP_H = 70;

// facings
const DIR_COUNT = 32;
const INF_DIRS = 8;

// game timing (RA2 runs 30 logic ticks like the original engine cadence)
const TICK_MS = 1000 / 30;

const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };

// iso <-> tile coords
function tileToScreen(tx, ty) { return { x: (tx - ty) * TW / 2, y: (tx + ty) * TH / 2 }; }
function screenToTile(sx, sy) {
  // inverse of the above
  const fx = sx / (TW / 2), fy = sy / (TH / 2);
  return { tx: (fy + fx) / 2, ty: (fy - fx) / 2 };
}

// deterministic RNG
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// ---------- Asset manager ----------
class Assets {
  constructor() {
    this.images = new Map();   // id -> Image (decoded)
    this.raw = new Map();      // id -> dataURL string
    this.audio = new Map();    // id -> ArrayBuffer (mp3)
    this.manifest = window.__RA2_ASSETS__ || {};
    this.gameData = window.__RA2_DATA__ || {};
  }
  addImage(id, dataUrl) { this.raw.set(id, dataUrl); }
  addAudio(id, dataUrl) { this.audio.set(id, dataUrl); }
  async decodeAll(onProgress) {
    const imgs = [...this.raw.entries()];
    let done = 0;
    await Promise.all(imgs.map(([id, url]) => new Promise(res => {
      const img = new Image();
      img.onload = () => { this.images.set(id, img); done++; if (onProgress) onProgress(done, imgs.length); res(); };
      img.onerror = () => { console.warn('img fail', id); done++; res(); };
      img.src = url;
    })));
  }
  img(id) { return this.images.get(id) || null; }
}

// ---------- Audio system ----------
class SoundSystem {
  constructor() {
    this.ctx = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.musicNode = null;
    this.currentMusic = null;
    this.enabled = true;
    this.musicEnabled = true;
  }
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.5;
      this.musicGain.connect(this.ctx.destination);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.8;
      this.sfxGain.connect(this.ctx.destination);
    } catch (e) { console.warn('audio init failed', e); }
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  playMusic(id, assets, loop = true) {
    if (!this.ctx || !this.musicEnabled) return;
    this.stopMusic();
    const url = assets.audio.get(id);
    if (!url) return;
    fetch(url).then(r => r.arrayBuffer()).then(buf => {
      if (!this.ctx) return;
      return this.ctx.decodeAudioData(buf);
    }).then(audioBuf => {
      if (!audioBuf || !this.ctx) return;
      const node = this.ctx.createBufferSource();
      node.buffer = audioBuf;
      node.loop = loop;
      node.connect(this.musicGain);
      node.start();
      this.musicNode = node;
      this.currentMusic = id;
    }).catch(e => console.warn('music fail', id, e));
  }
  stopMusic() {
    if (this.musicNode) { try { this.musicNode.stop(); } catch (e) {} this.musicNode = null; }
  }
  playSfx(buffer, vol = 1) {
    if (!this.ctx || !buffer) return;
    try {
      const node = this.ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(this.sfxGain);
      node.gain ??= undefined;
      this.sfxGain.gain.value = this.sfxGain.gain.value; // keep
      node.start();
    } catch (e) {}
  }
  // synthesized combat SFX (original SFX not in asset pack)
  synth(kind, vol = 0.6) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = vol;
    out.connect(ctx.destination);
    try {
      if (kind === 'boom' || kind === 'bigboom') {
        const big = kind === 'bigboom';
        const dur = big ? 0.9 : 0.45;
        const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) {
          const k = i / d.length;
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - k, big ? 2 : 3);
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(big ? 400 : 900, t);
        lp.frequency.exponentialRampToValueAtTime(60, t + dur);
        src.connect(lp); lp.connect(out);
        src.start(t);
        // sub thump
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(big ? 90 : 120, t);
        osc.frequency.exponentialRampToValueAtTime(30, t + dur);
        const og = ctx.createGain();
        og.gain.setValueAtTime(0.8, t);
        og.gain.exponentialRampToValueAtTime(0.001, t + dur);
        osc.connect(og); og.connect(out);
        osc.start(t); osc.stop(t + dur);
      } else if (kind === 'cannon') {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(180, t);
        osc.frequency.exponentialRampToValueAtTime(40, t + 0.18);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.5, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        osc.connect(g); g.connect(out);
        osc.start(t); osc.stop(t + 0.2);
        // noise crack
        const buf = ctx.createBuffer(1, ctx.sampleRate * 0.08, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
        const ns = ctx.createBufferSource(); ns.buffer = buf;
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2000;
        ns.connect(hp); hp.connect(out);
        ns.start(t);
      } else if (kind === 'tesla') {
        // electric zap: noise burst + ring mod
        const dur = 0.3;
        const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 1.5);
        const src = ctx.createBufferSource(); src.buffer = buf;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 2;
        const trem = ctx.createGain();
        const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 50;
        const lg = ctx.createGain(); lg.gain.value = 0.5;
        lfo.connect(lg); lg.connect(trem.gain);
        trem.gain.value = 0.6;
        src.connect(bp); bp.connect(trem); trem.connect(out);
        src.start(t); lfo.start(t); lfo.stop(t + dur);
      } else if (kind === 'prism') {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(600, t);
        osc.frequency.exponentialRampToValueAtTime(2400, t + 0.15);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.25, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        osc.connect(g); g.connect(out);
        osc.start(t); osc.stop(t + 0.25);
      } else if (kind === 'v3launch') {
        const dur = 1.2;
        const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(i / d.length, 0.5) * Math.pow(1 - i / d.length, 0.3) * 0.6;
        const src = ctx.createBufferSource(); src.buffer = buf;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
        lp.frequency.setValueAtTime(300, t);
        lp.frequency.exponentialRampToValueAtTime(1400, t + dur);
        src.connect(lp); lp.connect(out);
        src.start(t);
      } else if (kind === 'scream') {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(400, t);
        osc.frequency.exponentialRampToValueAtTime(150, t + 0.4);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.15, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc.connect(g); g.connect(out);
        osc.start(t); osc.stop(t + 0.4);
      }
    } catch (e) {}
  }
  playSfxFromUrl(url, vol = 1) {
    if (!this.ctx) return;
    if (this._sfxCache === undefined) this._sfxCache = new Map();
    let p = this._sfxCache.get(url);
    if (p === undefined) {
      p = fetch(url).then(r => r.arrayBuffer()).then(b => this.ctx.decodeAudioData(b)).catch(() => null);
      this._sfxCache.set(url, p);
    }
    p.then(buf => {
      if (!buf) return;
      const node = this.ctx.createBufferSource();
      node.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = vol;
      node.connect(g); g.connect(this.ctx.destination);
      node.start();
    }).catch(() => {});
  }
}
