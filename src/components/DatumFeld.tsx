// Datumsfeld mit Kalender im gleichen Schema wie „Einnahmen & Ausgaben“: Monat und Jahr per Auswahlliste, darunter die Tage.
// Ersetzt <input type="date">, das im Mac-Fenster nur als graues Textfeld (mit dem heutigen Datum als Platzhalter) erscheint.
// Getippt werden kann weiter: 31.12.2025, 31.12.25, 31122025 oder 2025-12-31. Der Wert nach außen ist immer JJJJ-MM-TT (oder leer).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

type Ev = { target: { value: string } };
type Props = {
  value?: string | null;
  /** ohne value: Feld führt den Wert selbst (z. B. Änderung erst beim Verlassen per onBlur speichern) */
  defaultValue?: string | null;
  onChange?: (e: Ev) => void;
  onBlur?: (e: Ev) => void;
  min?: string; max?: string;
  disabled?: boolean; required?: boolean; autoFocus?: boolean;
  className?: string; style?: CSSProperties; title?: string; placeholder?: string; id?: string; name?: string;
  'aria-label'?: string;
};

export const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const TAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const zwei = (n: number) => String(n).padStart(2, '0');
const iso = (j: number, m: number, t: number) => `${j}-${zwei(m)}-${zwei(t)}`;
const heuteIso = () => { const d = new Date(); return iso(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
const gueltig = (j: number, m: number, t: number) => j >= 1900 && j <= 2200 && m >= 1 && m <= 12 && t >= 1 && t <= new Date(j, m, 0).getDate();

/** JJJJ-MM-TT → TT.MM.JJJJ */
export const datumDe = (v: string | null | undefined) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? '') ? `${v!.slice(8, 10)}.${v!.slice(5, 7)}.${v!.slice(0, 4)}` : '');

/** Getippten Text lesen: TT.MM.JJJJ, T.M.JJ, TTMMJJJJ, JJJJ-MM-TT. null = (noch) kein gültiges Datum */
export function datumLesen(text: string): string | null {
  const t = text.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) { const [j, mo, ta] = [Number(m[1]), Number(m[2]), Number(m[3])]; return gueltig(j, mo, ta) ? iso(j, mo, ta) : null; }
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(t) ?? /^(\d{2})(\d{2})(\d{4}|\d{2})$/.exec(t);
  if (!m) return null;
  let j = Number(m[3]); if (m[3].length === 2) j += j < 70 ? 2000 : 1900;
  const mo = Number(m[2]), ta = Number(m[1]);
  return gueltig(j, mo, ta) ? iso(j, mo, ta) : null;
}

