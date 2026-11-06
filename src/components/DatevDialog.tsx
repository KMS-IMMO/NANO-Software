// Dialog für den DATEV-Export: Liegenschaft, Zeitraum, Mandant
import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { db, type Row } from '../db';
import { datevExport, datevSpeichern } from '../logic/datev';
import { oeffnen } from '../lib/dateien';

const letzterTag = (j: number, m: number) => new Date(j, m, 0).getDate();

export function DatevDialog({ objekte, objekt, fest, jahr, monat, onClose }: { objekte: Row[]; objekt?: number; fest: boolean; jahr: number; monat: string; onClose: () => void }) {
  const [o, setO] = useState<number | ''>(objekt ?? objekte[0]?.id ?? '');
  const [von, setVon] = useState(monat ? `${jahr}-${monat}-01` : `${jahr}-01-01`);
  const [bis, setBis] = useState(monat ? `${jahr}-${monat}-${letzterTag(jahr, Number(monat))}` : `${jahr}-12-31`);
  const [mandant, setMandant] = useState('');
  const [berater, setBerater] = useState('');
  const [info, setInfo] = useState('');
  const [fehler, setFehler] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  useEffect(() => {
    db.select(`SELECT schluessel, wert FROM einstellungen WHERE schluessel IN ('datev_mandant', 'datev_berater')`).then((r) => {
      const w = Object.fromEntries(r.map((x) => [x.schluessel, x.wert ?? '']));
      setMandant(w.datev_mandant ?? ''); setBerater(w.datev_berater ?? '');
    });
  }, []);

  async function los() {
    setFehler(''); setInfo('');
    if (o === '') { setFehler('Bitte eine Liegenschaft wählen. Jede Liegenschaft ist beim Steuerberater ein eigener Mandant.'); return; }
    if (von.slice(0, 4) !== bis.slice(0, 4)) { setFehler('Der Zeitraum muss im selben Jahr liegen.'); return; }
    setLaeuft(true);
    try {
      const x = await datevExport(Number(o), von, bis, mandant.trim());
      if (!x.buchungen) { setFehler('Im Zeitraum gibt es keine Buchungen.'); return; }
      const s = await datevSpeichern(x);
      setInfo(`${x.buchungen} Buchungen exportiert` + (x.belege.length ? (s.ordner === 'Downloads' ? `. Die ${x.belege.length} Belege kopiert die Desktop-App mit in den Ordner` : `, ${s.kopiert} von ${x.belege.length} Belegen kopiert`) : '') + `. Ordner: ${s.ordner}`
        + (x.ohneKonto ? `. Achtung: ${x.ohneKonto} Buchungen haben noch kein Konto.` : '') + (s.fehlend && s.kopiert ? ` ${s.fehlend} Belege wurden nicht gefunden.` : ''));
      if (s.ordner !== 'Downloads') oeffnen(s.ordner);
    } catch (e: any) { setFehler('Export fehlgeschlagen: ' + (e?.message ?? String(e))); }
    finally { setLaeuft(false); }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>DATEV-Export für den Steuerberater</h3>
        <p className="muted small" style={{ marginTop: 0 }}>Erstellt einen Buchungsstapel (DATEV-Format) und legt alle Belege daneben in einen Ordner. Den Ordner gibst du deinem Steuerberater oder lädst ihn in DATEV Unternehmen online hoch.</p>
        <div className="form">
          <label className="wide"><span>Liegenschaft *</span>
            <select value={o} disabled={fest} onChange={(e) => setO(e.target.value ? Number(e.target.value) : '')}>
              {!fest && <option value="">Bitte wählen</option>}{objekte.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label><span>Von</span><input type="date" value={von} onChange={(e) => setVon(e.target.value)} /></label>
          <label><span>Bis</span><input type="date" value={bis} onChange={(e) => setBis(e.target.value)} /></label>
          <label><span>Mandantennummer</span><input value={mandant} onChange={(e) => setMandant(e.target.value)} placeholder="z. B. 10001" /></label>
          <label><span>Beraternummer</span><input value={berater} disabled placeholder="in den Einstellungen" /></label>
        </div>
        {(!berater || !mandant) && <p className="warn small">Berater- und Mandantennummer bekommst du vom Steuerberater. Ohne sie lässt DATEV den Import nicht zu. Die Beraternummer und das Bankkonto stellst du unter Einstellungen › DATEV ein.</p>}
        {fehler && <p className="error">{fehler}</p>}
        {info && <p className="info">{info}</p>}
        <div className="row end"><span className="grow" /><button onClick={onClose}>Schließen</button>
          <button className="primary" disabled={laeuft} onClick={los}><Download size={16} />{laeuft ? 'Exportiere …' : 'Exportieren'}</button></div>
      </div>
    </div>
  );
}
