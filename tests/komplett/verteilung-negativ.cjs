// Hausgeldabrechnung: negative Kosten (Gutschrift/Erstattung, z. B. zurückgezahlte Sonderumlage) manuell je Einheit verteilen.
// Fehler vorher: bei negativer Gesamtsumme blieb „Übernehmen“ gesperrt, obwohl die Summe genau stimmte.
const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  p.on('dialog', (d) => d.accept());
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`);
  const q = (sql, a = []) => p.evaluate(async ([s, x]) => { const { db } = await import('/src/db/index.ts'); return db.select(s, x); }, [sql, a]);
  const bild = (n) => process.env.BILDER ? p.screenshot({ path: require('path').join(process.env.BILDER, n) }) : null;
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const d = await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts');
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'Gutschrift Testhaus', strasse: 'Ring 9', plz: '50667', ort: 'Köln', gesamt_mea: 1000 });
    const es = [];
    for (const [nr, mea] of [['W1', 400], ['W2', 300], ['W3', 300]]) {
      const e = await insert('einheiten', { objekt_id: o, nummer: nr, flaeche: 60, mea }); es.push(e);
      const pid = await insert('personen', { rolle: 'Eigentümer', vorname: 'Eigner', nachname: nr }); await insert('eigentum', { einheit_id: e, person_id: pid, anteil: 100, von: '2020-01-01' });
    }
    const k = (await db.select(`SELECT id FROM buchungskonten WHERE nummer = '1215'`))[0].id;
    // Erstattung: Geld kommt zurück, Kosten sind −600,00
    await insert('buchungen', { datum: '2025-07-01', objekt_id: o, buchungskonto_id: k, betrag: 600, text: 'Erstattung Wasser' });
    return { o, es, k };
  });
  await p.goto('http://localhost:5179/#/weg-abrechnung'); await p.waitForTimeout(1500);
  await p.locator('select').filter({ has: p.locator('option', { hasText: 'Gutschrift Testhaus' }) }).first().selectOption({ label: 'Gutschrift Testhaus' }); await p.waitForTimeout(500);
  await p.locator('label:has-text("Jahr") select').first().selectOption('2025'); await p.waitForTimeout(1500);
  const zeile = p.locator('.abr-uebersicht tr:has(td:text-is("1215"))').first();
  ok('Kosten −600,00 in der Abrechnung', (await zeile.innerText()).includes('-600,00'), (await zeile.innerText()).replace(/\s+/g, ' '));
  await zeile.locator('select').selectOption('Summe'); await p.waitForTimeout(600);
  const f = p.locator('.schl-fenster');
  ok('Fenster „manuell je Einheit“ offen', await f.count() === 1);
  const felder = f.locator('tbody input.cell');
  for (let i = 0; i < 3; i++) await felder.nth(i).fill('');
  const knopf = f.locator('button:has-text("Übernehmen")');
  await felder.nth(0).fill('- 500');
  ok('Teilbetrag: Hinweis „Es fehlen -100,00 €“, Übernehmen gesperrt', (await f.locator('p.warn').innerText()).includes('Es fehlen') && await knopf.isDisabled(), await f.locator('p.warn').innerText());
  await felder.nth(2).fill('-200');
  ok('Zu viel: Hinweis „Zu viel verteilt“', (await f.locator('p.warn').innerText()).includes('Zu viel verteilt'), await f.locator('p.warn').innerText());
  await felder.nth(2).fill('- 100');
  await bild('verteilung-negativ.png');
  ok('Genau −600,00 verteilt: Übernehmen frei, Hinweis „stimmen überein“', await knopf.isEnabled() && (await f.locator('p.info').innerText()).includes('stimmen überein'));
  await knopf.click(); await p.waitForTimeout(1500);
  ok('Fenster geschlossen', await f.count() === 0);
  const s = (await q('SELECT schluessel FROM objekt_schluessel_jahr WHERE objekt_id = $1 AND jahr = 2025 AND buchungskonto_id = $2', [d.o, d.k]))[0];
  ok('Schlüssel „Summe“ gespeichert', s?.schluessel === 'Summe', JSON.stringify(s));
  const vb = await q('SELECT einheit_id, menge FROM verbrauch WHERE buchungskonto_id = $1 AND jahr = 2025 AND einheit_id IN ($2, $3, $4) ORDER BY einheit_id', [d.k, ...d.es]);
  ok('Beträge −500 / −100 gespeichert, W2 ohne Eintrag', vb.length === 2 && Number(vb[0].menge) === -500 && Number(vb[1].menge) === -100, JSON.stringify(vb));
  const verteilt = await p.evaluate(async ([o, k]) => {
    const v = await import('/src/logic/verteilung.ts'); const { db } = await import('/src/db/index.ts');
    const { einheiten, nutzer } = await v.nutzerErmitteln(o, 2025, 'Eigentümer');
    const pos = (await v.kostenErmitteln(o, 2025, false)).filter((x) => x.konto_id === k).map((x) => ({ ...x, schluessel: 'Summe' }));
    const vb = await db.select('SELECT v.* FROM verbrauch v JOIN einheiten e ON e.id = v.einheit_id WHERE e.objekt_id = $1 AND v.jahr = 2025', [o]);
    const r = v.verteilen(2025, einheiten, nutzer, pos, { verbrauch: Object.fromEntries(vb.map((x) => [`${x.einheit_id}-${x.buchungskonto_id}`, Number(x.menge)])), messdienst: {} });
    return r.map((x) => Math.round(x.zeilen.reduce((a, z) => a + z.betrag, 0) * 100) / 100);
  }, [d.o, d.k]);
  ok('Abrechnung verteilt −500 / 0 / −100', verteilt.join('/') === '-500/0/-100', verteilt.join('/'));
  // Erneut öffnen: gespeicherte Werte stehen drin und passen sofort
  await zeile.locator('button[title="Werte je Einheit bearbeiten"]').click(); await p.waitForTimeout(600);
  ok('Erneut geöffnet: Übernehmen sofort frei', await f.locator('button:has-text("Übernehmen")').isEnabled());
  await f.locator('button:has-text("Abbrechen")').click();
  ok('Keine Fehler in der Konsole', errs.length === 0, errs.slice(0, 2).join(' | '));
  await b.close();
})().catch((e) => { console.log('FEHL ' + e.message.split('\n').slice(0, 2).join(' ')); process.exit(1); });
