import { EntityTable, eur } from '../components/EntityTable';
import { SicherheitKarte } from '../components/SicherheitKarte';
import { db, sicherheit } from '../db';
import { useEffect, useState } from 'react';
import { SCHLUESSEL, kontoOptions } from '../db/labels';

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
        { key: 'schluessel', label: 'Schlüssel (Vorschlag)', type: 'select', options: SCHLUESSEL },
      ]}
      listSql="SELECT * FROM buchungskonten ORDER BY nummer"
      groupBy="gruppe"
    />
  );
}

export function RechnungenPage() {
  return (
    <EntityTable
      title="Rechnungen und Kosten"
      table="rechnungen"
      fields={[
        { key: 'datum', label: 'Datum', type: 'date', required: true },
        { key: 'objekt_id', label: 'Objekt', type: 'select', required: true, optionsSql: 'SELECT id AS value, name AS label FROM objekte ORDER BY name' },
        { key: 'einheit_id', label: 'Einheit (nur bei Direktkosten)', type: 'select', hideInTable: true,
          optionsSql: `SELECT e.id AS value, o.name || ' – ' || e.nummer AS label FROM einheiten e JOIN objekte o ON o.id = e.objekt_id ORDER BY label` },
        { key: 'firma_id', label: 'Firma', type: 'select', optionsSql: 'SELECT id AS value, name AS label FROM firmen ORDER BY name' },
        { key: 'rechnungsnr', label: 'Rechnungsnr.' },
        { key: 'buchungskonto_id', label: 'Buchungskonto', type: 'select', required: true, wide: true, optionsSql: kontoOptions("art IN ('Aufwand')") },
        { key: 'betrag', label: 'Betrag brutto', type: 'number', required: true, format: eur },
        { key: 'anteil_lohn', label: 'davon Arbeitskosten (§35a)', type: 'number', format: eur, hideInTable: true },
        { key: 'zeitraum_von', label: 'Leistung von', type: 'date', hideInTable: true },
        { key: 'zeitraum_bis', label: 'Leistung bis', type: 'date', hideInTable: true },
        { key: 'faellig', label: 'Fällig', type: 'date' },
        { key: 'bezahlt_am', label: 'Bezahlt am', type: 'date' },
        { key: 'notiz', label: 'Notiz', type: 'textarea', hideInTable: true },
      ]}
      listSql={`SELECT r.*, o.name AS objekt_id_label, k.nummer || ' ' || k.name AS buchungskonto_id_label, f.name AS firma_id_label
        FROM rechnungen r LEFT JOIN objekte o ON o.id = r.objekt_id LEFT JOIN buchungskonten k ON k.id = r.buchungskonto_id
        LEFT JOIN firmen f ON f.id = r.firma_id ORDER BY r.datum DESC`}
      emptyText="Noch keine Rechnungen erfasst."
    />
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
  ['ablage_pfad', 'Ablageordner für Dokumente (später NAS)'],
  ['fints_produkt_id', 'FinTS-Produkt-ID für den Bankabruf (kostenlos bei fints.org)'],
];

export function EinstellungenPage() {
  const [w, setW] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  useEffect(() => { db.select('SELECT * FROM einstellungen').then((r) => setW(Object.fromEntries(r.map((x) => [x.schluessel, x.wert ?? ''])))); }, []);
  async function save() {
    for (const [k] of EINST) await db.execute(`INSERT INTO einstellungen (schluessel, wert) VALUES ($1, $2)
      ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert`, [k, w[k] ?? '']);
    if (sicherheit.aktiv && w.ablage_pfad) await sicherheit.ablageFreigeben(w.ablage_pfad).catch(() => {});
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  }
  return (
    <>
      <section className="card">
        <div className="card-head"><h2>Allgemein und Mahnwesen</h2></div>
        <div className="form">
          {EINST.map(([k, label]) => (
            <label key={k} className={k === 'ablage_pfad' ? 'wide' : ''}><span>{label}</span>
              <input value={w[k] ?? ''} onChange={(e) => setW({ ...w, [k]: e.target.value })} /></label>
          ))}
        </div>
        <div className="row end"><span className="grow" />{saved && <span className="pos">Gespeichert</span>}<button className="primary" onClick={save}>Speichern</button></div>
      </section>
      <SicherheitKarte />
      <EntityTable
        title="Bankkonten je Objekt"
        table="bankkonten"
        fields={[
          { key: 'objekt_id', label: 'Objekt', type: 'select', required: true, optionsSql: 'SELECT id AS value, name AS label FROM objekte ORDER BY name' },
          { key: 'name', label: 'Bezeichnung', required: true },
          { key: 'bank', label: 'Bank' },
          { key: 'iban', label: 'IBAN', wide: true },
          { key: 'bic', label: 'BIC', hideInTable: true },
          { key: 'anfangssaldo', label: 'Anfangssaldo', type: 'number', format: eur, hideInTable: true },
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

