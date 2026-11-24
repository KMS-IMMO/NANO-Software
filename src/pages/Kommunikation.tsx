// Kommunikation: Postfach wie in Outlook (eigenes Konto und freigegebene Postfächer), Textvorlagen, Verbindung zu Microsoft 365.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Archive, ChevronDown, ChevronRight, FileText, Folder, FolderInput, Forward, Inbox, Mail as MailIcon, MailOpen, Paperclip, Pencil, Plus, RefreshCw,
  Reply, ReplyAll, Search, Send, Trash2, TriangleAlert, Unplug,
} from 'lucide-react';
import { db, type Row } from '../db';
import {
  abgelegt, abmelden, adrText, anhaenge, anhangLaden, anmelden, antwortenAblegen, basis, einstellung, endgueltigLoeschen, freigegebene, gelesen, graph,
  istDemo, kalenderAbgleich, mail as mailLaden, mails as mailsLaden, MS_EVENT, ordner as ordnerLaden, postfaecher, PLATZHALTER, setzeEinstellung, status,
  unterordner, verschieben, zuordnen, zurAkte, type Anhang, type Konto, type Mail, type Ordner, type Postfach, type Zuordnung,
} from '../logic/ms365';
import { MailFenster, type MailStart } from '../components/MailFenster';
import { RechnungErfassen } from '../components/RechnungErfassen';
import { oeffnen, speichern } from '../lib/dateien';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

function zeit(iso: string) {
  const d = new Date(iso), h = new Date();
  if (d.toDateString() === h.toDateString()) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const gestern = new Date(h.getTime() - 864e5);
  if (d.toDateString() === gestern.toDateString()) return 'Gestern';
  if (h.getTime() - d.getTime() < 6 * 864e5) return d.toLocaleDateString('de-DE', { weekday: 'short' });
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: d.getFullYear() === h.getFullYear() ? undefined : '2-digit' });
}
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const istPosteingang = (n: string) => /^(posteingang|inbox)$/i.test(n);
const istGeloescht = (n: string) => /^(gelöschte elemente|deleted items)$/i.test(n);
const istEntwurf = (n: string) => /^(entwürfe|drafts)$/i.test(n);
const istGesendet = (n: string) => /^(gesendete elemente|sent items)$/i.test(n);
function ordnerSymbol(n: string) {
  if (istPosteingang(n)) return <Inbox size={15} />;
  if (istEntwurf(n)) return <Pencil size={15} />;
  if (istGesendet(n)) return <Send size={15} />;
  if (istGeloescht(n)) return <Trash2 size={15} />;
  if (/junk/i.test(n)) return <TriangleAlert size={15} />;
  if (/^archiv/i.test(n)) return <Archive size={15} />;
  return <Folder size={15} />;
}

/** Hinweis, wenn noch keine Verbindung besteht */
function NichtVerbunden() {
  return (
    <section className="card ms-leer">
      <div className="ms-logo"><i /><i /><i /><i /></div>
      <h2>Noch nicht mit Microsoft 365 verbunden</h2>
      <p className="muted">Melde dich einmal mit deinem Microsoft-Konto an. Danach siehst du hier dein Postfach und die freigegebenen Postfächer.</p>
      <Link to="/microsoft-365"><button className="primary">Zur Anmeldung</button></Link>
    </section>
  );
}

/* =================== Postfach =================== */

type Wahl = { postfach: string; id: string; name: string };

