// Liegenschaft mit allen zugehörigen Daten löschen (Einheiten, Verträge, Buchungen, Bank, Rechnungen, Dokumenteinträge …).
import { db, sicherheit } from '../db';

/** Was beim Löschen mit entfernt wird, für die Bestätigung */
export async function loeschUmfang(id: number) {
  const n = async (sql: string) => Number((await db.select(sql, [id]))[0]?.n ?? 0);
  return {
    einheiten: await n('SELECT COUNT(*) n FROM einheiten WHERE objekt_id = $1'),
    vertraege: await n('SELECT COUNT(*) n FROM mietvertraege v JOIN einheiten e ON e.id = v.einheit_id WHERE e.objekt_id = $1'),
    buchungen: await n('SELECT COUNT(*) n FROM buchungen WHERE objekt_id = $1 OR einheit_id IN (SELECT id FROM einheiten WHERE objekt_id = $1)'),
    rechnungen: await n('SELECT COUNT(*) n FROM rechnungen WHERE objekt_id = $1'),
    bankkonten: await n('SELECT COUNT(*) n FROM bankkonten WHERE objekt_id = $1'),
    posten: await n('SELECT COUNT(*) n FROM sollstellungen WHERE einheit_id IN (SELECT id FROM einheiten WHERE objekt_id = $1)'),
    dokumente: await n(`SELECT COUNT(*) n FROM dokumente WHERE (bezug = 'Objekt' AND bezug_id = $1)
      OR (bezug = 'Einheit' AND bezug_id IN (SELECT id FROM einheiten WHERE objekt_id = $1))
      OR (bezug = 'Mietvertrag' AND bezug_id IN (SELECT v.id FROM mietvertraege v JOIN einheiten e ON e.id = v.einheit_id WHERE e.objekt_id = $1))`),
  };
}

/**
 * Löscht die Liegenschaft in einem Schritt (alles oder nichts). Vorher wird in der App automatisch gesichert.
 * personenMit: Mieter und Eigentümer, die danach zu keiner anderen Liegenschaft mehr gehören, ebenfalls löschen.
 */
export async function objektLoeschen(objektId: number, personenMit: boolean): Promise<string | null> {
  const id = Math.trunc(Number(objektId));
  let sicherung: string | null = null;
  if (sicherheit.aktiv) sicherung = await sicherheit.sicherungErstellen();
  const E = `(SELECT id FROM einheiten WHERE objekt_id = ${id})`;
  const V = `(SELECT id FROM mietvertraege WHERE einheit_id IN ${E})`;
  const S = `(SELECT id FROM sollstellungen WHERE einheit_id IN ${E} OR vertrag_id IN ${V})`;
  const R = `(SELECT id FROM rechnungen WHERE objekt_id = ${id} OR einheit_id IN ${E})`;
  const B = `(SELECT id FROM bankkonten WHERE objekt_id = ${id})`;
  const U = `(SELECT id FROM bankumsaetze WHERE bankkonto_id IN ${B})`;
  // Personen, die nur über diese Liegenschaft verknüpft sind (Kandidaten, vor dem Löschen merken)
  const P = `SELECT eigentuemer_id AS p FROM objekte WHERE id = ${id} UNION SELECT person_id FROM beiraete WHERE objekt_id = ${id}
    UNION SELECT person_id FROM eigentum WHERE einheit_id IN ${E} UNION SELECT mieter_id FROM mietvertraege WHERE einheit_id IN ${E}
    UNION SELECT mieter2_id FROM mietvertraege WHERE einheit_id IN ${E} UNION SELECT person_id FROM sollstellungen WHERE einheit_id IN ${E}`;
  const kandidaten = personenMit ? (await db.select(P)).map((r) => Number(r.p)).filter((x) => x > 0) : [];
  const K = kandidaten.length ? kandidaten.join(',') : 'NULL';
  const sql = `BEGIN;
    DELETE FROM buchungen WHERE objekt_id = ${id} OR einheit_id IN ${E} OR sollstellung_id IN ${S} OR rechnung_id IN ${R} OR bankumsatz_id IN ${U};
    DELETE FROM sollstellungen WHERE id IN ${S};
    DELETE FROM rechnungen WHERE id IN ${R};
    DELETE FROM bankumsaetze WHERE id IN ${U};
    DELETE FROM bankkonten WHERE objekt_id = ${id};
    DELETE FROM abrechnungen WHERE objekt_id = ${id};
    DELETE FROM dokumente WHERE (bezug = 'Objekt' AND bezug_id = ${id}) OR (bezug = 'Einheit' AND bezug_id IN ${E}) OR (bezug = 'Mietvertrag' AND bezug_id IN ${V});
    UPDATE vorgaenge SET einheit_id = NULL WHERE einheit_id IN ${E} AND objekt_id <> ${id};
    DELETE FROM objekte WHERE id = ${id};
    DELETE FROM dokumente WHERE bezug = 'Person' AND bezug_id IN (${K}) AND bezug_id NOT IN (SELECT eigentuemer_id FROM objekte WHERE eigentuemer_id IS NOT NULL
      UNION SELECT person_id FROM beiraete UNION SELECT person_id FROM eigentum UNION SELECT mieter_id FROM mietvertraege
      UNION SELECT mieter2_id FROM mietvertraege WHERE mieter2_id IS NOT NULL UNION SELECT person_id FROM sollstellungen WHERE person_id IS NOT NULL);
    DELETE FROM personen WHERE id IN (${K}) AND id NOT IN (SELECT eigentuemer_id FROM objekte WHERE eigentuemer_id IS NOT NULL
      UNION SELECT person_id FROM beiraete UNION SELECT person_id FROM eigentum UNION SELECT mieter_id FROM mietvertraege
      UNION SELECT mieter2_id FROM mietvertraege WHERE mieter2_id IS NOT NULL UNION SELECT person_id FROM sollstellungen WHERE person_id IS NOT NULL);
    COMMIT;`;
  try { await db.execute(sql); }
  catch (e) { await db.execute('ROLLBACK').catch(() => {}); throw e; }
  return sicherung;
}
