// WEG-Jahresabrechnung: Entnahme aus der Erhaltungsrücklage (Konto 1261, EÜR-Häkchen) steht wie jedes andere Konto
// als Zeile bei den nicht umlagefähigen Kosten und verrechnet sich mit der daraus bezahlten Rechnung zu ±0.
// Ohne EÜR-Häkchen bleibt 1261 aus der Abrechnung. Zuführung (1260) und Zinsen (1262) sind nie Kosten.
const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  let fehler = 0;
  const ok = (n, c, ist) => { if (!c) fehler++; console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`); };
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts');
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'Entnahme Testhaus', strasse: 'Ring 7', plz: '50667', ort: 'Köln', gesamt_mea: 1000, ruecklage_anfang: 45000, ruecklage_stichtag: '2024-12-31' });
    const k = async (nr) => (await db.select('SELECT id FROM buchungskonten WHERE nummer = $1', [nr]))[0].id;
    for (const [nr, mea, hg, rl] of [['W1', 400, 450, 100], ['W2', 350, 395, 90], ['W3', 250, 285, 60]]) {
      const e = await insert('einheiten', { objekt_id: o, nummer: nr, flaeche: mea / 5, mea });
      const pid = await insert('personen', { rolle: 'Eigentümer', vorname: 'Eigner', nachname: nr });
      await insert('eigentum', { einheit_id: e, person_id: pid, anteil: 100, von: '2020-01-01' });
      await insert('hausgeld', { einheit_id: e, gueltig_ab: '2025-01-01', betrag: hg, davon_ruecklage: rl });
      for (let m = 1; m <= 12; m++) {
        const monat = `2025-${String(m).padStart(2, '0')}`;
        const s = await insert('sollstellungen', { einheit_id: e, person_id: pid, monat, art: 'Hausgeld', betrag: hg, faellig: `${monat}-03` });
        await insert('buchungen', { datum: `${monat}-03`, objekt_id: o, einheit_id: e, sollstellung_id: s, betrag: hg, text: 'Hausgeld', buchungskonto_id: await k('1010') });
      }
    }
    const bu = async (d, nr, betrag, text) => insert('buchungen', { datum: d, objekt_id: o, buchungskonto_id: await k(nr), betrag, text });
    await bu('2025-03-01', '1250', -1980, 'Gebäudeversicherung');
    await bu('2025-12-31', '1400', -2880, 'Verwalterhonorar');
    await bu('2025-09-12', '1300', -3000, 'Handwerkerrechnung, aus der Rücklage bezahlt');
    await bu('2025-09-10', '1261', 3000, 'Entnahme Rücklage für Handwerkerrechnung');
    await bu('2025-12-31', '1262', 38.2, 'Zinsen Rücklagenkonto');
    await db.execute(`UPDATE buchungskonten SET euer = 1 WHERE nummer = '1261'`, []);
  });
  const oeffnen = async () => {
    await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(800);
    await p.goto('http://localhost:5179/#/weg-abrechnung'); await p.waitForTimeout(1500);
    await p.locator('select').filter({ has: p.locator('option', { hasText: 'Entnahme Testhaus' }) }).first().selectOption({ label: 'Entnahme Testhaus' }); await p.waitForTimeout(500);
    await p.locator('label:has-text("Jahr") select').first().selectOption('2025'); await p.waitForTimeout(2500);
  };
  await oeffnen();
  const z1261 = p.locator('.abr-uebersicht tr:has(td:text-is("1261"))').first();
  ok('1261 steht als Zeile in der Abrechnung mit −3.000,00', await z1261.count() === 1 && (await z1261.innerText()).includes('-3.000,00'), await z1261.count() ? (await z1261.innerText()).replace(/\s+/g, ' ') : 'fehlt');
  const text = await p.locator('body').innerText();
  const nichtUml = text.slice(text.indexOf('Nicht umlagefähige Kosten'), text.indexOf('Summe nicht umlagefähige Kosten'));
  ok('1261 im Block „Nicht umlagefähige Kosten“', /1261/.test(nichtUml));
  ok('1260 und 1262 sind keine Kostenzeilen', await p.locator('.abr-uebersicht tr:has(td:text-is("1262"))').count() === 0 && await p.locator('.abr-uebersicht tr:has(td:text-is("1260"))').count() === 0);
  ok('Summe nicht umlagefähig 2.880,00 (Reparatur und Entnahme heben sich auf)', /Summe nicht umlagefähige Kosten\s*2\.880,00/.test(text), (text.match(/Summe nicht umlagefähige Kosten\s*[^\n]*/) || [''])[0]);
  ok('Abgleich mit Einnahmen & Ausgaben ohne Fehler', (await p.locator('.abr-abgleich.ok').count()) === 1);
  const w1 = p.locator('tr:has(td:text-is("W1"))').last();
  ok('W1: Entnahme −1.200 und Reparatur +1.200 heben sich auf, Kostenanteil 1.944,00', (await w1.innerText()).includes('1.944,00'), (await w1.innerText()).replace(/\s+/g, ' '));
  await p.screenshot({ path: require('path').join(AUS, 'ruecklage-entnahme.png'), fullPage: true });
  // Ohne EÜR-Häkchen: 1261 nicht in der Abrechnung, die Reparatur wird voll verteilt
  await p.evaluate(async () => { const { db } = await import('/src/db/index.ts'); await db.execute(`UPDATE buchungskonten SET euer = 0 WHERE nummer = '1261'`, []); });
  await oeffnen();
  const t2 = await p.locator('body').innerText();
  ok('Ohne EÜR-Häkchen: keine 1261-Zeile, Summe nicht umlagefähig 5.880,00', await p.locator('.abr-uebersicht tr:has(td:text-is("1261"))').count() === 0 && /Summe nicht umlagefähige Kosten\s*5\.880,00/.test(t2));
  await p.evaluate(async () => { const { db } = await import('/src/db/index.ts'); await db.execute(`UPDATE buchungskonten SET euer = 1 WHERE nummer = '1261'`, []); });
  ok('Keine Fehler in der Konsole', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();
  process.exit(fehler ? 1 : 0);
})();
