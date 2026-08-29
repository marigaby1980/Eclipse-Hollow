/* ═══════════════════════════════════════════════════════════════════════════
   ECLIPSE HOLLOW — 01 CORE
   config + global look, utilities, procedural audio, collision world.
   Loaded as a classic script: every top-level binding is shared with the
   later parts, so nothing here needs importing or exporting.
   ═══════════════════════════════════════════════════════════════════════════ */

const CFG = {
  // locomotion
  GRAVITY: 9.6,
  BASE_CAP: 5.7,          // flat-footed ceiling — deliberately below MON_HUNT
  HOLLOW_CAP: 7.4,        // player-controlled monsters start faster
  CAP_BONUS: 7.4,         // added to cap at full momentum
  HARD_CAP: 14.0,
  DRAG_COLD: 2.8,         // s^-1 pull toward cap with no momentum
  DRAG_HOT: 0.50,         // s^-1 with hot momentum: speed coasts instead of bleeding
  MOM_PER_SWING: 0.30,
  MOM_DECAY: 0.60,        // per second
  GROUND_FRICTION: 0.9,
  AIR_DRAG: 0.05,
  ARM_BOOST: 1.05,
  GRAB_TOUCH: 0.085,      // sticky-hand auto grab radius
  GRAB_BUTTON: 0.18,      // grip-assisted radius
  MAX_PULL: 0.50,         // clamp per-frame body displacement from a grab
  BODY_R: 0.26,
  EYE: 1.62,

  // monsters
  MON_PATROL: 2.2,
  MON_HUNT: 6.4,
  MON_LUNGE: 9.5,
  MON_LUNGE_T: 1.10,
  MON_LUNGE_CD: 4.5,
  MON_KILL: 1.30,
  MON_WINDUP: 0.45,
  MON_HEAR: 9.0,
  MON_SIGHT: 32.0,

  // round
  FUSE_BASE: 3,
  FUSE_MAX: 6,
  BLEED: 45,
  REVIVE: 3.0,
  ESCALATE: 70,
  ROUND_TIME: 900,

  // net
  SEND_HZ: 15,
  ROOM_PREFIX: 'eclipse-hollow-v1-',
  MAX_PLAYERS: 8,

  // world
  WORLD: 70,
  SEED: 'ECLIPSE-HOLLOW-01',
  LIGHT_POOL: 10
};
const ROLE = { SURVIVOR: 0, HOLLOW: 1 };

/* Global brightness. Every light value in the game reads from here.
   Reach for hemi and ambInt first — they lift the world while leaving the wet
   specular highlights on creature flesh intact. exposure lifts the monsters too,
   which is usually not what you want. */
const LOOK = {
  exposure: 1.35, exposureDark: 0.95,
  skyTop: 0x4b7cb4, skyMid: 0xa9c2d6, skyBot: 0xdae2e4,
  fog: 0x9fb4c4, fogLit: 0.0112, fogDark: 0.058, fogHollow: 0.008,
  hemiSky: 0xacc8de, hemiGnd: 0x565c60, hemi: 1.20,
  amb: 0xbed2df, ambInt: 0.42,
  sunColor: 0xfff3da, sun: 1.10,
  fillColor: 0x93b7da, fill: 0.45,
  lampBoost: 1.85, blackoutFloor: 0.15
};

/* Creature detail budget.
     seg/ribs/teeth/fingers/strips/tendrils  — geometry density
     eyeLOD                                  — metres within which irises track you
     shader                                  — 2 full flesh shader, 1 cheap, 0 plain Phong
     warp                                    — coherent fbm sculpting passes on hulls
     blob                                    — soft contact shadow under each creature
   Lower shader to 1 and fingers to 3 first if a headset drops frames. */
const MQ = {
  seg: 7, ribs: 7, teeth: 12, fingers: 4, strips: 9, tendrils: 7,
  eyeLOD: 26, shader: 2, warp: 1, blob: true, detail: 1
};

