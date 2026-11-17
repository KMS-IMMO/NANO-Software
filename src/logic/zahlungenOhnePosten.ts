// Zahlungseingänge einer Liegenschaft, die keinem offenen Posten zugeordnet sind (Überzahlung, Hausgeld/Miete ohne Posten,
// Zahlung ohne Einheit). Typischer Fall: beim Zuordnen wurde eine falsche Person gewählt (z. B. gleicher Nachname in einer
// anderen Liegenschaft). Dann bleibt der Posten des echten Zahlers offen, obwohl das Geld da ist. Hier lässt sich die Zahlung
// mit einem Klick dem richtigen Eigentümer bzw. Mieter zuordnen; sie wird dann wie jede Bankzahlung auf seine offenen Posten verteilt.
import { db } from '../db';
import { personInObjekt, zuordnenPerson, zuordnungLoesen } from './bank';

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Einnahmekonten für Miete und Hausgeld (siehe KONTO_FUER_ART) */
const EIN_KONTEN = `('1000', '1001', '1002', '1003', '1010')`;

export interface ZahlungOhnePosten {
  buchungId: number; bankumsatzId: number; datum: string; betrag: number; umsatzBetrag: number; teile: number;
  gegenpartei: string; zweck: string; konto: string; einheit: string | null;
  /** Wem die Zahlung wahrscheinlich gehört (Eigentümer der Einheit am Zahltag, IBAN oder Name) */
  vorschlag: number | null; vorschlagName: string;
  /** Warum die Zeile auffällt */
  grund: string;
  /** Offene Posten der vorgeschlagenen Person in der Liegenschaft (bis Jahresende fällig) */
  offen: number;
}

