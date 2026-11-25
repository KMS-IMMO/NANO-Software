// Kosten, die in Einnahmen & Ausgaben direkt einer Einheit zugeordnet sind (Buchung oder Rechnung mit Einheit),
// müssen in der Hausgeldabrechnung und in der Nebenkostenabrechnung genau dieser Einheit belastet werden.
// Nur der nicht zugeordnete Rest wird nach dem Schlüssel (MEA, Fläche …) verteilt.
// Fehler vorher: die Zuordnung zur Einheit wurde ignoriert, die Gesamtkosten des Kontos gingen nach dem Schlüssel an alle.
const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`);
  const bild = (n) => process.env.BILDER ? p.screenshot({ path: require('path').join(process.env.BILDER, n), fullPage: true }) : null;
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const d = await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts');
    const k = (await db.select(`SELECT id FROM buchungskonten WHERE nummer = '1215'`))[0].id;
    // WEG: MEA 400 / 300 / 300
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'Direkt Testhaus', strasse: 'Gasse 1', plz: '50667', ort: 'Köln', gesamt_mea: 1000 });
    const es = [];
    for (const [nr, mea] of [['W1', 400], ['W2', 300], ['W3', 300]]) {
      const e = await insert('einheiten', { objekt_id: o, nummer: nr, flaeche: 60, mea }); es.push(e);
      const pid = await insert('personen', { rolle: 'Eigentümer', vorname: 'Eigner', nachname: nr }); await insert('eigentum', { einheit_id: e, person_id: pid, anteil: 100, von: '2020-01-01' });
    }
    // 1.000 € für das ganze Haus, 300 € nur für W2 (Buchung mit Einheit), 200 € nur für W3 (bezahlte Rechnung mit Einheit)
    await insert('buchungen', { datum: '2025-03-01', objekt_id: o, buchungskonto_id: k, betrag: -1000, text: 'Wasser Haus' });
    await insert('buchungen', { datum: '2025-04-01', objekt_id: o, buchungskonto_id: k, einheit_id: es[1], betrag: -300, text: 'Wasserzähler W2' });
    await insert('rechnungen', { objekt_id: o, einheit_id: es[2], datum: '2025-05-01', bezahlt_am: '2025-05-03', betrag: 200, buchungskonto_id: k, rechnungsnr: 'D-1' });
    // Mietverwaltung: Fläche 50 / 50, Mieter ganzjährig
    const m = await insert('objekte', { verwaltungsart: 'Mietverwaltung', name: 'Direkt Mietshaus', strasse: 'Gasse 2', plz: '50667', ort: 'Köln' });
    const ms = [];
    for (const nr of ['M1', 'M2']) {
      const e = await insert('einheiten', { objekt_id: m, nummer: nr, flaeche: 50 }); ms.push(e);
      const mid = await insert('personen', { rolle: 'Mieter', vorname: 'Mieter', nachname: nr });
      await insert('mietvertraege', { einheit_id: e, mieter_id: mid, beginn: '2024-01-01', kaltmiete: 500, nk_vorauszahlung: 100, personenzahl: 2 });
    }
    await insert('objekt_schluessel', { objekt_id: m, buchungskonto_id: k, schluessel: 'Fläche' });
    await insert('buchungen', { datum: '2025-03-01', objekt_id: m, buchungskonto_id: k, betrag: -600, text: 'Wasser Haus' });
    // Aufgeteilte Buchung wie aus dem Buchen-Fenster: 200 € auf M2 und 0 € Rest
    await insert('buchungen', { datum: '2025-06-01', objekt_id: m, buchungskonto_id: k, einheit_id: ms[1], betrag: -200, text: 'Zählertausch M2' });
    return { o, es, m, ms, k };
  });

  // Hausgeldabrechnung in der Oberfläche
  await p.goto('http://localhost:5179/#/weg-abrechnung'); await p.waitForTimeout(1500);
  await p.locator('select').filter({ has: p.locator('option', { hasText: 'Direkt Testhaus' }) }).first().selectOption({ label: 'Direkt Testhaus' }); await p.waitForTimeout(500);
  await p.locator('label:has-text("Jahr") select').first().selectOption('2025'); await p.waitForTimeout(2000);
  await bild('verteilung-direkt-weg.png');
  const zeilen = await p.locator('section.card:has(h2:text-is("Einzelabrechnungen")) tbody tr').allInnerTexts();
  const w = (nr) => (zeilen.find((z) => z.startsWith(nr)) ?? '').replace(/\s+/g, ' ');
  ok('Konto 1215 gesamt 1.500,00', (await p.locator('.abr-uebersicht tr:has(td:text-is("1215"))').first().innerText()).includes('1.500,00'));
  ok('W1: 400,00 (nur MEA-Anteil an 1.000)', /\b400,00/.test(w('W1')) && !/700,00|450,00/.test(w('W1')), w('W1'));
  ok('W2: 600,00 (300 MEA + 300 direkt)', /\b600,00/.test(w('W2')), w('W2'));
  ok('W3: 500,00 (300 MEA + 200 direkt aus der Rechnung)', /\b500,00/.test(w('W3')), w('W3'));

  // Nachrechnen mit der Logik: Hausgeld (MEA), Nebenkosten (Fläche), manuelle Verteilung hat Vorrang
  const r = await p.evaluate(async ([d]) => {
    const v = await import('/src/logic/verteilung.ts'); const nk = await import('/src/logic/nebenkosten.ts'); const { db } = await import('/src/db/index.ts');
    const sum = (erg) => erg.map((x) => Math.round(x.zeilen.reduce((a, z) => a + z.betrag, 0) * 100) / 100).join('/');
    const { einheiten, nutzer } = await v.nutzerErmitteln(d.o, 2025, 'Eigentümer');
    const pos = (await v.kostenErmitteln(d.o, 2025, false, { nurBezahlt: true })).filter((x) => x.konto_id === d.k);
    const weg = v.verteilen(2025, einheiten, nutzer, pos.map((x) => ({ ...x, schluessel: 'MEA' })), { verbrauch: {}, messdienst: {} });
    const direktW2 = weg[1].zeilen[0].direkt ?? 0;
    // Personen: Rest 1.000 nach Köpfen (je 1), direkt zugeordnete Beträge trotzdem bei der Einheit
    const pers = sum(v.verteilen(2025, einheiten, nutzer, pos.map((x) => ({ ...x, schluessel: 'Personen' })), { verbrauch: {}, messdienst: {} }));
    // Manuell (Summe): die eingetragenen Beträge gelten so, wie sie eingetragen sind
    const verbrauch = { [`${d.es[0]}-${d.k}`]: 500, [`${d.es[1]}-${d.k}`]: 500, [`${d.es[2]}-${d.k}`]: 500 };
    const man = sum(v.verteilen(2025, einheiten, nutzer, pos.map((x) => ({ ...x, schluessel: 'Summe' })), { verbrauch, messdienst: {} }));
    const n = await nk.nkBerechnen(d.m, 2025);
    const nkS = n.erg.filter((x) => x.nutzer.art === 'Mieter').map((x) => x.summe).join('/');
    const rest = v.nichtVerteilteKosten(n.positionen, n.erg).length + v.nichtVerteilteKosten(pos, weg).length;
    // Angepasster Betrag für die Abrechnung (z. B. 1.500 → 750): direkt zugeordnete Kosten im gleichen Verhältnis
    await db.execute('INSERT INTO abrechnung_betraege (objekt_id, jahr, buchungskonto_id, betrag, grund) VALUES ($1, 2025, $2, 750, $3)', [d.o, d.k, 'Test halbiert']);
    const pos2 = (await v.kostenErmitteln(d.o, 2025, false, { nurBezahlt: true })).filter((x) => x.konto_id === d.k);
    const halb = sum(v.verteilen(2025, einheiten, nutzer, pos2.map((x) => ({ ...x, schluessel: 'MEA' })), { verbrauch: {}, messdienst: {} }));
    await db.execute('DELETE FROM abrechnung_betraege WHERE objekt_id = $1', [d.o]);
    return { weg: sum(weg), direktW2, pers, man, nkS, rest, halb };
  }, [d]);
  ok('Hausgeld MEA: 400 / 600 / 500', r.weg === '400/600/500', r.weg);
  ok('Zeile weist den direkten Anteil aus (W2: 300,00)', r.direktW2 === 300, r.direktW2);
  ok('Schlüssel Personen: Rest nach Köpfen, direkte Kosten bei der Einheit', r.pers === '333.33/633.33/533.34' || r.pers === '333.34/633.33/533.33' || r.pers === '333.33/633.34/533.33', r.pers);
  ok('Manuell je Einheit hat Vorrang: 500 / 500 / 500', r.man === '500/500/500', r.man);
  ok('Nebenkosten Fläche: M1 300, M2 500 (300 + 200 direkt)', r.nkS === '300/500', r.nkS);
  ok('Nichts bleibt unverteilt', r.rest === 0, r.rest);
  ok('Angepasster Betrag 750: direkte Kosten im gleichen Verhältnis (200 / 300 / 250)', r.halb === '200/300/250', r.halb);

  // Echter Fall (Grundbesitzabgaben 1220, MEA): 254,17 € Bescheid nur für „2. OG rechts“, 4 Quartalsbeträge (3.126,61 €) für alle
  const g = await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts'); const v = await import('/src/logic/verteilung.ts');
    const k = (await db.select(`SELECT id FROM buchungskonten WHERE nummer = '1220'`))[0].id;
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'Grundbesitz Testhaus', strasse: 'Gasse 4', plz: '50667', ort: 'Köln', gesamt_mea: 1000 });
    const es = {};
    for (const [nr, mea] of [['EG', 300], ['1. OG', 250], ['2. OG links', 250], ['2. OG rechts', 200]]) {
      const e = await insert('einheiten', { objekt_id: o, nummer: nr, flaeche: 60, mea }); es[nr] = e;
      const pid = await insert('personen', { rolle: 'Eigentümer', vorname: 'Eigner', nachname: nr }); await insert('eigentum', { einheit_id: e, person_id: pid, anteil: 100, von: '2020-01-01' });
    }
    await insert('buchungen', { datum: '2025-01-22', objekt_id: o, buchungskonto_id: k, einheit_id: es['2. OG rechts'], betrag: -254.17, text: 'Grundbesitzabgabe 2. OG r' });
    for (const [dt, bt] of [['2025-02-17', 781.65], ['2025-05-15', 781.65], ['2025-08-15', 781.65], ['2025-11-17', 781.66]])
      await insert('buchungen', { datum: dt, objekt_id: o, buchungskonto_id: k, betrag: -bt, text: 'Grundbesitzabgaben Quartal' });
    const { einheiten, nutzer } = await v.nutzerErmitteln(o, 2025, 'Eigentümer');
    const pos = (await v.kostenErmitteln(o, 2025, false, { nurBezahlt: true })).filter((x) => x.konto_id === k).map((x) => ({ ...x, schluessel: 'MEA' }));
    const r = v.verteilen(2025, einheiten, nutzer, pos, { verbrauch: {}, messdienst: {} });
    return { gesamt: pos[0]?.betrag, je: r.map((x) => x.summe).join('/') };
  });
  ok('Grundbesitzabgaben gesamt 3.380,78', Math.abs(g.gesamt - 3380.78) < 0.005, g.gesamt);
  ok('3.126,61 nach MEA auf alle, 254,17 nur 2. OG rechts: 937,99 / 781,65 / 781,65 / 879,49', g.je === '937.99/781.65/781.65/879.49', g.je);

  // Nebenkostenabrechnung in der Oberfläche
  await p.goto('http://localhost:5179/#/nebenkosten'); await p.waitForTimeout(1500);
  await p.locator('select').filter({ has: p.locator('option', { hasText: 'Direkt Mietshaus' }) }).first().selectOption({ label: 'Direkt Mietshaus (Mietverwaltung)' }); await p.waitForTimeout(500);
  const js = p.locator('label:has-text("Jahr") select').first(); if (await js.count()) await js.selectOption('2025');
  await p.waitForTimeout(2000);
  await bild('verteilung-direkt-nk.png');
  const nkZeilen = (await p.locator('section.card:has(h2:text-is("Ergebnis je Mieter")) tbody tr').allInnerTexts()).map((z) => z.replace(/\s+/g, ' '));
  const m1 = nkZeilen.find((z) => /\bM1\b/.test(z)) ?? '', m2 = nkZeilen.find((z) => /\bM2\b/.test(z)) ?? '';
  ok('Nebenkostenseite: Mieter M1 300,00', m1.includes('300,00'), m1);
  ok('Nebenkostenseite: Mieter M2 500,00', m2.includes('500,00'), m2);
  ok('Keine Fehler in der Konsole', errs.length === 0, errs.slice(0, 2).join(' | '));
  await b.close();
})().catch((e) => { console.log('FEHL ' + e.message.split('\n').slice(0, 2).join(' ')); process.exit(1); });
