// Erhaltungsrücklage einer WEG: Bestand bei Übernahme + Zuführungen (Rücklagenanteil im Hausgeld-Soll; daneben der tatsächlich gezahlte Teil)
// + Sonderzuführungen (Buchungen auf Konto 1260, z. B. Antennenmiete laut Beschluss) − Entnahmen (Konto 1261) + Zinsen (Konto 1262). Bewegungen zählen erst nach dem Stichtag des Übernahmebestands.
import { db } from '../db';

export interface Bewegung { zufuehrung: number; zufuehrungIst: number; sonder: number; entnahme: number; zinsen: number }

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
  return { zufuehrung: zuf, zufuehrungIst: Math.round(zufIst * 100) / 100, sonder: await konto('1260'), entnahme: await konto('1261'), zinsen: await konto('1262') };
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
  return anfang + b.zufuehrung + b.sonder - b.entnahme + b.zinsen;
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
  const bestand = anfangsbestand + uebernahme + b.zufuehrung + b.sonder - b.entnahme + b.zinsen;
  const bestandIst = gesamt ? anfang + gesamt.zufuehrungIst + gesamt.sonder - gesamt.entnahme + gesamt.zinsen : 0;
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
  const b = bis < stichtag ? { zufuehrung: 0, zufuehrungIst: 0, sonder: 0, entnahme: 0, zinsen: 0 } : await bewegungen(objektId, stichtag > vorTag ? stichtag : vorTag, bis);
  // Sonderzuführungen (Konto 1260) gehören wie im Vermögensbericht zum Bestand
  return { vorTag, anfangsbestand, uebernahme, ...b, bestand: anfangsbestand + uebernahme + b.zufuehrung + b.sonder - b.entnahme + b.zinsen };
}

/* ---------- Rücklagenkonto laut Kontoauszug (Anfangs- und Endbestand von Hand je Jahr) ----------
   Anfangsbestand 01.01. und Endbestand (zum Datum des letzten Auszugs, am Jahresende 31.12.) werden von Hand vom Kontoauszug des Rücklagenkontos
   übernommen. Verglichen wird mit dem Stand laut Buchungen: tatsächlich eingezahlte Zuführungen + Sonderzuführungen − Entnahmen + Zinsen.
   Ist ein Anfangsbestand eingegeben, beginnt der Stand laut Buchungen damit (wie der Stand 01.01. bei Einnahmen & Ausgaben); die Differenz
   am Ende zeigt dann nur, was im Jahr auf dem Auszug steht, aber nicht gebucht ist (oder umgekehrt). */

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface RuecklageAuszug { anfang: number | null; anfangAuszug: string; ende: number | null; endeDatum: string; endeAuszug: string }

export async function auszugLesen(objektId: number, jahr: number): Promise<RuecklageAuszug> {
  const r = (await db.select('SELECT * FROM ruecklage_auszug WHERE objekt_id = $1 AND jahr = $2', [objektId, jahr]))[0];
  return {
    anfang: r?.anfang == null ? null : r2(Number(r.anfang)), anfangAuszug: r?.anfang_auszug ?? '',
    ende: r?.ende == null ? null : r2(Number(r.ende)), endeDatum: r?.ende_datum ?? '', endeAuszug: r?.ende_auszug ?? '',
  };
}

export async function auszugSpeichern(objektId: number, jahr: number, a: RuecklageAuszug) {
  if (a.ende !== null && !a.endeDatum) throw new Error('Bitte das Datum des Endbestands angeben.');
  if (a.endeDatum && !a.endeDatum.startsWith(String(jahr))) throw new Error(`Das Datum des Endbestands muss im Jahr ${jahr} liegen.`);
  if ([a.anfang, a.ende].some((n) => n !== null && !Number.isFinite(n))) throw new Error('Ein Betrag ist keine Zahl.');
  if (a.anfang === null && a.ende === null) { await db.execute('DELETE FROM ruecklage_auszug WHERE objekt_id = $1 AND jahr = $2', [objektId, jahr]); return; }
  await db.execute(`INSERT INTO ruecklage_auszug (objekt_id, jahr, anfang, anfang_auszug, ende, ende_datum, ende_auszug, erfasst_am)
      VALUES ($1, $2, $3, $4, $5, $6, $7, datetime('now', 'localtime'))
    ON CONFLICT (objekt_id, jahr) DO UPDATE SET anfang = excluded.anfang, anfang_auszug = excluded.anfang_auszug, ende = excluded.ende,
      ende_datum = excluded.ende_datum, ende_auszug = excluded.ende_auszug, erfasst_am = excluded.erfasst_am`,
  [objektId, jahr, a.anfang === null ? null : r2(a.anfang), a.anfangAuszug || null, a.ende === null ? null : r2(a.ende), a.ende === null ? null : a.endeDatum, a.endeAuszug || null]);
}

