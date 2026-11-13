// Eigentümerversammlung (WEG): Liste, Einberufen-Assistent (Termin → Tagesordnung → Einladung)
// und Live-Versammlung (Anwesenheit → Abstimmung → Niederschrift mit Unterschrift zur Kenntnisnahme).
import './versammlung.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, CalendarDays, Check, Eye, FileDown, Mail, Pencil, Play, Plus, Printer, Trash2, X } from 'lucide-react';
import { db, type Row } from '../db';
import { EntityTable, datum as fDatum } from '../components/EntityTable';
import { dDatum } from '../lib/pdf';
import { freistellen } from '../lib/unterschrift';
import { oeffnen, speichern as dateiSpeichern } from '../lib/dateien';
import { einladungPdf, niederschriftPdf } from '../lib/versammlungPdf';
import {
  ARTEN, abschliessen, beschlussFesthalten, einladenBis, ergebnis, nummerieren, plusMonate, stimmeSetzen, tagesordnungVorschlag,
  teilnehmerAbgleichen, versammlungLaden, versammlungSpeichern, type Stimme, type Top, type Versammlung,
} from '../logic/versammlung';

const heute = () => new Date().toISOString().slice(0, 10);
const jetztZeit = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const kuerzel = (t: Row) => ((t.vorname?.[0] ?? '') + (t.nachname?.[0] ?? t.firma?.[0] ?? t.name?.[0] ?? '')).toUpperCase() || '?';
const nameKurz = (t: Row) => [t.vorname, t.nachname].filter(Boolean).join(' ') || t.firma || t.name;
const zahl = (n: number, s = 0) => n.toLocaleString('de-DE', { minimumFractionDigits: s, maximumFractionDigits: s });
const STATUS_PILL: Record<string, string> = { Geplant: 'künftig', Eingeladen: 'teil', 'Läuft': 'offen', 'Durchgeführt': 'bezahlt' };

function PdfFenster({ pdf, titel, onClose }: { pdf: { url: string } | null; titel: string; onClose: () => void }) {
  if (!pdf) return null;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal pdf-vorschau" onClick={(e) => e.stopPropagation()}>
        <div className="card-head"><h3>{titel}</h3><div className="row"><button className="icon-btn" title="Schließen" onClick={onClose}><X size={18} /></button></div></div>
        <iframe id="abschluss-pdf" title="PDF-Vorschau" src={pdf.url} />
      </div>
    </div>
  );
}
const pdfUrl = (bytes: Uint8Array) => ({ url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' })) });

/* ===================== Einstieg je Menüpunkt ===================== */
export function VersammlungenBereich({ objektId, rest }: { objektId: number; rest: string[] }) {
  const sub = rest[1] ?? '';
  if (sub === 'neu') return <Einberufen objektId={objektId} />;
  if (sub && rest[2] === 'bearbeiten') return <Einberufen objektId={objektId} id={Number(sub)} />;
  if (sub) return <VersammlungLive objektId={objektId} id={Number(sub)} />;
  return <VersammlungListe objektId={objektId} />;
}

/* ===================== Liste ===================== */
export function VersammlungListe({ objektId, umlauf }: { objektId: number; umlauf?: boolean }) {
  const nav = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [kz, setKz] = useState<Row>({});
  const laden = async () => {
    setRows(await db.select(`SELECT v.*, (SELECT COUNT(*) FROM versammlung_tops t WHERE t.versammlung_id = v.id) AS tops,
        (SELECT COUNT(*) FROM beschluesse b WHERE b.versammlung_id = v.id) AS beschl
      FROM versammlungen v WHERE v.objekt_id = $1 AND (v.art = 'Umlaufbeschluss') = $2 ORDER BY v.datum DESC`, [objektId, umlauf ? 1 : 0]));
    setKz((await db.select(`SELECT
        (SELECT MIN(datum) FROM versammlungen WHERE objekt_id = $1 AND datum >= date('now') AND status <> 'Durchgeführt') AS naechste,
        (SELECT COUNT(*) FROM beschluesse WHERE objekt_id = $1 AND ergebnis = 'Angenommen' AND status IN ('Geplant', 'In Umsetzung')) AS offen,
        (SELECT COUNT(*) FROM beschluesse WHERE objekt_id = $1 AND anfechtung_bis >= date('now')) AS frist,
        (SELECT MIN(anfechtung_bis) FROM beschluesse WHERE objekt_id = $1 AND anfechtung_bis >= date('now')) AS frist_bis,
        (SELECT COUNT(*) FROM beschluesse WHERE objekt_id = $1) AS sammlung`, [objektId]))[0] ?? {});
  };
  useEffect(() => { laden(); }, [objektId, umlauf]);
  async function loeschen(r: Row) {
    if (!confirm(`${r.art} vom ${dDatum(r.datum)} löschen? Beschlüsse in der Beschluss-Sammlung bleiben erhalten.`)) return;
    await db.execute('DELETE FROM versammlungen WHERE id = $1', [r.id]); laden();
  }
  return (
    <div className="ev ev-anim">
      <div className="ev-kopf">
        <div><h1>{umlauf ? 'Umlaufbeschlüsse' : 'Eigentümerversammlungen'}</h1>
          <div className="ev-sub">{umlauf ? 'Beschlüsse in Textform ohne Versammlung (§ 23 Abs. 3 WEG)' : 'Einberufen, Tagesordnung, Abstimmung, Protokoll und Beschluss-Sammlung nach §§ 23 bis 25 WEG'}</div></div>
        <button className="ev-cta" onClick={() => nav(`/objekte/${objektId}/versammlungen/neu${umlauf ? '?art=Umlaufbeschluss' : ''}`)}><Plus size={17} />{umlauf ? 'Umlaufbeschluss starten' : 'Versammlung einberufen'}</button>
      </div>
      {!umlauf && <div className="kpis">
        <div className="kpi"><span>Nächste Versammlung</span><b>{kz.naechste ? dDatum(kz.naechste) : '–'}</b><small>{kz.naechste ? `Einladung spätestens ${dDatum(einladenBis(kz.naechste))}` : 'keine geplant'}</small></div>
        <div className="kpi"><span>Beschlüsse in Umsetzung</span><b>{kz.offen ?? 0}</b><small>angenommen, noch nicht erledigt</small></div>
        <div className="kpi"><span>Anfechtungsfrist läuft</span><b>{kz.frist ?? 0}</b><small>{kz.frist_bis ? `endet am ${dDatum(kz.frist_bis)}` : 'keine'}</small></div>
        <div className="kpi"><span>Beschluss-Sammlung</span><b>{kz.sammlung ?? 0} Einträge</b><small><Link to={`/objekte/${objektId}/beschluesse`}>öffnen →</Link></small></div>
      </div>}
      <section className="card">
        <div className="card-head"><h2 className="title-ico"><CalendarDays size={22} />{umlauf ? 'Umlaufbeschlüsse' : 'Versammlungen'}</h2><span className="muted small">Klick öffnet die Versammlung</span></div>
        {rows.length === 0 ? <p className="muted">Noch nichts angelegt. Mit „{umlauf ? 'Umlaufbeschluss starten' : 'Versammlung einberufen'}“ geht es los.</p> : (
          <div className="tablewrap"><table className="list">
            <thead><tr><th>Datum</th><th>Art</th><th>Ort</th><th className="num">TOPs</th><th className="num">Beschlüsse</th><th>Stand</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => nav(`/objekte/${objektId}/versammlungen/${r.id}`)}>
                <td><b>{fDatum(r.datum)}</b>{r.uhrzeit ? ` ${r.uhrzeit}` : ''}</td><td>{r.art}</td><td>{[r.ort, r.online ? 'online' : ''].filter(Boolean).join(' + ') || '–'}</td>
                <td className="num">{r.tops}</td><td className="num">{r.beschl || '–'}</td>
                <td><span className={'pill ' + (STATUS_PILL[r.status] ?? '')}>{r.status}</span></td>
                <td className="num" onClick={(e) => e.stopPropagation()}>{r.status !== 'Durchgeführt' && <button className="icon-btn" title="Löschen" onClick={() => loeschen(r)}><Trash2 size={15} /></button>}</td>
              </tr>))}</tbody></table></div>)}
      </section>
    </div>
  );
}

