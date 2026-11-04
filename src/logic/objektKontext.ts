// Ist eine Liegenschaft geöffnet, arbeiten die Seiten (Buchungen, Bank, Abrechnungen …) nur mit ihr.
import { createContext, useContext } from 'react';

export type ObjektKontextWert = { id: number; name: string; weg: boolean };
export const ObjektKontext = createContext<ObjektKontextWert | null>(null);
/** Die geöffnete Liegenschaft oder null (Gesamtansicht über alle Liegenschaften) */
export const useObjektKontext = () => useContext(ObjektKontext);
