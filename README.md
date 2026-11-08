# 🎯 Passthrough-Schießstand (Quest 3, WebXR)

Ein Mixed-Reality-Schießspiel für die Meta Quest 3, das direkt im Browser läuft.
Die Zielscheiben schweben in deinem echten Zimmer (Passthrough), du hältst eine Pistole in der Hand
und musst sie treffen.

## Spielen

1. Die Seite muss über **HTTPS** erreichbar sein (WebXR funktioniert nicht über `http://` oder `file://`).
   Am einfachsten mit **GitHub Pages**: Repository → *Settings* → *Pages* → Branch auswählen → Speichern.
   Danach ist das Spiel unter `https://<benutzername>.github.io/<repo>/` erreichbar.
2. Die URL im **Browser der Quest 3** öffnen und auf **„START AR“** tippen.
3. Schieß auf den grünen **START**-Knopf – die Runde beginnt.

## Steuerung

| Aktion | Quest-Controller | PC (zum Testen) |
|---|---|---|
| Schießen | Abzug (Zeigefinger) | Linksklick |
| Nachladen | Griff-Taste (Mittelfinger) | `R` oder Rechtsklick |
| Pistole in andere Hand | Abzug am anderen Controller | – |
| Umschauen | Kopf bewegen | Maus ziehen |

## Regeln

- Eine Runde dauert **60 Sekunden**, es sind immer 3 Zielscheiben gleichzeitig zu sehen.
- Punkte je Ring von innen nach außen: **10 · 8 · 6 · 4 · 2**, bewegliche Scheiben geben +2 Bonus.
- Mehrere Treffer hintereinander erhöhen die **Combo** (bis x5), ein Fehlschuss setzt sie zurück.
- Mit der Zeit werden die Scheiben kleiner, weiter entfernt und bewegen sich häufiger.
- Magazin: 12 Schuss. Der Rekord wird im Browser gespeichert.

## Technik

- Eine einzige Datei: `index.html` mit [three.js](https://threejs.org/) (über CDN geladen)
- WebXR `immersive-ar` → transparenter Hintergrund = Passthrough auf der Quest 3
- Geräusche werden mit der Web Audio API erzeugt, Vibration über die Controller-Haptik

Lokal testen am PC: `python3 -m http.server` im Ordner starten und `http://localhost:8000` öffnen.
