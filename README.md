# VR Live

Eine reine Zuschauer-Seite für einen privaten Meta-Quest-Livestream mit mehreren bekannten Personen.

**Zuschauer-Link:** <https://sivaslipatron.github.io/vr-live-stream/>

Die Übertragung läuft so:

```text
Meta Quest → Meta-Casting im Chrome-Tab → VDO.Ninja → GitHub-Zuschauer-Seite
```

GitHub Pages liefert nur die Website aus. Bild und Spielton werden von VDO.Ninja als direkte WebRTC-Verbindung übertragen.

Der öffentliche Link allein reicht nicht zum Zuschauen: Für jede normale 720p/60-Sitzung wird lokal ein neuer zufälliger vierstelliger Zugangscode erzeugt. Wer den aktuellen Code kennt, kann direkt zuschauen; der Sender muss keine Anfrage bestätigen.

Die Zuschauer-Verbindung fordert 6.000 kbit/s für den bewegungsreichen 720p/60-Stream an und nutzt in unterstützten Browsern einen kleinen 200-ms-Wiedergabepuffer. Dadurch werden kurze Netzwerkschwankungen geglättet, ohne Auflösung oder Bildrate absichtlich zu reduzieren.

## Stream starten

Der lokale Projektordner heißt **VR Live** und liegt auf dem Desktop. Die Startverknüpfungen sind direkt in diesem Ordner sichtbar. Die dazugehörigen Senderdaten bleiben im ignorierten Unterordner `.private`; lokale Verknüpfungen und Senderdaten werden nicht zu GitHub übertragen.

1. `01 Meta-Casting (Chrome).lnk` öffnen und bei Meta anmelden.
2. In der Quest **Kamera → Casten → Computer** auswählen.
3. Warten, bis das Quest-Bild im Meta-Casting-Tab sichtbar ist.
4. `02 VR-Stream 720p60 (Chrome).lnk` öffnen. Dabei wird automatisch ein neuer vierstelliger Zugangscode erzeugt, in die Zwischenablage kopiert und in `AKTUELLER-ZUGANGSCODE.txt` angezeigt.
5. Im Chrome-Freigabedialog den **Meta-Casting-Tab** auswählen.
6. **Tab-Audio teilen** eingeschaltet lassen und die Freigabe starten.
7. Den öffentlichen GitHub-Link und den neuen Zugangscode nur an erlaubte Zuschauer senden.

Bei reproduzierbaren Bild- oder Tonaussetzern den Sender beenden und mit `03 VR-Stream 720p30 (Chrome).lnk` neu starten. Der Rückfall-Link verwendet denselben aktuellen Zugangscode; der normale 720p60-Link erzeugt bei jedem Start einen neuen.

## Zuschauer-Seite

Zuschauer geben nur den aktuellen vierstelligen Zugangscode ein und klicken auf **Stream ansehen**. Eine zusätzliche Bestätigung durch den Sender ist nicht erforderlich. Die Seite bietet ausschließlich:

- Stream starten
- Ton an oder aus
- Vollbild
- manuelle und automatische Wiederverbindung

Die Seite fordert keine Kamera- oder Mikrofonberechtigung an und enthält weder Chat noch Senderfunktionen.

## Wenn bei einem Zuschauer nur „VERBINDEN“ steht

1. Prüfen, ob der Zuschauer wirklich den Code aus der aktuellen `AKTUELLER-ZUGANGSCODE.txt` eingegeben hat.
2. Auf dem Sender-PC alle alten VDO.Ninja-Sender-Tabs schließen und den Stream erneut mit `02 VR-Stream 720p60 (Chrome).lnk` starten. Dadurch entsteht ein neuer Code.
3. Der betroffene Zuschauer schließt alte VR-Live-Tabs und öffnet den GitHub-Link neu. Nach einer Aktualisierung hilft am PC zusätzlich `Strg+F5`, am Handy ein privater Tab.
4. Den neuen Code eingeben und **Stream ansehen** anklicken. Jeder Verbindungsweg kann bis zu 65 Sekunden benötigen; mit automatischem Relay-Rückfall sind in schwierigen Netzen insgesamt bis zu etwa 130 Sekunden möglich.
5. Den Link möglichst direkt in Chrome oder Edge öffnen, nicht im eingebauten Browser einer Messenger-App. Firefox und Safari funktionieren grundsätzlich, unterstützen den zusätzlichen VDO-Wiedergabepuffer aber nicht in jedem Fall.
6. Für die stabilste 720p/60-Übertragung den Sender-PC möglichst per LAN-Kabel verbinden und parallele Uploads, Cloud-Sicherungen oder VPN-Verbindungen während des Streams pausieren.

## Sicherheit und Grenzen

- Publisher-Token, vollständige Sender-Links und aktueller Zugangscode bleiben ausschließlich im lokalen, ignorierten `.private`-Ordner.
- Im öffentlichen Repository steht nur der separate VDO.Ninja-Zuschauer-Token. Er verhindert fremdes Senden, aber nicht die Weitergabe des Zuschauer-Links.
- Der Zugangscode wird nur im Browser an VDO.Ninja übergeben und steht im URL-Fragment, das nicht an den Webserver gesendet wird.
- Vier Ziffern allein sind kein starker Schutz. Wer den aktuellen Code kennt oder errät, wird ohne manuelle Freigabe verbunden.
- Um eine Person auszuschließen, alle Sender-Tabs schließen, den 720p60-Link neu öffnen und den neuen Code nur an weiterhin erlaubte Personen senden.
- VDO.Ninja arbeitet überwiegend Peer-to-Peer. Dadurch können die öffentlichen IP-Adressen der beteiligten Geräte technisch sichtbar sein.
- Die frühere Drei-Zuschauer-Sperre wurde auf sechs gleichzeitige Verbindungsslots angehoben. Das gibt den vorgesehenen 1–3 Zuschauern Reserve für Wiederverbindungen, ohne den Sender unbegrenzt zu belasten.
- Bei schwierigen WLAN-, Mobilfunk- oder Firewall-Netzen versucht die Zuschauer-Seite nach dem Direktweg automatisch eine Relay-Kompatibilitätsverbindung.
- Drei Zuschauer können zusammen rund 18 Mbit/s Video-Upload plus Reserve benötigen. Für volle 720p/60-Qualität sollte der Sender-PC deshalb stabil etwa 25 Mbit/s Upload erreichen.
- Es gibt in V1 keine Aufnahme, Benutzerkonten, dauerhafte personenbezogene Sperrliste oder eigene Domain.

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
