// Mahnwesen: Zahlungserinnerung, 1. Mahnung, 2. Mahnung als PDF mit einstellbaren Gebühren.
import { useEffect, useState } from 'react';
import { db, insert, type Row } from '../db';
import { useObjektKontext } from '../logic/objektKontext';
import { datum, eur } from '../components/EntityTable';
import { OP_SQL } from '../logic/soll';
import { Brief, absender, dDatum, geld } from '../lib/pdf';
import { oeffnen, speichern } from '../lib/dateien';

export const STUFEN = ['', 'Zahlungserinnerung', '1. Mahnung', '2. Mahnung'];
const heute = () => new Date().toISOString().slice(0, 10);
const plusTage = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

interface Fall { key: string; person_id: number; einheit_id: number; schuldner: string; objekt: string; objekt_id: number; einheit: string;
  verwaltungsart: string; posten: Row[]; offen: number; stufe: number; seit: string }

export function MahnungenPage() {
  const fix = useObjektKontext();
  const [faelle, setFaelle] = useState<Fall[]>([]);
  const [tage, setTage] = useState(7);
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState('');

  const [verlauf, setVerlauf] = useState<Row[]>([]);
  const [vFilter, setVFilter] = useState<'alle' | 'offen' | 'beglichen'>('alle');
  const load = async () => {
    // Alle erstellten Mahnungen; beglichen, sobald alle gemahnten Posten bezahlt sind
    const mv = await db.select(`SELECT m.*, o.name AS objekt, e.nummer AS einheit FROM mahnungen m LEFT JOIN objekte o ON o.id = m.objekt_id LEFT JOIN einheiten e ON e.id = m.einheit_id
      ${fix ? `WHERE m.objekt_id = ${fix.id}` : ''} ORDER BY m.datum DESC, m.id DESC`);
    const ids = [...new Set(mv.flatMap((x) => String(x.posten).split(',').filter(Boolean).map(Number)))];
    const gemahnt = ids.length ? await db.select(`SELECT id, betrag, bezahlt FROM (${OP_SQL}) WHERE id IN (${ids.join(',')})`) : [];
    const rest = new Map(gemahnt.map((o) => [o.id, Math.max(0, o.betrag - o.bezahlt)]));
    setVerlauf(mv.map((x) => { const r = String(x.posten).split(',').filter(Boolean).reduce((a, id) => a + (rest.get(Number(id)) ?? 0), 0); return { ...x, rest: r, beglichen: r <= 0.005 }; }));
    const ops = await db.select(`SELECT * FROM (${OP_SQL}) WHERE betrag - bezahlt > 0.005 AND faellig < date('now', $1) ${fix ? `AND objekt_id = ${fix.id}` : ''} ORDER BY faellig`, [`-${tage} days`]);
    const m = new Map<string, Fall>();
    for (const o of ops) {
      const k = `${o.person_id}-${o.einheit_id}`;
      const f = m.get(k) ?? { key: k, person_id: o.person_id, einheit_id: o.einheit_id, schuldner: o.schuldner, objekt: o.objekt, objekt_id: o.objekt_id,
        einheit: o.einheit, verwaltungsart: o.verwaltungsart, posten: [] as Row[], offen: 0, stufe: 0, seit: o.faellig };
      f.posten.push(o); f.offen += o.betrag - o.bezahlt; f.stufe = Math.max(f.stufe, Number(o.mahnstufe) || 0);
      m.set(k, f);
    }
    setFaelle([...m.values()].sort((a, b) => b.offen - a.offen));
  };
  useEffect(() => { load(); }, [tage]);

  async function mahnen(f: Fall) {
    setBusy(f.key);
    try {
      const stufe = Math.min(f.stufe + 1, 3);
      const e = Object.fromEntries((await db.select('SELECT * FROM einstellungen')).map((r) => [r.schluessel, r.wert ?? '']));
      const gebuehr = Number(String(e[`mahnung_gebuehr_${stufe}`] ?? '0').replace(',', '.')) || 0;
      const frist = plusTage(Number(e.mahnung_frist_tage) || 14);
      const p = (await db.select('SELECT * FROM personen WHERE id = $1', [f.person_id]))[0] ?? {};
      const bank = (await db.select('SELECT * FROM bankkonten WHERE objekt_id = $1 LIMIT 1', [f.objekt_id]))[0];
      const o = (await db.select('SELECT * FROM objekte WHERE id = $1', [f.objekt_id]))[0];

      const brief = new Brief(await absender());
      const name = [p.anrede === 'Firma' ? '' : p.anrede, p.titel, p.vorname, p.nachname].filter(Boolean).join(' ');
      brief.kopf([p.firma, name, p.strasse, [p.plz, p.ort].filter(Boolean).join(' ')], heute());
      const was = f.verwaltungsart === 'WEG' && f.posten.every((x) => x.art === 'Hausgeld') ? 'Hausgeld' : 'Miete';
      brief.betreff(`${STUFEN[stufe]}: ${o.name}, Einheit ${f.einheit}`);
      const anrede = p.anrede === 'Frau' ? `Sehr geehrte Frau ${p.nachname},` : p.anrede === 'Herr' ? `Sehr geehrter Herr ${p.nachname},` : 'Sehr geehrte Damen und Herren,';
      brief.absatz(anrede);
      brief.absatz(stufe === 1
        ? `sicher ist es Ihrer Aufmerksamkeit entgangen: Für die oben genannte Einheit sind folgende Zahlungen (${was}) noch offen. Bitte überweisen Sie den offenen Betrag bis zum ${dDatum(frist)}.`
        : stufe === 2
          ? `trotz unserer Zahlungserinnerung konnten wir bis heute keinen Zahlungseingang für folgende Posten feststellen. Wir bitten Sie, den offenen Betrag bis spätestens ${dDatum(frist)} zu überweisen.`
          : `leider sind die folgenden Posten trotz Erinnerung und Mahnung weiterhin offen. Wir fordern Sie hiermit letztmalig auf, den Gesamtbetrag bis spätestens ${dDatum(frist)} zu überweisen. Nach Ablauf der Frist behalten wir uns weitere Schritte ohne erneute Ankündigung vor.`);
      // Pro Monat eine Zeile, damit das Schreiben übersichtlich bleibt
      const proMonat = new Map<string, { arten: string[]; faellig: string; soll: number; ist: number }>();
      for (const x of f.posten) {
        const g = proMonat.get(x.monat) ?? { arten: [] as string[], faellig: x.faellig, soll: 0, ist: 0 };
        g.arten.push(x.art); g.soll += x.betrag; g.ist += x.bezahlt; proMonat.set(x.monat, g);
      }
      const body = [...proMonat.entries()].map(([mon, g]) => [mon, g.arten.join(', '), dDatum(g.faellig), geld(g.soll), geld(g.ist), geld(g.soll - g.ist)]);
      const foot = [];
      if (gebuehr) foot.push(['', `Mahngebühr ${STUFEN[stufe]}`, '', '', '', geld(gebuehr)]);
      foot.push(['', 'Gesamt zu zahlen', '', '', '', geld(f.offen + gebuehr)]);
      brief.tabelle(['Monat', 'Posten', 'Fällig', 'Soll', 'Gezahlt', 'Offen'], body, foot, 3);
      if (bank) brief.absatz(`Bitte überweisen Sie auf das Konto ${bank.name}${bank.bank ? ` bei der ${bank.bank}` : ''}, IBAN ${bank.iban ?? ''}, Verwendungszweck: ${o.name} ${f.einheit} ${STUFEN[stufe]}.`);
      brief.absatz('Sollten Sie die Zahlung inzwischen geleistet haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.');
      brief.gruss();

      // Gebühr als offenen Posten anlegen, Mahnstufe merken
      if (gebuehr) {
        await insert('sollstellungen', { einheit_id: f.einheit_id, person_id: f.person_id, vertrag_id: f.posten[0].vertrag_id ?? null,
          monat: `${heute()} M${stufe}`, art: 'Mahngebühr', betrag: gebuehr, faellig: frist, mahnstufe: stufe });
      }
      for (const x of f.posten) await db.execute('UPDATE sollstellungen SET mahnstufe = $1 WHERE id = $2', [stufe, x.id]);

      const datei = `${heute()} ${STUFEN[stufe]} ${f.einheit} ${f.schuldner}.pdf`;
      const pfad = await speichern(brief.bytes(), datei, { bezug: 'Objekt', bezugId: f.objekt_id, ordner: [o.name, 'Mahnungen'] });
      // Verlauf: jede Mahnung mit den gemahnten Posten merken; der Status (offen/beglichen) ergibt sich laufend aus den Zahlungen
      await insert('mahnungen', { objekt_id: f.objekt_id, einheit_id: f.einheit_id, person_id: f.person_id, schuldner: f.schuldner, stufe, datum: heute(), frist,
        betrag: Math.round(f.offen * 100) / 100, gebuehr, posten: f.posten.map((x) => x.id).join(','), pfad });
      setInfo(`${STUFEN[stufe]} für ${f.schuldner} erstellt und abgelegt: ${pfad}`);
      oeffnen(pfad);
      load();
    } catch (e: any) {
      setInfo('Fehler: ' + (e?.message ?? e));
    } finally { setBusy(''); }
  }

  return (
    <>
      <div className="page-head"><h1>Mahnungen</h1><p className="muted">Überfällige Mieten und Hausgelder je Mieter bzw. Eigentümer</p></div>
      <section className="card">
        <div className="row">
          <label className="inline">Überfällig seit mehr als <input type="number" min={0} style={{ width: 70 }} value={tage} onChange={(e) => setTage(Number(e.target.value) || 0)} /> Tagen</label>
          <span className="muted small">Gebühren und Zahlungsfrist stellst du unter Einstellungen ein.</span>
        </div>
        {info && <p className="info">{info}</p>}
      </section>
      <section className="card">
        {faelle.length === 0 ? <p className="muted">Keine überfälligen Posten. Erst „Offene Posten“ soll stellen und Kontoauszüge importieren.</p> : (
          <table className="list">
            <thead><tr><th>Mieter / Eigentümer</th><th>Objekt / Einheit</th><th>Posten</th><th>Fällig seit</th><th className="num">Offen</th><th>Bisher</th><th /></tr></thead>
            <tbody>{faelle.map((f) => (
              <tr key={f.key}>
                <td>{f.schuldner}</td>
                <td>{f.objekt} – {f.einheit}</td>
                <td className="small">{f.posten.length} ({[...new Set(f.posten.map((x) => x.art))].join(', ')})</td>
                <td className="neg">{datum(f.seit)}</td>
                <td className="num neg"><b>{eur(f.offen)}</b></td>
                <td>{f.stufe ? <span className="pill">{STUFEN[f.stufe]}</span> : <span className="muted">–</span>}</td>
                <td className="actions">
                  <button className="primary small-btn" disabled={busy === f.key} onClick={() => mahnen(f)}>
                    {f.stufe >= 3 ? '2. Mahnung erneut' : STUFEN[f.stufe + 1] + ' erstellen'}
                  </button>
                </td>
              </tr>))}
            </tbody>
          </table>
        )}
      </section>
      <section className="card">
        <div className="card-head"><h2>Erstellte Mahnungen ({verlauf.length})</h2>
          <div className="seg">{(['alle', 'offen', 'beglichen'] as const).map((k) => <button key={k} className={vFilter === k ? 'on' : ''} onClick={() => setVFilter(k)}>
            {k[0].toUpperCase() + k.slice(1)} ({verlauf.filter((v) => k === 'alle' || (k === 'beglichen') === v.beglichen).length})</button>)}</div></div>
        {verlauf.length === 0 ? <p className="muted">Noch keine Mahnungen erstellt.</p> : (
          <table className="list">
            <thead><tr><th>Datum</th><th>Stufe</th><th>Mieter / Eigentümer</th><th>Objekt / Einheit</th><th>Frist</th><th className="num">Gemahnt</th><th className="num">Noch offen</th><th>Status</th><th /></tr></thead>
            <tbody>{verlauf.filter((v) => vFilter === 'alle' || (vFilter === 'beglichen') === v.beglichen).map((v) => (
              <tr key={v.id}>
                <td>{datum(v.datum)}</td><td>{STUFEN[v.stufe]}</td><td>{v.schuldner}</td><td>{v.objekt} – {v.einheit}</td>
                <td className={!v.beglichen && v.frist < heute() ? 'neg' : ''}>{datum(v.frist)}</td>
                <td className="num">{eur(v.betrag + (Number(v.gebuehr) || 0))}{v.gebuehr ? <div className="muted small">inkl. {eur(v.gebuehr)} Gebühr</div> : null}</td>
                <td className={'num ' + (v.beglichen ? '' : 'neg')}>{eur(v.rest)}</td>
                <td><span className={'pill st-' + (v.beglichen ? 'beglichen' : 'offen')}>{v.beglichen ? 'beglichen' : 'offen'}</span></td>
                <td className="actions">{v.pfad && <button className="link" onClick={() => oeffnen(v.pfad)}>PDF öffnen</button>}</td>
              </tr>))}</tbody>
          </table>)}
        <p className="muted small">Der Status springt automatisch auf „beglichen“, sobald die gemahnten Posten bezahlt sind, egal ob per Bankzuordnung oder von Hand.</p>
      </section>
    </>
  );
}
