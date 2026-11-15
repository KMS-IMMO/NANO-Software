// Jahressperre: Nach dem Abschluss sind Buchungen des Buchungsjahres gesperrt, auch wenn das Datum im Folgejahr liegt
// (z. B. Grundsteuer Q4 2025, gebucht am 05.01.2026 für das Buchungsjahr 2025).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 950 }, locale: 'de-DE' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  p.on('dialog', (d) => d.accept());
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`);
  const q = (sql, a = []) => p.evaluate(async ([s, x]) => { const { db } = await import('/src/db/index.ts'); return db.select(s, x); }, [sql, a]);
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const ids = await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts');
    const o = await insert('objekte', { verwaltungsart: 'Mietverwaltung', name: 'Sperre Testhaus', strasse: 'Weg 2', plz: '50667', ort: 'Köln' });
    const k = (await db.select(`SELECT id FROM buchungskonten WHERE nummer = '1220'`))[0].id;
    const alt = await insert('buchungen', { datum: '2026-01-05', objekt_id: o, buchungskonto_id: k, betrag: -100, text: 'Grundsteuer Q4 2025 Sperrtest', jahr: 2025 });
    const neu = await insert('buchungen', { datum: '2026-01-06', objekt_id: o, buchungskonto_id: k, betrag: -50, text: 'Grundsteuer Q1 2026 Sperrtest', jahr: 2026 });
    await insert('abrechnungen', { objekt_id: o, art: 'Nebenkosten', jahr: 2025, status: 'Abgeschlossen' });
    const m = await import('/src/logic/abschluss.ts');
    return { o, alt, neu, a: await m.buchungGesperrt(o, '2026-01-05', 2025), n: await m.buchungGesperrt(o, '2026-01-06', 2026), d: await m.buchungGesperrt(o, '2025-12-31') };
  });
  ok('Buchungsjahr 2025 mit Datum 2026 ist gesperrt', !!ids.a, ids.a);
  ok('Buchungsjahr 2026 bleibt frei', ids.n === null, ids.n);
  ok('Datum 2025 ist gesperrt', !!ids.d, ids.d);
  await p.goto('http://localhost:5179/#/journal'); await p.waitForTimeout(1500);
  const wahl = p.locator('select').filter({ has: p.locator('option', { hasText: 'Sperre Testhaus' }) }).first();
  await wahl.selectOption({ label: 'Sperre Testhaus' }); await p.waitForTimeout(500);
  await p.locator('label:has-text("Jahr") input').first().fill('2025'); await p.waitForTimeout(1000);
  const zeile = p.locator('tr:has-text("Q4 2025 Sperrtest")');
  ok('Buchung steht im Journal 2025', await zeile.count() === 1);
  await zeile.locator('button[title="Buchung löschen"]').click(); await p.waitForTimeout(800);
  ok('Löschen wird abgelehnt', (await q('SELECT id FROM buchungen WHERE id = $1', [ids.alt])).length === 1);
  ok('Hinweis auf Abschluss erscheint', (await p.locator('main').innerText()).includes('abgeschlossen'));
  await p.locator('label:has-text("Jahr") input').first().fill('2026'); await p.waitForTimeout(1000);
  await p.locator('tr:has-text("Q1 2026 Sperrtest") button[title="Buchung löschen"]').click(); await p.waitForTimeout(1000);
  ok('Buchung im offenen Jahr lässt sich löschen', (await q('SELECT id FROM buchungen WHERE id = $1', [ids.neu])).length === 0);
  ok('Keine Fehler in der Konsole', errs.length === 0, errs.slice(0, 2).join(' | '));
  await b.close();
})().catch((e) => { console.log('FEHL ' + e.message); process.exit(1); });
