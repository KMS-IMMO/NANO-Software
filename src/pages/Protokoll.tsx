// Änderungsprotokoll: was wurde wann an Buchungen, Rechnungen, offenen Posten, Abschlüssen und Bankumsätzen geändert.
// Die Einträge schreibt die Datenbank selbst (Trigger), sie lassen sich in der App nicht ändern.
import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { db, type Row } from '../db';
import { betragText } from '../lib/betrag';

const TABELLEN: Record<string, string> = { buchungen: 'Buchung', rechnungen: 'Rechnung', sollstellungen: 'Offener Posten', abrechnungen: 'Abschluss', bankumsaetze: 'Bankumsatz' };
const zeit = (s: string) => { const d = new Date(String(s).replace(' ', 'T')); return isNaN(d.getTime()) ? String(s) : d.toLocaleDateString('de-DE') + ', ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr'; };
const datum = (s: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? String(s).split('-').reverse().join('.') : String(s));

/** Inhalt lesbar: Datum, Betrag, Text, Status und Begründung */
function inhaltText(t: string, j: string | null): string {
  let x: Row = {};
  try { x = JSON.parse(j ?? '{}') ?? {}; } catch { return ''; }
  const teile: string[] = [];
  if (x.datum) teile.push(datum(x.datum));
  if (x.monat) teile.push(String(x.monat));
  if (x.art) teile.push(String(x.art));
  if (x.jahr && t === 'abrechnungen') teile.push(String(x.jahr));
  if (x.betrag !== null && x.betrag !== undefined && x.betrag !== '') teile.push(betragText(Number(x.betrag)) + ' €');
  if (x.text) teile.push(String(x.text));
  if (x.rechnungsnr) teile.push('Nr. ' + x.rechnungsnr);
  if (x.gegenpartei) teile.push(String(x.gegenpartei));
  if (x.status) teile.push('Status: ' + x.status);
  if (x.bezahlt_am) teile.push('bezahlt ' + datum(x.bezahlt_am));
  if (x.aufhebung_grund) teile.push('Grund: ' + x.aufhebung_grund);
  return teile.join(' · ');
}

export function ProtokollPage() {
  const [liste, setListe] = useState<Row[]>([]);
  const [filter, setFilter] = useState('');
  const [suche, setSuche] = useState('');
  useEffect(() => {
    db.select(`SELECT p.*, COALESCE(o.name, '') AS objekt FROM protokoll p
      LEFT JOIN objekte o ON o.id = CAST(json_extract(p.inhalt, '$.objekt_id') AS INTEGER)
      ${filter ? 'WHERE p.tabelle = $1' : ''} ORDER BY p.id DESC LIMIT 1000`, filter ? [filter] : []).then(setListe).catch(() => setListe([]));
  }, [filter]);
  const n = suche.trim().toLowerCase();
  const sicht = n ? liste.filter((e) => `${e.objekt} ${inhaltText(e.tabelle, e.inhalt)}`.toLowerCase().includes(n)) : liste;
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="title-ico"><History size={22} />Änderungsprotokoll</h2>
        <div className="row">
          <input placeholder="Suchen …" value={suche} onChange={(e) => setSuche(e.target.value)} />
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">Alles</option>
            {Object.entries(TABELLEN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      <p className="muted">Jede neue, geänderte oder gelöschte Buchung, Rechnung, jeder geänderte offene Posten, jeder Abschluss und jeder gelöschte Bankumsatz wird hier mit Zeitpunkt festgehalten. Angezeigt werden die letzten 1.000 Einträge.</p>
      {sicht.length === 0 ? <p className="muted">Noch keine Einträge.</p> : (
        <div className="tablewrap"><table className="list">
          <thead><tr><th>Zeitpunkt</th><th>Was</th><th>Aktion</th><th>Liegenschaft</th><th>Inhalt</th></tr></thead>
          <tbody>{sicht.map((e) => (
            <tr key={e.id}>
              <td className="nowrap">{zeit(e.zeit)}</td>
              <td>{TABELLEN[e.tabelle] ?? e.tabelle} {e.datensatz ? <span className="muted">#{e.datensatz}</span> : null}</td>
              <td><span className={'pill' + (e.aktion === 'gelöscht' ? ' st-mahnen' : '')}>{e.aktion}</span></td>
              <td>{e.objekt}</td>
              <td className="small">{inhaltText(e.tabelle, e.inhalt)}</td>
            </tr>))}
          </tbody>
        </table></div>)}
    </section>
  );
}
