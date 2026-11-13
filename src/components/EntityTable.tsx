// Wiederverwendbare Liste mit Formular zum Anlegen, Bearbeiten und Löschen.
import { BetragFeld } from './BetragFeld';
import { betragZahl, euro } from '../lib/betrag';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { FileDown, Pencil } from 'lucide-react';
import { db, insert, remove, update, type Row } from '../db';

export type FieldType = 'text' | 'number' | 'date' | 'time' | 'select' | 'textarea' | 'checkbox';

export interface Field {
  key: string;
  label: string;
  type?: FieldType;
  options?: string[] | { value: string | number; label: string }[];
  /** SQL, das Optionen als (value, label) liefert */
  optionsSql?: string;
  required?: boolean;
  hideInTable?: boolean;
  format?: (v: any, row: Row) => ReactNode;
  wide?: boolean;
  /** Nur Anzeige in der Tabelle (berechnet), nicht im Formular */
  computed?: boolean;
  /** Summe in der Fußzeile bilden */
  sum?: boolean;
  /** Text der leeren Auswahl (Standard: – bitte wählen –) */
  leer?: string;
  /** Geldbetrag: Eingabe mit €, Anzeige 1.234,00 €, Minusbeträge rot */
  geld?: boolean;
  /** bei geld: Minusbeträge nicht rot färben */
  minusNeutral?: boolean;
}

interface Props {
  title: string;
  table: string;
  fields: Field[];
  /** Abfrage für die Liste; muss eine Spalte id enthalten */
  listSql: string;
  listParams?: (string | number)[];
  /** Feste Werte für neue Datensätze (z. B. objekt_id) */
  fixed?: Row;
  onOpen?: (row: Row) => void;
  emptyText?: string;
  onChange?: () => void;
  /** Spalte, nach der Zwischenüberschriften gebildet werden */
  groupBy?: string;
  /** Beschriftung des Knopfs zum Anlegen */
  newLabel?: string;
  icon?: ReactNode;
  /** Eigener Ablauf statt Formular beim Anlegen (z. B. Assistent) */
  onNew?: () => void;
  /** Eigener Ablauf beim Löschen (z. B. mit Bestätigungsfeld) */
  onDelete?: (row: Row) => void;
  /** Ändert sich der Wert, wird die Liste neu geladen */
  version?: number;
  /** Zusätzliche CSS-Klasse je Zeile, z. B. Farbe nach Rolle */
  rowClass?: (row: Row) => string | undefined;
}

type Opt = { value: string | number; label: string };

