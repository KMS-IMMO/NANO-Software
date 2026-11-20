// „Als bezahlt buchen“ für Posten aus einem Vorjahr (20.11.2026, nur Demodaten): Zahldatum = Fälligkeit statt Klickdatum,
// und Reparatur früher so gebuchter Zahlungen über die Karte in der WEG-Jahresabrechnung (Forderung zum 31.12. trotz Zahlung).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1500, height: 1000 }, locale: 'de-DE' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`);
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const r = await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts'); const soll = await import('/src/logic/soll.ts');
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'WEG Handzahlung', gesamt_mea: 1000 });
    const e1 = await insert('einheiten', { objekt_id: o, nummer: '1. OG rechts', mea: 500 }); const e2 = await insert('einheiten', { objekt_id: o, nummer: '2. OG', mea: 500 });
    const y = await insert('personen', { rolle: 'Eigentümer', nachname: 'Handmann' }); const z = await insert('personen', { rolle: 'Eigentümer', nachname: 'Zweit' });
    await insert('eigentum', { einheit_id: e1, person_id: y, anteil: 100 }); await insert('eigentum', { einheit_id: e2, person_id: z, anteil: 100 });
    await insert('hausgeld', { einheit_id: e1, gueltig_ab: '2025-01-01', betrag: 320, davon_ruecklage: 0 }); await insert('hausgeld', { einheit_id: e2, gueltig_ab: '2025-01-01', betrag: 400, davon_ruecklage: 0 });
    await soll.sollStellen('2025-12', { objektId: o });
    const ops = async (eid) => db.select(`SELECT * FROM (${soll.OP_SQL}) WHERE einheit_id = $1 ORDER BY monat`, [eid]);
    // neu: Einheit 1 per „Als bezahlt buchen“
    for (const x of await ops(e1)) await soll.zahlungBuchen(x);
    const d1 = await db.select("SELECT MIN(datum) AS a, MAX(datum) AS m, MIN(jahr) AS j FROM buchungen WHERE einheit_id = $1", [e1]);
    // alter Stand: Einheit 2 mit Klickdatum 16.11.2026
    for (const x of await ops(e2)) await soll.zahlungBuchen(x, '2026-11-16');
    const vor = (await soll.spaeteHandzahlungen(o, 2025)).length;
    return { d1: d1[0], vor, heute: soll.zahldatumFuer({ faellig: '2026-12-03' }, '2026-11-20'), alt: soll.zahldatumFuer({ faellig: '2025-03-03' }, '2026-11-20') };
  });
  ok('Als bezahlt (Vorjahr): Datum = Fälligkeit, Buchungsjahr 2025', r.d1.a === '2025-01-03' && r.d1.m === '2025-12-03' && r.d1.j === 2025, JSON.stringify(r.d1));
  ok('Posten im laufenden Jahr: heute', r.heute === '2026-11-20' && r.alt === '2025-03-03', `${r.heute} / ${r.alt}`);
  ok('Späte Handzahlungen erkannt', r.vor === 12, r.vor);
  await p.goto('http://localhost:5179/#/weg-abrechnung'); await p.waitForTimeout(2500);
  await p.locator('select').first().selectOption({ label: 'WEG Handzahlung' }); await p.locator('input[type=number]').first().fill('2025'); await p.waitForTimeout(3500);
  const t1 = (await p.locator('main').innerText()).replace(/ /g, ' ');
  ok('Vorher: Forderung 4.800 € zum 31.12.', /Offene Forderungen gegen Eigentümer\s+4\.800,00 €/.test(t1));
  ok('Karte „nach dem Stichtag datiert“ erscheint', /Als bezahlt gebucht, aber nach dem Stichtag datiert/.test(t1));
  await p.getByRole('button', { name: /Alle 12 auf den Fälligkeitstag datieren/ }).click(); await p.waitForTimeout(3500);
  const t2 = (await p.locator('main').innerText()).replace(/ /g, ' ');
  ok('Nachher: keine Forderung, Karte weg', /Offene Forderungen gegen Eigentümer\s+0,00 €/.test(t2) && !/nach dem Stichtag datiert/.test(t2) && /12 Zahlungen auf den Fälligkeitstag datiert/.test(t2));
  ok('Keine Fehler in der Konsole', !errs.length, errs.slice(0, 3).join(' | '));
  await b.close();
})();
