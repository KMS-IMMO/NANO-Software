// Agent O.S.A: Vorschlag für den Wirtschaftsplan. Liest die Ist-Kosten der letzten Jahre, rechnet mit
// Preissteigerungen je Kostengruppe hoch, prüft die Erhaltungsrücklage nach Alter und Fläche des Gebäudes
// und schaut voraus, wie sich Hausgeld und Rücklage in den nächsten Jahren entwickeln könnten.
// Alle Annahmen sind sichtbar und änderbar. Mit API-Schlüssel schreibt Claude zusätzlich eine Einschätzung.
import Anthropic from '@anthropic-ai/sdk';
import { db, type Row } from '../db';
import { kostenErmitteln } from './verteilung';
import { ruecklageStand } from './ruecklage';
import { kiEinstellungen } from './kiAgent';

export const RUECKLAGE_KONTO = '1260';

export interface Annahmen {
  steigerung: Record<string, number>;   // % je Kostengruppe und Jahr
  rlBasis: [number, number, number];     // €/m² Wohnfläche p. a. nach Alter: bis 21, 22–31, ab 32 Jahre
  rlIndex: number;                       // Faktor auf die Basiswerte (Preisentwicklung seit 2002)
  jahre: number;                         // Vorschau-Jahre
}

export const STANDARD_ANNAHMEN: Annahmen = {
  steigerung: {
    'Heizkosten + Nebenkosten': 8, 'Wasser/Strom Versorgung': 5, 'Grundbesitzabgaben A': 3, 'Aufzugskosten': 4,
    'Allgemeine Betriebskosten': 4.5, 'Versicherung': 7, 'Instandhaltungen': 5, 'Verwaltungskosten': 2, 'Sonstige': 3,
  },
  rlBasis: [7.1, 9, 11.5],
  rlIndex: 1.4,
  jahre: 3,
};

export interface VorschlagZeile {
  konto_id: number; nummer: string; name: string; gruppe: string; umlagefaehig: boolean;
  ist: Record<number, number>;   // Jahr → Ist-Kosten
  bisher: number;                // aktuell im Plan eingetragen
  vorschlag: number;
  satz: number;                  // angenommene Steigerung in %
  grund: string;
}

export interface Vorschau { jahr: number; kosten: number; ruecklage: number; hausgeldMonat: number; bestand: number }

