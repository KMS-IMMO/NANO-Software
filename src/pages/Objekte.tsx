import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Building2, DoorOpen, FolderOpen, Gavel, Layers, Maximize2, Scale, Users, Wallet } from 'lucide-react';
import { EntityTable, eur, num, type Field } from '../components/EntityTable';
import { db, type Row } from '../db';
import { AKTIV, EINHEIT_TYPEN, SCHLUESSEL, personLabel, personOptions } from '../db/labels';

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
  { key: 'heizungsart', label: 'Heizungsart', type: 'select', hideInTable: true,
    options: ['Gas-Zentralheizung', 'Öl-Zentralheizung', 'Fernwärme', 'Wärmepumpe', 'Pellets', 'Gasetagenheizung', 'Nachtspeicher', 'Sonstige'] },
  { key: 'eigentuemer_id', label: 'Eigentümer (nur Mietverwaltung)', type: 'select', optionsSql: personOptions('Eigentümer'), hideInTable: true, wide: true },
  { key: 'notiz', label: 'Notiz', type: 'textarea', hideInTable: true },
];

export function ObjektePage() {
  const nav = useNavigate();
  return (
    <EntityTable
      title="Liegenschaften"
      icon={<Building2 size={24} />}
      newLabel="Liegenschaft hinzufügen"
      table="objekte"
      fields={[...objektFields.slice(0, 2), { key: 'einheiten', label: 'Einheiten', type: 'number', computed: true, format: (v) => num(v, 0), sum: true }, ...objektFields.slice(2)]}
      listSql={`SELECT o.*, (SELECT COUNT(*) FROM einheiten e WHERE e.objekt_id = o.id) AS einheiten
                FROM objekte o ORDER BY o.objekt_nr, o.name`}
      onOpen={(r) => nav(`/objekte/${r.id}`)}
      emptyText="Noch keine Liegenschaften. Lege mit „Liegenschaft hinzufügen“ dein erstes Haus oder deine erste WEG an."
    />
  );
}

const TABS_WEG: [string, any][] = [['Einheiten & Zahlungen', Building2], ['Eigentümer', Users], ['Hausgeldplan', Wallet], ['Verwaltungsbeirat', Gavel], ['Umlageschlüssel', Scale], ['Dokumente', FolderOpen]];
const TABS_MIETE: [string, any][] = [['Einheiten & Zahlungen', Building2], ['Umlageschlüssel', Scale], ['Dokumente', FolderOpen]];

export function ObjektDetailPage() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const [o, setO] = useState<Row | null>(null);
  const [sum, setSum] = useState<Row>({});
  const [tab, setTab] = useState('Einheiten & Zahlungen');
  const reload = async () => {
    setO((await db.select(`SELECT o.*, ${personLabel('p')} AS eigentuemer, p.telefon, p.email
      FROM objekte o LEFT JOIN personen p ON p.id = o.eigentuemer_id WHERE o.id = $1`, [id]))[0] ?? null);
    setSum((await db.select(`SELECT COUNT(*) n, SUM(flaeche) fl, SUM(mea) mea,
        SUM(COALESCE((SELECT v.personenzahl FROM mietvertraege v WHERE v.einheit_id = e.id AND ${AKTIV()} LIMIT 1), e.personenzahl, 0)) pers
      FROM einheiten e WHERE objekt_id = $1`, [id]))[0]);
  };
  useEffect(() => { reload(); }, [id]);
  if (!o) return <p>Liegenschaft wird geladen…</p>;
  const weg = o.verwaltungsart === 'WEG';
  const meaWarn = o.gesamt_mea && sum.mea && Math.abs(o.gesamt_mea - sum.mea) > 0.001;

  return (
    <>
      <div className="page-head">
        <h1>{weg ? 'WEG-Verwaltung' : 'Mietverwaltung'} – {o.name}</h1>
        <div className="crumbs"><Link to="/">Dashboard</Link> › <Link to="/objekte">Liegenschaften</Link> › <span>{o.name} ({weg ? 'WEG' : 'Miete'})</span></div>
      </div>
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
      <div className="tabs">
        {(weg ? TABS_WEG : TABS_MIETE).map(([t, Icon]) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => (t === 'Dokumente' ? nav('/ablage') : setTab(t))}><Icon size={18} />{t}</button>))}
      </div>
      {tab === 'Einheiten & Zahlungen' && <EinheitenTab objektId={id} weg={weg} onChange={reload} />}
      {tab === 'Eigentümer' && <EigentuemerTab objektId={id} />}
      {tab === 'Hausgeldplan' && <HausgeldTab objektId={id} />}
      {tab === 'Verwaltungsbeirat' && <BeiratTab objektId={id} />}
      {tab === 'Umlageschlüssel' && <SchluesselTab objektId={id} weg={weg} />}
    </>
  );
}

