// Rücklagen: Anfangs- und Endbestand des Rücklagenkontos laut Kontoauszug von Hand, Vergleich mit den Buchungen, Differenz nachbuchen. Nur Demodaten.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1500, height: 1000 }, locale: 'de-DE' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined && !c ? ' → ' + ist : ''}`);
  const txt = async () => (await p.locator('main').innerText()).replace(/[  ]/g, ' ');
  const AUS = process.env.NEOSS_TEST_AUSGABE;
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const ids = await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts'); const rl = await import('/src/logic/ruecklage.ts');
    const k = async (n) => (await db.select('SELECT id FROM buchungskonten WHERE nummer = $1', [n]))[0].id;
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'WEG Rheinblick Rücklage', gesamt_mea: 1000, ruecklage_anfang: 28500, ruecklage_stichtag: '2023-12-31' });
    await insert('bankkonten', { objekt_id: o, name: 'Rücklagenkonto', bank: 'Sparkasse KölnBonn', iban: 'DE47370501981930447122' });
    for (const [d, betrag, nr, text] of [['2024-12-30', -2940, '1260', 'Zuführung Rücklage 2024'], ['2025-12-30', -2940, '1260', 'Zuführung Rücklage 2025'],
      ['2026-10-30', -2245.80, '1260', 'Zuführung Rücklage Jan–Okt 2026'], ['2026-06-30', 18.40, '1262', 'Zinsen 1. Halbjahr'], ['2026-05-20', -1190, '1261', 'Dachrinne erneuert, Beschluss TOP 5']])
      await insert('buchungen', { datum: d, betrag, buchungskonto_id: await k(nr), objekt_id: o, text, zahlweg: 'bar' });
    await rl.auszugSpeichern(o, 2024, { anfang: 28500, anfangAuszug: '12/2023', ende: 31440, endeDatum: '2024-12-31', endeAuszug: '12/2024' });
    await rl.auszugSpeichern(o, 2025, { anfang: 31440, anfangAuszug: '12/2024', ende: 34380, endeDatum: '2025-12-31', endeAuszug: '12/2025' });
    return { o };
  });
  await p.goto(`http://localhost:5179/#/objekte/${ids.o}/ruecklagen`); await p.waitForTimeout(3000);
  const jw = p.locator('select.jahr-wahl').first(); if (await jw.count()) { await jw.selectOption('2026').catch(() => {}); await p.waitForTimeout(1800); }
  let t = await txt();
  ok('Leiste: Anfang und Ende noch nicht eingegeben, Stand laut Buchungen 35.454,20 €', /Stand laut Buchungen 31\.12\.2026\s*35\.454,20 €/.test(t) && /noch nicht eingegeben/.test(t), t.slice(0, 600));
  ok('Jahre im Überblick: 2024 und 2025 stimmen', (t.match(/stimmt/g) ?? []).length >= 2);
  await p.getByRole('button', { name: 'Bestände laut Kontoauszug' }).click(); await p.waitForTimeout(800);
  ok('Fenster „Rücklagenkonto 2026 laut Kontoauszug“ geht auf', await p.getByText('Rücklagenkonto 2026 laut Kontoauszug').isVisible());
  const m = async () => (await p.locator('.modal').innerText()).replace(/[  ]/g, ' ');
  ok('Vorschlag: Endbestand 2025 laut Kontoauszug 34.380,00 €', /Endbestand 2025 laut Kontoauszug: 34\.380,00 €/.test(await m()), await m());
  await p.locator('.rl-vorschlag button', { hasText: 'übernehmen' }).first().click();
  await p.getByLabel('Auszug Nr. Anfangsbestand').fill('12/2025');
  const df = p.getByLabel('Datum Endbestand'); await df.fill('31.10.2026'); await df.press('Tab');
  await p.getByLabel('Auszug Nr. Endbestand').fill('10/2026');
  await p.getByLabel('Endbestand laut Kontoauszug').fill('35441,70'); await p.getByLabel('Endbestand laut Kontoauszug').press('Tab'); await p.waitForTimeout(800);
  ok('Fenster zeigt Differenz −12,50 € zu den Buchungen bis 31.10.2026', /Laut Buchungen bis 31\.10\.2026: 35\.454,20 €/.test(await m()) && /Differenz [-−]12,50 €/.test(await m()), await m());
  if (AUS) await p.screenshot({ path: `${AUS}/ruecklage-2-fenster.png` });
  await p.getByRole('button', { name: 'Speichern' }).click(); await p.waitForTimeout(1800);
  t = await txt();
  ok('Leiste: Anfang 34.380,00 €, Ende 35.441,70 € vom 31.10.2026, Differenz −12,50 €',
    /34\.380,00 €/.test(t) && /Auszug Nr\. 10\/2026 vom 31\.10\.2026 \(von Hand\)/.test(t) && /Stand laut Buchungen 31\.10\.2026\s*35\.454,20 €/.test(t) && /Differenz\s*[-−]12,50 €/.test(t), t.slice(0, 700));
  ok('Hinweis: 12,50 € fehlen in den Buchungen', /12,50 € fehlen in den Buchungen/.test(t));
  const db1 = await p.evaluate(async (o) => { const { db } = await import('/src/db/index.ts'); return db.select('SELECT * FROM ruecklage_auszug WHERE objekt_id = $1 AND jahr = 2026', [o]); }, ids.o);
  ok('Gespeichert je Liegenschaft und Jahr', db1.length === 1 && db1[0].anfang === 34380 && db1[0].ende === 35441.7 && db1[0].ende_datum === '2026-10-31' && db1[0].ende_auszug === '10/2026', JSON.stringify(db1));
  if (AUS) await p.screenshot({ path: `${AUS}/ruecklage-1-differenz.png`, fullPage: true });
  await p.getByRole('button', { name: /jetzt buchen/ }).click(); await p.waitForTimeout(1800);
  t = await txt();
  ok('Nach dem Buchen: Differenz stimmt, Stand laut Buchungen 35.441,70 €', /Differenz\s*stimmt/.test(t) && /Stand laut Buchungen 31\.10\.2026\s*35\.441,70 €/.test(t), t.slice(0, 700));
  const bu = await p.evaluate(async (o) => { const { db } = await import('/src/db/index.ts'); return db.select(`SELECT b.betrag, b.datum, k.nummer FROM buchungen b JOIN buchungskonten k ON k.id = b.buchungskonto_id WHERE b.objekt_id = $1 AND b.text LIKE 'Ausgleich%'`, [o]); }, ids.o);
  ok('Buchung −12,50 € auf 1261 zum 31.10.2026', bu.length === 1 && bu[0].betrag === -12.5 && bu[0].nummer === '1261' && bu[0].datum === '2026-10-31', JSON.stringify(bu));
  if (AUS) await p.screenshot({ path: `${AUS}/ruecklage-3-stimmt.png`, fullPage: true });
  // Leeren entfernt die Eingabe
  await p.getByRole('button', { name: 'Bestände laut Kontoauszug' }).click(); await p.waitForTimeout(600);
  const leer = p.locator('.rl-vorschlag button', { hasText: 'leeren' }); while (await leer.count()) await leer.first().click();
  await p.getByRole('button', { name: 'Speichern' }).click(); await p.waitForTimeout(1500);
  const db2 = await p.evaluate(async (o) => { const { db } = await import('/src/db/index.ts'); return db.select('SELECT * FROM ruecklage_auszug WHERE objekt_id = $1 AND jahr = 2026', [o]); }, ids.o);
  ok('Leeren entfernt die Eingabe wieder', db2.length === 0, JSON.stringify(db2));
  ok('Keine Fehler in der Konsole', errs.length === 0, errs.join(' | '));
  await b.close();
})();
