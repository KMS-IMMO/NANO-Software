// Buchen-Fenster: Konto über ein drehendes Rad wählen, dann Einheiten, Buchungsjahr, Rechnungsnummer (wenn das Konto sie verlangt) und § 35a.
// Wird für Bankumsätze (Betrag und Datum stehen fest) und für freie Einnahmen und Ausgaben benutzt.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as KE, type PointerEvent as PE } from 'react';
import { Check, Search } from 'lucide-react';
import { db, insert, type Row } from '../db';
import { einheitLabel, einheitPerson } from '../db/labels';
import { eur } from './EntityTable';
import { gesperrt, sperrText } from '../logic/abschluss';

const zahl = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.')) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;
const heute = () => new Date().toISOString().slice(0, 10);

/* ---------- Konto-Rad ---------- */

const SCHRITT = 17;      // Grad je Konto auf dem Rad
const RADIUS = 150;      // Abstand der Konten von der Drehachse in px
const ZEILE = 44;        // Ziehweg in px je Konto

export function KontoRad({ konten, wert, onWahl }: { konten: Row[]; wert: number | null; onWahl: (id: number) => void }) {
  const start = Math.max(0, konten.findIndex((k) => Number(k.id) === wert));
  const [pos, setPos] = useState(start + 9);            // startet weiter oben und dreht sich beim Öffnen ins Ziel
  const ziel = useRef(start);
  const posRef = useRef(start + 9);
  const raf = useRef(0);
  const zieh = useRef<{ y: number; p: number; bewegt: boolean } | null>(null);
  const ruhe = useRef(0);
  const max = konten.length - 1;

  const laufen = () => {
    cancelAnimationFrame(raf.current);
    const schritt = () => {
      const d = ziel.current - posRef.current;
      posRef.current = Math.abs(d) < 0.002 ? ziel.current : posRef.current + d * 0.16;
      setPos(posRef.current);
      if (posRef.current !== ziel.current) raf.current = requestAnimationFrame(schritt);
    };
    raf.current = requestAnimationFrame(schritt);
  };
  const setzen = (z: number, einrasten = true) => {
    ziel.current = Math.max(0, Math.min(max, einrasten ? Math.round(z) : z));
    laufen();
    if (einrasten && konten[Math.round(ziel.current)]) onWahl(Number(konten[Math.round(ziel.current)].id));
  };
  useEffect(() => { laufen(); if (konten[start] && wert == null) onWahl(Number(konten[start].id)); return () => cancelAnimationFrame(raf.current); }, []);
  // Wahl von außen (Suche, Vorschlag) dreht das Rad dorthin
  useEffect(() => {
    const i = konten.findIndex((k) => Number(k.id) === wert);
    if (i >= 0 && i !== Math.round(ziel.current)) { ziel.current = i; laufen(); }
  }, [wert, konten]);

  const box = useRef<HTMLDivElement>(null);
  const rad = (e: WheelEvent) => {
    e.preventDefault();
    ziel.current = Math.max(0, Math.min(max, ziel.current + e.deltaY / 60));
    laufen();
    clearTimeout(ruhe.current);
    ruhe.current = window.setTimeout(() => setzen(ziel.current), 140);
  };
  // Mausrad nicht passiv abhören, damit nur das Rad dreht und nicht das Fenster scrollt
  const radRef = useRef(rad); radRef.current = rad;
  useEffect(() => {
    const el = box.current; if (!el) return;
    const h = (e: WheelEvent) => radRef.current(e);
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);
  const runter = (e: PE) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); zieh.current = { y: e.clientY, p: ziel.current, bewegt: false }; };
  const ziehen = (e: PE) => {
    if (!zieh.current) return;
    const d = (zieh.current.y - e.clientY) / ZEILE;
    if (Math.abs(d) > 0.1) zieh.current.bewegt = true;
    ziel.current = Math.max(-0.4, Math.min(max + 0.4, zieh.current.p + d));
    laufen();
  };
  const los = (e: PE) => {
    const z = zieh.current; zieh.current = null;
    if (!z) return;
    if (!z.bewegt) {   // Klick: Konto oberhalb oder unterhalb der Mitte anwählen
      const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const versatz = Math.round((e.clientY - (box.top + box.height / 2)) / 40);
      setzen(z.p + versatz);
    } else setzen(ziel.current);
  };
  const taste = (e: KE) => {
    const m: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 };
    if (e.key in m) { e.preventDefault(); setzen(Math.round(ziel.current) + m[e.key]); }
    if (e.key === 'Home') { e.preventDefault(); setzen(0); }
    if (e.key === 'End') { e.preventDefault(); setzen(max); }
  };

  const mitte = Math.round(pos);
  return (
    <div ref={box} className="krad" tabIndex={0} role="listbox" aria-label="Buchungskonto" onPointerDown={runter} onPointerMove={ziehen} onPointerUp={los} onPointerCancel={los} onKeyDown={taste}>
      <div className="krad-band" />
      <div className="krad-trommel" style={{ transform: `translateZ(-${RADIUS}px) rotateX(${pos * SCHRITT}deg)` }}>
        {konten.map((k, i) => {
          const abst = Math.abs(i - pos);
          if (abst > 7) return null;
          return (
            <div key={k.id} role="option" aria-selected={i === mitte} className={'krad-eintrag' + (i === mitte ? ' mitte' : '')}
              style={{ transform: `rotateX(${-i * SCHRITT}deg) translateZ(${RADIUS}px)`, opacity: Math.max(0.08, 1 - abst * 0.17) }}>
              <b>{k.nummer}</b><span>{k.name}</span>
              {(k.hdl || k.hwl) ? <i className="krad-tag">§ 35a</i> : null}
              {k.rechnung_pflicht ? <i className="krad-tag">Rg.-Nr.</i> : null}
            </div>);
        })}
      </div>
    </div>
  );
}

