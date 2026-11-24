// Liste aller Abschlüsse einer Liegenschaft (Hausgeld- bzw. Nebenkostenabrechnung), jüngstes Jahr zuerst.
// Erscheint, sobald es mindestens einen Abschluss gibt. Der jüngste Abschluss lässt sich löschen,
// danach ist das Jahr wieder offen und kann neu gebucht und erneut abgeschlossen werden.
import { useEffect, useState } from 'react';
import { History, Lock, Trash2, X, ArrowRight } from 'lucide-react';
import { sicherheit } from '../db';
import { ABSCHLUSS_TEXT, abschluesseListe, abschlussLoeschen, type AbschlussArt, type AbschlussEintrag } from '../logic/abschluss';
import { eur } from './EntityTable';

const datum = (d: string) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('de-DE') : '');
const WORT = 'LÖSCHEN';

export function AbschlussListe({ objekt, art, jahr, stand, onJahr, onGeloescht }: {
  objekt: number; art: AbschlussArt; jahr: number; stand?: number;
  onJahr: (jahr: number) => void; onGeloescht: (jahr: number, info: string) => void;
}) {
  const [liste, setListe] = useState<AbschlussEintrag[]>([]);
  const [weg, setWeg] = useState<AbschlussEintrag | null>(null);
  const name = ABSCHLUSS_TEXT[art];

  async function laden() { setListe(objekt ? await abschluesseListe(objekt, art) : []); }
  useEffect(() => { laden(); }, [objekt, art, stand]);
  useEffect(() => { const f = () => laden(); window.addEventListener('nano-abschluss', f); return () => window.removeEventListener('nano-abschluss', f); }, [objekt, art]);

  if (!liste.length) return null;
  const ergebnisText = (e: AbschlussEintrag['ergebnis']) => art === 'WEG'
    ? [e.ausgaben != null && `Ausgaben ${eur(e.ausgaben)}`, e.spitzen != null && `Spitzen ${eur(e.spitzen)}`, e.einheiten != null && `${e.einheiten} Einheiten`]
    : [e.kosten != null && `Kosten ${eur(e.kosten)}`, e.saldo != null && `Saldo ${eur(e.saldo)}`, e.mieter != null && `${e.mieter} Mieter`];

  return (
    <section className="card abschluss-liste">
      <div className="card-head">
        <h2 className="title-ico"><History size={20} />Abschlüsse {name}</h2>
        <span className="muted small">{liste.length} {liste.length === 1 ? 'Jahr' : 'Jahre'} abgeschlossen</span>
      </div>
      <table className="list">
        <thead><tr><th>Jahr</th><th>Abgeschlossen am</th><th>Ergebnis</th><th>Offene Posten aus dem Ergebnis</th><th className="aktionen"></th></tr></thead>
        <tbody>{liste.map((a) => (
          <tr key={a.id} className={a.jahr === jahr ? 'aktiv' : ''}>
            <td><b>{a.jahr}</b></td>
            <td><span className="pill st-aktiv"><Lock size={12} /> {datum(a.abgeschlossen_am)}</span></td>
            <td className="small">{ergebnisText(a.ergebnis).filter(Boolean).join(' · ') || <span className="muted">–</span>}</td>
            <td className="small">{a.posten ? `${a.posten} gebucht${a.bezahlt ? `, davon ${a.bezahlt} bezahlt` : ''}` : <span className="muted">nicht gebucht</span>}</td>
            <td className="aktionen">
              {a.jahr !== jahr && <button className="link" onClick={() => onJahr(a.jahr)}>Öffnen <ArrowRight size={14} /></button>}
              {a.juengster
                ? <button className="icon-btn danger" title={`Abschluss ${a.jahr} löschen`} onClick={() => setWeg(a)}><Trash2 size={16} /></button>
                : <button className="icon-btn" disabled title={`Erst den Abschluss ${liste[0].jahr} löschen`}><Trash2 size={16} /></button>}
            </td>
          </tr>))}
        </tbody>
      </table>
      <p className="muted small">Löschen öffnet das Jahr wieder: Buchungen und Rechnungen lassen sich ändern, danach schließt du die Abrechnung neu ab. Es lässt sich immer nur der jüngste Abschluss löschen, weil das Folgejahr darauf aufbaut.</p>
      {weg && <LoeschenDialog objekt={objekt} a={weg} art={art} onClose={() => setWeg(null)} onDone={async (info) => {
        const j = weg.jahr; setWeg(null); await laden(); window.dispatchEvent(new Event('nano-abschluss')); onGeloescht(j, info);
      }} />}
    </section>
  );
}

