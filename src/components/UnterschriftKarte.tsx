// Einstellungen: Unterschrift zeichnen oder einscannen. Sie erscheint unter Briefen, Abrechnungen und PDF-Berichten.
import { useEffect, useRef, useState } from 'react';
import { Eraser, Eye, FileUp, PenLine, Trash2, X } from 'lucide-react';
import { freistellen, unterschriftAusDatei, unterschriftLaden, unterschriftSpeichern } from '../lib/unterschrift';
import { Brief, absender } from '../lib/pdf';
import { pdfSeitenAlsBilder } from '../lib/briefpapier';

export function UnterschriftKarte() {
  const [bild, setBild] = useState('');
  const [name, setName] = useState('');
  const [funktion, setFunktion] = useState('');
  const [drucken, setDrucken] = useState(true);
  const [zeichnen, setZeichnen] = useState(false);
  const [leer, setLeer] = useState(true);
  const [ok, setOk] = useState('');
  const [fehler, setFehler] = useState('');
  const [muster, setMuster] = useState<string[] | null>(null);
  const flaeche = useRef<HTMLCanvasElement>(null);
  const datei = useRef<HTMLInputElement>(null);
  const zug = useRef<{ x: number; y: number } | null>(null);

  async function laden() {
    const u = await unterschriftLaden();
    setBild(u?.bild ?? ''); setName(u?.name ?? ''); setFunktion(u?.funktion ?? ''); setDrucken(u ? u.drucken : true);
  }
  useEffect(() => { laden(); }, []);
  const melden = (t: string) => { setOk(t); setTimeout(() => setOk(''), 2500); };

  // Zeichenfläche in doppelter Auflösung, damit die Linie im PDF scharf bleibt
  useEffect(() => {
    const c = flaeche.current; if (!zeichnen || !c) return;
    const r = c.getBoundingClientRect(); c.width = Math.round(r.width * 2); c.height = Math.round(r.height * 2);
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#14213d'; ctx.lineWidth = 4.2;
    setLeer(true);
  }, [zeichnen]);
  const punkt = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return { x: (e.clientX - r.left) * 2, y: (e.clientY - r.top) * 2 }; };
  const runter = (e: React.PointerEvent<HTMLCanvasElement>) => { e.currentTarget.setPointerCapture(e.pointerId); zug.current = punkt(e); };
  const ziehen = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!zug.current) return;
    const ctx = e.currentTarget.getContext('2d')!; const p = punkt(e);
    // Druckstärke (Stift/Trackpad) leicht berücksichtigen
    ctx.lineWidth = 3.2 + (e.pressure && e.pressure !== 0.5 ? e.pressure * 3 : 1);
    ctx.beginPath(); ctx.moveTo(zug.current.x, zug.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    zug.current = p; setLeer(false);
  };
  const hoch = () => { zug.current = null; };
  function leeren() { setZeichnen(false); setTimeout(() => setZeichnen(true), 0); }

  async function zeichnungUebernehmen() {
    const c = flaeche.current; if (!c) return;
    const r = freistellen(c);
    if (!r) { setFehler('Bitte zuerst unterschreiben.'); return; }
    // Name und Funktion gleich mitspeichern, damit nichts Eingetipptes verloren geht
    await unterschriftSpeichern({ unterschrift_bild: r.bild, unterschrift_breite: String(r.breite), unterschrift_hoehe: String(r.hoehe),
      unterschrift_name: name.trim(), unterschrift_funktion: funktion.trim(), unterschrift_drucken: drucken ? '1' : '0' });
    setBild(r.bild); setZeichnen(false); setFehler(''); melden('Unterschrift gespeichert');
  }
  async function hochladen(f?: File) {
    if (!f) return;
    try {
      const r = await unterschriftAusDatei(f);
      await unterschriftSpeichern({ unterschrift_bild: r.bild, unterschrift_breite: String(r.breite), unterschrift_hoehe: String(r.hoehe),
        unterschrift_name: name.trim(), unterschrift_funktion: funktion.trim(), unterschrift_drucken: drucken ? '1' : '0' });
      setBild(r.bild); setFehler(''); melden('Unterschrift aus dem Scan übernommen');
    } catch (e: any) { setFehler(e?.message ?? String(e)); }
    if (datei.current) datei.current.value = '';
  }
  async function angabenSpeichern() {
    await unterschriftSpeichern({ unterschrift_name: name.trim(), unterschrift_funktion: funktion.trim(), unterschrift_drucken: drucken ? '1' : '0' });
    melden('Gespeichert');
  }
  async function entfernen() {
    await unterschriftSpeichern({ unterschrift_bild: '', unterschrift_breite: '', unterschrift_hoehe: '' });
    setBild(''); melden('Unterschrift entfernt');
  }
  async function musterZeigen() {
    await angabenSpeichern();
    const b = new Brief(await absender()).neuerBrief();
    b.kopf(['Herrn', 'Max Mustermann', 'Musterstraße 1', '50667 Köln'], new Date().toISOString().slice(0, 10));
    b.betreff('Musterbrief mit Unterschrift');
    b.absatz('Sehr geehrter Herr Mustermann,');
    b.absatz('so erscheint deine Unterschrift unter Briefen, Mahnungen, Abrechnungen und den PDF-Berichten.');
    b.gruss();
    setMuster(await pdfSeitenAlsBilder(b.bytes(), 1, 900, 'image/png'));
  }

  return (
    <section className="card unterschrift-karte">
      <div className="card-head"><h2 className="title-ico"><PenLine size={22} />Unterschrift</h2></div>
      <p className="muted" style={{ marginTop: 0 }}>Unterschreibe direkt hier mit Maus oder Trackpad, oder lade einen Scan bzw. ein Foto deiner Unterschrift hoch. Der Hintergrund wird automatisch entfernt. Die Unterschrift steht dann unter Briefen, Abrechnungen und PDF-Berichten.</p>
      <input ref={datei} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => hochladen(e.target.files?.[0])} />
      <div className="us-reihe">
        <div className="us-feld">
          {zeichnen ? (
            <>
              <canvas ref={flaeche} className="us-flaeche" onPointerDown={runter} onPointerMove={ziehen} onPointerUp={hoch} onPointerLeave={hoch} aria-label="Hier unterschreiben" />
              <span className="us-linie" aria-hidden />
              {leer && <span className="us-hinweis">Hier unterschreiben</span>}
              <div className="row" style={{ gap: 8, marginTop: 10 }}>
                <button onClick={leeren}><Eraser size={16} />Neu</button>
                <button onClick={() => setZeichnen(false)}><X size={16} />Abbrechen</button>
                <span className="grow" />
                <button className="primary" disabled={leer} onClick={zeichnungUebernehmen}>Übernehmen</button>
              </div>
            </>
          ) : bild ? (
            <div className="us-vorschau"><img src={bild} alt="Gespeicherte Unterschrift" /><span className="us-linie" aria-hidden />
              <small>{[name, funktion].filter(Boolean).join(' · ') || 'Name und Funktion rechts eintragen'}</small></div>
          ) : (
            <button className="us-leer" onClick={() => setZeichnen(true)}><PenLine size={22} /><span>Jetzt unterschreiben</span><small>mit Maus, Trackpad oder Stift</small></button>
          )}
        </div>
        <div className="us-optionen">
          <div className="form">
            <label><span>Name unter der Unterschrift</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Max Mustermann" /></label>
            <label><span>Funktion</span><input value={funktion} onChange={(e) => setFunktion(e.target.value)} placeholder="z. B. Geschäftsführer" /></label>
          </div>
          <label className="check"><input type="checkbox" checked={drucken} onChange={(e) => setDrucken(e.target.checked)} /><span>Unterschrift automatisch unter Briefe und PDFs setzen</span></label>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <button onClick={() => setZeichnen(true)}><PenLine size={16} />{bild ? 'Neu unterschreiben' : 'Unterschreiben'}</button>
            <button onClick={() => datei.current?.click()}><FileUp size={16} />Scan hochladen</button>
            {bild && <button className="danger-link" onClick={entfernen}><Trash2 size={16} />Entfernen</button>}
          </div>
          <div className="row end" style={{ marginTop: 10 }}>
            <span className="grow" />{ok && <span className="pos">{ok}</span>}
            <button onClick={musterZeigen}><Eye size={16} />Musterbrief ansehen</button>
            <button className="primary" onClick={angabenSpeichern}>Speichern</button>
          </div>
          {fehler && <p className="error">{fehler}</p>}
        </div>
      </div>
      {muster && (
        <div className="modal-bg" onClick={() => setMuster(null)}>
          <div className="modal pdf-vorschau" onClick={(e) => e.stopPropagation()}>
            <div className="card-head"><h3>Musterbrief</h3><button className="icon-btn" title="Schließen" onClick={() => setMuster(null)}><X size={18} /></button></div>
            <div className="bp-muster">{muster.map((s, i) => <img key={i} src={s} alt={`Seite ${i + 1}`} />)}</div>
          </div>
        </div>
      )}
    </section>
  );
}
