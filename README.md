# 🎯 Passthrough-Schießstand (Quest 3, WebXR)

Ein Mixed-Reality-Schießspiel für die Meta Quest 3, das direkt im Browser läuft.
Du richtest zuerst deinen echten Raum ein (Wände, Tische, Stühle). Danach erscheinen die Ziele
genau dort: an deinen Wänden, auf dem Tisch und auf Stühlen.

## Spielen

1. Die Seite muss über **HTTPS** erreichbar sein (z. B. GitHub Pages: *Settings → Pages → Branch wählen → Save*).
2. Die URL im **Browser der Quest 3** öffnen und **„START AR“** tippen.
3. **Spielbereich einrichten** (siehe unten), dann **✔ Fertig**.
4. Eine Waffe vom **Waffentisch** nehmen, Spielmodus wählen und auf die grüne **START**-Scheibe schießen
   (oder den Knopf ▶ START drücken).

## Spielbereich einrichten

Das Einrichtungs-Menü bedienst du mit dem Zeigestrahl + Abzug.

| Werkzeug | So geht's |
|---|---|
| 📡 Quest-Raum übernehmen | Übernimmt Wände, Tische und Sofas aus deiner Quest-Raumeinrichtung (falls vorhanden, passiert beim Start automatisch) |
| 🧱 Wand ziehen | Gelbe Controller-Spitze an die echte Wand halten, **Abzug gedrückt halten**, an der Wand entlangziehen, loslassen |
| 🪑 Tisch / 💺 Stuhl | Spitze auf eine Ecke der Platte bzw. Sitzfläche, Abzug halten, zur **gegenüberliegenden Ecke** ziehen, loslassen. Stick ◀ ▶ dreht ihn passend |
| ↶ Rückgängig / 🗑 Alles löschen | Letzte Fläche bzw. alle entfernen |
| 💾 Gespeicherten Raum laden | Lädt den zuletzt eingerichteten Raum (passt nur, wenn du am selben Platz und in dieselbe Richtung startest) |

Echte Wände und Möbel verdecken virtuelle Dinge dahinter, und Waffen, Magazine und Dosen prallen physikalisch daran ab.
Schüsse hinterlassen Einschusslöcher an den Wänden, Messer bleiben darin stecken.

## Waffen

Alle vier Waffen liegen auf dem **Waffentisch** – jede genau einmal.

| Waffe | Visier | Magazin | Besonderheit |
|---|---|---|---|
| Pistole P9 | Kimme & Korn | 15 | einhändig, Schlittenfang |
| Maschinenpistole MPX | Rotpunktvisier | 30 | Sicher / Einzel / Dauerfeuer, Vordergriff |
| Pump-Flinte | Perlkorn | 6 + 1 (Röhre) | Schrot, nach jedem Schuss repetieren |
| Scharfschützengewehr | Zielfernrohr 4–12x | 5 | Kammerverschluss, Punkte x1,5 |

## Steuerung (Quest-Controller)

| Aktion | So geht's |
|---|---|
| Waffe nehmen | Hingreifen + **Griff-Taste halten** (aus der Ferne: darauf zeigen + Griff-Taste → fliegt in die Hand) |
| Ablegen / Werfen | **Griff-Taste loslassen** – die Waffe fällt mit Physik, beim Loslassen in der Bewegung wird sie geworfen |
| Hand wechseln | Mit der anderen Hand an den Griff fassen; zwei Waffen gleichzeitig (eine pro Hand) gehen auch |
| Schießen | Abzug |
| Zweihändig halten | Zweite Hand an den Vorderschaft + Griff-Taste |
| Magazin auswerfen | **A / X** |
| Neues Magazin / Patrone | Nach unten schauen: am **Gürtel** greifen. Ausgeworfene Magazine kann man vom Boden aufheben (mit Restpatronen) |
| Magazin einsetzen | Von unten in den Magazinschacht führen |
| Schrotpatrone laden | An die Ladeöffnung unten am Gehäuse führen |
| Durchladen | Schlitten / Spannhebel / Kammerstängel mit der zweiten Hand greifen und zurückziehen |
| Repetieren (Flinte) | Vorderschaft zurück- und wieder vorschieben |
| Feuermodus / Sicherung | **B / Y** (Pistole: Schlittenfang lösen) |
| Zoom (Zielfernrohr) | Stick hoch / runter |
| Wurfmesser | Am Gürtel greifen, ausholen, Griff-Taste beim Werfen loslassen. Messer lassen sich wieder aufheben |
| Menüs | Zeigen + Abzug |

Am Handgelenk der freien Hand zeigt eine kleine Anzeige Munition, Feuermodus und den nächsten Schritt –
nur wenn du hinschaust, nie beim Zielen.

## Spielmodi und Ziele

- **⏱ Zeitjagd** – 60 Sekunden, so viele Punkte wie möglich
- **🌊 Wellen** – jede Welle abräumen, bevor die Zeit abläuft; jede Welle hat mehr Ziele
- **🎯 Training** – ohne Zeitlimit, Beenden über die Tafel

| Ziel | Wo | Punkte |
|---|---|---|
| Ringscheibe (teils beweglich oder als Wendescheibe) | Wand, Ständer auf Tisch/Stuhl | 10 · 8 · 6 · 4 · 2 (+2 wenn beweglich) |
| Stahlplatte | Tisch / Stuhl | 8, kippt mit Physik um |
| Dosen | Tisch / Stuhl | 6, fliegen weg |
| ★ Goldscheibe | Wand | 25 und +3 Sekunden, verschwindet schnell |
| ✋ Nicht schießen | Wand / Ständer | −25 und Combo weg |

Treffer hintereinander erhöhen die **Combo** (bis x5), Messertreffer zählen doppelt.

## Am PC testen

`python3 -m http.server` im Ordner starten und `http://localhost:8000` öffnen (mit einem Beispielraum).
1–4 Waffe · Linksklick schießen / Knöpfe · rechte Maustaste ziehen = umschauen · Leertaste = Visier ·
R nachladen · V Feuermodus · F Messer werfen · Enter Start · Mausrad Zoom.

## Technik

- `index.html` + Module in `js/`: `main.js` (Spielablauf, Hände, Waffen-Mechanik), `weapons.js` (Modelle),
  `room.js` (Raum), `targets.js` (Ziele), `physics.js` (cannon-es), `effects.js`, `sfx.js`, `util.js`
- [three.js](https://threejs.org/) und [cannon-es](https://github.com/pmndrs/cannon-es) über CDN
- WebXR `immersive-ar` (Passthrough) mit `plane-detection` für die Quest-Raumdaten
