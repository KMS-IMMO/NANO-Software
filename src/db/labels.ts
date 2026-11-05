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
