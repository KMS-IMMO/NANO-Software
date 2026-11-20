// Kontoabgleich mit Differenz zum Kontoauszug (20.11.2026, nur Demodaten): gelöschter Umsatz aus dem Protokoll, regelmäßiger Zahler mit
// fehlendem Monat, „passt genau zur Differenz“ und fehlenden Umsatz von Hand nachtragen, bis der Abgleich stimmt.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1500, height: 1000 }, locale: 'de-DE' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`);
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts'); const bank = await import('/src/logic/bank.ts'); const KA = await import('/src/logic/kontoabgleich.ts');
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'WEG Differenz', gesamt_mea: 1000 });
    const bk = await insert('bankkonten', { objekt_id: o, name: 'Konto Differenz', anfangssaldo: 1000, saldo_datum: '2025-01-01' });
    const U = []; for (let m = 1; m <= 12; m++) { const mm = String(m).padStart(2, '0');
      U.push({ datum: `2025-${mm}-02`, betrag: 320, verwendungszweck: 'Hausgeld', gegenpartei: 'Familie Lueck', gegen_iban: 'DE77' });
      U.push({ datum: `2025-${mm}-05`, betrag: 400, verwendungszweck: 'Hausgeld', gegenpartei: 'Herr Voll', gegen_iban: 'DE78' }); }
    // Mai von Familie Lueck nie eingelesen, März von Herrn Voll gelöscht
    await bank.importieren(bk, U.filter((x) => !(x.datum === '2025-05-02')));
    const geloescht = (await db.select("SELECT id FROM bankumsaetze WHERE bankkonto_id = $1 AND datum = '2025-03-05'", [bk]))[0].id;
    await bank.umsaetzeLoeschen([geloescht]);
    await KA.auszugSpeichern(bk, 2025, 1000 + 12 * 320 + 12 * 400);
  });
  await p.goto('http://localhost:5179/#/weg-abrechnung'); await p.waitForTimeout(2500);
  await p.locator('select').first().selectOption({ label: 'WEG Differenz' }); await p.locator('select.jahr-wahl').first().selectOption('2025'); await p.waitForTimeout(3500);
  const t1 = (await p.locator('main').innerText()).replace(/ /g, ' ');
  ok('Differenz 720 € erkannt', /Differenz 720,00 €/.test(t1));
  ok('Gelöschter Umsatz wird genannt', /Gelöscht am .*5\.3\.2025 · Herr Voll · 400,00 €/.test(t1));
  ok('Regelmäßiger Zahler mit fehlendem Monat', /Familie Lueck zahlt regelmäßig 320,00 € \(11 Eingänge\), aber kein Eingang im Mai/.test(t1), (t1.match(/Familie Lueck zahlt[^\n]*/) ?? [''])[0]);
  const f = p.locator('.kontoabgleich-differenz');
  await f.locator('input.datum-eingabe').fill('2025-05-02'); await f.getByLabel('Betrag').fill('320,00'); await f.getByLabel('Auftraggeber').fill('Familie Lueck');
  await f.getByRole('button', { name: 'Nachtragen' }).click(); await p.waitForTimeout(2500);
  const t2 = (await p.locator('main').innerText()).replace(/ /g, ' ');
  if (process.env.ZEIG) console.log(t2.split('\n').filter((z) => /Differenz|nachgetragen|Bitte|Fehler|error/i.test(z)).join('\n'));
  ok('Nach dem Nachtragen: Differenz 400 €, Mai-Lücke weg', /Differenz 400,00 €/.test(t2) && !/kein Eingang im Mai/.test(t2) && /nachgetragen/.test(t2));
  ok('Nachgetragener Umsatz ist offen zum Zuordnen', /2\.5\.2025 · Familie Lueck · von Hand nachgetragen/.test(t2), (t2.match(/Umsätze, davon[^\n]*/) ?? [''])[0]);
  ok('Keine Fehler in der Konsole', !errs.length, errs.slice(0, 3).join(' | '));
  await b.close();
})();
