// Wiederkehrende Ausgaben (Versicherung, Hausmeister, Wartungsverträge …):
// Ist das Datum erreicht, legt NANO die Rechnung automatisch als offene Rechnung an.
import { db, insert } from '../db';
import { gesperrt } from './abschluss';

export const INTERVALLE = [
  { value: 1, label: 'monatlich' }, { value: 3, label: 'vierteljährlich' },
  { value: 6, label: 'halbjährlich' }, { value: 12, label: 'jährlich' },
];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function plusMonate(datum: string, n: number): string {
  const [j, m, t] = datum.split('-').map(Number);
  const ziel = new Date(j, m - 1 + n, 1);
  const letzter = new Date(ziel.getFullYear(), ziel.getMonth() + 1, 0).getDate();
  return iso(new Date(ziel.getFullYear(), ziel.getMonth(), Math.min(t, letzter)));
}
export const plusTage = (datum: string, n: number) => { const d = new Date(datum + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };

let laeuft = false;
/** Legt alle fälligen Rechnungen an. Gibt die Anzahl zurück. */
export async function wiederkehrendErzeugen(bis = iso(new Date())): Promise<number> {
  if (laeuft) return 0;
  laeuft = true;
  let n = 0;
  try {
    const liste = await db.select(`SELECT * FROM wiederkehrend WHERE pausiert = 0 AND naechste <= $1`, [bis]);
    for (const w of liste) {
      // Termine bestimmen, dann den Eintrag „beanspruchen“: nur wer naechste noch im alten Stand vorfindet, legt an.
      // So entstehen keine doppelten Rechnungen, wenn mehrere Arbeitsplätze gleichzeitig starten.
      const termine: string[] = [];
      let d = String(w.naechste);
      for (let schutz = 0; d <= bis && (!w.ende || d <= w.ende) && schutz < 60; schutz++) { termine.push(d); d = plusMonate(d, Number(w.intervall) || 1); }
      const r = await db.execute('UPDATE wiederkehrend SET naechste = $1, pausiert = $2 WHERE id = $3 AND naechste = $4',
        [d, w.ende && d > w.ende ? 1 : 0, w.id, w.naechste]);
      if (!r.rowsAffected) continue;
      for (const t of termine) {
        if (await gesperrt(w.objekt_id, t)) continue;
        await insert('rechnungen', { objekt_id: w.objekt_id, einheit_id: w.einheit_id ?? null, firma_id: w.firma_id ?? null, rechnungsnr: null,
          datum: t, betrag: w.betrag, buchungskonto_id: w.buchungskonto_id, faellig: plusTage(t, w.zahlungsziel == null ? 14 : Number(w.zahlungsziel)),
          notiz: w.text ? `${w.text} (wiederkehrend)` : 'wiederkehrend', wiederkehrend_id: w.id });
        n++;
      }
    }
  } finally { laeuft = false; }
  return n;
}
