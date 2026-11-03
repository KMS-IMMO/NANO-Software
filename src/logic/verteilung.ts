// Verteilungsrechnung für Nebenkosten- und WEG-Jahresabrechnung.
// Kosten je Buchungskonto werden nach Umlageschlüssel auf Einheiten und innerhalb
// der Einheit zeitanteilig auf die Nutzer (Mieter, Eigentümer, Leerstand) verteilt.
import { db, type Row } from '../db';

export type Schluessel = 'Fläche' | 'Personen' | 'Einheiten' | 'MEA' | 'Summe' | 'Verbrauch' | 'Direkt' | 'Messdienst';

export const tageImJahr = (jahr: number) => ((jahr % 4 === 0 && jahr % 100 !== 0) || jahr % 400 === 0 ? 366 : 365);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const tag = (s: string) => new Date(s + 'T00:00:00Z').getTime() / 86400000;

/** Überschneidung eines Zeitraums mit dem Jahr in Tagen (inklusive) */
export function tageIn(von: string | null, bis: string | null, jahr: number): { von: string; bis: string; tage: number } | null {
  const a = Math.max(tag(von ?? `${jahr}-01-01`), tag(`${jahr}-01-01`));
  const b = Math.min(tag(bis ?? `${jahr}-12-31`), tag(`${jahr}-12-31`));
  if (b < a) return null;
  return { von: iso(new Date(a * 86400000)), bis: iso(new Date(b * 86400000)), tage: b - a + 1 };
}

export interface Nutzer {
  key: string;            // eindeutig, z. B. "v12" (Vertrag) oder "e3-p7" (Eigentum) oder "leer-5"
  art: 'Mieter' | 'Eigentümer' | 'Leerstand';
  einheit_id: number;
  person_id: number | null;
  vertrag_id?: number | null;
  name: string;
  von: string; bis: string; tage: number;
  personen: number;       // Personenzahl (für Schlüssel Personen)
  anteil: number;         // Eigentumsanteil in % (WEG mit mehreren Eigentümern)
}

export interface Position {
  konto_id: number; nummer: string; name: string; gruppe: string;
  umlagefaehig: boolean; hdl: boolean; hwl: boolean;
  betrag: number;         // Kosten gesamt im Jahr (positiv = Kosten)
  schluessel: Schluessel;
  direkt?: Record<number, number>; // Kosten, die direkt einer Einheit zugeordnet sind
}

export interface Ergebnis {
  nutzer: Nutzer;
  einheit: Row;
  zeilen: { pos: Position; gesamtBasis: number; nutzerBasis: number; betrag: number }[];
  summe: number;
  hdl: number; hwl: number;
}

/**
 * Verteilt die Positionen auf die Nutzer.
 * - Fläche, MEA, Einheiten: Anteil der Einheit am Objekt × Tage des Nutzers / Tage im Jahr
 * - Personen: Personenzahl × Tage (Personentage), Leerstand zählt mit 0 Personen und zahlt dafür nichts
 * - Verbrauch / Messdienst: Wert je Einheit, zeitanteilig auf die Nutzer der Einheit
 * - Summe: fest eingetragener Betrag je Einheit (z. B. 1.000 € = W1 800 €, W2 100 €, W3 100 €), zeitanteilig auf deren Nutzer
 * - Direkt: in der Rechnung direkt einer Einheit zugeordnete Beträge, zeitanteilig auf deren Nutzer
 */
