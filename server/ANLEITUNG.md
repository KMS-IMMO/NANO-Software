# NANO-Server auf der Synology einrichten

Mit dem NANO-Server arbeiten mehrere Mitarbeiter gleichzeitig auf denselben Daten. Die Datenbank liegt auf der NAS, und jeder meldet sich mit seinem eigenen Zugang an.

## Was du brauchst

- Eine Synology mit „+“ im Namen, z. B. DS224+ oder DS225+, mit DSM 7.2 oder neuer
- Den Ordner `server` aus diesem Projekt mit den Dateien `nano-server.mjs`, `Dockerfile` und `docker-compose.yml`
- Etwa 30 Minuten

## 1. Container Manager installieren

1. In DSM das **Paket-Zentrum** öffnen.
2. **Container Manager** suchen und installieren.

## 2. Ordner anlegen

1. **File Station** öffnen.
2. Im Ordner `docker` einen Unterordner `nano-server` anlegen. Gibt es noch keinen Ordner `docker`, legt ihn der Container Manager beim Installieren an.
3. Die drei Dateien aus dem Ordner `server` dorthin hochladen.
4. Dazu einen leeren Unterordner `daten` anlegen. Darin liegen später die Datenbank und die Sicherungen.

## 3. Administrator-Passwort festlegen

1. `docker-compose.yml` in der File Station öffnen (Rechtsklick › Öffnen mit › Texteditor).
2. In der Zeile `NANO_ADMIN_PASSWORT=bitte-aendern-1234` ein eigenes Passwort eintragen.
3. Das Passwort gilt nur für den allerersten Start. Danach änderst du es in NANO.

## 4. Server starten

1. Im **Container Manager** auf **Projekt** › **Erstellen** gehen.
2. Als Projektname `nano` eingeben.
3. Als Pfad `/docker/nano-server` wählen. Die `docker-compose.yml` wird erkannt.
4. **Weiter** und dann **Fertig** klicken. Der Server wird gebaut und gestartet, das dauert 1–2 Minuten.
5. Der Container `nano-server` sollte jetzt grün sein.

## 5. Feste IP-Adresse für die NAS

1. In der **FRITZ!Box** unter Heimnetz › Netzwerk die NAS öffnen.
2. Den Haken bei **„Diesem Netzwerkgerät immer die gleiche IPv4-Adresse zuweisen“** setzen.
3. Die Adresse notieren, z. B. `192.168.178.20`.

Zum Testen im Browser `http://192.168.178.20:8080/api/info` öffnen. Dort muss `{"name":"NANO-Server", …}` stehen.

## 6. Gemeinsame Ablage für Dokumente

1. In DSM unter **Systemsteuerung** › **Freigegebener Ordner** einen Ordner `NANO-Ablage` anlegen.
2. Die Mitarbeiter-Konten auf diesen Ordner mit Lesen und Schreiben berechtigen.
3. Den Ordner auf jedem Rechner verbinden:
   - **Mac:** Finder › Gehe zu › Mit Server verbinden › `smb://192.168.178.20/NANO-Ablage`. Er erscheint dann unter `/Volumes/NANO-Ablage`.
   - **Windows:** Explorer › Dieser PC › Netzlaufwerk verbinden › `\\192.168.178.20\NANO-Ablage` als Laufwerk `Z:`. Dabei „Verbindung bei Anmeldung wiederherstellen“ anhaken.

## 7. Erster Rechner: Daten übertragen

Das machst du auf dem Rechner, auf dem die aktuellen Daten liegen.

1. NANO öffnen und **Einstellungen** › **Mehrplatz (NANO-Server)** wählen.
2. Die Adresse eintragen, z. B. `192.168.178.20`, und auf **Verbindung testen** klicken.
3. Unter „Erster Rechner“ den Benutzer `admin` und das Passwort aus Schritt 3 eingeben.
4. Auf **Daten übertragen** klicken. NANO startet neu und zeigt die Anmeldung.
5. Als `admin` anmelden.
6. In den Einstellungen das Passwort ändern.
7. Unter **Zugänge** für jeden Mitarbeiter einen eigenen Zugang anlegen.
8. Unter „Gemeinsame Ablage auf diesem Rechner“ den Pfad aus Schritt 6 eintragen.

Wichtig: Dokumente, die schon früher abgelegt wurden, kopierst du einmal in den Ordner `NANO-Ablage`. Dabei bleibt die Ordnerstruktur, wie sie ist.

## 8. Weitere Rechner

1. NANO installieren.
2. Beim ersten Start ein App-Passwort festlegen. Es wird nur für die lokale Datei gebraucht.
3. **Einstellungen** › **Mehrplatz** wählen, die Adresse eintragen und auf **Verbindung testen** und dann **Mit Server verbinden** klicken.
4. Mit dem eigenen Zugang anmelden.
5. Den Ablage-Pfad für diesen Rechner eintragen.

## 9. Von unterwegs (Homeoffice)

1. Auf der NAS aus dem Paket-Zentrum **Tailscale** installieren und anmelden.
2. Auf dem Laptop Tailscale installieren und mit demselben Konto anmelden.
3. In NANO als Serveradresse die Tailscale-Adresse der NAS eintragen, z. B. `100.x.y.z`. Du findest sie in der Tailscale-App.

## 10. Sicherung

- Der Server sichert die Datenbank jeden Tag selbst nach `daten/sicherungen` und behält 30 Tage.
- Zusätzlich mit **Hyper Backup** den Ordner `docker/nano-server/daten` und die `NANO-Ablage` täglich auf eine USB-Platte oder in die Cloud sichern.

## Rollen

| Rolle | Darf |
| --- | --- |
| Administrator | alles, Zugänge verwalten, Protokoll ansehen, NANO-Updates einspielen |
| Mitarbeiter | alle Daten ansehen und bearbeiten |
| Nur lesen | ansehen, nichts ändern |

Nach einem NANO-Update meldet sich zuerst ein Administrator an. Dabei wird die Datenbank auf dem Server auf den neuen Stand gebracht.

## Probleme

- **„Server nicht erreichbar“:** Prüfen, ob die NAS läuft, der Container grün ist und die Adresse stimmt (Test aus Schritt 5).
- **Admin-Passwort vergessen:** In der `docker-compose.yml` ein neues `NANO_ADMIN_PASSWORT` setzen und die Zeile `- NANO_ADMIN_ZURUECKSETZEN=1` ergänzen. Dann im Container Manager das Projekt neu starten. Danach die Zeile wieder entfernen und noch einmal neu starten.
