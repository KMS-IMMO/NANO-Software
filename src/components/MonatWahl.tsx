// Monat und Jahr per Auswahlliste (das Mac-Fenster zeigt <input type="month"> nur als Textfeld). Wert im Format JJJJ-MM.
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export function MonatWahl({ value, onChange, vonJahr, bisJahr }: { value: string; onChange: (v: string) => void; vonJahr?: number; bisJahr?: number }) {
  const jetzt = new Date().getFullYear();
  const [j, m] = /^\d{4}-\d{2}$/.test(value) ? [Number(value.slice(0, 4)), Number(value.slice(5, 7))] : [jetzt, new Date().getMonth() + 1];
  const start = Math.min(vonJahr ?? jetzt - 6, j), ende = Math.max(bisJahr ?? jetzt + 3, j);
  const jahre = Array.from({ length: ende - start + 1 }, (_, i) => start + i);
  const setzen = (jj: number, mm: number) => onChange(`${jj}-${String(mm).padStart(2, '0')}`);
  return (
    <span className="monat-wahl">
      <select aria-label="Monat" value={m} onChange={(e) => setzen(j, Number(e.target.value))}>
        {MONATE.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
      </select>
      <select aria-label="Jahr" value={j} onChange={(e) => setzen(Number(e.target.value), m)}>
        {jahre.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
    </span>
  );
}
