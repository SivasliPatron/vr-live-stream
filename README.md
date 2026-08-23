# VR Live

Eine reine Zuschauer-Seite für einen privaten Meta-Quest-Livestream mit bis zu drei bekannten Personen.

**Zuschauer-Link:** <https://sivaslipatron.github.io/vr-live-stream/>

Die Übertragung läuft so:

```text
Meta Quest → Meta-Casting im Chrome-Tab → VDO.Ninja → GitHub-Zuschauer-Seite
```

GitHub Pages liefert nur die Website aus. Bild und Spielton werden von VDO.Ninja als direkte WebRTC-Verbindung übertragen.

## Stream starten

Die Sender-Verknüpfungen liegen nur lokal im ignorierten Ordner `.private` und werden niemals zu GitHub übertragen.

1. `01 Meta-Casting (Chrome).lnk` öffnen und bei Meta anmelden.
2. In der Quest **Kamera → Casten → Computer** auswählen.
3. Warten, bis das Quest-Bild im Meta-Casting-Tab sichtbar ist.
4. `02 VR-Stream 720p60 (Chrome).lnk` öffnen.
5. Im Chrome-Freigabedialog den **Meta-Casting-Tab** auswählen.
6. **Tab-Audio teilen** eingeschaltet lassen und die Freigabe starten.
7. Den öffentlichen GitHub-Link an die Zuschauer senden.

Bei reproduzierbaren Bild- oder Tonaussetzern den Sender beenden und mit `03 VR-Stream 720p30 (Chrome).lnk` neu starten. Beide Varianten verwenden dieselbe Stream-ID und denselben Zuschauer-Link.

## Zuschauer-Seite

Zuschauer klicken auf **Stream ansehen**. Die Seite bietet ausschließlich:

- Stream starten
- Ton an oder aus
- Vollbild
- manuelle und automatische Wiederverbindung

Die Seite fordert keine Kamera- oder Mikrofonberechtigung an und enthält weder Chat noch Senderfunktionen.

## Sicherheit und Grenzen

- Der Publisher-Token und die vollständigen Sender-Links bleiben ausschließlich im lokalen, ignorierten `.private`-Ordner.
- Im öffentlichen Repository steht nur der separate VDO.Ninja-Zuschauer-Token. Er verhindert fremdes Senden, aber nicht die Weitergabe des Zuschauer-Links.
- VDO.Ninja arbeitet überwiegend Peer-to-Peer. Dadurch können die öffentlichen IP-Adressen der beteiligten Geräte technisch sichtbar sein.
- `maxviewers=3` begrenzt Verbindungen, ist aber keine Zugangskontrolle.
- Es gibt in V1 keine Aufnahme, Anmeldung, Zuschauerverwaltung oder eigene Domain.

## Lokale Prüfung

Voraussetzung ist Node.js 22 oder neuer.

```powershell
npm test
npm run serve
```

Die lokale Vorschau ist danach unter <http://127.0.0.1:4173/vr-live-stream/> erreichbar.

## Projektstruktur

```text
docs/                 öffentliche GitHub-Pages-Website
scripts/serve.mjs     lokaler statischer Server
tests/                Struktur- und Sicherheitstests
.private/             lokale Senderdaten, durch .gitignore ausgeschlossen
```
