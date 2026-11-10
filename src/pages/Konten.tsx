import { EntityTable, eur } from '../components/EntityTable';
import { SicherheitKarte } from '../components/SicherheitKarte';
import { db, mehrplatz, sicherheit } from '../db';
import { MehrplatzKarte } from '../components/MehrplatzKarte';
import { BriefpapierKarte } from '../components/BriefpapierKarte';
import { useObjektKontext } from '../logic/objektKontext';
import { useEffect, useState } from 'react';
import { Paperclip } from 'lucide-react';
import { RechnungErfassen } from '../components/RechnungErfassen';
import { oeffnen } from '../lib/dateien';
import { SCHLUESSEL, einheitLabel, kontoOptions } from '../db/labels';
import { DATEV_EINST } from '../logic/datev';
import { KI_MODELLE, KI_STANDARD, kiEinstellungen, kiSchluesselSpeichern } from '../logic/kiAgent';

const haken = (v: any) => (v ? '✓' : '');

export function KontenPage() {
  return (
    <EntityTable
      title="Buchungskonten (Kontenrahmen 2027)"
      table="buchungskonten"
      fields={[
        { key: 'nummer', label: 'Konto', required: true },
        { key: 'name', label: 'Bezeichnung', required: true, wide: true },
        { key: 'gruppe', label: 'Gruppe' },
        { key: 'art', label: 'Art', type: 'select', required: true, options: ['Aufwand', 'Ertrag', 'Einnahme', 'Bank', 'Kaution'], hideInTable: true },
        { key: 'euer', label: 'EÜR', type: 'checkbox', format: haken },
        { key: 'mwst', label: 'MwSt %', type: 'select', options: [{ value: 0, label: '0 %' }, { value: 7, label: '7 %' }, { value: 19, label: '19 %' }], format: (v) => (v ? v + ' %' : '–') },
        { key: 'umlagefaehig', label: 'Umlagefähig', type: 'checkbox', format: haken },
        { key: 'hdl', label: 'HDL', type: 'checkbox', format: haken },
        { key: 'hwl', label: 'HWL', type: 'checkbox', format: haken },
        { key: 'rechnung_pflicht', label: 'Rechnungs-Nr. Pflicht', type: 'checkbox', format: haken },
        { key: 'schluessel', label: 'Schlüssel (Vorschlag)', type: 'select', options: SCHLUESSEL },
      ]}
      listSql="SELECT * FROM buchungskonten ORDER BY nummer"
      groupBy="gruppe"
    />
  );
}

