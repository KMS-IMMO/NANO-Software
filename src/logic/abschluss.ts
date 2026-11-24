// Abschluss einer Hausgeld- (WEG) oder Nebenkostenabrechnung je Liegenschaft und Jahr.
// Vor dem Abschluss prüft das Programm, ob das Jahr vorbei ist und alles gebucht wurde.
// Nach dem Abschluss sind Buchungen und Rechnungen des Jahres für diese Liegenschaft gesperrt, bis der Abschluss aufgehoben wird.
import { abgleichPruefungen, kontoabgleich } from './kontoabgleich';
import { db, sicherheit, type Row } from '../db';
import { BJ } from './buchung';

export type AbschlussArt = 'WEG' | 'Nebenkosten';
export const ABSCHLUSS_TEXT: Record<AbschlussArt, string> = { WEG: 'Hausgeldabrechnung', Nebenkosten: 'Nebenkostenabrechnung' };

export interface Pruefung { ok: boolean; text: string; sperrt: boolean; hinweis?: string }

export async function abschlussLaden(objekt: number, jahr: number, art: AbschlussArt): Promise<Row | null> {
  return (await db.select(`SELECT * FROM abrechnungen WHERE objekt_id = $1 AND jahr = $2 AND art = $3 AND status = 'Abgeschlossen' ORDER BY id DESC LIMIT 1`,
    [objekt, jahr, art]))[0] ?? null;
}

export async function abschliessen(objekt: number, jahr: number, art: AbschlussArt, ergebnis: Record<string, unknown>) {
  await db.execute(`INSERT INTO abrechnungen (objekt_id, art, jahr, status, abgeschlossen_am, ergebnis) VALUES ($1, $2, $3, 'Abgeschlossen', $4, $5)`,
    [objekt, art, jahr, new Date().toISOString().slice(0, 10), JSON.stringify(ergebnis)]);
}

/** Abschluss aufheben: nur mit Begründung, sie steht mit Datum am Abschluss und im Änderungsprotokoll */
export async function abschlussAufheben(objekt: number, jahr: number, art: AbschlussArt, grund: string) {
  const g = String(grund ?? '').trim();
  if (g.length < 5) throw new Error('Bitte kurz begründen, warum der Abschluss aufgehoben wird.');
  await db.execute(`UPDATE abrechnungen SET status = 'Aufgehoben', aufhebung_grund = $4, aufgehoben_am = $5 WHERE objekt_id = $1 AND jahr = $2 AND art = $3 AND status = 'Abgeschlossen'`,
    [objekt, jahr, art, g, new Date().toISOString().slice(0, 10)]);
}

/** Offene Posten, die „Ergebnis buchen“ aus dem Abschluss erzeugt (WEG: Abrechnungsspitzen, Miete: NK-Nachzahlung/-Guthaben) */
const OP: Record<AbschlussArt, { art: string; monat: (j: number) => string }> = {
  WEG: { art: 'WEG-Abrechnung', monat: (j) => `${j}-JA` },
  Nebenkosten: { art: 'NK-Abrechnung', monat: (j) => `${j}-NK` },
};
const opWhere = (objekt: number, jahr: number, art: AbschlussArt) =>
  `s.art = '${OP[art].art}' AND s.monat = '${OP[art].monat(jahr)}' AND s.einheit_id IN (SELECT id FROM einheiten WHERE objekt_id = ${Math.trunc(objekt)})`;

export interface AbschlussEintrag { id: number; jahr: number; abgeschlossen_am: string; ergebnis: Record<string, number>; posten: number; bezahlt: number; juengster: boolean }

/** Alle bestehenden Abschlüsse einer Liegenschaft, jüngstes Jahr zuerst. Nur der jüngste lässt sich löschen (Vorträge hängen am Vorjahr). */
export async function abschluesseListe(objekt: number, art: AbschlussArt): Promise<AbschlussEintrag[]> {
  const rows = await db.select(`SELECT id, jahr, abgeschlossen_am, ergebnis FROM abrechnungen WHERE objekt_id = $1 AND art = $2 AND status = 'Abgeschlossen' ORDER BY jahr DESC, id DESC`, [objekt, art]);
  const out: AbschlussEintrag[] = [];
  const gesehen = new Set<number>();
  for (const r of rows) {
    const jahr = Number(r.jahr);
    if (gesehen.has(jahr)) continue;   // doppelte Zeilen desselben Jahres nur einmal zeigen
    gesehen.add(jahr);
    let e: Record<string, number> = {}; try { e = r.ergebnis ? JSON.parse(r.ergebnis) : {}; } catch { /* altes Format */ }
    const op = (await db.select(`SELECT COUNT(*) AS n, COALESCE(SUM(EXISTS (SELECT 1 FROM buchungen b WHERE b.sollstellung_id = s.id)), 0) AS bez
      FROM sollstellungen s WHERE ${opWhere(objekt, jahr, art)}`))[0] ?? {};
    out.push({ id: Number(r.id), jahr, abgeschlossen_am: String(r.abgeschlossen_am ?? ''), ergebnis: e, posten: Number(op.n ?? 0), bezahlt: Number(op.bez ?? 0), juengster: !out.length });
  }
  return out;
}

