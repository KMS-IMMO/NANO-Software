// Fenster: einen Zahlungseingang der Gemeinschaft zuführen oder auf mehrere Eigentümer/Mieter aufteilen.
import { useEffect, useState } from 'react';
import { Building2, Users, X } from 'lucide-react';
import { db, type Row } from '../db';
import { objektPersonenSql } from '../db/labels';
import { BetragFeld } from './BetragFeld';
import { betragZahl } from '../lib/betrag';
import { datum, eur } from './EntityTable';
import { aufGemeinschaft, aufMehrere, ertragsKonten, gleichmaessig } from '../logic/mehrfachZuordnen';

type Person = { value: number; label: string; gruppe: string; aktiv: number };
const zahl = (s: string | undefined) => betragZahl(s ?? '') ?? 0;
const text = (n: number) => n.toFixed(2).replace('.', ',');

export function MehrfachZuordnen({ u, objekt, start = 'mehrere', onClose, onDone }:
  { u: Row; objekt?: number | null; start?: 'gemeinschaft' | 'mehrere'; onClose: () => void; onDone: (text: string) => void }) {
  const [art, setArt] = useState<'gemeinschaft' | 'mehrere'>(start);
  const [personen, setPersonen] = useState<Person[]>([]);
  const [konten, setKonten] = useState<{ id: number | null; nummer: string; name: string }[]>([]);
  const [konto, setKonto] = useState('');
  const [teile, setTeile] = useState<Record<number, string>>({});
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);
  const betrag = Math.round(Number(u.betrag) * 100) / 100;

  useEffect(() => {
    (async () => {
      const o = objekt ?? (u.bankkonto_id ? (await db.select('SELECT objekt_id FROM bankkonten WHERE id = $1', [u.bankkonto_id]))[0]?.objekt_id : null);
      if (o) setPersonen(await db.select(objektPersonenSql(Number(o))) as Person[]);
    })();
    ertragsKonten().then((k) => { setKonten(k); setKonto((v) => v || (k[0] ? String(k[0].id ?? 'neu') : '')); });
  }, [objekt, u.bankkonto_id]);

  const gewaehlt = Object.keys(teile).map(Number);
  const verteilt = Math.round(gewaehlt.reduce((a, id) => a + zahl(teile[id]), 0) * 100) / 100;
  const rest = Math.round((betrag - verteilt) * 100) / 100;
  const umschalten = (id: number) => {
    const n = { ...teile };
    if (id in n) delete n[id]; else n[id] = '';
    // Neu gewählt: gleichmäßig auf alle gewählten verteilen
    const ids = Object.keys(n).map(Number);
    gleichmaessig(betrag, ids.length).forEach((b, i) => { n[ids[i]] = text(b); });
    setTeile(n);
  };
  const gleich = () => { const ids = gewaehlt; const n: Record<number, string> = {}; gleichmaessig(betrag, ids.length).forEach((b, i) => { n[ids[i]] = text(b); }); setTeile(n); };

  async function ausfuehren() {
    setFehler(''); setBusy(true);
    try {
      if (art === 'gemeinschaft') {
        const k = konten.find((x) => String(x.id ?? 'neu') === konto);
        await aufGemeinschaft(Number(u.id), k?.id ?? null);
        onDone(`Zahlung vom ${datum(u.datum)} über ${eur(betrag)} der Gemeinschaft zugeführt (Konto ${k?.nummer ?? ''} ${(k?.name ?? '').replace(' – wird angelegt', '')}). Sie wird in der Hausgeldabrechnung nach dem Umlageschlüssel des Kontos auf alle Einheiten verteilt.`);
      } else {
        await aufMehrere(Number(u.id), gewaehlt.map((id) => ({ personId: id, betrag: zahl(teile[id]) })));
        onDone(`Zahlung vom ${datum(u.datum)} über ${eur(betrag)} aufgeteilt: ${gewaehlt.map((id) => `${personen.find((p) => p.value === id)?.label ?? ''} ${eur(zahl(teile[id]))}`).join(', ')}.`);
      }
    } catch (e) { setFehler(String((e as Error)?.message ?? e)); }
    setBusy(false);
  }

  const gruppen = [...new Set(personen.map((p) => p.gruppe))];
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal mehrfach-fenster" onClick={(e) => e.stopPropagation()}>
        <div className="card-head"><h3>Zahlung zuordnen</h3><button className="icon-btn" title="Schließen" onClick={onClose}><X size={18} /></button></div>
        <div className="mz-zahlung">
          <span>{datum(u.datum)}</span><b>{u.gegenpartei || 'Zahlung'}</b><span className="mz-betrag">{eur(betrag)}</span>
          {u.verwendungszweck && <small className="muted">{String(u.verwendungszweck).slice(0, 140)}</small>}
        </div>
        <div className="seg mz-art">
          <button className={art === 'gemeinschaft' ? 'on' : ''} onClick={() => setArt('gemeinschaft')}><Building2 size={15} /> Gemeinschaft (alle Einheiten)</button>
          <button className={art === 'mehrere' ? 'on' : ''} onClick={() => setArt('mehrere')}><Users size={15} /> Mehrere Eigentümer / Mieter</button>
        </div>
        {art === 'gemeinschaft' ? <>
          <p className="muted small">Für Einnahmen, die allen gehören, z. B. Miete für eine Funkanlage, Werbefläche oder Stellplatz der Gemeinschaft.
            Die Zahlung wird ohne Einheit auf das gewählte Ertragskonto gebucht und in der Hausgeldabrechnung nach dem Umlageschlüssel des Kontos
            (Standard MEA) auf alle Einheiten verteilt. Offene Hausgeld-Posten bleiben unberührt.</p>
          <label className="feld-block"><span>Ertragskonto</span>
            <select value={konto} onChange={(e) => setKonto(e.target.value)}>
              {konten.map((k) => <option key={k.id ?? 'neu'} value={String(k.id ?? 'neu')}>{k.nummer} {k.name}</option>)}
            </select></label>
        </> : <>
          <p className="muted small">Häkchen setzen und den Betrag je Person eintragen. Jeder Teil wird wie eine eigene Überweisung auf die offenen Posten dieser Person verteilt (älteste zuerst).</p>
          {!personen.length ? <p className="muted">Keine Eigentümer oder Mieter in dieser Liegenschaft gefunden.</p> : (
            <div className="mz-liste">{gruppen.map((g) => <div key={g}>
              <div className="mz-gruppe">{g}</div>
              {personen.filter((p) => p.gruppe === g).map((p) => (
                <div key={g + p.value} className={'mz-zeile' + (p.value in teile ? ' an' : '')}>
                  <label className="check"><input type="checkbox" checked={p.value in teile} onChange={() => umschalten(p.value)} />{p.label}{!p.aktiv && <span className="muted small"> (früher)</span>}</label>
                  {p.value in teile && <BetragFeld zelle className="cell" value={teile[p.value]} onChange={(e) => setTeile({ ...teile, [p.value]: e.target.value })} />}
                </div>))}
            </div>)}</div>)}
          <div className="row mz-summe">
            <span>Verteilt <b>{eur(verteilt)}</b> von {eur(betrag)}</span>
            {Math.abs(rest) > 0.005 && <span className="neg small">{rest > 0 ? `noch ${eur(rest)} offen` : `${eur(-rest)} zu viel`}</span>}
            <span className="grow" />
            {gewaehlt.length > 1 && <button className="link" onClick={gleich}>Gleichmäßig verteilen</button>}
          </div>
        </>}
        {fehler && <p className="error">{fehler}</p>}
        <div className="row end">
          <button onClick={onClose}>Abbrechen</button>
          <button className="primary" disabled={busy || (art === 'mehrere' ? !gewaehlt.length || Math.abs(rest) > 0.005 : !konto)} onClick={ausfuehren}>
            {art === 'gemeinschaft' ? 'Der Gemeinschaft zuführen' : `Auf ${gewaehlt.length || ''} ${gewaehlt.length === 1 ? 'Person' : 'Personen'} aufteilen`}</button>
        </div>
      </div>
    </div>
  );
}
