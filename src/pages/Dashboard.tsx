import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db, type Row } from '../db';
import { datum, eur, num } from '../components/EntityTable';
import { personLabel } from '../db/labels';
import { OP_SQL } from '../logic/soll';

export function DashboardPage() {
  const [k, setK] = useState<Row>({});
  const [leer, setLeer] = useState<Row[]>([]);
  const [auslaufend, setAuslaufend] = useState<Row[]>([]);
  const [op, setOp] = useState<Row[]>([]);

  useEffect(() => {
    (async () => {
      const aktiv = `v.beginn <= date('now') AND (v.ende IS NULL OR v.ende >= date('now'))`;
      setK((await db.select(`SELECT
          (SELECT COUNT(*) FROM objekte) objekte,
          (SELECT COUNT(*) FROM einheiten) einheiten,
          (SELECT COUNT(*) FROM einheiten e JOIN objekte o ON o.id = e.objekt_id WHERE o.verwaltungsart = 'Mietverwaltung') einheiten_mv,
          (SELECT COUNT(*) FROM einheiten e JOIN objekte o ON o.id = e.objekt_id WHERE o.verwaltungsart = 'Mietverwaltung'
             AND NOT EXISTS (SELECT 1 FROM mietvertraege v WHERE v.einheit_id = e.id AND ${aktiv})) leer_mv,
          (SELECT SUM((SELECT h.betrag FROM hausgeld h WHERE h.einheit_id = e.id AND h.gueltig_ab <= date('now') ORDER BY h.gueltig_ab DESC LIMIT 1))
             FROM einheiten e) hausgeld,
          (SELECT SUM(flaeche) FROM einheiten) flaeche,
          (SELECT COUNT(*) FROM mietvertraege v WHERE ${aktiv}) vermietet,
          (SELECT SUM(kaltmiete) FROM mietvertraege v WHERE ${aktiv}) soll_kalt,
          (SELECT SUM(kaltmiete + nk_vorauszahlung + hk_vorauszahlung) FROM mietvertraege v WHERE ${aktiv}) soll_warm`))[0]);
      setLeer(await db.select(`SELECT e.*, o.name objekt FROM einheiten e JOIN objekte o ON o.id = e.objekt_id
          WHERE o.verwaltungsart = 'Mietverwaltung' AND NOT EXISTS (SELECT 1 FROM mietvertraege v WHERE v.einheit_id = e.id AND ${aktiv}) ORDER BY o.name, e.nummer`));
      setAuslaufend(await db.select(`SELECT v.*, o.name objekt, e.nummer einheit, ${personLabel('p')} mieter
          FROM mietvertraege v JOIN einheiten e ON e.id = v.einheit_id JOIN objekte o ON o.id = e.objekt_id JOIN personen p ON p.id = v.mieter_id
          WHERE v.ende IS NOT NULL AND v.ende >= date('now') AND v.ende <= date('now', '+6 months') ORDER BY v.ende`));
      setOp(await db.select(`SELECT schuldner AS mieter, objekt, einheit, SUM(betrag - bezahlt) offen, MIN(faellig) seit
          FROM (${OP_SQL}) WHERE betrag - bezahlt > 0.005 AND faellig < date('now')
          GROUP BY person_id, einheit_id ORDER BY offen DESC LIMIT 8`));
    })();
  }, []);

  const quote = k.einheiten_mv ? Math.round(((k.leer_mv ?? 0) / k.einheiten_mv) * 100) : 0;

  return (
    <>
      <div className="page-head">
        <h1>Übersicht</h1>
        {db.isDemo && <p className="muted">Vorschau-Modus mit Beispieldaten. In der installierten App werden deine Daten lokal gespeichert.</p>}
      </div>
      <div className="kpis">
        <div className="kpi"><span>Objekte</span><b>{k.objekte ?? 0}</b></div>
        <div className="kpi"><span>Einheiten</span><b>{k.einheiten ?? 0}</b><small>{num(k.flaeche)} m²</small></div>
        <div className="kpi"><span>Leerstand Mietverwaltung</span><b className={quote ? 'neg' : ''}>{quote} %</b><small>{leer.length} Einheiten</small></div>
        <div className="kpi"><span>Sollmiete / Monat</span><b>{eur(k.soll_warm ?? 0)}</b><small>kalt {eur(k.soll_kalt ?? 0)}</small></div>
        <div className="kpi"><span>Hausgeld / Monat</span><b>{eur(k.hausgeld ?? 0)}</b><small>alle WEG</small></div>
      </div>
      <div className="grid2">
        <section className="card">
          <div className="card-head"><h2>Überfällige Mieten und Hausgelder</h2><Link to="/offene-posten">Alle offenen Posten</Link></div>
          {op.length === 0 ? <p className="muted">Keine überfälligen Posten. Soll-Stellung unter „Offene Posten“.</p> : (
            <table className="list"><tbody>
              {op.map((r, i) => <tr key={i}><td>{r.mieter}<div className="muted small">{r.objekt} – {r.einheit} · seit {datum(r.seit)}</div></td><td className="num neg"><b>{eur(r.offen)}</b></td></tr>)}
            </tbody></table>
          )}
        </section>
        <section className="card">
          <div className="card-head"><h2>Leerstand</h2></div>
          {leer.length === 0 ? <p className="muted">Alles vermietet.</p> : (
            <table className="list"><tbody>
              {leer.map((e) => <tr key={e.id}><td><Link to={`/objekte/${e.objekt_id}`}>{e.objekt}</Link> – {e.nummer}</td><td>{e.typ}</td><td className="num">{num(e.flaeche)} m²</td></tr>)}
            </tbody></table>
          )}
        </section>
        <section className="card">
          <div className="card-head"><h2>Verträge, die in 6 Monaten enden</h2></div>
          {auslaufend.length === 0 ? <p className="muted">Keine.</p> : (
            <table className="list"><tbody>
              {auslaufend.map((v) => <tr key={v.id}><td>{v.mieter}<div className="muted small">{v.objekt} – {v.einheit}</div></td><td className="num">{datum(v.ende)}</td></tr>)}
            </tbody></table>
          )}
        </section>
      </div>
    </>
  );
}
