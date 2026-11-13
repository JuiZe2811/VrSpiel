# Burg-Abwehr (Mittelalter)

Dies ist ein Ableger von **Zombie-Abwehr** für die Meta Quest 3 (WebXR mit Passthrough), angesiedelt im Mittelalter.
Raum-Einrichtung, Physik, Bewegung, Gürtel, Rückenholster, Wellen und Bestenliste stammen aus dem Hauptspiel.
Statt Zombies und Schusswaffen kämpfst du hier mit **Schwertern, Äxten, Speer und Bogen gegen Skelett-Krieger**.

Starten: Öffne `mittelalter/index.html` über denselben Webserver wie das Hauptspiel.
Bestenliste und Einstellungen sind vom Hauptspiel getrennt.
Gespeicherte Räume werden geteilt, damit du deinen Raum nicht noch einmal einrichten musst.

## Neu in Version 4 – Die Kriegerin

Statt des Trolls kommt in **Welle 8, 13, 18 …** jetzt die **Kriegerin** (dein Avatar-Modell).
- **Allein:** In ihrer Welle kommen keine anderen Gegner.
- **Wie der Boss:** Sie reißt die Bretter vom Fenster, steigt herein, brüllt und weicht Treffern mit Seitensprüngen aus. Sie klettert auf Tische und Betten, heilt sich, wenn du nachlässt, und wird bei wenig Leben wütend.
- **Nur Nahkampf** mit einem riesigen Kriegshammer, den sie über der Schulter trägt:
  - **Hammerschlag:** Sie hebt den Hammer über den Kopf und schlägt vor sich in den Boden. Ab Stufe 2 läuft dabei eine Schockwelle über den Boden.
  - **Rundumschlag:** Sie holt weit aus und schlägt waagrecht. Ducken hilft!
  - **Sturmangriff:** Sie rennt auf dich zu.
  - **Sprungschlag (ab Stufe 2):** Sie springt zu dir und landet mit einer Schockwelle.
  - **Erdbeben (ab Stufe 2):** eine Schockwelle rund um sie herum.
  - **Wirbelwind (ab Stufe 3):** Sie dreht sich mit dem Hammer.
- **Verteidigen:** Jeder Schlag ist durch das Ausholen und einen hörbaren Luftzug angekündigt. Mit dem Schild kannst du blocken, aber der schwere Hammer kostet mehr Haltbarkeit.
- **Leistung:** Das Modell wurde für die Quest verkleinert (nur Farbtexturen, 3,6 statt 4,8 MB). Es wird beim Start unsichtbar vorgewärmt, damit ihr Auftritt nicht ruckelt.
- Ihre Stufe steigt mit jedem Auftritt (Welle 8 = Stufe 1, Welle 13 = Stufe 2 …).

## Neu in Version 3 – Aufwerten ohne Nachziehen

- **Fehler behoben:** Nach dem Aufwerten in der Schmiede zog die Waffe kurz nach oder drehte sich in der Hand.
  - Die Schmiede gibt die Waffe jetzt sauber frei, auch wenn man sie mit dem Zeigestrahl heranzieht.
  - Schwung-, Flegel- und Bogen-Verlauf starten frisch.
  - Der eingelegte Pfeil wird nicht mehr mit eingefärbt.
- **Kein Ruckler mehr** beim ersten Aufwerten (Leuchtfarben werden vorab vorbereitet).

## Neu: Reines Mittelalter, Schilde und echter Schwertkampf

- **Alles Neumodische ist entfernt:**
  - keine Schusswaffen, Magazine, Patronen, Zielfernrohre und Plasma-Waffen mehr
  - kein Trommel-Affe und kein Kamera-Knopf mehr
  - keine Getränkeautomaten und kein Aufrüster mehr; der Code dafür ist gelöscht, nicht nur versteckt
