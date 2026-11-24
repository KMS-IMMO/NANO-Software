// Einnahmen & Ausgaben: Kontostand zum 01.01. von Hand je Bankkonto und Jahr (nur Demodaten).
// Fall 1: ganzes Jahr ohne Kontoauszüge gebucht. Fall 2: Kontoumsätze beginnen erst im Lauf des Jahres.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1500, height: 1000 }, locale: 'de-DE' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined && !c ? ' → ' + ist : ''}`);
  const txt = async () => (await p.locator('main').innerText()).replace(/[\u00a0\u202f]/g, ' ');
  const zeile = (t, w) => (t.match(new RegExp(w + '[^\\n]*\\n[^\\n]*\\n?[^\\n]*')) ?? [''])[0].replace(/\n/g, ' | ');
  const AUS = process.env.NEOSS_TEST_AUSGABE;
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const ids = await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts'); const bank = await import('/src/logic/bank.ts');
    const k = async (n) => (await db.select('SELECT id FROM buchungskonten WHERE nummer = $1', [n]))[0].id;
    // Fall 1: Konto ohne Umsätze, alles von Hand gebucht
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'WEG Anfangsstand', gesamt_mea: 1000 });
    const bk = await insert('bankkonten', { objekt_id: o, name: 'Hausgeldkonto' });
    await insert('buchungen', { datum: '2025-02-01', betrag: 1200, buchungskonto_id: await k('1010'), objekt_id: o, text: 'Hausgeld Februar' });
    await insert('buchungen', { datum: '2025-06-15', betrag: -300, buchungskonto_id: await k('1215'), objekt_id: o, text: 'Wasser' });
    // Fall 2: Kontoumsätze erst ab 01.10.2025 (Anfangssaldo 8.000 € zum 30.09.), davor von Hand gebucht
    const o2 = await insert('objekte', { verwaltungsart: 'WEG', name: 'WEG Spaeter Start', gesamt_mea: 1000 });
    const bk2 = await insert('bankkonten', { objekt_id: o2, name: 'Hausgeldkonto', anfangssaldo: 8000, saldo_datum: '2025-09-30' });
    await bank.importieren(bk2, [{ datum: '2025-10-02', betrag: 500, verwendungszweck: 'Hausgeld Oktober', gegenpartei: 'Maria Wagner', gegen_iban: 'DE11' }]);
    const u = (await db.select('SELECT * FROM bankumsaetze WHERE bankkonto_id = $1', [bk2]))[0];
    await bank.zuordnenKonto(u, await k('1010'));
    await insert('buchungen', { datum: '2025-03-01', betrag: 3500, buchungskonto_id: await k('1010'), objekt_id: o2, text: 'Hausgeld Jan–Sep' });
    await insert('buchungen', { datum: '2025-05-01', betrag: -500, buchungskonto_id: await k('1215'), objekt_id: o2, text: 'Wasser' });
    return { o, bk, o2, bk2 };
  });

  // Fall 1
  await p.goto(`http://localhost:5179/#/objekte/${ids.o}/buchungen`); await p.waitForTimeout(3000);
  await p.locator('select.jahr-wahl').first().selectOption('2025').catch(() => {}); await p.waitForTimeout(2000);
  let t = await txt();
  ok('Vorher: Stand 01.01. 0,00 €, Stand laut Buchungen 900,00 €', /Stand laut Buchungen\s*900,00 €/.test(t) && /Stand 01\.01\. 0,00 €/.test(t), zeile(t, 'Stand laut Buchungen'));
  await p.locator('.ks-start-knopf').click(); await p.waitForTimeout(600);
  ok('Fenster „Kontostand zum 01.01.2025“ geht auf', await p.getByText('Kontostand zum 01.01.2025').isVisible());
  await p.getByLabel('Stand 01.01.2025 Hausgeldkonto').fill('5.000,50');
  if (AUS) await p.screenshot({ path: `${AUS}/kontostart-1-fenster.png` });
  await p.getByRole('button', { name: 'Speichern' }).click(); await p.waitForTimeout(1800);
  t = await txt();
  ok('Nachher: Stand 01.01. 5.000,50 € (von Hand), Stand laut Buchungen 5.900,50 €', /Stand laut Buchungen\s*5\.900,50 €/.test(t) && /Stand 01\.01\. 5\.000,50 € \(von Hand\)/.test(t), zeile(t, 'Stand laut Buchungen'));
  ok('Stand laut Bank beginnt ebenfalls mit 5.000,50 €', /Kontostand laut Bank\s*5\.000,50 €/.test(t), zeile(t, 'Kontostand laut Bank'));
  if (AUS) await p.screenshot({ path: `${AUS}/kontostart-2-leiste.png`, clip: { x: 0, y: 0, width: 1500, height: 560 } });
  const db1 = await p.evaluate(async (bk) => { const { db } = await import('/src/db/index.ts'); return db.select('SELECT jahr, betrag FROM kontostart WHERE bankkonto_id = $1', [bk]); }, ids.bk);
  ok('Gespeichert je Konto und Jahr', db1.length === 1 && db1[0].jahr === 2025 && Math.abs(db1[0].betrag - 5000.5) < 0.001, JSON.stringify(db1));
  // Anderes Jahr unberührt
  await p.locator('select.jahr-wahl').first().selectOption('2026').catch(() => {}); await p.waitForTimeout(2000);
  t = await txt();
  ok('2026 ohne Eingabe: Stand 01.01. aus Kontoumsätzen (0,00 €)', /Stand 01\.01\. 0,00 €/.test(t) && !/von Hand/.test(t), zeile(t, 'Stand laut Buchungen'));
  // Vorschlag Endstand Vorjahr übernehmen
  await p.locator('.ks-start-knopf').click(); await p.waitForTimeout(800);
  ok('Vorschlag: Endstand 2025 laut Buchungen 5.900,50 €', /Endstand 2025 laut Buchungen: 5\.900,50 €/.test((await p.locator('.modal').innerText()).replace(/[\u00a0\u202f]/g, ' ')));
  await p.locator('.ks-start-vorschlag button', { hasText: 'übernehmen' }).nth(1).click();
  await p.getByRole('button', { name: 'Speichern' }).click(); await p.waitForTimeout(1800);
  t = await txt();
  ok('2026 übernimmt 5.900,50 €', /Stand 01\.01\. 5\.900,50 € \(von Hand\)/.test(t), zeile(t, 'Stand laut Buchungen'));
  // Entfernen
  await p.locator('.ks-start-knopf').click(); await p.waitForTimeout(600);
  await p.locator('.ks-start-vorschlag button', { hasText: 'leeren' }).click();
  await p.getByRole('button', { name: 'Speichern' }).click(); await p.waitForTimeout(1800);
  t = await txt();
  ok('Leeren entfernt die Eingabe wieder', /Stand 01\.01\. 0,00 €/.test(t) && !/von Hand/.test(t), zeile(t, 'Stand laut Buchungen'));

  // Fall 2
  await p.goto(`http://localhost:5179/#/objekte/${ids.o2}/buchungen`); await p.waitForTimeout(3000);
  await p.locator('select.jahr-wahl').first().selectOption('2025').catch(() => {}); await p.waitForTimeout(2000);
  t = await txt();
  ok('Fall 2 vorher: Bank 8.500,00 €, Buchungen 8.500,00 € (Buchungen vor dem 30.09. zählen nicht)', /Kontostand laut Bank\s*8\.500,00 €/.test(t) && /Stand laut Buchungen\s*8\.500,00 €/.test(t), zeile(t, 'Kontostand laut Bank'));
  await p.locator('.ks-start-knopf').click(); await p.waitForTimeout(600);
  ok('Hinweis: Kontoumsätze beginnen erst am 1.10.2025', /beginnen erst am 1\.10\.2025/.test((await p.locator('.modal').innerText()).replace(/[\u00a0\u202f]/g, ' ')));
  await p.getByLabel('Stand 01.01.2025 Hausgeldkonto').fill('5000');
  await p.getByRole('button', { name: 'Speichern' }).click(); await p.waitForTimeout(1800);
  t = await txt();
  ok('Fall 2 nachher: Bank bleibt 8.500,00 €, Buchungen 5.000 + 3.000 + 500 = 8.500,00 €, Differenz stimmt', /Kontostand laut Bank\s*8\.500,00 €/.test(t) && /Stand laut Buchungen\s*8\.500,00 €/.test(t) && /Differenz\s*stimmt/.test(t), zeile(t, 'Kontostand laut Bank'));
  ok('Chip „2 vor Beginn der Kontoumsätze · 3.000,00 €“', /2 vor Beginn der Kontoumsätze · 3\.000,00 €/.test(t));
  if (AUS) await p.screenshot({ path: `${AUS}/kontostart-3-spaeter-start.png`, clip: { x: 0, y: 0, width: 1500, height: 560 } });
  // Kontoabgleich (Jahresabrechnung) nutzt denselben Stand 01.01., wenn er für die Bank gilt
  const ka = await p.evaluate(async (o) => (await import('/src/logic/kontoabgleich.ts')).kontoabgleich(o, 2025), ids.o);
  ok('Kontoabgleich Fall 1: Stand 01.01.2025 = 5.000,50 €', Math.abs(ka[0].start - 5000.5) < 0.001, JSON.stringify(ka[0]?.start));
  ok('Keine Fehler in der Konsole', errs.length === 0, errs.join(' | '));
  await b.close();
})();
