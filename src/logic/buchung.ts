// Buchungen und Rechnungen löschen, ohne Bank, offene Posten und Rechnungen in einem falschen Zustand zu lassen.
import { db, type Row } from '../db';

/** Löscht eine Buchung. Hing sie an einem Bankumsatz, wird dieser wieder „offen“, sobald keine Buchung mehr daran hängt.
 *  Hing sie an einer Rechnung, wird die Rechnung wieder unbezahlt, oder mit `mitRechnung` ganz gelöscht. */
export async function buchungLoeschen(id: number, opt: { mitRechnung?: boolean } = {}) {
  const b = (await db.select('SELECT * FROM buchungen WHERE id = $1', [id]))[0];
  if (!b) return;
  await db.execute('DELETE FROM buchungen WHERE id = $1', [id]);
  await db.execute(`DELETE FROM dokumente WHERE bezug = 'Buchung' AND bezug_id = $1`, [id]);   // Datei bleibt in der Ablage
  if (b.bankumsatz_id) {
    const rest = await db.select('SELECT 1 FROM buchungen WHERE bankumsatz_id = $1', [b.bankumsatz_id]);
    if (!rest.length) await db.execute(`UPDATE bankumsaetze SET status = 'offen' WHERE id = $1`, [b.bankumsatz_id]);
  }
  if (b.rechnung_id) {
    const rest = await db.select('SELECT 1 FROM buchungen WHERE rechnung_id = $1', [b.rechnung_id]);
    if (!rest.length) {
      if (opt.mitRechnung) await db.execute('DELETE FROM rechnungen WHERE id = $1', [b.rechnung_id]);
      else await db.execute('UPDATE rechnungen SET bezahlt_am = NULL WHERE id = $1', [b.rechnung_id]);
    }
  }
}

/** Hinweis vor dem Löschen: was passiert mit Bank, Rechnung oder offenem Posten */
export function loeschHinweis(b: Row, mitRechnung = false) {
  const t: string[] = [];
  if (b.bankumsatz_id) t.push('Der Bankumsatz erscheint danach wieder als „offen“ unter Bank & Zuordnung.');
  if (b.rechnung_id) t.push(mitRechnung ? 'Die zugehörige Rechnung wird ebenfalls gelöscht.' : 'Die zugehörige Rechnung steht danach wieder unter „Offene Rechnungen“.');
  if (b.sollstellung_id) t.push('Der zugehörige offene Posten gilt danach wieder als unbezahlt.');
  return t.join(' ');
}

/** Buchungsjahr einer Buchung als SQL: das im Buchen-Fenster gewählte Jahr, sonst das Jahr des Buchungsdatums */
export const BJ = (a = 'b') => `COALESCE(${a ? a + '.' : ''}jahr, CAST(substr(${a ? a + '.' : ''}datum, 1, 4) AS INTEGER))`;
