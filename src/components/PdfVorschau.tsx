// PDF-Vorschau, die im Mac-Fenster sicher funktioniert: Seiten werden mit pdf.js als Bilder gezeichnet
// (ein PDF im iframe bleibt im Mac-Fenster leer). Das Fenster hängt direkt am <body>, damit es nie
// auf den Inhaltsbereich zugeschnitten wird. Drucken geht über den Druckdialog des Programms.
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Printer, X } from 'lucide-react';
import { pdfSeitenAlsBilder } from '../lib/briefpapier';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Seiten einer PDF untereinander als Bilder */
export function PdfSeiten({ bytes }: { bytes: Uint8Array | null }) {
  const [seiten, setSeiten] = useState<string[] | null>(null);
  const [fehler, setFehler] = useState('');
  useEffect(() => {
    let aktiv = true; setSeiten(null); setFehler('');
    if (bytes) pdfSeitenAlsBilder(bytes, 500, 1240).then((s) => { if (aktiv) setSeiten(s); }).catch((e) => { if (aktiv) setFehler(String(e?.message ?? e)); });
    return () => { aktiv = false; };
  }, [bytes]);
  return (
    <div className="pdf-seiten">
      {fehler ? <p className="muted">Die Vorschau konnte nicht gezeichnet werden ({fehler}). Bitte „Im PDF-Programm öffnen“ nutzen.</p>
        : !seiten ? <p className="muted">PDF wird gezeichnet …</p>
          : seiten.map((s, i) => <img key={i} src={s} alt={`Seite ${i + 1}`} />)}
    </div>
  );
}

/** PDF über den Druckdialog drucken. Klappt das nicht, wird die Datei im PDF-Programm geöffnet. */
export async function pdfDrucken(bytes: Uint8Array, dateiname = 'Druck.pdf') {
  const bilder = await pdfSeitenAlsBilder(bytes, 500, 1654, 'image/png');
  const box = document.createElement('div');
  box.className = 'pdf-druck';
  for (const b of bilder) { const img = document.createElement('img'); img.src = b; box.appendChild(img); }
  document.body.appendChild(box);
  document.body.classList.add('druckt-pdf');
  await Promise.all([...box.querySelectorAll('img')].map((i) => i.decode().catch(() => undefined)));
  const aufraeumen = () => { document.body.classList.remove('druckt-pdf'); box.remove(); };
  try {
    // Im Mac-Fenster ruft window.print() den Druckdialog des Programms auf (Promise), im Browser blockiert es bis zum Schließen
    await Promise.resolve((window.print as unknown as () => unknown)());
    setTimeout(aufraeumen, 1500);
  } catch {
    aufraeumen();
    await pdfExtern(bytes, dateiname);
  }
}

/** PDF in einem Vorschau-Ordner der Ablage speichern und im PDF-Programm des Rechners öffnen */
export async function pdfExtern(bytes: Uint8Array, dateiname: string) {
  const name = dateiname.replace(/[<>:"/\\|?*]/g, '-');
  if (!isTauri) {
    const u = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    const a = document.createElement('a'); a.href = u; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(u), 5000);
    return;
  }
  const { ablagePfad, oeffnen } = await import('../lib/dateien');
  const { join } = await import('@tauri-apps/api/path');
  const { mkdir, writeFile } = await import('@tauri-apps/plugin-fs');
  const dir = await join(await ablagePfad(), 'Vorschau');
  await mkdir(dir, { recursive: true });
  const pfad = await join(dir, name);
  await writeFile(pfad, bytes);
  await oeffnen(pfad);
}

/** Vorschau-Fenster mit Drucken und Öffnen im PDF-Programm */
export function PdfVorschau({ bytes, titel, dateiname, onClose, extern, aktionen }: {
  bytes: Uint8Array | null; titel: string; dateiname?: string; onClose: () => void; extern?: () => void; aktionen?: ReactNode;
}) {
  const [druckt, setDruckt] = useState(false);
  useEffect(() => {
    if (!bytes) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [bytes, onClose]);
  if (!bytes) return null;
  const name = dateiname ?? `${titel}.pdf`;
  async function drucken() { setDruckt(true); try { await pdfDrucken(bytes!, name); } finally { setDruckt(false); } }
  return createPortal(
    <div className="modal-bg pdf-bg" onClick={onClose}>
      <div className="modal pdf-vorschau" onClick={(e) => e.stopPropagation()}>
        <div className="card-head"><h3>{titel}</h3>
          <div className="row">
            {aktionen}
            <button onClick={drucken} disabled={druckt}><Printer size={16} />{druckt ? 'Wird vorbereitet …' : 'Drucken'}</button>
            <button onClick={() => (extern ? extern() : pdfExtern(bytes, name))}><ExternalLink size={16} />Im PDF-Programm öffnen</button>
            <button className="icon-btn" title="Schließen" onClick={onClose}><X size={18} /></button></div></div>
        <PdfSeiten bytes={bytes} />
      </div>
    </div>,
    document.body,
  );
}
