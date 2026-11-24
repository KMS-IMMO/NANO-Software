// WEG-Module: Beschlüsse und Versammlungen, Erhaltungsrücklage, Wirtschaftsplan; Instandhaltung (WEG und Miete).
import { PdfVorschau } from '../components/PdfVorschau';
import { BetragFeld, MengeFeld } from '../components/BetragFeld';
import { betragZahl } from '../lib/betrag';
import { einheitLabel } from '../db/labels';
import { useEffect, useState } from 'react';
import { BarChart3, CalendarDays, ClipboardList, Gavel, Pencil, PiggyBank, Wrench } from 'lucide-react';
import { EntityTable, datum, eur, num } from '../components/EntityTable';
import { db, type Row } from '../db';
import { kostenErmitteln, tageImJahr, verteilen, type Ergebnis, type Nutzer, type Position } from '../logic/verteilung';
import { Brief, absender, geld } from '../lib/pdf';
import { oeffnen, speichern as dateiSpeichern } from '../lib/dateien';
import { personLabel } from '../db/labels';
import { Eye, FileDown, Percent } from 'lucide-react';
import { OsaPlanVorschlag } from '../components/OsaPlanVorschlag';
import { differenzBuchen, ruecklageAbgleich, ruecklageJahr, ruecklageJahre } from '../logic/ruecklage';
import { RuecklageAuszugDialog } from '../components/RuecklageAuszugDialog';
import { useNavigate } from 'react-router-dom';
import { DatumFeld, JahrWahl } from '../components/DatumFeld';

const pill = (v: any, map: Record<string, string>) => v ? <span className={'pill ' + (map[v] ?? '')}>{v}</span> : '';
const STATUS_B: Record<string, string> = { 'Geplant': 'künftig', 'In Umsetzung': 'teil', 'Erledigt': 'bezahlt' };
const ERGEBNIS: Record<string, string> = { 'Angenommen': 'bezahlt', 'Abgelehnt': 'offen', 'Vertagt': 'teil' };
const STATUS_V: Record<string, string> = { 'Offen': 'offen', 'In Arbeit': 'künftig', 'Erledigt': 'bezahlt' };
const PRIO: Record<string, string> = { 'Hoch': 'offen', 'Mittel': 'teil', 'Niedrig': '' };
const STATUS_M: Record<string, string> = { 'Vorgesehen': 'teil', 'Geplant': 'künftig', 'Beschlossen': 'künftig', 'Umgesetzt': 'bezahlt' };
const objektOptions = 'SELECT id AS value, name AS label FROM objekte ORDER BY name';
const zahl = (s: string) => betragZahl(s) ?? 0;

/* =================== Beschlüsse und Versammlungen =================== */

export function BeschluesseTab({ objektId, nurBeschluesse }: { objektId?: number; nurBeschluesse?: boolean }) {
  const wo = objektId ? 'WHERE b.objekt_id = $1' : '';
  const params = objektId ? [objektId] : [];
  return (
    <>
      {!nurBeschluesse && <EntityTable
        title="Eigentümerversammlungen"
        icon={<CalendarDays size={22} />}
        newLabel="Versammlung anlegen"
        table="versammlungen"
        fields={[
          ...(objektId ? [] : [{ key: 'objekt_id', label: 'Liegenschaft', type: 'select' as const, optionsSql: objektOptions, required: true }]),
          { key: 'datum', label: 'Datum', type: 'date', required: true },
          { key: 'uhrzeit', label: 'Uhrzeit', type: 'time', format: (v) => v || '' },
          { key: 'art', label: 'Art', type: 'select', options: ['Ordentliche Versammlung', 'Außerordentliche Versammlung', 'Umlaufbeschluss'], required: true },
          { key: 'ort', label: 'Ort' },
          { key: 'status', label: 'Status', type: 'select', options: ['Geplant', 'Eingeladen', 'Durchgeführt'], format: (v) => pill(v, { Geplant: 'künftig', Eingeladen: 'teil', Durchgeführt: 'bezahlt' }) },
          { key: 'beschluesse', label: 'Beschlüsse', computed: true, type: 'number', format: (v) => num(v, 0) },
          { key: 'notiz', label: 'Notiz / Tagesordnung', type: 'textarea', hideInTable: true },
        ]}
        listSql={`SELECT b.*, o.name AS objekt_id_label, (SELECT COUNT(*) FROM beschluesse x WHERE x.versammlung_id = b.id) AS beschluesse
          FROM versammlungen b JOIN objekte o ON o.id = b.objekt_id ${wo} ORDER BY b.datum DESC`}
        listParams={params}
        fixed={objektId ? { objekt_id: objektId } : undefined}
        emptyText="Noch keine Versammlung angelegt. Geplante Versammlungen erscheinen automatisch im Kalender."
      />}
      <EntityTable
        title={nurBeschluesse ? 'Beschluss-Sammlung' : objektId ? 'Beschlüsse' : 'Beschlusssammlung'}
        icon={<Gavel size={22} />}
        newLabel="Beschluss hinzufügen"
        table="beschluesse"
        fields={[
          { key: 'nummer', label: 'Nr.', format: (v) => <b style={{ whiteSpace: 'nowrap' }}>{v}</b> },
          ...(objektId ? [] : [{ key: 'objekt_id', label: 'Liegenschaft', type: 'select' as const, optionsSql: objektOptions, required: true }]),
          { key: 'datum', label: 'Datum (EV)', type: 'date', required: true },
          { key: 'versammlung_id', label: 'Versammlung', type: 'select', hideInTable: true,
            optionsSql: `SELECT v.id AS value, o.name || ' – ' || v.datum || ' ' || v.art AS label FROM versammlungen v JOIN objekte o ON o.id = v.objekt_id
              ${objektId ? `WHERE v.objekt_id = ${Number(objektId)}` : ''} ORDER BY v.datum DESC` },
          { key: 'betreff', label: 'Betreff', required: true, wide: true },
          { key: 'art', label: 'Beschlussart', type: 'select', options: ['Investition', 'Instandhaltung', 'Finanzen', 'Organisation', 'Sonstiges'] },
          { key: 'betrag', label: 'Betrag', type: 'number', geld: true, format: (v) => v ? eur(v) : '' },
          { key: 'ergebnis', label: 'Ergebnis', type: 'select', options: ['Angenommen', 'Abgelehnt', 'Vertagt'], required: true,
            format: (v, r) => <>{pill(v, ERGEBNIS)}{r.zustimmung != null && <span className="muted small"> {num(r.zustimmung, 0)} %</span>}</> },
          { key: 'zustimmung', label: 'Zustimmung in %', type: 'number', hideInTable: true },
          { key: 'status', label: 'Status', type: 'select', options: ['Geplant', 'In Umsetzung', 'Erledigt'], required: true, format: (v) => pill(v, STATUS_B) },
          { key: 'anfechtung_bis', label: 'Anfechtbar bis', type: 'date', format: (v) => v ? (v >= new Date().toISOString().slice(0, 10) ? <span className="pill teil">{datum(v)}</span> : <span className="muted small">bestandskräftig</span>) : '' },
          { key: 'notiz', label: 'Beschlusstext / Notiz', type: 'textarea', hideInTable: true },
        ]}
        listSql={`SELECT b.*, o.name AS objekt_id_label FROM beschluesse b JOIN objekte o ON o.id = b.objekt_id ${wo} ORDER BY b.datum DESC, b.nummer DESC`}
        listParams={params}
        fixed={objektId ? { objekt_id: objektId } : undefined}
        emptyText="Noch keine Beschlüsse. Nummer z. B. B-2025-01."
      />
    </>
  );
}

