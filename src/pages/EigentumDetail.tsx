// Ansicht eines Eigentümers einer Einheit: alle Angaben zur Person, Kontakt und Bank sowie zum Eigentum (seit, Anteil, Zahlweise),
// Hausgeld anpassen, Zahlungen und offene Posten, Mieter der Wohnung (bzw. Wohnung vermieten)
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Coins, IdCard, KeyRound, Pencil, ReceiptText, Trash2, X } from 'lucide-react';
import { db, type Row } from '../db';
import { datum, eur, num } from '../components/EntityTable';
import { BetragFeld } from '../components/BetragFeld';
import { MieterAnlegen } from '../components/MieterAnlegen';
import { betragZahl } from '../lib/betrag';
import { StammdatenKarte, personFelder, personWerte, personAenderungen, type SGruppe } from '../components/Stammdaten';
import { OP_SQL, hausgeldNeuStellen } from '../logic/soll';
import { personLabel, widSql } from '../db/labels';
import { DatumFeld } from '../components/DatumFeld';
import { hausgeldAendern, hausgeldLoeschen, hausgeldSperre, type HausgeldErgebnis } from '../logic/hausgeld';

export function EigentumDetailPage({ objektId, eigentumId }: { objektId: number; eigentumId: number }) {
  const [ei, setEi] = useState<Row | null | undefined>(undefined);
  const [p, setP] = useState<Row | undefined>();
  const [hg, setHg] = useState<Row | undefined>();
  const [offen, setOffen] = useState(0);
  const [wo, setWo] = useState('');
  const [verlauf, setVerlauf] = useState<Row[]>([]);
  const [posten, setPosten] = useState<Row[]>([]);
  const [zahlungen, setZahlungen] = useState<Row[]>([]);
  const [vertrag, setVertrag] = useState<Row | null>(null);
  const [einheit, setEinheit] = useState<Row | null>(null);
  const [objekt, setObjekt] = useState<Row | null>(null);
  const [vermieten, setVermieten] = useState(false);
  const [info, setInfo] = useState('');
  const nav = useNavigate();
  const reload = async () => {
    const r = (await db.select(`SELECT ei.*, e.nummer AS einheit, e.lage, e.flaeche, e.mea, ${widSql('e', 'o')} AS wid, o.name AS objekt, o.ruecklage_zahlweise,
        ${personLabel('p')} AS name,
        CASE WHEN ei.von > date('now') THEN 'künftig' WHEN ei.bis IS NOT NULL AND ei.bis < date('now') THEN 'beendet' ELSE 'aktiv' END AS status
      FROM eigentum ei JOIN einheiten e ON e.id = ei.einheit_id JOIN objekte o ON o.id = e.objekt_id JOIN personen p ON p.id = ei.person_id
      WHERE ei.id = $1`, [eigentumId]))[0] ?? null;
    setEi(r);
    if (!r) return;
    setP((await db.select('SELECT * FROM personen WHERE id = $1', [r.person_id]))[0]);
    setHg((await db.select(`SELECT * FROM hausgeld WHERE einheit_id = $1 AND gueltig_ab <= date('now') ORDER BY gueltig_ab DESC LIMIT 1`, [r.einheit_id]))[0]);
    setOffen(Number((await db.select(`SELECT SUM(betrag - bezahlt) AS s FROM (${OP_SQL}) WHERE person_id = $1 AND einheit_id = $2 AND faellig <= date('now')`,
      [r.person_id, r.einheit_id]))[0]?.s ?? 0));
    setVerlauf(await db.select('SELECT * FROM hausgeld WHERE einheit_id = $1 ORDER BY gueltig_ab DESC', [r.einheit_id]));
    // Posten des laufenden Jahres und ältere, die noch offen sind
    setPosten(await db.select(`SELECT * FROM (${OP_SQL}) WHERE person_id = $1 AND einheit_id = $2
      AND (substr(monat, 1, 4) >= strftime('%Y', 'now') OR betrag - bezahlt > 0.005) ORDER BY monat DESC, id DESC`, [r.person_id, r.einheit_id]));
    setZahlungen(await db.select(`SELECT b.datum, SUM(b.betrag) AS betrag, MAX(COALESCE(u.gegenpartei, '')) AS von, GROUP_CONCAT(DISTINCT s.art) AS arten
      FROM buchungen b JOIN sollstellungen s ON s.id = b.sollstellung_id LEFT JOIN bankumsaetze u ON u.id = b.bankumsatz_id
      WHERE s.person_id = $1 AND s.einheit_id = $2 GROUP BY COALESCE(b.bankumsatz_id, -b.id), b.datum ORDER BY b.datum DESC LIMIT 12`, [r.person_id, r.einheit_id]));
    setVertrag((await db.select(`SELECT v.*, ${personLabel('m')} AS mieter FROM mietvertraege v JOIN personen m ON m.id = v.mieter_id
      WHERE v.einheit_id = $1 AND v.beginn <= date('now') AND (v.ende IS NULL OR v.ende >= date('now')) ORDER BY v.beginn DESC LIMIT 1`, [r.einheit_id]))[0] ?? null);
    setEinheit((await db.select('SELECT * FROM einheiten WHERE id = $1', [r.einheit_id]))[0] ?? null);
    setObjekt((await db.select('SELECT * FROM objekte WHERE id = $1', [objektId]))[0] ?? null);
    setWo((await db.select(`SELECT GROUP_CONCAT(x, '; ') AS wo FROM (
        SELECT o.name || ' ' || e.nummer || ' (Eigentümer)' AS x FROM eigentum x JOIN einheiten e ON e.id = x.einheit_id JOIN objekte o ON o.id = e.objekt_id
          WHERE x.person_id = $1 AND (x.bis IS NULL OR x.bis >= date('now'))
        UNION ALL SELECT o.name || ' ' || e.nummer || ' (Mieter)' FROM mietvertraege m JOIN einheiten e ON e.id = m.einheit_id JOIN objekte o ON o.id = e.objekt_id
          WHERE (m.mieter_id = $1 OR m.mieter2_id = $1) AND (m.ende IS NULL OR m.ende >= date('now')))`, [r.person_id]))[0]?.wo ?? '');
  };
  useEffect(() => { reload(); }, [eigentumId]);
  if (ei === undefined) return <p>Wird geladen…</p>;
  if (ei === null) return <p className="muted">Diesen Eintrag gibt es nicht mehr. <Link to={`/objekte/${objektId}/eigentuemer`}>Zurück zu den Eigentümern</Link></p>;

  const rl = Number(hg?.davon_ruecklage) || 0, gesamt = Number(hg?.betrag) || 0;
  const gruppen: SGruppe[] = [
    ...personFelder('Eigentümer', [{ key: 'wo', label: 'Hinterlegt bei', breit: 3, anzeige: wo || '–' }]),
    { titel: 'Eigentum', felder: [
      { key: 'einheit', label: 'Einheit', nurLesen: true, anzeige: <>{ei.wid} · {ei.einheit}{ei.lage ? ` · ${ei.lage}` : ''}</> },
      { key: 'mea', label: 'MEA / Fläche', nurLesen: true, anzeige: <>{num(ei.mea, 0) || '–'} MEA · {ei.flaeche ? `${num(ei.flaeche)} m²` : '–'}</> },
      { key: 'e_anteil', label: 'Anteil %', typ: 'zahl' },
      { key: 'e_von', label: 'Eigentümer seit', typ: 'datum' },
      { key: 'e_bis', label: 'bis (Verkauf)', typ: 'datum' },
      { key: 'e_zahlweise', label: 'Zahlweise Hausgeld + Rücklage', typ: 'auswahl', optionen: [
        { value: '', label: `wie Liegenschaft (${ei.ruecklage_zahlweise === 'getrennt' ? 'getrennt' : 'in einer Summe'})` },
        { value: 'zusammen', label: 'in einer Summe' }, { value: 'getrennt', label: 'getrennt' }] },
    ] },
  ];

  const speichern = async (neu: Row) => {
    if ('p_nachname' in neu || 'p_firma' in neu) {
      const nn = 'p_nachname' in neu ? neu.p_nachname : p?.nachname, fi = 'p_firma' in neu ? neu.p_firma : p?.firma;
      if (!nn && !fi) throw new Error('Bitte Nachname oder Firma angeben.');
    }
    const von = 'e_von' in neu ? neu.e_von : ei.von, bis = 'e_bis' in neu ? neu.e_bis : ei.bis;
    if (von && bis && bis < von) throw new Error('„bis“ liegt vor „Eigentümer seit“.');
    const pa = personAenderungen(neu);
    if (pa) await db.execute(`UPDATE personen SET ${pa.sql} WHERE id = $${pa.werte.length + 1}`, [...pa.werte, ei.person_id]);
    const ek = ['e_anteil', 'e_von', 'e_bis', 'e_zahlweise'].filter((k) => k in neu);
    if (ek.length) {
      const w = (k: string) => (k === 'e_anteil' ? (neu[k] == null ? 100 : Number(neu[k])) : neu[k]);
      await db.execute(`UPDATE eigentum SET ${ek.map((k, i) => `${k.slice(2)} = $${i + 1}`).join(', ')} WHERE id = $${ek.length + 1}`, [...ek.map(w), ei.id]);
      // Zeitraum, Anteil oder Zahlweise bestimmen die Hausgeld-Posten: offene (unbezahlte) neu stellen
      const n = await hausgeldNeuStellen(objektId, '0000-00');
      await reload();
      return n ? `Gespeichert. Offene Hausgeld-Posten wurden neu gestellt (bezahlte bleiben unverändert).` : 'Gespeichert.';
    }
    await reload();
    return 'Gespeichert.';
  };

  return (
    <>
      <div className="page-head">
        <p className="muted small"><Link to={`/objekte/${objektId}/eigentuemer`}>Eigentümer</Link> ›</p>
        <h1>{ei.name} <span className={'pill ' + ei.status}>{ei.status}</span></h1>
        <p className="muted">{ei.objekt} – {ei.einheit} · Eigentümer seit {ei.von ? datum(ei.von) : '–'}{ei.bis ? ` · bis ${datum(ei.bis)}` : ''} · Anteil {num(ei.anteil ?? 100, 0)} %</p>
      </div>
      <div className="kpis">
        <div className="kpi"><span>Hausgeld aktuell</span><b>{hg ? eur(gesamt) : '–'}</b></div>
        <div className="kpi"><span>davon Rücklage</span><b>{hg ? eur(rl) : '–'}</b></div>
        <div className="kpi"><span>Zahlweise</span><b>{(ei.zahlweise || ei.ruecklage_zahlweise) === 'getrennt' ? 'getrennt' : 'eine Summe'}</b></div>
        <div className="kpi"><span>Offen (fällig)</span><b className={offen > 0.005 ? 'neg' : ''}>{eur(offen)}</b></div>
      </div>
      <StammdatenKarte rolle="eigentuemer" key={ei.id} titel="Eigentümer und Eigentum" icon={<IdCard size={22} />} gruppen={gruppen}
        werte={{ ...personWerte(p), e_anteil: ei.anteil ?? 100, e_von: ei.von, e_bis: ei.bis, e_zahlweise: ei.zahlweise ?? '' }}
        onSpeichern={speichern}
        pdf={{ titel: 'Stammblatt Eigentümer', zeilen: [String(ei.name ?? ''), `${ei.objekt} – ${ei.einheit} · Anteil ${num(ei.anteil ?? 100, 0)} %`],
          datei: `Stammblatt ${ei.name} ${ei.objekt} ${ei.einheit}.pdf`,
          vorab: { titel: 'Hausgeld', felder: [['Hausgeld aktuell', hg ? eur(gesamt) : '–'], ['davon Rücklage', hg ? eur(rl) : '–'], ['Zahlweise', (ei.zahlweise || ei.ruecklage_zahlweise) === 'getrennt' ? 'getrennt' : 'eine Summe'], ['Offen (fällig)', eur(offen)]] } }} />
      {info && <p className="info">{info}</p>}
      <div className="grid2 eigentum-raster">
        <HausgeldAnpassen einheitId={ei.einheit_id} objektId={objektId} aktuell={hg} verlauf={verlauf} nk={vertrag ? Number(vertrag.nk_vorauszahlung) + Number(vertrag.hk_vorauszahlung) : 0}
          onSaved={(t) => { setInfo(t); reload(); }} />
        <section className="card">
          <div className="card-head"><h2 className="title-ico"><KeyRound size={20} />Mieter der Wohnung</h2></div>
          {vertrag ? <>
            <table className="list kompakt"><tbody>
              <tr><td>Mieter</td><td><b>{vertrag.mieter}</b></td></tr>
              <tr><td>Mietbeginn</td><td>{datum(vertrag.beginn)}{vertrag.ende ? ` bis ${datum(vertrag.ende)}` : ''}</td></tr>
              <tr><td>NK-Vorauszahlung / Monat</td><td>{eur(Number(vertrag.nk_vorauszahlung) + Number(vertrag.hk_vorauszahlung))}</td></tr>
              <tr><td>Mieter zahlt an</td><td>{vertrag.zahlung_an || 'Verwaltung'}</td></tr>
            </tbody></table>
            <div className="row"><button onClick={() => nav(`/objekte/${objektId}/vertrag/${vertrag.id}`)}><KeyRound size={16} />Mietvertrag öffnen</button></div>
          </> : <>
            <p className="muted">Die Wohnung ist nicht vermietet (selbst genutzt oder leer).</p>
            <div className="row"><button className="primary" onClick={() => setVermieten(true)}><KeyRound size={16} />Wohnung vermieten</button></div>
            <p className="muted small">Du trägst Mieter, Mietbeginn und Nebenkosten-Vorauszahlung ein. Daraus entsteht die Nebenkostenabrechnung für den Mieter.</p>
          </>}
        </section>
      </div>
      <section className="card">
        <div className="card-head"><h2 className="title-ico"><ReceiptText size={20} />Hausgeld: gefordert und gezahlt</h2>
          <span className="muted small">laufendes Jahr und ältere offene Posten</span></div>
        {posten.length === 0 ? <p className="muted">Noch keine Hausgeld-Posten. Sie entstehen unter „Sollstellungen“.</p> : (
          <div className="tablewrap"><table className="list">
            <thead><tr><th>Monat</th><th>Art</th><th>fällig</th><th className="num">gefordert</th><th className="num">gezahlt</th><th className="num">offen</th></tr></thead>
            <tbody>{posten.map((x) => { const o = Math.round((x.betrag - x.bezahlt) * 100) / 100; return (
              <tr key={x.id}><td>{x.monat}</td><td>{x.art}</td><td>{datum(x.faellig)}</td><td className="num">{eur(x.betrag)}</td><td className="num">{eur(x.bezahlt)}</td>
                <td className={'num' + (o > 0.005 ? ' neg' : '')}>{o > 0.005 ? eur(o) : '–'}</td></tr>); })}</tbody>
            <tfoot><tr><td colSpan={3}>Summe</td><td className="num">{eur(posten.reduce((a, x) => a + Number(x.betrag), 0))}</td>
              <td className="num">{eur(posten.reduce((a, x) => a + Number(x.bezahlt), 0))}</td>
              <td className="num">{eur(posten.reduce((a, x) => a + Math.max(0, x.betrag - x.bezahlt), 0))}</td></tr></tfoot>
          </table></div>)}
        {zahlungen.length > 0 && <>
          <h3 className="unter-titel">Letzte Zahlungen</h3>
          <table className="list kompakt"><tbody>{zahlungen.map((z, i) => (
            <tr key={i}><td>{datum(z.datum)}</td><td>{z.von || '–'}</td><td className="muted small">{z.arten}</td><td className="num">{eur(z.betrag)}</td></tr>))}</tbody></table>
        </>}
      </section>
      <p className="muted small">Die Personendaten gelten für alle Objekte dieses Kontakts. Alle Wohnungen auf einmal änderst du unter <Link to={`/objekte/${objektId}/hausgeld`}>Hausgeld</Link>.</p>
      {vermieten && einheit && objekt && <MieterAnlegen einheit={einheit} objekt={objekt} onClose={() => setVermieten(false)}
        onSaved={(_v, text) => { setVermieten(false); setInfo(text); reload(); }} />}
    </>
  );
}

