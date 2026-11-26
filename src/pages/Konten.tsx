import { VorlagenKarte } from './Versammlungen';
import { ImportKnopf } from '../components/ImportAssistent';
import { EntityTable, eur } from '../components/EntityTable';
import { darstellungLesen, darstellungSetzen, type Darstellung, schriftLesen, schriftSetzen, type Schrift } from '../lib/theme';
import { SicherheitKarte } from '../components/SicherheitKarte';
import { db, mehrplatz, sicherheit } from '../db';
import { MehrplatzKarte } from '../components/MehrplatzKarte';
import { BriefpapierKarte } from '../components/BriefpapierKarte';
import { UnterschriftKarte } from '../components/UnterschriftKarte';
import { useObjektKontext } from '../logic/objektKontext';
import { useEffect, useState } from 'react';
import { FileSpreadsheet, Paperclip } from 'lucide-react';
import { RechnungErfassen } from '../components/RechnungErfassen';
import { BankkontoLoeschen } from '../components/BankkontoDialoge';
import type { Row } from '../db';
import { oeffnen } from '../lib/dateien';
import { SCHLUESSEL, einheitLabel, kontoOptions } from '../db/labels';
import { DATEV_EINST } from '../logic/datev';
import { KiKarte } from '../components/KiKarte';

const haken = (v: any) => (v ? '✓' : '');
/** Konten, deren Nummer das Programm fest verwendet (Rücklage, Sollstellungen, Heizkosten, Bankgebühren) */
const SYSTEMKONTEN = ['1000', '1001', '1002', '1003', '1010', '1011', '1200', '1260', '1261', '1262', '1405', '1601', '1602', '1701'];

