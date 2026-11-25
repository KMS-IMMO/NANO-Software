// Soll-Stellung: erzeugt die monatlichen Forderungen (offene Posten)
// für Mietverträge (inkl. Staffel-/Index-/Erhöhungen und USt) und für Hausgeld (WEG).
import { db, type Row } from '../db';
import { buchungGesperrt, gesperrt, sperrText } from './abschluss';
import { ablegen, artVon, bezeichnungVon, erfassen } from '../db/papierkorb';

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

export async function soll(row: Row): Promise<number> {
  const r = await db.execute(
    `INSERT OR IGNORE INTO sollstellungen (vertrag_id, einheit_id, person_id, monat, art, betrag, faellig)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [row.vertrag_id ?? null, row.einheit_id, row.person_id, row.monat, row.art, row.betrag, row.faellig]);
  return r.rowsAffected;
}

/** Legt alle fehlenden Soll-Stellungen bis einschließlich `bisMonat` an (optional erst ab `von` und nur für eine Liegenschaft).
 *  Gibt die Anzahl neuer Posten zurück. Vorhandene Posten bleiben unverändert. */
export async function sollStellen(bisMonat: string, opt: { von?: string; objektId?: number; nurHausgeld?: boolean; vertragId?: number } = {}): Promise<number> {
  let n = 0;
  const imZeitraum = (m: string) => !opt.von || m >= opt.von;
  const nurObjekt = opt.objektId ? ` AND einheit_id IN (SELECT id FROM einheiten WHERE objekt_id = ${Number(opt.objektId)})` : '';

  // Mieten
  // Zahlt der Mieter an den Eigentümer (vermietete WEG-Einheit), entstehen bei uns keine Soll-Stellungen
  const vertraege = opt.nurHausgeld ? [] : await db.select(`SELECT * FROM mietvertraege WHERE COALESCE(zahlung_an, 'Verwaltung') <> 'Eigentümer'${nurObjekt}${opt.vertragId ? ` AND id = ${Number(opt.vertragId)}` : ''}`);
  const alleAnp = await db.select('SELECT * FROM mietanpassungen');
  for (const v of vertraege) {
    const anp = alleAnp.filter((a) => a.vertrag_id === v.id);
    const start = String(v.beginn).slice(0, 7);
    const ende = v.ende ? String(v.ende).slice(0, 7) : bisMonat;
    const last = ende < bisMonat ? ende : bisMonat;
    for (const monat of monate(start, last).filter(imZeitraum)) {
      const m = mieteImMonat(v, anp, monat);
      const base = { vertrag_id: v.id, einheit_id: v.einheit_id, person_id: v.mieter_id, monat, faellig: faelligAm(monat, v.faellig_tag) };
      for (const [art, betrag] of [['Kaltmiete', m.kalt], ['NK', m.nk], ['HK', m.hk], ['USt', m.ust]] as const) {
        if (betrag) n += await soll({ ...base, art, betrag });
      }
    }
  }

  // Hausgeld (WEG): Schuldner ist der jeweilige Eigentümer im Monat
  const hg = opt.vertragId ? [] : await db.select(`SELECT h.*, e.objekt_id, o.ruecklage_zahlweise FROM hausgeld h JOIN einheiten e ON e.id = h.einheit_id
    JOIN objekte o ON o.id = e.objekt_id WHERE o.verwaltungsart = 'WEG'${opt.objektId ? ` AND o.id = ${Number(opt.objektId)}` : ''} ORDER BY h.gueltig_ab`);
  const eig = await db.select('SELECT * FROM eigentum ORDER BY anteil DESC');
  const einheiten = [...new Set(hg.map((h) => h.einheit_id))];
  for (const eid of einheiten) {
    const saetze = hg.filter((h) => h.einheit_id === eid);
    for (const monat of monate(String(saetze[0].gueltig_ab).slice(0, 7), bisMonat).filter(imZeitraum)) {
      const stichtag = `${monat}-01`;
      const satz = [...saetze].reverse().find((h) => h.gueltig_ab <= stichtag);
      if (!satz || !satz.betrag) continue;
      const owner = eig.find((e) => e.einheit_id === eid && (!e.von || e.von <= `${monat}-31`) && (!e.bis || e.bis >= stichtag));
      if (!owner) continue;
      const base = { einheit_id: eid, person_id: owner.person_id, monat, faellig: faelligAm(monat, 3) };
      const rl = Math.round((Number(satz.davon_ruecklage) || 0) * 100) / 100;
      const getrennt = (owner.zahlweise || satz.ruecklage_zahlweise) === 'getrennt' && rl > 0 && rl < satz.betrag;
      if (!getrennt) { n += await soll({ ...base, art: 'Hausgeld', betrag: satz.betrag }); continue; }
      // Getrennte Überweisung: Hausgeld ohne Rücklage und Rücklage als eigener Posten.
      // Gibt es für den Monat schon einen Hausgeld-Posten (früher gemeinsam erzeugt), bleibt es dabei, damit nichts doppelt gefordert wird.
      const schon = await db.select(`SELECT 1 FROM sollstellungen WHERE einheit_id = $1 AND COALESCE(person_id, 0) = $2 AND monat = $3 AND art = 'Hausgeld' AND vertrag_id IS NULL`,
        [eid, owner.person_id ?? 0, monat]);
      if (schon.length) continue;
      n += await soll({ ...base, art: 'Hausgeld', betrag: Math.round((satz.betrag - rl) * 100) / 100 });
      n += await soll({ ...base, art: 'Rücklage', betrag: rl });
    }
  }
  return n;
}

export type Posten = { einheit_id: number; monat: string; art: string; betrag: number; person_id: number | null; vertrag_id: number | null; faellig: string };
export const ALLE_ARTEN = 'Alles laut Stammdaten';

/**
 * Beträge laut Stammdaten für einzelne Einheiten und Monate: Miete (Kalt, NK, HK, USt) aus dem Mietvertrag inkl. Anpassungen,
 * Hausgeld und Rücklage aus dem Hausgeld der Einheit. `art` = eine Art oder ALLE_ARTEN. Arten ohne Stammdaten liefern nichts.
 */
export async function stammdatenPosten(einheitIds: number[], monateListe: string[], art: string, faelligTag?: number): Promise<Posten[]> {
  if (!einheitIds.length || !monateListe.length) return [];
  const ids = einheitIds.map(Number).join(',');
  const vertraege = await db.select(`SELECT * FROM mietvertraege WHERE einheit_id IN (${ids}) AND COALESCE(zahlung_an, 'Verwaltung') <> 'Eigentümer' ORDER BY beginn`);
  const anp = vertraege.length ? await db.select(`SELECT * FROM mietanpassungen WHERE vertrag_id IN (${vertraege.map((v) => v.id).join(',')})`) : [];
  const hg = await db.select(`SELECT h.*, o.ruecklage_zahlweise FROM hausgeld h JOIN einheiten e ON e.id = h.einheit_id JOIN objekte o ON o.id = e.objekt_id
    WHERE h.einheit_id IN (${ids}) ORDER BY h.gueltig_ab`);
  const eig = await db.select(`SELECT * FROM eigentum WHERE einheit_id IN (${ids}) ORDER BY anteil DESC`);
  const out: Posten[] = [];
  const will = (a: string) => art === ALLE_ARTEN || art === a;
  for (const eid of einheitIds) {
    for (const monat of monateListe) {
      const anfang = `${monat}-01`, ende = `${monat}-31`;
      const v = [...vertraege].reverse().find((x) => x.einheit_id === eid && String(x.beginn) <= ende && (!x.ende || String(x.ende) >= anfang));
      if (v) {
        const m = mieteImMonat(v, anp.filter((a) => a.vertrag_id === v.id), monat);
        const f = faelligAm(monat, faelligTag ?? v.faellig_tag);
        for (const [a, b] of [['Kaltmiete', m.kalt], ['NK', m.nk], ['HK', m.hk], ['USt', m.ust]] as const)
          if (b && will(a)) out.push({ einheit_id: eid, monat, art: a, betrag: b, person_id: v.mieter_id, vertrag_id: v.id, faellig: f });
      }
      const satz = [...hg].reverse().find((h) => h.einheit_id === eid && h.gueltig_ab <= anfang);
      const owner = eig.find((e) => e.einheit_id === eid && (!e.von || e.von <= ende) && (!e.bis || e.bis >= anfang));
      if (satz?.betrag && owner) {
        const f = faelligAm(monat, faelligTag ?? 3);
        const rl = r2(Number(satz.davon_ruecklage) || 0);
        const getrennt = (owner.zahlweise || satz.ruecklage_zahlweise) === 'getrennt' && rl > 0 && rl < satz.betrag;
        const base = { einheit_id: eid, monat, person_id: owner.person_id, vertrag_id: null, faellig: f };
        if (will('Hausgeld')) out.push({ ...base, art: 'Hausgeld', betrag: getrennt ? r2(satz.betrag - rl) : Number(satz.betrag) });
        if (getrennt && will('Rücklage')) out.push({ ...base, art: 'Rücklage', betrag: rl });
      }
    }
  }
  return out;
}

/** Hausgeld-Posten einer Liegenschaft ab `abMonat` neu stellen, z. B. nach geändertem Hausgeld, Rücklage oder Zahlweise.
 *  Nur unbezahlte Posten werden ersetzt; bereits (teilweise) bezahlte bleiben unverändert. Gibt die Zahl neuer Posten zurück. */
export async function hausgeldNeuStellen(objektId: number, abMonat: string): Promise<number> {
  const r = (await db.select(`SELECT MIN(s.monat) AS a, MAX(s.monat) AS m FROM sollstellungen s JOIN einheiten e ON e.id = s.einheit_id
    WHERE e.objekt_id = $1 AND s.art IN ('Hausgeld', 'Rücklage') AND s.monat >= $2`, [objektId, abMonat]))[0];
  const bis = r?.m;
  if (!bis) return 0;
  // Nie Monate vor dem ersten vorhandenen Posten neu anlegen (z. B. wenn die Sollstellung erst ab einem bestimmten Monat begonnen wurde)
  if (r.a > abMonat) abMonat = r.a;
  await db.execute(`DELETE FROM sollstellungen WHERE art IN ('Hausgeld', 'Rücklage') AND monat >= $2 AND vertrag_id IS NULL
    AND einheit_id IN (SELECT id FROM einheiten WHERE objekt_id = $1)
    AND NOT EXISTS (SELECT 1 FROM buchungen b WHERE b.sollstellung_id = sollstellungen.id)`, [objektId, abMonat]);
  return sollStellen(bis, { von: abMonat, objektId, nurHausgeld: true });
}

/** Miet-Posten eines Vertrags neu stellen, z. B. nach einer Mietanpassung oder neuen Vorauszahlung.
 *  Noch nicht (teilweise) bezahlte Posten werden mit den Beträgen gestellt, die im jeweiligen Monat gelten. Bezahlte bleiben unverändert. */
export async function mieteNeuStellen(vertragId: number): Promise<number> {
  const bis = (await db.select(`SELECT MAX(monat) AS m FROM sollstellungen WHERE vertrag_id = $1 AND art IN ('Kaltmiete', 'NK', 'HK', 'USt')`, [vertragId]))[0]?.m;
  if (!bis) return 0;
  const offen = `vertrag_id = $1 AND art IN ('Kaltmiete', 'NK', 'HK', 'USt') AND NOT EXISTS (SELECT 1 FROM buchungen b WHERE b.sollstellung_id = sollstellungen.id)`;
  const vorher = (await db.select(`SELECT COUNT(*) AS n FROM sollstellungen WHERE ${offen}`, [vertragId]))[0]?.n ?? 0;
  await db.execute(`DELETE FROM sollstellungen WHERE ${offen}`, [vertragId]);
  await sollStellen(bis, { vertragId });
  return Number(vorher);
}

/** Buchungskonto (Einnahme) je Art des offenen Postens */
export const KONTO_FUER_ART: Record<string, string> = {
  Kaltmiete: '1000', NK: '1001', HK: '1002', USt: '1003', Hausgeld: '1010', Rücklage: '1010', Mahngebühr: '1011', 'NK-Abrechnung': '1001', 'WEG-Abrechnung': '1010',
};

/** Offene Posten mit bezahltem Betrag, Objekt, Einheit und Schuldner */
export const OP_SQL = `
  SELECT s.*, COALESCE((SELECT SUM(b.betrag) FROM buchungen b WHERE b.sollstellung_id = s.id), 0) AS bezahlt,
    o.id AS objekt_id, o.name AS objekt, o.verwaltungsart, e.nummer AS einheit, e.lfd_nr AS einheit_lfd,
    TRIM(COALESCE(p.firma, '') || CASE WHEN p.firma IS NOT NULL AND p.nachname IS NOT NULL THEN ', ' ELSE '' END ||
      COALESCE(p.nachname, '') || CASE WHEN p.vorname IS NOT NULL THEN ', ' || p.vorname ELSE '' END) AS schuldner
  FROM sollstellungen s
  JOIN einheiten e ON e.id = s.einheit_id
  JOIN objekte o ON o.id = e.objekt_id
  LEFT JOIN personen p ON p.id = s.person_id`;

/** Zahldatum für „Als bezahlt buchen“: Posten aus einem früheren Jahr gelten am Fälligkeitstag als bezahlt, sonst heute.
 *  Sonst stünde z. B. Hausgeld 2025, das erst im November 2026 nachgetragen wird, zum 31.12.2025 noch als offene Forderung im Vermögensbericht. */
export function zahldatumFuer(r: Row, heute = new Date().toISOString().slice(0, 10)): string {
  const f = String(r.faellig ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(f) && f.slice(0, 4) < heute.slice(0, 4) ? f : heute;
}

/** Restbetrag eines offenen Postens als Zahlung buchen (z. B. bar oder ohne Bankumsatz) */
export async function zahlungBuchen(r: Row, datum = zahldatumFuer(r)) {
  const sp = await gesperrt(r.objekt_id, datum);
  if (sp) throw new Error(sperrText(sp));
  const konto = (await db.select('SELECT id FROM buchungskonten WHERE nummer = $1', [KONTO_FUER_ART[r.art] ?? '1000']))[0];
  const jahr = /^\d{4}-\d{2}$/.test(String(r.monat)) ? Number(String(r.monat).slice(0, 4)) : Number(datum.slice(0, 4));
  await db.execute(`INSERT INTO buchungen (datum, betrag, buchungskonto_id, objekt_id, einheit_id, sollstellung_id, text, jahr) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [datum, Math.round((r.betrag - r.bezahlt) * 100) / 100, konto?.id ?? null, r.objekt_id, r.einheit_id, r.id, `Zahlung ${r.art} ${r.monat} (manuell)`, jahr]);
}

