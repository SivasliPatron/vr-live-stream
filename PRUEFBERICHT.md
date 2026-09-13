# Projektprüfung vom 5. September 2026

## Veröffentlichungsfreigabe vom 13. September 2026

Die vorbereiteten Änderungen sind zur Veröffentlichung auf GitHub Pages freigegeben. Die folgenden Prüfprotokolle beschreiben frühere lokale Prüfungen; Angaben wie „noch nicht veröffentlicht“ beziehen sich auf den damaligen Stand.

Vor der Veröffentlichung erneut geprüft: **50/50 Modul- und Servertests** sowie **48 Browserfälle bestanden**, keine fehlgeschlagenen Tests. Drei WebKit-Audiotests wurden wegen fehlender Web-Audio-Unterstützung übersprungen. Die Browserprüfungen verwenden einen simulierten VDO-Player und ersetzen keinen echten Quest-Livestream-Test.

## Ursprüngliches Prüfprotokoll

Geprüft wurden sämtliche eigenen Projektdateien: die öffentliche Seite mit allen JavaScript-Modulen und Styles, der Vorschau-Server, Tests, Paketkonfiguration, Anleitungen, die lokalen `.private`-Skripte und Konfigurationsdateien sowie alle zehn Windows-Verknüpfungen. Git-interne Daten und installierte Fremdpakete wurden nicht als eigener Quellcode geprüft.

Die gefundenen, reproduzierbaren Fehler sind lokal korrigiert. Das ist keine Zusicherung vollständiger Fehlerfreiheit. Ein Deployment wurde nicht durchgeführt; der öffentliche GitHub-Link erhält die Änderungen erst nach einer Veröffentlichung.

## Korrekturen

| Bereich | Fehler und resultierendes Verhalten |
| --- | --- |
| Internetverbindung | Offline-Einstieg und Codeänderungen ließen Bedienelemente nach der Netzrückkehr gesperrt. Die Ansicht aktualisiert sich jetzt bei jedem Online-/Offline-Ereignis; der Code lässt sich auch offline vorbereiten. |
| Wiederverbindung | Wiederholte Abbruchmeldungen verlängerten die Schonfrist unbegrenzt. Die jetzt auf 15 Sekunden begrenzte Schonfrist wird nicht neu gestartet. Leere oder unveränderte Statistiken heben einen gemeldeten Ausfall nicht mehr auf. Ausstehende Wiederholungen beachten Sichtbarkeit, Netzwerk und Codeänderungen. |
| Player-Zustand | Unvollständige Statistikantworten galten als bestätigter Ausfall. Nur gültige Inbound-Sammlungen zählen als bestätigte Anwesenheit. LIVE erfordert zusätzlich positive Videozähler; weder leere Metadaten noch Track-Ereignisse reichen aus. Dadurch bleibt bei einem erfolglosen Start der Timeout aktiv. |
| Ton | Ein später Iframe-Load setzte den Ton trotz gegenteiliger Anzeige erneut stumm. Die aktuelle Tonwahl bleibt erhalten. Nach der ergänzenden Audiokorrektur fordert bereits der bewusste Start Ton an; Wiederverbindungen behalten die Einstellung. Alte Iframes dürfen den neuen Player nicht steuern. |
| Browsernavigation | Die Bereinigung erfolgt mit `pagehide`; eine aus dem Seitencache wiederhergestellte Sitzung verbindet sich über `pageshow` erneut. |
| Vollbild | Im fensterfüllenden Modus bleibt der Fokus beim Player; Escape und Schließen stellen ihn wieder her. Bei Netzverlust wird Vollbild geschlossen. Hängende native Anfragen erreichen den Rückfallmodus; verspätete Antworten öffnen ein bereits geschlossenes Vollbild nicht erneut. |
| Darstellung | Kleine Liveansichten bleiben im Verhältnis 16:9. Der Formularrahmen wächst mit dem Inhalt und schneidet den Startknopf auch zwischen den mobilen und Desktop-Umbrüchen nicht ab. Die Eingabeschrift ist mindestens 16 px groß. |
| Zugang und Einrichtung | Übernommene Query-/Fragmentparameter werden beim URL-Aufbau entfernt. Der vierstellige Code bleibt im Fragment; ungültige Basiskonfigurationen zeigen die Einrichtungsansicht statt eines JavaScript-Abbruchs. Ohne JavaScript bleibt die Starttaste deaktiviert und ein Hinweis sichtbar. |
| Verständlichkeit | Eine Hauptüberschrift für Screenreader und ein sichtbarer Hinweis zur Direktverbindung wurden ergänzt. Der Zugang verlangt weiterhin nur einen Code, keinen Namen und keine Senderbestätigung. |
| Vorschau-Server | Fehlerhafte URL-Kodierung, Dateifehler und abgebrochene Downloads beenden den Server nicht mehr. Traversal, Windows-Pfadaliase und Junctions außerhalb von `docs` werden abgewiesen. HEAD, Methodenantworten, Verzeichnisweiterleitungen und Portfehler werden korrekt behandelt. |
| Lokale Starts | Reine Codeanzeige benötigt kein Chrome und verändert keine Sitzung. Fehlendes Chrome verändert den Code nicht; eine gesperrte Zwischenablage verhindert die Anzeige nicht. Private JSON-Dateien werden atomar gespeichert und UTC-Zeitstempel erhalten. |
| Lokale Tests und Audience-Helfer | Der Wiederherstellungstest rotiert keine echten Codes mehr und verwendet temporäre Beispieldaten. Audience-Fehler geben keine Konfigurationsinhalte aus, zwischenzeitliche Dateiveränderungen werden erkannt. Eine geöffnete WebSocket-Verbindung wird nicht mehr als nachgewiesene Tokenautorisierung bezeichnet. |

