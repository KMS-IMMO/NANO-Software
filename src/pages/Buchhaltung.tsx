// Buchhaltung: Buchungsjournal mit manueller Buchung, Buchungsregeln, Kontenübersicht (GuV) und Berichte.
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, BookOpen, Download, FileSpreadsheet, FileText, Gavel, PiggyBank, Plus, Receipt, Sparkles, Users, User } from 'lucide-react';
import { EntityTable, datum, eur, num } from '../components/EntityTable';
import { db, insert, remove, update, type Row } from '../db';
import { personLabel } from '../db/labels';
import { OP_SQL } from '../logic/soll';
import { csv, dDatum, geld, listePdf } from '../lib/pdf';
import { oeffnen, speichern } from '../lib/dateien';

const heute = () => new Date().toISOString().slice(0, 10);
const zahl = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.')) || 0;
const kontoOptions = `SELECT id AS value, nummer || ' ' || name AS label FROM buchungskonten ORDER BY nummer`;

function useObjekte() {
  const [objekte, setObjekte] = useState<Row[]>([]);
  useEffect(() => { db.select('SELECT id, name, verwaltungsart FROM objekte ORDER BY name').then(setObjekte); }, []);
  return objekte;
}

async function ablegen(bytes: Uint8Array, datei: string) {
  const pfad = await speichern(bytes, datei, { bezug: 'Objekt', bezugId: 0, ordner: ['Berichte'] });
  oeffnen(pfad);
  return pfad;
}

/* =================== Buchungsjournal =================== */

