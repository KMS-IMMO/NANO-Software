// Kontostand-Leiste unter „Einnahmen & Ausgaben“: bleibt beim Scrollen oben stehen und rechnet nach jeder Änderung neu
// (jeder Schreibvorgang in der Datenbank löst das aus). Stand laut Bank gegen Stand laut Buchungen, darunter die Gründe einer Differenz.
import { useEffect, useRef, useState } from 'react';
import { Landmark } from 'lucide-react';
import { DATEN_EVENT } from '../db';
import { kontostand, type Kontostand } from '../logic/kontostand';
import { datum, eur } from './EntityTable';

export type StatusFilter = '' | 'bank' | 'ohne' | 'bar';

export function KontostandLeiste({ objekt, jahr, monat, version, filter, onFilter, onUmsaetze }: {
  objekt: number; jahr: number; monat: string; version: number; filter: StatusFilter;
  onFilter: (f: StatusFilter) => void; onUmsaetze: () => void;
}) {
  const [k, setK] = useState<Kontostand | null | undefined>(undefined);
  const [frisch, setFrisch] = useState(false);
  const lauf = useRef(0);
  const laden = async () => {
    const nr = ++lauf.current;
    const r = await kontostand(objekt, jahr, monat);
    if (nr !== lauf.current) return;
    setK((alt) => { if (alt && r && (alt.bank !== r.bank || alt.buchungen !== r.buchungen)) { setFrisch(true); setTimeout(() => setFrisch(false), 900); } return r; });
  };
  useEffect(() => { laden(); }, [objekt, jahr, monat, version]);
  // Nach jeder Änderung (Buchen, Zuordnen, Löschen, Verbinden …) kurz warten und neu rechnen
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const f = () => { clearTimeout(t); t = setTimeout(laden, 400); };
    window.addEventListener(DATEN_EVENT, f);
    return () => { window.removeEventListener(DATEN_EVENT, f); clearTimeout(t); };
  }, [objekt, jahr, monat]);

  if (k === undefined) return null;
  if (k === null) return <div className="ks-leiste ks-leer"><Landmark size={18} /><span className="muted">Für diese Liegenschaft ist kein Bankkonto angelegt. Der Kontostand erscheint, sobald eines angelegt ist.</span></div>;
  const stimmt = Math.abs(k.differenz) < 0.005;
  const auszugDiff = k.auszug === null ? null : Math.round((k.auszug - k.bank) * 100) / 100;
  const chip = (f: StatusFilter, cls: string, text: string, title: string) => (
    <button className={`ks-chip ${cls}${filter === f ? ' an' : ''}`} title={title} onClick={() => onFilter(filter === f ? '' : f)}>{text}</button>);
  return (
    <div className={'ks-leiste' + (frisch ? ' frisch' : '')} aria-live="polite">
      <div className="ks-wert"><span>Kontostand laut Bank</span><b>{eur(k.bank)}</b>
        <small>{k.konten.length > 1 ? `${k.konten.length} Konten · ` : ''}{k.letzterUmsatz ? `Umsätze bis ${datum(k.letzterUmsatz)}` : 'noch keine Umsätze'}</small></div>
      <div className="ks-wert"><span>Stand laut Buchungen</span><b>{eur(k.buchungen)}</b><small>Stand 01.01. {eur(k.start)} + Buchungen</small></div>
      <div className={'ks-wert ks-diff ' + (stimmt ? 'ok' : 'nein')}><span>Differenz</span><b>{stimmt ? 'stimmt' : eur(k.differenz)}</b>
        <small>{stimmt ? 'Bank und Buchungen passen zusammen' : 'Gründe rechts, zum Prüfen anklicken'}</small></div>
      <div className="ks-gruende">
        {k.ohne.length > 0 && chip('ohne', 'rot', `● ${k.ohne.length} ohne Kontoumsatz · ${eur(k.ohneSumme)}`, 'Buchungen, die (noch) an keinem Kontoumsatz hängen: in der Liste rot. Klick filtert.')}
        {k.offen.length > 0 && <button className="ks-chip gelb" title="Kontoumsätze, die noch keiner Buchung zugeordnet sind" onClick={onUmsaetze}>● {k.offen.length} Kontoumsätze offen · {eur(k.offenSumme)}</button>}
        {k.abweichend.length > 0 && <button className="ks-chip gelb" onClick={onUmsaetze} title="Kontoumsätze, deren Buchungen nicht genau den Umsatzbetrag ergeben">● {k.abweichend.length} Umsätze anders gebucht · {eur(k.abweichendSumme)}</button>}
        {k.ignoriert > 0 && <button className="ks-chip grau" onClick={onUmsaetze} title="Ignorierte Kontoumsätze ändern den Kontostand, haben aber keine Buchung">{k.ignoriert} ignoriert · {eur(k.ignoriertSumme)}</button>}
        {k.bar > 0 && chip('bar', 'grau', `${k.bar} bar / ohne Bank · ${eur(k.barSumme)}`, 'Bewusst ohne Bankkonto gebucht, zählt nicht im Kontostand. Klick filtert.')}
        {stimmt && !k.ohne.length && !k.offen.length && <span className="ks-chip gruen">✓ alles verbunden</span>}
        {auszugDiff !== null && <span className={'ks-chip ' + (Math.abs(auszugDiff) < 0.005 ? 'gruen' : 'rot')} title="Kontostand laut Kontoauszug zum 31.12. aus dem Kontoabgleich der Jahresabrechnung">
          Kontoauszug 31.12.: {eur(k.auszug!)}{Math.abs(auszugDiff) < 0.005 ? ' ✓' : ` · fehlt ${eur(auszugDiff)}`}</span>}
      </div>
    </div>
  );
}
