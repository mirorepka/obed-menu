// Stiahne dnešné obedové menu z webov reštaurácií (bez AI, len pravidlá) a vyrobí
// app/data/t/*.json (dlaždice ~10 × 7 km) + app/data/info.json.
// Spúšťa ho GitHub Actions každý pracovný deň, dá sa aj ručne:
//   node tools/update-menus.mjs            # všetky weby (≈ 20 min)
//   QUICK=1 node tools/update-menus.mjs    # len weby, kde už menu bolo
//   MENU_LIMIT=100 node tools/update-menus.mjs
//
// Zoznam podnikov je v data/places.json (vyrába ho tools/build-places.mjs).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(ROOT, 'cache');
const OUT_DIR = path.join(ROOT, 'app', 'data');
const QUICK = !!process.env.QUICK;
const LIMIT = +process.env.MENU_LIMIT || Infinity;
const UA = 'Mozilla/5.0 (compatible; obed-menu/1.0; +https://menu.repka.sk)';
const SKIP_HOSTS = /(^|\.)(facebook|fb|instagram|tripadvisor|google|goo\.gl|wolt|bolt|foodora|booking|linktr)\./i;
const TILE = 0.1;   // stupňe
const MAX_LINES = 30;

const WEEKDAYS = ['nedela', 'pondelok', 'utorok', 'streda', 'stvrtok', 'piatok', 'sobota'];
const now = new Date();
const day = process.env.MENU_DATE ? new Date(`${process.env.MENU_DATE}T12:00:00Z`) : now;   // MENU_DATE=2026-10-26 na skúšanie
const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
  .formatToParts(day).map((p) => [p.type, p.value]));
const TODAY = `${parts.year}-${parts.month}-${parts.day}`;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
const D = +parts.day, M = +parts.month, Y = +parts.year;
// dni tohto týždňa (po–ne) ako „d.m"
const WEEK = Array.from({ length: 7 }, (_, i) => {
  const d = new Date(Date.UTC(Y, M - 1, D - ((DOW + 6) % 7) + i));
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
});

const fold = (s) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const readJson = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };
const DAY_RE = /\b(pondelok|utorok|streda|stredu|stvrtok|piatok|sobota|nedela|pondeli|utery|ctvrtek|patek)\b/;
const TODAY_RE = new RegExp(`\\b${WEEKDAYS[DOW]}\\b`);
const DATE_RE = /\b(\d{1,2})\s*\.\s*(\d{1,2})\s*\.?/g;
const PRICE_RE = /(\d{1,3}[,.]\d{2})\s*(€|eur\b|,-)|€\s*(\d{1,3}[,.]\d{2})/i;

// ---------- sťahovanie a text ----------
async function get(url, timeout = 12000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8', 'Accept-Language': 'sk,cs;q=0.8,en;q=0.5' }, redirect: 'follow', signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (type.includes('pdf')) return { url: res.url, pdf: true };
  if (!/html|text/.test(type)) return { url: res.url };
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 3e6) return { url: res.url };
  let charset = (type.match(/charset=([\w-]+)/i) || [])[1];
  if (!charset) charset = (buf.subarray(0, 2048).toString('latin1').match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1] || 'utf-8';
  let html;
  try { html = new TextDecoder(charset.toLowerCase()).decode(buf); } catch { html = buf.toString('utf8'); }
  return { url: res.url, html };
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', ndash: '–', mdash: '—', middot: '·', bull: '•', hellip: '…', laquo: '«', raquo: '»', bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', sbquo: '‚', deg: '°', frac12: '½', szlig: 'ß' };
// písmená s diakritikou: &aacute; &scaron; &ocirc; &auml; …
const MARKS = { acute: '́', caron: '̌', circ: '̂', uml: '̈', grave: '̀', ring: '̊', tilde: '̃', cedil: '̧' };
const decode1 = (s) => s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') { try { return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)); } catch { return m; } }
  if (ENT[e.toLowerCase()]) return ENT[e.toLowerCase()];
  const k = e.match(/^([a-z])(acute|caron|circ|uml|grave|ring|tilde|cedil)$/i);
  return k ? (k[1] + MARKS[k[2].toLowerCase()]).normalize('NFC') : m;
});
const decode = (s) => decode1(decode1(s));   // niektoré weby majú &amp;eacute;
function htmlToLines(html) {
  return decode(html
    .replace(/<(script|style|noscript|svg|head|nav|footer)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d|\/section|\/article|\/dt|\/dd)\b[^>]*>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' \t ')
    .replace(/<[^>]+>/g, ' '))
    .split('\n')
    .map((l) => l.replace(/\s*\t\s*/g, '  ').replace(/[  ]+/g, ' ').trim())
    .filter(Boolean);
}

