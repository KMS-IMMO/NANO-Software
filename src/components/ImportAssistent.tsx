// Daten aus Excel oder CSV übernehmen: Kontakte oder Einheiten (auf Wunsch gleich mit Mieter und Mietvertrag).
// Datei wählen, Spalten zuordnen (wird automatisch erraten), Vorschau mit Prüfung, dann übernehmen.
import { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { db, insert, type Row } from '../db';
import { betragZahl } from '../lib/betrag';
import { datumLesen, tabelleLesen, type Tabelle } from '../lib/tabelleLesen';
import { doppeltePerson, ibanFehler, ortZurPlz } from '../lib/pruefen';
import { EINHEIT_TYPEN } from '../db/labels';

export type ImportZiel = 'kontakte' | 'einheiten';
type ZFeld = { key: string; label: string; namen: RegExp; zahl?: boolean; datum?: boolean };

const KONTAKT: ZFeld[] = [
  { key: 'anrede', label: 'Anrede', namen: /^(anrede|herr\/frau)$/i },
  { key: 'titel', label: 'Titel', namen: /^titel$/i },
  { key: 'vorname', label: 'Vorname', namen: /^vorname/i },
  { key: 'nachname', label: 'Nachname', namen: /^(nach)?name$|^familienname|^nachname/i },
  { key: 'firma', label: 'Firma', namen: /firma|unternehmen|gesellschaft/i },
  { key: 'strasse', label: 'Straße', namen: /stra(ß|ss)e|adresse|anschrift/i },
  { key: 'plz', label: 'PLZ', namen: /^plz|postleitzahl/i },
  { key: 'ort', label: 'Ort', namen: /^(ort|stadt|wohnort)$/i },
  { key: 'telefon', label: 'Telefon', namen: /^tel(efon)?|festnetz/i },
  { key: 'mobil', label: 'Mobil', namen: /mobil|handy/i },
  { key: 'email', label: 'E-Mail', namen: /e-?mail|mail/i },
  { key: 'iban', label: 'IBAN', namen: /iban|bankverbindung|konto/i },
  { key: 'geburtsdatum', label: 'Geburtsdatum', namen: /geburt/i, datum: true },
  { key: 'notiz', label: 'Notiz', namen: /notiz|bemerkung|hinweis/i },
];
const EINHEIT: ZFeld[] = [
  { key: 'nummer', label: 'Einheit (Nummer/Bezeichnung) *', namen: /^(einheit|we|wohnung|nr|nummer|whg|bezeichnung)/i },
  { key: 'typ', label: 'Art (Wohnung, Gewerbe …)', namen: /^(art|typ|nutzung)/i },
  { key: 'lage', label: 'Lage', namen: /lage|geschoss|etage/i },
  { key: 'flaeche', label: 'Fläche m²', namen: /fl(ä|ae)che|m²|qm|wohnfl/i, zahl: true },
  { key: 'mea', label: 'MEA', namen: /^mea|miteigentum/i, zahl: true },
  { key: 'personenzahl', label: 'Personen', namen: /person/i, zahl: true },
  { key: 'm_vorname', label: 'Mieter Vorname', namen: /mieter.*vorname|^vorname/i },
  { key: 'm_nachname', label: 'Mieter Nachname', namen: /mieter.*name|^mieter$|^nachname|^name$/i },
  { key: 'm_firma', label: 'Mieter Firma', namen: /mieter.*firma|^firma/i },
  { key: 'm_email', label: 'Mieter E-Mail', namen: /mail/i },
  { key: 'm_telefon', label: 'Mieter Telefon', namen: /^tel|telefon|mobil|handy/i },
  { key: 'm_iban', label: 'Mieter IBAN', namen: /iban/i },
  { key: 'beginn', label: 'Mietbeginn', namen: /beginn|einzug|seit|mietbeginn/i, datum: true },
  { key: 'kaltmiete', label: 'Kaltmiete', namen: /kalt|grundmiete|nettomiete|^miete$/i, zahl: true },
  { key: 'nk', label: 'NK-Vorauszahlung', namen: /^nk|nebenkosten|betriebskosten/i, zahl: true },
  { key: 'hk', label: 'HK-Vorauszahlung', namen: /^hk|heizkosten|heizung/i, zahl: true },
  { key: 'kaution', label: 'Kaution', namen: /kaution/i, zahl: true },
];

export function ImportKnopf({ ziel, rolle, onFertig }: { ziel?: ImportZiel; rolle?: string; onFertig?: () => void }) {
  const [auf, setAuf] = useState(false);
  return <>
    <button type="button" onClick={() => setAuf(true)}><FileSpreadsheet size={16} />Aus Excel übernehmen</button>
    {auf && <ImportAssistent ziel={ziel} rolle={rolle} onClose={() => setAuf(false)} onFertig={() => { onFertig?.(); }} />}
  </>;
}

export function ImportAssistent({ ziel: zielStart, rolle: rolleStart, onClose, onFertig }: { ziel?: ImportZiel; rolle?: string; onClose: () => void; onFertig?: () => void }) {
  const [ziel, setZiel] = useState<ImportZiel>(zielStart ?? 'kontakte');
  const [rolle, setRolle] = useState(rolleStart && rolleStart !== 'Firmen' ? rolleStart : 'Mieter');
  const [objekt, setObjekt] = useState('');
  const [objekte, setObjekte] = useState<Row[]>([]);
  const [tab, setTab] = useState<Tabelle | null>(null);
  const [datei, setDatei] = useState('');
  const [zuord, setZuord] = useState<Record<string, number>>({});
  const [doppeltAuch, setDoppeltAuch] = useState(false);
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);
  const [ergebnis, setErgebnis] = useState<string[] | null>(null);
  const felder = ziel === 'kontakte' ? KONTAKT : EINHEIT;

  useEffect(() => { db.select('SELECT id, name FROM objekte ORDER BY name').then(setObjekte); }, []);
  // Spalten automatisch zuordnen: Überschrift passt zum Feld, jede Spalte nur einmal
  useEffect(() => {
    if (!tab) return;
    const z: Record<string, number> = {}; const belegt = new Set<number>();
    for (const f of felder) {
      const i = tab.spalten.findIndex((s, j) => !belegt.has(j) && f.namen.test(s.trim()));
      if (i >= 0) { z[f.key] = i; belegt.add(i); }
    }
    setZuord(z);
  }, [tab, ziel]);

  async function laden(f: File | undefined) {
    if (!f) return;
    setFehler(''); setErgebnis(null);
    try { setTab(await tabelleLesen(f)); setDatei(f.name); } catch (e) { setFehler(String((e as Error)?.message ?? e)); setTab(null); }
  }

  const wert = (z: string[], key: string) => (zuord[key] === undefined ? '' : (z[zuord[key]] ?? '').trim());
  // Jede Zeile in Daten umwandeln und prüfen
  const zeilen = useMemo(() => (tab?.zeilen ?? []).map((z) => {
    const d: Row = {}; const probleme: string[] = [];
    for (const f of felder) {
      const s = wert(z, f.key); if (!s) continue;
      if (f.zahl) { const n = betragZahl(s.replace(/\s*(€|m²|qm)$/i, '')); if (n === null) probleme.push(`${f.label}: „${s}“ ist keine Zahl`); else d[f.key] = n; }
      else if (f.datum) { const t = datumLesen(s); if (!t) probleme.push(`${f.label}: „${s}“ ist kein Datum`); else d[f.key] = t; }
      else d[f.key] = s;
    }
    if (ziel === 'kontakte') {
      if (!d.nachname && !d.firma) probleme.push('Name oder Firma fehlt');
      if (d.iban) { const ib = ibanFehler(d.iban); if (ib) probleme.push('IBAN: ' + ib); else d.iban = String(d.iban).replace(/\s/g, '').toUpperCase(); }
      if (d.plz) d.plz = String(d.plz).padStart(5, '0');
    } else {
      if (!d.nummer) probleme.push('Einheit fehlt');
      if (d.typ) { const t = EINHEIT_TYPEN.find((x) => x.toLowerCase() === String(d.typ).toLowerCase()); d.typ = t ?? (/gewerb|laden|büro|praxis/i.test(String(d.typ)) ? 'Gewerbe' : /stell|park/i.test(String(d.typ)) ? 'Stellplatz' : /garage/i.test(String(d.typ)) ? 'Garage' : 'Wohnung'); }
      if (d.m_iban) { const ib = ibanFehler(d.m_iban); if (ib) probleme.push('Mieter-IBAN: ' + ib); else d.m_iban = String(d.m_iban).replace(/\s/g, '').toUpperCase(); }
      if ((d.m_nachname || d.m_firma) && !d.beginn) probleme.push('Mieter ohne Mietbeginn');
    }
    return { d, probleme };
  }), [tab, zuord, ziel]);
  const gut = zeilen.filter((z) => !z.probleme.length).length;

  async function uebernehmen() {
    if (ziel === 'einheiten' && !objekt) { setFehler('Bitte die Liegenschaft wählen.'); return; }
    setBusy(true); setFehler('');
    const log: string[] = []; let neu = 0, doppelt = 0, falsch = 0, vertraege = 0;
    try {
      for (const [i, { d, probleme }] of zeilen.entries()) {
        const nr = `Zeile ${i + 2}`;
        if (probleme.length) { falsch++; log.push(`${nr}: übersprungen (${probleme.join('; ')})`); continue; }
        if (ziel === 'kontakte') {
          if (!doppeltAuch && await doppeltePerson(d)) { doppelt++; log.push(`${nr}: ${[d.vorname, d.nachname ?? d.firma].filter(Boolean).join(' ')} gibt es schon, übersprungen`); continue; }
          if (d.plz && !d.ort) d.ort = (await ortZurPlz(d.plz)) ?? null;
          await insert('personen', { rolle, ...d }); neu++;
        } else {
          const da = (await db.select('SELECT id FROM einheiten WHERE objekt_id = $1 AND LOWER(TRIM(nummer)) = LOWER($2)', [Number(objekt), String(d.nummer)]))[0];
          if (da) { doppelt++; log.push(`${nr}: Einheit ${d.nummer} gibt es schon, übersprungen`); continue; }
          // In der WEG zahlt der Mieter an seinen Eigentümer; bei uns wird nur das Hausgeld gefordert
          const weg = (await db.select('SELECT verwaltungsart FROM objekte WHERE id = $1', [Number(objekt)]))[0]?.verwaltungsart === 'WEG';
          const eid = await insert('einheiten', { objekt_id: Number(objekt), nummer: d.nummer, typ: d.typ ?? 'Wohnung', lage: d.lage ?? null, flaeche: d.flaeche ?? null, mea: d.mea ?? null, personenzahl: d.personenzahl ?? null });
          neu++;
          if (d.m_nachname || d.m_firma) {
            const p = { vorname: d.m_vorname ?? null, nachname: d.m_nachname ?? null, firma: d.m_firma ?? null, email: d.m_email ?? null, telefon: d.m_telefon ?? null, iban: d.m_iban ?? null };
            const vorhanden = (await db.select(`SELECT id FROM personen WHERE ${p.nachname ? `LOWER(TRIM(nachname)) = LOWER($1) AND LOWER(TRIM(COALESCE(vorname, ''))) = LOWER($2)` : `LOWER(TRIM(firma)) = LOWER($1) AND $2 = $2`} LIMIT 1`,
              [String(p.nachname ?? p.firma), String(p.vorname ?? '')]))[0];
            const mid = vorhanden?.id ?? await insert('personen', { rolle: 'Mieter', ...p });
            await insert('mietvertraege', { einheit_id: eid, mieter_id: mid, beginn: d.beginn, kaltmiete: d.kaltmiete ?? 0, nk_vorauszahlung: d.nk ?? 0, hk_vorauszahlung: d.hk ?? 0,
              kaution: d.kaution ?? 0, personenzahl: d.personenzahl ?? 1, faellig_tag: 3, zahlung_an: weg ? 'Eigentümer' : 'Verwaltung', mietart: 'Standard' });
            vertraege++;
          }
        }
      }
      setErgebnis([`${neu} ${ziel === 'kontakte' ? 'Kontakte' : 'Einheiten'} übernommen${vertraege ? `, davon ${vertraege} mit Mieter und Mietvertrag` : ''}.`,
        ...(doppelt ? [`${doppelt} schon vorhanden, übersprungen.`] : []), ...(falsch ? [`${falsch} Zeilen mit Fehlern übersprungen.`] : []), ...log.slice(0, 30)]);
      onFertig?.();
    } catch (e) { setFehler(String((e as Error)?.message ?? e)); }
    finally { setBusy(false); }
  }

  const spaltenWahl = (key: string) => (
    <select value={zuord[key] ?? ''} onChange={(e) => setZuord((z) => { const n = { ...z }; if (e.target.value === '') delete n[key]; else n[key] = Number(e.target.value); return n; })}>
      <option value="">– nicht übernehmen –</option>
      {tab!.spalten.map((s, i) => <option key={i} value={i}>{s}</option>)}
    </select>);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal breit import-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="title-ico"><FileSpreadsheet size={20} />Daten aus Excel übernehmen</h3>
        <div className="form f3">
          <label><span>Was übernehmen?</span><select value={ziel} onChange={(e) => { setZiel(e.target.value as ImportZiel); setErgebnis(null); }}>
            <option value="kontakte">Kontakte (Mieter, Eigentümer, Sonstige)</option><option value="einheiten">Einheiten einer Liegenschaft (auf Wunsch mit Mieter)</option></select></label>
          {ziel === 'kontakte'
            ? <label><span>Als Rolle</span><select value={rolle} onChange={(e) => setRolle(e.target.value)}>{['Mieter', 'Eigentümer', 'Verwalter', 'Sonstige'].map((r) => <option key={r}>{r}</option>)}</select></label>
            : <label><span>Liegenschaft *</span><select value={objekt} onChange={(e) => setObjekt(e.target.value)}><option value="">– bitte wählen –</option>{objekte.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
          <label><span>Datei (.xlsx oder .csv)</span>
            <span className="datei-wahl"><Upload size={16} />{datei || 'Datei wählen …'}<input type="file" accept=".xlsx,.csv,.txt" onChange={(e) => laden(e.target.files?.[0])} /></span></label>
        </div>
        {!tab && <p className="muted small">Die erste Zeile der Tabelle muss die Überschriften enthalten, z. B. „Vorname“, „Nachname“, „Straße“, „PLZ“, „Ort“, „E-Mail“, „IBAN“. Die Spalten werden automatisch zugeordnet, du kannst das danach ändern.</p>}
        {tab && !ergebnis && <>
          <div className="sec">Spalten zuordnen <span className="muted small">({tab.zeilen.length} Zeilen in der Datei)</span></div>
          <div className="import-zuordnung">{felder.map((f) => <label key={f.key}><span>{f.label}</span>{spaltenWahl(f.key)}</label>)}</div>
          <div className="sec">Vorschau</div>
          <div className="tablewrap"><table className="list">
            <thead><tr><th>Zeile</th>{felder.filter((f) => zuord[f.key] !== undefined).map((f) => <th key={f.key}>{f.label.replace(' *', '')}</th>)}<th>Prüfung</th></tr></thead>
            <tbody>{zeilen.slice(0, 8).map((z, i) => (
              <tr key={i}><td>{i + 2}</td>{felder.filter((f) => zuord[f.key] !== undefined).map((f) => <td key={f.key}>{z.d[f.key] === undefined ? '' : f.zahl ? Number(z.d[f.key]).toLocaleString('de-DE') : f.datum ? String(z.d[f.key]).split('-').reverse().join('.') : String(z.d[f.key])}</td>)}
                <td className={z.probleme.length ? 'neg small' : 'pos small'}>{z.probleme.length ? z.probleme.join('; ') : 'in Ordnung'}</td></tr>))}
            </tbody></table></div>
          {zeilen.length > 8 && <p className="muted small">… und {zeilen.length - 8} weitere Zeilen.</p>}
          {ziel === 'kontakte' && <label className="check small"><input type="checkbox" checked={doppeltAuch} onChange={(e) => setDoppeltAuch(e.target.checked)} /> Auch Kontakte übernehmen, die es mit gleichem Namen oder gleicher IBAN schon gibt</label>}
        </>}
        {ergebnis && <div className="info" style={{ display: 'block' }}>{ergebnis.map((t, i) => <div key={i} className={i ? 'small' : ''}>{i ? t : <b>{t}</b>}</div>)}</div>}
        {fehler && <p className="error">{fehler}</p>}
        <div className="row end">
          <button onClick={onClose}>{ergebnis ? 'Schließen' : 'Abbrechen'}</button>
          {tab && !ergebnis && <button className="primary" disabled={busy || !gut} onClick={uebernehmen}>{busy ? 'Übernehme …' : `${gut} ${ziel === 'kontakte' ? 'Kontakte' : 'Einheiten'} übernehmen`}</button>}
        </div>
      </div>
    </div>
  );
}
