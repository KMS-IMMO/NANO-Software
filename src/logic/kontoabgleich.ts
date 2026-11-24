// Kontoabgleich zur Jahresabrechnung: Anfangs- und Endbestand je Bankkonto und eine zweite Prüfung,
// ob alles gebucht ist, was laut Kontoauszügen zu buchen war.
//  1. Stand 01.01. + Eingänge + Ausgänge = Stand 31.12. (aus den eingelesenen Kontoumsätzen)
//  2. Stand 31.12. laut echtem Kontoauszug (von Hand eingetragen) gegen den errechneten Stand: so fallen fehlende Umsätze auf
//  3. Jeder Umsatz des Jahres ist gebucht (oder bewusst ignoriert), und die Buchungen ergeben genau den Umsatzbetrag
//  4. Monate ohne einen einzigen Umsatz (Hinweis auf fehlende Kontoauszüge)
import { bankStart } from './kontostart';
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
  /** Regelmäßige Zahler (mind. 6 Eingänge im Jahr), bei denen in einzelnen Monaten kein oder ein doppelter Eingang vorliegt */
  regelmaessig: { name: string; betrag: number; anzahl: number; fehlt: string[]; doppelt: string[] }[];
  /** Gelöschte Umsätze dieses Jahres (laut Änderungsprotokoll), die nicht wieder eingelesen wurden */
  geloescht: (Umsatz & { geloeschtAm: string })[];
  /** Buchungen der Liegenschaft ohne Kontoumsatz, deren Betrag genau der Differenz entspricht (z. B. unter „Einnahmen & Ausgaben“ gebucht).
   *  Sie ändern den Kontostand nicht, weil der nur aus den Kontoauszügen kommt. */
  ohneUmsatz: { id: number; datum: string; betrag: number; text: string; konto: string; einheit: string }[];
  ok: boolean;
}