/** Tatsächlicher Stand der Rücklage (gezahlte Zuführungen) am Stichtag bis, ohne Eingaben laut Kontoauszug */
export async function ruecklageIstStand(objektId: number, bis: string): Promise<number> {
  const { anfang, stichtag } = await basis(objektId);
  if (bis < stichtag) return 0;
  const b = await bewegungen(objektId, stichtag, bis);
  return r2(anfang + b.zufuehrungIst + b.sonder - b.entnahme + b.zinsen);
}

/** Bankkonto der Liegenschaft, das nach Rücklagenkonto heißt (für Vorschläge aus den Kontoumsätzen und offene Umsätze) */
export async function ruecklagenBankkonto(objektId: number) {
  const k = await db.select('SELECT * FROM bankkonten WHERE objekt_id = $1 ORDER BY id', [objektId]);
  return k.find((x) => /r(ü|ue)cklage|erhaltungsr/i.test(`${x.name ?? ''}`)) ?? null;
}

/** Abgleich eines Jahres: Buchungen gegen Kontoauszug */
export async function ruecklageAbgleich(objektId: number, jahr: number) {
  const a = await auszugLesen(objektId, jahr);
  const { anfang: ueb, stichtag } = await basis(objektId);
  const start = `${jahr - 1}-12-31`;
  const bis = a.ende !== null && a.endeDatum ? a.endeDatum : `${jahr}-12-31`;
  const anfangBuchungen = await ruecklageIstStand(objektId, start);   // Endstand Vorjahr laut Buchungen
  const uebernahme = a.anfang === null && stichtag > start && stichtag <= bis ? ueb : 0;
  const ab = a.anfang === null && stichtag > start ? stichtag : start;
  const b = bis < stichtag ? { zufuehrung: 0, zufuehrungIst: 0, sonder: 0, entnahme: 0, zinsen: 0 } : await bewegungen(objektId, ab, bis);
  const startWert = a.anfang ?? anfangBuchungen;
  const endeBuchungen = r2(startWert + uebernahme + b.zufuehrungIst + b.sonder - b.entnahme + b.zinsen);
  const bank = await ruecklagenBankkonto(objektId);
  let offen = 0, offenSumme = 0;
  if (bank) {
    const r = (await db.select(`SELECT COUNT(*) AS n, COALESCE(SUM(betrag), 0) AS s FROM bankumsaetze WHERE bankkonto_id = $1 AND status = 'offen' AND datum >= $2 AND datum <= $3`,
      [bank.id, `${jahr}-01-01`, bis]))[0];
    offen = Number(r?.n) || 0; offenSumme = r2(Number(r?.s) || 0);
  }
  return {
    auszug: a, bis, anfangBuchungen, startWert, uebernahme, ...b, endeBuchungen,
    anfangDiff: a.anfang === null ? null : r2(a.anfang - anfangBuchungen),
    endeDiff: a.ende === null ? null : r2(a.ende - endeBuchungen),
    bank, offen, offenSumme,
  };
}

/** Übersicht je Jahr: Anfang und Ende laut Kontoauszug, Differenz zu den Buchungen */
export async function ruecklageJahre(objektId: number, bisJahr: number, anzahl = 5) {
  const r = [];
  for (let y = bisJahr - anzahl + 1; y <= bisJahr; y++) {
    const g = await ruecklageAbgleich(objektId, y);
    r.push({ jahr: y, anfang: g.auszug.anfang, ende: g.auszug.ende, endeDatum: g.auszug.endeDatum, endeDiff: g.endeDiff, buchungen: g.endeBuchungen });
  }
  return r;
}

/** Differenz am Endbestand nachbuchen: fehlt Geld auf den Buchungen → Entnahme/Kosten (1261), ist mehr auf dem Konto → Zinsen/Zugang (1262) */
export async function differenzBuchen(objektId: number, jahr: number, text?: string) {
  const g = await ruecklageAbgleich(objektId, jahr);
  if (g.endeDiff === null || Math.abs(g.endeDiff) < 0.005) throw new Error('Es gibt keine Differenz zum Nachbuchen.');
  const { gesperrt, sperrText } = await import('./abschluss');
  const sp = await gesperrt(objektId, g.bis);
  if (sp) throw new Error(sperrText(sp));
  const nr = g.endeDiff < 0 ? '1261' : '1262';
  const k = (await db.select('SELECT id FROM buchungskonten WHERE nummer = $1', [nr]))[0];
  if (!k) throw new Error(`Das Buchungskonto ${nr} fehlt im Kontenplan.`);
  const { insert } = await import('../db');
  await insert('buchungen', { datum: g.bis, betrag: g.endeDiff, buchungskonto_id: k.id, objekt_id: objektId, zahlweg: 'bar',
    text: text || `Ausgleich Rücklagenkonto laut Kontoauszug${g.auszug.endeAuszug ? ' Nr. ' + g.auszug.endeAuszug : ''}` });
  return { konto: nr, betrag: g.endeDiff };
}
