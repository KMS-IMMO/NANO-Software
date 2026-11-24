const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
const { chromium } = require('playwright'); const O = AUS + '/';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2, locale: 'de-DE' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const res = []; const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`);
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const ids = await p.evaluate(async () => {
    const { insert } = await import('/src/db/index.ts');
    const ei = await insert('personen', { rolle: 'Eigentümer', vorname: 'Otto', nachname: 'Vermieter', plz: '50667', ort: 'Köln' });
    const o = await insert('objekte', { verwaltungsart: 'Mietverwaltung', name: 'Demohaus Lindenweg', strasse: 'Lindenweg 3', plz: '50931', ort: 'Köln', eigentuemer_id: ei });
    const e = await insert('einheiten', { objekt_id: o, nummer: 'EG links', flaeche: 62 });
    await insert('personen', { rolle: 'Mieter', vorname: 'Erika', nachname: 'Muster', iban: 'DE89370400440532013000' });
    return { o, e };
  });
  // Mietvertrag neu
  await p.goto('http://localhost:5179/#/vertraege'); await p.waitForTimeout(1500);
  await p.click('button.primary:has-text("Neu")'); await p.waitForTimeout(500);
  const m = p.locator('.modal');
  const wert = async (lbl) => m.locator(`label:has(> span:text-is("${lbl}")) select, label:has(> span:text-is("${lbl}")) input`).first().inputValue();
  ok('Vorbelegung Mietart Standard', await wert('Mietart') === 'Standard');
  ok('Vorbelegung Fällig am 3', await wert('Fällig am (Tag im Monat)') === '3');
  ok('Vorbelegung Beginn 1. nächster Monat', /^01\.\d{2}\.\d{4}$/.test(await wert('Beginn *')), await wert('Beginn *'));
  ok('Index-Felder versteckt', await m.locator('text=Index-Basiswert').count() === 0);
  await m.locator('label:has(> span:text-is("Mietart")) select').selectOption('Indexmiete'); await p.waitForTimeout(200);
  ok('Index-Felder bei Indexmiete da', await m.locator('text=Index-Basiswert').count() === 1);
  await m.locator('label:has(> span:text-is("Kaltmiete (Start)")) input').fill('600');
  await m.locator('label:has(> span:text-is("Kaution")) input').fill('2000'); await p.waitForTimeout(200);
  ok('Kaution-Hinweis § 551', (await m.locator('.feld-hinweis:has-text("551")').count()) === 1);
  await m.screenshot({ path: O + 'vertrag-index-kaution.png' });
  // + Neu Mieter
  await m.locator('label:has(> span:text-is("Mieter *")) button:has-text("+ Neu")').click(); await p.waitForTimeout(300);
  const pn = m.locator('.person-neu');
  await pn.locator('input[placeholder="Vorname"]').fill('Erika'); await pn.locator('input[placeholder="Nachname"]').fill('Muster');
  await pn.locator('input[placeholder^="IBAN"]').fill('DE89 3704 0044 0532 0130 01');
  await pn.locator('button:has-text("Anlegen")').click(); await p.waitForTimeout(400);
  ok('IBAN-Fehler bei Zahlendreher', await pn.locator('.feld-fehler:has-text("Prüfziffer")').count() === 1);
  await pn.locator('input[placeholder^="IBAN"]').fill('');
  await pn.locator('button:has-text("Anlegen")').click(); await p.waitForTimeout(400);
  ok('Doppelte Person erkannt', await pn.locator('.feld-hinweis:has-text("schon einen Kontakt")').count() === 1);
  await m.screenshot({ path: O + 'vertrag-neue-person.png' });
  await pn.locator('input[placeholder="Vorname"]').fill('Jonas'); await pn.locator('input[placeholder="Nachname"]').fill('Beispiel');
  await pn.locator('input[placeholder^="IBAN"]').fill('DE07 3704 0044 0000 7770 01');
  await pn.locator('button:has-text("Anlegen")').click(); await p.waitForTimeout(500);
  await m.screenshot({ path: O + "dbg.png" }); const sel = await m.locator('label:has(> span:text-is("Mieter *")) select').first().evaluate((s) => s.options[s.selectedIndex].text);
  ok('Neuer Mieter angelegt und ausgewählt', sel === 'Beispiel, Jonas', sel);
  { const s = m.locator('label:has(> span:text-is("Einheit *")) select'); const v = await s.evaluate((el) => [...el.options].find((o) => o.value && !o.text.includes('Lindenweg')).value); await s.selectOption(v); }
  await m.locator('label:has(> span:text-is("Kaution")) input').fill('1800');
  await m.locator('button:has-text("Speichern")').click(); await p.waitForTimeout(800); if (await m.count()) { console.log('MODAL', await m.locator('p.error, p.warn').allInnerTexts()); }
  const v = await p.evaluate(async () => { const { db } = await import('/src/db/index.ts'); return (await db.select("SELECT v.*, p.iban FROM mietvertraege v JOIN personen p ON p.id = v.mieter_id WHERE p.nachname = 'Beispiel'"))[0]; });
  ok('Vertrag gespeichert mit Standards', v && v.faellig_tag === 3 && v.mietart === 'Indexmiete' && v.zahlung_an === 'Verwaltung' && v.iban === 'DE07370400440000777001', JSON.stringify(v && { t: v.faellig_tag, a: v.mietart, z: v.zahlung_an, iban: v.iban }));
  // Personen: PLZ → Ort, IBAN blockiert
  await p.goto('http://localhost:5179/#/personen'); await p.waitForTimeout(1200);
  await p.click('.card-head button.primary >> nth=0'); await p.waitForTimeout(400);
  await m.locator('label:has(> span:text-is("Rolle *")) select').selectOption('Mieter');
  await m.locator('label:has(> span:text-is("Nachname")) input').fill('Neumann');
  await m.locator('label:has(> span:text-is("PLZ")) input').fill('50931'); await p.waitForTimeout(500);
  ok('PLZ → Ort aus eigenen Daten', await wert('Ort') === 'Köln', await wert('Ort'));
  await m.locator('label:has(> span:text-is("PLZ")) input').fill('5093'); await p.waitForTimeout(200);
  ok('PLZ-Hinweis bei 4 Ziffern', await m.locator('.feld-hinweis:has-text("fünf Ziffern")').count() === 1);
  await m.locator('label:has(> span:text-is("PLZ")) input').fill('50931');
  await m.locator('label:has(> span:text-is("IBAN")) input').fill('DE89370400440532013001');
  await m.locator('button:has-text("Speichern")').click(); await p.waitForTimeout(400);
  ok('Speichern mit falscher IBAN gesperrt', await m.locator('p.error:has-text("IBAN")').count() === 1);
  await m.screenshot({ path: O + 'person-iban-plz.png' });
  // Mieter anlegen aus der Einheit
  await p.goto(`http://localhost:5179/#/objekte/${ids.o}`); await p.waitForTimeout(1500);
  await p.locator('tr:has-text("EG links")').first().click(); await p.waitForTimeout(800);
  const mm = p.locator('.mieter-modal');
  ok('Mieter-anlegen-Fenster offen', await mm.count() === 1);
  if (await mm.count()) {
    await mm.locator('label:has(> span:text-is("Nachname *")) input').fill('Sommer');
    await mm.locator('label:has(> span:text-is("PLZ")) input').fill('50667'); await p.waitForTimeout(500);
    await mm.locator('label:has(> span:has-text("Kaltmiete")) input').fill('700');
    await mm.locator('button:has-text("3 Kaltmieten übernehmen")').click(); await p.waitForTimeout(200);
    ok('Kaution 3 Kaltmieten übernommen', (await mm.locator('label:has(> span:text-is("Kaution")) input').inputValue()).startsWith('2.100') || (await mm.locator('label:has(> span:text-is("Kaution")) input').inputValue()).startsWith('2100'), await mm.locator('label:has(> span:text-is("Kaution")) input').inputValue());
    await mm.locator('label:has(> span:text-is("Kaution")) input').fill('2500'); await p.waitForTimeout(200);
    ok('Kaution-Hinweis im Assistenten', await mm.locator('.feld-hinweis:has-text("551")').count() === 1);
    await mm.locator('label:has(> span:has-text("IBAN")) input').fill('DE12 3456'); await p.waitForTimeout(200);
    ok('IBAN-Fehler im Assistenten', await mm.locator('.feld-fehler').count() >= 1);
    await mm.screenshot({ path: O + 'mieter-anlegen.png' });
  }
  ok('Keine Konsolenfehler', errs.length === 0, errs.join(' | '));
  await b.close();
})();
