// Karte „Kontoabgleich“ in der Jahresabrechnung: Anfangs- und Endbestand je Bankkonto, Kontostand laut Kontoauszug zum 31.12.
// und die zweite Prüfung, ob alle Umsätze aus den Kontoauszügen gebucht sind.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { eur, datum } from './EntityTable';
import { auszugSpeichern, kontoabgleich, type KontoAbgleich } from '../logic/kontoabgleich';

const zahl = (s: string) => { const t = s.trim(); if (!t) return null; const n = Number(t.replace(/[€\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; };

export function KontoabgleichKarte({ objekt, jahr, stand, gesperrt }: { objekt: number; jahr: number; stand: number; gesperrt?: boolean }) {
  const [l, setL] = useState<KontoAbgleich[] | null>(null);
  const [eingabe, setEingabe] = useState<Record<number, string>>({});
  const [fehler, setFehler] = useState('');
  async function laden() {
    const r = await kontoabgleich(objekt, jahr);
    setL(r);
    setEingabe(Object.fromEntries(r.map((k) => [k.id, k.auszug === null ? '' : k.auszug.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })])));
  }
  useEffect(() => { laden(); }, [objekt, jahr, stand]);
  useEffect(() => { const f = () => laden(); window.addEventListener('nano-abschluss', f); return () => window.removeEventListener('nano-abschluss', f); }, [objekt, jahr]);

  async function speichern(k: KontoAbgleich) {
    const n = zahl(eingabe[k.id] ?? '');
    if (Number.isNaN(n)) { setFehler(`Bitte den Kontostand als Zahl eingeben, z. B. 12.345,67.`); return; }
    setFehler('');
    if (n === k.auszug) return;
    await auszugSpeichern(k.id, jahr, n);
    await laden();
    window.dispatchEvent(new Event('nano-abschluss'));   // Prüfliste neu laden
  }
  if (!l) return null;
  const bankLink = `/objekte/${objekt}/bank`;
  return (
    <section className="card abr-uebersicht kontoabgleich">
      <div className="card-head"><h2>Kontoabgleich {jahr}: Anfangs- und Endbestand</h2></div>
      {!l.length ? <p className="muted small">Für dieses Objekt ist kein Bankkonto angelegt.</p> : <>
        <table className="list">
          <thead><tr><th>Bankkonto</th><th className="num">Stand 01.01.</th><th className="num">Eingänge</th><th className="num">Ausgänge</th><th className="num">Stand 31.12.</th><th className="num">Laut Kontoauszug 31.12.</th><th>Abgleich</th></tr></thead>
          <tbody>{l.map((k) => (
            <tr key={k.id}>
              <td>{k.name}{k.erfasstAb ? <span className="muted small"> (erfasst ab {datum(k.erfasstAb)})</span> : null}</td>
              <td className="num">{eur(k.start)}</td><td className="num">{eur(k.ein)}</td><td className="num">{eur(k.aus)}</td><td className="num"><b>{eur(k.ende)}</b></td>
              <td className="num"><input className="num" style={{ width: 130 }} placeholder="eintragen" disabled={gesperrt} aria-label={`Kontostand laut Kontoauszug ${k.name}`}
                value={eingabe[k.id] ?? ''} onChange={(e) => setEingabe({ ...eingabe, [k.id]: e.target.value })}
                onBlur={() => speichern(k)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /></td>
              <td className="small">{k.differenz === null ? <span className="muted"><AlertTriangle size={14} /> Auszug fehlt</span>
                : Math.abs(k.differenz) < 0.005 ? <span className="pos"><CheckCircle2 size={14} /> stimmt</span>
                : <span className="neg"><XCircle size={14} /> Differenz {eur(k.differenz)}</span>}</td>
            </tr>))}
          </tbody>
        </table>
        {fehler && <p className="warn">{fehler}</p>}
        <h3 className="kontoabgleich-titel">Zweite Prüfung: Ist alles gebucht, was auf den Kontoauszügen steht?</h3>
        <ul className="pruefliste">{l.map((k) => {
          const alleGebucht = !k.offen.length;
          return [
            <li key={k.id + 'a'} className={alleGebucht ? 'ok' : 'fehlt'}>
              {alleGebucht ? <CheckCircle2 size={17} /> : <XCircle size={17} />}
              <span><b>{k.name}:</b> {k.anzahl} Umsätze, davon {k.gebucht} gebucht{k.ignoriert ? `, ${k.ignoriert} bewusst ignoriert (${eur(k.ignoriertSumme)})` : ''}
                {k.offen.length ? <>, <b>{k.offen.length} noch nicht gebucht ({eur(k.offenSumme)})</b> · <Link to={bankLink}>Bank &amp; Zuordnung</Link></> : '.'}</span></li>,
            ...k.offen.slice(0, 8).map((u) => <li key={k.id + 'o' + u.id} className="hinweis unter"><span className="muted">{datum(u.datum)} · {u.gegenpartei || 'ohne Name'} · {u.zweck.slice(0, 70)}</span><span className="num">{eur(u.betrag)}</span></li>),
            k.offen.length > 8 ? <li key={k.id + 'm'} className="hinweis unter"><span className="muted">und {k.offen.length - 8} weitere</span></li> : null,
            <li key={k.id + 'b'} className={k.abweichend.length ? 'fehlt' : 'ok'}>
              {k.abweichend.length ? <XCircle size={17} /> : <CheckCircle2 size={17} />}
              <span>{k.abweichend.length ? <>{k.abweichend.length} Umsätze sind anders gebucht als auf dem Auszug: {k.abweichend.slice(0, 5).map((u) => `${datum(u.datum)} ${u.gegenpartei} ${eur(u.betrag)} (gebucht ${eur(u.gebucht)})`).join(', ')}</>
                : 'Die Buchungen ergeben bei jedem Umsatz genau den Betrag laut Kontoauszug.'}</span></li>,
            k.monateOhne.length ? <li key={k.id + 'l'} className="hinweis"><AlertTriangle size={17} /><span>Keine Umsätze im {k.monateOhne.join(', ')}. Fehlt dort ein Kontoauszug?</span></li> : null,
          ];
        })}</ul>
        <p className="muted small">Der Stand 31.12. ergibt sich aus dem Anfangsbestand und allen eingelesenen Umsätzen. Trag den Kontostand vom echten Kontoauszug zum 31.12. ein.
          Weicht er ab, fehlen Umsätze oder es wurde ein Auszug nicht eingelesen.</p>
      </>}
    </section>
  );
}
