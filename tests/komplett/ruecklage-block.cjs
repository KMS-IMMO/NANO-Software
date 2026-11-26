// WEG-Jahresabrechnung: Block „Erhaltungsrücklage“ mit Anfangsbestand, Zuführung, Entnahmen, Zinsen, Endbestand und Veränderung
// (grün bei Zunahme, rot bei Abnahme) in der App, in der Gesamtabrechnung und in jeder Einzelabrechnung (mit Anteil nach MEA),
// dazu der Abgleich mit dem Endbestand laut Kontoauszug.
const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  let fehler = 0;
  const ok = (n, c, ist) => { if (!c) fehler++; console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`); };
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const o = await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts');
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'Rücklage Testhaus', strasse: 'Ring 8', plz: '50667', ort: 'Köln', gesamt_mea: 1000, ruecklage_anfang: 45000, ruecklage_stichtag: '2024-12-31' });
    const k = async (nr) => (await db.select('SELECT id FROM buchungskonten WHERE nummer = $1', [nr]))[0].id;
    for (const [nr, mea, hg, rl] of [['W1', 400, 450, 100], ['W2', 350, 395, 90], ['W3', 250, 285, 60]]) {
      const e = await insert('einheiten', { objekt_id: o, nummer: nr, flaeche: mea / 5, mea });
      const pid = await insert('personen', { rolle: 'Eigentümer', vorname: 'Eigner', nachname: nr });
      await insert('eigentum', { einheit_id: e, person_id: pid, anteil: 100, von: '2020-01-01' });
      await insert('hausgeld', { einheit_id: e, gueltig_ab: '2025-01-01', betrag: hg, davon_ruecklage: rl });
      for (let m = 1; m <= 12; m++) {
        const monat = `2025-${String(m).padStart(2, '0')}`;
        const s = await insert('sollstellungen', { einheit_id: e, person_id: pid, monat, art: 'Hausgeld', betrag: hg, faellig: `${monat}-03` });
        await insert('buchungen', { datum: `${monat}-03`, objekt_id: o, einheit_id: e, sollstellung_id: s, betrag: hg, text: 'Hausgeld', buchungskonto_id: await k('1010') });
      }
    }
    const bu = async (d, nr, betrag, text) => insert('buchungen', { datum: d, objekt_id: o, buchungskonto_id: await k(nr), betrag, text });
    await bu('2025-09-12', '1300', -6000, 'Dachreparatur aus der Rücklage');
    await bu('2025-09-10', '1261', 6000, 'Entnahme Rücklage');
    await bu('2025-12-31', '1262', 38.2, 'Zinsen');
    await insert('ruecklage_auszug', { objekt_id: o, jahr: 2025, anfang: 45000, anfang_auszug: '12/2024', ende: 42038.2, ende_datum: '2025-12-31', ende_auszug: '12/2025' });
    return o;
  });
  await p.goto('http://localhost:5179/#/weg-abrechnung'); await p.waitForTimeout(1500);
  await p.locator('select').filter({ has: p.locator('option', { hasText: 'Rücklage Testhaus' }) }).first().selectOption({ label: 'Rücklage Testhaus' }); await p.waitForTimeout(500);
  await p.locator('label:has-text("Jahr") select').first().selectOption('2025'); await p.waitForTimeout(2500);
  const sec = p.locator('section:has(h2:has-text("Vermögensbericht"))').first();
  const t = (await sec.innerText()).replace(/[\u00a0\u202f]/g, ' ');
  ok('App: Anfangsbestand 45.000,00 und Endbestand 42.038,20', /Anfangsbestand 01\.01\.2025\s*45\.000,00 €/.test(t) && /Endbestand 31\.12\.2025\s*42\.038,20 €/.test(t), t.slice(0, 400));
  ok('App: Entnahmen −6.000,00 und Zinsen 38,20', /Entnahmen 2025 \(Konto 1261\)\s*-6\.000,00 €/.test(t) && /Zinserträge 2025 \(Konto 1262\)\s*38,20 €/.test(t));
  const v = sec.locator('tr:has-text("Veränderung im Jahr") td.num');
  ok('App: Veränderung −2.961,80 rot (Abnahme)', (await v.innerText()).includes('-2.961,80') && (await v.getAttribute('class')).includes('neg') && t.includes('Abnahme'), await v.innerText());
  ok('App: Endbestand laut Kontoauszug stimmt überein', /Endbestand laut Kontoauszug vom 31\.12\.2025\s*42\.038,20 € ✓ stimmt überein/.test(t));
  await sec.screenshot({ path: require('path').join(AUS, 'ruecklage-block.png') });
  // PDF: Gesamt- und Einzelabrechnungen
  for (let i = 0; i < 3; i++) {
    await p.evaluate(async () => { const m = await import('/src/lib/pdf.ts'); if (m.Brief.prototype.__h) return; const orig = m.Brief.prototype.bytes; m.Brief.prototype.__h = 1;
      m.Brief.prototype.bytes = function () { const x = orig.call(this); window.__pdf = Array.from(x); return x; }; window.__pdf = null; });
    await p.locator('button:has-text("PDF-Vorschau"), button:has-text("PDF ansehen")').first().click();
    for (let j = 0; j < 40 && !(await p.evaluate(() => !!window.__pdf)); j++) await p.waitForTimeout(500);
    if (await p.evaluate(() => !!window.__pdf)) break;
    await p.locator('.pdf-bg button[title="Schließen"]').first().click().catch(() => {});
  }
  const bytes = await p.evaluate(() => window.__pdf);
  ok('PDF erzeugt', !!bytes);
  if (bytes) {
    const datei = require('path').join(AUS, 'ruecklage-block.pdf'); require('fs').writeFileSync(datei, Buffer.from(bytes));
    let txt = '';
    try { txt = require('child_process').execFileSync('pdftotext', ['-layout', datei, '-'], { encoding: 'utf8' }); } catch { txt = ''; }
    if (txt) {
      const n = (txt.match(/Veränderung im Jahr \(Abnahme\)/g) ?? []).length;
      ok('PDF: Block in Gesamtabrechnung und allen 3 Einzelabrechnungen', n === 4, `${n}x`);
      ok('PDF: Einzelabrechnung W1 mit Anteil 400/1.000 MEA (Anfang 18.000,00, Entnahme −2.400,00)', /Ihr Anteil \(400 \/ 1\.000 MEA\)/.test(txt) && /18\.000,00 €/.test(txt) && /-2\.400,00 €/.test(txt));
      ok('PDF: Kontoauszug stimmt überein', /stimmt überein/.test(txt));
    } else console.log('OK   PDF-Text nicht prüfbar (pdftotext fehlt)');
  }
  ok('Keine Fehler in der Konsole', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();
  process.exit(fehler ? 1 : 0);
})();
