// Einnahmen & Ausgaben: ignorierte Kontoumsätze bleiben im Reiter „Ignoriert“ sichtbar und lassen sich dort
// nachträglich buchen, zurückholen oder löschen (nur Demodaten).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1500, height: 1000 }, locale: 'de-DE' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  p.on('dialog', (d) => d.accept());
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined && !c ? ' → ' + ist : ''}`);
  const karte = () => p.locator('section.offene-umsaetze');
  const kt = async () => (await karte().innerText()).replace(/[  ]/g, ' ');
  const AUS = process.env.NEOSS_TEST_AUSGABE;
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const ids = await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts'); const bank = await import('/src/logic/bank.ts');
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'WEG Ignoriert', gesamt_mea: 1000 });
    const bk = await insert('bankkonten', { objekt_id: o, name: 'Hausgeldkonto' });
    await bank.importieren(bk, [
      { datum: '2026-03-02', betrag: -12.5, verwendungszweck: 'Kontofuehrung Maerz', gegenpartei: 'Sparkasse', gegen_iban: '' },
      { datum: '2026-03-05', betrag: -89.9, verwendungszweck: 'Rechnung 4711 Hausmeister', gegenpartei: 'Hausmeister Klein', gegen_iban: 'DE22' },
      { datum: '2026-03-09', betrag: 1.11, verwendungszweck: 'Testueberweisung', gegenpartei: 'Unbekannt', gegen_iban: 'DE33' },
      { datum: '2026-03-12', betrag: 250, verwendungszweck: 'Hausgeld Maerz', gegenpartei: 'Maria Wagner', gegen_iban: 'DE44' },
    ]);
    const u = await db.select('SELECT id, verwendungszweck FROM bankumsaetze WHERE bankkonto_id = $1 ORDER BY datum', [bk]);
    for (const x of u.slice(0, 3)) await db.execute(`UPDATE bankumsaetze SET status = 'ignoriert' WHERE id = $1`, [x.id]);
    return { o, bk, u: u.map((x) => x.id) };
  });
  const status = () => p.evaluate(async (bk) => { const { db } = await import('/src/db/index.ts'); return db.select('SELECT id, status FROM bankumsaetze WHERE bankkonto_id = $1 ORDER BY datum', [bk]); }, ids.bk);

  await p.goto(`http://localhost:5179/#/objekte/${ids.o}/buchungen`); await p.waitForTimeout(3000);
  let t = await kt();
  ok('Reiter „Noch zu buchen (1)“ und „Ignoriert (3)“', /Noch zu buchen \(1\)/.test(t) && /Ignoriert \(3\)/.test(t), t.slice(0, 200));
  await karte().getByRole('button', { name: /Ignoriert \(3\)/ }).click(); await p.waitForTimeout(1500);
  t = await kt();
  ok('Reiter „Ignoriert“ zeigt die drei Umsätze', /3 ignoriert/.test(t) && /Kontofuehrung Maerz/.test(t) && /Testueberweisung/.test(t) && !/Hausgeld Maerz/.test(t), t.slice(0, 300));
  ok('Je Zeile Buchen, Zurückholen und Löschen', (await karte().getByRole('button', { name: 'Buchen', exact: true }).count()) === 3
    && (await karte().getByRole('button', { name: /Zurückholen/ }).count()) === 3 && (await karte().getByRole('button', { name: /Löschen/ }).count()) === 3);
  if (AUS) await p.screenshot({ path: `${AUS}/ignoriert-1-reiter.png`, clip: await karte().boundingBox() });

  // Zurückholen
  await karte().locator('tr', { hasText: 'Hausmeister Klein' }).getByRole('button', { name: /Zurückholen/ }).click(); await p.waitForTimeout(1500);
  let s = await status();
  ok('Zurückholen: Umsatz ist wieder offen', s[1].status === 'offen', JSON.stringify(s));
  t = await kt();
  ok('Zähler: Noch zu buchen (2), Ignoriert (2)', /Noch zu buchen \(2\)/.test(t) && /Ignoriert \(2\)/.test(t), t.slice(0, 200));

  // Löschen
  await karte().locator('tr', { hasText: 'Testueberweisung' }).getByRole('button', { name: /Löschen/ }).click(); await p.waitForTimeout(1500);
  s = await status();
  ok('Löschen: ignorierter Umsatz ist weg', s.length === 3 && !s.some((x) => x.id === ids.u[2]), JSON.stringify(s));

  // Nachträglich buchen über das Buchen-Fenster
  await karte().locator('tr', { hasText: 'Kontofuehrung Maerz' }).getByRole('button', { name: 'Buchen', exact: true }).click(); await p.waitForTimeout(1200);
  const modal = p.locator('.modal');
  ok('Buchen-Fenster geht mit dem Umsatz auf', /Kontofuehrung Maerz/.test(await modal.innerText()));
  if (AUS) await p.screenshot({ path: `${AUS}/ignoriert-2-buchen.png` });
  const konto = modal.locator('select').first();
  const opts = await konto.locator('option').allInnerTexts();
  const ziel = opts.find((x) => /Bank|Kontof/i.test(x)) ?? opts.find((x) => x && !/wählen|…/.test(x));
  await konto.selectOption({ label: ziel }).catch(() => {});
  await modal.getByRole('button', { name: /Buchen|Speichern/ }).last().click(); await p.waitForTimeout(1800);
  s = await status();
  const b1 = await p.evaluate(async (id) => { const { db } = await import('/src/db/index.ts'); return db.select('SELECT betrag FROM buchungen WHERE bankumsatz_id = $1', [id]); }, ids.u[0]);
  ok('Nachträglich gebucht: Status zugeordnet, Buchung -12,50 €', s[0].status === 'zugeordnet' && b1.length === 1 && Math.abs(b1[0].betrag + 12.5) < 0.001, JSON.stringify({ s: s[0], b1, ziel }));
  t = await kt();
  ok('Keine ignorierten mehr: Reiter verschwindet, Liste „noch zu buchen“', !/Ignoriert \(/.test(t) && /2 noch zu buchen/.test(t), t.slice(0, 200));

  // Mehrfachauswahl: ignorieren und gemeinsam zurückholen
  await karte().locator('thead input[type=checkbox]').check(); await p.waitForTimeout(300);
  await karte().getByRole('button', { name: 'Ignorieren', exact: true }).first().click(); await p.waitForTimeout(1500);
  await karte().getByRole('button', { name: /Ignoriert \(2\)/ }).click(); await p.waitForTimeout(1200);
  await karte().locator('thead input[type=checkbox]').check(); await p.waitForTimeout(300);
  ok('Auswahlleiste im Reiter „Ignoriert“ mit Zurückholen', await karte().locator('.auswahl-leiste').getByRole('button', { name: /Zurückholen/ }).isVisible());
  await karte().locator('.auswahl-leiste').getByRole('button', { name: /Zurückholen/ }).click(); await p.waitForTimeout(1500);
  s = await status();
  ok('Mehrere zurückgeholt: beide wieder offen', s.filter((x) => x.status === 'offen').length === 2, JSON.stringify(s));

  ok('Keine Fehler in der Konsole', !errs.length, errs.join(' | ').slice(0, 300));
  await b.close();
})().catch((e) => { console.log('FAIL Abbruch ' + e.message); process.exit(1); });
