// Synthetische Geräusche (Web Audio API), keine Audiodateien nötig.
// Aufbau: alle Klänge laufen über Busse (Effekte, Musik, Stimmen) → Kompressor → Ausgang.
// Ein künstlicher Raumhall (Faltungshall mit berechneter Impulsantwort) macht Schüsse und Explosionen „groß“.
let audioCtx = null, noiseBuffer = null;
let master = null, sfxBus = null, musicBus = null, voiceBus = null, reverbIn = null;
const vol = { master: 0.9, sfx: 1, music: 0.55, voices: 1 };
export function setVolumes(v) {
  Object.assign(vol, v);
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  master.gain.setTargetAtTime(vol.master, t, 0.05);
  sfxBus.gain.setTargetAtTime(vol.sfx, t, 0.05);
  musicBus.gain.setTargetAtTime(vol.music * 0.5, t, 0.05);
  voiceBus.gain.setTargetAtTime(vol.voices, t, 0.05);
}
function impulse(seconds, decay) {
  const len = Math.floor(audioCtx.sampleRate * seconds);
  const buf = audioCtx.createBuffer(2, len, audioCtx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const k = i / len;
      // frühe Reflexionen + diffuser Nachhall
      const early = i < audioCtx.sampleRate * 0.03 && Math.random() < 0.004 ? (Math.random() * 2 - 1) * 2 : 0;
      d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - k, decay) + early) * 0.6;
    }
  }
  return buf;
}
export function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 1.2, audioCtx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const comp = audioCtx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    master = audioCtx.createGain();
    master.connect(comp).connect(audioCtx.destination);
    sfxBus = audioCtx.createGain(); sfxBus.connect(master);
    musicBus = audioCtx.createGain(); musicBus.connect(master);
    voiceBus = audioCtx.createGain(); voiceBus.connect(master);
    const conv = audioCtx.createConvolver();
    conv.buffer = impulse(1.6, 3.2);
    const wetGain = audioCtx.createGain(); wetGain.gain.value = 0.55;
    reverbIn = audioCtx.createGain();
    reverbIn.connect(conv).connect(wetGain).connect(master);
    setVolumes({});
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}
// Sendeweg in den Hall
function send(amount, keep = false) { const g = audioCtx.createGain(); g.gain.value = amount; g.connect(reverbIn); if (!keep) setTimeout(() => { try { g.disconnect(); } catch { /* weg */ } }, 8000); return g; }
function split(out, rev) { // trocken + Hall
  if (!rev) return out || sfxBus;
  const g = audioCtx.createGain();
  g.connect(out || sfxBus);
  g.connect(send(rev));
  setTimeout(() => { try { g.disconnect(); } catch { /* weg */ } }, 8000);
  return g;
}

