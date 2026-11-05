// WEG-Jahresabrechnung (Gesamtabrechnung, Einzelabrechnungen, Vermögensbericht)
// und jährliche Eigentümerabrechnung für die Mietverwaltung.
import { useEffect, useState } from 'react';
import { db, type Row } from '../db';
import { wid } from '../db/labels';
import { AbrechnungsUebersicht } from '../components/AbrechnungsUebersicht';
import { SchluesselWahl } from '../components/SchluesselWahl';
import { useObjektKontext } from '../logic/objektKontext';
import { eur, num, datum } from '../components/EntityTable';
import { eigeneSchluessel, kostenErmitteln, nutzerErmitteln, verteilen, type Ergebnis, type Position } from '../logic/verteilung';
import { Brief, absender, dDatum, geld } from '../lib/pdf';
import { oeffnen, speichern } from '../lib/dateien';
import { WerteJeEinheit } from '../components/WerteJeEinheit';
import { ruecklageJahr } from '../logic/ruecklage';
import { nkBerechnen } from '../logic/nebenkosten';

const RUECKLAGE = ['1260', '1261', '1262'];
const HEIZ_KONTO = '1200';
const r2 = (n: number) => Math.round(n * 100) / 100;

function useObjekte(art: 'WEG' | 'Mietverwaltung') {
  const fix = useObjektKontext();
  const [objekte, setObjekte] = useState<Row[]>([]);
  const [objekt, setObjekt] = useState<number | ''>(fix?.id ?? '');
  useEffect(() => {
    db.select(fix ? 'SELECT * FROM objekte WHERE id = $1' : 'SELECT * FROM objekte WHERE verwaltungsart = $1 ORDER BY name', [fix ? fix.id : art])
      .then((o) => { setObjekte(o); if (o.length && !fix) setObjekt(o[0].id); });
  }, []);
  return { objekte, objekt, setObjekt, o: objekte.find((x) => x.id === objekt) };
}

