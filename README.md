# VR Live

Eine reine Zuschauer-Seite für einen privaten Meta-Quest-Livestream mit mehreren bekannten Personen.

**Zuschauer-Link:** <https://sivaslipatron.github.io/vr-live-stream/>

Die Übertragung läuft so:

```text
Meta Quest → Meta-Casting im Chrome-Tab → VDO.Ninja → GitHub-Zuschauer-Seite
```

GitHub Pages liefert nur die Website aus. Bild und Spielton werden von VDO.Ninja als direkte WebRTC-Verbindung übertragen.

Die Zuschauer-Verbindung fordert 6.000 kbit/s für den bewegungsreichen 720p/60-Stream an und nutzt in unterstützten Browsern einen kleinen 200-ms-Wiedergabepuffer. Dadurch werden kurze Netzwerkschwankungen geglättet, ohne Auflösung oder Bildrate absichtlich zu reduzieren.

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

## Wenn bei einem Zuschauer nur „VERBINDEN“ steht

1. Auf dem Sender-PC alle alten VDO.Ninja-Sender-Tabs schließen und den Stream erneut mit `02 VR-Stream 720p60 (Chrome).lnk` starten.
2. Der betroffene Zuschauer schließt alle alten VR-Live-Tabs und öffnet den GitHub-Link neu. Nach einer Aktualisierung hilft am PC zusätzlich `Strg+F5`, am Handy ein privater Tab.
3. **Stream ansehen** anklicken und bis zu 65 Sekunden warten. Scheitert der Direktweg, probiert die Seite automatisch die Relay-Kompatibilitätsverbindung.
4. Den Link möglichst direkt in Chrome oder Edge öffnen, nicht im eingebauten Browser einer Messenger-App. Firefox und Safari funktionieren grundsätzlich, unterstützen den zusätzlichen VDO-Wiedergabepuffer aber nicht in jedem Fall.
5. Für die stabilste 720p/60-Übertragung den Sender-PC möglichst per LAN-Kabel verbinden und parallele Uploads, Cloud-Sicherungen oder VPN-Verbindungen während des Streams pausieren.

## Sicherheit und Grenzen

- Der Publisher-Token und die vollständigen Sender-Links bleiben ausschließlich im lokalen, ignorierten `.private`-Ordner.
- Im öffentlichen Repository steht nur der separate VDO.Ninja-Zuschauer-Token. Er verhindert fremdes Senden, aber nicht die Weitergabe des Zuschauer-Links.
- VDO.Ninja arbeitet überwiegend Peer-to-Peer. Dadurch können die öffentlichen IP-Adressen der beteiligten Geräte technisch sichtbar sein.
- Die frühere Drei-Zuschauer-Sperre wurde auf sechs gleichzeitige Verbindungsslots angehoben. Das gibt den vorgesehenen 1–3 Zuschauern Reserve für Wiederverbindungen, ohne den Sender unbegrenzt zu belasten.
- Bei schwierigen WLAN-, Mobilfunk- oder Firewall-Netzen versucht die Zuschauer-Seite nach dem Direktweg automatisch eine Relay-Kompatibilitätsverbindung.
- Drei Zuschauer können zusammen rund 18 Mbit/s Video-Upload plus Reserve benötigen. Für volle 720p/60-Qualität sollte der Sender-PC deshalb stabil etwa 25 Mbit/s Upload erreichen.
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
