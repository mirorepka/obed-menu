'use strict';

const WALK_M_PER_SEC = 1.3;
const DETOUR = 1.3;            // vzdušná čiara → reálna cesta
const MAX_WALK_MIN = 15;
const RADIUS_M = (MAX_WALK_MIN * 60 * WALK_M_PER_SEC) / DETOUR;   // ≈ 900 m vzdušne
const OTHERS_COUNT = 10;
const RERENDER_MOVE_M = 40;
const KINDS = ['Polievka', '', 'Dezert'];
const SK_BBOX = [47.7, 16.8, 49.65, 22.6];   // juh, západ, sever, východ

const $ = (id) => document.getElementById(id);
const state = { info: null, tiles: new Map(), pos: null, manual: null, locError: null, watchId: null, renderedAt: null };

// ---------- pomocné ----------
function distM(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * r / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const walkMin = (m) => Math.max(1, Math.round((m * DETOUR) / WALK_M_PER_SEC / 60));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const origin = () => state.manual || state.pos;
const navUrl = (p) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}&travelmode=walking`;
const inSlovakia = (o) => o.lat >= SK_BBOX[0] && o.lat <= SK_BBOX[2] && o.lon >= SK_BBOX[1] && o.lon <= SK_BBOX[3];

// ---------- dáta ----------
// Dlaždice, ktoré pokrývajú okruh okolo miesta
function tileKeys(o) {
  const t = state.info.tile;
  const dLat = RADIUS_M / 111320, dLon = RADIUS_M / (111320 * Math.cos(o.lat * Math.PI / 180));
  const keys = new Set();
  for (const la of [o.lat - dLat, o.lat + dLat]) for (const lo of [o.lon - dLon, o.lon + dLon]) keys.add(`${Math.floor(la / t)}_${Math.floor(lo / t)}`);
  return [...keys];
}
async function loadTiles(keys) {
  await Promise.all(keys.filter((k) => !state.tiles.has(k)).map(async (k) => {
    try {
      const res = await fetch(`data/t/${k}.json?d=${state.info.date}`);
      state.tiles.set(k, res.ok ? await res.json() : []);
    } catch { /* bez internetu – skúsime nabudúce */ }
  }));
}

// ---------- vykreslenie ----------
function dishes(r) {
  return `<ul class="dishes">${r.items.map(([k, name, price]) =>
    `<li><span>${KINDS[k] ? `<span class="k">${KINDS[k]}</span>` : ''}${esc(name)}</span><span class="p">${esc(price)}</span></li>`).join('')}</ul>`;
}
const meta = (r) => (r.addr ? `<p class="r-meta">${esc(r.addr)}</p>` : '');
const priceTag = (r) => (r.price ? `<span class="tag">💶 Menu ${esc(r.price)}</span>` : '');
function actions(r) {
  return `<div class="actions">
    <a class="btn" href="${esc(navUrl(r))}" target="_blank" rel="noopener">🧭 Navigovať</a>
    <a class="btn ghost" href="${esc(r.url)}" target="_blank" rel="noopener">Menu na webe</a></div>`;
}

function renderBest(r) {
  return `<section class="card">
    <p class="muted" style="margin:0">Najbližšie obedové menu</p>
    <div class="r-head"><p class="r-name">${esc(r.n)}</p><span class="dist">🚶 ${walkMin(r.d)} min</span></div>
    ${meta(r)}${priceTag(r)}${dishes(r)}${actions(r)}</section>`;
}

function renderMore(list) {
  if (!list.length) return '';
  return '<section class="card"><h2>Ďalšie menu v okolí</h2>' + list.map((r) => {
    const main = r.items.find(([k]) => k === 1) || r.items[0];
    return `<details class="more" data-n="${esc(r.n)}"><summary>
      <span><b>${esc(r.n)}</b><span class="sub">${esc(main[1])}${r.items.length > 1 ? ` + ${r.items.length - 1}` : ''}</span></span>
      <span class="dist">🚶 ${walkMin(r.d)} min</span></summary>
      ${meta(r)}${priceTag(r)}${dishes(r)}${actions(r)}</details>`;
  }).join('') + '</section>';
}

function renderPlain(list, title, note) {
  if (!list.length) return '';
  return `<section class="card"><h2>${title}</h2>${note ? `<p class="muted tiny">${note}</p>` : ''}<ul class="plain">` +
    list.map((o) => {
      const href = o.url || o.web;
      const name = href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(o.n)}</a>` : esc(o.n);
      return `<li><span>${name}${o.c ? ' <span class="sub">(jedáleň)</span>' : ''}</span><span class="d">🚶 ${walkMin(o.d)} min</span></li>`;
    }).join('') + '</ul></section>';
}

