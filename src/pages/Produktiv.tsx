// Produktivität: Kalender, Erinnerungen, Ticket-Boards, Todo und Notizen
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlarmClock, Calendar, ChevronLeft, ChevronRight, CircleCheck, Columns3, Plus, Printer, SquarePen, Trash2 } from 'lucide-react';
import { db, insert, remove, update, type Row } from '../db';
import { datum } from '../components/EntityTable';
import { FirmenPage, PersonenPage } from './Personen';
import { TERMINARTEN, terminKlasse } from '../logic/termine';
import { SchadensberichtDialog } from '../components/SchadensberichtDialog';

const heute = () => new Date().toISOString().slice(0, 10);
const OBJEKTE_SQL = 'SELECT id, name FROM objekte ORDER BY name';

function useObjekte() {
  const [o, setO] = useState<Row[]>([]);
  useEffect(() => { db.select(OBJEKTE_SQL).then(setO); }, []);
  return o;
}
function ObjektWahl({ value, onChange, objekte }: { value: any; onChange: (v: number | null) => void; objekte: Row[] }) {
  return <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
    <option value="">– keine Liegenschaft –</option>{objekte.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>;
}
function Modal({ titel, children, onClose }: { titel: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="modal-bg" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}><h3>{titel}</h3>{children}</div></div>;
}

/* =================== Kontakte =================== */

export function KontaktePage() {
  const [art, setArt] = useState<'Mieter' | 'Firmen' | 'Sonstige'>('Mieter');
  // Lieferanten aus den Ausgaben ohne Adresse: Hinweis am Reiter „Firmen“
  const [ohneAdresse, setOhneAdresse] = useState(0);
  useEffect(() => { db.select('SELECT COUNT(*) AS n FROM firmen WHERE strasse IS NULL OR plz IS NULL OR ort IS NULL').then((r) => setOhneAdresse(Number(r[0]?.n) || 0)); }, [art]);
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="seg">{(['Mieter', 'Firmen', 'Sonstige'] as const).map((a) => <button key={a} className={art === a ? 'on' : ''} onClick={() => setArt(a)}>{a === 'Firmen' ? 'Firmen & Lieferanten' : a}{a === 'Firmen' && ohneAdresse > 0 && <span className="tab-hinweis" title={`${ohneAdresse} ohne Adresse`}>{ohneAdresse}</span>}</button>)}</div>
      </div>
      {art === 'Firmen' ? <FirmenPage /> : <PersonenPage rolle={art} titel={art === 'Sonstige' ? 'Sonstige Kontakte' : undefined} />}
    </>
  );
}

/* =================== Kalender =================== */

function TerminartWahl({ value, onChange }: { value?: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="wide"><span className="small muted">Terminart</span>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
        {TERMINARTEN.map((t) => <button key={t.art} type="button" className={'kal-e ' + t.cls} style={{ display: 'inline-block', padding: '4px 10px', fontSize: 12.5, outline: value === t.art ? '2px solid #1d2733' : 'none' }}
          onClick={() => onChange(value === t.art ? null : t.art)}>{t.art}</button>)}
      </div></div>);
}

type Eintrag = { datum: string; titel: string; art: string; ziel?: string; termin?: Row; uhrzeit?: string; cls?: string };
const FARBE: Record<string, string> = { Termin: 'k-termin', Erinnerung: 'k-erinnerung', Instandhaltung: 'k-vorgang', Rechnung: 'k-rechnung', Ticket: 'k-ticket' };
const farbe = (e: Eintrag) => e.cls || FARBE[e.art] || FARBE[e.art.split(' ')[0]] || 'k-termin';

