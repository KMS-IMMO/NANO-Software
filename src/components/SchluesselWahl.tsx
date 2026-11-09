// Verteilerschlüssel einer Kostenposition direkt in der Abrechnung ändern (gilt für das Abrechnungsjahr).
// Bei „Verbrauch“ und „Manuell“ (Summe) öffnet sich ein Fenster: Gesamtverbrauch bzw. Gesamtsumme und die Werte je Einheit.
// Gespeichert wird erst, wenn die Summe der Einheiten genau mit dem Gesamtwert übereinstimmt.
import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { db, type Row } from '../db';
import { eur } from './EntityTable';
import type { Position } from '../logic/verteilung';

export const WAHL: [string, string][] = [['MEA', 'MEA'], ['Fläche', 'Fläche'], ['Einheiten', 'Einheiten'], ['Personen', 'Personen'],
  ['Verbrauch', 'Verbrauch'], ['Summe', 'Manuell (Betrag je Einheit)']];
export const schluesselText = (s: string) => WAHL.find(([k]) => k === s)?.[1] ?? s;

const zahl = (s: string) => Number(String(s).replace(/\s/g, '').replace(/\./g, '').replace(',', '.')) || 0;
const fmt = (n: number, d = 2) => n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const r2 = (n: number) => Math.round(n * 100) / 100;

type Fenster = { art: 'Verbrauch' | 'Summe'; einheiten: Row[]; werte: Record<number, string>; gesamt: string; masseinheit: string };

export const MASSEINHEITEN = ['m²', 'm³', 'kWh', 'Liter', 'Stück'];

async function speichernSchluessel(objekt: number, jahr: number, kontoId: number, neu: string, masseinheit: string | null = null) {
  // Gilt nur für dieses Abrechnungsjahr; andere Jahre behalten ihren eigenen Schlüssel
  await db.execute(`INSERT INTO objekt_schluessel_jahr (objekt_id, jahr, buchungskonto_id, schluessel, masseinheit) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (objekt_id, jahr, buchungskonto_id) DO UPDATE SET schluessel = excluded.schluessel, masseinheit = excluded.masseinheit`, [objekt, jahr, kontoId, neu, masseinheit]);
}

