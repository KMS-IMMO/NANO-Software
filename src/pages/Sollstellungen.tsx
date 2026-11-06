// Sollstellungen: monatlich zu zahlende Beträge (Miete, Vorauszahlungen, Hausgeld) je Einheit auflisten,
// für einen Zeitraum aus den Stammdaten erzeugen, einzeln bearbeiten, löschen oder von Hand anlegen.
import { useEffect, useMemo, useState } from 'react';
import { CalendarRange, Plus, Trash2 } from 'lucide-react';
import { db, remove, update, type Row } from '../db';
import { useObjektKontext } from '../logic/objektKontext';
import { eur } from '../components/EntityTable';
import { SollstellungNeu } from '../components/SollstellungNeu';
import { OP_SQL, postenStatus, sollStellen, zahlungBuchen, mahnenAbTage } from '../logic/soll';

const heute = () => new Date().toISOString().slice(0, 10);
const zahl = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.')) || 0;
const monatName = (m: string) => /^\d{4}-\d{2}$/.test(m) ? new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }) : m;
export const STATUS_KLASSE: Record<string, string> = { bezahlt: 'aktiv', erwartet: 'erwartet', 'fällig': 'faellig', mahnen: 'mahnen', gemahnt: 'gemahnt' };

export function SollstellungenPage() {
  const fix = useObjektKontext();
  const jahr = new Date().getFullYear();
  const [von, setVon] = useState(`${jahr}-01`);
  const [bis, setBis] = useState(`${jahr}-12`);
  const [objekte, setObjekte] = useState<Row[]>([]);
  const [objekt, setObjekt] = useState<number | ''>(fix?.id ?? '');
  const [rows, setRows] = useState<Row[]>([]);
  const [info, setInfo] = useState('');
  const [neu, setNeu] = useState<Row | null>(null);
  const [grenze, setGrenze] = useState(14);

  useEffect(() => { db.select('SELECT id, name FROM objekte ORDER BY name').then(setObjekte); mahnenAbTage().then(setGrenze); }, []);
  const load = async () => {
    const w = [`substr(s.monat, 1, 7) BETWEEN $1 AND $2`];
    if (objekt !== '') w.push(`o.id = ${Number(objekt)}`);
    setRows(await db.select(`SELECT * FROM (${OP_SQL} WHERE ${w.join(' AND ')}) ORDER BY monat, objekt, einheit, art`, [von, bis]));
  };
  useEffect(() => { load(); }, [von, bis, objekt]);

  async function erzeugen() {
    if (von > bis) { setInfo('„Von“ muss vor „bis“ liegen.'); return; }
    const n = await sollStellen(bis, { von, objektId: objekt === '' ? undefined : Number(objekt) });
    setInfo(n ? `${n} Posten aus den Stammdaten (Mietverträge, Hausgeld) angelegt.` : 'Für diesen Zeitraum ist schon alles angelegt.');
    load();
  }
  async function aendern(r: Row, feld: 'betrag' | 'faellig', wert: string) {
    const v = feld === 'betrag' ? zahl(wert) : wert;
    if ((feld === 'betrag' && !v) || v === r[feld]) return;
    await update('sollstellungen', r.id, { [feld]: v }); load();
  }
  async function loeschen(r: Row) {
    if (r.bezahlt > 0.005) { setInfo('Auf diesen Posten ist schon eine Zahlung gebucht. Bitte zuerst die Zahlung lösen.'); return; }
    await remove('sollstellungen', r.id); load();
  }

  const monate = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) { const k = String(r.monat).slice(0, 7); m.set(k, [...(m.get(k) ?? []), r]); }
    return [...m.entries()];
  }, [rows]);
  const summe = rows.reduce((a, r) => a + r.betrag, 0), bezahlt = rows.reduce((a, r) => a + Math.min(r.bezahlt, r.betrag), 0);

  return (
    <>
      <div className="page-head"><h1 className="title-ico"><CalendarRange size={26} />Sollstellungen</h1>
        <p className="muted">Monatlich zu zahlende Beträge je Einheit. Aus den Stammdaten (Mietverträge, Hausgeld) erzeugen und bei Bedarf einzeln anpassen.</p></div>
      <section className="card row">
        {!fix && <select style={{ width: 240 }} value={objekt} onChange={(e) => setObjekt(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Alle Liegenschaften</option>{objekte.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
        <label className="inline">Zeitraum von <input type="month" value={von} onChange={(e) => setVon(e.target.value)} /></label>
        <label className="inline">bis <input type="month" value={bis} onChange={(e) => setBis(e.target.value)} /></label>
        <button className="primary" onClick={erzeugen}>Aus Stammdaten erzeugen</button>
        <span className="grow" />
        <button onClick={() => setNeu({ monat: heute().slice(0, 7), art: 'Kaltmiete' })} disabled={objekt === ''} title={objekt === '' ? 'Bitte zuerst eine Liegenschaft wählen' : ''}><Plus size={16} />Posten hinzufügen</button>
      </section>
      {info && <p className="info">{info}</p>}
      <div className="kpis">
        <div className="kpi"><span>Soll im Zeitraum</span><b>{eur(summe)}</b><small>{rows.length} Posten</small></div>
        <div className="kpi"><span>Bezahlt</span><b className="pos">{eur(bezahlt)}</b></div>
        <div className="kpi"><span>Offen</span><b className={summe - bezahlt > 0.005 ? 'neg' : ''}>{eur(summe - bezahlt)}</b></div>
        <div className="kpi"><span>Monatlich (Ø)</span><b>{eur(monate.length ? summe / monate.length : 0)}</b></div>
      </div>
      {monate.length === 0 && <section className="card"><p className="muted">Keine Sollstellungen im Zeitraum. Klicke auf „Aus Stammdaten erzeugen“.</p></section>}
      {monate.map(([m, liste]) => {
        const s = liste.reduce((a, r) => a + r.betrag, 0);
        return (
          <section key={m} className="card">
            <div className="card-head"><h2>{monatName(m)}</h2><span className="muted">monatlich zu zahlen <b>{eur(s)}</b></span></div>
            <div className="tablewrap"><table className="list">
              <thead><tr><th>Einheit</th><th>Mieter / Eigentümer</th><th>Art</th><th>Fällig</th><th className="num">Betrag</th><th className="num">Bezahlt</th><th>Status</th><th /></tr></thead>
              <tbody>{liste.map((r) => {
                const st = postenStatus(r, grenze);
                return (
                  <tr key={r.id}>
                    <td>{!fix && <span className="muted small">{r.objekt} · </span>}{r.einheit}</td>
                    <td>{r.schuldner || <span className="muted">–</span>}</td>
                    <td>{r.art}</td>
                    <td><input type="date" className="cell" style={{ width: 140 }} defaultValue={r.faellig} onBlur={(e) => aendern(r, 'faellig', e.target.value)} /></td>
                    <td className="num"><input className="cell" inputMode="decimal" defaultValue={Number(r.betrag).toFixed(2).replace('.', ',')} onBlur={(e) => aendern(r, 'betrag', e.target.value)} /></td>
                    <td className="num">{eur(r.bezahlt)}</td>
                    <td><span className={'pill st-' + STATUS_KLASSE[st]}>{st}</span></td>
                    <td className="actions">
                      {st !== 'bezahlt' && <button className="link" onClick={async () => { await zahlungBuchen(r); load(); }}>Als bezahlt buchen</button>}
                      <button className="icon-btn" title="Posten löschen" onClick={() => loeschen(r)}><Trash2 size={15} /></button>
                    </td>
                  </tr>);
              })}</tbody>
            </table></div>
          </section>);
      })}
      {neu && objekt !== '' && <SollstellungNeu objektId={Number(objekt)} onClose={() => setNeu(null)} onSaved={(t) => { setNeu(null); setInfo(t); load(); }} />}
    </>
  );
}
