const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
// Fehlende Konten aus der Prüfung vom 27.11.2026: im Kontenplan vorhanden, richtig eingestellt (EÜR, umlagefähig, Schlüssel)
// und in der Abrechnung richtig verrechnet (umlagefähige in der Nebenkostenabrechnung, alle in der Hausgeldabrechnung, Erträge mindernd).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 950 }, locale: 'de-DE' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + JSON.stringify(ist) : ''}`);
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);

  const r = await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts'); const v = await import('/src/logic/verteilung.ts');
    const k = {}; for (const x of await db.select("SELECT * FROM buchungskonten WHERE nummer IN ('1247','1248','1249','1210','1030','1031','1406','1407','1410','1411')")) k[x.nummer] = x;
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'WEG Kontentest', strasse: 'K 1', plz: '50667', ort: 'Köln', gesamt_mea: 1000 });
    const e = []; for (const [n, m, f] of [['WE 1', 400, 60], ['WE 2', 600, 90]]) e.push(await insert('einheiten', { objekt_id: o, nummer: n, mea: m, flaeche: f }));
    const betr = { 1247: -120, 1248: -80, 1249: -60, 1210: -40, 1031: 15, 1030: 100, 1406: -30, 1407: -50, 1410: -300, 1411: -190 };
    for (const [n, x] of Object.entries(betr)) await insert('buchungen', { datum: '2025-06-01', betrag: x, buchungskonto_id: k[n].id, objekt_id: o, text: 'Kontentest ' + n });
    const umlag = await v.kostenErmitteln(o, 2025, true); const alle = await v.kostenErmitteln(o, 2025, false);
    const m = (l) => Object.fromEntries(l.map((x) => [x.nummer, x.betrag]));
    return { k: Object.fromEntries(Object.entries(k).map(([n, x]) => [n, { art: x.art, euer: x.euer, uml: x.umlagefaehig, s: x.schluessel, mwst: x.mwst }])), umlag: m(umlag), alle: m(alle) };
  });
  const soll = ['1247', '1248', '1249', '1210', '1030', '1031', '1406', '1407', '1410', '1411'];
  ok('Alle 10 neuen Konten im Kontenplan', soll.every((n) => r.k[n]), Object.keys(r.k));
  ok('Kabel-TV, Schädlingsbekämpfung, Legionellen, Rauchwarnmelder: umlagefähig, EÜR, 19 %', ['1247', '1248', '1249', '1210'].every((n) => r.k[n].uml === 1 && r.k[n].euer === 1 && r.k[n].art === 'Aufwand' && r.k[n].mwst === 19));
  ok('Kabel-TV, Legionellen, Rauchwarnmelder nach Einheiten, Schädlingsbekämpfung nach Fläche', r.k['1247'].s === 'Einheiten' && r.k['1249'].s === 'Einheiten' && r.k['1210'].s === 'Einheiten' && r.k['1248'].s === 'Fläche');
  ok('Erträge der Gemeinschaft und Bankzinsen: Ertrag nach MEA, nicht umlagefähig', ['1030', '1031'].every((n) => r.k[n].art === 'Ertrag' && r.k[n].s === 'MEA' && r.k[n].uml === 0 && r.k[n].euer === 1));
  ok('Porto/Büro, Versammlung, Hausgeld an WEG, Umsatzsteuer: Ausgabe, nicht umlagefähig', ['1406', '1407', '1410', '1411'].every((n) => r.k[n].art === 'Aufwand' && r.k[n].uml === 0 && r.k[n].euer === 1));
  ok('Nebenkostenabrechnung: nur die umlagefähigen neuen Konten', JSON.stringify(Object.keys(r.umlag).sort()) === JSON.stringify(['1210', '1247', '1248', '1249']), r.umlag);
  ok('Nebenkostenabrechnung: Beträge richtig (120, 80, 60, 40)', r.umlag['1247'] === 120 && r.umlag['1248'] === 80 && r.umlag['1249'] === 60 && r.umlag['1210'] === 40, r.umlag);
  ok('Hausgeldabrechnung: alle neuen Konten als Kosten bzw. Ertrag', soll.every((n) => n in r.alle), r.alle);
  ok('Erträge mindern die Kosten (1030 −100, 1031 −15)', r.alle['1030'] === -100 && r.alle['1031'] === -15, r.alle);
  const summe = Object.values(r.alle).reduce((a, x) => a + x, 0);
  ok('Summe der Hausgeldabrechnung stimmt (755 €)', Math.abs(summe - 755) < 0.005, summe);

  await p.goto('http://localhost:5179/#/konten'); await p.waitForTimeout(2000);
  const txt = await p.locator('body').innerText();
  ok('Kontenplan zeigt die neuen Konten', ['Kabel-TV', 'Schädlingsbekämpfung', 'Legionellenprüfung', 'Rauchwarnmelder', 'Bankzinsen Girokonto', 'Porto und Bürokosten', 'Hausgeld an die WEG'].every((t) => txt.includes(t)));
  ok('Keine Fehler in der Konsole', errs.length === 0, errs.slice(0, 3));
  await b.close();
})().catch((e) => { console.log('FAIL Abbruch ' + e.message); process.exit(1); });