async function render() {
  const main = $('main');
  if (!state.info) return;
  const o = origin();
  if (!o) {
    if (state.locError) {
      main.innerHTML = `<section class="card"><p class="big">Neviem, kde si 🤷</p>
        <p class="muted">${esc(state.locError)}</p>
        <p class="muted">Klikni hore na <b>✏️ Iné miesto</b> a napíš, kde chceš obedovať.</p></section>`;
    }
    return;
  }
  state.renderedAt = { lat: o.lat, lon: o.lon };
  if (!inSlovakia(o)) {
    main.innerHTML = '<section class="card"><p class="big">Tu menu nemám 🗺️</p><p class="muted">Obedové menu zbieram len na Slovensku.</p></section>';
    return;
  }

  const keys = tileKeys(o);
  if (keys.some((k) => !state.tiles.has(k))) {
    if (!main.querySelector('.r-name')) main.innerHTML = '<section class="card"><p class="big">Hľadám obedy v okolí… 🍽️</p></section>';
    await loadTiles(keys);
    if (origin() !== o) return;   // medzitým sa poloha zmenila
  }
  // zapamätať otvorené položky, aby sa pri prekreslení nezatvorili
  const open = new Set([...main.querySelectorAll('details[open]')].map((d) => d.dataset.n));

  const near = keys.flatMap((k) => state.tiles.get(k) || [])
    .map((r) => ({ ...r, d: distM(o.lat, o.lon, r.lat, r.lon) }))
    .filter((r) => r.d <= RADIUS_M)
    .sort((a, b) => a.d - b.d);
  const now = new Date();
  const fresh = state.info.date === ymd(now);
  const menus = fresh ? near.filter((r) => r.items) : [];
  const links = near.filter((r) => !r.items && r.url);
  const others = near.filter((r) => !r.items && !r.url).slice(0, OTHERS_COUNT);

  let html = '';
  if (menus.length) {
    html += renderBest(menus[0]) + renderMore(menus.slice(1));
  } else {
    const weekend = now.getDay() === 0 || now.getDay() === 6;
    const why = !fresh
      ? (weekend ? 'Cez víkend väčšina reštaurácií denné menu nemá.' : now.getHours() < 11 ? 'Dnešné menu ešte zbieram – skús to o chvíľu (okolo 10:00).' : 'Dnešné menu sa nepodarilo načítať.')
      : `Do ${MAX_WALK_MIN} minút pešo som dnes menu na webe žiadnej reštaurácie nenašiel.`;
    html += `<section class="card"><p class="big">Menu tu nemám 😕</p><p class="muted">${why}</p></section>`;
  }
  html += renderPlain(links, 'Menu na webe', 'Tieto podniky majú menu na webe (napr. v PDF alebo obrázku) – otvor odkaz.');
  html += renderPlain(others, menus.length ? 'Ďalšie reštaurácie v okolí' : 'Reštaurácie v okolí', near.length ? '' : '');
  if (!near.length) html += `<section class="card"><p class="muted">Do ${MAX_WALK_MIN} minút pešo nepoznám žiadnu reštauráciu.</p></section>`;
  main.innerHTML = html;
  main.querySelectorAll('details').forEach((d) => { if (open.has(d.dataset.n)) d.open = true; });
}