export async function kontoabgleich(objekt: number, jahr: number): Promise<KontoAbgleich[]> {
  const von = `${jahr}-01-01`, bis = `${jahr}-12-31`;
  const konten = await db.select('SELECT * FROM bankkonten WHERE objekt_id = $1 ORDER BY id', [objekt]);
  const out: KontoAbgleich[] = [];
  for (const k of konten) {
    // Umsätze am oder vor dem Saldotag stecken schon im Anfangssaldo und zählen nicht doppelt
    const nach = '(k.saldo_datum IS NULL OR u.datum > k.saldo_datum)';
    // Stand 01.01. von Hand (Einnahmen & Ausgaben) gilt auch hier, sofern die Kontoumsätze vor dem 01.01. beginnen
    const start = await bankStart(k, von);
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
    // Regelmäßige Zahler (Hausgeld, Miete): Monate ohne Eingang zeigen, wo ein Umsatz fehlt, wenn der Endbestand nicht zum Auszug passt
    const gruppen = new Map<string, Row[]>();
    // Nach IBAN gruppieren; Umsätze ohne IBAN (z. B. von Hand nachgetragen) zählen beim Zahler mit gleichem Namen
    const nm = (x: Row) => String(x.gegenpartei || '').trim().toLowerCase();
    const eing = u.filter((x) => Number(x.betrag) > 0);
    for (const x of [...eing.filter((x) => x.gegen_iban), ...eing.filter((x) => !x.gegen_iban)]) {
      const iban = String(x.gegen_iban || '').replace(/\s/g, '').toUpperCase();
      const key = iban || [...gruppen.entries()].find(([, l]) => nm(x) && l.some((y) => nm(y) === nm(x)))?.[0] || nm(x);
      if (!key) continue;
      gruppen.set(key, [...(gruppen.get(key) ?? []), x]);
    }
    const regelmaessig: KontoAbgleich['regelmaessig'] = [];
    for (const l of gruppen.values()) {
      if (l.length < 6) continue;
      const je = new Map<number, number>();
      for (const x of l) { const mo = Number(String(x.datum).slice(5, 7)); je.set(mo, (je.get(mo) ?? 0) + 1); }
      const [haeufig, nHaeufig] = [...l.reduce((m, x) => m.set(r2(Number(x.betrag)), (m.get(r2(Number(x.betrag))) ?? 0) + 1), new Map<number, number>()).entries()].sort((a, b) => b[1] - a[1])[0];
      // Nur echte Daueraufträge (gleicher Betrag in den meisten Monaten), sonst zu viele Hinweise
      if (nHaeufig < 6 || nHaeufig < l.length * 0.7) continue;
      const bisMonat = Number(bis.slice(0, 7) < heute.slice(0, 7) ? 12 : Number(heute.slice(5, 7)) - 1);
      const fehlt = MONATE.filter((_, i) => i + 1 >= ersterMonat && i + 1 <= bisMonat && !je.has(i + 1));
      const doppelt = MONATE.filter((_, i) => (je.get(i + 1) ?? 0) > 1);
      // Mehrere Eingänge je Monat allein sind normal (mehrere Einheiten, getrennte Überweisungen); interessant nur zusammen mit einer Lücke
      if (fehlt.length) regelmaessig.push({ name: l[0].gegenpartei || l[0].gegen_iban || 'ohne Namen', betrag: haeufig, anzahl: l.length, fehlt, doppelt });
    }
    const geloescht: KontoAbgleich['geloescht'] = [];
    for (const x of await db.select(`SELECT p.datensatz AS id, p.zeit, json_extract(p.inhalt, '$.datum') AS datum, json_extract(p.inhalt, '$.betrag') AS betrag,
        json_extract(p.inhalt, '$.gegenpartei') AS gegenpartei, json_extract(p.inhalt, '$.verwendungszweck') AS zweck FROM protokoll p
      WHERE p.tabelle = 'bankumsaetze' AND p.aktion = 'gelöscht' AND json_extract(p.inhalt, '$.bankkonto_id') = $1
        AND json_extract(p.inhalt, '$.datum') BETWEEN $2 AND $3 ORDER BY json_extract(p.inhalt, '$.datum')`, [k.id, von, bis])) {
      if (k.saldo_datum && x.datum <= k.saldo_datum) continue;
      const wieder = u.some((y) => y.datum === x.datum && Math.abs(Number(y.betrag) - Number(x.betrag)) < 0.005 && String(y.gegenpartei ?? '') === String(x.gegenpartei ?? ''));
      if (!wieder) geloescht.push({ id: x.id, datum: x.datum, betrag: Number(x.betrag), gegenpartei: x.gegenpartei ?? '', zweck: x.zweck ?? '', geloeschtAm: String(x.zeit ?? '') });
    }
    const ohneUmsatz: KontoAbgleich['ohneUmsatz'] = differenz !== null && Math.abs(differenz) >= 0.005
      ? (await db.select(`SELECT b.id, b.datum, b.betrag, COALESCE(b.text, '') AS text, COALESCE(kk.nummer || ' ' || kk.name, '') AS konto, COALESCE(e.nummer, '') AS einheit
          FROM buchungen b LEFT JOIN buchungskonten kk ON kk.id = b.buchungskonto_id LEFT JOIN einheiten e ON e.id = b.einheit_id
          WHERE b.objekt_id = $1 AND b.bankumsatz_id IS NULL AND b.rechnung_id IS NULL AND b.datum BETWEEN $2 AND $3 AND ABS(b.betrag - $4) < 0.005
            AND COALESCE(b.text, '') NOT LIKE 'Zahlung % (manuell)' AND ($5 IS NULL OR b.datum > $5) ORDER BY b.id DESC LIMIT 10`, [objekt, von, bis, differenz, k.saldo_datum ?? null]))
        .map((x) => ({ id: x.id, datum: x.datum, betrag: Number(x.betrag), text: x.text, konto: x.konto, einheit: x.einheit }))
      : [];
    out.push({
      id: k.id, name: k.name, regelmaessig, geloescht, ohneUmsatz, iban: k.iban ?? '', erfasstAb, start: r2(start), ein, aus, ende, auszug, notiz: ab?.notiz ?? '', differenz,
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
    ...k.geloescht.map((g) => `  gelöscht am ${dT(g.geloeschtAm.slice(0, 10))}: ${dT(g.datum)} ${eurT(g.betrag)} ${g.gegenpartei} ${g.zweck}`.trimEnd()),
    ...k.regelmaessig.map((g) => `  Regelmäßiger Zahler ${g.name} (${eurT(g.betrag)}, ${g.anzahl} Eingänge)${g.fehlt.length ? `: kein Eingang im ${g.fehlt.join(', ')}` : ''}${g.doppelt.length ? `; zwei Eingänge im ${g.doppelt.join(', ')}` : ''}`),
  ].filter(Boolean).join('\n')).join('\n\n');
}

/** Fehlenden Umsatz von Hand nachtragen (steht auf dem Kontoauszug, kam beim Einlesen aber nicht an).
 *  Er steht danach unter „Bank & Zuordnung“ zum Zuordnen bereit wie jeder eingelesene Umsatz. */
export async function umsatzNachtragen(bankkontoId: number, u: { datum: string; betrag: number; gegenpartei: string; zweck: string }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(u.datum) || !Number.isFinite(u.betrag) || !u.betrag) throw new Error('Bitte Datum und Betrag angeben.');
  const k = (await db.select('SELECT saldo_datum FROM bankkonten WHERE id = $1', [bankkontoId]))[0];
  if (k?.saldo_datum && u.datum <= k.saldo_datum) throw new Error(`Umsätze bis ${dT(k.saldo_datum)} stecken schon im Anfangssaldo. Bitte ein späteres Datum wählen.`);
  await db.execute(`INSERT INTO bankumsaetze (bankkonto_id, datum, betrag, verwendungszweck, gegenpartei, gegen_iban, import_hash) VALUES ($1, $2, $3, $4, $5, '', $6)`,
    [bankkontoId, u.datum, r2(u.betrag), u.zweck || 'von Hand nachgetragen', u.gegenpartei, `hand|${bankkontoId}|${u.datum}|${r2(u.betrag)}|${Date.now()}`]);
}

