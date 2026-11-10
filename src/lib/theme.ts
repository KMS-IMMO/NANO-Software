// Darstellung: Hell, Dunkel (Forged Carbon) oder wie macOS. Gespeichert pro Gerät, damit schon der Sperrbildschirm passt.
export type Darstellung = 'hell' | 'dunkel' | 'system';
const SCHLUESSEL = 'nano-darstellung';
const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function darstellungLesen(): Darstellung {
  try { const v = localStorage.getItem(SCHLUESSEL); if (v === 'dunkel' || v === 'system') return v; } catch { /* ohne Speicher: hell */ }
  return 'hell';
}

export function darstellungAnwenden(d: Darstellung = darstellungLesen()) {
  const dunkel = d === 'dunkel' || (d === 'system' && !!mq?.matches);
  if (dunkel) document.documentElement.dataset.theme = 'dunkel';
  else delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = dunkel ? 'dark' : 'light';
}

export function darstellungSetzen(d: Darstellung) {
  try { localStorage.setItem(SCHLUESSEL, d); } catch { /* nur für diese Sitzung */ }
  darstellungAnwenden(d);
}

mq?.addEventListener?.('change', () => { if (darstellungLesen() === 'system') darstellungAnwenden('system'); });
