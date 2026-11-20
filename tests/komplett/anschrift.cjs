const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
// WEG: Anschrift des Eigentümers in der Einheitenliste, Pflicht bei vermieteten Wohnungen (Demodaten)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1600, height: 950 }, locale: 'de-DE', deviceScaleFactor: 2 });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`);
  const q = (sql) => p.evaluate(async (s) => { const { db } = await import('/src/db/index.ts'); return db.select(s); }, sql);
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const o = await p.evaluate(async () => {
    const { insert } = await import('/src/db/index.ts');
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'WEG Lindenweg', strasse: 'Lindenweg 5', plz: '50672', ort: 'Köln', objekt_nr: '9001' });
    const pers = [
      await insert('personen', { rolle: 'Eigentümer', anrede: 'Frau', vorname: 'Erika', nachname: 'Musterfrau', telefon: '0221 000001' }),
      await insert('personen', { rolle: 'Eigentümer', anrede: 'Herr', vorname: 'Max', nachname: 'Mustermann', email: 'max@example.de', strasse: 'Am Hang 2', plz: '53113', ort: 'Bonn' }),
      await insert('personen', { rolle: 'Eigentümer', anrede: 'Herr', vorname: 'Hans', nachname: 'Beispiel' }),
    ];
    const lagen = [['EG links', 'EG', 1], ['EG rechts', 'EG', 0], ['1.OG', '1. OG', 0]];
    for (let i = 0; i < 3; i++) {
      const e = await insert('einheiten', { objekt_id: o, nummer: lagen[i][0], typ: 'Wohnung', lage: lagen[i][1], mea: i === 2 ? 340 : 330, lfd_nr: i + 1, vermietet: lagen[i][2] });
      await insert('eigentum', { einheit_id: e, person_id: pers[i], anteil: 100 });
    }
    return o;
  });
  const zeilen = async () => (await p.locator('table.list tbody tr').allInnerTexts()).map((x) => x.replace(/\s+/g, ' '));
  await p.goto(`http://localhost:5179/#/objekte/${o}`); await p.waitForSelector('table.list tbody tr', { timeout: 15000 }); await p.waitForTimeout(500);
  ok('Spalte „Anschrift Eigentümer“ da', await p.locator('table.list thead th:text-is("Anschrift Eigentümer")').count() === 1);
  let z = await zeilen();
  ok('Vermietet ohne Anschrift: „fehlt“', /Vermietet/.test(z[0]) && /fehlt/.test(z[0]), z[0]);
  ok('Eigene Anschrift wird gezeigt', /Am Hang 2, 53113 Bonn/.test(z[1]), z[1]);
  ok('Selbst bewohnt ohne Anschrift: „wie Wohnung“', /wie Wohnung/.test(z[2]) && /Eigentum/.test(z[2]), z[2]);
  await p.locator('.card').filter({ has: p.locator('table.list') }).first().screenshot({ path: AUS + '/anschrift-liste.png' });
  // Dashboard für diese Liegenschaft zeigt den Punkt
  const k = await p.evaluate(async (id) => { const r = await (await import('/src/db/index.ts')).db.select(`SELECT COUNT(*) n FROM einheiten e WHERE e.objekt_id = ${id} AND e.vermietet = 1`); return r[0].n; }, o);
  ok('Einheit als vermietet gespeichert', k === 1, k);
  const soll = (await q(`SELECT COUNT(*) n FROM einheiten e JOIN objekte x ON x.id = e.objekt_id WHERE x.verwaltungsart = 'WEG'
      AND (e.vermietet = 1 OR EXISTS (SELECT 1 FROM mietvertraege v WHERE v.einheit_id = e.id AND v.beginn <= date('now') AND (v.ende IS NULL OR v.ende >= date('now'))))
      AND EXISTS (SELECT 1 FROM eigentum ei JOIN personen p ON p.id = ei.person_id WHERE ei.einheit_id = e.id AND (ei.bis IS NULL OR ei.bis >= date('now')) AND (p.strasse IS NULL OR p.plz IS NULL OR p.ort IS NULL))`))[0].n;
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3000);
  const zt = (await p.locator('.zutun').innerText().catch(() => '')).replace(/\s+/g, ' ');
  const treffer = zt.match(/(\d+)\s*vermietete Wohnung(en)? ohne Anschrift des Eigentümers/);
  ok('Dashboard: vermietete Wohnungen ohne Anschrift des Eigentümers', treffer && Number(treffer[1]) === soll && soll >= 1, `${treffer && treffer[0]} (erwartet ${soll})`);
  // Anschrift eintragen: Klick auf „fehlt“ öffnet das Fenster, PLZ ergänzt den Ort
  await p.goto(`http://localhost:5179/#/objekte/${o}`); await p.waitForSelector('table.list tbody tr', { timeout: 15000 }); await p.waitForTimeout(500);
  await p.locator('table.list tbody tr').first().locator('button.anschrift-knopf').click(); await p.waitForTimeout(400);
  const m = p.locator('.anschrift-modal');
  ok('Fenster öffnet sich (nicht „Mieter anlegen“)', await m.count() === 1 && await p.locator('.mieter-inhalt').count() === 0);
  await m.locator('label:has(> span:text-is("Straße und Hausnummer")) input').fill('Gartenstraße 12');
  await m.locator('label:has(> span:text-is("PLZ")) input').fill('5066');
  ok('PLZ wird geprüft', /fünf Ziffern/.test(await m.innerText()));
  await m.locator('label:has(> span:text-is("PLZ")) input').fill('50668'); await p.waitForTimeout(500);
  const ort = await m.locator('label:has(> span:text-is("Ort")) input').inputValue();
  ok('Ort aus der PLZ ergänzt', ort === 'Köln', ort);
  await m.screenshot({ path: AUS + '/anschrift-fenster.png' });
  await m.locator('button.primary').click(); await p.waitForTimeout(800);
  z = await zeilen();
  ok('Liste zeigt die neue Anschrift', /Gartenstraße 12, 50668 Köln/.test(z[0]) && !/fehlt/.test(z[0]), z[0]);
  const per = (await q("SELECT strasse, plz, ort FROM personen WHERE nachname = 'Musterfrau'"))[0];
  ok('Beim Kontakt gespeichert', per.strasse === 'Gartenstraße 12' && per.plz === '50668' && per.ort === 'Köln', JSON.stringify(per));
  // Bearbeiten (Stift): Haken „Vom Eigentümer vermietet“ mit Hinweis
  await p.locator('table.list tbody tr').nth(2).locator('td.actions button, button[title="Bearbeiten"]').first().click(); await p.waitForTimeout(400);
  const haken = p.locator('label:has-text("Vom Eigentümer vermietet") input[type=checkbox]');
  ok('Haken „Vom Eigentümer vermietet“ im Formular', await haken.count() === 1);
  await haken.check(); await p.waitForTimeout(200);
  ok('Hinweis zur Anschrift erscheint', /Anschrift des Eigentümers eintragen/.test(await p.locator('.modal').innerText()));
  await p.locator('.modal').screenshot({ path: AUS + '/anschrift-haken.png' });
  await p.locator('.modal button.primary').click(); await p.waitForTimeout(800);
  z = await zeilen();
  ok('Danach: 1.OG vermietet, Anschrift fehlt', /Vermietet/.test(z[2]) && /fehlt/.test(z[2]), z[2]);
  ok('Keine Fehler in der Konsole', !errs.length, errs.join(' | ').slice(0, 300));
  await b.close();
})().catch((e) => { console.log('FAIL Abbruch: ' + e.message); process.exit(1); });
