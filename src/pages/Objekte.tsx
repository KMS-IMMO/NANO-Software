import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EntityTable, eur, num, type Field } from '../components/EntityTable';
import { db, type Row } from '../db';
import { AKTIV, EINHEIT_TYPEN, SCHLUESSEL, personLabel, personOptions } from '../db/labels';

const objektFields: Field[] = [
  { key: 'verwaltungsart', label: 'Verwaltungsart', type: 'select', options: ['WEG', 'Mietverwaltung'], required: true },
  { key: 'name', label: 'Bezeichnung', required: true },
  { key: 'strasse', label: 'Straße' },
  { key: 'plz', label: 'PLZ', hideInTable: true },
  { key: 'ort', label: 'Ort' },
  { key: 'baujahr', label: 'Baujahr', type: 'number', format: (v) => v ?? '' },
  { key: 'gesamt_mea', label: 'MEA gesamt', type: 'number', format: (v) => num(v, 0) },
  { key: 'heizungsart', label: 'Heizungsart', type: 'select',
    options: ['Gas-Zentralheizung', 'Öl-Zentralheizung', 'Fernwärme', 'Wärmepumpe', 'Pellets', 'Gasetagenheizung', 'Nachtspeicher', 'Sonstige'] },
  { key: 'eigentuemer_id', label: 'Eigentümer (nur Mietverwaltung)', type: 'select', optionsSql: personOptions('Eigentümer'), hideInTable: true, wide: true },
  { key: 'notiz', label: 'Notiz', type: 'textarea', hideInTable: true },
];

export function ObjektePage() {
  const nav = useNavigate();
  return (
    <EntityTable
      title="Objekte"
      table="objekte"
      fields={[...objektFields, { key: 'einheiten', label: 'Einheiten', computed: true }]}
      listSql={`SELECT o.*, (SELECT COUNT(*) FROM einheiten e WHERE e.objekt_id = o.id) AS einheiten
                FROM objekte o ORDER BY o.verwaltungsart, o.name`}
      onOpen={(r) => nav(`/objekte/${r.id}`)}
      emptyText="Noch keine Objekte. Lege mit „+ Neu“ dein erstes Haus oder deine erste WEG an."
    />
  );
}

const TABS_WEG = ['Einheiten', 'Eigentümer', 'Hausgeld', 'Verwaltungsbeirat', 'Umlageschlüssel'];
const TABS_MIETE = ['Einheiten', 'Umlageschlüssel'];

