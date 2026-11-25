// Nebenkostenabrechnung je Objekt und Jahr: wird von der Nebenkostenseite und von der
// WEG-Jahresabrechnung (vermietete Einheiten) gemeinsam genutzt.
import { db, type Row } from '../db';
import { eigeneSchluessel, kostenErmitteln, nutzerErmitteln, verteilen, vorauszahlungen, type Ergebnis, type Position } from './verteilung';
import { mieteImMonat, monate } from './soll';

export const HEIZ_KONTO = '1200';

/** Hinweis, wenn Heizkosten nicht verbrauchsabhängig verteilt würden (Heizkostenverordnung) */
export const HEIZ_HINWEIS = `Heizkosten (Konto ${HEIZ_KONTO}) müssen nach der Heizkostenverordnung verbrauchsabhängig verteilt werden: Messdienst-Ergebnisse eintragen oder Schlüssel „Verbrauch“ mit Werten. Liegt eine Ausnahme vor (z. B. Zweifamilienhaus mit Vermieter, § 2 HeizkostenV), den Schlüssel für Konto ${HEIZ_KONTO} in der Übersicht für diese Liegenschaft bewusst wählen.`;

/** Heizkosten-Position, die weder nach Messdienst noch nach Verbrauch noch nach einem bewusst gewählten Schlüssel verteilt wird */
export function heizkostenOhneMessung(pos: { nummer: string; konto_id: number; schluessel: string; betrag: number }[], eigene: Set<number>): boolean {
  return pos.some((p) => p.nummer === HEIZ_KONTO && Math.abs(p.betrag) >= 0.005 && p.schluessel !== 'Messdienst' && p.schluessel !== 'Verbrauch' && !eigene.has(p.konto_id));
}