export function RechnungenPage() {
  const fix = useObjektKontext();
  const [version, setVersion] = useState(0);
  const [info, setInfo] = useState('');
  return (
    <>
    <div className="page-head"><h1>Rechnungen</h1><p className="muted">{fix ? `Rechnungen und Gutschriften von ${fix.name}` : 'Rechnungen und Gutschriften aller Liegenschaften'}</p></div>
    <RechnungErfassen objektFest={fix?.id} onSaved={(t) => { setInfo(t); setVersion(version + 1); }} />
    {info && <p className="info">{info}</p>}
    <EntityTable
      version={version}
      title="Erfasste Rechnungen"
      table="rechnungen"
      fixed={fix ? { objekt_id: fix.id } : undefined}
      fields={[
        { key: 'datum', label: 'Datum', type: 'date', required: true },
        ...(fix ? [] : [{ key: 'objekt_id', label: 'Objekt', type: 'select' as const, required: true, optionsSql: 'SELECT id AS value, name AS label FROM objekte ORDER BY name' }]),
        { key: 'einheit_id', label: 'Einheit', type: 'select', leer: 'Alle Einheiten (Umlage nach Schlüssel)',
          optionsSql: `SELECT e.id AS value, ${fix ? '' : "o.name || ' – ' || "}${einheitLabel('e')} AS label FROM einheiten e JOIN objekte o ON o.id = e.objekt_id ${fix ? `WHERE e.objekt_id = ${fix.id}` : ''} ORDER BY o.name, e.lfd_nr, e.nummer` },
        { key: 'firma_id', label: 'Firma', type: 'select', optionsSql: 'SELECT id AS value, name AS label FROM firmen ORDER BY name' },
        { key: 'rechnungsnr', label: 'Rechnungsnr.' },
        { key: 'buchungskonto_id', label: 'Buchungskonto', type: 'select', required: true, wide: true, optionsSql: kontoOptions("art IN ('Aufwand')") },
        { key: 'betrag', label: 'Betrag brutto', type: 'number', geld: true, minusNeutral: true, required: true, format: (v: any) => <span className={v < 0 ? '' : 'neg'}>{eur(v)}{v < 0 ? ' Gutschrift' : ''}</span> },
        { key: 'mwst_satz', label: 'MwSt %', type: 'number', format: (v: any) => (v == null ? '' : `${v} %`) },
        { key: 'beleg', label: 'Beleg', computed: true, format: (v: any) => v ? <button className="link" title={v} onClick={(e) => { e.stopPropagation(); oeffnen(v); }}><Paperclip size={15} /></button> : '' },
        { key: 'anteil_lohn', label: 'davon Arbeitskosten (§35a)', type: 'number', geld: true, format: eur, hideInTable: true },
        { key: 'zeitraum_von', label: 'Leistung von', type: 'date', hideInTable: true },
        { key: 'zeitraum_bis', label: 'Leistung bis', type: 'date', hideInTable: true },
        { key: 'faellig', label: 'Fällig', type: 'date' },
        { key: 'bezahlt_am', label: 'Bezahlt am', type: 'date' },
        { key: 'notiz', label: 'Notiz', type: 'textarea', hideInTable: true },
      ]}
      listSql={`SELECT r.*, o.name AS objekt_id_label, k.nummer || ' ' || k.name AS buchungskonto_id_label, f.name AS firma_id_label,
          COALESCE(eh.nummer, 'alle') AS einheit_id_label, d.pfad AS beleg
        FROM rechnungen r LEFT JOIN einheiten eh ON eh.id = r.einheit_id LEFT JOIN dokumente d ON d.id = r.dokument_id LEFT JOIN objekte o ON o.id = r.objekt_id LEFT JOIN buchungskonten k ON k.id = r.buchungskonto_id
        LEFT JOIN firmen f ON f.id = r.firma_id ${fix ? `WHERE r.objekt_id = ${fix.id}` : ''} ORDER BY r.datum, r.id`}
      emptyText="Noch keine Rechnungen erfasst."
    />
    </>
  );
}

const EINST: [string, string][] = [
  ['firma_name', 'Name der Verwaltung'],
  ['firma_strasse', 'Straße'],
  ['firma_plz', 'PLZ'],
  ['firma_ort', 'Ort'],
  ['firma_telefon', 'Telefon'],
  ['firma_email', 'E-Mail'],
  ['mahnung_gebuehr_1', 'Gebühr Zahlungserinnerung (€)'],
  ['mahnung_gebuehr_2', 'Gebühr 1. Mahnung (€)'],
  ['mahnung_gebuehr_3', 'Gebühr 2. Mahnung (€)'],
  ['mahnung_frist_tage', 'Zahlungsfrist in Mahnungen (Tage)'],
  ['mahnen_ab_tage', 'Offene Posten auf „mahnen“ setzen ab (Tage nach Fälligkeit, Standard 14)'],
  ['ablage_pfad', 'Ablageordner für Dokumente (später NAS)'],
  ['fints_produkt_id', 'FinTS-Produkt-ID für den Bankabruf (kostenlos bei fints.org)'],
  ...DATEV_EINST.map(([k, l]): [string, string] => [k, l]),
];