export function SchluesselWahl({ objekt, jahr, p, anteile, onChanged }: {
  objekt: number; jahr: number; p: Position; anteile: (kontoId: number) => Record<number, number>; onChanged: (text: string) => void;
}) {
  const [f, setF] = useState<Fenster | null>(null);
  const [fehler, setFehler] = useState('');
  if (p.schluessel === 'Messdienst' || p.schluessel === 'Direkt') return <>{p.schluessel}</>;

  async function oeffnen(art: 'Verbrauch' | 'Summe') {
    const einheiten = await db.select('SELECT id, nummer, typ, flaeche FROM einheiten WHERE objekt_id = $1 ORDER BY lfd_nr, nummer', [objekt]);
    const v = await db.select(`SELECT v.einheit_id, v.menge FROM verbrauch v JOIN einheiten e ON e.id = v.einheit_id
      WHERE e.objekt_id = $1 AND v.jahr = $2 AND v.buchungskonto_id = $3`, [objekt, jahr, p.konto_id]);
    const werte: Record<number, string> = {};
    const gespeichert = p.schluessel === art && v.length > 0;
    if (gespeichert) for (const x of v) werte[x.einheit_id] = fmt(Number(x.menge), art === 'Summe' ? 2 : 3).replace(/,?0+$/, (m) => (art === 'Summe' ? m : ''));
    else if (art === 'Summe') {
      // Startwerte = bisherige Verteilung, Rundungscent auf die größte Einheit, damit die Summe genau stimmt
      const a = anteile(p.konto_id);
      const ids = einheiten.map((e) => e.id);
      const bet = ids.map((id) => r2(a[id] ?? 0));
      const diff = r2(p.betrag - bet.reduce((s, b) => s + b, 0));
      if (ids.length && Math.abs(diff) > 0 && bet.some((b) => b)) { const i = bet.reduce((m, x, j) => (x > bet[m] ? j : m), 0); bet[i] = r2(bet[i] + diff); }
      ids.forEach((id, i) => { if (bet[i]) werte[id] = fmt(bet[i]); });
    }
    const me = (await db.select('SELECT masseinheit FROM objekt_schluessel_jahr WHERE objekt_id = $1 AND jahr = $2 AND buchungskonto_id = $3', [objekt, jahr, p.konto_id]))[0]?.masseinheit;
    const summeV = Object.values(werte).reduce((s, w) => s + zahl(w), 0);
    setFehler('');
    setF({ art, einheiten, werte, gesamt: art === 'Summe' ? fmt(p.betrag) : gespeichert ? fmt(summeV, 3).replace(/,?0+$/, '') : '', masseinheit: me || (art === 'Summe' ? '€' : 'm³') });
  }

  async function wechseln(neu: string) {
    if (neu === p.schluessel) return;
    if (neu === 'Verbrauch' || neu === 'Summe') { oeffnen(neu); return; }
    await speichernSchluessel(objekt, jahr, p.konto_id, neu);
    onChanged(`${p.name}: Verteilung für ${jahr} jetzt nach ${schluesselText(neu)}.`);
  }

  const gesamt = f ? zahl(f.gesamt) : 0;
  const verteilt = f ? r2(f.einheiten.reduce((s, e) => s + zahl(f.werte[e.id] ?? ''), 0) * 1000) / 1000 : 0;
  const passt = f ? gesamt > 0 && Math.abs(verteilt - gesamt) < (f.art === 'Summe' ? 0.005 : 0.0005) : false;
  const kosten = (e: Row) => (!f ? 0 : f.art === 'Summe' ? zahl(f.werte[e.id] ?? '') : gesamt ? p.betrag * zahl(f.werte[e.id] ?? '') / gesamt : 0);

  async function uebernehmen() {
    if (!f) return;
    if (!passt) { setFehler(f.art === 'Summe' ? 'Die Beträge der Einheiten müssen zusammen genau die Gesamtkosten ergeben.' : 'Die Verbräuche der Einheiten müssen zusammen genau den Gesamtverbrauch ergeben.'); return; }
    for (const e of f.einheiten) {
      const m = zahl(f.werte[e.id] ?? '');
      if (!m) await db.execute('DELETE FROM verbrauch WHERE einheit_id = $1 AND jahr = $2 AND buchungskonto_id = $3', [e.id, jahr, p.konto_id]);
      else await db.execute(`INSERT INTO verbrauch (einheit_id, jahr, buchungskonto_id, menge) VALUES ($1, $2, $3, $4)
        ON CONFLICT (einheit_id, jahr, buchungskonto_id) DO UPDATE SET menge = excluded.menge`, [e.id, jahr, p.konto_id, m]);
    }
    await speichernSchluessel(objekt, jahr, p.konto_id, f.art, f.art === 'Summe' ? '€' : f.masseinheit);
    const art = f.art; setF(null);
    onChanged(art === 'Summe' ? `${p.name}: Kosten für ${jahr} manuell je Einheit verteilt.` : `${p.name}: Kosten für ${jahr} nach Verbrauch verteilt.`);
  }

  return (
    <>
      <span className="schl-wahl">
        <select className="cell" value={p.schluessel} onChange={(e) => wechseln(e.target.value)} title="Verteilung dieser Kostenposition ändern">
          {WAHL.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          {!WAHL.some(([k]) => k === p.schluessel) && <option value={p.schluessel}>{p.schluessel}</option>}
        </select>
        {(p.schluessel === 'Verbrauch' || p.schluessel === 'Summe') && (
          <button className="icon-btn" title="Werte je Einheit bearbeiten" onClick={() => oeffnen(p.schluessel as 'Verbrauch' | 'Summe')}><Pencil size={15} /></button>)}
      </span>
      {f && (
        <div className="modal-bg" onClick={() => setF(null)}>
          <div className="modal schl-fenster" onClick={(e) => e.stopPropagation()}>
            <h3>{f.art === 'Summe' ? 'Kosten manuell je Einheit verteilen' : 'Kosten nach Verbrauch verteilen'}</h3>
            <p className="muted">{p.nummer} {p.name} · Abrechnungsjahr {jahr} · Gesamtkosten <b>{eur(p.betrag)}</b></p>
            <div className="form">
              {f.art === 'Verbrauch' ? <>
                <label><span>Gesamtverbrauch{f.masseinheit ? ` (${f.masseinheit})` : ''} *</span><input inputMode="decimal" autoFocus placeholder="z. B. 1.250" value={f.gesamt} onChange={(e) => setF({ ...f, gesamt: e.target.value })} /></label>
                <label><span>Maßeinheit</span><select value={f.masseinheit} onChange={(e) => setF({ ...f, masseinheit: e.target.value })}>{MASSEINHEITEN.map((m) => <option key={m}>{m}</option>)}</select></label>
              </> : <label><span>Gesamtsumme</span><input value={f.gesamt} disabled /></label>}
            </div>
            <table className="list">
              <thead><tr><th>Einheit</th><th className="num">{f.art === 'Summe' ? 'Betrag €' : `Verbrauch${f.masseinheit ? ` (${f.masseinheit})` : ''}`}</th>{f.art === 'Verbrauch' && <th className="num">Anteil</th>}<th className="num">Kosten</th></tr></thead>
              <tbody>{f.einheiten.map((e) => (
                <tr key={e.id}><td>{e.nummer} <span className="muted small">{e.typ}</span></td>
                  <td className="num"><input className="cell" inputMode="decimal" value={f.werte[e.id] ?? ''} onChange={(x) => setF({ ...f, werte: { ...f.werte, [e.id]: x.target.value } })} /></td>
                  {f.art === 'Verbrauch' && <td className="num">{gesamt ? fmt(zahl(f.werte[e.id] ?? '') / gesamt * 100, 1) + ' %' : '–'}</td>}
                  <td className="num">{eur(kosten(e))}</td></tr>))}
              </tbody>
              <tfoot><tr><td>Verteilt</td><td className="num">{f.art === 'Summe' ? eur(verteilt) : fmt(verteilt, 3).replace(/,?0+$/, '')}</td>{f.art === 'Verbrauch' && <td />}
                <td className="num">{eur(f.einheiten.reduce((s, e) => s + kosten(e), 0))}</td></tr></tfoot>
            </table>
            <p className={passt ? 'info' : 'warn'}>{passt ? 'Gesamtwert und Verteilung stimmen überein.'
              : f.art === 'Summe' ? `Verteilt ${eur(verteilt)} von ${eur(gesamt)}. ${verteilt < gesamt ? 'Es fehlen' : 'Zu viel verteilt:'} ${eur(Math.abs(r2(gesamt - verteilt)))}.`
              : gesamt ? `Verteilt ${fmt(verteilt, 3).replace(/,?0+$/, '')} von ${fmt(gesamt, 3).replace(/,?0+$/, '')}${f.masseinheit ? ' ' + f.masseinheit : ''}. ${verteilt < gesamt ? 'Es fehlen' : 'Zu viel verteilt:'} ${fmt(Math.abs(r2((gesamt - verteilt) * 1000) / 1000), 3).replace(/,?0+$/, '')}${f.masseinheit ? ' ' + f.masseinheit : ''}.`
              : 'Bitte zuerst den Gesamtverbrauch eintragen.'}</p>
            {fehler && <p className="error">{fehler}</p>}
            <div className="row end"><span className="grow" /><button onClick={() => setF(null)}>Abbrechen</button>
              <button className="primary" disabled={!passt} onClick={uebernehmen}>Übernehmen</button></div>
          </div>
        </div>)}
    </>
  );
}