export type NkErgebnis = Ergebnis & {
  vz: number;            // Vorauszahlungen NK + HK im Jahr
  saldo: number;         // > 0 Nachzahlung, < 0 Guthaben
  ueberEigentuemer: boolean; // Mieter zahlt an den Eigentümer (vermietete WEG-Einheit): Vorauszahlung laut Vertrag (Soll)
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Vorauszahlungen NK + HK laut Vertrag (Soll) für die Mietmonate im Jahr */
export function vorauszahlungSoll(v: Row, anp: Row[], jahr: number): number {
  const von = String(v.beginn).slice(0, 7) > `${jahr}-01` ? String(v.beginn).slice(0, 7) : `${jahr}-01`;
  const ende = v.ende ? String(v.ende).slice(0, 7) : `${jahr}-12`;
  const bis = ende < `${jahr}-12` ? ende : `${jahr}-12`;
  if (bis < von) return 0;
  return r2(monate(von, bis).reduce((a, m) => { const x = mieteImMonat(v, anp, m); return a + x.nk + x.hk; }, 0));
}

export async function nkBerechnen(objektId: number, jahr: number): Promise<{ einheiten: Row[]; positionen: Position[]; erg: NkErgebnis[] }> {
  const { einheiten, nutzer } = await nutzerErmitteln(objektId, jahr, 'Mieter');
  let positionen = await kostenErmitteln(objektId, jahr, true);
  const h = await db.select(`SELECT h.* FROM heizkosten_ergebnisse h JOIN einheiten e ON e.id = h.einheit_id WHERE e.objekt_id = $1 AND h.jahr = $2`, [objektId, jahr]);
  const messdienst: Record<number, number> = Object.fromEntries(h.map((x) => [x.einheit_id, Number(x.heizkosten) + Number(x.warmwasser)]));
  // Heizkosten nach Messdienst verteilen, sobald Ergebnisse eingetragen sind
  if (Object.keys(messdienst).length) positionen = positionen.map((p) => (p.nummer === HEIZ_KONTO ? { ...p, schluessel: 'Messdienst' } : p));
  // In der WEG gelten dieselben Schlüssel wie in der Jahresabrechnung (MEA, solange für das Objekt kein eigener eingestellt ist),
  // damit der Mieter genau den umlagefähigen Anteil des Eigentümers für seine Mietzeit trägt
  const o = (await db.select('SELECT verwaltungsart FROM objekte WHERE id = $1', [objektId]))[0];
  if (o?.verwaltungsart === 'WEG') {
    const eigene = await eigeneSchluessel(objektId, jahr);
    positionen = positionen.map((p) => (p.schluessel === 'Messdienst' || eigene.has(p.konto_id) ? p : { ...p, schluessel: 'MEA' }));
  }
  const v = await db.select(`SELECT v.* FROM verbrauch v JOIN einheiten e ON e.id = v.einheit_id WHERE e.objekt_id = $1 AND v.jahr = $2`, [objektId, jahr]);
  const verbrauch = Object.fromEntries(v.map((x) => [`${x.einheit_id}-${x.buchungskonto_id}`, Number(x.menge)]));
  const vz = await vorauszahlungen(jahr, ['NK', 'HK']);
  const vertraege = await db.select(`SELECT v.* FROM mietvertraege v JOIN einheiten e ON e.id = v.einheit_id WHERE e.objekt_id = $1`, [objektId]);
  const anp = await db.select(`SELECT a.* FROM mietanpassungen a JOIN mietvertraege v ON v.id = a.vertrag_id JOIN einheiten e ON e.id = v.einheit_id WHERE e.objekt_id = $1`, [objektId]);
  const erg = verteilen(jahr, einheiten, nutzer, positionen, { verbrauch, messdienst }).map((r): NkErgebnis => {
    const vertrag = vertraege.find((x) => x.id === r.nutzer.vertrag_id);
    const ueber = vertrag?.zahlung_an === 'Eigentümer';
    const gezahlt = !vertrag ? 0 : ueber
      ? vorauszahlungSoll(vertrag, anp.filter((a) => a.vertrag_id === vertrag.id), jahr)
      : vz.filter((x) => x.vertrag_id === vertrag.id).reduce((a, x) => a + Number(x.gezahlt), 0);
    return { ...r, vz: r2(gezahlt), saldo: r2(r.summe - gezahlt), ueberEigentuemer: ueber };
  });
  return { einheiten, positionen, erg };
}

/**
 * Wonach eine Buchung für „Alle Einheiten“ in der Abrechnung verteilt wird, je Buchungskonto (für die Tabelle in Einnahmen & Ausgaben).
 * Gleiche Regeln wie in der Abrechnung: WEG nach MEA, solange kein eigener Schlüssel gewählt ist; Heizkosten nach Messdienst,
 * sobald Ergebnisse eingetragen sind. Mietverwaltung: nur umlagefähige Konten werden auf die Mieter verteilt.
 * Konten, die nicht verteilt werden (Einnahmen, Rücklage, Vorjahresabrechnung, ohne EÜR-Häkchen), fehlen.
 */
export async function tabellenSchluessel(objektId: number, jahr: number): Promise<Record<number, string>> {
  const o = (await db.select('SELECT verwaltungsart FROM objekte WHERE id = $1', [objektId]))[0];
  if (!o) return {};
  const weg = o.verwaltungsart === 'WEG';
  const konten = await db.select(`SELECT k.id, k.nummer, k.umlagefaehig, k.schluessel, COALESCE(sj.schluessel, s.schluessel) AS eigen FROM buchungskonten k
    LEFT JOIN objekt_schluessel s ON s.buchungskonto_id = k.id AND s.objekt_id = $1
    LEFT JOIN objekt_schluessel_jahr sj ON sj.buchungskonto_id = k.id AND sj.objekt_id = $1 AND sj.jahr = $2
    WHERE k.art IN ('Aufwand', 'Ertrag') AND COALESCE(k.euer, 1) = 1`, [objektId, jahr]);
  const messdienst = Number((await db.select(`SELECT COUNT(*) AS n FROM heizkosten_ergebnisse h JOIN einheiten e ON e.id = h.einheit_id
    WHERE e.objekt_id = $1 AND h.jahr = $2`, [objektId, jahr]))[0]?.n ?? 0) > 0;
  const out: Record<number, string> = {};
  for (const k of konten) {
    if (weg && ['1260', '1261', '1262', '1601', '1602'].includes(String(k.nummer))) continue;
    if (!weg && !Number(k.umlagefaehig)) continue;
    const s = k.nummer === HEIZ_KONTO && messdienst ? 'Messdienst' : (k.eigen ?? (weg ? 'MEA' : (k.schluessel ?? 'Fläche')));
    out[k.id] = s === 'Summe' ? 'Manuell' : s === 'Messdienst' ? 'lt. Messdienst' : s;
  }
  return out;
}