export function noise(t, dur, v, type, f0, f1, q = 1, out = null) {
  const src = audioCtx.createBufferSource();
  src.buffer = noiseBuffer;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const filter = audioCtx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(f0, t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(g).connect(out || sfxBus);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}
export function tone(t, f0, f1, dur, v, type = 'sine', out = null) {
  const osc = audioCtx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(out || sfxBus);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}
// Waffen-Charakter aus den Waffendaten ableiten
function gunKind(def) {
  if (def.bow) return 'bow';
  if (def.projectile === 'plasma' || def.chain || def.freeze || def.energy) return 'energy';
  if (def.projectile === 'bolt') return 'bow';
  if (def.projectile === 'grenade') return 'launcher';
  if (def.flame) return 'flame';
  if (def.pellets > 1) return 'shotgun';
  if ((def.dmg || 30) >= 140) return 'heavy';
  if (def.rpm >= 950) return 'smg';
  if (!def.twoHand) return 'pistol';
  return 'rifle';
}
export const SFX = {
  shot(def) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime, s = def.snd, k = gunKind(def), v = s.vol;
    const out = split(sfxBus, k === 'flame' ? 0.1 : 0.32);
    if (k === 'energy') {
      tone(t, def.chain ? 2400 : def.freeze ? 1800 : 1400, 180, 0.35, v * 0.5, 'sawtooth', out);
      tone(t, 900, 60, 0.4, v * 0.6, 'sine', out);
      noise(t, 0.3, v * 0.35, def.freeze ? 'highpass' : 'bandpass', 6000, 1500, 2, out);
    } else if (k === 'bow') {
      noise(t, 0.12, v * 0.9, 'bandpass', 1200, 300, 3, out);
      tone(t, 140, 70, 0.25, v * 0.6, 'triangle', out);
    } else if (k === 'launcher') {
      noise(t, 0.18, v * 1.1, 'lowpass', 1400, 120, 1, out);
      tone(t, 95, 40, 0.3, v * 1.0, 'sine', out);
      noise(t, 0.03, v * 0.5, 'highpass', 3000, 2500, 1, out);
    } else if (k === 'flame') {
      noise(t, 0.09, v * 0.35, 'lowpass', 900, 300, 1, out);
      noise(t, 0.08, v * 0.2, 'bandpass', 2500, 1200, 1, out);
    } else {
      const body = { pistol: [3600, 0.25], smg: [3800, 0.18], rifle: [3000, 0.32], shotgun: [1800, 0.45], heavy: [1500, 0.6] }[k];
      noise(t, 0.012, v * 0.9, 'highpass', 6000, 4000, 1, out);                // Knall-Transient
      noise(t, body[1], v, 'lowpass', s.cut, 200, 1, out);                    // Körper
      tone(t, s.thump, 32, body[1] * 0.8, v * (k === 'heavy' || k === 'shotgun' ? 1.2 : 0.9), 'sine', out); // Druck
      if (k === 'shotgun' || k === 'heavy') noise(t + 0.01, 0.4, v * 0.5, 'lowpass', 600, 60, 1, out);
      noise(t + 0.004, 0.05, v * 0.3, 'bandpass', 4200, 3000, 4, out);       // Mechanik
      // Echo vom Raum (leicht verzögert und gedämpft)
      noise(t + 0.09 + Math.random() * 0.04, body[1] * 0.8, v * 0.18, 'lowpass', 1200, 150, 1, out);
    }
    if (def.upgraded) tone(t, 3200, 900, 0.18, 0.12, 'square', out); // aufgerüstet: Laser-Schimmer
  },
  click(f = 2500, v = 0.35, dur = 0.03) { if (!audioCtx) return; noise(audioCtx.currentTime, dur, v, 'bandpass', f, f * 0.8, 6); },
  dry() { if (!audioCtx) return; const t = audioCtx.currentTime; noise(t, 0.025, 0.35, 'bandpass', 3500, 3000, 8); tone(t, 1800, 1700, 0.02, 0.05, 'square'); },
  magOut() { if (!audioCtx) return; const t = audioCtx.currentTime; noise(t, 0.04, 0.4, 'bandpass', 1800, 1200, 4); tone(t, 2200, 2100, 0.08, 0.04, 'triangle'); noise(t + 0.05, 0.08, 0.2, 'bandpass', 900, 600, 3); },
  magIn() { if (!audioCtx) return; const t = audioCtx.currentTime; noise(t, 0.03, 0.4, 'bandpass', 1400, 1000, 4); noise(t + 0.03, 0.05, 0.7, 'bandpass', 2600, 2000, 5); tone(t + 0.03, 3100, 3000, 0.12, 0.05, 'triangle'); },
  rackBack() { if (!audioCtx) return; const t = audioCtx.currentTime; noise(t, 0.06, 0.5, 'bandpass', 1600, 2600, 3); tone(t, 1500, 1400, 0.05, 0.04, 'triangle'); },
  rackFwd() { if (!audioCtx) return; const t = audioCtx.currentTime; noise(t, 0.05, 0.6, 'bandpass', 2600, 1500, 3); noise(t + 0.02, 0.04, 0.45, 'bandpass', 4000, 3500, 6); tone(t + 0.02, 2700, 2600, 0.1, 0.05, 'triangle'); },
  shellIn() { if (!audioCtx) return; const t = audioCtx.currentTime; noise(t, 0.05, 0.45, 'bandpass', 1200, 900, 4); tone(t + 0.02, 900, 850, 0.06, 0.05, 'triangle'); },
  selector() { SFX.click(4200, 0.25, 0.02); },
  grab() { if (!audioCtx) return; const t = audioCtx.currentTime; noise(t, 0.04, 0.25, 'bandpass', 700, 500, 2); noise(t + 0.01, 0.02, 0.15, 'bandpass', 2500, 2000, 4); },
  hit(pts) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    if (pts >= 10) [880, 1175, 1568].forEach((f, i) => tone(t + i * 0.06, f, f, 0.3, 0.25));
    else tone(t, 660 + pts * 30, 660 + pts * 30, 0.2, 0.22);
  },
  jingle(freqs, dur = 0.25) { if (!audioCtx) return; const t = audioCtx.currentTime, out = split(sfxBus, 0.25); freqs.forEach((f, i) => { tone(t + i * 0.09, f, f, dur, 0.18, 'triangle', out); tone(t + i * 0.09, f * 2, f * 2, dur * 0.7, 0.05, 'sine', out); }); },
  beep() { if (!audioCtx) return; tone(audioCtx.currentTime, 1000, 1000, 0.08, 0.12, 'square'); },
  explosion(size = 1) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime, out = split(sfxBus, 0.5);
    noise(t, 0.02, 1.2 * size, 'highpass', 5000, 3000, 1, out);
    noise(t, 1.8 * size, 1.4 * size, 'lowpass', 2200, 50, 1, out);
    noise(t, 0.3, 1.0 * size, 'highpass', 2500, 900, 1, out);
    tone(t, 90, 20, 1.4 * size, 1.1 * size, 'sine', out);
    tone(t + 0.02, 55, 18, 1.6 * size, 0.8 * size, 'sine', out);
    for (let i = 0; i < 8; i++) noise(t + 0.1 + Math.random() * 0.9, 0.05, 0.2, 'bandpass', 2000 + Math.random() * 3000, 1500, 3, out); // Splitter/Trümmer
  },
  thunder() {
    if (!audioCtx) return;
    const t = audioCtx.currentTime, out = split(sfxBus, 0.6);
    noise(t, 0.35, 0.5, 'lowpass', 2500, 300, 1, out);
    noise(t + 0.1, 3.2, 0.7, 'lowpass', 400, 40, 1, out);
    tone(t + 0.05, 45, 28, 2.5, 0.35, 'sine', out);
  },
  marker(kill, head = false) { // Treffer-Rückmeldung
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    if (head) { tone(t, 3100, 3000, 0.09, 0.12, 'triangle'); tone(t + 0.04, 4200, 4100, 0.12, 0.08, 'sine'); }
    if (kill) { tone(t, 420, 180, 0.12, 0.22, 'triangle'); noise(t, 0.08, 0.35, 'bandpass', 1300, 500, 2); noise(t + 0.02, 0.15, 0.3, 'lowpass', 600, 100); }
    else tone(t, 2600, 2400, 0.03, 0.08, 'square');
  },
  pin() { if (!audioCtx) return; const t = audioCtx.currentTime; tone(t, 2400, 2600, 0.05, 0.15, 'triangle'); noise(t + 0.06, 0.04, 0.3, 'bandpass', 3500, 3000, 6); },
  tick() { if (!audioCtx) return; tone(audioCtx.currentTime, 1500, 1500, 0.03, 0.08, 'square'); },
  whoosh() { if (!audioCtx) return; noise(audioCtx.currentTime, 0.25, 0.25, 'bandpass', 700, 2200, 2); },
  thunk() { if (!audioCtx) return; const t = audioCtx.currentTime; noise(t, 0.08, 0.7, 'lowpass', 900, 200); tone(t, 180, 90, 0.1, 0.4); },
  clang() { if (!audioCtx) return; const t = audioCtx.currentTime, out = split(sfxBus, 0.3); [1240, 1810, 2650].forEach((f, i) => tone(t, f, f * 0.98, 0.6 - i * 0.12, 0.18, 'triangle', out)); noise(t, 0.05, 0.4, 'highpass', 4000, 3000, 1, out); },
  can() { if (!audioCtx) return; const t = audioCtx.currentTime; noise(t, 0.12, 0.6, 'bandpass', 2400, 1200, 3); tone(t, 900, 500, 0.12, 0.15, 'triangle'); },
  thud(v = 0.4) { if (!audioCtx) return; const t = audioCtx.currentTime; noise(t, 0.1, v, 'lowpass', 500, 120); tone(t, 110, 60, 0.08, v * 0.5); },
  buzz() { if (!audioCtx) return; const t = audioCtx.currentTime; tone(t, 160, 140, 0.4, 0.25, 'sawtooth'); },
  bonus() { if (!audioCtx) return; const t = audioCtx.currentTime, out = split(sfxBus, 0.3); [784, 988, 1175, 1568].forEach((f, i) => tone(t + i * 0.05, f, f, 0.25, 0.18, 'triangle', out)); },
  ui() { if (!audioCtx) return; const t = audioCtx.currentTime; tone(t, 1800, 1500, 0.04, 0.08, 'triangle'); noise(t, 0.015, 0.15, 'bandpass', 3000, 2500, 4); },
  casing() { if (!audioCtx) return; const t = audioCtx.currentTime; tone(t, 5200 + Math.random() * 1500, 4800, 0.08, 0.03, 'triangle'); tone(t + 0.07, 4800 + Math.random() * 1000, 4500, 0.05, 0.015, 'triangle'); },
  coins() { if (!audioCtx) return; const t = audioCtx.currentTime; for (let i = 0; i < 4; i++) tone(t + i * 0.045, 2600 + Math.random() * 900, 2400, 0.12, 0.06, 'triangle'); },
  gulp() { if (!audioCtx) return; const t = audioCtx.currentTime; for (let i = 0; i < 3; i++) { tone(t + i * 0.22, 180, 90, 0.12, 0.35, 'sine'); noise(t + i * 0.22, 0.1, 0.15, 'lowpass', 500, 150); } tone(t + 0.8, 300, 600, 0.3, 0.15, 'sine'); },
  powerup() { if (!audioCtx) return; const t = audioCtx.currentTime, out = split(sfxBus, 0.4); tone(t, 200, 1600, 0.5, 0.2, 'sawtooth', out); [523, 659, 784, 1046].forEach((f, i) => tone(t + 0.3 + i * 0.07, f, f, 0.35, 0.15, 'triangle', out)); },
  slowmo() { if (!audioCtx) return; const t = audioCtx.currentTime, out = split(sfxBus, 0.6); tone(t, 400, 60, 1.2, 0.35, 'sine', out); noise(t, 1.0, 0.3, 'lowpass', 1500, 100, 1, out); },
  fire() { if (!audioCtx) return; noise(audioCtx.currentTime, 0.4, 0.12, 'bandpass', 600, 300, 1); },
  freeze() { if (!audioCtx) return; const t = audioCtx.currentTime, out = split(sfxBus, 0.4); noise(t, 0.4, 0.4, 'highpass', 7000, 3000, 1, out); for (let i = 0; i < 5; i++) tone(t + i * 0.03, 3000 + Math.random() * 3000, 2500, 0.15, 0.05, 'triangle', out); },
  shatter() { if (!audioCtx) return; const t = audioCtx.currentTime, out = split(sfxBus, 0.4); noise(t, 0.3, 0.7, 'highpass', 5000, 2000, 1, out); for (let i = 0; i < 9; i++) tone(t + Math.random() * 0.2, 2500 + Math.random() * 5000, 2000, 0.2, 0.06, 'triangle', out); },
  zap() { if (!audioCtx) return; const t = audioCtx.currentTime; for (let i = 0; i < 4; i++) noise(t + i * 0.03, 0.03, 0.3, 'bandpass', 3000 + Math.random() * 3000, 2000, 5); },
  // Stinger: Welle beginnt / überlebt (tiefe Blechbläser + Pauke)
  waveStart() {
    if (!audioCtx) return;
    const t = audioCtx.currentTime, out = split(musicBus, 0.6);
    for (const f of [55, 82.4, 110]) { tone(t, f, f * 0.98, 2.2, 0.35, 'sawtooth', out); }
    noise(t, 1.2, 0.8, 'lowpass', 300, 40, 1, out);
    tone(t, 70, 35, 1.0, 0.9, 'sine', out);
  },
  waveEnd() {
    if (!audioCtx) return;
    const t = audioCtx.currentTime, out = split(musicBus, 0.6);
    [220, 277, 330, 440].forEach((f, i) => { tone(t + i * 0.12, f, f, 1.4, 0.12, 'triangle', out); tone(t + i * 0.12, f * 1.005, f, 1.4, 0.08, 'sawtooth', out); });
  }
};

