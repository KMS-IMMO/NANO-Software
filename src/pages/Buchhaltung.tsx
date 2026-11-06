// Buchhaltung: Buchungsjournal mit manueller Buchung, Buchungsregeln, Kontenübersicht (GuV) und Berichte.
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, BookOpen, Download, FileSpreadsheet, FileText, Gavel, Paperclip, Pencil, PiggyBank, Plus, Receipt, Sparkles, Trash2, Users, User } from 'lucide-react';
import { EntityTable, datum, eur, num } from '../components/EntityTable';
import { db, insert, remove, update, type Row } from '../db';
import { personLabel } from '../db/labels';
import { OP_SQL } from '../logic/soll';
import { csv, dDatum, geld, listePdf } from '../lib/pdf';
import { oeffnen, speichern } from '../lib/dateien';
import { useObjektKontext } from '../logic/objektKontext';
import { RechnungErfassen } from '../components/RechnungErfassen';
import { BELEGE_SQL, BuchungBelege } from '../components/BuchungBelege';
import { buchungLoeschen, loeschHinweis } from '../logic/buchung';
import { gesperrt, sperrText } from '../logic/abschluss';

const heute = () => new Date().toISOString().slice(0, 10);
const zahl = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.')) || 0;
const kontoOptions = `SELECT id AS value, nummer || ' ' || name AS label, hdl, hwl FROM buchungskonten ORDER BY nummer`;

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
  const fix = useObjektKontext();
  const objekte = useObjekte();
  const [objekt, setObjekt] = useState<number | ''>(fix?.id ?? '');
  const [jahr, setJahr] = useState(new Date().getFullYear());
  const [monat, setMonat] = useState('');
  const [kontoWahl, setKontoWahl] = useState<number[]>([]);
  const [konten, setKonten] = useState<Row[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [offeneRechnungen, setOffeneRechnungen] = useState<Row[]>([]);
  const [ansicht, setAnsicht] = useState<'buchungen' | 'rechnungen'>('buchungen');
  const [edit, setEdit] = useState<Row | null>(null);
  const [modus, setModus] = useState<'rechnung' | 'buchung'>('rechnung');
  const [fehler, setFehler] = useState('');
  const [info, setInfo] = useState('');
  const [rEdit, setREdit] = useState<Row | null>(null);
  const [belegFuer, setBelegFuer] = useState<Row | null>(null);

  useEffect(() => { db.select(kontoOptions).then(setKonten); }, []);
  const load = async () => {
    const w = [`substr(b.datum, 1, 4) = '${jahr}'`];
    if (monat) w.push(`substr(b.datum, 6, 2) = '${monat}'`);
    if (objekt !== '') w.push(`b.objekt_id = ${Number(objekt)}`);
    if (kontoWahl.length) w.push(`b.buchungskonto_id IN (${kontoWahl.map(Number).join(',')})`);
    setRows(await db.select(`SELECT b.*, k.nummer, k.name AS konto, o.name AS objekt, e.nummer AS einheit, COALESCE(f.name, rf.name) AS firma, r.rechnungsnr, ${BELEGE_SQL} AS belege
      FROM buchungen b LEFT JOIN buchungskonten k ON k.id = b.buchungskonto_id LEFT JOIN objekte o ON o.id = b.objekt_id LEFT JOIN einheiten e ON e.id = b.einheit_id
      LEFT JOIN firmen f ON f.id = b.firma_id LEFT JOIN rechnungen r ON r.id = b.rechnung_id LEFT JOIN firmen rf ON rf.id = r.firma_id
      WHERE ${w.join(' AND ')} ORDER BY b.datum, b.id`));
    const wr = ['r.bezahlt_am IS NULL'];
    if (objekt !== '') wr.push(`r.objekt_id = ${Number(objekt)}`);
    if (kontoWahl.length) wr.push(`r.buchungskonto_id IN (${kontoWahl.map(Number).join(',')})`);
    setOffeneRechnungen(await db.select(`SELECT r.*, f.name AS firma, k.nummer, k.name AS konto, o.name AS objekt, e.nummer AS einheit
      FROM rechnungen r LEFT JOIN firmen f ON f.id = r.firma_id LEFT JOIN buchungskonten k ON k.id = r.buchungskonto_id LEFT JOIN objekte o ON o.id = r.objekt_id LEFT JOIN einheiten e ON e.id = r.einheit_id
      WHERE ${wr.join(' AND ')} AND NOT EXISTS (SELECT 1 FROM buchungen b WHERE b.rechnung_id = r.id) ORDER BY r.datum, r.id`));
  };
  useEffect(() => { load(); }, [objekt, jahr, monat, kontoWahl.join(',')]);

  const soll = rows.reduce((a, r) => a + (r.betrag < 0 ? -r.betrag : 0), 0), haben = rows.reduce((a, r) => a + (r.betrag > 0 ? r.betrag : 0), 0);
  const kontoText = kontoWahl.length ? konten.filter((k) => kontoWahl.includes(k.value)).map((k) => String(k.label).split(' ')[0]).join(', ') : '';
  const bez = [objekte.find((o) => o.id === objekt)?.name ?? 'Alle Liegenschaften', monat ? `${monat}/${jahr}` : String(jahr), kontoText && `Konten ${kontoText}`].filter(Boolean).join(' · ');

  async function speichernBuchung() {
    if (!edit) return;
    setFehler('');
    if (!edit.datum || !edit.objekt_id || !edit.buchungskonto_id || !edit.betrag) { setFehler('Bitte Datum, Liegenschaft, Konto und Betrag ausfüllen.'); return; }
    // Abgeschlossenes Jahr: weder das neue noch (beim Bearbeiten) das bisherige Datum darf darin liegen
    const sp = (await gesperrt(Number(edit.objekt_id), edit.datum)) ?? (edit.id ? await gesperrt(Number(edit.alt_objekt ?? edit.objekt_id), edit.alt_datum) : null);
    if (sp) { setFehler(sperrText(sp)); return; }
    const vz = edit.richtung === 'Einnahme' ? 1 : -1;
    const gesamt = Math.abs(zahl(String(edit.betrag)));
    // Firma: gewählter Kontakt oder neuer Name wird als Firmenkontakt angelegt
    let firma_id: number | null = null;
    const fname = String(edit.firma ?? '').trim();
    if (fname) {
      const da = (await db.select('SELECT id FROM firmen WHERE lower(name) = lower($1)', [fname]))[0];
      firma_id = da ? da.id : await insert('firmen', { name: fname });
    }
    const basis = { datum: edit.datum, objekt_id: Number(edit.objekt_id), buchungskonto_id: Number(edit.buchungskonto_id), text: edit.text || null, firma_id };
    // § 35a-Anteil nur bei Konten mit HDL/HWL und nur für Ausgaben
    const k35 = konten.find((k) => Number(k.value) === Number(edit.buchungskonto_id));
    const a35 = k35 && (k35.hdl || k35.hwl) && vz < 0 && String(edit.anteil_35a ?? '').trim() !== '' ? Math.abs(zahl(String(edit.anteil_35a))) : null;
    if (a35 !== null && a35 > gesamt + 0.005) { setFehler(`Der § 35a-Anteil (${eur(a35)}) kann nicht größer sein als der Betrag (${eur(gesamt)}).`); return; }
    if (edit.id && (edit.bankumsatz_id || edit.sollstellung_id || edit.rechnung_id)) {
      const woher = edit.bankumsatz_id ? 'aus dem Bankimport' : edit.sollstellung_id ? 'zu einem offenen Posten' : 'zu einer Rechnung';
      if (Math.abs(Math.abs(Number(edit.alt_betrag)) - gesamt) > 0.005 && !window.confirm(`Diese Buchung gehört ${woher}. Wenn du den Betrag änderst, passt er nicht mehr dazu. Trotzdem speichern?`)) return;
    }
    if (edit.einheit_id === 'eigen') {
      if (edit.id) await buchungLoeschen(Number(edit.id));
      const teile = Object.entries((edit.anteile ?? {}) as Record<string, string>).filter(([, v]) => v !== '');
      const summe = Math.round(teile.reduce((a, [, v]) => a + zahl(v), 0) * 100) / 100;
      if (!teile.length) { setFehler('Bitte mindestens eine Einheit anhaken.'); return; }
      if (Math.abs(summe - gesamt) > 0.005) { setFehler(`Die Beträge der Einheiten (${eur(summe)}) ergeben nicht den Gesamtbetrag (${eur(gesamt)}).`); return; }
      for (const [eid, v] of teile) await insert('buchungen', { ...basis, einheit_id: Number(eid), betrag: vz * zahl(v),
        anteil_35a: a35 === null || !gesamt ? null : Math.round(a35 * zahl(v) / gesamt * 100) / 100 });
      setInfo(`Buchung über ${eur(gesamt)} auf ${teile.length} Einheiten verteilt.`);
    } else {
      const v = { ...basis, einheit_id: edit.einheit_id ? Number(edit.einheit_id) : null, betrag: vz * gesamt, anteil_35a: a35 };
      if (edit.id) await update('buchungen', edit.id, v); else await insert('buchungen', v);
      setInfo(edit.id ? `Buchung ${edit.id} geändert.` : `Buchung über ${eur(gesamt)} erfasst.`);
    }
    setEdit(null); load();
  }
  async function loeschen(r: Row | null = edit) {
    if (!r?.id) return;
    const sp = await gesperrt(Number(r.alt_objekt ?? r.objekt_id), r.alt_datum ?? r.datum);
    if (sp) { setEdit(null); setInfo(sperrText(sp)); return; }
    const h = loeschHinweis(r);
    if (!window.confirm(`Buchung ${r.id} über ${eur(Math.abs(Number(r.alt_betrag ?? r.betrag)))} löschen?${h ? '\n\n' + h : ''}`)) return;
    await buchungLoeschen(Number(r.id)); setEdit(null); setInfo(`Buchung ${r.id} gelöscht.`); load();
  }
  const bearbeiten = (r: Row) => { setFehler(''); setModus('buchung'); setEdit({ ...r, firma: r.firma ?? '', alt_betrag: r.betrag, alt_datum: r.datum, alt_objekt: r.objekt_id, anteil_35a: r.anteil_35a == null ? '' : String(r.anteil_35a).replace('.', ','), richtung: r.betrag > 0 ? 'Einnahme' : 'Ausgabe', betrag: String(Math.abs(r.betrag)).replace('.', ',') }); };
  async function rechnungLoeschen(r: Row) {
    const sp = await gesperrt(r.objekt_id, r.bezahlt_am ?? r.datum);
    if (sp) { setInfo(sperrText(sp)); return; }
    if (!window.confirm(`Rechnung ${r.rechnungsnr ?? ''} über ${eur(Number(r.betrag))} löschen?`)) return;
    await remove('rechnungen', r.id); setInfo(`Rechnung ${r.rechnungsnr ?? ''} gelöscht.`.replace('  ', ' ')); load();
  }
  async function rechnungSpeichern() {
    if (!rEdit) return;
    const betrag = Math.abs(zahl(String(rEdit.betrag)));
    if (!rEdit.datum || !rEdit.buchungskonto_id || !betrag) { setFehler('Bitte Datum, Konto und Betrag ausfüllen.'); return; }
    const sp = (await gesperrt(rEdit.objekt_id, rEdit.datum)) ?? (await gesperrt(rEdit.objekt_id, rEdit.alt_datum));
    if (sp) { setFehler(sperrText(sp)); return; }
    let firma_id: number | null = rEdit.firma_id ?? null;
    const fname = String(rEdit.firma ?? '').trim();
    if (fname) { const da = (await db.select('SELECT id FROM firmen WHERE lower(name) = lower($1)', [fname]))[0]; firma_id = da ? da.id : await insert('firmen', { name: fname }); }
    else firma_id = null;
    const lohn = String(rEdit.anteil_lohn ?? '').trim() === '' ? null : Math.abs(zahl(String(rEdit.anteil_lohn)));
    if (lohn !== null && lohn > betrag + 0.005) { setFehler('Der § 35a-Anteil kann nicht größer sein als der Betrag.'); return; }
    await update('rechnungen', rEdit.id, { datum: rEdit.datum, faellig: rEdit.faellig || null, rechnungsnr: rEdit.rechnungsnr || null, buchungskonto_id: Number(rEdit.buchungskonto_id), betrag, firma_id, anteil_lohn: lohn });
    setREdit(null); setFehler(''); setInfo(`Rechnung ${rEdit.rechnungsnr ?? ''} geändert.`.replace('  ', ' ')); load();
  }
  async function rechnungBezahlt(r: Row) {
    const tag = heute();
    const sp = (await gesperrt(r.objekt_id, tag)) ?? (await gesperrt(r.objekt_id, r.datum));   // offene Rechnung zählt bisher im Rechnungsjahr
    if (sp) { setInfo(sperrText(sp)); return; }
    await insert('buchungen', { datum: tag, betrag: -Number(r.betrag), buchungskonto_id: r.buchungskonto_id, objekt_id: r.objekt_id, einheit_id: r.einheit_id,
      rechnung_id: r.id, firma_id: r.firma_id, anteil_35a: r.anteil_lohn ?? null, text: `Rechnung ${r.rechnungsnr ?? ''} ${r.firma ?? ''}`.replace(/\s+/g, ' ').trim() });
    await update('rechnungen', r.id, { bezahlt_am: tag });
    setInfo(`Rechnung ${r.rechnungsnr ?? ''} als bezahlt gebucht.`); load();
  }

  const exportieren = async (art: 'csv' | 'pdf') => {
    const head = ['Bu.-Nr.', 'Datum', 'Liegenschaft', 'Konto', 'Unternehmen', 'Buchungstext', 'Soll', 'Haben'];
    if (art === 'csv') {
      await ablegen(csv(head, rows.map((r) => [r.id, datum(r.datum), r.objekt, `${r.nummer ?? ''} ${r.konto ?? ''}`.trim(), r.firma, r.text, r.betrag < 0 ? -r.betrag : null, r.betrag > 0 ? r.betrag : null])), `Buchungsjournal ${bez}.csv`);
    } else {
      await ablegen(await listePdf('Buchungsjournal', bez, head,
        rows.map((r) => [String(r.id), dDatum(r.datum), r.objekt ?? '', `${r.nummer ?? ''} ${r.konto ?? 'ohne Konto'}`, r.firma ?? '', r.text ?? '', r.betrag < 0 ? geld(-r.betrag) : '', r.betrag > 0 ? geld(r.betrag) : '']),
        [['', '', '', '', '', 'Summe', geld(soll), geld(haben)]], [6, 7]), `Buchungsjournal ${bez}.pdf`);
    }
  };

  return (
    <>
      <div className="page-head"><h1>{fix ? 'Einnahmen & Ausgaben' : 'Buchungsjournal'}</h1><p className="muted">{fix ? `Alle Buchungen und Rechnungen von ${fix.name}` : 'Alle Buchungen aus Bankimport, Rechnungen und manuellen Buchungen'}</p></div>
      <section className="card row">
        {!fix && <select style={{ width: 240 }} value={objekt} onChange={(e) => setObjekt(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Alle Liegenschaften</option>{objekte.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>}
        <label className="inline">Jahr <input type="number" style={{ width: 90 }} value={jahr} onChange={(e) => setJahr(Number(e.target.value))} /></label>
        <select style={{ width: 140 }} value={monat} onChange={(e) => setMonat(e.target.value)}>
          <option value="">Alle Monate</option>
          {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => <option key={m} value={m}>{new Date(2000, Number(m) - 1).toLocaleDateString('de-DE', { month: 'long' })}</option>)}
        </select>
        <KontenFilter konten={konten} wahl={kontoWahl} setWahl={setKontoWahl} />
        <span className="grow" />
        <button onClick={() => exportieren('csv')}><FileSpreadsheet size={16} />CSV</button>
        <button onClick={() => exportieren('pdf')}><Download size={16} />PDF</button>
        <button className="primary" onClick={() => { setFehler(''); setModus('rechnung'); setEdit({ datum: heute(), richtung: 'Ausgabe', objekt_id: objekt || '' }); }}><Plus size={16} />Buchung erfassen</button>
      </section>
      {info && <p className="info">{info}</p>}
      <div className="seg">
        <button className={ansicht === 'buchungen' ? 'on' : ''} onClick={() => setAnsicht('buchungen')}>Buchungen ({rows.length})</button>
        <button className={ansicht === 'rechnungen' ? 'on' : ''} onClick={() => setAnsicht('rechnungen')}>Offene Rechnungen ({offeneRechnungen.length})</button>
      </div>
      {ansicht === 'rechnungen' ? (
        <section className="card">
          <div className="card-head"><h2 className="title-ico"><Receipt size={22} />Offene Rechnungen</h2><span className="muted">noch nicht bezahlt: <b className="neg">{eur(offeneRechnungen.reduce((a, r) => a + Number(r.betrag), 0))}</b></span></div>
          {offeneRechnungen.length === 0 ? <p className="muted">Keine offenen Rechnungen.</p> : (
            <div className="tablewrap"><table className="list">
              <thead><tr><th>Datum</th><th>Fällig</th><th>Unternehmen</th><th>Rechnungs-Nr.</th><th>Konto</th><th>Einheit</th><th className="num">Betrag</th><th /></tr></thead>
              <tbody>{offeneRechnungen.map((r) => (
                <tr key={r.id}>
                  <td>{datum(r.datum)}</td><td className={r.faellig && r.faellig < heute() ? 'neg' : ''}>{datum(r.faellig) || '–'}</td>
                  <td>{r.firma ?? '–'}</td><td>{r.rechnungsnr ?? '–'}</td><td>{r.nummer} {r.konto}</td>
                  <td>{!fix && <span className="muted small">{r.objekt} · </span>}{r.einheit ?? 'alle'}</td>
                  <td className="num neg">{eur(Number(r.betrag))}</td>
                  <td className="actions nowrap"><button className="link" onClick={() => rechnungBezahlt(r)}>Als bezahlt buchen</button>
                    <button className="icon-btn" title="Rechnung bearbeiten" onClick={() => { setFehler(''); setREdit({ ...r, alt_datum: r.datum, betrag: String(r.betrag).replace('.', ','), anteil_lohn: r.anteil_lohn == null ? '' : String(r.anteil_lohn).replace('.', ',') }); }}><Pencil size={15} /></button>
                    <button className="icon-btn" title="Rechnung löschen" onClick={() => rechnungLoeschen(r)}><Trash2 size={15} /></button></td>
                </tr>))}</tbody>
            </table></div>)}
          <p className="muted small">Bezahlt per Bank? Dann ordnest du den Bankumsatz unter „Bank &amp; Zuordnung“ der Rechnung zu, dann wird sie automatisch gebucht.</p>
        </section>
      ) : (
      <section className="card">
        <div className="card-head"><h2 className="title-ico"><BookOpen size={22} />Buchungen ({rows.length})</h2></div>
        {rows.length === 0 ? <p className="muted">Keine Buchungen im Zeitraum.</p> : (
          <div className="tablewrap"><table className="list">
            <thead><tr><th>Bu.-Nr.</th><th>Datum</th><th>Liegenschaft</th><th>Konto</th><th>Unternehmen</th><th>Buchungstext</th><th className="num">Soll</th><th className="num">Haben</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td><td>{datum(r.datum)}</td><td>{r.objekt}<div className="muted small">{r.einheit ?? (r.betrag < 0 ? 'alle Einheiten' : '')}</div></td>
                <td>{r.nummer ? `${r.nummer} ${r.konto}` : <span className="tag">ohne Konto</span>}</td>
                <td>{r.firma ?? <span className="muted">–</span>}</td>
                <td className="small">{r.text}{r.rechnungsnr && !String(r.text ?? "").includes(r.rechnungsnr) ? <span className="muted"> · Rechnung {r.rechnungsnr}</span> : ''}{r.bankumsatz_id ? <span className="muted"> · Bank</span> : ''}</td>
                <td className="num neg">{r.betrag < 0 ? eur(-r.betrag) : '–'}</td><td className="num">{r.betrag > 0 ? eur(r.betrag) : '–'}</td>
                <td className="actions nowrap"><button className={'icon-btn beleg-btn ' + (r.belege ? 'hat' : 'leer')} title={r.belege ? `${r.belege} Beleg(e) ansehen oder anhängen` : 'Beleg anhängen'} onClick={() => setBelegFuer(r)}><Paperclip size={15} />{r.belege > 0 && <small>{r.belege}</small>}</button>
                  <button className="icon-btn" title="Buchung bearbeiten" onClick={() => bearbeiten(r)}><Pencil size={15} /></button>
                  <button className="icon-btn" title="Buchung löschen" onClick={() => loeschen(r)}><Trash2 size={15} /></button></td>
              </tr>))}
            </tbody>
            <tfoot><tr><td colSpan={6}>Summe</td><td className="num neg">{eur(soll)}</td><td className="num">{eur(haben)}</td><td /></tr></tfoot>
          </table></div>)}
        <p className="muted small">Mit dem Stift änderst du eine Buchung, mit dem Papierkorb löschst du sie. Neue Rechnungen und Buchungen legst du über „Buchung erfassen“ an.
          Gelöschte Bankbuchungen erscheinen wieder als offener Umsatz unter „Bank &amp; Zuordnung“.</p>
      </section>)}
      {edit && (
        <div className="modal-bg" onClick={() => setEdit(null)}>
          <div className={'modal' + (modus === 'rechnung' && !edit.id ? ' breit' : '')} onClick={(e) => e.stopPropagation()}>
            <div className="card-head"><h3>{edit.id ? 'Buchung bearbeiten' : 'Buchung erfassen'}</h3>
              {!edit.id && <div className="seg">
                <button className={modus === 'rechnung' ? 'on' : ''} onClick={() => setModus('rechnung')}>Rechnung / Gutschrift</button>
                <button className={modus === 'buchung' ? 'on' : ''} onClick={() => setModus('buchung')}>Einfache Buchung</button></div>}</div>
            {modus === 'rechnung' && !edit.id
              ? <RechnungErfassen objektFest={fix?.id} onSaved={(t) => { setInfo(t); setEdit(null); load(); }} />
              : <>
                <BuchungForm edit={edit} setEdit={setEdit} objekte={objekte} konten={konten} fest={!!fix} />
                {edit.id && (edit.bankumsatz_id || edit.sollstellung_id || edit.rechnung_id) && <p className="warn small">
                  Diese Buchung gehört {edit.bankumsatz_id ? 'zu einem Bankumsatz' : edit.sollstellung_id ? 'zu einem offenen Posten' : 'zu einer Rechnung'}. Konto, Text und Einheit kannst du frei ändern. Bei einem anderen Betrag fragt das Programm nach.</p>}
                {edit.id && <BuchungBelege buchung={edit} onChange={load} />}
                {fehler && <p className="error">{fehler}</p>}
                <div className="row end">
                  {edit.id && <button className="danger" onClick={() => loeschen()}>Löschen</button>}
                  <span className="grow" />
                  <button onClick={() => setEdit(null)}>Abbrechen</button>
                  <button className="primary" onClick={speichernBuchung}>Buchung speichern</button>
                </div></>}
          </div>
        </div>)}
      {belegFuer && (
        <div className="modal-bg" onClick={() => setBelegFuer(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="card-head"><h3>Buchung {belegFuer.id} · {datum(belegFuer.datum)}</h3><b className={belegFuer.betrag < 0 ? 'neg' : 'pos'}>{eur(belegFuer.betrag)}</b></div>
            <p className="muted small" style={{ margin: 0 }}>{[belegFuer.objekt, belegFuer.firma, belegFuer.text].filter(Boolean).join(' · ')}</p>
            <BuchungBelege buchung={belegFuer} onChange={load} />
            <div className="row end"><button onClick={() => setBelegFuer(null)}>Fertig</button></div>
          </div>
        </div>)}
      {rEdit && (
        <div className="modal-bg" onClick={() => setREdit(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Rechnung bearbeiten</h3>
            <div className="form">
              <label><span>Rechnungsdatum *</span><input type="date" value={rEdit.datum ?? ''} onChange={(e) => setREdit({ ...rEdit, datum: e.target.value })} /></label>
              <label><span>Fällig am</span><input type="date" value={rEdit.faellig ?? ''} onChange={(e) => setREdit({ ...rEdit, faellig: e.target.value })} /></label>
              <label><span>Unternehmen</span><input value={rEdit.firma ?? ''} onChange={(e) => setREdit({ ...rEdit, firma: e.target.value })} /></label>
              <label><span>Rechnungs-Nr.</span><input value={rEdit.rechnungsnr ?? ''} onChange={(e) => setREdit({ ...rEdit, rechnungsnr: e.target.value })} /></label>
              <label><span>Buchungskonto *</span><select value={rEdit.buchungskonto_id ?? ''} onChange={(e) => setREdit({ ...rEdit, buchungskonto_id: e.target.value })}>
                {konten.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></label>
              <label><span>Betrag € *</span><input inputMode="decimal" value={rEdit.betrag ?? ''} onChange={(e) => setREdit({ ...rEdit, betrag: e.target.value })} /></label>
              {(() => { const k = konten.find((x) => Number(x.value) === Number(rEdit.buchungskonto_id)); return k && (k.hdl || k.hwl) ? (
                <label><span>davon § 35a-Anteil (Arbeitskosten) €</span><input inputMode="decimal" placeholder="leer = ganzer Betrag" value={rEdit.anteil_lohn ?? ''} onChange={(e) => setREdit({ ...rEdit, anteil_lohn: e.target.value })} /></label>) : null; })()}
            </div>
            {fehler && <p className="error">{fehler}</p>}
            <div className="row end"><button className="danger" onClick={() => { const r = rEdit; setREdit(null); rechnungLoeschen(r); }}>Löschen</button><span className="grow" />
              <button onClick={() => setREdit(null)}>Abbrechen</button><button className="primary" onClick={rechnungSpeichern}>Speichern</button></div>
          </div>
        </div>)}
    </>
  );
}

/** Mehrere Buchungskonten als Filter wählen */
function KontenFilter({ konten, wahl, setWahl }: { konten: Row[]; wahl: number[]; setWahl: (w: number[]) => void }) {
  const [offen, setOffen] = useState(false);
  const [suche, setSuche] = useState('');
  const liste = konten.filter((k) => !suche || String(k.label).toLowerCase().includes(suche.toLowerCase()));
  const text = !wahl.length ? 'Alle Konten' : wahl.length === 1 ? konten.find((k) => k.value === wahl[0])?.label : `${wahl.length} Konten gewählt`;
  return (
    <div className="kfilter">
      <button className="kfilter-btn" onClick={() => setOffen(!offen)}>{text}<span className="muted">▾</span></button>
      {offen && <>
        <div className="kfilter-bg" onClick={() => setOffen(false)} />
        <div className="kfilter-pop">
          <input autoFocus placeholder="Konto suchen …" value={suche} onChange={(e) => setSuche(e.target.value)} />
          <div className="kfilter-liste">{liste.map((k) => (
            <label key={k.value} className="check"><input type="checkbox" checked={wahl.includes(k.value)} onChange={() => setWahl(wahl.includes(k.value) ? wahl.filter((x) => x !== k.value) : [...wahl, k.value])} />{k.label}</label>))}</div>
          <div className="row"><button className="link" onClick={() => setWahl([])}>Alle Konten</button><span className="grow" /><button onClick={() => setOffen(false)}>Fertig</button></div>
        </div></>}
    </div>
  );
}

function BuchungForm({ edit, setEdit, objekte, konten, fest }: { edit: Row; setEdit: (r: Row) => void; objekte: Row[]; konten: Row[]; fest?: boolean }) {
  const [einheiten, setEinheiten] = useState<Row[]>([]);
  const [firmen, setFirmen] = useState<Row[]>([]);
  useEffect(() => { db.select('SELECT id, name FROM firmen ORDER BY name').then(setFirmen); }, []);
  useEffect(() => { if (edit.objekt_id) db.select('SELECT id, nummer FROM einheiten WHERE objekt_id = $1 ORDER BY nummer', [Number(edit.objekt_id)]).then(setEinheiten); }, [edit.objekt_id]);
  const set = (k: string, v: any) => setEdit({ ...edit, [k]: v });
  const anteile: Record<string, string> = edit.anteile ?? {};
  const gesamt = Math.abs(zahl(String(edit.betrag ?? '')));
  const gewaehlt = Object.keys(anteile).filter((k) => anteile[k] !== '');
  const verteilen = (ids: string[]) => {
    if (!ids.length) return {};
    const teil = Math.floor((gesamt / ids.length) * 100) / 100, rest = Math.round((gesamt - teil * ids.length) * 100) / 100;
    return Object.fromEntries(ids.map((id, i) => [id, gesamt ? String(i === 0 ? Math.round((teil + rest) * 100) / 100 : teil).replace('.', ',') : '']));
  };
  const umschalten = (id: string) => set('anteile', verteilen(gewaehlt.includes(id) ? gewaehlt.filter((x) => x !== id) : [...gewaehlt, id]));
  const summe = Math.round(gewaehlt.reduce((a, k) => a + zahl(anteile[k]), 0) * 100) / 100;
  return (
    <div className="form">
      <label><span>Datum *</span><input type="date" value={edit.datum ?? ''} onChange={(e) => set('datum', e.target.value)} /></label>
      <label><span>Art *</span><select value={edit.richtung} onChange={(e) => set('richtung', e.target.value)}><option>Ausgabe</option><option>Einnahme</option></select></label>
      {!fest && <label><span>Liegenschaft *</span><select value={edit.objekt_id ?? ''} onChange={(e) => setEdit({ ...edit, objekt_id: e.target.value, einheit_id: '', anteile: {} })}>
        <option value="">– bitte wählen –</option>{objekte.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
      <label><span>Einheit</span><select value={edit.einheit_id ?? ''} onChange={(e) => setEdit({ ...edit, einheit_id: e.target.value, anteile: {} })}>
        <option value="">{edit.richtung === 'Einnahme' ? 'Gesamtes Objekt' : 'Alle Einheiten (Umlage nach Schlüssel)'}</option>
        {!edit.id && einheiten.length > 1 && <option value="eigen">Benutzerdefiniert (mehrere Einheiten) …</option>}
        {einheiten.map((x) => <option key={x.id} value={x.id}>{x.nummer}</option>)}</select></label>
      <label className="wide"><span>Konto *</span><select value={edit.buchungskonto_id ?? ''} onChange={(e) => set('buchungskonto_id', e.target.value)}>
        <option value="">– bitte wählen –</option>{konten.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></label>
      <label><span>Betrag € *</span><input inputMode="decimal" value={edit.betrag ?? ''} onChange={(e) => setEdit({ ...edit, betrag: e.target.value, ...(edit.einheit_id === 'eigen' && gewaehlt.length ? { anteile: {} } : {}) })} /></label>
      {(() => { const k = konten.find((x) => Number(x.value) === Number(edit.buchungskonto_id)); return k && (k.hdl || k.hwl) && edit.richtung !== 'Einnahme' ? (
        <label className="wide hint-35a"><span>davon § 35a-Anteil (Arbeitskosten) € · {k.hdl ? 'haushaltsnahe Dienstleistung' : 'Handwerkerleistung'}</span>
          <input inputMode="decimal" placeholder="leer = ganzer Betrag" value={edit.anteil_35a ?? ''} onChange={(e) => set('anteil_35a', e.target.value)} />
          <small className="muted">Dieser Betrag erscheint in der Abrechnung als § 35a-Anteil. Ohne Eintrag zählt der ganze Betrag.</small></label>) : null; })()}
      <label><span>Unternehmen</span><input list="buchung-firmen" value={edit.firma ?? ''} placeholder="z. B. Stadtwerke, Handwerker" onChange={(e) => set('firma', e.target.value)} /></label>
      <datalist id="buchung-firmen">{firmen.map((f) => <option key={f.id} value={f.name} />)}</datalist>
      <label className="wide"><span>Buchungstext</span><input value={edit.text ?? ''} onChange={(e) => set('text', e.target.value)} /></label>
      {edit.einheit_id === 'eigen' && (
        <div className="wide rerf-einheiten">
          {einheiten.map((x) => {
            const an = gewaehlt.includes(String(x.id));
            return (
              <div key={x.id} className="row">
                <label className="check grow"><input type="checkbox" checked={an} onChange={() => umschalten(String(x.id))} />{x.nummer}</label>
                {an && <input className="cell" inputMode="decimal" value={anteile[x.id]} onChange={(e) => set('anteile', { ...anteile, [x.id]: e.target.value })} />}
              </div>);
          })}
          <p className={'small ' + (gewaehlt.length && Math.abs(summe - gesamt) > 0.005 ? 'warn' : 'muted')}>Summe {eur(summe)} von {eur(gesamt)}. Beim Anhaken wird gleichmäßig aufgeteilt, danach kannst du die Beträge ändern.</p>
        </div>)}
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

/* =================== Jahresübersicht mit Statistik und Prognose =================== */

const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

function Jahresuebersicht({ objektId }: { objektId: number }) {
  const [jahr, setJahr] = useState(new Date().getFullYear());
  const [d, setD] = useState<{ ist: { e: number; a: number }[]; vj: { e: number; a: number }[]; sollRest: number[]; top: Row[] } | null>(null);
  useEffect(() => {
    (async () => {
      const monate = async (j: number) => {
        const r = await db.select(`SELECT CAST(substr(datum, 6, 2) AS INTEGER) AS m, SUM(CASE WHEN betrag > 0 THEN betrag ELSE 0 END) AS e, SUM(CASE WHEN betrag < 0 THEN -betrag ELSE 0 END) AS a
          FROM buchungen WHERE objekt_id = $1 AND substr(datum, 1, 4) = $2 GROUP BY m`, [objektId, String(j)]);
        return Array.from({ length: 12 }, (_, i) => { const x = r.find((y) => Number(y.m) === i + 1); return { e: Number(x?.e) || 0, a: Number(x?.a) || 0 }; });
      };
      const soll = await db.select(`SELECT CAST(substr(s.monat, 6, 2) AS INTEGER) AS m, SUM(s.betrag) AS b FROM sollstellungen s JOIN einheiten e ON e.id = s.einheit_id
        WHERE e.objekt_id = $1 AND substr(s.monat, 1, 4) = $2 GROUP BY m`, [objektId, String(jahr)]);
      const top = await db.select(`SELECT k.nummer, k.name, -SUM(b.betrag) AS summe FROM buchungen b JOIN buchungskonten k ON k.id = b.buchungskonto_id
        WHERE b.objekt_id = $1 AND substr(b.datum, 1, 4) = $2 AND b.betrag < 0 GROUP BY k.id ORDER BY summe DESC LIMIT 5`, [objektId, String(jahr)]);
      setD({ ist: await monate(jahr), vj: await monate(jahr - 1), sollRest: Array.from({ length: 12 }, (_, i) => Number(soll.find((y) => Number(y.m) === i + 1)?.b) || 0), top });
    })();
  }, [objektId, jahr]);
  if (!d) return null;

  const jetzt = new Date();
  // Abgeschlossene Monate: im laufenden Jahr bis zum aktuellen Monat, frühere Jahre ganz, spätere gar nicht
  const bisMonat = jahr < jetzt.getFullYear() ? 12 : jahr > jetzt.getFullYear() ? 0 : jetzt.getMonth() + 1;
  const sum = (x: { e: number; a: number }[], k: 'e' | 'a', n = 12) => x.slice(0, n).reduce((s, v) => s + v[k], 0);
  const istE = sum(d.ist, 'e'), istA = sum(d.ist, 'a'), vjE = sum(d.vj, 'e'), vjA = sum(d.vj, 'a');
  const vergangen = Math.max(1, bisMonat);
  const schnittA = sum(d.ist, 'a', bisMonat) / vergangen, schnittE = sum(d.ist, 'e', bisMonat) / vergangen;
  // Prognose der Restmonate: Einnahmen aus den Sollstellungen (sonst Durchschnitt), Ausgaben aus dem bisherigen Durchschnitt
  const prog = d.ist.map((_v, i) => i < bisMonat ? null : { e: d.sollRest[i] || schnittE, a: schnittA });
  const progE = istE + prog.reduce((s, v) => s + (v?.e ?? 0), 0), progA = istA + prog.reduce((s, v) => s + (v?.a ?? 0), 0);
  const delta = (a: number, b: number) => b ? `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)} % zum Vorjahr` : 'kein Vorjahr';

  const max = Math.max(1, ...d.ist.map((v, i) => Math.max(v.e, v.a, prog[i]?.e ?? 0, prog[i]?.a ?? 0)));
  const W = 920, H = 230, pad = 34, gw = (W - pad) / 12, bw = gw * 0.32;
  const y = (v: number) => H - 22 - (v / max) * (H - 40);
  const stufen = [0, 0.5, 1].map((f) => f * max);
  return (
    <section className="card">
      <div className="card-head"><h2 className="title-ico"><BarChart3 size={22} />Jahresübersicht {jahr}</h2>
        <div className="row"><button className="icon-btn" onClick={() => setJahr(jahr - 1)}>‹</button><b>{jahr}</b><button className="icon-btn" onClick={() => setJahr(jahr + 1)}>›</button></div></div>
      <div className="kpis">
        <div className="kpi"><span>Einnahmen {jahr}</span><b>{eur(istE)}</b><small>{delta(istE, vjE)}</small></div>
        <div className="kpi"><span>Ausgaben {jahr}</span><b className="neg">{eur(istA)}</b><small>{delta(istA, vjA)}</small></div>
        <div className="kpi"><span>Ergebnis {jahr}</span><b className={istE - istA < 0 ? 'neg' : ''}>{eur(istE - istA)}</b><small>Vorjahr {eur(vjE - vjA)}</small></div>
        {bisMonat < 12 && <div className="kpi prognose"><span>Prognose Jahresende</span><b className={progE - progA < 0 ? 'neg' : ''}>{eur(progE - progA)}</b><small>Einnahmen {eur(progE)} · Ausgaben {eur(progA)}</small></div>}
      </div>
      <svg className="jahr-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Einnahmen und Ausgaben je Monat ${jahr}`}>
        {stufen.map((v) => <g key={v}><line x1={pad} x2={W} y1={y(v)} y2={y(v)} className="gitter" /><text x={pad - 6} y={y(v) + 4} textAnchor="end" className="achse">{v >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v)}</text></g>)}
        {d.ist.map((v, i) => {
          const x = pad + i * gw + gw * 0.16, p = prog[i];
          const e = p ? p.e : v.e, a = p ? p.a : v.a;
          return (
            <g key={i}>
              <rect x={x} y={y(e)} width={bw} height={Math.max(0, H - 22 - y(e))} rx={3} className={'bar-e' + (p ? ' prog' : '')}><title>{`${MON[i]} ${jahr}: Einnahmen ${eur(e)}${p ? ' (Prognose)' : ''}`}</title></rect>
              <rect x={x + bw + 2} y={y(a)} width={bw} height={Math.max(0, H - 22 - y(a))} rx={3} className={'bar-a' + (p ? ' prog' : '')}><title>{`${MON[i]} ${jahr}: Ausgaben ${eur(a)}${p ? ' (Prognose)' : ''}`}</title></rect>
              <text x={x + bw} y={H - 6} textAnchor="middle" className="achse">{MON[i]}</text>
            </g>);
        })}
      </svg>
      <div className="row small muted" style={{ gap: 16 }}>
        <span><i className="leg bar-e" />Einnahmen</span><span><i className="leg bar-a" />Ausgaben</span>{bisMonat < 12 && <span><i className="leg prog-leg" />Prognose (Einnahmen aus Sollstellungen, Ausgaben aus dem bisherigen Monatsschnitt)</span>}
      </div>
      {d.top.length > 0 && <>
        <h3 style={{ margin: '18px 0 6px' }}>Größte Kostenarten {jahr}</h3>
        <table className="list"><tbody>{d.top.map((t) => (
          <tr key={t.nummer}><td style={{ width: 70 }}>{t.nummer}</td><td>{t.name}</td>
            <td style={{ width: '35%' }}><div className="bar"><div className="neg-bar" style={{ width: `${Math.round((t.summe / d.top[0].summe) * 100)}%` }} /></div></td>
            <td className="num neg">{eur(t.summe)}</td><td className="num muted small" style={{ width: 70 }}>{istA ? Math.round((t.summe / istA) * 100) : 0} %</td></tr>))}</tbody></table>
      </>}
    </section>
  );
}

/* =================== Kontenübersicht / GuV =================== */

export function AuswertungPage() {
  const fix = useObjektKontext();
  const objekte = useObjekte();
  const [objekt, setObjekt] = useState<number | ''>(fix?.id ?? '');
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
      <div className="page-head"><h1>Auswertung (GuV)</h1><p className="muted">Jahresübersicht mit Statistik und Prognose, darunter Erträge und Aufwendungen je Konto im gewählten Zeitraum</p></div>
      <section className="card row">
        {!fix && <select style={{ width: 260 }} value={objekt} onChange={(e) => setObjekt(Number(e.target.value))}>{objekte.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
        <label className="inline">von <input type="date" value={von} onChange={(e) => setVon(e.target.value)} /></label>
        <label className="inline">bis <input type="date" value={bis} onChange={(e) => setBis(e.target.value)} /></label>
      </section>
      {objekt !== '' && <Jahresuebersicht objektId={Number(objekt)} />}
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
