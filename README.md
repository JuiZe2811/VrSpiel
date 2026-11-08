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
| Waffe ablegen | **Stick drücken** an der Waffenhand (langsam = bleibt in der Luft schweben, geworfen = fällt zu Boden) |
| Waffe aufheben / Hand wechseln | Mit einer Hand hingreifen + Griff-Taste (oder darauf zeigen + Abzug) |
| Magazin auswerfen | **A / X** an der Waffenhand |
| Neues Magazin / Patrone | **Nach unten schauen**: am Gürtel greifen (Griff-Taste) |
| Magazin einsetzen | Magazin von unten in den Magazinschacht führen |
| Schrotpatrone laden | Patrone an die Ladeöffnung unten am Gehäuse führen |
| Durchladen | Schlitten / Spannhebel / Kammerstängel mit der zweiten Hand greifen, zurückziehen, loslassen |
| Repetieren (Flinte) | Vorderschaft zurück- und wieder vorschieben |
| Feuermodus / Sicherung | **B / Y** an der Waffenhand (Pistole: Schlittenfang lösen) |
| Zoom (Zielfernrohr) | Stick hoch / runter |
| Wurfmesser | Am Gürtel (Seite der freien Hand) greifen, ausholen und Griff-Taste beim Werfen loslassen. Langsam an der Scheide loslassen = zurückstecken |

**Gürtel:** Er sitzt an deiner Hüfte und dreht sich mit dir. Je nach Waffe stecken dort Magazine oder Schrotpatronen,
die nach dem Herausnehmen nachgefüllt werden. Messertreffer zählen doppelt; eine Wurfhilfe lenkt Würfe,
die ungefähr auf eine Scheibe zielen.

**Info-Anzeige:** Kleine Anzeige am Handgelenk der freien Hand (Munition, Feuermodus, nächster Schritt).
Sie erscheint nur, wenn du aufs Handgelenk schaust, und ist beim Zielen ausgeblendet.

**Zielfernrohr:** Du siehst durchs Glas deinen echten Raum, die Zielscheiben werden darin vergrößert eingeblendet.
Optional: Mit dem Knopf „📷 Kamera fürs Zielfernrohr erlauben“ (vor „START AR“) wird zusätzlich das Kamerabild
der Quest vergrößert angezeigt – das funktioniert nur, wenn dein Quest-Browser den Zugriff auf die Kameras erlaubt.

## Am PC testen

`python3 -m http.server` im Ordner starten und `http://localhost:8000` öffnen.
1–4 Waffe wählen · Linksklick schießen · rechte Maustaste ziehen = umschauen · Leertaste = Visier ·
R nachladen · V Feuermodus · F Messer werfen · Mausrad Zoom.

## Technik

- Eine einzige Datei: `index.html` mit [three.js](https://threejs.org/) (über CDN geladen)
- WebXR `immersive-ar` → transparenter Hintergrund = Passthrough
- Zielfernrohr über ein zweites Kamerabild (Render-Target), Rotpunkt erscheint nur, wenn dein Auge hinter dem Glas ist
- Geräusche werden mit der Web Audio API erzeugt, Rückmeldung über die Controller-Vibration
