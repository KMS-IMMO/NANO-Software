// Fristen-Wächter: Wartungen, Prüfungen, Versicherungen und Vertragsenden mit Ampel.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Check, Plus } from 'lucide-react';
import { db, insert, update, type Row } from '../db';
import { EntityTable, datum } from '../components/EntityTable';
import { useObjektKontext } from '../logic/objektKontext';
import { plusMonate } from '../logic/wiederkehrend';

export const FRIST_VORLAGEN: { titel: string; art: string; monate: number | null }[] = [
  { titel: 'Rauchmelder-Wartung', art: 'Wartung', monate: 12 },
  { titel: 'Heizungswartung', art: 'Wartung', monate: 12 },
  { titel: 'Schornsteinfeger / Feuerstättenschau', art: 'Prüfung', monate: 12 },
  { titel: 'Aufzug Hauptprüfung (ZÜS)', art: 'Prüfung', monate: 24 },
  { titel: 'Aufzug Zwischenprüfung (ZÜS)', art: 'Prüfung', monate: 24 },
  { titel: 'Trinkwasser Legionellenprüfung', art: 'Prüfung', monate: 36 },
  { titel: 'Feuerlöscher-Prüfung', art: 'Prüfung', monate: 24 },
  { titel: 'Elektroprüfung Allgemeinstrom (DGUV V3)', art: 'Prüfung', monate: 48 },
  { titel: 'Spielplatz-Inspektion', art: 'Prüfung', monate: 12 },
  { titel: 'Dachrinnen und Dach-Begehung', art: 'Wartung', monate: 12 },
  { titel: 'Gebäudeversicherung Verlängerung', art: 'Versicherung', monate: 12 },
  { titel: 'Haus- und Grundbesitzerhaftpflicht', art: 'Versicherung', monate: 12 },
  { titel: 'Verwaltervertrag endet', art: 'Vertrag', monate: null },
];
export const FRIST_ARTEN = ['Wartung', 'Prüfung', 'Versicherung', 'Vertrag', 'Sonstiges'];

const heute = () => new Date().toISOString().slice(0, 10);
const tageBis = (d: string) => Math.round((new Date(d + 'T12:00:00').getTime() - new Date(heute() + 'T12:00:00').getTime()) / 86400000);

/** Alle offenen Fristen (eigene und automatisch aus Mietverträgen), sortiert nach Fälligkeit */
export async function offeneFristen(objektId?: number): Promise<Row[]> {
  const o = objektId ? ` AND f.objekt_id = ${Number(objektId)}` : '';
  const ov = objektId ? ` AND e.objekt_id = ${Number(objektId)}` : '';
  const eigene = await db.select(`SELECT f.*, o.name AS objekt, 'frist' AS quelle FROM fristen f LEFT JOIN objekte o ON o.id = f.objekt_id
    WHERE f.erledigt_am IS NULL${o}`);
  const vertraege = await db.select(`SELECT v.id, 'Mietvertrag endet: ' || e.nummer AS titel, 'Vertrag' AS art, e.objekt_id, v.ende AS faellig, 90 AS vorlauf_tage,
      o.name AS objekt, 'vertrag' AS quelle FROM mietvertraege v JOIN einheiten e ON e.id = v.einheit_id JOIN objekte o ON o.id = e.objekt_id
    WHERE v.ende IS NOT NULL AND v.ende >= date('now', '-30 days') AND v.ende <= date('now', '+365 days')${ov}`);
  return [...eigene, ...vertraege].sort((a, b) => String(a.faellig).localeCompare(String(b.faellig)));
}
export const fristStatus = (f: Row) => { const t = tageBis(f.faellig); return t < 0 ? 'ueber' : t <= (f.vorlauf_tage ?? 30) ? 'bald' : 'ok'; };

