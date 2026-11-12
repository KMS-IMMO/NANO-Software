// Briefvorlage (angelehnt an DIN 5008) für Mahnungen und Abrechnungen.
import { jsPDF } from 'jspdf';
import autoTable, { type RowInput } from 'jspdf-autotable';
import { db } from '../db';
import { briefpapierLaden, type Briefpapier } from './briefpapier';
import { unterschriftLaden, type Unterschrift } from './unterschrift';
import { logoPng } from '../components/logoPfade';

export interface Absender { name: string; strasse?: string; plz?: string; ort?: string; telefon?: string; email?: string; briefpapier?: Briefpapier | null; unterschrift?: Unterschrift | null; logo?: string | null }

export async function absender(): Promise<Absender> {
  const e = Object.fromEntries((await db.select('SELECT * FROM einstellungen')).map((r) => [r.schluessel, r.wert ?? '']));
  return { name: e.firma_name || 'KMS Immobilien', strasse: e.firma_strasse, plz: e.firma_plz, ort: e.firma_ort, telefon: e.firma_telefon, email: e.firma_email,
    briefpapier: await briefpapierLaden().catch(() => null), unterschrift: await unterschriftLaden().catch(() => null), logo: await logoPng(1200).catch(() => null) };
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
  get grenzeUnten() { return 297 - (this.abs.briefpapier?.unten ?? 27); }
  get obenFolge() { return this.abs.briefpapier?.obenFolge ?? 25; }

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
      this.firmenkopf();
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

  /** Angaben nach § 35a EStG mit den Hinweisen nach Gesetz (Abs. 1 bis 5) und BMF-Schreiben vom 9. November 2016 */
  steuer35a(w: { hbg?: number; hdl: number; hwl: number }, fuer: 'eigentuemer' | 'mieter') {
    const zeilen: string[][] = [];
    if (w.hbg) zeilen.push(['Geringfügige Beschäftigung im Haushalt (§ 35a Abs. 1 EStG)', geld(w.hbg)]);
    zeilen.push(['Haushaltsnahe Dienstleistungen und Beschäftigungsverhältnisse (§ 35a Abs. 2 EStG)', geld(w.hdl)]);
    zeilen.push(['Handwerkerleistungen für Renovierung, Erhaltung und Modernisierung (§ 35a Abs. 3 EStG)', geld(w.hwl)]);
    this.platz(95);
    this.tabelle(['Bescheinigung nach § 35a EStG: Ihr Anteil an den Arbeitskosten', 'Betrag'], zeilen);
    this.y -= 4;
    const d = this.doc;
    d.setFontSize(8); d.setTextColor(85);
    const hinweise = [
      'Angegeben sind nur Arbeitskosten einschließlich der in Rechnung gestellten Maschinen- und Fahrtkosten und der darauf entfallenden Umsatzsteuer. Material und gelieferte Waren sind nicht begünstigt (§ 35a Abs. 5 Satz 2 EStG).',
      'Für alle Aufwendungen liegen Rechnungen vor, die Zahlungen sind unbar auf das Konto der Leistungserbringer erfolgt (§ 35a Abs. 5 Satz 3 EStG).',
      'Die Einkommensteuer ermäßigt sich auf Antrag um 20 % der Aufwendungen, höchstens um 510 € (Abs. 1), 4.000 € (Abs. 2) und 1.200 € (Abs. 3) im Jahr. Leben zwei Alleinstehende in einem Haushalt zusammen, gelten die Höchstbeträge nur einmal (Abs. 5 Satz 4).',
      'Ausgeschlossen ist die Ermäßigung, soweit die Aufwendungen Betriebsausgaben oder Werbungskosten sind (z. B. bei einer vermieteten Wohnung) oder als Sonderausgaben oder außergewöhnliche Belastungen berücksichtigt werden (Abs. 5 Satz 1), und bei öffentlich geförderten Maßnahmen mit zinsverbilligten Darlehen oder steuerfreien Zuschüssen (Abs. 3 Satz 2). Die Leistung muss in einem Haushalt in der EU oder im EWR erbracht werden (Abs. 4).',
      fuer === 'eigentuemer'
        ? 'Maßgeblich ist grundsätzlich das Jahr der Zahlung. Nach dem BMF-Schreiben vom 9. November 2016 können Wohnungseigentümer ihren Anteil auch insgesamt in dem Jahr geltend machen, in dem die Eigentümerversammlung die Jahresabrechnung beschlossen hat.'
        : 'Als Mieter können Sie Ihren Anteil mit dieser Nebenkostenabrechnung geltend machen (BMF-Schreiben vom 9. November 2016; BFH, Urteil vom 20. April 2023, VI R 24/20). Maßgeblich ist grundsätzlich das Jahr der Zahlung.',
      'Diese Angaben ersetzen keine Steuerberatung. Ob und in welcher Höhe die Ermäßigung zusteht, entscheidet das Finanzamt.',
    ];
    for (const h of hinweise) {
      const l = d.splitTextToSize(h, 166);
      this.platz(l.length * 3.5 + 1);
      d.text('•', 20, this.y); d.text(l, 24, this.y);
      this.y += l.length * 3.5 + 1.2;
    }
    d.setFontSize(10.5); d.setTextColor(0);
    this.y += 5;
  }

  gruss() {
    const u = this.abs.unterschrift;
    if (!u || !u.drucken || (!u.bild && !u.name)) {
      this.platz(25);
      this.doc.text(['Mit freundlichen Grüßen', '', this.abs.name], 20, this.y);
      this.y += 20;
      return;
    }
    this.platz(40);
    this.doc.text('Mit freundlichen Grüßen', 20, this.y);
    this.unterschrift(20, this.y + 3);
  }

  /** Unterschrift mit Name, Funktion und Firma ab Position y (oberer Rand des Bildes) */
  unterschrift(x: number, y: number) {
    const d = this.doc, u = this.abs.unterschrift;
    let unten = y + 4;
    if (u?.bild) {
      const ratio = u.breite && u.hoehe ? u.breite / u.hoehe : 3.3;
      let h = 15, w = h * ratio;
      if (w > 70) { w = 70; h = w / ratio; }
      d.addImage(u.bild, 'PNG', x, y + (15 - h), w, h, 'unterschrift', 'FAST');
      unten = y + 16;
    }
    d.setDrawColor(150); d.setLineWidth(0.2); d.line(x, unten, x + 70, unten);
    d.setFontSize(9.5); d.setTextColor(0);
    const zeilen = [u?.name, u?.funktion, this.abs.name].filter((z, i, a) => z && a.indexOf(z) === i) as string[];
    d.text(zeilen[0] ?? this.abs.name, x, unten + 4.5);
    d.setTextColor(95); d.setFontSize(8.5);
    if (zeilen.length > 1) d.text(zeilen.slice(1), x, unten + 8.8);
    d.setTextColor(0); d.setFontSize(10.5);
    this.y = unten + 6 + zeilen.length * 4;
  }

  /** Ohne Briefpapier: originales Logo oben rechts, sonst der Firmenname */
  private firmenkopf() {
    const d = this.doc;
    if (this.abs.logo) { d.addImage(this.abs.logo, 'PNG', 148, 10, 42, 42 * 616 / 1182, 'kms-logo', 'FAST'); return; }
    d.setFont('helvetica', 'bold'); d.setFontSize(16); d.setTextColor(80); d.text(this.abs.name, 20, 20);
    d.setDrawColor(176, 138, 74); d.setLineWidth(0.6); d.line(20, 22, 20 + d.getTextWidth(this.abs.name), 22);
  }

  /** Kopf für Berichte und Stammblätter: Titel statt Anschriftfeld */
  berichtKopf(titel: string, zeilen: string[], datum: string) {
    const d = this.doc, bp = this.abs.briefpapier;
    let y = bp ? 47 : 50;
    if (!bp || bp.kopfDrucken) {
      this.firmenkopf();
      d.setFont('helvetica', 'normal'); d.setFontSize(8.5); d.setTextColor(90);
      const zeile = [this.abs.strasse, [this.abs.plz, this.abs.ort].filter(Boolean).join(' '), this.abs.telefon, this.abs.email].filter(Boolean).join(' · ');
      if (zeile) d.text(zeile, 20, 25);
      if (!bp) y = 32;
    }
    // Titel links im Anschriftbereich, Ort und Datum darunter: rechts bleibt Platz für den Informationsblock des Briefpapiers
    const z = [...zeilen.filter(Boolean), `${this.abs.ort ? this.abs.ort + ', ' : ''}${dDatum(datum)}`];
    d.setFont('helvetica', 'bold'); d.setFontSize(16); d.setTextColor(30);
    const t = d.splitTextToSize(titel, bp ? 100 : 170) as string[];
    d.text(t, 20, y + 6);
    y += (t.length - 1) * 6.5;
    d.setFont('helvetica', 'normal'); d.setFontSize(10); d.setTextColor(85);
    const zl = z.flatMap((x) => d.splitTextToSize(x, bp ? 100 : 170) as string[]);
    d.text(zl, 20, y + 13);
    this.y = Math.max(y + 13 + zl.length * 5 + 2, bp ? 86 : 0);
    d.setDrawColor(176, 138, 74); d.setLineWidth(0.4); d.line(20, this.y - 2, 190, this.y - 2);
    d.setTextColor(0); d.setFontSize(10.5);
    this.y += 6;
  }

  /** Zwischenüberschrift mit feiner Bronze-Linie */
  abschnitt(titel: string) {
    this.platz(34);   // Überschrift nie allein am Seitenende
    const d = this.doc;
    d.setFont('helvetica', 'bold'); d.setFontSize(11.5); d.setTextColor(150, 112, 52);
    d.text(titel.toUpperCase(), 20, this.y);
    d.setTextColor(0); d.setFont('helvetica', 'normal'); d.setFontSize(10.5);
    this.y += 4;
  }

  private get raender() {
    return { left: 20, right: 20, top: this.abs.briefpapier ? this.obenFolge : 18, bottom: this.abs.briefpapier ? 297 - this.grenzeUnten : 18 };
  }

  /** Feld/Wert-Paare in zwei Spalten (Stammblatt) */
  felder(paare: [string, string][]) {
    const zeilen: string[][] = [];
    for (let i = 0; i < paare.length; i += 2) zeilen.push([paare[i][0], paare[i][1], paare[i + 1]?.[0] ?? '', paare[i + 1]?.[1] ?? '']);
    autoTable(this.doc, {
      startY: this.y, body: zeilen, theme: 'plain', margin: this.raender,
      styles: { font: 'helvetica', fontSize: 9.5, cellPadding: { top: 1.25, bottom: 1.25, left: 0, right: 3 }, textColor: 20, overflow: 'linebreak' },
      columnStyles: { 0: { cellWidth: 34, textColor: 110, fontSize: 8.5 }, 1: { cellWidth: 51, fontStyle: 'bold' }, 2: { cellWidth: 34, textColor: 110, fontSize: 8.5 }, 3: { cellWidth: 51, fontStyle: 'bold' } },
    });
    this.y = (this.doc as any).lastAutoTable.finalY + 5.5;
  }

  /** Tabelle mit Gruppen (z. B. je Buchungskonto) und Zwischensummen */
  gruppenTabelle(head: string[], gruppen: { titel: string; zeilen: string[][]; summe: string }[], gesamt: string, breiten: number[], farbe: [number, number, number] = [176, 138, 74]) {
    const n = head.length, letzte = n - 1;
    const body: RowInput[] = [];
    // Je Konto zuerst die Gesamtsumme, darunter die einzelnen Zeilen
    for (const g of gruppen) {
      const kopf = { fontStyle: 'bold' as const, fillColor: [246, 241, 232] as [number, number, number], textColor: 30 };
      body.push([{ content: g.titel, colSpan: letzte, styles: kopf }, { content: g.summe, styles: { ...kopf, halign: 'right' } }]);
      for (const z of g.zeilen) body.push(z);
    }
    const cs: Record<number, any> = {};
    breiten.forEach((w, i) => { cs[i] = { cellWidth: w }; });
    cs[letzte] = { ...cs[letzte], halign: 'right' };
    autoTable(this.doc, {
      startY: this.y, head: [head], body, foot: [[{ content: 'Gesamt', colSpan: letzte, styles: { halign: 'right' } }, { content: gesamt, styles: { halign: 'right' } }]], showFoot: 'lastPage', showHead: 'everyPage',
      margin: this.raender, theme: 'grid',
      styles: { font: 'helvetica', fontSize: 9, cellPadding: { top: 2.2, bottom: 2.2, left: 2, right: 2 }, lineColor: [228, 222, 211], lineWidth: 0.15, textColor: 25 },
      headStyles: { fillColor: farbe, textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [248, 240, 227], textColor: 0, fontStyle: 'bold' },
      columnStyles: cs,
      didParseCell: (h) => { if (h.section === 'head' && h.column.index === letzte) h.cell.styles.halign = 'right'; },
    });
    this.y = (this.doc as any).lastAutoTable.finalY + 9;
  }

  /** Kleine Übersicht, z. B. Einnahmen, Ausgaben, Ergebnis */
  kennzahlen(werte: [string, string][]) {
    const w = 170 / werte.length;
    this.platz(18);
    werte.forEach(([t, v], i) => {
      const x = 20 + i * w;
      this.doc.setFillColor(248, 244, 237); this.doc.roundedRect(x, this.y, w - 3, 15, 1.5, 1.5, 'F');
      this.doc.setFontSize(8); this.doc.setTextColor(110); this.doc.text(t.toUpperCase(), x + 3.5, this.y + 5.2);
      this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(12); this.doc.setTextColor(25); this.doc.text(v, x + 3.5, this.y + 11.6);
      this.doc.setFont('helvetica', 'normal');
    });
    this.doc.setTextColor(0); this.doc.setFontSize(10.5);
    this.y += 23;
  }

  /** Seitenzahlen „Seite x von n“ knapp über dem unteren Rand */
  seitenzahlen() {
    const d = this.doc, n = d.getNumberOfPages();
    if (n < 2) return this;
    for (let i = 1; i <= n; i++) {
      d.setPage(i); d.setFontSize(7.5); d.setTextColor(130);
      d.text(`Seite ${i} von ${n}`, 190, this.grenzeUnten + 3.2, { align: 'right' });
    }
    d.setTextColor(0); d.setFontSize(10.5);
    return this;
  }

  bytes(): Uint8Array { return new Uint8Array(this.doc.output('arraybuffer')); }
}