/* =================== Instandhaltung / Vorgänge =================== */

export function VorgaengeTab({ objektId }: { objektId?: number }) {
  const [filter, setFilter] = useState('Alle');
  const [n, setN] = useState<Row>({});
  const where = [objektId ? 'v.objekt_id = $1' : '', filter !== 'Alle' ? `v.status = '${filter}'` : ''].filter(Boolean);
  const params = objektId ? [objektId] : [];
  const zaehlen = () => db.select(`SELECT COUNT(*) alle, SUM(status = 'Offen') offen, SUM(status = 'In Arbeit') arbeit, SUM(status = 'Erledigt') erledigt
      FROM vorgaenge v ${objektId ? 'WHERE v.objekt_id = $1' : ''}`, params).then((r) => setN(r[0] ?? {}));
  useEffect(() => { zaehlen(); }, [objektId]);
  return (
    <>
      <div className="tabs">
        {[['Alle', n.alle], ['Offen', n.offen], ['In Arbeit', n.arbeit], ['Erledigt', n.erledigt]].map(([t, c]) => (
          <button key={t} className={filter === t ? 'on' : ''} onClick={() => setFilter(t)}>{t} ({Number(c) || 0})</button>))}
      </div>
      <EntityTable
        key={filter}
        title="Instandhaltung"
        icon={<Wrench size={22} />}
        newLabel="Vorgang anlegen"
        table="vorgaenge"
        onChange={zaehlen}
        fields={[
          { key: 'nr', label: 'Nr.', computed: true, format: (_, r) => <b>I-{1000 + Number(r.id)}</b> },
          ...(objektId ? [] : [{ key: 'objekt_id', label: 'Liegenschaft', type: 'select' as const, optionsSql: objektOptions, required: true }]),
          { key: 'einheit_id', label: 'Einheit', type: 'select', hideInTable: true, leer: 'Gesamtes Objekt',
            optionsSql: `SELECT e.id AS value, ${objektId ? '' : "o.name || ' – ' || "}${einheitLabel('e')} AS label FROM einheiten e JOIN objekte o ON o.id = e.objekt_id
              ${objektId ? `WHERE e.objekt_id = ${Number(objektId)}` : ''} ORDER BY o.name, e.lfd_nr, e.nummer` },
          { key: 'betreff', label: 'Betreff', required: true, wide: true, format: (v, r) => <>{v}{r.einheit_id_label && <div className="muted small">{r.einheit_id_label}</div>}</> },
          { key: 'art', label: 'Art', type: 'select', options: ['Instandhaltung', 'Wartung', 'Schaden', 'Versicherungsschaden', 'Anfrage', 'Sonstiges'] },
          { key: 'prioritaet', label: 'Priorität', type: 'select', options: ['Niedrig', 'Mittel', 'Hoch'], required: true, format: (v) => pill(v, PRIO) },
          { key: 'status', label: 'Status', type: 'select', options: ['Offen', 'In Arbeit', 'Erledigt'], required: true, format: (v) => pill(v, STATUS_V) },
          { key: 'faellig', label: 'Fälligkeit', type: 'date',
            format: (v, r) => <span className={v && r.status !== 'Erledigt' && v < new Date().toISOString().slice(0, 10) ? 'neg' : ''}>{datum(v)}</span> },
          { key: 'firma_id', label: 'Firma', type: 'select', optionsSql: 'SELECT id AS value, name AS label FROM firmen ORDER BY name' },
          { key: 'kosten', label: 'Kosten (geplant)', type: 'number', geld: true, format: (v) => v ? eur(v) : '', sum: true },
          { key: 'erledigt_am', label: 'Erledigt am', type: 'date', hideInTable: true },
          { key: 'notiz', label: 'Beschreibung', type: 'textarea', hideInTable: true },
        ]}
        listSql={`SELECT v.*, o.name AS objekt_id_label, f.name AS firma_id_label, e.nummer AS einheit_id_label
          FROM vorgaenge v JOIN objekte o ON o.id = v.objekt_id LEFT JOIN firmen f ON f.id = v.firma_id LEFT JOIN einheiten e ON e.id = v.einheit_id
          ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          ORDER BY v.status = 'Erledigt', CASE v.prioritaet WHEN 'Hoch' THEN 0 WHEN 'Mittel' THEN 1 ELSE 2 END, v.faellig`}
        listParams={params}
        fixed={objektId ? { objekt_id: objektId } : undefined}
        emptyText="Keine Vorgänge."
      />
    </>
  );
}

export function InstandhaltungPage() {
  return (
    <>
      <div className="page-head"><h1>Instandhaltung</h1><p className="muted">Reparaturen, Wartungen und Schäden aller Liegenschaften</p></div>
      <VorgaengeTab />
    </>
  );
}

export function BeschluessePage() {
  return (
    <>
      <div className="page-head"><h1>Beschlusssammlung</h1><p className="muted">Versammlungen und Beschlüsse aller WEG (§ 24 Abs. 7 WEG)</p></div>
      <BeschluesseTab />
    </>
  );
}

/* =================== Erhaltungsrücklage =================== */

