// WEG-Jahresabrechnung: Entnahme aus der Erhaltungsrücklage (Konto 1261). Eine Instandsetzung über 10.000 € wird bezahlt,
// 6.000 € davon kommen vom Rücklagenkonto. Die Entnahme muss in der Abrechnung stehen und nach MEA die Abrechnungsspitze mindern.
// Fehler vorher: die Entnahme stand nur unter „Einnahmen“, die Eigentümer sollten die 10.000 € trotzdem voll nachzahlen.
const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`);
  const bild = (n) => process.env.BILDER ? p.screenshot({ path: require('path').join(process.env.BILDER, n), fullPage: true }) : null;
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts');
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'Entnahme Testhaus', strasse: 'Weg 3', plz: '50667', ort: 'Köln', gesamt_mea: 1000, ruecklage_anfang: 20000, ruecklage_stichtag: '2024-12-31' });
    for (const [nr, mea] of [['W1', 600], ['W2', 400]]) {
      const e = await insert('einheiten', { objekt_id: o, nummer: nr, flaeche: 60, mea });
      const pid = await insert('personen', { rolle: 'Eigentümer', vorname: 'Eigner', nachname: nr }); await insert('eigentum', { einheit_id: e, person_id: pid, anteil: 100, von: '2020-01-01' });
    }
    const k = async (nr) => (await db.select('SELECT id FROM buchungskonten WHERE nummer = $1', [nr]))[0].id;
    await insert('buchungen', { datum: '2025-06-10', objekt_id: o, buchungskonto_id: await k('1215'), betrag: -10000, text: 'Instandsetzung Dach' });
    await insert('buchungen', { datum: '2025-06-05', objekt_id: o, buchungskonto_id: await k('1261'), betrag: 6000, text: 'Übertrag vom Rücklagenkonto für Dach' });
  });
  await p.goto('http://localhost:5179/#/weg-abrechnung'); await p.waitForTimeout(1500);
  await p.locator('select').filter({ has: p.locator('option', { hasText: 'Entnahme Testhaus' }) }).first().selectOption({ label: 'Entnahme Testhaus' }); await p.waitForTimeout(500);
  await p.locator('label:has-text("Jahr") select').first().selectOption('2025'); await p.waitForTimeout(2000);
  const t = await p.locator('main').innerText();
  await bild('ruecklage-entnahme.png');
  ok('Hinweis zur Entnahme 6.000,00 € bei den Einzelabrechnungen', /Entnahme aus der Erhaltungsrücklage 2025 \(Konto 1261\): 6\.000,00/.test(t));
  const zeilen = await p.locator('section.card:has(h2:text-is("Einzelabrechnungen")) tbody tr').allInnerTexts();
  const w1 = zeilen.find((z) => z.startsWith('W1')) ?? '', w2 = zeilen.find((z) => z.startsWith('W2')) ?? '';
  ok('W1: Kosten 6.000, Entnahme −3.600, Nachschuss 2.400', /6\.000,00[\s\S]*-3\.600,00[\s\S]*Nachschuss 2\.400,00/.test(w1), w1.replace(/\s+/g, ' '));
  ok('W2: Kosten 4.000, Entnahme −2.400, Nachschuss 1.600', /4\.000,00[\s\S]*-2\.400,00[\s\S]*Nachschuss 1\.600,00/.test(w2), w2.replace(/\s+/g, ' '));
  ok('Summe Abrechnungsspitzen 4.000 statt 10.000', /Summe Abrechnungsspitzen\s*4\.000,00/i.test(t));
  ok('Vermögensbericht zeigt Entnahme 6.000', /Entnahmen \/ Zinsen 2025\s*6\.000,00/.test(t));
  // Ein nachgebuchter Abgang (z. B. Kontoführungsentgelt, negativ auf 1261) ist kein Geld für die Bewirtschaftung und zählt nicht
  await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts');
    const o = (await db.select(`SELECT id FROM objekte WHERE name = 'Entnahme Testhaus'`))[0].id;
    const k = (await db.select(`SELECT id FROM buchungskonten WHERE nummer = '1261'`))[0].id;
    await insert('buchungen', { datum: '2025-12-31', objekt_id: o, buchungskonto_id: k, betrag: -12.5, text: 'Ausgleich Rücklagenkonto laut Kontoauszug', zahlweg: 'bar' });
  });
  await p.locator('label:has-text("Jahr") select').first().selectOption('2024'); await p.waitForTimeout(1000);
  await p.locator('label:has-text("Jahr") select').first().selectOption('2025'); await p.waitForTimeout(2000);
  ok('Abgang auf 1261 ändert die Gegenrechnung nicht', /Summe Abrechnungsspitzen\s*4\.000,00/i.test(await p.locator('main').innerText()));
  ok('Keine Fehler in der Konsole', errs.length === 0, errs.slice(0, 2).join(' | '));
  await b.close();
})().catch((e) => { console.log('FEHL ' + e.message.split('\n').slice(0, 2).join(' ')); process.exit(1); });