/* ──────────────────────────── UTILITIES ────────────────────────────── */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp  = (a, b, t) => a + (b - a) * t;
const nowS  = () => performance.now() / 1000;
const V     = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hash32(s) {
  let h = 2166136261;
  s = String(s);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function shortId(n = 4) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < n; i++) s += A[(Math.random() * A.length) | 0];
  return s;
}
const pick = a => a[(Math.random() * a.length) | 0];
function store(k, v) {
  try { if (v === undefined) return localStorage.getItem('eh_' + k); localStorage.setItem('eh_' + k, v); }
  catch (e) { return null; }
}
function shortAngle(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
const r2 = v => Math.round(v * 100) / 100;
const a3 = v => [r2(v.x), r2(v.y), r2(v.z)];

const _v1 = V(), _v2 = V(), _v3 = V(), _v4 = V(), _v5 = V();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

const errEl = document.getElementById('err');
function fail(e) {
  const txt = e && e.stack ? e.stack : String(e);
  errEl.textContent = (errEl.textContent + '\n' + txt).slice(-2400);
  console.error(e);
}
addEventListener('error', ev => fail(ev.error || ev.message));
addEventListener('unhandledrejection', ev => fail(ev.reason));

function canvasTex(w, h, draw, { nearest = false, repeat = 1 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (nearest) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; }
  if (repeat !== 1) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
  t.anisotropy = 4;
  return t;
}

/* ────────────────────── PROCEDURAL AUDIO ENGINE ────────────────────── */
/* Every sound is synthesised. Nothing to 404, nothing to preload. */
const AUD = (() => {
  let ctx = null, master = null, busSfx = null, busAmb = null, busMus = null;
  let noiseBuf = null, brownBuf = null, ready = false;
  let droneGain = null, chaseGain = null, hissGain = null;
  let heartT = 0, breathT = 0;
  const voices = new Map();
  const whines = new Map();

  function mkNoise(dur) {
    const len = (ctx.sampleRate * dur) | 0, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function mkBrown(dur) {
    const len = (ctx.sampleRate * dur) | 0, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.4; }
    return b;
  }
  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.25;
    master.connect(comp); comp.connect(ctx.destination);
    busSfx = ctx.createGain(); busAmb = ctx.createGain(); busMus = ctx.createGain();
    busSfx.gain.value = 1; busAmb.gain.value = 0.7; busMus.gain.value = 1;
    busSfx.connect(master); busAmb.connect(master); busMus.connect(master);
    noiseBuf = mkNoise(2); brownBuf = mkBrown(6);
    ready = true;
    startBeds();
  }
  function resume() { if (ctx && ctx.state !== 'running') ctx.resume(); }

  function panner(pos, ref = 5, max = 45) {
    const p = ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
    p.refDistance = ref; p.maxDistance = max; p.rolloffFactor = 1.4;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y, pos.z);
    p.connect(busSfx);
    return p;
  }
  function setPan(p, x, y, z) {
    if (p.positionX) {
      const t = ctx.currentTime;
      p.positionX.setTargetAtTime(x, t, 0.03);
      p.positionY.setTargetAtTime(y, t, 0.03);
      p.positionZ.setTargetAtTime(z, t, 0.03);
    } else p.setPosition(x, y, z);
  }
  function burst(pos, { dur = 0.14, f = 1000, q = 1, g = 0.4, type = 'bandpass', rate = 1, ref = 5, max = 45 } = {}) {
    if (!ready) return;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.playbackRate.value = rate;
    const bp = ctx.createBiquadFilter(); bp.type = type; bp.frequency.value = f; bp.Q.value = q;
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(g, t + Math.min(0.012, dur * 0.25));
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bp); bp.connect(gn);
    if (pos) gn.connect(panner(pos, ref, max)); else gn.connect(busSfx);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  function tone(pos, { f = 220, f2 = null, dur = 0.3, g = 0.3, type = 'sine', ref = 5, max = 45 } = {}) {
    if (!ready) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(g, t + Math.min(0.04, dur * 0.2));
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn);
    if (pos) gn.connect(panner(pos, ref, max)); else gn.connect(busSfx);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function startBeds() {
    // low room tone
    const s = ctx.createBufferSource(); s.buffer = brownBuf; s.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 200;
    droneGain = ctx.createGain(); droneGain.gain.value = 0.42;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.055;
    const lg = ctx.createGain(); lg.gain.value = 85;
    lfo.connect(lg); lg.connect(lp.frequency);
    s.connect(lp); lp.connect(droneGain); droneGain.connect(busAmb);
    s.start(); lfo.start();
    // wind hiss
    const n = ctx.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.55;
    hissGain = ctx.createGain(); hissGain.gain.value = 0.05;
    n.connect(bp); bp.connect(hissGain); hissGain.connect(busAmb);
    n.start();
    const l2 = ctx.createOscillator(); l2.frequency.value = 0.07;
    const g2 = ctx.createGain(); g2.gain.value = 170;
    l2.connect(g2); g2.connect(bp.frequency); l2.start();
    // chase layer, muted until threatened
    chaseGain = ctx.createGain(); chaseGain.gain.value = 0; chaseGain.connect(busMus);
    [55, 58.3, 82.4].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = i === 2 ? 'triangle' : 'sawtooth'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.1;
      const t = ctx.createOscillator(); t.frequency.value = 4.3 + i * 0.8;
      const tg = ctx.createGain(); tg.gain.value = 0.08;
      t.connect(tg); tg.connect(g.gain);
      o.connect(g); g.connect(chaseGain); o.start(); t.start();
    });
  }

  return {
    init, resume,
    get ready() { return ready; },
    get ctx() { return ctx; },
    get master() { return master; },
    setPan,
    listener(cam) {
      if (!ready) return;
      cam.getWorldPosition(_v1); cam.getWorldQuaternion(_q1);
      const f = _v2.set(0, 0, -1).applyQuaternion(_q1), u = _v3.set(0, 1, 0).applyQuaternion(_q1);
      const L = ctx.listener, t = ctx.currentTime;
      if (L.positionX) {
        L.positionX.setTargetAtTime(_v1.x, t, 0.02); L.positionY.setTargetAtTime(_v1.y, t, 0.02);
        L.positionZ.setTargetAtTime(_v1.z, t, 0.02);
        L.forwardX.setTargetAtTime(f.x, t, 0.02); L.forwardY.setTargetAtTime(f.y, t, 0.02);
        L.forwardZ.setTargetAtTime(f.z, t, 0.02);
        L.upX.setTargetAtTime(u.x, t, 0.02); L.upY.setTargetAtTime(u.y, t, 0.02);
        L.upZ.setTargetAtTime(u.z, t, 0.02);
      } else { L.setPosition(_v1.x, _v1.y, _v1.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
    },
    click(p) { burst(p, { dur: 0.05, f: 2600, q: 3, g: 0.3, ref: 2, max: 12 }); tone(p, { f: 1150, f2: 780, dur: 0.045, g: 0.12, type: 'square', ref: 2, max: 12 }); },
    slap(p, pw = 1) { burst(p, { dur: 0.11, f: 700 + Math.random() * 700, q: 1.2, g: clamp(0.06 + pw * 0.05, 0.05, 0.42), ref: 4, max: 34 }); },
    step(p, hard = false) { burst(p, { dur: hard ? 0.18 : 0.1, f: hard ? 420 : 880, q: hard ? 2.8 : 0.9, g: hard ? 0.38 : 0.2, ref: 4, max: 34 }); if (hard) tone(p, { f: 78, f2: 34, dur: 0.28, g: 0.3 }); },
    thud(p, g = 0.5) { tone(p, { f: 120, f2: 40, dur: 0.34, g, type: 'sine' }); burst(p, { dur: 0.12, f: 280, g: g * 0.5 }); },
    pickup(p) { tone(p, { f: 880, f2: 1520, dur: 0.16, g: 0.22, type: 'triangle', ref: 3, max: 18 }); },
    insert(p) { burst(p, { dur: 0.2, f: 1500, q: 2, g: 0.34, ref: 4, max: 22 }); tone(p, { f: 300, f2: 900, dur: 0.34, g: 0.24, type: 'square' }); },
    /* wet joint pop, used when a creature snaps a limb into a new pose */
    crack(p, g = 0.3) {
      burst(p, { dur: 0.05, f: 1800 + Math.random() * 1400, q: 4, g, ref: 3, max: 26 });
      tone(p, { f: 190, f2: 70, dur: 0.09, g: g * 0.6, type: 'square', ref: 3, max: 26 });
    },
    growl(p, size = 1) {
      if (!ready) return;
      const t = ctx.currentTime, dur = 0.8 + Math.random() * 0.9;
      const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 150 / size; bp.Q.value = 2.6;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 4 + Math.random() * 6;
      const lg = ctx.createGain(); lg.gain.value = 52; lfo.connect(lg); lg.connect(bp.frequency);
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 48 / size;
      const og = ctx.createGain(); og.gain.value = 0.16;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5, t + 0.18);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(bp); bp.connect(g); o.connect(og); og.connect(g);
      g.connect(panner(p, 7, 55));
      s.start(t); o.start(t); lfo.start(t);
      s.stop(t + dur + 0.1); o.stop(t + dur + 0.1); lfo.stop(t + dur + 0.1);
    },
    screech(p, inten = 1) {
      if (!ready) return;
      const t = ctx.currentTime;
      const car = ctx.createOscillator(), mod = ctx.createOscillator();
      const mg = ctx.createGain(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      car.type = 'sawtooth'; mod.type = 'square';
      car.frequency.setValueAtTime(180 + 130 * inten, t);
      car.frequency.exponentialRampToValueAtTime(720 + 320 * inten, t + 0.18);
      car.frequency.exponentialRampToValueAtTime(95, t + 1.05);
      mod.frequency.setValueAtTime(36, t); mod.frequency.linearRampToValueAtTime(145, t + 0.9);
      mg.gain.value = 210 * inten;
      f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 1.1;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5 * inten, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      mod.connect(mg); mg.connect(car.frequency); car.connect(f); f.connect(g);
      g.connect(p ? panner(p, 6, 70) : busSfx);
      car.start(t); mod.start(t); car.stop(t + 1.3); mod.stop(t + 1.3);
      burst(p, { dur: 0.85, f: 2200, q: 0.7, g: 0.26 * inten, type: 'highpass' });
    },
    stinger() {
      if (!ready) return;
      const t = ctx.currentTime;
      [55, 58, 110, 220.5, 441, 933].forEach((f, i) => {
        const o = ctx.createOscillator(); o.type = i > 2 ? 'sawtooth' : 'square'; o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.15, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5 + Math.random() * 1.1);
        o.connect(g); g.connect(busSfx); o.start(t); o.stop(t + 2);
      });
      burst(null, { dur: 0.7, f: 5000, q: 0.5, g: 0.3, type: 'highpass' });
    },
    gate() { tone(null, { f: 38, f2: 72, dur: 2.4, g: 0.3, type: 'sawtooth' }); burst(null, { dur: 2.2, f: 260, q: 0.7, g: 0.24, type: 'lowpass' }); },
    power() { tone(null, { f: 58, f2: 240, dur: 1.4, g: 0.26, type: 'sawtooth' }); burst(null, { dur: 1.1, f: 900, q: 0.6, g: 0.18 }); },
    chime() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(null, { f, dur: 0.45, g: 0.15, type: 'triangle' }), i * 120)); },
    zap(p) { for (let i = 0; i < 5; i++) burst(p, { dur: 0.05, f: 4200, g: 0.2, type: 'highpass', ref: 2, max: 18 }); },
    static_(g = 0.16) { burst(null, { dur: 0.22, f: 4200, q: 0.4, g, type: 'highpass' }); },
    heart(bpm, fear, dt) {
      if (!ready) return;
      heartT -= dt;
      if (heartT > 0) return;
      heartT = 60 / Math.max(35, bpm);
      const v = 0.13 + fear * 0.3;
      tone(null, { f: 62, f2: 32, dur: 0.2, g: v });
      setTimeout(() => tone(null, { f: 52, f2: 28, dur: 0.16, g: v * 0.65 }), 155);
    },
    breath(fear, dt) {
      if (!ready) return;
      breathT -= dt;
      if (breathT > 0) return;
      breathT = lerp(4.4, 1.15, fear);
      burst(null, { dur: lerp(0.6, 0.28, fear), f: lerp(480, 1150, fear), q: 0.8, g: 0.04 + fear * 0.12 });
    },
    threat(v) { if (chaseGain) chaseGain.gain.setTargetAtTime(clamp(v, 0, 1) * 0.5, ctx.currentTime, 0.4); },
    amb(v) { if (busAmb) busAmb.gain.setTargetAtTime(v, ctx.currentTime, 0.5); },
    /* looping per-monster breath/growl bed */
    voiceSet(key, pos, level, pitch = 1) {
      if (!ready) return;
      let v = voices.get(key);
      if (!v) {
        if (level <= 0.001) return;              // do not build a voice for a distant monster
        const p = panner(pos, 6, 50);
        const g = ctx.createGain(); g.gain.value = 0;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 175; f.Q.value = 3.2;
        const n = ctx.createBufferSource(); n.buffer = noiseBuf; n.loop = true; n.playbackRate.value = 0.5;
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 60;
        const og = ctx.createGain(); og.gain.value = 0.45;
        const lfo = ctx.createOscillator(); lfo.frequency.value = 3 + Math.random() * 2.5;
        const lg = ctx.createGain(); lg.gain.value = 80;
        lfo.connect(lg); lg.connect(f.frequency); lfo.start();
        n.connect(f); o.connect(og); og.connect(f); f.connect(g); g.connect(p);
        n.start(); o.start();
        v = { g, p, o, n, lfo }; voices.set(key, v);
      }
      setPan(v.p, pos.x, pos.y, pos.z);
      const t = ctx.currentTime;
      v.g.gain.setTargetAtTime(level, t, 0.14);
      v.o.frequency.setTargetAtTime(52 * pitch, t, 0.2);
      v.n.playbackRate.setTargetAtTime(0.45 * pitch, t, 0.2);
    },
    voiceKill(key) {
      const v = voices.get(key); if (!v) return;
      try {
        v.g.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
        v.n.stop(ctx.currentTime + 0.4); v.o.stop(ctx.currentTime + 0.4); v.lfo.stop(ctx.currentTime + 0.4);
      } catch (e) {}
      voices.delete(key);
    },
    /* rising glass whine — the Watcher's attack radius made audible.
       level 0..1, and the pitch climbs as you get deeper inside the ring. */
    whineSet(key, pos, level, tension = 0) {
      if (!ready) return;
      let w = whines.get(key);
      if (!w) {
        if (level <= 0.001) return;
        const p = panner(pos, 3.5, 26);
        const g = ctx.createGain(); g.gain.value = 0;
        const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 1180;
        const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 1188;   // slow beating
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 7;
        const ng = ctx.createGain(); ng.gain.value = 0.10;
        const n = ctx.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
        n.connect(bp); bp.connect(ng); ng.connect(g);
        o1.connect(g); o2.connect(g); g.connect(p);
        o1.start(); o2.start(); n.start();
        w = { g, p, o1, o2, n, bp }; whines.set(key, w);
      }
      setPan(w.p, pos.x, pos.y, pos.z);
      const t = ctx.currentTime, f = 900 + tension * 1500;
      w.g.gain.setTargetAtTime(level * 0.11, t, 0.18);
      w.o1.frequency.setTargetAtTime(f, t, 0.25);
      w.o2.frequency.setTargetAtTime(f * 1.008, t, 0.25);
      w.bp.frequency.setTargetAtTime(f * 1.4, t, 0.25);
    },
    whineKill(key) {
      const w = whines.get(key); if (!w) return;
      try {
        w.g.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
        w.o1.stop(ctx.currentTime + 0.5); w.o2.stop(ctx.currentTime + 0.5); w.n.stop(ctx.currentTime + 0.5);
      } catch (e) {}
      whines.delete(key);
    }
  };
})();

