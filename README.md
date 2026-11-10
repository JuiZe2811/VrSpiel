# 🧟 Zombie-Abwehr im eigenen Zimmer (Quest 3, WebXR)

Ein Mixed-Reality-Zombiespiel für die Meta Quest 3, das direkt im Browser läuft.
Du richtest deinen echten Raum ein – Wände, **Türen, Fenster**, Tische und Stühle. Die Zombies kommen durch
deine Türen und Fenster, reißen die Bretter davor Stück für Stück weg, laufen um deine Möbel herum zu dir
und wollen dich töten.

## Neu in Version 34 – Neues Monster-Modell für den Riesen

- Der Riese (kommt in den Wellen 8, 13, 18 usw.) ist jetzt ein echtes 3D-Monster: riesiges Maul mit Zähnen, dicker Bauch und lange Krallen (`models/giant.glb`).
- Das Modell wurde für die Quest verschlankt: von 58.000 auf etwa 17.500 Dreiecke, 0,7 MB.
- Es hat keine eigene Textur. Fahle Haut, dunkle Flecken und Blut um Maul und Krallen werden beim Laden gefärbt.
- Das Monster bewegt sich mit allen bisherigen Riesen-Animationen: Gehen, Schlagen, Stampfen und Todesanimation. Kopftreffer und Schaden funktionieren wie vorher.

## Neu in Version 33 – Der Boss kämpft mit Waffen

- **Jede Boss-Runde hat er eine bessere Waffe:** Welle 5 Pistole → 10 Revolver → 15 Maschinenpistole → 20 Pump-Flinte → 25 Sturmgewehr → 30 Maschinengewehr → 35 Panzerbüchse → 40 Minigun. Ab Welle 45 wechselt er zwischen den drei stärksten, und jede weitere Stufe trifft härter und schießt schneller.
- **Fair und ausweichbar:** Vor jeder Salve zielt er sichtbar mit einem roten Laser-Visier. Die Kugeln sind leuchtende Leuchtspuren, die man kommen sieht. Wer sich bewegt, weicht aus, denn sein Zielpunkt folgt dir mit Verzögerung. Wände und Möbel halten die Kugeln auf, man kann also in Deckung gehen.
- **Ab Welle 25 wirft er ab und zu Granaten:** Sie blinken, und ein roter Ring am Boden zeigt den Gefahrenbereich. Schnell raus da!
- Nahkampf gibt es weiterhin: Sturmangriff, Stampfer, Teleport (ab Welle 15) und Wirbelwind (ab Welle 20). Wenn er stirbt, fällt ihm die Waffe aus der Hand.

## Neu in Version 32 – Boss-Runde jede 5. Welle

- **Jede 5. Welle ist eine Boss-Runde:** Es kommen keine Zombies, nur der Boss (eigenes 3D-Modell, `models/boss.glb`). Die Welle ist geschafft, wenn er besiegt ist.
- **Jedes Mal schwerer und mit neuen Angriffen:**
  - Stufe 1 (Welle 5): Sturmangriff und Stampfer (roter Druckwellen-Ring am Boden, ausweichen!)
  - Stufe 3 (Welle 15): dazu Teleport (taucht hinter dir auf und schlägt zu) und Wut-Modus bei wenig Leben (rot, schneller, Angriffe direkt hintereinander)
  - Stufe 4 (Welle 20) und höher: dazu Wirbelwind. Mit jeder Stufe hat er mehr Leben, ist schneller, trifft härter und wird etwas größer.
- **Fair:** Er hat einen Lebensbalken über dem Kopf, und jeder Angriff wird angekündigt (Ausholen). Ein Kopfschuss zählt dreifach. Einfrieren, Fallen und die Atombombe kosten ihn nur ein Stück Leben, sie töten ihn nicht sofort.
- **Belohnung:** 1000 Punkte × Stufe, „Volle Munition“ und ein Medipack.
- Der Riese kommt jetzt in den Wellen 8, 13, 18 usw.

## Neu in Version 31 – Leuchtende Hilfen für alle Waffen, neue Rundenanzeige

**Leuchtende Hilfen** – damit jeder sofort versteht, was zu tun ist (Einstellungen → Bedienung → „Leuchtende Hilfen“):
- Eine **pulsierende Markierung mit kurzem Hinweis** zeigt immer genau auf die Stelle, die du als Nächstes brauchst:
  - Gesichert → „B/Y: entsichern“
  - Magazin leer → „A/X: Magazin raus“ (am Magazinschacht)
  - kein Magazin drin → „Magazin greifen“ (am Gürtel), mit Magazin in der Hand → „↑ Magazin hier rein“ (am Schacht)
  - Patronen-Waffen → „Patrone greifen“ / „Patrone hier rein“ (an der Ladeöffnung)
  - Durchladen nötig → leuchtet **am Schlitten / Spannhebel / Kammerstängel / Vorderschaft**: „Schlitten ziehen“, „Spannhebel ziehen“, „Kammerstängel greifen“ → „zurück … und vor“, „Vorderschaft zurück & vor“
  - Reserve leer → rot „Keine Munition!“
