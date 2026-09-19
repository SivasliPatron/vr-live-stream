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

## Ergänzung: echtes Vollbild

- Der Nutzer bestätigt den funktionierenden Stream. Sender, Stream-Konfiguration und Zugangscode bleiben bei dieser Änderung unangetastet; keine erneute Verbindung mit dem echten Sender für diese Prüfung.
- CSS-Fenstervergrößerung entfernt. Der Klick fordert natives Vollbild mit `navigationUI: "hide"` an; tatsächlicher Browserzustand und Vollbild-Ereignisse entscheiden über Erfolg. Bei fehlender Unterstützung oder Ablehnung bleibt ein eigener Hinweis sichtbar.
- Vollbild, das im eingebetteten Player begonnen wird, wird nicht mehr sofort von der Zuschauer-Seite beendet. Stop, verspätete Antworten, Zeitüberschreitungen und prefixed APIs sind abgesichert.
- 22 Browser-Prüfungen und 14 Node-Prüfungen bestanden. Natives Vollbild des äußeren Players inklusive vollständiger Viewport-Fläche sowie direkt im Iframe begonnenes Vollbild wurden in installiertem Chrome (headless, simulierter Videodienst) geprüft. Keine Behauptung einer Prüfung im gerade geöffneten Vorschaufenster oder auf einem Smartphone.
- Ein zusätzlicher Versuch mit zwei übereinanderliegenden nativen Vollbild-Ebenen konnte in headless Chrome nicht vollständig bestätigt werden: Das innere Dokument meldete keinen eigenen Vollbildzustand. Die zugehörigen verschachtelten Zustandswechsel wurden separat mit simulierten Ereignissen geprüft.
- Browser oder einbettende Anwendungen können echtes Vollbild sperren. Diese Berechtigung wird nicht umgangen; der Hinweis empfiehlt den Zuschauer-Link direkt in Chrome oder Edge. Hintergrund: [Fullscreen API](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen).

## Ergänzung: iPhone / Safari

