import { useEffect, useRef, useState } from 'react';
import { FileText, FileUp, Paperclip, Trash2 } from 'lucide-react';
import { speichern } from '../lib/dateien';
import { basisOrdner } from './Dokumente';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EntityTable, datum, eur, type Field } from '../components/EntityTable';
import { db, type Row } from '../db';
import { useObjektKontext } from '../logic/objektKontext';
import { einheitLabel, personLabel, personOptions } from '../db/labels';
import { mieteImMonat, mieteNeuStellen } from '../logic/soll';
import { DokumentAnsicht } from '../components/DokumentAnsicht';

const vertragFields: Field[] = [
  { key: 'einheit_id', label: 'Einheit', type: 'select', required: true, wide: true,
    optionsSql: `SELECT e.id AS value, o.name || ' – ' || ${einheitLabel('e')} || ' (' || e.typ || ')' AS label FROM einheiten e JOIN objekte o ON o.id = e.objekt_id ORDER BY o.name, e.lfd_nr, e.nummer` },
  { key: 'mieter_id', label: 'Mieter', type: 'select', required: true, optionsSql: personOptions('Mieter') },
  { key: 'mieter2_id', label: '2. Mieter', type: 'select', optionsSql: personOptions('Mieter'), hideInTable: true },
  { key: 'beginn', label: 'Beginn', type: 'date', required: true },
  { key: 'ende', label: 'Ende', type: 'date' },
  { key: 'zahlung_an', label: 'Miete zahlt an', type: 'select', hideInTable: true,
    options: [{ value: 'Verwaltung', label: 'Verwaltung (Soll-Stellung bei uns)' }, { value: 'Eigentümer', label: 'Eigentümer (vermietete WEG-Einheit)' }] },
  { key: 'mietart', label: 'Mietart', type: 'select', options: ['Standard', 'Staffelmiete', 'Indexmiete'] },
  { key: 'kaltmiete', label: 'Kaltmiete (Start)', type: 'number', format: eur, hideInTable: true },
  { key: 'nk_vorauszahlung', label: 'NK-Vorauszahlung (Start)', type: 'number', format: eur, hideInTable: true },
  { key: 'hk_vorauszahlung', label: 'HK-Vorauszahlung (Start)', type: 'number', format: eur, hideInTable: true },
  { key: 'ust_satz', label: 'Umsatzsteuer %', type: 'select', options: [{ value: 0, label: 'keine' }, { value: 19, label: '19 %' }, { value: 7, label: '7 %' }], hideInTable: true },
  { key: 'kaution', label: 'Kaution', type: 'number', format: eur, hideInTable: true },
  { key: 'personenzahl', label: 'Personen', type: 'number', format: (v) => v ?? '' },
  { key: 'zahlweise', label: 'Zahlweise Miete + NK', type: 'select', hideInTable: true,
    options: [{ value: '', label: 'wie bei der Liegenschaft eingestellt' }, { value: 'zusammen', label: 'zusammen (eine Zahlung)' }, { value: 'getrennt', label: 'getrennt überwiesen' }] },
  { key: 'faellig_tag', label: 'Fällig am (Tag im Monat)', type: 'number', hideInTable: true, format: (v) => v },
  { key: 'index_basis', label: 'Index-Basiswert (VPI)', type: 'number', hideInTable: true },
  { key: 'index_basis_monat', label: 'Index-Basismonat', hideInTable: true },
  { key: 'notiz', label: 'Notiz', type: 'textarea', hideInTable: true },
];

const listSql = (where = '1=1') => `SELECT v.*, o.name || ' – ' || e.nummer AS einheit_id_label, ${personLabel('p')} AS mieter_id_label,
    (SELECT COUNT(*) FROM dokumente d WHERE d.bezug = 'Mietvertrag' AND d.bezug_id = v.id) AS doks,
    CASE WHEN v.beginn > date('now') THEN 'künftig' WHEN v.ende IS NOT NULL AND v.ende < date('now') THEN 'beendet' ELSE 'aktiv' END AS status
  FROM mietvertraege v JOIN einheiten e ON e.id = v.einheit_id JOIN objekte o ON o.id = e.objekt_id
  JOIN personen p ON p.id = v.mieter_id WHERE ${where} ORDER BY o.name, e.lfd_nr, e.nummer, v.beginn DESC`;

