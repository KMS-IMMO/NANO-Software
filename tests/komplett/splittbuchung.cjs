// Splittbuchung: ein Bankumsatz (Abschlag Strom und Wasser) wird auf zwei Konten verteilt, gemerkt, beim nächsten Umsatz vorgeschlagen
// und im Journal als Aufteilung angezeigt und zusammen gelöscht. Nur Demodaten.
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
    const { db, insert } = await import('/src/db/index.ts'); const bank = await import('/src/logic/bank.ts');
    const o = await insert('objekte', { verwaltungsart: 'Mietverwaltung', name: 'Splitt Testhaus', strasse: 'Am Bach 3', plz: '50667', ort: 'Köln' });
    for (const n of ['EG', 'OG']) await insert('einheiten', { objekt_id: o, nummer: n, flaeche: 60 });
    const bk = await insert('bankkonten', { objekt_id: o, name: 'Splitt Konto', iban: 'DE07370400440000777002' });
    await bank.importieren(bk, [
      { datum: '2026-03-02', betrag: -480, gegenpartei: 'Stadtwerke Beispiel', verwendungszweck: 'Abschlag 03/2026 Strom und Wasser', gegen_iban: 'DE12500105170648489890' },
      { datum: '2026-04-01', betrag: -500, gegenpartei: 'Stadtwerke Beispiel', verwendungszweck: 'Abschlag 04/2026 Strom und Wasser', gegen_iban: 'DE12500105170648489890' }]);
    const u = await db.select('SELECT id, datum FROM bankumsaetze WHERE bankkonto_id = $1 ORDER BY datum', [bk]);
    const k = Object.fromEntries((await db.select(`SELECT nummer, id FROM buchungskonten WHERE nummer IN ('1214', '1215')`)).map((r) => [r.nummer, r.id]));
    return { o, bk, u1: u[0].id, u2: u[1].id, strom: k['1214'], wasser: k['1215'] };
  });
  // 1) Erster Umsatz: aufteilen 300 Wasser, 180 Strom
  await p.goto('http://localhost:5179/#/bank'); await p.waitForTimeout(1500);
  const zeile = (t) => p.locator(`tr:has-text("${t}")`).first();
  const kontoWahl = async () => { await p.locator('select').filter({ has: p.locator('option', { hasText: 'Splitt Konto' }) }).first().selectOption(String(d.bk)); await p.waitForTimeout(900); };
  await kontoWahl();
  await zeile('Abschlag 03/2026').locator('button:has-text("Buchen")').click();
  const f = p.locator('.buchen-fenster'); await f.waitFor(); await p.waitForTimeout(700);
  ok('Knopf „Auf mehrere Konten aufteilen“ da', await f.locator('.bf-aufteilen').count() === 1);
  await f.locator('.bf-suche input').fill('1215'); await p.waitForTimeout(400);
  await f.locator('.bf-aufteilen').click(); await p.waitForTimeout(300);
  ok('Zwei Teile, erster mit Konto 1215', await f.locator('.bf-teil').count() === 2 && (await f.locator('.bf-teil').nth(0).innerText()).includes('1215'));
  await f.locator('.bf-teil').nth(0).locator('.betrag-feld input').first().fill('300');
  await f.locator('.bf-teil').nth(0).locator('.bf-teil-text').fill('Wasser');
  ok('Zweiter Teil bekommt automatisch den Rest 180,00', await f.locator('.bf-teil').nth(1).locator('.betrag-feld input').first().inputValue() === '180,00');
  await f.locator('.bf-teil').nth(1).click();
  await f.locator('.bf-suche input').fill('1214'); await p.waitForTimeout(400);
  await f.locator('.bf-teil').nth(1).locator('.bf-teil-text').fill('Allgemeinstrom');
  ok('Rest-Anzeige: vollständig verteilt', (await f.locator('.bf-rest').innerText()).includes('vollständig'));
  ok('Merken ist angeboten', await f.locator('label:has-text("merken")').count() === 1);
  await f.locator('label:has-text("merken") input').check();
  await f.evaluate((el) => { el.scrollTop = 0; }); await p.waitForTimeout(200); await bild('splitt-1-fenster.png');
  // Bei zwei Teilen gleicht der andere Teil automatisch aus
  await f.locator('.bf-teil').nth(1).locator('.betrag-feld input').first().fill('200');
  ok('Teil 1 gleicht auf 280,00 aus', await f.locator('.bf-teil').nth(0).locator('.betrag-feld input').first().inputValue() === '280,00');
  await f.locator('.bf-teil').nth(0).locator('.betrag-feld input').first().fill('300');
  await f.locator('.bf-buchen').click(); await p.waitForTimeout(1200);
  if (await f.count()) console.log('INFO Fehler im Fenster: ' + (await f.locator('.error').allInnerTexts()).join(' '));
  const b1 = await q('SELECT buchungskonto_id AS k, betrag, text, aufteilung, bankumsatz_id FROM buchungen WHERE bankumsatz_id = $1 ORDER BY id', [d.u1]);
  ok('Zwei Buchungen am Umsatz', b1.length === 2, b1.length);
  ok('Wasser −300 auf 1215, Strom −180 auf 1214', b1[0]?.k === d.wasser && b1[0]?.betrag === -300 && b1[1]?.k === d.strom && b1[1]?.betrag === -180, JSON.stringify(b1.map((x) => [x.k, x.betrag])));
  ok('Beide Teile tragen dieselbe Aufteilung', b1[0]?.aufteilung && b1[0].aufteilung === b1[1].aufteilung);
  ok('Teiltext im Buchungstext', String(b1[0]?.text).includes('Wasser') && String(b1[1]?.text).includes('Allgemeinstrom'));
  ok('Umsatz ist zugeordnet', (await q('SELECT status FROM bankumsaetze WHERE id = $1', [d.u1]))[0]?.status === 'zugeordnet');
  ok('Aufteilung gemerkt', (await q(`SELECT COUNT(*) n FROM aufteilung_vorlagen WHERE schluessel = 'de12500105170648489890'`))[0].n === 1);
  // 2) Zweiter Umsatz: Vorschlag 500 im Verhältnis 300:180
  await p.goto('http://localhost:5179/#/bank'); await p.waitForTimeout(1500); await kontoWahl();
  await zeile('Abschlag 04/2026').locator('button:has-text("Buchen")').click();
  await f.waitFor(); await p.waitForTimeout(900);
  ok('Aufteilung wird vorgeschlagen', await f.locator('.bf-vorschlag').count() === 1 && await f.locator('.bf-teil').count() === 2);
  const v = [await f.locator('.bf-teil').nth(0).locator('.betrag-feld input').first().inputValue(), await f.locator('.bf-teil').nth(1).locator('.betrag-feld input').first().inputValue()];
  ok('Vorschlag 312,50 und 187,50 (Summe auf den Cent)', v[0] === '312,50' && v[1] === '187,50', v.join(' / '));
  await bild('splitt-2-vorschlag.png');
  await f.locator('.bf-buchen').click(); await p.waitForTimeout(1200);
  const s2 = await q('SELECT SUM(betrag) s, COUNT(*) n FROM buchungen WHERE bankumsatz_id = $1', [d.u2]);
  ok('Zweiter Umsatz mit −500 in 2 Teilen gebucht', s2[0].n === 2 && Math.abs(s2[0].s + 500) < 0.001, JSON.stringify(s2[0]));
  // 3) Einheiten: Aufteilung mit zwei Einheiten verteilt jeden Teil im Verhältnis
  await p.goto('http://localhost:5179/#/journal'); await p.waitForTimeout(1200);
  const wahl = p.locator('select').filter({ has: p.locator('option', { hasText: 'Splitt Testhaus' }) }).first();
  await wahl.selectOption({ label: 'Splitt Testhaus' }); await p.waitForTimeout(400);
  await p.locator('label:has-text("Jahr") input').first().fill('2026'); await p.waitForTimeout(1000);
  ok('Journal zeigt „Teil 1/2“', await p.locator('.teil-tag:has-text("Teil 1/2")').count() >= 2);
  await bild('splitt-3-journal.png');
  await p.locator('button:has-text("Buchen")').first().click(); await f.waitFor(); await p.waitForTimeout(700);
  await f.locator('.bf-kopf .betrag-feld input').fill('100');
  await f.locator('.bf-suche input').fill('1215'); await p.waitForTimeout(300);
  await f.locator('.bf-aufteilen').click();
  await f.locator('.bf-teil').nth(0).locator('.betrag-feld input').first().fill('70');
  await f.locator('.bf-teil').nth(1).click(); await f.locator('.bf-suche input').fill('1214'); await p.waitForTimeout(300);
  ok('Ohne Bankumsatz kein „merken“', await f.locator('label:has-text("merken")').count() === 0);
  for (const n of ['EG', 'OG']) await f.locator(`.bf-zeile:has(b:text-is("${n}"))`).click();
  await f.locator('.bf-kopf input').last().fill('Nachzahlung Versorger');
  await f.locator('.bf-buchen').click(); await p.waitForTimeout(1200);
  const e3 = await q(`SELECT b.betrag, b.einheit_id, k.nummer FROM buchungen b JOIN buchungskonten k ON k.id = b.buchungskonto_id WHERE b.objekt_id = $1 AND b.text LIKE 'Nachzahlung%' ORDER BY k.nummer DESC, b.einheit_id`, [d.o]);
  ok('4 Buchungen: je Konto und Einheit die Hälfte', e3.length === 4 && e3.map((x) => x.betrag).join(',') === '-35,-35,-15,-15', JSON.stringify(e3.map((x) => [x.nummer, x.betrag])));
  // 4) Löschen eines Teils löscht die ganze Aufteilung, Umsatz wird wieder offen
  await p.goto('http://localhost:5179/#/journal'); await p.waitForTimeout(1200);
  await wahl.selectOption({ label: 'Splitt Testhaus' }); await p.waitForTimeout(400);
  await p.locator('label:has-text("Jahr") input').first().fill('2026'); await p.waitForTimeout(1000);
  await p.locator('tr:has-text("Abschlag 03/2026") button[title="Buchung löschen"]').first().click(); await p.waitForTimeout(1200);
  ok('Beide Teile gelöscht', (await q('SELECT COUNT(*) n FROM buchungen WHERE bankumsatz_id = $1', [d.u1]))[0].n === 0);
  ok('Umsatz wieder offen', (await q('SELECT status FROM bankumsaetze WHERE id = $1', [d.u1]))[0]?.status === 'offen');
  const pk = (await q(`SELECT id, bezeichnung FROM papierkorb ORDER BY id DESC LIMIT 1`))[0];
  ok('Ein Eintrag im Papierkorb', String(pk?.bezeichnung).includes('Aufteilung in 2 Teile'), pk?.bezeichnung);
  await p.evaluate(async (id) => { const m = await import('/src/db/papierkorb.ts'); await m.wiederherstellen(id); }, pk.id);
  ok('Wiederherstellen bringt beide Teile und die Zuordnung zurück', (await q('SELECT COUNT(*) n FROM buchungen WHERE bankumsatz_id = $1', [d.u1]))[0].n === 2
    && (await q('SELECT status FROM bankumsaetze WHERE id = $1', [d.u1]))[0]?.status === 'zugeordnet');
  ok('Keine Fehler in der Konsole', errs.length === 0, errs.slice(0, 2).join(' | '));
  await b.close();
})().catch(async (e) => { console.log('FEHL ' + e.message.split('\n').slice(0, 3).join(' ')); process.exit(1); });
