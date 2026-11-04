// Bankabruf per FinTS: gemeinsamer Ablauf für den manuellen Abruf und den automatischen Abruf beim Start
import { db, type Row } from '../db';
import { eur, datum } from '../components/EntityTable';
import { automatischZuordnen, importieren, type Umsatz } from './bank';

// zur Laufzeit prüfen (nicht beim Laden), damit Tests die App-Schnittstelle nachträglich bereitstellen können
export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const BANK_INFO = 'nano-bank-info';
type Abruf = { wartet: boolean; system_id: string | null; umsaetze: (Umsatz & { vorgemerkt: boolean })[]; saldo: number | null; saldo_datum: string | null };
export type Start = { text: string; freigabe_in_app: boolean; ohne_tan: boolean };

export async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export const kontoIban = (k: Row) => String(k.iban ?? '').replace(/\s/g, '').toUpperCase();
export const kontoBlz = (k: Row) => { const i = kontoIban(k); return i.startsWith('DE') && i.length === 22 ? i.slice(4, 12) : ''; };
export const produktId = async () => String((await db.select(`SELECT wert FROM einstellungen WHERE schluessel = 'fints_produkt_id'`))[0]?.wert ?? '').trim();
export const pinGespeichert = (kontoId: number) => (isTauri() ? invoke<boolean>('bank_pin_vorhanden', { konto: kontoId }).catch(() => false) : Promise.resolve(false));

/** Anmelden bei der Bank. Ohne PIN wird die gespeicherte aus dem Schlüsselbund genommen. */
export async function starten(k: Row, opt: { pin?: string; merken?: boolean }) {
  const pid = await produktId();
  if (!pid) throw new Error('Bitte zuerst unter Einstellungen die FinTS-Produkt-ID eintragen (kostenlos bei fints.org registrieren).');
  if (!kontoBlz(k)) throw new Error('Für den Abruf braucht das Bankkonto eine deutsche IBAN (Banken & Konten).');
  if (!String(k.fints_benutzer ?? '').trim()) throw new Error('Bitte den Anmeldenamen (Benutzerkennung) des Online-Bankings eingeben.');
  return invoke<Start>('bank_start', {
    konto: k.id, blz: kontoBlz(k), benutzer: String(k.fints_benutzer).trim(), pin: opt.pin || null, merken: !!opt.merken,
    systemId: k.fints_system_id || null, produktId: pid, iban: kontoIban(k), bic: String(k.bic ?? '').trim(),
  });
}

/** Umsätze abholen (wartet bei Bedarf auf die Freigabe), importieren, zuordnen und den Stand am Konto merken */
export async function abholen(k: Row, tage: number, abbruch: () => boolean, warteMs = 5 * 60 * 1000): Promise<string | null> {
  const ende = Date.now() + warteMs;
  while (!abbruch() && Date.now() < ende) {
    const r = await invoke<Abruf>('bank_abholen', { iban: kontoIban(k), bic: String(k.bic ?? '').trim(), tage });
    if (r.wartet) { await new Promise((ok) => setTimeout(ok, 3000)); continue; }
    const gebucht = r.umsaetze.filter((u) => !u.vorgemerkt && u.betrag !== 0);
    const imp = await importieren(k.id, gebucht.map(({ vorgemerkt: _v, ...u }) => u));
    const a = await automatischZuordnen();
    await db.execute(`UPDATE bankkonten SET letzter_abruf = datetime('now', 'localtime'), abruf_hinweis = NULL, fints_system_id = COALESCE($1, fints_system_id) WHERE id = $2`, [r.system_id, k.id]);
    const saldo = r.saldo != null ? ` Kontostand laut Bank: ${eur(r.saldo)}${r.saldo_datum ? ` (${datum(r.saldo_datum)})` : ''}.` : '';
    return `${imp.neu} ${imp.neu === 1 ? 'neuer Umsatz' : 'neue Umsätze'} abgerufen${imp.doppelt ? `, ${imp.doppelt} waren schon vorhanden` : ''}. ${a.zugeordnet} automatisch zugeordnet, ${a.pruefen} zum Prüfen.${saldo}`;
  }
  invoke('bank_abbrechen').catch(() => {});
  return null;
}

let laeuft = false;
/** Beim Start: alle Konten mit automatischem Abruf ohne Freigabe abrufen (höchstens alle 4 Stunden je Konto) */
export async function autoAbruf(abstandStunden = 4) {
  if (!isTauri() || laeuft) return;
  laeuft = true;
  try {
    const konten = await db.select(`SELECT * FROM bankkonten WHERE auto_abruf = 1 AND (letzter_abruf IS NULL OR letzter_abruf < datetime('now', 'localtime', $1))`, [`-${abstandStunden} hours`]);
    for (const k of konten) {
      if (!(await pinGespeichert(k.id))) continue;
      try {
        const s = await starten(k, {});
        if (!s.ohne_tan) {
          // Die Bank verlangt wieder eine Freigabe: nicht im Hintergrund warten, sondern Bescheid geben
          await invoke('bank_abbrechen');
          await db.execute(`UPDATE bankkonten SET abruf_hinweis = $1 WHERE id = $2`, ['Die Bank verlangt wieder eine Freigabe in der Banking-App. Bitte einmal „Jetzt abrufen“ klicken und freigeben.', k.id]);
          window.dispatchEvent(new CustomEvent(BANK_INFO, { detail: `${k.name}: Die Bank möchte wieder eine Freigabe. Bitte unter Online Banking einmal abrufen.` }));
          continue;
        }
        const msg = await abholen(k, 30, () => false, 60 * 1000);
        if (msg) window.dispatchEvent(new CustomEvent(BANK_INFO, { detail: `${k.name}: ${msg}` }));
      } catch (e: any) {
        await db.execute(`UPDATE bankkonten SET abruf_hinweis = $1 WHERE id = $2`, [`Automatischer Abruf fehlgeschlagen: ${String(e?.message ?? e)}`, k.id]);
      }
    }
  } finally { laeuft = false; }
}

// Für Tests in der Browser-Vorschau erreichbar
if (typeof window !== 'undefined') (window as any).__nanoAutoAbruf = autoAbruf;