/* ===================== Einberufen: Termin → Tagesordnung → Einladung ===================== */
function Einberufen({ objektId, id }: { objektId: number; id?: number }) {
  const nav = useNavigate();
  const startArt = new URLSearchParams(useLocation().search).get('art') ?? 'Ordentliche Versammlung';
  const [schritt, setSchritt] = useState(1);
  const [w, setW] = useState<Row>({ art: startArt, datum: plusMonate(heute(), 1), uhrzeit: '18:00', ort: '', online: false, leitung: '' });
  const [tops, setTops] = useState<Top[]>([]);
  const [geladen, setGeladen] = useState(!id);
  const [vid, setVid] = useState<number | undefined>(id);
  const [vs, setVs] = useState<Versammlung | null>(null);
  const [pdf, setPdf] = useState<{ url: string } | null>(null);
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [vorlageArt, setVorlageArt] = useState('');

  useEffect(() => {
    (async () => {
      const u = (await db.select("SELECT wert FROM einstellungen WHERE schluessel = 'unterschrift_name'"))[0]?.wert;
      const firma = (await db.select("SELECT wert FROM einstellungen WHERE schluessel = 'firma_name'"))[0]?.wert;
      if (!id) setW((x) => ({ ...x, leitung: x.leitung || [firma, u].filter(Boolean).join(', ') }));
      if (id) {
        const l = await versammlungLaden(id);
        if (l) {
          setW({ art: l.v.art, datum: l.v.datum, uhrzeit: l.v.uhrzeit ?? '', ort: l.v.ort ?? '', online: !!l.v.online, leitung: l.v.leitung ?? '' });
          setTops(nummerieren(l.tops.map((t) => ({ id: t.id, nr: t.nr, titel: t.titel, antrag: t.antrag ?? '', beschluss: !!t.beschluss, aktiv: true, herkunft: 'eigen' as const }))));
          setVorlageArt(l.v.art);
        }
        setGeladen(true);
      }
    })();
  }, [id]);
  // Tagesordnung aus der Vorlage, sobald Schritt 2 zum ersten Mal (oder mit anderer Art) geöffnet wird
  useEffect(() => {
    if (schritt === 2 && geladen && vorlageArt !== w.art) {
      tagesordnungVorschlag(objektId, w.art, w.datum).then((t) => { setTops(t); setVorlageArt(w.art); });
    }
  }, [schritt, geladen]);
  const umlauf = w.art === 'Umlaufbeschluss';
  const frist = einladenBis(w.datum || heute());
  const zuSpaet = !umlauf && w.datum && frist < heute();

  const setTop = (i: number, t: Partial<Top>) => setTops((l) => nummerieren(l.map((x, j) => j === i ? { ...x, ...t } : x)));
  const schieben = (i: number, r: -1 | 1) => setTops((l) => { const n = [...l]; const j = i + r; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j], n[i]]; return nummerieren(n); });

  async function zurEinladung() {
    setBusy(true);
    try {
      const neu = await versammlungSpeichern(objektId, w, tops, vid);
      setVid(neu); setVs(await versammlungLaden(neu)); setSchritt(3);
    } catch (e: any) { setInfo('Fehler: ' + (e?.message ?? e)); }
    setBusy(false);
  }
  async function vorschau() { if (vs) setPdf(pdfUrl(await einladungPdf(vs))); }
  async function versenden() {
    if (!vs || !vid) return;
    setBusy(true);
    try {
      const bytes = await einladungPdf(vs);
      const name = `Einladung ${w.art} ${dDatum(w.datum)} ${vs.v.objekt}.pdf`;
      const pfad = await dateiSpeichern(bytes, name, { bezug: 'Objekt', bezugId: objektId, ordner: [vs.v.objekt, 'Eigentümerversammlung', w.datum] });
      await db.execute(`UPDATE versammlungen SET status = CASE WHEN status = 'Geplant' THEN 'Eingeladen' ELSE status END, eingeladen_am = $1 WHERE id = $2`, [heute(), vid]);
      setInfo(`Einladung abgelegt unter ${vs.v.objekt}/Eigentümerversammlung/${w.datum}. Eigentümer mit E-Mail kannst du direkt anschreiben, für alle anderen ist das PDF zum Drucken geöffnet.`);
      oeffnen(pfad);
      setVs(await versammlungLaden(vid));
    } catch (e: any) { setInfo('Fehler: ' + (e?.message ?? e)); }
    setBusy(false);
  }
  const mail = (t: Row) => `mailto:${t.email}?subject=${encodeURIComponent(`Einladung ${w.art} ${vs?.v.objekt ?? ''} am ${dDatum(w.datum)}`)}&body=${encodeURIComponent(
    `Guten Tag,\n\nanbei erhalten Sie die Einladung zur ${w.art} am ${dDatum(w.datum)}${w.uhrzeit ? ` um ${w.uhrzeit} Uhr` : ''}${w.ort ? ` (${w.ort})` : ''} mit Tagesordnung und Vollmacht.\n\nMit freundlichen Grüßen`)}`;

  const steps = ['Termin', 'Tagesordnung', umlauf ? 'Anschreiben' : 'Einladung'];
  return (
    <div className="ev ev-anim">
      <div className="ev-kopf"><div><h1>{id ? 'Versammlung bearbeiten' : umlauf ? 'Umlaufbeschluss starten' : 'Versammlung einberufen'}</h1><div className="ev-sub">Schritt {schritt} von 3</div></div>
        <button className="ev-ghost" onClick={() => nav(vid ? `/objekte/${objektId}/versammlungen/${vid}` : `/objekte/${objektId}/versammlungen`)}><X size={16} />Schließen</button></div>
      <div className="ev-stepper" style={{ ['--n' as any]: 3 }}>
        {steps.map((s, i) => <button key={s} className={'ev-st' + (schritt === i + 1 ? ' on' : schritt > i + 1 ? ' ok' : '')} onClick={() => i + 1 < schritt && setSchritt(i + 1)}>
          <span className="n">{schritt > i + 1 ? <Check size={15} /> : i + 1}</span><div><b>{s}</b><small>{['Datum, Uhrzeit, Ort', 'Standard-TOPs und eigene Punkte', umlauf ? 'PDF an die Eigentümer' : 'PDF auf Briefpapier, Versand'][i]}</small></div></button>)}
      </div>

      {schritt === 1 && <section className="ev-glas ev-anim">
        <div className="ev-form">
          <label className="wide"><span>Art</span><select value={w.art} onChange={(e) => setW({ ...w, art: e.target.value })}>{ARTEN.map((a) => <option key={a}>{a}</option>)}</select></label>
          <label><span>{umlauf ? 'Antwort bis' : 'Datum'}</span><input type="date" value={w.datum} onChange={(e) => setW({ ...w, datum: e.target.value })} /></label>
          {!umlauf && <label><span>Uhrzeit</span><input type="time" value={w.uhrzeit} onChange={(e) => setW({ ...w, uhrzeit: e.target.value })} /></label>}
          {!umlauf && <label className="wide"><span>Ort</span><input value={w.ort} placeholder="z. B. Büro KMS, Leonhardsgasse 4, 50859 Köln" onChange={(e) => setW({ ...w, ort: e.target.value })} /></label>}
          {!umlauf && <label className="wide"><span>Versammlungsleitung</span><input value={w.leitung} onChange={(e) => setW({ ...w, leitung: e.target.value })} /></label>}
          {!umlauf && <label className="check wide"><input type="checkbox" checked={!!w.online} onChange={(e) => setW({ ...w, online: e.target.checked })} />Online-Teilnahme ermöglichen (§ 23 Abs. 1a WEG, braucht einen Beschluss der Gemeinschaft)</label>}
        </div>
        {!umlauf && w.datum && <div className={'ev-hinweis' + (zuSpaet ? ' rot' : '')} style={{ marginTop: 14 }}>
          {zuSpaet ? `Achtung: Die Einladungsfrist von 3 Wochen (§ 24 Abs. 4 WEG) ist nicht mehr einzuhalten. Die Einladung hätte bis ${dDatum(frist)} rausgehen müssen.`
            : <>Die Einladung muss bis <b>{dDatum(frist)}</b> raus (3 Wochen, § 24 Abs. 4 WEG). Der Termin erscheint automatisch im Kalender.</>}</div>}
        <div className="ev-fuss"><span /><button className="ev-cta" disabled={!w.datum} onClick={() => setSchritt(2)}>Weiter zur Tagesordnung →</button></div>
      </section>}

      {schritt === 2 && <div className="ev-vorl ev-anim">
        <section className="ev-glas">
          <p className="ev-sub" style={{ marginTop: 0 }}>Die Standard-TOPs der Vorlage <b>„{w.art}“</b> sind schon eingetragen. Mit dem Schalter nimmst du einen TOP raus, mit den Pfeilen änderst du die Reihenfolge. Titel und Beschlussantrag kannst du direkt ändern.</p>
          {tops.map((t, i) => (
            <div key={i} className={'ev-top' + (t.aktiv ? '' : ' aus') + (t.herkunft === 'nano' ? ' nano' : '')}>
              <div className="ev-pfeile"><button title="nach oben" onClick={() => schieben(i, -1)}><ArrowUp size={14} /></button><button title="nach unten" onClick={() => schieben(i, 1)}><ArrowDown size={14} /></button></div>
              <span className="k">{t.aktiv ? `TOP ${t.nr}` : '–'}</span>
              <div className="t">
                <input value={t.titel} onChange={(e) => setTop(i, { titel: e.target.value })} />
                {t.beschluss && <textarea rows={2} value={t.antrag} placeholder="Beschlussantrag" onChange={(e) => setTop(i, { antrag: e.target.value })} />}
                {t.hinweis && <small>{t.hinweis}</small>}
              </div>
              {t.herkunft === 'nano' && <span className="ev-tag a">Aus NANO</span>}
              <button className={'ev-tag ' + (t.beschluss ? 'b' : 'i')} title="Umschalten zwischen Beschluss und Information" onClick={() => setTop(i, { beschluss: !t.beschluss })}>{t.beschluss ? 'Beschluss' : 'Info'}</button>
              <button className={'ev-sw' + (t.aktiv ? '' : ' off')} title={t.aktiv ? 'TOP herausnehmen' : 'TOP aufnehmen'} onClick={() => setTop(i, { aktiv: !t.aktiv })} />
              {t.herkunft === 'eigen' && !t.id && <button className="icon-btn" title="Entfernen" onClick={() => setTops((l) => nummerieren(l.filter((_, j) => j !== i)))}><Trash2 size={14} /></button>}
            </div>))}
          <div className="ev-fuss">
            <button className="ev-ghost" onClick={() => { const v = tops.findIndex((t) => /^Verschiedenes/i.test(t.titel)); const n = [...tops]; n.splice(v < 0 ? n.length : v, 0, { nr: 0, titel: 'Neuer Tagesordnungspunkt', antrag: '', beschluss: true, aktiv: true, herkunft: 'eigen' }); setTops(nummerieren(n)); }}><Plus size={15} />Eigenen TOP hinzufügen</button>
            <span style={{ display: 'flex', gap: 10 }}><button className="ev-ghost" onClick={() => setSchritt(1)}>← Termin</button>
              <button className="ev-cta" disabled={busy || !tops.some((t) => t.aktiv)} onClick={zurEinladung}>{umlauf ? 'Weiter zum Anschreiben →' : 'Weiter zur Einladung →'}</button></span>
          </div>
          {info && <p className="muted">{info}</p>}
        </section>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="ev-mini"><h3>Standard-TOPs</h3>Die Vorlagen pflegst du einmal unter <Link to="/einstellungen">Einstellungen → Versammlungs-Vorlagen</Link>, getrennt für ordentliche und außerordentliche Versammlung und Umlaufbeschluss.</div>
          <div className="ev-mini"><h3>Automatisch ausgefüllt</h3>Jahr und Vorjahr setzt NANO selbst in Titel und Anträge ein. Maßnahmen, die in den Rücklagen auf „Vorgesehen“ stehen, werden als TOP vorgeschlagen.</div>
          <div className="ev-mini"><h3>Beiratswahl</h3>„Wahl des Verwaltungsbeirats“ ist nur eingeschaltet, wenn eine Amtszeit in den sechs Monaten nach der Versammlung endet oder noch kein Beirat eingetragen ist.</div>
        </div>
      </div>}

      {schritt === 3 && vs && <div className="ev-vorl ev-anim">
        <section className="ev-glas">
          <h3 style={{ marginTop: 0 }}>{umlauf ? 'Anschreiben an die Eigentümer' : 'Einladung an die Eigentümer'}</h3>
          <p className="ev-sub">Für jeden Eigentümer entsteht ein Brief auf dem Briefpapier mit Tagesordnung und Beschlussanträgen{umlauf ? '' : ', dazu eine vorausgefüllte Vollmacht'}. Alle Briefe liegen in einem PDF.</p>
          <div className="ev-empf">{vs.teilnehmer.map((t) => (
            <div key={t.id}><span className="ev-av s">{kuerzel(t)}</span><b>{t.name}</b><span>{t.einheiten} · {t.email ? <a href={mail(t)}><Mail size={13} /> E-Mail</a> : 'Post (PDF drucken)'}</span></div>))}
            {vs.teilnehmer.length === 0 && <p className="ev-hinweis">Für diesen Tag sind keine Eigentümer eingetragen. Bitte zuerst unter „Eigentümer“ die Einheiten zuordnen.</p>}
          </div>
          {vs.v.eingeladen_am && <p className="ev-hinweis" style={{ marginTop: 12 }}>Eingeladen am {dDatum(vs.v.eingeladen_am)}.</p>}
          <div className="ev-fuss">
            <button className="ev-ghost" onClick={() => setSchritt(2)}>← Tagesordnung</button>
            <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="ev-ghost" onClick={vorschau}><Eye size={15} />PDF-Vorschau</button>
              <button className="ev-cta" disabled={busy || !vs.teilnehmer.length} onClick={versenden}><FileDown size={16} />{umlauf ? 'Anschreiben erstellen' : 'Einladung erstellen'}</button>
              {vs.v.eingeladen_am && <button className="ev-ghost" onClick={() => nav(`/objekte/${objektId}/versammlungen/${vid}`)}>Zur Versammlung →</button>}
            </span>
          </div>
          {info && <p className="ev-hinweis" style={{ marginTop: 12 }}>{info}</p>}
        </section>
        <div className="ev-mini"><h3>Termin</h3>{w.art}<br />{dDatum(w.datum)}{w.uhrzeit ? `, ${w.uhrzeit} Uhr` : ''}<br />{w.ort}{w.online ? ' · online möglich' : ''}<br /><br /><b>{vs.tops.length} TOPs</b>, davon {vs.tops.filter((t) => t.beschluss).length} mit Beschluss</div>
      </div>}
      <PdfFenster pdf={pdf} titel="Einladung (Vorschau)" onClose={() => setPdf(null)} />
    </div>
  );
}