- Die Hilfen werden immer über allem gezeichnet, auch wenn die Waffe davor ist.

**Leichteres Handling**
- Magazine und Patronen rasten schon aus größerem Abstand ein (17 cm statt 14 cm, mit Flinkhand 22 cm).
- Spannhebel / Schlitten lassen sich aus größerem Abstand greifen.

**Neue Rundenanzeige**
- Die Anzeige mit Welle, Leben und Punkten **schwebt jetzt kompakt oben in deinem Blickfeld** (1,3 m vor dir) und wird **immer über allem gezeichnet** – sie kann nie mehr in einer Wand stecken.
- Sie folgt deinem Kopf mit Verzögerung: erst wenn du dich deutlich wegdrehst, gleitet sie nach.

## Neu in Version 30 – Große Leistungs-Optimierung

Gemessen mit 14 Zombies im Raum: **Zeichenaufrufe pro Bild von 768 auf ~200 gesenkt**, Bildrate im Test fast verdoppelt.

- **Zombies als ein Körper**: Jeder Zombie bestand aus ~30 Einzelteilen (= 30 Zeichenaufrufe pro Auge). Jetzt wird der ganze Körper als **ein Skinned-Mesh** gezeichnet; die Gelenke (Hüfte, Knie, Arme, Kopf) sind Knochen. Animationen, Todesanimationen, abfallende Arme/Beine und Trefferzonen (Kopf ×3, Beine, Arme) funktionieren wie vorher. Pro Zombie bleiben ~3 Zeichenaufrufe. Einfacheres Licht-Material und weniger Polygone für die Zombies.
- **Waffen** werden beim Bauen pro Material zusammengefasst (Pistole 32 → 13 Teile), auch in beweglichen Teilen wie Schlitten und Magazinen.
- **Partikel** (Blut, Splitter, Funken) sind jetzt **ein einziges Punkt-System** statt hunderter Einzelobjekte.
- **Tür-/Fensterhintergründe, Automaten, Aufrüster und Wandkauf-Tafeln** werden ebenfalls zusammengefasst.
- Die Glückskiste hat kein eigenes Licht mehr (jedes Licht verteuert jedes Pixel), die Anzeigetafel wird höchstens 5× pro Sekunde neu gezeichnet.
- Leistungsprofile (Grafik → Leistung): *Ausgewogen* und *Flüssig* verwenden jetzt einfachere Schatten und **keine Umgebungsspiegelungen** (dafür etwas mehr Grundlicht); die Schattenfläche folgt dem Spieler statt 40 × 40 m groß zu sein. Einschusslöcher: Schön 5, Ausgewogen 3, Flüssig keine.

## Neu in Version 29 – Größere Gesichter, aufgeräumter Gürtel, begrenzte Munition, Rücken für jede Waffe

**Gesichter noch größer**
- Die Fotos sind jetzt größer ausgeschnitten (mit Haaren und Kinn), die Gesichtsfläche bedeckt fast die ganze Vorderseite des Kopfes, und die Köpfe der Freundes-Zombies sind 32 % größer – man erkennt sofort, wer da kommt.

**Aufgeräumter Gürtel**
- Am Gürtel sind nur noch: **Pistolen-Holster** (rechte Hüfte), **ein Munitionsplatz** (rechts vorne), **Granaten** (links, übereinander), **Messer** und – nur wenn du einen hast – der **Trommel-Affe**. Keine Bretter mehr am Gürtel.
- **Pistole einstecken** klappt jetzt zuverlässig: einfach mit der Pistole irgendwo an die rechte Hüfte/den Gürtel fahren – es vibriert – und loslassen.

**Begrenzte Munition**
- Jede Waffe hat eine **Reserve** (z. B. Pistole 60 Schuss, meist 4 Magazine). Ein Magazin vom Gürtel nimmt Patronen aus der Reserve. Ausgeworfene Magazine geben ihre Restpatronen zurück in die Reserve.
- **Beim Runterschauen** siehst du über dem Munitionsplatz, **wie viele Schuss noch übrig sind** (gelb = weniger als ein Magazin, rot „LEER“ = nichts mehr).
- Auch die Anzeige am Handgelenk zeigt die Reserve: „15+1 | 60“.
- Nachschub: das Power-up **„Volle Munition“** (fällt bei wenig Munition deutlich öfter von Zombies), **Munition am Wandkauf** (halber Preis) und **Aufrüsten** füllen die Reserve auf.

**Rücken: zwei Waffen tragen**
- Jede Waffe kann auf den Rücken: über die Schulter nach hinten führen – es vibriert – und loslassen. Die Zone ist jetzt viel größer.
- Ist der Rücken schon belegt, wird **getauscht**: die neue Waffe kommt auf den Rücken, die alte springt dir in die Hand.
- Zum Ziehen über die Schulter greifen.

