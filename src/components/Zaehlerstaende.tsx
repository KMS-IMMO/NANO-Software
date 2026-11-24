// Zählerstände schnell erfassen: je Einheit alter und neuer Stand, der Verbrauch ergibt sich daraus.
// Der alte Stand kommt automatisch aus dem neuen Stand des Vorjahres. Enter springt in die nächste Zeile.
import { useEffect, useRef, useState } from 'react';
import { Gauge } from 'lucide-react';
import { db, type Row } from '../db';
import { betragZahl } from '../lib/betrag';
import { num } from './EntityTable';

type Konto = { konto_id: number; name: string };
const txt = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(v).replace('.', ','));
const zahl = (s: string) => (s.trim() === '' ? null : betragZahl(s));

export function ZaehlerstaendeKnopf(p: { objekt: number; jahr: number; einheiten: Row[]; konten: Konto[]; onSaved: () => void; disabled?: boolean }) {
  const [auf, setAuf] = useState(false);
  if (!p.konten.length) return null;
  return <>
    <button type="button" disabled={p.disabled} onClick={() => setAuf(true)} title="Alte und neue Zählerstände eintragen, der Verbrauch wird berechnet"><Gauge size={16} />Zählerstände</button>
    {auf && <ZaehlerstaendeFenster {...p} onClose={() => setAuf(false)} />}
  </>;
}