/** Liste als PDF hochkant auf dem Briefpapier (Mieterliste, Eigentümerliste, Journal …). Viele Spalten: kleinere Schrift, Text bricht um. */
export async function listePdf(titel: string, untertitel: string, head: string[], body: RowInput[], foot?: RowInput[], rechts: number[] = []): Promise<Uint8Array> {
  const b = new Brief(await absender()).neuerBrief();
  b.berichtKopf(titel, [untertitel], new Date().toISOString().slice(0, 10));
  // Keine Trennung mitten im Wort: jede Spalte ist mindestens so breit wie ihr längstes Wort (Beträge und Daten nie umbrechen).
  // Passt das nicht auf 170 mm, wird die Schrift kleiner.
  const text = (c: any) => String(c && typeof c === 'object' && 'content' in c ? c.content : c ?? '');
  const zeilen = [...body, ...(foot ?? [])].map((r) => (Array.isArray(r) ? r : Object.values(r as object)));
  const mindest = (pt: number) => head.map((h, i) => {
    b.doc.setFontSize(pt);
    const woerter = (t: string, ganz: boolean) => (ganz ? [t] : t.split(/\s+/));
    b.doc.setFont('helvetica', 'bold');
    let w = Math.max(...woerter(h, false).map((x) => b.doc.getTextWidth(x)));
    for (const z of zeilen) { b.doc.setFont('helvetica', 'bold'); w = Math.max(w, ...woerter(text(z[i]), rechts.includes(i) || /^\d{2}\.\d{2}\.\d{4}$/.test(text(z[i]))).map((x) => b.doc.getTextWidth(x))); }
    return w + 3.4;
  });
  let schrift = head.length <= 5 ? 9.5 : head.length <= 7 ? 8.5 : 8;
  while (schrift > 6 && mindest(schrift).reduce((a, x) => a + x, 0) > 170) schrift -= 0.3;
  b.doc.setFont('helvetica', 'normal');
  const cs: Record<number, { halign?: 'right'; minCellWidth: number }> = {};
  mindest(schrift).forEach((w, i) => { cs[i] = { minCellWidth: w, ...(rechts.includes(i) ? { halign: 'right' as const } : {}) }; });
  autoTable(b.doc, {
    startY: b.y, head: [head], body, foot, showFoot: 'lastPage', showHead: 'everyPage',
    margin: { left: 20, right: 20, top: b.abs.briefpapier ? b.obenFolge : 18, bottom: b.abs.briefpapier ? 297 - b.grenzeUnten : 18 },
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: schrift, cellPadding: { top: 1.8, bottom: 1.8, left: 1.6, right: 1.6 }, lineColor: [228, 222, 211], lineWidth: 0.15, textColor: 25, overflow: 'linebreak' },
    headStyles: { fillColor: [176, 138, 74], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [248, 240, 227], textColor: 0, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [252, 250, 246] },
    columnStyles: cs,
    didParseCell: (h) => { if (h.section !== 'body' && rechts.includes(h.column.index)) h.cell.styles.halign = 'right'; },
  });
  return b.seitenzahlen().bytes();
}