export function JournalPage() {
  const objekte = useObjekte();
  const [objekt, setObjekt] = useState<number | ''>('');
  const [jahr, setJahr] = useState(new Date().getFullYear());
  const [monat, setMonat] = useState('');
  const [konto, setKonto] = useState<number | ''>('');
  const [konten, setKonten] = useState<Row[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [fehler, setFehler] = useState('');

  useEffect(() => { db.select(kontoOptions).then(setKonten); }, []);
  const load = async () => {
    const w = [`substr(b.datum, 1, 4) = '${jahr}'`];
    if (monat) w.push(`substr(b.datum, 6, 2) = '${monat}'`);
    if (objekt !== '') w.push(`b.objekt_id = ${Number(objekt)}`);
    if (konto !== '') w.push(`b.buchungskonto_id = ${Number(konto)}`);
    setRows(await db.select(`SELECT b.*, k.nummer, k.name AS konto, o.name AS objekt, e.nummer AS einheit
      FROM buchungen b LEFT JOIN buchungskonten k ON k.id = b.buchungskonto_id LEFT JOIN objekte o ON o.id = b.objekt_id LEFT JOIN einheiten e ON e.id = b.einheit_id
      WHERE ${w.join(' AND ')} ORDER BY b.datum, b.id`));
  };
  useEffect(() => { load(); }, [objekt, jahr, monat, konto]);

  const soll = rows.reduce((a, r) => a + (r.betrag < 0 ? -r.betrag : 0), 0), haben = rows.reduce((a, r) => a + (r.betrag > 0 ? r.betrag : 0), 0);
  const bez = [objekte.find((o) => o.id === objekt)?.name ?? 'Alle Liegenschaften', monat ? `${monat}/${jahr}` : String(jahr)].join(' · ');

  async function speichernBuchung() {
    if (!edit) return;
    setFehler('');
    if (!edit.datum || !edit.objekt_id || !edit.buchungskonto_id || !edit.betrag) { setFehler('Bitte Datum, Liegenschaft, Konto und Betrag ausfüllen.'); return; }
    const betrag = Math.abs(zahl(String(edit.betrag))) * (edit.richtung === 'Einnahme' ? 1 : -1);
    const v = { datum: edit.datum, objekt_id: Number(edit.objekt_id), buchungskonto_id: Number(edit.buchungskonto_id), einheit_id: edit.einheit_id ? Number(edit.einheit_id) : null, betrag, text: edit.text || null };
    if (edit.id) await update('buchungen', edit.id, v); else await insert('buchungen', v);
    setEdit(null); load();
  }
  async function loeschen() {
    if (!edit?.id || !window.confirm('Buchung löschen?')) return;
    await remove('buchungen', edit.id); setEdit(null); load();
  }

  const exportieren = async (art: 'csv' | 'pdf') => {
    const head = ['Bu.-Nr.', 'Datum', 'Liegenschaft', 'Konto', 'Buchungstext', 'Soll', 'Haben'];
    if (art === 'csv') {
      await ablegen(csv(head, rows.map((r) => [r.id, datum(r.datum), r.objekt, `${r.nummer ?? ''} ${r.konto ?? ''}`.trim(), r.text, r.betrag < 0 ? -r.betrag : null, r.betrag > 0 ? r.betrag : null])), `Buchungsjournal ${bez}.csv`);
    } else {
      await ablegen(await listePdf('Buchungsjournal', bez, head,
        rows.map((r) => [String(r.id), dDatum(r.datum), r.objekt ?? '', `${r.nummer ?? ''} ${r.konto ?? 'ohne Konto'}`, r.text ?? '', r.betrag < 0 ? geld(-r.betrag) : '', r.betrag > 0 ? geld(r.betrag) : '']),
        [['', '', '', '', 'Summe', geld(soll), geld(haben)]], [5, 6]), `Buchungsjournal ${bez}.pdf`);
    }
  };

  return (
    <>
      <div className="page-head"><h1>Buchungsjournal</h1><p className="muted">Alle Buchungen aus Bankimport, Rechnungen und manuellen Buchungen</p></div>
      <section className="card row">
        <select style={{ width: 240 }} value={objekt} onChange={(e) => setObjekt(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Alle Liegenschaften</option>{objekte.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <label className="inline">Jahr <input type="number" style={{ width: 90 }} value={jahr} onChange={(e) => setJahr(Number(e.target.value))} /></label>
        <select style={{ width: 140 }} value={monat} onChange={(e) => setMonat(e.target.value)}>
          <option value="">Alle Monate</option>
          {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => <option key={m} value={m}>{new Date(2000, Number(m) - 1).toLocaleDateString('de-DE', { month: 'long' })}</option>)}
        </select>
        <select style={{ width: 260 }} value={konto} onChange={(e) => setKonto(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Alle Konten</option>{konten.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        <span className="grow" />
        <button onClick={() => exportieren('csv')}><FileSpreadsheet size={16} />CSV</button>
        <button onClick={() => exportieren('pdf')}><Download size={16} />PDF</button>
        <button className="primary" onClick={() => setEdit({ datum: heute(), richtung: 'Ausgabe', objekt_id: objekt || '' })}><Plus size={16} />Buchung erfassen</button>
      </section>
      <section className="card">
        <div className="card-head"><h2 className="title-ico"><BookOpen size={22} />Buchungen ({rows.length})</h2></div>
        {rows.length === 0 ? <p className="muted">Keine Buchungen im Zeitraum.</p> : (
          <div className="tablewrap"><table className="list">
            <thead><tr><th>Bu.-Nr.</th><th>Datum</th><th>Liegenschaft</th><th>Konto</th><th>Buchungstext</th><th className="num">Soll</th><th className="num">Haben</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td><td>{datum(r.datum)}</td><td>{r.objekt}<div className="muted small">{r.einheit ?? (r.betrag < 0 ? 'alle Einheiten' : '')}</div></td>
                <td>{r.nummer ? `${r.nummer} ${r.konto}` : <span className="tag">ohne Konto</span>}</td>
                <td className="small">{r.text}{r.bankumsatz_id ? <span className="muted"> · Bank</span> : ''}</td>
                <td className="num neg">{r.betrag < 0 ? eur(-r.betrag) : '–'}</td><td className="num">{r.betrag > 0 ? eur(r.betrag) : '–'}</td>
                <td className="actions">{!r.bankumsatz_id && !r.sollstellung_id && !r.rechnung_id &&
                  <button className="link" onClick={() => setEdit({ ...r, richtung: r.betrag > 0 ? 'Einnahme' : 'Ausgabe', betrag: String(Math.abs(r.betrag)).replace('.', ',') })}>Bearbeiten</button>}</td>
              </tr>))}
            </tbody>
            <tfoot><tr><td colSpan={5}>Summe</td><td className="num neg">{eur(soll)}</td><td className="num">{eur(haben)}</td><td /></tr></tfoot>
          </table></div>)}
        <p className="muted small">Bankbuchungen änderst du unter „Banken &amp; Konten“ (Zuordnung lösen). Hier erfasst du Buchungen ohne Bankumsatz, z. B. Barzahlungen oder Umbuchungen.</p>
      </section>
      {edit && (
        <div className="modal-bg" onClick={() => setEdit(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{edit.id ? 'Buchung bearbeiten' : 'Buchung erfassen'}</h3>
            <BuchungForm edit={edit} setEdit={setEdit} objekte={objekte} konten={konten} />
            {fehler && <p className="error">{fehler}</p>}
            <div className="row end">
              {edit.id && <button className="danger" onClick={loeschen}>Löschen</button>}
              <span className="grow" />
              <button onClick={() => setEdit(null)}>Abbrechen</button>
              <button className="primary" onClick={speichernBuchung}>Buchung speichern</button>
            </div>
          </div>
        </div>)}
    </>
  );
}

function BuchungForm({ edit, setEdit, objekte, konten }: { edit: Row; setEdit: (r: Row) => void; objekte: Row[]; konten: Row[] }) {
  const [einheiten, setEinheiten] = useState<Row[]>([]);
  useEffect(() => { if (edit.objekt_id) db.select('SELECT id, nummer FROM einheiten WHERE objekt_id = $1 ORDER BY nummer', [Number(edit.objekt_id)]).then(setEinheiten); }, [edit.objekt_id]);
  const set = (k: string, v: any) => setEdit({ ...edit, [k]: v });
  return (
    <div className="form">
      <label><span>Datum *</span><input type="date" value={edit.datum ?? ''} onChange={(e) => set('datum', e.target.value)} /></label>
      <label><span>Art *</span><select value={edit.richtung} onChange={(e) => set('richtung', e.target.value)}><option>Ausgabe</option><option>Einnahme</option></select></label>
      <label><span>Liegenschaft *</span><select value={edit.objekt_id ?? ''} onChange={(e) => setEdit({ ...edit, objekt_id: e.target.value, einheit_id: '' })}>
        <option value="">– bitte wählen –</option>{objekte.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      <label><span>Einheit</span><select value={edit.einheit_id ?? ''} onChange={(e) => set('einheit_id', e.target.value)}>
        <option value="">{edit.richtung === 'Einnahme' ? 'Gesamtes Objekt' : 'Alle Einheiten (Umlage nach Schlüssel)'}</option>{einheiten.map((x) => <option key={x.id} value={x.id}>{x.nummer}</option>)}</select></label>
      <label className="wide"><span>Konto *</span><select value={edit.buchungskonto_id ?? ''} onChange={(e) => set('buchungskonto_id', e.target.value)}>
        <option value="">– bitte wählen –</option>{konten.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></label>
      <label><span>Betrag € *</span><input inputMode="decimal" value={edit.betrag ?? ''} onChange={(e) => set('betrag', e.target.value)} /></label>
      <label><span>Buchungstext</span><input value={edit.text ?? ''} onChange={(e) => set('text', e.target.value)} /></label>
    </div>
  );
}

/* =================== Buchungsregeln =================== */

export function RegelnPage() {
  return (
    <>
      <div className="page-head"><h1>Buchungsregeln</h1>
        <p className="muted">Automatische Zuordnung: Steht der Text im Empfänger oder Verwendungszweck, wird der Bankumsatz auf das Konto gebucht. Mieter, Eigentümer und Rechnungen werden vorher erkannt.</p></div>
      <EntityTable
        title="Regeln"
        icon={<Sparkles size={22} />}
        newLabel="Regel hinzufügen"
        table="buchungsregeln"
        fields={[
          { key: 'prioritaet', label: 'Priorität', type: 'number', format: (v) => num(v, 0), required: true },
          { key: 'muster', label: 'Wenn Text enthält …', required: true, format: (v) => <b>{v}</b> },
          { key: 'richtung', label: 'Richtung', type: 'select', options: ['Ausgang', 'Eingang', 'Beide'], required: true },
          { key: 'buchungskonto_id', label: 'Buchen auf Konto', type: 'select', optionsSql: kontoOptions, required: true, wide: true },
          { key: 'objekt_id', label: 'Nur für Liegenschaft', type: 'select', optionsSql: 'SELECT id AS value, name AS label FROM objekte ORDER BY name', format: (v, r) => v ? r.objekt_id_label : <span className="muted">alle</span> },
          { key: 'aktiv', label: 'Aktiv', type: 'checkbox', format: (v) => <span className={'pill ' + (v ? 'aktiv' : '')}>{v ? 'Aktiv' : 'Aus'}</span> },
          { key: 'notiz', label: 'Notiz', type: 'textarea', hideInTable: true },
        ]}
        listSql={`SELECT r.*, k.nummer || ' ' || k.name AS buchungskonto_id_label, o.name AS objekt_id_label FROM buchungsregeln r
          JOIN buchungskonten k ON k.id = r.buchungskonto_id LEFT JOIN objekte o ON o.id = r.objekt_id ORDER BY r.prioritaet, r.id`}
        fixed={{ aktiv: 1 }}
        emptyText="Noch keine Regeln. Beispiel: „Allianz“ → 1250 Gebäudeversicherung."
      />
    </>
  );
}

/* =================== Kontenübersicht / GuV =================== */

export function AuswertungPage() {
  const objekte = useObjekte();
  const [objekt, setObjekt] = useState<number | ''>('');
  const [von, setVon] = useState(`${new Date().getFullYear()}-01-01`);
  const [bis, setBis] = useState(heute());
  const [rows, setRows] = useState<Row[]>([]);
  const [banken, setBanken] = useState<Row[]>([]);
  useEffect(() => { if (objekte.length && objekt === '') setObjekt(objekte[0].id); }, [objekte]);
  useEffect(() => {
    if (objekt === '') return;
    db.select(`SELECT k.nummer, k.name, k.gruppe, SUM(b.betrag) AS summe FROM buchungen b LEFT JOIN buchungskonten k ON k.id = b.buchungskonto_id
      WHERE b.objekt_id = $1 AND b.datum BETWEEN $2 AND $3 GROUP BY b.buchungskonto_id ORDER BY k.nummer`, [objekt, von, bis]).then(setRows);
    db.select(`SELECT b.*, b.anfangssaldo + COALESCE((SELECT SUM(u.betrag) FROM bankumsaetze u WHERE u.bankkonto_id = b.id
      AND u.datum <= $2 AND (b.saldo_datum IS NULL OR u.datum > b.saldo_datum)), 0) AS saldo FROM bankkonten b WHERE b.objekt_id = $1`, [objekt, bis]).then(setBanken);
  }, [objekt, von, bis]);
  const ertraege = rows.filter((r) => r.summe > 0), aufwand = rows.filter((r) => r.summe < 0);
  const sE = ertraege.reduce((a, r) => a + r.summe, 0), sA = aufwand.reduce((a, r) => a - r.summe, 0);
  const zeile = (r: Row, wert: number) => <tr key={(r.nummer ?? 'x') + wert}><td>{r.nummer ?? '–'}</td><td>{r.name ?? 'ohne Konto (Überzahlung / Guthaben)'}</td><td className="num">{eur(wert)}</td></tr>;
  return (
    <>
      <div className="page-head"><h1>Kontenübersicht / Auswertung</h1><p className="muted">Erträge und Aufwendungen je Konto (Zufluss/Abfluss im Zeitraum)</p></div>
      <section className="card row">
        <select style={{ width: 260 }} value={objekt} onChange={(e) => setObjekt(Number(e.target.value))}>{objekte.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
        <label className="inline">von <input type="date" value={von} onChange={(e) => setVon(e.target.value)} /></label>
        <label className="inline">bis <input type="date" value={bis} onChange={(e) => setBis(e.target.value)} /></label>
      </section>
      <div className="kpis">
        <div className="kpi"><span>Erträge</span><b>{eur(sE)}</b></div>
        <div className="kpi"><span>Aufwendungen</span><b className="neg">{eur(sA)}</b></div>
        <div className="kpi"><span>Ergebnis (Überschuss / Fehlbetrag)</span><b className={sE - sA < 0 ? 'neg' : ''}>{eur(sE - sA)}</b></div>
        <div className="kpi"><span>Kontostände {datum(bis)}</span><b>{eur(banken.reduce((a, b) => a + Number(b.saldo), 0))}</b><small>{banken.length} Bankkonten</small></div>
      </div>
      <section className="card">
        <div className="card-head"><h2 className="title-ico"><BarChart3 size={22} />GuV {datum(von)} – {datum(bis)}</h2></div>
        <table className="list">
          <thead><tr><th>Konto</th><th>Bezeichnung</th><th className="num">Betrag</th></tr></thead>
          <tbody>
            <tr className="group"><td colSpan={3}>Erträge</td></tr>
            {ertraege.map((r) => zeile(r, r.summe))}
            <tr className="sum"><td colSpan={2}>Summe Erträge</td><td className="num">{eur(sE)}</td></tr>
            <tr className="group"><td colSpan={3}>Aufwendungen</td></tr>
            {aufwand.map((r) => zeile(r, -r.summe))}
            <tr className="sum"><td colSpan={2}>Summe Aufwendungen</td><td className="num">{eur(sA)}</td></tr>
          </tbody>
          <tfoot><tr><td colSpan={2}>Ergebnis</td><td className={'num ' + (sE - sA < 0 ? 'neg' : '')}>{eur(sE - sA)}</td></tr></tfoot>
        </table>
        {banken.length > 0 && <>
          <div className="card-head" style={{ marginTop: 18 }}><h2>Bankkonten</h2></div>
          <table className="list"><tbody>{banken.map((b) => <tr key={b.id}><td>{b.name}<div className="muted small">{b.bank} · {b.iban}</div></td><td className="num">{eur(Number(b.saldo))}</td></tr>)}</tbody></table>
        </>}
      </section>
    </>
  );
}

/* =================== Berichte =================== */

export function BerichtePage() {
  const nav = useNavigate();
  const [info, setInfo] = useState('');
  const run = (f: () => Promise<string>) => async () => { try { setInfo('Erstelle …'); setInfo('Gespeichert: ' + (await f())); } catch (e: any) { setInfo('Fehler: ' + (e?.message ?? e)); } };

  const mieterliste = async (art: 'pdf' | 'csv') => {
    const r = await db.select(`SELECT o.name AS objekt, e.nummer, ${personLabel('p')} AS mieter, p.telefon, p.email, v.beginn, v.ende, v.kaltmiete, v.nk_vorauszahlung + v.hk_vorauszahlung AS vz, v.kaution
      FROM mietvertraege v JOIN einheiten e ON e.id = v.einheit_id JOIN objekte o ON o.id = e.objekt_id JOIN personen p ON p.id = v.mieter_id
      WHERE v.ende IS NULL OR v.ende >= date('now') ORDER BY o.name, e.nummer`);
    const head = ['Liegenschaft', 'Einheit', 'Mieter', 'Telefon', 'E-Mail', 'Beginn', 'Ende', 'Kaltmiete', 'Vorauszahlungen', 'Kaution'];
    if (art === 'csv') return ablegen(csv(head, r.map((x) => [x.objekt, x.nummer, x.mieter, x.telefon, x.email, datum(x.beginn), datum(x.ende), x.kaltmiete, x.vz, x.kaution])), `Mieterliste ${heute()}.csv`);
    return ablegen(await listePdf('Mieterliste', `Stand ${dDatum(heute())}`, head, r.map((x) => [x.objekt, x.nummer, x.mieter, x.telefon ?? '', x.email ?? '', dDatum(x.beginn), x.ende ? dDatum(x.ende) : 'unbefristet', geld(x.kaltmiete), geld(x.vz), geld(x.kaution ?? 0)]),
      [['', '', `${r.length} Mietverhältnisse`, '', '', '', '', geld(r.reduce((a, x) => a + x.kaltmiete, 0)), geld(r.reduce((a, x) => a + x.vz, 0)), geld(r.reduce((a, x) => a + (x.kaution ?? 0), 0))]], [7, 8, 9]), `Mieterliste ${heute()}.pdf`);
  };
  const eigentuemerliste = async (art: 'pdf' | 'csv') => {
    const r = await db.select(`SELECT o.name AS objekt, e.nummer, e.mea, o.gesamt_mea, ${personLabel('p')} AS name, p.strasse, p.plz, p.ort, p.telefon, p.email, ei.anteil
      FROM eigentum ei JOIN einheiten e ON e.id = ei.einheit_id JOIN objekte o ON o.id = e.objekt_id JOIN personen p ON p.id = ei.person_id
      WHERE ei.bis IS NULL OR ei.bis >= date('now') ORDER BY o.name, e.nummer`);
    const head = ['Liegenschaft', 'Einheit', 'MEA', 'MEA-Anteil', 'Eigentümer', 'Anschrift', 'Telefon', 'E-Mail'];
    const anteil = (x: Row) => x.gesamt_mea ? `${num((x.mea / x.gesamt_mea) * 100)} %` : '';
    if (art === 'csv') return ablegen(csv(head, r.map((x) => [x.objekt, x.nummer, x.mea, anteil(x), x.name, [x.strasse, [x.plz, x.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '), x.telefon, x.email])), `Eigentümerliste ${heute()}.csv`);
    return ablegen(await listePdf('Eigentümerliste', `Stand ${dDatum(heute())}`, head, r.map((x) => [x.objekt, x.nummer, num(x.mea, 0), anteil(x), x.name, [x.strasse, [x.plz, x.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '), x.telefon ?? '', x.email ?? ''])), `Eigentümerliste ${heute()}.pdf`);
  };
  const opListe = async () => {
    const r = await db.select(`SELECT objekt, einheit, schuldner, art, monat, faellig, betrag, bezahlt, mahnstufe FROM (${OP_SQL}) WHERE betrag - bezahlt > 0.005 AND faellig <= date('now') ORDER BY objekt, einheit, faellig`);
    const offen = r.reduce((a, x) => a + x.betrag - x.bezahlt, 0);
    return ablegen(await listePdf('Offene Posten', `Fällig bis ${dDatum(heute())}`, ['Liegenschaft', 'Einheit', 'Schuldner', 'Posten', 'Monat', 'Fällig', 'Soll', 'Gezahlt', 'Offen', 'Mahnstufe'],
      r.map((x) => [x.objekt, x.einheit, x.schuldner, x.art, x.monat, dDatum(x.faellig), geld(x.betrag), geld(x.bezahlt), geld(x.betrag - x.bezahlt), x.mahnstufe ? String(x.mahnstufe) : '']),
      [['', '', `${r.length} Posten`, '', '', '', '', '', geld(offen), '']], [6, 7, 8]), `Offene Posten ${heute()}.pdf`);
  };
  const beschlussliste = async () => {
    const r = await db.select(`SELECT o.name AS objekt, b.* FROM beschluesse b JOIN objekte o ON o.id = b.objekt_id ORDER BY o.name, b.datum DESC`);
    return ablegen(await listePdf('Beschlusssammlung', `Stand ${dDatum(heute())}`, ['Liegenschaft', 'Nr.', 'Datum', 'Betreff', 'Art', 'Ergebnis', 'Status'],
      r.map((x) => [x.objekt, x.nummer ?? '', dDatum(x.datum), x.betreff, x.art ?? '', `${x.ergebnis}${x.zustimmung != null ? ` (${num(x.zustimmung, 0)} %)` : ''}`, x.status])), `Beschlusssammlung ${heute()}.pdf`);
  };

  const Karte = ({ icon, titel, text, children }: { icon: ReactNode; titel: string; text: string; children: ReactNode }) => (
    <section className="card bericht">{icon}<h2>{titel}</h2><p className="muted small">{text}</p><div className="row">{children}</div></section>);

  return (
    <>
      <div className="page-head"><h1>Berichte</h1><p className="muted">Listen und Auswertungen als PDF oder Excel (CSV). Dateien landen in der Ablage unter „Berichte“.</p></div>
      {info && <p className="info">{info}</p>}
      <div className="berichte">
        <Karte icon={<BarChart3 size={34} />} titel="Zahlungsübersicht" text="Hausgeld, Miete, NK je Objekt, Monat und Jahr"><button onClick={() => nav('/offene-posten')}>Öffnen</button></Karte>
        <Karte icon={<FileText size={34} />} titel="Offene Posten" text="Forderungen und Mahnstufen"><button onClick={run(opListe)}>PDF</button><button onClick={() => nav('/mahnungen')}>Mahnungen</button></Karte>
        <Karte icon={<Receipt size={34} />} titel="Betriebskosten" text="Nebenkostenabrechnung je Liegenschaft und Einheit"><button onClick={() => nav('/nebenkosten')}>Öffnen</button></Karte>
        <Karte icon={<PiggyBank size={34} />} titel="Jahresabrechnung und Rücklage" text="WEG-Gesamt- und Einzelabrechnung, Vermögensbericht"><button onClick={() => nav('/weg-abrechnung')}>Öffnen</button></Karte>
        <Karte icon={<User size={34} />} titel="Mieterliste" text="Übersicht aller laufenden Mietverhältnisse"><button onClick={run(() => mieterliste('pdf'))}>PDF</button><button onClick={run(() => mieterliste('csv'))}>Excel</button></Karte>
        <Karte icon={<Users size={34} />} titel="Eigentümerliste" text="Alle Eigentümer mit MEA und Kontakt"><button onClick={run(() => eigentuemerliste('pdf'))}>PDF</button><button onClick={run(() => eigentuemerliste('csv'))}>Excel</button></Karte>
        <Karte icon={<Gavel size={34} />} titel="Beschlussliste" text="Beschlusssammlung aller WEG"><button onClick={run(beschlussliste)}>PDF</button></Karte>
        <Karte icon={<BookOpen size={34} />} titel="Buchungsjournal / GuV" text="Buchungen und Kontenübersicht je Zeitraum"><button onClick={() => nav('/journal')}>Journal</button><button onClick={() => nav('/auswertung')}>GuV</button></Karte>
      </div>
    </>
  );
}
