const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
// Excel-/CSV-Import und Zählerstände
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 950 }, locale: 'de-DE' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`);
  const q = (sql) => p.evaluate(async (s) => { const { db } = await import('/src/db/index.ts'); return db.select(s); }, sql);
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const o = await p.evaluate(async () => { const { insert } = await import('/src/db/index.ts'); return insert('objekte', { verwaltungsart: 'Mietverwaltung', name: 'Importhaus', strasse: 'Weg 9', plz: '50667', ort: 'Köln' }); });
  // 1) Kontakte aus CSV über die Kontakte-Seite
  await p.goto('http://localhost:5179/#/kontakte'); await p.waitForTimeout(1500);
  await p.click('button:has-text("Aus Excel übernehmen")'); await p.waitForTimeout(300);
  const m = p.locator('.import-modal');
  await m.locator('input[type=file]').setInputFiles(__dirname + '/import-kontakte.csv'); await p.waitForTimeout(500);
  const zu = await m.locator('.import-zuordnung label:has(> span:text-is("Nachname")) select').evaluate((s) => s.options[s.selectedIndex].text);
  ok('Spalten automatisch zugeordnet', zu === 'Nachname', zu);
  const pr = await m.locator('tbody tr').allInnerTexts();
  ok('Vorschau prüft IBAN und Name', pr.length === 3 && /in Ordnung/.test(pr[0]) && /IBAN/.test(pr[2]), JSON.stringify(pr.map((x) => x.slice(-60))));
  await m.screenshot({ path: AUS + '/import-kontakte.png' });
  await m.locator('button.primary').click(); await p.waitForTimeout(800);
  const erg = await m.locator('.info').innerText();
  ok('Ergebnis: 1 neu, 1 doppelt, 1 Fehler', /^1 Kontakte übernommen/.test(erg) && /1 schon vorhanden/.test(erg) && /1 Zeilen mit Fehlern/.test(erg), erg.split('\n').slice(0, 3).join(' | '));
  const c = (await q("SELECT * FROM personen WHERE nachname = 'Csv'"))[0];
  ok('Kontakt übernommen: IBAN normalisiert, Ort aus der PLZ ergänzt', c && c.iban === 'DE07370400440000777001' && c.rolle === 'Mieter' && c.ort === 'Köln', JSON.stringify(c && { iban: c.iban, rolle: c.rolle, ort: c.ort }));
  await m.locator('button:has-text("Schließen")').click();
  ok('Liste zeigt den neuen Kontakt', await p.locator('tr:has-text("Csv")').count() >= 1);
  // 2) Einheiten mit Mietern aus Excel über die Einstellungen
  await p.goto('http://localhost:5179/#/einstellungen'); await p.waitForTimeout(1500);
  await p.click('button:has-text("Aus Excel übernehmen")'); await p.waitForTimeout(300);
  await m.locator('label:has(> span:text-is("Was übernehmen?")) select').selectOption('einheiten');
  await m.locator('label:has(> span:text-is("Liegenschaft *")) select').selectOption(String(o));
  await m.locator('input[type=file]').setInputFiles(__dirname + '/import-einheiten.xlsx'); await p.waitForTimeout(600);
  const pr2 = await m.locator('tbody tr').allInnerTexts();
  ok('Excel gelesen: 4 Zeilen, Datum und Beträge erkannt', pr2.length === 4 && /01\.03\.2024/.test(pr2[0]) && /650/.test(pr2[0]) && /IBAN/.test(pr2[3]), JSON.stringify(pr2.map((x) => x.replace(/\s+/g, ' ').slice(0, 120))));
  await m.screenshot({ path: AUS + '/import-einheiten.png' });
  await m.locator('button.primary').click(); await p.waitForTimeout(1000);
  const e = await q(`SELECT e.nummer, e.typ, e.flaeche, v.kaltmiete, v.nk_vorauszahlung, v.beginn, p.nachname FROM einheiten e LEFT JOIN mietvertraege v ON v.einheit_id = e.id LEFT JOIN personen p ON p.id = v.mieter_id WHERE e.objekt_id = ${o} ORDER BY e.nummer`);
  ok('3 Einheiten, 2 mit Mietvertrag', e.length === 3 && e.filter((x) => x.kaltmiete).length === 2 && e[0].flaeche === 62.5 && e[1].kaltmiete === 520 && e[0].beginn === '2024-03-01', JSON.stringify(e));
  await m.locator('button:has-text("Schließen")').click();
  // 3) Zählerstände: Kaltwasser mit Verbrauchsschlüssel
  const r = await p.evaluate(async (o) => { const { db, insert } = await import('/src/db/index.ts');
    const k = (await db.select("SELECT id, name FROM buchungskonten WHERE art = 'Aufwand' ORDER BY nummer LIMIT 1"))[0];
    await db.execute('INSERT INTO objekt_schluessel (objekt_id, buchungskonto_id, schluessel) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [o, k.id, 'Verbrauch']).catch(() => {});
    const es = await db.select('SELECT id FROM einheiten WHERE objekt_id = $1 ORDER BY nummer', [o]);
    await db.execute('INSERT INTO zaehlerstaende (einheit_id, buchungskonto_id, jahr, alt, neu) VALUES ($1, $2, 2024, 100, 130)', [es[0].id, k.id]);
    await insert('rechnungen', { objekt_id: o, datum: '2025-05-01', betrag: 300, buchungskonto_id: k.id, rechnungsnr: 'W-1' });
    return { k, es: es.map((x) => x.id) }; }, o);
  await p.goto(`http://localhost:5179/#/objekte/${o}/nebenkosten`); await p.waitForTimeout(2500);
  const jf = p.locator('main select.jahr-wahl').first(); if (await jf.count()) { await jf.selectOption('2025'); await p.waitForTimeout(2000); }
  const zk = p.locator('button:has-text("Zählerstände")');
  ok('Knopf „Zählerstände“ in der Nebenkostenabrechnung', await zk.count() === 1);
  if (await zk.count()) {
    await zk.click(); await p.waitForTimeout(600);
    const zm = p.locator('.zaehler-modal');
    const alt = await zm.locator('tbody tr').first().locator('input').nth(1).inputValue();
    ok('Alter Stand aus dem Vorjahr übernommen', alt === '130', alt);
    await zm.locator('tbody tr').first().locator('input').nth(2).fill('155'); await zm.locator('tbody tr').first().locator('input').nth(2).press('Enter');
    const fokus = await p.evaluate(() => document.activeElement?.closest('tr')?.rowIndex);
    await zm.locator('tbody tr').nth(1).locator('input').nth(1).fill('10'); await zm.locator('tbody tr').nth(1).locator('input').nth(2).fill('25');
    ok('Enter springt in die nächste Zeile', fokus === 3, fokus);
    await zm.screenshot({ path: AUS + '/zaehlerstaende.png' });
    await zm.locator('button:has-text("Verbrauch übernehmen")').click(); await p.waitForTimeout(1200);
    const v = await q(`SELECT einheit_id, menge FROM verbrauch WHERE jahr = 2025 AND buchungskonto_id = ${r.k.id} ORDER BY einheit_id`);
    ok('Verbrauch berechnet: 25 und 15', v.length === 2 && v[0].menge === 25 && v[1].menge === 15, JSON.stringify(v));
  }
  ok('Keine Konsolenfehler', errs.length === 0, errs.join(' | '));
  await b.close();
})();
