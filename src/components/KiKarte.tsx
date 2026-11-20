// Einstellungen → KI-Agent: lokal auf diesem Mac (Ollama, Standard) oder Claude über das Internet; Stimme zum Vorlesen.
import { useEffect, useState } from 'react';
import { CheckCircle2, Download, Volume2, XCircle } from 'lucide-react';
import { KI_MODELLE, LOKAL_MODELLE, kiEinstellungen, kiEinstellungSpeichern, kiSchluesselSpeichern, lokalModellLaden, lokalStatus, type KiEinstellungen } from '../logic/kiAgent';
import { deutscheStimmen, sprechen } from '../logic/sprache';

export function KiKarte() {
  const [e, setE] = useState<KiEinstellungen | null>(null);
  const [schluessel, setSchluessel] = useState('');
  const [status, setStatus] = useState<{ laeuft: boolean; modelle: string[] } | null>(null);
  const [laden, setLaden] = useState<{ p: number; text: string } | null>(null);
  const [meldung, setMeldung] = useState('');
  const [stimmen, setStimmen] = useState<string[]>([]);

  async function pruefen(url?: string) { setStatus(await lokalStatus(url ?? e?.lokalUrl)); }
  useEffect(() => {
    // Nur in der App automatisch prüfen; in der Browser-Vorschau erst auf Knopfdruck (sonst Fehlermeldungen in der Konsole)
    kiEinstellungen().then((x) => { setE(x); if ('__TAURI_INTERNALS__' in window) lokalStatus(x.lokalUrl).then(setStatus); });
    const s = () => setStimmen(deutscheStimmen().map((v) => v.name));
    s(); if (typeof speechSynthesis !== 'undefined') speechSynthesis.addEventListener('voiceschanged', s);
    return () => { if (typeof speechSynthesis !== 'undefined') speechSynthesis.removeEventListener('voiceschanged', s); };
  }, []);
  if (!e) return null;
  const set = (x: Partial<KiEinstellungen>) => setE({ ...e, ...x });
  const geladen = status?.modelle.some((m) => m === e.lokalModell || m === `${e.lokalModell}:latest`);

  async function speichern() {
    if (!e) return;
    await kiEinstellungSpeichern(e);
    if (schluessel.trim()) { await kiSchluesselSpeichern(schluessel); set({ schluessel: schluessel.trim() }); setSchluessel(''); }
    setMeldung('Gespeichert'); setTimeout(() => setMeldung(''), 2000);
  }
  async function herunterladen() {
    if (!e) return;
    setLaden({ p: 0, text: 'Startet …' });
    try { await lokalModellLaden(e.lokalUrl, e.lokalModell, (p, text) => setLaden({ p, text })); await kiEinstellungSpeichern(e); setMeldung(`${e.lokalModell} ist geladen.`); }
    catch (x: any) { setMeldung('Herunterladen fehlgeschlagen: ' + (x?.message ?? x)); }
    finally { setLaden(null); pruefen(); }
  }

  return (
    <section className="card">
      <div className="card-head"><h2>KI-Agent</h2></div>
      <p className="muted" style={{ marginTop: 0 }}>Der KI-Agent (Knopf rechts unten) sucht Daten heraus, prüft Abrechnungen und gleicht die Bankkonten ab. Du kannst mit ihm schreiben oder sprechen.</p>
      <div className="seg" style={{ marginBottom: 12 }}>
        <button type="button" className={e.anbieter === 'lokal' ? 'on' : ''} onClick={() => set({ anbieter: 'lokal' })}>Lokal auf diesem Mac (empfohlen)</button>
        <button type="button" className={e.anbieter === 'claude' ? 'on' : ''} onClick={() => set({ anbieter: 'claude' })}>Claude über das Internet</button>
      </div>
      {e.anbieter === 'lokal' ? <>
        <p className="muted small" style={{ marginTop: 0 }}>Das KI-Modell läuft im Programm „Ollama“ auf diesem Mac. Es gibt keine API und keine Kosten, und keine Daten verlassen den Rechner. Ollama gibt es kostenlos unter ollama.com.</p>
        <p className="small">{status === null ? 'Ollama noch nicht geprüft.' : status.laeuft
          ? <span className="pos"><CheckCircle2 size={14} /> Ollama läuft{status.modelle.length ? `, geladene Modelle: ${status.modelle.join(', ')}` : ', aber noch kein Modell geladen'}.</span>
          : <span className="neg"><XCircle size={14} /> Ollama läuft nicht. Bitte installieren bzw. starten.</span>}
          {' '}<button className="small-btn" onClick={() => pruefen()}>Erneut prüfen</button></p>
        <div className="form">
          <label><span>Modell</span>
            <select value={LOKAL_MODELLE.some(([m]) => m === e.lokalModell) ? e.lokalModell : ''} onChange={(x) => x.target.value && set({ lokalModell: x.target.value })}>
              {LOKAL_MODELLE.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
              {!LOKAL_MODELLE.some(([m]) => m === e.lokalModell) && <option value="">Eigenes: {e.lokalModell}</option>}
            </select></label>
          <label><span>Oder eigener Modellname</span><input value={e.lokalModell} onChange={(x) => set({ lokalModell: x.target.value })} /></label>
        </div>
        {status?.laeuft && !geladen && !laden && <p><button onClick={herunterladen}><Download size={15} /> {e.lokalModell} herunterladen (einmalig, mehrere GB)</button></p>}
        {laden && <p className="small">Lädt {e.lokalModell}: {laden.p} % <span className="muted">({laden.text})</span></p>}
      </> : <>
        <p className="muted small" style={{ marginTop: 0 }}>Claude von Anthropic ist stärker, läuft aber über das Internet: Fragen und die dafür gelesenen Daten werden an Anthropic übertragen. Abgerechnet wird nach Verbrauch über dein Anthropic-Konto (console.anthropic.com).</p>
        <div className="form">
          <label className="wide"><span>API-Schlüssel {e.schluessel ? '(hinterlegt, zum Ändern neu eingeben)' : '(noch keiner hinterlegt)'}</span>
            <input type="password" placeholder={e.schluessel ? '••••••••••••' : 'sk-ant-…'} value={schluessel} onChange={(x) => setSchluessel(x.target.value)} /></label>
          <label><span>Modell</span>
            <select value={e.modell} onChange={(x) => set({ modell: x.target.value })}>{KI_MODELLE.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select></label>
        </div>
        {e.schluessel && <p><button onClick={async () => { await kiSchluesselSpeichern(''); set({ schluessel: '' }); }}>Schlüssel entfernen</button></p>}
      </>}
      <div className="form">
        <label><span>Stimme zum Vorlesen</span>
          <select value={e.stimme} onChange={(x) => set({ stimme: x.target.value })}>
            <option value="">Automatisch (beste deutsche Stimme)</option>
            {stimmen.map((s) => <option key={s} value={s}>{s}</option>)}
          </select></label>
        <label className="inline" style={{ alignSelf: 'end' }}><input type="checkbox" checked={e.vorlesen} onChange={(x) => set({ vorlesen: x.target.checked })} /> Antworten immer vorlesen</label>
      </div>
      <p className="muted small">Schönere Stimmen: Systemeinstellungen → Bedienungshilfen → Gesprochene Inhalte → Systemstimme → Stimmen verwalten, dort eine deutsche Stimme in „Premium“ laden (zum Beispiel Anna).</p>
      <div className="row end"><button onClick={() => sprechen('Hallo, ich bin der KI-Agent von NEOSS. So klinge ich.', e.stimme)}><Volume2 size={15} /> Stimme testen</button><span className="grow" />
        {meldung && <span className={meldung.startsWith('Herunterladen') ? 'neg' : 'pos'}>{meldung}</span>}<button className="primary" onClick={speichern}>Speichern</button></div>
    </section>
  );
}
