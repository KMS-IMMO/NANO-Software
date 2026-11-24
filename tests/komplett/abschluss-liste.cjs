const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
// Abschlüsse je Liegenschaft: Liste aller abgeschlossenen Jahre (jüngstes zuerst), nur der jüngste lässt sich löschen.
// Löschen öffnet das Jahr wieder, entfernt unbezahlte offene Posten aus dem Ergebnis und lässt bezahlte stehen.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ deviceScaleFactor: 2, locale: 'de-DE' })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`);
  const q = (sql, a = []) => p.evaluate(async ([s, x]) => { const { db } = await import('/src/db/index.ts'); return db.select(s, x); }, [sql, a]);
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const r = await p.evaluate(async () => {
    const { insert, db } = await import('/src/db/index.ts');
    const o = await insert('objekte', { verwaltungsart: 'WEG', name: 'WEG Abschlussliste', strasse: 'Ring 5', plz: '50672', ort: 'Köln', objekt_nr: '9081' });
    const eig = await insert('personen', { rolle: 'Eigentümer', vorname: 'Anna', nachname: 'Abschluss' });
    const eig2 = await insert('personen', { rolle: 'Eigentümer', vorname: 'Bernd', nachname: 'Bezahlt' });
    const e1 = await insert('einheiten', { objekt_id: o, nummer: 'WE 1', typ: 'Wohnung', mea: 500, lfd_nr: 1 });
    const e2 = await insert('einheiten', { objekt_id: o, nummer: 'WE 2', typ: 'Wohnung', mea: 500, lfd_nr: 2 });
    for (const [j, am, aus, sp] of [[2023, '2024-03-12', 18250.4, 310.2], [2024, '2025-03-18', 19120.75, -120.5], [2025, '2026-03-20', 20480.1, 455.3]])
      await db.execute(`INSERT INTO abrechnungen (objekt_id, art, jahr, status, abgeschlossen_am, ergebnis) VALUES ($1, 'WEG', $2, 'Abgeschlossen', $3, $4)`,
        [o, j, am, JSON.stringify({ ausgaben: aus, spitzen: sp, einheiten: 2 })]);
    const s1 = await insert('sollstellungen', { einheit_id: e1, person_id: eig, monat: '2025-JA', art: 'WEG-Abrechnung', betrag: 280.1, faellig: '2026-04-20' });
    const s2 = await insert('sollstellungen', { einheit_id: e2, person_id: eig2, monat: '2025-JA', art: 'WEG-Abrechnung', betrag: 175.2, faellig: '2026-04-20' });
    const k = (await db.select(`SELECT id FROM buchungskonten WHERE nummer = '1200' LIMIT 1`))[0]?.id ?? null;
    await insert('buchungen', { datum: '2026-04-15', objekt_id: o, einheit_id: e2, buchungskonto_id: k, betrag: 175.2, text: 'Nachzahlung 2025 WE 2', sollstellung_id: s2, jahr: 2026 });
    // Mietverwaltung mit NK-Abschluss
    const m = await insert('objekte', { verwaltungsart: 'Mietverwaltung', name: 'Haus Abschlussliste NK', strasse: 'Gasse 1', plz: '50667', ort: 'Köln' });
    const me = await insert('einheiten', { objekt_id: m, nummer: 'EG', typ: 'Wohnung', lfd_nr: 1 });
    const mieter = await insert('personen', { rolle: 'Mieter', vorname: 'Mia', nachname: 'Miete' });
    await db.execute(`INSERT INTO abrechnungen (objekt_id, art, jahr, status, abgeschlossen_am, ergebnis) VALUES ($1, 'Nebenkosten', 2025, 'Abgeschlossen', '2026-02-10', $2)`, [m, JSON.stringify({ kosten: 4210.5, saldo: 88.4, mieter: 1 })]);
    await db.execute(`INSERT INTO abrechnungen (objekt_id, art, jahr, status) VALUES ($1, 'Nebenkosten', 2025, 'Gebucht')`, [m]);
    await insert('sollstellungen', { einheit_id: me, person_id: mieter, monat: '2025-NK', art: 'NK-Abrechnung', betrag: 88.4, faellig: '2026-03-12' });
    return { o, e1, e2, s1, s2, m, me };
  });
  await p.setViewportSize({ width: 1500, height: 1000 });
  await p.goto('http://localhost:5179/#/weg-abrechnung'); await p.waitForTimeout(1500);
  await p.locator('select').filter({ has: p.locator('option', { hasText: 'WEG Abschlussliste' }) }).first().selectOption({ label: 'WEG Abschlussliste' });
  await p.locator('label:has-text("Jahr") select').first().selectOption('2025');
  const liste = p.locator('section.abschluss-liste');
  await liste.locator('tbody tr').first().waitFor({ timeout: 15000 }); await p.waitForTimeout(800);
  const jahre = await liste.locator('tbody tr td:first-child').allInnerTexts();
  ok('Liste zeigt alle Abschlüsse, jüngstes zuerst', jahre.join(',') === '2025,2024,2023', jahre.join(','));
  const zeile1 = await liste.locator('tbody tr').first().innerText();
  ok('Offene Posten aus dem Ergebnis gezählt', zeile1.includes('2 gebucht, davon 1 bezahlt'), zeile1.replace(/\s+/g, ' '));
  ok('Nur der jüngste Abschluss ist löschbar', (await liste.locator('button[title="Abschluss 2025 löschen"]').count()) === 1 && (await liste.locator('button[title="Erst den Abschluss 2025 löschen"]:disabled').count()) === 2);
  await liste.screenshot({ path: AUS + '/abschluss-liste.png' });
  const fehler = await p.evaluate(async (o) => { const m = await import('/src/logic/abschluss.ts'); try { await m.abschlussLoeschen(o, 2024, 'WEG'); return ''; } catch (e) { return e.message; } }, r.o);
  ok('Älterer Abschluss lässt sich nicht löschen', fehler.startsWith('Erst den Abschluss 2025 löschen'), fehler.slice(0, 60));
  await liste.locator('button[title="Abschluss 2025 löschen"]').click();
  const dlg = p.locator('.modal').filter({ hasText: 'Abschluss 2025 löschen' });
  await dlg.waitFor();
  ok('Bestätigen erst nach Eintippen von LÖSCHEN', await dlg.locator('button.danger-voll').isDisabled());
  await dlg.locator('input').first().fill('Rechnung Dach Dezember nachgebucht');
  await dlg.locator('input').nth(1).fill('LÖSCHEN');
  await p.screenshot({ path: AUS + '/abschluss-loeschen-dialog.png' });
  await dlg.locator('button.danger-voll').click(); await p.waitForTimeout(1500);
  const st = await q(`SELECT jahr, status, aufhebung_grund FROM abrechnungen WHERE objekt_id = $1 AND art = 'WEG' ORDER BY jahr`, [r.o]);
  ok('Abschluss 2025 ist gelöscht, 2023/2024 bleiben', st.map((x) => x.status).join(',') === 'Abgeschlossen,Abgeschlossen,Gelöscht', st.map((x) => x.status).join(','));
  ok('Grund steht am Abschluss', st[2].aufhebung_grund === 'Rechnung Dach Dezember nachgebucht');
  const op = await q(`SELECT id FROM sollstellungen WHERE id IN ($1, $2)`, [r.s1, r.s2]);
  ok('Unbezahlter Posten entfernt, bezahlter bleibt', op.length === 1 && op[0].id === r.s2, JSON.stringify(op));
  const frei = await p.evaluate(async (o) => (await import('/src/logic/abschluss.ts')).gesperrt(o, '2025-06-01'), r.o);
  ok('Jahr 2025 ist wieder offen', frei === null, frei);
  const prot = await q(`SELECT COUNT(*) AS n FROM protokoll WHERE tabelle = 'abrechnungen' AND inhalt LIKE '%Gelöscht%'`);
  ok('Vorgang steht im Änderungsprotokoll', prot[0].n >= 1);
  const jahre2 = await liste.locator('tbody tr td:first-child').allInnerTexts();
  ok('Liste zeigt danach 2024 als jüngsten, jetzt löschbar', jahre2.join(',') === '2024,2023' && (await liste.locator('button[title="Abschluss 2024 löschen"]').count()) === 1, jahre2.join(','));
  const text = await p.locator('main').innerText();
  ok('Hinweis nach dem Löschen', text.includes('Abschluss der Hausgeldabrechnung 2025 gelöscht') && text.includes('1 schon bezahlter Posten bleibt stehen'));
  ok('Abschlusskarte zeigt 2025 wieder offen', (await p.locator('section.card.abschluss:not(.zu)').count()) >= 1);
  await p.screenshot({ path: AUS + '/abschluss-nach-loeschen.png' });
  // Nebenkosten
  await p.goto('http://localhost:5179/#/nebenkosten'); await p.waitForTimeout(1500);
  await p.locator('select').filter({ has: p.locator('option', { hasText: 'Haus Abschlussliste NK' }) }).first().selectOption({ label: 'Haus Abschlussliste NK (Mietverwaltung)' });
  const nk = p.locator('section.abschluss-liste');
  await nk.locator('tbody tr').first().waitFor({ timeout: 15000 }); await p.waitForTimeout(500);
  ok('Nebenkosten: Liste erscheint', (await nk.innerText()).includes('Abschlüsse Nebenkostenabrechnung') && (await nk.innerText()).includes('Kosten 4.210,50'));
  await nk.screenshot({ path: AUS + '/abschluss-liste-nk.png' });
  await nk.locator('button[title="Abschluss 2025 löschen"]').click();
  await p.locator('.modal input').nth(1).fill('LÖSCHEN'); await p.locator('.modal button.danger-voll').click(); await p.waitForTimeout(1500);
  const nkst = await q(`SELECT status FROM abrechnungen WHERE objekt_id = $1 ORDER BY id`, [r.m]);
  ok('Nebenkosten: Abschluss gelöscht und „Gebucht“ zurückgenommen', nkst.map((x) => x.status).join(',') === 'Gelöscht', nkst.map((x) => x.status).join(','));
  ok('Nebenkosten: NK-Posten entfernt', (await q(`SELECT COUNT(*) AS n FROM sollstellungen WHERE einheit_id = $1 AND art = 'NK-Abrechnung'`, [r.me]))[0].n === 0);
  ok('Nebenkosten: Liste verschwindet ohne Abschluss', (await p.locator('section.abschluss-liste').count()) === 0);
  ok('Keine Fehler in der Konsole', errs.length === 0, errs.slice(0, 2).join(' | '));
  await b.close();
})().catch((e) => { console.log('FEHL ' + e.message); process.exit(1); });
