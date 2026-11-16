// KI-Agent in NEOSS: ein Gesprächspartner, der Daten heraussucht, Abrechnungen prüft und wie ein Kollege antwortet.
// Standard ist ein lokales Modell über Ollama auf diesem Mac (http://127.0.0.1:11434): keine API, kein Internet, die Daten bleiben im Haus.
// Auf Wunsch kann in den Einstellungen Claude (Anthropic) eingeschaltet werden; dann gehen Fragen und gelesene Daten an Anthropic.
// Der Agent darf Daten nur LESEN. Termine, Erinnerungen und Aufgaben legt er nur nach einem Klick auf „Ja“ an.
import Anthropic from '@anthropic-ai/sdk';
import type { BetaContentBlock, BetaMessageParam, BetaToolResultBlockParam, BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { db, insert } from '../db';
import { abrechnungPruefen, pruefTextFuerKi } from './abrechnungPruefen';
import { abgleichText, kontoabgleich } from './kontoabgleich';

export type Anbieter = 'lokal' | 'claude';
export const KI_MODELLE: [string, string][] = [
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (Standard, ausgewogen)'],
  ['claude-opus-5-5', 'Claude Opus 5.5 (am stärksten, teurer)'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5 (schnell, günstig)'],
];
export const KI_STANDARD = KI_MODELLE[0][0];
/** Lokale Modelle nach Arbeitsspeicher des Mac: [Name in Ollama, Beschreibung] */
export const LOKAL_MODELLE: [string, string][] = [
  ['qwen3:8b', 'Qwen 3 · 8B (ab 16 GB Arbeitsspeicher, schnell)'],
  ['qwen3:14b', 'Qwen 3 · 14B (ab 24 GB, gute Mitte)'],
  ['qwen3:30b', 'Qwen 3 · 30B (ab 32 GB, am besten, trotzdem flott)'],
  ['mistral-small3.2', 'Mistral Small 3.2 · 24B (ab 32 GB, sehr gutes Deutsch)'],
];
export const LOKAL_STANDARD = 'qwen3:14b';
export const LOKAL_URL = 'http://127.0.0.1:11434';

export interface KiEinstellungen { anbieter: Anbieter; schluessel: string; modell: string; lokalModell: string; lokalUrl: string; stimme: string; vorlesen: boolean }

const setzen = (k: string, w: string) => db.execute(`INSERT INTO einstellungen (schluessel, wert) VALUES ($1, $2) ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert`, [k, w]);

export async function kiEinstellungen(): Promise<KiEinstellungen> {
  const r = await db.select(`SELECT schluessel, wert FROM einstellungen WHERE substr(schluessel, 1, 3) = 'ki_'`);
  const w = Object.fromEntries(r.map((x) => [x.schluessel, x.wert ?? '']));
  return {
    anbieter: w.ki_anbieter === 'claude' ? 'claude' : 'lokal',
    schluessel: (w.ki_api_key || '').trim(), modell: w.ki_modell || KI_STANDARD,
    lokalModell: w.ki_lokal_modell || LOKAL_STANDARD, lokalUrl: (w.ki_lokal_url || LOKAL_URL).replace(/\/+$/, ''),
    stimme: w.ki_stimme || '', vorlesen: w.ki_vorlesen === '1',
  };
}
export const kiSchluesselSpeichern = (schluessel: string) => setzen('ki_api_key', schluessel.trim());
export async function kiEinstellungSpeichern(e: Partial<KiEinstellungen>) {
  if (e.anbieter) await setzen('ki_anbieter', e.anbieter);
  if (e.modell) await setzen('ki_modell', e.modell);
  if (e.lokalModell) await setzen('ki_lokal_modell', e.lokalModell.trim());
  if (e.lokalUrl !== undefined) await setzen('ki_lokal_url', e.lokalUrl.trim() || LOKAL_URL);
  if (e.stimme !== undefined) await setzen('ki_stimme', e.stimme);
  if (e.vorlesen !== undefined) await setzen('ki_vorlesen', e.vorlesen ? '1' : '0');
}

/** Läuft Ollama, und welche Modelle sind geladen? */
export async function lokalStatus(url = LOKAL_URL): Promise<{ laeuft: boolean; modelle: string[] }> {
  try {
    const r = await fetch(`${url.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return { laeuft: false, modelle: [] };
    const j = await r.json();
    return { laeuft: true, modelle: (j.models ?? []).map((m: any) => String(m.name)) };
  } catch { return { laeuft: false, modelle: [] }; }
}

const SYSTEM = `Du bist der KI-Agent in NEOSS, der Verwaltungssoftware von KMS Immobilien in Köln (WEG-Verwaltung und Mietverwaltung).
Du sprichst mit Serkan oder seinen Mitarbeitern, wie ein erfahrener, freundlicher Kollege aus der Buchhaltung, der direkt nebenan sitzt.

Wie du redest:
- Deutsch, natürlich und locker-professionell, in ganzen Sätzen. Du duzt, wie es im Büro üblich ist.
- Komm direkt zur Sache: erst die Antwort, dann kurz, worauf sie beruht. Keine Floskeln wie „Gerne helfe ich dir“.
- Lieber zwei, drei klare Sätze als lange Listen. Eine kleine Tabelle nur, wenn wirklich viele Zahlen nebeneinander gehören.
- Wenn eine Frage unklar ist (zum Beispiel welches Objekt oder welches Jahr), frag kurz nach, statt zu raten. Gibt es nur eine sinnvolle Möglichkeit, nimm sie und sag dazu, wovon du ausgehst.
- Steht im Kontext „Gesprochen: ja“, antwortest du so, wie man es laut sagt: kurz, ohne Tabellen, ohne Aufzählungszeichen, Beträge gut sprechbar („rund 1.250 Euro“), höchstens vier Sätze. Biete an, Details zu zeigen.

Wie du arbeitest:
- Zahlen und Fakten nur aus der Datenbank. Erfinde nichts. Steht etwas nicht drin, sag das offen.
- Namen von Objekten, Personen oder Firmen findest du mit „suchen“. Damit bekommst du auch die ids.
- Soll eine Abrechnung geprüft werden, nimm „abrechnung_pruefen“. Die Prüfung rechnet NEOSS selbst mit festen Regeln. Erkläre die Befunde verständlich: zuerst die Probleme, dann Hinweise, zum Schluss kurz, was in Ordnung ist. Sag dazu, wo man es in NEOSS behebt.
- Für Anfangs- und Endbestand der Bankkonten und die Frage, ob alles aus den Kontoauszügen gebucht ist, nimm „kontoabgleich“.
- Abgelegte Dokumente (zum Beispiel eine Heizkostenabrechnung vom Messdienst oder eine Versorgerrechnung) findest du mit „dokumente_suchen“ und liest sie mit „dokument_lesen“. Vergleiche die Zahlen darin mit den Buchungen und nenne Abweichungen.
- Für alles andere: mit „schema_lesen“ die Tabellen ansehen und mit „sql_abfrage“ gezielt lesen.
- Beträge mit zwei Nachkommastellen im deutschen Format (1.234,56 €), Daten als TT.MM.JJJJ.
- Mit „seite_oeffnen“ kannst du die passende Seite in NEOSS öffnen, wenn das hilft.
- Termine, Erinnerungen und Aufgaben legst du nur an, wenn es gewünscht ist. Der Nutzer bestätigt jede Anlage per Klick. Lehnt er ab, akzeptiere das.
- Du kannst nichts löschen, ändern oder buchen. Wenn jemand das möchte, sag, wo er es in NEOSS selbst erledigt.
- Rechtliche oder steuerliche Fragen (WEG-Recht, BetrKV, § 35a EStG) beantwortest du allgemein und empfiehlst bei Einzelfällen eine fachliche Prüfung.

Zu den Daten: Datumswerte sind Text JJJJ-MM-TT. Beträge in Euro; bei Buchungen sind Ausgaben negativ und Einnahmen positiv.
Wichtige Tabellen: objekte, einheiten, personen, eigentum, mietvertraege, sollstellungen, buchungen, buchungskonten, rechnungen, bankkonten, bankumsaetze, abrechnungen, wirtschaftsplan, dokumente, termine, erinnerungen, todos, tickets.`;

const SEITEN: Record<string, string> = {
  '/': 'Dashboard', '/objekte': 'Immobilien', '/eigentuemer': 'Eigentümer', '/mieter': 'Mieter', '/firmen': 'Firmen/Dienstleister',
  '/vertraege': 'Mietverträge', '/sollstellungen': 'Sollstellungen', '/offene-posten': 'Offene Posten', '/rechnungen': 'Rechnungen',
  '/konten': 'Kontenrahmen', '/einstellungen': 'Einstellungen', '/bank': 'Bank', '/mahnungen': 'Mahnungen', '/nebenkosten': 'Nebenkostenabrechnung',
  '/weg-abrechnung': 'Hausgeldabrechnung (WEG)', '/eigentuemer-abrechnung': 'Eigentümerabrechnung', '/ablage': 'Ablage/Dokumente',
  '/instandhaltung': 'Instandhaltung', '/beschluesse': 'Beschlüsse', '/journal': 'Buchungsjournal', '/regeln': 'Buchungsregeln',
  '/auswertung': 'Auswertung', '/berichte': 'Berichte', '/verwalter': 'Verwalter', '/kontakte': 'Kontakte', '/kalender': 'Kalender',
  '/erinnerungen': 'Erinnerungen', '/fristen': 'Fristen (Wartung, Prüfung, Versicherung)', '/tickets': 'Tickets', '/todo': 'Aufgaben', '/notizen': 'Notizen',
};

type Schema = { type: 'object'; properties: Record<string, unknown>; required?: string[] };
type Werkzeug = { name: string; beschreibung: string; parameter: Schema };
const DATUM = { type: 'string', description: 'Datum im Format JJJJ-MM-TT' } as const;
const OBJEKT = { type: 'integer', description: 'Optional: id aus der Tabelle objekte' } as const;
const OBJ_JAHR: Schema = { type: 'object', properties: { objekt_id: { type: 'integer', description: 'id der Liegenschaft (mit „suchen“ finden)' }, jahr: { type: 'integer', description: 'Abrechnungsjahr, z. B. 2025' } }, required: ['objekt_id', 'jahr'] };
export const WERKZEUGE: Werkzeug[] = [
  { name: 'suchen', beschreibung: 'Sucht Liegenschaften, Einheiten, Personen (Eigentümer, Mieter) und Firmen nach Namen, Adresse oder Nummer. Liefert ids.',
    parameter: { type: 'object', properties: { text: { type: 'string', description: 'Suchbegriff, z. B. „Yilmaz“ oder „Lindenstraße“' } }, required: ['text'] } },
  { name: 'abrechnung_pruefen', beschreibung: 'Prüft die Jahresabrechnung einer Liegenschaft gegen die hinterlegten Daten: Prüfliste, Kosten seit Abschluss, Wirtschaftsplan, Heizkosten laut Messdienst, Vorauszahlungen, Belege, Rücklage und Kontoabgleich. Liefert Befunde (PROBLEM, HINWEIS, OK).',
    parameter: OBJ_JAHR },
  { name: 'kontoabgleich', beschreibung: 'Anfangs- und Endbestand je Bankkonto für ein Jahr, Vergleich mit dem Kontostand laut Kontoauszug zum 31.12. und Prüfung, ob alle Umsätze gebucht sind.',
    parameter: OBJ_JAHR },
  { name: 'dokumente_suchen', beschreibung: 'Sucht abgelegte Dokumente (PDFs) nach Dateiname oder Ordner, optional nur einer Liegenschaft.',
    parameter: { type: 'object', properties: { text: { type: 'string', description: 'Teil des Datei- oder Ordnernamens, z. B. „Heizkosten“' }, objekt_id: OBJEKT } } },
  { name: 'dokument_lesen', beschreibung: 'Liest den Text eines abgelegten PDF-Dokuments (höchstens 8 Seiten).',
    parameter: { type: 'object', properties: { id: { type: 'integer', description: 'id aus der Tabelle dokumente' } }, required: ['id'] } },
  { name: 'schema_lesen', beschreibung: 'Liefert die Tabellen der Datenbank mit ihren Spalten. Vor eigenem SQL aufrufen.',
    parameter: { type: 'object', properties: { tabellen: { type: 'string', description: 'Optional: Tabellennamen mit Komma, dann mit voller Definition' } } } },
  { name: 'sql_abfrage', beschreibung: 'Führt genau eine lesende SQLite-Abfrage (SELECT oder WITH) aus und liefert höchstens 200 Zeilen als JSON.',
    parameter: { type: 'object', properties: { sql: { type: 'string', description: 'Eine SELECT-Abfrage ohne Semikolon' } }, required: ['sql'] } },
  { name: 'seite_oeffnen', beschreibung: 'Öffnet eine Seite in NEOSS. Erlaubt: ' + Object.entries(SEITEN).map(([p, n]) => `${p} (${n})`).join(', ') + ', außerdem /objekte/<id> und /vertraege/<id>.',
    parameter: { type: 'object', properties: { pfad: { type: 'string' } }, required: ['pfad'] } },
  { name: 'termin_anlegen', beschreibung: 'Legt einen Termin im Kalender an. Der Nutzer muss zustimmen.',
    parameter: { type: 'object', properties: { titel: { type: 'string' }, datum: DATUM, uhrzeit: { type: 'string', description: 'Optional, HH:MM' }, objekt_id: OBJEKT, notiz: { type: 'string' } }, required: ['titel', 'datum'] } },
  { name: 'erinnerung_anlegen', beschreibung: 'Legt eine Erinnerung an. Der Nutzer muss zustimmen.',
    parameter: { type: 'object', properties: { titel: { type: 'string' }, faellig: DATUM, uhrzeit: { type: 'string', description: 'Optional, HH:MM' }, objekt_id: OBJEKT, notiz: { type: 'string' } }, required: ['titel', 'faellig'] } },
  { name: 'todo_anlegen', beschreibung: 'Legt eine Aufgabe in der To-do-Liste an. Der Nutzer muss zustimmen.',
    parameter: { type: 'object', properties: { text: { type: 'string' }, faellig: { ...DATUM, description: 'Optional, JJJJ-MM-TT' }, objekt_id: OBJEKT }, required: ['text'] } },
];

export type Bestaetigung = (titel: string, details: string[]) => Promise<boolean>;
export type Umgebung = { navigieren: (pfad: string) => void; bestaetigen: Bestaetigung; schritt?: (text: string) => void };

const de = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('.') : d ?? '');
const leer = (v: unknown) => v === undefined || v === null || v === '';
const zahlOder = (v: unknown) => (leer(v) ? NaN : Number(v));

async function objektName(id?: number) {
  if (leer(id)) return '';
  return (await db.select(`SELECT name FROM objekte WHERE id = $1`, [id]))[0]?.name ?? `Objekt ${id}`;
}

/** Spalten aus CREATE TABLE lesen: „tabelle(spalte, spalte, …)“ */
function kurzSchema(sql: string, name: string) {
  const innen = sql.replace(/--[^\n]*/g, '').slice(sql.replace(/--[^\n]*/g, '').indexOf('(') + 1, sql.replace(/--[^\n]*/g, '').lastIndexOf(')'));
  const teile: string[] = []; let tiefe = 0, akt = '';
  for (const c of innen) { if (c === '(') tiefe++; if (c === ')') tiefe--; if (c === ',' && !tiefe) { teile.push(akt); akt = ''; } else akt += c; }
  teile.push(akt);
  const spalten = teile.map((t) => t.trim()).filter((t) => t && !/^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)\b/i.test(t)).map((t) => t.split(/\s+/)[0]);
  return `${name}(${spalten.join(', ')})`;
}

export async function werkzeug(name: string, e: any, u: Umgebung): Promise<{ text: string; fehler?: boolean }> {
  e = e ?? {};
  switch (name) {
    case 'suchen': {
      u.schritt?.('Sucht im Bestand');
      const t = `%${String(e.text ?? '').trim()}%`;
      if (t === '%%') return { text: 'Bitte einen Suchbegriff angeben.', fehler: true };
      const [o, ei, p, f] = await Promise.all([
        db.select(`SELECT id, name, verwaltungsart, strasse, plz, ort FROM objekte WHERE name LIKE $1 OR strasse LIKE $1 OR ort LIKE $1 OR objekt_nr LIKE $1 LIMIT 20`, [t]),
        db.select(`SELECT e.id, e.nummer, e.objekt_id, o.name AS objekt FROM einheiten e JOIN objekte o ON o.id = e.objekt_id WHERE e.nummer LIKE $1 LIMIT 20`, [t]),
        db.select(`SELECT id, rolle, firma, vorname, nachname, ort, email FROM personen WHERE nachname LIKE $1 OR vorname LIKE $1 OR firma LIKE $1 OR (COALESCE(vorname, '') || ' ' || COALESCE(nachname, '')) LIKE $1 LIMIT 20`, [t]),
        db.select(`SELECT id, name, gewerk, ort FROM firmen WHERE name LIKE $1 OR gewerk LIKE $1 LIMIT 20`, [t]),
      ]);
      return { text: JSON.stringify({ objekte: o, einheiten: ei, personen: p, firmen: f }) };
    }
    case 'abrechnung_pruefen':
    case 'kontoabgleich': {
      const o = zahlOder(e.objekt_id), j = zahlOder(e.jahr);
      if (!Number.isInteger(o) || !Number.isInteger(j)) return { text: 'objekt_id und jahr fehlen. Erst mit „suchen“ die Liegenschaft finden und das Jahr klären.', fehler: true };
      try {
        if (name === 'kontoabgleich') { u.schritt?.('Gleicht die Bankkonten ab'); return { text: abgleichText(await kontoabgleich(o, j), j) }; }
        u.schritt?.('Prüft die Abrechnung');
        return { text: pruefTextFuerKi(await abrechnungPruefen(o, j)) };
      } catch (err: any) { return { text: 'Fehler: ' + (err?.message ?? String(err)), fehler: true }; }
    }
    case 'dokumente_suchen': {
      u.schritt?.('Sucht in der Ablage');
      const t = `%${String(e.text ?? '').trim()}%`, o = zahlOder(e.objekt_id);
      const r = await db.select(`SELECT d.id, d.dateiname, d.ordner, d.hinzugefuegt, d.bezug, d.bezug_id FROM dokumente d
        WHERE (d.dateiname LIKE $1 OR COALESCE(d.ordner, '') LIKE $1) ${Number.isInteger(o) ? `AND d.bezug = 'Objekt' AND d.bezug_id = ${o}` : ''} ORDER BY d.hinzugefuegt DESC, d.id DESC LIMIT 40`, [t]);
      return { text: JSON.stringify({ anzahl: r.length, dokumente: r }) };
    }
    case 'dokument_lesen': {
      u.schritt?.('Liest das Dokument');
      const d = (await db.select('SELECT * FROM dokumente WHERE id = $1', [zahlOder(e.id)]))[0];
      if (!d) return { text: 'Dokument nicht gefunden.', fehler: true };
      if (!/\.pdf$/i.test(d.dateiname)) return { text: `${d.dateiname} ist keine PDF. Lesen kann ich nur PDFs.`, fehler: true };
      const { lesen } = await import('../lib/dateien');
      const bytes = await lesen(d.pfad);
      if (!bytes) return { text: `Die Datei ${d.dateiname} wurde in der Ablage nicht gefunden.`, fehler: true };
      const { pdfText } = await import('./rechnungLesen');
      const t = (await pdfText(bytes, 8)).trim();
      return { text: t ? `${d.dateiname}:\n${t.slice(0, 15000)}${t.length > 15000 ? '\n[… gekürzt]' : ''}` : `${d.dateiname} enthält keinen lesbaren Text (vermutlich eingescannt).` };
    }
    case 'schema_lesen': {
      u.schritt?.('Schaut sich die Datenbank an');
      const t = await db.select(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('chat', 'einstellungen', '_schema') ORDER BY name`);
      const wahl = String(e.tabellen ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
      return { text: t.filter((x) => !wahl.length || wahl.includes(String(x.name).toLowerCase()))
        .map((x) => (wahl.length ? String(x.sql).replace(/\s+/g, ' ') : kurzSchema(String(x.sql), x.name))).join('\n') };
    }
    case 'sql_abfrage': {
      u.schritt?.('Liest Daten');
      const sql = String(e.sql ?? '').trim().replace(/;\s*$/, '');
      if (/\beinstellungen\b/i.test(sql)) return { text: 'Die Einstellungen sind geschützt.', fehler: true };
      try {
        const r = await db.selectLesend(sql);
        return { text: JSON.stringify({ anzahl: r.length, zeilen: r.slice(0, 200), gekuerzt: r.length > 200 }) };
      } catch (err: any) { return { text: 'Fehler: ' + (err?.message ?? String(err)), fehler: true }; }
    }
    case 'seite_oeffnen': {
      const p = String(e.pfad ?? '');
      if (!(p in SEITEN) && !/^\/(objekte|vertraege)\/\d+$/.test(p)) return { text: `Unbekannte Seite: ${p}`, fehler: true };
      u.navigieren(p);
      return { text: `Seite ${p} ist geöffnet.` };
    }
    case 'termin_anlegen':
    case 'erinnerung_anlegen':
    case 'todo_anlegen': {
      const art = name === 'termin_anlegen' ? 'Termin' : name === 'erinnerung_anlegen' ? 'Erinnerung' : 'Aufgabe';
      const titel = String(e.titel ?? e.text ?? '').trim();
      const datum = name === 'termin_anlegen' ? e.datum : e.faellig;
      if (!titel || (name !== 'todo_anlegen' && !/^\d{4}-\d{2}-\d{2}$/.test(String(datum ?? '')))) return { text: 'Titel und Datum (JJJJ-MM-TT) fehlen oder sind ungültig.', fehler: true };
      const obj = await objektName(e.objekt_id);
      const details = [titel, [de(datum), e.uhrzeit ? `${e.uhrzeit} Uhr` : ''].filter(Boolean).join(', '), obj, e.notiz ?? ''].filter(Boolean);
      if (!(await u.bestaetigen(`${art} anlegen?`, details))) return { text: `Der Nutzer hat abgelehnt. ${art} wurde nicht angelegt.` };
      const o = leer(e.objekt_id) ? null : Number(e.objekt_id);
      const id = name === 'termin_anlegen'
        ? await insert('termine', { titel, datum, uhrzeit: e.uhrzeit || null, objekt_id: o, notiz: e.notiz || null })
        : name === 'erinnerung_anlegen'
          ? await insert('erinnerungen', { titel, faellig: datum, uhrzeit: e.uhrzeit || null, objekt_id: o, notiz: e.notiz || null })
          : await insert('todos', { text: titel, faellig: datum || null, objekt_id: o });
      return { text: `${art} angelegt (id ${id}).` };
    }
  }
  return { text: `Unbekanntes Werkzeug ${name}`, fehler: true };
}

/** Verlauf des Gesprächs; das Format hängt vom Anbieter ab und wird beim Wechsel neu begonnen */
export type Verlauf = { anbieter: Anbieter; nachrichten: unknown[] };
export const neuerVerlauf = (): Verlauf => ({ anbieter: 'lokal', nachrichten: [] });

function nutzerText(frage: string, kontext: string, gesprochen: boolean) {
  const heute = new Date().toISOString().slice(0, 10);
  return `${frage}\n\n<kontext>Heute ist ${de(heute)}. Geöffnete Seite in NEOSS: ${kontext}. Gesprochen: ${gesprochen ? 'ja' : 'nein'}</kontext>`;
}

/** Schickt eine Frage an den Agenten, führt Werkzeuge aus und gibt den neuen Verlauf und die Antwort zurück. */
export async function kiFragen(verlauf: Verlauf, frage: string, kontext: string, u: Umgebung, opt: { gesprochen?: boolean } = {}): Promise<{ verlauf: Verlauf; antwort: string }> {
  const e = await kiEinstellungen();
  const alt = verlauf.anbieter === e.anbieter ? verlauf.nachrichten : [];
  const text = nutzerText(frage, kontext, !!opt.gesprochen);
  const r = e.anbieter === 'claude'
    ? await claudeFragen(e, alt as BetaMessageParam[], text, u)
    : await lokalFragen(e, alt as OllamaNachricht[], text, u);
  return { verlauf: { anbieter: e.anbieter, nachrichten: r.nachrichten }, antwort: r.antwort };
}

/* ---------- Lokal: Ollama auf diesem Mac ---------- */
type OllamaNachricht = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_calls?: { function: { name: string; arguments: any } }[]; tool_name?: string };

async function lokalFragen(e: KiEinstellungen, verlauf: OllamaNachricht[], text: string, u: Umgebung) {
  const v: OllamaNachricht[] = [...verlauf, { role: 'user', content: text }];
  const tools = WERKZEUGE.map((w) => ({ type: 'function', function: { name: w.name, description: w.beschreibung, parameters: w.parameter } }));
  let ohneDenken = true;
  for (let runde = 0; runde < 12; runde++) {
    const body: Record<string, unknown> = { model: e.lokalModell, messages: [{ role: 'system', content: SYSTEM }, ...v], tools, stream: false, keep_alive: '30m', options: { num_ctx: 16384, temperature: 0.4 } };
    if (ohneDenken) body.think = false;
    let r: Response;
    try { r = await fetch(`${e.lokalUrl}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    catch { throw new Error('LOKAL_AUS'); }
    if (!r.ok) {
      const t = await r.text();
      if (ohneDenken && /think/i.test(t)) { ohneDenken = false; runde--; continue; }   // Modell kennt den Schalter nicht
      if (r.status === 404 || /not found|pull/i.test(t)) throw new Error('LOKAL_MODELL:' + e.lokalModell);
      throw new Error('Lokales Modell: ' + t.slice(0, 200));
    }
    const j = await r.json();
    const m: OllamaNachricht = { role: 'assistant', content: String(j.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim() };
    if (j.message?.tool_calls?.length) m.tool_calls = j.message.tool_calls;
    v.push(m);
    if (!m.tool_calls?.length) return { nachrichten: v, antwort: m.content || '…' };
    for (const a of m.tool_calls) {
      let arg = a.function?.arguments;
      if (typeof arg === 'string') { try { arg = JSON.parse(arg); } catch { arg = {}; } }
      const ergebnis = await werkzeug(a.function?.name, arg, u);
      v.push({ role: 'tool', tool_name: a.function?.name, content: (ergebnis.fehler ? 'FEHLER: ' : '') + ergebnis.text.slice(0, 24000) });
    }
  }
  return { nachrichten: v, antwort: 'Das war mir zu verschachtelt. Kannst du die Frage etwas genauer stellen?' };
}

/* ---------- Claude (Anthropic), nur wenn in den Einstellungen eingeschaltet ---------- */
async function claudeFragen(e: KiEinstellungen, verlauf: BetaMessageParam[], text: string, u: Umgebung) {
  if (!e.schluessel) throw new Error('KEIN_SCHLUESSEL');
  const client = new Anthropic({ apiKey: e.schluessel, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const tools: BetaToolUnion[] = WERKZEUGE.map((w) => ({ name: w.name, description: w.beschreibung, input_schema: w.parameter }));
  const v: BetaMessageParam[] = [...verlauf, { role: 'user', content: text }];
  for (let runde = 0; runde < 15; runde++) {
    const r = await client.beta.messages.create({
      model: e.modell, max_tokens: 16000, system: SYSTEM, tools, tool_choice: { type: 'auto' },
      output_config: { effort: 'medium' }, cache_control: { type: 'ephemeral' },
      fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'], messages: v,
    });
    if (r.stop_reason === 'refusal') return { nachrichten: verlauf, antwort: 'Diese Anfrage kann ich leider nicht bearbeiten. Formuliere sie bitte anders.' };
    v.push({ role: 'assistant', content: r.content as BetaContentBlock[] as any });
    if (r.stop_reason === 'pause_turn') continue;
    const aufrufe = r.content.filter((b): b is Extract<BetaContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    if (r.stop_reason !== 'tool_use' || aufrufe.length === 0) {
      const t = r.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
      return { nachrichten: v, antwort: t || (r.stop_reason === 'max_tokens' ? 'Die Antwort wurde zu lang und abgeschnitten.' : '…') };
    }
    const ergebnisse: BetaToolResultBlockParam[] = [];
    for (const a of aufrufe) {
      const x = await werkzeug(a.name, a.input, u);
      ergebnisse.push({ type: 'tool_result', tool_use_id: a.id, content: x.text, ...(x.fehler ? { is_error: true } : {}) });
    }
    v.push({ role: 'user', content: ergebnisse });
  }
  return { nachrichten: v, antwort: 'Das war zu aufwendig. Stell die Frage bitte etwas genauer.' };
}

export function kiFehlerText(e: any): string {
  const m = String(e?.message ?? '');
  if (m === 'KEIN_SCHLUESSEL') return 'KEIN_SCHLUESSEL';
  if (m === 'LOKAL_AUS') return 'Das lokale KI-Programm (Ollama) läuft gerade nicht. Bitte Ollama auf diesem Mac starten, das Lama-Symbol erscheint dann oben in der Menüleiste.';
  if (m.startsWith('LOKAL_MODELL:')) return `Das Modell „${m.slice(13)}“ ist in Ollama noch nicht geladen. Unter Einstellungen → KI-Agent kannst du es herunterladen oder ein anderes wählen.`;
  const s = e?.status;
  if (s === 401) return 'Der API-Schlüssel ist ungültig. Bitte in den Einstellungen prüfen.';
  if (s === 429) return 'Zu viele Anfragen oder das Limit im Anthropic-Konto ist erreicht. Bitte kurz warten.';
  if (s === 529 || s === 503) return 'Claude ist gerade überlastet. Bitte gleich noch einmal versuchen.';
  if (s === 400 && /credit|balance/i.test(m)) return 'Das Guthaben im Anthropic-Konto ist aufgebraucht.';
  if (e?.name === 'APIConnectionError' || /fetch|network/i.test(m)) return 'Keine Verbindung zu Claude. Bitte die Internetverbindung prüfen.';
  return 'Fehler: ' + (m || String(e));
}

/** Modell in Ollama herunterladen (einmalig, einige GB). fortschritt bekommt 0–100. */
export async function lokalModellLaden(url: string, modell: string, fortschritt: (p: number, text: string) => void) {
  const r = await fetch(`${url.replace(/\/+$/, '')}/api/pull`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: modell, stream: true }) });
  if (!r.ok || !r.body) throw new Error(await r.text().catch(() => 'Herunterladen fehlgeschlagen'));
  const leser = r.body.getReader(); const dec = new TextDecoder(); let rest = '';
  for (;;) {
    const { done, value } = await leser.read(); if (done) break;
    rest += dec.decode(value, { stream: true });
    const zeilen = rest.split('\n'); rest = zeilen.pop() ?? '';
    for (const z of zeilen) {
      if (!z.trim()) continue;
      const j = JSON.parse(z);
      if (j.error) throw new Error(j.error);
      fortschritt(j.total ? Math.round((j.completed ?? 0) / j.total * 100) : 0, String(j.status ?? ''));
    }
  }
}
