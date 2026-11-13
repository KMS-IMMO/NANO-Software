// Bankimport: Kontoauszüge aus dem Online-Banking (CAMT.053/.052 als XML, oder CSV)
// einlesen und Zahlungen automatisch offenen Posten bzw. Rechnungen zuordnen.
import { db, insert, type Row } from '../db';
import { KONTO_FUER_ART, OP_SQL } from './soll';

export interface Umsatz {
  datum: string;          // YYYY-MM-DD
  valuta?: string;
  betrag: number;         // Eingang positiv, Ausgang negativ
  verwendungszweck: string;
  gegenpartei: string;
  gegen_iban: string;
  pruefen?: string;       // Hinweis für die Vorschau, z. B. Vorzeichen per Texterkennung unsicher
}

/* ---------------- Einlesen ---------------- */

export function parseDatei(name: string, text: string): Umsatz[] {
  const t = text.trimStart();
  if (t.startsWith('<') || /\.xml$/i.test(name)) return parseCamt(t);
  return parseCsv(text);
}

const txt = (el: Element | null | undefined, sel: string) => el?.querySelector(sel)?.textContent?.trim() ?? '';

/** CAMT.053 / CAMT.052 (ISO 20022), wie es deutsche Banken als „Kontoauszug XML“ anbieten */
export function parseCamt(xml: string): Umsatz[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Die XML-Datei konnte nicht gelesen werden.');
  // Namensräume ignorieren: querySelector arbeitet mit lokalen Namen
  const out: Umsatz[] = [];
  for (const n of Array.from(doc.getElementsByTagNameNS('*', 'Ntry'))) {
    const amt = Number(txt(n, ':scope > Amt').replace(',', '.'));
    const credit = txt(n, ':scope > CdtDbtInd') === 'CRDT';
    const d = txt(n, ':scope > BookgDt > Dt') || txt(n, ':scope > BookgDt > DtTm').slice(0, 10);
    const v = txt(n, ':scope > ValDt > Dt') || undefined;
    const tx = n.getElementsByTagNameNS('*', 'TxDtls')[0];
    // Bei Eingang ist der Zahler der Debtor, bei Ausgang der Empfänger der Creditor
    const party = credit ? 'Dbtr' : 'Cdtr';
    const name = txt(tx, `RltdPties > ${party} Nm`) || txt(tx, `RltdPties > ${party} > Pty > Nm`) || txt(n, 'AddtlNtryInf');
    const iban = txt(tx, `RltdPties > ${party}Acct IBAN`);
    const zweck = Array.from(tx?.getElementsByTagNameNS('*', 'Ustrd') ?? []).map((e) => e.textContent?.trim()).join(' ')
      || txt(n, 'AddtlNtryInf');
    out.push({ datum: d, valuta: v, betrag: credit ? amt : -amt, verwendungszweck: zweck, gegenpartei: name, gegen_iban: iban.replace(/\s/g, '') });
  }
  return out;
}

/** CSV-Export deutscher Banken (Sparkasse, Volksbank, Deutsche Bank, Commerzbank, ING, …) mit Spaltenerkennung */
export function parseCsv(text: string): Umsatz[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const sep = (lines.find((l) => /buchung|betrag|datum/i.test(l)) ?? lines[0]).split(';').length > 2 ? ';' : ',';
  const split = (l: string) => {
    const r: string[] = []; let cur = ''; let q = false;
    for (const c of l) {
      if (c === '"') q = !q;
      else if (c === sep && !q) { r.push(cur); cur = ''; }
      else cur += c;
    }
    r.push(cur);
    return r.map((x) => x.trim());
  };
  const hIdx = lines.findIndex((l) => /betrag/i.test(l) && /(buchung|datum)/i.test(l));
  if (hIdx < 0) throw new Error('In der CSV-Datei wurde keine Kopfzeile mit „Betrag“ und „Datum“ gefunden.');
  const head = split(lines[hIdx]).map((h) => h.toLowerCase());
  const col = (...names: RegExp[]) => { for (const n of names) { const i = head.findIndex((h) => n.test(h)); if (i >= 0) return i; } return -1; };
  const cDatum = col(/^buchungstag$/, /^buchungsdatum$/, /buchung/, /^datum$/);
  const cValuta = col(/valuta/, /wertstellung/);
  const cBetrag = col(/^betrag( \(eur\))?$/, /^betrag/, /umsatz/);
  const cSoll = col(/^soll/), cHaben = col(/^haben/);
  const cZweck = col(/verwendungszweck/, /buchungstext/, /^text/);
  const cName = col(/beguenstigter|begünstigter|zahlungspflichtiger|auftraggeber|empfänger|name/);
  const cIban = col(/^iban/, /kontonummer\/iban/, /iban/, /kontonummer/);
  const datum = (s: string) => {
    const m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
    if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
    return s.slice(0, 10);
  };
  const zahl = (s: string) => Number((s || '0').replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) || 0;
  const out: Umsatz[] = [];
  for (const l of lines.slice(hIdx + 1)) {
    const c = split(l);
    if (c.length < 3 || !c[cDatum]) continue;
    let betrag = cBetrag >= 0 ? zahl(c[cBetrag]) : zahl(c[cHaben]) - zahl(c[cSoll]);
    if (cBetrag >= 0 && /^s$/i.test(c[cBetrag + 1] ?? '')) betrag = -Math.abs(betrag);
    out.push({
      datum: datum(c[cDatum]), valuta: cValuta >= 0 ? datum(c[cValuta]) : undefined, betrag,
      verwendungszweck: cZweck >= 0 ? c[cZweck] : '', gegenpartei: cName >= 0 ? c[cName] : '',
      gegen_iban: cIban >= 0 ? c[cIban].replace(/\s/g, '') : '',
    });
  }
  return out.filter((u) => /^\d{4}-\d{2}-\d{2}$/.test(u.datum) && u.betrag !== 0);
}

const hash = (k: number, u: Umsatz) => [k, u.datum, u.betrag.toFixed(2), u.gegen_iban, u.gegenpartei, u.verwendungszweck].join('|');

