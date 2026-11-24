// Hausgeld-Stände einer Einheit nachträglich bearbeiten oder löschen.
// Danach werden die offenen (unbezahlten) Hausgeld-/Rücklage-Posten ab dem frühesten betroffenen Monat neu gestellt.
// Bezahlte Posten bleiben unverändert; abgeschlossene Jahre sind gesperrt.
import { db, type Row } from '../db';
import { hausgeldNeuStellen } from './soll';

export type HausgeldWerte = { gueltig_ab: string; betrag: number; davon_ruecklage: number };
export type HausgeldErgebnis = { neu: number; bezahlt: number };

/** Liefert eine Fehlermeldung, wenn ab dem Jahr dieses Datums schon eine Abrechnung des Objekts abgeschlossen ist */
export async function hausgeldSperre(objektId: number, ab: string): Promise<string | null> {
  const r = (await db.select(`SELECT jahr FROM abrechnungen WHERE objekt_id = $1 AND jahr >= $2 AND status = 'Abgeschlossen' ORDER BY jahr LIMIT 1`,
    [objektId, Number(String(ab).slice(0, 4))]))[0];
  return r ? `Das Jahr ${r.jahr} ist abgeschlossen. Hausgeld-Stände, die in ein abgeschlossenes Jahr wirken, kannst du erst ändern, wenn du den Abschluss in der Abrechnung aufhebst.` : null;
}

/** Wie viele bereits (teilweise) bezahlte Hausgeld-Posten der Einheit ab diesem Monat bestehen; sie werden nicht verändert */
async function bezahltAb(einheitId: number, abMonat: string): Promise<number> {
  return Number((await db.select(`SELECT COUNT(*) AS n FROM sollstellungen s WHERE s.einheit_id = $1 AND s.art IN ('Hausgeld', 'Rücklage') AND s.vertrag_id IS NULL
    AND s.monat >= $2 AND EXISTS (SELECT 1 FROM buchungen b WHERE b.sollstellung_id = s.id)`, [einheitId, abMonat]))[0]?.n ?? 0);
}

export function pruefeWerte(w: HausgeldWerte): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(w.gueltig_ab || '')) return 'Bitte das Datum angeben, ab dem das Hausgeld gilt.';
  if (!(w.betrag > 0)) return 'Bitte das monatliche Hausgeld eintragen.';
  if (w.davon_ruecklage < 0 || w.davon_ruecklage > w.betrag) return 'Die Rücklage muss zwischen 0 und dem Hausgeld liegen.';
  return null;
}

/** Einen Hausgeld-Stand ändern (Datum, Betrag, Rücklage) und offene Posten neu stellen */
export async function hausgeldAendern(id: number, objektId: number, w: HausgeldWerte): Promise<HausgeldErgebnis> {
  const alt: Row | undefined = (await db.select('SELECT * FROM hausgeld WHERE id = $1', [id]))[0];
  if (!alt) throw new Error('Diesen Hausgeld-Stand gibt es nicht mehr.');
  const f = pruefeWerte(w); if (f) throw new Error(f);
  const ab = w.gueltig_ab < alt.gueltig_ab ? w.gueltig_ab : String(alt.gueltig_ab);
  const sp = await hausgeldSperre(objektId, ab); if (sp) throw new Error(sp);
  const doppelt = (await db.select('SELECT id FROM hausgeld WHERE einheit_id = $1 AND gueltig_ab = $2 AND id <> $3', [alt.einheit_id, w.gueltig_ab, id]))[0];
  if (doppelt) throw new Error('Für dieses Datum gibt es schon einen Hausgeld-Stand. Bitte ein anderes Datum wählen oder den anderen Eintrag bearbeiten.');
  await db.execute('UPDATE hausgeld SET gueltig_ab = $1, betrag = $2, davon_ruecklage = $3 WHERE id = $4',
    [w.gueltig_ab, Math.round(w.betrag * 100) / 100, Math.round(w.davon_ruecklage * 100) / 100, id]);
  const monat = ab.slice(0, 7);
  return { neu: await hausgeldNeuStellen(objektId, monat), bezahlt: await bezahltAb(alt.einheit_id, monat) };
}

/** Einen Hausgeld-Stand löschen. Ab seinem Datum gilt dann wieder der vorherige Stand (oder keiner). */
export async function hausgeldLoeschen(id: number, objektId: number): Promise<HausgeldErgebnis> {
  const alt: Row | undefined = (await db.select('SELECT * FROM hausgeld WHERE id = $1', [id]))[0];
  if (!alt) throw new Error('Diesen Hausgeld-Stand gibt es nicht mehr.');
  const sp = await hausgeldSperre(objektId, alt.gueltig_ab); if (sp) throw new Error(sp);
  await db.execute('DELETE FROM hausgeld WHERE id = $1', [id]);
  const monat = String(alt.gueltig_ab).slice(0, 7);
  return { neu: await hausgeldNeuStellen(objektId, monat), bezahlt: await bezahltAb(alt.einheit_id, monat) };
}