- Browser mit nativer `HTMLVideoElement.webkitEnterFullscreen`-API erhalten im Zuschauer-Iframe `videocontrols`. Die offizielle [VDO-Dokumentation](https://docs.vdo.ninja/advanced-settings/buttons-and-control-bar-parameters/and-videocontrols) beschreibt damit den Zugang zu mobilem Vollbild; die aktuelle Mirror-Implementierung setzt die nativen Video-Controls auch zusammen mit `cleanoutput`.
- Fehlt Container-Vollbild, ersetzt eine sichtbare Anleitung den äußeren Vollbild-Knopf: ins laufende Video tippen, natives Vollbild-Symbol wählen, mit „Fertig“ zurück. Keine Umleitung auf eine andere Webseite und keine erneute Stream-Verbindung für Vollbild. Kein vorgetäuschter Vollbildstatus.
- Der direkte Tap im Video ist bewusst erforderlich: Die Benutzeraktivierung der Elternseite wird nicht an fremde Iframes weitergegeben. [WebKit-Erklärung](https://webkit.org/blog/13862/the-user-activation-api/). `fullscreenbutton` wird nicht verwendet, weil dessen Seiten-Vollbildmodus laut VDO-Dokumentation iPhone nicht unterstützt.
- **15 Node-Tests, 25 Chrome-Browser-Tests und 1 zusätzlicher WebKit-Touch-Test bestanden.** Die drei neuen Chrome-Fälle simulieren Video-only-, kombinierte und abgelehnte Container-Vollbildfähigkeiten. Der WebKit-Test prüft Start, Zuschauerberechtigungen, capability-basierte URL, Hoch-/Querformat, Ton-Schaltfläche und Beenden mit simuliertem Videodienst. Browser-Testbilder und lokale Beispieldaten werden nicht veröffentlicht.
- **Nicht auf einem physischen iPhone getestet:** native Safari-/AVKit-Vollbildansicht, echter Videoempfang und hörbarer Spielton bleiben vom Nutzer auf seinem Gerät zu bestätigen. WebKit mit iPhone-Profil auf Windows ist kein iOS-Gerät. Keine Codec-/Transportänderung und keine Zusage für eine bestimmte iOS-Version oder jedes eingebettete App-Fenster.
- Sender, privater Zugangscode und Stream-Identität unangetastet. Alle Sender-URL-Parameter bleiben gleich; die neue Option betrifft ausschließlich die Zuschauer-Videosteuerung. Keine Verbindung mit dem laufenden Sender während dieser Änderung.

## Ergänzung: iPhone bleibt bei „Verbinden“ — 20.09.2026

- Der Nutzer bestätigt ein laufendes Quest-Vorschaubild im PC-Sender, während das iPhone nach der Codeeingabe bei „Verbinden“ bleibt.
- Ein konkreter Wiedergabefehler ist lokal korrigiert: Zuschauer-URLs verwenden `cleanish` statt `cleanoutput`. Laut [VDO-Dokumentation](https://docs.vdo.ninja/advanced-settings/design-parameters/cleanish) bleibt damit der Play-Knopf für eine erforderliche Benutzeraktion erhalten. Der bisherige Parameter unterdrückt diese Wiederaufnahme. Die native Safari-Videosteuerung bleibt erhalten.
- Die Seite erklärt den Tap **direkt im Videobild**. Die äußere Ton-Schaltfläche behauptet nicht mehr, die Wiedergabe freizugeben. Hinweise bei fehlendem Empfang nennen den aktuellen Sender-Code und die Tab-Freigabe, ohne den Player neu zu laden.
- **16 Node-Tests, 25 Chrome-Tests und 2 WebKit-Touch-Tests bestanden.** Der neue WebKit-Fall prüft mit simuliertem Videodienst: Play bleibt nach 64 Sekunden Wartezeit erreichbar, der direkte Tap führt nach Video-Statistiken zu LIVE, und es entsteht keine zweite Player-Instanz. Dies ist ein Interaktionstest, kein Nachweis echter iOS-Medienwiedergabe.
- Ein separater, ausschließlich empfangender Chrome-Versuch nutzte die aktuelle lokale Stream-Identität und den aktuellen Code. Über 80 Sekunden entstand kein Videoelement. Der Audience-WebSocket öffnete sich und versandte eine `play`-Anfrage, erhielt aber keine Antwort; keine fehlgeschlagenen Seitenanfragen wurden registriert. Kamera, Mikrofon und Bildschirmaufnahme waren in diesem Test deaktiviert. Nur der eigene Test-Zuschauer wurde anschließend beendet.
- Dieser Empfangsversuch belegt ein zusätzliches Verbindungsproblem und lässt sich nicht allein durch blockiertes Safari-Autoplay erklären. Er unterscheidet nicht sicher zwischen einem alten Sender-Code, fehlender Sender-Anmeldung und einem externen Dienstproblem. Öffentliche Stream-Identität und der vom Audience-Dienst zurückgegebene Zuschauer-Schlüssel stimmen mit der lokalen Konfiguration überein.
- Sender-Parameter, privater Code und Stream-Identität wurden nicht geändert. Ein erfolgreicher Empfang auf dem physischen iPhone und hörbarer Quest-Spielton sind weiter zu bestätigen; die lokalen Prüfungen belegen das nicht.

## Weitere Verbindungsprüfung — 20.09.2026

- Alle Projektdateien und die aktuellen VDO-Protokollpfade erneut geprüft. Die Windows-Verknüpfungen verwenden den aktuellen Launcher. Lokale und öffentlich ausgelieferte Stream-Identität, Audience-Schlüssel und Codeanzeige stimmen überein; private Werte werden nicht protokolliert.
- **Reproduzierter Senderfehler:** VDOs `updateURL`/`changeParam` kürzt die Senderadresse von `#password=…` auf `#password`. Beim ersten Laden stimmt der intern gelesene Code noch; beim anschließenden Neuladen stimmt er nicht mehr. Genau der verkürzte Fragmentteil erscheint auch in der vom Nutzer gelieferten Konsolenausgabe. Die Warnungen zu `unload` und `slider-vertical` betreffen andere Funktionen.
- **Korrektur:** Gemeinsame Stream-URLs enthalten jetzt `nohistory`. Im echten VDO-Mirror mit separater Testidentität überprüft: Fragment und interner Passwortwert bleiben vor und nach Neuladen korrekt. Kein echter Bildschirm und keine physischen Aufnahmegeräte wurden dafür verwendet. Ein schon beschädigter Senderlink muss über die reparierte Verknüpfung neu geöffnet werden.
- **Einrichtungsfehler:** Neu erzeugte Base64url-Stream-IDs konnten Bindestriche enthalten, die VDO durch Unterstriche ersetzt und mit einem Dialog meldet. Neue IDs verwenden nun 24 hexadezimale Zeichen mit weiterhin 96 Zufallsbits. Bestehende Identitäten bleiben erhalten; die aktuelle Nutzer-ID enthält keinen Bindestrich.
- Ein separater synthetischer Stream mit eigener Testidentität bestätigte echte Übertragung: LIVE nach rund 2 Sekunden, 1280×720, 1199 decodierte Frames und eine Audiospur. Dies prüft den Dienst und den Übertragungsweg dieses PCs, nicht das physische iPhone oder Quest-Audio.
- Beim Empfangsversuch mit dem echten Sender kamen zeitweise drei verschlüsselte Angebots-/Kandidaten-Nachrichten an, aber es entstand keine Peer-Verbindung und kein Videoelement. Ein späterer Versuch erhielt keine Antwort. Daher ist der Sender-Codefehler belegt, aber noch nicht als alleinige Ursache des aktuellen iPhone-Problems nachgewiesen.
- **Abschließender echter Test mit korrigiertem Protokoll nach Sender-Neuladen bestanden:** Passwort und Fragment erhalten, LIVE nach 2032 ms, 1195 decodierte Videoframes bei 1280×720, laufende Wiedergabe sowie Audiospur mit empfangenen Audiodaten. Ausschließlich künstliches Testbild und künstlicher Ton über separate Identität; keine Änderung der laufenden Nutzersitzung.
- **18 Kernprüfungen, 25 Chrome-Prüfungen und 2 simulierte WebKit-Touch-Prüfungen bestanden.** Ein echter VDO-Empfangstest in Windows-WebKit war nicht möglich: dort fehlen die benötigten AudioContext-/WebRTC-Funktionen. Das ist keine Aussage über Safari auf einem physischen iPhone.
- Der Nutzer hat den Neustart über den korrigierten Launcher noch nicht durchgeführt. Bild und hörbarer Quest-Ton auf seinem iPhone bleiben zu bestätigen.