/** Von Hand als bezahlt gebuchte Posten eines Jahres, deren Zahldatum erst nach dem 31.12. liegt (früher: Datum des Klicks) */
export async function spaeteHandzahlungen(objekt: number, jahr: number): Promise<Row[]> {
  return db.select(`SELECT b.id, b.datum, b.betrag, s.faellig, s.monat, s.art, e.nummer AS einheit FROM buchungen b JOIN sollstellungen s ON s.id = b.sollstellung_id
      JOIN einheiten e ON e.id = s.einheit_id
    WHERE e.objekt_id = $1 AND b.bankumsatz_id IS NULL AND b.text LIKE 'Zahlung % (manuell)' AND substr(s.monat, 1, 4) = $2 AND b.datum > $3 AND s.faellig <= $3
    ORDER BY e.lfd_nr, e.nummer, s.monat`, [objekt, String(jahr), `${jahr}-12-31`]);
}

/** Diese Handzahlungen auf den Fälligkeitstag des Postens datieren. Ist das Jahr abgeschlossen, bricht es ohne Änderung ab. */
export async function handzahlungenDatieren(objekt: number, jahr: number): Promise<number> {
  const sp = await gesperrt(objekt, `${jahr}-12-31`);
  if (sp) throw new Error(sperrText(sp));
  const l = await spaeteHandzahlungen(objekt, jahr);
  for (const b of l) await db.execute('UPDATE buchungen SET datum = $1, jahr = $2 WHERE id = $3', [b.faellig, jahr, b.id]);
  return l.length;
}

