// Papierkorb: Was gelöscht wird, bleibt 30 Tage wiederherstellbar.
// Vor dem Löschen werden die Zeilen samt allem, was die Datenbank mitlöscht (ON DELETE CASCADE),
// und die Verweise, die sie leert (ON DELETE SET NULL), als JSON festgehalten.
import { db, type Row } from './index';

export const AUFBEWAHREN_TAGE = 30;

type Kante = { kind: string; spalte: string; eltern: string; elternSpalte: string; aktion: string };
type Gruppe = { t: string; rows: Row[] };
type Verweis = { t: string; spalte: string; wert: number; ids: number[] };
export type Inhalt = { gruppen: Gruppe[]; verweise: Verweis[]; wieder?: { sql: string; params: any[] }[] };

let kantenCache: Promise<Kante[]> | null = null;
function kanten(): Promise<Kante[]> {
  if (!kantenCache) kantenCache = (async () => {
    const tabellen = (await db.select(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('_schema', 'papierkorb')`)).map((r) => String(r.name));
    const k: Kante[] = [];
    for (const t of tabellen) for (const f of await db.select(`PRAGMA foreign_key_list(${t})`))
      k.push({ kind: t, spalte: String(f.from), eltern: String(f.table), elternSpalte: String(f.to ?? 'id'), aktion: String(f.on_delete ?? '').toUpperCase() });
    return k;
  })();
  return kantenCache;
}

const NAMEN: Record<string, string> = {
  personen: 'Kontakt', firmen: 'Firma', objekte: 'Liegenschaft', einheiten: 'Einheit', mietvertraege: 'Mietvertrag', eigentum: 'Eigentum',
  rechnungen: 'Rechnung', buchungen: 'Buchung', sollstellungen: 'Offener Posten', bankumsaetze: 'Bankumsatz', bankkonten: 'Bankkonto',
  dokumente: 'Dokument', versammlungen: 'Eigentümerversammlung', termine: 'Termin', erinnerungen: 'Erinnerung', todos: 'Aufgabe',
  notizen: 'Notiz', tickets: 'Karte', vorgaenge: 'Instandhaltung', boards: 'Board', mietanpassungen: 'Mietänderung', beiraete: 'Beirat',
  zaehler: 'Zähler', fristen: 'Frist', buchungskonten: 'Buchungskonto', wiederkehrend: 'Wiederkehrende Buchung', beschluesse: 'Beschluss',
};
export const artVon = (t: string) => NAMEN[t] ?? t;

/** Kurzer Name eines Datensatzes für die Liste im Papierkorb */
export function bezeichnungVon(r: Row): string {
  const name = [r.firma, [r.vorname, r.nachname].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const x = name || r.name || r.titel || r.bezeichnung || r.rechnungsnr || r.nummer || r.dateiname || r.text || r.verwendungszweck || r.beschreibung || '';
  const s = String(x).trim();
  return s.length > 80 ? s.slice(0, 78) + '…' : s;
}

/** Bezeichnungen, die sich erst über verknüpfte Daten ergeben (Vertrag: Mieter und Einheit) */
const NAME_SQL: Record<string, string> = {
  mietvertraege: `SELECT TRIM(COALESCE(p.firma || ', ', '') || COALESCE(p.vorname || ' ', '') || COALESCE(p.nachname, '')) || ' · ' || o.name || ' ' || e.nummer AS n
    FROM mietvertraege v JOIN personen p ON p.id = v.mieter_id JOIN einheiten e ON e.id = v.einheit_id JOIN objekte o ON o.id = e.objekt_id WHERE v.id = $1`,
  eigentum: `SELECT TRIM(COALESCE(p.vorname || ' ', '') || COALESCE(p.nachname, p.firma, '')) || ' · ' || o.name || ' ' || e.nummer AS n
    FROM eigentum x JOIN personen p ON p.id = x.person_id JOIN einheiten e ON e.id = x.einheit_id JOIN objekte o ON o.id = e.objekt_id WHERE x.id = $1`,
  einheiten: `SELECT o.name || ' ' || e.nummer AS n FROM einheiten e JOIN objekte o ON o.id = e.objekt_id WHERE e.id = $1`,
  sollstellungen: `SELECT art || ' ' || SUBSTR(monat, 6, 2) || '/' || SUBSTR(monat, 1, 4) AS n FROM sollstellungen WHERE id = $1`,
};

const liste = (ids: number[]) => ids.map((i) => Math.trunc(Number(i))).filter((i) => Number.isFinite(i)).join(',') || 'NULL';

/** Sammelt die Zeilen von tabelle (Bedingung where) und rekursiv alles, was beim Löschen mit verschwindet. */
async function sammeln(tabelle: string, where: string, params: any[], inhalt: Inhalt, gesehen: Set<string>) {
  const rows = await db.select(`SELECT * FROM ${tabelle} WHERE ${where}`, params);
  const neu = rows.filter((r) => r.id === undefined || !gesehen.has(`${tabelle}#${r.id}`));
  if (!neu.length) return;
  neu.forEach((r) => r.id !== undefined && gesehen.add(`${tabelle}#${r.id}`));
  inhalt.gruppen.push({ t: tabelle, rows: neu });
  const ids = neu.map((r) => r.id).filter((x) => x !== undefined) as number[];
  if (!ids.length) return;
  for (const k of (await kanten()).filter((k) => k.eltern === tabelle)) {
    const w = `${k.spalte} IN (${liste(ids)})`;
    if (k.aktion === 'CASCADE') await sammeln(k.kind, w, [], inhalt, gesehen);
    else if (k.aktion === 'SET NULL') {
      for (const r of await db.select(`SELECT id, ${k.spalte} AS v FROM ${k.kind} WHERE ${w}`).catch(() => [] as Row[])) {
        const v = inhalt.verweise.find((x) => x.t === k.kind && x.spalte === k.spalte && x.wert === r.v);
        if (v) v.ids.push(r.id); else inhalt.verweise.push({ t: k.kind, spalte: k.spalte, wert: r.v, ids: [r.id] });
      }
    }
  }
}

/** Hält fest, was gleich gelöscht wird. Das Löschen selbst macht der Aufrufer, danach ablegen() aufrufen. */
export async function erfassen(teile: { t: string; where: string; params?: any[] }[]): Promise<Inhalt> {
  const inhalt: Inhalt = { gruppen: [], verweise: [] }; const gesehen = new Set<string>();
  for (const x of teile) await sammeln(x.t, x.where, x.params ?? [], inhalt, gesehen);
  return inhalt;
}

/** Legt einen erfassten Stand in den Papierkorb, aber nur die Zeilen, die nach dem Löschen wirklich fehlen. */
export async function ablegen(art: string, bezeichnung: string, inhalt: Inhalt) {
  const gruppen: Gruppe[] = [];
  for (const g of inhalt.gruppen) {
    if (g.rows[0]?.id === undefined) { gruppen.push(g); continue; }
    const noch = new Set((await db.select(`SELECT id FROM ${g.t} WHERE id IN (${liste(g.rows.map((r) => r.id))})`)).map((r) => r.id));
    const weg = g.rows.filter((r) => !noch.has(r.id));
    if (weg.length) gruppen.push({ t: g.t, rows: weg });
  }
  if (!gruppen.length) return;
  await db.execute('INSERT INTO papierkorb (art, bezeichnung, daten) VALUES ($1, $2, $3)', [art, bezeichnung || null, JSON.stringify({ gruppen, verweise: inhalt.verweise, wieder: inhalt.wieder })]);
}

/** Einen Datensatz (oder mehrere derselben Tabelle) löschen und in den Papierkorb legen. */
export async function loeschen(tabelle: string, ids: number | number[], art?: string, bezeichnung?: string) {
  const l = Array.isArray(ids) ? ids : [ids];
  if (!l.length) return;
  const inhalt = await erfassen([{ t: tabelle, where: `id IN (${liste(l)})` }]);
  if (!bezeichnung && l.length === 1 && NAME_SQL[tabelle]) bezeichnung = (await db.select(NAME_SQL[tabelle], [l[0]]).catch(() => [] as Row[]))[0]?.n ?? undefined;
  await db.execute(`DELETE FROM ${tabelle} WHERE id IN (${liste(l)})`);
  const erste = inhalt.gruppen[0]?.rows ?? [];
  await ablegen(art ?? artVon(tabelle) + (l.length > 1 ? ` (${l.length})` : ''), bezeichnung ?? (l.length > 1 ? erste.slice(0, 3).map(bezeichnungVon).filter(Boolean).join('; ') : bezeichnungVon(erste[0] ?? {})), inhalt);
}

/** Zählt die Datensätze eines Eintrags je Art, z. B. „1 Mietvertrag, 12 Offene Posten“ */
export function umfang(daten: string): string {
  const d: Inhalt = JSON.parse(daten);
  const n = new Map<string, number>();
  for (const g of d.gruppen) n.set(g.t, (n.get(g.t) ?? 0) + g.rows.length);
  return [...n].map(([t, k]) => `${k} × ${artVon(t)}`).join(', ');
}

/** Stellt einen Eintrag wieder her (alles oder nichts) und entfernt ihn aus dem Papierkorb. */
export async function wiederherstellen(id: number) {
  const e = (await db.select('SELECT * FROM papierkorb WHERE id = $1', [id]))[0];
  if (!e) throw new Error('Der Eintrag ist nicht mehr im Papierkorb.');
  const d: Inhalt = JSON.parse(e.daten);
  await db.execute('BEGIN');
  try {
    await db.execute('PRAGMA defer_foreign_keys = ON');
    for (const g of d.gruppen) for (const r of g.rows) {
      const spalten = Object.keys(r);
      if (r.id !== undefined) {
        const da = (await db.select(`SELECT * FROM ${g.t} WHERE id = $1`, [r.id]))[0];
        if (da) {
          if (spalten.every((k) => String(da[k] ?? '') === String(r[k] ?? ''))) continue;
          throw new Error(`${artVon(g.t)} Nr. ${r.id} gibt es inzwischen anders. Wiederherstellen ist nicht möglich.`);
        }
      }
      await db.execute(`INSERT ${r.id === undefined ? 'OR IGNORE ' : ''}INTO ${g.t} (${spalten.join(',')}) VALUES (${spalten.map((_, i) => '$' + (i + 1)).join(',')})`, spalten.map((k) => r[k]));
    }
    for (const w of d.wieder ?? []) await db.execute(w.sql, w.params);
    for (const v of d.verweise) await db.execute(`UPDATE ${v.t} SET ${v.spalte} = $1 WHERE id IN (${liste(v.ids)}) AND ${v.spalte} IS NULL`, [v.wert]);
    await db.execute('DELETE FROM papierkorb WHERE id = $1', [id]);
    await db.execute('COMMIT');
  } catch (err: any) {
    await db.execute('ROLLBACK').catch(() => {});
    const t = String(err?.message ?? err);
    throw new Error(/FOREIGN KEY/i.test(t) ? 'Wiederherstellen nicht möglich: Ein zugehöriger Datensatz (z. B. Liegenschaft oder Kontakt) fehlt. Stelle ihn zuerst wieder her.' : t);
  }
}

/** Endgültig löschen */
export const entfernen = (id: number) => db.execute('DELETE FROM papierkorb WHERE id = $1', [id]);

/** Einträge älter als 30 Tage verwerfen (beim Start) */
export const aufraeumen = () => db.execute(`DELETE FROM papierkorb WHERE geloescht_am < datetime('now', 'localtime', '-${AUFBEWAHREN_TAGE} days')`).catch(() => {});
