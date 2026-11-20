// Hausgeldabrechnung: Gesamtkosten eines Kontos nur für die Abrechnung anpassen (Buchhaltung bleibt) und Verteilung nach Verbrauch in €.
const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  p.on('dialog', (d) => d.accept());
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`);
  const q = (sql, a = []) => p.evaluate(async ([s, x]) => { const { db } = await import('/src/db/index.ts'); return db.select(s, x); }, [sql, a]);
  const bild = (n) => process.env.BILDER ? p.screenshot({ path: require('path').join(process.env.BILDER, n) }) : null;
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const d = await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts');
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'Anpassung Testhaus', strasse: 'Ring 7', plz: '50667', ort: 'Köln', gesamt_mea: 1000 });
    const e1 = await insert('einheiten', { objekt_id: o, nummer: 'W1', flaeche: 70, mea: 600 });
    const e2 = await insert('einheiten', { objekt_id: o, nummer: 'W2', flaeche: 50, mea: 400 });
    for (const [e, n] of [[e1, 'Eins'], [e2, 'Zwei']]) { const pid = await insert('personen', { rolle: 'Eigentümer', vorname: 'Eigner', nachname: n }); await insert('eigentum', { einheit_id: e, person_id: pid, anteil: 100, von: '2020-01-01' }); }
    const k = Object.fromEntries((await db.select(`SELECT nummer, id FROM buchungskonten WHERE nummer IN ('1200', '1215')`)).map((r) => [r.nummer, r.id]));
    for (const m of ['03', '06', '09', '12']) await insert('buchungen', { datum: `2025-${m}-01`, objekt_id: o, buchungskonto_id: k['1200'], betrag: -250, text: 'Abschlag Heizung' });
    await insert('buchungen', { datum: '2025-07-01', objekt_id: o, buchungskonto_id: k['1215'], betrag: -400, text: 'Wasser 2025' });
    return { o, e1, e2, heiz: k['1200'], wasser: k['1215'] };
  });
  await p.goto('http://localhost:5179/#/weg-abrechnung'); await p.waitForTimeout(1500);
  await p.locator('select').filter({ has: p.locator('option', { hasText: 'Anpassung Testhaus' }) }).first().selectOption({ label: 'Anpassung Testhaus' }); await p.waitForTimeout(500);
  await p.locator('label:has-text("Jahr") select').first().selectOption('2025'); await p.waitForTimeout(1500);
  const zeile = (nr) => p.locator(`.abr-uebersicht tr:has(td:text-is("${nr}"))`).first();
  ok('Heizkosten gebucht 1.000,00', (await zeile('1200').innerText()).includes('1.000,00'));
  // 1) Gesamtkosten anpassen
  await zeile('1200').locator('button[title="Gesamtkosten für die Abrechnung anpassen"]').click();
  const box = p.locator('.abr-anpassen');
  await box.locator('.betrag-feld input').fill('1200');
  await box.locator('input[placeholder^="z. B. Heizkostenabrechnung"]').fill('Heizkostenabrechnung Messdienst');
  await bild('anpassen-1.png');
  await box.locator('button:has-text("Übernehmen")').click(); await p.waitForTimeout(1500);
  const t = await zeile('1200').innerText();
  ok('Zeile zeigt 1.200,00, „angepasst“ und „gebucht 1.000,00“', t.includes('1.200,00') && t.includes('angepasst') && t.includes('gebucht 1.000,00'), t.replace(/\s+/g, ' '));
  const kosten = await p.evaluate(async ([o, k]) => { const v = await import('/src/logic/verteilung.ts'); return (await v.kostenErmitteln(o, 2025, false)).find((x) => x.konto_id === k); }, [d.o, d.heiz]);
  ok('Abrechnung rechnet mit 1.200,00', kosten?.betrag === 1200 && kosten?.gebucht === 1000, JSON.stringify({ b: kosten?.betrag, g: kosten?.gebucht }));
  const buch = (await q('SELECT SUM(betrag) s FROM buchungen WHERE objekt_id = $1 AND buchungskonto_id = $2', [d.o, d.heiz]))[0].s;
  ok('Buchhaltung bleibt bei −1.000,00', Math.abs(buch + 1000) < 0.001, buch);
  const main = await p.locator('main').innerText();
  ok('Einzelabrechnung W1 trägt 60 % von 1.200 + 400 = 960,00', main.includes('960,00'), (main.match(/W1[^\n]*/g) ?? []).slice(0, 4).join(' / '));
  // Zurücksetzen
  await zeile('1200').locator('button[title="Gesamtkosten für die Abrechnung anpassen"]').click();
  await p.locator('.abr-anpassen button:has-text("Gebuchten Betrag nehmen")').click(); await p.waitForTimeout(1500);
  ok('Zurücksetzen: wieder 1.000,00 ohne „angepasst“', !(await zeile('1200').innerText()).includes('angepasst') && (await q('SELECT COUNT(*) n FROM abrechnung_betraege WHERE objekt_id = $1', [d.o]))[0].n === 0);
  // Kostenposition aus der Abrechnung nehmen und zurückholen
  await zeile('1200').locator('button[title="Kostenposition aus der Abrechnung nehmen"]').click(); await p.waitForTimeout(1500);
  const raus = await p.evaluate(async ([o, k]) => { const v = await import('/src/logic/verteilung.ts'); return (await v.kostenErmitteln(o, 2025, false)).some((x) => x.konto_id === k); }, [d.o, d.heiz]);
  ok('Heizkosten nicht mehr in der Abrechnung', raus === false && await zeile('1200').count() === 0);
  ok('Liste „Aus der Abrechnung genommen“ zeigt 1200', (await p.locator('.abr-raus').innerText()).includes('1200'));
  ok('Buchungen bleiben in der Buchhaltung', (await q('SELECT COUNT(*) n FROM buchungen WHERE objekt_id = $1 AND buchungskonto_id = $2', [d.o, d.heiz]))[0].n === 4);
  await bild('herausnehmen.png');
  await p.locator('.abr-raus button:has-text("Wieder aufnehmen")').click(); await p.waitForTimeout(1500);
  ok('Wieder aufgenommen mit 1.000,00', (await zeile('1200').innerText()).includes('1.000,00') && await p.locator('.abr-raus').count() === 0);
  // 2) Verbrauch in €
  await zeile('1215').locator('select').selectOption('Verbrauch'); await p.waitForTimeout(600);
  const f = p.locator('.schl-fenster');
  ok('Fenster „nach Verbrauch“ offen', await f.count() === 1);
  await f.locator('label:has-text("Maßeinheit") select').selectOption('€');
  const felder = f.locator('tbody input.cell');
  await felder.nth(0).fill('150'); await felder.nth(1).fill('50');
  const ft = await f.innerText();
  ok('Summe der Beträge 200,00, Verteilung im Verhältnis 300,00 / 100,00', ft.includes('200,00') && ft.includes('300,00') && ft.includes('100,00') && ft.includes('im Verhältnis'), ft.replace(/\s+/g, ' ').slice(0, 300));
  await bild('verbrauch-euro.png');
  await f.locator('button:has-text("Übernehmen")').click(); await p.waitForTimeout(1500);
  const me = (await q('SELECT schluessel, masseinheit FROM objekt_schluessel_jahr WHERE objekt_id = $1 AND jahr = 2025 AND buchungskonto_id = $2', [d.o, d.wasser]))[0];
  ok('Schlüssel Verbrauch mit Maßeinheit € gespeichert', me?.schluessel === 'Verbrauch' && me?.masseinheit === '€', JSON.stringify(me));
  const verteilt = await p.evaluate(async ([o]) => {
    const v = await import('/src/logic/verteilung.ts'); const { db } = await import('/src/db/index.ts');
    const { einheiten, nutzer } = await v.nutzerErmitteln(o, 2025, 'Eigentümer');
    const pos = (await v.kostenErmitteln(o, 2025, false)).map((x) => ({ ...x, schluessel: x.nummer === '1215' ? 'Verbrauch' : 'MEA' }));
    const vb = await db.select('SELECT v.* FROM verbrauch v JOIN einheiten e ON e.id = v.einheit_id WHERE e.objekt_id = $1 AND v.jahr = 2025', [o]);
    const r = v.verteilen(2025, einheiten, nutzer, pos, { verbrauch: Object.fromEntries(vb.map((x) => [`${x.einheit_id}-${x.buchungskonto_id}`, Number(x.menge)])), messdienst: {} });
    return r.map((x) => Math.round(x.zeilen.filter((z) => z.pos.nummer === '1215').reduce((a, z) => a + z.betrag, 0) * 100) / 100);
  }, [d.o]);
  ok('Wasser 400,00 verteilt 300,00 / 100,00', verteilt.join('/') === '300/100', verteilt.join('/'));
  // Auch in Nebenkosten- und Eigentümerabrechnung (Mietverwaltung): Stift und Papierkorb an den Kosten
  const mv = await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts');
    const o = await insert('objekte', { verwaltungsart: 'Mietverwaltung', name: 'Anpassung Miethaus', strasse: 'Weg 9', plz: '50667', ort: 'Köln' });
    await insert('einheiten', { objekt_id: o, nummer: 'M1', flaeche: 80 });
    const k = (await db.select(`SELECT id FROM buchungskonten WHERE nummer = '1215'`))[0].id;
    await insert('buchungen', { datum: '2025-08-01', objekt_id: o, buchungskonto_id: k, betrag: -300, text: 'Wasser Miethaus' });
    return o;
  });
  for (const [pfad, name] of [['nebenkosten', 'Nebenkostenabrechnung'], ['eigentuemer-abrechnung', 'Eigentümerabrechnung']]) {
    await p.goto('http://localhost:5179/#/' + pfad); await p.waitForTimeout(1500);
    { const s = p.locator('select').filter({ has: p.locator('option', { hasText: 'Anpassung Miethaus' }) }).first(); const v = await s.locator('option', { hasText: 'Anpassung Miethaus' }).first().getAttribute('value'); await s.selectOption(v); } await p.waitForTimeout(500);
    await p.locator('label:has-text("Jahr") select').first().selectOption('2025'); await p.waitForTimeout(1500);
    const z = p.locator('.abr-uebersicht tr:has(td:text-is("1215"))').first();
    ok(`${name}: Stift und Papierkorb an den Kosten`, await z.locator('button[title="Gesamtkosten für die Abrechnung anpassen"]').count() === 1 && await z.locator('button[title="Kostenposition aus der Abrechnung nehmen"]').count() === 1);
  }
  ok('Keine Fehler in der Konsole', errs.length === 0, errs.slice(0, 2).join(' | '));
  await b.close();
})().catch((e) => { console.log('FEHL ' + e.message.split('\n').slice(0, 2).join(' ')); process.exit(1); });
