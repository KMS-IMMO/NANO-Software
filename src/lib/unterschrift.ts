// Unterschrift für Briefe und PDFs: gezeichnet (Maus/Trackpad) oder eingescannt.
// Gespeichert wird ein PNG mit durchsichtigem Hintergrund, auf die Schrift zugeschnitten.
import { db } from '../db';

export interface Unterschrift { bild: string; name: string; funktion: string; drucken: boolean; breite: number; hoehe: number }

const SCHLUESSEL = ['unterschrift_bild', 'unterschrift_name', 'unterschrift_funktion', 'unterschrift_drucken', 'unterschrift_breite', 'unterschrift_hoehe'] as const;
type Schluessel = (typeof SCHLUESSEL)[number];

export async function unterschriftLaden(): Promise<Unterschrift | null> {
  const e = Object.fromEntries((await db.select(`SELECT schluessel, wert FROM einstellungen WHERE schluessel IN (${SCHLUESSEL.map((_, i) => '$' + (i + 1)).join(',')})`, [...SCHLUESSEL]))
    .map((r) => [r.schluessel, r.wert ?? '']));
  if (!e.unterschrift_bild && !e.unterschrift_name) return null;
  return { bild: e.unterschrift_bild ?? '', name: e.unterschrift_name ?? '', funktion: e.unterschrift_funktion ?? '', drucken: e.unterschrift_drucken !== '0',
    breite: Number(e.unterschrift_breite) || 0, hoehe: Number(e.unterschrift_hoehe) || 0 };
}

export async function unterschriftSpeichern(werte: Partial<Record<Schluessel, string>>) {
  for (const [k, v] of Object.entries(werte)) await db.execute(`INSERT INTO einstellungen (schluessel, wert) VALUES ($1, $2)
    ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert`, [k, v ?? '']);
}

/** Hellen Hintergrund durchsichtig machen, Strich dunkelblau/schwarz lassen und auf die Schrift zuschneiden */
export function freistellen(quelle: HTMLCanvasElement | HTMLImageElement, schwelle = 200): { bild: string; breite: number; hoehe: number } | null {
  const w = quelle instanceof HTMLCanvasElement ? quelle.width : quelle.naturalWidth;
  const h = quelle instanceof HTMLCanvasElement ? quelle.height : quelle.naturalHeight;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(quelle, 0, 0);
  const d = ctx.getImageData(0, 0, w, h); const p = d.data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const hell = (p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11) * (p[i + 3] / 255) + 255 * (1 - p[i + 3] / 255);
    if (hell >= schwelle) { p[i + 3] = 0; continue; }
    // weicher Rand: je heller, desto durchsichtiger
    p[i + 3] = Math.round(255 * Math.min(1, (schwelle - hell) / 90));
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  ctx.putImageData(d, 0, 0);
  const rand = 6;
  x0 = Math.max(0, x0 - rand); y0 = Math.max(0, y0 - rand); x1 = Math.min(w - 1, x1 + rand); y1 = Math.min(h - 1, y1 + rand);
  const z = document.createElement('canvas'); z.width = x1 - x0 + 1; z.height = y1 - y0 + 1;
  z.getContext('2d')!.drawImage(c, x0, y0, z.width, z.height, 0, 0, z.width, z.height);
  return { bild: z.toDataURL('image/png'), breite: z.width, hoehe: z.height };
}

/** Eingescannte Unterschrift (PNG/JPG) einlesen und freistellen */
export async function unterschriftAusDatei(datei: File) {
  if (!/^image\/(png|jpe?g)$/.test(datei.type) && !/\.(png|jpe?g)$/i.test(datei.name)) throw new Error('Bitte ein Foto oder einen Scan als PNG oder JPG wählen.');
  const url = URL.createObjectURL(datei);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fehler) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fehler(new Error('Bild konnte nicht gelesen werden.')); i.src = url; });
    // große Fotos verkleinern, damit die PDFs klein bleiben
    const f = Math.min(1, 1400 / img.naturalWidth);
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * f); c.height = Math.round(img.naturalHeight * f);
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    const r = freistellen(c, 170);
    if (!r) throw new Error('Auf dem Bild wurde keine Unterschrift erkannt.');
    return r;
  } finally { URL.revokeObjectURL(url); }
}
