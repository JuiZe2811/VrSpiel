# 🧟 Zombie-Abwehr im eigenen Zimmer (Quest 3, WebXR)

Ein Mixed-Reality-Zombiespiel für die Meta Quest 3, das direkt im Browser läuft.
Du richtest deinen echten Raum ein – Wände, **Türen, Fenster**, Tische und Stühle. Die Zombies kommen durch
deine Türen und Fenster, reißen die Bretter davor Stück für Stück weg, laufen um deine Möbel herum zu dir
und wollen dich töten.

## Neu in Version 18 – das große Update

**Physik**
- Erledigte Zombies werden zu echten Physik-Körpern: Sie kippen vom Schuss weg um, fallen über Tische und
  werden von Granaten weggeschleudert.
- Geworfene Gegenstände (Waffen, Granaten …) prallen an Zombies ab und verletzen sie – je schwerer und schneller, desto mehr.
- Alle Physik-Objekte haben jetzt ihren Schwerpunkt in der Mitte (realistischeres Kippen und Rollen).

**Neu im Spiel**
- 🔨 **Bretter reparieren:** Neben dem Waffenständer steht eine Kiste mit Brettern. Brett greifen, an eine Tür/ein
  Fenster halten (ein grünes Vorschau-Brett zeigt die Stelle) und loslassen = angenagelt (+10 Punkte).
- ✨ **Power-ups** (fallen selten von Zombies, berühren zum Einsammeln): ×2 Doppelte Punkte, ☢ Atombombe (alle Zombies
  sterben), ▮▮ Volle Munition (inkl. Granaten), ⏳ Zeitlupe.
- 👹 **Boss-Welle:** Jede 5. Welle kommt ein **Riese** – über 2 m groß, hält extrem viel aus, brüllt, stampft (Schockwelle,
  der Controller bebt) und lässt garantiert ein Power-up fallen.
- **Killserien:** Doppelkill, Dreifachkill, … mit Ansage und Bonuspunkten; Countdown bis zur nächsten Welle; beste Serie im Ergebnis.

**Grafik & Effekte**
- Hinter Fenstern: Gewitter mit Blitzen, Donner und kahlen Bäumen; im Türflur flackert ein rotes Notlicht.
- Mündungsrauch, Funken und Staub bei Wandtreffern, Blutspritzer an Wänden hinter getroffenen Zombies, gut sichtbare Leuchtspuren.
- Roter Richtungsbogen zeigt, von wo ein Zombie angreift; Treffer- und Kill-Geräusche als Rückmeldung.

**Animationen**
- Zombies drehen sich bei seitlichen Treffern mit, Kopftreffer reißen den Kopf zurück.
- Schrot aus der Nähe wirft Zombies um – sie bleiben kurz liegen und stehen wieder auf.
- Renner rennen nach vorne gebeugt mit pumpenden Armen, Brocken und Riesen wanken schwer (mit hörbaren Schritten).
- Zwei Angriffsarten: Krallenhieb und Biss; Köpfe zucken unheimlich.

**Stabilität:** Zwei weitere kleine Speicherlecks behoben (schwebende Punkte-Texte, Erste-Hilfe-Kästen, Gürteltaschen),
im Dauertest über 8 Wellen bleibt der Speicher jetzt konstant.

## Neu in Version 16–17

- **💣 Handgranaten** – zwei am Gürtel (werden jede Welle aufgefüllt). Greifen, ausholen, Griff-Taste beim Werfen loslassen.
  Nach gut 2 Sekunden explodieren sie: Druckwelle, abgerissene Gliedmaßen, umherfliegende Gegenstände.
  Vorsicht – zu nah dran trifft es auch dich. Langsam am Gürtel loslassen = zurückstecken.
- **🔪 Messer-Nahkampf** – mit dem Messer in der Hand einfach zustechen oder zuschlagen (Kopf zählt dreifach).
- **🩹 Erste-Hilfe-Kästen** – erledigte Zombies lassen manchmal einen fallen; berühren heilt +35.
- **Schwierigkeitsgrad** Leicht / Normal / Schwer und **🔊 Ansager** (sagt Wellen, Gefahren und Heilung an) im Menü.
- **Zombies taumeln** bei harten Treffern, Schrot stößt sie zurück (Brocken nicht).
- **Blutlachen** und Rußflecken auf dem Boden, **Bestenliste** (Top 5 je Modus).
- **Versionsnummer** im Menü – so siehst du, ob die Quest die neueste Version geladen hat.