/* ---------- Buchen-Fenster ---------- */

export type BuchenVorlage = {
  umsatz?: Row;             // Bankumsatz: Datum, Betrag und Text stehen fest
  objektId?: number;        // feste Liegenschaft
  kontoId?: number;         // Vorschlag
  richtung?: 'Einnahme' | 'Ausgabe';
};

export function BuchenDialog({ vorlage, onClose, onSaved }: { vorlage: BuchenVorlage; onClose: () => void; onSaved: (text: string) => void }) {
  const u = vorlage.umsatz;
  const [konten, setKonten] = useState<Row[]>([]);
  const [objekte, setObjekte] = useState<Row[]>([]);
  const [objekt, setObjekt] = useState<number | ''>(vorlage.objektId ?? '');
  const [einheiten, setEinheiten] = useState<Row[]>([]);
  const [richtung, setRichtung] = useState<'Einnahme' | 'Ausgabe'>(u ? (u.betrag > 0 ? 'Einnahme' : 'Ausgabe') : vorlage.richtung ?? 'Ausgabe');
  const [datum, setDatum] = useState<string>(u?.datum ?? heute());
  const [betrag, setBetrag] = useState(u ? String(Math.abs(u.betrag)).replace('.', ',') : '');
  const [text, setText] = useState(u ? `${u.gegenpartei ?? ''} ${u.verwendungszweck ?? ''}`.trim().slice(0, 200) : '');
  const [konto, setKonto] = useState<number | null>(vorlage.kontoId ?? null);
  const [suche, setSuche] = useState('');
  const [wahl, setWahl] = useState<string[]>([]);              // gewählte Einheiten, leer = alle / ganzes Objekt
  const [anteile, setAnteile] = useState<Record<string, string>>({});
  const [jahr, setJahr] = useState(Number(String(u?.datum ?? heute()).slice(0, 4)));
  const [rechnungsnr, setRechnungsnr] = useState('');
  const [a35, setA35] = useState('');
  const [fehler, setFehler] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const rgRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    db.select('SELECT id, nummer, name, gruppe, art, hdl, hwl, rechnung_pflicht FROM buchungskonten ORDER BY nummer').then(setKonten);
    if (vorlage.objektId == null) db.select('SELECT id, name FROM objekte ORDER BY name').then((o) => {
      setObjekte(o);
      if (u && objekt === '') db.select('SELECT objekt_id FROM bankkonten WHERE id = $1', [u.bankkonto_id]).then((r) => { if (r[0]?.objekt_id) setObjekt(r[0].objekt_id); });
    });
  }, []);
  useEffect(() => {
    setWahl([]); setAnteile({});
    if (objekt === '') { setEinheiten([]); return; }
    db.select(`SELECT e.id, e.nummer, ${einheitPerson('e')} AS person, ${einheitLabel('e')} AS label FROM einheiten e WHERE e.objekt_id = $1 ORDER BY e.lfd_nr, e.nummer`, [Number(objekt)]).then(setEinheiten);
  }, [objekt]);

  // Einnahmen zeigen Einnahme- und Ertragskonten zuerst, Ausgaben die Aufwandskonten
  const liste = useMemo(() => {
    const passt = (k: Row) => richtung === 'Einnahme' ? ['Einnahme', 'Ertrag'].includes(k.art) : ['Aufwand', 'Ertrag'].includes(k.art);
    return [...konten.filter(passt), ...konten.filter((k) => !passt(k))];
  }, [konten, richtung]);
  const k = konten.find((x) => Number(x.id) === konto);
  const mit35 = !!k && !!(k.hdl || k.hwl) && richtung === 'Ausgabe';
  const mitRg = !!k?.rechnung_pflicht;
  const gesamt = Math.abs(zahl(betrag));

  const suchen = (s: string) => {
    setSuche(s);
    const t = s.trim().toLowerCase();
    if (!t) return;
    const treffer = liste.find((x) => String(x.nummer).startsWith(t)) ?? liste.find((x) => String(x.name).toLowerCase().includes(t));
    if (treffer) setKonto(Number(treffer.id));
  };

  const verteilen = (ids: string[]) => {
    if (!ids.length) return {};
    const teil = Math.floor((gesamt / ids.length) * 100) / 100, rest = r2(gesamt - teil * ids.length);
    return Object.fromEntries(ids.map((id, i) => [id, gesamt ? (i === 0 ? r2(teil + rest) : teil).toFixed(2).replace('.', ',') : '']));
  };
  const einheitUmschalten = (id: string) => {
    const neu = wahl.includes(id) ? wahl.filter((x) => x !== id) : [...wahl, id];
    setWahl(neu); setAnteile(verteilen(neu));
  };
  const summe = r2(wahl.reduce((a, id) => a + zahl(anteile[id] ?? ''), 0));
  const jahrNr = Number(String(datum).slice(0, 4)) || new Date().getFullYear();

  async function buchen() {
    setFehler('');
    if (objekt === '') { setFehler('Bitte die Liegenschaft wählen.'); return; }
    if (!konto) { setFehler('Bitte ein Konto auf dem Rad wählen.'); return; }
    if (!datum || !gesamt) { setFehler('Bitte Datum und Betrag angeben.'); return; }
    if (mitRg && !rechnungsnr.trim()) { setFehler(`Das Konto ${k?.nummer} verlangt eine Rechnungsnummer.`); rgRef.current?.focus(); return; }
    if (wahl.length > 1 && Math.abs(summe - gesamt) > 0.005) { setFehler(`Die Beträge der Einheiten (${eur(summe)}) ergeben nicht den Gesamtbetrag (${eur(gesamt)}).`); return; }
    const anteil35 = mit35 && a35.trim() !== '' ? Math.abs(zahl(a35)) : null;
    if (anteil35 !== null && anteil35 > gesamt + 0.005) { setFehler(`Der § 35a-Anteil (${eur(anteil35)}) kann nicht größer sein als der Betrag (${eur(gesamt)}).`); return; }
    const sp = (await gesperrt(Number(objekt), `${jahr}-01-01`)) ?? (await gesperrt(Number(objekt), datum));
    if (sp) { setFehler(sperrText(sp)); return; }
    setLaeuft(true);
    try {
      const vz = u ? Math.sign(u.betrag) || -1 : richtung === 'Einnahme' ? 1 : -1;
      const basis = { datum, objekt_id: Number(objekt), buchungskonto_id: konto, text: text.trim() || null, jahr: jahr === jahrNr ? null : jahr,
        rechnungsnr: rechnungsnr.trim() || null, bankumsatz_id: u?.id ?? null };
      const teile: [number | null, number][] = wahl.length === 0 ? [[null, gesamt]] : wahl.length === 1 ? [[Number(wahl[0]), gesamt]] : wahl.map((id) => [Number(id), zahl(anteile[id] ?? '')]);
      for (const [eid, b] of teile) await insert('buchungen', { ...basis, einheit_id: eid, betrag: vz * b,
        anteil_35a: anteil35 === null || !gesamt ? null : r2(anteil35 * b / gesamt) });
      if (u) await db.execute(`UPDATE bankumsaetze SET status = 'zugeordnet' WHERE id = $1`, [u.id]);
      onSaved(`${eur(gesamt)} auf ${k?.nummer} ${k?.name} gebucht${teile.length > 1 ? ` (${teile.length} Einheiten)` : ''}${jahr !== jahrNr ? `, Buchungsjahr ${jahr}` : ''}.`);
    } catch (e: any) {
      setFehler('Buchen fehlgeschlagen: ' + (e?.message ?? e)); setLaeuft(false);
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal buchen-fenster" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); buchen(); } }}>
        <div className="card-head">
          <h3>Buchen</h3>
          {u ? <b className={u.betrag < 0 ? 'neg' : 'pos'}>{eur(u.betrag)}</b>
            : <div className="seg">{(['Ausgabe', 'Einnahme'] as const).map((r) => <button key={r} className={richtung === r ? 'on' : ''} onClick={() => setRichtung(r)}>{r}</button>)}</div>}
        </div>
        {u ? <p className="muted small bf-umsatz">{new Date(u.datum).toLocaleDateString('de-DE')} · {u.gegenpartei} · {u.verwendungszweck}</p>
          : <div className="bf-kopf">
              <label><span>Datum</span><input type="date" value={datum} onChange={(e) => { setDatum(e.target.value); const j = Number(e.target.value.slice(0, 4)); if (j) setJahr(j); }} /></label>
              <label><span>Betrag €</span><input inputMode="decimal" autoFocus value={betrag} onChange={(e) => { setBetrag(e.target.value); setAnteile({}); setWahl([]); }} placeholder="0,00" /></label>
              <label className="grow"><span>Buchungstext</span><input value={text} onChange={(e) => setText(e.target.value)} /></label>
            </div>}

        <div className="bf-schritt" style={{ animationDelay: '.05s' }}>
          <div className="bf-titel"><span className="bf-nr">1</span>Konto
            <label className="bf-suche"><Search size={14} /><input placeholder="Nummer oder Name …" value={suche} onChange={(e) => suchen(e.target.value)} /></label></div>
          {liste.length > 0 && <KontoRad konten={liste} wert={konto} onWahl={setKonto} />}
          {k && <p className="bf-gewaehlt"><Check size={14} /> {k.nummer} {k.name}<span className="muted"> · {k.gruppe}</span></p>}
        </div>

        <div className="bf-schritt" style={{ animationDelay: '.12s' }}>
          <div className="bf-titel"><span className="bf-nr">2</span>Einheiten</div>
          {vorlage.objektId == null && <select value={objekt} onChange={(e) => setObjekt(e.target.value ? Number(e.target.value) : '')}>
            <option value="">– Liegenschaft wählen –</option>{objekte.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
          {objekt !== '' && <div className="bf-liste">
            <button className={'bf-zeile alle' + (wahl.length === 0 ? ' an' : '')} onClick={() => { setWahl([]); setAnteile({}); }}>
              <span className="bf-haken">{wahl.length === 0 && <Check size={13} />}</span>
              <b>{richtung === 'Einnahme' ? 'Gesamtes Objekt' : 'Alle Einheiten'}</b><span className="bf-name muted">{richtung === 'Einnahme' ? 'ohne Einheit' : 'Umlage nach Schlüssel'}</span>
            </button>
            {einheiten.map((x, i) => {
              const id = String(x.id), an = wahl.includes(id);
              return (
                <div key={x.id} className={'bf-zeile' + (an ? ' an' : '')} style={{ animationDelay: `${0.03 * i}s` }} onClick={() => einheitUmschalten(id)} role="checkbox" aria-checked={an}>
                  <span className="bf-haken">{an && <Check size={13} />}</span>
                  <b>{x.nummer}</b>
                  <span className="bf-name">{x.person ?? <span className="muted">leer stehend</span>}</span>
                  {an && wahl.length > 1 && <input inputMode="decimal" value={anteile[id] ?? ''} onClick={(e) => e.stopPropagation()} onChange={(e) => setAnteile({ ...anteile, [id]: e.target.value })} />}
                </div>);
            })}
          </div>}
          {wahl.length > 1 && <p className={'small ' + (Math.abs(summe - gesamt) > 0.005 ? 'warn' : 'muted')}>{wahl.length} Einheiten · Summe {eur(summe)} von {eur(gesamt)}, gleichmäßig aufgeteilt und änderbar.</p>}
        </div>

        <div className="bf-schritt" style={{ animationDelay: '.19s' }}>
          <div className="bf-titel"><span className="bf-nr">3</span>Buchungsjahr</div>
          <div className="bf-jahre" style={{ ['--i' as any]: [jahrNr - 1, jahrNr, jahrNr + 1].indexOf(jahr) }}>
            <span className="bf-jahr-gleiter" />
            {[jahrNr - 1, jahrNr, jahrNr + 1].map((j) => <button key={j} className={jahr === j ? 'an' : ''} onClick={() => setJahr(j)}>{j}</button>)}
          </div>
          {jahr !== jahrNr && <p className="muted small">Gebucht am {new Date(datum).toLocaleDateString('de-DE')}, zählt aber für die Abrechnung {jahr}.</p>}
        </div>

        {mitRg && <div className="bf-schritt bf-neu">
          <div className="bf-titel"><span className="bf-nr">4</span>Rechnungsnummer <span className="muted small">vom Konto {k?.nummer} verlangt</span></div>
          <input ref={rgRef} value={rechnungsnr} onChange={(e) => setRechnungsnr(e.target.value)} placeholder="z. B. RE-2026-0815" />
        </div>}

        {mit35 && <div className="bf-schritt bf-neu">
          <div className="bf-titel"><span className="bf-nr">{mitRg ? 5 : 4}</span>§ 35a <span className="muted small">{k?.hdl ? 'haushaltsnahe Dienstleistung' : 'Handwerkerleistung'}</span></div>
          <input inputMode="decimal" value={a35} onChange={(e) => setA35(e.target.value)} placeholder="davon Arbeitskosten €, leer = ganzer Betrag" />
        </div>}

        {fehler && <p className="error">{fehler}</p>}
        <div className="row end">
          <button onClick={onClose}>Abbrechen</button>
          <button className="primary bf-buchen" disabled={laeuft} onClick={buchen}><Check size={16} />Buchen</button>
        </div>
      </div>
    </div>
  );
}
