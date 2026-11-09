import { User, Users, Hammer, MapPinOff } from 'lucide-react';
import { EntityTable, eur } from '../components/EntityTable';
import { personLabel } from '../db/labels';

// Eine Person kann Mieter mehrerer Einheiten und zugleich Eigentümer sein: sie erscheint in jeder Liste, in der sie hinterlegt ist
const ROLLE_SQL: Record<string, string> = {
  Mieter: `(p.rolle = 'Mieter' OR EXISTS (SELECT 1 FROM mietvertraege v WHERE v.mieter_id = p.id OR v.mieter2_id = p.id))`,
  'Eigentümer': `(p.rolle = 'Eigentümer' OR EXISTS (SELECT 1 FROM eigentum ei WHERE ei.person_id = p.id) OR EXISTS (SELECT 1 FROM objekte o WHERE o.eigentuemer_id = p.id))`,
};

export function PersonenPage({ rolle, titel }: { rolle?: 'Eigentümer' | 'Mieter' | 'Verwalter' | 'Sonstige'; titel?: string }) {
  return (
    <EntityTable
      key={rolle ?? 'alle'}
      title={titel ?? rolle ?? 'Eigentümer und Mieter'}
      icon={rolle === 'Mieter' ? <User size={22} /> : <Users size={22} />}
      newLabel={rolle ? `${rolle} hinzufügen` : 'Person hinzufügen'}
      table="personen"
      fixed={rolle ? { rolle } : undefined}
      fields={[
        ...(rolle ? [] : [{ key: 'rolle', label: 'Rolle', type: 'select' as const, options: ['Mieter', 'Eigentümer', 'Verwalter', 'Sonstige'], required: true }]),
        { key: 'anrede', label: 'Anrede', type: 'select', options: ['Herr', 'Frau', 'Divers', 'Firma', 'Eheleute'], hideInTable: true },
        { key: 'titel', label: 'Titel', hideInTable: true },
        { key: 'vorname', label: 'Vorname' },
        { key: 'nachname', label: 'Nachname', format: (v: any, r: any) => v ?? (r.firma ? <b>{r.firma}</b> : '') },
        { key: 'firma', label: 'Firma (falls Gewerbe)', hideInTable: true },
        { key: 'strasse', label: 'Straße', hideInTable: true },
        { key: 'plz', label: 'PLZ', hideInTable: true },
        { key: 'ort', label: 'Ort' },
        { key: 'telefon', label: 'Telefon' },
        { key: 'mobil', label: 'Mobil', hideInTable: true },
        { key: 'email', label: 'E-Mail' },
        { key: 'geburtsdatum', label: 'Geburtsdatum', type: 'date', hideInTable: true },
        { key: 'iban', label: 'IBAN', hideInTable: true },
        { key: 'bic', label: 'BIC', hideInTable: true },
        { key: 'notiz', label: 'Notiz', type: 'textarea', hideInTable: true },
        { key: 'objekte', label: 'Objekte / Einheiten', computed: true },
        ...(rolle === 'Mieter' ? [
          { key: 'nk_vz', label: 'NK-Vorauszahlung / Monat', type: 'number' as const, computed: true, sum: true, format: (v: any) => v != null ? eur(v) : '–' },
          { key: 'hk_vz', label: 'HK-Vorauszahlung / Monat', type: 'number' as const, computed: true, sum: true, format: (v: any) => v != null ? eur(v) : '–' }] : []),
      ]}
      listSql={`SELECT p.*, ${personLabel('p')} AS anzeigename,
          (SELECT GROUP_CONCAT(x, '; ') FROM (
            SELECT o.name || ' ' || e.nummer || ' (Eigentümer)' AS x FROM eigentum ei JOIN einheiten e ON e.id = ei.einheit_id
               JOIN objekte o ON o.id = e.objekt_id WHERE ei.person_id = p.id AND (ei.bis IS NULL OR ei.bis >= date('now'))
            UNION ALL SELECT o.name || ' (Eigentümer)' FROM objekte o WHERE o.eigentuemer_id = p.id
            UNION ALL SELECT o.name || ' ' || e.nummer || ' (Mieter)' FROM mietvertraege v JOIN einheiten e ON e.id = v.einheit_id
               JOIN objekte o ON o.id = e.objekt_id WHERE (v.mieter_id = p.id OR v.mieter2_id = p.id) AND (v.ende IS NULL OR v.ende >= date('now')))) AS objekte${rolle === 'Mieter' ? `,
          (SELECT SUM(COALESCE((SELECT a.nk_vorauszahlung FROM mietanpassungen a WHERE a.vertrag_id = v.id AND a.nk_vorauszahlung IS NOT NULL AND a.gueltig_ab <= date('now') ORDER BY a.gueltig_ab DESC LIMIT 1), v.nk_vorauszahlung, 0))
            FROM mietvertraege v WHERE v.mieter_id = p.id AND v.beginn <= date('now') AND (v.ende IS NULL OR v.ende >= date('now'))) AS nk_vz,
          (SELECT SUM(COALESCE((SELECT a.hk_vorauszahlung FROM mietanpassungen a WHERE a.vertrag_id = v.id AND a.hk_vorauszahlung IS NOT NULL AND a.gueltig_ab <= date('now') ORDER BY a.gueltig_ab DESC LIMIT 1), v.hk_vorauszahlung, 0))
            FROM mietvertraege v WHERE v.mieter_id = p.id AND v.beginn <= date('now') AND (v.ende IS NULL OR v.ende >= date('now'))) AS hk_vz` : ''}
        FROM personen p ${rolle ? `WHERE ${ROLLE_SQL[rolle] ?? `p.rolle = '${rolle}'`}` : ''} ORDER BY p.rolle, COALESCE(p.nachname, p.firma)`}
    />
  );
}