export function RuecklagenTab({ objektId }: { objektId: number }) {
  const nav = useNavigate();
  const [jahr, setJahr] = useState(new Date().getFullYear());
  const [j, setJ] = useState<Row>({});
  const [g, setG] = useState<Awaited<ReturnType<typeof ruecklageAbgleich>> | null>(null);
  const [jahre, setJahre] = useState<Awaited<ReturnType<typeof ruecklageJahre>>>([]);
  const [basis, setBasis] = useState({ anfang: '', stichtag: '' });
  const [meaGes, setMeaGes] = useState(0);
  const [info, setInfo] = useState('');
  const [fehler, setFehler] = useState('');
  const [offen, setOffen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setJ(await ruecklageJahr(objektId, jahr));
    setG(await ruecklageAbgleich(objektId, jahr));
    setJahre(await ruecklageJahre(objektId, jahr, 4));
    const o = (await db.select('SELECT ruecklage_anfang, ruecklage_stichtag, gesamt_mea FROM objekte WHERE id = $1', [objektId]))[0] ?? {};
    setBasis({ anfang: o.ruecklage_anfang ? String(o.ruecklage_anfang).replace('.', ',') : '', stichtag: o.ruecklage_stichtag ?? '' });
    const m = (await db.select('SELECT SUM(mea) AS m FROM einheiten WHERE objekt_id = $1', [objektId]))[0]?.m;
    setMeaGes(Number(o.gesamt_mea) || Number(m) || 0);
  };
  useEffect(() => { setInfo(''); setFehler(''); load(); }, [objektId, jahr]);

  async function basisSpeichern() {
    await db.execute('UPDATE objekte SET ruecklage_anfang = $1, ruecklage_stichtag = $2 WHERE id = $3', [zahl(basis.anfang), basis.stichtag || null, objektId]);
    setInfo('Übernahmebestand gespeichert.');
    load();
  }
  async function nachbuchen() {
    setBusy(true); setFehler(''); setInfo('');
    try {
      const r = await differenzBuchen(objektId, jahr);
      setInfo(`Gebucht: ${eur(r.betrag)} auf Konto ${r.konto} (${r.konto === '1261' ? 'Entnahme / Kosten' : 'Zinsen / Zugang'}) zum ${datum(g!.bis)}, ohne Bank. Die Buchung findest du unter Einnahmen & Ausgaben.`);
      await load();
    } catch (e: any) { setFehler(String(e?.message ?? e)); }
    setBusy(false);
  }

  const a = g?.auszug;
  const stimmt = g?.endeDiff !== null && g?.endeDiff !== undefined && Math.abs(g.endeDiff) < 0.005;
  const diffKlasse = (d: number | null | undefined) => (d === null || d === undefined ? '' : Math.abs(d) < 0.005 ? 'pos' : 'neg');
  const vorjahrEnde = jahre.find((x) => x.jahr === jahr - 1);
  const balken = jahre.map((x) => ({ jahr: x.jahr, wert: x.ende ?? x.buchungen, auszug: x.ende !== null, datum: x.endeDatum }));
  const max = Math.max(1, ...balken.map((v) => v.wert));
  const bisText = g ? (g.bis.endsWith('-12-31') ? `31.12.${jahr}` : datum(g.bis)) : '';
  return (
    <>
      <div className="card row rl-kopf">
        <h2 className="title-ico" style={{ margin: 0 }}><PiggyBank size={22} />Rücklagen</h2>
        <label className="inline">Jahr <JahrWahl value={jahr} onChange={setJahr} /></label>
        {g?.bank ? <span className="muted small">{g.bank.name}{g.bank.iban ? ' · ' + String(g.bank.iban).replace(/\s/g, '').replace(/(.{4})/g, '$1 ').trim() : ''}</span> : null}
        <span className="grow" />
        <button className="primary" onClick={() => setOffen(true)}><Pencil size={15} />Bestände laut Kontoauszug</button>
      </div>

      {g && <div className="ks-leiste rl-leiste" aria-live="polite">
        <div className="ks-wert"><span>Anfangsbestand 01.01.{jahr} laut Auszug</span><b>{a?.anfang !== null && a ? eur(a.anfang) : '–'}</b><small>
          <button className="ks-start-knopf" onClick={() => setOffen(true)}>{a?.anfang !== null && a ? `${a.anfangAuszug ? 'Auszug Nr. ' + a.anfangAuszug + ' ' : ''}(von Hand)` : 'noch nicht eingegeben'}<Pencil size={11} /></button></small></div>
        <div className="ks-wert"><span>Endbestand laut Kontoauszug</span><b>{a?.ende !== null && a ? eur(a.ende) : '–'}</b><small>
          <button className="ks-start-knopf" onClick={() => setOffen(true)}>{a?.ende !== null && a ? `${a.endeAuszug ? 'Auszug Nr. ' + a.endeAuszug + ' ' : ''}vom ${datum(a.endeDatum)} (von Hand)` : 'noch nicht eingegeben'}<Pencil size={11} /></button></small></div>
        <div className="ks-wert"><span>Stand laut Buchungen {bisText}</span><b>{eur(g.endeBuchungen)}</b>
          <small>{a?.anfang !== null && a ? 'Anfangsbestand laut Auszug' : 'Endstand Vorjahr'} + Buchungen auf 1260–1262</small></div>
        <div className={'ks-wert ks-diff ' + (g.endeDiff === null ? '' : stimmt ? 'ok' : 'nein')}><span>Differenz</span>
          <b>{g.endeDiff === null ? '–' : stimmt ? 'stimmt' : eur(g.endeDiff)}</b>
          <small>{g.endeDiff === null ? 'Endbestand eingeben, dann wird verglichen' : stimmt ? 'Auszug und Buchungen passen zusammen' : g.endeDiff < 0 ? 'Auszug liegt unter den Buchungen' : 'Auszug liegt über den Buchungen'}</small></div>
        <div className="ks-gruende">
          {!g.bank && <span className="ks-chip grau" title="Kein Bankkonto mit „Rücklage“ im Namen angelegt">Rücklagenkonto ohne Kontoumsätze</span>}
          {g.offen > 0 && <button className="ks-chip gelb" onClick={() => nav(`/objekte/${objektId}/bank`)} title="Kontoumsätze des Rücklagenkontos, die noch keiner Buchung zugeordnet sind">● {g.offen} Umsätze ohne Buchung · {eur(g.offenSumme)}</button>}
          {stimmt && <span className="ks-chip gruen">✓ alles gebucht</span>}
        </div>
      </div>}

      <div className="grid2 rl-grid">
        <section className="card">
          <div className="card-head"><h2 className="title-ico"><PiggyBank size={22} />Rücklagenkonto {jahr}</h2></div>
          {g && <table className="list rl-tabelle">
            <thead><tr><th>Position</th><th className="num">laut Buchungen</th><th className="num">laut Kontoauszug</th><th className="num">Differenz</th></tr></thead>
            <tbody>
              <tr className="rl-auszug-zeile"><td>Anfangsbestand 01.01.{jahr}</td><td className="num">{eur(g.anfangBuchungen)}</td>
                <td className="num">{a?.anfang !== null && a ? <>{eur(a.anfang)}<span className="rl-hand">von Hand</span></> : <span className="muted">–</span>}</td>
                <td className={'num ' + diffKlasse(g.anfangDiff)}>{g.anfangDiff === null ? '' : eur(g.anfangDiff)}</td></tr>
              {g.uebernahme ? <tr><td>+ Übernahmebestand ({datum(basis.stichtag)})</td><td className="num">{eur(g.uebernahme)}</td><td /><td /></tr> : null}
              <tr><td>+ Zuführungen gezahlt (Hausgeld-Anteil)<div className="muted small">Soll {eur(g.zufuehrung)}{Math.abs(g.zufuehrung - g.zufuehrungIst) > 0.005 ? `, offen ${eur(g.zufuehrung - g.zufuehrungIst)}` : ''}</div></td>
                <td className="num">{eur(g.zufuehrungIst)}</td><td className="num muted">–</td><td /></tr>
              {g.sonder ? <tr><td>+ Sonderzuführungen (Konto 1260)</td><td className="num">{eur(g.sonder)}</td><td className="num muted">–</td><td /></tr> : null}
              <tr><td>+ Zinsen (Konto 1262)</td><td className="num">{eur(g.zinsen)}</td><td className="num muted">–</td><td /></tr>
              <tr><td>− Entnahmen (Konto 1261)</td><td className={'num' + (g.entnahme ? ' neg' : '')}>{eur(-g.entnahme)}</td><td className="num muted">–</td><td /></tr>
              <tr className="sum"><td>= Endbestand {bisText}</td><td className="num">{eur(g.endeBuchungen)}</td>
                <td className="num">{a?.ende !== null && a ? eur(a.ende) : '–'}</td><td className={'num ' + diffKlasse(g.endeDiff)}>{g.endeDiff === null ? '' : eur(g.endeDiff)}</td></tr>
              <tr><td className="muted">Rücklage je MEA{meaGes ? ` (${num(meaGes, 0)} MEA)` : ''}</td><td className="num muted">{meaGes ? eur(g.endeBuchungen / meaGes) : '–'}</td>
                <td className="num muted">{meaGes && a?.ende !== null && a ? eur(a.ende / meaGes) : ''}</td><td /></tr>
            </tbody>
          </table>}
          {g && g.endeDiff !== null && !stimmt && <div className="ks-hinweis rl-hinweis">
            <span><b>{eur(Math.abs(g.endeDiff))} {g.endeDiff < 0 ? 'fehlen in den Buchungen' : 'mehr auf dem Konto als gebucht'}.</b> {g.endeDiff < 0
              ? 'Auf dem Kontoauszug steht weniger als laut Buchungen, z. B. Kontoführungsentgelt oder eine Entnahme, die noch nicht gebucht ist.'
              : 'Auf dem Kontoauszug steht mehr als laut Buchungen, z. B. Zinsen oder eine Zuführung, die noch nicht gebucht ist.'} Bitte prüfen und buchen, dann stimmt die Rücklage.</span>
            <span className="row" style={{ gap: 8 }}>
              <button className="primary small" disabled={busy} onClick={nachbuchen}>{eur(g.endeDiff)} jetzt buchen ({g.endeDiff < 0 ? '1261' : '1262'})</button>
              <button className="small" onClick={() => nav(`/objekte/${objektId}/buchungen`)}>Zu Einnahmen &amp; Ausgaben</button>
            </span>
          </div>}
          {g && stimmt && <p className="rl-ok">✓ Rücklage stimmt mit dem Kontoauszug vom {datum(g.bis)} überein.</p>}
          {Math.abs((j.offen ?? 0)) > 0.005 && <p className="muted small">Laut Hausgeld-Soll wäre die Rücklage am 31.12.{jahr} {eur(j.bestand ?? 0)}; {eur(j.offen)} davon haben Eigentümer noch nicht gezahlt.</p>}
          {info && <p className="info">{info}</p>}
          {fehler && <p className="error">{fehler}</p>}
          <details className="rl-uebernahme">
            <summary className="muted small">Bestand bei Übernahme der Verwaltung</summary>
            <div className="row" style={{ marginTop: 10 }}>
              <label className="inline small">Bestand <input className="cell" value={basis.anfang} onChange={(e) => setBasis({ ...basis, anfang: e.target.value })} /> €</label>
              <label className="inline small">am <DatumFeld style={{ width: 150 }} value={basis.stichtag} onChange={(e) => setBasis({ ...basis, stichtag: e.target.value })} /></label>
              <button onClick={basisSpeichern}>Speichern</button>
            </div>
          </details>
        </section>
        <section className="card">
          <div className="card-head"><h2 className="title-ico"><BarChart3 size={22} />Jahre im Überblick</h2></div>
          <p className="muted small" style={{ marginTop: -6 }}>Anfangs- und Endbestand laut Kontoauszug</p>
          <table className="list">
            <thead><tr><th>Jahr</th><th className="num">Anfang 01.01.</th><th className="num">Ende laut Auszug</th><th className="num">Differenz</th></tr></thead>
            <tbody>{jahre.map((x) => (
              <tr key={x.jahr} className={x.jahr === jahr ? 'rl-aktiv' : ''} onClick={() => setJahr(x.jahr)} style={{ cursor: 'pointer' }}>
                <td>{x.jahr === jahr ? <b>{x.jahr}</b> : x.jahr}{x.ende !== null && x.endeDatum && !x.endeDatum.endsWith('-12-31') ? <div className="muted small">Stand {datum(x.endeDatum)}</div> : null}</td>
                <td className="num">{x.anfang !== null ? eur(x.anfang) : <span className="muted">–</span>}</td>
                <td className="num">{x.ende !== null ? eur(x.ende) : <span className="muted">–</span>}</td>
                <td className="num">{x.endeDiff === null ? <span className="muted">–</span> : Math.abs(x.endeDiff) < 0.005 ? <span className="pill bezahlt">stimmt</span> : <span className="pill offen">{eur(x.endeDiff)}</span>}</td>
              </tr>))}
            </tbody>
          </table>
          {vorjahrEnde && vorjahrEnde.ende !== null && a?.anfang !== null && a && Math.abs(vorjahrEnde.ende - a.anfang) > 0.005 && <p className="ks-hinweis small" style={{ marginTop: 10 }}>
            Endbestand {jahr - 1} laut Auszug ({eur(vorjahrEnde.ende)}) und Anfangsbestand {jahr} ({eur(a.anfang)}) passen nicht zusammen.</p>}
          <svg viewBox="0 0 500 200" width="100%" role="img" aria-label="Entwicklung der Rücklage" style={{ marginTop: 10 }}>
            <defs><linearGradient id="rlGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#B08A4A" /><stop offset="1" stopColor="#E2C48D" /></linearGradient>
              <pattern id="rlStreifen" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="#EFDDBA" /><rect width="5" height="10" fill="#E2C48D" /></pattern></defs>
            {balken.map((v, i) => {
              const h = Math.max(0, (v.wert / max) * 140), x = 40 + i * (440 / Math.max(1, balken.length));
              return (
                <g key={v.jahr}>
                  <rect x={x} y={165 - h} width={60} height={h} rx={6} fill={v.auszug ? 'url(#rlGold)' : 'url(#rlStreifen)'} />
                  <text x={x + 30} y={185} textAnchor="middle" fontSize="12" fill="#6b6f76">{v.jahr}{v.auszug && v.datum && !v.datum.endsWith('-12-31') ? ` (${datum(v.datum).slice(0, 6)})` : ''}</text>
                  <text x={x + 30} y={158 - h} textAnchor="middle" fontSize="11" fill="currentColor">{eur(v.wert)}</text>
                </g>);
            })}
          </svg>
          <p className="muted small">Gold: Endbestand laut Kontoauszug. Gestreift: noch kein Auszug eingegeben, Stand laut Buchungen. Klick auf ein Jahr wählt es aus.</p>
        </section>
      </div>
      {offen && g && <RuecklageAuszugDialog objektId={objektId} jahr={jahr} g={g} endeAbschluss={vorjahrEnde?.ende ?? null}
        onClose={() => setOffen(false)} onDone={() => { setOffen(false); setInfo('Bestände laut Kontoauszug gespeichert.'); load(); }} />}
      <EntityTable
        title="Geplante Maßnahmen aus der Rücklage"
        icon={<ClipboardList size={22} />}
        newLabel="Maßnahme hinzufügen"
        table="ruecklage_massnahmen"
        fields={[
          { key: 'massnahme', label: 'Maßnahme', required: true, wide: true },
          { key: 'betrag', label: 'Geplanter Betrag', type: 'number', geld: true, format: eur, sum: true, required: true },
          { key: 'jahr', label: 'Zeitraum (Jahr)', type: 'number', format: (v) => v ?? '' },
          { key: 'status', label: 'Status', type: 'select', options: ['Vorgesehen', 'Geplant', 'Beschlossen', 'Umgesetzt'], required: true, format: (v) => pill(v, STATUS_M) },
          { key: 'notiz', label: 'Notiz', type: 'textarea', hideInTable: true },
        ]}
        listSql="SELECT * FROM ruecklage_massnahmen WHERE objekt_id = $1 ORDER BY jahr, massnahme"
        listParams={[objektId]}
        fixed={{ objekt_id: objektId }}
        emptyText="Noch keine Maßnahmen geplant."
      />
    </>
  );
}

