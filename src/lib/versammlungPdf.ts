// PDFs zur Eigentümerversammlung auf dem Briefpapier: Einladung mit Tagesordnung und Vollmacht,
// Protokoll und Beschluss-Niederschrift je Eigentümer mit Feld zur Kenntnisnahme.
import type { Row } from '../db';
import { Brief, absender, dDatum } from './pdf';
import { ergebnis, einladenBis, type Versammlung } from '../logic/versammlung';

const anschrift = (p: Row, o: Row) => {
  const name = [p.vorname, p.nachname].filter(Boolean).join(' ');
  const anrede = p.anrede === 'Herr' ? 'Herrn' : p.anrede === 'Frau' ? 'Frau' : '';
  return [p.firma, anrede, name, p.strasse || o.o_strasse, [p.plz || o.o_plz, p.ort || o.o_ort].filter(Boolean).join(' ')].filter(Boolean) as string[];
};
const zahl = (n: number, s = 0) => n.toLocaleString('de-DE', { minimumFractionDigits: s, maximumFractionDigits: s });
const weg = (v: Row) => String(v.objekt).replace(/^WEG\s+/i, 'WEG ');
const anredeZeile = (p: Row) => p.anrede === 'Herr' ? `Sehr geehrter Herr ${p.nachname ?? ''},` : p.anrede === 'Frau' ? `Sehr geehrte Frau ${p.nachname ?? ''},` : 'Sehr geehrte Damen und Herren,';

/** Farbig hinterlegter Kasten (z. B. Beschluss), Text bricht um */
function kasten(b: Brief, zeilen: { text: string; fett?: boolean; farbe?: [number, number, number]; klein?: boolean }[], fill: [number, number, number], rand: [number, number, number]) {
  const d = b.doc;
  const teile = zeilen.map((z) => { d.setFont('helvetica', z.fett ? 'bold' : 'normal'); d.setFontSize(z.klein ? 8.5 : 9.8); return { ...z, l: d.splitTextToSize(z.text, 160) as string[] }; });
  const h = teile.reduce((a, t) => a + t.l.length * (t.klein ? 4 : 4.6), 0) + 5;
  b.platz(h + 3);
  d.setFillColor(...fill); d.roundedRect(20, b.y - 4, 170, h, 1.5, 1.5, 'F');
  d.setFillColor(...rand); d.rect(20, b.y - 4, 1.2, h, 'F');
  let y = b.y + 0.4;
  for (const t of teile) {
    d.setFont('helvetica', t.fett ? 'bold' : 'normal'); d.setFontSize(t.klein ? 8.5 : 9.8);
    d.setTextColor(...(t.farbe ?? [25, 25, 25]));
    d.text(t.l, 25, y); y += t.l.length * (t.klein ? 4 : 4.6);
  }
  d.setFont('helvetica', 'normal'); d.setFontSize(10.5); d.setTextColor(0);
  b.y += h + 2;
}

function topKopf(b: Brief, text: string) {
  const d = b.doc;
  d.setFont('helvetica', 'bold'); d.setFontSize(10.5);
  const l = d.splitTextToSize(text, 170) as string[];
  b.platz(l.length * 5 + 28);
  d.setTextColor(150, 112, 52); d.text(l, 20, b.y);
  d.setTextColor(0); d.setFont('helvetica', 'normal');
  b.y += l.length * 5 + 1;
}

function klein(b: Brief, text: string, farbe = 85) {
  const d = b.doc; d.setFontSize(9); d.setTextColor(farbe);
  const l = d.splitTextToSize(text, 170) as string[];
  b.platz(l.length * 4.2); d.text(l, 20, b.y); b.y += l.length * 4.2 + 2;
  d.setFontSize(10.5); d.setTextColor(0);
}