## Verifikation

- `npm.cmd test`: **38/38** Modul-, Struktur-, Sicherheits- und echte HTTP-/CLI-Tests bestanden.
- Die Oberflächenprüfung umfasst **27** Browserfälle (14 Chromium, 13 WebKit), ergänzt um **18** Verbindungstests (9 je Browser) und **3 bestandene Chromium-Audioprüfungen**. Die 3 WebKit-Audiosignaltests werden ausdrücklich übersprungen.
- `node --test .private/verify-audience.mjs`: **4/4** isolierte Audience-Tests bestanden.
- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .private\verify-restoration.ps1`: isolierter Windows-Funktionstest bestanden. Prüft unter anderem Codewechsel, 30-FPS-Fallback, zehn Verknüpfungen, Codeanzeige ohne Chrome und Fehlerfälle.
- JavaScript-/PowerShell-Syntaxprüfung und `git diff --check`: bestanden. Paketinstallation meldete keine bekannten Abhängigkeitslücken.
- Die echte `stream-secrets.json` blieb bei der lokalen Prüfung byteidentisch. Es wurden keine echten Sender, Kameras oder Mikrofone gestartet und keine echten Sitzungscodes rotiert.

Die Browser prüfen die tatsächliche Seite mit einem lokal simulierten VDO-Iframe. Fremde Nachrichten, fehlende/defekte Statistikdaten, direkte und Relay-Zeitüberschreitungen, Wiederholungen, Codeänderungen, Netzwerkwechsel und Vollbildsonderfälle werden gezielt ausgelöst. Der native Chromium-Vollbildtest verwendet die echte Browser-API; Fehler- und verspätete Vollbildantworten sind gezielte API-Simulationen. Seitencache-Ereignisse und Hintergrundstatus werden simuliert.

Für Chromium und WebKit wurden Einstieg und Liveansicht jeweils bei **320, 390, 540, 768, 820 und 1440 px** geprüft und als Screenshots unter `test-results/` gespeichert. Zusätzlich liegen dort Vollbildansichten und Verbindungsansichten bei 320 und 820 px. Während des Verbindens bleibt der Player unsichtbar, damit dessen Zwischenansicht die Codeeingabe nicht überlagert. Mobile Breiten sind Browseremulation, kein Test auf einem echten Telefon. Die Screenshots zeigen ausdrücklich ein simuliertes Livebild.

Beispiele: [mobiler Einstieg](./test-results/chromium-390-entry.png), [mobile Liveansicht](./test-results/webkit-320-live.png), [mittlere Bildschirmbreite](./test-results/chromium-820-entry.png), [Vollbild](./test-results/chromium-fullscreen.png). Die Screenshotdateien sind absichtlich nicht versioniert.

## Verbleibende Prüfgrenzen

Ein echter Quest-Stream, Tab-Audio, Verbindungen über verschiedene reale Netze und die öffentliche GitHub-Pages-Auslieferung wurden in dieser Prüfung nicht getestet. Die vorhandene Sender-/Zuschauerzuordnung bleibt erhalten. Vierstellige Codes und die öffentliche Sichtbarkeit von P2P-Adressen bleiben Eigenschaften des bestehenden Zugangsmodells.

Die VDO-Nachrichtenformate wurden anhand der [offiziellen Iframe-API-Dokumentation](https://docs.vdo.ninja/guides/iframe-api-documentation) geprüft. Ob der externe Dienst jederzeit alle vorgesehenen Meldungen liefert, lässt sich mit der lokalen Simulation nicht nachweisen.

Die geänderten lokalen Betriebsdateien bleiben wie vorgesehen in `.private` beziehungsweise in den ignorierten Startanleitungen. Sie gehören zu einer vollständigen lokalen Sicherung, aber nicht in das öffentliche Repository.

## Ergänzung: Spielton und Musik aus der Quest

Der Nutzer hat bestätigt, dass Spiel und Musik **in der Quest** laufen. Maßgeblich ist daher `Quest → Meta-Casting-Tab mit Ton → Chrome-Tabfreigabe mit Audio → VDO.Ninja → Zuschauer`.

Die bisherige Zuschauer-Seite enthielt eine bestätigte Ursache für Stille: Sie setzte `mutespeaker=1` und `START_MUTED=true` und setzte jede neue Verbindung wieder auf stumm. Jetzt fordert der bewusste Start Ton an (`mutespeaker=0`). Eine danach gewählte Stummschaltung bleibt bei manueller/automatischer Wiederverbindung und Relay-Wechsel erhalten. Im Vollbild gibt es eine Tonsteuerung; **Kein Spielton? → Ton erneut aktivieren** fordert Entstummen und Wiedergabe erneut an. Eine native Wiedergabefreigabe im fremden Player bleibt zugänglich.

`volume: 1` war bereits richtig: VDO verwendet für diese Iframe-API eine Skala von 0 bis 1. Die Audiofreigabe kann je nach Browser einen direkten Klick im Player benötigen. Weder ein erfolgreicher PostMessage-Aufruf noch die Taste „Ton ausschalten“ beweisen eine hörbare Ausgabe. Quellen: [VDO-Parameter und Iframe-Steuerung](https://github.com/steveseguin/vdo.ninja/blob/develop/main.js), [VDO-Wiedergabelogik](https://github.com/steveseguin/vdo.ninja/blob/develop/lib.js), [Chrome-Autoplayregeln](https://developer.chrome.com/blog/autoplay/).

Senderseitig ist `systemaudio=exclude` nun explizit. Das schließt die Freigabe des gesamten PC-Systemtons aus; **Tab-Audio bleibt erlaubt**, wie die [Chrome-Dokumentation](https://developer.chrome.com/docs/web-platform/screen-sharing-controls#systemaudio) beschreibt. Es wurden keine Mikrofon- oder Audio-Abschaltparameter hinzugefügt. Die aktualisierten Startanleitungen verlangen, den Meta-Casting-Player zu entstummen, den Quest-Ton dort zu prüfen und beim Teilen des Chrome-Tabs **Tab-Audio teilen** zu aktivieren. Die laufende Freigabe kann im bestehenden Sender-Tab neu gewählt werden, ohne einen neuen Code zu erzeugen.

Die zusätzliche Datei `tests/browser/audio.test.mjs` prüft mit synthetischen WAV-Daten ein echtes `HTMLAudioElement`, Browserdecodierung und messbares Audiosignal. Der Signalweg endet mit einem Ausgangspegel von null, sodass der Test keine Töne über den PC ausgibt. Der VDO-Player und seine Nachrichten werden simuliert; die Prüfung ersetzt keine echte Quest-Übertragung. Geprüft werden Start mit Ton, Stumm/An, Vollbild-Tonsteuerung, erneutes Aktivieren eines pausierten Mediaelements und der Erhalt der Toneinstellung bei neuen Verbindungen. Ein eventuell erforderlicher direkter Klick in den Testplayer wird im Testbericht ausdrücklich ausgewiesen.

Ergebnis: **3/3 Chromium-Audiosignaltests bestanden**, ohne zusätzliche Freigabe im simulierten Player. Das decodierte Testsignal wurde gemessen (beispielsweise RMS 0,149); Stummschaltung reduzierte den Messwert entsprechend. **3 WebKit-Audiosignaltests werden ausdrücklich übersprungen**, weil der installierte Windows-WebKit-Build keine Web-Audio-API bereitstellt. Das ist keine erfolgreiche WebKit-Audioverifikation. Die **27 allgemeinen Browserprüfungen** bestehen mit den Audioänderungen weiterhin. Mit den ergänzenden Verbindungsprüfungen umfasst die aktuelle Suite **38 Modul-/Servertests** und **48 bestandene Browserfälle** sowie **3 ausdrücklich übersprungene WebKit-Audiosignaltests**. Reproduzierbar mit `npm.cmd test`, `npm.cmd run test:browser` beziehungsweise gezielt `node --test --test-concurrency=1 tests/browser/audio.test.mjs`.

Der isolierte Windows-Sendertest prüft beide Bildraten auf die Tab-Audio-Konfiguration und auf unbeabsichtigte Audio-Aus-Parameter. Die echten Geheimnisse, der aktuelle Zugangscode und alle zehn Startverknüpfungen blieben unverändert. Ein echter Meta-Casting-Ton ist noch nicht bestätigt; die öffentliche Website wurde noch nicht aktualisiert.

## Ergänzung: langsamer oder fehlgeschlagener Zuschauereinstieg

Reproduziert: Ein leerer Zielstream-Eintrag in einer Health-Antwort schaltete die Seite auf LIVE, obwohl noch keine Videodaten ankamen. Das löschte den Start-Timeout; selbst nach künstlich vorgespulten 200 Sekunden erfolgte kein neuer Versuch. Auch bereits gemeldete Abbrüche wurden durch solche Einträge verdeckt. Der Fehler ist durch echte Browsertests mit simulierten VDO-Nachrichten abgesichert.

Die Verbindung prüft jetzt alle 2 Sekunden den gewünschten Stream. Als Empfangsnachweis dienen VDO-Videozähler, niemals Audio- oder allgemeine Transportbytes. Positive Videodimensionen identifizieren bei fehlender Typangabe ein alternatives VDO-Trackformat. Für die Wiederherstellung müssen Zähler fortschreiten; nach einem Zählerrücksprung wird eine neue Basis verwendet. Unbekannte/defekte Antworten allein trennen einen bereits laufenden Stream nicht.

Ein erfolgloser Weg läuft höchstens 25 statt 65 Sekunden. Danach wird genau einmal der andere Weg versucht, auch vom bevorzugten Relay zurück zur Direktverbindung. Nach einem erfolglosen Paar folgen automatische Neuversuche mit Pausen von 3, 6, 12 und höchstens 20 Sekunden. Ein erfolgreich bestätigter Weg wird für maximal 24 Stunden im Browserspeicher bevorzugt; gespeichert werden ausschließlich Verbindungsart und Ablaufzeit. Fehler oder Sperren des Speichers verhindern den Start nicht. Die Zeitfenster begrenzen erfolglose Versuche, garantieren aber keine erreichbare Gegenstelle oder bestimmte Verbindungsdauer.

Alte Iframes werden ausgeblendet und stummgeschaltet und erhalten die VDO-Auflegeanweisung. Nach Bestätigung oder spätestens 1,2 Sekunden werden sie entfernt. Ein neuer Versuch wartet darauf nicht; Nachrichten alter Frames können den aktuellen Player nicht aktivieren. Beim vollständigen Beenden des Browsers kann die Zustellung nicht garantiert werden. Die vorhandenen sechs Senderplätze bleiben erhalten. Doppelte Formularübermittlung startet keine parallelen Player; die neue Abbrechen-Taste beendet auch ausstehende automatische Versuche.

Die VDO-Wiederherstellungsparameter wurden auf retry=10 Sekunden, p2pfailtimeout=7000 ms und peerrecoversteps=5 abgestimmt; pendingicettl bleibt 20000 ms. Der P2P-Timeout ist kein Ersatz für die initiale Verbindungsfrist. Die 60/30-FPS-Senderlinks rufen das aktualisierte lokale Skript auf, sodass dessen Parameter beim nächsten Senderstart gelten. Die vorhandenen Verknüpfungen und der laufende Stream wurden nicht geöffnet oder verändert.

Quellenprüfung: [VDO-Verbindungswiederherstellung](https://docs.vdo.ninja/guides/handling-guest-disconnects-and-connection-recovery), [retry](https://docs.vdo.ninja/advanced-settings/settings-parameters/and-retry), [p2pfailtimeout](https://docs.vdo.ninja/advanced-settings/settings-parameters/and-p2pfailtimeout), [Iframe-API](https://docs.vdo.ninja/guides/iframe-api-documentation) und die VDO-Implementierung in [main.js](https://github.com/steveseguin/vdo.ninja/blob/develop/main.js) und [lib.js](https://github.com/steveseguin/vdo.ninja/blob/develop/lib.js).

Die Browser-Neustartprüfung schließt einen Browser-Kontext und öffnet einen frischen mit dessen gespeichertem Verbindungsweg. Sie simuliert weder eine funktionierende öffentliche Relay-Verbindung noch einen erfolgreichen Quest-Stream. Ein ergänzender lokaler Chromium-WebRTC-Versuch mit Canvas-Testbild bestätigte echte Videozähler ohne Kamera oder Mikrofon; Videobytes allein beweisen keine erfolgreiche Bilddekodierung und keinen hörbaren Quest-Ton. Öffentliche Veröffentlichung und ein echter Quest-Test stehen weiterhin aus.

## Startreparatur vom 13. September 2026

Der gemeldete Fehler beim Start von 720p60 wurde auf eine fehlende `.private/create-links.ps1` zurückgeführt. Das vorhandene Bitdefender-XML protokolliert die Löschung genau dieser Datei. Die Links 00, 02 und 03 verwiesen noch auf sie; der versteckte PowerShell-Start verbarg die Fehlermeldung. Chrome selbst war installiert. Die Erkennung belegt hier die Löschung, keine abschließend geklärte Malware-Ursache.

Das gelöschte Skript wurde nicht wiederhergestellt. Der neue, lesbare Launcher `scripts/start-stream.mjs` prüft die lokalen Senderdaten, erzeugt beim normalen 60-FPS-Start einen neuen Code, erhält beim 30-FPS-Start den Code und öffnet Chrome sowie die Codeanzeige. Die bisherigen Tab-Audio- und Recovery-Einstellungen sind enthalten. Er führt keine heruntergeladenen Skripte und keine Shell-Befehle aus. Fehler bleiben im interaktiven Startfenster sichtbar. Ein fehlgeschlagener Browserstart stellt die vorherigen Sitzungsdateien wieder her; parallele Starts sind gesperrt.

`scripts/install-launchers.ps1` hat alle zehn lokalen Verknüpfungen repariert und ihre Ziele, Argumente, Arbeitsverzeichnisse und Fensterstile überprüft. Die Laufzeitlinks verwenden Node direkt. Die Installation lief mit dem bereits vorhandenen PowerShell 7 ohne Richtlinienparameter; weder eine Ausführungsrichtlinie noch eine Virenschutz-Einstellung wurde geändert. Der erste Aufruf mit Windows PowerShell 5 konnte wegen dessen vorhandener Skriptrichtlinie nicht ausgeführt werden. Ein optionaler zusätzlicher Installationstest in einem temporären Ordner wurde vom Werkzeug vor Ausführung abgelehnt und nicht wiederholt; die zehn tatsächlichen Verknüpfungen wurden durch den Installer vollständig geprüft.

Verifikation: **50/50 Modul- und Servertests bestanden**, darunter **12 neue Launcher-Tests** mit ausschließlich synthetischen Daten und simulierten Anwendungen. `node scripts/start-stream.mjs --check` bestätigte die echte Chrome-Installation und gültige lokale Senderdaten ohne Codeänderung. Die anschließende tatsächliche Ausführung der reparierten **02-Verknüpfung** öffnete ein sichtbares VDO.Ninja-Chrome-Fenster und die Codeanzeige. Dabei entstand wie vorgesehen ein neuer vierstelliger Code; dauerhafte Stream-ID, Tokens und ursprüngliches Erstellungsdatum blieben unverändert. Die angezeigte Code-Datei stimmt mit der neuen Sitzung überein und die Startsperre wurde freigegeben.

Es wurde keine Bildschirm-, Kamera- oder Mikrofonfreigabe bestätigt. Quest-Bild und echter Quest-Ton bleiben separat zu prüfen. Die öffentliche Zuschauer-Seite wurde weiterhin nicht veröffentlicht.
