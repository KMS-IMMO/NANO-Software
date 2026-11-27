// Darstellung: Marmor Schiefer (Standard), Hell, Dunkel (Forged Carbon) oder wie macOS.
// Gespeichert pro Gerät, damit schon der Sperrbildschirm passt.
export type Darstellung = 'marmor' | 'hell' | 'dunkel' | 'system';
const SCHLUESSEL = 'nano-darstellung';
// Einmalige Umstellung auf das Marmor-Design (27.11.2026); danach gilt wieder die eigene Wahl.
const MARMOR_EINGEFUEHRT = 'nano-darstellung-marmor-eingefuehrt';
const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function darstellungLesen(): Darstellung {
  try {
    if (!localStorage.getItem(MARMOR_EINGEFUEHRT)) { localStorage.setItem(MARMOR_EINGEFUEHRT, '1'); localStorage.setItem(SCHLUESSEL, 'marmor'); }
    const v = localStorage.getItem(SCHLUESSEL);
    if (v === 'hell' || v === 'dunkel' || v === 'system' || v === 'marmor') return v;
  } catch { /* ohne Speicher: Marmor */ }
  return 'marmor';
}

export function darstellungAnwenden(d: Darstellung = darstellungLesen()) {
  const dunkel = d === 'dunkel' || (d === 'system' && !!mq?.matches);
  if (dunkel) document.documentElement.dataset.theme = 'dunkel';
  else if (d === 'marmor') document.documentElement.dataset.theme = 'marmor';
  else delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = dunkel ? 'dark' : 'light';
}

export function darstellungSetzen(d: Darstellung) {
  try { localStorage.setItem(SCHLUESSEL, d); } catch { /* nur für diese Sitzung */ }
  darstellungAnwenden(d);
}

mq?.addEventListener?.('change', () => { if (darstellungLesen() === 'system') darstellungAnwenden('system'); });

// Schriftgröße der App: vergrößert alles gleichmäßig (Text, Tabellen, Knöpfe). Ausdrucke und PDFs bleiben unverändert.
export type Schrift = 'normal' | 'gross' | 'sehrgross';
const SCHRIFT = 'nano-schrift';
const FAKTOR: Record<Schrift, number> = { normal: 1, gross: 1.1, sehrgross: 1.2 };
export function schriftLesen(): Schrift {
  try { const v = localStorage.getItem(SCHRIFT); if (v === 'gross' || v === 'sehrgross') return v; } catch { /* ohne Speicher: normal */ }
  return 'normal';
}
export function schriftAnwenden(s: Schrift = schriftLesen()) {
  const f = FAKTOR[s];
  (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = f === 1 ? '' : String(f);
}
export function schriftSetzen(s: Schrift) {
  try { localStorage.setItem(SCHRIFT, s); } catch { /* nur für diese Sitzung */ }
  schriftAnwenden(s);
}

/** 0,00 € nicht rot oder grün färben: markiert .neg/.pos mit Betrag 0 als neutral */
export function nullBetraegeNeutral() {
  const NULL = /^[−-]?\s*0,00\s*€$/;
  let geplant = false;
  const pruefen = () => {
    geplant = false;
    document.querySelectorAll<HTMLElement>('.neg, .pos').forEach((e) => {
      const n = NULL.test((e.textContent ?? '').trim());
      if (n !== e.hasAttribute('data-null')) { if (n) e.setAttribute('data-null', ''); else e.removeAttribute('data-null'); }
    });
  };
  new MutationObserver(() => { if (!geplant) { geplant = true; setTimeout(pruefen, 0); } })
    .observe(document.body, { subtree: true, childList: true, characterData: true });
  pruefen();
}
