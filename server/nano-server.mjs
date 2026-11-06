// NANO-Server: zentrale Datenbank für mehrere Arbeitsplätze (z. B. auf der Synology-NAS im Docker-Container).
// Hält die SQLite-Datenbank, prüft Anmeldung und Rollen und schreibt jede Änderung ins Protokoll.
// Start: node nano-server.mjs   (Node 22.13 oder neuer, keine weiteren Pakete nötig)
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const VERSION = '1.0.0';
const PORT = Number(process.env.PORT || 8080);
const DATEN = process.env.NANO_DATEN || './daten';
const SICHERUNGEN = join(DATEN, 'sicherungen');
const BEHALTEN = Number(process.env.NANO_SICHERUNGEN_BEHALTEN || 30);
const SITZUNG_STUNDEN = Number(process.env.NANO_SITZUNG_STUNDEN || 12);
mkdirSync(SICHERUNGEN, { recursive: true });

const db = new DatabaseSync(join(DATEN, 'nano.db'));
db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS _benutzer (
  id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
  rolle TEXT NOT NULL DEFAULT 'mitarbeiter', hash TEXT NOT NULL, aktiv INTEGER NOT NULL DEFAULT 1,
  angelegt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')), letzte_anmeldung TEXT);
CREATE TABLE IF NOT EXISTS _protokoll (
  id INTEGER PRIMARY KEY AUTOINCREMENT, zeit TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  benutzer TEXT NOT NULL, aktion TEXT NOT NULL, tabelle TEXT, sql TEXT, werte TEXT);`);

// ---------- Passwörter ----------
const hashen = (pw) => { const salt = randomBytes(16); return `scrypt$${salt.toString('hex')}$${scryptSync(pw, salt, 64).toString('hex')}`; };
const pruefen = (pw, h) => {
  const [, salt, soll] = String(h).split('$');
  if (!salt || !soll) return false;
  const ist = scryptSync(pw, Buffer.from(salt, 'hex'), 64);
  return timingSafeEqual(ist, Buffer.from(soll, 'hex'));
};
const ROLLEN = ['admin', 'mitarbeiter', 'lesend'];

// Erster Start: Administrator anlegen (Passwort aus NANO_ADMIN_PASSWORT oder zufällig, steht dann im Log)
if (!db.prepare('SELECT COUNT(*) AS n FROM _benutzer').get().n) {
  const pw = process.env.NANO_ADMIN_PASSWORT || randomBytes(6).toString('base64url');
  db.prepare(`INSERT INTO _benutzer (login, name, rolle, hash) VALUES ('admin', 'Administrator', 'admin', ?)`).run(hashen(pw));
  console.log(`\n  Erster Start: Benutzer "admin" angelegt.${process.env.NANO_ADMIN_PASSWORT ? '' : ` Passwort: ${pw}`}\n  Bitte nach der ersten Anmeldung in NANO ändern.\n`);
}

// Notfall: Administrator-Passwort zurücksetzen (NANO_ADMIN_ZURUECKSETZEN=1 und NANO_ADMIN_PASSWORT setzen, danach wieder entfernen)
if (process.env.NANO_ADMIN_ZURUECKSETZEN === '1' && process.env.NANO_ADMIN_PASSWORT) {
  db.prepare(`UPDATE _benutzer SET hash = ?, aktiv = 1, rolle = 'admin' WHERE login = 'admin'`).run(hashen(process.env.NANO_ADMIN_PASSWORT));
  console.log('  Passwort von "admin" wurde zurückgesetzt. Bitte NANO_ADMIN_ZURUECKSETZEN wieder entfernen.');
}

// ---------- Sitzungen (im Speicher, nach Neustart neu anmelden) ----------
const sitzungen = new Map();   // token -> { id, login, name, rolle, bis }
const fehlversuche = new Map(); // ip -> { n, bis }
function sitzung(req) {
  const t = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const s = t && sitzungen.get(t);
  if (!s || s.bis < Date.now()) { if (s) sitzungen.delete(t); return null; }
  s.bis = Date.now() + SITZUNG_STUNDEN * 3600e3;
  return { ...s, token: t };
}

// ---------- SQL ----------
let stand = 0;   // Änderungszähler, damit Arbeitsplätze sehen, dass sich etwas geändert hat
const binden = (sql) => sql.replace(/\$(\d+)/g, '?$1');
const werte = (p) => (Array.isArray(p) ? p : []).map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v));
const tabelleVon = (sql) => (sql.match(/^\s*(?:insert\s+(?:or\s+\w+\s+)?into|update|delete\s+from|replace\s+into)\s+["`]?(\w+)/i) || [])[1] || null;
const GESCHUETZT = /\b_benutzer\b|\b_protokoll\b|\battach\b|\bdetach\b|\bload_extension\b|\bvacuum\s+into\b/i;

