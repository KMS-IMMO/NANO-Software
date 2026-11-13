// Eigentümerversammlung: Tagesordnung aus Vorlagen, Anwesenheit, Abstimmung je Eigentümer, Beschluss-Sammlung und Abschluss.
import { db, type Row } from '../db';
import { personLabel } from '../db/labels';

export type Stimme = 'Ja' | 'Nein' | 'Enthaltung';
export type Status = 'Anwesend' | 'Abwesend' | 'Vertreten';
export const ARTEN = ['Ordentliche Versammlung', 'Außerordentliche Versammlung', 'Umlaufbeschluss'] as const;

export interface Top { id?: number; nr: number; titel: string; antrag: string; beschluss: boolean; aktiv: boolean; herkunft?: 'vorlage' | 'nano' | 'eigen'; hinweis?: string }

/** ISO-Datum plus n Monate (für Anfechtungsfrist und Einladungsfrist) */
export function plusTage(iso: string, tage: number) {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + tage);
  return d.toISOString().slice(0, 10);
}
export function plusMonate(iso: string, m: number) {
  const d = new Date(iso + 'T00:00:00'); const tag = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + m);
  const letzter = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(tag, letzter));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Einladung muss spätestens drei Wochen vorher zugehen (§ 24 Abs. 4 Satz 2 WEG) */
export const einladenBis = (datum: string) => plusTage(datum, -21);

const ersetzen = (t: string | null | undefined, jahr: number) => (t ?? '').replace(/\{jahr\}/g, String(jahr)).replace(/\{vorjahr\}/g, String(jahr - 1));

