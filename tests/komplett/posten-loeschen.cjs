// Sollstellungen löschen (25.11.2026, nur Demodaten): darauf gebuchte Zahlungen bleiben in der Buchhaltung, werden aber vom Posten
// gelöst und erscheinen unter „Zahlungen ohne Posten“. Gilt für das Mülleimer-Symbol und für „Ausgewählte löschen“.
// Wiederherstellen aus dem Papierkorb verbindet sie wieder. Posten mit Zahlung in einem abgeschlossenen Jahr bleiben stehen.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1500, height: 1000 }, locale: 'de-DE' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`);
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const ids = await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts'); const soll = await import('/src/logic/soll.ts');
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'WEG Sollabgang', gesamt_mea: 1000 });
    const e1 = await insert('einheiten', { objekt_id: o, nummer: '1. OG', mea: 500 }); const e2 = await insert('einheiten', { objekt_id: o, nummer: '2. OG links', mea: 500 });
    const y = await insert('personen', { rolle: 'Eigentümer', nachname: 'Lösch', iban: 'DE89370400440532013000' }); const z = await insert('personen', { rolle: 'Eigentümer', nachname: 'Zweit' });
    await insert('eigentum', { einheit_id: e1, person_id: y, anteil: 100 }); await insert('eigentum', { einheit_id: e2, person_id: z, anteil: 100 });
    await insert('hausgeld', { einheit_id: e1, gueltig_ab: '2026-01-01', betrag: 350, davon_ruecklage: 0 }); await insert('hausgeld', { einheit_id: e2, gueltig_ab: '2026-01-01', betrag: 400, davon_ruecklage: 0 });
    await soll.sollStellen('2026-03', { objektId: o });
    const op = async (eid, m) => (await db.select(`SELECT * FROM (${soll.OP_SQL}) WHERE einheit_id = $1 AND monat = $2`, [eid, m]))[0];
    const k = await insert('bankkonten', { objekt_id: o, name: 'Hausgeldkonto Löschtest' });
    const konto = (await db.select("SELECT id FROM buchungskonten WHERE nummer = '1010'"))[0].id;
    const bank = async (eid, m, betrag) => {
      const s = await op(eid, m);
      const u = await insert('bankumsaetze', { bankkonto_id: k, datum: `${m}-05`, betrag, verwendungszweck: `Hausgeld ${m}`, gegenpartei: 'Lösch', gegen_iban: 'DE89370400440532013000', status: 'zugeordnet' });
      return insert('buchungen', { datum: `${m}-05`, betrag, buchungskonto_id: konto, objekt_id: o, einheit_id: eid, sollstellung_id: s.id, bankumsatz_id: u, text: `Hausgeld ${m}`, jahr: 2026 });
    };
    const b1 = await bank(e1, '2026-01', 100); const b2 = await bank(e1, '2026-02', 350); const b3 = await bank(e2, '2026-02', 200);
    await soll.zahlungBuchen(await op(e2, '2026-01'), '2026-01-10');
    return { o, e1, e2, b1, b2, b3, s1: (await op(e1, '2026-01')).id };
  });

  // 1) Einzeln über das Mülleimer-Symbol (Rückfrage bestätigen)
  await p.goto('http://localhost:5179/#/sollstellungen'); await p.waitForTimeout(2500);
  await p.locator('select').first().selectOption({ label: 'WEG Sollabgang' }); await p.waitForTimeout(1500);
  let dialog = '';
  p.once('dialog', (d) => { dialog = d.message().replace(/\s/g, ' '); d.accept(); });
  const zeile = p.locator('section.card', { hasText: 'Januar 2026' }).locator('tbody tr', { hasText: 'Lösch' });
  await zeile.locator('button[title="Posten löschen"]').click(); await p.waitForTimeout(1500);
  const t1 = (await p.locator('main').innerText()).replace(/ /g, ' ');
  ok('Rückfrage nennt die gebuchte Zahlung', /100,00 € gebucht/.test(dialog) && /gelöst/.test(dialog), dialog.slice(0, 90));
  ok('Meldung: 1 Posten gelöscht, 1 Zahlung gelöst', /1 Posten gelöscht\. 1 Zahlung wurde vom Posten gelöst/.test(t1), (t1.match(/\d+ Posten gelöscht[^\n]*/) ?? [''])[0]);
  const r1 = await p.evaluate(async (x) => {
    const { db } = await import('/src/db/index.ts'); const zop = await import('/src/logic/zahlungenOhnePosten.ts');
    const bu = (await db.select('SELECT * FROM buchungen WHERE id = $1', [x.b1]))[0];
    const posten = (await db.select('SELECT COUNT(*) AS n FROM sollstellungen WHERE id = $1', [x.s1]))[0].n;
    const ohne = (await zop.zahlungenOhnePosten(x.o, 2026)).map((z) => z.buchungId);
    return { da: !!bu, frei: bu?.sollstellung_id === null, betrag: bu?.betrag, posten, ohne };
  }, ids);
  ok('Posten weg, Buchung bleibt mit Betrag', r1.posten === 0 && r1.da && r1.betrag === 100, JSON.stringify(r1));
  ok('Buchung ist vom Posten gelöst und unter „Zahlungen ohne Posten“', r1.frei && r1.ohne.includes(ids.b1), JSON.stringify(r1.ohne));

  // 2) Mehrere über die Auswahl: Februar komplett (beide mit Zahlung) und Januar 2. OG (Handzahlung)
  const feb = p.locator('section.card', { hasText: 'Februar 2026' });
  await feb.locator('thead input[type=checkbox]').check();
  await p.locator('section.card', { hasText: 'Januar 2026' }).locator('tr', { hasText: 'Zweit' }).locator('input[type=checkbox]').check();
  await p.getByRole('button', { name: 'Ausgewählte löschen' }).click();
  await p.getByRole('button', { name: /Wirklich 3 Posten löschen/ }).click(); await p.waitForTimeout(1500);
  const t2 = (await p.locator('main').innerText()).replace(/ /g, ' ');
  ok('Meldung: 3 Posten gelöscht, 3 Zahlungen gelöst', /3 Posten gelöscht\. 3 Zahlungen wurden vom Posten gelöst/.test(t2), (t2.match(/\d+ Posten gelöscht[^\n]*/) ?? [''])[0]);
  const r2 = await p.evaluate(async (x) => {
    const { db } = await import('/src/db/index.ts');
    const bu = await db.select(`SELECT COUNT(*) AS n, SUM(sollstellung_id IS NULL) AS frei, SUM(betrag) AS s FROM buchungen WHERE objekt_id = $1`, [x.o]);
    const rest = await db.select(`SELECT monat FROM sollstellungen WHERE einheit_id IN ($1, $2) ORDER BY monat`, [x.e1, x.e2]);
    const umsaetze = await db.select(`SELECT COUNT(*) AS n FROM bankumsaetze u JOIN bankkonten k ON k.id = u.bankkonto_id WHERE k.objekt_id = $1`, [x.o]);
    return { bu: bu[0], rest: rest.map((r) => r.monat), umsaetze: umsaetze[0].n };
  }, ids);
  ok('Alle 4 Buchungen bleiben (1.050 €), alle gelöst', r2.bu.n === 4 && r2.bu.frei === 4 && r2.bu.s === 1050, JSON.stringify(r2.bu));
  ok('Übrig: nur die März-Posten, Bankumsätze unberührt', JSON.stringify(r2.rest) === '["2026-03","2026-03"]' && r2.umsaetze === 3, JSON.stringify(r2));
  const t2b = (await p.locator('main').innerText()).replace(/ /g, ' ');
  ok('Seite zeigt nur noch März', /März 2026/.test(t2b) && !/Januar 2026|Februar 2026/.test(t2b));

  // 3) Papierkorb: Wiederherstellen verbindet die Zahlungen wieder
  const r3 = await p.evaluate(async (x) => {
    const { db } = await import('/src/db/index.ts'); const pk = await import('/src/db/papierkorb.ts');
    const e = await db.select(`SELECT id, art FROM papierkorb WHERE art LIKE 'Offener Posten%' ORDER BY id DESC LIMIT 2`);
    for (const r of e) await pk.wiederherstellen(r.id);
    const bu = await db.select(`SELECT id, sollstellung_id FROM buchungen WHERE objekt_id = $1`, [x.o]);
    const n = (await db.select(`SELECT COUNT(*) AS n FROM sollstellungen WHERE einheit_id IN ($1, $2)`, [x.e1, x.e2]))[0].n;
    return { arten: e.map((r) => r.art), verbunden: bu.filter((b) => b.sollstellung_id !== null).length, n };
  }, ids);
  ok('Wiederherstellen: Posten zurück und Zahlungen wieder verbunden', r3.n === 6 && r3.verbunden === 4, JSON.stringify(r3));

  // 4) Abgeschlossenes Jahr: Posten mit Zahlung bleibt, Zahlung bleibt verbunden; Posten ohne Zahlung wird gelöscht
  const r4 = await p.evaluate(async (x) => {
    const { db, insert } = await import('/src/db/index.ts'); const soll = await import('/src/logic/soll.ts');
    await insert('abrechnungen', { objekt_id: x.o, art: 'WEG-Jahresabrechnung', jahr: 2026, status: 'Abgeschlossen' });
    const mit = (await db.select('SELECT sollstellung_id AS id FROM buchungen WHERE id = $1', [x.b2]))[0].id;
    const ohne = (await db.select(`SELECT id FROM sollstellungen WHERE einheit_id = $1 AND monat = '2026-03'`, [x.e1]))[0].id;
    const res = await soll.postenLoeschen([mit, ohne]);
    const noch = (await db.select('SELECT sollstellung_id FROM buchungen WHERE id = $1', [x.b2]))[0].sollstellung_id;
    await db.execute(`DELETE FROM abrechnungen WHERE objekt_id = $1`, [x.o]);
    return { geloescht: res.geloescht, geloest: res.geloest, gesperrt: res.gesperrt.map((g) => g.id), mit, noch };
  }, ids);
  ok('Abgeschlossenes Jahr: Posten mit Zahlung bleibt verbunden', r4.geloescht === 1 && r4.geloest === 0 && r4.gesperrt.length === 1 && r4.gesperrt[0] === r4.mit && r4.noch === r4.mit, JSON.stringify(r4));

  ok('Keine Fehler in der Konsole', !errs.length, errs.slice(0, 3).join(' | '));
  await b.close();
})();
