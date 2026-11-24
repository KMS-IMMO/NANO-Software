// Kontoentwicklung der Eigentümerabrechnung (Mietverwaltung) und woher eine Differenz zum Kontostand laut Bank kommt.
//
//   Kontostand 31.12. rechnerisch = Stand 01.01. + Überschuss (Einnahmen − Ausgaben der EÜR) + Ein-/Auszahlungen Eigentümer
//   Kontostand 31.12. laut Bank   = Stand 01.01. laut Bank + alle Kontoumsätze des Jahres
//   Differenz                     = laut Bank − rechnerisch
//
// Die Differenz wird vollständig in Gründe zerlegt (die Summe der Gründe ist genau die Differenz):
//   • Kontoumsätze, die nicht (ganz) gebucht sind: offen, ignoriert, Buchung ≠ Umsatzbetrag
//   • Buchungen an Kontoumsätzen, die nicht im Überschuss stehen: Konto außerhalb der EÜR (z. B. Kaution), andere Liegenschaft, anderes Buchungsjahr
//   • Buchungen im Überschuss ohne Bewegung auf dem Konto in diesem Jahr: ohne Kontoumsatz (z. B. „Als bezahlt buchen“), bar,
//     vor Beginn der Kontoumsätze, Zahlung über das Bankkonto einer anderen Liegenschaft, Kontoumsatz in einem anderen Jahr
//   • Ausgaben ohne Zahlung: Rechnungen ohne Zahlung und für die Abrechnung angepasste Beträge
//   • Stand 01.01. von Hand, der für die Bank nicht gilt (Kontoumsätze beginnen erst später im Jahr)
import { db } from '../db';
import { BJ } from './buchung';
import { bankStart, startManuell } from './kontostart';
import { kostenErmitteln } from './verteilung';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** betrag = Beitrag des Postens zur Differenz (wie beim Grund) */
export interface DiffPosten { id: number; datum: string; betrag: number; text: string; konto: string; einheit: string }
export interface DiffGrund {
  schluessel: string;
  text: string;
  /** Beitrag zur Differenz: positiv = auf dem Konto ist mehr als rechnerisch */
  betrag: number;
  posten: DiffPosten[];
}
export interface Kontoentwicklung {
  n: number;
  anfang: number;        // Stand 01.01. (von Hand, sonst laut Bank)
  anfangBank: number;    // Stand 01.01. laut Bank
  ueberschuss: number; eigentuemer: number;
  rechnerisch: number; ende: number; differenz: number;
  gruende: DiffGrund[];
  /** Rest, den die Gründe nicht erklären (sollte immer 0 sein) */
  rest: number;
}

const TEXTE: Record<string, string> = {
  start: 'Stand 01.01. von Hand weicht vom Anfangssaldo laut Kontoauszug ab',
  offen: 'Kontoumsätze noch nicht gebucht',
  ignoriert: 'Kontoumsätze ignoriert (nicht gebucht)',
  abweichend: 'Buchung ergibt nicht den Betrag des Kontoumsatzes',
  konto: 'Gebucht auf ein Konto außerhalb der EÜR (z. B. Kaution, Konto ohne EÜR-Häkchen oder ohne Konto)',
  objektFremd: 'Kontoumsatz dieses Kontos auf eine andere Liegenschaft gebucht',
  jahrFremd: 'Kontoumsatz in diesem Jahr, aber einem anderen Buchungsjahr zugeordnet',
  ohne: 'Gebucht ohne Kontoumsatz (z. B. „Als bezahlt buchen“ bei den Sollstellungen)',
  bar: 'Bar / ohne Bank gebucht',
  vorher: 'Gebucht vor Beginn der Kontoumsätze',
  bankFremd: 'Zahlung lief über das Bankkonto einer anderen Liegenschaft',
  umsatzJahr: 'Kontoumsatz liegt in einem anderen Jahr als das Buchungsjahr',
  rechnungen: 'Rechnungen ohne Zahlung (als Ausgabe gezählt, aber nicht vom Konto bezahlt)',
  anpassung: 'Für die Abrechnung angepasste oder herausgenommene Kosten',
};
const REIHENFOLGE = Object.keys(TEXTE);