export function DatumFeld({ value, defaultValue, onChange, onBlur, min, max, disabled, required, autoFocus, className, style, title, placeholder, id, name, ...rest }: Props) {
  const gesteuert = value !== undefined;
  const [eigen, setEigen] = useState(defaultValue ?? '');
  const wert = (gesteuert ? value : eigen) ?? '';
  const [text, setText] = useState<string | null>(null);
  const [offen, setOffen] = useState(false);
  const basis = /^\d{4}-\d{2}/.test(wert) ? wert : heuteIso();
  const [ansicht, setAnsicht] = useState({ j: Number(basis.slice(0, 4)), m: Number(basis.slice(5, 7)) });
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const feld = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const setzen = (v: string) => { if (!gesteuert) setEigen(v); onChange?.({ target: { value: v } }); };
  const oeffnen = () => {
    if (disabled) return;
    const b = /^\d{4}-\d{2}/.test(wert) ? wert : heuteIso();
    setAnsicht({ j: Number(b.slice(0, 4)), m: Number(b.slice(5, 7)) });
    setOffen(true);
  };
  const waehlen = (v: string) => { setzen(v); setText(null); setOffen(false); onBlur?.({ target: { value: v } }); };

  // Lage des Kalenders: unter dem Feld, passt er nicht, darüber; nie über den Fensterrand
  useLayoutEffect(() => {
    if (!offen) return;
    const lage = () => {
      const r = feld.current?.getBoundingClientRect(); if (!r) return;
      const h = pop.current?.offsetHeight ?? 340, w = pop.current?.offsetWidth ?? 296;
      const top = r.bottom + 6 + h > window.innerHeight && r.top - 6 - h > 0 ? r.top - 6 - h : r.bottom + 6;
      setPos({ top, left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) });
    };
    lage();
    window.addEventListener('resize', lage); window.addEventListener('scroll', lage, true);
    return () => { window.removeEventListener('resize', lage); window.removeEventListener('scroll', lage, true); };
  }, [offen]);
  useEffect(() => {
    if (!offen) return;
    const weg = (e: MouseEvent) => { const t = e.target as Node; if (!feld.current?.contains(t) && !pop.current?.contains(t)) setOffen(false); };
    const taste = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOffen(false); } };
    document.addEventListener('mousedown', weg); document.addEventListener('keydown', taste, true);
    return () => { document.removeEventListener('mousedown', weg); document.removeEventListener('keydown', taste, true); };
  }, [offen]);

  const { j, m } = ansicht;
  const blaettern = (d: number) => { const x = new Date(j, m - 1 + d, 1); setAnsicht({ j: x.getFullYear(), m: x.getMonth() + 1 }); };
  const jetzt = new Date().getFullYear();
  const von = Math.min(jetzt - 30, j, min ? Number(min.slice(0, 4)) : jetzt), bis = Math.max(jetzt + 15, j, max ? Number(max.slice(0, 4)) : jetzt);
  const jahre = Array.from({ length: bis - von + 1 }, (_, i) => von + i);
  const erster = (new Date(j, m - 1, 1).getDay() + 6) % 7;   // Montag = 0
  const tage = Array.from({ length: 42 }, (_, i) => { const d = new Date(j, m - 1, 1 - erster + i); return { v: iso(d.getFullYear(), d.getMonth() + 1, d.getDate()), t: d.getDate(), anders: d.getMonth() + 1 !== m }; });
  const heute = heuteIso();
  const gesperrt = (v: string) => (!!min && v < min) || (!!max && v > max);

  return (
    <span ref={feld} className={'datum-feld' + (disabled ? ' aus' : '')} style={style}>
      <input {...rest} id={id} name={name} className={['datum-eingabe', className].filter(Boolean).join(' ')} type="text" inputMode="numeric" autoComplete="off"
        value={text ?? datumDe(wert)} placeholder={placeholder ?? 'TT.MM.JJJJ'} disabled={disabled} required={required} autoFocus={autoFocus} title={title}
        onClick={() => !offen && oeffnen()}
        onChange={(e) => { const t = e.target.value; setText(t); if (!t.trim()) setzen(''); else { const v = datumLesen(t); if (v) { setzen(v); setAnsicht({ j: Number(v.slice(0, 4)), m: Number(v.slice(5, 7)) }); } } }}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !offen) { e.preventDefault(); oeffnen(); } }}
        onBlur={() => { setText(null); onBlur?.({ target: { value: wert } }); }} />
      <button type="button" className="datum-knopf" tabIndex={-1} disabled={disabled} title="Kalender öffnen" aria-label="Kalender öffnen"
        onMouseDown={(e) => e.preventDefault()} onClick={() => (offen ? setOffen(false) : oeffnen())}><CalendarDays size={16} /></button>
      {offen && createPortal(
        <div ref={pop} className="datum-pop" role="dialog" aria-label="Datum wählen" style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}
          onMouseDown={(e) => { if (!(e.target instanceof HTMLSelectElement)) e.preventDefault(); }}>
          <div className="datum-pop-kopf">
            <button type="button" className="datum-pfeil" onClick={() => blaettern(-1)} aria-label="Monat zurück"><ChevronLeft size={16} /></button>
            <select aria-label="Monat" value={m} onChange={(e) => setAnsicht({ j, m: Number(e.target.value) })}>{MONATE.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}</select>
            <select aria-label="Jahr" value={j} onChange={(e) => setAnsicht({ j: Number(e.target.value), m })}>{jahre.map((x) => <option key={x} value={x}>{x}</option>)}</select>
            <button type="button" className="datum-pfeil" onClick={() => blaettern(1)} aria-label="Monat vor"><ChevronRight size={16} /></button>
          </div>
          <div className="datum-raster">
            {TAGE.map((t) => <span key={t} className="datum-wt">{t}</span>)}
            {tage.map((d) => (
              <button type="button" key={d.v} disabled={gesperrt(d.v)} onClick={() => waehlen(d.v)}
                className={['datum-tag', d.anders ? 'anders' : '', d.v === heute ? 'heute' : '', d.v === wert ? 'gewaehlt' : ''].filter(Boolean).join(' ')}>{d.t}</button>))}
          </div>
          <div className="datum-pop-fuss">
            <button type="button" className="link" disabled={gesperrt(heute)} onClick={() => waehlen(heute)}>Heute</button>
            {!required && wert && <button type="button" className="link" onClick={() => waehlen('')}>Leeren</button>}
          </div>
        </div>, document.body)}
    </span>
  );
}

/** Jahr wählen: Auswahlliste mit Pfeilen davor und dahinter (statt Zahlenfeld mit kleinen Pfeilen) */
export function JahrWahl({ value, onChange, von, bis, style }: { value: number; onChange: (j: number) => void; von?: number; bis?: number; style?: CSSProperties }) {
  const jetzt = new Date().getFullYear();
  const a = Math.min(von ?? jetzt - 15, value), b = Math.max(bis ?? jetzt + 5, value);
  const jahre = Array.from({ length: b - a + 1 }, (_, i) => b - i);
  return (
    <span className="jahr-wahl-gruppe" style={style}>
      <button type="button" className="datum-pfeil" title="Jahr zurück" aria-label="Jahr zurück" onClick={(e) => { e.preventDefault(); onChange(value - 1); }}><ChevronLeft size={15} /></button>
      <select className="jahr-wahl" aria-label="Jahr" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {jahre.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <button type="button" className="datum-pfeil" title="Jahr vor" aria-label="Jahr vor" onClick={(e) => { e.preventDefault(); onChange(value + 1); }}><ChevronRight size={15} /></button>
    </span>
  );
}
