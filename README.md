# 🎯 Passthrough-Schießstand (Quest 3, WebXR)

Ein Mixed-Reality-Schießspiel für die Meta Quest 3, das direkt im Browser läuft.
Die Zielscheiben schweben in deinem echten Zimmer (Passthrough). Du wählst eine Waffe von der
Waffenwand, zielst über echte Visiere und lädst von Hand nach.

## Spielen

1. Die Seite muss über **HTTPS** erreichbar sein (z. B. GitHub Pages: *Settings → Pages → Branch wählen → Save*).
2. Die URL im **Browser der Quest 3** öffnen und **„START AR“** tippen.
3. Eine Waffe von der Wand nehmen: hingreifen + **Griff-Taste**, oder darauf zeigen + **Abzug**.
4. Auf den grünen **START**-Knopf schießen. Eine Runde dauert 75 Sekunden.

## Waffen

| Waffe | Visier | Magazin | Besonderheit |
|---|---|---|---|
| Pistole P9 | Kimme & Korn (3 Leuchtpunkte) | 15 | einhändig, Schlittenfang |
| Maschinenpistole MPX | Rotpunktvisier | 30 | Sicher / Einzel / Dauerfeuer, Vordergriff |
| Pump-Flinte | Perlkorn | 6 + 1 (Röhre) | Schrot, nach jedem Schuss repetieren |
| Scharfschützengewehr | Zielfernrohr 4–12x | 5 | Kammerverschluss, Ziele weiter entfernt, Punkte x1,5 |

Lange Waffen hältst du **mit beiden Händen**: Zweite Hand an den Vorderschaft + Griff-Taste.
Einhändig streuen sie stärker.

## Steuerung (Quest-Controller)

| Aktion | So geht's |
|---|---|
| Schießen | Abzug der Waffenhand |
| Magazin auswerfen | **A / X** an der Waffenhand |
| Neues Magazin / Patrone | Zweite Hand an die **Hüfte** + Griff-Taste |
| Magazin einsetzen | Magazin von unten in den Magazinschacht führen |
| Schrotpatrone laden | Patrone an die Ladeöffnung unten am Gehäuse führen |
| Durchladen | Schlitten / Spannhebel / Kammerstängel mit der zweiten Hand greifen, zurückziehen, loslassen |
| Repetieren (Flinte) | Vorderschaft zurück- und wieder vorschieben |
| Feuermodus / Sicherung | **B / Y** an der Waffenhand (Pistole: Schlittenfang lösen) |
| Zoom (Zielfernrohr) | Stick hoch / runter |

Über der zweiten Hand schwebt eine kleine Anzeige mit Munition, Feuermodus und dem nächsten Schritt.

Hinweis: Das Bild im Zielfernrohr ist ein „digitales“ Zielfernrohr. Es zeigt Zielscheiben vergrößert,
aber nicht deinen echten Raum, weil Browser-Spiele keinen Zugriff auf das Passthrough-Kamerabild haben.

## Am PC testen

`python3 -m http.server` im Ordner starten und `http://localhost:8000` öffnen.
1–4 Waffe wählen · Linksklick schießen · rechte Maustaste ziehen = umschauen · Leertaste = Visier ·
R nachladen · V Feuermodus · Mausrad Zoom.

## Technik

- Eine einzige Datei: `index.html` mit [three.js](https://threejs.org/) (über CDN geladen)
- WebXR `immersive-ar` → transparenter Hintergrund = Passthrough
- Zielfernrohr über ein zweites Kamerabild (Render-Target), Rotpunkt erscheint nur, wenn dein Auge hinter dem Glas ist
- Geräusche werden mit der Web Audio API erzeugt, Rückmeldung über die Controller-Vibration
