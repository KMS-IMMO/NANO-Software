// Ringdiagramm für Zahlungsquoten (bezahlt / offen). Füllt sich beim Erscheinen.
import { useEffect, useState } from 'react';
import { Zaehler } from './Zaehler';
export function Donut({ anteil, label, size = 150 }: { anteil: number; label: string; size?: number }) {
  const r = 42, c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, anteil));
  const [an, setAn] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setAn(true)); return () => cancelAnimationFrame(t); }, []);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`${Math.round(p * 1000) / 10} % ${label}`}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="#e8e6e1" strokeWidth="11" />
      <circle cx="50" cy="50" r={r} fill="none" stroke="#2e7d32" strokeWidth="11" className="donut-ring" strokeDasharray={`${an ? c * p : 0} ${c}`}
        transform="rotate(-90 50 50)" strokeLinecap="butt" />
      <text x="50" y="49" textAnchor="middle" fontSize="15" fontWeight="700" fill="#1f2328"><Zaehler wert={p * 100} format={(v) => v.toLocaleString('de-DE', { maximumFractionDigits: 1 })} /> %</text>
      <text x="50" y="63" textAnchor="middle" fontSize="8" fill="#6b6f76">{label}</text>
    </svg>
  );
}
