// Synthetische Geräusche (Web Audio API), keine Audiodateien nötig
let audioCtx = null, noiseBuffer = null;
export function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.6, audioCtx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

export function noise(t, dur, vol, type, f0, f1, q = 1, out = null) {
  const src = audioCtx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = audioCtx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(f0, t);
  filter.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(g).connect(out || audioCtx.destination);
  src.start(t);
  src.stop(t + dur + 0.02);
}
export function tone(t, f0, f1, dur, vol, type = 'sine', out = null) {
  const osc = audioCtx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(out || audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}
export const SFX = {
  shot(def) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime, s = def.snd;
    noise(t, 0.35, s.vol, 'lowpass', s.cut, 250);
    noise(t, 0.05, s.vol * 0.6, 'highpass', 3000, 2000);
    tone(t, s.thump, 35, 0.2, s.vol * 0.9);
  },
  click(f = 2500, vol = 0.35, dur = 0.03) { if (!audioCtx) return; noise(audioCtx.currentTime, dur, vol, 'bandpass', f, f * 0.8, 6); },
  dry() { SFX.click(3500, 0.3, 0.025); },
  magOut() { if (!audioCtx) return; const t = audioCtx.currentTime; noise(t, 0.04, 0.4, 'bandpass', 1800, 1200, 4); noise(t + 0.05, 0.08, 0.2, 'bandpass', 900, 600, 3); },
  magIn() { if (!audioCtx) return; const t = audioCtx.currentTime; noise(t, 0.03, 0.4, 'bandpass', 1400, 1000, 4); noise(t + 0.03, 0.05, 0.6, 'bandpass', 2600, 2000, 5); },
  rackBack() { if (!audioCtx) return; const t = audioCtx.currentTime; noise(t, 0.06, 0.45, 'bandpass', 1600, 2600, 3); },
  rackFwd() { if (!audioCtx) return; const t = audioCtx.currentTime; noise(t, 0.05, 0.55, 'bandpass', 2600, 1500, 3); noise(t + 0.02, 0.04, 0.4, 'bandpass', 4000, 3500, 6); },
  shellIn() { if (!audioCtx) return; const t = audioCtx.currentTime; noise(t, 0.05, 0.4, 'bandpass', 1200, 900, 4); },
  selector() { SFX.click(4200, 0.25, 0.02); },
  grab() { SFX.click(800, 0.2, 0.03); },
  hit(pts) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    if (pts >= 10) [880, 1175, 1568].forEach((f, i) => tone(t + i * 0.06, f, f, 0.3, 0.25));
    else tone(t, 660 + pts * 30, 660 + pts * 30, 0.2, 0.22);
  },
  jingle(freqs, dur = 0.25) { if (!audioCtx) return; const t = audioCtx.currentTime; freqs.forEach((f, i) => tone(t + i * 0.09, f, f, dur, 0.22)); },
  beep() { if (!audioCtx) return; tone(audioCtx.currentTime, 1000, 1000, 0.08, 0.12, 'square'); },
  explosion() {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    noise(t, 1.6, 1.4, 'lowpass', 1800, 60);
    noise(t, 0.25, 1.0, 'highpass', 2500, 900);
    tone(t, 80, 22, 1.2, 1.0);
    for (let i = 0; i < 6; i++) noise(t + 0.1 + Math.random() * 0.6, 0.05, 0.25, 'bandpass', 3000, 2000, 3); // Splitter
  },
  thunder() {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    noise(t, 0.35, 0.5, 'lowpass', 2500, 300);
    noise(t + 0.1, 3.2, 0.7, 'lowpass', 400, 40);
    tone(t + 0.05, 45, 28, 2.5, 0.35);
  },
  marker(kill) { // Treffer-Rückmeldung
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    if (kill) { tone(t, 420, 180, 0.12, 0.22, 'triangle'); noise(t, 0.05, 0.25, 'bandpass', 1500, 900, 3); }
    else tone(t, 2600, 2400, 0.03, 0.08, 'square');
  },
  pin() { if (!audioCtx) return; const t = audioCtx.currentTime; tone(t, 2400, 2600, 0.05, 0.15, 'triangle'); noise(t + 0.06, 0.04, 0.3, 'bandpass', 3500, 3000, 6); },
  tick() { if (!audioCtx) return; tone(audioCtx.currentTime, 1500, 1500, 0.03, 0.08, 'square'); },
  whoosh() { if (!audioCtx) return; noise(audioCtx.currentTime, 0.25, 0.25, 'bandpass', 700, 2200, 2); },
  thunk() { if (!audioCtx) return; const t = audioCtx.currentTime; noise(t, 0.08, 0.7, 'lowpass', 900, 200); tone(t, 180, 90, 0.1, 0.4); },
  clang() { if (!audioCtx) return; const t = audioCtx.currentTime; [1240, 1810, 2650].forEach((f, i) => tone(t, f, f * 0.98, 0.6 - i * 0.12, 0.18, 'triangle')); noise(t, 0.05, 0.4, 'highpass', 4000, 3000); },
  can() { if (!audioCtx) return; const t = audioCtx.currentTime; noise(t, 0.12, 0.6, 'bandpass', 2400, 1200, 3); tone(t, 900, 500, 0.12, 0.15, 'triangle'); },
  thud(vol = 0.4) { if (!audioCtx) return; const t = audioCtx.currentTime; noise(t, 0.1, vol, 'lowpass', 500, 120); },
  buzz() { if (!audioCtx) return; const t = audioCtx.currentTime; tone(t, 160, 140, 0.4, 0.25, 'sawtooth'); },
  bonus() { if (!audioCtx) return; const t = audioCtx.currentTime; [784, 988, 1175, 1568].forEach((f, i) => tone(t + i * 0.05, f, f, 0.2, 0.2)); },
  ui() { SFX.click(3000, 0.2, 0.02); },
  casing() { if (!audioCtx) return; const t = audioCtx.currentTime; tone(t, 5200 + Math.random() * 1500, 4800, 0.08, 0.03, 'triangle'); }
};

