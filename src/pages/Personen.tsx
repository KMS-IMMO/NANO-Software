import { User, Users, Hammer, MapPinOff, Mail, Phone, Building2 } from 'lucide-react';
import type { Row } from '../db';
import { EntityTable, eur } from '../components/EntityTable';
import { personLabel } from '../db/labels';
import { Schriftverkehr } from './Kommunikation';

// Eine Person kann Mieter mehrerer Einheiten und zugleich Eigentümer sein: sie erscheint in jeder Liste, in der sie hinterlegt ist
const ROLLE_SQL: Record<string, string> = {
  Mieter: `(p.rolle = 'Mieter' OR EXISTS (SELECT 1 FROM mietvertraege v WHERE v.mieter_id = p.id OR v.mieter2_id = p.id))`,
  'Eigentümer': `(p.rolle = 'Eigentümer' OR EXISTS (SELECT 1 FROM eigentum ei WHERE ei.person_id = p.id) OR EXISTS (SELECT 1 FROM objekte o WHERE o.eigentuemer_id = p.id))`,
};

/** Kopf des Bearbeiten-Fensters: Kürzel, Name, Rolle, Einheiten und Kontaktwege auf einen Blick */
function PersonKopf({ w, rolle }: { w: Row; rolle?: string }) {
  const name = [w.titel, w.vorname, w.nachname].filter(Boolean).join(' ').trim();
  const anzeige = name || w.firma || 'Neuer Kontakt';
  const kuerzel = (name ? [w.vorname, w.nachname] : [w.firma]).filter(Boolean).map((x: string) => String(x).trim()[0] ?? '').join('').slice(0, 2).toUpperCase() || '?';
  const r = w.rolle ?? rolle;
  const objekte = String(w.objekte ?? '').split('; ').filter(Boolean);
  return (
    <div className="person-kopf">
      <span className={'person-kuerzel' + (r === 'Mieter' ? ' mie' : r === 'Eigentümer' ? ' eig' : '')}>{kuerzel}</span>
      <div className="person-kopf-text">
        <h3>{anzeige}{name && w.firma ? <span className="muted"> · {w.firma}</span> : null}</h3>
        <div className="person-chips">
          {r && <span className={'rolle-chip' + (r === 'Mieter' ? ' mieter' : r === 'Eigentümer' ? ' eigentuemer' : '')}>{r}</span>}
          {objekte.map((o) => <span key={o} className="person-chip"><Building2 size={12} />{o.replace(/ \((Eigentümer|Mieter)\)$/, '')}</span>)}
          {w.telefon && <a className="person-chip klick" href={`tel:${String(w.telefon).replace(/\s/g, '')}`}><Phone size={12} />{w.telefon}</a>}
          {w.email && <a className="person-chip klick" href={`mailto:${w.email}`}><Mail size={12} />{w.email}</a>}
        </div>
      </div>
    </div>
  );
}