**Bretter**
- Bretter holst du dir jetzt **direkt an der Tür bzw. dem Fenster**, an dem welche fehlen: Hand hin, Griff-Taste, Brett anhalten, loslassen.

## Neu in Version 28 – Gesichter viel besser erkennbar

- Das Foto liegt jetzt auf einer **eigenen gewölbten Gesichtsfläche** vorne am Kopf statt verzerrt auf der Kopfkugel – in höherer Auflösung (300 × 360) und mit weichem Rand, der in die Haut übergeht.
- Viel weniger Zombie-Färbung: nur ein leichter Grünstich, Blut und Schmutz nur am Rand – das Gesicht bleibt frei.
- Das Gesicht leuchtet leicht von selbst, damit man es auch im dunklen Flur und bei wenig Licht erkennt.
- Köpfe der Freundes-Zombies sind 18 % größer.

## Neu in Version 27 – Gesichter von Freunden & flüssiger

**🧟 Zombies mit den Gesichtern deiner Freunde**
- Auf der Startseite (vor „START AR“) unten links: **„🧟 Gesichter“**.
- **📷 Foto hinzufügen** → Foto auswählen → den gelben Rahmen aufs Gesicht schieben (ziehen), mit dem Regler die Größe anpassen (Augen etwa auf der gestrichelten Linie) → **Übernehmen**. Bis zu 6 Gesichter.
- **Anteil** wählen: Aus / Manche / Viele / Alle Zombies tragen ein Freundes-Gesicht. Die Gesichter werden fahl-grünlich eingefärbt, mit dunklen Rändern, Schmutz und Blut. Haare, Augen-Leuchten und Kiefer werden bei diesen Zombies weggelassen, damit das Foto gut zu sehen ist.
- **Eingebaut:** Drei Freundes-Gesichter (mit deren Erlaubnis) liegen als kleine Ausschnitte in `faces/` und werden automatisch benutzt, solange keine eigenen Fotos geladen sind. Im Gesichter-Fenster lassen sie sich abschalten.
- **Eigene Fotos** werden nur im Browser des jeweiligen Geräts gespeichert (nicht hochgeladen). Auf der Quest: Fotos z. B. per Meta-Horizon-App oder Browser-Download auf die Brille bringen und dann im Quest-Browser auswählen.

**Flüssiger**
- Neue Einstellung **Grafik → Leistung**: *Schön* / *Ausgewogen* (Standard) / *Flüssig*.
  - Ausgewogen: 90 % Auflösung, Foveated Rendering, Schatten nur jedes 2. Bild, höchstens 14 Zombies gleichzeitig.
  - Flüssig: 75 % Auflösung, Schatten jedes 3. Bild mit kleinerer Schattenkarte, höchstens 12 Zombies.
  - Die Auflösung gilt ab dem nächsten Start von „START AR“.
- Nur noch die großen Körperteile der Zombies werfen Schatten (viel weniger Zeichenaufrufe), weniger Einschusslöcher pro Zombie, die Rundenwechsel-Anzeige wird seltener neu gezeichnet.
- „Punkte-Anzeigen“ ist in den Reiter Bedienung umgezogen.

## Neu in Version 26 – Pistole im Holster, kompletter Reset, Karte einfach ausrichten

**Kein Waffenständer mehr – du startest mit der Pistole in der Hand**
- Beim Rundenstart hast du die **Pistole direkt in der rechten Hand**. Der Waffenständer ist komplett weg.
- Die Pistole hat ein **Holster an der rechten Hüfte**: dort hinfassen + Griff-Taste = ziehen, an der Hüfte loslassen = wegstecken. Liegt sie irgendwo herum, kehrt sie nach 6 Sekunden von selbst ins Holster zurück.
- **Bretter** zum Reparieren gibt es jetzt **vorne am Gürtel** (unbegrenzt) – greifen, an die Tür/das Fenster halten, loslassen.
- Beim Einrichten des Raums steckt die Pistole automatisch im Holster, damit beide Hände frei sind.

**Neue Runde = komplett aufgeräumte Karte**
- Beim Start jeder Runde wird alles zurückgesetzt: lose Magazine, Messer, Bolzen, Granaten, Affen, Flammen, Blitze, Power-ups, Verbandskästen, Leichen, Blutflecken, gekaufte Waffen, Rückenholster, Fallen (wieder bereit), Glückskiste und Aufrüster.

**Gespeicherte Karte ganz einfach ausrichten**
- Nach dem Laden (oder mit 🧭 Ausrichten): **Griff-Taste halten = die ganze Karte anfassen**. Bewegst du die Hand, wird die Karte **in jede Richtung verschoben**; drehst du das Handgelenk, **dreht sich die Karte mit**. Loslassen – fertig. So kannst du die Wände direkt an deine echten Wände schieben.
- Feinjustieren: **linker Stick** schiebt in alle Richtungen (vor/zurück/links/rechts), **rechter Stick** ◀ ▶ dreht.
- Weiterhin möglich: eine Laser-Linie an einer echten Wand ziehen – die Karte rastet daran ein.