/** CSV mit Semikolon und BOM (öffnet sich in Excel korrekt) */
export function csv(head: string[], rows: (string | number | null | undefined)[][]): Uint8Array {
  const esc = (v: any) => { const t = v == null ? '' : typeof v === 'number' ? v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }) : String(v); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const text = '\uFEFF' + [head, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
  return new TextEncoder().encode(text);
}

/** Einnahmen und Ausgaben einer Liegenschaft auf dem Briefpapier, gegliedert nach Buchungskonten (Anlage zur Jahresabrechnung) */
export async function einnahmenAusgabenPdf(p: { objekt: string; adresse?: string; zeitraum: string; anlage?: string; buchungen: { datum: string; konto: string; firma?: string | null; text?: string | null; einheit?: string | null; betrag: number; eigentuemer?: boolean }[] }): Promise<Uint8Array> {
  const b = new Brief(await absender()).neuerBrief();
  b.berichtKopf('Einnahmen und Ausgaben', [[p.objekt, p.adresse].filter(Boolean).join(', '), p.zeitraum, p.anlage ?? ''], new Date().toISOString().slice(0, 10));
  // Auszahlungen an den Eigentümer (Mietverwaltung) sind keine Ausgaben: eigener Block unter dem Ergebnis
  const eig = p.buchungen.filter((x) => x.eigentuemer), rest = p.buchungen.filter((x) => !x.eigentuemer);
  const ein = rest.filter((x) => x.betrag > 0), aus = rest.filter((x) => x.betrag < 0);
  const summe = (l: typeof ein) => l.reduce((a, x) => a + Math.abs(x.betrag), 0);
  const sEig = eig.reduce((a, x) => a + x.betrag, 0);
  b.kennzahlen([['Einnahmen', geld(summe(ein))], ['Ausgaben', geld(summe(aus))], ['Ergebnis', geld(summe(ein) - summe(aus))],
    ...(eig.length ? [['An Eigentümer ausgezahlt', geld(-sEig)] as [string, string]] : [])]);
  const nachKonto = (l: typeof ein) => {
    const m = new Map<string, typeof ein>();
    for (const x of [...l].sort((a, c) => a.konto.localeCompare(c.konto, 'de', { numeric: true }) || a.datum.localeCompare(c.datum))) { if (!m.has(x.konto)) m.set(x.konto, []); m.get(x.konto)!.push(x); }
    return [...m];
  };
  // Einnahmen: je Konto die Gesamtsumme, darunter die Zahlmonate (alle Zahlungen eines Monats in einer Zeile)
  const MON = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const einGruppen = nachKonto(ein).map(([titel, z]) => {
    const monate = new Map<string, typeof ein>();
    for (const x of z) { const k = x.datum.slice(0, 7); if (!monate.has(k)) monate.set(k, []); monate.get(k)!.push(x); }
    return { titel, summe: geld(summe(z)), zeilen: [...monate].map(([k, mz]) => {
      const einh = [...new Set(mz.map((x) => x.einheit).filter(Boolean))] as string[];
      return [`${MON[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`, `${mz.length} ${mz.length === 1 ? 'Zahlung' : 'Zahlungen'}`, einh.length ? einh.join(', ') : '–', geld(summe(mz))];
    }) };
  });
  const ausGruppen = nachKonto(aus).map(([titel, z]) => ({ titel, summe: geld(summe(z)),
    zeilen: z.map((x) => [dDatum(x.datum), [x.firma, x.text].filter(Boolean).join(' · ') || '–', x.einheit ?? '', geld(Math.abs(x.betrag))]) }));
  if (ein.length) { b.abschnitt('Einnahmen'); b.gruppenTabelle(['Zahlmonat', 'Zahlungen', 'Einheiten', 'Betrag'], einGruppen, geld(summe(ein)), [34, 30, 80, 26], [91, 140, 104]); }
  if (aus.length) { b.abschnitt('Ausgaben'); b.gruppenTabelle(['Datum', 'Unternehmen / Buchungstext', 'Einheit', 'Betrag'], ausGruppen, geld(summe(aus)), [22, 98, 24, 26], [176, 138, 74]); }
  if (eig.length) {
    b.abschnitt('Auszahlungen an den Eigentümer');
    b.gruppenTabelle(['Monat', 'Überwiesen am', 'Buchungstext', 'Betrag'], eigentuemerGruppen(eig), geld(-sEig), [34, 30, 80, 26], [91, 104, 140]);
    b.platz(50);
    b.tabelle(['Kontoentwicklung', 'Betrag'], [['Ergebnis (Einnahmen − Ausgaben)', geld(summe(ein) - summe(aus))], [eig.some((x) => x.betrag > 0) ? 'Auszahlungen und Einzahlungen Eigentümer' : 'Auszahlungen an den Eigentümer', geld(sEig)]],
      [['Veränderung des Kontostands', geld(summe(ein) - summe(aus) + sEig)]]);
    b.absatz(EIGENTUEMER_HINWEIS, 6);
  }
  if (!rest.length && !eig.length) b.absatz('Im Zeitraum gibt es keine Buchungen.');
  b.platz(45);
  b.absatz(`Aufgestellt für ${p.objekt}. Die Belege liegen in der Verwaltung zur Einsicht bereit.`, 6);
  b.unterschrift(20, b.y + 2);
  return b.seitenzahlen().bytes();
}