function EinheitenTab({ objektId, weg, onChange }: { objektId: number; weg: boolean; onChange: () => void }) {
  const jahr = new Date().getFullYear();
  const status = (_: any, r: Row) => (Number(r.soll) || 0) === 0 ? <span className="muted">–</span>
    : r.saldo > 0.005 ? <span className={'pill ' + (r.ist > 0.005 ? 'teil' : 'offen')}>{r.ist > 0.005 ? 'Teilweise' : 'Offen'}</span> : <span className="pill bezahlt">Bezahlt</span>;
  return (
    <EntityTable
      title={`Einheiten (${weg ? 'WEG' : 'Miete'}) · Zahlungen ${jahr}`}
      icon={<DoorOpen size={22} />}
      newLabel="Einheit hinzufügen"
      table="einheiten"
      fields={[
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
        ...(weg ? [{ key: 'eigentuemer', label: 'Eigentümer', computed: true, format: (v: any) => v ?? '–' }] : []),
        { key: 'mieter', label: 'Mieter (aktuell)', computed: true, format: (v: any) => v ?? <span className="muted">–</span> },
        { key: 'monat', label: weg ? 'Hausgeld (Soll) / Monat' : 'Miete warm / Monat', type: 'number', computed: true, format: eur, sum: true },
        { key: 'ist', label: `Zahlungseingang ${jahr}`, type: 'number', computed: true, format: eur, sum: true },
        { key: 'saldo', label: 'Offener Saldo', type: 'number', computed: true, sum: true,
          format: (v: any) => <span className={v > 0.005 ? 'neg' : ''}>{eur(v ?? 0)}</span> },
        { key: 'status', label: 'Status', computed: true, format: status },
      ] as Field[]}
      listSql={`SELECT x.*, x.soll - x.ist AS saldo FROM (SELECT e.*,
          (SELECT GROUP_CONCAT(${personLabel('p')}, '; ') FROM eigentum ei JOIN personen p ON p.id = ei.person_id
             WHERE ei.einheit_id = e.id AND (ei.bis IS NULL OR ei.bis >= date('now'))) AS eigentuemer,
          (SELECT ${personLabel('p')} FROM mietvertraege v JOIN personen p ON p.id = v.mieter_id WHERE v.einheit_id = e.id AND ${AKTIV()} LIMIT 1) AS mieter,
          CASE WHEN EXISTS (SELECT 1 FROM mietvertraege v WHERE v.einheit_id = e.id AND ${AKTIV()}) THEN 'Miete'
               WHEN ${weg ? 1 : 0} = 1 THEN 'Eigentum' ELSE 'Leerstand' END AS nutzung,
          COALESCE((SELECT v.personenzahl FROM mietvertraege v WHERE v.einheit_id = e.id AND ${AKTIV()} LIMIT 1), e.personenzahl) AS personen,
          ${weg
            ? `(SELECT h.betrag FROM hausgeld h WHERE h.einheit_id = e.id AND h.gueltig_ab <= date('now') ORDER BY h.gueltig_ab DESC LIMIT 1)`
            : `(SELECT v.kaltmiete + v.nk_vorauszahlung + v.hk_vorauszahlung FROM mietvertraege v WHERE v.einheit_id = e.id AND ${AKTIV()} LIMIT 1)`} AS monat,
          COALESCE((SELECT SUM(s.betrag) FROM sollstellungen s WHERE s.einheit_id = e.id AND substr(s.monat, 1, 4) = '${jahr}'
             AND s.faellig <= date('now') AND s.art IN (${weg ? `'Hausgeld'` : `'Kaltmiete', 'NK', 'HK', 'USt'`})), 0) AS soll,
          COALESCE((SELECT SUM(b.betrag) FROM buchungen b JOIN sollstellungen s ON s.id = b.sollstellung_id WHERE s.einheit_id = e.id
             AND substr(s.monat, 1, 4) = '${jahr}' AND s.faellig <= date('now') AND s.art IN (${weg ? `'Hausgeld'` : `'Kaltmiete', 'NK', 'HK', 'USt'`})), 0) AS ist
        FROM einheiten e WHERE e.objekt_id = $1) x ORDER BY x.nummer`}
      listParams={[objektId]}
      fixed={{ objekt_id: objektId }}
      onChange={onChange}
    />
  );
}

