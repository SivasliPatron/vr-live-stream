# VR Live

Eine reine Zuschauer-Seite für einen privaten Meta-Quest-Livestream mit mehreren bekannten Personen.

**Zuschauer-Link:** <https://sivaslipatron.github.io/vr-live-stream/>

Die Übertragung läuft so:

```text
Meta Quest → Meta-Casting im Chrome-Tab → VDO.Ninja → GitHub-Zuschauer-Seite
```

GitHub Pages liefert nur die Website aus. Bild und Spielton werden von VDO.Ninja über WebRTC übertragen, direkt oder bei Bedarf über einen Relay-Server.

Der öffentliche Link allein reicht nicht zum Zuschauen: Für jede normale 720p/60-Sitzung wird lokal ein neuer zufälliger vierstelliger Zugangscode erzeugt. Wer den aktuellen Code kennt, kann direkt zuschauen; der Sender muss keine Anfrage bestätigen.

Die Zuschauer-Verbindung fordert 6.000 kbit/s für den bewegungsreichen 720p/60-Stream an und nutzt in unterstützten Browsern einen kleinen 200-ms-Wiedergabepuffer. Dadurch werden kurze Netzwerkschwankungen geglättet. Der erzwungene VDO-Relay-Weg kann die Videobitrate dienstseitig auf 4.000 kbit/s begrenzen; die angeforderten 6.000 kbit/s sind dort keine Zusicherung.

## Stream starten

Der lokale Projektordner heißt **VR Live** und liegt auf dem Desktop. Die Startverknüpfungen sind direkt in diesem Ordner sichtbar. Die dazugehörigen Senderdaten bleiben im ignorierten Unterordner `.private`; lokale Verknüpfungen und Senderdaten werden nicht zu GitHub übertragen.

Die Links **00, 02 und 03** verwenden seit der Startreparatur vom 13. September das lokale Node-Programm `scripts/start-stream.mjs`. Node.js muss dafür installiert bleiben. Fehler erscheinen im Startfenster und bleiben bis zur Eingabetaste sichtbar. Eine reine Installationsprüfung ohne Browserstart oder Codeänderung ist mit `node scripts/start-stream.mjs --check` möglich.

1. `01 Meta-Casting (Chrome).lnk` öffnen und bei Meta anmelden.
2. In der Quest **Kamera → Casten → Computer** auswählen.
3. Warten, bis das Quest-Bild im Meta-Casting-Tab sichtbar ist. Im **Meta-Casting-Player den Ton einschalten und die Lautstärke aufdrehen**. Prüfen, ob Spiel oder Musik bereits über den PC hörbar sind; sonst kann dieser Tab noch keinen Quest-Ton weitergeben.
4. `02 VR-Stream 720p60 (Chrome).lnk` öffnen. Dabei wird automatisch ein neuer vierstelliger Zugangscode erzeugt, in die Zwischenablage kopiert und in `AKTUELLER-ZUGANGSCODE.txt` angezeigt.
5. Im Chrome-Freigabedialog **Chrome-Tab** und darin den **Meta-Casting-Tab** auswählen.
6. **Tab-Audio teilen** ausdrücklich aktivieren und die Freigabe starten. Eine Fensterfreigabe ohne Audio überträgt nur das Bild.
7. Den öffentlichen GitHub-Link und den neuen Zugangscode nur an erlaubte Zuschauer senden.

Bei reproduzierbaren Bild- oder Tonaussetzern den Sender beenden und mit `03 VR-Stream 720p30 (Chrome).lnk` neu starten. Der Rückfall-Link verwendet denselben aktuellen Zugangscode; der normale 720p60-Link erzeugt bei jedem Start einen neuen.

## Zuschauer-Seite

Zuschauer geben nur den aktuellen vierstelligen Zugangscode ein und klicken auf **Stream ansehen**. Eine zusätzliche Bestätigung durch den Sender ist nicht erforderlich. Die Seite bietet ausschließlich:

- Stream starten
- Ton an oder aus
- Vollbild
- manuelle und automatische Wiederverbindung
- einen laufenden Verbindungsversuch abbrechen

Die Seite fordert keine Kamera- oder Mikrofonberechtigung an und enthält weder Chat noch Senderfunktionen.

