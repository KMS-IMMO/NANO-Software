// Abrechnungsübersicht: alle Buchungskonten des Jahres mit Gesamtbetrag. Jede Zeile lässt sich aufklappen
// und zeigt die einzelnen Rechnungen und Buchungen, aus denen sich der Betrag zusammensetzt.
// Der Verteilerschlüssel wird je Konto für das Abrechnungsjahr gewählt.
// Beträge lassen sich hier direkt ändern, löschen und neu hinzufügen (als Buchung auf das Konto der Liegenschaft).
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, Pencil, Plus, Trash2, X } from 'lucide-react';
import { db, type Row } from '../db';
import { eur } from './EntityTable';
import type { Position } from '../logic/verteilung';

const datum = (d: string) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('de-DE') : '');

/** Einzelbelege je Buchungskonto, nach derselben Regel wie die Kostenermittlung (Buchungen plus noch nicht gebuchte Rechnungen) */
async function belegeLaden(objekt: number, jahr: number): Promise<{ aus: Row[]; ein: Row[] }> {
  const von = `${jahr}-01-01`, bis = `${jahr}-12-31`;
  const buch = await db.select(`SELECT b.id, b.datum, b.betrag, b.text, b.buchungskonto_id, k.art,
      COALESCE(f.name, rf.name) AS firma, r.rechnungsnr, e.nummer AS einheit, b.bankumsatz_id, b.sollstellung_id
    FROM buchungen b JOIN buchungskonten k ON k.id = b.buchungskonto_id
    LEFT JOIN rechnungen r ON r.id = b.rechnung_id LEFT JOIN firmen f ON f.id = b.firma_id LEFT JOIN firmen rf ON rf.id = r.firma_id
    LEFT JOIN einheiten e ON e.id = b.einheit_id
    WHERE b.objekt_id = $1 AND b.datum BETWEEN $2 AND $3 ORDER BY b.datum, b.id`, [objekt, von, bis]);
  const rech = await db.select(`SELECT r.id, r.bezahlt_am, COALESCE(r.bezahlt_am, r.datum) AS datum, r.betrag, r.buchungskonto_id, r.rechnungsnr, f.name AS firma, e.nummer AS einheit, r.notiz
    FROM rechnungen r LEFT JOIN firmen f ON f.id = r.firma_id LEFT JOIN einheiten e ON e.id = r.einheit_id
    WHERE r.objekt_id = $1 AND COALESCE(r.bezahlt_am, r.datum) BETWEEN $2 AND $3
      AND NOT EXISTS (SELECT 1 FROM buchungen b WHERE b.rechnung_id = r.id) ORDER BY 2`, [objekt, von, bis]);
  const aus: Row[] = [
    ...buch.filter((b) => b.art === 'Aufwand' || b.art === 'Ertrag').map((b) => ({ ...b, betrag: -Number(b.betrag),
      quelle: b.bankumsatz_id ? 'Bank' : b.rechnungsnr ? 'Rechnung' : 'Buchung' })),
    ...rech.map((r) => ({ ...r, betrag: Number(r.betrag), text: r.notiz, quelle: 'Rechnung, Zahlung noch nicht gebucht' })),
  ].sort((a: Row, b: Row) => String(a.datum).localeCompare(String(b.datum)) || Number(a.id) - Number(b.id));
  const ein = buch.filter((b) => b.art === 'Einnahme').map((b) => ({ ...b, betrag: Number(b.betrag), quelle: b.bankumsatz_id ? 'Bank' : b.sollstellung_id ? 'Zahlung' : 'Buchung' }));
  return { aus, ein };
}

