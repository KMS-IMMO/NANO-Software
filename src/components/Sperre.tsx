// Anmeldung mit App-Passwort, automatische Sperre nach Inaktivität.
// Ohne Passwort lässt sich die verschlüsselte Datenbank nicht öffnen.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Eye, EyeOff, Lock, Server, ShieldCheck } from 'lucide-react';
import { ABGEMELDET, db, mehrplatz, sicherheit } from '../db';
import { Logo } from './Logo';

type Phase = 'laden' | 'neu' | 'login' | 'server' | 'offen';
export const SPERREN = 'nano-sperren';

export function Sperre({ children }: { children: ReactNode }) {
  const vorschau = !sicherheit.aktiv && location.hash.startsWith('#/sperre-vorschau');
  const [phase, setPhase] = useState<Phase>(mehrplatz.aktiv ? 'server' : sicherheit.aktiv ? 'laden' : vorschau ? 'neu' : 'offen');
  const [alteDaten, setAlteDaten] = useState(false);
  const letzte = useRef(Date.now());

  // Server hat die Sitzung beendet (abgelaufen, Benutzer gesperrt): neu anmelden
  useEffect(() => { const f = () => setPhase(mehrplatz.aktiv ? 'server' : 'login'); window.addEventListener(ABGEMELDET, f); return () => window.removeEventListener(ABGEMELDET, f); }, []);
  useEffect(() => {
    if (!sicherheit.aktiv || mehrplatz.aktiv) return;
    sicherheit.status().then((s) => {
      setAlteDaten(s.alte_daten);
      setPhase(s.eingerichtet ? 'login' : 'neu');
    }).catch(() => setPhase('login'));
  }, []);

  // Automatische Sperre: nach X Minuten ohne Maus/Tastatur (Einstellung, Standard 15, 0 = aus)
  useEffect(() => {
    if (phase !== 'offen' || !(sicherheit.aktiv || mehrplatz.aktiv)) return;
    let minuten = 15;
    db.select(`SELECT wert FROM einstellungen WHERE schluessel = 'sperre_minuten'`).then((r) => {
      const v = Number(r[0]?.wert); if (r[0]?.wert != null && r[0].wert !== '' && !Number.isNaN(v)) minuten = v;
    }).catch(() => {});
    const aktiv = () => { letzte.current = Date.now(); };
    const sperren = async () => {
      if (mehrplatz.aktiv) { await mehrplatz.abmelden(); setPhase('server'); return; }
      await sicherheit.sperren().catch(() => {}); setPhase('login');
    };
    const t = setInterval(() => { if (minuten > 0 && Date.now() - letzte.current > minuten * 60000) sperren(); }, 20000);
    const ereignisse = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'];
    ereignisse.forEach((e) => window.addEventListener(e, aktiv, { passive: true }));
    window.addEventListener(SPERREN, sperren);
    return () => { clearInterval(t); ereignisse.forEach((e) => window.removeEventListener(e, aktiv)); window.removeEventListener(SPERREN, sperren); };
  }, [phase]);

  if (phase === 'offen') return <>{children}</>;
  if (phase === 'server') return <ServerAnmeldung onOk={() => { letzte.current = Date.now(); setPhase('offen'); }}
    onLokal={() => { mehrplatz.einstellen(null); setPhase(sicherheit.aktiv ? 'laden' : 'offen'); if (sicherheit.aktiv) location.reload(); }} />;
  if (phase === 'laden') return <div className="sperre"><div className="sperre-karte"><Logo /></div></div>;
  return <Anmeldung neu={phase === 'neu'} alteDaten={alteDaten} vorschau={vorschau}
    onOk={() => { letzte.current = Date.now(); setPhase('offen'); }} />;
}