**Tipp nach einem Update:** GitHub Pages und der Quest-Browser speichern Seiten bis zu ca. 10 Minuten zwischen.
Steht im Menü nicht die neueste Version, kurz warten und die Seite neu laden.

## Spielen

1. Die Seite muss über **HTTPS** erreichbar sein (z. B. GitHub Pages: *Settings → Pages → Branch wählen → Save*).
2. Die URL im **Browser der Quest 3** öffnen und **„START AR“** tippen.
3. **Spielbereich einrichten** (siehe unten), dann **✔ Fertig**.
4. Eine Waffe vom **Waffenständer** nehmen, Spielmodus wählen und auf die grüne **START**-Scheibe schießen
   (oder den Knopf ▶ START drücken).

## Spielbereich einrichten

Alles geht per **Laser** – du musst nichts berühren. Menü: Zeigestrahl + Abzug.

| Werkzeug | So geht's |
|---|---|
| 📏 Bodenhöhe | Controller auf den Boden legen + Abzug. Danach mit **Stick ▲▼** fein einstellen, bis das türkise Gitter genau auf dem echten Boden liegt (wird gespeichert) |
| 📡 Quest-Raum | Übernimmt Wände, Türen, Fenster, Tische und Sofas aus deiner Quest-Raumeinrichtung (passiert beim Start automatisch, falls vorhanden) |
| 🧱 Wand | Laser auf den Boden an einer Ecke der Wand richten, **Abzug halten**, an der Wand entlang zur anderen Ecke fahren, loslassen |
| 🚪 Tür | **Erst Wände markieren.** Dann Laser auf die Wand an eine obere Türecke, Abzug halten, zur anderen Ecke ziehen, loslassen – die Unterkante ist automatisch der Boden |
| 🪟 Fenster | Laser auf die Wand an eine Fensterecke, Abzug halten, zur gegenüberliegenden Ecke ziehen, loslassen |
| 🪑 Tisch / 💺 Stuhl | Grundfläche mit dem Laser auf dem Boden aufziehen (Ecke zu Ecke), dann mit dem Laser auf die **Tischkante** zeigen = Höhe, Abzug = fertig. Stick ◀ ▶ dreht, B/Y bricht ab |
| 🔫 Waffenständer | Laser auf den Boden + Abzug (ziehen = Ausrichtung). Kompakter Ständer (90 × 45 cm): Langwaffen stehen aufrecht, die Pistole liegt davor – zu Beginn **jeder Runde** |
| ↶ Rückgängig / 🗑 Alles löschen | Letzte Fläche bzw. alles entfernen |
| 💾 Laden | Lädt den zuletzt eingerichteten Raum (passt nur, wenn du am selben Platz und in dieselbe Richtung startest) |

Echte Wände und Möbel verdecken virtuelle Dinge dahinter (Zombies hinter der Wand sieht man nur durch Tür/Fenster), und Waffen, Magazine und Dosen prallen physikalisch daran ab.
Schüsse hinterlassen Einschusslöcher an den Wänden, Messer bleiben darin stecken.

## Waffen

Alle vier Waffen stehen im **Waffenständer** – jede genau einmal. Zu Beginn jeder Runde kommen alle Waffen,
die du nicht in der Hand hältst, voll geladen zurück in den Ständer.

| Waffe | Visier | Magazin | Besonderheit |
|---|---|---|---|
| Pistole P9 | Kimme & Korn | 15 | einhändig, Schlittenfang |
| Maschinenpistole MPX | Rotpunktvisier | 30 | Sicher / Einzel / Dauerfeuer, Vordergriff |
| Pump-Flinte | Perlkorn | 6 + 1 (Röhre) | Schrot, nach jedem Schuss repetieren |
| Scharfschützengewehr | Zielfernrohr 4–12x | 5 | Kammerverschluss, sehr hoher Schaden |

## Steuerung (Quest-Controller)