export function PersonenPage({ rolle, titel }: { rolle?: 'Eigentümer' | 'Mieter' | 'Verwalter' | 'Sonstige'; titel?: string }) {
  return (
    <EntityTable
      key={rolle ?? 'alle'}
      rowClass={(r) => (rolle === 'Eigentümer' || (!rolle && r.rolle === 'Eigentümer') ? 'zeile-eig' : rolle === 'Mieter' || (!rolle && r.rolle === 'Mieter') ? 'zeile-mie' : undefined)}
      title={titel ?? rolle ?? 'Eigentümer und Mieter'}
      icon={rolle === 'Mieter' ? <User size={22} /> : <Users size={22} />}
      newLabel={rolle ? `${rolle} hinzufügen` : 'Person hinzufügen'}
      table="personen"
      fixed={rolle ? { rolle } : undefined}
      editExtra={(r) => <Schriftverkehr personId={r.id} />}
      kopf={(w) => <PersonKopf w={w} rolle={rolle} />}
      fields={[
        ...(rolle ? [] : [{ key: 'rolle', label: 'Rolle', type: 'select' as const, options: ['Mieter', 'Eigentümer', 'Verwalter', 'Sonstige'], required: true, abschnitt: 'Person' }]),
        { key: 'anrede', label: 'Anrede', type: 'select', options: ['Herr', 'Frau', 'Divers', 'Firma', 'Eheleute'], hideInTable: true, abschnitt: 'Person' },
        { key: 'titel', label: 'Titel', hideInTable: true, abschnitt: 'Person' },
        { key: 'vorname', label: 'Vorname', abschnitt: 'Person' },
        { key: 'nachname', label: 'Nachname', format: (v: any, r: any) => v ?? (r.firma ? <b>{r.firma}</b> : ''), abschnitt: 'Person' },
        { key: 'firma', label: 'Firma (falls Gewerbe)', hideInTable: true, abschnitt: 'Person' },
        { key: 'geburtsdatum', label: 'Geburtsdatum', type: 'date', hideInTable: true, abschnitt: 'Person' },
        { key: 'strasse', label: 'Straße', hideInTable: true, abschnitt: 'Anschrift', wide: true },
        { key: 'plz', label: 'PLZ', hideInTable: true, abschnitt: 'Anschrift' },
        { key: 'ort', label: 'Ort', hideInTable: rolle === 'Mieter', abschnitt: 'Anschrift' },
        { key: 'telefon', label: 'Telefon', abschnitt: 'Kontakt' },
        { key: 'mobil', label: 'Mobil', hideInTable: true, abschnitt: 'Kontakt' },
        { key: 'email', label: 'E-Mail', abschnitt: 'Kontakt', wide: true },
        { key: 'iban', label: 'IBAN', hideInTable: true, abschnitt: 'Bankverbindung' },
        { key: 'bic', label: 'BIC', hideInTable: true, abschnitt: 'Bankverbindung' },
        { key: 'notiz', label: 'Notiz', type: 'textarea', hideInTable: true, abschnitt: 'Notiz' },
        { key: 'objekte', label: 'Objekte / Einheiten', computed: true },
        ...(rolle === 'Mieter' ? [
          { key: 'seit', label: 'Mieter seit', type: 'date' as const, computed: true, format: (v: any) => v ? new Date(v + 'T00:00').toLocaleDateString('de-DE') : '–' },
          { key: 'kalt', label: 'Kaltmiete / Monat', type: 'number' as const, geld: true, computed: true, sum: true, format: (v: any) => v != null ? eur(v) : '–' },
          { key: 'nk_vz', label: 'NK-Vorausz. / Monat', type: 'number' as const, geld: true, computed: true, sum: true, format: (v: any) => v != null ? eur(v) : '–' },
          { key: 'hk_vz', label: 'HK-Vorausz. / Monat', type: 'number' as const, geld: true, computed: true, sum: true, format: (v: any) => v != null ? eur(v) : '–' }] : []),
      ]}
      listSql={`SELECT p.*, ${personLabel('p')} AS anzeigename,
          (SELECT GROUP_CONCAT(x, '; ') FROM (
            SELECT o.name || ' ' || e.nummer || ' (Eigentümer)' AS x FROM eigentum ei JOIN einheiten e ON e.id = ei.einheit_id
               JOIN objekte o ON o.id = e.objekt_id WHERE ei.person_id = p.id AND (ei.bis IS NULL OR ei.bis >= date('now'))
            UNION ALL SELECT o.name || ' (Eigentümer)' FROM objekte o WHERE o.eigentuemer_id = p.id
            UNION ALL SELECT o.name || ' ' || e.nummer || ' (Mieter)' FROM mietvertraege v JOIN einheiten e ON e.id = v.einheit_id
               JOIN objekte o ON o.id = e.objekt_id WHERE (v.mieter_id = p.id OR v.mieter2_id = p.id) AND (v.ende IS NULL OR v.ende >= date('now')))) AS objekte${rolle === 'Mieter' ? `,
          (SELECT MIN(v.beginn) FROM mietvertraege v WHERE (v.mieter_id = p.id OR v.mieter2_id = p.id) AND (v.ende IS NULL OR v.ende >= date('now'))) AS seit,
          (SELECT SUM(COALESCE((SELECT a.kaltmiete FROM mietanpassungen a WHERE a.vertrag_id = v.id AND a.kaltmiete IS NOT NULL AND a.gueltig_ab <= date('now') ORDER BY a.gueltig_ab DESC LIMIT 1), v.kaltmiete, 0))
            FROM mietvertraege v WHERE v.mieter_id = p.id AND v.beginn <= date('now') AND (v.ende IS NULL OR v.ende >= date('now'))) AS kalt,
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
      editExtra={(r) => <Schriftverkehr firmaId={r.id} />}
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
