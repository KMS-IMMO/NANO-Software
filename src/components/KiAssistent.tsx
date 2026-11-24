// KI-Agent: runder Knopf rechts unten auf jeder Seite, öffnet ein Gesprächsfenster.
// Tippen oder sprechen: Das Mikrofon nimmt die Frage auf, die Antwort wird mit einer deutschen Stimme von macOS vorgelesen.
// Im Gesprächsmodus hört der Agent nach seiner Antwort gleich wieder zu, wie bei einem Telefonat.
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, KeyRound, Mic, MicOff, RotateCcw, Send, Sparkles, Square, Volume2, VolumeX, X } from 'lucide-react';
import { kiEinstellungen, kiEinstellungSpeichern, kiFehlerText, kiFragen, kiSchluesselSpeichern, KI_MODELLE, neuerVerlauf, type KiEinstellungen, type Verlauf } from '../logic/kiAgent';
import { erkennungMoeglich, Hoeren, sprechen, stillsein } from '../logic/sprache';

type Nachricht = { von: 'ich' | 'ki' | 'fehler'; text: string };
type Frage = { titel: string; details: string[]; antwort: (ja: boolean) => void };

const VORSCHLAEGE = [
  'Prüf bitte die Hausgeldabrechnung vom letzten Jahr',
  'Stimmen Anfangs- und Endbestand der Bankkonten, und ist alles gebucht?',
  'Wer ist mit dem Hausgeld im Rückstand?',
  'Welche Rechnungen sind noch nicht bezahlt?',
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
  const [verlauf, setVerlauf] = useState<Verlauf>(neuerVerlauf());
  const [text, setText] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [schritt, setSchritt] = useState('');
  const [frage, setFrage] = useState<Frage | null>(null);
  const [ein, setEin] = useState<KiEinstellungen | null>(null);
  const [neuerSchluessel, setNeuerSchluessel] = useState('');
  const [hoert, setHoert] = useState(false);
  const [spricht, setSpricht] = useState(false);
  const [gespraech, setGespraech] = useState(false);   // nach jeder Antwort wieder zuhören
  const [diktatTipp, setDiktatTipp] = useState(false);
  const liste = useRef<HTMLDivElement>(null);
  const eingabe = useRef<HTMLTextAreaElement>(null);
  const hoeren = useRef<Hoeren | null>(null);
  const gespraechRef = useRef(false); gespraechRef.current = gespraech;
  const navigate = useNavigate();
  const pfad = useLocation().pathname;
  const ohneSchluessel = ein?.anbieter === 'claude' && !ein.schluessel;

  useEffect(() => { if (offen) kiEinstellungen().then((e) => { setEin(e); setTimeout(() => eingabe.current?.focus(), 50); }); else { beenden(); } }, [offen]);
  useEffect(() => { liste.current?.scrollTo({ top: liste.current.scrollHeight, behavior: 'smooth' }); }, [msgs, laeuft, frage, hoert]);
  useEffect(() => () => beenden(), []);

  function beenden() { hoeren.current?.stop(); hoeren.current = null; stillsein(); setHoert(false); setSpricht(false); setGespraech(false); }

  async function vorlesen(t: string, danachHoeren: boolean) {
    if (!ein) return;
    setSpricht(true);
    await sprechen(t, ein.stimme);
    setSpricht(false);
    if (danachHoeren && gespraechRef.current) zuhoeren(true);
  }

  async function senden(t = text, gesprochen = false) {
    const f = t.trim();
    if (!f || laeuft) return;
    stillsein();
    setText(''); setMsgs((m) => [...m, { von: 'ich', text: f }]); setLaeuft(true); setSchritt('Denkt nach');
    const seite = document.querySelector('.main h1')?.textContent?.trim();
    try {
      const r = await kiFragen(verlauf, f, `${pfad}${seite ? ` (${seite})` : ''}`, {
        navigieren: (p) => navigate(p),
        schritt: setSchritt,
        bestaetigen: (titel, details) => new Promise((ok) => setFrage({ titel, details, antwort: (ja) => { setFrage(null); ok(ja); } })),
      }, { gesprochen });
      setVerlauf(r.verlauf);
      setMsgs((m) => [...m, { von: 'ki', text: r.antwort }]);
      if (gesprochen || ein?.vorlesen) vorlesen(r.antwort, gesprochen);
    } catch (e) {
      const t = kiFehlerText(e);
      if (t === 'KEIN_SCHLUESSEL') { setEin((x) => x && { ...x, schluessel: '' }); setMsgs((m) => m.slice(0, -1)); setText(f); }
      else { setMsgs((m) => [...m, { von: 'fehler', text: t }]); setGespraech(false); }
    } finally { setLaeuft(false); setSchritt(''); }
  }

  /** Mikrofon: Frage aufnehmen und gleich schicken. Ohne Spracherkennung im Programm hilft die Diktierfunktion von macOS. */
  function zuhoeren(imGespraech = gespraech) {
    if (hoert) { hoeren.current?.stop(); return; }
    stillsein(); setSpricht(false);
    if (!erkennungMoeglich()) { setDiktatTipp(true); eingabe.current?.focus(); return; }
    const h = new Hoeren({
      zwischen: (t) => setText(t),
      fertig: (t) => { setHoert(false); hoeren.current = null; if (t.trim()) senden(t, true); else if (imGespraech) setGespraech(false); },
      fehler: (grund) => { setHoert(false); hoeren.current = null; setGespraech(false); if (grund === 'nicht-erlaubt' || grund === 'nicht-verfuegbar') { setDiktatTipp(true); eingabe.current?.focus(); } },
    });
    hoeren.current = h; setHoert(true); h.start();
  }

  async function schluesselSpeichern() {
    if (!neuerSchluessel.trim()) return;
    await kiSchluesselSpeichern(neuerSchluessel);
    setNeuerSchluessel(''); setEin(await kiEinstellungen());
  }
  async function vorlesenUmschalten() {
    if (!ein) return;
    const v = !ein.vorlesen; await kiEinstellungSpeichern({ vorlesen: v }); setEin({ ...ein, vorlesen: v }); if (!v) { stillsein(); setSpricht(false); }
  }

  const modellName = !ein ? '' : ein.anbieter === 'claude' ? (KI_MODELLE.find(([m]) => m === ein.modell)?.[1].split(' (')[0] ?? ein.modell) + ' · über Internet' : `${ein.lokalModell} · lokal auf diesem Mac`;

  return (
    <>
      <button className={'ki-fab' + (offen ? ' offen' : '')} title="KI-Agent" onClick={() => setOffen(!offen)}>
        {offen ? <X size={22} /> : <Sparkles size={22} />}
      </button>
      {offen && (
        <section className="ki-panel" role="dialog" aria-label="KI-Agent">
          <header className="ki-kopf">
            <Sparkles size={18} />
            <div className="grow"><b>KI-Agent</b>{modellName && <small>{modellName}</small>}</div>
            <button className="ki-icon" title={ein?.vorlesen ? 'Antworten nicht mehr vorlesen' : 'Antworten immer vorlesen'} onClick={vorlesenUmschalten}>{ein?.vorlesen ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>
            {msgs.length > 0 && <button className="ki-icon" title="Neues Gespräch" disabled={laeuft} onClick={() => { beenden(); setMsgs([]); setVerlauf(neuerVerlauf()); }}><RotateCcw size={16} /></button>}
            <button className="ki-icon" title="Schließen" onClick={() => setOffen(false)}><X size={18} /></button>
          </header>
          <div className="ki-liste" ref={liste}>
            {ohneSchluessel ? (
              <div className="ki-schluessel">
                <KeyRound size={22} />
                <p><b>API-Schlüssel fehlt.</b> In den Einstellungen ist Claude (über das Internet) eingeschaltet. Füge hier einen Schlüssel von console.anthropic.com ein, oder stelle unter Einstellungen → KI-Agent wieder auf „Lokal auf diesem Mac“ um.</p>
                <input type="password" placeholder="sk-ant-…" value={neuerSchluessel} onChange={(e) => setNeuerSchluessel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && schluesselSpeichern()} />
                <button className="primary" onClick={schluesselSpeichern} disabled={!neuerSchluessel.trim()}>Speichern</button>
              </div>
            ) : msgs.length === 0 ? (
              <div className="ki-start">
                <p>Hallo! Frag mich einfach, wie du einen Kollegen fragen würdest. Ich suche Daten heraus, prüfe Abrechnungen und gleiche die Bankkonten ab. Tippe oder drück auf das Mikrofon und sprich. Ändern oder löschen kann ich nichts.</p>
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
            {hoert && <div className="ki-msg ki denkt ki-hoert"><span className="ki-welle"><i /><i /><i /><i /></span>Ich höre zu …</div>}
            {spricht && <div className="ki-spricht"><Volume2 size={14} /> spricht … <button className="small-btn" onClick={() => { stillsein(); setSpricht(false); setGespraech(false); }}><Square size={12} /> Stopp</button></div>}
            {diktatTipp && <div className="ki-msg ki ki-tipp"><p><b>Sprechen über die Diktierfunktion von macOS:</b> Drück zweimal kurz die Taste <b>fn</b> (oder 🌐) und sprich. Der Text erscheint im Eingabefeld, dann Enter drücken.</p><p className="muted small">Falls nichts passiert: Systemeinstellungen → Tastatur → Diktieren einschalten.</p><button className="small-btn" onClick={() => setDiktatTipp(false)}>Verstanden</button></div>}
          </div>
          <div className="ki-eingabe">
            <button className={'ki-mic' + (hoert ? ' an' : '')} title={hoert ? 'Zuhören beenden' : 'Sprechen'} disabled={laeuft || ohneSchluessel} onClick={() => zuhoeren()}>{hoert ? <MicOff size={17} /> : <Mic size={17} />}</button>
            <textarea ref={eingabe} rows={1} placeholder={ohneSchluessel ? 'Erst den API-Schlüssel eintragen' : hoert ? 'Ich höre zu …' : 'Frag mich etwas …'} value={text} disabled={ohneSchluessel}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); senden(); } }} />
            <button className="primary" title="Senden" disabled={laeuft || !text.trim() || ohneSchluessel} onClick={() => senden()}><Send size={16} /></button>
          </div>
          <div className="ki-fuss">
            <label className="ki-gespraech"><input type="checkbox" checked={gespraech} onChange={(e) => { setGespraech(e.target.checked); if (e.target.checked && !hoert && !laeuft) zuhoeren(true); if (!e.target.checked) { hoeren.current?.stop(); stillsein(); } }} /> Gesprächsmodus (nach jeder Antwort wieder zuhören)</label>
            <span>{ein?.anbieter === 'claude' ? 'Antworten können Fehler enthalten. Fragen und gelesene Daten gehen zur Beantwortung an Anthropic.' : 'Antworten können Fehler enthalten. Alles bleibt auf diesem Mac, nichts geht ins Internet.'}</span>
          </div>
        </section>
      )}
    </>
  );
}