// ---------- iné miesto ----------
const RECENT_KEY = 'recentPlaces';
function recentPlaces() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; }
}
function rememberPlace(p) {
  const list = [p, ...recentPlaces().filter((x) => x.name !== p.name)].slice(0, 5);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* nevadí */ }
}

let searchTimer = null, searchSeq = 0;
function renderPlacePicker() {
  const raw = $('placeSearch').value.trim();
  const items = [{ icon: '📍', name: 'Podľa polohy', gps: true }];
  if (!raw) recentPlaces().forEach((p) => items.push({ icon: '🕘', ...p }));
  state.placeItems = items;
  const list = $('placeList');
  const row = (it, i) => `<li><button data-i="${i}"><span>${it.icon} ${esc(it.name)}</span><span class="d">${esc(it.sub || '')}</span></button></li>`;
  list.innerHTML = items.map(row).join('');

  clearTimeout(searchTimer);
  if (raw.length < 3) return;
  list.insertAdjacentHTML('beforeend', '<li class="muted" id="placeLoading">Hľadám…</li>');
  const seq = ++searchSeq;
  searchTimer = setTimeout(async () => {
    let found = [];
    try {
      let url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&accept-language=sk&countrycodes=sk&q=' + encodeURIComponent(raw);
      const o = origin();
      if (o) url += `&viewbox=${o.lon - 0.5},${o.lat + 0.3},${o.lon + 0.5},${o.lat - 0.3}`;
      found = await (await fetch(url)).json();
    } catch { /* bez internetu */ }
    if (seq !== searchSeq) return;
    $('placeLoading')?.remove();
    const base = state.placeItems.length;
    const places = found.map((r) => {
      const parts = r.display_name.split(', ');
      return { icon: '🏁', name: r.name || parts.slice(0, 2).join(' '), sub: parts.slice(r.name ? 1 : 2, 3).join(', '), lat: +r.lat, lon: +r.lon };
    });
    state.placeItems.push(...places);
    list.insertAdjacentHTML('beforeend', places.length ? places.map((it, i) => row(it, base + i)).join('') : '<li class="muted">Nič som nenašiel. Skús napísať inak.</li>');
  }, 600);
}

function setManual(p) {
  state.manual = p;
  $('whereName').textContent = p ? `🏁 ${p.name}` : '📍 Podľa polohy';
  if (!p) startLocation();
  render();
}

// ---------- poloha ----------
function startLocation() {
  if (!('geolocation' in navigator)) {
    state.locError = 'Tento prehliadač nevie zistiť polohu.';
    render();
    return;
  }
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = navigator.geolocation.watchPosition(
    (p) => {
      state.pos = { lat: p.coords.latitude, lon: p.coords.longitude };
      state.locError = null;
      const last = state.renderedAt;
      if (!state.manual && (!last || distM(last.lat, last.lon, state.pos.lat, state.pos.lon) > RERENDER_MOVE_M)) render();
    },
    (e) => {
      state.locError = e.code === 1
        ? 'Poloha nie je povolená. Povoľ ju v nastaveniach prehliadača pre túto stránku.'
        : 'Polohu sa nepodarilo zistiť. Skús to vonku alebo o chvíľu.';
      if (!state.pos) render();
    },
    { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 }
  );
}

// ---------- inštalácia aplikácie ----------
const IOS_STEPS = ['Dole ťukni na <b>Zdieľať</b> (štvorček so šípkou ⬆️)', 'Vyber <b>Pridať na plochu</b>', 'Ťukni na <b>Pridať</b>'];
const MENU_STEPS = ['Ťukni na menu prehliadača <b>⋮</b>', 'Vyber <b>Pridať na plochu</b> alebo <b>Inštalovať aplikáciu</b>'];

