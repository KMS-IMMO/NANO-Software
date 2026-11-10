// KI-Assistent: spricht direkt mit der Claude API (Anthropic) und darf die Daten der Verwaltung
// nur LESEN. Anlegen von Terminen, Erinnerungen und Aufgaben geht nur nach einem Klick auf „Ja“.
import Anthropic from '@anthropic-ai/sdk';
import type { BetaContentBlock, BetaMessageParam, BetaToolResultBlockParam, BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { db, insert } from '../db';

export const KI_MODELLE: [string, string][] = [
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (Standard, ausgewogen)'],
  ['claude-opus-5-5', 'Claude Opus 5.5 (am stärksten, teurer)'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5 (schnell, günstig)'],
];
export const KI_STANDARD = KI_MODELLE[0][0];

export async function kiEinstellungen(): Promise<{ schluessel: string; modell: string }> {
  const r = await db.select(`SELECT schluessel, wert FROM einstellungen WHERE schluessel IN ('ki_api_key', 'ki_modell')`);
  const w = Object.fromEntries(r.map((x) => [x.schluessel, x.wert ?? '']));
  return { schluessel: (w.ki_api_key || '').trim(), modell: w.ki_modell || KI_STANDARD };
}
export async function kiSchluesselSpeichern(schluessel: string) {
  await db.execute(`INSERT INTO einstellungen (schluessel, wert) VALUES ('ki_api_key', $1)
    ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert`, [schluessel.trim()]);
}

const SYSTEM = `Du bist der KI-Assistent in NEOSS, der Verwaltungssoftware von KMS Immobilien in Köln (WEG-Verwaltung und Mietverwaltung).
Du unterstützt die Mitarbeiter bei der täglichen Arbeit: Fragen zu Objekten, Einheiten, Eigentümern, Mietern, Verträgen, Sollstellungen, offenen Posten, Rechnungen, Buchungen, Abrechnungen, Terminen und Aufgaben.

So arbeitest du:
- Antworte auf Deutsch, kurz und freundlich, wie ein erfahrener Kollege in der Hausverwaltung.
- Stütze Zahlen und Fakten immer auf die Datenbank. Lies zuerst mit schema_lesen, welche Tabellen und Spalten es gibt, und frage dann mit sql_abfrage gezielt ab. Erfinde keine Daten. Wenn etwas nicht in der Datenbank steht, sag das.
- Beträge in Euro mit zwei Nachkommastellen und deutschem Format (1.234,56 €), Daten als TT.MM.JJJJ.
- Fasse Ergebnisse knapp zusammen. Bei Listen zeige die wichtigsten Einträge als kurze Aufzählung oder kleine Tabelle.
- Wenn es eine passende Seite in NEOSS gibt, kannst du sie mit seite_oeffnen öffnen.
- Termine, Erinnerungen und Aufgaben legst du nur an, wenn der Nutzer das möchte. Der Nutzer bestätigt jede Anlage selbst mit einem Klick. Lehnt er ab, akzeptiere das und lege es nicht erneut an.
- Du kannst nichts löschen oder ändern und keine Buchungen anlegen. Wenn jemand das möchte, erkläre, wo in NEOSS er es selbst erledigen kann.
- Rechtliche oder steuerliche Fragen (WEG-Recht, BetrKV, §35a EStG) beantwortest du allgemein und weist bei Einzelfällen auf fachliche Prüfung hin.

Hinweise zu den Daten: Datumswerte sind Text im Format JJJJ-MM-TT. Beträge sind Zahlen in Euro. Wichtige Tabellen sind unter anderem objekte, einheiten, personen, vertraege, sollstellungen, buchungen, rechnungen, termine, erinnerungen, todos, tickets.`;

const SEITEN: Record<string, string> = {
  '/': 'Dashboard', '/objekte': 'Immobilien', '/eigentuemer': 'Eigentümer', '/mieter': 'Mieter', '/firmen': 'Firmen/Dienstleister',
  '/vertraege': 'Mietverträge', '/sollstellungen': 'Sollstellungen', '/offene-posten': 'Offene Posten', '/rechnungen': 'Rechnungen',
  '/konten': 'Kontenrahmen', '/einstellungen': 'Einstellungen', '/bank': 'Bank', '/mahnungen': 'Mahnungen', '/nebenkosten': 'Nebenkostenabrechnung',
  '/weg-abrechnung': 'Hausgeldabrechnung (WEG)', '/eigentuemer-abrechnung': 'Eigentümerabrechnung', '/ablage': 'Ablage/Dokumente',
  '/instandhaltung': 'Instandhaltung', '/beschluesse': 'Beschlüsse', '/journal': 'Buchungsjournal', '/regeln': 'Buchungsregeln',
  '/auswertung': 'Auswertung', '/berichte': 'Berichte', '/verwalter': 'Verwalter', '/kontakte': 'Kontakte', '/kalender': 'Kalender',
  '/erinnerungen': 'Erinnerungen', '/fristen': 'Fristen (Wartung, Prüfung, Versicherung)', '/tickets': 'Tickets', '/todo': 'Aufgaben', '/notizen': 'Notizen',
};

const DATUM = { type: 'string', description: 'Datum im Format JJJJ-MM-TT' } as const;
const OBJEKT = { type: 'integer', description: 'Optional: id aus der Tabelle objekte' } as const;
const WERKZEUGE: BetaToolUnion[] = [
  { name: 'schema_lesen', description: 'Liefert alle Tabellen der NEOSS-Datenbank mit ihren Spalten. Zuerst aufrufen, bevor du SQL schreibst.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'sql_abfrage', description: 'Führt genau eine lesende SQLite-Abfrage (SELECT oder WITH) aus und liefert höchstens 200 Zeilen als JSON. Schreibende Befehle werden abgelehnt.',
    input_schema: { type: 'object', properties: { sql: { type: 'string', description: 'Eine SELECT-Abfrage ohne Semikolon' } }, required: ['sql'] } },
  { name: 'seite_oeffnen', description: 'Öffnet eine Seite in NEOSS. Erlaubte Pfade: ' + Object.entries(SEITEN).map(([p, n]) => `${p} (${n})`).join(', ') + ', außerdem /objekte/<id> für eine Liegenschaft und /vertraege/<id> für einen Vertrag.',
    input_schema: { type: 'object', properties: { pfad: { type: 'string' } }, required: ['pfad'] } },
  { name: 'termin_anlegen', description: 'Legt einen Termin im Kalender an. Der Nutzer muss zustimmen.',
    input_schema: { type: 'object', properties: { titel: { type: 'string' }, datum: DATUM, uhrzeit: { type: 'string', description: 'Optional, HH:MM' }, objekt_id: OBJEKT, notiz: { type: 'string' } }, required: ['titel', 'datum'] } },
  { name: 'erinnerung_anlegen', description: 'Legt eine Erinnerung an. Der Nutzer muss zustimmen.',
    input_schema: { type: 'object', properties: { titel: { type: 'string' }, faellig: DATUM, uhrzeit: { type: 'string', description: 'Optional, HH:MM' }, objekt_id: OBJEKT, notiz: { type: 'string' } }, required: ['titel', 'faellig'] } },
  { name: 'todo_anlegen', description: 'Legt eine Aufgabe in der To-do-Liste an. Der Nutzer muss zustimmen.',
    input_schema: { type: 'object', properties: { text: { type: 'string' }, faellig: { ...DATUM, description: 'Optional, JJJJ-MM-TT' }, objekt_id: OBJEKT }, required: ['text'] } },
];

export type Bestaetigung = (titel: string, details: string[]) => Promise<boolean>;
export type Umgebung = { navigieren: (pfad: string) => void; bestaetigen: Bestaetigung; schritt?: (text: string) => void };

const de = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('.') : d ?? '');
const leer = (v: unknown) => v === undefined || v === null || v === '';

async function objektName(id?: number) {
  if (leer(id)) return '';
  return (await db.select(`SELECT name FROM objekte WHERE id = $1`, [id]))[0]?.name ?? `Objekt ${id}`;
}

async function werkzeug(name: string, e: any, u: Umgebung): Promise<{ text: string; fehler?: boolean }> {
  switch (name) {
    case 'schema_lesen': {
      u.schritt?.('Schaut sich die Datenbank an');
      const t = await db.select(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('chat', 'einstellungen') ORDER BY name`);
      return { text: t.map((x) => String(x.sql).replace(/\s+/g, ' ')).join('\n') };
    }
    case 'sql_abfrage': {
      u.schritt?.('Liest Daten');
      const sql = String(e.sql ?? '').trim().replace(/;\s*$/, '');
      if (/\beinstellungen\b/i.test(sql) && /ki_api_key/i.test(sql)) return { text: 'Diese Einstellung ist geschützt.', fehler: true };
      try {
        const r = await db.selectLesend(sql);
        const zeilen = r.slice(0, 200).map((z) => { const k = { ...z }; if ('wert' in k && k.schluessel === 'ki_api_key') k.wert = '***'; return k; });
        return { text: JSON.stringify({ anzahl: r.length, zeilen, gekuerzt: r.length > 200 }) };
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

export type Verlauf = BetaMessageParam[];

/** Schickt eine Nutzerfrage an Claude, führt Werkzeuge aus und gibt den neuen Verlauf und die Antwort zurück. */
export async function kiFragen(verlauf: Verlauf, frage: string, kontext: string, u: Umgebung): Promise<{ verlauf: Verlauf; antwort: string }> {
  const { schluessel, modell } = await kiEinstellungen();
  if (!schluessel) throw new Error('KEIN_SCHLUESSEL');
  const client = new Anthropic({ apiKey: schluessel, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const heute = new Date().toISOString().slice(0, 10);
  // Kontext (Datum, geöffnete Seite) steht in der Nutzernachricht, damit System-Prompt und Werkzeuge gecacht bleiben
  const v: Verlauf = [...verlauf, { role: 'user', content: `${frage}\n\n<kontext>Heute ist ${de(heute)}. Geöffnete Seite in NEOSS: ${kontext}</kontext>` }];
  for (let runde = 0; runde < 15; runde++) {
    const r = await client.beta.messages.create({
      model: modell,
      max_tokens: 16000,
      system: SYSTEM,
      tools: WERKZEUGE,
      tool_choice: { type: 'auto' },
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01'],
      messages: v,
    });
    if (r.stop_reason === 'refusal') {
      return { verlauf: verlauf, antwort: 'Diese Anfrage kann ich leider nicht bearbeiten. Formuliere sie bitte anders.' };
    }
    v.push({ role: 'assistant', content: r.content as BetaContentBlock[] as any });
    if (r.stop_reason === 'pause_turn') continue;
    const aufrufe = r.content.filter((b): b is Extract<BetaContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    if (r.stop_reason !== 'tool_use' || aufrufe.length === 0) {
      const text = r.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
      return { verlauf: v, antwort: text || (r.stop_reason === 'max_tokens' ? 'Die Antwort wurde zu lang und abgeschnitten.' : '…') };
    }
    const ergebnisse: BetaToolResultBlockParam[] = [];
    for (const a of aufrufe) {
      const e = await werkzeug(a.name, a.input, u);
      ergebnisse.push({ type: 'tool_result', tool_use_id: a.id, content: e.text, ...(e.fehler ? { is_error: true } : {}) });
    }
    v.push({ role: 'user', content: ergebnisse });
  }
  return { verlauf: v, antwort: 'Das war zu aufwendig. Stell die Frage bitte etwas genauer.' };
}

export function kiFehlerText(e: any): string {
  if (e?.message === 'KEIN_SCHLUESSEL') return 'KEIN_SCHLUESSEL';
  const s = e?.status;
  if (s === 401) return 'Der API-Schlüssel ist ungültig. Bitte in den Einstellungen prüfen.';
  if (s === 429) return 'Zu viele Anfragen oder das Limit im Anthropic-Konto ist erreicht. Bitte kurz warten.';
  if (s === 529 || s === 503) return 'Claude ist gerade überlastet. Bitte gleich noch einmal versuchen.';
  if (s === 400 && /credit|balance/i.test(e?.message ?? '')) return 'Das Guthaben im Anthropic-Konto ist aufgebraucht.';
  if (e?.name === 'APIConnectionError' || /fetch|network/i.test(e?.message ?? '')) return 'Keine Verbindung zu Claude. Bitte die Internetverbindung prüfen.';
  return 'Fehler: ' + (e?.message ?? String(e));
}
