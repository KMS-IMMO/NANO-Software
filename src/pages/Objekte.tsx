import { MieterAnlegen } from '../components/MieterAnlegen';
import { useEffect, useMemo, useState } from 'react';
import { BJ } from '../logic/buchung';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BarChart3, CalendarClock, CalendarRange, BookOpen, Building2, ClipboardList, Coins, DoorOpen, FileSignature, FileText, FolderOpen, Gavel, Home, Landmark, Layers, ListChecks, Mail,
  Maximize2, PiggyBank, Scale, Trash2, User, Users, Wallet, Wrench } from 'lucide-react';
import { BeschluesseTab, RuecklagenTab, VorgaengeTab, WirtschaftsplanTab } from './Weg';
import { EntityTable, datum, eur, num, type Field } from '../components/EntityTable';
import { ObjektKontext } from '../logic/objektKontext';
import { ObjektLoeschen } from '../components/ObjektLoeschen';
import { OP_SQL, hausgeldNeuStellen, mieteImMonat } from '../logic/soll';
import { VertragDetailPage, VertraegePage } from './Vertraege';
import { JournalPage, AuswertungPage } from './Buchhaltung';
import { BankPage } from './Bank';
import { OffenePostenPage } from './OffenePosten';
import { SollstellungenPage } from './Sollstellungen';
import { MahnungenPage } from './Mahnungen';
import { NebenkostenPage } from './Nebenkosten';
import { EigentuemerAbrechnungPage, WegAbrechnungPage } from './Jahresabrechnungen';
import { DokumentePage } from './Dokumente';
import { FristenPage } from './Fristen';
import { db, type Row } from '../db';
import { AKTIV, EINHEIT_TYPEN, einheitLabel, SCHLUESSEL, WARMWASSER, personLabel, personOptions, widSql } from '../db/labels';

