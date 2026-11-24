// Kontostand unter „Einnahmen & Ausgaben“: Stand laut Kontoumsätzen gegen Stand laut Buchungen, laufend nach jeder Änderung.
// Dazu der Bankstatus je Buchung (mit Kontoumsatz, ohne Kontoumsatz, bar) und das Verbinden einer vorhandenen Buchung
// mit dem passenden Kontoumsatz, damit eine Zahlung nicht ein zweites Mal gebucht wird.
//
//   Stand laut Bank      = Stand 01.01. + alle Kontoumsätze im Zeitraum
//   Stand laut Buchungen = Stand 01.01. + Buchungen an Kontoumsätzen + Buchungen ohne Kontoumsatz (außer „bar / ohne Bank“)
//   Stand 01.01. kann je Bankkonto und Jahr von Hand eingegeben werden (siehe kontostart.ts)
//   Differenz            = offene Umsätze + ignorierte Umsätze + Abweichungen − Buchungen ohne Kontoumsatz
import { db, type Row } from '../db';
import { buchungGesperrt, gesperrt, sperrText } from './abschluss';
import { bankStart, startLautUmsaetzen, startManuell } from './kontostart';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Wie weit Buchungsdatum und Umsatzdatum auseinander liegen dürfen, damit sie als „dieselbe Zahlung“ gelten */
export const TAGE_SPIELRAUM = 20;

export type BankStatus = 'bank' | 'ohne' | 'bar' | 'vorher';
export const STATUS_TEXT: Record<BankStatus, string> = {
  bank: 'mit Kontoumsatz', ohne: 'ohne Kontoumsatz', bar: 'bar / ohne Bank', vorher: 'vor Beginn der Kontoumsätze',
};

/** Bankstatus einer Buchung: an einem Kontoumsatz, bewusst ohne Bank (bar), vor dem ersten erfassten Kontoumsatz, sonst „ohne“ */
export function bankStatus(b: Row, saldoDatum?: string | null): BankStatus {
  if (b.bankumsatz_id) return 'bank';
  if (b.zahlweg === 'bar') return 'bar';
  if (saldoDatum && String(b.datum) <= saldoDatum) return 'vorher';
  return 'ohne';
}

/** Erster Tag, bis zu dem die Kontoumsätze der Liegenschaft schon im Anfangssaldo stecken (frühestes Saldodatum), sonst null */
export async function saldoDatum(objekt: number): Promise<string | null> {
  return (await db.select('SELECT MIN(saldo_datum) AS d FROM bankkonten WHERE objekt_id = $1', [objekt]))[0]?.d ?? null;
}

/** Buchungen ohne Kontoumsatz (nicht bar, keine Splittbuchung) mit gleichem Betrag und nahem Datum zu einem offenen Umsatz */
export async function passendeBuchungen(u: Row): Promise<Row[]> {
  const k = (await db.select('SELECT objekt_id, saldo_datum FROM bankkonten WHERE id = $1', [u.bankkonto_id]))[0];
  if (!k?.objekt_id) return [];
  return db.select(`SELECT b.*, kk.nummer, kk.name AS konto, e.nummer AS einheit FROM buchungen b
      LEFT JOIN buchungskonten kk ON kk.id = b.buchungskonto_id LEFT JOIN einheiten e ON e.id = b.einheit_id
    WHERE b.objekt_id = $1 AND b.bankumsatz_id IS NULL AND COALESCE(b.zahlweg, '') <> 'bar' AND b.aufteilung IS NULL
      AND ABS(b.betrag - $2) < 0.005 AND ABS(julianday(b.datum) - julianday($3)) <= ${TAGE_SPIELRAUM}
      AND ($4 IS NULL OR b.datum > $4)
    ORDER BY ABS(julianday(b.datum) - julianday($3)), b.id`, [k.objekt_id, Number(u.betrag), u.datum, k.saldo_datum ?? null]);
}

/** Offene Kontoumsätze der Liegenschaft mit gleichem Betrag und nahem Datum zu einer Buchung ohne Kontoumsatz */
export async function passendeUmsaetze(b: Row): Promise<Row[]> {
  if (!b?.objekt_id || b.bankumsatz_id) return [];
  return db.select(`SELECT u.*, k.name AS bankkonto FROM bankumsaetze u JOIN bankkonten k ON k.id = u.bankkonto_id
    WHERE k.objekt_id = $1 AND u.status = 'offen' AND ABS(u.betrag - $2) < 0.005 AND ABS(julianday(u.datum) - julianday($3)) <= ${TAGE_SPIELRAUM}
    ORDER BY ABS(julianday(u.datum) - julianday($3)), u.id`, [b.objekt_id, Number(b.betrag), b.datum]);
}

