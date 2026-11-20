// Offene Bankumsätze einer Liegenschaft direkt unter „Einnahmen & Ausgaben“ buchen: gleiche Zuordnung wie unter „Bank & Zuordnung“
// (Vorschlag übernehmen, Buchen-Fenster, Mieter/Eigentümer), dazu Häkchen für mehrere Umsätze und Löschen.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Landmark, Trash2 } from 'lucide-react';
import { db, type Row } from '../db';
import { objektPersonenSql, personOptions } from '../db/labels';
import { datum, eur } from './EntityTable';
import { BuchenDialog } from './BuchenDialog';
import { MehrfachZuordnen } from './MehrfachZuordnen';
import { umsaetzeLoeschen, vorschlag, zuordnenKonto, zuordnenPerson, zuordnenRechnung, type Vorschlag } from '../logic/bank';

type Opt = { value: number; label: string; gruppe?: string; aktiv?: number };

/** Wer kann diesen Zahlungseingang geleistet haben? Nur Eigentümer und Mieter der Liegenschaft, zu der das Bankkonto gehört
 *  (WEG: Eigentümer zuerst). Gehört das Konto zu keiner Liegenschaft, stehen alle Personen zur Wahl. Kurz zwischengespeichert je Bankkonto. */
const personenCache = new Map<number, { zeit: number; p: Promise<{ weg: boolean; l: Opt[] }> }>();
function personenFuerKonto(bankkontoId: number) {
  const c = personenCache.get(bankkontoId);
  if (c && Date.now() - c.zeit < 15000) return c.p;
  const p = (async () => {
    const o = (await db.select('SELECT o.id, o.verwaltungsart FROM bankkonten b JOIN objekte o ON o.id = b.objekt_id WHERE b.id = $1', [bankkontoId]))[0];
    if (!o) return { weg: false, l: await db.select<Opt>(personOptions()) };
    const weg = o.verwaltungsart === 'WEG';
    const l = await db.select<Opt>(objektPersonenSql(o.id));
    const vorn = weg ? 'Eigentümer' : 'Mieter';
    return { weg, l: [...l.filter((x) => x.gruppe === vorn), ...l.filter((x) => x.gruppe !== vorn)] };
  })();
  personenCache.set(bankkontoId, { zeit: Date.now(), p });
  return p;
}