const adresse = (o: Row) => [o.strasse, [o.plz, o.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
const statusPill = (v: any) => <span className={'pill ' + String(v ?? 'Aktiv').toLowerCase()}>{v ?? 'Aktiv'}</span>;

const objektFields: Field[] = [
  { key: 'objekt_nr', label: 'ID', format: (v) => <b>H-ID {v}</b> },
  { key: 'name', label: 'Liegenschaft (Adresse)', required: true, format: (v, r) => (
    <div className="idcell"><div className="thumb-s"><Building2 size={22} /></div><div><b>{v}</b><div className="muted small">{adresse(r)}</div></div></div>) },
  { key: 'verwaltungsart', label: 'Typ', type: 'select', options: ['WEG', 'Mietverwaltung'], required: true },
  { key: 'status', label: 'Status', type: 'select', options: ['Aktiv', 'In Übernahme', 'Inaktiv'], format: statusPill },
  { key: 'strasse', label: 'Straße', hideInTable: true },
  { key: 'plz', label: 'PLZ', hideInTable: true },
  { key: 'ort', label: 'Ort', hideInTable: true },
  { key: 'baujahr', label: 'Baujahr', type: 'number', format: (v) => v ?? '', hideInTable: true },
  { key: 'gesamt_mea', label: 'MEA gesamt', type: 'number', format: (v) => num(v, 0), hideInTable: true },
  { key: 'gesamt_flaeche', label: 'Gesamtfläche (m²)', type: 'number', hideInTable: true },
  { key: 'heizungsart', label: 'Heizungsart', type: 'select', hideInTable: true,
    options: ['Gas-Zentralheizung', 'Öl-Zentralheizung', 'Fernwärme', 'Wärmepumpe', 'Pellets', 'Gasetagenheizung', 'Nachtspeicher', 'Sonstige'] },
  { key: 'warmwasser', label: 'Warmwasserversorgung', type: 'select', hideInTable: true, options: WARMWASSER },
  { key: 'miete_zahlweise', label: 'Mieter zahlen Miete und Nebenkosten (Standard, je Mietvertrag änderbar)', type: 'select', hideInTable: true, wide: true,
    options: [{ value: 'zusammen', label: 'zusammen in einer Überweisung' }, { value: 'getrennt', label: 'getrennt in einzelnen Überweisungen' }] },
  { key: 'eigentuemer_id', label: 'Eigentümer (nur Mietverwaltung)', type: 'select', optionsSql: personOptions('Eigentümer'), hideInTable: true, wide: true },
  { key: 'notiz', label: 'Notiz', type: 'textarea', hideInTable: true },
];

export function ObjektePage() {
  const nav = useNavigate();
  const [loeschen, setLoeschen] = useState<Row | null>(null);
  const [info, setInfo] = useState('');
  const [version, setVersion] = useState(0);
  return (
    <>
    {info && <p className="info">{info}</p>}
    {loeschen && <ObjektLoeschen objekt={{ id: loeschen.id, name: loeschen.name }} onClose={() => setLoeschen(null)}
      onDone={(t) => { setLoeschen(null); setInfo(t); setVersion(version + 1); }} />}
    <EntityTable
      version={version}
      onDelete={setLoeschen}
      title="Liegenschaften"
      icon={<Building2 size={24} />}
      newLabel="Liegenschaft hinzufügen"
      onNew={() => nav('/objekte/neu')}
      table="objekte"
      fields={[...objektFields.slice(0, 2), { key: 'einheiten', label: 'Einheiten', type: 'number', computed: true, format: (v) => num(v, 0), sum: true }, ...objektFields.slice(2)]}
      listSql={`SELECT o.*, (SELECT COUNT(*) FROM einheiten e WHERE e.objekt_id = o.id) AS einheiten
                FROM objekte o ORDER BY o.objekt_nr, o.name`}
      onOpen={(r) => nav(`/objekte/${r.id}`)}
      emptyText="Noch keine Liegenschaften. Lege mit „Liegenschaft hinzufügen“ dein erstes Haus oder deine erste WEG an."
    />
    </>
  );
}

type Punkt = { slug: string; label: string; icon: any };
type Ebene = { titel: string; punkte: (Punkt | false)[] };
/** Alle Ebenen der Liegenschaft für die eigene linke Spalte */
const ebenen = (weg: boolean): Ebene[] => [
  { titel: 'Übersicht', punkte: [{ slug: '', label: 'Übersicht & Einheiten', icon: Home }] },
  { titel: 'Personen', punkte: [
    weg && { slug: 'eigentuemer', label: 'Eigentümer', icon: Users },
    { slug: 'mieter', label: weg ? 'Mieter vermieteter Einheiten' : 'Mieter & Mietverträge', icon: User }] },
  { titel: 'Finanzen', punkte: [
    { slug: 'sollstellungen', label: 'Sollstellungen', icon: CalendarRange },
    { slug: 'buchungen', label: 'Einnahmen & Ausgaben', icon: BookOpen },
    { slug: 'offene-posten', label: 'Offene Posten', icon: ListChecks },
    { slug: 'mahnungen', label: 'Mahnungen', icon: Mail },
    { slug: 'auswertung', label: 'Auswertung (GuV)', icon: BarChart3 },
    { slug: 'bank', label: 'Bank & Zuordnung', icon: Landmark }] },
  { titel: weg ? 'Hausgeld & Vorauszahlungen' : 'Miete & Vorauszahlungen', punkte: [
    weg && { slug: 'hausgeld', label: 'Hausgeld anpassen', icon: Wallet },
    { slug: 'vorauszahlungen', label: weg ? 'NK-Vorauszahlungen Mieter' : 'Miete & NK-Vorauszahlungen', icon: Coins },
    weg && { slug: 'wirtschaftsplan', label: 'Wirtschaftsplan', icon: ClipboardList },
    weg && { slug: 'ruecklagen', label: 'Rücklagen', icon: PiggyBank }] },
  { titel: 'Abrechnungen', punkte: [
    weg && { slug: 'hausgeldabrechnung', label: 'Hausgeldabrechnung', icon: FileText },
    { slug: 'nebenkosten', label: 'Nebenkostenabrechnung', icon: FileText },
    !weg && { slug: 'eigentuemerabrechnung', label: 'Eigentümerabrechnung', icon: FileText }] },
  { titel: 'Verwaltung', punkte: [
    weg && { slug: 'beschluesse', label: 'Beschlüsse', icon: FileSignature },
    { slug: 'instandhaltung', label: 'Instandhaltung', icon: Wrench },
    { slug: 'fristen', label: 'Fristen', icon: CalendarClock },
    weg && { slug: 'beirat', label: 'Verwaltungsbeirat', icon: Gavel },
    { slug: 'schluessel', label: 'Umlageschlüssel', icon: Scale },
    { slug: 'dokumente', label: 'Dokumente', icon: FolderOpen }] },
];

export function ObjektDetailPage() {
  const params = useParams();
  const id = Number(params.id);
  const rest = (params['*'] ?? '').split('/');
  const slug = rest[0] ?? '';
  const nav = useNavigate();
  const [o, setO] = useState<Row | null>(null);
  const [alle, setAlle] = useState<Row[]>([]);
  const [sum, setSum] = useState<Row>({});
  const [loeschen, setLoeschen] = useState(false);
  const reload = async () => {
    setO((await db.select(`SELECT o.*, ${personLabel('p')} AS eigentuemer, p.telefon, p.email
      FROM objekte o LEFT JOIN personen p ON p.id = o.eigentuemer_id WHERE o.id = $1`, [id]))[0] ?? null);
    setSum((await db.select(`SELECT COUNT(*) n, SUM(flaeche) fl, SUM(mea) mea,
        SUM(COALESCE((SELECT v.personenzahl FROM mietvertraege v WHERE v.einheit_id = e.id AND ${AKTIV()} LIMIT 1), e.personenzahl, 0)) pers
      FROM einheiten e WHERE objekt_id = $1`, [id]))[0]);
  };
  useEffect(() => { reload(); }, [id]);
  useEffect(() => { db.select('SELECT id, name, verwaltungsart FROM objekte ORDER BY name').then(setAlle); }, []);
  const weg = o?.verwaltungsart === 'WEG';
  const punkte = useMemo(() => ebenen(weg).flatMap((e) => e.punkte.filter(Boolean) as Punkt[]), [weg]);
  if (!o) return <p>Liegenschaft wird geladen…</p>;
  const aktuell = punkte.find((p) => p.slug === slug) ?? (slug === 'vertrag' ? punkte.find((p) => p.slug === 'mieter') : undefined);
  const wechseln = (neu: number) => {
    const art = alle.find((x) => x.id === neu)?.verwaltungsart;
    nav(`/objekte/${neu}${ebenen(art === 'WEG').some((e) => e.punkte.some((p) => p && p.slug === slug)) && slug !== 'vertrag' ? (slug ? '/' + slug : '') : ''}`);
  };

  return (
    <ObjektKontext.Provider value={{ id, name: o.name, weg }}>
      <div className="obereich">
        <aside className="oside">
          <Link to="/objekte" className="oside-zurueck"><ArrowLeft size={15} />Alle Liegenschaften</Link>
          <div className="oside-kopf">
            <div className="oside-thumb"><Building2 size={22} /></div>
            <div><b>{o.name}</b><span>{weg ? 'WEG' : 'Mietverwaltung'} · {sum.n ?? 0} Einheiten</span></div>
          </div>
          {alle.length > 1 && <select className="oside-wechsel" value={id} onChange={(e) => wechseln(Number(e.target.value))} title="Andere Liegenschaft öffnen">
            {alle.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
          <nav>
            {ebenen(weg).map((e) => (
              <div key={e.titel} className="oside-ebene">
                <div className="oside-titel">{e.titel}</div>
                {(e.punkte.filter(Boolean) as Punkt[]).map((p) => (
                  <Link key={p.slug} to={`/objekte/${id}${p.slug ? '/' + p.slug : ''}`} className={'oside-punkt' + (aktuell?.slug === p.slug ? ' on' : '')}>
                    <p.icon size={16} />{p.label}</Link>))}
              </div>))}
          </nav>
          <button className="oside-loeschen" onClick={() => setLoeschen(true)}><Trash2 size={15} />Liegenschaft löschen</button>
        </aside>
        {loeschen && <ObjektLoeschen objekt={{ id, name: o.name }} onClose={() => setLoeschen(false)} onDone={() => nav('/objekte')} />}
        <div className="obody" key={`${id}-${slug ?? ""}`}>
          <div className="crumbs"><Link to="/">Dashboard</Link> › <Link to="/objekte">Liegenschaften</Link> › {slug ? <><Link to={`/objekte/${id}`}>{o.name}</Link> › <span>{aktuell?.label ?? ''}</span></> : <span>{o.name}</span>}</div>
          <Bereich slug={slug} rest={rest} o={o} sum={sum} weg={weg} reload={reload} />
        </div>
      </div>
    </ObjektKontext.Provider>
  );
}

function Bereich({ slug, rest, o, sum, weg, reload }: { slug: string; rest: string[]; o: Row; sum: Row; weg: boolean; reload: () => void }) {
  const id = Number(o.id);
  switch (slug) {
    case '': return <><ObjektKopf o={o} sum={sum} weg={weg} /><Kennzahlen objektId={id} weg={weg} /><EinheitenTab objektId={id} weg={weg} onChange={reload} /></>;
    case 'eigentuemer': return <EigentuemerTab objektId={id} />;
    case 'mieter': return <VertraegePage />;
    case 'vertrag': return <VertragDetailPage vertragId={Number(rest[1])} />;
    case 'buchungen': return <JournalPage />;
    case 'bank': return <BankPage />;
    case 'offene-posten': return <OffenePostenPage />;
    case 'sollstellungen': return <SollstellungenPage />;
    case 'rechnungen': return <JournalPage />;
    case 'mahnungen': return <MahnungenPage />;
    case 'auswertung': return <AuswertungPage />;
    case 'hausgeld': return <EigentuemerTab objektId={id} nurHausgeld />;
    case 'vorauszahlungen': return <VorauszahlungenTab objektId={id} weg={weg} />;
    case 'wirtschaftsplan': return <WirtschaftsplanTab objektId={id} />;
    case 'ruecklagen': return <RuecklagenTab objektId={id} />;
    case 'hausgeldabrechnung': return <WegAbrechnungPage />;
    case 'nebenkosten': return <NebenkostenPage />;
    case 'eigentuemerabrechnung': return <EigentuemerAbrechnungPage />;
    case 'beschluesse': return <BeschluesseTab objektId={id} />;
    case 'instandhaltung': return <VorgaengeTab objektId={id} />;
    case 'beirat': return <BeiratTab objektId={id} />;
    case 'schluessel': return <SchluesselTab objektId={id} weg={weg} />;
    case 'dokumente': return <DokumentePage />;
    case 'fristen': return <FristenPage />;
    default: return <p className="muted">Diese Seite gibt es nicht.</p>;
  }
}

function ObjektKopf({ o, sum, weg }: { o: Row; sum: Row; weg: boolean }) {
  const meaWarn = o.gesamt_mea && sum.mea && Math.abs(o.gesamt_mea - sum.mea) > 0.001;
  return (
    <>
      <section className="card objhead">
        <div className="thumb"><Building2 size={44} /></div>
        <div>
          <h2 style={{ fontSize: 22 }}>{o.name}</h2>
          <div className="muted">{adresse(o)}</div>
          <div className="row" style={{ marginTop: 8 }}>
            <span className="badge"><Users size={14} />{weg ? 'WEG (Wohnungseigentum)' : 'Mietverwaltung'}</span>
            <span className="muted small">H-ID {o.objekt_nr}{o.baujahr ? ` · Baujahr ${o.baujahr}` : ''}{o.heizungsart ? ` · ${o.heizungsart}` : ''}</span>
          </div>
          {!weg && o.eigentuemer && <div className="small" style={{ marginTop: 6 }}>Eigentümer: <b>{o.eigentuemer}</b> {[o.telefon, o.email].filter(Boolean).join(' · ')}</div>}
        </div>
        <div className="stats">
          <div className="stat"><Building2 size={30} strokeWidth={1.5} /><div><b>{sum.n ?? 0}</b><span>Einheiten</span></div></div>
          <div className="stat"><Layers size={30} strokeWidth={1.5} /><div><b>{num(sum.mea, 0)}{o.gesamt_mea ? <small className="muted"> / {num(o.gesamt_mea, 0)}</small> : ''}</b><span>Gesamt-MEA</span></div></div>
          <div className="stat"><Maximize2 size={30} strokeWidth={1.5} /><div><b>{num(sum.fl)} m²</b><span>Gesamtfläche</span></div></div>
          <div className="stat"><Users size={30} strokeWidth={1.5} /><div><b>{num(sum.pers, 0)}</b><span>Personen</span></div></div>
        </div>
      </section>
      {meaWarn && <p className="warn">Die Summe der MEA der Einheiten ({num(sum.mea, 0)}) weicht vom MEA gesamt der Liegenschaft ({num(o.gesamt_mea, 0)}) ab.</p>}
    </>
  );
}

/** Kennzahlen des laufenden Jahres und die letzten Buchungen */
function Kennzahlen({ objektId, weg }: { objektId: number; weg: boolean }) {
  const [k, setK] = useState<Row>({});
  const [letzte, setLetzte] = useState<Row[]>([]);
  const jahr = String(new Date().getFullYear());
  useEffect(() => {
    (async () => {
      const b = (await db.select(`SELECT COALESCE(SUM(CASE WHEN betrag > 0 THEN betrag END), 0) AS ein, COALESCE(-SUM(CASE WHEN betrag < 0 THEN betrag END), 0) AS aus
        FROM buchungen WHERE objekt_id = $1 AND ${BJ('')} = CAST($2 AS INTEGER)`, [objektId, jahr]))[0] ?? {};
      const op = (await db.select(`SELECT COALESCE(SUM(betrag - bezahlt), 0) AS offen, COUNT(*) AS n FROM (${OP_SQL}) WHERE objekt_id = $1 AND betrag - bezahlt > 0.005 AND faellig < date('now')`, [objektId]))[0] ?? {};
      const bank = (await db.select(`SELECT COALESCE(SUM(b.anfangssaldo + COALESCE((SELECT SUM(u.betrag) FROM bankumsaetze u WHERE u.bankkonto_id = b.id
        AND (b.saldo_datum IS NULL OR u.datum > b.saldo_datum)), 0)), 0) AS saldo, COUNT(*) AS n FROM bankkonten b WHERE b.objekt_id = $1`, [objektId]))[0] ?? {};
      setK({ ...b, offen: op.offen, offen_n: op.n, saldo: bank.saldo, konten: bank.n });
      setLetzte((await db.select(`SELECT b.*, k.nummer, k.name AS konto, e.nummer AS einheit FROM buchungen b LEFT JOIN buchungskonten k ON k.id = b.buchungskonto_id
        LEFT JOIN einheiten e ON e.id = b.einheit_id WHERE b.objekt_id = $1 ORDER BY b.datum DESC, b.id DESC LIMIT 6`, [objektId])).reverse());
    })();
  }, [objektId]);
  return (
    <>
      <div className="kpis">
        <div className="kpi"><span>Einnahmen {jahr}</span><b>{eur(k.ein ?? 0)}</b></div>
        <div className="kpi"><span>Ausgaben {jahr}</span><b className="neg">{eur(k.aus ?? 0)}</b></div>
        <div className="kpi"><span>Überfällig</span><b className={k.offen > 0.005 ? 'neg' : ''}>{eur(k.offen ?? 0)}</b><small>{k.offen_n ?? 0} Posten {weg ? '(Hausgeld)' : '(Miete)'}</small></div>
        <div className="kpi"><span>Kontostand</span><b>{eur(k.saldo ?? 0)}</b><small>{k.konten ?? 0} Bankkonten</small></div>
      </div>
      {letzte.length > 0 && (
        <section className="card">
          <div className="card-head"><h2 className="title-ico"><BookOpen size={20} />Letzte Buchungen</h2><Link to={`/objekte/${objektId}/buchungen`}>Alle Einnahmen & Ausgaben →</Link></div>
          <table className="list"><tbody>{letzte.map((r) => (
            <tr key={r.id}><td>{datum(r.datum)}</td><td>{r.nummer ? `${r.nummer} ${r.konto}` : '–'}<div className="muted small">{r.einheit ?? (r.betrag < 0 ? 'alle Einheiten' : '')}</div></td>
              <td className="small">{r.text}</td><td className={'num ' + (r.betrag < 0 ? 'neg' : '')}>{eur(r.betrag)}</td></tr>))}</tbody></table>
        </section>)}
    </>
  );
}

/** Aktuelle Miete und Vorauszahlungen je Vertrag; Anpassen öffnet den Vertrag mit seinen Mietänderungen */
function VorauszahlungenTab({ objektId, weg }: { objektId: number; weg: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const nav = useNavigate();
  useEffect(() => {
    (async () => {
      const v = await db.select(`SELECT v.*, e.nummer AS einheit, ${personLabel('p')} AS mieter FROM mietvertraege v JOIN einheiten e ON e.id = v.einheit_id
        JOIN personen p ON p.id = v.mieter_id WHERE e.objekt_id = $1 AND ${AKTIV()} ORDER BY e.lfd_nr, e.nummer`, [objektId]);
      const a = await db.select(`SELECT a.* FROM mietanpassungen a JOIN mietvertraege v ON v.id = a.vertrag_id JOIN einheiten e ON e.id = v.einheit_id WHERE e.objekt_id = $1`, [objektId]);
      const m = new Date().toISOString().slice(0, 7);
      setRows(v.map((x) => ({ ...x, jetzt: mieteImMonat(x, a.filter((y) => y.vertrag_id === x.id), m) })));
    })();
  }, [objektId]);
  const s = (f: (r: Row) => number) => rows.reduce((a, r) => a + f(r), 0);
  return (
    <section className="card">
      <div className="card-head"><h2 className="title-ico"><Coins size={22} />{weg ? 'NK-Vorauszahlungen der Mieter' : 'Miete & Vorauszahlungen'}</h2></div>
      {rows.length === 0 ? <p className="muted">Keine aktiven Mietverträge. Lege sie unter „{weg ? 'Mieter vermieteter Einheiten' : 'Mieter & Mietverträge'}“ an.</p> : (
        <div className="tablewrap"><table className="list">
          <thead><tr><th>Einheit</th><th>Mieter</th>{!weg && <th className="num">Kaltmiete</th>}<th className="num">NK-Vorauszahlung</th><th className="num">HK-Vorauszahlung</th>{!weg && <th className="num">Gesamt</th>}<th>Zahlt an</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td><b>{r.einheit}</b></td><td>{r.mieter}</td>{!weg && <td className="num">{eur(r.jetzt.kalt)}</td>}
              <td className="num">{eur(r.jetzt.nk)}</td><td className="num">{eur(r.jetzt.hk)}</td>{!weg && <td className="num">{eur(r.jetzt.kalt + r.jetzt.nk + r.jetzt.hk + r.jetzt.ust)}</td>}
              <td>{r.zahlung_an ?? 'Verwaltung'}</td>
              <td className="actions"><button className="link" onClick={() => nav(`/objekte/${objektId}/vertrag/${r.id}`)}>Anpassen</button></td></tr>))}</tbody>
          <tfoot><tr><td colSpan={2}>Summe / Monat</td>{!weg && <td className="num">{eur(s((r) => r.jetzt.kalt))}</td>}<td className="num">{eur(s((r) => r.jetzt.nk))}</td>
            <td className="num">{eur(s((r) => r.jetzt.hk))}</td>{!weg && <td className="num">{eur(s((r) => r.jetzt.kalt + r.jetzt.nk + r.jetzt.hk + r.jetzt.ust))}</td>}<td colSpan={2} /></tr></tfoot>
        </table></div>)}
      <p className="muted small">Mit „Anpassen“ trägst du eine neue Vorauszahlung oder Miete mit Datum ein. Ab dann fordert das Programm automatisch den neuen Betrag.</p>
    </section>
  );
}

function EinheitenTab({ objektId, weg, onChange }: { objektId: number; weg: boolean; onChange: () => void }) {
  const jahr = new Date().getFullYear();
  const nav = useNavigate();
  const [objekt, setObjekt] = useState<Row | null>(null);
  const [neuFuer, setNeuFuer] = useState<Row | null>(null);
  const [version, setVersion] = useState(0);
  const [hinweis, setHinweis] = useState<{ text: string; vertrag: number } | null>(null);
  useEffect(() => { db.select('SELECT * FROM objekte WHERE id = $1', [objektId]).then((r) => setObjekt(r[0] ?? null)); }, [objektId]);
  // Klick auf die Einheit: ohne laufenden Mietvertrag das Fenster „Mieter anlegen“, sonst den Mietvertrag öffnen. Der Stift bearbeitet die Wohnungsdaten.
  const oeffnen = async (r: Row) => {
    const v = (await db.select(`SELECT id FROM mietvertraege WHERE einheit_id = $1 AND (ende IS NULL OR ende >= date('now')) ORDER BY beginn DESC LIMIT 1`, [r.id]))[0];
    if (v) nav(`/objekte/${objektId}/vertrag/${v.id}`); else setNeuFuer(r);
  };
  const status = (_: any, r: Row) => (Number(r.soll) || 0) === 0 ? <span className="muted">–</span>
    : r.saldo > 0.005 ? <span className={'pill ' + (r.ist > 0.005 ? 'teil' : 'offen')}>{r.ist > 0.005 ? 'Teilweise' : 'Offen'}</span> : <span className="pill bezahlt">Bezahlt</span>;
  return (
    <>
    <EntityTable
      title={`Einheiten (${weg ? 'WEG' : 'Miete'}) · Zahlungen ${jahr}`}
      icon={<DoorOpen size={22} />}
      newLabel="Einheit hinzufügen"
      table="einheiten"
      fields={[
        { key: 'wid', label: 'W-ID', computed: true, format: (v: any) => <b className="nowrap">{v}</b> },
        { key: 'nummer', label: 'Nr.', required: true, format: (v) => <b>{v}</b> },
        { key: 'typ', label: 'Bezeichnung', type: 'select', options: EINHEIT_TYPEN, required: true },
        { key: 'nutzung', label: 'Nutzung', computed: true, format: (v: any) => v === 'Miete' ? <span className="pill künftig">Miete</span>
            : v === 'Leerstand' ? <span className="pill offen">Leerstand</span> : <span className="badge">Eigentum</span> },
        { key: 'lage', label: 'Etage / Lage' },
        { key: 'flaeche', label: 'Fläche (m²)', type: 'number', sum: true },
        { key: 'mea', label: 'MEA', type: 'number', format: (v) => num(v, 0), sum: true },
        { key: 'personenzahl', label: 'Personenzahl (ohne Mietvertrag)', type: 'number', hideInTable: true },
        { key: 'personen', label: 'Personen', type: 'number', computed: true, format: (v) => num(v, 0), sum: true },
        { key: 'notiz', label: 'Notiz', type: 'textarea', hideInTable: true },
        ...(weg ? [{ key: 'eigentuemer', label: 'Eigentümer', computed: true, format: (v: any) => v ?? '–' },
          { key: 'eig_telefon', label: 'Telefon', computed: true, format: (v: any) => v || '–' },
          { key: 'eig_email', label: 'E-Mail', computed: true, format: (v: any) => v ? <a href={`mailto:${v}`}>{v}</a> : '–' }] : []),
        { key: 'mieter', label: 'Mieter (aktuell)', computed: true, format: (v: any) => v ?? <span className="muted">–</span> },
        { key: 'monat', label: weg ? 'Hausgeld (Soll) / Monat' : 'Miete warm / Monat', type: 'number', computed: true, format: eur, sum: true },
        ...(weg ? [{ key: 'nk_vz', label: 'NK-VZ Mieter / Monat', type: 'number', computed: true, format: (v: any) => v != null ? eur(v) : '–', sum: true }] : []),
        { key: 'ist', label: `Zahlungseingang ${jahr}`, type: 'number', computed: true, format: eur, sum: true },
        { key: 'saldo', label: 'Offener Saldo', type: 'number', computed: true, sum: true,
          format: (v: any) => <span className={v > 0.005 ? 'neg' : ''}>{eur(v ?? 0)}</span> },
        { key: 'status', label: 'Status', computed: true, format: status },
      ] as Field[]}
      listSql={`SELECT x.*, x.soll - x.ist AS saldo FROM (SELECT e.*,
          ((SELECT o.objekt_nr FROM objekte o WHERE o.id = e.objekt_id) || '-' || substr('00' || COALESCE(e.lfd_nr, 0), -2, 2)) AS wid,
          (SELECT GROUP_CONCAT(${personLabel('p')}, '; ') FROM eigentum ei JOIN personen p ON p.id = ei.person_id
             WHERE ei.einheit_id = e.id AND (ei.bis IS NULL OR ei.bis >= date('now'))) AS eigentuemer,
          (SELECT GROUP_CONCAT(p.telefon, '; ') FROM eigentum ei JOIN personen p ON p.id = ei.person_id
             WHERE ei.einheit_id = e.id AND (ei.bis IS NULL OR ei.bis >= date('now')) AND p.telefon IS NOT NULL) AS eig_telefon,
          (SELECT GROUP_CONCAT(p.email, '; ') FROM eigentum ei JOIN personen p ON p.id = ei.person_id
             WHERE ei.einheit_id = e.id AND (ei.bis IS NULL OR ei.bis >= date('now')) AND p.email IS NOT NULL) AS eig_email,
          (SELECT ${personLabel('p')} FROM mietvertraege v JOIN personen p ON p.id = v.mieter_id WHERE v.einheit_id = e.id AND ${AKTIV()} LIMIT 1) AS mieter,
          (SELECT v.nk_vorauszahlung + v.hk_vorauszahlung FROM mietvertraege v WHERE v.einheit_id = e.id AND ${AKTIV()} LIMIT 1) AS nk_vz,
          CASE WHEN EXISTS (SELECT 1 FROM mietvertraege v WHERE v.einheit_id = e.id AND ${AKTIV()}) THEN 'Miete'
               WHEN ${weg ? 1 : 0} = 1 THEN 'Eigentum' ELSE 'Leerstand' END AS nutzung,
          COALESCE((SELECT v.personenzahl FROM mietvertraege v WHERE v.einheit_id = e.id AND ${AKTIV()} LIMIT 1), e.personenzahl) AS personen,
          ${weg
            ? `(SELECT h.betrag FROM hausgeld h WHERE h.einheit_id = e.id AND h.gueltig_ab <= date('now') ORDER BY h.gueltig_ab DESC LIMIT 1)`
            : `(SELECT v.kaltmiete + v.nk_vorauszahlung + v.hk_vorauszahlung FROM mietvertraege v WHERE v.einheit_id = e.id AND ${AKTIV()} LIMIT 1)`} AS monat,
          COALESCE((SELECT SUM(s.betrag) FROM sollstellungen s WHERE s.einheit_id = e.id AND substr(s.monat, 1, 4) = '${jahr}'
             AND s.faellig <= date('now') AND s.art IN (${weg ? `'Hausgeld', 'Rücklage'` : `'Kaltmiete', 'NK', 'HK', 'USt'`})), 0) AS soll,
          COALESCE((SELECT SUM(b.betrag) FROM buchungen b JOIN sollstellungen s ON s.id = b.sollstellung_id WHERE s.einheit_id = e.id
             AND substr(s.monat, 1, 4) = '${jahr}' AND s.faellig <= date('now') AND s.art IN (${weg ? `'Hausgeld', 'Rücklage'` : `'Kaltmiete', 'NK', 'HK', 'USt'`})), 0) AS ist
        FROM einheiten e WHERE e.objekt_id = $1) x ORDER BY x.lfd_nr, x.nummer`}
      listParams={[objektId]}
      fixed={{ objekt_id: objektId }}
      onChange={onChange}
      onOpen={oeffnen}
      version={version}
    />
    <p className="muted small">Klick auf eine Einheit ohne Mieter öffnet „Mieter anlegen“, bei vermieteten Einheiten den Mietvertrag. Mit dem Stift rechts änderst du die Daten der Wohnung.</p>
    {hinweis && <p className="tab-hinweis">{hinweis.text} <button className="link" onClick={() => nav(`/objekte/${objektId}/vertrag/${hinweis.vertrag}`)}>Mietvertrag öffnen (PDF hinterlegen)</button></p>}
    {neuFuer && objekt && <MieterAnlegen einheit={neuFuer} objekt={objekt} onClose={() => setNeuFuer(null)}
      onSaved={(vid, text) => { setNeuFuer(null); setHinweis({ text, vertrag: vid }); setVersion((x) => x + 1); onChange(); }} />}
    </>
  );
}

const einheitOptions = (objektId: number) => `SELECT e.id AS value, ${einheitLabel('e')} AS label FROM einheiten e WHERE e.objekt_id = ${objektId} ORDER BY e.lfd_nr, e.nummer`;

const ZAHLWEISE: Record<string, string> = { zusammen: 'Hausgeld und Rücklage in einer Summe', getrennt: 'Hausgeld und Rücklage getrennt' };
const zahlStr = (n: number) => (n ? n.toFixed(2).replace('.', ',') : '');
const zahlIn = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.')) || 0;

/** Eigentümer je Einheit mit Hausgeld, Erhaltungsrücklage und Zahlweise (eine Überweisung oder zwei getrennte) */
function EigentuemerTab({ objektId, nurHausgeld }: { objektId: number; nurHausgeld?: boolean }) {
  const [standard, setStandard] = useState('zusammen');
  const [rows, setRows] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Record<number, { bew: string; rl: string; zw: string }>>({});
  const [ab, setAb] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; });
  const [info, setInfo] = useState('');
  const [version, setVersion] = useState(0);
  const load = async () => {
    setStandard((await db.select('SELECT ruecklage_zahlweise FROM objekte WHERE id = $1', [objektId]))[0]?.ruecklage_zahlweise ?? 'zusammen');
    const r = await db.select(`SELECT e.id AS einheit_id, e.nummer, ${widSql('e', 'o')} AS wid, ei.id AS eigentum_id, ei.zahlweise, ${personLabel('p')} AS eigentuemer,
        h.betrag AS hausgeld, COALESCE(h.davon_ruecklage, 0) AS ruecklage, h.gueltig_ab
      FROM einheiten e JOIN objekte o ON o.id = e.objekt_id
      LEFT JOIN eigentum ei ON ei.id = (SELECT x.id FROM eigentum x WHERE x.einheit_id = e.id AND (x.bis IS NULL OR x.bis >= date('now')) ORDER BY x.anteil DESC LIMIT 1)
      LEFT JOIN personen p ON p.id = ei.person_id
      LEFT JOIN hausgeld h ON h.id = (SELECT y.id FROM hausgeld y WHERE y.einheit_id = e.id AND y.gueltig_ab <= $2 ORDER BY y.gueltig_ab DESC LIMIT 1)
      WHERE e.objekt_id = $1 ORDER BY e.lfd_nr, e.nummer`, [objektId, ab]);
    setRows(r);
    setEdit(Object.fromEntries(r.map((x) => [x.einheit_id, { bew: zahlStr((Number(x.hausgeld) || 0) - Number(x.ruecklage)), rl: zahlStr(Number(x.ruecklage)), zw: x.zahlweise ?? '' }])));
  };
  useEffect(() => { load(); }, [objektId, ab]);

  async function standardSetzen(z: string) {
    await db.execute('UPDATE objekte SET ruecklage_zahlweise = $1 WHERE id = $2', [z, objektId]);
    const n = await hausgeldNeuStellen(objektId, ab.slice(0, 7));
    setInfo(`Zahlweise der Liegenschaft: ${ZAHLWEISE[z]}.${n ? ` ${n} offene Hausgeld-Posten ab ${datum(ab)} neu gestellt.` : ''}`); load();
  }

  async function speichern() {
    let geaendert = 0;
    for (const r of rows) {
      const e = edit[r.einheit_id]; if (!e) continue;
      const bew = zahlIn(e.bew), rl = zahlIn(e.rl), gesamt = Math.round((bew + rl) * 100) / 100;
      if (Math.abs(gesamt - (Number(r.hausgeld) || 0)) > 0.005 || Math.abs(rl - Number(r.ruecklage)) > 0.005) {
        const vorhanden = (await db.select('SELECT id FROM hausgeld WHERE einheit_id = $1 AND gueltig_ab = $2', [r.einheit_id, ab]))[0];
        if (vorhanden) await db.execute('UPDATE hausgeld SET betrag = $1, davon_ruecklage = $2 WHERE id = $3', [gesamt, rl, vorhanden.id]);
        else await db.execute('INSERT INTO hausgeld (einheit_id, gueltig_ab, betrag, davon_ruecklage) VALUES ($1, $2, $3, $4)', [r.einheit_id, ab, gesamt, rl]);
        geaendert++;
      }
      if (r.eigentum_id && (e.zw || null) !== (r.zahlweise || null)) {
        await db.execute('UPDATE eigentum SET zahlweise = $1 WHERE id = $2', [e.zw || null, r.eigentum_id]); geaendert++;
      }
    }
    if (!geaendert) { setInfo('Keine Änderungen.'); return; }
    const n = await hausgeldNeuStellen(objektId, ab.slice(0, 7));
    setInfo(`Gespeichert. Gilt ab ${datum(ab)}.${n ? ` ${n} offene Hausgeld-Posten neu gestellt (bereits bezahlte bleiben unverändert).` : ''}`);
    load(); setVersion(version + 1);
  }

  const effektiv = (zw: string) => zw || standard;
  return (
    <>
      <section className="card">
        <div className="card-head"><h2 className="title-ico"><PiggyBank size={22} />Hausgeld und Erhaltungsrücklage je Eigentümer</h2></div>
        <div className="row">
          <span>Zahlweise in dieser Liegenschaft:</span>
          <div className="seg">{Object.entries(ZAHLWEISE).map(([k, t]) => <button key={k} className={standard === k ? 'on' : ''} onClick={() => standardSetzen(k)}>{t}</button>)}</div>
        </div>
        <p className="muted small">Bei „getrennt“ entstehen jeden Monat zwei offene Posten (Hausgeld und Rücklage), damit zwei Überweisungen sauber zugeordnet werden.
          Je Eigentümer kannst du davon abweichen.</p>
        <div className="row" style={{ margin: '10px 0' }}>
          <label className="inline">Beträge gültig ab <input type="date" value={ab} onChange={(x) => x.target.value && setAb(x.target.value)} /></label>
          <span className="muted small">Zuerst das Datum wählen, dann die Beträge ändern.</span>
        </div>
        {info && <p className="info">{info}</p>}
        <div className="tablewrap"><table className="list">
          <thead><tr><th>W-ID</th><th>Einheit</th><th>Eigentümer</th><th className="num">Hausgeld ohne Rücklage €</th><th className="num">Erhaltungsrücklage €</th><th className="num">Hausgeld gesamt</th><th>Zahlweise</th><th>Überweisung</th></tr></thead>
          <tbody>{rows.map((r) => {
            const e = edit[r.einheit_id] ?? { bew: '', rl: '', zw: '' };
            const bew = zahlIn(e.bew), rl = zahlIn(e.rl), z = effektiv(e.zw);
            return (
              <tr key={r.einheit_id}>
                <td className="nowrap"><b>{r.wid}</b></td><td>{r.nummer}</td><td>{r.eigentuemer ?? <span className="muted">kein Eigentümer</span>}</td>
                <td className="num"><input className="cell" inputMode="decimal" value={e.bew} onChange={(x) => setEdit({ ...edit, [r.einheit_id]: { ...e, bew: x.target.value } })} /></td>
                <td className="num"><input className="cell" inputMode="decimal" value={e.rl} onChange={(x) => setEdit({ ...edit, [r.einheit_id]: { ...e, rl: x.target.value } })} /></td>
                <td className="num"><b>{eur(bew + rl)}</b></td>
                <td><select className="cell" value={e.zw} disabled={!r.eigentum_id} onChange={(x) => setEdit({ ...edit, [r.einheit_id]: { ...e, zw: x.target.value } })}>
                  <option value="">wie Liegenschaft ({standard === 'getrennt' ? 'getrennt' : 'eine Summe'})</option>
                  <option value="zusammen">in einer Summe</option><option value="getrennt">getrennt</option></select></td>
                <td className="small nowrap">{!bew && !rl ? '–' : z === 'getrennt' && rl > 0 ? <>2 Überweisungen: {eur(bew)} Hausgeld + {eur(rl)} Rücklage</> : <>1 Überweisung: {eur(bew + rl)}</>}</td>
              </tr>);
          })}</tbody>
          <tfoot><tr><td colSpan={3}>Summe</td>
            <td className="num">{eur(rows.reduce((a, r) => a + zahlIn(edit[r.einheit_id]?.bew ?? ''), 0))}</td>
            <td className="num">{eur(rows.reduce((a, r) => a + zahlIn(edit[r.einheit_id]?.rl ?? ''), 0))}</td>
            <td className="num">{eur(rows.reduce((a, r) => a + zahlIn(edit[r.einheit_id]?.bew ?? '') + zahlIn(edit[r.einheit_id]?.rl ?? ''), 0))}</td><td colSpan={2} /></tr></tfoot>
        </table></div>
        <div className="row end" style={{ marginTop: 12 }}>
          <span className="muted small">Gilt ab {datum(ab)}</span>
          <button className="primary" onClick={speichern}>Änderungen speichern</button>
        </div>
        <p className="muted small">Die Tabelle zeigt die Beträge, die am gewählten Datum gelten. Neue Beträge werden ab diesem Datum als neuer Hausgeldsatz gespeichert (frühere Sätze bleiben erhalten). Offene, noch nicht bezahlte Hausgeld-Posten ab diesem Monat werden automatisch neu gestellt.</p>
      </section>
      {nurHausgeld ? <HausgeldTab objektId={objektId} version={version} onChange={async () => { await hausgeldNeuStellen(objektId, '0000-00'); load(); }} /> : <EntityTable
        title="Eigentümer je Einheit"
        icon={<Users size={22} />}
        newLabel="Eigentümer zuordnen"
        table="eigentum"
        version={version}
        fields={[
          { key: 'wid', label: 'W-ID', computed: true, format: (v: any) => <b className="nowrap">{v}</b> },
          { key: 'einheit_id', label: 'Einheit', type: 'select', required: true, optionsSql: einheitOptions(objektId) },
          { key: 'person_id', label: 'Eigentümer', type: 'select', required: true, optionsSql: personOptions('Eigentümer') },
          { key: 'anteil', label: 'Anteil %', type: 'number' },
          { key: 'von', label: 'Eigentümer seit', type: 'date' },
          { key: 'bis', label: 'bis (Verkauf)', type: 'date' },
          { key: 'zahlweise', label: 'Zahlweise Rücklage', type: 'select', options: [{ value: '', label: 'wie Liegenschaft' }, { value: 'zusammen', label: 'in einer Summe' }, { value: 'getrennt', label: 'getrennt' }],
            format: (v: any) => (v === 'getrennt' ? 'getrennt' : v === 'zusammen' ? 'in einer Summe' : <span className="muted">wie Liegenschaft</span>) },
          { key: 'kontakt', label: 'Kontakt', computed: true },
        ]}
        listSql={`SELECT ei.*, ${widSql('e', 'o')} AS wid, e.nummer AS einheit_id_label, ${personLabel('p')} AS person_id_label,
            TRIM(COALESCE(p.telefon, '') || ' ' || COALESCE(p.email, '')) AS kontakt
          FROM eigentum ei JOIN einheiten e ON e.id = ei.einheit_id JOIN objekte o ON o.id = e.objekt_id JOIN personen p ON p.id = ei.person_id
          WHERE e.objekt_id = $1 ORDER BY e.lfd_nr, e.nummer, ei.von DESC`}
        listParams={[objektId]}
        onChange={load}
        emptyText="Noch keine Eigentümer zugeordnet. Eigentümer legst du zuerst unter „Personen“ an."
      />}
    </>
  );
}

