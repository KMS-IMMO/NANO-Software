// Kontoabgleich zur Jahresabrechnung: Anfangs- und Endbestand je Bankkonto und eine zweite Prüfung,
// ob alles gebucht ist, was laut Kontoauszügen zu buchen war.
//  1. Stand 01.01. + Eingänge + Ausgänge = Stand 31.12. (aus den eingelesenen Kontoumsätzen)
//  2. Stand 31.12. laut echtem Kontoauszug (von Hand eingetragen) gegen den errechneten Stand: so fallen fehlende Umsätze auf
//  3. Jeder Umsatz des Jahres ist gebucht (oder bewusst ignoriert), und die Buchungen ergeben genau den Umsatzbetrag
//  4. Monate ohne einen einzigen Umsatz (Hinweis auf fehlende Kontoauszüge)
import { db, type Row } from '../db';
import type { Pruefung } from './abschluss';

const r2 = (n: number) => Math.round(n * 100) / 100;
const eurT = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const dT = (d: string) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10).split('-').reverse().join('.') : d);
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export interface Umsatz { id: number; datum: string; betrag: number; gegenpartei: string; zweck: string; gebucht?: number }
export interface KontoAbgleich {
  id: number; name: string; iban: string;
  /** Erster Tag, ab dem Umsätze vorliegen, wenn das nach dem 01.01. ist */
  erfasstAb: string | null;
  start: number; ein: number; aus: number; ende: number;
  /** Kontostand laut Kontoauszug zum 31.12. (eingetragen), null = noch nicht eingetragen */
  auszug: number | null; notiz: string; differenz: number | null;
  anzahl: number; gebucht: number; ignoriert: number; ignoriertSumme: number;
  offen: Umsatz[]; offenSumme: number;
  /** Zugeordnete Umsätze, deren Buchungen nicht genau den Umsatzbetrag ergeben */
  abweichend: Umsatz[];
  monateOhne: string[];
  ok: boolean;
}

export async function kontoabgleich(objekt: number, jahr: number): Promise<KontoAbgleich[]> {
  const von = `${jahr}-01-01`, bis = `${jahr}-12-31`;
  const konten = await db.select('SELECT * FROM bankkonten WHERE objekt_id = $1 ORDER BY id', [objekt]);
  const out: KontoAbgleich[] = [];
  for (const k of konten) {
    // Umsätze am oder vor dem Saldotag stecken schon im Anfangssaldo und zählen nicht doppelt
    const nach = '(k.saldo_datum IS NULL OR u.datum > k.saldo_datum)';
    const start = Number((await db.select(`SELECT k.anfangssaldo + COALESCE((SELECT SUM(u.betrag) FROM bankumsaetze u WHERE u.bankkonto_id = k.id AND u.datum < $2 AND ${nach}), 0) AS s
      FROM bankkonten k WHERE k.id = $1`, [k.id, von]))[0]?.s ?? 0);
    const u: Row[] = await db.select(`SELECT u.*, (SELECT SUM(b.betrag) FROM buchungen b WHERE b.bankumsatz_id = u.id) AS gebucht
      FROM bankumsaetze u JOIN bankkonten k ON k.id = u.bankkonto_id WHERE u.bankkonto_id = $1 AND u.datum BETWEEN $2 AND $3 AND ${nach} ORDER BY u.datum, u.id`, [k.id, von, bis]);
    const ein = r2(u.filter((x) => x.betrag > 0).reduce((a, x) => a + Number(x.betrag), 0));
    const aus = r2(u.filter((x) => x.betrag < 0).reduce((a, x) => a + Number(x.betrag), 0));
    const ende = r2(start + ein + aus);
    const m = (x: Row): Umsatz => ({ id: x.id, datum: x.datum, betrag: Number(x.betrag), gegenpartei: x.gegenpartei ?? '', zweck: x.verwendungszweck ?? '', gebucht: x.gebucht == null ? 0 : r2(Number(x.gebucht)) });
    const offen = u.filter((x) => x.status === 'offen').map(m);
    const ign = u.filter((x) => x.status === 'ignoriert');
    const abweichend = u.filter((x) => x.status === 'zugeordnet' && Math.abs(r2(Number(x.gebucht ?? 0)) - r2(Number(x.betrag))) > 0.005).map(m);
    const ab = (await db.select('SELECT saldo_auszug, notiz FROM kontoabgleich WHERE bankkonto_id = $1 AND jahr = $2', [k.id, jahr]))[0];
    const auszug = ab?.saldo_auszug == null ? null : Number(ab.saldo_auszug);
    const differenz = auszug == null ? null : r2(auszug - ende);
    // Ab wann liegen Umsätze vor? Saldotag nach dem 01.01. heißt: Auszüge erst ab dem Folgetag erfasst
    const erfasstAb = k.saldo_datum && k.saldo_datum >= von && k.saldo_datum < bis
      ? new Date(new Date(k.saldo_datum + 'T12:00:00').getTime() + 864e5).toISOString().slice(0, 10) : null;
    const ersterMonat = erfasstAb ? Number(erfasstAb.slice(5, 7)) : 1;
    const heute = new Date().toISOString().slice(0, 10);
    const monateOhne = (k.saldo_datum && k.saldo_datum >= bis) ? [] : MONATE.filter((_, i) => {
      const mm = `${jahr}-${String(i + 1).padStart(2, '0')}`;
      return i + 1 >= ersterMonat && `${mm}-31` < heute.slice(0, 7) + '-01' && !u.some((x) => String(x.datum).startsWith(mm));
    });
    out.push({
      id: k.id, name: k.name, iban: k.iban ?? '', erfasstAb, start: r2(start), ein, aus, ende, auszug, notiz: ab?.notiz ?? '', differenz,
      anzahl: u.length, gebucht: u.filter((x) => x.status === 'zugeordnet').length, ignoriert: ign.length, ignoriertSumme: r2(ign.reduce((a, x) => a + Number(x.betrag), 0)),
      offen, offenSumme: r2(offen.reduce((a, x) => a + x.betrag, 0)), abweichend, monateOhne,
      ok: !offen.length && !abweichend.length && differenz !== null && Math.abs(differenz) < 0.005,
    });
  }
  return out;
}