**Behoben**
- Beim Waffenwechsel verschwanden Granaten und Trommel-Affe vom Gürtel – jetzt bleiben sie.

## Neu in Version 25 – Todesanimationen, Automaten selbst aufstellen, Preis-Einstellungen

**Bessere Todesanimationen, Zombies verschwinden schnell**
- Getroffene Zombies **taumeln zurück und kippen wie ein Brett um** (nach hinten oder vorne, je nach Schussrichtung), **sacken auf die Knie** und fallen dann nach vorn, oder **drehen sich beim Fallen**. Kriechende brechen einfach zusammen.
- Beim Aufschlag: kleiner Rückprall, Staub, dumpfer Schlag, letztes Zucken.
- Danach **versinken sie im Boden** (mit dunklem Rauch) – standardmäßig nach etwa 3 Sekunden komplett weg. Einstellbar unter Grafik → „Tote Zombies liegen“ (Sehr kurz / Kurz / Normal / Lang).

**Automaten und Aufrüster selbst aufstellen**
- Im Raumbau: **🥤 Automat** wählen, dann **den Knopf nochmal drücken, um die Sorte zu wechseln** (♥ Eisenhaut, ⚡ Flinkhand, » Schnellfeuer, ✚ Zweites Leben). Laser auf eine Wand **oder frei auf den Boden** (er schaut dann zu dir) + Abzug. Jede Sorte gibt es einmal – neu setzen verschiebt sie.
- **⚙ Aufrüster** genauso, auch frei im Raum.
- **Es wird nichts mehr automatisch aufgestellt, was du nicht willst**: Einstellungen → Spiel → „Automatisch aufstellen“: *Nichts* / *Waffen+Kiste* (Standard) / *Alles*.
- Automaten und Aufrüster sind jetzt **30 % kleiner**.
- Behoben: Die Kaufstelle der Automaten lag manchmal an der falschen Stelle.

**💰 Neuer Einstellungs-Reiter „Preise“**
| Einstellung | Auswahl |
|---|---|
| Wandkauf-Waffen | 50 % – 200 % |
| Glückskiste | 500 / 950 / 1500 / 2500 |
| Getränke-Automaten | 50 % – 200 % |
| Aufrüster | 25 % – 150 % |
| Fallen | 250 / 500 / 1000 / 2000 |
| Punkte für Treffer & Kills | ×0,5 – ×3 |
Die Preisschilder an Wänden, Automaten und Aufrüster zeigen immer die eingestellten Preise.

## Neu in Version 24 – Wände schließen sich automatisch

- **Anheften beim Zeichnen**: Jede neue Wand verbindet sich mit den vorhandenen. Ecken werden bis zum Schnittpunkt verlängert oder gekürzt, Wände, die kurz vor einer anderen enden, rasten dort ein (T-Stoß), kleine Lücken werden geschlossen. Start- und Endpunkt rasten schon ab 40 cm an vorhandenen Ecken ein.
- Die Meldung zeigt dabei, wie viele **offene Enden** noch übrig sind – oder „Raum geschlossen ✔“.
- **Beim Tippen auf „Fertig“** wird der Raum endgültig geschlossen: Restlücken werden verbunden, und wenn nur noch eine Seite offen ist, wird sie mit einer Wand (bzw. über eine rechtwinklige Ecke) zugemacht.
- Auch Wände aus der **Quest-Raumeinrichtung** werden so lückenlos verbunden. Türen und Fenster in den Wänden bleiben dabei erhalten.

## Neu in Version 23 – Aufrüst-Stufen, Balance & Rundenwechsel

**Aufrüsten in drei Stufen**
| Stufe | Preis | ab Welle | Schaden | Munition | Tarnung |
|---|---|---|---|---|---|
| ★ | 5000 | 1 | ×2 | ×1,5 | Lila/Türkis |
| ★★ | 15000 | 8 | ×3,2 | ×1,9 | Rot/Orange |
| ★★★ | 30000 | 15 | ×4,8 | ×2,3 | Gold, schimmert in allen Farben |
Jede Stufe macht die Waffe auch etwas schneller und genauer. Einfach dieselbe Waffe erneut in den Aufrüster geben.

**Neue Balance – jede Welle etwas schwerer**
- Zombie-Leben: bis Welle 10 +12 % pro Welle, danach **+8 % pro Welle exponentiell**. Ein Schlurfer hat in Welle 1 100 Leben, in Welle 10 ~210, in Welle 20 ~450, in Welle 30 ~970.
  So reicht am Anfang jede Waffe, ab etwa Welle 13 braucht man Aufrüstungen, ab Welle 25 die höchste Stufe.
