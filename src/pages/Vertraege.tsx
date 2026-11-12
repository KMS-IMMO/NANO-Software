import { useEffect, useRef, useState } from 'react';
import { FileText, FileUp, Paperclip, Trash2, IdCard } from 'lucide-react';
import { StammdatenKarte, personFelder, personWerte, personAenderungen, type SGruppe } from '../components/Stammdaten';
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
  { key: 'kaltmiete', label: 'Kaltmiete (Start)', type: 'number', geld: true, format: eur, hideInTable: true },
  { key: 'nk_vorauszahlung', label: 'NK-Vorauszahlung (Start)', type: 'number', geld: true, format: eur, hideInTable: true },
  { key: 'hk_vorauszahlung', label: 'HK-Vorauszahlung (Start)', type: 'number', geld: true, format: eur, hideInTable: true },
  { key: 'ust_satz', label: 'Umsatzsteuer %', type: 'select', options: [{ value: 0, label: 'keine' }, { value: 19, label: '19 %' }, { value: 7, label: '7 %' }], hideInTable: true },
  { key: 'kaution', label: 'Kaution', type: 'number', geld: true, format: eur, hideInTable: true },
  { key: 'personenzahl', label: 'Personen', type: 'number', format: (v) => v ?? '' },
  { key: 'zahlweise', label: 'Zahlweise Miete + NK', type: 'select', hideInTable: true,
    options: [{ value: '', label: 'wie bei der Liegenschaft eingestellt' }, { value: 'zusammen', label: 'zusammen (eine Zahlung)' }, { value: 'getrennt', label: 'getrennt überwiesen' }] },
  { key: 'faellig_tag', label: 'Fällig am (Tag im Monat)', type: 'number', hideInTable: true, format: (v) => v },
  { key: 'index_basis', label: 'Index-Basiswert (VPI)', type: 'number', hideInTable: true },
  { key: 'index_basis_monat', label: 'Index-Basismonat', hideInTable: true },
  { key: 'notiz', label: 'Notiz', type: 'textarea', hideInTable: true },
];

