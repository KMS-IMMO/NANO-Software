# NEOSS-Software

Desktop-Software zur Immobilienverwaltung (WEG und Mietverwaltung) für KMS Immobilien Köln.
Läuft lokal unter Windows und macOS, alle Daten liegen in einer SQLite-Datei auf dem eigenen Rechner.

## Funktionen (Stand 0.1)

- Objekte und Einheiten mit Typ, Lage, Fläche, Heizfläche, Zimmern und MEA
- Eigentümer, Mieter und Dienstleister; Eigentümer je Einheit mit Anteil und Zeitraum
- Mietverträge mit Kaltmiete, NK-/HK-Vorauszahlung, Kaution und Personenzahl
- Offene Posten: monatliche Soll-Stellung, Zahlungen, Statistik offen / gezahlt / überfällig
- Rechnungen je Objekt mit Kostenart aus dem eigenen Kontenrahmen
- Einstellungen: eigene Buchungskonten, Bankkonten, Ordnervorlagen für die Ablage

In Arbeit: Bankimport mit Abgleich, Nebenkostenabrechnung (Fläche, Personen, Einheiten, MEA, Summe, Verbrauch), Dokumentenablage.

## Entwicklung

```bash
npm install
npm run dev          # Oberfläche im Browser mit Beispieldaten (sql.js)
npx tauri dev        # Desktop-App mit echter SQLite-Datei
npx tauri build      # Installer bauen
```

Den Windows-Installer baut GitHub Actions (`.github/workflows/build.yml`), manuell über „Run workflow“ oder per Tag `v*`.

## Aufbau

- `src/db/schema.ts`: Datenbankschema als fortlaufende Migrationen
- `src/db/index.ts`: Datenbankzugriff (Tauri-SQLite oder sql.js im Browser)
- `src/components/EntityTable.tsx`: Liste mit Formular für Stammdaten
- `src/pages/`: Seiten der App
- `src-tauri/`: Rust-Hülle der Desktop-App
