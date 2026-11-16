// KI-Agent (lokal über Ollama, hier mit nachgestellten Antworten) und Kontoabgleich zur Jahresabrechnung (16.11.2026, nur Demodaten):
// Anfangs- und Endbestand, Kontostand laut Auszug, offene und abweichend gebuchte Umsätze, Monate ohne Umsätze,
// Prüfliste beim Abschluss, Abrechnungsprüfung, Werkzeuge des Agenten und das Gesprächsfenster.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/11434/.test(m.text()) && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`);
  // Ollama nachstellen: erst ruft das Modell das Werkzeug „kontoabgleich“ auf, dann antwortet es
  const anfragen = [];
  await p.route('http://127.0.0.1:11434/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/api/tags')) return route.fulfill({ json: { models: [{ name: 'qwen3:14b' }] } });
    const body = JSON.parse(route.request().postData() || '{}'); anfragen.push(body);
    const letzte = body.messages[body.messages.length - 1];
    if (letzte.role === 'tool') return route.fulfill({ json: { message: { role: 'assistant', content: 'Der Anfangsbestand lag bei 2.000,00 €, am Jahresende stehen 2.400,00 € auf dem Konto. Ein Umsatz über 100,00 € ist noch nicht gebucht.' } } });
    const o = Number(/objekt (\d+)/.exec(letzte.content)?.[1] ?? 0);
    return route.fulfill({ json: { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'kontoabgleich', arguments: { objekt_id: o, jahr: 2025 } } }] } } });
  });
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const r = await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts'); const bank = await import('/src/logic/bank.ts');
    const KA = await import('/src/logic/kontoabgleich.ts'); const AB = await import('/src/logic/abschluss.ts');
    const AP = await import('/src/logic/abrechnungPruefen.ts'); const KI = await import('/src/logic/kiAgent.ts'); const SP = await import('/src/logic/sprache.ts');
    const k = async (n) => (await db.select('SELECT id FROM buchungskonten WHERE nummer = $1', [n]))[0]?.id;
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'WEG KI-Abgleich', strasse: 'Abgleichweg 3', plz: '50667', ort: 'Köln', gesamt_mea: 1000 });
    const bk = await insert('bankkonten', { objekt_id: o, name: 'Konto Abgleich', iban: 'DE12370501980000777777', anfangssaldo: 2000, saldo_datum: '2024-12-31' });
    await bank.importieren(bk, [
      { datum: '2025-02-03', betrag: 500, verwendungszweck: 'Hausgeld', gegenpartei: 'Eigentümer A', gegen_iban: '' },
      { datum: '2025-03-10', betrag: -200, verwendungszweck: 'Versicherung', gegenpartei: 'Versicherung AG', gegen_iban: '' },
      { datum: '2025-04-15', betrag: 100, verwendungszweck: 'unbekannt', gegenpartei: 'Herr X', gegen_iban: '' },
      { datum: '2025-04-20', betrag: -5, verwendungszweck: 'Kontoführung', gegenpartei: 'Bank', gegen_iban: '' },
    ]);
    const u = async (betrag) => (await db.select('SELECT * FROM bankumsaetze WHERE bankkonto_id = $1 AND betrag = $2', [bk, betrag]))[0];
    await bank.zuordnenKonto(await u(500), await k('1010'));
    await bank.zuordnenKonto(await u(-200), await k('1250'));
    await db.execute(`UPDATE bankumsaetze SET status = 'ignoriert' WHERE id = $1`, [(await u(-5)).id]);
    const a1 = (await KA.kontoabgleich(o, 2025))[0];
    const p1 = KA.abgleichPruefungen([a1], 2025);
    await KA.auszugSpeichern(bk, 2025, 2350);
    const a2 = (await KA.kontoabgleich(o, 2025))[0];
    const p2 = KA.abgleichPruefungen([a2], 2025);
    await KA.auszugSpeichern(bk, 2025, 2395);
    // Teil einer Buchung geändert: Umsatz 500, gebucht nur 450
    await db.execute('UPDATE buchungen SET betrag = 450 WHERE bankumsatz_id = $1', [(await u(500)).id]);
    const a3 = (await KA.kontoabgleich(o, 2025))[0];
    const p3 = await AB.pruefen(o, 2025, 'WEG');
    await db.execute('UPDATE buchungen SET betrag = 500 WHERE bankumsatz_id = $1', [(await u(500)).id]);
    const pr = await AP.abrechnungPruefen(o, 2025);
    const u0 = { navigieren: () => {}, bestaetigen: async () => false };
    const such = await KI.werkzeug('suchen', { text: 'KI-Abgleich' }, u0);
    const wka = await KI.werkzeug('kontoabgleich', { objekt_id: o, jahr: 2025 }, u0);
    const wap = await KI.werkzeug('abrechnung_pruefen', { objekt_id: o, jahr: 2025 }, u0);
    const wohne = await KI.werkzeug('abrechnung_pruefen', {}, u0);
    const wein = await KI.werkzeug('sql_abfrage', { sql: "SELECT wert FROM einstellungen WHERE schluessel = 'ki_api_key'" }, u0);
    const wschema = await KI.werkzeug('schema_lesen', {}, u0);
    const ein = await KI.kiEinstellungen();
    // Lokaler Durchlauf mit nachgestelltem Ollama
    const antwort = await KI.kiFragen(KI.neuerVerlauf(), `Wie sieht der Kontoabgleich 2025 aus? objekt ${o}`, '/', u0, { gesprochen: true });
    return { o, a1, p1, a2, p2, a3, p3, pr, such, wka, wap, wohne, wein, wschema: wschema.text.slice(0, 2000), ein, antwort,
      sprech: SP.sprechText('**Ergebnis:** 1.234,56 € für WE 3, z. B. § 35a\n| a | b |\n- Punkt') };
  });
  const a1 = r.a1;
  ok('Stand 01.01. aus Anfangssaldo (2.000 €)', a1.start === 2000, a1.start);
  ok('Eingänge 600 €, Ausgänge −205 €, Stand 31.12. 2.395 €', a1.ein === 600 && a1.aus === -205 && a1.ende === 2395, `${a1.ein} / ${a1.aus} / ${a1.ende}`);
  ok('4 Umsätze: 2 gebucht, 1 ignoriert, 1 offen über 100 €', a1.anzahl === 4 && a1.gebucht === 2 && a1.ignoriert === 1 && a1.offen.length === 1 && a1.offenSumme === 100, JSON.stringify([a1.anzahl, a1.gebucht, a1.ignoriert, a1.offenSumme]));
  ok('Monate ohne Umsätze erkannt (Januar, Mai …)', a1.monateOhne.includes('Januar') && a1.monateOhne.includes('Mai') && !a1.monateOhne.includes('Februar'), a1.monateOhne.join(','));
  ok('Ohne Kontoauszug: Hinweis, sperrt nicht', r.p1.some((x) => /abgeglichen/.test(x.text) && !x.ok && !x.sperrt), JSON.stringify(r.p1.map((x) => x.text)));
  ok('Auszug 2.350 € gegen errechnet 2.395 €: Differenz −45 € sperrt den Abschluss', r.a2.differenz === -45 && r.p2.some((x) => /stimmt mit dem Kontoauszug/.test(x.text) && !x.ok && x.sperrt), r.a2.differenz);
  ok('Buchung 450 statt 500 € wird als abweichend gemeldet', r.a3.abweichend.length === 1 && r.a3.abweichend[0].gebucht === 450, JSON.stringify(r.a3.abweichend));
  ok('Prüfliste beim Abschluss enthält Abgleich und sperrt bei Abweichung', r.p3.some((x) => /Gebuchte Beträge stimmen/.test(x.text) && !x.ok && x.sperrt), JSON.stringify(r.p3.filter((x) => !x.ok).map((x) => x.text)));
  ok('Abrechnungsprüfung liefert Befunde und Kontoabgleich', r.pr.befunde.length > 3 && /Stand 01\.01\.2025/.test(r.pr.kontoabgleich) && r.pr.befunde.some((x) => x.stufe === 'rot'), r.pr.befunde.length);
  ok('Abrechnungsprüfung meldet offenen Umsatz', r.pr.befunde.some((x) => /Bankumsätze/.test(x.text) && x.stufe === 'rot'));
  ok('Werkzeug „suchen“ findet die Liegenschaft', JSON.parse(r.such.text).objekte.some((x) => x.id === r.o));
  ok('Werkzeug „kontoabgleich“ nennt Anfangs- und Endbestand', /Stand 01\.01\.2025 2\.000,00 €.*Stand 31\.12\.2025 2\.395,00 €/.test(r.wka.text) && /stimmt mit dem Kontoauszug/i.test(r.wka.text), r.wka.text.split('\n')[0]);
  ok('Werkzeug „abrechnung_pruefen“ liefert Text mit PROBLEM/OK', /\[PROBLEM\]/.test(r.wap.text) && /\[OK\]/.test(r.wap.text));
  ok('Werkzeug ohne Objekt/Jahr meldet Fehler statt zu raten', r.wohne.fehler === true);
  ok('Einstellungen (API-Schlüssel) sind für den Agenten gesperrt', r.wein.fehler === true);
  ok('Schema kompakt mit Spaltennamen', /bankumsaetze\(id, bankkonto_id, datum/.test(r.wschema), r.wschema.slice(0, 120));
  ok('Standard ist lokal (Ollama, ohne API)', r.ein.anbieter === 'lokal' && r.ein.lokalUrl === 'http://127.0.0.1:11434');
  ok('Lokaler Agent: Werkzeugaufruf und Antwort', /Anfangsbestand lag bei 2\.000,00/.test(r.antwort.antwort) && anfragen.length === 2, r.antwort.antwort.slice(0, 80));
  ok('Lokaler Agent: Werkzeugergebnis geht ans Modell zurück', anfragen[1]?.messages.some((m) => m.role === 'tool' && m.tool_name === 'kontoabgleich' && /Stand 01\.01\.2025/.test(m.content)));
  ok('Lokaler Agent: gesprochen im Kontext, Denken aus', /Gesprochen: ja/.test(anfragen[0]?.messages[1]?.content ?? '') && anfragen[0]?.think === false && anfragen[0]?.tools.length >= 10);
  ok('Vorlesetext ohne Tabellen und Zeichen', r.sprech === 'Ergebnis: 1.234,56 Euro für Wohnung 3, zum Beispiel Paragraf 35a Punkt', r.sprech);

  // Oberfläche: Karte „Kontoabgleich“ in der Hausgeldabrechnung
  await p.goto('http://localhost:5179/#/weg-abrechnung'); await p.waitForTimeout(2500);
  await p.locator('select').first().selectOption({ label: 'WEG KI-Abgleich' }); await p.locator('input[type=number]').first().fill('2025'); await p.waitForTimeout(3000);
  let t = await p.locator('body').innerText();
  ok('Karte Kontoabgleich mit Anfangs- und Endbestand', /Kontoabgleich 2025/.test(t) && /Konto Abgleich\s+2\.000,00\s*€\s+600,00\s*€\s+-205,00\s*€\s+2\.395,00/.test(t), (t.match(/Konto Abgleich[^\n]*/) || [''])[0]);
  ok('Zweite Prüfung zeigt offenen Umsatz', /1 noch nicht gebucht \(100,00\s*€\)/.test(t));
  const feld = p.getByLabel('Kontostand laut Kontoauszug Konto Abgleich');
  ok('Eingetragener Auszug wird angezeigt und stimmt', (await feld.inputValue()) === '2.395,00' && /stimmt/.test(t), await feld.inputValue());
  await feld.fill('2.390,00'); await feld.press('Enter'); await p.waitForTimeout(1500);
  t = await p.locator('body').innerText();
  ok('Abweichender Auszug: Differenz und rote Zeile in der Prüfliste', /Differenz -5,00\s*€/.test(t) && /Endbestand 31\.12\.2025 stimmt mit dem Kontoauszug überein/.test(t));
  await feld.fill('2395'); await feld.press('Enter'); await p.waitForTimeout(1200);
  await p.screenshot({ path: (process.env.NEOSS_TEST_AUSGABE || '.') + '/kontoabgleich.png', fullPage: true });

  // Gesprächsfenster
  await p.locator('.ki-fab').click(); await p.waitForTimeout(800);
  t = await p.locator('.ki-panel').innerText();
  ok('KI-Fenster: lokal auf diesem Mac, Mikrofon und Gesprächsmodus', /lokal auf diesem Mac/.test(t) && /Gesprächsmodus/.test(t) && await p.locator('.ki-mic').count() === 1 && /nichts geht ins Internet/.test(t));
  await p.locator('.ki-eingabe textarea').fill(`Kontoabgleich bitte, objekt ${r.o}`); await p.locator('.ki-eingabe textarea').press('Enter');
  await p.waitForTimeout(2500);
  ok('KI-Fenster zeigt die Antwort', /Anfangsbestand lag bei 2\.000,00/.test(await p.locator('.ki-panel').innerText()));
  await p.screenshot({ path: (process.env.NEOSS_TEST_AUSGABE || '.') + '/ki-agent.png' });
  // Einstellungen
  await p.goto('http://localhost:5179/#/einstellungen'); await p.waitForTimeout(2000);
  await p.getByRole('button', { name: 'Erneut prüfen' }).click(); await p.waitForTimeout(800);
  t = await p.locator('body').innerText();
  ok('Einstellungen: KI-Agent lokal empfohlen, Ollama erkannt', /Lokal auf diesem Mac \(empfohlen\)/.test(t) && /Ollama läuft/.test(t));
  ok('Keine Fehler in der Konsole', !errs.length, errs.slice(0, 3).join(' | '));
  await b.close();
})().catch((e) => { console.log('FAIL Abbruch ' + e.message); process.exit(1); });
