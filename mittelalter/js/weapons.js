import * as THREE from 'three';
import { MAT, prof, box, cylZ, cylY, cylX, sphere, cachedGeo, mergeStatic } from './util.js?v=50';

// Waffen: Daten, Modelle, Munition
export const WEAPON_ORDER = ['pistol', 'smg', 'shotgun', 'sniper'];
export const WEAPON_DEFS = {
  pistol: {
    name: 'Pistole P9', desc: '15 Schuss · Halbautomat · Kimme & Korn',
    twoHand: false, capacity: 15, feed: 'mag', action: 'slide', autoCycle: true, holdOpen: true,
    modes: ['semi'], startMode: 0, rpm: 450, spread: 0.002, pellets: 1,
    recoil: { back: 0.035, rise: 0.32, jitter: 0.02 }, travel: 0.045, sight: 'iron',
    range: [2.5, 6], scoreMult: 1, grip: [-0.028, -0.03], snd: { cut: 4200, thump: 140, vol: 0.85 }
  },
  smg: {
    name: 'Maschinenpistole MPX', desc: '30 Schuss · Einzel/Dauerfeuer · Rotpunkt',
    twoHand: true, capacity: 30, feed: 'mag', action: 'charge', autoCycle: true, holdOpen: true,
    modes: ['safe', 'semi', 'auto'], startMode: 1, rpm: 800, spread: 0.003, pellets: 1,
    recoil: { back: 0.016, rise: 0.09, jitter: 0.04 }, travel: 0.065, sight: 'reddot',
    range: [3, 7], scoreMult: 0.8, grip: [-0.022, -0.025], snd: { cut: 3200, thump: 120, vol: 0.7 }
  },
  shotgun: {
    name: 'Pump-Flinte', desc: '6+1 Patronen · Schrot · Vorderschaft repetieren',
    twoHand: true, capacity: 6, feed: 'tube', action: 'pump', autoCycle: false, holdOpen: false,
    modes: ['safe', 'semi'], startMode: 1, rpm: 150, spread: 0.04, pellets: 9,
    recoil: { back: 0.06, rise: 0.42, jitter: 0.03 }, travel: 0.08, sight: 'bead',
    range: [2, 5], scoreMult: 0.9, grip: [-0.062, -0.028], snd: { cut: 2200, thump: 90, vol: 1.0 }
  },
  sniper: {
    name: 'Scharfschützengewehr', desc: '5 Schuss · Repetierer · Rotpunkt-Visier',
    twoHand: true, capacity: 5, feed: 'mag', action: 'bolt', autoCycle: false, holdOpen: false,
    modes: ['safe', 'semi'], startMode: 1, rpm: 70, spread: 0.0004, pellets: 1,
    recoil: { back: 0.05, rise: 0.22, jitter: 0.01 }, travel: 0.085, sight: 'reddot',
    range: [7, 16], scoreMult: 1.5, grip: [-0.04, -0.045], snd: { cut: 3000, thump: 70, vol: 1.0 }
  }
};

// ---- Munition ----------------------------------------------------------
export function makeCartridge(rifle = false) {
  const g = new THREE.Group();
  const len = rifle ? 0.05 : 0.02, r = rifle ? 0.0045 : 0.0045;
  g.add(cylY(r, r, len, MAT.brass, 0, 0));
  const tip = new THREE.Mesh(cachedGeo('tip' + rifle, () => new THREE.ConeGeometry(r * 0.9, rifle ? 0.018 : 0.008, 10)), MAT.copper);
  tip.position.y = len / 2 + (rifle ? 0.009 : 0.004);
  g.add(tip);
  return g;
}
export function makeCasing(rifle = false) {
  return cylY(0.0045, 0.0045, rifle ? 0.05 : 0.02, MAT.brass, 0, 0, 0, 10);
}
export function makeShell(spent = false) {
  const g = new THREE.Group();
  g.add(cylY(0.0095, 0.0095, 0.052, MAT.shellRed, 0, 0.008));
  g.add(cylY(0.0101, 0.0101, 0.016, MAT.brass, 0, -0.026));
  if (spent) g.add(cylY(0.007, 0.007, 0.001, MAT.black, 0, 0.0345));
  return g;
}

