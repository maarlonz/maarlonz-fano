// Fano Insieme — server senza dipendenze: file statici, chat via SSE o long-polling, incontri.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8770;
const PUB = path.join(__dirname, 'public');
const DB_FILE = path.join(__dirname, 'data', 'db.json');
const PLACES_FILE = path.join(__dirname, 'data', 'places.json');

let db = { users: {}, piazza: [], dms: [], meetups: [] };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch {}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(DB_FILE, JSON.stringify(db), () => {}), 400);
}

const clients = new Map(); // token -> Set(res) delle connessioni SSE
const pollers = new Map(); // token -> ultimo long-poll (ms)
const waiters = new Set(); // long-poll in attesa di eventi
const POLL_ALIVE = 40e3;   // chi usa il long-polling è online se ha chiesto novità negli ultimi 40 s
const byToken = t => t && Object.values(db.users).find(u => u.token === t);
const isOnline = t => clients.has(t) || Date.now() - (pollers.get(t) || 0) < POLL_ALIVE;
const online = () => Object.values(db.users).filter(u => isOnline(u.token)).map(u => u.nick);
const lastPost = new Map();
const joinHits = new Map(); // ip -> timestamp delle nuove registrazioni (anti-spam)
const ipOf = req => req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
const LOC_TTL = 30 * 60e3; // una posizione condivisa vale 30 minuti
const freshLoc = u => u.loc && Date.now() - u.loc.at < LOC_TTL ? u.loc : null;
const pub = u => ({ nick: u.nick, color: u.color, emoji: u.emoji || '🙂', since: u.since, seen: u.seen || 0, loc: freshLoc(u) });

function send(res, ev, data) { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); }

// Ogni evento entra in un registro numerato: le connessioni SSE lo ricevono subito,
// i client in long-polling lo leggono da lì (alcuni proxy, come i tunnel Cloudflare, bloccano lo streaming).
const log = []; let seq = 0;
const visible = (e, nick) => !e.only || e.only.includes(nick);
function emit(ev, data, only = null) {
  const e = { seq: ++seq, ev, data, only };
  log.push(e); if (log.length > 2000) log.shift();
  for (const [t, set] of clients) { const u = byToken(t); if (u && visible(e, u.nick)) for (const r of set) send(r, ev, data); }
  for (const w of [...waiters]) if (visible(e, w.u.nick)) answerWaiter(w);
}
const broadcast = (ev, data) => emit(ev, data);
function eventsFor(u, since) { return log.filter(e => e.seq > since && visible(e, u.nick)).map(e => ({ ev: e.ev, data: e.data })); }
function answerWaiter(w) {
  waiters.delete(w); clearTimeout(w.timer);
  if (!w.res.writableEnded) json(w.res, 200, { seq, events: eventsFor(w.u, w.since) });
}
function initData(u) {
  const now = Date.now();
  db.meetups = db.meetups.filter(m => m.when > now - 6 * 3600e3);
  return {
    piazza: db.piazza.slice(-120),
    dms: db.dms.filter(m => m.from === u.nick || m.to === u.nick).slice(-500),
    meetups: db.meetups, online: online(),
    users: Object.values(db.users).map(pub),
  };
}
function goneOffline(u) { u.seen = Date.now(); save(); broadcast('presence', { online: online(), left: pub(u) }); }
// chi usava il long-polling e ha smesso di chiedere novità passa offline
setInterval(() => {
  const now = Date.now();
  for (const [t, at] of pollers) if (now - at >= POLL_ALIVE) {
    pollers.delete(t);
    const u = byToken(t); if (u && !clients.has(t)) goneOffline(u);
  }
}, 5000);
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function body(req) {
  return new Promise((ok, ko) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 8000) { ko(new Error('big')); req.destroy(); } });
    req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch (e) { ko(e); } });
  });
}
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

