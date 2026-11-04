// Eingabe je Einheit für Konten mit Schlüssel „Verbrauch“ (Menge) oder „Summe“ (fester Betrag in €).
import { useEffect, useState } from 'react';
import { db, type Row } from '../db';
import { eur, num } from './EntityTable';
import type { Position } from '../logic/verteilung';

const zahl = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.')) || 0;

export function WerteJeEinheit({ objekt, jahr, einheiten, konten, onSaved }: { objekt: number; jahr: number; einheiten: Row[]; konten: Position[]; onSaved: () => void }) {
  const [werte, setWerte] = useState<Record<string, string>>({});
  useEffect(() => {
    db.select(`SELECT v.* FROM verbrauch v JOIN einheiten e ON e.id = v.einheit_id WHERE e.objekt_id = $1 AND v.jahr = $2`, [objekt, jahr])
      .then((v) => setWerte(Object.fromEntries(v.map((x) => [`${x.einheit_id}-${x.buchungskonto_id}`, String(x.menge).replace('.', ',')]))));
  }, [objekt, jahr]);
  if (!konten.length) return null;

  async function speichern() {
    for (const [k, m] of Object.entries(werte)) {
      const [eid, kid] = k.split('-').map(Number);
      if (m === '') await db.execute('DELETE FROM verbrauch WHERE einheit_id = $1 AND jahr = $2 AND buchungskonto_id = $3', [eid, jahr, kid]);
      else await db.execute(`INSERT INTO verbrauch (einheit_id, jahr, buchungskonto_id, menge) VALUES ($1, $2, $3, $4)
        ON CONFLICT (einheit_id, jahr, buchungskonto_id) DO UPDATE SET menge = excluded.menge`, [eid, jahr, kid, zahl(m)]);
    }
    onSaved();
  }
  const abw = konten.filter((p) => p.schluessel === 'Summe')
    .map((p) => ({ p, s: einheiten.reduce((a, e) => a + zahl(werte[`${e.id}-${p.konto_id}`] ?? '0'), 0) }))
    .filter((x) => Math.abs(x.s - x.p.betrag) > 0.005);

  return (
    <section className="card">
      <div className="card-head"><h2>Beträge und Verbrauch je Einheit für {jahr}</h2><button onClick={speichern}>Speichern und neu berechnen</button></div>
      <table className="list">
        <thead><tr><th>Einheit</th>{konten.map((k) => <th key={k.konto_id} className="num">{k.schluessel === 'Summe' ? `${k.name} (€, manuell)` : `Verbrauch ${k.name}`}</th>)}</tr></thead>
        <tbody>{einheiten.map((e) => (
          <tr key={e.id}><td>{e.nummer}</td>
            {konten.map((k) => (
              <td key={k.konto_id} className="num"><input className="cell" inputMode="decimal" value={werte[`${e.id}-${k.konto_id}`] ?? ''}
                onChange={(ev) => setWerte({ ...werte, [`${e.id}-${k.konto_id}`]: ev.target.value })} /></td>))}
          </tr>))}
        </tbody>
        <tfoot><tr><td>Summe</td>{konten.map((k) => <td key={k.konto_id} className="num">{k.schluessel === 'Summe'
          ? <>{eur(einheiten.reduce((a, e) => a + zahl(werte[`${e.id}-${k.konto_id}`] ?? '0'), 0))}<div className="muted small">von {eur(k.betrag)}</div></>
          : num(einheiten.reduce((a, e) => a + zahl(werte[`${e.id}-${k.konto_id}`] ?? '0'), 0))}</td>)}</tr></tfoot>
      </table>
      {abw.map(({ p, s }) => <p key={p.konto_id} className="warn">{p.name} (manuell): eingetragen {eur(s)}, Kosten laut Buchhaltung {eur(p.betrag)}. Es fehlen {eur(p.betrag - s)} zur Gesamtsumme.</p>)}
    </section>
  );
}