/* ─────────────── COLLISION WORLD (AABB soup + spatial hash) ─────────── */
/* Axis-aligned only, on purpose: exact sphere resolution, cheap rays,
   trivial ground probes. Nothing rotates, so nothing tunnels.           */
const SOLIDS = {
  min: [], max: [], tag: [], on: [], n: 0, cell: 8, grid: new Map(),
  key(ix, iz) { return (ix * 73856093 ^ iz * 19349663) >>> 0; },
  add(cx, cy, cz, hx, hy, hz, tag = 'solid') {
    const i = this.n++;
    this.min.push(V(cx - hx, cy - hy, cz - hz));
    this.max.push(V(cx + hx, cy + hy, cz + hz));
    this.tag.push(tag); this.on.push(true);
    const c = this.cell;
    const x0 = Math.floor((cx - hx) / c), x1 = Math.floor((cx + hx) / c);
    const z0 = Math.floor((cz - hz) / c), z1 = Math.floor((cz + hz) / c);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = this.key(x, z); let a = this.grid.get(k);
      if (!a) { a = []; this.grid.set(k, a); }
      a.push(i);
    }
    return i;
  },
  _seen: new Set(),
  query(minx, minz, maxx, maxz, out) {
    out.length = 0;
    const c = this.cell, seen = this._seen; seen.clear();
    const x0 = Math.floor(minx / c), x1 = Math.floor(maxx / c);
    const z0 = Math.floor(minz / c), z1 = Math.floor(maxz / c);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const a = this.grid.get(this.key(x, z)); if (!a) continue;
      for (let i = 0; i < a.length; i++) { const id = a[i]; if (!seen.has(id)) { seen.add(id); out.push(id); } }
    }
    return out;
  },
  reset() { this.min.length = this.max.length = this.tag.length = this.on.length = 0; this.n = 0; this.grid.clear(); }
};
const _ids = [], _ids2 = [], _ids3 = [];