export function VertraegePage() {
  const nav = useNavigate();
  const fix = useObjektKontext();
  const felder = fix ? vertragFields.map((f) => f.key === 'einheit_id'
    ? { ...f, optionsSql: `SELECT e.id AS value, ${einheitLabel('e')} || ' (' || e.typ || ')' AS label FROM einheiten e WHERE e.objekt_id = ${fix.id} ORDER BY e.lfd_nr, e.nummer` } : f) : vertragFields;
  return (
    <EntityTable
      title={fix ? 'Mieter und Mietverträge' : 'Mietverträge'}
      table="mietvertraege"
      fields={[...felder,
        { key: 'warm', label: 'Miete aktuell', computed: true, type: 'number', format: (_v, r) => <AktuelleMiete v={r} /> },
        { key: 'status', label: 'Status', computed: true, format: (v) => <span className={'pill ' + v}>{v}</span> },
        { key: 'doks', label: 'Vertrag', computed: true, format: (v, r) => <VertragSymbol anzahl={Number(v) || 0} v={r} oeffnen={() => nav(fix ? `/objekte/${fix.id}/vertrag/${r.id}` : `/vertraege/${r.id}`)} /> }]}
      listSql={listSql(fix ? `o.id = ${fix.id}` : undefined)}
      onOpen={(r) => nav(fix ? `/objekte/${fix.id}/vertrag/${r.id}` : `/vertraege/${r.id}`)}
      emptyText="Noch keine Mietverträge. Lege zuerst Einheit und Mieter an."
    />
  );
}

/** Ganz rechts in der Liste: Vertrag als PDF ansehen. Fehlt er, leuchtet das Symbol rot und führt zum Hochladen. */
function VertragSymbol({ anzahl, v, oeffnen: zumVertrag }: { anzahl: number; v: Row; oeffnen: () => void }) {
  const [docs, setDocs] = useState<Row[] | null>(null);
  async function zeigen(e: React.MouseEvent) {
    e.stopPropagation();
    if (!anzahl) { zumVertrag(); return; }
    setDocs(await db.select(`SELECT * FROM dokumente WHERE bezug = 'Mietvertrag' AND bezug_id = $1 ORDER BY hinzugefuegt DESC, id DESC`, [v.id]));
  }
  return (
    <>
      <button className={'vertrag-symbol' + (anzahl ? ' da' : ' fehlt')} title={anzahl ? `Mietvertrag ansehen (${anzahl} Dokument${anzahl === 1 ? '' : 'e'})` : 'Kein Mietvertrag hinterlegt. Klicken zum Hochladen'} onClick={zeigen}>
        <FileText size={17} /></button>
      {docs && docs.length > 0 && <span onClick={(e) => e.stopPropagation()}><DokumentAnsicht docs={docs} titel={`Mietvertrag ${v.mieter_id_label} · ${v.einheit_id_label}`} onClose={() => setDocs(null)} /></span>}
    </>
  );
}

function AktuelleMiete({ v }: { v: Row }) {
  const [m, setM] = useState<ReturnType<typeof mieteImMonat> | null>(null);
  useEffect(() => {
    db.select('SELECT * FROM mietanpassungen WHERE vertrag_id = $1', [v.id]).then((a) => setM(mieteImMonat(v, a, new Date().toISOString().slice(0, 7))));
  }, [v.id, v.kaltmiete, v.nk_vorauszahlung, v.hk_vorauszahlung, v.ust_satz, v.beginn, v.ende]);
  if (!m) return null;
  return <>{eur(m.kalt + m.nk + m.hk + m.ust)}</>;
}

export function VertragDetailPage({ vertragId }: { vertragId?: number }) {
  const p = useParams();
  const id = vertragId ?? Number(p.id);
  const fix = useObjektKontext();
  const [v, setV] = useState<Row | null>(null);
  const [anp, setAnp] = useState<Row[]>([]);
  const [hinweis, setHinweis] = useState('');
  const reload = async () => {
    setV((await db.select(listSql('v.id = $1'), [id]))[0] ?? null);
    setAnp(await db.select('SELECT * FROM mietanpassungen WHERE vertrag_id = $1', [id]));
  };
  useEffect(() => { reload(); }, [id]);
  if (!v) return <p>Vertrag wird geladen…</p>;
  const jetzt = mieteImMonat(v, anp, new Date().toISOString().slice(0, 7));
  return (
    <>
      <div className="page-head">
        <p className="muted small"><Link to={fix ? `/objekte/${fix.id}/mieter` : '/vertraege'}>{fix ? 'Mieter und Mietverträge' : 'Mietverträge'}</Link> ›</p>
        <h1>{v.mieter_id_label} <span className={'pill ' + v.status}>{v.status}</span></h1>
        <p className="muted">{v.einheit_id_label} · seit {datum(v.beginn)}{v.ende ? ` bis ${datum(v.ende)}` : ''} · {v.mietart}
          {v.personenzahl != null ? ` · ${v.personenzahl} Pers.` : ''}</p>
      </div>
      <div className="kpis">
        <div className="kpi"><span>Kaltmiete aktuell</span><b>{eur(jetzt.kalt)}</b></div>
        <div className="kpi"><span>NK / HK-Vorauszahlung</span><b>{eur(jetzt.nk)} / {eur(jetzt.hk)}</b></div>
        {jetzt.ust > 0 && <div className="kpi"><span>USt {v.ust_satz} %</span><b>{eur(jetzt.ust)}</b></div>}
        <div className="kpi"><span>Gesamt / Monat</span><b>{eur(jetzt.kalt + jetzt.nk + jetzt.hk + jetzt.ust)}</b></div>
        <div className="kpi"><span>Kaution</span><b>{eur(v.kaution ?? 0)}</b></div>
      </div>
      <VertragDokumente vertragId={id} />
      {hinweis && <p className="info">{hinweis}</p>}
      <EntityTable
        title={v.mietart === 'Staffelmiete' ? 'Mietstaffeln und Änderungen' : v.mietart === 'Indexmiete' ? 'Indexanpassungen und Änderungen' : 'Mietänderungen'}
        table="mietanpassungen"
        fields={[
          { key: 'gueltig_ab', label: 'Gültig ab', type: 'date', required: true },
          { key: 'art', label: 'Art', type: 'select', required: true, options: ['Staffel', 'Index', 'Erhöhung', 'Vorauszahlung'] },
          { key: 'kaltmiete', label: 'neue Kaltmiete', type: 'number', format: eur },
          { key: 'nk_vorauszahlung', label: 'neue NK-Vorausz.', type: 'number', format: eur },
          { key: 'hk_vorauszahlung', label: 'neue HK-Vorausz.', type: 'number', format: eur },
          { key: 'indexwert', label: 'Indexwert (VPI)', type: 'number', hideInTable: true },
          { key: 'notiz', label: 'Notiz', type: 'textarea', hideInTable: true },
        ]}
        listSql="SELECT * FROM mietanpassungen WHERE vertrag_id = $1 ORDER BY gueltig_ab"
        listParams={[id]}
        fixed={{ vertrag_id: id }}
        onChange={async () => { const n = await mieteNeuStellen(id); await reload(); setHinweis(n ? `Gespeichert. Offene Posten dieses Vertrags wurden mit den neuen Beträgen neu gestellt (bezahlte bleiben unverändert).` : 'Gespeichert.'); }}
        emptyText="Keine Änderungen. Leere Felder bleiben unverändert. Ab dem Datum fordert das Programm automatisch den neuen Betrag."
      />
    </>
  );
}