/* =================== Wirtschaftsplan =================== */

const RUECKLAGE_KONTO = '1260';

export function WirtschaftsplanTab({ objektId }: { objektId: number }) {
  const [jahr, setJahr] = useState(new Date().getFullYear() + 1);
  const [konten, setKonten] = useState<Row[]>([]);
  const [plan, setPlan] = useState<Record<number, string>>({});
  // Prozentprognose: je Kostenart ein Prozentsatz auf die Ausgangsbasis (Ist Vorjahr, sonst der Planwert beim ersten Eintragen)
  const [prozent, setProzent] = useState<Record<number, string>>({});
  const [basis, setBasis] = useState<Record<number, number>>({});
  const [alleProzent, setAlleProzent] = useState('');
  const [vorjahr, setVorjahr] = useState<Record<number, number>>({});
  const [einheiten, setEinheiten] = useState<Row[]>([]);
  const [verteilung, setVerteilung] = useState<Record<number, { kosten: number; ruecklage: number }>>({});
  const [details, setDetails] = useState<{ k: Ergebnis[]; r: Ergebnis[] }>({ k: [], r: [] });
  const [pdf, setPdf] = useState<{ bytes: Uint8Array } | null>(null);
  const [busy, setBusy] = useState('');
  const [objName, setObjName] = useState('');
  const [info, setInfo] = useState('');

  const load = async () => {
    const k = await db.select(`SELECT k.*, s.schluessel AS objekt_schluessel FROM buchungskonten k
      LEFT JOIN objekt_schluessel s ON s.buchungskonto_id = k.id AND s.objekt_id = $1
      WHERE k.art = 'Aufwand' AND k.nummer NOT IN ('1261', '1262', '1601', '1602') ORDER BY k.nummer = '${RUECKLAGE_KONTO}', k.nummer`, [objektId]);
    setKonten(k);
    const p = await db.select('SELECT * FROM wirtschaftsplan WHERE objekt_id = $1 AND jahr = $2', [objektId, jahr]);
    setPlan(Object.fromEntries(p.map((x) => [x.buchungskonto_id, String(x.betrag).replace('.', ',')])));
    setProzent({}); setBasis({}); setAlleProzent('');
    const ist = await kostenErmitteln(objektId, jahr - 1, false);
    setVorjahr(Object.fromEntries(ist.map((x) => [x.konto_id, x.betrag])));
    setEinheiten(await db.select('SELECT * FROM einheiten WHERE objekt_id = $1 ORDER BY lfd_nr, nummer', [objektId]));
    setObjName((await db.select('SELECT name FROM objekte WHERE id = $1', [objektId]))[0]?.name ?? '');
    setInfo('');
  };
  useEffect(() => { load(); }, [objektId, jahr]);

  // Hausgeld je Einheit aus dem Plan: Kosten nach Schlüssel (Verbrauch u. ä. vorläufig nach MEA), Rücklage nach MEA
  useEffect(() => {
    if (!einheiten.length) return;
    const T = tageImJahr(jahr);
    const nutzer: Nutzer[] = einheiten.map((e) => ({ key: `e${e.id}`, art: 'Eigentümer', einheit_id: e.id, person_id: null, name: e.nummer,
      von: `${jahr}-01-01`, bis: `${jahr}-12-31`, tage: T, personen: e.personenzahl != null ? Number(e.personenzahl) : 1, anteil: 100 }));
    const pos = (ruecklage: boolean): Position[] => konten.filter((k) => (k.nummer === RUECKLAGE_KONTO) === ruecklage && zahl(plan[k.id] ?? '') !== 0).map((k) => {
      const s = ruecklage ? 'MEA' : (k.objekt_schluessel ?? 'MEA');
      return { konto_id: k.id, nummer: k.nummer, name: k.name, gruppe: k.gruppe ?? '', umlagefaehig: !!k.umlagefaehig, hdl: false, hwl: false,
        betrag: zahl(plan[k.id] ?? ''), schluessel: ['Verbrauch', 'Summe', 'Direkt', 'Messdienst'].includes(s) ? 'MEA' : s };
    });
    const werte = { verbrauch: {}, messdienst: {} };
    const k = verteilen(jahr, einheiten, nutzer, pos(false), werte), r = verteilen(jahr, einheiten, nutzer, pos(true), werte);
    setVerteilung(Object.fromEntries(einheiten.map((e) => [e.id, { kosten: k.find((x) => x.nutzer.einheit_id === e.id)?.summe ?? 0, ruecklage: r.find((x) => x.nutzer.einheit_id === e.id)?.summe ?? 0 }])));
    setDetails({ k, r });
  }, [plan, konten, einheiten, jahr]);

  async function speichern() {
    for (const k of konten) {
      const v = plan[k.id];
      if (v === undefined) continue;
      if (v.trim() === '') await db.execute('DELETE FROM wirtschaftsplan WHERE objekt_id = $1 AND jahr = $2 AND buchungskonto_id = $3', [objektId, jahr, k.id]);
      else await db.execute(`INSERT INTO wirtschaftsplan (objekt_id, jahr, buchungskonto_id, betrag) VALUES ($1, $2, $3, $4)
        ON CONFLICT (objekt_id, jahr, buchungskonto_id) DO UPDATE SET betrag = excluded.betrag`, [objektId, jahr, k.id, zahl(v)]);
    }
    setInfo('Wirtschaftsplan gespeichert.');
  }

  async function vorjahrUebernehmen() {
    const p = { ...plan };
    for (const k of konten) if (vorjahr[k.id] && !p[k.id]) p[k.id] = String(Math.round(vorjahr[k.id] * 100) / 100).replace('.', ',');
    // Zuführung zur Rücklage ist keine Ausgabe im Ist: aus dem aktuellen Hausgeld übernehmen
    const rk = konten.find((k) => k.nummer === RUECKLAGE_KONTO);
    if (rk && !p[rk.id]) {
      const rl = Number((await db.select(`SELECT COALESCE(SUM(h.davon_ruecklage), 0) * 12 AS rl FROM hausgeld h JOIN einheiten e ON e.id = h.einheit_id
        WHERE e.objekt_id = $1 AND h.gueltig_ab = (SELECT MAX(y.gueltig_ab) FROM hausgeld y WHERE y.einheit_id = h.einheit_id AND y.gueltig_ab < $2)`, [objektId, `${jahr}-01-01`]))[0]?.rl ?? 0);
      if (rl) p[rk.id] = String(Math.round(rl * 100) / 100).replace('.', ',');
    }
    setPlan(p);
  }

  async function hausgeldUebernehmen() {
    const ab = `${jahr}-01-01`;
    if (!window.confirm(`Neues Hausgeld ab ${datum(ab)} für alle ${einheiten.length} Einheiten eintragen? Bestehende Einträge mit diesem Datum werden ersetzt.`)) return;
    await speichern();
    for (const e of einheiten) {
      const v = verteilung[e.id] ?? { kosten: 0, ruecklage: 0 };
      const betrag = Math.round(((v.kosten + v.ruecklage) / 12) * 100) / 100, rl = Math.round((v.ruecklage / 12) * 100) / 100;
      await db.execute('DELETE FROM hausgeld WHERE einheit_id = $1 AND gueltig_ab = $2', [e.id, ab]);
      await db.execute('INSERT INTO hausgeld (einheit_id, gueltig_ab, betrag, davon_ruecklage) VALUES ($1, $2, $3, $4)', [e.id, ab, betrag, rl]);
    }
    setInfo(`Hausgeld ab ${datum(ab)} für ${einheiten.length} Einheiten eingetragen (Reiter Hausgeldplan).`);
  }

  /** Gesamtwirtschaftsplan an die Gemeinschaft und Einzelwirtschaftsplan je Eigentümer und Einheit */
  async function planPdf(entwurf: boolean): Promise<Uint8Array> {
    const o = (await db.select('SELECT * FROM objekte WHERE id = $1', [objektId]))[0];
    const abs = await absender();
    const b = new Brief(abs);
    const heute = new Date().toISOString().slice(0, 10);
    const ort = [o.plz, o.ort].filter(Boolean).join(' ');
    const planPos = konten.filter((k) => zahl(plan[k.id] ?? '') !== 0);
    const kU = planPos.filter((k) => k.nummer !== RUECKLAGE_KONTO && k.umlagefaehig), kN = planPos.filter((k) => k.nummer !== RUECKLAGE_KONTO && !k.umlagefaehig);
    const sum = (l: Row[]) => l.reduce((a, k) => a + zahl(plan[k.id] ?? ''), 0);
    const zeile = (k: Row) => [k.nummer, k.name, k.objekt_schluessel ?? 'MEA', vorjahr[k.id] ? geld(vorjahr[k.id]) : '–', geld(zahl(plan[k.id] ?? ''))];
    // Gesamtwirtschaftsplan
    b.neuerBrief();
    b.kopf([`Wohnungseigentümergemeinschaft ${String(o.name).replace(/^WEG\s+/i, '')}`, o.strasse, ort], heute);
    b.betreff(`Gesamtwirtschaftsplan ${jahr} (01.01.–31.12.${jahr})`);
    b.absatz(`Der Wirtschaftsplan zeigt die voraussichtlichen Kosten der Gemeinschaft für ${jahr} und die Zuführung zur Erhaltungsrücklage. Daraus ergibt sich das monatliche Hausgeld je Einheit (§ 28 Abs. 1 WEG). Zum Vergleich stehen die tatsächlichen Kosten ${jahr - 1}.`);
    if (kU.length) b.tabelle(['Konto', 'Umlagefähige Kosten', 'Schlüssel', `Ist ${jahr - 1}`, `Plan ${jahr}`], kU.map(zeile), [['', 'Summe umlagefähige Kosten', '', '', geld(sum(kU))]], 3);
    if (kN.length) b.tabelle(['Konto', 'Nicht umlagefähige Kosten', 'Schlüssel', `Ist ${jahr - 1}`, `Plan ${jahr}`], kN.map(zeile), [['', 'Summe nicht umlagefähige Kosten', '', '', geld(sum(kN))]], 3);
    b.tabelle(['', `Plan ${jahr}`], [['Umlagefähige Kosten', geld(sum(kU))], ['Nicht umlagefähige Kosten', geld(sum(kN))], ['Zuführung Erhaltungsrücklage', geld(ruecklage)]],
      [['Gesamtbetrag Wirtschaftsplan', geld(kosten + ruecklage)]]);
    b.tabelle(['Einheit', 'MEA', 'Kosten p. a.', 'Rücklage p. a.', 'Hausgeld p. M.'], einheiten.map((e) => {
      const v = verteilung[e.id] ?? { kosten: 0, ruecklage: 0 };
      return [e.nummer, num(e.mea, 0), geld(v.kosten), geld(v.ruecklage), geld((v.kosten + v.ruecklage) / 12)];
    }), [['Gesamt', num(einheiten.reduce((a, e) => a + (Number(e.mea) || 0), 0), 0), geld(kosten), geld(ruecklage), geld((kosten + ruecklage) / 12)]], 1);
    b.absatz('Der Wirtschaftsplan wird in der Eigentümerversammlung beschlossen. Bis dahin gilt das bisherige Hausgeld weiter.');
    b.gruss();
    // Einzelwirtschaftspläne je Eigentümer
    const eig = await db.select(`SELECT ei.einheit_id, p.id AS pid, ${personLabel('p')} AS name, p.vorname, p.nachname, p.firma, p.strasse, p.plz, p.ort
      FROM eigentum ei JOIN personen p ON p.id = ei.person_id JOIN einheiten e ON e.id = ei.einheit_id
      WHERE e.objekt_id = $1 AND (ei.von IS NULL OR ei.von <= $2) AND (ei.bis IS NULL OR ei.bis >= $2) ORDER BY e.lfd_nr, e.nummer, p.nachname, p.vorname`, [objektId, `${jahr}-01-01`]);
    const alt = await db.select(`SELECT h.einheit_id, h.betrag FROM hausgeld h JOIN einheiten e ON e.id = h.einheit_id WHERE e.objekt_id = $1
      AND h.gueltig_ab = (SELECT MAX(y.gueltig_ab) FROM hausgeld y WHERE y.einheit_id = h.einheit_id AND y.gueltig_ab < $2)`, [objektId, `${jahr}-01-01`]);
    const personen = [...new Map(eig.map((x) => [x.pid, x])).values()];
    for (const pe of personen) {
      const ihre = einheiten.filter((e) => eig.some((x) => x.pid === pe.pid && x.einheit_id === e.id));
      for (const e of ihre) {
        const kz = details.k.find((x) => x.nutzer.einheit_id === e.id), rz = details.r.find((x) => x.nutzer.einheit_id === e.id);
        const v = verteilung[e.id] ?? { kosten: 0, ruecklage: 0 };
        const neu = (v.kosten + v.ruecklage) / 12, bisher = Number(alt.find((x) => x.einheit_id === e.id)?.betrag ?? 0);
        b.neuerBrief();
        b.kopf([[pe.firma, [pe.vorname, pe.nachname].filter(Boolean).join(' ')].filter(Boolean).join(', '), pe.strasse || o.strasse, [pe.plz, pe.ort].filter(Boolean).join(' ') || ort], heute);
        b.betreff(`Einzelwirtschaftsplan ${jahr}: ${o.name}, Einheit ${e.nummer}`);
        b.absatz(`Einheit ${e.nummer}${e.lage ? ` (${e.lage})` : ''} · Miteigentumsanteil ${num(e.mea, 0)} / ${num(einheiten.reduce((a, x) => a + (Number(x.mea) || 0), 0), 0)}${e.flaeche ? ` · ${num(e.flaeche)} m²` : ''}`);
        const zU = (kz?.zeilen ?? []).filter((z) => z.pos.umlagefaehig && Math.abs(z.betrag) > 0.004), zN = (kz?.zeilen ?? []).filter((z) => !z.pos.umlagefaehig && Math.abs(z.betrag) > 0.004);
        const zz = (z: Ergebnis['zeilen'][number]) => [z.pos.name, geld(z.pos.betrag), z.pos.schluessel, geld(z.betrag)];
        const s2 = (l: Ergebnis['zeilen']) => l.reduce((a, z) => a + z.betrag, 0);
        if (zU.length) b.tabelle(['Umlagefähige Kosten', 'Gesamt', 'Schlüssel', 'Ihr Anteil'], zU.map(zz), [['Summe umlagefähig', '', '', geld(s2(zU))]]);
        if (zN.length) b.tabelle(['Nicht umlagefähige Kosten', 'Gesamt', 'Schlüssel', 'Ihr Anteil'], zN.map(zz), [['Summe nicht umlagefähig', '', '', geld(s2(zN))]]);
        b.tabelle(['', 'pro Jahr', 'pro Monat'], [
          ['Bewirtschaftungskosten', geld(v.kosten), geld(v.kosten / 12)],
          ['Zuführung Erhaltungsrücklage', geld(rz?.summe ?? v.ruecklage), geld(v.ruecklage / 12)],
        ], [['Hausgeld neu', geld(v.kosten + v.ruecklage), geld(neu)]]);
        if (bisher) b.absatz(`Ihr bisheriges Hausgeld beträgt ${geld(bisher)} im Monat. Nach dem Plan ${jahr} ${neu > bisher + 0.005 ? `steigt es um ${geld(neu - bisher)}` : neu < bisher - 0.005 ? `sinkt es um ${geld(bisher - neu)}` : 'bleibt es gleich'}.`);
        b.absatz(`Das neue Hausgeld von ${geld(neu)} gilt nach Beschluss der Eigentümerversammlung ab dem 01.01.${jahr} und ist monatlich im Voraus zum 3. Werktag fällig. Davon fließen ${geld(v.ruecklage / 12)} in die Erhaltungsrücklage.`);
        b.gruss();
      }
    }
    return (entwurf ? b.entwurf() : b).bytes();
  }

  async function vorschau() {
    setBusy('vorschau');
    try { await speichern(); const bytes = await planPdf(true); setPdf({ bytes }); }
    catch (e: any) { setInfo('Fehler: ' + (e?.message ?? e)); }
    setBusy('');
  }

  async function ablegen() {
    setBusy('ablegen');
    try {
      const o = (await db.select('SELECT name FROM objekte WHERE id = $1', [objektId]))[0];
      const pfad = await dateiSpeichern(await planPdf(false), `Wirtschaftsplan ${jahr} ${o.name}.pdf`, { bezug: 'Objekt', bezugId: objektId, ordner: [o.name, 'Wirtschaftsplan', String(jahr)] });
      setInfo(`Wirtschaftsplan ${jahr} als PDF abgelegt unter ${o.name}/Wirtschaftsplan/${jahr}.`); oeffnen(pfad);
    } catch (e: any) { setInfo('Fehler: ' + (e?.message ?? e)); }
    setBusy('');
  }

  /** Basis für die Prozentprognose: einmal gemerkt, damit mehrfaches Ändern des Prozentsatzes nicht aufaddiert */
  const basisVon = (id: number) => basis[id] ?? (vorjahr[id] ? Math.round(vorjahr[id] * 100) / 100 : zahl(plan[id] ?? ''));
  const mitProzent = (b: number, p: string) => Math.round(b * (1 + (betragZahl(p) ?? 0) / 100) * 100) / 100;
  function prozentSetzen(id: number, p: string) {
    const b = basisVon(id);
    setBasis({ ...basis, [id]: b }); setProzent({ ...prozent, [id]: p });
    setPlan({ ...plan, [id]: p.trim() === '' ? (b ? String(b).replace('.', ',') : plan[id] ?? '') : String(mitProzent(b, p)).replace('.', ',') });
  }
  function prozentAlle() {
    if (betragZahl(alleProzent) === null) { setInfo('Bitte einen Prozentsatz eintragen, z. B. 10 oder 3,5.'); return; }
    const np = { ...plan }, npr = { ...prozent }, nb = { ...basis }; let n = 0;
    for (const k of konten) {
      if (k.nummer === RUECKLAGE_KONTO) continue;   // Rücklage wird gesondert beschlossen
      const b = basisVon(k.id); if (!b) continue;
      nb[k.id] = b; npr[k.id] = alleProzent; np[k.id] = String(mitProzent(b, alleProzent)).replace('.', ','); n++;
    }
    setPlan(np); setProzent(npr); setBasis(nb);
    setInfo(n ? `${alleProzent.replace('.', ',')} % auf ${n} Kostenarten gerechnet (Basis: Ist ${jahr - 1}, sonst der bisherige Planwert). Prüfe die Werte und klicke auf „Speichern“.` : `Keine Kostenart mit Ist ${jahr - 1} oder Planwert gefunden.`);
  }
  const summe = (r: boolean) => konten.filter((k) => (k.nummer === RUECKLAGE_KONTO) === r).reduce((a, k) => a + zahl(plan[k.id] ?? ''), 0);
  const kosten = summe(false), ruecklage = summe(true);
  let gruppe = '';
  const planZahlen = Object.fromEntries(Object.entries(plan).map(([k, v]) => [Number(k), zahl(v)]));
  const vorschlagUebernehmen = (werte: Record<number, number>, rl: number) => {
    const p = { ...plan };
    for (const [k, v] of Object.entries(werte)) p[Number(k)] = String(v).replace('.', ',');
    const rk = konten.find((k) => k.nummer === RUECKLAGE_KONTO);
    if (rk) p[rk.id] = String(rl).replace('.', ',');
    setPlan(p); setInfo('Vorschlag von O.S.A eingetragen. Prüfe die Werte und klicke auf „Speichern“.');
  };
  return (
    <>
    <OsaPlanVorschlag objektId={objektId} objektName={objName} jahr={jahr} plan={planZahlen} onUebernehmen={vorschlagUebernehmen} />
    <div className="grid2 wp-plan">
      <section className="card">
        <div className="card-head"><h2 className="title-ico"><ClipboardList size={22} />Wirtschaftsplan {jahr}</h2>
          <div className="row">
            <label className="inline">Jahr <JahrWahl value={jahr} onChange={setJahr} /></label>
            <button onClick={vorjahrUebernehmen}>Ist {jahr - 1} übernehmen</button>
            <button className="primary" onClick={speichern}>Speichern</button>
          </div></div>
        <div className="wp-prognose">
          <Percent size={16} /><span>Prozentprognose für {jahr}:</span>
          <MengeFeld zelle className="cell" einheit="%" placeholder="z. B. 10" value={alleProzent} onChange={(e) => setAlleProzent(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') prozentAlle(); }} aria-label="Prozent auf alle Kostenarten" />
          <button onClick={prozentAlle}>Auf alle Kosten anwenden</button>
          <span className="muted small">Basis ist das Ist {jahr - 1} (sonst der Planwert), z. B. 50,00 € + 10 % = 55,00 €. Je Kostenart geht es auch einzeln in der Spalte „±&nbsp;%“.</span>
        </div>
        <table className="list">
          <thead><tr><th>Kostenart</th><th>Schlüssel</th><th className="num">Ist {jahr - 1}</th><th className="num">± %</th><th className="num">Geplante Kosten</th></tr></thead>
          <tbody>{konten.flatMap((k) => {
            const out = [];
            if (k.gruppe !== gruppe) { gruppe = k.gruppe; out.push(<tr key={'g' + k.id} className="group"><td colSpan={5}>{gruppe}</td></tr>); }
            out.push(
              <tr key={k.id}><td>{k.nummer} {k.name}</td><td className="muted small">{k.nummer === RUECKLAGE_KONTO ? 'MEA' : k.objekt_schluessel ?? 'MEA'}</td>
                <td className="num muted">{vorjahr[k.id] ? eur(vorjahr[k.id]) : ''}</td>
                <td className="num" title={prozent[k.id] ? `${eur(basisVon(k.id))} ${(betragZahl(prozent[k.id]) ?? 0) < 0 ? '−' : '+'} ${String(prozent[k.id]).replace('-', '')} % = ${eur(mitProzent(basisVon(k.id), prozent[k.id]))}` : 'Prozent auf das Ist des Vorjahres (sonst auf den Planwert)'}>
                  <MengeFeld zelle className="cell wp-prozent" einheit="%" placeholder="" value={prozent[k.id] ?? ''} onChange={(e) => prozentSetzen(k.id, e.target.value)} /></td>
                <td className="num"><BetragFeld zelle className="cell" placeholder="" value={plan[k.id] ?? ''} onChange={(e) => {
                  setPlan({ ...plan, [k.id]: e.target.value });
                  // von Hand geändert: Prozent der Zeile gilt nicht mehr
                  if (prozent[k.id] !== undefined) { const p = { ...prozent }; delete p[k.id]; setProzent(p); const b = { ...basis }; delete b[k.id]; setBasis(b); } }} /></td></tr>);
            return out;
          })}</tbody>
          <tfoot>
            <tr><td colSpan={4}>Summe Kosten</td><td className="num">{eur(kosten)}</td></tr>
            <tr><td colSpan={4}>+ Zuführung Erhaltungsrücklage</td><td className="num">{eur(ruecklage)}</td></tr>
            <tr><td colSpan={4}>Gesamt (p. a.)</td><td className="num">{eur(kosten + ruecklage)}</td></tr>
          </tfoot>
        </table>
      </section>
      <section className="card">
        <div className="card-head"><h2>Hausgeld je Einheit</h2></div>
        <div className="tablewrap"><table className="list">
          <thead><tr><th>Einheit</th><th className="num">MEA</th><th className="num">Kosten</th><th className="num">Rücklage</th><th className="num">Hausgeld p. M.</th></tr></thead>
          <tbody>{einheiten.map((e) => {
            const v = verteilung[e.id] ?? { kosten: 0, ruecklage: 0 };
            return <tr key={e.id}><td>{e.nummer}</td><td className="num">{num(e.mea, 0)}</td><td className="num">{eur(v.kosten / 12)}</td>
              <td className="num">{eur(v.ruecklage / 12)}</td><td className="num"><b>{eur((v.kosten + v.ruecklage) / 12)}</b></td></tr>;
          })}</tbody>
          <tfoot><tr><td>Gesamt</td><td className="num">{num(einheiten.reduce((a, e) => a + (Number(e.mea) || 0), 0), 0)}</td>
            <td className="num">{eur(kosten / 12)}</td><td className="num">{eur(ruecklage / 12)}</td><td className="num">{eur((kosten + ruecklage) / 12)}</td></tr></tfoot>
        </table></div>
        <p className="muted small">Kosten nach dem Umlageschlüssel der Liegenschaft, Verbrauchsschlüssel im Plan vorläufig nach MEA. Rücklage nach MEA.</p>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button disabled={!einheiten.length || kosten + ruecklage === 0 || !!busy} onClick={vorschau}><Eye size={16} />{busy === 'vorschau' ? 'PDF wird erstellt …' : 'PDF-Vorschau'}</button>
          <button disabled={!einheiten.length || kosten + ruecklage === 0 || !!busy} onClick={ablegen}><FileDown size={16} />PDFs ablegen</button>
          <button className="primary" disabled={!einheiten.length || kosten + ruecklage === 0} onClick={hausgeldUebernehmen}>Als Hausgeld ab 01.01.{jahr} übernehmen</button>
        </div>
        <p className="muted small">Die PDF enthält den Gesamtwirtschaftsplan und für jeden Eigentümer einen Einzelwirtschaftsplan mit seinem Anteil je Kostenart und dem neuen Hausgeld.</p>
        {info && <p className="info">{info}</p>}
      </section>
      <PdfVorschau bytes={pdf?.bytes ?? null} titel={`Entwurf: Wirtschaftsplan ${jahr}`} onClose={() => setPdf(null)}
        aktionen={<button onClick={ablegen}><FileDown size={16} />PDFs ablegen</button>} />
    </div>
    </>
  );
}