/** Speichert neue Umsätze (Doppelte werden übersprungen). */
export async function importieren(bankkontoId: number, umsaetze: Umsatz[]) {
  let neu = 0;
  // Gleiche Umsätze in derselben Datei (z. B. zwei gleiche Überweisungen am selben Tag) sind echte Buchungen:
  // ab dem zweiten bekommt der Schlüssel eine laufende Nummer. Beim erneuten Einlesen derselben Datei bleiben sie trotzdem doppelt erkannt.
  const gesehen = new Map<string, number>();
  for (const u of umsaetze) {
    const h0 = hash(bankkontoId, u), nr = (gesehen.get(h0) ?? 0) + 1;
    gesehen.set(h0, nr);
    const r = await db.execute(
      `INSERT OR IGNORE INTO bankumsaetze (bankkonto_id, datum, valuta, betrag, verwendungszweck, gegenpartei, gegen_iban, import_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [bankkontoId, u.datum, u.valuta ?? null, u.betrag, u.verwendungszweck, u.gegenpartei, u.gegen_iban, nr > 1 ? `${h0}#${nr}` : h0]);
    neu += r.rowsAffected;
  }
  return { neu, doppelt: umsaetze.length - neu };
}

/* ---------------- Zuordnen ---------------- */

const norm = (s: string) => (s ?? '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, ' ');
const woerter = (s: string) => norm(s).split(/\s+/).filter((w) => w.length > 2);

export interface Vorschlag { art: 'person' | 'rechnung' | 'konto'; id: number; label: string; sicher: boolean; grund: string }

/** Erste passende aktive Buchungsregel (nach Priorität) für einen Umsatz */
export async function regelFuer(u: Row, objekt: number | null): Promise<Vorschlag | null> {
  const regeln = await db.select(`SELECT r.*, k.nummer || ' ' || k.name AS konto FROM buchungsregeln r JOIN buchungskonten k ON k.id = r.buchungskonto_id
    WHERE r.aktiv = 1 ORDER BY r.prioritaet, r.id`);
  const text = norm(`${u.gegenpartei} ${u.verwendungszweck}`).replace(/\s+/g, ' ');
  for (const r of regeln) {
    if (r.objekt_id && objekt && r.objekt_id !== objekt) continue;
    if (r.richtung === 'Ausgang' && u.betrag > 0) continue;
    if (r.richtung === 'Eingang' && u.betrag < 0) continue;
    const m = norm(r.muster).replace(/\s+/g, ' ').trim();
    if (m && text.includes(m)) return { art: 'konto', id: r.buchungskonto_id, label: r.konto, sicher: true, grund: `Regel „${r.muster}“` };
  }
  return null;
}

/** Sucht für einen Umsatz den passenden Mieter/Eigentümer (Eingang) oder die passende Rechnung (Ausgang). */
export async function vorschlag(u: Row): Promise<Vorschlag | null> {
  const objekt = (await db.select('SELECT objekt_id FROM bankkonten WHERE id = $1', [u.bankkonto_id]))[0]?.objekt_id ?? null;
  if (u.betrag > 0) {
    const ops = (await db.select(`SELECT * FROM (${OP_SQL}) WHERE betrag - bezahlt > 0.005`))
      .filter((o) => !objekt || o.objekt_id === objekt);
    const personen = await db.select('SELECT * FROM personen');
    const kandidaten = new Map<number, { score: number; grund: string[] }>();
    const add = (pid: number, s: number, g: string) => {
      const k = kandidaten.get(pid) ?? { score: 0, grund: [] }; k.score += s; k.grund.push(g); kandidaten.set(pid, k);
    };
    const iban = String(u.gegen_iban ?? '').toUpperCase();
    const text = norm(`${u.gegenpartei} ${u.verwendungszweck}`);
    for (const p of personen) {
      if (iban && p.iban && p.iban.replace(/\s/g, '').toUpperCase() === iban) add(p.id, 5, 'IBAN');
      const nn = woerter(p.nachname ?? ''), fn = woerter(p.firma ?? '');
      if (nn.length && nn.every((w) => text.includes(w))) add(p.id, 2, 'Name');
      else if (fn.length && fn.filter((w) => text.includes(w)).length >= Math.min(2, fn.length)) add(p.id, 2, 'Firma');
    }
    // Einheit im Verwendungszweck (z. B. "WE 03")
    for (const o of ops) {
      const en = norm(o.einheit).replace(/\s+/g, ' ').trim();
      if (en && new RegExp(`\\b${en.replace(/ /g, '\\s*0*')}\\b`).test(text) && o.person_id) add(o.person_id, 1, 'Einheit');
    }
    const ranked = [...kandidaten.entries()].filter(([pid]) => ops.some((o) => o.person_id === pid)).sort((a, b) => b[1].score - a[1].score);
    if (!ranked.length) return regelFuer(u, objekt);
    const [pid, k] = ranked[0];
    const offen = ops.filter((o) => o.person_id === pid).reduce((a, o) => a + o.betrag - o.bezahlt, 0);
    const p = personen.find((x) => x.id === pid)!;
    const eindeutig = ranked.length === 1 || ranked[1][1].score < k.score;
    // Sicher = IBAN oder Name passt eindeutig und der Betrag passt in die offenen Posten
    const sicher = eindeutig && k.score >= 2 && u.betrag <= offen + 0.005;
    return { art: 'person', id: pid, label: [p.firma, p.nachname, p.vorname].filter(Boolean).join(', '), sicher, grund: k.grund.join(' + ') };
  }
  // Ausgang: offene Rechnung mit gleichem Betrag, passend nach Firma/IBAN oder Rechnungsnummer
  const rech = await db.select(`SELECT r.*, f.name AS firma, f.iban AS firma_iban FROM rechnungen r LEFT JOIN firmen f ON f.id = r.firma_id
    WHERE r.bezahlt_am IS NULL AND ABS(r.betrag - $1) < 0.005 ${objekt ? 'AND r.objekt_id = ' + Number(objekt) : ''}`, [-u.betrag]);
  const text = norm(`${u.gegenpartei} ${u.verwendungszweck}`);
  const treffer = rech.map((r) => {
    let s = 1; const g = ['Betrag'];
    if (u.gegen_iban && r.firma_iban && r.firma_iban.replace(/\s/g, '') === u.gegen_iban) { s += 3; g.push('IBAN'); }
    if (r.rechnungsnr && text.includes(norm(r.rechnungsnr).trim())) { s += 3; g.push('Rechnungsnr.'); }
    if (r.firma && woerter(r.firma).some((w) => text.includes(w))) { s += 2; g.push('Firma'); }
    return { r, s, g };
  }).sort((a, b) => b.s - a.s);
  if (!treffer.length) {
    const regel = await regelFuer(u, objekt);
    if (regel) return regel;
    // Bankgebühren erkennen
    if (/kontofuehrung|kontoentgelt|kontofuhrung|abschluss|entgelt|bankgebuehr/.test(text.replace(/\s+/g, ''))) {
      const k = (await db.select(`SELECT id, nummer || ' ' || name AS label FROM buchungskonten WHERE nummer = '1405'`))[0];
      if (k) return { art: 'konto', id: k.id, label: k.label, sicher: true, grund: 'Bankgebühr' };
    }
    return null;
  }
  const t = treffer[0];
  return { art: 'rechnung', id: t.r.id, label: `${t.r.firma ?? 'Rechnung'} ${t.r.rechnungsnr ?? ''}`.trim(), sicher: t.s >= 3 && (treffer.length === 1 || treffer[1].s < t.s), grund: t.g.join(' + ') };
}

/** Verteilt einen Zahlungseingang auf die offenen Posten einer Person (älteste zuerst). */
const MONATSNAMEN: [RegExp, number][] = [[/^jan/, 1], [/^feb/, 2], [/^(maer|mar|mrz)/, 3], [/^apr/, 4], [/^mai/, 5], [/^jun/, 6], [/^jul/, 7], [/^aug/, 8], [/^sep/, 9], [/^okt/, 10], [/^nov/, 11], [/^dez/, 12]];
/** Der eine Monat, den der Verwendungszweck nennt und für den es offene Posten gibt („12/2025“, „12.25“, „2025-12“, „Dezember 2025“, „Dez.“) */
export function monatImText(text: string, ops: Row[]): string | null {
  const offen = new Set(ops.map((o) => String(o.monat)));
  if (/(?<![\d.])\d{1,2}\s?(?:\+|&|,|und|bis|-)\s?\d{1,2}\s?[./]\s?(?:20\d{2}|\d{2})(?![\d.,])/i.test(text)) return null; // mehrere Monate („11+12/2025“)
  const treffer = new Set<string>();
  const jj = (j: string) => (j.length === 2 ? '20' + j : j);
  const mm = (m: number) => String(m).padStart(2, '0');
  for (const x of text.matchAll(/(?<![\d.,])(0?[1-9]|1[0-2])\s?[./-]\s?(20\d{2}|\d{2})(?![\d.,])/g)) treffer.add(`${jj(x[2])}-${mm(Number(x[1]))}`);
  for (const x of text.matchAll(/(?<!\d)(20\d{2})-(0[1-9]|1[0-2])(?![\d-])/g)) treffer.add(`${x[1]}-${x[2]}`);
  for (const x of norm(text).matchAll(/(?:^|\s)([a-z]{3,9})(?:\s+(20\d{2}|\d{2}))?(?=\s|$)/g)) {
    const w = x[1]; const n = MONATSNAMEN.find(([r]) => r.test(w))?.[1];
    const voll = /^(januar|februar|maerz|marz|april|mai|juni|juli|august|september|oktober|november|dezember)$/.test(w);
    // Abkürzungen („Jan“, „Dez“) nur mit Jahreszahl, damit ein Vorname wie „Jan“ nicht als Monat zählt
    if (!n || (!voll && (w.length > 4 || !x[2]))) continue;
    if (x[2]) treffer.add(`${jj(x[2])}-${mm(n)}`);
    else { const passend = [...offen].filter((m) => m.endsWith('-' + mm(n))); if (passend.length === 1) treffer.add(passend[0]); }
  }
  const l = [...treffer].filter((m) => offen.has(m));
  return treffer.size === 1 && l.length === 1 ? l[0] : null;
}

export async function zuordnenPerson(u: Row, personId: number) {
  const objekt = (await db.select('SELECT objekt_id FROM bankkonten WHERE id = $1', [u.bankkonto_id]))[0]?.objekt_id ?? null;
  let ops = (await db.select(`SELECT * FROM (${OP_SQL}) WHERE person_id = $1 AND betrag - bezahlt > 0.005 ORDER BY faellig, einheit_lfd, id`, [personId]))
    .filter((o) => !objekt || o.objekt_id === objekt);
  const offen = (o: Row) => Math.round((o.betrag - o.bezahlt) * 100) / 100;
  const betragU = Math.round(u.betrag * 100) / 100;
  const text = norm(`${u.verwendungszweck ?? ''} ${u.gegenpartei ?? ''}`);
  // Mieter/Eigentümer mehrerer Einheiten: die Einheit aus dem Verwendungszweck (z. B. „2.OG“, „Anbau“) oder mit genau passendem Monatsbetrag
  const einheiten = [...new Set(ops.map((o) => o.einheit_id))];
  if (einheiten.length > 1) {
    const imText = einheiten.filter((eid) => {
      const n = norm(String(ops.find((o) => o.einheit_id === eid)?.einheit ?? '')).replace(/\s+/g, ' ').trim();
      return n.length >= 2 && new RegExp(`(^|\\s)${n.replace(/ /g, '\\s*')}(\\s|$)`).test(text);
    });
    const monatSumme = (eid: number) => { const e = ops.filter((o) => o.einheit_id === eid); const m = e[0]?.monat;
      return Math.round(e.filter((o) => o.monat === m).reduce((a, o) => a + offen(o), 0) * 100) / 100; };
    const passend = einheiten.filter((eid) => monatSumme(eid) === betragU || ops.some((o) => o.einheit_id === eid && offen(o) === betragU));
    const wahl = imText.length === 1 ? imText[0] : passend.length === 1 ? passend[0] : null;
    if (wahl !== null) ops = ops.filter((o) => o.einheit_id === wahl);
  }
  // Zahlweise der Liegenschaft: „zusammen“ = eine Überweisung je Monat (Miete + Nebenkosten bzw. Hausgeld + Rücklage),
  // „getrennt“ = einzelne Überweisungen; dann bestimmen Verwendungszweck und genau passender Betrag den Posten.
  // Nennt der Verwendungszweck genau einen Monat (z. B. „Miete 12/2025“), gilt das als Tilgungsbestimmung (§ 366 Abs. 1 BGB):
  // dieser Monat zuerst, sonst wie bisher der älteste offene Posten (§ 366 Abs. 2 BGB)
  const genannt = monatImText(u.verwendungszweck ?? '', ops);
  if (genannt) ops = [...ops.filter((o) => o.monat === genannt), ...ops.filter((o) => o.monat !== genannt)];
  const getrennt = ops.length ? await zahlweiseGetrennt(ops[0].objekt_id, personId, ops[0].einheit_id, ops[0].vertrag_id) : false;
  if (getrennt) ops = getrenntOrdnen(ops, betragU, text, offen);
  else {
    // Auch bei „zusammen“: nennt der Verwendungszweck ausdrücklich nur bestimmte Arten (z. B. „Nebenkosten“) und passt der Betrag
    // genau auf diese Posten eines Monats, dann dorthin buchen statt auf die Kaltmiete
    const genau = getrenntOrdnen(ops, betragU, text, offen, true);
    if (genau) ops = genau;
  }
  const konten = await db.select('SELECT id, nummer FROM buchungskonten');
  const kontoId = (art: string) => konten.find((k) => k.nummer === (KONTO_FUER_ART[art] ?? '1000'))?.id ?? null;
  let rest = Math.round(u.betrag * 100) / 100;
  for (const o of ops) {
    if (rest <= 0.005) break;
    const teil = Math.min(rest, Math.round((o.betrag - o.bezahlt) * 100) / 100);
    await insert('buchungen', { datum: u.datum, betrag: teil, buchungskonto_id: kontoId(o.art), objekt_id: o.objekt_id, einheit_id: o.einheit_id,
      sollstellung_id: o.id, bankumsatz_id: u.id, text: `${o.art} ${o.monat}: ${u.gegenpartei}` });
    rest = Math.round((rest - teil) * 100) / 100;
  }
  if (rest > 0.005) {
    // Überzahlung als Guthaben ohne offenen Posten buchen: auf das Einnahmekonto und die Einheit des letzten Postens der Person,
    // damit die Buchung ein Konto hat (sonst sperrt sie den Abschluss) und im Vermögensbericht als Guthaben erscheint
    const letzter = (await db.select(`SELECT s.art, s.einheit_id, e.objekt_id, o.verwaltungsart FROM sollstellungen s JOIN einheiten e ON e.id = s.einheit_id
      JOIN objekte o ON o.id = e.objekt_id WHERE s.person_id = $1 ${objekt ? 'AND e.objekt_id = ' + Number(objekt) : ''} ORDER BY s.monat DESC, s.id DESC LIMIT 1`, [personId]))[0];
    const art = letzter ? (letzter.verwaltungsart === 'WEG' && letzter.art === 'Rücklage' ? 'Hausgeld' : letzter.art) : 'Kaltmiete';
    await insert('buchungen', { datum: u.datum, betrag: rest, buchungskonto_id: kontoId(art), objekt_id: objekt ?? letzter?.objekt_id ?? null,
      einheit_id: letzter?.einheit_id ?? null, bankumsatz_id: u.id, text: `Überzahlung / Guthaben: ${u.gegenpartei}` });
  }
  // IBAN beim Mieter/Eigentümer merken, damit es beim nächsten Mal automatisch klappt
  if (u.gegen_iban) await db.execute(`UPDATE personen SET iban = $1 WHERE id = $2 AND (iban IS NULL OR iban = '')`, [u.gegen_iban, personId]);
  await db.execute(`UPDATE bankumsaetze SET status = 'zugeordnet' WHERE id = $1`, [u.id]);
}

export async function zuordnenRechnung(u: Row, rechnungId: number) {
  const r = (await db.select('SELECT * FROM rechnungen WHERE id = $1', [rechnungId]))[0];
  await insert('buchungen', { datum: u.datum, betrag: u.betrag, buchungskonto_id: r.buchungskonto_id, objekt_id: r.objekt_id, einheit_id: r.einheit_id,
    rechnung_id: r.id, bankumsatz_id: u.id, text: `Rechnung ${r.rechnungsnr ?? r.id}: ${u.gegenpartei}` });
  await db.execute('UPDATE rechnungen SET bezahlt_am = $1 WHERE id = $2', [u.datum, r.id]);
  await db.execute(`UPDATE bankumsaetze SET status = 'zugeordnet' WHERE id = $1`, [u.id]);
}

/** Direkt auf ein Buchungskonto buchen (z. B. Kontoführungsgebühren, Zinsen). */
export async function zuordnenKonto(u: Row, kontoId: number) {
  const objekt = (await db.select('SELECT objekt_id FROM bankkonten WHERE id = $1', [u.bankkonto_id]))[0]?.objekt_id ?? null;
  await insert('buchungen', { datum: u.datum, betrag: u.betrag, buchungskonto_id: kontoId, objekt_id: objekt, bankumsatz_id: u.id,
    text: `${u.gegenpartei} ${u.verwendungszweck}`.trim().slice(0, 200) });
  await db.execute(`UPDATE bankumsaetze SET status = 'zugeordnet' WHERE id = $1`, [u.id]);
}

/** Zuordnung rückgängig machen */
export async function zuordnungLoesen(u: Row) {
  const r = await db.select('SELECT rechnung_id FROM buchungen WHERE bankumsatz_id = $1 AND rechnung_id IS NOT NULL', [u.id]);
  for (const x of r) await db.execute('UPDATE rechnungen SET bezahlt_am = NULL WHERE id = $1', [x.rechnung_id]);
  await db.execute('DELETE FROM buchungen WHERE bankumsatz_id = $1', [u.id]);
  await db.execute(`UPDATE bankumsaetze SET status = 'offen' WHERE id = $1`, [u.id]);
}

/** Arten, die im Verwendungszweck genannt sind (für getrennte Überweisungen) */
function artenImText(text: string): Set<string> {
  const a = new Set<string>();
  if (/r(ü|ue)cklage|ruecklage|erhaltungsr/.test(text)) a.add('Rücklage');
  if (/\b(nk|nebenkosten|betriebskosten|bk|nkv|bkv|vorauszahlung)\b/.test(text)) { a.add('NK'); a.add('HK'); }
  if (/\b(hk|heizkosten|heizung|hkv)\b/.test(text)) a.add('HK');
  if (/\b(kaltmiete|grundmiete|nettomiete|miete|mietzahlung|pacht)\b/.test(text)) { a.add('Kaltmiete'); a.add('USt'); }
  if (/\bhausgeld\b|\bwohngeld\b/.test(text)) a.add('Hausgeld');
  if (/sonderumlage/.test(text)) a.add('Sonderumlage');
  return a;
}

/**
 * Getrennte Überweisungen: zuerst im ältesten Monat die Posten suchen, deren offene Beträge zusammen genau die Zahlung ergeben
 * (z. B. nur NK, NK + HK, Kaltmiete + USt). Bei mehreren passenden Kombinationen entscheidet der Verwendungszweck.
 * Passt keine Kombination genau, kommen die im Verwendungszweck genannten Arten zuerst, dann Posten mit genau passendem Betrag.
 */
export function getrenntOrdnen(ops: Row[], betrag: number, text: string, offen: (o: Row) => number, nurGenannt: true): Row[] | null;
export function getrenntOrdnen(ops: Row[], betrag: number, text: string, offen: (o: Row) => number, nurGenannt?: false): Row[];
export function getrenntOrdnen(ops: Row[], betrag: number, text: string, offen: (o: Row) => number, nurGenannt = false): Row[] | null {
  const arten = artenImText(text);
  if (nurGenannt && !arten.size) return null;
  const monate = [...new Set(ops.map((o) => o.monat))];
  for (const m of monate) {
    const l = ops.filter((o) => o.monat === m).slice(0, 8);
    let best: Row[] | null = null, bestScore = -Infinity;
    for (let mask = 1; mask < 1 << l.length; mask++) {
      const sub = l.filter((_, i) => mask & (1 << i));
      if (Math.abs(sub.reduce((a, o) => a + offen(o), 0) - betrag) > 0.005) continue;
      if (nurGenannt && (sub.length === l.length || sub.some((o) => !arten.has(o.art)))) continue;
      // Treffer im Text zählen, Posten außerhalb der genannten Arten abziehen
      const score = arten.size ? sub.filter((o) => arten.has(o.art)).length * 10 - sub.filter((o) => !arten.has(o.art)).length * 11 : 0;
      if (score > bestScore) { best = sub; bestScore = score; }
    }
    if (best) { const b = best; return [...b, ...ops.filter((o) => !b.includes(o))]; }
    if (nurGenannt) return null; // nur im ältesten offenen Monat suchen
  }
  if (nurGenannt) return null;
  const rang = (o: Row) => (arten.has(o.art) ? 0 : offen(o) === betrag ? 1 : 2);
  return [...ops].sort((a, b) => rang(a) - rang(b));
}

/** Zahlweise einer Liegenschaft (Einstellung in den Stammdaten; Ausnahme je Mietvertrag bzw. je Eigentümer) */
async function zahlweiseGetrennt(objektId: number, personId: number, einheitId: number, vertragId?: number | null): Promise<boolean> {
  const o = (await db.select('SELECT verwaltungsart, miete_zahlweise, ruecklage_zahlweise FROM objekte WHERE id = $1', [objektId]))[0];
  if (!o) return false;
  if (o.verwaltungsart === 'WEG') {
    const ei = (await db.select('SELECT zahlweise FROM eigentum WHERE einheit_id = $1 AND person_id = $2 ORDER BY id DESC LIMIT 1', [einheitId, personId]))[0];
    return (ei?.zahlweise || o.ruecklage_zahlweise) === 'getrennt';
  }
  const v = vertragId ? (await db.select('SELECT zahlweise FROM mietvertraege WHERE id = $1', [vertragId]))[0] : null;
  return (v?.zahlweise || o.miete_zahlweise) === 'getrennt';
}

/** Bankumsätze ganz löschen (vorher Zuordnung lösen). Beim nächsten Import desselben Auszugs kommen sie wieder.
 *  Hat ein Konto danach keine Umsätze mehr, wird sein Startsaldo zurückgesetzt, damit ein neuer Import frisch beginnt. */
export async function umsaetzeLoeschen(ids: number[]) {
  // Vor größeren Löschungen eine Sicherung anlegen (nur in der Mac-/Windows-App)
  if (ids.length >= 20 && typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('db_sicherung_erstellen', { ordnerPfad: null }).catch(() => {});
  }
  const konten = new Set<number>();
  for (const id of ids) {
    const k = (await db.select('SELECT bankkonto_id FROM bankumsaetze WHERE id = $1', [id]))[0]?.bankkonto_id;
    if (k) konten.add(k);
    await zuordnungLoesen({ id });
    await db.execute('DELETE FROM bankumsaetze WHERE id = $1', [id]);
  }
  for (const k of konten) {
    const rest = await db.select('SELECT 1 FROM bankumsaetze WHERE bankkonto_id = $1 LIMIT 1', [k]);
    if (!rest.length) await db.execute('UPDATE bankkonten SET anfangssaldo = 0, saldo_datum = NULL WHERE id = $1', [k]);
  }
}

/** Startsaldo aus dem Kontoauszug übernehmen, wenn das Konto noch keine Umsätze hat (erster Import oder nach dem Löschen) */
export async function startsaldoUebernehmen(kontoId: number, anfang: number | undefined, ersterTag: string | undefined) {
  if (anfang === undefined || !ersterTag) return false;
  const da = await db.select('SELECT 1 FROM bankumsaetze WHERE bankkonto_id = $1 LIMIT 1', [kontoId]);
  if (da.length) return false;
  const vortag = new Date(new Date(ersterTag + 'T12:00:00').getTime() - 864e5).toISOString().slice(0, 10);
  await db.execute('UPDATE bankkonten SET anfangssaldo = $1, saldo_datum = $2 WHERE id = $3', [anfang, vortag, kontoId]);
  return true;
}

/** Ordnet alle offenen Umsätze zu, bei denen der Vorschlag sicher ist. */
export async function automatischZuordnen(): Promise<{ zugeordnet: number; pruefen: number }> {
  const offen = await db.select(`SELECT * FROM bankumsaetze WHERE status = 'offen' ORDER BY datum, id`);
  let zugeordnet = 0;
  for (const u of offen) {
    const v = await vorschlag(u);
    if (!v?.sicher) continue;
    if (v.art === 'person') await zuordnenPerson(u, v.id);
    else if (v.art === 'konto') await zuordnenKonto(u, v.id);
    else await zuordnenRechnung(u, v.id);
    zugeordnet++;
  }
  return { zugeordnet, pruefen: offen.length - zugeordnet };
}

/* ---------------- Kontoauszug als PDF ---------------- */

const GELD = /([+-]?\s?\d{1,3}(?:\.\d{3})*,\d{2}|[+-]?\s?\d+,\d{2})\s*([+-]|S|H)?\s*$/;
const BETRAG_TXT = (s: string) => Number(s.replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
const UEBERSPRINGEN = /kontostand|saldo|übertrag|uebertrag|zwischensumme|summe soll|summe haben|seite \d|blatt \d|^\s*buchungstag|^\s*datum\b/i;

export interface PdfAuszug { umsaetze: Umsatz[]; anfang?: number; ende?: number; hinweis?: string }

/** Liest die Umsätze aus dem Text eines PDF-Kontoauszugs (Sparkasse, Volksbank, Commerzbank, Deutsche Bank, ING u. a.).
 *  Erkennt Zeilen, die mit einem Datum beginnen und mit einem Betrag enden; Folgezeilen sind Empfänger und Verwendungszweck. */
export function parsePdfAuszug(text: string): PdfAuszug {
  const a = parseKlassisch(text), b = parseOnlineListe(text);
  return b.umsaetze.length && b.umsaetze.length >= a.umsaetze.length ? b : a;
}

const eurText = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
export function saldoHinweis(umsaetze: Umsatz[], anfang?: number, ende?: number) {
  const summe = Math.round(umsaetze.reduce((a, u) => a + u.betrag, 0) * 100) / 100;
  if (anfang === undefined) return 'Kontostand nicht gefunden, bitte die Liste prüfen.';
  if (ende === undefined) return `Anfangssaldo ${eurText(anfang)}, Umsätze ${eurText(summe)}, rechnerischer Endstand ${eurText(Math.round((anfang + summe) * 100) / 100)}. Bitte mit dem Kontostand vergleichen.`;
  return Math.abs(anfang + summe - ende) < 0.01 ? `Kontostand passt: ${eurText(anfang)} + Umsätze ${eurText(summe)} = ${eurText(ende)}.`
    : `Achtung: Alter Kontostand ${eurText(anfang)} + Umsätze ${eurText(summe)} ergibt nicht den neuen Kontostand ${eurText(ende)}. Bitte die Liste prüfen.`;
}

/** Betrag aus OCR-Text: das letzte Trennzeichen vor zwei Ziffern ist das Komma, alle anderen sind Tausenderpunkte */
function ocrBetrag(s: string): number {
  const t = s.replace(/[^\d.,;:]/g, '');
  const m = t.match(/^(.*)[.,;:](\d{2})$/);
  return m ? Number(m[1].replace(/[.,;:]/g, '') + '.' + m[2]) : Number(t.replace(/[.,;:]/g, ''));
}

/** Umsatzliste aus dem Online-Banking (z. B. Volksbank „Umsätze“ als PDF gedruckt):
 *  „Name  +900,00 EUR“, darunter „IBAN  02.01.2025“, danach der Verwendungszweck. */
const VIER = new WeakMap<Umsatz, number>();
export function parseOnlineListe(text: string): PdfAuszug {
  const zeilen = text.split('\n').map((z) => z.replace(/\s+/g, ' ').trim()).filter(Boolean);
  // „Name ±Betrag EUR“, wahlweise gleich dahinter „[IBAN] Datum“
  // Dezimaltrenner: Komma, oder von der Texterkennung als Punkt, Semikolon oder Doppelpunkt gelesen
  const KOPF = /^(.*?)\s*([+\-−–$*·•]?)\s?(\d{1,3}(?:[.,]\d{3})*[.,;:]\d{2})\s*(?:EUR|€)\b\s*(.*)$/i;
  const DAT_IRGENDWO = /(\d{1,2})[.:,](\d{1,2})[.:,](20\d{2})/;
  const BETRAGZEILE = /\d[.,;:]\d{2}\s*(?:EUR|€)/i;
  const unerkannt: string[] = [];
  const DAT = /(\d{1,2})[.:,](\d{1,2})[.:,](20\d{2})\W*$/;
  const IBAN = /^([A-Z]{2}\d{2}[A-Z0-9]{10,30})$/;
  let anfang: number | undefined, ende: number | undefined;
  const out: Umsatz[] = [];
  type Akt = Umsatz & { teile: string[]; offen: boolean; zeilen: number };
  let akt: Akt | null = null;
  const fertig = () => {
    if (akt?.datum) { const { teile, offen: _o, zeilen: _z, ...u } = akt; u.verwendungszweck = teile.join(' ').slice(0, 400); out.push(u);
      if (VIER.has(akt)) VIER.set(u, VIER.get(akt)!); }
    akt = null;
  };
  // „[IBAN oder Name] Datum“ am Zeilenende auswerten
  const datumZeile = (u: Akt, z: string) => {
    const d = z.match(DAT); if (!d) return false;
    u.datum = `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`;
    const vorn = z.slice(0, d.index).replace(/[|]/g, ' ').trim();
    const i = vorn.replace(/\s/g, '').match(IBAN);
    if (i) u.gegen_iban = i[1]; else if (vorn && !u.gegenpartei) u.gegenpartei = vorn.slice(0, 120);
    return true;
  };
  for (const z of zeilen) {
    const k = z.match(KOPF);
    if (k && (!k[4] || DAT.test(k[4]))) {
      const wert = ocrBetrag(k[3]) * (/[-−–]/.test(k[2]) ? -1 : 1);
      if (/startsaldo|anfangssaldo|alter (kontostand|saldo)/i.test(z)) { anfang = wert; continue; }
      if (/endsaldo|neuer (kontostand|saldo)/i.test(z)) { fertig(); ende = wert; continue; }
      fertig();
      // Datum vor dem Betrag in der Namenszeile („Volksbank … 27.05.2025 +3,97 EUR“)
      let name = k[1], datumVorn = '';
      const dv = name.match(DAT_IRGENDWO);
      if (dv) { datumVorn = `${dv[3]}-${dv[2].padStart(2, '0')}-${dv[1].padStart(2, '0')}`; name = name.replace(dv[0], ' '); }
      const neu: Akt = { datum: datumVorn, betrag: wert, gegenpartei: name.replace(/[|]/g, ' ').replace(/\s+/g, ' ').replace(/[,:;]+$/, '').trim().slice(0, 120), gegen_iban: '',
        verwendungszweck: '', teile: [], offen: true, zeilen: 0, ...(!k[2] ? { pruefen: 'Vorzeichen' } : {}) };
      // ohne Vorzeichen und mit führender 4: oft ist die 4 ein falsch gelesenes „+“
      if (!k[2] && /^4\d/.test(k[3]) && !/^4[.,]/.test(k[3])) VIER.set(neu, ocrBetrag(k[3].slice(1)));
      if (k[4]) datumZeile(neu, k[4]);
      akt = neu;
      continue;
    }
    if (BETRAGZEILE.test(z)) unerkannt.push(z);
    if (!akt) continue;
    const u: Akt = akt;
    u.zeilen++;
    if (/^seite \d+ (von|\/) \d+/i.test(z)) { u.offen = false; continue; }
    if (!u.datum) {
      // das Datum muss direkt unter dem Betrag stehen, sonst war es ein Betrag im Verwendungszweck
      if (u.zeilen === 1 && datumZeile(u, z)) continue;
      unerkannt.push(`${u.gegenpartei} ${eurText(u.betrag)}`.trim());
      const vorher = out[out.length - 1];
      if (vorher && vorher.verwendungszweck.length < 300) vorher.verwendungszweck += ` ${u.gegenpartei} ${eurText(Math.abs(u.betrag))} ${z}`.replace(/\s+/g, ' ');
      akt = null; continue;
    }
    if (!u.gegen_iban && u.zeilen === 1) { const i = z.replace(/[\s|]/g, '').match(IBAN); if (i) { u.gegen_iban = i[1]; continue; } }
    if (u.offen && u.teile.length < 4) u.teile.push(z.replace(/[|]/g, ' ').replace(/\bTAN:?\s*\S+/i, 'TAN').replace(/\s+/g, ' ').trim());
  }
  fertig();
  const umsaetze = out.filter((u) => u.betrag !== 0);
  vorzeichenKlaeren(umsaetze, anfang, ende);
  ziffernPruefen(umsaetze, anfang, ende);
  let hinweis = saldoHinweis(umsaetze, anfang, ende);
  if (/^Achtung/.test(hinweis) && unerkannt.length)
    hinweis += ` Diese Zeilen mit Betrag wurden nicht als Umsatz erkannt, bitte mit dem Auszug vergleichen: ${unerkannt.slice(0, 6).map((z) => `„${z.slice(0, 70)}“`).join(', ')}${unerkannt.length > 6 ? ` und ${unerkannt.length - 6} weitere` : ''}.`;
  return { umsaetze, anfang, ende, hinweis };
}

/** Bleibt eine Differenz zum Endsaldo, die Umsätze markieren, bei denen eine einzige falsch gelesene Ziffer genau diese Differenz erklärt */
// Ziffern, die die Texterkennung leicht verwechselt
const ocrBetragAnzeige = (_u: Umsatz, alt: number) => Number('4' + Math.round(alt * 100).toString().padStart(3, '0')) / 100;
const VERWECHSELBAR = new Set(['17', '38', '08', '68', '56', '06', '89', '09', '14', '49', '35', '27', '04'].flatMap((p) => [p, p[1] + p[0]]));
function ziffernPruefen(liste: Umsatz[], anfang?: number, ende?: number) {
  if (anfang === undefined || ende === undefined) return;
  const d = Math.round((anfang + liste.reduce((a, u) => a + u.betrag, 0) - ende) * 100);
  if (d === 0) return;
  const treffer: Umsatz[] = [];
  for (const u of liste) {
    const c = String(Math.round(Math.abs(u.betrag) * 100)), vz = u.betrag < 0 ? -1 : 1;
    let passt = false;
    for (let i = 0; i < c.length && !passt; i++) for (let z = 0; z <= 9 && !passt; z++) {
      if (!VERWECHSELBAR.has(c[i] + z)) continue;
      const neu = Number(c.slice(0, i) + z + c.slice(i + 1));
      if (vz * neu - vz * Number(c) === -d) passt = true;
    }
    if (passt) treffer.push(u);
  }
  const rund = (u: Umsatz) => Math.round(Math.abs(u.betrag) * 100) % 10000 === 0;
  if (treffer.filter((u) => !rund(u)).length) treffer.splice(0, treffer.length, ...treffer.filter((u) => !rund(u)));
  if (!treffer.length || treffer.length > 8) return;
  const diff = (Math.abs(d) / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 });
  for (const u of treffer) u.pruefen = [u.pruefen, `Betrag mit dem Auszug vergleichen: eine falsch gelesene Ziffer hier würde die Differenz von ${diff} € erklären`].filter(Boolean).join(' · ');
}

/** Fehlt das Vorzeichen (Texterkennung), wird es aus anderen Umsätzen mit derselben IBAN oder Gegenpartei übernommen,
 *  sonst aus dem Verwendungszweck geschätzt. Passt der Endsaldo dann nicht, werden einzelne unsichere Beträge umgedreht,
 *  wenn genau das die Differenz erklärt. Unsichere Zeilen bleiben in der Vorschau markiert. */
function vorzeichenKlaeren(liste: Umsatz[], anfang?: number, ende?: number) {
  const sicher = liste.filter((u) => !u.pruefen), unsicher = liste.filter((u) => u.pruefen === 'Vorzeichen');
  if (!unsicher.length) return;
  const name = (u: Umsatz) => u.gegenpartei.toLowerCase().replace(/[^a-zäöüß]/g, '').slice(0, 12);
  for (const u of unsicher) {
    const gleich = sicher.filter((x) => (u.gegen_iban && x.gegen_iban === u.gegen_iban) || (name(u).length > 3 && name(x) === name(u)));
    const plus = gleich.filter((x) => x.betrag > 0).length, minus = gleich.length - plus;
    const raus = plus !== minus ? minus > plus
      : /lastschrift|\bDA-|ext\.?\s?ref|beleg|\bTAN\b|mandat|gläubiger|abschluss|entgelt|kartenzahlung|abschlag|rechnung|kd\.?-?nr|kunden-?nr|vertrag/i.test(u.verwendungszweck + ' ' + u.gegenpartei);
    u.betrag = raus ? -Math.abs(u.betrag) : Math.abs(u.betrag);
    u.pruefen = 'Vorzeichen per Texterkennung unsicher';
  }
  if (anfang === undefined || ende === undefined) return;
  const cent = (n: number) => Math.round(n * 100);
  const diff = () => cent(anfang + liste.reduce((a, u) => a + u.betrag, 0) - ende);
  if (diff() === 0) return;
  // ein einzelner Betrag erklärt die Differenz
  const d = diff(), eins = unsicher.find((u) => cent(2 * u.betrag) === d);
  if (eins) { eins.betrag = -eins.betrag; return; }
  // zwei Beträge erklären die Differenz
  for (let i = 0; i < unsicher.length; i++) for (let j = i + 1; j < unsicher.length; j++)
    if (cent(2 * unsicher[i].betrag) + cent(2 * unsicher[j].betrag) === d) { unsicher[i].betrag *= -1; unsicher[j].betrag *= -1; return; }
  // „+3,97“ als „43.97“ gelesen: die führende 4 war das Pluszeichen
  for (const u of unsicher) {
    const alt = VIER.get(u); if (alt === undefined) continue;
    if (cent(u.betrag) - cent(alt) === d) { u.betrag = alt; u.pruefen = `Betrag korrigiert: „4“ war das Pluszeichen (gelesen ${eurText(ocrBetragAnzeige(u, alt))})`; return; }
  }
}

function parseKlassisch(text: string): PdfAuszug {
  const zeilen = text.split('\n').map((z) => z.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const jahrText = text.match(/\b\d{1,2}\.\d{1,2}\.(20\d{2})\b/)?.[1] ?? text.match(/\b(20\d{2})\b/)?.[1] ?? String(new Date().getFullYear());
  const saldo = (re: RegExp) => { const z = zeilen.find((x) => re.test(x)); const m = z?.match(GELD); if (!m) return undefined;
    const v = BETRAG_TXT(m[1]); return m[2] === '-' || m[2] === 'S' || /^-/.test(m[1].trim()) ? -Math.abs(v) : v; };
  // Alter und neuer Kontostand; heißen beide nur „Kontostand am …“ (z. B. Sparkasse), gilt der erste als alt und der letzte als neu
  const kst = zeilen.filter((x) => /kontostand|saldo/i.test(x) && GELD.test(x));
  const wert = (z?: string) => { const m = z?.match(GELD); if (!m) return undefined; const v = BETRAG_TXT(m[1]);
    return m[2] === '-' || m[2] === 'S' || /^-/.test(m[1].trim()) ? -Math.abs(v) : Math.abs(v); };
  const anfang = saldo(/(alter|vorheriger|anfangs)[ -]?(kontostand|saldo)/i) ?? (kst.length > 1 ? wert(kst[0]) : undefined);
  const ende = saldo(/(neuer|end)[ -]?(kontostand|saldo)/i) ?? (kst.length > 1 ? wert(kst[kst.length - 1]) : undefined);
  const out: Umsatz[] = [];
  let akt: (Umsatz & { teile: string[] }) | null = null;
  const abschliessen = () => {
    if (!akt) return;
    const [kopf, ...rest] = akt.teile;
    akt.gegenpartei = (rest[0] ?? '').slice(0, 120);
    akt.verwendungszweck = [kopf, ...rest.slice(1)].filter(Boolean).join(' ').slice(0, 400);
    const { teile: _t, ...u } = akt; out.push(u); akt = null;
  };
  for (const z of zeilen) {
    const d = z.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})?\s+(?:(\d{1,2})\.(\d{1,2})\.(\d{2,4})?\s+)?(.*)$/);
    const g = z.match(GELD);
    if (d && g && !UEBERSPRINGEN.test(z)) {
      abschliessen();
      const y = d[3] ? (d[3].length === 2 ? '20' + d[3] : d[3]) : jahrText;
      const datum = `${y}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`;
      const roh = g[1].replace(/\s/g, ''), zeichen = g[2];
      let betrag = Math.abs(BETRAG_TXT(roh));
      const text0 = d[7].replace(GELD, '').trim();
      const minus = roh.startsWith('-') || zeichen === '-' || zeichen === 'S';
      const plus = roh.startsWith('+') || zeichen === '+' || zeichen === 'H';
      if (minus) betrag = -betrag;
      else if (!plus && !/gutschrift|eingang|zahlungseingang|haben|einzahlung|zins|erstattung|lohn|gehalt|rente/i.test(text0)) betrag = -betrag;
      akt = { datum, betrag, verwendungszweck: '', gegenpartei: '', gegen_iban: '', teile: [text0] };
      continue;
    }
    if (!akt || UEBERSPRINGEN.test(z) || akt.teile.length > 5) { if (akt && UEBERSPRINGEN.test(z)) abschliessen(); continue; }
    const iban = z.match(/\b([A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?)\b/);
    if (iban && !akt.gegen_iban) akt.gegen_iban = iban[1].replace(/\s/g, '');
    akt.teile.push(z.replace(/IBAN:?\s*[A-Z]{2}\d{2}[A-Z0-9 ]+/, '').replace(/BIC:?\s*[A-Z0-9]{8,11}/, '').trim());
  }
  abschliessen();
  const summe = Math.round(out.reduce((a, u) => a + u.betrag, 0) * 100) / 100;
  const e = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const hinweis = anfang !== undefined && ende !== undefined
    ? (Math.abs(anfang + summe - ende) < 0.01 ? `Kontostand passt: ${e(anfang)} + Umsätze ${e(summe)} = ${e(ende)}.`
      : `Achtung: Alter Kontostand ${e(anfang)} + Umsätze ${e(summe)} ergibt nicht den neuen Kontostand ${e(ende)}. Bitte die Liste prüfen.`)
    : 'Kontostand im PDF nicht gefunden, bitte die Liste prüfen.';
  return { umsaetze: out.filter((u) => u.betrag !== 0), anfang, ende, hinweis };
}

/** Eine Kontoauszug-Datei lesen: CAMT-XML, CSV, PDF oder (mit Texterkennung) eingescannte PDF */
export async function auszugLesen(f: File, fortschritt?: (text: string) => void): Promise<{ umsaetze: Umsatz[]; hinweis?: string; anfang?: number; ende?: number }> {
  const buf = new Uint8Array(await f.arrayBuffer());
  if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
    const { pdfText } = await import('./rechnungLesen');
    let text = await pdfText(buf, 60), ocr = false;
    if (!text.trim()) {
      const { ocrVerfuegbar, pdfOcrText } = await import('./ocr');
      if (!ocrVerfuegbar()) throw new Error(`${f.name}: Die PDF enthält keinen Text (eingescannt). Die Texterkennung gibt es nur in der Mac-App. Sonst bitte den Auszug als CSV oder CAMT-XML laden.`);
      text = await pdfOcrText(buf, (s, n) => fortschritt?.(`Texterkennung ${f.name}: Seite ${s} von ${n} …`)); ocr = true;
    }
    return auszugAusText(f.name, text, ocr);
  }
  const { istBild } = await import('./ocr');
  if (istBild(f)) return bilderLesen([f], fortschritt);
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('\uFFFD')) text = new TextDecoder('windows-1252').decode(buf);
  return { umsaetze: parseDatei(f.name, text) };
}