/** Status eines Postens: bezahlt, erwartet (noch nicht fällig), fällig (überfällig in der Frist), mahnen, gemahnt */
export function postenStatus(r: Row, mahnenAbTage = 14, heute = new Date().toISOString().slice(0, 10)): 'bezahlt' | 'erwartet' | 'fällig' | 'mahnen' | 'gemahnt' {
  if (r.betrag - r.bezahlt <= 0.005) return 'bezahlt';
  if (r.faellig >= heute) return 'erwartet';
  if (Number(r.mahnstufe) > 0) return 'gemahnt';
  const grenze = new Date(heute); grenze.setDate(grenze.getDate() - mahnenAbTage);
  return r.faellig < grenze.toISOString().slice(0, 10) ? 'mahnen' : 'fällig';
}

export const mahnenAbTage = async () => Number((await db.select(`SELECT wert FROM einstellungen WHERE schluessel = 'mahnen_ab_tage'`))[0]?.wert) || 14;

/**
 * Offene Posten löschen (in den Papierkorb). Darauf gebuchte Zahlungen bleiben in der Buchhaltung, werden aber vom Posten gelöst
 * (sollstellung_id leer). Bankzahlungen erscheinen danach unter „Zahlungen ohne Posten“ und lassen sich neu zuordnen.
 * Beim Wiederherstellen aus dem Papierkorb werden sie wieder verbunden, solange sie noch keinem anderen Posten gehören.
 * Posten mit Zahlungen in einem abgeschlossenen Jahr bleiben stehen. Rückgabe: gelöscht, gelöste Zahlungen, gesperrt (mit Grund).
 */
