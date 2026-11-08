// Jahresbericht über Schäden (bzw. alle Vorgänge und Tickets) je Liegenschaft, als PDF zum Drucken und Ablegen.
// Enthalten ist, was im Jahr gemeldet oder erledigt wurde, und was am Jahresende noch offen ist.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { db, type Row } from '../db';
import { absender, dDatum, geld } from '../lib/pdf';

export type Umfang = 'schaeden' | 'alle';

const SCHADEN_TICKET = `(LOWER(b.name) LIKE '%chad%' OR LOWER(b.name) LIKE '%chäd%' OR LOWER(t.titel) LIKE '%chad%' OR LOWER(t.titel) LIKE '%chäd%')`;

export async function berichtDaten(jahr: number, objektId: number | null, umfang: Umfang): Promise<{ objekt: Row; posten: Row[] }[]> {
  const von = `${jahr}-01-01`, bis = `${jahr}-12-31`;
  const imJahr = (a: string, e: string, st: string) =>
    `((${a} BETWEEN $1 AND $2) OR (${e} BETWEEN $1 AND $2) OR (${st} <> 'Erledigt' AND ${a} <= $2))`;
  const objF = objektId ? 'AND o.id = $3' : '';
  const p = objektId ? [von, bis, objektId] : [von, bis];
  const vorgaenge = await db.select(`SELECT v.objekt_id, v.angelegt AS gemeldet, v.betreff AS titel, v.art, v.status, v.prioritaet, v.erledigt_am, v.kosten, v.notiz,
      e.nummer AS einheit, f.name AS firma, 'Instandhaltung' AS quelle
    FROM vorgaenge v JOIN objekte o ON o.id = v.objekt_id LEFT JOIN einheiten e ON e.id = v.einheit_id LEFT JOIN firmen f ON f.id = v.firma_id
    WHERE ${imJahr('v.angelegt', "COALESCE(v.erledigt_am, '')", 'v.status')} ${umfang === 'schaeden' ? "AND v.art = 'Schaden'" : ''} ${objF}`, p);
  const tickets = await db.select(`SELECT t.objekt_id, t.angelegt AS gemeldet, t.titel, 'Ticket' AS art, t.status, t.prioritaet, NULL AS erledigt_am, NULL AS kosten, t.notiz,
      NULL AS einheit, NULL AS firma, b.name AS quelle
    FROM tickets t JOIN boards b ON b.id = t.board_id JOIN objekte o ON o.id = t.objekt_id
    WHERE ${imJahr("substr(t.angelegt, 1, 10)", "''", 't.status')} ${umfang === 'schaeden' ? 'AND ' + SCHADEN_TICKET : ''} ${objF}`, p);
  const alle = [...vorgaenge, ...tickets].sort((a, b) => String(a.gemeldet).localeCompare(String(b.gemeldet)));
  const objekte = await db.select(`SELECT * FROM objekte ${objektId ? 'WHERE id = $1' : ''} ORDER BY name`, objektId ? [objektId] : []);
  return objekte.map((o) => ({ objekt: o, posten: alle.filter((x) => x.objekt_id === o.id) })).filter((g) => objektId || g.posten.length);
}

export async function berichtPdf(jahr: number, gruppen: { objekt: Row; posten: Row[] }[], umfang: Umfang): Promise<Uint8Array> {
  const abs = await absender();
  const titel = `${umfang === 'schaeden' ? 'Schadensbericht' : 'Vorgänge und Tickets'} ${jahr}`;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const kopf = (o: Row) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(80); doc.text(abs.name, 15, 16);
    doc.setDrawColor(176, 138, 74); doc.setLineWidth(0.6); doc.line(15, 18, 15 + doc.getTextWidth(abs.name), 18);
    doc.setTextColor(0); doc.setFontSize(13); doc.text(`${titel} · ${o.name}`, 15, 28);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100);
    doc.text([[o.strasse, [o.plz, o.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '), o.verwaltungsart].filter(Boolean).join(' · ') || ' ', 15, 34);
    doc.setTextColor(0);
  };
  if (!gruppen.length) { doc.setFontSize(12); doc.text(`${titel}: keine Einträge.`, 15, 30); }
  gruppen.forEach((g, i) => {
    if (i) doc.addPage();
    kopf(g.objekt);
    const erl = g.posten.filter((x) => x.status === 'Erledigt').length;
    const kosten = g.posten.reduce((s, x) => s + (Number(x.kosten) || 0), 0);
    doc.setFontSize(10);
    doc.text(`${g.posten.length} Einträge · ${erl} erledigt · ${g.posten.length - erl} offen am 31.12.${jahr}${kosten ? ` · Kosten ${geld(kosten)}` : ''}`, 15, 42);
    autoTable(doc, {
      startY: 47, margin: { left: 15, right: 15 },
      head: [['Gemeldet', 'Betreff', 'Art', 'Einheit', 'Priorität', 'Status', 'Erledigt am', 'Firma', 'Kosten', 'Notiz']],
      body: g.posten.length ? g.posten.map((x) => [dDatum(String(x.gemeldet).slice(0, 10)), x.titel, x.art === 'Ticket' ? `Ticket (${x.quelle})` : x.art, x.einheit ?? '',
        x.prioritaet ?? '', x.status, x.erledigt_am ? dDatum(x.erledigt_am) : '', x.firma ?? '', x.kosten != null ? geld(Number(x.kosten)) : '', x.notiz ?? ''])
        : [[{ content: 'Keine Einträge in diesem Jahr.', colSpan: 10 }]],
      foot: kosten ? [[{ content: 'Summe Kosten', colSpan: 8 }, geld(kosten), '']] : undefined, showFoot: 'lastPage',
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.6, valign: 'top' },
      headStyles: { fillColor: [176, 138, 74], textColor: 255 },
      footStyles: { fillColor: [248, 240, 227], textColor: 0, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 52 }, 6: { cellWidth: 20 }, 8: { halign: 'right', cellWidth: 22 }, 9: { cellWidth: 55 } },
      didDrawPage: () => { doc.setFontSize(7.5); doc.setTextColor(120); doc.text(`${g.objekt.name} · Erstellt am ${new Date().toLocaleDateString('de-DE')} · Seite ${doc.getNumberOfPages()}`, 282, 203, { align: 'right' }); doc.setTextColor(0); },
    });
  });
  return new Uint8Array(doc.output('arraybuffer'));
}
