// Eingabefeld für Geldbeträge: rechtsbündig mit festem „€“, Anzeige immer als 1.234,00.
// Beim Tippen setzt das Feld die Tausenderpunkte selbst (11354 → 11.354), das Komma (oder ein einzeln getippter Punkt) beginnt die Cent;
// beim Verlassen wird auf zwei Nachkommastellen ergänzt (11.354,00). Eingefügte Beträge wie 1234.50 oder 1.234,50 € werden umgerechnet.
// Der Wert im Formular ist der angezeigte Text (mit Tausenderpunkten); betragZahl liest ihn.
import { useState, type ChangeEvent, type ClipboardEvent, type InputHTMLAttributes } from 'react';
import { betragLive, betragText, betragZahl } from '../lib/betrag';

/** Tipp-Logik für ein Betragsfeld: formatiert den Text und setzt den Cursor wieder an die richtige Stelle. `vorher` = Text vor der Eingabe. */
export function betragTippen(e: ChangeEvent<HTMLInputElement>, vorher: string): string {
  const el = e.target;
  let roh = el.value;
  const pos = el.selectionStart ?? roh.length;
  // Mehrere Zeichen auf einmal (Autofill, Ziehen, Spracheingabe): als ganzen Betrag lesen, damit 1234.50 nicht zu 123.450 wird
  if (roh.length - vorher.length > 1) { const n = betragZahl(roh); if (n !== null) return betragText(n); }
  // Ein einzeln getippter Punkt ist das Dezimalzeichen (Ziffernblock), Tausenderpunkte setzt das Feld selbst
  if (roh.length === vorher.length + 1 && roh[pos - 1] === '.' && !vorher.includes(',')) roh = roh.slice(0, pos - 1) + ',' + roh.slice(pos);
  const { text, caret } = betragLive(roh, pos);
  requestAnimationFrame(() => { try { if (document.activeElement === el) el.setSelectionRange(caret, caret); } catch { /* Feld weg */ } });
  return text;
}

/** Eingefügter Text (z. B. aus dem Online-Banking): als ganzer Betrag lesen. null = normal einfügen lassen. */
export function betragEinfuegen(e: ClipboardEvent<HTMLInputElement>): string | null {
  const n = betragZahl(e.clipboardData.getData('text'));
  if (n === null) return null;
  e.preventDefault();
  return betragText(n);
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string | number | null | undefined;
  onChange: (e: { target: { value: string } }) => void;
  /** schmale Variante für Tabellenzellen */
  zelle?: boolean;
};

export function BetragFeld({ value, onChange, zelle, className, onFocus, onBlur, onPaste, placeholder, style, ...rest }: Props) {
  const [lokal, setLokal] = useState<string | null>(null);
  const roh = value === null || value === undefined ? '' : String(value);
  const n = betragZahl(value);
  const formatiert = roh.trim() === '' || n === null ? roh : betragText(n);
  const anzeige = lokal ?? formatiert;
  return (
    <span className={'betrag-feld' + (zelle ? ' zelle' : '') + (n !== null && n < 0 && lokal === null ? ' minus' : '')}>
      <input {...rest} className={className} style={style} inputMode="decimal" autoComplete="off" value={anzeige}
        placeholder={placeholder ?? '0,00'}
        onFocus={(e) => { setLokal(formatiert); onFocus?.(e); }}
        onBlur={(e) => { setLokal(null); onBlur?.(e); }}
        onPaste={(e) => { onPaste?.(e); const t = betragEinfuegen(e); if (t !== null) { setLokal(t); onChange({ target: { value: t } }); } }}
        onChange={(e) => { const t = betragTippen(e, anzeige); setLokal(t); onChange({ target: { value: t } }); }} />
      <span className="betrag-eur" aria-hidden="true">€</span>
    </span>
  );
}

/** Eingabefeld für Mengen (Verbrauch, Fläche …) mit fester Einheit rechts im Feld, z. B. „m³“, „kWh“ oder „€“ */
export function MengeFeld({ value, onChange, einheit, zelle, className, style, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string | number | null | undefined; onChange: (e: { target: { value: string } }) => void; einheit?: string | null; zelle?: boolean }) {
  return (
    <span className={'betrag-feld menge-feld' + (zelle ? ' zelle' : '') + (einheit && einheit.length > 2 ? ' lang' : '')}>
      <input {...rest} className={className} style={style} inputMode="decimal" autoComplete="off" value={value ?? ''} onChange={(e) => onChange({ target: { value: e.target.value } })} />
      {einheit && <span className="betrag-eur" aria-hidden="true">{einheit}</span>}
    </span>
  );
}
