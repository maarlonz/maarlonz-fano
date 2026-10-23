'use strict';
// Fano Insieme — client

const CATS = {
  ristoranti: { label: 'Ristoranti', icon: '🍝', color: 'var(--c-ristoranti)' },
  aperitivi: { label: 'Aperitivi & bar', icon: '🍹', color: 'var(--c-aperitivi)' },
  caffe: { label: 'Caffè', icon: '☕', color: 'var(--c-caffe)' },
  street: { label: 'Street food', icon: '🍕', color: 'var(--c-street)' },
  gelato: { label: 'Gelato', icon: '🍦', color: 'var(--c-gelato)' },
  storia: { label: 'Storia & cultura', icon: '🏛️', color: 'var(--c-storia)' },
  mare: { label: 'Mare', icon: '🌊', color: 'var(--c-mare)' },
};
const EMOJIS = ['🙂', '😎', '🦊', '🐙', '🌻', '🍕', '🍹', '🎸', '⚽', '🐬', '🌅', '🦄'];
const CENTER = [43.8445, 13.0172]; // Piazza XX Settembre circa

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const isMobile = () => matchMedia('(max-width: 820px)').matches;

const S = {
  me: store.get('fano.me'),
  places: [], byId: new Map(),
  active: new Set(Object.keys(CATS)),
  query: '', userPos: null, selected: null,
  piazza: [], dms: [], meetups: [], online: [], users: new Map(),
  conv: 'piazza', unread: {}, tab: 'explore', attach: null,
  shareLoc: !!store.get('fano.shareLoc'), watchId: null, lastSent: null,
};

/* ================= INTRO ================= */
let emoji = S.me?.emoji || EMOJIS[0];
function buildEmojiRow() {
  $('#emojiRow').innerHTML = EMOJIS.map(e => `<button type="button" role="radio" aria-checked="${e === emoji}" data-e="${e}">${e}</button>`).join('');
}
$('#emojiRow').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  emoji = b.dataset.e; buildEmojiRow();
});
buildEmojiRow();
if (S.me) { $('#nickInput').value = S.me.nick; $('#joinBtn span').textContent = 'Bentornato'; }

