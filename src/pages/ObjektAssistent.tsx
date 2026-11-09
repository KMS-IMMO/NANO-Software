// Assistent „Liegenschaft hinzufügen“: Grunddaten → Einheiten erfassen → Zusammenfassung.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Building2, Check, Layers, Maximize2, Plus, Trash2, Users } from 'lucide-react';
import { db, insert, type Row } from '../db';
import { EINHEIT_TYPEN, personOptions } from '../db/labels';
import { num } from '../components/EntityTable';

const zahl = (s: any) => Number(String(s ?? '').replace(/\./g, '').replace(',', '.')) || 0;
import { WARMWASSER } from '../db/labels';
const HEIZUNG = ['Gas-Zentralheizung', 'Öl-Zentralheizung', 'Fernwärme', 'Wärmepumpe', 'Pellets', 'Gasetagenheizung', 'Nachtspeicher', 'Sonstige'];
type Einheit = { nummer: string; typ: string; lage: string; flaeche: string; mea: string; personenzahl: string;
  vorname: string; nachname: string; telefon: string; email: string;
  hausgeld: string; ruecklage: string; mVorname: string; mNachname: string; mSeit: string; nkVz: string };
// Einheiten heißen nach Etage und Lage (z. B. „EG links“, „1. OG rechts“), nicht mehr „Top 1“.
const etage = (f: number) => (f === 0 ? 'EG' : `${f}. OG`);
const POS: Record<number, string[]> = { 1: [''], 2: ['links', 'rechts'], 3: ['links', 'Mitte', 'rechts'] };
const position = (j: number, jeEtage: number) => (POS[jeEtage] ? POS[jeEtage][j] : `Whg. ${j + 1}`);
/** Bezeichnung der n-ten Einheit (ab 0) bei `jeEtage` Einheiten pro Etage */
const nachEtage = (n: number, jeEtage: number) => {
  const f = Math.floor(n / jeEtage), j = n % jeEtage, lage = etage(f), pos = position(j, jeEtage);
  return { lage, nummer: pos ? `${lage} ${pos}` : lage };
};
/** Etage ändern: ein automatisch vergebener Name („EG links“) folgt der Etage. Steht die Lage schon in der Etage („EG links“), wird sie nicht doppelt angehängt. */
const mitEtage = (y: Einheit, l: string): Einheit => {
  const auto = !y.nummer || y.nummer === y.lage || (!!y.lage && y.nummer.startsWith(y.lage + ' '));
  if (!auto) return { ...y, lage: l };
  const rest = y.lage && y.nummer.startsWith(y.lage) ? y.nummer.slice(y.lage.length).trim() : '';
  return { ...y, lage: l, nummer: rest && !l.trim().endsWith(rest) ? `${l.trim()} ${rest}` : l.trim() };
};
const leer = (n: number, jeEtage = 2): Einheit => ({ ...nachEtage(n - 1, jeEtage), typ: 'Wohnung', flaeche: '', mea: '', personenzahl: '', vorname: '', nachname: '', telefon: '', email: '', hausgeld: '', ruecklage: '', mVorname: '', mNachname: '', mSeit: '', nkVz: '' });
const nameKey = (v: any, n: any) => `${String(v ?? '').trim().toLowerCase()}|${String(n ?? '').trim().toLowerCase()}`;