function links(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(decode(m[1]), base);
      if (/^https?:$/.test(url.protocol)) out.push({ url: url.href, text: decode(m[2].replace(/<[^>]+>/g, ' ')).trim().slice(0, 80) });
    } catch { /* zlý odkaz */ }
  }
  return out;
}

function linkScore({ url, text }) {
  let s = '';
  try { s = fold(`${text} ${decodeURIComponent(url)}`); } catch { s = fold(`${text} ${url}`); }
  let score = 0;
  if (/denn\w*[\s_-]*menu|obedov\w*[\s_-]*menu|menu[\s_-]*dna|tyzdenn\w*[\s_-]*menu|denni[\s_-]*menu|daily[\s_-]*menu|lunch|obed|vecern\w*[\s_-]*menu/.test(s)) score += 10;
  else if (/\bmenu\b|jedal|ponuk/.test(s)) score += 3;
  if (/napoj|vin[ao]|drink|wine|alergen|kariera|gdpr|cookies|catering|rozvoz/.test(s)) score -= 6;
  return score;
}

// ---------- dnešné menu z textu ----------
const isEnd = (f) => /alergen|copyright|©|vsetky prava|kontakt|otvaracie hodiny|rezervaci|newsletter|cookies|gdpr/.test(f) && !PRICE_RE.test(f);
const SOUP = /polievk|polevk|vyvar|kapustnic|bors|\bkrem\b|kremov|gulasov|slepac|cesnack|drzkov|fazulovic|sosovicov|hrachov|kulajd/;
const MAIN = /ryz|zemiak|hranol|knedl|halusk|rezen|rezn|steak|sote|prsia|stehn|kare\b|panenk|krkovic|rizot|cestovin|penne|spaget|tagliat|pizza|burger|gyros|priloh|kasa|lokse|piroh|tortil|salat|gulas\b|perkelt|wok|curry/;
const FOOD = /polievk|polevk|vyvar|kapustnic|krem|kurac|kura\b|bravc|hovad|telec|kacac|morc|jahnac|ryz|zemiak|hranol|knedl|cestovin|spaget|penne|halusk|gulas|rizot|steak|rezen|syr|omack|salat|pyre|ryb|losos|pstruh|pizza|burger|tortil|wrap|lasagn|gnocch|nok|palacink|buchty|nakyp|segedin|sekan|klobas|zelenin|fazul|sosovic|hrach|cicer|tofu|kapust|loks|piroh|slanin|maso|masom|filet|panenk|krkovic|stehn|prs|plnen|pecen|dusen|vypraz|grilov|kari\b|curry|wok|tarhon|kuskus|bulgur|ragu|perkelt|paprikas|bolonsk|carbonar|chilli|gyros|kebab|cevap|fasirk|vajic|huby|hubov|sampinon|dezert|kolac|strudl|zavitk|ryzot/;
const JUNK = /\?|objedn|rozvoz|donask|dovoz|balenie|plati |zlav|telef|tel\.|www\.|@|http|otvaraci|podavame|alergen|vaha |uveden|dobru chut|prajeme|rezervac|kontakt|prosim|\bobal\b|termo|krabick|\bkav[ai]\b|prosecco|\bpivo\b|kofola|birell|napoj|limonad|\bcaj\b|cena polievk|v cene/;