/** Mietvertrag und Anlagen hochladen: liegen in der Ablage unter Einheiten/<Nr>/Mietvertrag … */
function VertragDokumente({ vertragId }: { vertragId: number }) {
  const [docs, setDocs] = useState<Row[]>([]);
  const [over, setOver] = useState(false);
  const [info, setInfo] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const [ansicht, setAnsicht] = useState<Row | null>(null);
  const load = () => db.select(`SELECT * FROM dokumente WHERE bezug = 'Mietvertrag' AND bezug_id = $1 ORDER BY hinzugefuegt DESC, id DESC`, [vertragId]).then(setDocs);
  useEffect(() => { load(); }, [vertragId]);
  async function hochladen(files: FileList | File[]) {
    const liste = Array.from(files);
    if (!liste.length) return;
    const ordner = await basisOrdner('Mietvertrag', vertragId);
    for (const f of liste) await speichern(new Uint8Array(await f.arrayBuffer()), f.name, { bezug: 'Mietvertrag', bezugId: vertragId, ordner });
    setInfo(`${liste.length} Datei(en) hinterlegt.`); load();
  }
  async function loeschen(d: Row) {
    if (!confirm(`„${d.dateiname}“ aus der Liste entfernen? Die Datei in der Ablage bleibt erhalten.`)) return;
    await db.execute('DELETE FROM dokumente WHERE id = $1', [d.id]); load();
  }
  return (
    <section className="card">
      <div className="card-head"><h2 className="title-ico"><FileText size={20} />Mietvertrag und Anlagen</h2>
        <button className="primary" onClick={() => ref.current?.click()}><FileUp size={16} />Hochladen</button></div>
      <div className={'drop' + (over ? ' over' : '')} style={{ padding: 14 }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); hochladen(e.dataTransfer.files); }} onClick={() => ref.current?.click()}>
        <p className="muted small" style={{ margin: 0 }}>Mietvertrag, Übergabeprotokoll oder Nachträge hierher ziehen oder klicken (PDF oder Bild)</p>
      </div>
      <input ref={ref} type="file" multiple accept=".pdf,image/*,.doc,.docx" hidden onChange={(e) => { if (e.target.files) hochladen(e.target.files); e.target.value = ''; }} />
      {info && <p className="info">{info}</p>}
      {docs.length > 0 && <table className="list" style={{ marginTop: 10 }}><tbody>
        {docs.map((d) => <tr key={d.id}>
          <td><button className="link" onClick={() => setAnsicht(d)}><Paperclip size={14} /> {d.dateiname}</button></td>
          <td className="muted small">{datum(d.hinzugefuegt)}</td>
          <td style={{ width: 40 }}><button className="icon-btn" title="Aus Liste entfernen" onClick={() => loeschen(d)}><Trash2 size={15} /></button></td></tr>)}
      </tbody></table>}
      {!docs.length && <p className="muted small">Noch kein Vertrag hinterlegt.</p>}
      {ansicht && <DokumentAnsicht docs={[ansicht, ...docs.filter((d) => d.id !== ansicht.id)]} titel="Mietvertrag und Anlagen" onClose={() => setAnsicht(null)} />}
    </section>
  );
}
