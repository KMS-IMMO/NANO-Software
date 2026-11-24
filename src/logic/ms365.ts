// Microsoft 365: Outlook-Mail und -Kalender über Microsoft Graph.
// In der App läuft jede Anfrage über Rust (Anmeldung im Schlüsselbund, kein Passwort in NEOSS).
// In der Browser-Vorschau antwortet ein Beispiel-Postfach (demoGraph), damit sich alles ausprobieren lässt.
import { db, type Row } from '../db';
import { demoGraph } from './ms365Demo';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const istDemo = !isTauri;

async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export type Konto = { name: string; mail: string };
export const MS_EVENT = 'neoss-ms365';
const melden = () => window.dispatchEvent(new Event(MS_EVENT));

let demoVerbunden = true;
export async function status(): Promise<Konto | null> {
  if (istDemo) return demoVerbunden ? { name: 'Muster Verwalter', mail: 'verwalter@example.de' } : null;
  return invoke<Konto | null>('ms_status');
}
export async function anmelden(clientId: string, tenant: string): Promise<Konto> {
  if (istDemo) { demoVerbunden = true; melden(); return (await status())!; }
  const k = await invoke<Konto>('ms_anmelden', { clientId, tenant });
  melden();
  return k;
}
export async function abmelden() {
  if (istDemo) demoVerbunden = false; else await invoke('ms_abmelden');
  melden();
}

/** Anfrage an Microsoft Graph (Pfad ab /me oder /users/…) */
export async function graph<T = any>(methode: 'GET' | 'POST' | 'PATCH' | 'DELETE', pfad: string, body?: unknown, text = false): Promise<T> {
  if (istDemo) {
    if (!demoVerbunden) throw new Error('Nicht mit Microsoft 365 verbunden.');
    return demoGraph(methode, pfad, body) as T;
  }
  return invoke<T>('ms_graph', { methode, pfad, body: body ?? null, text });
}

/* ---------------- Einstellungen ---------------- */
export async function einstellung(k: string): Promise<string | null> {
  return (await db.select(`SELECT wert FROM einstellungen WHERE schluessel = $1`, [k]))[0]?.wert ?? null;
}
export async function setzeEinstellung(k: string, v: string) {
  await db.execute(`INSERT INTO einstellungen (schluessel, wert) VALUES ($1, $2) ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert`, [k, v]);
}

/* ---------------- Postfächer ---------------- */
export type Postfach = { adresse: string; name: string; eigen: boolean };
export const basis = (p: string) => (p === 'me' ? '/me' : `/users/${encodeURIComponent(p)}`);

export async function freigegebene(): Promise<string[]> {
  try { const v = JSON.parse((await einstellung('ms_postfaecher')) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.includes('@')) : []; } catch { return []; }
}
export async function postfaecher(konto: Konto): Promise<Postfach[]> {
  const f = await freigegebene();
  return [{ adresse: 'me', name: konto.name || konto.mail, eigen: true },
    ...f.map((a) => ({ adresse: a, name: a.split('@')[0].replace(/^./, (c) => c.toUpperCase()), eigen: false }))];
}

export type Ordner = { id: string; displayName: string; unreadItemCount: number; totalItemCount: number; childFolderCount: number; kinder?: Ordner[] };
// Reihenfolge wie in Outlook; weitere Ordner danach alphabetisch
const REIHE = ['posteingang', 'inbox', 'entwürfe', 'drafts', 'gesendete elemente', 'sent items', 'postausgang', 'outbox', 'gelöschte elemente', 'deleted items', 'junk-e-mail', 'junk email', 'archiv', 'archive'];
const rang = (n: string) => { const i = REIHE.indexOf(n.toLowerCase()); return i < 0 ? 100 : i; };
const SEL_ORDNER = '$select=id,displayName,unreadItemCount,totalItemCount,childFolderCount';

