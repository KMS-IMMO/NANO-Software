// Erhaltungsrücklage einer WEG: Bestand bei Übernahme + Zuführungen (Rücklagenanteil im Hausgeld-Soll)
// − Entnahmen (Konto 1261) + Zinsen (Konto 1262). Bewegungen zählen erst nach dem Stichtag des Übernahmebestands.
import { db } from '../db';

export interface Bewegung { zufuehrung: number; entnahme: number; zinsen: number }

/** Bewegungen im Zeitraum (von exklusiv, bis inklusiv, jeweils JJJJ-MM-TT) */
async function bewegungen(objektId: number, nach: string, bis: string): Promise<Bewegung> {
  const zuf = Number((await db.select(`SELECT COALESCE(SUM(h.davon_ruecklage), 0) AS x FROM sollstellungen s
      JOIN hausgeld h ON h.id = (SELECT h2.id FROM hausgeld h2 WHERE h2.einheit_id = s.einheit_id AND h2.gueltig_ab <= s.monat || '-01' ORDER BY h2.gueltig_ab DESC LIMIT 1)
      JOIN einheiten e ON e.id = s.einheit_id
      WHERE s.art = 'Hausgeld' AND e.objekt_id = $1 AND s.monat || '-01' > $2 AND s.monat || '-01' <= $3`, [objektId, nach, bis]))[0].x);
  const konto = async (nr: string) => Math.abs(Number((await db.select(`SELECT COALESCE(SUM(b.betrag), 0) AS x FROM buchungen b
      JOIN buchungskonten k ON k.id = b.buchungskonto_id WHERE k.nummer = $1 AND b.objekt_id = $2 AND b.datum > $3 AND b.datum <= $4`,
    [nr, objektId, nach, bis]))[0].x));
  return { zufuehrung: zuf, entnahme: await konto('1261'), zinsen: await konto('1262') };
}

async function basis(objektId: number) {
  const o = (await db.select('SELECT ruecklage_anfang, ruecklage_stichtag FROM objekte WHERE id = $1', [objektId]))[0] ?? {};
  return { anfang: Number(o.ruecklage_anfang) || 0, stichtag: (o.ruecklage_stichtag || '0000-00-00') as string };
}

/** Bestand der Rücklage am Stichtag bis */
export async function ruecklageStand(objektId: number, bis: string): Promise<number> {
  const { anfang, stichtag } = await basis(objektId);
  if (bis < stichtag) return 0;
  const b = await bewegungen(objektId, stichtag, bis);
  return anfang + b.zufuehrung - b.entnahme + b.zinsen;
}

/** Entwicklung der Rücklage in einem Kalenderjahr */
export async function ruecklageJahr(objektId: number, jahr: number) {
  const { anfang, stichtag } = await basis(objektId);
  const start = `${jahr - 1}-12-31`, ende = `${jahr}-12-31`;
  const anfangsbestand = await ruecklageStand(objektId, start);
  const uebernahme = stichtag > start && stichtag <= ende ? anfang : 0;
  const b = await bewegungen(objektId, stichtag > start ? stichtag : start, ende);
  return { anfangsbestand, uebernahme, ...b, bestand: anfangsbestand + uebernahme + b.zufuehrung - b.entnahme + b.zinsen };
}
