// KMS Immobilienverwaltung Wortmarke (Text, keine Bilddatei nötig).
// Mit `daten` laufen Datenpakete als Lichtpunkte über Leiterbahnen rund um das Logo.
// Bei jedem Speichern in der Datenbank wird der Datenverkehr kurz stärker.
import { useEffect, useState } from 'react';
import { DATEN_EVENT } from '../db';

// Leiterbahnen links und rechts vom Logo (Koordinaten im Logo-Bereich 250 × 100)
const BAHNEN = [
  'M0 30 H16 L26 40 V58 L36 68 H48',
  'M0 82 H28 L36 90 H112',
  'M0 10 H38 L46 3 H86',
  'M0 52 H12',
  'M250 30 H234 L224 40 V58 L214 68 H202',
  'M250 82 H222 L214 90 H138',
  'M250 10 H212 L204 3 H164',
  'M250 52 H238',
];
const ENDEN: [number, number][] = [[48, 68], [112, 90], [86, 3], [12, 52], [202, 68], [138, 90], [164, 3], [238, 52]];

export function Logo({ size = 1, daten = false }: { size?: number; daten?: boolean }) {
  const [aktiv, setAktiv] = useState(false);
  useEffect(() => {
    if (!daten) return;
    let t: ReturnType<typeof setTimeout>;
    const f = () => { setAktiv(true); clearTimeout(t); t = setTimeout(() => setAktiv(false), 1600); };
    window.addEventListener(DATEN_EVENT, f);
    return () => { window.removeEventListener(DATEN_EVENT, f); clearTimeout(t); };
  }, [daten]);
  return (
    <div className={'logo' + (daten ? ' logo-daten' : '') + (aktiv ? ' aktiv' : '')} style={{ fontSize: 14 * size }}>
      {daten && (
        <svg className="logo-netz" viewBox="0 0 250 100" preserveAspectRatio="none" aria-hidden="true">
          {BAHNEN.map((d, i) => <path key={'b' + i} d={d} className="bahn" pathLength={100} />)}
          {BAHNEN.map((d, i) => <path key={'p' + i} d={d} className={'paket p' + i} pathLength={100} />)}
          {ENDEN.map(([x, y], i) => <circle key={'k' + i} cx={x} cy={y} r={1.8} className={'knoten k' + i} />)}
        </svg>
      )}
      <div className="logo-kms">KM<span>S</span></div>
      <div className="logo-sub">IMMOBILIENVERWALTUNG</div>
    </div>
  );
}