/**
 * Abschluss löschen, damit das Jahr wieder offen ist und neu gebucht werden kann.
 * - geht nur für den jüngsten Abschluss der Liegenschaft
 * - vorher automatische Datensicherung (in der Desktop-App)
 * - noch nicht bezahlte offene Posten aus „Ergebnis buchen“ werden entfernt, bezahlte bleiben stehen
 * - der Abschluss bleibt als „Gelöscht“ mit Datum und Grund im Änderungsprotokoll nachvollziehbar
 */
export async function abschlussLoeschen(objekt: number, jahr: number, art: AbschlussArt, grund = ''): Promise<{ sicherung: string | null; posten: number; bezahlt: number }> {
  const o = Math.trunc(Number(objekt)), j = Math.trunc(Number(jahr));
  const spaeter = (await db.select(`SELECT MAX(jahr) AS j FROM abrechnungen WHERE objekt_id = $1 AND art = $2 AND status = 'Abgeschlossen' AND jahr > $3`, [o, art, j]))[0]?.j;
  if (spaeter) throw new Error(`Erst den Abschluss ${spaeter} löschen. Es lässt sich immer nur der jüngste Abschluss löschen, weil das Folgejahr auf diesem Jahr aufbaut.`);
  if (!(await abschlussLaden(o, j, art))) throw new Error(`Für ${j} gibt es keinen Abschluss.`);
  const sicherung = sicherheit.aktiv ? await sicherheit.sicherungErstellen() : null;
  const w = opWhere(o, j, art);
  const n = (await db.select(`SELECT COUNT(*) AS n, COALESCE(SUM(EXISTS (SELECT 1 FROM buchungen b WHERE b.sollstellung_id = s.id)), 0) AS bez FROM sollstellungen s WHERE ${w}`))[0] ?? {};
  const g = String(grund ?? '').trim() || 'Abschluss gelöscht, Jahr wird neu gebucht';
  const heute = new Date().toISOString().slice(0, 10);
  const esc = (t: string) => t.replace(/'/g, "''");
  const sql = `BEGIN;
    DELETE FROM sollstellungen WHERE id IN (SELECT s.id FROM sollstellungen s WHERE ${w} AND NOT EXISTS (SELECT 1 FROM buchungen b WHERE b.sollstellung_id = s.id));
    ${art === 'Nebenkosten' ? `DELETE FROM abrechnungen WHERE objekt_id = ${o} AND art = 'Nebenkosten' AND jahr = ${j} AND status = 'Gebucht';` : ''}
    UPDATE abrechnungen SET status = 'Gelöscht', aufhebung_grund = '${esc(g)}', aufgehoben_am = '${heute}' WHERE objekt_id = ${o} AND jahr = ${j} AND art = '${art}' AND status = 'Abgeschlossen';
    COMMIT;`;
  try { await db.execute(sql); }
  catch (e) { await db.execute('ROLLBACK').catch(() => {}); throw e; }
  return { sicherung, posten: Number(n.n ?? 0) - Number(n.bez ?? 0), bezahlt: Number(n.bez ?? 0) };
}

/** Ist das Jahr dieses Datums für die Liegenschaft abgeschlossen? Gibt den Namen der Abrechnung zurück, sonst null. */
export async function gesperrt(objekt: number | null | undefined, datum: string | null | undefined): Promise<string | null> {
  if (!objekt || !datum) return null;
  const r = (await db.select(`SELECT art FROM abrechnungen WHERE objekt_id = $1 AND jahr = $2 AND status = 'Abgeschlossen' LIMIT 1`,
    [Number(objekt), Number(String(datum).slice(0, 4))]))[0];
  return r ? `${ABSCHLUSS_TEXT[r.art as AbschlussArt] ?? r.art} ${String(datum).slice(0, 4)}` : null;
}

/** Wie gesperrt(), prüft aber zusätzlich das Buchungsjahr (z. B. Grundsteuer Q4 2025, gebucht am 05.01.2026 für 2025). */
export async function buchungGesperrt(objekt: number | null | undefined, datum: string | null | undefined, jahr?: number | string | null): Promise<string | null> {
  const j = Number(jahr);
  return (await gesperrt(objekt, datum)) ?? (j && String(j) !== String(datum ?? '').slice(0, 4) ? await gesperrt(objekt, `${j}-01-01`) : null);
}

export const sperrText = (name: string) => `Die ${name} ist abgeschlossen. Buchungen dieses Jahres kannst du erst wieder ändern, wenn du den Abschluss in der Abrechnung aufhebst.`;

/** Prüfungen vor dem Abschluss. `sperrt` = muss erfüllt sein, sonst nur Hinweis. */
export async function pruefen(objekt: number, jahr: number, art: AbschlussArt, extra: Pruefung[] = []): Promise<Pruefung[]> {
  const von = `${jahr}-01-01`, bis = `${jahr}-12-31`, heute = new Date().toISOString().slice(0, 10);
  const out: Pruefung[] = [];
  out.push({ ok: heute > bis, sperrt: true, text: `Das Jahr ${jahr} ist abgelaufen`, hinweis: heute > bis ? undefined : `Abschließen geht ab dem 01.01.${jahr + 1}.` });
  const bank = Number((await db.select(`SELECT COUNT(*) AS n FROM bankumsaetze u JOIN bankkonten k ON k.id = u.bankkonto_id
    WHERE k.objekt_id = $1 AND u.status = 'offen' AND u.datum BETWEEN $2 AND $3`, [objekt, von, bis]))[0]?.n ?? 0);
  out.push({ ok: !bank, sperrt: true, text: 'Alle Bankumsätze des Jahres sind zugeordnet', hinweis: bank ? `${bank} Umsätze unter „Bank & Zuordnung“ sind noch offen.` : undefined });
  const rech = Number((await db.select(`SELECT COUNT(*) AS n FROM rechnungen r WHERE r.objekt_id = $1 AND r.bezahlt_am IS NULL AND r.datum BETWEEN $2 AND $3
    AND NOT EXISTS (SELECT 1 FROM buchungen b WHERE b.rechnung_id = r.id)`, [objekt, von, bis]))[0]?.n ?? 0);
  out.push({ ok: !rech, sperrt: false, text: 'Alle Rechnungen des Jahres sind bezahlt gebucht', hinweis: rech ? (art === 'WEG'
      ? `${rech} Rechnungen sind noch offen. Sie zählen erst im Jahr der Zahlung als Kosten und stehen bis dahin im Vermögensbericht.`
      : `${rech} Rechnungen sind noch offen. Sie zählen trotzdem als Kosten.`) : undefined });
  const ohneKonto = Number((await db.select(`SELECT COUNT(*) AS n FROM buchungen WHERE objekt_id = $1 AND buchungskonto_id IS NULL AND ${BJ('')} = CAST(substr($2, 1, 4) AS INTEGER)`, [objekt, von]))[0]?.n ?? 0);
  out.push({ ok: !ohneKonto, sperrt: true, text: 'Jede Buchung hat ein Buchungskonto', hinweis: ohneKonto ? `${ohneKonto} Buchungen ohne Konto unter „Einnahmen & Ausgaben“.` : undefined });
  // Kontoabgleich: Buchungen gegen Kontoumsätze, Endbestand gegen echten Kontoauszug, Monate ohne Umsätze
  out.push(...abgleichPruefungen(await kontoabgleich(objekt, jahr), jahr));
  if (art === 'WEG') {
    const hg = Number((await db.select(`SELECT COUNT(*) AS n FROM sollstellungen s JOIN einheiten e ON e.id = s.einheit_id
      WHERE e.objekt_id = $1 AND s.art IN ('Hausgeld', 'Rücklage') AND substr(s.monat, 1, 4) = $2`, [objekt, String(jahr)]))[0]?.n ?? 0);
    out.push({ ok: hg > 0, sperrt: true, text: `Hausgeld-Sollstellungen ${jahr} sind angelegt`, hinweis: hg ? undefined : 'Unter „Sollstellungen“ aus den Stammdaten erzeugen.' });
  }
  return [...out, ...extra];
}