/** Vorhandene Buchung mit einem offenen Kontoumsatz verbinden: keine neue Buchung, der Umsatz gilt als zugeordnet. */
export async function verbinden(buchungId: number, umsatzId: number) {
  const b = (await db.select('SELECT * FROM buchungen WHERE id = $1', [buchungId]))[0];
  const u = (await db.select('SELECT u.*, k.objekt_id FROM bankumsaetze u JOIN bankkonten k ON k.id = u.bankkonto_id WHERE u.id = $1', [umsatzId]))[0];
  if (!b) throw new Error('Die Buchung gibt es nicht mehr.');
  if (!u) throw new Error('Den Kontoumsatz gibt es nicht mehr.');
  if (b.bankumsatz_id) throw new Error('Diese Buchung hängt schon an einem Kontoumsatz.');
  if (u.status !== 'offen') throw new Error('Dieser Kontoumsatz ist schon zugeordnet oder ignoriert.');
  if (Math.abs(Number(b.betrag) - Number(u.betrag)) > 0.005) throw new Error('Betrag von Buchung und Kontoumsatz sind verschieden.');
  if (u.objekt_id && b.objekt_id && Number(u.objekt_id) !== Number(b.objekt_id)) throw new Error('Buchung und Bankkonto gehören zu verschiedenen Liegenschaften.');
  const sp = (await buchungGesperrt(Number(b.objekt_id), b.datum, b.jahr)) ?? (await gesperrt(Number(u.objekt_id ?? b.objekt_id), u.datum));
  if (sp) throw new Error(sperrText(sp));
  await db.execute('UPDATE buchungen SET bankumsatz_id = $1, zahlweg = NULL WHERE id = $2', [umsatzId, buchungId]);
  await db.execute(`UPDATE bankumsaetze SET status = 'zugeordnet' WHERE id = $1`, [umsatzId]);
}

/** Buchung als „bar / ohne Bank“ kennzeichnen (z. B. Barkasse, Umbuchung, Verrechnung) oder das wieder aufheben */
export async function barSetzen(buchungId: number, bar: boolean) {
  const b = (await db.select('SELECT objekt_id, datum, jahr, bankumsatz_id FROM buchungen WHERE id = $1', [buchungId]))[0];
  if (!b) return;
  if (b.bankumsatz_id) throw new Error('Diese Buchung hängt an einem Kontoumsatz.');
  const sp = await buchungGesperrt(Number(b.objekt_id), b.datum, b.jahr);
  if (sp) throw new Error(sperrText(sp));
  await db.execute('UPDATE buchungen SET zahlweg = $1 WHERE id = $2', [bar ? 'bar' : null, buchungId]);
}

export interface KontoZeile {
  id: number; name: string; iban: string; start: number; bank: number; letzter: string | null; auszug: number | null;
  manuell: number | null;     // Stand 01.01. von Hand, sonst null
  startBuchungen: number;     // Stand 01.01. für „Stand laut Buchungen“ (von Hand, sonst wie `start`)
  lautUmsaetzen: number;      // Stand 01.01. laut Anfangssaldo und Kontoumsätzen (ohne Eingabe von Hand)
  saldoDatum: string | null;
}
export interface Kontostand {
  von: string; bis: string;
  konten: KontoZeile[];
  start: number;            // Stand am Tag vor `von` (alle Bankkonten der Liegenschaft) laut Bank
  startBuchungen: number;   // Stand 01.01. für „Stand laut Buchungen“ (mit Eingaben von Hand)
  manuell: boolean;         // mindestens ein Konto hat einen Stand 01.01. von Hand
  bank: number;             // Stand laut Kontoumsätzen am `bis`
  buchungen: number;        // Stand laut Buchungen am `bis`
  differenz: number;        // bank − buchungen
  letzterUmsatz: string | null;
  ohne: Row[]; ohneSumme: number;          // Buchungen ohne Kontoumsatz
  offen: Row[]; offenSumme: number;        // offene Kontoumsätze
  ignoriert: number; ignoriertSumme: number;
  abweichend: Row[]; abweichendSumme: number; // Umsatz ≠ Summe seiner Buchungen
  bar: number; barSumme: number;
  vorher: Row[]; vorherSumme: number;      // Buchungen vor Beginn der Kontoumsätze, zählen nur mit Stand 01.01. von Hand
  auszug: number | null;    // Kontostand laut Kontoauszug zum 31.12. (Kontoabgleich), nur wenn `bis` der 31.12. ist
}

