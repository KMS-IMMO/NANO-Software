// Stammdaten einer Person mit Vertrag bzw. Eigentum: alle Angaben wie beim Anlegen, zum Ansehen und Bearbeiten
import { useState, type ReactNode } from 'react';
import { Pencil, Save, X } from 'lucide-react';
import type { Row } from '../db';
import { datum, eur } from './EntityTable';
import { BetragFeld } from './BetragFeld';
import { betragText, betragZahl } from '../lib/betrag';

export type SFeld = {
  key: string; label: string;
  typ?: 'text' | 'datum' | 'geld' | 'zahl' | 'auswahl' | 'lang';
  optionen?: { value: string; label: string }[];
  breit?: 2 | 3;
  nurLesen?: boolean;
  pflicht?: boolean;
  /** Anzeige statt des Werts (z. B. berechnete Angaben) */
  anzeige?: ReactNode;
};
export type SGruppe = { titel: string; felder: SFeld[] };

const zahlStr = (v: any) => (v === null || v === undefined || v === '' ? '' : betragText(Number(v)));
const zahlIn = (s: string) => betragZahl(s);

function anzeigen(f: SFeld, v: any): ReactNode {
  if (f.anzeige !== undefined) return f.anzeige;
  if (f.typ === 'auswahl') { const o = f.optionen?.find((x) => x.value === String(v ?? '')); if (o && o.value !== '') return o.label; if (o && o.label !== '–') return o.label; }
  if (v === null || v === undefined || v === '') return <span className="muted">–</span>;
  switch (f.typ) {
    case 'datum': return datum(v);
    case 'geld': return eur(v);
    case 'auswahl': return f.optionen?.find((o) => o.value === String(v))?.label ?? String(v);
    default: return String(v);
  }
}

