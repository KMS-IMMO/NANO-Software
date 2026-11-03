// Soll-Stellung: erzeugt die monatlichen Forderungen (offene Posten)
// für Mietverträge (inkl. Staffel-/Index-/Erhöhungen und USt) und für Hausgeld (WEG).
import { db, type Row } from '../db';

export function monate(von: string, bis: string): string[] {
  const out: string[] = [];
  let [y, m] = von.split('-').map(Number);
  const [by, bm] = bis.split('-').map(Number);
  while (y < by || (y === by && m <= bm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Miete eines Vertrags in einem Monat (YYYY-MM): Ausgangswerte plus alle Anpassungen bis Monatsbeginn. */
export function mieteImMonat(v: Row, anpassungen: Row[], monat: string) {
  const stichtag = `${monat}-01`;
  let kalt = Number(v.kaltmiete) || 0;
  let nk = Number(v.nk_vorauszahlung) || 0;
  let hk = Number(v.hk_vorauszahlung) || 0;
  for (const a of [...anpassungen].sort((x, y) => String(x.gueltig_ab).localeCompare(String(y.gueltig_ab)))) {
    if (a.gueltig_ab > stichtag) break;
    if (a.kaltmiete !== null && a.kaltmiete !== undefined) kalt = Number(a.kaltmiete);
    if (a.nk_vorauszahlung !== null && a.nk_vorauszahlung !== undefined) nk = Number(a.nk_vorauszahlung);
    if (a.hk_vorauszahlung !== null && a.hk_vorauszahlung !== undefined) hk = Number(a.hk_vorauszahlung);
  }
  const satz = Number(v.ust_satz) || 0;
  const ust = satz ? r2(((kalt + nk + hk) * satz) / 100) : 0;
  return { kalt, nk, hk, ust };
}

const faelligAm = (monat: string, tag: number) => `${monat}-${String(Math.min(Math.max(tag || 3, 1), 28)).padStart(2, '0')}`;

async function soll(row: Row): Promise<number> {
  const r = await db.execute(
    `INSERT OR IGNORE INTO sollstellungen (vertrag_id, einheit_id, person_id, monat, art, betrag, faellig)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [row.vertrag_id ?? null, row.einheit_id, row.person_id, row.monat, row.art, row.betrag, row.faellig]);
  return r.rowsAffected;
}

/** Legt alle fehlenden Soll-Stellungen bis einschließlich `bisMonat` an. Gibt die Anzahl neuer Posten zurück. */
export async function sollStellen(bisMonat: string): Promise<number> {
  let n = 0;

  // Mieten
  // Zahlt der Mieter an den Eigentümer (vermietete WEG-Einheit), entstehen bei uns keine Soll-Stellungen
  const vertraege = await db.select(`SELECT * FROM mietvertraege WHERE COALESCE(zahlung_an, 'Verwaltung') <> 'Eigentümer'`);
  const alleAnp = await db.select('SELECT * FROM mietanpassungen');
  for (const v of vertraege) {
    const anp = alleAnp.filter((a) => a.vertrag_id === v.id);
    const start = String(v.beginn).slice(0, 7);
    const ende = v.ende ? String(v.ende).slice(0, 7) : bisMonat;
    const last = ende < bisMonat ? ende : bisMonat;
    for (const monat of monate(start, last)) {
      const m = mieteImMonat(v, anp, monat);
      const base = { vertrag_id: v.id, einheit_id: v.einheit_id, person_id: v.mieter_id, monat, faellig: faelligAm(monat, v.faellig_tag) };
      for (const [art, betrag] of [['Kaltmiete', m.kalt], ['NK', m.nk], ['HK', m.hk], ['USt', m.ust]] as const) {
        if (betrag) n += await soll({ ...base, art, betrag });
      }
    }
  }

  // Hausgeld (WEG): Schuldner ist der jeweilige Eigentümer im Monat
  const hg = await db.select(`SELECT h.*, e.objekt_id FROM hausgeld h JOIN einheiten e ON e.id = h.einheit_id
    JOIN objekte o ON o.id = e.objekt_id WHERE o.verwaltungsart = 'WEG' ORDER BY h.gueltig_ab`);
  const eig = await db.select('SELECT * FROM eigentum ORDER BY anteil DESC');
  const einheiten = [...new Set(hg.map((h) => h.einheit_id))];
  for (const eid of einheiten) {
    const saetze = hg.filter((h) => h.einheit_id === eid);
    for (const monat of monate(String(saetze[0].gueltig_ab).slice(0, 7), bisMonat)) {
      const stichtag = `${monat}-01`;
      const satz = [...saetze].reverse().find((h) => h.gueltig_ab <= stichtag);
      if (!satz || !satz.betrag) continue;
      const owner = eig.find((e) => e.einheit_id === eid && (!e.von || e.von <= `${monat}-31`) && (!e.bis || e.bis >= stichtag));
      if (!owner) continue;
      n += await soll({ einheit_id: eid, person_id: owner.person_id, monat, art: 'Hausgeld', betrag: satz.betrag, faellig: faelligAm(monat, 3) });
    }
  }
  return n;
}

/** Buchungskonto (Einnahme) je Art des offenen Postens */
export const KONTO_FUER_ART: Record<string, string> = {
  Kaltmiete: '1000', NK: '1001', HK: '1002', USt: '1003', Hausgeld: '1010', Mahngebühr: '1011', 'NK-Abrechnung': '1001', 'WEG-Abrechnung': '1010',
};

/** Offene Posten mit bezahltem Betrag, Objekt, Einheit und Schuldner */
export const OP_SQL = `
  SELECT s.*, COALESCE((SELECT SUM(b.betrag) FROM buchungen b WHERE b.sollstellung_id = s.id), 0) AS bezahlt,
    o.id AS objekt_id, o.name AS objekt, o.verwaltungsart, e.nummer AS einheit,
    TRIM(COALESCE(p.firma, '') || CASE WHEN p.firma IS NOT NULL AND p.nachname IS NOT NULL THEN ', ' ELSE '' END ||
      COALESCE(p.nachname, '') || CASE WHEN p.vorname IS NOT NULL THEN ', ' || p.vorname ELSE '' END) AS schuldner
  FROM sollstellungen s
  JOIN einheiten e ON e.id = s.einheit_id
  JOIN objekte o ON o.id = e.objekt_id
  LEFT JOIN personen p ON p.id = s.person_id`;
