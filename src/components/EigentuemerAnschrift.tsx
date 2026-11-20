// Postanschrift der Eigentümer einer Einheit eintragen. Wichtig bei vermieteten Wohnungen:
// Der Eigentümer wohnt dann nicht im Haus, Einladungen und Abrechnungen müssen an seine eigene Anschrift.
import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { db, type Row } from '../db';
import { ortZurPlz, plzFehler } from '../lib/pruefen';

type Anschrift = { strasse: string; plz: string; ort: string };
const leer = (s: string) => (s.trim() === '' ? null : s.trim());

export function EigentuemerAnschrift({ einheit, vermietet, onClose, onSaved }: { einheit: Row; vermietet: boolean; onClose: () => void; onSaved: () => void }) {
  const [eig, setEig] = useState<Row[] | null>(null);
  const [w, setW] = useState<Record<number, Anschrift>>({});
  const [fehler, setFehler] = useState('');

  useEffect(() => {
    db.select(`SELECT DISTINCT p.id, p.anrede, p.vorname, p.nachname, p.firma, p.strasse, p.plz, p.ort FROM eigentum ei JOIN personen p ON p.id = ei.person_id
        WHERE ei.einheit_id = $1 AND (ei.bis IS NULL OR ei.bis >= date('now')) ORDER BY ei.anteil DESC, p.nachname`, [einheit.id])
      .then((r) => { setEig(r); setW(Object.fromEntries(r.map((p) => [p.id, { strasse: p.strasse ?? '', plz: p.plz ?? '', ort: p.ort ?? '' }]))); });
  }, [einheit.id]);

  const setzen = (id: number, f: keyof Anschrift, v: string) => {
    setW((x) => ({ ...x, [id]: { ...x[id], [f]: v } }));
    if (f === 'plz' && /^\d{5}$/.test(v.trim()) && !w[id]?.ort.trim())
      ortZurPlz(v).then((o) => o && setW((x) => (x[id].ort.trim() ? x : { ...x, [id]: { ...x[id], ort: o } })));
  };
  const name = (p: Row) => [p.firma, [p.anrede === 'Firma' ? '' : p.anrede, p.vorname, p.nachname].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  async function speichern() {
    for (const p of eig ?? []) {
      const a = w[p.id];
      const f = plzFehler(a.plz);
      if (f) { setFehler(`${name(p)}: ${f}`); return; }
      const teil = [a.strasse, a.plz, a.ort].filter((x) => x.trim()).length;
      if (teil > 0 && teil < 3) { setFehler(`${name(p)}: Bitte Straße, PLZ und Ort vollständig eintragen.`); return; }
    }
    for (const p of eig ?? []) {
      const a = w[p.id];
      await db.execute('UPDATE personen SET strasse = $1, plz = $2, ort = $3 WHERE id = $4', [leer(a.strasse), leer(a.plz), leer(a.ort), p.id]);
    }
    onSaved();
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal anschrift-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="title-ico"><MapPin size={20} />Anschrift Eigentümer · {einheit.nummer}</h3>
        <p className="muted small">{vermietet
          ? 'Die Wohnung ist vermietet. Der Eigentümer wohnt also nicht im Haus, und Einladungen, Abrechnungen und Wirtschaftsplan gehen an diese Anschrift.'
          : 'Bleibt die Anschrift leer, geht die Post an die Anschrift der Liegenschaft. Wohnt der Eigentümer woanders, trag hier seine Anschrift ein.'}
          {' '}Die Anschrift gilt für den Kontakt, also auch für seine anderen Wohnungen.</p>
        {eig === null ? <p className="muted">Wird geladen…</p>
          : !eig.length ? <p className="tab-hinweis">Für diese Einheit ist noch kein Eigentümer eingetragen. Das geht unter „Eigentümer“ links im Menü.</p>
          : eig.map((p) => (
            <div key={p.id} className="anschrift-person">
              <b>{name(p) || 'Eigentümer'}</b>
              <div className="anschrift-raster">
                <label className="breit2"><span>Straße und Hausnummer</span><input value={w[p.id]?.strasse ?? ''} onChange={(e) => setzen(p.id, 'strasse', e.target.value)} autoFocus={p === eig[0]} /></label>
                <label><span>PLZ</span><input value={w[p.id]?.plz ?? ''} inputMode="numeric" onChange={(e) => setzen(p.id, 'plz', e.target.value)} />
                  {plzFehler(w[p.id]?.plz) && <small className="feld-hinweis">{plzFehler(w[p.id]?.plz)}</small>}</label>
                <label className="breit2"><span>Ort</span><input value={w[p.id]?.ort ?? ''} onChange={(e) => setzen(p.id, 'ort', e.target.value)} /></label>
              </div>
            </div>))}
        {fehler && <p className="error">{fehler}</p>}
        <div className="row end"><button onClick={onClose}>Abbrechen</button>{!!eig?.length && <button className="primary" onClick={speichern}>Anschrift speichern</button>}</div>
      </div>
    </div>
  );
}