function auth(b, res, noRate) {
  const u = byToken(b.token);
  if (!u) { json(res, 401, { error: 'Sessione non valida, rientra col tuo nickname.' }); return null; }
  if (noRate) return u;
  const now = Date.now();
  if (now - (lastPost.get(u.nick) || 0) < 600) { json(res, 429, { error: 'Piano, piano! Troppi messaggi.' }); return null; }
  lastPost.set(u.nick, now);
  return u;
}

const routes = {
  'POST /api/join': async (req, res) => {
    const b = await body(req);
    const nick = clean(b.nick, 20);
    if (!/^[\p{L}\p{N}_.\- ]{3,20}$/u.test(nick)) return json(res, 400, { error: 'Nickname: 3-20 caratteri, lettere, numeri, _ . -' });
    const key = nick.toLowerCase();
    const ex = db.users[key];
    if (ex && ex.token !== b.token) return json(res, 409, { error: 'Nickname già preso, scegline un altro!' });
    if (!ex) {
      const ip = ipOf(req), now = Date.now();
      const hits = (joinHits.get(ip) || []).filter(t => now - t < 3600e3);
      if (hits.length >= 8) return json(res, 429, { error: 'Troppe registrazioni da questa rete, riprova più tardi.' });
      hits.push(now); joinHits.set(ip, hits);
    }
    // Dopo un riavvio (dati azzerati) il dispositivo ritrova il suo nickname riusando la chiave che ha salvato.
    const keep = typeof b.token === 'string' && /^[0-9a-f]{36}$/.test(b.token) && !byToken(b.token) ? b.token : null;
    const u = ex || { nick, token: keep || crypto.randomBytes(18).toString('hex'), color: Math.floor(Math.random() * 360), since: Date.now() };
    if (b.emoji) u.emoji = clean(b.emoji, 4);
    const isNew = !ex;
    db.users[key] = u; save();
    if (isNew || b.emoji) broadcast('user', pub(u));
    json(res, 200, { nick: u.nick, token: u.token, color: u.color, emoji: u.emoji || '🙂' });
  },
  'POST /api/msg': async (req, res) => {
    const b = await body(req); const u = auth(b, res); if (!u) return;
    const text = clean(b.text, 500); if (!text) return json(res, 400, { error: 'Messaggio vuoto' });
    const m = { id: crypto.randomUUID(), from: u.nick, color: u.color, emoji: u.emoji || '🙂', text, at: Date.now() };
    if (b.place) m.place = { id: clean(b.place.id, 40), name: clean(b.place.name, 80) };
    const loc = freshLoc(u); if (loc) m.loc = { lat: loc.lat, lng: loc.lng };
    if (!b.to || b.to === 'piazza') {
      db.piazza.push(m); db.piazza = db.piazza.slice(-300); broadcast('msg', m);
    } else {
      const to = db.users[String(b.to).toLowerCase()];
      if (!to) return json(res, 404, { error: 'Utente non trovato' });
      m.to = to.nick; db.dms.push(m); db.dms = db.dms.slice(-3000);
      emit('dm', m, [u.nick, to.nick]);
    }
    save(); json(res, 200, { ok: true });
  },
  // Posizione facoltativa e approssimata (3 decimali ≈ 100 m): mai salvata quella precisa.
  'POST /api/loc': async (req, res) => {
    const b = await body(req); const u = auth(b, res, true); if (!u) return;
    if (b.off) delete u.loc;
    else {
      const lat = Math.round(+b.lat * 1000) / 1000, lng = Math.round(+b.lng * 1000) / 1000;
      if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return json(res, 400, { error: 'Posizione non valida' });
      u.loc = { lat, lng, at: Date.now() };
    }
    save(); broadcast('user', pub(u)); json(res, 200, { ok: true });
  },
  'POST /api/meetup': async (req, res) => {
    const b = await body(req); const u = auth(b, res); if (!u) return;
    const when = Number(new Date(b.when));
    if (!when || when < Date.now() - 3600e3) return json(res, 400, { error: 'Data/ora non valida' });
    const mt = {
      id: crypto.randomUUID(), by: u.nick, title: clean(b.title, 60) || 'Ci vediamo!',
      note: clean(b.note, 240), when, at: Date.now(),
      place: { id: clean(b.place?.id, 40), name: clean(b.place?.name, 80), lat: +b.place?.lat, lng: +b.place?.lng },
      people: [u.nick],
    };
    if (!isFinite(mt.place.lat) || !isFinite(mt.place.lng)) return json(res, 400, { error: 'Scegli un luogo' });
    db.meetups.push(mt); save(); broadcast('meetup', mt);
    const sys = { id: crypto.randomUUID(), from: u.nick, color: u.color, emoji: u.emoji || '🙂', at: Date.now(), meetup: mt.id,
      text: `ha proposto un incontro: "${mt.title}" @ ${mt.place.name}` };
    db.piazza.push(sys); broadcast('msg', sys);
    json(res, 200, mt);
  },
  'POST /api/meetup/toggle': async (req, res) => {
    const b = await body(req); const u = auth(b, res); if (!u) return;
    const mt = db.meetups.find(m => m.id === b.id); if (!mt) return json(res, 404, { error: 'Incontro non trovato' });
    const i = mt.people.indexOf(u.nick);
    if (i >= 0) mt.people.splice(i, 1); else mt.people.push(u.nick);
    if (!mt.people.length) db.meetups = db.meetups.filter(m => m !== mt);
    save(); broadcast('meetup', mt.people.length ? mt : { id: mt.id, deleted: true });
    json(res, 200, { ok: true });
  },
  'GET /api/places': (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'max-age=600' });
    fs.createReadStream(PLACES_FILE).pipe(res);
  },
  'GET /api/stream': (req, res, url) => {
    const u = byToken(url.searchParams.get('token'));
    if (!u) return json(res, 401, { error: 'no' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    // Alcuni proxy (es. tunnel Cloudflare) trattengono i primi KB: un commento di riempimento li sblocca.
    res.write(':' + ' '.repeat(4096) + '\n\n');
    const wasOnline = isOnline(u.token);
    if (!clients.has(u.token)) clients.set(u.token, new Set());
    clients.get(u.token).add(res);
    send(res, 'init', initData(u));
    if (!wasOnline) broadcast('presence', { online: online(), joined: pub(u) });
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(ping);
      const set = clients.get(u.token); set?.delete(res);
      if (set && !set.size) { clients.delete(u.token); if (!isOnline(u.token)) goneOffline(u); }
    });
  },
  // Long-polling: risponde subito se ci sono novità dopo `since`, altrimenti attende fino a 25 s.
  'GET /api/poll': (req, res, url) => {
    const u = byToken(url.searchParams.get('token'));
    if (!u) return json(res, 401, { error: 'Sessione non valida, rientra col tuo nickname.' });
    const since = +url.searchParams.get('since') || 0;
    const wasOnline = isOnline(u.token);
    pollers.set(u.token, Date.now());
    if (!wasOnline) broadcast('presence', { online: online(), joined: pub(u) });
    // primo poll, server riavviato o troppi eventi persi: si riparte da uno stato completo
    if (!since || since > seq || (log.length && since < log[0].seq - 1)) return json(res, 200, { seq, init: initData(u) });
    const events = eventsFor(u, since);
    if (events.length) return json(res, 200, { seq, events });
    const w = { u, since, res };
    w.timer = setTimeout(() => answerWaiter(w), 25000);
    waiters.add(w);
    req.on('close', () => { waiters.delete(w); clearTimeout(w.timer); });
  },
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const r = routes[`${req.method} ${url.pathname}`];
  if (r) { try { await r(req, res, url); } catch (e) { json(res, 400, { error: 'Richiesta non valida' }); } return; }
  if (req.method !== 'GET') return json(res, 405, { error: 'no' });
  let p = path.normalize(path.join(PUB, decodeURIComponent(url.pathname)));
  if (!p.startsWith(PUB)) return json(res, 403, {});
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'geolocation=(self)' });
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', () => console.log(`Fano Insieme su http://localhost:${PORT}`));