export async function zahlungenOhnePosten(objekt: number, jahr: number): Promise<ZahlungOhnePosten[]> {
  const o = (await db.select('SELECT verwaltungsart FROM objekte WHERE id = $1', [objekt]))[0];
  if (!o) return [];
  const weg = o.verwaltungsart === 'WEG';
  const ende = `${jahr}-12-31`;
  const rows = await db.select(`SELECT b.id, b.datum, b.betrag, b.einheit_id, b.bankumsatz_id, b.text, k.nummer, k.name AS konto, e.nummer AS einheit,
      u.gegenpartei, u.gegen_iban, u.verwendungszweck, u.betrag AS ubetrag, (SELECT COUNT(*) FROM buchungen x WHERE x.bankumsatz_id = b.bankumsatz_id) AS teile
    FROM buchungen b JOIN bankumsaetze u ON u.id = b.bankumsatz_id LEFT JOIN buchungskonten k ON k.id = b.buchungskonto_id LEFT JOIN einheiten e ON e.id = b.einheit_id
    WHERE b.objekt_id = $1 AND b.betrag > 0 AND b.sollstellung_id IS NULL AND b.rechnung_id IS NULL AND substr(b.datum, 1, 4) = $2
      AND (b.text LIKE 'Überzahlung%' OR k.nummer IN ${EIN_KONTEN}) ORDER BY b.datum, b.id`, [objekt, String(jahr)]);
  if (!rows.length) return [];
  const personen = await db.select(`SELECT p.id, p.iban, p.nachname, p.firma, TRIM(COALESCE(p.firma, '') || CASE WHEN p.firma IS NOT NULL AND p.nachname IS NOT NULL THEN ', ' ELSE '' END ||
      COALESCE(p.nachname, '') || CASE WHEN p.vorname IS NOT NULL THEN ', ' || p.vorname ELSE '' END) AS name FROM personen p`);
  const offenJe = new Map<number, number>();
  for (const x of await db.select(`SELECT s.person_id, SUM(s.betrag - COALESCE((SELECT SUM(b.betrag) FROM buchungen b WHERE b.sollstellung_id = s.id), 0)) AS offen
      FROM sollstellungen s JOIN einheiten e ON e.id = s.einheit_id WHERE e.objekt_id = $1 AND s.faellig <= $2 GROUP BY s.person_id`, [objekt, ende]))
    offenJe.set(Number(x.person_id), r2(Number(x.offen)));
  const out: ZahlungOhnePosten[] = [];
  for (const b of rows) {
    // Vorschlag: Eigentümer (WEG) bzw. Mieter der gebuchten Einheit am Zahltag, sonst IBAN, sonst Nachname im Auftraggeber
    let pid: number | null = null;
    if (b.einheit_id) {
      const r = weg
        ? (await db.select(`SELECT person_id FROM eigentum WHERE einheit_id = $1 AND (von IS NULL OR von <= $2) AND (bis IS NULL OR bis >= $2) ORDER BY anteil DESC LIMIT 1`, [b.einheit_id, b.datum]))[0]
        : (await db.select(`SELECT mieter_id AS person_id FROM mietvertraege WHERE einheit_id = $1 AND beginn <= $2 AND (ende IS NULL OR ende >= $2) ORDER BY beginn DESC LIMIT 1`, [b.einheit_id, b.datum]))[0];
      pid = r?.person_id ?? null;
    }
    const iban = String(b.gegen_iban ?? '').replace(/\s/g, '').toUpperCase();
    const imObjekt = async (id: number) => personInObjekt(id, objekt);
    if (!pid && iban) for (const p of personen.filter((p) => p.iban && String(p.iban).replace(/\s/g, '').toUpperCase() === iban)) if (await imObjekt(p.id)) { pid = p.id; break; }
    if (!pid) {
      const t = String(b.gegenpartei ?? '').toLowerCase();
      for (const p of personen.filter((p) => (p.nachname && t.includes(String(p.nachname).toLowerCase())) || (p.firma && t.includes(String(p.firma).toLowerCase()))))
        if (await imObjekt(p.id)) { pid = p.id; break; }
    }
    const offen = pid ? offenJe.get(pid) ?? 0 : 0;
    const gruende: string[] = [];
    if (!b.einheit_id) gruende.push('ohne Einheit gebucht');
    if (weg && ['1000', '1001', '1002', '1003'].includes(b.nummer)) gruende.push(`in der WEG auf ${b.nummer} ${b.konto} gebucht`);
    if (offen > 0.005) gruende.push(`beim Zahler sind noch Posten über ${offen.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })} offen`);
    // Echte Vorauszahlung ohne offene Posten, richtig gebucht: nichts zu tun
    if (!gruende.length) continue;
    out.push({ buchungId: b.id, bankumsatzId: b.bankumsatz_id, datum: b.datum, betrag: r2(Number(b.betrag)), umsatzBetrag: r2(Number(b.ubetrag)), teile: Number(b.teile),
      gegenpartei: b.gegenpartei ?? '', zweck: b.verwendungszweck ?? '', konto: [b.nummer, b.konto].filter(Boolean).join(' '), einheit: b.einheit ?? null,
      vorschlag: pid, vorschlagName: personen.find((p) => p.id === pid)?.name ?? '', grund: gruende.join(', '), offen });
  }
  return out;
}

/** Bankzahlung neu zuordnen: bisherige Buchungen des Umsatzes lösen und die Zahlung auf die offenen Posten der Person verteilen.
 *  Ist das Jahr abgeschlossen, bricht es vor jeder Änderung mit dem Sperrhinweis ab. */
export async function zahlungNeuZuordnen(bankumsatzId: number, personId: number) {
  const u = (await db.select('SELECT * FROM bankumsaetze WHERE id = $1', [bankumsatzId]))[0];
  if (!u) throw new Error('Den Bankumsatz gibt es nicht mehr.');
  const objekt = (await db.select('SELECT objekt_id FROM bankkonten WHERE id = $1', [u.bankkonto_id]))[0]?.objekt_id;
  if (objekt && !(await personInObjekt(personId, objekt))) throw new Error('Diese Person ist in der Liegenschaft weder Eigentümer noch Mieter.');
  await zuordnungLoesen(u);
  await zuordnenPerson(u, personId);
}
