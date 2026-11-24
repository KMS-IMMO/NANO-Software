// Ansicht „Kontoumsätze“ unter „Einnahmen & Ausgaben“: wie ein Kontoauszug mit laufendem Kontostand je Zeile,
// Bankstatus (grün zugeordnet, gelb offen) und „Verbinden“, wenn es die Zahlung schon als Buchung ohne Kontoumsatz gibt.
import { useEffect, useState } from 'react';
import { Landmark } from 'lucide-react';
import { db, type Row } from '../db';
import { passendeBuchungen, umsatzListe, verbinden } from '../logic/kontostand';
import { datum, eur } from './EntityTable';

export function KontoumsaetzeAnsicht({ objekt, jahr, monat, suche, version, onChange }: {
  objekt: number; jahr: number; monat: string; suche: (r: Row) => boolean; version: number; onChange: (info?: string) => void;
}) {
  const [konten, setKonten] = useState<Row[]>([]);
  const [konto, setKonto] = useState<number | null>(null);
  const [liste, setListe] = useState<{ start: number; zeilen: Row[]; ende: number } | null>(null);
  const [passend, setPassend] = useState<Record<number, Row[]>>({});
  const [fehler, setFehler] = useState('');
  useEffect(() => {
    db.select('SELECT id, name, iban FROM bankkonten WHERE objekt_id = $1 ORDER BY id', [objekt]).then((k) => { setKonten(k); setKonto(k[0]?.id ?? null); });
  }, [objekt]);
  const laden = async () => {
    if (!konto) { setListe(null); return; }
    const l = await umsatzListe(konto, jahr, monat);
    setListe(l);
    const p: Record<number, Row[]> = {};
    for (const u of l.zeilen.filter((x) => x.status === 'offen').slice(0, 80)) p[u.id] = await passendeBuchungen(u);
    setPassend(p);
  };
  useEffect(() => { laden(); }, [konto, jahr, monat, version]);

  async function los(b: Row, u: Row) {
    setFehler('');
    try { await verbinden(Number(b.id), Number(u.id)); onChange(`Buchung Nr. ${b.id} mit dem Kontoumsatz vom ${datum(u.datum)} über ${eur(Number(u.betrag))} verbunden. Die Zahlung zählt nur einmal.`); laden(); }
    catch (e) { setFehler(String((e as Error)?.message ?? e)); }
  }

  if (!konten.length) return <section className="card"><p className="muted">Für diese Liegenschaft ist kein Bankkonto angelegt.</p></section>;
  const zeilen = (liste?.zeilen ?? []).filter(suche);
  const ein = (liste?.zeilen ?? []).filter((u) => u.betrag > 0).reduce((a, u) => a + Number(u.betrag), 0);
  const aus = (liste?.zeilen ?? []).filter((u) => u.betrag < 0).reduce((a, u) => a + Number(u.betrag), 0);
  const zeitraum = monat ? new Date(jahr, Number(monat) - 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }) : String(jahr);
  return (
    <section className="card ku-ansicht">
      <div className="card-head"><h2 className="title-ico"><Landmark size={22} />Kontoumsätze {zeitraum}</h2>
        {konten.length > 1 && <select value={konto ?? ''} onChange={(e) => setKonto(Number(e.target.value))} aria-label="Bankkonto">
          {konten.map((k) => <option key={k.id} value={k.id}>{k.name}{k.iban ? ` · ${String(k.iban).slice(-4)}` : ''}</option>)}</select>}</div>
      {fehler && <p className="error">{fehler}</p>}
      <div className="tablewrap"><table className="list gross">
        <thead><tr><th className="ks-dot-sp" /><th>Datum</th><th>Gegenpartei</th><th>Verwendungszweck</th><th>Gebucht auf</th><th className="num">Betrag</th><th className="num">Kontostand</th></tr></thead>
        <tbody>
          <tr className="ku-start"><td /><td>{monat ? `01.${monat}.${jahr}` : `01.01.${jahr}`}</td><td colSpan={4} className="muted">Kontostand zu Beginn des Zeitraums</td><td className="num"><b>{eur(liste?.start ?? 0)}</b></td></tr>
          {zeilen.map((u) => {
            const st = u.status === 'zugeordnet' ? (Math.abs(Number(u.gebucht ?? 0) - Number(u.betrag)) > 0.005 ? 'gelb' : 'gruen') : u.status === 'ignoriert' ? 'grau' : 'gelb';
            const pb = passend[u.id] ?? [];
            return [
              <tr key={u.id} className={st === 'gelb' ? 'ks-gelb' : ''}>
                <td><i className={'ks-dot ' + st} title={u.status === 'zugeordnet' ? (st === 'gelb' ? 'anders gebucht' : 'zugeordnet') : u.status} /></td>
                <td>{datum(u.datum)}</td><td>{u.gegenpartei || '–'}</td><td className="small muted">{u.verwendungszweck}</td>
                <td>{u.status === 'zugeordnet'
                  ? <>{u.konto ?? '–'}{u.n > 1 ? <span className="muted small"> + {u.n - 1} weitere</span> : ''} <span className="muted small">· Nr. {u.buchung_id}</span>{st === 'gelb' && <div className="warn-text">gebucht {eur(Number(u.gebucht ?? 0))}</div>}</>
                  : u.status === 'ignoriert' ? <span className="pill">ignoriert</span> : <span className="pill ks-pill-gelb">offen</span>}</td>
                <td className={'num ' + (u.betrag < 0 ? 'neg' : '')}>{eur(Number(u.betrag))}</td>
                <td className="num">{eur(Number(u.stand))}</td>
              </tr>,
              u.status === 'offen' && pb.length > 0 && <tr key={u.id + 'h'} className="ks-gelb"><td /><td colSpan={6}>
                <div className="ks-hinweis"><span><b>Passende Buchung gefunden:</b> Nr. {pb[0].id} vom {datum(pb[0].datum)}, {eur(Number(pb[0].betrag))}{pb[0].einheit ? `, ${pb[0].einheit}` : ''}{pb[0].nummer ? `, ${pb[0].nummer} ${pb[0].konto}` : ''} (ohne Kontoumsatz).{pb.length > 1 ? ` ${pb.length - 1} weitere passen ebenfalls.` : ''} Verbinden statt neu buchen?</span>
                  <span className="grow" /><button className="primary small-btn" onClick={() => los(pb[0], u)}>Verbinden</button></div></td></tr>,
            ];
          })}
        </tbody>
      </table></div>
      <div className="ku-summe">
        <div><span>Anfang</span><b>{eur(liste?.start ?? 0)}</b></div>
        <div><span>Eingänge</span><b className="pos">{eur(ein)}</b></div>
        <div><span>Ausgänge</span><b className="neg">{eur(aus)}</b></div>
        <div><span>Ende</span><b>{eur(liste?.ende ?? 0)}</b></div>
      </div>
      <p className="muted small">Der Kontostand läuft Zeile für Zeile mit, wie auf dem Kontoauszug. Offene Umsätze buchst du oben unter „Aus dem Kontoauszug“ oder verbindest sie hier mit einer vorhandenen Buchung.</p>
    </section>
  );
}
