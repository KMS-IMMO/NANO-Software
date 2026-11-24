// Hausgeld-/Mietzahlung dem richtigen Zahler zuordnen (17.11.2026, nur Demodaten): Auswahl nur mit Eigentümern/Mietern der Liegenschaft,
// Schutz gegen eine Person aus einer anderen Liegenschaft, und Reparatur einer früher falsch gebuchten Zahlung über
// „Zahlungen ohne offenen Posten“ in der WEG-Jahresabrechnung (offene Forderung trotz Zahlung, Einnahme auf falschem Konto).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1500, height: 1000 }, locale: 'de-DE' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`);
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const r = await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts'); const soll = await import('/src/logic/soll.ts'); const bank = await import('/src/logic/bank.ts');
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'WEG Zahlertest', strasse: 'Z 4', plz: '50667', ort: 'Köln', gesamt_mea: 1000, ruecklage_anfang: 0, ruecklage_stichtag: '2024-12-31' });
    const o2 = await insert('objekte', { verwaltungsart: 'Mietverwaltung', name: 'Haus Zahlertest' });
    const e = []; for (const [n, m] of [['WE 1', 300], ['WE 2', 300], ['WE 3', 400]]) e.push(await insert('einheiten', { objekt_id: o, nummer: n, mea: m, flaeche: 70 }));
    const e2 = await insert('einheiten', { objekt_id: o2, nummer: 'W1', flaeche: 50 });
    const y = await insert('personen', { rolle: 'Eigentümer', nachname: 'Zahlmann', vorname: 'Familie', iban: 'DE0100000000000000000001' });
    const a = await insert('personen', { rolle: 'Eigentümer', nachname: 'Albers', vorname: 'Anna', iban: 'DE0100000000000000000002' });
    const c = await insert('personen', { rolle: 'Eigentümer', nachname: 'Cramer', vorname: 'Clara', iban: 'DE0100000000000000000003' });
    const y2 = await insert('personen', { rolle: 'Mieter', nachname: 'Zahlmann', vorname: 'Max' });
    await insert('mietvertraege', { einheit_id: e2, mieter_id: y2, beginn: '2024-01-01', kaltmiete: 500 });
    for (const [i, pp] of [[0, y], [1, a], [2, c]]) await insert('eigentum', { einheit_id: e[i], person_id: pp, anteil: 100, von: '2010-01-01' });
    for (const [i, bt] of [[0, 320], [1, 300], [2, 400]]) await insert('hausgeld', { einheit_id: e[i], gueltig_ab: '2025-01-01', betrag: bt, davon_ruecklage: 50 });
    const bk = await insert('bankkonten', { objekt_id: o, name: 'Hausgeldkonto Zahlertest', iban: 'DE0100000000000000000099', anfangssaldo: 1000, saldo_datum: '2024-12-31' });
    await soll.sollStellen('2025-12', { objektId: o });
    const U = [];
    for (let m = 1; m <= 12; m++) { const mm = String(m).padStart(2, '0');
      U.push({ datum: `2025-${mm}-02`, betrag: 320, verwendungszweck: 'Hausgeld Z 4', gegenpartei: 'Familie Zahlmann', gegen_iban: 'DE0100000000000000000001' });
      U.push({ datum: `2025-${mm}-03`, betrag: 300, verwendungszweck: 'Hausgeld', gegenpartei: 'Anna Albers', gegen_iban: 'DE0100000000000000000002' });
      U.push({ datum: `2025-${mm}-04`, betrag: 400, verwendungszweck: 'Hausgeld', gegenpartei: 'Clara Cramer', gegen_iban: 'DE0100000000000000000003' }); }
    await bank.importieren(bk, U);
    await bank.automatischZuordnen();
    // Ein Umsatz wird nachträglich der falschen Person (gleicher Nachname, Mieter in einer anderen Liegenschaft) zugeordnet
    const u5 = (await db.select("SELECT * FROM bankumsaetze WHERE bankkonto_id = $1 AND datum = '2025-05-02'", [bk]))[0];
    await bank.zuordnungLoesen(u5);
    let schutz = ''; try { await bank.zuordnenPerson(u5, y2); } catch (x) { schutz = x.message; }
    // So sah es vor der Korrektur aus: „Überzahlung“ ohne Einheit auf 1000 Kaltmiete
    const k1000 = (await db.select("SELECT id FROM buchungskonten WHERE nummer = '1000'"))[0].id;
    await insert('buchungen', { datum: u5.datum, betrag: 320, buchungskonto_id: k1000, objekt_id: o, bankumsatz_id: u5.id, text: 'Überzahlung / Guthaben: Familie Zahlmann' });
    await db.execute(`UPDATE bankumsaetze SET status = 'zugeordnet' WHERE id = $1`, [u5.id]);
    // Überzahlung ohne Posten bei einer Person der Liegenschaft: Einheit und Hausgeldkonto aus dem Eigentum
    const bk2 = await insert('bankkonten', { objekt_id: o, name: 'Zweitkonto Zahlertest' });
    await bank.importieren(bk2, [{ datum: '2025-06-10', betrag: 15, verwendungszweck: 'Rest', gegenpartei: 'Anna Albers', gegen_iban: '' }]);
    const u6 = (await db.select('SELECT * FROM bankumsaetze WHERE bankkonto_id = $1', [bk2]))[0];
    return { o, bk, bk2, schutz, a, u6: u6.id };
  });
  ok('Zuordnen zu einer Person aus einer anderen Liegenschaft wird abgelehnt', /weder Eigentümer noch Mieter/.test(r.schutz), r.schutz);
  // Auswahl im Bankfenster: nur Personen der Liegenschaft
  await p.goto('http://localhost:5179/#/bank'); await p.waitForTimeout(2000);
  await p.locator('select').first().selectOption(String(r.bk2)); await p.waitForTimeout(2500);
  const opts = await p.locator('td select').first().locator('option').allInnerTexts();
  ok('Auswahl „Eigentümer …“ zeigt nur Eigentümer der Liegenschaft', opts.length === 4 && opts[0] === 'Eigentümer …' && !opts.some((x) => /Max/.test(x)) && opts.some((x) => /Zahlmann, Familie · WE 1/.test(x)), opts.join(' | '));
  // WEG-Jahresabrechnung: Forderung trotz Zahlung wird erkannt und lässt sich reparieren
  await p.goto('http://localhost:5179/#/weg-abrechnung'); await p.waitForTimeout(2500);
  await p.locator('select').first().selectOption({ label: 'WEG Zahlertest' }); await p.locator('select.jahr-wahl').first().selectOption('2025'); await p.waitForTimeout(3500);
  const karte = p.locator('section:has(h2:has-text("Zahlungen ohne offenen Posten"))');
  const t1 = (await p.locator('main').innerText()).replace(/\u00a0/g, ' ');
  ok('Karte „Zahlungen ohne offenen Posten“ erscheint', await karte.count() === 1);
  ok('Grund wird genannt (ohne Einheit, falsches Konto, offener Posten)', /ohne Einheit gebucht, in der WEG auf 1000/.test(t1) && /noch Posten über 320,00 € offen/.test(t1));
  ok('Zahlung ohne Einheit fehlt nicht im Vermögensbericht (Guthaben)', /Guthaben von Eigentümern \(Überzahlungen\)\s+320,00 €/.test(t1));
  ok('Vorschlag ist der Eigentümer der Einheit', /Zahlmann, Familie · WE 1/.test(await karte.locator('select option:checked').first().innerText()));
  ok('Prüfliste nennt die Zahlung', /1 Zahlung ohne offenen Posten: 2\.5\.2025 Familie Zahlmann/.test(t1));
  await karte.getByRole('button', { name: 'Neu zuordnen' }).first().click(); await p.waitForTimeout(3500);
  const t2 = (await p.locator('main').innerText()).replace(/\u00a0/g, ' ');
  ok('Nach „Neu zuordnen“: keine offene Forderung mehr', /Offene Forderungen gegen Eigentümer\s+0,00 €/.test(t2) && /alle Forderungen ausgeglichen/.test(t2));
  ok('Nach „Neu zuordnen“: Einnahmen nur auf 1010 Hausgeld (12.240,00 €)', /1010 Hausgeld\s+12\.240,00 €/.test(t2) && !/1000 Mieteinnahmen/.test(t2));
  ok('Nach „Neu zuordnen“: kein Hausgeld-Rückstand mehr bei WE 1', /WE 1\s+Zahlmann, Familie[\s\S]*?selbst genutzt/.test(t2) && !/Rückstand[\s\S]*320,00 €\s+selbst/.test(t2));
  ok('Karte verschwindet nach der Reparatur', await karte.count() === 0);
  // Überzahlung ohne offenen Posten bei richtiger Person: Hausgeldkonto und Einheit aus dem Eigentum
  const r2 = await p.evaluate(async ({ u6, a }) => {
    const { db } = await import('/src/db/index.ts'); const bank = await import('/src/logic/bank.ts');
    await db.execute("UPDATE sollstellungen SET betrag = 0 WHERE person_id = $1", [a]);
    const u = (await db.select('SELECT * FROM bankumsaetze WHERE id = $1', [u6]))[0]; await bank.zuordnenPerson(u, a);
    return (await db.select('SELECT k.nummer, e.nummer AS einheit FROM buchungen b JOIN buchungskonten k ON k.id = b.buchungskonto_id LEFT JOIN einheiten e ON e.id = b.einheit_id WHERE b.bankumsatz_id = $1', [u6]))[0];
  }, { u6: r.u6, a: r.a });
  ok('Überzahlung ohne Posten: Hausgeld 1010 und Einheit WE 2', r2?.nummer === '1010' && r2?.einheit === 'WE 2', JSON.stringify(r2));
  ok('Keine Fehler in der Konsole', !errs.length, errs.slice(0, 3).join(' | '));
  await b.close();
})();