/* ===================== Live: Anwesenheit → Abstimmung → Niederschrift ===================== */
const DAUMEN_HOCH = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" /></svg>;
const DAUMEN_RUNTER = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 14V2" /><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" /></svg>;
const ENTHALTUNG = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></svg>;

function VersammlungLive({ objektId, id }: { objektId: number; id: number }) {
  const nav = useNavigate();
  const [vs, setVs] = useState<Versammlung | null>(null);
  const [schritt, setSchritt] = useState(0);
  const [topId, setTopId] = useState<number | null>(null);
  const [pdf, setPdf] = useState<{ url: string; titel: string } | null>(null);
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [uhr, setUhr] = useState(Date.now());
  const laden = async () => { const l = await versammlungLaden(id); setVs(l); return l; };
  useEffect(() => {
    laden().then(async (l) => {
      if (!l) return;
      if (l.v.status !== 'Durchgeführt') { await teilnehmerAbgleichen(id, objektId, l.v.datum); await laden(); }
      setSchritt(l.v.status === 'Durchgeführt' ? 3 : l.v.status === 'Läuft' ? (l.teilnehmer.every((t) => t.status) ? 2 : 1) : 0);
    });
  }, [id]);
  useEffect(() => { const t = setInterval(() => setUhr(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!vs) return <p className="muted">Versammlung wird geladen…</p>;
  const { v } = vs;
  const fertig = v.status === 'Durchgeführt';
  const umlauf = v.art === 'Umlaufbeschluss';

  async function starten() {
    await db.execute(`UPDATE versammlungen SET status = 'Läuft', beginn = COALESCE(beginn, $1) WHERE id = $2`, [jetztZeit(), id]);
    await laden(); setSchritt(1);
  }
  const dauer = (() => {
    if (!v.beginn || v.status !== 'Läuft') return v.beginn && v.ende ? `${v.beginn}–${v.ende}` : v.uhrzeit ?? '–';
    const [h, m] = String(v.beginn).split(':').map(Number);
    const s = new Date(); s.setHours(h, m, 0, 0);
    const d = Math.max(0, Math.floor((uhr - s.getTime()) / 1000));
    return `${String(Math.floor(d / 3600)).padStart(2, '0')}:${String(Math.floor(d / 60) % 60).padStart(2, '0')}:${String(d % 60).padStart(2, '0')}`;
  })();
  const anw = vs.teilnehmer.filter((t) => t.status === 'Anwesend' || t.status === 'Vertreten');
  const meaGes = vs.teilnehmer.reduce((a, t) => a + (Number(t.mea) || 0), 0);
  const meaAnw = anw.reduce((a, t) => a + (Number(t.mea) || 0), 0);

  async function niederschriftAlle() { setPdf({ ...pdfUrl(await niederschriftPdf(vs!)), titel: 'Protokoll und Beschluss-Niederschrift (alle Eigentümer)' }); }
  async function abschliessenKlick() {
    if (!confirm('Versammlung abschließen? Danach werden die Niederschriften als PDF abgelegt und die Anfechtungsfrist eingetragen. Unterschriften kannst du auch danach noch nachtragen.')) return;
    setBusy(true);
    try {
      await abschliessen(vs!);
      const l = await laden();
      if (l) {
        const name = `Protokoll ${l.v.art} ${dDatum(l.v.datum)} ${l.v.objekt}.pdf`;
        const pfad = await dateiSpeichern(await niederschriftPdf(l), name, { bezug: 'Objekt', bezugId: objektId, ordner: [l.v.objekt, 'Eigentümerversammlung', l.v.datum] });
        setInfo(`Versammlung abgeschlossen. Protokoll mit allen Niederschriften abgelegt unter ${l.v.objekt}/Eigentümerversammlung/${l.v.datum}. Anfechtungsfrist bis ${dDatum(plusMonate(l.v.datum, 1))} steht unter „Fristen“.`);
        oeffnen(pfad);
      }
    } catch (e: any) { setInfo('Fehler: ' + (e?.message ?? e)); }
    setBusy(false);
  }

  const stepper = (
    <div className="ev-stepper" style={{ ['--n' as any]: 3 }}>
      {[['Anwesenheit', `${anw.length} von ${vs.teilnehmer.length} da`], ['Abstimmung', `${vs.tops.filter((t) => t.erledigt).length} von ${vs.tops.length} TOPs`], ['Niederschrift', `${vs.teilnehmer.filter((t) => t.unterschrift).length} unterschrieben`]].map(([t, s], i) => (
        <button key={t} className={'ev-st' + (schritt === i + 1 ? ' on' : schritt > i + 1 || fertig ? ' ok' : '')} onClick={() => setSchritt(i + 1)}>
          <span className="n">{schritt > i + 1 || (fertig && schritt !== i + 1) ? <Check size={15} /> : i + 1}</span><div><b>{t}</b><small>{s}</small></div></button>))}
    </div>);

  return (
    <div className="ev ev-anim">
      <div className="ev-kopf">
        <div><span className={'ev-live' + (v.status === 'Läuft' ? '' : ' aus')}>{v.status === 'Läuft' ? 'Live · Versammlung läuft' : v.status}</span>
          <h1>{umlauf ? 'Umlaufbeschluss' : 'Eigentümerversammlung'} <em>{v.objekt}</em></h1>
          <div className="ev-sub">{v.art} · {dDatum(v.datum)}{v.uhrzeit ? `, ${v.uhrzeit} Uhr` : ''}{v.ort ? ` · ${v.ort}` : ''}{v.online ? ' · online' : ''}</div></div>
        <div className="ev-chips">
          <div className="ev-chip">{v.status === 'Läuft' ? 'Dauer' : 'Zeit'}<b>{dauer}</b></div>
          <div className="ev-chip">Beschlüsse<b>{vs.beschluesse.length}</b></div>
          <div className="ev-chip">Anwesend<b>{meaGes ? `${Math.round(meaAnw / meaGes * 100)} %` : '–'}</b></div>
        </div>
      </div>

      {schritt === 0 && <Uebersicht vs={vs} objektId={objektId} onStart={starten} onBearbeiten={() => nav(`/objekte/${objektId}/versammlungen/${id}/bearbeiten`)}
        onEinladung={async () => setPdf({ ...pdfUrl(await einladungPdf(vs)), titel: 'Einladung' })} />}
      {schritt > 0 && stepper}
      {schritt === 1 && <Anwesenheit vs={vs} neu={laden} weiter={() => { setSchritt(2); setTopId(vs.tops.find((t) => !t.erledigt)?.id ?? vs.tops[0]?.id ?? null); }} meaAnw={meaAnw} meaGes={meaGes} />}
      {schritt === 2 && <Abstimmung vs={vs} neu={laden} topId={topId ?? vs.tops.find((t) => !t.erledigt)?.id ?? vs.tops[0]?.id ?? null} setTopId={setTopId} weiter={() => setSchritt(3)} />}
      {schritt === 3 && <Niederschrift vs={vs} neu={laden} busy={busy} onAlle={niederschriftAlle} onAbschliessen={abschliessenKlick}
        onEinzeln={async (pid) => setPdf({ ...pdfUrl(await niederschriftPdf(vs, [pid])), titel: 'Niederschrift' })} />}
      {info && <p className="ev-hinweis">{info}</p>}
      <PdfFenster pdf={pdf} titel={pdf?.titel ?? ''} onClose={() => { if (pdf) URL.revokeObjectURL(pdf.url); setPdf(null); }} />
    </div>
  );
}

function Uebersicht({ vs, objektId, onStart, onBearbeiten, onEinladung }: { vs: Versammlung; objektId: number; onStart: () => void; onBearbeiten: () => void; onEinladung: () => void }) {
  const { v } = vs;
  const bis = einladenBis(v.datum);
  return (
    <div className="ev-vorl">
      <section className="ev-glas">
        <div className="card-head"><h2>Tagesordnung</h2><div className="row"><button className="ev-ghost" onClick={onBearbeiten}><Pencil size={15} />Termin und TOPs ändern</button></div></div>
        {vs.tops.map((t) => <div key={t.id} className="ev-top"><span className="k">TOP {t.nr}</span><div className="t"><b>{t.titel}</b>{t.antrag && <small>{t.antrag}</small>}</div><span className={'ev-tag ' + (t.beschluss ? 'b' : 'i')}>{t.beschluss ? 'Beschluss' : 'Info'}</span></div>)}
        <div className="ev-fuss"><Link to={`/objekte/${objektId}/versammlungen`}>← Alle Versammlungen</Link><button className="ev-cta" onClick={onStart}><Play size={16} />Versammlung starten</button></div>
      </section>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="ev-mini"><h3>Einladung</h3>{v.eingeladen_am ? <>Verschickt am <b>{dDatum(v.eingeladen_am)}</b>.</> : <>Noch nicht verschickt. Frist: <b>{dDatum(bis)}</b>.</>}
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}><button className="ev-ghost" onClick={onEinladung}><Eye size={15} />Einladung ansehen</button>
            {!v.eingeladen_am && <button className="ev-ghost" onClick={onBearbeiten}><Mail size={15} />Jetzt einladen</button>}</div></div>
        <div className="ev-mini"><h3>Eigentümer</h3>{vs.teilnehmer.map((t) => <div key={t.id}>{t.einheiten} · {t.name}</div>)}</div>
      </div>
    </div>
  );
}

/* ---------- Schritt 1: Anwesenheit ---------- */
function Anwesenheit({ vs, neu, weiter, meaAnw, meaGes }: { vs: Versammlung; neu: () => void; weiter: () => void; meaAnw: number; meaGes: number }) {
  const fertig = vs.v.status === 'Durchgeführt';
  async function setStatus(t: Row, s: string) {
    await db.execute('UPDATE versammlung_teilnehmer SET status = $1, vertreter = CASE WHEN $1 = \'Vertreten\' THEN vertreter ELSE NULL END WHERE id = $2', [s, t.id]);
    if (s === 'Abwesend') await db.execute('DELETE FROM versammlung_stimmen WHERE teilnehmer_id = $1', [t.id]);
    neu();
  }
  const [vertreter, setVertreter] = useState<Record<number, string>>({});
  useEffect(() => { setVertreter(Object.fromEntries(vs.teilnehmer.map((t) => [t.id, t.vertreter ?? '']))); }, [vs.teilnehmer.map((t) => t.id).join()]);
  async function vertreterSpeichern(t: Row) { await db.execute('UPDATE versammlung_teilnehmer SET vertreter = $1 WHERE id = $2', [vertreter[t.id] || null, t.id]); neu(); }
  const n = (s: string) => vs.teilnehmer.filter((t) => t.status === s).length;
  const umfang = 2 * Math.PI * 74;
  const anwMea = vs.teilnehmer.filter((t) => t.status === 'Anwesend').reduce((a, t) => a + (Number(t.mea) || 0), 0);
  const a1 = meaGes ? anwMea / meaGes * umfang : 0, a2 = meaGes ? (meaAnw - anwMea) / meaGes * umfang : 0;
  const offen = vs.teilnehmer.filter((t) => !t.status).length;
  const namen = vs.teilnehmer.map((t) => t.name);
  return (
    <>
      <div className="ev-sect"><span className="nr">Schritt 01</span><h2>Anwesenheitsliste</h2></div>
      <div className="ev-anw">
        <section className="ev-glas ev-tiles">
          {vs.teilnehmer.map((t) => {
            const k = t.status === 'Anwesend' ? 'an' : t.status === 'Vertreten' ? 've' : t.status === 'Abwesend' ? 'ab' : '';
            return (
              <div key={t.id} className={'ev-tile ' + k}>
                <div className="ev-who"><div className={'ev-av ' + ({ an: 'g', ve: 'b', ab: 'x' } as Record<string, string>)[k]}>{kuerzel(t)}</div>
                  <div><b>{nameKurz(t)}</b><small>{t.einheiten} · {zahl(Number(t.mea) || 0)} MEA</small></div></div>
                <div className="ev-tog">
                  {(['Anwesend', 'Abwesend', 'Vertreten'] as const).map((s, i) => <button key={s} disabled={fertig} className={t.status === s ? 'a' + (i + 1) : ''} onClick={() => setStatus(t, s)}>{s}</button>)}
                </div>
                {t.status === 'Vertreten' && <div className="ev-vfeld">↳ durch
                  <input list={`vertreter-${t.id}`} value={vertreter[t.id] ?? ''} placeholder="Name der vertretenden Person" disabled={fertig}
                    onChange={(e) => setVertreter({ ...vertreter, [t.id]: e.target.value })} onBlur={() => vertreterSpeichern(t)} />
                  <datalist id={`vertreter-${t.id}`}>{namen.filter((x) => x !== t.name).map((x) => <option key={x} value={x} />)}<option value="Verwaltung (KMS)" /></datalist>
                  {t.vertreter ? <Check size={15} color="var(--ev-blau)" /> : null}</div>}
              </div>);
          })}
          {vs.teilnehmer.length === 0 && <p className="ev-hinweis">Für den Tag der Versammlung sind keine Eigentümer eingetragen.</p>}
        </section>
        <section className="ev-glas ev-quorum">
          <div className="ev-ring"><svg width="180" height="180" viewBox="0 0 180 180">
            <circle cx="90" cy="90" r="74" fill="none" stroke="var(--line)" strokeWidth="15" />
            <circle cx="90" cy="90" r="74" fill="none" stroke="var(--ev-gruen)" strokeWidth="15" strokeLinecap={a1 > 1 ? 'round' : 'butt'} strokeDasharray={`${a1} ${umfang}`} />
            <circle cx="90" cy="90" r="74" fill="none" stroke="var(--ev-blau)" strokeWidth="15" strokeLinecap={a2 > 1 ? 'round' : 'butt'} strokeDasharray={`${a2} ${umfang}`} strokeDashoffset={-a1} />
          </svg><div className="mitte"><b>{zahl(meaAnw)}</b><small>von {zahl(meaGes)} MEA</small></div></div>
          <div className="ev-leg">
            <div><span><i style={{ background: 'var(--ev-gruen)' }} />Anwesend</span><b>{n('Anwesend')}</b></div>
            <div><span><i style={{ background: 'var(--ev-blau)' }} />Vertreten</span><b>{n('Vertreten')}</b></div>
            <div><span><i style={{ background: '#8b8d91' }} />Abwesend</span><b>{n('Abwesend')}</b></div>
            {offen > 0 && <div><span><i style={{ background: 'var(--line)' }} />noch offen</span><b>{offen}</b></div>}
          </div>
          <button className="ev-cta voll" onClick={weiter}>Weiter zur Abstimmung →</button>
          {offen > 0 && <small className="muted">Wer nicht erfasst ist, gilt als abwesend.</small>}
        </section>
      </div>
    </>
  );
}

/* ---------- Schritt 2: Abstimmung ---------- */
function Abstimmung({ vs, neu, topId, setTopId, weiter }: { vs: Versammlung; neu: () => void; topId: number | null; setTopId: (n: number) => void; weiter: () => void }) {
  const top = vs.tops.find((t) => t.id === topId);
  const fertig = vs.v.status === 'Durchgeführt';
  const [antrag, setAntrag] = useState('');
  const [notiz, setNotiz] = useState('');
  useEffect(() => { setAntrag(top?.antrag ?? ''); setNotiz(top?.notiz ?? ''); }, [topId, top?.antrag, top?.notiz]);
  const stimmb = vs.teilnehmer.filter((t) => t.status === 'Anwesend' || t.status === 'Vertreten');
  const e = top ? ergebnis(top.id, vs) : null;
  const mea = vs.v.zaehlung === 'MEA';
  const bs = top ? vs.beschluesse.find((b) => b.id === top.beschluss_id) : undefined;
  async function textSpeichern() {
    if (!top) return;
    if ((top.antrag ?? '') !== antrag || (top.notiz ?? '') !== notiz) { await db.execute('UPDATE versammlung_tops SET antrag = $1, notiz = $2 WHERE id = $3', [antrag || null, notiz || null, top.id]); neu(); }
  }
  async function stimme(t: Row, s: Stimme) {
    if (!top || fertig) return;
    const alt = vs.stimmen.find((x) => x.top_id === top.id && x.teilnehmer_id === t.id)?.stimme;
    await stimmeSetzen(top.id, t.id, alt === s ? null : s); neu();
  }
  async function alle(s: Stimme) { if (!top) return; for (const t of stimmb) await stimmeSetzen(top.id, t.id, s); neu(); }
  async function festhalten() {
    if (!top) return;
    await textSpeichern();
    const l = await versammlungLaden(vs.v.id);
    if (!l) return;
    const t = l.tops.find((x) => x.id === top.id)!;
    if (t.beschluss) await beschlussFesthalten(l, t);
    else await db.execute('UPDATE versammlung_tops SET erledigt = 1 WHERE id = $1', [t.id]);
    await neu();
    const naechster = l.tops.find((x) => x.nr > t.nr && !x.erledigt);
    if (naechster) setTopId(naechster.id);
  }
  async function zaehlungUmschalten() { await db.execute('UPDATE versammlungen SET zaehlung = $1 WHERE id = $2', [mea ? 'Kopf' : 'MEA', vs.v.id]); neu(); }
  const max = e ? Math.max(1, e.ja + e.nein + e.enthaltung) : 1;
  const f = (w: number, k: number) => mea ? zahl(w) : String(k);
  return (
    <>
      <div className="ev-sect"><span className="nr">Schritt 02</span><h2>Tagesordnung und Beschlüsse</h2></div>
      <div className="ev-abst">
        <div className="ev-toplist">
          {vs.tops.map((t) => {
            const er = t.beschluss ? vs.beschluesse.find((b) => b.id === t.beschluss_id) : null;
            return <button key={t.id} className={'ev-tl' + (t.id === topId ? ' on' : t.erledigt ? ' ok' : '')} onClick={() => { textSpeichern(); setTopId(t.id); }}>
              <span className="k">{t.erledigt && t.id !== topId ? <Check size={14} /> : t.nr}</span>
              <div>{t.titel.length > 34 ? t.titel.slice(0, 32) + '…' : t.titel}<small>{er ? `${er.ergebnis} ${f(er.ja ?? 0, er.ja ?? 0)} : ${f(er.nein ?? 0, er.nein ?? 0)} : ${f(er.enthaltung ?? 0, er.enthaltung ?? 0)}` : t.erledigt ? 'erledigt' : t.beschluss ? 'Beschluss offen' : 'Information'}</small></div></button>;
          })}
          <button className="ev-cta voll" style={{ marginTop: 6 }} onClick={() => { textSpeichern(); weiter(); }}>Weiter zur Niederschrift →</button>
        </div>
        {top && <section className="ev-glas ev-anim" key={top.id}>
          <div className="card-head"><h2 style={{ fontSize: 19 }}>TOP {top.nr} · {top.titel}</h2>
            {top.beschluss ? <button className="ev-ghost" title="Zählweise umschalten" onClick={zaehlungUmschalten} disabled={fertig}>Zählung: {mea ? 'nach MEA' : 'nach Köpfen'}</button> : <span className="ev-tag i">Information</span>}</div>
          {top.beschluss ? <div className="ev-antrag"><span className="lbl">Beschlussantrag</span>
            <textarea value={antrag} disabled={fertig} onChange={(x) => setAntrag(x.target.value)} onBlur={textSpeichern} placeholder="Wortlaut des Beschlusses" /></div> : null}
          <textarea className="ev-notiz" value={notiz} disabled={fertig} placeholder="Notiz fürs Protokoll (Verlauf, Wortmeldungen) …" onChange={(x) => setNotiz(x.target.value)} onBlur={textSpeichern} />
          {top.beschluss ? <>
            <div className="ev-vgrid">
              {vs.teilnehmer.map((t) => {
                const darf = t.status === 'Anwesend' || t.status === 'Vertreten';
                const s = vs.stimmen.find((x) => x.top_id === top.id && x.teilnehmer_id === t.id)?.stimme;
                return (
                  <div key={t.id} className={'ev-vk' + (s === 'Ja' ? ' j' : s === 'Nein' ? ' n' : s === 'Enthaltung' ? ' e' : '')} style={darf ? undefined : { opacity: .38 }}>
                    <div className="ev-who"><div className={'ev-av ' + (t.status === 'Vertreten' ? 'b' : darf ? 'g' : 'x')}>{kuerzel(t)}</div>
                      <div><b>{nameKurz(t)}</b><small>{t.status === 'Vertreten' ? `vertreten durch ${t.vertreter || '–'}` : darf ? `${t.einheiten} · ${zahl(Number(t.mea) || 0)} MEA` : 'abwesend · keine Stimme'}</small></div></div>
                    <div className="ev-btns">
                      <button className={'ev-vb ja' + (s === 'Ja' ? ' sel' : '')} disabled={!darf || fertig} onClick={() => stimme(t, 'Ja')}>{DAUMEN_HOCH}Ja</button>
                      <button className={'ev-vb ne' + (s === 'Nein' ? ' sel' : '')} disabled={!darf || fertig} onClick={() => stimme(t, 'Nein')}>{DAUMEN_RUNTER}Nein</button>
                      <button className={'ev-vb en' + (s === 'Enthaltung' ? ' sel' : '')} disabled={!darf || fertig} onClick={() => stimme(t, 'Enthaltung')}>{ENTHALTUNG}Enthaltung</button>
                    </div>
                  </div>);
              })}
            </div>
            {!fertig && stimmb.length > 1 && <div className="ev-alle">Für alle: <button onClick={() => alle('Ja')}>alle Ja</button><button onClick={() => alle('Nein')}>alle Nein</button><button onClick={() => alle('Enthaltung')}>alle Enthaltung</button></div>}
            {stimmb.length === 0 && <p className="ev-hinweis" style={{ marginTop: 12 }}>Es ist niemand anwesend oder vertreten. Bitte zuerst die Anwesenheit erfassen.</p>}
            {e && <div className={'ev-ergeb' + (e.abgestimmt ? (e.angenommen ? ' an' : ' ab') : '')}>
              <div className="ev-stamp">{e.offen ? `${e.offen} Stimme${e.offen > 1 ? 'n' : ''} offen` : 'Ergebnis'}<b>{!e.abgestimmt ? '–' : e.angenommen ? 'Angenommen ✓' : 'Abgelehnt'}</b></div>
              <div className="ev-balken">
                <div className="ev-bz">Ja<div className="b"><i style={{ width: `${e.ja / max * 100}%`, background: 'linear-gradient(90deg,#1a9e55,#3fd384)' }} /></div><b>{f(e.ja, e.jaN)}</b></div>
                <div className="ev-bz">Nein<div className="b"><i style={{ width: `${e.nein / max * 100}%`, background: 'linear-gradient(90deg,#d6343d,#ff7a80)' }} /></div><b>{f(e.nein, e.neinN)}</b></div>
                <div className="ev-bz">Enthaltung<div className="b"><i style={{ width: `${e.enthaltung / max * 100}%`, background: '#9aa0aa' }} /></div><b>{f(e.enthaltung, e.enthN)}</b></div>
              </div>
              {fertig ? (bs ? <span className="ev-fest"><Check size={16} />{bs.nummer}</span> : <span />) :
                <button className="ev-cta" disabled={!e.abgestimmt} onClick={festhalten}>{bs ? `${bs.nummer} aktualisieren` : 'Beschluss festhalten'} →</button>}
            </div>}
            <p className="muted small" style={{ marginTop: 8 }}>Einfache Mehrheit der abgegebenen Ja- und Nein-Stimmen, Enthaltungen zählen nicht mit (§ 25 Abs. 1 WEG). {mea ? 'Gezählt wird nach Miteigentumsanteilen.' : 'Jeder Eigentümer hat eine Stimme (Kopfprinzip, § 25 Abs. 2 WEG).'}</p>
          </> : !fertig && <div className="ev-fuss"><span /><button className="ev-cta" onClick={festhalten}>{top.erledigt ? 'Gespeichert' : 'Erledigt'} · nächster TOP →</button></div>}
        </section>}
      </div>
    </>
  );
}

/* ---------- Schritt 3: Niederschrift mit Unterschrift ---------- */
function Unterschriftfeld({ bild, onSpeichern, onLoeschen, gesperrt }: { bild?: string | null; onSpeichern: (png: string) => void; onLoeschen: () => void; gesperrt?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const zug = useRef<{ x: number; y: number } | null>(null);
  const [leer, setLeer] = useState(true);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const r = c.getBoundingClientRect(); c.width = Math.round(r.width * 2); c.height = Math.round(r.height * 2);
    const ctx = c.getContext('2d')!; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#14213d'; ctx.lineWidth = 4.4; setLeer(true);
  }, [bild]);
  const p = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return { x: (e.clientX - r.left) * 2, y: (e.clientY - r.top) * 2 }; };
  if (bild) return <div className="pad"><img src={bild} alt="Unterschrift" />{!gesperrt && <button className="link" style={{ position: 'absolute', right: 0, top: 0, fontSize: 11 }} onClick={onLoeschen}>neu unterschreiben</button>}</div>;
  return (
    <>
      <div className="pad">
        <canvas ref={ref} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); zug.current = p(e); }}
          onPointerMove={(e) => { if (!zug.current) return; const ctx = e.currentTarget.getContext('2d')!; const q = p(e); ctx.beginPath(); ctx.moveTo(zug.current.x, zug.current.y); ctx.lineTo(q.x, q.y); ctx.stroke(); zug.current = q; setLeer(false); }}
          onPointerUp={() => { zug.current = null; }} onPointerLeave={() => { zug.current = null; }} />
        {leer && <span className="leer">Hier mit Finger, Stift oder Maus unterschreiben</span>}
      </div>
      <div className="row"><button disabled={leer} onClick={() => { const c = ref.current!; const ctx = c.getContext('2d')!; ctx.clearRect(0, 0, c.width, c.height); setLeer(true); }}>Löschen</button>
        <button className="primary" disabled={leer} onClick={() => { const c = ref.current!; const w = document.createElement('canvas'); w.width = c.width; w.height = c.height; const x = w.getContext('2d')!; x.fillStyle = '#fff'; x.fillRect(0, 0, w.width, w.height); x.drawImage(c, 0, 0); const r = freistellen(w); if (r) onSpeichern(r.bild); }}>Unterschrift übernehmen</button></div>
    </>
  );
}

