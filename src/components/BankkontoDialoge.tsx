// Fenster zum Bearbeiten und Löschen eines Bankkontos
import { useEffect, useState } from 'react';
import { Pencil, Trash2, X } from 'lucide-react';
import { db, sicherheit, type Row } from '../db';
import { bankkontoLoeschen, bankkontoSpeichern, bankkontoUmfang, ibanAnzeige, ibanGueltig, ibanNormal } from '../logic/bankkonto';

type Opt = { value: number; label: string };

export function BankkontoBearbeiten({ konto, onClose, onDone, onLoeschen }: {
  konto: Row; onClose: () => void; onDone: (info: string) => void; onLoeschen?: () => void;
}) {
  const [w, setW] = useState<Row>({ ...konto, iban: ibanAnzeige(konto.iban), anfangssaldo: konto.anfangssaldo == null ? '' : String(konto.anfangssaldo).replace('.', ',') });
  const [objekte, setObjekte] = useState<Opt[]>([]);
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { db.select<Opt>('SELECT id AS value, name AS label FROM objekte ORDER BY name').then(setObjekte); }, []);
  const set = (k: string, v: any) => setW({ ...w, [k]: v });
  const ibanNeu = ibanNormal(w.iban) !== ibanNormal(konto.iban);
  // Nur eine geänderte IBAN prüfen, damit ältere Einträge sich weiter speichern lassen
  const ibanOk = !ibanNeu || ibanGueltig(w.iban);

  async function speichern() {
    setFehler('');
    if (!String(w.name ?? '').trim()) { setFehler('Bitte eine Bezeichnung eingeben.'); return; }
    if (!w.objekt_id) { setFehler('Bitte das Objekt auswählen.'); return; }
    if (!ibanOk) { setFehler('Die IBAN ist nicht gültig. Bitte prüfen (Prüfziffer oder Länge stimmt nicht).'); return; }
    if (w.anfangssaldo !== '' && w.anfangssaldo != null && !Number.isFinite(Number(String(w.anfangssaldo).replace(',', '.')))) { setFehler('Der Anfangssaldo ist keine Zahl.'); return; }
    setBusy(true);
    try { onDone(await bankkontoSpeichern(konto, w)); }
    catch (e: any) { setFehler('Speichern fehlgeschlagen: ' + String(e?.message ?? e)); setBusy(false); }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-head"><h3 className="title-ico"><Pencil size={20} />Bankkonto bearbeiten</h3><button className="icon-btn" title="Schließen" onClick={onClose}><X size={18} /></button></div>
        <div className="form" onKeyDown={(e) => { if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); speichern(); } }}>
          <label><span>Objekt *</span>
            <select value={w.objekt_id ?? ''} onChange={(e) => set('objekt_id', e.target.value)}>
              <option value="">– bitte wählen –</option>
              {objekte.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select></label>
          <label><span>Bezeichnung *</span><input value={w.name ?? ''} autoFocus onChange={(e) => set('name', e.target.value)} placeholder="z. B. Hausgeldkonto" /></label>
          <label><span>Bank</span><input value={w.bank ?? ''} onChange={(e) => set('bank', e.target.value)} placeholder="z. B. Sparkasse KölnBonn" /></label>
          <label><span>BIC</span><input value={w.bic ?? ''} onChange={(e) => set('bic', e.target.value)} /></label>
          <label className="wide"><span>IBAN</span>
            <input value={w.iban ?? ''} onChange={(e) => set('iban', e.target.value)} onBlur={() => set('iban', ibanAnzeige(w.iban))} placeholder="DE00 0000 0000 0000 0000 00"
              style={!ibanOk ? { borderColor: 'var(--neg)' } : undefined} /></label>
          <label><span>Anfangssaldo (€)</span><input inputMode="decimal" value={w.anfangssaldo ?? ''} onChange={(e) => set('anfangssaldo', e.target.value)} /></label>
          <label><span>Saldo zum</span><input type="date" value={w.saldo_datum ?? ''} onChange={(e) => set('saldo_datum', e.target.value)} /></label>
        </div>
        {!ibanOk && <p className="error">Diese IBAN ist nicht gültig.</p>}
        {ibanOk && ibanNeu && konto.iban && <p className="warn small">Die IBAN wird geändert. Bereits importierte Umsätze bleiben bei diesem Konto. Gehört die neue IBAN zu einer anderen Bank, wird die Online-Banking-Verbindung getrennt.</p>}
        {fehler && <p className="error">{fehler}</p>}
        <div className="row end" style={{ marginTop: 14 }}>
          {onLoeschen && <button className="danger" onClick={onLoeschen} disabled={busy}><Trash2 size={15} />Konto löschen</button>}
          <span className="grow" />
          <button onClick={onClose} disabled={busy}>Abbrechen</button>
          <button className="primary" onClick={speichern} disabled={busy}>Speichern</button>
        </div>
      </div>
    </div>
  );
}