function setupInstall() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return;
  let dismissed = false;
  try { dismissed = sessionStorage.getItem('installLater') === '1'; } catch { /* súkromné okno */ }
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const box = $('install'), btn = $('installBtn'), later = $('installLater'), footerBtn = $('installFooter');
  let deferred = null;   // udalosť prehliadača, ktorá otvorí inštalačné okno

  const hide = () => box.classList.add('hidden');
  const offerButton = () => {
    $('installText').textContent = 'Budeš ju mať na ploche ako ostatné aplikácie a otvoríš ju jedným ťuknutím.';
    btn.classList.remove('hidden');
    later.textContent = 'Neskôr';
    box.classList.remove('hidden');
  };
  const showSteps = (steps) => {
    $('installText').innerHTML = `Budeš ju mať na ploche ako ostatné aplikácie:<ol class="ios-steps">${steps.map((x) => `<li>${x}</li>`).join('')}</ol>`;
    btn.classList.add('hidden');
    later.textContent = 'Rozumiem';
    box.classList.remove('hidden');
  };
  const install = async () => {
    if (!deferred) { showSteps(ios ? IOS_STEPS : MENU_STEPS); box.scrollIntoView({ behavior: 'smooth' }); return; }
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    if (outcome === 'accepted') hide();
  };

  btn.onclick = install;
  // tlačidlo dole je stále po ruke – aj keď ponuku hore zavrieš
  footerBtn.classList.remove('hidden');
  footerBtn.onclick = install;
  later.onclick = () => {
    hide();
    try { sessionStorage.setItem('installLater', '1'); } catch { /* nevadí */ }
  };
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    if (!dismissed) offerButton();
  });
  window.addEventListener('appinstalled', () => { hide(); footerBtn.classList.add('hidden'); });

  if (dismissed) return;
  if (ios) showSteps(IOS_STEPS);
  else if (matchMedia('(pointer: coarse)').matches) setTimeout(() => { if (!deferred) showSteps(MENU_STEPS); }, 2500);
}

// ---------- štart ----------
async function loadInfo() {
  let info;
  try {
    info = await (await fetch('data/info.json')).json();
  } catch {
    if (!state.info) $('main').innerHTML = '<section class="card"><p class="big">Nepodarilo sa načítať menu 😕</p><p class="muted">Skontroluj internet a skús znova.</p></section>';
    return;
  }
  if (!state.info || info.updated !== state.info.updated) state.tiles.clear();   // nové menu → načítať dlaždice znova
  state.info = info;
  const u = new Date(info.updated);
  $('dataInfo').textContent = `Menu aktualizované ${u.getDate()}. ${u.getMonth() + 1}. o ${u.getHours()}:${String(u.getMinutes()).padStart(2, '0')}. `
    + 'Menu sa automaticky sťahuje z webov reštaurácií a môže obsahovať chyby. Pred cestou si ho over na ich webe. Mapové dáta © OpenStreetMap.';
  render();
}

async function init() {
  setupInstall();
  $('placeBtn').onclick = () => { $('placePicker').classList.remove('hidden'); $('placeSearch').value = ''; renderPlacePicker(); $('placeSearch').focus(); };
  $('closePlace').onclick = () => $('placePicker').classList.add('hidden');
  $('placeSearch').oninput = renderPlacePicker;
  $('placeList').onclick = (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const it = state.placeItems[+b.dataset.i];
    $('placePicker').classList.add('hidden');
    if (it.gps) { setManual(null); return; }
    const p = { name: it.name, sub: it.sub, lat: it.lat, lon: it.lon };
    rememberPlace(p);
    setManual(p);
  };

  startLocation();
  await loadInfo();
  // menu sa doobeda dopĺňa → občas skontrolovať, či je novšie
  setInterval(loadInfo, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadInfo(); });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
