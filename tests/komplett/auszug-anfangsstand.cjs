// Kontoauszug als Sparkasse-CSV ohne Saldo-Zeile: Anfangsstand aus den Rechnungsabschlüssen („Kontostand am … +“) berechnen,
// beim erneuten Einlesen derselben Datei nachträglich übernehmen und einen fehlenden Umsatz zwischen zwei Abschlüssen melden.
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const KOPF = '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Glaeubiger ID";"Mandatsreferenz";"Kundenreferenz (End-to-End)";"Sammlerreferenz";"Lastschrift Ursprungsbetrag";"Auslagenersatz Ruecklastschrift";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"';
const z = (tag, text, zweck, name, iban, betrag) => `"DE00370502990000000001";"${tag}";"${tag}";"${text}";"${zweck}";"";"";"";"";"";"";"${name}";"${iban}";"COLSDE33XXX";"${betrag}";"EUR";"Umsatz gebucht"`;
const ZEILEN = [
  z('30.06.25', 'ABSCHLUSS', 'Abrechnung 30.06.2025 Kontostand am 30.06.2025 1.120,00 + Abrechnungszeitraum vom 01.04.2025 bis 30.06.2025 Kontostand/Rechnungsabschluss am 30.06.2025 1.120,00 +', '', '0000000001', '0,00'),
  z('14.04.25', 'FOLGELASTSCHRIFT', 'Strom April', 'RheinEnergie AG', 'DE74370501980004002952', '-30,00'),
  z('31.03.25', 'ABSCHLUSS', 'Abrechnung 31.03.2025 Kontostand am 31.03.2025 1.150,00 + Kontostand/Rechnungsabschluss am 31.03.2025 1.150,00 +', '', '0000000001', '0,00'),
  z('20.02.25', 'FOLGELASTSCHRIFT', 'Wasser Februar', 'Stadtwerke', 'DE11370501980000000011', '-50,00'),
  z('03.01.25', 'GUTSCHR. UEBERWEISUNG', 'Hausgeld Januar WE 1', 'Maria Wagner', 'DE22370501980000000022', '200,00'),
];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1500, height: 1000 }, locale: 'de-DE' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  p.on('dialog', (d) => d.accept());
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined && !c ? ' → ' + ist : ''}`);
  const txt = async () => (await p.locator('main').innerText()).replace(/[  ]/g, ' ');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auszug-'));
  const datei = path.join(dir, 'Umsaetze-2025.csv');
  fs.writeFileSync(datei, Buffer.from([KOPF, ...ZEILEN].join('\r\n'), 'latin1'));
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);

  // Ein fehlender Umsatz zwischen zwei Abschlüssen fällt auf (vor dem ersten Abschluss lässt er sich nicht erkennen).
  // Lesen: Anfang 1.150 − (200 − 50) = 1.000, Ende 1.120, Abschlüsse sind keine „übersprungenen“ Zeilen
  const r = await p.evaluate(async (t) => { const bank = await import('/src/logic/bank.ts'); const x = bank.parseDateiDetail('a.csv', t); return { ...x, n: x.umsaetze.length }; }, [KOPF, ...ZEILEN].join('\n'));
  ok('Anfangsstand aus Rechnungsabschluss 1.000,00 €, Endstand 1.120,00 €', r.anfang === 1000 && r.ende === 1120 && r.n === 3, JSON.stringify({ a: r.anfang, e: r.ende, n: r.n }));
  ok('Abschluss-Zeilen (0,00 €) nicht als übersprungen gemeldet', r.uebersprungen.length === 0, r.uebersprungen.join(' | '));
  const f = await p.evaluate(async (t) => (await import('/src/logic/bank.ts')).parseDateiDetail('a.csv', t), [KOPF, ...ZEILEN.filter((x) => !x.includes('Strom April'))].join('\n'));
  ok('Fehlender Umsatz: Hinweis „Achtung … fehlt wahrscheinlich ein Umsatz“', /^Achtung: Laut Rechnungsabschluss war der Kontostand am 30\.06\.2025 1\.120,00 €, laut den eingelesenen Umsätzen 1\.150,00 €/.test(f.hinweis ?? ''), f.hinweis);

  // Wie bei Serkan: Umsätze sind schon da (eingelesen, als der Anfangsstand noch nicht erkannt wurde)
  const ids = await p.evaluate(async (t) => {
    const { insert } = await import('/src/db/index.ts'); const bank = await import('/src/logic/bank.ts');
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'WEG Abschluss', gesamt_mea: 1000 });
    const bk = await insert('bankkonten', { objekt_id: o, name: 'Hausgeldkonto', iban: 'DE00370502990000000001' });
    await bank.importieren(bk, bank.parseDateiDetail('a.csv', t).umsaetze);
    return { o, bk };
  }, [KOPF, ...ZEILEN].join('\n'));
  await p.goto(`http://localhost:5179/#/objekte/${ids.o}/buchungen`); await p.waitForTimeout(3000);
  await p.locator('select.jahr-wahl').first().selectOption('2025').catch(() => {}); await p.waitForTimeout(2000);
  let t = await txt();
  ok('Vorher: Kontostand laut Bank 120,00 € (Anfangsstand fehlt)', /Kontostand laut Bank\s*120,00 €/.test(t), (t.match(/Kontostand laut Bank[^\n]*\n[^\n]*/) ?? [''])[0]);
  // Dieselbe Datei erneut einlesen
  await p.locator('input[type=file]').first().setInputFiles(datei); await p.waitForTimeout(2500);
  const m = (await p.locator('.auszug-modal').innerText()).replace(/[  ]/g, ' ');
  ok('Vorschau: Kontostand passt 1.000,00 € + 120,00 € = 1.120,00 €', /Kontostand passt: 1\.000,00 € \+ Umsätze 120,00 € = 1\.120,00 €/.test(m), m.slice(0, 400));
  await p.locator('.auszug-modal button.primary').click(); await p.waitForTimeout(3000);
  t = await txt();
  ok('Meldung: Startsaldo 1.000,00 € aus dem Auszug übernommen', /Startsaldo 1\.000,00 € aus dem Auszug übernommen/.test(t), (t.match(/Umsätze übernommen[^\n]*/) ?? [''])[0]);
  ok('Nachher: Kontostand laut Bank 1.120,00 €, Stand 01.01. 1.000,00 €', /Kontostand laut Bank\s*1\.120,00 €/.test(t) && /Stand 01\.01\. 1\.000,00 €/.test(t), (t.match(/Kontostand laut Bank[^\n]*\n[^\n]*/) ?? [''])[0]);
  const k = await p.evaluate(async (bk) => { const { db } = await import('/src/db/index.ts'); return (await db.select('SELECT anfangssaldo, saldo_datum, (SELECT COUNT(*) FROM bankumsaetze WHERE bankkonto_id = $1) AS n FROM bankkonten WHERE id = $1', [bk]))[0]; }, ids.bk);
  ok('Anfangssaldo 1.000 zum 02.01.2025, keine doppelten Umsätze', k.anfangssaldo === 1000 && k.saldo_datum === '2025-01-02' && Number(k.n) === 3, JSON.stringify(k));
  // Ein früherer, von Hand eingetragener Anfangssaldo bleibt
  const bleibt = await p.evaluate(async (bk) => { const { db } = await import('/src/db/index.ts'); const bank = await import('/src/logic/bank.ts');
    await db.execute("UPDATE bankkonten SET anfangssaldo = 999, saldo_datum = '2024-12-31' WHERE id = $1", [bk]);
    const r = await bank.startsaldoUebernehmen(bk, 1000, '2025-01-03');
    return { r, k: (await db.select('SELECT anfangssaldo FROM bankkonten WHERE id = $1', [bk]))[0].anfangssaldo }; }, ids.bk);
  ok('Früherer Anfangssaldo bleibt unverändert', bleibt.r === false && bleibt.k === 999, JSON.stringify(bleibt));
  ok('Keine Fehler in der Konsole', errs.length === 0, errs.join(' | '));
  await b.close();
})();