function countUp() {
  const counts = {};
  for (const p of S.places) counts[p.cat] = (counts[p.cat] || 0) + 1;
  counts.storia = (counts.storia || 0) + (counts.mare || 0);
  $$('[data-count]').forEach(el => {
    const target = counts[el.dataset.count] || 0, t0 = performance.now();
    const step = t => { const k = Math.min(1, (t - t0) / 1600); el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}

$('#joinForm').addEventListener('submit', async e => {
  e.preventDefault();
  const nick = $('#nickInput').value.trim();
  const btn = $('#joinBtn'); btn.disabled = true; $('#joinError').textContent = '';
  try {
    const r = await api('/api/join', { nick, emoji, token: S.me?.nick?.toLowerCase() === nick.toLowerCase() ? S.me.token : undefined });
    S.me = r; store.set('fano.me', r);
    enterApp();
  } catch (err) {
    $('#joinError').textContent = err.message;
    const f = $('#joinForm'); f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake');
  } finally { btn.disabled = false; }
});

async function api(url, data) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: S.me?.token, ...data }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Errore di rete');
  return j;
}

function enterApp() {
  $('#intro').classList.add('leaving');
  setTimeout(() => { $('#intro').hidden = true; }, 900);
  $('#app').hidden = false;
  $('#meNick').textContent = S.me.nick;
  setAvatar($('#meAvatar'), S.me);
  initMap();
  connect();
  renderLocBar();
  if (S.shareLoc) startShare(true);
  if (!store.get('fano.tutSeen')) setTimeout(() => openTutorial(), 1300);
  setTimeout(() => { map.invalidateSize(); moveInk(); }, 60);
}

function setAvatar(el, u) { el.textContent = u.emoji || '🙂'; el.style.setProperty('--h', u.color ?? 20); }
const avatarHTML = u => `<span class="avatar" style="--h:${+u.color || 20}">${esc(u.emoji || '🙂')}</span>`;

/* ================= MAPPA ================= */
let map, cluster, featLayer, meetLayer, peopleLayer, meMarker, accCircle, areaCircle;
const markers = new Map();

function theme() {
  const t = document.documentElement.dataset.theme;
  return t || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
// Tile OpenStreetMap; il tema scuro è ottenuto con un filtro CSS sul tile pane.
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

function initMap() {
  if (map) return;
  map = L.map('map', { zoomControl: false, attributionControl: true, minZoom: 12, maxZoom: 19, zoomSnap: .5 })
    .setView(CENTER, isMobile() ? 15 : 16);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  // OpenStreetMap serve tile vuote se la richiesta non dice da quale sito arriva
  L.tileLayer(TILE_URL, { maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  cluster = L.markerClusterGroup({
    showCoverageOnHover: false, maxClusterRadius: 46, spiderfyOnMaxZoom: true, disableClusteringAtZoom: 18,
    iconCreateFunction: c => { const n = c.getChildCount(), s = n < 10 ? 38 : n < 40 ? 46 : 54;
      return L.divIcon({ html: `<div class="cluster" style="width:${s}px;height:${s}px">${n}</div>`, className: '', iconSize: [s, s] }); },
  }).addTo(map);
  featLayer = L.layerGroup().addTo(map);
  meetLayer = L.layerGroup().addTo(map);
  peopleLayer = L.layerGroup().addTo(map);

  S.places.forEach((p, i) => {
    const big = p.featured;
    const icon = L.divIcon({
      className: `pin${big ? ' big' : ''}`, iconSize: big ? [40, 40] : [34, 34], iconAnchor: big ? [20, 40] : [17, 34],
      html: `<div class="pin-in" style="--c:${CATS[p.cat].color};--dl:${(i % 40) * 18}ms"><span>${esc(placeIcon(p))}</span></div>`,
    });
    const m = L.marker([p.lat, p.lng], { icon, riseOnHover: true, title: p.name });
    m.bindTooltip(esc(p.name), { className: 'tip', direction: 'top', offset: [0, big ? -40 : -34] });
    m.on('click', () => openPlace(p.id));
    markers.set(p.id, m);
  });
  applyFilters();

  map.on('click', e => { if (S.picking) return finishPick(e.latlng); closePlace(); });
  map.on('moveend', () => { if (!S.userPos) renderList(); });
}

function placeIcon(p) {
  if (p.icon) return p.icon;
  const t = (p.tags || []).join(' ').toLowerCase();
  if (p.cat === 'ristoranti') {
    if (t.includes('pizza')) return '🍕';
    if (t.includes('pesce')) return '🐟';
    if (t.includes('sushi') || t.includes('giappon')) return '🍣';
    if (t.includes('burger')) return '🍔';
    if (t.includes('cinese') || t.includes('asiat')) return '🥢';
  }
  if (p.cat === 'street') {
    if (t.includes('kebab')) return '🥙';
    if (t.includes('burger')) return '🍔';
    if (t.includes('piadina') || t.includes('panini')) return '🥪';
  }
  if (p.cat === 'aperitivi' && /pub|birr|beer/i.test(p.name + t)) return '🍺';
  return CATS[p.cat].icon;
}

/* ================= FILTRI & LISTA ================= */
function buildChips() {
  const n = {}; S.places.forEach(p => n[p.cat] = (n[p.cat] || 0) + 1);
  const all = S.active.size === Object.keys(CATS).length;
  $('#chips').innerHTML = `<button class="chip ${all ? 'on' : ''}" data-cat="*" style="--c:var(--text);animation-delay:0ms">✨ Tutti</button>` +
    Object.entries(CATS).map(([k, c], i) =>
      `<button class="chip ${!all && S.active.has(k) ? 'on' : ''}" data-cat="${k}" style="--c:${c.color};animation-delay:${(i + 1) * 60}ms"><i></i>${c.icon} ${c.label} <small>${n[k] || 0}</small></button>`).join('');
}
$('#chips').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  const k = b.dataset.cat, keys = Object.keys(CATS), all = S.active.size === keys.length;
  if (k === '*') S.active = new Set(keys);
  else if (all) S.active = new Set([k]);
  else { S.active.has(k) ? S.active.delete(k) : S.active.add(k); if (!S.active.size) S.active = new Set(keys); }
  buildChips(); applyFilters();
  $$('#chips .chip').forEach(c => c.style.animation = 'none');
});

function matches(p) {
  if (!S.active.has(p.cat)) return false;
  if (!S.query) return true;
  const q = S.query.toLowerCase();
  return (p.name + ' ' + (p.addr || '') + ' ' + (p.tags || []).join(' ') + ' ' + CATS[p.cat].label).toLowerCase().includes(q);
}
function applyFilters() {
  if (!map) return;
  const food = [], feat = [];
  for (const p of S.places) if (matches(p)) (p.featured ? feat : food).push(markers.get(p.id));
  cluster.clearLayers(); cluster.addLayers(food);
  featLayer.clearLayers(); feat.forEach(m => featLayer.addLayer(m));
  renderList();
}

function dist(a, b) {
  const R = 6371e3, r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtDist = m => m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;

let listTimer;
function renderList() {
  clearTimeout(listTimer);
  listTimer = setTimeout(() => {
    const ref = S.userPos || (map ? [map.getCenter().lat, map.getCenter().lng] : CENTER);
    const items = S.places.filter(matches).map(p => ({ p, d: dist(ref, [p.lat, p.lng]) }))
      .sort((a, b) => a.d - b.d);
    $('#listMeta').textContent = `${items.length} luoghi · ${S.userPos ? 'più vicini a te' : 'vicini al centro mappa'}`;
    const shown = items.slice(0, 120);
    $('#placeList').innerHTML = shown.length ? shown.map(({ p, d }, i) => `
      <li class="place-item" data-id="${p.id}" style="--i:${i};--c:${CATS[p.cat].color}">
        <div class="place-ico">${esc(placeIcon(p))}</div>
        <div><h4>${esc(p.name)}</h4><p>${esc([CATS[p.cat].label, ...(p.tags || []).slice(0, 2), p.addr].filter(Boolean).join(' · '))}</p></div>
        <span class="dist">${fmtDist(d)}</span>
      </li>`).join('') : `<li class="empty"><b>🔎</b>Nessun luogo trovato.<br>Prova un'altra ricerca.</li>`;
  }, 60);
}
$('#placeList').addEventListener('click', e => { const li = e.target.closest('.place-item'); if (li) openPlace(li.dataset.id, true); });
$('#search').addEventListener('input', e => { S.query = e.target.value.trim(); applyFilters(); });

/* ================= SCHEDA LUOGO ================= */
const ICO = {
  pin: '<svg viewBox="0 0 24 24"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.6"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
  web: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
};
function hoursIt(h) {
  return h.replace(/\bMo\b/g, 'Lun').replace(/\bTu\b/g, 'Mar').replace(/\bWe\b/g, 'Mer').replace(/\bTh\b/g, 'Gio')
    .replace(/\bFr\b/g, 'Ven').replace(/\bSa\b/g, 'Sab').replace(/\bSu\b/g, 'Dom').replace(/\boff\b/g, 'chiuso').replace(/;\s*/g, ' · ');
}
function openPlace(id, fly) {
  const p = S.byId.get(id); if (!p) return;
  markers.get(S.selected)?.getElement()?.classList.remove('sel');
  S.selected = id;
  const c = CATS[p.cat];
  const meets = S.meetups.filter(m => m.place.id === p.id);
  const url = p.web && /^https?:\/\//i.test(p.web) ? p.web : p.web ? 'https://' + p.web : '';
  $('#placeCard').innerHTML = `
    <div class="pc-hero" style="--c:${c.color}" data-icon="${esc(placeIcon(p))}">
      <button class="pc-close" aria-label="Chiudi">✕</button>
      <div class="cat">${c.icon} ${c.label}</div>
      <h3>${esc(p.name)}</h3>
    </div>
    <div class="pc-body">
      ${p.desc ? `<p class="desc">${esc(p.desc)}</p>` : ''}
      ${p.tags?.length ? `<div class="pc-tags">${p.tags.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
      ${p.addr ? `<div class="pc-row">${ICO.pin}<span>${esc(p.addr)}, Fano</span></div>` : ''}
      ${p.hours ? `<div class="pc-row">${ICO.clock}<span>${esc(hoursIt(p.hours))}</span></div>` : ''}
      ${p.phone ? `<div class="pc-row">${ICO.phone}<a href="tel:${esc(p.phone.replace(/\s/g, ''))}">${esc(p.phone)}</a></div>` : ''}
      ${url ? `<div class="pc-row">${ICO.web}<a href="${esc(url)}" target="_blank" rel="noopener">${esc(p.web.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a></div>` : ''}
      ${p.outdoor ? `<div class="pc-row">${ICO.sun}<span>Tavoli all'aperto</span></div>` : ''}
      ${meets.length ? `<div class="pc-meets">🎉 <b>${meets.length}</b> incontr${meets.length > 1 ? 'i' : 'o'} in programma qui</div>` : ''}
      <div class="pc-actions">
        <button class="btn-primary" data-act="meet">📅 Proponi un incontro qui</button>
        <button class="btn-ghost" data-act="share">💬 Condividi</button>
        <a class="btn-ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}">🧭 Indicazioni</a>
      </div>
    </div>`;
  const card = $('#placeCard'); card.classList.add('open'); card.setAttribute('aria-hidden', 'false'); card.scrollTop = 0;
  if (isMobile()) setSheet('peek');
  const m = markers.get(id);
  const go = () => { m.getElement()?.classList.add('sel'); };
  if (fly || isMobile()) {
    const z = Math.max(map.getZoom(), 17);
    if (p.featured) map.flyTo(offsetLatLng([p.lat, p.lng], z), z, { duration: .9 });
    else cluster.zoomToShowLayer(m, () => { map.flyTo(offsetLatLng([p.lat, p.lng], z), z, { duration: .8 }); });
  }
  setTimeout(go, 50); setTimeout(go, 1000);
}
// Sposta il centro così il luogo non resta sotto il pannello o la scheda.
function offsetLatLng(ll, z) {
  const pt = map.project(ll, z);
  if (isMobile()) pt.y += window.innerHeight * .22;
  else pt.x -= (430 - 390) / 2;
  return map.unproject(pt, z);
}
function closePlace() {
  const card = $('#placeCard'); card.classList.remove('open'); card.setAttribute('aria-hidden', 'true');
  markers.get(S.selected)?.getElement()?.classList.remove('sel'); S.selected = null;
}
$('#placeCard').addEventListener('click', e => {
  if (e.target.closest('.pc-close')) return closePlace();
  const act = e.target.closest('[data-act]')?.dataset.act;
  const p = S.byId.get(S.selected); if (!p) return;
  if (act === 'meet') openMeetDialog(p.id);
  if (act === 'share') { setAttach(p); switchTab('chat'); closePlace(); setTimeout(() => $('#msgInput').focus(), 300); }
});

/* ================= TAB & BOTTOM SHEET ================= */
function switchTab(t) {
  S.tab = t;
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === t));
  moveInk();
  if (t === 'chat') { S.unread[S.conv] = 0; renderConvs(); renderMessages(); updateBadges(); }
  if (t === 'meet') renderMeetups();
  if (t === 'people') renderPeople();
  if (isMobile() && sheet !== 'full') setSheet(t === 'explore' ? 'half' : 'full');
}
function moveInk() {
  const a = $('.tab.active'), ink = $('#tabInk'); if (!a) return;
  ink.style.width = a.offsetWidth + 'px';
  ink.style.transform = `translateX(${a.offsetLeft}px)`;
}
$('.tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) switchTab(b.dataset.tab); });
addEventListener('resize', () => { moveInk(); map?.invalidateSize(); if (!isMobile()) $('#panel').style.transform = ''; });

let sheet = 'peek';
function setSheet(s) {
  sheet = s; const p = $('#panel');
  p.classList.toggle('half', s === 'half'); p.classList.toggle('full', s === 'full');
  p.style.transform = '';
}
(() => {
  const p = $('#panel'); let y0 = null, t0 = 0, base = 0, moved = false;
  const start = e => {
    if (!isMobile()) return;
    y0 = e.clientY; t0 = performance.now(); moved = false;
    base = new DOMMatrix(getComputedStyle(p).transform).m42;
  };
  const move = e => {
    if (y0 == null) return;
    const dy = e.clientY - y0; if (Math.abs(dy) > 6) moved = true;
    if (!moved) return;
    p.classList.add('dragging');
    p.style.transform = `translateY(${Math.max(0, base + dy)}px)`;
  };
  const end = e => {
    if (y0 == null) return;
    const dy = e.clientY - y0, v = dy / (performance.now() - t0);
    p.classList.remove('dragging'); y0 = null;
    if (!moved) { if (e.target.closest('.sheet-handle')) setSheet(sheet === 'peek' ? 'half' : sheet === 'half' ? 'full' : 'peek'); return; }
    const y = base + dy, h = p.offsetHeight;
    let s = y < h * .22 ? 'full' : y < h * .65 ? 'half' : 'peek';
    if (v < -.5) s = sheet === 'peek' ? 'half' : 'full';
    if (v > .5) s = sheet === 'full' ? 'half' : 'peek';
    setSheet(s);
  };
  for (const el of [$('#sheetHandle'), $('.tabs')]) {
    el.addEventListener('pointerdown', start);
  }
  addEventListener('pointermove', move);
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);
  // un tap su un tab quando si è trascinato non deve cambiare tab
  $('.tabs').addEventListener('click', e => { if (moved) { e.stopImmediatePropagation(); moved = false; } }, true);
})();

/* ================= REALTIME ================= */
// Stessi gestori per i due trasporti: SSE (istantaneo) e long-polling se un proxy blocca lo streaming.
const HANDLERS = {
  init(d) {
    S.piazza = d.piazza; S.dms = d.dms; S.meetups = d.meetups; S.online = d.online;
    S.users = new Map(d.users.map(u => [u.nick, u]));
    renderPeople(); renderPeoplePins(); renderConvs(); renderMessages(); renderMeetups(); renderMeetPins(); updateBadges();
  },
  msg(m) {
    S.piazza.push(m); S.users.set(m.from, { ...S.users.get(m.from), nick: m.from, color: m.color, emoji: m.emoji });
    incoming('piazza', m);
  },
  dm(m) {
    S.dms.push(m); S.users.set(m.from, { ...S.users.get(m.from), nick: m.from, color: m.color, emoji: m.emoji });
    incoming(m.from === S.me.nick ? m.to : m.from, m);
  },
  meetup(m) {
    const i = S.meetups.findIndex(x => x.id === m.id);
    if (m.deleted) { if (i >= 0) S.meetups.splice(i, 1); }
    else if (i >= 0) S.meetups[i] = m;
    else { S.meetups.push(m); if (m.by !== S.me.nick && S.tab !== 'meet') { S.newMeets = (S.newMeets || 0) + 1; } }
    renderMeetups(); renderMeetPins(); updateBadges();
  },
  user(u) { S.users.set(u.nick, { ...S.users.get(u.nick), ...u }); renderPeople(); renderPeoplePins(); },
  presence(d) {
    S.online = d.online;
    if (d.left) S.users.set(d.left.nick, { ...S.users.get(d.left.nick), ...d.left });
    if (d.joined) { S.users.set(d.joined.nick, d.joined); if (d.joined.nick !== S.me.nick) toast(d.joined, 'è appena entrato in piazza 👋', () => openConv(d.joined.nick)); }
    renderPeople(); renderPeoplePins(); renderConvs();
  },
  // un utente ha eliminato il suo account: sparisce da liste, chat e incontri
  gone({ nick }) {
    if (nick === S.me?.nick) return;
    S.users.delete(nick); S.online = S.online.filter(n => n !== nick);
    S.piazza = S.piazza.filter(m => m.from !== nick);
    S.dms = S.dms.filter(m => m.from !== nick && m.to !== nick);
    S.meetups.forEach(m => { m.people = m.people.filter(n => n !== nick); });
    S.meetups = S.meetups.filter(m => m.people.length);
    if (S.conv === nick) S.conv = 'piazza';
    renderPeople(); renderPeoplePins(); renderConvs(); renderMessages(); renderMeetups(); renderMeetPins(); updateBadges();
  },
};

let es = null, pollCtl = null, connGen = 0;
function disconnect() { connGen++; es?.close(); es = null; pollCtl?.abort(); }
function connect() {
  disconnect();
  const gen = connGen;
  if (S.usePoll) return startPoll(gen);
  let gotInit = false;
  es = new EventSource('/api/stream?token=' + encodeURIComponent(S.me.token));
  for (const k of Object.keys(HANDLERS)) es.addEventListener(k, e => { if (k === 'init') gotInit = true; HANDLERS[k](JSON.parse(e.data)); });
  // se in 6 s non arriva niente, lo streaming è trattenuto da un proxy: si passa al long-polling
  setTimeout(() => { if (gen === connGen && !gotInit) { S.usePoll = true; connect(); } }, 6000);
  es.onerror = () => { if (gen === connGen && es?.readyState === EventSource.CLOSED) checkSession(gen); };
}
// Connessione caduta: se la sessione non è più valida torna all'intro, altrimenti riprova.
async function checkSession(gen) {
  try {
    await api('/api/join', { nick: S.me.nick, emoji: S.me.emoji });
    setTimeout(() => { if (gen === connGen) connect(); }, 2000);
  } catch (err) {
    if (/nickname|sessione/i.test(err.message)) logout();
    else setTimeout(() => { if (gen === connGen) connect(); }, 4000);
  }
}
async function startPoll(gen) {
  let since = 0, fails = 0;
  while (gen === connGen) {
    try {
      pollCtl = new AbortController();
      const r = await fetch(`/api/poll?token=${encodeURIComponent(S.me.token)}&since=${since}`, { signal: pollCtl.signal, cache: 'no-store' });
      if (gen !== connGen) return;
      if (r.status === 401) return checkSession(gen);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json(); fails = 0;
      if (d.init) HANDLERS.init(d.init);
      for (const e of d.events || []) HANDLERS[e.ev]?.(e.data);
      since = d.seq;
    } catch {
      if (gen !== connGen) return;
      await new Promise(ok => setTimeout(ok, Math.min(15000, 1000 * 2 ** fails++)));
    }
  }
}

function incoming(conv, m) {
  const viewing = S.tab === 'chat' && S.conv === conv && (!isMobile() || sheet !== 'peek');
  if (m.from !== S.me.nick && !viewing) {
    S.unread[conv] = (S.unread[conv] || 0) + 1;
    toast({ nick: m.from, color: m.color, emoji: m.emoji }, (conv === 'piazza' ? '' : '🔒 ') + m.text, () => openConv(conv));
  }
  renderConvs(); updateBadges();
  if (S.conv === conv) renderMessages(true);
}

/* ================= CHAT ================= */
function convMessages(c) { return c === 'piazza' ? S.piazza : S.dms.filter(m => (m.from === c && m.to === S.me.nick) || (m.to === c && m.from === S.me.nick)); }
function renderConvs() {
  const partners = [...new Set(S.dms.map(m => m.from === S.me.nick ? m.to : m.from))]
    .map(n => ({ n, last: Math.max(...convMessages(n).map(m => m.at)) })).sort((a, b) => b.last - a.last).map(x => x.n);
  const others = S.online.filter(n => n !== S.me.nick && !partners.includes(n));
  const u = n => S.users.get(n) || { nick: n };
  const unread = c => S.unread[c] ? `<span class="unread">${S.unread[c]}</span>` : '';
  $('#convs').innerHTML =
    `<button class="conv people ${S.conv === 'piazza' ? 'active' : ''}" data-c="piazza">🏛️ Piazza <small style="opacity:.6">${S.online.length} online</small>${unread('piazza')}</button>` +
    [...partners, ...others].map(n => `<button class="conv ${S.conv === n ? 'active' : ''}" data-c="${esc(n)}">${avatarHTML(u(n))}${S.online.includes(n) ? '<i class="dot"></i>' : ''}${esc(n)}${unread(n)}</button>`).join('');
}
$('#convs').addEventListener('click', e => { const b = e.target.closest('.conv'); if (b) openConv(b.dataset.c); });
function openConv(c) {
  S.conv = c; S.unread[c] = 0;
  $('#msgInput').placeholder = c === 'piazza' ? 'Scrivi in piazza…' : `Messaggio privato a ${c}…`;
  if (S.tab !== 'chat') switchTab('chat'); else { renderConvs(); renderMessages(); updateBadges(); }
  if (isMobile()) setSheet('full');
}

const fmtTime = t => new Date(t).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
const fmtDay = t => {
  const d = new Date(t), today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Oggi';
  if (d.toDateString() === y.toDateString()) return 'Ieri';
  return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
};
function renderMessages(scrollIfNear) {
  const box = $('#messages');
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const msgs = convMessages(S.conv).slice(-200);
  let html = '', prev = null, day = '';
  if (!msgs.length) html = `<div class="empty"><b>${S.conv === 'piazza' ? '👋' : '✉️'}</b>${S.conv === 'piazza' ? 'La piazza è tranquilla.<br>Rompi il ghiaccio e saluta tutti!' : `Inizia una conversazione con ${esc(S.conv)}.`}</div>`;
  for (const m of msgs) {
    const dd = fmtDay(m.at); if (dd !== day) { html += `<div class="day-sep">${dd}</div>`; day = dd; prev = null; }
    const mine = m.from === S.me.nick, cont = prev && prev.from === m.from && m.at - prev.at < 180e3 && !m.meetup;
    const place = m.place && S.byId.get(m.place.id);
    html += `<div class="msg ${mine ? 'mine' : ''} ${cont ? 'cont' : ''} ${m.meetup ? 'sys' : ''}" data-from="${esc(m.from)}">
      ${avatarHTML(m)}
      <div class="bubble" style="--h:${+m.color || 20}">${cont ? '' : `<span class="who">${esc(m.from)}</span>`}${m.loc && !cont ? `<span class="loc" data-lat="${+m.loc.lat}" data-lng="${+m.loc.lng}" data-nick="${esc(m.from)}">📍 ${esc(locLabel(m.loc, !mine))}</span>` : ''}${m.meetup ? '📅 ' : ''}${esc(m.text)}<time>${fmtTime(m.at)}</time>
      ${place ? `<div><span class="place-tag" data-place="${esc(place.id)}">${esc(placeIcon(place))} ${esc(place.name)} →</span></div>` : ''}
      ${m.meetup ? `<div><span class="place-tag" data-meet="${esc(m.meetup)}">Vedi incontro →</span></div>` : ''}</div>
    </div>`;
    prev = m;
  }
  box.innerHTML = html;
  if (!scrollIfNear || near || msgs.at(-1)?.from === S.me.nick) box.scrollTop = box.scrollHeight;
}
$('#messages').addEventListener('click', e => {
  const lc = e.target.closest('.loc'); if (lc) return showArea(+lc.dataset.lat, +lc.dataset.lng, lc.dataset.nick);
  const pl = e.target.closest('[data-place]'); if (pl) return openPlace(pl.dataset.place, true);
  const mt = e.target.closest('[data-meet]'); if (mt) { switchTab('meet'); return; }
  const who = e.target.closest('.who, .avatar'); const msg = e.target.closest('.msg');
  if (who && msg && msg.dataset.from !== S.me.nick) openConv(msg.dataset.from);
});

$('#composer').addEventListener('submit', async e => {
  e.preventDefault();
  const inp = $('#msgInput'), text = inp.value.trim();
  if (!text && !S.attach) return;
  const payload = { to: S.conv, text: text || `Che ne dite di ${S.attach.name}?` };
  if (S.attach) payload.place = { id: S.attach.id, name: S.attach.name };
  inp.value = ''; setAttach(null);
  try { await api('/api/msg', payload); } catch (err) { toast({ nick: 'Fano Insieme', emoji: '⚠️', color: 0 }, err.message); inp.value = text; }
});

function setAttach(p) {
  S.attach = p; const chip = $('#attachChip');
  chip.hidden = !p;
  if (p) chip.innerHTML = `${esc(placeIcon(p))} ${esc(p.name)} <button type="button" aria-label="Rimuovi">✕</button>`;
}
$('#attachChip').addEventListener('click', e => { if (e.target.closest('button')) setAttach(null); });
$('#attachPlace').addEventListener('click', () => { renderPick(''); $('#pickSearch').value = ''; $('#pickDialog').showModal(); });
$('#pickSearch').addEventListener('input', e => renderPick(e.target.value));
function renderPick(q) {
  q = q.toLowerCase();
  const list = S.places.filter(p => !q || p.name.toLowerCase().includes(q)).sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || a.name.localeCompare(b.name)).slice(0, 80);
  $('#pickList').innerHTML = list.map(p => `<li data-id="${p.id}">${esc(placeIcon(p))} <span>${esc(p.name)}</span></li>`).join('');
}
$('#pickList').addEventListener('click', e => {
  const li = e.target.closest('li'); if (!li) return;
  setAttach(S.byId.get(li.dataset.id)); $('#pickDialog').close(); $('#msgInput').focus();
});

/* ================= POSIZIONE CONDIVISA ================= */
// Zona leggibile: il luogo storico/mare più vicino, oppure la distanza dal centro se si è fuori Fano.
function locLabel(loc, withDist) {
  const ll = [loc.lat, loc.lng], dc = dist(ll, CENTER);
  let txt;
  if (dc > 6000) txt = `fuori Fano · ${fmtDist(dc)} dal centro`;
  else {
    let best = null, bd = Infinity;
    for (const p of S.places) if (p.featured) { const d = dist(ll, [p.lat, p.lng]); if (d < bd) { bd = d; best = p; } }
    txt = bd < 250 ? `zona ${best.name}` : `vicino a ${best.name}`;
  }
  if (withDist && S.userPos) txt += ` · ${fmtDist(Math.max(100, dist(ll, S.userPos)))} da te`;
  return txt;
}
function renderLocBar() {
  const b = $('#locBar');
  b.classList.toggle('on', S.shareLoc);
  b.innerHTML = S.shareLoc
    ? `<i class="pulse"></i><span>Scrivi da: ${S.userPos ? esc(locLabel({ lat: S.userPos[0], lng: S.userPos[1] })) : 'cerco la tua posizione…'}${S.manualPos ? ' <small>(scelta sulla mappa)</small>' : ''}</span>
       <button type="button" data-loc="pick">Sposta</button><button type="button" data-loc="off">Disattiva</button>`
    : `<i class="pulse"></i><span>Mostra agli altri da che zona scrivi</span><button type="button" class="strong" data-loc="on">Attiva 📍</button>`;
}
$('#locBar').addEventListener('click', e => {
  const a = e.target.closest('[data-loc]')?.dataset.loc;
  if (a === 'on') startShare();
  if (a === 'off') stopShare();
  if (a === 'pick') startPick(true);
});

const POS_TOAST = { nick: 'Posizione', emoji: '📍' };
// Prima il GPS preciso; se va in timeout (tipico dei PC senza GPS) riprova con la posizione
// approssimata da Wi-Fi/rete, che accetta anche un valore in cache di qualche minuto.
function getPosition() {
  return new Promise((ok, ko) => {
    if (!navigator.geolocation) return ko({ code: 0 });
    if (!window.isSecureContext) return ko({ code: 9 });
    navigator.geolocation.getCurrentPosition(ok, err => {
      if (err.code === 1) return ko(err);
      navigator.geolocation.getCurrentPosition(ok, ko, { enableHighAccuracy: false, maximumAge: 600000, timeout: 20000 });
    }, { enableHighAccuracy: true, maximumAge: 30000, timeout: 12000 });
  });
}
function posError(err, share) {
  const msg = {
    0: 'Il tuo browser non supporta la geolocalizzazione.',
    1: 'Permesso negato: riattivalo dal lucchetto 🔒 accanto all\'indirizzo del sito.',
    9: 'La posizione funziona solo su un indirizzo https.',
  }[err.code] || 'Non trovo la tua posizione (GPS spento o segnale debole).';
  toast(POS_TOAST, msg + ' Tocca qui per sceglierla sulla mappa.', () => startPick(share), 10000);
}
function setMyPos(ll, accuracy, manual) {
  S.userPos = ll; S.manualPos = !!manual;
  meMarker?.remove(); accCircle?.remove(); accCircle = null;
  meMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18] }), zIndexOffset: 2000, interactive: false }).addTo(map);
  if (!manual && accuracy > 150) accCircle = L.circle(ll, { radius: Math.min(accuracy, 3000), color: '#2f80ed', weight: 1, fillOpacity: .07, interactive: false }).addTo(map);
  if (S.shareLoc) sendLoc();
  renderLocBar(); renderList(); renderPeople();
  if (S.tab === 'chat') renderMessages(true);
}
// Al server va solo se ci si è spostati di 80 m o è passato 1 minuto (il server arrotonda a ~100 m).
function sendLoc(force) {
  const now = Date.now(), l = S.lastSent;
  if (!force && l && dist(l.ll, S.userPos) < 80 && now - l.at < 60e3) return;
  S.lastSent = { ll: S.userPos, at: now };
  api('/api/loc', { lat: S.userPos[0], lng: S.userPos[1] }).catch(() => {});
}
async function startShare(silent) {
  S.shareLoc = true; store.set('fano.shareLoc', true); renderLocBar();
  if (S.manualPos && S.userPos) return sendLoc(true);
  try {
    const pos = await getPosition();
    if (!S.shareLoc) return;
    setMyPos([pos.coords.latitude, pos.coords.longitude], pos.coords.accuracy);
    // poi segue gli spostamenti; errori successivi si ignorano perché una posizione c'è già
    navigator.geolocation.clearWatch(S.watchId);
    S.watchId = navigator.geolocation.watchPosition(p => { if (S.shareLoc && !S.manualPos) setMyPos([p.coords.latitude, p.coords.longitude], p.coords.accuracy); },
      () => {}, { enableHighAccuracy: true, maximumAge: 30000 });
  } catch (err) {
    if (!S.shareLoc) return;
    S.shareLoc = false; renderLocBar();
    if (!silent) posError(err, true);
  }
}
function stopShare() {
  navigator.geolocation?.clearWatch(S.watchId); S.watchId = null; S.lastSent = null;
  S.shareLoc = false; store.set('fano.shareLoc', false);
  api('/api/loc', { off: true }).catch(() => {});
  renderLocBar();
}
// Riinvia la posizione ogni 10 minuti così non scade lato server mentre si è fermi.
setInterval(() => { if (S.shareLoc && S.userPos) sendLoc(true); }, 10 * 60e3);

// Scelta manuale: il prossimo tocco sulla mappa diventa la propria posizione.
function startPick(share) {
  S.picking = { share: !!share };
  closePlace();
  if (isMobile()) setSheet('peek');
  $('#pickBanner').hidden = false; $('#map').classList.add('picking');
}
function endPick() { S.picking = null; $('#pickBanner').hidden = true; $('#map').classList.remove('picking'); }
function finishPick(ll) {
  const share = S.picking.share; endPick();
  if (share && !S.shareLoc) { S.shareLoc = true; store.set('fano.shareLoc', true); }
  navigator.geolocation?.clearWatch(S.watchId); S.watchId = null;
  setMyPos([ll.lat, ll.lng], 0, true);
  if (S.shareLoc) sendLoc(true);
  toast(POS_TOAST, `Posizione impostata: ${locLabel({ lat: ll.lat, lng: ll.lng })}`);
}
$('#pickCancel').addEventListener('click', endPick);

function showArea(lat, lng, nick) {
  if (isMobile()) setSheet('peek');
  areaCircle?.remove();
  areaCircle = L.circle([lat, lng], { radius: 120, color: '#2f80ed', weight: 2, fillColor: '#2f80ed', fillOpacity: .15 }).addTo(map)
    .bindTooltip(`${esc(nick)} è in questa zona`, { className: 'tip', permanent: true, direction: 'top' });
  map.flyTo([lat, lng], 17, { duration: .9 });
  setTimeout(() => { areaCircle?.remove(); }, 9000);
}
function renderPeoplePins() {
  if (!peopleLayer) return;
  peopleLayer.clearLayers();
  for (const u of S.users.values()) {
    if (!u.loc || u.nick === S.me.nick || !S.online.includes(u.nick)) continue;
    L.marker([u.loc.lat, u.loc.lng], { zIndexOffset: 1500, icon: L.divIcon({ className: 'person-pin', iconSize: [38, 38], iconAnchor: [19, 19], html: avatarHTML(u) }) })
      .bindTooltip(`${esc(u.nick)} · online`, { className: 'tip', direction: 'top', offset: [0, -20] })
      .on('click', () => openConv(u.nick)).addTo(peopleLayer);
  }
}

/* ================= PERSONE ================= */
function ago(t) {
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'pochi secondi fa';
  if (s < 3600) return `${Math.round(s / 60)} min fa`;
  if (s < 86400) { const h = Math.round(s / 3600); return `${h} ${h === 1 ? 'ora' : 'ore'} fa`; }
  if (s < 86400 * 7) { const d = Math.round(s / 86400); return d === 1 ? 'ieri' : `${d} giorni fa`; }
  return 'il ' + new Date(t).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}
function renderPeople() {
  const q = $('#peopleSearch').value.trim().toLowerCase();
  const all = [...S.users.values()].filter(u => !q || u.nick.toLowerCase().includes(q));
  const on = all.filter(u => S.online.includes(u.nick))
    .sort((a, b) => (b.nick === S.me.nick) - (a.nick === S.me.nick) || a.nick.localeCompare(b.nick));
  const off = all.filter(u => !S.online.includes(u.nick)).sort((a, b) => (b.seen || b.since || 0) - (a.seen || a.since || 0));
  let i = 0;
  const row = (u, isOn) => {
    const me = u.nick === S.me.nick;
    const zone = u.loc ? ` <span class="zone">· 📍 ${esc(locLabel(u.loc, !me))}</span>` : '';
    const status = (isOn ? 'Online ora' : u.seen ? `Visto ${ago(u.seen)}` : `Registrato ${ago(u.since)}`) + zone;
    return `<div class="person ${isOn ? 'on' : 'off'}" data-nick="${esc(u.nick)}" style="--i:${i++}">
      <div class="av-wrap">${avatarHTML(u)}<i class="status"></i></div>
      <div><h4>${esc(u.nick)}${me ? ' <small>(tu)</small>' : ''}</h4><p>${status}</p></div>
      ${me ? '' : '<button class="write" type="button">Scrivi</button>'}
    </div>`;
  };
  $('#peopleList').innerHTML = !all.length ? '<div class="empty"><b>🔎</b>Nessuna persona trovata.</div>' :
    `<div class="people-head on"><i></i>Online · ${on.length}</div>` +
    (on.map(u => row(u, true)).join('') || '<div class="empty" style="padding:14px">Nessuno online</div>') +
    `<div class="people-head"><i></i>Offline · ${off.length}</div>` +
    (off.map(u => row(u, false)).join('') || '<div class="empty" style="padding:14px">Tutti sono online! 🎉</div>');
  const b = $('#peopleBadge'); b.textContent = S.online.length; b.classList.toggle('show', S.online.length > 0);
}
$('#peopleSearch').addEventListener('input', renderPeople);
$('#peopleList').addEventListener('click', e => {
  const p = e.target.closest('.person'); if (p && p.dataset.nick !== S.me.nick) openConv(p.dataset.nick);
});
setInterval(() => { if (S.tab === 'people') renderPeople(); }, 60e3);

/* ================= INCONTRI ================= */
function fmtWhen(t) {
  const d = new Date(t), diff = t - Date.now();
  const day = fmtDay(t);
  if (diff < 0 && diff > -3 * 3600e3) return { txt: 'In corso · ' + fmtTime(t), soon: true };
  if (diff > 0 && diff < 3600e3) return { txt: `Tra ${Math.max(1, Math.round(diff / 60e3))} min`, soon: true };
  return { txt: `${day} · ${fmtTime(t)}`, soon: diff < 6 * 3600e3 };
}
function renderMeetups() {
  const list = [...S.meetups].sort((a, b) => a.when - b.when);
  $('#meetList').innerHTML = list.length ? list.map((m, i) => {
    const w = fmtWhen(m.when), inside = m.people.includes(S.me.nick);
    const faces = m.people.slice(0, 6).map(n => avatarHTML(S.users.get(n) || { nick: n })).join('');
    return `<li class="meet" style="animation-delay:${i * 50}ms">
      <span class="when ${w.soon ? 'soon' : ''}">${w.txt}</span>
      <h4>${esc(m.title)}</h4>
      <div class="where" data-place="${esc(m.place.id)}" data-lat="${m.place.lat}" data-lng="${m.place.lng}">📍 ${esc(m.place.name)} · proposto da ${esc(m.by)}</div>
      ${m.note ? `<p class="note">${esc(m.note)}</p>` : ''}
      <div class="meet-foot">
        <div class="faces">${faces}<small>${m.people.length} partecipant${m.people.length > 1 ? 'i' : 'e'}</small></div>
        <button class="join-btn ${inside ? 'in' : ''}" data-id="${m.id}">${inside ? 'Non vengo più' : 'Ci sono! 🙌'}</button>
      </div>
    </li>`;
  }).join('') : `<li class="empty"><b>📅</b>Nessun incontro in programma.<br>Scegli un posto sulla mappa e proponi tu il primo!</li>`;
}
$('#meetList').addEventListener('click', async e => {
  const b = e.target.closest('.join-btn');
  if (b) { b.disabled = true; try { await api('/api/meetup/toggle', { id: b.dataset.id }); } catch (err) { toast({ nick: 'Fano Insieme', emoji: '⚠️' }, err.message); } b.disabled = false; return; }
  const w = e.target.closest('.where');
  if (w) { if (S.byId.has(w.dataset.place)) openPlace(w.dataset.place, true); else map.flyTo([+w.dataset.lat, +w.dataset.lng], 17); }
});
function renderMeetPins() {
  if (!meetLayer) return;
  meetLayer.clearLayers();
  for (const m of S.meetups) {
    const icon = L.divIcon({ className: 'pin pin-meet big', iconSize: [40, 40], iconAnchor: [20, 40], html: '<div class="pin-in"><span>🎉</span></div>' });
    L.marker([m.place.lat, m.place.lng], { icon, zIndexOffset: 1000 })
      .bindTooltip(`${esc(m.title)} · ${esc(fmtWhen(m.when).txt)}`, { className: 'tip', direction: 'top', offset: [0, -40] })
      .on('click', () => { switchTab('meet'); if (S.byId.has(m.place.id)) openPlace(m.place.id); })
      .addTo(meetLayer);
  }
}

function openMeetDialog(placeId) {
  const sorted = [...S.places].sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || a.name.localeCompare(b.name));
  $('#meetPlace').innerHTML = `<option value="">Scegli un luogo…</option>` +
    `<optgroup label="Luoghi storici e mare">${sorted.filter(p => p.featured).map(p => `<option value="${p.id}">${esc(placeIcon(p))} ${esc(p.name)}</option>`).join('')}</optgroup>` +
    `<optgroup label="Locali">${sorted.filter(p => !p.featured).map(p => `<option value="${p.id}">${esc(placeIcon(p))} ${esc(p.name)}</option>`).join('')}</optgroup>`;
  $('#meetPlace').value = placeId || '';
  const p = S.byId.get(placeId);
  $('#meetTitle').value = p ? (p.cat === 'aperitivi' ? `Aperitivo da ${p.name}` : p.cat === 'ristoranti' ? `Cena da ${p.name}` : p.featured ? `Passeggiata: ${p.name}` : `Ci vediamo da ${p.name}`).slice(0, 60) : '';
  const d = new Date(Date.now() + 3600e3); d.setMinutes(0, 0, 0);
  const pad = n => String(n).padStart(2, '0');
  $('#meetWhen').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
  $('#meetNote').value = '';
  $('#meetDialog').showModal();
}
$('#newMeetBtn').addEventListener('click', () => openMeetDialog(S.selected));
$('#meetForm').addEventListener('submit', async e => {
  if (e.submitter?.value !== 'ok') return;
  e.preventDefault();
  const p = S.byId.get($('#meetPlace').value);
  if (!p) return $('#meetPlace').focus();
  $('#meetSubmit').disabled = true;
  try {
    await api('/api/meetup', { title: $('#meetTitle').value, note: $('#meetNote').value, when: new Date($('#meetWhen').value).toISOString(),
      place: { id: p.id, name: p.name, lat: p.lat, lng: p.lng } });
    $('#meetDialog').close(); closePlace(); switchTab('meet');
    confetti();
  } catch (err) { toast({ nick: 'Fano Insieme', emoji: '⚠️' }, err.message); }
  $('#meetSubmit').disabled = false;
});

function updateBadges() {
  const n = Object.entries(S.unread).reduce((a, [k, v]) => a + (S.tab === 'chat' && k === S.conv ? 0 : v), 0);
  const b = $('#chatBadge'); b.textContent = n; b.classList.toggle('show', n > 0);
  if (S.tab === 'meet') S.newMeets = 0;
  const mb = $('#meetBadge'); mb.textContent = S.newMeets || 0; mb.classList.toggle('show', (S.newMeets || 0) > 0);
}

/* ================= TOAST / CONFETTI ================= */
function toast(u, text, onClick, ms = 4200) {
  const el = document.createElement('div'); el.className = 'toast';
  el.innerHTML = `${avatarHTML(u)}<div><b>${esc(u.nick)}</b><span>${esc(text)}</span></div>`;
  el.onclick = () => { onClick?.(); el.remove(); };
  $('#toasts').prepend(el);
  while ($('#toasts').children.length > 3) $('#toasts').lastChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, ms);
}
function confetti() {
  const c = document.createElement('canvas'); c.style.cssText = 'position:fixed;inset:0;z-index:99;pointer-events:none';
  c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio; document.body.append(c);
  const g = c.getContext('2d'), cols = ['#e8643a', '#f2a541', '#19a974', '#5b5fc7', '#e46fa6', '#1f8fa3'];
  const ps = Array.from({ length: 140 }, () => ({ x: c.width / 2, y: c.height * .6, vx: (Math.random() - .5) * 26, vy: -Math.random() * 30 - 10, r: Math.random() * 7 + 4, c: cols[Math.random() * cols.length | 0], a: Math.random() * 6 }));
  let f = 0;
  (function tick() {
    g.clearRect(0, 0, c.width, c.height);
    for (const p of ps) { p.vy += .9; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.a += .2;
      g.save(); g.translate(p.x, p.y); g.rotate(p.a); g.fillStyle = p.c; g.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); g.restore(); }
    if (++f < 110) requestAnimationFrame(tick); else c.remove();
  })();
}

/* ================= TUTORIAL ================= */
const TUT = [
  { ico: '👋', g: ['#e8643a', '#f2a541'], t: 'Benvenuto a Fano Insieme', d: 'Scopri dove mangiare e fare l\'aperitivo a Fano, conosci persone nuove e organizzate incontri dal vivo.',
    pts: ['Ti basta un nickname: niente email, niente password', 'Funziona sia sul telefono che sul computer', 'Il nickname resta tuo su questo dispositivo'] },
  { ico: '🗺️', g: ['#1f8fa3', '#5b5fc7'], tab: 'explore', t: 'Esplora la mappa', d: 'Ristoranti, bar, caffè, gelaterie e luoghi storici come la Rocca Malatestiana e il Pincio.',
    pts: ['Tocca un segnaposto per aprire la scheda del luogo', 'I cerchi con un numero raggruppano più locali: toccali per avvicinarti', 'Usa i filtri in alto o cerca per nome e via', '🧭 Indicazioni apre il percorso su Google Maps'] },
  { ico: '💬', g: ['#c2417a', '#e8643a'], tab: 'chat', t: 'Chatta in Piazza', d: 'La Piazza è la chat di gruppo di tutti gli iscritti: chi è offline legge i messaggi quando rientra.',
    pts: ['Tocca il nome di qualcuno per scrivergli in privato', 'Con 📍 accanto al messaggio alleghi un locale', 'Toccando un locale in chat lo vedi sulla mappa'] },
  { ico: '👥', g: ['#19a974', '#1f8fa3'], tab: 'people', t: 'Trova persone', d: 'Nella scheda Persone vedi tutti gli iscritti.',
    pts: ['Il pallino verde indica chi è online adesso', 'Per gli offline vedi quando sono stati attivi l\'ultima volta', 'Premi Scrivi per iniziare una conversazione'] },
  { ico: '📅', g: ['#5b5fc7', '#c2417a'], tab: 'meet', t: 'Organizza un incontro', d: 'Decidete insieme dove vedervi.',
    pts: ['Apri un locale e premi "Proponi un incontro qui"', 'Scegli titolo, giorno e ora', 'Chi vuole venire preme "Ci sono! 🙌"', 'Gli incontri compaiono sulla mappa con 🎉'] },
  { ico: '📍', g: ['#2f80ed', '#1f8fa3'], tab: 'chat', t: 'La tua zona (facoltativa)', d: 'Puoi mostrare da che zona scrivi, così è più facile trovarsi.',
    pts: ['Nella chat premi "Attiva 📍" e consenti la posizione', 'Mostriamo solo la zona (circa 100 m), mai il punto esatto', 'Se il GPS non va, tocca la mappa per scegliere dove sei', 'Con 🎯 in alto vedi dove sei e i locali più vicini'] },
  { ico: '🛡️', g: ['#19a974', '#f2a541'], t: 'Incontri sicuri', d: 'Qualche regola di buon senso quando vi vedete dal vivo.',
    pts: ['Incontratevi in luoghi pubblici e frequentati', 'Non condividere indirizzo di casa, telefono o dati personali', 'Avvisa un amico di dove vai e con chi', 'Sii gentile: è una piazza per tutti 🙂'] },
];
let tutI = 0;
function openTutorial(at = 0) {
  tutI = at; $('#tut').hidden = false; $('#tut').classList.remove('closing');
  renderTut(); $('#tutNext').focus();
}
function closeTutorial() {
  store.set('fano.tutSeen', true);
  const t = $('#tut'); t.classList.add('closing');
  setTimeout(() => { t.hidden = true; t.classList.remove('closing'); }, 300);
}
function renderTut(dir) {
  const st = TUT[tutI], inApp = !$('#app').hidden;
  const stage = $('#tutStage');
  stage.innerHTML = `
    <div class="tut-hero" style="--g1:${st.g[0]};--g2:${st.g[1]}"><div class="tut-ico">${st.ico}</div><span class="tut-step">Passo ${tutI + 1} di ${TUT.length}</span></div>
    <div class="tut-body" style="--g1:${st.g[0]}">
      <h3 id="tutTitle">${st.t}</h3><p>${st.d}</p>
      <ul>${st.pts.map((p, i) => `<li style="--i:${i}">${esc(p)}</li>`).join('')}</ul>
      ${inApp && st.tab ? `<button class="tut-try" type="button" data-tab="${st.tab}">Provalo adesso →</button>` : ''}
    </div>`;
  stage.classList.remove('next', 'prev'); void stage.offsetWidth; if (dir) stage.classList.add(dir);
  $('#tutDots').innerHTML = TUT.map((_, i) => `<button type="button" class="${i === tutI ? 'on' : ''}" data-i="${i}" aria-label="Passo ${i + 1}"></button>`).join('');
  $('#tutPrev').disabled = tutI === 0;
  $('#tutNext').textContent = tutI === TUT.length - 1 ? 'Inizia! 🎉' : 'Avanti';
}
function tutGo(d) {
  const n = tutI + d;
  if (n >= TUT.length) return closeTutorial();
  if (n < 0) return;
  tutI = n; renderTut(d > 0 ? 'next' : 'prev');
}
$('#tutNext').addEventListener('click', () => tutGo(1));
$('#tutPrev').addEventListener('click', () => tutGo(-1));
$('#tutSkip').addEventListener('click', closeTutorial);
$('#tutDots').addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) { const i = +b.dataset.i; const d = i > tutI ? 'next' : 'prev'; tutI = i; renderTut(d); } });
$('#tutStage').addEventListener('click', e => {
  const b = e.target.closest('.tut-try'); if (!b) return;
  closeTutorial(); switchTab(b.dataset.tab);
});
$('#tut').addEventListener('click', e => { if (e.target.id === 'tut') closeTutorial(); });
addEventListener('keydown', e => {
  if ($('#tut').hidden) return;
  if (e.key === 'ArrowRight') tutGo(1);
  if (e.key === 'ArrowLeft') tutGo(-1);
  if (e.key === 'Escape') closeTutorial();
});
{ // swipe orizzontale sul telefono
  let x0 = null;
  $('#tutCard').addEventListener('pointerdown', e => { x0 = e.clientX; });
  $('#tutCard').addEventListener('pointerup', e => {
    if (x0 == null) return; const dx = e.clientX - x0; x0 = null;
    if (Math.abs(dx) > 60) tutGo(dx < 0 ? 1 : -1);
  });
}
$('#helpBtn').addEventListener('click', () => openTutorial());
$('#introHelp').addEventListener('click', () => openTutorial());

/* ================= ALTRO ================= */
$('#themeBtn').addEventListener('click', () => {
  const t = theme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t; store.set('fano.theme', t);
  document.querySelector('meta[name=theme-color]').content = t === 'dark' ? '#0b1622' : '#f4efe7';
});
{ const t = store.get('fano.theme'); if (t) document.documentElement.dataset.theme = t; }

$('#locateBtn').addEventListener('click', async () => {
  const b = $('#locateBtn'); if (b.classList.contains('busy')) return;
  b.classList.add('busy');
  try {
    const pos = await getPosition(), ll = [pos.coords.latitude, pos.coords.longitude];
    setMyPos(ll, pos.coords.accuracy);
    if (dist(ll, CENTER) > 15000) toast(POS_TOAST, 'Sembri lontano da Fano: le distanze sono calcolate da dove sei.');
    else map.flyTo(ll, 16);
  } catch (err) { posError(err, S.shareLoc); }
  b.classList.remove('busy');
});

$('#meChip').addEventListener('click', () => {
  $('#accNick').textContent = S.me.nick; setAvatar($('#accAvatar'), S.me);
  $('#accountDialog').showModal();
});
$('#accountDialog').addEventListener('close', async () => {
  const v = $('#accountDialog').returnValue;
  if (v === 'logout') logout();
  if (v !== 'delete') return;
  if (!confirm(`Eliminare per sempre l'account "${S.me.nick}"?\nNickname, messaggi e partecipazioni agli incontri verranno cancellati. Non si può annullare.`)) return;
  try {
    await api('/api/leave', {});
    S.me = null; store.set('fano.me', null);
    logout(); $('#joinBtn span').textContent = 'Entra';
  } catch (err) { toast({ nick: 'Fano Insieme', emoji: '⚠️' }, err.message); }
});
function logout() {
  disconnect();
  $('#app').hidden = true;
  const i = $('#intro'); i.hidden = false; i.classList.remove('leaving');
  $('#nickInput').value = S.me?.nick || '';
}

/* ================= AVVIO ================= */
fetch('/api/places').then(r => r.json()).then(list => {
  S.places = list; list.forEach(p => S.byId.set(p.id, p));
  countUp(); buildChips();
  if (S.me) { /* sessione salvata: entra subito */ api('/api/join', { nick: S.me.nick, emoji: S.me.emoji, token: S.me.token }).then(r => { S.me = r; store.set('fano.me', r); setTimeout(enterApp, 1500); }).catch(() => {}); }
});
requestAnimationFrame(moveInk);