/** Kontostand laut Kontoauszug zum 31.12. eintragen (leer = wieder entfernen) */
export async function auszugSpeichern(bankkontoId: number, jahr: number, saldo: number | null, notiz = '') {
  if (saldo === null || Number.isNaN(saldo)) { await db.execute('DELETE FROM kontoabgleich WHERE bankkonto_id = $1 AND jahr = $2', [bankkontoId, jahr]); return; }
  await db.execute(`INSERT INTO kontoabgleich (bankkonto_id, jahr, saldo_auszug, notiz, erfasst_am) VALUES ($1, $2, $3, $4, datetime('now', 'localtime'))
    ON CONFLICT (bankkonto_id, jahr) DO UPDATE SET saldo_auszug = excluded.saldo_auszug, notiz = excluded.notiz, erfasst_am = excluded.erfasst_am`, [bankkontoId, jahr, r2(saldo), notiz || null]);
}

/** Punkte für die Prüfliste beim Abschluss. Offene Umsätze prüft der Abschluss schon selbst. */
export function abgleichPruefungen(l: KontoAbgleich[], jahr: number): Pruefung[] {
  if (!l.length) return [];
  const out: Pruefung[] = [];
  const abw = l.flatMap((k) => k.abweichend.map((u) => ({ k, u })));
  out.push({ ok: !abw.length, sperrt: true, text: 'Gebuchte Beträge stimmen mit den Kontoumsätzen überein',
    hinweis: abw.length ? abw.slice(0, 3).map(({ k, u }) => `${k.name}: ${dT(u.datum)} ${u.gegenpartei} ${eurT(u.betrag)}, gebucht ${eurT(u.gebucht ?? 0)}`).join('; ') + (abw.length > 3 ? ` und ${abw.length - 3} weitere` : '') : undefined });
  const fehlt = l.filter((k) => k.auszug === null), diff = l.filter((k) => k.differenz !== null && Math.abs(k.differenz) >= 0.005);
  if (diff.length) out.push({ ok: false, sperrt: true, text: `Endbestand 31.12.${jahr} stimmt mit dem Kontoauszug überein`,
    hinweis: diff.map((k) => `${k.name}: laut Auszug ${eurT(k.auszug!)}, errechnet ${eurT(k.ende)}, Differenz ${eurT(k.differenz!)}. Wahrscheinlich fehlen Umsätze.`).join(' ') });
  else out.push({ ok: !fehlt.length, sperrt: false, text: `Endbestand 31.12.${jahr} mit dem Kontoauszug abgeglichen`,
    hinweis: fehlt.length ? `Kontostand laut Auszug noch nicht eingetragen: ${fehlt.map((k) => k.name).join(', ')} (Karte „Kontoabgleich“).` : undefined });
  const luecken = l.filter((k) => k.monateOhne.length);
  if (luecken.length) out.push({ ok: false, sperrt: false, text: 'Für jeden Monat liegen Kontoumsätze vor',
    hinweis: luecken.map((k) => `${k.name}: keine Umsätze im ${k.monateOhne.join(', ')}`).join('; ') + '. Bitte prüfen, ob Kontoauszüge fehlen.' });
  return out;
}

/** Kurzer Text für den KI-Agenten und die PDF */
export function abgleichText(l: KontoAbgleich[], jahr: number): string {
  if (!l.length) return 'Für diese Liegenschaft ist kein Bankkonto angelegt.';
  return l.map((k) => [
    `${k.name}${k.iban ? ` (${k.iban})` : ''}: Stand 01.01.${jahr} ${eurT(k.start)}, Eingänge ${eurT(k.ein)}, Ausgänge ${eurT(k.aus)}, Stand 31.12.${jahr} ${eurT(k.ende)}.`,
    k.erfasstAb ? `Umsätze liegen erst ab ${dT(k.erfasstAb)} vor.` : '',
    k.auszug === null ? 'Kontostand laut Kontoauszug zum 31.12. ist nicht eingetragen.'
      : Math.abs(k.differenz!) < 0.005 ? `Stimmt mit dem Kontoauszug überein (${eurT(k.auszug)}).` : `Laut Kontoauszug ${eurT(k.auszug)}, Differenz ${eurT(k.differenz!)}.`,
    `${k.anzahl} Umsätze, davon ${k.gebucht} gebucht, ${k.ignoriert} ignoriert (${eurT(k.ignoriertSumme)}), ${k.offen.length} offen (${eurT(k.offenSumme)}).`,
    ...k.offen.slice(0, 20).map((u) => `  offen: ${dT(u.datum)} ${eurT(u.betrag)} ${u.gegenpartei} ${u.zweck}`.trimEnd()),
    ...k.abweichend.slice(0, 20).map((u) => `  Buchung weicht ab: ${dT(u.datum)} ${u.gegenpartei} Umsatz ${eurT(u.betrag)}, gebucht ${eurT(u.gebucht ?? 0)}`),
    k.monateOhne.length ? `Keine Umsätze im ${k.monateOhne.join(', ')}.` : '',
  ].filter(Boolean).join('\n')).join('\n\n');
}