/* push a sphere out of the world; accumulates push + best upward normal */
function resolveSphere(c, r, outPush) {
  outPush.set(0, 0, 0);
  let hit = false, bestNy = -2;
  for (let pass = 0; pass < 3; pass++) {
    SOLIDS.query(c.x - r, c.z - r, c.x + r, c.z + r, _ids);
    let moved = false;
    for (let k = 0; k < _ids.length; k++) {
      const i = _ids[k];
      if (!SOLIDS.on[i] || SOLIDS.tag[i] === 'ghost') continue;
      const mn = SOLIDS.min[i], mx = SOLIDS.max[i];
      if (c.y + r < mn.y || c.y - r > mx.y) continue;
      const px = clamp(c.x, mn.x, mx.x), py = clamp(c.y, mn.y, mx.y), pz = clamp(c.z, mn.z, mx.z);
      let dx = c.x - px, dy = c.y - py, dz = c.z - pz;
      let d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r * r) continue;
      hit = true; moved = true;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2), corr = r - d;
        dx /= d; dy /= d; dz /= d;
        c.x += dx * corr; c.y += dy * corr; c.z += dz * corr;
        outPush.x += dx * corr; outPush.y += dy * corr; outPush.z += dz * corr;
        if (dy > bestNy) bestNy = dy;
      } else {
        // centre inside: eject along least penetration axis
        const ax = Math.min(c.x - mn.x, mx.x - c.x);
        const ay = Math.min(c.y - mn.y, mx.y - c.y);
        const az = Math.min(c.z - mn.z, mx.z - c.z);
        if (ay <= ax && ay <= az) {
          const s = (c.y - (mn.y + mx.y) * 0.5) >= 0 ? 1 : -1;
          c.y += s * (ay + r); outPush.y += s * (ay + r); if (s > bestNy) bestNy = s;
        } else if (ax <= az) {
          const s = (c.x - (mn.x + mx.x) * 0.5) >= 0 ? 1 : -1;
          c.x += s * (ax + r); outPush.x += s * (ax + r);
        } else {
          const s = (c.z - (mn.z + mx.z) * 0.5) >= 0 ? 1 : -1;
          c.z += s * (az + r); outPush.z += s * (az + r);
        }
      }
    }
    if (!moved) break;
  }
  return { hit, ny: bestNy };
}