const listSql = (where = '1=1') => `SELECT v.*, o.name || ' – ' || e.nummer AS einheit_id_label, o.miete_zahlweise AS objekt_zahlweise, o.verwaltungsart, ${personLabel('p')} AS mieter_id_label,
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
      rowClass={() => 'zeile-mie'}
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

const V_SPALTEN = ['beginn', 'ende', 'kaltmiete', 'nk_vorauszahlung', 'hk_vorauszahlung', 'kaution', 'personenzahl', 'faellig_tag', 'ust_satz',
  'zahlung_an', 'zahlweise', 'mietart', 'index_basis', 'index_basis_monat', 'notiz'];
const vertragWerte = (v: Row): Row => Object.fromEntries(V_SPALTEN.map((k) => [`v_${k}`, k === 'ust_satz' ? String(Number(v[k]) || 0) : k === 'zahlung_an' ? v[k] || 'Verwaltung' : v[k] ?? null]));

function vertragGruppen(v: Row, wo: string): SGruppe[] {
  const [g1, g2] = personFelder('Mieter', [
    { key: 'm2_vorname', label: '2. Mieter Vorname' },
    { key: 'm2_nachname', label: '2. Mieter Nachname' },
    { key: 'wo', label: 'Hinterlegt bei', breit: 3, anzeige: wo || '–' },
  ]);
  const index = v.mietart === 'Indexmiete';
  return [g1, g2, { titel: 'Mietvertrag', felder: [
    { key: 'v_beginn', label: 'Mietbeginn / Einzug', typ: 'datum', pflicht: true },
    { key: 'v_ende', label: 'Mietende / Auszug', typ: 'datum' },
    { key: 'v_mietart', label: 'Mietart', typ: 'auswahl', optionen: ['Standard', 'Staffelmiete', 'Indexmiete'].map((x) => ({ value: x, label: x })) },
    { key: 'v_kaltmiete', label: 'Kaltmiete / Monat (Start)', typ: 'geld' },
    { key: 'v_nk_vorauszahlung', label: 'NK-Vorauszahlung (Start)', typ: 'geld' },
    { key: 'v_hk_vorauszahlung', label: 'HK-Vorauszahlung (Start)', typ: 'geld' },
    { key: 'v_kaution', label: 'Kaution', typ: 'geld' },
    { key: 'v_personenzahl', label: 'Personen im Haushalt', typ: 'zahl' },
    { key: 'v_faellig_tag', label: 'Fällig am (Tag)', typ: 'zahl' },
    { key: 'v_ust_satz', label: 'Umsatzsteuer', typ: 'auswahl', optionen: [{ value: '0', label: 'keine (Wohnung)' }, { value: '7', label: '7 %' }, { value: '19', label: '19 % (Gewerbe mit Option)' }] },
    { key: 'v_zahlweise', label: 'Zahlweise Miete + NK', typ: 'auswahl', optionen: [
      { value: '', label: `wie Liegenschaft (${v.objekt_zahlweise === 'getrennt' ? 'getrennt' : 'zusammen'})` },
      { value: 'zusammen', label: 'zusammen (eine Zahlung)' }, { value: 'getrennt', label: 'getrennt überwiesen' }] },
    { key: 'v_zahlung_an', label: 'Mieter zahlt an', typ: 'auswahl', optionen: [
      { value: 'Verwaltung', label: 'Verwaltung (Soll-Stellung bei uns)' }, { value: 'Eigentümer', label: 'Eigentümer (vermietete WEG-Einheit)' }] },
    ...(index ? [{ key: 'v_index_basis', label: 'Index-Basiswert (VPI)', typ: 'zahl' as const }, { key: 'v_index_basis_monat', label: 'Index-Basismonat' }] : []),
    { key: 'v_notiz', label: 'Notiz zum Vertrag', typ: 'lang', breit: 3 },
  ] }];
}

/** Speichert geänderte Angaben von Mieter und Vertrag. Ändern sich Beträge oder Zeitraum, werden offene Posten neu gestellt. */
async function vertragSpeichern(v: Row, neu: Row): Promise<string> {
  const p = personAenderungen(neu);
  if ('p_nachname' in neu || 'p_firma' in neu) {
    const alt = (await db.select('SELECT nachname, firma FROM personen WHERE id = $1', [v.mieter_id]))[0] ?? {};
    const nn = 'p_nachname' in neu ? neu.p_nachname : alt.nachname, fi = 'p_firma' in neu ? neu.p_firma : alt.firma;
    if (!nn && !fi) throw new Error('Bitte Nachname oder Firma angeben.');
  }
  const beginn = neu.v_beginn ?? v.beginn, ende = 'v_ende' in neu ? neu.v_ende : v.ende;
  if (ende && ende < beginn) throw new Error('Das Mietende liegt vor dem Mietbeginn.');
  if (p) await db.execute(`UPDATE personen SET ${p.sql} WHERE id = $${p.werte.length + 1}`, [...p.werte, v.mieter_id]);
  // 2. Mieter: ändern, neu anlegen oder (beide Felder leer) vom Vertrag lösen
  if ('m2_vorname' in neu || 'm2_nachname' in neu) {
    const alt = v.mieter2_id ? (await db.select('SELECT vorname, nachname FROM personen WHERE id = $1', [v.mieter2_id]))[0] : null;
    const vn = 'm2_vorname' in neu ? neu.m2_vorname : alt?.vorname ?? null, nn = 'm2_nachname' in neu ? neu.m2_nachname : alt?.nachname ?? null;
    if (!vn && !nn) { if (v.mieter2_id) await db.execute('UPDATE mietvertraege SET mieter2_id = NULL WHERE id = $1', [v.id]); }
    else if (v.mieter2_id) await db.execute('UPDATE personen SET vorname = $1, nachname = $2 WHERE id = $3', [vn, nn, v.mieter2_id]);
    else {
      const r = await db.execute(`INSERT INTO personen (rolle, vorname, nachname, strasse, plz, ort) SELECT 'Mieter', $1, $2, strasse, plz, ort FROM personen WHERE id = $3`, [vn, nn, v.mieter_id]);
      await db.execute('UPDATE mietvertraege SET mieter2_id = $1 WHERE id = $2', [r.lastInsertId, v.id]);
    }
  }
  const vk = Object.keys(neu).filter((k) => k.startsWith('v_') && V_SPALTEN.includes(k.slice(2)));
  if (vk.length) {
    const wert = (k: string) => {
      const x = neu[k];
      if (['v_kaltmiete', 'v_nk_vorauszahlung', 'v_hk_vorauszahlung'].includes(k)) return x ?? 0;
      if (k === 'v_ust_satz') return Number(x) || 0;
      if (k === 'v_faellig_tag') return x == null ? 3 : Math.min(28, Math.max(1, Math.round(Number(x))));
      if (k === 'v_personenzahl') return x == null ? null : Math.max(0, Math.round(Number(x)));
      if (k === 'v_zahlung_an') return x ?? 'Verwaltung';
      if (k === 'v_mietart') return x ?? 'Standard';
      return x;
    };
    await db.execute(`UPDATE mietvertraege SET ${vk.map((k, i) => `${k.slice(2)} = $${i + 1}`).join(', ')} WHERE id = $${vk.length + 1}`, [...vk.map(wert), v.id]);
  }
  const betrifftSoll = ['v_beginn', 'v_ende', 'v_kaltmiete', 'v_nk_vorauszahlung', 'v_hk_vorauszahlung', 'v_ust_satz', 'v_faellig_tag', 'v_zahlung_an'].some((k) => k in neu);
  if (betrifftSoll) {
    const n = await mieteNeuStellen(v.id);
    return n ? `Gespeichert. ${n} offene Posten dieses Vertrags wurden mit den neuen Angaben neu gestellt (bezahlte bleiben unverändert).` : 'Gespeichert.';
  }
  return 'Gespeichert.';
}

export function VertragDetailPage({ vertragId }: { vertragId?: number }) {
  const p = useParams();
  const id = vertragId ?? Number(p.id);
  const fix = useObjektKontext();
  const [v, setV] = useState<Row | null>(null);
  const [anp, setAnp] = useState<Row[]>([]);
  const [hinweis, setHinweis] = useState('');
  const [p1, setP1] = useState<Row | undefined>();
  const [p2, setP2] = useState<Row | undefined>();
  const [wo, setWo] = useState('');
  const reload = async () => {
    const vv = (await db.select(listSql('v.id = $1'), [id]))[0] ?? null;
    setV(vv);
    setAnp(await db.select('SELECT * FROM mietanpassungen WHERE vertrag_id = $1', [id]));
    if (vv) {
      setP1((await db.select('SELECT * FROM personen WHERE id = $1', [vv.mieter_id]))[0]);
      setP2(vv.mieter2_id ? (await db.select('SELECT * FROM personen WHERE id = $1', [vv.mieter2_id]))[0] : undefined);
      setWo((await db.select(`SELECT GROUP_CONCAT(x, '; ') AS wo FROM (
          SELECT o.name || ' ' || e.nummer || ' (Mieter)' AS x FROM mietvertraege m JOIN einheiten e ON e.id = m.einheit_id JOIN objekte o ON o.id = e.objekt_id
            WHERE (m.mieter_id = $1 OR m.mieter2_id = $1) AND (m.ende IS NULL OR m.ende >= date('now'))
          UNION ALL SELECT o.name || ' ' || e.nummer || ' (Eigentümer)' FROM eigentum ei JOIN einheiten e ON e.id = ei.einheit_id JOIN objekte o ON o.id = e.objekt_id
            WHERE ei.person_id = $1 AND (ei.bis IS NULL OR ei.bis >= date('now')))`, [vv.mieter_id]))[0]?.wo ?? '');
    }
  };
  useEffect(() => { reload(); }, [id]);
  if (!v) return <p>Vertrag wird geladen…</p>;
  const jetzt = mieteImMonat(v, anp, new Date().toISOString().slice(0, 7));
  return (
    <>
      <div className="page-head">
        <p className="muted small"><Link to={fix ? `/objekte/${fix.id}/mieter` : '/vertraege'}>{fix ? 'Mieter und Mietverträge' : 'Mietverträge'}</Link> ›</p>
        <h1>{v.mieter_id_label} <span className={'pill ' + v.status}>{v.status}</span></h1>
        <p className="muted">{v.einheit_id_label} · Einzug {datum(v.beginn)}{v.ende ? ` · Auszug ${datum(v.ende)}` : ''} · {v.mietart}
          {v.personenzahl != null ? ` · ${v.personenzahl} Pers.` : ''}</p>
      </div>
      <div className="kpis">
        <div className="kpi"><span>Kaltmiete aktuell</span><b>{eur(jetzt.kalt)}</b></div>
        <div className="kpi"><span>NK / HK-Vorauszahlung</span><b>{eur(jetzt.nk)} / {eur(jetzt.hk)}</b></div>
        {jetzt.ust > 0 && <div className="kpi"><span>USt {v.ust_satz} %</span><b>{eur(jetzt.ust)}</b></div>}
        <div className="kpi"><span>Gesamt / Monat</span><b>{eur(jetzt.kalt + jetzt.nk + jetzt.hk + jetzt.ust)}</b></div>
        <div className="kpi"><span>Kaution</span><b>{eur(v.kaution ?? 0)}</b></div>
      </div>
      <StammdatenKarte rolle="mieter" key={id} titel="Mieter und Mietvertrag" icon={<IdCard size={22} />}
        gruppen={vertragGruppen(v, wo)}
        werte={{ ...personWerte(p1), m2_vorname: p2?.vorname ?? null, m2_nachname: p2?.nachname ?? null, ...vertragWerte(v) }}
        onSpeichern={async (neu) => { const t = await vertragSpeichern(v, neu); await reload(); return t; }}
        pdf={{ titel: 'Stammblatt Mieter', zeilen: [String(v.mieter_id_label ?? ''), `${v.einheit_id_label} · Einzug ${datum(v.beginn)}${v.ende ? ` · Auszug ${datum(v.ende)}` : ''}`],
          datei: `Stammblatt ${v.mieter_id_label} ${v.einheit_id_label}.pdf`,
          vorab: { titel: 'Miete aktuell', felder: [['Kaltmiete', eur(jetzt.kalt)], ['NK / HK-Vorauszahlung', `${eur(jetzt.nk)} / ${eur(jetzt.hk)}`], ...(jetzt.ust > 0 ? [[`USt ${v.ust_satz} %`, eur(jetzt.ust)] as [string, string]] : []), ['Gesamt / Monat', eur(jetzt.kalt + jetzt.nk + jetzt.hk + jetzt.ust)], ['Kaution', eur(v.kaution ?? 0)]] } }} />
      <VertragDokumente vertragId={id} />
      {hinweis && <p className="info">{hinweis}</p>}
      <EntityTable
        title={v.mietart === 'Staffelmiete' ? 'Mietstaffeln und Änderungen' : v.mietart === 'Indexmiete' ? 'Indexanpassungen und Änderungen' : 'Mietänderungen'}
        table="mietanpassungen"
        fields={[
          { key: 'gueltig_ab', label: 'Gültig ab', type: 'date', required: true },
          { key: 'art', label: 'Art', type: 'select', required: true, options: ['Staffel', 'Index', 'Erhöhung', 'Vorauszahlung'] },
          { key: 'kaltmiete', label: 'neue Kaltmiete', type: 'number', geld: true, format: eur },
          { key: 'nk_vorauszahlung', label: 'neue NK-Vorausz.', type: 'number', geld: true, format: eur },
          { key: 'hk_vorauszahlung', label: 'neue HK-Vorausz.', type: 'number', geld: true, format: eur },
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
