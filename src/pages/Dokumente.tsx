// Dokumentenablage je Objekt, Einheit, Person, Mietvertrag oder Firma mit eigenen Ordnervorlagen.
import { useEffect, useRef, useState } from 'react';
import { db, type Row } from '../db';
import { useObjektKontext } from '../logic/objektKontext';
import { datum } from '../components/EntityTable';
import { ablagePfad, oeffnen, sicher, speichern, type Ablage } from '../lib/dateien';
import { einheitLabel, personLabel } from '../db/labels';
import { FileText } from 'lucide-react';
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
  // Ansicht merken (nur in diesem Browser bzw. dieser App)
  const [ansicht, setAnsicht] = useState<'Ordner' | 'Liste'>(() => { try { return localStorage.getItem('nano-dokumente-ansicht') === 'Liste' ? 'Liste' : 'Ordner'; } catch { return 'Ordner'; } });
  const ansichtWaehlen = (a: 'Ordner' | 'Liste') => { setAnsicht(a); try { localStorage.setItem('nano-dokumente-ansicht', a); } catch { /* egal */ } };
  const vorWoche = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const o = await db.select(AUSWAHL[bezug]);
      setOpts(o); setId(fix && bezug === 'Objekt' ? fix.id : o[0]?.value ?? '');
      const v = await db.select('SELECT * FROM ordnervorlagen WHERE bezug = $1 ORDER BY name', [bezug]);
      setVorlagen(v); setVorlage(v[0]?.id ?? '');
    })();
  }, [bezug]);

  const load = async () => {
    if (id === '') { setDocs([]); return; }
    setDocs(await db.select('SELECT * FROM dokumente WHERE bezug = $1 AND bezug_id = $2 ORDER BY ordner, hinzugefuegt DESC, dateiname', [bezug, id]));
    setBasis(await basisOrdner(bezug, Number(id)));
  };
  useEffect(() => { load(); setPfad(''); }, [bezug, id]);

  const vorlagenOrdner = String(vorlagen.find((v) => v.id === vorlage)?.ordner ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  const ordner = [...new Set([...vorlagenOrdner, ...docs.map((d) => d.ordner || '')])].filter((x) => x !== undefined);
  if (!ordner.includes('')) ordner.unshift('');
  // Alle Ordner samt übergeordneten („a/b“ bringt „a“ mit), daraus die direkten Unterordner des geöffneten Ordners
  const alle = new Set<string>();
  for (const o of ordner) { const t = o.split('/').filter(Boolean); for (let i = 1; i <= t.length; i++) alle.add(t.slice(0, i).join('/')); }
  const kinder = [...alle].filter((o) => pfad ? o.startsWith(pfad + '/') && !o.slice(pfad.length + 1).includes('/') : !o.includes('/'));
  const hier = docs.filter((d) => (d.ordner || '') === pfad);

  async function hochladen(files: File[], unterordner: string) {
    if (id === '') return;
    let n = 0;
    for (const f of files) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      await speichern(bytes, f.name, { bezug, bezugId: Number(id), ordner: [...(await basisOrdner(bezug, Number(id))), ...unterordner.split('/').filter(Boolean)] });
      n++;
    }
    // Ordnerpfad in der Liste: alles nach dem Basis-Ordner
    await db.execute(`UPDATE dokumente SET ordner = $1 WHERE id IN (SELECT id FROM dokumente WHERE bezug = $2 AND bezug_id = $3 ORDER BY id DESC LIMIT $4)`,
      [unterordner, bezug, id, n]);
    setInfo(`${n} Datei(en) abgelegt in ${[...basis, unterordner].filter(Boolean).join(' / ')}.`);
    load();
  }

  async function ordnerAnlegen() {
    if (!isTauri) { setInfo('Ordner werden in der installierten App auf dem Rechner angelegt.'); return; }
    const { join } = await import('@tauri-apps/api/path');
    const { mkdir } = await import('@tauri-apps/plugin-fs');
    for (const o of vorlagenOrdner) await mkdir(await join(await ablagePfad(), ...basis.map(sicher), ...o.split('/').map(sicher)), { recursive: true });
    setInfo(`${vorlagenOrdner.length} Ordner angelegt in ${await ablagePfad()}.`);
  }

  async function entfernen(d: Row) {
    if (!window.confirm(`„${d.dateiname}“ aus der Liste entfernen? Die Datei selbst bleibt im Ordner erhalten.`)) return;
    await db.execute('DELETE FROM dokumente WHERE id = $1', [d.id]);
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
          <div className="card-head"><h2>{basis.join(' / ')}</h2>
            <button className="primary" onClick={() => { setZiel(pfad); fileRef.current?.click(); }}>Durchsuchen…</button></div>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => { if (e.target.files) hochladen(Array.from(e.target.files), ziel); e.target.value = ''; }} />
          <div className="seg ordner-umschalter">{(['Ordner', 'Liste'] as const).map((a) => <button key={a} className={ansicht === a ? 'on' : ''} onClick={() => ansichtWaehlen(a)}>{a}</button>)}</div>
          {ansicht === 'Ordner' ? <>
          <nav className="ordner-pfad">
            {['', ...pfad.split('/').filter(Boolean).map((_, i, l) => l.slice(0, i + 1).join('/'))].map((z, i, l) => (
              <span key={z || '_'}>{i > 0 && <span className="muted"> / </span>}
                {i === l.length - 1 ? <b>{z ? z.split('/').pop() : basis[basis.length - 1] ?? 'Ablage'}</b>
                  : <button className="link" onClick={() => setPfad(z)}>{z ? z.split('/').pop() : basis[basis.length - 1] ?? 'Ablage'}</button>}</span>))}
          </nav>
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
          </div>
          {hier.length > 0 && <table className="list dateiliste"><thead><tr><th>Datei</th><th>Hinzugefügt</th><th /></tr></thead><tbody>
            {hier.map((d) => (
              <tr key={d.id}>
                <td><button className="link" onClick={() => oeffnen(d.pfad)} title={d.pfad}><FileText size={15} /> {d.dateiname}</button></td>
                <td className="muted small">{datum(d.hinzugefuegt)}</td>
                <td className="num"><button className="link small muted" onClick={() => entfernen(d)}>entfernen</button></td>
              </tr>))}
          </tbody></table>}
          {!kinder.length && !hier.length && <p className="muted small">Dieser Ordner ist leer. Dateien hierher ziehen oder „Durchsuchen…“ wählen.</p>}
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
                      <button className="link small muted" onClick={() => entfernen(d)}>entfernen</button>
                    </div>))}
                </div>);
            })}
          </div>
          </>}
          {!vorlagenOrdner.length && <p className="muted small">Lege unter Einstellungen eine Ordnervorlage für „{bezug}“ an, dann erscheinen hier deine Ordner.</p>}
        </section>
      )}
    </>
  );
}