function Niederschrift({ vs, neu, busy, onAlle, onAbschliessen, onEinzeln }: { vs: Versammlung; neu: () => void; busy: boolean; onAlle: () => void; onAbschliessen: () => void; onEinzeln: (personId: number) => void }) {
  const [pid, setPid] = useState<number | null>(null);
  const t = vs.teilnehmer.find((x) => x.id === pid) ?? vs.teilnehmer.find((x) => !x.unterschrift && x.status !== 'Abwesend' && x.status) ?? vs.teilnehmer[0];
  const { v } = vs;
  const fertig = v.status === 'Durchgeführt';
  const [leitung, setLeitung] = useState<string>('');
  useEffect(() => { db.select("SELECT wert FROM einstellungen WHERE schluessel = 'unterschrift_bild'").then((r) => setLeitung(r[0]?.wert ?? '')); }, []);
  const anw = useMemo(() => vs.teilnehmer.filter((x) => x.status === 'Anwesend' || x.status === 'Vertreten'), [vs]);
  async function speichern(png: string | null) {
    if (!t) return;
    await db.execute('UPDATE versammlung_teilnehmer SET unterschrift = $1, unterschrieben_am = $2 WHERE id = $3', [png, png ? new Date().toISOString().slice(0, 16).replace('T', ' ') : null, t.id]);
    neu();
  }
  const offeneBeschluesse = vs.tops.filter((x) => x.beschluss && !x.beschluss_id).length;
  return (
    <>
      <div className="ev-sect"><span className="nr">Schritt 03</span><h2>Protokoll und Beschluss-Niederschrift</h2></div>
      <div className="ev-nied">
        <div className="ev-pl">
          <small className="muted">Für jeden Eigentümer gibt es eine eigene Niederschrift mit seinen Stimmen.</small>
          {vs.teilnehmer.map((x) => (
            <button key={x.id} className={'ev-pi' + (t?.id === x.id ? ' on' : '')} onClick={() => setPid(x.id)}>
              <span className={'ev-av s ' + (x.status === 'Vertreten' ? 'b' : x.status === 'Anwesend' ? 'g' : 'x')}>{kuerzel(x)}</span>
              <div>{nameKurz(x)}<small>{x.unterschrift ? `unterschrieben ${String(x.unterschrieben_am ?? '').slice(11, 16)}` : x.status === 'Abwesend' || !x.status ? 'per Post / E-Mail' : 'noch nicht unterschrieben'}</small></div>
              <span className="s" style={{ color: x.unterschrift ? 'var(--ev-gruen)' : 'var(--muted)' }}>{x.unterschrift ? '✓' : x.status === 'Abwesend' || !x.status ? '✉' : '✎'}</span></button>))}
          <button className="ev-ghost" onClick={onAlle}><Printer size={15} />Alle Niederschriften (PDF)</button>
          {!fertig && <button className="ev-cta voll" disabled={busy} onClick={onAbschliessen}>Versammlung abschließen</button>}
          {!fertig && offeneBeschluesse > 0 && <small className="ev-hinweis">{offeneBeschluesse} Beschluss-TOP{offeneBeschluesse > 1 ? 's sind' : ' ist'} noch nicht festgehalten.</small>}
          <small className="muted">Abschließen legt das Protokoll mit allen Niederschriften in die Dokumente und trägt die Anfechtungsfrist (§ 45 WEG) unter „Fristen“ ein. Die Beschlüsse stehen schon in der Beschluss-Sammlung.</small>
        </div>
        {t && <div className="ev-tablet ev-anim" key={t.id}><div className="ev-blatt">
          <div className="lh"><div><h4>Protokoll und Beschluss-Niederschrift</h4>{v.objekt} · {dDatum(v.datum)} · {v.beginn || v.uhrzeit || ''}{v.ende ? `–${v.ende}` : ''} Uhr</div><div className="kms">KM<span>S</span></div></div>
          <div><b>Für:</b> {t.name} · {t.einheiten} · {zahl(Number(t.mea) || 0)} MEA · {t.status === 'Vertreten' ? `vertreten durch ${t.vertreter || '–'}` : (t.status || 'nicht erfasst').toLowerCase()}</div>
          <div className="grau">Anwesend oder vertreten: {anw.length} von {vs.teilnehmer.length} Eigentümern, {zahl(anw.reduce((a, x) => a + (Number(x.mea) || 0), 0))} von {zahl(vs.teilnehmer.reduce((a, x) => a + (Number(x.mea) || 0), 0))} MEA</div>
          {vs.tops.map((top) => {
            const bs = vs.beschluesse.find((b) => b.id === top.beschluss_id);
            const meine = vs.stimmen.find((s) => s.top_id === top.id && s.teilnehmer_id === t.id)?.stimme;
            return <div key={top.id} style={{ marginTop: 10 }}><b>TOP {top.nr} · {top.titel}</b>
              {top.notiz && <div className="grau">{top.notiz}</div>}
              {bs ? <div className={'bt' + (bs.ergebnis === 'Angenommen' ? '' : ' ab')}><b>Beschluss {bs.nummer}:</b> {top.antrag || top.titel}<br />
                <span className={'pp ' + (bs.ergebnis === 'Angenommen' ? 'j' : 'n')}>{bs.ergebnis} {bs.ja ?? 0} : {bs.nein ?? 0} : {bs.enthaltung ?? 0}</span>
                {meine && <span className={'pp ' + (meine === 'Ja' ? 'j' : meine === 'Nein' ? 'n' : '')}>Ihre Stimme: {meine} {meine === 'Ja' ? '👍' : meine === 'Nein' ? '👎' : ''}</span>}</div>
                : top.beschluss ? <div className="grau">Noch nicht abgestimmt.</div> : !top.notiz && <div className="grau">Keine Beschlussfassung.</div>}
            </div>;
          })}
          {vs.beschluesse.length > 0 && <div className="grau" style={{ marginTop: 10 }}>Beschlüsse können innerhalb eines Monats durch Klage angefochten werden (§ 45 WEG).</div>}
          <div className="ev-sigs">
            <div className="ev-sg"><div className="pad">{leitung ? <img src={leitung} alt="Unterschrift Versammlungsleitung" /> : <span className="leer" style={{ color: '#9a9a9a' }}>Unterschrift unter Einstellungen hinterlegen</span>}</div>
              <b>Versammlungsleitung</b><small>{v.leitung || 'KMS Immobilienverwaltung'}</small></div>
            <div className={'ev-sg' + (t.unterschrift ? '' : ' akt')}>
              <Unterschriftfeld bild={t.unterschrift} onSpeichern={(png) => speichern(png)} onLoeschen={() => speichern(null)} />
              <b>Zur Kenntnis genommen</b><small>{nameKurz(t)}{t.status === 'Vertreten' && t.vertreter ? `, vertreten durch ${t.vertreter}` : ''} · {dDatum(v.datum)}</small></div>
          </div>
          <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}><button onClick={() => onEinzeln(t.person_id)}><FileDown size={15} />PDF für {nameKurz(t)}</button></div>
        </div></div>}
      </div>
    </>
  );
}

