// Eigentümerabrechnung (Mietverwaltung): Kontoentwicklung rechnerisch gegen Kontostand laut Bank.
// Alles gebucht → keine Differenz. Danach typische Fälle, in denen trotz „alles gebucht“ eine Differenz entsteht;
// jede muss vollständig in Gründe zerlegt werden (Summe der Gründe = Differenz) und in der Oberfläche erscheinen.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1500, height: 1000 }, locale: 'de-DE' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined && !c ? ' → ' + ist : ''}`);
  const AUS = process.env.NEOSS_TEST_AUSGABE;
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);

  const basis = await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts'); const soll = await import('/src/logic/soll.ts'); const bank = await import('/src/logic/bank.ts');
    const ke = await import('/src/logic/kontoentwicklung.ts');
    const k = async (n) => (await db.select('SELECT id FROM buchungskonten WHERE nummer = $1', [n]))[0].id;
    const ei = await insert('personen', { rolle: 'Eigentümer', vorname: 'Paula', nachname: 'Pankratius' });
    const o = await insert('objekte', { verwaltungsart: 'Mietverwaltung', name: 'Differenzweg 33', strasse: 'Differenzweg 33', plz: '50667', ort: 'Köln', eigentuemer_id: ei, gesamt_flaeche: 80 });
    const e = await insert('einheiten', { objekt_id: o, nummer: 'EG', flaeche: 80 });
    const m = await insert('personen', { rolle: 'Mieter', vorname: 'Dana', nachname: 'Differenz', iban: 'DE02370501980000000033' });
    await insert('mietvertraege', { einheit_id: e, mieter_id: m, beginn: '2025-01-01', kaltmiete: 500, nk_vorauszahlung: 100 });
    await soll.sollStellen('2025-12', { objektId: o, von: '2025-01' });
    const bk = await insert('bankkonten', { objekt_id: o, name: 'Mietkonto Differenz', iban: 'DE02370501980000999933', anfangssaldo: 1000, saldo_datum: '2024-12-31' });
    const f = await insert('firmen', { name: 'Hausmeister Diff' });
    const r1 = await insert('rechnungen', { objekt_id: o, firma_id: f, rechnungsnr: 'HM-1', datum: '2025-03-01', betrag: 240, buchungskonto_id: await k('1243') });
    const U = [];
    for (let i = 1; i <= 11; i++) { const mm = String(i).padStart(2, '0');
      U.push({ datum: `2025-${mm}-03`, betrag: 600, gegenpartei: 'Dana Differenz', verwendungszweck: `Miete ${mm}/2025`, gegen_iban: 'DE02370501980000000033' }); }
    U.push({ datum: '2025-03-15', betrag: -240, gegenpartei: 'Hausmeister Diff', verwendungszweck: 'Rechnung HM-1', gegen_iban: 'DE00' });
    U.push({ datum: '2025-06-30', betrag: -2000, gegenpartei: 'Paula Pankratius', verwendungszweck: 'Auszahlung Eigentümer', gegen_iban: 'DE01' });
    await bank.importieren(bk, U);
    await bank.automatischZuordnen();
    for (const u of await db.select("SELECT * FROM bankumsaetze WHERE bankkonto_id = $1 AND status = 'offen'", [bk])) {
      if (u.verwendungszweck === 'Rechnung HM-1') await bank.zuordnenRechnung(u, r1);
      else if (u.verwendungszweck === 'Auszahlung Eigentümer') await bank.zuordnenKonto(u, await k('1700'));
    }
    const offen = (await db.select("SELECT COUNT(*) AS n FROM bankumsaetze WHERE bankkonto_id = $1 AND status = 'offen'", [bk]))[0].n;
    const x = await ke.kontoentwicklung(o, 2025);
    return { o, bk, e, m, offen: Number(offen), x };
  });
  ok('Ausgangslage: alle Kontoumsätze gebucht', basis.offen === 0, basis.offen);
  ok('Ausgangslage: Stand 01.01. 1.000, Bank 31.12. 5.360, rechnerisch gleich, keine Differenz',
    basis.x.anfang === 1000 && basis.x.ende === 5360 && basis.x.rechnerisch === 5360 && basis.x.differenz === 0 && !basis.x.gruende.length, JSON.stringify(basis.x));

  // Fälle nacheinander dazu; nach jedem: Summe der Gründe = Differenz, erwarteter Grund mit erwartetem Betrag
  const fall = async (name, code, schluessel, betrag) => {
    const x = await p.evaluate(async ({ code, o, bk, e, m }) => {
      const { db, insert } = await import('/src/db/index.ts'); const soll = await import('/src/logic/soll.ts'); const bank = await import('/src/logic/bank.ts');
      const k = async (n) => (await db.select('SELECT id FROM buchungskonten WHERE nummer = $1', [n]))[0].id;
      await (new Function('ctx', `return (async () => { const { db, insert, soll, bank, k, o, bk, e, m } = ctx; ${code} })()`))({ db, insert, soll, bank, k, o, bk, e, m });
      return (await import('/src/logic/kontoentwicklung.ts')).kontoentwicklung(o, 2025);
    }, { code, ...basis });
    const g = x.gruende.find((y) => y.schluessel === schluessel);
    const summe = Math.round(x.gruende.reduce((a, y) => a + y.betrag, 0) * 100) / 100;
    ok(`${name}: Grund „${g?.text ?? schluessel}“ ${betrag} €`, g && Math.abs(g.betrag - betrag) < 0.005, JSON.stringify(x.gruende.map((y) => [y.schluessel, y.betrag])));
    ok(`${name}: Summe der Gründe = Differenz (${x.differenz} €), kein Rest`, Math.abs(summe - x.differenz) < 0.005 && Math.abs(x.rest) < 0.005, `Summe ${summe}, Rest ${x.rest}`);
    return x;
  };
  // 1) Dezember-Miete bei den Sollstellungen „Als bezahlt buchen“, der Kontoumsatz fehlt (nicht eingelesen)
  await fall('Dezember als bezahlt gebucht, Umsatz fehlt', `
    for (const r of await db.select(\`SELECT * FROM (\${soll.OP_SQL}) WHERE objekt_id = $1 AND monat = '2025-12' AND betrag - bezahlt > 0.005\`, [o])) await soll.zahlungBuchen(r, '2025-12-03');`,
    'ohne', -600);
  // 2) Kaution eingegangen und auf 1020 gebucht (nicht in der EÜR)
  await fall('Kaution auf 1020', `
    await bank.importieren(bk, [{ datum: '2025-01-10', betrag: 1500, gegenpartei: 'Dana Differenz', verwendungszweck: 'Kaution', gegen_iban: 'DE02370501980000000033' }]);
    const u = (await db.select("SELECT * FROM bankumsaetze WHERE bankkonto_id = $1 AND verwendungszweck = 'Kaution'", [bk]))[0];
    await bank.zuordnenKonto(u, await k('1020'));`, 'konto', 1500);
  // 3) Rechnung erfasst, aber noch nicht bezahlt
  await fall('Rechnung noch offen', `
    await insert('rechnungen', { objekt_id: o, rechnungsnr: 'OFFEN-1', datum: '2025-11-20', betrag: 99.5, buchungskonto_id: await k('1243') });`, 'rechnungen', 99.5);
  // 4) Kontoumsatz ignoriert
  await fall('Kontoumsatz ignoriert', `
    await bank.importieren(bk, [{ datum: '2025-08-08', betrag: -12.34, gegenpartei: 'Bank', verwendungszweck: 'Gebühr', gegen_iban: '' }]);
    await db.execute("UPDATE bankumsaetze SET status = 'ignoriert' WHERE bankkonto_id = $1 AND verwendungszweck = 'Gebühr'", [bk]);`, 'ignoriert', -12.34);
  // 5) Buchung im Buchungsjahr 2025, der Kontoumsatz kam erst im Januar 2026
  await fall('Buchungsjahr 2025, Umsatz im Januar 2026', `
    await bank.importieren(bk, [{ datum: '2026-01-05', betrag: -80, gegenpartei: 'Stadtwerke', verwendungszweck: 'Strom Dezember 2025', gegen_iban: 'DE09' }]);
    const u = (await db.select("SELECT * FROM bankumsaetze WHERE bankkonto_id = $1 AND verwendungszweck = 'Strom Dezember 2025'", [bk]))[0];
    await bank.zuordnenKonto(u, await k('1243'));
    await db.execute('UPDATE buchungen SET jahr = 2025 WHERE bankumsatz_id = $1', [u.id]);`, 'umsatzJahr', 80);
  // 6) Zahlung für diese Liegenschaft kam auf dem Bankkonto einer anderen Liegenschaft an
  const x = await fall('Zahlung über anderes Bankkonto', `
    const o2 = await insert('objekte', { verwaltungsart: 'Mietverwaltung', name: 'Andere Liegenschaft' });
    const bk2 = await insert('bankkonten', { objekt_id: o2, name: 'Fremdkonto', anfangssaldo: 0, saldo_datum: '2024-12-31' });
    await bank.importieren(bk2, [{ datum: '2025-05-05', betrag: 45, gegenpartei: 'Dana Differenz', verwendungszweck: 'Nachzahlung', gegen_iban: 'DE77' }]);
    const u = (await db.select("SELECT * FROM bankumsaetze WHERE bankkonto_id = $1", [bk2]))[0];
    await insert('buchungen', { datum: u.datum, betrag: 45, buchungskonto_id: await k('1000'), objekt_id: o, einheit_id: e, bankumsatz_id: u.id, text: 'Nachzahlung über Fremdkonto' });
    await db.execute("UPDATE bankumsaetze SET status = 'zugeordnet' WHERE id = $1", [u.id]);`, 'bankFremd', -45);
  ok('Alle Fälle zusammen: Differenz 1.500 − 600 + 99,50 − 12,34 + 80 − 45 = 1.022,16 €', Math.abs(x.differenz - 1022.16) < 0.005, x.differenz);

  // Kontoabgleich: Endbestand laut Auszug ohne die fehlende Dezember-Miete → Hinweis nennt auch die von Hand bezahlte Sollstellung
  const ka = await p.evaluate(async ({ o, bk }) => {
    const ka = await import('/src/logic/kontoabgleich.ts');
    const l = await ka.kontoabgleich(o, 2025); const k = l.find((y) => y.id === bk);
    await ka.auszugSpeichern(bk, 2025, k.ende + 600);
    return (await ka.kontoabgleich(o, 2025)).find((y) => y.id === bk);
  }, basis);
  ok('Kontoabgleich: Differenz 600 € nennt die „Als bezahlt“ gebuchte Dezember-Miete', ka.differenz === 600 && ka.ohneUmsatz.some((y) => /\(manuell\)/.test(y.text)), JSON.stringify(ka.ohneUmsatz));

  // Oberfläche: Eigentümerabrechnung zeigt die Gründe
  await p.goto(`http://localhost:5179/#/objekte/${basis.o}/eigentuemerabrechnung`); await p.waitForTimeout(3000);
  let t = (await p.locator('main').innerText()).replace(/[\u00a0\u202f]/g, ' ');
  if (!/Kontoentwicklung/.test(t)) {
    await p.goto('http://localhost:5179/#/eigentuemerabrechnung'); await p.waitForTimeout(2500);
    const sel = p.locator('main select').first(); await sel.selectOption({ label: 'Differenzweg 33' }).catch(() => {}); await p.waitForTimeout(2500);
    t = (await p.locator('main').innerText()).replace(/[\u00a0\u202f]/g, ' ');
  }
  ok('Oberfläche: Differenz 1.022,16 € mit Aufschlüsselung', /Differenz 1\.022,16 €/.test(t) && /Sie setzt sich so zusammen/.test(t) && /Gebucht ohne Kontoumsatz/.test(t) && /außerhalb der EÜR/.test(t), (t.match(/Differenz[^\n]*/) ?? [''])[0]);
  await p.getByRole('button', { name: 'Einzelposten anzeigen' }).click().catch(() => {}); await p.waitForTimeout(500);
  t = (await p.locator('main').innerText()).replace(/[\u00a0\u202f]/g, ' ');
  ok('Oberfläche: Einzelposten zeigen die Dezember-Zahlung (manuell)', /Zahlung Kaltmiete 2025-12 \(manuell\)/.test(t));
  if (AUS) await p.screenshot({ path: `${AUS}/differenz-gruende.png`, fullPage: true });
  ok('Keine Fehler in der Konsole', !errs.length, errs.join(' | ').slice(0, 300));
  await b.close();
})().catch((e) => { console.log('FAIL Abbruch: ' + e.message); process.exit(1); });
