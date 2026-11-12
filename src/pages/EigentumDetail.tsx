// Ansicht eines Eigentümers einer Einheit: alle Angaben zur Person, Kontakt und Bank sowie zum Eigentum (seit, Anteil, Zahlweise)
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { IdCard } from 'lucide-react';
import { db, type Row } from '../db';
import { datum, eur, num } from '../components/EntityTable';
import { StammdatenKarte, personFelder, personWerte, personAenderungen, type SGruppe } from '../components/Stammdaten';
import { OP_SQL, hausgeldNeuStellen } from '../logic/soll';
import { personLabel, widSql } from '../db/labels';

export function EigentumDetailPage({ objektId, eigentumId }: { objektId: number; eigentumId: number }) {
  const [ei, setEi] = useState<Row | null | undefined>(undefined);
  const [p, setP] = useState<Row | undefined>();
  const [hg, setHg] = useState<Row | undefined>();
  const [offen, setOffen] = useState(0);
  const [wo, setWo] = useState('');
  const reload = async () => {
    const r = (await db.select(`SELECT ei.*, e.nummer AS einheit, e.lage, e.flaeche, e.mea, ${widSql('e', 'o')} AS wid, o.name AS objekt, o.ruecklage_zahlweise,
        ${personLabel('p')} AS name,
        CASE WHEN ei.von > date('now') THEN 'künftig' WHEN ei.bis IS NOT NULL AND ei.bis < date('now') THEN 'beendet' ELSE 'aktiv' END AS status
      FROM eigentum ei JOIN einheiten e ON e.id = ei.einheit_id JOIN objekte o ON o.id = e.objekt_id JOIN personen p ON p.id = ei.person_id
      WHERE ei.id = $1`, [eigentumId]))[0] ?? null;
    setEi(r);
    if (!r) return;
    setP((await db.select('SELECT * FROM personen WHERE id = $1', [r.person_id]))[0]);
    setHg((await db.select(`SELECT * FROM hausgeld WHERE einheit_id = $1 AND gueltig_ab <= date('now') ORDER BY gueltig_ab DESC LIMIT 1`, [r.einheit_id]))[0]);
    setOffen(Number((await db.select(`SELECT SUM(betrag - bezahlt) AS s FROM (${OP_SQL}) WHERE person_id = $1 AND einheit_id = $2 AND faellig <= date('now')`,
      [r.person_id, r.einheit_id]))[0]?.s ?? 0));
    setWo((await db.select(`SELECT GROUP_CONCAT(x, '; ') AS wo FROM (
        SELECT o.name || ' ' || e.nummer || ' (Eigentümer)' AS x FROM eigentum x JOIN einheiten e ON e.id = x.einheit_id JOIN objekte o ON o.id = e.objekt_id
          WHERE x.person_id = $1 AND (x.bis IS NULL OR x.bis >= date('now'))
        UNION ALL SELECT o.name || ' ' || e.nummer || ' (Mieter)' FROM mietvertraege m JOIN einheiten e ON e.id = m.einheit_id JOIN objekte o ON o.id = e.objekt_id
          WHERE (m.mieter_id = $1 OR m.mieter2_id = $1) AND (m.ende IS NULL OR m.ende >= date('now')))`, [r.person_id]))[0]?.wo ?? '');
  };
  useEffect(() => { reload(); }, [eigentumId]);
  if (ei === undefined) return <p>Wird geladen…</p>;
  if (ei === null) return <p className="muted">Diesen Eintrag gibt es nicht mehr. <Link to={`/objekte/${objektId}/eigentuemer`}>Zurück zu den Eigentümern</Link></p>;

  const rl = Number(hg?.davon_ruecklage) || 0, gesamt = Number(hg?.betrag) || 0;
  const gruppen: SGruppe[] = [
    ...personFelder('Eigentümer', [{ key: 'wo', label: 'Hinterlegt bei', breit: 3, anzeige: wo || '–' }]),
    { titel: 'Eigentum', felder: [
      { key: 'einheit', label: 'Einheit', nurLesen: true, anzeige: <>{ei.wid} · {ei.einheit}{ei.lage ? ` · ${ei.lage}` : ''}</> },
      { key: 'mea', label: 'MEA / Fläche', nurLesen: true, anzeige: <>{num(ei.mea, 0) || '–'} MEA · {ei.flaeche ? `${num(ei.flaeche)} m²` : '–'}</> },
      { key: 'e_anteil', label: 'Anteil %', typ: 'zahl' },
      { key: 'e_von', label: 'Eigentümer seit', typ: 'datum' },
      { key: 'e_bis', label: 'bis (Verkauf)', typ: 'datum' },
      { key: 'e_zahlweise', label: 'Zahlweise Hausgeld + Rücklage', typ: 'auswahl', optionen: [
        { value: '', label: `wie Liegenschaft (${ei.ruecklage_zahlweise === 'getrennt' ? 'getrennt' : 'in einer Summe'})` },
        { value: 'zusammen', label: 'in einer Summe' }, { value: 'getrennt', label: 'getrennt' }] },
    ] },
  ];

  const speichern = async (neu: Row) => {
    if ('p_nachname' in neu || 'p_firma' in neu) {
      const nn = 'p_nachname' in neu ? neu.p_nachname : p?.nachname, fi = 'p_firma' in neu ? neu.p_firma : p?.firma;
      if (!nn && !fi) throw new Error('Bitte Nachname oder Firma angeben.');
    }
    const von = 'e_von' in neu ? neu.e_von : ei.von, bis = 'e_bis' in neu ? neu.e_bis : ei.bis;
    if (von && bis && bis < von) throw new Error('„bis“ liegt vor „Eigentümer seit“.');
    const pa = personAenderungen(neu);
    if (pa) await db.execute(`UPDATE personen SET ${pa.sql} WHERE id = $${pa.werte.length + 1}`, [...pa.werte, ei.person_id]);
    const ek = ['e_anteil', 'e_von', 'e_bis', 'e_zahlweise'].filter((k) => k in neu);
    if (ek.length) {
      const w = (k: string) => (k === 'e_anteil' ? (neu[k] == null ? 100 : Number(neu[k])) : neu[k]);
      await db.execute(`UPDATE eigentum SET ${ek.map((k, i) => `${k.slice(2)} = $${i + 1}`).join(', ')} WHERE id = $${ek.length + 1}`, [...ek.map(w), ei.id]);
      // Zeitraum, Anteil oder Zahlweise bestimmen die Hausgeld-Posten: offene (unbezahlte) neu stellen
      const n = await hausgeldNeuStellen(objektId, '0000-00');
      await reload();
      return n ? `Gespeichert. Offene Hausgeld-Posten wurden neu gestellt (bezahlte bleiben unverändert).` : 'Gespeichert.';
    }
    await reload();
    return 'Gespeichert.';
  };

  return (
    <>
      <div className="page-head">
        <p className="muted small"><Link to={`/objekte/${objektId}/eigentuemer`}>Eigentümer</Link> ›</p>
        <h1>{ei.name} <span className={'pill ' + ei.status}>{ei.status}</span></h1>
        <p className="muted">{ei.objekt} – {ei.einheit} · Eigentümer seit {ei.von ? datum(ei.von) : '–'}{ei.bis ? ` · bis ${datum(ei.bis)}` : ''} · Anteil {num(ei.anteil ?? 100, 0)} %</p>
      </div>
      <div className="kpis">
        <div className="kpi"><span>Hausgeld aktuell</span><b>{hg ? eur(gesamt) : '–'}</b></div>
        <div className="kpi"><span>davon Rücklage</span><b>{hg ? eur(rl) : '–'}</b></div>
        <div className="kpi"><span>Zahlweise</span><b>{(ei.zahlweise || ei.ruecklage_zahlweise) === 'getrennt' ? 'getrennt' : 'eine Summe'}</b></div>
        <div className="kpi"><span>Offen (fällig)</span><b className={offen > 0.005 ? 'neg' : ''}>{eur(offen)}</b></div>
      </div>
      <StammdatenKarte rolle="eigentuemer" key={ei.id} titel="Eigentümer und Eigentum" icon={<IdCard size={22} />} gruppen={gruppen}
        werte={{ ...personWerte(p), e_anteil: ei.anteil ?? 100, e_von: ei.von, e_bis: ei.bis, e_zahlweise: ei.zahlweise ?? '' }}
        onSpeichern={speichern}
        pdf={{ titel: 'Stammblatt Eigentümer', zeilen: [String(ei.name ?? ''), `${ei.objekt} – ${ei.einheit} · Anteil ${num(ei.anteil ?? 100, 0)} %`],
          datei: `Stammblatt ${ei.name} ${ei.objekt} ${ei.einheit}.pdf`,
          vorab: { titel: 'Hausgeld', felder: [['Hausgeld aktuell', hg ? eur(gesamt) : '–'], ['davon Rücklage', hg ? eur(rl) : '–'], ['Zahlweise', (ei.zahlweise || ei.ruecklage_zahlweise) === 'getrennt' ? 'getrennt' : 'eine Summe'], ['Offen (fällig)', eur(offen)]] } }} />
      <p className="muted small">Hausgeld und Rücklage änderst du unter <Link to={`/objekte/${objektId}/hausgeld`}>Hausgeld</Link>. Die Personendaten gelten für alle Objekte dieses Kontakts.</p>
    </>
  );
}
