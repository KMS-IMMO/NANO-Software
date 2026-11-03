import { useEffect, useState, type ReactNode } from 'react';
import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell, Building, Building2, ChevronDown, FolderOpen, Hammer, Home, Landmark, Search, Settings, User, Users, Wallet, Wrench,
} from 'lucide-react';
import { db, type Row } from './db';
import { personLabel } from './db/labels';
import { OP_SQL } from './logic/soll';
import { Logo } from './components/Logo';
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

type Item = { to: string; label: string; icon?: ReactNode };
type Group = { label: string; icon: ReactNode; items: Item[] };
const NAV: (Item | Group)[] = [
  { to: '/', label: 'Dashboard', icon: <Home size={18} /> },
  { to: '/objekte', label: 'Liegenschaften', icon: <Building2 size={18} /> },
  { label: 'WEG-Verwaltung', icon: <Users size={18} />, items: [
    { to: '/beschluesse', label: 'Beschlusssammlung' },
    { to: '/weg-abrechnung', label: 'Jahresabrechnung' },
  ] },
  { label: 'Mietverwaltung', icon: <Building size={18} />, items: [
    { to: '/vertraege', label: 'Mietverträge' },
    { to: '/nebenkosten', label: 'Nebenkostenabrechnung' },
    { to: '/eigentuemer-abrechnung', label: 'Eigentümerabrechnung' },
  ] },
  { to: '/eigentuemer', label: 'Eigentümer', icon: <Users size={18} /> },
  { to: '/mieter', label: 'Mieter', icon: <User size={18} /> },
  { to: '/firmen', label: 'Firmenkontakte', icon: <Hammer size={18} /> },
  { label: 'Buchhaltung', icon: <Wallet size={18} />, items: [
    { to: '/bank', label: 'Banken & Konten' },
    { to: '/offene-posten', label: 'Offene Posten' },
    { to: '/rechnungen', label: 'Rechnungen' },
    { to: '/mahnungen', label: 'Mahnungen' },
    { to: '/konten', label: 'Kontenplan' },
  ] },
  { to: '/instandhaltung', label: 'Instandhaltung', icon: <Wrench size={18} /> },
  { to: '/ablage', label: 'Dokumente', icon: <FolderOpen size={18} /> },
  { to: '/einstellungen', label: 'Einstellungen', icon: <Settings size={18} /> },
];

function NavGroup({ g }: { g: Group }) {
  const loc = useLocation();
  const inside = g.items.some((i) => loc.pathname.startsWith(i.to));
  const [open, setOpen] = useState(inside);
  useEffect(() => { if (inside) setOpen(true); }, [inside]);
  return (
    <>
      <button className={'nav-item group-btn' + (inside ? ' inside' : '')} onClick={() => setOpen(!open)}>
        {g.icon}<span>{g.label}</span><ChevronDown size={16} className={'chev' + (open ? ' open' : '')} />
      </button>
      {open && g.items.map((i) => <NavLink key={i.to} to={i.to} className="nav-item sub">{i.label}</NavLink>)}
    </>
  );
}

/** Suche über Liegenschaften, Einheiten, Personen und Firmen */
function GlobalSearch() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Row[]>([]);
  const nav = useNavigate();
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
      ) LIMIT 12`, [like]).then(setRes);
  }, [q]);
  return (
    <div className="gsearch">
      <Search size={17} />
      <input placeholder="Suchen …" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setTimeout(() => setRes([]), 150)} />
      {res.length > 0 && (
        <div className="gsearch-res">
          {res.map((r, i) => (
            <button key={i} onMouseDown={() => { nav(r.ziel); setQ(''); setRes([]); }}>
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
    db.select(`SELECT wert FROM einstellungen WHERE schluessel = 'firma_name'`).then((r) => {
      const n = String(r[0]?.wert ?? 'KMS').split(/\s+/).filter(Boolean);
      setKurz((n.length > 1 ? n[0][0] + n[1][0] : n[0]?.slice(0, 2) ?? 'K').toUpperCase());
    });
  }, [loc.pathname]);
  return (
    <header className="topbar">
      <GlobalSearch />
      <NavLink to="/offene-posten" className="bell" title={`${offen} überfällige Posten`}>
        <Bell size={20} />{offen > 0 && <span className="dot">{offen > 99 ? '99+' : offen}</span>}
      </NavLink>
      <NavLink to="/einstellungen" className="avatar" title="Einstellungen">{kurz}</NavLink>
    </header>
  );
}

export default function App() {
  return (
    <HashRouter>
      <div className="app">
        <aside className="side">
          <div className="side-logo"><Logo /></div>
          <nav>
            {NAV.map((n) => 'items' in n
              ? <NavGroup key={n.label} g={n} />
              : <NavLink key={n.to} to={n.to} end={n.to === '/'} className="nav-item">{n.icon}<span>{n.label}</span></NavLink>)}
          </nav>
          <div className="side-foot"><Landmark size={13} /> KMS Immobilienverwaltung · Version 0.2</div>
        </aside>
        <div className="content">
          <Topbar />
          <main className="main">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/objekte" element={<ObjektePage />} />
              <Route path="/objekte/:id" element={<ObjektDetailPage />} />
              <Route path="/personen" element={<PersonenPage />} />
              <Route path="/eigentuemer" element={<PersonenPage rolle="Eigentümer" />} />
              <Route path="/mieter" element={<PersonenPage rolle="Mieter" />} />
              <Route path="/firmen" element={<FirmenPage />} />
              <Route path="/vertraege" element={<VertraegePage />} />
              <Route path="/vertraege/:id" element={<VertragDetailPage />} />
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
            </Routes>
          </main>
        </div>
      </div>
    </HashRouter>
  );
}
