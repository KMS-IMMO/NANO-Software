// Einnahmen & Ausgaben mit Kontostand (nur Demodaten): Kontostand-Leiste, Bankstatus je Buchung, Buchung ohne Kontoumsatz
// mit passendem offenen Umsatz verbinden (keine doppelte Buchung), Bar-Kennzeichen, Ansicht Kontoumsätze mit laufendem Stand
// und Neuberechnung nach jeder Änderung.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1500, height: 1000 }, locale: 'de-DE' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined && !c ? ' → ' + ist : ''}`);
  const txt = async () => (await p.locator('main').innerText()).replace(/ /g, ' ');
  const AUS = process.env.NEOSS_TEST_AUSGABE;
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const ids = await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts'); const bank = await import('/src/logic/bank.ts');
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'WEG Kontostand', gesamt_mea: 1000 });
    const bk = await insert('bankkonten', { objekt_id: o, name: 'Hausgeldkonto', anfangssaldo: 10000, saldo_datum: '2026-09-30' });
    await bank.importieren(bk, [
      { datum: '2026-10-01', betrag: 410, verwendungszweck: 'Hausgeld Oktober WE 1', gegenpartei: 'Maria Wagner', gegen_iban: 'DE11' },
      { datum: '2026-10-05', betrag: 320, verwendungszweck: 'Hausgeld Oktober WE 3', gegenpartei: 'Yetim Ahmet u. Elif', gegen_iban: 'DE33' },
      { datum: '2026-10-06', betrag: -186, verwendungszweck: 'Abschlag Wasser 10/26', gegenpartei: 'RheinEnergie AG', gegen_iban: 'DE44' },
    ]);
    const k = async (n) => (await db.select('SELECT id FROM buchungskonten WHERE nummer = $1', [n]))[0].id;
    const wasser = (await db.select("SELECT * FROM bankumsaetze WHERE bankkonto_id = $1 AND betrag = -186", [bk]))[0];
    await bank.zuordnenKonto(wasser, await k('1215'));
    const wagner = (await db.select("SELECT * FROM bankumsaetze WHERE bankkonto_id = $1 AND betrag = 410", [bk]))[0];
    await bank.zuordnenKonto(wagner, await k('1010'));
    // Yetim unter Einnahmen & Ausgaben gebucht, ohne Kontoumsatz; dazu Streusalz bar
    const y = await insert('buchungen', { datum: '2026-10-03', betrag: 320, buchungskonto_id: await k('1010'), objekt_id: o, text: 'Hausgeld Oktober Yetim' });
    await insert('buchungen', { datum: '2026-10-24', betrag: -38.9, buchungskonto_id: await k('1302'), objekt_id: o, text: 'Streusalz' });
    const yu = (await db.select("SELECT * FROM bankumsaetze WHERE bankkonto_id = $1 AND betrag = 320", [bk]))[0];
    const v = await bank.vorschlag(yu);
    return { o, bk, y, vorschlag: v };
  });
  ok('Vorschlag beim Zuordnen: vorhandene Buchung verbinden, nicht automatisch', ids.vorschlag?.art === 'buchung' && ids.vorschlag.id === ids.y && !ids.vorschlag.sicher, JSON.stringify(ids.vorschlag));
  const auto = await p.evaluate(async () => (await import('/src/logic/bank.ts')).automatischZuordnen());
  const n320 = await p.evaluate(async (y) => { const { db } = await import('/src/db/index.ts'); return (await db.select("SELECT COUNT(*) AS n FROM buchungen WHERE betrag = 320 AND objekt_id = (SELECT objekt_id FROM buchungen WHERE id = $1)", [y]))[0].n; }, ids.y);
  ok('Automatisches Zuordnen bucht die 320 € nicht doppelt', Number(n320) === 1, `${n320} Buchungen, ${JSON.stringify(auto)}`);

  await p.goto(`http://localhost:5179/#/objekte/${ids.o}/buchungen`); await p.waitForTimeout(3500);
  await p.locator('select.jahr-wahl').first().selectOption('2026').catch(() => {}); await p.waitForTimeout(2000);
  let t = await txt();
  ok('Kontostand laut Bank 10.544,00 €', /Kontostand laut Bank\s*10\.544,00 €/.test(t), (t.match(/Kontostand laut Bank[^\n]*\n[^\n]*/) ?? [''])[0]);
  ok('Stand laut Buchungen 10.505,10 € (Yetim und Streusalz ohne Kontoumsatz)', /Stand laut Buchungen\s*10\.505,10 €/.test(t), (t.match(/Stand laut Buchungen[^\n]*\n[^\n]*/) ?? [''])[0]);
  ok('Differenz 38,90 € mit Gründen', /Differenz\s*38,90 €/.test(t) && /2 ohne Kontoumsatz · 281,10 €/.test(t) && /1 Kontoumsätze offen · 320,00 €/.test(t));
  ok('Rote Zeile mit Hinweis „gibt es schon“', /Diese Buchung gibt es schon auf dem Konto: Kontoumsatz vom 5\.10\.2026, 320,00 €/.test(t));
  if (AUS) await p.screenshot({ path: `${AUS}/kontostand-1-vorher.png`, fullPage: true });
  // Streusalz als bar kennzeichnen
  await p.locator('tr', { hasText: 'Noch kein passender Kontoumsatz' }).getByRole('button', { name: 'Bar / ohne Bank' }).click(); await p.waitForTimeout(2500);
  t = await txt();
  ok('Nach „bar“: Summen stimmen, Yetim noch zu verbinden', /Stand laut Buchungen\s*10\.544,00 €/.test(t) && /Differenz\s*stimmt/.test(t) && /1 bar \/ ohne Bank · -38,90 €/.test(t) && /1 ohne Kontoumsatz · 320,00 €/.test(t), (t.match(/Stand laut Buchungen[^\n]*\n[^\n]*/) ?? [''])[0]);
  // Verbinden
  await p.locator('tr', { hasText: 'Diese Buchung gibt es schon' }).getByRole('button', { name: 'Verbinden' }).click(); await p.waitForTimeout(2500);
  t = await txt();
  ok('Nach Verbinden: Differenz stimmt, alles verbunden', /Differenz\s*stimmt/.test(t) && /alles verbunden/.test(t) && /verbunden\. Die Zahlung zählt nur einmal/.test(t));
  // Kontoumsätze mit laufendem Stand
  await p.getByRole('button', { name: 'Kontoumsätze', exact: true }).click(); await p.waitForTimeout(2000);
  t = await txt();
  ok('Kontoumsätze: laufender Stand 10.410,00 → 10.730,00 → 10.544,00', /10\.410,00 €[\s\S]*10\.730,00 €[\s\S]*10\.544,00 €/.test(t) && /1010 Hausgeld · Nr\./.test(t));
  if (AUS) await p.screenshot({ path: `${AUS}/kontostand-2-umsaetze.png`, fullPage: true });
  // Neue Buchung über die Datenbank: Leiste rechnet ohne Neuladen nach
  await p.evaluate(async (o) => { const { insert, db } = await import('/src/db/index.ts'); const k = (await db.select("SELECT id FROM buchungskonten WHERE nummer = '1405'"))[0].id;
    await insert('buchungen', { datum: '2026-10-30', betrag: -9.95, buchungskonto_id: k, objekt_id: o, text: 'Kontoführung' }); }, ids.o);
  await p.waitForTimeout(1500);
  t = await txt();
  ok('Leiste aktualisiert sich nach einer Änderung sofort', /Stand laut Buchungen\s*10\.534,05 €/.test(t) && /Differenz\s*9,95 €/.test(t), (t.match(/Differenz[^\n]*\n[^\n]*/) ?? [''])[0]);
  // Buchen-Fenster: „Bezahlt über“ wählbar
  await p.getByRole('button', { name: 'Buchen', exact: true }).click(); await p.waitForTimeout(800);
  ok('Buchen-Fenster: Bezahlt über Bankkonto / Bar', await p.locator('.bf-zahlweg').getByRole('button', { name: 'Bar / ohne Bank', exact: true }).isVisible());
  await p.keyboard.press('Escape'); await p.locator('.modal-bg').click({ position: { x: 5, y: 5 } }).catch(() => {});
  ok('Keine Fehler in der Konsole', !errs.length, errs.slice(0, 3).join(' | '));
  await b.close();
})();
