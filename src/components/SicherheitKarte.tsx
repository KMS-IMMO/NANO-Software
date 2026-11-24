// Einstellungen → Sicherheit: Passwort ändern, automatische Sperre, Datensicherung und Wiederherstellen
import { useEffect, useState } from 'react';
import { DatabaseBackup, KeyRound, Lock } from 'lucide-react';
import { db, sicherheit } from '../db';
import { SPERREN } from './Sperre';

export function SicherheitKarte() {
  const [alt, setAlt] = useState(''); const [neu, setNeu] = useState(''); const [neu2, setNeu2] = useState('');
  const [minuten, setMinuten] = useState('15');
  const [liste, setListe] = useState<{ name: string; pfad: string; groesse: number }[]>([]);
  const [info, setInfo] = useState(''); const [fehler, setFehler] = useState('');
  const [wieder, setWieder] = useState<{ pfad: string; pw: string } | null>(null);

  const [extern, setExtern] = useState<Record<string, string>>({});
  const laden = async () => {
    if (sicherheit.aktiv) setListe(await sicherheit.sicherungen().catch(() => []));
    setExtern(Object.fromEntries((await db.select(`SELECT schluessel, wert FROM einstellungen WHERE schluessel LIKE 'sicherung_extern_%'`)).map((r) => [r.schluessel, String(r.wert ?? '')])));
  };
  useEffect(() => {
    db.select(`SELECT wert FROM einstellungen WHERE schluessel = 'sperre_minuten'`).then((r) => r[0]?.wert != null && setMinuten(String(r[0].wert)));
    laden();
  }, []);
  const melde = (i: string, f = '') => { setInfo(i); setFehler(f); };
  const fehlerText = (e: any) => String(e?.message ?? e);

  async function passwort() {
    if (neu.length < 8) return melde('', 'Das neue Passwort muss mindestens 8 Zeichen haben.');
    if (neu !== neu2) return melde('', 'Die neuen Passwörter stimmen nicht überein.');
    try { await sicherheit.passwortAendern(alt, neu); setAlt(''); setNeu(''); setNeu2(''); melde('Passwort geändert. Ältere Sicherungen öffnen sich weiter mit dem alten Passwort.'); }
    catch (e) { melde('', fehlerText(e)); }
  }
  async function sperreSpeichern(v: string) {
    setMinuten(v);
    await db.execute(`INSERT INTO einstellungen (schluessel, wert) VALUES ('sperre_minuten', $1) ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert`, [v]);
    melde('Gespeichert. Gilt ab der nächsten Anmeldung.');
  }
  async function sichern(woanders: boolean) {
    try {
      let ordner: string | undefined;
      if (woanders) {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const r = await open({ directory: true, title: 'Ordner für die Sicherung wählen (z. B. USB-Stick oder NAS)' });
        if (!r) return; ordner = String(r);
      }
      const p = await sicherheit.sicherungErstellen(ordner);
      melde(`Sicherung erstellt: ${p}`); laden();
    } catch (e) { melde('', fehlerText(e)); }
  }
  // Automatisch jeden Tag zusätzlich auf USB-Stick/NAS
  async function externWaehlen(aus = false) {
    let pfad = '';
    if (!aus) {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const r = await open({ directory: true, title: 'Ordner für die tägliche Sicherung (USB-Stick oder NAS)' });
      if (!r) return; pfad = String(r);
    }
    for (const [k, v] of [['sicherung_extern_pfad', pfad], ['sicherung_extern_letzte', ''], ['sicherung_extern_fehler', '']])
      await db.execute(`INSERT INTO einstellungen (schluessel, wert) VALUES ($1, $2) ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert`, [k, v]);
    if (pfad) {
      const w = await sicherheit.autoSichern().catch((x) => String(x?.message ?? x));
      if (w) melde('', w); else melde(`Ab jetzt wird jeden Tag zusätzlich nach ${pfad} gesichert (die letzten 30 bleiben dort erhalten).`);
    } else melde('Die tägliche Sicherung auf USB-Stick/NAS ist ausgeschaltet.');
    laden();
  }
  async function dateiWaehlen() {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const r = await open({ title: 'Sicherung auswählen', filters: [{ name: 'NEOSS-Sicherung', extensions: ['nanosicherung'] }] });
    if (r) setWieder({ pfad: String(r), pw: '' });
  }
  async function wiederherstellen() {
    if (!wieder) return;
    try {
      await sicherheit.wiederherstellen(wieder.pfad, wieder.pw);
      melde('Sicherung zurückgespielt. Die App startet neu, bitte mit dem Passwort der Sicherung anmelden.');
      setTimeout(() => location.reload(), 1500);
    } catch (e) { melde('', fehlerText(e)); }
  }

  if (!sicherheit.aktiv) return (
    <section className="card"><div className="card-head"><h2 className="title-ico"><Lock size={22} />Sicherheit und Datensicherung</h2></div>
      <p className="muted">App-Passwort, Verschlüsselung und Datensicherung gibt es nur in der installierten App.</p></section>);

  const letzte = (name?: string) => {
    const m = name?.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})/);
    if (!m) return 'noch keine';
    const tag = `${m[1]}-${m[2]}-${m[3]}`, heute = new Date().toLocaleDateString('sv-SE');
    const gestern = new Date(Date.now() - 864e5).toLocaleDateString('sv-SE');
    return `${tag === heute ? 'heute' : tag === gestern ? 'gestern' : `${m[3]}.${m[2]}.${m[1]}`}, ${m[4]}:${m[5]} Uhr`;
  };
  const kb = (n: number) => n > 1048576 ? `${(n / 1048576).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB` : `${Math.ceil(n / 1024)} KB`;
  return (
    <section className="card">
      <div className="card-head"><h2 className="title-ico"><Lock size={22} />Sicherheit und Datensicherung</h2>
        <button onClick={() => window.dispatchEvent(new Event(SPERREN))}><Lock size={16} />Jetzt sperren</button></div>
      <p className="muted small">Alle Daten sind mit deinem App-Passwort verschlüsselt (AES-256). Ohne Passwort lassen sich weder die Daten noch die Sicherungen öffnen.</p>

      <div className="sec"><KeyRound size={16} /> Passwort ändern</div>
      <div className="form f3">
        <label><span>Bisheriges Passwort</span><input type="password" value={alt} onChange={(e) => setAlt(e.target.value)} /></label>
        <label><span>Neues Passwort (mind. 8 Zeichen)</span><input type="password" value={neu} onChange={(e) => setNeu(e.target.value)} /></label>
        <label><span>Neues Passwort wiederholen</span><input type="password" value={neu2} onChange={(e) => setNeu2(e.target.value)} /></label>
      </div>
      <div className="row end"><span className="grow" /><button onClick={passwort} disabled={!alt || !neu}>Passwort ändern</button></div>

      <div className="sec"><Lock size={16} /> Automatische Sperre</div>
      <label className="inline">Sperren nach <select value={minuten} onChange={(e) => sperreSpeichern(e.target.value)}>
        {[['5', '5 Minuten'], ['10', '10 Minuten'], ['15', '15 Minuten'], ['30', '30 Minuten'], ['60', '1 Stunde'], ['0', 'nie (nicht empfohlen)']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select> ohne Eingabe</label>

      <div className="sec"><DatabaseBackup size={16} /> Datensicherung</div>
      <p className="muted small">Jeden Tag wird automatisch gesichert (beim Anmelden und, wenn die App über Nacht läuft, stündlich geprüft). Die letzten 14 Sicherungen bleiben im App-Ordner. Damit bei einem Defekt des Rechners nichts verloren geht, stelle zusätzlich einen USB-Stick oder ein NAS ein.</p>
      <div className="sicherung-status">
        <div><span className="muted small">Letzte Sicherung</span><b>{letzte(liste[0]?.name)}</b></div>
        <div><span className="muted small">Täglich zusätzlich auf USB-Stick / NAS</span>
          {extern.sicherung_extern_pfad
            ? <><b title={extern.sicherung_extern_pfad}>{extern.sicherung_extern_pfad}</b>
                <span className={'small ' + (extern.sicherung_extern_fehler ? 'neg' : 'muted')}>{extern.sicherung_extern_fehler ? 'Zuletzt nicht erreichbar. Stick einstecken bzw. NAS verbinden.' : extern.sicherung_extern_letzte ? `zuletzt ${extern.sicherung_extern_letzte.split('-').reverse().join('.')}` : 'noch keine'}</span></>
            : <b className="neg">nicht eingerichtet</b>}
          <span className="row"><button onClick={() => externWaehlen()}>{extern.sicherung_extern_pfad ? 'Ordner ändern …' : 'Ordner wählen …'}</button>
            {extern.sicherung_extern_pfad && <button className="link" onClick={() => externWaehlen(true)}>ausschalten</button>}</span>
        </div>
      </div>
      <div className="row">
        <button onClick={() => sichern(false)}>Jetzt sichern</button>
        <button className="primary" onClick={() => sichern(true)}>Auf USB-Stick / NAS sichern …</button>
        <span className="grow" />
        <button onClick={dateiWaehlen}>Sicherung zurückspielen …</button>
      </div>
      {liste.length > 0 && (
        <div className="tablewrap"><table className="list" style={{ marginTop: 12 }}>
          <thead><tr><th>Sicherung</th><th className="num">Größe</th><th /></tr></thead>
          <tbody>{liste.map((s) => (
            <tr key={s.pfad}><td>{s.name.replace(/^(NANO|NEOSS)-/, '').replace('.nanosicherung', '').replace(/_/g, ' ')}</td><td className="num">{kb(s.groesse)}</td>
              <td className="actions"><button className="link" onClick={() => setWieder({ pfad: s.pfad, pw: '' })}>Zurückspielen</button></td></tr>))}
          </tbody></table></div>)}
      {wieder && (
        <div className="warn" style={{ marginTop: 12 }}>
          <p><b>Sicherung zurückspielen:</b> {wieder.pfad}</p>
          <p>Der aktuelle Stand wird vorher automatisch gesichert und dann durch die Sicherung ersetzt.</p>
          <div className="row">
            <input type="password" placeholder="Passwort dieser Sicherung" value={wieder.pw} onChange={(e) => setWieder({ ...wieder, pw: e.target.value })} />
            <button onClick={() => setWieder(null)}>Abbrechen</button>
            <button className="danger" onClick={wiederherstellen} disabled={!wieder.pw}>Zurückspielen</button>
          </div>
        </div>)}
      {info && <p className="info">{info}</p>}
      {fehler && <p className="error">{fehler}</p>}
    </section>
  );
}