export function OffeneUmsaetze({ objektId, version, onChange }: { objektId: number | null; version: number; onChange: (info?: string) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [vorschlaege, setVorschlaege] = useState<Record<number, Vorschlag | null>>({});
  const [wahl, setWahl] = useState<Set<number>>(new Set());
  const [alle, setAlle] = useState(false);
  const [buchenU, setBuchenU] = useState<Row | null>(null);
  const [busy, setBusy] = useState('');

  const load = async () => {
    const r = await db.select(`SELECT u.*, k.objekt_id FROM bankumsaetze u JOIN bankkonten k ON k.id = u.bankkonto_id
      WHERE u.status = 'offen' ${objektId ? 'AND k.objekt_id = ' + Number(objektId) : ''} ORDER BY u.datum, u.id`);
    setRows(r);
    setWahl((w) => new Set([...w].filter((id) => r.some((x) => x.id === id))));
    const v: Record<number, Vorschlag | null> = {};
    for (const u of r.slice(0, 60)) v[u.id] = await vorschlag(u);
    setVorschlaege(v);
  };
  useEffect(() => { load(); }, [objektId, version]);
  const fertig = (info?: string) => { load(); onChange(info); };

  if (!rows.length) return null;
  const sichtbar = alle ? rows.slice(0, 300) : rows.slice(0, 25);
  const umschalten = (id: number) => setWahl((w) => { const n = new Set(w); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function vorschlaegeUebernehmen() {
    setBusy('Übernehme Vorschläge …'); let n = 0, gesperrt = 0;
    for (const u of rows.filter((x) => wahl.has(x.id))) {
      const v = vorschlaege[u.id] ?? await vorschlag(u);
      if (!v) continue;
      try {
        if (v.art === 'person') await zuordnenPerson(u, v.id); else if (v.art === 'konto') await zuordnenKonto(u, v.id); else await zuordnenRechnung(u, v.id);
        n++;
      } catch { gesperrt++; }   // Jahr abgeschlossen: Umsatz bleibt offen
    }
    setBusy(''); setWahl(new Set());
    const ohne = wahl.size - n - gesperrt;
    fertig(`${n} Umsätze nach Vorschlag gebucht${ohne ? `, ${ohne} ohne Vorschlag bleiben offen` : ''}${gesperrt ? `, ${gesperrt} nicht gebucht, weil ihr Jahr abgeschlossen ist` : ''}.`);
  }
  async function ignorieren() {
    for (const id of wahl) await db.execute(`UPDATE bankumsaetze SET status = 'ignoriert' WHERE id = $1`, [id]);
    const n = wahl.size; setWahl(new Set()); fertig(`${n} Umsätze ignoriert (zu finden unter Bank & Zuordnung).`);
  }
  async function loeschen(ids: number[]) {
    const summe = rows.filter((r) => ids.includes(r.id)).reduce((a, r) => a + Number(r.betrag), 0);
    if (!window.confirm(`${ids.length} Bankumsatz/Bankumsätze (zusammen ${eur(summe)}) ganz löschen?\n\nWenn du den Kontoauszug erneut importierst, kommen sie wieder.`)) return;
    try { await umsaetzeLoeschen(ids); } catch (e) { fertig(String((e as Error)?.message ?? e)); return; }
    setWahl(new Set()); fertig(`${ids.length} Umsatz/Umsätze gelöscht.`);
  }

  return (
    <section className="card offene-umsaetze">
      <div className="card-head">
        <h2 className="title-ico"><Landmark size={22} />Aus dem Kontoauszug: {rows.length} noch zu buchen</h2>
        <span className="muted small">Summe {eur(rows.reduce((a, r) => a + Number(r.betrag), 0))} · <Link to={objektId ? `/objekte/${objektId}/bank` : '/bank'}>Bank & Zuordnung</Link></span>
      </div>
      {wahl.size > 0 && (
        <div className="auswahl-leiste">
          <b>{wahl.size} ausgewählt</b>
          <button className="primary" disabled={!!busy} onClick={vorschlaegeUebernehmen}>Vorschläge übernehmen</button>
          <button disabled={!!busy} onClick={ignorieren}>Ignorieren</button>
          <button className="danger" disabled={!!busy} onClick={() => loeschen([...wahl])}><Trash2 size={14} /> Löschen</button>
          <button className="link" onClick={() => setWahl(new Set())}>Auswahl aufheben</button>
          {busy && <span className="muted small">{busy}</span>}
        </div>)}
      <div className="tablewrap"><table className="list">
        <thead><tr><th className="wahl"><input type="checkbox" title="Alle auswählen" checked={sichtbar.every((u) => wahl.has(u.id))}
          onChange={(e) => setWahl(e.target.checked ? new Set(sichtbar.map((u) => u.id)) : new Set())} /></th>
          <th>Datum</th><th>Auftraggeber / Empfänger</th><th>Verwendungszweck</th><th className="num">Betrag</th><th style={{ width: 360 }}>Buchen</th></tr></thead>
        <tbody>{sichtbar.map((u) => (
          <tr key={u.id}>
            <td className="wahl"><input type="checkbox" checked={wahl.has(u.id)} onChange={() => umschalten(u.id)} /></td>
            <td className="nowrap">{datum(u.datum)}</td>
            <td>{u.gegenpartei}<div className="muted small">{u.gegen_iban}</div></td>
            <td className="small">{u.verwendungszweck}</td>
            <td className={'num nowrap ' + (u.betrag < 0 ? 'neg' : 'pos')}><b>{eur(u.betrag)}</b></td>
            <td><Zuordnen u={u} v={vorschlaege[u.id]} done={() => fertig()} buchen={() => setBuchenU(u)} />
              <button className="link small neg" onClick={() => loeschen([u.id])}><Trash2 size={13} /> Löschen</button></td>
          </tr>))}</tbody>
      </table></div>
      {rows.length > sichtbar.length && <button className="link" onClick={() => setAlle(true)}>Alle {Math.min(rows.length, 300)} anzeigen</button>}
      {buchenU && <BuchenDialog vorlage={{ umsatz: buchenU, objektId: objektId ?? buchenU.objekt_id, kontoId: vorschlaege[buchenU.id]?.art === 'konto' ? vorschlaege[buchenU.id]!.id : undefined }}
        onClose={() => setBuchenU(null)} onSaved={(t) => { setBuchenU(null); fertig(t); }} />}
    </section>
  );
}

export function Zuordnen({ u, v, done, buchen }: { u: Row; v?: Vorschlag | null; done: () => void; buchen: () => void }) {
  const [wahl, setWahl] = useState('');
  const [personen, setPersonen] = useState<{ weg: boolean; l: Opt[] }>({ weg: false, l: [] });
  useEffect(() => { if (u.betrag > 0) personenFuerKonto(u.bankkonto_id).then(setPersonen); }, [u.bankkonto_id, u.betrag]);
  const gruppen = [...new Set(personen.l.map((p) => p.gruppe ?? ''))];
  const [fehler, setFehler] = useState('');
  const [mehrfach, setMehrfach] = useState(false);
  /** Zuordnen; ist das Jahr abgeschlossen, erscheint der Hinweis statt einer Buchung */
  async function ausfuehren(f: () => Promise<void>) {
    setFehler('');
    try { await f(); done(); } catch (e) { setFehler(String((e as Error)?.message ?? e)); }
  }
  async function ok() {
    if (!wahl) return;
    await ausfuehren(() => zuordnenPerson(u, Number(wahl.split(':')[1])));
  }
  return (
    <div className="zuordnen">
      {v && (
        <div className="row">
          <span className="vorschlag">Vorschlag: <b>{v.label}</b> <span className="muted small">({v.grund})</span></span>
          <button className="primary small-btn" onClick={() => ausfuehren(async () => { if (v.art === 'person') await zuordnenPerson(u, v.id); else if (v.art === 'konto') await zuordnenKonto(u, v.id); else await zuordnenRechnung(u, v.id); })}>Übernehmen</button>
        </div>
      )}
      <div className="row">
        <button className="primary small-btn" onClick={buchen} title="Konto, Einheiten, Buchungsjahr und mehr im Buchen-Fenster wählen">Buchen</button>
        {u.betrag > 0 && <>
          <select value={wahl} onChange={(e) => setWahl(e.target.value)} style={{ flex: 1, minWidth: 0 }}>
            <option value="">{gruppen.length === 1 && gruppen[0] ? `${gruppen[0]} …` : personen.weg ? 'Eigentümer / Mieter …' : 'Mieter / Eigentümer …'}</option>
            {gruppen.map((g) => {
              const opts = personen.l.filter((p) => (p.gruppe ?? '') === g).map((p) =>
                <option key={g + p.value} value={'p:' + p.value}>{p.label}{p.gruppe && !p.aktiv ? ' (früher)' : ''}</option>);
              return g && gruppen.length > 1 ? <optgroup key={g} label={g}>{opts}</optgroup> : opts;
            })}
          </select>
          <button className="small-btn" disabled={!wahl} onClick={ok}>OK</button>
          <button className="small-btn" title="Auf mehrere Eigentümer/Mieter aufteilen oder der Gemeinschaft zuführen (z. B. Miete Funkanlage)" onClick={() => setMehrfach(true)}>Mehrere …</button></>}
        <span className="grow" />
        <button className="link small" onClick={async () => { await db.execute(`UPDATE bankumsaetze SET status='ignoriert' WHERE id=$1`, [u.id]); done(); }}>Ignorieren</button>
      </div>
      {fehler && <p className="error small">{fehler}</p>}
      {mehrfach && <MehrfachZuordnen u={u} start={personen.weg && !v ? 'gemeinschaft' : 'mehrere'} onClose={() => setMehrfach(false)} onDone={() => { setMehrfach(false); done(); }} />}
    </div>
  );
}