function LoeschenDialog({ objekt, a, art, onClose, onDone }: { objekt: number; a: AbschlussEintrag; art: AbschlussArt; onClose: () => void; onDone: (info: string) => void }) {
  const [grund, setGrund] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState('');
  const name = ABSCHLUSS_TEXT[art];
  const ok = text.trim().toUpperCase() === WORT && !busy;
  const offen = a.posten - a.bezahlt;

  async function los() {
    if (!ok) return;
    setBusy(true); setFehler('');
    try {
      const r = await abschlussLoeschen(objekt, a.jahr, art, grund);
      onDone(`Abschluss der ${name} ${a.jahr} gelöscht. Das Jahr ist wieder offen und kann neu gebucht werden.`
        + (r.posten ? (r.posten === 1 ? ' 1 offener Posten aus dem Ergebnis wurde entfernt.' : ` ${r.posten} offene Posten aus dem Ergebnis wurden entfernt.`) : '')
        + (r.bezahlt ? (r.bezahlt === 1 ? ' 1 schon bezahlter Posten bleibt stehen.' : ` ${r.bezahlt} schon bezahlte Posten bleiben stehen.`) : '')
        + (r.sicherung ? ' Vorher wurde automatisch eine Sicherung erstellt.' : ''));
    } catch (e: any) { setFehler('Löschen fehlgeschlagen, es wurde nichts geändert: ' + String(e?.message ?? e)); setBusy(false); }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-head"><h3 className="title-ico"><Trash2 size={20} />Abschluss {a.jahr} löschen</h3><button className="icon-btn" title="Schließen" onClick={onClose}><X size={18} /></button></div>
        <p>Der Abschluss der <b>{name} {a.jahr}</b> vom {datum(a.abgeschlossen_am)} wird gelöscht.</p>
        <ul className="small">
          <li>Das Jahr {a.jahr} ist danach wieder offen: Buchungen und Rechnungen lassen sich ändern.</li>
          {offen > 0 && <li>{offen === 1 ? '1 offener Posten' : `${offen} offene Posten`} aus dem Ergebnis ({art === 'WEG' ? 'Abrechnungsspitzen' : 'Nachzahlungen/Guthaben'}) {offen === 1 ? 'wird' : 'werden'} entfernt.</li>}
          {a.bezahlt > 0 && <li><b>{a.bezahlt === 1 ? '1 Posten ist' : `${a.bezahlt} Posten sind`} schon bezahlt</b> und {a.bezahlt === 1 ? 'bleibt' : 'bleiben'} stehen. Nach dem neuen Abschluss prüfst du den Betrag.</li>}
          <li>Bereits abgelegte PDFs bleiben in der Ablage. Nach dem neuen Abschluss legst du sie neu ab.</li>
        </ul>
        <div className="form">
          <label><span>Grund (für das Änderungsprotokoll, freiwillig)</span>
            <input value={grund} onChange={(e) => setGrund(e.target.value)} placeholder="z. B. Rechnung Hausmeister Dezember nachgebucht" /></label>
          <label><span>Zur Bestätigung <b>{WORT}</b> eintippen</span>
            <input value={text} autoFocus onChange={(e) => setText(e.target.value)} placeholder={WORT} onKeyDown={(e) => e.key === 'Enter' && los()} /></label>
        </div>
        <p className="muted small">Der Vorgang steht mit Datum im Änderungsprotokoll.{sicherheit.aktiv ? ' Vor dem Löschen wird automatisch eine Sicherung der Datenbank erstellt.' : ''}</p>
        {fehler && <p className="error">{fehler}</p>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onClose}>Abbrechen</button>
          <button className="danger-voll" disabled={!ok} onClick={los}><Trash2 size={16} />{busy ? 'Wird gelöscht …' : 'Abschluss löschen'}</button>
        </div>
      </div>
    </div>
  );
}
