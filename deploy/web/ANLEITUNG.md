# NEOSS als geschützte Webseite

NEOSS (bisher NANO) läuft im Browser unter einer eigenen Adresse, z. B. `https://neoss.kms.koeln`. Ohne Benutzername und Passwort sieht man nur die Anmeldung. Alle Mitarbeiter arbeiten gleichzeitig auf derselben Datenbank, jede Änderung steht mit Namen im Protokoll.

## Aufbau

- **NANO-Server** (`server/nano-server.mjs`): Datenbank, Anmeldung, Rollen, Protokoll, tägliche Sicherung. Liefert jetzt auch die Oberfläche aus.
- **Caddy**: nimmt die Verbindungen aus dem Internet an und sorgt automatisch für HTTPS (Let's Encrypt).
- Beides läuft per Docker auf einem Server in Deutschland, z. B. Hetzner Cloud (Standort Nürnberg oder Falkenstein).

## Einrichtung (einmalig, ca. 30 Minuten)

1. Server anlegen, z. B. Hetzner Cloud CX22 mit Ubuntu 24.04 und Docker (App „Docker CE“). Den Auftragsverarbeitungsvertrag (AVV) in der Hetzner-Konsole abschließen.
2. Bei Strato unter Domainverwaltung bei kms.koeln eine Subdomain `neoss` mit A-Record auf die IP-Adresse des Servers setzen.
3. Auf dem Server:
   ```bash
   git clone https://github.com/kms-immo/nano-software.git
   cd nano-software/deploy/web
   cp .env.beispiel .env
   nano .env            # Domain und erstes Admin-Passwort eintragen
   docker compose up -d --build
   ```
4. Firewall: nur die Ports 22, 80 und 443 freigeben.
5. `https://neoss.kms.koeln` öffnen und als `admin` anmelden. Danach unter **Einstellungen › Mehrplatz** das Passwort ändern und für jeden Mitarbeiter einen eigenen Zugang anlegen.

## Bestehende Daten übernehmen

Auf dem Rechner mit den aktuellen Daten in der Desktop-App unter **Einstellungen › Mehrplatz** die Adresse `https://neoss.kms.koeln` eintragen und **Daten übertragen** wählen (als `admin`). Der Server sichert sich vorher.

## Updates

```bash
cd nano-software && git pull && cd deploy/web && docker compose up -d --build
```

Danach meldet sich zuerst ein Administrator an, damit die Datenbank auf den neuen Stand kommt.

## Sicherung

- Der Server sichert die Datenbank täglich nach `deploy/web/daten/sicherungen` (30 Tage).
- Zusätzlich den Ordner `deploy/web/daten` täglich verschlüsselt außer Haus sichern, z. B. mit `restic` auf eine Hetzner Storage Box oder auf die Synology im Büro.

## Was im Browser noch fehlt

- **Bankabruf (FinTS)** läuft nur in der Desktop-App.
- **Dokumente** werden im Browser heruntergeladen statt in der gemeinsamen Ablage gespeichert. Die Ablage auf dem Server folgt in einem nächsten Schritt.
