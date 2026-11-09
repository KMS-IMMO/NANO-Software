import { MonatWahl } from './MonatWahl';
// „Mieter anlegen“ direkt aus der Einheit: Mieter (Person), optional zweiter Mieter, Mietvertrag mit Miete und Vorauszahlungen,
// auf Wunsch gleich die Sollstellungen. Alles wird im System gespeichert (Kontakte, Mietverträge, Offene Posten).
import { useEffect, useState } from 'react';
import { KeyRound, UserPlus } from 'lucide-react';
import { db, insert, type Row } from '../db';
import { sollStellen } from '../logic/soll';
import { eur } from './EntityTable';

const zahl = (s: string) => Number(String(s ?? '').replace(/\./g, '').replace(',', '.')) || 0;
const heute = () => new Date().toISOString().slice(0, 10);

type Daten = Record<string, string>;

export function MieterAnlegen({ einheit, objekt, onClose, onSaved }: { einheit: Row; objekt: Row; onClose: () => void; onSaved: (vertragId: number, text: string) => void }) {
  const weg = objekt.verwaltungsart === 'WEG';
  const gewerbe = /gewerbe|laden|büro|praxis/i.test(`${einheit.typ ?? ''} ${einheit.nummer ?? ''}`);
  const [d, setD] = useState<Daten>({
    anrede: 'Herr', vorname: '', nachname: '', firma: '', geburtsdatum: '', telefon: '', mobil: '', email: '', iban: '',
    strasse: objekt.strasse ?? '', plz: objekt.plz ?? '', ort: objekt.ort ?? '',
    m2_vorname: '', m2_nachname: '',
    beginn: `${new Date().getFullYear()}-01-01`, kalt: '', nk: '', hk: '', kaution: '', personen: String(einheit.personenzahl ?? 1), tag: '3',
    ust: gewerbe ? '19' : '0', zahlung_an: weg ? 'Eigentümer' : 'Verwaltung', notiz: '',
  });
  const [soll, setSoll] = useState(!weg);
  const vorjahr = new Date().getFullYear() - 1;
  const [sollVon, setSollVon] = useState('');
  const [sollBis, setSollBis] = useState('');
  const [zweiter, setZweiter] = useState(false);
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);
  const [zu, setZu] = useState(false);
  const [vorhanden, setVorhanden] = useState<Row | null>(null);
  const s = (k: string) => (x: { target: { value: string } }) => setD({ ...d, [k]: x.target.value });

  // Gibt es diese Person schon (z. B. aus einem anderen Vertrag)? Dann wird sie verwendet statt doppelt angelegt.
  useEffect(() => {
    const n = d.nachname.trim(), v = d.vorname.trim(), f = d.firma.trim();
    if (!n && !f) { setVorhanden(null); return; }
    const t = setTimeout(async () => {
      const r = await db.select(`SELECT * FROM personen WHERE ${n ? `LOWER(nachname) = LOWER($1) AND LOWER(COALESCE(vorname, '')) = LOWER($2)` : `LOWER(firma) = LOWER($1) AND $2 = $2`} LIMIT 1`,
        [n || f, v]);
      setVorhanden(r[0] ?? null);
    }, 250);
    return () => clearTimeout(t);
  }, [d.vorname, d.nachname, d.firma]);

  const warm = zahl(d.kalt) + zahl(d.nk) + zahl(d.hk);
  const ust = zahl(d.ust) ? Math.round(warm * zahl(d.ust)) / 100 : 0;
  // Sollstellungen: ab Mietbeginn, bei älteren Verträgen erst ab Januar des Vorjahres (sonst entstehen Jahre an offenen Posten)
  const vonStandard = d.beginn.slice(0, 7) > `${vorjahr}-01` ? d.beginn.slice(0, 7) : `${vorjahr}-01`;
  const von = sollVon || vonStandard, bis = sollBis || `${von.slice(0, 4)}-12`;
  const schliessen = () => { setZu(true); setTimeout(onClose, 180); };

  async function speichern() {
    setFehler('');
    if (!d.nachname.trim() && !d.firma.trim()) { setFehler('Bitte Nachname oder Firma des Mieters eintragen.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.beginn)) { setFehler('Bitte den Mietbeginn eintragen.'); return; }
    if (!weg && !zahl(d.kalt)) { setFehler('Bitte die Kaltmiete eintragen.'); return; }
    const belegt = await db.select(`SELECT 1 FROM mietvertraege WHERE einheit_id = $1 AND (ende IS NULL OR ende >= $2) AND beginn <= COALESCE($3, '9999-12-31') LIMIT 1`,
      [einheit.id, d.beginn, null]);
    if (belegt.length) { setFehler('Für diese Einheit läuft ab diesem Datum schon ein Mietvertrag. Beende ihn zuerst (Vertragsende eintragen).'); return; }
    setBusy(true);
    try {
      const leer = (x: string) => x.trim() || null;
      let mid = vorhanden?.id as number | undefined;
      const person = { anrede: leer(d.anrede), vorname: leer(d.vorname), nachname: leer(d.nachname), firma: leer(d.firma), geburtsdatum: leer(d.geburtsdatum),
        telefon: leer(d.telefon), mobil: leer(d.mobil), email: leer(d.email), iban: leer(d.iban.replace(/\s/g, '').toUpperCase()), strasse: leer(d.strasse), plz: leer(d.plz), ort: leer(d.ort) };
      if (mid) {
        // Vorhandene Person: nur leere Felder ergänzen, nichts überschreiben
        const fehlt = Object.entries(person).filter(([k, v]) => v && !vorhanden![k]);
        if (fehlt.length) await db.execute(`UPDATE personen SET ${fehlt.map(([k], i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${fehlt.length + 1}`, [...fehlt.map(([, v]) => v), mid]);
      } else mid = await insert('personen', { rolle: 'Mieter', ...person });
      let m2: number | null = null;
      if (zweiter && d.m2_nachname.trim()) m2 = await insert('personen', { rolle: 'Mieter', vorname: leer(d.m2_vorname), nachname: d.m2_nachname.trim(), strasse: leer(d.strasse), plz: leer(d.plz), ort: leer(d.ort) });
      const vid = await insert('mietvertraege', { einheit_id: einheit.id, mieter_id: mid, mieter2_id: m2, beginn: d.beginn, kaltmiete: zahl(d.kalt), nk_vorauszahlung: zahl(d.nk),
        hk_vorauszahlung: zahl(d.hk), kaution: zahl(d.kaution), personenzahl: Math.max(0, Math.round(zahl(d.personen))), faellig_tag: Math.min(28, Math.max(1, Math.round(zahl(d.tag)) || 3)),
        ust_satz: zahl(d.ust), zahlung_an: d.zahlung_an, notiz: leer(d.notiz) });
      let n = 0;
      if (soll && d.zahlung_an !== 'Eigentümer' && von <= bis) n = await sollStellen(bis, { von, vertragId: vid });
      const name = [d.firma.trim(), [d.vorname.trim(), d.nachname.trim()].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      onSaved(vid, `${name} ist als Mieter von ${einheit.nummer} ab ${d.beginn.split('-').reverse().join('.')} angelegt${vorhanden ? ' (vorhandener Kontakt verwendet)' : ''}`
        + (n ? `, ${n} Sollstellungen ${von.slice(5)}/${von.slice(0, 4)} bis ${bis.slice(5)}/${bis.slice(0, 4)} erzeugt.` : '.'));
    } catch (e: any) { setFehler(String(e?.message ?? e)); setBusy(false); }
  }

  const Abschnitt = ({ n, titel, children }: { n: number; titel: string; children: React.ReactNode }) => (
    <div className="erin-schritt mieter-abschnitt" style={{ animationDelay: `${60 + n * 70}ms` }}>
      <span className="erin-nr">{n}</span>
      <div className="erin-feld"><span className="erin-label">{titel}</span>{children}</div>
    </div>);

  return (
    <div className={'modal-bg erin-bg' + (zu ? ' zu' : '')} onClick={schliessen}>
      <div className={'modal erin-modal mieter-modal' + (zu ? ' zu' : '')} onClick={(x) => x.stopPropagation()}>
        <div className="erin-kopf"><span className="erin-glocke"><UserPlus size={22} /></span>
          <div><h3>Mieter anlegen: {einheit.nummer}</h3><p className="muted small">{objekt.name}{einheit.lage ? ` · ${einheit.lage}` : ''}{einheit.flaeche ? ` · ${String(einheit.flaeche).replace('.', ',')} m²` : ''}. Der Mieter wird unter Kontakte und Mietverträge gespeichert.</p></div></div>
        <div className="mieter-inhalt">
          {Abschnitt({ n: 1, titel: 'Mieter', children: <>
            <div className="mieter-raster">
              <label><span>Anrede</span><select value={d.anrede} onChange={s('anrede')}>{['Herr', 'Frau', 'Divers', 'Firma', 'Eheleute'].map((a) => <option key={a}>{a}</option>)}</select></label>
              <label><span>Vorname</span><input value={d.vorname} onChange={s('vorname')} autoFocus /></label>
              <label><span>Nachname *</span><input value={d.nachname} onChange={s('nachname')} /></label>
              <label className="breit2"><span>Firma (bei Gewerbe)</span><input value={d.firma} onChange={s('firma')} /></label>
              <label><span>Geburtsdatum</span><input type="date" value={d.geburtsdatum} onChange={s('geburtsdatum')} /></label>
            </div>
            {vorhanden && <p className="tab-hinweis mieter-vorhanden">Diesen Kontakt gibt es schon. Er wird verwendet und nur um fehlende Angaben ergänzt.</p>}
            {!zweiter ? <button type="button" className="link" onClick={() => setZweiter(true)}>+ zweiten Mieter hinzufügen</button>
              : <div className="mieter-raster"><label><span>2. Mieter Vorname</span><input value={d.m2_vorname} onChange={s('m2_vorname')} /></label>
                  <label><span>2. Mieter Nachname</span><input value={d.m2_nachname} onChange={s('m2_nachname')} /></label></div>}
          </> })}
          {Abschnitt({ n: 2, titel: 'Kontakt und Bank', children: <div className="mieter-raster">
            <label><span>Telefon</span><input value={d.telefon} onChange={s('telefon')} /></label>
            <label><span>Mobil</span><input value={d.mobil} onChange={s('mobil')} /></label>
            <label><span>E-Mail</span><input type="email" value={d.email} onChange={s('email')} /></label>
            <label className="breit2"><span>IBAN (für die automatische Zuordnung der Miete)</span><input value={d.iban} onChange={s('iban')} placeholder="DE.." /></label>
            <label className="breit2"><span>Straße</span><input value={d.strasse} onChange={s('strasse')} /></label>
            <label><span>PLZ</span><input value={d.plz} onChange={s('plz')} /></label>
            <label className="breit2"><span>Ort</span><input value={d.ort} onChange={s('ort')} /></label>
          </div> })}
          {Abschnitt({ n: 3, titel: 'Mietvertrag', children: <div className="mieter-raster">
            <label><span>Mietbeginn *</span><input type="date" value={d.beginn} onChange={s('beginn')} /></label>
            <label><span>Kaltmiete € / Monat{weg ? '' : ' *'}</span><input inputMode="decimal" value={d.kalt} onChange={s('kalt')} placeholder="0,00" /></label>
            <label><span>NK-Vorauszahlung €</span><input inputMode="decimal" value={d.nk} onChange={s('nk')} placeholder="0,00" /></label>
            <label><span>HK-Vorauszahlung €</span><input inputMode="decimal" value={d.hk} onChange={s('hk')} placeholder="0,00" /></label>
            <label><span>Kaution €</span><input inputMode="decimal" value={d.kaution} onChange={s('kaution')} placeholder="0,00" /></label>
            <label><span>Personen im Haushalt</span><input inputMode="numeric" value={d.personen} onChange={s('personen')} /></label>
            <label><span>Fällig am (Tag)</span><input inputMode="numeric" value={d.tag} onChange={s('tag')} /></label>
            <label><span>Umsatzsteuer</span><select value={d.ust} onChange={s('ust')}><option value="0">keine (Wohnung)</option><option value="19">19 % (Gewerbe mit Option)</option></select></label>
            {weg && <label><span>Mieter zahlt an</span><select value={d.zahlung_an} onChange={s('zahlung_an')}><option>Eigentümer</option><option>Verwaltung</option></select></label>}
            <label className="breit3"><span>Notiz</span><input value={d.notiz} onChange={s('notiz')} /></label>
          </div> })}
          {Abschnitt({ n: 4, titel: 'Zusammenfassung', children: <div className="mieter-summe">
            <div><span>Warmmiete</span><b>{eur(warm + ust)}</b>{ust ? <span className="muted small"> inkl. {eur(ust)} USt</span> : null}</div>
            {d.zahlung_an !== 'Eigentümer'
              ? <div className="mieter-soll"><label className="inline"><input type="checkbox" checked={soll} onChange={(x) => setSoll(x.target.checked)} /> Sollstellungen gleich anlegen</label>
                  {soll && <><label className="inline">von <MonatWahl value={von} onChange={setSollVon} /></label>
                    <label className="inline">bis <MonatWahl value={bis} onChange={setSollBis} /></label></>}</div>
              : <span className="muted small">Der Mieter zahlt an den Eigentümer, darum entstehen bei uns keine Sollstellungen.</span>}
          </div> })}
        </div>
        {fehler && <p className="error" style={{ margin: '4px 22px' }}>{fehler}</p>}
        <div className="row end erin-fuss"><button onClick={schliessen}>Abbrechen</button>
          <button className="primary" disabled={busy} onClick={speichern}><KeyRound size={16} />{busy ? 'Speichere …' : 'Mieter und Vertrag anlegen'}</button></div>
      </div>
    </div>
  );
}

export const heuteIso = heute;
