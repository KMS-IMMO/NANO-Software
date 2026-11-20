// Eingabefeld für Geldbeträge: rechtsbündig mit festem „€“, Anzeige immer als 1.234,00.
// Beim Hineinklicken bleibt der Text stehen (nichts springt), getippt wird frei; Eingaben wie 1.234,50 / 1234,5 / 1234.50 werden verstanden.
// Der Wert im Formular ist der getippte Text; nur die Anzeige wird formatiert.
import { useState, type InputHTMLAttributes } from 'react';
import { betragText, betragZahl } from '../lib/betrag';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string | number | null | undefined;
  onChange: (e: { target: { value: string } }) => void;
  /** schmale Variante für Tabellenzellen */
  zelle?: boolean;
};

export function BetragFeld({ value, onChange, zelle, className, onFocus, onBlur, placeholder, style, ...rest }: Props) {
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
        onChange={(e) => { setLokal(e.target.value); onChange({ target: { value: e.target.value } }); }} />
      <span className="betrag-eur" aria-hidden="true">€</span>
    </span>
  );
}
