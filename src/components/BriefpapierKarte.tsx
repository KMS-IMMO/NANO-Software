// Einstellungen: Briefpapier-Vorlage hochladen. Wird in allen Briefen, Mahnungen und Abrechnungen als Hintergrund genutzt.
import { useEffect, useRef, useState } from 'react';
import { FileUp, Eye, Trash2, X } from 'lucide-react';
import { briefpapierAusDatei, briefpapierLaden, briefpapierSpeichern, pdfSeitenAlsBilder } from '../lib/briefpapier';
import { Brief, absender } from '../lib/pdf';

export function BriefpapierKarte() {
  const [erste, setErste] = useState('');
  const [folge, setFolge] = useState('');
  const [name, setName] = useState('');
  const [kopf, setKopf] = useState(false);
  const [unten, setUnten] = useState('27');
  const [oben, setOben] = useState('25');
  const [busy, setBusy] = useState('');
  const [fehler, setFehler] = useState('');
  const [ok, setOk] = useState('');
  const [muster, setMuster] = useState<string[] | null>(null);
  const dateiRef = useRef<HTMLInputElement>(null);
  const folgeRef = useRef<HTMLInputElement>(null);

  async function laden() {
    const bp = await briefpapierLaden();
    setErste(bp?.erste ?? ''); setFolge(bp?.folge ?? ''); setName(bp?.name ?? '');
    setKopf(!!bp?.kopfDrucken); setUnten(String(bp?.unten ?? 27)); setOben(String(bp?.obenFolge ?? 25));
  }
  useEffect(() => { laden(); }, []);
  const melden = (t: string) => { setOk(t); setTimeout(() => setOk(''), 2500); };

  async function hochladen(f: File | undefined, nurFolge = false) {
    if (!f) return;
    setFehler(''); setBusy(nurFolge ? 'folge' : 'erste');
    try {
      const b = await briefpapierAusDatei(f);
      if (nurFolge) await briefpapierSpeichern({ briefpapier_folge: b.erste });
      else await briefpapierSpeichern({ briefpapier_erste: b.erste, briefpapier_folge: b.folge ?? '', briefpapier_name: f.name });
      await laden(); melden(nurFolge ? 'Folgeseite gespeichert' : b.folge ? 'Briefpapier gespeichert (Seite 2 der PDF gilt für Folgeseiten)' : 'Briefpapier gespeichert');
    } catch (e: any) { setFehler(e?.message ?? String(e)); }
    setBusy('');
    if (dateiRef.current) dateiRef.current.value = '';
    if (folgeRef.current) folgeRef.current.value = '';
  }

  async function optionenSpeichern() {
    await briefpapierSpeichern({ briefpapier_kopf: kopf ? '1' : '0', briefpapier_unten: String(Number(unten.replace(',', '.')) || 27), briefpapier_oben_folge: String(Number(oben.replace(',', '.')) || 25) });
    melden('Gespeichert');
  }

  async function entfernen() {
    await briefpapierSpeichern({ briefpapier_erste: '', briefpapier_folge: '', briefpapier_name: '' });
    await laden(); melden('Briefpapier entfernt');
  }

  async function musterZeigen() {
    setBusy('muster');
    try {
      await optionenSpeichern();
      const b = new Brief(await absender()).neuerBrief();
      b.kopf(['Herrn', 'Max Mustermann', 'Musterstraße 1', '50667 Köln'], new Date().toISOString().slice(0, 10));
      b.betreff('Musterbrief: so sehen Abrechnungen und Mahnungen mit deinem Briefpapier aus');
      b.absatz('Sehr geehrter Herr Mustermann,');
      b.absatz('dieser Brief zeigt, wie Text und Tabellen auf deinem Briefpapier liegen. Anschrift und Datum stehen an den Stellen für einen Fensterumschlag (DIN lang). Ist der Platz unten zu knapp oder überdeckt der Text die Fußzeile, ändere den Rand unten.');
      const zeilen = Array.from({ length: 34 }, (_, i) => [`${1200 + i}`, `Kostenposition ${i + 1}`, 'MEA', `${(120 + i * 17).toLocaleString('de-DE')},00 €`]);
      b.tabelle(['Konto', 'Kostenart', 'Schlüssel', 'Betrag'], zeilen, undefined, 3);
      b.absatz('Ab der zweiten Seite beginnt der Text beim eingestellten oberen Rand der Folgeseiten.');
      b.gruss();
      setMuster(await pdfSeitenAlsBilder(b.bytes(), 2, 900, 'image/png'));
    } catch (e: any) { setFehler(e?.message ?? String(e)); }
    setBusy('');
  }

  return (
    <section className="card briefpapier-karte">
      <div className="card-head"><h2>Briefpapier</h2></div>
      <p className="muted" style={{ marginTop: 0 }}>Lade dein Briefpapier als PDF oder Bild hoch. Es liegt dann unter allen Briefen, Mahnungen, Hausgeld-, Nebenkosten- und Eigentümerabrechnungen. Bei einer zweiseitigen PDF gilt Seite 2 für die Folgeseiten.</p>
      <input ref={dateiRef} type="file" accept="application/pdf,image/png,image/jpeg" hidden onChange={(e) => hochladen(e.target.files?.[0])} />
      <input ref={folgeRef} type="file" accept="application/pdf,image/png,image/jpeg" hidden onChange={(e) => hochladen(e.target.files?.[0], true)} />
      <div className="bp-reihe">
        <div className="bp-seite">
          <span className="bp-titel">Erste Seite</span>
          {erste ? <img src={erste} alt="Briefpapier erste Seite" /> : <button className="bp-leer" onClick={() => dateiRef.current?.click()}><FileUp size={22} /><span>{busy === 'erste' ? 'Wird gelesen …' : 'Vorlage hochladen'}</span><small>PDF, PNG oder JPG</small></button>}
        </div>
        <div className="bp-seite">
          <span className="bp-titel">Folgeseiten</span>
          {folge ? <img src={folge} alt="Briefpapier Folgeseite" /> : <button className="bp-leer" disabled={!erste} onClick={() => folgeRef.current?.click()}><FileUp size={22} /><span>{busy === 'folge' ? 'Wird gelesen …' : 'Eigene Folgeseite'}</span><small>{erste ? 'optional, sonst weiß' : 'erst die Vorlage hochladen'}</small></button>}
        </div>
        <div className="bp-optionen">
          {name && <p className="small muted" style={{ marginTop: 0 }}>Vorlage: <b>{name}</b></p>}
          <label className="check"><input type="checkbox" checked={kopf} onChange={(e) => setKopf(e.target.checked)} /><span>Firmenname und Kontaktzeile zusätzlich drucken (nur wenn das Briefpapier keinen Kopf hat)</span></label>
          <div className="form">
            <label><span>Rand unten (mm)</span><input inputMode="decimal" value={unten} onChange={(e) => setUnten(e.target.value)} /></label>
            <label><span>Textbeginn Folgeseiten (mm)</span><input inputMode="decimal" value={oben} onChange={(e) => setOben(e.target.value)} /></label>
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <button onClick={() => dateiRef.current?.click()}><FileUp size={16} />{erste ? 'Andere Vorlage' : 'Vorlage hochladen'}</button>
            {erste && <button onClick={() => folgeRef.current?.click()}><FileUp size={16} />Folgeseite ändern</button>}
            {erste && <button className="danger-link" onClick={entfernen}><Trash2 size={16} />Entfernen</button>}
          </div>
          <div className="row end" style={{ marginTop: 10 }}>
            <span className="grow" />{ok && <span className="pos">{ok}</span>}
            <button onClick={musterZeigen} disabled={!!busy}><Eye size={16} />{busy === 'muster' ? 'Wird erstellt …' : 'Musterbrief ansehen'}</button>
            <button className="primary" onClick={optionenSpeichern}>Speichern</button>
          </div>
          {fehler && <p className="error">{fehler}</p>}
        </div>
      </div>
      {muster && (
        <div className="modal-bg" onClick={() => setMuster(null)}>
          <div className="modal pdf-vorschau" onClick={(e) => e.stopPropagation()}>
            <div className="card-head"><h3>Musterbrief</h3><button className="icon-btn" title="Schließen" onClick={() => setMuster(null)}><X size={18} /></button></div>
            <div className="bp-muster">{muster.map((s, i) => <img key={i} src={s} alt={`Seite ${i + 1}`} />)}</div>
          </div>
        </div>
      )}
    </section>
  );
}
