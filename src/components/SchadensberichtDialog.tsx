// Fenster „Jahresbericht drucken“ bei den Ticket-Boards: Schäden je Liegenschaft für ein Jahr als PDF,
// mit Vorschau, Drucken und Ablage im Ordner der Liegenschaft.
import { useEffect, useState } from 'react';
import { ExternalLink, FileDown, Printer, X } from 'lucide-react';
import { db, type Row } from '../db';
import { berichtDaten, berichtPdf, type Umfang } from '../logic/schadensbericht';
import { oeffnen, speichern } from '../lib/dateien';

export function SchadensberichtDialog({ onClose, objektId }: { onClose: () => void; objektId?: number }) {
  const [objekte, setObjekte] = useState<Row[]>([]);
  const [jahr, setJahr] = useState(new Date().getFullYear() - (new Date().getMonth() < 3 ? 1 : 0));
  const [objekt, setObjekt] = useState<number | ''>(objektId ?? '');
  const [umfang, setUmfang] = useState<Umfang>('schaeden');
  const [pdf, setPdf] = useState<{ url: string; bytes: Uint8Array } | null>(null);
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { db.select('SELECT id, name FROM objekte ORDER BY name').then(setObjekte); }, []);
  const name = umfang === 'schaeden' ? 'Schadensbericht' : 'Vorgänge und Tickets';

  async function vorschau() {
    setBusy(true); setInfo('');
    try {
      const g = await berichtDaten(jahr, objekt === '' ? null : objekt, umfang);
      const bytes = await berichtPdf(jahr, g, umfang);
      if (pdf) URL.revokeObjectURL(pdf.url);
      setPdf({ url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' })), bytes });
      setInfo(g.length ? `${g.length} Liegenschaft${g.length === 1 ? '' : 'en'}, ${g.reduce((s, x) => s + x.posten.length, 0)} Einträge` : 'Keine Einträge in diesem Jahr.');
    } finally { setBusy(false); }
  }
  // Ablage: je Liegenschaft ein eigenes PDF im Ordner <Liegenschaft>/Schadensbericht/<Jahr>
  async function ablegen() {
    setBusy(true);
    try {
      const g = await berichtDaten(jahr, objekt === '' ? null : objekt, umfang);
      for (const x of g) await speichern(await berichtPdf(jahr, [x], umfang), `${name} ${jahr} ${x.objekt.name}.pdf`, { bezug: 'Objekt', bezugId: x.objekt.id, ordner: [x.objekt.name, 'Schadensbericht', String(jahr)] });
      setInfo(`${g.length} PDF${g.length === 1 ? '' : 's'} im Dateimanager abgelegt.`);
    } finally { setBusy(false); }
  }
  function drucken() {
    const f = document.getElementById('schaden-pdf') as HTMLIFrameElement | null;
    try { f?.contentWindow?.focus(); f?.contentWindow?.print(); } catch { extern(); }
  }
  async function extern() {
    if (!pdf) return;
    oeffnen(await speichern(pdf.bytes, `${name} ${jahr}.pdf`, { bezug: 'Objekt', bezugId: Number(objekt || objekte[0]?.id), ordner: ['Berichte', 'Vorschau'] }));
  }
  function schliessen() { if (pdf) URL.revokeObjectURL(pdf.url); onClose(); }

  return (
    <div className="modal-bg" onClick={schliessen}>
      <div className={'modal' + (pdf ? ' pdf-vorschau' : '')} onClick={(e) => e.stopPropagation()}>
        <div className="card-head"><h3>{name} zum Jahresende</h3>
          <div className="row">{pdf && <><button onClick={drucken}><Printer size={16} />Drucken</button><button onClick={extern}><ExternalLink size={16} />Im PDF-Programm öffnen</button></>}
            <button className="icon-btn" title="Schließen" onClick={schliessen}><X size={18} /></button></div></div>
        <div className="row schaden-filter">
          <label className="inline">Jahr <select value={jahr} onChange={(e) => setJahr(Number(e.target.value))}>{Array.from({ length: 6 }, (_, i) => new Date().getFullYear() + 1 - i).map((j) => <option key={j}>{j}</option>)}</select></label>
          <label className="inline">Liegenschaft <select value={objekt} onChange={(e) => setObjekt(e.target.value ? Number(e.target.value) : '')}><option value="">Alle Liegenschaften</option>{objekte.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
          <div className="seg"><button className={umfang === 'schaeden' ? 'on' : ''} onClick={() => setUmfang('schaeden')}>Nur Schäden</button><button className={umfang === 'alle' ? 'on' : ''} onClick={() => setUmfang('alle')}>Alle Vorgänge und Tickets</button></div>
          <span className="grow" />
          <button onClick={vorschau} disabled={busy}>{busy ? 'Wird erstellt …' : 'Vorschau'}</button>
          <button className="primary" onClick={ablegen} disabled={busy}><FileDown size={16} />PDFs ablegen</button>
        </div>
        <p className="muted small">Enthalten ist, was im Jahr gemeldet oder erledigt wurde, und was am 31.12. noch offen ist. „Nur Schäden“ nimmt Instandhaltungsvorgänge der Art „Schaden“ und Tickets aus Boards oder mit Titeln, die „Schaden“ enthalten. Jede Liegenschaft beginnt auf einer neuen Seite.{info && <b> {info}</b>}</p>
        {pdf && <iframe id="schaden-pdf" title="Schadensbericht" src={pdf.url} />}
      </div>
    </div>
  );
}
