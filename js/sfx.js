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

export function noise(t, dur, vol, type, f0, f1, q = 1) {
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
  src.connect(filter).connect(g).connect(audioCtx.destination);
  src.start(t);
  src.stop(t + dur + 0.02);
}
export function tone(t, f0, f1, dur, vol, type = 'sine') {
  const osc = audioCtx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(audioCtx.destination);
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