/* ============ Einladung ============ */
export async function einladungPdf(vs: Versammlung, nurPerson?: number): Promise<Uint8Array> {
  const abs = await absender();
  const b = new Brief(abs);
  const { v } = vs;
  const heute = new Date().toISOString().slice(0, 10);
  const liste = vs.teilnehmer.filter((t) => !nurPerson || t.person_id === nurPerson);
  for (const t of liste) {
    b.neuerBrief();
    b.kopf(anschrift(t, v), heute);
    const umlauf = v.art === 'Umlaufbeschluss';
    b.betreff(umlauf ? `Beschluss im Umlaufverfahren: ${weg(v)}` : `Einladung zur ${v.art === 'Außerordentliche Versammlung' ? 'außerordentlichen' : 'ordentlichen'} Eigentümerversammlung ${weg(v)}`);
    b.absatz(anredeZeile(t));
    if (umlauf) b.absatz(`wir bitten Sie, über den folgenden Antrag in Textform abzustimmen (§ 23 Abs. 3 WEG). Bitte senden Sie Ihre Stimme bis zum ${dDatum(v.datum)} an uns zurück.`);
    else b.absatz(`hiermit laden wir Sie als Eigentümer${t.einheiten ? ` (${t.einheiten})` : ''} zur ${v.art === 'Außerordentliche Versammlung' ? 'außerordentlichen' : 'ordentlichen'} Eigentümerversammlung ein.`);
    if (!umlauf) {
      b.felder([['Datum', dDatum(v.datum)], ['Uhrzeit', v.uhrzeit ? `${v.uhrzeit} Uhr` : '–'], ['Ort', v.ort || '–'], ['Online-Teilnahme', v.online ? 'möglich (Zugang folgt per E-Mail)' : 'nein']]);
    }
    b.abschnitt('Tagesordnung');
    b.y += 2;
    for (const top of vs.tops) {
      topKopf(b, `TOP ${top.nr} · ${top.titel}`);
      if (top.beschluss && top.antrag) kasten(b, [{ text: 'Beschlussantrag', fett: true, klein: true, farbe: [150, 112, 52] }, { text: top.antrag }], [250, 246, 238], [176, 138, 74]);
      else if (!top.beschluss) klein(b, 'Information, keine Beschlussfassung.');
      b.y += 1;
    }
    if (!umlauf) {
      b.absatz('Sollten Sie nicht teilnehmen können, können Sie sich durch eine Person Ihres Vertrauens vertreten lassen. Bitte geben Sie ihr die beiliegende Vollmacht in Textform mit.', 4);
      b.absatz('Die Unterlagen zu den Tagesordnungspunkten (z. B. Jahresabrechnung, Wirtschaftsplan, Angebote) senden wir Ihnen mit oder legen sie in der Versammlung vor.');
    }
    b.gruss();
    if (!umlauf) {
      // Vollmacht
      b.doc.addPage(); b.y = b.obenFolge + 8;
      b.doc.setFont('helvetica', 'bold'); b.doc.setFontSize(15); b.doc.text('Vollmacht', 20, b.y); b.y += 10;
      b.doc.setFont('helvetica', 'normal'); b.doc.setFontSize(10.5);
      b.absatz(`Ich, ${[t.vorname, t.nachname].filter(Boolean).join(' ') || t.name}, Eigentümer${t.einheiten ? ` von ${t.einheiten}` : ''} in der ${weg(v)}, bevollmächtige`);
      b.y += 12; b.doc.setDrawColor(120); b.doc.line(20, b.y, 190, b.y); b.y += 4;
      klein(b, 'Name und Anschrift der bevollmächtigten Person');
      b.absatz(`mich in der Eigentümerversammlung am ${dDatum(v.datum)} zu vertreten und mein Stimmrecht zu allen Tagesordnungspunkten auszuüben.`);
      b.absatz('Weisungen (optional): ________________________________________________', 14);
      b.doc.line(20, b.y, 85, b.y); b.doc.line(105, b.y, 190, b.y); b.y += 4;
      b.doc.setFontSize(8.5); b.doc.setTextColor(95); b.doc.text('Ort, Datum', 20, b.y); b.doc.text('Unterschrift', 105, b.y); b.doc.setTextColor(0); b.doc.setFontSize(10.5);
    }
  }
  return b.seitenzahlen().bytes();
}