// Pause: alle Klänge anhalten
export function setAudioPaused(on) { if (!audioCtx) return; try { if (on) audioCtx.suspend(); else audioCtx.resume(); } catch { /* egal */ } }
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
// 3D-Klangquelle. Leistung (wichtig auf der Quest): HRTF (sehr genaues Richtungshören) ist teuer –
// nur für höchstens 8 gleichzeitige Klänge; der Rest (und unwichtige Geräusche wie Schritte) nutzt
// einfaches Stereo-Panning. Knoten werden nach Klangende freigegeben statt pauschal nach 3,5 s.
let hrtfActive = 0, pannersActive = 0;
export const audioLoad = () => pannersActive;
function panner(pos, bus = null, rev = 0.25, life = 1.2, cheap = false) {
  const p = audioCtx.createPanner();
  const hrtf = !cheap && hrtfActive < 8;
  p.panningModel = hrtf ? 'HRTF' : 'equalpower';
  if (hrtf) hrtfActive++;
  pannersActive++;
  p.distanceModel = 'inverse';
  p.refDistance = 1;
  p.rolloffFactor = 1.2;
  if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
  p.connect(bus || sfxBus);
  const s = send(rev);
  p.connect(s);
  setTimeout(() => { try { p.disconnect(); s.disconnect(); } catch { /* schon getrennt */ } if (hrtf) hrtfActive--; pannersActive--; }, life * 1000 + 400); // sonst sammeln sich Audio-Knoten an
  return p;
}
// Zombie-Stimme: Sägezahn durch Vokal-Formanten (a/o/u) mit Pitch-Bewegung und Zittern
let activeVoices = 0;
const VOWELS = { a: [700, 1150, 2400], o: [450, 800, 2500], u: [320, 750, 2300], e: [500, 1700, 2500], aa: [850, 1250, 2600] };
function voice(pos, { f0 = 90, f1 = 70, dur = 1, vowel = 'o', v = 0.7, rough = 0.3, wobble = 6, q = 6 } = {}) {
  if (activeVoices >= 8) return; // nicht zu viele gleichzeitig (Leistung + Klarheit)
  activeVoices++;
  setTimeout(() => { activeVoices--; }, dur * 1000 + 100);
  const t = audioCtx.currentTime, out = panner(pos, voiceBus, 0.3, dur + 0.3);
  const osc = audioCtx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.linearRampToValueAtTime(f1, t + dur);
  const lfo = audioCtx.createOscillator(), lg = audioCtx.createGain();
  lfo.frequency.value = wobble + Math.random() * 3; lg.gain.value = f0 * 0.06;
  lfo.connect(lg).connect(osc.frequency);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + Math.min(0.12, dur * 0.2));
  g.gain.setValueAtTime(v, t + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const mix = audioCtx.createGain();
  mix.connect(g).connect(out);
  const vw = VOWELS[vowel];
  vw.forEach((f, i) => {
    const bp = audioCtx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = q; bp.frequency.value = f * (0.95 + Math.random() * 0.1);
    const fg = audioCtx.createGain(); fg.gain.value = [1, 0.6, 0.25][i];
    osc.connect(bp).connect(fg).connect(mix);
  });
  osc.start(t); lfo.start(t); osc.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  if (rough > 0) noise(t, dur * 0.9, v * rough * 0.4, 'bandpass', vw[0] * 1.3, vw[0] * 0.8, 2, out); // Röcheln
}
const ri = (a, b) => a + Math.random() * (b - a);
export const SFX3D = {
  step(pos, heavy = 1) { // schwerer Schritt
    if (!audioCtx) return;
    if (pannersActive > 28 && heavy < 1.5) return; // bei sehr viel Geräusch: einfache Schritte auslassen
    const t = audioCtx.currentTime, out = panner(pos, null, 0.25, 0.4, heavy < 1.5);
    noise(t, 0.12 * heavy, 0.35 * heavy, 'lowpass', 300 + 200 / heavy, 60, 1, out);
    tone(t, 70 / heavy + 20, 30, 0.12 * heavy, 0.35 * heavy, 'sine', out);
  },
  shuffle(pos) { if (!audioCtx || pannersActive > 20) return; noise(audioCtx.currentTime, 0.18, 0.12, 'bandpass', 900, 400, 1.5, panner(pos, null, 0.1, 0.3, true)); },
  roar(pos) { // Brüllen des Riesen
    if (!audioCtx) return;
    voice(pos, { f0: 60, f1: 42, dur: 1.8, vowel: 'aa', v: 1.0, rough: 0.8, wobble: 9, q: 4 });
    voice(pos, { f0: 90, f1: 62, dur: 1.6, vowel: 'a', v: 0.6, rough: 0.5, wobble: 7, q: 5 });
  },
  // Stöhnen je nach Zombie-Typ
  groan(pos, pitch = 1, type = 'walker') {
    if (!audioCtx) return;
    if (type === 'runner') { voice(pos, { f0: ri(180, 260) * pitch, f1: ri(120, 160), dur: ri(0.4, 0.8), vowel: Math.random() < 0.5 ? 'aa' : 'e', v: 0.6, rough: 0.6, wobble: 11 }); return; }
    if (type === 'brute' || type === 'giant') { voice(pos, { f0: ri(55, 70), f1: ri(40, 50), dur: ri(1.0, 1.6), vowel: 'o', v: 0.9, rough: 0.6, wobble: 5, q: 5 }); return; }
    if (type === 'bloater') { voice(pos, { f0: ri(70, 90), f1: ri(50, 60), dur: ri(0.8, 1.3), vowel: 'u', v: 0.6, rough: 1.0, wobble: 14 }); noise(audioCtx.currentTime + 0.2, 0.5, 0.2, 'lowpass', 400, 120, 3, panner(pos, voiceBus)); return; } // Gurgeln
    if (type === 'spitter') { voice(pos, { f0: ri(150, 200), f1: ri(260, 320), dur: ri(0.5, 0.8), vowel: 'e', v: 0.55, rough: 0.9, wobble: 13 }); return; }
    if (type === 'crawler') { voice(pos, { f0: ri(100, 130), f1: ri(80, 95), dur: ri(0.6, 1.0), vowel: 'u', v: 0.5, rough: 0.7, wobble: 8 }); return; }
    voice(pos, { f0: ri(75, 110) * pitch, f1: ri(55, 80) * pitch, dur: ri(0.8, 1.5), vowel: Math.random() < 0.5 ? 'o' : 'a', v: 0.65, rough: 0.35, wobble: ri(4, 8) });
  },
  growl(pos, type = 'walker') { // Angriff
    if (!audioCtx) return;
    const low = type === 'brute' || type === 'giant';
    voice(pos, { f0: low ? 75 : ri(120, 160), f1: low ? 55 : ri(90, 110), dur: 0.45, vowel: 'aa', v: 0.8, rough: 0.9, wobble: 18, q: 4 });
  },
  scream(pos) { // Renner kreischt beim Losrennen
    if (!audioCtx) return;
    voice(pos, { f0: ri(320, 420), f1: ri(200, 260), dur: ri(0.7, 1.0), vowel: 'aa', v: 0.7, rough: 0.8, wobble: 12, q: 3 });
  },
  death(pos, type = 'walker') { // Todesröcheln
    if (!audioCtx) return;
    const low = type === 'brute' || type === 'giant';
    voice(pos, { f0: low ? 80 : ri(130, 170), f1: low ? 35 : ri(50, 70), dur: ri(0.6, 1.0), vowel: Math.random() < 0.5 ? 'u' : 'o', v: 0.6, rough: 0.9, wobble: 20 });
  },
  hurt(pos, type = 'walker') {
    if (!audioCtx) return;
    voice(pos, { f0: type === 'brute' || type === 'giant' ? 90 : ri(150, 210), f1: ri(90, 120), dur: 0.25, vowel: 'e', v: 0.45, rough: 0.6, wobble: 20 });
  },
  // Trommel-Affe: Blechtrommel + Spieluhr-Melodie (laut, damit man ihn überall hört)
  drum(pos, beat) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime, out = panner(pos, null, 0.3);
    noise(t, 0.08, 0.7, 'bandpass', beat % 2 ? 1800 : 900, 600, 2, out);
    tone(t, beat % 2 ? 260 : 180, 120, 0.1, 0.4, 'triangle', out);
    const mel = [784, 659, 784, 988];
    tone(t, mel[beat % 4], mel[beat % 4], 0.18, 0.12, 'square', out);
  },
  crack(pos) { // Brett wird abgerissen
    if (!audioCtx) return;
    const t = audioCtx.currentTime, out = panner(pos, null, 0.35);
    noise(t, 0.05, 1.0, 'bandpass', 2500, 1500, 2, out);
    noise(t + 0.03, 0.25, 0.6, 'lowpass', 1200, 200, 1, out);
    tone(t, 220, 90, 0.15, 0.4, 'square', out);
    for (let i = 0; i < 3; i++) noise(t + 0.05 + Math.random() * 0.15, 0.03, 0.4, 'bandpass', 3000, 2000, 4, out); // Splittern
  },
  bang(pos) { // Schlag gegen die Bretter
    if (!audioCtx) return;
    const t = audioCtx.currentTime, out = panner(pos, null, 0.35);
    noise(t, 0.12, 0.8, 'lowpass', 700, 150, 1, out);
    tone(t, 120, 60, 0.15, 0.5, 'sine', out);
  },
  splat(pos) { // Treffer: nass und dumpf
    if (!audioCtx) return;
    // höchstens ~20 pro Sekunde (Dauerfeuer/Schrot auf den Boss erzeugte sonst Hunderte 3D-Klangquellen → Lag)
    const now = audioCtx.currentTime; if (now - (SFX3D._splatT || 0) < 0.05) return; SFX3D._splatT = now;
    const t = audioCtx.currentTime, out = panner(pos, null, 0.1);
    noise(t, 0.09, 0.7, 'lowpass', 1800, 300, 1, out);
    noise(t + 0.01, 0.06, 0.3, 'bandpass', 600, 250, 3, out);
  },
  swing(pos) { // Zombie schlägt zu
    if (!audioCtx) return;
    noise(audioCtx.currentTime, 0.25, 0.4, 'bandpass', 400, 1400, 2, panner(pos));
  },
  // Umgebung: knarrende Tür, ferner Schrei, Wind, Tropfen (zufällig im Raum verteilt)
  ambient(pos, kind) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime, out = panner(pos, null, 0.7, 3.2);
    if (kind === 'creak') { const o = audioCtx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(ri(180, 260), t); o.frequency.linearRampToValueAtTime(ri(120, 340), t + 1.2); const bp = audioCtx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 12; bp.frequency.value = 900; const g = audioCtx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2); o.connect(bp).connect(g).connect(out); o.start(t); o.stop(t + 1.3); }
    else if (kind === 'scream') voice(pos, { f0: ri(380, 520), f1: ri(200, 300), dur: 1.4, vowel: 'aa', v: 0.18, rough: 0.5, wobble: 7, q: 3 });
    else if (kind === 'wind') noise(t, 3, 0.18, 'bandpass', ri(300, 500), ri(700, 1100), 4, out);
    else if (kind === 'drip') tone(t, ri(1400, 2200), ri(700, 900), 0.12, 0.07, 'sine', out);
    else if (kind === 'chain') for (let i = 0; i < 5; i++) tone(t + i * 0.07 + Math.random() * 0.04, ri(1800, 3200), 1600, 0.15, 0.04, 'triangle', out);
  }
};
export const SFX_PLAYER = {
  hurt() { if (!audioCtx) return; const t = audioCtx.currentTime; noise(t, 0.15, 0.8, 'lowpass', 600, 100); tone(t, ri(170, 200), 110, 0.25, 0.35, 'triangle'); noise(t, 0.2, 0.25, 'bandpass', 500, 300, 3); },
  heartbeat() { if (!audioCtx) return; const t = audioCtx.currentTime; tone(t, 60, 40, 0.12, 0.6); tone(t + 0.18, 55, 38, 0.12, 0.45); },
  breath() { if (!audioCtx) return; const t = audioCtx.currentTime; noise(t, 0.6, 0.12, 'bandpass', 900, 600, 1.5); noise(t + 0.75, 0.5, 0.08, 'bandpass', 700, 500, 1.5); }
};