/* nearest surface point within reach of p — used for hand grabs */
const HANDPROBE = { point: V(), normal: V(), dist: 1e9, id: -1 };
function nearestSurface(p, reach) {
  let best = 1e9;
  HANDPROBE.id = -1; HANDPROBE.dist = 1e9;
  SOLIDS.query(p.x - reach, p.z - reach, p.x + reach, p.z + reach, _ids2);
  for (let k = 0; k < _ids2.length; k++) {
    const i = _ids2[k];
    if (!SOLIDS.on[i] || SOLIDS.tag[i] === 'ghost') continue;
    const mn = SOLIDS.min[i], mx = SOLIDS.max[i];
    if (p.y + reach < mn.y || p.y - reach > mx.y) continue;
    const px = clamp(p.x, mn.x, mx.x), py = clamp(p.y, mn.y, mx.y), pz = clamp(p.z, mn.z, mx.z);
    const dx = p.x - px, dy = p.y - py, dz = p.z - pz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < best) {
      best = d;
      HANDPROBE.point.set(px, py, pz);
      if (d > 1e-5) HANDPROBE.normal.set(dx / d, dy / d, dz / d); else HANDPROBE.normal.set(0, 1, 0);
      HANDPROBE.id = i;
    }
  }
  HANDPROBE.dist = best;
  return best;
}

