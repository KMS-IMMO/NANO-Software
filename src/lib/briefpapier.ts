import { pdfjsLaden } from './pdfjs';
// Briefpapier: eigene Vorlage (PDF oder Bild) als Hintergrund für alle Briefe und Abrechnungen.
// Die Vorlage wird beim Hochladen in ein A4-Bild umgewandelt (Seite 1 = erste Seite, Seite 2 = Folgeseiten)
// und in den Einstellungen gespeichert. Die PDFs legen das Bild auf jeder Seite unter den Text.
import { db } from '../db';

export interface Briefpapier {
  erste: string;            // JPEG als data-URL
  folge?: string;           // eigene Folgeseite, sonst leer
  name?: string;
  kopfDrucken: boolean;     // Firmenname und Kontaktzeile von NEOSS zusätzlich drucken
  obenFolge: number;        // mm: Textbeginn auf Folgeseiten
  unten: number;            // mm: freier Rand unten (Fußzeile des Briefpapiers)
}

const BREITE = 1240, HOEHE = 1754; // A4 bei 150 dpi


/** Seiten einer PDF als Bilder (data-URL), z. B. für Vorschauen */
export async function pdfSeitenAlsBilder(daten: Uint8Array, maxSeiten = 2, breite = BREITE, typ = 'image/jpeg'): Promise<string[]> {
  const pdfjs = await pdfjsLaden();
  const task = pdfjs.getDocument({ data: daten.slice() });
  const doc = await task.promise;
  const bilder: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxSeiten); i++) {
    const seite = await doc.getPage(i);
    const v1 = seite.getViewport({ scale: 1 });
    const vp = seite.getViewport({ scale: breite / v1.width });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await seite.render({ canvasContext: ctx, viewport: vp, canvas: c } as any).promise;
    bilder.push(c.toDataURL(typ, 0.88));
  }
  await task.destroy();
  return bilder;
}

/** Bild auf A4 (weißer Grund) bringen und als JPEG liefern */
async function bildAufA4(datei: Blob): Promise<string> {
  const url = URL.createObjectURL(datei);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fehler) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fehler(new Error('Bild konnte nicht gelesen werden.')); i.src = url; });
    const c = document.createElement('canvas'); c.width = BREITE; c.height = HOEHE;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, BREITE, HOEHE);
    const f = Math.min(BREITE / img.width, HOEHE / img.height);
    ctx.drawImage(img, (BREITE - img.width * f) / 2, 0, img.width * f, img.height * f);
    return c.toDataURL('image/jpeg', 0.88);
  } finally { URL.revokeObjectURL(url); }
}

/** Hochgeladene Datei in Briefpapier-Bilder umwandeln. PDF: Seite 1 und (falls vorhanden) Seite 2 als Folgeseite. */
export async function briefpapierAusDatei(datei: File): Promise<{ erste: string; folge?: string }> {
  if (datei.type === 'application/pdf' || /\.pdf$/i.test(datei.name)) {
    const s = await pdfSeitenAlsBilder(new Uint8Array(await datei.arrayBuffer()), 2);
    if (!s.length) throw new Error('Die PDF hat keine Seite.');
    return { erste: s[0], folge: s[1] };
  }
  if (/^image\//.test(datei.type) || /\.(png|jpe?g)$/i.test(datei.name)) return { erste: await bildAufA4(datei) };
  throw new Error('Bitte eine PDF, PNG oder JPG wählen.');
}

const SCHLUESSEL = ['briefpapier_erste', 'briefpapier_folge', 'briefpapier_name', 'briefpapier_kopf', 'briefpapier_oben_folge', 'briefpapier_unten'];

export async function briefpapierLaden(): Promise<Briefpapier | null> {
  const e = Object.fromEntries((await db.select(`SELECT schluessel, wert FROM einstellungen WHERE schluessel IN (${SCHLUESSEL.map((_, i) => '$' + (i + 1)).join(',')})`, SCHLUESSEL))
    .map((r) => [r.schluessel, r.wert ?? '']));
  if (!e.briefpapier_erste) return null;
  return {
    erste: e.briefpapier_erste, folge: e.briefpapier_folge || undefined, name: e.briefpapier_name || undefined,
    kopfDrucken: e.briefpapier_kopf === '1',
    obenFolge: Number(e.briefpapier_oben_folge) || 25, unten: Number(e.briefpapier_unten) || 27,
  };
}

export async function briefpapierSpeichern(werte: Partial<Record<(typeof SCHLUESSEL)[number], string>>) {
  for (const [k, v] of Object.entries(werte)) await db.execute(`INSERT INTO einstellungen (schluessel, wert) VALUES ($1, $2)
    ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert`, [k, v ?? '']);
}