export async function ordner(postfach: string): Promise<Ordner[]> {
  const r = await graph<{ value: Ordner[] }>('GET', `${basis(postfach)}/mailFolders?$top=100&${SEL_ORDNER}`);
  return (r.value ?? []).filter((o) => !/^(conversation history|unterhaltungsverlauf|sync issues|synchronisierungsprobleme)/i.test(o.displayName))
    .sort((a, b) => rang(a.displayName) - rang(b.displayName) || a.displayName.localeCompare(b.displayName, 'de'));
}
export async function unterordner(postfach: string, id: string): Promise<Ordner[]> {
  const r = await graph<{ value: Ordner[] }>('GET', `${basis(postfach)}/mailFolders/${id}/childFolders?$top=100&${SEL_ORDNER}`);
  return (r.value ?? []).sort((a, b) => a.displayName.localeCompare(b.displayName, 'de'));
}

export type Adresse = { emailAddress: { name?: string; address: string } };
export type Mail = {
  id: string; subject: string; from?: Adresse; toRecipients?: Adresse[]; ccRecipients?: Adresse[];
  receivedDateTime: string; bodyPreview?: string; isRead: boolean; hasAttachments: boolean; conversationId?: string;
  inferenceClassification?: 'focused' | 'other'; isDraft?: boolean; body?: { contentType: string; content: string };
};
const SEL_MAIL = '$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,isRead,hasAttachments,conversationId,inferenceClassification,isDraft';

export async function mails(postfach: string, ordnerId: string, suche = ''): Promise<Mail[]> {
  const q = suche.trim()
    ? `$search=${encodeURIComponent('"' + suche.replace(/"/g, '') + '"')}&$top=50&${SEL_MAIL}`
    : `$top=50&${SEL_MAIL}&$orderby=receivedDateTime desc`;
  const r = await graph<{ value: Mail[] }>('GET', `${basis(postfach)}/mailFolders/${ordnerId}/messages?${q}`);
  return r.value ?? [];
}
export async function mail(postfach: string, id: string): Promise<Mail> {
  return graph<Mail>('GET', `${basis(postfach)}/messages/${id}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,hasAttachments,conversationId,isRead,isDraft`, undefined, true);
}
export const gelesen = (p: string, id: string, ja = true) => graph('PATCH', `${basis(p)}/messages/${id}`, { isRead: ja });
export const verschieben = (p: string, id: string, ziel: string) => graph('POST', `${basis(p)}/messages/${id}/move`, { destinationId: ziel });
export const endgueltigLoeschen = (p: string, id: string) => graph('DELETE', `${basis(p)}/messages/${id}`);

export type Anhang = { id: string; name: string; size: number; contentType: string; isInline?: boolean };
export async function anhaenge(p: string, id: string): Promise<Anhang[]> {
  const r = await graph<{ value: Anhang[] }>('GET', `${basis(p)}/messages/${id}/attachments?$select=id,name,size,contentType,isInline`);
  return (r.value ?? []).filter((a) => !a.isInline);
}
export async function anhangLaden(p: string, mailId: string, id: string): Promise<Uint8Array> {
  const r = await graph<{ contentBytes?: string }>('GET', `${basis(p)}/messages/${mailId}/attachments/${id}`);
  if (!r.contentBytes) throw new Error('Dieser Anhang ist keine Datei.');
  return vonBase64(r.contentBytes);
}

/* ---------------- Senden ---------------- */
export type Datei = { name: string; bytes: Uint8Array };
export function inBase64(b: Uint8Array): string {
  let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export function vonBase64(t: string): Uint8Array {
  const s = atob(t); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b;
}
const typVon = (n: string) => (/\.pdf$/i.test(n) ? 'application/pdf' : /\.(png)$/i.test(n) ? 'image/png' : /\.(jpe?g)$/i.test(n) ? 'image/jpeg' : 'application/octet-stream');
const anhangJson = (d: Datei) => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: d.name, contentType: typVon(d.name), contentBytes: inBase64(d.bytes) });
export const adressen = (t: string): Adresse[] => t.split(/[;,]/).map((x) => x.trim()).filter(Boolean).map((x) => {
  const m = x.match(/^(.*)<([^>]+)>$/);
  return m ? { emailAddress: { name: m[1].trim().replace(/^"|"$/g, ''), address: m[2].trim() } } : { emailAddress: { address: x } };
});
export const GRENZE = 3 * 1024 * 1024;

