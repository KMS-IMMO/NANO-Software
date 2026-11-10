// Einheitliche Darstellung und Eingabe von Geldbeträgen: immer 1.234,00 € (deutsches Format, zwei Nachkommastellen).

const FORMAT = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Zahl als Betrag ohne Währungszeichen: 1234.5 → „1.234,50“ (−0,00 wird zu 0,00) */
export function betragText(n: number): string {
  const r = Math.round(n * 100) / 100;
  return FORMAT.format(Math.abs(r) < 0.005 ? 0 : r);
}

/** Zahl als Betrag mit Euro: 1234.5 → „1.234,50 €“ (geschütztes Leerzeichen, bricht nicht um) */
export function euro(n: number): string {
  return betragText(n) + ' €';
}

/**
 * Liest eine Eingabe als Zahl. Versteht „1.234,50“, „1234,5“, „1234.50“, „1.000“, „-12,00 €“.
 * Mit Komma: Punkte sind Tausenderpunkte. Ohne Komma: „1.000“ / „12.345.678“ sind Tausender, sonst ist der Punkt das Dezimalzeichen.
 * Leer oder ungültig → null. Zahlen werden unverändert zurückgegeben.
 */
export function betragZahl(s: unknown): number | null {
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  if (s === null || s === undefined) return null;
  let t = String(s).replace(/[\s €]/g, '').replace(/−/g, '-');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