/* ============ Protokoll und Beschluss-Niederschrift ============ */
export async function niederschriftPdf(vs: Versammlung, nurPersonen?: number[]): Promise<Uint8Array> {
  const abs = await absender();
  const b = new Brief(abs);
  const { v } = vs;
  const anwesend = vs.teilnehmer.filter((t) => t.status === 'Anwesend' || t.status === 'Vertreten');
  const meaAnw = anwesend.reduce((a, t) => a + (Number(t.mea) || 0), 0);
  const meaGes = vs.teilnehmer.reduce((a, t) => a + (Number(t.mea) || 0), 0);
  const empf = vs.teilnehmer.filter((t) => !nurPersonen || nurPersonen.includes(t.person_id));
  for (const t of empf) {
    b.neuerBrief();
    b.kopf(anschrift(t, v), v.datum);
    b.betreff('Protokoll und Beschluss-Niederschrift');
    klein(b, `${v.art} der ${weg(v)}, ${[v.o_strasse, [v.o_plz, v.o_ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}`, 70);
    b.y += 1;
    b.kennzahlen([['Datum', dDatum(v.datum)], ['Zeit', `${v.beginn || v.uhrzeit || '–'}${v.ende ? `–${v.ende}` : ''} Uhr`], ['Ort', `${String(v.ort || '').split(',')[0] || '–'}${v.online ? ' + online' : ''}`], ['Leitung', v.leitung || abs.unterschrift?.name || abs.name]].map(([a, c]) => [a, String(c).slice(0, 26)] as [string, string]));
    b.abschnitt('Anwesenheit');
    b.y += 1;
    b.tabelle(['Einheit', 'Eigentümer', 'Status', 'MEA'], vs.teilnehmer.map((x) => [x.einheiten ?? '', x.name, x.status === 'Vertreten' ? `vertreten durch ${x.vertreter || '–'}` : (x.status || 'nicht erfasst'), zahl(Number(x.mea) || 0)]),
      [['', `Anwesend oder vertreten: ${anwesend.length} von ${vs.teilnehmer.length} Eigentümern`, `Stimmrecht nach ${v.zaehlung === 'MEA' ? 'MEA' : 'Köpfen (§ 25 Abs. 2 WEG)'}`, `${zahl(meaAnw)} / ${zahl(meaGes)}`]], 3);
    b.y -= 2;
    klein(b, `Die Versammlungsleitung stellt fest, dass ordnungsgemäß${v.eingeladen_am ? ` am ${dDatum(v.eingeladen_am)}` : ''} eingeladen wurde.`);
    b.abschnitt('Tagesordnung und Beschlüsse');
    b.y += 2;
    for (const top of vs.tops) {
      topKopf(b, `TOP ${top.nr} · ${top.titel}`);
      if (top.notiz) klein(b, top.notiz, 45);
      if (top.beschluss) {
        const bs = vs.beschluesse.find((x) => x.id === top.beschluss_id);
        const e = ergebnis(top.id, vs);
        const meine = vs.stimmen.find((s) => s.top_id === top.id && s.teilnehmer_id === t.id)?.stimme;
        if (!bs) { klein(b, 'Über diesen Punkt wurde nicht abgestimmt.'); continue; }
        const mea = v.zaehlung === 'MEA';
        const f = (n: number, k: number) => mea ? `${zahl(n)} MEA` : String(k);
        kasten(b, [
          { text: `Beschluss ${bs.nummer ?? ''}: ${top.antrag || top.titel}`, fett: false },
          { text: `${bs.ergebnis} · Ja ${f(e.ja, e.jaN)} · Nein ${f(e.nein, e.neinN)} · Enthaltung ${f(e.enthaltung, e.enthN)}${t.status === 'Anwesend' || t.status === 'Vertreten' ? ` · Ihre Stimme: ${meine ?? 'keine'}` : ''}`, fett: true,
            farbe: bs.ergebnis === 'Angenommen' ? [30, 122, 60] : [180, 35, 24], klein: true },
        ], bs.ergebnis === 'Angenommen' ? [238, 246, 240] : [252, 238, 237], bs.ergebnis === 'Angenommen' ? [31, 168, 90] : [192, 57, 43]);
      } else if (!top.notiz) klein(b, 'Keine Beschlussfassung.');
      b.y += 1;
    }
    if (vs.beschluesse.length) kasten(b, [{ text: `Die Beschlüsse sind in die Beschluss-Sammlung eingetragen (§ 24 Abs. 7 WEG). Ein Beschluss kann innerhalb eines Monats nach der Beschlussfassung durch Klage beim Amtsgericht angefochten werden (§ 45 WEG).`, klein: true }], [251, 246, 236], [176, 138, 74]);
    // Unterschriften nach § 24 Abs. 6 WEG
    const d = b.doc;
    b.platz(78);
    b.y += 14;
    const u = abs.unterschrift;
    if (u?.bild) {
      const ratio = u.breite && u.hoehe ? u.breite / u.hoehe : 3.3;
      let h = 12, w = h * ratio; if (w > 48) { w = 48; h = w / ratio; }
      d.addImage(u.bild, 'PNG', 20, b.y - h - 1, w, h, 'unterschrift', 'FAST');
    }
    const spalten: [string, string][] = [['Versammlungsleitung', v.leitung || u?.name || abs.name], ['Wohnungseigentümer', ''], ['Vorsitz Verwaltungsbeirat', '']];
    spalten.forEach(([titel, name], i) => {
      const x = 20 + i * 58;
      d.setDrawColor(60); d.setLineWidth(0.25); d.line(x, b.y, x + 52, b.y);
      d.setFont('helvetica', 'bold'); d.setFontSize(8.5); d.text(titel, x, b.y + 4);
      d.setFont('helvetica', 'normal'); d.setTextColor(95); if (name) d.text(name, x, b.y + 8); d.setTextColor(0);
    });
    b.y += 16;
    // Kenntnisnahme durch den Eigentümer
    const hK = 38;
    b.platz(hK + 4);
    d.setDrawColor(176, 138, 74); d.setLineWidth(0.4); d.roundedRect(20, b.y, 170, hK, 2, 2, 'S');
    d.setFont('helvetica', 'bold'); d.setFontSize(10.5); d.text('Zur Kenntnis genommen', 25, b.y + 7);
    d.setFont('helvetica', 'normal'); d.setFontSize(9);
    d.text(d.splitTextToSize(`Ich habe das Protokoll und die Beschluss-Niederschrift der Versammlung vom ${dDatum(v.datum)} erhalten und zur Kenntnis genommen.`, 160), 25, b.y + 12.5);
    const lin = b.y + hK - 9;
    if (t.unterschrift) {
      const img = new Image(); img.src = t.unterschrift;
      await new Promise((ok) => { img.onload = ok; img.onerror = ok; });
      const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 3.3;
      let h = 13, w = h * ratio; if (w > 70) { w = 70; h = w / ratio; }
      d.addImage(t.unterschrift, 'PNG', 95, lin - h - 0.5, w, h, `kenntnis-${t.id}`, 'FAST');
    }
    d.setDrawColor(60); d.setLineWidth(0.25); d.line(25, lin, 80, lin); d.line(95, lin, 185, lin);
    d.setFontSize(8); d.setTextColor(95);
    d.text(t.unterschrieben_am ? `${abs.ort ? abs.ort + ', ' : ''}${dDatum(t.unterschrieben_am.slice(0, 10))}` : 'Ort, Datum', 25, lin + 4);
    d.text(`${[t.vorname, t.nachname].filter(Boolean).join(' ') || t.name}${t.einheiten ? `, Eigentümer ${t.einheiten}` : ''}${t.status === 'Vertreten' && t.vertreter ? ` (vertreten durch ${t.vertreter})` : ''}`, 95, lin + 4);
    d.setTextColor(0); d.setFontSize(10.5);
    b.y += hK + 4;
  }
  return b.seitenzahlen().bytes();
}

export { einladenBis };
