// Einstellungen → Mehrplatz: NANO-Server verbinden, Daten übertragen, Benutzer und Protokoll verwalten.
import { useEffect, useState } from 'react';
import { DatabaseBackup, History, LogOut, Server, UserPlus, Users } from 'lucide-react';
import { WEB, mehrplatz, type Row } from '../db';
import { SPERREN } from './Sperre';

const ROLLEN: Record<string, string> = { admin: 'Administrator', mitarbeiter: 'Mitarbeiter', lesend: 'Nur lesen' };

export function MehrplatzKarte() {
  return mehrplatz.aktiv ? <Verbunden /> : <Verbinden />;
}

function Verbinden() {
  const [url, setUrl] = useState('');
  const [geprueft, setGeprueft] = useState('');
  const [login, setLogin] = useState('admin');
  const [pw, setPw] = useState('');
  const [laeuft, setLaeuft] = useState('');
  const [fehler, setFehler] = useState('');
  async function testen() {
    setFehler(''); setGeprueft('');
    try { const r = await mehrplatz.testen(url); setGeprueft(`NANO-Server ${r.version} gefunden.`); } catch (e: any) { setFehler(e?.message ?? String(e)); }
  }
  async function uebertragen() {
    if (!confirm('Alle Daten dieses Rechners auf den Server übertragen? Was dort schon gespeichert ist, wird ersetzt (der Server sichert sich vorher).')) return;
    setFehler(''); setLaeuft('Starte …');
    try { await mehrplatz.datenUebertragen(url, login.trim(), pw, setLaeuft); setLaeuft('Übertragen. NANO startet neu …'); setTimeout(() => location.reload(), 1200); }
    catch (e: any) { setFehler(e?.message ?? String(e)); setLaeuft(''); }
  }
  function nurVerbinden() {
    if (!confirm('Diesen Rechner mit dem Server verbinden? NANO zeigt danach die Daten vom Server, die Daten auf diesem Rechner bleiben unverändert liegen.')) return;
    mehrplatz.einstellen(url); location.reload();
  }
  return (
    <section className="card">
      <div className="card-head"><h2 className="title-ico"><Server size={22} />Mehrplatz (NANO-Server)</h2></div>
      <p className="muted small" style={{ marginTop: 0 }}>Mehrere Mitarbeiter arbeiten gleichzeitig auf denselben Daten. Die Datenbank liegt dann auf dem NANO-Server (z. B. auf der Synology-NAS im Büro), jeder meldet sich mit eigenem Zugang an. Zurzeit arbeitet dieser Rechner <b>ohne Server</b>.</p>
      <div className="form">
        <label className="wide"><span>Adresse des NANO-Servers</span><input value={url} onChange={(e) => { setUrl(e.target.value); setGeprueft(''); }} placeholder="z. B. 192.168.178.20 oder nas.fritz.box" /></label>
      </div>
      <div className="row"><button onClick={testen} disabled={!url.trim()}>Verbindung testen</button>{geprueft && <span className="pos">{geprueft}</span>}</div>
      {geprueft && <>
        <div className="sec">Erster Rechner: Daten auf den Server übertragen</div>
        <p className="muted small">Nur einmal beim Umstieg, auf dem Rechner mit den aktuellen Daten. Anmeldung als Administrator des Servers.</p>
        <div className="form f3">
          <label><span>Benutzername</span><input value={login} onChange={(e) => setLogin(e.target.value)} /></label>
          <label><span>Passwort</span><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
          <label><span>&nbsp;</span><button className="primary" disabled={!pw || !!laeuft} onClick={uebertragen}><DatabaseBackup size={16} />Daten übertragen</button></label>
        </div>
        {laeuft && <p className="info">{laeuft}</p>}
        <div className="sec">Weitere Rechner: nur verbinden</div>
        <div className="row"><button onClick={nurVerbinden}><Server size={16} />Mit Server verbinden</button><span className="muted small">Danach meldest du dich mit deinem Zugang an.</span></div>
      </>}
      {fehler && <p className="error">{fehler}</p>}
    </section>
  );
}

