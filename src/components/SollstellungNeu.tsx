// „Sollstellung hinzufügen“: mehrere Einheiten per Häkchen, einzelner Monat oder Zeitraum, Betrag aus den Stammdaten.
import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Home } from 'lucide-react';
import { db, type Row } from '../db';
import { einheitPerson } from '../db/labels';
import { eur } from './EntityTable';
import { ALLE_ARTEN, monate, soll, stammdatenPosten, type Posten } from '../logic/soll';

const ARTEN = [ALLE_ARTEN, 'Kaltmiete', 'NK', 'HK', 'USt', 'Hausgeld', 'Rücklage', 'Sonderumlage', 'Nachzahlung', 'Mahngebühr', 'Sonstiges'];
const MIT_STAMMDATEN = new Set([ALLE_ARTEN, 'Kaltmiete', 'NK', 'HK', 'USt', 'Hausgeld', 'Rücklage']);
const zahl = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.')) || 0;
const diesMonat = () => new Date().toISOString().slice(0, 7);
const monatText = (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' });

export function SollstellungNeu({ objektId, onClose, onSaved }: { objektId: number; onClose: () => void; onSaved: (text: string) => void }) {
  const [einheiten, setEinheiten] = useState<Row[]>([]);
  const [wahl, setWahl] = useState<Set<number>>(new Set());
  const [offen, setOffen] = useState(false);
  const [zeitraum, setZeitraum] = useState<'monat' | 'spanne'>('monat');
  const [monat, setMonat] = useState(diesMonat());
  const [von, setVon] = useState(diesMonat());
  const [bis, setBis] = useState(`${new Date().getFullYear()}-12`);
  const [art, setArt] = useState(ALLE_ARTEN);
  const [eigen, setEigen] = useState('');
  const [tag, setTag] = useState('');
  const [vorschau, setVorschau] = useState<Posten[]>([]);
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    db.select(`SELECT e.id, e.nummer, e.typ, ${einheitPerson('e')} AS person,
        (SELECT v.mieter_id FROM mietvertraege v WHERE v.einheit_id = e.id AND (v.ende IS NULL OR v.ende >= date('now')) ORDER BY v.beginn DESC LIMIT 1) AS mieter,
        (SELECT ei.person_id FROM eigentum ei WHERE ei.einheit_id = e.id AND (ei.bis IS NULL OR ei.bis >= date('now')) ORDER BY ei.anteil DESC LIMIT 1) AS eigentuemer
      FROM einheiten e WHERE e.objekt_id = $1 ORDER BY e.lfd_nr, e.nummer`, [objektId]).then((r) => { setEinheiten(r); setWahl(new Set(r.map((x) => Number(x.id)))); });
  }, [objektId]);

  const monateListe = useMemo(() => (zeitraum === 'monat' ? (monat ? [monat] : []) : von && bis && von <= bis ? monate(von, bis) : []), [zeitraum, monat, von, bis]);
  const mitStamm = MIT_STAMMDATEN.has(art) && !eigen.trim();
  const tagZahl = tag ? Math.min(28, Math.max(1, Number(tag))) : undefined;

  // Vorschau: was würde angelegt?
  useEffect(() => {
    let ab = false;
    (async () => {
      const ids = [...wahl];
      let p: Posten[];
      if (mitStamm) p = await stammdatenPosten(ids, monateListe, art, tagZahl);
      else {
        const b = zahl(eigen);
        p = b ? ids.flatMap((eid) => { const e = einheiten.find((x) => Number(x.id) === eid);
          return monateListe.map((m) => ({ einheit_id: eid, monat: m, art: art === ALLE_ARTEN ? 'Sonstiges' : art, betrag: b, person_id: e?.mieter ?? e?.eigentuemer ?? null, vertrag_id: null,
            faellig: `${m}-${String(tagZahl ?? 3).padStart(2, '0')}` })); }) : [];
      }
      if (!ab) setVorschau(p);
    })();
    return () => { ab = true; };
  }, [[...wahl].join(','), monateListe.join(','), art, eigen, tag, einheiten.length]);

  const proEinheit = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of vorschau) m.set(p.einheit_id, (m.get(p.einheit_id) ?? 0) + p.betrag);
    return m;
  }, [vorschau]);
  const summe = vorschau.reduce((a, p) => a + p.betrag, 0);
  const alle = einheiten.length > 0 && wahl.size === einheiten.length;
  const umschalten = (id: number) => { const n = new Set(wahl); if (n.has(id)) n.delete(id); else n.add(id); setWahl(n); };

  async function anlegen() {
    setFehler('');
    if (!wahl.size) { setFehler('Bitte mindestens eine Einheit auswählen.'); return; }
    if (!monateListe.length) { setFehler(zeitraum === 'spanne' ? '„Von“ muss vor „bis“ liegen.' : 'Bitte einen Monat wählen.'); return; }
    if (!vorschau.length) { setFehler(mitStamm ? 'In den Stammdaten ist für diese Auswahl kein Betrag hinterlegt. Trag einen eigenen Betrag ein.' : 'Bitte einen Betrag eintragen.'); return; }
    setBusy(true);
    try {
      let neu = 0;
      for (const p of vorschau) neu += await soll(p);
      const doppelt = vorschau.length - neu;
      onSaved(`${neu} Posten angelegt` + (doppelt ? `, ${doppelt} gab es schon und wurden nicht verändert.` : '.'));
    } catch (e: any) { setFehler(String(e?.message ?? e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal breit soll-neu" onClick={(e) => e.stopPropagation()}>
        <h3>Sollstellung hinzufügen</h3>

        <button type="button" className={'einheit-kopf' + (offen ? ' offen' : '')} onClick={() => setOffen(!offen)}>
          <Home size={17} /><span className="grow"><b>Einheiten</b> {alle ? 'Alle Einheiten' : `${wahl.size} von ${einheiten.length} ausgewählt`}</span>
          <ChevronDown size={18} className="chev" /></button>
        <div className={'einheit-wahl' + (offen ? ' offen' : '')}>
          <div className="einheit-innen">
            <label className="einheit-zeile alle"><input type="checkbox" checked={alle} ref={(el) => { if (el) el.indeterminate = wahl.size > 0 && !alle; }}
              onChange={() => setWahl(alle ? new Set() : new Set(einheiten.map((x) => Number(x.id))))} /><b>Alle Einheiten</b><span className="grow" /><span className="muted small">{einheiten.length} Einheiten</span></label>
            {einheiten.map((e, i) => {
              const id = Number(e.id), an = wahl.has(id), b = proEinheit.get(id);
              return (
                <label key={id} className={'einheit-zeile' + (an ? ' an' : '')} style={{ animationDelay: `${i * 30}ms` }}>
                  <input type="checkbox" checked={an} onChange={() => umschalten(id)} />
                  <span className="einheit-nr">{e.nummer}</span>
                  <span className="grow einheit-name">{e.person ?? <span className="muted">kein Mieter/Eigentümer</span>}<span className="muted small"> · {e.typ}</span></span>
                  <span className={'num small ' + (an && b ? '' : 'muted')}>{an ? (b ? eur(b) : '–') : ''}</span>
                </label>);
            })}
          </div>
        </div>

        <div className="form soll-form">
          <div className="wide feld"><span>Zeitraum *</span>
            <div className="seg">
              <button type="button" className={zeitraum === 'monat' ? 'on' : ''} onClick={() => setZeitraum('monat')}>Einzelner Monat</button>
              <button type="button" className={zeitraum === 'spanne' ? 'on' : ''} onClick={() => setZeitraum('spanne')}>Eigener Zeitraum</button>
            </div></div>
          {zeitraum === 'monat'
            ? <label><span>Monat</span><input type="month" value={monat} onChange={(e) => setMonat(e.target.value)} /></label>
            : <><label><span>Von Monat</span><input type="month" value={von} onChange={(e) => setVon(e.target.value)} /></label>
                <label><span>Bis Monat</span><input type="month" value={bis} onChange={(e) => setBis(e.target.value)} /></label></>}
          <label><span>Art *</span><select value={art} onChange={(e) => setArt(e.target.value)}>{ARTEN.map((a) => <option key={a}>{a}</option>)}</select></label>
          <label><span>Betrag € {MIT_STAMMDATEN.has(art) ? '(leer = aus den Stammdaten)' : '*'}</span>
            <input inputMode="decimal" value={eigen} onChange={(e) => setEigen(e.target.value)} placeholder={MIT_STAMMDATEN.has(art) ? 'aus Stammdaten' : '0,00'} /></label>
          <label><span>Fällig am Tag (leer = laut Vertrag, sonst 3.)</span><input type="number" min={1} max={28} value={tag} onChange={(e) => setTag(e.target.value)} placeholder="3" /></label>
        </div>

        <div className="soll-vorschau">
          {!monateListe.length
            ? <span className="muted">{zeitraum === 'spanne' ? '„Von“ muss vor oder gleich „bis“ liegen.' : 'Bitte einen Monat wählen.'}</span>
            : vorschau.length
            ? <><Check size={16} /> <b>{vorschau.length} Posten</b> für {wahl.size} Einheit{wahl.size === 1 ? '' : 'en'} · {monateListe.length === 1 ? monatText(monateListe[0]) : `${monatText(monateListe[0])} – ${monatText(monateListe[monateListe.length - 1])}`} · zusammen <b>{eur(summe)}</b>
                {mitStamm && <span className="muted small"> · Beträge aus Mietvertrag bzw. Hausgeld</span>}</>
            : <span className="muted">{mitStamm ? 'Für diese Auswahl sind in den Stammdaten keine Beträge hinterlegt.' : 'Betrag eintragen, um die Vorschau zu sehen.'}</span>}
        </div>
        {fehler && <p className="error">{fehler}</p>}
        <div className="row end"><span className="grow" /><button onClick={onClose}>Abbrechen</button>
          <button className="primary" disabled={busy || !vorschau.length} onClick={anlegen}>{busy ? 'Lege an …' : `${vorschau.length || ''} Anlegen`}</button></div>
      </div>
    </div>
  );
}
