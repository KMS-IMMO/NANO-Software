// Oberfläche nach Serkans Rückmeldung (20.11.2026, nur Demodaten): Suche und Aktualisieren in Einnahmen & Ausgaben,
// Zahlung auf mehrere Personen bzw. die Gemeinschaft (Funkanlage), Datum je Einheit beim Hausgeld, Einheiten bei Beträgen,
// Datumsfeld mit Kalender, Jahresauswahl, Prozentprognose im Wirtschaftsplan, Eigentümer-Fenster mit Abschnitten, Schrift Arial.
const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1500, height: 1000 }, locale: 'de-DE' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`);
  const bild = (n) => p.screenshot({ path: `${AUS}/oberflaeche-${n}.png` });
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const ids = await p.evaluate(async () => {
    const { insert } = await import('/src/db/index.ts'); const soll = await import('/src/logic/soll.ts'); const bank = await import('/src/logic/bank.ts');
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'WEG Oberflächentest', strasse: 'O 1', plz: '50667', ort: 'Köln', gesamt_mea: 1000, ruecklage_anfang: 0, ruecklage_stichtag: '2024-12-31' });
    const e = []; for (const [n, m, f, l] of [['3. OG', 300, 70.5, 3], ['1. OG', 300, 83.64, 1], ['2. OG', 400, 93.29, 2]]) e.push(await insert('einheiten', { objekt_id: o, nummer: n, mea: m, flaeche: f, lfd_nr: l }));
    const pe = []; for (const [vn, nn] of [['Ralf', 'Zander'], ['Anna', 'Albers'], ['Bea', 'Mittel']]) pe.push(await insert('personen', { rolle: 'Eigentümer', vorname: vn, nachname: nn }));
    for (let i = 0; i < 3; i++) await insert('eigentum', { einheit_id: e[i], person_id: pe[i], anteil: 100, von: '2010-01-01' });
    for (let i = 0; i < 3; i++) await insert('hausgeld', { einheit_id: e[i], gueltig_ab: '2025-01-01', betrag: 320, davon_ruecklage: 0 });
    const bk = await insert('bankkonten', { objekt_id: o, name: 'Konto Oberflächentest', iban: 'DE0100000000000000000077', anfangssaldo: 0, saldo_datum: '2024-12-31' });
    await soll.sollStellen('2025-03', { objektId: o });
    await bank.importieren(bk, [
      { datum: '2025-01-03', betrag: 8959.63, verwendungszweck: '3199 D MGG 001-T Miete Funkanlage', gegenpartei: 'Vantage Towers AG', gegen_iban: 'DE0100000000000000000088' },
      { datum: '2025-01-05', betrag: 640, verwendungszweck: 'Hausgeld Januar beide', gegenpartei: 'Eheleute Zander Albers', gegen_iban: 'DE0100000000000000000066' },
      { datum: '2025-02-02', betrag: 320, verwendungszweck: 'Hausgeld Februar', gegenpartei: 'Ralf Zander', gegen_iban: 'DE0100000000000000000055' },
    ]);
    return { o, e, pe, bk };
  });

  // 1) Zahlung der Gemeinschaft zuführen (Funkanlage) über „Mehrere …“ im Kontoauszug
  await p.goto(`http://localhost:5179/#/objekte/${ids.o}/buchungen`); await p.waitForTimeout(2500);
  await p.locator('select.jahr-wahl').first().selectOption('2025'); await p.waitForTimeout(1200);
  const zeile = p.locator('tr', { hasText: 'Vantage Towers' }).first();
  ok('Knopf „Mehrere …“ beim Zahlungseingang', await zeile.locator('button:has-text("Mehrere")').count() === 1);
  await zeile.locator('button:has-text("Mehrere")').click(); await p.waitForTimeout(600);
  ok('Fenster „Zahlung zuordnen“ offen', await p.locator('.mehrfach-fenster').count() === 1);
  await p.locator('.mehrfach-fenster button:has-text("Gemeinschaft")').first().click(); await p.waitForTimeout(300);
  await bild('1-gemeinschaft');
  await p.locator('.mehrfach-fenster button:has-text("Der Gemeinschaft zuführen")').click(); await p.waitForTimeout(1500);
  const gem = await p.evaluate(async (o) => {
    const { db } = await import('/src/db/index.ts'); const v = await import('/src/logic/verteilung.ts');
    const b = await db.select(`SELECT b.betrag, b.einheit_id, k.nummer, k.art, k.schluessel FROM buchungen b JOIN buchungskonten k ON k.id = b.buchungskonto_id JOIN bankumsaetze u ON u.id = b.bankumsatz_id WHERE u.gegenpartei = 'Vantage Towers AG'`);
    const kosten = await v.kostenErmitteln(o, 2025, false);
    return { b, k1030: kosten.find((x) => x.nummer === '1030') };
  }, ids.o);
  ok('Funkanlage ohne Einheit auf Konto 1030 (Ertrag, MEA) gebucht', gem.b.length === 1 && gem.b[0].nummer === '1030' && gem.b[0].einheit_id == null && gem.b[0].art === 'Ertrag' && gem.b[0].schluessel === 'MEA', JSON.stringify(gem.b));
  ok('Ertrag mindert die Kosten der Hausgeldabrechnung (nach Schlüssel verteilt)', gem.k1030 && Math.abs(gem.k1030.betrag + 8959.63) < 0.005, JSON.stringify(gem.k1030));

  // 2) Eine Überweisung auf zwei Eigentümer aufteilen
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(800); await p.goto(`http://localhost:5179/#/objekte/${ids.o}/buchungen`); await p.waitForTimeout(2500); await p.locator('select.jahr-wahl').first().selectOption('2025'); await p.waitForTimeout(1200);
  await p.locator('tr', { hasText: 'Eheleute Zander Albers' }).first().locator('button:has-text("Mehrere")').click(); await p.waitForTimeout(600);
  await p.locator('.mehrfach-fenster .mz-zeile', { hasText: 'Zander' }).first().locator('input[type=checkbox]').check();
  await p.locator('.mehrfach-fenster .mz-zeile', { hasText: 'Albers' }).first().locator('input[type=checkbox]').check(); await p.waitForTimeout(300);
  ok('Gleichmäßig vorbelegt: 320,00 € je Person', (await p.locator('.mehrfach-fenster .mz-summe').innerText()).includes('640,00'));
  await bild('2-mehrere');
  await p.locator('.mehrfach-fenster button:has-text("aufteilen")').click(); await p.waitForTimeout(1500);
  const teil = await p.evaluate(async (pe) => {
    const { db } = await import('/src/db/index.ts');
    return db.select(`SELECT s.person_id, SUM(b.betrag) AS s FROM buchungen b JOIN sollstellungen s ON s.id = b.sollstellung_id JOIN bankumsaetze u ON u.id = b.bankumsatz_id
      WHERE u.gegenpartei = 'Eheleute Zander Albers' GROUP BY s.person_id ORDER BY s.person_id`);
  }, ids.pe);
  ok('640 € als je 320 € auf die Hausgeld-Posten beider Eigentümer', teil.length === 2 && teil.every((x) => Math.abs(x.s - 320) < 0.005) && teil.some((x) => x.person_id === ids.pe[0]) && teil.some((x) => x.person_id === ids.pe[1]), JSON.stringify(teil));

  // 3) Einnahmen & Ausgaben: Suche und Aktualisieren
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(800); await p.goto(`http://localhost:5179/#/objekte/${ids.o}/buchungen`); await p.waitForTimeout(2500); await p.locator('select.jahr-wahl').first().selectOption('2025'); await p.waitForTimeout(1200);
  const suche = p.locator('.ea-suche input'); ok('Suchleiste vorhanden', await suche.count() === 1);
  const anzahl = async () => p.locator('section.card:has(h2:has-text("Buchungen")) table.list tbody tr').count();
  const alle = await anzahl();
  await suche.fill('8.959,63'); await p.waitForTimeout(400); ok('Suche nach Betrag 8.959,63 findet die Funkanlage', await anzahl() === 1, await anzahl());
  await suche.fill('8959.63'); await p.waitForTimeout(300); ok('… auch als 8959.63', await anzahl() === 1);
  await suche.fill('Albers'); await p.waitForTimeout(300); ok('Suche nach Eigentümer (Albers: ihr Teil und der Text der geteilten Überweisung)', await anzahl() === 2, await anzahl());
  await suche.fill('05.01.2025'); await p.waitForTimeout(300); ok('Suche nach Datum 05.01.2025', await anzahl() === 2, await anzahl());
  await suche.fill('320'); await p.waitForTimeout(300); ok('Suche nach Betrag 320', await anzahl() >= 2, await anzahl());
  await bild('3-suche');
  await suche.fill(''); await p.waitForTimeout(300); ok('Suche leeren zeigt wieder alle', await anzahl() === alle, `${await anzahl()} / ${alle}`);
  await p.evaluate(async (bk) => { const bank = await import('/src/logic/bank.ts'); await bank.importieren(bk, [{ datum: '2025-03-04', betrag: 320, verwendungszweck: 'Hausgeld März', gegenpartei: 'Bea Mittel', gegen_iban: 'DE0100000000000000000044' }]); }, ids.bk);
  await p.locator('button:has-text("Aktualisieren")').click(); await p.waitForTimeout(1500);
  ok('Aktualisieren lädt neuen Kontoauszug-Eintrag', (await p.locator('body').innerText()).includes('Bea Mittel'));
  ok('Zeitpunkt der Aktualisierung angezeigt', await p.locator('text=/aktualisiert \\d{2}:\\d{2}/').count() === 1);

  // 4) Hausgeld: Datum je Einheit und Einheiten in Reihenfolge der laufenden Nummer
  await p.goto(`http://localhost:5179/#/objekte/${ids.o}/hausgeld`); await p.waitForTimeout(2500);
  const hg = p.locator('section.card:has(h2:has-text("Hausgeld und Erhaltungsrücklage")) table.list');
  const einh = await hg.locator('tbody tr td:nth-child(2)').allInnerTexts();
  ok('Einheiten in Reihenfolge der laufenden Nummer', einh.join('|') === '1. OG|2. OG|3. OG', einh.join('|'));
  ok('Spalte „Gültig ab“ je Einheit', await hg.locator('th:has-text("Gültig ab")').count() === 1 && await hg.locator('tbody input.datum-eingabe').count() === 3);
  const erste = hg.locator('tbody tr').first();
  await erste.locator('input.datum-eingabe').fill('01.03.2026');
  await erste.locator('.betrag-feld input').first().fill('350'); await p.waitForTimeout(200);
  await p.locator('button:has-text("Änderungen speichern")').click(); await p.waitForTimeout(1500);
  const hgNeu = await p.evaluate(async (e) => { const { db } = await import('/src/db/index.ts'); return db.select('SELECT einheit_id, gueltig_ab, betrag FROM hausgeld WHERE einheit_id IN ($1, $2, $3) AND betrag = 350', e); }, ids.e);
  ok('Neuer Satz mit eigenem Datum der Einheit gespeichert', hgNeu.length === 1 && hgNeu[0].gueltig_ab === '2026-03-01' && hgNeu[0].einheit_id === ids.e[1], JSON.stringify(hgNeu));
  await bild('4-hausgeld-datum');

  // 5) Datumsfeld mit Kalender (Monat und Jahr als Auswahlliste)
  const df = hg.locator('tbody tr').nth(1).locator('input.datum-eingabe');
  await df.click(); await p.waitForTimeout(300);
  ok('Kalender öffnet sich nach dem Anklicken', await p.locator('.datum-pop').count() === 1);
  ok('Kalender mit Monats- und Jahresliste', await p.locator('.datum-pop select[aria-label="Monat"]').count() === 1 && await p.locator('.datum-pop select[aria-label="Jahr"]').count() === 1);
  await p.locator('.datum-pop select[aria-label="Jahr"]').selectOption('2027'); await p.locator('.datum-pop select[aria-label="Monat"]').selectOption('2');
  await bild('5-kalender');
  await p.locator('.datum-pop .datum-tag:not(.anders)', { hasText: /^15$/ }).click(); await p.waitForTimeout(200);
  ok('Tag gewählt: 15.02.2027', await df.inputValue() === '15.02.2027', await df.inputValue());
  ok('Kalender danach zu', await p.locator('.datum-pop').count() === 0);

  // 6) Nebenkosten: Fläche in m², Jahr als Auswahl
  await p.goto(`http://localhost:5179/#/objekte/${ids.o}/nebenkosten`); await p.waitForTimeout(2500);
  ok('Jahr als Auswahlliste (keine Zahleneingabe)', await p.locator('main select.jahr-wahl').count() >= 1 && await p.locator('main label:has-text("Jahr") input[type=number]').count() === 0);
  await p.locator('main select.jahr-wahl').first().selectOption('2025'); await p.waitForTimeout(1500);
  ok('Fläche mit m²', (await p.locator('section.card:has(h2:has-text("Eingaben je Einheit")) tbody').innerText()).includes('83,64 m²'));

  // 7) Wirtschaftsplan: Prozentprognose (50 € + 10 % = 55 €)
  await p.goto(`http://localhost:5179/#/objekte/${ids.o}/wirtschaftsplan`); await p.waitForTimeout(2500);
  await p.locator('.wp-plan select.jahr-wahl').first().selectOption('2026'); await p.waitForTimeout(1500);
  const wz = p.locator('.wp-plan table.list tbody tr:not(.group)').nth(1);
  await wz.locator('td').last().locator('input').fill('50'); await p.waitForTimeout(200);
  await wz.locator('input.wp-prozent').fill('10'); await p.waitForTimeout(300);
  ok('Zeile: 50,00 € + 10 % = 55,00 €', await wz.locator('td').last().locator('input').inputValue() === '55,00', await wz.locator('td').last().locator('input').inputValue());
  await wz.locator('input.wp-prozent').fill('20'); await p.waitForTimeout(300);
  ok('Prozent ändern rechnet von der Basis (60,00 €, nicht 66,00 €)', await wz.locator('td').last().locator('input').inputValue() === '60,00', await wz.locator('td').last().locator('input').inputValue());
  const wz2 = p.locator('.wp-plan table.list tbody tr:not(.group)').nth(2);
  await wz2.locator('td').last().locator('input').fill('100'); await p.waitForTimeout(200);
  await p.locator('.wp-prognose input').fill('5'); await p.locator('.wp-prognose button:has-text("Auf alle Kosten anwenden")').click(); await p.waitForTimeout(400);
  ok('Prozent auf alle: 100,00 € → 105,00 €', await wz2.locator('td').last().locator('input').inputValue() === '105,00', await wz2.locator('td').last().locator('input').inputValue());
  await bild('7-wirtschaftsplan');

  // 8) Eigentümer-Fenster: Kopf mit Kürzel, Abschnitte, Geburtsdatum ohne grauen Platzhalter mit heutigem Datum
  await p.goto('http://localhost:5179/#/eigentuemer'); await p.waitForTimeout(2000);
  await p.locator('input.search').fill('Albers'); await p.waitForTimeout(400);
  await p.locator('table.list tbody tr', { hasText: 'Albers' }).first().click(); await p.waitForTimeout(700);
  ok('Fenster mit Kopf (Kürzel AA, Name)', (await p.locator('.person-kuerzel').innerText()).trim() === 'AA' && (await p.locator('.person-kopf h3').innerText()).includes('Anna Albers'));
  const absch = await p.locator('.et-abschnitt h4').allInnerTexts();
  ok('Abschnitte Person, Anschrift, Kontakt, Bankverbindung, Notiz', ['PERSON', 'ANSCHRIFT', 'KONTAKT', 'BANKVERBINDUNG', 'NOTIZ'].every((x) => absch.map((a) => a.toUpperCase()).includes(x)), absch.join(', '));
  ok('Geburtsdatum leer mit Platzhalter TT.MM.JJJJ', await p.locator('.et-abschnitt label:has-text("Geburtsdatum") input').getAttribute('placeholder') === 'TT.MM.JJJJ'
    && await p.locator('.et-abschnitt label:has-text("Geburtsdatum") input').inputValue() === '');
  await p.locator('.et-abschnitt label:has-text("Geburtsdatum") input').fill('24.12.1980'); await p.locator('button:has-text("Speichern")').last().click(); await p.waitForTimeout(800);
  const gb = await p.evaluate(async (id) => { const { db } = await import('/src/db/index.ts'); return (await db.select('SELECT geburtsdatum FROM personen WHERE id = $1', [id]))[0]?.geburtsdatum; }, ids.pe[1]);
  ok('Geburtsdatum getippt (24.12.1980) und gespeichert', gb === '1980-12-24', gb);
  await p.locator('table.list tbody tr', { hasText: 'Albers' }).first().click(); await p.waitForTimeout(700);
  await p.locator('.modal').screenshot({ path: `${AUS}/oberflaeche-8-eigentuemer.png` });
  await p.keyboard.press('Escape');

  // 9) Schrift Arial
  const schrift = await p.evaluate(() => getComputedStyle(document.body).fontFamily);
  ok('Schrift im Programm: Arial', /^Arial/.test(schrift), schrift);
  ok('Keine Fehler in der Konsole', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();
})().catch((e) => { console.log('FAIL Abbruch', e.message); process.exit(1); });
