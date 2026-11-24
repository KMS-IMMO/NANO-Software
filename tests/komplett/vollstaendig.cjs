// Ergänzungen für den Echtbetrieb (16.11.2026, nur Demodaten):
// Systemkonten geschützt, Änderungsprotokoll, Abschluss aufheben nur mit Begründung, Heizkosten nur verbrauchsabhängig,
// qualifizierte Mehrheit und Allstimmigkeit, Einnahmen und Kontenentwicklung in der Gesamtabrechnung, Mahngebühren-Hinweis.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`);
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const r = await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts'); const bank = await import('/src/logic/bank.ts');
    const AB = await import('/src/logic/abschluss.ts'); const NK = await import('/src/logic/nebenkosten.ts'); const VS = await import('/src/logic/versammlung.ts');
    const fehler = async (f) => { try { await f(); return null; } catch (e) { return String(e?.message ?? e); } };
    const k = async (n) => (await db.select('SELECT id FROM buchungskonten WHERE nummer = $1', [n]))[0]?.id;
    // 1. Systemkonto: Nummer gesperrt, Bezeichnung frei
    const kontoNr = await fehler(() => db.execute(`UPDATE buchungskonten SET nummer = '9010' WHERE nummer = '1010'`));
    const kontoName = await fehler(() => db.execute(`UPDATE buchungskonten SET name = name WHERE nummer = '1010'`));
    // 2. Protokoll
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'WEG Vollhaus', strasse: 'Vollweg 1', plz: '50667', ort: 'Köln', gesamt_mea: 1000, gesamt_flaeche: 300 });
    const bu = await insert('buchungen', { datum: '2025-04-01', betrag: -321, buchungskonto_id: await k('1250'), objekt_id: o, text: 'Protokolltest' });
    await db.execute('UPDATE buchungen SET betrag = -322 WHERE id = $1', [bu]);
    await db.execute('DELETE FROM buchungen WHERE id = $1', [bu]);
    const prot = (await db.select(`SELECT aktion FROM protokoll WHERE tabelle = 'buchungen' AND datensatz = $1 ORDER BY id`, [bu])).map((x) => x.aktion).join(',');
    // 3. Abschluss aufheben nur mit Grund
    await AB.abschliessen(o, 2025, 'WEG', {});
    const ohneGrund = await fehler(() => AB.abschlussAufheben(o, 2025, 'WEG', ''));
    await AB.abschlussAufheben(o, 2025, 'WEG', 'Rechnung nachgereicht');
    const abr = (await db.select(`SELECT status, aufhebung_grund FROM abrechnungen WHERE objekt_id = $1`, [o]))[0];
    const protAbr = Number((await db.select(`SELECT COUNT(*) AS n FROM protokoll WHERE tabelle = 'abrechnungen' AND inhalt LIKE '%Rechnung nachgereicht%'`))[0].n);
    // 4. Heizkosten
    const hk = await k('1200');
    const pos = (s) => [{ nummer: '1200', konto_id: hk, schluessel: s, betrag: 5000 }];
    const heiz = [NK.heizkostenOhneMessung(pos('MEA'), new Set()), NK.heizkostenOhneMessung(pos('Messdienst'), new Set()), NK.heizkostenOhneMessung(pos('Fläche'), new Set([hk]))];
    // 5. Mehrheiten: 4 Eigentümer, 3 anwesend
    const tn = [{ id: 1, status: 'Anwesend', mea: 300 }, { id: 2, status: 'Anwesend', mea: 150 }, { id: 3, status: 'Anwesend', mea: 100 }, { id: 4, status: 'Abwesend', mea: 450 }];
    const vs = (mehrheit, stimmen) => ({ v: { zaehlung: 'Kopf', gesamt_mea: 1000 }, tops: [{ id: 9, mehrheit }], teilnehmer: tn, stimmen: stimmen.map(([t, s]) => ({ top_id: 9, teilnehmer_id: t, stimme: s })), beschluesse: [] });
    const dreiJa = [[1, 'Ja'], [2, 'Ja'], [3, 'Ja']];
    const m = {
      einfach: VS.ergebnis(9, vs('einfach', [[1, 'Ja'], [2, 'Ja'], [3, 'Nein']])).angenommen,
      qualiMeaFehlt: VS.ergebnis(9, vs('qualifiziert', dreiJa)).angenommen,            // 3/3 Köpfe, aber nur 550 von 1000 MEA → angenommen (550 > 500)
      qualiKnapp: VS.ergebnis(9, vs('qualifiziert', [[1, 'Ja'], [2, 'Ja'], [3, 'Nein']])).angenommen, // 2/3 genau, nicht mehr als 2/3
      qualiMea: VS.ergebnis(9, vs('qualifiziert', [[1, 'Ja'], [3, 'Ja']])).angenommen,   // 2/2 Köpfe, 400 MEA → nicht über die Hälfte
      allstimmig: VS.ergebnis(9, vs('allstimmig', dreiJa)).angenommen,                  // Nr. 4 fehlt
    };
    // 6. Einnahmen und Kontenentwicklung: Bankkonto mit Saldo und Umsätzen
    const bk = await insert('bankkonten', { objekt_id: o, name: 'Konto Vollhaus', iban: 'DE12370501980000888888', anfangssaldo: 1000, saldo_datum: '2024-12-31' });
    await bank.importieren(bk, [
      { datum: '2024-12-31', betrag: 50, verwendungszweck: 'vor Saldo', gegenpartei: 'X', gegen_iban: '' },
      { datum: '2025-02-01', betrag: 800, verwendungszweck: 'Hausgeld', gegenpartei: 'P Eins', gegen_iban: '' },
      { datum: '2025-03-01', betrag: -300, verwendungszweck: 'Versicherung', gegenpartei: 'Vers', gegen_iban: '' },
    ]);
    const u = (await db.select(`SELECT * FROM bankumsaetze WHERE bankkonto_id = $1 AND betrag = 800`, [bk]))[0];
    await bank.zuordnenKonto(u, await k('1010'));
    return { kontoNr, kontoName, prot, ohneGrund, abr, protAbr, heiz, m };
  });
  ok('Systemkonto-Nummer lässt sich nicht ändern', /nutzt NEOSS fest/.test(r.kontoNr ?? ''), r.kontoNr);
  ok('Systemkonto-Bezeichnung bleibt änderbar', r.kontoName === null, r.kontoName);
  ok('Änderungsprotokoll: neu, geändert, gelöscht', r.prot === 'neu,geändert,gelöscht', r.prot);
  ok('Abschluss aufheben ohne Begründung abgelehnt', /begründen/.test(r.ohneGrund ?? ''), r.ohneGrund);
  ok('Begründung am Abschluss und im Protokoll', r.abr?.status === 'Aufgehoben' && r.abr?.aufhebung_grund === 'Rechnung nachgereicht' && r.protAbr >= 1, JSON.stringify(r.abr));
  ok('Heizkosten nach MEA sperren, Messdienst und bewusst gewählter Schlüssel nicht', r.heiz.join() === 'true,false,false', r.heiz.join());
  ok('Einfache Mehrheit 2:1 angenommen', r.m.einfach === true);
  ok('Qualifiziert: 3 von 3 Stimmen und 550 von 1000 MEA angenommen', r.m.qualiMeaFehlt === true);
  ok('Qualifiziert: genau 2/3 reicht nicht', r.m.qualiKnapp === false);
  ok('Qualifiziert: nur 400 von 1000 MEA reicht nicht', r.m.qualiMea === false);
  ok('Allstimmig: abwesender Eigentümer fehlt → abgelehnt', r.m.allstimmig === false);
  // Oberfläche: Gesamtabrechnung mit Einnahmen und Kontenentwicklung
  await p.goto('http://localhost:5179/#/weg-abrechnung'); await p.waitForTimeout(2500);
  await p.locator('select').first().selectOption({ label: 'WEG Vollhaus' }); await p.locator('select.jahr-wahl').first().selectOption('2025'); await p.waitForTimeout(3000);
  const t = await p.locator('body').innerText();
  ok('Einnahmen 2025 aus Zahlungseingängen (800,00 €)', /Summe Einnahmen 2025\s+800,00/.test(t));
  ok('Kontenentwicklung 1.000 + 800 − 300 = 1.500 (Umsatz am Saldotag zählt nicht doppelt)', /Konto Vollhaus\s+1\.000,00\s*€\s+800,00\s*€\s+-300,00\s*€\s+1\.500,00/.test(t), (t.match(/Konto Vollhaus[^\n]*/) || [''])[0]);
  // Änderungsprotokoll-Seite
  await p.goto('http://localhost:5179/#/protokoll'); await p.waitForTimeout(2000);
  const tp = await p.locator('body').innerText();
  ok('Seite Änderungsprotokoll zeigt den gelöschten Datensatz', /Änderungsprotokoll/.test(tp) && /gelöscht/.test(tp));
  // Mahnungen: Hinweis zu Gebühren
  await p.goto('http://localhost:5179/#/mahnungen'); await p.waitForTimeout(1500);
  ok('Mahnungen nennen die Grenze für Mieter-Mahngebühren', /höchstens 2,50 €/.test(await p.locator('body').innerText()));
  ok('Keine Fehler in der Konsole', !errs.length, errs.join(' | ').slice(0, 300));
  await b.close();
})().catch((e) => { console.log('FEHL ' + (e?.message ?? e)); process.exit(1); });
