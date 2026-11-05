// Nebenkostenabrechnung je Objekt und Kalenderjahr (Mietverwaltung und vermietete WEG-Einheiten).
import { useEffect, useState } from 'react';
import { db, type Row } from '../db';
import { wid } from '../db/labels';
import { AbrechnungsUebersicht } from '../components/AbrechnungsUebersicht';
import { SchluesselWahl, schluesselText } from '../components/SchluesselWahl';
import { AbschlussKarte } from '../components/AbschlussKarte';
import { useObjektKontext } from '../logic/objektKontext';
import { eur, num, datum } from '../components/EntityTable';
import { tageImJahr, type Position, type Schluessel } from '../logic/verteilung';
import { HEIZ_KONTO, nkBerechnen, type NkErgebnis } from '../logic/nebenkosten';
import { Brief, absender, dDatum, geld } from '../lib/pdf';
import { oeffnen, speichern } from '../lib/dateien';

const einheitText: Record<string, string> = { Fläche: 'm²', MEA: 'MEA', Einheiten: 'Einh.', Personen: 'Pers.-Tage', Verbrauch: 'Verbr.', Messdienst: '€ lt. Messdienst', Direkt: '€', Summe: '€' };
const basisFmt = (s: Schluessel, v: number) => (s === 'Personen' ? num(v, 0) : s === 'Einheiten' ? num(v, 3) : num(v, 2));

