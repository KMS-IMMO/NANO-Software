// Dashboard: 3D-Stadt mit dem KMS HQ in der Mitte. Über die Suche oder per Klick wird eine Liegenschaft gewählt,
// die Kamera fährt hin und rundherum erscheinen Zahlungsübersicht, offene Aufgaben, Liegenschaftsübersicht und Termine.
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, BarChart3, CheckCircle2, Building2, CalendarDays, ChevronRight, DoorOpen, ListTodo, MapPin, Search, Users, Wallet, X } from 'lucide-react';
import { db, type Row } from '../db';
import { datum, eur, num } from '../components/EntityTable';
import { Donut } from '../components/Donut';
import { OP_SQL } from '../logic/soll';
import { Zaehler } from '../components/Zaehler';
import type { StadtObjekt } from '../components/Stadt3D';
// 3D-Stadt (three.js) erst nachladen: Kennzahlen stehen sofort da, die Stadt erscheint einen Moment später
const Stadt3D = lazy(() => import('../components/Stadt3D').then((m) => ({ default: m.Stadt3D })));

const monat = () => new Date().toISOString().slice(0, 7);
const monatName = () => new Date().toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
const AKTIV = `v.beginn <= date('now') AND (v.ende IS NULL OR v.ende >= date('now'))`;
const adresse = (o: Row) => [o.strasse, [o.plz, o.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');

type Daten = { k: Row; z: Row; leer: number; auslaufend: number; termine: Row[]; info: Row };

/** Kennzahlen für eine Liegenschaft oder (ohne id) für alle */
async function laden(id: number | null): Promise<Daten> {
  const o = (a: string) => (id == null ? '1=1' : `${a} = ${Number(id)}`);
  const k = (await db.select(`SELECT
      (SELECT COUNT(*) FROM einheiten e WHERE ${o('e.objekt_id')}) einheiten,
      (SELECT SUM(flaeche) FROM einheiten e WHERE ${o('e.objekt_id')}) flaeche,
      (SELECT COUNT(DISTINCT v.mieter_id) FROM mietvertraege v JOIN einheiten e ON e.id = v.einheit_id WHERE ${o('e.objekt_id')} AND ${AKTIV}) mieter,
      (SELECT COUNT(DISTINCT ee.person_id) FROM eigentum ee JOIN einheiten e ON e.id = ee.einheit_id WHERE ${o('e.objekt_id')} AND (ee.bis IS NULL OR ee.bis >= date('now'))) eigentuemer,
      (SELECT COALESCE(SUM(betrag - bezahlt), 0) FROM (${OP_SQL}) WHERE ${o('objekt_id')} AND betrag - bezahlt > 0.005 AND faellig < date('now')) offen,
      (SELECT COUNT(*) FROM (${OP_SQL}) WHERE ${o('objekt_id')} AND betrag - bezahlt > 0.005 AND faellig < date('now')) offen_n,
      (SELECT COUNT(*) FROM (${OP_SQL}) WHERE ${o('objekt_id')} AND mahnstufe > 0 AND art <> 'Mahngebühr') gemahnt,
      (SELECT COUNT(*) FROM vorgaenge WHERE ${o('objekt_id')} AND status <> 'Erledigt') vorgaenge,
      (SELECT COUNT(*) FROM beschluesse WHERE ${o('objekt_id')} AND status <> 'Erledigt' AND ergebnis = 'Angenommen') beschluesse,
      (SELECT COUNT(*) FROM fristen WHERE ${o('objekt_id')} AND erledigt_am IS NULL AND faellig <= date('now', '+' || COALESCE(vorlauf_tage, 30) || ' days')) fristen,
      (SELECT COUNT(*) FROM rechnungen WHERE ${o('objekt_id')} AND bezahlt_am IS NULL) rechnungen,
      (SELECT COUNT(*) FROM bankumsaetze u JOIN bankkonten b ON b.id = u.bankkonto_id WHERE ${o('b.objekt_id')} AND u.status = 'offen') bank_offen,
      (SELECT COUNT(*) FROM mietvertraege v JOIN einheiten e ON e.id = v.einheit_id WHERE ${o('e.objekt_id')} AND ${AKTIV} AND COALESCE(v.zahlung_an, 'Verwaltung') <> 'Eigentümer'
        AND NOT EXISTS (SELECT 1 FROM sollstellungen s WHERE s.vertrag_id = v.id AND s.monat = strftime('%Y-%m', 'now'))) soll_fehlt,
      (SELECT COUNT(*) FROM mietvertraege v JOIN einheiten e ON e.id = v.einheit_id WHERE ${o('e.objekt_id')} AND ${AKTIV}
        AND NOT EXISTS (SELECT 1 FROM dokumente d WHERE d.bezug = 'Mietvertrag' AND d.bezug_id = v.id)) ohne_pdf,
      (SELECT COUNT(*) FROM objekte x WHERE ${o('x.id')} AND x.verwaltungsart <> 'WEG' AND EXISTS (SELECT 1 FROM mietvertraege v JOIN einheiten e ON e.id = v.einheit_id
        WHERE e.objekt_id = x.id AND v.beginn <= (strftime('%Y', 'now') - 1) || '-12-31' AND (v.ende IS NULL OR v.ende >= (strftime('%Y', 'now') - 1) || '-01-01'))
        AND NOT EXISTS (SELECT 1 FROM abrechnungen a WHERE a.objekt_id = x.id AND a.art = 'Nebenkosten' AND a.jahr = strftime('%Y', 'now') - 1 AND a.status IN ('Abgeschlossen', 'Gebucht'))) nk_offen,
      (SELECT COUNT(*) FROM objekte x WHERE ${o('x.id')} AND x.verwaltungsart = 'WEG' AND EXISTS (SELECT 1 FROM einheiten e WHERE e.objekt_id = x.id)
        AND NOT EXISTS (SELECT 1 FROM abrechnungen a WHERE a.objekt_id = x.id AND a.art = 'WEG' AND a.jahr = strftime('%Y', 'now') - 1 AND a.status = 'Abgeschlossen')) weg_offen`))[0] ?? {};
  const z = (await db.select(`SELECT COALESCE(SUM(betrag), 0) soll, COALESCE(SUM(MIN(bezahlt, betrag)), 0) ist
      FROM (${OP_SQL}) WHERE ${o('objekt_id')} AND monat = $1 AND art IN ('Kaltmiete', 'NK', 'HK', 'USt', 'Hausgeld', 'Rücklage')`, [monat()]))[0] ?? {};
  const leer = Number((await db.select(`SELECT COUNT(*) n FROM einheiten e JOIN objekte o ON o.id = e.objekt_id
      WHERE ${o('o.id')} AND o.verwaltungsart = 'Mietverwaltung' AND NOT EXISTS (SELECT 1 FROM mietvertraege v WHERE v.einheit_id = e.id AND ${AKTIV})`))[0]?.n ?? 0);
  const auslaufend = Number((await db.select(`SELECT COUNT(*) n FROM mietvertraege v JOIN einheiten e ON e.id = v.einheit_id
      WHERE ${o('e.objekt_id')} AND v.ende IS NOT NULL AND v.ende >= date('now') AND v.ende <= date('now', '+6 months')`))[0]?.n ?? 0);
  // Offene Termine wie im Kalender: Termine, Versammlungen, Instandhaltungen, Fristen, Erinnerungen und Tickets der Liegenschaft
  const termine = await db.select(`SELECT * FROM (
      SELECT t.datum, t.uhrzeit, COALESCE(t.art, 'Termin') AS art, t.titel, o.name AS objekt, '/kalender' AS ziel FROM termine t LEFT JOIN objekte o ON o.id = t.objekt_id WHERE ${o('t.objekt_id')} AND t.datum >= date('now')
      UNION ALL SELECT v.datum, v.uhrzeit, 'Versammlung', v.art, o.name, '/objekte/' || o.id || '/versammlungen/' || v.id FROM versammlungen v JOIN objekte o ON o.id = v.objekt_id WHERE ${o('v.objekt_id')} AND v.datum >= date('now')
      UNION ALL SELECT x.faellig, NULL, 'Instandhaltung', x.betreff, o.name, '/objekte/' || o.id || '/instandhaltung' FROM vorgaenge x JOIN objekte o ON o.id = x.objekt_id WHERE ${o('x.objekt_id')} AND x.status <> 'Erledigt' AND x.faellig IS NOT NULL
      UNION ALL SELECT f.faellig, NULL, 'Frist', f.titel, o.name, '/fristen' FROM fristen f LEFT JOIN objekte o ON o.id = f.objekt_id WHERE ${o('f.objekt_id')} AND f.erledigt_am IS NULL
      UNION ALL SELECT r.faellig, r.uhrzeit, 'Erinnerung', r.titel, o.name, '/erinnerungen' FROM erinnerungen r LEFT JOIN objekte o ON o.id = r.objekt_id WHERE ${o('r.objekt_id')} AND r.erledigt = 0
      UNION ALL SELECT k.faellig, k.uhrzeit, 'Ticket', k.titel, o.name, '/tickets' FROM tickets k LEFT JOIN objekte o ON o.id = k.objekt_id WHERE ${o('k.objekt_id')} AND k.status <> 'Erledigt' AND k.faellig IS NOT NULL
    ) ORDER BY datum, uhrzeit LIMIT 7`);
  const info = id == null ? {} : (await db.select(`SELECT o.*, p.firma, p.nachname, p.vorname FROM objekte o LEFT JOIN personen p ON p.id = o.eigentuemer_id WHERE o.id = $1`, [id]))[0] ?? {};
  return { k, z, leer, auslaufend, termine, info };
}

export function DashboardPage() {
  const nav = useNavigate();
  const [objekte, setObjekte] = useState<Row[]>([]);
  const [gesamt, setGesamt] = useState<Row>({});
  const [wahl, setWahl] = useState<number | null>(null);
  const [d, setD] = useState<Daten | null>(null);
  const [suche, setSuche] = useState('');
  const [offen, setOffen] = useState(false);
  const [markiert, setMarkiert] = useState(0);
  const suchFeld = useRef<HTMLInputElement>(null);

  useEffect(() => {
    db.select(`SELECT o.*, (SELECT COUNT(*) FROM einheiten e WHERE e.objekt_id = o.id) einheiten FROM objekte o ORDER BY o.objekt_nr, o.name`).then(setObjekte);
    db.select(`SELECT (SELECT COUNT(*) FROM objekte) objekte, (SELECT COUNT(*) FROM einheiten) einheiten,
      (SELECT COUNT(DISTINCT v.mieter_id) FROM mietvertraege v WHERE ${AKTIV}) mieter`).then((r) => setGesamt(r[0] ?? {}));
  }, []);
  useEffect(() => { let aktuell = true; laden(wahl).then((x) => { if (aktuell) setD(x); }); return () => { aktuell = false; }; }, [wahl]);

  const stadt: StadtObjekt[] = useMemo(() => objekte.map((o) => ({ id: o.id, name: o.name, einheiten: Number(o.einheiten) || 0, verwaltungsart: o.verwaltungsart })), [objekte]);
  const treffer = useMemo(() => {
    const t = suche.trim().toLowerCase();
    return objekte.filter((o) => !t || [o.name, o.strasse, o.plz, o.ort, o.objekt_nr, o.verwaltungsart].some((x) => String(x ?? '').toLowerCase().includes(t))).slice(0, 8);
  }, [suche, objekte]);
  const gewaehlt = objekte.find((o) => o.id === wahl);

  const waehlen = (id: number | null) => { setWahl(id); setOffen(false); setSuche(''); suchFeld.current?.blur(); };
  const taste = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOffen(true); setMarkiert((m) => Math.min(treffer.length - 1, m + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setMarkiert((m) => Math.max(0, m - 1)); }
    if (e.key === 'Enter' && treffer[markiert]) { e.preventDefault(); waehlen(treffer[markiert].id); }
    if (e.key === 'Escape') { setOffen(false); (e.target as HTMLElement).blur(); }
  };

  const k = d?.k ?? {}, soll = Number(d?.z.soll) || 0, ist = Number(d?.z.ist) || 0;
  const pfad = (unter: string, global: string) => (wahl != null ? `/objekte/${wahl}/${unter}` : global);
  const eig = d?.info && (d.info.firma || d.info.nachname) ? [d.info.firma, [d.info.nachname, d.info.vorname].filter(Boolean).join(', ')].filter(Boolean).join(' · ') : '';

  return (
    <div className="leit">
      <div className="leit-kopf">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">{gewaehlt ? `${gewaehlt.name} · ${gewaehlt.verwaltungsart}` : `${gesamt.objekte ?? 0} Liegenschaften · ${gesamt.einheiten ?? 0} Einheiten · ${gesamt.mieter ?? 0} Mieter${db.isDemo ? ' · Vorschau mit Beispieldaten' : ''}`}</p>
        </div>
        <div className={'leit-suche' + (offen ? ' offen' : '')}>
          <Search size={18} />
          <input ref={suchFeld} placeholder="Liegenschaft suchen: Name, Straße, Ort oder H-ID …" value={suche}
            onChange={(e) => { setSuche(e.target.value); setOffen(true); setMarkiert(0); }} onFocus={() => setOffen(true)} onBlur={() => setTimeout(() => setOffen(false), 150)} onKeyDown={taste} />
          {gewaehlt && <button className="leit-chip" onClick={() => waehlen(null)} title="Zurück zur ganzen Stadt">{gewaehlt.name}<X size={14} /></button>}
          {offen && <div className="leit-treffer">
            {treffer.length === 0 ? <p className="muted">Keine Liegenschaft gefunden.</p> : treffer.map((o, i) => (
              <button key={o.id} className={i === markiert ? 'an' : ''} onMouseEnter={() => setMarkiert(i)} onMouseDown={(e) => { e.preventDefault(); waehlen(o.id); }}>
                <Building2 size={18} /><span><b>{o.name}</b><small>{adresse(o) || 'ohne Adresse'} · H-ID {o.objekt_nr}</small></span><em className={'pill ' + (o.verwaltungsart === 'WEG' ? 'weg' : 'mv')}>{o.verwaltungsart}</em>
              </button>))}
          </div>}
        </div>
      </div>

      <div className={'leit-buehne' + (wahl != null ? ' fokus' : '')}>
        <div className="leit-seite links" key={'l' + (wahl ?? 'alle')}>
          <section className="card leit-karte">
            <div className="card-head"><h2 className="title-ico"><BarChart3 size={20} />Zahlungsübersicht <span className="muted small">{monatName()}</span></h2></div>
            {soll === 0 ? <p className="muted small">Für diesen Monat ist {wahl != null ? 'hier ' : ''}noch nichts soll gestellt.</p> : (
              <div className="donut-wrap klein">
                <Donut anteil={ist / soll} label="bezahlt" />
                <div className="legend">
                  <span><i style={{ background: '#2e7d32' }} />Eingänge</span><b className="num">{eur(ist)}</b>
                  <span><i style={{ background: '#c0392b' }} />Offen</span><b className="num">{eur(soll - ist)}</b>
                  <span><b>Soll</b></span><b className="num">{eur(soll)}</b>
                </div>
              </div>)}
            <Link className="leit-zeile" to={pfad('offene-posten', '/offene-posten')}><Wallet size={16} /><span>Überfällig</span><b className={k.offen > 0 ? 'neg' : ''}><Zaehler wert={Number(k.offen) || 0} format={eur} /></b></Link>
          </section>
          <section className="card leit-karte">
            <div className="card-head"><h2 className="title-ico"><ListTodo size={20} />Was ist zu tun?</h2></div>
            <ZuTun k={k} d={d} pfad={pfad} weg={wahl == null ? null : gewaehlt?.verwaltungsart === 'WEG'} />
          </section>
        </div>

        <div className="leit-stadt">
          <Suspense fallback={null}><Stadt3D objekte={stadt} gewaehlt={wahl} onWahl={(id) => setWahl(id)} /></Suspense>
          <div className="leit-legende"><span><i className="hq" />KMS Zentrale · Agent O.S.A</span><span><i className="mv" />Mietverwaltung</span><span><i className="weg" />WEG</span></div>
          {wahl == null ? <p className="leit-hinweis">Gebäude anklicken oder oben suchen · Ziehen dreht die Stadt · Mausrad zoomt</p>
            : <button className="leit-zurueck" onClick={() => waehlen(null)}><X size={14} />Ganze Stadt</button>}
          {objekte.length === 0 && <p className="leit-leer">Noch keine Liegenschaften. Sobald du eine anlegst, wächst hier ihr Gebäude. <Link to="/objekte/neu">Liegenschaft anlegen →</Link></p>}
        </div>

        <div className="leit-seite rechts" key={'r' + (wahl ?? 'alle')}>
          <section className="card leit-karte">
            <div className="card-head"><h2 className="title-ico"><Building2 size={20} />Liegenschaftsübersicht</h2></div>
            {gewaehlt ? <>
              <h3 className="leit-name">{gewaehlt.name}</h3>
              <p className="muted small leit-adr"><MapPin size={14} />{adresse(gewaehlt) || 'ohne Adresse'} · H-ID {gewaehlt.objekt_nr}</p>
              <div className="leit-werte">
                <div><DoorOpen size={18} /><b>{k.einheiten ?? 0}</b><span>Einheiten</span></div>
                <div><span className="leit-qm">m²</span><b>{num(k.flaeche, 0)}</b><span>Fläche</span></div>
                <div><Users size={18} /><b>{gewaehlt.verwaltungsart === 'WEG' ? k.eigentuemer ?? 0 : k.mieter ?? 0}</b><span>{gewaehlt.verwaltungsart === 'WEG' ? 'Eigentümer' : 'Mieter'}</span></div>
              </div>
              <dl className="leit-dl">
                <dt>Verwaltung</dt><dd>{gewaehlt.verwaltungsart}</dd>
                {gewaehlt.baujahr && <><dt>Baujahr</dt><dd>{gewaehlt.baujahr}</dd></>}
                {gewaehlt.heizungsart && <><dt>Heizung</dt><dd>{gewaehlt.heizungsart}</dd></>}
                {eig && <><dt>Eigentümer</dt><dd>{eig}</dd></>}
                <dt>Status</dt><dd><span className={'pill ' + String(gewaehlt.status ?? 'Aktiv').toLowerCase()}>{gewaehlt.status ?? 'Aktiv'}</span></dd>
              </dl>
              <button className="primary leit-oeffnen" onClick={() => nav(`/objekte/${gewaehlt.id}`)}>Liegenschaft öffnen<ArrowRight size={16} /></button>
            </> : <div className="leit-liste">
              {objekte.map((o) => (
                <button key={o.id} onClick={() => waehlen(o.id)}>
                  <i className={o.verwaltungsart === 'WEG' ? 'weg' : 'mv'} /><span><b>{o.name}</b><small>{adresse(o) || o.verwaltungsart}</small></span><em>{o.einheiten} E.</em>
                </button>))}
            </div>}
          </section>
          <section className="card leit-karte">
            <div className="card-head"><h2 className="title-ico"><CalendarDays size={20} />Offene Termine</h2><Link className="small" to="/kalender">Kalender →</Link></div>
            {!d?.termine.length ? <p className="muted small">Keine offenen Termine{wahl != null ? ' für diese Liegenschaft' : ''}.</p> : (
              <div className="leit-termine">{d.termine.map((t, i) => (
                <Link key={i} to={t.ziel}>
                  <span className="leit-datum"><b>{new Date(t.datum).getDate()}</b><small>{new Date(t.datum).toLocaleDateString('de-DE', { month: 'short' })}</small></span>
                  <span><b>{t.titel}</b><small>{t.art}{t.uhrzeit ? ` · ${t.uhrzeit} Uhr` : ''}{wahl == null && t.objekt ? ` · ${t.objekt}` : ''}{t.datum < new Date().toISOString().slice(0, 10) ? ` · überfällig seit ${datum(t.datum)}` : ''}</small></span>
                </Link>))}
              </div>)}
          </section>
        </div>
      </div>
    </div>
  );
}

/** „Was ist zu tun?“: nur, was wirklich ansteht, das Dringendste zuerst, mit direktem Knopf */
function ZuTun({ k, d, pfad, weg }: { k: Row; d: Daten | null; pfad: (unter: string, global: string) => string; weg: boolean | null }) {
  const vj = new Date().getFullYear() - 1;
  const n = (x: unknown) => Number(x) || 0;
  const punkte: { n: number; text: string; knopf: string; ziel: string; dringend?: boolean }[] = [
    { n: n(k.offen_n), text: n(k.offen_n) === 1 ? 'Zahlung überfällig' : 'Zahlungen überfällig', knopf: 'Mahnen', ziel: pfad('mahnungen', '/mahnungen'), dringend: true },
    { n: n(k.fristen), text: n(k.fristen) === 1 ? 'Frist fällig oder bald fällig' : 'Fristen fällig oder bald fällig', knopf: 'Ansehen', ziel: pfad('fristen', '/fristen'), dringend: true },
    { n: n(k.bank_offen), text: n(k.bank_offen) === 1 ? 'Bankumsatz nicht zugeordnet' : 'Bankumsätze nicht zugeordnet', knopf: 'Zuordnen', ziel: pfad('bank', '/bank') },
    { n: n(k.soll_fehlt), text: `Mietverträge ohne Sollstellung für ${new Date().toLocaleDateString('de-DE', { month: 'long' })}`, knopf: 'Erzeugen', ziel: pfad('sollstellungen', '/sollstellungen') },
    ...(weg !== true ? [{ n: n(k.nk_offen), text: `Nebenkostenabrechnung ${vj} offen (Frist 31.12.${vj + 1})`, knopf: 'Abrechnen', ziel: pfad('nebenkosten', '/nebenkosten') }] : []),
    ...(weg !== false ? [{ n: n(k.weg_offen), text: `Hausgeldabrechnung ${vj} nicht abgeschlossen`, knopf: 'Abrechnen', ziel: pfad('hausgeldabrechnung', '/weg-abrechnung') }] : []),
    { n: n(k.rechnungen), text: n(k.rechnungen) === 1 ? 'Rechnung unbezahlt' : 'Rechnungen unbezahlt', knopf: 'Bezahlen', ziel: pfad('rechnungen', '/rechnungen') },
    { n: n(k.vorgaenge), text: 'Instandhaltungen offen', knopf: 'Ansehen', ziel: pfad('instandhaltung', '/instandhaltung') },
    ...(weg !== false ? [{ n: n(k.beschluesse), text: 'Beschlüsse in Umsetzung', knopf: 'Ansehen', ziel: pfad('beschluesse', '/beschluesse') }] : []),
    ...(weg !== true ? [
      { n: n(d?.auslaufend), text: 'Mietverträge enden in 6 Monaten', knopf: 'Ansehen', ziel: pfad('mieter', '/vertraege') },
      { n: n(d?.leer), text: 'Einheiten leer', knopf: 'Vermieten', ziel: pfad('mieter', '/vertraege') },
      { n: n(k.ohne_pdf), text: 'Mietverträge ohne PDF', knopf: 'Hochladen', ziel: pfad('mieter', '/vertraege') }] : []),
  ].filter((x) => x.n > 0);
  if (!punkte.length) return <p className="zutun-leer"><CheckCircle2 size={18} />Alles erledigt. Gerade steht nichts an.</p>;
  return (
    <div className="aufgaben kompakt zutun">
      {punkte.map((x) => (
        <Link key={x.text} to={x.ziel}><span><b className={x.dringend ? 'neg' : ''}>{x.n}</b>{x.text}</span><span className="zutun-knopf">{x.knopf}<ChevronRight size={14} /></span></Link>))}
    </div>
  );
}