/** Verlauf aller Hausgeldsätze je Einheit. Änderungen hier stellen offene Hausgeld-Posten neu. */
function HausgeldTab({ objektId, version, onChange }: { objektId: number; version: number; onChange: () => void }) {
  return (
    <EntityTable
      title="Verlauf der Hausgeldsätze je Einheit"
      version={version}
      onChange={onChange}
      icon={<Wallet size={22} />}
      newLabel="Hausgeld eintragen"
      table="hausgeld"
      fields={[
        { key: 'einheit_id', label: 'Einheit', type: 'select', required: true, optionsSql: einheitOptions(objektId) },
        { key: 'gueltig_ab', label: 'Gültig ab', type: 'date', required: true },
        { key: 'betrag', label: 'Hausgeld gesamt / Monat (inkl. Rücklage)', type: 'number', required: true, format: eur },
        { key: 'davon_ruecklage', label: 'davon Erhaltungsrücklage', type: 'number', format: eur },
      ]}
      listSql={`SELECT h.*, e.nummer AS einheit_id_label FROM hausgeld h JOIN einheiten e ON e.id = h.einheit_id
        WHERE e.objekt_id = $1 ORDER BY e.lfd_nr, e.nummer, h.gueltig_ab DESC`}
      listParams={[objektId]}
      emptyText="Noch kein Hausgeld eingetragen. Trage die Beträge oben mit „Beträge gültig ab“ ein."
    />
  );
}

