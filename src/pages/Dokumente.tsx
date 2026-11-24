// Dokumentenablage je Objekt, Einheit, Person, Mietvertrag oder Firma mit eigenen Ordnervorlagen.
import { useEffect, useRef, useState } from 'react';
import { loeschen as inPapierkorb } from '../db/papierkorb';
import { db, type Row } from '../db';
import { useObjektKontext } from '../logic/objektKontext';
import { datum } from '../components/EntityTable';
import { ablagePfad, lesen, oeffnen, sicher, speichern, type Ablage } from '../lib/dateien';
import { MailFenster, personWerte, type MailStart } from '../components/MailFenster';
import { einheitLabel, einheitPerson, personLabel } from '../db/labels';
import { DoorOpen, FileText, Mail } from 'lucide-react';
import { OrdnerSymbol } from '../components/OrdnerSymbol';

type Bezug = Exclude<Ablage['bezug'], 'Buchung'>;
const BEZUEGE: Bezug[] = ['Objekt', 'Einheit', 'Mietvertrag', 'Person', 'Firma'];
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const AUSWAHL: Record<Bezug, string> = {
  Objekt: `SELECT id AS value, name AS label FROM objekte ORDER BY name`,
  Einheit: `SELECT e.id AS value, o.name || ' – ' || ${einheitLabel('e')} AS label FROM einheiten e JOIN objekte o ON o.id = e.objekt_id ORDER BY o.name, e.lfd_nr, e.nummer`,
  Mietvertrag: `SELECT v.id AS value, o.name || ' – ' || e.nummer || ' – ' || ${personLabel('p')} AS label FROM mietvertraege v
    JOIN einheiten e ON e.id = v.einheit_id JOIN objekte o ON o.id = e.objekt_id JOIN personen p ON p.id = v.mieter_id ORDER BY label`,
  Person: `SELECT p.id AS value, ${personLabel('p')} AS label FROM personen p ORDER BY label`,
  Firma: `SELECT id AS value, name AS label FROM firmen ORDER BY name`,
};

/** Basis-Ordner in der Ablage je Bezug, z. B. ["Lindenstraße 12", "Einheiten", "WE 01"] */
export async function basisOrdner(bezug: Bezug, id: number): Promise<string[]> {
  const one = async (sql: string) => (await db.select(sql, [id]))[0] ?? {};
  switch (bezug) {
    case 'Objekt': return [(await one('SELECT name FROM objekte WHERE id = $1')).name];
    case 'Einheit': { const r = await one('SELECT o.name, e.nummer FROM einheiten e JOIN objekte o ON o.id = e.objekt_id WHERE e.id = $1'); return [r.name, 'Einheiten', r.nummer]; }
    case 'Mietvertrag': {
      const r = await one(`SELECT o.name, e.nummer, ${personLabel('p')} AS mieter, v.beginn FROM mietvertraege v JOIN einheiten e ON e.id = v.einheit_id
        JOIN objekte o ON o.id = e.objekt_id JOIN personen p ON p.id = v.mieter_id WHERE v.id = $1`);
      return [r.name, 'Einheiten', r.nummer, `Mietvertrag ${r.mieter} ab ${r.beginn}`];
    }
    case 'Person': return ['Personen', (await one(`SELECT ${personLabel('p')} AS n FROM personen p WHERE p.id = $1`)).n];
    case 'Firma': return ['Firmen', (await one('SELECT name FROM firmen WHERE id = $1')).name];
  }
}

