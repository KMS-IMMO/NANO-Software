// Interner Chat für Mitarbeiter, rechts im Dashboard.
// Nachrichten liegen in der Datenbank (Tabelle chat). Arbeiten mehrere Rechner auf derselben Datenbank, sehen alle die Nachrichten.
import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Send, ChevronRight, ChevronLeft, Trash2 } from 'lucide-react';
import { db, type Row } from '../db';

const NAME_KEY = 'chat_name';
const ZU_KEY = 'nano-chat-zu';

function zeitText(z: string) {
  const d = new Date(z.replace(' ', 'T'));
  if (isNaN(+d)) return z;
  const heute = new Date().toDateString() === d.toDateString();
  return heute ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export function InternChat() {
  const [zu, setZu] = useState(() => { try { return localStorage.getItem(ZU_KEY) === '1'; } catch { return false; } });
  const [name, setName] = useState('');
  const [nameEdit, setNameEdit] = useState(false);
  const [msgs, setMsgs] = useState<Row[]>([]);
  const [text, setText] = useState('');
  const liste = useRef<HTMLDivElement>(null);

  const load = () => db.select('SELECT * FROM chat ORDER BY id DESC LIMIT 200').then((r) => setMsgs(r.reverse()));
  useEffect(() => {
    db.select('SELECT wert FROM einstellungen WHERE schluessel = $1', [NAME_KEY]).then((r) => { const n = r[0]?.wert ?? ''; setName(n); setNameEdit(!n); });
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { liste.current?.scrollTo({ top: liste.current.scrollHeight }); }, [msgs.length, zu]);
  const umschalten = () => { const n = !zu; setZu(n); try { localStorage.setItem(ZU_KEY, n ? '1' : '0'); } catch { /* egal */ } };

  async function nameSpeichern() {
    const n = name.trim(); if (!n) return;
    await db.execute('INSERT INTO einstellungen (schluessel, wert) VALUES ($1, $2) ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert', [NAME_KEY, n]);
    setName(n); setNameEdit(false);
  }
  async function senden() {
    const t = text.trim(); if (!t || !name.trim()) return;
    await db.execute('INSERT INTO chat (autor, text) VALUES ($1, $2)', [name.trim(), t]);
    setText(''); load();
  }
  async function loeschen(m: Row) {
    if (!confirm('Nachricht löschen?')) return;
    await db.execute('DELETE FROM chat WHERE id = $1', [m.id]); load();
  }

  if (zu) return (
    <aside className="ichat zu"><button className="icon-btn" title="Team-Chat öffnen" onClick={umschalten}><ChevronLeft size={18} /></button>
      <button className="ichat-zu-btn" onClick={umschalten} title="Team-Chat öffnen"><MessageSquare size={18} /><span>Team-Chat</span></button></aside>);

  return (
    <aside className="ichat card">
      <div className="ichat-kopf"><MessageSquare size={18} /><b>Team-Chat</b><span className="grow" />
        {!nameEdit && <button className="link small" onClick={() => setNameEdit(true)} title="Namen ändern">{name}</button>}
        <button className="icon-btn" title="Einklappen" onClick={umschalten}><ChevronRight size={18} /></button></div>
      {nameEdit && <div className="ichat-name">
        <span className="small muted">Unter welchem Namen schreibst du?</span>
        <div className="row"><input autoFocus placeholder="z. B. Serkan" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && nameSpeichern()} />
          <button className="primary" onClick={nameSpeichern}>OK</button></div></div>}
      <div className="ichat-liste" ref={liste}>
        {msgs.length === 0 && <p className="muted small" style={{ textAlign: 'center', marginTop: 30 }}>Noch keine Nachrichten. Schreib deinem Team etwas, zum Beispiel eine Info zu einer Liegenschaft.</p>}
        {msgs.map((m, i) => {
          const eigen = m.autor === name;
          const neuerAutor = i === 0 || msgs[i - 1].autor !== m.autor;
          return (
            <div key={m.id} className={'ichat-msg' + (eigen ? ' eigen' : '')}>
              {neuerAutor && !eigen && <div className="ichat-autor">{m.autor}</div>}
              <div className="ichat-blase">{m.text}
                <span className="ichat-zeit">{zeitText(m.zeit)}{eigen && <button className="ichat-del" title="Löschen" onClick={() => loeschen(m)}><Trash2 size={11} /></button>}</span></div>
            </div>);
        })}
      </div>
      <div className="ichat-eingabe">
        <textarea rows={2} placeholder={name ? 'Nachricht an das Team …' : 'Bitte zuerst deinen Namen eintragen'} disabled={!name || nameEdit} value={text}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); senden(); } }} />
        <button className="primary icon-btn" title="Senden (Enter)" onClick={senden} disabled={!text.trim() || !name || nameEdit}><Send size={16} /></button>
      </div>
    </aside>
  );
}