export function NebenkostenPage() {
  const fix = useObjektKontext();
  const [objekte, setObjekte] = useState<Row[]>([]);
  const [objekt, setObjekt] = useState<number | ''>(fix?.id ?? '');
  const [jahr, setJahr] = useState(new Date().getFullYear() - 1);
  const [einheiten, setEinheiten] = useState<Row[]>([]);
  const [pos, setPos] = useState<Position[]>([]);
  const [erg, setErg] = useState<NkErgebnis[]>([]);
  const [heiz, setHeiz] = useState<Record<number, { heizkosten: string; warmwasser: string }>>({});
  const [verbr, setVerbr] = useState<Record<string, string>>({});
  const [info, setInfo] = useState('');
  const [, setBusy] = useState(false);
  const [zu, setZu] = useState<Row | null>(null);
  const [stand, setStand] = useState(0);

  useEffect(() => {
    db.select(`SELECT * FROM objekte ORDER BY verwaltungsart, name`).then((o) => { setObjekte(o); if (o.length && !fix) setObjekt(o[0].id); });
  }, []);

  async function laden() {
    if (objekt === '') return;
    const h = await db.select(`SELECT h.* FROM heizkosten_ergebnisse h JOIN einheiten e ON e.id = h.einheit_id WHERE e.objekt_id = $1 AND h.jahr = $2`, [objekt, jahr]);
    setHeiz(Object.fromEntries(h.map((x) => [x.einheit_id, { heizkosten: String(x.heizkosten ?? ''), warmwasser: String(x.warmwasser ?? '') }])));
    const v = await db.select(`SELECT v.* FROM verbrauch v JOIN einheiten e ON e.id = v.einheit_id WHERE e.objekt_id = $1 AND v.jahr = $2`, [objekt, jahr]);
    setVerbr(Object.fromEntries(v.map((x) => [`${x.einheit_id}-${x.buchungskonto_id}`, String(x.menge).replace('.', ',')])));
    await rechnen();
  }
  useEffect(() => { if (jahr >= 1900 && jahr <= 2200) laden(); }, [objekt, jahr]);

  async function rechnen() {
    if (objekt === '') return;
    const r = await nkBerechnen(Number(objekt), jahr);
    setEinheiten(r.einheiten); setPos(r.positionen); setErg(r.erg);
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
    setInfo('Eingaben gespeichert und neu berechnet.'); setStand((x) => x + 1);
    await rechnen();
  }

  /** Alle Mieter-Abrechnungen in einem PDF (Vorschau) */
  async function vorschauPdf(entwurf: boolean): Promise<Uint8Array> {
    const o = objekte.find((x) => x.id === objekt)!;
    const b = new Brief(await absender());
    for (const r of erg.filter((x) => x.nutzer.art === 'Mieter')) abrechnungPdf(b.neuerBrief(), o, jahr, r, await vermieter(r.einheit.id, jahr));
    return (entwurf ? b.entwurf() : b).bytes();
  }

  async function pdfs() {
    setBusy(true);
    try {
      const o = objekte.find((x) => x.id === objekt)!;
      const abs = await absender();
      let n = 0, letzter = '';
      for (const r of erg.filter((x) => x.nutzer.art === 'Mieter')) {
        letzter = await speichern(abrechnungPdf(new Brief(abs), o, jahr, r, await vermieter(r.einheit.id, jahr)).bytes(), `NK-Abrechnung ${jahr} ${r.einheit.nummer} ${r.nutzer.name}.pdf`,
          { bezug: 'Objekt', bezugId: o.id, ordner: [o.name, 'Nebenkostenabrechnungen', String(jahr)] });
        n++;
      }
      setInfo(`${n} Abrechnungen erstellt und abgelegt unter ${o.name}/Nebenkostenabrechnungen/${jahr}.`);
      if (n === 1) oeffnen(letzter);
    } catch (e: any) { setInfo('Fehler: ' + (e?.message ?? e)); } finally { setBusy(false); }
  }

  async function buchen() {
    let n = 0;
    // Zahlt der Mieter an den Eigentümer, rechnet der Eigentümer das Ergebnis mit ihm ab: kein offener Posten bei uns
    for (const r of erg.filter((x) => x.nutzer.art === 'Mieter' && !x.ueberEigentuemer && Math.abs(x.saldo) > 0.005)) {
      const f = new Date(); f.setDate(f.getDate() + 30);
      const res = await db.execute(`INSERT OR IGNORE INTO sollstellungen (vertrag_id, einheit_id, person_id, monat, art, betrag, faellig)
        VALUES ($1, $2, $3, $4, 'NK-Abrechnung', $5, $6)`, [r.nutzer.vertrag_id ?? null, r.nutzer.einheit_id, r.nutzer.person_id, `${jahr}-NK`, r.saldo, f.toISOString().slice(0, 10)]);
      n += res.rowsAffected;
    }
    await db.execute(`INSERT INTO abrechnungen (objekt_id, art, jahr, status) VALUES ($1, 'Nebenkosten', $2, 'Gebucht')`, [objekt, jahr]);
    const ueber = erg.filter((x) => x.ueberEigentuemer).length;
    setInfo((n ? `${n} Nachzahlungen/Guthaben als offene Posten gebucht (fällig in 30 Tagen).` : 'Keine neuen offenen Posten.') +
      (ueber ? ` ${ueber} Mieter zahlen an ihren Eigentümer, deren Ergebnis wird dort verrechnet und nicht bei uns gebucht.` : ''));
  }

  const kosten = pos.reduce((a, p) => a + p.betrag, 0);
  const verbrauchsKonten = pos.filter((p) => p.schluessel === 'Verbrauch' || p.schluessel === 'Summe');
  const summenAbweichung = pos.filter((p) => p.schluessel === 'Summe').map((p) => ({ p, s: einheiten.reduce((a, e) => a + zahl(verbr[`${e.id}-${p.konto_id}`] ?? '0'), 0) }))
    .filter((x) => Math.abs(x.s - x.p.betrag) > 0.005);
  const mieter = erg.filter((r) => r.nutzer.art === 'Mieter');
  const leer = erg.filter((r) => r.nutzer.art === 'Leerstand');
  const weg = objekte.find((x) => x.id === objekt)?.verwaltungsart === 'WEG';
  const oAkt = objekte.find((x) => x.id === objekt);
  const werteFehlen = [...pos.filter((p) => p.schluessel === 'Verbrauch' && !einheiten.some((e) => zahl(verbr[`${e.id}-${p.konto_id}`] ?? '') > 0)),
    ...summenAbweichung.map((x) => x.p)].map((p) => `${p.nummer} ${p.name}`);
  const heizFehlt = pos.some((p) => p.nummer === HEIZ_KONTO) && !Object.values(heiz).some((x) => zahl(x.heizkosten) || zahl(x.warmwasser));

  return (
    <>
      <div className="page-head"><h1>Nebenkostenabrechnung</h1><p className="muted">Kalenderjahr, Umlage nach den Schlüsseln des Objekts, Leerstand trägt der Eigentümer</p></div>
      <section className="card row">
        {!fix && <select style={{ width: 300 }} value={objekt} onChange={(e) => setObjekt(Number(e.target.value))}>
          {objekte.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.verwaltungsart})</option>)}
        </select>}
        <label className="inline">Jahr <input type="number" style={{ width: 90 }} value={jahr} onChange={(e) => setJahr(Number(e.target.value))} /></label>
        <span className="muted small">01.01.{jahr} bis 31.12.{jahr} · {tageImJahr(jahr)} Tage</span>
      </section>
      {info && <p className="info">{info}</p>}
      {objekt !== '' && oAkt && <AbschlussKarte objekt={Number(objekt)} jahr={jahr} art="Nebenkosten" stand={stand} ordner={[oAkt.name, 'Nebenkostenabrechnungen', String(jahr)]}
        extra={[
          { ok: mieter.length > 0, sperrt: true, text: 'Mieter mit Abrechnung im Jahr vorhanden' },
          { ok: !werteFehlen.length, sperrt: true, text: 'Werte für Verbrauch und manuelle Verteilung eingetragen', hinweis: werteFehlen.length ? `Fehlt bei: ${werteFehlen.join(', ')}` : undefined },
          { ok: !heizFehlt, sperrt: false, text: 'Heizkosten laut Messdienst eingetragen', hinweis: heizFehlt ? `Konto ${HEIZ_KONTO} wird sonst nach Schlüssel verteilt.` : undefined },
        ]}
        vorschau={vorschauPdf} ablegen={pdfs} buchen={buchen} buchenText="Ergebnis als offene Posten buchen"
        ergebnis={() => ({ kosten: Math.round(kosten * 100) / 100, saldo: Math.round(mieter.reduce((a, r) => a + r.saldo, 0) * 100) / 100, mieter: mieter.length })}
        onStatus={(a, t) => { setZu(a); if (t) setInfo(t); }} />}

      <div className="kpis">
        <div className="kpi"><span>Umlagefähige Kosten</span><b>{eur(kosten)}</b></div>
        <div className="kpi"><span>Vorauszahlungen{mieter.some((r) => r.ueberEigentuemer) ? ' (gezahlt bzw. laut Vertrag)' : ' (gezahlt)'}</span><b>{eur(mieter.reduce((a, r) => a + r.vz, 0))}</b></div>
        <div className="kpi"><span>Nachzahlungen − Guthaben</span><b>{eur(mieter.reduce((a, r) => a + r.saldo, 0))}</b></div>
        <div className="kpi"><span>{weg ? 'Anteil selbst genutzt / nicht vermietet' : 'Anteil Leerstand (Eigentümer)'}</span><b>{eur(leer.reduce((a, r) => a + r.summe, 0))}</b></div>
      </div>

      <fieldset className="gesperrt" disabled={!!zu}>
      <section className="card">
        <div className="card-head"><h2>Eingaben je Einheit für {jahr}</h2><button onClick={eingabenSpeichern}>Speichern und neu berechnen</button></div>
        <table className="list">
          <thead><tr><th>Einheit</th><th className="num">Fläche</th><th className="num">Heizkosten lt. Messdienst €</th><th className="num">Warmwasser lt. Messdienst €</th>
            {verbrauchsKonten.map((k) => <th key={k.konto_id} className="num">{k.schluessel === 'Summe' ? `Betrag € ${k.name}` : `Verbrauch ${k.name}`}</th>)}</tr></thead>
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
        <p className="muted small">Sobald Messdienst-Werte eingetragen sind, wird Konto {HEIZ_KONTO} danach verteilt. Spalten für Verbrauch bzw. feste Beträge erscheinen für Konten mit Schlüssel „Verbrauch“ oder „Summe“.</p>
        {summenAbweichung.map(({ p, s }) => <p key={p.konto_id} className="warn">Schlüssel „Summe“ bei {p.name}: eingetragen {eur(s)}, Kosten laut Buchhaltung {eur(p.betrag)}. Bitte prüfen.</p>)}
      </section>
      </fieldset>

      {objekt !== '' && <AbrechnungsUebersicht objekt={Number(objekt)} jahr={jahr} pos={pos} titel={`Abrechnungsübersicht ${jahr}: umlagefähige Kosten`} nurUmlagefaehig
        onChanged={zu ? undefined : (t) => { setInfo(t); setStand((x) => x + 1); laden(); }}
        schluessel={(p) => zu ? <>{schluesselText(p.schluessel)}</> : <SchluesselWahl objekt={Number(objekt)} jahr={jahr} p={p} onChanged={(t) => { setInfo(t); laden(); }} anteile={(k) => {
          const m: Record<number, number> = {};
          for (const r of erg) for (const z of r.zeilen) if (z.pos.konto_id === k) m[r.nutzer.einheit_id] = (m[r.nutzer.einheit_id] ?? 0) + z.betrag;
          return m; }} />} />}

      <section className="card">
        <div className="card-head"><h2>Ergebnis je Mieter</h2></div>
        {erg.length === 0 ? <p className="muted">Keine Nutzer im Jahr.</p> : (
          <table className="list">
            <thead><tr><th>Einheit</th><th>Nutzer</th><th>Zeitraum</th><th className="num">Kostenanteil</th><th className="num">Vorauszahlung</th><th className="num">Ergebnis</th><th className="num">§35a HDL / HWL</th></tr></thead>
            <tbody>{erg.map((r) => (
              <tr key={r.nutzer.key}>
                <td>{r.einheit.nummer}</td>
                <td>{r.nutzer.art === 'Leerstand' ? <span className="tag">{weg ? 'Eigentümer (selbst genutzt / nicht vermietet)' : 'Leerstand / nicht vermietet · Eigentümer'}</span>
                  : <>{r.nutzer.name}{r.ueberEigentuemer && <div className="muted small">zahlt an Eigentümer · Vorauszahlung laut Vertrag</div>}</>}</td>
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

/** Eigentümer der Einheit am Jahresende (bei vermieteten WEG-Einheiten der Vermieter) */
async function vermieter(einheitId: number, jahr: number): Promise<string> {
  const p = (await db.select(`SELECT p.* FROM eigentum ei JOIN personen p ON p.id = ei.person_id WHERE ei.einheit_id = $1
    AND (ei.von IS NULL OR ei.von <= $2) ORDER BY ei.von DESC LIMIT 1`, [einheitId, `${jahr}-12-31`]))[0];
  return p ? [p.firma, [p.vorname, p.nachname].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';
}

function abrechnungPdf(b: Brief, o: Row, jahr: number, r: NkErgebnis, eigentuemer: string): Brief {
  b.kopf([r.nutzer.name, o.strasse, [o.plz, o.ort].filter(Boolean).join(' ')], new Date().toISOString().slice(0, 10));
  b.betreff(`Betriebs- und Heizkostenabrechnung ${jahr}`);
  b.absatz(`Objekt: ${o.name}, ${[o.strasse, [o.plz, o.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')} · Einheit ${r.einheit.nummer}${wid(o.objekt_nr, r.einheit.lfd_nr) ? ` (W-ID ${wid(o.objekt_nr, r.einheit.lfd_nr)})` : ''}` +
    `${r.einheit.flaeche ? `, ${num(r.einheit.flaeche)} m²` : ''}\nAbrechnungszeitraum: 01.01.${jahr} bis 31.12.${jahr} · Ihr Nutzungszeitraum: ${dDatum(r.nutzer.von)} bis ${dDatum(r.nutzer.bis)} (${r.nutzer.tage} Tage)`);
  const body = r.zeilen.map((z) => [z.pos.name, geld(z.pos.betrag), z.pos.schluessel === 'Messdienst' ? 'lt. Messdienst' : z.pos.schluessel,
    `${basisFmt(z.pos.schluessel, z.gesamtBasis)} ${einheitText[z.pos.schluessel] ?? ''}`, basisFmt(z.pos.schluessel, z.nutzerBasis), geld(z.betrag)]);
  b.tabelle(['Kostenart', 'Gesamtkosten', 'Schlüssel', 'Gesamt', 'Ihr Anteil', 'Ihre Kosten'], body,
    [[{ content: 'Summe Ihrer Kosten', colSpan: 5 }, geld(r.summe)], [{ content: r.ueberEigentuemer ? 'abzüglich Ihrer Vorauszahlungen laut Mietvertrag' : 'abzüglich Ihrer Vorauszahlungen', colSpan: 5 }, geld(-r.vz)],
      [{ content: r.saldo > 0 ? 'Nachzahlung' : 'Guthaben', colSpan: 5 }, geld(Math.abs(r.saldo))]], 1);
  const an = eigentuemer ? `Ihren Vermieter (${eigentuemer})` : 'Ihren Vermieter';
  const er = eigentuemer ? `Ihr Vermieter (${eigentuemer})` : 'Ihr Vermieter';
  b.absatz(r.ueberEigentuemer
    ? (r.saldo > 0
      ? `Diese Abrechnung erstellen wir im Auftrag Ihres Vermieters. Bitte überweisen Sie die Nachzahlung von ${geld(r.saldo)} innerhalb von 30 Tagen an ${an}.`
      : `Diese Abrechnung erstellen wir im Auftrag Ihres Vermieters. Ihr Guthaben von ${geld(Math.abs(r.saldo))} erstattet Ihnen ${er} bzw. verrechnet es mit der nächsten Miete.`)
    : (r.saldo > 0
      ? `Bitte überweisen Sie die Nachzahlung von ${geld(r.saldo)} innerhalb von 30 Tagen nach Erhalt dieser Abrechnung.`
      : `Ihr Guthaben von ${geld(Math.abs(r.saldo))} erstatten wir Ihnen bzw. verrechnen es mit der nächsten Miete.`));
  if (r.hdl || r.hwl) {
    b.absatz('Bescheinigung nach § 35a EStG: In Ihren Kosten sind folgende Anteile enthalten (Arbeitskosten laut Rechnungen):', 2);
    b.tabelle(['Art', 'Betrag'], [['Haushaltsnahe Dienstleistungen (§ 35a Abs. 2)', geld(r.hdl)], ['Handwerkerleistungen (§ 35a Abs. 3)', geld(r.hwl)]]);
  }
  b.absatz('Belege können nach Terminvereinbarung bei uns eingesehen werden. Einwendungen gegen diese Abrechnung sind innerhalb von zwölf Monaten nach Zugang mitzuteilen.');
  b.gruss();
  return b;
}
