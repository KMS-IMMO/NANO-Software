// Buchungen und Rechnungen löschen, ohne Bank, offene Posten und Rechnungen in einem falschen Zustand zu lassen.
import { db, type Row } from '../db';
import { ablegen, erfassen } from '../db/papierkorb';

/** Löscht eine Buchung. Hing sie an einem Bankumsatz, wird dieser wieder „offen“, sobald keine Buchung mehr daran hängt.
 *  Hing sie an einer Rechnung, wird die Rechnung wieder unbezahlt, oder mit `mitRechnung` ganz gelöscht. */
export async function buchungLoeschen(id: number, opt: { mitRechnung?: boolean } = {}) {
  const b = (await db.select('SELECT * FROM buchungen WHERE id = $1', [id]))[0];
  if (!b) return;
  const inhalt = await erfassen([{ t: 'buchungen', where: 'id = $1', params: [id] }, { t: 'dokumente', where: `bezug = 'Buchung' AND bezug_id = $1`, params: [id] },
    ...(b.rechnung_id && opt.mitRechnung ? [{ t: 'rechnungen', where: 'id = $1', params: [b.rechnung_id] }] : [])]);
  // beim Wiederherstellen: Bankumsatz und Rechnung wieder in den alten Zustand
  const um = b.bankumsatz_id ? (await db.select('SELECT status FROM bankumsaetze WHERE id = $1', [b.bankumsatz_id]))[0] : null;
  const re = b.rechnung_id ? (await db.select('SELECT bezahlt_am FROM rechnungen WHERE id = $1', [b.rechnung_id]))[0] : null;
  inhalt.wieder = [...(um ? [{ sql: 'UPDATE bankumsaetze SET status = $1 WHERE id = $2', params: [um.status, b.bankumsatz_id] }] : []),
    ...(re ? [{ sql: 'UPDATE rechnungen SET bezahlt_am = $1 WHERE id = $2', params: [re.bezahlt_am, b.rechnung_id] }] : [])];
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
  await ablegen('Buchung', [b.datum?.split('-').reverse().join('.'), b.text, `${Number(b.betrag).toLocaleString('de-DE', { minimumFractionDigits: 2 })} €`].filter(Boolean).join(' · '), inhalt);
}

/** Löscht alle Teile einer Splittbuchung in einem Schritt (ein Eintrag im Papierkorb). Der Bankumsatz wird wieder „offen“. */
export async function aufteilungLoeschen(gruppe: number) {
  const teile = await db.select('SELECT * FROM buchungen WHERE aufteilung = $1 ORDER BY id', [gruppe]);
  if (!teile.length) return;
  const ids = teile.map((b) => Number(b.id)).join(',');
  const inhalt = await erfassen([{ t: 'buchungen', where: `id IN (${ids})` }, { t: 'dokumente', where: `bezug = 'Buchung' AND bezug_id IN (${ids})` }]);
  const bank = [...new Set(teile.map((b) => b.bankumsatz_id).filter(Boolean))];
  const stand = bank.length ? await db.select(`SELECT id, status FROM bankumsaetze WHERE id IN (${bank.join(',')})`) : [];
  inhalt.wieder = stand.map((u) => ({ sql: 'UPDATE bankumsaetze SET status = $1 WHERE id = $2', params: [u.status, u.id] }));
  await db.execute(`DELETE FROM buchungen WHERE id IN (${ids})`);
  await db.execute(`DELETE FROM dokumente WHERE bezug = 'Buchung' AND bezug_id IN (${ids})`);
  for (const id of bank) {
    const rest = await db.select('SELECT 1 FROM buchungen WHERE bankumsatz_id = $1', [id]);
    if (!rest.length) await db.execute(`UPDATE bankumsaetze SET status = 'offen' WHERE id = $1`, [id]);
  }
  const summe = teile.reduce((a, b) => a + Math.abs(Number(b.betrag)), 0);
  await ablegen('Buchung', [teile[0].datum?.split('-').reverse().join('.'), `Aufteilung in ${teile.length} Teile`, teile[0].text,
    `${summe.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €`].filter(Boolean).join(' · '), inhalt);
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
