const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
// Ablage der Liegenschaft: Ordner „Einheiten“ mit einem Ordner je Einheit, darin nur deren Unterlagen (Demodaten)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'de-DE', deviceScaleFactor: 2 });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`);
  const q = (sql) => p.evaluate(async (s) => { const { db } = await import('/src/db/index.ts'); return db.select(s); }, sql);
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const d = await p.evaluate(async () => {
    const { insert } = await import('/src/db/index.ts');
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'WEG Kastanienweg', strasse: 'Kastanienweg 9', plz: '50674', ort: 'Köln', objekt_nr: '9004' });
    const e = [];
    for (const [i, n] of ['Musterfrau', 'Mustermann', 'Beispiel'].entries()) {
      const pid = await insert('personen', { rolle: 'Eigentümer', anrede: 'Frau', vorname: 'Test', nachname: n });
      const eid = await insert('einheiten', { objekt_id: o, nummer: `K${i + 1}`, typ: 'Wohnung', mea: 333, lfd_nr: i + 1 });
      await insert('eigentum', { einheit_id: eid, person_id: pid, anteil: 100 }); e.push(eid);
    }
    const m = await insert('personen', { rolle: 'Mieter', anrede: 'Herr', vorname: 'Tom', nachname: 'Tester' });
    const v = await insert('mietvertraege', { einheit_id: e[0], mieter_id: m, beginn: '2026-04-01', kaltmiete: 600, nk_vorauszahlung: 120, hk_vorauszahlung: 30, zahlung_an: 'Eigentümer' });
    await insert('dokumente', { bezug: 'Mietvertrag', bezug_id: v, ordner: 'Mietvertrag', dateiname: 'Mietvertrag Tester.pdf', pfad: 'Mietvertrag Tester.pdf' });
    await insert('dokumente', { bezug: 'Einheit', bezug_id: e[0], ordner: 'Grundrisse', dateiname: 'Grundriss K1.pdf', pfad: 'Grundriss K1.pdf' });
    await insert('dokumente', { bezug: 'Objekt', bezug_id: o, ordner: '03 - Versicherung', dateiname: 'Police Gebäude.pdf', pfad: 'Police Gebäude.pdf' });
    return { o, e, v };
  });
  await p.goto(`http://localhost:5179/#/objekte/${d.o}/dokumente`); await p.waitForSelector('.ordner-raster', { timeout: 15000 }); await p.waitForTimeout(800);
  const kachel = p.locator('.einheiten-kachel');
  ok('Ordner „Einheiten“ in der Liegenschaft', await kachel.count() === 1 && /3 Ordner · 2 Dateien/.test((await kachel.innerText()).replace(/\s+/g, ' ')), (await kachel.innerText().catch(() => '')).replace(/\s+/g, ' '));
  ok('„Einheiten“ steht nach den Ordnern der Vorlage', await p.locator('.ordner-raster > .ordner-kachel').last().evaluate((x) => x.classList.contains('einheiten-kachel')));
  await p.locator('.card').filter({ has: p.locator('.ordner-raster') }).first().screenshot({ path: AUS + '/ordner-liegenschaft.png' });
  await kachel.click(); await p.waitForTimeout(600);
  const eKacheln = p.locator('.einheit-ordner');
  ok('Ein Ordner je Einheit', await eKacheln.count() === 3, await eKacheln.count());
  ok('Ordner zeigt Nummer, Bewohner und Dateien', /K1[\s\S]*Tester, Tom[\s\S]*2 Dateien/.test(await eKacheln.first().innerText()), (await eKacheln.first().innerText()).replace(/\s+/g, ' '));
  ok('„Durchsuchen…“ erst in einer Einheit', await p.locator('button:has-text("Durchsuchen")').isDisabled());
  await p.locator('.card').filter({ has: p.locator('.ordner-raster') }).first().screenshot({ path: AUS + '/ordner-einheiten.png' });
  await eKacheln.first().click(); await p.waitForTimeout(800);
  const pfad = (await p.locator('.ordner-pfad').innerText()).replace(/\s+/g, ' ');
  ok('Pfad: Liegenschaft / Einheiten / K1', /WEG Kastanienweg \/ Einheiten \/ K1/.test(pfad), pfad);
  const namen = (await p.locator('.ordner-raster .ordner-kachel .ordner-name').allInnerTexts()).join(', ');
  ok('Ordner der Einheit aus der Vorlage plus Mietverträge', /Grundrisse/.test(namen) && /Übergabeprotokolle/.test(namen) && /Mietverträge/.test(namen) && !/Versicherung/.test(namen), namen);
  await p.locator('.card').filter({ has: p.locator('.ordner-raster') }).first().screenshot({ path: AUS + '/ordner-einheit.png' });
  // Mietverträge: Unterlagen des Mietvertrags dieser Einheit
  await p.locator('.ordner-kachel:has-text("Mietverträge")').click(); await p.waitForTimeout(400);
  await p.locator('.ordner-kachel:has-text("Tester")').first().click(); await p.waitForTimeout(400);
  ok('Mietvertrag-Unterlagen im Ordner „Mietverträge“', /Mietvertrag Tester\.pdf/.test(await p.locator('.dateiliste').innerText().catch(() => '')));
  // Hochladen in „Übergabeprotokolle“ der Einheit
  await p.locator('.ordner-pfad button:has-text("K1")').click(); await p.waitForTimeout(300);
  await p.locator('.ordner-kachel:has-text("Übergabeprotokolle")').click(); await p.waitForTimeout(300);
  const [wahl] = await Promise.all([p.waitForEvent('filechooser'), p.locator('button:has-text("Durchsuchen")').click()]);
  await wahl.setFiles({ name: 'Uebergabe K1.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 Test') }); await p.waitForTimeout(1200);
  const neu = await q(`SELECT bezug, bezug_id, ordner FROM dokumente WHERE dateiname = 'Uebergabe K1.pdf'`);
  ok('Datei gehört zur Einheit, Ordner Übergabeprotokolle', neu.length === 1 && neu[0].bezug === 'Einheit' && neu[0].bezug_id === d.e[0] && neu[0].ordner === 'Übergabeprotokolle', JSON.stringify(neu));
  ok('Meldung nennt den Ordner der Einheit', /WEG Kastanienweg \/ Einheiten \/ K1 \/ Übergabeprotokolle/.test(await p.locator('p.info').innerText().catch(() => '')));
  // Zurück: Zähler stimmen, Liegenschaft zeigt die Datei nicht bei sich
  await p.locator('.ordner-pfad button:has-text("Einheiten")').click(); await p.waitForTimeout(500);
  ok('Einheit K1 zählt jetzt 3 Dateien', /3 Dateien/.test(await p.locator('.einheit-ordner').first().innerText()));
  ok('Andere Einheiten leer', /leer/.test(await p.locator('.einheit-ordner').nth(1).innerText()));
  await p.locator('.ordner-pfad button:has-text("WEG Kastanienweg")').click(); await p.waitForTimeout(500);
  ok('Zurück in der Liegenschaft', await p.locator('.einheiten-kachel').count() === 1 && await p.locator('.einheit-ordner').count() === 0);
  const imObjekt = await q(`SELECT COUNT(*) n FROM dokumente WHERE bezug = 'Objekt' AND bezug_id = ${d.o}`);
  ok('Liegenschaft hat nur ihre eigene Datei', imObjekt[0].n === 1, imObjekt[0].n);
  ok('Keine Fehler in der Konsole', !errs.length, errs.join(' | ').slice(0, 300));
  await b.close();
})().catch((e) => { console.log('FAIL Abbruch: ' + e.message); process.exit(1); });