/** Kontostand einer Liegenschaft im Jahr bis zum Monatsende von `monat` (leer = ganzes Jahr bzw. bis heute) */
export async function kontostand(objekt: number, jahr: number, monat = ''): Promise<Kontostand | null> {
  const konten = await db.select('SELECT * FROM bankkonten WHERE objekt_id = $1 ORDER BY id', [objekt]);
  if (!konten.length) return null;
  const von = `${jahr}-01-01`;
  const bis = monat ? `${jahr}-${monat}-${String(new Date(jahr, Number(monat), 0).getDate()).padStart(2, '0')}` : `${jahr}-12-31`;
  const nach = '(k.saldo_datum IS NULL OR u.datum > k.saldo_datum)';
  const kz: KontoZeile[] = [];
  for (const k of konten) {
    const start = await bankStart(k, von);
    const s = (await db.select(`SELECT
        COALESCE((SELECT SUM(u.betrag) FROM bankumsaetze u WHERE u.bankkonto_id = k.id AND u.datum BETWEEN $2 AND $3 AND ${nach}), 0) AS jahr,
        (SELECT MAX(u.datum) FROM bankumsaetze u WHERE u.bankkonto_id = k.id AND u.datum <= $3) AS letzter
      FROM bankkonten k WHERE k.id = $1`, [k.id, von, bis]))[0];
    const ab = bis.endsWith('-12-31') ? (await db.select('SELECT saldo_auszug FROM kontoabgleich WHERE bankkonto_id = $1 AND jahr = $2', [k.id, jahr]))[0] : null;
    const manuell = await startManuell(Number(k.id), jahr);
    kz.push({ id: k.id, name: k.name ?? 'Bankkonto', iban: k.iban ?? '', start, bank: r2(start + Number(s.jahr)), letzter: s.letzter ?? null,
      auszug: ab?.saldo_auszug == null ? null : Number(ab.saldo_auszug),
      manuell, startBuchungen: manuell ?? start, lautUmsaetzen: await startLautUmsaetzen(Number(k.id), von), saldoDatum: k.saldo_datum ?? null });
  }
  const ids = konten.map((k) => Number(k.id)).join(',');
  const umsatzWo = `u.bankkonto_id IN (${ids}) AND u.datum BETWEEN $1 AND $2 AND (k.saldo_datum IS NULL OR u.datum > k.saldo_datum)`;
  const umsaetze = await db.select(`SELECT u.*, k.name AS bankkonto, (SELECT SUM(b.betrag) FROM buchungen b WHERE b.bankumsatz_id = u.id) AS gebucht
    FROM bankumsaetze u JOIN bankkonten k ON k.id = u.bankkonto_id WHERE ${umsatzWo} ORDER BY u.datum, u.id`, [von, bis]);
  const sd = konten.map((k) => k.saldo_datum).filter(Boolean).sort()[0] ?? null;
  const ohneAlle = await db.select(`SELECT b.*, kk.nummer, kk.name AS konto, e.nummer AS einheit FROM buchungen b
      LEFT JOIN buchungskonten kk ON kk.id = b.buchungskonto_id LEFT JOIN einheiten e ON e.id = b.einheit_id
    WHERE b.objekt_id = $1 AND b.bankumsatz_id IS NULL AND b.datum BETWEEN $2 AND $3
    ORDER BY b.datum, b.id`, [objekt, von, bis]);
  // Buchungen bis zum Saldotag stecken im Anfangssaldo. Mit einem Stand 01.01. von Hand zählen sie dagegen mit.
  const vorBeginn = (b: Row) => !!sd && String(b.datum) <= sd;
  const manuell = kz.some((k) => k.manuell !== null);
  const vorher = manuell ? ohneAlle.filter((b) => vorBeginn(b) && b.zahlweg !== 'bar') : [];
  const nachher = ohneAlle.filter((b) => !vorBeginn(b));
  const ohne = nachher.filter((b) => b.zahlweg !== 'bar'), bar = nachher.filter((b) => b.zahlweg === 'bar');
  const offen = umsaetze.filter((u) => u.status === 'offen'), ign = umsaetze.filter((u) => u.status === 'ignoriert');
  const abweichend = umsaetze.filter((u) => u.status === 'zugeordnet' && Math.abs(r2(Number(u.gebucht ?? 0)) - r2(Number(u.betrag))) > 0.005);
  const start = r2(kz.reduce((a, k) => a + k.start, 0)), bank = r2(kz.reduce((a, k) => a + k.bank, 0));
  const gebuchtAnUmsatz = umsaetze.filter((u) => u.status === 'zugeordnet').reduce((a, u) => a + Number(u.gebucht ?? 0), 0);
  const ohneSumme = r2(ohne.reduce((a, b) => a + Number(b.betrag), 0));
  const startBuchungen = r2(kz.reduce((a, k) => a + k.startBuchungen, 0));
  const vorherSumme = r2(vorher.reduce((a, b) => a + Number(b.betrag), 0));
  const buchungen = r2(startBuchungen + vorherSumme + gebuchtAnUmsatz + ohneSumme);
  const auszuege = kz.filter((k) => k.auszug !== null);
  return {
    von, bis, konten: kz, start, startBuchungen, manuell, bank, buchungen, differenz: r2(bank - buchungen),
    letzterUmsatz: umsaetze.length ? String(umsaetze[umsaetze.length - 1].datum) : kz.map((k) => k.letzter).filter(Boolean).sort().pop() ?? null,
    ohne, ohneSumme, offen, offenSumme: r2(offen.reduce((a, u) => a + Number(u.betrag), 0)),
    ignoriert: ign.length, ignoriertSumme: r2(ign.reduce((a, u) => a + Number(u.betrag), 0)),
    abweichend, abweichendSumme: r2(abweichend.reduce((a, u) => a + Number(u.betrag) - Number(u.gebucht ?? 0), 0)),
    bar: bar.length, barSumme: r2(bar.reduce((a, b) => a + Number(b.betrag), 0)),
    vorher, vorherSumme,
    auszug: auszuege.length === kz.length ? r2(auszuege.reduce((a, k) => a + (k.auszug ?? 0), 0)) : null,
  };
}