| Aktion | So geht's |
|---|---|
| Waffe nehmen | Hingreifen + **Griff-Taste halten** (aus der Ferne: darauf zeigen + Griff-Taste → fliegt in die Hand) |
| Ablegen / Werfen | **Griff-Taste loslassen** – die Waffe fällt mit Physik, beim Loslassen in der Bewegung wird sie geworfen |
| Hand wechseln | Mit der anderen Hand an den Griff fassen; zwei Waffen gleichzeitig (eine pro Hand) gehen auch |
| Schießen | Abzug |
| Zweihändig halten | Zweite Hand an den Vorderschaft + Griff-Taste |
| Magazin auswerfen | **A / X** |
| Neues Magazin / Patrone | Nach unten schauen: am **Gürtel** greifen (in Reichweite wird das Magazin größer und der Controller vibriert). Ausgeworfene Magazine kann man vom Boden aufheben (mit Restpatronen) |
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

## Zombies

- Hinter jeder Tür liegt ein dunkler Flur, hinter jedem Fenster die Nacht – mit Holzrahmen, damit die Zombies
  nicht aus dem Nichts kommen.
- Vor jeder Welle sind Türen und Fenster mit **Brettern** vernagelt. Die Zombies reißen sie nacheinander ab
  (du hörst es krachen) – du kannst sie schon durch die Lücken beschießen.
- Danach kommen sie durch die Tür bzw. **klettern durchs Fenster** und laufen um Wände, Tische und Stühle herum zu dir.
- Hast du keine Türen/Fenster eingerichtet, kommen sie aus dem Boden.
- Du hörst sie räumlich stöhnen – dreh dich um!

| Typ | Aussehen / Verhalten |
|---|---|
| Schlurfer | normaler Zombie, ca. 1,45–1,6 m |
| Renner | dünn, rote Augen, fast doppelt so schnell, hält weniger aus (ab Welle 2) |
| Kriecher | ohne Beine, kriecht am Boden (ab Welle 2) |
| Brocken | breit und massig, langsam, hält mehr als doppelt so viel aus, schlägt hart zu (ab Welle 3) |

| Treffer | Wirkung |
|---|---|
| Kopf | 3-facher Schaden – meist sofort tot (Scharfschützengewehr: Kopf weg) |
| Körper | normaler Schaden |
| Bein | Zombie **humpelt** langsamer; nach mehreren Treffern fällt das Bein ab und er **kriecht** |
| Arm | weniger Schaden; nach mehreren Treffern fällt der Arm ab – er schlägt schwächer zu |

Schaden pro Treffer: Pistole 34 · MP 24 · Schrot 15 pro Kugel (9 Kugeln) · Scharfschützengewehr 150 · Messer 90.
Schlurfer haben 100 Lebenspunkte (+10 pro Welle).

Wenn ein Zombie dich erreicht, schlägt er zu: Die Sicht wird rot, der Controller vibriert. Leben regeneriert langsam,
wenn du eine Weile nicht getroffen wurdest. Bei 0 ist die Runde vorbei.

**Modi:** 🧟 Überleben (Wellen, immer mehr und schnellere Zombies) · 🎯 Training (Zombies tun dir nichts).
Punkte: Treffer +10, erledigt +100, Kopfschuss +150, überlebte Welle +50 × Welle.

## Am PC testen

`python3 -m http.server` im Ordner starten und `http://localhost:8000` öffnen (mit einem Beispielraum).
1–4 Waffe · Linksklick schießen / Knöpfe · rechte Maustaste ziehen = umschauen · Leertaste = Visier ·
R nachladen · V Feuermodus · F Messer werfen · G Granate · P Brett annageln · Enter Start · Mausrad Zoom.

## Technik

- Neue Version veröffentlichen: `python3 tools/version.py <Nummer>` (hängt die Versionsnummer an alle Dateien an)

- `index.html` + Module in `js/`: `main.js` (Spielablauf, Hände, Waffen-Mechanik), `weapons.js` (Modelle),
  `room.js` (Raum), `zombies.js` (Zombies, Bretter, Wegfindung mit A*), `physics.js` (cannon-es), `effects.js`, `sfx.js`, `util.js`
- [three.js](https://threejs.org/) und [cannon-es](https://github.com/pmndrs/cannon-es) über CDN
- WebXR `immersive-ar` (Passthrough) mit `plane-detection` für die Quest-Raumdaten
