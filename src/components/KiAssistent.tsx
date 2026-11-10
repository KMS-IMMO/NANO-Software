// KI-Assistent: runder Knopf rechts unten auf jeder Seite, öffnet ein Chatfenster.
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, KeyRound, RotateCcw, Send, Sparkles, X } from 'lucide-react';
import { kiEinstellungen, kiFehlerText, kiFragen, kiSchluesselSpeichern, KI_MODELLE, type Verlauf } from '../logic/kiAgent';

type Nachricht = { von: 'ich' | 'ki' | 'fehler'; text: string };
type Frage = { titel: string; details: string[]; antwort: (ja: boolean) => void };

const VORSCHLAEGE = [
  'Welche offenen Posten sind älter als 30 Tage?',
  'Welche Termine stehen diese Woche an?',
  'Welche Rechnungen sind noch nicht bezahlt?',
  'Erinnere mich nächsten Montag an die Rauchmelderwartung',
];

/** Kleiner Markdown-Leser: **fett**, Aufzählungen, Tabellen und Absätze */
function Text({ t }: { t: string }) {
  const fett = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((x, i) => x.startsWith('**') && x.endsWith('**') ? <b key={i}>{x.slice(2, -2)}</b> : <Fragment key={i}>{x}</Fragment>);
  const bloecke: ReactNode[] = [];
  const zeilen = t.split('\n');
  for (let i = 0; i < zeilen.length; i++) {
    const z = zeilen[i];
    if (/^\s*\|/.test(z)) {
      const tab: string[][] = [];
      while (i < zeilen.length && /^\s*\|/.test(zeilen[i])) { if (!/^\s*\|[\s:|-]+\|\s*$/.test(zeilen[i])) tab.push(zeilen[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())); i++; }
      i--;
      bloecke.push(<div className="ki-tab" key={i}><table><tbody>{tab.map((r, j) => <tr key={j}>{r.map((c, k) => j === 0 ? <th key={k}>{fett(c)}</th> : <td key={k}>{fett(c)}</td>)}</tr>)}</tbody></table></div>);
    } else if (/^\s*([-*•]|\d+\.)\s+/.test(z)) {
      const li: string[] = [];
      while (i < zeilen.length && /^\s*([-*•]|\d+\.)\s+/.test(zeilen[i])) { li.push(zeilen[i].replace(/^\s*([-*•]|\d+\.)\s+/, '')); i++; }
      i--;
      bloecke.push(<ul key={i}>{li.map((x, j) => <li key={j}>{fett(x)}</li>)}</ul>);
    } else if (/^#+\s/.test(z)) bloecke.push(<p key={i}><b>{z.replace(/^#+\s/, '')}</b></p>);
    else if (z.trim()) bloecke.push(<p key={i}>{fett(z)}</p>);
  }
  return <>{bloecke}</>;
}

export function KiAssistent() {
  const [offen, setOffen] = useState(false);
  const [msgs, setMsgs] = useState<Nachricht[]>([]);
  const [verlauf, setVerlauf] = useState<Verlauf>([]);
  const [text, setText] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [schritt, setSchritt] = useState('');
  const [frage, setFrage] = useState<Frage | null>(null);
  const [ohneSchluessel, setOhneSchluessel] = useState(false);
  const [modell, setModell] = useState('');
  const [neuerSchluessel, setNeuerSchluessel] = useState('');
  const liste = useRef<HTMLDivElement>(null);
  const eingabe = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();
  const pfad = useLocation().pathname;

  useEffect(() => { if (offen) kiEinstellungen().then((e) => { setOhneSchluessel(!e.schluessel); setModell(KI_MODELLE.find(([m]) => m === e.modell)?.[1].split(' (')[0] ?? e.modell); setTimeout(() => eingabe.current?.focus(), 50); }); }, [offen]);
  useEffect(() => { liste.current?.scrollTo({ top: liste.current.scrollHeight, behavior: 'smooth' }); }, [msgs, laeuft, frage]);

  async function senden(t = text) {
    const f = t.trim();
    if (!f || laeuft) return;
    setText(''); setMsgs((m) => [...m, { von: 'ich', text: f }]); setLaeuft(true); setSchritt('Denkt nach');
    const seite = document.querySelector('.main h1')?.textContent?.trim();
    try {
      const r = await kiFragen(verlauf, f, `${pfad}${seite ? ` (${seite})` : ''}`, {
        navigieren: (p) => navigate(p),
        schritt: setSchritt,
        bestaetigen: (titel, details) => new Promise((ok) => setFrage({ titel, details, antwort: (ja) => { setFrage(null); ok(ja); } })),
      });
      setVerlauf(r.verlauf);
      setMsgs((m) => [...m, { von: 'ki', text: r.antwort }]);
    } catch (e) {
      const t = kiFehlerText(e);
      if (t === 'KEIN_SCHLUESSEL') { setOhneSchluessel(true); setMsgs((m) => m.slice(0, -1)); setText(f); }
      else setMsgs((m) => [...m, { von: 'fehler', text: t }]);
    } finally { setLaeuft(false); setSchritt(''); }
  }

  async function schluesselSpeichern() {
    if (!neuerSchluessel.trim()) return;
    await kiSchluesselSpeichern(neuerSchluessel);
    setNeuerSchluessel(''); setOhneSchluessel(false);
  }

  return (
    <>
      <button className={'ki-fab' + (offen ? ' offen' : '')} title="KI-Assistent" onClick={() => setOffen(!offen)}>
        {offen ? <X size={22} /> : <Sparkles size={22} />}
      </button>
      {offen && (
        <section className="ki-panel" role="dialog" aria-label="KI-Assistent">
          <header className="ki-kopf">
            <Sparkles size={18} />
            <div className="grow"><b>KI-Assistent</b>{modell && <small>{modell}</small>}</div>
            {msgs.length > 0 && <button className="ki-icon" title="Neues Gespräch" disabled={laeuft} onClick={() => { setMsgs([]); setVerlauf([]); }}><RotateCcw size={16} /></button>}
            <button className="ki-icon" title="Schließen" onClick={() => setOffen(false)}><X size={18} /></button>
          </header>
          <div className="ki-liste" ref={liste}>
            {ohneSchluessel ? (
              <div className="ki-schluessel">
                <KeyRound size={22} />
                <p><b>API-Schlüssel fehlt.</b> Der Assistent nutzt Claude von Anthropic. Lege unter console.anthropic.com einen Schlüssel an und füge ihn hier ein. Er wird nur in der NEOSS-Datenbank auf diesem Rechner gespeichert.</p>
                <input type="password" placeholder="sk-ant-…" value={neuerSchluessel} onChange={(e) => setNeuerSchluessel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && schluesselSpeichern()} />
                <button className="primary" onClick={schluesselSpeichern} disabled={!neuerSchluessel.trim()}>Speichern</button>
              </div>
            ) : msgs.length === 0 ? (
              <div className="ki-start">
                <p>Hallo! Ich kenne die Daten in NEOSS und helfe dir bei Fragen, Auswertungen, Terminen und Aufgaben. Ändern oder löschen kann ich nichts.</p>
                {VORSCHLAEGE.map((v) => <button key={v} className="ki-vorschlag" onClick={() => senden(v)}>{v}</button>)}
              </div>
            ) : null}
            {msgs.map((m, i) => <div key={i} className={'ki-msg ' + m.von}>{m.von === 'ich' ? m.text : <Text t={m.text} />}</div>)}
            {frage && (
              <div className="ki-frage">
                <b>{frage.titel}</b>
                {frage.details.map((d, i) => <div key={i}>{d}</div>)}
                <div className="row"><button className="primary" onClick={() => frage.antwort(true)}><Check size={15} /> Ja, anlegen</button><button onClick={() => frage.antwort(false)}>Nein</button></div>
              </div>
            )}
            {laeuft && !frage && <div className="ki-msg ki denkt"><span className="ki-punkte"><i /><i /><i /></span>{schritt} …</div>}
          </div>
          <div className="ki-eingabe">
            <textarea ref={eingabe} rows={1} placeholder={ohneSchluessel ? 'Erst den API-Schlüssel eintragen' : 'Frag mich etwas …'} value={text} disabled={ohneSchluessel}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); senden(); } }} />
            <button className="primary" title="Senden" disabled={laeuft || !text.trim() || ohneSchluessel} onClick={() => senden()}><Send size={16} /></button>
          </div>
          <div className="ki-fuss">Antworten können Fehler enthalten. Die Fragen und gelesenen Daten werden zur Beantwortung an Anthropic übertragen.</div>
        </section>
      )}
    </>
  );
}
