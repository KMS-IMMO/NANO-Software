const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
// Rechnung erfassen im Stil des Buchen-Fensters: Konto-Rad, Immobilie und Einheiten, Lieferant (Demodaten)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1250 }, locale: 'de-DE', deviceScaleFactor: 2 });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`);
  const q = (sql) => p.evaluate(async (s) => { const { db } = await import('/src/db/index.ts'); return db.select(s); }, sql);
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const d = await p.evaluate(async () => {
    const { insert } = await import('/src/db/index.ts');
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'WEG Birkenhof', strasse: 'Birkenhof 3', plz: '50670', ort: 'Köln', objekt_nr: '9003' });
    const e = [];
    for (const [i, n] of ['Musterfrau', 'Mustermann', 'Beispiel'].entries()) {
      const pid = await insert('personen', { rolle: 'Eigentümer', anrede: 'Frau', vorname: 'Test', nachname: n });
      const eid = await insert('einheiten', { objekt_id: o, nummer: `B${i + 1}`, typ: 'Wohnung', mea: 333, lfd_nr: i + 1 });
      await insert('eigentum', { einheit_id: eid, person_id: pid, anteil: 100 }); e.push(eid);
    }
    const f = await insert('firmen', { name: 'Gartenbau Beispiel GmbH', gewerk: 'Garten' });
    return { o, e, f };
  });
  await p.goto('http://localhost:5179/#/rechnungen'); await p.waitForSelector('.rerf .krad', { timeout: 15000 }); await p.waitForTimeout(800);
  const r = p.locator('.rerf');
  ok('Konto-Rad statt Auswahlliste', await r.locator('.krad').count() === 1 && await r.locator('label:has-text("Buchungskonto") select').count() === 0);
  ok('Schritte 1 Konto, 2 Immobilie und Einheiten, 3 Lieferant', /Konto[\s\S]*Immobilie und Einheiten[\s\S]*Lieferant oder Dienstleister/.test(await r.innerText()));
  const kopf = (l) => r.locator(`.bf-kopf label:has(> span:text-matches("^${l}")) input`);
  await kopf('Betrag brutto').fill('300'); await kopf('Rechnungsnummer').fill('RE-2026-77');
  // Konto über die Suche: Winterdienst (1241, § 35a)
  await r.locator('.bf-suche input').fill('1241'); await p.waitForTimeout(900);
  ok('Suche dreht das Rad auf 1241', /1241 Winterdienst/.test(await r.locator('.bf-gewaehlt').innerText()) && /1241/.test(await r.locator('.krad-eintrag.mitte').innerText()));
  ok('§ 35a-Schritt erscheint', await r.locator('.bf-neu:has-text("§ 35a")').count() === 1);
  await r.locator('.bf-neu input').fill('200');
  // Immobilie und Einheiten
  await r.locator('.bf-schritt select').first().selectOption({ label: 'H-ID 9003 · WEG Birkenhof' }); await p.waitForTimeout(500);
  const zeilen = r.locator('.bf-liste .bf-zeile');
  ok('Alle Einheiten + 3 Wohnungen mit Namen', await zeilen.count() === 4 && /Musterfrau/.test(await zeilen.nth(1).innerText()), await zeilen.count());
  ok('Vorgewählt: Alle Einheiten', /an/.test(await zeilen.nth(0).getAttribute('class')));
  await zeilen.nth(1).click(); await p.waitForTimeout(200);
  ok('Eine Einheit: ganzer Betrag', /ganze Betrag geht auf diese Einheit/.test(await r.innerText()));
  await zeilen.nth(2).click(); await p.waitForTimeout(300);
  const felder = r.locator('.bf-liste .bf-zeile input');
  ok('Zwei Einheiten: je 150,00 €', await felder.count() === 2 && (await felder.nth(0).inputValue()) === '150,00' && (await felder.nth(1).inputValue()) === '150,00',
    `${await felder.nth(0).inputValue()} / ${await felder.nth(1).inputValue()}`);
  await felder.nth(0).fill('100'); await p.waitForTimeout(200);
  ok('Summe stimmt nicht: Hinweis', /Summe 250,00 € von 300,00 €/.test((await r.innerText()).replace(/\s+/g, ' ')));
  await felder.nth(1).fill('200'); await p.waitForTimeout(200);
  // Lieferant aus den Kontakten
  await r.locator('input[list="rerf-firmen"]').fill('Gartenbau Beispiel GmbH'); await p.waitForTimeout(200);
  ok('Kontakt erkannt', /Kontakt zugeordnet/.test(await r.innerText()));
  await p.setViewportSize({ width: 1600, height: 2100 }); await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(600);
  await r.screenshot({ path: AUS + '/rechnung-erfassen.png' }); await p.setViewportSize({ width: 1600, height: 1250 });
  await r.locator('button.primary:has-text("Rechnung speichern")').click(); await p.waitForTimeout(1200);
  const info = (await p.locator('p.info').allInnerTexts()).join(' ').replace(/\s+/g, ' ');
  ok('Meldung nach dem Speichern', /Rechnung RE-2026-77 über 300,00 € gespeichert, aufgeteilt auf 2 Einheiten/.test(info), info);
  const rg = await q(`SELECT r.einheit_id, r.betrag, r.anteil_lohn, r.firma_id, r.rechnungsnr, k.nummer FROM rechnungen r JOIN buchungskonten k ON k.id = r.buchungskonto_id WHERE r.objekt_id = ${d.o} ORDER BY r.betrag`);
  ok('Zwei Rechnungszeilen je Einheit mit Konto, Kontakt und § 35a', rg.length === 2 && rg[0].betrag === 100 && rg[1].betrag === 200 && rg[0].einheit_id === d.e[0] && rg[1].einheit_id === d.e[1]
    && rg.every((x) => x.nummer === '1241' && x.firma_id === d.f && x.rechnungsnr === 'RE-2026-77') && Math.abs(rg[0].anteil_lohn + rg[1].anteil_lohn - 200) < 0.01, JSON.stringify(rg));
  ok('Formular geleert, Einheiten wieder „Alle“', (await kopf('Betrag brutto').inputValue()) === '' && await r.locator('.bf-liste .bf-zeile.an').count() === 1);
  // Konto mit Pflicht zur Rechnungsnummer
  await r.locator('.bf-suche input').fill('1205'); await p.waitForTimeout(700);
  await kopf('Betrag brutto').fill('80');
  await r.locator('button.primary:has-text("Rechnung speichern")').click(); await p.waitForTimeout(400);
  ok('Rechnungsnummer verlangt (Konto 1205)', /Konto 1205 verlangt eine Rechnungsnummer/.test(await r.innerText()));
  // Gutschrift auf alle Einheiten
  await r.locator('.card-head .seg button:has-text("Gutschrift")').click(); await p.waitForTimeout(200);
  ok('Titel wechselt zu „Gutschrift erfassen“', /Gutschrift erfassen/.test(await r.locator('.card-head h2').innerText()));
  await kopf('Rechnungsnummer').fill('GS-5'); await kopf('Betrag brutto').fill('50');
  await r.locator('button.primary:has-text("Gutschrift speichern")').click(); await p.waitForTimeout(1200);
  const gs = await q(`SELECT einheit_id, betrag FROM rechnungen WHERE objekt_id = ${d.o} AND rechnungsnr = 'GS-5'`);
  ok('Gutschrift auf alle Einheiten (−50 €)', gs.length === 1 && gs[0].einheit_id === null && gs[0].betrag === -50, JSON.stringify(gs));
  // In einer Liegenschaft: Immobilie steht fest
  await p.goto(`http://localhost:5179/#/objekte/${d.o}/rechnungen`); await p.waitForTimeout(2000);
  await p.locator('button:has-text("Rechnung erfassen")').first().click(); await p.waitForSelector('.modal .rerf .krad', { timeout: 10000 }); await p.waitForTimeout(1800);
  const fest = await p.locator('.modal .rerf .rerf-objekt').innerText().catch(() => '');
  ok('In der Liegenschaft: Immobilie steht fest, Einheiten gleich sichtbar', /WEG Birkenhof/.test(fest) && await p.locator('.modal .bf-liste .bf-zeile').count() === 4, fest);
  await p.locator('.modal').screenshot({ path: AUS + '/rechnung-erfassen-liegenschaft.png' });
  ok('Fenster ohne doppelte Überschrift', await p.locator('.modal h3:has-text("Rechnung / Gutschrift erfassen")').count() === 0);
  ok('Keine Fehler in der Konsole', !errs.length, errs.join(' | ').slice(0, 300));
  await b.close();
})().catch((e) => { console.log('FAIL Abbruch: ' + e.message); process.exit(1); });