export function ObjektDetailPage() {
  const id = Number(useParams().id);
  const [o, setO] = useState<Row | null>(null);
  const [sum, setSum] = useState<Row>({});
  const [tab, setTab] = useState('Einheiten');
  const reload = async () => {
    setO((await db.select(`SELECT o.*, ${personLabel('p')} AS eigentuemer, p.telefon, p.email
      FROM objekte o LEFT JOIN personen p ON p.id = o.eigentuemer_id WHERE o.id = $1`, [id]))[0] ?? null);
    setSum((await db.select(`SELECT COUNT(*) n, SUM(flaeche) fl, SUM(mea) mea FROM einheiten WHERE objekt_id = $1`, [id]))[0]);
  };
  useEffect(() => { reload(); }, [id]);
  if (!o) return <p>Objekt wird geladen…</p>;
  const weg = o.verwaltungsart === 'WEG';
  const meaWarn = o.gesamt_mea && sum.mea && Math.abs(o.gesamt_mea - sum.mea) > 0.001;

  return (
    <>
      <div className="page-head">
        <p className="muted small"><Link to="/objekte">Objekte</Link> ›</p>
        <h1>{o.name} <span className="badge">{o.verwaltungsart}</span></h1>
        <p className="muted">
          {[o.strasse, [o.plz, o.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
          {o.baujahr ? ` · Baujahr ${o.baujahr}` : ''}{o.heizungsart ? ` · ${o.heizungsart}` : ''}
        </p>
      </div>
      <div className="kpis">
        <div className="kpi"><span>Einheiten</span><b>{sum.n ?? 0}</b></div>
        <div className="kpi"><span>Fläche gesamt</span><b>{num(sum.fl)} m²</b></div>
        <div className="kpi"><span>MEA vergeben</span><b>{num(sum.mea, 0)}{o.gesamt_mea ? ` / ${num(o.gesamt_mea, 0)}` : ''}</b></div>
        {!weg && <div className="kpi"><span>Eigentümer</span><b className="kpi-text">{o.eigentuemer || '–'}</b><small>{[o.telefon, o.email].filter(Boolean).join(' · ')}</small></div>}
      </div>
      {meaWarn && <p className="warn">Die Summe der MEA der Einheiten ({num(sum.mea, 0)}) weicht vom MEA gesamt des Objekts ({num(o.gesamt_mea, 0)}) ab.</p>}
      <div className="tabs">
        {(weg ? TABS_WEG : TABS_MIETE).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}
      </div>
      {tab === 'Einheiten' && <EinheitenTab objektId={id} weg={weg} onChange={reload} />}
      {tab === 'Eigentümer' && <EigentuemerTab objektId={id} />}
      {tab === 'Hausgeld' && <HausgeldTab objektId={id} />}
      {tab === 'Verwaltungsbeirat' && <BeiratTab objektId={id} />}
      {tab === 'Umlageschlüssel' && <SchluesselTab objektId={id} weg={weg} />}
    </>
  );
}

function EinheitenTab({ objektId, weg, onChange }: { objektId: number; weg: boolean; onChange: () => void }) {
  return (
    <EntityTable
      title="Einheiten"
      table="einheiten"
      fields={[
        { key: 'nummer', label: 'Nummer', required: true },
        { key: 'typ', label: 'Typ', type: 'select', options: EINHEIT_TYPEN, required: true },
        { key: 'lage', label: 'Lage' },
        { key: 'flaeche', label: 'Fläche m²', type: 'number' },
        { key: 'mea', label: 'MEA', type: 'number', format: (v) => num(v, 0) },
        { key: 'notiz', label: 'Notiz', type: 'textarea', hideInTable: true },
        ...(weg ? [{ key: 'eigentuemer', label: 'Eigentümer', computed: true, format: (v: any) => v ?? '–' }] : []),
        { key: 'mieter', label: 'Mieter (aktuell)', computed: true,
          format: (v: any) => v ?? (weg ? <span className="muted">selbst genutzt / –</span> : <span className="tag">Leerstand</span>) },
        { key: 'personen', label: 'Pers.', computed: true },
        { key: 'zahlung', label: weg ? 'Hausgeld / Miete' : 'Miete warm', type: 'number', computed: true, format: (v: any, r: Row) =>
          weg ? [r.hausgeld != null ? `HG ${eur(r.hausgeld)}` : null, v != null ? `Miete ${eur(v)}` : null].filter(Boolean).join(' · ') : eur(v) },
      ] as Field[]}
      listSql={`SELECT e.*,
          (SELECT GROUP_CONCAT(${personLabel('p')}, '; ') FROM eigentum ei JOIN personen p ON p.id = ei.person_id
             WHERE ei.einheit_id = e.id AND (ei.bis IS NULL OR ei.bis >= date('now'))) AS eigentuemer,
          (SELECT ${personLabel('p')} FROM mietvertraege v JOIN personen p ON p.id = v.mieter_id WHERE v.einheit_id = e.id AND ${AKTIV()} LIMIT 1) AS mieter,
          (SELECT v.personenzahl FROM mietvertraege v WHERE v.einheit_id = e.id AND ${AKTIV()} LIMIT 1) AS personen,
          (SELECT v.kaltmiete + v.nk_vorauszahlung + v.hk_vorauszahlung FROM mietvertraege v WHERE v.einheit_id = e.id AND ${AKTIV()} LIMIT 1) AS zahlung,
          (SELECT h.betrag FROM hausgeld h WHERE h.einheit_id = e.id AND h.gueltig_ab <= date('now') ORDER BY h.gueltig_ab DESC LIMIT 1) AS hausgeld
        FROM einheiten e WHERE e.objekt_id = $1 ORDER BY e.nummer`}
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
      title="Hausgeld je Einheit"
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
      <div className="card-head"><h2>Umlageschlüssel für dieses Objekt</h2></div>
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

