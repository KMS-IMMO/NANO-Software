import { useEffect, useRef, useState, type ReactNode } from 'react';
import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  AlarmClock, Banknote, CalendarClock, Bell, Building2, Calendar, ChevronRight, CircleCheck, Columns3, Contact, CreditCard, FolderOpen, LayoutDashboard, Landmark, Lock,
  Network, Receipt, Search, Settings, SquarePen, UserCog, Users,
} from 'lucide-react';
import { db, mehrplatz, sicherheit, type Row } from './db';
import { personLabel } from './db/labels';
import { OP_SQL } from './logic/soll';
import { Sperre, SPERREN } from './components/Sperre';
import { Logo } from './components/Logo';
import { KiAssistent } from './components/KiAssistent';
import { ModalHelfer } from './components/ModalHelfer';
import { DashboardPage } from './pages/Dashboard';
import { ObjektDetailPage, ObjektePage } from './pages/Objekte';
import { FirmenPage, PersonenPage } from './pages/Personen';
import { VertragDetailPage, VertraegePage } from './pages/Vertraege';
import { OffenePostenPage } from './pages/OffenePosten';
import { BankPage } from './pages/Bank';
import { MahnungenPage } from './pages/Mahnungen';
import { NebenkostenPage } from './pages/Nebenkosten';
import { DokumentePage } from './pages/Dokumente';
import { EigentuemerAbrechnungPage, WegAbrechnungPage } from './pages/Jahresabrechnungen';
import { EinstellungenPage, KontenPage, RechnungenPage } from './pages/Konten';
import { BeschluessePage, InstandhaltungPage } from './pages/Weg';
import { AuswertungPage, BerichtePage, JournalPage, RegelnPage } from './pages/Buchhaltung';
import { ObjektAssistentPage } from './pages/ObjektAssistent';
import { SollstellungenPage } from './pages/Sollstellungen';
import { autoAbruf, BANK_INFO } from './logic/bankAbruf';
import { wiederkehrendErzeugen } from './logic/wiederkehrend';
import { FristenPage } from './pages/Fristen';
import { ErinnerungenPage, KalenderPage, KontaktePage, NotizenPage, TicketBoardsPage, TodoPage } from './pages/Produktiv';

type Item = { to: string; label: string; icon?: ReactNode; sub?: string };
type Group = { label: string; icon: ReactNode; items: Item[] };
type Abschnitt = { titel: string; eintraege: (Item | Group)[] };
const I = 18;
const NAV: Abschnitt[] = [
  { titel: 'Verwaltung', eintraege: [
    { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={I} /> },
    { to: '/objekte', label: 'Immobilien', icon: <Building2 size={I} /> },
    { to: '/eigentuemer', label: 'Eigentümer', icon: <Users size={I} /> },
    { to: '/verwalter', label: 'Verwalter', icon: <UserCog size={I} /> },
    { to: '/kontakte', label: 'Kontakte', icon: <Contact size={I} /> },
    { to: '/ablage', label: 'Dateimanager', icon: <FolderOpen size={I} /> },
  ] },
  { titel: 'Buchhaltung', eintraege: [
    { label: 'Online Banking', icon: <CreditCard size={I} />, items: [
      { to: '/bank', label: 'Bank & Zuordnung' },
      { to: '/regeln', label: 'Buchungsregeln' },
    ] },
    { label: 'Sollstellung', icon: <Banknote size={I} />, items: [
      { to: '/sollstellungen', label: 'Sollstellungen' },
      { to: '/offene-posten', label: 'Offene Posten' },
      { to: '/vertraege', label: 'Mietverträge' },
      { to: '/mahnungen', label: 'Mahnungen' },
      { to: '/weg-abrechnung', label: 'Hausgeldabrechnung' },
      { to: '/nebenkosten', label: 'Nebenkostenabrechnung' },
      { to: '/eigentuemer-abrechnung', label: 'Eigentümerabrechnung' },
    ] },
    { to: '/rechnungen', label: 'Ausgaben', icon: <Receipt size={I} /> },
    { label: 'Buchungskonten', icon: <Network size={I} />, items: [
      { to: '/konten', label: 'Kontenplan' },
      { to: '/journal', label: 'Buchungsjournal' },
      { to: '/auswertung', label: 'Auswertung (GuV)' },
      { to: '/berichte', label: 'Berichte' },
    ] },
  ] },
  { titel: 'Produktivität', eintraege: [
    { to: '/kalender', label: 'Kalender', icon: <Calendar size={I} /> },
    { to: '/erinnerungen', label: 'Erinnerungen', icon: <AlarmClock size={I} /> },
    { to: '/fristen', label: 'Fristen', sub: 'Wartung, Prüfung, Verträge', icon: <CalendarClock size={I} /> },
    { to: '/tickets', label: 'Ticket-Boards', sub: 'Board-Verwaltung', icon: <Columns3 size={I} /> },
    { to: '/todo', label: 'Todo', sub: 'Aufgaben', icon: <CircleCheck size={I} /> },
    { to: '/notizen', label: 'Notizen', icon: <SquarePen size={I} /> },
  ] },
];

