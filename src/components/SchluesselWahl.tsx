// Verteilerschlüssel einer Kostenposition direkt in der Abrechnung ändern.
// „Manuell“ (Summe) übernimmt die bisherige Verteilung als Startwerte je Einheit, die man dann frei anpasst.
import { db } from '../db';
import type { Position } from '../logic/verteilung';

export const WAHL: [string, string][] = [['MEA', 'MEA'], ['Fläche', 'Fläche'], ['Einheiten', 'Einheiten'], ['Personen', 'Personen'],
  ['Verbrauch', 'Verbrauch'], ['Summe', 'Manuell (Betrag je Einheit)']];
export const schluesselText = (s: string) => WAHL.find(([k]) => k === s)?.[1] ?? s;

export function SchluesselWahl({ objekt, jahr, p, anteile, onChanged }: {
  objekt: number; jahr: number; p: Position; anteile: (kontoId: number) => Record<number, number>; onChanged: (text: string) => void;
}) {
  if (p.schluessel === 'Messdienst' || p.schluessel === 'Direkt') return <>{p.schluessel}</>;
  async function wechseln(neu: string) {
    if (neu === p.schluessel) return;
    if (neu === 'Summe') {
      const vorhanden = await db.select(`SELECT 1 FROM verbrauch v JOIN einheiten e ON e.id = v.einheit_id
        WHERE e.objekt_id = $1 AND v.jahr = $2 AND v.buchungskonto_id = $3 LIMIT 1`, [objekt, jahr, p.konto_id]);
      if (!vorhanden.length) {
        // Startwerte = bisherige Verteilung, Rundungscent auf die größte Einheit, damit die Summe genau stimmt
        const a = Object.entries(anteile(p.konto_id)).map(([e, b]) => [Number(e), Math.round(b * 100) / 100] as [number, number]);
        const diff = Math.round((p.betrag - a.reduce((s, [, b]) => s + b, 0)) * 100) / 100;
        if (a.length && Math.abs(diff) > 0) { const i = a.reduce((m, x, j) => (x[1] > a[m][1] ? j : m), 0); a[i][1] = Math.round((a[i][1] + diff) * 100) / 100; }
        for (const [eid, b] of a) await db.execute(`INSERT INTO verbrauch (einheit_id, jahr, buchungskonto_id, menge) VALUES ($1, $2, $3, $4)
          ON CONFLICT (einheit_id, jahr, buchungskonto_id) DO UPDATE SET menge = excluded.menge`, [eid, jahr, p.konto_id, b]);
      }
    }
    await db.execute(`INSERT INTO objekt_schluessel (objekt_id, buchungskonto_id, schluessel) VALUES ($1, $2, $3)
      ON CONFLICT (objekt_id, buchungskonto_id) DO UPDATE SET schluessel = excluded.schluessel`, [objekt, p.konto_id, neu]);
    onChanged(neu === 'Summe'
      ? `${p.name}: Verteilung jetzt manuell. Die bisherigen Anteile stehen unten unter „Beträge je Einheit“ und lassen sich dort ändern.`
      : `${p.name}: Verteilung jetzt nach ${schluesselText(neu)}.`);
  }
  return (
    <select className="cell" value={p.schluessel} onChange={(e) => wechseln(e.target.value)} title="Verteilung dieser Kostenposition ändern">
      {WAHL.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
      {!WAHL.some(([k]) => k === p.schluessel) && <option value={p.schluessel}>{p.schluessel}</option>}
    </select>
  );
}
