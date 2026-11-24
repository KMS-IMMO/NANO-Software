// Prüfung einer Jahresabrechnung gegen die hinterlegten Daten. Rechnet mit festen Regeln (keine KI),
// damit das Ergebnis verlässlich ist. Der KI-Agent erklärt es danach in normaler Sprache.
import { db, type Row } from '../db';
import { abschlussLaden, pruefen, type AbschlussArt } from './abschluss';
import { kostenErmitteln } from './verteilung';
import { ruecklageJahr } from './ruecklage';
import { abgleichText, kontoabgleich } from './kontoabgleich';
import { OP_SQL } from './soll';

const r2 = (n: number) => Math.round(n * 100) / 100;
const eurT = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const dT = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10).split('-').reverse().join('.') : d ?? '');
const RUECKLAGE = ['1260', '1261', '1262'], VORJAHR = ['1601', '1602'];

export type Befund = { stufe: 'rot' | 'gelb' | 'gruen'; text: string };

export async function abrechnungPruefen(objekt: number, jahr: number): Promise<{ titel: string; befunde: Befund[]; kontoabgleich: string }> {
  const o = (await db.select('SELECT * FROM objekte WHERE id = $1', [objekt]))[0];
  if (!o) throw new Error(`Liegenschaft ${objekt} gibt es nicht.`);
  const weg = o.verwaltungsart === 'WEG';
  const art: AbschlussArt = weg ? 'WEG' : 'Nebenkosten';
  const befunde: Befund[] = [];
  const b = (stufe: Befund['stufe'], text: string) => befunde.push({ stufe, text });
  const von = `${jahr}-01-01`, bis = `${jahr}-12-31`;

  // 1. Abschluss und Prüfliste (wie auf der Abrechnungsseite)
  const ab = await abschlussLaden(objekt, jahr, art);
  b(ab ? 'gruen' : 'gelb', ab ? `Die Abrechnung ${jahr} ist am ${dT(ab.abgeschlossen_am)} abgeschlossen worden.` : `Die Abrechnung ${jahr} ist noch nicht abgeschlossen.`);
  for (const p of await pruefen(objekt, jahr, art)) {
    if (p.text.startsWith('Das Jahr') && p.ok) continue;
    b(p.ok ? 'gruen' : p.sperrt ? 'rot' : 'gelb', p.text + (p.ok || !p.hinweis ? '' : `: ${p.hinweis}`));
  }

  // 2. Kosten heute gegen den Stand beim Abschluss
  const pos = (await kostenErmitteln(objekt, jahr, false, { nurBezahlt: weg })).filter((x) => !weg || (!RUECKLAGE.includes(x.nummer) && !VORJAHR.includes(x.nummer)));
  const kosten = r2(pos.reduce((a, x) => a + x.betrag, 0));
  if (ab?.ergebnis) {
    let e: Row = {}; try { e = JSON.parse(ab.ergebnis); } catch { /* altes Format */ }
    if (typeof e.ausgaben === 'number') {
      const d = r2(kosten - e.ausgaben);
      b(Math.abs(d) < 0.005 ? 'gruen' : 'rot', Math.abs(d) < 0.005 ? `Die Ausgaben stimmen noch mit dem Stand beim Abschluss überein (${eurT(kosten)}).`
        : `Die Ausgaben haben sich seit dem Abschluss geändert: damals ${eurT(e.ausgaben)}, heute ${eurT(kosten)} (Differenz ${eurT(d)}).`);
    }
    const nachher = await db.select(`SELECT tabelle, aktion, zeit, json_extract(inhalt, '$.datum') AS datum, json_extract(inhalt, '$.betrag') AS betrag, json_extract(inhalt, '$.text') AS text
      FROM protokoll WHERE tabelle IN ('buchungen', 'rechnungen') AND zeit > $1 AND json_extract(inhalt, '$.objekt_id') = $2
        AND COALESCE(json_extract(inhalt, '$.jahr'), CAST(substr(json_extract(inhalt, '$.datum'), 1, 4) AS INTEGER)) = $3 ORDER BY zeit LIMIT 20`, [ab.abgeschlossen_am + ' 23:59:59', objekt, jahr]);
    if (nachher.length) b('rot', `Nach dem Abschluss wurden ${nachher.length} Buchungen oder Rechnungen dieses Jahres geändert: ` + nachher.slice(0, 5).map((x) => `${dT(String(x.zeit))} ${x.aktion} ${dT(x.datum)} ${x.betrag != null ? eurT(Number(x.betrag)) : ''} ${x.text ?? ''}`.trim()).join('; '));
  }
  b('gruen', `Ausgaben ${jahr} laut Buchhaltung: ${eurT(kosten)} auf ${pos.filter((x) => Math.abs(x.betrag) > 0.005).length} Konten${weg ? ' (nur bezahlte Ausgaben, ohne Rücklage)' : ''}.`);

  // 3. Wirtschaftsplan gegen Ist (nur WEG): große Abweichungen
  if (weg) {
    const plan = await db.select(`SELECT w.betrag, k.id, k.nummer, k.name FROM wirtschaftsplan w JOIN buchungskonten k ON k.id = w.buchungskonto_id WHERE w.objekt_id = $1 AND w.jahr = $2`, [objekt, jahr]);
    if (!plan.length) b('gelb', `Für ${jahr} ist kein Wirtschaftsplan hinterlegt, ein Vergleich Plan gegen Ist ist nicht möglich.`);
    else {
      const abw = plan.map((p): Row => ({ ...p, ist: pos.find((x) => x.konto_id === p.id)?.betrag ?? 0 }))
        .filter((p) => Math.abs(p.ist - p.betrag) > 100 && Math.abs(p.ist - p.betrag) > Math.abs(p.betrag) * 0.2);
      b(abw.length ? 'gelb' : 'gruen', abw.length ? `Deutliche Abweichungen vom Wirtschaftsplan: ` + abw.map((p) => `${p.nummer} ${p.name}: Plan ${eurT(p.betrag)}, Ist ${eurT(p.ist)}`).join('; ')
        : 'Die Ausgaben liegen nah am Wirtschaftsplan (keine Abweichung über 20 % und 100 €).');
      const ohnePlan = pos.filter((x) => x.betrag > 100 && !plan.some((p) => p.id === x.konto_id));
      if (ohnePlan.length) b('gelb', `Ausgaben ohne Ansatz im Wirtschaftsplan: ` + ohnePlan.map((x) => `${x.nummer} ${x.name} ${eurT(x.betrag)}`).join('; '));
    }
  }

  // 4. Heizkosten laut Messdienst gegen gebuchte Heizkosten
  const h = (await db.select(`SELECT COUNT(*) AS n, COALESCE(SUM(h.heizkosten + h.warmwasser), 0) AS s FROM heizkosten_ergebnisse h JOIN einheiten e ON e.id = h.einheit_id WHERE e.objekt_id = $1 AND h.jahr = $2`, [objekt, jahr]))[0];
  const heiz = pos.find((x) => x.nummer === '1200')?.betrag ?? 0;
  if (Number(h?.n) > 0) {
    const d = r2(Number(h.s) - heiz);
    b(Math.abs(d) < 1 ? 'gruen' : 'gelb', Math.abs(d) < 1 ? `Heizkosten laut Messdienst (${eurT(Number(h.s))}) passen zu den gebuchten Heizkosten.`
      : `Heizkosten laut Messdienst ${eurT(Number(h.s))}, gebucht auf 1200 aber ${eurT(heiz)} (Differenz ${eurT(d)}). Bitte die Messdienst-Abrechnung mit den Abschlägen vergleichen.`);
  } else if (heiz > 0) b('gelb', `Es sind Heizkosten von ${eurT(heiz)} gebucht, aber keine Ergebnisse vom Messdienst eingetragen.`);

  // 5. Vorauszahlungen: Soll gegen Zahlungen im Jahr
  const arten = weg ? `('Hausgeld', 'Rücklage')` : `('Kaltmiete', 'NK', 'HK', 'USt')`;
  const op = await db.select(`SELECT schuldner, einheit, SUM(betrag) AS soll, SUM(bezahlt) AS ist FROM (${OP_SQL}) WHERE objekt_id = $1 AND art IN ${arten} AND substr(monat, 1, 4) = $2
    GROUP BY person_id, einheit_id HAVING ABS(SUM(betrag) - SUM(bezahlt)) > 0.005 ORDER BY einheit_lfd, einheit`, [objekt, String(jahr)]);
  const soll = await db.select(`SELECT COUNT(*) AS n FROM (${OP_SQL}) WHERE objekt_id = $1 AND art IN ${arten} AND substr(monat, 1, 4) = $2`, [objekt, String(jahr)]);
  if (!Number(soll[0]?.n)) b('gelb', `Für ${jahr} gibt es keine ${weg ? 'Hausgeld' : 'Miet'}-Sollstellungen.`);
  else b(op.length ? 'gelb' : 'gruen', op.length ? `${weg ? 'Hausgeld' : 'Miete'} nicht vollständig gezahlt bzw. überzahlt: ` + op.map((x) => `${x.einheit} ${x.schuldner}: Soll ${eurT(Number(x.soll))}, gezahlt ${eurT(Number(x.ist))}`).join('; ')
    : `Alle ${weg ? 'Hausgeld' : 'Miet'}-Vorauszahlungen ${jahr} sind vollständig bezahlt.`);

  // 6. Belege: Rechnungen ohne abgelegtes Dokument
  const ohneBeleg = await db.select(`SELECT r.datum, r.betrag, r.rechnungsnr, f.name AS firma FROM rechnungen r LEFT JOIN firmen f ON f.id = r.firma_id
    WHERE r.objekt_id = $1 AND r.datum BETWEEN $2 AND $3 AND r.dokument_id IS NULL ORDER BY r.datum`, [objekt, von, bis]);
  if (ohneBeleg.length) b('gelb', `${ohneBeleg.length} Rechnungen ohne abgelegten Beleg, z. B. ` + ohneBeleg.slice(0, 4).map((x) => `${dT(x.datum)} ${x.firma ?? ''} ${eurT(Number(x.betrag))}`.replace(/\s+/g, ' ')).join('; '));

  // 7. Rücklage (WEG)
  if (weg) {
    const rl = await ruecklageJahr(objekt, jahr);
    b(Math.abs(rl.offen) > 0.005 ? 'gelb' : 'gruen', `Erhaltungsrücklage 31.12.${jahr}: Soll ${eurT(rl.bestand)}, tatsächlich eingezahlt ${eurT(rl.bestandIst)}` + (Math.abs(rl.offen) > 0.005 ? `, offen ${eurT(rl.offen)}.` : '.'));
  }

  // 8. Kontoabgleich (Anfangs- und Endbestand, alles gebucht?)
  const kl = await kontoabgleich(objekt, jahr);
  return { titel: `${weg ? 'Hausgeldabrechnung' : 'Abrechnung'} ${jahr} ${o.name}`, befunde, kontoabgleich: abgleichText(kl, jahr) };
}

export function pruefTextFuerKi(r: Awaited<ReturnType<typeof abrechnungPruefen>>): string {
  const z = { rot: 'PROBLEM', gelb: 'HINWEIS', gruen: 'OK' } as const;
  return `${r.titel}\n\nBefunde:\n${r.befunde.map((x) => `- [${z[x.stufe]}] ${x.text}`).join('\n')}\n\nKontoabgleich:\n${r.kontoabgleich}`;
}