/** Eine Buchung ohne Kontoumsatz (z. B. unter „Einnahmen & Ausgaben“ erfasst) als Umsatz dieses Bankkontos übernehmen:
 *  Es entsteht ein Kontoumsatz mit Datum und Betrag der Buchung, die Buchung wird mit ihm verbunden. Damit zählt sie im Kontostand. */
export async function buchungAlsUmsatz(bankkontoId: number, buchungId: number) {
  const b = (await db.select('SELECT * FROM buchungen WHERE id = $1', [buchungId]))[0];
  if (!b) throw new Error('Die Buchung gibt es nicht mehr.');
  if (b.bankumsatz_id) throw new Error('Diese Buchung gehört schon zu einem Kontoumsatz.');
  const k = (await db.select('SELECT saldo_datum FROM bankkonten WHERE id = $1', [bankkontoId]))[0];
  if (k?.saldo_datum && b.datum <= k.saldo_datum) throw new Error(`Umsätze bis ${dT(k.saldo_datum)} stecken schon im Anfangssaldo.`);
  const r = await db.execute(`INSERT INTO bankumsaetze (bankkonto_id, datum, betrag, verwendungszweck, gegenpartei, gegen_iban, import_hash, status) VALUES ($1, $2, $3, $4, $5, '', $6, 'zugeordnet')`,
    [bankkontoId, b.datum, r2(Number(b.betrag)), b.text || 'aus Buchung übernommen', 'von Hand (aus Buchung)', `buchung|${bankkontoId}|${buchungId}`]);
  await db.execute('UPDATE buchungen SET bankumsatz_id = $1 WHERE id = $2', [r.lastInsertId ?? null, buchungId]);
}