export function verteilen(jahr: number, einheiten: Row[], nutzer: Nutzer[], positionen: Position[],
  werte: { verbrauch: Record<string, number>; messdienst: Record<number, number> }): Ergebnis[] {
  const T = tageImJahr(jahr);
  const res = new Map<string, Ergebnis>();
  for (const n of nutzer) res.set(n.key, { nutzer: n, einheit: einheiten.find((e) => e.id === n.einheit_id)!, zeilen: [], summe: 0, hdl: 0, hwl: 0 });

  const basisEinheit = (e: Row, s: Schluessel, p: Position): number => {
    switch (s) {
      case 'Fläche': return Number(e.flaeche) || 0;
      case 'MEA': return Number(e.mea) || 0;
      case 'Einheiten': return 1;
      case 'Verbrauch': return werte.verbrauch[`${e.id}-${p.konto_id}`] ?? 0;
      case 'Messdienst': return werte.messdienst[e.id] ?? 0;
      case 'Summe': return werte.verbrauch[`${e.id}-${p.konto_id}`] ?? 0;
      case 'Direkt': return p.direkt?.[e.id] ?? 0;
      default: return 0;
    }
  };

  for (const p of positionen) {
    if (Math.abs(p.betrag) < 0.005) continue;
    if (p.schluessel === 'Personen') {
      const gesamt = nutzer.reduce((a, n) => a + n.personen * n.tage, 0);
      for (const n of nutzer) {
        const nb = n.personen * n.tage;
        add(res.get(n.key)!, p, gesamt, nb, gesamt ? (p.betrag * nb) / gesamt : 0);
      }
      continue;
    }
    const gesamt = einheiten.reduce((a, e) => a + basisEinheit(e, p.schluessel, p), 0);
    // Bei Summe ist die Basis der eingetragene Betrag je Einheit und wird genau so übernommen;
    // bei Direkt werden die direkt zugeordneten Rechnungsbeträge auf die Kontosumme bezogen
    const faktor = p.schluessel === 'Direkt' && gesamt ? p.betrag / gesamt : 1;
    for (const n of nutzer) {
      const e = einheiten.find((x) => x.id === n.einheit_id)!;
      const eb = basisEinheit(e, p.schluessel, p);
      const nb = eb * (n.tage / T) * (n.anteil / 100);
      const betrag = (p.schluessel === 'Direkt' || p.schluessel === 'Summe') ? eb * faktor * (n.tage / T) * (n.anteil / 100) : gesamt ? (p.betrag * nb) / gesamt : 0;
      add(res.get(n.key)!, p, gesamt, nb, betrag);
    }
  }
  return [...res.values()];

  function add(r: Ergebnis, p: Position, gb: number, nb: number, betrag: number) {
    const b = Math.round(betrag * 100) / 100;
    r.zeilen.push({ pos: p, gesamtBasis: gb, nutzerBasis: nb, betrag: b });
    r.summe = Math.round((r.summe + b) * 100) / 100;
    if (p.hdl) r.hdl += b;
    if (p.hwl) r.hwl += b;
  }
}

/** Nutzer der Einheiten eines Objekts im Jahr: Mietverträge, Leerstand (Mietverwaltung) bzw. Eigentümer (WEG) */
export async function nutzerErmitteln(objektId: number, jahr: number, modus: 'Mieter' | 'Eigentümer'): Promise<{ einheiten: Row[]; nutzer: Nutzer[] }> {
  const einheiten = await db.select('SELECT * FROM einheiten WHERE objekt_id = $1 ORDER BY nummer', [objektId]);
  const nutzer: Nutzer[] = [];
  const name = (p: Row) => [p.firma, [p.nachname, p.vorname].filter(Boolean).join(', ')].filter(Boolean).join(', ');
  const T = tageImJahr(jahr);
  for (const e of einheiten) {
    if (modus === 'Mieter') {
      const vs = await db.select(`SELECT v.*, p.vorname, p.nachname, p.firma FROM mietvertraege v JOIN personen p ON p.id = v.mieter_id
        WHERE v.einheit_id = $1 ORDER BY v.beginn`, [e.id]);
      let belegt = 0;
      for (const v of vs) {
        const z = tageIn(v.beginn, v.ende, jahr);
        if (!z) continue;
        belegt += z.tage;
        nutzer.push({ key: `v${v.id}`, art: 'Mieter', einheit_id: e.id, person_id: v.mieter_id, vertrag_id: v.id, name: name(v),
          ...z, personen: Number(v.personenzahl) || 0, anteil: 100 });
      }
      if (belegt < T) {
        // Leerstand trägt der Eigentümer
        nutzer.push({ key: `leer${e.id}`, art: 'Leerstand', einheit_id: e.id, person_id: null, name: 'Leerstand (Eigentümer)',
          von: `${jahr}-01-01`, bis: `${jahr}-12-31`, tage: T - belegt, personen: 0, anteil: 100 });
      }
    } else {
      const es = await db.select(`SELECT ei.*, p.vorname, p.nachname, p.firma FROM eigentum ei JOIN personen p ON p.id = ei.person_id
        WHERE ei.einheit_id = $1 ORDER BY ei.von`, [e.id]);
      for (const x of es) {
        const z = tageIn(x.von, x.bis, jahr);
        if (!z) continue;
        nutzer.push({ key: `e${x.id}`, art: 'Eigentümer', einheit_id: e.id, person_id: x.person_id, name: name(x), ...z, personen: e.personenzahl != null ? Number(e.personenzahl) : 1,
          anteil: Number(x.anteil) || 100 });
      }
    }
  }
  return { einheiten, nutzer };
}