- Zombies werden schneller; ab Welle 6 sprinten manche Schlurfer. Ihr Schaden steigt langsam (bis +60 %).
- Mehr Zombies pro Welle (4 + 2,4 × Welle, höchstens 70), aber höchstens 16 gleichzeitig.
- Spezial-Zombies (Brocken, Platzer, Spucker, Renner) werden mit jeder Welle häufiger.
- Verbandskästen fallen seltener (5 %, bei wenig Leben 12 %).

**Rundenwechsel-Animation**
- Nach jeder Welle erscheint vor dir die große **blutrote Wellennummer**: „WELLE X ÜBERSTANDEN“ mit Bonus, die Zahl beginnt zu zittern, bekommt **Risse**, **Blut läuft herunter** …
- … dann zerspringt sie, die **neue Zahl knallt herein** – mit Druckwelle am Boden, rotem Aufblitzen, Vibration, Stinger-Sound und Ansager.
- Darunter steht, was neu ist: „Neu: Platzer“, „☠ Ein Riese kommt ☠“, „Aufrüster: Stufe ★★ freigeschaltet“ …
- Die Pause zwischen den Wellen ist jetzt 9 Sekunden lang (Zeit zum Nachladen, Kaufen, Bretter annageln).

## Neu in Version 22 – Trommel-Affe, Fallen & flüssiges Spielen

**🐒 Trommel-Affe (Lockvogel)**
- Ein aufziehbarer Blech-Affe mit Trommel hängt am Gürtel (rechts hinten). Greifen, werfen – er landet, richtet sich auf, trommelt laut und blinkt.
- **8 Sekunden lang laufen alle Zombies im Raum zu ihm** statt zu dir und schlagen auf ihn ein. Dann **explodiert** er und reißt alles in der Nähe mit.
- Jede Runde startest du mit 1 Affen. In der Glückskiste gibt es mit etwas Glück **3 Trommel-Affen** (statt einer Waffe).
- PC: Taste **M**.

**⚡🔥 Fallen mit Hebel**
- **Elektrofalle**: Bodenplatte mit vier Polen, Blitze springen zwischen den Polen – jeder Zombie, der drüberläuft, stirbt sofort.
- **Feuerfalle**: Flammen schießen aus dem Gitter, Zombies fangen Feuer und brennen weiter.
- Aktivieren: den **Hebel** neben der Falle greifen (Griff-Taste) – kostet 1000 Punkte, 15 Sekunden aktiv, danach 35 Sekunden Abkühlung (Lampe: grün = bereit, gelb = aktiv, rot = lädt).
- Vorsicht: Wer selbst in der aktiven Falle steht, nimmt Schaden.
- Im Raumbau mit dem Werkzeug **⚡ Falle** auf den Boden setzen (abwechselnd Elektro/Feuer). Ohne eigene Fallen stehen automatisch zwei vor deinen ersten Türen/Fenstern.
- PC: Taste **T** (nächste Falle).

**Flüssig auch in späten Runden**
- Höchstens 16 Zombies gleichzeitig im Raum – die Wellen werden länger statt voller.
- Höchstens 8 Zombie-Stimmen gleichzeitig.
- **Automatisch flüssig halten** (Einstellungen → Grafik, standardmäßig an): Wenn die Quest Bilder verliert, werden stufenweise Staub, Partikel, Schatten und Augenleuchten reduziert.
- Getestet über 22 Wellen am Stück: kein Speicherzuwachs, keine Fehler.

## Neu in Version 21 – Sound, Stimmen, Einstellungen & 6 neue Waffen

**Komplett neuer Sound** (alles live erzeugt, keine Audiodateien)
- **Raumhall**: Schüsse, Explosionen und Zombies klingen nach echtem Raum, mit Echo.
- **Waffen klingen unterschiedlich**: Pistole, MP, Gewehr, Schrot, schwere Waffen, Energiewaffen, Armbrust, Granatwerfer und Flammenwerfer haben eigene Klangschichten (Knall, Körper, Druck, Mechanik). Aufgerüstete Waffen bekommen einen Laser-Schimmer.
- **Zombie-Stimmen** mit echten Vokal-Klängen: Schlurfer stöhnen, Renner kreischen beim Losrennen, Brocken und Riesen brüllen tief, Platzer gurgeln, Spucker zischen. Dazu Knurren beim Angriff, Schmerzlaute bei Treffern, Todesröcheln und schlurfende Schritte – alles räumlich (3D).
- **Dynamische Horror-Musik**: tiefes Dröhnen, das mit der Gefahr lauter und heller wird, ein Herzschlag-Puls, der schneller wird, wenn Zombies nah sind, und dissonante Klangflächen. Stinger zu Beginn und am Ende jeder Welle.
- **Gruselgeräusche** aus der Umgebung hinter Türen und Fenstern: knarrende Türen, ferne Schreie, Wind, Tropfen, Ketten.
- Neue Klänge für Münzen beim Kaufen, Trinken am Automaten, Power-ups, Kopfschuss-„Ping“, Eis, Splittern, Feuer; schweres Atmen bei wenig Leben.
- **Ansager** mit wählbarer Stimme (Dämon, Tief, Normal, Hoch) und eigener Lautstärke.

