// Erhaltungsrücklage einer WEG: Bestand bei Übernahme + Zuführungen (Rücklagenanteil im Hausgeld-Soll; daneben der tatsächlich gezahlte Teil)
// − Entnahmen (Konto 1261) + Zinsen (Konto 1262). Bewegungen zählen erst nach dem Stichtag des Übernahmebestands.
import { db } from '../db';

export interface Bewegung { zufuehrung: number; zufuehrungIst: number; entnahme: number; zinsen: number }

/** Bewegungen im Zeitraum (von exklusiv, bis inklusiv, jeweils JJJJ-MM-TT) */
async function bewegungen(objektId: number, nach: string, bis: string): Promise<Bewegung> {
  const zuf = Number((await db.select(`SELECT COALESCE(SUM(h.davon_ruecklage), 0) AS x FROM sollstellungen s
      JOIN hausgeld h ON h.id = (SELECT h2.id FROM hausgeld h2 WHERE h2.einheit_id = s.einheit_id AND h2.gueltig_ab <= s.monat || '-01' ORDER BY h2.gueltig_ab DESC LIMIT 1)
      JOIN einheiten e ON e.id = s.einheit_id
      WHERE s.art = 'Hausgeld' AND e.objekt_id = $1 AND s.monat || '-01' > $2 AND s.monat || '-01' <= $3`, [objektId, nach, bis]))[0].x);
  const konto = async (nr: string) => Math.abs(Number((await db.select(`SELECT COALESCE(SUM(b.betrag), 0) AS x FROM buchungen b
      JOIN buchungskonten k ON k.id = b.buchungskonto_id WHERE k.nummer = $1 AND b.objekt_id = $2 AND b.datum > $3 AND b.datum <= $4`,
    [nr, objektId, nach, bis]))[0].x));
  // Tatsächlich gezahlt: Rücklagenanteil jedes Hausgeld-Postens im Verhältnis der bis zum Stichtag gezahlten Summe
  const zufIst = Number((await db.select(`SELECT COALESCE(SUM(h.davon_ruecklage * MIN(1.0, MAX(0.0,
        COALESCE((SELECT SUM(b.betrag) FROM buchungen b WHERE b.sollstellung_id = s.id AND b.datum <= $3), 0)) / s.betrag)), 0) AS x FROM sollstellungen s
      JOIN hausgeld h ON h.id = (SELECT h2.id FROM hausgeld h2 WHERE h2.einheit_id = s.einheit_id AND h2.gueltig_ab <= s.monat || '-01' ORDER BY h2.gueltig_ab DESC LIMIT 1)
      JOIN einheiten e ON e.id = s.einheit_id
      WHERE s.art = 'Hausgeld' AND s.betrag > 0 AND e.objekt_id = $1 AND s.monat || '-01' > $2 AND s.monat || '-01' <= $3`, [objektId, nach, bis]))[0].x);
  return { zufuehrung: zuf, zufuehrungIst: Math.round(zufIst * 100) / 100, entnahme: await konto('1261'), zinsen: await konto('1262') };
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
  // Ist-Bestand am 31.12.: alle seit der Übernahme tatsächlich gezahlten Zuführungen (auch Nachzahlungen für Vorjahre)
  const gesamt = ende < stichtag ? null : await bewegungen(objektId, stichtag, ende);
  const bestand = anfangsbestand + uebernahme + b.zufuehrung - b.entnahme + b.zinsen;
  const bestandIst = gesamt ? anfang + gesamt.zufuehrungIst - gesamt.entnahme + gesamt.zinsen : 0;
  return { anfangsbestand, uebernahme, ...b, bestand, bestandIst: Math.round(bestandIst * 100) / 100, offen: Math.round((bestand - bestandIst) * 100) / 100 };
}

/** Rücklagenzuführung je Monat (1–12) eines Kalenderjahres laut Hausgeld-Soll */
export async function ruecklageMonate(objektId: number, jahr: number): Promise<number[]> {
  const r = await db.select(`SELECT CAST(substr(s.monat, 6, 2) AS INTEGER) AS m, COALESCE(SUM(h.davon_ruecklage), 0) AS x FROM sollstellungen s
      JOIN hausgeld h ON h.id = (SELECT h2.id FROM hausgeld h2 WHERE h2.einheit_id = s.einheit_id AND h2.gueltig_ab <= s.monat || '-01' ORDER BY h2.gueltig_ab DESC LIMIT 1)
      JOIN einheiten e ON e.id = s.einheit_id
      WHERE s.art = 'Hausgeld' AND e.objekt_id = $1 AND substr(s.monat, 1, 4) = $2 GROUP BY m`, [objektId, String(jahr)]);
  return Array.from({ length: 12 }, (_, i) => Number(r.find((y) => Number(y.m) === i + 1)?.x) || 0);
}

/** Entwicklung der Rücklage in einem beliebigen Zeitraum (von, bis inklusiv, JJJJ-MM-TT) */
export async function ruecklageZeitraum(objektId: number, von: string, bis: string) {
  const { anfang, stichtag } = await basis(objektId);
  const d = new Date(von + 'T12:00:00'); d.setDate(d.getDate() - 1);
  const vorTag = d.toISOString().slice(0, 10);
  const anfangsbestand = await ruecklageStand(objektId, vorTag);
  const uebernahme = stichtag > vorTag && stichtag <= bis ? anfang : 0;
  const b = bis < stichtag ? { zufuehrung: 0, zufuehrungIst: 0, entnahme: 0, zinsen: 0 } : await bewegungen(objektId, stichtag > vorTag ? stichtag : vorTag, bis);
  return { vorTag, anfangsbestand, uebernahme, ...b, bestand: anfangsbestand + uebernahme + b.zufuehrung - b.entnahme + b.zinsen };
}
