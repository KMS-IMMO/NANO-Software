// Schrift der PDFs: Arial wie im ganzen Programm. Eingebettet wird Liberation Sans (metrisch gleich zu Arial,
// SIL Open Font License, Teilmenge Latein, siehe assets/fonts), damit jedes PDF überall gleich aussieht.
// Die Dateien werden einmal je Sitzung geladen und in jedes PDF eingebettet. Klappt das Laden nicht, bleibt es bei Helvetica.
import type { jsPDF } from 'jspdf';
import url400 from '../assets/fonts/arial-400.ttf?url';
import url700 from '../assets/fonts/arial-700.ttf?url';

let daten: { normal: string; fett: string } | null = null;
let laden: Promise<void> | null = null;

const base64 = (buf: ArrayBuffer) => {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Schriftdateien laden (einmal je Sitzung) */
export function pdfSchriftLaden(): Promise<void> {
  if (!laden) laden = (async () => {
    try {
      const [normal, fett] = await Promise.all([url400, url700].map(async (u) => {
        const r = await fetch(u);
        if (!r.ok) throw new Error(`${u}: ${r.status}`);
        return base64(await r.arrayBuffer());
      }));
      daten = { normal, fett };
    } catch (e) { console.warn('PDF-Schrift Arial nicht geladen, PDFs nutzen Helvetica.', e); }
  })();
  return laden;
}

/** Name der Schrift für setFont und autoTable */
export const SCHRIFT = () => (daten ? 'Arial' : 'helvetica');

/** Schrift in ein neues PDF einbinden (normal und fett) */
export function schriftEinbinden(doc: jsPDF) {
  if (!daten) return;
  doc.addFileToVFS('arial-400.ttf', daten.normal); doc.addFont('arial-400.ttf', 'Arial', 'normal');
  doc.addFileToVFS('arial-700.ttf', daten.fett); doc.addFont('arial-700.ttf', 'Arial', 'bold');
  doc.setFont('Arial', 'normal');
}