// ---- Musik: prozedurale Horror-Untermalung -------------------------------------------
// Dröhnen (zwei leicht verstimmte Sägezähne, langsam gefiltert), Herzschlag-Puls je nach Spannung,
// gelegentliche dissonante Klangflächen.
const music = { on: false, nodes: [], intensity: 0, pulseT: 0, padT: 4, filter: null, droneGain: null };
export function musicStart() {
  if (!audioCtx || music.on) return;
  music.on = true;
  const t = audioCtx.currentTime;
  const f = audioCtx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220; f.Q.value = 3;
  const g = audioCtx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 4);
  f.connect(g).connect(musicBus);
  const ds = send(0.5, true); g.connect(ds); music.nodes.push({ stop() {}, disconnect: () => ds.disconnect() });
  for (const [freq, type] of [[36.7, 'sawtooth'], [36.95, 'sawtooth'], [55.1, 'triangle']]) {
    const o = audioCtx.createOscillator(); o.type = type; o.frequency.value = freq; o.connect(f); o.start(t); music.nodes.push(o);
  }
  const lfo = audioCtx.createOscillator(), lg = audioCtx.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 120; lfo.connect(lg).connect(f.frequency); lfo.start(t);
  music.nodes.push(lfo);
  music.filter = f; music.droneGain = g;
}
export function musicStop() {
  if (!audioCtx || !music.on) return;
  music.on = false;
  const t = audioCtx.currentTime;
  music.droneGain.gain.setTargetAtTime(0.0001, t, 0.8);
  const nodes = music.nodes.splice(0);
  setTimeout(() => { for (const n of nodes) { try { n.stop(); n.disconnect(); } catch { /* weg */ } } }, 3500);
}
// Spannung 0..1 (Anzahl naher Zombies, wenig Leben)
export function musicUpdate(dt, intensity) {
  if (!audioCtx || !music.on) return;
  music.intensity += (intensity - music.intensity) * Math.min(1, dt * 0.8);
  const k = music.intensity;
  music.filter.frequency.setTargetAtTime(200 + k * 700, audioCtx.currentTime, 0.5);
  // Puls (tiefe Trommel), schneller bei hoher Spannung
  music.pulseT -= dt;
  if (k > 0.15 && music.pulseT <= 0) {
    music.pulseT = 1.2 - k * 0.7;
    const t = audioCtx.currentTime;
    tone(t, 62, 34, 0.35, 0.25 + k * 0.4, 'sine', musicBus);
    if (k > 0.55) noise(t, 0.08, 0.12 * k, 'highpass', 6000, 4000, 1, musicBus); // Hi-Hat-artiges Ticken
  }
  // dissonante Klangflächen (Streicher-artig)
  music.padT -= dt;
  if (music.padT <= 0) {
    music.padT = ri(9, 18) - k * 5;
    const t = audioCtx.currentTime, base = [110, 116.5, 123.5, 98][Math.floor(Math.random() * 4)];
    const out = split(musicBus, 0.8);
    for (const m of [1, 1.06, 1.5]) {
      const o = audioCtx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = base * m;
      const lp = audioCtx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const g = audioCtx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05 + k * 0.04, t + 2); g.gain.exponentialRampToValueAtTime(0.0001, t + 6);
      o.connect(lp).connect(g).connect(out); o.start(t); o.stop(t + 6.1);
    }
  }
}