function auszugAusText(name: string, text: string, ocr: boolean) {
  const r = parsePdfAuszug(text);
  if (!r.umsaetze.length) throw new Error(ocr
    ? `${name}: Die Texterkennung hat keine Umsätze gefunden. Bitte schärfere Fotos verwenden oder den Auszug als CSV laden.`
    : `${name}: In der PDF wurden keine Umsätze erkannt. Bitte den Auszug als CSV oder CAMT-XML laden.`);
  if (ocr) r.hinweis = `Per Texterkennung gelesen, bitte Beträge prüfen. ${r.hinweis ?? ''}`.trim();
  return r;
}

/** Mehrere Fotos eines Auszugs (in Reihenfolge der Dateinamen) zusammen lesen */
export async function bilderLesen(files: File[], fortschritt?: (text: string) => void) {
  const { ocrVerfuegbar, bildText } = await import('./ocr');
  if (!ocrVerfuegbar()) throw new Error('Fotos von Kontoauszügen kann nur die Mac-App lesen (Texterkennung).');
  const liste = [...files].sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  const texte: string[] = [];
  for (let i = 0; i < liste.length; i++) {
    fortschritt?.(`Texterkennung: Bild ${i + 1} von ${liste.length} …`);
    texte.push(await bildText(liste[i]));
  }
  return auszugAusText(liste.length === 1 ? liste[0].name : `${liste.length} Fotos`, texte.join('\n'), true);
}