// Deň v týždni (0 = nedeľa), ktorým riadok začína (alebo krátky nadpis s dňom/dátumom); -1 = žiadny
const DAY_WORDS = { nedela: 0, pondelok: 1, pondeli: 1, utorok: 2, utery: 2, streda: 3, stredu: 3, stvrtok: 4, ctvrtek: 4, piatok: 5, patek: 5, sobota: 6 };
const DAY_ABBR = { ne: 0, po: 1, ut: 2, st: 3, 'št': 4, pi: 5, so: 6 };
function dayOf(line, f) {
  let m = f.match(/^[^\p{L}\d]*(nedela|pondelok|pondeli|utorok|utery|streda|stredu|stvrtok|ctvrtek|piatok|patek|sobota)\b/u);
  if (m) return DAY_WORDS[m[1]];
  m = line.toLowerCase().match(/^[^\p{L}\d]*(ne|po|ut|st|št|pi|so)\s*[:.)–-]/u);
  if (m) return DAY_ABBR[m[1]];
  if (f.length < 70 && !PRICE_RE.test(f)) {
    m = f.match(DAY_RE);
    if (m && DAY_WORDS[m[1]] !== undefined) return DAY_WORDS[m[1]];
    const i = WEEK.findIndex((d) => datesIn(f).includes(d));
    if (i >= 0 && f.replace(DATE_RE, '').replace(/\d{4}/, '').replace(/[^\p{L}]/gu, '').length < 12) return (i + 1) % 7;
  }
  return -1;
}
// Zvyšok riadku za názvom dňa / dátumom
const afterDay = (line) => line.replace(/^[^\p{L}\d]*(\p{L}{2,9}\s*[:.)–-]?)?\s*(\d{1,2}\s*\.\s*\d{1,2}\s*\.?\s*(\d{4})?)?\s*[:–-]?\s*/u, '');

function datesIn(f) {
  return [...f.matchAll(DATE_RE)].map((m) => [+m[1], +m[2]]).filter(([d, m]) => d >= 1 && d <= 31 && m >= 1 && m <= 12).map(([d, m]) => `${d}.${m}`);
}

// Očistí názov jedla od čísel, gramáže a alergénov
function clean(line) {
  for (let i = 0; i < 2; i++) {
    line = line
      .replace(/~?\s*alerg[ée]n\w*\s*:?.*$/i, '')
      .replace(/\bkj\s*:?\s*\d+/gi, ' ')
      .replace(/\s+\/\s+(?=[A-Za-z][^/]{12,}$)[^áäčďéíĺľňóôŕšťúýžÁÄČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ/]*$/, '')   // anglický preklad za lomkou
      .replace(/\s*\((?=[^)]*(?:obilnin|vajc|mliek|lepok|zeler|horčic|orech|sója|ryby|sezam|araš|v cene))[^)]*\)/gi, '')
      .replace(/\(\s*\)/g, ' ')
      .replace(/\s*\/\s*a\s*(?::\s*[\d,\s]*)?\s*$/i, '')
      .replace(/^\s*(?:menu\s*)?(?:[ivx]{1,4}|m\.?\s*\d{1,2})\s*[.:)\-–]?\s+(?=\p{L})/iu, '')
      .replace(/\b\d+(?:[,.]\d+)?\s*(?:g|gr|ml|l|ks|dcl|dl|cl|kg)\b\.?/gi, ' ')
      .replace(/\b\d{2,3}(?:\s*\/\s*\d{2,3})+\s*\/?|^\s*\d{2,3}\s*\/\s*/g, ' ')
      .replace(/\s*\((?:\s*[a-z]?\s*\d{1,2}\s*[,.;]?)+\)/gi, '')
      .replace(/\s*\/\s*(?:a\s*)?[\d,.\s]+\/?\s*$/i, '')
      .replace(/\s*\/\s*(?:lepok|lakt|vaj[ií]|bezlep|zeler|hor[čc]|orech|s[óo]j|ryb|mliek)[^/]*\/?\s*$/i, '')
      .replace(/\b(?:bez(?:lepkov|lakt[óo]zov)\p{L}*)/giu, ' ')
      .replace(/(?:\s*(?:a\s*)?[\d]{1,2}(?:\s*[,.\s]\s*\d{1,2})+[,.]?|\s+\d{1,2})\s*$/i, '')
      .replace(/^\s*(?:menu\s*)?(?:[a-z]{0,2}\d{1,2}|[a-z])\s*[.):/]+(?!\d)\s*/i, '')
      .replace(/^\s*\d[,.]\s+/, '')
      .replace(/^[-–•*·|:,;/\s]+|[-–•*·|:,;/\s]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  return line;
}

const EVENING_HEAD = /vecern\w*\s*(menu|ponuk)|^vecer[ae]\b|\bdinner\b|evening menu/;

