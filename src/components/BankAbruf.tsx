// Bankabruf per FinTS mit Freigabe in der Banking-App (pushTAN). Nur in der installierten App.
// Auf Wunsch bleibt die Verbindung bestehen: PIN im Schlüsselbund, automatischer Abruf beim Start.
import { useEffect, useRef, useState } from 'react';
import { KeyRound, Landmark, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { db, type Row } from '../db';
import { abholen, invoke, isTauri, kontoIban, pinGespeichert, produktId, starten } from '../logic/bankAbruf';

type Phase = 'eingabe' | 'freigabe' | 'fertig';

export function BankAbruf({ konto, onDone }: { konto: Row; onDone: (info: string) => void }) {
  const [offen, setOffen] = useState(false);
  const [benutzer, setBenutzer] = useState(konto.fints_benutzer ?? '');
  const [pin, setPin] = useState('');
  const [merken, setMerken] = useState(true);
  const [gespeichert, setGespeichert] = useState(false);
  const [tage, setTage] = useState(360);
  const [phase, setPhase] = useState<Phase>('eingabe');
  const [text, setText] = useState('');
  const [fehler, setFehler] = useState('');
  const [pid, setPid] = useState('');
  const stop = useRef(false);

  const pruefen = () => pinGespeichert(konto.id).then(setGespeichert);
  useEffect(() => { setBenutzer(konto.fints_benutzer ?? ''); pruefen(); }, [konto.id]);
  useEffect(() => { produktId().then(setPid); }, [offen]);

  function schliessen() {
    stop.current = true;
    if (isTauri()) invoke('bank_abbrechen').catch(() => {});
    setOffen(false); setPin(''); setPhase('eingabe'); setFehler(''); setText('');
  }

  async function los(mitGespeicherterPin: boolean) {
    setFehler('');
    if (!pid) { setFehler('Bitte zuerst unter Einstellungen die FinTS-Produkt-ID eintragen (kostenlos bei fints.org registrieren).'); return; }
    if (!mitGespeicherterPin && (!benutzer.trim() || !pin)) { setFehler('Bitte Anmeldename (Benutzerkennung) und PIN des Online-Bankings eingeben.'); return; }
    try {
      await db.execute('UPDATE bankkonten SET fints_benutzer = $1 WHERE id = $2', [benutzer.trim(), konto.id]);
      const k = { ...konto, fints_benutzer: benutzer.trim() };
      const s = await starten(k, mitGespeicherterPin ? {} : { pin, merken });
      setPin('');
      if (!mitGespeicherterPin && merken) { await db.execute('UPDATE bankkonten SET auto_abruf = 1 WHERE id = $1', [konto.id]); pruefen(); }
      setText(s.ohne_tan ? 'Die Bank verlangt für diesen Abruf keine Freigabe.' : s.text || 'Bitte den Abruf in deiner Banking-App freigeben.');
      setPhase('freigabe');
      stop.current = false;
      const msg = await abholen(k, tage, () => stop.current);
      if (msg) { setPhase('fertig'); setText(msg); onDone(msg); }
      else if (!stop.current) { setFehler('Keine Freigabe innerhalb von 5 Minuten. Bitte erneut starten.'); setPhase('eingabe'); }
    } catch (e: any) { setPin(''); setFehler(String(e?.message ?? e)); setPhase('eingabe'); }
  }

  async function trennen() {
    await invoke('bank_pin_loeschen', { konto: konto.id }).catch(() => {});
    await db.execute('UPDATE bankkonten SET auto_abruf = 0, abruf_hinweis = NULL WHERE id = $1', [konto.id]);
    setGespeichert(false); onDone('Die Verbindung wurde getrennt und die PIN aus dem Schlüsselbund entfernt.');
  }

  async function autoUmschalten(an: boolean) {
    await db.execute('UPDATE bankkonten SET auto_abruf = $1 WHERE id = $2', [an ? 1 : 0, konto.id]);
    onDone(an ? 'Automatischer Abruf beim Start ist eingeschaltet.' : 'Automatischer Abruf beim Start ist ausgeschaltet.');
  }

  const iban = kontoIban(konto);
  return (
    <>
      <button className="primary" onClick={() => setOffen(true)} disabled={!isTauri()} title={isTauri() ? '' : 'Nur in der installierten App'}>
        <Landmark size={16} />{gespeichert ? 'Bankverbindung' : 'Bei der Bank abrufen'}</button>
      {offen && (
        <div className="modal-bg" onClick={schliessen}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="card-head"><h3 className="title-ico"><ShieldCheck size={22} />Umsätze bei der Bank abrufen</h3><button className="icon-btn" onClick={schliessen}><X size={18} /></button></div>
            <p className="muted">{konto.name}{konto.bank ? ` · ${konto.bank}` : ''} · {iban || 'keine IBAN'}</p>
            {phase === 'eingabe' && gespeichert && (
              <div className="bank-verbunden">
                <div className="row"><KeyRound size={18} /><b className="grow">Verbunden: PIN liegt sicher im Schlüsselbund</b>
                  <button className="primary" onClick={() => los(true)}><RefreshCw size={15} />Jetzt abrufen</button></div>
                <label className="check"><input type="checkbox" checked={!!konto.auto_abruf} onChange={(e) => autoUmschalten(e.target.checked)} />Beim Start der App automatisch abrufen (ohne Freigabe, solange die Bank es erlaubt)</label>
                {konto.letzter_abruf && <p className="muted small">Letzter Abruf: {new Date(String(konto.letzter_abruf).replace(' ', 'T')).toLocaleString('de-DE')}</p>}
                {konto.abruf_hinweis && <p className="warn">{konto.abruf_hinweis}</p>}
                <label><span>Zeitraum rückwirkend (Tage)</span><input type="number" min={1} max={730} value={tage} onChange={(e) => setTage(Math.max(1, Math.min(730, Number(e.target.value) || 360)))} /></label>
                <button className="link small" onClick={trennen}>Verbindung trennen und PIN löschen</button>
              </div>)}
            {phase === 'eingabe' && !gespeichert && (
              <div className="form">
                <label><span>Anmeldename / Benutzerkennung</span><input value={benutzer} autoComplete="username" onChange={(e) => setBenutzer(e.target.value)} /></label>
                <label><span>PIN</span><input type="password" value={pin} autoComplete="current-password" onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && los(false)} /></label>
                <label><span>Zeitraum rückwirkend (Tage)</span><input type="number" min={1} max={730} value={tage} onChange={(e) => setTage(Math.max(1, Math.min(730, Number(e.target.value) || 360)))} /></label>
                <label className="check wide"><input type="checkbox" checked={merken} onChange={(e) => setMerken(e.target.checked)} />
                  Verbunden bleiben: PIN verschlüsselt im Schlüsselbund dieses Rechners speichern und beim Start automatisch abrufen</label>
              </div>)}
            {phase === 'freigabe' && <div className="info"><b>Bitte jetzt in deiner Banking-App freigeben.</b><br />{text}<br /><span className="muted small">Wir warten bis zu 5 Minuten auf die Freigabe.</span></div>}
            {phase === 'fertig' && <p className="info">{text}</p>}
            {fehler && <p className="error">{fehler}</p>}
            <p className="muted small">Die Verbindung geht direkt von diesem Rechner zu deiner Bank (FinTS). Die PIN steht nie in der Datenbank, sondern nur im Schlüsselbund des Rechners. Nach den PSD2-Regeln verlangt die Bank etwa alle 90 Tage wieder eine Freigabe in der Banking-App. Dazwischen ruft die App ohne Freigabe ab, sofern die Bank das erlaubt.</p>
            <div className="row end">
              <span className="grow" />
              <button onClick={schliessen}>{phase === 'fertig' ? 'Schließen' : 'Abbrechen'}</button>
              {phase === 'eingabe' && !gespeichert && <button className="primary" onClick={() => los(false)}>Abruf starten</button>}
            </div>
          </div>
        </div>)}
    </>
  );
}