export function KalenderPage() {
  const objekte = useObjekte();
  const [monat, setMonat] = useState(heute().slice(0, 7));
  const [eintraege, setEintraege] = useState<Eintrag[]>([]);
  const [edit, setEdit] = useState<Row | null>(null);
  const load = async () => {
    const von = `${monat}-01`, bis = `${monat}-31`;
    const q = (sql: string) => db.select(sql, [von, bis]);
    const e: Eintrag[] = [
      ...(await q(`SELECT t.*, o.name AS objekt FROM termine t LEFT JOIN objekte o ON o.id = t.objekt_id WHERE t.datum BETWEEN $1 AND $2`))
        .map((t) => ({ datum: t.datum, titel: t.titel + (t.objekt ? ` · ${t.objekt}` : ''), art: t.art || 'Termin', termin: t, uhrzeit: t.uhrzeit, cls: terminKlasse(t.art) })),
      ...(await q(`SELECT * FROM erinnerungen WHERE erledigt = 0 AND faellig BETWEEN $1 AND $2`)).map((r) => ({ datum: r.faellig, titel: r.titel, art: 'Erinnerung', ziel: '/erinnerungen', uhrzeit: r.uhrzeit })),
      ...(await q(`SELECT v.*, o.name AS objekt FROM versammlungen v JOIN objekte o ON o.id = v.objekt_id WHERE v.datum BETWEEN $1 AND $2`))
        .map((v) => ({ datum: v.datum, titel: `${v.art} ${v.objekt}${v.status === 'Durchgeführt' ? ' ✓' : ''}`, art: 'Eigentümerversammlung', ziel: `/objekte/${v.objekt_id}/versammlungen/${v.id}`, uhrzeit: v.uhrzeit, cls: 'ta-versammlung' })),
      ...(await q(`SELECT v.*, o.name AS objekt FROM vorgaenge v JOIN objekte o ON o.id = v.objekt_id WHERE v.status <> 'Erledigt' AND v.faellig BETWEEN $1 AND $2`))
        .map((v) => ({ datum: v.faellig, titel: `${v.betreff} · ${v.objekt}`, art: 'Instandhaltung', ziel: `/objekte/${v.objekt_id}/instandhaltung` })),
      ...(await q(`SELECT r.*, f.name AS firma FROM rechnungen r LEFT JOIN firmen f ON f.id = r.firma_id WHERE r.bezahlt_am IS NULL AND r.faellig BETWEEN $1 AND $2`))
        .map((r) => ({ datum: r.faellig, titel: `Rechnung ${r.rechnungsnr ?? ''} ${r.firma ?? ''}`.trim(), art: 'Rechnung', ziel: `/objekte/${r.objekt_id}/buchungen` })),
      ...(await q(`SELECT t.*, b.name AS board FROM tickets t JOIN boards b ON b.id = t.board_id WHERE t.status <> 'Erledigt' AND t.faellig BETWEEN $1 AND $2`))
        .map((t) => ({ datum: t.faellig, titel: `${t.titel} (${t.board})`, art: t.terminart ? `Ticket · ${t.terminart}` : 'Ticket', ziel: '/tickets', uhrzeit: t.uhrzeit, cls: terminKlasse(t.terminart) })),
    ];
    setEintraege(e.sort((a, b) => (a.uhrzeit ?? '').localeCompare(b.uhrzeit ?? '')));
  };
  useEffect(() => { load(); }, [monat]);

  const [j, m] = monat.split('-').map(Number);
  const erster = new Date(Date.UTC(j, m - 1, 1));
  const start = (erster.getUTCDay() + 6) % 7; // Montag = 0
  const tage = new Date(Date.UTC(j, m, 0)).getUTCDate();
  const zellen = Array.from({ length: Math.ceil((start + tage) / 7) * 7 }, (_, i) => i - start + 1);
  const blaettern = (d: number) => { const x = new Date(Date.UTC(j, m - 1 + d, 1)); setMonat(x.toISOString().slice(0, 7)); };
  const tagIso = (t: number) => `${monat}-${String(t).padStart(2, '0')}`;

  async function speichern() {
    if (!edit?.titel || !edit.datum) return;
    const v = { titel: edit.titel, datum: edit.datum, uhrzeit: edit.uhrzeit || null, art: edit.art || null, objekt_id: edit.objekt_id ?? null, notiz: edit.notiz || null };
    if (edit.id) await update('termine', edit.id, v); else await insert('termine', v);
    setEdit(null); load();
  }
  return (
    <>
      <div className="page-head"><h1 className="title-ico"><Calendar size={26} />Kalender</h1><p className="muted">Termine, Erinnerungen, Versammlungen, fällige Instandhaltung, Rechnungen und Tickets</p></div>
      <section className="card">
        <div className="card-head">
          <div className="row"><button className="icon-btn" onClick={() => blaettern(-1)}><ChevronLeft size={18} /></button>
            <h2 style={{ minWidth: 190, textAlign: 'center' }}>{erster.toLocaleDateString('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h2>
            <button className="icon-btn" onClick={() => blaettern(1)}><ChevronRight size={18} /></button>
            <button onClick={() => setMonat(heute().slice(0, 7))}>Heute</button></div>
          <button className="primary" onClick={() => setEdit({ datum: heute() })}><Plus size={16} />Termin</button>
        </div>
        <div className="kal">
          {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((t) => <div key={t} className="kal-kopf">{t}</div>)}
          {zellen.map((t, i) => {
            const gueltig = t >= 1 && t <= tage;
            const d = gueltig ? tagIso(t) : '';
            return (
              <div key={i} className={'kal-tag' + (gueltig ? '' : ' leer') + (d === heute() ? ' heute' : '')} onDoubleClick={() => gueltig && setEdit({ datum: d })}>
                {gueltig && <><span className="kal-nr">{t}</span>
                  {eintraege.filter((e) => e.datum === d).map((e, k) => e.termin
                    ? <button key={k} className={'kal-e ' + farbe(e)} onClick={() => setEdit(e.termin!)} title={e.titel}>{e.uhrzeit ? e.uhrzeit + ' ' : ''}{e.titel}</button>
                    : <Link key={k} to={e.ziel!} className={'kal-e ' + farbe(e)} title={`${e.art}: ${e.titel}`}>{e.uhrzeit ? e.uhrzeit + ' ' : ''}{e.titel}</Link>)}</>}
              </div>);
          })}
        </div>
        <div className="kal-legende small muted" style={{ marginTop: 10 }}>
          {TERMINARTEN.map((t) => <span key={t.art}><i className={'kal-punkt ' + t.cls} />{t.art}</span>)}
          {Object.entries(FARBE).map(([a, c]) => <span key={a}><i className={'kal-punkt ' + c} />{a === 'Termin' ? 'Termin ohne Art' : a}</span>)}</div>
        <p className="small muted" style={{ marginTop: 4 }}>Doppelklick auf einen Tag legt einen Termin an.</p>
      </section>
      {edit && <Modal titel={edit.id ? 'Termin bearbeiten' : 'Termin anlegen'} onClose={() => setEdit(null)}>
        <div className="form">
          <label className="wide"><span>Titel *</span><input autoFocus value={edit.titel ?? ''} onChange={(e) => setEdit({ ...edit, titel: e.target.value })} /></label>
          <label><span>Datum *</span><input type="date" value={edit.datum ?? ''} onChange={(e) => setEdit({ ...edit, datum: e.target.value })} /></label>
          <label><span>Uhrzeit</span><input type="time" value={edit.uhrzeit ?? ''} onChange={(e) => setEdit({ ...edit, uhrzeit: e.target.value })} /></label>
          <TerminartWahl value={edit.art} onChange={(art) => setEdit({ ...edit, art })} />
          <label className="wide"><span>Liegenschaft</span><ObjektWahl value={edit.objekt_id} objekte={objekte} onChange={(v) => setEdit({ ...edit, objekt_id: v })} /></label>
          <label className="wide"><span>Notiz</span><textarea rows={3} value={edit.notiz ?? ''} onChange={(e) => setEdit({ ...edit, notiz: e.target.value })} /></label>
        </div>
        <div className="row end">{edit.id && <button className="danger" onClick={async () => { await remove('termine', edit.id); setEdit(null); load(); }}>Löschen</button>}
          <span className="grow" /><button onClick={() => setEdit(null)}>Abbrechen</button><button className="primary" onClick={speichern}>Speichern</button></div>
      </Modal>}
    </>
  );
}

/* =================== Erinnerungen =================== */

export function ErinnerungenPage() {
  const objekte = useObjekte();
  const [rows, setRows] = useState<Row[]>([]);
  const [neu, setNeu] = useState<Row | null>(null);
  const [zeigeErledigt, setZeigeErledigt] = useState(false);
  const [frisch, setFrisch] = useState<number | null>(null);
  const load = () => db.select(`SELECT r.*, o.name AS objekt FROM erinnerungen r LEFT JOIN objekte o ON o.id = r.objekt_id ORDER BY r.erledigt, r.faellig, r.uhrzeit`).then(setRows);
  useEffect(() => { load(); }, []);
  async function gespeichert(id: number) { setNeu(null); setFrisch(id); await load(); setTimeout(() => setFrisch(null), 2400); }
  const h = heute();
  const gruppen: [string, Row[]][] = [
    ['Überfällig', rows.filter((r) => !r.erledigt && r.faellig < h)],
    ['Heute', rows.filter((r) => !r.erledigt && r.faellig === h)],
    ['Demnächst', rows.filter((r) => !r.erledigt && r.faellig > h)],
    ...(zeigeErledigt ? [['Erledigt', rows.filter((r) => r.erledigt)] as [string, Row[]]] : []),
  ];
  return (
    <>
      <div className="page-head row"><div className="grow"><h1 className="title-ico"><AlarmClock size={26} />Erinnerungen</h1><p className="muted">Woran du denken musst, mit Grenztermin. Fällige Erinnerungen stehen auch im Kalender.</p></div>
        <button className="primary erin-neu-btn" onClick={() => setNeu({ faellig: '', objekt_id: null })}><Plus size={17} />Neue Erinnerung</button></div>
      {gruppen.map(([t, liste]) => liste.length > 0 && (
        <section key={t} className="card">
          <div className="card-head"><h2 className={t === 'Überfällig' ? 'neg' : ''}>{t} ({liste.length})</h2></div>
          <ul className="checkliste erin-liste">{liste.map((r) => (
            <li key={r.id} className={(r.erledigt ? 'fertig' : '') + (frisch === r.id ? ' erin-frisch' : '')}>
              <input type="checkbox" checked={!!r.erledigt} onChange={async () => { await update('erinnerungen', r.id, { erledigt: r.erledigt ? 0 : 1 }); load(); }} />
              <span className="grow"><b>{r.titel}</b>{r.objekt && <span className="erin-chip">{r.objekt}</span>}
                {r.notiz && <span className="erin-notiz">{r.notiz}</span>}
                {r.erstellt && <span className="muted small erin-erstellt">erstellt am {datum(r.erstellt)}</span>}</span>
              <span className={'small ' + (!r.erledigt && r.faellig < h ? 'neg' : 'muted')}>bis {datum(r.faellig)}{r.uhrzeit ? ` ${r.uhrzeit}` : ''}</span>
              <button className="icon-btn" title="Löschen" onClick={async () => { await remove('erinnerungen', r.id); load(); }}><Trash2 size={15} /></button>
            </li>))}</ul>
        </section>))}
      {!rows.some((r) => !r.erledigt) && <section className="card erin-leer"><AlarmClock size={30} /><p>Keine offenen Erinnerungen.</p><button className="primary" onClick={() => setNeu({ faellig: '', objekt_id: null })}><Plus size={16} />Neue Erinnerung</button></section>}
      <button className="link" onClick={() => setZeigeErledigt(!zeigeErledigt)}>{zeigeErledigt ? 'Erledigte ausblenden' : 'Erledigte anzeigen'}</button>
      {neu && <ErinnerungFenster objekte={objekte} start={neu} onClose={() => setNeu(null)} onSaved={gespeichert} />}
    </>
  );
}

/** Fenster „Neue Erinnerung“: fünf Schritte untereinander, jeder erscheint mit einer kleinen Animation. */
function ErinnerungFenster({ objekte, start, onClose, onSaved }: { objekte: Row[]; start: Row; onClose: () => void; onSaved: (id: number) => void }) {
  const [e, setE] = useState<Row>(start);
  const [fehler, setFehler] = useState('');
  const [zu, setZu] = useState(false);
  const h = heute();
  const fertig = [!!e.objekt_id, true, !!e.titel?.trim(), !!e.faellig, !!e.notiz?.trim()];
  const schliessen = () => { setZu(true); setTimeout(onClose, 220); };
  const schnell = (tage: number) => { const d = new Date(); d.setDate(d.getDate() + tage); return d.toISOString().slice(0, 10); };
  async function speichern() {
    if (!e.titel?.trim()) { setFehler('Bitte einen Betreff eintragen.'); return; }
    if (!e.faellig) { setFehler('Bitte einen Grenztermin wählen.'); return; }
    const id = await insert('erinnerungen', { titel: e.titel.trim(), faellig: e.faellig, uhrzeit: e.uhrzeit || null, objekt_id: e.objekt_id ?? null, notiz: e.notiz?.trim() || null, erstellt: h });
    setZu(true); setTimeout(() => onSaved(id), 200);
  }
  const Schritt = ({ n, titel, children }: { n: number; titel: string; children: React.ReactNode }) => (
    <div className={'erin-schritt' + (fertig[n - 1] ? ' ok' : '')} style={{ animationDelay: `${60 + n * 70}ms` }}>
      <span className="erin-nr">{fertig[n - 1] ? '✓' : n}</span>
      <div className="erin-feld"><span className="erin-label">{titel}</span>{children}</div>
    </div>);
  return (
    <div className={'modal-bg erin-bg' + (zu ? ' zu' : '')} onClick={schliessen}>
      <div className={'modal erin-modal' + (zu ? ' zu' : '')} onClick={(x) => x.stopPropagation()} onKeyDown={(x) => { if (x.key === 'Enter' && (x.metaKey || x.ctrlKey)) speichern(); }}>
        <div className="erin-kopf"><span className="erin-glocke"><AlarmClock size={22} /></span><div><h3>Neue Erinnerung</h3><p className="muted small">In fünf Schritten. Speichern mit Strg + Enter.</p></div></div>
        {Schritt({ n: 1, titel: 'Liegenschaft', children: <ObjektWahl value={e.objekt_id} objekte={objekte} onChange={(v) => setE({ ...e, objekt_id: v })} /> })}
        {Schritt({ n: 2, titel: 'Erstellt am', children: <div className="erin-auto">{datum(h)} <span className="muted small">wird automatisch eingetragen</span></div> })}
        {Schritt({ n: 3, titel: 'Betreff', children: <input autoFocus placeholder="Woran soll erinnert werden?" value={e.titel ?? ''} onChange={(x) => setE({ ...e, titel: x.target.value })} /> })}
        {Schritt({ n: 4, titel: 'Grenztermin', children: <div className="erin-termin">
          <input type="date" value={e.faellig ?? ''} min={h} onChange={(x) => setE({ ...e, faellig: x.target.value })} />
          <input type="time" value={e.uhrzeit ?? ''} onChange={(x) => setE({ ...e, uhrzeit: x.target.value })} title="Uhrzeit (optional)" />
          <div className="erin-schnell">{[['Morgen', 1], ['1 Woche', 7], ['2 Wochen', 14], ['1 Monat', 30]].map(([t, d]) => <button key={t} type="button" className={e.faellig === schnell(Number(d)) ? 'on' : ''} onClick={() => setE({ ...e, faellig: schnell(Number(d)) })}>{t}</button>)}</div></div> })}
        {Schritt({ n: 5, titel: 'Notiz', children: <textarea rows={3} placeholder="Details, Ansprechpartner, was zu tun ist …" value={e.notiz ?? ''} onChange={(x) => setE({ ...e, notiz: x.target.value })} /> })}
        {fehler && <p className="error">{fehler}</p>}
        <div className="row end erin-fuss"><button onClick={schliessen}>Abbrechen</button><button className="primary" onClick={speichern}><AlarmClock size={16} />Erinnerung speichern</button></div>
      </div>
    </div>
  );
}

/* =================== Ticket-Boards =================== */

const SPALTEN = ['Offen', 'In Arbeit', 'Erledigt'];
const INSTAND = -1; // eingebautes Board: Instandhaltungsvorgänge aller Liegenschaften

export function TicketBoardsPage() {
  const objekte = useObjekte();
  const [boards, setBoards] = useState<Row[]>([]);
  const [board, setBoard] = useState<number>(INSTAND);
  const [karten, setKarten] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [verwalten, setVerwalten] = useState(false);
  const [neuBoard, setNeuBoard] = useState('');
  const [ziehe, setZiehe] = useState<number | null>(null);
  const [ueber, setUeber] = useState('');
  const [bericht, setBericht] = useState(false);
  const instand = board === INSTAND;
  const ladeBoards = () => db.select('SELECT b.*, (SELECT COUNT(*) FROM tickets t WHERE t.board_id = b.id AND t.status <> \'Erledigt\') AS offen FROM boards b ORDER BY b.name').then(setBoards);
  const load = async () => setKarten(instand
    ? await db.select(`SELECT v.id, v.betreff AS titel, v.status, v.prioritaet, v.faellig, v.objekt_id, v.notiz, o.name AS objekt FROM vorgaenge v JOIN objekte o ON o.id = v.objekt_id
        ORDER BY CASE v.prioritaet WHEN 'Hoch' THEN 0 WHEN 'Mittel' THEN 1 ELSE 2 END, v.faellig`)
    : await db.select(`SELECT t.*, o.name AS objekt FROM tickets t LEFT JOIN objekte o ON o.id = t.objekt_id WHERE t.board_id = $1
        ORDER BY CASE t.prioritaet WHEN 'Hoch' THEN 0 WHEN 'Mittel' THEN 1 ELSE 2 END, t.faellig`, [board]));
  useEffect(() => { ladeBoards(); }, []);
  useEffect(() => { load(); }, [board]);

  async function verschieben(id: number, status: string) {
    if (instand) await update('vorgaenge', id, { status, erledigt_am: status === 'Erledigt' ? heute() : null });
    else await update('tickets', id, { status });
    load(); ladeBoards();
  }
  async function speichern() {
    if (!edit?.titel?.trim()) return;
    if (instand) {
      if (!edit.objekt_id) return;
      const v = { betreff: edit.titel.trim(), status: edit.status ?? 'Offen', prioritaet: edit.prioritaet ?? 'Mittel', faellig: edit.faellig || null, objekt_id: edit.objekt_id, notiz: edit.notiz || null };
      if (edit.id) await update('vorgaenge', edit.id, v); else await insert('vorgaenge', v);
    } else {
      const v = { board_id: board, titel: edit.titel.trim(), status: edit.status ?? 'Offen', prioritaet: edit.prioritaet ?? 'Mittel', faellig: edit.faellig || null,
        uhrzeit: edit.uhrzeit || null, terminart: edit.terminart || null, objekt_id: edit.objekt_id ?? null, notiz: edit.notiz || null };
      if (edit.id) await update('tickets', edit.id, v); else await insert('tickets', v);
    }
    setEdit(null); load(); ladeBoards();
  }
  const h = heute();
  return (
    <>
      <div className="page-head"><h1 className="title-ico"><Columns3 size={26} />Ticket-Boards</h1><p className="muted">Aufgaben als Karten. Zum Verschieben eine Karte in eine andere Spalte ziehen.</p></div>
      <section className="card row">
        <div className="seg">
          <button className={instand ? 'on' : ''} onClick={() => setBoard(INSTAND)}>Instandhaltung</button>
          {boards.map((b) => <button key={b.id} className={board === b.id ? 'on' : ''} onClick={() => setBoard(b.id)}>{b.name}{b.offen ? ` (${b.offen})` : ''}</button>)}
        </div>
        <span className="grow" />
        <button onClick={() => setBericht(true)}><Printer size={16} />Schadensbericht drucken</button>
        <button onClick={() => setVerwalten(true)}>Board-Verwaltung</button>
        <button className="primary" onClick={() => setEdit({ status: 'Offen', prioritaet: 'Mittel' })}><Plus size={16} />Karte</button>
      </section>
      {bericht && <SchadensberichtDialog onClose={() => setBericht(false)} />}
      <div className="board">
        {SPALTEN.map((s) => {
          const liste = karten.filter((k) => k.status === s);
          return (
            <div key={s} className={'board-spalte' + (ueber === s ? ' over' : '')}
              onDragOver={(e) => { e.preventDefault(); setUeber(s); }} onDragLeave={() => setUeber('')}
              onDrop={(e) => { e.preventDefault(); setUeber(''); if (ziehe != null) verschieben(ziehe, s); setZiehe(null); }}>
              <div className="board-kopf"><b>{s}</b><span className="muted">{liste.length}</span></div>
              {liste.map((k) => (
                <div key={k.id} className={'board-karte prio-' + String(k.prioritaet).toLowerCase() + (k.faellig && k.terminart ? ' ' + terminKlasse(k.terminart) : '')} draggable onDragStart={() => setZiehe(k.id)} onClick={() => setEdit(k)}>
                  <b>{k.titel}</b>
                  <div className="small muted">{[k.objekt, k.faellig && `${k.terminart ? 'Termin' : 'fällig'} ${datum(k.faellig)}${k.uhrzeit ? ' ' + k.uhrzeit : ''}`, k.faellig && k.terminart].filter(Boolean).join(' · ')}</div>
                  {k.faellig && k.faellig < h && s !== 'Erledigt' && <div className="small neg">überfällig</div>}
                </div>))}
              {liste.length === 0 && <p className="muted small" style={{ padding: 8 }}>Keine Karten</p>}
            </div>);
        })}
      </div>
      {edit && <Modal titel={edit.id ? 'Karte bearbeiten' : instand ? 'Instandhaltungsvorgang anlegen' : 'Karte anlegen'} onClose={() => setEdit(null)}>
        <div className="form">
          <label className="wide"><span>Titel *</span><input autoFocus value={edit.titel ?? ''} onChange={(e) => setEdit({ ...edit, titel: e.target.value })} /></label>
          <label><span>Status</span><select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{SPALTEN.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label><span>Priorität</span><select value={edit.prioritaet} onChange={(e) => setEdit({ ...edit, prioritaet: e.target.value })}>{['Niedrig', 'Mittel', 'Hoch'].map((x) => <option key={x}>{x}</option>)}</select></label>
          <label><span>{edit.terminart ? 'Termin am' : 'Fällig'}</span><input type="date" value={edit.faellig ?? ''} onChange={(e) => setEdit({ ...edit, faellig: e.target.value })} /></label>
          {!instand && <label><span>Uhrzeit</span><input type="time" value={edit.uhrzeit ?? ''} onChange={(e) => setEdit({ ...edit, uhrzeit: e.target.value })} /></label>}
          {!instand && <TerminartWahl value={edit.terminart} onChange={(terminart) => setEdit({ ...edit, terminart })} />}
          <label><span>Liegenschaft{instand ? ' *' : ''}</span><ObjektWahl value={edit.objekt_id} objekte={objekte} onChange={(v) => setEdit({ ...edit, objekt_id: v })} /></label>
          <label className="wide"><span>Beschreibung</span><textarea rows={4} value={edit.notiz ?? ''} onChange={(e) => setEdit({ ...edit, notiz: e.target.value })} /></label>
        </div>
        {instand && !edit.objekt_id && <p className="muted small">Instandhaltungsvorgänge gehören immer zu einer Liegenschaft.</p>}
        <div className="row end">{edit.id && <button className="danger" onClick={async () => { await remove(instand ? 'vorgaenge' : 'tickets', edit.id); setEdit(null); load(); ladeBoards(); }}>Löschen</button>}
          <span className="grow" /><button onClick={() => setEdit(null)}>Abbrechen</button><button className="primary" onClick={speichern}>Speichern</button></div>
      </Modal>}
      {verwalten && <Modal titel="Board-Verwaltung" onClose={() => setVerwalten(false)}>
        <p className="muted small">„Instandhaltung“ ist fest eingebaut und zeigt die Vorgänge aller Liegenschaften. Eigene Boards legst du hier an.</p>
        <ul className="checkliste">{boards.map((b) => (
          <li key={b.id}><input className="grow" defaultValue={b.name} onBlur={async (e) => { if (e.target.value.trim() && e.target.value !== b.name) { await update('boards', b.id, { name: e.target.value.trim() }); ladeBoards(); } }} />
            <button className="icon-btn" title="Board mit allen Karten löschen" onClick={async () => { if (!window.confirm(`Board „${b.name}“ mit allen Karten löschen?`)) return; await remove('boards', b.id); if (board === b.id) setBoard(INSTAND); ladeBoards(); }}><Trash2 size={15} /></button></li>))}</ul>
        <div className="row"><input className="grow" placeholder="Name des neuen Boards" value={neuBoard} onChange={(e) => setNeuBoard(e.target.value)} />
          <button className="primary" onClick={async () => { if (!neuBoard.trim()) return; const id = await insert('boards', { name: neuBoard.trim() }); setNeuBoard(''); await ladeBoards(); setBoard(id); }}><Plus size={16} />Anlegen</button></div>
        <div className="row end" style={{ marginTop: 12 }}><button onClick={() => setVerwalten(false)}>Fertig</button></div>
      </Modal>}
    </>
  );
}

/* =================== Todo =================== */

// Aufgaben: frei oder einer Liegenschaft zugeordnet. Mit objektId erscheint die Liste als Reiter „Aufgaben“ in der Immobilie.
export function TodoPage({ objektId }: { objektId?: number } = {}) {
  const objekte = useObjekte();
  const [rows, setRows] = useState<Row[]>([]);
  const [termine, setTermine] = useState<Row[]>([]);
  const [text, setText] = useState('');
  const [faellig, setFaellig] = useState('');
  const [objekt, setObjekt] = useState<number | null>(objektId ?? null);
  const [filter, setFilter] = useState<'offen' | 'erledigt' | 'alle'>('offen');
  const [nachObjekt, setNachObjekt] = useState<string>('');
  const [edit, setEdit] = useState<Row | null>(null);
  const load = () => {
    const wo = objektId ? `WHERE t.objekt_id = ${Number(objektId)}` : '';
    db.select(`SELECT t.*, o.name AS objekt FROM todos t LEFT JOIN objekte o ON o.id = t.objekt_id ${wo} ORDER BY t.erledigt, t.faellig IS NULL, t.faellig, t.id DESC`).then(setRows);
    if (objektId) db.select(`SELECT 'Erinnerung' AS art, r.id, r.titel, r.faellig, '/erinnerungen' AS ziel FROM erinnerungen r WHERE r.objekt_id = $1 AND NOT r.erledigt
      UNION ALL SELECT 'Ticket' AS art, t.id, t.titel, t.faellig, '/tickets' AS ziel FROM tickets t WHERE t.objekt_id = $1 AND COALESCE(t.status, '') NOT IN ('Erledigt', 'Geschlossen')
      ORDER BY 4 IS NULL, 4`, [objektId]).then(setTermine).catch(() => setTermine([]));
  };
  useEffect(() => { load(); }, [objektId]);
  async function anlegen() {
    if (!text.trim()) return;
    await insert('todos', { text: text.trim(), faellig: faellig || null, objekt_id: objektId ?? objekt });
    setText(''); setFaellig(''); load();
  }
  async function speichern() {
    if (!edit || !edit.text?.trim()) return;
    await update('todos', edit.id, { text: edit.text.trim(), faellig: edit.faellig || null, objekt_id: edit.objekt_id ?? null });
    setEdit(null); load();
  }
  const passt = (r: Row) => !nachObjekt || (nachObjekt === 'ohne' ? !r.objekt_id : String(r.objekt_id) === nachObjekt);
  const basis = rows.filter(passt);
  const liste = basis.filter((r) => filter === 'alle' || (filter === 'offen' ? !r.erledigt : r.erledigt));
  const h = heute();
  return (
    <>
      <div className="page-head"><h1 className="title-ico"><CircleCheck size={26} />{objektId ? 'Aufgaben' : 'Todo'}</h1>
        <p className="muted">{objektId ? 'Aufgaben, Erinnerungen und Tickets dieser Liegenschaft.' : 'Deine Aufgaben: eintippen, Enter, erledigt abhaken. Mit der Liegenschaft ordnest du sie einer Immobilie zu.'}</p></div>
      <section className={'card aufgabe-neu' + (objektId ? ' ohne-objekt' : '')}>
        <input placeholder="Neue Aufgabe …" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && anlegen()} />
        <input type="date" value={faellig} onChange={(e) => setFaellig(e.target.value)} title="Fällig bis" />
        {!objektId && <ObjektWahl value={objekt} objekte={objekte} onChange={setObjekt} />}
        <button className="primary" onClick={anlegen}><Plus size={16} />Hinzufügen</button>
      </section>
      <section className="card">
        <div className="card-head"><h2>Aufgaben</h2>
          <div className="row" style={{ gap: 10 }}>
            {!objektId && <select value={nachObjekt} onChange={(e) => setNachObjekt(e.target.value)} title="Nach Liegenschaft filtern" style={{ width: 210 }}>
              <option value="">Alle Liegenschaften</option><option value="ohne">Ohne Liegenschaft</option>
              {objekte.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
            <div className="seg">{(['offen', 'erledigt', 'alle'] as const).map((f) => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)} ({basis.filter((r) => f === 'alle' || (f === 'offen' ? !r.erledigt : r.erledigt)).length})</button>)}</div></div></div>
        {liste.length === 0 ? <p className="muted">Nichts zu tun.</p> : (
          <ul className="checkliste">{liste.map((r) => (
            <li key={r.id} className={r.erledigt ? 'fertig' : ''}>
              <input type="checkbox" checked={!!r.erledigt} onChange={async () => { await update('todos', r.id, { erledigt: r.erledigt ? 0 : 1 }); load(); }} />
              <span className="grow">{r.text}{!objektId && r.objekt && <Link className="aufgabe-objekt" to={`/objekte/${r.objekt_id}/aufgaben`}>{r.objekt}</Link>}</span>
              {r.faellig && <span className={'small ' + (!r.erledigt && r.faellig < h ? 'neg' : 'muted')}>bis {datum(r.faellig)}</span>}
              <button className="icon-btn" title="Bearbeiten und Liegenschaft zuordnen" onClick={() => setEdit({ ...r })}><SquarePen size={15} /></button>
              <button className="icon-btn" title="Löschen" onClick={async () => { await remove('todos', r.id); load(); }}><Trash2 size={15} /></button>
            </li>))}</ul>)}
      </section>
      {objektId && termine.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>Offene Erinnerungen und Tickets</h2></div>
          <ul className="checkliste">{termine.map((t) => (
            <li key={t.art + t.id}><span className="tag">{t.art}</span><span className="grow"><Link to={t.ziel}>{t.titel}</Link></span>
              {t.faellig && <span className={'small ' + (t.faellig < h ? 'neg' : 'muted')}>bis {datum(t.faellig)}</span>}</li>))}</ul>
        </section>)}
      {edit && <Modal titel="Aufgabe bearbeiten" onClose={() => setEdit(null)}>
        <div className="form">
          <label className="wide"><span>Aufgabe</span><input value={edit.text ?? ''} onChange={(e) => setEdit({ ...edit, text: e.target.value })} autoFocus /></label>
          <label><span>Fällig bis</span><input type="date" value={edit.faellig ?? ''} onChange={(e) => setEdit({ ...edit, faellig: e.target.value })} /></label>
          <label><span>Liegenschaft</span><ObjektWahl value={edit.objekt_id} objekte={objekte} onChange={(v) => setEdit({ ...edit, objekt_id: v })} /></label>
        </div>
        <div className="row end"><span className="grow" /><button onClick={() => setEdit(null)}>Abbrechen</button><button className="primary" onClick={speichern}>Speichern</button></div>
      </Modal>}
    </>
  );
}

/* =================== Notizen =================== */

export function NotizenPage() {
  const objekte = useObjekte();
  const [rows, setRows] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [suche, setSuche] = useState('');
  const load = () => db.select(`SELECT n.*, o.name AS objekt FROM notizen n LEFT JOIN objekte o ON o.id = n.objekt_id ORDER BY n.geaendert DESC`).then(setRows);
  useEffect(() => { load(); }, []);
  const liste = useMemo(() => { const s = suche.trim().toLowerCase(); return s ? rows.filter((r) => `${r.titel} ${r.text} ${r.objekt}`.toLowerCase().includes(s)) : rows; }, [rows, suche]);
  async function speichern() {
    if (!edit || (!edit.titel?.trim() && !edit.text?.trim())) { setEdit(null); return; }
    const v = { titel: edit.titel?.trim() || null, text: edit.text || null, objekt_id: edit.objekt_id ?? null, geaendert: new Date().toISOString().slice(0, 19).replace('T', ' ') };
    if (edit.id) await update('notizen', edit.id, v); else await insert('notizen', v);
    setEdit(null); load();
  }
  return (
    <>
      <div className="page-head"><h1 className="title-ico"><SquarePen size={26} />Notizen</h1><p className="muted">Freie Notizen, auf Wunsch einer Liegenschaft zugeordnet.</p></div>
      <section className="card row"><input className="grow" placeholder="Notizen durchsuchen …" value={suche} onChange={(e) => setSuche(e.target.value)} />
        <button className="primary" onClick={() => setEdit({})}><Plus size={16} />Notiz</button></section>
      {liste.length === 0 ? <p className="muted">Noch keine Notizen.</p> : (
        <div className="notizen">{liste.map((n) => (
          <button key={n.id} className="notiz" onClick={() => setEdit(n)}>
            <b>{n.titel || 'Ohne Titel'}</b><p>{String(n.text ?? '').slice(0, 260)}</p>
            <span className="muted small">{n.objekt ? `${n.objekt} · ` : ''}{datum(String(n.geaendert).slice(0, 10))}</span>
          </button>))}</div>)}
      {edit && <Modal titel={edit.id ? 'Notiz bearbeiten' : 'Neue Notiz'} onClose={speichern}>
        <div className="form">
          <label className="wide"><span>Titel</span><input autoFocus value={edit.titel ?? ''} onChange={(e) => setEdit({ ...edit, titel: e.target.value })} /></label>
          <label className="wide"><span>Notiz</span><textarea rows={10} value={edit.text ?? ''} onChange={(e) => setEdit({ ...edit, text: e.target.value })} /></label>
          <label className="wide"><span>Liegenschaft</span><ObjektWahl value={edit.objekt_id} objekte={objekte} onChange={(v) => setEdit({ ...edit, objekt_id: v })} /></label>
        </div>
        <div className="row end">{edit.id && <button className="danger" onClick={async () => { await remove('notizen', edit.id); setEdit(null); load(); }}>Löschen</button>}
          <span className="grow" /><button onClick={() => setEdit(null)}>Verwerfen</button><button className="primary" onClick={speichern}>Speichern</button></div>
      </Modal>}
    </>
  );
}
