// Rechnung oder Gutschrift erfassen, aufgebaut wie das Buchen-Fenster: Konto über das Rad, dann Immobilie und Einheiten,
// dann Lieferant. Beleg per Drag & Drop hochladen, PDFs werden ausgelesen.
import { BetragFeld } from './BetragFeld';
import { KontoRad } from './BuchenDialog';
import { betragZahl, betragText } from '../lib/betrag';
import { useEffect, useRef, useState } from 'react';
import { Check, FileUp, Paperclip, Plus, Search, UserPlus, X } from 'lucide-react';
import { gesperrt, sperrText } from '../logic/abschluss';
import { db, insert, type Row } from '../db';
import { einheitPerson } from '../db/labels';
import { eur } from './EntityTable';
import { letztesDokument, speichern } from '../lib/dateien';

const heute = () => new Date().toISOString().slice(0, 10);
const zahl = (s: string) => betragZahl(s) ?? 0;
const r2 = (n: number) => Math.round(n * 100) / 100;

export type RechnungVorlage = { datei?: File; umsatz?: Row };

/** Mit `vorlage.umsatz` wird die Rechnung aus einem Bankumsatz erfasst: Betrag fest, bezahlt am Umsatztag, der Umsatz wird gleich zugeordnet. */
export function RechnungErfassen({ objektFest, onSaved, vorlage }: { objektFest?: number; onSaved: (text: string) => void; vorlage?: RechnungVorlage }) {
  const umsatz = vorlage?.umsatz;
  const [art, setArt] = useState<'Ausgabe' | 'Gutschrift'>(umsatz && Number(umsatz.betrag) > 0 ? 'Gutschrift' : 'Ausgabe');
  const [konto, setKonto] = useState<number | null>(null);
  const kontoVomNutzer = useRef(false);     // Rad gedreht oder gesucht: dann nicht mehr aus der PDF überschreiben
  const [suche, setSuche] = useState('');
  const [datum, setDatum] = useState(heute());
  const [nr, setNr] = useState('');
  const [betrag, setBetrag] = useState(umsatz ? String(Math.abs(Number(umsatz.betrag))).replace('.', ',') : '');
  const [mitMwst, setMitMwst] = useState(true);
  const [satz, setSatz] = useState('19');
  const [objekt, setObjekt] = useState<number | ''>(objektFest ?? '');
  const [wahl, setWahl] = useState<number[]>([]);             // gewählte Einheiten, leer = alle Einheiten (Umlage nach Schlüssel)
  const [anteile, setAnteile] = useState<Record<number, string>>({});
  const [lieferant, setLieferant] = useState('');
  const [firmaId, setFirmaId] = useState<number | null>(null);
  const [kontaktWahl, setKontaktWahl] = useState(false);
  const [faellig, setFaellig] = useState('');
  const [bezahlt, setBezahlt] = useState(umsatz?.datum ?? '');
  const [lohn, setLohn] = useState('');
  const [notiz, setNotiz] = useState('');
  const [datei, setDatei] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);
  const [konten, setKonten] = useState<Row[]>([]);
  // MwSt aus dem Beleg hat Vorrang; sonst gilt der MwSt-Satz, der im Kontenrahmen beim Konto hinterlegt ist
  const mwstAusBeleg = useRef(false);
  function kontoWaehlen(id: number) {
    setKonto(id);
    const k = konten.find((x) => Number(x.id) === id);
    if (!k || mwstAusBeleg.current) return;
    const m = Number(k.mwst) || 0;
    setMitMwst(m > 0); if (m > 0) setSatz(String(m));
  }
  const [objekte, setObjekte] = useState<Row[]>([]);
  const [einheiten, setEinheiten] = useState<Row[]>([]);
  const [firmen, setFirmen] = useState<Row[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [lesen, setLesen] = useState('');

  /** Beleg übernehmen und, wenn es eine PDF mit Text ist, die Angaben auslesen. Bereits ausgefüllte Felder bleiben, wie sie sind. */
  async function belegWaehlen(f: File) {
    setDatei(f); setLesen(''); mwstAusBeleg.current = false;
    const pdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    if (!pdf) { setLesen('Bilder und Scans enthalten keinen lesbaren Text. Bitte die Angaben selbst eintragen.'); return; }
    setLesen('Rechnung wird ausgelesen …');
    try {
      const { pdfText, erkennen } = await import('../logic/rechnungLesen');
      const text = await pdfText(new Uint8Array(await f.arrayBuffer()));
      if (text.replace(/\s/g, '').length < 20) { setLesen('Die PDF enthält keinen Text (vermutlich ein Scan). Bitte die Angaben selbst eintragen.'); return; }
      const e = erkennen(text, firmen.map((x) => ({ id: x.id, name: String(x.name) })));
      const ok: string[] = [];
      if (e.rechnungsnr && !nr) { setNr(e.rechnungsnr); ok.push('Rechnungsnummer'); }
      if (e.datum && datum === heute()) { setDatum(e.datum); ok.push('Datum'); }
      if (e.betrag && !betrag) { setBetrag(String(Math.abs(e.betrag)).replace('.', ',')); if (e.betrag < 0) setArt('Gutschrift'); ok.push('Betrag'); }
      if (e.mwst !== undefined) { mwstAusBeleg.current = true; setMitMwst(e.mwst > 0); if (e.mwst > 0) setSatz(String(e.mwst)); ok.push('MwSt'); }
      if (e.faellig && !faellig) { setFaellig(e.faellig); ok.push('Fälligkeit'); }
      if (e.lohn && !lohn) { setLohn(String(e.lohn).replace('.', ',')); ok.push('§ 35a-Anteil'); }
      if (e.lieferant && !lieferant) { setLieferant(e.lieferant); setFirmaId(e.firmaId ?? null); ok.push(e.firmaId ? 'Lieferant (Kontakt gefunden)' : 'Lieferant'); }
      // Buchungskonto: wie bei der letzten Rechnung dieses Lieferanten
      if (e.firmaId && !kontoVomNutzer.current) {
        const k = (await db.select('SELECT buchungskonto_id FROM rechnungen WHERE firma_id = $1 ORDER BY datum DESC, id DESC LIMIT 1', [e.firmaId]))[0]?.buchungskonto_id;
        if (k) { kontoWaehlen(Number(k)); ok.push('Buchungskonto (wie zuletzt)'); }
      }
      // Immobilie: Straße der Liegenschaft steht auf der Rechnung
      if (objekt === '' && !objektFest) {
        const t = text.toLowerCase();
        const treffer = objekte.filter((x) => x.strasse && t.includes(String(x.strasse).toLowerCase()));
        if (treffer.length === 1) { setObjekt(treffer[0].id); ok.push('Immobilie'); }
      }
      setLesen(ok.length ? `Aus der Rechnung übernommen: ${ok.join(', ')}. Bitte kurz prüfen.` : 'In der PDF wurden keine passenden Angaben gefunden. Bitte selbst eintragen.');
    } catch (err) {
      setLesen('Die PDF konnte nicht gelesen werden. Bitte die Angaben selbst eintragen.');
      console.warn(err);
    }
  }

  useEffect(() => {
    db.select(`SELECT id, nummer, name, gruppe, hdl, hwl, mwst, rechnung_pflicht FROM buchungskonten WHERE art IN ('Aufwand') ORDER BY nummer`).then(setKonten);
    db.select('SELECT id, objekt_nr, name, strasse, plz, ort FROM objekte ORDER BY name').then(setObjekte);
    db.select('SELECT id, name, gewerk FROM firmen ORDER BY name').then((f) => { setFirmen(f); setFirmenDa(true); });
  }, []);
  // Vorlage aus dem Bankumsatz: Beleg auslesen, sobald die Kontakte geladen sind; sonst Empfänger als Lieferant
  const vorlageGelesen = useRef(false);
  const [firmenDa, setFirmenDa] = useState(false);
  useEffect(() => {
    if (!vorlage || vorlageGelesen.current || !firmenDa) return;
    vorlageGelesen.current = true;
    (async () => {
      if (vorlage.datei) await belegWaehlen(vorlage.datei);
      if (umsatz?.gegenpartei) setLieferant((l) => l || String(umsatz.gegenpartei));
    })();
  }, [firmenDa]);
  useEffect(() => {
    if (objekt === '') { setEinheiten([]); return; }
    db.select(`SELECT e.id, e.nummer, e.typ, ${einheitPerson('e')} AS person FROM einheiten e WHERE e.objekt_id = $1 ORDER BY e.lfd_nr, e.nummer`, [objekt]).then(setEinheiten);
    setWahl([]); setAnteile({});
  }, [objekt]);

  const brutto = zahl(betrag);
  const s = mitMwst ? zahl(satz) : 0;
  const netto = r2(brutto / (1 + s / 100));
  const summeEigen = r2(wahl.reduce((a, id) => a + zahl(anteile[id] ?? ''), 0));
  const o = objekte.find((x) => x.id === objekt);
  const k = konten.find((x) => Number(x.id) === konto);

  // Mehrere Einheiten: gleichmäßig aufteilen, danach änderbar. Ändert sich der Betrag, wird neu aufgeteilt.
  const verteilen = (ids: number[], gesamt = brutto) => {
    if (ids.length < 2) return {};
    const teil = Math.floor((gesamt / ids.length) * 100) / 100, rest = r2(gesamt - teil * ids.length);
    return Object.fromEntries(ids.map((id, i) => [id, gesamt ? betragText(i === 0 ? r2(teil + rest) : teil) : '']));
  };
  const einheitUmschalten = (id: number) => {
    const neu = wahl.includes(id) ? wahl.filter((x) => x !== id) : [...wahl, id];
    setWahl(neu); setAnteile(verteilen(neu));
  };
  useEffect(() => { if (wahl.length > 1) setAnteile(verteilen(wahl)); }, [brutto]);

  const suchen = (t: string) => {
    setSuche(t); kontoVomNutzer.current = true;
    const q = t.trim().toLowerCase();
    if (!q) return;
    const treffer = konten.find((x) => String(x.nummer).startsWith(q)) ?? konten.find((x) => String(x.name).toLowerCase().includes(q));
    if (treffer) kontoWaehlen(Number(treffer.id));
  };

  function zuruecksetzen() {
    kontoVomNutzer.current = false; setSuche('');
    setNr(''); setBetrag(''); setWahl([]); setAnteile({}); setLieferant(''); setFirmaId(null);
    setFaellig(''); setBezahlt(''); setLohn(''); setNotiz(''); setDatei(null); setLesen(''); setArt('Ausgabe'); setDatum(heute());
    mwstAusBeleg.current = false; setMitMwst(true); setSatz('19');
  }

  async function sichern() {
    setFehler('');
    if (!konto || !datum || !brutto || objekt === '') { setFehler('Bitte Datum, Betrag, Konto und Immobilie ausfüllen.'); return; }
    if (k?.rechnung_pflicht && !nr.trim()) { setFehler(`Das Konto ${k.nummer} verlangt eine Rechnungsnummer.`); return; }
    const sp = (await gesperrt(Number(objekt), datum)) ?? (bezahlt ? await gesperrt(Number(objekt), bezahlt) : null);
    if (sp) { setFehler(sperrText(sp)); return; }
    if (umsatz && Math.abs(brutto - Math.abs(Number(umsatz.betrag))) > 0.005) { setFehler(`Der Betrag muss dem Bankumsatz entsprechen (${eur(Math.abs(Number(umsatz.betrag)))}).`); return; }
    if (umsatz && (art === 'Gutschrift') !== (Number(umsatz.betrag) > 0)) { setFehler(Number(umsatz.betrag) > 0 ? 'Ein Zahlungseingang ist eine Gutschrift.' : 'Eine Abbuchung ist eine Ausgabe, keine Gutschrift.'); return; }
    if (lohn && Math.abs(zahl(lohn)) > Math.abs(brutto) + 0.005) { setFehler('Der § 35a-Anteil kann nicht größer sein als der Rechnungsbetrag.'); return; }
    if (wahl.length > 1 && Math.abs(summeEigen - brutto) > 0.005) { setFehler(`Die Beträge der Einheiten (${eur(summeEigen)}) ergeben nicht den Rechnungsbetrag (${eur(brutto)}).`); return; }
    setBusy(true);
    try {
      // Lieferant: gewählter Kontakt oder neu als Firmenkontakt anlegen
      let fid = firmaId;
      const name = lieferant.trim();
      if (!fid && name) {
        const da = firmen.find((f) => String(f.name).toLowerCase() === name.toLowerCase());
        fid = da ? da.id : await insert('firmen', { name, gewerk: 'Lieferant' });
      }
      // Beleg in die Ablage der Liegenschaft
      let dokId: number | null = null;
      if (datei) {
        await speichern(new Uint8Array(await datei.arrayBuffer()), datei.name, { bezug: 'Objekt', bezugId: Number(objekt), ordner: [o?.name ?? 'Liegenschaft', 'Rechnungen', datum.slice(0, 4)] });
        dokId = letztesDokument() || null;
      }
      const vz = art === 'Gutschrift' ? -1 : 1;
      const basis = { objekt_id: Number(objekt), firma_id: fid, rechnungsnr: nr.trim() || null, datum, buchungskonto_id: Number(konto),
        mwst_satz: mitMwst ? s : 0, faellig: faellig || null, bezahlt_am: bezahlt || null, dokument_id: dokId, notiz: notiz.trim() || null };
      const teile: [number | null, number][] = wahl.length === 0 ? [[null, brutto]] : wahl.length === 1 ? [[wahl[0], brutto]] : wahl.map((id) => [id, zahl(anteile[id] ?? '')]);
      for (const [eid, b] of teile) {
        const rid = await insert('rechnungen', { ...basis, einheit_id: eid, betrag: r2(vz * b), anteil_lohn: lohn ? r2((zahl(lohn) * b) / brutto) : null });
        // Schon bezahlt (z. B. bar oder ohne Bankumsatz): gleich als Ausgabe buchen, damit sie in Einnahmen & Ausgaben steht
        if (bezahlt) await insert('buchungen', { datum: bezahlt, betrag: r2(-vz * b), buchungskonto_id: Number(konto), objekt_id: Number(objekt), einheit_id: eid,
          rechnung_id: rid, firma_id: fid, bankumsatz_id: umsatz?.id ?? null, text: `Rechnung ${nr.trim()} ${name}`.replace(/\s+/g, ' ').trim() });
      }
      if (umsatz) await db.execute(`UPDATE bankumsaetze SET status = 'zugeordnet' WHERE id = $1`, [umsatz.id]);
      onSaved(`${art === 'Gutschrift' ? 'Gutschrift' : 'Rechnung'}${nr ? ' ' + nr : ''} über ${eur(brutto)} gespeichert${teile.length > 1 ? `, aufgeteilt auf ${teile.length} Einheiten` : ''}${datei ? ', Beleg abgelegt' : ''}.`);
      zuruecksetzen();
    } catch (e: any) { setFehler(String(e?.message ?? e)); }
    finally { setBusy(false); }
  }

  const mit35 = !!k && !!(k.hdl || k.hwl);
  return (
    <section className="card rerf">
      <div className="card-head"><h2 className="title-ico"><Plus size={22} />{art === 'Gutschrift' ? 'Gutschrift erfassen' : 'Rechnung erfassen'}</h2>
        <div className="seg">{(['Ausgabe', 'Gutschrift'] as const).map((a) => <button key={a} className={art === a ? 'on' : ''} onClick={() => setArt(a)}>{a === 'Ausgabe' ? 'Rechnung' : a}</button>)}</div></div>
      <div className="rerf-grid">
        <div className="rerf-form">
          <div className="bf-kopf">
            <label><span>Datum *</span><input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} /></label>
            <label className="grow"><span>Rechnungsnummer{k?.rechnung_pflicht ? ' *' : ''}</span><input value={nr} onChange={(e) => setNr(e.target.value)} placeholder="z. B. RE-2026-0815" /></label>
            <label><span>Betrag brutto *</span><BetragFeld value={betrag} onChange={(e) => setBetrag(e.target.value)} /></label>
          </div>
          <div className="row rerf-mwst">
            <label className="check"><input type="checkbox" checked={mitMwst} onChange={(e) => setMitMwst(e.target.checked)} /><span>Beinhaltet MwSt</span></label>
            {mitMwst && <div className="addon klein"><span>MwSt-Satz</span><input inputMode="decimal" value={satz} onChange={(e) => setSatz(e.target.value)} /><span>%</span></div>}
            {brutto > 0 && <span className="muted small">netto {eur(netto)} · MwSt {eur(r2(brutto - netto))}</span>}
          </div>

          <div className="bf-schritt">
            <div className="bf-titel"><span className="bf-nr">1</span>Konto
              <label className="bf-suche"><Search size={14} /><input placeholder="Nummer oder Name …" value={suche} onChange={(e) => suchen(e.target.value)} /></label></div>
            {konten.length > 0 && <div onPointerDown={() => { kontoVomNutzer.current = true; }} onWheel={() => { kontoVomNutzer.current = true; }} onKeyDown={() => { kontoVomNutzer.current = true; }}>
              <KontoRad konten={konten} wert={konto} onWahl={kontoWaehlen} /></div>}
            {k && <p className="bf-gewaehlt"><Check size={14} /> {k.nummer} {k.name}<span className="muted"> · {k.gruppe}</span></p>}
          </div>

          {mit35 && <div className="bf-schritt bf-neu">
            <div className="bf-titel"><span className="bf-nr">§</span>§ 35a <span className="muted small">{k?.hdl ? 'haushaltsnahe Dienstleistung' : 'Handwerkerleistung'}</span></div>
            <BetragFeld placeholder="davon Arbeitskosten, leer = ganzer Betrag" value={lohn} onChange={(e) => setLohn(e.target.value)} />
            <p className="muted small" style={{ margin: '6px 0 0' }}>Erscheint in der Abrechnung als § 35a-Anteil der Eigentümer bzw. Mieter.</p>
          </div>}

          <div className="bf-schritt">
            <div className="bf-titel"><span className="bf-nr">2</span>Immobilie und Einheiten</div>
            {objektFest
              ? <p className="rerf-objekt"><b>{o?.objekt_nr ? `H-ID ${o.objekt_nr} · ` : ''}{o?.name}</b>{o ? <span className="muted"> · {[o.strasse, [o.plz, o.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</span> : null}</p>
              : <select value={objekt} onChange={(e) => setObjekt(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">– Liegenschaft wählen –</option>{objekte.map((x) => <option key={x.id} value={x.id}>{x.objekt_nr ? `H-ID ${x.objekt_nr} · ` : ''}{x.name}</option>)}</select>}
            {objekt !== '' && <div className="bf-liste">
              <button type="button" className={'bf-zeile alle' + (wahl.length === 0 ? ' an' : '')} onClick={() => { setWahl([]); setAnteile({}); }}>
                <span className="bf-haken">{wahl.length === 0 && <Check size={13} />}</span>
                <b>Alle Einheiten</b><span className="bf-name muted">Umlage nach Schlüssel</span>
              </button>
              {einheiten.map((x, i) => {
                const an = wahl.includes(x.id);
                return (
                  <div key={x.id} className={'bf-zeile' + (an ? ' an' : '')} style={{ animationDelay: `${0.03 * i}s` }} onClick={() => einheitUmschalten(x.id)} role="checkbox" aria-checked={an}>
                    <span className="bf-haken">{an && <Check size={13} />}</span>
                    <b>{x.nummer}</b>
                    <span className="bf-name">{x.person ?? <span className="muted">leer stehend</span>}</span>
                    {an && wahl.length > 1 && <BetragFeld zelle value={anteile[x.id] ?? ''} onClick={(e) => e.stopPropagation()} onChange={(e) => setAnteile({ ...anteile, [x.id]: e.target.value })} />}
                  </div>);
              })}
            </div>}
            {wahl.length > 1 && <p className={'small ' + (Math.abs(summeEigen - brutto) > 0.005 ? 'warn' : 'muted')}>{wahl.length} Einheiten · Summe {eur(summeEigen)} von {eur(brutto)}, gleichmäßig aufgeteilt und änderbar.</p>}
            {wahl.length === 1 && <p className="muted small">Der ganze Betrag geht auf diese Einheit.</p>}
          </div>

          <div className="bf-schritt">
            <div className="bf-titel"><span className="bf-nr">3</span>Lieferant oder Dienstleister</div>
            <div className="addon">
              <input list="rerf-firmen" value={lieferant} onChange={(e) => { setLieferant(e.target.value); setFirmaId(firmen.find((f) => f.name === e.target.value)?.id ?? null); }} placeholder="Name, neuer Name wird als Firmenkontakt angelegt" />
              {lieferant && <button className="icon-btn" title="Leeren" onClick={() => { setLieferant(''); setFirmaId(null); }}><X size={16} /></button>}</div>
            <datalist id="rerf-firmen">{firmen.map((f) => <option key={f.id} value={f.name} />)}</datalist>
            <div className="row rerf-kontakt">
              {kontaktWahl
                ? <select autoFocus onChange={(e) => { const f = firmen.find((x) => x.id === Number(e.target.value)); if (f) { setFirmaId(f.id); setLieferant(f.name); } setKontaktWahl(false); }} defaultValue="">
                    <option value="" disabled>Kontakt auswählen …</option>{firmen.map((f) => <option key={f.id} value={f.id}>{f.name}{f.gewerk ? ` (${f.gewerk})` : ''}</option>)}</select>
                : <button className="pill-btn" onClick={() => setKontaktWahl(true)} disabled={!firmen.length}><UserPlus size={16} />Kontakt auswählen</button>}
              {firmaId ? <span className="muted small"><Check size={13} /> Kontakt zugeordnet</span> : null}
            </div>
          </div>

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
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) belegWaehlen(f); }}
          onClick={() => fileRef.current?.click()}>
          <FileUp size={40} strokeWidth={1.4} />
          {datei
            ? <><p><Paperclip size={14} /> <b>{datei.name}</b></p><p className="muted small">{Math.round(datei.size / 1024)} KB · wird beim Speichern in der Ablage der Immobilie unter „Rechnungen/{datum.slice(0, 4)}“ abgelegt</p>
                {lesen && <p className={'small ' + (lesen.startsWith('Aus der') ? 'ok-text' : 'muted')} style={{ maxWidth: 280 }}>{lesen}</p>}
                <button className="link" onClick={(e) => { e.stopPropagation(); setDatei(null); setLesen(''); }}>Entfernen</button></>
            : <><p><b>Rechnung hierher ziehen</b></p><p className="muted small">oder klicken zum Auswählen (PDF oder Bild). Bei PDFs werden die Angaben automatisch ausgelesen.</p></>}
          <input ref={fileRef} type="file" accept=".pdf,image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) belegWaehlen(f); e.target.value = ''; }} />
        </div>
      </div>
      {fehler && <p className="error">{fehler}</p>}
      <div className="row end"><span className="grow" /><button onClick={zuruecksetzen} disabled={busy}>Leeren</button>
        <button className="primary" onClick={sichern} disabled={busy}>{busy ? 'Speichert …' : art === 'Gutschrift' ? 'Gutschrift speichern' : 'Rechnung speichern'}</button></div>
    </section>
  );
}
