// DATEV-Export (Buchungsstapel im DATEV-Format, Version 700) für den Steuerberater.
// Je Liegenschaft und Zeitraum eine CSV-Datei, dazu die Belege in einem Ordner daneben.
import { db, type Row } from '../db';
import { ablagePfad, sicher } from '../lib/dateien';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const DATEV_EINST: [string, string, string][] = [
  ['datev_berater', 'DATEV Beraternummer', ''],
  ['datev_mandant', 'DATEV Mandantennummer (Standard, je Export änderbar)', ''],
  ['datev_kontolaenge', 'Sachkontenlänge', '4'],
  ['datev_bankkonto', 'Gegenkonto Bank (Finanzkonto beim Steuerberater)', '1200'],
];

/** Windows-1252, so wie DATEV die Datei erwartet */
function ansi(text: string): Uint8Array {
  const sonder: Record<string, number> = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '–': 0x96, '—': 0x97 };
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = c.charCodeAt(0);
    out[i] = sonder[c] ?? (n < 256 ? n : 0x3f);
  }
  return out;
}

const q = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
const betrag = (n: number) => Math.abs(n).toFixed(2).replace('.', ',');
const ddmm = (d: string) => d.slice(8, 10) + d.slice(5, 7);
const yyyymmdd = (d: string) => d.replace(/-/g, '');
/** Belegfeld 1: max. 36 Zeichen, nur Buchstaben, Ziffern und $&%*+-/ */
const belegfeld = (s: string) => s.replace(/[^A-Za-z0-9$&%*+\-/]/g, '').slice(0, 36);

export type DatevErgebnis = { csv: Uint8Array; dateiname: string; buchungen: number; belege: { quelle: string; ziel: string }[]; ohneKonto: number };

export async function datevExport(objektId: number, von: string, bis: string, mandant: string): Promise<DatevErgebnis> {
  const e = Object.fromEntries((await db.select(`SELECT schluessel, wert FROM einstellungen WHERE schluessel LIKE 'datev_%'`)).map((r) => [r.schluessel, r.wert ?? '']));
  const wert = (k: string) => e[k] || DATEV_EINST.find((x) => x[0] === k)![2];
  const laenge = Number(wert('datev_kontolaenge')) || 4;
  const bank = wert('datev_bankkonto');
  const objekt = (await db.select('SELECT name FROM objekte WHERE id = $1', [objektId]))[0]?.name ?? 'Liegenschaft';
  const rows: Row[] = await db.select(`SELECT b.*, k.nummer, COALESCE(f.name, rf.name) AS firma, r.rechnungsnr, e.nummer AS einheit
    FROM buchungen b LEFT JOIN buchungskonten k ON k.id = b.buchungskonto_id LEFT JOIN rechnungen r ON r.id = b.rechnung_id
    LEFT JOIN firmen f ON f.id = b.firma_id LEFT JOIN firmen rf ON rf.id = r.firma_id LEFT JOIN einheiten e ON e.id = b.einheit_id
    WHERE b.objekt_id = $1 AND b.datum BETWEEN $2 AND $3 ORDER BY b.datum, b.id`, [objektId, von, bis]);
  const docs: Row[] = await db.select(`
    SELECT d.bezug_id AS buchung_id, d.pfad, d.dateiname FROM dokumente d JOIN buchungen b ON b.id = d.bezug_id
      WHERE d.bezug = 'Buchung' AND b.objekt_id = $1 AND b.datum BETWEEN $2 AND $3
    UNION ALL SELECT b.id, d.pfad, d.dateiname FROM buchungen b JOIN rechnungen r ON r.id = b.rechnung_id JOIN dokumente d ON d.id = r.dokument_id
      WHERE b.objekt_id = $1 AND b.datum BETWEEN $2 AND $3`, [objektId, von, bis]);

  const jahr = von.slice(0, 4);
  const jetzt = new Date();
  const erzeugt = jetzt.toISOString().replace(/[-:T]/g, '').slice(0, 14) + '000';
  const kopf = ['"EXTF"', 700, 21, '"Buchungsstapel"', 13, erzeugt, '', '"RE"', '"NANO"', '""', wert('datev_berater') || '', mandant || '',
    `${jahr}0101`, laenge, yyyymmdd(von), yyyymmdd(bis), q(`NANO ${objekt}`.slice(0, 30)), '""', 1, 0, 0, '"EUR"', '', '""', '', '', '""', '""', '', '', '""'].join(';');
  const spalten = ['Umsatz (ohne Soll/Haben-Kz)', 'Soll/Haben-Kennzeichen', 'WKZ Umsatz', 'Kurs', 'Basis-Umsatz', 'WKZ Basis-Umsatz', 'Konto',
    'Gegenkonto (ohne BU-Schlüssel)', 'BU-Schlüssel', 'Belegdatum', 'Belegfeld 1', 'Belegfeld 2', 'Skonto', 'Buchungstext'].join(';');
  let ohneKonto = 0;
  const zeilen = rows.filter((r) => Number(r.betrag) !== 0).map((r) => {
    if (!r.nummer) ohneKonto++;
    const konto = String(r.nummer ?? '').padStart(laenge, '0');
    const text = (r.firma && !String(r.text ?? '').includes(r.firma) ? `${r.firma} ${r.text ?? ''}` : String(r.text ?? r.firma ?? '')).replace(/\s+/g, ' ').slice(0, 60);
    // Konto = Sachkonto, Gegenkonto = Bank. Ausgabe: Sachkonto im Soll, Einnahme: im Haben
    return [betrag(r.betrag), r.betrag < 0 ? '"S"' : '"H"', '"EUR"', '', '', '', konto, bank, '""', ddmm(r.datum),
      q(belegfeld(r.rechnungsnr || `BU${r.id}`)), q(r.einheit ?? ''), '', q(text)].join(';');
  });
  const csv = ansi([kopf, spalten, ...zeilen].join('\r\n') + '\r\n');
  const name = `EXTF_Buchungsstapel ${sicher(objekt)} ${von} bis ${bis}`;
  const nr = new Map(rows.map((r) => [r.id, belegfeld(r.rechnungsnr || `BU${r.id}`)]));
  const belege = docs.filter((d) => nr.has(d.buchung_id)).map((d) => ({ quelle: d.pfad, ziel: `${nr.get(d.buchung_id)} ${sicher(d.dateiname)}` }));
  return { csv, dateiname: name, buchungen: zeilen.length, belege, ohneKonto };
}

/** Schreibt CSV und Belege in <Ablage>/DATEV/<Name>/ (Desktop-App) bzw. lädt die CSV herunter (Vorschau) */
export async function datevSpeichern(x: DatevErgebnis): Promise<{ ordner: string; kopiert: number; fehlend: number }> {
  if (!isTauri) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([x.csv], { type: 'text/csv' })); a.download = x.dateiname + '.csv'; a.click();
    return { ordner: 'Downloads', kopiert: 0, fehlend: x.belege.length };
  }
  const { join } = await import('@tauri-apps/api/path');
  const { mkdir, writeFile, copyFile } = await import('@tauri-apps/plugin-fs');
  const ordner = await join(await ablagePfad(), 'DATEV', x.dateiname);
  await mkdir(await join(ordner, 'Belege'), { recursive: true });
  await writeFile(await join(ordner, x.dateiname + '.csv'), x.csv);
  let kopiert = 0, fehlend = 0;
  for (const b of x.belege) {
    try { await copyFile(b.quelle, await join(ordner, 'Belege', b.ziel)); kopiert++; } catch { fehlend++; }
  }
  return { ordner, kopiert, fehlend };
}
