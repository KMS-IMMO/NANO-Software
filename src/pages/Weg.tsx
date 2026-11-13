// WEG-Module: Beschlüsse und Versammlungen, Erhaltungsrücklage, Wirtschaftsplan; Instandhaltung (WEG und Miete).
import { BetragFeld } from '../components/BetragFeld';
import { betragZahl } from '../lib/betrag';
import { einheitLabel } from '../db/labels';
import { useEffect, useState } from 'react';
import { CalendarDays, ClipboardList, Gavel, PiggyBank, Wrench } from 'lucide-react';
import { EntityTable, datum, eur, num } from '../components/EntityTable';
import { db, type Row } from '../db';
import { kostenErmitteln, tageImJahr, verteilen, type Ergebnis, type Nutzer, type Position } from '../logic/verteilung';
import { Brief, absender, geld } from '../lib/pdf';
import { oeffnen, speichern as dateiSpeichern } from '../lib/dateien';
import { personLabel } from '../db/labels';
import { Eye, FileDown, X } from 'lucide-react';
import { OsaPlanVorschlag } from '../components/OsaPlanVorschlag';
import { ruecklageJahr, ruecklageStand } from '../logic/ruecklage';

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
  const [jahr, setJahr] = useState(new Date().getFullYear());
  const [j, setJ] = useState<Row>({});
  const [verlauf, setVerlauf] = useState<{ jahr: number; bestand: number }[]>([]);
  const [basis, setBasis] = useState({ anfang: '', stichtag: '' });
  const [meaGes, setMeaGes] = useState(0);
  const [info, setInfo] = useState('');

  const load = async () => {
    setJ(await ruecklageJahr(objektId, jahr));
    const v = [];
    for (let y = jahr - 4; y <= jahr; y++) v.push({ jahr: y, bestand: await ruecklageStand(objektId, `${y}-12-31`) });
    setVerlauf(v);
    const o = (await db.select('SELECT ruecklage_anfang, ruecklage_stichtag, gesamt_mea FROM objekte WHERE id = $1', [objektId]))[0] ?? {};
    setBasis({ anfang: o.ruecklage_anfang ? String(o.ruecklage_anfang).replace('.', ',') : '', stichtag: o.ruecklage_stichtag ?? '' });
    const m = (await db.select('SELECT SUM(mea) AS m FROM einheiten WHERE objekt_id = $1', [objektId]))[0]?.m;
    setMeaGes(Number(o.gesamt_mea) || Number(m) || 0);
  };
  useEffect(() => { load(); }, [objektId, jahr]);

  async function basisSpeichern() {
    await db.execute('UPDATE objekte SET ruecklage_anfang = $1, ruecklage_stichtag = $2 WHERE id = $3', [zahl(basis.anfang), basis.stichtag || null, objektId]);
    setInfo('Übernahmebestand gespeichert.');
    load();
  }

  const max = Math.max(1, ...verlauf.map((v) => v.bestand));
  return (
    <>
      <div className="grid2">
        <section className="card">
          <div className="card-head"><h2 className="title-ico"><PiggyBank size={22} />Rücklagenkonto {jahr}</h2>
            <label className="inline">Jahr <input type="number" style={{ width: 90 }} value={jahr} onChange={(e) => setJahr(Number(e.target.value))} /></label></div>
          <table className="list"><tbody>
            <tr><td>Anfangsbestand (01.01.{jahr})</td><td className="num">{eur(j.anfangsbestand ?? 0)}</td></tr>
            {j.uebernahme ? <tr><td>+ Übernahmebestand</td><td className="num">{eur(j.uebernahme)}</td></tr> : null}
            <tr><td>+ Zuführungen (Hausgeld-Soll)</td><td className="num">{eur(j.zufuehrung ?? 0)}</td></tr>
            <tr><td>− Entnahmen (Konto 1261)</td><td className="num">{eur(j.entnahme ?? 0)}</td></tr>
            <tr><td>+ Zinsen (Konto 1262)</td><td className="num">{eur(j.zinsen ?? 0)}</td></tr>
            <tr className="sum"><td>= Bestand 31.12.{jahr}</td><td className="num">{eur(j.bestand ?? 0)}</td></tr>
            <tr><td className="muted">Rücklage je MEA</td><td className="num muted">{meaGes ? eur((j.bestand ?? 0) / meaGes) : '–'}</td></tr>
          </tbody></table>
          <div className="row" style={{ marginTop: 14 }}>
            <label className="inline small">Bestand bei Übernahme <input className="cell" value={basis.anfang} onChange={(e) => setBasis({ ...basis, anfang: e.target.value })} /> €</label>
            <label className="inline small">am <input type="date" style={{ width: 150 }} value={basis.stichtag} onChange={(e) => setBasis({ ...basis, stichtag: e.target.value })} /></label>
            <button onClick={basisSpeichern}>Speichern</button>
          </div>
          {info && <p className="info">{info}</p>}
        </section>
        <section className="card">
          <div className="card-head"><h2>Entwicklung Rücklage</h2></div>
          <svg viewBox="0 0 500 220" width="100%" role="img" aria-label="Entwicklung der Rücklage">
            {verlauf.map((v, i) => {
              const h = Math.max(0, (v.bestand / max) * 160);
              return (
                <g key={v.jahr}>
                  <rect x={30 + i * 94} y={185 - h} width={56} height={h} rx={4} fill="#2e7d32" />
                  <text x={58 + i * 94} y={205} textAnchor="middle" fontSize="12" fill="#6b6f76">{v.jahr}</text>
                  <text x={58 + i * 94} y={178 - h} textAnchor="middle" fontSize="11" fill="#1f2328">{eur(v.bestand)}</text>
                </g>);
            })}
          </svg>
        </section>
      </div>
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
  const [vorjahr, setVorjahr] = useState<Record<number, number>>({});
  const [einheiten, setEinheiten] = useState<Row[]>([]);
  const [verteilung, setVerteilung] = useState<Record<number, { kosten: number; ruecklage: number }>>({});
  const [details, setDetails] = useState<{ k: Ergebnis[]; r: Ergebnis[] }>({ k: [], r: [] });
  const [pdf, setPdf] = useState<{ url: string; bytes: Uint8Array } | null>(null);
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
      WHERE e.objekt_id = $1 AND (ei.von IS NULL OR ei.von <= $2) AND (ei.bis IS NULL OR ei.bis >= $2) ORDER BY p.nachname, p.vorname`, [objektId, `${jahr}-01-01`]);
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
    try { await speichern(); const bytes = await planPdf(true); setPdf({ url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' })), bytes }); }
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
    <div className="grid2" style={{ gridTemplateColumns: 'minmax(420px, 3fr) minmax(320px, 2fr)' }}>
      <section className="card">
        <div className="card-head"><h2 className="title-ico"><ClipboardList size={22} />Wirtschaftsplan {jahr}</h2>
          <div className="row">
            <label className="inline">Jahr <input type="number" style={{ width: 90 }} value={jahr} onChange={(e) => setJahr(Number(e.target.value))} /></label>
            <button onClick={vorjahrUebernehmen}>Ist {jahr - 1} übernehmen</button>
            <button className="primary" onClick={speichern}>Speichern</button>
          </div></div>
        <table className="list">
          <thead><tr><th>Kostenart</th><th>Schlüssel</th><th className="num">Ist {jahr - 1}</th><th className="num">Geplante Kosten</th></tr></thead>
          <tbody>{konten.flatMap((k) => {
            const out = [];
            if (k.gruppe !== gruppe) { gruppe = k.gruppe; out.push(<tr key={'g' + k.id} className="group"><td colSpan={4}>{gruppe}</td></tr>); }
            out.push(
              <tr key={k.id}><td>{k.nummer} {k.name}</td><td className="muted small">{k.nummer === RUECKLAGE_KONTO ? 'MEA' : k.objekt_schluessel ?? 'MEA'}</td>
                <td className="num muted">{vorjahr[k.id] ? eur(vorjahr[k.id]) : ''}</td>
                <td className="num"><BetragFeld zelle className="cell" placeholder="" value={plan[k.id] ?? ''} onChange={(e) => setPlan({ ...plan, [k.id]: e.target.value })} /></td></tr>);
            return out;
          })}</tbody>
          <tfoot>
            <tr><td colSpan={3}>Summe Kosten</td><td className="num">{eur(kosten)}</td></tr>
            <tr><td colSpan={3}>+ Zuführung Erhaltungsrücklage</td><td className="num">{eur(ruecklage)}</td></tr>
            <tr><td colSpan={3}>Gesamt (p. a.)</td><td className="num">{eur(kosten + ruecklage)}</td></tr>
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
      {pdf && (
        <div className="modal-bg" onClick={() => { URL.revokeObjectURL(pdf.url); setPdf(null); }}>
          <div className="modal pdf-vorschau" onClick={(e) => e.stopPropagation()}>
            <div className="card-head"><h3>Entwurf: Wirtschaftsplan {jahr}</h3>
              <div className="row"><button onClick={ablegen}><FileDown size={16} />PDFs ablegen</button>
                <button className="icon-btn" title="Schließen" onClick={() => { URL.revokeObjectURL(pdf.url); setPdf(null); }}><X size={18} /></button></div></div>
            <iframe id="abschluss-pdf" title="PDF-Vorschau" src={pdf.url} />
          </div>
        </div>)}
    </div>
    </>
  );
}
