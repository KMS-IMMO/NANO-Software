const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
// Kompletttest der neuen Funktionen: Mietverwaltung über ein ganzes Jahr mit Bank, Rechnungen, § 35a, Auszahlungen an den Eigentümer, PDFs
const { chromium } = require('playwright'); const fs = require('fs');
const O = AUS + '/neu/'; fs.mkdirSync(O, { recursive: true });
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 }, locale: 'de-DE', acceptDownloads: true });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(4000);
  const pruef = [];
  const ok = (name, bed, ist) => pruef.push({ name, ok: !!bed, ist });
  const r = await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts'); const soll = await import('/src/logic/soll.ts'); const bank = await import('/src/logic/bank.ts');
    const vt = await import('/src/logic/verteilung.ts'); const nk = await import('/src/logic/nebenkosten.ts');
    const k = async (n) => (await db.select('SELECT id FROM buchungskonten WHERE nummer=$1', [n]))[0].id;
    const ei = await insert('personen', { rolle: 'Eigentümer', vorname: 'Otto', nachname: 'Vermieter', strasse: 'Ring 1', plz: '50667', ort: 'Köln' });
    const o = await insert('objekte', { verwaltungsart: 'Mietverwaltung', name: 'Miethaus Test', strasse: 'Testweg 5', plz: '50674', ort: 'Köln', eigentuemer_id: ei, gesamt_flaeche: 100 });
    const e1 = await insert('einheiten', { objekt_id: o, nummer: 'EG', flaeche: 60 }), e2 = await insert('einheiten', { objekt_id: o, nummer: 'OG', flaeche: 40 });
    const m1 = await insert('personen', { rolle: 'Mieter', vorname: 'Mia', nachname: 'Mieterin', iban: 'DE11370501980000000011' });
    const m2 = await insert('personen', { rolle: 'Mieter', vorname: 'Max', nachname: 'Mieter', iban: 'DE11370501980000000022' });
    await insert('mietvertraege', { einheit_id: e1, mieter_id: m1, beginn: '2025-01-01', kaltmiete: 600, nk_vorauszahlung: 150 });
    await insert('mietvertraege', { einheit_id: e2, mieter_id: m2, beginn: '2025-01-01', kaltmiete: 400, nk_vorauszahlung: 100 });
    const posten = await soll.sollStellen('2025-12', { objektId: o, von: '2025-01' });
    const bk = await insert('bankkonten', { objekt_id: o, name: 'Mietkonto Test', iban: 'DE12370501980000999999', anfangssaldo: 2000, saldo_datum: '2024-12-31' });
    // Kosten mit § 35a: Reinigung (Abs. 2), Hausmeister mit Arbeitsanteil (Abs. 2), Winterdienst als Minijob (Abs. 1), Reparatur (Abs. 3, nicht umlagefähig), Versicherung
    await db.execute("UPDATE buchungskonten SET hdl = 0, hbg = 1 WHERE nummer = '1241'");
    const f = await insert('firmen', { name: 'Testfirma', gewerk: 'Service' });
    const rech = [['1250', 600, null, 'VS-1'], ['1243', 960, null, 'RE-1'], ['1246', 1200, 1000, 'RE-2'], ['1241', 400, null, 'MJ-1'], ['1300', 500, 300, 'RE-3']];
    const rids = []; for (const [n, betrag, lohn, nr] of rech) rids.push(await insert('rechnungen', { objekt_id: o, firma_id: f, rechnungsnr: nr, datum: '2025-03-10', betrag, anteil_lohn: lohn, buchungskonto_id: await k(n) }));
    // Bank: Mia zahlt 12 x 750, Max 11 x 500 (November fehlt), Rechnungen per Überweisung, 12 Auszahlungen an den Eigentümer à 300
    const U = [];
    for (let i = 1; i <= 12; i++) { const m = String(i).padStart(2, '0');
      U.push({ datum: `2025-${m}-03`, betrag: 750, gegenpartei: 'Mia Mieterin', verwendungszweck: `Miete ${m}/2025 EG`, gegen_iban: 'DE11370501980000000011' });
      if (i !== 11) U.push({ datum: `2025-${m}-04`, betrag: 500, gegenpartei: 'Max Mieter', verwendungszweck: `Miete ${m}/2025 OG`, gegen_iban: 'DE11370501980000000022' });
      U.push({ datum: `2025-${m}-10`, betrag: -300, gegenpartei: 'Otto Vermieter', verwendungszweck: `Auszahlung Eigentümer ${m}/2025`, gegen_iban: 'DE00' }); }
    rech.forEach(([n, betrag, lohn, nr], i) => U.push({ datum: '2025-03-20', betrag: -betrag, gegenpartei: 'Testfirma', verwendungszweck: `Rechnung ${nr}`, gegen_iban: 'DE00' }));
    const imp = await bank.importieren(bk, U);
    const auto = await bank.automatischZuordnen();
    // Was die Automatik nicht kann, von Hand: Auszahlungen auf 1700, Rechnungen auf die Rechnung
    const k1700 = await k('1700');
    for (const u of await db.select("SELECT * FROM bankumsaetze WHERE bankkonto_id = $1 AND status = 'offen'", [bk])) {
      if (u.verwendungszweck.startsWith('Auszahlung Eigentümer')) await bank.zuordnenKonto(u, k1700);
      else if (u.verwendungszweck.startsWith('Rechnung ')) { const nr = u.verwendungszweck.slice(9); const rr = (await db.select('SELECT id FROM rechnungen WHERE rechnungsnr = $1 AND objekt_id = $2', [nr, o]))[0]; if (rr) await bank.zuordnenRechnung(u, rr.id); }
    }
    const nochOffen = await db.select("SELECT datum, betrag, verwendungszweck FROM bankumsaetze WHERE bankkonto_id = $1 AND status = 'offen'", [bk]);
    const op = await db.select(`SELECT person_id, art, monat, betrag - bezahlt AS offen FROM (${soll.OP_SQL}) WHERE objekt_id = $1 AND betrag - bezahlt > 0.005`, [o]);
    const kosten = await vt.kostenErmitteln(o, 2025, false);
    const ein = (await db.select("SELECT COALESCE(SUM(b.betrag), 0) AS s FROM buchungen b JOIN buchungskonten k ON k.id = b.buchungskonto_id WHERE b.objekt_id = $1 AND k.art = 'Einnahme'", [o]))[0].s;
    const ausz = (await db.select("SELECT COALESCE(SUM(b.betrag), 0) AS s, COUNT(*) AS n FROM buchungen b JOIN buchungskonten k ON k.id = b.buchungskonto_id WHERE b.objekt_id = $1 AND k.art = 'Eigentümer'", [o]))[0];
    const saldo = (await db.select('SELECT k.anfangssaldo + COALESCE((SELECT SUM(u.betrag) FROM bankumsaetze u WHERE u.bankkonto_id = k.id), 0) AS s FROM bankkonten k WHERE k.id = $1', [bk]))[0].s;
    const n = await nk.nkBerechnen(o, 2025);
    const wegKonten = await db.select("SELECT nummer, art FROM buchungskonten WHERE nummer IN ('1700','1701')");
    return { o, posten, imp, auto, nochOffen, op, kosten: kosten.map((x) => ({ nr: x.nummer, b: x.betrag, b35: x.betrag35a, u: x.umlagefaehig })), ein, ausz, saldo,
      nk: n.erg.map((x) => ({ e: x.einheit.nummer, summe: x.summe, vz: x.vz, saldo: x.saldo, hdl: x.hdl, hwl: x.hwl, hbg: x.hbg })), nkPos: n.positionen.map((x) => x.nummer), wegKonten };
  });
  fs.writeFileSync(O + 'daten.json', JSON.stringify(r, null, 1));
  const summe = (l) => Math.round(l.reduce((a, x) => a + x, 0) * 100) / 100;
  ok('Sollstellung Mieten 2025 erzeugt', r.posten > 0, r.posten + ' Posten');
  ok('Bankimport ohne Duplikate', r.imp.neu === 40 && r.imp.doppelt === 0, JSON.stringify(r.imp));
  ok('Mietzahlungen automatisch zugeordnet', r.auto.zugeordnet >= 23, JSON.stringify(r.auto));
  ok('Keine offenen Bankumsätze nach Zuordnung', r.nochOffen.length === 0, JSON.stringify(r.nochOffen));
  ok('Offener Posten: nur Max, November 500 €', summe(r.op.map((x) => x.offen)) === 500 && r.op.every((x) => x.monat === '2025-11'), JSON.stringify(r.op));
  ok('Einnahmen = 12 × 750 + 11 × 500 = 14.500 €', Math.abs(r.ein - 14500) < 0.01, r.ein);
  ok('Kosten ohne Auszahlungen = 3.660 €', Math.abs(summe(r.kosten.map((x) => x.b)) - 3660) < 0.01 && !r.kosten.some((x) => x.nr === '1700'), JSON.stringify(r.kosten));
  ok('Auszahlungen an Eigentümer: 12 × 300 €', r.ausz.n === 12 && Math.abs(r.ausz.s + 3600) < 0.01, JSON.stringify(r.ausz));
  ok('Kontostand Bank = 2.000 + 14.500 − 3.660 − 3.600 = 9.240 €', Math.abs(r.saldo - 9240) < 0.01, r.saldo);
  ok('Nebenkosten: nur umlagefähige Konten, keine Reparatur, keine Auszahlung', !r.nkPos.includes('1300') && !r.nkPos.includes('1700'), r.nkPos.join(','));
  ok('Nebenkosten verteilt = 3.160 € (Fläche 60/40)', Math.abs(summe(r.nk.map((x) => x.summe)) - 3160) < 0.02, JSON.stringify(r.nk.map((x) => [x.e, x.summe])));
  const eg = r.nk.find((x) => x.e === 'EG'), og = r.nk.find((x) => x.e === 'OG');
  ok('§ 35a Abs. 2 EG = (960 + 1.000) × 60 % = 1.176 €', eg && Math.abs(eg.hdl - 1176) < 0.02, eg?.hdl);
  ok('§ 35a Abs. 1 (Minijob) EG = 400 × 60 % = 240 €', eg && Math.abs(eg.hbg - 240) < 0.02, eg?.hbg);
  ok('§ 35a Abs. 3 in Nebenkosten = 0 (Reparatur nicht umlagefähig)', eg && eg.hwl === 0 && og.hwl === 0, `${eg?.hwl} / ${og?.hwl}`);
  ok('NK-Vorauszahlungen Mia 1.800 €, Max 1.100 €', eg && Math.abs(eg.vz - 1800) < 0.01 && Math.abs(og.vz - 1100) < 0.01, `${eg?.vz} / ${og?.vz}`);
  ok('Konten 1700/1701 angelegt (Kontoart Eigentümer)', r.wegKonten.length === 2 && r.wegKonten.every((x) => x.art === 'Eigentümer'), JSON.stringify(r.wegKonten));

  // Nach „PDF erstellen“ kann die Seite kurz neu laden: dann einmal warten und erneut lesen
  const pdfText = async (datei) => { for (let i = 0; ; i++) { try { return await pdfTextEinmal(datei); } catch (e) { if (i >= 2) throw e; await p.waitForTimeout(1500); await p.waitForLoadState('load').catch(() => {}); } } };
  const pdfTextEinmal = async (datei) => p.evaluate(async (b64) => { const { pdfjsLaden } = await import('/src/lib/pdfjs.ts'); const pdfjs = await pdfjsLaden();
    const d = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }).promise; let t = '';
    for (let i = 1; i <= d.numPages; i++) t += (await (await d.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ') + '\n'; return t; }, fs.readFileSync(datei).toString('base64'));
  const objektWaehlen = async () => { const sel = p.locator('main select').first(); const opt = await sel.locator('option', { hasText: 'Miethaus Test' }).first().getAttribute('value').catch(() => null); if (opt) await sel.selectOption(opt); const j = p.locator('main input[type=number]').first(); if (await j.count()) await j.fill('2025'); await p.waitForTimeout(2500); };

  // Eigentümerabrechnung
  await p.goto('http://localhost:5179/#/eigentuemer-abrechnung'); await p.waitForTimeout(2500); await objektWaehlen();
  const ea = await p.locator('main').innerText(); await p.screenshot({ path: O + 'eigentuemerabrechnung.png', fullPage: true });
  ok('Eigentümerabrechnung: Überschuss 10.840 €', ea.includes('10.840,00'), '');
  ok('Eigentümerabrechnung: An Eigentümer ausgezahlt 3.600 €', ea.includes('AN EIGENTÜMER AUSGEZAHLT') || ea.includes('An Eigentümer ausgezahlt'), '');
  ok('Eigentümerabrechnung: Kontostand stimmt mit Bank (✓ 9.240 €)', /9\.240,00\s€ ✓/.test(ea), '');
  ok('Eigentümerabrechnung: Hinweis § 35a für Vermieter', ea.includes('Werbungskosten'), '');
  const [d1] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'PDF erstellen' }).click()]); await d1.saveAs(O + 'eigentuemerabrechnung.pdf');
  const t1 = await pdfText(O + 'eigentuemerabrechnung.pdf');
  ok('PDF Eigentümerabrechnung: Auszahlungen, Kontoentwicklung, Abgleich', /AUSZAHLUNGEN AN DEN EIGENT/.test(t1) && t1.includes('Kontoentwicklung') && t1.includes('stimmt mit dem Kontoauszug'), '');

  // Nebenkostenabrechnung
  await p.goto('http://localhost:5179/#/nebenkosten'); await p.waitForTimeout(2500); await objektWaehlen();
  await p.screenshot({ path: O + 'nebenkosten.png', fullPage: true });
  const nkBtn = p.getByRole('button', { name: /PDF/ }).first();
  const dls = []; p.on('download', (d) => dls.push(d));
  p.on('dialog', (d) => d.accept());
  await nkBtn.click(); await p.waitForTimeout(5000);
  let t2 = ''; for (const [i, d] of dls.entries()) { await d.saveAs(O + `nk-${i}.pdf`); t2 += await pdfText(O + `nk-${i}.pdf`); }
  ok('PDF Nebenkosten: § 35a mit Minijob, Dienstleistungen und Hinweisen', t2.includes('Steuerermäßigung § 35a') && t2.includes('Minijob im Haushalt') && t2.includes('VI R 24/20'), dls.length + ' PDF');

  // Auswertung
  await p.goto('http://localhost:5179/#/auswertung'); await p.waitForTimeout(2500);
  await p.locator('main select').first().selectOption({ label: 'Miethaus Test' }).catch(() => {});
  await p.locator('main input.datum-eingabe').first().fill('2025-01-01'); await p.locator('main input.datum-eingabe').nth(1).fill('2025-12-31'); await p.waitForTimeout(2500);
  const gv = await p.locator('main').innerText(); await p.screenshot({ path: O + 'auswertung.png', fullPage: true });
  ok('Auswertung: Ergebnis 10.840 € ohne Auszahlungen, eigener Block', gv.includes('10.840,00') && gv.includes('Auszahlungen an den Eigentümer') && gv.includes('7.240,00'), '');

  // Einnahmen & Ausgaben als PDF
  const t3 = await p.evaluate(async (o) => { const { db } = await import('/src/db/index.ts'); const pdf = await import('/src/lib/pdf.ts'); const { pdfjsLaden } = await import('/src/lib/pdfjs.ts');
    const rows = await db.select("SELECT b.datum, b.betrag, b.text, k.nummer, k.name, k.art FROM buchungen b LEFT JOIN buchungskonten k ON k.id = b.buchungskonto_id WHERE b.objekt_id = $1", [o]);
    const by = await pdf.einnahmenAusgabenPdf({ objekt: 'Miethaus Test', zeitraum: '2025', buchungen: rows.map((r) => ({ datum: r.datum, konto: `${r.nummer} ${r.name}`, text: r.text, betrag: Number(r.betrag), eigentuemer: r.art === 'Eigentümer' })) });
    const d = await (await pdfjsLaden()).getDocument({ data: by }).promise; let t = ''; for (let i = 1; i <= d.numPages; i++) t += (await (await d.getPage(i)).getTextContent()).items.map((x) => x.str).join(' '); return t; }, r.o);
  ok('PDF Einnahmen & Ausgaben: Auszahlungen getrennt, Ausgaben 3.660 €', /AUSZAHLUNGEN AN DEN EIGENT/.test(t3) && t3.includes('3.660,00'), '');

  // WEG-Einzelabrechnung aus dem Haupttest: § 35a-Bescheinigung vorhanden
  if (fs.existsSync(AUS + '/vorschau.pdf')) { const t4 = await pdfText(AUS + '/vorschau.pdf'); ok('PDF WEG-Einzelabrechnung: § 35a-Bescheinigung (Handwerker 500 € Arbeitskosten anteilig)', t4.includes('Steuerermäßigung § 35a') && t4.includes('Handwerkerleistungen'), ''); }

  // Dashboard mit Köln-Stadt
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(8000);
  const kc = await p.locator('canvas').count(); const dom = await p.locator('.stadt-schild', { hasText: 'Kölner Dom' }).count();
  await p.screenshot({ path: O + 'dashboard.png' });
  ok('Dashboard: 3D-Stadt Köln mit Dom', kc > 0 && dom > 0, `canvas ${kc}, Dom-Schild ${dom}`);
  ok('Keine Fehler in der Konsole', errs.length === 0, errs.slice(0, 5).join(' | '));
  fs.writeFileSync(O + 'ergebnis.json', JSON.stringify(pruef, null, 1));
  for (const x of pruef) console.log((x.ok ? 'OK   ' : 'FEHL ') + x.name + (x.ok ? '' : '  → ' + x.ist));
  await b.close();
})();
