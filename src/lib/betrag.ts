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
  let t = String(s).replace(/[\s\u00A0€]/g, '').replace(/−/g, '-');
  if (!t) return null;
  if (t.includes(',') && t.includes('.') && t.lastIndexOf('.') > t.lastIndexOf(',')) t = t.replace(/,/g, '');  // englisch: 1,234.56
  else if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Formatiert eine Betragseingabe schon beim Tippen: Tausenderpunkte werden selbst gesetzt, das Komma trennt die Cent (höchstens zwei Stellen).
 * „11354“ → „11.354“, „11354,5“ → „11.354,5“, „-1234“ → „-1.234“. Getippte Punkte zählen nicht (die setzt das Feld selbst).
 * `caret` = Cursorposition in `roh`; zurück kommt die passende Position im neuen Text (gleich viele Ziffern/Komma davor).
 */
export function betragLive(roh: string, caret = roh.length): { text: string; caret: number } {
  const t = String(roh ?? '').replace(/[\s\u00A0€]/g, '').replace(/\u2212/g, '-');
  const minus = t.trimStart().startsWith('-');
  const k = t.indexOf(',');
  let ganz = (k < 0 ? t : t.slice(0, k)).replace(/\D/g, '');
  const cent = k < 0 ? null : t.slice(k + 1).replace(/\D/g, '').slice(0, 2);
  ganz = ganz.replace(/^0+(?=\d)/, '');
  if (!ganz && cent !== null) ganz = '0';
  const text = (minus ? '-' : '') + ganz.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (cent !== null ? ',' + cent : '');
  // Cursor: Anzahl bedeutsamer Zeichen (Ziffern, Komma, Minus) vor dem Cursor bleibt gleich
  const wichtig = (c: string) => /[\d,-]/.test(c);
  let n = 0;
  for (const c of String(roh ?? '').slice(0, caret)) if (wichtig(c)) n++;
  // führende Nullen, die entfernt wurden, nicht mitzählen
  let pos = 0, gezaehlt = 0;
  while (pos < text.length && gezaehlt < n) { if (wichtig(text[pos])) gezaehlt++; pos++; }
  return { text, caret: Math.min(pos, text.length) };
}
