// Bankabruf per FinTS mit Freigabe in der Banking-App (pushTAN). Nur in der installierten App.
import { useEffect, useRef, useState } from 'react';
import { Landmark, ShieldCheck, X } from 'lucide-react';
import { db, type Row } from '../db';
import { eur, datum } from './EntityTable';
import { automatischZuordnen, importieren, type Umsatz } from '../logic/bank';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
type Phase = 'eingabe' | 'freigabe' | 'fertig';
type Abruf = { wartet: boolean; umsaetze: (Umsatz & { vorgemerkt: boolean })[]; saldo: number | null; saldo_datum: string | null };

export function BankAbruf({ konto, onDone }: { konto: Row; onDone: (info: string) => void }) {
  const [offen, setOffen] = useState(false);
  const [benutzer, setBenutzer] = useState(konto.fints_benutzer ?? '');
  const [pin, setPin] = useState('');
  const [tage, setTage] = useState(360);
  const [phase, setPhase] = useState<Phase>('eingabe');
  const [text, setText] = useState('');
  const [fehler, setFehler] = useState('');
  const [produktId, setProduktId] = useState('');
  const stop = useRef(false);

  useEffect(() => { setBenutzer(konto.fints_benutzer ?? ''); }, [konto.id]);
  useEffect(() => {
    db.select(`SELECT wert FROM einstellungen WHERE schluessel = 'fints_produkt_id'`).then((r) => setProduktId(String(r[0]?.wert ?? '').trim()));
  }, [offen]);

  const iban = String(konto.iban ?? '').replace(/\s/g, '').toUpperCase();
  const blz = iban.startsWith('DE') && iban.length === 22 ? iban.slice(4, 12) : '';

  async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(cmd, args);
  }

  function schliessen() {
    stop.current = true;
    if (isTauri) invoke('bank_abbrechen', {}).catch(() => {});
    setOffen(false); setPin(''); setPhase('eingabe'); setFehler(''); setText('');
  }

  async function starten() {
    setFehler('');
    if (!produktId) { setFehler('Bitte zuerst unter Einstellungen die FinTS-Produkt-ID eintragen (kostenlos bei fints.org registrieren).'); return; }
    if (!blz) { setFehler('Für den Abruf braucht das Bankkonto eine deutsche IBAN (Banken & Konten).'); return; }
    if (!benutzer.trim() || !pin) { setFehler('Bitte Anmeldename (Benutzerkennung) und PIN des Online-Bankings eingeben.'); return; }
    try {
      await db.execute('UPDATE bankkonten SET fints_benutzer = $1 WHERE id = $2', [benutzer.trim(), konto.id]);
      const s = await invoke<{ text: string; freigabe_in_app: boolean; ohne_tan: boolean }>('bank_start',
        { blz, benutzer: benutzer.trim(), pin, produktId, iban, bic: String(konto.bic ?? '').trim() });
      setPin('');
      setText(s.ohne_tan ? 'Die Bank verlangt für diesen Abruf keine Freigabe.' : s.text || 'Bitte den Abruf in deiner Banking-App freigeben.');
      setPhase('freigabe');
      stop.current = false;
      abholen();
    } catch (e: any) { setPin(''); setFehler(String(e?.message ?? e)); }
  }

  async function abholen() {
    const ende = Date.now() + 5 * 60 * 1000;
    while (!stop.current && Date.now() < ende) {
      try {
        const r = await invoke<Abruf>('bank_abholen', { iban, bic: String(konto.bic ?? '').trim(), tage });
        if (r.wartet) { await new Promise((ok) => setTimeout(ok, 3000)); continue; }
        const gebucht = r.umsaetze.filter((u) => !u.vorgemerkt && u.betrag !== 0);
        const imp = await importieren(konto.id, gebucht.map(({ vorgemerkt: _v, ...u }) => u));
        const a = await automatischZuordnen();
        setPhase('fertig');
        const saldo = r.saldo != null ? ` Kontostand laut Bank: ${eur(r.saldo)}${r.saldo_datum ? ` (${datum(r.saldo_datum)})` : ''}.` : '';
        const msg = `${imp.neu} neue Umsätze von der Bank abgerufen${imp.doppelt ? `, ${imp.doppelt} waren schon vorhanden` : ''}. ${a.zugeordnet} automatisch zugeordnet, ${a.pruefen} zum Prüfen.${saldo}`;
        setText(msg); onDone(msg);
        return;
      } catch (e: any) { setFehler(String(e?.message ?? e)); setPhase('eingabe'); return; }
    }
    if (!stop.current) { setFehler('Keine Freigabe innerhalb von 5 Minuten. Bitte erneut starten.'); setPhase('eingabe'); invoke('bank_abbrechen', {}).catch(() => {}); }
  }

  return (
    <>
      <button className="primary" onClick={() => setOffen(true)} disabled={!isTauri} title={isTauri ? '' : 'Nur in der installierten App'}>
        <Landmark size={16} />Bei der Bank abrufen</button>
      {offen && (
        <div className="modal-bg" onClick={schliessen}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="card-head"><h3 className="title-ico"><ShieldCheck size={22} />Umsätze bei der Bank abrufen</h3><button className="icon-btn" onClick={schliessen}><X size={18} /></button></div>
            <p className="muted">{konto.name}{konto.bank ? ` · ${konto.bank}` : ''} · {iban || 'keine IBAN'}</p>
            {phase === 'eingabe' && (
              <div className="form">
                <label><span>Anmeldename / Benutzerkennung</span><input value={benutzer} autoComplete="username" onChange={(e) => setBenutzer(e.target.value)} /></label>
                <label><span>PIN (wird nicht gespeichert)</span><input type="password" value={pin} autoComplete="current-password" onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && starten()} /></label>
                <label><span>Zeitraum rückwirkend (Tage)</span><input type="number" min={1} max={730} value={tage} onChange={(e) => setTage(Math.max(1, Math.min(730, Number(e.target.value) || 360)))} /></label>
              </div>)}
            {phase === 'freigabe' && <div className="info"><b>Bitte jetzt in deiner Banking-App freigeben.</b><br />{text}<br /><span className="muted small">Wir warten bis zu 5 Minuten auf die Freigabe.</span></div>}
            {phase === 'fertig' && <p className="info">{text}</p>}
            {fehler && <p className="error">{fehler}</p>}
            <p className="muted small">Die Verbindung geht direkt von diesem Rechner zu deiner Bank (FinTS). Viele Banken geben ältere Umsätze als 90 Tage nur mit Freigabe heraus, manche gar nicht.</p>
            <div className="row end">
              <span className="grow" />
              <button onClick={schliessen}>{phase === 'fertig' ? 'Schließen' : 'Abbrechen'}</button>
              {phase === 'eingabe' && <button className="primary" onClick={starten}>Abruf starten</button>}
            </div>
          </div>
        </div>)}
    </>
  );
}
