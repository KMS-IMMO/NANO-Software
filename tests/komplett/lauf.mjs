// Komplettest: startet die Vorschau (Demodaten im Browser) und prüft Abrechnungen, Bank, alle Seiten hell und dunkel,
// Mietverwaltung, Erfassen, Papierkorb, Excel-Import und Zählerstände. Aufruf: npm run komplettest. Ergebnis 0 = alles grün, sonst 1.
// Läuft vor jedem Update; schlägt etwas fehl, wird das Update nicht eingespielt.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..', '..');
const AUS = join(HIER, 'ausgabe'); mkdirSync(AUS, { recursive: true });
const PORT = 5179;

const frei = () => new Promise((ok) => { const s = net.createServer().once('error', () => ok(false)).once('listening', () => s.close(() => ok(true))).listen(PORT, '127.0.0.1'); });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
async function bereit() {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) return true; } catch { /* startet noch */ } await warte(1000); }
  return false;
}
function lauf(datei, env = {}) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [join(HIER, datei)], { cwd: WURZEL, env: { ...process.env, ...env, NEOSS_TEST_AUSGABE: AUS } });
    let aus = ''; p.stdout.on('data', (d) => { aus += d; }); p.stderr.on('data', (d) => { aus += d; });
    const t = setTimeout(() => p.kill('SIGKILL'), 15 * 60e3);
    p.on('close', (code) => { clearTimeout(t); ok({ code, aus }); });
  });
}

if (!(await frei())) { console.error(`Port ${PORT} ist belegt. Bitte die laufende Vorschau (vite) beenden und neu starten.`); process.exit(2); }
const vite = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: WURZEL, stdio: 'ignore', detached: process.platform !== 'win32' });
const ende = () => { try { process.platform === 'win32' ? vite.kill() : process.kill(-vite.pid, 'SIGTERM'); } catch { /* schon beendet */ } };
process.on('exit', ende); process.on('SIGINT', () => process.exit(130));