export const audioNow = () => (audioCtx ? audioCtx.currentTime : null);


// ---- Räumlicher Klang (Zombies) ------------------------------------------------
export function setListener(pos, fwd, up) {
  if (!audioCtx) return;
  const l = audioCtx.listener;
  if (l.positionX) {
    l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z;
    l.forwardX.value = fwd.x; l.forwardY.value = fwd.y; l.forwardZ.value = fwd.z;
    l.upX.value = up.x; l.upY.value = up.y; l.upZ.value = up.z;
  } else {
    l.setPosition(pos.x, pos.y, pos.z);
    l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
  }
}
function panner(pos) {
  const p = audioCtx.createPanner();
  p.panningModel = 'HRTF';
  p.distanceModel = 'inverse';
  p.refDistance = 1;
  p.rolloffFactor = 1.2;
  if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
  p.connect(audioCtx.destination);
  setTimeout(() => { try { p.disconnect(); } catch { /* schon getrennt */ } }, 3000); // sonst sammeln sich Audio-Knoten an
  return p;
}
export const SFX3D = {
  step(pos, heavy = 1) { // schwerer Schritt
    if (!audioCtx) return;
    const t = audioCtx.currentTime, out = panner(pos);
    noise(t, 0.12 * heavy, 0.35 * heavy, 'lowpass', 300 + 200 / heavy, 60, 1, out);
    tone(t, 70 / heavy + 20, 30, 0.12 * heavy, 0.35 * heavy, 'sine', out);
  },
  roar(pos) { // Brüllen des Riesen
    if (!audioCtx) return;
    const t = audioCtx.currentTime, out = panner(pos);
    const osc = audioCtx.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(55, t); osc.frequency.linearRampToValueAtTime(42, t + 1.6);
    const bp = audioCtx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 600;
    const g = audioCtx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.0, t + 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
    osc.connect(bp).connect(g).connect(out); osc.start(t); osc.stop(t + 1.8);
    noise(t, 1.5, 0.4, 'bandpass', 500, 250, 2, out);
  },
  groan(pos, pitch = 1) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime, out = panner(pos), dur = 0.7 + Math.random() * 0.7;
    const osc = audioCtx.createOscillator();
    osc.type = 'sawtooth';
    const f = (70 + Math.random() * 40) * pitch;
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.linearRampToValueAtTime(f * (0.7 + Math.random() * 0.5), t + dur);
    const lfo = audioCtx.createOscillator(), lg = audioCtx.createGain();
    lfo.frequency.value = 5 + Math.random() * 4; lg.gain.value = 6;
    lfo.connect(lg).connect(osc.frequency);
    const bp = audioCtx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 4; bp.frequency.setValueAtTime(450 + Math.random() * 300, t); bp.frequency.linearRampToValueAtTime(300, t + dur);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 0.12); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(bp).connect(g).connect(out);
    osc.start(t); lfo.start(t); osc.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
    noise(t, dur * 0.8, 0.12, 'bandpass', 900, 500, 2, out);
  },
  crack(pos) { // Brett wird abgerissen
    if (!audioCtx) return;
    const t = audioCtx.currentTime, out = panner(pos);
    noise(t, 0.05, 1.0, 'bandpass', 2500, 1500, 2, out);
    noise(t + 0.03, 0.25, 0.6, 'lowpass', 1200, 200, 1, out);
    tone(t, 220, 90, 0.15, 0.4, 'square', out);
  },
  bang(pos) { // Schlag gegen die Bretter
    if (!audioCtx) return;
    const t = audioCtx.currentTime, out = panner(pos);
    noise(t, 0.12, 0.8, 'lowpass', 700, 150, 1, out);
    tone(t, 120, 60, 0.15, 0.5, 'sine', out);
  },
  splat(pos) { // Treffer
    if (!audioCtx) return;
    const t = audioCtx.currentTime, out = panner(pos);
    noise(t, 0.09, 0.7, 'lowpass', 1800, 300, 1, out);
  },
  swing(pos) { // Zombie schlägt zu
    if (!audioCtx) return;
    noise(audioCtx.currentTime, 0.25, 0.4, 'bandpass', 400, 1400, 2, panner(pos));
  }
};
export const SFX_PLAYER = {
  hurt() { if (!audioCtx) return; const t = audioCtx.currentTime; noise(t, 0.15, 0.8, 'lowpass', 600, 100); tone(t, 180, 110, 0.25, 0.35, 'triangle'); },
  heartbeat() { if (!audioCtx) return; const t = audioCtx.currentTime; tone(t, 60, 40, 0.12, 0.5); tone(t + 0.18, 55, 38, 0.12, 0.4); }
};