export function PostfachPage() {
  const [konto, setKonto] = useState<Konto | null | undefined>(undefined);
  const [boxen, setBoxen] = useState<Postfach[]>([]);
  const [offen, setOffen] = useState<Record<string, boolean>>({ me: true });
  const [baum, setBaum] = useState<Record<string, Ordner[] | string>>({});
  const [kinderOffen, setKinderOffen] = useState<Record<string, boolean>>({});
  const [ungelesenBox, setUngelesenBox] = useState<Record<string, number>>({});
  const [wahl, setWahl] = useState<Wahl | null>(null);
  const [liste, setListe] = useState<Mail[]>([]);
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState('');
  const [fokus, setFokus] = useState<'focused' | 'other'>('focused');
  const [suche, setSuche] = useState('');
  const [aktiv, setAktiv] = useState<string | null>(null);
  const [voll, setVoll] = useState<Mail | null>(null);
  const [anh, setAnh] = useState<Anhang[]>([]);
  const [zu, setZu] = useState<Zuordnung | null>(null);
  const [inAkte, setInAkte] = useState<Set<string>>(new Set());
  const [fenster, setFenster] = useState<MailStart | null>(null);
  const [info, setInfo] = useState('');
  const [verschiebenOffen, setVerschiebenOffen] = useState(false);
  const [loeschFrage, setLoeschFrage] = useState(false);
  const [personWahl, setPersonWahl] = useState(false);
  const [ausgabe, setAusgabe] = useState<File | null>(null);
  const [stand, setStand] = useState(0);

  useEffect(() => {
    const neu = () => setStand((s) => s + 1);
    window.addEventListener(MS_EVENT, neu);
    return () => window.removeEventListener(MS_EVENT, neu);
  }, []);
  useEffect(() => {
    (async () => {
      const k = await status().catch(() => null);
      setKonto(k);
      if (!k) return;
      const b = await postfaecher(k);
      setBoxen(b);
      ordnerHolen('me', true);
      // Ungelesene der zugeklappten Postfächer
      for (const x of b.filter((y) => !y.eigen)) {
        graph<{ unreadItemCount: number }>('GET', `${basis(x.adresse)}/mailFolders/inbox?$select=unreadItemCount`)
          .then((r) => setUngelesenBox((u) => ({ ...u, [x.adresse]: r.unreadItemCount || 0 }))).catch(() => setUngelesenBox((u) => ({ ...u, [x.adresse]: -1 })));
      }
    })();
  }, [stand]);

  async function ordnerHolen(p: string, auswaehlen = false) {
    try {
      const o = await ordnerLaden(p);
      setBaum((b) => ({ ...b, [p]: o }));
      if (auswaehlen) { const i = o.find((x) => istPosteingang(x.displayName)) ?? o[0]; if (i) waehle({ postfach: p, id: i.id, name: i.displayName }); }
    } catch (e: any) { setBaum((b) => ({ ...b, [p]: String(e?.message ?? e) })); }
  }
  async function kinderHolen(p: string, o: Ordner) {
    const k = `${p}|${o.id}`;
    const zu = !!kinderOffen[k];
    setKinderOffen((x) => ({ ...x, [k]: !zu }));
    if (zu || o.kinder) return;
    const kinder = await unterordner(p, o.id).catch(() => []);
    setBaum((b) => {
      const setze = (l: Ordner[]): Ordner[] => l.map((x) => (x.id === o.id ? { ...x, kinder } : x.kinder ? { ...x, kinder: setze(x.kinder) } : x));
      return { ...b, [p]: Array.isArray(b[p]) ? setze(b[p] as Ordner[]) : b[p] };
    });
  }
  function postfachKlick(p: string) {
    const auf = !offen[p];
    setOffen((x) => ({ ...x, [p]: auf }));
    if (auf && !baum[p]) ordnerHolen(p);
  }

  async function listeLaden(w: Wahl, q = '') {
    setLaedt(true); setFehler('');
    try {
      const l = await mailsLaden(w.postfach, w.id, q);
      setListe(l);
      setInAkte(await abgelegt(l.map((m) => m.id)));
      if (istPosteingang(w.name)) {
        const n = await antwortenAblegen(w.postfach, l).catch(() => 0);
        if (n) { setInAkte(await abgelegt(l.map((m) => m.id))); setInfo(`${n} ${n === 1 ? 'Antwort wurde' : 'Antworten wurden'} automatisch zur Akte gelegt.`); }
      }
    } catch (e: any) { setListe([]); setFehler(String(e?.message ?? e)); }
    setLaedt(false);
  }
  function waehle(w: Wahl) {
    setWahl(w); setAktiv(null); setVoll(null); setSuche(''); setFokus('focused'); setInfo('');
    listeLaden(w);
  }
  async function oeffneMail(m: Mail) {
    if (!wahl) return;
    setAktiv(m.id); setVoll(null); setAnh([]); setZu(null); setVerschiebenOffen(false); setLoeschFrage(false); setPersonWahl(false);
    try {
      const v = await mailLaden(wahl.postfach, m.id);
      setVoll(v);
      if (!m.isRead) { gelesen(wahl.postfach, m.id).catch(() => {}); setListe((l) => l.map((x) => (x.id === m.id ? { ...x, isRead: true } : x))); }
      if (v.hasAttachments) setAnh(await anhaenge(wahl.postfach, m.id).catch(() => []));
      const gesendet = istGesendet(wahl.name) || istEntwurf(wahl.name);
      const adr = gesendet ? (v.toRecipients ?? []).map((a) => a.emailAddress.address) : [v.from?.emailAddress.address ?? ''];
      setZu(await zuordnen(adr));
    } catch (e: any) { setFehler(String(e?.message ?? e)); }
  }

  const gezeigt = useMemo(() => {
    const mitFokus = wahl && wahl.postfach === 'me' && istPosteingang(wahl.name) && !suche;
    return mitFokus ? liste.filter((m) => (m.inferenceClassification ?? 'focused') === fokus) : liste;
  }, [liste, fokus, wahl, suche]);

  async function ablegenAkte(z: Zuordnung) {
    if (!voll || !wahl) return;
    const gesendet = istGesendet(wahl.name);
    await zurAkte({
      postfach: wahl.postfach, graph_id: voll.id, conversation_id: voll.conversationId ?? null, richtung: gesendet ? 'aus' : 'ein',
      von: adrText(voll.from), an: (voll.toRecipients ?? []).map(adrText).join('; '), betreff: voll.subject ?? '', datum: voll.receivedDateTime,
      text: voll.body?.content ?? '', anhaenge: anh.map((a) => a.name),
      person_id: z.art === 'person' ? z.id : null, firma_id: z.art === 'firma' ? z.id : null, objekt_id: z.objekt_id ?? null,
    });
    setInAkte((s) => new Set([...s, voll.id]));
    setZu(z); setPersonWahl(false);
    setInfo(`Die Mail liegt jetzt in der Akte von ${z.name}.`);
  }
  async function loeschen() {
    if (!voll || !wahl) return;
    try {
      if (istGeloescht(wahl.name)) await endgueltigLoeschen(wahl.postfach, voll.id);
      else await verschieben(wahl.postfach, voll.id, 'deleteditems');
      setListe((l) => l.filter((m) => m.id !== voll.id)); setVoll(null); setAktiv(null); setLoeschFrage(false);
      setInfo(istGeloescht(wahl.name) ? 'Endgültig gelöscht.' : 'In „Gelöschte Elemente“ verschoben.');
    } catch (e: any) { setFehler(String(e?.message ?? e)); }
  }
  async function verschiebeNach(o: Ordner) {
    if (!voll || !wahl) return;
    try {
      await verschieben(wahl.postfach, voll.id, o.id);
      setListe((l) => l.filter((m) => m.id !== voll.id)); setVoll(null); setAktiv(null); setVerschiebenOffen(false);
      setInfo(`Nach „${o.displayName}“ verschoben.`);
    } catch (e: any) { setFehler(String(e?.message ?? e)); }
  }
  async function ungelesenMarkieren() {
    if (!voll || !wahl) return;
    await gelesen(wahl.postfach, voll.id, false).catch(() => {});
    setListe((l) => l.map((x) => (x.id === voll.id ? { ...x, isRead: false } : x)));
  }
  async function anhangAktion(a: Anhang, art: 'oeffnen' | 'ablage' | 'ausgabe') {
    if (!voll || !wahl) return;
    try {
      const bytes = await anhangLaden(wahl.postfach, voll.id, a.id);
      if (art === 'ausgabe') { setAusgabe(new File([bytes as BlobPart], a.name, { type: a.contentType || 'application/pdf' })); return; }
      if (art === 'ablage') {
        let pfad: string;
        if (zu?.objekt_id) {
          const o = (await db.select(`SELECT name FROM objekte WHERE id = $1`, [zu.objekt_id]))[0];
          pfad = await speichern(bytes, a.name, { bezug: 'Objekt', bezugId: zu.objekt_id, ordner: [o?.name ?? 'Liegenschaft', 'E-Mail-Anhänge'] });
        } else if (zu) {
          pfad = await speichern(bytes, a.name, { bezug: zu.art === 'person' ? 'Person' : 'Firma', bezugId: zu.id, ordner: [zu.art === 'person' ? 'Personen' : 'Firmen', zu.name, 'E-Mail-Anhänge'] });
        } else {
          pfad = await speichern(bytes, a.name, { bezug: 'Person', bezugId: 0, ordner: ['E-Mail-Anhänge'] });
        }
        setInfo(`„${a.name}“ liegt in der Ablage.`);
        return void pfad;
      }
      if (!isTauri) {
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: a.contentType }));
        const x = document.createElement('a'); x.href = url; x.download = a.name; x.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
        return;
      }
      const { downloadDir, join } = await import('@tauri-apps/api/path');
      const { writeFile } = await import('@tauri-apps/plugin-fs');
      const ziel = await join(await downloadDir(), a.name.replace(/[<>:"/\\|?*]/g, '-'));
      await writeFile(ziel, bytes);
      oeffnen(ziel);
    } catch (e: any) { setFehler(String(e?.message ?? e)); }
  }
  function antworten(modus: 'antworten' | 'allen' | 'weiterleiten') {
    if (!voll || !wahl) return;
    const an = modus === 'weiterleiten' ? '' : modus === 'antworten' ? adrText(voll.from)
      : [voll.from, ...(voll.toRecipients ?? [])].filter((x) => x && x.emailAddress.address.toLowerCase() !== (konto?.mail ?? '').toLowerCase()).map((x) => adrText(x!)).join('; ');
    setFenster({ postfach: wahl.postfach, modus, bezugId: voll.id, an, titel: `${modus === 'weiterleiten' ? 'Weiterleiten' : 'Antworten'}: ${voll.subject ?? ''}`,
      betreff: voll.subject ?? '', akte: zu ? { person_id: zu.art === 'person' ? zu.id : null, firma_id: zu.art === 'firma' ? zu.id : null, objekt_id: zu.objekt_id, name: zu.name } : null });
  }

  if (konto === undefined) return <div className="page-head"><h1 className="title-ico"><MailIcon size={26} />Postfach</h1></div>;
  if (konto === null) return <><div className="page-head"><h1 className="title-ico"><MailIcon size={26} />Postfach</h1></div><NichtVerbunden /></>;

  const boxOrdner = (p: string) => (Array.isArray(baum[p]) ? (baum[p] as Ordner[]) : []);
  const flach = (l: Ordner[]): Ordner[] => l.flatMap((o) => [o, ...(o.kinder ? flach(o.kinder) : [])]);

  function OrdnerZeile({ p, o, tiefe }: { p: string; o: Ordner; tiefe: number }) {
    const k = `${p}|${o.id}`;
    const an = wahl?.postfach === p && wahl.id === o.id;
    return (
      <>
        <button className={'ol-f' + (an ? ' an' : '')} style={{ paddingLeft: 10 + tiefe * 14 }} onClick={() => waehle({ postfach: p, id: o.id, name: o.displayName })}>
          {o.childFolderCount > 0
            ? <span className="ol-pfeil" onClick={(e) => { e.stopPropagation(); kinderHolen(p, o); }}>{kinderOffen[k] ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
            : <span className="ol-pfeil" />}
          {ordnerSymbol(o.displayName)}<span className="ol-fname">{o.displayName}</span>
          {o.unreadItemCount > 0 && !istGesendet(o.displayName) && <span className="ol-n">{istEntwurf(o.displayName) ? o.totalItemCount : o.unreadItemCount}</span>}
        </button>
        {kinderOffen[k] && o.kinder?.map((c) => <OrdnerZeile key={c.id} p={p} o={c} tiefe={tiefe + 1} />)}
      </>
    );
  }

  return (
    <>
      <div className="page-head ol-kopf">
        <h1 className="title-ico"><MailIcon size={26} />Postfach</h1>
        <div className="row">
          <form className="ol-suche" onSubmit={(e) => { e.preventDefault(); if (wahl) listeLaden(wahl, suche); }}>
            <Search size={15} /><input id="ol-suche" placeholder={wahl ? `Suchen in ${wahl.name}` : 'Suchen'} value={suche} onChange={(e) => setSuche(e.target.value)} />
          </form>
          <button className="icon-btn" title="Aktualisieren" onClick={() => { setStand((s) => s + 1); if (wahl) listeLaden(wahl); }}><RefreshCw size={17} /></button>
          <button className="primary" onClick={() => setFenster({ postfach: wahl?.postfach ?? 'me' })}><Plus size={16} />Neue E-Mail</button>
        </div>
      </div>
      {istDemo && <p className="muted small" style={{ marginTop: -6 }}>Vorschau mit einem Beispiel-Postfach. In der installierten App siehst du hier dein Outlook.</p>}
      {info && <p className="info" style={{ marginTop: 0, marginBottom: 10 }}>{info}</p>}
      <div className="ol">
        <nav className="ol-ordner" aria-label="Ordner">
          {boxen.map((b, i) => (
            <div key={b.adresse}>
              {i === 1 && <div className="ol-gruppe">Freigegebene Postfächer</div>}
              <button className="ol-konto" title={b.eigen ? konto.mail : b.adresse} onClick={() => postfachKlick(b.adresse)}>
                {offen[b.adresse] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="ol-kname">{b.name}</span>
                {!b.eigen && <small>{b.adresse.toLowerCase()}</small>}
                {!offen[b.adresse] && (ungelesenBox[b.adresse] ?? 0) > 0 && <span className="ol-n">{ungelesenBox[b.adresse]}</span>}
              </button>
              {offen[b.adresse] && (typeof baum[b.adresse] === 'string'
                ? <p className="ol-fehlt small">{baum[b.adresse] as string}</p>
                : !baum[b.adresse] ? <p className="ol-fehlt small muted">Lädt …</p>
                  : boxOrdner(b.adresse).map((o) => <OrdnerZeile key={o.id} p={b.adresse} o={o} tiefe={0} />))}
            </div>))}
          <Link to="/microsoft-365" className="ol-verwalten small">Postfächer verwalten</Link>
        </nav>

        <div className="ol-liste">
          <div className="ol-lkopf">
            <b>{wahl ? wahl.name : 'Postfach'}{wahl && wahl.postfach !== 'me' && <small className="muted"> · {wahl.postfach.toLowerCase()}</small>}</b>
            {wahl?.postfach === 'me' && istPosteingang(wahl.name) && !suche && <span className="ol-reiter">
              <button className={fokus === 'focused' ? 'an' : ''} onClick={() => setFokus('focused')}>Relevant</button>
              <button className={fokus === 'other' ? 'an' : ''} onClick={() => setFokus('other')}>Sonstige</button></span>}
          </div>
          {fehler && <p className="ol-fehlt small">{fehler}</p>}
          {laedt && !liste.length && <p className="ol-fehlt muted small">Lädt …</p>}
          {!laedt && !fehler && !gezeigt.length && <p className="ol-fehlt muted small">{suche ? 'Nichts gefunden.' : 'Hier ist nichts.'}</p>}
          {gezeigt.map((m) => {
            const gesendet = wahl && (istGesendet(wahl.name) || istEntwurf(wahl.name));
            const wer = gesendet ? (m.toRecipients ?? []).map((a) => a.emailAddress.name || a.emailAddress.address).join(', ') : (m.from?.emailAddress.name || m.from?.emailAddress.address);
            return (
              <button key={m.id} className={'ol-m' + (!m.isRead ? ' neu' : '') + (aktiv === m.id ? ' an' : '')} onClick={() => oeffneMail(m)}>
                <div className="k"><span className="von">{m.isDraft ? <em className="neg">[Entwurf] </em> : null}{wer || '(ohne Empfänger)'}</span><span className="zt">{zeit(m.receivedDateTime)}</span></div>
                <div className="betr">{m.hasAttachments && <Paperclip size={12} />}{m.subject || '(ohne Betreff)'}</div>
                <div className="vor">{m.bodyPreview}</div>
                {inAkte.has(m.id) && <span className="ol-akte">in der Akte</span>}
              </button>);
          })}
        </div>

        <article className="ol-lesen">
          {!voll ? <div className="ol-leer muted">{aktiv ? 'Lädt …' : 'Wähle eine Mail aus.'}</div> : (
            <>
              <div className="ol-aktionen">
                {voll.isDraft
                  ? <button onClick={() => setFenster({ postfach: wahl!.postfach, an: (voll.toRecipients ?? []).map(adrText).join('; '), betreff: voll.subject, text: voll.body?.content ?? '' })}><Pencil size={14} />Weiter bearbeiten</button>
                  : <>
                    <button onClick={() => antworten('antworten')}><Reply size={14} />Antworten</button>
                    <button onClick={() => antworten('allen')}><ReplyAll size={14} />Allen antworten</button>
                    <button onClick={() => antworten('weiterleiten')}><Forward size={14} />Weiterleiten</button></>}
                <button onClick={() => setLoeschFrage(true)}><Trash2 size={14} />Löschen</button>
                <span className="ol-menue">
                  <button onClick={() => setVerschiebenOffen(!verschiebenOffen)}><FolderInput size={14} />Verschieben</button>
                  {verschiebenOffen && <div className="ol-pop">{flach(boxOrdner(wahl!.postfach)).filter((o) => o.id !== wahl!.id).map((o) =>
                    <button key={o.id} onClick={() => verschiebeNach(o)}>{ordnerSymbol(o.displayName)}{o.displayName}</button>)}</div>}
                </span>
                <button onClick={ungelesenMarkieren}><MailOpen size={14} />Ungelesen</button>
              </div>
              {loeschFrage && <div className="ol-frage">
                <span>{istGeloescht(wahl!.name) ? 'Diese Mail endgültig löschen? Das lässt sich nicht rückgängig machen.' : 'Diese Mail nach „Gelöschte Elemente“ verschieben?'}</span>
                <button onClick={() => setLoeschFrage(false)}>Abbrechen</button><button className="danger" onClick={loeschen}>Löschen</button></div>}
              <h2 className="ol-betreff">{voll.subject || '(ohne Betreff)'}</h2>
              <div className="ol-absender">
                <div className="ol-avatar">{(voll.from?.emailAddress.name || voll.from?.emailAddress.address || '?').split(/[\s@.]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</div>
                <div className="ol-wer">
                  <b>{voll.from?.emailAddress.name || voll.from?.emailAddress.address}</b> <span className="muted small">{voll.from?.emailAddress.address}</span>
                  <div className="muted small">An: {(voll.toRecipients ?? []).map(adrText).join('; ') || '–'}{voll.ccRecipients?.length ? ` · Cc: ${voll.ccRecipients.map(adrText).join('; ')}` : ''}</div>
                  <div className="muted small">{new Date(voll.receivedDateTime).toLocaleString('de-DE', { dateStyle: 'full', timeStyle: 'short' })}</div>
                </div>
              </div>
              <div className="ol-neoss">
                {zu ? <span>Gehört zu: <b>{zu.name}</b> · {zu.rolle}{zu.objekt ? ` · ${zu.objekt}` : ''}</span> : <span>Keiner Akte zugeordnet</span>}
                <span className="grow" />
                {inAkte.has(voll.id) ? <span className="pill bezahlt">In der Akte</span> : <>
                  {zu && <button className="primary small-btn" onClick={() => ablegenAkte(zu)}>In Akte ablegen</button>}
                  <button className="small-btn" onClick={() => setPersonWahl(!personWahl)}>{zu ? 'Andere Akte' : 'Akte wählen'}</button></>}
              </div>
              {personWahl && <AkteWahl onWahl={ablegenAkte} />}
              {anh.length > 0 && <div className="ol-anh">
                {anh.map((a) => (
                  <div key={a.id} className="mail-datei">
                    <b className="mail-pdf">{(a.name.split('.').pop() ?? '').toUpperCase().slice(0, 4)}</b>{a.name} · {kb(a.size)}
                    <button className="link" onClick={() => anhangAktion(a, 'oeffnen')}>Öffnen</button>
                    <button className="link" onClick={() => anhangAktion(a, 'ablage')}>In Ablage</button>
                    {/\.pdf$/i.test(a.name) && <button className="link" onClick={() => anhangAktion(a, 'ausgabe')}>Als Ausgabe erfassen</button>}
                  </div>))}
              </div>}
              <pre className="ol-text">{voll.body?.content ?? ''}</pre>
            </>)}
        </article>
      </div>
      {fenster && <MailFenster start={fenster} onClose={() => setFenster(null)} onGesendet={(t) => { setInfo(t); if (wahl) listeLaden(wahl); }} />}
      {ausgabe && (
        <div className="modal-bg" onClick={() => setAusgabe(null)}>
          <div className="modal breit" onClick={(e) => e.stopPropagation()}>
            <div className="card-head"><h3>Rechnung aus der Mail erfassen</h3><span className="muted small">{ausgabe.name}</span></div>
            <RechnungErfassen objektFest={zu?.objekt_id ?? undefined} vorlage={{ datei: ausgabe }} onSaved={(t) => { setInfo(t); setAusgabe(null); }} />
          </div>
        </div>)}
    </>
  );
}

/** Person oder Firma für die Akte suchen */
function AkteWahl({ onWahl }: { onWahl: (z: Zuordnung) => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Row[]>([]);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setRes([]); return; }
    const like = `%${t}%`;
    Promise.all([
      db.select(`SELECT 'person' AS art, id, rolle, COALESCE(NULLIF(TRIM(COALESCE(vorname, '') || ' ' || COALESCE(nachname, '')), ''), firma) AS name FROM personen
        WHERE vorname LIKE $1 OR nachname LIKE $1 OR firma LIKE $1 OR email LIKE $1 LIMIT 8`, [like]),
      db.select(`SELECT 'firma' AS art, id, 'Dienstleister' AS rolle, name FROM firmen WHERE name LIKE $1 OR email LIKE $1 LIMIT 5`, [like]),
    ]).then(([a, b]) => setRes([...a, ...b]));
  }, [q]);
  return (
    <div className="ol-akte-wahl">
      <input autoFocus placeholder="Name eines Mieters, Eigentümers oder Dienstleisters" value={q} onChange={(e) => setQ(e.target.value)} />
      {res.map((r) => <button key={r.art + r.id} onClick={() => onWahl({ art: r.art, id: r.id, name: r.name ?? '', rolle: r.rolle ?? '' })}>{r.name} <span className="muted small">{r.rolle}</span></button>)}
    </div>
  );
}

/* =================== Textvorlagen =================== */

export function TextvorlagenPage() {
  const [liste, setListe] = useState<Row[]>([]);
  const [wahl, setWahl] = useState<Row | null>(null);
  const [info, setInfo] = useState('');
  const laden = async (id?: number) => {
    const l = await db.select(`SELECT * FROM mail_vorlagen ORDER BY id`);
    setListe(l);
    setWahl(l.find((x) => x.id === (id ?? wahl?.id)) ?? l[0] ?? null);
  };
  useEffect(() => { laden(); }, []);
  async function sichern() {
    if (!wahl) return;
    if (!String(wahl.name ?? '').trim()) { setInfo('Bitte einen Namen eintragen.'); return; }
    if (wahl.id) await db.execute(`UPDATE mail_vorlagen SET name = $1, betreff = $2, text = $3 WHERE id = $4`, [wahl.name, wahl.betreff ?? '', wahl.text ?? '', wahl.id]);
    else { const r = await db.execute(`INSERT INTO mail_vorlagen (name, betreff, text) VALUES ($1, $2, $3)`, [wahl.name, wahl.betreff ?? '', wahl.text ?? '']); wahl.id = Number(r.lastInsertId); }
    setInfo('Gespeichert.'); laden(wahl.id);
  }
  async function weg() {
    if (!wahl?.id) return;
    await db.execute(`DELETE FROM mail_vorlagen WHERE id = $1`, [wahl.id]);
    setInfo('Vorlage gelöscht.'); setWahl(null); laden();
  }
  return (
    <>
      <div className="page-head"><h1 className="title-ico"><FileText size={26} />Textvorlagen</h1>
        <p className="muted">Der Text, der beim Senden schon im Fenster steht. Felder in geschweiften Klammern füllt NEOSS aus den Stammdaten.</p></div>
      <div className="tv">
        <section className="card tv-liste">
          {liste.map((v) => <button key={v.id} className={wahl?.id === v.id ? 'an' : ''} onClick={() => { setWahl(v); setInfo(''); }}>{v.name}</button>)}
          <button className="tv-neu" onClick={() => { setWahl({ name: 'Neue Vorlage', betreff: '', text: '{Briefanrede},\n\n\n\nMit freundlichen Grüßen\n{Sachbearbeiter}\nKMS Immobilienverwaltung' }); setInfo(''); }}><Plus size={15} />Neue Vorlage</button>
        </section>
        {wahl && <section className="card">
          <div className="form f2">
            <label><span>Name</span><input id="tv-name" value={wahl.name ?? ''} onChange={(e) => setWahl({ ...wahl, name: e.target.value })} /></label>
            <label><span>Betreff</span><input id="tv-betreff" value={wahl.betreff ?? ''} onChange={(e) => setWahl({ ...wahl, betreff: e.target.value })} /></label>
            <label className="wide"><span>Text</span><textarea id="tv-text" rows={14} value={wahl.text ?? ''} onChange={(e) => setWahl({ ...wahl, text: e.target.value })} /></label>
          </div>
          <p className="small muted">Felder: {PLATZHALTER.map((p) => <code key={p} className="tv-feld" onClick={() => setWahl({ ...wahl, text: (wahl.text ?? '') + `{${p}}` })}>{`{${p}}`}</code>)}</p>
          {info && <p className="info">{info}</p>}
          <div className="row end">{wahl.id && <button className="danger" onClick={weg}>Löschen</button>}<span className="grow" /><button className="primary" onClick={sichern}>Speichern</button></div>
        </section>}
      </div>
    </>
  );
}

/* =================== Microsoft 365 =================== */

/** Schritt-für-Schritt: NEOSS einmal bei Microsoft anmelden (App-Registrierung im Entra Admin Center) */
const RECHTE = ['Mail.ReadWrite', 'Mail.Send', 'Mail.ReadWrite.Shared', 'Mail.Send.Shared', 'Calendars.ReadWrite', 'offline_access', 'User.Read'];
function Kopieren({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return <span className="ms-kopie"><code>{text}</code><button className="link small" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }).catch(() => {}); }}>{ok ? 'kopiert' : 'kopieren'}</button></span>;
}
function Anleitung({ offen: start }: { offen: boolean }) {
  const [offen, setOffen] = useState(start);
  return (
    <section className="card ms-anleitung">
      <div className="card-head" style={{ marginBottom: offen ? 12 : 0 }}><h2 style={{ margin: 0 }}>So meldest du NEOSS einmal bei Microsoft an</h2>
        <button className="link" onClick={() => setOffen(!offen)}>{offen ? 'Ausblenden' : 'Anleitung zeigen'}</button></div>
      {offen && <>
        <p className="muted small" style={{ marginTop: 0 }}>Das machst du nur einmal, etwa 10 Minuten. Danach trägst du hier zwei Nummern ein und meldest dich an. Die Bezeichnungen im Microsoft-Portal können leicht abweichen.</p>
        <ol className="ms-schritte">
          <li><b>Portal öffnen.</b> Im Browser <Kopieren text="https://entra.microsoft.com" /> öffnen und mit deinem Geschäftskonto anmelden.</li>
          <li><b>Neue App anlegen.</b> Links „Anwendungen“ › „App-Registrierungen“ › oben „Neue Registrierung“.</li>
          <li><b>Ausfüllen.</b> Name: <Kopieren text="NEOSS" />. Kontotyp: „Nur Konten in diesem Organisationsverzeichnis“. Umleitungs-URI: Plattform „Öffentlicher Client/nativ (mobil und Desktop)“, Adresse <Kopieren text="http://localhost" />. Dann „Registrieren“.</li>
          <li><b>Zwei Nummern abschreiben.</b> Auf der Übersicht stehen „Anwendungs-ID (Client)“ und „Verzeichnis-ID (Mandant)“. Beide unten in NEOSS einfügen.</li>
          <li><b>Öffentlichen Client erlauben.</b> Links „Authentifizierung“ › ganz unten „Öffentliche Clientflows zulassen“ auf „Ja“ › „Speichern“.</li>
          <li><b>Rechte geben.</b> Links „API-Berechtigungen“ › „Berechtigung hinzufügen“ › „Microsoft Graph“ › „Delegierte Berechtigungen“. Diese sieben ankreuzen:
            <div className="ms-rechte">{RECHTE.map((r) => <Kopieren key={r} text={r} />)}</div>
            Danach „Administratorzustimmung für … erteilen“ klicken und bestätigen.</li>
          <li><b>In NEOSS anmelden.</b> Die beiden Nummern oben eintragen und „Mit Microsoft anmelden“ klicken. Im Browser dein Konto wählen und „Akzeptieren“. Fertig, das Fenster kannst du schließen.</li>
          <li><b>Freigegebene Postfächer.</b> Siehst du sie heute schon in Outlook, ist alles da. Sonst im Microsoft 365 Admin Center unter „Teams und Gruppen“ › „Freigegebene Postfächer“ dein Konto als Mitglied eintragen und „Senden als“ erlauben.</li>
        </ol>
      </>}
    </section>
  );
}