export type Entwurf = {
  postfach: string; an: string; cc?: string; betreff: string; text: string; dateien: Datei[];
  modus?: 'neu' | 'antworten' | 'allen' | 'weiterleiten'; bezugId?: string;
};
/** Sendet die Mail (oder legt sie als Entwurf in Outlook ab) und liefert die Unterhaltung, falls bekannt */
export async function senden(e: Entwurf, nurEntwurf = false): Promise<{ conversationId?: string; id?: string }> {
  const groesse = e.dateien.reduce((s, d) => s + d.bytes.length, 0);
  if (groesse > GRENZE) throw new Error('Die Anhänge sind zusammen größer als 3 MB. Bitte kleinere Dateien wählen.');
  const b = basis(e.postfach);
  const modus = e.modus ?? 'neu';
  if (modus !== 'neu' && e.bezugId) {
    const art = modus === 'antworten' ? 'createReply' : modus === 'allen' ? 'createReplyAll' : 'createForward';
    const body: Row = { comment: e.text };
    if (modus === 'weiterleiten') body.toRecipients = adressen(e.an);
    const d = await graph<{ id: string; conversationId?: string }>('POST', `${b}/messages/${e.bezugId}/${art}`, body);
    if (modus !== 'weiterleiten' && e.an.trim()) await graph('PATCH', `${b}/messages/${d.id}`, { toRecipients: adressen(e.an), ...(e.cc?.trim() ? { ccRecipients: adressen(e.cc) } : {}) });
    for (const f of e.dateien) await graph('POST', `${b}/messages/${d.id}/attachments`, anhangJson(f));
    if (!nurEntwurf) await graph('POST', `${b}/messages/${d.id}/send`);
    return { conversationId: d.conversationId, id: d.id };
  }
  const nachricht = {
    subject: e.betreff, body: { contentType: 'Text', content: e.text },
    toRecipients: adressen(e.an), ...(e.cc?.trim() ? { ccRecipients: adressen(e.cc) } : {}),
    attachments: e.dateien.map(anhangJson),
  };
  if (nurEntwurf) {
    const d = await graph<{ id: string; conversationId?: string }>('POST', `${b}/messages`, nachricht);
    return { conversationId: d.conversationId, id: d.id };
  }
  // Erst als Entwurf anlegen und dann senden: so kennt NEOSS die Unterhaltung und erkennt später Antworten
  const d = await graph<{ id: string; conversationId?: string }>('POST', `${b}/messages`, nachricht);
  await graph('POST', `${b}/messages/${d.id}/send`);
  return { conversationId: d.conversationId };
}

/* ---------------- Akte ---------------- */
export type Zuordnung = { art: 'person' | 'firma'; id: number; name: string; rolle: string; objekt_id?: number | null; objekt?: string | null };