function protokoll(s, aktion, sql, p) {
  db.prepare('INSERT INTO _protokoll (benutzer, aktion, tabelle, sql, werte) VALUES (?, ?, ?, ?, ?)')
    .run(s.login, aktion, sql ? tabelleVon(sql) : null, sql ? sql.slice(0, 2000) : null, p ? JSON.stringify(p).slice(0, 4000) : null);
}
function auswahl(sql, p) { return db.prepare(binden(sql)).all(...werte(p)); }
function ausfuehren(sql, p) {
  const w = werte(p);
  if (!w.length && /;\s*\S/.test(sql.trim().replace(/;\s*$/, ''))) { db.exec(sql); return { rowsAffected: 0, lastInsertId: Number(db.prepare('SELECT last_insert_rowid() AS id').get().id) }; }
  const r = db.prepare(binden(sql)).run(...w);
  return { rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
}

// ---------- Sicherung: täglich und vor jeder Datenübernahme ----------
function sicherung(grund = 'taeglich') {
  const name = `nano_${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}_${grund}.db`;
  db.exec(`VACUUM INTO '${join(SICHERUNGEN, name).replace(/'/g, "''")}'`);
  const alle = readdirSync(SICHERUNGEN).filter((f) => f.endsWith('.db')).sort();
  for (const f of alle.slice(0, Math.max(0, alle.length - BEHALTEN))) rmSync(join(SICHERUNGEN, f));
  return name;
}
function taeglich() { const heute = new Date().toISOString().slice(0, 10); if (!readdirSync(SICHERUNGEN).some((f) => f.startsWith(`nano_${heute}`))) sicherung(); }
taeglich(); setInterval(taeglich, 3600e3).unref();

// ---------- HTTP ----------
const antwort = (res, code, daten) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' });
  res.end(JSON.stringify(daten));
};
const lesen = (req) => new Promise((ok, fehler) => {
  let n = 0; const teile = [];
  req.on('data', (c) => { n += c.length; if (n > 50e6) { fehler(new Error('Anfrage zu groß')); req.destroy(); } else teile.push(c); });
  req.on('end', () => { try { ok(teile.length ? JSON.parse(Buffer.concat(teile).toString('utf8')) : {}); } catch { fehler(new Error('Ungültige Anfrage')); } });
});

