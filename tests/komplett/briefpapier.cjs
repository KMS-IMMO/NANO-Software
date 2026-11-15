const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
// Briefpapier im App-Design (Variante A) und Schrift Montserrat in allen PDFs; ein früheres Briefpapier wird gesichert (Demodaten)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1400 }, locale: 'de-DE', deviceScaleFactor: 1 });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const ok = (n, c, ist) => console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${ist !== undefined ? ' → ' + ist : ''}`);
  const q = (sql) => p.evaluate(async (s) => { const { db } = await import('/src/db/index.ts'); return db.select(s); }, sql);
  const wert = async (k) => (await q(`SELECT wert FROM einstellungen WHERE schluessel = '${k}'`))[0]?.wert ?? null;
  await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(3500);
  // Vorher: eigenes Briefpapier (weißes Bild) wie bei einer bestehenden Installation
  const alt = await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 124; c.height = 175; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 124, 175);
    const url = c.toDataURL('image/jpeg', 0.8);
    const { briefpapierSpeichern } = await import('/src/lib/briefpapier.ts');
    // direkt in die Tabelle schreiben, ohne die Umstellung auszulösen
    const { db } = await import('/src/db/index.ts');
    for (const [k, v] of [['briefpapier_erste', url], ['briefpapier_name', 'Altes Briefpapier.pdf'], ['briefpapier_kopf', '1'], ['briefpapier_unten', '30']])
      await db.execute(`INSERT INTO einstellungen (schluessel, wert) VALUES ($1, $2) ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert`, [k, v]);
    return { url, f: typeof briefpapierSpeichern };
  });
  // Umstellung beim ersten Laden
  const bp = await p.evaluate(async () => { const m = await import('/src/lib/briefpapier.ts'); const r = await m.briefpapierLaden(); return { name: r?.name, kopf: r?.kopfDrucken, unten: r?.unten, oben: r?.obenFolge, erste: r?.erste.slice(0, 23), folge: !!r?.folge }; });
  ok('Briefpapier im App-Design wird einmalig übernommen', bp.name === 'KMS-Briefpapier (App-Design)' && bp.erste === 'data:image/jpeg;base64,' && bp.folge && bp.kopf === false && bp.unten === 35, JSON.stringify(bp));
  ok('Stand gespeichert', await wert('briefpapier_stand') === 'kms-app-a');
  ok('Früheres Briefpapier gesichert', await wert('briefpapier_vorher_name') === 'Altes Briefpapier.pdf' && await wert('briefpapier_vorher_erste') === alt.url && await wert('briefpapier_vorher_kopf') === '1' && await wert('briefpapier_vorher_unten') === '30');
  // Nicht noch einmal: ein selbst gewähltes Briefpapier bleibt
  await p.evaluate(async () => { const { db } = await import('/src/db/index.ts'); await db.execute(`UPDATE einstellungen SET wert = 'Eigenes.pdf' WHERE schluessel = 'briefpapier_name'`); });
  // wie ein neuer Programmstart: Modul neu laden (die Vorschau-Datenbank bleibt)
  await p.evaluate(async () => { const m = await import('/src/lib/briefpapier.ts?neustart=1'); await m.briefpapierLaden(); });
  ok('Umstellung nur einmal (eigene Wahl bleibt)', await wert('briefpapier_name') === 'Eigenes.pdf' && await wert('briefpapier_vorher_name') === 'Altes Briefpapier.pdf');
  await p.evaluate(async () => { const { db } = await import('/src/db/index.ts'); await db.execute(`UPDATE einstellungen SET wert = 'KMS-Briefpapier (App-Design)' WHERE schluessel = 'briefpapier_name'`); });

  // PDFs: Brief, Liste, Bericht. Schrift Montserrat eingebettet, Text mit Umlauten lesbar
  const pdfs = await p.evaluate(async () => {
    const pdf = await import('/src/lib/pdf.ts'); const { pdfjsLaden } = await import('/src/lib/pdfjs.ts'); const pdfjs = await pdfjsLaden();
    const br = new pdf.Brief(await pdf.absender()).neuerBrief();
    br.kopf(['Frau', 'Erika Musterfrau', 'Musterstraße 12', '50667 Köln'], '2026-11-15');
    br.betreff('Hausgeldabrechnung 2025 für die Wohnung 3 (Demodaten)');
    br.absatz('Sehr geehrte Frau Musterfrau,');
    br.absatz('anbei erhalten Sie die Abrechnung über das Hausgeld für das Jahr 2025. Bitte prüfen Sie die Aufstellung. Größere Beträge, Änderungen der Vorauszahlung und das Ergebnis finden Sie unten. Für Rückfragen sind wir gern für Sie da: Straße, Grüße, Äpfel, Öl, Übergabe, Şahin, Ğ, ı.');
    const zeilen = Array.from({ length: 30 }, (_, i) => [`${4000 + i}`, `Kostenposition ${i + 1} – Wartung und Pflege`, 'MEA', pdf.geld(120 + i * 17.35)]);
    br.tabelle(['Konto', 'Kostenart', 'Schlüssel', 'Betrag'], zeilen, [['', 'Nachzahlung', '', pdf.geld(512.4)]], 3);
    br.gruss();
    const brief = br.seitenzahlen().bytes();
    const liste = await pdf.listePdf('Eigentümerliste', 'WEG Musterhof (Demodaten)', ['Nr.', 'Einheit', 'Eigentümer', 'Anschrift', 'MEA', 'Hausgeld'],
      Array.from({ length: 40 }, (_, i) => [String(i + 1), `W ${i + 1}`, `Muster ${i + 1}, Erika`, `Musterweg ${i + 1}, 50667 Köln`, String(25 + i), pdf.geld(210 + i * 3)]), undefined, [4, 5]);
    const bericht = await pdf.stammblattPdf('Stammblatt Einheit W 3', ['WEG Musterhof (Demodaten)'], [{ titel: 'Einheit', felder: [['Nummer', 'W 3'], ['Fläche', '72,5 m²'], ['MEA', '85/1000']] }]);
    const aus = {};
    for (const [n, by] of Object.entries({ brief, liste, bericht })) {
      const roh = new TextDecoder('latin1').decode(by);
      const d = await pdfjs.getDocument({ data: by.slice() }).promise; let t = ''; const bilder = [];
      for (let i = 1; i <= d.numPages; i++) {
        const s = await d.getPage(i); t += (await s.getTextContent()).items.map((x) => x.str).join(' ') + '\n';
        if (i <= 2) { const vp = s.getViewport({ scale: 1240 / s.getViewport({ scale: 1 }).width }); const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; await s.render({ canvasContext: c.getContext('2d'), viewport: vp, canvas: c }).promise; bilder.push(c.toDataURL('image/png')); }
      }
      aus[n] = { montserrat: /\/BaseFont \/[A-Z]*\+?Montserrat/.test(roh) || roh.includes('Montserrat'), helv: /\/BaseFont \/Helvetica/.test(roh), seiten: d.numPages, text: t, bilder };
    }
    return aus;
  });
  const fs = require('fs');
  for (const [n, r] of Object.entries(pdfs)) {
    ok(`PDF ${n}: Schrift Montserrat eingebettet`, r.montserrat, `${r.seiten} Seiten`);
    r.bilder.forEach((u, i) => fs.writeFileSync(`${AUS}/briefpapier-${n}-${i + 1}.png`, Buffer.from(u.split(',')[1], 'base64')));
  }
  ok('Brief: Umlaute und Sonderzeichen lesbar', /Straße, Grüße, Äpfel, Öl, Übergabe, Şahin/.test(pdfs.brief.text.replace(/\s+/g, ' ')), pdfs.brief.text.slice(0, 80).replace(/\s+/g, ' '));
  ok('Brief: Betrag mit €-Zeichen', /512,40\s€/.test(pdfs.brief.text));
  ok('Brief: Seitenzahlen', /Seite 1 von 2/.test(pdfs.brief.text) && pdfs.brief.seiten === 2, pdfs.brief.seiten);
  ok('Bericht: m² lesbar', pdfs.bericht.text.includes('72,5 m²'));

  // Einstellungen: früheres wiederherstellen und wieder zurück
  await p.goto('http://localhost:5179/#/einstellungen'); await p.waitForSelector('.briefpapier-karte', { timeout: 15000 }); await p.waitForTimeout(800);
  const karte = p.locator('.briefpapier-karte');
  ok('Einstellungen zeigen das App-Design', (await karte.innerText()).includes('KMS-Briefpapier (App-Design)'));
  await karte.screenshot({ path: AUS + '/briefpapier-einstellungen.png' });
  await karte.getByRole('button', { name: /Früheres Briefpapier wiederherstellen/ }).click(); await p.waitForTimeout(800);
  ok('Früheres Briefpapier wiederhergestellt', await wert('briefpapier_name') === 'Altes Briefpapier.pdf' && await wert('briefpapier_erste') === alt.url && await wert('briefpapier_kopf') === '1');
  await karte.getByRole('button', { name: /Briefpapier im App-Design verwenden/ }).click(); await p.waitForTimeout(1200);
  ok('App-Design wieder gewählt, Sicherung bleibt', await wert('briefpapier_name') === 'KMS-Briefpapier (App-Design)' && await wert('briefpapier_vorher_name') === 'Altes Briefpapier.pdf');
  ok('Keine Fehler in der Konsole', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();
})().catch((e) => { console.log('FEHLER', e.message); process.exit(1); });
