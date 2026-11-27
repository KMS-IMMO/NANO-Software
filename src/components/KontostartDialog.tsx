// Fenster „Kontostand zum 01.01.“: je Bankkonto den Anfangsstand des Jahres von Hand eingeben, ändern oder entfernen.
// Gedacht für Jahre, die ganz oder teilweise ohne eingelesene Kontoauszüge gebucht werden.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, X } from 'lucide-react';
import { kontostand, type Kontostand } from '../logic/kontostand';
import { betragLesen, startSpeichern } from '../logic/kontostart';
import { BetragFeld } from './BetragFeld';
import { datum, eur } from './EntityTable';

const ibanAnzeige = (s: string) => s.replace(/\s/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();
const feld = (n: number | null) => (n === null ? '' : n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const tagDanach = (d: string) => new Date(new Date(d + 'T12:00:00').getTime() + 864e5).toISOString().slice(0, 10);

export function KontostartDialog({ objekt, jahr, k, onClose, onDone }: {
  objekt: number; jahr: number; k: Kontostand; onClose: () => void; onDone: () => void;
}) {
  const [w, setW] = useState<Record<number, string>>(() => Object.fromEntries(k.konten.map((z) => [z.id, feld(z.manuell)])));
  const [vorjahr, setVorjahr] = useState<number | null>(null);
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);
  // Endstand des Vorjahres laut Buchungen als Vorschlag, nur bei einem Bankkonto (Buchungen hängen nicht an einem bestimmten Konto)
  useEffect(() => { if (k.konten.length === 1) kontostand(objekt, jahr - 1).then((v) => setVorjahr(v ? v.buchungen : null)); }, [objekt, jahr, k.konten.length]);
  const set = (id: number, v: string) => setW((x) => ({ ...x, [id]: v }));

  async function speichern() {
    setFehler('');
    const werte = k.konten.map((z) => ({ z, n: betragLesen(w[z.id] ?? '') }));
    const falsch = werte.find((x) => x.n !== null && !Number.isFinite(x.n));
    if (falsch) { setFehler(`Der Betrag bei „${falsch.z.name}“ ist keine Zahl. Bitte z. B. 12.345,67 eingeben.`); return; }
    setBusy(true);
    try {
      for (const { z, n } of werte) if (n !== z.manuell) await startSpeichern(z.id, jahr, n);
      onDone();
    } catch (e: any) { setFehler('Speichern fehlgeschlagen: ' + String(e?.message ?? e)); setBusy(false); }
  }

  // Über document.body, weil die Kontostand-Leiste (sticky, Weichzeichner) sonst das Fenster einschließt
  return createPortal(
    <div className="modal-bg" onClick={onClose}>
      <div className="modal ks-start" onClick={(e) => e.stopPropagation()}>
        <div className="card-head"><h3 className="title-ico"><Pencil size={20} />Kontostand zum 01.01.{jahr}</h3><button className="icon-btn" title="Schließen" onClick={onClose}><X size={18} /></button></div>
        <p className="muted small">Buchst du das Jahr ganz oder teilweise ohne Kontoauszüge, gib hier den Kontostand am 01.01.{jahr} ein, z. B. vom Kontoauszug zum 31.12.{jahr - 1}.
          Er ist der Anfang von „Stand laut Buchungen“ und fließt in die Differenz ein. Leer lassen heißt: der Stand kommt aus Anfangssaldo und Kontoumsätzen.</p>
        <div className="ks-start-liste" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); speichern(); } }}>
          {k.konten.map((z, i) => {
            const spaet = !!z.saldoDatum && z.saldoDatum >= `${jahr}-02-01`;
            return (
              <div key={z.id} className="ks-start-zeile">
                <div className="ks-start-konto"><b>{z.name}</b>{z.iban ? <div className="muted small">{ibanAnzeige(z.iban)}</div> : null}</div>
                <label className="ks-start-feld"><span>Stand 01.01.{jahr} (€)</span>
                  <BetragFeld value={w[z.id] ?? ''} autoFocus={i === 0} placeholder={feld(z.lautUmsaetzen)} aria-label={`Stand 01.01.${jahr} ${z.name}`}
                    onChange={(e) => set(z.id, e.target.value)} onBlur={() => { const n = betragLesen(w[z.id] ?? ''); if (n !== null && Number.isFinite(n)) set(z.id, feld(n)); }} /></label>
                <div className="ks-start-vorschlag small">
                  <span className="muted">Laut Kontoumsätzen: {eur(z.lautUmsaetzen)}</span>
                  <button className="link" onClick={() => set(z.id, feld(z.lautUmsaetzen))}>übernehmen</button>
                  {vorjahr !== null && <><span className="muted">· Endstand {jahr - 1} laut Buchungen: {eur(vorjahr)}</span>
                    <button className="link" onClick={() => set(z.id, feld(vorjahr))}>übernehmen</button></>}
                  {(w[z.id] ?? '') !== '' && <button className="link" onClick={() => set(z.id, '')}>leeren</button>}
                </div>
                {spaet && <p className="ks-start-hinweis small">Die Kontoumsätze dieses Kontos beginnen erst am {datum(tagDanach(z.saldoDatum!))}. Der Stand laut Bank bleibt beim
                  Anfangssaldo vom Kontoauszug, der Wert hier gilt für den Stand laut Buchungen. Buchungen davor zählen dann mit.</p>}
              </div>);
          })}
        </div>
        {fehler && <p className="error">{fehler}</p>}
        <div className="row end" style={{ marginTop: 14 }}>
          <span className="grow" />
          <button onClick={onClose} disabled={busy}>Abbrechen</button>
          <button className="primary" onClick={speichern} disabled={busy}>Speichern</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
