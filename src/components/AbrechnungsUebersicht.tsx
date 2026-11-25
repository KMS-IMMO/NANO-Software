// Abrechnungsübersicht: alle Buchungskonten des Jahres mit Gesamtbetrag. Jede Zeile lässt sich aufklappen
// und zeigt die einzelnen Rechnungen und Buchungen, aus denen sich der Betrag zusammensetzt.
// Der Verteilerschlüssel wird je Konto für das Abrechnungsjahr gewählt.
// Beträge lassen sich hier direkt ändern, löschen und neu hinzufügen (als Buchung auf das Konto der Liegenschaft).
import { BetragFeld } from './BetragFeld';
import { loeschen as inPapierkorb } from '../db/papierkorb';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, Pencil, Plus, Trash2, Undo2, X } from 'lucide-react';
import { db, type Row } from '../db';
import { eur } from './EntityTable';
import { belegAnteile, type Position } from '../logic/verteilung';
import { BJ, buchungLoeschen, loeschHinweis } from '../logic/buchung';
import { gesperrt, sperrText } from '../logic/abschluss';
import { DatumFeld } from './DatumFeld';

const datum = (d: string) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('de-DE') : '');

/** Einzelbelege je Buchungskonto, nach derselben Regel wie die Kostenermittlung (Buchungen plus noch nicht gebuchte Rechnungen) */
async function belegeLaden(objekt: number, jahr: number, nurBezahlt = false): Promise<{ aus: Row[]; ein: Row[] }> {
  const von = `${jahr}-01-01`, bis = `${jahr}-12-31`;
  const buch = await db.select(`SELECT b.id, b.datum, b.betrag, b.text, b.buchungskonto_id, k.art,
      COALESCE(f.name, rf.name) AS firma, COALESCE(b.rechnungsnr, r.rechnungsnr) AS rechnungsnr, e.nummer AS einheit, b.einheit_id, b.bankumsatz_id, b.sollstellung_id, b.rechnung_id
    FROM buchungen b JOIN buchungskonten k ON k.id = b.buchungskonto_id
    LEFT JOIN rechnungen r ON r.id = b.rechnung_id LEFT JOIN firmen f ON f.id = b.firma_id LEFT JOIN firmen rf ON rf.id = r.firma_id
    LEFT JOIN einheiten e ON e.id = b.einheit_id
    WHERE b.objekt_id = $1 AND ${BJ('b')} = CAST(substr($2, 1, 4) AS INTEGER) ORDER BY b.datum, b.id`, [objekt, von]);
  const rech = await db.select(`SELECT r.id, r.bezahlt_am, COALESCE(r.bezahlt_am, r.datum) AS datum, r.betrag, r.buchungskonto_id, r.rechnungsnr, f.name AS firma, e.nummer AS einheit, r.einheit_id, r.notiz
    FROM rechnungen r LEFT JOIN firmen f ON f.id = r.firma_id LEFT JOIN einheiten e ON e.id = r.einheit_id
    WHERE r.objekt_id = $1 AND ${nurBezahlt ? 'r.bezahlt_am' : 'COALESCE(r.bezahlt_am, r.datum)'} BETWEEN $2 AND $3
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
  if (keyVon(b)[0] === 'r') await inPapierkorb('rechnungen', Number(b.id));
  else await buchungLoeschen(Number(b.id), { mitRechnung: true });   // Kosten verschwinden ganz aus der Abrechnung
}

/** Verteilung der Belege auf die Einheiten (nur in Abrechnungen mit Einheiten) */
export type BelegVerteilung = { einheiten: Row[]; jeEinheit: (kontoId: number) => Record<number, number> };
type VtBelege = { einheiten: Row[]; anteile: Record<number, number>[]; abrechnung: Record<number, number>; betrag: number };

function Belege({ liste, ausgabe, kontoId, objekt, jahr, onChanged, vt }: { liste: Row[]; ausgabe: boolean; kontoId: number; objekt: number; jahr: number; onChanged?: (t: string) => void; vt?: VtBelege }) {
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
    const h = keyVon(b)[0] === 'b' ? loeschHinweis(b, true) : '', zusatz = h ? ' ' + h : '';
    if (!window.confirm(`${was} über ${eur(b.betrag)} vom ${datum(b.datum)} löschen?${zusatz}`)) return;
    await belegLoeschen(b);
    onChanged?.(`${was} über ${eur(b.betrag)} gelöscht.`);
  }
  const zeile = (b: Row | null) => e && (
    <tr className="beleg-edit" key={'e' + (b ? keyVon(b) : 'neu')}>
      <td><DatumFeld className="cell" value={e.datum} onChange={(x) => setE({ ...e, datum: x.target.value })} /></td>
      <td colSpan={4 + (vt?.einheiten.length ?? 0)}><input className="cell" style={{ width: '100%', textAlign: 'left' }} placeholder="Text, z. B. Korrektur oder Rechnung Hausmeister" value={e.text} onChange={(x) => setE({ ...e, text: x.target.value })} /></td>
      <td className="num"><BetragFeld zelle className="cell" autoFocus style={{ width: 130 }} value={e.betrag} onChange={(x) => setE({ ...e, betrag: x.target.value })}
        onKeyDown={(x) => { if (x.key === 'Enter') speichern(b); if (x.key === 'Escape') setE(null); }} /></td>
      <td className="actions nowrap"><button className="icon-btn" title="Speichern" onClick={() => speichern(b)}><Check size={16} /></button>
        <button className="icon-btn" title="Abbrechen" onClick={() => { setE(null); setFehler(''); }}><X size={16} /></button></td>
    </tr>);
  return (
    <>
      <table className="list belege">
        <thead><tr><th>Datum</th><th>Unternehmen / Text</th><th>Rechnung</th><th>Einheit</th><th>Herkunft</th><th className="num">Betrag</th>
          {vt?.einheiten.map((x) => <th key={x.id} className="num abr-anteil" title={`Anteil ${x.nummer}`}>{x.nummer}</th>)}{bearbeitbar && <th />}</tr></thead>
        <tbody>{liste.map((b, i) => e?.key === keyVon(b) ? zeile(b) : (
          <tr key={keyVon(b)}><td>{datum(b.datum)}</td><td>{b.firma ? <b>{b.firma}</b> : null}{b.firma && b.text ? <span className="muted"> · </span> : null}{b.text}</td>
            <td>{b.rechnungsnr ?? '–'}</td><td>{b.einheit ?? 'alle'}</td><td className="muted small">{b.quelle}</td><td className="num">{eur(b.betrag)}</td>
            {vt?.einheiten.map((x) => { const a = vt.anteile[i]?.[x.id] ?? 0; return <td key={x.id} className={'num abr-anteil' + (Math.abs(a) < 0.005 ? ' muted' : '')}>{Math.abs(a) < 0.005 ? '–' : eur(a)}</td>; })}
            {bearbeitbar && <td className="actions nowrap">
              <button className="icon-btn" title="Betrag ändern" onClick={() => { setFehler(''); setE({ key: keyVon(b), datum: b.datum, text: b.text ?? '', betrag: fmt(b.betrag) }); }}><Pencil size={15} /></button>
              <button className="icon-btn" title="Löschen" onClick={() => loeschen(b)}><Trash2 size={15} /></button></td>}
          </tr>))}
          {e?.key === 'neu' && zeile(null)}
        </tbody>
        {vt && liste.length > 0 && (() => {
          const summe = (id: number) => vt.anteile.reduce((a, x) => a + (x[id] ?? 0), 0);
          return <tfoot>
            <tr className="abr-anteil-summe"><td colSpan={5}>Ergibt je Einheit</td><td className="num">{eur(vt.betrag)}</td>
              {vt.einheiten.map((x) => <td key={x.id} className="num abr-anteil"><b>{eur(summe(x.id))}</b></td>)}{bearbeitbar && <td />}</tr>
            {vt.einheiten.some((x) => Math.abs(summe(x.id) - (vt.abrechnung[x.id] ?? 0)) >= 0.01 * vt.anteile.length + 0.01) &&
              <tr><td colSpan={6} className="warn small">In der Abrechnung je Einheit</td>
                {vt.einheiten.map((x) => <td key={x.id} className="num abr-anteil warn small">{eur(vt.abrechnung[x.id] ?? 0)}</td>)}{bearbeitbar && <td />}</tr>}
          </tfoot>;
        })()}
      </table>
      {fehler && <p className="error small">{fehler}</p>}
      {bearbeitbar && e?.key !== 'neu' && <button className="link" onClick={() => { setFehler(''); setE({ key: 'neu', datum: neuDatum, text: '', betrag: '' }); }}><Plus size={14} /> Betrag hinzufügen</button>}
    </>
  );
}

export function AbrechnungsUebersicht({ objekt, jahr, pos, schluessel, stand = 0, mitEinnahmen = true, titel, onChanged, nurUmlagefaehig = false, nurBezahlt = false, einnahmeKonten, einnahmenTitel, verteilung }: {
  objekt: number; jahr: number; pos: Position[]; schluessel: (p: Position) => ReactNode; stand?: number; mitEinnahmen?: boolean; titel?: string;
  /** Wird nach Ändern, Löschen oder Hinzufügen eines Betrags aufgerufen; ohne diese Funktion ist die Übersicht nur lesbar */
  onChanged?: (text: string) => void; nurUmlagefaehig?: boolean; nurBezahlt?: boolean;
  /** Nur diese Einnahmekonten zeigen (Nebenkostenabrechnung: nur Vorauszahlungen der Mieter, nie Hausgeld oder Rücklage der Eigentümer) */
  einnahmeKonten?: string[]; einnahmenTitel?: string;
  /** Einheiten und Abrechnungsergebnis je Konto: aufgeklappte Belege zeigen dann den Anteil jeder Einheit */
  verteilung?: BelegVerteilung;
}) {
  const [neu, setNeu] = useState<{ konto: string; datum: string; text: string; betrag: string } | null>(null);
  const [neuFehler, setNeuFehler] = useState('');
  const [anp, setAnp] = useState<{ konto: number; betrag: string; grund: string; fehler?: string } | null>(null);
  const [intern, setIntern] = useState(0);
  const geaendert = onChanged && ((t: string) => { setIntern((x) => x + 1); onChanged(t); });
  const [belege, setBelege] = useState<{ aus: Row[]; ein: Row[] }>({ aus: [], ein: [] });
  const [konten, setKonten] = useState<Row[]>([]);
  const [eigeneJahr, setEigeneJahr] = useState<Set<number>>(new Set());
  const [raus, setRaus] = useState<Row[]>([]);   // aus der Abrechnung genommene Kostenpositionen
  const [offen, setOffen] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!objekt || jahr < 1900) return;
    belegeLaden(objekt, jahr, nurBezahlt).then(setBelege);
    db.select(`SELECT id, nummer, name, art, umlagefaehig FROM buchungskonten ORDER BY nummer`).then(setKonten);
    db.select(`SELECT a.*, k.nummer, k.name FROM abrechnung_betraege a JOIN buchungskonten k ON k.id = a.buchungskonto_id
      WHERE a.objekt_id = $1 AND a.jahr = $2 AND a.ausgeschlossen = 1 ${nurUmlagefaehig ? 'AND k.umlagefaehig = 1' : ''} ORDER BY k.nummer`, [objekt, jahr]).then(setRaus);
    db.select('SELECT buchungskonto_id FROM objekt_schluessel_jahr WHERE objekt_id = $1 AND jahr = $2', [objekt, jahr])
      .then((r) => setEigeneJahr(new Set(r.map((x) => Number(x.buchungskonto_id)))));
  }, [objekt, jahr, stand, pos, intern]);

  const vtFuer = (p: Position, liste: Row[]): VtBelege | undefined => {
    if (!verteilung?.einheiten.length) return undefined;
    const abrechnung = verteilung.jeEinheit(p.konto_id);
    const je: Record<number, number> = Object.fromEntries(verteilung.einheiten.map((x) => [Number(x.id), abrechnung[x.id] ?? 0]));
    return { einheiten: verteilung.einheiten, anteile: belegAnteile(p, liste as { betrag: number; einheit_id?: number | null }[], je), abrechnung: je, betrag: p.betrag };
  };
  // Abgleich: Summe je Konto in Einnahmen & Ausgaben, in der Abrechnung und tatsächlich auf die Einheiten verteilt
  const abgleich = () => {
    const out: { text: string; ok: boolean }[] = [];
    for (const p of pos) {
      const ea = belege.aus.filter((b) => b.buchungskonto_id === p.konto_id).reduce((a, b) => a + b.betrag, 0);
      const je = verteilung?.jeEinheit(p.konto_id) ?? {};
      const verteilt = Object.values(je).reduce((a, v) => a + v, 0);
      const name = `${p.nummer} ${p.name}`;
      if (Math.abs(ea - p.betrag) >= 0.01) out.push({ ok: p.gebucht !== undefined, text: p.gebucht !== undefined
        ? `${name}: in Einnahmen & Ausgaben ${eur(ea)}, für die Abrechnung angepasst auf ${eur(p.betrag)}${p.grund ? ` (${p.grund})` : ''}.`
        : `${name}: in Einnahmen & Ausgaben ${eur(ea)}, in der Abrechnung ${eur(p.betrag)}.` });
      if (Math.abs(verteilt - p.betrag) >= 0.01) out.push({ ok: false, text: `${name}: ${eur(p.betrag)} in der Abrechnung, aber nur ${eur(verteilt)} auf die Einheiten verteilt. Es fehlen Werte (Verbrauch, Messdienst, Personen oder Betrag je Einheit).` });
    }
    for (const r of raus) {
      const ea = belege.aus.filter((b) => b.buchungskonto_id === r.buchungskonto_id).reduce((a, b) => a + b.betrag, 0);
      if (Math.abs(ea) >= 0.01) out.push({ ok: true, text: `${r.nummer} ${r.name}: ${eur(ea)} in Einnahmen & Ausgaben, bewusst aus der Abrechnung genommen.` });
    }
    return out;
  };
  const Abgleich = () => {
    const l = abgleich();
    const fehler = l.filter((x) => !x.ok);
    return (
      <div className={'abr-abgleich ' + (fehler.length ? 'warn' : 'ok')}>
        <b>Abgleich mit Einnahmen &amp; Ausgaben</b>
        {!l.length && <span> · Jedes Konto stimmt mit Einnahmen &amp; Ausgaben überein und ist vollständig auf die Einheiten verteilt.</span>}
        {l.length > 0 && <ul>{l.map((x, i) => <li key={i} className={x.ok ? 'muted' : ''}>{x.text}</li>)}</ul>}
      </div>);
  };
  const umschalten = (k: string) => { const n = new Set(offen); if (n.has(k)) n.delete(k); else n.add(k); setOffen(n); };
  const einErlaubt = (id: number) => !einnahmeKonten || einnahmeKonten.includes(String(konten.find((x) => x.id === id)?.nummer ?? ''));
  const einnahmen = [...new Set(belege.ein.map((b) => b.buchungskonto_id))].filter(einErlaubt).map((id) => {
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

  // Gesamtkosten nur für die Abrechnung anpassen; die Buchungen bleiben, wie sie sind
  async function anpassenSpeichern(p: Position, zuruecksetzen = false) {
    if (!anp) return;
    const sp = await gesperrt(objekt, `${jahr}-01-01`);
    if (sp) { setAnp({ ...anp, fehler: sperrText(sp) }); return; }
    if (zuruecksetzen) {
      await db.execute('DELETE FROM abrechnung_betraege WHERE objekt_id = $1 AND jahr = $2 AND buchungskonto_id = $3', [objekt, jahr, p.konto_id]);
      setAnp(null); geaendert?.(`${p.nummer} ${p.name}: wieder der gebuchte Betrag ${eur(p.gebucht ?? p.betrag)}.`); return;
    }
    const b = zahl(anp.betrag);
    if (!anp.betrag.trim() || !Number.isFinite(b)) { setAnp({ ...anp, fehler: 'Bitte einen Betrag eintragen, z. B. 11.850,00.' }); return; }
    const gebucht = p.gebucht ?? p.betrag;
    if (Math.abs(b - gebucht) < 0.005) {   // gleich dem gebuchten Betrag: Anpassung entfernen
      await db.execute('DELETE FROM abrechnung_betraege WHERE objekt_id = $1 AND jahr = $2 AND buchungskonto_id = $3', [objekt, jahr, p.konto_id]);
    } else {
      await db.execute(`INSERT INTO abrechnung_betraege (objekt_id, jahr, buchungskonto_id, betrag, grund) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (objekt_id, jahr, buchungskonto_id) DO UPDATE SET betrag = excluded.betrag, grund = excluded.grund`, [objekt, jahr, p.konto_id, Math.round(b * 100) / 100, anp.grund.trim() || null]);
    }
    setAnp(null);
    geaendert?.(`${p.nummer} ${p.name}: Gesamtkosten für die Abrechnung ${jahr} ${eur(b)} (gebucht ${eur(gebucht)}).`);
  }

  // Kostenposition ganz aus der Abrechnung nehmen; die Buchungen bleiben in der Buchhaltung
  async function herausnehmen(p: Position) {
    const sp = await gesperrt(objekt, `${jahr}-01-01`);
    if (sp) { onChanged?.(sperrText(sp)); return; }
    if (!window.confirm(`${p.nummer} ${p.name} (${eur(p.betrag)}) aus der Abrechnung ${jahr} nehmen?\n\nDie Buchungen bleiben in der Buchhaltung. Unten unter „Aus der Abrechnung genommen“ holst du die Position jederzeit zurück.`)) return;
    await db.execute(`INSERT INTO abrechnung_betraege (objekt_id, jahr, buchungskonto_id, betrag, grund, ausgeschlossen) VALUES ($1, $2, $3, $4, NULL, 1)
      ON CONFLICT (objekt_id, jahr, buchungskonto_id) DO UPDATE SET ausgeschlossen = 1`, [objekt, jahr, p.konto_id, p.betrag]);
    geaendert?.(`${p.nummer} ${p.name} ist nicht mehr in der Abrechnung ${jahr}.`);
  }
  async function zurueckholen(r: Row) {
    const sp = await gesperrt(objekt, `${jahr}-01-01`);
    if (sp) { onChanged?.(sperrText(sp)); return; }
    // War vorher ein Betrag angepasst, bleibt er erhalten; sonst gilt wieder der gebuchte Betrag
    if (r.grund) await db.execute('UPDATE abrechnung_betraege SET ausgeschlossen = 0 WHERE objekt_id = $1 AND jahr = $2 AND buchungskonto_id = $3', [objekt, jahr, r.buchungskonto_id]);
    else await db.execute('DELETE FROM abrechnung_betraege WHERE objekt_id = $1 AND jahr = $2 AND buchungskonto_id = $3', [objekt, jahr, r.buchungskonto_id]);
    geaendert?.(`${r.nummer} ${r.name} ist wieder in der Abrechnung ${jahr}.`);
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
          <label><span>Datum</span><DatumFeld value={neu.datum} onChange={(x) => setNeu({ ...neu, datum: x.target.value })} /></label>
          <label className="grow"><span>Text</span><input placeholder="z. B. Rechnung Hausmeister Dezember" value={neu.text} onChange={(x) => setNeu({ ...neu, text: x.target.value })} /></label>
          <label><span>Betrag</span><BetragFeld value={neu.betrag} onChange={(x) => setNeu({ ...neu, betrag: x.target.value })} onKeyDown={(x) => x.key === 'Enter' && neuSpeichern()} /></label>
          <div className="row"><button onClick={() => { setNeu(null); setNeuFehler(''); }}>Abbrechen</button><button className="primary" onClick={neuSpeichern}>Hinzufügen</button></div>
          {neuFehler && <p className="error small">{neuFehler}</p>}
        </div>)}
      <h3 className="sec">Ausgaben</h3>
      {pos.length === 0 ? <p className="muted">Keine Ausgaben im Jahr {jahr}. Kosten kommen aus dem Bankimport und aus erfassten Rechnungen.</p> : (
        <table className="list">
          <thead><tr><th style={{ width: 36 }} /><th>Konto</th><th>Kostenart</th><th>Verteilerschlüssel {jahr}</th><th className="num">Belege</th><th className="num">Gesamtkosten</th></tr></thead>
          {([['Umlagefähige Kosten', pos.filter((p) => p.umlagefaehig), 'umlage'], ['Nicht umlagefähige Kosten', pos.filter((p) => !p.umlagefaehig), 'nicht']] as const).map(([gTitel, gPos, art]) => gPos.length > 0 && (
          <tbody key={art} className={'abr-gruppe ' + art}>
            <tr className="abr-gruppe-kopf"><td /><td colSpan={5}>{gTitel}<span className="muted small"> · {art === 'umlage' ? 'auf Mieter umlegbar (BetrKV)' : 'nicht auf Mieter umlegbar'}</span></td></tr>
            {gPos.map((p) => {
            const k = 'a' + p.konto_id, liste = belege.aus.filter((b) => b.buchungskonto_id === p.konto_id);
            return (
              <Fragment key={k}>
                <tr className={offen.has(k) ? 'auf' : ''}>
                  <td><Pfeil k={k} n={liste.length} /></td><td>{p.nummer}</td><td>{p.name}{(p.hdl || p.hwl) && <div className="muted small">§ 35a {p.hdl ? 'HDL' : 'HWL'}: {eur(p.betrag35a ?? p.betrag)}</div>}</td>
                  <td>{schluessel(p)}{eigeneJahr.has(p.konto_id) && <span className="pill st-aktiv klein" title={`Eigener Schlüssel nur für ${jahr}`}>nur {jahr}</span>}</td>
                  <td className="num">{liste.length}</td>
                  <td className="num abr-betrag"><span className="abr-betrag-zeile">
                    {p.gebucht !== undefined && <span className="pill klein abr-angepasst" title={p.grund ?? 'Für die Abrechnung angepasst'}>angepasst</span>}
                    <b>{eur(p.betrag)}</b>
                    {geaendert && <button className="icon-btn" title="Gesamtkosten für die Abrechnung anpassen" onClick={() => setAnp({ konto: p.konto_id, betrag: String(p.betrag.toFixed(2)).replace('.', ','), grund: p.grund ?? '' })}><Pencil size={14} /></button>}
                    {geaendert && <button className="icon-btn" title="Kostenposition aus der Abrechnung nehmen" onClick={() => herausnehmen(p)}><Trash2 size={14} /></button>}</span>
                    {p.gebucht !== undefined && <div className="muted small">gebucht {eur(p.gebucht)}{p.grund ? ` · ${p.grund}` : ''}</div>}</td>
                </tr>
                {anp?.konto === p.konto_id && <tr className="abr-anpassen"><td /><td colSpan={5}>
                  <div className="abr-neu">
                    <label><span>Gesamtkosten für die Abrechnung {jahr}</span><BetragFeld autoFocus value={anp.betrag} onChange={(x) => setAnp({ ...anp, betrag: x.target.value, fehler: undefined })} onKeyDown={(x) => x.key === 'Enter' && anpassenSpeichern(p)} /></label>
                    <label className="grow"><span>Grund</span><input placeholder="z. B. Heizkostenabrechnung Messdienst statt Abschläge" value={anp.grund} onChange={(x) => setAnp({ ...anp, grund: x.target.value })} /></label>
                    <div className="row">
                      {p.gebucht !== undefined && <button onClick={() => anpassenSpeichern(p, true)}>Gebuchten Betrag nehmen</button>}
                      <button onClick={() => setAnp(null)}>Abbrechen</button><button className="primary" onClick={() => anpassenSpeichern(p)}>Übernehmen</button></div>
                    <p className="muted small" style={{ flexBasis: '100%', margin: 0 }}>Gebucht sind {eur(p.gebucht ?? p.betrag)}. Der neue Betrag gilt nur für die Abrechnung {jahr} dieser Liegenschaft. Die Buchhaltung bleibt unverändert.</p>
                    {anp.fehler && <p className="error small">{anp.fehler}</p>}
                  </div></td></tr>}
                {offen.has(k) && <tr className="belege-zeile"><td /><td colSpan={5}><Belege liste={liste} ausgabe kontoId={p.konto_id} objekt={objekt} jahr={jahr} onChanged={geaendert} vt={vtFuer(p, liste)} />
                  {Math.abs(liste.reduce((a, b) => a + b.betrag, 0) - (p.gebucht ?? p.betrag)) > 0.005 && <p className="warn small">Die Belege ergeben {eur(liste.reduce((a, b) => a + b.betrag, 0))}, gebucht sind {eur(p.gebucht ?? p.betrag)}.</p>}</td></tr>}
              </Fragment>);
          })}
            <tr className="abr-zwischensumme"><td /><td colSpan={4}>Summe {gTitel.toLowerCase().replace('kosten', 'Kosten')}</td><td className="num">{eur(gPos.reduce((a, p) => a + p.betrag, 0))}</td></tr>
          </tbody>))}
          <tfoot><tr><td /><td colSpan={4}>Summe Ausgaben gesamt</td><td className="num">{eur(summeAus)}</td></tr></tfoot>
        </table>)}
      {raus.length > 0 && <div className="abr-raus">
        <div><b>Aus der Abrechnung genommen</b><span className="muted small"> · die Buchungen bleiben in der Buchhaltung</span></div>
        {raus.map((r) => <div key={r.buchungskonto_id} className="abr-raus-zeile"><span>{r.nummer} {r.name}</span><span className="grow" />
          {geaendert && <button className="link" onClick={() => zurueckholen(r)}><Undo2 size={14} /> Wieder aufnehmen</button>}</div>)}
      </div>}
      {verteilung && pos.length > 0 && <Abgleich />}
      {mitEinnahmen && <>
        <h3 className="sec">{einnahmenTitel ?? 'Einnahmen'}</h3>
        {einnahmen.length === 0 ? <p className="muted">{einnahmeKonten ? `Keine Vorauszahlungen von Mietern im Jahr ${jahr} bei uns gebucht.` : `Keine Einnahmen im Jahr ${jahr} gebucht.`}</p> : (
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
        {geaendert && ' Beträge änderst oder löschst du in der aufgeklappten Zeile mit Stift und Papierkorb. Jede Änderung wird als Buchung gespeichert und gilt auch in der Buchhaltung. Mit dem Stift neben den Gesamtkosten passt du dagegen nur den Betrag für diese Abrechnung an, zum Beispiel Heizkosten laut Messdienst statt der Abschläge. Mit dem Papierkorb daneben nimmst du die ganze Kostenposition aus der Abrechnung. In beiden Fällen bleibt die Buchhaltung unverändert.'}</p>
    </section>
  );
}
