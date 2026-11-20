// Befunde aus dem Prüfbericht vom 15.11.2026 (nur Demodaten):
// 1. Hausgeldabrechnung: offene, unbezahlte Rechnungen zählen nicht als Kosten (Abflussprinzip), sie stehen im Vermögensbericht.
// 2. Jahressperre gilt auch unter „Bank & Zuordnung“: kein Zuordnen, Lösen oder Löschen im abgeschlossenen Jahr.
// 3. Rücklagen-Anzeige der Buchhaltung (Zeitraum) enthält Sonderzuführungen wie der Vermögensbericht.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`);
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const r = await p.evaluate(async () => {
    const { db, insert } = await import('/src/db/index.ts'); const soll = await import('/src/logic/soll.ts'); const bank = await import('/src/logic/bank.ts');
    const V = await import('/src/logic/verteilung.ts'); const RL = await import('/src/logic/ruecklage.ts'); const AB = await import('/src/logic/abschluss.ts');
    const k = async (n) => (await db.select('SELECT id FROM buchungskonten WHERE nummer = $1', [n]))[0]?.id;
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'WEG Pruefhaus', strasse: 'Pruefweg 1', plz: '50667', ort: 'Köln', gesamt_mea: 1000, gesamt_flaeche: 300, ruecklage_anfang: 10000, ruecklage_stichtag: '2024-12-31' });
    const eid = []; for (const [n, f, m] of [['W1', 90, 300], ['W2', 90, 300], ['W3', 120, 400]]) eid.push(await insert('einheiten', { objekt_id: o, nummer: n, flaeche: f, mea: m }));
    const pid = []; for (const n of ['Eins', 'ZweiAlt', 'ZweiNeu', 'Drei']) pid.push(await insert('personen', { rolle: 'Eigentümer', vorname: 'P', nachname: n }));
    await insert('eigentum', { einheit_id: eid[0], person_id: pid[0], anteil: 100, von: '2010-01-01' });
    await insert('eigentum', { einheit_id: eid[1], person_id: pid[1], anteil: 100, von: '2010-01-01', bis: '2025-06-30' });
    await insert('eigentum', { einheit_id: eid[1], person_id: pid[2], anteil: 100, von: '2025-07-01' });
    await insert('eigentum', { einheit_id: eid[2], person_id: pid[3], anteil: 100, von: '2010-01-01' });
    for (const [i, hg, rl] of [[0, 300, 50], [1, 300, 50], [2, 400, 70]]) await insert('hausgeld', { einheit_id: eid[i], gueltig_ab: '2025-01-01', betrag: hg, davon_ruecklage: rl });
    const bk = await insert('bankkonten', { objekt_id: o, name: 'Hausgeldkonto Pruefhaus', iban: 'DE12370501980000999999', anfangssaldo: 5000, saldo_datum: '2024-12-31' });
    await soll.sollStellen('2025-12', { objektId: o });
    await insert('buchungen', { datum: '2025-03-01', betrag: -1200, buchungskonto_id: await k('1250'), objekt_id: o, text: 'Versicherung' });
    await insert('buchungen', { datum: '2025-06-01', betrag: -2400, buchungskonto_id: await k('1246'), objekt_id: o, text: 'Hausmeister' });
    await insert('buchungen', { datum: '2025-05-01', betrag: 500, buchungskonto_id: await k('1260'), objekt_id: o, text: 'Sonderzuführung Antenne' });
    await insert('rechnungen', { objekt_id: o, rechnungsnr: 'OFFEN-1', datum: '2025-12-15', betrag: 999.99, buchungskonto_id: await k('1300') });
    const kosten = (await V.kostenErmitteln(o, 2025, false, { nurBezahlt: true })).reduce((a, x) => a + x.betrag, 0);
    const kostenNk = (await V.kostenErmitteln(o, 2025, false)).reduce((a, x) => a + x.betrag, 0);
    const rlJahr = (await RL.ruecklageJahr(o, 2025)).bestand, rlZeit = (await RL.ruecklageZeitraum(o, '2025-01-01', '2025-12-31')).bestand;
    await bank.importieren(bk, [{ datum: '2025-12-20', betrag: -77.77, verwendungszweck: 'Kontoführung Dez', gegenpartei: 'Bank Pruefhaus', gegen_iban: '' }]);
    const u = (await db.select(`SELECT * FROM bankumsaetze WHERE bankkonto_id = $1 AND status = 'offen'`, [bk]))[0];
    await bank.zuordnenKonto(u, await k('1405'));     // vor dem Abschluss: erlaubt
    await AB.abschliessen(o, 2025, 'WEG', {});
    const fehler = async (f) => { try { await f(); return null; } catch (e) { return String(e?.message ?? e); } };
    const loesen = await fehler(() => bank.zuordnungLoesen(u));
    const loeschen = await fehler(() => bank.umsaetzeLoeschen([u.id]));
    await bank.importieren(bk, [{ datum: '2025-12-28', betrag: -12.5, verwendungszweck: 'Zinsen Dez', gegenpartei: 'Bank Pruefhaus', gegen_iban: '' }]);
    const u2 = (await db.select(`SELECT * FROM bankumsaetze WHERE bankkonto_id = $1 AND status = 'offen'`, [bk]))[0];
    const zuordnen = await fehler(async () => bank.zuordnenKonto(u2, await k('1405')));
    const buchungen = Number((await db.select('SELECT COUNT(*) AS n FROM buchungen WHERE bankumsatz_id IN ($1, $2)', [u.id, u2.id]))[0].n);
    await bank.automatischZuordnen();
    const u2Status = (await db.select('SELECT status FROM bankumsaetze WHERE id = $1', [u2.id]))[0].status;
    return { kosten, kostenNk, rlJahr, rlZeit, loesen, loeschen, zuordnen, buchungen, u2Status };
  });
  ok('Hausgeldabrechnung ohne offene Rechnung (3.600,00 €)', Math.abs(r.kosten - 3600) < 0.005, r.kosten);
  ok('Nebenkosten-/Eigentümerrechnung unverändert (offene Rechnung zählt dort weiter)', Math.abs(r.kostenNk - 4599.99) < 0.005, r.kostenNk);
  ok('Rücklage Zeitraum = Vermögensbericht (12.540,00 €)', r.rlZeit === 12540 && r.rlJahr === 12540, `${r.rlZeit} / ${r.rlJahr}`);
  ok('Zuordnung lösen im abgeschlossenen Jahr gesperrt', /abgeschlossen/.test(r.loesen ?? ''), r.loesen);
  ok('Umsatz löschen im abgeschlossenen Jahr gesperrt', /abgeschlossen/.test(r.loeschen ?? ''), r.loeschen);
  ok('Zuordnen im abgeschlossenen Jahr gesperrt', /abgeschlossen/.test(r.zuordnen ?? ''), r.zuordnen);
  ok('Buchung vor dem Abschluss bleibt, keine neue im gesperrten Jahr', r.buchungen === 1, r.buchungen);
  ok('Automatische Zuordnung lässt Umsatz im gesperrten Jahr offen', r.u2Status === 'offen', r.u2Status);
  // Oberfläche: Vermögensbericht zeigt die offene Rechnung, Gesamtkosten ohne sie
  await p.goto('http://localhost:5179/#/weg-abrechnung'); await p.waitForTimeout(2500);
  await p.locator('select').first().selectOption({ label: 'WEG Pruefhaus' }); await p.locator('input[type=number]').first().fill('2025'); await p.waitForTimeout(3000);
  const t = await p.locator('body').innerText();
  ok('Vermögensbericht nennt offene Rechnungen zum 31.12.2025', /Offene Rechnungen zum 31\.12\.2025[\s\S]{0,120}999,99/.test(t));
  ok('Keine Fehler in der Konsole', !errs.length, errs.join(' | ').slice(0, 300));
  await b.close();
})().catch((e) => { console.log('FEHL ' + (e?.message ?? e)); process.exit(1); });