export function KontenPage() {
  return (
    <>
    <section className="card">
      <p className="muted small" style={{ margin: 0 }}>
        So wirken die Haken: <b>EÜR</b> = zählt im Ergebnis der GuV/EÜR, in der Jahresübersicht und in der Eigentümerabrechnung (ohne Haken: getrennt unter „Nicht in der EÜR“).
        {' '}<b>Umlagefähig</b> = kommt in die Nebenkostenabrechnung der Mieter. <b>HDL/HWL</b> = § 35a-Ausweis in den Abrechnungen.
        {' '}<b>MwSt</b> = Vorschlag beim Erfassen einer Rechnung. <b>Schlüssel</b> = Vorschlag für die Nebenkostenabrechnung (WEG verteilt ohne eigene Auswahl nach MEA).
        {' '}Die Kontonummern {SYSTEMKONTEN.join(', ')} nutzt das Programm fest (Rücklage, Mieten, Hausgeld, Heizkosten, Kontoführung). Diese Nummern sind geschützt: Sie lassen sich weder ändern noch löschen (Bezeichnung und Haken schon).
      </p>
    </section>
    <EntityTable
      title="Buchungskonten (Kontenrahmen 2027)"
      table="buchungskonten"
      fields={[
        { key: 'nummer', label: 'Konto', required: true },
        { key: 'name', label: 'Bezeichnung', required: true, wide: true },
        { key: 'gruppe', label: 'Gruppe' },
        { key: 'art', label: 'Art', type: 'select', required: true, options: ['Aufwand', 'Ertrag', 'Einnahme', 'Bank', 'Kaution', 'Eigentümer'], hideInTable: true },
        { key: 'euer', label: 'EÜR', type: 'checkbox', format: haken, hinweis: (w) => ['1260', '1262'].includes(String(w.nummer)) ? 'Rücklagenkonto: steht immer in der Rücklagenentwicklung und im Vermögensbericht, nie als Kosten in der Hausgeldabrechnung.' : String(w.nummer) === '1261' && Number(w.euer) ? 'Entnahme aus der Rücklage: steht in der Rücklagenentwicklung und mit EÜR-Häkchen zusätzlich als Zeile bei den nicht umlagefähigen Kosten der Hausgeldabrechnung (gegen die daraus bezahlten Rechnungen).' : Number(w.euer) ? null : 'Ohne EÜR-Häkchen zählt dieses Konto nicht in der Hausgeld- und Eigentümerabrechnung und nicht in der Auswertung (GuV).' },
        { key: 'mwst', label: 'MwSt %', type: 'select', options: [{ value: 0, label: '0 %' }, { value: 7, label: '7 %' }, { value: 19, label: '19 %' }], format: (v) => (v ? v + ' %' : '–') },
        { key: 'umlagefaehig', label: 'Umlagefähig', type: 'checkbox', format: haken },
        { key: 'hdl', label: 'HDL', type: 'checkbox', format: haken },
        { key: 'hwl', label: 'HWL', type: 'checkbox', format: haken },
        { key: 'hbg', label: 'Minijob § 35a Abs. 1', type: 'checkbox', format: haken, hideInTable: true },
        { key: 'rechnung_pflicht', label: 'Rechnungs-Nr. Pflicht', type: 'checkbox', format: haken },
        { key: 'schluessel', label: 'Schlüssel (Vorschlag)', type: 'select', options: SCHLUESSEL },
      ]}
      listSql="SELECT * FROM buchungskonten ORDER BY nummer"
      groupBy="gruppe"
      loeschSperre={(r) => SYSTEMKONTEN.includes(String(r.nummer)) ? `Konto ${r.nummer} nutzt NEOSS fest und lässt sich nicht löschen.` : null}
    />
    </>
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
  ['mahnung_gebuehr_3', 'Gebühr 2. Mahnung (€) – bei Mietern höchstens 2,50 € je Mahnung (nur tatsächlicher Aufwand), bei Eigentümern nur mit Beschluss'],
  ['mahnung_frist_tage', 'Zahlungsfrist in Mahnungen (Tage)'],
  ['mahnen_ab_tage', 'Offene Posten auf „mahnen“ setzen ab (Tage nach Fälligkeit, Standard 14)'],
  ['ablage_pfad', 'Ablageordner für Dokumente (später NAS)'],
  ['fints_produkt_id', 'FinTS-Produkt-ID für den Bankabruf (kostenlos bei fints.org)'],
  ...DATEV_EINST.map(([k, l]): [string, string] => [k, l]),
];

export function EinstellungenPage() {
  const [w, setW] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [bkLoeschen, setBkLoeschen] = useState<Row | null>(null);
  const [bkVersion, setBkVersion] = useState(0);
  const [bkInfo, setBkInfo] = useState('');
  useEffect(() => { db.select('SELECT * FROM einstellungen').then((r) => setW(Object.fromEntries(r.map((x) => [x.schluessel, x.wert ?? ''])))); }, []);
  async function save() {
    for (const [k] of EINST.filter(([k]) => !(mehrplatz.aktiv && k === 'ablage_pfad'))) await db.execute(`INSERT INTO einstellungen (schluessel, wert) VALUES ($1, $2)
      ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert`, [k, w[k] ?? '']);
    if (sicherheit.aktiv && w.ablage_pfad) await sicherheit.ablageFreigeben(w.ablage_pfad).catch(() => {});
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  }
  return (
    <>
      <DarstellungKarte />
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
      <UnterschriftKarte />
      <VorlagenKarte />
      <KiKarte />
      <MehrplatzKarte />
      {!mehrplatz.aktiv && <SicherheitKarte />}
      <section className="card">
        <div className="card-head"><h2 className="title-ico"><FileSpreadsheet size={22} />Daten aus Excel übernehmen</h2><ImportKnopf /></div>
        <p className="muted small">Kontakte oder Einheiten einer Liegenschaft (auf Wunsch gleich mit Mieter und Mietvertrag) aus einer Excel- oder CSV-Tabelle übernehmen. Du siehst vorher eine Vorschau mit Prüfung, Doppelte werden übersprungen.</p>
      </section>
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
        onDelete={(r) => { setBkInfo(''); setBkLoeschen(r); }}
        version={bkVersion}
      />
      {bkInfo && <p className="info">{bkInfo}</p>}
      {bkLoeschen && <BankkontoLoeschen konto={bkLoeschen} onClose={() => setBkLoeschen(null)}
        onDone={(m) => { setBkLoeschen(null); setBkInfo(m); setBkVersion((v) => v + 1); }} />}
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


/** Darstellung: Hell, Dunkel (Forged Carbon) oder wie macOS */
function DarstellungKarte() {
  const [d, setD] = useState<Darstellung>(darstellungLesen);
  const [schrift, setSchrift] = useState<Schrift>(schriftLesen);
  const wahl: [Darstellung, string, string][] = [
    ['hell', 'Hell', 'Heller Hintergrund, wie bisher'],
    ['dunkel', 'Dunkel (Forged Carbon)', 'Carbon-Grau mit Bronze, Minus knallrot, Plus knallgrün'],
    ['system', 'Wie macOS', 'Folgt der Einstellung des Mac (hell am Tag, dunkel am Abend)'],
  ];
  return (
    <section className="card">
      <div className="card-head"><h2>Darstellung</h2></div>
      <div className="darstellung-wahl">
        {wahl.map(([k, t, b]) => (
          <button key={k} type="button" className={'darstellung-option ' + k + (d === k ? ' aktiv' : '')}
            onClick={() => { setD(k); darstellungSetzen(k); }}>
            <span className="darstellung-muster" aria-hidden="true" />
            <strong>{t}</strong><small>{b}</small>
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 14, alignItems: 'center' }}>
        <b>Schriftgröße</b>
        <div className="seg">{([['normal', 'Normal'], ['gross', 'Groß'], ['sehrgross', 'Sehr groß']] as [Schrift, string][]).map(([k, t]) => (
          <button key={k} type="button" className={schrift === k ? 'on' : ''} onClick={() => { setSchrift(k); schriftSetzen(k); }}>{t}</button>))}</div>
      </div>
      <p className="muted" style={{ marginBottom: 0 }}>Gilt sofort und nur auf diesem Mac. Ausdrucke und PDFs bleiben immer hell und in normaler Größe.</p>
    </section>
  );
}

