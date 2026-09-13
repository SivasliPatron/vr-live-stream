# Prüfstand des Neuaufbaus — 13.09.2026

## Sicherung und Neustart

- Altbestand vollständig in `C:\Users\WaitU\Desktop\VR Live - Sicherung 20260913-Neustart` verschoben: 412 Dateien einschließlich `.git`, `.private`, unversionierter Dateien und alter Verknüpfungen per SHA-256 abgeglichen.
- Der ursprüngliche Projektordner war danach leer. Anwendung, Oberfläche, Startskripte und Tests wurden neu geschrieben.
- Ein separater Lösch-Commit entfernt alle 28 alten versionierten Dateien. Der Neuaufbau folgt als neuer Commit. Repository, `main`, Git-Verlauf und Pages-Adresse bleiben erhalten; kein Force-Push.
- Neue Stream-Kennung und getrennte Sender-/Zuschauer-Schlüssel, keine Übernahme der alten Senderidentität.

## Lokale Prüfung

- **14/14 Node-Prüfungen bestanden:** URL-Rollen, vierstellige Codes, Initialisierung, Schlüsseltrennung, Video-Metriken, PIN-Wechsel/30-FPS-Fallback, Start-Rollback, Sperrdatei sowie Vorschau-Unterpfade und unzulässige Anfragen.
- **15/15 Browser-Prüfungen bestanden:** Chrome, simulierte VDO.Ninja-Antworten, Ein-Klick-Start, keine Kamera-/Mikrofonfreigabe, sichere Nachrichtenherkunft, Offline/Online, verspätetes Video, eingefrorene Statistikwerte, kein Player-Neuladezyklus, explizites Beenden, Wiederaufnahme und Vollbild.
- Native Chrome-Vollbildfunktion und simulierte Verweigerung/hängende Vollbild-API geprüft.
- Ansichten bei 320, 390, 768 und 1440 Pixeln ohne horizontalen Überlauf; Desktop- und Mobilansicht anhand von Screenshots geprüft.
- Fünf Windows-Verknüpfungen erstellt und ihre Ziele/Argumente überprüft. `node scripts/host.mjs --check` bestätigt Chrome und lokale Senderdaten, ohne einen Sender zu starten oder den Code zu ändern.
- Abhängigkeitsprüfung: keine gemeldeten Schwachstellen zum Prüfzeitpunkt. Kein allgemeiner Sicherheitsnachweis.
- Symlink-Ausbruch ist im Vorschau-Code durch kanonischen Pfadvergleich abgefangen; der Symlink-Untertest konnte ohne Windows-Symlink-Berechtigung nicht ausgeführt werden. Übrige Pfadtests bestanden.

Diese lokalen Browser-Prüfungen simulieren den fremden Videodienst. Sie allein beweisen **keine** Internetübertragung.

## Echte Dienst- und Medienprüfungen

- Neuer Audience-Publisher-WebSocket geöffnet. Nach einer Seed-Nachricht kam ein Zuschauer-Token zurück, der mit dem getrennten HTTP-Token übereinstimmte. Es wurde dabei keine physische Aufnahme gestartet.
- Zusätzlich ein eigens erzeugtes 1280×720-Canvas-Testbild und eine künstliche Audiospur über VDO.Ninja übertragen. Kamera, Mikrofon und echter Desktop wurden im Test nicht erfasst.
- Zwei erfolgreiche Ende-zu-Ende-Durchläufe vor der abschließenden Konfigurationsprüfung: erster Bildempfang nach rund **10 Sekunden** beziehungsweise **48 Sekunden**.
- Im längeren Durchlauf: nach der Anlaufphase **1280×720**, laufende Wiedergabe, **1214 Videoframes** bei ungefähr **21 Sekunden Medienzeit**, eine empfangene Audiospur. Das belegt eine echte synthetische Übertragung auf diesem PC; es bestätigt weder hörbaren Quest-Spielton noch die Belastbarkeit fremder Netze.
- Der langsamere Durchlauf zeigte zunächst einen erfolglosen Zuschauer-WebSocket und danach eine erfolgreiche neue Verbindung. Andere frühe Versuche scheiterten bereits beim Sender-Start; auch die Testautomation musste an die animierte Sender-Schaltfläche angepasst werden. Alle Zeitangaben sind Einzelmessungen, kein Leistungsversprechen.
- Ein Vergleich mit `https://vdo.ninja/` scheiterte hier mit `ERR_TIMED_OUT` beim Seitenabruf. Deshalb kein ungeprüfter Wechsel zum Hauptserver.
- Der aktuelle Viewer fordert zusätzlich die allgemeine Video-Bitrate und 100-Prozent-Skalierung an, damit die Player-Fenstergröße keine zusätzliche Auflösungsreduktion anfordert. Browser-/Netzwerkanpassung bleibt möglich.
- Ein späterer Durchlauf lieferte laufendes 720p-Video, während die Anzeige noch wartete. Die Statusauswertung berücksichtigt jetzt, dass VDO seinen alten `_framesDecoded`-Zähler bei vorhandenen nativen FPS nicht zwingend weiter aktualisiert: frische FPS mit fortschreitendem Zeitstempel haben Vorrang. Beide Regressionstests bestehen; zwischengespeicherte FPS allein zählen weiterhin nicht als Fortschritt.
- **Abschließender echter Test mit der korrigierten Version erfolgreich:** LIVE nach **6027 ms**, danach **1280×720**, **1195 Videoframes** bei **20,918 Sekunden Medienzeit**, laufende Wiedergabe und eine empfangene Audiospur. Die tatsächlichen VDO-Messwerte enthielten gleichzeitig einen alten `_framesDecoded: 1` und frische `FPS: 61`; der neue Auswertungspfad wurde dadurch auch mit echten Dienstwerten bestätigt. Sender-/Zuschauer-Token sowie angeforderte Stream-Kennung stimmten überein.

**Offene Einschränkung:** Der Neuaufbau beseitigt nicht nachweislich die schwankende Erreichbarkeit des externen Verbindungsdienstes. Keine Zusage für eine kurze Verbindungszeit, konstante 60 FPS oder ruckelfreies Streaming mit mehr als drei Zuschauern. GitHub Pages betreibt keinen eigenen Video-Verteiler.

## Noch gemeinsam mit echter Hardware prüfen

1. Alte Sender-Tabs schließen, Meta-Casting starten, Bild und Spielton lokal prüfen.
2. Über die neue 02-Verknüpfung senden; aktuellen Code auf einem zweiten Gerät eingeben.
3. Bild, hörbaren Spielton, Ton-Steuerung, Vollbild und Sender-Abbruch/Wiederkehr prüfen.
4. Mit einem Zuschauer beginnen, danach nacheinander weitere Zuschauer zuschalten. Tatsächliche Verbindungszeit und Sender-Upload beobachten.
5. Normalen Neustart mit neuem Code und den 720p30-Fallback mit unverändertem Code prüfen.

Öffentliche HTTPS-Auslieferung und Pages-Build werden nach dem Push separat kontrolliert. Eine erfolgreiche Veröffentlichung ist kein Ersatz für diese Hardware-Prüfung.
