// Datenbankzugriff. In der Desktop-App: SQLite-Datei über tauri-plugin-sql.
// Im Browser (Entwicklung/Vorschau): sql.js im Speicher, damit die Oberfläche auch ohne Tauri läuft.
import { MIGRATIONS } from './schema';

export type Row = Record<string, any>;
type Param = string | number | null;

interface Driver {
  select(sql: string, params: Param[]): Promise<Row[]>;
  execute(sql: string, params: Param[]): Promise<{ lastInsertId?: number; rowsAffected: number }>;
}

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function tauriDriver(): Promise<Driver> {
  const { default: Database } = await import('@tauri-apps/plugin-sql');
  const db = await Database.load('sqlite:kms-verwaltung.db');
  await db.execute('PRAGMA foreign_keys = ON');
  return {
    select: (sql, p) => db.select<Row[]>(sql, p),
    execute: async (sql, p) => {
      const r = await db.execute(sql, p);
      return { lastInsertId: r.lastInsertId, rowsAffected: r.rowsAffected };
    },
  };
}

async function browserDriver(): Promise<Driver> {
  const initSqlJs = (await import('sql.js')).default;
  const wasmUrl = (await import('sql.js/dist/sql-wasm.wasm?url')).default;
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  return {
    select: async (sql, p) => {
      const stmt = db.prepare(sql);
      stmt.bind(p);
      const rows: Row[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
    execute: async (sql, p) => {
      if (p.length) db.run(sql, p);
      else db.exec(sql);
      const id = db.exec('SELECT last_insert_rowid()')[0]?.values[0][0] as number;
      return { lastInsertId: id, rowsAffected: db.getRowsModified() };
    },
  };
}

let ready: Promise<Driver> | null = null;

async function migrate(d: Driver) {
  await d.execute('CREATE TABLE IF NOT EXISTS _schema (version INTEGER NOT NULL)', []);
  const rows = await d.select('SELECT MAX(version) AS v FROM _schema', []);
  const current = Number(rows[0]?.v ?? 0);
  for (let i = current; i < MIGRATIONS.length; i++) {
    await d.execute(MIGRATIONS[i], []);
    await d.execute('INSERT INTO _schema (version) VALUES ($1)', [i + 1]);
  }
  if (!isTauri && current === 0) await seedDemo(d);
}

function driver(): Promise<Driver> {
  if (!ready) ready = (isTauri ? tauriDriver() : browserDriver()).then(async (d) => { await migrate(d); return d; });
  return ready;
}

export const db = {
  async select<T = Row>(sql: string, params: Param[] = []): Promise<T[]> {
    return (await driver()).select(sql, params) as Promise<T[]>;
  },
  async execute(sql: string, params: Param[] = []) {
    return (await driver()).execute(sql, params);
  },
  isDemo: !isTauri,
};

// Einfache Tabellen-Helfer
export async function insert(table: string, values: Row): Promise<number> {
  const keys = Object.keys(values);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')})`;
  const r = await db.execute(sql, keys.map((k) => values[k]));
  return r.lastInsertId ?? 0;
}
export async function update(table: string, id: number, values: Row) {
  const keys = Object.keys(values);
  const sql = `UPDATE ${table} SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1}`;
  await db.execute(sql, [...keys.map((k) => values[k]), id]);
}
export async function remove(table: string, id: number) {
  await db.execute(`DELETE FROM ${table} WHERE id = $1`, [id]);
}

// Beispieldaten nur für die Browser-Vorschau
async function seedDemo(d: Driver) {
  const ex = (s: string) => d.execute(s, []);
  await ex(`INSERT INTO personen (rolle, anrede, vorname, nachname, ort, telefon, email, iban) VALUES
    ('Eigentümer','Herr','Ahmet','Yilmaz','Köln','0221 123456','yilmaz@example.de','DE02120300000000202051'),
    ('Mieter','Frau','Anna','Schmidt','Köln','0170 111111','schmidt@example.de',NULL),
    ('Mieter','Herr','Jonas','Becker','Köln','0170 222222',NULL,NULL),
    ('Mieter','Firma',NULL,NULL,'Köln',NULL,NULL,NULL),
    ('Eigentümer','Frau','Maria','Wagner','Bonn','0228 55555','wagner@example.de',NULL),
    ('Eigentümer','Herr','Peter','Hoffmann','Köln',NULL,NULL,NULL),
    ('Mieter','Herr','Luca','Romano','Köln',NULL,NULL,NULL)`);
  await ex(`UPDATE personen SET firma='Bäckerei Krüger GmbH' WHERE id=4`);
  await ex(`INSERT INTO firmen (name, gewerk, ansprechpartner, ort, telefon, email) VALUES
    ('Sanitär Özdemir GmbH','Sanitär / Heizung','Hr. Özdemir','Köln','0221 987654','info@example.de'),
    ('Hausmeisterservice Rhein','Hausmeister','Fr. Klein','Köln','0221 444444',NULL),
    ('ista Deutschland','Messdienst',NULL,'Essen',NULL,NULL)`);
  await ex(`INSERT INTO objekte (verwaltungsart, name, strasse, plz, ort, baujahr, gesamt_mea, heizungsart, eigentuemer_id) VALUES
    ('Mietverwaltung','Lindenstraße 12','Lindenstraße 12','50674','Köln',1965,1000,'Gas-Zentralheizung',1),
    ('WEG','WEG Rheinblick','Rheinuferstraße 5','50668','Köln',1998,1000,'Fernwärme',NULL)`);
  await ex(`INSERT INTO einheiten (objekt_id, nummer, typ, lage, flaeche, mea) VALUES
    (1,'WE 01','Wohnung','EG links',62.5,250),(1,'WE 02','Wohnung','EG rechts',78,300),
    (1,'WE 03','Wohnung','1. OG',95,350),(1,'Laden','Gewerbe','EG Straße',40,100),
    (2,'WE 1','Wohnung','EG',71,330),(2,'WE 2','Wohnung','1. OG',71,330),(2,'WE 3','Wohnung','DG',75,340)`);
  await ex(`INSERT INTO eigentum (einheit_id, person_id, anteil, von) VALUES
    (5,5,100,'2015-01-01'),(6,6,100,'2018-05-01'),(7,1,100,'2020-01-01')`);
  await ex(`INSERT INTO beiraete (objekt_id, person_id, funktion) VALUES (2,5,'Vorsitz')`);
  await ex(`UPDATE einheiten SET personenzahl = CASE id WHEN 5 THEN 2 WHEN 6 THEN 1 WHEN 7 THEN 3 END WHERE objekt_id = 2`);
  await ex(`INSERT INTO hausgeld (einheit_id, gueltig_ab, betrag, davon_ruecklage) VALUES
    (5,'2024-01-01',310,80),(6,'2024-01-01',310,80),(7,'2024-01-01',325,85)`);
  await ex(`INSERT INTO mietvertraege (einheit_id, mieter_id, beginn, ende, kaltmiete, nk_vorauszahlung, hk_vorauszahlung, kaution, personenzahl, ust_satz, mietart) VALUES
    (1,2,'2024-04-01',NULL,620,140,80,1860,1,0,'Standard'),
    (2,3,'2025-08-01','2026-12-31',790,170,95,2370,3,0,'Staffelmiete'),
    (4,4,'2023-01-01',NULL,900,120,60,2700,0,19,'Indexmiete'),
    (6,7,'2026-03-01',NULL,700,150,90,2100,2,0,'Standard')`);
  await ex(`INSERT INTO bankkonten (objekt_id, name, bank, iban) VALUES
    (1,'Mietkonto Lindenstraße','Sparkasse KölnBonn','DE11370501980000000001'),
    (2,'WEG-Konto Rheinblick','Volksbank Köln Bonn','DE22380601860000000002')`);
  // Kosten 2025 für die Beispiel-Abrechnungen
  const k = async (nr: string) => (await d.select('SELECT id FROM buchungskonten WHERE nummer = $1', [nr]))[0].id;
  const rech: [number, string, string, number, number | null][] = [
    [1, '1220', '2025-02-15', 1240, null], [1, '1215', '2025-12-10', 2380, null], [1, '1222', '2025-03-01', 960, null],
    [1, '1246', '2025-12-31', 1800, 2], [1, '1250', '2025-01-20', 1150, null], [1, '1200', '2025-12-31', 6200, 3],
    [1, '1243', '2025-12-31', 720, 2], [1, '1300', '2025-06-12', 840, 1], [1, '1400', '2025-12-31', 1440, null],
    [2, '1220', '2025-02-15', 980, null], [2, '1250', '2025-01-20', 890, null], [2, '1246', '2025-12-31', 1500, 2],
    [2, '1200', '2025-12-31', 4300, 3], [2, '1400', '2025-12-31', 1080, null], [2, '1300', '2025-09-01', 2100, 1],
  ];
  for (const [o, nr, dt, betrag, firma] of rech) {
    await d.execute('INSERT INTO rechnungen (objekt_id, datum, betrag, buchungskonto_id, firma_id, bezahlt_am) VALUES ($1, $2, $3, $4, $5, $2)',
      [o, dt, betrag, await k(nr), firma]);
  }
  await ex(`UPDATE eigentum SET von = '2015-01-01'`);
  await ex(`INSERT INTO mietanpassungen (vertrag_id, gueltig_ab, art, kaltmiete) VALUES (2,'2026-08-01','Staffel',820)`);
}