export function EntityTable({ title, table, fields, listSql, listParams = [], fixed, onOpen, emptyText, onChange, groupBy, newLabel, icon, onNew, onDelete, version, rowClass }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [editing, setEditing] = useState<Row | null>(null);
  const [opts, setOpts] = useState<Record<string, Opt[]>>({});
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setRows(await db.select(listSql, listParams));
  }, [listSql, JSON.stringify(listParams), version]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    (async () => {
      const o: Record<string, Opt[]> = {};
      for (const f of fields) {
        if (f.optionsSql) o[f.key] = await db.select<Opt>(f.optionsSql);
        else if (f.options) o[f.key] = f.options.map((x) => (typeof x === 'string' ? { value: x, label: x } : x));
      }
      setOpts(o);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!editing]);

  const formFields = fields.filter((f) => !f.computed);

  async function save() {
    if (!editing) return;
    setError('');
    for (const f of formFields) {
      if (f.required && (editing[f.key] === undefined || editing[f.key] === null || editing[f.key] === '')) {
        setError(`Bitte „${f.label}“ ausfüllen.`);
        return;
      }
    }
    const values: Row = {};
    for (const f of formFields) {
      let v = editing[f.key];
      if (v === '' || v === undefined) v = null;
      if (f.type === 'number' && v !== null) {
        const n = betragZahl(v);
        if (n === null) { setError(`„${f.label}“ ist keine gültige Zahl.`); return; }
        v = n;
      }
      if (f.type === 'checkbox') v = v ? 1 : 0;
      values[f.key] = v;
    }
    try {
      if (editing.id) await update(table, editing.id, values);
      else await insert(table, { ...values, ...fixed });
      setEditing(null);
      await load();
      onChange?.();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  async function del() {
    if (!editing?.id) return;
    if (onDelete) { const r = editing; setEditing(null); onDelete(r); return; }
    if (!window.confirm('Datensatz wirklich löschen?')) return;
    try {
      await remove(table, editing.id);
      setEditing(null);
      await load();
      onChange?.();
    } catch (e: any) {
      setError('Löschen nicht möglich: Der Datensatz wird noch verwendet.');
    }
  }

  const shown = fields.filter((f) => !f.hideInTable);
  const needle = filter.trim().toLowerCase();
  const visible = needle ? rows.filter((r) => Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(needle))) : rows;

  const display = (f: Field, r: Row) => {
    const v = r[f.key + '_label'] ?? r[f.key];
    if (f.format) return f.format(r[f.key], r);
    if (f.type === 'number' && v !== null && v !== undefined) return num(v);
    if (f.type === 'date') return datum(v);
    if (f.type === 'checkbox') return v ? 'Ja' : 'Nein';
    return v ?? '';
  };

  // Liste als PDF: genau die sichtbaren Spalten und Zeilen (inkl. Suchfilter)
  const karte = useRef<HTMLElement>(null);
  const alsPdf = async () => {
    const t = karte.current?.querySelector('table.list'); if (!t) return;
    const txt = (el: Element) => (el as HTMLElement).innerText.replace(/\s*\n\s*/g, ' ').trim();
    const ths = [...t.querySelectorAll('thead th')];
    const nutz = ths.map((th, i) => (txt(th) && !th.classList.contains('wahl') ? i : -1)).filter((i) => i >= 0);
    const zeile = (tr: Element) => { const c = [...tr.children]; return nutz.map((i) => (c[i] ? txt(c[i]) : '')); };
    const rechts = nutz.map((i, j) => (ths[i].classList.contains('num') ? j : -1)).filter((j) => j >= 0);
    const body = [...t.querySelectorAll('tbody tr')].filter((tr) => !tr.classList.contains('sum')).map(zeile);
    const fuss = [...t.querySelectorAll('tfoot tr, tbody tr.sum')].map(zeile);
    const { listePdf } = await import('../lib/pdf');
    const { oeffnen, speichern } = await import('../lib/dateien');
    const heute = new Date().toLocaleDateString('de-DE');
    const bytes = await listePdf(title, `Stand ${heute} · ${body.length} Einträge${filter ? ` · Suche „${filter}“` : ''}`, nutz.map((i) => txt(ths[i])), body, fuss.length ? fuss : undefined, rechts);
    oeffnen(await speichern(bytes, `${title} ${new Date().toISOString().slice(0, 10)}.pdf`, { bezug: 'Objekt', bezugId: 0, ordner: ['Berichte'] }));
  };

  return (
    <section className="card" ref={karte}>
      <div className="card-head">
        <h2 className="title-ico">{icon}{title}</h2>
        <div className="row">
          <input className="search" placeholder="Suchen…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          {visible.length > 0 && <button onClick={alsPdf} title="Liste als PDF"><FileDown size={16} />PDF</button>}
          <button className="primary" onClick={() => (onNew ? onNew() : setEditing({}))}>+ {newLabel ?? 'Neu'}</button>
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="muted">{emptyText ?? 'Noch keine Einträge.'}</p>
      ) : (
        <div className="tablewrap"><table className="list">
          <thead>
            <tr>{shown.map((f) => <th key={f.key} className={f.type === 'number' ? 'num' : ''}>{f.label}</th>)}<th /></tr>
          </thead>
          <tbody>
            {visible.map((r, i) => [
              groupBy && (i === 0 || visible[i - 1][groupBy] !== r[groupBy]) ? (
                <tr key={'g' + r.id} className="group"><td colSpan={shown.length + 1}>{r[groupBy] ?? 'Ohne Gruppe'}</td></tr>
              ) : null,
              <tr key={r.id} onClick={() => (onOpen ? onOpen(r) : setEditing(r))} className={'clickable' + (rowClass?.(r) ? ' ' + rowClass(r) : '')}>
                {shown.map((f) => <td key={f.key} className={f.type === 'number' ? 'num' + (f.geld && !f.minusNeutral && Number(r[f.key]) < -0.004 ? ' neg' : '') : ''}>{display(f, r)}</td>)}
                <td className="actions">
                  <button className="icon-btn" title="Bearbeiten" onClick={(e) => { e.stopPropagation(); setEditing(r); }}><Pencil size={17} /></button>
                </td>
              </tr>,
            ])}
          </tbody>
          {shown.some((f) => f.sum) && (
            <tfoot><tr>
              {shown.map((f, i) => {
                if (f.sum) {
                  const t = visible.reduce((a, r) => a + (Number(r[f.key]) || 0), 0);
                  return <td key={f.key} className="num">{f.format ? f.format(t, {}) : num(t)}</td>;
                }
                return <td key={f.key}>{i === 0 ? 'Summe' : i === 1 ? `${visible.length} Einträge` : ''}</td>;
              })}<td />
            </tr></tfoot>)}
        </table></div>
      )}

      {editing && (
        <div className="modal-bg" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editing.id ? `${title}: bearbeiten` : `${title}: neu anlegen`}</h3>
            <div className="form" onKeyDown={(e) => { if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); save(); } }}>
              {formFields.map((f) => (
                <label key={f.key} className={f.wide || f.type === 'textarea' ? 'wide' : ''}>
                  <span>{f.label}{f.required ? ' *' : ''}</span>
                  <Input f={f} value={editing[f.key]} opts={opts[f.key]} onChange={(v) => setEditing({ ...editing, [f.key]: v })} />
                </label>
              ))}
            </div>
            {error && <p className="error">{error}</p>}
            <div className="row end">
              {editing.id && <button className="danger" onClick={del}>Löschen</button>}
              <span className="grow" />
              <button onClick={() => setEditing(null)}>Abbrechen</button>
              <button className="primary" onClick={save}>Speichern</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Input({ f, value, opts, onChange }: { f: Field; value: any; opts?: Opt[]; onChange: (v: any) => void }) {
  const v = value ?? '';
  switch (f.type) {
    case 'select':
      return (
        <select value={v} onChange={(e) => onChange(e.target.value)}>
          <option value="">{f.leer ?? '– bitte wählen –'}</option>
          {(opts ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case 'textarea':
      return <textarea rows={4} value={v} onChange={(e) => onChange(e.target.value)} />;
    case 'checkbox':
      return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
    case 'number':
      if (f.geld) return <BetragFeld value={value} onChange={(e) => onChange(e.target.value)} />;
      return <input inputMode="decimal" value={typeof value === 'number' ? String(value).replace('.', ',') : v} onChange={(e) => onChange(e.target.value)} />;
    case 'date':
      return <input type="date" value={v} onChange={(e) => onChange(e.target.value)} />;
    case 'time':
      return <input type="time" value={v} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <input value={v} onChange={(e) => onChange(e.target.value)} />;
  }
}

export const num = (v: any, digits = 2) =>
  v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
/** Geldbetrag immer als 1.234,00 € */
export const eur = (v: any) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? '' : euro(Number(v)));
/** CSS-Klasse für ein Abrechnungsergebnis: positiv = Nachzahlung (rot), negativ = Guthaben (grün) */
export const farbe = (n: number) => (n > 0.005 ? 'neg' : n < -0.005 ? 'pos' : '');
export const datum = (v: any) => (v ? new Date(v + 'T00:00:00').toLocaleDateString('de-DE') : '');
