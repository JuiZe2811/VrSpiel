// Gesichter von Freunden für die Zombies: Fotos laden, aufs Gesicht zuschneiden, lokal speichern.
// Die Bilder bleiben nur im Browser dieses Geräts (localStorage) – sie werden nirgends hochgeladen.
import { setFriendFaces } from './zombies.js?v=41';

const KEY = 'vrspiel-gesichter';
// fest eingebaute Gesichter (Freunde, mit Erlaubnis) – werden benutzt, solange keine eigenen Fotos geladen sind
const BUILTIN = ['faces/freund1.jpg', 'faces/freund2.jpg', 'faces/freund3.jpg'];
const MAX = 6;
const SHARES = [[0, 'Aus'], [0.35, 'Manche'], [0.6, 'Viele'], [1, 'Alle']];
let data = load();

function load() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && Array.isArray(v.faces)) return v; } catch { /* leer */ }
  return { faces: [], share: 0.6, builtin: true };
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { alert('Speicher voll – bitte ein Gesicht entfernen.'); }
  apply();
}
function apply() {
  const list = data.faces.length ? data.faces : data.builtin !== false ? BUILTIN : [];
  setFriendFaces(list, list.length ? data.share : 0);
}
apply();

// ---- Oberfläche ----------------------------------------------------------------------
const css = `
#facesBtn { position:absolute; bottom:20px; left:16px; padding:10px 14px; border-radius:8px; border:1px solid #fff; background:rgba(0,0,0,.6); color:#fff; font:13px system-ui,sans-serif; cursor:pointer; }
#facesDlg { position:absolute; inset:0; background:rgba(0,0,0,.85); color:#fff; font:15px system-ui,sans-serif; display:none; overflow:auto; z-index:20; }
#facesDlg .box { max-width:520px; margin:24px auto; background:#1b1f27; border-radius:14px; padding:18px; border:1px solid #3a4456; }
#facesDlg h2 { margin:0 0 6px; font-size:20px; }
#facesDlg p { color:#b8c2d0; margin:6px 0 12px; font-size:13px; line-height:1.4; }
#facesDlg .list { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:12px; }
#facesDlg .face { position:relative; width:72px; height:90px; border-radius:10px; overflow:hidden; border:2px solid #3a4456; }
#facesDlg .face img { width:100%; height:100%; object-fit:cover; }
#facesDlg .face button { position:absolute; top:2px; right:2px; width:24px; height:24px; border-radius:12px; border:none; background:#c22; color:#fff; cursor:pointer; }
#facesDlg button.big, #facesDlg label.big { display:inline-block; padding:10px 14px; border-radius:8px; border:1px solid #8796ad; background:#2c3444; color:#fff; cursor:pointer; margin:4px 4px 4px 0; font-size:14px; }
#facesDlg .crop { display:none; text-align:center; }
#facesDlg canvas { max-width:100%; touch-action:none; border-radius:8px; background:#000; cursor:move; }
#facesDlg input[type=range] { width:100%; }
#facesDlg select { font-size:14px; padding:6px; border-radius:6px; }`;
const style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);

const btn = document.createElement('button');
btn.id = 'facesBtn';
document.body.appendChild(btn);
const dlg = document.createElement('div');
dlg.id = 'facesDlg';
dlg.innerHTML = `<div class="box">
  <h2>🧟 Gesichter für die Zombies</h2>
  <p>Lade Fotos von Freunden – die Zombies tragen dann ihre Gesichter (fahl, mit Schmutz und Blut).
     Die Bilder bleiben nur hier auf diesem Gerät gespeichert und werden nirgendwo hochgeladen.</p>
  <div class="list" id="facesList"></div>
  <label class="big">📷 Foto hinzufügen<input id="facesFile" type="file" accept="image/*" style="display:none"></label>
  <label style="display:block;margin:10px 0"><input type="checkbox" id="facesBuiltin"> Eingebaute Gesichter benutzen, solange keine eigenen Fotos geladen sind</label>
  <div style="margin:10px 0">Anteil der Zombies mit Freundes-Gesicht:
    <select id="facesShare">${SHARES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
  <div class="crop" id="facesCrop">
    <p>Gesicht in den Rahmen schieben (ziehen) und mit dem Regler die Größe anpassen – Augen etwa auf der Linie.</p>
    <canvas id="facesCanvas" width="360" height="360"></canvas>
    <input id="facesZoom" type="range" min="0.15" max="1" step="0.01" value="0.5">
    <div><button class="big" id="facesOk">✔ Übernehmen</button><button class="big" id="facesCancel">Abbrechen</button></div>
  </div>
  <div style="margin-top:12px"><button class="big" id="facesClose">Fertig</button></div>
</div>`;
document.body.appendChild(dlg);
const $ = (id) => dlg.querySelector('#' + id);

