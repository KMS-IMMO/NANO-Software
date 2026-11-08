// Abschluss einer Hausgeld- (WEG) oder Nebenkostenabrechnung je Liegenschaft und Jahr.
// Vor dem Abschluss prüft das Programm, ob das Jahr vorbei ist und alles gebucht wurde.
// Nach dem Abschluss sind Buchungen und Rechnungen des Jahres für diese Liegenschaft gesperrt, bis der Abschluss aufgehoben wird.
import { db, type Row } from '../db';
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

export async function abschlussAufheben(objekt: number, jahr: number, art: AbschlussArt) {
  await db.execute(`UPDATE abrechnungen SET status = 'Aufgehoben' WHERE objekt_id = $1 AND jahr = $2 AND art = $3 AND status = 'Abgeschlossen'`, [objekt, jahr, art]);
}

/** Ist das Jahr dieses Datums für die Liegenschaft abgeschlossen? Gibt den Namen der Abrechnung zurück, sonst null. */
export async function gesperrt(objekt: number | null | undefined, datum: string | null | undefined): Promise<string | null> {
  if (!objekt || !datum) return null;
  const r = (await db.select(`SELECT art FROM abrechnungen WHERE objekt_id = $1 AND jahr = $2 AND status = 'Abgeschlossen' LIMIT 1`,
    [Number(objekt), Number(String(datum).slice(0, 4))]))[0];
  return r ? `${ABSCHLUSS_TEXT[r.art as AbschlussArt] ?? r.art} ${String(datum).slice(0, 4)}` : null;
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
  out.push({ ok: !rech, sperrt: false, text: 'Alle Rechnungen des Jahres sind bezahlt gebucht', hinweis: rech ? `${rech} Rechnungen sind noch offen. Sie zählen trotzdem als Kosten.` : undefined });
  const ohneKonto = Number((await db.select(`SELECT COUNT(*) AS n FROM buchungen WHERE objekt_id = $1 AND buchungskonto_id IS NULL AND ${BJ('')} = CAST(substr($2, 1, 4) AS INTEGER)`, [objekt, von, bis]))[0]?.n ?? 0);
  out.push({ ok: !ohneKonto, sperrt: true, text: 'Jede Buchung hat ein Buchungskonto', hinweis: ohneKonto ? `${ohneKonto} Buchungen ohne Konto unter „Einnahmen & Ausgaben“.` : undefined });
  if (art === 'WEG') {
    const hg = Number((await db.select(`SELECT COUNT(*) AS n FROM sollstellungen s JOIN einheiten e ON e.id = s.einheit_id
      WHERE e.objekt_id = $1 AND s.art IN ('Hausgeld', 'Rücklage') AND substr(s.monat, 1, 4) = $2`, [objekt, String(jahr)]))[0]?.n ?? 0);
    out.push({ ok: hg > 0, sperrt: true, text: `Hausgeld-Sollstellungen ${jahr} sind angelegt`, hinweis: hg ? undefined : 'Unter „Sollstellungen“ aus den Stammdaten erzeugen.' });
  }
  return [...out, ...extra];
}
