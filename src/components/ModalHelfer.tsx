// Gemeinsames Verhalten aller Fenster (.modal-bg):
// - Esc schließt das oberste Fenster wie ein Klick daneben
// - Wurde im Fenster schon etwas eingetragen, schließt weder Esc noch ein Klick daneben.
//   Das Fenster wackelt kurz und zeigt einen Hinweis, damit keine Eingabe verloren geht.
import { useEffect } from 'react';

const oberstes = () => { const l = document.querySelectorAll<HTMLElement>('.modal-bg'); return l.length ? l[l.length - 1] : null; };

function warnen(bg: HTMLElement) {
  const m = bg.querySelector<HTMLElement>('.modal');
  if (!m) return;
  m.classList.remove('wackeln'); void m.offsetWidth; m.classList.add('wackeln');
  if (!m.querySelector('.modal-hinweis')) {
    const h = document.createElement('div');
    h.className = 'modal-hinweis';
    h.textContent = 'Du hast schon etwas eingetragen. Bitte „Speichern“ oder „Abbrechen“ wählen.';
    m.prepend(h);
    setTimeout(() => h.remove(), 3500);
  }
}

export function ModalHelfer() {
  useEffect(() => {
    const eingabe = (e: Event) => { const bg = (e.target as HTMLElement)?.closest?.('.modal-bg') as HTMLElement | null; if (bg) bg.dataset.geaendert = '1'; };
    const klick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t?.classList?.contains('modal-bg') && t.dataset.geaendert) { e.stopPropagation(); e.preventDefault(); warnen(t); }
    };
    const taste = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const bg = oberstes();
      if (!bg) return;
      e.preventDefault();
      if (bg.dataset.geaendert) warnen(bg); else bg.click();
    };
    document.addEventListener('input', eingabe, true);
    document.addEventListener('change', eingabe, true);
    document.addEventListener('click', klick, true);
    document.addEventListener('keydown', taste);
    return () => {
      document.removeEventListener('input', eingabe, true);
      document.removeEventListener('change', eingabe, true);
      document.removeEventListener('click', klick, true);
      document.removeEventListener('keydown', taste);
    };
  }, []);
  return null;
}