/* segment vs AABB soup — line of sight */
function losBlocked(a, b) {
  const d = _v5.copy(b).sub(a);
  const len = d.length();
  if (len < 1e-4) return false;
  d.multiplyScalar(1 / len);
  const inv = [1 / (d.x || 1e-9), 1 / (d.y || 1e-9), 1 / (d.z || 1e-9)];
  SOLIDS.query(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z), _ids3);
  for (let k = 0; k < _ids3.length; k++) {
    const i = _ids3[k];
    if (!SOLIDS.on[i]) continue;
    const tg = SOLIDS.tag[i];
    if (tg === 'ghost' || tg === 'seethrough') continue;
    const mn = SOLIDS.min[i], mx = SOLIDS.max[i];
    let t1 = (mn.x - a.x) * inv[0], t2 = (mx.x - a.x) * inv[0];
    let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
    t1 = (mn.y - a.y) * inv[1]; t2 = (mx.y - a.y) * inv[1];
    tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
    t1 = (mn.z - a.z) * inv[2]; t2 = (mx.z - a.z) * inv[2];
    tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
    if (tmax < Math.max(tmin, 0)) continue;
    if (tmin > len) continue;
    return true;
  }
  return false;
}

/* highest solid top under (x,z) at or below fromY */
function groundY(x, z, fromY) {
  let best = -999;
  SOLIDS.query(x, z, x, z, _ids);
  for (let k = 0; k < _ids.length; k++) {
    const i = _ids[k];
    if (!SOLIDS.on[i] || SOLIDS.tag[i] === 'ghost') continue;
    const mn = SOLIDS.min[i], mx = SOLIDS.max[i];
    if (x < mn.x || x > mx.x || z < mn.z || z > mx.z) continue;
    if (mx.y <= fromY + 0.6 && mx.y > best) best = mx.y;
  }
  return best;
}
