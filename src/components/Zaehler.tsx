// Zahl, die beim Erscheinen und bei Änderungen weich hochzählt.
import { useEffect, useRef, useState } from 'react';

const ruhig = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function Zaehler({ wert, format = (v) => Math.round(v).toLocaleString('de-DE'), dauer = 900 }: { wert: number; format?: (v: number) => string; dauer?: number }) {
  const [v, setV] = useState(ruhig() ? wert : 0);
  const von = useRef(0);
  useEffect(() => {
    if (ruhig()) { setV(wert); return; }
    const start = performance.now(), a = von.current, b = Number(wert) || 0;
    let f = 0;
    const schritt = (t: number) => {
      const x = Math.max(0, Math.min(1, (t - start) / dauer));
      const e = 1 - Math.pow(1 - x, 3);
      setV(a + (b - a) * e);
      if (x < 1) f = requestAnimationFrame(schritt); else von.current = b;
    };
    f = requestAnimationFrame(schritt);
    return () => { cancelAnimationFrame(f); von.current = b; };
  }, [wert]);
  return <>{format(v)}</>;
}
