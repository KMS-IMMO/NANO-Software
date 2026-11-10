// Liste der wiederkehrenden Ausgaben in „Einnahmen & Ausgaben“
import { useState } from 'react';
import { Repeat } from 'lucide-react';
import { EntityTable, datum, eur } from './EntityTable';
import { INTERVALLE, wiederkehrendErzeugen } from '../logic/wiederkehrend';
import { kontoOptions } from '../db/labels';

export function Wiederkehrend({ objektId, onChange }: { objektId?: number; onChange?: () => void }) {
  const [info, setInfo] = useState('');
  const [v, setV] = useState(0);
  async function jetzt() {
    const n = await wiederkehrendErzeugen();
    setInfo(n ? `${n} Rechnung${n > 1 ? 'en' : ''} angelegt. Du findest sie unter „Offene Rechnungen“.` : 'Zurzeit ist nichts fällig.');
    setV((x) => x + 1); onChange?.();
  }
  const w = objektId ? `WHERE w.objekt_id = ${Number(objektId)}` : '';
  return (
    <>
      <EntityTable
        title="Wiederkehrende Ausgaben"
        icon={<Repeat size={22} />}
        table="wiederkehrend"
        version={v}
        fixed={objektId ? { objekt_id: objektId } : undefined}
        onChange={onChange}
        fields={[
          ...(objektId ? [] : [{ key: 'objekt_id', label: 'Liegenschaft', type: 'select' as const, required: true, optionsSql: 'SELECT id AS value, name AS label FROM objekte ORDER BY name' }]),
          { key: 'text', label: 'Bezeichnung', required: true, wide: true },
          { key: 'firma_id', label: 'Unternehmen', type: 'select', optionsSql: 'SELECT id AS value, name AS label FROM firmen ORDER BY name' },
          { key: 'buchungskonto_id', label: 'Buchungskonto', type: 'select', required: true, optionsSql: kontoOptions("art = 'Aufwand'") },
          { key: 'betrag', label: 'Betrag brutto', type: 'number', required: true, format: (x) => eur(Number(x)) },
          { key: 'intervall', label: 'Rhythmus', type: 'select', required: true, options: INTERVALLE, format: (x) => INTERVALLE.find((i) => i.value === Number(x))?.label ?? x },
          { key: 'naechste', label: 'Nächste Rechnung am', type: 'date', required: true, format: (x) => datum(x) },
          { key: 'zahlungsziel', label: 'Zahlungsziel in Tagen (leer = 14)', type: 'number', hideInTable: true },
          { key: 'ende', label: 'Endet am (optional)', type: 'date', hideInTable: true },
          { key: 'pausiert', label: 'Pausiert', type: 'checkbox', format: (x) => (Number(x) ? 'pausiert' : 'aktiv') },
        ]}
        listSql={`SELECT w.*, o.name AS objekt_id_label, f.name AS firma_id_label, k.nummer || ' ' || k.name AS buchungskonto_id_label
          FROM wiederkehrend w LEFT JOIN objekte o ON o.id = w.objekt_id LEFT JOIN firmen f ON f.id = w.firma_id LEFT JOIN buchungskonten k ON k.id = w.buchungskonto_id
          ${w} ORDER BY w.naechste`}
        emptyText="Noch keine wiederkehrende Ausgabe. Lege z. B. Gebäudeversicherung, Hausmeister oder Wartungsverträge an."
        newLabel="Neue wiederkehrende Ausgabe"
      />
      <div className="row"><button onClick={jetzt}><Repeat size={16} />Fällige jetzt anlegen</button>{info && <span className="info" style={{ margin: 0 }}>{info}</span>}
        <span className="muted small">NEOSS legt fällige Rechnungen auch bei jedem Start automatisch an.</span></div>
    </>
  );
}
