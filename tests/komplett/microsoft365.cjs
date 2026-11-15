const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
// Kommunikation mit Microsoft 365 (Beispiel-Postfach der Vorschau, nur Demodaten):
// Postfach wie Outlook mit freigegebenen Postfächern, Lesen, Akte, Antworten, Löschen, Neue Mail mit Vorlage,
// Antworten automatisch zur Akte, Textvorlagen, Postfächer verwalten, Kalender-Abgleich, Mahnung und Dokument als E-Mail
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'de-DE', deviceScaleFactor: 1 });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined && !c ? ' → ' + ist : ''}`);
  const q = (sql, par = []) => p.evaluate(async ([s, x]) => { const { db } = await import('/src/db/index.ts'); return db.select(s, x); }, [sql, par]);
  const warte = (ms) => p.waitForTimeout(ms);
  try {
    await p.goto('http://localhost:5179/#/'); await warte(3500);

    // Seitenleiste
    const nav = await p.locator('.nav-abschnitt').filter({ hasText: 'Kommunikation' }).innerText();
    ok('Seitenleiste: Abschnitt Kommunikation mit Postfach, Textvorlagen, Microsoft 365', /Postfach/.test(nav) && /Textvorlagen/.test(nav) && /Microsoft 365/.test(nav), nav);
    await warte(1500);
    const zahl = await p.locator('.nav-zahl').first().innerText().catch(() => '');
    ok('Seitenleiste: Zahl der ungelesenen Mails am Postfach', Number(zahl) >= 3, zahl);

    // Postfach
    await p.goto('http://localhost:5179/#/postfach'); await warte(2500);
    const ordner = await p.locator('.ol-ordner .ol-f').allInnerTexts();
    const namen = ordner.map((t) => t.replace(/\d+$/, '').trim());
    ok('Ordner wie in Outlook in der richtigen Reihenfolge', namen.slice(0, 7).join('|') === 'Posteingang|Entwürfe|Gesendete Elemente|Postausgang|Gelöschte Elemente|Junk-E-Mail|Archiv', namen.join('|'));
    const konten = await p.locator('.ol-konto').allInnerTexts();
    ok('Freigegebene Postfächer stehen links (5 Stück)', konten.length === 6 && konten.some((k) => /info@kms\.koeln/i.test(k)) && konten.some((k) => /ablesung@kms\.koeln/i.test(k)), konten.join(' | '));
    const liste1 = await p.locator('.ol-m').count();
    await p.click('.ol-reiter button:has-text("Sonstige")'); await warte(300);
    const sonstige = await p.locator('.ol-m').allInnerTexts();
    ok('Relevant und Sonstige getrennt', liste1 >= 3 && sonstige.length === 1 && /Newsletter/.test(sonstige[0]), `${liste1} / ${sonstige.length}`);
    await p.click('.ol-reiter button:has-text("Relevant")'); await warte(300);

    // Mail lesen und zur Akte
    await p.click('.ol-m:has-text("Ahmet Yilmaz")'); await warte(900);
    const lesen = await p.locator('.ol-lesen').innerText();
    ok('Mail wird im Lesebereich angezeigt', /Frage zur Hausgeldabrechnung/.test(lesen) && /Position Hausmeister/.test(lesen), lesen.slice(0, 200));
    ok('Absender wird der Akte zugeordnet (Eigentümer)', /Gehört zu:\s*Ahmet Yilmaz\s*·\s*Eigentümer/.test(lesen), lesen.slice(0, 300));
    const gelesen = await p.locator('.ol-m.an.neu').count();
    ok('Geöffnete Mail gilt als gelesen', gelesen === 0);
    await p.click('.ol-neoss button:has-text("In Akte ablegen")'); await warte(600);
    let akte = await q(`SELECT * FROM mails WHERE person_id = 1`);
    ok('Mail liegt in der Akte (Eigentümer, Richtung ein)', akte.length === 1 && akte[0].richtung === 'ein' && /Position Hausmeister/.test(akte[0].text) && akte[0].objekt_id, JSON.stringify(akte));
    ok('Liste zeigt „in der Akte“', await p.locator('.ol-m.an .ol-akte').count() === 1);

    // Antworten
    await p.click('.ol-aktionen button:has-text("Antworten") >> nth=0'); await warte(700);
    ok('Antwortfenster mit Empfänger', (await p.inputValue('.mail-felder label:has-text("An") input')).includes('yilmaz@example.de'));
    await p.fill('.mail-text', 'Guten Tag Herr Yilmaz,\n\ndie Kosten sind gestiegen, weil der Vertrag neu verhandelt wurde.\n\nViele Grüße');
    await p.click('.mail-fenster button:has-text("Senden")'); await warte(1200);
    akte = await q(`SELECT * FROM mails WHERE person_id = 1 ORDER BY id`);
    ok('Antwort gesendet und in der Akte (Richtung aus)', akte.length === 2 && akte[1].richtung === 'aus' && /neu verhandelt/.test(akte[1].text), JSON.stringify(akte.map((a) => a.richtung)));
    await p.click('.ol-f:has-text("Gesendete Elemente")'); await warte(900);
    ok('Antwort steht in „Gesendete Elemente“', await p.locator('.ol-m:has-text("AW: Frage zur Hausgeldabrechnung")').count() === 1);

    // Löschen verschiebt nach „Gelöschte Elemente“
    await p.click('.ol-f:has-text("Posteingang") >> nth=0'); await warte(900);
    await p.click('.ol-m:has-text("Maria Wagner")'); await warte(700);
    await p.click('.ol-aktionen button:has-text("Löschen")'); await p.click('.ol-frage button.danger'); await warte(800);
    ok('Gelöschte Mail ist aus dem Posteingang', await p.locator('.ol-m:has-text("Maria Wagner")').count() === 0);
    await p.click('.ol-f:has-text("Gelöschte Elemente")'); await warte(800);
    ok('… und liegt in „Gelöschte Elemente“', await p.locator('.ol-m:has-text("Maria Wagner")').count() === 1);

    // Anhang als Ausgabe erfassen öffnet das Erfassen-Fenster
    await p.click('.ol-f:has-text("Posteingang") >> nth=0'); await warte(800);
    await p.click('.ol-m:has-text("Sanitär")'); await warte(900);
    ok('Anhang wird angezeigt (Rechnung als PDF)', await p.locator('.ol-anh .mail-datei:has-text("Rechnung-2026-0815.pdf")').count() === 1);
    const lieferant = await p.locator('.ol-neoss').innerText();
    ok('Dienstleister wird erkannt', /Sanitär Özdemir GmbH/.test(lieferant), lieferant);
    await p.click('.ol-anh button:has-text("Als Ausgabe erfassen")'); await warte(1500);
    ok('„Als Ausgabe erfassen“ öffnet das Erfassen-Fenster', await p.locator('.modal.breit:has-text("Rechnung aus der Mail erfassen")').count() === 1);
    await p.keyboard.press('Escape'); await warte(300);
    if (await p.locator('.modal.breit').count()) await p.mouse.click(5, 5);
    await warte(300);

    // Freigegebenes Postfach aufklappen
    await p.click('.ol-konto:has-text("Service")'); await warte(1000);
    const svc = await p.locator('.ol-ordner').innerText();
    ok('Freigegebenes Postfach zeigt eigene Ordner', (svc.match(/Posteingang/g) ?? []).length >= 2);
    await p.locator('.ol-f:has-text("Posteingang")').nth(1).click(); await warte(900);
    ok('Mails im freigegebenen Postfach', await p.locator('.ol-m:has-text("Anfrage an service")').count() === 1);

    // Neue E-Mail mit Vorlage an eine Mieterin
    await p.click('button:has-text("Neue E-Mail")'); await warte(700);
    await p.selectOption('.mail-felder label:has-text("Von") select', 'me');
    await p.fill('.mail-felder label:has-text("An") input', 'Anna Schmidt <schmidt@example.de>');
    await p.selectOption('.mail-felder label:has-text("Vorlage") select', 'Allgemeiner Brief'); await warte(900);
    const txt = await p.inputValue('.mail-text');
    ok('Vorlage wird eingesetzt (Sachbearbeiter ausgefüllt)', /Muster Verwalter/.test(txt) && /KMS Immobilienverwaltung/.test(txt), txt);
    ok('Empfängerin wird der Akte zugeordnet', /In der Akte von\s*Anna Schmidt/.test(await p.locator('.mail-fuss').innerText()));
    await p.fill('.mail-felder label:has-text("Betreff") input', 'Termin für den Handwerker');
    await p.fill('.mail-text', 'Sehr geehrte Frau Schmidt,\n\nder Handwerker kommt am Dienstag um 9 Uhr.\n\nMit freundlichen Grüßen');
    await p.click('.mail-fenster button:has-text("Senden")'); await warte(1200);
    const schmidt = await q(`SELECT * FROM mails WHERE person_id = 2`);
    ok('Neue Mail in der Akte der Mieterin', schmidt.length === 1 && schmidt[0].betreff === 'Termin für den Handwerker' && schmidt[0].conversation_id, JSON.stringify(schmidt));

    // Antwort der Mieterin wird automatisch abgelegt
    await p.evaluate(async (c) => { const m = await import('/src/logic/ms365Demo.ts'); m.demoAntwort('me', c, ['Anna Schmidt', 'schmidt@example.de'], 'AW: Termin für den Handwerker', 'Dienstag passt, danke!'); }, schmidt[0].conversation_id);
    await p.click('.ol-konto:has-text("Muster Verwalter")'); await warte(300);
    await p.click('.ol-konto:has-text("Muster Verwalter")'); await warte(1200);
    await p.locator('.ol-f:has-text("Posteingang")').first().click(); await warte(1500);
    const auto = await q(`SELECT * FROM mails WHERE person_id = 2 ORDER BY id`);
    ok('Antwort automatisch zur Akte gelegt', auto.length === 2 && auto[1].richtung === 'ein' && /Dienstag passt/.test(auto[1].text), JSON.stringify(auto.map((a) => a.betreff)));

    // Schriftverkehr in der Akte der Person
    await p.goto('http://localhost:5179/#/mieter'); await warte(1500);
    await p.click('tr:has-text("Schmidt")'); await warte(800);
    const sv = await p.locator('.schriftverkehr').innerText().catch(() => '');
    ok('Akte der Mieterin zeigt den Schriftverkehr', /Schriftverkehr \(2\)/.test(sv) && /Termin für den Handwerker/.test(sv), sv.slice(0, 200));
    await p.keyboard.press('Escape'); await warte(300);

    // Textvorlagen
    await p.goto('http://localhost:5179/#/textvorlagen'); await warte(1200);
    ok('Textvorlagen: sechs Vorlagen', await p.locator('.tv-liste button:not(.tv-neu)').count() === 6);
    await p.click('.tv-liste button:has-text("Nebenkostenabrechnung")');
    await p.fill('#tv-betreff', 'Ihre Nebenkostenabrechnung {Jahr}');
    await p.click('button:has-text("Speichern")'); await warte(600);
    const v = await q(`SELECT betreff FROM mail_vorlagen WHERE name = 'Nebenkostenabrechnung'`);
    ok('Textvorlage gespeichert', v[0]?.betreff === 'Ihre Nebenkostenabrechnung {Jahr}', JSON.stringify(v));

    // Microsoft 365: Postfächer verwalten
    await p.goto('http://localhost:5179/#/microsoft-365'); await warte(1500);
    ok('Konto verbunden (Beispielkonto)', /Verbunden/.test(await p.locator('.ms-raster').innerText()));
    await p.fill('#ms-neue-box', 'test@example.de'); await p.click('button:has-text("Postfach hinzufügen")'); await warte(800);
    let boxen = JSON.parse((await q(`SELECT wert FROM einstellungen WHERE schluessel = 'ms_postfaecher'`))[0].wert);
    ok('Freigegebenes Postfach hinzugefügt', boxen.length === 6 && boxen.includes('test@example.de'), JSON.stringify(boxen));
    await p.click('.ms-box:has-text("test@example.de") button'); await warte(500);
    boxen = JSON.parse((await q(`SELECT wert FROM einstellungen WHERE schluessel = 'ms_postfaecher'`))[0].wert);
    ok('… und wieder entfernt', boxen.length === 5);

    // Kalender-Abgleich: neu, geändert, gelöscht
    const heute = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
    await p.evaluate(async (d) => { const { db } = await import('/src/db/index.ts'); await db.execute(`INSERT INTO termine (titel, datum, uhrzeit, art) VALUES ('Begehung Treppenhaus (Test)', $1, '10:00', 'Handwerker')`, [d]); }, heute);
    await p.click('button:has-text("Kalender jetzt abgleichen")'); await warte(1500);
    const tid = (await q(`SELECT id FROM termine WHERE titel = 'Begehung Treppenhaus (Test)'`))[0].id;
    let ot = await q(`SELECT * FROM outlook_termine WHERE quelle = 'termin' AND quelle_id = $1`, [tid]);
    ok('Termin steht im Outlook-Kalender', ot.length === 1 && /"subject":"Begehung Treppenhaus \(Test\)"/.test(ot[0].stand) && /T10:00:00/.test(ot[0].stand) && /T11:00:00/.test(ot[0].stand), JSON.stringify(ot));
    const info1 = await p.locator('.info').first().innerText();
    ok('Meldung nach dem Abgleich', /Kalender abgeglichen: \d+ neu/.test(info1), info1);
    await p.evaluate(async (id) => { const { db } = await import('/src/db/index.ts'); await db.execute(`UPDATE termine SET uhrzeit = '14:30' WHERE id = $1`, [id]); }, tid);
    let r = await p.evaluate(async () => { const m = await import('/src/logic/ms365.ts'); return m.kalenderAbgleich(); });
    ot = await q(`SELECT * FROM outlook_termine WHERE quelle = 'termin' AND quelle_id = $1`, [tid]);
    ok('Geänderte Uhrzeit wird übertragen', r.geaendert >= 1 && /T14:30:00/.test(ot[0].stand), JSON.stringify(r));
    r = await p.evaluate(async () => { const m = await import('/src/logic/ms365.ts'); return m.kalenderAbgleich(); });
    ok('Ohne Änderung wird nichts übertragen', r.neu === 0 && r.geaendert === 0 && r.geloescht === 0, JSON.stringify(r));
    await p.evaluate(async (id) => { const { db } = await import('/src/db/index.ts'); await db.execute(`DELETE FROM termine WHERE id = $1`, [id]); }, tid);
    r = await p.evaluate(async () => { const m = await import('/src/logic/ms365.ts'); return m.kalenderAbgleich(); });
    ot = await q(`SELECT * FROM outlook_termine WHERE quelle = 'termin' AND quelle_id = $1`, [tid]);
    ok('Gelöschter Termin verschwindet auch aus Outlook', r.geloescht >= 1 && ot.length === 0, JSON.stringify(r));
    await p.evaluate(async (d) => { const { db } = await import('/src/db/index.ts'); await db.execute(`INSERT INTO fristen (titel, faellig) VALUES ('Rauchmelder prüfen (Test)', $1)`, [d]); }, heute);
    await p.evaluate(async () => { const m = await import('/src/logic/ms365.ts'); return m.kalenderAbgleich(); });
    const fr = await q(`SELECT o.stand FROM outlook_termine o JOIN fristen f ON f.id = o.quelle_id WHERE o.quelle = 'frist' AND f.titel = 'Rauchmelder prüfen (Test)'`);
    ok('Frist als ganztägiger Termin mit Erinnerung eine Woche vorher', fr.length === 1 && /"isAllDay":true/.test(fr[0].stand) && /"reminderMinutesBeforeStart":10080/.test(fr[0].stand), JSON.stringify(fr));

    // Mahnung als E-Mail
    await p.evaluate(async () => { const { db } = await import('/src/db/index.ts'); await db.execute(`INSERT INTO mahnungen (objekt_id, einheit_id, person_id, schuldner, stufe, datum, frist, betrag, gebuehr, posten) VALUES (1, 1, 2, 'Anna Schmidt', 2, date('now'), date('now', '+14 days'), 812.5, 5, '')`); });
    await p.goto('http://localhost:5179/#/mahnungen'); await warte(1800);
    await p.click('button:has-text("Als E-Mail") >> nth=0'); await warte(1200);
    const mt = await p.inputValue('.mail-text'), mb = await p.inputValue('.mail-felder label:has-text("Betreff") input'), man = await p.inputValue('.mail-felder label:has-text("An") input');
    ok('Mahnung als E-Mail: Vorlage mit Betrag, Stufe und Anrede', /Sehr geehrte Frau Schmidt/.test(mt) && /817,50/.test(mt) && /1\. Mahnung/.test(mt) && /^1\. Mahnung: Lindenstraße 12/.test(mb) && /schmidt@example\.de/.test(man), `${mb} | ${mt.slice(0, 160)}`);
    await p.click('.mail-fenster button:has-text("Abbrechen")'); await warte(300);

    // Dokument als E-Mail (Dateimanager)
    await p.evaluate(async () => {
      const { speichern } = await import('/src/lib/dateien.ts');
      const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {};
      await speichern(new TextEncoder().encode('%PDF-1.1 Test'), 'Nebenkostenabrechnung 2025 Schmidt.pdf', { bezug: 'Person', bezugId: 2, ordner: ['Personen', 'Anna Schmidt'] });
      HTMLAnchorElement.prototype.click = orig;
    });
    await p.goto('http://localhost:5179/#/ablage'); await warte(1500);
    await p.click('.seg button:has-text("Person")'); await warte(800);
    const sel = p.locator('select').filter({ hasText: 'Schmidt' }).first();
    if (await sel.count()) { const wert = await sel.locator('option', { hasText: 'Schmidt' }).first().getAttribute('value'); await sel.selectOption(wert); await warte(800); }
    if (await p.locator('.seg button:has-text("Liste")').count()) { await p.click('.seg button:has-text("Liste")'); await warte(500); }
    const knopf = p.locator('button:has-text("Als E-Mail")').first();
    if (await knopf.count()) {
      await knopf.click(); await warte(1200);
      const dt = await p.inputValue('.mail-felder label:has-text("Betreff") input').catch(() => '');
      const anh = await p.locator('.mail-anhaenge').innerText().catch(() => '');
      ok('Dokument als E-Mail: Vorlage nach Dateiname und PDF im Anhang', /Nebenkostenabrechnung 2025/.test(dt) && /Nebenkostenabrechnung 2025 Schmidt\.pdf/.test(anh), `${dt} | ${anh}`);
      await p.click('.mail-fenster button:has-text("Abbrechen")');
    } else ok('Dokument als E-Mail: Knopf in der Dateiliste', false, 'Knopf nicht gefunden');

    // Nicht verbunden: Postfach zeigt den Weg zur Anmeldung
    await p.evaluate(async () => { const m = await import('/src/logic/ms365.ts'); await m.abmelden(); });
    await p.goto('http://localhost:5179/#/postfach'); await warte(1200);
    ok('Ohne Verbindung: Hinweis mit Weg zur Anmeldung', /Noch nicht mit Microsoft 365 verbunden/.test(await p.locator('main, .main, body').first().innerText()));
    await p.evaluate(async () => { const m = await import('/src/logic/ms365.ts'); await m.anmelden('', ''); });

    // Dunkel: Postfach ohne Fehler
    await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dunkel'));
    await p.goto('http://localhost:5179/#/postfach'); await warte(2000);
    await p.click('.ol-m >> nth=0'); await warte(800);
    await p.screenshot({ path: require('path').join(AUS, 'microsoft365-postfach-dunkel.png') });
    await p.evaluate(() => document.documentElement.removeAttribute('data-theme'));
    await p.goto('http://localhost:5179/#/postfach'); await warte(2000);
    await p.click('.ol-m >> nth=0'); await warte(800);
    await p.screenshot({ path: require('path').join(AUS, 'microsoft365-postfach.png') });

    const echt = errs.filter((e) => !/favicon|ResizeObserver/.test(e));
    ok('Keine Fehler in der Konsole', echt.length === 0, JSON.stringify(echt.slice(0, 5)));
  } catch (e) {
    console.log('FEHL Abbruch: ' + (e?.message ?? e).split('\n')[0]);
  }
  await b.close();
})();