function Verbunden() {
  const ich = mehrplatz.benutzer();
  const admin = ich?.rolle === 'admin';
  const [ablage, setAblage] = useState(mehrplatz.ablageHier());
  const [alt, setAlt] = useState(''); const [neu, setNeu] = useState('');
  const [nutzer, setNutzer] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [protokoll, setProtokoll] = useState<Row[] | null>(null);
  const [info, setInfo] = useState(''); const [fehler, setFehler] = useState('');
  const melde = (i: string, f = '') => { setInfo(i); setFehler(f); };
  const laden = () => admin && mehrplatz.benutzerListe().then(setNutzer).catch((e) => melde('', e.message));
  useEffect(() => { laden(); }, []);

  async function ablageSpeichern() {
    await mehrplatz.ablageHierSetzen(ablage);
    melde('Ablageordner für diesen Rechner gespeichert.');
  }
  async function passwort() {
    try { await mehrplatz.passwortAendern(alt, neu); setAlt(''); setNeu(''); melde('Passwort geändert.'); } catch (e: any) { melde('', e.message); }
  }
  async function nutzerSpeichern() {
    if (!edit) return;
    try { await mehrplatz.benutzerSpeichern(edit); setEdit(null); melde(edit.id ? 'Zugang gespeichert.' : `Zugang „${edit.login}“ angelegt.`); laden(); } catch (e: any) { melde('', e.message); }
  }
  async function trennen() {
    if (!confirm('Verbindung zum Server trennen? NANO arbeitet dann wieder mit den Daten auf diesem Rechner (Stand vor der Verbindung).')) return;
    await mehrplatz.abmelden(); mehrplatz.einstellen(null); location.reload();
  }

  return (
    <section className="card">
      <div className="card-head"><h2 className="title-ico"><Server size={22} />Mehrplatz (NANO-Server)</h2>
        <button onClick={() => window.dispatchEvent(new Event(SPERREN))}><LogOut size={16} />Abmelden</button></div>
      <p className="muted small" style={{ marginTop: 0 }}>Verbunden mit <b>{mehrplatz.adresse()}</b> als <b>{ich?.name}</b> ({ROLLEN[ich?.rolle ?? ''] ?? ich?.rolle}). Alle Änderungen landen sofort auf dem Server und im Protokoll.</p>

      {!WEB && <>
      <div className="sec">Gemeinsame Ablage auf diesem Rechner</div>
      <p className="muted small">Pfad zum freigegebenen NAS-Ordner, z. B. <code>/Volumes/NANO-Ablage</code> am Mac oder <code>Z:\NANO-Ablage</code> unter Windows. Jeder Rechner stellt seinen eigenen Pfad ein.</p>
      <div className="row"><input style={{ flex: 1 }} value={ablage} onChange={(e) => setAblage(e.target.value)} placeholder="Pfad zur Ablage" /><button onClick={ablageSpeichern}>Speichern</button></div>
      </>}

      <div className="sec">Mein Passwort</div>
      <div className="form f3">
        <label><span>Bisheriges Passwort</span><input type="password" value={alt} onChange={(e) => setAlt(e.target.value)} /></label>
        <label><span>Neues Passwort (mind. 8 Zeichen)</span><input type="password" value={neu} onChange={(e) => setNeu(e.target.value)} /></label>
        <label><span>&nbsp;</span><button onClick={passwort} disabled={!alt || neu.length < 8}>Passwort ändern</button></label>
      </div>

      {admin && <>
        <div className="sec"><Users size={16} /> Zugänge
          <span className="grow" /><button className="small-btn" onClick={() => setEdit({ login: '', name: '', rolle: 'mitarbeiter', aktiv: 1, passwort: '' })}><UserPlus size={15} />Neuer Zugang</button></div>
        <div className="tablewrap"><table className="list">
          <thead><tr><th>Name</th><th>Benutzername</th><th>Rolle</th><th>Letzte Anmeldung</th><th /></tr></thead>
          <tbody>{nutzer.map((u) => (
            <tr key={u.id} className={u.aktiv ? '' : 'muted'}><td>{u.name}{!u.aktiv && <span className="tag">gesperrt</span>}</td><td>{u.login}</td><td>{ROLLEN[u.rolle] ?? u.rolle}</td>
              <td className="small">{u.letzte_anmeldung ?? '–'}</td>
              <td className="actions"><button className="link" onClick={() => setEdit({ ...u, passwort: '' })}>Bearbeiten</button></td></tr>))}</tbody>
        </table></div>
        {edit && (
          <div className="warn" style={{ marginTop: 10 }}>
            <div className="form f3">
              <label><span>Name</span><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
              <label><span>Benutzername</span><input value={edit.login} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, login: e.target.value })} /></label>
              <label><span>Rolle</span><select value={edit.rolle} onChange={(e) => setEdit({ ...edit, rolle: e.target.value })}>{Object.entries(ROLLEN).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label><span>{edit.id ? 'Neues Passwort (leer = unverändert)' : 'Passwort (mind. 8 Zeichen)'}</span><input type="password" value={edit.passwort} onChange={(e) => setEdit({ ...edit, passwort: e.target.value })} /></label>
              {edit.id && <label className="check"><input type="checkbox" checked={!!edit.aktiv} onChange={(e) => setEdit({ ...edit, aktiv: e.target.checked ? 1 : 0 })} /><span>Zugang aktiv</span></label>}
            </div>
            <div className="row end"><span className="grow" /><button onClick={() => setEdit(null)}>Abbrechen</button><button className="primary" onClick={nutzerSpeichern}>Speichern</button></div>
          </div>)}
        <p className="muted small">Administrator: alles inkl. Zugänge. Mitarbeiter: alle Daten bearbeiten. Nur lesen: ansehen, nichts ändern.</p>

        <div className="sec"><History size={16} /> Protokoll und Sicherung</div>
        <div className="row">
          <button onClick={() => mehrplatz.protokoll(300).then(setProtokoll).catch((e) => melde('', e.message))}><History size={16} />Protokoll anzeigen</button>
          <button onClick={() => mehrplatz.sicherung().then((r) => melde(`Sicherung auf dem Server erstellt: ${r.datei}`)).catch((e) => melde('', e.message))}><DatabaseBackup size={16} />Jetzt sichern</button>
          <span className="muted small">Der Server sichert sich zusätzlich täglich selbst (30 Tage).</span>
        </div>
        {protokoll && <div className="tablewrap protokoll"><table className="list">
          <thead><tr><th>Zeit</th><th>Wer</th><th>Was</th><th>Bereich</th></tr></thead>
          <tbody>{protokoll.map((p) => <tr key={p.id}><td className="nowrap small">{p.zeit}</td><td>{p.benutzer}</td><td>{p.aktion}</td><td className="small">{p.tabelle ?? ''}</td></tr>)}</tbody>
        </table></div>}
      </>}
      {info && <p className="info">{info}</p>}
      {fehler && <p className="error">{fehler}</p>}
      {!WEB && <div className="row end"><button className="link" onClick={trennen}>Verbindung zum Server trennen</button></div>}
    </section>
  );
}
