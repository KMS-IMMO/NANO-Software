// KMS Immobilienverwaltung: originales Logo als Vektor (logoPfade.ts).
// Mit `daten` laufen Datenpakete als Lichtpunkte über Leiterbahnen rund um das Logo.
// Bei jedem Speichern in der Datenbank wird der Datenverkehr kurz stärker.
import { useEffect, useState } from 'react';
import { DATEN_EVENT } from '../db';
import { LOGO_BOX, LOGO_KM, LOGO_LINIEN, LOGO_S, LOGO_TEXT } from './logoPfade';

/** Das Logo selbst: Farben über CSS (--logo-grau, --logo-bronze), damit es im Dunkelmodus lesbar bleibt */
export function LogoMarke({ glanz = false, className = '' }: { glanz?: boolean; className?: string }) {
  return (
    <svg className={'logo-marke ' + className} viewBox={LOGO_BOX} role="img" aria-label="KMS Immobilienverwaltung">
      {glanz && (
        <defs>
          <linearGradient id="logo-glanz" x1="-1" x2="0" y1="0" y2="0" gradientUnits="objectBoundingBox">
            <stop offset="0.4" stopColor="var(--logo-grau)" /><stop offset="0.5" stopColor="var(--logo-glanz)" /><stop offset="0.6" stopColor="var(--logo-grau)" />
            <animate attributeName="x1" values="-1;-1;1" keyTimes="0;0.55;1" dur="6s" repeatCount="indefinite" />
            <animate attributeName="x2" values="0;0;2" keyTimes="0;0.55;1" dur="6s" repeatCount="indefinite" />
          </linearGradient>
        </defs>
      )}
      <path className="logo-grau" fillRule="evenodd" d={LOGO_KM + LOGO_TEXT} style={glanz ? { fill: 'url(#logo-glanz)' } : undefined} />
      <path className="logo-bronze" fillRule="evenodd" d={LOGO_S} />
      {LOGO_LINIEN.map((l, i) => <rect key={i} className="logo-bronze" x={l.x} y={l.y} width={l.w} height={l.h} rx={l.h / 2} />)}
      {glanz && <rect className="logo-puls" x={LOGO_LINIEN[0].x} y={LOGO_LINIEN[0].y - 2} width={300} height={LOGO_LINIEN[0].h + 4} rx={6} />}
    </svg>
  );
}

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
      <LogoMarke glanz={daten} />
    </div>
  );
}

/**
 * Leiterbahnen in der Kopfleiste: setzen die rechten Bahnen des Logos fort und laufen über die ganze Leiste.
 * Die Lichtpunkte fließen von rechts zum Logo hin. Beim Speichern wird der Verkehr kurz stärker, wie am Logo.
 */
export function KopfNetz() {
  const [w, setW] = useState(0);
  const [h, setH] = useState(66);
  const [aktiv, setAktiv] = useState(false);
  const [ref, setRef] = useState<SVGSVGElement | null>(null);
  useEffect(() => {
    if (!ref) return;
    const ro = new ResizeObserver(([e]) => { setW(e.contentRect.width); setH(e.contentRect.height); });
    ro.observe(ref);
    return () => ro.disconnect();
  }, [ref]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const f = () => { setAktiv(true); clearTimeout(t); t = setTimeout(() => setAktiv(false), 1600); };
    window.addEventListener(DATEN_EVENT, f);
    return () => { window.removeEventListener(DATEN_EVENT, f); clearTimeout(t); };
  }, []);
  // Höhe der Logo-Ausgänge: 10 %, 30 % und 52 % der Logo-Fläche (≈ 103 px hoch)
  const logo = (document.querySelector('.side-logo') as HTMLElement | null)?.offsetHeight ?? 103;
  const y = [0.1, 0.3, 0.52].map((f) => Math.min(h - 6, Math.round(f * logo)));
  const x = (f: number) => Math.round(f * w);
  const bahnen = w < 200 ? [] : [
    // von rechts nach links, Ende jeweils am Logo (x = 0)
    `M${x(0.66)} ${y[0] + 10} H${x(0.47)} L${x(0.47) - 10} ${y[0]} H${x(0.2)} L${x(0.2) - 8} ${y[0] + 8} H${x(0.08)} L${x(0.08) - 8} ${y[0]} H0`,
    `M${x(0.6)} ${y[1] + 10} H${x(0.38)} L${x(0.38) - 10} ${y[1]} H${x(0.13)} L${x(0.13) - 12} ${y[1] + 12} H${x(0.05)} L${x(0.05) - 12} ${y[1]} H0`,
    `M${x(0.64)} ${y[2] - 8} H${x(0.52)} L${x(0.52) - 8} ${y[2]} H${x(0.28)} L${x(0.28) - 9} ${y[2] - 9} H${x(0.16)} L${x(0.16) - 9} ${y[2]} H0`,
    `M${x(0.9)} ${y[1]} H${x(0.72)} L${x(0.72) - 10} ${y[1] + 10} H${x(0.6)}`,
    `M${x(0.86)} ${y[2] + 2} H${x(0.7)} L${x(0.7) - 10} ${y[2] - 8} H${x(0.64)}`,
  ];
  const enden: [number, number][] = w < 200 ? [] : [[x(0.66), y[0] + 10], [x(0.9), y[1]], [x(0.86), y[2] + 2], [x(0.38), y[1]], [x(0.2), y[0]], [x(0.52), y[2]]];
  return (
    <svg ref={setRef} className={'kopf-netz' + (aktiv ? ' aktiv' : '')} aria-hidden="true">
      {bahnen.map((d, i) => <path key={'b' + i} d={d} className="bahn" />)}
      {bahnen.map((d, i) => <path key={'p' + i} d={d} className={'paket q' + i} pathLength={100} />)}
      {enden.map(([cx, cy], i) => <circle key={'k' + i} cx={cx} cy={cy} r={2.2} className={'knoten j' + i} />)}
    </svg>
  );
}
