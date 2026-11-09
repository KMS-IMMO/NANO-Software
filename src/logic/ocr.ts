// Texterkennung für eingescannte oder fotografierte Kontoauszüge (PDF aus Bildern, JPG, PNG, HEIC).
// Die Seiten werden als Bild an die Texterkennung von macOS gegeben; aus den erkannten Textstücken entstehen wieder Zeilen.
import { pdfjsLaden } from '../lib/pdfjs';
import { isTauri } from './bankAbruf';

type Wort = { s: string; x: number; y: number; h: number };

export const ocrVerfuegbar = () => isTauri();
export const istBild = (f: File) => /\.(jpe?g|png|heic|heif|tiff?)$/i.test(f.name) || /^image\//.test(f.type);

/** Textstücke mit gleicher Höhe zu Zeilen zusammensetzen (von oben nach unten, links nach rechts) */
export function zeilenAusWoertern(woerter: Wort[]): string {
  const rows: { y: number; h: number; w: Wort[] }[] = [];
  for (const w of [...woerter].sort((a, b) => b.y - a.y)) {
    const r = rows.find((r) => Math.abs(r.y - w.y) < Math.max(r.h, w.h) * 0.6);
    if (r) { r.w.push(w); r.y = (r.y * (r.w.length - 1) + w.y) / r.w.length; } else rows.push({ y: w.y, h: w.h, w: [w] });
  }
  return rows.sort((a, b) => b.y - a.y).map((r) => r.w.sort((a, b) => a.x - b.x).map((w) => w.s.trim()).join(' ')).join('\n');
}

async function leinwandText(c: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob>((ok, fehler) => c.toBlob((b) => (b ? ok(b) : fehler(new Error('Bild konnte nicht erstellt werden.'))), 'image/jpeg', 0.92));
  const { invoke } = await import('@tauri-apps/api/core');
  const woerter = await invoke<Wort[]>('ocr_bild', new Uint8Array(await blob.arrayBuffer()));
  return zeilenAusWoertern(woerter);
}

function leinwand(w: number, h: number) {
  const c = document.createElement('canvas'); c.width = Math.round(w); c.height = Math.round(h);
  const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  return { c, ctx };
}

/** Ein Foto lesen (Ausrichtung aus dem Foto wird beachtet) */
export async function bildText(f: Blob): Promise<string> {
  const bmp = await createImageBitmap(f);
  const s = Math.min(1, 4800 / Math.max(bmp.width, bmp.height));
  const { c, ctx } = leinwand(bmp.width * s, bmp.height * s);
  ctx.drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
  return leinwandText(c);
}

/** Alle Seiten einer PDF als Bild lesen */
export async function pdfOcrText(daten: Uint8Array, fortschritt?: (seite: number, von: number) => void, maxSeiten = 60): Promise<string> {
  const pdfjs = await pdfjsLaden();
  const task = pdfjs.getDocument({ data: daten.slice() });
  const doc = await task.promise;
  const n = Math.min(doc.numPages, maxSeiten), seiten: string[] = [];
  try {
    for (let i = 1; i <= n; i++) {
      fortschritt?.(i, n);
      const seite = await doc.getPage(i);
      const v1 = seite.getViewport({ scale: 1 });
      const vp = seite.getViewport({ scale: Math.min(6, 2600 / v1.width, 4800 / v1.height) });
      const { c, ctx } = leinwand(vp.width, vp.height);
      await seite.render({ canvasContext: ctx, viewport: vp, canvas: c } as any).promise;
      seiten.push(await leinwandText(c));
      seite.cleanup();
    }
  } finally { await task.destroy(); }
  return seiten.join('\n');
}