const zahl = (s: string) => Number(String(s).replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
const fmt = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type Entwurf = { key: string; datum: string; text: string; betrag: string };
const keyVon = (b: Row) => (b.quelle?.startsWith('Rechnung, Zahlung') ? 'r' : 'b') + b.id;

/** Beleg ändern oder löschen. Ausgaben stehen in der Buchhaltung negativ, Einnahmen positiv. */
async function belegSpeichern(b: Row, e: Entwurf, ausgabe: boolean) {
  const betrag = Math.round(zahl(e.betrag) * 100) / 100;
  if (keyVon(b)[0] === 'r') await db.execute(`UPDATE rechnungen SET betrag = $1, notiz = $2, ${b.bezahlt_am ? 'bezahlt_am' : 'datum'} = $3 WHERE id = $4`,
    [betrag, e.text || null, e.datum, b.id]);
  else await db.execute('UPDATE buchungen SET betrag = $1, text = $2, datum = $3 WHERE id = $4', [ausgabe ? -betrag : betrag, e.text || null, e.datum, b.id]);
}
async function belegLoeschen(b: Row) {
  if (keyVon(b)[0] === 'r') await db.execute('DELETE FROM rechnungen WHERE id = $1', [b.id]);
  else await db.execute('DELETE FROM buchungen WHERE id = $1', [b.id]);
}

function Belege({ liste, ausgabe, kontoId, objekt, jahr, onChanged }: { liste: Row[]; ausgabe: boolean; kontoId: number; objekt: number; jahr: number; onChanged?: (t: string) => void }) {
  const [e, setE] = useState<Entwurf | null>(null);
  const [fehler, setFehler] = useState('');
  const bearbeitbar = !!onChanged;
  const neuDatum = `${jahr}-12-31` < new Date().toISOString().slice(0, 10) ? `${jahr}-12-31` : new Date().toISOString().slice(0, 10);

  async function speichern(b: Row | null) {
    if (!e) return;
    const betrag = zahl(e.betrag);
    if (!Number.isFinite(betrag) || !e.betrag.trim()) { setFehler('Bitte einen gültigen Betrag eintragen, z. B. 125,50.'); return; }
    if (!e.datum || e.datum.slice(0, 4) !== String(jahr)) { setFehler(`Das Datum muss im Abrechnungsjahr ${jahr} liegen.`); return; }
    if (b?.bankumsatz_id && !window.confirm('Diese Buchung stammt aus dem Bankimport. Wenn du den Betrag änderst, passt er nicht mehr zum Kontoauszug. Trotzdem ändern?')) return;
    if (b) await belegSpeichern(b, e, ausgabe);
    else await db.execute('INSERT INTO buchungen (datum, betrag, buchungskonto_id, objekt_id, text) VALUES ($1, $2, $3, $4, $5)',
      [e.datum, Math.round((ausgabe ? -betrag : betrag) * 100) / 100, kontoId, objekt, e.text.trim() || 'Korrektur Abrechnung']);
    setE(null); setFehler('');
    onChanged?.(b ? `Betrag geändert auf ${eur(betrag)}.` : `Betrag ${eur(betrag)} hinzugefügt.`);
  }
  async function loeschen(b: Row) {
    const was = keyVon(b)[0] === 'r' ? 'Rechnung' : 'Buchung';
    const zusatz = b.bankumsatz_id ? ' Der Bankumsatz wird wieder als „nicht zugeordnet“ angezeigt.' : '';
    if (!window.confirm(`${was} über ${eur(b.betrag)} vom ${datum(b.datum)} löschen?${zusatz}`)) return;
    await belegLoeschen(b);
    onChanged?.(`${was} über ${eur(b.betrag)} gelöscht.`);
  }
  const zeile = (b: Row | null) => e && (
    <tr className="beleg-edit" key={'e' + (b ? keyVon(b) : 'neu')}>
      <td><input type="date" className="cell" value={e.datum} onChange={(x) => setE({ ...e, datum: x.target.value })} /></td>
      <td colSpan={4}><input className="cell" style={{ width: '100%', textAlign: 'left' }} placeholder="Text, z. B. Korrektur oder Rechnung Hausmeister" value={e.text} onChange={(x) => setE({ ...e, text: x.target.value })} /></td>
      <td className="num"><input className="cell" inputMode="decimal" autoFocus style={{ width: 110 }} value={e.betrag} onChange={(x) => setE({ ...e, betrag: x.target.value })}
        onKeyDown={(x) => { if (x.key === 'Enter') speichern(b); if (x.key === 'Escape') setE(null); }} /></td>
      <td className="actions nowrap"><button className="icon-btn" title="Speichern" onClick={() => speichern(b)}><Check size={16} /></button>
        <button className="icon-btn" title="Abbrechen" onClick={() => { setE(null); setFehler(''); }}><X size={16} /></button></td>
    </tr>);
  return (
    <>
      <table className="list belege">
        <thead><tr><th>Datum</th><th>Unternehmen / Text</th><th>Rechnung</th><th>Einheit</th><th>Herkunft</th><th className="num">Betrag</th>{bearbeitbar && <th />}</tr></thead>
        <tbody>{liste.map((b) => e?.key === keyVon(b) ? zeile(b) : (
          <tr key={keyVon(b)}><td>{datum(b.datum)}</td><td>{b.firma ? <b>{b.firma}</b> : null}{b.firma && b.text ? <span className="muted"> · </span> : null}{b.text}</td>
            <td>{b.rechnungsnr ?? '–'}</td><td>{b.einheit ?? 'alle'}</td><td className="muted small">{b.quelle}</td><td className="num">{eur(b.betrag)}</td>
            {bearbeitbar && <td className="actions nowrap">
              <button className="icon-btn" title="Betrag ändern" onClick={() => { setFehler(''); setE({ key: keyVon(b), datum: b.datum, text: b.text ?? '', betrag: fmt(b.betrag) }); }}><Pencil size={15} /></button>
              <button className="icon-btn" title="Löschen" onClick={() => loeschen(b)}><Trash2 size={15} /></button></td>}
          </tr>))}
          {e?.key === 'neu' && zeile(null)}
        </tbody>
      </table>
      {fehler && <p className="error small">{fehler}</p>}
      {bearbeitbar && e?.key !== 'neu' && <button className="link" onClick={() => { setFehler(''); setE({ key: 'neu', datum: neuDatum, text: '', betrag: '' }); }}><Plus size={14} /> Betrag hinzufügen</button>}
    </>
  );
}

export function AbrechnungsUebersicht({ objekt, jahr, pos, schluessel, stand = 0, mitEinnahmen = true, titel, onChanged, nurUmlagefaehig = false }: {
  objekt: number; jahr: number; pos: Position[]; schluessel: (p: Position) => ReactNode; stand?: number; mitEinnahmen?: boolean; titel?: string;
  /** Wird nach Ändern, Löschen oder Hinzufügen eines Betrags aufgerufen; ohne diese Funktion ist die Übersicht nur lesbar */
  onChanged?: (text: string) => void; nurUmlagefaehig?: boolean;
}) {
  const [neu, setNeu] = useState<{ konto: string; datum: string; text: string; betrag: string } | null>(null);
  const [neuFehler, setNeuFehler] = useState('');
  const [intern, setIntern] = useState(0);
  const geaendert = onChanged && ((t: string) => { setIntern((x) => x + 1); onChanged(t); });
  const [belege, setBelege] = useState<{ aus: Row[]; ein: Row[] }>({ aus: [], ein: [] });
  const [konten, setKonten] = useState<Row[]>([]);
  const [eigeneJahr, setEigeneJahr] = useState<Set<number>>(new Set());
  const [offen, setOffen] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!objekt || jahr < 1900) return;
    belegeLaden(objekt, jahr).then(setBelege);
    db.select(`SELECT id, nummer, name, art, umlagefaehig FROM buchungskonten ORDER BY nummer`).then(setKonten);
    db.select('SELECT buchungskonto_id FROM objekt_schluessel_jahr WHERE objekt_id = $1 AND jahr = $2', [objekt, jahr])
      .then((r) => setEigeneJahr(new Set(r.map((x) => Number(x.buchungskonto_id)))));
  }, [objekt, jahr, stand, pos, intern]);

  const umschalten = (k: string) => { const n = new Set(offen); n.has(k) ? n.delete(k) : n.add(k); setOffen(n); };
  const einnahmen = [...new Set(belege.ein.map((b) => b.buchungskonto_id))].map((id) => {
    const k = konten.find((x) => x.id === id) ?? { nummer: '', name: 'ohne Konto' };
    const liste = belege.ein.filter((b) => b.buchungskonto_id === id);
    return { id, nummer: k.nummer, name: k.name, liste, betrag: liste.reduce((a, b) => a + b.betrag, 0) };
  }).sort((a, b) => String(a.nummer).localeCompare(String(b.nummer)));
  const alleSchluessel = [...pos.map((p) => 'a' + p.konto_id), ...einnahmen.map((e) => 'e' + e.id)];
  const summeAus = pos.reduce((a, p) => a + p.betrag, 0), summeEin = einnahmen.reduce((a, e) => a + e.betrag, 0);
  const Pfeil = ({ k, n }: { k: string; n: number }) => (
    <button className="icon-btn aufklapp" disabled={!n} title={offen.has(k) ? 'Rechnungen ausblenden' : 'Rechnungen anzeigen'} onClick={() => umschalten(k)}>
      {offen.has(k) ? <ChevronDown size={17} /> : <ChevronRight size={17} />}</button>);

  const neueKonten = konten.filter((k) => (k.art === 'Aufwand' || k.art === 'Ertrag') && (!nurUmlagefaehig || k.umlagefaehig) && !pos.some((p) => p.konto_id === k.id));
  async function neuSpeichern() {
    if (!neu) return;
    const betrag = zahl(neu.betrag);
    if (!neu.konto) { setNeuFehler('Bitte ein Buchungskonto wählen.'); return; }
    if (!neu.betrag.trim() || !Number.isFinite(betrag) || !betrag) { setNeuFehler('Bitte einen Betrag eintragen, z. B. 125,50.'); return; }
    if (!neu.datum || neu.datum.slice(0, 4) !== String(jahr)) { setNeuFehler(`Das Datum muss im Abrechnungsjahr ${jahr} liegen.`); return; }
    await db.execute('INSERT INTO buchungen (datum, betrag, buchungskonto_id, objekt_id, text) VALUES ($1, $2, $3, $4, $5)',
      [neu.datum, -Math.round(betrag * 100) / 100, Number(neu.konto), objekt, neu.text.trim() || 'Nachtrag Abrechnung']);
    const k = konten.find((x) => x.id === Number(neu.konto));
    setNeu(null); setNeuFehler(''); setOffen(new Set([...offen, 'a' + neu.konto]));
    geaendert?.(`Kostenposition ${k?.nummer ?? ''} ${k?.name ?? ''} mit ${eur(betrag)} hinzugefügt.`);
  }

  return (
    <section className="card abr-uebersicht">
      <div className="card-head"><h2>{titel ?? `Abrechnungsübersicht ${jahr}`}</h2>
        <div className="row">
          {geaendert && <button onClick={() => { setNeuFehler(''); setNeu({ konto: '', datum: `${jahr}-12-31`, text: '', betrag: '' }); }}><Plus size={15} />Kostenposition hinzufügen</button>}
          <button className="link" onClick={() => setOffen(new Set(alleSchluessel))}>Alle aufklappen</button>
          <button className="link" onClick={() => setOffen(new Set())}>Alle zuklappen</button>
        </div></div>
      {neu && (
        <div className="abr-neu">
          <label><span>Buchungskonto</span><select value={neu.konto} onChange={(x) => setNeu({ ...neu, konto: x.target.value })}>
            <option value="">– wählen –</option>
            {pos.length > 0 && <optgroup label="Schon in der Abrechnung">{pos.map((p) => <option key={p.konto_id} value={p.konto_id}>{p.nummer} {p.name}</option>)}</optgroup>}
            <optgroup label="Weitere Konten">{neueKonten.map((k) => <option key={k.id} value={k.id}>{k.nummer} {k.name}</option>)}</optgroup>
          </select></label>
          <label><span>Datum</span><input type="date" value={neu.datum} onChange={(x) => setNeu({ ...neu, datum: x.target.value })} /></label>
          <label className="grow"><span>Text</span><input placeholder="z. B. Rechnung Hausmeister Dezember" value={neu.text} onChange={(x) => setNeu({ ...neu, text: x.target.value })} /></label>
          <label><span>Betrag €</span><input inputMode="decimal" value={neu.betrag} onChange={(x) => setNeu({ ...neu, betrag: x.target.value })} onKeyDown={(x) => x.key === 'Enter' && neuSpeichern()} /></label>
          <div className="row"><button onClick={() => { setNeu(null); setNeuFehler(''); }}>Abbrechen</button><button className="primary" onClick={neuSpeichern}>Hinzufügen</button></div>
          {neuFehler && <p className="error small">{neuFehler}</p>}
        </div>)}
      <h3 className="sec">Ausgaben</h3>
      {pos.length === 0 ? <p className="muted">Keine Ausgaben im Jahr {jahr}. Kosten kommen aus dem Bankimport und aus erfassten Rechnungen.</p> : (
        <table className="list">
          <thead><tr><th style={{ width: 36 }} /><th>Konto</th><th>Kostenart</th><th>umlagefähig</th><th>Verteilerschlüssel {jahr}</th><th className="num">Belege</th><th className="num">Gesamtkosten</th></tr></thead>
          <tbody>{pos.map((p) => {
            const k = 'a' + p.konto_id, liste = belege.aus.filter((b) => b.buchungskonto_id === p.konto_id);
            return (
              <Fragment key={k}>
                <tr className={offen.has(k) ? 'auf' : ''}>
                  <td><Pfeil k={k} n={liste.length} /></td><td>{p.nummer}</td><td>{p.name}</td><td>{p.umlagefaehig ? 'ja' : 'nein'}</td>
                  <td>{schluessel(p)}{eigeneJahr.has(p.konto_id) && <span className="pill st-aktiv klein" title={`Eigener Schlüssel nur für ${jahr}`}>nur {jahr}</span>}</td>
                  <td className="num">{liste.length}</td><td className="num"><b>{eur(p.betrag)}</b></td>
                </tr>
                {offen.has(k) && <tr className="belege-zeile"><td /><td colSpan={6}><Belege liste={liste} ausgabe kontoId={p.konto_id} objekt={objekt} jahr={jahr} onChanged={geaendert} />
                  {Math.abs(liste.reduce((a, b) => a + b.betrag, 0) - p.betrag) > 0.005 && <p className="warn small">Die Belege ergeben {eur(liste.reduce((a, b) => a + b.betrag, 0))}, gebucht sind {eur(p.betrag)}.</p>}</td></tr>}
              </Fragment>);
          })}</tbody>
          <tfoot><tr><td /><td colSpan={5}>Summe Ausgaben</td><td className="num">{eur(summeAus)}</td></tr></tfoot>
        </table>)}
      {mitEinnahmen && <>
        <h3 className="sec">Einnahmen</h3>
        {einnahmen.length === 0 ? <p className="muted">Keine Einnahmen im Jahr {jahr} gebucht.</p> : (
          <table className="list">
            <thead><tr><th style={{ width: 36 }} /><th>Konto</th><th>Art</th><th className="num">Buchungen</th><th className="num">Gesamt</th></tr></thead>
            <tbody>{einnahmen.map((e) => {
              const k = 'e' + e.id;
              return (
                <Fragment key={k}>
                  <tr className={offen.has(k) ? 'auf' : ''}><td><Pfeil k={k} n={e.liste.length} /></td><td>{e.nummer}</td><td>{e.name}</td>
                    <td className="num">{e.liste.length}</td><td className="num"><b>{eur(e.betrag)}</b></td></tr>
                  {offen.has(k) && <tr className="belege-zeile"><td /><td colSpan={4}><Belege liste={e.liste} ausgabe={false} kontoId={Number(e.id)} objekt={objekt} jahr={jahr} onChanged={geaendert} /></td></tr>}
                </Fragment>);
            })}</tbody>
            <tfoot><tr><td /><td colSpan={3}>Summe Einnahmen</td><td className="num">{eur(summeEin)}</td></tr></tfoot>
          </table>)}
      </>}
      <p className="muted small">Den Verteilerschlüssel wählst du je Buchungskonto. Er gilt nur für diese Liegenschaft und nur für {jahr}. Andere Jahre behalten ihren eigenen Schlüssel.
        Ohne eigene Wahl gilt der Standard unter „Umlageschlüssel“. Bei „Manuell“ trägst du den Betrag je Einheit selbst ein.
        {geaendert && ' Beträge änderst oder löschst du in der aufgeklappten Zeile mit Stift und Papierkorb. Jede Änderung wird als Buchung gespeichert und gilt auch in der Buchhaltung.'}</p>
    </section>
  );
}