export function Microsoft365Page() {
  const [konto, setKonto] = useState<Konto | null | undefined>(undefined);
  const [clientId, setClientId] = useState('');
  const [tenant, setTenant] = useState('');
  const [busy, setBusy] = useState('');
  const [info, setInfo] = useState('');
  const [boxen, setBoxen] = useState<string[]>([]);
  const [neueBox, setNeueBox] = useState('');
  const [schalter, setSchalter] = useState<Record<string, boolean>>({ ms_kalender: true, ms_akte_auto: true });
  const [kalender, setKalender] = useState<Row[]>([]);
  const [kalId, setKalId] = useState('');
  const [kalStand, setKalStand] = useState('');
  const [trennenFrage, setTrennenFrage] = useState(false);

  const laden = async () => {
    const k = await status().catch(() => null);
    setKonto(k);
    setClientId((await einstellung('ms_client_id')) ?? '');
    setTenant((await einstellung('ms_tenant')) ?? '');
    setBoxen(await freigegebene());
    setSchalter({ ms_kalender: (await einstellung('ms_kalender')) !== '0', ms_akte_auto: (await einstellung('ms_akte_auto')) !== '0' });
    setKalId((await einstellung('ms_kalender_id')) ?? '');
    const s = await einstellung('ms_kalender_stand'), f = await einstellung('ms_kalender_fehler');
    setKalStand(f ? `Letzter Abgleich mit Fehler: ${f}` : s ? `Zuletzt abgeglichen: ${new Date(s).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}` : '');
    if (k) graph<{ value: Row[] }>('GET', '/me/calendars?$select=id,name,isDefaultCalendar').then((r) => setKalender(r.value ?? [])).catch(() => setKalender([]));
  };
  useEffect(() => { laden(); }, []);

  async function verbinden() {
    setInfo('');
    if (!istDemo && !/^[0-9a-f-]{36}$/i.test(clientId.trim())) { setInfo('Bitte zuerst die Anwendungs-ID aus dem Microsoft-Portal eintragen (36 Zeichen).'); return; }
    setBusy('anmelden');
    try {
      await setzeEinstellung('ms_client_id', clientId.trim());
      await setzeEinstellung('ms_tenant', tenant.trim());
      const k = await anmelden(clientId.trim(), tenant.trim());
      setInfo(`Verbunden als ${k.name} (${k.mail}).`);
      await laden();
    } catch (e: any) { setInfo(String(e?.message ?? e)); }
    setBusy('');
  }
  async function trennen() {
    await abmelden(); setTrennenFrage(false); setInfo('Verbindung getrennt. Der Schlüssel ist aus dem Schlüsselbund entfernt.'); laden();
  }
  async function boxenSichern(l: string[]) {
    setBoxen(l); await setzeEinstellung('ms_postfaecher', JSON.stringify(l)); window.dispatchEvent(new Event(MS_EVENT));
  }
  async function boxDazu() {
    const a = neueBox.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a)) { setInfo('Bitte eine vollständige Adresse eintragen, z. B. info@firma.de.'); return; }
    if (boxen.some((b) => b.toLowerCase() === a.toLowerCase())) { setInfo('Dieses Postfach ist schon eingetragen.'); return; }
    if (konto) {
      try { await graph('GET', `${basis(a)}/mailFolders/inbox?$select=unreadItemCount`); }
      catch (e: any) { setInfo(`Auf ${a} gibt es keinen Zugriff: ${e?.message ?? e}`); return; }
    }
    await boxenSichern([...boxen, a]); setNeueBox(''); setInfo(`${a} ist eingetragen.`);
  }
  async function schalten(k: string, v: boolean) {
    setSchalter((s) => ({ ...s, [k]: v })); await setzeEinstellung(k, v ? '1' : '0');
  }
  async function abgleichen() {
    setBusy('kalender'); setInfo('');
    try {
      await setzeEinstellung('ms_kalender_fehler', '');
      const r = await kalenderAbgleich();
      setInfo(r ? `Kalender abgeglichen: ${r.neu} neu, ${r.geaendert} geändert, ${r.geloescht} entfernt.` : 'Der Kalender-Abgleich ist ausgeschaltet.');
      laden();
    } catch (e: any) { setInfo(String(e?.message ?? e)); }
    setBusy('');
  }

  return (
    <>
      <div className="page-head"><h1 className="title-ico"><Unplug size={26} />Microsoft 365</h1>
        <p className="muted">Einmal anmelden, danach arbeitet NEOSS mit deinem Outlook: Mail, freigegebene Postfächer und Kalender.</p></div>
      {info && <p className="info" style={{ marginTop: 0, marginBottom: 12 }}>{info}</p>}
      <div className="ms-raster">
        <section className="card">
          <div className="row" style={{ gap: 14 }}>
            <div className="ms-logo"><i /><i /><i /><i /></div>
            <div style={{ minWidth: 0 }}>
              <b style={{ fontSize: 16 }}>{konto ? konto.name : konto === null ? 'Noch nicht verbunden' : '…'}</b>
              <div className="muted">{konto ? `${konto.mail} · Geschäftskonto` : 'Melde dich mit deinem Microsoft-Geschäftskonto an.'}</div>
            </div>
            {konto && <span className="pill bezahlt">Verbunden</span>}
          </div>
          {!konto && <div className="form f2" style={{ marginTop: 16 }}>
            <label className="wide"><span>Anwendungs-ID (aus dem Microsoft-Portal)</span><input id="ms-client" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="z. B. 1a2b3c4d-0000-0000-0000-000000000000" /></label>
            <label className="wide"><span>Verzeichnis-ID (Mandant), leer lassen geht auch</span><input id="ms-tenant" value={tenant} onChange={(e) => setTenant(e.target.value)} placeholder="optional" /></label>
          </div>}
          <div className="row end">
            {konto
              ? trennenFrage
                ? <><span>Verbindung wirklich trennen?</span><button onClick={() => setTrennenFrage(false)}>Abbrechen</button><button className="danger" onClick={trennen}>Trennen</button></>
                : <button onClick={() => setTrennenFrage(true)}>Verbindung trennen</button>
              : <button className="primary ms-knopf" disabled={busy === 'anmelden'} onClick={verbinden}>{busy === 'anmelden' ? 'Warte auf die Anmeldung im Browser …' : 'Mit Microsoft anmelden'}</button>}
          </div>
          <p className="muted small" style={{ marginTop: 14 }}>Es öffnet sich das normale Anmeldefenster von Microsoft im Browser. NEOSS sieht dein Passwort nie. Der Anmeldeschlüssel liegt im Schlüsselbund dieses Rechners und lässt sich hier jederzeit entfernen.
            {istDemo && ' In der Vorschau ist ein Beispielkonto verbunden.'}</p>
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>Freigegebene Postfächer</h2>
          <p className="muted small">Dein Konto braucht auf jedes Postfach Vollzugriff, zum Senden zusätzlich „Senden als“. Beides stellt man im Microsoft 365 Admin Center beim Postfach ein.</p>
          <div className="ms-boxen">
            {boxen.map((b) => <div key={b} className="ms-box"><Inbox size={15} /><span>{b}</span><span className="grow" />
              <button className="link" onClick={() => boxenSichern(boxen.filter((x) => x !== b))}>Entfernen</button></div>)}
            {!boxen.length && <p className="muted small">Noch keine eingetragen.</p>}
          </div>
          <form className="row" onSubmit={(e) => { e.preventDefault(); boxDazu(); }}>
            <input id="ms-neue-box" style={{ flex: 1, minWidth: 180 }} placeholder="z. B. service@kms.koeln" value={neueBox} onChange={(e) => setNeueBox(e.target.value)} />
            <button type="submit">Postfach hinzufügen</button>
          </form>
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>Was NEOSS darf</h2>
          <label className="ms-schalter"><div><b>Antworten automatisch zur Akte</b><small className="muted">Antworten auf Mails, die in einer Akte liegen, landen auch dort</small></div>
            <input type="checkbox" className="kipp" checked={schalter.ms_akte_auto} onChange={(e) => schalten('ms_akte_auto', e.target.checked)} /></label>
          <label className="ms-schalter"><div><b>Termine in den Outlook-Kalender</b><small className="muted">Termine, Eigentümerversammlungen und Fristen aus NEOSS</small></div>
            <input type="checkbox" className="kipp" checked={schalter.ms_kalender} onChange={(e) => schalten('ms_kalender', e.target.checked)} /></label>
          <label className="ms-schalter"><div><b>Kalender</b><small className="muted">Wohin die Termine gehen</small></div>
            <select style={{ width: 'auto' }} value={kalId} disabled={!konto || !kalender.length} onChange={async (e) => { setKalId(e.target.value); await setzeEinstellung('ms_kalender_id', e.target.value); }}>
              <option value="">Standardkalender</option>{kalender.filter((k) => !k.isDefaultCalendar).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select></label>
          <div className="row end"><span className="muted small grow">{kalStand}</span>
            <button disabled={!konto || busy === 'kalender' || !schalter.ms_kalender} onClick={abgleichen}><RefreshCw size={15} />{busy === 'kalender' ? 'Gleicht ab …' : 'Kalender jetzt abgleichen'}</button></div>
          <p className="muted small">Ändert oder löscht du einen Termin in NEOSS, passiert das beim nächsten Abgleich auch in Outlook. Der Abgleich läuft beim Start und alle 15 Minuten von selbst.</p>
        </section>
      </div>
      {konto !== undefined && <Anleitung key={String(!!konto)} offen={!konto} />}
    </>
  );
}

