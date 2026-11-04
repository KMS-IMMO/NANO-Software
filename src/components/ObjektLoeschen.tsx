// Bestätigungsdialog: Liegenschaft mit allen Daten löschen, nur nach Eintippen von LÖSCHEN
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { loeschUmfang, objektLoeschen } from '../logic/loeschen';
import { sicherheit } from '../db';

const WORT = 'LÖSCHEN';

export function ObjektLoeschen({ objekt, onClose, onDone }: { objekt: { id: number; name: string }; onClose: () => void; onDone: (info: string) => void }) {
  const [u, setU] = useState<Awaited<ReturnType<typeof loeschUmfang>> | null>(null);
  const [text, setText] = useState('');
  const [personen, setPersonen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState('');
  useEffect(() => { loeschUmfang(objekt.id).then(setU); }, [objekt.id]);
  const ok = text.trim().toUpperCase() === WORT;

  async function los() {
    if (!ok) return;
    setBusy(true); setFehler('');
    try {
      const s = await objektLoeschen(objekt.id, personen);
      onDone(`„${objekt.name}“ wurde mit allen Daten gelöscht.${s ? ' Vorher wurde automatisch eine Sicherung erstellt.' : ''}`);
    } catch (e: any) { setFehler('Löschen fehlgeschlagen, es wurde nichts gelöscht: ' + String(e?.message ?? e)); setBusy(false); }
  }

  const z = (n: number, eins: string, mehr: string) => `${n} ${n === 1 ? eins : mehr}`;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="title-ico"><Trash2 size={20} />Liegenschaft löschen</h3>
        <p><b>{objekt.name}</b> wird endgültig gelöscht, zusammen mit allen Daten, die dazugehören:</p>
        {u && <ul className="small">
          <li>{z(u.einheiten, 'Einheit', 'Einheiten')} mit Eigentum, Hausgeld und {z(u.vertraege, 'Mietvertrag', 'Mietverträgen')}</li>
          <li>{z(u.buchungen, 'Buchung', 'Buchungen')}, {z(u.posten, 'offener Posten', 'Soll-Posten')}, {z(u.rechnungen, 'Rechnung', 'Rechnungen')}</li>
          <li>{z(u.bankkonten, 'Bankkonto', 'Bankkonten')} mit allen Umsätzen</li>
          <li>Wirtschaftspläne, Rücklagen, Beschlüsse, Instandhaltung, Umlageschlüssel und {z(u.dokumente, 'Dokumenteintrag', 'Dokumenteinträge')}</li>
        </ul>}
        <label className="check"><input type="checkbox" checked={personen} onChange={(e) => setPersonen(e.target.checked)} />
          <span>Mieter und Eigentümer, die zu keiner anderen Liegenschaft gehören, ebenfalls löschen</span></label>
        <p className="muted small">Die Dateien im Ablageordner auf deinem Rechner bleiben erhalten.{sicherheit.aktiv ? ' Vor dem Löschen wird automatisch eine Sicherung erstellt, mit der du alles zurückholen kannst.' : ''}</p>
        <label><span>Zur Bestätigung <b>{WORT}</b> eintippen</span>
          <input value={text} autoFocus onChange={(e) => setText(e.target.value)} placeholder={WORT} /></label>
        {fehler && <p className="error">{fehler}</p>}
        <div className="row end" style={{ marginTop: 14 }}>
          <span className="grow" />
          <button onClick={onClose} disabled={busy}>Abbrechen</button>
          <button className="danger-voll" onClick={los} disabled={!ok || busy}>{busy ? 'Wird gelöscht …' : 'Endgültig löschen'}</button>
        </div>
      </div>
    </div>
  );
}
