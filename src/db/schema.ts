// Datenbankschema der NANO-Software (KMS Immobilien).
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
];