export function FristenPage() {
  const fix = useObjektKontext();
  const [liste, setListe] = useState<Row[]>([]);
  const [v, setV] = useState(0);
  const [objekte, setObjekte] = useState<Row[]>([]);
  const [vorlage, setVorlage] = useState<{ objekt: number | ''; auswahl: string[]; ab: string } | null>(null);
  const [info, setInfo] = useState('');
  const load = () => offeneFristen(fix?.id).then(setListe);
  useEffect(() => { load(); }, [v, fix?.id]);
  useEffect(() => { db.select('SELECT id, name FROM objekte ORDER BY name').then(setObjekte); }, []);

  async function erledigt(f: Row) {
    if (f.quelle !== 'frist') return;
    if (f.intervall_monate) {
      let n = plusMonate(f.faellig, Number(f.intervall_monate));
      while (n < heute()) n = plusMonate(n, Number(f.intervall_monate));
      await update('fristen', f.id, { faellig: n });
      setInfo(`„${f.titel}“ erledigt. Nächster Termin: ${datum(n)}.`);
    } else { await update('fristen', f.id, { erledigt_am: heute() }); setInfo(`„${f.titel}“ erledigt.`); }
    setV((x) => x + 1);
  }
  async function vorlagenAnlegen() {
    if (!vorlage) return;
    for (const t of vorlage.auswahl) {
      const x = FRIST_VORLAGEN.find((y) => y.titel === t)!;
      await insert('fristen', { titel: x.titel, art: x.art, objekt_id: vorlage.objekt || null, faellig: vorlage.ab, intervall_monate: x.monate });
    }
    setInfo(`${vorlage.auswahl.length} Fristen angelegt. Trag bei jeder das echte Datum der nächsten Fälligkeit ein.`);
    setVorlage(null); setV((x) => x + 1);
  }

  const zahl = (s: string) => liste.filter((f) => fristStatus(f) === s).length;
  return (
    <>
      {!fix && <div className="page-head"><h1>Fristen</h1><p className="muted">Wartungen, Prüfungen, Versicherungen und Vertragsenden im Blick</p></div>}
      <div className="kpis">
        <div className="kpi"><span>Überfällig</span><b className={zahl('ueber') ? 'neg' : ''}>{zahl('ueber')}</b></div>
        <div className="kpi"><span>Demnächst fällig</span><b>{zahl('bald')}</b></div>
        <div className="kpi"><span>Im Plan</span><b>{zahl('ok')}</b></div>
      </div>
      {info && <p className="info">{info}</p>}
      <section className="card">
        <div className="card-head"><h2 className="title-ico"><CalendarClock size={22} />Anstehende Fristen</h2>
          <button onClick={() => setVorlage({ objekt: fix?.id ?? '', auswahl: [], ab: heute() })}><Plus size={16} />Aus Vorlage anlegen</button></div>
        {liste.length === 0 ? <p className="muted">Keine offenen Fristen.</p> : (
          <div className="tablewrap"><table className="list">
            <thead><tr><th /><th>Fällig</th><th>Frist</th><th>Art</th>{!fix && <th>Liegenschaft</th>}<th>Rhythmus</th><th /></tr></thead>
            <tbody>{liste.map((f) => { const s = fristStatus(f), t = tageBis(f.faellig); return (
              <tr key={f.quelle + f.id} className={'frist-' + s}>
                <td style={{ width: 14 }}><i className={'ampel ' + s} /></td>
                <td className="nowrap"><b>{datum(f.faellig)}</b><div className="muted small">{t < 0 ? `seit ${-t} Tagen` : t === 0 ? 'heute' : `in ${t} Tagen`}</div></td>
                <td>{f.titel}{f.zustaendig && <div className="muted small">{f.zustaendig}</div>}</td>
                <td><span className="tag">{f.art ?? '–'}</span></td>
                {!fix && <td>{f.objekt ?? <span className="muted">alle</span>}</td>}
                <td className="small">{f.intervall_monate ? `alle ${f.intervall_monate} Monate` : f.quelle === 'vertrag' ? <Link to={`/vertraege/${f.id}`}>Vertrag öffnen</Link> : 'einmalig'}</td>
                <td className="actions">{f.quelle === 'frist' && <button className="link" onClick={() => erledigt(f)}><Check size={15} /> Erledigt</button>}</td>
              </tr>); })}</tbody>
          </table></div>)}
        <p className="muted small">Rot = überfällig, gelb = innerhalb der Vorlaufzeit, grün = im Plan. Bei Fristen mit Rhythmus springt „Erledigt“ auf den nächsten Termin. Enden von Mietverträgen kommen automatisch dazu.</p>
      </section>
      <EntityTable
        title="Alle Fristen verwalten"
        table="fristen"
        version={v}
        onChange={() => setV((x) => x + 1)}
        fixed={fix ? { objekt_id: fix.id } : undefined}
        fields={[
          { key: 'titel', label: 'Frist', required: true, wide: true },
          { key: 'art', label: 'Art', type: 'select', options: FRIST_ARTEN },
          ...(fix ? [] : [{ key: 'objekt_id', label: 'Liegenschaft', type: 'select' as const, optionsSql: 'SELECT id AS value, name AS label FROM objekte ORDER BY name', leer: 'alle' }]),
          { key: 'faellig', label: 'Nächste Fälligkeit', type: 'date', required: true, format: (x) => datum(x) },
          { key: 'intervall_monate', label: 'Rhythmus in Monaten (leer = einmalig)', type: 'number', format: (x) => (x ? `${x} Mon.` : 'einmalig') },
          { key: 'vorlauf_tage', label: 'Vorwarnung (Tage, leer = 30)', type: 'number', hideInTable: true },
          { key: 'zustaendig', label: 'Zuständig / Firma' },
          { key: 'notiz', label: 'Notiz', type: 'textarea', wide: true, hideInTable: true },
          { key: 'erledigt_am', label: 'Erledigt am (nur einmalige)', type: 'date', format: (x) => datum(x) },
        ]}
        listSql={`SELECT f.*, o.name AS objekt_id_label FROM fristen f LEFT JOIN objekte o ON o.id = f.objekt_id ${fix ? `WHERE f.objekt_id = ${Number(fix.id)}` : ''} ORDER BY f.erledigt_am IS NOT NULL, f.faellig`}
        emptyText="Noch keine Fristen. Am schnellsten geht es über „Aus Vorlage anlegen“."
        newLabel="Neue Frist"
      />
      {vorlage && (
        <div className="modal-bg" onClick={() => setVorlage(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Fristen aus Vorlage anlegen</h3>
            <div className="form">
              <label><span>Liegenschaft</span><select value={vorlage.objekt} disabled={!!fix} onChange={(e) => setVorlage({ ...vorlage, objekt: e.target.value ? Number(e.target.value) : '' })}>
                <option value="">alle / ohne</option>{objekte.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
              <label><span>Erste Fälligkeit</span><input type="date" value={vorlage.ab} onChange={(e) => setVorlage({ ...vorlage, ab: e.target.value })} /></label>
            </div>
            <div className="vorlagen-liste">{FRIST_VORLAGEN.map((x) => (
              <label key={x.titel} className="inline"><input type="checkbox" checked={vorlage.auswahl.includes(x.titel)}
                onChange={(e) => setVorlage({ ...vorlage, auswahl: e.target.checked ? [...vorlage.auswahl, x.titel] : vorlage.auswahl.filter((y) => y !== x.titel) })} />
                {x.titel} <span className="muted small">{x.monate ? `alle ${x.monate} Monate` : 'einmalig'}</span></label>))}</div>
            <div className="row end"><span className="grow" /><button onClick={() => setVorlage(null)}>Abbrechen</button>
              <button className="primary" disabled={!vorlage.auswahl.length} onClick={vorlagenAnlegen}>{vorlage.auswahl.length || ''} Anlegen</button></div>
          </div>
        </div>)}
    </>
  );
}