export function FirmenPage() {
  return (
    <EntityTable
      title="Firmen und Lieferanten"
      icon={<Hammer size={22} />}
      newLabel="Firma hinzufügen"
      table="firmen"
      fields={[
        { key: 'name', label: 'Firma', required: true, wide: true, format: (v, r) => <span className="firma-name">{v}{!(r.strasse && r.plz && r.ort) &&
            <span className="adresse-fehlt" title="Adresse fehlt. Zeile anklicken und Straße, PLZ, Ort, Telefon, E-Mail und IBAN eintragen."><MapPinOff size={14} />Adresse eintragen</span>}</span> },
        { key: 'gewerk', label: 'Gewerk', type: 'select', options: ['Lieferant', 'Sanitär / Heizung', 'Elektro', 'Dach', 'Maler', 'Schreiner', 'Schlüsseldienst', 'Hausmeister', 'Reinigung', 'Garten / Winterdienst', 'Aufzug', 'Messdienst', 'Schornsteinfeger', 'Versicherung', 'Versorger', 'Sonstiges'] },
        { key: 'ansprechpartner', label: 'Ansprechpartner' },
        { key: 'strasse', label: 'Straße', hideInTable: true },
        { key: 'plz', label: 'PLZ', hideInTable: true },
        { key: 'ort', label: 'Ort' },
        { key: 'telefon', label: 'Telefon' },
        { key: 'mobil', label: 'Mobil', hideInTable: true },
        { key: 'email', label: 'E-Mail' },
        { key: 'webseite', label: 'Webseite', hideInTable: true },
        { key: 'iban', label: 'IBAN', hideInTable: true },
        { key: 'ust_id', label: 'USt-ID', hideInTable: true },
        { key: 'notiz', label: 'Notiz', type: 'textarea', hideInTable: true },
      ]}
      listSql="SELECT * FROM firmen ORDER BY (strasse IS NULL OR plz IS NULL OR ort IS NULL) DESC, gewerk, name"
      emptyText="Noch keine Firmen. Lieferanten aus den Ausgaben erscheinen hier automatisch."
    />
  );
}
