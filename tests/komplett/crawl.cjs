const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--lang=de-DE'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
  const p = await ctx.newPage();
  let cur = '';
  const errs = [];
  p.on('pageerror', (e) => errs.push([cur, 'pageerror', e.message]));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|DevTools|Download the React/.test(m.text())) errs.push([cur, 'console', m.text().slice(0, 300)]); });
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const ids = await p.evaluate(async () => {
    const { db } = await import('/src/db/index.ts');
    return {
      o: (await db.select('SELECT id, verwaltungsart FROM objekte')),
      v: (await db.select('SELECT v.id, e.objekt_id FROM mietvertraege v JOIN einheiten e ON e.id = v.einheit_id')),
      ei: (await db.select('SELECT ei.id, e.objekt_id FROM eigentum ei JOIN einheiten e ON e.id = ei.einheit_id')),
    };
  });
  const top = ['/', '/objekte', '/objekte/neu', '/personen', '/eigentuemer', '/mieter', '/firmen', '/vertraege', '/sollstellungen', '/offene-posten', '/rechnungen', '/konten', '/einstellungen', '/bank', '/mahnungen', '/nebenkosten', '/weg-abrechnung', '/eigentuemer-abrechnung', '/ablage', '/instandhaltung', '/beschluesse', '/journal', '/regeln', '/auswertung', '/berichte', '/verwalter', '/kontakte', '/kalender', '/erinnerungen', '/fristen', '/tickets', '/todo', '/notizen', '/papierkorb'];
  const sub = ['', 'eigentuemer', 'mieter', 'buchungen', 'bank', 'offene-posten', 'sollstellungen', 'rechnungen', 'mahnungen', 'auswertung', 'hausgeld', 'vorauszahlungen', 'wirtschaftsplan', 'ruecklagen', 'hausgeldabrechnung', 'nebenkosten', 'eigentuemerabrechnung', 'beschluesse', 'instandhaltung', 'beirat', 'schluessel', 'dokumente', 'fristen', 'aufgaben'];
  const urls = [...top];
  for (const o of ids.o) for (const s of sub) urls.push(`/objekte/${o.id}${s ? '/' + s : ''}`);
  for (const v of ids.v) urls.push(`/objekte/${v.objekt_id}/vertrag/${v.id}`, `/vertraege/${v.id}`);
  for (const e of ids.ei) urls.push(`/objekte/${e.objekt_id}/eigentum/${e.id}`);
  const leer = [];
  for (const u of urls) {
    cur = u;
    await p.goto('http://localhost:5179/#' + u); await p.waitForTimeout(700);
    const t = await p.evaluate(() => document.querySelector('main')?.innerText ?? document.body.innerText);
    if (/Something went wrong|Unexpected Application Error|is not a function|undefined|NaN|\[object Object\]/.test(t)) leer.push([u, (t.match(/.{0,60}(Something went wrong|Unexpected Application Error|is not a function|undefined|NaN|\[object Object\]).{0,60}/) || [''])[0]]);
    if (t.trim().length < 20) leer.push([u, 'fast leer']);
  }
  // Einstellungen: alle Reiter/Karten durchklicken
  cur = '/einstellungen tabs';
  await p.goto('http://localhost:5179/#/einstellungen'); await p.waitForTimeout(1200);
  const tabs = await p.locator('.tabs button, [role=tab]').allInnerTexts();
  for (let i = 0; i < tabs.length; i++) { await p.locator('.tabs button, [role=tab]').nth(i).click(); await p.waitForTimeout(500);
    const t = await p.evaluate(() => document.querySelector('main')?.innerText ?? ''); if (/undefined|NaN|\[object Object\]/.test(t)) leer.push(['einst:' + tabs[i], 'undefined/NaN']); }
  console.log('URLS', urls.length, 'TABS', JSON.stringify(tabs));
  console.log('AUFFAELLIG', JSON.stringify(leer, null, 1));
  console.log('ERRS', JSON.stringify(errs, null, 1));
  await b.close();
})();