// Vráti { items: [[druh, názov, cena, večer?]], price } alebo null.
// pageMeal = 1, ak je celá stránka večerné menu (napr. odkaz „Večerné menu").
function todaysMenu(lines, pageMeal = 0) {
  const folded = lines.map(fold);
  const all = folded.join('\n');
  if (!/polievk|polevk|polievok|hlavn\w* jedl|menu/.test(all)) return null;
  // Ak sú na stránke dátumy, aspoň jeden musí byť z tohto týždňa (inak je menu staré)
  const dates = datesIn(all);
  if (dates.length && !dates.some((d) => WEEK.includes(d))) return null;

  const days = lines.map((l, i) => dayOf(l, folded[i]));
  const today = `${D}.${M}`;
  // Či ide o obed (0) alebo večeru (1): podľa najbližšieho nadpisu „… menu" nad úsekom
  const mealAt = (i) => {
    for (let j = i; j >= Math.max(0, i - 80); j--) {
      const f = folded[j];
      if (f.length > 60) continue;
      if (EVENING_HEAD.test(f)) return 1;
      if (/obedov\w* menu|denn\w* menu|menu dna|denni menu|\bobed\b|lunch/.test(f)) return 0;
    }
    return pageMeal;
  };
  // Úseky s dnešným dňom – môže ich byť viac (napr. obedové a potom večerné menu na celý týždeň)
  const segs = [];
  for (let i = 0; i < lines.length; i++) {
    const isToday = days[i] === DOW || (folded[i].length < 90 && datesIn(folded[i]).includes(today) && !PRICE_RE.test(folded[i]));
    if (!isToday) continue;
    let end = i + 1;
    while (end < lines.length && end - i <= MAX_LINES && (days[end] === -1 || days[end] === DOW) && !isEnd(folded[end])) end++;
    segs.push({ meal: mealAt(i), lines: [afterDay(lines[i]), ...lines.slice(i + 1, end)] });
    i = end - 1;
  }
  if (!segs.length) {
    // stránka bez dní: len jedno menu, a to ak je pri ňom dnešný dátum
    if (!dates.includes(today) || days.some((d) => d >= 0)) return null;
    const start = folded.findIndex((f) => /denn\w* menu|obedov\w* menu|menu dna|denni menu/.test(f) || EVENING_HEAD.test(f));
    if (start < 0) return null;
    let end = start + 1;
    while (end < lines.length && end - start <= MAX_LINES && !isEnd(folded[end])) end++;
    segs.push({ meal: EVENING_HEAD.test(folded[start]) ? 1 : pageMeal, lines: lines.slice(start + 1, end) });
  }

  const items = [];
  let price = '';
  for (const seg of segs) {
  let kind = 1, sinceHeader = 0, priceNext = false, meal = seg.meal;
  for (let line of seg.lines) {
    if (dayOf(line, fold(line)) === DOW) line = afterDay(line);
    // „Polievka: …", „Polievka dňa: …" → polievka bez predpony
    const soupPrefix = /^\s*(?:polievk[ay]|pol\.)\s*(?:d[ňn]a|\d)?\s*[:\-–,]\s*|^\s*polievk[ay]\s+(?=\p{Lu})/iu;
    const isSoupLine = soupPrefix.test(line);
    if (isSoupLine) line = line.replace(soupPrefix, '').replace(/^polievk[ay],?\s*/i, '');
    const f = fold(line);
    if (f.length > 220 || !f) continue;
    // nadpisy „Večerné menu" / „Obedové menu" vnútri dňa
    if (f.length < 40 && EVENING_HEAD.test(f) && !PRICE_RE.test(f)) { meal = 1; kind = 1; continue; }
    if (f.length < 40 && /^(obedov\w* menu|obed\b|denn\w* menu)/.test(f) && !PRICE_RE.test(f)) { meal = 0; kind = 1; continue; }
    if (/^(polievk|polevk)/.test(f) && f.length < 25) { kind = 0; sinceHeader = 0; continue; }
    if (/^(hlavn|jedla\b|menu\s*\d?\s*:?$)/.test(f) && f.length < 25) { kind = 1; continue; }
    if (/^(dezert|zakusk)/.test(f) && f.length < 20) { kind = 2; continue; }
    const pm = line.match(PRICE_RE);
    const p = pm ? `${(pm[1] || pm[3]).replace('.', ',')} €` : '';
    if (pm) line = line.replace(pm[0], ' ');
    // spoločná cena menu (cena môže byť aj na ďalšom riadku)
    if (/cena menu|menu cena|^cena\b|cena obed/.test(f) && !/cena polievk/.test(f)) {
      if (p) price = p; else priceNext = true;
      continue;
    }
    line = clean(line);
    // samotná cena (alebo len alergény) → patrí k predošlému jedlu
    if (!/\p{L}{3}/u.test(line)) {
      if (p && priceNext) price = p;
      else if (p && items.length && !items.at(-1)[2]) items.at(-1)[2] = p;
      priceNext = false;
      continue;
    }
    priceNext = false;
    const lf = fold(line);
    if (JUNK.test(lf) || (!p && !FOOD.test(lf))) continue;
    // riadok bez ceny začínajúci malým písmenom = pokračovanie názvu (príloha)
    if (!p && items.length && !items.at(-1)[2] && /^[a-zà-ž(,]/.test(line) && items.at(-1)[1].length < 90) { items.at(-1)[1] += `, ${line}`; continue; }
    if (items.some((x) => x[1] === line.slice(0, 120) && (x[3] || 0) === meal)) continue;   // rovnaké jedlo viackrát (tabuľky)
    if (p && parseFloat(p.replace(',', '.')) > 25) continue;        // to nie je obedové menu (hostiny, catering…)
    const soupName = isSoupLine || /polievk|polevk|vyvar|\bkrem\b|kremov/.test(lf)
      || ((SOUP.test(lf) || /^\p{L}+ova\b/u.test(lf)) && lf.length < 50 && !MAIN.test(lf));
    const soup = kind !== 2 && items.filter((x) => x[0] === 0 && (x[3] || 0) === meal).length < 3 && (soupName || (kind === 0 && sinceHeader < 2 && !MAIN.test(lf)));
    const k = soup ? 0 : kind === 0 ? 1 : kind;
    sinceHeader++;
    items.push(meal ? [k, line.slice(0, 120), p, 1] : [k, line.slice(0, 120), p]);   // 4. pole = večerné menu
  }
  }
  // aspoň dve jedlá, väčšina naozaj jedlá, a aspoň niečo s cenou (inak to asi nie je menu)
  const food = items.filter((x) => FOOD.test(fold(x[1]))).length;
  if (items.length < 2 || items.length > 30 || food < 2 || food < items.length * 0.6) return null;
  if (!items.some((x) => x[2]) && !price) return null;
  return { items, price };
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k], k); }
  }));
}

