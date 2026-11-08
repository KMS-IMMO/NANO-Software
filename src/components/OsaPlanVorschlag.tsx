// Wirtschaftsplan: Vorschlag und Zukunftsvorschau von Agent O.S.A
import { Fragment, useState } from 'react';
import { Check, ChevronDown, ChevronRight, RotateCcw, Sparkles, X } from 'lucide-react';
import { eur } from './EntityTable';
import { STANDARD_ANNAHMEN, kiEinschaetzung, vorschlagBerechnen, type Annahmen, type Vorschlag } from '../logic/planVorschlag';
import { kiFehlerText } from '../logic/kiAgent';

const SCHRITTE = ['Ist-Kosten der letzten drei Jahre lesen', 'Preisentwicklung je Kostengruppe anwenden', 'Erhaltungsrücklage nach Alter und Fläche prüfen', 'Abrechnung des Vorjahres auswerten', 'Die nächsten Jahre vorausrechnen'];
const pct = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(1).replace('.', ',') + ' %';

export function OsaPlanVorschlag({ objektId, objektName, jahr, plan, onUebernehmen }: {
  objektId: number; objektName: string; jahr: number; plan: Record<number, number>;
  onUebernehmen: (werte: Record<number, number>, ruecklage: number) => void;
}) {
  const [v, setV] = useState<Vorschlag | null>(null);
  const [schritt, setSchritt] = useState(-1);
  const [annahmen, setAnnahmen] = useState<Annahmen>(STANDARD_ANNAHMEN);
  const [zeigeAnnahmen, setZeigeAnnahmen] = useState(false);
  const [ki, setKi] = useState<{ text?: string; fehler?: string; laeuft?: boolean }>({});
  const [uebernommen, setUebernommen] = useState(false);

  async function analysieren(a = annahmen, animiert = true) {
    setUebernommen(false); setKi({});
    if (animiert) { setV(null); for (let i = 0; i < SCHRITTE.length; i++) { setSchritt(i); await new Promise((r) => setTimeout(r, 520)); } }
    const erg = await vorschlagBerechnen(objektId, jahr, plan, a);
    setSchritt(-1); setV(erg);
  }

  async function einschaetzung() {
    if (!v) return;
    setKi({ laeuft: true });
    try { setKi({ text: await kiEinschaetzung(v, objektName) }); }
    catch (e) { const t = kiFehlerText(e); setKi({ fehler: t === 'KEIN_SCHLUESSEL' ? 'Für die Einschätzung in Worten braucht O.S.A einen API-Schlüssel (Einstellungen → KI-Assistent). Die Zahlen oben funktionieren auch ohne.' : t }); }
  }

  const setzeSatz = (g: string, wert: string) => setAnnahmen({ ...annahmen, steigerung: { ...annahmen.steigerung, [g]: Number(wert.replace(',', '.')) || 0 } });
  const max = v ? Math.max(...v.vorschau.map((x) => x.kosten + x.ruecklage), 1) : 1;
  const maxB = v ? Math.max(...v.vorschau.map((x) => x.bestand), 1) : 1;
  const gesamtVorschlag = v ? v.kostenVorschlag + v.rlVorschlag : 0, gesamtBisher = v ? v.kostenBisher + v.rlBisher : 0;

  return (
    <section className="card osa-plan">
      <div className="card-head">
        <h2 className="title-ico"><span className="osa-kugel"><i /></span>Vorschlag von Agent O.S.A</h2>
        <div className="row">
          {v && <button onClick={() => setZeigeAnnahmen(!zeigeAnnahmen)}>{zeigeAnnahmen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}Annahmen</button>}
          <button className="primary" onClick={() => analysieren()} disabled={schritt >= 0}><Sparkles size={16} />{v ? 'Neu analysieren' : `Wirtschaftsplan ${jahr} analysieren`}</button>
        </div>
      </div>
      {!v && schritt < 0 && <p className="muted" style={{ marginTop: 0 }}>O.S.A liest die Kosten der letzten Jahre, rechnet mit Preissteigerungen je Kostengruppe, prüft die Erhaltungsrücklage nach Alter und Fläche des Gebäudes und zeigt, wie Hausgeld und Rücklage in den nächsten Jahren aussehen könnten. Du entscheidest, was du übernimmst.</p>}
      {schritt >= 0 && (
        <ul className="osa-schritte">{SCHRITTE.map((s, i) => <li key={s} className={i < schritt ? 'fertig' : i === schritt ? 'jetzt' : ''}>{i < schritt ? <Check size={14} /> : <span className="punkt" />}{s}</li>)}</ul>
      )}
      {v && (
        <div className="osa-ergebnis">
          {zeigeAnnahmen && (
            <div className="osa-annahmen">
              <p className="small muted" style={{ marginTop: 0 }}>Steigerung pro Jahr je Kostengruppe in %. Liegt der Trend der letzten Jahre höher, nimmt O.S.A den Trend (höchstens 15 %).</p>
              <div className="osa-annahmen-raster">
                {Object.entries(annahmen.steigerung).map(([g, s]) => <label key={g}><span>{g}</span><input inputMode="decimal" value={String(s).replace('.', ',')} onChange={(e) => setzeSatz(g, e.target.value)} /></label>)}
                <label><span>Rücklage €/m² bis 21 / 22–31 / ab 32 Jahre</span><input value={annahmen.rlBasis.map((x) => String(x).replace('.', ',')).join(' / ')}
                  onChange={(e) => { const t = e.target.value.split('/').map((x) => Number(x.trim().replace(',', '.')) || 0); if (t.length === 3) setAnnahmen({ ...annahmen, rlBasis: [t[0], t[1], t[2]] }); }} /></label>
                <label><span>Index auf die Rücklage-Werte</span><input inputMode="decimal" value={String(annahmen.rlIndex).replace('.', ',')} onChange={(e) => setAnnahmen({ ...annahmen, rlIndex: Number(e.target.value.replace(',', '.')) || 1 })} /></label>
              </div>
              <p className="small muted">Rücklage-Grundwerte in Anlehnung an § 28 II. BV (7,10 / 9,00 / 11,50 €/m²), mit dem Index auf heutige Preise angehoben. Das ist ein Richtwert, kein Muss.</p>
              <div className="row end"><button onClick={() => { setAnnahmen(STANDARD_ANNAHMEN); analysieren(STANDARD_ANNAHMEN, false); }}><RotateCcw size={15} />Standard</button><button className="primary" onClick={() => analysieren(annahmen, false)}>Mit diesen Annahmen rechnen</button></div>
            </div>)}

          <div className="kpis osa-kpis">
            <div className="kpi"><span>Dein Plan {jahr}</span><b>{eur(gesamtBisher)}</b><small>Kosten {eur(v.kostenBisher)} · Rücklage {eur(v.rlBisher)}</small></div>
            <div className="kpi osa-kpi"><span>Vorschlag O.S.A</span><b>{eur(gesamtVorschlag)}</b><small>Kosten {eur(v.kostenVorschlag)} · Rücklage {eur(v.rlVorschlag)}</small></div>
            <div className="kpi"><span>Unterschied</span><b className={gesamtVorschlag - gesamtBisher > 0.005 ? 'neg' : 'pos'}>{gesamtVorschlag - gesamtBisher >= 0 ? '+' : ''}{eur(gesamtVorschlag - gesamtBisher)}</b><small>{gesamtBisher ? pct((gesamtVorschlag / gesamtBisher - 1) * 100) : '–'} · {eur((gesamtVorschlag - gesamtBisher) / 12)} im Monat</small></div>
            <div className="kpi"><span>Hausgeld {jahr} je Monat</span><b>{eur(gesamtVorschlag / 12)}</b><small>alle {v.einheiten} Einheiten zusammen</small></div>
          </div>

          <div className="osa-raster">
            <div>
              <h3 className="sec">Kosten je Konto</h3>
              <table className="list osa-tabelle">
                <thead><tr><th>Konto</th><th className="num">Ist {jahr - 2}</th><th className="num">Ist {jahr - 1}</th><th className="num">Dein Plan</th><th className="num">Vorschlag</th><th>Begründung</th></tr></thead>
                <tbody>
                  {([['Umlagefähige Kosten', v.zeilen.filter((z) => z.umlagefaehig)], ['Nicht umlagefähige Kosten', v.zeilen.filter((z) => !z.umlagefaehig)]] as const).map(([t, l]) => l.length > 0 && (
                    <Fragment key={t}>
                      <tr className="abr-gruppe-kopf"><td colSpan={6}>{t}</td></tr>
                      {l.map((z) => {
                        const d = z.bisher ? z.vorschlag - z.bisher : 0;
                        return <tr key={z.konto_id}><td>{z.nummer} {z.name}</td><td className="num muted">{z.ist[jahr - 2] != null ? eur(z.ist[jahr - 2]) : '–'}</td><td className="num muted">{z.ist[jahr - 1] != null ? eur(z.ist[jahr - 1]) : '–'}</td>
                          <td className="num">{z.bisher ? eur(z.bisher) : '–'}</td><td className="num"><b>{eur(z.vorschlag)}</b>{z.bisher > 0 && Math.abs(d) > 0.005 && <div className={'small ' + (d > 0 ? 'neg' : 'pos')}>{d > 0 ? '+' : ''}{eur(d)}</div>}</td>
                          <td className="small muted">{z.grund}</td></tr>;
                      })}
                    </Fragment>))}
                  <tr className="abr-gruppe-kopf"><td colSpan={6}>Erhaltungsrücklage</td></tr>
                  <tr><td>1260 Zuführung Erhaltungsrücklage</td><td className="num muted">–</td><td className="num muted">–</td><td className="num">{v.rlBisher ? eur(v.rlBisher) : '–'}</td>
                    <td className="num"><b>{eur(v.rlVorschlag)}</b>{v.rlBisher > 0 && Math.abs(v.rlVorschlag - v.rlBisher) > 0.005 && <div className="small neg">+{eur(v.rlVorschlag - v.rlBisher)}</div>}</td><td className="small muted">{v.rlGrund}</td></tr>
                </tbody>
              </table>
            </div>
            <div>
              <h3 className="sec">So könnte es weitergehen</h3>
              <div className="osa-chart" role="img" aria-label="Vorschau Hausgeld und Rücklage">
                {v.vorschau.map((x, i) => (
                  <div key={x.jahr} className="osa-saeule" style={{ animationDelay: `${i * 0.15}s` }}>
                    <span className="osa-wert">{eur(x.hausgeldMonat)}<small>/ Monat</small></span>
                    <div className="osa-stapel" style={{ height: `${((x.kosten + x.ruecklage) / max) * 100}%` }}>
                      <i className="rl" style={{ height: `${(x.ruecklage / (x.kosten + x.ruecklage)) * 100}%` }} title={`Rücklage ${eur(x.ruecklage)}`} />
                      <i className="ko" title={`Kosten ${eur(x.kosten)}`} />
                    </div>
                    <b>{x.jahr}</b>
                  </div>))}
              </div>
              <div className="osa-legende"><span><i className="ko" />Kosten</span><span><i className="rl" />Zuführung Rücklage</span></div>
              <table className="list osa-vorschau">
                <thead><tr><th>Jahr</th><th className="num">Kosten</th><th className="num">Rücklage</th><th className="num">Hausgeld / Monat</th><th className="num">Rücklage-Bestand</th></tr></thead>
                <tbody>{v.vorschau.map((x) => <tr key={x.jahr}><td>{x.jahr}</td><td className="num">{eur(x.kosten)}</td><td className="num">{eur(x.ruecklage)}</td><td className="num"><b>{eur(x.hausgeldMonat)}</b></td>
                  <td className="num"><span className="osa-balken"><i style={{ width: `${(x.bestand / maxB) * 100}%` }} /></span>{eur(x.bestand)}</td></tr>)}</tbody>
              </table>
              <p className="small muted">Bestand 31.12.{jahr - 1}: {eur(v.rlBestand)}, ohne Entnahmen gerechnet.</p>
            </div>
          </div>

          <div className="osa-hinweise">
            <h3 className="sec">Was O.S.A auffällt</h3>
            <ul>{v.hinweise.map((h) => <li key={h}>{h}</li>)}</ul>
            {ki.text && <div className="osa-ki"><b>Einschätzung von O.S.A</b>{ki.text.split('\n').filter(Boolean).map((z, i) => <p key={i}>{z.replace(/^[-•]\s*/, '')}</p>)}</div>}
            {ki.fehler && <p className="muted small">{ki.fehler}</p>}
          </div>

          <div className="row end osa-aktionen">
            <span className="grow" />
            {uebernommen && <span className="pos">Vorschlag eingetragen. Prüfen und speichern.</span>}
            <button onClick={einschaetzung} disabled={ki.laeuft}><Sparkles size={16} />{ki.laeuft ? 'O.S.A denkt nach …' : 'Einschätzung in Worten'}</button>
            <button onClick={() => { setV(null); setKi({}); }}><X size={16} />Verwerfen</button>
            <button className="primary" onClick={() => { onUebernehmen(Object.fromEntries(v.zeilen.map((z) => [z.konto_id, z.vorschlag])), v.rlVorschlag); setUebernommen(true); }}><Check size={16} />Vorschlag in den Plan übernehmen</button>
          </div>
        </div>)}
    </section>
  );
}