// Vorlagen: Modelle, die oft neu erzeugt werden (Magazine, Granaten, Messer), nur einmal bauen und danach klonen.
// Klone teilen sich Geometrie und Material → keine neuen GPU-Puffer pro Exemplar (sonst wächst der Speicher mit jedem Nachladen/Wurf).
const _tpl = {};
export function fromTemplate(key, build) {
  if (!_tpl[key]) { _tpl[key] = build(); _tpl[key].traverse(o => { if (o.geometry) o.geometry.userData.shared = true; }); } // geteilt: nie freigeben
  return _tpl[key].clone();
}
export const makeKnife = () => fromTemplate('knife', buildKnife);
function buildKnife() { // Dolch
  const g = new THREE.Group();
  const leather = new THREE.MeshStandardMaterial({ color: 0x4a2c17, roughness: 0.85 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4ab45, metalness: 0.55, roughness: 0.35 });
  g.add(cylZ(0.011, 0.012, 0.085, leather, -0.015, 0, 0, 8));
  g.add(sphere(0.016, gold, -0.062, 0));
  g.add(box(0.012, 0.075, 0.014, gold, 0.034, 0));
  g.add(prof([[0.04, 0.014], [0.14, 0.009], [0.178, 0.0], [0.14, -0.009], [0.04, -0.014]], 0.005, MAT.bright, 0.001));
  mergeStatic(g, null); // Leistung: gleiche Materialien zu einem Mesh
  return g;
}
export const BUILDERS = {
  pistol(m, P, sock) {
    // Rahmen
    m.add(prof([[-0.03, 0.036], [0.15, 0.036], [0.15, 0.024], [0.08, 0.022], [0.065, 0.017], [0.0, 0.017], [-0.03, 0.026]], 0.024, MAT.polymer));
    m.add(box(0.02, 0.005, 0.06, MAT.polymer, 0.115, 0.02));
    // Abzugsbügel
    m.add(prof([[0.0, 0.02], [0.068, 0.02], [0.068, 0.008], [0.058, -0.012], [0.008, -0.012], [-0.002, 0.0]], 0.011, MAT.polymer, 0.001,
      [[[0.008, 0.016], [0.06, 0.016], [0.06, 0.008], [0.052, -0.006], [0.012, -0.006], [0.006, 0.002]]]));
    const trig = box(0.006, 0.019, 0.005, MAT.steel, 0.032, 0.008);
    trig.rotation.x = 0.25;
    m.add(trig);
    // Griff
    m.add(prof([[-0.038, 0.03], [0.004, 0.026], [-0.002, 0.0], [-0.013, -0.084], [-0.058, -0.08], [-0.052, -0.02], [-0.048, 0.022]], 0.029, MAT.grip, 0.003));
    // Schlitten (beweglich)
    const slide = new THREE.Group();
    m.add(slide);
    P.charger = slide;
    slide.add(prof([[-0.035, 0.036], [0.155, 0.036], [0.155, 0.06], [0.149, 0.068], [-0.03, 0.068], [-0.035, 0.062]], 0.025, MAT.steel));
    for (let i = 0; i < 6; i++) {
      slide.add(box(0.0262, 0.022, 0.0016, MAT.black, -0.03 + i * 0.0045, 0.052));
      slide.add(box(0.0262, 0.022, 0.0016, MAT.black, 0.118 + i * 0.0045, 0.052));
    }
    slide.add(box(0.004, 0.013, 0.032, MAT.black, 0.045, 0.058, 0.0112));
    slide.add(box(0.003, 0.011, 0.03, MAT.bright, 0.045, 0.058, 0.0098));
    slide.add(cylZ(0.0062, 0.0062, 0.004, MAT.bright, 0.156, 0.05));
    slide.add(cylZ(0.0042, 0.0042, 0.0045, MAT.black, 0.1565, 0.05));
    // Kimme mit 2 Leuchtpunkten, Korn mit grünem Punkt
    slide.add(box(0.017, 0.004, 0.008, MAT.black, -0.022, 0.07));
    slide.add(box(0.006, 0.007, 0.006, MAT.black, -0.022, 0.0745, 0.0055));
    slide.add(box(0.006, 0.007, 0.006, MAT.black, -0.022, 0.0745, -0.0055));
    slide.add(sphere(0.0012, MAT.dotWhite, -0.0255, 0.0745, 0.0055));
    slide.add(sphere(0.0012, MAT.dotWhite, -0.0255, 0.0745, -0.0055));
    slide.add(box(0.003, 0.009, 0.005, MAT.black, 0.142, 0.0715));
    slide.add(sphere(0.0014, MAT.dotGreen, 0.1395, 0.0735));
    sock('sightRear', -0.022, 0.0765);
    sock('sightFront', 0.142, 0.0765);
    sock('muzzle', 0.16, 0.05);
    sock('eject', 0.045, 0.064, 0.016);
    sock('chargerGrab', -0.02, 0.052);
    const seat = sock('magSeat', -0.026, 0.024);
    seat.rotation.x = -0.14;
    sock('magwell', -0.036, -0.083);
  },
  pistolMag() {
    const g = new THREE.Group();
    g.add(box(0.021, 0.104, 0.03, MAT.steel, 0, -0.052));
    g.add(box(0.025, 0.009, 0.037, MAT.polymer, -0.002, -0.108));
    const c = makeCartridge();
    c.rotation.x = -Math.PI / 2;
    c.position.set(0, 0.003, -0.002);
    g.add(c);
    return g;
  },

  smg(m, P, sock) {
    // Gehäuse
    m.add(prof([[-0.12, 0.025], [0.18, 0.025], [0.18, 0.066], [-0.1, 0.066], [-0.12, 0.056]], 0.04, MAT.steel, 0.002));
    m.add(prof([[-0.02, 0.026], [0.12, 0.026], [0.12, -0.002], [0.06, -0.002], [0.055, 0.012], [-0.02, 0.015]], 0.036, MAT.polymer, 0.002));
    // Picatinny-Schiene
    m.add(box(0.022, 0.006, 0.27, MAT.steel, 0.03, 0.069));
    for (let i = 0; i < 17; i++) m.add(box(0.0225, 0.003, 0.004, MAT.black, -0.1 + i * 0.016, 0.071));
    // Handschutz mit Lüftungsschlitzen
    m.add(prof([[0.18, 0.022], [0.31, 0.022], [0.31, 0.062], [0.18, 0.066]], 0.038, MAT.polymer, 0.003));
    for (let i = 0; i < 4; i++) {
      m.add(box(0.0385, 0.008, 0.018, MAT.black, 0.2 + i * 0.028, 0.044));
    }
    m.add(box(0.02, 0.006, 0.12, MAT.steel, 0.245, 0.066));
    // Lauf + Mündungsfeuerdämpfer
    m.add(cylZ(0.008, 0.008, 0.04, MAT.steel, 0.33, 0.045));
    m.add(cylZ(0.012, 0.012, 0.045, MAT.blued, 0.372, 0.045, 0, 6));
    for (let i = 0; i < 3; i++) m.add(box(0.026, 0.003, 0.01, MAT.black, 0.36 + i * 0.012, 0.045));
    m.add(cylZ(0.006, 0.006, 0.0465, MAT.black, 0.372, 0.045));
    // Griff, Abzug, Bügel
    m.add(prof([[-0.032, 0.026], [0.012, 0.026], [0.0, -0.075], [-0.046, -0.07], [-0.044, -0.01]], 0.03, MAT.grip, 0.003));
    m.add(box(0.012, 0.004, 0.062, MAT.polymer, 0.028, -0.008));
    const trig = box(0.006, 0.018, 0.005, MAT.steel, 0.03, 0.006);
    trig.rotation.x = 0.25;
    m.add(trig);
    // Klappschaft
    m.add(cylZ(0.005, 0.005, 0.2, MAT.steel, -0.22, 0.05, 0.014, 10));
    m.add(cylZ(0.005, 0.005, 0.2, MAT.steel, -0.22, 0.05, -0.014, 10));
    m.add(cylZ(0.005, 0.005, 0.2, MAT.steel, -0.22, 0.02, 0, 10));
    m.add(prof([[-0.335, 0.075], [-0.315, 0.075], [-0.315, -0.005], [-0.335, -0.005]], 0.045, MAT.polymer, 0.004));
    m.add(box(0.044, 0.08, 0.008, MAT.rubber, -0.338, 0.035));
    // Vordergriff
    m.add(cylY(0.015, 0.017, 0.08, MAT.grip, 0.25, -0.018));
    m.add(box(0.02, 0.008, 0.035, MAT.steel, 0.25, 0.021));
    // Spannhebel (beweglich)
    const ch = new THREE.Group();
    m.add(ch);
    P.charger = ch;
    ch.add(box(0.012, 0.008, 0.03, MAT.steel, -0.115, 0.061));
    ch.add(box(0.05, 0.01, 0.012, MAT.steel, -0.13, 0.061));
    // Feuerwahlhebel
    const sel = new THREE.Group();
    sel.position.set(-0.0215, 0.038, 0.005);
    sel.add(box(0.003, 0.004, 0.02, MAT.bright, -0.008, 0));
    sel.add(cylX(0.005, 0.004, MAT.steel, 0, 0, 0));
    m.add(sel);
    P.selector = sel;
    // Rotpunktvisier
    m.add(box(0.02, 0.014, 0.04, MAT.steel, 0.0, 0.079));
    m.add(cylZ(0.019, 0.019, 0.055, new THREE.MeshStandardMaterial({ color: 0x1d2330, metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide }), 0.0, 0.102, 0, 28, true));
    m.add(cylZ(0.0195, 0.0195, 0.006, MAT.black, -0.025, 0.102, 0, 28, true));
    m.add(cylZ(0.0195, 0.0195, 0.006, MAT.black, 0.025, 0.102, 0, 28, true));
    m.add(cylX(0.006, 0.01, MAT.black, 0.0, 0.102, 0.022));
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.0175, 28), MAT.glass);
    lens.position.set(0, 0.102, -0.026);
    m.add(lens);
    sock('sightRear', -0.03, 0.102);
    sock('sightFront', 0.03, 0.102);
    sock('dotLens', 0.026, 0.102);
    sock('muzzle', 0.395, 0.045);
    sock('eject', 0.03, 0.055, 0.024);
    sock('chargerGrab', -0.13, 0.061);
    sock('foregrip', 0.25, -0.02);
    const seat = sock('magSeat', 0.09, 0.024);
    seat.rotation.x = 0.12;
    sock('magwell', 0.092, -0.01);
  },
  smgMag() {
    const g = new THREE.Group();
    g.add(box(0.022, 0.17, 0.036, MAT.steel, 0, -0.085));
    for (let i = 0; i < 5; i++) g.add(box(0.0225, 0.002, 0.03, MAT.black, 0, -0.03 - i * 0.025));
    g.add(box(0.026, 0.01, 0.042, MAT.polymer, 0, -0.174));
    const c = makeCartridge();
    c.rotation.x = -Math.PI / 2;
    c.position.set(0, 0.003, 0);
    g.add(c);
    return g;
  },

  shotgun(m, P, sock) {
    // Gehäuse
    m.add(prof([[-0.075, 0.012], [0.13, 0.012], [0.13, 0.068], [-0.055, 0.072], [-0.075, 0.064]], 0.038, MAT.blued, 0.002));
    m.add(box(0.003, 0.022, 0.06, MAT.black, 0.05, 0.048, 0.0185));
    m.add(box(0.026, 0.003, 0.055, MAT.black, 0.06, 0.011));
    // Pistolengriff + Schaft aus Holz
    m.add(prof([[-0.075, 0.022], [-0.032, 0.022], [-0.045, -0.078], [-0.092, -0.072], [-0.088, -0.01]], 0.031, MAT.wood, 0.004));
    m.add(prof([[-0.075, 0.064], [-0.075, 0.02], [-0.1, 0.0], [-0.36, -0.03], [-0.37, -0.03], [-0.37, 0.058], [-0.12, 0.066]], 0.036, MAT.wood, 0.004));
    m.add(box(0.037, 0.09, 0.018, MAT.rubber, -0.378, 0.014));
    // Abzug & Bügel
    m.add(box(0.012, 0.004, 0.065, MAT.steel, 0.0, -0.012));
    m.add(box(0.012, 0.024, 0.004, MAT.steel, 0.032, 0.0));
    const trig = box(0.006, 0.018, 0.005, MAT.bright, 0.0, 0.002);
    trig.rotation.x = 0.25;
    m.add(trig);
    // Lauf, Laufschiene, Magazinrohr
    m.add(cylZ(0.0115, 0.0115, 0.5, MAT.blued, 0.38, 0.05, 0, 24));
    m.add(cylZ(0.008, 0.008, 0.0505, MAT.black, 0.38, 0.05));
    m.add(box(0.008, 0.004, 0.48, MAT.steel, 0.38, 0.0635));
    m.add(cylZ(0.012, 0.012, 0.43, MAT.blued, 0.345, 0.022, 0, 20));
    m.add(cylZ(0.0135, 0.0135, 0.02, MAT.bright, 0.565, 0.022));
    m.add(box(0.02, 0.05, 0.012, MAT.steel, 0.54, 0.036));
    // Kimme hinten + Perlkorn
    m.add(box(0.005, 0.008, 0.006, MAT.black, -0.045, 0.074, 0.0045));
    m.add(box(0.005, 0.008, 0.006, MAT.black, -0.045, 0.074, -0.0045));
    m.add(box(0.003, 0.008, 0.004, MAT.steel, 0.615, 0.068));
    m.add(sphere(0.003, MAT.dotOrange, 0.615, 0.075));
    sock('sightRear', -0.045, 0.077);
    sock('sightFront', 0.615, 0.077);
    // Vorderschaft = Pumpe (beweglich)
    const pump = new THREE.Group();
    m.add(pump);
    P.charger = pump;
    pump.add(prof([[0.25, 0.0], [0.4, 0.0], [0.4, 0.043], [0.25, 0.043]], 0.046, MAT.wood, 0.007));
    for (let i = 0; i < 7; i++) {
      pump.add(box(0.0475, 0.03, 0.005, MAT.black, 0.268 + i * 0.019, 0.022));
    }
    pump.add(cylZ(0.0025, 0.0025, 0.13, MAT.bright, 0.19, 0.02, 0.016, 8));
    pump.add(cylZ(0.0025, 0.0025, 0.13, MAT.bright, 0.19, 0.02, -0.016, 8));
    sock('muzzle', 0.635, 0.05);
    sock('eject', 0.05, 0.05, 0.022);
    sock('chargerGrab', 0.325, 0.02);
    sock('foregrip', 0.325, 0.02);
    sock('loadPort', 0.06, 0.0);
  },

  sniper(m, P, sock) {
    // Schaft mit Pistolengriff
    m.add(prof([[0.42, 0.034], [0.42, 0.012], [0.06, 0.004], [0.0, -0.012], [-0.018, -0.075], [-0.062, -0.078], [-0.072, -0.022],
      [-0.13, -0.022], [-0.43, -0.055], [-0.44, -0.055], [-0.44, 0.05], [-0.16, 0.052], [-0.08, 0.04], [0.06, 0.034]], 0.042, MAT.tan, 0.005));
    m.add(prof([[-0.002, -0.014], [-0.019, -0.074], [-0.061, -0.077], [-0.07, -0.024], [-0.02, -0.012]], 0.0445, MAT.tanGrip, 0.004));
    m.add(box(0.043, 0.115, 0.02, MAT.rubber, -0.45, -0.003));
    m.add(box(0.03, 0.018, 0.16, MAT.tan, -0.25, 0.06));
    // Gehäuse und Lauf
    m.add(cylZ(0.017, 0.017, 0.24, MAT.steel, 0.03, 0.052, 0, 24));
    m.add(cylZ(0.009, 0.013, 0.62, MAT.steel, 0.46, 0.052, 0, 24));
    m.add(box(0.026, 0.022, 0.05, MAT.blued, 0.795, 0.052));
    for (let i = 0; i < 3; i++) m.add(box(0.0265, 0.012, 0.007, MAT.black, 0.78 + i * 0.014, 0.052));
    m.add(cylZ(0.006, 0.006, 0.051, MAT.black, 0.795, 0.052));
    // Abzug
    m.add(box(0.012, 0.004, 0.06, MAT.steel, 0.02, -0.04));
    m.add(box(0.012, 0.03, 0.004, MAT.steel, 0.05, -0.025));
    const trig = box(0.006, 0.018, 0.005, MAT.bright, 0.018, -0.022);
    trig.rotation.x = 0.25;
    m.add(trig);
    // Zweibein (eingeklappt)
    m.add(box(0.02, 0.012, 0.03, MAT.steel, 0.36, 0.002));
    m.add(cylZ(0.0035, 0.0035, 0.16, MAT.steel, 0.27, -0.002, 0.008, 8));
    m.add(cylZ(0.0035, 0.0035, 0.16, MAT.steel, 0.27, -0.002, -0.008, 8));
    // Kammerverschluss (beweglich)
    const bolt = new THREE.Group();
    m.add(bolt);
    P.charger = bolt;
    bolt.add(cylZ(0.0125, 0.0125, 0.03, MAT.steel, -0.105, 0.052, 0, 20));
    bolt.add(cylZ(0.0105, 0.0105, 0.12, MAT.bright, -0.04, 0.052, 0, 16));
    const lever = box(0.045, 0.006, 0.008, MAT.bright, -0.06, 0.043, 0.036);
    lever.rotation.z = -0.45;
    bolt.add(lever);
    bolt.add(sphere(0.0095, MAT.black, -0.06, 0.032, 0.058));
    // Rotpunkt-Visier statt Zielfernrohr (in VR viel besser zu benutzen)
    redDotKit(m, sock, 0.03, 0.083);
    sock('muzzle', 0.82, 0.052);
    sock('eject', 0.0, 0.065, 0.022);
    sock('chargerGrab', -0.06, 0.032, 0.058);
    sock('foregrip', 0.3, 0.012);
    sock('magSeat', 0.09, 0.034);
    sock('magwell', 0.09, -0.01);
  },
  sniperMag() {
    const g = new THREE.Group();
    g.add(box(0.026, 0.074, 0.065, MAT.polymer, 0, -0.037));
    g.add(box(0.028, 0.006, 0.068, MAT.steel, 0, -0.075));
    const c = makeCartridge(true);
    c.rotation.x = -Math.PI / 2;
    c.position.set(0, 0.004, 0);
    g.add(c);
    return g;
  }
};

