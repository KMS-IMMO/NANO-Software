import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { db, type Row } from '../db';
import { datum, eur } from '../components/EntityTable';
import { kontoOptions, personOptions } from '../db/labels';
import {
  automatischZuordnen, importieren, parseDatei, vorschlag, zuordnenKonto, zuordnenPerson, zuordnenRechnung, zuordnungLoesen, type Vorschlag,
} from '../logic/bank';

type Opt = { value: number; label: string };

export function BankPage() {
  const [konten, setKonten] = useState<Row[]>([]);
  const [konto, setKonto] = useState<number | ''>('');
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<'offen' | 'zugeordnet' | 'ignoriert' | 'alle'>('offen');
  const [vorschlaege, setVorschlaege] = useState<Record<number, Vorschlag | null>>({});
  const [info, setInfo] = useState('');
  const [drag, setDrag] = useState(false);
  const [personen, setPersonen] = useState<Opt[]>([]);
  const [bkonten, setBkonten] = useState<Opt[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const k = await db.select(`SELECT b.*, o.name AS objekt FROM bankkonten b LEFT JOIN objekte o ON o.id = b.objekt_id ORDER BY o.name`);
      setKonten(k);
      if (k.length && konto === '') setKonto(k[0].id);
      setPersonen(await db.select<Opt>(personOptions()));
      setBkonten(await db.select<Opt>(kontoOptions()));
    })();
  }, []);

  const load = async () => {
    if (konto === '') return;
    const r = await db.select(`SELECT u.*, (SELECT GROUP_CONCAT(b.text, ' | ') FROM buchungen b WHERE b.bankumsatz_id = u.id) AS gebucht
      FROM bankumsaetze u WHERE u.bankkonto_id = $1 ORDER BY u.datum DESC, u.id DESC`, [konto]);
    setRows(r);
    const v: Record<number, Vorschlag | null> = {};
    for (const u of r.filter((x) => x.status === 'offen').slice(0, 100)) v[u.id] = await vorschlag(u);
    setVorschlaege(v);
  };
  useEffect(() => { load(); }, [konto]);

  async function dateien(files: FileList | File[]) {
    if (konto === '') { setInfo('Bitte zuerst ein Bankkonto anlegen und auswählen.'); return; }
    let neu = 0, doppelt = 0;
    try {
      for (const f of Array.from(files)) {
        const buf = await f.arrayBuffer();
        // Viele Banken liefern CSV in Windows-1252 (ANSI); XML ist UTF-8
        let text = new TextDecoder('utf-8').decode(buf);
        if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
        const r = await importieren(Number(konto), parseDatei(f.name, text));
        neu += r.neu; doppelt += r.doppelt;
      }
      const a = await automatischZuordnen();
      setInfo(`${neu} neue Umsätze importiert${doppelt ? `, ${doppelt} waren schon vorhanden` : ''}. ${a.zugeordnet} automatisch zugeordnet, ${a.pruefen} zum Prüfen.`);
    } catch (e: any) {
      setInfo('Fehler beim Import: ' + (e?.message ?? e));
    }
    load();
  }

  async function auto() {
    const a = await automatischZuordnen();
    setInfo(`${a.zugeordnet} automatisch zugeordnet, ${a.pruefen} zum Prüfen.`);
    load();
  }

  const list = rows.filter((r) => filter === 'alle' || r.status === filter);
  const anzahl = (s: string) => rows.filter((r) => r.status === s).length;
  const k = konten.find((x) => x.id === konto);
  const saldo = (Number(k?.anfangssaldo) || 0) + rows.filter((r) => !k?.saldo_datum || r.datum > k.saldo_datum).reduce((a, r) => a + r.betrag, 0);

  if (!konten.length) return (
    <>
      <div className="page-head"><h1>Bank & Zuordnung</h1></div>
      <section className="card"><p>Noch kein Bankkonto vorhanden. Lege unter <Link to="/einstellungen">Einstellungen</Link> für jedes Objekt sein Bankkonto an.</p></section>
    </>
  );

  return (
    <>
      <div className="page-head"><h1>Bank & Zuordnung</h1><p className="muted">Kontoauszug aus dem Online-Banking importieren (CAMT-XML oder CSV, alle deutschen Banken)</p></div>
      <div className="row">
        <select style={{ width: 360 }} value={konto} onChange={(e) => setKonto(Number(e.target.value))}>
          {konten.map((x) => <option key={x.id} value={x.id}>{x.objekt} – {x.name}{x.iban ? ` (${x.iban})` : ''}</option>)}
        </select>
      </div>
      <div className="kpis">
        <div className="kpi"><span>Kontostand laut Import</span><b>{eur(saldo)}</b></div>
        <div className="kpi"><span>Zum Prüfen</span><b className={anzahl('offen') ? 'neg' : ''}>{anzahl('offen')}</b></div>
        <div className="kpi"><span>Zugeordnet</span><b className="pos">{anzahl('zugeordnet')}</b></div>
      </div>

      <section
        className={'card drop' + (drag ? ' over' : '')}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); dateien(e.dataTransfer.files); }}
      >
        <p><b>Kontoauszug hierher ziehen</b> oder <button className="link" onClick={() => fileRef.current?.click()}>Datei auswählen</button></p>
        <p className="muted small">Im Online-Banking unter „Umsätze exportieren“ bzw. „Kontoauszug als CAMT/XML“ herunterladen. Doppelte Umsätze werden automatisch erkannt.</p>
        <input ref={fileRef} type="file" accept=".xml,.csv,.txt" multiple hidden onChange={(e) => { if (e.target.files) dateien(Array.from(e.target.files)); e.target.value = ''; }} />
        {info && <p className="info">{info}</p>}
      </section>

      <section className="card">
        <div className="card-head">
          <div className="seg">{(['offen', 'zugeordnet', 'ignoriert', 'alle'] as const).map((f) =>
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f === 'offen' ? 'Zum Prüfen' : f[0].toUpperCase() + f.slice(1)}</button>)}</div>
          <button onClick={auto}>Automatisch zuordnen</button>
        </div>
        {list.length === 0 ? <p className="muted">Keine Umsätze.</p> : (
          <table className="list">
            <thead><tr><th>Datum</th><th>Auftraggeber / Empfänger</th><th>Verwendungszweck</th><th className="num">Betrag</th><th style={{ width: 340 }}>Zuordnung</th></tr></thead>
            <tbody>
              {list.slice(0, 300).map((u) => (
                <tr key={u.id}>
                  <td>{datum(u.datum)}</td>
                  <td>{u.gegenpartei}<div className="muted small">{u.gegen_iban}</div></td>
                  <td className="small">{u.verwendungszweck}</td>
                  <td className={'num ' + (u.betrag < 0 ? 'neg' : 'pos')}><b>{eur(u.betrag)}</b></td>
                  <td>
                    {u.status === 'offen'
                      ? <Zuordnen u={u} v={vorschlaege[u.id]} personen={personen} konten={bkonten} done={load} />
                      : <div className="small">
                          <span className="muted">{u.status === 'ignoriert' ? 'Ignoriert' : u.gebucht}</span>{' '}
                          <button className="link" onClick={async () => { if (u.status === 'ignoriert') await db.execute(`UPDATE bankumsaetze SET status='offen' WHERE id=$1`, [u.id]); else await zuordnungLoesen(u); load(); }}>Rückgängig</button>
                        </div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function Zuordnen({ u, v, personen, konten, done }: { u: Row; v?: Vorschlag | null; personen: Opt[]; konten: Opt[]; done: () => void }) {
  const [wahl, setWahl] = useState('');
  async function ok() {
    if (!wahl) return;
    const [art, id] = wahl.split(':');
    if (art === 'p') await zuordnenPerson(u, Number(id));
    else await zuordnenKonto(u, Number(id));
    done();
  }
  return (
    <div className="zuordnen">
      {v && (
        <div className="row">
          <span className="vorschlag">Vorschlag: <b>{v.label}</b> <span className="muted small">({v.grund})</span></span>
          <button className="primary small-btn" onClick={async () => { if (v.art === 'person') await zuordnenPerson(u, v.id); else if (v.art === 'konto') await zuordnenKonto(u, v.id); else await zuordnenRechnung(u, v.id); done(); }}>Übernehmen</button>
        </div>
      )}
      <div className="row">
        <select value={wahl} onChange={(e) => setWahl(e.target.value)} style={{ flex: 1, minWidth: 0 }}>
          <option value="">{v ? 'Andere Zuordnung…' : 'Zuordnen zu…'}</option>
          {u.betrag > 0 && <optgroup label="Mieter / Eigentümer (offene Posten)">{personen.map((p) => <option key={'p' + p.value} value={'p:' + p.value}>{p.label}</option>)}</optgroup>}
          <optgroup label="Buchungskonto">{konten.map((k) => <option key={'k' + k.value} value={'k:' + k.value}>{k.label}</option>)}</optgroup>
        </select>
        <button className="small-btn" disabled={!wahl} onClick={ok}>OK</button>
        <button className="link small" onClick={async () => { await db.execute(`UPDATE bankumsaetze SET status='ignoriert' WHERE id=$1`, [u.id]); done(); }}>Ignorieren</button>
      </div>
    </div>
  );
}
