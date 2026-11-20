// Tabellen aus Excel (.xlsx) oder CSV lesen: erstes Tabellenblatt, erste Zeile = Überschriften.
import { unzipSync, strFromU8 } from 'fflate';

export type Tabelle = { spalten: string[]; zeilen: string[][] };

/** Excel-Datum (Tage seit 1899-12-30) als JJJJ-MM-TT */
const excelDatum = (n: number) => new Date(Date.UTC(1899, 11, 30) + Math.round(n * 864e5)).toISOString().slice(0, 10);

function spaltenIndex(ref: string) {
  const b = ref.replace(/\d+/g, ''); let n = 0;
  for (const c of b) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function xlsxLesen(daten: Uint8Array): string[][] {
  const z = unzipSync(daten);
  const xml = (p: string) => (z[p] ? new DOMParser().parseFromString(strFromU8(z[p]), 'application/xml') : null);
  const texte = [...(xml('xl/sharedStrings.xml')?.getElementsByTagName('si') ?? [])].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent ?? '').join(''));
  // Datumsformate erkennen (Zellstil mit Datums-Zahlenformat)
  const st = xml('xl/styles.xml');
  const eigene = new Map([...(st?.getElementsByTagName('numFmt') ?? [])].map((f) => [Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') ?? '']));
  const istDatum = (id: number) => (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || /[dmy]/i.test((eigene.get(id) ?? '').replace(/"[^"]*"|\[[^\]]*\]/g, ''));
  const xfs = [...(st?.getElementsByTagName('cellXfs')[0]?.getElementsByTagName('xf') ?? [])].map((x) => istDatum(Number(x.getAttribute('numFmtId'))));
  // erstes Blatt laut workbook.xml
  const wb = xml('xl/workbook.xml'), rels = xml('xl/_rels/workbook.xml.rels');
  const rid = wb?.getElementsByTagName('sheet')[0]?.getAttribute('r:id');
  const ziel = [...(rels?.getElementsByTagName('Relationship') ?? [])].find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target');
  const pfad = ziel ? (ziel.startsWith('/') ? ziel.slice(1) : 'xl/' + ziel.replace(/^\.\//, '')) : 'xl/worksheets/sheet1.xml';
  const blatt = xml(pfad) ?? xml('xl/worksheets/sheet1.xml');
  if (!blatt) throw new Error('In der Excel-Datei wurde kein Tabellenblatt gefunden.');
  const zeilen: string[][] = [];
  for (const r of blatt.getElementsByTagName('row')) {
    const z: string[] = [];
    for (const c of r.getElementsByTagName('c')) {
      const i = spaltenIndex(c.getAttribute('r') ?? 'A1'), t = c.getAttribute('t'), s = Number(c.getAttribute('s') ?? 0);
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      let wert = v;
      if (t === 's') wert = texte[Number(v)] ?? '';
      else if (t === 'inlineStr') wert = [...c.getElementsByTagName('t')].map((x) => x.textContent ?? '').join('');
      else if (t === 'b') wert = v === '1' ? 'Ja' : 'Nein';
      else if (v !== '' && (!t || t === 'n') && xfs[s]) wert = excelDatum(Number(v));
      z[i] = wert.trim();
    }
    zeilen.push(Array.from(z, (x) => x ?? ''));
  }
  return zeilen;
}

function csvLesen(text: string): string[][] {
  const erste = text.split(/\r?\n/)[0] ?? '';
  const trenn = [';', '\t', ','].sort((a, b) => erste.split(b).length - erste.split(a).length)[0];
  const zeilen: string[][] = []; let z: string[] = [], feld = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { feld += '"'; i++; } else inQ = false; } else feld += c; continue; }
    if (c === '"') inQ = true;
    else if (c === trenn) { z.push(feld.trim()); feld = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; z.push(feld.trim()); zeilen.push(z); z = []; feld = ''; }
    else feld += c;
  }
  if (feld || z.length) { z.push(feld.trim()); zeilen.push(z); }
  return zeilen;
}

export async function tabelleLesen(datei: File): Promise<Tabelle> {
  const bytes = new Uint8Array(await datei.arrayBuffer());
  let roh: string[][];
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) roh = xlsxLesen(bytes);
  else if (/\.xls$/i.test(datei.name)) throw new Error('Das alte Excel-Format (.xls) wird nicht unterstützt. Bitte in Excel als .xlsx oder CSV speichern.');
  else {
    let text = new TextDecoder('utf-8').decode(bytes);
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(bytes);
    roh = csvLesen(text.replace(/^\uFEFF/, ''));
  }
  roh = roh.filter((z) => z.some((x) => x !== ''));
  if (roh.length < 2) throw new Error('Die Tabelle braucht eine Überschriftenzeile und mindestens eine Datenzeile.');
  const breite = Math.max(...roh.map((z) => z.length));
  const spalten = Array.from({ length: breite }, (_, i) => roh[0][i] || `Spalte ${i + 1}`);
  return { spalten, zeilen: roh.slice(1).map((z) => Array.from({ length: breite }, (_, i) => z[i] ?? '')) };
}

/** Datum aus 31.12.2025, 31.12.25 oder 2025-12-31 als JJJJ-MM-TT, sonst null */
export function datumLesen(s: string): string | null {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  // Excel-Datum als Zahl (Zelle ohne Datumsformat), z. B. 45352 = 01.03.2024
  if (/^\d{5}(\.\d+)?$/.test(t) && Number(t) > 20000 && Number(t) < 80000) return excelDatum(Number(t));
  const m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (!m) return null;
  const j = m[3].length === 2 ? (Number(m[3]) > 50 ? '19' : '20') + m[3] : m[3];
  return `${j}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}