const routen = {
  'GET /api/info': () => ({ name: 'NANO-Server', version: VERSION }),

  'POST /api/anmelden': (b, _s, req) => {
    const ip = req.socket.remoteAddress || '';
    const f = fehlversuche.get(ip);
    if (f && f.n >= 5 && f.bis > Date.now()) throw Object.assign(new Error('Zu viele Fehlversuche. Bitte 5 Minuten warten.'), { code: 429 });
    const u = db.prepare('SELECT * FROM _benutzer WHERE login = ? AND aktiv = 1').get(String(b.login || ''));
    if (!u || !pruefen(String(b.passwort || ''), u.hash)) {
      fehlversuche.set(ip, { n: (f && f.bis > Date.now() ? f.n : 0) + 1, bis: Date.now() + 5 * 60e3 });
      throw Object.assign(new Error('Benutzername oder Passwort ist falsch.'), { code: 401 });
    }
    fehlversuche.delete(ip);
    const token = randomBytes(32).toString('hex');
    sitzungen.set(token, { id: u.id, login: u.login, name: u.name, rolle: u.rolle, bis: Date.now() + SITZUNG_STUNDEN * 3600e3 });
    db.prepare(`UPDATE _benutzer SET letzte_anmeldung = datetime('now', 'localtime') WHERE id = ?`).run(u.id);
    protokoll(u, 'Anmeldung');
    return { token, name: u.name, login: u.login, rolle: u.rolle };
  },
  'POST /api/abmelden': (_b, s) => { sitzungen.delete(s.token); return { ok: true }; },
  'GET /api/ich': (_b, s) => ({ name: s.name, login: s.login, rolle: s.rolle }),
  'GET /api/stand': () => ({ stand }),

  'POST /api/select': (b) => {
    if (GESCHUETZT.test(b.sql)) throw Object.assign(new Error('Nicht erlaubt.'), { code: 403 });
    return auswahl(String(b.sql), b.params);
  },
  'POST /api/lesend': (b) => {
    const st = db.prepare(String(b.sql));
    if (GESCHUETZT.test(b.sql) || !/^\s*(select|with)\b/i.test(b.sql)) throw Object.assign(new Error('Nur lesende Abfragen (SELECT) sind erlaubt.'), { code: 403 });
    return st.all();
  },
  'POST /api/execute': (b, s) => {
    if (s.rolle === 'lesend') throw Object.assign(new Error('Dein Zugang darf nur lesen.'), { code: 403 });
    const sql = String(b.sql);
    if (GESCHUETZT.test(sql)) throw Object.assign(new Error('Nicht erlaubt.'), { code: 403 });
    const schema = /^\s*(create|alter|drop)\b/im.test(sql) && !/^\s*(insert|update|delete)\b/i.test(sql) && !/^\s*create table if not exists _schema\b/i.test(sql);
    if (schema && s.rolle !== 'admin') throw Object.assign(new Error('Datenbank-Aktualisierungen darf nur ein Administrator ausführen. Bitte zuerst als admin anmelden.'), { code: 403 });
    const r = ausfuehren(sql, b.params);
    if (!/^\s*(insert into _schema|create table if not exists _schema)/i.test(sql)) protokoll(s, schema ? 'Schema' : 'Änderung', sql, b.params);
    stand++;
    return r;
  },

  // Einmalige Übernahme der Daten eines Arbeitsplatzes (nur Administrator, ersetzt die Tabelle)
  'POST /api/import': (b, s) => {
    if (s.rolle !== 'admin') throw Object.assign(new Error('Nur für Administratoren.'), { code: 403 });
    const t = String(b.tabelle || '');
    if (!/^\w+$/.test(t) || t.startsWith('_') || t === 'sqlite_sequence') throw new Error('Ungültige Tabelle');
    const zeilen = Array.isArray(b.zeilen) ? b.zeilen : [];
    const spalten = db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
    if (!spalten.length) throw new Error(`Tabelle ${t} gibt es auf dem Server nicht. Bitte zuerst NANO als admin mit dem Server verbinden.`);
    if (b.erste) { if (b.sicherung) sicherung('vor-import'); db.exec('PRAGMA foreign_keys = OFF'); }
    db.exec('BEGIN');
    try {
      if (b.erste_der_tabelle !== false) db.exec(`DELETE FROM "${t}"`);
      for (const z of zeilen) {
        const k = Object.keys(z).filter((x) => spalten.includes(x));
        db.prepare(`INSERT INTO "${t}" (${k.map((x) => `"${x}"`).join(',')}) VALUES (${k.map(() => '?').join(',')})`).run(...k.map((x) => z[x]));
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); db.exec('PRAGMA foreign_keys = ON'); throw e; }
    if (b.letzte) { db.exec('PRAGMA foreign_keys = ON'); protokoll(s, 'Datenübernahme'); }
    stand++;
    return { ok: true, zeilen: zeilen.length };
  },

  // Benutzerverwaltung
  'GET /api/benutzer': (_b, s) => { admin(s); return db.prepare('SELECT id, login, name, rolle, aktiv, angelegt, letzte_anmeldung FROM _benutzer ORDER BY name').all(); },
  'POST /api/benutzer': (b, s) => {
    admin(s);
    const rolle = ROLLEN.includes(b.rolle) ? b.rolle : 'mitarbeiter';
    if (b.id) {
      const u = db.prepare('SELECT * FROM _benutzer WHERE id = ?').get(Number(b.id));
      if (!u) throw new Error('Benutzer nicht gefunden');
      if (u.rolle === 'admin' && (rolle !== 'admin' || !b.aktiv) && db.prepare(`SELECT COUNT(*) AS n FROM _benutzer WHERE rolle = 'admin' AND aktiv = 1`).get().n <= 1)
        throw new Error('Es muss mindestens ein aktiver Administrator bleiben.');
      db.prepare('UPDATE _benutzer SET name = ?, rolle = ?, aktiv = ? WHERE id = ?').run(String(b.name || u.name), rolle, b.aktiv ? 1 : 0, u.id);
      if (b.passwort) db.prepare('UPDATE _benutzer SET hash = ? WHERE id = ?').run(hashen(passwortOk(b.passwort)), u.id);
      if (!b.aktiv || b.passwort) for (const [t, x] of sitzungen) if (x.id === u.id && t !== s.token) sitzungen.delete(t);
      protokoll(s, `Benutzer geändert: ${u.login}`);
      return { ok: true };
    }
    const login = String(b.login || '').trim();
    if (!/^[\w.-]{2,40}$/.test(login)) throw new Error('Benutzername: 2–40 Zeichen, nur Buchstaben, Ziffern, Punkt und Bindestrich.');
    db.prepare('INSERT INTO _benutzer (login, name, rolle, hash) VALUES (?, ?, ?, ?)').run(login, String(b.name || login), rolle, hashen(passwortOk(b.passwort)));
    protokoll(s, `Benutzer angelegt: ${login}`);
    return { ok: true };
  },
  'POST /api/passwort': (b, s) => {
    const u = db.prepare('SELECT * FROM _benutzer WHERE id = ?').get(s.id);
    if (!pruefen(String(b.alt || ''), u.hash)) throw Object.assign(new Error('Das bisherige Passwort stimmt nicht.'), { code: 403 });
    db.prepare('UPDATE _benutzer SET hash = ? WHERE id = ?').run(hashen(passwortOk(b.neu)), s.id);
    protokoll(s, 'Passwort geändert');
    return { ok: true };
  },
  'GET /api/protokoll': (_b, s, _r, url) => {
    admin(s);
    const n = Math.min(1000, Number(url.searchParams.get('n')) || 200);
    return db.prepare('SELECT id, zeit, benutzer, aktion, tabelle, werte FROM _protokoll ORDER BY id DESC LIMIT ?').all(n);
  },
  'POST /api/sicherung': (_b, s) => { admin(s); return { datei: sicherung('manuell') }; },
};
function admin(s) { if (s.rolle !== 'admin') throw Object.assign(new Error('Nur für Administratoren.'), { code: 403 }); }
function passwortOk(pw) { pw = String(pw || ''); if (pw.length < 8) throw new Error('Das Passwort muss mindestens 8 Zeichen haben.'); return pw; }
const OFFEN = new Set(['GET /api/info', 'POST /api/anmelden']);

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return antwort(res, 204, {});
  const url = new URL(req.url || '/', 'http://x');
  const schluessel = `${req.method} ${url.pathname}`;
  const f = routen[schluessel];
  if (!f) return antwort(res, 404, { fehler: 'Unbekannte Adresse' });
  try {
    const s = OFFEN.has(schluessel) ? null : sitzung(req);
    if (!OFFEN.has(schluessel) && !s) return antwort(res, 401, { fehler: 'Bitte neu anmelden.' });
    const b = req.method === 'POST' ? await lesen(req) : {};
    antwort(res, 200, await f(b, s, req, url));
  } catch (e) {
    antwort(res, e.code && Number.isInteger(e.code) ? e.code : 400, { fehler: e.message || String(e) });
  }
}).listen(PORT, () => console.log(`NANO-Server ${VERSION} läuft auf Port ${PORT}, Daten in ${DATEN}`));

process.on('SIGTERM', () => { db.close(); process.exit(0); });
