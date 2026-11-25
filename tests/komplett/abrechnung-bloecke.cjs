// WEG-Jahresabrechnung als PDF in 4 Blöcken: 1. umlagefähige Kosten, 2. nicht umlagefähige Kosten, 3. § 35a laut eingegebenen
// Arbeitskosten, 4. Erhaltungsrücklage (1260/1261/1262). Gilt für Gesamt- und Einzelabrechnung. Nur Demodaten.
const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts');
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'WEG Musterstraße 12', strasse: 'Musterstraße 12', plz: '50667', ort: 'Köln', gesamt_mea: 1000, ruecklage_anfang: 45000, ruecklage_stichtag: '2024-12-31' });
    const namen = [['W1', 400, 'Wagner', 'Maria', 450, 100], ['W2', 350, 'Hoffmann', 'Peter', 395, 90], ['W3', 250, 'Yilmaz', 'Ahmet', 285, 60]];
    for (const [nr, mea, nn, vn, hg, rl] of namen) {
      const e = await insert('einheiten', { objekt_id: o, nummer: nr, flaeche: mea / 5, mea });
      const pid = await insert('personen', { rolle: 'Eigentümer', vorname: vn, nachname: nn, strasse: 'Musterstraße 12', plz: '50667', ort: 'Köln', anrede: 'Herr' });
      await insert('eigentum', { einheit_id: e, person_id: pid, anteil: 100, von: '2020-01-01' });
      await insert('hausgeld', { einheit_id: e, gueltig_ab: '2025-01-01', betrag: hg, davon_ruecklage: rl });
      for (let m = 1; m <= 12; m++) {
        const monat = `2025-${String(m).padStart(2, '0')}`;
        const s = await insert('sollstellungen', { einheit_id: e, person_id: pid, monat, art: 'Hausgeld', betrag: hg, faellig: `${monat}-03` });
        await insert('buchungen', { datum: `${monat}-03`, objekt_id: o, einheit_id: e, sollstellung_id: s, betrag: hg, text: 'Hausgeld', buchungskonto_id: (await db.select(`SELECT id FROM buchungskonten WHERE nummer='1010'`))[0]?.id });
      }
    }
    const k = async (nr) => (await db.select('SELECT id FROM buchungskonten WHERE nummer = $1', [nr]))[0].id;
    const bu = async (d, nr, betrag, text, a35) => insert('buchungen', { datum: d, objekt_id: o, buchungskonto_id: await k(nr), betrag, text, ...(a35 != null ? { anteil_35a: a35 } : {}) });
    await bu('2025-02-10', '1215', -1840.50, 'Wasser');
    await bu('2025-03-15', '1214', -620.40, 'Allgemeinstrom');
    await bu('2025-03-01', '1250', -1980.00, 'Gebäudeversicherung');
    await bu('2025-04-01', '1220', -760.00, 'Grundbesitzabgaben');
    await bu('2025-05-20', '1243', -1440.00, 'Treppenhausreinigung', 1200);
    await bu('2025-11-20', '1241', -380.00, 'Winterdienst', 320);
    await bu('2025-06-18', '1205', -410.00, 'Wartung Heizung', 260);
    await bu('2025-09-12', '1300', -6200.00, 'Dachreparatur', 3900);
    await bu('2025-12-31', '1400', -2880.00, 'Verwalterhonorar');
    await bu('2025-12-31', '1405', -96.00, 'Kontoführung');
    await bu('2025-09-10', '1261', 5000.00, 'Übertrag vom Rücklagenkonto für Dachreparatur');
    await bu('2025-12-31', '1262', 38.20, 'Zinsen Rücklagenkonto');
  });
  await p.goto('http://localhost:5179/#/weg-abrechnung'); await p.waitForTimeout(1500);
  await p.locator('select').filter({ has: p.locator('option', { hasText: 'WEG Musterstraße 12' }) }).first().selectOption({ label: 'WEG Musterstraße 12' }); await p.waitForTimeout(500);
  await p.locator('label:has-text("Jahr") select').first().selectOption('2025'); await p.waitForTimeout(2500);
  // PDF-Bytes abgreifen (Hook direkt vor dem Klick, damit ein Neuladen der Vorschau ihn nicht verliert)
  for (let v = 0; v < 2 && !(await p.evaluate(() => !!window.__pdf)); v++) {
    await p.evaluate(async () => { const m = await import('/src/lib/pdf.ts'); const orig = m.Brief.prototype.bytes; m.Brief.prototype.bytes = function () { const x = orig.call(this); window.__pdf = Array.from(x); return x; }; });
    await p.locator('button:has-text("PDF-Vorschau"), button:has-text("PDF ansehen")').first().click();
    for (let i = 0; i < 40 && !(await p.evaluate(() => !!window.__pdf)); i++) await p.waitForTimeout(500);
  }
  const bytes = await p.evaluate(() => window.__pdf);
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`);
  ok('PDF erzeugt', !!bytes);
  if (bytes) fs.writeFileSync(require('path').join(AUS, 'abrechnung-bloecke.pdf'), Buffer.from(bytes));
  const t = await p.evaluate(async () => {
    const { pdfjsLaden } = await import('/src/lib/pdfjs.ts'); const pdfjs = await pdfjsLaden();
    const d = await pdfjs.getDocument({ data: new Uint8Array(window.__pdf) }).promise; let s = '';
    for (let i = 1; i <= d.numPages; i++) s += (await (await d.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ') + '\n';
    return s.replace(/\s+/g, ' ');
  });
  const g = t.split('Einzelabrechnung 2025')[0], e = t.split('Einheit W1')[1] ?? '';
  const reihe = (s, l) => l.every((x, i) => i === 0 || s.indexOf(x) > s.indexOf(l[i - 1])) && l.every((x) => s.includes(x));
  const B = ['1. Umlagefähige Kosten', '2. Nicht umlagefähige Kosten', '3. Steuerermäßigung nach § 35a EStG', '4. Erhaltungsrücklage'];
  ok('Gesamtabrechnung: 4 Blöcke in der Reihenfolge', reihe(g, B));
  ok('Einzelabrechnung: 4 Blöcke in der Reihenfolge, danach Ergebnis', reihe(e, [...B, 'Nachschuss (Abrechnungsspitze)']));
  ok('Block 1 enthält Wasser 1.840,50, Block 2 Verwalterhonorar 2.880,00', /1\. Umlagef[\s\S]*Kosten - Wasser MEA 1\.840,50[\s\S]*2\. Nicht[\s\S]*Verwalterhonorar MEA 2\.880,00[\s\S]*3\. Steuer/.test(g));
  ok('§ 35a: Dachreparatur mit eingegebenen Arbeitskosten 3.900,00, Summe 5.680,00', /Reparaturen[\s\S]{0,80}Handwerkerleistung \(Abs\. 3\) 6\.200,00 € 3\.900,00 €/.test(g) && /Summe 8\.430,00 € 5\.680,00 €/.test(g));
  ok('§ 35a Einzelabrechnung W1 (40 %): Summe 2.272,00', /3\. Steuer[\s\S]*Summe 2\.272,00 €[\s\S]*4\. Erhaltung/.test(e));
  ok('Rücklage: Bestand 45.000, Entnahme 1261 −5.000, Zinsen 1262 38,20, Bestand 43.038,20', /Bestand 01\.01\.2025 45\.000,00[\s\S]*1261 Entnahmen[^€]*-5\.000,00 €[\s\S]*1262 Zinserträge[^€]*38,20 €[\s\S]*Bestand 31\.12\.2025 43\.038,20/.test(g));
  ok('Einzelabrechnung: Rücklage Ihr Anteil (Entnahme −2.000, Bestand 17.215,28)', /Entnahmen \(Konto 1261\) -5\.000,00 € -2\.000,00 €[\s\S]*Bestand 31\.12\.2025 43\.038,20 € 17\.215,28 €/.test(e));
  ok('Entnahme ändert die Abrechnungsspitze nicht (W1 Nachschuss 2.442,76)', /Nachschuss \(Abrechnungsspitze\) 2\.442,76/.test(e));
  ok('Keine Fehler in der Konsole', errs.length === 0, errs.slice(0, 2).join(' | '));
  await b.close();
})().catch((e) => { console.log('FEHL ' + e.message.split('\n').slice(0, 2).join(' ')); process.exit(1); });