export async function kontoentwicklung(objekt: number, jahr: number): Promise<Kontoentwicklung> {
  const von = `${jahr}-01-01`, bis = `${jahr}-12-31`;
  const konten = await db.select('SELECT * FROM bankkonten WHERE objekt_id = $1 ORDER BY id', [objekt]);
  const gruende = new Map<string, DiffGrund>();
  const add = (s: string, betrag: number, p?: DiffPosten) => {
    if (Math.abs(betrag) < 0.005 && !p) return;
    const g = gruende.get(s) ?? { schluessel: s, text: TEXTE[s], betrag: 0, posten: [] };
    g.betrag = r2(g.betrag + betrag); if (p) g.posten.push(p);
    gruende.set(s, g);
  };

  // Stand 01.01.: laut Bank und für die Rechnung (Eingabe von Hand, sonst laut Bank), wie unter „Einnahmen & Ausgaben“
  let anfangBank = 0, anfang = 0;
  for (const k of konten) {
    const b = await bankStart(k, von);
    const m = await startManuell(Number(k.id), jahr);
    anfangBank += b; anfang += m ?? b;
  }
  anfangBank = r2(anfangBank); anfang = r2(anfang);
  add('start', r2(anfangBank - anfang));

  // Überschuss wie in der Eigentümerabrechnung
  const ein = Number((await db.select(`SELECT COALESCE(SUM(b.betrag), 0) AS s FROM buchungen b JOIN buchungskonten k ON k.id = b.buchungskonto_id
    WHERE b.objekt_id = $1 AND k.art = 'Einnahme' AND COALESCE(k.euer, 1) = 1 AND ${BJ('b')} = CAST($2 AS INTEGER)`, [objekt, String(jahr)]))[0]?.s ?? 0);
  const pos = (await kostenErmitteln(objekt, jahr, false)).filter((p) => p.euer);
  const kosten = r2(pos.reduce((a, p) => a + p.betrag, 0));
  const eigentuemer = r2(Number((await db.select(`SELECT COALESCE(SUM(b.betrag), 0) AS s FROM buchungen b JOIN buchungskonten k ON k.id = b.buchungskonto_id
    WHERE b.objekt_id = $1 AND k.art = 'Eigentümer' AND ${BJ('b')} = CAST($2 AS INTEGER)`, [objekt, String(jahr)]))[0]?.s ?? 0));
  const ueberschuss = r2(ein - kosten);
  const rechnerisch = r2(anfang + ueberschuss + eigentuemer);

  const ids = konten.map((k) => Number(k.id));
  const L = ids.length ? ids.join(',') : '0';
  const NACH = '(k.saldo_datum IS NULL OR u.datum > k.saldo_datum)';
  const umsaetze = await db.select(`SELECT u.*, (SELECT SUM(b.betrag) FROM buchungen b WHERE b.bankumsatz_id = u.id) AS gebucht
    FROM bankumsaetze u JOIN bankkonten k ON k.id = u.bankkonto_id WHERE u.bankkonto_id IN (${L}) AND u.datum BETWEEN $1 AND $2 AND ${NACH}`, [von, bis]);
  const ende = r2(anfangBank + umsaetze.reduce((a, u) => a + Number(u.betrag), 0));
  const umsatzIds = new Set(umsaetze.map((u) => Number(u.id)));
  for (const u of umsaetze) {
    const rest = r2(Number(u.betrag) - Number(u.gebucht ?? 0));
    if (Math.abs(rest) < 0.005) continue;
    const s = u.status === 'offen' ? 'offen' : u.status === 'ignoriert' ? 'ignoriert' : 'abweichend';
    add(s, rest, { id: Number(u.id), datum: String(u.datum), betrag: rest, text: [u.gegenpartei, u.verwendungszweck].filter(Boolean).join(' · '), konto: '', einheit: '' });
  }

  // Buchungen im Überschuss (Einnahmen und Ausgaben der EÜR, Eigentümer) und Buchungen an den Kontoumsätzen des Jahres
  const imUeberschuss = `(k.art = 'Eigentümer' OR (COALESCE(k.euer, 1) = 1 AND k.art IN ('Einnahme', 'Aufwand', 'Ertrag')))`;
  const buch = await db.select(`SELECT b.*, k.art AS konto_art, k.euer AS konto_euer, COALESCE(k.nummer || ' ' || k.name, '') AS konto, COALESCE(e.nummer, '') AS einheit,
      ${BJ('b')} AS bj, u.datum AS u_datum, u.bankkonto_id AS u_konto, uk.objekt_id AS u_objekt, uk.saldo_datum AS u_saldo_datum,
      CASE WHEN b.objekt_id = $1 AND ${BJ('b')} = CAST($2 AS INTEGER) AND b.buchungskonto_id IS NOT NULL AND ${imUeberschuss} THEN 1 ELSE 0 END AS im_r
    FROM buchungen b LEFT JOIN buchungskonten k ON k.id = b.buchungskonto_id LEFT JOIN einheiten e ON e.id = b.einheit_id
      LEFT JOIN bankumsaetze u ON u.id = b.bankumsatz_id LEFT JOIN bankkonten uk ON uk.id = u.bankkonto_id
    WHERE (b.objekt_id = $1 AND ${BJ('b')} = CAST($2 AS INTEGER)) OR b.bankumsatz_id IN (SELECT u.id FROM bankumsaetze u JOIN bankkonten k ON k.id = u.bankkonto_id
      WHERE u.bankkonto_id IN (${L}) AND u.datum BETWEEN $3 AND $4 AND ${NACH})
    ORDER BY b.datum, b.id`, [objekt, String(jahr), von, bis]);
  const sd = konten.map((k) => k.saldo_datum).filter(Boolean).sort()[0] ?? null;
  for (const b of buch) {
    const imR = Number(b.im_r) === 1, imU = b.bankumsatz_id != null && umsatzIds.has(Number(b.bankumsatz_id));
    if (imR === imU) continue;
    const p: DiffPosten = { id: Number(b.id), datum: String(b.datum), betrag: Number(b.betrag), text: String(b.text ?? ''), konto: String(b.konto ?? ''), einheit: String(b.einheit ?? '') };
    if (imU) {
      // auf dem Konto, aber nicht im Überschuss
      const s = Number(b.objekt_id) !== objekt ? 'objektFremd' : Number(b.bj) !== jahr ? 'jahrFremd' : 'konto';
      add(s, Number(b.betrag), p);
    } else {
      // im Überschuss, aber keine Bewegung auf den Konten dieser Liegenschaft in diesem Jahr
      let s: string;
      if (!b.bankumsatz_id) s = b.zahlweg === 'bar' ? 'bar' : sd && String(b.datum) <= sd ? 'vorher' : 'ohne';
      else if (!ids.includes(Number(b.u_konto))) s = 'bankFremd';
      else if (b.u_saldo_datum && String(b.u_datum) <= String(b.u_saldo_datum)) s = 'vorher';
      else s = 'umsatzJahr';
      add(s, -Number(b.betrag), { ...p, betrag: -Number(b.betrag) });
    }
  }

  // Ausgaben ohne Buchung: Rechnungen ohne Zahlung und angepasste Beträge (kostenErmitteln zählt sie, das Konto bewegen sie nicht)
  const rech = await db.select(`SELECT r.id, r.datum, r.betrag, COALESCE(r.rechnungsnr, '') AS nr, COALESCE(f.name, '') AS firma, COALESCE(k.nummer || ' ' || k.name, '') AS konto
    FROM rechnungen r JOIN buchungskonten k ON k.id = r.buchungskonto_id LEFT JOIN firmen f ON f.id = r.firma_id
    WHERE r.objekt_id = $1 AND COALESCE(r.bezahlt_am, r.datum) BETWEEN $2 AND $3 AND k.art IN ('Aufwand', 'Ertrag') AND COALESCE(k.euer, 1) = 1
      AND NOT EXISTS (SELECT 1 FROM buchungen b WHERE b.rechnung_id = r.id) ORDER BY r.datum, r.id`, [objekt, von, bis]);
  for (const r of rech) add('rechnungen', Number(r.betrag), { id: Number(r.id), datum: String(r.datum), betrag: Number(r.betrag), text: [r.firma, r.nr ? `Nr. ${r.nr}` : ''].filter(Boolean).join(' · '), konto: r.konto, einheit: '' });
  const kostenBuch = -buch.filter((b) => Number(b.im_r) === 1 && (b.konto_art === 'Aufwand' || b.konto_art === 'Ertrag')).reduce((a, b) => a + Number(b.betrag), 0);
  const rechSumme = rech.reduce((a, r) => a + Number(r.betrag), 0);
  add('anpassung', r2(kosten - kostenBuch - rechSumme));

  const differenz = r2(ende - rechnerisch);
  const liste = [...gruende.values()].filter((g) => Math.abs(g.betrag) >= 0.005 || g.posten.length)
    .sort((a, b) => REIHENFOLGE.indexOf(a.schluessel) - REIHENFOLGE.indexOf(b.schluessel));
  const rest = r2(differenz - liste.reduce((a, g) => a + g.betrag, 0));
  return { n: konten.length, anfang, anfangBank, ueberschuss, eigentuemer, rechnerisch, ende, differenz, gruende: liste.filter((g) => Math.abs(g.betrag) >= 0.005), rest };
}

/** Ein Satz je Grund, für die PDF und Hinweise */
export function gruendeText(g: DiffGrund[], geld: (n: number) => string): string {
  return g.map((x) => `${x.text}: ${geld(x.betrag)}${x.posten.length ? ` (${x.posten.length} Posten)` : ''}`).join('; ');
}

