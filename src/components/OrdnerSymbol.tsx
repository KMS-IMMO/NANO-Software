// Ordnersymbol der Dokumentenablage: graue Mappe mit Reiter, Farben über CSS (hell und dunkel)
export function OrdnerSymbol({ voll = false, groesse = 72, nummer }: { voll?: boolean; groesse?: number; nummer?: string }) {
  return (
    <svg className={'ordner-symbol' + (voll ? ' voll' : '')} width={groesse} height={groesse * 0.78} viewBox="0 0 100 78" aria-hidden="true">
      <path className="ordner-hinten" d="M8 2h24c3 0 4.6 1 6.4 3.2L44 12h48a8 8 0 0 1 8 8v48a8 8 0 0 1-8 8H8a8 8 0 0 1-8-8V10a8 8 0 0 1 8-8z" />
      {voll && <rect className="ordner-blatt" x="9" y="13" width="82" height="20" rx="2" />}
      <path className="ordner-vorne" d="M7 22h86a7 7 0 0 1 7 7v41a8 8 0 0 1-8 8H8a8 8 0 0 1-8-8V29a7 7 0 0 1 7-7z" />
      {nummer && <text className="ordner-nummer" x="50" y="60" textAnchor="middle">{nummer}</text>}
    </svg>
  );
}