export async function zuordnen(adr: string[]): Promise<Zuordnung | null> {
  const liste = [...new Set(adr.map((a) => a.trim().toLowerCase()).filter(Boolean))];
  if (!liste.length) return null;
  const ph = liste.map((_, i) => `$${i + 1}`).join(', ');
  const p = (await db.select(`SELECT p.id, p.rolle, COALESCE(NULLIF(TRIM(COALESCE(p.vorname, '') || ' ' || COALESCE(p.nachname, '')), ''), p.firma) AS name,
      COALESCE((SELECT e.objekt_id FROM eigentum ei JOIN einheiten e ON e.id = ei.einheit_id WHERE ei.person_id = p.id LIMIT 1),
               (SELECT e.objekt_id FROM mietvertraege v JOIN einheiten e ON e.id = v.einheit_id WHERE v.mieter_id = p.id OR v.mieter2_id = p.id ORDER BY v.beginn DESC LIMIT 1),
               (SELECT o.id FROM objekte o WHERE o.eigentuemer_id = p.id LIMIT 1)) AS objekt_id
    FROM personen p WHERE LOWER(TRIM(p.email)) IN (${ph}) LIMIT 1`, liste))[0];
  if (p) {
    const o = p.objekt_id ? (await db.select(`SELECT name FROM objekte WHERE id = $1`, [p.objekt_id]))[0]?.name : null;
    return { art: 'person', id: p.id, name: p.name ?? '', rolle: p.rolle ?? 'Kontakt', objekt_id: p.objekt_id, objekt: o };
  }
  const f = (await db.select(`SELECT id, name, gewerk FROM firmen WHERE LOWER(TRIM(email)) IN (${ph}) LIMIT 1`, liste))[0];
  if (f) return { art: 'firma', id: f.id, name: f.name, rolle: f.gewerk ? `Dienstleister · ${f.gewerk}` : 'Dienstleister' };
  return null;
}

