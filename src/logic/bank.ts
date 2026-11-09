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
export async function zuordnenPerson(u: Row, personId: number) {
  const objekt = (await db.select('SELECT objekt_id FROM bankkonten WHERE id = $1', [u.bankkonto_id]))[0]?.objekt_id ?? null;
  const ops = (await db.select(`SELECT * FROM (${OP_SQL}) WHERE person_id = $1 AND betrag - bezahlt > 0.005 ORDER BY faellig, id`, [personId]))
    .filter((o) => !objekt || o.objekt_id === objekt);
  // Hausgeld und Rücklage getrennt überwiesen: Verwendungszweck „Rücklage“ oder genau passender Betrag bestimmt,
  // welcher Posten zuerst bezahlt wird. Sonst gilt die Reihenfolge nach Fälligkeit.
  const offen = (o: Row) => Math.round((o.betrag - o.bezahlt) * 100) / 100;
  const betragU = Math.round(u.betrag * 100) / 100;
  const zweckRl = /r(ü|ue)cklage/i.test(`${u.verwendungszweck ?? ''}`);
  const rang = (o: Row) => (zweckRl && o.art === 'Rücklage' ? 0 : !zweckRl && offen(o) === betragU ? 1 : 2);
  ops.sort((a, b) => rang(a) - rang(b));
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
export async function auszugLesen(f: File, fortschritt?: (text: string) => void): Promise<{ umsaetze: Umsatz[]; hinweis?: string; anfang?: number }> {
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
