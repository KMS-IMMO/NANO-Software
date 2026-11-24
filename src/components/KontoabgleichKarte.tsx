// Karte „Kontoabgleich“ in der Jahresabrechnung: Anfangs- und Endbestand je Bankkonto, Kontostand laut Kontoauszug zum 31.12.
// und die zweite Prüfung, ob alle Umsätze aus den Kontoauszügen gebucht sind.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { eur, datum } from './EntityTable';
import { auszugSpeichern, buchungAlsUmsatz, kontoabgleich, umsatzNachtragen, type KontoAbgleich } from '../logic/kontoabgleich';
import { DatumFeld } from './DatumFeld';

const zahl = (s: string) => { const t = s.trim(); if (!t) return null; const n = Number(t.replace(/[€\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; };

export function KontoabgleichKarte({ objekt, jahr, stand, gesperrt }: { objekt: number; jahr: number; stand: number; gesperrt?: boolean }) {
  const [l, setL] = useState<KontoAbgleich[] | null>(null);
  const [eingabe, setEingabe] = useState<Record<number, string>>({});
  const [fehler, setFehler] = useState('');
  const [neu, setNeu] = useState<Record<number, { datum: string; betrag: string; gegenpartei: string; zweck: string }>>({});
  const [hinweis, setHinweis] = useState('');
  async function nachtragen(k: KontoAbgleich) {
    const f = neu[k.id] ?? { datum: '', betrag: '', gegenpartei: '', zweck: '' };
    const b = zahl(f.betrag);
    try {
      await umsatzNachtragen(k.id, { datum: f.datum, betrag: b ?? NaN, gegenpartei: f.gegenpartei, zweck: f.zweck });
      setNeu({ ...neu, [k.id]: { datum: '', betrag: '', gegenpartei: '', zweck: '' } }); setFehler('');
      setHinweis(`Umsatz ${eur(b ?? 0)} vom ${datum(f.datum)} nachgetragen. Bitte unter „Bank & Zuordnung“ zuordnen.`);
      await laden(); window.dispatchEvent(new Event('nano-abschluss'));
    } catch (e) { setFehler(String((e as Error)?.message ?? e)); }
  }
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
        {l.filter((k) => (k.differenz !== null && Math.abs(k.differenz) >= 0.005) || k.geloescht.length).map((k) => {
          const f = neu[k.id] ?? { datum: '', betrag: '', gegenpartei: '', zweck: '' };
          const passt = (b: number) => k.differenz !== null && Math.abs(Math.abs(k.differenz) - Math.abs(b)) < 0.005;
          return (
            <div key={k.id + 'd'} className="kontoabgleich-differenz">
              <h3 className="kontoabgleich-titel">Woher kommt die Differenz{k.differenz !== null ? ` von ${eur(k.differenz)}` : ''}? ({k.name})</h3>
              {k.differenz !== null && k.differenz > 0 && <p className="small">Laut Kontoauszug ist <b>mehr</b> auf dem Konto als die eingelesenen Umsätze ergeben: Es fehlt ein Eingang von {eur(k.differenz)} (oder ein Ausgang ist zu viel eingelesen).</p>}
              {k.differenz !== null && k.differenz < 0 && <p className="small">Laut Kontoauszug ist <b>weniger</b> auf dem Konto: Es fehlt ein Ausgang von {eur(-k.differenz)} (oder ein Eingang ist doppelt eingelesen).</p>}
              <ul className="pruefliste">
                {k.geloescht.map((g) => <li key={'g' + g.id} className="fehlt"><XCircle size={17} /><span>Gelöscht am {datum(g.geloeschtAm.slice(0, 10))}: {datum(g.datum)} · {g.gegenpartei || 'ohne Name'} · {eur(g.betrag)}
                  {passt(g.betrag) ? <b> · passt genau zur Differenz</b> : null}. Im Papierkorb wiederherstellen oder den Kontoauszug erneut einlesen.</span></li>)}
                {k.regelmaessig.map((g) => <li key={'r' + g.name} className={g.fehlt.length && passt(g.betrag) ? 'fehlt' : 'hinweis'}><AlertTriangle size={17} /><span>
                  <b>{g.name}</b> zahlt regelmäßig {eur(g.betrag)} ({g.anzahl} Eingänge){g.fehlt.length ? <>, aber <b>kein Eingang im {g.fehlt.join(', ')}</b></> : null}
                  {g.doppelt.length ? <>, zwei Eingänge im {g.doppelt.join(', ')}</> : null}
                  {g.fehlt.length && passt(g.betrag) ? <b> · passt genau zur Differenz</b> : null}.
                  {g.fehlt.length ? ' Bitte im Kontoauszug prüfen, ob die Zahlung dort steht (evtl. von einem anderen Konto oder unter anderem Namen).' : ''}</span></li>)}
                {k.ohneUmsatz.map((b) => <li key={'b' + b.id} className="fehlt"><XCircle size={17} /><span>
                  Buchung vom {datum(b.datum)} über {eur(b.betrag)} ({[b.konto, b.einheit, b.text].filter(Boolean).join(' · ')}) hat <b>keinen Kontoumsatz</b> und zählt deshalb nicht im Kontostand.
                  Steht die Zahlung so auf dem Kontoauszug, hier übernehmen:{' '}
                  {!gesperrt && <button className="small-btn" onClick={async () => {
                    try { await buchungAlsUmsatz(k.id, b.id); setFehler(''); setHinweis(`Buchung vom ${datum(b.datum)} als Kontoumsatz übernommen.`); await laden(); window.dispatchEvent(new Event('nano-abschluss')); }
                    catch (e) { setFehler(String((e as Error)?.message ?? e)); } }}>Als Kontoumsatz übernehmen</button>}</span></li>)}
                {!k.geloescht.length && !k.regelmaessig.length && !k.ohneUmsatz.length && <li className="hinweis"><AlertTriangle size={17} /><span>Kein Hinweis aus gelöschten Umsätzen oder regelmäßigen Zahlern. Bitte den Kontoauszug Monat für Monat mit „Bank &amp; Zuordnung“ vergleichen.</span></li>}
              </ul>
              {!gesperrt && <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <span className="small" title="Buchungen unter „Einnahmen & Ausgaben“ ändern den Kontostand nicht. Er kommt nur aus den Umsätzen der Kontoauszüge.">Fehlenden Umsatz laut Kontoauszug nachtragen:</span>
                <DatumFeld value={f.datum} aria-label="Datum" onChange={(e) => setNeu({ ...neu, [k.id]: { ...f, datum: e.target.value } })} />
                <input className="num" style={{ width: 110 }} placeholder="Betrag" aria-label="Betrag" value={f.betrag} onChange={(e) => setNeu({ ...neu, [k.id]: { ...f, betrag: e.target.value } })} />
                <input style={{ width: 180 }} placeholder="Auftraggeber" aria-label="Auftraggeber" value={f.gegenpartei} onChange={(e) => setNeu({ ...neu, [k.id]: { ...f, gegenpartei: e.target.value } })} />
                <input style={{ width: 200 }} placeholder="Verwendungszweck" aria-label="Verwendungszweck" value={f.zweck} onChange={(e) => setNeu({ ...neu, [k.id]: { ...f, zweck: e.target.value } })} />
                <button className="small-btn" onClick={() => nachtragen(k)}>Nachtragen</button>
              </div>}
            </div>);
        })}
        {hinweis && <p className="info small">{hinweis}</p>}
        <p className="muted small">Der Stand 31.12. ergibt sich aus dem Anfangsbestand und allen eingelesenen Umsätzen. Eine Buchung unter „Einnahmen &amp; Ausgaben“ ändert ihn nicht, nur ein Kontoumsatz. Trag den Kontostand vom echten Kontoauszug zum 31.12. ein.
          Weicht er ab, fehlen Umsätze oder es wurde ein Auszug nicht eingelesen.</p>
      </>}
    </section>
  );
}
