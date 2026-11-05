import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BarChart3, Building2, CalendarDays, ChevronRight, DoorOpen, FolderOpen, ListTodo, Users, Wallet } from 'lucide-react';
import { db, type Row } from '../db';
import { datum, eur, num } from '../components/EntityTable';
import { Donut } from '../components/Donut';
import { personLabel } from '../db/labels';
import { OP_SQL } from '../logic/soll';

const monat = () => new Date().toISOString().slice(0, 7);
const monatName = () => new Date().toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

export function DashboardPage() {
  const nav = useNavigate();
  const [k, setK] = useState<Row>({});
  const [z, setZ] = useState<Row>({});
  const [objekte, setObjekte] = useState<Row[]>([]);
  const [leer, setLeer] = useState<Row[]>([]);
  const [auslaufend, setAuslaufend] = useState<Row[]>([]);
  const [op, setOp] = useState<Row[]>([]);
  const [termine, setTermine] = useState<Row[]>([]);

  useEffect(() => {
    (async () => {
      const aktiv = `v.beginn <= date('now') AND (v.ende IS NULL OR v.ende >= date('now'))`;
      setK((await db.select(`SELECT
          (SELECT COUNT(*) FROM objekte) objekte,
          (SELECT COUNT(*) FROM einheiten) einheiten,
          (SELECT SUM(flaeche) FROM einheiten) flaeche,
          (SELECT COUNT(DISTINCT v.mieter_id) FROM mietvertraege v WHERE ${aktiv}) mieter,
          (SELECT COALESCE(SUM(betrag - bezahlt), 0) FROM (${OP_SQL}) WHERE betrag - bezahlt > 0.005 AND faellig < date('now')) offen,
          (SELECT COUNT(*) FROM (${OP_SQL}) WHERE betrag - bezahlt > 0.005 AND faellig < date('now')) offen_n,
          (SELECT COUNT(*) FROM sollstellungen WHERE mahnstufe > 0 AND art <> 'Mahngebühr') gemahnt,
          (SELECT COUNT(*) FROM vorgaenge WHERE status <> 'Erledigt') vorgaenge,
          (SELECT COUNT(*) FROM beschluesse WHERE status <> 'Erledigt' AND ergebnis = 'Angenommen') beschluesse`))[0]);
      setTermine(await db.select(`SELECT 'Eigentümerversammlung' AS was, o.name AS objekt, v.datum FROM versammlungen v JOIN objekte o ON o.id = v.objekt_id WHERE v.datum >= date('now')
          UNION ALL SELECT 'Hausgeldanpassung', o.name, h.gueltig_ab FROM hausgeld h JOIN einheiten e ON e.id = h.einheit_id JOIN objekte o ON o.id = e.objekt_id
            WHERE h.gueltig_ab > date('now') GROUP BY o.id, h.gueltig_ab
          UNION ALL SELECT 'Fällig: ' || x.betreff, o.name, x.faellig FROM vorgaenge x JOIN objekte o ON o.id = x.objekt_id WHERE x.status <> 'Erledigt' AND x.faellig IS NOT NULL
          ORDER BY 3 LIMIT 6`));
      setZ((await db.select(`SELECT COALESCE(SUM(betrag), 0) soll, COALESCE(SUM(MIN(bezahlt, betrag)), 0) ist
          FROM (${OP_SQL}) WHERE monat = $1 AND art IN ('Kaltmiete', 'NK', 'HK', 'USt', 'Hausgeld', 'Rücklage')`, [monat()]))[0]);
      setObjekte(await db.select(`SELECT o.*, (SELECT COUNT(*) FROM einheiten e WHERE e.objekt_id = o.id) einheiten
          FROM objekte o ORDER BY o.objekt_nr, o.name`));
      setLeer(await db.select(`SELECT e.*, o.name objekt FROM einheiten e JOIN objekte o ON o.id = e.objekt_id
          WHERE o.verwaltungsart = 'Mietverwaltung' AND NOT EXISTS (SELECT 1 FROM mietvertraege v WHERE v.einheit_id = e.id AND ${aktiv}) ORDER BY o.name, e.nummer`));
      setAuslaufend(await db.select(`SELECT v.*, o.name objekt, e.nummer einheit, ${personLabel('p')} mieter
          FROM mietvertraege v JOIN einheiten e ON e.id = v.einheit_id JOIN objekte o ON o.id = e.objekt_id JOIN personen p ON p.id = v.mieter_id
          WHERE v.ende IS NOT NULL AND v.ende >= date('now') AND v.ende <= date('now', '+6 months') ORDER BY v.ende`));
      setOp(await db.select(`SELECT schuldner AS mieter, objekt, einheit, SUM(betrag - bezahlt) offen, MIN(faellig) seit
          FROM (${OP_SQL}) WHERE betrag - bezahlt > 0.005 AND faellig < date('now')
          GROUP BY person_id, einheit_id ORDER BY offen DESC LIMIT 6`));
    })();
  }, []);

  const soll = Number(z.soll) || 0, ist = Number(z.ist) || 0;

  return (
    <>
      <div className="page-head">
        <h1>Dashboard</h1>
        {db.isDemo && <p className="muted">Vorschau mit Beispieldaten. In der installierten App werden deine Daten lokal gespeichert.</p>}
      </div>
      <div className="kpis">
        <div className="kpi icon"><Building2 size={40} strokeWidth={1.5} /><div><b>{k.objekte ?? 0}</b><span>Liegenschaften</span></div></div>
        <div className="kpi icon"><DoorOpen size={40} strokeWidth={1.5} /><div><b>{k.einheiten ?? 0}</b><span>Einheiten · {num(k.flaeche, 0)} m²</span></div></div>
        <div className="kpi icon"><Users size={40} strokeWidth={1.5} /><div><b>{k.mieter ?? 0}</b><span>Mieter</span></div></div>
        <div className="kpi icon"><Wallet size={40} strokeWidth={1.5} /><div><b className={k.offen > 0 ? 'neg' : ''}>{eur(k.offen ?? 0)}</b><span>Überfällig ({k.offen_n ?? 0} Posten)</span></div></div>
      </div>
      <div className="grid2">
        <section className="card">
          <div className="card-head"><h2 className="title-ico"><BarChart3 size={22} />Zahlungsübersicht <span className="muted small">({monatName()})</span></h2></div>
          {soll === 0 ? <p className="muted">Für diesen Monat ist noch nichts soll gestellt. Das machst du unter <Link to="/offene-posten">Offene Posten</Link>.</p> : (
            <div className="donut-wrap">
              <Donut anteil={ist / soll} label="bezahlt" />
              <div className="legend">
                <span><i style={{ background: '#2e7d32' }} />Eingänge</span><b className="num">{eur(ist)}</b><span className="muted num">{num((ist / soll) * 100, 1)} %</span>
                <span><i style={{ background: '#c0392b' }} />Offen</span><b className="num">{eur(soll - ist)}</b><span className="muted num">{num(((soll - ist) / soll) * 100, 1)} %</span>
                <span><b>Gesamt (Soll)</b></span><b className="num">{eur(soll)}</b><span className="muted num">100 %</span>
              </div>
            </div>)}
        </section>
        <section className="card">
          <div className="card-head"><h2 className="title-ico"><ListTodo size={22} />Offene Aufgaben</h2></div>
          <div className="aufgaben">
            <Link to="/mahnungen"><span><b>{k.offen_n ?? 0}</b>Zahlungen überfällig</span><ChevronRight size={18} /></Link>
            <Link to="/instandhaltung"><span><b>{k.vorgaenge ?? 0}</b>Instandhaltungen offen</span><ChevronRight size={18} /></Link>
            <Link to="/beschluesse"><span><b>{k.beschluesse ?? 0}</b>Beschlüsse in Umsetzung</span><ChevronRight size={18} /></Link>
            <Link to="/mahnungen"><span><b>{k.gemahnt ?? 0}</b>Posten bereits gemahnt</span><ChevronRight size={18} /></Link>
            <Link to="/objekte"><span><b>{leer.length}</b>Einheiten leer (Mietverwaltung)</span><ChevronRight size={18} /></Link>
            <Link to="/vertraege"><span><b>{auslaufend.length}</b>Mietverträge enden in 6 Monaten</span><ChevronRight size={18} /></Link>
          </div>
        </section>
      </div>
      <section className="card">
        <div className="card-head"><h2 className="title-ico"><Building2 size={22} />Liegenschaften – Übersicht</h2><Link to="/objekte">Alle Liegenschaften →</Link></div>
        <table className="list">
          <thead><tr><th>ID</th><th>Liegenschaft (Adresse)</th><th className="num">Einheiten</th><th>Typ</th><th>Status</th><th className="actions">Aktionen</th></tr></thead>
          <tbody>{objekte.map((o) => (
            <tr key={o.id} className="clickable" onClick={() => nav(`/objekte/${o.id}`)}>
              <td><b>H-ID {o.objekt_nr}</b></td>
              <td><b>{o.name}</b><div className="muted small">{[o.strasse, [o.plz, o.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</div></td>
              <td className="num">{o.einheiten}</td>
              <td>{o.verwaltungsart}</td>
              <td><span className={'pill ' + String(o.status ?? 'Aktiv').toLowerCase()}>{o.status ?? 'Aktiv'}</span></td>
              <td className="actions" onClick={(e) => e.stopPropagation()}>
                <button className="icon-btn" title="Dokumente" onClick={() => nav('/ablage')}><FolderOpen size={19} /></button>
                <button className="icon-btn" title="Offene Posten" onClick={() => nav('/offene-posten')}><BarChart3 size={19} /></button>
              </td>
            </tr>))}
          </tbody>
        </table>
      </section>
      <div className="grid2">
        <section className="card">
          <div className="card-head"><h2>Überfällige Mieten und Hausgelder</h2><Link to="/offene-posten">Alle offenen Posten →</Link></div>
          {op.length === 0 ? <p className="muted">Keine überfälligen Posten.</p> : (
            <table className="list"><tbody>
              {op.map((r, i) => <tr key={i}><td>{r.mieter}<div className="muted small">{r.objekt} – {r.einheit} · seit {datum(r.seit)}</div></td><td className="num neg"><b>{eur(r.offen)}</b></td></tr>)}
            </tbody></table>)}
        </section>
        <section className="card">
          <div className="card-head"><h2 className="title-ico"><CalendarDays size={22} />Nächste Termine</h2></div>
          {termine.length === 0 ? <p className="muted">Keine Termine. Versammlungen legst du in der WEG unter „Beschlüsse“ an.</p> : (
            <table className="list"><tbody>
              {termine.map((t, i) => <tr key={i}><td>{t.was}<div className="muted small">{t.objekt}</div></td><td className="num">{datum(t.datum)}</td></tr>)}
            </tbody></table>)}
          <div className="card-head" style={{ marginTop: 18 }}><h2>Leerstand und auslaufende Verträge</h2></div>
          {leer.length === 0 && auslaufend.length === 0 ? <p className="muted">Alles vermietet, keine Verträge laufen bald aus.</p> : (
            <table className="list"><tbody>
              {leer.map((e) => <tr key={'l' + e.id}><td><Link to={`/objekte/${e.objekt_id}`}>{e.objekt}</Link> – {e.nummer}</td><td><span className="pill offen">Leerstand</span></td><td className="num">{num(e.flaeche)} m²</td></tr>)}
              {auslaufend.map((v) => <tr key={'v' + v.id}><td>{v.mieter}<div className="muted small">{v.objekt} – {v.einheit}</div></td><td><span className="pill teil">endet</span></td><td className="num">{datum(v.ende)}</td></tr>)}
            </tbody></table>)}
        </section>
      </div>
    </>
  );
}
