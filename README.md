# VR Live — Neuaufbau

Deutsche Zuschauer-Seite für einen Meta-Quest-Stream, ohne Anmeldung, Chat, Kamera- oder Mikrofonfreigabe beim Zuschauer.

**Zuschauer-Link:** [sivaslipatron.github.io/vr-live-stream](https://sivaslipatron.github.io/vr-live-stream/)

## Auf deinem PC starten

Der neue Ordner liegt unter `C:\Users\WaitU\Desktop\VR Live`.

1. Alle alten VDO.Ninja-Sender-Tabs schließen. Verknüpfungen aus der Sicherung nicht mehr benutzen.
2. **01 Meta-Casting** öffnen. Mit deinem Meta-Konto anmelden und die Quest auf Web/Computer übertragen. Quest und PC müssen für Meta-Casting im passenden lokalen Netzwerk sein.
3. **02 VR-Stream 720p60** öffnen. Bei jedem Aufruf entsteht ein neuer zufälliger vierstelliger Code; er wird im Editor angezeigt.
4. Im VDO.Ninja-Fenster **Select screen to share** wählen. Den **Meta-Casting-Tab**, nicht den gesamten Bildschirm, auswählen und **Tab-Audio teilen** aktivieren.
5. Den Zuschauer-Link und den aktuellen Code privat an deine Zuschauer geben. Sie geben nur den Code ein und drücken **Stream ansehen**. Du musst niemanden annehmen.

**00 Zugangscode anzeigen** zeigt den bestehenden Code, ohne ihn zu ändern. **04 Zuschauer-Seite** öffnet die öffentliche Seite.

Bei Rucklern zuerst mit nur einem Zuschauer prüfen. Für den vorbereiteten **720p30-Fallback** den aktuellen Sender schließen, dann **03 VR-Stream 720p30** öffnen und den Casting-Tab erneut teilen. Dabei bleibt der Code gleich. Die Auflösung wird weiterhin als 720p angefordert; 30 FPS bedeutet weniger flüssige Bewegung als 60 FPS.

Beenden: Tab-Freigabe stoppen und den Sender-Tab schließen. Um jemandem den weiteren Zugang zu entziehen, **alle bisherigen Sender schließen**, anschließend über 02 neu starten und den neuen Code nur den gewünschten Personen geben. Es gibt keine individuelle Sperrliste; jemand mit dem neuen Code kann weiterhin zuschauen.

## Was die neue Seite macht

- Großer Status: Offline → Player lädt → Verbinden → Live. Live erfordert eingehende Video-Metriken, nicht bloß eine offene Webseite.
- Eine Player-Instanz pro Start. Keine automatische Schleife, die den ganzen Player während des Verbindungsaufbaus neu lädt.
- Wiederherstellung über VDO.Ninja; bei Videostillstand ein zusätzlicher Keyframe-Versuch. **Neu verbinden** startet auf Wunsch einen neuen Versuch. **Beenden** bleibt beendet, auch nach Rückkehr des Internets.
- Native Vollbildfunktion mit Fenster-Vollbild als Ausweichlösung und sichtbarem Schließen-Knopf.
- Keine eigene zusätzliche Klickfläche vor dem Videobild. Browser können trotzdem Ton-Autoplay blockieren; dann den sichtbaren Wiedergabeknopf im Player oder die Ton-Steuerung benutzen. Eine Browser-Freigabe lässt sich nicht zuverlässig umgehen.
- Der Code wird nicht in Browser-Speichern oder der URL der GitHub-Seite abgelegt. An VDO.Ninja wird er im URL-Fragment für dessen Passwort-Funktion übergeben.

## Verbindung und Qualitätsgrenzen

`Quest → Meta-Casting in Chrome → VDO.Ninja → Zuschauer`

GitHub Pages liefert nur die Oberfläche aus und verteilt **nicht** den Videostream. Das ist überwiegend Peer-to-Peer: mehr Zuschauer bedeuten mehr Upload und möglicherweise mehr Encoderlast am Sender. Bei einem Ziel von 6 Mbit/s pro Zuschauer wären vier Zuschauer ungefähr 24 Mbit/s und sechs ungefähr 36 Mbit/s zuzüglich Protokoll-Overhead. Das sind Rechenbeispiele, keine gemessene oder garantierte Bandbreite. Der Sender erlaubt maximal sechs Zuschauer.

Beide Seiten verwenden denselben offiziellen [VDO.Ninja-GitHub-Mirror](https://steveseguin.github.io/vdo.ninja/), denselben Passwort-Salt und einen expliziten öffentlichen TLS-TURN-Fallback. Der feste Relay-Eintrag vermeidet den beim bisherigen Aufbau beobachteten Wartepfad beim Laden der TURN-Liste. Direkte Verbindungen bleiben möglich. Ein Relay ist kein Verteiler für beliebig viele Zuschauer und kann selbst ausfallen.

Die angeforderten Werte sind 720p, 60 FPS, bewegungsoptimiertes Bild, Stereo-Tab-Audio, 6 Mbit/s Zuschauer-Zielrate und 500 ms Wiedergabepuffer. Eine zusätzliche Verkleinerung nur wegen der Player-Fenstergröße ist deaktiviert (`scale=100`). Der größere Puffer kann kurze Schwankungen abfangen, erhöht aber die Verzögerung. Browser, Quelle und Netzwerk bestimmen die tatsächlichen Werte; weder ein Puffer noch neuer Code garantieren ruckelfreies 720p60 bei zu wenig Upload.

## Zugang und Datenschutz

- Die zufällige Stream-Kennung und die Audience-Schlüssel wurden beim Neuaufbau neu erstellt. Alte Senderlinks gehören zur alten Version.
- Öffentlich ist nur der **Zuschauer-Schlüssel** in `docs/channel.js`. Der getrennte Sender-Schlüssel liegt ausschließlich unter `.private/` und wird nicht veröffentlicht.
- Ein vierstelliger Code hat nur **10.000 Möglichkeiten**. Er ist eine einfache Zugangshürde, keine starke Absicherung gegen gezieltes Erraten. GitHub Pages bietet hier keine serverseitige Versuchssperre. Der Audience-Schlüssel schützt das Senden, nicht das Zuschauen.
- Neue Codes beenden keinen weiter geöffneten alten Sender. Deshalb vor einem Codewechsel die alten Sender-Tabs schließen.
- VDO.Ninja und dessen Verbindungsdienste werden verwendet. Beteiligte IP-Adressen können technisch sichtbar sein. Keine eigene Aufnahme, aber Zuschauer können selbst Bildschirmaufnahmen machen.
- `.gitignore` schützt vor versehentlichen Git-Uploads, nicht vor anderen lokalen Windows-Benutzern. Den Ordner `.private` und die lokale Sicherung nicht weitergeben.

## Entwicklung / erneute Einrichtung

Voraussetzungen: Node.js ab Version 22, Google Chrome, für Windows-Verknüpfungen PowerShell.

```text
npm ci
npm test
npm run test:browser
npm start
```

Die lokale Vorschau gibt ihre Adresse aus und liefert nur öffentliche Dateien aus `docs/`. Sie ist kein Sender und keine Freigabe deines Computers im Internet.

Nur auf einem frisch eingerichteten PC oder zur Reparatur fehlender Konfiguration:

```text
npm run setup
pwsh -File scripts/shortcuts.ps1
node scripts/host.mjs --check
```

`setup` legt lokale Schlüssel an, holt den getrennten Zuschauer-Schlüssel vom offiziellen Audience-Dienst und schreibt die öffentliche Konfiguration. Eine bestehende lokale Identität bleibt dabei erhalten. Wird eine neue Identität erzeugt, muss `docs/channel.js` erneut veröffentlicht werden. Normale Codewechsel benötigen keinen GitHub-Upload.

`scripts/check-service.mjs` ist ein **bewusster Diensttest**, der die neue Sender-Identität kurz am Audience-Dienst anmeldet und die Schlüssel-Paarung prüft. `scripts/check-media.mjs` veröffentlicht bei ausdrücklichem Aufruf ein **künstliches Testbild und einen synthetischen Ton** über dieselbe Identität. Nur ausführen, wenn der echte Sender geschlossen ist. Diese Prüfungen gehören nicht zu `npm test` und verwenden keine physischen Aufnahmegeräte.

Falls ein abgebrochener Start eine `.private/host.lock` hinterlässt: zuerst prüfen, dass kein Sender-Startprozess mehr läuft, dann ausschließlich diese Lock-Datei entfernen. Die Datei `session.json` nicht löschen.

## Veröffentlichung und Sicherung

GitHub Pages bleibt auf **main / docs**. Nur `docs/` wird als Webseite ausgeliefert. Neue Programmdateien ersetzen die alte aktuelle Version; der Git-Verlauf bleibt zur Wiederherstellung erhalten. Kein Force-Push und kein Löschen des Repositorys.

Die vollständige lokale Altversion einschließlich privater Daten und Git-Verlauf wurde vor dem Neuaufbau nach `C:\Users\WaitU\Desktop\VR Live - Sicherung 20260913-Neustart` verschoben und anhand von 412 Datei-Hashes geprüft. Sie liegt außerhalb dieses Repositorys und wird nicht hochgeladen.

Prüfstand und verbleibende Hardware-Tests stehen in [PRUEFUNG.md](PRUEFUNG.md).

## Grundlagen

- [Meta: Quest-Casting](https://www.meta.com/en-gb/help/quest/192719842695017/)
- [VDO.Ninja: Audience-Schlüssel](https://docs.vdo.ninja/advanced-settings/setup-parameters/and-audience)
- [VDO.Ninja: Iframe-API](https://docs.vdo.ninja/guides/iframe-api-documentation)
- [VDO.Ninja: Einbettung und Wiedergabe](https://docs.vdo.ninja/guides/how-to-use-vdo.ninja-on-a-website)
- [VDO.Ninja: Quellcode und Architektur](https://github.com/steveseguin/vdo.ninja)