/** Kontoumsätze eines Bankkontos im Zeitraum mit laufendem Kontostand und der Buchung, an der sie hängen */
export async function umsatzListe(bankkontoId: number, jahr: number, monat = ''): Promise<{ start: number; zeilen: Row[]; ende: number }> {
  const von = monat ? `${jahr}-${monat}-01` : `${jahr}-01-01`;
  const bis = monat ? `${jahr}-${monat}-${String(new Date(jahr, Number(monat), 0).getDate()).padStart(2, '0')}` : `${jahr}-12-31`;
  const nach = '(k.saldo_datum IS NULL OR u.datum > k.saldo_datum)';
  const k = (await db.select('SELECT * FROM bankkonten WHERE id = $1', [bankkontoId]))[0];
  const start = k ? await bankStart(k, von) : 0;
  const l = await db.select(`SELECT u.*, (SELECT SUM(b.betrag) FROM buchungen b WHERE b.bankumsatz_id = u.id) AS gebucht,
      (SELECT COUNT(*) FROM buchungen b WHERE b.bankumsatz_id = u.id) AS n,
      (SELECT MIN(b.id) FROM buchungen b WHERE b.bankumsatz_id = u.id) AS buchung_id,
      (SELECT kk.nummer || ' ' || kk.name FROM buchungen b JOIN buchungskonten kk ON kk.id = b.buchungskonto_id WHERE b.bankumsatz_id = u.id ORDER BY b.id LIMIT 1) AS konto
    FROM bankumsaetze u JOIN bankkonten k ON k.id = u.bankkonto_id WHERE u.bankkonto_id = $1 AND u.datum BETWEEN $2 AND $3 AND ${nach} ORDER BY u.datum, u.id`, [bankkontoId, von, bis]);
  let lauf = start;
  const zeilen = l.map((u) => { lauf = r2(lauf + Number(u.betrag)); return { ...u, stand: lauf }; });
  return { start: r2(start), zeilen, ende: r2(lauf) };
}
