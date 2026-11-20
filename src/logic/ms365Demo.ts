// Beispiel-Postfach für die Browser-Vorschau: antwortet wie Microsoft Graph auf die Anfragen, die NEOSS stellt.
// Nur Musterdaten, keine echten Namen.
type M = {
  id: string; subject: string; from: { emailAddress: { name: string; address: string } }; toRecipients: { emailAddress: { name?: string; address: string } }[];
  ccRecipients?: { emailAddress: { name?: string; address: string } }[];
  receivedDateTime: string; bodyPreview: string; isRead: boolean; hasAttachments: boolean; conversationId: string;
  inferenceClassification: 'focused' | 'other'; isDraft: boolean; text: string; anhaenge: { id: string; name: string; size: number; contentType: string; bytes: string }[];
};
type Box = Record<string, M[]>;

const ICH = { name: 'Muster Verwalter', address: 'verwalter@example.de' };
const ORDNER: [string, string][] = [['inbox', 'Posteingang'], ['drafts', 'Entwürfe'], ['sentitems', 'Gesendete Elemente'], ['outbox', 'Postausgang'], ['deleteditems', 'Gelöschte Elemente'], ['junkemail', 'Junk-E-Mail'], ['archive', 'Archiv']];
// Kleinstes gültiges PDF als Beispielanhang
const PDF = btoa('%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

let zaehler = 100;
const nid = () => 'm' + ++zaehler;
const vor = (tage: number, h = 9) => { const d = new Date(Date.now() - tage * 864e5); d.setHours(h, 12, 0, 0); return d.toISOString(); };
function mk(von: [string, string], betreff: string, text: string, tage: number, o: Partial<M> = {}): M {
  return {
    id: nid(), subject: betreff, from: { emailAddress: { name: von[0], address: von[1] } }, toRecipients: [{ emailAddress: { name: ICH.name, address: ICH.address } }],
    receivedDateTime: vor(tage, 8 + (zaehler % 9)), bodyPreview: text.replace(/\s+/g, ' ').slice(0, 120), isRead: false, hasAttachments: false,
    conversationId: 'c' + zaehler, inferenceClassification: 'focused', isDraft: false, text, anhaenge: [], ...o,
  };
}

const boxen: Record<string, Box> = {};
function box(adr: string): Box {
  const k = adr.toLowerCase();
  if (boxen[k]) return boxen[k];
  const b: Box = Object.fromEntries(ORDNER.map(([id]) => [id, []]));
  if (k === 'me') {
    b.inbox.push(
      mk(['Ahmet Yilmaz', 'yilmaz@example.de'], 'Frage zur Hausgeldabrechnung', 'Guten Tag,\n\nich habe eine Frage zur Position Hausmeister in der Hausgeldabrechnung. Warum ist sie höher als im Vorjahr?\n\nViele Grüße\nAhmet Yilmaz', 0),
      mk(['Anna Schmidt', 'schmidt@example.de'], 'Tropfender Wasserhahn Küche', 'Guten Tag,\n\nseit gestern tropft der Wasserhahn in der Küche. Können Sie bitte jemanden schicken? Ich bin vormittags zu Hause.\n\nFreundliche Grüße\nAnna Schmidt', 0),
      mk(['Sanitär Özdemir GmbH', 'info@example.de'], 'Rechnung 2026-0815 Heizungswartung', 'Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie unsere Rechnung für die Heizungswartung in der Lindenstraße 12.\n\nMit freundlichen Grüßen\nSanitär Özdemir GmbH', 1,
        { hasAttachments: true, anhaenge: [{ id: 'a1', name: 'Rechnung-2026-0815.pdf', size: 18342, contentType: 'application/pdf', bytes: PDF }] }),
      mk(['Newsletter Immobilienverband', 'news@example.org'], 'Neues zum Heizungsgesetz', 'Die wichtigsten Änderungen für Verwalter im Überblick.', 3, { isRead: true, inferenceClassification: 'other' }),
      mk(['Maria Wagner', 'wagner@example.de'], 'Danke für die Einladung', 'Hallo,\n\nvielen Dank, ich komme gern zur Versammlung.\n\nMaria Wagner', 6, { isRead: true }),
    );
    b.drafts.push(mk([ICH.name, ICH.address], 'Ankündigung Treppenhausreinigung', 'Sehr geehrte Mieterinnen und Mieter,\n\nab Januar übernimmt ein neuer Dienst die Reinigung …', 2, { isRead: true, isDraft: true, toRecipients: [{ emailAddress: { address: 'schmidt@example.de' } }] }));
    b.sentitems.push(mk([ICH.name, ICH.address], 'Nebenkostenabrechnung 2025', 'Sehr geehrte Frau Schmidt,\n\nanbei Ihre Nebenkostenabrechnung für 2025.\n\nMit freundlichen Grüßen\nMuster Verwalter', 12,
      { isRead: true, toRecipients: [{ emailAddress: { name: 'Anna Schmidt', address: 'schmidt@example.de' } }], hasAttachments: true, anhaenge: [{ id: 'a2', name: 'NK-Abrechnung-2025.pdf', size: 20311, contentType: 'application/pdf', bytes: PDF }] }));
  } else {
    const n = k.split('@')[0];
    b.inbox.push(mk(['Interessent Beispiel', 'interessent@example.net'], `Anfrage an ${n}`, `Guten Tag,\n\nich habe eine Frage an das Postfach „${n}“. Bitte melden Sie sich.\n\nMit freundlichen Grüßen`, 1));
  }
  return (boxen[k] = b);
}
function finde(b: Box, id: string): [string, number] | null {
  for (const [o, l] of Object.entries(b)) { const i = l.findIndex((m) => m.id === id); if (i >= 0) return [o, i]; }
  return null;
}
const ohne = (m: M) => { const { text: _t, anhaenge: _a, ...r } = m; return r; };
const events: Record<string, unknown> = {};

export function demoGraph(methode: string, pfad: string, body?: any): unknown {
  const [weg, such = ''] = pfad.split('?');
  const q = new URLSearchParams(such);
  let rest: string, adr: string;
  if (weg === '/me') return { displayName: ICH.name, mail: ICH.address };
  if (weg.startsWith('/me/')) { adr = 'me'; rest = weg.slice(3); }
  else { const m = weg.match(/^\/users\/([^/]+)(\/.*)$/); if (!m) throw new Error('Unbekannte Anfrage'); adr = decodeURIComponent(m[1]); rest = m[2]; }
  const b = box(adr);
  const t = rest.split('/').filter(Boolean);

  // Kalender
  if (t[0] === 'calendars' && t.length === 1) return { value: [{ id: 'kal-standard', name: 'Kalender', isDefaultCalendar: true }, { id: 'kal-kms', name: 'KMS Termine', isDefaultCalendar: false }] };
  if (t[0] === 'events' || (t[0] === 'calendars' && t[2] === 'events')) {
    const eid = t[0] === 'events' ? t[1] : t[3];
    if (methode === 'POST') { const id = 'e' + nid(); events[id] = body; return { id }; }
    if (methode === 'PATCH') { if (!events[eid]) throw new Error('Nicht gefunden'); events[eid] = body; return {}; }
    if (methode === 'DELETE') { delete events[eid]; return null; }
    return { value: Object.entries(events).map(([id, e]) => ({ id, ...(e as object) })) };
  }

  if (t[0] === 'mailFolders') {
    if (t.length === 1) return { value: ORDNER.map(([id, name]) => ({ id, displayName: name, unreadItemCount: b[id].filter((m) => !m.isRead).length, totalItemCount: b[id].length, childFolderCount: 0 })) };
    const o = t[1];
    if (t.length === 2) return { id: o, unreadItemCount: (b[o] ?? []).filter((m) => !m.isRead).length };
    if (t[2] === 'childFolders') return { value: [] };
    if (t[2] === 'messages') {
      let l = [...(b[o] ?? [])].sort((x, y) => y.receivedDateTime.localeCompare(x.receivedDateTime));
      const s = (q.get('$search') ?? '').replace(/"/g, '').toLowerCase();
      if (s) l = l.filter((m) => (m.subject + m.text + m.from.emailAddress.name).toLowerCase().includes(s));
      return { value: l.map(ohne) };
    }
  }
  if (t[0] === 'messages' && methode === 'POST' && t.length === 1) {
    const m = mk([ICH.name, ICH.address], body.subject ?? '', body.body?.content ?? '', 0, { isRead: true, isDraft: true, toRecipients: body.toRecipients ?? [],
      hasAttachments: !!body.attachments?.length, anhaenge: (body.attachments ?? []).map((a: any, i: number) => ({ id: 'n' + i, name: a.name, size: a.contentBytes?.length ?? 0, contentType: a.contentType, bytes: a.contentBytes })) });
    b.drafts.unshift(m);
    return { id: m.id, conversationId: m.conversationId };
  }
  if (t[0] === 'sendMail') {
    const n = body.message;
    b.sentitems.unshift(mk([ICH.name, ICH.address], n.subject, n.body?.content ?? '', 0, { isRead: true, toRecipients: n.toRecipients ?? [] }));
    return null;
  }
  if (t[0] === 'messages') {
    const f = finde(b, t[1]);
    if (!f) throw new Error('Diese Mail gibt es nicht mehr.');
    const m = b[f[0]][f[1]];
    if (t.length === 2) {
      if (methode === 'GET') return { ...ohne(m), body: { contentType: 'text', content: m.text } };
      if (methode === 'PATCH') { Object.assign(m, body); if (body.body?.content) m.text = body.body.content; return {}; }
      if (methode === 'DELETE') { b[f[0]].splice(f[1], 1); return null; }
    }
    if (t[2] === 'move') { b[f[0]].splice(f[1], 1); (b[body.destinationId] ??= []).unshift(m); return { id: m.id }; }
    if (t[2] === 'send') { b[f[0]].splice(f[1], 1); m.isDraft = false; m.receivedDateTime = new Date().toISOString(); b.sentitems.unshift(m); return null; }
    if (t[2] === 'attachments' && methode === 'POST') { m.anhaenge.push({ id: 'n' + nid(), name: body.name, size: body.contentBytes?.length ?? 0, contentType: body.contentType, bytes: body.contentBytes }); m.hasAttachments = true; return {}; }
    if (t[2] === 'attachments' && t[3]) { const a = m.anhaenge.find((x) => x.id === t[3]); if (!a) throw new Error('Anhang nicht gefunden'); return { ...a, contentBytes: a.bytes }; }
    if (t[2] === 'attachments') return { value: m.anhaenge.map(({ bytes: _b, ...a }) => a) };
    if (/^create(Reply|ReplyAll|Forward)$/.test(t[2])) {
      const fw = t[2] === 'createForward';
      const d = mk([ICH.name, ICH.address], (fw ? 'WG: ' : 'AW: ') + m.subject, `${body.comment ?? ''}\n\n-----\n${m.text}`, 0,
        { isRead: true, isDraft: true, conversationId: m.conversationId, toRecipients: fw ? body.toRecipients ?? [] : [{ emailAddress: m.from.emailAddress }] });
      b.drafts.unshift(d);
      return { id: d.id, conversationId: d.conversationId };
    }
  }
  throw new Error('Unbekannte Anfrage im Beispiel-Postfach: ' + methode + ' ' + rest);
}

/** Nur für Tests: legt eine Antwort in einer bestehenden Unterhaltung in den Posteingang */
export function demoAntwort(postfach: string, conversationId: string, von: [string, string], betreff: string, text: string) {
  const m = mk(von, betreff, text, 0, { conversationId });
  box(postfach).inbox.unshift(m);
  return m.id;
}