const einheitOptions = (objektId: number) => `SELECT id AS value, nummer AS label FROM einheiten WHERE objekt_id = ${objektId} ORDER BY nummer`;

function EigentuemerTab({ objektId }: { objektId: number }) {
  return (
    <EntityTable
      title="Eigentümer je Einheit"
      icon={<Users size={22} />}
      newLabel="Eigentümer zuordnen"
      table="eigentum"
      fields={[
        { key: 'einheit_id', label: 'Einheit', type: 'select', required: true, optionsSql: einheitOptions(objektId) },
        { key: 'person_id', label: 'Eigentümer', type: 'select', required: true, optionsSql: personOptions('Eigentümer') },
        { key: 'anteil', label: 'Anteil %', type: 'number' },
        { key: 'von', label: 'Eigentümer seit', type: 'date' },
        { key: 'bis', label: 'bis (Verkauf)', type: 'date' },
        { key: 'kontakt', label: 'Kontakt', computed: true },
      ]}
      listSql={`SELECT ei.*, e.nummer AS einheit_id_label, ${personLabel('p')} AS person_id_label,
          TRIM(COALESCE(p.telefon, '') || ' ' || COALESCE(p.email, '')) AS kontakt
        FROM eigentum ei JOIN einheiten e ON e.id = ei.einheit_id JOIN personen p ON p.id = ei.person_id
        WHERE e.objekt_id = $1 ORDER BY e.nummer, ei.von DESC`}
      listParams={[objektId]}
      emptyText="Noch keine Eigentümer zugeordnet. Eigentümer legst du zuerst unter „Personen“ an."
    />
  );
}

function HausgeldTab({ objektId }: { objektId: number }) {
  return (
    <EntityTable
      title="Hausgeldplan je Einheit"
      icon={<Wallet size={22} />}
      newLabel="Hausgeld eintragen"
      table="hausgeld"
      fields={[
        { key: 'einheit_id', label: 'Einheit', type: 'select', required: true, optionsSql: einheitOptions(objektId) },
        { key: 'gueltig_ab', label: 'Gültig ab', type: 'date', required: true },
        { key: 'betrag', label: 'Hausgeld / Monat', type: 'number', required: true, format: eur },
        { key: 'davon_ruecklage', label: 'davon Erhaltungsrücklage', type: 'number', format: eur },
      ]}
      listSql={`SELECT h.*, e.nummer AS einheit_id_label FROM hausgeld h JOIN einheiten e ON e.id = h.einheit_id
        WHERE e.objekt_id = $1 ORDER BY e.nummer, h.gueltig_ab DESC`}
      listParams={[objektId]}
      emptyText="Noch kein Hausgeld eingetragen. Bei einer Änderung trägst du einfach einen neuen Betrag mit neuem Datum ein."
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

