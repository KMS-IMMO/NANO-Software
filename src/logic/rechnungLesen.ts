import { pdfjsLaden } from '../lib/pdfjs';
// Rechnung auslesen: Text aus der PDF holen und die wichtigsten Angaben erkennen.
// Funktioniert bei PDFs mit Textebene (die meisten digitalen Rechnungen). Gescannte Bilder enthalten keinen Text.

export interface Erkannt {
  lieferant?: string; rechnungsnr?: string; datum?: string; faellig?: string;
  betrag?: number; mwst?: number; lohn?: number; iban?: string;
}

/** Text einer PDF, Zeile für Zeile (Textstücke mit gleicher Höhe werden zu einer Zeile) */
export async function pdfText(daten: Uint8Array, maxSeiten = 4): Promise<string> {
  const pdfjs = await pdfjsLaden();
  const task = pdfjs.getDocument({ data: daten.slice() });
  const doc = await task.promise;
  const zeilen: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxSeiten); i++) {
    const inhalt = await (await doc.getPage(i)).getTextContent();
    const nachY = new Map<number, { x: number; s: string }[]>();
    for (const it of inhalt.items as any[]) {
      if (!it.str?.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      (nachY.get(y) ?? nachY.set(y, []).get(y)!).push({ x: it.transform[4], s: it.str });
    }
    [...nachY.entries()].sort((a, b) => b[0] - a[0])
      .forEach(([, t]) => zeilen.push(t.sort((a, b) => a.x - b.x).map((x) => x.s.trim()).join(' ')));
  }
  await task.destroy();
  return zeilen.join('\n');
}

const BETRAG = /(-?\d{1,3}(?:[.\s]\d{3})*,\d{2}|-?\d+,\d{2}|-?\d{1,3}(?:,\d{3})*\.\d{2})(?!\d)/g;
const DATUM = /(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2,4})/;

export function geld(s: string): number {
  const t = s.replace(/\s/g, '');
  if (/,\d{2}$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
  return Number(t.replace(/,/g, ''));
}
function isoDatum(m: RegExpMatchArray | null): string | undefined {
  if (!m) return;
  const j = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = `${j}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return isNaN(Date.parse(d)) || j < 2000 || j > 2100 ? undefined : d;
}
/** erster Betrag in der Zeile nach dem Stichwort (oder in der Folgezeile) */
function betragNach(zeilen: string[], muster: RegExp): number | undefined {
  for (let i = zeilen.length - 1; i >= 0; i--) {   // von unten: die Endsumme steht meist am Schluss
    const m = zeilen[i].match(muster);
    if (!m) continue;
    const rest = zeilen[i].slice((m.index ?? 0) + m[0].length);
    const b = [...rest.matchAll(BETRAG)].map((x) => geld(x[1])).filter((x) => !isNaN(x));
    if (b.length) return b[b.length - 1];
    const n = [...(zeilen[i + 1] ?? '').matchAll(BETRAG)].map((x) => geld(x[1]));
    if (n.length) return n[n.length - 1];
  }
}

export function erkennen(text: string, firmen: { id: number; name: string }[] = []): Erkannt & { firmaId?: number } {
  const zeilen = text.split('\n').map((z) => z.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const e: Erkannt & { firmaId?: number } = {};

  const nr = text.match(/(?:Rechnungs?[- ]?(?:nummer|nr\.?)|Rechnung\s+Nr\.?|Beleg[- ]?(?:nummer|nr\.?)|Invoice\s*(?:No\.?|Number))\s*[:#.]?\s*([A-Z0-9][A-Z0-9\-/._]{2,30})/i);
  if (nr && /\d/.test(nr[1])) e.rechnungsnr = nr[1].replace(/[.,]$/, '');

  e.datum = isoDatum(text.match(new RegExp('(?:Rechnungsdatum|Belegdatum|Datum der Rechnung|Datum)\\s*:?\\s*' + DATUM.source, 'i')))
    ?? isoDatum(text.match(DATUM));

  const fae = text.match(new RegExp('(?:zahlbar\\s+(?:bis|zum)|fällig\\s+(?:am|bis|zum)?|Fälligkeit(?:sdatum)?|Zahlungsziel)\\D{0,20}' + DATUM.source, 'i'));
  e.faellig = isoDatum(fae ? [fae[0], fae[1], fae[2], fae[3]] as any : null);
  if (!e.faellig && e.datum) {
    const tage = text.match(/innerhalb\s+(?:von\s+)?(\d{1,3})\s+Tagen/i);
    if (tage) { const d = new Date(e.datum); d.setDate(d.getDate() + Number(tage[1])); e.faellig = d.toISOString().slice(0, 10); }
  }

  e.betrag = betragNach(zeilen, /(Gesamtbetrag|Rechnungsbetrag|Endbetrag|Gesamtsumme|zu zahlen(?:der Betrag)?|Zahlbetrag|Bruttobetrag|Summe brutto|Brutto|Gesamt|Total)\b[^\d-]*/i);
  if (e.betrag === undefined) {
    const alle = [...text.matchAll(BETRAG)].map((x) => geld(x[1])).filter((x) => !isNaN(x));
    if (alle.length) e.betrag = Math.max(...alle);
  }

  const mw = text.match(/(\d{1,2})(?:[,.]\d+)?\s*%\s*(?:MwSt|USt|Mehrwertsteuer|Umsatzsteuer)/i) ?? text.match(/(?:MwSt|USt|Mehrwertsteuer|Umsatzsteuer)\.?\s*(\d{1,2})(?:[,.]\d+)?\s*%/i);
  if (mw) e.mwst = Number(mw[1]);
  else if (/(steuerfrei|§\s*19\s*UStG|Kleinunternehmer)/i.test(text)) e.mwst = 0;

  e.lohn = betragNach(zeilen, /(Arbeits(?:kosten|lohn|leistung(?:en)?)|Lohn(?:anteil|kosten)|Anteil\s+Lohn|§\s*35a)[^\d-]*/i);

  const iban = text.match(/\b(DE\d{2}(?:\s?\d{4}){4}\s?\d{2})\b/);
  if (iban) e.iban = iban[1].replace(/\s/g, '');

  const klein = text.toLowerCase();
  const f = [...firmen].sort((a, b) => b.name.length - a.name.length).find((x) => x.name.length > 2 && klein.includes(x.name.toLowerCase()));
  if (f) { e.firmaId = f.id; e.lieferant = f.name; }
  else {
    const kopf = zeilen.slice(0, 8).find((z) => z.length > 2 && !/rechnung|seite|datum|kunde|^\d/i.test(z) && /[a-zäöü]/i.test(z) && !BETRAG.test(z));
    BETRAG.lastIndex = 0;
    if (kopf) e.lieferant = kopf.split(/\s[·|•-]\s/)[0].slice(0, 80);
  }
  return e;
}