/* ===================== Vollmachten (Übersicht) ===================== */
export function VollmachtenListe({ objektId }: { objektId: number }) {
  return (
    <EntityTable
      title="Vollmachten"
      icon={<FileDown size={22} />}
      table="versammlung_teilnehmer"
      fields={[
        { key: 'datum', label: 'Versammlung', computed: true, format: (x, r) => `${fDatum(x)} · ${r.art}` },
        { key: 'name', label: 'Eigentümer', computed: true },
        { key: 'einheiten', label: 'Einheit', computed: true },
        { key: 'vertreter', label: 'Vertreten durch', wide: true },
      ]}
      listSql={`SELECT t.id, t.einheiten, t.vertreter, v.datum, v.art, (SELECT TRIM(COALESCE(p.nachname, p.firma, '') || COALESCE(', ' || p.vorname, '')) FROM personen p WHERE p.id = t.person_id) AS name
        FROM versammlung_teilnehmer t JOIN versammlungen v ON v.id = t.versammlung_id WHERE v.objekt_id = $1 AND t.status = 'Vertreten' ORDER BY v.datum DESC`}
      listParams={[objektId]}
      emptyText="Noch keine Vertretungen. Sie entstehen in der Versammlung bei der Anwesenheit mit „Vertreten“."
    />
  );
}

