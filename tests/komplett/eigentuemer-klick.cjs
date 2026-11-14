const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
// WEG-Einheitenliste: Klick auf den Eigentümer öffnet seine Seite (Daten, Hausgeld anpassen, Zahlungen, Mieter),
// Klick auf „Vermieten“ legt den Mieter an, Klick auf den Mieter öffnet den Mietvertrag (Demodaten)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'de-DE', deviceScaleFactor: 2 });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`);
  const q = (sql) => p.evaluate(async (s) => { const { db } = await import('/src/db/index.ts'); return db.select(s); }, sql);
  const jahr = new Date().getFullYear();
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const d = await p.evaluate(async (jahr) => {
    const { insert, db } = await import('/src/db/index.ts');
    const { sollStellen } = await import('/src/logic/soll.ts');
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'WEG Ahornallee', strasse: 'Ahornallee 7', plz: '50667', ort: 'Köln', objekt_nr: '9002' });
    const erika = await insert('personen', { rolle: 'Eigentümer', anrede: 'Frau', vorname: 'Erika', nachname: 'Musterfrau', telefon: '0221 000001', strasse: 'Am Hang 2', plz: '53113', ort: 'Bonn', iban: 'DE02120300000000202051' });
    const max = await insert('personen', { rolle: 'Eigentümer', anrede: 'Herr', vorname: 'Max', nachname: 'Mustermann' });
    const lena = await insert('personen', { rolle: 'Eigentümer', anrede: 'Frau', vorname: 'Lena', nachname: 'Beispiel' });
    const e1 = await insert('einheiten', { objekt_id: o, nummer: 'W1', typ: 'Wohnung', lage: 'EG', mea: 500, lfd_nr: 1, flaeche: 62 });
    const e2 = await insert('einheiten', { objekt_id: o, nummer: 'W2', typ: 'Wohnung', lage: '1. OG', mea: 500, lfd_nr: 2, flaeche: 64 });
    const e3 = await insert('einheiten', { objekt_id: o, nummer: 'W3', typ: 'Wohnung', lage: 'DG', mea: 0, lfd_nr: 3 });
    const ei1 = await insert('eigentum', { einheit_id: e1, person_id: erika, anteil: 100, von: `${jahr - 2}-01-01` });
    await insert('eigentum', { einheit_id: e2, person_id: max, anteil: 50 });
    await insert('eigentum', { einheit_id: e2, person_id: lena, anteil: 50 });
    for (const e of [e1, e2]) await insert('hausgeld', { einheit_id: e, gueltig_ab: `${jahr}-01-01`, betrag: 300, davon_ruecklage: 50 });
    await sollStellen(`${jahr}-03`, { von: `${jahr}-01`, objektId: o, nurHausgeld: true });
    // Januar und Februar von Erika bezahlt
    const ops = await db.select(`SELECT id, betrag, einheit_id FROM sollstellungen WHERE einheit_id = ${e1} AND monat IN ('${jahr}-01', '${jahr}-02') ORDER BY monat`);
    for (const s of ops) await insert('buchungen', { datum: `${s.id % 2 ? jahr + '-01-03' : jahr + '-02-03'}`, betrag: s.betrag, objekt_id: o, einheit_id: e1, sollstellung_id: s.id, text: 'Hausgeld' });
    return { o, e1, e2, e3, ei1, ops: ops.length };
  }, jahr);
  ok('Demodaten angelegt (2 bezahlte Posten)', d.ops >= 2, d.ops);
  const liste = async () => { await p.goto(`http://localhost:5179/#/objekte/${d.o}`); await p.waitForSelector('.card:has-text("Einheiten (WEG)") table.list tbody tr', { timeout: 15000 }); await p.waitForTimeout(500); };
  await liste();
  const listeBild = async (datei) => { await p.setViewportSize({ width: 2500, height: 1000 }); await p.waitForTimeout(400);
    await p.locator('.card').filter({ hasText: 'Einheiten (WEG)' }).first().screenshot({ path: AUS + '/' + datei }); await p.setViewportSize({ width: 1600, height: 1000 }); await p.waitForTimeout(300); };
  const zeile = (i) => p.locator('.card').filter({ hasText: 'Einheiten (WEG)' }).first().locator('table.list tbody tr').nth(i);
  ok('Eigentümer ist ein Knopf', await zeile(0).locator('button.rolle-chip.eigentuemer').count() === 1);
  ok('Zwei Eigentümer: zwei Knöpfe', await zeile(1).locator('button.rolle-chip.eigentuemer').count() === 2);
  ok('Ohne Eigentümer: „Eigentümer eintragen“', /Eigentümer eintragen/.test(await zeile(2).innerText()));
  ok('Nicht vermietet: „Vermieten“', await zeile(0).locator('button.klick-neu:has-text("Vermieten")').count() === 1);
  await listeBild('klick-liste-vorher.png');

  // Klick auf den Eigentümer
  await zeile(0).locator('button.rolle-chip.eigentuemer').click(); await p.waitForTimeout(1200);
  ok('Öffnet die Eigentümer-Seite (nicht „Mieter anlegen“)', p.url().endsWith(`/eigentum/${d.ei1}`) && await p.locator('.mieter-modal').count() === 0, p.url());
  const seite = async () => (await p.locator('main, .main').first().innerText()).replace(/\s+/g, ' ');
  let t = await seite();
  ok('Stammdaten sichtbar (Name, Anschrift, IBAN)', /Musterfrau/.test(t) && /Am Hang 2/.test(t) && /DE02/.test(t.replace(/ /g, '')), '');
  ok('Karte „Hausgeld anpassen“', /Hausgeld anpassen/.test(t));
  ok('Karte „Mieter der Wohnung“ mit „Wohnung vermieten“', /Mieter der Wohnung/.test(t) && await p.locator('button:has-text("Wohnung vermieten")').count() === 1);
  const posten = p.locator('.card').filter({ hasText: 'Hausgeld: gefordert und gezahlt' });
  const nPosten = await posten.locator('table.list').first().locator('tbody tr').count();
  const nSoll = (await q(`SELECT COUNT(*) n FROM sollstellungen WHERE einheit_id = ${d.e1}`))[0].n;
  ok('Posten der Wohnung gelistet', nPosten === nSoll && nSoll > 0, `${nPosten} von ${nSoll}`);
  ok('Letzte Zahlungen gelistet', /Letzte Zahlungen/.test(await posten.innerText()) && await posten.locator('table.list.kompakt tbody tr').count() === 2);
  const ganz = async (datei) => { await p.setViewportSize({ width: 1600, height: 2300 }); await p.waitForTimeout(400);
    await p.screenshot({ path: AUS + '/' + datei }); await p.setViewportSize({ width: 1600, height: 1000 }); };
  await ganz('klick-eigentuemer.png');

  // Hausgeld anpassen: Prüfung und Speichern
  const hk = p.locator('.hausgeld-anpassen');
  const feld = (l) => hk.locator(`label:has(> span:text-is("${l}")) input`);
  await feld('davon Rücklage').fill('400'); await hk.locator('button.primary').click(); await p.waitForTimeout(300);
  ok('Rücklage höher als Hausgeld wird abgelehnt', /Rücklage muss zwischen/.test(await hk.innerText()));
  await feld('Hausgeld / Monat').fill('320'); await feld('davon Rücklage').fill('60'); await p.waitForTimeout(200);
  const ab = await feld('gilt ab').inputValue();
  await hk.locator('button.primary').click(); await p.waitForTimeout(1000);
  const h = await q(`SELECT betrag, davon_ruecklage FROM hausgeld WHERE einheit_id = ${d.e1} AND gueltig_ab = '${ab}'`);
  ok('Neues Hausgeld gespeichert (ab 1. nächsten Monats)', h.length === 1 && h[0].betrag === 320 && h[0].davon_ruecklage === 60 && /-01$/.test(ab), `${ab} ${JSON.stringify(h)}`);
  t = await seite();
  ok('Meldung und Verlauf zeigen beide Stände', /Hausgeld 320,00 € \(davon Rücklage 60,00 €\) gilt ab/.test(t) && await hk.locator('table tbody tr').count() === 2);
  const alt = (await q(`SELECT COUNT(*) n FROM hausgeld WHERE einheit_id = ${d.e2}`))[0].n;
  ok('Andere Wohnungen unverändert', alt === 1, alt);

  // Wohnung vermieten (aus der Eigentümer-Seite)
  await p.locator('button:has-text("Wohnung vermieten")').click(); await p.waitForTimeout(700);
  const m = p.locator('.mieter-modal');
  ok('Fenster „Mieter anlegen“ öffnet sich', await m.count() === 1 && /Mieter anlegen: W1/.test(await m.innerText()));
  const mf = (l) => m.locator(`label:has(> span:text-is("${l}")) input`).first();
  await mf('Vorname').fill('Tom'); await mf('Nachname *').fill('Tester'); await mf('Mietbeginn *').fill(`${jahr}-04-01`);
  await mf('NK-Vorauszahlung').fill('120'); await mf('HK-Vorauszahlung').fill('30'); await mf('Kaltmiete / Monat').fill('650');
  ok('Mieter zahlt an: Eigentümer (vorbelegt)', await m.locator('label:has(> span:text-is("Mieter zahlt an")) select').inputValue() === 'Eigentümer');
  await m.screenshot({ path: AUS + '/klick-vermieten.png' });
  await m.locator('button.primary').click(); await p.waitForTimeout(1500);
  const v = (await q(`SELECT v.id, v.zahlung_an, v.nk_vorauszahlung, v.hk_vorauszahlung, p.nachname FROM mietvertraege v JOIN personen p ON p.id = v.mieter_id WHERE v.einheit_id = ${d.e1}`))[0];
  ok('Mietvertrag angelegt', v && v.nachname === 'Tester' && v.zahlung_an === 'Eigentümer' && v.nk_vorauszahlung === 120, JSON.stringify(v));
  t = await seite();
  ok('Mieter-Karte zeigt Mieter und Vorauszahlung', /Tom Tester|Tester, Tom|Tester/.test(t) && /150,00 €/.test(t) && await p.locator('button:has-text("Mietvertrag öffnen")').count() === 1);
  ok('Aufteilung nennt NK des Mieters', /NK Mieter 150,00 € · Eigentümer/.test((await hk.innerText()).replace(/\s+/g, " ")), (await hk.locator('p.small').first().innerText().catch(() => '')));
  await ganz('klick-eigentuemer-vermietet.png');

  // Zurück zur Liste: Mieter-Knopf öffnet den Vertrag, „Vermieten“ öffnet das Fenster
  await liste();
  ok('Liste: W1 vermietet mit Mieter-Knopf', await zeile(0).locator('button.rolle-chip.mieter').count() === 1 && /Vermietet/.test(await zeile(0).innerText()));
  await listeBild('klick-liste-nachher.png');
  await zeile(1).locator('button.klick-neu:has-text("Vermieten")').click(); await p.waitForTimeout(700);
  ok('„Vermieten“ in der Liste öffnet „Mieter anlegen: W2“', /Mieter anlegen: W2/.test(await p.locator('.mieter-modal').innerText().catch(() => '')));
  await p.locator('.mieter-modal button:has-text("Abbrechen")').click(); await p.waitForTimeout(600);
  await zeile(0).locator('button.rolle-chip.mieter').click(); await p.waitForTimeout(1200);
  ok('Klick auf den Mieter öffnet den Mietvertrag', p.url().endsWith(`/vertrag/${v.id}`), p.url());
  await liste();
  await zeile(1).locator('button.rolle-chip.eigentuemer').nth(1).click(); await p.waitForTimeout(1000);
  ok('Zweiter Eigentümer öffnet seine eigene Seite', /Beispiel/.test(await p.locator('h1').first().innerText()), await p.locator('h1').first().innerText());
  await liste();
  await zeile(2).locator('button.klick-neu:has-text("Eigentümer eintragen")').click(); await p.waitForTimeout(800);
  ok('„Eigentümer eintragen“ führt zu den Eigentümern', p.url().endsWith(`/objekte/${d.o}/eigentuemer`), p.url());
  ok('Keine Fehler in der Konsole', !errs.length, errs.join(' | ').slice(0, 300));
  await b.close();
})().catch((e) => { console.log('FAIL Abbruch: ' + e.message); process.exit(1); });