const ersterNaechster = () => { const d = new Date(); d.setMonth(d.getMonth() + 1, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
const txt = (n: unknown) => (n === null || n === undefined || n === '' ? '' : String(n).replace('.', ','));

/** Hausgeld dieser Wohnung ab einem Datum ändern; offene (unbezahlte) Posten ab dann werden neu gestellt */
function HausgeldAnpassen({ einheitId, objektId, aktuell, verlauf, nk, onSaved }: { einheitId: number; objektId: number; aktuell?: Row; verlauf: Row[]; nk: number; onSaved: (t: string) => void }) {
  const [gesamt, setGesamt] = useState(txt(aktuell?.betrag));
  const [rl, setRl] = useState(txt(aktuell?.davon_ruecklage));
  const [ab, setAb] = useState(ersterNaechster());
  const [fehler, setFehler] = useState('');
  useEffect(() => { setGesamt(txt(aktuell?.betrag)); setRl(txt(aktuell?.davon_ruecklage)); }, [aktuell?.id]);
  const g = betragZahl(gesamt) ?? 0, r = betragZahl(rl) ?? 0;
  const rest = Math.round((g - r - nk) * 100) / 100;
  async function speichern() {
    setFehler('');
    if (!ab) { setFehler('Bitte das Datum angeben, ab dem das Hausgeld gilt.'); return; }
    if (g <= 0) { setFehler('Bitte das monatliche Hausgeld eintragen.'); return; }
    if (r < 0 || r > g) { setFehler('Die Rücklage muss zwischen 0 und dem Hausgeld liegen.'); return; }
    const sp = await hausgeldSperre(objektId, ab); if (sp) { setFehler(sp); return; }
    const vorhanden = (await db.select('SELECT id FROM hausgeld WHERE einheit_id = $1 AND gueltig_ab = $2', [einheitId, ab]))[0];
    if (vorhanden) await db.execute('UPDATE hausgeld SET betrag = $1, davon_ruecklage = $2 WHERE id = $3', [g, r, vorhanden.id]);
    else await db.execute('INSERT INTO hausgeld (einheit_id, gueltig_ab, betrag, davon_ruecklage) VALUES ($1, $2, $3, $4)', [einheitId, ab, g, r]);
    const n = await hausgeldNeuStellen(objektId, ab.slice(0, 7));
    onSaved(`Hausgeld ${eur(g)} (davon Rücklage ${eur(r)}) gilt ab ${datum(ab)}.${n ? ` ${n} offene Posten wurden neu gestellt, bezahlte bleiben unverändert.` : ''}`);
  }
  return (
    <section className="card hausgeld-anpassen">
      <div className="card-head"><h2 className="title-ico"><Coins size={20} />Hausgeld anpassen</h2></div>
      <div className="form f3">
        <label><span>Hausgeld / Monat</span><BetragFeld value={gesamt} onChange={(e) => setGesamt(e.target.value)} /></label>
        <label><span>davon Rücklage</span><BetragFeld value={rl} onChange={(e) => setRl(e.target.value)} /></label>
        <label><span>gilt ab</span><DatumFeld value={ab} onChange={(e) => setAb(e.target.value)} /></label>
      </div>
      {g > 0 && <p className={'small ' + (rest < -0.005 ? 'neg' : 'muted')}>Aufteilung: Rücklage {eur(r)}{nk ? ` · NK Mieter ${eur(nk)}` : ''} · {nk ? 'Eigentümer' : 'Bewirtschaftung'} {eur(rest)}
        {rest < -0.005 ? ' – die NK-Vorauszahlung des Mieters ist höher als das Hausgeld ohne Rücklage.' : ''}</p>}
      {fehler && <p className="error">{fehler}</p>}
      <div className="row"><button className="primary" onClick={speichern}>Neues Hausgeld speichern</button></div>
      {verlauf.length > 0 && <HausgeldVerlauf objektId={objektId} verlauf={verlauf} onSaved={onSaved} />}
    </section>
  );
}

const folgeText = (e: HausgeldErgebnis) => [
  e.neu ? `${e.neu === 1 ? '1 offener Posten wurde' : `${e.neu} offene Posten wurden`} neu gestellt.` : '',
  e.bezahlt ? `${e.bezahlt === 1 ? '1 bereits bezahlter Posten bleibt' : `${e.bezahlt} bereits bezahlte Posten bleiben`} unverändert – bitte prüfen, ob dort eine Nachforderung oder Erstattung nötig ist.` : '',
].filter(Boolean).join(' ');

/** Liste der Hausgeld-Stände mit Bearbeiten (in der Zeile) und Löschen (mit Rückfrage) */
function HausgeldVerlauf({ objektId, verlauf, onSaved }: { objektId: number; verlauf: Row[]; onSaved: (t: string) => void }) {
  const [edit, setEdit] = useState<Row | null>(null);
  const [w, setW] = useState({ ab: '', g: '', r: '' });
  const [fehler, setFehler] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  function bearbeiten(h: Row) { setFehler(''); setEdit(h); setW({ ab: String(h.gueltig_ab).slice(0, 10), g: txt(h.betrag), r: txt(h.davon_ruecklage ?? 0) }); }
  async function speichern() {
    if (!edit) return;
    setFehler(''); setLaeuft(true);
    try {
      const g = betragZahl(w.g) ?? 0, r = betragZahl(w.r) ?? 0;
      const e = await hausgeldAendern(edit.id, objektId, { gueltig_ab: w.ab, betrag: g, davon_ruecklage: r });
      setEdit(null);
      onSaved(`Hausgeld-Stand geändert: ${eur(g)} (davon Rücklage ${eur(r)}) ab ${datum(w.ab)}. ${folgeText(e)}`.trim());
    } catch (err: any) { setFehler(String(err?.message ?? err)); } finally { setLaeuft(false); }
  }
  async function loeschen(h: Row) {
    const i = verlauf.findIndex((x) => x.id === h.id);
    const vorher = verlauf[i + 1];
    const folge = vorher ? `Ab dann gilt wieder ${eur(vorher.betrag)} (Stand vom ${datum(vorher.gueltig_ab)}).` : 'Davor gibt es keinen Stand: ab dann wird kein Hausgeld mehr gefordert.';
    if (!window.confirm(`Hausgeld-Stand ab ${datum(h.gueltig_ab)} (${eur(h.betrag)}) löschen?\n\n${folge}\nOffene Hausgeld-Posten ab ${datum(h.gueltig_ab)} werden neu gestellt, bezahlte bleiben unverändert.`)) return;
    setFehler('');
    try {
      const e = await hausgeldLoeschen(h.id, objektId);
      if (edit?.id === h.id) setEdit(null);
      onSaved(`Hausgeld-Stand ab ${datum(h.gueltig_ab)} gelöscht. ${folgeText(e)}`.trim());
    } catch (err: any) { setFehler(String(err?.message ?? err)); }
  }
  return <>
    {fehler && <p className="error">{fehler}</p>}
    <table className="list kompakt hausgeld-verlauf"><thead><tr><th>gilt ab</th><th className="num">Hausgeld</th><th className="num">davon Rücklage</th><th className="num">Aktionen</th></tr></thead>
      <tbody>{verlauf.map((h) => edit?.id === h.id ? (
        <tr key={h.id} className="hg-edit">
          <td><DatumFeld value={w.ab} onChange={(e) => setW({ ...w, ab: e.target.value })} /></td>
          <td className="num"><BetragFeld value={w.g} onChange={(e) => setW({ ...w, g: e.target.value })} /></td>
          <td className="num"><BetragFeld value={w.r} onChange={(e) => setW({ ...w, r: e.target.value })} /></td>
          <td className="num hg-aktionen">
            <button className="icon-btn" title="Änderung speichern" disabled={laeuft} onClick={speichern}><Check size={16} /></button>
            <button className="icon-btn" title="Abbrechen" onClick={() => { setEdit(null); setFehler(''); }}><X size={16} /></button></td>
        </tr>) : (
        <tr key={h.id}>
          <td>{datum(h.gueltig_ab)}</td><td className="num">{eur(h.betrag)}</td><td className="num">{eur(h.davon_ruecklage ?? 0)}</td>
          <td className="num hg-aktionen">
            <button className="icon-btn" title="Bearbeiten" onClick={() => bearbeiten(h)}><Pencil size={15} /></button>
            <button className="icon-btn" title="Löschen" onClick={() => loeschen(h)}><Trash2 size={15} /></button></td>
        </tr>))}</tbody></table>
  </>;
}
