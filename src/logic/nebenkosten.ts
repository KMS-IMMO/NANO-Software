// Nebenkostenabrechnung je Objekt und Jahr: wird von der Nebenkostenseite und von der
// WEG-Jahresabrechnung (vermietete Einheiten) gemeinsam genutzt.
import { db, type Row } from '../db';
import { eigeneSchluessel, kostenErmitteln, nutzerErmitteln, verteilen, vorauszahlungen, type Ergebnis, type Position } from './verteilung';
import { mieteImMonat, monate } from './soll';

export const HEIZ_KONTO = '1200';

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