// Nájde menu na webe podniku. Výsledok: { url, menu } | { url, link: true } | null
const isEveningLink = (l) => { try { return /vecer|dinner/.test(fold(`${l.text} ${decodeURIComponent(l.url)}`)); } catch { return false; } };

async function findMenu(web, known) {
  const tried = new Set();
  const evening = new Set();   // odkazy na samostatné večerné menu
  let bestLink = null;
  const consider = async (url, depth, meal = 0) => {
    if (tried.has(url) || tried.size > 8) return null;
    tried.add(url);
    let page;
    try { page = await get(url); } catch { return null; }
    if (page.pdf) { bestLink ??= { url: page.url, link: true }; return null; }
    if (!page.html) return null;
    const host = new URL(page.url).hostname.replace(/^www\./, '');
    const all = links(page.html, page.url).filter((l) => new URL(l.url).hostname.replace(/^www\./, '') === host || /\.pdf\b/i.test(l.url));
    all.filter((l) => isEveningLink(l) && linkScore(l) > 0).forEach((l) => evening.add(l.url));
    const menu = todaysMenu(htmlToLines(page.html), meal);
    if (menu) return { url: page.url, menu };
    if (depth > 0) {
      const sub = all
        .map((l) => ({ ...l, s: linkScore(l) }))
        .filter((l) => l.s > 0)
        .sort((a, b) => b.s - a.s);
      const seen = new Set();
      for (const l of sub) {
        if (seen.size >= 3) break;
        if (seen.has(l.url)) continue;
        seen.add(l.url);
        if (l.s >= 10) bestLink ??= { url: l.url, link: true };
        const r = await consider(l.url, depth - 1, isEveningLink(l) ? 1 : 0);
        if (r) return r;
      }
    }
    return null;
  };
  let r = known ? await consider(known, 0) : null;
  if (!r) r = await consider(web, 1);
  if (!r) return bestLink;
  // Našlo sa len obedové menu → skúsiť aj samostatnú stránku s večerným menu
  if (!r.menu.items.some((x) => x[3])) {
    for (const url of [...evening].filter((u) => !tried.has(u)).slice(0, 2)) {
      const e = await consider(url, 0, 1);
      if (e) {
        r.menu.items.push(...e.menu.items.filter((x) => x[3]));
        r.evening = e.url;
        break;
      }
    }
  }
  return r;
}