export interface Vorschlag {
  jahr: number; alter: number | null; flaeche: number; einheiten: number;
  zeilen: VorschlagZeile[];
  rlVorschlag: number; rlBisher: number; rlRichtwert: number; rlBestand: number; rlGrund: string;
  kostenBisher: number; kostenVorschlag: number;
  spitzeVorjahr: number | null;  // Summe der Abrechnungsspitzen des Vorjahres (> 0 Nachzahlung)
  vorschau: Vorschau[];
  hinweise: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const auf10 = (n: number) => Math.ceil(n / 10) * 10;
const eur = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

export function rlRichtwert(a: Annahmen, alter: number | null, flaeche: number): number {
  const satz = alter == null ? a.rlBasis[1] : alter < 22 ? a.rlBasis[0] : alter < 32 ? a.rlBasis[1] : a.rlBasis[2];
  return satz * a.rlIndex * flaeche;
}

/** Vorschlag berechnen. plan = aktuell eingetragene Planwerte je Konto-ID */
export async function vorschlagBerechnen(objektId: number, jahr: number, plan: Record<number, number>, a: Annahmen = STANDARD_ANNAHMEN): Promise<Vorschlag> {
  const o = (await db.select('SELECT * FROM objekte WHERE id = $1', [objektId]))[0] ?? {};
  const eh = await db.select('SELECT flaeche, mea FROM einheiten WHERE objekt_id = $1', [objektId]);
  const flaeche = eh.reduce((s, e) => s + (Number(e.flaeche) || 0), 0);
  const baujahr = Number(o.baujahr) || null;
  const alter = baujahr ? jahr - baujahr : null;
  const konten: Row[] = await db.select(`SELECT id, nummer, name, gruppe, umlagefaehig FROM buchungskonten WHERE art = 'Aufwand'`);

  // Ist der letzten drei Jahre
  const ist: Record<number, Record<number, number>> = {};
  for (const j of [jahr - 3, jahr - 2, jahr - 1]) {
    for (const p of await kostenErmitteln(objektId, j, false)) (ist[p.konto_id] ??= {})[j] = p.betrag;
  }
  const ids = new Set<number>([...Object.keys(ist).map(Number), ...Object.entries(plan).filter(([, v]) => v).map(([k]) => Number(k))]);
  const zeilen: VorschlagZeile[] = [];
  for (const id of ids) {
    const k = konten.find((x) => x.id === id);
    if (!k || k.nummer === RUECKLAGE_KONTO || ['1261', '1262'].includes(k.nummer)) continue;
    const i = ist[id] ?? {};
    const satz = a.steigerung[k.gruppe] ?? a.steigerung.Sonstige ?? 3;
    const werte = [jahr - 3, jahr - 2, jahr - 1].map((j) => i[j]).filter((x) => x != null) as number[];
    const letzt = i[jahr - 1];
    let basis = letzt ?? 0, grund = '';
    if (letzt == null && werte.length) { basis = werte[werte.length - 1]; grund = `Kein Ist ${jahr - 1}, letzter Wert als Basis. `; }
    // Einmalige Ausreißer (Reparaturen) glätten: bei Instandhaltung Mittel der Jahre
    if (k.gruppe === 'Instandhaltungen' && werte.length > 1) { basis = werte.reduce((s, x) => s + x, 0) / werte.length; grund = `Mittel aus ${werte.length} Jahren, weil Reparaturen schwanken. `; }
    // Mehrjähriger Trend stärker als die Annahme: Trend nehmen (gedeckelt bei 15 %)
    let s = satz;
    if (werte.length >= 2 && k.gruppe !== 'Instandhaltungen') {
      const trend = (Math.pow(werte[werte.length - 1] / werte[0], 1 / (werte.length - 1)) - 1) * 100;
      if (Number.isFinite(trend) && trend > satz) { s = Math.min(15, trend); grund += `Kosten stiegen zuletzt um ${trend.toFixed(1).replace('.', ',')} % im Jahr. `; }
    }
    if (!basis && plan[id]) { basis = plan[id]; grund += 'Nur Planwert vorhanden. '; s = 0; }
    const vorschlag = auf10(basis * (1 + s / 100));
    if (!grund || !grund.includes('%')) grund += `${k.gruppe || 'Sonstige'}: +${String(s).replace('.', ',')} % angenommen.`;
    zeilen.push({ konto_id: id, nummer: k.nummer, name: k.name, gruppe: k.gruppe ?? '', umlagefaehig: !!k.umlagefaehig, ist: i, bisher: plan[id] ?? 0, vorschlag, satz: s, grund: grund.trim() });
  }
  zeilen.sort((x, y) => x.nummer.localeCompare(y.nummer));

  // Erhaltungsrücklage
  const rlKonto = konten.find((k) => k.nummer === RUECKLAGE_KONTO);
  // Ergebnis der letzten Abrechnung: Kosten gegen Vorschüsse (ohne Rücklage)
  const istVorjahr = Object.values(ist).reduce((s, x) => s + (x[jahr - 1] ?? 0), 0);
  const hg = await db.select(`SELECT COALESCE(SUM(s.betrag), 0) AS soll FROM sollstellungen s JOIN einheiten e ON e.id = s.einheit_id
    WHERE e.objekt_id = $1 AND s.art IN ('Hausgeld') AND substr(s.monat, 1, 4) = $2`, [objektId, String(jahr - 1)]);
  const hgRl = (await db.select(`SELECT COALESCE(SUM(h.davon_ruecklage), 0) * 12 AS rl FROM hausgeld h JOIN einheiten e ON e.id = h.einheit_id
    WHERE e.objekt_id = $1 AND h.gueltig_ab = (SELECT MAX(y.gueltig_ab) FROM hausgeld y WHERE y.einheit_id = h.einheit_id AND y.gueltig_ab <= $2)`, [objektId, `${jahr - 1}-12-31`]))[0]?.rl ?? 0;
  const vorschuss = Number(hg[0]?.soll ?? 0) - Number(hgRl);
  // Ohne Planwert gilt die Rücklage aus dem aktuellen Hausgeld als bisheriger Betrag
  const rlBisher = (rlKonto ? plan[rlKonto.id] : 0) || r2(Number(hgRl));
  const spitzeVorjahr = Number(hg[0]?.soll ?? 0) > 0 ? r2(istVorjahr - vorschuss) : null;

  const rlRichtwertWert = rlRichtwert(a, alter, flaeche);
  const rlBestand = await ruecklageStand(objektId, `${jahr - 1}-12-31`).catch(() => 0);
  const rlVorschlag = auf10(Math.max(rlBisher, rlRichtwertWert));
  const rlGrund = flaeche
    ? `Richtwert ${(rlRichtwertWert / (flaeche || 1)).toFixed(2).replace('.', ',')} €/m² für ${alter ?? '?'} Jahre altes Gebäude × ${flaeche.toLocaleString('de-DE')} m² = ${eur(rlRichtwertWert)}.${rlBisher > rlRichtwertWert ? ' Der bisherige Betrag liegt darüber und bleibt.' : ''}`
    : 'Keine Wohnfläche hinterlegt, bisheriger Betrag bleibt.';

  const kostenBisher = zeilen.reduce((s, z) => s + z.bisher, 0);
  const kostenVorschlag = zeilen.reduce((s, z) => s + z.vorschlag, 0);

  // Vorschau der nächsten Jahre
  const vorschau: Vorschau[] = [];
  let bestand = rlBestand;
  for (let n = 0; n < a.jahre; n++) {
    const j = jahr + n;
    const kosten = zeilen.reduce((s, z) => s + z.vorschlag * Math.pow(1 + z.satz / 100, n), 0);
    const rl = Math.max(n === 0 ? rlVorschlag : 0, rlRichtwert(a, alter == null ? null : alter + n, flaeche), rlVorschlag);
    bestand += rl;
    vorschau.push({ jahr: j, kosten: r2(kosten), ruecklage: r2(rl), hausgeldMonat: r2((kosten + rl) / 12), bestand: r2(bestand) });
  }

  // Hinweise in Worten
  const hinweise: string[] = [];
  const diff = kostenVorschlag + rlVorschlag - (kostenBisher + rlBisher);
  if (kostenBisher + rlBisher > 0) hinweise.push(`Der Vorschlag liegt ${diff >= 0 ? 'um ' + eur(diff) + ' über' : 'um ' + eur(-diff) + ' unter'} deinem bisherigen Plan (${eur(kostenBisher + rlBisher)}).`);
  const grosse = [...zeilen].sort((x, y) => (y.vorschlag - (y.ist[jahr - 1] ?? 0)) - (x.vorschlag - (x.ist[jahr - 1] ?? 0)))[0];
  if (grosse && grosse.ist[jahr - 1]) hinweise.push(`Größter Treiber: ${grosse.name} mit ${eur(grosse.vorschlag - (grosse.ist[jahr - 1] ?? 0))} mehr als ${jahr - 1}.`);
  if (spitzeVorjahr != null) hinweise.push(spitzeVorjahr > 0
    ? `Die Abrechnung ${jahr - 1} ergibt voraussichtlich Nachzahlungen von zusammen ${eur(spitzeVorjahr)}: das Hausgeld war zu knapp.`
    : `Die Abrechnung ${jahr - 1} ergibt voraussichtlich Erstattungen von zusammen ${eur(-spitzeVorjahr)}: das Hausgeld war ausreichend.`);
  if (alter != null) {
    const naechste = alter < 22 ? 22 : alter < 32 ? 32 : null;
    hinweise.push(`Das Gebäude ist ${alter} Jahre alt.${naechste ? ` Ab ${naechste} Jahren (${(baujahr ?? 0) + naechste}) steigt der Richtwert für die Rücklage.` : ' Es liegt in der höchsten Altersstufe für die Rücklage.'}`);
  }
  const jahresKosten = kostenVorschlag || 1;
  hinweise.push(`Rücklage am 31.12.${jahr - 1}: ${eur(rlBestand)}${flaeche ? ` (${(rlBestand / flaeche).toFixed(2).replace('.', ',')} €/m²)` : ''}. ` +
    (rlBestand < jahresKosten ? 'Das reicht für eine größere Maßnahme (Dach, Heizung, Fassade) noch nicht. Eine höhere Zuführung oder eine Sonderumlage sollte früh besprochen werden.' : 'Für kleinere Maßnahmen ist ein Polster da.'));
  const v = vorschau[vorschau.length - 1];
  if (v) hinweise.push(`Bleiben die Annahmen so, liegt das Hausgeld ${v.jahr} bei etwa ${eur(v.hausgeldMonat)} im Monat für alle Einheiten zusammen, die Rücklage bei etwa ${eur(v.bestand)}.`);

  return { jahr, alter, flaeche, einheiten: eh.length, zeilen, rlVorschlag, rlBisher, rlRichtwert: r2(rlRichtwertWert), rlBestand, rlGrund,
    kostenBisher, kostenVorschlag, spitzeVorjahr, vorschau, hinweise };
}

/** Einschätzung in Worten von Claude (nur mit API-Schlüssel). Die Zahlen kommen aus dem Vorschlag, nichts wird erfunden. */
export async function kiEinschaetzung(v: Vorschlag, objektName: string): Promise<string> {
  const { schluessel, modell } = await kiEinstellungen();
  if (!schluessel) throw new Error('KEIN_SCHLUESSEL');
  const client = new Anthropic({ apiKey: schluessel, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const daten = {
    objekt: objektName, planjahr: v.jahr, gebaeudealter: v.alter, wohnflaeche_m2: v.flaeche, einheiten: v.einheiten,
    kosten: v.zeilen.map((z) => ({ konto: `${z.nummer} ${z.name}`, umlagefaehig: z.umlagefaehig, ist: z.ist, plan_bisher: z.bisher, vorschlag: z.vorschlag, annahme_prozent: z.satz })),
    ruecklage: { bestand_vorjahr: v.rlBestand, zufuehrung_bisher: v.rlBisher, richtwert: v.rlRichtwert, vorschlag: v.rlVorschlag },
    abrechnungsspitze_vorjahr: v.spitzeVorjahr, vorschau: v.vorschau,
  };
  const r = await client.messages.create({
    model: modell, max_tokens: 2000,
    system: 'Du bist Agent O.S.A in NANO, der Software von KMS Immobilien (WEG-Verwaltung, Köln). Du bewertest einen Wirtschaftsplan-Vorschlag für den Verwalter. Antworte auf Deutsch in 4 bis 7 kurzen Stichpunkten (je ein Satz, beginnend mit „- “): Einschätzung, Risiken, was der Verwalter vor der Eigentümerversammlung prüfen oder ansprechen sollte. Nutze nur die gelieferten Zahlen, erfinde keine. Beträge im deutschen Format (1.234,56 €).',
    messages: [{ role: 'user', content: JSON.stringify(daten) }],
  });
  return r.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
}