export function DokumentePage() {
  const fix = useObjektKontext();
  const [bezug, setBezug] = useState<Bezug>('Objekt');
  const [opts, setOpts] = useState<Row[]>([]);
  const [id, setId] = useState<number | ''>('');
  const [vorlagen, setVorlagen] = useState<Row[]>([]);
  const [vorlage, setVorlage] = useState<number | ''>('');
  const [docs, setDocs] = useState<Row[]>([]);
  const [ziel, setZiel] = useState('');
  const [over, setOver] = useState('');
  const [info, setInfo] = useState('');
  const [basis, setBasis] = useState<string[]>([]);
  const [pfad, setPfad] = useState('');   // geöffneter Unterordner, '' = oberste Ebene
  // Liegenschaft: Ordner „Einheiten“ mit einem Ordner je Einheit, darin nur Unterlagen dieser Einheit (und ihrer Mietverträge)
  const [einheitenOffen, setEinheitenOffen] = useState(false);
  const [einheit, setEinheit] = useState<Row | null>(null);
  const [einheiten, setEinheiten] = useState<Row[]>([]);
  const [eVorlage, setEVorlage] = useState<string[]>([]);
  const effBezug: Bezug = einheit ? 'Einheit' : bezug;
  const effId: number | '' = einheit ? Number(einheit.id) : id;
  // Ansicht merken (nur in diesem Browser bzw. dieser App)
  const [ansicht, setAnsicht] = useState<'Ordner' | 'Liste'>(() => { try { return localStorage.getItem('nano-dokumente-ansicht') === 'Liste' ? 'Liste' : 'Ordner'; } catch { return 'Ordner'; } });
  const ansichtWaehlen = (a: 'Ordner' | 'Liste') => { setAnsicht(a); try { localStorage.setItem('nano-dokumente-ansicht', a); } catch { /* egal */ } };
  const vorWoche = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const fileRef = useRef<HTMLInputElement>(null);
  const [mail, setMail] = useState<MailStart | null>(null);

  /** Dokument als E-Mail über Outlook senden; Empfänger aus Person oder Mietvertrag, Vorlage nach dem Dateinamen */
  async function alsMail(d: Row) {
    setInfo('');
    const bytes = await lesen(d.pfad);
    if (!bytes) { setInfo(`„${d.dateiname}“ wurde nicht gefunden.`); return; }
    let personId: number | null = null, objektId: number | null = null, objekt = '';
    if (d.bezug === 'Person') personId = d.bezug_id;
    if (d.bezug === 'Mietvertrag') {
      const v = (await db.select(`SELECT v.mieter_id, e.objekt_id, e.nummer FROM mietvertraege v JOIN einheiten e ON e.id = v.einheit_id WHERE v.id = $1`, [d.bezug_id]))[0];
      personId = v?.mieter_id ?? null; objektId = v?.objekt_id ?? null;
    }
    if (d.bezug === 'Objekt') objektId = d.bezug_id;
    if (d.bezug === 'Einheit') objektId = (await db.select(`SELECT objekt_id FROM einheiten WHERE id = $1`, [d.bezug_id]))[0]?.objekt_id ?? null;
    if (objektId) objekt = (await db.select(`SELECT name FROM objekte WHERE id = $1`, [objektId]))[0]?.name ?? '';
    const n = String(d.dateiname);
    const vorlage = /nebenkosten|nk-abrechnung/i.test(n) ? 'Nebenkostenabrechnung' : /hausgeld/i.test(n) ? 'Hausgeldabrechnung' : /einladung/i.test(n) ? 'Einladung Eigentümerversammlung'
      : /niederschrift|protokoll/i.test(n) ? 'Niederschrift' : /mahnung|zahlungserinnerung/i.test(n) ? 'Mahnung' : 'Allgemeiner Brief';
    const p = await personWerte(personId);
    setMail({ an: p.an, vorlage, dateien: [{ name: n, bytes }],
      werte: { ...p.werte, Objekt: objekt, Jahr: n.match(/20\d\d/)?.[0] ?? '', Dokument: n.replace(/\.[a-z0-9]+$/i, '') },
      akte: personId ? { person_id: personId, objekt_id: objektId, name: p.name } : null });
  }

  useEffect(() => {
    (async () => {
      const o = await db.select(AUSWAHL[bezug]);
      setOpts(o); setId(fix && bezug === 'Objekt' ? fix.id : o[0]?.value ?? '');
      const v = await db.select('SELECT * FROM ordnervorlagen WHERE bezug = $1 ORDER BY name', [bezug]);
      setVorlagen(v); setVorlage(v[0]?.id ?? '');
    })();
  }, [bezug]);

  const load = async () => {
    if (effId === '') { setDocs([]); return; }
    const eigene = await db.select('SELECT * FROM dokumente WHERE bezug = $1 AND bezug_id = $2 ORDER BY ordner, hinzugefuegt DESC, dateiname', [effBezug, effId]);
    // In der Einheit auch die Unterlagen ihrer Mietverträge, im Ordner „Mietverträge“
    const vertraege = einheit ? (await db.select(`SELECT d.*, ${personLabel('p')} AS mieter, v.beginn FROM dokumente d JOIN mietvertraege v ON v.id = d.bezug_id JOIN personen p ON p.id = v.mieter_id
        WHERE d.bezug = 'Mietvertrag' AND v.einheit_id = $1 ORDER BY v.beginn DESC, d.hinzugefuegt DESC`, [effId]))
      .map((d) => ({ ...d, ordner: ['Mietverträge', `${d.mieter} ab ${datum(d.beginn)}`, ...String(d.ordner || '').split('/').filter((x) => x && x !== 'Mietvertrag')].join('/') })) : [];
    setDocs([...eigene, ...vertraege]);
    setBasis(await basisOrdner(effBezug, Number(effId)));
    if (bezug === 'Objekt' && id !== '') setEinheiten(await db.select(`SELECT e.id, e.nummer, e.lfd_nr, ${einheitPerson('e')} AS person,
        (SELECT COUNT(*) FROM dokumente d WHERE d.bezug = 'Einheit' AND d.bezug_id = e.id)
        + (SELECT COUNT(*) FROM dokumente d JOIN mietvertraege v ON v.id = d.bezug_id WHERE d.bezug = 'Mietvertrag' AND v.einheit_id = e.id) AS dateien
      FROM einheiten e WHERE e.objekt_id = $1 ORDER BY e.lfd_nr, e.nummer`, [id]));
    else setEinheiten([]);
  };
  useEffect(() => { setEinheit(null); setEinheitenOffen(false); }, [bezug, id]);
  useEffect(() => { load(); setPfad(''); }, [bezug, id, einheit?.id]);
  useEffect(() => {
    db.select(`SELECT ordner FROM ordnervorlagen WHERE bezug = 'Einheit' ORDER BY name LIMIT 1`)
      .then((r) => setEVorlage(String(r[0]?.ordner ?? '').split('\n').map((x) => x.trim()).filter(Boolean)));
  }, []);
  const zurObjekt = () => { setEinheit(null); setEinheitenOffen(false); setPfad(''); };

  const vorlagenOrdner = einheit ? eVorlage : String(vorlagen.find((v) => v.id === vorlage)?.ordner ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  const ordner = [...new Set([...vorlagenOrdner, ...docs.map((d) => d.ordner || '')])].filter((x) => x !== undefined);
  if (!ordner.includes('')) ordner.unshift('');
  // Alle Ordner samt übergeordneten („a/b“ bringt „a“ mit), daraus die direkten Unterordner des geöffneten Ordners
  const alle = new Set<string>();
  for (const o of ordner) { const t = o.split('/').filter(Boolean); for (let i = 1; i <= t.length; i++) alle.add(t.slice(0, i).join('/')); }
  const kinder = [...alle].filter((o) => pfad ? o.startsWith(pfad + '/') && !o.slice(pfad.length + 1).includes('/') : !o.includes('/'));
  const hier = docs.filter((d) => (d.ordner || '') === pfad);

  async function hochladen(files: File[], unterordner: string, ziel?: { bezug: Bezug; id: number }) {
    const zb = ziel?.bezug ?? effBezug, zid = ziel?.id ?? effId;
    if (zid === '' || !files.length) return;
    const zbasis = await basisOrdner(zb, Number(zid));
    let n = 0;
    for (const f of files) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      await speichern(bytes, f.name, { bezug: zb, bezugId: Number(zid), ordner: [...zbasis, ...unterordner.split('/').filter(Boolean)] });
      n++;
    }
    // Ordnerpfad in der Liste: alles nach dem Basis-Ordner
    await db.execute(`UPDATE dokumente SET ordner = $1 WHERE id IN (SELECT id FROM dokumente WHERE bezug = $2 AND bezug_id = $3 ORDER BY id DESC LIMIT $4)`,
      [unterordner, zb, zid, n]);
    setInfo(`${n} Datei(en) abgelegt in ${[...zbasis, unterordner].filter(Boolean).join(' / ')}.`);
    load();
  }

  async function ordnerAnlegen() {
    if (!isTauri) { setInfo('Ordner werden in der installierten App auf dem Rechner angelegt.'); return; }
    const { join } = await import('@tauri-apps/api/path');
    const { mkdir } = await import('@tauri-apps/plugin-fs');
    for (const o of vorlagenOrdner) await mkdir(await join(await ablagePfad(), ...basis.map(sicher), ...o.split('/').map(sicher)), { recursive: true });
    // Liegenschaft: auch je Einheit einen Ordner (mit den Ordnern der Einheiten-Vorlage)
    let ne = 0;
    if (!einheit && bezug === 'Objekt') for (const e of einheiten) {
      const eb = await basisOrdner('Einheit', Number(e.id));
      for (const o of eVorlage.length ? eVorlage : ['']) await mkdir(await join(await ablagePfad(), ...eb.map(sicher), ...o.split('/').filter(Boolean).map(sicher)), { recursive: true });
      ne++;
    }
    setInfo(`${vorlagenOrdner.length} Ordner${ne ? ` und ${ne} Einheiten-Ordner` : ''} angelegt in ${await ablagePfad()}.`);
  }

  async function entfernen(d: Row) {
    if (!window.confirm(`„${d.dateiname}“ aus der Liste entfernen? Die Datei selbst bleibt im Ordner erhalten.`)) return;
    await inPapierkorb('dokumente', d.id);
    load();
  }

  return (
    <>
      <div className="page-head"><h1>Dokumente</h1><p className="muted">Ablage nach deiner Ordnervorlage. Dateien hineinziehen oder über „Durchsuchen“ auswählen.</p></div>
      <section className="card row">
        {!fix && <div className="seg">{BEZUEGE.map((b) => <button key={b} className={bezug === b ? 'on' : ''} onClick={() => setBezug(b)}>{b}</button>)}</div>}
        {!fix && <select style={{ width: 340 }} value={id} onChange={(e) => setId(Number(e.target.value))}>
          {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>}
        <select style={{ width: 220 }} value={vorlage} onChange={(e) => setVorlage(Number(e.target.value))}>
          {vorlagen.length === 0 && <option value="">keine Vorlage für {bezug}</option>}
          {vorlagen.map((v) => <option key={v.id} value={v.id}>Vorlage: {v.name}</option>)}
        </select>
        <span className="grow" />
        <button onClick={ordnerAnlegen} disabled={!vorlagenOrdner.length || id === ''}>Ordner auf dem Rechner anlegen</button>
      </section>
      {info && <p className="info">{info}</p>}
      {id === '' ? <section className="card"><p className="muted">Noch nichts angelegt für {bezug}.</p></section> : (
        <section className="card">
          <div className="card-head"><h2>{(einheitenOffen && !einheit ? [...basis, 'Einheiten'] : basis).join(' / ')}</h2>
            <button className="primary" disabled={einheitenOffen && !einheit} title={einheitenOffen && !einheit ? 'Erst eine Einheit öffnen oder Dateien auf ihren Ordner ziehen' : undefined}
              onClick={() => { setZiel(pfad); fileRef.current?.click(); }}>Durchsuchen…</button></div>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => { if (e.target.files) hochladen(Array.from(e.target.files), ziel); e.target.value = ''; }} />
          <div className="seg ordner-umschalter">{(['Ordner', 'Liste'] as const).map((a) => <button key={a} className={ansicht === a ? 'on' : ''} onClick={() => ansichtWaehlen(a)}>{a}</button>)}</div>
          {ansicht === 'Ordner' ? <>
          <nav className="ordner-pfad">
            {(einheit || einheitenOffen) && <>
              <span><button className="link" onClick={zurObjekt}>{opts.find((o) => o.value === id)?.label ?? 'Liegenschaft'}</button><span className="muted"> / </span></span>
              <span>{einheit ? <button className="link" onClick={() => { setEinheit(null); setPfad(''); }}>Einheiten</button> : <b>Einheiten</b>}{einheit && <span className="muted"> / </span>}</span></>}
            {(!einheitenOffen || einheit) && ['', ...pfad.split('/').filter(Boolean).map((_, i, l) => l.slice(0, i + 1).join('/'))].map((z, i, l) => (
              <span key={z || '_'}>{i > 0 && <span className="muted"> / </span>}
                {i === l.length - 1 ? <b>{z ? z.split('/').pop() : basis[basis.length - 1] ?? 'Ablage'}</b>
                  : <button className="link" onClick={() => setPfad(z)}>{z ? z.split('/').pop() : basis[basis.length - 1] ?? 'Ablage'}</button>}</span>))}
          </nav>
          {einheitenOffen && !einheit ? <div className="ordner-raster einheiten-raster">
            <button className="ordner-kachel zurueck" onClick={zurObjekt} title="Eine Ebene höher"><OrdnerSymbol /><span className="ordner-name">..</span><span className="muted small">zurück</span></button>
            {einheiten.map((e) => (
              <button key={e.id} className={'ordner-kachel einheit-ordner' + (over === 'E' + e.id ? ' over' : '')} onClick={() => { setEinheit(e); setPfad(''); }} title={`Ordner der Einheit ${e.nummer} öffnen`}
                onDragOver={(x) => { x.preventDefault(); setOver('E' + e.id); }} onDragLeave={() => setOver('')}
                onDrop={(x) => { x.preventDefault(); setOver(''); hochladen(Array.from(x.dataTransfer.files), '', { bezug: 'Einheit', id: Number(e.id) }); }}>
                <span className="ordner-bild"><OrdnerSymbol voll={Number(e.dateien) > 0} nummer={e.lfd_nr != null ? String(e.lfd_nr).padStart(2, '0') : undefined} /></span>
                <span className="ordner-name">{e.nummer}</span>
                <span className="muted small einheit-person">{e.person ?? 'leer stehend'}</span>
                <span className="muted small">{Number(e.dateien) ? `${e.dateien} Datei${Number(e.dateien) === 1 ? '' : 'en'}` : 'leer'}</span>
              </button>))}
            {!einheiten.length && <p className="muted small">Diese Liegenschaft hat noch keine Einheiten.</p>}
          </div> : <>
          <div className={'ordner-raster' + (over === '#hier' ? ' over' : '')}
            onDragOver={(e) => { e.preventDefault(); if (!over || over === '#hier') setOver('#hier'); }} onDragLeave={() => setOver('')}
            onDrop={(e) => { e.preventDefault(); setOver(''); hochladen(Array.from(e.dataTransfer.files), pfad); }}>
            {pfad && <button className="ordner-kachel zurueck" onClick={() => setPfad(pfad.split('/').slice(0, -1).join('/'))} title="Eine Ebene höher">
              <OrdnerSymbol /><span className="ordner-name">..</span><span className="muted small">zurück</span></button>}
            {kinder.map((k) => {
              const drin = docs.filter((d) => (d.ordner || '') === k || String(d.ordner || '').startsWith(k + '/'));
              const n = drin.length, u = [...alle].filter((x) => x.startsWith(k + '/') && !x.slice(k.length + 1).includes('/')).length;
              const neu = drin.filter((d) => String(d.hinzugefuegt ?? '') >= vorWoche).length;
              const m = k.split('/').pop()!.match(/^(\d{1,3})\s*[-–.]\s*(.+)$/);
              return (
                <button key={k} className={'ordner-kachel' + (over === k ? ' over' : '')} onClick={() => setPfad(k)} title={`${k} öffnen`}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(k); }} onDragLeave={() => setOver('')}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(''); hochladen(Array.from(e.dataTransfer.files), k); }}>
                  <span className="ordner-bild"><OrdnerSymbol voll={n > 0} nummer={m?.[1]} />{neu > 0 && <span className="ordner-neu">{neu} neu</span>}</span>
                  <span className="ordner-name">{m ? m[2] : k.split('/').pop()}</span>
                  <span className="muted small">{[u ? `${u} Ordner` : '', n ? `${n} Datei${n === 1 ? '' : 'en'}` : ''].filter(Boolean).join(' · ') || 'leer'}</span>
                </button>);
            })}
            {bezug === 'Objekt' && !einheit && !pfad && einheiten.length > 0 && (() => {
              const n = einheiten.reduce((a, e) => a + Number(e.dateien), 0);
              return (
                <button className="ordner-kachel einheiten-kachel" onClick={() => { setEinheitenOffen(true); setPfad(''); }} title="Je Einheit ein eigener Ordner">
                  <span className="ordner-bild"><OrdnerSymbol voll={n > 0} /><DoorOpen className="einheiten-tuer" size={22} /></span>
                  <span className="ordner-name">Einheiten</span>
                  <span className="muted small">{einheiten.length} Ordner{n ? ` · ${n} Datei${n === 1 ? '' : 'en'}` : ''}</span>
                </button>);
            })()}
          </div>
          {hier.length > 0 && <table className="list dateiliste"><thead><tr><th>Datei</th><th>Hinzugefügt</th><th /></tr></thead><tbody>
            {hier.map((d) => (
              <tr key={d.id}>
                <td><button className="link" onClick={() => oeffnen(d.pfad)} title={d.pfad}><FileText size={15} /> {d.dateiname}</button></td>
                <td className="muted small">{datum(d.hinzugefuegt)}</td>
                <td className="num nowrap"><button className="link small" title="Über Outlook als E-Mail senden" onClick={() => alsMail(d)}><Mail size={13} />Als E-Mail</button>{' '}
                  <button className="link small muted" onClick={() => entfernen(d)}>entfernen</button></td>
              </tr>))}
          </tbody></table>}
          {!kinder.length && !hier.length && <p className="muted small">Dieser Ordner ist leer. Dateien hierher ziehen oder „Durchsuchen…“ wählen.</p>}
          {einheit && !pfad && <p className="muted small">Hier liegen nur Unterlagen der Einheit {einheit.nummer}. Die Unterlagen ihrer Mietverträge siehst du unter „Mietverträge“.</p>}
          </>}
          </> : <>
          <div className="ordner">
            {ordner.map((o) => {
              const liste = docs.filter((d) => (d.ordner || '') === o);
              return (
                <div key={o || '_'} className={'ordner-box' + (o.includes('/') ? ' sub' : '') + (over === o ? ' over' : '')} style={{ marginLeft: (o.split('/').length - 1) * 24 }}
                  onDragOver={(e) => { e.preventDefault(); setOver(o); }} onDragLeave={() => setOver('')}
                  onDrop={(e) => { e.preventDefault(); setOver(''); hochladen(Array.from(e.dataTransfer.files), o); }}>
                  <div className="ordner-head">
                    <span title={o}>📁 {o ? o.split('/').pop() : '(Hauptordner)'}</span>
                    <span className="muted small">{liste.length} Datei(en)</span>
                    <button className="link small" onClick={() => { setZiel(o); fileRef.current?.click(); }}>+ Datei</button>
                  </div>
                  {liste.map((d) => (
                    <div key={d.id} className="datei">
                      <button className="link" onClick={() => oeffnen(d.pfad)} title={d.pfad}>{d.dateiname}</button>
                      <span className="muted small">{datum(d.hinzugefuegt)}</span>
                      <button className="link small" title="Über Outlook als E-Mail senden" onClick={() => alsMail(d)}><Mail size={13} />Als E-Mail</button>
                      <button className="link small muted" onClick={() => entfernen(d)}>entfernen</button>
                    </div>))}
                </div>);
            })}
          </div>
          </>}
          {mail && <MailFenster start={mail} onClose={() => setMail(null)} onGesendet={setInfo} />}
          {!vorlagenOrdner.length && <p className="muted small">Lege unter Einstellungen eine Ordnervorlage für „{bezug}“ an, dann erscheinen hier deine Ordner.</p>}
        </section>
      )}
    </>
  );
}
