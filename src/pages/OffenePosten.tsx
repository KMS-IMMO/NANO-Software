// Offene Posten (Miete und Hausgeld) mit Soll-Stellung und Statistik offen / gezahlt.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { db, type Row } from '../db';
import { useObjektKontext } from '../logic/objektKontext';
import { datum, eur } from '../components/EntityTable';
import { OP_SQL, mahnenAbTage, postenStatus, zahlungBuchen } from '../logic/soll';
import { STATUS_KLASSE } from './Sollstellungen';

const heute = () => new Date().toISOString().slice(0, 10);
const offen = (r: Row) => r.betrag - r.bezahlt > 0.005;

type Gruppierung = 'Objekt' | 'Schuldner' | 'Monat' | 'Jahr';

export function OffenePostenPage() {
  const fix = useObjektKontext();
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<'offen' | 'erwartet' | 'fällig' | 'mahnen' | 'gemahnt' | 'bezahlt' | 'alle'>('offen');
  const [grenze, setGrenze] = useState(14);
  useEffect(() => { mahnenAbTage().then(setGrenze); }, []);
  const [objekt, setObjekt] = useState(fix ? String(fix.id) : '');
  const [gruppe, setGruppe] = useState<Gruppierung>(fix ? 'Schuldner' : 'Objekt');

  const load = async () => setRows(await db.select(`${OP_SQL} ORDER BY s.faellig DESC, o.name, e.lfd_nr, e.nummer`));
  useEffect(() => { load(); }, []);

  async function zahlung(r: Row) { await zahlungBuchen(r); load(); }
  const basisPfad = fix ? `/objekte/${fix.id}` : '';

  const objekte = useMemo(() => [...new Map(rows.map((r) => [r.objekt_id, r.objekt])).entries()], [rows]);
  const basis = rows.filter((r) => !objekt || String(r.objekt_id) === objekt);
  const mitStatus: Row[] = basis.map((r) => ({ ...r, status: postenStatus(r, grenze) }));
  const liste = mitStatus.filter((r) => filter === 'alle' || (filter === 'offen' ? r.status !== 'bezahlt' : r.status === filter));
  const zahl = (f: string) => mitStatus.filter((r) => f === 'alle' || (f === 'offen' ? r.status !== 'bezahlt' : r.status === f)).length;
  const soll = basis.reduce((a, r) => a + r.betrag, 0);
  const ist = basis.reduce((a, r) => a + r.bezahlt, 0);
  const ueber = basis.filter((r) => offen(r) && r.faellig < heute()).reduce((a, r) => a + r.betrag - r.bezahlt, 0);

  const stat = useMemo(() => {
    const key = (r: Row) => gruppe === 'Objekt' ? r.objekt : gruppe === 'Schuldner' ? r.schuldner : gruppe === 'Monat' ? r.monat : r.monat.slice(0, 4);
    const m = new Map<string, { soll: number; ist: number }>();
    for (const r of basis) {
      const k = key(r) || '–';
      const x = m.get(k) ?? { soll: 0, ist: 0 };
      x.soll += r.betrag; x.ist += r.bezahlt; m.set(k, x);
    }
    const arr = [...m.entries()];
    return gruppe === 'Monat' || gruppe === 'Jahr' ? arr.sort((a, b) => b[0].localeCompare(a[0])) : arr.sort((a, b) => (b[1].soll - b[1].ist) - (a[1].soll - a[1].ist));
  }, [basis, gruppe]);

  return (
    <>
      <div className="page-head"><h1>Offene Posten</h1><p className="muted">Mieten und Hausgeld: Soll, gezahlt und offen</p></div>
      <div className="kpis">
        <div className="kpi"><span>Soll gesamt</span><b>{eur(soll)}</b></div>
        <div className="kpi"><span>Gezahlt</span><b>{eur(ist)}</b></div>
        <div className="kpi"><span>Offen</span><b className="neg">{eur(soll - ist)}</b></div>
        <div className="kpi"><span>davon überfällig</span><b className="neg">{eur(ueber)}</b></div>
      </div>

      <section className="card">
        <div className="card-head">
          <p className="muted" style={{ margin: 0 }}>Welche Mieten und Hausgelder noch offen sind: <b>erwartet</b> (noch nicht fällig), <b>fällig</b> (überfällig, innerhalb von {grenze} Tagen), <b>mahnen</b> (länger überfällig) oder <b>gemahnt</b>. Neue Posten legst du unter <Link to={basisPfad + '/sollstellungen'}>Sollstellungen</Link> an.</p>
          {!fix && <select style={{ width: 220 }} value={objekt} onChange={(e) => setObjekt(e.target.value)}>
            <option value="">Alle Objekte</option>
            {objekte.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Statistik</h2>
          <div className="seg">{(['Objekt', 'Schuldner', 'Monat', 'Jahr'] as const).map((g) =>
            <button key={g} className={gruppe === g ? 'on' : ''} onClick={() => setGruppe(g)}>pro {g === 'Schuldner' ? 'Mieter/Eigentümer' : g}</button>)}</div>
        </div>
        {stat.length === 0 ? <p className="muted">Noch keine Posten. Lege sie unter „Sollstellungen“ an.</p> : (
          <table className="list">
            <thead><tr><th>{gruppe === 'Schuldner' ? 'Mieter / Eigentümer' : gruppe}</th><th className="num">Soll</th><th className="num">Gezahlt</th><th className="num">Offen</th><th style={{ width: '30%' }}>Zahlungsquote</th></tr></thead>
            <tbody>{stat.map(([k, x]) => {
              const q = x.soll ? Math.min(100, (x.ist / x.soll) * 100) : 100;
              return (
                <tr key={k}><td>{k}</td><td className="num">{eur(x.soll)}</td><td className="num">{eur(x.ist)}</td>
                  <td className={'num ' + (x.soll - x.ist > 0.005 ? 'neg' : '')}>{eur(x.soll - x.ist)}</td>
                  <td><div className="bar"><div style={{ width: q + '%' }} /></div><span className="small muted">{Math.round(q)} %</span></td></tr>);
            })}</tbody>
          </table>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Einzelposten</h2>
          <div className="seg">{(['offen', 'erwartet', 'fällig', 'mahnen', 'gemahnt', 'bezahlt', 'alle'] as const).map((k) =>
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{k[0].toUpperCase() + k.slice(1)} ({zahl(k)})</button>)}</div>
        </div>
        {liste.length === 0 ? <p className="muted">Keine Posten.</p> : (
          <table className="list">
            <thead><tr><th>Fällig</th><th>Monat</th><th>Objekt / Einheit</th><th>Mieter / Eigentümer</th><th>Art</th><th className="num">Soll</th><th className="num">Gezahlt</th><th className="num">Offen</th><th>Status</th><th /></tr></thead>
            <tbody>
              {liste.slice(0, 300).map((r) => {
                const rest = r.betrag - r.bezahlt;
                return (
                  <tr key={r.id}>
                    <td className={rest > 0.005 && r.faellig < heute() ? 'neg' : ''}>{datum(r.faellig)}</td>
                    <td>{r.monat}</td>
                    <td>{r.objekt} – {r.einheit}</td>
                    <td>{r.schuldner}</td>
                    <td>{r.art}</td>
                    <td className="num">{eur(r.betrag)}</td>
                    <td className="num">{eur(r.bezahlt)}</td>
                    <td className="num"><b>{eur(rest)}</b></td>
                    <td><span className={'pill st-' + STATUS_KLASSE[r.status]}>{r.status}</span></td>
                    <td className="actions">
                      {r.status === 'mahnen' && <Link className="primary small-btn btn-link" to={basisPfad + '/mahnungen'}>Mahnen</Link>}
                      {rest > 0.005 && <button className="link" onClick={() => zahlung(r)}>Zahlung erfassen</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