function NavEintrag({ n, kompakt }: { n: Item; kompakt: boolean }) {
  return (
    <NavLink to={n.to} end={n.to === '/'} className={'nav-item' + (n.sub ? ' zwei' : '')} title={kompakt ? n.label : undefined}>
      {n.icon}<span>{n.label}{n.sub && <small>{n.sub}</small>}</span>
    </NavLink>
  );
}

function NavGroup({ g, kompakt }: { g: Group; kompakt: boolean }) {
  const loc = useLocation();
  const nav = useNavigate();
  const inside = g.items.some((i) => loc.pathname.startsWith(i.to));
  const [open, setOpen] = useState(inside);
  useEffect(() => { if (inside) setOpen(true); }, [inside]);
  return (
    <>
      <button className={'nav-item group-btn' + (inside ? ' inside' : '')} title={kompakt ? g.label : undefined} onClick={() => (kompakt ? nav(g.items[0].to) : setOpen(!open))}>
        {g.icon}<span>{g.label}</span><ChevronRight size={16} className={'chev' + (open ? ' open' : '')} />
      </button>
      {open && !kompakt && g.items.map((i) => <NavLink key={i.to} to={i.to} className="nav-item sub">{i.label}</NavLink>)}
    </>
  );
}

/** Suche über Liegenschaften, Einheiten, Personen und Firmen */
function GlobalSearch() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Row[]>([]);
  const [pos, setPos] = useState(0);
  const feld = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const mac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
  // Strg+K bzw. ⌘K springt in die Suche
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); feld.current?.focus(); feld.current?.select(); } };
    window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f);
  }, []);
  const oeffnen = (r: Row) => { nav(r.ziel); setQ(''); setRes([]); feld.current?.blur(); };
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setRes([]); return; }
    const like = `%${t}%`;
    db.select(`SELECT * FROM (
        SELECT 'Liegenschaft' AS art, o.name AS text, COALESCE(o.strasse, '') || ' ' || COALESCE(o.ort, '') AS sub, '/objekte/' || o.id AS ziel FROM objekte o
          WHERE o.name LIKE $1 OR o.strasse LIKE $1 OR o.ort LIKE $1 OR o.objekt_nr LIKE $1
        UNION ALL SELECT 'Einheit', o.name || ' – ' || e.nummer, e.typ, '/objekte/' || o.id FROM einheiten e JOIN objekte o ON o.id = e.objekt_id
          WHERE e.nummer LIKE $1 OR (o.name || ' ' || e.nummer) LIKE $1
        UNION ALL SELECT p.rolle, ${personLabel('p')}, COALESCE(p.email, p.telefon, ''), CASE p.rolle WHEN 'Eigentümer' THEN '/eigentuemer' ELSE '/mieter' END FROM personen p
          WHERE p.vorname LIKE $1 OR p.nachname LIKE $1 OR p.firma LIKE $1 OR p.email LIKE $1
        UNION ALL SELECT 'Firma', f.name, COALESCE(f.gewerk, ''), '/firmen' FROM firmen f WHERE f.name LIKE $1 OR f.gewerk LIKE $1
      ) LIMIT 12`, [like]).then((r) => { setRes(r); setPos(0); });
  }, [q]);
  return (
    <div className="gsearch">
      <Search size={17} />
      <input ref={feld} placeholder="Suchen …" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setTimeout(() => setRes([]), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setPos((p) => Math.min(p + 1, res.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setPos((p) => Math.max(p - 1, 0)); }
          else if (e.key === 'Enter' && res[pos]) oeffnen(res[pos]);
          else if (e.key === 'Escape') { setQ(''); setRes([]); feld.current?.blur(); }
        }} />
      {!q && <kbd className="gsearch-kbd">{mac ? '⌘' : 'Strg'} K</kbd>}
      {res.length > 0 && (
        <div className="gsearch-res">
          {res.map((r, i) => (
            <button key={i} className={i === pos ? 'an' : ''} onMouseEnter={() => setPos(i)} onMouseDown={() => oeffnen(r)}>
              <span className="pill">{r.art}</span><b>{r.text}</b><span className="muted small">{r.sub}</span>
            </button>))}
        </div>)}
    </div>
  );
}