export function ObjektAssistentPage() {
  const nav = useNavigate();
  const [schritt, setSchritt] = useState(1);
  const [o, setO] = useState<Row>({ verwaltungsart: 'WEG', status: 'Aktiv' });
  const [einheiten, setEinheiten] = useState<Einheit[]>([leer(1)]);
  const [eigentuemer, setEigentuemer] = useState<Row[]>([]);
  const [fehler, setFehler] = useState('');
  const [anzahl, setAnzahl] = useState('');
  const [jeEtage, setJeEtage] = useState('2');
  useEffect(() => { db.select(personOptions('Eigentümer')).then(setEigentuemer); }, []);
  const [eigNamen, setEigNamen] = useState<string[]>([]);
  useEffect(() => { db.select(`SELECT nachname FROM personen WHERE rolle = 'Eigentümer' AND nachname IS NOT NULL`).then((r) => setEigNamen(r.map((x) => String(x.nachname)))); }, []);

  const set = (k: string, v: any) => setO({ ...o, [k]: v });
  const setE = (i: number, k: keyof Einheit, v: string) => setEinheiten(einheiten.map((e, j) => (j === i ? { ...e, [k]: v } : e)));
  const sFl = einheiten.reduce((a, e) => a + zahl(e.flaeche), 0), sMea = einheiten.reduce((a, e) => a + zahl(e.mea), 0), sP = einheiten.reduce((a, e) => a + zahl(e.personenzahl), 0);
  const weg = o.verwaltungsart === 'WEG';
  const meaSoll = zahl(o.gesamt_mea);
  const jahrJetzt = new Date().getFullYear();
  const sHg = einheiten.reduce((a, e) => a + zahl(e.hausgeld), 0), sRl = einheiten.reduce((a, e) => a + zahl(e.ruecklage), 0), sNk = einheiten.reduce((a, e) => a + zahl(e.nkVz), 0);
  const nMieter = einheiten.filter((e) => e.mNachname.trim()).length;
  const nEig = new Set(einheiten.filter((e) => e.nachname.trim()).map((e) => nameKey(e.vorname, e.nachname))).size;

  function weiter() {
    setFehler('');
    if (schritt === 1) {
      if (!o.strasse || !o.plz || !o.ort) { setFehler('Bitte Straße, PLZ und Ort ausfüllen.'); return; }
      if (!weg && o.eigentuemer_id === 'neu' && !String(o.neu_nachname ?? '').trim()) { setFehler('Bitte Nachname oder Firma des neuen Eigentümers eintragen.'); return; }
      if (!o.name) setO({ ...o, name: o.strasse });
    }
    if (schritt === 2) {
      const nr = einheiten.map((e) => e.nummer.trim());
      if (nr.some((n) => !n)) { setFehler('Jede Einheit braucht eine Bezeichnung, z. B. „EG links“.'); return; }
      if (new Set(nr).size !== nr.length) { setFehler('Die Bezeichnungen der Einheiten müssen eindeutig sein, z. B. „1. OG links“ und „1. OG rechts“.'); return; }
    }
    setSchritt(schritt + 1);
  }

  function erzeugen() {
    const n = Math.min(500, Math.max(1, Math.round(zahl(anzahl))));
    const start = einheiten.length === 1 && !einheiten[0].flaeche ? 0 : einheiten.length;
    const je = Math.min(20, Math.max(1, Math.round(zahl(jeEtage)) || 2));
    const neu = Array.from({ length: n }, (_, i) => leer(start + i + 1, je));
    setEinheiten(start ? [...einheiten, ...neu] : neu);
    setAnzahl('');
  }

  async function anlegen() {
    setFehler('');
    try {
      const id = await insert('objekte', {
        verwaltungsart: o.verwaltungsart, name: o.name || o.strasse, strasse: o.strasse, plz: o.plz, ort: o.ort, status: o.status || 'Aktiv',
        baujahr: o.baujahr ? zahl(o.baujahr) : null, gesamt_mea: meaSoll || (sMea || null), heizungsart: o.heizungsart || null, warmwasser: o.warmwasser || null, gesamt_flaeche: o.gesamt_flaeche ? zahl(o.gesamt_flaeche) : null,
        eigentuemer_id: null, notiz: o.notiz || null,
      });
      // Eigentümer des Hauses (Mietverwaltung): vorhandene Person oder direkt neu angelegt
      if (!weg && o.eigentuemer_id) {
        const eid = o.eigentuemer_id === 'neu'
          ? await insert('personen', { rolle: 'Eigentümer', vorname: (o.neu_vorname ?? '').trim() || null, nachname: String(o.neu_nachname).trim(),
              telefon: (o.neu_telefon ?? '').trim() || null, email: (o.neu_email ?? '').trim() || null })
          : Number(o.eigentuemer_id);
        await db.execute('UPDATE objekte SET eigentuemer_id = $1 WHERE id = $2', [eid, id]);
      }
      // Eigentümer je Einheit: gleicher Name = dieselbe Person (auch bereits vorhandene Eigentümer)
      const personen = new Map<string, Row>();
      if (weg) for (const p of await db.select(`SELECT id, vorname, nachname, telefon, email FROM personen WHERE rolle = 'Eigentümer'`)) personen.set(nameKey(p.vorname, p.nachname), p);
      for (const e of einheiten) {
        const eid = await insert('einheiten', { objekt_id: id, nummer: e.nummer.trim(), typ: e.typ, lage: e.lage || null, flaeche: e.flaeche ? zahl(e.flaeche) : null,
          mea: e.mea ? zahl(e.mea) : null, personenzahl: e.personenzahl ? zahl(e.personenzahl) : null });
        if (!weg || !e.nachname.trim()) continue;
        const key = nameKey(e.vorname, e.nachname);
        let p = personen.get(key);
        if (!p) {
          p = { id: await insert('personen', { rolle: 'Eigentümer', vorname: e.vorname.trim() || null, nachname: e.nachname.trim(),
            telefon: e.telefon.trim() || null, email: e.email.trim() || null }), telefon: e.telefon.trim(), email: e.email.trim() };
          personen.set(key, p);
        } else if ((!p.telefon && e.telefon.trim()) || (!p.email && e.email.trim())) {
          p.telefon = p.telefon || e.telefon.trim(); p.email = p.email || e.email.trim();
          await db.execute('UPDATE personen SET telefon = $1, email = $2 WHERE id = $3', [p.telefon || null, p.email || null, p.id]);
        }
        await insert('eigentum', { einheit_id: eid, person_id: p.id, anteil: 100 });
      }
      if (weg) for (const e of einheiten) {
        const eid = (await db.select('SELECT id FROM einheiten WHERE objekt_id = $1 AND nummer = $2', [id, e.nummer.trim()]))[0].id;
        // Hausgeld wird ohne Rücklage erfasst; gespeichert wird der Gesamtbetrag mit dem Rücklagenanteil, den die Abrechnung wieder abzieht
        if (zahl(e.hausgeld) || zahl(e.ruecklage)) await insert('hausgeld', { einheit_id: eid, gueltig_ab: `${jahrJetzt}-01-01`,
          betrag: Math.round((zahl(e.hausgeld) + zahl(e.ruecklage)) * 100) / 100, davon_ruecklage: zahl(e.ruecklage) || null });
        // Vermietete Einheit: Mieter zahlt an den Eigentümer, wir brauchen ihn für die Nebenkostenabrechnung
        if (e.mNachname.trim()) {
          const mid = await insert('personen', { rolle: 'Mieter', vorname: e.mVorname.trim() || null, nachname: e.mNachname.trim() });
          await insert('mietvertraege', { einheit_id: eid, mieter_id: mid, beginn: e.mSeit || `${jahrJetzt}-01-01`, kaltmiete: 0,
            nk_vorauszahlung: zahl(e.nkVz), hk_vorauszahlung: 0, personenzahl: e.personenzahl ? zahl(e.personenzahl) : 1, zahlung_an: 'Eigentümer' });
        }
      }
      nav(`/objekte/${id}`);
    } catch (err: any) { setFehler(String(err?.message ?? err)); }
  }

  const Schritt = ({ n, t }: { n: number; t: string }) => (
    <div className={'step' + (schritt === n ? ' on' : schritt > n ? ' done' : '')}><span>{schritt > n ? <Check size={16} /> : n}</span>{t}</div>);

  return (
    <>
      <div className="page-head">
        <h1>Liegenschaften</h1>
        <div className="crumbs"><Link to="/">Dashboard</Link> › <Link to="/objekte">Liegenschaften</Link> › <span>Liegenschaft hinzufügen</span></div>
      </div>
      <section className="card">
        <h2 className="title-ico" style={{ fontSize: 22 }}><Building2 size={28} />Liegenschaft hinzufügen</h2>
        <div className="steps"><Schritt n={1} t="Liegenschaftsdaten" /><i /><Schritt n={2} t="Einheiten erfassen" /><i /><Schritt n={3} t="Zusammenfassung" /></div>

        {schritt === 1 && (
          <>
            <div className="sec">Grunddaten der Liegenschaft</div>
            <div className="form f3">
              <label><span>Verwaltungsart *</span><select value={o.verwaltungsart} onChange={(e) => set('verwaltungsart', e.target.value)}><option value="WEG">WEG (Wohnungseigentum)</option><option value="Mietverwaltung">Mietverwaltung</option></select></label>
              <label className="span2"><span>Bezeichnung</span><input placeholder="z. B. WEG Rheinblick (sonst die Straße)" value={o.name ?? ''} onChange={(e) => set('name', e.target.value)} /></label>
              <label className="span3"><span>Straße und Hausnummer *</span><input placeholder="z. B. Musterstraße 12" value={o.strasse ?? ''} onChange={(e) => set('strasse', e.target.value)} /></label>
              <label><span>PLZ *</span><input value={o.plz ?? ''} onChange={(e) => set('plz', e.target.value)} /></label>
              <label><span>Ort *</span><input value={o.ort ?? ''} onChange={(e) => set('ort', e.target.value)} /></label>
              <label><span>Baujahr</span><input inputMode="numeric" value={o.baujahr ?? ''} onChange={(e) => set('baujahr', e.target.value)} /></label>
            </div>
            <div className="sec">Technik und Anteile</div>
            <div className="form f3">
              <label><span>Heizungsart</span><select value={o.heizungsart ?? ''} onChange={(e) => set('heizungsart', e.target.value)}><option value="">–</option>{HEIZUNG.map((h) => <option key={h}>{h}</option>)}</select></label>
              <label><span>Gesamt-MEA {weg ? '*' : ''}</span><input inputMode="decimal" placeholder="z. B. 1.000 oder 10.000" value={o.gesamt_mea ?? ''} onChange={(e) => set('gesamt_mea', e.target.value)} /></label>
              <label><span>Gesamtfläche (m²)</span><input inputMode="decimal" placeholder="optional" value={o.gesamt_flaeche ?? ''} onChange={(e) => set('gesamt_flaeche', e.target.value)} /></label>
              <label><span>Warmwasserversorgung</span><select value={o.warmwasser ?? ''} onChange={(e) => set('warmwasser', e.target.value)}><option value="">–</option>{WARMWASSER.map((h) => <option key={h}>{h}</option>)}</select></label>
              {!weg && <label><span>Eigentümer des Hauses</span><select value={o.eigentuemer_id ?? ''} onChange={(e) => set('eigentuemer_id', e.target.value)}>
                <option value="">–</option><option value="neu">+ Neuen Eigentümer anlegen …</option>{eigentuemer.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>}
            </div>
            {!weg && o.eigentuemer_id === 'neu' && <>
              <div className="sec">Neuer Eigentümer</div>
              <div className="form f4">
                <label><span>Vorname</span><input value={o.neu_vorname ?? ''} onChange={(e) => set('neu_vorname', e.target.value)} /></label>
                <label><span>Nachname / Firma *</span><input value={o.neu_nachname ?? ''} onChange={(e) => set('neu_nachname', e.target.value)} /></label>
                <label><span>Telefon</span><input value={o.neu_telefon ?? ''} onChange={(e) => set('neu_telefon', e.target.value)} /></label>
                <label><span>E-Mail</span><input type="email" value={o.neu_email ?? ''} onChange={(e) => set('neu_email', e.target.value)} /></label>
              </div>
            </>}
          </>
        )}

        {schritt === 2 && (
          <>
            <Kopf o={o} n={einheiten.length} mea={sMea} fl={sFl} p={sP} />
            <div className="card-head" style={{ marginTop: 18 }}><h2>Einheiten der Liegenschaft</h2>
              <div className="row">
                <input className="cell" placeholder="Anzahl" value={anzahl} onChange={(e) => setAnzahl(e.target.value)} />
                <label className="inline small">je Etage <input className="cell" inputMode="numeric" value={jeEtage} style={{ width: 52 }} title="Einheiten pro Etage: 2 = links/rechts, 3 = links/Mitte/rechts" onChange={(e) => setJeEtage(e.target.value)} /></label>
                <button onClick={erzeugen} disabled={!zahl(anzahl)}>Einheiten erzeugen</button>
                <button className="primary" onClick={() => setEinheiten([...einheiten, leer(einheiten.length + 1, Math.max(1, Math.round(zahl(jeEtage)) || 2))])}><Plus size={16} />Einheit hinzufügen</button>
              </div></div>
            {weg && <datalist id="eig-namen">{[...new Set(eigNamen)].map((n) => <option key={n} value={n} />)}</datalist>}
            <div className="tablewrap"><table className="list">
              <thead><tr><th>Einheit</th><th>Bezeichnung</th><th>Etage</th><th className="num">Fläche (m²)</th><th className="num">MEA</th><th className="num">Personenzahl</th>{weg && <><th>Eigentümer Vorname</th><th>Nachname / Firma</th><th>Telefon</th><th>E-Mail</th>
                <th className="num">Hausgeld ohne Rücklage € / Monat</th><th className="num">Erhaltungsrücklage € / Monat</th><th>Mieter Vorname</th><th>Mieter Nachname</th><th>Mieter seit</th><th className="num">NK-Vorauszahlung Mieter € / Monat</th></>}<th /></tr></thead>
              <tbody>{einheiten.map((e, i) => (
                <tr key={i}>
                  <td><input value={e.nummer} onChange={(x) => setE(i, 'nummer', x.target.value)} style={{ width: 110 }} /></td>
                  <td><select value={e.typ} style={{ minWidth: 130 }} onChange={(x) => setE(i, 'typ', x.target.value)}>{EINHEIT_TYPEN.map((t) => <option key={t}>{t}</option>)}</select></td>
                  <td><input value={e.lage} placeholder="EG, 1. OG, DG …" style={{ width: 100 }} onChange={(x) => setEinheiten(einheiten.map((y, j) => (j === i ? mitEtage(y, x.target.value) : y)))} /></td>
                  <td className="num"><input className="cell" inputMode="decimal" value={e.flaeche} style={{ width: 80 }} onChange={(x) => setE(i, 'flaeche', x.target.value)} /></td>
                  <td className="num"><input className="cell" inputMode="decimal" value={e.mea} style={{ width: 80 }} onChange={(x) => setE(i, 'mea', x.target.value)} /></td>
                  <td className="num"><input className="cell" inputMode="numeric" value={e.personenzahl} style={{ width: 60 }} onChange={(x) => setE(i, 'personenzahl', x.target.value)} /></td>
                  {weg && <>
                    <td><input value={e.vorname} onChange={(x) => setE(i, 'vorname', x.target.value)} style={{ width: 120 }} /></td>
                    <td><input value={e.nachname} list="eig-namen" onChange={(x) => setE(i, 'nachname', x.target.value)} style={{ width: 150 }} /></td>
                    <td><input type="tel" value={e.telefon} onChange={(x) => setE(i, 'telefon', x.target.value)} style={{ width: 140 }} /></td>
                    <td><input type="email" value={e.email} onChange={(x) => setE(i, 'email', x.target.value)} style={{ width: 190 }} /></td>
                    <td className="num"><input className="cell" inputMode="decimal" value={e.hausgeld} style={{ width: 90 }} onChange={(x) => setE(i, 'hausgeld', x.target.value)} /></td>
                    <td className="num"><input className="cell" inputMode="decimal" value={e.ruecklage} style={{ width: 90 }} onChange={(x) => setE(i, 'ruecklage', x.target.value)} /></td>
                    <td><input value={e.mVorname} placeholder="leer = nicht vermietet" onChange={(x) => setE(i, 'mVorname', x.target.value)} style={{ width: 140 }} /></td>
                    <td><input value={e.mNachname} onChange={(x) => setE(i, 'mNachname', x.target.value)} style={{ width: 140 }} /></td>
                    <td><input type="date" value={e.mSeit} disabled={!e.mNachname.trim()} onChange={(x) => setE(i, 'mSeit', x.target.value)} /></td>
                    <td className="num"><input className="cell" inputMode="decimal" value={e.nkVz} disabled={!e.mNachname.trim()} style={{ width: 90 }} onChange={(x) => setE(i, 'nkVz', x.target.value)} /></td>
                  </>}
                  <td className="actions"><button className="icon-btn" title="Entfernen" disabled={einheiten.length === 1} onClick={() => setEinheiten(einheiten.filter((_, j) => j !== i))}><Trash2 size={17} /></button></td>
                </tr>))}
              </tbody>
              <tfoot><tr><td>Summe</td><td>{einheiten.length} Einheiten</td><td>–</td><td className="num">{num(sFl)} m²</td><td className="num">{num(sMea, 0)}</td><td className="num">{num(sP, 0)}</td>{weg && <><td colSpan={4}>{nEig} Eigentümer</td><td className="num">{num(sHg)} €</td><td className="num">{num(sRl)} €</td><td colSpan={3}>{nMieter} vermietet</td><td className="num">{num(sNk)} €</td></>}<td /></tr></tfoot>
            </table></div>
            {weg && <p className="muted small" style={{ marginTop: 8 }}>Gleicher Name in mehreren Zeilen = ein Eigentümer mit mehreren Einheiten. Ist der Name schon als Eigentümer gespeichert, wird diese Person verwendet.
              Hausgeld und Erhaltungsrücklage gelten ab 01.01.{jahrJetzt}. Der Eigentümer zahlt beides zusammen; in der Hausgeldabrechnung wird die Rücklage von den Vorschüssen abgezogen. Bei vermieteten Einheiten zahlt der Mieter an den Eigentümer; die Vorauszahlung brauchen wir für seine Nebenkostenabrechnung. Mieter seit leer = 01.01.{jahrJetzt}.</p>}
            {meaSoll > 0 && Math.abs(meaSoll - sMea) > 0.001 && <p className="warn" style={{ marginTop: 12 }}>Summe MEA {num(sMea, 0)} weicht vom Gesamt-MEA {num(meaSoll, 0)} ab. Du kannst trotzdem weiter und später korrigieren.</p>}
          </>
        )}

        {schritt === 3 && (
          <>
            <Kopf o={o} n={einheiten.length} mea={sMea} fl={sFl} p={sP} />
            <div className="sec">Zusammenfassung</div>
            <table className="list"><tbody>
              <tr><td>Verwaltungsart</td><td><b>{weg ? 'WEG (Wohnungseigentum)' : 'Mietverwaltung'}</b></td></tr>
              <tr><td>Bezeichnung</td><td><b>{o.name || o.strasse}</b></td></tr>
              <tr><td>Anschrift</td><td>{o.strasse}, {o.plz} {o.ort}</td></tr>
              <tr><td>Baujahr / Heizung</td><td>{o.baujahr || '–'} / {o.heizungsart || '–'}</td></tr>
              <tr><td>Warmwasser / Gesamtfläche</td><td>{o.warmwasser || '–'} / {o.gesamt_flaeche ? `${o.gesamt_flaeche} m²` : '–'}</td></tr>
              {!weg && <tr><td>Eigentümer des Hauses</td><td>{o.eigentuemer_id === 'neu' ? <>{[o.neu_vorname, o.neu_nachname].filter(Boolean).join(' ')} <span className="muted">(wird neu angelegt)</span></> : eigentuemer.find((p) => String(p.value) === String(o.eigentuemer_id))?.label ?? '–'}</td></tr>}
              <tr><td>Einheiten</td><td>{einheiten.length} ({[...new Set(einheiten.map((e) => e.typ))].join(', ')})</td></tr>
              {weg && <tr><td>Hausgeld / vermietet</td><td>{num(sHg + sRl)} € im Monat (davon Erhaltungsrücklage {num(sRl)} €) · {nMieter} von {einheiten.length} Einheiten vermietet (NK-Vorauszahlungen {num(sNk)} € im Monat)</td></tr>}
              {weg && <tr><td>Eigentümer</td><td>{nEig} erfasst{einheiten.some((e) => !e.nachname.trim()) ? `, ${einheiten.filter((e) => !e.nachname.trim()).length} Einheiten noch ohne` : ''}</td></tr>}
              <tr><td>Fläche / MEA / Personen</td><td>{num(sFl)} m² / {num(sMea, 0)}{meaSoll ? ` von ${num(meaSoll, 0)}` : ''} / {num(sP, 0)}</td></tr>
            </tbody></table>
            <p className="muted small">Danach legst du in der Liegenschaft {weg ? 'Hausgeld' : 'Mietverträge'}, Bankkonto und Ordner an.</p>
          </>
        )}

        {fehler && <p className="error">{fehler}</p>}
        <div className="row end">
          {schritt > 1 ? <button onClick={() => setSchritt(schritt - 1)}><ArrowLeft size={16} />Zurück</button> : <span />}
          <span className="grow" />
          <button onClick={() => nav('/objekte')}>Abbrechen</button>
          {schritt < 3 ? <button className="primary" onClick={weiter}>{schritt === 2 ? 'Weiter zur Zusammenfassung' : 'Weiter'}<ArrowRight size={16} /></button>
            : <button className="primary" onClick={anlegen}><Check size={16} />Liegenschaft anlegen</button>}
        </div>
      </section>
    </>
  );
}

function Kopf({ o, n, mea, fl, p }: { o: Row; n: number; mea: number; fl: number; p: number }) {
  return (
    <div className="objhead sub">
      <div className="thumb"><Building2 size={36} /></div>
      <div><h2>{o.name || o.strasse}</h2><div className="muted">{o.plz} {o.ort}</div></div>
      <div className="stats">
        <div className="stat"><Building2 size={24} strokeWidth={1.5} /><div><b>{n}</b><span>Einheiten</span></div></div>
        <div className="stat"><Layers size={24} strokeWidth={1.5} /><div><b>{num(mea, 0)}</b><span>Gesamt-MEA</span></div></div>
        <div className="stat"><Maximize2 size={24} strokeWidth={1.5} /><div><b>{num(fl)} m²</b><span>Gesamtfläche</span></div></div>
        <div className="stat"><Users size={24} strokeWidth={1.5} /><div><b>{num(p, 0)}</b><span>Personen</span></div></div>
      </div>
    </div>
  );
}