/**
 * Kosten je Buchungskonto im Jahr (Abflussprinzip):
 * gebuchte Bankausgänge plus erfasste Rechnungen, die (noch) keiner Bankbuchung zugeordnet sind.
 * Direkt einer Einheit zugeordnete Kosten werden zusätzlich je Einheit gemerkt.
 */
export async function kostenErmitteln(objektId: number, jahr: number, nurUmlagefaehig: boolean): Promise<Position[]> {
  const von = `${jahr}-01-01`, bis = `${jahr}-12-31`;
  const konten = await db.select(`SELECT k.*, s.schluessel AS objekt_schluessel FROM buchungskonten k
    LEFT JOIN objekt_schluessel s ON s.buchungskonto_id = k.id AND s.objekt_id = $1
    WHERE k.art IN ('Aufwand', 'Ertrag') ${nurUmlagefaehig ? 'AND k.umlagefaehig = 1' : ''} ORDER BY k.nummer`, [objektId]);
  const buch = await db.select(`SELECT buchungskonto_id, einheit_id, -SUM(betrag) AS kosten FROM buchungen
    WHERE objekt_id = $1 AND datum BETWEEN $2 AND $3 AND buchungskonto_id IS NOT NULL GROUP BY buchungskonto_id, einheit_id`, [objektId, von, bis]);
  const rech = await db.select(`SELECT buchungskonto_id, einheit_id, SUM(betrag) AS kosten FROM rechnungen r
    WHERE objekt_id = $1 AND COALESCE(bezahlt_am, datum) BETWEEN $2 AND $3
      AND NOT EXISTS (SELECT 1 FROM buchungen b WHERE b.rechnung_id = r.id) GROUP BY buchungskonto_id, einheit_id`, [objektId, von, bis]);
  const out: Position[] = [];
  for (const k of konten) {
    const zeilen = [...buch, ...rech].filter((x) => x.buchungskonto_id === k.id);
    const betrag = Math.round(zeilen.reduce((a, x) => a + Number(x.kosten), 0) * 100) / 100;
    if (Math.abs(betrag) < 0.005) continue;
    const direkt: Record<number, number> = {};
    for (const z of zeilen) if (z.einheit_id) direkt[z.einheit_id] = (direkt[z.einheit_id] ?? 0) + Number(z.kosten);
    out.push({ konto_id: k.id, nummer: k.nummer, name: k.name, gruppe: k.gruppe ?? '', umlagefaehig: !!k.umlagefaehig, hdl: !!k.hdl, hwl: !!k.hwl,
      betrag, schluessel: (k.objekt_schluessel ?? k.schluessel ?? 'Fläche') as Schluessel, direkt });
  }
  return out;
}

/** Bezahlte Vorauszahlungen (Ist) je Nutzer und Art im Jahr */
export async function vorauszahlungen(jahr: number, arten: string[]): Promise<Row[]> {
  return db.select(`SELECT s.vertrag_id, s.einheit_id, s.person_id, s.art, SUM(b.betrag) AS gezahlt, SUM(DISTINCT s.id) AS x
    FROM sollstellungen s JOIN buchungen b ON b.sollstellung_id = s.id
    WHERE substr(s.monat, 1, 4) = $1 AND s.art IN (${arten.map((a) => `'${a}'`).join(',')})
    GROUP BY s.vertrag_id, s.einheit_id, s.person_id, s.art`, [String(jahr)]);
}
