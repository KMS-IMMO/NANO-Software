// Abschluss der Abrechnung: Prüfliste, PDF-Vorschau aller Schreiben, Abschließen bzw. Aufheben,
// danach endgültige PDFs ablegen und Ergebnis buchen.
import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Lock, Unlock, Eye, FileDown, X, Printer, ExternalLink } from 'lucide-react';
import { type Row } from '../db';
import { ABSCHLUSS_TEXT, abschliessen, abschlussAufheben, abschlussLaden, pruefen, type AbschlussArt, type Pruefung } from '../logic/abschluss';
import { oeffnen, speichern } from '../lib/dateien';

const datum = (d: string) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('de-DE') : '');

export function AbschlussKarte({ objekt, jahr, art, extra, stand, vorschau, ablegen, buchen, buchenText, ergebnis, ordner, onStatus, unten }: {
  objekt: number; jahr: number; art: AbschlussArt; extra: Pruefung[]; stand: number;
  /** Alle Schreiben in einem PDF; `entwurf` = mit Schriftzug ENTWURF */
  vorschau: (entwurf: boolean) => Promise<Uint8Array>;
  ablegen: () => Promise<void>; buchen?: () => Promise<void>; buchenText?: string;
  ergebnis: () => Record<string, unknown>; ordner: string[]; onStatus: (abgeschlossen: Row | null, info?: string) => void;
  /** Kompakte Leiste am Ende der Seite: abschließen und gleich die fertige PDF zeigen */
  unten?: boolean;
}) {
  const [checks, setChecks] = useState<Pruefung[]>([]);
  const [ab, setAb] = useState<Row | null>(null);
  const [pdf, setPdf] = useState<{ url: string; bytes: Uint8Array } | null>(null);
  const [busy, setBusy] = useState('');
  const name = ABSCHLUSS_TEXT[art];
  const extraKey = JSON.stringify(extra);

  async function laden() {
    const a = await abschlussLaden(objekt, jahr, art);
    setAb(a); onStatus(a);
    setChecks(await pruefen(objekt, jahr, art, extra));
  }
  useEffect(() => { if (objekt && jahr >= 1900) laden(); }, [objekt, jahr, art, stand, extraKey]);
  // Oben und unten gibt es je eine Karte: nach Abschluss oder Aufheben laden beide neu
  useEffect(() => { const f = () => laden(); window.addEventListener('nano-abschluss', f); return () => window.removeEventListener('nano-abschluss', f); }, [objekt, jahr, art, extraKey]);
  const melden = () => window.dispatchEvent(new Event('nano-abschluss'));

  const blocker = checks.filter((c) => !c.ok && c.sperrt), hinweise = checks.filter((c) => !c.ok && !c.sperrt);

  async function zeigen(entwurf = !ab) {
    setBusy('vorschau');
    try {
      const bytes = await vorschau(entwurf);
      setPdf({ url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' })), bytes });
    } finally { setBusy(''); }
  }
  function schliessen() { if (pdf) URL.revokeObjectURL(pdf.url); setPdf(null); }
  async function extern() {
    if (!pdf) return;
    const pfad = await speichern(pdf.bytes, `${ab ? '' : 'Entwurf '}${name} ${jahr} gesamt.pdf`, { bezug: 'Objekt', bezugId: objekt, ordner: [...ordner, 'Vorschau'] });
    oeffnen(pfad);
  }
  function drucken() {
    const f = document.getElementById('abschluss-pdf') as HTMLIFrameElement | null;
    try { f?.contentWindow?.focus(); f?.contentWindow?.print(); } catch { extern(); }
  }
  async function abschluss() {
    if (blocker.length) return;
    if (hinweise.length && !window.confirm(`Trotz Hinweisen abschließen?\n\n${hinweise.map((h) => '• ' + h.text + (h.hinweis ? ': ' + h.hinweis : '')).join('\n')}`)) return;
    if (!window.confirm(`${name} ${jahr} jetzt abschließen? Danach sind Buchungen und Rechnungen des Jahres für diese Liegenschaft gesperrt.`)) return;
    await abschliessen(objekt, jahr, art, ergebnis());
    await laden(); melden(); onStatus(await abschlussLaden(objekt, jahr, art), `${name} ${jahr} abgeschlossen. Prüfe jetzt die PDF-Vorschau, dann kannst du die PDFs ablegen, drucken oder versenden.`);
    // Nach dem Abschluss direkt die fertige Abrechnung (ohne ENTWURF) zeigen
    await zeigen(false);
  }
  async function aufheben() {
    if (!window.confirm(`Abschluss der ${name} ${jahr} aufheben? Buchungen des Jahres lassen sich dann wieder ändern.`)) return;
    await abschlussAufheben(objekt, jahr, art);
    await laden(); melden(); onStatus(null, `Abschluss der ${name} ${jahr} aufgehoben.`);
  }
  async function los(k: string, f: () => Promise<void>) { setBusy(k); try { await f(); } finally { setBusy(''); } }

  if (unten) return (
    <section className={'card abschluss-unten' + (ab ? ' zu' : '')}>
      <div className="abschluss-unten-text">
        {ab ? <><Lock size={18} /><span><b>{name} {jahr} ist abgeschlossen</b> am {datum(ab.abgeschlossen_am)}.</span></>
          : blocker.length ? <><XCircle size={18} className="neg" /><span><b>Noch nicht bereit:</b> {blocker.length} Punkt{blocker.length === 1 ? '' : 'e'} der Prüfliste oben {blocker.length === 1 ? 'ist' : 'sind'} rot.</span></>
          : <><CheckCircle2 size={18} className="pos" /><span><b>Alles eingetragen.</b> Abschließen erstellt die {name} {jahr} als PDF.</span></>}
      </div>
      <div className="row">
        {ab ? <>
          <button onClick={() => zeigen(false)} disabled={!!busy}><Eye size={16} />{busy === 'vorschau' ? 'PDF wird erstellt …' : 'PDF ansehen'}</button>
          <button className="primary" onClick={() => los('ablegen', ablegen)} disabled={!!busy}><FileDown size={16} />{busy === 'ablegen' ? 'Wird abgelegt …' : 'PDFs erstellen und ablegen'}</button></>
          : <button className="primary abschluss-los" onClick={abschluss} disabled={!!blocker.length || !!busy} title={blocker.length ? 'Erst die rot markierten Punkte oben erledigen' : ''}><Lock size={16} />Abschluss: abschließen und PDF öffnen</button>}
      </div>
      {pdf && (
        <div className="modal-bg" onClick={schliessen}>
          <div className="modal pdf-vorschau" onClick={(e) => e.stopPropagation()}>
            <div className="card-head"><h3>{ab ? '' : 'Entwurf: '}{name} {jahr}</h3>
              <div className="row"><button onClick={drucken}><Printer size={16} />Drucken</button><button onClick={extern}><ExternalLink size={16} />Im PDF-Programm öffnen</button>
                <button className="icon-btn" title="Schließen" onClick={schliessen}><X size={18} /></button></div></div>
            <iframe id="abschluss-pdf" title="PDF-Vorschau" src={pdf.url} />
          </div>
        </div>)}
    </section>
  );

  return (
    <section className={'card abschluss' + (ab ? ' zu' : '')}>
      <div className="card-head">
        <h2 className="title-ico">{ab ? <Lock size={20} /> : <Unlock size={20} />}Abschluss {name} {jahr}</h2>
        {ab ? <span className="pill st-aktiv">abgeschlossen am {datum(ab.abgeschlossen_am)}</span> : <span className="pill">offen</span>}
      </div>
      <ul className="pruefliste">{checks.map((c, i) => (
        <li key={i} className={c.ok ? 'ok' : c.sperrt ? 'fehlt' : 'hinweis'}>
          {c.ok ? <CheckCircle2 size={17} /> : c.sperrt ? <XCircle size={17} /> : <AlertTriangle size={17} />}
          <span>{c.text}{!c.ok && c.hinweis && <span className="muted"> · {c.hinweis}</span>}</span></li>))}
      </ul>
      <div className="row">
        <button onClick={() => zeigen()} disabled={!!busy}><Eye size={16} />{busy === 'vorschau' ? 'PDF wird erstellt …' : 'PDF-Vorschau'}</button>
        <span className="grow" />
        {!ab ? <button className="primary" onClick={abschluss} disabled={!!blocker.length} title={blocker.length ? 'Erst die rot markierten Punkte erledigen' : ''}><Lock size={16} />Abrechnung abschließen</button> : <>
          <button onClick={aufheben}><Unlock size={16} />Abschluss aufheben</button>
          {buchen && <button onClick={() => los('buchen', buchen)} disabled={!!busy}>{buchenText}</button>}
          <button className="primary" onClick={() => los('ablegen', ablegen)} disabled={!!busy}><FileDown size={16} />{busy === 'ablegen' ? 'Wird abgelegt …' : 'PDFs erstellen und ablegen'}</button></>}
      </div>
      <p className="muted small">{ab
        ? 'Die Abrechnung ist abgeschlossen. Buchungen und Rechnungen dieses Jahres sind für die Liegenschaft gesperrt. Zum Korrigieren hebst du den Abschluss auf.'
        : 'Die Vorschau zeigt alle Schreiben in einem PDF, noch mit dem Schriftzug „ENTWURF“. Abschließen geht, wenn alle rot markierten Punkte erledigt sind.'}</p>
      {pdf && (
        <div className="modal-bg" onClick={schliessen}>
          <div className="modal pdf-vorschau" onClick={(e) => e.stopPropagation()}>
            <div className="card-head"><h3>{ab ? '' : 'Entwurf: '}{name} {jahr}</h3>
              <div className="row"><button onClick={drucken}><Printer size={16} />Drucken</button><button onClick={extern}><ExternalLink size={16} />Im PDF-Programm öffnen</button>
                <button className="icon-btn" title="Schließen" onClick={schliessen}><X size={18} /></button></div></div>
            <iframe id="abschluss-pdf" title="PDF-Vorschau" src={pdf.url} />
          </div>
        </div>)}
    </section>
  );
}
