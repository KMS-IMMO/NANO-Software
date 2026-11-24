// Fenster „E-Mail schreiben“: neu, Antwort, Weiterleitung oder ein Dokument aus NEOSS als Anhang.
// Gesendet wird über Outlook (Microsoft 365); die Mail landet in „Gesendete Elemente“ und auf Wunsch in der Akte.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Paperclip, Send, X } from 'lucide-react';
import { db, type Row } from '../db';
import {
  adressen, fuellen, GRENZE, postfaecher, senden, status, vorlagen, zuordnen, zurAkte,
  type Datei, type Entwurf, type Konto, type Postfach, type Zuordnung,
} from '../logic/ms365';

export type MailStart = Partial<Entwurf> & {
  /** Name einer Textvorlage, die beim Öffnen eingesetzt wird */
  vorlage?: string;
  /** Werte für die Platzhalter der Vorlage */
  werte?: Record<string, string | undefined>;
  /** Akte, zu der die Mail gehört (sonst über die Empfängeradresse gesucht) */
  akte?: { person_id?: number | null; firma_id?: number | null; objekt_id?: number | null; name?: string } | null;
  titel?: string;
};

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function MailFenster({ start, onClose, onGesendet }: { start: MailStart; onClose: () => void; onGesendet?: (info: string) => void }) {
  const [konto, setKonto] = useState<Konto | null | undefined>(undefined);
  const [boxen, setBoxen] = useState<Postfach[]>([]);
  const [vl, setVl] = useState<Row[]>([]);
  const [e, setE] = useState<Entwurf>({ postfach: start.postfach ?? 'me', an: start.an ?? '', cc: start.cc ?? '', betreff: start.betreff ?? '', text: start.text ?? '', dateien: start.dateien ?? [], modus: start.modus ?? 'neu', bezugId: start.bezugId });
  const [vorlage, setVorlage] = useState(start.vorlage ?? '');
  const [akte, setAkte] = useState<Zuordnung | null>(null);
  const [ablegen, setAblegen] = useState(true);
  const [busy, setBusy] = useState('');
  const [fehler, setFehler] = useState('');
  const datei = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const k = await status().catch(() => null);
      setKonto(k);
      if (k) setBoxen(await postfaecher(k));
      const v = await vorlagen();
      setVl(v);
      const w = { ...(start.werte ?? {}), Sachbearbeiter: start.werte?.Sachbearbeiter || k?.name || '' };
      const t = v.find((x) => x.name === start.vorlage);
      if (t) setE((x) => ({ ...x, betreff: x.betreff || fuellen(t.betreff ?? '', w), text: x.text || fuellen(t.text ?? '', w) }));
    })();
  }, []);

  // Akte: vorgegeben oder über die Adresse der Empfänger
  useEffect(() => {
    const a = start.akte;
    if (a?.person_id || a?.firma_id) {
      setAkte({ art: a.person_id ? 'person' : 'firma', id: (a.person_id ?? a.firma_id)!, name: a.name ?? '', rolle: '', objekt_id: a.objekt_id });
      return;
    }
    const t = setTimeout(() => { zuordnen(adressen(e.an).map((x) => x.emailAddress.address)).then(setAkte).catch(() => setAkte(null)); }, 300);
    return () => clearTimeout(t);
  }, [e.an]);

  function vorlageSetzen(name: string) {
    setVorlage(name);
    const t = vl.find((x) => x.name === name);
    if (!t) return;
    const w = { ...(start.werte ?? {}), Sachbearbeiter: start.werte?.Sachbearbeiter || konto?.name || '' };
    setE({ ...e, betreff: fuellen(t.betreff ?? '', w), text: fuellen(t.text ?? '', w) });
  }

  async function dateienDazu(f: FileList | null) {
    if (!f) return;
    const neu: Datei[] = [];
    for (const x of Array.from(f)) neu.push({ name: x.name, bytes: new Uint8Array(await x.arrayBuffer()) });
    setE((v) => ({ ...v, dateien: [...v.dateien, ...neu] }));
    if (datei.current) datei.current.value = '';
  }

  const groesse = e.dateien.reduce((s, d) => s + d.bytes.length, 0);

  async function los(nurEntwurf: boolean) {
    setFehler('');
    if (e.modus !== 'antworten' && e.modus !== 'allen' && !e.an.trim()) { setFehler('Bitte einen Empfänger eintragen.'); return; }
    if (e.modus === 'neu' && !e.betreff.trim()) { setFehler('Bitte einen Betreff eintragen.'); return; }
    if (groesse > GRENZE) { setFehler('Die Anhänge sind zusammen größer als 3 MB.'); return; }
    setBusy(nurEntwurf ? 'entwurf' : 'senden');
    try {
      const r = await senden(e, nurEntwurf);
      const box = boxen.find((b) => b.adresse === e.postfach);
      let info = nurEntwurf ? 'Als Entwurf in Outlook abgelegt.' : 'Gesendet.';
      if (!nurEntwurf && ablegen && akte) {
        await zurAkte({
          postfach: e.postfach, conversation_id: r.conversationId ?? null, richtung: 'aus',
          von: box?.eigen ? konto?.mail ?? '' : e.postfach, an: e.an, betreff: e.betreff || (start.titel ?? ''), datum: new Date().toISOString(), text: e.text,
          anhaenge: e.dateien.map((d) => d.name),
          person_id: akte.art === 'person' ? akte.id : null, firma_id: akte.art === 'firma' ? akte.id : null, objekt_id: akte.objekt_id ?? start.akte?.objekt_id ?? null,
        });
        info += ` Die Mail liegt in der Akte von ${akte.name || 'der Person'}.`;
      }
      onGesendet?.(info);
      onClose();
    } catch (x: any) {
      setFehler(String(x?.message ?? x));
    } finally { setBusy(''); }
  }

  const titel = start.titel ?? (e.modus === 'antworten' || e.modus === 'allen' ? 'Antworten' : e.modus === 'weiterleiten' ? 'Weiterleiten' : 'Neue E-Mail');

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal mail-fenster" onClick={(x) => x.stopPropagation()}>
        <div className="card-head"><h3>{titel}</h3><span className="pill ms-pill">über Outlook</span></div>
        {konto === null && <p className="info">Noch nicht mit Microsoft 365 verbunden. <Link to="/microsoft-365" onClick={onClose}>Jetzt verbinden</Link></p>}
        <div className="mail-felder">
          <label><span>Von</span>
            <select value={e.postfach} onChange={(x) => setE({ ...e, postfach: x.target.value })} disabled={e.modus !== 'neu'}>
              {(boxen.length ? boxen : [{ adresse: 'me', name: 'Mein Postfach', eigen: true }]).map((b) => <option key={b.adresse} value={b.adresse}>{b.eigen ? `${b.name}${konto?.mail ? ` <${konto.mail}>` : ''}` : b.adresse}</option>)}
            </select></label>
          <label><span>An</span><input value={e.an} onChange={(x) => setE({ ...e, an: x.target.value })} placeholder={e.modus === 'antworten' || e.modus === 'allen' ? 'wie in der ursprünglichen Mail' : 'name@beispiel.de; weitere mit Semikolon'} /></label>
          <label><span>Cc</span><input value={e.cc ?? ''} onChange={(x) => setE({ ...e, cc: x.target.value })} /></label>
          {e.modus === 'neu' && <label><span>Betreff</span><input value={e.betreff} onChange={(x) => setE({ ...e, betreff: x.target.value })} /></label>}
          {e.modus === 'neu' && vl.length > 0 && <label><span>Vorlage</span>
            <select value={vorlage} onChange={(x) => vorlageSetzen(x.target.value)}><option value="">– ohne Vorlage –</option>{vl.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}</select></label>}
        </div>
        <textarea className="mail-text" rows={12} value={e.text} onChange={(x) => setE({ ...e, text: x.target.value })} placeholder="Text der E-Mail" />
        {(e.modus === 'antworten' || e.modus === 'allen' || e.modus === 'weiterleiten') && <p className="muted small">Die ursprüngliche Mail wird wie in Outlook unten angehängt.</p>}
        <div className="mail-anhaenge">
          {e.dateien.map((d, i) => (
            <span key={i} className="mail-datei"><b className="mail-pdf">{(d.name.split('.').pop() ?? '').toUpperCase().slice(0, 4)}</b>{d.name} · {kb(d.bytes.length)}
              <button className="icon-btn" title="Anhang entfernen" onClick={() => setE({ ...e, dateien: e.dateien.filter((_, k) => k !== i) })}><X size={14} /></button></span>))}
          <button className="small-btn" onClick={() => datei.current?.click()}><Paperclip size={14} />Datei anhängen</button>
          <input ref={datei} type="file" multiple hidden onChange={(x) => dateienDazu(x.target.files)} />
        </div>
        {fehler && <p className="info mail-fehler">{fehler}</p>}
        <div className="row end mail-fuss">
          <label className="inline">
            <input type="checkbox" checked={ablegen && !!akte} disabled={!akte} onChange={(x) => setAblegen(x.target.checked)} />
            {akte ? <>In der Akte von <b>{akte.name}</b> ablegen</> : <span className="muted">Empfänger ist keiner Akte zugeordnet</span>}
          </label>
          <span className="grow" />
          <button onClick={onClose}>Abbrechen</button>
          <button disabled={!!busy || !konto} onClick={() => los(true)}>{busy === 'entwurf' ? 'Wird abgelegt …' : 'Als Entwurf in Outlook'}</button>
          <button className="primary" disabled={!!busy || !konto} onClick={() => los(false)}><Send size={15} />{busy === 'senden' ? 'Wird gesendet …' : 'Senden'}</button>
        </div>
      </div>
    </div>
  );
}

/** Daten einer Person für die Platzhalter einer Vorlage */
export async function personWerte(personId?: number | null): Promise<{ an: string; werte: Record<string, string>; name: string; person?: Row }> {
  if (!personId) return { an: '', werte: {}, name: '' };
  const p = (await db.select(`SELECT * FROM personen WHERE id = $1`, [personId]))[0];
  if (!p) return { an: '', werte: {}, name: '' };
  const { briefanrede } = await import('../logic/ms365');
  const name = [p.vorname, p.nachname].filter(Boolean).join(' ') || p.firma || '';
  return { an: p.email ? `${name} <${p.email}>` : '', name, person: p, werte: { Briefanrede: briefanrede(p), Name: name } };
}
