// Fenster „Rücklagenkonto laut Kontoauszug“: Anfangsbestand 01.01. und Endbestand (Datum, Auszug-Nr., Betrag) von Hand eingeben, ändern oder leeren.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, X } from 'lucide-react';
import { auszugSpeichern, ruecklageAbgleich, ruecklageIstStand } from '../logic/ruecklage';
import { betragLesen, startLautUmsaetzen } from '../logic/kontostart';
import { DatumFeld } from './DatumFeld';
import { db } from '../db';
import { eur, datum } from './EntityTable';

type Abgleich = Awaited<ReturnType<typeof ruecklageAbgleich>>;
const feld = (n: number | null) => (n === null ? '' : n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const ibanAnzeige = (s: string) => s.replace(/\s/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();
const tagDanach = (d: string) => new Date(new Date(d + 'T12:00:00').getTime() + 864e5).toISOString().slice(0, 10);

export function RuecklageAuszugDialog({ objektId, jahr, g, endeAbschluss, onClose, onDone }: {
  objektId: number; jahr: number; g: Abgleich; endeAbschluss: number | null; onClose: () => void; onDone: () => void;
}) {
  const a = g.auszug;
  const [anfang, setAnfang] = useState(feld(a.anfang));
  const [anfangAuszug, setAnfangAuszug] = useState(a.anfangAuszug);
  const [ende, setEnde] = useState(feld(a.ende));
  const [endeDatum, setEndeDatum] = useState(a.endeDatum || `${jahr}-12-31`);
  const [endeAuszug, setEndeAuszug] = useState(a.endeAuszug);
  const [vorEnde, setVorEnde] = useState<number | null>(null);          // laut Buchungen zum gewählten Enddatum
  const [bankAnfang, setBankAnfang] = useState<number | null>(null);    // laut Kontoumsätzen des Rücklagenkontos
  const [bankEnde, setBankEnde] = useState<number | null>(null);
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let weg = false;
    (async () => {
      const an = betragLesen(anfang);
      const ist = await ruecklageIstStand(objektId, endeDatum || `${jahr}-12-31`);
      // Mit eigenem Anfangsbestand beginnt der Stand laut Buchungen damit (gleiche Rechnung wie in der Übersicht)
      const v = an !== null && Number.isFinite(an) ? an - g.anfangBuchungen + ist : ist;
      if (!weg) setVorEnde(Math.round(v * 100) / 100);
      const mitUmsaetzen = g.bank ? Number((await db.select('SELECT COUNT(*) AS n FROM bankumsaetze WHERE bankkonto_id = $1', [g.bank.id]))[0]?.n) > 0 : false;
      if (g.bank && mitUmsaetzen) {
        const s = await startLautUmsaetzen(Number(g.bank.id), `${jahr}-01-01`);
        const e = endeDatum ? await startLautUmsaetzen(Number(g.bank.id), tagDanach(endeDatum)) : null;
        if (!weg) { setBankAnfang(s); setBankEnde(e); }
      }
    })();
    return () => { weg = true; };
  }, [objektId, jahr, endeDatum, anfang]);

  async function speichern() {
    setFehler('');
    const an = betragLesen(anfang), en = betragLesen(ende);
    if (an !== null && !Number.isFinite(an)) { setFehler('Der Anfangsbestand ist keine Zahl. Bitte z. B. 34.380,00 eingeben.'); return; }
    if (en !== null && !Number.isFinite(en)) { setFehler('Der Endbestand ist keine Zahl. Bitte z. B. 35.441,70 eingeben.'); return; }
    setBusy(true);
    try {
      await auszugSpeichern(objektId, jahr, { anfang: an, anfangAuszug: anfangAuszug.trim(), ende: en, endeDatum: en === null ? '' : endeDatum, endeAuszug: endeAuszug.trim() });
      onDone();
    } catch (e: any) { setFehler('Speichern fehlgeschlagen: ' + String(e?.message ?? e)); setBusy(false); }
  }
  const diff = (() => { const en = betragLesen(ende); return en !== null && Number.isFinite(en) && vorEnde !== null ? Math.round((en - vorEnde) * 100) / 100 : null; })();

  return createPortal(
    <div className="modal-bg" onClick={onClose}>
      <div className="modal rl-auszug" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); speichern(); } }}>
        <div className="card-head"><h3 className="title-ico"><Pencil size={20} />Rücklagenkonto {jahr} laut Kontoauszug</h3><button className="icon-btn" title="Schließen" onClick={onClose}><X size={18} /></button></div>
        <p className="muted small">Trag hier die Bestände vom Kontoauszug des Rücklagenkontos ein. Der Anfangsbestand ist der Start von „Stand laut Buchungen“,
          der Endbestand wird mit den Buchungen bis zu seinem Datum verglichen. Unterjährig geht auch (z. B. Auszug vom 31.10.), zum Jahresende trägst du den Auszug vom 31.12. ein.
          Leer lassen heißt: NEOSS rechnet nur mit den Buchungen.</p>
        <div className="rl-box">
          <div className="rl-box-kopf"><b>Rücklagenkonto</b>{g.bank ? <span className="muted small">{g.bank.bank ? g.bank.bank + ' · ' : ''}{g.bank.iban ? ibanAnzeige(String(g.bank.iban)) : g.bank.name}</span> : null}</div>
          <div className="rl-felder">
            <label><span>Anfangsbestand am</span><input value={`01.01.${jahr}`} disabled /></label>
            <label><span>laut Auszug Nr.</span><input value={anfangAuszug} placeholder={`z. B. 12/${jahr - 1}`} onChange={(e) => setAnfangAuszug(e.target.value)} aria-label="Auszug Nr. Anfangsbestand" /></label>
            <label><span>Anfangsbestand (€)</span><input className="num" inputMode="decimal" autoFocus value={anfang} aria-label={`Anfangsbestand 01.01.${jahr}`}
              onChange={(e) => setAnfang(e.target.value)} onBlur={() => { const n = betragLesen(anfang); if (n !== null && Number.isFinite(n)) setAnfang(feld(n)); }} /></label>
          </div>
          <div className="rl-vorschlag small">
            {endeAbschluss !== null && <><span className="muted">Endbestand {jahr - 1} laut Kontoauszug: {eur(endeAbschluss)}</span><button className="link" onClick={() => setAnfang(feld(endeAbschluss))}>übernehmen</button><span className="muted">·</span></>}
            <span className="muted">Endstand {jahr - 1} laut Buchungen: {eur(g.anfangBuchungen)}</span><button className="link" onClick={() => setAnfang(feld(g.anfangBuchungen))}>übernehmen</button>
            {bankAnfang !== null && <><span className="muted">· laut Kontoumsätzen: {eur(bankAnfang)}</span><button className="link" onClick={() => setAnfang(feld(bankAnfang))}>übernehmen</button></>}
            {anfang !== '' && <button className="link" onClick={() => setAnfang('')}>leeren</button>}
          </div>
        </div>
        <div className="rl-box">
          <div className="rl-felder">
            <label><span>Endbestand am</span><DatumFeld value={endeDatum} onChange={(e) => setEndeDatum(e.target.value)} aria-label="Datum Endbestand" /></label>
            <label><span>laut Auszug Nr.</span><input value={endeAuszug} placeholder={`z. B. 10/${jahr}`} onChange={(e) => setEndeAuszug(e.target.value)} aria-label="Auszug Nr. Endbestand" /></label>
            <label><span>Endbestand (€)</span><input className="num" inputMode="decimal" value={ende} aria-label="Endbestand laut Kontoauszug"
              onChange={(e) => setEnde(e.target.value)} onBlur={() => { const n = betragLesen(ende); if (n !== null && Number.isFinite(n)) setEnde(feld(n)); }} /></label>
          </div>
          <div className="rl-vorschlag small">
            {vorEnde !== null && <span className="muted">Laut Buchungen bis {datum(endeDatum)}: {eur(vorEnde)}</span>}
            {diff !== null && <span className="muted">· Differenz <b className={Math.abs(diff) < 0.005 ? 'pos' : 'neg'}>{Math.abs(diff) < 0.005 ? 'stimmt' : eur(diff)}</b></span>}
            {bankEnde !== null && <><span className="muted">· laut Kontoumsätzen: {eur(bankEnde)}</span><button className="link" onClick={() => setEnde(feld(bankEnde))}>übernehmen</button></>}
            {ende !== '' && <button className="link" onClick={() => setEnde('')}>leeren</button>}
          </div>
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