function Anmeldung({ neu, alteDaten, vorschau, onOk }: { neu: boolean; alteDaten: boolean; vorschau: boolean; onOk: () => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [zeigen, setZeigen] = useState(false);
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);
  const [verstanden, setVerstanden] = useState(false);

  async function los() {
    setFehler('');
    if (neu) {
      if (pw.length < 8) { setFehler('Das Passwort muss mindestens 8 Zeichen haben.'); return; }
      if (pw !== pw2) { setFehler('Die beiden Passwörter stimmen nicht überein.'); return; }
      if (!verstanden) { setFehler('Bitte bestätige, dass du das Passwort sicher aufbewahrst.'); return; }
    }
    if (vorschau) { setFehler('Vorschau: In der installierten App wird hier die Datenbank entschlüsselt.'); return; }
    setBusy(true);
    try { await sicherheit.entsperren(pw, neu); setPw(''); setPw2(''); onOk(); }
    catch (e: any) { setFehler(String(e?.message ?? e)); setPw(''); }
    finally { setBusy(false); }
  }

  const staerke = pw.length >= 14 && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw) ? 'stark' : pw.length >= 10 ? 'mittel' : pw.length ? 'schwach' : '';
  return (
    <div className="sperre">
      <form className="sperre-karte" onSubmit={(e) => { e.preventDefault(); los(); }}>
        <Logo />
        <h2 className="title-ico">{neu ? <ShieldCheck size={24} /> : <Lock size={22} />}{neu ? 'App-Passwort festlegen' : 'Anmelden'}</h2>
        <p className="muted">{neu
          ? `Mit diesem Passwort werden alle Daten auf diesem Rechner verschlüsselt.${alteDaten ? ' Deine bisherigen Daten werden dabei übernommen.' : ''}`
          : 'Bitte gib dein App-Passwort ein, um die verschlüsselten Daten zu öffnen.'}</p>
        <label><span>Passwort</span>
          <div className="pw"><input type={zeigen ? 'text' : 'password'} value={pw} autoFocus autoComplete={neu ? 'new-password' : 'current-password'} onChange={(e) => setPw(e.target.value)} />
            <button type="button" className="icon-btn" title={zeigen ? 'Verbergen' : 'Anzeigen'} onClick={() => setZeigen(!zeigen)}>{zeigen ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
        {neu && <>
          {staerke && <div className={'staerke ' + staerke}><i /><span>{staerke === 'stark' ? 'Starkes Passwort' : staerke === 'mittel' ? 'Mittel: länger oder mit Zahlen und Sonderzeichen ist besser' : 'Zu schwach'}</span></div>}
          <label><span>Passwort wiederholen</span><input type={zeigen ? 'text' : 'password'} value={pw2} autoComplete="new-password" onChange={(e) => setPw2(e.target.value)} /></label>
          <label className="check"><input type="checkbox" checked={verstanden} onChange={(e) => setVerstanden(e.target.checked)} />
            <span>Ich habe verstanden: Ohne dieses Passwort lassen sich die Daten und Sicherungen <b>nicht</b> wiederherstellen. Ich bewahre es sicher auf.</span></label>
        </>}
        {fehler && <p className="error">{fehler}</p>}
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Bitte warten …' : neu ? 'Passwort festlegen und starten' : 'Entsperren'}</button>
        <p className="muted small">Die App sperrt sich nach einiger Zeit ohne Eingabe automatisch. Einstellbar unter Einstellungen → Sicherheit.</p>
      </form>
    </div>
  );
}

/** Anmeldung am NEOSS-Server (Mehrplatz) mit Benutzername und Passwort */
function ServerAnmeldung({ onOk, onLokal }: { onOk: () => void; onLokal: () => void }) {
  const [login, setLogin] = useState(() => { try { return localStorage.getItem('nano-login') ?? ''; } catch { return ''; } });
  const [pw, setPw] = useState('');
  const [zeigen, setZeigen] = useState(false);
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);
  const [adresse, setAdresse] = useState(mehrplatz.adresse() ?? '');
  const [aendern, setAendern] = useState(false);
  async function los() {
    setFehler(''); setBusy(true);
    try {
      if (aendern) { await mehrplatz.testen(adresse); mehrplatz.einstellen(adresse); setAendern(false); }
      await mehrplatz.anmelden(login.trim(), pw);
      try { localStorage.setItem('nano-login', login.trim()); } catch { /* egal */ }
      setPw(''); onOk();
    } catch (e: any) { setFehler(String(e?.message ?? e)); setPw(''); }
    finally { setBusy(false); }
  }
  return (
    <div className="sperre">
      <form className="sperre-karte" onSubmit={(e) => { e.preventDefault(); los(); }}>
        <Logo />
        <h2 className="title-ico"><Server size={22} />Anmelden</h2>
        <p className="muted">Mit deinem NEOSS-Zugang am Server {aendern ? '' : <b>{mehrplatz.adresse()}</b>} anmelden.</p>
        {aendern && <label><span>Serveradresse</span><input value={adresse} onChange={(e) => setAdresse(e.target.value)} placeholder="z. B. 192.168.178.20" /></label>}
        <label><span>Benutzername</span><input value={login} autoFocus={!login} autoComplete="username" onChange={(e) => setLogin(e.target.value)} /></label>
        <label><span>Passwort</span>
          <div className="pw"><input type={zeigen ? 'text' : 'password'} value={pw} autoFocus={!!login} autoComplete="current-password" onChange={(e) => setPw(e.target.value)} />
            <button type="button" className="icon-btn" title={zeigen ? 'Verbergen' : 'Anzeigen'} onClick={() => setZeigen(!zeigen)}>{zeigen ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
        {fehler && <p className="error">{fehler}</p>}
        <button className="primary" type="submit" disabled={busy || !login.trim() || !pw}>{busy ? 'Bitte warten …' : 'Anmelden'}</button>
        <p className="muted small">
          <button type="button" className="link" onClick={() => setAendern(!aendern)}>Serveradresse ändern</button>{' · '}
          <button type="button" className="link" onClick={() => { if (confirm('Ohne Server mit den Daten auf diesem Rechner arbeiten?')) onLokal(); }}>Ohne Server arbeiten</button>
        </p>
      </form>
    </div>
  );
}
