// Papierkorb: gelöschte Datensätze 30 Tage ansehen und wiederherstellen
import { useEffect, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { db, type Row } from '../db';
import { AUFBEWAHREN_TAGE, aufraeumen, entfernen, umfang, wiederherstellen } from '../db/papierkorb';

const zeit = (s: string) => { const d = new Date(s.replace(' ', 'T')); return d.toLocaleDateString('de-DE') + ', ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr'; };
const restTage = (s: string) => Math.max(0, AUFBEWAHREN_TAGE - Math.floor((Date.now() - new Date(s.replace(' ', 'T')).getTime()) / 864e5));

export function PapierkorbPage() {
  const [liste, setListe] = useState<Row[]>([]);
  const [info, setInfo] = useState(''); const [fehler, setFehler] = useState('');
  const [filter, setFilter] = useState('');
  const laden = async () => { await aufraeumen(); setListe(await db.select('SELECT * FROM papierkorb ORDER BY geloescht_am DESC, id DESC')); };
  useEffect(() => { laden(); }, []);

  async function zurueck(e: Row) {
    setInfo(''); setFehler('');
    try { await wiederherstellen(e.id); setInfo(`${e.art}${e.bezeichnung ? ` „${e.bezeichnung}“` : ''} ist wiederhergestellt.`); laden(); }
    catch (x: any) { setFehler(String(x?.message ?? x)); }
  }
  async function weg(e: Row) {
    if (!confirm(`${e.art}${e.bezeichnung ? ` „${e.bezeichnung}“` : ''} endgültig löschen? Das lässt sich nicht rückgängig machen.`)) return;
    await entfernen(e.id); laden();
  }
  const arten = [...new Set(liste.map((e) => String(e.art).replace(/ \(\d+\)$/, '')))].sort();
  const sicht = filter ? liste.filter((e) => String(e.art).startsWith(filter)) : liste;

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="title-ico"><Trash2 size={22} />Papierkorb</h2>
        {arten.length > 1 && <select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">Alle Arten</option>{arten.map((a) => <option key={a}>{a}</option>)}</select>}
      </div>
      <p className="muted">Was du löschst, liegt hier {AUFBEWAHREN_TAGE} Tage. Mit „Wiederherstellen“ kommt es samt allem, was mitgelöscht wurde (z. B. offene Posten eines Mietvertrags), zurück. Danach wird es endgültig entfernt.</p>
      {info && <p className="info">{info}</p>}
      {fehler && <p className="error">{fehler}</p>}
      {sicht.length === 0 ? <p className="muted">Der Papierkorb ist leer.</p> : (
        <div className="tablewrap"><table className="list">
          <thead><tr><th>Gelöscht am</th><th>Art</th><th>Bezeichnung</th><th>Enthält</th><th className="num">Noch</th><th /></tr></thead>
          <tbody>{sicht.map((e) => (
            <tr key={e.id}>
              <td>{zeit(e.geloescht_am)}</td><td><b>{e.art}</b></td><td>{e.bezeichnung || <span className="muted">–</span>}</td>
              <td className="muted small">{umfang(e.daten)}</td><td className="num">{restTage(e.geloescht_am)} Tage</td>
              <td className="actions" style={{ whiteSpace: 'nowrap' }}>
                <button className="primary" onClick={() => zurueck(e)}><RotateCcw size={15} />Wiederherstellen</button>
                <button className="icon-btn" title="Endgültig löschen" onClick={() => weg(e)}><Trash2 size={16} /></button>
              </td>
            </tr>))}
          </tbody></table></div>)}
    </section>
  );
}
