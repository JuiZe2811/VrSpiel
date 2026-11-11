# Burg-Abwehr (Mittelalter)

Dies ist ein Ableger von **Zombie-Abwehr** für die Meta Quest 3 (WebXR mit Passthrough), angesiedelt im Mittelalter.
Raum-Einrichtung, Physik, Bewegung, Gürtel, Rückenholster, Wellen, Tränke, Schmiede und Bestenliste stammen aus dem Hauptspiel.
Statt Zombies und Schusswaffen kämpfst du hier mit **Schwertern, Äxten, Speer und Bogen gegen Skelett-Krieger**.

Starten: Öffne `mittelalter/index.html` über denselben Webserver wie das Hauptspiel.
Bestenliste, Einstellungen und Gesichter sind vom Hauptspiel getrennt.
Gespeicherte Räume werden geteilt, damit du deinen Raum nicht noch einmal einrichten musst.

## Waffen

| Waffe | Art | Besonderheit |
|---|---|---|
| Langschwert | Startwaffe (Scheide an der Hüfte) | Hieb & Stich, trifft bis zu 2 Gegner |
| Streitaxt | Wandkauf | wuchtige Hiebe |
| Morgenstern | Wandkauf | betäubt getroffene Gegner |
| Speer | Wandkauf | nur Stöße zählen, durchbohrt 3 Gegner, große Reichweite |
| Zweihänder | Wandkauf | trifft bis zu 4 Gegner, mit zwei Händen führen |
| Kurzbogen | Wandkauf | 30 Pfeile |
| Langbogen | Wandkauf | schneller und stärker, durchschlägt 2 Gegner |
| Flammenschwert | Schatztruhe | setzt Gegner in Brand |
| Donnerhammer | Schatztruhe | Blitze springen auf Gegner über |
| Frostbogen | Schatztruhe | Pfeile frieren Gegner ein |

Außerdem: **Wurfdolche** und **Brandbomben** am Gürtel.

**Nahkampf (VR):**
- Treffer zählen nur bei einem echten Schwung. Je schneller die Klinge, desto mehr Schaden.
- Langsames Hineinhalten macht keinen Schaden.
- Jedes Skelett wird pro Schwung nur einmal getroffen.
- Kopftreffer richten mehr Schaden an.
- Zweihänder, Speer und Hammer kannst du mit der zweiten Hand am Griff führen.

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

## Gegner

| Typ | Beschreibung |
|---|---|
| Skelett | Knochenkrieger mit rostigem Schwert, manchmal mit Wappenrock oder Helm |
| Späher | schnell, mit Kapuze |
| Ritter | gepanzert, mit Helm, Schild und Schwert, zäh |
| Kriecher | kriecht am Boden |
| Pestbringer | leuchtender Pestbeutel, explodiert in deiner Nähe |
| Bogenschütze | schießt Brandpfeile aus der Ferne (ausweichen!) |
| Troll | großes Monster in späteren Wellen |
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

- `js/medieval.js`: Modelle und Daten der Mittelalter-Waffen.
- `js/main.js`: Nahkampf über Klingen-Strahlen von Bild zu Bild (`meleeUpdate`), Bogen mit Sehnen-Griff (`bowUpdate` und `bowRelease`), Pfeilflug (`updateBowArrow`).
- `js/zombies.js`: Die Skelette nutzen dieselbe Gelenk-Struktur wie die Zombies. Animationen, Trefferzonen, Klettern und abfallende Glieder funktionieren deshalb unverändert.