**⚙ Einstellungen** (Menü → Einstellungen, vier Reiter, alles wird gespeichert)
| Reiter | Einstellungen |
|---|---|
| 🔊 Ton | Gesamt, Effekte, Musik, Zombie-Stimmen, Ansager (je 0–100 %), Ansager-Stimme |
| 🧟 Spiel | Startpunkte (500–20000), Zombie-Menge (Weniger/Normal/Mehr/Horde), Blut (Aus/Normal/Extra), Zeitlupe beim letzten Kill, Gruselgeräusche, Treffer-Ton |
| ✊ Bedienung | Griff (Halten/Tippen), Nachladen (Echt/Einfach), Zielhilfe, Vibration (Aus–Stark), Anzeige am Handgelenk, Gürtel-Abstand |
| ✨ Grafik | Echte Schatten, Partikel (Wenig/Normal/Viel), Staub, Punkte-Anzeigen, leuchtende Zombie-Augen |

**Spielgefühl**
- **Zeitlupe beim letzten Kill** einer Welle: Leichen und Trümmer fallen in Zeitlupe.
- Kopfschüsse haben einen eigenen Treffer-Ton. Feuer-Schaden zählt nicht mehr als Treffer-Punkte (kein Punkte-Trick).

**6 neue Waffen** (jetzt 30)
- **Abgesägte** – einhändige Schrotflinte, zwei Schuss
- **Maschinenkarabiner MK-44** – Holzschaft, kräftiges Dauerfeuer
- **Jagdgewehr J-7** – Zielfernrohr, Kammerverschluss
- **Granatwerfer GL-6** – Trommel mit 6 Granaten, die beim Aufprall explodieren (Granaten am Gürtel)
- **Flammenwerfer** – Feuerkegel, Zombies **brennen** weiter
- **Frostwerfer** (Wunderwaffe, nur Glückskiste) – friert Zombies ein, der nächste Treffer **zerschmettert** sie in Eissplitter

## Neu in Version 20 – Perks, Aufrüster, 8 neue Waffen & neue Zombies

**8 neue Waffen** (jetzt 24)
- **Salvengewehr S-3** – Drei-Schuss-Salve (neuer Feuermodus „SALVE“), Rotpunkt
- **MP Vektor** – 1200 Schuss/min, kaum Rückstoß
- **Unterhebel .44** – Patronen einzeln laden, mit dem Hebel repetieren
- **Panzerbüchse .50** – Zielfernrohr + Zweibein, **durchschlägt bis zu 4 Zombies** hintereinander
- **Armbrust** – Sprengbolzen bleiben stecken, piepen und **explodieren** (Bolzen am Gürtel)
- **Bullpup B-9** – kompakt, Magazin hinter dem Griff
- **Minigun M-6** (nur Glückskiste) – sechs Läufe, die erst **hochdrehen**, dann 200 Schuss Dauerfeuer
- **Blitzwerfer** (Wunderwaffe, nur Glückskiste) – **Kettenblitz** springt von Zombie zu Zombie

**Perk-Automaten** (an der Wand, eigenes Werkzeug 🥤 im Raumbau): Griff-Taste am Automaten = Getränk kaufen,
Flasche an den Mund führen = trinken. Gilt bis zum Rundenende.
| Automat | Preis | Wirkung |
|---|---|---|
| ♥ Eisenhaut | 2500 | 200 statt 100 Lebenspunkte |
| ⚡ Flinkhand | 2000 | doppelt so schnell nachladen, Magazine rasten früher ein |
| » Schnellfeuer | 2000 | +33 % Feuerrate |
| ✚ Zweites Leben | 1500 | statt zu sterben stehst du mit 60 ❤ wieder auf – eine Druckwelle wirft die Zombies um |

**Aufrüster** (⚙, 5000 Punkte): Waffe in einer Hand halten, mit der anderen Hand die Maschine greifen – die Waffe wandert hinein,
die Zahnräder drehen sich, und sie kommt **aufgerüstet** wieder heraus (★ im Namen): doppelter Schaden, 50 % mehr Munition,
höhere Feuerrate und eine **animierte Leucht-Tarnung**. Greifen = abholen.
Ohne gesetzte Plätze werden Automaten und Aufrüster automatisch an freie Wandstellen gestellt.

**Neue Zombies**
- **Platzer** (ab Welle 4): aufgebläht, leuchtende Beulen. Kommt er nah, bläht er sich auf und **explodiert** – auch wenn man ihn erschießt. Die Explosion erwischt andere Zombies. Tipp: aus der Ferne abschießen, wenn Zombies um ihn stehen!
- **Spucker** (ab Welle 5): langer Hals, leuchtender Mund. Bleibt auf Abstand stehen und **spuckt Säure im Bogen** – mit dem Kopf ausweichen! Treffer färben die Sicht grün.

