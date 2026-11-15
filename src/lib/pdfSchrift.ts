// Schrift der PDFs: Montserrat wie in der App und auf dem Briefpapier (SIL Open Font License, Teilmenge Latein, siehe assets/fonts).
// Die Dateien werden einmal je Sitzung geladen und in jedes PDF eingebettet. Klappt das Laden nicht, bleibt es bei Helvetica.
import type { jsPDF } from 'jspdf';
import url400 from '../assets/fonts/montserrat-400.ttf?url';
import url600 from '../assets/fonts/montserrat-600.ttf?url';

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
      const [normal, fett] = await Promise.all([url400, url600].map(async (u) => {
        const r = await fetch(u);
        if (!r.ok) throw new Error(`${u}: ${r.status}`);
        return base64(await r.arrayBuffer());
      }));
      daten = { normal, fett };
    } catch (e) { console.warn('PDF-Schrift Montserrat nicht geladen, PDFs nutzen Helvetica.', e); }
  })();
  return laden;
}

/** Name der Schrift für setFont und autoTable */
export const SCHRIFT = () => (daten ? 'Montserrat' : 'helvetica');

/** Schrift in ein neues PDF einbinden (normal und fett) */
export function schriftEinbinden(doc: jsPDF) {
  if (!daten) return;
  doc.addFileToVFS('montserrat-400.ttf', daten.normal); doc.addFont('montserrat-400.ttf', 'Montserrat', 'normal');
  doc.addFileToVFS('montserrat-600.ttf', daten.fett); doc.addFont('montserrat-600.ttf', 'Montserrat', 'bold');
  doc.setFont('Montserrat', 'normal');
}
