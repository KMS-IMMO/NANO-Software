// Kontoauszug per Drag & Drop (CSV, CAMT-XML oder PDF): Vorschau, Bankkonto wählen, importieren und automatisch zuordnen.
// Aus den zugeordneten Umsätzen entstehen die Buchungen unter „Einnahmen & Ausgaben“.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileUp, Landmark } from 'lucide-react';
import { db, insert, type Row } from '../db';
import { auszugLesen, automatischZuordnen, bilderLesen, importieren, saldoHinweis, startsaldoUebernehmen, type Umsatz } from '../logic/bank';
import { istBild } from '../logic/ocr';
import { datum, eur } from './EntityTable';

const zahl = (s: string) => Number(String(s ?? '').replace(/\./g, '').replace(',', '.')) || 0;

export function AuszugImport({ objektId, onDone, kompakt, kontoId }: { objektId: number | null; onDone: () => void; kompakt?: boolean; kontoId?: number }) {
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stand, setStand] = useState('');
  const [info, setInfo] = useState<{ text: string; offen: number } | null>(null);
  const [fehler, setFehler] = useState('');
  const [vorschau, setVorschau] = useState<{ umsaetze: Umsatz[]; hinweise: string[]; dateien: string[]; saldo?: { anfang: number; ende?: number }; anfang?: number } | null>(null);
  const [konten, setKonten] = useState<Row[]>([]);
  const [konto, setKonto] = useState<number | ''>('');
  const [neu, setNeu] = useState({ name: 'Bankkonto', iban: '', saldo: '', datum: '' });
  const ref = useRef<HTMLInputElement>(null);

  const kontenLaden = async () => {
    const k = await db.select(`SELECT b.*, o.name AS objekt FROM bankkonten b LEFT JOIN objekte o ON o.id = b.objekt_id
      ${objektId ? 'WHERE b.objekt_id = ' + Number(objektId) : ''} ORDER BY o.name, b.name`);
    setKonten(k); if (kontoId && k.some((x) => x.id === kontoId)) setKonto(kontoId); else if (k.length === 1) setKonto(k[0].id);
  };
  useEffect(() => { kontenLaden(); }, [objektId, kontoId]);

  async function lesen(files: FileList | File[]) {
    setFehler(''); setInfo(null); setBusy(true);
    const umsaetze: Umsatz[] = [], hinweise: string[] = [], namen: string[] = [];
    let anfang: number | undefined, ende: number | undefined, mitSaldo = 0;
    try {
      const alle = Array.from(files), bilder = alle.filter(istBild);
      const gruppen: { name: string; lesen: () => Promise<{ umsaetze: Umsatz[]; hinweis?: string; anfang?: number; ende?: number }> }[] = [
        ...alle.filter((f) => !istBild(f)).map((f) => ({ name: f.name, lesen: () => auszugLesen(f, setStand) })),
        ...(bilder.length ? [{ name: bilder.length === 1 ? bilder[0].name : `${bilder.length} Fotos`, lesen: () => bilderLesen(bilder, setStand) }] : []),
      ];
      for (const g of gruppen) {
        const r = await g.lesen();
        umsaetze.push(...r.umsaetze); namen.push(g.name);
        if (r.anfang !== undefined && anfang === undefined) { anfang = r.anfang; ende = r.ende; }
        if (r.anfang !== undefined) mitSaldo++;
        if (r.hinweis) hinweise.push(`${g.name}: ${r.hinweis}`);
      }
      umsaetze.sort((a, b) => a.datum.localeCompare(b.datum));
      if (!umsaetze.length) setFehler('In der Datei wurden keine Umsätze gefunden.');
      else {
        const saldo = gruppen.length === 1 && mitSaldo === 1 && anfang !== undefined ? { anfang, ende } : undefined;
        setVorschau({ umsaetze, hinweise: saldo ? hinweise.filter((h) => !/Kontostand|Anfangssaldo/.test(h)) : hinweise, dateien: namen, saldo, anfang });
        const erstes = umsaetze[0].datum;
        setNeu((n) => ({ ...n, saldo: n.saldo || (anfang !== undefined ? String(anfang).replace('.', ',') : ''), datum: n.datum || new Date(new Date(erstes + 'T12:00:00').getTime() - 864e5).toISOString().slice(0, 10) }));
      }
    } catch (e: any) { setFehler(String(e?.message ?? e)); }
    finally { setBusy(false); setStand(''); }
  }

  async function uebernehmen() {
    if (!vorschau) return;
    if (vorschau.saldo?.ende !== undefined && /^Achtung/.test(saldoHinweis(vorschau.umsaetze, vorschau.saldo.anfang, vorschau.saldo.ende))
      && !window.confirm('Der Kontostand passt nicht: Anfangsstand plus Umsätze ergibt nicht den Endstand des Auszugs. Wahrscheinlich fehlt ein Umsatz oder ein Betrag ist falsch gelesen.\n\nTrotzdem übernehmen? Fehlende Umsätze kannst du danach unter „Buchen“ von Hand ergänzen.')) return;
    setBusy(true); setFehler('');
    try {
      let kid = konto, start = false;
      if (kid !== '') start = await startsaldoUebernehmen(Number(kid), vorschau.anfang, vorschau.umsaetze[0]?.datum);
      if (kid === '') {
        if (!objektId) { setFehler('Bitte ein Bankkonto wählen.'); setBusy(false); return; }
        kid = await insert('bankkonten', { objekt_id: objektId, name: neu.name.trim() || 'Bankkonto', iban: neu.iban.replace(/\s/g, '').toUpperCase() || null,
          anfangssaldo: zahl(neu.saldo), saldo_datum: neu.datum || null });
      }
      const r = await importieren(Number(kid), vorschau.umsaetze);
      const a = await automatischZuordnen();
      const offen = Number((await db.select(`SELECT COUNT(*) AS n FROM bankumsaetze WHERE bankkonto_id = $1 AND status = 'offen'`, [kid]))[0]?.n ?? 0);
      setInfo({ text: `${r.neu} Umsätze übernommen${r.doppelt ? `, ${r.doppelt} waren schon vorhanden` : ''}. ${a.zugeordnet} automatisch gebucht.${start ? ` Startsaldo ${eur(vorschau.anfang!)} aus dem Auszug übernommen.` : ''}`, offen });
      setVorschau(null); kontenLaden(); onDone();
    } catch (e: any) { setFehler(String(e?.message ?? e)); }
    finally { setBusy(false); }
  }

  const ein = vorschau?.umsaetze.filter((u) => u.betrag > 0) ?? [], aus = vorschau?.umsaetze.filter((u) => u.betrag < 0) ?? [];
  const summe = (l: Umsatz[]) => l.reduce((a, u) => a + u.betrag, 0);

  return (
    <>
      <section className={'card drop auszug-drop' + (drag ? ' over' : '') + (kompakt ? ' kompakt' : '')}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) lesen(e.dataTransfer.files); }}>
        <div className="auszug-zeile"><span className="auszug-ico"><FileUp size={22} /></span>
          <div className="grow"><b>{busy ? (stand || 'Lese Kontoauszug …') : 'Kontoauszug hierher ziehen'}</b> oder <button className="link" onClick={() => ref.current?.click()}>Datei auswählen</button>
            <div className="muted small">CSV, PDF oder CAMT-XML aus dem Online-Banking, auch eingescannte PDFs und Fotos (JPG). Daraus entstehen die Einnahmen und Ausgaben, bekannte Zahlungen werden automatisch gebucht.</div></div></div>
        <input ref={ref} type="file" accept=".xml,.csv,.txt,.pdf,.jpg,.jpeg,.png,.heic" multiple hidden onChange={(e) => { if (e.target.files?.length) lesen(Array.from(e.target.files)); e.target.value = ''; }} />
        {fehler && <p className="error">{fehler}</p>}
        {info && <p className="info">{info.text} {info.offen ? <>{info.offen} Umsätze brauchen noch eine Zuordnung: <Link to={objektId ? `/objekte/${objektId}/bank` : '/bank'}>Bank & Zuordnung öffnen</Link></> : 'Alles zugeordnet.'}</p>}
      </section>

      {vorschau && (
        <div className="modal-bg erin-bg" onClick={() => !busy && setVorschau(null)}>
          <div className="modal erin-modal auszug-modal" onClick={(e) => e.stopPropagation()}>
            <div className="erin-kopf"><span className="erin-glocke"><Landmark size={22} /></span>
              <div><h3>Kontoauszug übernehmen</h3><p className="muted small">{vorschau.dateien.join(', ')} · {vorschau.umsaetze.length} Umsätze vom {datum(vorschau.umsaetze[0].datum)} bis {datum(vorschau.umsaetze[vorschau.umsaetze.length - 1].datum)}</p></div></div>
            <div className="auszug-inhalt">
              <div className="kpis auszug-kpis">
                <div className="kpi"><span>Eingänge ({ein.length})</span><b className="pos">{eur(summe(ein))}</b></div>
                <div className="kpi"><span>Ausgänge ({aus.length})</span><b className="neg">{eur(summe(aus))}</b></div>
                <div className="kpi"><span>Saldo der Umsätze</span><b>{eur(summe(vorschau.umsaetze))}</b></div>
              </div>
              {vorschau.saldo && (() => { const h = saldoHinweis(vorschau.umsaetze, vorschau.saldo.anfang, vorschau.saldo.ende);
                return <p className={/Achtung/.test(h) ? 'warn' : 'info'}>{h}</p>; })()}
              {vorschau.umsaetze.some((u) => u.pruefen) && <p className="muted small">Gelb markierte Zeilen bitte prüfen. Mit ± drehst du das Vorzeichen um, der Kontostand-Abgleich rechnet sofort neu.</p>}
              {vorschau.hinweise.map((h) => <p key={h} className={/Achtung|nicht gefunden/.test(h) ? 'warn' : 'info'}>{h}</p>)}
              <div className="form auszug-konto">
                {konten.length ? <label><span>Bankkonto</span><select value={konto} onChange={(e) => setKonto(e.target.value === '' ? '' : Number(e.target.value))}>
                    {konten.length > 1 && <option value="">Bitte wählen</option>}
                    {konten.map((k) => <option key={k.id} value={k.id}>{objektId ? '' : `${k.objekt ?? ''} – `}{k.name}{k.iban ? ` (${k.iban})` : ''}</option>)}</select></label>
                  : objektId ? <><p className="muted small wide">Für diese Liegenschaft gibt es noch kein Bankkonto. Es wird jetzt angelegt:</p>
                    <label><span>Bezeichnung</span><input value={neu.name} onChange={(e) => setNeu({ ...neu, name: e.target.value })} /></label>
                    <label><span>IBAN</span><input value={neu.iban} onChange={(e) => setNeu({ ...neu, iban: e.target.value })} /></label>
                    <label><span>Kontostand vor dem ersten Umsatz €</span><input inputMode="decimal" value={neu.saldo} onChange={(e) => setNeu({ ...neu, saldo: e.target.value })} placeholder="0,00" /></label>
                    <label><span>Kontostand vom</span><input type="date" value={neu.datum} onChange={(e) => setNeu({ ...neu, datum: e.target.value })} /></label></>
                  : <p className="warn">Noch kein Bankkonto vorhanden. Bitte in der Liegenschaft ein Bankkonto anlegen.</p>}
              </div>
              <div className="tablewrap auszug-liste"><table className="list">
                <thead><tr><th>Datum</th><th>Zahler / Empfänger</th><th>Verwendungszweck</th><th className="num">Betrag</th></tr></thead>
                <tbody>{vorschau.umsaetze.slice(0, 300).map((u, i) => (
                  <tr key={i} className={u.pruefen ? 'auszug-pruefen' : ''}><td className="nowrap">{datum(u.datum)}</td><td>{u.gegenpartei || <span className="muted">–</span>}</td><td className="small">{u.verwendungszweck}{u.pruefen && <div className="warn-text">⚠ {u.pruefen}</div>}</td>
                    <td className={'num nowrap ' + (u.betrag < 0 ? 'neg' : 'pos')}>{eur(u.betrag)}{u.pruefen && <button className="link auszug-pm" title="Vorzeichen umdrehen"
                      onClick={() => setVorschau({ ...vorschau, umsaetze: vorschau.umsaetze.map((x, j) => (j === i ? { ...x, betrag: -x.betrag } : x)) })}>±</button>}</td></tr>))}</tbody>
              </table></div>
              {vorschau.umsaetze.length > 300 && <p className="muted small">Angezeigt: die ersten 300 von {vorschau.umsaetze.length}. Übernommen werden alle.</p>}
              {fehler && <p className="error">{fehler}</p>}
            </div>
            <div className="row end erin-fuss"><button disabled={busy} onClick={() => setVorschau(null)}>Abbrechen</button>
              <button className="primary" disabled={busy || (!konten.length && !objektId)} onClick={uebernehmen}><FileUp size={16} />{busy ? 'Übernehme …' : `${vorschau.umsaetze.length} Umsätze übernehmen und buchen`}</button></div>
          </div>
        </div>)}
    </>
  );
}