function Kopf({ titel, text, objekte, objekt, setObjekt, jahr, setJahr, children }: any) {
  const fix = useObjektKontext();
  return (
    <>
      <div className="page-head"><h1>{titel}</h1><p className="muted">{text}</p></div>
      <section className="card row">
        {!fix && <select style={{ width: 300 }} value={objekt} onChange={(e) => setObjekt(Number(e.target.value))}>
          {objekte.map((o: Row) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>}
        <label className="inline">Jahr <input type="number" style={{ width: 90 }} value={jahr} onChange={(e) => setJahr(Number(e.target.value))} /></label>
        <span className="grow" />
        {children}
      </section>
    </>
  );
}

/* =================== WEG-Jahresabrechnung =================== */

interface Einzel extends Ergebnis { soll: number; ist: number; ruecklageSoll: number; vorschuss: number; spitze: number; rueckstand: number;
  mieter?: { name: string; kosten: number; vz: number; saldo: number; ueberEigentuemer: boolean } }

export function WegAbrechnungPage() {
  const { objekte, objekt, setObjekt, o } = useObjekte('WEG');
  const [jahr, setJahr] = useState(new Date().getFullYear() - 1);
  const [pos, setPos] = useState<Position[]>([]);
  const [erg, setErg] = useState<Einzel[]>([]);
  const [verm, setVerm] = useState<Row>({});
  const [info, setInfo] = useState('');
  const [einheiten, setEinheiten] = useState<Row[]>([]);
  const [stand, setStand] = useState(0);
  const anteile = (kontoId: number) => {
    const m: Record<number, number> = {};
    for (const r of erg) for (const z of r.zeilen) if (z.pos.konto_id === kontoId) m[r.nutzer.einheit_id] = (m[r.nutzer.einheit_id] ?? 0) + z.betrag;
    return m;
  };

  async function rechnen() {
    if (objekt === '') return;
    const { einheiten, nutzer } = await nutzerErmitteln(Number(objekt), jahr, 'Eigentümer');
    setEinheiten(einheiten);
    const eigene = await eigeneSchluessel(Number(objekt), jahr);
    const h = await db.select(`SELECT h.* FROM heizkosten_ergebnisse h JOIN einheiten e ON e.id = h.einheit_id WHERE e.objekt_id = $1 AND h.jahr = $2`, [objekt, jahr]);
    const messdienst = Object.fromEntries(h.map((x) => [x.einheit_id, Number(x.heizkosten) + Number(x.warmwasser)]));
    const v = await db.select(`SELECT v.* FROM verbrauch v JOIN einheiten e ON e.id = v.einheit_id WHERE e.objekt_id = $1 AND v.jahr = $2`, [objekt, jahr]);
    const verbrauch = Object.fromEntries(v.map((x) => [`${x.einheit_id}-${x.buchungskonto_id}`, Number(x.menge)]));
    // In der WEG gilt MEA, solange für das Objekt kein eigener Schlüssel eingestellt ist
    const p = (await kostenErmitteln(Number(objekt), jahr, false))
      .filter((x) => !RUECKLAGE.includes(x.nummer))
      .map((x) => ({ ...x, schluessel: x.nummer === HEIZ_KONTO && h.length ? 'Messdienst' as const : eigene.has(x.konto_id) ? x.schluessel : 'MEA' as const }));
    setPos(p);
    const hg = await db.select(`SELECT s.person_id, s.einheit_id, SUM(s.betrag) AS soll,
        SUM(COALESCE((SELECT SUM(b.betrag) FROM buchungen b WHERE b.sollstellung_id = s.id), 0)) AS ist
      FROM sollstellungen s WHERE s.art IN ('Hausgeld', 'Rücklage') AND substr(s.monat, 1, 4) = $1 GROUP BY s.person_id, s.einheit_id`, [String(jahr)]);
    const saetze = await db.select('SELECT * FROM hausgeld ORDER BY gueltig_ab');
    // Tatsächlich gestellte Hausgeld-/Rücklage-Posten je Monat: Rücklage wird nur dort abgezogen, wo auch Hausgeld gefordert wurde
    const gestellt = await db.select(`SELECT person_id, einheit_id, monat, art, SUM(betrag) AS betrag FROM sollstellungen
      WHERE art IN ('Hausgeld', 'Rücklage') AND vertrag_id IS NULL AND substr(monat, 1, 4) = $1 GROUP BY person_id, einheit_id, monat, art`, [String(jahr)]);
    // Vermietete Einheiten: Nebenkostenabrechnung der Mieter (umlagefähige Kosten gegen deren Vorauszahlungen)
    const nk = (await nkBerechnen(Number(objekt), jahr)).erg.filter((x) => x.nutzer.art === 'Mieter');
    const res = verteilen(jahr, einheiten, nutzer, p, { verbrauch, messdienst }).map((r): Einzel => {
      const x = hg.find((y) => y.person_id === r.nutzer.person_id && y.einheit_id === r.nutzer.einheit_id) ?? { soll: 0, ist: 0 };
      // Rücklagenanteil im Hausgeld (Soll) für die Monate des Eigentümers
      let rs = 0;
      for (let m = 1; m <= 12; m++) {
        const monat = `${jahr}-${String(m).padStart(2, '0')}`, tag1 = `${monat}-01`;
        if (tag1 < r.nutzer.von.slice(0, 8) + '01' || tag1 > r.nutzer.bis) continue;
        const g = gestellt.filter((y) => y.monat === monat && y.einheit_id === r.nutzer.einheit_id && y.person_id === r.nutzer.person_id);
        const eigen = g.find((y) => y.art === 'Rücklage');
        if (eigen) { rs += Number(eigen.betrag) || 0; continue; }   // getrennt gestellt
        if (!g.some((y) => y.art === 'Hausgeld')) continue;           // kein Hausgeld gefordert, also auch keine Rücklage abziehen
        const s = [...saetze].reverse().find((h) => h.einheit_id === r.nutzer.einheit_id && h.gueltig_ab <= tag1);
        rs += Math.min(Number(s?.davon_ruecklage) || 0, Number(g.find((y) => y.art === 'Hausgeld')?.betrag) || 0);
      }
      const vorschuss = r2(Number(x.soll) - rs);
      const m = nk.filter((y) => y.nutzer.einheit_id === r.nutzer.einheit_id);
      const mieter = m.length ? { name: m.map((y) => y.nutzer.name).join(', '), kosten: r2(m.reduce((a, y) => a + y.summe, 0)), vz: r2(m.reduce((a, y) => a + y.vz, 0)),
        saldo: r2(m.reduce((a, y) => a + y.saldo, 0)), ueberEigentuemer: m.some((y) => y.ueberEigentuemer) } : undefined;
      return { ...r, mieter, soll: r2(Number(x.soll)), ist: r2(Number(x.ist)), ruecklageSoll: r2(rs), vorschuss, spitze: r2(r.summe - vorschuss), rueckstand: r2(Number(x.soll) - Number(x.ist)) };
    });
    setErg(res);
    // Vermögensbericht
    const ende = `${jahr}-12-31`;
    const rl = await ruecklageJahr(Number(objekt), jahr);
    const zufJahr = res.reduce((a, r) => a + r.ruecklageSoll, 0);
    const banken = await db.select(`SELECT b.*, b.anfangssaldo + COALESCE((SELECT SUM(u.betrag) FROM bankumsaetze u WHERE u.bankkonto_id = b.id
      AND u.datum <= $2 AND (b.saldo_datum IS NULL OR u.datum > b.saldo_datum)), 0) AS saldo FROM bankkonten b WHERE b.objekt_id = $1`, [objekt, ende]);
    const rueckstaende = (await db.select(`SELECT COALESCE(SUM(s.betrag - COALESCE((SELECT SUM(b.betrag) FROM buchungen b WHERE b.sollstellung_id = s.id), 0)), 0) AS x
      FROM sollstellungen s JOIN einheiten e ON e.id = s.einheit_id WHERE e.objekt_id = $1 AND s.faellig <= $2`, [objekt, ende]))[0].x;
    setVerm({ ruecklage: rl.bestand, zufJahr, entnahmeJahr: rl.entnahme, zinsJahr: rl.zinsen, banken, rueckstaende: Number(rueckstaende) });
  }
  useEffect(() => { if (jahr >= 1900 && jahr <= 2200) rechnen(); }, [objekt, jahr]);

  async function pdfs() {
    if (!o) return;
    const abs = await absender();
    const ordner = [o.name, 'WEG-Jahresabrechnung', String(jahr)];
    // Gesamtabrechnung und Vermögensbericht
    const g = new Brief(abs);
    g.kopf([`Wohnungseigentümergemeinschaft ${o.name.replace(/^WEG\s+/i, '')}`, o.strasse, [o.plz, o.ort].filter(Boolean).join(' ')], new Date().toISOString().slice(0, 10));
    g.betreff(`Gesamtabrechnung ${jahr} (Wirtschaftsjahr 01.01.–31.12.${jahr})`);
    g.tabelle(['Konto', 'Kostenart', 'Schlüssel', 'Betrag'], pos.map((p) => [p.nummer, p.name, p.schluessel, geld(p.betrag)]),
      [['', 'Summe Ausgaben', '', geld(pos.reduce((a, p) => a + p.betrag, 0))]], 3);
    g.tabelle(['Einheit', 'Eigentümer', 'Kostenanteil', 'Vorschüsse (Soll)', 'Abrechnungsspitze'],
      erg.map((r) => [r.einheit.nummer, r.nutzer.name, geld(r.summe), geld(r.vorschuss), geld(r.spitze)]), undefined, 2);
    g.betreff(`Vermögensbericht zum 31.12.${jahr}`);
    g.tabelle(['Position', 'Betrag'], [
      ['Erhaltungsrücklage zum 31.12.', geld(verm.ruecklage ?? 0)],
      ['davon Zuführung im Jahr (Soll)', geld(verm.zufJahr ?? 0)],
      ['davon Entnahmen im Jahr', geld(-(verm.entnahmeJahr ?? 0))],
      ['davon Zinserträge im Jahr', geld(verm.zinsJahr ?? 0)],
      ...(verm.banken ?? []).map((b: Row) => [`Kontostand ${b.name} (${b.iban ?? ''})`, geld(Number(b.saldo))]),
      ['Offene Forderungen gegen Eigentümer', geld(verm.rueckstaende ?? 0)],
    ]);
    g.gruss();
    await speichern(g.bytes(), `Gesamtabrechnung und Vermögensbericht ${jahr}.pdf`, { bezug: 'Objekt', bezugId: o.id, ordner });
    // Einzelabrechnungen
    for (const r of erg) {
      const p = (await db.select('SELECT * FROM personen WHERE id = $1', [r.nutzer.person_id]))[0] ?? {};
      const b = new Brief(abs);
      b.kopf([p.firma, [p.anrede === 'Firma' ? '' : p.anrede, p.titel, p.vorname, p.nachname].filter(Boolean).join(' '), p.strasse, [p.plz, p.ort].filter(Boolean).join(' ')], new Date().toISOString().slice(0, 10));
      b.betreff(`Einzelabrechnung ${jahr}: ${/^weg\b/i.test(o.name) ? '' : 'WEG '}${o.name}, Einheit ${r.einheit.nummer}${wid(o.objekt_nr, r.einheit.lfd_nr) ? ` (W-ID ${wid(o.objekt_nr, r.einheit.lfd_nr)})` : ''}`);
      b.absatz(`Miteigentumsanteil: ${num(r.einheit.mea, 0)} / ${num(o.gesamt_mea, 0)} · Fläche ${num(r.einheit.flaeche)} m² · Eigentum im Jahr: ${dDatum(r.nutzer.von)} bis ${dDatum(r.nutzer.bis)}`);
      for (const [titel, filter] of [['Umlagefähige Kosten (für Ihre Betriebskostenabrechnung an Mieter)', true], ['Nicht umlagefähige Kosten', false]] as const) {
        const z = r.zeilen.filter((x) => x.pos.umlagefaehig === filter && Math.abs(x.betrag) > 0.004);
        if (!z.length) continue;
        b.absatz(titel, 1);
        b.tabelle(['Kostenart', 'Gesamt', 'Schlüssel', 'Ihr Anteil'], z.map((x) => [x.pos.name, geld(x.pos.betrag), x.pos.schluessel, geld(x.betrag)]),
          [['Zwischensumme', '', '', geld(z.reduce((a, x) => a + x.betrag, 0))]], 1);
      }
      b.tabelle(['Ergebnis', 'Betrag'], [
        ['Ihr Kostenanteil gesamt', geld(r.summe)],
        ['Hausgeld-Vorschüsse laut Wirtschaftsplan (Soll)', geld(r.soll)],
        ['abzüglich Zuführung Erhaltungsrücklage', geld(-r.ruecklageSoll)],
        ['Vorschüsse für Bewirtschaftung (ohne Rücklage)', geld(r.vorschuss)],
      ], [[r.spitze > 0 ? 'Nachschuss (Abrechnungsspitze)' : 'Erstattung (Abrechnungsspitze)', geld(Math.abs(r.spitze))]]);
      if (r.mieter) {
        b.absatz(`Ihre Einheit ist vermietet (${r.mieter.name})`, 1);
        b.tabelle(['Verrechnung mit Ihrem Mieter (Nebenkostenabrechnung)', 'Betrag'], [
          ['Umlagefähige Kosten für den Mietzeitraum', geld(r.mieter.kosten)],
          [r.mieter.ueberEigentuemer ? 'Vorauszahlungen des Mieters laut Mietvertrag (an Sie gezahlt)' : 'Vorauszahlungen des Mieters', geld(r.mieter.vz)],
        ], [[r.mieter.saldo > 0 ? 'Nachzahlung des Mieters' : 'Guthaben des Mieters', geld(Math.abs(r.mieter.saldo))]]);
        b.absatz(r.mieter.ueberEigentuemer
          ? `Die Nebenkostenabrechnung für Ihren Mieter erstellen wir gesondert. Die ${r.mieter.saldo > 0 ? 'Nachzahlung zahlt der Mieter an Sie' : 'Erstattung an den Mieter leisten Sie'}.`
          : 'Die Nebenkostenabrechnung für Ihren Mieter erstellen und buchen wir gesondert.');
      }
      if (r.rueckstand > 0.005) b.absatz(`Hinweis: Aus dem Jahr ${jahr} sind noch Hausgeldzahlungen von ${geld(r.rueckstand)} offen. Diese sind unabhängig von der Abrechnungsspitze zu zahlen.`);
      if (r.hdl || r.hwl) b.tabelle(['§ 35a EStG (Ihr Anteil)', 'Betrag'], [['Haushaltsnahe Dienstleistungen', geld(r.hdl)], ['Handwerkerleistungen', geld(r.hwl)]]);
      b.absatz('Die Abrechnung wird der Eigentümerversammlung zur Beschlussfassung über die Nachschüsse bzw. Anpassung der Vorschüsse vorgelegt (§ 28 Abs. 2 WEG).');
      b.gruss();
      await speichern(b.bytes(), `Einzelabrechnung ${jahr} ${r.einheit.nummer} ${r.nutzer.name}.pdf`, { bezug: 'Objekt', bezugId: o.id, ordner });
    }
    setInfo(`Gesamtabrechnung, Vermögensbericht und ${erg.length} Einzelabrechnungen abgelegt unter ${ordner.join('/')}.`);
  }

  async function buchen() {
    let n = 0;
    const f = new Date(); f.setDate(f.getDate() + 30);
    for (const r of erg.filter((x) => Math.abs(x.spitze) > 0.005)) {
      n += (await db.execute(`INSERT OR IGNORE INTO sollstellungen (einheit_id, person_id, monat, art, betrag, faellig) VALUES ($1, $2, $3, 'WEG-Abrechnung', $4, $5)`,
        [r.nutzer.einheit_id, r.nutzer.person_id, `${jahr}-JA`, r.spitze, f.toISOString().slice(0, 10)])).rowsAffected;
    }
    setInfo(n ? `${n} Nachschüsse/Erstattungen als offene Posten gebucht (nach Beschluss der Versammlung).` : 'Bereits gebucht.');
  }

  return (
    <>
      <Kopf titel="WEG-Jahresabrechnung" text="Gesamtabrechnung, Einzelabrechnungen je Eigentümer und Vermögensbericht nach § 28 WEG"
        {...{ objekte, objekt, setObjekt, jahr, setJahr }}>
        <button onClick={pdfs} disabled={!erg.length}>Alle PDFs erstellen</button>
        <button className="primary" onClick={buchen} disabled={!erg.length}>Abrechnungsspitzen buchen</button>
      </Kopf>
      {!objekte.length && <p className="muted">Noch keine WEG angelegt.</p>}
      {info && <p className="info">{info}</p>}
      <div className="kpis">
        <div className="kpi"><span>Ausgaben {jahr}</span><b className="neg">{eur(pos.reduce((a, p) => a + p.betrag, 0))}</b></div>
        <div className="kpi"><span>Hausgeld Soll / Ist</span><b>{eur(erg.reduce((a, r) => a + r.soll, 0))}</b><small>gezahlt {eur(erg.reduce((a, r) => a + r.ist, 0))}</small></div>
        <div className="kpi"><span>Erhaltungsrücklage 31.12.</span><b>{eur(verm.ruecklage ?? 0)}</b><small>Zuführung {eur(verm.zufJahr ?? 0)}</small></div>
        <div className="kpi"><span>Summe Abrechnungsspitzen</span><b>{eur(erg.reduce((a, r) => a + r.spitze, 0))}</b></div>
      </div>
      {objekt !== '' && <AbrechnungsUebersicht objekt={Number(objekt)} jahr={jahr} pos={pos} stand={stand} titel={`Gesamtabrechnung ${jahr}: Übersicht der Buchungskonten`}
        onChanged={(t) => { setInfo(t); setStand(stand + 1); rechnen(); }}
        schluessel={(p) => <SchluesselWahl objekt={Number(objekt)} jahr={jahr} p={p} anteile={anteile} onChanged={(t) => { setInfo(t); setStand(stand + 1); rechnen(); }} />} />}
      {objekt !== '' && <WerteJeEinheit key={`${objekt}-${jahr}-${stand}`} objekt={Number(objekt)} jahr={jahr} einheiten={einheiten}
        konten={pos.filter((p) => p.schluessel === 'Summe' || p.schluessel === 'Verbrauch')} onSaved={() => { setInfo('Eingaben gespeichert und neu berechnet.'); rechnen(); }} />}
      <section className="card">
        <div className="card-head"><h2>Einzelabrechnungen</h2></div>
        <table className="list">
          <thead><tr><th>Einheit</th><th>Eigentümer</th><th>Zeitraum</th><th className="num">Kostenanteil</th><th className="num">davon umlagefähig</th><th className="num">Hausgeld-Soll</th><th className="num">abzgl. Rücklage</th><th className="num">Vorschüsse (ohne Rücklage)</th><th className="num">Abrechnungsspitze</th><th className="num">Rückstand Hausgeld</th><th>Mieter (NK-Abrechnung)</th></tr></thead>
          <tbody>{erg.map((r) => (
            <tr key={r.nutzer.key}>
              <td>{r.einheit.nummer}</td><td>{r.nutzer.name}</td><td className="small">{datum(r.nutzer.von)} – {datum(r.nutzer.bis)}</td>
              <td className="num">{eur(r.summe)}</td><td className="num">{eur(r.zeilen.filter((z) => z.pos.umlagefaehig).reduce((a, z) => a + z.betrag, 0))}</td>
              <td className="num">{eur(r.soll)}</td><td className="num">{eur(-r.ruecklageSoll)}</td><td className="num">{eur(r.vorschuss)}</td>
              <td className={'num ' + (r.spitze > 0 ? 'neg' : 'pos')}><b>{r.spitze > 0 ? 'Nachschuss ' : 'Erstattung '}{eur(Math.abs(r.spitze))}</b></td>
              <td className={'num ' + (r.rueckstand > 0.005 ? 'neg' : '')}>{eur(r.rueckstand)}</td>
              <td className="small">{r.mieter ? <>{r.mieter.name}<div className="muted">VZ {eur(r.mieter.vz)} · {r.mieter.saldo > 0 ? 'Nachzahlung' : 'Guthaben'} {eur(Math.abs(r.mieter.saldo))}</div></> : <span className="muted">selbst genutzt</span>}</td>
            </tr>))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <div className="card-head"><h2>Vermögensbericht zum 31.12.{jahr}</h2></div>
        <table className="list"><tbody>
          <tr><td>Erhaltungsrücklage</td><td className="num"><b>{eur(verm.ruecklage ?? 0)}</b></td></tr>
          <tr><td className="muted">Zuführung {jahr} (Soll) / Entnahmen / Zinsen</td><td className="num muted">{eur(verm.zufJahr ?? 0)} / {eur(verm.entnahmeJahr ?? 0)} / {eur(verm.zinsJahr ?? 0)}</td></tr>
          {(verm.banken ?? []).map((b: Row) => <tr key={b.id}><td>Kontostand {b.name}</td><td className="num">{eur(Number(b.saldo))}</td></tr>)}
          <tr><td>Offene Forderungen gegen Eigentümer</td><td className="num">{eur(verm.rueckstaende ?? 0)}</td></tr>
        </tbody></table>
      </section>
    </>
  );
}

/* =================== Eigentümerabrechnung (Mietverwaltung) =================== */

export function EigentuemerAbrechnungPage() {
  const { objekte, objekt, setObjekt, o } = useObjekte('Mietverwaltung');
  const [jahr, setJahr] = useState(new Date().getFullYear() - 1);
  const [ein, setEin] = useState<Row[]>([]);
  const [aus, setAus] = useState<Position[]>([]);
  const [offen, setOffen] = useState(0);
  const [info, setInfo] = useState('');

  useEffect(() => {
    if (objekt === '') return;
    (async () => {
      setEin(await db.select(`SELECT k.nummer, k.name, SUM(b.betrag) AS betrag FROM buchungen b JOIN buchungskonten k ON k.id = b.buchungskonto_id
        WHERE b.objekt_id = $1 AND k.art = 'Einnahme' AND substr(b.datum, 1, 4) = $2 GROUP BY k.id ORDER BY k.nummer`, [objekt, String(jahr)]));
      setAus(await kostenErmitteln(Number(objekt), jahr, false));
      setOffen(Number((await db.select(`SELECT COALESCE(SUM(s.betrag - COALESCE((SELECT SUM(b.betrag) FROM buchungen b WHERE b.sollstellung_id = s.id), 0)), 0) AS x
        FROM sollstellungen s JOIN einheiten e ON e.id = s.einheit_id WHERE e.objekt_id = $1 AND s.faellig <= $2`, [objekt, `${jahr}-12-31`]))[0].x));
    })();
  }, [objekt, jahr]);

  const summeEin = ein.reduce((a, x) => a + Number(x.betrag), 0);
  const uml = aus.filter((p) => p.umlagefaehig), nicht = aus.filter((p) => !p.umlagefaehig);
  const sU = uml.reduce((a, p) => a + p.betrag, 0), sN = nicht.reduce((a, p) => a + p.betrag, 0);
  const hdl = aus.filter((p) => p.hdl).reduce((a, p) => a + p.betrag, 0), hwl = aus.filter((p) => p.hwl).reduce((a, p) => a + p.betrag, 0);

  async function pdf() {
    if (!o) return;
    const p = (await db.select('SELECT * FROM personen WHERE id = $1', [o.eigentuemer_id]))[0] ?? {};
    const b = new Brief(await absender());
    b.kopf([p.firma, [p.anrede === 'Firma' ? '' : p.anrede, p.titel, p.vorname, p.nachname].filter(Boolean).join(' '), p.strasse, [p.plz, p.ort].filter(Boolean).join(' ')], new Date().toISOString().slice(0, 10));
    b.betreff(`Eigentümerabrechnung ${jahr}: ${o.name}`);
    b.absatz(`Abrechnungszeitraum 01.01.${jahr} bis 31.12.${jahr}. Nachfolgend erhalten Sie die Übersicht über Einnahmen und Ausgaben Ihres Objekts.`);
    b.tabelle(['Einnahmen', 'Betrag'], ein.map((x) => [`${x.nummer} ${x.name}`, geld(Number(x.betrag))]), [['Summe Einnahmen', geld(summeEin)]]);
    b.tabelle(['Umlagefähige Kosten', 'Betrag'], uml.map((x) => [`${x.nummer} ${x.name}`, geld(x.betrag)]), [['Summe umlagefähig', geld(sU)]]);
    b.tabelle(['Nicht umlagefähige Kosten', 'Betrag'], nicht.map((x) => [`${x.nummer} ${x.name}`, geld(x.betrag)]), [['Summe nicht umlagefähig', geld(sN)]]);
    b.tabelle(['Ergebnis', 'Betrag'], [['Einnahmen', geld(summeEin)], ['Ausgaben gesamt', geld(-(sU + sN))]], [['Überschuss / Fehlbetrag', geld(summeEin - sU - sN)]]);
    b.tabelle(['Weitere Angaben', 'Betrag'], [['Offene Mietforderungen zum 31.12.', geld(offen)], ['§ 35a haushaltsnahe Dienstleistungen', geld(hdl)], ['§ 35a Handwerkerleistungen', geld(hwl)]]);
    b.gruss();
    const pfad = await speichern(b.bytes(), `Eigentümerabrechnung ${jahr} ${o.name}.pdf`, { bezug: 'Objekt', bezugId: o.id, ordner: [o.name, 'Eigentümerabrechnungen'] });
    setInfo(`Abrechnung abgelegt: ${pfad}`);
    oeffnen(pfad);
  }

  return (
    <>
      <Kopf titel="Eigentümerabrechnung" text="Jährliche Abrechnung für den Eigentümer: Einnahmen, umlagefähige und nicht umlagefähige Kosten"
        {...{ objekte, objekt, setObjekt, jahr, setJahr }}>
        <button className="primary" onClick={pdf} disabled={!o}>PDF erstellen</button>
      </Kopf>
      {info && <p className="info">{info}</p>}
      <div className="kpis">
        <div className="kpi"><span>Einnahmen</span><b>{eur(summeEin)}</b></div>
        <div className="kpi"><span>Umlagefähige Kosten</span><b className="neg">{eur(sU)}</b></div>
        <div className="kpi"><span>Nicht umlagefähige Kosten</span><b className="neg">{eur(sN)}</b></div>
        <div className="kpi"><span>Überschuss</span><b className={summeEin - sU - sN < 0 ? 'neg' : ''}>{eur(summeEin - sU - sN)}</b></div>
      </div>
      <div className="grid2">
        {[['Einnahmen', ein.map((x) => ({ k: x.nummer, n: x.name, b: Number(x.betrag) }))], ['Umlagefähige Kosten', uml.map((x) => ({ k: x.nummer, n: x.name, b: x.betrag }))],
          ['Nicht umlagefähige Kosten', nicht.map((x) => ({ k: x.nummer, n: x.name, b: x.betrag }))]].map(([t, rows]: any) => (
          <section className="card" key={t}>
            <div className="card-head"><h2>{t}</h2></div>
            {rows.length === 0 ? <p className="muted">Keine Buchungen im Jahr {jahr}.</p> : (
              <table className="list"><tbody>{rows.map((x: any) => <tr key={x.k}><td>{x.k}</td><td>{x.n}</td><td className="num">{eur(x.b)}</td></tr>)}</tbody></table>)}
          </section>))}
        <section className="card">
          <div className="card-head"><h2>Weitere Angaben</h2></div>
          <table className="list"><tbody>
            <tr><td>Offene Mietforderungen zum 31.12.{jahr}</td><td className="num">{eur(offen)}</td></tr>
            <tr><td>§ 35a haushaltsnahe Dienstleistungen</td><td className="num">{eur(hdl)}</td></tr>
            <tr><td>§ 35a Handwerkerleistungen</td><td className="num">{eur(hwl)}</td></tr>
          </tbody></table>
        </section>
      </div>
    </>
  );
}
