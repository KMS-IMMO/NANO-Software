// Einen Zahlungseingang auf mehrere Eigentümer/Mieter aufteilen oder der ganzen Gemeinschaft zuführen.
// Beispiel: Die Miete für eine Funkanlage auf dem Dach (Vantage Towers) gehört allen Eigentümern. Sie wird dann ohne Einheit auf ein
// Ertragskonto gebucht und in der Hausgeldabrechnung nach dem Umlageschlüssel des Kontos (Standard MEA) auf alle Einheiten verteilt.
// Eine Überweisung, die mehrere Personen betrifft (z. B. Eheleute mit zwei Wohnungen), wird je Person auf deren offene Posten verteilt.
import { db, insert, type Row } from '../db';
import { personInObjekt, sperreNeu, zuordnenKonto, zuordnenPerson, zuordnungLoesen } from './bank';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Konto für Erträge der Gemeinschaft, das NEOSS bei Bedarf anlegt */
export const GEMEINSCHAFT_KONTO = { nummer: '1030', name: 'Erträge der Gemeinschaft (z. B. Miete Funkanlage)', gruppe: 'Einnahmen' };

/** Konten, auf die ein Ertrag der Gemeinschaft gebucht werden kann (Ertrag zuerst), dazu das Gemeinschaftskonto, falls es noch fehlt */
export async function ertragsKonten(): Promise<{ id: number | null; nummer: string; name: string }[]> {
  const k = await db.select(`SELECT id, nummer, name, art FROM buchungskonten WHERE art IN ('Ertrag', 'Einnahme')
    AND nummer NOT IN ('1000', '1001', '1002', '1003', '1010', '1011', '1601') ORDER BY art = 'Ertrag' DESC, nummer`);
  const liste: { id: number | null; nummer: string; name: string }[] = k.map((x) => ({ id: Number(x.id), nummer: String(x.nummer), name: String(x.name) }));
  if (!liste.some((x) => x.nummer === GEMEINSCHAFT_KONTO.nummer)) liste.unshift({ id: null, nummer: GEMEINSCHAFT_KONTO.nummer, name: `${GEMEINSCHAFT_KONTO.name} – wird angelegt` });
  return liste;
}

async function gemeinschaftsKontoId(): Promise<number> {
  const da = (await db.select('SELECT id FROM buchungskonten WHERE nummer = $1', [GEMEINSCHAFT_KONTO.nummer]))[0];
  if (da) return Number(da.id);
  return insert('buchungskonten', { nummer: GEMEINSCHAFT_KONTO.nummer, name: GEMEINSCHAFT_KONTO.name, gruppe: GEMEINSCHAFT_KONTO.gruppe, art: 'Ertrag', euer: 1, mwst: 0, umlagefaehig: 0, schluessel: 'MEA' });
}

async function umsatz(bankumsatzId: number): Promise<Row> {
  const u = (await db.select('SELECT * FROM bankumsaetze WHERE id = $1', [bankumsatzId]))[0];
  if (!u) throw new Error('Den Bankumsatz gibt es nicht mehr.');
  return u;
}
const objektVon = async (u: Row) => (await db.select('SELECT objekt_id FROM bankkonten WHERE id = $1', [u.bankkonto_id]))[0]?.objekt_id ?? null;

/** Ganze Zahlung der Gemeinschaft zuführen: bisherige Zuordnung lösen, ohne Einheit auf das Ertragskonto buchen.
 *  kontoId null = Gemeinschaftskonto 1030 (wird angelegt, falls es fehlt). */
export async function aufGemeinschaft(bankumsatzId: number, kontoId: number | null) {
  const u = await umsatz(bankumsatzId);
  const sp = await sperreNeu(u, [await objektVon(u)]);
  if (sp) throw new Error(sp);
  await zuordnungLoesen(u);
  await zuordnenKonto(u, kontoId ?? await gemeinschaftsKontoId());
}

export interface Teil { personId: number; betrag: number }

/** Zahlung auf mehrere Eigentümer/Mieter aufteilen: je Person wird ihr Teil wie eine eigene Überweisung auf ihre offenen Posten verteilt. */
export async function aufMehrere(bankumsatzId: number, teile: Teil[]) {
  const u = await umsatz(bankumsatzId);
  const t = teile.filter((x) => x.personId && Math.abs(x.betrag) > 0.004).map((x) => ({ ...x, betrag: r2(x.betrag) }));
  if (t.length < 1) throw new Error('Bitte mindestens eine Person mit Betrag wählen.');
  if (new Set(t.map((x) => x.personId)).size !== t.length) throw new Error('Jede Person nur einmal wählen.');
  const summe = r2(t.reduce((a, x) => a + x.betrag, 0));
  if (Math.abs(summe - r2(Number(u.betrag))) > 0.005)
    throw new Error(`Die Teile ergeben ${summe.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}, die Zahlung beträgt ${Number(u.betrag).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}.`);
  const objekt = await objektVon(u);
  // Vor jeder Änderung prüfen: Jahressperre und ob alle Personen zur Liegenschaft gehören
  const sp = await sperreNeu(u, [objekt]);
  if (sp) throw new Error(sp);
  if (objekt) for (const x of t) if (!(await personInObjekt(x.personId, objekt))) throw new Error('Eine gewählte Person ist in dieser Liegenschaft weder Eigentümer noch Mieter.');
  await zuordnungLoesen(u);
  // Die IBAN der Überweisung nicht bei jeder Person merken (sie gehört höchstens einer)
  for (const x of t) await zuordnenPerson({ ...u, betrag: x.betrag, gegen_iban: t.length > 1 ? null : u.gegen_iban }, x.personId);
}

/** Vorschlag für die Aufteilung: gleichmäßig, Rest-Cent auf den ersten Teil */
export function gleichmaessig(betrag: number, n: number): number[] {
  if (n < 1) return [];
  const teil = Math.floor((betrag / n) * 100) / 100;
  const out = Array.from({ length: n }, () => teil);
  out[0] = r2(betrag - teil * (n - 1));
  return out;
}