const WORT = 'LÖSCHEN';

export function BankkontoLoeschen({ konto, onClose, onDone }: { konto: Row; onClose: () => void; onDone: (info: string) => void }) {
  const [u, setU] = useState<Awaited<ReturnType<typeof bankkontoUmfang>> | null>(null);
  const [buchungenMit, setBuchungenMit] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState('');
  useEffect(() => { bankkontoUmfang(konto.id).then(setU); }, [konto.id]);
  const leer = !!u && u.umsaetze === 0;
  const ok = !!u && (leer || text.trim().toUpperCase() === WORT);
  const z = (n: number, eins: string, mehr: string) => `${n.toLocaleString('de-DE')} ${n === 1 ? eins : mehr}`;

  async function los() {
    if (!ok) return;
    setBusy(true); setFehler('');
    try {
      const s = await bankkontoLoeschen(konto.id, buchungenMit);
      onDone(`Das Bankkonto „${konto.name}“ wurde gelöscht.${s ? ' Vorher wurde automatisch eine Sicherung erstellt.' : ''}`);
    } catch (e: any) { setFehler('Löschen fehlgeschlagen, es wurde nichts gelöscht: ' + String(e?.message ?? e)); setBusy(false); }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="title-ico"><Trash2 size={20} />Bankkonto löschen</h3>
        <p><b>{konto.name}</b>{konto.iban ? <span className="muted"> · {ibanAnzeige(konto.iban)}</span> : null} wird endgültig gelöscht.</p>
        {!u && <p className="muted small">Prüfe, was zu diesem Konto gehört …</p>}
        {leer && <p className="muted">Zu diesem Konto gibt es keine Kontoumsätze. Es geht nichts weiter verloren.</p>}
        {u && !leer && <>
          <ul className="small">
            <li>{z(u.umsaetze, 'Kontoumsatz wird', 'Kontoumsätze werden')} mit gelöscht{u.zugeordnet ? `, davon ${z(u.zugeordnet, 'zugeordneter', 'zugeordnete')}` : ''}.</li>
            {u.buchungen > 0 && <li>Aus diesen Umsätzen {u.buchungen === 1 ? 'ist' : 'sind'} {z(u.buchungen, 'Buchung', 'Buchungen')} in der Buchhaltung entstanden.</li>}
          </ul>
          {u.buchungen > 0 && <div className="form" style={{ marginBottom: 6 }}>
            <label className="check wide"><input type="radio" name="bk-buchungen" checked={!buchungenMit} onChange={() => setBuchungenMit(false)} />
              <span><b>Buchungen behalten</b> (empfohlen). Zahlungseingänge, Ausgaben und Abrechnungen bleiben unverändert, nur der Bezug zum Kontoumsatz entfällt.</span></label>
            <label className="check wide"><input type="radio" name="bk-buchungen" checked={buchungenMit} onChange={() => setBuchungenMit(true)} />
              <span><b>Buchungen ebenfalls löschen.</b> Die betroffenen Mieten, Hausgelder und Rechnungen gelten danach wieder als offen.</span></label>
          </div>}
          <label><span>Zur Bestätigung <b>{WORT}</b> eintippen</span>
            <input value={text} autoFocus onChange={(e) => setText(e.target.value)} placeholder={WORT} onKeyDown={(e) => e.key === 'Enter' && los()} /></label>
        </>}
        <p className="muted small">Eine gespeicherte Online-Banking-PIN wird aus dem Schlüsselbund entfernt.{sicherheit.aktiv ? ' Vor dem Löschen wird automatisch eine Sicherung erstellt, mit der du alles zurückholen kannst.' : ''}</p>
        {fehler && <p className="error">{fehler}</p>}
        <div className="row end" style={{ marginTop: 14 }}>
          <span className="grow" />
          <button onClick={onClose} disabled={busy}>Abbrechen</button>
          <button className="danger-voll" onClick={los} disabled={!ok || busy}>{busy ? 'Wird gelöscht …' : leer ? 'Konto löschen' : 'Endgültig löschen'}</button>
        </div>
      </div>
    </div>
  );
}

/** Bearbeiten und Löschen als ein Ablauf: aus dem Bearbeiten-Fenster lässt sich das Löschen öffnen */
export function BankkontoVerwalten({ konto, modus, onClose, onDone }: {
  konto: Row; modus: 'bearbeiten' | 'loeschen'; onClose: () => void; onDone: (info: string) => void;
}) {
  const [m, setM] = useState(modus);
  useEffect(() => setM(modus), [modus, konto.id]);
  return m === 'bearbeiten'
    ? <BankkontoBearbeiten konto={konto} onClose={onClose} onDone={onDone} onLoeschen={() => setM('loeschen')} />
    : <BankkontoLoeschen konto={konto} onClose={onClose} onDone={onDone} />;
}
