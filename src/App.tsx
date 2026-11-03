import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { DashboardPage } from './pages/Dashboard';
import { ObjektDetailPage, ObjektePage } from './pages/Objekte';
import { FirmenPage, PersonenPage } from './pages/Personen';
import { VertragDetailPage, VertraegePage } from './pages/Vertraege';
import { OffenePostenPage } from './pages/OffenePosten';
import { BankPage } from './pages/Bank';
import { MahnungenPage } from './pages/Mahnungen';
import { NebenkostenPage } from './pages/Nebenkosten';
import { EigentuemerAbrechnungPage, WegAbrechnungPage } from './pages/Jahresabrechnungen';
import { EinstellungenPage, KontenPage, RechnungenPage } from './pages/Konten';

const NAV: ([string, string] | string)[] = [
  ['/', 'Übersicht'],
  'Stammdaten',
  ['/objekte', 'Objekte & Einheiten'],
  ['/personen', 'Eigentümer & Mieter'],
  ['/firmen', 'Firmenkontakte'],
  ['/vertraege', 'Mietverträge'],
  'Finanzen',
  ['/offene-posten', 'Offene Posten'],
  ['/bank', 'Bank & Zuordnung'],
  ['/rechnungen', 'Rechnungen'],
  ['/mahnungen', 'Mahnungen'],
  'Abrechnungen',
  ['/nebenkosten', 'Nebenkosten'],
  ['/weg-abrechnung', 'WEG-Jahresabrechnung'],
  ['/eigentuemer-abrechnung', 'Eigentümerabrechnung'],
  'Verwaltung',
  ['/ablage', 'Dokumente'],
  ['/konten', 'Buchungskonten'],
  ['/einstellungen', 'Einstellungen'],
];

function Bald({ titel, text }: { titel: string; text: string }) {
  return (
    <>
      <div className="page-head"><h1>{titel}</h1></div>
      <section className="card"><p className="muted">In Arbeit: {text}</p></section>
    </>
  );
}

export default function App() {
  return (
    <HashRouter>
      <div className="app">
        <aside className="side">
          <div className="brand">NANO <span>Verwaltung</span></div>
          <nav>
            {NAV.map((n) => typeof n === 'string'
              ? <div key={n} className="nav-group">{n}</div>
              : <NavLink key={n[0]} to={n[0]} end={n[0] === '/'}>{n[1]}</NavLink>)}
          </nav>
          <div className="side-foot">KMS Immobilien · Version 0.1</div>
        </aside>
        <main className="main">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/objekte" element={<ObjektePage />} />
            <Route path="/objekte/:id" element={<ObjektDetailPage />} />
            <Route path="/personen" element={<PersonenPage />} />
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
            <Route path="/ablage" element={<Bald titel="Dokumente" text="Ablage mit deiner Ordnervorlage, Drag & Drop und Durchsuchen, automatische Ablage erzeugter PDFs." />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
