// Datenbankschema der NEOSS-Software (KMS Immobilien).
// Jede Migration läuft genau einmal; Änderungen immer als neue Migration anhängen.
// Fachliche Grundlage: /mnt/project-files/kms-verwaltung/planung.md

export const MIGRATIONS: string[] = [
  /* 1: Grundschema */ `
CREATE TABLE einstellungen (
  schluessel TEXT PRIMARY KEY,
  wert TEXT
);

-- Eigentümer, Mieter, Beiräte (Privatpersonen); Firmen stehen in "firmen"
CREATE TABLE personen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rolle TEXT NOT NULL DEFAULT 'Mieter', -- Mieter, Eigentümer, Sonstige
  anrede TEXT, titel TEXT, vorname TEXT, nachname TEXT, firma TEXT,
  strasse TEXT, plz TEXT, ort TEXT,
  telefon TEXT, mobil TEXT, email TEXT,
  iban TEXT, bic TEXT, geburtsdatum TEXT,
  notiz TEXT
);

-- Firmenkontakte: Handwerker und Dienstleister
CREATE TABLE firmen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  gewerk TEXT,                -- z. B. Sanitär, Elektro, Hausmeister, Reinigung, Messdienst
  ansprechpartner TEXT,
  strasse TEXT, plz TEXT, ort TEXT,
  telefon TEXT, mobil TEXT, email TEXT, webseite TEXT,
  iban TEXT, ust_id TEXT,
  notiz TEXT
);

CREATE TABLE objekte (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  verwaltungsart TEXT NOT NULL DEFAULT 'Mietverwaltung', -- WEG, Mietverwaltung
  name TEXT NOT NULL,
  strasse TEXT, plz TEXT, ort TEXT,
  baujahr INTEGER,
  gesamt_mea REAL,
  heizungsart TEXT,
  eigentuemer_id INTEGER REFERENCES personen(id), -- bei Mietverwaltung: Eigentümer des Hauses
  notiz TEXT
);

-- Verwaltungsbeirat je WEG
CREATE TABLE beiraete (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES personen(id),
  funktion TEXT,              -- Vorsitz, Mitglied
  von TEXT, bis TEXT
);

CREATE TABLE einheiten (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
  nummer TEXT NOT NULL,
  typ TEXT NOT NULL DEFAULT 'Wohnung', -- Wohnung, Gewerbe, Stellplatz, Garage, Keller, Sonstiges
  lage TEXT,
  flaeche REAL,
  mea REAL,
  notiz TEXT
);

-- Eigentümer je Einheit (WEG), auch mehrere mit Anteil, mit Historie
CREATE TABLE eigentum (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  einheit_id INTEGER NOT NULL REFERENCES einheiten(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES personen(id),
  anteil REAL DEFAULT 100,
  von TEXT, bis TEXT
);

-- Hausgeld je Einheit (WEG), wird selbst eingetragen; neuer Betrag = neue Zeile mit gueltig_ab
CREATE TABLE hausgeld (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  einheit_id INTEGER NOT NULL REFERENCES einheiten(id) ON DELETE CASCADE,
  gueltig_ab TEXT NOT NULL,
  betrag REAL NOT NULL,       -- monatliches Hausgeld gesamt
  davon_ruecklage REAL DEFAULT 0
);

-- Mietverträge (Mietverwaltung und vermietete WEG-Einheiten), Historie bleibt erhalten
CREATE TABLE mietvertraege (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  einheit_id INTEGER NOT NULL REFERENCES einheiten(id) ON DELETE CASCADE,
  mieter_id INTEGER NOT NULL REFERENCES personen(id),
  mieter2_id INTEGER REFERENCES personen(id),
  beginn TEXT NOT NULL, ende TEXT,
  kaltmiete REAL NOT NULL DEFAULT 0,
  nk_vorauszahlung REAL NOT NULL DEFAULT 0,
  hk_vorauszahlung REAL NOT NULL DEFAULT 0,
  kaution REAL DEFAULT 0,
  personenzahl INTEGER DEFAULT 1,
  ust_satz REAL DEFAULT 0,    -- 19 bei Gewerbe mit Umsatzsteuer
  mietart TEXT DEFAULT 'Standard', -- Standard, Staffelmiete, Indexmiete
  index_basis REAL, index_basis_monat TEXT,
  faellig_tag INTEGER DEFAULT 3,
  notiz TEXT
);

-- Mietänderungen: Staffeln, Indexanpassungen, Erhöhungen, neue Vorauszahlungen
CREATE TABLE mietanpassungen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vertrag_id INTEGER NOT NULL REFERENCES mietvertraege(id) ON DELETE CASCADE,
  gueltig_ab TEXT NOT NULL,
  art TEXT NOT NULL,          -- Staffel, Index, Erhöhung, Vorauszahlung
  kaltmiete REAL, nk_vorauszahlung REAL, hk_vorauszahlung REAL,
  indexwert REAL,
  notiz TEXT
);

-- Eigener Kontenrahmen (Stand 2027, gilt für WEG und Mietverwaltung)
CREATE TABLE buchungskonten (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nummer TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  gruppe TEXT,
  art TEXT NOT NULL DEFAULT 'Aufwand', -- Aufwand, Ertrag, Einnahme, Bank, Kaution
  euer INTEGER NOT NULL DEFAULT 1,
  mwst REAL NOT NULL DEFAULT 0,
  umlagefaehig INTEGER NOT NULL DEFAULT 0,
  hdl INTEGER NOT NULL DEFAULT 0,  -- haushaltsnahe Dienstleistung §35a
  hwl INTEGER NOT NULL DEFAULT 0,  -- Handwerkerleistung §35a
  schluessel TEXT                  -- Vorschlag Umlageschlüssel
);

-- Umlageschlüssel je Objekt und Konto (variabel einstellbar)
CREATE TABLE objekt_schluessel (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
  buchungskonto_id INTEGER NOT NULL REFERENCES buchungskonten(id),
  schluessel TEXT NOT NULL,   -- Fläche, Personen, Einheiten, MEA, Summe, Verbrauch, Direkt
  UNIQUE (objekt_id, buchungskonto_id)
);

CREATE TABLE bankkonten (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  objekt_id INTEGER REFERENCES objekte(id),
  name TEXT NOT NULL,
  bank TEXT, iban TEXT, bic TEXT,
  anfangssaldo REAL DEFAULT 0, saldo_datum TEXT
);

CREATE TABLE bankumsaetze (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bankkonto_id INTEGER NOT NULL REFERENCES bankkonten(id) ON DELETE CASCADE,
  datum TEXT NOT NULL, valuta TEXT,
  betrag REAL NOT NULL,
  verwendungszweck TEXT, gegenpartei TEXT, gegen_iban TEXT,
  import_hash TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'offen' -- offen, zugeordnet, ignoriert
);

-- Soll-Stellungen = offene Posten (Miete und Hausgeld je Monat)
CREATE TABLE sollstellungen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vertrag_id INTEGER REFERENCES mietvertraege(id) ON DELETE CASCADE,
  einheit_id INTEGER REFERENCES einheiten(id) ON DELETE CASCADE,
  person_id INTEGER REFERENCES personen(id),  -- Schuldner
  monat TEXT NOT NULL,
  art TEXT NOT NULL,          -- Kaltmiete, NK, HK, USt, Hausgeld, Sonderumlage, Mahngebühr, Nachzahlung
  betrag REAL NOT NULL,
  faellig TEXT NOT NULL,
  mahnstufe INTEGER DEFAULT 0
);
CREATE UNIQUE INDEX sollstellungen_eindeutig
  ON sollstellungen (COALESCE(vertrag_id, 0), einheit_id, COALESCE(person_id, 0), monat, art);

CREATE TABLE rechnungen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  objekt_id INTEGER NOT NULL REFERENCES objekte(id),
  einheit_id INTEGER REFERENCES einheiten(id),
  firma_id INTEGER REFERENCES firmen(id),
  rechnungsnr TEXT,
  datum TEXT NOT NULL,
  betrag REAL NOT NULL,       -- brutto
  buchungskonto_id INTEGER NOT NULL REFERENCES buchungskonten(id),
  anteil_lohn REAL,           -- Arbeitskosten für §35a
  zeitraum_von TEXT, zeitraum_bis TEXT,
  faellig TEXT, bezahlt_am TEXT,
  dokument_id INTEGER,
  notiz TEXT
);

CREATE TABLE buchungen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  datum TEXT NOT NULL,
  betrag REAL NOT NULL,
  buchungskonto_id INTEGER REFERENCES buchungskonten(id),
  objekt_id INTEGER REFERENCES objekte(id),
  einheit_id INTEGER REFERENCES einheiten(id),
  sollstellung_id INTEGER REFERENCES sollstellungen(id),
  rechnung_id INTEGER REFERENCES rechnungen(id),
  bankumsatz_id INTEGER REFERENCES bankumsaetze(id),
  text TEXT
);

-- Heizkosten-Ergebnis vom Messdienst je Einheit und Jahr
CREATE TABLE heizkosten_ergebnisse (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  einheit_id INTEGER NOT NULL REFERENCES einheiten(id) ON DELETE CASCADE,
  jahr INTEGER NOT NULL,
  heizkosten REAL NOT NULL DEFAULT 0,
  warmwasser REAL NOT NULL DEFAULT 0,
  messdienst TEXT,
  UNIQUE (einheit_id, jahr)
);

-- Verbrauchswerte je Einheit, Jahr und Konto (für Schlüssel "Verbrauch")
CREATE TABLE verbrauch (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  einheit_id INTEGER NOT NULL REFERENCES einheiten(id) ON DELETE CASCADE,
  jahr INTEGER NOT NULL,
  buchungskonto_id INTEGER NOT NULL REFERENCES buchungskonten(id),
  menge REAL NOT NULL,
  UNIQUE (einheit_id, jahr, buchungskonto_id)
);

CREATE TABLE abrechnungen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  objekt_id INTEGER NOT NULL REFERENCES objekte(id),
  art TEXT NOT NULL,          -- Nebenkosten, WEG-Jahresabrechnung, Eigentümerabrechnung
  jahr INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Entwurf',
  erstellt TEXT DEFAULT (date('now'))
);

-- Dokumentenablage
CREATE TABLE ordnervorlagen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  bezug TEXT NOT NULL,        -- Objekt, Einheit, Person, Mietvertrag, Firma
  ordner TEXT NOT NULL        -- ein Pfad pro Zeile, Unterordner mit /
);
CREATE TABLE dokumente (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bezug TEXT NOT NULL, bezug_id INTEGER NOT NULL,
  ordner TEXT,
  dateiname TEXT NOT NULL,
  pfad TEXT NOT NULL,
  hinzugefuegt TEXT NOT NULL DEFAULT (date('now'))
);

-- Kontenrahmen MVW 2027 von Serkan (Buchungskonten_Serkan_v2.xlsx)
INSERT INTO buchungskonten (nummer, name, gruppe, art, euer, mwst, umlagefaehig, hdl, hwl) VALUES
 ('1200', 'Heizkosten Abschlag / Abrechnung', 'Heizkosten + Nebenkosten', 'Aufwand', 1, 19, 1, 0, 0),
 ('1201', 'Heizkostenablesung - Dienstleistung', 'Heizkosten + Nebenkosten', 'Aufwand', 1, 19, 1, 1, 0),
 ('1202', 'Heizkostenabrechnung Gerätemiete', 'Heizkosten + Nebenkosten', 'Aufwand', 1, 19, 1, 0, 0),
 ('1203', 'Heizkostenabrechnung Funkanlage', 'Heizkosten + Nebenkosten', 'Aufwand', 1, 19, 1, 0, 0),
 ('1204', 'Emissionsmessung - Schornsteinfeger', 'Heizkosten + Nebenkosten', 'Aufwand', 1, 19, 1, 0, 1),
 ('1205', 'WARTUNG Heizanlage', 'Heizkosten + Nebenkosten', 'Aufwand', 1, 19, 1, 0, 1),
 ('1206', 'WARTUNG Warmwasserkessel', 'Heizkosten + Nebenkosten', 'Aufwand', 1, 19, 1, 0, 1),
 ('1207', 'WARTUNG Wasserfilteranlage', 'Heizkosten + Nebenkosten', 'Aufwand', 1, 19, 1, 0, 1),
 ('1208', 'WARTUNG Pumpanlage', 'Heizkosten + Nebenkosten', 'Aufwand', 1, 19, 1, 0, 1),
 ('1209', 'Abrechnung der Übertrag aus Vorjahr', 'Heizkosten + Nebenkosten', 'Aufwand', 1, 19, 1, 0, 0),
 ('1214', 'Kosten - Strom', 'Wasser/Strom Versorgung', 'Aufwand', 1, 19, 1, 0, 0),
 ('1215', 'Kosten - Wasser', 'Wasser/Strom Versorgung', 'Aufwand', 1, 19, 1, 0, 0),
 ('1220', 'Grundbesitzabgaben', 'Grundbesitzabgaben A', 'Aufwand', 1, 19, 1, 0, 0),
 ('1221', 'Abfallgebühr Biotonne + Gelbe Tonne', 'Grundbesitzabgaben A', 'Aufwand', 1, 19, 1, 0, 0),
 ('1222', 'Abfallgebühr Restmüll', 'Grundbesitzabgaben A', 'Aufwand', 1, 19, 1, 0, 0),
 ('1223', 'Straßenreinigungsgebühren', 'Grundbesitzabgaben A', 'Aufwand', 1, 19, 1, 0, 0),
 ('1224', 'Abwassergebühr / Oberflächenwasser qm', 'Grundbesitzabgaben A', 'Aufwand', 1, 19, 1, 0, 0),
 ('1225', 'Abwassergebühr / Schmutzwasser qm', 'Grundbesitzabgaben A', 'Aufwand', 1, 19, 1, 0, 0),
 ('1226', 'Grundbesitzabgabe B', 'Grundbesitzabgaben A', 'Aufwand', 1, 19, 1, 0, 0),
 ('1230', 'WARTUNG / TüV - Aufzug', 'Aufzugskosten', 'Aufwand', 1, 19, 1, 0, 1),
 ('1231', 'WARTUNG Aufzug Elektrisch', 'Aufzugskosten', 'Aufwand', 1, 19, 1, 0, 1),
 ('1232', 'Nutzerverschulden Aufzugsnutzung', 'Aufzugskosten', 'Aufwand', 1, 19, 1, 0, 1),
 ('1233', 'TüV Prüfung §15 BetrSiV', 'Aufzugskosten', 'Aufwand', 1, 19, 1, 0, 1),
 ('1240', 'Haus + Gartenpflege Außenbereich', 'Allgemeine Betriebskosten', 'Aufwand', 1, 19, 1, 1, 0),
 ('1241', 'Winterdienst', 'Allgemeine Betriebskosten', 'Aufwand', 1, 19, 1, 1, 0),
 ('1242', 'Entsorgungskosten Garten / Altmöbel', 'Allgemeine Betriebskosten', 'Aufwand', 1, 19, 1, 1, 0),
 ('1243', 'Treppenhausreinigung', 'Allgemeine Betriebskosten', 'Aufwand', 1, 19, 1, 1, 0),
 ('1244', 'Brandschutz', 'Allgemeine Betriebskosten', 'Aufwand', 1, 19, 1, 1, 0),
 ('1245', 'WARTUNG Haustechnik', 'Allgemeine Betriebskosten', 'Aufwand', 1, 19, 1, 1, 0),
 ('1246', 'Hausmeisterservice', 'Allgemeine Betriebskosten', 'Aufwand', 1, 19, 1, 1, 0),
 ('1250', 'Gebäudeversicherung', 'Versicherung', 'Aufwand', 1, 19, 1, 0, 0),
 ('1251', 'Haftplicht - Grundbesitzer', 'Versicherung', 'Aufwand', 1, 19, 1, 0, 0),
 ('1252', 'Haftpflicht - Gebäude', 'Versicherung', 'Aufwand', 1, 19, 1, 0, 0),
 ('1260', 'Zuführung Erhaltungsrücklagen', 'Rücklagen', 'Aufwand', 0, 0, 0, 0, 0),
 ('1261', 'Entnahme Erhaltungsrücklagen', 'Rücklagen', 'Aufwand', 1, 0, 0, 0, 0),
 ('1262', 'Zinserträge Erhaltungsrücklagen', 'Rücklagen', 'Aufwand', 0, 0, 0, 0, 0),
 ('1300', 'Reparaturen / Gebäude und Haustechnik', 'Instandhaltungen', 'Aufwand', 1, 19, 0, 0, 1),
 ('1301', 'Sanierungen / Verbesserung Investment', 'Instandhaltungen', 'Aufwand', 1, 19, 0, 0, 1),
 ('1302', 'Haus und Gartenpflege Material', 'Instandhaltungen', 'Aufwand', 1, 19, 0, 1, 0),
 ('1400', 'Verwalterhonorar', 'Verwaltungskosten', 'Aufwand', 1, 19, 0, 0, 0),
 ('1401', 'Außerordentliche Verwalterkosten', 'Verwaltungskosten', 'Aufwand', 1, 19, 0, 0, 0),
 ('1402', 'Steuerberartungskosten', 'Verwaltungskosten', 'Aufwand', 1, 19, 0, 0, 0),
 ('1403', 'Rechtsberatungskosten', 'Verwaltungskosten', 'Aufwand', 1, 19, 0, 0, 0),
 ('1404', 'Notarkosten', 'Verwaltungskosten', 'Aufwand', 1, 19, 0, 0, 0),
 ('1405', 'Kontoführungsgebühren', 'Verwaltungskosten', 'Aufwand', 1, 19, 0, 0, 0),
 ('1500', 'Versicherungsschäden', 'Versicherungsschäden', 'Aufwand', 1, 0, 0, 0, 0),
 ('1501', 'Auszahlung Versicherungsschäden', 'Versicherungsschäden', 'Aufwand', 1, 0, 0, 0, 0),
 ('1600', 'Sonderumlagen', 'Sonderumlagen / Hausgeldabrechnung', 'Aufwand', 1, 0, 0, 0, 0),
 ('1601', 'Einnahmen aus Haushaltsabrechnung', 'Sonderumlagen / Hausgeldabrechnung', 'Aufwand', 0, 0, 0, 0, 0),
 ('1602', 'Auszahlung aus Haushaltsabrechnung', 'Sonderumlagen / Hausgeldabrechnung', 'Aufwand', 0, 0, 0, 0, 0);

-- Einnahmekonten für Soll-Stellungen (nicht in Serkans Liste, Nummern anpassbar)
INSERT INTO buchungskonten (nummer, name, gruppe, art, euer, mwst, umlagefaehig) VALUES
 ('1000','Mieteinnahmen Kaltmiete','Einnahmen','Einnahme',1,0,0),
 ('1001','Vorauszahlung Nebenkosten','Einnahmen','Einnahme',1,0,0),
 ('1002','Vorauszahlung Heizkosten','Einnahmen','Einnahme',1,0,0),
 ('1003','Umsatzsteuer auf Gewerbemiete','Einnahmen','Einnahme',1,0,0),
 ('1010','Hausgeld','Einnahmen','Einnahme',1,0,0),
 ('1011','Mahngebühren','Einnahmen','Einnahme',1,0,0),
 ('1020','Mietkautionen','Kautionen','Kaution',0,0,0);
UPDATE buchungskonten SET art = 'Ertrag' WHERE nummer IN ('1262','1501','1601');

-- Vorschläge Umlageschlüssel (je Objekt änderbar)
UPDATE buchungskonten SET schluessel = 'Fläche' WHERE umlagefaehig = 1;
UPDATE buchungskonten SET schluessel = 'Verbrauch' WHERE nummer IN ('1200','1215');
UPDATE buchungskonten SET schluessel = 'Personen' WHERE nummer IN ('1221','1222');
UPDATE buchungskonten SET schluessel = 'Einheiten' WHERE nummer IN ('1204','1214');

INSERT INTO einstellungen (schluessel, wert) VALUES
 ('mahnung_gebuehr_1', '0'),
 ('mahnung_gebuehr_2', '5'),
 ('mahnung_gebuehr_3', '10'),
 ('mahnung_frist_tage', '14'),
 ('ablage_pfad', ''),
 ('firma_name', 'KMS Immobilien'),
 ('firma_ort', 'Köln');
`,

  /* 2: Standard-Ordnervorlagen (bis Serkans eigene Vorlage eingetragen ist) */ `
INSERT INTO ordnervorlagen (name, bezug, ordner) VALUES
 ('Standard', 'Objekt', 'Grundbuch und Teilungserklärung
Verträge Dienstleister
Versicherungen
Rechnungen
Nebenkostenabrechnungen
WEG-Jahresabrechnung
Eigentümerversammlung/Protokolle
Eigentümerversammlung/Beschlüsse
Mahnungen
Fotos'),
 ('Standard', 'Einheit', 'Grundrisse
Übergabeprotokolle
Zählerstände
Schriftverkehr'),
 ('Standard', 'Mietvertrag', 'Mietvertrag
Mieterhöhungen
Schriftverkehr
Kündigung'),
 ('Standard', 'Person', 'Korrespondenz
Ausweis und Unterlagen'),
 ('Standard', 'Firma', 'Angebote
Rechnungen
Verträge');
`,
  // Migration 3: Ordnervorlage von KMS Immobilien für Objekte
  `
INSERT INTO ordnervorlagen (name, bezug, ordner) VALUES
 ('KMS Immobilien', 'Objekt', '01 - Gebäudedaten
01 - Gebäudedaten/Teilungserklärung
01 - Gebäudedaten/Grundrisse
01 - Gebäudedaten/KMS E-Check
01 - Gebäudedaten/KMS E-Check/Eigentümer
01 - Gebäudedaten/KMS E-Check/Mieter
01 - Gebäudedaten/Liegenschaftscheck
02 - Rechnungen
02 - Rechnungen/Handwerkerrechnungen
02 - Rechnungen/Dienstleisterechnungen
02 - Rechnungen/Sanierungen - Gebäude
03 - Versicherung
03 - Versicherung/Versicherungsverträge
03 - Versicherung/Versicherungsschäden
04 - Energieversorgung
04 - Energieversorgung/Wasserversorgung
04 - Energieversorgung/Stromversorgung
04 - Energieversorgung/Gasversorgung
05 - Jahresabrechnung - Ableseunternehmen
05 - Jahresabrechnung - Ableseunternehmen/Jahresabrechnung Wasser
05 - Jahresabrechnung - Ableseunternehmen/Jahresabrechnung Strom
05 - Jahresabrechnung - Ableseunternehmen/Jahresabrechnung GAS
06 - Zählernummer
06 - Zählernummer/Wasserzählerliste
06 - Zählernummer/Stromzählerliste
06 - Zählernummer/Gaszählerliste - HKV
07 - Hausverwaltung
07 - Hausverwaltung/Verwaltervertrag
07 - Hausverwaltung/Verwaltervollmacht
08 - Bankdaten
08 - Bankdaten/Online Banking - Daten
09 - Beschluss - EGT
09 - Beschluss - EGT/Protokolle
10 - Grundbesitzabgaben');
`,
  // Migration 4: Liegenschafts-ID (H-ID), Status, Personenzahl je Einheit (für WEG ohne Mieter)
  `
ALTER TABLE objekte ADD COLUMN objekt_nr TEXT;
ALTER TABLE objekte ADD COLUMN status TEXT NOT NULL DEFAULT 'Aktiv';
UPDATE objekte SET objekt_nr = CAST(1000 + id AS TEXT) WHERE objekt_nr IS NULL;
CREATE TRIGGER objekt_nr_auto AFTER INSERT ON objekte WHEN NEW.objekt_nr IS NULL OR NEW.objekt_nr = ''
BEGIN UPDATE objekte SET objekt_nr = CAST(1000 + NEW.id AS TEXT) WHERE id = NEW.id; END;
ALTER TABLE einheiten ADD COLUMN personenzahl INTEGER;
`,
  // Migration 5: Beschlüsse, Versammlungen, Instandhaltung, Rücklagen-Maßnahmen, Wirtschaftsplan
  `
CREATE TABLE versammlungen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
  datum TEXT NOT NULL,
  art TEXT NOT NULL DEFAULT 'Ordentliche Versammlung', -- Ordentliche, Außerordentliche, Umlaufbeschluss
  ort TEXT,
  status TEXT NOT NULL DEFAULT 'Geplant',              -- Geplant, Eingeladen, Durchgeführt
  notiz TEXT
);
CREATE TABLE beschluesse (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
  versammlung_id INTEGER REFERENCES versammlungen(id) ON DELETE SET NULL,
  nummer TEXT,                -- z. B. B-2025-01
  datum TEXT NOT NULL,
  betreff TEXT NOT NULL,
  art TEXT,                   -- Investition, Finanzen, Organisation, Instandhaltung, Sonstiges
  ergebnis TEXT NOT NULL DEFAULT 'Angenommen', -- Angenommen, Abgelehnt, Vertagt
  zustimmung REAL,            -- Zustimmung in %
  status TEXT NOT NULL DEFAULT 'Geplant',      -- Geplant, In Umsetzung, Erledigt
  betrag REAL,
  notiz TEXT
);
CREATE TABLE vorgaenge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
  einheit_id INTEGER REFERENCES einheiten(id) ON DELETE SET NULL,
  betreff TEXT NOT NULL,
  art TEXT DEFAULT 'Instandhaltung', -- Instandhaltung, Wartung, Schaden, Anfrage, Sonstiges
  prioritaet TEXT NOT NULL DEFAULT 'Mittel', -- Niedrig, Mittel, Hoch
  status TEXT NOT NULL DEFAULT 'Offen',      -- Offen, In Arbeit, Erledigt
  faellig TEXT,
  firma_id INTEGER REFERENCES firmen(id) ON DELETE SET NULL,
  kosten REAL,
  angelegt TEXT NOT NULL DEFAULT (date('now')),
  erledigt_am TEXT,
  notiz TEXT
);
CREATE TABLE ruecklage_massnahmen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
  massnahme TEXT NOT NULL,
  betrag REAL NOT NULL DEFAULT 0,
  jahr INTEGER,
  status TEXT NOT NULL DEFAULT 'Vorgesehen', -- Vorgesehen, Geplant, Beschlossen, Umgesetzt
  notiz TEXT
);
CREATE TABLE wirtschaftsplan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
  jahr INTEGER NOT NULL,
  buchungskonto_id INTEGER NOT NULL REFERENCES buchungskonten(id),
  betrag REAL NOT NULL DEFAULT 0,
  UNIQUE (objekt_id, jahr, buchungskonto_id)
);
ALTER TABLE objekte ADD COLUMN ruecklage_anfang REAL DEFAULT 0;   -- Bestand Erhaltungsrücklage bei Übernahme
ALTER TABLE objekte ADD COLUMN ruecklage_stichtag TEXT;           -- Datum dieses Bestands
`,
  // Migration 6: Buchungsregeln für die automatische Zuordnung von Bankumsätzen
  `
CREATE TABLE buchungsregeln (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prioritaet INTEGER NOT NULL DEFAULT 10,
  muster TEXT NOT NULL,            -- Text in Empfänger/Verwendungszweck, z. B. "Allianz"
  richtung TEXT NOT NULL DEFAULT 'Ausgang', -- Ausgang, Eingang, Beide
  buchungskonto_id INTEGER NOT NULL REFERENCES buchungskonten(id),
  objekt_id INTEGER REFERENCES objekte(id) ON DELETE CASCADE, -- leer = alle Liegenschaften
  aktiv INTEGER NOT NULL DEFAULT 1,
  notiz TEXT
);
INSERT INTO buchungsregeln (prioritaet, muster, richtung, buchungskonto_id)
  SELECT 90, 'Kontoführung', 'Ausgang', id FROM buchungskonten WHERE nummer = '1405';
INSERT INTO buchungsregeln (prioritaet, muster, richtung, buchungskonto_id)
  SELECT 90, 'Rechnungsabschluss', 'Ausgang', id FROM buchungskonten WHERE nummer = '1405';
`,
  // Migration 7: Wer kassiert die Miete? Bei vermieteten WEG-Einheiten zahlt der Mieter meist an den Eigentümer.
  // 'Verwaltung' = Soll-Stellung und Zahlungseingang bei uns, 'Eigentümer' = nur für die Nebenkostenabrechnung erfasst.
  `
ALTER TABLE mietvertraege ADD COLUMN zahlung_an TEXT DEFAULT 'Verwaltung'; -- leer = Verwaltung
`,
  // Migration 8: Bankabruf per FinTS – Anmeldename je Bankkonto (die PIN wird nie gespeichert)
  `
ALTER TABLE bankkonten ADD COLUMN fints_benutzer TEXT;
`,
  // Migration 9: Rechnungserfassung mit MwSt-Satz (Betrag bleibt brutto; Gutschrift = negativer Betrag)
  `
ALTER TABLE rechnungen ADD COLUMN mwst_satz REAL;
`,
  // Migration 10: Produktivität – Termine, Erinnerungen, Ticket-Boards, Todos, Notizen
  `
CREATE TABLE termine (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titel TEXT NOT NULL, datum TEXT NOT NULL, uhrzeit TEXT,
  objekt_id INTEGER REFERENCES objekte(id) ON DELETE CASCADE,
  notiz TEXT
);
CREATE TABLE erinnerungen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titel TEXT NOT NULL, faellig TEXT NOT NULL, uhrzeit TEXT,
  erledigt INTEGER NOT NULL DEFAULT 0,
  objekt_id INTEGER REFERENCES objekte(id) ON DELETE CASCADE,
  notiz TEXT
);
CREATE TABLE boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
);
CREATE TABLE tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  titel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Offen',      -- Offen, In Arbeit, Erledigt
  prioritaet TEXT NOT NULL DEFAULT 'Mittel',
  faellig TEXT,
  objekt_id INTEGER REFERENCES objekte(id) ON DELETE SET NULL,
  notiz TEXT,
  angelegt TEXT NOT NULL DEFAULT (date('now'))
);
CREATE TABLE todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  erledigt INTEGER NOT NULL DEFAULT 0,
  faellig TEXT,
  objekt_id INTEGER REFERENCES objekte(id) ON DELETE SET NULL,
  angelegt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE notizen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titel TEXT, text TEXT,
  objekt_id INTEGER REFERENCES objekte(id) ON DELETE SET NULL,
  geaendert TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO boards (name) VALUES ('Allgemein');
`,
  // Migration 11: Dauerhafte Bankverbindung – System-ID der Bank, automatischer Abruf, Stand des letzten Abrufs
  `
ALTER TABLE bankkonten ADD COLUMN fints_system_id TEXT;
ALTER TABLE bankkonten ADD COLUMN auto_abruf INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bankkonten ADD COLUMN letzter_abruf TEXT;
ALTER TABLE bankkonten ADD COLUMN abruf_hinweis TEXT;
`,
  // Migration 12: Firma an Buchungen, Verlauf aller erstellten Mahnungen
  `
ALTER TABLE buchungen ADD COLUMN firma_id INTEGER REFERENCES firmen(id) ON DELETE SET NULL;
CREATE TABLE mahnungen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  objekt_id INTEGER REFERENCES objekte(id) ON DELETE CASCADE,
  einheit_id INTEGER REFERENCES einheiten(id) ON DELETE CASCADE,
  person_id INTEGER,
  schuldner TEXT,
  stufe INTEGER NOT NULL,
  datum TEXT NOT NULL,
  frist TEXT,
  betrag REAL NOT NULL,
  gebuehr REAL DEFAULT 0,
  posten TEXT NOT NULL,      -- IDs der gemahnten Soll-Stellungen, durch Komma getrennt
  pfad TEXT
);
`,
  // Migration 13: Verteilerschlüssel je Liegenschaft und Abrechnungsjahr (geht vor dem Standard der Liegenschaft)
  `
CREATE TABLE objekt_schluessel_jahr (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
  jahr INTEGER NOT NULL,
  buchungskonto_id INTEGER NOT NULL REFERENCES buchungskonten(id),
  schluessel TEXT NOT NULL,
  UNIQUE (objekt_id, jahr, buchungskonto_id)
);
`,
  // Migration 14: Maßeinheit beim Verbrauchsschlüssel (m², m³, kWh …)
  `
ALTER TABLE objekt_schluessel_jahr ADD COLUMN masseinheit TEXT;
`,
  // Migration 15: Zahlweise der Erhaltungsrücklage (mit dem Hausgeld in einer Summe oder getrennt) und Wohnungs-ID (W-ID)
  `
ALTER TABLE objekte ADD COLUMN ruecklage_zahlweise TEXT NOT NULL DEFAULT 'zusammen';  -- zusammen | getrennt
ALTER TABLE eigentum ADD COLUMN zahlweise TEXT;                                      -- leer = wie Liegenschaft
ALTER TABLE einheiten ADD COLUMN lfd_nr INTEGER;                                     -- laufende Nummer in der Liegenschaft
UPDATE einheiten SET lfd_nr = (SELECT COUNT(*) FROM einheiten e2 WHERE e2.objekt_id = einheiten.objekt_id AND e2.id <= einheiten.id) WHERE lfd_nr IS NULL;
CREATE TRIGGER einheit_lfd_nr_auto AFTER INSERT ON einheiten WHEN NEW.lfd_nr IS NULL
BEGIN UPDATE einheiten SET lfd_nr = (SELECT COALESCE(MAX(lfd_nr), 0) + 1 FROM einheiten WHERE objekt_id = NEW.objekt_id) WHERE id = NEW.id; END;
`,
  // Migration 16: Anteil nach § 35a EStG (Arbeitskosten) direkt an der Buchung
  `
ALTER TABLE buchungen ADD COLUMN anteil_35a REAL;
`,
  // Migration 17: Abschluss der Hausgeld- und Nebenkostenabrechnung (danach sind Buchungen des Jahres gesperrt)
  `
ALTER TABLE abrechnungen ADD COLUMN abgeschlossen_am TEXT;
ALTER TABLE abrechnungen ADD COLUMN ergebnis TEXT;
`,
  // Migration 18: Gesamtfläche und Warmwasser der Liegenschaft, Terminarten mit Farben, interner Chat
  `
ALTER TABLE objekte ADD COLUMN gesamt_flaeche REAL;
ALTER TABLE objekte ADD COLUMN warmwasser TEXT;
ALTER TABLE termine ADD COLUMN art TEXT;
ALTER TABLE tickets ADD COLUMN terminart TEXT;
ALTER TABLE tickets ADD COLUMN uhrzeit TEXT;
ALTER TABLE versammlungen ADD COLUMN uhrzeit TEXT;
CREATE TABLE chat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  autor TEXT NOT NULL,
  text TEXT NOT NULL,
  zeit TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
`,
  // Migration 19: wiederkehrende Ausgaben (werden automatisch als Rechnung angelegt) und Fristen-Wächter
  `
CREATE TABLE wiederkehrend (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
  einheit_id INTEGER REFERENCES einheiten(id) ON DELETE SET NULL,
  firma_id INTEGER REFERENCES firmen(id) ON DELETE SET NULL,
  buchungskonto_id INTEGER NOT NULL REFERENCES buchungskonten(id),
  betrag REAL NOT NULL,           -- brutto
  text TEXT,
  intervall INTEGER NOT NULL DEFAULT 1,   -- alle n Monate (1, 3, 6, 12)
  naechste TEXT NOT NULL,         -- Datum der nächsten Rechnung
  ende TEXT,
  zahlungsziel INTEGER,           -- Tage, leer = 14
  pausiert INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE rechnungen ADD COLUMN wiederkehrend_id INTEGER REFERENCES wiederkehrend(id) ON DELETE SET NULL;
CREATE TABLE fristen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titel TEXT NOT NULL,
  art TEXT,                       -- Rauchmelder, Aufzug, Versicherung, ...
  objekt_id INTEGER REFERENCES objekte(id) ON DELETE CASCADE,
  faellig TEXT NOT NULL,
  intervall_monate INTEGER,       -- leer = einmalig
  vorlauf_tage INTEGER,           -- leer = 30
  zustaendig TEXT,
  notiz TEXT,
  erledigt_am TEXT                -- nur bei einmaligen Fristen
);
`,
  // Migration 20: Buchen-Fenster – Rechnungsnummer-Pflicht je Konto, Buchungsjahr und Rechnungsnummer an der Buchung
  `
ALTER TABLE buchungskonten ADD COLUMN rechnung_pflicht INTEGER NOT NULL DEFAULT 0;
ALTER TABLE buchungen ADD COLUMN jahr INTEGER;
ALTER TABLE buchungen ADD COLUMN rechnungsnr TEXT;
UPDATE buchungskonten SET rechnung_pflicht = 1 WHERE art = 'Aufwand' AND (hdl = 1 OR hwl = 1);  -- § 35a verlangt eine Rechnung; weitere Konten im Kontenrahmen anhaken
`,
  // Migration 21: Erinnerungen mit Erstellungsdatum
  `
ALTER TABLE erinnerungen ADD COLUMN erstellt TEXT;
`,
  // Migration 22: Zahlweise der Mieter (Miete und Nebenkosten in einer Überweisung oder getrennt)
  `
ALTER TABLE objekte ADD COLUMN miete_zahlweise TEXT NOT NULL DEFAULT 'zusammen';  -- zusammen | getrennt
`,
  // Migration 23: Zahlweise je Mietvertrag (leer = wie Liegenschaft)
  `
ALTER TABLE mietvertraege ADD COLUMN zahlweise TEXT;  -- zusammen | getrennt | leer
`,
  // Migration 24: Mietverwaltung – Auszahlungen an den Eigentümer und Einzahlungen des Eigentümers. Kontoart „Eigentümer“:
  // keine Einnahme und keine Ausgabe, ändert nur den Kontostand. Erscheint in der Abrechnung getrennt unter dem Ergebnis.
  `
INSERT OR IGNORE INTO buchungskonten (nummer, name, gruppe, art, euer, mwst, umlagefaehig) VALUES
 ('1700', 'Auszahlung an Eigentümer', 'Eigentümer-Verrechnung', 'Eigentümer', 0, 0, 0),
 ('1701', 'Einzahlung des Eigentümers', 'Eigentümer-Verrechnung', 'Eigentümer', 0, 0, 0);
`,
  // Migration 25: § 35a Abs. 1 EStG – Konten für geringfügige Beschäftigung im Haushalt (Minijob) getrennt ausweisen
  `
ALTER TABLE buchungskonten ADD COLUMN hbg INTEGER NOT NULL DEFAULT 0;
`,
  // Migration 26: Eigentümerversammlung digital – Tagesordnung (TOPs), Anwesenheit mit Vertretung, Stimmen je Eigentümer,
  // Unterschrift zur Kenntnisnahme und Vorlagen mit Standard-TOPs. Platzhalter in Vorlagen: {jahr} = Jahr der Versammlung, {vorjahr}.
  `
ALTER TABLE versammlungen ADD COLUMN online INTEGER NOT NULL DEFAULT 0;
ALTER TABLE versammlungen ADD COLUMN leitung TEXT;
ALTER TABLE versammlungen ADD COLUMN eingeladen_am TEXT;
ALTER TABLE versammlungen ADD COLUMN beginn TEXT;
ALTER TABLE versammlungen ADD COLUMN ende TEXT;
ALTER TABLE versammlungen ADD COLUMN zaehlung TEXT NOT NULL DEFAULT 'Kopf';   -- Kopf (§ 25 Abs. 2 WEG) oder MEA
ALTER TABLE beschluesse ADD COLUMN ja REAL;
ALTER TABLE beschluesse ADD COLUMN nein REAL;
ALTER TABLE beschluesse ADD COLUMN enthaltung REAL;
ALTER TABLE beschluesse ADD COLUMN anfechtung_bis TEXT;
CREATE TABLE versammlung_tops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  versammlung_id INTEGER NOT NULL REFERENCES versammlungen(id) ON DELETE CASCADE,
  nr INTEGER NOT NULL,
  titel TEXT NOT NULL,
  antrag TEXT,                         -- Beschlussantrag (Wortlaut)
  beschluss INTEGER NOT NULL DEFAULT 0, -- 1 = Abstimmung, 0 = nur Information
  notiz TEXT,                          -- Verlauf / Anmerkungen fürs Protokoll
  erledigt INTEGER NOT NULL DEFAULT 0,
  beschluss_id INTEGER REFERENCES beschluesse(id) ON DELETE SET NULL
);
CREATE TABLE versammlung_teilnehmer (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  versammlung_id INTEGER NOT NULL REFERENCES versammlungen(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES personen(id),
  einheiten TEXT,                      -- z. B. „WE 1, Stellplatz 3“
  mea REAL,
  status TEXT,                         -- Anwesend, Abwesend, Vertreten (leer = noch offen)
  vertreter TEXT,
  unterschrift TEXT,                   -- PNG (data:) der Kenntnisnahme
  unterschrieben_am TEXT,
  UNIQUE (versammlung_id, person_id)
);
CREATE TABLE versammlung_stimmen (
  top_id INTEGER NOT NULL REFERENCES versammlung_tops(id) ON DELETE CASCADE,
  teilnehmer_id INTEGER NOT NULL REFERENCES versammlung_teilnehmer(id) ON DELETE CASCADE,
  stimme TEXT NOT NULL,                -- Ja, Nein, Enthaltung
  PRIMARY KEY (top_id, teilnehmer_id)
);
CREATE TABLE top_vorlagen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  art TEXT NOT NULL,                   -- Ordentliche Versammlung, Außerordentliche Versammlung, Umlaufbeschluss
  nr INTEGER NOT NULL,
  titel TEXT NOT NULL,
  antrag TEXT,
  beschluss INTEGER NOT NULL DEFAULT 0,
  bedingung TEXT                       -- beirat = nur wenn die Amtszeit des Beirats endet
);
INSERT INTO top_vorlagen (art, nr, titel, antrag, beschluss, bedingung) VALUES
 ('Ordentliche Versammlung', 1, 'Begrüßung, Feststellung der ordnungsgemäßen Einladung', NULL, 0, NULL),
 ('Ordentliche Versammlung', 2, 'Bericht der Verwaltung', NULL, 0, NULL),
 ('Ordentliche Versammlung', 3, 'Bericht des Verwaltungsbeirats', NULL, 0, NULL),
 ('Ordentliche Versammlung', 4, 'Nachschüsse und Anpassungen aus der Jahresabrechnung {vorjahr}', 'Die Eigentümer beschließen die Nachschüsse und die Anpassung der Vorschüsse gemäß den Einzelabrechnungen {vorjahr} (§ 28 Abs. 2 WEG).', 1, NULL),
 ('Ordentliche Versammlung', 5, 'Entlastung der Verwaltung für {vorjahr}', 'Der Verwaltung wird für das Wirtschaftsjahr {vorjahr} Entlastung erteilt.', 1, NULL),
 ('Ordentliche Versammlung', 6, 'Entlastung des Verwaltungsbeirats für {vorjahr}', 'Dem Verwaltungsbeirat wird für das Wirtschaftsjahr {vorjahr} Entlastung erteilt.', 1, NULL),
 ('Ordentliche Versammlung', 7, 'Vorschüsse nach dem Wirtschaftsplan {jahr}', 'Die Vorschüsse (Hausgeld) gemäß Wirtschaftsplan {jahr} werden beschlossen und gelten bis zur nächsten Beschlussfassung fort (§ 28 Abs. 1 WEG).', 1, NULL),
 ('Ordentliche Versammlung', 8, 'Wahl des Verwaltungsbeirats', 'Zu Mitgliedern des Verwaltungsbeirats werden gewählt: …', 1, 'beirat'),
 ('Ordentliche Versammlung', 9, 'Verschiedenes', NULL, 0, NULL),
 ('Außerordentliche Versammlung', 1, 'Begrüßung, Feststellung der ordnungsgemäßen Einladung', NULL, 0, NULL),
 ('Außerordentliche Versammlung', 2, 'Verschiedenes', NULL, 0, NULL),
 ('Umlaufbeschluss', 1, 'Beschluss im Umlaufverfahren', 'Die Eigentümer beschließen in Textform (§ 23 Abs. 3 WEG): …', 1, NULL);
`,
  // 27: Papierkorb – gelöschte Datensätze 30 Tage wiederherstellbar
  `
CREATE TABLE papierkorb (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  art TEXT NOT NULL,                   -- z. B. Mietvertrag, Kontakt, Liegenschaft
  bezeichnung TEXT,
  geloescht_am TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  daten TEXT NOT NULL                  -- JSON: gelöschte Zeilen je Tabelle und geleerte Verweise
);
`,
  // 28: Zählerstände je Einheit und Jahr (alt/neu), daraus wird der Verbrauch berechnet
  `
CREATE TABLE zaehlerstaende (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  einheit_id INTEGER NOT NULL REFERENCES einheiten(id) ON DELETE CASCADE,
  buchungskonto_id INTEGER NOT NULL REFERENCES buchungskonten(id),
  jahr INTEGER NOT NULL,
  zaehlernr TEXT,
  alt REAL,
  neu REAL,
  UNIQUE (einheit_id, jahr, buchungskonto_id)
);
`,
  // 29: WEG – Wohnung vom Eigentümer vermietet (auch ohne bei uns erfassten Mieter); dann braucht es die Anschrift des Eigentümers
  `
ALTER TABLE einheiten ADD COLUMN vermietet INTEGER NOT NULL DEFAULT 0;
`,
  // 30: Kommunikation mit Microsoft 365 – Mails in der Akte, Textvorlagen, Termine im Outlook-Kalender
  `
CREATE TABLE mails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  postfach TEXT,                   -- 'me' oder Adresse des freigegebenen Postfachs
  graph_id TEXT,                   -- Kennung der Mail bei Microsoft
  conversation_id TEXT,            -- Unterhaltung: Antworten werden darüber erkannt
  richtung TEXT NOT NULL,          -- 'aus' (gesendet) oder 'ein' (empfangen)
  von TEXT, an TEXT, betreff TEXT,
  datum TEXT NOT NULL,
  text TEXT,
  anhaenge TEXT,                   -- Dateinamen, durch „; “ getrennt
  person_id INTEGER REFERENCES personen(id) ON DELETE SET NULL,
  firma_id INTEGER REFERENCES firmen(id) ON DELETE SET NULL,
  objekt_id INTEGER REFERENCES objekte(id) ON DELETE SET NULL,
  abgelegt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX mails_person ON mails(person_id);
CREATE INDEX mails_unterhaltung ON mails(conversation_id);
CREATE TABLE mail_vorlagen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  betreff TEXT,
  text TEXT
);
INSERT INTO mail_vorlagen (name, betreff, text) VALUES
 ('Mahnung', '{Mahnstufe}: {Objekt}, {Einheit}', '{Briefanrede},

für {Einheit} in {Objekt} sind noch {Betrag} offen. Die {Mahnstufe} finden Sie im Anhang.

Bitte überweisen Sie den Betrag bis zum {Frist}.

Mit freundlichen Grüßen
{Sachbearbeiter}
KMS Immobilienverwaltung'),
 ('Nebenkostenabrechnung', 'Nebenkostenabrechnung {Jahr}: {Objekt}, {Einheit}', '{Briefanrede},

anbei erhalten Sie Ihre Nebenkostenabrechnung für {Jahr}.

Bei Fragen melden Sie sich gern.

Mit freundlichen Grüßen
{Sachbearbeiter}
KMS Immobilienverwaltung'),
 ('Hausgeldabrechnung', 'Hausgeldabrechnung {Jahr}: {Objekt}', '{Briefanrede},

anbei erhalten Sie die Hausgeldabrechnung {Jahr} für {Objekt}.

Mit freundlichen Grüßen
{Sachbearbeiter}
KMS Immobilienverwaltung'),
 ('Einladung Eigentümerversammlung', 'Einladung zur Eigentümerversammlung: {Objekt}', '{Briefanrede},

anbei erhalten Sie die Einladung zur Eigentümerversammlung mit Tagesordnung und Vollmacht.

Mit freundlichen Grüßen
{Sachbearbeiter}
KMS Immobilienverwaltung'),
 ('Niederschrift', 'Niederschrift der Eigentümerversammlung: {Objekt}', '{Briefanrede},

anbei erhalten Sie die Niederschrift der Eigentümerversammlung.

Mit freundlichen Grüßen
{Sachbearbeiter}
KMS Immobilienverwaltung'),
 ('Allgemeiner Brief', '{Dokument}', '{Briefanrede},

anbei erhalten Sie {Dokument}.

Mit freundlichen Grüßen
{Sachbearbeiter}
KMS Immobilienverwaltung');
CREATE TABLE outlook_termine (
  quelle TEXT NOT NULL,            -- termin, versammlung, frist
  quelle_id INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  stand TEXT,
  PRIMARY KEY (quelle, quelle_id)
);
INSERT OR IGNORE INTO einstellungen (schluessel, wert) VALUES
 ('ms_postfaecher', '["Info@kms.koeln","Kontakt@kms.koeln","Service@kms.koeln","Payment@kms.koeln","Ablesung@kms.koeln"]'),
 ('ms_kalender', '1'), ('ms_akte_auto', '1');
`,
  // 31: Splittbuchung – ein Betrag (z. B. Abschlag Strom und Wasser) auf mehrere Konten; Teile tragen die Nummer der Aufteilung.
  //     Gemerkte Aufteilungen je Zahlungspartner werden beim nächsten Umsatz vorgeschlagen.
  `
ALTER TABLE buchungen ADD COLUMN aufteilung INTEGER;
CREATE INDEX buchungen_aufteilung ON buchungen(aufteilung);
CREATE TABLE aufteilung_vorlagen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schluessel TEXT NOT NULL UNIQUE,  -- IBAN oder Name des Zahlungspartners (klein geschrieben)
  name TEXT,
  teile TEXT NOT NULL               -- JSON: [{ konto_id, anteil, text }]
);
`,
  // 32: Gesamtkosten eines Kontos nur für die Abrechnung anpassen (z. B. Heizkosten laut Messdienst statt Abschläge).
  //     Die Buchhaltung bleibt unverändert; die Abrechnung zeigt gebucht und angepasst.
  `
CREATE TABLE abrechnung_betraege (
  objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
  jahr INTEGER NOT NULL,
  buchungskonto_id INTEGER NOT NULL REFERENCES buchungskonten(id) ON DELETE CASCADE,
  betrag REAL NOT NULL,
  grund TEXT,
  ausgeschlossen INTEGER NOT NULL DEFAULT 0,   -- 1 = Kostenposition ganz aus der Abrechnung genommen
  PRIMARY KEY (objekt_id, jahr, buchungskonto_id)
);
`,
  // 33: Schutz der fest genutzten Kontonummern und Änderungsprotokoll (wer nicht, aber was und wann) für Buchungen, Rechnungen,
  //     offene Posten, Abschlüsse und gelöschte Bankumsätze. Abschluss aufheben nur mit Begründung.
  `
CREATE TRIGGER systemkonto_nummer BEFORE UPDATE OF nummer ON buchungskonten
WHEN OLD.nummer IN ('1000','1001','1002','1003','1010','1011','1200','1260','1261','1262','1405','1601','1602','1701') AND NEW.nummer IS NOT OLD.nummer
BEGIN SELECT RAISE(ABORT, 'Diese Kontonummer nutzt NEOSS fest (z. B. Rücklage, Hausgeld, Mieten, Heizkosten) und lässt sich nicht ändern. Bezeichnung und Haken dürfen geändert werden.'); END;
ALTER TABLE abrechnungen ADD COLUMN aufhebung_grund TEXT;
ALTER TABLE abrechnungen ADD COLUMN aufgehoben_am TEXT;
CREATE TABLE protokoll (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zeit TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  tabelle TEXT NOT NULL,
  datensatz INTEGER,
  aktion TEXT NOT NULL,        -- neu, geändert, gelöscht
  inhalt TEXT                  -- Stand des Datensatzes als JSON (bei „gelöscht“ der letzte Stand)
);
CREATE INDEX protokoll_zeit ON protokoll(zeit);
CREATE TRIGGER protokoll_buchungen_insert AFTER INSERT ON buchungen BEGIN INSERT INTO protokoll (tabelle, datensatz, aktion, inhalt) VALUES ('buchungen', NEW.id, 'neu', json_object('datum', NEW.datum, 'betrag', NEW.betrag, 'buchungskonto_id', NEW.buchungskonto_id, 'objekt_id', NEW.objekt_id, 'einheit_id', NEW.einheit_id, 'jahr', NEW.jahr, 'text', NEW.text, 'sollstellung_id', NEW.sollstellung_id, 'rechnung_id', NEW.rechnung_id, 'bankumsatz_id', NEW.bankumsatz_id)); END;
CREATE TRIGGER protokoll_buchungen_update AFTER UPDATE ON buchungen BEGIN INSERT INTO protokoll (tabelle, datensatz, aktion, inhalt) VALUES ('buchungen', NEW.id, 'geändert', json_object('datum', NEW.datum, 'betrag', NEW.betrag, 'buchungskonto_id', NEW.buchungskonto_id, 'objekt_id', NEW.objekt_id, 'einheit_id', NEW.einheit_id, 'jahr', NEW.jahr, 'text', NEW.text, 'sollstellung_id', NEW.sollstellung_id, 'rechnung_id', NEW.rechnung_id, 'bankumsatz_id', NEW.bankumsatz_id)); END;
CREATE TRIGGER protokoll_buchungen_delete AFTER DELETE ON buchungen BEGIN INSERT INTO protokoll (tabelle, datensatz, aktion, inhalt) VALUES ('buchungen', OLD.id, 'gelöscht', json_object('datum', OLD.datum, 'betrag', OLD.betrag, 'buchungskonto_id', OLD.buchungskonto_id, 'objekt_id', OLD.objekt_id, 'einheit_id', OLD.einheit_id, 'jahr', OLD.jahr, 'text', OLD.text, 'sollstellung_id', OLD.sollstellung_id, 'rechnung_id', OLD.rechnung_id, 'bankumsatz_id', OLD.bankumsatz_id)); END;
CREATE TRIGGER protokoll_rechnungen_insert AFTER INSERT ON rechnungen BEGIN INSERT INTO protokoll (tabelle, datensatz, aktion, inhalt) VALUES ('rechnungen', NEW.id, 'neu', json_object('datum', NEW.datum, 'betrag', NEW.betrag, 'buchungskonto_id', NEW.buchungskonto_id, 'objekt_id', NEW.objekt_id, 'einheit_id', NEW.einheit_id, 'rechnungsnr', NEW.rechnungsnr, 'firma_id', NEW.firma_id, 'bezahlt_am', NEW.bezahlt_am)); END;
CREATE TRIGGER protokoll_rechnungen_update AFTER UPDATE ON rechnungen BEGIN INSERT INTO protokoll (tabelle, datensatz, aktion, inhalt) VALUES ('rechnungen', NEW.id, 'geändert', json_object('datum', NEW.datum, 'betrag', NEW.betrag, 'buchungskonto_id', NEW.buchungskonto_id, 'objekt_id', NEW.objekt_id, 'einheit_id', NEW.einheit_id, 'rechnungsnr', NEW.rechnungsnr, 'firma_id', NEW.firma_id, 'bezahlt_am', NEW.bezahlt_am)); END;
CREATE TRIGGER protokoll_rechnungen_delete AFTER DELETE ON rechnungen BEGIN INSERT INTO protokoll (tabelle, datensatz, aktion, inhalt) VALUES ('rechnungen', OLD.id, 'gelöscht', json_object('datum', OLD.datum, 'betrag', OLD.betrag, 'buchungskonto_id', OLD.buchungskonto_id, 'objekt_id', OLD.objekt_id, 'einheit_id', OLD.einheit_id, 'rechnungsnr', OLD.rechnungsnr, 'firma_id', OLD.firma_id, 'bezahlt_am', OLD.bezahlt_am)); END;
CREATE TRIGGER protokoll_sollstellungen_update AFTER UPDATE ON sollstellungen BEGIN INSERT INTO protokoll (tabelle, datensatz, aktion, inhalt) VALUES ('sollstellungen', NEW.id, 'geändert', json_object('monat', NEW.monat, 'art', NEW.art, 'betrag', NEW.betrag, 'einheit_id', NEW.einheit_id, 'person_id', NEW.person_id, 'faellig', NEW.faellig)); END;
CREATE TRIGGER protokoll_sollstellungen_delete AFTER DELETE ON sollstellungen BEGIN INSERT INTO protokoll (tabelle, datensatz, aktion, inhalt) VALUES ('sollstellungen', OLD.id, 'gelöscht', json_object('monat', OLD.monat, 'art', OLD.art, 'betrag', OLD.betrag, 'einheit_id', OLD.einheit_id, 'person_id', OLD.person_id, 'faellig', OLD.faellig)); END;
CREATE TRIGGER protokoll_abrechnungen_insert AFTER INSERT ON abrechnungen BEGIN INSERT INTO protokoll (tabelle, datensatz, aktion, inhalt) VALUES ('abrechnungen', NEW.id, 'neu', json_object('objekt_id', NEW.objekt_id, 'art', NEW.art, 'jahr', NEW.jahr, 'status', NEW.status, 'abgeschlossen_am', NEW.abgeschlossen_am, 'aufhebung_grund', NEW.aufhebung_grund)); END;
CREATE TRIGGER protokoll_abrechnungen_update AFTER UPDATE ON abrechnungen BEGIN INSERT INTO protokoll (tabelle, datensatz, aktion, inhalt) VALUES ('abrechnungen', NEW.id, 'geändert', json_object('objekt_id', NEW.objekt_id, 'art', NEW.art, 'jahr', NEW.jahr, 'status', NEW.status, 'abgeschlossen_am', NEW.abgeschlossen_am, 'aufhebung_grund', NEW.aufhebung_grund)); END;
CREATE TRIGGER protokoll_bankumsaetze_delete AFTER DELETE ON bankumsaetze BEGIN INSERT INTO protokoll (tabelle, datensatz, aktion, inhalt) VALUES ('bankumsaetze', OLD.id, 'gelöscht', json_object('datum', OLD.datum, 'betrag', OLD.betrag, 'gegenpartei', OLD.gegenpartei, 'verwendungszweck', OLD.verwendungszweck, 'status', OLD.status, 'bankkonto_id', OLD.bankkonto_id)); END;
ALTER TABLE versammlung_tops ADD COLUMN mehrheit TEXT DEFAULT 'einfach';
`,
  // 34: Kontoabgleich zur Jahresabrechnung – Kontostand laut echtem Kontoauszug zum 31.12. je Bankkonto und Jahr
  `
CREATE TABLE kontoabgleich (
  bankkonto_id INTEGER NOT NULL REFERENCES bankkonten(id) ON DELETE CASCADE,
  jahr INTEGER NOT NULL,
  saldo_auszug REAL NOT NULL,
  notiz TEXT,
  erfasst_am TEXT,
  PRIMARY KEY (bankkonto_id, jahr)
);
`,
  // 35: Live-Versammlung – Beschlussfeld: der in der Versammlung niedergeschriebene Wortlaut des Beschlusses (der Antrag bleibt unverändert)
  `
ALTER TABLE versammlung_tops ADD COLUMN beschluss_text TEXT;
`,
  // 36: Einnahmen & Ausgaben mit Kontostand – Buchung bewusst ohne Bankkonto (bar, Umbuchung, Verrechnung): zählt nicht als „ohne Kontoumsatz“
  `
ALTER TABLE buchungen ADD COLUMN zahlweg TEXT;
`,
  // 37: Einnahmen & Ausgaben – Kontostand zum 01.01. je Bankkonto und Jahr von Hand (z. B. wenn das ganze Jahr ohne Kontoauszüge gebucht wird)
  `
CREATE TABLE kontostart (
  bankkonto_id INTEGER NOT NULL REFERENCES bankkonten(id) ON DELETE CASCADE,
  jahr INTEGER NOT NULL,
  betrag REAL NOT NULL,
  erfasst_am TEXT,
  PRIMARY KEY (bankkonto_id, jahr)
);
`,
  // 38: Rücklagen – Anfangs- und Endbestand des Rücklagenkontos laut Kontoauszug je Liegenschaft und Jahr (von Hand)
  `
CREATE TABLE ruecklage_auszug (
  objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
  jahr INTEGER NOT NULL,
  anfang REAL, anfang_auszug TEXT,
  ende REAL, ende_datum TEXT, ende_auszug TEXT,
  erfasst_am TEXT,
  PRIMARY KEY (objekt_id, jahr)
);
`,
  // 39: WEG-Abrechnung – je Kostenkonto der Teil, der aus der Erhaltungsrücklage bezahlt wurde (wird nach MEA gutgeschrieben)
  `
CREATE TABLE abrechnung_ruecklage (
  objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
  jahr INTEGER NOT NULL,
  buchungskonto_id INTEGER NOT NULL REFERENCES buchungskonten(id) ON DELETE CASCADE,
  betrag REAL NOT NULL,
  notiz TEXT,
  PRIMARY KEY (objekt_id, jahr, buchungskonto_id)
);
`,
];
