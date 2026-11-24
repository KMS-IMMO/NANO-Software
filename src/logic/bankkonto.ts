// Bankkonto bearbeiten und löschen (mit Rücksicht auf Umsätze, Buchungen und die Online-Banking-Verbindung)
import { db, sicherheit, type Row } from '../db';
import { ablegen, erfassen } from '../db/papierkorb';
import { invoke, isTauri, kontoBlz, pinGespeichert } from './bankAbruf';

/** IBAN ohne Leerzeichen, in Großbuchstaben */
export const ibanNormal = (s: unknown) => String(s ?? '').replace(/\s/g, '').toUpperCase();

/** Prüft die IBAN-Prüfziffer (Modulo 97). Leere IBAN gilt als gültig. */
export function ibanGueltig(s: unknown) {
  const i = ibanNormal(s);
  if (!i) return true;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(i)) return false;
  if (i.startsWith('DE') && i.length !== 22) return false;
  const z = (i.slice(4) + i.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const c of z) rest = (rest * 10 + Number(c)) % 97;
  return rest === 1;
}

/** IBAN in Vierergruppen zur Anzeige */
export const ibanAnzeige = (s: unknown) => ibanNormal(s).replace(/(.{4})/g, '$1 ').trim();

/** Speichert geänderte Kontodaten. Wechselt die Bank (BLZ), wird die Online-Banking-Verbindung getrennt. */
export async function bankkontoSpeichern(alt: Row, neu: Row): Promise<string> {
  const iban = ibanNormal(neu.iban) || null;
  const saldo = neu.anfangssaldo === '' || neu.anfangssaldo == null ? 0 : Number(String(neu.anfangssaldo).replace(',', '.'));
  await db.execute(`UPDATE bankkonten SET objekt_id = $1, name = $2, bank = $3, iban = $4, bic = $5, anfangssaldo = $6, saldo_datum = $7 WHERE id = $8`, [
    neu.objekt_id ? Number(neu.objekt_id) : null, String(neu.name ?? '').trim(), String(neu.bank ?? '').trim() || null, iban,
    String(neu.bic ?? '').replace(/\s/g, '').toUpperCase() || null, saldo, neu.saldo_datum || null, alt.id,
  ]);
  if (ibanNormal(alt.iban) === ibanNormal(iban)) return 'Die Kontodaten wurden gespeichert.';
  // Neue IBAN: die Kennung der Bank für dieses Konto passt nicht mehr
  await db.execute('UPDATE bankkonten SET fints_system_id = NULL, abruf_hinweis = NULL WHERE id = $1', [alt.id]);
  if (kontoBlz(alt) && kontoBlz(alt) !== kontoBlz({ iban })) {
    const verbunden = !!alt.auto_abruf || await pinGespeichert(alt.id);
    if (!verbunden) return 'Die Kontodaten wurden gespeichert.';
    if (isTauri()) await invoke('bank_pin_loeschen', { konto: alt.id }).catch(() => {});
    await db.execute('UPDATE bankkonten SET auto_abruf = 0 WHERE id = $1', [alt.id]);
    return 'Die Kontodaten wurden gespeichert. Weil die IBAN jetzt zu einer anderen Bank gehört, wurde die Online-Banking-Verbindung getrennt. Bitte neu verbinden.';
  }
  return 'Die Kontodaten wurden gespeichert.';
}

/** Was am Bankkonto hängt, für die Bestätigung vor dem Löschen */
export async function bankkontoUmfang(id: number) {
  const n = async (sql: string) => Number((await db.select(sql, [id]))[0]?.n ?? 0);
  return {
    umsaetze: await n('SELECT COUNT(*) n FROM bankumsaetze WHERE bankkonto_id = $1'),
    zugeordnet: await n(`SELECT COUNT(*) n FROM bankumsaetze WHERE bankkonto_id = $1 AND status = 'zugeordnet'`),
    buchungen: await n('SELECT COUNT(*) n FROM buchungen WHERE bankumsatz_id IN (SELECT id FROM bankumsaetze WHERE bankkonto_id = $1)'),
  };
}

/**
 * Löscht das Bankkonto mit allen Kontoumsätzen in einem Schritt (alles oder nichts). Vorher wird in der App automatisch gesichert.
 * buchungenMit = false: Die aus den Umsätzen entstandenen Buchungen bleiben in der Buchhaltung, nur die Verknüpfung zum Umsatz entfällt.
 * buchungenMit = true: Diese Buchungen werden ebenfalls gelöscht (Soll-Posten und Rechnungen gelten dann wieder als offen).
 */
export async function bankkontoLoeschen(kontoId: number, buchungenMit: boolean): Promise<string | null> {
  const id = Math.trunc(Number(kontoId));
  let sicherung: string | null = null;
  if (sicherheit.aktiv) sicherung = await sicherheit.sicherungErstellen();
  const U = `(SELECT id FROM bankumsaetze WHERE bankkonto_id = ${id})`;
  const B = `(SELECT id FROM buchungen WHERE bankumsatz_id IN ${U})`;
  // Für den Papierkorb festhalten, was gleich verschwindet (Umsätze und Kontoabgleich löscht die Datenbank mit)
  const name = (await db.select('SELECT name FROM bankkonten WHERE id = $1', [id]))[0]?.name ?? '';
  const inhalt = await erfassen([
    ...(buchungenMit ? [{ t: 'buchungen', where: `id IN ${B}` }, { t: 'dokumente', where: `bezug = 'Buchung' AND bezug_id IN ${B}` }] : []),
    { t: 'bankkonten', where: `id = ${id}` }]);
  const verknuepft = await db.select(`SELECT id, bankumsatz_id, rechnung_id FROM buchungen WHERE bankumsatz_id IN ${U}`);
  const bezahlt = buchungenMit ? await db.select(`SELECT id, bezahlt_am FROM rechnungen WHERE id IN (SELECT rechnung_id FROM buchungen WHERE bankumsatz_id IN ${U})`) : [];
  inhalt.wieder = buchungenMit
    ? bezahlt.map((r) => ({ sql: 'UPDATE rechnungen SET bezahlt_am = $1 WHERE id = $2', params: [r.bezahlt_am, r.id] }))
    : verknuepft.map((b) => ({ sql: 'UPDATE buchungen SET bankumsatz_id = $1 WHERE id = $2', params: [b.bankumsatz_id, b.id] }));
  const buchungen = buchungenMit
    ? `UPDATE rechnungen SET bezahlt_am = NULL WHERE id IN (SELECT rechnung_id FROM buchungen WHERE bankumsatz_id IN ${U} AND rechnung_id IS NOT NULL);
       DELETE FROM dokumente WHERE bezug = 'Buchung' AND bezug_id IN ${B};
       DELETE FROM buchungen WHERE bankumsatz_id IN ${U};`
    : `UPDATE buchungen SET bankumsatz_id = NULL WHERE bankumsatz_id IN ${U};`;
  const sql = `BEGIN;
    ${buchungen}
    DELETE FROM bankumsaetze WHERE bankkonto_id = ${id};
    DELETE FROM bankkonten WHERE id = ${id};
    COMMIT;`;
  try { await db.execute(sql); }
  catch (e) { await db.execute('ROLLBACK').catch(() => {}); throw e; }
  await ablegen('Bankkonto', name, inhalt).catch(() => {});
  if (isTauri()) await invoke('bank_pin_loeschen', { konto: id }).catch(() => {});
  return sicherung;
}
