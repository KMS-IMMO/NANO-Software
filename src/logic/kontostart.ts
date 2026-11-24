// Kontostand zum 01.01. je Bankkonto und Jahr, von Hand eingegeben (unter „Einnahmen & Ausgaben“ in der Kontostand-Leiste).
// Gedacht für Jahre, die ganz oder teilweise ohne eingelesene Kontoauszüge gebucht werden.
//
// Ohne Eingabe gilt wie bisher: Anfangssaldo des Bankkontos (zum „Saldo zum“-Tag) + alle Kontoumsätze danach bis zum 31.12. des Vorjahres.
// Mit Eingabe gilt die Eingabe als Stand 01.01.
//   • Stand laut Buchungen beginnt immer mit der Eingabe; Buchungen vor dem Beginn der Kontoumsätze zählen dann mit.
//   • Stand laut Bank beginnt mit der Eingabe, solange der Anfangssaldo des Kontos vor dem 01.01. liegt. Beginnen die
//     Kontoumsätze erst im Lauf des Jahres (Anfangssaldo zu einem späteren Tag), bleibt der Stand laut Bank beim Anfangssaldo,
//     denn der kommt vom echten Kontoauszug. Die Differenz zeigt dann, ob die Buchungen bis dahin aufgehen.
import { db, type Row } from '../db';
import { gesperrt, sperrText } from './abschluss';

const r2 = (n: number) => Math.round(n * 100) / 100;
const NACH = '(k.saldo_datum IS NULL OR u.datum > k.saldo_datum)';

/** Von Hand eingegebener Stand 01.01. eines Bankkontos, sonst null */
export async function startManuell(bankkontoId: number, jahr: number): Promise<number | null> {
  const r = (await db.select('SELECT betrag FROM kontostart WHERE bankkonto_id = $1 AND jahr = $2', [bankkontoId, jahr]))[0];
  return r?.betrag == null ? null : r2(Number(r.betrag));
}

/** Stand laut Kontoumsätzen zu Beginn des Tages `von`: Anfangssaldo + Kontoumsätze nach dem Saldotag (ohne Eingabe von Hand) */
export async function startLautUmsaetzen(bankkontoId: number, von: string): Promise<number> {
  return r2(Number((await db.select(`SELECT k.anfangssaldo + COALESCE((SELECT SUM(u.betrag) FROM bankumsaetze u WHERE u.bankkonto_id = k.id AND u.datum < $2 AND ${NACH}), 0) AS s
    FROM bankkonten k WHERE k.id = $1`, [bankkontoId, von]))[0]?.s ?? 0));
}

/** Gilt die Eingabe von Hand auch für den Stand laut Bank? Nur wenn die Kontoumsätze vor dem 01.01. beginnen (oder kein Saldotag gesetzt ist). */
export const startGiltFuerBank = (k: Row, jahr: number) => !k.saldo_datum || String(k.saldo_datum) < `${jahr}-01-01`;

/** Stand eines Bankkontos laut Bank zu Beginn des Tages `von` (im Jahr von `von`), mit Eingabe von Hand, wenn sie für die Bank gilt */
export async function bankStart(k: Row, von: string): Promise<number> {
  const jahr = Number(von.slice(0, 4));
  const m = startGiltFuerBank(k, jahr) ? await startManuell(Number(k.id), jahr) : null;
  if (m === null) return startLautUmsaetzen(Number(k.id), von);
  if (von <= `${jahr}-01-01`) return m;
  const s = (await db.select(`SELECT COALESCE(SUM(u.betrag), 0) AS s FROM bankumsaetze u JOIN bankkonten k ON k.id = u.bankkonto_id
    WHERE u.bankkonto_id = $1 AND u.datum >= $2 AND u.datum < $3 AND ${NACH}`, [k.id, `${jahr}-01-01`, von]))[0]?.s ?? 0;
  return r2(m + Number(s));
}

/** Stand 01.01. von Hand speichern (null oder leer = Eingabe entfernen, dann gilt wieder der Stand laut Kontoumsätzen) */
export async function startSpeichern(bankkontoId: number, jahr: number, betrag: number | null) {
  const k = (await db.select('SELECT objekt_id FROM bankkonten WHERE id = $1', [bankkontoId]))[0];
  if (!k) throw new Error('Das Bankkonto gibt es nicht mehr.');
  const sp = await gesperrt(Number(k.objekt_id), `${jahr}-01-01`);
  if (sp) throw new Error(sperrText(sp));
  if (betrag === null) { await db.execute('DELETE FROM kontostart WHERE bankkonto_id = $1 AND jahr = $2', [bankkontoId, jahr]); return; }
  if (!Number.isFinite(betrag)) throw new Error('Der Betrag ist keine Zahl.');
  await db.execute(`INSERT INTO kontostart (bankkonto_id, jahr, betrag, erfasst_am) VALUES ($1, $2, $3, datetime('now', 'localtime'))
    ON CONFLICT (bankkonto_id, jahr) DO UPDATE SET betrag = excluded.betrag, erfasst_am = excluded.erfasst_am`, [bankkontoId, jahr, r2(betrag)]);
}

/** Betrag aus einem Eingabefeld (1.234,56 oder 1234.56 oder -50) */
export function betragLesen(s: string): number | null {
  const t = String(s ?? '').replace(/[€\s]/g, '');
  if (!t) return null;
  // Komma = Dezimaltrennzeichen; ohne Komma sind Punkte in 1.234 oder 12.345.678 Tausenderpunkte
  const n = Number(/,/.test(t) ? t.replace(/\./g, '').replace(',', '.') : /^-?\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t);
  return Number.isFinite(n) ? n : NaN;
}
