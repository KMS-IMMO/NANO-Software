const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
// Papierkorb: Löschen legt alles ab, Wiederherstellen bringt es samt Abhängigem zurück
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 950 }, locale: 'de-DE' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`);
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  const r = await p.evaluate(async () => {
    const { db, insert, remove } = await import('/src/db/index.ts');
    const pk = await import('/src/db/papierkorb.ts'); const soll = await import('/src/logic/soll.ts');
    const bank = await import('/src/logic/bank.ts'); const buchung = await import('/src/logic/buchung.ts'); const lo = await import('/src/logic/loeschen.ts');
    const n = async (sql, a = []) => Number((await db.select(sql, a))[0]?.n ?? 0);
    const out = {};
    // 1) Mietvertrag mit offenen Posten
    const o = await insert('objekte', { verwaltungsart: 'Mietverwaltung', name: 'Papierkorb Testhaus', strasse: 'Weg 1', plz: '50667', ort: 'Köln' });
    const e = await insert('einheiten', { objekt_id: o, nummer: 'A1', flaeche: 50 });
    const m = await insert('personen', { rolle: 'Mieter', vorname: 'Paul', nachname: 'Probe' });
    const v = await insert('mietvertraege', { einheit_id: e, mieter_id: m, beginn: '2025-01-01', kaltmiete: 500, nk_vorauszahlung: 100 });
    await soll.sollStellen('2025-06', { vertragId: v, von: '2025-01' });
    const vorher = { v: await n('SELECT COUNT(*) n FROM mietvertraege WHERE id = $1', [v]), s: await n('SELECT COUNT(*) n FROM sollstellungen WHERE vertrag_id = $1', [v]) };
    await remove('mietvertraege', v);
    out.nachLoeschen = { v: await n('SELECT COUNT(*) n FROM mietvertraege WHERE id = $1', [v]), s: await n('SELECT COUNT(*) n FROM sollstellungen WHERE vertrag_id = $1', [v]) };
    const eintrag = (await db.select("SELECT * FROM papierkorb ORDER BY id DESC LIMIT 1"))[0];
    out.eintrag = { art: eintrag.art, bez: eintrag.bezeichnung, umfang: pk.umfang(eintrag.daten) };
    await pk.wiederherstellen(eintrag.id);
    out.vorher = vorher;
    out.nachWieder = { v: await n('SELECT COUNT(*) n FROM mietvertraege WHERE id = $1', [v]), s: await n('SELECT COUNT(*) n FROM sollstellungen WHERE vertrag_id = $1', [v]), pk: await n('SELECT COUNT(*) n FROM papierkorb WHERE id = $1', [eintrag.id]) };
    // 2) Person, die noch verwendet wird: Löschen scheitert, nichts im Papierkorb
    const pkVor = await n('SELECT COUNT(*) n FROM papierkorb');
    try { await remove('personen', m); out.personGeloescht = true; } catch { out.personGeloescht = false; }
    out.pkUnveraendert = (await n('SELECT COUNT(*) n FROM papierkorb')) === pkVor;
    // 3) Buchung an einem Bankumsatz: Umsatz wird offen, nach Wiederherstellen wieder zugeordnet
    const bk = await insert('bankkonten', { objekt_id: o, name: 'PK Konto', iban: 'DE07370400440000777001' });
    await bank.importieren(bk, [{ datum: '2025-02-03', betrag: 600, gegenpartei: 'Paul Probe', verwendungszweck: 'Miete 02/2025', gegen_iban: 'DE89370400440532013000' }]);
    const u = (await db.select('SELECT * FROM bankumsaetze WHERE bankkonto_id = $1', [bk]))[0];
    await bank.zuordnenPerson(u, m);
    const bu = (await db.select('SELECT id FROM buchungen WHERE bankumsatz_id = $1', [u.id]));
    out.buchungen = bu.length;
    for (const x of bu) await buchung.buchungLoeschen(x.id);
    out.umsatzNachLoeschen = (await db.select('SELECT status FROM bankumsaetze WHERE id = $1', [u.id]))[0].status;
    for (const x of await db.select("SELECT id FROM papierkorb WHERE art = 'Buchung' ORDER BY id DESC LIMIT $1", [bu.length])) await pk.wiederherstellen(x.id);
    out.umsatzNachWieder = (await db.select('SELECT status FROM bankumsaetze WHERE id = $1', [u.id]))[0].status;
    out.buchungenNachWieder = await n('SELECT COUNT(*) n FROM buchungen WHERE bankumsatz_id = $1', [u.id]);
    // 4) Ganze Liegenschaft
    const zaehl = async () => ({ e: await n('SELECT COUNT(*) n FROM einheiten WHERE objekt_id = $1', [o]), v: await n('SELECT COUNT(*) n FROM mietvertraege WHERE einheit_id = $1', [e]),
      s: await n('SELECT COUNT(*) n FROM sollstellungen WHERE einheit_id = $1', [e]), u: await n('SELECT COUNT(*) n FROM bankumsaetze WHERE bankkonto_id = $1', [bk]), b: await n('SELECT COUNT(*) n FROM buchungen WHERE bankumsatz_id = $1', [u.id]),
      p: await n('SELECT COUNT(*) n FROM personen WHERE id = $1', [m]) });
    out.objVor = await zaehl();
    await lo.objektLoeschen(o, true);
    out.objWeg = await zaehl();
    const oe = (await db.select("SELECT * FROM papierkorb WHERE art = 'Liegenschaft' ORDER BY id DESC LIMIT 1"))[0];
    out.objUmfang = pk.umfang(oe.daten);
    await pk.wiederherstellen(oe.id);
    out.objWieder = await zaehl();
    // 5) Für die Ansicht: einen Kontakt löschen
    const t = await insert('personen', { rolle: 'Sonstige', vorname: 'Tina', nachname: 'Tonne' });
    await remove('personen', t);
    // 6) 30 Tage: alter Eintrag wird beim Aufräumen entfernt
    await db.execute("INSERT INTO papierkorb (art, bezeichnung, geloescht_am, daten) VALUES ('Notiz', 'uralt', datetime('now', 'localtime', '-31 days'), '{\"gruppen\":[],\"verweise\":[]}')");
    await pk.aufraeumen();
    out.altWeg = (await n("SELECT COUNT(*) n FROM papierkorb WHERE bezeichnung = 'uralt'")) === 0;
    return out;
  });
  const j = (x) => JSON.stringify(x);
  ok('Mietvertrag gelöscht samt offenen Posten', r.nachLoeschen.v === 0 && r.nachLoeschen.s === 0, j(r.nachLoeschen));
  ok('Eintrag im Papierkorb', r.eintrag.art === 'Mietvertrag' && /Mietvertrag/.test(r.eintrag.umfang) && /Offener Posten/.test(r.eintrag.umfang), j(r.eintrag));
  ok('Mietvertrag wiederhergestellt mit allen Posten', j(r.nachWieder) === j({ ...r.vorher, pk: 0 }), j(r.nachWieder));
  ok('Person in Verwendung: nicht gelöscht, kein Eintrag', r.personGeloescht === false && r.pkUnveraendert, j([r.personGeloescht, r.pkUnveraendert]));
  ok('Buchung gelöscht: Umsatz offen, nach Wiederherstellen wieder zugeordnet', r.buchungen > 0 && r.umsatzNachLoeschen === 'offen' && r.umsatzNachWieder === 'zugeordnet' && r.buchungenNachWieder === r.buchungen, j([r.buchungen, r.umsatzNachLoeschen, r.umsatzNachWieder, r.buchungenNachWieder]));
  ok('Liegenschaft gelöscht', Object.values(r.objWeg).every((x) => x === 0), j(r.objWeg));
  ok('Liegenschaft komplett wiederhergestellt', j(r.objWieder) === j(r.objVor), j(r.objWieder) + ' ' + r.objUmfang);
  ok('Einträge älter als 30 Tage verschwinden', r.altWeg);
  await p.goto('http://localhost:5179/#/papierkorb'); await p.waitForTimeout(1200);
  ok('Ansicht zeigt den gelöschten Kontakt', await p.locator('tr:has-text("Tina Tonne")').count() === 1);
  await p.screenshot({ path: AUS + '/papierkorb.png' });
  await p.locator('tr:has-text("Tina Tonne") button:has-text("Wiederherstellen")').click(); await p.waitForTimeout(600);
  ok('Wiederherstellen per Knopf', await p.locator('.info:has-text("wiederhergestellt")').count() === 1 && await p.locator('tr:has-text("Tina Tonne")').count() === 0);
  const da = await p.evaluate(async () => { const { db } = await import('/src/db/index.ts'); return (await db.select("SELECT COUNT(*) n FROM personen WHERE nachname = 'Tonne'"))[0].n; });
  ok('Kontakt wieder in den Kontakten', Number(da) === 1);
  ok('Keine Konsolenfehler', errs.length === 0, errs.join(' | '));
  await b.close();
})();