function Topbar() {
  const [offen, setOffen] = useState(0);
  const [kurz, setKurz] = useState('KMS');
  const loc = useLocation();
  useEffect(() => {
    db.select(`SELECT COUNT(*) AS n FROM (${OP_SQL}) WHERE betrag - bezahlt > 0.005 AND faellig < date('now')`).then((r) => setOffen(Number(r[0]?.n) || 0));
    const ich = mehrplatz.benutzer();
    db.select(`SELECT wert FROM einstellungen WHERE schluessel = 'firma_name'`).then((r) => {
      const n = String(ich?.name ?? r[0]?.wert ?? 'KMS').split(/\s+/).filter(Boolean);
      setKurz((n.length > 1 ? n[0][0] + n[1][0] : n[0]?.slice(0, 2) ?? 'K').toUpperCase());
    });
  }, [loc.pathname]);
  return (
    <header className="topbar">
      <GlobalSearch />
      <NavLink to="/offene-posten" className="bell" title={`${offen} überfällige Posten`}>
        <Bell size={20} />{offen > 0 && <span className="dot">{offen > 99 ? '99+' : offen}</span>}
      </NavLink>
      {(sicherheit.aktiv || mehrplatz.aktiv) && <button className="bell" title={mehrplatz.aktiv ? `Abmelden (${mehrplatz.benutzer()?.name ?? ''})` : 'Jetzt sperren'} onClick={() => window.dispatchEvent(new Event(SPERREN))}><Lock size={20} /></button>}
      <NavLink to="/einstellungen" className="avatar" title={mehrplatz.aktiv ? `Angemeldet: ${mehrplatz.benutzer()?.name ?? ''}` : 'Einstellungen'}>{kurz}</NavLink>
    </header>
  );
}

export default function App() {
  return (
    <Sperre>
    <HashRouter>
      <Rahmen />
    </HashRouter>
    </Sperre>
  );
}

/** Wechselt die Seite, gleitet der Inhalt weich herein (in einer Liegenschaft nur der rechte Bereich) */
function Seite({ children }: { children: ReactNode }) {
  const p = useLocation().pathname;
  const schluessel = p.match(/^\/objekte\/\d+/)?.[0] ?? p;
  return <div className="seite" key={schluessel}>{children}</div>;
}