function BeiratTab({ objektId }: { objektId: number }) {
  return (
    <EntityTable
      title="Verwaltungsbeirat"
      icon={<Gavel size={22} />}
      table="beiraete"
      fields={[
        { key: 'person_id', label: 'Person', type: 'select', required: true, optionsSql: personOptions() },
        { key: 'funktion', label: 'Funktion', type: 'select', options: ['Vorsitz', 'Stellvertretung', 'Mitglied'] },
        { key: 'von', label: 'gewählt am', type: 'date' },
        { key: 'bis', label: 'bis', type: 'date' },
      ]}
      listSql={`SELECT b.*, ${personLabel('p')} AS person_id_label FROM beiraete b JOIN personen p ON p.id = b.person_id
        WHERE b.objekt_id = $1 ORDER BY b.funktion`}
      listParams={[objektId]}
      fixed={{ objekt_id: objektId }}
      emptyText="Noch kein Beirat eingetragen."
    />
  );
}

/** Umlageschlüssel je Konto für dieses Objekt; ohne Eintrag gilt der Vorschlag aus dem Kontenrahmen. */
function SchluesselTab({ objektId, weg }: { objektId: number; weg: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const load = async () => setRows(await db.select(`SELECT k.id, k.nummer, k.name, k.gruppe, k.schluessel AS vorschlag, s.schluessel
      FROM buchungskonten k LEFT JOIN objekt_schluessel s ON s.buchungskonto_id = k.id AND s.objekt_id = $1
      WHERE ${weg ? "k.art = 'Aufwand' AND k.nummer NOT IN ('1260', '1261', '1262')" : 'k.umlagefaehig = 1'} ORDER BY k.nummer`, [objektId]));
  useEffect(() => { load(); }, [objektId, weg]);
  async function set(kontoId: number, wert: string) {
    if (!wert) await db.execute('DELETE FROM objekt_schluessel WHERE objekt_id = $1 AND buchungskonto_id = $2', [objektId, kontoId]);
    else await db.execute(`INSERT INTO objekt_schluessel (objekt_id, buchungskonto_id, schluessel) VALUES ($1, $2, $3)
      ON CONFLICT (objekt_id, buchungskonto_id) DO UPDATE SET schluessel = excluded.schluessel`, [objektId, kontoId, wert]);
    load();
  }
  let gruppe = '';
  return (
    <section className="card">
      <div className="card-head"><h2 className="title-ico"><Scale size={22} />Umlageschlüssel für diese Liegenschaft</h2></div>
      <p className="muted small">{weg ? 'Gilt für die WEG-Jahresabrechnung. Ohne eigene Auswahl wird nach MEA verteilt.' : 'Gilt für die Nebenkostenabrechnung. Ohne eigene Auswahl gilt der Vorschlag.'}</p>
      <table className="list">
        <thead><tr><th>Konto</th><th>Bezeichnung</th><th>Vorschlag</th><th>Schlüssel für dieses Objekt</th></tr></thead>
        <tbody>
          {rows.flatMap((r) => {
            const out = [];
            if (r.gruppe !== gruppe) { gruppe = r.gruppe; out.push(<tr key={'g' + r.id} className="group"><td colSpan={4}>{gruppe}</td></tr>); }
            out.push(
              <tr key={r.id}>
                <td>{r.nummer}</td><td>{r.name}</td><td className="muted">{weg ? 'MEA' : r.vorschlag}</td>
                <td><select value={r.schluessel ?? ''} onChange={(e) => set(r.id, e.target.value)}>
                  <option value="">{weg ? 'Standard (MEA)' : `wie Vorschlag (${r.vorschlag})`}</option>
                  {SCHLUESSEL.map((s) => <option key={s}>{s}</option>)}
                </select></td>
              </tr>);
            return out;
          })}
        </tbody>
      </table>
    </section>
  );
}

