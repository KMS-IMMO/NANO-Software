// Eingabeprüfungen beim Erfassen: IBAN, PLZ → Ort, Kaution (§ 551 BGB), doppelte Personen.
import { db, type Row } from '../db';

const IBAN_LAENGE: Record<string, number> = { DE: 22, AT: 20, CH: 21, NL: 18, BE: 16, LU: 20, FR: 27, IT: 27, ES: 24, PL: 28, TR: 26, DK: 18, LI: 21, GB: 22, IE: 22, PT: 25, GR: 27, HR: 21, CZ: 24, SK: 24, SI: 19, HU: 28, RO: 24, BG: 22, SE: 24, FI: 18, NO: 15 };

/** Prüft eine IBAN (Länge je Land und Prüfziffer). Leer ist erlaubt. Gibt einen Fehlertext oder null zurück. */
export function ibanFehler(eingabe: unknown): string | null {
  const s = String(eingabe ?? '').replace(/\s/g, '').toUpperCase();
  if (!s) return null;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return 'Die IBAN beginnt mit zwei Buchstaben (z. B. DE) und zwei Ziffern.';
  const soll = IBAN_LAENGE[s.slice(0, 2)];
  if (soll && s.length !== soll) return `Die IBAN hat ${s.length} statt ${soll} Zeichen. Bitte auf Tippfehler prüfen.`;
  if (s.length < 15 || s.length > 34) return 'Die IBAN hat nicht die richtige Länge.';
  const r = s.slice(4) + s.slice(0, 4);
  let rest = 0;
  for (const c of r) {
    const z = c >= 'A' ? String(c.charCodeAt(0) - 55) : c;
    for (const d of z) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1 ? null : 'Die Prüfziffer der IBAN stimmt nicht. Wahrscheinlich ist ein Zahlendreher drin.';
}

/** IBAN in Vierergruppen zur Anzeige */
export const ibanSchoen = (s: string) => s.replace(/\s/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();

/** Deutsche PLZ: genau fünf Ziffern. Leer ist erlaubt. */
export const plzFehler = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return !s || /^\d{5}$/.test(s) ? null : 'Die PLZ hat fünf Ziffern.';
};

/** Ort zu einer PLZ: zuerst aus den eigenen Daten (Objekte, Kontakte), sonst Köln nach PLZ-Bereich. */
export async function ortZurPlz(plz: unknown): Promise<string | null> {
  const p = String(plz ?? '').trim();
  if (!/^\d{5}$/.test(p)) return null;
  const r = await db.select(`SELECT ort, COUNT(*) AS n FROM (SELECT TRIM(ort) AS ort FROM objekte WHERE plz = $1 UNION ALL SELECT TRIM(ort) FROM personen WHERE plz = $1)
    WHERE ort IS NOT NULL AND ort <> '' GROUP BY ort ORDER BY n DESC LIMIT 1`, [p]);
  if (r[0]?.ort) return String(r[0].ort);
  const n = Number(p);
  if ((n >= 50667 && n <= 50999) || (n >= 51061 && n <= 51149)) return 'Köln';
  return null;
}

/** § 551 BGB: Kaution höchstens drei Monatsmieten ohne Nebenkosten (gilt für Wohnraum). */
export function kautionHinweis(kaution: unknown, kalt: unknown, gewerbe = false): string | null {
  const k = Number(kaution) || 0, m = Number(kalt) || 0;
  if (gewerbe || k <= 0 || m <= 0 || k <= 3 * m + 0.005) return null;
  return `Die Kaution ist höher als drei Kaltmieten (${(3 * m).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €). Bei Wohnraum ist der Teil darüber nach § 551 BGB unwirksam.`;
}

/** Gibt es schon eine Person mit gleichem Namen oder gleicher IBAN? Liefert einen Hinweistext oder null. */
export async function doppeltePerson(p: Row, ohneId?: number): Promise<string | null> {
  const n = String(p.nachname ?? '').trim(), v = String(p.vorname ?? '').trim(), f = String(p.firma ?? '').trim();
  const iban = String(p.iban ?? '').replace(/\s/g, '').toUpperCase();
  const treffer: Row[] = [];
  if (n) treffer.push(...await db.select(`SELECT id, vorname, nachname, firma, rolle, 'Name' AS grund FROM personen WHERE LOWER(TRIM(nachname)) = LOWER($1) AND LOWER(TRIM(COALESCE(vorname, ''))) = LOWER($2) AND id <> $3`, [n, v, ohneId ?? 0]));
  else if (f) treffer.push(...await db.select(`SELECT id, vorname, nachname, firma, rolle, 'Name' AS grund FROM personen WHERE LOWER(TRIM(firma)) = LOWER($1) AND id <> $2`, [f, ohneId ?? 0]));
  if (iban) treffer.push(...await db.select(`SELECT id, vorname, nachname, firma, rolle, 'IBAN' AS grund FROM personen WHERE REPLACE(UPPER(iban), ' ', '') = $1 AND id <> $2`, [iban, ohneId ?? 0]));
  if (!treffer.length) return null;
  const t = treffer[0];
  const name = [t.firma, [t.vorname, t.nachname].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return `Es gibt schon einen Kontakt ${t.grund === 'IBAN' ? 'mit dieser IBAN' : 'mit diesem Namen'}: ${name} (${t.rolle ?? 'ohne Rolle'}). Nochmal auf Speichern klicken, um trotzdem einen neuen Kontakt anzulegen.`;
}