// ---- Zielfernrohr: Render-Target + Fadenkreuz ---------------------------
// Rotpunkt-Visier: Montage, Röhre, Glas; Sockel für Zielen (sightRear/Front) und Leuchtpunkt (dotLens)
const redDotBody = new THREE.MeshStandardMaterial({ color: 0x1d2330, metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide });
export function redDotKit(m, sock, s0, baseY) {
  const y = baseY + 0.023;
  m.add(box(0.02, 0.014, 0.04, MAT.steel, s0, baseY));
  m.add(cylZ(0.019, 0.019, 0.055, redDotBody, s0, y, 0, 28, true));
  m.add(cylZ(0.0195, 0.0195, 0.006, MAT.black, s0 - 0.025, y, 0, 28, true));
  m.add(cylZ(0.0195, 0.0195, 0.006, MAT.black, s0 + 0.025, y, 0, 28, true));
  const lens = new THREE.Mesh(cachedGeo('dotlens', () => new THREE.CircleGeometry(0.0175, 28)), MAT.glass);
  lens.position.set(0, y, -(s0 + 0.026));
  m.add(lens);
  sock('sightRear', s0 - 0.03, y);
  sock('sightFront', s0 + 0.03, y);
  sock('dotLens', s0 + 0.026, y);
}
export const scopeRT = new THREE.WebGLRenderTarget(512, 512, { samples: 2 });
// Zielfernrohr-Baustein: Rohr mittig bei s0 (Design-Koordinaten), Höhe y; setzt die nötigen Anker
export function scopeKit(m, P, sock, s0, y) {
  const d = s0 - 0.03;
  m.add(cylZ(0.0155, 0.0155, 0.26, MAT.black, s0, y, 0, 24));
  m.add(cylZ(0.024, 0.0155, 0.06, MAT.black, 0.19 + d, y, 0, 28));
  m.add(cylZ(0.025, 0.025, 0.02, MAT.black, 0.23 + d, y, 0, 28));
  m.add(cylZ(0.0155, 0.0195, 0.03, MAT.black, -0.115 + d, y, 0, 24));
  m.add(cylZ(0.0195, 0.0195, 0.035, MAT.black, -0.1475 + d, y, 0, 24));
  m.add(cylY(0.011, 0.011, 0.024, MAT.steel, s0, y + 0.025));
  m.add(cylX(0.011, 0.024, MAT.steel, s0, y, 0.024));
  const objective = new THREE.Mesh(cachedGeo('objlens', () => new THREE.CircleGeometry(0.022, 28)), MAT.glass);
  objective.position.set(0, y, -(0.2405 + d));
  objective.rotation.y = Math.PI;
  m.add(objective);
  // Okular: mehrere Schichten (Kamerabild / Durchblick, vergrößerte Ziele, Abdunklung, Fadenkreuz)
  const circ = () => cachedGeo('eyelens', () => new THREE.CircleGeometry(0.0175, 32));
  const lensMat = (o) => new THREE.MeshBasicMaterial(Object.assign({ toneMapped: false, depthWrite: false, transparent: true }, o));
  const z = 0.1656 - d;
  const layer = (mat, order, dz) => { const l = new THREE.Mesh(circ(), mat); l.position.set(0, y, z + dz); l.renderOrder = order; m.add(l); return l; };
  P.lensHole = layer(lensMat({ color: 0x000000, opacity: 0, blending: THREE.NoBlending }), 10, 0);
  P.lensVideo = layer(lensMat({ color: 0xffffff, transparent: false }), 10, 0);
  P.lensVideo.visible = false;
  P.lensHole.visible = false;
  P.lensRT = layer(lensMat({ map: scopeRT.texture }), 11, 0.00005);
  P.lensShade = layer(lensMat({ color: 0x000000, opacity: 0 }), 12, 0.0001);
  layer(lensMat({ map: reticleTexture }), 13, 0.0002);
  sock('sightRear', -0.166 + d, y);
  sock('sightFront', 0.24 + d, y);
  sock('scopeEye', -0.1656 + d, y);
  sock('scopeCam', 0.25 + d, y);
}
scopeRT.texture.colorSpace = THREE.SRGBColorSpace;
export const scopeCam = new THREE.PerspectiveCamera(4, 1, 0.1, 200);
export const reticleTexture = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(256, 256, 200, 256, 256, 256);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.95)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 6;
  for (const [x0, y0, x1, y1] of [[0, 256, 200, 256], [312, 256, 512, 256], [256, 0, 256, 200], [256, 312, 256, 512]]) {
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(200, 256); ctx.lineTo(312, 256); ctx.moveTo(256, 200); ctx.lineTo(256, 312); ctx.stroke();
  ctx.fillStyle = '#000';
  for (let i = 1; i <= 4; i++) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.beginPath(); ctx.arc(256 + dx * i * 22, 256 + dy * i * 22, 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.fillStyle = '#ff2a2a';
  ctx.beginPath(); ctx.arc(256, 256, 2.5, 0, Math.PI * 2); ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

const MUZZLE_FLASH = new THREE.MeshBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
const PLASMA_FLASH = new THREE.MeshBasicMaterial({ color: 0x66ff88, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
// sternförmiges Mündungsfeuer (Sprite)
const FLASH_SPRITE = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.translate(64, 64);
  for (let i = 0; i < 7; i++) {
    ctx.rotate(Math.PI * 2 / 7 + Math.random() * 0.3);
    const g = ctx.createLinearGradient(0, 0, 0, -60);
    g.addColorStop(0, 'rgba(255,240,200,1)'); g.addColorStop(1, 'rgba(255,140,30,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(0, -40 - Math.random() * 22); ctx.lineTo(6, 0); ctx.fill();
  }
  const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, 26);
  rg.addColorStop(0, 'rgba(255,255,230,1)'); rg.addColorStop(1, 'rgba(255,160,40,0)');
  ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fill();
  const t = new THREE.CanvasTexture(c);
  return new THREE.SpriteMaterial({ map: t, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
})();
// Visier-Teile automatisch erkennen: kleine Teile direkt auf der Ziellinie (Kimme → Korn bzw. Rotpunkt-Rohr).
// Sie werden nicht mit anderen Teilen zusammengefasst und bekommen beim Aufrüsten kein Tarnmuster –
// sonst war das Visier danach nicht mehr zu erkennen bzw. das Rotpunkt-Rohr von hinten unsichtbar.
const _sb = new THREE.Box3(), _sc = new THREE.Vector3(), _ss = new THREE.Vector3();
function markSightParts(model, sockets) {
  const sr = sockets.sightRear && sockets.sightRear.position, sf = sockets.sightFront && sockets.sightFront.position;
  if (!sr || !sf || Math.abs(sf.z - sr.z) < 1e-4) return;
  model.updateMatrixWorld(true);
  const zmin = Math.min(sr.z, sf.z) - 0.03, zmax = Math.max(sr.z, sf.z) + 0.03;
  model.traverse(o => {
    if (!o.isMesh || (o.material && o.material.transparent)) return;
    _sb.setFromObject(o);
    _sb.getSize(_ss);
    if (Math.max(_ss.x, _ss.y, _ss.z) > 0.075) return;
    _sb.getCenter(_sc);
    if (_sc.z < zmin || _sc.z > zmax || Math.abs(_sc.x) > 0.025) return;
    const y = sr.y + (sf.y - sr.y) * ((_sc.z - sr.z) / (sf.z - sr.z));
    if (Math.abs(_sc.y - y) < 0.026) o.userData.sight = true;
  });
}
// Farbton für Waffen-Varianten (z. B. blaue Schock-Flinte): getönte Material-Kopien, zwischengespeichert
const _tinted = new Map();
function tintModel(model, tint) {
  const col = new THREE.Color(tint);
  model.traverse(o => {
    if (!o.isMesh || o.userData.sight || !o.material || !o.material.isMeshStandardMaterial || o.material.transparent) return;
    const key = o.material.uuid + ':' + tint;
    let m = _tinted.get(key);
    if (!m) { m = o.material.clone(); m.color.lerp(col, 0.5); _tinted.set(key, m); }
    o.material = m;
  });
}
export function buildWeapon(id) {
  const def = WEAPON_DEFS[id];
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const model = new THREE.Group();
  body.add(model);
  const parts = {}, sockets = {};
  const sock = (name, s, y, x = 0) => {
    const o = new THREE.Object3D();
    o.position.set(x, y, -s);
    model.add(o);
    sockets[name] = o;
    return o;
  };
  BUILDERS[def.builder || id](model, parts, sock, def);
  markSightParts(model, sockets);
  if (def.tint) tintModel(model, def.tint);
  mergeStatic(model, parts);
  const sc = def.scale || 1;
  model.scale.setScalar(sc);
  model.position.set(0, -def.grip[1] * sc, def.grip[0] * sc);
  if (def.tilt) model.rotation.x = def.tilt; // Klinge leicht nach oben (natürliche Schwerthaltung)
  // Magazin einsetzen
  if (def.feed === 'mag') {
    parts.mag = makeMag(id);
    sockets.magSeat.add(parts.mag);
  }
  // Mündungsfeuer
  const flash = new THREE.Group();
  const flashMat = def.projectile ? PLASMA_FLASH : MUZZLE_FLASH;
  const f1 = new THREE.Mesh(cachedGeo('flashcone', () => new THREE.ConeGeometry(0.025, 0.09, 8, 1, true)), flashMat);
  f1.rotation.x = -Math.PI / 2;
  f1.position.z = -0.045;
  flash.add(f1);
  const star = new THREE.Sprite(FLASH_SPRITE);
  star.scale.setScalar(0.12);
  flash.add(star);
  flash.visible = false;
  sockets.muzzle.add(flash);
  parts.flash = flash;
  // Ruhe-Positionen der Anker relativ zur Wurzel (für Zweihand-Griff und Desktop-Zielen)
  root.updateMatrixWorld(true);
  const rest = (name) => sockets[name] ? root.worldToLocal(sockets[name].getWorldPosition(new THREE.Vector3())) : null;
  let foreQ = null;
  if (sockets.foregrip) foreQ = new THREE.Quaternion().setFromUnitVectors(rest('foregrip').normalize(), new THREE.Vector3(0, 0, -1));
  // Kollisionsform für die Physik: Bounding-Box im Koordinatensystem der Wurzel
  root.updateMatrixWorld(true);
  const localBox = new THREE.Box3().setFromObject(root);
  return { root, body, model, parts, sockets, def, foreQ, restSightRear: rest('sightRear'), localBox };
}

// Handgranate (Ursprung = Mitte des Körpers)
const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.5, metalness: 0.6 });
export function makeGrenade() {
  const g = fromTemplate('grenade', buildGrenade);
  g.userData.ring = g.getObjectByName('ring');
  return g;
}
function buildGrenade() { // Brandbombe: Eisenkugel mit Lunte
  const g = new THREE.Group();
  const body = new THREE.Mesh(cachedGeo('gren', () => new THREE.SphereGeometry(0.036, 14, 10)), grenadeMat);
  g.add(body);
  g.add(cylY(0.011, 0.013, 0.016, MAT.steel, 0, 0.038));
  const ring = new THREE.Mesh(cachedGeo('grenfuse', () => new THREE.CylinderGeometry(0.0025, 0.0025, 0.035, 5)), fuseMat);
  ring.position.set(0.004, 0.06, 0);
  ring.rotation.z = -0.3;
  g.add(ring);
  ring.name = 'ring';
  mergeStatic(g, { ring });
  return g;
}
const fuseMat = new THREE.MeshStandardMaterial({ color: 0xc8b48a, roughness: 0.9 });
export const makeMag = (id) => fromTemplate('mag:' + id, () => { const g = BUILDERS[(WEAPON_DEFS[id].magBuilder || id) + 'Mag'](WEAPON_DEFS[id]); mergeStatic(g, null); return g; });
export const MASS = new Proxy({ pistol: 0.9, smg: 2.6, shotgun: 3.3, sniper: 5.5 }, { get: (t, k) => t[k] ?? (WEAPON_DEFS[k] && WEAPON_DEFS[k].mass) ?? 3 });

// Vollständige Waffe inkl. Munitionszustand
export function createWeapon(id) {
  const w = buildWeapon(id);
  Object.assign(w, {
    id, holder: -1, phys: null,
    chamber: 'live', magInserted: w.def.feed === 'mag', magRounds: w.def.capacity, tube: w.def.feed === 'tube' ? w.def.capacity : 0,
    actionOpen: false, modeIdx: w.def.startMode, cooldown: 0, recoil: 0, recoilSide: 0, cycleAnim: 0, travel: 0, handTravel: false,
    twoHanding: false, zoom: 6, desktopBusy: false, aim: 0, aligned: false
  });
  return w;
}
export function refillWeapon(w) {
  w.chamber = 'live';
  w.actionOpen = false;
  if (w.def.feed === 'mag') { w.magInserted = true; w.magRounds = w.def.capacity; w.parts.mag.visible = true; }
  else w.tube = w.def.capacity;
}

