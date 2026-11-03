// Dateien speichern und öffnen. Desktop-App: direkt im Ablageordner (später NAS).
// Browser-Vorschau: normaler Download.
import { db } from '../db';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Erlaubte Zeichen für Datei- und Ordnernamen unter Windows und macOS */
export const sicher = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);

export async function ablagePfad(): Promise<string> {
  const r = (await db.select(`SELECT wert FROM einstellungen WHERE schluessel = 'ablage_pfad'`))[0];
  if (r?.wert) return r.wert;
  const { documentDir, join } = await import('@tauri-apps/api/path');
  return join(await documentDir(), 'NANO-Ablage');
}

export interface Ablage { bezug: 'Objekt' | 'Einheit' | 'Person' | 'Mietvertrag' | 'Firma'; bezugId: number; ordner: string[] }

/**
 * Speichert eine Datei in der Ablage: <Ablage>/<ordner...>/<dateiname>
 * und trägt sie in die Dokumentenliste ein. Gibt den vollständigen Pfad zurück.
 */
export async function speichern(daten: Uint8Array, dateiname: string, ablage: Ablage): Promise<string> {
  const name = sicher(dateiname);
  if (!isTauri) {
    const blob = new Blob([daten], { type: name.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    await eintragen(ablage, name, name);
    return name;
  }
  const { join } = await import('@tauri-apps/api/path');
  const { mkdir, writeFile } = await import('@tauri-apps/plugin-fs');
  const dir = await join(await ablagePfad(), ...ablage.ordner.map(sicher));
  await mkdir(dir, { recursive: true });
  const pfad = await join(dir, name);
  await writeFile(pfad, daten);
  await eintragen(ablage, name, pfad);
  return pfad;
}

async function eintragen(a: Ablage, name: string, pfad: string) {
  await db.execute(`INSERT INTO dokumente (bezug, bezug_id, ordner, dateiname, pfad) VALUES ($1, $2, $3, $4, $5)`,
    [a.bezug, a.bezugId, a.ordner.slice(1).join('/'), name, pfad]);
}

export async function oeffnen(pfad: string) {
  if (!isTauri) return;
  const { openPath } = await import('@tauri-apps/plugin-opener');
  await openPath(pfad);
}