function ZaehlerstaendeFenster({ objekt, jahr, einheiten, konten, onSaved, onClose }: { objekt: number; jahr: number; einheiten: Row[]; konten: Konto[]; onSaved: () => void; onClose: () => void }) {
  const [w, setW] = useState<Record<string, string>>({});
  const [fehler, setFehler] = useState('');
  const tabelle = useRef<HTMLTableElement>(null);
  const k = (e: number, kto: number, f: string) => `${e}-${kto}-${f}`;

  useEffect(() => {
    (async () => {
      const dies = await db.select(`SELECT z.* FROM zaehlerstaende z JOIN einheiten e ON e.id = z.einheit_id WHERE e.objekt_id = $1 AND z.jahr = $2`, [objekt, jahr]);
      const vor = await db.select(`SELECT z.* FROM zaehlerstaende z JOIN einheiten e ON e.id = z.einheit_id WHERE e.objekt_id = $1 AND z.jahr = $2`, [objekt, jahr - 1]);
      const n: Record<string, string> = {};
      for (const z of vor) { n[k(z.einheit_id, z.buchungskonto_id, 'alt')] = txt(z.neu); n[k(z.einheit_id, z.buchungskonto_id, 'nr')] = z.zaehlernr ?? ''; }
      for (const z of dies) { n[k(z.einheit_id, z.buchungskonto_id, 'alt')] = txt(z.alt); n[k(z.einheit_id, z.buchungskonto_id, 'neu')] = txt(z.neu); n[k(z.einheit_id, z.buchungskonto_id, 'nr')] = z.zaehlernr ?? ''; }
      setW(n);
    })();
  }, [objekt, jahr]);

  const verbrauch = (e: number, kto: number): number | null => {
    const a = zahl(w[k(e, kto, 'alt')] ?? ''), b = zahl(w[k(e, kto, 'neu')] ?? '');
    return a === null || b === null ? null : Math.round((b - a) * 1000) / 1000;
  };

  async function speichern() {
    setFehler('');
    for (const e of einheiten) for (const kt of konten) {
      const v = verbrauch(e.id, kt.konto_id);
      if (v !== null && v < 0) { setFehler(`${e.nummer}, ${kt.name}: Der neue Stand ist kleiner als der alte. Bei einem Zählerwechsel bitte den Verbrauch direkt in der Tabelle eintragen.`); return; }
    }
    for (const e of einheiten) for (const kt of konten) {
      const alt = zahl(w[k(e.id, kt.konto_id, 'alt')] ?? ''), neu = zahl(w[k(e.id, kt.konto_id, 'neu')] ?? ''), nr = (w[k(e.id, kt.konto_id, 'nr')] ?? '').trim() || null;
      if (alt === null && neu === null && !nr) {
        await db.execute('DELETE FROM zaehlerstaende WHERE einheit_id = $1 AND jahr = $2 AND buchungskonto_id = $3', [e.id, jahr, kt.konto_id]);
        continue;
      }
      await db.execute(`INSERT INTO zaehlerstaende (einheit_id, buchungskonto_id, jahr, zaehlernr, alt, neu) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (einheit_id, jahr, buchungskonto_id) DO UPDATE SET zaehlernr = excluded.zaehlernr, alt = excluded.alt, neu = excluded.neu`, [e.id, kt.konto_id, jahr, nr, alt, neu]);
      const v = verbrauch(e.id, kt.konto_id);
      if (v !== null) await db.execute(`INSERT INTO verbrauch (einheit_id, jahr, buchungskonto_id, menge) VALUES ($1, $2, $3, $4)
        ON CONFLICT (einheit_id, jahr, buchungskonto_id) DO UPDATE SET menge = excluded.menge`, [e.id, jahr, kt.konto_id, v]);
    }
    onSaved(); onClose();
  }

  // Enter: gleiche Spalte, nächste Zeile (wie in Excel)
  const weiter = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const td = ev.currentTarget.closest('td'), tr = td?.parentElement as HTMLTableRowElement | null;
    if (!td || !tr) return;
    const spalte = [...tr.children].indexOf(td);
    const naechste = (ev.shiftKey ? tr.previousElementSibling : tr.nextElementSibling) as HTMLTableRowElement | null;
    (naechste?.children[spalte]?.querySelector('input') as HTMLInputElement | null)?.focus();
  };
  const feld = (e: number, kto: number, f: string, breit = false) => (
    <input className={'cell' + (breit ? '' : ' num')} inputMode={f === 'nr' ? undefined : 'decimal'} value={w[k(e, kto, f)] ?? ''} onKeyDown={weiter}
      onChange={(ev) => setW((x) => ({ ...x, [k(e, kto, f)]: ev.target.value }))} />);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal breit zaehler-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="title-ico"><Gauge size={20} />Zählerstände {jahr}</h3>
        <p className="muted small">Alter Stand = Stand zum Jahresbeginn (kommt automatisch aus dem Vorjahr), neuer Stand = Ablesung zum Jahresende. Der Verbrauch wird berechnet und in die Abrechnung übernommen. Enter springt eine Zeile weiter.</p>
        <div className="tablewrap"><table className="list zaehler-tabelle" ref={tabelle}>
          <thead>
            <tr><th rowSpan={2}>Einheit</th>{konten.map((kt) => <th key={kt.konto_id} colSpan={4} className="zaehler-gruppe">{kt.name}</th>)}</tr>
            <tr>{konten.map((kt) => [<th key={kt.konto_id + 'n'}>Zähler-Nr.</th>, <th key={kt.konto_id + 'a'} className="num">alt</th>, <th key={kt.konto_id + 'b'} className="num">neu</th>, <th key={kt.konto_id + 'v'} className="num">Verbrauch</th>])}</tr>
          </thead>
          <tbody>{einheiten.map((e) => (
            <tr key={e.id}><td>{e.nummer}</td>
              {konten.map((kt) => { const v = verbrauch(e.id, kt.konto_id); return [
                <td key={kt.konto_id + 'n'}>{feld(e.id, kt.konto_id, 'nr', true)}</td>,
                <td key={kt.konto_id + 'a'}>{feld(e.id, kt.konto_id, 'alt')}</td>,
                <td key={kt.konto_id + 'b'}>{feld(e.id, kt.konto_id, 'neu')}</td>,
                <td key={kt.konto_id + 'v'} className={'num' + (v !== null && v < 0 ? ' neg' : '')}><b>{v === null ? '' : num(v, 3).replace(/,?0+$/, '')}</b></td>]; })}
            </tr>))}
          </tbody>
          <tfoot><tr><td>Summe</td>{konten.map((kt) => [<td key={kt.konto_id + 'n'} />, <td key={kt.konto_id + 'a'} />, <td key={kt.konto_id + 'b'} />,
            <td key={kt.konto_id + 'v'} className="num">{num(einheiten.reduce((s, e) => s + (verbrauch(e.id, kt.konto_id) ?? 0), 0), 3).replace(/,?0+$/, '')}</td>])}</tr></tfoot>
        </table></div>
        {fehler && <p className="error">{fehler}</p>}
        <div className="row end"><button onClick={onClose}>Abbrechen</button><button className="primary" onClick={speichern}>Verbrauch übernehmen</button></div>
      </div>
    </div>
  );
}
