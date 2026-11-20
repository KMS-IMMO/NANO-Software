// Sonderzuführung zur Erhaltungsrücklage: eine Buchung auf Konto 1260 (z. B. Antennenmiete laut Beschluss) erhöht den Bestand
// und steht im Vermögensbericht, erscheint aber nicht als Kosten in der Hausgeldabrechnung. Nur Demodaten.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`);
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const r = await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts'); const rl = await import('/src/logic/ruecklage.ts');
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'Rücklage Testhaus', strasse: 'Gasse 4', plz: '50667', ort: 'Köln', ruecklage_anfang: 10000, ruecklage_stichtag: '2024-12-31' });
    const k = (await db.select(`SELECT id FROM buchungskonten WHERE nummer = '1260'`))[0].id;
    const vor = await rl.ruecklageJahr(o, 2025);
    await insert('buchungen', { datum: '2025-01-07', objekt_id: o, buchungskonto_id: k, betrag: -7529.10, text: 'Umbuchung Antennenmiete 2025 auf Rücklagenkonto' });
    const nach = await rl.ruecklageJahr(o, 2025);
    return { o, vor: vor.bestand, nach: nach.bestand, sonder: nach.sonder, ist: nach.bestandIst, stand26: await rl.ruecklageStand(o, '2026-06-30') };
  });
  ok('Sonderzuführung 7.529,10 erkannt', Math.abs(r.sonder - 7529.10) < 0.001, r.sonder);
  ok('Bestand 31.12.2025 steigt von 10.000 auf 17.529,10', Math.abs(r.vor - 10000) < 0.001 && Math.abs(r.nach - 17529.10) < 0.001, `${r.vor} → ${r.nach}`);
  ok('Auch im Ist-Bestand enthalten', Math.abs(r.ist - 17529.10) < 0.001, r.ist);
  ok('Bestand im Folgejahr übernommen', Math.abs(r.stand26 - 17529.10) < 0.001, r.stand26);
  // EÜR-Häkchen: Konto ohne Häkchen zählt nicht in der Hausgeldabrechnung, mit Häkchen wieder
  const e = await p.evaluate(async (o) => {
    const { db, insert } = await import('/src/db/index.ts'); const v = await import('/src/logic/verteilung.ts');
    const k = (await db.select(`SELECT id FROM buchungskonten WHERE nummer = '1214'`))[0].id;
    await insert('buchungen', { datum: '2025-05-02', objekt_id: o, buchungskonto_id: k, betrag: -250, text: 'Allgemeinstrom EÜR-Test' });
    const drin = async () => (await v.kostenErmitteln(o, 2025, false)).some((x) => x.konto_id === k);
    const an = await drin();
    await db.execute('UPDATE buchungskonten SET euer = 0 WHERE id = $1', [k]); const aus = await drin(); const nk = (await v.kostenErmitteln(o, 2025, true)).some((x) => x.konto_id === k);
    await db.execute('UPDATE buchungskonten SET euer = 1 WHERE id = $1', [k]); const wieder = await drin();
    return { an, aus, wieder, nk };
  }, r.o);
  ok('EÜR an: Konto zählt in der Hausgeldabrechnung', e.an && e.wieder);
  ok('EÜR aus: Konto zählt nicht mehr', e.aus === false);
  ok('Nebenkostenabrechnung der Mieter bleibt unabhängig vom EÜR-Häkchen', e.nk === true);
  await p.goto('http://localhost:5179/#/weg-abrechnung'); await p.waitForTimeout(1500);
  const sel = p.locator('select').filter({ has: p.locator('option', { hasText: 'Rücklage Testhaus' }) }).first();
  await sel.selectOption({ label: 'Rücklage Testhaus' }); await p.waitForTimeout(500);
  const jahr = p.locator('label:has-text("Jahr") select').first(); if (await jahr.count()) { await jahr.selectOption('2025'); await p.waitForTimeout(1500); }
  const t = await p.locator('main').innerText();
  ok('Vermögensbericht zeigt Sonderzuführung', /Sonderzuführungen 2025[\s\S]{0,80}7\.529,10/.test(t));
  ok('Keine Fehler in der Konsole', errs.length === 0, errs.slice(0, 2).join(' | '));
  await b.close();
})().catch((e) => { console.log('FEHL ' + e.message.split('\n')[0]); process.exit(1); });
