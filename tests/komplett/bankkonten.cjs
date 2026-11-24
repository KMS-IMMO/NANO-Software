const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
// Bankkonten bearbeiten und löschen: IBAN-Prüfung, Speichern, Löschen mit Umsätzen (Buchungen behalten oder mitlöschen), Papierkorb, Knöpfe in der Online-Banking-Verbindung
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 950 }, locale: 'de-DE' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + JSON.stringify(ist) : ''}`);
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const r = await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts');
    const pk = await import('/src/db/papierkorb.ts'); const bank = await import('/src/logic/bank.ts'); const bk = await import('/src/logic/bankkonto.ts');
    const n = async (sql, a = []) => Number((await db.select(sql, a))[0]?.n ?? 0);
    const out = {};
    out.iban = [bk.ibanGueltig('DE89 3704 0044 0532 0130 00'), bk.ibanGueltig('DE89370400440532013001'), bk.ibanGueltig('DE8937040044'), bk.ibanGueltig('')];
    const o = await insert('objekte', { verwaltungsart: 'Mietverwaltung', name: 'Bankkonto Testhaus', strasse: 'Weg 2', plz: '50667', ort: 'Köln' });
    const m = await insert('personen', { rolle: 'Mieter', vorname: 'Berta', nachname: 'Bank' });
    // Bearbeiten
    const k1 = await insert('bankkonten', { objekt_id: o, name: 'Altes Konto', iban: 'DE89370400440532013000' });
    const alt = (await db.select('SELECT * FROM bankkonten WHERE id = $1', [k1]))[0];
    out.speichern = await bk.bankkontoSpeichern(alt, { ...alt, name: 'Neues Konto', bank: 'Testbank', iban: 'de02 1203 0000 0000 2020 51', anfangssaldo: '1.234,5'.replace('.', ''), saldo_datum: '2025-12-31' });
    out.nachSpeichern = (await db.select('SELECT name, bank, iban, anfangssaldo, saldo_datum FROM bankkonten WHERE id = $1', [k1]))[0];
    // Löschen, Buchungen behalten
    await bank.importieren(k1, [
      { datum: '2026-01-03', betrag: 600, gegenpartei: 'Berta Bank', verwendungszweck: 'Miete 01/2026', gegen_iban: 'DE44500105175407324931' },
      { datum: '2026-01-05', betrag: -50, gegenpartei: 'Stadtwerke', verwendungszweck: 'Abschlag', gegen_iban: 'DE75512108001245126199' }]);
    const u = (await db.select('SELECT * FROM bankumsaetze WHERE bankkonto_id = $1 ORDER BY id', [k1]))[0];
    const bkKonto = (await db.select("SELECT id FROM buchungskonten WHERE art = 'Ertrag' ORDER BY nummer LIMIT 1"))[0].id;
    await bank.zuordnenKonto(u, bkKonto);
    out.umfang = await bk.bankkontoUmfang(k1);
    const buchIds = (await db.select('SELECT id FROM buchungen WHERE bankumsatz_id = $1', [u.id])).map((x) => x.id);
    await bk.bankkontoLoeschen(k1, false);
    out.behalten = { konto: await n('SELECT COUNT(*) n FROM bankkonten WHERE id = $1', [k1]), umsaetze: await n('SELECT COUNT(*) n FROM bankumsaetze WHERE bankkonto_id = $1', [k1]),
      buchungen: await n(`SELECT COUNT(*) n FROM buchungen WHERE id IN (${buchIds.join(',') || 'NULL'}) AND bankumsatz_id IS NULL`) };
    const e1 = (await db.select("SELECT * FROM papierkorb WHERE art = 'Bankkonto' ORDER BY id DESC LIMIT 1"))[0];
    out.pk = e1 ? { bez: e1.bezeichnung, umfang: pk.umfang(e1.daten) } : null;
    await pk.wiederherstellen(e1.id);
    out.wieder = { konto: await n('SELECT COUNT(*) n FROM bankkonten WHERE id = $1', [k1]), umsaetze: await n('SELECT COUNT(*) n FROM bankumsaetze WHERE bankkonto_id = $1', [k1]),
      verknuepft: await n('SELECT COUNT(*) n FROM buchungen WHERE bankumsatz_id = $1', [u.id]) };
    // Löschen mit Buchungen
    await bk.bankkontoLoeschen(k1, true);
    out.mit = { konto: await n('SELECT COUNT(*) n FROM bankkonten WHERE id = $1', [k1]), buchungen: await n(`SELECT COUNT(*) n FROM buchungen WHERE id IN (${buchIds.join(',') || 'NULL'})`) };
    const e2 = (await db.select("SELECT * FROM papierkorb WHERE art = 'Bankkonto' ORDER BY id DESC LIMIT 1"))[0];
    await pk.wiederherstellen(e2.id);
    out.mitWieder = { konto: await n('SELECT COUNT(*) n FROM bankkonten WHERE id = $1', [k1]), buchungen: await n(`SELECT COUNT(*) n FROM buchungen WHERE id IN (${buchIds.join(',') || 'NULL'}) AND bankumsatz_id = $1`, [u.id]) };
    return out;
  });
  ok('IBAN-Prüfung (gültig, falsche Prüfziffer, zu kurz, leer)', JSON.stringify(r.iban) === '[true,false,false,true]', r.iban);
  ok('Kontodaten speichern (IBAN ohne Leerzeichen, Saldo als Zahl)', r.nachSpeichern.name === 'Neues Konto' && r.nachSpeichern.bank === 'Testbank' && r.nachSpeichern.iban === 'DE02120300000000202051' && Number(r.nachSpeichern.anfangssaldo) === 1234.5 && r.nachSpeichern.saldo_datum === '2025-12-31', r.nachSpeichern);
  ok('Umfang vor dem Löschen (2 Umsätze, 1 zugeordnet, Buchungen)', r.umfang.umsaetze === 2 && r.umfang.zugeordnet === 1 && r.umfang.buchungen >= 1, r.umfang);
  ok('Löschen, Buchungen behalten: Konto und Umsätze weg, Buchungen da ohne Umsatz', r.behalten.konto === 0 && r.behalten.umsaetze === 0 && r.behalten.buchungen === r.umfang.buchungen, r.behalten);
  ok('Im Papierkorb mit Umsätzen', !!r.pk && r.pk.bez === 'Neues Konto' && /2 × Bankumsatz/.test(r.pk.umfang), r.pk);
  ok('Wiederherstellen: Konto, Umsätze und Verknüpfung zur Buchung zurück', r.wieder.konto === 1 && r.wieder.umsaetze === 2 && r.wieder.verknuepft === r.umfang.buchungen, r.wieder);
  ok('Löschen mit Buchungen: Buchungen weg', r.mit.konto === 0 && r.mit.buchungen === 0, r.mit);
  ok('Wiederherstellen bringt auch die Buchungen zurück', r.mitWieder.konto === 1 && r.mitWieder.buchungen === r.umfang.buchungen, r.mitWieder);
  // Oberfläche: Knöpfe in der Online-Banking-Verbindung
  await p.goto('http://localhost:5179/#/bank'); await p.waitForTimeout(2500);
  const karte = p.locator('section.card').filter({ has: p.locator('h2', { hasText: 'Online-Banking-Verbindung' }) });
  const stifte = await karte.locator('button[title="Kontodaten bearbeiten"]').count(), eimer = await karte.locator('button[title="Konto löschen"]').count();
  ok('Stift und Papierkorb je Konto', stifte > 0 && stifte === eimer, { stifte, eimer });
  await karte.locator('button[title="Kontodaten bearbeiten"]').first().click(); await p.waitForTimeout(500);
  const modal = p.locator('.modal').last();
  ok('Bearbeiten-Fenster öffnet', await modal.locator('h3', { hasText: 'Bankkonto bearbeiten' }).count() === 1);
  await modal.locator('label:has-text("IBAN") input').fill('DE00 1111 2222 3333 4444 55'); await p.waitForTimeout(200);
  await modal.locator('button:has-text("Speichern")').click(); await p.waitForTimeout(400);
  ok('Ungültige IBAN wird nicht gespeichert', await modal.locator('.error').count() > 0);
  await modal.locator('button:has-text("Konto löschen")').click(); await p.waitForTimeout(800);
  ok('Löschen aus dem Bearbeiten-Fenster mit Bestätigung', await p.locator('.modal h3', { hasText: 'Bankkonto löschen' }).count() === 1);
  await p.screenshot({ path: require('path').join(AUS, 'bankkonten-loeschen.png') });
  await p.locator('.modal button', { hasText: 'Abbrechen' }).click();
  ok('Keine Fehler in der Konsole', errs.length === 0, errs.slice(0, 3));
  await b.close();
})().catch((e) => { console.log('FEHL ' + e.message); process.exit(1); });