// ---------- beh ----------
const { places } = readJson(path.join(ROOT, 'data', 'places.json'), { places: [] });
// Ručné opravy údajov z OpenStreetMap (zlý web, kaviareň, ktorá je reštaurácia, chýbajúci podnik…)
const fixes = readJson(path.join(ROOT, 'data', 'fixes.json'), { fix: {}, add: [] });
for (const p of places) {
  const f = fixes.fix[p[0]];
  if (f) { if (f.web !== undefined) p[5] = f.web; if (f.amenity) p[4] = f.amenity; if (f.name) p[1] = f.name; }
}
places.push(...fixes.add.map((a) => [a.id, a.name, a.lat, a.lon, a.amenity || 'restaurant', a.web || '', a.addr || '', a.city || '']));
fs.mkdirSync(CACHE_DIR, { recursive: true });
const sources = readJson(path.join(CACHE_DIR, 'sources.json'), {});   // id → url, kde bolo naposledy menu
const prev = readJson(path.join(CACHE_DIR, 'today.json'), {});
const results = prev.date === TODAY ? prev.results : {};              // id → dnešný výsledok (z predošlého behu)

const hostOk = (w) => { try { return !SKIP_HOSTS.test(new URL(w).hostname); } catch { return false; } };
let todo = places.filter((p) => p[5] && hostOk(p[5]) && !results[p[0]]?.menu);
if (QUICK) todo = todo.filter((p) => sources[p[0]] || results[p[0]]?.link);
if (process.env.MENU_ONLY) todo = todo.filter((p) => process.env.MENU_ONLY.split(',').includes(p[0]));   // na skúšanie konkrétnych podnikov
todo = todo.slice(0, LIMIT);
console.log(`${TODAY}: prechádzam ${todo.length} webov${QUICK ? ' (rýchly beh)' : ''}…`);

let done = 0, nMenu = 0, nLink = 0;
await pool(todo, 16, async (p) => {
  const [id, , , , , web] = p;
  try {
    const r = await findMenu(web, sources[id]);
    if (r) {
      results[id] = r;
      if (r.menu) { sources[id] = r.url; nMenu++; } else nLink++;
    }
  } catch { /* nedostupný web */ }
  if (++done % 200 === 0) console.log(`  ${done}/${todo.length} · menu: ${nMenu}, odkaz: ${nLink}`);
});

fs.writeFileSync(path.join(CACHE_DIR, 'sources.json'), JSON.stringify(sources));
fs.writeFileSync(path.join(CACHE_DIR, 'today.json'), JSON.stringify({ date: TODAY, results }));

// ---------- výstup po dlaždiciach ----------
fs.rmSync(path.join(OUT_DIR, 't'), { recursive: true, force: true });
fs.mkdirSync(path.join(OUT_DIR, 't'), { recursive: true });
const tiles = new Map();
let total = 0, totalEve = 0;
for (const [id, name, lat, lon, amenity, web, addr] of places) {
  const r = results[id];
  if (!r && !/restaurant|pub|canteen|food_court/.test(amenity)) continue;   // kaviarne a fast food bez menu nezobrazujeme
  const key = `${Math.floor(lat / TILE)}_${Math.floor(lon / TILE)}`;
  if (!tiles.has(key)) tiles.set(key, []);
  const row = { n: name, lat, lon };
  if (amenity === 'canteen') row.c = 1;
  if (addr) row.addr = addr;
  if (web) row.web = web;
  if (r?.menu) {
    row.url = r.url; row.items = r.menu.items;
    if (r.menu.price) row.price = r.menu.price;
    if (r.evening) row.eve = r.evening;
    total++;
    if (r.menu.items.some((x) => x[3])) totalEve++;
  }
  else if (r?.link) row.url = r.url;
  tiles.get(key).push(row);
}
for (const [key, rows] of tiles) fs.writeFileSync(path.join(OUT_DIR, 't', `${key}.json`), JSON.stringify(rows));
fs.writeFileSync(path.join(OUT_DIR, 'info.json'), JSON.stringify({ date: TODAY, updated: now.toISOString(), menus: total, tile: TILE }));
console.log(`Hotovo: ${total} reštaurácií s dnešným menu, z toho ${totalEve} aj s večerným (${nMenu} nových, ${nLink} len odkaz), ${tiles.size} dlaždíc.`);
