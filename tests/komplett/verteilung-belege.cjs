// Abrechnung nach der Verteilung in Einnahmen & Ausgaben:
// - Tabelle zeigt bei „Alle Einheiten“ den Schlüssel, nach dem die Abrechnung verteilt („Alle · MEA“ bzw. „Alle · Fläche“)
// - In der Abrechnungsübersicht zeigt jeder aufgeklappte Beleg den Anteil je Einheit; die Summe je Einheit = Abrechnung
// - Abgleich mit Einnahmen & Ausgaben: passt / angepasster Betrag / nicht verteilt
const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'de-DE' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`);
  const bild = (n) => process.env.BILDER ? p.screenshot({ path: require('path').join(process.env.BILDER, n), fullPage: true }) : null;
  const txt = (s) => s.replace(/\s+/g, ' ');
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const d = await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts');
    const k = (await db.select(`SELECT id FROM buchungskonten WHERE nummer = '1215'`))[0].id;
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'Belege Testhaus', strasse: 'Weg 1', plz: '50667', ort: 'Köln', gesamt_mea: 1000 });
    const es = [];
    for (const [nr, mea] of [['B1', 400], ['B2', 300], ['B3', 300]]) {
      const e = await insert('einheiten', { objekt_id: o, nummer: nr, flaeche: 60, mea }); es.push(e);
      const pid = await insert('personen', { rolle: 'Eigentümer', vorname: 'Eigner', nachname: nr }); await insert('eigentum', { einheit_id: e, person_id: pid, anteil: 100, von: '2020-01-01' });
    }
    await insert('buchungen', { datum: '2025-03-01', objekt_id: o, buchungskonto_id: k, betrag: -600, text: 'Wasser Q1' });
    await insert('buchungen', { datum: '2025-06-01', objekt_id: o, buchungskonto_id: k, betrag: -400, text: 'Wasser Q2' });
    await insert('buchungen', { datum: '2025-04-01', objekt_id: o, buchungskonto_id: k, einheit_id: es[1], betrag: -300, text: 'Wasserzähler B2' });
    // Logik direkt: Belege einzeln verteilen
    const v = await import('/src/logic/verteilung.ts');
    const pos = { konto_id: k, nummer: '1215', name: 'x', gruppe: '', umlagefaehig: true, hdl: false, hwl: false, betrag: 1300, schluessel: 'MEA' };
    const je = { [es[0]]: 400, [es[1]]: 600, [es[2]]: 300 };
    const a = v.belegAnteile(pos, [{ betrag: 600 }, { betrag: 400 }, { betrag: 300, einheit_id: es[1] }], je);
    // Angepasst auf 650 (Hälfte): alles im gleichen Verhältnis
    const h = v.belegAnteile({ ...pos, betrag: 650, gebucht: 1300 }, [{ betrag: 600 }, { betrag: 400 }, { betrag: 300, einheit_id: es[1] }], { [es[0]]: 200, [es[1]]: 300, [es[2]]: 150 });
    // Manuell (Summe): Einheit an der Buchung zählt nicht, alles nach dem Ergebnis je Einheit
    const s = v.belegAnteile({ ...pos, schluessel: 'Summe' }, [{ betrag: 1000 }, { betrag: 300, einheit_id: es[1] }], { [es[0]]: 650, [es[1]]: 650, [es[2]]: 0 });
    const f = (l) => l.map((x) => es.map((e) => x[e] ?? 0).join('/')).join(' | ');
    return { o, es, k, a: f(a), h: f(h), s: f(s) };
  });
  ok('Belege einzeln: 600 → 240/180/180, 400 → 160/120/120, 300 nur B2', d.a === '240/180/180 | 160/120/120 | 0/300/0', d.a);
  ok('Angepasster Betrag: Belege im gleichen Verhältnis', d.h === '120/90/90 | 80/60/60 | 0/150/0', d.h);
  ok('Manuell: Einheit an der Buchung zählt nicht', d.s === '500/500/0 | 150/150/0', d.s);

  // Einnahmen & Ausgaben: „Alle · MEA“
  await p.goto(`http://localhost:5179/#/objekte/${d.o}/buchungen`); await p.waitForTimeout(3000);
  await p.locator('select.jahr-wahl').first().selectOption('2025').catch(() => {}); await p.waitForTimeout(2000);
  const zeile = txt(await p.locator('tr:has-text("Wasser Q1")').first().innerText().catch(() => ''));
  const wahl = await p.locator('tr:has-text("Wasser Q1") select.ea-einheit option:checked').first().innerText().catch(() => '');
  ok('Tabelle: „Alle · MEA“ bei Buchung für alle Einheiten', wahl.trim() === 'Alle · MEA', wahl || zeile.slice(0, 120));
  const b2 = await p.locator('tr:has-text("Wasserzähler B2") select.ea-einheit option:checked').first().innerText().catch(() => '');
  ok('Tabelle: Buchung für B2 zeigt die Einheit', /B2/.test(b2), b2);
  await bild('verteilung-belege-tabelle.png');

  // WEG-Abrechnung: Konto aufklappen, Anteile je Einheit
  await p.goto('http://localhost:5179/#/weg-abrechnung'); await p.waitForTimeout(1500);
  await p.locator('select').filter({ has: p.locator('option', { hasText: 'Belege Testhaus' }) }).first().selectOption({ label: 'Belege Testhaus' }); await p.waitForTimeout(500);
  await p.locator('label:has-text("Jahr") select').first().selectOption('2025'); await p.waitForTimeout(2000);
  const konto = p.locator('.abr-uebersicht tr:has(td:text-is("1215"))').first();
  await konto.locator('button.aufklapp').click(); await p.waitForTimeout(600);
  const kopf = txt(await p.locator('.abr-uebersicht table.belege thead').first().innerText());
  ok('Belege-Tabelle hat Spalten B1, B2, B3', /B1.*B2.*B3/.test(kopf), kopf);
  const q1 = txt(await p.locator('.abr-uebersicht table.belege tr:has-text("Wasser Q1")').first().innerText());
  ok('Wasser Q1 600 → 240 / 180 / 180', /240,00.*180,00.*180,00/.test(q1), q1);
  const z2 = txt(await p.locator('.abr-uebersicht table.belege tr:has-text("Wasserzähler B2")').first().innerText());
  ok('Wasserzähler nur bei B2', /300,00/.test(z2) && (z2.match(/–/g) ?? []).length >= 2, z2);
  const summe = txt(await p.locator('.abr-uebersicht table.belege tr.abr-anteil-summe').first().innerText());
  ok('Ergibt je Einheit 400 / 600 / 300 wie die Abrechnung', /400,00.*600,00.*300,00/.test(summe), summe);
  const abg = txt(await p.locator('.abr-abgleich').first().innerText());
  ok('Abgleich: alles stimmt', /Jedes Konto stimmt/.test(abg) && await p.locator('.abr-abgleich.ok').count() > 0, abg);
  await bild('verteilung-belege-weg.png');

  // Angepasster Betrag erscheint im Abgleich als Hinweis (nicht als Fehler)
  await p.evaluate(async ([o, k]) => { const { db } = await import('/src/db/index.ts');
    await db.execute('INSERT INTO abrechnung_betraege (objekt_id, jahr, buchungskonto_id, betrag, grund) VALUES ($1, 2025, $2, 650, $3)', [o, k, 'Test halbiert']); }, [d.o, d.k]);
  await p.locator('label:has-text("Jahr") select').first().selectOption('2024'); await p.waitForTimeout(800);
  await p.locator('label:has-text("Jahr") select').first().selectOption('2025'); await p.waitForTimeout(2000);
  const abg2 = txt(await p.locator('.abr-abgleich').first().innerText());
  ok('Abgleich: angepasster Betrag mit Grund', /angepasst auf 650,00.*Test halbiert/.test(abg2) && await p.locator('.abr-abgleich.ok').count() > 0, abg2);
  ok('Keine Fehler in der Konsole', errs.length === 0, errs.slice(0, 2).join(' | '));
  await b.close();
})().catch((e) => { console.log('FEHL ' + e.message.split('\n').slice(0, 2).join(' ')); process.exit(1); });
