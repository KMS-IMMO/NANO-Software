// Terminarten mit Farben: gelten für Kalendertermine und terminierte Tickets.
export const TERMINARTEN = [
  { art: 'Handwerker', cls: 'ta-handwerker' },
  { art: 'Mieter/Eigentümer', cls: 'ta-mieter' },
  { art: 'Besichtigung', cls: 'ta-besichtigung' },
  { art: 'Dienstleister', cls: 'ta-dienstleister' },
  { art: 'KMS Office', cls: 'ta-office' },
  { art: 'Eigentümerversammlung', cls: 'ta-versammlung' },
] as const;

/** CSS-Klasse einer Terminart, leer wenn keine gewählt ist */
export const terminKlasse = (art?: string | null) => TERMINARTEN.find((t) => t.art === art)?.cls ?? '';