**Spielton und Musik aus der Quest:** Der bewusste Klick auf **Stream ansehen** fordert jetzt auch Ton an. Die Zuschauer-Seite startet nicht mehr grundsätzlich stumm. Die Tonwahl bleibt bei automatischer Wiederverbindung, Relay-Wechsel und **Neu verbinden** erhalten. Im Vollbild gibt es ebenfalls einen Tonknopf.

Unter **Kein Spielton? → Ton erneut aktivieren** können Zuschauer die Wiedergabe erneut anfordern. Zeigt VDO.Ninja im Videobild einen Wiedergabehinweis, muss dieser je nach Browser direkt angeklickt oder angetippt werden. Browser dürfen eine solche Interaktion verlangen; die Webseite kann sie nicht erzwingen. Die Taste zeigt die gewählte Stummschaltung, nicht den Nachweis eines hörbaren Signals.

Fehlt der Ton bereits am Sender, im bestehenden VDO-Tab die Bildschirmfreigabe beenden und den Meta-Casting-Tab erneut **mit Tab-Audio** freigeben. Dadurch muss kein neuer Zugangscode erzeugt werden. Musik oder Spiele müssen zuerst im Meta-Casting-Tab ankommen. PC-Systemtöne oder ein zusätzliches Mikrofon sind nicht Teil dieser Konfiguration.

## Wenn bei einem Zuschauer nur „VERBINDEN“ steht

1. Prüfen, ob der Zuschauer wirklich den Code aus der aktuellen `AKTUELLER-ZUGANGSCODE.txt` eingegeben hat.
2. Auf dem Sender-PC alle alten VDO.Ninja-Sender-Tabs schließen und den Stream erneut mit `02 VR-Stream 720p60 (Chrome).lnk` starten. Dadurch entsteht ein neuer Code.
3. Der betroffene Zuschauer schließt alte VR-Live-Tabs und öffnet den GitHub-Link neu. Nach einer Aktualisierung hilft am PC zusätzlich `Strg+F5`, am Handy ein privater Tab.
4. Den aktuellen Code eingeben und **Stream ansehen** anklicken. Zuerst darf der externe VDO-Player bis zu 90 Sekunden laden. Erst seine erste gültige API-Antwort startet die eigentliche Verbindungsfrist von 60 Sekunden pro Netzwerkweg. Scheitert bereits das Laden, folgt kein nutzloser Relay-Wechsel. Scheitern beim ersten Beitritt beide Wege, bleibt eine verständliche Fehlermeldung mit **Erneut versuchen** stehen. So werden langsam ladende Player nicht mehr alle 25 Sekunden neu gestartet.
5. Den Link möglichst direkt in Chrome oder Edge öffnen, nicht im eingebauten Browser einer Messenger-App. Firefox und Safari funktionieren grundsätzlich, unterstützen den zusätzlichen VDO-Wiedergabepuffer aber nicht in jedem Fall.
6. Für die stabilste 720p/60-Übertragung den Sender-PC möglichst per LAN-Kabel verbinden und parallele Uploads, Cloud-Sicherungen oder VPN-Verbindungen während des Streams pausieren.

Der Browser merkt sich den zuletzt mit Videodaten bestätigten Weg für höchstens 24 Stunden. Nach einem Browserneustart wird dieser zuerst versucht; bei Misserfolg folgt auch vom Relay zurück der Direktweg. Gespeichert werden nur Verbindungsart und Ablaufzeit, kein Zugangscode. In privaten Sitzungen oder bei gesperrtem Browserspeicher bleibt die Funktion ohne Speicherung nutzbar.

Nach einem bereits bestätigten Livebild bleibt die automatische Wiederverbindung erhalten, mit Pausen von 3, 6, 12 und höchstens 20 Sekunden. Kann der externe Player selbst nicht starten, ist ein bewusster neuer Versuch nötig. Keine Zeitgrenze garantiert die Erreichbarkeit von VDO.Ninja oder des Senders. Eine sichtbare Sender-Vorschau, eine HTTP-Antwort wie „Boo!“ oder ein geöffneter WebSocket allein beweisen keinen Bildempfang beim Zuschauer.

