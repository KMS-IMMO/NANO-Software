import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { db, type Row } from '../db';
import { useObjektKontext } from '../logic/objektKontext';
import { datum, eur } from '../components/EntityTable';
import { personOptions } from '../db/labels';
import { BankAbruf, BankVerbindungen } from '../components/BankAbruf';
import { RechnungErfassen } from '../components/RechnungErfassen';
import { BuchungBelege } from '../components/BuchungBelege';
import { BuchenDialog } from '../components/BuchenDialog';
import { Paperclip, Trash2 } from 'lucide-react';
import {
  auszugLesen, automatischZuordnen, importieren, umsaetzeLoeschen, vorschlag, zuordnenKonto, zuordnenPerson, zuordnenRechnung, zuordnungLoesen, type Vorschlag,
} from '../logic/bank';

type Opt = { value: number; label: string };

export function BankPage() {
  const fix = useObjektKontext();
  const [konten, setKonten] = useState<Row[]>([]);
  const [konto, setKonto] = useState<number | ''>('');
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<'offen' | 'zugeordnet' | 'ignoriert' | 'alle'>('offen');
  const [vorschlaege, setVorschlaege] = useState<Record<number, Vorschlag | null>>({});
  const [info, setInfo] = useState('');
  const [drag, setDrag] = useState(false);
  const [personen, setPersonen] = useState<Opt[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [belegUmsatz, setBelegUmsatz] = useState<{ u: Row; datei?: File; objekt?: number } | null>(null);
  const [belegBuchung, setBelegBuchung] = useState<Row | null>(null);
  const [rowOver, setRowOver] = useState<number | null>(null);
  const [buchenU, setBuchenU] = useState<Row | null>(null);
  const [wahl, setWahl] = useState<Set<number>>(new Set());
  async function belegZuUmsatz(u: Row, datei?: File) {
    const objekt = (await db.select('SELECT objekt_id FROM bankkonten WHERE id = $1', [u.bankkonto_id]))[0]?.objekt_id ?? undefined;
    setBelegUmsatz({ u, datei, objekt });
  }
  async function belegeZuordnung(u: Row) {
    const b = (await db.select('SELECT * FROM buchungen WHERE bankumsatz_id = $1 ORDER BY id LIMIT 1', [u.id]))[0];
    if (b) setBelegBuchung(b);
  }

  const ladeKonten = async () => {
    const k = await db.select(`SELECT b.*, o.name AS objekt FROM bankkonten b LEFT JOIN objekte o ON o.id = b.objekt_id ${fix ? `WHERE b.objekt_id = ${fix.id}` : ''} ORDER BY o.name`);
    setKonten(k);
    return k;
  };
  useEffect(() => {
    (async () => {
      const k = await ladeKonten();
      if (k.length && konto === '') setKonto(k[0].id);
      setPersonen(await db.select<Opt>(personOptions()));
    })();
  }, []);

  const load = async () => {
    if (konto === '') return;
    const r = await db.select(`SELECT u.*, (SELECT GROUP_CONCAT(b.text, ' | ') FROM buchungen b WHERE b.bankumsatz_id = u.id) AS gebucht
      FROM bankumsaetze u WHERE u.bankkonto_id = $1 ORDER BY u.datum, u.id`, [konto]);
    setRows(r);
    setWahl((w) => new Set([...w].filter((id) => r.some((x) => x.id === id))));
    const v: Record<number, Vorschlag | null> = {};
    for (const u of r.filter((x) => x.status === 'offen').slice(0, 100)) v[u.id] = await vorschlag(u);
    setVorschlaege(v);
  };
  useEffect(() => { setWahl(new Set()); load(); }, [konto]);
  useEffect(() => { setWahl(new Set()); }, [filter]);

  const umschalten = (id: number) => setWahl((w) => { const n = new Set(w); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function loesenAuswahl() {
    const z = rows.filter((r) => wahl.has(r.id) && r.status !== 'offen');
    if (!z.length) { setInfo('Unter den ausgewählten Umsätzen ist keiner zugeordnet.'); return; }
    if (!window.confirm(`Zuordnung von ${z.length} Umsatz/Umsätzen lösen? Die Buchungen dazu werden gelöscht, die Umsätze stehen danach wieder unter „Zum Prüfen“.`)) return;
    for (const u of z) { if (u.status === 'ignoriert') await db.execute(`UPDATE bankumsaetze SET status='offen' WHERE id=$1`, [u.id]); else await zuordnungLoesen(u); }
    setInfo(`${z.length} Zuordnung(en) gelöst.`); setWahl(new Set()); load();
  }
  async function loeschen(ids: number[]) {
    if (!ids.length) return;
    const summe = rows.filter((r) => ids.includes(r.id)).reduce((a, r) => a + Number(r.betrag), 0);
    if (!window.confirm(`${ids.length} Bankumsatz/Bankumsätze (zusammen ${eur(summe)}) ganz löschen?\n\nZugehörige Buchungen werden ebenfalls gelöscht. Wenn du den Kontoauszug erneut importierst, kommen die Umsätze wieder.`)) return;
    await umsaetzeLoeschen(ids);
    setInfo(`${ids.length} Umsatz/Umsätze gelöscht.`); setWahl(new Set()); load();
  }

  async function dateien(files: FileList | File[]) {
    if (konto === '') { setInfo('Bitte zuerst ein Bankkonto anlegen und auswählen.'); return; }
    let neu = 0, doppelt = 0;
    try {
      for (const f of Array.from(files)) {
        // CSV (auch Windows-1252), CAMT-XML oder PDF-Kontoauszug
        const r = await importieren(Number(konto), (await auszugLesen(f)).umsaetze);
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
      <div className="page-head"><h1>Bank & Zuordnung</h1><p className="muted">Umsätze direkt bei der Bank abrufen (Freigabe in der Banking-App) oder Kontoauszug importieren (CAMT-XML oder CSV)</p></div>
      <div className="row">
        <select style={{ width: 360 }} value={konto} onChange={(e) => setKonto(Number(e.target.value))}>
          {konten.map((x) => <option key={x.id} value={x.id}>{x.objekt} – {x.name}{x.iban ? ` (${x.iban})` : ''}</option>)}
        </select>
        {k && <BankAbruf konto={k} onDone={(m) => { setInfo(m); load(); ladeKonten(); }} />}
        {k?.auto_abruf ? <span className="pill pos-pill" title={k.letzter_abruf ? `Letzter Abruf ${new Date(String(k.letzter_abruf).replace(' ', 'T')).toLocaleString('de-DE')}` : ''}>Automatischer Abruf an</span> : null}
      </div>
      <BankVerbindungen konten={konten} onDone={(m) => { setInfo(m); load(); ladeKonten(); }} />
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
        <p className="muted small">Im Online-Banking unter „Umsätze exportieren“ bzw. „Kontoauszug als CAMT/XML“ herunterladen, oder den PDF-Kontoauszug hineinziehen. Doppelte Umsätze werden automatisch erkannt.</p>
        <input ref={fileRef} type="file" accept=".xml,.csv,.txt,.pdf" multiple hidden onChange={(e) => { if (e.target.files) dateien(Array.from(e.target.files)); e.target.value = ''; }} />
        {info && <p className="info">{info}</p>}
      </section>

      <section className="card">
        <div className="card-head">
          <div className="seg">{(['offen', 'zugeordnet', 'ignoriert', 'alle'] as const).map((f) =>
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f === 'offen' ? 'Zum Prüfen' : f[0].toUpperCase() + f.slice(1)}</button>)}</div>
          <button onClick={auto}>Automatisch zuordnen</button>
        </div>
        {wahl.size > 0 && (
          <div className="auswahl-leiste">
            <b>{wahl.size} ausgewählt</b>
            <button onClick={loesenAuswahl}>Zuordnung lösen</button>
            <button className="danger" onClick={() => loeschen([...wahl])}><Trash2 size={14} /> Umsätze löschen</button>
            <button className="link" onClick={() => setWahl(new Set())}>Auswahl aufheben</button>
          </div>)}
        {list.length === 0 ? <p className="muted">Keine Umsätze.</p> : (
          <table className="list">
            <thead><tr><th className="wahl"><input type="checkbox" title="Alle auswählen"
              checked={list.slice(0, 300).every((u) => wahl.has(u.id))}
              onChange={(e) => setWahl(e.target.checked ? new Set(list.slice(0, 300).map((u) => u.id)) : new Set())} /></th><th>Datum</th><th>Auftraggeber / Empfänger</th><th>Verwendungszweck</th><th className="num">Betrag</th><th style={{ width: 340 }}>Zuordnung</th></tr></thead>
            <tbody>
              {list.slice(0, 300).map((u) => (
                <tr key={u.id} className={rowOver === u.id ? 'beleg-over' : ''}
                  onDragOver={(e) => { if (u.status === 'ignoriert') return; e.preventDefault(); setRowOver(u.id); }} onDragLeave={() => setRowOver(null)}
                  onDrop={(e) => { e.preventDefault(); setRowOver(null); const f = e.dataTransfer.files[0]; if (!f) return; if (u.status === 'offen') belegZuUmsatz(u, f); else if (u.status === 'zugeordnet') belegeZuordnung(u); }}>
                  <td className="wahl"><input type="checkbox" checked={wahl.has(u.id)} onChange={() => umschalten(u.id)} /></td>
                  <td>{datum(u.datum)}</td>
                  <td>{u.gegenpartei}<div className="muted small">{u.gegen_iban}</div></td>
                  <td className="small">{u.verwendungszweck}</td>
                  <td className={'num ' + (u.betrag < 0 ? 'neg' : '')}><b>{eur(u.betrag)}</b></td>
                  <td>
                    {u.status === 'offen'
                      ? <><Zuordnen u={u} v={vorschlaege[u.id]} personen={personen} done={load} buchen={() => setBuchenU(u)} />
                          <button className="link small" onClick={() => belegZuUmsatz(u)} title="Oder PDF direkt auf die Zeile ziehen"><Paperclip size={13} /> Mit Beleg als Rechnung erfassen</button>
                          <button className="link small neg" style={{ marginLeft: 12 }} onClick={() => loeschen([u.id])} title="Umsatz löschen"><Trash2 size={13} /> Löschen</button></>
                      : <div className="small">
                          {u.status === 'zugeordnet' && <button className="icon-btn beleg-btn" title="Belege zur Buchung" onClick={() => belegeZuordnung(u)}><Paperclip size={14} /></button>}
                          <span className="muted">{u.status === 'ignoriert' ? 'Ignoriert' : u.gebucht}</span>{' '}
                          <button className="link" onClick={async () => { if (u.status === 'ignoriert') await db.execute(`UPDATE bankumsaetze SET status='offen' WHERE id=$1`, [u.id]); else await zuordnungLoesen(u); load(); }}>Zuordnung lösen</button>{' '}
                          <button className="link neg" onClick={() => loeschen([u.id])} title="Umsatz löschen"><Trash2 size={13} /></button>
                        </div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {belegUmsatz && (
        <div className="modal-bg" onClick={() => setBelegUmsatz(null)}>
          <div className="modal breit" onClick={(e) => e.stopPropagation()}>
            <div className="card-head"><h3>Bankumsatz mit Beleg erfassen</h3><b className={belegUmsatz.u.betrag < 0 ? 'neg' : 'pos'}>{eur(belegUmsatz.u.betrag)}</b></div>
            <p className="muted small" style={{ margin: 0 }}>{datum(belegUmsatz.u.datum)} · {belegUmsatz.u.gegenpartei} · {belegUmsatz.u.verwendungszweck}</p>
            <RechnungErfassen objektFest={fix?.id ?? belegUmsatz.objekt} vorlage={{ umsatz: belegUmsatz.u, datei: belegUmsatz.datei }}
              onSaved={(t) => { setInfo(t + ' Der Bankumsatz ist zugeordnet.'); setBelegUmsatz(null); load(); }} />
          </div>
        </div>)}
      {buchenU && <BuchenDialog vorlage={{ umsatz: buchenU, objektId: fix?.id, kontoId: vorschlaege[buchenU.id]?.art === 'konto' ? vorschlaege[buchenU.id]!.id : undefined }}
        onClose={() => setBuchenU(null)} onSaved={(t) => { setBuchenU(null); setInfo(t); load(); }} />}
      {belegBuchung && (
        <div className="modal-bg" onClick={() => setBelegBuchung(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Belege zur Bankbuchung</h3>
            <BuchungBelege buchung={belegBuchung} />
            <div className="row end"><button onClick={() => setBelegBuchung(null)}>Fertig</button></div>
          </div>
        </div>)}
    </>
  );
}

function Zuordnen({ u, v, personen, done, buchen }: { u: Row; v?: Vorschlag | null; personen: Opt[]; done: () => void; buchen: () => void }) {
  const [wahl, setWahl] = useState('');
  async function ok() {
    if (!wahl) return;
    await zuordnenPerson(u, Number(wahl.split(':')[1]));
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
        <button className="primary small-btn" onClick={buchen} title="Konto, Einheiten, Buchungsjahr und mehr im Buchen-Fenster wählen">Buchen</button>
        {u.betrag > 0 && <>
          <select value={wahl} onChange={(e) => setWahl(e.target.value)} style={{ flex: 1, minWidth: 0 }}>
            <option value="">Mieter / Eigentümer …</option>
            {personen.map((p) => <option key={'p' + p.value} value={'p:' + p.value}>{p.label}</option>)}
          </select>
          <button className="small-btn" disabled={!wahl} onClick={ok}>OK</button></>}
        <span className="grow" />
        <button className="link small" onClick={async () => { await db.execute(`UPDATE bankumsaetze SET status='ignoriert' WHERE id=$1`, [u.id]); done(); }}>Ignorieren</button>
      </div>
    </div>
  );
}
