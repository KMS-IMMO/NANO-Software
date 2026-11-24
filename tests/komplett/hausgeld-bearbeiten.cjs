const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
// Hausgeld anpassen: Hausgeld-Stände einer Einheit bearbeiten und löschen. Offene Posten werden neu gestellt, bezahlte bleiben, abgeschlossene Jahre sind gesperrt.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ deviceScaleFactor: 2, locale: 'de-DE' })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`);
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const r = await p.evaluate(async () => {
    const { insert, db } = await import('/src/db/index.ts');
    const soll = await import('/src/logic/soll.ts');
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'WEG Hausgeld bearbeiten', strasse: 'Y 2', plz: '50674', ort: 'Köln', objekt_nr: '9077' });
    const eig = await insert('personen', { rolle: 'Eigentümer', vorname: 'Hanna', nachname: 'Hausgeld' });
    const e1 = await insert('einheiten', { objekt_id: o, nummer: 'WE 1', typ: 'Wohnung', mea: 1000, lfd_nr: 1 });
    const ei = await insert('eigentum', { einheit_id: e1, person_id: eig, anteil: 100 });
    await insert('hausgeld', { einheit_id: e1, gueltig_ab: '2025-01-01', betrag: 180, davon_ruecklage: 0 });
    await insert('hausgeld', { einheit_id: e1, gueltig_ab: '2026-01-01', betrag: 185, davon_ruecklage: 0 });
    await soll.sollStellen('2026-06', { objektId: o });
    const jan = (await db.select(`SELECT * FROM (${soll.OP_SQL}) WHERE einheit_id = ${e1} AND monat = '2026-01'`))[0];
    await soll.zahlungBuchen(jan, '2026-01-05');
    return { o, e1, ei };
  });
  const posten = () => p.evaluate(async (e1) => {
    const { db } = await import('/src/db/index.ts');
    return db.select(`SELECT monat, betrag, (SELECT COUNT(*) FROM buchungen b WHERE b.sollstellung_id = s.id) AS bez FROM sollstellungen s WHERE einheit_id = ${e1} AND monat >= '2025-12' ORDER BY monat`);
  }, r.e1);
  p.on('dialog', (d) => d.accept());
  await p.setViewportSize({ width: 1500, height: 1000 });
  await p.goto(`http://localhost:5179/#/objekte/${r.o}/eigentum/${r.ei}`);
  const karte = p.locator('section.hausgeld-anpassen');
  await karte.locator('table.hausgeld-verlauf tbody tr').first().waitFor({ timeout: 15000 });
  ok('Zwei Stände mit Bearbeiten und Löschen', (await karte.locator('button[title="Bearbeiten"]').count()) === 2 && (await karte.locator('button[title="Löschen"]').count()) === 2);

  await karte.screenshot({ path: AUS + '/hausgeld-verlauf.png' });
  // Bearbeiten: 2026 von 185 auf 190 €
  await karte.locator('tbody tr').first().locator('button[title="Bearbeiten"]').click();
  const ed = karte.locator('tr.hg-edit');
  await ed.locator('input').nth(1).fill('190,00');
  await karte.screenshot({ path: AUS + '/hausgeld-bearbeiten.png' });
  await ed.locator('button[title="Änderung speichern"]').click();
  await p.waitForTimeout(800);
  let ps = await posten();
  const z1 = (await karte.locator('tbody tr').first().innerText()).replace(/\s+/g, ' ');
  ok('Tabelle zeigt 190,00 € ab 1.1.2026', /190,00/.test(z1), z1);
  ok('Bezahlter Januar 2026 bleibt 185 €', ps.find((x) => x.monat === '2026-01')?.betrag === 185 && ps.find((x) => x.monat === '2026-01')?.bez === 1, JSON.stringify(ps.find((x) => x.monat === '2026-01')));
  ok('Offene Posten Feb–Jun 2026 neu mit 190 €', ps.filter((x) => x.monat >= '2026-02').length === 5 && ps.filter((x) => x.monat >= '2026-02').every((x) => x.betrag === 190), JSON.stringify(ps));
  ok('Hinweis auf bezahlten Posten', /1 bereits bezahlter Posten bleibt/.test(await p.locator('p.info').innerText()), await p.locator('p.info').innerText());

  // Löschen: Stand 2026 entfernen → ab 2026 gilt wieder 180 €
  await karte.locator('tbody tr').first().locator('button[title="Löschen"]').click();
  await p.waitForTimeout(800);
  ps = await posten();
  ok('Nach Löschen nur noch ein Stand', (await karte.locator('tbody tr').count()) === 1);
  ok('Offene Posten Feb–Jun 2026 wieder 180 €', ps.filter((x) => x.monat >= '2026-02').every((x) => x.betrag === 180) && ps.filter((x) => x.monat >= '2026-02').length === 5, JSON.stringify(ps));
  ok('Dezember 2025 unverändert 180 €', ps.find((x) => x.monat === '2025-12')?.betrag === 180);

  // Jahressperre: 2025 abgeschlossen → Stand ab 2025 lässt sich nicht löschen
  await p.evaluate(async (o) => { const { insert } = await import('/src/db/index.ts'); await insert('abrechnungen', { objekt_id: o, art: 'WEG-Jahresabrechnung', jahr: 2025, status: 'Abgeschlossen' }); }, r.o);
  await karte.locator('tbody tr').first().locator('button[title="Löschen"]').click();
  await p.waitForTimeout(600);
  const fehler = await karte.locator('p.error').innerText().catch(() => '');
  ok('Abgeschlossenes Jahr gesperrt', /2025 ist abgeschlossen/.test(fehler) && (await karte.locator('tbody tr').count()) === 1, fehler);
  ok('Keine Fehler in der Konsole', !errs.length, errs.join(' | ').slice(0, 300));
  await b.close();
})().catch((e) => { console.log('FAIL Abbruch: ' + e.message); process.exit(1); });