- **Neue Stationen statt der Automaten:**
  - Alchemisten-Tische mit leuchtenden Tränken und Pergament-Schildern
  - eine Schmiede mit Amboss, Esse und Schleifstein zum Aufwerten
  - eine Schatztruhe mit Wappen
- **Neue Fallen:** Blitzrune (Runenkreis) und Feuergrube
- **Der Boss** ist ein Schwarzer Ritter mit Krone, Bogen und Armbrust.

## Waffen

| Waffe | Art | Besonderheit |
|---|---|---|
| Langschwert | Startwaffe (Scheide an der rechten Hüfte) | Hieb & Stich, trifft bis zu 2 Gegner |
| Kurzschwert | Wandkauf | leicht und schnell, ideal mit Schild |
| Falchion | Wandkauf | schwere Hiebklinge |
| Rapier | Wandkauf | schnelle Stiche, sehr starke Kopftreffer |
| Streitaxt | Wandkauf | bricht durch Ritter-Schilde |
| Streitkolben | Wandkauf | bricht durch Rüstung, betäubt |
| Morgenstern | Wandkauf | betäubt getroffene Gegner |
| Kriegsflegel | Wandkauf | Stachelkugel an einer Kette, die physikalisch mitschwingt |
| Kriegshammer | Wandkauf | durchschlägt jede Rüstung, wirft Gegner um |
| Speer | Wandkauf | nur Stöße zählen, durchbohrt 3 Gegner |
| Hellebarde | Wandkauf | Stangenwaffe für Hieb und Stoß, trifft 3 Gegner |
| Zweihänder | Wandkauf | trifft bis zu 4 Gegner |
| Kurzbogen / Langbogen | Wandkauf | Sehne greifen, ziehen, loslassen |
| Armbrust | Wandkauf | Sehne spannen, bis sie einrastet, dann mit dem Abzug schießen |
| Flammenschwert, Donnerhammer, Frostaxt, Frostbogen | Schatztruhe | Feuer, Blitz oder Eis |

Außerdem: **Wurfdolche** und **Brandbomben** am Gürtel.

## Schilde (zweite Hand)

| Schild | Hält | Woher |
|---|---|---|
| Holzschild | 5 Treffer | Startschild an der linken Hüfte; zerbricht er, liegt nach 20 s ein neuer bereit |
| Rundschild | 8 Treffer | Wandkauf |
| Drachenschild | 11 Treffer | Wandkauf |
| Turmschild | 16 Treffer | Wandkauf |
| Wappenschild | 13 Treffer, Stoß wirft um | Schatztruhe |

- Halte den Schild zwischen dich und den Angreifer, dann wird der Schlag geblockt.
  - Jeder Block kostet Haltbarkeit, und es entstehen sichtbare Risse.
  - Am Ende zerbricht der Schild in Splitter.
  - Der Angreifer prallt ab und taumelt.
- Auch Pfeile der Bogenschützen kannst du mit dem Schild abfangen.
- **Schildstoß:** Stößt du kräftig mit dem Schild nach vorne, wird das Skelett betäubt.
- Ein beschädigter Schild lässt sich an der Wand reparieren. Das „Volle Köcher“-Power-up repariert ebenfalls.

## Kampf wie im Mittelalter

- **Ausholen:** Skelette heben vor jedem Hieb sichtbar das Schwert über den Kopf. Etwa eine halbe Sekunde vorher siehst du den Schlag kommen.
- **Verteidigen:** Du kannst zurückweichen, mit dem Schild blocken oder mit der Klinge **parieren**.
  - Zum Parieren hältst du die Klinge quer vor den Körper.
  - Eine Parade fängt 70 % des Schadens ab und lässt den Gegner taumeln.
- **Gegenangriff:** Harte Treffer lassen Skelette taumeln und unterbrechen ihr Ausholen. Schwere Waffen werfen sie um.
- **Ritter:** Sie blocken Hiebe und Pfeile von vorne mit ihrem Schild.
  - Dagegen helfen Axt, Hammer, Kolben, Flegel oder Hellebarde, ein Angriff von der Seite oder ein Schildstoß zum Betäuben.

