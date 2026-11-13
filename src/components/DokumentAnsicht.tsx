// Fenster, das ein abgelegtes Dokument (PDF oder Bild) direkt im Programm zeigt, mit Drucken und Öffnen im PDF-Programm.
import { useEffect, useState } from 'react';
import { ExternalLink, Printer, X } from 'lucide-react';
import { lesen, oeffnen } from '../lib/dateien';
import type { Row } from '../db';

const typ = (name: string) => /\.pdf$/i.test(name) ? 'application/pdf' : /\.png$/i.test(name) ? 'image/png' : /\.jpe?g$/i.test(name) ? 'image/jpeg' : '';

export function DokumentAnsicht({ docs, titel, onClose }: { docs: Row[]; titel: string; onClose: () => void }) {
  const [akt, setAkt] = useState<Row>(docs[0]);
  const [url, setUrl] = useState<string | null>(null);
  const [fehlt, setFehlt] = useState(false);
  useEffect(() => {
    let u: string | null = null; setUrl(null); setFehlt(false);
    lesen(akt.pfad).then((d) => {
      if (!d || !typ(akt.dateiname)) { setFehlt(true); return; }
      u = URL.createObjectURL(new Blob([d as BlobPart], { type: typ(akt.dateiname) })); setUrl(u);
    });
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [akt]);
  const drucken = () => { const f = document.getElementById('dok-ansicht') as HTMLIFrameElement | null; try { f?.contentWindow?.focus(); f?.contentWindow?.print(); } catch { oeffnen(akt.pfad); } };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal pdf-vorschau dok-ansicht" onClick={(e) => e.stopPropagation()}>
        <div className="card-head"><h3>{titel}</h3>
          <div className="row">
            {docs.length > 1 && <select value={akt.id} onChange={(e) => setAkt(docs.find((d) => String(d.id) === e.target.value) ?? docs[0])}>{docs.map((d) => <option key={d.id} value={d.id}>{d.dateiname}</option>)}</select>}
            {url && typ(akt.dateiname) === 'application/pdf' && <button onClick={drucken}><Printer size={16} />Drucken</button>}
            <button onClick={() => oeffnen(akt.pfad)}><ExternalLink size={16} />Im PDF-Programm öffnen</button>
            <button className="icon-btn" title="Schließen" onClick={onClose}><X size={18} /></button></div></div>
        {url && (typ(akt.dateiname) === 'application/pdf' ? <iframe id="dok-ansicht" title={akt.dateiname} src={url} /> : <div className="dok-bild"><img src={url} alt={akt.dateiname} /></div>)}
        {fehlt && <p className="muted">„{akt.dateiname}“ lässt sich hier nicht anzeigen. Öffne es mit „Im PDF-Programm öffnen“.</p>}
        {!url && !fehlt && <p className="muted">Wird geladen …</p>}
      </div>
    </div>
  );
}