export async function postenLoeschen(ids: number[]): Promise<{ geloescht: number; geloest: number; gesperrt: { id: number; grund: string }[] }> {
  const l = [...new Set(ids.map(Number).filter((i) => Number.isFinite(i)))];
  const res = { geloescht: 0, geloest: 0, gesperrt: [] as { id: number; grund: string }[] };
  if (!l.length) return res;
  const buchungen = await db.select(`SELECT id, sollstellung_id, objekt_id, datum, jahr FROM buchungen WHERE sollstellung_id IN (${l.join(',')})`);
  const frei: number[] = [];
  for (const id of l) {
    let grund: string | null = null;
    for (const b of buchungen.filter((x) => Number(x.sollstellung_id) === id)) if ((grund = await buchungGesperrt(b.objekt_id, b.datum, b.jahr))) break;
    if (grund) res.gesperrt.push({ id, grund }); else frei.push(id);
  }
  if (!frei.length) return res;
  const inhalt = await erfassen([{ t: 'sollstellungen', where: `id IN (${frei.join(',')})` }]);
  for (const id of frei) {
    const b = buchungen.filter((x) => Number(x.sollstellung_id) === id).map((x) => Number(x.id));
    if (b.length) inhalt.verweise.push({ t: 'buchungen', spalte: 'sollstellung_id', wert: id, ids: b });
    res.geloest += b.length;
  }
  await db.execute(`UPDATE buchungen SET sollstellung_id = NULL WHERE sollstellung_id IN (${frei.join(',')})`);
  await db.execute(`DELETE FROM sollstellungen WHERE id IN (${frei.join(',')})`);
  const erste = inhalt.gruppen[0]?.rows ?? [];
  const name = frei.length === 1 ? `${erste[0]?.art ?? ''} ${String(erste[0]?.monat ?? '').slice(5, 7)}/${String(erste[0]?.monat ?? '').slice(0, 4)}`.trim()
    : erste.slice(0, 3).map(bezeichnungVon).filter(Boolean).join('; ');
  await ablegen(artVon('sollstellungen') + (frei.length > 1 ? ` (${frei.length})` : ''), name, inhalt);
  res.geloescht = frei.length;
  return res;
}
