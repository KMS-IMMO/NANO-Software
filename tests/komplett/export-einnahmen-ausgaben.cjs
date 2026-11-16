// PDF-Export unter „Einnahmen & Ausgaben“: ein PDF nur mit den Einnahmen, eins nur mit den Ausgaben, jeweils mit den gesetzten Filtern
const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 950 }, locale: 'de-DE', acceptDownloads: true });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  p.on('dialog', (d) => d.accept());
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`);
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const o = await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts');
    const o = await insert('objekte', { verwaltungsart: 'Mietverwaltung', name: 'Exporthaus Test', strasse: 'Lindenweg 4', plz: '50667', ort: 'Köln' });
    const e = await insert('einheiten', { objekt_id: o, nummer: 'EG links' });
    const k = async (n) => (await db.select(`SELECT id FROM buchungskonten WHERE nummer = '${n}'`))[0]?.id;
    const miete = await k('1001'), grundst = await k('1220');
    const eig = (await db.select(`SELECT id FROM buchungskonten WHERE art = 'Eigentümer' LIMIT 1`))[0]?.id;
    for (const [d, betr, kt, t, ei] of [['2026-03-01', 750, miete, 'Miete März Exporttest', e], ['2026-04-01', 750, miete, 'Miete April Exporttest', e],
      ['2026-03-15', -120.5, grundst, 'Grundsteuer Q1 Exporttest', null], ['2026-04-20', -80, grundst, 'Grundsteuer Nachzahlung Exporttest', null]])
      await insert('buchungen', { datum: d, objekt_id: o, einheit_id: ei, buchungskonto_id: kt, betrag: betr, text: t });
    if (eig) await insert('buchungen', { datum: '2026-04-30', objekt_id: o, buchungskonto_id: eig, betrag: -500, text: 'Auszahlung Eigentümer Exporttest' });
    return { o, eig: !!eig };
  });
  await p.goto(`http://localhost:5179/#/objekte/${o.o}/buchungen`); await p.waitForTimeout(1500);
  await p.locator('label:has-text("Jahr") input').first().fill('2026'); await p.waitForTimeout(1000);
  await p.getByRole('button', { name: 'PDF ▾' }).click(); await p.waitForTimeout(300);
  ok('PDF-Menü zeigt „Nur Einnahmen“ und „Nur Ausgaben“', await p.getByRole('button', { name: 'Nur Einnahmen' }).count() === 1 && await p.getByRole('button', { name: 'Nur Ausgaben' }).count() === 1);
  await p.screenshot({ path: `${AUS}/export-pdf-menue.png` });
  await p.getByRole('button', { name: 'PDF ▾' }).click(); await p.waitForTimeout(200);
  const lesen = async (knopf) => {
    await p.getByRole('button', { name: 'PDF ▾' }).click(); await p.waitForTimeout(200);
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.getByRole('button', { name: knopf, exact: true }).click()]);
    const pfad = await dl.path(); const bytes = require('fs').readFileSync(pfad);
    const r = await p.evaluate(async (b64) => {
      const { pdfjsLaden } = await import('/src/lib/pdfjs.ts'); const pdfjs = await pdfjsLaden();
      const by = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const d = await pdfjs.getDocument({ data: by }).promise; let t = ''; let bild = '';
      for (let i = 1; i <= d.numPages; i++) {
        const s = await d.getPage(i); t += (await s.getTextContent()).items.map((x) => x.str).join(' ') + '\n';
        if (i === 1) { const vp = s.getViewport({ scale: 1240 / s.getViewport({ scale: 1 }).width }); const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; await s.render({ canvasContext: c.getContext('2d'), viewport: vp, canvas: c }).promise; bild = c.toDataURL('image/png'); }
      }
      return { t: t.replace(/\s+/g, ' '), bild };
    }, bytes.toString('base64'));
    require('fs').writeFileSync(`${AUS}/export-${knopf.replace(/\s+/g, '-')}.png`, Buffer.from(r.bild.split(',')[1], 'base64'));
    require('fs').writeFileSync(`${AUS}/export-${knopf.replace(/\s+/g, '-')}.pdf`, bytes);
    return { name: dl.suggestedFilename(), montserrat: bytes.includes('Montserrat'), ...r };
  };
  const ein = await lesen('Nur Einnahmen');
  ok('Einnahmen: Dateiname', ein.name === 'Einnahmen Exporthaus Test 2026.pdf', ein.name);
  ok('Einnahmen: Briefpapier-Schrift Montserrat', ein.montserrat);
  ok('Einnahmen: beide Mieten mit Summe 1.500,00 €', ein.t.includes('Miete März Exporttest') && ein.t.includes('Miete April Exporttest') && ein.t.includes('1.500,00 €'), ein.t.slice(0, 200));
  ok('Einnahmen: keine Ausgaben im PDF', !ein.t.includes('Grundsteuer') && !ein.t.includes('Auszahlung Eigentümer Exporttest') && !ein.t.includes('Nicht enthalten'));
  const aus = await lesen('Nur Ausgaben');
  ok('Ausgaben: Dateiname', aus.name === 'Ausgaben Exporthaus Test 2026.pdf', aus.name);
  ok('Ausgaben: beide Grundsteuer-Buchungen mit Summe 200,50 €', aus.t.includes('Grundsteuer Q1 Exporttest') && aus.t.includes('Grundsteuer Nachzahlung Exporttest') && aus.t.includes('200,50 €'), aus.t.slice(0, 200));
  ok('Ausgaben: keine Einnahmen im PDF', !aus.t.includes('Miete März Exporttest'));
  ok('Ausgaben: Auszahlung an den Eigentümer zählt nicht als Ausgabe', !aus.t.includes('Auszahlung Eigentümer Exporttest') && (!o.eig || aus.t.includes('Nicht enthalten: 1 Auszahlung an den Eigentümer')));
  // Filter Monat April: nur die Buchungen aus April
  await p.locator('select').filter({ has: p.locator('option', { hasText: 'Alle Monate' }) }).first().selectOption('04'); await p.waitForTimeout(1000);
  const april = await lesen('Nur Ausgaben');
  ok('Filter Monat wirkt: nur April', april.t.includes('Grundsteuer Nachzahlung Exporttest') && !april.t.includes('Grundsteuer Q1 Exporttest') && april.t.includes('80,00 €') && april.name === 'Ausgaben Exporthaus Test 04-2026.pdf', april.name);
  // Buchungsjournal ohne Liegenschaft: Spalte mit Liegenschaft
  await p.goto('http://localhost:5179/#/journal'); await p.waitForTimeout(1500);
  await p.locator('label:has-text("Jahr") input').first().fill('2026'); await p.waitForTimeout(1200);
  const alle = await lesen('Nur Einnahmen');
  ok('Buchungsjournal: Einnahmen aller Liegenschaften', alle.name === 'Einnahmen Alle Liegenschaften 2026.pdf' && alle.t.includes('Exporthaus Test · EG links'), alle.name);
  ok('Abgelegt im Dateimanager', (await p.evaluate(async () => { const { db } = await import('/src/db/index.ts'); return db.select(`SELECT COUNT(*) AS n FROM dokumente WHERE dateiname LIKE 'Einnahmen Exporthaus%' OR dateiname LIKE 'Ausgaben Exporthaus%'`); }))[0].n >= 3);
  ok('Keine Fehler in der Konsole', errs.length === 0, errs.slice(0, 2).join(' | '));
  await b.close();
})().catch((e) => { console.log('FEHL ' + e.message); process.exit(1); });
