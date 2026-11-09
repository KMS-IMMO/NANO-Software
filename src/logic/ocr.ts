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
  const blob = await new Promise<Blob>((ok, fehler) => c.toBlob((b) => (b ? ok(b) : fehler(new Error('Bild konnte nicht erstellt werden.'))), 'image/jpeg', 0.95));
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

/** Das größte eingebettete Foto einer PDF-Seite in Originalauflösung holen (bei Auszügen aus Fotos besser als die Seite neu zu zeichnen) */
async function seitenFoto(pdfjs: any, seite: any): Promise<HTMLCanvasElement | null> {
  const ops = await seite.getOperatorList();
  const ids: string[] = [];
  ops.fnArray.forEach((fn: number, i: number) => { if (fn === pdfjs.OPS.paintImageXObject) ids.push(ops.argsArray[i][0]); });
  let best: any = null;
  for (const id of ids) {
    const img: any = await new Promise((ok) => { try { seite.objs.get(id, ok); } catch { ok(null); } });
    if (img && (!best || img.width * img.height > best.width * best.height)) best = img;
  }
  if (!best || Math.max(best.width, best.height) < 1200) return null;
  const s = Math.min(1, 4800 / Math.max(best.width, best.height));
  const { c, ctx } = leinwand(best.width * s, best.height * s);
  if (best.bitmap) ctx.drawImage(best.bitmap, 0, 0, c.width, c.height);
  else if (best.data) {
    const roh = document.createElement('canvas'); roh.width = best.width; roh.height = best.height;
    const r = roh.getContext('2d')!, bild = r.createImageData(best.width, best.height), d = best.data as Uint8ClampedArray, n = best.width * best.height;
    const proPixel = d.length / n;
    if (proPixel >= 4) bild.data.set(d.subarray(0, n * 4));
    else if (proPixel >= 3) for (let i = 0; i < n; i++) { bild.data[i * 4] = d[i * 3]; bild.data[i * 4 + 1] = d[i * 3 + 1]; bild.data[i * 4 + 2] = d[i * 3 + 2]; bild.data[i * 4 + 3] = 255; }
    else return null;
    r.putImageData(bild, 0, 0); ctx.drawImage(roh, 0, 0, c.width, c.height);
  } else return null;
  return c;
}

/** Alle Seiten einer PDF als Bild lesen */
export async function pdfOcrText(daten: Uint8Array, fortschritt?: (seite: number, von: number) => void, maxSeiten = 60): Promise<string> {
  const pdfjs: any = await pdfjsLaden();
  const task = pdfjs.getDocument({ data: daten.slice() });
  const doc = await task.promise;
  const n = Math.min(doc.numPages, maxSeiten), seiten: string[] = [];
  try {
    for (let i = 1; i <= n; i++) {
      fortschritt?.(i, n);
      const seite = await doc.getPage(i);
      let c = await seitenFoto(pdfjs, seite).catch(() => null);
      if (!c) {
        const v1 = seite.getViewport({ scale: 1 });
        const vp = seite.getViewport({ scale: Math.min(6, 2600 / v1.width, 4800 / v1.height) });
        const l = leinwand(vp.width, vp.height);
        await seite.render({ canvasContext: l.ctx, viewport: vp, canvas: l.c } as any).promise;
        c = l.c;
      }
      seiten.push(await leinwandText(c));
      seite.cleanup();
    }
  } finally { await task.destroy(); }
  return seiten.join('\n');
}
