// Nebenkostenabrechnung je Objekt und Kalenderjahr (Mietverwaltung und vermietete WEG-Einheiten).
import { useEffect, useState } from 'react';
import { db, type Row } from '../db';
import { eur, num, datum } from '../components/EntityTable';
import {
  kostenErmitteln, nutzerErmitteln, tageImJahr, verteilen, vorauszahlungen, type Ergebnis, type Position, type Schluessel,
} from '../logic/verteilung';
import { Brief, absender, dDatum, geld } from '../lib/pdf';
import { oeffnen, speichern } from '../lib/dateien';

const HEIZ_KONTO = '1200';
const einheitText: Record<string, string> = { Fläche: 'm²', MEA: 'MEA', Einheiten: 'Einh.', Personen: 'Pers.-Tage', Verbrauch: 'Verbr.', Messdienst: '€ lt. Messdienst', Direkt: '€', Summe: '€' };
const basisFmt = (s: Schluessel, v: number) => (s === 'Personen' ? num(v, 0) : s === 'Einheiten' ? num(v, 3) : num(v, 2));

export function NebenkostenPage() {
  const [objekte, setObjekte] = useState<Row[]>([]);
  const [objekt, setObjekt] = useState<number | ''>('');
  const [jahr, setJahr] = useState(new Date().getFullYear() - 1);
  const [einheiten, setEinheiten] = useState<Row[]>([]);
  const [pos, setPos] = useState<Position[]>([]);
  const [erg, setErg] = useState<(Ergebnis & { vz: number; saldo: number })[]>([]);
  const [heiz, setHeiz] = useState<Record<number, { heizkosten: string; warmwasser: string }>>({});
  const [verbr, setVerbr] = useState<Record<string, string>>({});
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    db.select(`SELECT * FROM objekte ORDER BY verwaltungsart, name`).then((o) => { setObjekte(o); if (o.length) setObjekt(o[0].id); });
  }, []);

  async function laden() {
    if (objekt === '') return;
    const h = await db.select(`SELECT h.* FROM heizkosten_ergebnisse h JOIN einheiten e ON e.id = h.einheit_id WHERE e.objekt_id = $1 AND h.jahr = $2`, [objekt, jahr]);
    setHeiz(Object.fromEntries(h.map((x) => [x.einheit_id, { heizkosten: String(x.heizkosten ?? ''), warmwasser: String(x.warmwasser ?? '') }])));
    const v = await db.select(`SELECT v.* FROM verbrauch v JOIN einheiten e ON e.id = v.einheit_id WHERE e.objekt_id = $1 AND v.jahr = $2`, [objekt, jahr]);
    setVerbr(Object.fromEntries(v.map((x) => [`${x.einheit_id}-${x.buchungskonto_id}`, String(x.menge)])));
    await rechnen();
  }
  useEffect(() => { laden(); }, [objekt, jahr]);

  async function rechnen() {
    if (objekt === '') return;
    const { einheiten, nutzer } = await nutzerErmitteln(Number(objekt), jahr, 'Mieter');
    setEinheiten(einheiten);
    let positionen = await kostenErmitteln(Number(objekt), jahr, true);
    const h = await db.select(`SELECT h.* FROM heizkosten_ergebnisse h JOIN einheiten e ON e.id = h.einheit_id WHERE e.objekt_id = $1 AND h.jahr = $2`, [objekt, jahr]);
    const messdienst: Record<number, number> = Object.fromEntries(h.map((x) => [x.einheit_id, Number(x.heizkosten) + Number(x.warmwasser)]));
    // Heizkosten nach Messdienst verteilen, sobald Ergebnisse eingetragen sind
    if (Object.keys(messdienst).length) positionen = positionen.map((p) => (p.nummer === HEIZ_KONTO ? { ...p, schluessel: 'Messdienst' } : p));
    const v = await db.select(`SELECT v.* FROM verbrauch v JOIN einheiten e ON e.id = v.einheit_id WHERE e.objekt_id = $1 AND v.jahr = $2`, [objekt, jahr]);
    const verbrauch = Object.fromEntries(v.map((x) => [`${x.einheit_id}-${x.buchungskonto_id}`, Number(x.menge)]));
    setPos(positionen);
    const vz = await vorauszahlungen(jahr, ['NK', 'HK']);
    const e = verteilen(jahr, einheiten, nutzer, positionen, { verbrauch, messdienst }).map((r) => {
      const gezahlt = r.nutzer.vertrag_id ? vz.filter((x) => x.vertrag_id === r.nutzer.vertrag_id).reduce((a, x) => a + Number(x.gezahlt), 0) : 0;
      return { ...r, vz: Math.round(gezahlt * 100) / 100, saldo: Math.round((r.summe - gezahlt) * 100) / 100 };
    });
    setErg(e);
  }

  async function eingabenSpeichern() {
    for (const [eid, x] of Object.entries(heiz)) {
      if (x.heizkosten === '' && x.warmwasser === '') { await db.execute('DELETE FROM heizkosten_ergebnisse WHERE einheit_id = $1 AND jahr = $2', [Number(eid), jahr]); continue; }
      await db.execute(`INSERT INTO heizkosten_ergebnisse (einheit_id, jahr, heizkosten, warmwasser) VALUES ($1, $2, $3, $4)
        ON CONFLICT (einheit_id, jahr) DO UPDATE SET heizkosten = excluded.heizkosten, warmwasser = excluded.warmwasser`,
        [Number(eid), jahr, zahl(x.heizkosten), zahl(x.warmwasser)]);
    }
    for (const [k, m] of Object.entries(verbr)) {
      const [eid, kid] = k.split('-').map(Number);
      if (m === '') await db.execute('DELETE FROM verbrauch WHERE einheit_id = $1 AND jahr = $2 AND buchungskonto_id = $3', [eid, jahr, kid]);
      else await db.execute(`INSERT INTO verbrauch (einheit_id, jahr, buchungskonto_id, menge) VALUES ($1, $2, $3, $4)
        ON CONFLICT (einheit_id, jahr, buchungskonto_id) DO UPDATE SET menge = excluded.menge`, [eid, jahr, kid, zahl(m)]);
    }
    setInfo('Eingaben gespeichert und neu berechnet.');
    await rechnen();
  }

  async function pdfs() {
    setBusy(true);
    try {
      const o = objekte.find((x) => x.id === objekt)!;
      const abs = await absender();
      let n = 0, letzter = '';
      for (const r of erg.filter((x) => x.nutzer.art === 'Mieter')) {
        letzter = await speichern(abrechnungPdf(abs, o, jahr, r), `NK-Abrechnung ${jahr} ${r.einheit.nummer} ${r.nutzer.name}.pdf`,
          { bezug: 'Objekt', bezugId: o.id, ordner: [o.name, 'Nebenkostenabrechnungen', String(jahr)] });
        n++;
      }
      setInfo(`${n} Abrechnungen erstellt und abgelegt unter ${o.name}/Nebenkostenabrechnungen/${jahr}.`);
      if (n === 1) oeffnen(letzter);
    } catch (e: any) { setInfo('Fehler: ' + (e?.message ?? e)); } finally { setBusy(false); }
  }

  async function buchen() {
    let n = 0;
    for (const r of erg.filter((x) => x.nutzer.art === 'Mieter' && Math.abs(x.saldo) > 0.005)) {
      const f = new Date(); f.setDate(f.getDate() + 30);
      const res = await db.execute(`INSERT OR IGNORE INTO sollstellungen (vertrag_id, einheit_id, person_id, monat, art, betrag, faellig)
        VALUES ($1, $2, $3, $4, 'NK-Abrechnung', $5, $6)`, [r.nutzer.vertrag_id ?? null, r.nutzer.einheit_id, r.nutzer.person_id, `${jahr}-NK`, r.saldo, f.toISOString().slice(0, 10)]);
      n += res.rowsAffected;
    }
    await db.execute(`INSERT INTO abrechnungen (objekt_id, art, jahr, status) VALUES ($1, 'Nebenkosten', $2, 'Gebucht')`, [objekt, jahr]);
    setInfo(n ? `${n} Nachzahlungen/Guthaben als offene Posten gebucht (fällig in 30 Tagen).` : 'Bereits gebucht.');
  }

  const kosten = pos.reduce((a, p) => a + p.betrag, 0);
  const verbrauchsKonten = pos.filter((p) => p.schluessel === 'Verbrauch');
  const mieter = erg.filter((r) => r.nutzer.art === 'Mieter');
  const leer = erg.filter((r) => r.nutzer.art === 'Leerstand');

  return (
    <>
      <div className="page-head"><h1>Nebenkostenabrechnung</h1><p className="muted">Kalenderjahr, Umlage nach den Schlüsseln des Objekts, Leerstand trägt der Eigentümer</p></div>
      <section className="card row">
        <select style={{ width: 300 }} value={objekt} onChange={(e) => setObjekt(Number(e.target.value))}>
          {objekte.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.verwaltungsart})</option>)}
        </select>
        <label className="inline">Jahr <input type="number" style={{ width: 90 }} value={jahr} onChange={(e) => setJahr(Number(e.target.value))} /></label>
        <span className="muted small">01.01.{jahr} bis 31.12.{jahr} · {tageImJahr(jahr)} Tage</span>
        <span className="grow" />
        <button onClick={pdfs} disabled={busy || !mieter.length}>PDFs je Mieter erstellen</button>
        <button className="primary" onClick={buchen} disabled={!mieter.length}>Ergebnis als offene Posten buchen</button>
      </section>
      {info && <p className="info">{info}</p>}

      <div className="kpis">
        <div className="kpi"><span>Umlagefähige Kosten</span><b>{eur(kosten)}</b></div>
        <div className="kpi"><span>Vorauszahlungen (gezahlt)</span><b>{eur(mieter.reduce((a, r) => a + r.vz, 0))}</b></div>
        <div className="kpi"><span>Nachzahlungen − Guthaben</span><b>{eur(mieter.reduce((a, r) => a + r.saldo, 0))}</b></div>
        <div className="kpi"><span>Anteil Leerstand (Eigentümer)</span><b>{eur(leer.reduce((a, r) => a + r.summe, 0))}</b></div>
      </div>

      <section className="card">
        <div className="card-head"><h2>Eingaben je Einheit für {jahr}</h2><button onClick={eingabenSpeichern}>Speichern und neu berechnen</button></div>
        <table className="list">
          <thead><tr><th>Einheit</th><th className="num">Fläche</th><th className="num">Heizkosten lt. Messdienst €</th><th className="num">Warmwasser lt. Messdienst €</th>
            {verbrauchsKonten.map((k) => <th key={k.konto_id} className="num">Verbrauch {k.name}</th>)}</tr></thead>
          <tbody>{einheiten.map((e) => (
            <tr key={e.id}>
              <td>{e.nummer}</td><td className="num">{num(e.flaeche)}</td>
              {(['heizkosten', 'warmwasser'] as const).map((f) => (
                <td key={f} className="num"><input className="cell" inputMode="decimal" value={heiz[e.id]?.[f] ?? ''}
                  onChange={(ev) => setHeiz({ ...heiz, [e.id]: { heizkosten: heiz[e.id]?.heizkosten ?? '', warmwasser: heiz[e.id]?.warmwasser ?? '', [f]: ev.target.value } })} /></td>
              ))}
              {verbrauchsKonten.map((k) => (
                <td key={k.konto_id} className="num"><input className="cell" inputMode="decimal" value={verbr[`${e.id}-${k.konto_id}`] ?? ''}
                  onChange={(ev) => setVerbr({ ...verbr, [`${e.id}-${k.konto_id}`]: ev.target.value })} /></td>
              ))}
            </tr>))}
          </tbody>
        </table>
        <p className="muted small">Sobald Messdienst-Werte eingetragen sind, wird Konto {HEIZ_KONTO} danach verteilt. Verbrauchsspalten erscheinen für Konten mit Schlüssel „Verbrauch“.</p>
      </section>

      <section className="card">
        <div className="card-head"><h2>Kosten {jahr}</h2></div>
        {pos.length === 0 ? <p className="muted">Keine umlagefähigen Kosten im Jahr {jahr}. Kosten kommen aus dem Bankimport und aus erfassten Rechnungen.</p> : (
          <table className="list">
            <thead><tr><th>Konto</th><th>Kostenart</th><th>Schlüssel</th><th>§35a</th><th className="num">Betrag</th></tr></thead>
            <tbody>{pos.map((p) => <tr key={p.konto_id}><td>{p.nummer}</td><td>{p.name}</td><td>{p.schluessel}</td><td>{[p.hdl && 'HDL', p.hwl && 'HWL'].filter(Boolean).join(', ')}</td><td className="num">{eur(p.betrag)}</td></tr>)}</tbody>
          </table>)}
      </section>

      <section className="card">
        <div className="card-head"><h2>Ergebnis je Mieter</h2></div>
        {erg.length === 0 ? <p className="muted">Keine Nutzer im Jahr.</p> : (
          <table className="list">
            <thead><tr><th>Einheit</th><th>Nutzer</th><th>Zeitraum</th><th className="num">Kostenanteil</th><th className="num">Vorauszahlung</th><th className="num">Ergebnis</th><th className="num">§35a HDL / HWL</th></tr></thead>
            <tbody>{erg.map((r) => (
              <tr key={r.nutzer.key}>
                <td>{r.einheit.nummer}</td>
                <td>{r.nutzer.art === 'Leerstand' ? <span className="tag">Leerstand / nicht vermietet · Eigentümer</span> : r.nutzer.name}</td>
                <td className="small">{datum(r.nutzer.von)} – {datum(r.nutzer.bis)} ({r.nutzer.tage} T.)</td>
                <td className="num">{eur(r.summe)}</td>
                <td className="num">{r.nutzer.art === 'Mieter' ? eur(r.vz) : ''}</td>
                <td className={'num ' + (r.saldo > 0 ? 'neg' : 'pos')}>{r.nutzer.art === 'Mieter' ? <b>{r.saldo > 0 ? 'Nachzahlung ' : 'Guthaben '}{eur(Math.abs(r.saldo))}</b> : ''}</td>
                <td className="num small">{eur(r.hdl)} / {eur(r.hwl)}</td>
              </tr>))}
            </tbody>
          </table>)}
      </section>
    </>
  );
}

