// Abrechnungsübersicht: alle Buchungskonten des Jahres mit Gesamtbetrag. Jede Zeile lässt sich aufklappen
// und zeigt die einzelnen Rechnungen und Buchungen, aus denen sich der Betrag zusammensetzt.
// Der Verteilerschlüssel wird je Konto für das Abrechnungsjahr gewählt.
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
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
  const rech = await db.select(`SELECT r.id, COALESCE(r.bezahlt_am, r.datum) AS datum, r.betrag, r.buchungskonto_id, r.rechnungsnr, f.name AS firma, e.nummer AS einheit, r.notiz
    FROM rechnungen r LEFT JOIN firmen f ON f.id = r.firma_id LEFT JOIN einheiten e ON e.id = r.einheit_id
    WHERE r.objekt_id = $1 AND COALESCE(r.bezahlt_am, r.datum) BETWEEN $2 AND $3
      AND NOT EXISTS (SELECT 1 FROM buchungen b WHERE b.rechnung_id = r.id) ORDER BY 2`, [objekt, von, bis]);
  const aus: Row[] = [
    ...buch.filter((b) => b.art === 'Aufwand' || b.art === 'Ertrag').map((b) => ({ ...b, betrag: -Number(b.betrag),
      quelle: b.bankumsatz_id ? 'Bank' : b.rechnungsnr ? 'Rechnung' : 'Buchung' })),
    ...rech.map((r) => ({ ...r, betrag: Number(r.betrag), text: r.notiz, quelle: 'Rechnung, Zahlung noch nicht gebucht' })),
  ].sort((a: Row, b: Row) => String(a.datum).localeCompare(String(b.datum)));
  const ein = buch.filter((b) => b.art === 'Einnahme').map((b) => ({ ...b, betrag: Number(b.betrag), quelle: b.bankumsatz_id ? 'Bank' : b.sollstellung_id ? 'Zahlung' : 'Buchung' }));
  return { aus, ein };
}

function Belege({ liste }: { liste: Row[] }) {
  return (
    <table className="list belege">
      <thead><tr><th>Datum</th><th>Unternehmen / Text</th><th>Rechnung</th><th>Einheit</th><th>Herkunft</th><th className="num">Betrag</th></tr></thead>
      <tbody>{liste.map((b, i) => (
        <tr key={i}><td>{datum(b.datum)}</td><td>{b.firma ? <b>{b.firma}</b> : null}{b.firma && b.text ? <span className="muted"> · </span> : null}{b.text}</td>
          <td>{b.rechnungsnr ?? '–'}</td><td>{b.einheit ?? 'alle'}</td><td className="muted small">{b.quelle}</td><td className="num">{eur(b.betrag)}</td></tr>))}
      </tbody>
    </table>
  );
}

export function AbrechnungsUebersicht({ objekt, jahr, pos, schluessel, stand = 0, mitEinnahmen = true, titel }: {
  objekt: number; jahr: number; pos: Position[]; schluessel: (p: Position) => ReactNode; stand?: number; mitEinnahmen?: boolean; titel?: string;
}) {
  const [belege, setBelege] = useState<{ aus: Row[]; ein: Row[] }>({ aus: [], ein: [] });
  const [konten, setKonten] = useState<Row[]>([]);
  const [eigeneJahr, setEigeneJahr] = useState<Set<number>>(new Set());
  const [offen, setOffen] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!objekt || jahr < 1900) return;
    belegeLaden(objekt, jahr).then(setBelege);
    db.select(`SELECT id, nummer, name FROM buchungskonten`).then(setKonten);
    db.select('SELECT buchungskonto_id FROM objekt_schluessel_jahr WHERE objekt_id = $1 AND jahr = $2', [objekt, jahr])
      .then((r) => setEigeneJahr(new Set(r.map((x) => Number(x.buchungskonto_id)))));
  }, [objekt, jahr, stand, pos]);

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

  return (
    <section className="card abr-uebersicht">
      <div className="card-head"><h2>{titel ?? `Abrechnungsübersicht ${jahr}`}</h2>
        <div className="row">
          <button className="link" onClick={() => setOffen(new Set(alleSchluessel))}>Alle aufklappen</button>
          <button className="link" onClick={() => setOffen(new Set())}>Alle zuklappen</button>
        </div></div>
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
                {offen.has(k) && <tr className="belege-zeile"><td /><td colSpan={6}><Belege liste={liste} />
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
                  {offen.has(k) && <tr className="belege-zeile"><td /><td colSpan={4}><Belege liste={e.liste} /></td></tr>}
                </Fragment>);
            })}</tbody>
            <tfoot><tr><td /><td colSpan={3}>Summe Einnahmen</td><td className="num">{eur(summeEin)}</td></tr></tfoot>
          </table>)}
      </>}
      <p className="muted small">Den Verteilerschlüssel wählst du je Buchungskonto. Er gilt nur für diese Liegenschaft und nur für {jahr}. Andere Jahre behalten ihren eigenen Schlüssel.
        Ohne eigene Wahl gilt der Standard unter „Umlageschlüssel“. Bei „Manuell“ trägst du den Betrag je Einheit selbst ein.</p>
    </section>
  );
}