export type Ablage = {
  postfach: string; graph_id?: string | null; conversation_id?: string | null; richtung: 'ein' | 'aus';
  von: string; an: string; betreff: string; datum: string; text: string; anhaenge?: string[];
  person_id?: number | null; firma_id?: number | null; objekt_id?: number | null;
};
export async function zurAkte(a: Ablage): Promise<number> {
  if (a.graph_id) {
    const da = (await db.select(`SELECT id FROM mails WHERE graph_id = $1`, [a.graph_id]))[0];
    if (da) return da.id;
  }
  const r = await db.execute(`INSERT INTO mails (postfach, graph_id, conversation_id, richtung, von, an, betreff, datum, text, anhaenge, person_id, firma_id, objekt_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [a.postfach, a.graph_id ?? null, a.conversation_id ?? null, a.richtung, a.von, a.an, a.betreff, a.datum, a.text, (a.anhaenge ?? []).join('; ') || null,
      a.person_id ?? null, a.firma_id ?? null, a.objekt_id ?? null]);
  return Number(r.lastInsertId) || 0;
}
export async function abgelegt(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const r = await db.select(`SELECT graph_id FROM mails WHERE graph_id IN (${ids.map((_, i) => `$${i + 1}`).join(', ')})`, ids);
  return new Set(r.map((x) => x.graph_id));
}
export const adrText = (a?: Adresse) => (a ? (a.emailAddress.name && a.emailAddress.name !== a.emailAddress.address ? `${a.emailAddress.name} <${a.emailAddress.address}>` : a.emailAddress.address) : '');

/** Antworten auf Mails aus der Akte automatisch zur Akte legen (gleiche Unterhaltung) */
export async function antwortenAblegen(postfach: string, liste: Mail[]) {
  if ((await einstellung('ms_akte_auto')) === '0') return 0;
  const conv = [...new Set(liste.map((m) => m.conversationId).filter(Boolean))] as string[];
  if (!conv.length) return 0;
  const bekannt = await db.select(`SELECT conversation_id, person_id, firma_id, objekt_id FROM mails WHERE conversation_id IN (${conv.map((_, i) => `$${i + 1}`).join(', ')})`, conv);
  if (!bekannt.length) return 0;
  const schon = await abgelegt(liste.map((m) => m.id));
  let n = 0;
  for (const m of liste) {
    const b = bekannt.find((x) => x.conversation_id === m.conversationId);
    if (!b || schon.has(m.id) || m.isDraft) continue;
    const voll = await mail(postfach, m.id).catch(() => null);
    await zurAkte({ postfach, graph_id: m.id, conversation_id: m.conversationId, richtung: 'ein', von: adrText(m.from), an: (m.toRecipients ?? []).map(adrText).join('; '),
      betreff: m.subject ?? '', datum: m.receivedDateTime, text: voll?.body?.content ?? m.bodyPreview ?? '', person_id: b.person_id, firma_id: b.firma_id, objekt_id: b.objekt_id });
    n++;
  }
  return n;
}

/* ---------------- Textvorlagen ---------------- */
export async function vorlagen(): Promise<Row[]> { return db.select(`SELECT * FROM mail_vorlagen ORDER BY id`); }
export const PLATZHALTER = ['Briefanrede', 'Name', 'Objekt', 'Einheit', 'Betrag', 'Frist', 'Mahnstufe', 'Jahr', 'Dokument', 'Sachbearbeiter'];
export const fuellen = (t: string, w: Record<string, string | undefined>) =>
  (t ?? '').replace(/\{([A-Za-zÄÖÜäöüß]+)\}/g, (all, k) => (w[k] != null && w[k] !== '' ? String(w[k]) : all));
export function briefanrede(p?: Row | null): string {
  if (!p) return 'Sehr geehrte Damen und Herren';
  const name = [p.titel, p.nachname].filter(Boolean).join(' ');
  if (p.anrede === 'Frau' && name) return `Sehr geehrte Frau ${name}`;
  if (p.anrede === 'Herr' && name) return `Sehr geehrter Herr ${name}`;
  return 'Sehr geehrte Damen und Herren';
}

/* ---------------- Kalender ---------------- */
const plusStunden = (d: string, t: string, h: number) => {
  const x = new Date(`${d}T${t}:00Z`); x.setUTCMinutes(x.getUTCMinutes() + h * 60);
  return x.toISOString().slice(0, 19);
};
const naechsterTag = (d: string) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
function ereignis(titel: string, datum: string, uhrzeit: string | null, dauer: number, ort: string | null, notiz: string, erinnerung: number) {
  const ganz = !uhrzeit;
  const zeit = (uhrzeit ?? '00:00').slice(0, 5);
  return {
    subject: titel,
    body: { contentType: 'Text', content: (notiz ? notiz + '\n\n' : '') + 'Eingetragen von NEOSS. Änderungen bitte in NEOSS vornehmen.' },
    start: { dateTime: ganz ? `${datum}T00:00:00` : `${datum}T${zeit}:00`, timeZone: 'Europe/Berlin' },
    end: { dateTime: ganz ? `${naechsterTag(datum)}T00:00:00` : plusStunden(datum, zeit, dauer), timeZone: 'Europe/Berlin' },
    isAllDay: ganz, showAs: ganz ? 'free' : 'busy',
    ...(ort ? { location: { displayName: ort } } : {}),
    isReminderOn: true, reminderMinutesBeforeStart: erinnerung,
  };
}

/** Termine, Versammlungen und Fristen aus NEOSS in den Outlook-Kalender übertragen (neu, geändert, gelöscht) */
export async function kalenderAbgleich(): Promise<{ neu: number; geaendert: number; geloescht: number } | null> {
  if ((await einstellung('ms_kalender')) === '0') return null;
  if (!(await status())) return null;
  const kal = await einstellung('ms_kalender_id');
  const pfad = kal ? `/me/calendars/${encodeURIComponent(kal)}/events` : '/me/events';
  const ab = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const soll: { quelle: string; id: number; daten: Row }[] = [];
  for (const t of await db.select(`SELECT t.*, o.name AS objekt FROM termine t LEFT JOIN objekte o ON o.id = t.objekt_id WHERE t.datum >= $1`, [ab]))
    soll.push({ quelle: 'termin', id: t.id, daten: ereignis(t.titel + (t.objekt ? ` · ${t.objekt}` : ''), t.datum, t.uhrzeit, 1, t.objekt ?? null, t.notiz ?? '', 60) });
  for (const v of await db.select(`SELECT v.*, o.name AS objekt, o.strasse, o.plz, o.ort AS stadt FROM versammlungen v JOIN objekte o ON o.id = v.objekt_id WHERE v.datum >= $1`, [ab]))
    soll.push({ quelle: 'versammlung', id: v.id, daten: ereignis(`${v.art ?? 'Eigentümerversammlung'} ${v.objekt}`, v.datum, v.uhrzeit || v.beginn || null, 2, v.ort || [v.strasse, [v.plz, v.stadt].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null, v.notiz ?? '', 1440) });
  for (const f of await db.select(`SELECT f.*, o.name AS objekt FROM fristen f LEFT JOIN objekte o ON o.id = f.objekt_id WHERE f.erledigt_am IS NULL AND f.faellig >= $1`, [ab]))
    soll.push({ quelle: 'frist', id: f.id, daten: ereignis(`Frist: ${f.titel}${f.objekt ? ` · ${f.objekt}` : ''}`, f.faellig, null, 0, null, f.notiz ?? '', 7 * 1440) });

  const ist = await db.select(`SELECT * FROM outlook_termine`);
  let neu = 0, geaendert = 0, geloescht = 0;
  const anlegen = async (s: typeof soll[number], stand: string) => {
    const e = await graph<{ id: string }>('POST', pfad, s.daten);
    await db.execute(`INSERT INTO outlook_termine (quelle, quelle_id, event_id, stand) VALUES ($1, $2, $3, $4) ON CONFLICT (quelle, quelle_id) DO UPDATE SET event_id = excluded.event_id, stand = excluded.stand`, [s.quelle, s.id, e.id, stand]);
  };
  for (const s of soll) {
    const stand = JSON.stringify(s.daten);
    const m = ist.find((x) => x.quelle === s.quelle && x.quelle_id === s.id);
    if (!m) { await anlegen(s, stand); neu++; continue; }
    if (m.stand === stand) continue;
    try {
      await graph('PATCH', `/me/events/${encodeURIComponent(m.event_id)}`, s.daten);
      await db.execute(`UPDATE outlook_termine SET stand = $1 WHERE quelle = $2 AND quelle_id = $3`, [stand, s.quelle, s.id]);
    } catch { await anlegen(s, stand); } // in Outlook gelöscht: neu anlegen
    geaendert++;
  }
  // In NEOSS gelöschte oder erledigte Einträge auch in Outlook entfernen (vergangene bleiben stehen)
  const tabelle: Record<string, string> = { termin: `SELECT id FROM termine WHERE id = $1`, versammlung: `SELECT id FROM versammlungen WHERE id = $1`, frist: `SELECT id FROM fristen WHERE id = $1 AND erledigt_am IS NULL` };
  for (const m of ist) {
    if (soll.some((s) => s.quelle === m.quelle && s.id === m.quelle_id)) continue;
    const da = tabelle[m.quelle] ? (await db.select(tabelle[m.quelle], [m.quelle_id])).length > 0 : false;
    if (da) continue;
    await graph('DELETE', `/me/events/${encodeURIComponent(m.event_id)}`).catch(() => {});
    await db.execute(`DELETE FROM outlook_termine WHERE quelle = $1 AND quelle_id = $2`, [m.quelle, m.quelle_id]);
    geloescht++;
  }
  await setzeEinstellung('ms_kalender_stand', new Date().toISOString());
  return { neu, geaendert, geloescht };
}
let abgleichLaeuft: Promise<unknown> | null = null;
/** Abgleich im Hintergrund, Fehler werden nur gemerkt */
export function kalenderImHintergrund() {
  if (abgleichLaeuft) return;
  abgleichLaeuft = kalenderAbgleich().catch((e) => setzeEinstellung('ms_kalender_fehler', String(e?.message ?? e)).catch(() => {}))
    .finally(() => { abgleichLaeuft = null; });
}

/** Ungelesene Mails in den Posteingängen aller Postfächer */
export async function ungelesen(): Promise<number> {
  const k = await status(); if (!k) return 0;
  let n = 0;
  for (const p of await postfaecher(k)) {
    try { n += (await graph<{ unreadItemCount: number }>('GET', `${basis(p.adresse)}/mailFolders/inbox?$select=unreadItemCount`)).unreadItemCount || 0; } catch { /* Postfach ohne Zugriff */ }
  }
  return n;
}