function Rahmen() {
  // In einer geöffneten Liegenschaft wird die Hauptleiste schmal, daneben erscheint die Spalte der Liegenschaft
  const kompakt = /^\/objekte\/\d+/.test(useLocation().pathname);
  // Bankverbindung: beim Start automatisch abrufen und das Ergebnis kurz einblenden
  const [hinweis, setHinweis] = useState<string[]>([]);
  useEffect(() => {
    const f = (e: Event) => { const t = String((e as CustomEvent).detail); setHinweis((h) => [...h, t]); setTimeout(() => setHinweis((h) => h.filter((x) => x !== t)), 12000); };
    window.addEventListener(BANK_INFO, f);
    const t = setTimeout(() => {
      autoAbruf();
      wiederkehrendErzeugen().then((n) => n && f(new CustomEvent(BANK_INFO, { detail: `${n} wiederkehrende Rechnung${n > 1 ? 'en' : ''} angelegt` }))).catch(() => {});
    }, 1500);
    return () => { window.removeEventListener(BANK_INFO, f); clearTimeout(t); };
  }, []);
  return (
      <div className={'app' + (kompakt ? ' kompakt' : '')}>
        <aside className="side">
          <div className="side-logo"><Logo daten /></div>
          <nav>
            {NAV.map((a) => (
              <div key={a.titel} className="nav-abschnitt">
                <div className="nav-titel">{a.titel}</div>
                {a.eintraege.map((n) => 'items' in n
                  ? <NavGroup key={n.label} g={n} kompakt={kompakt} />
                  : <NavEintrag key={n.to} n={n} kompakt={kompakt} />)}
              </div>))}
            <div className="nav-unten"><NavEintrag n={{ to: '/einstellungen', label: 'Einstellungen', icon: <Settings size={I} /> }} kompakt={kompakt} /></div>
          </nav>
          {hinweis.length > 0 && <div className="toasts">{hinweis.map((t) => <NavLink key={t} to={t.includes("wiederkehrend") ? "/journal" : "/bank"} className="toast" onClick={() => setHinweis((h) => h.filter((x) => x !== t))}><Landmark size={16} />{t}</NavLink>)}</div>}
          <div className="side-foot"><Landmark size={13} /> KMS Immobilienverwaltung · Version 0.2</div>
        </aside>
        <div className="content">
          <Topbar />
          <main className="main">
            <Seite>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/objekte" element={<ObjektePage />} />
              <Route path="/objekte/neu" element={<ObjektAssistentPage />} />
              <Route path="/objekte/:id/*" element={<ObjektDetailPage />} />
              <Route path="/personen" element={<PersonenPage />} />
              <Route path="/eigentuemer" element={<PersonenPage rolle="Eigentümer" />} />
              <Route path="/mieter" element={<PersonenPage rolle="Mieter" />} />
              <Route path="/firmen" element={<FirmenPage />} />
              <Route path="/vertraege" element={<VertraegePage />} />
              <Route path="/vertraege/:id" element={<VertragDetailPage />} />
              <Route path="/sollstellungen" element={<SollstellungenPage />} />
              <Route path="/offene-posten" element={<OffenePostenPage />} />
              <Route path="/rechnungen" element={<RechnungenPage />} />
              <Route path="/konten" element={<KontenPage />} />
              <Route path="/einstellungen" element={<EinstellungenPage />} />
              <Route path="/bank" element={<BankPage />} />
              <Route path="/mahnungen" element={<MahnungenPage />} />
              <Route path="/nebenkosten" element={<NebenkostenPage />} />
              <Route path="/weg-abrechnung" element={<WegAbrechnungPage />} />
              <Route path="/eigentuemer-abrechnung" element={<EigentuemerAbrechnungPage />} />
              <Route path="/ablage" element={<DokumentePage />} />
              <Route path="/instandhaltung" element={<InstandhaltungPage />} />
              <Route path="/beschluesse" element={<BeschluessePage />} />
              <Route path="/journal" element={<JournalPage />} />
              <Route path="/regeln" element={<RegelnPage />} />
              <Route path="/auswertung" element={<AuswertungPage />} />
              <Route path="/berichte" element={<BerichtePage />} />
              <Route path="/verwalter" element={<PersonenPage rolle="Verwalter" titel="Verwalter (Mitarbeiter)" />} />
              <Route path="/kontakte" element={<KontaktePage />} />
              <Route path="/kalender" element={<KalenderPage />} />
              <Route path="/erinnerungen" element={<ErinnerungenPage />} />
              <Route path="/fristen" element={<FristenPage />} />
              <Route path="/tickets" element={<TicketBoardsPage />} />
              <Route path="/todo" element={<TodoPage />} />
              <Route path="/notizen" element={<NotizenPage />} />
            </Routes>
            </Seite>
            <KiAssistent />
            <ModalHelfer />
          </main>
        </div>
      </div>
  );
}