function refresh() {
  btn.textContent = `🧟 Gesichter (${data.faces.length || (data.builtin !== false ? BUILTIN.length + ' eingebaut' : 0)})`;
  $('facesBuiltin').checked = data.builtin !== false;
  $('facesShare').value = String(data.share);
  $('facesList').innerHTML = data.faces.map((f, i) => `<div class="face"><img src="${f}"><button data-i="${i}">✕</button></div>`).join('') || '<span style="color:#8796ad">Noch keine Gesichter</span>';
  $('facesList').querySelectorAll('button').forEach(b => b.onclick = () => { data.faces.splice(+b.dataset.i, 1); save(); refresh(); });
}
btn.onclick = () => { dlg.style.display = 'block'; refresh(); };
$('facesClose').onclick = () => { dlg.style.display = 'none'; };
$('facesShare').onchange = (e) => { data.share = parseFloat(e.target.value); save(); };
$('facesBuiltin').onchange = (e) => { data.builtin = e.target.checked; save(); refresh(); };

// ---- Zuschneiden ---------------------------------------------------------------------
const cv = $('facesCanvas'), ctx = cv.getContext('2d');
let img = null, cx = 0.5, cy = 0.4, zoom = 0.5; // Mittelpunkt (relativ) und Rahmengröße (Anteil der Bildbreite)
const ASPECT = 1.2; // Rahmen ist etwas höher als breit
function frame() {
  const fit = Math.min(cv.width / img.width, cv.height / img.height);
  const dw = img.width * fit, dh = img.height * fit, ox = (cv.width - dw) / 2, oy = (cv.height - dh) / 2;
  const fw = zoom * img.width * fit, fh = fw * ASPECT;
  return { fit, ox, oy, fw, fh, fx: ox + cx * dw - fw / 2, fy: oy + cy * dh - fh / 2 };
}
function draw() {
  if (!img) return;
  const f = frame();
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(img, f.ox, f.oy, img.width * f.fit, img.height * f.fit);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath(); ctx.rect(0, 0, cv.width, cv.height); ctx.ellipse(f.fx + f.fw / 2, f.fy + f.fh / 2, f.fw / 2, f.fh / 2, 0, 0, Math.PI * 2); ctx.fill('evenodd');
  ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(f.fx + f.fw / 2, f.fy + f.fh / 2, f.fw / 2, f.fh / 2, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(f.fx, f.fy + f.fh * 0.42); ctx.lineTo(f.fx + f.fw, f.fy + f.fh * 0.42); ctx.stroke(); ctx.setLineDash([]);
}
$('facesFile').onchange = (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (data.faces.length >= MAX) { alert(`Höchstens ${MAX} Gesichter`); return; }
  const r = new FileReader();
  r.onload = () => { const im = new Image(); im.onload = () => { img = im; cx = 0.5; cy = 0.4; zoom = 0.5; $('facesZoom').value = zoom; $('facesCrop').style.display = 'block'; draw(); }; im.src = r.result; };
  r.readAsDataURL(file);
};
$('facesZoom').oninput = (e) => { zoom = parseFloat(e.target.value); draw(); };
let dragging = null;
cv.addEventListener('pointerdown', (e) => { dragging = { x: e.clientX, y: e.clientY, cx, cy }; cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', (e) => {
  if (!dragging || !img) return;
  const f = frame(), scale = cv.width / cv.getBoundingClientRect().width;
  cx = Math.min(1, Math.max(0, dragging.cx + (e.clientX - dragging.x) * scale / (img.width * f.fit)));
  cy = Math.min(1, Math.max(0, dragging.cy + (e.clientY - dragging.y) * scale / (img.height * f.fit)));
  draw();
});
cv.addEventListener('pointerup', () => { dragging = null; });
$('facesCancel').onclick = () => { img = null; $('facesCrop').style.display = 'none'; };
$('facesOk').onclick = () => {
  if (!img) return;
  // Ausschnitt in voller Auflösung, 300×360 Pixel als JPEG (klein genug für den Speicher)
  const out = document.createElement('canvas');
  out.width = 300; out.height = 360;
  const sw = zoom * img.width, sh = sw * ASPECT;
  out.getContext('2d').drawImage(img, cx * img.width - sw / 2, cy * img.height - sh / 2, sw, sh, 0, 0, out.width, out.height);
  data.faces.push(out.toDataURL('image/jpeg', 0.85));
  img = null;
  $('facesCrop').style.display = 'none';
  save();
  refresh();
};
refresh();
// beim Start der VR-Sitzung ausblenden (in VR sieht man die Seite ohnehin nicht)
export function facesButtonVisible(v) { btn.style.display = v ? 'block' : 'none'; if (!v) dlg.style.display = 'none'; }
export const faceData = () => data;
export function setFaces(faces, share = 0.6) { data = { faces: faces.slice(0, MAX), share }; save(); refresh(); }