**Grafik & Effekte**
- Zombies: höher aufgelöste Haut mit Relief (Poren, Adern), **leuchtende Augen** (gut im dunklen Flur zu sehen), **Einschusslöcher mit Blutspuren** bleiben am Körper
- Schwebender **Staub** im Raum, Blitz-Effekte, Sprengbolzen, Automaten mit Leuchtschildern und Lichtschein am Boden
- Neues Power-up **☠ Sofort-Tod** (20 s lang tötet jeder Treffer)

## Neu in Version 19 – Wandkäufe, Glückskiste & 12 neue Waffen

**Punkte & Einkaufen (Zombie-Modus-Stil)**
- Jede Runde startest du nur mit der **Pistole** und **500 Punkten**. Treffer, Kills, Kopfschüsse und Bretter bringen Punkte (💰 auf der Anzeigetafel und am Handgelenk).
- **Wandkäufe**: An den Stellen, die du beim Raumbau festlegst, hängt jede Runde eine **zufällige Waffe** an einer Kreidetafel. Hingreifen + Griff-Taste = kaufen (leuchtet gelb = genug Punkte, rot = zu teuer). Besitzt du die Waffe schon, kaufst du dort für den halben Preis **Munition**.
- **Glückskiste** (950 Punkte): Deckel geht auf, die Waffen wirbeln durch – am Ende liegt eine zufällige Waffe darin, die du dir greifen kannst. **Jede Waffe ist möglich**, auch die Wunderwaffe **Plasmawerfer** und das **MG-100**, die es nur hier gibt.
- **Rückenholster**: Waffe über die Schulter hinter den Kopf führen und loslassen – dort bleibt sie. Von dort jederzeit wieder greifen. So trägst du drei Waffen.
- Gekaufte Waffen, die du liegen lässt, verschwinden nach 40 s. Im Training ist alles kostenlos.
- Hast du keine Wandkauf-Plätze/Kiste gesetzt, werden sie automatisch an freien Stellen platziert.

**12 neue Waffen** (jetzt 16): Revolver .357, Magnum M50, Maschinenpistole K, Trommel-MP, Sturmgewehr AR-5 (Rotpunkt),
Kampfgewehr KG-7, Karabiner K-1, MG-100 (100 Schuss, Zweibein), Auto-Schrotflinte AS-8, Doppelflinte, Präzisionsgewehr P-10 (Zielfernrohr)
und der Plasmawerfer (explodierende Plasmakugeln). Revolver und Doppelflinte lädt man Patrone für Patrone vom Gürtel.

**Besseres Handling** (Menü → ⚙ Bedienung)
- **Laden: Einfach** – A/X lädt automatisch nach, leere Waffe + Abzug lädt nach, Pumpe/Kammerstängel repetieren von selbst. **Echt** = wie bisher alles von Hand.
- **Griff: Tippen** – Griff-Taste einmal drücken = Waffe festhalten, nochmal = loslassen (kein Dauerdrücken mehr).
- **Zielhilfe** – knapp danebengezielte Kopfschüsse (bis ca. 2,5°) treffen trotzdem, wenn freie Sicht besteht.
- Ruhigeres Zielen: Zittern wird geglättet (vor allem beidhändig und mit Zielfernrohr), ohne beim schnellen Schwenken nachzuziehen.
- Magazine und Patronen rasten schon etwas früher ein.

**Raumbau verbessert**
- Neue Werkzeuge **💰 Wandkauf** (Laser auf eine Wand) und **❓ Glückskiste** (Laser auf den Boden, ziehen = Ausrichtung).
- **💾 Räume**: 5 Speicherplätze – Räume speichern und in jeder Sitzung wieder laden.
- **🧭 Ausrichten**: Nach dem Laden eine Linie am Boden **an einer echten Wand entlang** ziehen – die Karte dreht und schiebt sich, bis die gespeicherte Wand genau darauf liegt. Eine zweite Linie an einer Querwand erledigt den Rest. Feinjustieren mit dem Stick (◀ ▶ drehen, ▲▼ schieben), Rückgängig setzt die Ausrichtung zurück.
- Wände rasten an vorhandenen **Ecken** und im **rechten Winkel** ein, beim Ziehen wird die **Länge** angezeigt.
- **✂ Löschen**: auf eine Fläche zeigen (wird rot) + Abzug.