export const HINWEIS_35A_VERMIETER = 'Für eine vermietete Wohnung sind diese Kosten beim Vermieter Werbungskosten. Eine Steuerermäßigung nach § 35a EStG ist dafür ausgeschlossen (§ 35a Abs. 5 Satz 1 EStG). Begünstigt sind die Mieter mit ihrem Anteil; er wird ihnen in der Nebenkostenabrechnung bescheinigt.';
export const EIGENTUEMER_HINWEIS = 'Auszahlungen an den Eigentümer sind Entnahmen und keine Kosten. Sie mindern das Ergebnis nicht, gehören nicht in die Nebenkostenabrechnung und sind keine Werbungskosten.';
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
/** Auszahlungen an / Einzahlungen vom Eigentümer: je Konto oben die Summe, darunter jeder Monat mit Überweisungsdatum (Auszahlung positiv) */
export function eigentuemerGruppen(l: { datum: string; konto: string; text?: string | null; betrag: number }[]) {
  const m = new Map<string, typeof l>();
  for (const x of [...l].sort((a, c) => a.konto.localeCompare(c.konto, 'de', { numeric: true }) || a.datum.localeCompare(c.datum))) { if (!m.has(x.konto)) m.set(x.konto, []); m.get(x.konto)!.push(x); }
  return [...m].map(([titel, z]) => ({ titel, summe: geld(Math.abs(z.reduce((a, x) => a + x.betrag, 0))),
    zeilen: z.map((x) => [`${MONATE[Number(x.datum.slice(5, 7)) - 1]} ${x.datum.slice(0, 4)}`, dDatum(x.datum), x.text || '–', geld(Math.abs(x.betrag))]) }));
}

/** Stammblatt (Person, Eigentum, Mietvertrag, Liegenschaft) auf dem Briefpapier */
export async function stammblattPdf(titel: string, zeilen: string[], gruppen: { titel: string; felder: [string, string][] }[], tabellen: { titel: string; head: string[]; body: string[][] }[] = []): Promise<Uint8Array> {
  const b = new Brief(await absender()).neuerBrief();
  b.berichtKopf(titel, zeilen, new Date().toISOString().slice(0, 10));
  for (const g of gruppen) { if (!g.felder.length) continue; b.abschnitt(g.titel); b.felder(g.felder); }
  for (const t of tabellen) { b.abschnitt(t.titel); b.tabelle(t.head, t.body, undefined, t.head.length); }
  return b.seitenzahlen().bytes();
}
