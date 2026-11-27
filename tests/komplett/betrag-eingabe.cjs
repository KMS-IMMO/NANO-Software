const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
// Betragsfelder: Tausenderpunkte schon beim Tippen, Komma (oder ein getippter Punkt) beginnt die Cent, beim Verlassen ,00 ergänzen,
// eingefügte Beträge umrechnen. Geprüft an der Formatierung selbst und im echten Feld (Anfangssaldo beim Bankkonto, Sollstellung in der Liste).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 950 }, locale: 'de-DE', permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + JSON.stringify(ist) : ''}`);
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);

  // 1) Formatierung beim Tippen
  const f = await p.evaluate(async () => {
    const { betragLive, betragZahl } = await import('/src/lib/betrag.ts');
    const t = (s) => betragLive(s).text;
    return { a: t('11354'), b: t('11354,5'), c: t('11354,567'), d: t('-1234567'), e: t('0001'), f: t(',5'), g: t('1.1354'), h: t(''), i: betragZahl(t('11354')), j: betragZahl(t('1234567,8')),
      caret: betragLive('1.2345', 6) };
  });
  ok('11354 → 11.354', f.a === '11.354', f.a);
  ok('11354,5 → 11.354,5', f.b === '11.354,5', f.b);
  ok('höchstens zwei Cent-Stellen', f.c === '11.354,56', f.c);
  ok('Minus und Millionen', f.d === '-1.234.567', f.d);
  ok('führende Nullen weg', f.e === '1', f.e);
  ok(',5 → 0,5', f.f === '0,5', f.f);
  ok('Punkte werden neu gesetzt', f.g === '11.354', f.g);
  ok('leer bleibt leer', f.h === '', f.h);
  ok('formatierter Text wird wieder als Zahl gelesen', f.i === 11354 && f.j === 1234567.8, [f.i, f.j]);
  ok('Cursor bleibt hinter der getippten Ziffer', f.caret.text === '12.345' && f.caret.caret === 6, f.caret);

  // 2) Echtes Feld: Anfangssaldo beim Bankkonto
  await p.goto('http://localhost:5179/#/bank'); await p.waitForTimeout(2500);
  await p.locator('button[title="Kontodaten bearbeiten"]').first().click(); await p.waitForTimeout(600);
  const feld = p.locator('label', { hasText: 'Anfangssaldo' }).locator('input');
  await feld.click(); await p.keyboard.press('ControlOrMeta+A'); await p.keyboard.press('Backspace');
  await p.keyboard.type('11354', { delay: 30 });
  const w1 = await feld.inputValue();
  ok('Anfangssaldo: beim Tippen 11.354', w1 === '11.354', w1);
  await p.keyboard.type(',5', { delay: 30 });
  const w2 = await feld.inputValue();
  ok('Anfangssaldo: Komma beginnt die Cent', w2 === '11.354,5', w2);
  await p.locator('label', { hasText: 'Bank' }).first().locator('input').click(); await p.waitForTimeout(200);
  const w3 = await feld.inputValue();
  ok('Anfangssaldo: beim Verlassen 11.354,50', w3 === '11.354,50', w3);
  await p.getByRole('button', { name: 'Speichern' }).click(); await p.waitForTimeout(800);
  const gesp = await p.evaluate(async () => { const { db } = await import('/src/db/index.ts'); return (await db.select('SELECT anfangssaldo FROM bankkonten ORDER BY id LIMIT 1'))[0].anfangssaldo; });
  ok('Anfangssaldo mit Tausenderpunkt wird als Zahl gespeichert', Number(gesp) === 11354.5, gesp);

  // getippter Punkt = Komma, Einfügen aus der Zwischenablage
  await p.locator('button[title="Kontodaten bearbeiten"]').first().click(); await p.waitForTimeout(600);
  const anzeige = await feld.inputValue();
  ok('Gespeicherter Saldo erscheint formatiert', anzeige === '11.354,50', anzeige);
  await feld.click(); await p.keyboard.press('ControlOrMeta+A'); await p.keyboard.press('Backspace');
  await p.keyboard.type('2500.75', { delay: 30 });
  const w4 = await feld.inputValue();
  ok('Ein getippter Punkt wird zum Komma', w4 === '2.500,75', w4);
  await p.keyboard.press('ControlOrMeta+A');
  await p.evaluate(() => navigator.clipboard.writeText('1234.5'));
  await p.keyboard.press('ControlOrMeta+V'); await p.waitForTimeout(200);
  const w5 = await feld.inputValue();
  ok('Eingefügtes 1234.5 wird 1.234,50', w5 === '1.234,50', w5);
  await p.getByRole('button', { name: 'Abbrechen' }).click(); await p.waitForTimeout(300);

  // 3) Betragsfeld in der Buchungsmaske (BetragFeld wie überall): 1500 → 1.500, Verlassen → 1.500,00
  const r = await p.evaluate(async () => {
    const { insert } = await import('/src/db/index.ts');
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'Betragshaus', strasse: 'Weg 1', plz: '50667', ort: 'Köln' });
    const e = await insert('einheiten', { objekt_id: o, nummer: 'WE 1', mea: 1000 });
    const pid = await insert('personen', { rolle: 'Eigentümer', vorname: 'Bea', nachname: 'Betrag' });
    await insert('eigentum', { einheit_id: e, person_id: pid, anteil: 100, von: '2020-01-01' });
    await insert('sollstellungen', { einheit_id: e, person_id: pid, monat: '2026-11', art: 'Hausgeld', betrag: 250, faellig: '2026-11-03' });
    return { o };
  });
  await p.goto(`http://localhost:5179/#/objekte/${r.o}/sollstellungen`); await p.waitForTimeout(2500);
  const monat = p.locator('select').filter({ has: p.locator('option', { hasText: 'Dezember' }) });
  if (await monat.count()) { await monat.nth(0).selectOption({ label: 'November' }).catch(() => {}); await monat.nth(1).selectOption({ label: 'November' }).catch(() => {}); await p.waitForTimeout(1200); }
  const zelle = p.locator('td.num input.cell').first();
  const da = await zelle.count();
  ok('Sollstellung mit Betragsfeld in der Liste', da > 0, da);
  if (da) {
    await zelle.click(); await p.keyboard.press('ControlOrMeta+A'); await p.keyboard.press('Backspace');
    await p.keyboard.type('1250', { delay: 30 });
    const z1 = await zelle.inputValue();
    ok('Sollstellung: beim Tippen 1.250', z1 === '1.250', z1);
    await p.locator('h1, h2').first().click(); await p.waitForTimeout(800);
    const z2 = await zelle.inputValue();
    const db = await p.evaluate(async (o) => { const { db } = await import('/src/db/index.ts'); return (await db.select("SELECT s.betrag FROM sollstellungen s JOIN einheiten e ON e.id = s.einheit_id WHERE e.objekt_id = $1", [o]))[0].betrag; }, r.o);
    ok('Sollstellung: beim Verlassen 1.250,00 und als 1250 gespeichert', z2 === '1.250,00' && Number(db) === 1250, [z2, db]);
  }
  ok('Keine Fehler in der Konsole', errs.length === 0, errs.slice(0, 3));
  await b.close();
})().catch((e) => { console.log('FAIL Abbruch ' + e.message); process.exit(1); });