**Nahkampf (VR):**
- Treffer zählen nur bei einem echten Schwung. Je schneller die Klinge, desto mehr Schaden.
- Langsames Hineinhalten macht keinen Schaden.
- Jedes Skelett wird pro Schwung nur einmal getroffen.
- Kopftreffer richten mehr Schaden an.
- Zweihänder, Speer, Hellebarde und Kriegshammer kannst du mit der zweiten Hand führen.

**Bogen (VR):**
1. Halte den Bogen in einer Hand.
2. Greife mit der anderen Hand die Sehne (Griff-Taste in der Nähe der Sehne).
3. Ziehe die Sehne zurück. Der Pfeil fliegt dorthin, wohin er zwischen Sehne und Bogen zeigt.
4. Lass los.

Ein voller Auszug bringt den vollen Schaden. Nachschub an Pfeilen gibt es am Wandkauf.

**Schmiede (Aufrüsten):**
- Nahkampfwaffen: treffen mehr Gegner, ab ★★ mit brennender Klinge, ★★★ mit Blitzschlag.
- Bögen: 3 Pfeile pro Schuss und mehr Durchschlag, ab ★★ Brandpfeile, ★★★ explosive Pfeile.

**PC-Test:**
- Klick: zuschlagen
- Bogen: Maus halten zum Spannen, loslassen zum Schießen
- F: Dolch werfen
- G: Brandbombe
- Armbrust: Klick spannt bzw. schießt
- Schild: ausrüsten (Zahl), dann blockt er Angriffe von vorne; Klick ist ein Schildstoß

## Gegner

| Typ | Beschreibung |
|---|---|
| Skelett | Knochenkrieger mit rostigem Schwert, manchmal mit Wappenrock oder Helm |
| Späher | schnell, mit Kapuze |
| Ritter | gepanzert, mit Helm, Schild und Schwert, zäh |
| Kriecher | kriecht am Boden |
| Pestbringer | leuchtender Pestbeutel, explodiert in deiner Nähe |
| Bogenschütze | schießt Brandpfeile aus der Ferne (ausweichen!) |
| Kriegerin | Welle 8, 13, 18 …: kommt allein, kämpft mit einem riesigen Kriegshammer (Troll nur als Ersatz, falls das Modell fehlt) |
| Boss | jede 5. Welle, mit Bogen und Armbrust; jede Stufe bringt eine stärkere Fernwaffe |

## Tränke

- Eisenhaut
- Flinkhand (leichtere Treffer, schnellere Pfeile)
- Berserker (Treffer betäuben)
- Zweites Leben
- Doppelschlag
- Adlerauge (Kopftreffer stärker)
- Kettenhemd
- Blutdurst
- Blitzklinge (jeder 4. Treffer schleudert einen Blitz)
- Großer Köcher (50 % mehr Pfeile)

## Technik

- `js/medieval.js`: Modelle und Daten aller Waffen und Schilde.
- `js/weapons.js`: schlankes Grundgerüst für den Modellbau, dazu Dolch und Brandbombe; Schusswaffen gibt es dort nicht mehr.
- `js/main.js`: Schild-Block und Parade (`defendHit`), Schilde zerbrechen (`breakShield`), Flegel-Physik (`flailStep`), Armbrust (`xbowFire`).
- `js/main.js`: Nahkampf über Klingen-Strahlen von Bild zu Bild (`meleeUpdate`), Bogen mit Sehnen-Griff (`bowUpdate` und `bowRelease`), Pfeilflug (`updateBowArrow`).
- `js/zombies.js`: Die Skelette nutzen dieselbe Gelenk-Struktur wie die Zombies. Animationen, Trefferzonen, Klettern und abfallende Glieder funktionieren deshalb unverändert.