const ergebnis = [];
const melde = (name, gut, info = '') => { ergebnis.push({ name, gut, info }); console.log(`${gut ? 'OK  ' : 'FAIL'} ${name}${info ? ' – ' + info : ''}`); };
try {
  if (!(await bereit())) { melde('Vorschau startet', false, 'vite antwortet nicht'); throw 0; }
  await warte(2000);
  // 1) Simulation eines Abrechnungsjahres (WEG): Ergebnis muss genau dem erwarteten Stand entsprechen
  const sim = await lauf('sim.cjs', { TEIL2: '1', TEIL3: '1', UI: '1' });
  writeFileSync(join(AUS, 'sim.txt'), sim.aus);
  const ohneUi = (t) => t.split('\n').filter((z) => !z.startsWith('UI')).join('\n').trim();
  const soll = ohneUi(readFileSync(join(HIER, 'sim-erwartet.txt'), 'utf8')), ist = ohneUi(sim.aus);
  if (soll === ist) melde('Abrechnungsjahr WEG (Bank, Hausgeld, Abrechnung, Vermögensbericht)', true);
  else {
    const a = soll.split('\n'), b = ist.split('\n'); const i = a.findIndex((z, k) => z !== b[k]);
    melde('Abrechnungsjahr WEG (Bank, Hausgeld, Abrechnung, Vermögensbericht)', false, `Abweichung ab Zeile ${i + 1}: erwartet „${(a[i] ?? '').trim().slice(0, 120)}“, ist „${(b[i] ?? '').trim().slice(0, 120)}“ (ganz: ausgabe/sim.txt)`);
  }
  // 2) Alle Seiten hell und dunkel: keine Fehler, kein „undefined“/„NaN“
  for (const [datei, name] of [['crawl.cjs', 'Alle Seiten hell'], ['crawl-dunkel.cjs', 'Alle Seiten dunkel']]) {
    const r = await lauf(datei); writeFileSync(join(AUS, datei.replace('.cjs', '.txt')), r.aus);
    const errs = /^ERRS \[\]$/m.test(r.aus), auff = /^AUFFAELLIG \[\]$/m.test(r.aus), n = (r.aus.match(/^URLS (\d+)/m) ?? [])[1];
    melde(name, r.code === 0 && errs && auff, `${n ?? '?'} Seiten${errs ? '' : ', Fehler in der Konsole'}${auff ? '' : ', auffällige Texte'} (ausgabe/${datei.replace('.cjs', '.txt')})`);
  }
  // 3) Prüflisten: jede Zeile OK, keine FAIL
  for (const [datei, name] of [['neu.cjs', 'Mietverwaltung über ein Jahr'], ['erfassen.cjs', 'Schneller erfassen'], ['papierkorb.cjs', 'Papierkorb'], ['import.cjs', 'Excel-Import und Zählerstände'], ['anschrift.cjs', 'Anschrift Eigentümer (WEG)'], ['hausgeld-aufteilung.cjs', 'Hausgeld mit NK des Mieters (WEG)'], ['eigentuemer-klick.cjs', 'Klick auf Eigentümer und Mieter (WEG)'], ['rechnung-erfassen.cjs', 'Rechnung erfassen mit Konto-Rad'], ['einheit-ordner.cjs', 'Ordner je Einheit in der Ablage'], ['briefpapier.cjs', 'Briefpapier im App-Design und Schrift'], ['microsoft365.cjs', 'Kommunikation mit Microsoft 365 (Postfach, Akte, Kalender)'], ['jahressperre.cjs', 'Jahressperre nach Buchungsjahr'], ['splittbuchung.cjs', 'Splittbuchung auf mehrere Konten'], ['ruecklage-sonder.cjs', 'Rücklage-Sonderzuführung und EÜR-Häkchen'], ['abrechnung-anpassen.cjs', 'Gesamtkosten anpassen und Verbrauch in €'], ['pruefbericht.cjs', 'Befunde Prüfbericht: offene Rechnungen, Jahressperre Bank, Rücklage'], ['vollstaendig.cjs', 'Echtbetrieb: Systemkonten, Protokoll, Heizkosten, Mehrheiten, Kontenentwicklung, Mahngebühren'], ['ki-kontoabgleich.cjs', 'KI-Agent lokal und Kontoabgleich zur Jahresabrechnung'], ['zahler-objekt.cjs', 'Hausgeld-/Mietzahlung: nur Zahler der Liegenschaft, falsche Zuordnung reparieren'], ['handzahlung-datum.cjs', 'Als bezahlt buchen: Vorjahresposten am Fälligkeitstag, späte Handzahlungen datieren'], ['kontoabgleich-differenz.cjs', 'Kontoabgleich: Ursache einer Differenz finden und fehlenden Umsatz nachtragen'], ['oberflaeche.cjs', 'Oberfläche: Suche, mehrere Zahler/Gemeinschaft, Datum je Einheit, Kalender, Prozentprognose, Arial'], ['kontostand-ea.cjs', 'Einnahmen & Ausgaben mit Kontostand: Bankstatus, Verbinden statt doppelt buchen, bar, laufender Stand'], ['hausgeld-bearbeiten.cjs', 'Hausgeld-Stände bearbeiten und löschen'], ['kontostart.cjs', 'Einnahmen & Ausgaben: Kontostand zum 01.01. von Hand je Bankkonto und Jahr'], ['auszug-anfangsstand.cjs', 'Kontoauszug-CSV: Anfangsstand aus den Rechnungsabschlüssen, beim erneuten Einlesen übernehmen'], ['ruecklage-auszug.cjs', 'Rücklagen: Anfangs- und Endbestand laut Kontoauszug, Differenz nachbuchen'], ['abschluss-liste.cjs', 'Abschlüsse je Liegenschaft auflisten und den jüngsten löschen'], ['ignoriert.cjs', 'Einnahmen & Ausgaben: ignorierte Kontoumsätze nachträglich buchen, zurückholen, löschen'], ['differenz-gruende.cjs', 'Eigentümerabrechnung: Differenz in der Kontoentwicklung vollständig in Gründe zerlegt'], ['ruecklage-entnahme.cjs', 'WEG-Abrechnung: Entnahme aus der Erhaltungsrücklage mindert die Abrechnungsspitze']]) {
    const r = await lauf(datei); writeFileSync(join(AUS, datei.replace('.cjs', '.txt')), r.aus);
    const okN = (r.aus.match(/^OK /gm) ?? []).length, fail = r.aus.split('\n').filter((z) => /^(FAIL|FEHL)/.test(z));
    melde(name, r.code === 0 && okN > 0 && !fail.length, `${okN} Prüfungen grün${fail.length ? `, ${fail.length} rot: ${fail.join(' | ').slice(0, 300)}` : ''}${r.code ? `, Abbruch (Code ${r.code})` : ''}`);
  }
  // 4) PDF-Export nur Einnahmen / nur Ausgaben (eigene Zeile, damit weitere Prüflisten oben ohne Konflikt dazukommen)
  {
    const r = await lauf('export-einnahmen-ausgaben.cjs'); writeFileSync(join(AUS, 'export-einnahmen-ausgaben.txt'), r.aus);
    const okN = (r.aus.match(/^OK /gm) ?? []).length, fail = r.aus.split('\n').filter((z) => /^(FAIL|FEHL)/.test(z));
    melde('PDF-Export nur Einnahmen und nur Ausgaben', r.code === 0 && okN > 0 && !fail.length, `${okN} Prüfungen grün${fail.length ? `, ${fail.length} rot: ${fail.join(' | ').slice(0, 300)}` : ''}${r.code ? `, Abbruch (Code ${r.code})` : ''}`);
  }
  // 5) Bankkonten bearbeiten und löschen (eigene Zeile, damit weitere Prüflisten oben ohne Konflikt dazukommen)
  {
    const r = await lauf('bankkonten.cjs'); writeFileSync(join(AUS, 'bankkonten.txt'), r.aus);
    const okN = (r.aus.match(/^OK /gm) ?? []).length, fail = r.aus.split('\n').filter((z) => /^(FAIL|FEHL)/.test(z));
    melde('Bankkonten bearbeiten und löschen (Papierkorb, Buchungen behalten)', r.code === 0 && okN > 0 && !fail.length, `${okN} Prüfungen grün${fail.length ? `, ${fail.length} rot: ${fail.join(' | ').slice(0, 300)}` : ''}${r.code ? `, Abbruch (Code ${r.code})` : ''}`);
  }
  // 6) Manuelle Verteilung mit negativer Gesamtsumme (Gutschrift/Erstattung)
  {
    const r = await lauf('verteilung-negativ.cjs'); writeFileSync(join(AUS, 'verteilung-negativ.txt'), r.aus);
    const okN = (r.aus.match(/^OK /gm) ?? []).length, fail = r.aus.split('\n').filter((z) => /^(FAIL|FEHL)/.test(z));
    melde('Manuelle Verteilung mit negativen Beträgen (Gutschrift)', r.code === 0 && okN > 0 && !fail.length, `${okN} Prüfungen grün${fail.length ? `, ${fail.length} rot: ${fail.join(' | ').slice(0, 300)}` : ''}${r.code ? `, Abbruch (Code ${r.code})` : ''}`);
  }
} catch { /* Ergebnis steht unten */ }
const rot = ergebnis.filter((e) => !e.gut);
const text = `Komplettest ${new Date().toLocaleString('de-DE')}: ${rot.length ? `${rot.length} von ${ergebnis.length} ROT` : `alle ${ergebnis.length} Teile grün`}\n` + ergebnis.map((e) => `${e.gut ? 'OK  ' : 'FAIL'} ${e.name}${e.info ? ' – ' + e.info : ''}`).join('\n') + '\n';
writeFileSync(join(AUS, 'bericht.txt'), text);
console.log('\n' + text);
ende();
process.exit(rot.length || !ergebnis.length ? 1 : 0);
