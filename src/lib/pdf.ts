// Briefvorlage (angelehnt an DIN 5008) für Mahnungen und Abrechnungen.
import { jsPDF } from 'jspdf';
import autoTable, { type RowInput } from 'jspdf-autotable';
import { db } from '../db';
import { briefpapierLaden, type Briefpapier } from './briefpapier';

export interface Absender { name: string; strasse?: string; plz?: string; ort?: string; telefon?: string; email?: string; briefpapier?: Briefpapier | null }

export async function absender(): Promise<Absender> {
  const e = Object.fromEntries((await db.select('SELECT * FROM einstellungen')).map((r) => [r.schluessel, r.wert ?? '']));
  return { name: e.firma_name || 'KMS Immobilien', strasse: e.firma_strasse, plz: e.firma_plz, ort: e.firma_ort, telefon: e.firma_telefon, email: e.firma_email,
    briefpapier: await briefpapierLaden().catch(() => null) };
}

export const geld = (n: number) => (Math.abs(n) < 0.005 ? 0 : n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
export const dDatum = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

export class Brief {
  doc = new jsPDF({ unit: 'mm', format: 'a4' });
  y = 0;
  abs: Absender;
  private seiten = 0;
  private naechsteErste = false;
  constructor(abs: Absender) {
    this.abs = abs;
    const bp = abs.briefpapier;
    if (bp) {
      // Briefpapier liegt unter dem Text: beim Anlegen jeder Seite zuerst das Bild zeichnen
      this.hintergrund(bp.erste, 'bp-erste');
      (this.doc as any).internal.events.subscribe('addPage', () => {
        const erste = this.naechsteErste; this.naechsteErste = false;
        if (erste) this.hintergrund(bp.erste, 'bp-erste');
        else if (bp.folge) this.hintergrund(bp.folge, 'bp-folge');
      });
    }
  }

  private hintergrund(bild: string, alias: string) {
    this.doc.addImage(bild, 'JPEG', 0, 0, 210, 297, alias, 'FAST');
  }

  /** Unterer Rand (mm vom Seitenende), oberer Rand auf Folgeseiten */
  private get grenzeUnten() { return 297 - (this.abs.briefpapier?.unten ?? 27); }
  private get obenFolge() { return this.abs.briefpapier?.obenFolge ?? 25; }

  /** Weiteren Brief im selben Dokument beginnen (für eine Gesamtvorschau aller Abrechnungen) */
  neuerBrief() {
    if (this.seiten++ > 0) { this.naechsteErste = true; this.doc.addPage(); this.y = 0; }
    return this;
  }

  /** Schriftzug „ENTWURF“ quer über alle Seiten, solange die Abrechnung nicht abgeschlossen ist */
  entwurf(text = 'ENTWURF') {
    const d = this.doc, n = d.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      d.setPage(i); d.setFont('helvetica', 'bold'); d.setFontSize(80); d.setTextColor(225, 215, 200);
      d.text(text, 105, 170, { align: 'center', angle: 35 });
    }
    d.setTextColor(0); d.setFont('helvetica', 'normal'); d.setFontSize(10.5);
    return this;
  }

  kopf(empfaenger: string[], datum: string, ort?: string) {
    const d = this.doc;
    const bp = this.abs.briefpapier;
    if (!bp || bp.kopfDrucken) {
      d.setFont('helvetica', 'bold'); d.setFontSize(16); d.setTextColor(80); d.text(this.abs.name, 20, 20);
      d.setDrawColor(176, 138, 74); d.setLineWidth(0.6); d.line(20, 22, 20 + d.getTextWidth(this.abs.name), 22);
      d.setFont('helvetica', 'normal'); d.setFontSize(8.5); d.setTextColor(90);
      const zeile = [this.abs.strasse, [this.abs.plz, this.abs.ort].filter(Boolean).join(' '), this.abs.telefon, this.abs.email].filter(Boolean).join(' · ');
      if (zeile) d.text(zeile, 20, 25);
    }
    d.setFont('helvetica', 'normal'); d.setTextColor(90);
    // Rücksendeangabe und Anschriftfeld (Fensterumschlag DIN lang); beim Briefpapier steht die Rücksendeangabe meist schon drauf
    d.setFontSize(7); if (!bp || bp.kopfDrucken) d.text([this.abs.name, this.abs.strasse, [this.abs.plz, this.abs.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '), 20, 47);
    d.setTextColor(0); d.setFontSize(10.5);
    d.text(empfaenger.filter(Boolean), 20, 55);
    d.text(`${ort || this.abs.ort || ''}${ort || this.abs.ort ? ', ' : ''}${dDatum(datum)}`, 190, 90, { align: 'right' });
    this.y = 100;
  }

  betreff(text: string) {
    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(11.5);
    this.doc.text(text, 20, this.y); this.y += 10;
    this.doc.setFont('helvetica', 'normal'); this.doc.setFontSize(10.5);
  }

  absatz(text: string, abstand = 5) {
    const lines = this.doc.splitTextToSize(text, 170);
    this.platz(lines.length * 5);
    this.doc.text(lines, 20, this.y);
    this.y += lines.length * 5 + abstand;
  }

  tabelle(head: string[], body: RowInput[], foot?: RowInput[], rechtsAb = 1) {
    const align: Record<number, { halign: 'right'; cellWidth: 'wrap' }> = {};
    for (let i = rechtsAb; i < head.length; i++) align[i] = { halign: 'right', cellWidth: 'wrap' };
    autoTable(this.doc, {
      startY: this.y, head: [head], body, foot, showFoot: 'lastPage', margin: { left: 20, right: 20, top: this.abs.briefpapier ? this.obenFolge : 15, bottom: this.abs.briefpapier ? 297 - this.grenzeUnten : 15 },
      styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 1.8 },
      headStyles: { fillColor: [176, 138, 74], textColor: 255 },
      footStyles: { fillColor: [248, 240, 227], textColor: 0, fontStyle: 'bold' },
      columnStyles: align,
      didParseCell: (h) => { if (h.section !== 'body' && h.column.index >= rechtsAb) h.cell.styles.halign = 'right'; },
    });
    this.y = (this.doc as any).lastAutoTable.finalY + 8;
  }

  platz(mm: number) {
    if (this.y + mm > this.grenzeUnten) { this.doc.addPage(); this.y = this.obenFolge; }
  }

  gruss() {
    this.platz(25);
    this.doc.text(['Mit freundlichen Grüßen', '', this.abs.name], 20, this.y);
    this.y += 20;
  }

  bytes(): Uint8Array { return new Uint8Array(this.doc.output('arraybuffer')); }
}

/** Liste als PDF im Querformat (Mieterliste, Eigentümerliste, Journal …) */
export async function listePdf(titel: string, untertitel: string, head: string[], body: RowInput[], foot?: RowInput[], rechts: number[] = []): Promise<Uint8Array> {
  const abs = await absender();
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(80); doc.text(abs.name, 15, 16);
  doc.setDrawColor(176, 138, 74); doc.setLineWidth(0.6); doc.line(15, 18, 15 + doc.getTextWidth(abs.name), 18);
  doc.setTextColor(0); doc.setFontSize(13); doc.text(titel, 15, 28);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100); doc.text(untertitel, 15, 34); doc.setTextColor(0);
  const cs: Record<number, { halign: 'right' }> = {};
  for (const i of rechts) cs[i] = { halign: 'right' };
  autoTable(doc, {
    startY: 40, head: [head], body, foot, showFoot: 'lastPage', margin: { left: 15, right: 15 },
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.6 },
    headStyles: { fillColor: [176, 138, 74], textColor: 255 },
    footStyles: { fillColor: [248, 240, 227], textColor: 0, fontStyle: 'bold' },
    columnStyles: cs,
    didParseCell: (h) => { if (h.section !== 'body' && rechts.includes(h.column.index)) h.cell.styles.halign = 'right'; },
    didDrawPage: () => { doc.setFontSize(7.5); doc.setTextColor(120); doc.text(`Erstellt am ${new Date().toLocaleDateString('de-DE')} · Seite ${doc.getNumberOfPages()}`, 282, 203, { align: 'right' }); doc.setTextColor(0); },
  });
  return new Uint8Array(doc.output('arraybuffer'));
}

/** CSV mit Semikolon und BOM (öffnet sich in Excel korrekt) */
export function csv(head: string[], rows: (string | number | null | undefined)[][]): Uint8Array {
  const esc = (v: any) => { const t = v == null ? '' : typeof v === 'number' ? v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }) : String(v); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const text = '\uFEFF' + [head, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
  return new TextEncoder().encode(text);
}