**Grafik**
- **Echte Schatten**: Zombies, Waffen, Waffenständer und Kiste werfen Schatten auf deinen echten Boden (im Menü abschaltbar).
- Leuchtende Wandkauf-Tafeln, Lichtstrahl über der Glückskiste, Mündungsfeuer-Sterne, neue Waffenmodelle mit Rotpunkt, Zielfernrohr, Zweibein usw.

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
| 💰 Wandkauf | Laser auf eine markierte Wand + Abzug. Dort hängt jede Runde eine zufällige Waffe zum Kaufen |
| ❓ Glückskiste | Laser auf den Boden + Abzug (ziehen = Ausrichtung) |
| ✂ Löschen | Auf eine Fläche zeigen (wird rot) + Abzug |
| 🥤 Automat | Laser auf eine Wand + Abzug. Jeder neue Automat ist eine andere Sorte |
| ⚙ Aufrüster | Laser auf eine Wand + Abzug (nur einer pro Raum) |
| ⚡ Falle | Laser auf den Boden + Abzug – abwechselnd Elektro- und Feuerfalle, Hebel steht seitlich |
| 💾 Räume … | 5 Speicherplätze zum Speichern/Laden + „Letzten Raum laden“ |
| 🧭 Ausrichten | Geladene Karte an den echten Raum anlegen: Linie am Boden an einer echten Wand entlang ziehen (rastet ein), optional eine zweite an einer Querwand. Stick ◀ ▶ drehen, ▲▼ schieben |

Echte Wände und Möbel verdecken virtuelle Dinge dahinter (Zombies hinter der Wand sieht man nur durch Tür/Fenster), und Waffen, Magazine und Dosen prallen physikalisch daran ab.
Schüsse hinterlassen Einschusslöcher an den Wänden, Messer bleiben darin stecken.

## Waffen

Zu Beginn jeder Runde liegt nur die **Pistole** im Waffenständer. Alle anderen Waffen gibt es an den **Wandkäufen**
(zufällig jede Runde) oder in der **Glückskiste**. Die wichtigsten:

| Waffe | Visier | Magazin | Besonderheit |
|---|---|---|---|
| Pistole P9 | Kimme & Korn | 15 | einhändig, Schlittenfang |
| Maschinenpistole MPX | Rotpunktvisier | 30 | Sicher / Einzel / Dauerfeuer, Vordergriff |
| Pump-Flinte | Perlkorn | 6 + 1 (Röhre) | Schrot, nach jedem Schuss repetieren |
| Scharfschützengewehr | Zielfernrohr 4–12x | 5 | Kammerverschluss, sehr hoher Schaden |
| Revolver .357 / Magnum M50 | Kimme & Korn | 6 / 7 + 1 | Revolver: Patronen einzeln laden |
| MP K / Trommel-MP | offen | 25 / 50 | Dauerfeuer |
| Sturmgewehr AR-5 / Kampfgewehr KG-7 / Karabiner K-1 | Rotpunkt / offen | 30 / 20 / 30 | Einzel / Dauerfeuer |
| MG-100 | offen | 100 | nur aus der Glückskiste, Zweibein |
| Auto-Schrotflinte AS-8 / Doppelflinte | Perlkorn | 8 + 1 / 2 | Schrot |
| Präzisionsgewehr P-10 | Zielfernrohr | 10 | halbautomatisch |
| Plasmawerfer | – | – | Wunderwaffe (nur Glückskiste), explodierende Plasmakugeln |

## Steuerung (Quest-Controller)

| Aktion | So geht's |
|---|---|
| Waffe nehmen | Hingreifen + **Griff-Taste halten** (aus der Ferne: darauf zeigen + Griff-Taste → fliegt in die Hand) |
| Ablegen / Werfen | **Griff-Taste loslassen** – die Waffe fällt mit Physik, beim Loslassen in der Bewegung wird sie geworfen |
| Hand wechseln | Mit der anderen Hand an den Griff fassen; zwei Waffen gleichzeitig (eine pro Hand) gehen auch |
| Schießen | Abzug |
| Zweihändig halten | Zweite Hand an den Vorderschaft + Griff-Taste |
| Magazin auswerfen | **A / X** (mit „Laden: Einfach“: automatisch nachladen) |
| Kaufen | Hand an die Wandtafel bzw. in die Glückskiste + Griff-Taste |
| Rückenholster | Waffe über die Schulter nach hinten führen und loslassen; zum Ziehen dort greifen |
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
1–9 Waffe · Linksklick schießen / Knöpfe · rechte Maustaste ziehen = umschauen · Leertaste = Visier ·
R nachladen · V Feuermodus · F Messer werfen · G Granate · P Brett annageln · B Wandkauf · K Glückskiste · J Automat · U Aufrüster · M Trommel-Affe · T Falle · Enter Start · Mausrad Zoom.

## Technik

- Neue Version veröffentlichen: `python3 tools/version.py <Nummer>` (hängt die Versionsnummer an alle Dateien an)

- `index.html` + Module in `js/`: `main.js` (Spielablauf, Hände, Waffen-Mechanik), `weapons.js` (Modelle),
  `room.js` (Raum), `zombies.js` (Zombies, Bretter, Wegfindung mit A*), `physics.js` (cannon-es), `effects.js`, `sfx.js`, `util.js`
- [three.js](https://threejs.org/) und [cannon-es](https://github.com/pmndrs/cannon-es) über CDN
- WebXR `immersive-ar` (Passthrough) mit `plane-detection` für die Quest-Raumdaten