/* =================== Schriftverkehr in der Akte =================== */

export function Schriftverkehr({ personId, firmaId }: { personId?: number; firmaId?: number }) {
  const [liste, setListe] = useState<Row[]>([]);
  const [offen, setOffen] = useState<number | null>(null);
  const [fenster, setFenster] = useState<MailStart | null>(null);
  const [info, setInfo] = useState('');
  const laden = () => db.select(`SELECT * FROM mails WHERE ${personId ? 'person_id' : 'firma_id'} = $1 ORDER BY datum DESC`, [personId ?? firmaId ?? 0]).then(setListe);
  useEffect(() => { laden(); }, [personId, firmaId]);
  async function neu() {
    const tab = personId ? 'personen' : 'firmen';
    const r = (await db.select(`SELECT * FROM ${tab} WHERE id = $1`, [personId ?? firmaId ?? 0]))[0];
    const name = personId ? [r?.vorname, r?.nachname].filter(Boolean).join(' ') || r?.firma : r?.name;
    const { briefanrede } = await import('../logic/ms365');
    setFenster({ an: r?.email ? `${name} <${r.email}>` : '', werte: { Briefanrede: personId ? briefanrede(r) : 'Sehr geehrte Damen und Herren', Name: name ?? '' },
      vorlage: 'Allgemeiner Brief', akte: { person_id: personId ?? null, firma_id: firmaId ?? null, name } });
  }
  return (
    <div className="schriftverkehr">
      <div className="card-head" style={{ marginBottom: 6 }}><h4 style={{ margin: 0 }}>Schriftverkehr ({liste.length})</h4>
        <button className="small-btn" onClick={neu}><MailIcon size={14} />E-Mail schreiben</button></div>
      {info && <p className="info">{info}</p>}
      {!liste.length && <p className="muted small">Noch keine E-Mails in dieser Akte.</p>}
      {liste.map((m) => (
        <div key={m.id} className="sv-zeile">
          <button className="sv-kopf" onClick={() => setOffen(offen === m.id ? null : m.id)}>
            <span className={'sv-ic ' + (m.richtung === 'aus' ? 'aus' : 'ein')}>{m.richtung === 'aus' ? <Send size={13} /> : <Reply size={13} />}</span>
            <span className="sv-betr"><b>{m.betreff || '(ohne Betreff)'}</b><small className="muted">{m.richtung === 'aus' ? `An ${m.an}` : `Von ${m.von}`}{m.anhaenge ? ` · ${m.anhaenge}` : ''}</small></span>
            <span className="muted small nowrap">{new Date(m.datum).toLocaleDateString('de-DE')}</span>
          </button>
          {offen === m.id && <pre className="sv-text">{m.text}</pre>}
        </div>))}
      {fenster && <MailFenster start={fenster} onClose={() => setFenster(null)} onGesendet={(t) => { setInfo(t); laden(); }} />}
    </div>
  );
}
