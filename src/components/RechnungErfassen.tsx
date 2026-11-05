// Rechnung oder Gutschrift erfassen: alle Angaben in einem Bereich, Beleg per Drag & Drop hochladen.
import { useEffect, useRef, useState } from 'react';
import { Building2, FileUp, Paperclip, Plus, UserPlus, X } from 'lucide-react';
import { db, insert, type Row } from '../db';
import { eur } from './EntityTable';
import { speichern } from '../lib/dateien';

const heute = () => new Date().toISOString().slice(0, 10);
const zahl = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.')) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function RechnungErfassen({ objektFest, onSaved }: { objektFest?: number; onSaved: (text: string) => void }) {
  const [art, setArt] = useState<'Ausgabe' | 'Gutschrift'>('Ausgabe');
  const [konto, setKonto] = useState('');
  const [datum, setDatum] = useState(heute());
  const [nr, setNr] = useState('');
  const [betrag, setBetrag] = useState('');
  const [mitMwst, setMitMwst] = useState(true);
  const [satz, setSatz] = useState('19');
  const [objekt, setObjekt] = useState<number | ''>(objektFest ?? '');
  const [modus, setModus] = useState<'alle' | 'eigen'>('alle');
  const [anteile, setAnteile] = useState<Record<number, string>>({});
  const [lieferant, setLieferant] = useState('');
  const [firmaId, setFirmaId] = useState<number | null>(null);
  const [kontaktWahl, setKontaktWahl] = useState(false);
  const [faellig, setFaellig] = useState('');
  const [bezahlt, setBezahlt] = useState('');
  const [lohn, setLohn] = useState('');
  const [notiz, setNotiz] = useState('');
  const [datei, setDatei] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);
  const [konten, setKonten] = useState<Row[]>([]);
  const [objekte, setObjekte] = useState<Row[]>([]);
  const [einheiten, setEinheiten] = useState<Row[]>([]);
  const [firmen, setFirmen] = useState<Row[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    db.select(`SELECT id AS value, nummer || ' ' || name AS label, hdl, hwl FROM buchungskonten WHERE art IN ('Aufwand') ORDER BY nummer`).then(setKonten);
    db.select('SELECT id, objekt_nr, name, strasse, plz, ort FROM objekte ORDER BY name').then(setObjekte);
    db.select('SELECT id, name, gewerk FROM firmen ORDER BY name').then(setFirmen);
  }, []);
  useEffect(() => {
    if (objekt === '') { setEinheiten([]); return; }
    db.select('SELECT id, nummer, typ FROM einheiten WHERE objekt_id = $1 ORDER BY nummer', [objekt]).then(setEinheiten);
    setAnteile({});
  }, [objekt]);

  const brutto = zahl(betrag);
  const s = mitMwst ? zahl(satz) : 0;
  const netto = r2(brutto / (1 + s / 100));
  const gewaehlt = Object.entries(anteile).filter(([, v]) => v !== '');
  const summeEigen = r2(gewaehlt.reduce((a, [, v]) => a + zahl(v), 0));
  const o = objekte.find((x) => x.id === objekt);

  function gleichVerteilen(ids: number[]) {
    if (!ids.length || !brutto) return;
    const teil = Math.floor((brutto / ids.length) * 100) / 100;
    const rest = r2(brutto - teil * ids.length);
    setAnteile(Object.fromEntries(ids.map((id, i) => [id, String(i === 0 ? r2(teil + rest) : teil).replace('.', ',')])));
  }
  function einheitUmschalten(id: number) {
    const ids = gewaehlt.map(([k]) => Number(k));
    gleichVerteilen(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
    if (ids.includes(id) && ids.length === 1) setAnteile({});
  }

  function zuruecksetzen() {
    setKonto(''); setNr(''); setBetrag(''); setModus('alle'); setAnteile({}); setLieferant(''); setFirmaId(null);
    setFaellig(''); setBezahlt(''); setLohn(''); setNotiz(''); setDatei(null); setArt('Ausgabe'); setDatum(heute());
  }

  async function sichern() {
    setFehler('');
    if (!konto || !datum || !brutto || objekt === '') { setFehler('Bitte Buchungskonto, Datum, Betrag und Immobilie ausfüllen.'); return; }
    if (lohn && Math.abs(zahl(lohn)) > Math.abs(brutto) + 0.005) { setFehler('Der § 35a-Anteil kann nicht größer sein als der Rechnungsbetrag.'); return; }
    if (modus === 'eigen' && !gewaehlt.length) { setFehler('Bitte mindestens eine Einheit auswählen oder „Alle Einheiten“ nehmen.'); return; }
    if (modus === 'eigen' && Math.abs(summeEigen - brutto) > 0.005) { setFehler(`Die Beträge der Einheiten (${eur(summeEigen)}) ergeben nicht den Rechnungsbetrag (${eur(brutto)}).`); return; }
    setBusy(true);
    try {
      // Lieferant: gewählter Kontakt oder neu als Firmenkontakt anlegen
      let fid = firmaId;
      const name = lieferant.trim();
      if (!fid && name) {
        const da = firmen.find((f) => String(f.name).toLowerCase() === name.toLowerCase());
        fid = da ? da.id : await insert('firmen', { name });
      }
      // Beleg in die Ablage der Liegenschaft
      let dokId: number | null = null;
      if (datei) {
        const pfad = await speichern(new Uint8Array(await datei.arrayBuffer()), datei.name, { bezug: 'Objekt', bezugId: Number(objekt), ordner: [o?.name ?? 'Liegenschaft', 'Rechnungen', datum.slice(0, 4)] });
        dokId = Number((await db.select('SELECT id FROM dokumente WHERE pfad = $1 ORDER BY id DESC LIMIT 1', [pfad]))[0]?.id) || null;
      }
      const vz = art === 'Gutschrift' ? -1 : 1;
      const basis = { objekt_id: Number(objekt), firma_id: fid, rechnungsnr: nr.trim() || null, datum, buchungskonto_id: Number(konto),
        mwst_satz: mitMwst ? s : 0, faellig: faellig || null, bezahlt_am: bezahlt || null, dokument_id: dokId, notiz: notiz.trim() || null };
      const teile: [number | null, number][] = modus === 'alle' ? [[null, brutto]] : gewaehlt.map(([k, v]) => [Number(k), zahl(v)]);
      for (const [eid, b] of teile) {
        const rid = await insert('rechnungen', { ...basis, einheit_id: eid, betrag: r2(vz * b), anteil_lohn: lohn ? r2((zahl(lohn) * b) / brutto) : null });
        // Schon bezahlt (z. B. bar oder ohne Bankumsatz): gleich als Ausgabe buchen, damit sie in Einnahmen & Ausgaben steht
        if (bezahlt) await insert('buchungen', { datum: bezahlt, betrag: r2(-vz * b), buchungskonto_id: Number(konto), objekt_id: Number(objekt), einheit_id: eid,
          rechnung_id: rid, firma_id: fid, text: `Rechnung ${nr.trim()} ${name}`.replace(/\s+/g, ' ').trim() });
      }
      onSaved(`${art === 'Gutschrift' ? 'Gutschrift' : 'Rechnung'}${nr ? ' ' + nr : ''} über ${eur(brutto)} gespeichert${teile.length > 1 ? `, aufgeteilt auf ${teile.length} Einheiten` : ''}${datei ? ', Beleg abgelegt' : ''}.`);
      zuruecksetzen();
    } catch (e: any) { setFehler(String(e?.message ?? e)); }
    finally { setBusy(false); }
  }

  return (
    <section className="card rerf">
      <div className="card-head"><h2 className="title-ico"><Plus size={22} />Rechnung erfassen</h2></div>
      <div className="rerf-grid">
        <div className="rerf-form">
          <div className="row">
            {(['Ausgabe', 'Gutschrift'] as const).map((a) => (
              <label key={a} className="radio"><input type="radio" checked={art === a} onChange={() => setArt(a)} />{a}</label>))}
          </div>
          <label><span>Buchungskonto *</span><select value={konto} onChange={(e) => setKonto(e.target.value)}>
            <option value="">– bitte wählen –</option>{konten.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></label>
          <div className="form f2">
            <label><span>Datum *</span><input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} /></label>
            <label><span>Rechnungsnummer</span><input value={nr} onChange={(e) => setNr(e.target.value)} placeholder="z. B. RE-2026-0815" /></label>
          </div>
          <label><span>Betrag *</span><div className="addon"><input inputMode="decimal" value={betrag} onChange={(e) => setBetrag(e.target.value)} placeholder="0,00" /><span>Brutto</span></div></label>
          <div className="row">
            <label className="check"><input type="checkbox" checked={mitMwst} onChange={(e) => setMitMwst(e.target.checked)} /><span>Beinhaltet MwSt</span></label>
            {mitMwst && <div className="addon klein"><span>MwSt-Satz</span><input inputMode="decimal" value={satz} onChange={(e) => setSatz(e.target.value)} /><span>%</span></div>}
            {brutto > 0 && <span className="muted small">netto {eur(netto)} · MwSt {eur(r2(brutto - netto))}</span>}
          </div>
          <hr />
          <label><span>Immobilie *</span>{objektFest
            ? <div className="addon"><span>H-ID {o?.objekt_nr ?? ''}</span><input readOnly value={o ? [o.name, [o.plz, o.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') : ''} /></div>
            : <select value={objekt} onChange={(e) => setObjekt(e.target.value ? Number(e.target.value) : '')}>
                <option value="">– bitte wählen –</option>{objekte.map((x) => <option key={x.id} value={x.id}>{x.objekt_nr ? `H-ID ${x.objekt_nr} · ` : ''}{x.name}</option>)}</select>}</label>
          <div className="seg mitte">
            <button className={modus === 'alle' ? 'on' : ''} onClick={() => { setModus('alle'); setAnteile({}); }}>Alle Einheiten</button>
            <button className={modus === 'eigen' ? 'on' : ''} onClick={() => setModus('eigen')} disabled={!einheiten.length}>Benutzerdefiniert</button>
          </div>
          {modus === 'alle' && <p className="muted small mitte">Wird nach dem Umlageschlüssel auf alle Einheiten verteilt.</p>}
          {modus === 'eigen' && (
            <div className="rerf-einheiten">
              {einheiten.map((e) => {
                const an = anteile[e.id] !== undefined && anteile[e.id] !== '';
                return (
                  <div key={e.id} className="row">
                    <label className="check grow"><input type="checkbox" checked={an} onChange={() => einheitUmschalten(e.id)} /><span>{e.nummer} <span className="muted">{e.typ}</span></span></label>
                    {an && <input className="cell" inputMode="decimal" value={anteile[e.id]} onChange={(x) => setAnteile({ ...anteile, [e.id]: x.target.value })} />}
                  </div>);
              })}
              <p className={'small ' + (gewaehlt.length && Math.abs(summeEigen - brutto) > 0.005 ? 'warn' : 'muted')}>
                Summe {eur(summeEigen)} von {eur(brutto)}. Beim Anhaken wird gleichmäßig aufgeteilt, danach kannst du die Beträge ändern.</p>
            </div>)}
          <hr />
          <div className="rerf-liefer"><div className="ico"><Building2 size={20} /></div><div><b>Lieferant oder Dienstleister</b><div className="muted small">Kontakt zuordnen oder Lieferantennamen verwenden.</div></div></div>
          <label><span>Lieferantenname</span><div className="addon">
            <input list="rerf-firmen" value={lieferant} onChange={(e) => { setLieferant(e.target.value); setFirmaId(firmen.find((f) => f.name === e.target.value)?.id ?? null); }} placeholder="Neuer Name wird als Firmenkontakt angelegt" />
            {lieferant && <button className="icon-btn" title="Leeren" onClick={() => { setLieferant(''); setFirmaId(null); }}><X size={16} /></button>}</div></label>
          <datalist id="rerf-firmen">{firmen.map((f) => <option key={f.id} value={f.name} />)}</datalist>
          {kontaktWahl
            ? <select autoFocus onChange={(e) => { const f = firmen.find((x) => x.id === Number(e.target.value)); if (f) { setFirmaId(f.id); setLieferant(f.name); } setKontaktWahl(false); }} defaultValue="">
                <option value="" disabled>Kontakt auswählen …</option>{firmen.map((f) => <option key={f.id} value={f.id}>{f.name}{f.gewerk ? ` (${f.gewerk})` : ''}</option>)}</select>
            : <button className="pill-btn" onClick={() => setKontaktWahl(true)} disabled={!firmen.length}><UserPlus size={16} />Kontakt auswählen</button>}
          {(() => { const k = konten.find((x) => String(x.value) === String(konto)); return k && (k.hdl || k.hwl) ? (
            <label className="hint-35a"><span>davon § 35a-Anteil (Arbeitskosten) € · {k.hdl ? 'haushaltsnahe Dienstleistung' : 'Handwerkerleistung'}</span>
              <input inputMode="decimal" placeholder="leer = ganzer Betrag" value={lohn} onChange={(e) => setLohn(e.target.value)} />
              <small className="muted">Erscheint in der Abrechnung als § 35a-Anteil der Eigentümer bzw. Mieter.</small></label>) : null; })()}
          <details className="rerf-mehr"><summary>Weitere Angaben (Fälligkeit, bezahlt, Notiz)</summary>
            <div className="form f3">
              <label><span>Fällig am</span><input type="date" value={faellig} onChange={(e) => setFaellig(e.target.value)} /></label>
              <label><span>Bezahlt am</span><input type="date" value={bezahlt} onChange={(e) => setBezahlt(e.target.value)} /></label>
              <label className="span3"><span>Notiz</span><input value={notiz} onChange={(e) => setNotiz(e.target.value)} /></label>
            </div>
          </details>
        </div>
        <div className={'drop rerf-drop' + (over ? ' over' : '')}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) setDatei(f); }}
          onClick={() => fileRef.current?.click()}>
          <FileUp size={40} strokeWidth={1.4} />
          {datei
            ? <><p><Paperclip size={14} /> <b>{datei.name}</b></p><p className="muted small">{Math.round(datei.size / 1024)} KB · wird beim Speichern in der Ablage der Immobilie unter „Rechnungen/{datum.slice(0, 4)}“ abgelegt</p>
                <button className="link" onClick={(e) => { e.stopPropagation(); setDatei(null); }}>Entfernen</button></>
            : <><p><b>Rechnung hierher ziehen</b></p><p className="muted small">oder klicken zum Auswählen (PDF oder Bild)</p></>}
          <input ref={fileRef} type="file" accept=".pdf,image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setDatei(f); e.target.value = ''; }} />
        </div>
      </div>
      {fehler && <p className="error">{fehler}</p>}
      <div className="row end"><span className="grow" /><button onClick={zuruecksetzen} disabled={busy}>Leeren</button>
        <button className="primary" onClick={sichern} disabled={busy}>{busy ? 'Speichert …' : art === 'Gutschrift' ? 'Gutschrift speichern' : 'Rechnung speichern'}</button></div>
    </section>
  );
}