/** Standard-TOPs aus der Vorlage plus Vorschläge aus NANO (vorgesehene Maßnahmen der Erhaltungsrücklage) */
export async function tagesordnungVorschlag(objektId: number, art: string, datum: string): Promise<Top[]> {
  const jahr = Number(datum.slice(0, 4)) || new Date().getFullYear();
  const vorlage = await db.select('SELECT * FROM top_vorlagen WHERE art = $1 ORDER BY nr, id', [art]);
  // Beiratswahl nur, wenn eine Amtszeit in den sechs Monaten nach der Versammlung endet oder noch kein Beirat gewählt ist
  const beirat = await db.select(`SELECT COUNT(*) AS n, SUM(CASE WHEN bis IS NOT NULL AND bis <= $2 THEN 1 ELSE 0 END) AS endet FROM beiraete WHERE objekt_id = $1`,
    [objektId, plusMonate(datum, 6)]);
  const beiratWahl = Number(beirat[0]?.n ?? 0) === 0 || Number(beirat[0]?.endet ?? 0) > 0;
  const tops: Top[] = vorlage.map((v) => ({
    nr: 0, titel: ersetzen(v.titel, jahr), antrag: ersetzen(v.antrag, jahr), beschluss: !!v.beschluss, herkunft: 'vorlage',
    aktiv: v.bedingung === 'beirat' ? beiratWahl : true,
    hinweis: v.bedingung === 'beirat' ? (beiratWahl ? 'Amtszeit endet oder kein Beirat eingetragen' : 'nur wenn die Amtszeit endet · diesmal nicht nötig') : undefined,
  }));
  if (art !== 'Umlaufbeschluss') {
    const mass = await db.select(`SELECT massnahme, betrag FROM ruecklage_massnahmen WHERE objekt_id = $1 AND status = 'Vorgesehen' ORDER BY jahr`, [objektId]).catch(() => [] as Row[]);
    const vor = tops.findIndex((t) => /^Verschiedenes/i.test(t.titel));
    const neu: Top[] = mass.map((m) => ({
      nr: 0, titel: `${m.massnahme}${m.betrag ? ' aus der Erhaltungsrücklage' : ''}`, beschluss: true, aktiv: true, herkunft: 'nano',
      antrag: `Die Gemeinschaft beschließt die Maßnahme „${m.massnahme}“${m.betrag ? ` mit Kosten bis ${Number(m.betrag).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €, die der Erhaltungsrücklage entnommen werden` : ''}.`,
      hinweis: 'vorgeschlagen, weil die Maßnahme in den Rücklagen auf „Vorgesehen“ steht',
    }));
    tops.splice(vor < 0 ? tops.length : vor, 0, ...neu);
  }
  return nummerieren(tops);
}

export function nummerieren(tops: Top[]): Top[] {
  let n = 0;
  return tops.map((t) => ({ ...t, nr: t.aktiv ? ++n : 0 }));
}

/** Eigentümer zum Tag der Versammlung, je Person zusammengefasst (Kopfprinzip: eine Stimme je Eigentümer) */
export async function eigentuemerAmTag(objektId: number, datum: string): Promise<Row[]> {
  const r = await db.select(`SELECT p.id AS person_id, ${personLabel('p')} AS name, p.anrede, p.vorname, p.nachname, p.firma, p.strasse, p.plz, p.ort, p.email,
      GROUP_CONCAT(e.nummer, ', ') AS einheiten, SUM(COALESCE(e.mea, 0) * COALESCE(ei.anteil, 100) / 100.0) AS mea
    FROM eigentum ei JOIN einheiten e ON e.id = ei.einheit_id JOIN personen p ON p.id = ei.person_id
    WHERE e.objekt_id = $1 AND (ei.von IS NULL OR ei.von <= $2) AND (ei.bis IS NULL OR ei.bis >= $2)
    GROUP BY p.id ORDER BY MIN(e.nummer), name`, [objektId, datum]);
  return r;
}

export async function versammlungLaden(id: number) {
  const v = (await db.select(`SELECT v.*, o.name AS objekt, o.strasse AS o_strasse, o.plz AS o_plz, o.ort AS o_ort, o.gesamt_mea
    FROM versammlungen v JOIN objekte o ON o.id = v.objekt_id WHERE v.id = $1`, [id]))[0];
  if (!v) return null;
  const tops = await db.select('SELECT * FROM versammlung_tops WHERE versammlung_id = $1 ORDER BY nr', [id]);
  const teilnehmer = await db.select(`SELECT t.*, ${personLabel('p')} AS name, p.anrede, p.vorname, p.nachname, p.firma, p.strasse, p.plz, p.ort, p.email
    FROM versammlung_teilnehmer t JOIN personen p ON p.id = t.person_id WHERE t.versammlung_id = $1 ORDER BY t.einheiten, name`, [id]);
  const stimmen = await db.select(`SELECT s.* FROM versammlung_stimmen s JOIN versammlung_tops t ON t.id = s.top_id WHERE t.versammlung_id = $1`, [id]);
  const beschluesse = await db.select('SELECT * FROM beschluesse WHERE versammlung_id = $1', [id]);
  return { v, tops, teilnehmer, stimmen, beschluesse };
}
export type Versammlung = NonNullable<Awaited<ReturnType<typeof versammlungLaden>>>;

/** Versammlung mit Tagesordnung anlegen oder ändern; Teilnehmerliste aus den Eigentümern am Tag */
export async function versammlungSpeichern(objektId: number, werte: Row, tops: Top[], id?: number): Promise<number> {
  const felder = { datum: werte.datum, uhrzeit: werte.uhrzeit || null, art: werte.art, ort: werte.ort || null, online: werte.online ? 1 : 0, leitung: werte.leitung || null };
  if (id) {
    await db.execute('UPDATE versammlungen SET datum = $1, uhrzeit = $2, art = $3, ort = $4, online = $5, leitung = $6 WHERE id = $7',
      [felder.datum, felder.uhrzeit, felder.art, felder.ort, felder.online, felder.leitung, id]);
  } else {
    const r = await db.execute(`INSERT INTO versammlungen (objekt_id, datum, uhrzeit, art, ort, online, leitung, status) VALUES ($1, $2, $3, $4, $5, $6, $7, 'Geplant')`,
      [objektId, felder.datum, felder.uhrzeit, felder.art, felder.ort, felder.online, felder.leitung]);
    id = Number(r.lastInsertId);
  }
  // Tagesordnung: bestehende TOPs ohne Beschluss ersetzen
  const alt = await db.select('SELECT id FROM versammlung_tops WHERE versammlung_id = $1 AND beschluss_id IS NULL', [id]);
  const behalten = new Set(tops.filter((t) => t.id).map((t) => t.id));
  for (const a of alt) if (!behalten.has(a.id)) await db.execute('DELETE FROM versammlung_tops WHERE id = $1', [a.id]);
  for (const t of nummerieren(tops).filter((x) => x.aktiv)) {
    if (t.id) await db.execute('UPDATE versammlung_tops SET nr = $1, titel = $2, antrag = $3, beschluss = $4 WHERE id = $5', [t.nr, t.titel, t.antrag || null, t.beschluss ? 1 : 0, t.id]);
    else await db.execute('INSERT INTO versammlung_tops (versammlung_id, nr, titel, antrag, beschluss) VALUES ($1, $2, $3, $4, $5)', [id, t.nr, t.titel, t.antrag || null, t.beschluss ? 1 : 0]);
  }
  await teilnehmerAbgleichen(id, objektId, felder.datum);
  return id;
}

export async function teilnehmerAbgleichen(versammlungId: number, objektId: number, datum: string) {
  for (const e of await eigentuemerAmTag(objektId, datum)) {
    await db.execute(`INSERT INTO versammlung_teilnehmer (versammlung_id, person_id, einheiten, mea) VALUES ($1, $2, $3, $4)
      ON CONFLICT (versammlung_id, person_id) DO UPDATE SET einheiten = excluded.einheiten, mea = excluded.mea`, [versammlungId, e.person_id, e.einheiten, e.mea]);
  }
}

export interface Ergebnis { ja: number; nein: number; enthaltung: number; jaN: number; neinN: number; enthN: number; offen: number; angenommen: boolean; abgestimmt: boolean }

/** Ergebnis eines TOP: einfache Mehrheit der abgegebenen Ja- und Nein-Stimmen; Enthaltungen zählen nicht (§ 25 Abs. 1 WEG) */
export function ergebnis(topId: number, vs: Versammlung): Ergebnis {
  const mea = vs.v.zaehlung === 'MEA';
  const stimmb = vs.teilnehmer.filter((t) => t.status === 'Anwesend' || t.status === 'Vertreten');
  const e: Ergebnis = { ja: 0, nein: 0, enthaltung: 0, jaN: 0, neinN: 0, enthN: 0, offen: 0, angenommen: false, abgestimmt: false };
  for (const t of stimmb) {
    const s = vs.stimmen.find((x) => x.top_id === topId && x.teilnehmer_id === t.id)?.stimme as Stimme | undefined;
    const g = mea ? Number(t.mea) || 0 : 1;
    if (s === 'Ja') { e.ja += g; e.jaN++; } else if (s === 'Nein') { e.nein += g; e.neinN++; } else if (s === 'Enthaltung') { e.enthaltung += g; e.enthN++; } else e.offen++;
  }
  e.abgestimmt = e.jaN + e.neinN + e.enthN > 0;
  e.angenommen = e.ja > e.nein;
  return e;
}

export async function stimmeSetzen(topId: number, teilnehmerId: number, stimme: Stimme | null) {
  if (!stimme) await db.execute('DELETE FROM versammlung_stimmen WHERE top_id = $1 AND teilnehmer_id = $2', [topId, teilnehmerId]);
  else await db.execute(`INSERT INTO versammlung_stimmen (top_id, teilnehmer_id, stimme) VALUES ($1, $2, $3)
    ON CONFLICT (top_id, teilnehmer_id) DO UPDATE SET stimme = excluded.stimme`, [topId, teilnehmerId, stimme]);
}

async function naechsteNummer(objektId: number, jahr: string) {
  const r = await db.select(`SELECT nummer FROM beschluesse WHERE objekt_id = $1 AND nummer LIKE $2`, [objektId, `B-${jahr}-%`]);
  const max = r.reduce((m, x) => Math.max(m, Number(String(x.nummer).split('-')[2]) || 0), 0);
  return `B-${jahr}-${String(max + 1).padStart(2, '0')}`;
}

/** Abstimmungsergebnis als Beschluss in die Beschluss-Sammlung eintragen (§ 24 Abs. 7 und 8 WEG) */
export async function beschlussFesthalten(vs: Versammlung, top: Row) {
  const e = ergebnis(top.id, vs);
  const v = vs.v;
  const ergebnisText = e.angenommen ? 'Angenommen' : 'Abgelehnt';
  const summe = e.ja + e.nein;
  const zust = summe ? Math.round(e.ja / summe * 1000) / 10 : null;
  const werte = [top.titel, top.antrag || null, ergebnisText, zust, e.ja, e.nein, e.enthaltung, plusMonate(v.datum, 1)];
  if (top.beschluss_id) {
    await db.execute(`UPDATE beschluesse SET betreff = $1, notiz = $2, ergebnis = $3, zustimmung = $4, ja = $5, nein = $6, enthaltung = $7, anfechtung_bis = $8 WHERE id = $9`, [...werte, top.beschluss_id]);
  } else {
    const nr = await naechsteNummer(v.objekt_id, v.datum.slice(0, 4));
    const r = await db.execute(`INSERT INTO beschluesse (objekt_id, versammlung_id, nummer, datum, betreff, notiz, ergebnis, zustimmung, ja, nein, enthaltung, anfechtung_bis, status)
      VALUES ($9, $10, $11, $12, $1, $2, $3, $4, $5, $6, $7, $8, $13)`, [...werte, v.objekt_id, v.id, nr, v.datum, e.angenommen ? 'Geplant' : 'Erledigt']);
    await db.execute('UPDATE versammlung_tops SET beschluss_id = $1 WHERE id = $2', [Number(r.lastInsertId), top.id]);
  }
  await db.execute('UPDATE versammlung_tops SET erledigt = 1 WHERE id = $1', [top.id]);
}

/** Versammlung abschließen: Status, Ende, Anfechtungsfrist als Frist (§ 45 WEG) */
export async function abschliessen(vs: Versammlung) {
  const jetzt = new Date();
  const ende = `${String(jetzt.getHours()).padStart(2, '0')}:${String(jetzt.getMinutes()).padStart(2, '0')}`;
  await db.execute(`UPDATE versammlungen SET status = 'Durchgeführt', ende = COALESCE(ende, $1) WHERE id = $2`, [ende, vs.v.id]);
  if (vs.beschluesse.length) {
    const titel = `Anfechtungsfrist Beschlüsse ${vs.v.art} vom ${new Date(vs.v.datum + 'T00:00:00').toLocaleDateString('de-DE')}`;
    const da = await db.select('SELECT id FROM fristen WHERE objekt_id = $1 AND titel = $2', [vs.v.objekt_id, titel]);
    if (!da.length) await db.execute(`INSERT INTO fristen (titel, art, objekt_id, faellig, vorlauf_tage, notiz) VALUES ($1, 'Anfechtungsfrist', $2, $3, 7, $4)`,
      [titel, vs.v.objekt_id, plusMonate(vs.v.datum, 1), 'Ein Beschluss kann innerhalb eines Monats nach Beschlussfassung durch Klage angefochten werden (§ 45 WEG). Danach ist er bestandskräftig.']);
  }
}