**LIVE** erscheint erst, wenn Videodaten bestätigt sind. Leere Statistik-Einträge und das bloße Anlegen eines Videotracks reichen nicht aus. Bei einem gemeldeten Verbindungsabbruch bleiben höchstens 15 Sekunden für die interne Wiederherstellung. Neue Videodaten beenden diese Schonfrist; unveränderte Einträge verlängern sie nicht. Alte Player werden beim Wechsel stummgeschaltet und zum Auflegen aufgefordert, bevor sie entfernt werden. Beim vollständigen Schließen eines Browsers ist die Zustellung dieser Nachricht nicht garantiert.

## Sicherheit und Grenzen

- Publisher-Token, vollständige Sender-Links und aktueller Zugangscode bleiben ausschließlich im lokalen, ignorierten `.private`-Ordner.
- Im öffentlichen Repository steht nur der separate VDO.Ninja-Zuschauer-Token. Er verhindert fremdes Senden, aber nicht die Weitergabe des Zuschauer-Links.
- Der Zugangscode wird nur im Browser an VDO.Ninja übergeben und steht im URL-Fragment, das nicht an den Webserver gesendet wird.
- Vier Ziffern allein sind kein starker Schutz. Wer den aktuellen Code kennt oder errät, wird ohne manuelle Freigabe verbunden.
- Um eine Person auszuschließen, alle Sender-Tabs schließen, den 720p60-Link neu öffnen und den neuen Code nur an weiterhin erlaubte Personen senden.
- VDO.Ninja arbeitet überwiegend Peer-to-Peer. Dadurch können die öffentlichen IP-Adressen der beteiligten Geräte technisch sichtbar sein.
- Die frühere Drei-Zuschauer-Sperre wurde auf sechs gleichzeitige Verbindungsslots angehoben. Das gibt den vorgesehenen 1–3 Zuschauern Reserve für Wiederverbindungen, ohne den Sender unbegrenzt zu belasten.
- Bei schwierigen WLAN-, Mobilfunk- oder Firewall-Netzen versucht die Zuschauer-Seite automatisch beide Wege: direkt und über einen Relay-Server.
- Drei Zuschauer können zusammen rund 18 Mbit/s Video-Upload plus Reserve benötigen. Für volle 720p/60-Qualität sollte der Sender-PC deshalb stabil etwa 25 Mbit/s Upload erreichen.
- Es gibt in V1 keine Aufnahme, Benutzerkonten, dauerhafte personenbezogene Sperrliste oder eigene Domain.

## Lokale Prüfung

Voraussetzung ist Node.js 22 oder neuer.

```powershell
npm.cmd test
npm.cmd run serve
```

Die lokale Vorschau ist danach unter <http://127.0.0.1:4173/vr-live-stream/> erreichbar.

Die Server- und Modultests benötigen keine zusätzlichen Pakete. Für die Browserprüfung einmalig die Entwicklungsabhängigkeiten und Browser installieren:

```powershell
npm.cmd ci
npx.cmd playwright install chromium webkit
npm.cmd run test:browser
```

Die Browserprüfung startet einen eigenen lokalen Server auf einem freien Port. Sie prüft die tatsächliche Oberfläche in Chromium und WebKit, simuliert den eingebetteten VDO-Player und blockiert alle anderen externen Anfragen. Sie überträgt kein Bild und keinen Ton. Screenshots für 320, 390, 540, 768, 820 und 1440 Pixel Breite liegen danach im ignorierten Ordner `test-results/`.

Die lokale Betriebsprüfung läuft mit `node --test tests/launcher.test.mjs`. Sie verwendet ausschließlich temporäre Testdaten und verändert weder den aktiven Zugangscode noch bestehende Verknüpfungen. Nach einem Ordnerumzug stellt `scripts/install-launchers.ps1`, ausgeführt mit PowerShell 7, die zehn Verknüpfungen wieder her. Der Installer liest keine Senderdaten und startet keine Anwendungen.

Den dokumentierten Prüfumfang und die Änderungen vom 5. September 2026 enthält [PRUEFBERICHT.md](./PRUEFBERICHT.md). Die lokalen Prüfungen ersetzen keinen Test mit echter Quest, echtem Tab-Audio und Zuschauern über verschiedene Netze.

## Projektstruktur

```text
docs/                 öffentliche GitHub-Pages-Website
scripts/serve.mjs     lokaler statischer Server
tests/                Modul-, Struktur-, Sicherheits- und HTTP-Tests
tests/browser/        Browser-Abläufe mit simuliertem Player
.private/             lokale Senderdaten, durch .gitignore ausgeschlossen
```
