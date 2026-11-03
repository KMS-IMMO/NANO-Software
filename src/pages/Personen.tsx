import { EntityTable } from '../components/EntityTable';
import { personLabel } from '../db/labels';

export function PersonenPage() {
  return (
    <EntityTable
      title="Eigentümer und Mieter"
      table="personen"
      fields={[
        { key: 'rolle', label: 'Rolle', type: 'select', options: ['Mieter', 'Eigentümer', 'Sonstige'], required: true },
        { key: 'anrede', label: 'Anrede', type: 'select', options: ['Herr', 'Frau', 'Divers', 'Firma', 'Eheleute'], hideInTable: true },
        { key: 'titel', label: 'Titel', hideInTable: true },
        { key: 'vorname', label: 'Vorname' },
        { key: 'nachname', label: 'Nachname' },
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
      ]}
      listSql={`SELECT p.*, ${personLabel('p')} AS anzeigename,
          COALESCE(
            (SELECT GROUP_CONCAT(o.name || ' ' || e.nummer, '; ') FROM eigentum ei JOIN einheiten e ON e.id = ei.einheit_id
               JOIN objekte o ON o.id = e.objekt_id WHERE ei.person_id = p.id AND (ei.bis IS NULL OR ei.bis >= date('now'))),
            (SELECT GROUP_CONCAT(o.name, '; ') FROM objekte o WHERE o.eigentuemer_id = p.id),
            (SELECT GROUP_CONCAT(o.name || ' ' || e.nummer, '; ') FROM mietvertraege v JOIN einheiten e ON e.id = v.einheit_id
               JOIN objekte o ON o.id = e.objekt_id WHERE v.mieter_id = p.id AND (v.ende IS NULL OR v.ende >= date('now')))
          ) AS objekte
        FROM personen p ORDER BY p.rolle, COALESCE(p.nachname, p.firma)`}
    />
  );
}

export function FirmenPage() {
  return (
    <EntityTable
      title="Firmenkontakte (Handwerker und Dienstleister)"
      table="firmen"
      fields={[
        { key: 'name', label: 'Firma', required: true, wide: true },
        { key: 'gewerk', label: 'Gewerk', type: 'select', options: ['Sanitär / Heizung', 'Elektro', 'Dach', 'Maler', 'Schreiner', 'Schlüsseldienst', 'Hausmeister', 'Reinigung', 'Garten / Winterdienst', 'Aufzug', 'Messdienst', 'Schornsteinfeger', 'Versicherung', 'Versorger', 'Sonstiges'] },
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
      listSql="SELECT * FROM firmen ORDER BY gewerk, name"
      emptyText="Noch keine Firmen. Hier stehen nur Handwerker und Dienstleister."
    />
  );
}
