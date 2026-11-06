// Belege (PDF, Bilder) zu einer Buchung: hochladen, öffnen, aus der Liste entfernen.
// Dateien liegen in der Ablage unter <Liegenschaft>/Belege/<Jahr>, der Rechnungsbeleg wird mit angezeigt.
import { useEffect, useRef, useState } from 'react';
import { FileUp, Paperclip, Trash2 } from 'lucide-react';
import { db, type Row } from '../db';
import { oeffnen, speichern } from '../lib/dateien';

export const BELEGE_SQL = `(SELECT COUNT(*) FROM dokumente d WHERE d.bezug = 'Buchung' AND d.bezug_id = b.id)
  + (SELECT COUNT(*) FROM rechnungen rr JOIN dokumente rd ON rd.id = rr.dokument_id WHERE rr.id = b.rechnung_id)`;

export function BuchungBelege({ buchung, onChange }: { buchung: Row; onChange?: () => void }) {
  const [docs, setDocs] = useState<Row[]>([]);
  const [over, setOver] = useState(false);
  const [info, setInfo] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const load = async () => setDocs(await db.select(`
    SELECT d.*, 0 AS rechnung FROM dokumente d WHERE d.bezug = 'Buchung' AND d.bezug_id = $1
    UNION ALL SELECT d.*, 1 AS rechnung FROM rechnungen r JOIN dokumente d ON d.id = r.dokument_id WHERE r.id = $2
    ORDER BY rechnung DESC, id DESC`, [buchung.id, buchung.rechnung_id ?? -1]));
  useEffect(() => { load(); }, [buchung.id]);

  async function hochladen(files: FileList | File[]) {
    const liste = Array.from(files);
    if (!liste.length) return;
    const o = (await db.select('SELECT name FROM objekte WHERE id = $1', [buchung.objekt_id]))[0]?.name ?? 'Ohne Liegenschaft';
    for (const f of liste) {
      const name = /^\d{4}-\d{2}-\d{2}/.test(f.name) ? f.name : `${buchung.datum} Bu ${buchung.id} ${f.name}`;
      await speichern(new Uint8Array(await f.arrayBuffer()), name, { bezug: 'Buchung', bezugId: buchung.id, ordner: [o, 'Belege', String(buchung.datum).slice(0, 4)] });
    }
    setInfo(`${liste.length} Beleg${liste.length > 1 ? 'e' : ''} hinterlegt.`); await load(); onChange?.();
  }
  async function entfernen(d: Row) {
    if (!confirm(`„${d.dateiname}“ von der Buchung lösen? Die Datei bleibt in der Ablage.`)) return;
    await db.execute('DELETE FROM dokumente WHERE id = $1', [d.id]); await load(); onChange?.();
  }

  return (
    <div className="belege">
      <div className="belege-kopf"><b><Paperclip size={15} /> Belege zur Buchung</b>
        <button type="button" onClick={() => ref.current?.click()}><FileUp size={15} />Datei anhängen</button></div>
      <div className={'drop' + (over ? ' over' : '')} style={{ padding: 12 }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); hochladen(e.dataTransfer.files); }} onClick={() => ref.current?.click()}>
        <p className="muted small" style={{ margin: 0 }}>PDF, Foto oder Kontoauszug hierher ziehen oder klicken</p>
      </div>
      <input ref={ref} type="file" multiple accept=".pdf,image/*,.doc,.docx,.xlsx" hidden onChange={(e) => { if (e.target.files) hochladen(e.target.files); e.target.value = ''; }} />
      {info && <p className="info">{info}</p>}
      {docs.length > 0 ? <table className="list belege-liste"><tbody>
        {docs.map((d) => <tr key={`${d.rechnung}-${d.id}`}>
          <td><button type="button" className="link" onClick={() => oeffnen(d.pfad)}><Paperclip size={14} /> {d.dateiname}</button>{d.rechnung ? <span className="tag">Rechnung</span> : null}</td>
          <td className="muted small nowrap">{String(d.hinzugefuegt ?? '').split('-').reverse().join('.')}</td>
          <td style={{ width: 40 }}>{!d.rechnung && <button type="button" className="icon-btn" title="Von der Buchung lösen" onClick={() => entfernen(d)}><Trash2 size={15} /></button>}</td></tr>)}
      </tbody></table> : <p className="muted small">Noch kein Beleg hinterlegt.</p>}
    </div>
  );
}
