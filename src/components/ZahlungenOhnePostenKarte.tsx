// Karte in der Jahresabrechnung: Zahlungseingänge ohne offenen Posten (z. B. beim Zuordnen falsche Person gewählt)
// mit Vorschlag des richtigen Zahlers und „Neu zuordnen“.
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { db } from '../db';
import { objektPersonenSql } from '../db/labels';
import { datum, eur } from './EntityTable';
import { zahlungNeuZuordnen, type ZahlungOhnePosten } from '../logic/zahlungenOhnePosten';

export function ZahlungenOhnePostenKarte({ objekt, jahr, liste, gesperrt, onChanged }:
  { objekt: number; jahr: number; liste: ZahlungOhnePosten[]; gesperrt?: boolean; onChanged: (text: string) => void }) {
  const [personen, setPersonen] = useState<{ value: number; label: string; gruppe: string; aktiv: number }[]>([]);
  const [wahl, setWahl] = useState<Record<number, string>>({});
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { db.select(objektPersonenSql(objekt)).then((l) => setPersonen(l as any)); }, [objekt]);
  useEffect(() => { setWahl(Object.fromEntries(liste.map((z) => [z.buchungId, z.vorschlag ? String(z.vorschlag) : '']))); }, [liste]);
  if (!liste.length) return null;

  async function zuordnen(z: ZahlungOhnePosten) {
    const pid = Number(wahl[z.buchungId]);
    if (!pid) return;
    if (z.teile > 1 && !window.confirm(`Dieser Bankumsatz über ${eur(z.umsatzBetrag)} ist in ${z.teile} Buchungen aufgeteilt. Beim neuen Zuordnen wird der ganze Umsatz auf die offenen Posten der gewählten Person verteilt. Fortfahren?`)) return;
    setFehler(''); setBusy(true);
    try {
      await zahlungNeuZuordnen(z.bankumsatzId, pid);
      onChanged(`Zahlung vom ${datum(z.datum)} über ${eur(z.umsatzBetrag)} neu zugeordnet: ${personen.find((p) => p.value === pid)?.label ?? ''}.`);
    } catch (e) { setFehler(String((e as Error)?.message ?? e)); }
    setBusy(false);
  }
  const gruppen = [...new Set(personen.map((p) => p.gruppe))];
  return (
    <section className="card abr-uebersicht">
      <div className="card-head"><h2 className="title-ico"><AlertTriangle size={20} />Zahlungen ohne offenen Posten {jahr}</h2></div>
      <p className="muted small">Diese Zahlungseingänge sind keinem Hausgeld- bzw. Miet-Posten zugeordnet. Meist wurde beim Zuordnen eine falsche Person gewählt
        oder die Zahlung frei gebucht. Dann steht beim eigentlichen Zahler eine Forderung offen, obwohl das Geld auf dem Konto ist. Mit „Neu zuordnen“ wird die Zahlung
        auf die offenen Posten des gewählten Eigentümers bzw. Mieters verteilt (älteste zuerst oder der Monat aus dem Verwendungszweck).</p>
      <table className="list">
        <thead><tr><th>Datum</th><th>Auftraggeber / Verwendungszweck</th><th className="num">Betrag</th><th>Bisher gebucht</th><th>Auffällig</th><th style={{ width: 300 }}>Zahler</th></tr></thead>
        <tbody>{liste.map((z) => (
          <tr key={z.buchungId}>
            <td className="nowrap">{datum(z.datum)}</td>
            <td>{z.gegenpartei}<div className="muted small">{z.zweck.slice(0, 80)}</div></td>
            <td className="num nowrap"><b>{eur(z.betrag)}</b></td>
            <td className="small">{z.konto}{z.einheit ? ` · ${z.einheit}` : ' · ohne Einheit'}</td>
            <td className="small neg">{z.grund}</td>
            <td><div className="row">
              <select value={wahl[z.buchungId] ?? ''} disabled={gesperrt || busy} onChange={(e) => setWahl({ ...wahl, [z.buchungId]: e.target.value })} style={{ flex: 1, minWidth: 0 }}>
                <option value="">Zahler wählen …</option>
                {gruppen.map((g) => <optgroup key={g} label={g}>{personen.filter((p) => p.gruppe === g).map((p) =>
                  <option key={g + p.value} value={p.value}>{p.label}{!p.aktiv ? ' (früher)' : ''}</option>)}</optgroup>)}
              </select>
              <button className="primary small-btn" disabled={gesperrt || busy || !wahl[z.buchungId]} onClick={() => zuordnen(z)}>Neu zuordnen</button>
            </div></td>
          </tr>))}
        </tbody>
      </table>
      {gesperrt && <p className="muted small">Das Jahr ist abgeschlossen. Zum Ändern zuerst den Abschluss aufheben.</p>}
      {fehler && <p className="error small">{fehler}</p>}
    </section>
  );
}