export function EinstellungenPage() {
  const [w, setW] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  useEffect(() => { db.select('SELECT * FROM einstellungen').then((r) => setW(Object.fromEntries(r.map((x) => [x.schluessel, x.wert ?? ''])))); }, []);
  async function save() {
    for (const [k] of EINST.filter(([k]) => !(mehrplatz.aktiv && k === 'ablage_pfad'))) await db.execute(`INSERT INTO einstellungen (schluessel, wert) VALUES ($1, $2)
      ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert`, [k, w[k] ?? '']);
    if (sicherheit.aktiv && w.ablage_pfad) await sicherheit.ablageFreigeben(w.ablage_pfad).catch(() => {});
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  }
  return (
    <>
      <section className="card">
        <div className="card-head"><h2>Allgemein und Mahnwesen</h2></div>
        <div className="form">
          {EINST.filter(([k]) => !(mehrplatz.aktiv && k === 'ablage_pfad')).map(([k, label]) => (
            <label key={k} className={k === 'ablage_pfad' ? 'wide' : ''}><span>{label}</span>
              <input value={w[k] ?? ''} onChange={(e) => setW({ ...w, [k]: e.target.value })} /></label>
          ))}
        </div>
        <div className="row end"><span className="grow" />{saved && <span className="pos">Gespeichert</span>}<button className="primary" onClick={save}>Speichern</button></div>
      </section>
      <BriefpapierKarte />
      <KiKarte />
      <MehrplatzKarte />
      {!mehrplatz.aktiv && <SicherheitKarte />}
      <EntityTable
        title="Bankkonten je Objekt"
        table="bankkonten"
        fields={[
          { key: 'objekt_id', label: 'Objekt', type: 'select', required: true, optionsSql: 'SELECT id AS value, name AS label FROM objekte ORDER BY name' },
          { key: 'name', label: 'Bezeichnung', required: true },
          { key: 'bank', label: 'Bank' },
          { key: 'iban', label: 'IBAN', wide: true },
          { key: 'bic', label: 'BIC', hideInTable: true },
          { key: 'anfangssaldo', label: 'Anfangssaldo', type: 'number', geld: true, format: eur, hideInTable: true },
          { key: 'saldo_datum', label: 'Saldo zum', type: 'date', hideInTable: true },
        ]}
        listSql={`SELECT b.*, o.name AS objekt_id_label FROM bankkonten b LEFT JOIN objekte o ON o.id = b.objekt_id ORDER BY o.name`}
        emptyText="Noch kein Bankkonto. Jedes Objekt bekommt sein eigenes Konto."
      />
      <EntityTable
        title="Ordnervorlagen für die Ablage"
        table="ordnervorlagen"
        fields={[
          { key: 'name', label: 'Name', required: true },
          { key: 'bezug', label: 'Gilt für', type: 'select', required: true, options: ['Objekt', 'Einheit', 'Person', 'Mietvertrag', 'Firma'] },
          { key: 'ordner', label: 'Ordner (einer pro Zeile, Unterordner mit /)', type: 'textarea', required: true,
            format: (v) => String(v ?? '').split('\n').filter(Boolean).join(' · ') },
        ]}
        listSql="SELECT * FROM ordnervorlagen ORDER BY bezug, name"
        emptyText="Deine eigene Ordnervorlage trage ich ein, sobald du sie geschickt hast."
      />
    </>
  );
}


/** KI-Assistent: API-Schlüssel und Modell */
function KiKarte() {
  const [schluessel, setSchluessel] = useState('');
  const [hat, setHat] = useState(false);
  const [modell, setModell] = useState(KI_STANDARD);
  const [ok, setOk] = useState(false);
  useEffect(() => { kiEinstellungen().then((e) => { setHat(!!e.schluessel); setModell(e.modell); }); }, []);
  async function save() {
    if (schluessel.trim()) await kiSchluesselSpeichern(schluessel);
    await db.execute(`INSERT INTO einstellungen (schluessel, wert) VALUES ('ki_modell', $1)
      ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert`, [modell]);
    if (schluessel.trim()) setHat(true);
    setSchluessel(''); setOk(true); setTimeout(() => setOk(false), 2000);
  }
  return (
    <section className="card">
      <div className="card-head"><h2>KI-Assistent</h2></div>
      <p className="muted" style={{ marginTop: 0 }}>Der Assistent (Knopf rechts unten) nutzt Claude von Anthropic. Abgerechnet wird nach Verbrauch über dein Anthropic-Konto (console.anthropic.com). Dort kannst du auch ein Monatslimit setzen. Fragen und die dafür gelesenen Daten werden an Anthropic übertragen.</p>
      <div className="form">
        <label className="wide"><span>API-Schlüssel {hat ? '(hinterlegt, zum Ändern neu eingeben)' : '(noch keiner hinterlegt)'}</span>
          <input type="password" placeholder={hat ? '••••••••••••' : 'sk-ant-…'} value={schluessel} onChange={(e) => setSchluessel(e.target.value)} /></label>
        <label><span>Modell</span>
          <select value={modell} onChange={(e) => setModell(e.target.value)}>{KI_MODELLE.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select></label>
      </div>
      <div className="row end"><span className="grow" />
        {hat && <button onClick={async () => { await kiSchluesselSpeichern(''); setHat(false); }}>Schlüssel entfernen</button>}
        {ok && <span className="pos">Gespeichert</span>}<button className="primary" onClick={save}>Speichern</button></div>
    </section>
  );
}
