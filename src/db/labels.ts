/** SQL-Ausdruck für den Anzeigenamen einer Person: "Firma, Nachname, Vorname" */
export const personLabel = (a = 'p') =>
  `TRIM(COALESCE(${a}.firma, '') || CASE WHEN ${a}.firma IS NOT NULL AND ${a}.nachname IS NOT NULL THEN ', ' ELSE '' END ||
   COALESCE(${a}.nachname, '') || CASE WHEN ${a}.vorname IS NOT NULL THEN ', ' || ${a}.vorname ELSE '' END)`;

export const personOptions = (rolle?: string) =>
  `SELECT p.id AS value, ${personLabel('p')} AS label FROM personen p ${rolle ? `WHERE p.rolle = '${rolle}'` : ''} ORDER BY label`;

export const kontoOptions = (where = '1=1') =>
  `SELECT id AS value, nummer || ' ' || name AS label FROM buchungskonten WHERE ${where} ORDER BY nummer`;

export const AKTIV = (a = 'v') => `${a}.beginn <= date('now') AND (${a}.ende IS NULL OR ${a}.ende >= date('now'))`;

export const SCHLUESSEL = ['Fläche', 'Personen', 'Einheiten', 'MEA', 'Summe', 'Verbrauch', 'Direkt'];
export const EINHEIT_TYPEN = ['Wohnung', 'Gewerbe', 'Stellplatz', 'Garage', 'Keller', 'Sonstiges'];

/** SQL-Ausdruck für die Wohnungs-ID (W-ID): Liegenschaftsnummer und laufende Nummer der Einheit, z. B. 1002-01 */
export const widSql = (e = 'e', o = 'o') =>
  `(${o}.objekt_nr || '-' || substr('00' || COALESCE(${e}.lfd_nr, 0), -2, 2))`;
/** W-ID im Programm bilden */
export const wid = (objektNr: string | number | null | undefined, lfdNr: number | null | undefined) =>
  objektNr && lfdNr ? `${objektNr}-${String(lfdNr).padStart(2, '0')}` : '';

/** Arten der Warmwasserversorgung einer Liegenschaft */
export const WARMWASSER = ['Zentral über die Heizung', 'Durchlauferhitzer (elektrisch)', 'Gas-Durchlauferhitzer / Therme', 'Boiler / Speicher je Wohnung', 'Fernwärme', 'Wärmepumpe', 'Solarthermie mit Zentralspeicher', 'Sonstige'];

/** Name des aktuellen Mieters, sonst des Eigentümers einer Einheit (für Auswahllisten: „WE 01 · Müller, Anna“) */
export const einheitPerson = (e = 'e') => `COALESCE(
  (SELECT ${personLabel('pm')} FROM mietvertraege vm JOIN personen pm ON pm.id = vm.mieter_id
    WHERE vm.einheit_id = ${e}.id AND vm.beginn <= date('now', '+3 months') AND (vm.ende IS NULL OR vm.ende >= date('now')) ORDER BY vm.beginn DESC LIMIT 1),
  (SELECT ${personLabel('pe')} FROM eigentum ee JOIN personen pe ON pe.id = ee.person_id
    WHERE ee.einheit_id = ${e}.id AND (ee.bis IS NULL OR ee.bis >= date('now')) ORDER BY ee.anteil DESC LIMIT 1))`;
/** „WE 01 · Müller, Anna“ */
export const einheitLabel = (e = 'e') => `${e}.nummer || COALESCE(' · ' || ${einheitPerson(e)}, '')`;