export function StammdatenKarte({ titel, icon, gruppen, werte, onSpeichern }: {
  titel: string; icon?: ReactNode; gruppen: SGruppe[]; werte: Row;
  /** Bekommt nur die geänderten Felder; gibt einen Hinweistext zurück */
  onSpeichern: (neu: Row, alt: Row) => Promise<string | void>;
}) {
  const [bearbeiten, setBearbeiten] = useState(false);
  const [d, setD] = useState<Record<string, string>>({});
  const [info, setInfo] = useState('');
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);
  const felder = gruppen.flatMap((g) => g.felder).filter((f) => !f.nurLesen && f.anzeige === undefined);

  const start = () => {
    setD(Object.fromEntries(felder.map((f) => [f.key, f.typ === 'geld' ? zahlStr(werte[f.key]) : werte[f.key] == null ? '' : f.typ === 'zahl' ? String(werte[f.key]).replace('.', ',') : String(werte[f.key])])));
    setInfo(''); setFehler(''); setBearbeiten(true);
  };
  const speichern = async () => {
    const neu: Row = {};
    for (const f of felder) {
      const s = d[f.key] ?? '';
      if (f.pflicht && !s.trim()) { setFehler(`Bitte „${f.label}“ ausfüllen.`); return; }
      const wert = f.typ === 'geld' || f.typ === 'zahl' ? zahlIn(s) : s.trim() || null;
      if ((f.typ === 'geld' || f.typ === 'zahl') && s.trim() && wert === null) { setFehler(`„${f.label}“ ist keine gültige Zahl.`); return; }
      const alt = werte[f.key] === undefined || werte[f.key] === '' ? null : werte[f.key];
      const gleich = f.typ === 'geld' || f.typ === 'zahl' ? (alt === null ? wert === null : wert !== null && Math.abs(Number(alt) - Number(wert)) < 0.005) : String(alt ?? '') === String(wert ?? '');
      if (!gleich) neu[f.key] = wert;
    }
    if (!Object.keys(neu).length) { setBearbeiten(false); setInfo('Keine Änderungen.'); return; }
    setBusy(true); setFehler('');
    try {
      const t = await onSpeichern(neu, werte);
      setBearbeiten(false); setInfo(t || 'Gespeichert.');
    } catch (e) { setFehler(String((e as Error)?.message ?? e)); }
    finally { setBusy(false); }
  };

  return (
    <section className="card stammdaten">
      <div className="card-head">
        <h2 className="title-ico">{icon}{titel}</h2>
        {bearbeiten
          ? <div className="row"><button onClick={() => { setBearbeiten(false); setFehler(''); }}><X size={16} />Abbrechen</button>
              <button className="primary" disabled={busy} onClick={speichern}><Save size={16} />{busy ? 'Speichere …' : 'Speichern'}</button></div>
          : <button onClick={start}><Pencil size={16} />Bearbeiten</button>}
      </div>
      {info && <p className="info">{info}</p>}
      {fehler && <p className="error">{fehler}</p>}
      {gruppen.map((g, i) => (
        <div key={g.titel} className="erin-schritt mieter-abschnitt stammdaten-gruppe" style={{ animationDelay: `${40 + i * 60}ms` }}>
          <span className="erin-nr">{i + 1}</span>
          <div className="erin-feld"><span className="erin-label">{g.titel}</span>
            <div className="mieter-raster">
              {g.felder.map((f) => {
                const cls = f.breit === 2 ? 'breit2' : f.breit === 3 ? 'breit3' : undefined;
                const editierbar = bearbeiten && !f.nurLesen && f.anzeige === undefined;
                if (!editierbar) return <label key={f.key} className={cls}><span>{f.label}</span><b className="stammdaten-wert">{anzeigen(f, werte[f.key])}</b></label>;
                const set = (x: { target: { value: string } }) => setD({ ...d, [f.key]: x.target.value });
                const v = d[f.key] ?? '';
                return (
                  <label key={f.key} className={cls}><span>{f.label}{f.pflicht ? ' *' : ''}</span>
                    {f.typ === 'auswahl'
                      ? <select value={v} onChange={set}>{f.optionen?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                      : f.typ === 'lang' ? <textarea rows={2} value={v} onChange={set} />
                      : f.typ === 'datum' ? <input type="date" value={v} onChange={set} />
                      : f.typ === 'geld' ? <BetragFeld value={v} onChange={set} />
                      : <input inputMode={f.typ === 'zahl' ? 'decimal' : undefined} value={v} onChange={set} />}
                  </label>);
              })}
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

/** Felder einer Person (wie im Fenster „Mieter anlegen“) */
export const personFelder = (titel: string, extra: SFeld[] = []): SGruppe[] => [
  { titel, felder: [
    { key: 'p_anrede', label: 'Anrede', typ: 'auswahl', optionen: ['', 'Herr', 'Frau', 'Divers', 'Firma', 'Eheleute'].map((a) => ({ value: a, label: a || '–' })) },
    { key: 'p_titel', label: 'Titel' },
    { key: 'p_vorname', label: 'Vorname' },
    { key: 'p_nachname', label: 'Nachname' },
    { key: 'p_firma', label: 'Firma (bei Gewerbe)', breit: 2 },
    { key: 'p_geburtsdatum', label: 'Geburtsdatum', typ: 'datum' },
    ...extra,
  ] },
  { titel: 'Kontakt und Bank', felder: [
    { key: 'p_telefon', label: 'Telefon' },
    { key: 'p_mobil', label: 'Mobil' },
    { key: 'p_email', label: 'E-Mail' },
    { key: 'p_iban', label: 'IBAN', breit: 2 },
    { key: 'p_bic', label: 'BIC' },
    { key: 'p_strasse', label: 'Straße', breit: 2 },
    { key: 'p_plz', label: 'PLZ' },
    { key: 'p_ort', label: 'Ort', breit: 2 },
    { key: 'p_notiz', label: 'Notiz zur Person', typ: 'lang', breit: 3 },
  ] },
];

const PERSON_SPALTEN = ['anrede', 'titel', 'vorname', 'nachname', 'firma', 'geburtsdatum', 'telefon', 'mobil', 'email', 'iban', 'bic', 'strasse', 'plz', 'ort', 'notiz'];

/** Personenzeile mit Präfix p_ für die Stammdatenkarte */
export const personWerte = (p: Row | undefined): Row => Object.fromEntries(PERSON_SPALTEN.map((k) => [`p_${k}`, p?.[k] ?? null]));

/** Geänderte p_-Felder als SET-Teil für personen */
export function personAenderungen(neu: Row): { sql: string; werte: any[] } | null {
  const k = Object.keys(neu).filter((x) => x.startsWith('p_') && PERSON_SPALTEN.includes(x.slice(2)));
  if (!k.length) return null;
  return { sql: k.map((x, i) => `${x.slice(2)} = $${i + 1}`).join(', '), werte: k.map((x) => (x === 'p_iban' && neu[x] ? String(neu[x]).replace(/\s/g, '').toUpperCase() : neu[x])) };
}