const zahl = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.')) || 0;

function abrechnungPdf(abs: Awaited<ReturnType<typeof absender>>, o: Row, jahr: number, r: Ergebnis & { vz: number; saldo: number }): Uint8Array {
  const b = new Brief(abs);
  b.kopf([r.nutzer.name], new Date().toISOString().slice(0, 10));
  b.betreff(`Betriebs- und Heizkostenabrechnung ${jahr}`);
  b.absatz(`Objekt: ${o.name}, ${[o.strasse, [o.plz, o.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')} · Einheit ${r.einheit.nummer}` +
    `${r.einheit.flaeche ? `, ${num(r.einheit.flaeche)} m²` : ''}\nAbrechnungszeitraum: 01.01.${jahr} bis 31.12.${jahr} · Ihr Nutzungszeitraum: ${dDatum(r.nutzer.von)} bis ${dDatum(r.nutzer.bis)} (${r.nutzer.tage} Tage)`);
  const body = r.zeilen.map((z) => [z.pos.name, geld(z.pos.betrag), z.pos.schluessel === 'Messdienst' ? 'lt. Messdienst' : z.pos.schluessel,
    `${basisFmt(z.pos.schluessel, z.gesamtBasis)} ${einheitText[z.pos.schluessel] ?? ''}`, basisFmt(z.pos.schluessel, z.nutzerBasis), geld(z.betrag)]);
  b.tabelle(['Kostenart', 'Gesamtkosten', 'Schlüssel', 'Gesamt', 'Ihr Anteil', 'Ihre Kosten'], body,
    [['Summe Ihrer Kosten', '', '', '', '', geld(r.summe)], ['abzüglich Ihrer Vorauszahlungen', '', '', '', '', geld(-r.vz)],
      [r.saldo > 0 ? 'Nachzahlung' : 'Guthaben', '', '', '', '', geld(Math.abs(r.saldo))]], 1);
  b.absatz(r.saldo > 0
    ? `Bitte überweisen Sie die Nachzahlung von ${geld(r.saldo)} innerhalb von 30 Tagen nach Erhalt dieser Abrechnung.`
    : `Ihr Guthaben von ${geld(Math.abs(r.saldo))} erstatten wir Ihnen bzw. verrechnen es mit der nächsten Miete.`);
  if (r.hdl || r.hwl) {
    b.absatz('Bescheinigung nach § 35a EStG: In Ihren Kosten sind folgende Anteile enthalten (Arbeitskosten laut Rechnungen):', 2);
    b.tabelle(['Art', 'Betrag'], [['Haushaltsnahe Dienstleistungen (§ 35a Abs. 2)', geld(r.hdl)], ['Handwerkerleistungen (§ 35a Abs. 3)', geld(r.hwl)]]);
  }
  b.absatz('Belege können nach Terminvereinbarung bei uns eingesehen werden. Einwendungen gegen diese Abrechnung sind innerhalb von zwölf Monaten nach Zugang mitzuteilen.');
  b.gruss();
  return b.bytes();
}
