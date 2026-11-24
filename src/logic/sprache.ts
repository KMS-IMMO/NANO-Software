// Sprechen und Zuhören für den KI-Agenten, mit dem, was macOS mitbringt:
// Vorlesen über die Systemstimmen (läuft auf dem Mac), Zuhören über die Spracherkennung von WebKit, sonst Diktierfunktion von macOS.

/** Text so umbauen, dass er sich gut vorlesen lässt (keine Tabellen, Zeichen und Abkürzungen ausgeschrieben) */
export function sprechText(t: string): string {
  return t
    .split('\n').filter((z) => !/^\s*\|/.test(z)).join('\n')   // Tabellen nicht vorlesen
    .replace(/\*\*|__|`|#+\s/g, '')
    .replace(/^\s*([-*•]|\d+\.)\s+/gm, '')
    .replace(/(\d)\s?€/g, '$1 Euro').replace(/€/g, 'Euro')
    .replace(/§\s?(\d+\s?[a-z]?)/gi, 'Paragraf $1')
    .replace(/\bz\.\s?B\./g, 'zum Beispiel').replace(/\bu\.\s?a\./g, 'unter anderem').replace(/\bggf\./g, 'gegebenenfalls').replace(/\bbzw\./g, 'beziehungsweise')
    .replace(/\bWE\s?(\d+)/g, 'Wohnung $1').replace(/\bNK\b/g, 'Nebenkosten').replace(/\bMEA\b/g, 'Miteigentumsanteile')
    .replace(/(\d{1,2})\.(\d{1,2})\.(\d{4})/g, '$1.$2.$3')
    .replace(/\s+/g, ' ').trim();
}

/** Deutsche Stimmen des Systems, die besten zuerst (Premium/Erweitert vor Standard) */
export function deutscheStimmen(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === 'undefined') return [];
  const rang = (v: SpeechSynthesisVoice) => (/premium/i.test(v.name) ? 0 : /enhanced|erweitert/i.test(v.name) ? 1 : 2);
  return speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith('de')).sort((a, b) => rang(a) - rang(b));
}

/** Stimmen werden in WebKit erst nach einem Moment geladen */
async function stimmenLaden() {
  if (typeof speechSynthesis === 'undefined') return;
  if (speechSynthesis.getVoices().length) return;
  await new Promise<void>((ok) => { const t = setTimeout(ok, 1200); speechSynthesis.addEventListener('voiceschanged', () => { clearTimeout(t); ok(); }, { once: true }); });
}

/** Text vorlesen. Wartet, bis zu Ende gesprochen (oder abgebrochen) ist. */
export async function sprechen(text: string, stimmeName = ''): Promise<void> {
  if (typeof speechSynthesis === 'undefined') return;
  await stimmenLaden();
  speechSynthesis.cancel();
  const s = sprechText(text);
  if (!s) return;
  const stimmen = deutscheStimmen();
  const stimme = stimmen.find((v) => v.name === stimmeName) ?? stimmen[0];
  // In Sätze teilen: lange Texte brechen in WebKit sonst manchmal ab
  const saetze = s.match(/[^.!?]+[.!?]*/g) ?? [s];
  for (const satz of saetze) {
    if (!satz.trim()) continue;
    const ok = await new Promise<boolean>((fertig) => {
      const u = new SpeechSynthesisUtterance(satz.trim());
      u.lang = 'de-DE'; if (stimme) u.voice = stimme; u.rate = 1.02;
      u.onend = () => fertig(true); u.onerror = () => fertig(false);
      speechSynthesis.speak(u);
    });
    if (!ok) return;
  }
}
export function stillsein() { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); }

type Erkenner = { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; abort(): void;
  onresult: ((e: any) => void) | null; onerror: ((e: any) => void) | null; onend: (() => void) | null };
const ErkennerKlasse = (): (new () => Erkenner) | null => (typeof window === 'undefined' ? null : (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null);
export const erkennungMoeglich = () => !!ErkennerKlasse();

/** Einmal zuhören: liefert Zwischenstände und am Ende den ganzen Satz. Nach etwa 1,5 Sekunden Stille ist Schluss. */
export class Hoeren {
  private r: Erkenner | null = null;
  private text = '';
  private stille: ReturnType<typeof setTimeout> | undefined;
  private beendet = false;
  private cb: { zwischen: (t: string) => void; fertig: (t: string) => void; fehler: (grund: 'nicht-erlaubt' | 'nicht-verfuegbar' | 'sonst') => void };
  constructor(cb: Hoeren['cb']) { this.cb = cb; }
  start() {
    const K = ErkennerKlasse();
    if (!K) { this.cb.fehler('nicht-verfuegbar'); return; }
    const r = new K(); this.r = r;
    r.lang = 'de-DE'; r.continuous = true; r.interimResults = true;
    r.onresult = (e: any) => {
      let fest = '', vorlaeufig = '';
      for (let i = 0; i < e.results.length; i++) { const x = e.results[i]; if (x.isFinal) fest += x[0].transcript; else vorlaeufig += x[0].transcript; }
      this.text = (fest + vorlaeufig).trim();
      this.cb.zwischen(this.text);
      clearTimeout(this.stille);
      this.stille = setTimeout(() => this.stop(), 1500);
    };
    r.onerror = (e: any) => {
      const g = String(e?.error ?? '');
      if (g === 'no-speech' || g === 'aborted') return;
      this.beendet = true;
      this.cb.fehler(g === 'not-allowed' || g === 'service-not-allowed' ? 'nicht-erlaubt' : g === 'audio-capture' ? 'nicht-verfuegbar' : 'sonst');
    };
    r.onend = () => { clearTimeout(this.stille); if (!this.beendet) { this.beendet = true; this.cb.fertig(this.text); } };
    try { r.start(); } catch { this.beendet = true; this.cb.fehler('nicht-verfuegbar'); }
    // Sagt man gar nichts, nach 8 Sekunden aufhören
    this.stille = setTimeout(() => this.stop(), 8000);
  }
  stop() { clearTimeout(this.stille); try { this.r?.stop(); } catch { /* schon beendet */ } }
}