/* ===================== Einstellungen: Versammlungs-Vorlagen ===================== */
export function VorlagenKarte() {
  return (
    <EntityTable
      title="Versammlungs-Vorlagen (Standard-TOPs)"
      icon={<CalendarDays size={22} />}
      table="top_vorlagen"
      newLabel="TOP zur Vorlage hinzufügen"
      groupBy="art"
      fields={[
        { key: 'art', label: 'Vorlage', type: 'select', options: [...ARTEN], required: true, hideInTable: true },
        { key: 'nr', label: 'Nr.', type: 'number', required: true },
        { key: 'titel', label: 'Titel', required: true, wide: true },
        { key: 'beschluss', label: 'Beschluss', type: 'checkbox', format: (x) => x ? 'Beschluss' : 'Info' },
        { key: 'antrag', label: 'Beschlussantrag ({jahr} und {vorjahr} werden ersetzt)', type: 'textarea', hideInTable: true },
        { key: 'bedingung', label: 'Nur wenn', type: 'select', options: [{ value: 'beirat', label: 'Amtszeit des Beirats endet' }], leer: 'immer', format: (x) => x === 'beirat' ? 'Beirat endet' : 'immer' },
      ]}
      listSql="SELECT * FROM top_vorlagen ORDER BY CASE art WHEN 'Ordentliche Versammlung' THEN 1 WHEN 'Außerordentliche Versammlung' THEN 2 ELSE 3 END, nr"
      emptyText="Keine Vorlagen."
    />
  );
}
