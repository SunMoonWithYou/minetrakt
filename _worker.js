const APP_VERSION = "6.6.10";
const APP_JS_VERSION = APP_VERSION;
const APP_CSS_VERSION = APP_VERSION;
const TRAKT_AUTH = "https://auth.trakt.tv";
const TRAKT_API = "https://api.trakt.tv";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p";
const ACTIVATE_URL = "https://trakt.tv/activate";
const OMDB_API = "https://www.omdbapi.com";
const DOUBAN_SEARCH = "https://search.douban.com/movie/subject_search";
const DOUBAN_API = "https://raw.githubusercontent.com/MakkaPakka518/List/main/data/douban-hot.json";
const THEATER_API = "https://raw.githubusercontent.com/MakkaPakka518/List/main/data/theater-data.json";
const GUDUO_API = "https://raw.githubusercontent.com/MakkaPakka518/List/main/data/guduo-hot.json";
const APP_NAME = "MineTrakt";
const APP_SHORT_NAME = APP_NAME;
const THEME_COLOR = "#050505";
const THEME_STORAGE_KEY = "mt:theme";
const THEME_COLOR_DARK = THEME_COLOR;
const THEME_COLOR_LIGHT = "#ffffff";
const BJ_OFFSET_MS = 8 * 3600 * 1000;
const THEME_BOOT_SCRIPT = `<script>(function(){try{var K=${JSON.stringify(THEME_STORAGE_KEY)};var t=localStorage.getItem(K);if(t!=='light'&&t!=='dark'&&t!=='system')t='dark';var d=document.documentElement;var dark=(t==='dark')||(t==='system'&&(!window.matchMedia||matchMedia('(prefers-color-scheme: dark)').matches));var resolved=t==='system'?(dark?'dark':'light'):t;d.setAttribute('data-theme',resolved);d.setAttribute('data-theme-pref',t);var c=dark?${JSON.stringify(THEME_COLOR_DARK)}:${JSON.stringify(THEME_COLOR_LIGHT)};var tc=document.querySelector('meta[name="theme-color"]');if(tc)tc.setAttribute('content',c);var cs=document.querySelector('meta[name="color-scheme"]');if(cs)cs.setAttribute('content',dark?'dark':'light');var sb=document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');if(sb)sb.setAttribute('content',dark?'black-translucent':'default');d.style.backgroundColor=c;}catch(e){}})();<\/script>`;

const FAVICON_URL = "/assets/favicon.ico";
const ICON_192 = "/assets/icon-192.png";
const ICON_512 = "/assets/icon-512.png";
const APPLE_ICON = "/assets/icon-512.png";
const SPLASH_LOGO = "/assets/logo.png";

const ASSET_ORIGINS = {
  "/assets/favicon.ico": [
    "https://i.ibb.co/s9tgxVhb/Mine-Trakt-icon-32x32.png",
    "image/png",
  ],
  "/assets/icon-192.png": [
    "https://i.ibb.co/wZ2Z8Gkj/Mine-Trakt-logo-192x192.png",
    "image/png",
  ],
  "/assets/icon-512.png": [
    "https://i.ibb.co/Xx8q97CH/Mine-Trakt-logo-512x512.png",
    "image/png",
  ],
  "/assets/logo.png": [
    "https://i.ibb.co/0jsGWrwK/Mine-Trakt-logo.png",
    "image/png",
  ],
};

let __chromeMajorCached = 0;

let __chromeMajorOverride = 0;
let __uaOverride = "";

function chromeMajorForUA() {
  if (__chromeMajorOverride) return __chromeMajorOverride;
  if (__chromeMajorCached) return __chromeMajorCached;
  const ANCHOR_MAJOR = 120;
  const ANCHOR_MS = Date.UTC(2023, 11, 1);
  const weeks = Math.floor((Date.now() - ANCHOR_MS) / (7 * 86400 * 1000));
  __chromeMajorCached = Math.min(
    175,
    Math.max(ANCHOR_MAJOR, ANCHOR_MAJOR + Math.floor(weeks / 4) - 3),
  );
  return __chromeMajorCached;
}

function traktAuthUa() {
  if (__uaOverride) return __uaOverride;
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajorForUA()}.0.0.0 Safari/537.36`;
}

function appUserAgent() {
  return `MineTrakt/${APP_VERSION} (+https://trakt.real-mrtang.workers.dev; Cloudflare-Worker)`;
}

function browserFetchHeaders() {
  const v = chromeMajorForUA();
  return {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Referer: "https://trakt.tv/",
    "sec-ch-ua": `"Chromium";v="${v}", "Not=A?Brand";v="24"`,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
  };
}

function authJsonHeaders() {
  return {
    "Content-Type": "application/json",
    "User-Agent": traktAuthUa(),
    ...browserFetchHeaders(),
  };
}

function siteHeaders() {
  return {
    "User-Agent": traktAuthUa(),
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  };
}

let __cookieSecret = "";

let __sharedEnvRef = null;

async function initEnvRuntime(env) {

  __sharedEnvRef = env || null;
  if (__cookieSecret) return;
  if (env && env.COOKIE_SECRET) {
    __cookieSecret = env.COOKIE_SECRET;
  } else if (env && env.TMDB_CACHE && typeof env.TMDB_CACHE.get === "function") {
    const SECRET_KEY = "sys:cookie_secret";
    try {
      let s = await env.TMDB_CACHE.get(SECRET_KEY);
      if (!s) {

        const buf = new Uint8Array(32);
        crypto.getRandomValues(buf);
        s = [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
        await env.TMDB_CACHE.put(SECRET_KEY, s);
      }
      __cookieSecret = s;
    } catch {

      __cookieSecret = env.TRAKT_CLIENT_ID || "minetrakt-dev-fallback";
    }
  } else {
    __cookieSecret =
      (env && env.TRAKT_CLIENT_ID) || "minetrakt-dev-fallback";
  }
  if (env && typeof env.TRAKT_UA_OVERRIDE === "string" && env.TRAKT_UA_OVERRIDE)
    __uaOverride = env.TRAKT_UA_OVERRIDE;
  const cm = Number(env && env.CHROME_UA_MAJOR);
  if (Number.isFinite(cm) && cm >= 100) __chromeMajorOverride = Math.floor(cm);
}

function __utf8Bytes(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 128) out.push(c);
    else if (c < 2048) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 55296 || c >= 57344)
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else {
      i++;
      const cp = 0x10000 + ((c & 1023) << 10) + (str.charCodeAt(i) & 1023);
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 63),
        0x80 | ((cp >> 6) & 63),
        0x80 | (cp & 63),
      );
    }
  }
  return out;
}

function __sha256Bytes(bytes) {
  const rrot = (v, n) => (v >>> n) | (v << (32 - n));
  const K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ];
  let H = [
    0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
    0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19,
  ];
  const msg = bytes.slice();
  const bitLen = msg.length * 8;
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  for (let i = 0; i < 8; i++)
    msg.push(Math.floor(bitLen / Math.pow(2, (7 - i) * 8)) & 255);
  const w = new Array(64);
  for (let off = 0; off < msg.length; off += 64) {
    for (let i = 0; i < 16; i++)
      w[i] =
        (msg[off + i * 4] << 24) |
        (msg[off + i * 4 + 1] << 16) |
        (msg[off + i * 4 + 2] << 8) |
        msg[off + i * 4 + 3];
    for (let i = 16; i < 64; i++) {
      const s0 = rrot(w[i - 15], 7) ^ rrot(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rrot(w[i - 2], 17) ^ rrot(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3],
        e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rrot(e, 6) ^ rrot(e, 11) ^ rrot(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rrot(a, 2) ^ rrot(a, 13) ^ rrot(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H = [
      (H[0] + a) | 0, (H[1] + b) | 0, (H[2] + c) | 0, (H[3] + d) | 0,
      (H[4] + e) | 0, (H[5] + f) | 0, (H[6] + g) | 0, (H[7] + h) | 0,
    ];
  }
  const out = [];
  for (const x of H) out.push((x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255);
  return out;
}

function __hmacSha256Hex(key, msg) {
  let k = __utf8Bytes(key);
  if (k.length > 64) k = __sha256Bytes(k);
  while (k.length < 64) k.push(0);
  const oKey = k.map((b) => b ^ 0x5c);
  const iKey = k.map((b) => b ^ 0x36);
  const inner = __sha256Bytes(iKey.concat(__utf8Bytes(msg)));
  const mac = __sha256Bytes(oKey.concat(inner));
  return mac.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function cookieSigHex(payloadB64) {
  return __hmacSha256Hex(__cookieSecret || "minetrakt-dev-fallback", payloadB64);
}

function sameOriginGuard(request) {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin" && site !== "same-site" && site !== "none")
    return new Response("cross-site request blocked", { status: 403 });
  const origin = request.headers.get("Origin");
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(request.url).host)
        return new Response("cross-origin request blocked", { status: 403 });
    } catch {
      return new Response("bad origin", { status: 403 });
    }
  }
  return null;
}

const COOKIE_NAME = "trakt_auth";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 90;
const PROFILE_COOKIE = "trakt_profile";
const PAGE_SIZE = 20;
const TMDB_KV_TTL = 86400 * 14;
const OMDB_KV_TTL = 86400 * 14;
const WATCHLIST_PAGE_SIZE = 30;
const WATCHLIST_KV_TTL = 28800;
const CALENDAR_KV_TTL = 28800;
const TREND_KV_TTL = 86400;
const MISS_KV_TTL = 300;
const MISS_STALE_RETENTION = 60;
const HISTORY_KV_TTL = 5400;
const PLAYBACK_KV_TTL = 5400;
const USER_SHORT_STALE_RETENTION = 3600;
const STATS_KV_TTL = 604800;
const PROFILE_KV_TTL = 86400;
const ENTITY_KV_TTL = 86400 * 14;
const SEASON_KV_TTL = 86400 * 14;
const SEASON_KV_TTL_LIVE = 86400;
const DOUBAN_KV_TTL = 12 * 3600;
const THEATER_KV_TTL = 12 * 3600;
const GUDUO_KV_TTL = 12 * 3600;
const PLATFORM_KV_TTL = 6 * 3600;
const PUBLIC_STALE_RETENTION = 24 * 3600;
const KV_STALE_RETENTION = 86400 * 2;
const LAST_GOOD_KV_TTL = 86400 * 3;
const SIG_CHECK_INTERVAL_MINUTES = 15;
const HOME_AUTO_REFRESH_MINUTES = SIG_CHECK_INTERVAL_MINUTES;
const PLAYBACK_FRESH_SEC = SIG_CHECK_INTERVAL_MINUTES * 60;
const CC_NO_STORE = "no-store";
const CT_JSON = "application/json; charset=utf-8";
const CT_HTML = "text/html; charset=utf-8";

const CACHE_USER_LONG = {
  missTtl: 60,
  swr: true,
  unwrap: true,
  jitter: 300,
};

const CACHE_USER_META = {
  missTtl: 180,
  swr: true,
  jitter: 300,
};

function cacheUser(extra) {
  return Object.assign({}, CACHE_USER_LONG, extra || {});
}

function jsonResp(data, headers, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign(
      { "Content-Type": CT_JSON, "Cache-Control": CC_NO_STORE },
      headers || {},
    ),
  });
}

const __enrichHits = new Map();

function clientIp(request) {

  return request.headers.get("CF-Connecting-IP") || "unknown";
}

const __AUTH_CD_PREFIX = "https://mt-internal.invalid/__authcd/";

async function authCooldownRemaining(ip) {
  try {
    const hit = await caches.default.match(
      __AUTH_CD_PREFIX + encodeURIComponent(ip),
    );
    if (!hit) return 0;
    const until = Number(await hit.text()) || 0;
    return Math.max(0, Math.ceil((until - Date.now()) / 1000));
  } catch {
    return 0;
  }
}

async function markAuthCooldown(ip, sec, ctx) {
  if (!ip || ip === "unknown") return;
  const s = Math.max(1, Math.min(Number(sec) || 30, 900));
  try {
    const p = caches.default.put(
      new Request(__AUTH_CD_PREFIX + encodeURIComponent(ip)),
      new Response(String(Date.now() + s * 1000), {
        headers: { "Cache-Control": `public, max-age=${s}` },
      }),
    );
    if (ctx && typeof ctx.waitUntil === "function")
      ctx.waitUntil(p.catch(() => {}));
    else await p;
  } catch {}
}

function allowEnrich(request) {
  const ip = clientIp(request);
  const now = Date.now();
  const arr = (__enrichHits.get(ip) || []).filter((t) => now - t < 60000);
  if (arr.length >= 60) {
    __enrichHits.set(ip, arr);
    return false;
  }
  arr.push(now);
  __enrichHits.set(ip, arr);
  if (__enrichHits.size > 2000) {
    for (const [k, v] of __enrichHits) {
      const last = v && v.length ? v[v.length - 1] : 0;
      if (!last || now - last > 60000) __enrichHits.delete(k);
    }
  }
  return true;
}

const CK = {

  playback: (u) => `pb:v2:${u}`,
  stats: (u) => `stats:${u}`,
  profile: (u) => `prof:${u}:me`,
  history: (u, p = 1) => `hist:${u}:p${p}`,
  calendar: (u, day) => `cal:${u}:${day}`,
  watchProgress: (u, id) => `tpr:${u}:${id}`,
  movieHistory: (u, id) => `tmh:${u}:${id}`,
  showPlayback: (u, id) => `spb:${u}:${id}`,

  playbackList: (u) => `pbl:${u}`,
  watchedEpisodes: (u) => `we:v2:${u}`,
  watchedMovies: (u) => `wm:v1:${u}`,
  cwHide: (u) => `cwh:${u}`,
  entity: (t, id) => `te:${t}:${id}`,
  season: (id, n) => `ts:${id}:${n}`,
  traktSearch: (t, id) => `tsp:${t}:${id}`,
  watchlist: (u, v, s) => `wl:${u}:${v}:${s}`,
  watchlistVersion: (u) => `wlv:${u}`,
  omdb: (id) => `omdb:${id}`,
  enrich: (k) => `e:${k}`,
  enrichBucket: (b) => `eb:v1:${b}`,
  pbImages: (u) => `pbi:${u}`,
  wlImages: (u) => `wli:${u}`,
  calImages: (u) => `cali:${u}`,
  histImages: (u) => `histi:${u}`,
  trend: (p) => `trend:day:${p}`,

  reco: (u) => `reco:${u}`,
  tmdb: (p) => `td:${p}`,
  douban: "douban:v1:all",
  theater: "theater:v1:all",
  guduo: "guduo:v1:all",
  platform: (id, page, media) => `plat:${id}:${media}:p${page}`,
  platformPreviews: "plat:pv:v1",
  uidRt: (rt) => `uid:rt:${rt}`,
  uidAt: (at) => `uid:at:${at}`,
  moreHistory: (u, p) => `more:hist:${u}:p${p}`,
  morePlayback: (u, p, l) => `more:pb:v4:${u}:p${p}:l${l}`,

  syncState: (u) => `sync:${u || "anon"}`,

  progressDirty: (u) => `tpred:${u}`,
  lastGood: {
    playback: (u) => `lg:pb:${u}`,
    history: (u, p = 1) => `lg:hist:${u}:p${p}`,
    calendar: (u) => `lg:cal:${u}`,
    watchlist: (u, s = "added") => `lg:wl:${u}:${s}`,

    watchedEpisodes: (u) => `lg:we:${u}`,

    watchProgress: (u, id) => `lg:tpr:${u}:${id}`,
  },
};

function seasonIsDone(data) {
  const eps = data && Array.isArray(data.episodes) ? data.episodes : null;
  if (!eps || !eps.length) return false;
  const now = Date.now();
  for (const ep of eps) {
    if (!ep) continue;
    const air = ep.first_aired ? Date.parse(ep.first_aired) : NaN;
    if (!Number.isFinite(air) || air > now) return false;
  }
  return true;
}

const seasonTtl = (data) =>
  seasonIsDone(data) ? SEASON_KV_TTL : SEASON_KV_TTL_LIVE;

async function fetchT(url, opts = {}, ms = 8000, userKey) {
  const isAuthHost = TRAKT_AUTH_HOST_RE.test(url);
  const release =
    TRAKT_HOST_RE.test(url) &&
    (await traktGate(userKey, opts.method, isAuthHost));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
    if (release) release();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const backoff = (i, base = 500, jitter = 500) =>
  sleep(base * (i + 1) + Math.random() * jitter);

const TRAKT_AUTH_HOST_RE = /^https?:\/\/auth\.trakt\.tv\//i;
const TRAKT_HOST_RE = /^https?:\/\/(?:api|auth)\.trakt\.tv\//i;
const TRAKT_MIN_GAP_MS = 2000;
const TRAKT_USER_GAP_MS = 2000;
const TRAKT_GAP_MAX_WAIT_MS = 20000;
const TRAKT_WRITE_GAP_MS = 2000;
const TRAKT_WRITE_USER_GAP_MS = 2000;
const TRAKT_WINDOW_MS = 300000;
const TRAKT_WINDOW_LIMIT = 350;
const TRAKT_SOFT_RATIO = 0.65;
const TRAKT_USER_JITTER_MS = 600;

let __traktTail = Promise.resolve();

let __traktLast = 0;

const __traktUserLast = new Map();
const __traktWin = [];

function traktWindowCount(nowMs) {
  const cut = (nowMs || Date.now()) - TRAKT_WINDOW_MS;
  while (__traktWin.length && __traktWin[0] <= cut) __traktWin.shift();
  return __traktWin.length;
}

function traktWindowPressure() {
  return traktWindowCount() / TRAKT_WINDOW_LIMIT;
}

function __traktTrimUsers(uk) {
  if (__traktUserLast.size > 300) {

    const keys = [...__traktUserLast.entries()]
      .sort((a, b) => a[1] - b[1])
      .map((e) => e[0]);
    for (let i = 0; i < keys.length - 150; i++) {
      if (keys[i] !== uk) __traktUserLast.delete(keys[i]);
    }
  }
}

function __traktMarkUsed(uk) {
  const t = Date.now();
  __traktLast = t;
  __traktUserLast.set(uk, t);
  __traktWin.push(t);
  __traktTrimUsers(uk);
  return t;
}

function __traktSerial(uk, minGap, userGap) {
  const gap = minGap != null ? minGap : TRAKT_MIN_GAP_MS;
  const uGap = userGap != null ? userGap : TRAKT_USER_GAP_MS;
  const prev = __traktTail;
  let release;
  __traktTail = new Promise((r) => (release = r));
  return prev.then(async () => {
    try {
      const now = Date.now();
      const wait = Math.max(
        __traktLast + gap - now,
        (__traktUserLast.get(uk) || 0) + uGap - now,
        0,
      );
      if (wait > 0) await sleep(Math.min(wait, TRAKT_GAP_MAX_WAIT_MS));

      const extra = Math.max(0, 1000 - (Date.now() - (__traktLast || 0)));
      if (extra > 0) await sleep(Math.min(extra, 1200));
    } finally {
      __traktMarkUsed(uk);
      release();
    }
  });
}

const TRAKT_AUTH_GAP_MS = 1500;
const TRAKT_AUTH_MAX_WAIT_MS = 3000;

let __traktAuthTail = Promise.resolve();

let __traktAuthLast = 0;

function __traktAuthSerial() {
  const prev = __traktAuthTail;
  let release;
  __traktAuthTail = new Promise((r) => (release = r));
  return prev.then(async () => {
    try {
      const wait = Math.max(
        0,
        __traktAuthLast + TRAKT_AUTH_GAP_MS - Date.now(),
      );

      if (wait > 0) await sleep(Math.min(wait, TRAKT_AUTH_MAX_WAIT_MS));
    } finally {
      __traktAuthLast = Date.now();
      release();
    }
  });
}

async function traktGate(userKey, method, isAuthHost) {
  const uk = userKey || "__anon__";

  if (isAuthHost) {
    await __traktAuthSerial();
    return null;
  }
  const isWrite = !!method && String(method).toUpperCase() !== "GET";
  const pressure = traktWindowPressure();

  if (pressure >= 1) {
    const now = Date.now();
    const oldest = __traktWin[0] || now;
    const wait = Math.min(
      TRAKT_GAP_MAX_WAIT_MS,
      Math.max(0, TRAKT_WINDOW_MS - (now - oldest)) + 50,
    );
    if (wait > 0) await sleep(wait);
  }

  await __traktSerial(
    uk,
    isWrite ? TRAKT_WRITE_GAP_MS : TRAKT_MIN_GAP_MS,
    isWrite ? TRAKT_WRITE_USER_GAP_MS : TRAKT_USER_GAP_MS,
  );
  return null;
}

const TRAKT_RATE_LIMIT_COOLDOWN = 60000;
const TRAKT_RATE_LIMIT_MAX_COOLDOWN = 300000;
const __traktRateLimitByUser = new Map();
const __traktStrikes = new Map();
const __traktRateLimitSource = new Map();

function isTraktRateLimited(userKey) {
  const k = userKey || "__anon__";
  const until = __traktRateLimitByUser.get(k) || 0;
  return Date.now() < until;
}

function traktRateLimitedRemaining(userKey) {
  const k = userKey || "__anon__";
  const until = __traktRateLimitByUser.get(k) || 0;
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

function markTraktRateLimited(ms, userKey, source = "trakt") {
  const k = userKey || "__anon__";
  const strikes = (__traktStrikes.get(k) || 0) + 1;
  __traktStrikes.set(k, strikes);
  const exp = Math.min(
    TRAKT_RATE_LIMIT_MAX_COOLDOWN,
    TRAKT_RATE_LIMIT_COOLDOWN * Math.pow(2, strikes - 1),
  );
  const wait = Math.max(
    exp,
    Math.min(Number(ms) || 0, TRAKT_RATE_LIMIT_MAX_COOLDOWN),
  );
  const until = Date.now() + wait;
  const cur = __traktRateLimitByUser.get(k) || 0;
  if (until > cur) __traktRateLimitByUser.set(k, until);
  const prevSrc = __traktRateLimitSource.get(k);
  if (source === "cloudflare" || !prevSrc)
    __traktRateLimitSource.set(k, source === "cloudflare" ? "cloudflare" : "trakt");

  kvPutCooldown("sys:trakt:cd:u:" + k, until);
  if (source === "cloudflare") kvPutCooldown("sys:trakt:cd:g", until);
  if (__traktRateLimitByUser.size > 500) {
    const now = Date.now();
    for (const [key, v] of __traktRateLimitByUser) {
      if (v < now) {
        __traktRateLimitByUser.delete(key);
        __traktRateLimitSource.delete(key);
      }
    }
  }
  if (__traktStrikes.size > 500) {
    for (const key of __traktStrikes.keys()) {
      if (!__traktRateLimitByUser.has(key)) __traktStrikes.delete(key);
    }
  }
  return wait;
}
function traktRateLimitedSource(userKey) {
  return __traktRateLimitSource.get(userKey || "__anon__") || "trakt";
}
function rateLimitMessage(source, cooling) {
  const sec = cooling != null && Number(cooling) > 0 ? Math.ceil(Number(cooling)) : 0;
  const isCf = source === "cloudflare";
  if (sec > 0) {
    return isCf
      ? `被 Cloudflare 拦截，限流冷却中，约 ${sec} 秒后再试（期间显示缓存，请勿反复操作）`
      : `Trakt 限流中，约 ${sec} 秒后再试（期间显示缓存，请勿反复操作）`;
  }
  return isCf
    ? "被 Cloudflare 拦截，请稍后再试（当前显示缓存）"
    : "Trakt 限流，请稍后再试（当前显示缓存）";
}

function clearTraktStrikes(userKey) {
  const k = userKey || "__anon__";
  if (__traktStrikes.size && __traktStrikes.has(k)) __traktStrikes.delete(k);
}

function consumeRetryAfter(r, userKey) {
  const ra = parseInt(r.headers.get("Retry-After") || "", 10);
  const waitMs =
    Number.isFinite(ra) && ra > 0
      ? Math.min(ra * 1000, TRAKT_RATE_LIMIT_MAX_COOLDOWN)
      : 0;
  return markTraktRateLimited(waitMs, userKey);
}

const TRAKT_CD_KV_GLOBAL = "sys:trakt:cd:g";
const TRAKT_CD_KV_USER = "sys:trakt:cd:u:";
const TRAKT_CD_KV_CHECK_GAP_MS = 20000;
const __traktCdKvChecked = new Map();

function kvPutCooldown(key, untilTs) {
  const env = __sharedEnvRef;
  try {
    if (!env || !env.TMDB_CACHE || typeof env.TMDB_CACHE.put !== "function")
      return;
    const ttlSec = Math.ceil((untilTs - Date.now()) / 1000) + 5;
    if (ttlSec < 5) return;
    env.TMDB_CACHE.put(key, String(untilTs), {
      expirationTtl: Math.min(ttlSec, 3600),
    }).catch(() => {});
  } catch {}
}

async function syncTraktCooldownFromKV(userKey) {
  const uk = userKey || "__anon__";
  try {
    if (isTraktRateLimited(uk)) return traktRateLimitedRemaining(uk);
    const env = __sharedEnvRef;
    if (!env || !env.TMDB_CACHE || typeof env.TMDB_CACHE.get !== "function")
      return 0;
    const now = Date.now();
    if (now - (__traktCdKvChecked.get(uk) || 0) < TRAKT_CD_KV_CHECK_GAP_MS)
      return traktRateLimitedRemaining(uk);
    __traktCdKvChecked.set(uk, now);
    const vals = await Promise.all([
      env.TMDB_CACHE.get(TRAKT_CD_KV_GLOBAL).catch(() => null),
      env.TMDB_CACHE.get(TRAKT_CD_KV_USER + uk).catch(() => null),
    ]);
    for (const v of vals) {
      const until = parseInt(String(v || ""), 10);
      if (!Number.isFinite(until) || until <= now) continue;

      const cur = __traktRateLimitByUser.get(uk) || 0;
      if (until > cur) __traktRateLimitByUser.set(uk, until);
    }
    return traktRateLimitedRemaining(uk);
  } catch {
    return traktRateLimitedRemaining(uk);
  }
}

function classifyRateLimit(res, bodyText = "") {
  const ra = parseInt(res.headers.get("Retry-After") || "", 10);
  const cfMit = res.headers.get("cf-mitigated") || "";
  const xrl =
    res.headers.get("X-Ratelimit") || res.headers.get("x-ratelimit") || "";
  const text = String(bodyText || "");
  let source = "trakt";
  if (xrl) source = "trakt";
  else if (cfMit) source = "cloudflare";
  else if (/error code:\s*1015/i.test(text) || /cf-ray/i.test(text))
    source = "cloudflare";
  let waitMs =
    Number.isFinite(ra) && ra > 0
      ? Math.min(ra * 1000, TRAKT_RATE_LIMIT_MAX_COOLDOWN)
      : 0;
  if (source === "cloudflare" || cfMit)
    waitMs = Math.max(waitMs, TRAKT_RATE_LIMIT_MAX_COOLDOWN);
  return { source, waitMs, cfMitigated: cfMit || null, ratelimit: xrl || null };
}

function authRateLimitWaitSec(
  res,
  { wafSec = 300, defaultSec = 30, maxSec = 180 } = {},
) {
  const wafBlocked = !!res.headers.get("cf-mitigated");
  if (wafBlocked) return wafSec;
  const ra = parseInt(res.headers.get("Retry-After") || "", 10);
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra, maxSec);
  return defaultSec;
}

const TRAKT_MAX_INFLIGHT = 5;
const TRAKT_USER_WINDOW_MAX = 40;
const TRAKT_GLOBAL_WINDOW_MAX = 90;
const TRAKT_BUDGET_WINDOW_MS = 60000;

let __traktInflight = 0;

const __traktUserHits = new Map();

let __traktGlobalHits = [];

function __trimWindow(arr, now, keepFrom) {
  let i = 0;
  while (i < arr.length && arr[i] <= keepFrom) i++;
  if (i) arr.splice(0, i);
  return arr.length;
}

function traktBudgetCheck(userKey) {
  const now = Date.now();
  const from = now - TRAKT_BUDGET_WINDOW_MS;
  __trimWindow(__traktGlobalHits, now, from);
  if (__traktGlobalHits.length >= TRAKT_GLOBAL_WINDOW_MAX) return 1500;
  const uk = userKey || "__anon__";
  let hits = __traktUserHits.get(uk);
  if (!hits) {
    hits = [];
    __traktUserHits.set(uk, hits);
  }
  __trimWindow(hits, now, from);
  if (hits.length >= TRAKT_USER_WINDOW_MAX) {

    return Math.max(300, hits[0] + TRAKT_BUDGET_WINDOW_MS - now);
  }
  if (__traktInflight >= TRAKT_MAX_INFLIGHT) return 300;
  return 0;
}

function traktBudgetTake(userKey) {
  const now = Date.now();
  __traktInflight++;
  __traktGlobalHits.push(now);
  const uk = userKey || "__anon__";
  let hits = __traktUserHits.get(uk);
  if (!hits) {
    hits = [];
    __traktUserHits.set(uk, hits);
  }
  hits.push(now);
}

function traktBudgetRelease() {
  if (__traktInflight > 0) __traktInflight--;
}

let __nitroDownUntil = 0;

const NITRO_DOWN_TTL_MS = 6 * 60 * 60 * 1000;

function traktBudgetStats(userKey) {
  const now = Date.now();
  const from = now - TRAKT_BUDGET_WINDOW_MS;
  __trimWindow(__traktGlobalHits, now, from);
  const uk = userKey || "__anon__";
  const hits = __traktUserHits.get(uk);
  const used = hits ? __trimWindow(hits, now, from) : 0;
  return {
    inflight: __traktInflight,
    maxInflight: TRAKT_MAX_INFLIGHT,
    userUsed: used,
    userMax: TRAKT_USER_WINDOW_MAX,
    globalUsed: __traktGlobalHits.length,
    globalMax: TRAKT_GLOBAL_WINDOW_MAX,
    windowSec: Math.round(TRAKT_BUDGET_WINDOW_MS / 1000),
    throttled: traktBudgetCheck(userKey) > 0,
    nitroDownFor: __nitroDownUntil > now ? Math.round((__nitroDownUntil - now) / 1000) : 0,
  };
}

function __sweepTraktBudget() {
  const now = Date.now();
  if (__traktUserHits.size > 800) {
    for (const [k, arr] of __traktUserHits) {
      __trimWindow(arr, now, now - TRAKT_BUDGET_WINDOW_MS);
      if (!arr.length) __traktUserHits.delete(k);
    }
  }
}

async function __traktFetchInner(
  url,
  headers,
  { retries = 2, timeout = 12000, userKey, wantPageCount = false, backoffBase = 500 } = {},
  errShape,
) {
  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetchT(url, { headers }, timeout, userKey);
      if (r.status === 401) {

        markTokenInvalid(headers);
        return {
          __error: "HTTP 401",
          __unauthorized: true,
          ...errShape,
        };
      }
      if (r.status === 429) {

        if (r.headers.get("cf-mitigated"))
          markTraktRateLimited(TRAKT_RATE_LIMIT_MAX_COOLDOWN, userKey, "cloudflare");
        else consumeRetryAfter(r, userKey);
        return {
          __error: "HTTP 429",
          __cooling: traktRateLimitedRemaining(userKey),
          ...errShape,
        };
      }
      if (r.status === 404) {
        return wantPageCount
          ? Object.defineProperty([], "__pageCount", {
              value: 1,
              enumerable: false,
            })
          : null;
      }
      if (r.status === 403) {
        return { __error: "HTTP 403", ...errShape };
      }
      if (!r.ok) {
        lastErr = `HTTP ${r.status}`;
        if (i === retries) return { __error: lastErr, ...errShape };
        await backoff(i, backoffBase, 500);
        continue;
      }
      const data = await r.json();
      clearTraktStrikes(userKey);
      if (wantPageCount && Array.isArray(data)) {
        Object.defineProperty(data, "__pageCount", {
          value: parseInt(r.headers.get("X-Pagination-Page-Count") || "1") || 1,
          enumerable: false,
        });
      }
      return data;
    } catch (e) {
      lastErr = String(e);
      if (i === retries) return { __error: lastErr, ...errShape };
      await backoff(i, backoffBase * 1.6, 500);
    }
  }
  return { __error: lastErr || "retries exhausted", ...errShape };
}

let __traktLiveQ = Promise.resolve();
function traktLiveSerial(fn) {
  const run = __traktLiveQ.then(fn, fn);
  __traktLiveQ = run.then(() => {}, () => {});
  return run;
}
async function traktFetch(
  url,
  headers,
  {
    retries = 2,
    timeout = 12000,
    userKey,
    wantPageCount = false,
    backoffBase = 500,
  } = {},
) {
  const errShape = wantPageCount ? { __pageCount: 1 } : {};
  if (isTraktRateLimited(userKey)) {
    return {
      __error: "429 rate limited",
      __cooling: traktRateLimitedRemaining(userKey),
      ...errShape,
    };
  }

  const waitMs = traktBudgetCheck(userKey);
  if (waitMs > 0) {
    __sweepTraktBudget();
    return {
      __error: "budget exceeded",
      __budget: true,
      __cooling: Math.ceil(waitMs / 1000),
      ...errShape,
    };
  }
  traktBudgetTake(userKey);
  try {
    return await traktLiveSerial(() => __traktFetchInner(
      url,
      headers,
      { retries, timeout, userKey, wantPageCount, backoffBase },
      errShape,
    ));
  } finally {
    traktBudgetRelease();
  }
}

const traktGet = (url, headers, retries = 2, userKey) =>
  traktFetch(url, headers, { retries, timeout: 12000, userKey });

const KV_MISS = Symbol("kv-miss");
const KV_ERR = Symbol("kv-err");
const KV_MIN_PUT_TTL = 30;
const KV_DOWN_COOLDOWN_MS = 30000;
const LAST_GOOD_MIN_PUT_INTERVAL_MS = 10 * 60 * 1000;
const __lgSig = new Map();
const KV_WRITE_MIN_GAP_MS = 0;

const USER_STATE_KEY_RE =
  /^(?:pb|hist|more:hist|more:pb|lg|we|us|cwh|sync|act|dropped|cal|pbl|wl|wlids|wlv|tpr|tmh|spb|prof|stats|sum2|pbc|uid|lg:put|cwmeta):/;

function isUserStateKey(key) {
  return !!key && USER_STATE_KEY_RE.test(String(key));
}

function kvReadOpts() {
  return { type: "json" };
}

const ENRICH_BUCKETS = 4;
const ENRICH_BUCKET_TTL = 86400 * 14;
const ENRICH_BUCKET_MAX = 500;
const ENRICH_BATCH_MAX = 20;
const DEFAULT_JITTER_SEC = 600;
const __KV_LASTPUT_MAX = 5000;
const __kvLastPut = new Map();
const __kvInflight = new Map();
const __kvMemStale = new Map();
const STALE_MAX_AGE = 3600000;

function kvMemStaleSet(key, data, dataTs) {
  __kvMemStale.set(key, {
    data,
    ts: Date.now(),
    _ts: dataTs != null ? dataTs : Date.now(),
  });
  if (__kvMemStale.size > 3000) {
    const entries = [];
    for (const [k, v] of __kvMemStale) entries.push([k, (v && v.ts) || 0]);
    entries.sort((a, b) => a[1] - b[1]);
    const drop = Math.min(800, entries.length);
    for (let i = 0; i < drop; i++) __kvMemStale.delete(entries[i][0]);
  }
}

function kvMemStaleGet(key) {
  const e = __kvMemStale.get(key);
  if (!e) return undefined;
  if (Date.now() - e.ts > STALE_MAX_AGE) {
    __kvMemStale.delete(key);
    return undefined;
  }
  return e;
}

let __kvDownUntil = 0;

function kvIsDown() {
  return Date.now() < __kvDownUntil;
}

function kvMarkDown() {
  __kvDownUntil = Date.now() + KV_DOWN_COOLDOWN_MS;
}

function kvMarkUp() {
  __kvDownUntil = 0;
}

function kvRemember(key, val) {
  if (val === undefined || val === null || val === KV_MISS) return;
  const data =
    typeof val === "object" && val.data !== undefined ? val.data : val;
  if (!__isErrorPayload(data)) kvMemStaleSet(key, data, val && val._ts);
}

function dropInflight(key) {
  if (!key) return;
  __kvInflight.delete(key);
  __kvInflight.delete("swr:" + key);
  const fp = "force:" + key + ":";
  for (const k of [...__kvInflight.keys()]) {
    if (typeof k === "string" && k.startsWith(fp)) __kvInflight.delete(k);
  }
}

function singleFlight(key, fn) {
  const existing = __kvInflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    try {
      return await fn();
    } finally {
      setTimeout(() => __kvInflight.delete(key), 200);
    }
  })();
  __kvInflight.set(key, p);
  return p;
}

async function kvGetJSON(env, key, memOnly) {
  if (memOnly) return undefined;
  if (!env.TMDB_CACHE || kvIsDown()) return KV_ERR;
  try {
    const v = await env.TMDB_CACHE.get(key, kvReadOpts());
    kvMarkUp();
    return v === null || v === undefined ? KV_MISS : v;
  } catch {
    kvMarkDown();
    return KV_ERR;
  }
}

function kvPutJSON(
  env,
  ctx,
  key,
  payload,
  ttl,
  memOnly,
  force,
  staleRetention,
  unchanged = false,
) {
  if (unchanged) return;
  if (
    payload &&
    typeof payload === "object" &&
    payload !== KV_MISS &&
    !payload._ts
  )
    payload._ts = Date.now();
  kvRemember(key, payload);
  if (memOnly) return;
  if (!env.TMDB_CACHE || kvIsDown()) return;
  if (ttl != null && ttl < KV_MIN_PUT_TTL) return;

  if (KV_WRITE_MIN_GAP_MS > 0) {
    const last = __kvLastPut.get(key) || 0;
    if (last && Date.now() - last < KV_WRITE_MIN_GAP_MS) return;
  }
  __kvLastPut.set(key, Date.now());
  if (__kvLastPut.size > __KV_LASTPUT_MAX) {
    const it = __kvLastPut.keys();
    for (let i = 0; i < 1000; i++) {
      const k = it.next().value;
      if (k) __kvLastPut.delete(k);
    }
  }
  const logicalTtl = ttl || 60;
  const staleRet = staleRetention != null ? staleRetention : KV_STALE_RETENTION;
  const body =
    payload && typeof payload === "object"
      ? { ...payload, _ttl: logicalTtl }
      : payload;
  const p = env.TMDB_CACHE.put(key, JSON.stringify(body), {
    expirationTtl: Math.min(86400 * 30, Math.max(60, logicalTtl + staleRet)),
  })
    .then(() => kvMarkUp())
    .catch(() => {
      kvMarkDown();
    });
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);

  return p;
}

function __isErrorPayload(d) {
  if (d === null || d === undefined || d === false) return true;
  if (typeof d === "object" && d) {
    if (d.__error) return true;
    if (d.__cooling != null && d.data === undefined && !Array.isArray(d))
      return true;
  }
  return false;
}

function stableJitter(key, maxSec) {
  const m = Math.floor(Number(maxSec) || 0);
  if (m <= 0) return 0;
  const s = String(key);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % m;
}

function reqMemoMap(ctx) {
  if (!ctx || typeof ctx !== "object") return null;
  try {
    if (!ctx.__mtMemo) ctx.__mtMemo = new Map();

    if (ctx.__mtMemo.size > 120) return null;
    return ctx.__mtMemo;
  } catch {
    return null;
  }
}

function reqKvStat(ctx) {
  if (!ctx || typeof ctx !== "object") return null;
  if (!ctx.__kvStat) {
    ctx.__kvStat = { read: 0, hit: 0, miss: 0, write: 0, err: 0, dedup: 0 };
  }
  return ctx.__kvStat;
}

async function cachedJSON(
  env,
  ctx,
  key,
  fetcher,
  {
    ttl = 3600,
    missTtl = MISS_KV_TTL,
    memOnly = false,
    unwrap = true,
    swr = false,
    jitter,
    userKey,
    bypass = false,
    sourceTracker = null,
    lastGoodKey = null,
    revalidate = true,
    staleRetention = null,
  } = {},
) {
  const memoMap = reqMemoMap(ctx);
  const kvStat = reqKvStat(ctx);
  const jitterSec = stableJitter(
    key,
    jitter != null ? jitter : DEFAULT_JITTER_SEC,
  );

  const ttlBase = (payload) => {
    const v =
      typeof ttl === "function"
        ? ttl(payload && payload.data !== undefined ? payload.data : payload)
        : ttl;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 3600;
  };
  const ttlSecOf = (payload) => ttlBase(payload) + jitterSec;
  const softAgeOf = (payload) => {
    if (typeof swr === "number") return swr;
    if (swr !== true) return 0;
    return Math.floor(ttlBase(payload) * 0.5);
  };
  function unwrapVal(cached) {
    if (cached === KV_MISS || cached == null) return null;
    if (cached.miss) return null;
    return cached.data !== undefined ? cached.data : cached;
  }
  function ageSec(cached) {
    if (!cached || cached === KV_MISS || !cached._ts) return Infinity;
    return (Date.now() - cached._ts) / 1000;
  }
  function markSource(fromCache, cached, liveAgeSec) {
    if (sourceTracker && typeof sourceTracker === "object") {
      if (fromCache === null) {
        sourceTracker.fromCache = null;
        sourceTracker.age = 0;
        return;
      }
      sourceTracker.fromCache = !!fromCache;
      sourceTracker.age = fromCache
        ? cached && cached._ts
          ? Math.max(0, Math.round((Date.now() - cached._ts) / 1000))
          : 0
        : typeof liveAgeSec === "number" && isFinite(liveAgeSec)
          ? Math.max(0, liveAgeSec)
          : 0;
    }
  }

  function __hashStr(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++)
      h = (((h << 5) + h) | 0) + s.charCodeAt(i);
    return "h" + (h >>> 0).toString(36) + ":" + s.length;
  }
  function __stableStr(v) {
    if (v === undefined) return "null";
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) {
      if (v.length > 40) {

        if (v.length <= 2000) return __hashStr(JSON.stringify(v));
        return (
          "[len:" +
          v.length +
          "|" +
          v
            .slice(0, 500)
            .map((x) => {
              if (!x || typeof x !== "object") return JSON.stringify(x);
              const id =
                (x.ids && (x.ids.trakt || x.ids.tmdb)) ||
                (x.show && x.show.ids && x.show.ids.trakt) ||
                (x.movie && x.movie.ids && x.movie.ids.trakt) ||
                x.paused_at ||
                x.last_watched_at ||
                "";
              return String(id);
            })
            .join(",") +
          "]"
        );
      }
      return "[" + v.map(__stableStr).join(",") + "]";
    }
    const ks = Object.keys(v).sort();
    if (ks.length > 60) {

      return __hashStr(JSON.stringify(v));
    }
    return (
      "{" +
      ks.map((k) => JSON.stringify(k) + ":" + __stableStr(v[k])).join(",") +
      "}"
    );
  }
  function prevRawForTs(prevHint) {
    return prevHint && typeof prevHint === "object" && prevHint._ts
      ? prevHint
      : null;
  }
  async function writeFresh(
    data,
    { force = false, memOnlyOverride = null, prevHint = null } = {},
  ) {
    const prev = await prevRawForTs(prevHint);
    const unchanged = !!(
      prev &&
      prev._ts &&
      __stableStr(prev.data) === __stableStr(data)
    );
    const wts = unchanged ? prev._ts : Date.now();
    const prevWts =
      prev && prev._wts != null
        ? Number(prev._wts) || 0
        : (prev && prev._ts) || 0;
    const nowMs = Date.now();

    const nowWts = unchanged ? prevWts || wts : nowMs;
    if (kvStat) kvStat.write++;
    const putP = kvPutJSON(
      env,
      ctx,
      key,
      { data, _ts: wts, _wts: nowWts },
      ttlSecOf(data),
      memOnlyOverride != null ? memOnlyOverride : memOnly,
      force,
      staleRetention,
      unchanged,
    );

    if (isUserStateKey(key) && putP && typeof putP.then === "function") {
      await putP;
    }
    kvMemStaleSet(key, data, wts);
    if (memoMap)
      memoMap.set(key, {
        payload: { data, _ts: wts, _wts: nowWts },
        live: true,
      });
    if (unchanged) {
      kvRemember(key, { data, _ts: wts, _wts: nowWts });
    } else {
      writeLastGood(data);
    }
    return unchanged ? Math.max(0, Math.round((nowMs - wts) / 1000)) : 0;
  }
  function tryOldNormal() {
    const st = kvMemStaleGet(key);
    if (st && st.data !== undefined && !__isErrorPayload(st.data)) {
      markSource(true, { _ts: st._ts });
      return { found: true, val: st.data, raw: null, ts: st._ts };
    }
    return { found: false };
  }
  async function tryLastGood() {
    if (!lastGoodKey || !env || !env.TMDB_CACHE || kvIsDown())
      return { found: false };
    try {
      const lg = await env.TMDB_CACHE.get(lastGoodKey, { type: "json" });
      if (lg && !lg.miss) {
        const v = lg.data !== undefined ? lg.data : lg;
        if (!__isErrorPayload(v)) return { found: true, val: v, raw: lg };
      }
    } catch {}
    return { found: false };
  }
  function writeLastGood(data) {
    if (!lastGoodKey) return;
    const now = Date.now();
    const guardKey = "lgput:" + lastGoodKey;

    const sig = __stableStr(data);
    if (__lgSig.get(guardKey) === sig) return;
    const last = __kvLastPut.get(guardKey) || 0;
    if (last && now - last < LAST_GOOD_MIN_PUT_INTERVAL_MS) return;
    __kvLastPut.set(guardKey, now);
    __lgSig.set(guardKey, sig);
    kvPutJSON(env, ctx, lastGoodKey, { data }, LAST_GOOD_KV_TTL, false);
  }
  async function fallbackChain() {
    const old = tryOldNormal();
    if (old.found) return { found: true, val: old.val };
    if (env && env.TMDB_CACHE && !kvIsDown()) {
      try {
        const kvStale = await env.TMDB_CACHE.get(key, { type: "json" });
        if (kvStale && !kvStale.miss) {
          const v = kvStale.data !== undefined ? kvStale.data : kvStale;
          if (!__isErrorPayload(v)) {
            const memPayload =
              typeof kvStale === "object" && kvStale.data !== undefined
                ? kvStale
                : { data: v, _ts: (kvStale && kvStale._ts) || Date.now() };
            kvRemember(key, memPayload);
            kvMemStaleSet(key, v, (kvStale && kvStale._ts) || undefined);
            markSource(true, kvStale);
            return { found: true, val: v };
          }
        }
      } catch {}
    }
    const lg = await tryLastGood();
    if (lg.found) {
      const memPayload =
        lg.raw && typeof lg.raw === "object" && lg.raw.data !== undefined
          ? lg.raw
          : { data: lg.val, _ts: (lg.raw && lg.raw._ts) || Date.now() };
      kvRemember(key, memPayload);
      kvMemStaleSet(key, lg.val, (lg.raw && lg.raw._ts) || undefined);
      markSource(true, lg.raw || null);
      return { found: true, val: lg.val };
    }
    return { found: false };
  }
  if (bypass) {

    const pack = await singleFlight(
      "force:" + key + ":" + Math.floor(Date.now() / 1000),
      async () => {
        let data = null;
        try {
          data = await fetcher();
        } catch {
          data = null;
        }
        if (data && (data.__error || data.__cooling != null)) data = null;
        if (!__isErrorPayload(data)) {
          let prevHint = null;
          if (!memOnly && env && env.TMDB_CACHE && !kvIsDown()) {
            try {
              const raw = await env.TMDB_CACHE.get(key, kvReadOpts());
              kvMarkUp();
              if (raw && typeof raw === "object" && !raw.miss) {
                prevHint = raw;
              }
            } catch {
              kvMarkDown();
            }
          }
          const liveAge = await writeFresh(data, {
            force: true,
            memOnlyOverride: memOnly ? true : null,
            prevHint,
          });
          return { live: true, val: data, liveAge };
        }
        const fb = await fallbackChain();
        if (fb.found) return { live: false, fromCache: true, val: fb.val };
        return { live: false, val: null };
      },
    );

    if (pack && pack.live) markSource(false, null, pack.liveAge);
    else if (pack && pack.fromCache) markSource(true, { _ts: Date.now() });
    else markSource(null, null);
    const val = pack ? pack.val : null;
    return unwrap ? val : { data: val };
  }
  function needRefresh(cached) {
    if (!cached || cached === KV_MISS || cached.miss || !cached._ts)
      return false;
    const age = ageSec(cached);
    if (age > ttlSecOf(cached)) return true;
    const soft = softAgeOf(cached);
    if (soft > 0 && age > soft) return true;
    return false;
  }
  function scheduleRefresh(staleRaw) {
    if (!ctx || typeof ctx.waitUntil !== "function") return;
    const flightKey = "swr:" + key;
    if (__kvInflight.has(flightKey)) return;
    ctx.waitUntil(
      singleFlight(flightKey, async () => {
        let data = null;
        try {
          data = await fetcher();
        } catch {
          data = null;
        }
        if (data && (data.__error || data.__cooling != null)) data = null;
        const down = kvIsDown();
        if (!__isErrorPayload(data)) {
          await writeFresh(data, {
            memOnlyOverride: memOnly || down,
            prevHint: staleRaw,
          });
        }
      }),
    );
  }
  const memoHit = memoMap ? memoMap.get(key) : undefined;
  const mem = memoHit ? memoHit.payload : undefined;
  if (mem !== undefined) {
    if (mem === KV_MISS) {
      const lg = await tryLastGood();
      if (lg.found) {
        kvRemember(key, {
          data: lg.val,
          _ts: (lg.raw && lg.raw._ts) || Date.now(),
        });
        kvMemStaleSet(key, lg.val, (lg.raw && lg.raw._ts) || undefined);
        markSource(true, lg.raw || null);
        return unwrap ? lg.val : { data: lg.val };
      }
      markSource(null, null);
      return null;
    }
    if (kvStat) kvStat.dedup++;
    if (revalidate && needRefresh(mem)) scheduleRefresh(mem);

    if (memoHit.live) markSource(false, null, 0);
    else markSource(true, mem);
    if (unwrap) return unwrapVal(mem);
    return mem;
  }
  return singleFlight(key, async () => {
    const cached = await kvGetJSON(env, key, memOnly);
    if (kvStat) {
      kvStat.read++;
      if (cached === KV_MISS) kvStat.miss++;
      else if (cached === KV_ERR) kvStat.err++;
      else kvStat.hit++;
    }
    if (cached !== undefined && cached !== KV_MISS && cached !== KV_ERR) {
      if (!__isErrorPayload(unwrapVal(cached))) {
        kvMemStaleSet(
          key,
          unwrapVal(cached),
          (cached && cached._ts) || undefined,
        );
      }
      if (revalidate && needRefresh(cached)) {
        scheduleRefresh(cached);
      }
      if (memoMap) memoMap.set(key, { payload: cached, live: false });
      markSource(true, cached);
      if (unwrap) return unwrapVal(cached);
      return cached;
    }
    const kvBroken = cached === KV_ERR || cached === undefined;
    let data = null;

    let fetchFailed = false;
    try {
      data = await fetcher();
    } catch {
      data = null;
      fetchFailed = true;
    }
    if (data && (data.__error || data.__cooling != null)) {
      data = null;
      fetchFailed = true;
    }
    if (!__isErrorPayload(data)) {
      const liveAge = await writeFresh(data, {
        memOnlyOverride: memOnly || kvBroken,
        prevHint:
          cached !== undefined && cached !== KV_MISS && cached !== KV_ERR
            ? cached
            : null,
      });
      markSource(false, null, liveAge);
      return unwrap ? data : { data };
    }
    const fb = await fallbackChain();
    if (fb.found) return unwrap ? fb.val : { data: fb.val };

    const coolingNow = userKey ? isTraktRateLimited(userKey) : false;
    if (!fetchFailed && !coolingNow && !memOnly && missTtl >= KV_MIN_PUT_TTL) {
      kvPutJSON(
        env,
        ctx,
        key,
        { miss: 1, _ts: Date.now() },
        missTtl,
        false,
        false,
        MISS_STALE_RETENTION,
      );
    }
    markSource(null, null);
    return null;
  });
}
const SW_JS_CONTENT = String.raw`const VERSION = "v${APP_VERSION}";
const RUNTIME_CACHE = "trakt-static-" + VERSION;
const NAV_CACHE = "trakt-nav-" + VERSION;
const NAV_TIMEOUT = 5000;
self.addEventListener("install", function () {
  self.skipWaiting();
});
self.addEventListener("activate", function (e) {
  e.waitUntil(
    (async function () {
      var keys = await caches.keys();
      await Promise.all(
        keys
          .filter(function (k) {
            return k !== RUNTIME_CACHE && k !== NAV_CACHE;
          })
          .map(function (k) {
            return caches.delete(k);
          }),
      );
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/sw.js") return;
  if (req.mode === "navigate") {
    event.respondWith(
      new URL(req.url).pathname === "/"
        ? navigateLaunchSwr(req)
        : navigateNetworkFirst(req),
    );
    return;
  }
  if (url.pathname.indexOf("/api/") === 0) return;
  if (url.pathname.indexOf("/auth/") === 0) return;
  if (
    url.pathname === "/app.css" ||
    url.pathname === "/app.js" ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/favicon.ico" ||
    url.pathname.indexOf("/assets/") === 0 ||
    /\.(?:png|jpg|jpeg|svg|webp|ico|woff2?|css|js)$/i.test(url.pathname)
  ) {
    event.respondWith(staleWhileRevalidate(req));
  }
});
var __cachePs = {};
/* ==================================================================
 * Service Worker 与 PWA
 * 离线缓存策略：静态资源 SWR、导航网络优先
 * ================================================================== */
function getCache(name) {
  if (!__cachePs[name]) __cachePs[name] = caches.open(name);
  return __cachePs[name];
}
/**
 * Service Worker：首页（启动页）用"先给缓存、后台更新"。
 * 用户点开 App 能立刻看到骨架，不会对着白屏等网络。
 */
async function navigateLaunchSwr(req) {
  var cache = await getCache(NAV_CACHE);
  var cached = await cache.match(req);
  if (cached) {
    fetch(req)
      .then(function (r) {
        if (r && r.ok) cache.put(req, r.clone()).catch(function () {});
      })
      .catch(function () {});
    return cached;
  }
  var r = await fetch(req);
  if (r && r.ok) cache.put(req, r.clone()).catch(function () {});
  return r;
}
/**
 * Service Worker：非首页的导航走"网络优先"，5 秒超时后回退到缓存。
 * 数据都在接口里，缓存旧的整页反而会显示过期内容。
 */
async function navigateNetworkFirst(req) {
  var ctrl = new AbortController();
  var timer = setTimeout(function () {
    ctrl.abort();
  }, NAV_TIMEOUT);
  try {
    return await fetch(req, { signal: ctrl.signal });
  } catch (e) {
    try {
      var cache = await getCache(NAV_CACHE);
      var cached = await cache.match(req);
      if (cached) return cached;
      if (req.url !== self.location.origin + '/') {
        var rootCached = await cache.match(self.location.origin + '/');
        if (rootCached) return rootCached;
      }
    } catch (_) {}
     return new Response(
     '<!DOCTYPE html><html><head><meta charset="utf-8">' +
     '<meta name="viewport" content="width=device-width,initial-scale=1">' +
     '<meta http-equiv="refresh" content="3">' +
     '<meta name="theme-color" content="#050505">' +
     '<title>正在连接…</title>' +
     '<style>html,body{margin:0;height:100%;background:#050505;color:#a8b2c4;' +
     'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;' +
     'display:flex;align-items:center;justify-content:center}' +
     '.box{display:flex;flex-direction:column;align-items:center;gap:18px;' +
     'text-align:center;padding:24px}' +
     '.spinner{width:36px;height:36px;border:3px solid rgba(255,255,255,.08);' +
     'border-top-color:#a78bfa;border-radius:50%;animation:spin .8s linear infinite}' +
     '@keyframes spin{to{transform:rotate(360deg)}}' +
     '.msg{font-size:.92rem;color:#a8b2c4;letter-spacing:.3px}' +
     '.sub{font-size:.75rem;color:#6b7383;margin-top:-6px}' +
     '</style></head><body><div class="box">' +
     '<div class="spinner"></div>' +
     '<div class="msg">网络较慢，正在重新连接…</div>' +
     '<div class="sub">如果一直卡在这里，请检查网络后刷新</div>' +
     '</div></body></html>',
  {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  },
);
  } finally {
    clearTimeout(timer);
  }
}
/**
 * Service Worker：静态资源（CSS/JS/图片）先给缓存，同时后台拉新版。
 */
async function staleWhileRevalidate(req) {
  var cacheP = getCache(RUNTIME_CACHE);
  var networkP = fetch(req).then(function (r) {
    if (r && r.ok && r.type !== "opaque") {
      cacheP
        .then(function (c) {
          return c.put(req, r.clone());
        })
        .catch(function () {});
    }
    return r;
  });
  networkP.catch(function () {});
  var cached = await cacheP
    .then(function (c) {
      return c.match(req);
    })
    .catch(function () {
      return undefined;
    });
  return cached || networkP;
}`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url),
      path = url.pathname;

    await initEnvRuntime(env);

    if (
      request.method === "POST" &&
      (path.startsWith("/api/") ||
        path === "/auth/poll" ||
        path === "/auth/logout")
    ) {
      const blocked = sameOriginGuard(request);
      if (blocked) return blocked;
    }
    if (path.startsWith("/assets/")) return handleAsset(path, ctx);
    if (path === "/app.css") return handleAppCss(request);
    if (path === "/app.js") return handleAppJs(request);
    if (path === "/favicon.ico") return Response.redirect(FAVICON_URL, 302);
    if (path === "/avatar") return handleAvatar(request, ctx);
    if (path === "/logo") return handleLogo(request, ctx);
    if (path === "/manifest.webmanifest") return handleManifest();
    if (path === "/sw.js") return handleServiceWorker();
    if (path === "/auth/device") return handleDevice(request, env, ctx);
    if (path === "/auth/poll" && request.method === "POST")
      return handlePoll(request, env, ctx);
    if (path === "/auth/logout" && request.method === "POST")
      return handleLogout(request, env, ctx);
    if (path === "/api/more") return handleMore(request, env, ctx);
    if (path === "/api/season") return handleSeason(request, env, ctx);
    if (path === "/api/detail") return handleApiDetail(request, env, ctx);
    if (path === "/api/detail-extras")
      return handleDetailExtras(request, env, ctx);
    if (path === "/api/person") return handlePerson(request, env, ctx);
    if (path === "/api/enrich" && request.method === "POST") {
      const A = await authed(request, env, ctx);
      if (!A.ok) return A.response;
      if (!allowEnrich(request)) {
        return Response.json(
          { error: "请求过于频繁，请稍后再试" },
          { status: 429, headers: { "Retry-After": "60" } },
        );
      }
      return handleEnrich(request, env, ctx);
    }
    if (path === "/api/search") return handleSearch(request, env, ctx);
    if (path === "/api/trending") return handleTrending(request, env, ctx);
    if (path === "/api/reco") return handleReco(request, env, ctx);
    if (path === "/api/douban-list") return handleDoubanList(request, env, ctx);
    if (path === "/api/theater-list")
      return handleTheaterList(request, env, ctx);
    if (path === "/api/guduo-list") return handleGuduoList(request, env, ctx);
    if (path === "/api/platform-list")
      return handlePlatformList(request, env, ctx);
    if (path === "/api/watchlist/add" && request.method === "POST")
      return handleWatchlistAdd(request, env, ctx);
    if (path === "/api/watchlist/remove" && request.method === "POST")
      return handleWatchlistRemove(request, env, ctx);
    if (path === "/api/mark-watched" && request.method === "POST")
      return handleMarkWatched(request, env, ctx);
    if (path === "/api/unmark-watched" && request.method === "POST")
      return handleUnmarkWatched(request, env, ctx);
    if (path === "/api/mark-season-watched" && request.method === "POST")
      return handleMarkSeasonWatched(request, env, ctx);
    if (path === "/api/drop-show" && request.method === "POST")
      return handleDropShow(request, env, ctx);
    if (path === "/api/hide-continue" && request.method === "POST")
      return handleHideContinue(request, env, ctx);
    if (path === "/api/show-calendar")
      return handleShowCalendar(request, env, ctx);
    if (path === "/api/watch-diag") return handleWatchDiag(request, env, ctx);
    if (path === "/api/home-data") return handleHomeData(request, env, ctx);
    if (path === "/api/activity-sig")
      return handleActivitySig(request, env, ctx);
    if (path === "/api/summary") return handleSummary(request, env, ctx);
    if (path === "/api/app-version") return handleAppVersion();
    if (path === "/api/auth-status") return handleAuthStatus(request);
    if (path === "/login") return handleLogin(request, env, ctx);
    if (path === "/home") return handleHome(request, env, ctx);
    if (path === "/" || path === "") return handleLaunch(request, env, ctx);
    return handleHome(request, env, ctx);
  },
};

const LOGO_PROXY_HOST_RE = /^https:\/\/picui\.ogmua\.cn\//i;
const LOGO_CACHE_TTL = 30 * 86400;

const LOGO_GH_BASE =
  "https://raw.githubusercontent.com/SunMoonWithYou/minetrakt/main/img/";

const LOGO_GH_FILES = {

  Netflix: "Netflix.webp",
  "Disney+": "Disney+.webp",
  "HBO Max": "HBO Max.webp",
  "Apple TV+": "Apple TV+.webp",
  "Prime Video": "Prime Video.webp",
  哔哩哔哩: "哔哩哔哩.webp",
  爱奇艺: "爱奇艺.webp",
  腾讯视频: "腾讯视频.webp",
  优酷: "优酷.webp",
  芒果TV: "芒果TV.webp",

  X剧场: "X.png",
  迷雾剧场: "Fog.png",
  白夜剧场: "BaiYe.png",
  正午阳光: "ZhengWu.png",
  大家剧场: "DaJia.png",
  微尘剧场: "WeiChen.png",
  恋恋剧场: "LianLian.png",
  生花剧场: "ShengHua.png",
  板凳单元: "BanDeng.png",
  小逗剧场: "XiaoDou.png",
  十分剧场: "ShiFen.png",
  横屏短剧: "DuanJu.png",
  萤火单元: "YingHuo.png",
  悬疑剧: "Xuanyi.png",
};

const LOGO_ASSETS = {

};

function __b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function logoAssetResponse(label) {
  const asset = LOGO_ASSETS[String(label || "").trim()];
  if (!asset || !asset.b64) return null;
  return new Response(__b64ToBytes(asset.b64), {
    headers: {
      "Content-Type": asset.mime || "image/webp",
      "Cache-Control": "public, max-age=604800",
    },
  });
}

function logoFallback(label) {
  let text = String(label || "")
    .replace(/[<>&"]/g, "")
    .trim()
    .slice(0, 6);
  if (!text) text = "TV";
  const fs =
    text.length <= 2 ? 9 : text.length === 3 ? 8 : text.length === 4 ? 6.5 : 5.5;
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24">' +
    '<rect width="48" height="24" rx="4" fill="rgba(127,127,127,0.15)"/>' +
    '<text x="24" y="' +
    (16 - (9 - fs) * 0.5) +
    '" font-size="' +
    fs +
    '" text-anchor="middle" fill="rgba(127,127,127,0.6)" font-family="sans-serif">' +
    text +
    "</text></svg>";
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=300",
    },
  });
}

async function fetchLogoImage(target, ctx) {
  if (!target) return null;
  try {
    const cacheKey = new Request(target, { method: "GET" });
    const cache = caches.default;
    let resp = await cache.match(cacheKey);
    if (resp) return resp;
    const headers = {
      "User-Agent": traktAuthUa(),
      Accept:
        "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: "https://github.com/",
      "Sec-Fetch-Dest": "image",
      "Sec-Fetch-Mode": "no-cors",
      "Sec-Fetch-Site": "cross-site",
    };
    for (let i = 0; i < 2 && !resp; i++) {
      try {
        const upstream = await fetch(target, {
          headers,
          redirect: "follow",
        });
        if (
          upstream.ok &&
          (upstream.headers.get("Content-Type") || "").startsWith("image/")
        ) {
          resp = new Response(upstream.body, upstream);
          resp.headers.delete("content-encoding");
          resp.headers.delete("content-length");
          resp.headers.set(
            "Cache-Control",
            `public, max-age=${LOGO_CACHE_TTL}`,
          );
          if (ctx && typeof ctx.waitUntil === "function")
            ctx.waitUntil(cache.put(cacheKey, resp.clone()).catch(() => {}));
          return resp;
        } else if (i === 0) {
          await new Promise((r) => setTimeout(r, 400));
        }
      } catch {}
    }
  } catch {}
  return null;
}

function logoGithubUrl(label) {
  const name = String(label || "").trim();
  const file = LOGO_GH_FILES[name];
  if (!file) return "";
  return LOGO_GH_BASE + encodeURIComponent(file).replace(/%2F/gi, "/");
}
async function handleLogo(request, ctx) {
  const url = new URL(request.url);
  const target = url.searchParams.get("u") || "";
  const label = url.searchParams.get("t") || "";

  if (target && !LOGO_PROXY_HOST_RE.test(target))
    return new Response("bad url", { status: 400 });
  let resp = null;

  if (target) resp = await fetchLogoImage(target, ctx);

  if (!resp) {
    const gh = logoGithubUrl(label);
    if (gh) resp = await fetchLogoImage(gh, ctx);
  }

  if (!resp) resp = logoAssetResponse(label);

  if (!resp) resp = logoFallback(label);
  return resp;
}
async function handleAvatar(request, ctx) {
  const raw = new URL(request.url).searchParams.get("u") || "";
  let target;
  try {
    target = new URL(raw);
  } catch {
    return new Response("bad url", { status: 400 });
  }
  if (
    target.protocol !== "https:" ||
    target.hostname !== "media.trakt.tv" ||
    !target.pathname.startsWith("/images/users/")
  )
    return new Response("forbidden", { status: 403 });
  let cache = null;
  try {
    cache = caches.default;
  } catch {}
  const cacheKey = new Request(target.toString(), { method: "GET" });
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    } catch {}
  }
  let r;
  try {
    r = await fetch(target.toString(), {
      headers: { "User-Agent": traktAuthUa(), Referer: "https://trakt.tv/" },
    });
  } catch {
    return new Response("bad gateway", { status: 502 });
  }
  if (!r.ok) return new Response("not found", { status: 404 });
  const resp = new Response(r.body, {
    status: 200,
    headers: {
      "Content-Type": r.headers.get("Content-Type") || "image/jpeg",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
  if (cache && ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(cache.put(cacheKey, resp.clone()).catch(() => {}));
  }
  return resp;
}

async function handleAsset(path, ctx) {
  const entry = ASSET_ORIGINS[path];
  if (!entry) return new Response("Not Found", { status: 404 });
  const [origin, type] = entry;
  const cache = caches.default;
  const cacheKey = new Request(origin, { method: "GET" });
  let r = await cache.match(cacheKey);
  if (r) return r;
  try {
    const upstream = await fetchT(origin, {}, 6000);
    if (!upstream.ok) return new Response("", { status: 502 });
    r = new Response(upstream.body, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
      },
    });
    if (ctx && typeof ctx.waitUntil === "function")
      ctx.waitUntil(cache.put(cacheKey, r.clone()));
    return r;
  } catch {
    return new Response("", { status: 502 });
  }
}

function handleAppCss(request) {
  const etag = `"css-v${APP_CSS_VERSION}"`;
  const cacheHeaders = {
    "Content-Type": "text/css; charset=utf-8",
    "Cache-Control": "public, max-age=31536000, immutable",
    ETag: etag,
  };

  if (request && request.headers.get("If-None-Match") === etag) {
    return new Response(null, { status: 304, headers: cacheHeaders });
  }
  return new Response(pageStyles(), { headers: cacheHeaders });
}

function handleAppJs(request) {
  const etag = `"js-v${APP_JS_VERSION}"`;
  const cacheHeaders = {
    "Cache-Control": "public, max-age=31536000, immutable",
    ETag: etag,
  };
  if (request.headers.get("If-None-Match") === etag) {
    return new Response(null, { status: 304, headers: cacheHeaders });
  }
  return new Response(getClientSideScripts(), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      ...cacheHeaders,
    },
  });
}

function handleManifest() {
  return new Response(
    JSON.stringify({
      name: APP_NAME,
      short_name: APP_SHORT_NAME,
      description: "首页 · 待看列表 · 追剧日历 · 观看记录",
      start_url: "/",
      scope: "/",
      display: "standalone",
      orientation: "portrait",
      background_color: THEME_COLOR,
      theme_color: THEME_COLOR,
      lang: "zh-CN",
      icons: [
        { src: ICON_192, sizes: "192x192", type: "image/png", purpose: "any" },
        { src: ICON_512, sizes: "512x512", type: "image/png", purpose: "any" },
        {
          src: ICON_512,
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    }),
    {
      headers: {
        "Content-Type": "application/manifest+json; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      },
    },
  );
}

function handleAppVersion() {
  return new Response(
    JSON.stringify({ js: APP_JS_VERSION, css: APP_CSS_VERSION }),
    {
      headers: {
        "Content-Type": CT_JSON,
        "Cache-Control": CC_NO_STORE,
      },
    },
  );
}

function handleServiceWorker() {
  return new Response(SW_JS_CONTENT, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}

async function requireAuth(request, env) {
  const cookieAuth = readAuth(request);
  if (!cookieAuth) return { ok: false };
  const ck = cookieAuth.__ck || { ver: 1, payload: null, sig: null };
  if (ck.ver === 2) {

    if (cookieSigHex(ck.payload) !== ck.sig) return { ok: false };
  }
  const auth = await refreshIfNeeded(cookieAuth, env);
  if (!auth) return { ok: false };
  return {
    ok: true,
    auth,
    headers: makeTraktHeaders(env, auth),

    needsCookieUpdate:
      ck.ver === 1 ||
      auth.access_token !== cookieAuth.access_token ||
      auth.trakt_id !== (cookieAuth.trakt_id || null),
  };
}

async function authed(
  request,
  env,
  ctx,
  { html: wantHtml = false, strict = false } = {},
) {
  const a = await requireAuth(request, env);
  if (!a.ok) {
    return {
      ok: false,
      response: wantHtml ? unauthorizedHtml() : unauthorizedJson(),
    };
  }
  const userKey = await getStableUserId(a.auth, a.headers, env, ctx, {
    strict,
  });
  if (strict && !userKey) {
    const limited = isTraktRateLimited(
      a.auth.refresh_token
        ? String(a.auth.refresh_token)
        : String(a.auth.access_token),
    );
    const msg = limited
      ? "Trakt 官方限流，请稍后再试（无需反复操作）"
      : "登录信息已失效，请重新登录";
    return {
      ok: false,
      response: wantHtml
        ? new Response(msg, {
            status: 401,
            headers: { "Set-Cookie": clearCookieHeader() },
          })
        : Response.json(
            { error: msg, relogin: true, cooling: limited ? 30 : 0 },
            {
              status: 401,
              headers: { "Set-Cookie": clearCookieHeader() },
            },
          ),
    };
  }
  return {
    ok: true,
    auth: a.auth,
    headers: a.headers,
    needsCookieUpdate: a.needsCookieUpdate,
    userKey,
  };
}

function humanizeApiError(codeOrMsg, extra) {
  const s = String(codeOrMsg || "").trim();
  const cooling = extra && extra.cooling != null ? Number(extra.cooling) : null;
  const map = {
    unauthorized: "登录已过期，请重新登录",
    "bad body": "请求数据格式有误，请重试",
    "bad params": "参数有误，请检查后重试",
    "bad id": "无效的条目，请刷新页面后再试",
    empty: "暂时没有数据",
    failed: "操作失败，请稍后重试",
    "no tmdb key": "服务配置不完整，暂无法搜索",
    not_found_on_trakt:
      "Trakt 上暂时没有对应条目，可能是新片或中文内容尚未同步",
  };
  if (map[s]) return map[s];
  if (/Cloudflare|cf-mitigated|error code:\s*1015/i.test(s)) {
    return rateLimitMessage("cloudflare", cooling);
  }
  if (/^429|rate\s*limit|限流|过于频繁/i.test(s)) {
    const src = extra && extra.source === "cloudflare" ? "cloudflare" : "trakt";
    return rateLimitMessage(src, cooling);
  }
  if (/^HTTP\s*401/i.test(s)) return "登录已过期，请重新登录";
  if (/^HTTP\s*403/i.test(s)) return "没有权限执行此操作";
  if (/^HTTP\s*404/i.test(s)) return "未找到对应内容";
  if (/^HTTP\s*429/i.test(s)) {
    const src = extra && extra.source === "cloudflare" ? "cloudflare" : "trakt";
    return rateLimitMessage(src, cooling);
  }
  if (/^HTTP\s*5\d{2}/i.test(s))
    return "Trakt 服务暂时不可用（5xx），请稍后重试（当前可能显示缓存）";
  if (/network|fetch|abort|timeout|网络/i.test(s))
    return "网络连接失败，请检查网络后重试";
  if (/[\u4e00-\u9fff]/.test(s) && s.length > 4) return s;
  return s || "操作失败，请稍后重试";
}

function unauthorizedJson() {
  return Response.json(
    { error: humanizeApiError("unauthorized") },
    {
      status: 401,
      headers: { "Set-Cookie": clearCookieHeader() },
    },
  );
}

function unauthorizedHtml() {
  return new Response(humanizeApiError("unauthorized"), {
    status: 401,
    headers: { "Set-Cookie": clearCookieHeader() },
  });
}

function authJson(auth, needsCookieUpdate, data, status = 200) {

  const headers = { "Content-Type": CT_JSON, "Cache-Control": CC_NO_STORE };
  if (needsCookieUpdate && auth)
    headers["Set-Cookie"] = buildCookie(auth, auth.trakt_id);
  if (data && typeof data === "object" && data.error != null) {
    data = {
      ...data,
      error: humanizeApiError(data.error, { cooling: data.cooling, source: data.source }),
    };
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function authResp(
  auth,
  needsCookieUpdate,
  body,
  { status = 200, contentType = "text/html; charset=utf-8", extra = {} } = {},
) {

  const h = {
    "Content-Type": contentType,
    "Cache-Control": CC_NO_STORE,
    ...extra,
  };
  if (needsCookieUpdate && auth)
    h["Set-Cookie"] = buildCookie(auth, auth.trakt_id);
  return new Response(body, { status, headers: h });
}

async function parseJsonBody(request) {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return {
      ok: false,
      error: authJson(null, false, { error: "bad body" }, 400),
    };
  }
}

async function traktSyncAction(
  request,
  env,
  ctx,
  {
    allowedTypes,
    idField = "id",
    buildPayload,
    endpoint,
    timeout = 10000,
    afterOk,
    okMessage,
  },
) {
  const A = await authed(request, env, ctx);
  if (!A.ok) return A.response;
  const { auth, headers, needsCookieUpdate, userKey } = A;

  await syncTraktCooldownFromKV(env, userKey);
  if (isTraktRateLimited(userKey)) {
    const cooling = traktRateLimitedRemaining(userKey);
    const source = traktRateLimitedSource(userKey);
    return authJson(
      auth,
      needsCookieUpdate,
      {
        error: rateLimitMessage(source, cooling),
        rateLimited: true,
        cooling,
        source,
      },
      429,
    );
  }
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.error;
  const body = parsed.body || {};
  const type = body.type,
    rawId = body[idField];
  if (!allowedTypes.includes(type) || rawId == null || rawId === "") {
    return authJson(auth, needsCookieUpdate, { error: "bad params" }, 400);
  }
  const traktId = Number(rawId);
  if (!Number.isFinite(traktId) || traktId <= 0) {
    return authJson(auth, needsCookieUpdate, { error: "bad id" }, 400);
  }
  const payload = buildPayload(type, traktId, body);
  if (!payload)
    return authJson(auth, needsCookieUpdate, { error: "bad params" }, 400);
  let r;
  try {
    r = await fetchT(
      `${TRAKT_API}${endpoint}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      },
      timeout,

      userKey,
    );
  } catch {
    return authJson(
      auth,
      needsCookieUpdate,
      { error: "请求 Trakt 失败，请稍后重试" },
      502,
    );
  }
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    const payload = { error: "HTTP " + r.status, detail: text };
    if (r.status === 429) {
      const info = classifyRateLimit(r, text);
      let uk = null;
      try {
        uk = await getStableUserId(auth, headers, env, ctx).catch(() => null);
      } catch {}
      const cooling = Math.ceil(
        markTraktRateLimited(
          info.waitMs,
          uk || auth.refresh_token || auth.access_token,
        ) / 1000,
      );
      payload.cooling = cooling;
      payload.source = info.source;
      payload.ratelimit = info.ratelimit;
      payload.cfMitigated = info.cfMitigated;
      payload.error = rateLimitMessage(info.source, cooling);
    }
    return authJson(auth, needsCookieUpdate, payload, r.status);
  }
  if (typeof afterOk === "function")
    await afterOk(auth, headers, env, ctx, body);
  const result = await r.json().catch(() => null);

  const okBody = { ok: true, result };
  if (okMessage)
    okBody.message =
      typeof okMessage === "function"
        ? okMessage(type, body, result)
        : okMessage;
  return authJson(auth, needsCookieUpdate, okBody);
}

async function handleDevice(request, env, ctx) {

  const ip = clientIp(request);
  const cd = await authCooldownRemaining(ip);
  if (cd > 0) {
    return Response.json(
      {
        error: `授权接口冷却中，请 ${cd} 秒后再试`,
        rateLimited: true,
        retryAfter: cd,
      },
      { status: 429, headers: { "Retry-After": String(cd) } },
    );
  }
  const codeVerifier = randomString(64),
    codeChallenge = await pkceChallenge(codeVerifier);
  let res;
  try {
    res = await fetchT(
      `${TRAKT_AUTH}/oauth/device/code`,
      {
        method: "POST",
        headers: authJsonHeaders(),
        body: JSON.stringify({
          client_id: env.TRAKT_CLIENT_ID,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
        }),
      },
      10000,
    );
  } catch (e) {
    return Response.json(
      { error: "网络请求失败，请稍后重试" },
      { status: 502 },
    );
  }
  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 429) {
      const waitSec = authRateLimitWaitSec(res, {
        wafSec: 300,
        defaultSec: 30,
        maxSec: 180,
      });
      await markAuthCooldown(ip, waitSec, ctx);
      return Response.json(
        {
          error: `Trakt 授权接口限流，请 ${waitSec} 秒后再获取设备码`,
          rateLimited: true,
          retryAfter: waitSec,
        },
        { status: 429, headers: { "Retry-After": String(waitSec) } },
      );
    }
    if (res.status === 403) {
      return Response.json(
        {
          error: "Trakt 拒绝了请求",
          hint: "TRAKT_CLIENT_ID 可能不正确",
        },
        { status: 502 },
      );
    }
    return Response.json(
      { error: "Trakt 服务暂时不可用，请稍后重试" },
      { status: 502 },
    );
  }
  const data = await res.json(),
    state = b64urlEncode(
      JSON.stringify({
        device_code: data.device_code,
        code_verifier: codeVerifier,
      }),
    );
  return Response.json({
    state,
    user_code: data.user_code,
    verification_url: ACTIVATE_URL,
    interval: data.interval,
    expires_in: data.expires_in,
  });
}

async function handlePoll(request, env, ctx) {

  const ip = clientIp(request);
  const cd = await authCooldownRemaining(ip);
  if (cd > 0) {
    return Response.json(
      { error: "cooling", status: "rate_limited", retryAfter: cd },
      { status: 429, headers: { "Retry-After": String(cd) } },
    );
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (!body.state) return new Response("missing state", { status: 400 });
  let decoded;
  try {
    decoded = JSON.parse(b64urlDecode(body.state));
  } catch {
    return new Response("bad state", { status: 400 });
  }
  let res;
  try {
    res = await fetchT(
      `${TRAKT_AUTH}/oauth/device/token`,
      {
        method: "POST",
        headers: authJsonHeaders(),
        body: JSON.stringify({
          code: decoded.device_code,
          client_id: env.TRAKT_CLIENT_ID,
          client_secret: env.TRAKT_CLIENT_SECRET || undefined,
          code_verifier: decoded.code_verifier,
        }),
      },
      10000,
    );
  } catch (e) {
    return Response.json(
      { status: "network_error", detail: String(e) },
      { status: 502 },
    );
  }
  if (res.ok) {
    const data = await res.json();
    const auth = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
      code_verifier: decoded.code_verifier,
      trakt_id: null,
    };
    let traktId = null;
    let meStatus = 0;
    let meProfile = null;
    let meStats = null;
    try {
      const headers = makeTraktHeaders(env, auth);
      const [meRes, statsRes] = await Promise.all([
        fetchT(`${TRAKT_API}/users/me?extended=full`, { headers }, 8000),
        fetchT(`${TRAKT_API}/users/me/stats`, { headers }, 8000).catch(
          () => null,
        ),
      ]);
      meStatus = meRes.status;
      if (meRes.ok) {
        meProfile = await meRes.json();
        const ids = meProfile && meProfile.ids ? meProfile.ids : {};
        if (ids.trakt != null && ids.trakt !== "") traktId = String(ids.trakt);
        else if (ids.slug) traktId = "s:" + String(ids.slug);
      }
      if (statsRes && statsRes.ok) {
        try {
          meStats = await statsRes.json();
        } catch {
          meStats = null;
        }
      }
    } catch {}
    if (!traktId) {
      const limited = meStatus === 429;
      return Response.json(
        {
          ok: false,
          relogin: true,
          error: limited
            ? "Trakt 官方限流，暂时无法获取账号信息，请稍后再登录"
            : "无法获取账号信息，请重新登录",
        },
        { status: limited ? 429 : 502 },
      );
    }
    auth.trakt_id = traktId;
    const userKey = traktId;
    const rt = auth.refresh_token ? String(auth.refresh_token) : "";
    const at = auth.access_token ? String(auth.access_token) : "";
    const puts = [];
    const nowTs = Date.now();
    if (env && env.TMDB_CACHE) {
      if (rt)
        puts.push(
          env.TMDB_CACHE.put(
            CK.uidRt(rt.slice(0, 32)),
            JSON.stringify({ data: traktId, _ts: nowTs }),
            { expirationTtl: 60 * 60 * 24 * 90 },
          ).catch(() => {}),
        );
      if (at)
        puts.push(
          env.TMDB_CACHE.put(
            CK.uidAt(at.slice(0, 24)),
            JSON.stringify({ data: traktId, _ts: nowTs }),
            { expirationTtl: 60 * 60 * 24 * 90 },
          ).catch(() => {}),
        );
      if (meProfile) {
        puts.push(
          env.TMDB_CACHE.put(
            CK.profile(userKey),
            JSON.stringify({ data: meProfile, _ts: nowTs }),
            {
              expirationTtl:
                typeof PROFILE_KV_TTL === "number" ? PROFILE_KV_TTL : 86400,
            },
          ).catch(() => {}),
        );
        kvRemember(CK.profile(userKey), { data: meProfile, _ts: nowTs });
      }
      if (meStats) {
        puts.push(
          env.TMDB_CACHE.put(
            CK.stats(userKey),
            JSON.stringify({ data: meStats, _ts: nowTs }),
            {
              expirationTtl:
                typeof STATS_KV_TTL === "number" ? STATS_KV_TTL : 86400,
            },
          ).catch(() => {}),
        );
        kvRemember(CK.stats(userKey), { data: meStats, _ts: nowTs });
      }
    }
    if (rt) kvRemember(CK.uidRt(rt.slice(0, 32)), traktId);
    if (at) kvRemember(CK.uidAt(at.slice(0, 24)), traktId);
    if (ctx && typeof ctx.waitUntil === "function")
      ctx.waitUntil(Promise.all(puts));
    else Promise.all(puts).catch(() => {});
    const cookieHeaders = [buildCookie(auth, traktId)];
    try {
      const avatarUrl = pickAvatar(meProfile).url;
      const displayName =
        (meProfile && (meProfile.name || meProfile.username)) || "";
      if (displayName || avatarUrl)
        cookieHeaders.push(
          buildProfileCookie({ name: displayName, avatar: avatarUrl }),
        );
    } catch {}
    const headers = new Headers({ "Content-Type": "application/json" });
    for (const c of cookieHeaders) headers.append("Set-Cookie", c);
    return new Response(JSON.stringify({ ok: true, userKey }), {
      status: 200,
      headers,
    });
  }
  const rawText = await res.text();
  let err = "unknown";
  try {
    err = JSON.parse(rawText).error;
  } catch {}
  if (
    err === "authorization_pending" ||
    err === "slow_down" ||
    /pending|slow_down/i.test(String(err))
  ) {
    return Response.json({ status: err === "slow_down" ? "slow_down" : "authorization_pending" }, { status: 202 });
  }
  if (err === "access_denied") {
    return Response.json(
      { status: "denied", message: "你拒绝了授权，请重新登录" },
      { status: 403 },
    );
  }
  if (err === "expired_token" || err === "already_used") {
    return Response.json(
      { status: "expired", message: "授权码已过期，请重新获取" },
      { status: 410 },
    );
  }
  if (res.status === 429) {
    const waitSec = authRateLimitWaitSec(res, {
      wafSec: 300,
      defaultSec: 60,
      maxSec: 180,
    });
    await markAuthCooldown(ip, waitSec, ctx);
    return Response.json(
      {
        status: "rate_limited",
        message: "Trakt 授权轮询被限流，请稍后再试",
        retryAfter: waitSec,
      },
      { status: 429, headers: { "Retry-After": String(waitSec) } },
    );
  }
  return Response.json(
    {
      status: "error",
      message: "授权服务暂时不可用，请稍后重试",
      detail: err,
      http: res.status,
    },
    { status: 502 },
  );
}

async function handleLogout(request, env, ctx) {
  try {
    const cookieAuth = readAuth(request);
    if (cookieAuth && env) {
      const auth =
        (await refreshIfNeeded(cookieAuth, env).catch(() => null)) ||
        cookieAuth;
      const headers = makeTraktHeaders(env, auth);
      const userKey = await getStableUserId(auth, headers, env, ctx).catch(
        () => null,
      );
      if (userKey && userKey !== "anon" && env.TMDB_CACHE) {
        const fixedKeys = [
          CK.profile(userKey),
          CK.playback(userKey),
          CK.stats(userKey),
          CK.history(userKey, 1),
          CK.watchlistVersion(userKey),
        ];
        const p = Promise.all(
          fixedKeys.map((k) => env.TMDB_CACHE.delete(k).catch(() => {})),
        );
        if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
        else p.catch(() => {});
        bustHomeUserCaches(userKey, env, ctx);
      }
    }
  } catch {}
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": clearCookieHeader() },
  });
}

function buildCookie(auth, traktId) {
  const payload = {
    access_token: auth.access_token,
    refresh_token: auth.refresh_token,
    expires_at: auth.expires_at,
    code_verifier: auth.code_verifier,
    trakt_id: traktId
      ? String(traktId)
      : auth.trakt_id
        ? String(auth.trakt_id)
        : null,
  };

  const body = b64urlEncode(JSON.stringify(payload));
  const value = __cookieSecret
    ? `v2.${body}.${cookieSigHex(body)}`
    : body;
  return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`;
}

function readAuth(request) {
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!m) return null;
  try {
    let raw = m[1];
    let ver = 1;

    if (raw.startsWith("v2.")) {
      ver = 2;
      const parts = raw.split(".");
      if (parts.length !== 3) return null;
      raw = parts[1];
    }
    const auth = JSON.parse(b64urlDecode(raw));
    if (auth && !("trakt_id" in auth)) auth.trakt_id = null;
    if (auth) {

      Object.defineProperty(auth, "__ck", {
        value: { ver, payload: raw, sig: ver === 2 ? m[1].split(".")[2] : null },
        enumerable: false,
        configurable: true,
      });
    }
    return auth;
  } catch {
    return null;
  }
}

async function refreshIfNeeded(auth, env) {
  if (!auth || !auth.access_token) return auth;
  const knownBad = tokenIsKnownBad(auth.access_token);
  if (!knownBad && auth.expires_at - Date.now() > 30 * 60_000) return auth;
  if (!auth.refresh_token) return auth;

  const rk = String(auth.refresh_token).slice(0, 24);
  const inflight = __refreshInflight.get(rk);
  if (inflight) return await inflight.catch(() => auth);
  const task = (async () => {
    let res;
    try {
      res = await fetchT(
        `${TRAKT_AUTH}/oauth/token`,
        {
          method: "POST",
          headers: authJsonHeaders(),
          body: JSON.stringify({
            refresh_token: auth.refresh_token,
            client_id: env.TRAKT_CLIENT_ID,
            code_verifier: auth.code_verifier,
            grant_type: "refresh_token",
            redirect_uri: "urn:ietf:wg:oauth:2.0:oob",
          }),
        },
        10000,
      );
    } catch {

      return auth;
    }
    if (!res.ok) return auth;
    const data = await res.json();
    if (!data || !data.access_token) return auth;
    const next = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || auth.refresh_token,
      expires_at: Date.now() + (Number(data.expires_in) || 0) * 1000,
      code_verifier: auth.code_verifier,
      trakt_id: auth.trakt_id || null,
    };

    __badTokens.delete(String(auth.access_token || "").slice(0, 24));
    return next;
  })();
  __refreshInflight.set(rk, task);
  try {
    return await task;
  } finally {
    __refreshInflight.delete(rk);
  }
}

const __refreshInflight = new Map();
const __badTokens = new Map();
const BAD_TOKEN_TTL_MS = 3600000;
function markTokenInvalid(headers) {
  try {
    const at = headers && headers.Authorization ? String(headers.Authorization) : "";
    const tok = at.replace(/^Bearer\s+/i, "").trim();
    if (!tok) return;
    __badTokens.set(tok.slice(0, 24), Date.now());
    if (__badTokens.size > 2000) {
      const now = Date.now();
      for (const [k, t] of __badTokens) {
        if (now - t > BAD_TOKEN_TTL_MS) __badTokens.delete(k);
      }
    }
  } catch {}
}
function tokenIsKnownBad(accessToken) {
  try {
    const tok = String(accessToken || "").trim();
    if (!tok) return false;
    const at = __badTokens.get(tok.slice(0, 24));
    return !!at && Date.now() - at < BAD_TOKEN_TTL_MS;
  } catch {
    return false;
  }
}

function makeTraktHeaders(env, auth) {
  const h = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": env.TRAKT_CLIENT_ID,

    "User-Agent": appUserAgent(),
  };

  if (auth && auth.access_token) {
    h.Authorization = `Bearer ${auth.access_token}`;
  }
  return h;
}

async function getStableUserId(
  auth,
  headers,
  env,
  ctx,
  { strict = false } = {},
) {
  if (!auth) return strict ? null : "anon";
  if (auth.trakt_id) return String(auth.trakt_id);
  const rt = auth.refresh_token ? String(auth.refresh_token) : "";
  const at = auth.access_token ? String(auth.access_token) : "";
  const memKey = rt ? CK.uidRt(rt.slice(0, 32)) : CK.uidAt(at.slice(0, 24));
  if (env && env.TMDB_CACHE) {
    try {
      const raw = await env.TMDB_CACHE.get(memKey, kvReadOpts());
      kvMarkUp();
      if (raw != null) {
        const uid = String(
          typeof raw === "object" && raw.data != null ? raw.data : raw,
        );
        if (uid && uid !== "null" && uid !== "undefined") {
          kvRemember(memKey, uid);
          return uid;
        }
      }
    } catch {
      kvMarkDown();
    }
  }
  if (isTraktRateLimited(rt || at)) {
    if (strict) return null;
  }

  if (traktBudgetCheck(rt || at || null) > 0 && !strict) {
    const stale = kvMemStaleGet(memKey);
    if (stale && stale.data) return String(stale.data);

    return rt ? "r" + rt.slice(0, 20) : at ? "a" + at.slice(0, 16) : "anon";
  }
  traktBudgetTake(rt || at || null);
  try {
    const r = await fetchT(`${TRAKT_API}/users/me`, { headers }, 8000);
    if (r.ok) {
      const me = await r.json();
      const ids = me && me.ids ? me.ids : {};
      let uid = null;
      if (ids.trakt != null && ids.trakt !== "") uid = String(ids.trakt);
      else if (ids.slug) uid = "s:" + String(ids.slug);
      if (uid) {
        kvRemember(memKey, uid);

        try {
          if (env && env.TMDB_CACHE && typeof env.TMDB_CACHE.put === "function") {
            env.TMDB_CACHE.put(memKey, JSON.stringify(uid), {
              expirationTtl: 86400 * 30,
            }).catch(() => {});
          }
        } catch {}
        if (rt) {
          try {
            if (env && env.TMDB_CACHE && typeof env.TMDB_CACHE.put === "function") {
              env.TMDB_CACHE.put(CK.uidRt(rt.slice(0, 32)), JSON.stringify(uid), {
                expirationTtl: 86400 * 30,
              }).catch(() => {});
            }
          } catch {}
        }
        return uid;
      }
    } else if (r.status === 429) {
      consumeRetryAfter(r, rt || at);
      if (strict) return null;
    } else if (r.status === 401 || r.status === 403) {

      markTokenInvalid(headers);
      if (strict) return null;
    }
  } catch {
  } finally {
    traktBudgetRelease();
  }
  if (strict) return null;
  const userId = rt
    ? "r" + rt.slice(0, 20)
    : at
      ? "a" + at.slice(0, 16)
      : "anon";
  kvRemember(memKey, userId);
  return userId;
}

function rememberTraktUserId(auth, traktId) {
  if (!auth || !traktId) return;
  const id = String(traktId);
  const rt = auth.refresh_token ? String(auth.refresh_token) : "";
  const at = auth.access_token ? String(auth.access_token) : "";
  if (rt) kvRemember(CK.uidRt(rt.slice(0, 32)), id);
  if (at) kvRemember(CK.uidAt(at.slice(0, 24)), id);
}

function clearCookieHeader() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function readProfileHint(request) {
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${PROFILE_COOKIE}=([^;]+)`));
  if (!m) return null;
  try {
    return JSON.parse(b64urlDecode(m[1]));
  } catch {
    return null;
  }
}

function pickAvatar(profile) {
  const out = { url: "", alts: [] };
  if (!profile || typeof profile !== "object") return out;
  const collect = (a) => {
    if (!a) return;
    if (typeof a === "string") {
      if (!out.url) out.url = a;
      out.alts.push(a);
      return;
    }
    if (typeof a === "object") {
      const full = a.full || "",
        med = a.medium || "",
        th = a.thumb || "";
      if (!out.url) out.url = full || med || th || "";
      if (med) out.alts.push(med);
      if (th) out.alts.push(th);
    }
  };
  collect(profile.images && profile.images.avatar);
  collect(profile.avatar);
  const seen = new Set();
  out.alts = out.alts.filter((u) => {
    if (!u || u === out.url || seen.has(u)) return false;
    seen.add(u);
    return true;
  });
  return out;
}

function buildProfileCookie(profile) {
  const data = { name: profile.name || profile.username || "", username: profile.username || "", avatar: profile.avatar || "" };
  return `${PROFILE_COOKIE}=${b64urlEncode(JSON.stringify(data))}; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`;
}

async function getWatchlistVersion(env, ctx, userKey) {
  if (!userKey) return "0";
  const key = CK.watchlistVersion(userKey);
  if (!env || !env.TMDB_CACHE || kvIsDown()) return "0";
  try {
    const raw = await env.TMDB_CACHE.get(key, kvReadOpts());
    kvMarkUp();
    if (raw == null) return "0";
    const v = String(
      typeof raw === "object" && raw.data != null ? raw.data : raw,
    );
    return v || "0";
  } catch {
    kvMarkDown();
    return "0";
  }
}

function invalidateWatchlistCache(env, ctx, userKey) {
  if (env && env.TMDB_CACHE && userKey) {
    const verKey = CK.watchlistVersion(userKey);
    const bump = (async () => {
      let cur = 0;
      if (!kvIsDown()) {
        try {
          const raw = await env.TMDB_CACHE.get(verKey, { type: "json" });
          if (raw != null) {
            const n =
              typeof raw === "object" && raw.data != null
                ? Number(raw.data)
                : Number(raw);
            if (Number.isFinite(n)) cur = n;
          }
          kvMarkUp();
        } catch {
          kvMarkDown();
        }
      }

      const next = String(Math.max(cur + 1, Date.now()));
      const payload = { data: next, _ts: Date.now(), _ttl: 86400 * 30 };
      kvRemember(verKey, payload);
      if (!kvIsDown()) {
        try {
          await env.TMDB_CACHE.put(verKey, JSON.stringify(payload), {
            expirationTtl: 86400 * 30,
          });
          kvMarkUp();
        } catch {
          kvMarkDown();
        }
      }
    })();
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(bump);
    return bump;
  }
  return Promise.resolve();
}

function markProgressDirty(env, ctx, userKey) {
  if (!userKey || !env || !env.TMDB_CACHE) return Promise.resolve();
  const key = CK.progressDirty(userKey);
  __kvMemStale.delete(key);
  const p = env.TMDB_CACHE.put(
    key,
    JSON.stringify({ data: Date.now(), _ts: Date.now() }),
    { expirationTtl: 86400 },
  ).catch(() => {});
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
  return p;
}

function markProgressDirtyShow(env, ctx, userKey, showId) {
  if (!userKey || !env || !env.TMDB_CACHE || !showId) return Promise.resolve();
  const key = `tpred:${userKey}:${showId}`;
  __kvMemStale.delete(key);
  const p = env.TMDB_CACHE.put(
    key,
    JSON.stringify({ data: Date.now(), _ts: Date.now() }),
    { expirationTtl: 86400 },
  ).catch(() => {});
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
  return p;
}
async function progressDirtyAtShow(env, userKey, showId) {
  if (!userKey || !showId || !env || !env.TMDB_CACHE || kvIsDown()) return 0;
  try {
    const raw = await env.TMDB_CACHE.get(`tpred:${userKey}:${showId}`, {
      type: "json",
    });
    if (!raw || raw.miss) return 0;
    const v = raw.data !== undefined ? raw.data : raw;
    return Number(v) || 0;
  } catch {
    return 0;
  }
}
function clearProgressDirtyShow(env, ctx, userKey, showId) {
  if (!userKey || !showId || !env || !env.TMDB_CACHE) return;
  const key = `tpred:${userKey}:${showId}`;
  __kvMemStale.delete(key);
  const p = env.TMDB_CACHE.delete(key).catch(() => {});
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
}

async function progressDirtyAt(env, userKey) {
  if (!userKey || !env || !env.TMDB_CACHE || kvIsDown()) return 0;
  try {
    const raw = await env.TMDB_CACHE.get(CK.progressDirty(userKey), {
      type: "json",
    });
    if (!raw || raw.miss) return 0;
    const v = raw.data !== undefined ? raw.data : raw;
    return Number(v) || 0;
  } catch {
    return 0;
  }
}

function clearProgressDirty(env, ctx, userKey) {
  if (!userKey || !env || !env.TMDB_CACHE) return;
  const key = CK.progressDirty(userKey);
  __kvMemStale.delete(key);
  const p = env.TMDB_CACHE.delete(key).catch(() => {});
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
}

function userCacheKeys(userKey) {
  return {
    exact: [
      CK.playback(userKey),
      CK.stats(userKey),
      CK.history(userKey, 1),
      CK.lastGood.playback(userKey),
      CK.lastGood.history(userKey, 1),
      CK.pbImages(userKey),
      CK.watchedEpisodes(userKey),
      CK.cwHide(userKey),
      CK.playbackList(userKey),
      CK.syncState(userKey),
    ],
    prefix: [
      `hist:${userKey}:`,
      `more:hist:${userKey}:`,
      `more:pb:${userKey}:`,
      `lg:hist:${userKey}:`,
      `sum2:${userKey}:`,
      `tpr:${userKey}:`,
      `tmh:${userKey}:`,
      `spb:${userKey}:`,

      `we:v2:${userKey}`,
      `cwh:${userKey}`,
      `prof:${userKey}`,
      `cal:${userKey}`,
      `act:${userKey}`,
      `pbi:${userKey}`,
    ],
  };
}

function bustHomeUserCaches(userKey, env, ctx) {
  if (!userKey) return Promise.resolve();

  try {
    if (ctx && ctx.__mtMemo) ctx.__mtMemo.clear();
  } catch {}

  const sumPrefix = `sum2:${userKey}:`;
  const statsKey = CK.stats(userKey);
  for (const k of [...__summaryMem.keys()]) {
    if (k.startsWith(sumPrefix) || k === statsKey) __summaryMem.delete(k);
  }
  const { exact, prefix } = userCacheKeys(userKey);
  const exact2 = [...exact, userStateCacheKey(userKey)];
  for (const k of [...__kvLastPut.keys()]) {
    if (exact2.includes(k) || prefix.some((p) => k.startsWith(p))) {
      __kvLastPut.delete(k);
    }
  }
  for (const k of exact2) {
    __kvLastPut.delete(k);
    __kvLastPut.delete("lgput:" + k);
  }

  for (const k of [...__kvInflight.keys()]) {
    if (typeof k !== "string") continue;
    const bases = [k];
    if (k.startsWith("swr:")) bases.push(k.slice(4));
    if (k.startsWith("force:")) bases.push(k.slice(6).replace(/:\d+$/, ""));
    if (
      bases.some(
        (b) => exact2.includes(b) || prefix.some((p) => b.startsWith(p)),
      )
    ) {
      __kvInflight.delete(k);
    }
  }
  if (env && env.TMDB_CACHE) {

    const hardKeys = [
      CK.playback(userKey),
      CK.watchedMovies(userKey),
      CK.history(userKey, 1),
      CK.history(userKey, 2),
      CK.history(userKey, 3),
      CK.stats(userKey),
      CK.syncState(userKey),
    ];

    const p = safeDeleteKvKeys(env, ctx, hardKeys);

    markProgressDirty(env, ctx, userKey);
    const extra = (async () => {
      try {
        if (!env.TMDB_CACHE || typeof env.TMDB_CACHE.list !== "function") return;
        const prefixes = [

          `more:hist:${userKey}:`,
          `more:pb:`,
          `hist:${userKey}:`,
          `act:${userKey}`,
        ];
        const toDel = [];
        for (const prefix of prefixes) {
          let cursor;
          do {
            const page = await env.TMDB_CACHE.list({
              prefix,
              cursor,
              limit: 100,
            });
            for (const k of page.keys || []) {
              if (k && k.name) toDel.push(k.name);
            }
            cursor = page.list_complete ? null : page.cursor;
          } while (cursor);
        }
        if (toDel.length) await safeDeleteKvKeys(env, ctx, toDel);
      } catch {}
    })();
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(extra);
    return Promise.all([p, extra]);
  }
  return Promise.resolve();
}

async function runLimited(taskFns, concurrency = 2, delayMs = 150) {
  let idx = 0;
  async function worker() {
    while (idx < taskFns.length) {
      const myIdx = idx++;
      try {
        await taskFns[myIdx]();
      } catch (e) {}
      if (idx < taskFns.length) await sleep(delayMs);
    }
  }
  const workers = [];
  const n = Math.min(concurrency, taskFns.length);
  for (let i = 0; i < n; i++) workers.push(worker());
  await Promise.all(workers);
}

async function tmdbGet(url) {
  try {
    const r = await fetchT(url, {}, 8000);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function tmdbUrl(path, env, extra = {}) {
  const sep = path.includes("?") ? "&" : "?";
  const q = new URLSearchParams({
    language: "zh-CN",
    api_key: env.TMDB_API_KEY,
    ...extra,
  });
  return `${TMDB_API}${path}${sep}${q}`;
}

async function tmdbDetailCached(path, env, ctx, ttl = TMDB_KV_TTL) {
  if (!env.TMDB_API_KEY) return null;
  return cachedJSON(
    env,
    ctx,
    CK.tmdb(path),
    () => tmdbGet(tmdbUrl(path, env)),
    {
      ttl,
      missTtl: MISS_KV_TTL,
      swr: Math.min(86400, Math.floor(ttl * 0.25)),
      jitter: 200,
    },
  );
}

function tmdbPoster(path, size = "w780") {
  return path ? `${TMDB_IMG}/${size}${path}` : null;
}

async function tmdbSeasonStillMap(tmdbId, season, env, ctx) {
  if (!env || !env.TMDB_API_KEY) return null;
  const sid = Number(tmdbId),
    sn = Number(season);
  if (!Number.isFinite(sid) || sid <= 0) return null;
  if (!Number.isFinite(sn) || sn < 0) return null;
  const data = await tmdbDetailCached(
    `/tv/${sid}/season/${sn}`,
    env,
    ctx,
    TMDB_KV_TTL,
  );
  if (!data || !Array.isArray(data.episodes)) return null;
  const map = new Map();
  for (const ep of data.episodes) {
    if (ep && ep.episode_number != null && ep.still_path) {
      map.set(Number(ep.episode_number), tmdbPoster(ep.still_path, "w780"));
    }
  }
  return map;
}

async function tmdbEpisodeStill(tmdbId, season, episode, env, ctx) {
  if (!env || !env.TMDB_API_KEY) return null;
  const sid = Number(tmdbId),
    sn = Number(season),
    en = Number(episode);
  if (!Number.isFinite(sid) || sid <= 0) return null;
  if (!Number.isFinite(sn) || sn < 0) return null;
  if (!Number.isFinite(en) || en <= 0) return null;
  const map = await tmdbSeasonStillMap(sid, sn, env, ctx);
  if (map && map.has(en)) return map.get(en);
  const data = await tmdbDetailCached(
    `/tv/${sid}/season/${sn}/episode/${en}`,
    env,
    ctx,
    TMDB_KV_TTL,
  );
  if (data && data.still_path) return tmdbPoster(data.still_path, "w780");
  return null;
}

async function tmdbShowBackdrop(tmdbId, env, ctx, kind) {
  if (!env || !env.TMDB_API_KEY) return null;
  const sid = Number(tmdbId);
  if (!Number.isFinite(sid) || sid <= 0) return null;
  const primary = kind === "movie" ? "movie" : "tv";
  const other = primary === "movie" ? "tv" : "movie";
  const data = await tmdbDetailCached(
    `/${primary}/${sid}`,
    env,
    ctx,
    86400 * 7,
  );
  if (data && data.backdrop_path) return tmdbPoster(data.backdrop_path, "w1280");
  const alt = await tmdbDetailCached(`/${other}/${sid}`, env, ctx, TMDB_KV_TTL);
  if (alt && alt.backdrop_path) return tmdbPoster(alt.backdrop_path, "w1280");
  return null;
}

async function tmdbZhTitle(kind, tmdbId, env, ctx) {
  if (!env || !env.TMDB_API_KEY || !tmdbId) return null;
  const path = kind === "movie" ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
  const data = await tmdbDetailCached(path, env, ctx, TMDB_KV_TTL);
  if (!data) return null;
  return (data.name || data.title || "").trim() || null;
}

const IMG_MAP_KV_TTL = 86400 * 14;
const IMG_MAP_MIN_PUT_INTERVAL_MS = 10 * 60 * 1000;
const __IMG_MAP_LAST_PUT = new Map();

async function loadImageMap(env, key) {
  if (!key) return {};
  if (!env || !env.TMDB_CACHE || kvIsDown()) return {};
  try {
    const raw = await env.TMDB_CACHE.get(key, kvReadOpts());
    kvMarkUp();
    const v = raw && raw.data !== undefined ? raw.data : raw;
    const out = v && typeof v === "object" && !Array.isArray(v) ? v : {};
    kvRemember(key, { data: out, _ts: (raw && raw._ts) || Date.now() });
    return out;
  } catch {
    kvMarkDown();
    const out = {};
    kvRemember(key, { data: out, _ts: Date.now() });
    return out;
  }
}

function saveImageMap(env, ctx, key, map) {
  if (!key || !map || typeof map !== "object") return;
  const ks = Object.keys(map);
  if (ks.length > 400) {
    for (let i = 0; i < ks.length - 400; i++) delete map[ks[i]];
  }
  const now = Date.now();
  const payload = { data: map, _ts: now, _ttl: IMG_MAP_KV_TTL };
  kvRemember(key, payload);
  if (!env || !env.TMDB_CACHE || kvIsDown()) return;
  const last = __IMG_MAP_LAST_PUT.get(key) || 0;
  if (last && now - last < IMG_MAP_MIN_PUT_INTERVAL_MS) return;
  __IMG_MAP_LAST_PUT.set(key, now);
  if (__IMG_MAP_LAST_PUT.size > 1000) {
    const it = __IMG_MAP_LAST_PUT.keys();
    for (let i = 0; i < 200; i++) {
      const k = it.next().value;
      if (k) __IMG_MAP_LAST_PUT.delete(k);
    }
  }
  const p = env.TMDB_CACHE.put(key, JSON.stringify(payload), {
    expirationTtl: Math.min(86400 * 30, IMG_MAP_KV_TTL + KV_STALE_RETENTION),
  })
    .then(() => kvMarkUp())
    .catch(() => {
      kvMarkDown();
    });
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
  else p.catch(() => {});
}

function pbImageKey(entry) {
  if (!entry) return null;
  if (entry.movie && entry.movie.ids && entry.movie.ids.trakt != null)
    return "m:" + entry.movie.ids.trakt;
  const show = entry.show;
  if (!show || !show.ids || show.ids.trakt == null) return null;
  const ep =
    entry.episode || (entry.progress && entry.progress.next_episode) || null;
  const s = ep ? (ep.season != null ? ep.season : ep.season_number) : "";
  const n = ep ? (ep.number != null ? ep.number : ep.episode_number) : "";
  return "s:" + show.ids.trakt + ":" + s + ":" + n;
}

function applyPbImage(j, imgMap) {
  const rec = j.k ? imgMap[j.k] : null;
  if (!rec) return false;
  if (rec.s) {
    j.entry.__stillUrl = rec.s;
    if (j.ep) j.ep.__stillUrl = rec.s;
  }
  if (rec.b) j.entry.__backdropUrl = rec.b;
  if (rec.t) j.entry.__zhTitle = rec.t;
  j.entry.__tmdbId = j.tmdbId;
  if (j.ep) j.ep.__tmdbId = j.tmdbId;
  return true;
}

// 「继续观看」里日历条目的时间窗口
// CW_UPCOMING_WINDOW_MS：距开播多久内算「即将播出」
// CW_AIRING_WINDOW_MS：开播后多久内算「正在播出」
// CW_AIRED_WINDOW_MS：播完后多久内仍保留（显示「X 小时前」）
const CW_UPCOMING_WINDOW_MS = 24 * 3600 * 1000;
const CW_AIRING_WINDOW_MS = 2 * 3600 * 1000;
const CW_AIRED_WINDOW_MS = 72 * 3600 * 1000;
// 本地日历条目（即将播出 / 刚播完）的额外展示位，不占用主列表名额
const CW_LOCAL_EXTRA_CAP = 8;

function calendarToLocalContinue(
  calendar,
  nowMs,
  droppedIds,
  watchedEpIds,
  hideMap,
) {
  if (!Array.isArray(calendar) || !calendar.length) return [];
  const now = nowMs != null ? nowMs : Date.now();
  const upcomingWindowMs = CW_UPCOMING_WINDOW_MS;
  const airingWindowMs = CW_AIRING_WINDOW_MS;
  const airedWindowMs = CW_AIRED_WINDOW_MS;
  const dropped =
    droppedIds instanceof Set
      ? droppedIds
      : droppedIds
        ? new Set([...droppedIds].map(Number))
        : null;
  const watched =
    watchedEpIds instanceof Set
      ? watchedEpIds
      : watchedEpIds
        ? new Set([...watchedEpIds].map(Number))
        : null;
  const watchedShows = new Set();
  if (watchedEpIds && watchedEpIds.__showLastAt) {
    for (const sid of Object.keys(watchedEpIds.__showLastAt)) {
      if (watchedEpIds.__showLastAt[sid] > 0) watchedShows.add(Number(sid));
    }
  }
  // 兜底：showLastAt 缺失（老缓存 / 手工补记）时，用 byShow 里挂的集号判断「看过」
  if (watchedEpIds && watchedEpIds.__byShow) {
    for (const sid of Object.keys(watchedEpIds.__byShow)) {
      const seasons = watchedEpIds.__byShow[sid];
      if (
        seasons &&
        typeof seasons === "object" &&
        Object.keys(seasons).length > 0
      )
        watchedShows.add(Number(sid));
    }
  }
  // 有没有拿到可信的「已看」数据；拿不到时不额外过滤，避免整块空白
  const hasWatchedData = !!(
    watchedEpIds &&
    (watchedEpIds.__showLastAt || watchedEpIds.__byShow)
  );
  const out = [];
  for (const item of calendar) {
    if (!item || !item.show || !item.episode) continue;
    const fa = item.first_aired ? Date.parse(item.first_aired) : NaN;
    if (!Number.isFinite(fa)) continue;
    const show = item.show;
    const ep = item.episode;
    const sid = show.ids && show.ids.trakt;
    const epid = ep.ids && ep.ids.trakt;
    if (sid == null) continue;
    if (dropped && dropped.has(Number(sid))) continue;
    if (epid != null && watched && watched.has(Number(epid))) continue;
    let status = null;
    if (fa > now) {
      if (fa - now <= upcomingWindowMs) status = "upcoming";
    } else {
      const ago = now - fa;
      if (ago <= airingWindowMs) status = "airing";
      else if (ago <= airedWindowMs) status = "aired";
    }
    if (!status) continue;

    // 待播出 / 正在播出 / 刚播完 都必须「看过至少一集」才进继续观看
    // 一集都没看过的剧，即使马上要播新集，也不在继续观看里出现
    if (hasWatchedData && !watchedShows.has(Number(sid))) continue;
    const entry = {
      show,
      episode: ep,
      paused_at: item.first_aired,
      last_watched_at: item.first_aired,
      __localUpcoming: status === "upcoming",
      __localAired: status === "aired" || status === "airing",
      __localAirStatus: status,
      __firstAired: item.first_aired,
    };
    if (
      hideMap &&
      typeof isCwHiddenEntry === "function" &&
      isCwHiddenEntry(entry, hideMap)
    )
      continue;
    out.push(entry);
  }
  return out;
}

function isLocalAirEntry(entry) {
  return !!(entry && (entry.__localUpcoming || entry.__localAired));
}

function entryProgressPercent(entry) {
  if (!entry) return null;
  if (typeof entry.progress === "number") return entry.progress;
  if (entry.progress && typeof entry.progress.percent === "number")
    return entry.progress.percent;
  return null;
}

const STALE_PAUSE_GRACE_MS = 30 * 60 * 1000;

function isStalePause(entry, watchedSet) {
  if (!entry || !entry.paused_at || isLocalAirEntry(entry)) return false;
  const showLastMap = watchedSet && watchedSet.__showLastAt;
  if (
    !showLastMap ||
    !entry.show ||
    !entry.show.ids ||
    entry.show.ids.trakt == null
  )
    return false;
  const sid = Number(entry.show.ids.trakt);
  const lastMs = Number(showLastMap[sid] || showLastMap[String(sid)] || 0);
  const pausedMs = Date.parse(entry.paused_at);
  if (!Number.isFinite(pausedMs)) return false;

  const dataTs = Number(watchedSet.__dataTs) || 0;
  if (dataTs && pausedMs > dataTs) return false;
  return lastMs > 0 && pausedMs + STALE_PAUSE_GRACE_MS < lastMs;
}

const REWATCH_GRACE_MS = 2 * 60 * 1000;

function episodeIsTerminal(entry) {
  if (!entry || !entry.episode) return false;
  const n = Number(entry.episode.number);
  if (!Number.isFinite(n) || n <= 0) return false;
  const show = entry.show || {};
  const candidates = [];
  if (show.aired_episodes != null && Number(show.aired_episodes) > 0)
    candidates.push(Math.floor(Number(show.aired_episodes)));
  if (show.episode_count != null && Number(show.episode_count) > 0)
    candidates.push(Math.floor(Number(show.episode_count)));
  if (entry.progress && typeof entry.progress === "object") {
    const aired = Number(entry.progress.aired);
    if (Number.isFinite(aired) && aired > 0) candidates.push(Math.floor(aired));
  }
  if (!candidates.length) return false;
  return n >= Math.max.apply(null, candidates);
}

function residualPlaybackVerdict(entry, watchedSet) {
  if (!entry || !watchedSet) return "unsure";
  if (!entry.episode || !entry.episode.ids || entry.episode.ids.trakt == null)
    return "unsure";
  const epId = Number(entry.episode.ids.trakt);
  if (!watchedSet.has(epId)) return "unsure";

  const p = entryProgressPercent(entry);
  if (typeof p !== "number" || p <= 0) return "drop";

  if (episodeIsTerminal(entry)) return "drop";
  const playedMs = Date.parse(entry.paused_at || entry.updated_at || "");
  const lastMap = watchedSet.__showLastAt;
  const sid = entry.show && entry.show.ids ? Number(entry.show.ids.trakt) : NaN;
  const lastMs =
    lastMap && Number.isFinite(sid)
      ? Number(lastMap[sid] || lastMap[String(sid)] || 0)
      : 0;

  if (lastMs > 0 && Number.isFinite(playedMs)) {
    if (playedMs <= lastMs + REWATCH_GRACE_MS) return "drop";

    return "keep";
  }

  if (!Number.isFinite(playedMs)) return "drop";

  return "drop";
}

function filterContinueEntries(list, watchedSet) {
  if (!Array.isArray(list)) return [];
  if (!watchedSet) return list.filter(Boolean);
  return list.filter((e) => {
    if (!e) return false;
    if (isLocalAirEntry(e)) return true;
    if (e.episode && e.episode.ids && e.episode.ids.trakt != null) {
      const verdict = residualPlaybackVerdict(e, watchedSet);
      if (verdict === "drop") return false;
      if (verdict === "keep") return true;
    }
    if (isStalePause(e, watchedSet)) return false;
    return true;
  });
}

function bumpShowLastAt(map, sid, atMs) {
  if (sid == null || !Number.isFinite(atMs)) return;
  const k = Number(sid);
  if (!map[k] || atMs > map[k]) map[k] = atMs;
}

function mergeContinueLists(
  playbackList,
  upNextList,
  limit = 20,
  droppedIds = null,
  watchedEpIds = null,
  hideMap = null,
  localAiredList = null,
  watchedMovieIds = null,
) {
  const seen = new Map();
  const out = [];
  const movieWatched =
    watchedMovieIds instanceof Set
      ? watchedMovieIds
      : watchedMovieIds
        ? new Set([...watchedMovieIds].map(Number))
        : null;
  const dropped =
    droppedIds instanceof Set
      ? droppedIds
      : droppedIds
        ? new Set([...droppedIds].map(Number))
        : null;
  const watched =
    watchedEpIds instanceof Set
      ? watchedEpIds
      : watchedEpIds
        ? new Set([...watchedEpIds].map(Number))
        : null;
  const autoUnhide = new Set();
  function keyOf(entry) {
    if (!entry) return null;
    if (entry.movie && entry.movie.ids && entry.movie.ids.trakt != null)
      return "m:" + entry.movie.ids.trakt;
    const show = entry.show;
    if (!show || !show.ids || show.ids.trakt == null) return null;
    return "s:" + show.ids.trakt;
  }
  function entryTime(entry) {
    if (!entry) return 0;
    if (entry.__localUpcoming || entry.__localAired) {
      return Date.parse(entry.__firstAired || entry.paused_at || "") || 0;
    }
    const t =
      entry.paused_at ||
      entry.last_watched_at ||
      (entry.progress && entry.progress.last_watched_at) ||
      "";
    return Date.parse(t) || 0;
  }
  function isDropped(entry) {
    if (!dropped || !dropped.size) return false;
    const show = entry && entry.show;
    const id = show && show.ids && show.ids.trakt;
    return id != null && dropped.has(Number(id));
  }
  function isFinishedPlayback(entry) {
    if (!entry) return false;
    const p = entry.progress;
    if (typeof p === "number" && p >= 90) return true;
    return false;
  }
  function isCaughtUp(entry) {
    if (!entry || !entry.progress || typeof entry.progress !== "object")
      return false;
    const completed = Number(entry.progress.completed);
    const aired = Number(entry.progress.aired);
    if (!Number.isFinite(completed) || !Number.isFinite(aired) || aired <= 0)
      return false;
    return completed >= aired;
  }

  const skipStats = {
    error: 0,
    dropped: 0,
    hidden: 0,
    finished: 0,
    caughtUp: 0,
    notStarted: 0,
    watched: 0,
    stale: 0,
  };
  function markSkip(why) {
    skipStats[why] = (skipStats[why] || 0) + 1;
    return true;
  }
  function shouldSkip(entry) {
    if (!entry || entry.__error) return markSkip("error");
    if (isDropped(entry)) return markSkip("dropped");
    if (
      movieWatched &&
      entry.movie &&
      entry.movie.ids &&
      entry.movie.ids.trakt != null &&
      movieWatched.has(Number(entry.movie.ids.trakt))
    )
      return markSkip("watched");
    if (hideMap && isCwHiddenEntry(entry, hideMap)) return markSkip("hidden");
    if (hideMap) {
      const show = entry && entry.show;
      const sid = show && show.ids && show.ids.trakt;
      if (sid != null) {
        const h = hideMap[String(sid)] || hideMap[sid];
        if (h && !isCwHiddenEntry(entry, hideMap)) {
          autoUnhide.add(Number(sid));
        }
      }
    }
    if (typeof entry.progress === "number" && isFinishedPlayback(entry))
      return markSkip("finished");
    if (entry.progress && typeof entry.progress === "object") {
      if (isCaughtUp(entry)) return markSkip("caughtUp");
      const completed = Number(entry.progress.completed);
      const aired = Number(entry.progress.aired);
      const hasAiredEpisodes = Number.isFinite(aired) && aired > 0;

      if (
        !hasAiredEpisodes &&
        (!Number.isFinite(completed) || completed <= 0)
      ) {
        return markSkip("notStarted");
      }
    }
    if (
      watched &&
      entry.episode &&
      entry.episode.ids &&
      entry.episode.ids.trakt
    ) {
      const verdict = residualPlaybackVerdict(entry, watched);
      if (verdict === "drop") return markSkip("watched");

    }
    if (isStalePause(entry, watched)) return markSkip("stale");
    return false;
  }
  function pushList(list) {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      if (shouldSkip(entry)) continue;
      if (entry && entry.__isRewatch) delete entry.__isRewatch;
      const k = keyOf(entry);
      if (k) {
        if (seen.has(k)) {
          const idx = seen.get(k);
          if (entryTime(entry) > entryTime(out[idx])) {
            out[idx] = entry;
          }
          continue;
        }
        seen.set(k, out.length);
      }
      out.push(entry);
    }
  }
  pushList(playbackList);
  pushList(localAiredList);
  pushList(upNextList);
  out.sort((a, b) => {
    const loc = (x) => !!(x && (x.__localUpcoming || x.__localAired));
    if (loc(a) !== loc(b)) return loc(a) ? 1 : -1;
    if (loc(a) && loc(b)) {
      const fa = Date.parse(a.__firstAired || a.paused_at || "") || 0;
      const fb = Date.parse(b.__firstAired || b.paused_at || "") || 0;
      return fa - fb;
    }
    const ta =
      a.paused_at ||
      a.last_watched_at ||
      (a.progress && a.progress.last_watched_at) ||
      "";
    const tb =
      b.paused_at ||
      b.last_watched_at ||
      (b.progress && b.progress.last_watched_at) ||
      "";

    return (
      (Date.parse(String(tb)) || 0) - (Date.parse(String(ta)) || 0)
    );
  });
  const cap = Math.max(1, limit | 0);
  const isLocalAirItem = (x) => !!(x && (x.__localUpcoming || x.__localAired));
  let result;
  if (out.length <= cap) {
    result = out.slice();
  } else {
    // 本地日历条目（即将播出 / 刚播完）单独占用额外名额，
    // 否则继续观看满 20 条时它们会被 slice 全部裁掉，等于白算
    const localPart = out.filter(isLocalAirItem).slice(0, CW_LOCAL_EXTRA_CAP);
    const normalPart = out.filter((x) => !isLocalAirItem(x));
    result = normalPart.slice(0, cap).concat(localPart);
  }
  if (autoUnhide.size) {
    Object.defineProperty(result, "__autoUnhide", {
      value: [...autoUnhide],
      enumerable: false,
    });
  }
  Object.defineProperty(result, "__skipStats", {
    value: skipStats,
    enumerable: false,
  });
  return result;
}

function applyRewatchFlags(list, watchedEpIds) {
  if (!Array.isArray(list)) return list;
  const set =
    watchedEpIds instanceof Set
      ? watchedEpIds
      : watchedEpIds
        ? new Set([...watchedEpIds].map(Number))
        : null;
  for (const entry of list) {
    if (!entry) continue;
    if (entry.__isRewatch) delete entry.__isRewatch;
    if (!set || !set.size) continue;
    const ep =
      entry.episode || (entry.progress && entry.progress.next_episode) || null;
    const id = ep && ep.ids && ep.ids.trakt;
    if (id != null && set.has(Number(id))) {
      entry.__isRewatch = true;
    }
  }
  return list;
}

async function attachContinueStillsForPlayback(
  list,
  env,
  ctx,
  userKey,
  opts = {},
) {
  if (!env || !env.TMDB_API_KEY || !Array.isArray(list) || !list.length)
    return list;
  const maxFetch =
    opts.maxFetch != null ? Math.max(0, Number(opts.maxFetch) || 0) : 20;
  const imgKey = CK.pbImages(userKey || "anon");
  const imgMap = await loadImageMap(env, imgKey);
  const normalized = [];
  for (const entry of list) {
    if (!entry) continue;
    if (entry.movie && entry.movie.ids && entry.movie.ids.tmdb) {
      const j = {
        entry,
        ep: null,
        tmdbId: entry.movie.ids.tmdb,
        season: null,
        number: null,
        kind: "movie",
        k: pbImageKey(entry),
      };
      if (!applyPbImage(j, imgMap) && normalized.length < maxFetch) {
        normalized.push(j);
      }
      continue;
    }
    let ep = null,
      show = null;
    if (entry.episode && entry.show) {
      ep = entry.episode;
      show = entry.show;
    } else if (entry.show && entry.progress && entry.progress.next_episode) {
      ep = entry.progress.next_episode;
      show = entry.show;
    } else if (entry.show) {
      show = entry.show;
    } else {
      continue;
    }
    const tmdbId = show && show.ids && show.ids.tmdb;
    if (!tmdbId) continue;
    const season = ep
      ? ep.season != null
        ? ep.season
        : ep.season_number
      : null;
    const number = ep
      ? ep.number != null
        ? ep.number
        : ep.episode_number
      : null;
    const j = {
      entry,
      ep,
      tmdbId,
      season,
      number,
      kind: "tv",
      k: pbImageKey(entry),
    };
    if (!applyPbImage(j, imgMap) && normalized.length < maxFetch) {
      normalized.push(j);
    }
  }
  if (!normalized.length) return list;
  const seasonKey = (id, s) => id + ":" + s;
  const seasonMaps = new Map();
  const needSeasons = [];
  for (const j of normalized) {
    if (j.kind !== "tv" || j.season == null) continue;
    const k = seasonKey(j.tmdbId, j.season);
    if (!seasonMaps.has(k)) {
      seasonMaps.set(k, null);
      needSeasons.push({ k, tmdbId: j.tmdbId, season: j.season });
    }
  }
  const batch = 5;
  for (let i = 0; i < needSeasons.length; i += batch) {
    const slice = needSeasons.slice(i, i + batch);
    await Promise.all(
      slice.map(async (s) => {
        try {
          const map = await tmdbSeasonStillMap(s.tmdbId, s.season, env, ctx);
          seasonMaps.set(s.k, map);
        } catch (_) {
          seasonMaps.set(s.k, null);
        }
      }),
    );
  }
  await Promise.all(
    normalized.map(async (j) => {
      try {
        if (j.kind === "tv" && j.season != null && j.number != null) {
          const map = seasonMaps.get(seasonKey(j.tmdbId, j.season));
          let still =
            map && map.has(Number(j.number)) ? map.get(Number(j.number)) : null;
          if (!still) {
            still = await tmdbEpisodeStill(
              j.tmdbId,
              j.season,
              j.number,
              env,
              ctx,
            );
          }
          if (still) {
            j.entry.__stillUrl = still;
            if (j.ep) j.ep.__stillUrl = still;
          }
        }
        if (!j.entry.__stillUrl) {
          const bd = await tmdbShowBackdrop(j.tmdbId, env, ctx, j.kind);
          if (bd) j.entry.__backdropUrl = bd;
        }
        j.entry.__tmdbId = j.tmdbId;
        if (j.ep) j.ep.__tmdbId = j.tmdbId;
        const zh = await tmdbZhTitle(
          j.kind === "movie" ? "movie" : "tv",
          j.tmdbId,
          env,
          ctx,
        );
        if (zh) j.entry.__zhTitle = zh;
      } catch (_) {}
    }),
  );
  let dirty = false;
  for (const j of normalized) {
    if (!j.k) continue;
    const old = imgMap[j.k] || {};
    let changed = false;
    if (j.entry.__stillUrl && j.entry.__stillUrl !== old.s) {
      old.s = j.entry.__stillUrl;
      changed = true;
    }
    if (j.entry.__backdropUrl && j.entry.__backdropUrl !== old.b) {
      old.b = j.entry.__backdropUrl;
      changed = true;
    }
    if (j.entry.__zhTitle && j.entry.__zhTitle !== old.t) {
      old.t = j.entry.__zhTitle;
      changed = true;
    }
    if (changed) {
      imgMap[j.k] = old;
      dirty = true;
    }
  }
  if (dirty) saveImageMap(env, ctx, imgKey, imgMap);
  return list;
}

async function attachEntityPosters(list, env, ctx, imgKey, maxFetch = 30) {
  if (!env || !Array.isArray(list) || !list.length) return list;
  if (!env.TMDB_API_KEY) return list;
  const limit = maxFetch != null ? Math.max(0, Number(maxFetch) || 0) : 30;
  const map = await loadImageMap(env, imgKey);
  let dirty = false;
  const jobs = [];
  for (const item of list) {
    if (!item) continue;
    const entity = item.movie || item.show;
    if (!entity) continue;
    const tmdbId = entity.ids && entity.ids.tmdb;
    if (!tmdbId) continue;
    const isMovie = !!item.movie;
    const kind = isMovie ? "movie" : "tv";
    const k = (isMovie ? "m:" : "s:") + tmdbId;
    if (map[k] && map[k].p) {
      entity.__posterUrl = map[k].p;
      item.__posterUrl = map[k].p;
      continue;
    }
    if (jobs.length >= limit) continue;
    jobs.push({ item, entity, tmdbId, kind, k });
  }
  for (let i = 0; i < jobs.length; i += 6) {
    const slice = jobs.slice(i, i + 6);
    await Promise.all(
      slice.map(async (j) => {
        try {
          const data = await tmdbDetailCached(
            `/${j.kind}/${j.tmdbId}`,
            env,
            ctx,
            TMDB_KV_TTL,
          );
          if (data && data.poster_path) {
            const url = tmdbPoster(data.poster_path, "w780");
            j.entity.__posterUrl = url;
            j.item.__posterUrl = url;
            const old = map[j.k] || {};
            if (old.p !== url) {
              old.p = url;
              map[j.k] = old;
              dirty = true;
            }
          }
        } catch (_) {}
      }),
    );
  }
  if (dirty) saveImageMap(env, ctx, imgKey, map);
  return list;
}

async function attachWatchlistStills(list, env, ctx, userKey, opts = {}) {
  if (!env || !Array.isArray(list) || !list.length) return list;
  const maxFetch =
    opts.maxFetch != null
      ? Math.max(0, Number(opts.maxFetch) || 0)
      : WATCHLIST_PAGE_SIZE;
  const imgKey = CK.wlImages(userKey || "anon");
  const imgMap = await loadImageMap(env, imgKey);
  let dirty = false;
  if (env.TMDB_API_KEY) {
    const posterJobs = [];
    for (const item of list) {
      if (!item) continue;
      const movie = item.movie;
      const show = item.show;
      const entity = movie || show;
      if (!entity) continue;
      const tmdbId = entity.ids && entity.ids.tmdb;
      if (!tmdbId) continue;
      const kind = movie ? "movie" : "tv";
      const k = (movie ? "m:" : "s:") + tmdbId;
      if (imgMap[k] && imgMap[k].p) {
        entity.__posterUrl = imgMap[k].p;
        item.__posterUrl = imgMap[k].p;
        continue;
      }
      if (posterJobs.length >= maxFetch) continue;
      posterJobs.push({ item, entity, tmdbId, kind, k });
    }
    for (let i = 0; i < posterJobs.length; i += 6) {
      const slice = posterJobs.slice(i, i + 6);
      await Promise.all(
        slice.map(async (j) => {
          try {
            const data = await tmdbDetailCached(
              `/${j.kind}/${j.tmdbId}`,
              env,
              ctx,
              TMDB_KV_TTL,
            );
            if (data && data.poster_path) {
              const url = tmdbPoster(data.poster_path, "w780");
              j.entity.__posterUrl = url;
              j.item.__posterUrl = url;
              const old = imgMap[j.k] || {};
              if (old.p !== url) {
                old.p = url;
                imgMap[j.k] = old;
                dirty = true;
              }
            }
          } catch (_) {}
        }),
      );
    }
  }
  if (env.TMDB_API_KEY) {
    const jobs = [];
    for (const item of list) {
      if (!item || !item.episode || !item.show) continue;
      if (item.__stillUrl || (item.episode && item.episode.__stillUrl))
        continue;
      const ep = item.episode;
      const show = item.show;
      const tmdbId = show.ids && show.ids.tmdb;
      const season = ep.season != null ? ep.season : ep.season_number;
      const number = ep.number != null ? ep.number : ep.episode_number;
      if (!tmdbId || season == null || number == null) continue;
      const k = pbImageKey(item);
      if (k && imgMap[k] && imgMap[k].s) {
        item.__stillUrl = imgMap[k].s;
        ep.__stillUrl = imgMap[k].s;
        continue;
      }
      if (jobs.length >= maxFetch) continue;
      jobs.push({ item, ep, tmdbId, season, number, k });
    }
    for (let i = 0; i < jobs.length; i += 6) {
      const slice = jobs.slice(i, i + 6);
      await Promise.all(
        slice.map(async (j) => {
          try {
            const url = await tmdbEpisodeStill(
              j.tmdbId,
              j.season,
              j.number,
              env,
              ctx,
            );
            if (url) {
              j.item.__stillUrl = url;
              j.ep.__stillUrl = url;
              if (j.k) {
                const old = imgMap[j.k] || {};
                if (old.s !== url) {
                  old.s = url;
                  imgMap[j.k] = old;
                  dirty = true;
                }
              }
            }
          } catch (_) {}
        }),
      );
    }
  }
  if (dirty) saveImageMap(env, ctx, imgKey, imgMap);
  return list;
}

function mapTmdbItem(r, typeHint) {
  if (!r || !r.id) return null;
  const mt = typeHint || r.media_type;
  const isMovie = mt === "movie";
  if (mt !== "movie" && mt !== "tv" && mt !== "show") return null;
  const dateStr = r.release_date || r.first_air_date || "";
  return {
    type: isMovie ? "movie" : "show",
    tmdbId: r.id,
    title: isMovie
      ? r.title || r.original_title || ""
      : r.name || r.original_name || r.title || "",
    year: dateStr.slice(0, 4),
    date: dateStr,
    poster: r.poster_path ? tmdbPoster(r.poster_path) : null,
    overview: r.overview || "",
    popularity: r.popularity || 0,
  };
}

function isUsableBoardPayload(data) {
  if (data == null) return false;
  if (Array.isArray(data)) return data.length > 0;
  if (typeof data !== "object") return false;
  try {
    const keys = Object.keys(data);
    if (!keys.length) return false;
    // 必须至少有一个非空数组（条目列表），单纯 last_updated 字符串不算有效
    let hasItems = false;
    for (const k of keys) {
      if (k === "last_updated" || k === "updated_at" || k === "source") continue;
      const v = data[k];
      if (Array.isArray(v) && v.length > 0) {
        hasItems = true;
        break;
      }
      if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const sk of Object.keys(v)) {
          const sv = v[sk];
          if (Array.isArray(sv) && sv.length > 0) {
            hasItems = true;
            break;
          }
          if (sv && typeof sv === "object" && !Array.isArray(sv)) {
            for (const ssk of Object.keys(sv)) {
              if (Array.isArray(sv[ssk]) && sv[ssk].length > 0) {
                hasItems = true;
                break;
              }
            }
          }
          if (hasItems) break;
        }
      }
      if (hasItems) break;
    }
    return hasItems;
  } catch {
    return false;
  }
}

const MEM_CACHE_TTL = 12 * 3600 * 1000;
const __hotListMem = new Map();
const __summaryMem = new Map();

function memCacheGet(map, key) {
  const e = map.get(key);
  if (!e) return undefined;
  if (Date.now() - e.ts > MEM_CACHE_TTL) {
    map.delete(key);
    return undefined;
  }
  return e.data;
}

function memCacheSet(map, key, data, cap) {
  if (data === undefined || data === null) return;
  map.set(key, { data, ts: Date.now() });
  const limit = cap || 32;
  if (map.size > limit) {
    const drop = Math.max(1, Math.ceil(limit / 4));
    const it = map.keys();
    for (let i = 0; i < drop; i++) {
      const k = it.next().value;
      if (k) map.delete(k);
    }
  }
}

async function getBoardRaw(
  env,
  ctx,
  { key, url, ttl, force = false, validateOnFetch = true, swr = true },
) {
  if (!force) {
    const hit = memCacheGet(__hotListMem, key);
    if (hit !== undefined) return hit;
  }
  const data = await cachedJSON(
    env,
    ctx,
    key,
    async () => {
      try {
        const headers = siteHeaders();
        // 条件请求：有缓存 ETag 时带上，304 则复用旧数据
        const etagKey = key + ":etag";
        let prevEtag = null;
        try {
          if (env && env.TMDB_CACHE) {
            const ev = await env.TMDB_CACHE.get(etagKey);
            if (ev) prevEtag = ev;
          }
        } catch {}
        if (prevEtag) headers["If-None-Match"] = prevEtag;
        const r = await fetchT(url, { headers }, 10000);
        if (r.status === 304) {
          // 数据未变，返回 null 让 cachedJSON 走 fallback
          return null;
        }
        if (!r.ok) return null;
        const data = await r.json();
        // 空数据或无效结构：返回 null，不覆盖已有 KV（兜底用旧数据）
        if (validateOnFetch && !isUsableBoardPayload(data)) return null;
        if (!isUsableBoardPayload(data)) return null;
        // 存 ETag 供下次条件请求
        const etag = r.headers.get("ETag") || r.headers.get("etag");
        if (etag && env && env.TMDB_CACHE) {
          try {
            env.TMDB_CACHE.put(etagKey, etag, { expirationTtl: ttl || 86400 }).catch(() => {});
          } catch {}
        }
        return data;
      } catch {
        return null;
      }
    },
    {
      ttl,
      missTtl: 600,
      swr: force ? false : swr,
      jitter: 300,
      bypass: !!force,
      revalidate: !!force,
      staleRetention: PUBLIC_STALE_RETENTION,
    },
  );

  if (isUsableBoardPayload(data)) memCacheSet(__hotListMem, key, data, 8);
  return data;
}

async function getDoubanRaw(env, ctx, force) {
  return getBoardRaw(env, ctx, {
    key: CK.douban,
    url: DOUBAN_API,
    ttl: DOUBAN_KV_TTL,
    force,
    validateOnFetch: true,
    swr: true,
  });
}

function isHkTw(region) {
  if (!region) return false;
  return region.indexOf("香港") >= 0 || region.indexOf("台湾") >= 0;
}

function mapDoubanItem(x) {
  if (!x) return null;
  // 兼容旧 tmdbId 和新数据的 id + type:"tmdb"
  const tmdbId = x.tmdbId || (x.type === "tmdb" && x.id) || x.id;
  if (!tmdbId) return null;
  return {
    tmdbId: String(tmdbId),
    title: x.title || "",
    year: (x.releaseDate || "").slice(0, 4),
    poster: x.posterPath
      ? `https://image.tmdb.org/t/p/w780${x.posterPath}`
      : null,
    overview: x.description || "",
    rating: Number(x.rating) || 0,
    region: x.regionTitle || "",
    genre: x.genreTitle || "",
    kind: "tv",
  };
}

function collectDoubanLists(data, keys) {
  const out = [];
  if (!data) return out;
  for (const k of keys) {
    const v = data[k];
    if (Array.isArray(v)) out.push(...v);
  }
  return out;
}

function pickDoubanSection(data, section, filter) {
  if (!data) return [];
  const typeFilter = filter || "all";
  let tvRaw = [];
  if (section === "domestic") tvRaw = collectDoubanLists(data, ["tv_domestic"]);
  else if (section === "jpkr")
    tvRaw = collectDoubanLists(data, ["tv_japanese", "tv_korean"]);
  else if (section === "western")
    tvRaw = collectDoubanLists(data, ["tv_american"]);
  else if (section === "animation")
    tvRaw = collectDoubanLists(data, ["tv_animation"]);
  else if (section === "documentary")
    tvRaw = collectDoubanLists(data, ["tv_documentary"]);
  else if (section === "variety")
    tvRaw = collectDoubanLists(data, ["show_domestic", "show_foreign"]);
  else if (section === "hktw")
    tvRaw = []; // 新数据源已无地区字段，港台暂隐藏
  else tvRaw = Array.isArray(data.tv) ? data.tv : [];
  let mvRaw = [];
  if (section === "domestic")
    mvRaw = collectDoubanLists(data, ["movie_domestic", "movies_domestic"]);
  else if (section === "jpkr")
    mvRaw = collectDoubanLists(data, [
      "movie_japanese",
      "movie_korean",
      "movies_japanese",
      "movies_korean",
    ]);
  else if (section === "western")
    mvRaw = collectDoubanLists(data, ["movie_american", "movies_american"]);
  else if (section === "hktw" || section === "animation" || section === "documentary" || section === "variety")
    mvRaw = [];
  const seen = new Set(),
    out = [],
    MAX = 150;
  function push(list, kind) {
    for (const x of list) {
      const item = mapDoubanItem(x);
      if (!item) continue;
      if (seen.has(item.tmdbId)) continue;
      seen.add(item.tmdbId);
      item.kind = kind;
      out.push(item);
      if (out.length >= MAX) return true;
    }
    return false;
  }
  if (typeFilter === "movie") push(mvRaw, "movie");
  else if (typeFilter === "tv") push(tvRaw, "tv");
  else {
    push(mvRaw, "movie");
    push(tvRaw, "tv");
  }
  return out;
}

function renderBoardMediaItems(items, mapItem) {
  if (!Array.isArray(items) || !items.length) return "";
  return items
    .map((x, i) => {
      const isMovie = x.kind === "movie";
      const base = {
        poster: x.poster,
        tag: isMovie ? "电影" : "剧集",
        tagClass: isMovie ? "movie" : "episode",
        title: x.title,
        overview: x.overview,
        line1: x.year || "",
        line2: "",
        delay: Math.min(i, 24) * 20,
        detailType: isMovie ? "movie" : "show",
        detailId: "tmdb-" + x.tmdbId,
      };
      return mediaItem(
        mapItem ? Object.assign(base, mapItem(x, i, isMovie)) : base,
      );
    })
    .join("");
}

function renderDoubanItems(items) {
  return renderBoardMediaItems(items, (x) => ({
    line2: [x.region, x.genre].filter(Boolean).join(" · "),
  }));
}

function renderTheaterItems(items) {
  return renderBoardMediaItems(items, (x) => ({
    line2: x.platform || "",
  }));
}

function renderGuduoItems(items) {
  return renderBoardMediaItems(items, (x, i, isMovie) => {
    const tag = x.category || (isMovie ? "电影" : "剧集");
    const heatLine = x.heat
      ? `热度 ${x.heat}`
      : [x.region, x.genre].filter(Boolean).join(" · ");
    return {
      tag: x.rank != null ? `#${x.rank}` : tag,
      line1: [x.year, tag].filter(Boolean).join(" · "),
      line2: heatLine,
    };
  });
}

async function handleDoubanList(request, env, ctx) {

  if (!allowEnrich(request))
    return new Response("too many requests", { status: 429 });
  const url = new URL(request.url);
  const section = url.searchParams.get("section") || "domestic";
  const mode = url.searchParams.get("mode") || "grid";
  const filter = url.searchParams.get("filter") || "all";
  const force = url.searchParams.get("force") === "1";
  const data = await getDoubanRaw(env, ctx, force);
  const outHeaders = {
    "Content-Type": CT_HTML,
    "Cache-Control": CC_NO_STORE,
  };
  // 首页批量模式：一次返回所有区块 HTML，减少请求数
  if (mode === "home") {
    const sections = [
      ["douban-domestic", "domestic"],
      ["douban-jpkr", "jpkr"],
      ["douban-western", "western"],
      ["douban-animation", "animation"],
      ["douban-variety", "variety"],
      ["douban-documentary", "documentary"],
    ];
    const result = {};
    for (const [id, sec] of sections) {
      const items = pickDoubanSection(data, sec, filter);
      const html = renderDoubanItems(items);
      result[id] = html
        ? `<div class="h-scroll">${html}</div>`
        : "";
    }
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": CT_JSON, "Cache-Control": CC_NO_STORE },
    });
  }
  const items = pickDoubanSection(data, section, filter);
  const html = renderDoubanItems(items);
  return listResp(html, mode, outHeaders);
}

async function getTheaterRaw(env, ctx, force) {
  return getBoardRaw(env, ctx, {
    key: CK.theater,
    url: THEATER_API,
    ttl: THEATER_KV_TTL,
    force,
    validateOnFetch: false,
    swr: 57600,
  });
}

function collectTheaterItems(data) {
  const out = [];
  if (!data || typeof data !== "object") return out;
  for (const key of Object.keys(data)) {
    if (key === "last_updated" || key === "updated_at") continue;
    const node = data[key];
    if (!node || typeof node !== "object") continue;
    walkNode(node, key, out);
  }
  return out;
}

function walkNode(node, platform, out) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const x of node) {
      if (x && typeof x === "object") {
        const tid =
          x.tmdbId ||
          x.tmdb_id ||
          x.tmdbid ||
          (x.type === "tmdb" && x.id) ||
          x.id;
        if (tid) out.push({ ...x, __platform: platform });
      }
    }
    return;
  }
  if (typeof node === "object") {
    for (const k of Object.keys(node)) {
      walkNode(node[k], platform, out);
    }
  }
}

function normalizeTheaterPlatformName(name) {
  if (!name) return "";
  const s = String(name).trim();
  if (s === "玛卡巴卡的悬疑剧") return "悬疑剧";
  return s;
}

function theaterPlatformOf(x) {
  if (!x) return "";
  if (x.__platform) return normalizeTheaterPlatformName(x.__platform);
  const candidates = [
    x.platform,
    x.platformTitle,
    x.platformName,
    x.channel,
    x.source,
    x.sourceName,
    x.from,
    x.site,
    x.vendor,
    x.tag,
    x.category,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) {
      return normalizeTheaterPlatformName(c);
    }
  }
  return "";
}

function getTheaterPlatforms(data) {
  const list = collectTheaterItems(data);
  const seen = new Set(),
    out = [];
  for (const x of list) {
    const p = theaterPlatformOf(x);
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  const idx = out.indexOf("悬疑剧");
  if (idx >= 0 && idx !== out.length - 1) {
    out.splice(idx, 1);
    out.push("悬疑剧");
  }
  return out;
}

function pickTheaterSection(data, platform) {
  const list = collectTheaterItems(data);
  const filtered =
    !platform || platform === "all"
      ? list
      : list.filter((x) => theaterPlatformOf(x) === platform);
  const seen = new Set(),
    out = [];
  for (const x of filtered) {
    const tmdbId =
      x.tmdbId ||
      x.tmdb_id ||
      x.tmdbid ||
      (x.type === "tmdb" && x.id) ||
      x.id;
    if (!tmdbId || seen.has(String(tmdbId))) continue;
    seen.add(String(tmdbId));
    out.push({
      tmdbId: String(tmdbId),
      title: x.title || x.name || x.showTitle || "",
      year: String(
        x.releaseDate ||
          x.release_date ||
          x.firstAirDate ||
          x.year ||
          x.date ||
          "",
      ).slice(0, 4),
      poster:
        x.posterPath || x.poster_path
          ? `https://image.tmdb.org/t/p/w780${x.posterPath || x.poster_path}`
          : x.poster || x.cover || x.image || null,
      overview: x.description || x.overview || x.summary || "",
      platform: theaterPlatformOf(x),
      kind:
        x.mediaType === "movie" ||
        x.type === "movie" ||
        x.media_type === "movie" ||
        x.isMovie === true
          ? "movie"
          : "tv",
    });
    if (out.length >= 200) break;
  }
  return out;
}

function listResp(html, mode, headers) {
  if (mode !== "hscroll") return new Response(html, { headers });
  if (!html)
    return new Response(
      '<div class="h-scroll-empty"><span class="spinner"></span></div>',
      {
        headers,
      },
    );
  return new Response(`<div class="h-scroll">${html}</div>`, { headers });
}

async function handleTheaterList(request, env, ctx) {

  if (!allowEnrich(request))
    return new Response("too many requests", { status: 429 });
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") || "grid";
  const platform = url.searchParams.get("platform") || "all";
  const force = url.searchParams.get("force") === "1";
  const data = await getTheaterRaw(env, ctx, force);
  const outHeaders = {
    "Content-Type": CT_HTML,
    "Cache-Control": CC_NO_STORE,
  };
  if (mode === "debug") {

    const Ad = await authed(request, env, ctx);
    if (!Ad.ok) return Ad.response;
    const summary = { type: typeof data, keys: [], sample: null, itemCount: 0 };
    if (data && typeof data === "object") {
      summary.keys = Object.keys(data);
      summary.sample = data;
      const theaterItems = collectTheaterItems(data);
      summary.itemCount = theaterItems.length;
      summary.shape = {};
      for (const k of summary.keys) {
        const v = data[k];
        if (Array.isArray(v)) summary.shape[k] = "array[" + v.length + "]";
        else if (v && typeof v === "object")
          summary.shape[k] =
            "object{" + Object.keys(v).slice(0, 5).join(",") + "}";
        else summary.shape[k] = typeof v;
      }
      summary.firstItem = theaterItems[0] || null;
    }
    return new Response(JSON.stringify(summary).slice(0, 8000), {
      headers: {
        "Content-Type": CT_JSON,
        "Cache-Control": CC_NO_STORE,
      },
    });
  }
  if (mode === "platforms") {
    return new Response(
      JSON.stringify({ platforms: getTheaterPlatforms(data) }),
      {
        headers: {
          "Content-Type": CT_JSON,
          "Cache-Control": CC_NO_STORE,
        },
      },
    );
  }
  if (mode === "previews") {
    const names =
      typeof THEATER_PLATFORMS !== "undefined" &&
      Array.isArray(THEATER_PLATFORMS)
        ? THEATER_PLATFORMS
        : getTheaterPlatforms(data).map((n) => ({ id: n, name: n }));
    const previews = {};
    for (const p of names) {
      const key = p.id || p.name || p;
      const items = pickTheaterSection(data, key);
      previews[key] = items
        .map((x) => x.poster)
        .filter(Boolean)
        .slice(0, 4);
    }
    return new Response(JSON.stringify({ previews }), {
      headers: {
        "Content-Type": CT_JSON,
        "Cache-Control": CC_NO_STORE,
      },
    });
  }
  const html = renderTheaterItems(pickTheaterSection(data, platform));
  return listResp(html, mode, outHeaders);
}

async function getGuduoRaw(env, ctx, force) {
  return getBoardRaw(env, ctx, {
    key: CK.guduo,
    url: GUDUO_API,
    ttl: GUDUO_KV_TTL,
    force,
    validateOnFetch: true,
    swr: true,
  });
}

const GUDUO_CATEGORIES = ["剧集", "电影", "动漫", "综艺"];

function mapGuduoItem(x) {
  if (!x || !x.tmdbId) return null;
  const isMovie =
    x.mediaType === "movie" || x.type === "movie" || x.category === "电影";
  return {
    tmdbId: x.tmdbId,
    title: x.title || "",
    year: String(x.releaseDate || x.year || "").slice(0, 4),
    poster: x.posterPath
      ? `https://image.tmdb.org/t/p/w780${x.posterPath}`
      : x.poster || null,
    overview: x.description || x.overview || "",
    rating: Number(x.rating) || 0,
    heat: x.heat != null ? String(x.heat) : "",
    rank: x.rank != null ? Number(x.rank) : null,
    category: x.category || "",
    region: x.regionTitle || "",
    genre: x.genreTitle || "",
    kind: isMovie ? "movie" : "tv",
  };
}

function pickGuduoSection(data, category) {
  if (!data || typeof data !== "object") return [];
  const cats = data.categories || data;
  const out = [];
  const seen = new Set();
  const MAX = 200;
  function pushList(list) {
    if (!Array.isArray(list)) return;
    for (const x of list) {
      const item = mapGuduoItem(x);
      if (!item || seen.has(item.tmdbId)) continue;
      seen.add(item.tmdbId);
      out.push(item);
      if (out.length >= MAX) return true;
    }
    return false;
  }
  if (!category || category === "all") {
    for (const name of GUDUO_CATEGORIES) {
      if (pushList(cats[name])) break;
    }
    if (out.length < MAX && cats && typeof cats === "object") {
      for (const k of Object.keys(cats)) {
        if (GUDUO_CATEGORIES.includes(k)) continue;
        if (pushList(cats[k])) break;
      }
    }
  } else {
    pushList(cats[category]);
  }
  return out;
}

async function handleGuduoList(request, env, ctx) {

  if (!allowEnrich(request))
    return new Response("too many requests", { status: 429 });
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") || "grid";
  const category = url.searchParams.get("category") || "all";
  const force = url.searchParams.get("force") === "1";
  const data = await getGuduoRaw(env, ctx, force);
  const outHeaders = {
    "Content-Type": CT_HTML,
    "Cache-Control": CC_NO_STORE,
  };
  if (mode === "debug") {

    const Ad = await authed(request, env, ctx);
    if (!Ad.ok) return Ad.response;
    const cats = (data && data.categories) || {};
    const summary = {
      type: typeof data,
      keys: data && typeof data === "object" ? Object.keys(data) : [],
      categories: Object.keys(cats),
      counts: {},
      billboard_date: data && data.billboard_date,
      last_updated: data && data.last_updated,
    };
    for (const k of Object.keys(cats)) {
      summary.counts[k] = Array.isArray(cats[k]) ? cats[k].length : 0;
    }
    return new Response(JSON.stringify(summary).slice(0, 4000), {
      headers: {
        "Content-Type": CT_JSON,
        "Cache-Control": CC_NO_STORE,
      },
    });
  }
  if (mode === "categories") {
    const cats = (data && data.categories) || {};
    // 固定展示全部榜单分类：上游某榜当日无数据时也保留入口，
    // 否则分类会莫名其妙地少几个（看起来像功能坏了）。
    const counts = {};
    for (const k of GUDUO_CATEGORIES) {
      counts[k] = Array.isArray(cats[k]) ? cats[k].length : 0;
    }
    const extra = Object.keys(cats).filter(
      (k) =>
        !GUDUO_CATEGORIES.includes(k) &&
        Array.isArray(cats[k]) &&
        cats[k].length > 0,
    );
    for (const k of extra) counts[k] = cats[k].length;
    const list = GUDUO_CATEGORIES.concat(extra);
    return new Response(JSON.stringify({ categories: list, counts }), {
      headers: {
        "Content-Type": CT_JSON,
        "Cache-Control": CC_NO_STORE,
      },
    });
  }
  const items = pickGuduoSection(data, category);
  const html = renderGuduoItems(items);
  if (!html) {
    const label = category && category !== "all" ? `「${category}」` : "";
    const emptyHtml = `<div class="board-empty"><div class="board-empty-t">骨朵${esc(label)}榜今日暂未更新</div><div class="board-empty-s">数据源这一期只推了有内容的榜单，其余分类等它更新后会自动出现</div></div>`;
    return listResp(emptyHtml, mode, outHeaders);
  }
  return listResp(html, mode, outHeaders);
}

const PLATFORMS = {
  hbomax: {
    id: "hbomax",
    name: "HBO Max",
    region: "国外",

    logo: "",
    kind: "watch",
    providers: [1899, 384],
    watchRegion: "US",
  },
  netflix: {
    id: "netflix",
    name: "Netflix",
    region: "国外",
    logo: "https://picui.ogmua.cn/s1/2026/10/14/6acf1d2e2d114.webp",
    kind: "watch",
    providers: [8],
    watchRegion: "US",
  },
  disney: {
    id: "disney",
    name: "Disney+",
    region: "国外",
    logo: "https://picui.ogmua.cn/s1/2026/10/14/6acf1d31c3e92.webp",
    kind: "watch",
    providers: [337],
    watchRegion: "US",
  },
  appletv: {
    id: "appletv",
    name: "Apple TV+",
    region: "国外",
    logo: "https://picui.ogmua.cn/s1/2026/10/14/6acf1d2f8bbd9.webp",
    kind: "watch",
    providers: [350],
    watchRegion: "US",
  },
  prime: {
    id: "prime",
    name: "Prime Video",
    region: "国外",
    logo: "https://picui.ogmua.cn/s1/2026/10/14/6acf1d3007455.webp",
    kind: "watch",
    providers: [9, 119],
    watchRegion: "US",
  },
  bilibili: {
    id: "bilibili",
    name: "哔哩哔哩",
    region: "国内",
    logo: "https://picui.ogmua.cn/s1/2026/10/14/6acf1d2e54fb3.webp",
    kind: "network",
    networks: [1605],
  },
  iqiyi: {
    id: "iqiyi",
    name: "爱奇艺",
    region: "国内",
    logo: "https://picui.ogmua.cn/s1/2026/10/14/6acf1d2e05ad8.webp",
    kind: "network",
    networks: [1330],
  },
  tencent: {
    id: "tencent",
    name: "腾讯视频",
    region: "国内",
    logo: "https://picui.ogmua.cn/s1/2026/10/14/6acf1d2fefe09.webp",
    kind: "network",
    networks: [2007],
  },
  youku: {
    id: "youku",
    name: "优酷",
    region: "国内",
    logo: "https://picui.ogmua.cn/s1/2026/10/14/6acf1d30c04e7.webp",
    kind: "network",
    networks: [1419],
  },
  mgtv: {
    id: "mgtv",
    name: "芒果TV",
    region: "国内",
    logo: "https://picui.ogmua.cn/s1/2026/10/14/6acf1d30dabe2.webp",
    kind: "network",
    networks: [1631],
  },
};

function renderPlatformItems(items) {
  if (!Array.isArray(items) || !items.length) return "";
  return items
    .map((x, i) => {
      const isMovie = x.type === "movie";
      return mediaItem({
        poster: x.poster,
        tag: isMovie ? "电影" : "剧集",
        tagClass: isMovie ? "movie" : "episode",
        title: x.title,
        overview: x.overview,
        line1: x.year || "",
        line2: x.platformName || "",
        delay: Math.min(i, 24) * 20,
        detailType: isMovie ? "movie" : "show",
        detailId: "tmdb-" + x.tmdbId,
      });
    })
    .join("");
}

async function fetchPlatformDiscover(plat, media, page, env) {
  if (!env.TMDB_API_KEY || !plat) return { items: [], totalPages: 1 };
  const pageNum = Math.max(1, Math.min(20, page || 1));
  const wantMovie = media === "all" || media === "movie";
  const wantTv = media === "all" || media === "tv";
  const jobs = [];
  function baseParams(extra, mediaType) {
    const today = new Date().toISOString().slice(0, 10);
    const isMovie = mediaType === "movie";
    const sortBy = isMovie
      ? "primary_release_date.desc"
      : "first_air_date.desc";
    const dateLte = isMovie ? "primary_release_date.lte" : "first_air_date.lte";
    return {
      language: "zh-CN",
      sort_by: sortBy,
      include_adult: "false",
      page: String(pageNum),
      [dateLte]: today,
      ...extra,
    };
  }
  if (plat.kind === "watch") {
    const providerStr = (plat.providers || []).join("|");
    const region = plat.watchRegion || "US";
    if (wantMovie && providerStr) {
      jobs.push(
        tmdbGet(
          tmdbUrl(
            "/discover/movie",
            env,
            baseParams(
              {
                with_watch_providers: providerStr,
                watch_region: region,
                with_watch_monetization_types: "flatrate",
              },
              "movie",
            ),
          ),
        ).then((d) => ({ media: "movie", data: d })),
      );
    }
    if (wantTv && providerStr) {
      jobs.push(
        tmdbGet(
          tmdbUrl(
            "/discover/tv",
            env,
            baseParams(
              {
                with_watch_providers: providerStr,
                watch_region: region,
                with_watch_monetization_types: "flatrate",
              },
              "tv",
            ),
          ),
        ).then((d) => ({ media: "tv", data: d })),
      );
    }
  } else if (plat.kind === "network") {
    const netStr = (plat.networks || []).join("|");
    if (wantTv && netStr) {
      jobs.push(
        tmdbGet(
          tmdbUrl(
            "/discover/tv",
            env,
            baseParams({ with_networks: netStr }, "tv"),
          ),
        ).then((d) => ({ media: "tv", data: d })),
      );
    }
  }
  const results = await Promise.all(jobs);
  const seen = new Set();
  const out = [];
  let maxPages = 1;
  for (const r of results) {
    if (!r || !r.data) continue;
    const tp = Number(r.data.total_pages) || 1;
    if (tp > maxPages) maxPages = tp;
    if (!Array.isArray(r.data.results)) continue;
    for (const row of r.data.results) {
      const item = mapTmdbItem(row, r.media === "movie" ? "movie" : "tv");
      if (!item || !item.tmdbId || seen.has(item.type + ":" + item.tmdbId))
        continue;
      seen.add(item.type + ":" + item.tmdbId);
      item.platformName = plat.name;
      out.push(item);
    }
  }
  out.sort((a, b) => {
    const da = a.date || "";
    const db = b.date || "";
    if (!da && !db) return (b.popularity || 0) - (a.popularity || 0);
    if (!da) return 1;
    if (!db) return -1;
    return db.localeCompare(da);
  });
  return { items: out, totalPages: Math.min(5, maxPages) };
}

async function loadPlatformPreviews(env, ctx, force) {
  const cacheKey = CK.platformPreviews;
  if (!force) {
    const raw = await kvGetJSON(env, cacheKey, false);
    if (raw && raw !== KV_MISS && raw !== KV_ERR) {
      const v = raw.data !== undefined ? raw.data : raw;
      if (v && v.items && typeof v.items === "object") return v.items;
    }
  }
  const items = {};
  const queue = HOME_PLATFORM_IDS.filter((pid) => PLATFORMS[pid]);
  let failures = 0;
  const worker = async () => {
    while (queue.length) {
      const pid = queue.shift();
      try {
        const r = await fetchPlatformDiscover(PLATFORMS[pid], "all", 1, env);
        items[pid] = (r.items || [])
          .filter((x) => x.poster)
          .slice(0, 5)
          .map((x) => x.poster.replace("/w185", "/w780"));
      } catch {

        items[pid] = [];
        failures++;
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker(), worker()]);
  const payload = { items };
  kvRemember(cacheKey, payload);

  if (failures === 0)
    kvPutJSON(
      env,
      ctx,
      cacheKey,
      payload,
      PLATFORM_KV_TTL,
      false,
      !!force,
      PUBLIC_STALE_RETENTION,
    );
  return items;
}

async function handlePlatformList(request, env, ctx) {

  if (!allowEnrich(request))
    return new Response("too many requests", { status: 429 });
  const url = new URL(request.url);
  const id = (url.searchParams.get("id") || "").trim().toLowerCase();
  const mode = url.searchParams.get("mode") || "grid";
  const rawMedia = (url.searchParams.get("media") || "all").toLowerCase();
  const media = rawMedia === "movie" || rawMedia === "tv" ? rawMedia : "all";
  const force = url.searchParams.get("force") === "1";
  const page = Math.max(
    1,
    Math.min(5, parseInt(url.searchParams.get("page") || "1", 10) || 1),
  );
  const outHeadersHtml = {
    "Content-Type": CT_HTML,
    "Cache-Control": CC_NO_STORE,
  };
  const outHeadersJson = {
    "Content-Type": CT_JSON,
    "Cache-Control": CC_NO_STORE,
  };
  if (mode === "previews") {
    if (!env.TMDB_API_KEY) return jsonResp({ items: {} }, outHeadersJson);
    const items = await loadPlatformPreviews(env, ctx, force);
    return jsonResp({ items }, outHeadersJson);
  }
  const plat = PLATFORMS[id];
  if (!plat) {
    if (mode === "json" || mode === "preview")
      return jsonResp({ error: "unknown", items: [] }, outHeadersJson);
    return new Response('<div class="empty"><p>未知平台</p></div>', {
      headers: outHeadersHtml,
    });
  }
  if (!env.TMDB_API_KEY) {
    if (mode === "json" || mode === "preview")
      return jsonResp({ error: "no tmdb", items: [] }, outHeadersJson);
    return new Response('<div class="empty"><p>未配置 TMDB</p></div>', {
      headers: outHeadersHtml,
    });
  }
  if (mode === "preview") {
    const all = await loadPlatformPreviews(env, ctx, force);
    let posters = Array.isArray(all[id]) ? all[id] : null;
    if (!posters) {
      try {
        const r = await fetchPlatformDiscover(plat, "all", 1, env);
        posters = (r.items || [])
          .filter((x) => x.poster)
          .slice(0, 5)
          .map((x) => x.poster.replace("/w185", "/w780"));
      } catch {
        posters = [];
      }
    }
    return jsonResp({ id, name: plat.name, posters }, outHeadersJson);
  }
  const data = await cachedJSON(
    env,
    ctx,
    CK.platform(id, page, media),
    () => fetchPlatformDiscover(plat, media, page, env),
    {
      ttl: PLATFORM_KV_TTL,
      missTtl: 600,
      swr: force ? false : Math.floor(PLATFORM_KV_TTL * 0.5),
      jitter: 300,
      bypass: !!force,
      revalidate: !!force,
      staleRetention: PUBLIC_STALE_RETENTION,
    },
  );
  const list =
    data && Array.isArray(data.items)
      ? data.items
      : Array.isArray(data)
        ? data
        : [];
  const totalPages = (data && data.totalPages) || 1;
  if (mode === "json") {
    return new Response(
      JSON.stringify({
        id,
        name: plat.name,
        page,
        totalPages,
        hasMore: page < totalPages,
        items: list,
      }),
      { headers: outHeadersJson },
    );
  }
  const html = renderPlatformItems(list);
  if (mode === "hscroll") return listResp(html, mode, outHeadersHtml);
  const hasMore = page < totalPages ? "1" : "0";
  const body = html || `<div class="empty"><p>${plat.name} 暂无内容</p></div>`;
  return new Response(
    `<div class="platform-result" data-page="${page}" data-total-pages="${totalPages}" data-has-more="${hasMore}" data-platform-id="${id}">${body}</div>`,
    { headers: outHeadersHtml },
  );
}

function traktSyncPayload(kind, id) {
  const entry = { ids: { trakt: id } };
  if (kind === "movie") return { movies: [entry] };
  if (kind === "show") return { shows: [entry] };
  if (kind === "season") return { seasons: [entry] };
  if (kind === "episode") return { episodes: [entry] };
  return null;
}

async function resolveTraktIdFromTmdb(tmdbId, type, headers, userKey) {
  if (!tmdbId) return null;
  const id = String(tmdbId).trim();
  if (!/^\d+$/.test(id)) return null;
  async function tryOnce(t) {
    const qs = t ? `?type=${t}` : "";
    const arr = await traktGet(
      `${TRAKT_API}/search/tmdb/${id}${qs}`,
      headers,
      1,
      userKey,
    );
    if (!Array.isArray(arr) || !arr.length) return null;
    const prefer = t === "movie" ? "movie" : t === "show" ? "show" : null;
    if (
      prefer &&
      arr[0][prefer] &&
      arr[0][prefer].ids &&
      arr[0][prefer].ids.trakt
    ) {
      return arr[0][prefer].ids.trakt;
    }
    for (const item of arr) {
      if (item.movie && item.movie.ids && item.movie.ids.trakt)
        return item.movie.ids.trakt;
      if (item.show && item.show.ids && item.show.ids.trakt)
        return item.show.ids.trakt;
    }
    return null;
  }
  let traktId = await tryOnce(type);
  if (traktId) return traktId;
  const other = type === "movie" ? "show" : "movie";
  traktId = await tryOnce(other);
  if (traktId) return traktId;
  return await tryOnce(null);
}

async function fetchOmdbRatings(imdbId, env, ctx) {
  if (!imdbId || !env.OMDB_API_KEY) return null;
  let id = String(imdbId).trim();
  if (/^\d+$/.test(id)) id = "tt" + id.padStart(7, "0");
  if (!/^tt\d+$/i.test(id)) return null;
  id = id.toLowerCase();
  return cachedJSON(
    env,
    ctx,
    CK.omdb(id),
    async () => {
      let d = null;
      try {
        const url = `${OMDB_API}/?i=${encodeURIComponent(id)}&apikey=${encodeURIComponent(env.OMDB_API_KEY)}`;
        const r = await fetchT(url, {}, 8000);
        if (r.ok) d = await r.json();
      } catch {}
      if (!d || d.Response !== "True") return null;
      const out = {};
      if (Array.isArray(d.Ratings)) {
        for (const r of d.Ratings) {
          const match = String(r.Value).match(/[\d.]+/);
          const v = match ? parseFloat(match[0]) : NaN;
          if (!Number.isFinite(v)) continue;
          if (r.Source === "Internet Movie Database") out.imdb = v;
          else if (r.Source === "Rotten Tomatoes") out.rt = Math.round(v);
          else if (r.Source === "Metacritic") out.metacritic = Math.round(v);
        }
      }
      if (out.imdb == null && d.imdbRating && d.imdbRating !== "N/A") {
        const v = parseFloat(d.imdbRating);
        if (Number.isFinite(v)) out.imdb = v;
      }
      if (out.metacritic == null && d.Metascore && d.Metascore !== "N/A") {
        const v = parseInt(d.Metascore, 10);
        if (Number.isFinite(v)) out.metacritic = v;
      }
      return Object.keys(out).length ? out : null;
    },
    { ttl: OMDB_KV_TTL, missTtl: 3600 },
  );
}

async function fetchTmdbVideos(type, id, env, ctx) {
  if (!env.TMDB_API_KEY) return null;
  return cachedJSON(
    env,
    ctx,

    `vid:${type}:${id}`,
    async () => {
      const mk = (lang) =>
        `${TMDB_API}/${type}/${id}/videos?language=${lang}&api_key=${env.TMDB_API_KEY}`;
      const zhRes = await tmdbGet(mk("zh-CN"));
      const zhList = zhRes && Array.isArray(zhRes.results) ? zhRes.results : [];
      const hasZhPlayable = zhList.some(
        (v) =>
          v &&
          v.site === "YouTube" &&
          v.key &&
          (v.type === "Trailer" || v.type === "Teaser"),
      );
      if (hasZhPlayable) return { results: zhList };
      const enRes = await tmdbGet(mk("en-US"));
      const enList = enRes && Array.isArray(enRes.results) ? enRes.results : [];
      const merged = [...zhList, ...enList];
      return merged.length ? { results: merged } : null;
    },
    {
      ttl: TMDB_KV_TTL,
      missTtl: MISS_KV_TTL,
      swr: 3600,
      jitter: 200,
    },
  );
}

function mcTier(n) {
  if (n >= 61) return "high";
  if (n >= 40) return "mid";
  return "low";
}
const RATING_LOGOS = {
  tmdb: `<svg class="ext-logo" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#01B4E4" d="M6.62 12a2.291 2.291 0 0 1 2.292-2.295h-.013A2.291 2.291 0 0 1 11.189 12a2.291 2.291 0 0 1-2.29 2.291h.013A2.291 2.291 0 0 1 6.62 12zm10.72-4.062h4.266a2.291 2.291 0 0 0 2.29-2.291 2.291 2.291 0 0 0-2.29-2.296H17.34a2.291 2.291 0 0 0-2.291 2.296 2.291 2.291 0 0 0 2.29 2.29zM2.688 20.645h8.285a2.291 2.291 0 0 0 2.291-2.292 2.291 2.291 0 0 0-2.29-2.295H2.687a2.291 2.291 0 0 0-2.291 2.295 2.291 2.291 0 0 0 2.29 2.292zm10.881-6.354h.81l1.894-4.586H15.19l-1.154 3.008h-.013l-1.135-3.008h-1.154zm4.208 0h1.011V9.705h-1.011zm2.878 0h3.235v-.93h-2.223v-.933h1.99v-.934h-1.99v-.855h2.107v-.934h-3.112zM1.31 7.941h1.01V4.247h1.31v-.895H0v.895h1.31zm3.747 0h1.011V5.959h1.958v1.984h1.011v-4.59h-1.01v1.711H6.061V3.351H5.057zm5.348 0h3.242v-.933H11.41v-.934h1.99v-.933h-1.99v-.856h2.107v-.934h-3.112zM.162 14.296h1.005v-3.52h.013l1.167 3.52h.765l1.206-3.52h.013v3.52h1.011v-4.59H3.82L2.755 12.7h-.013L1.686 9.705H.156zm14.534 6.353h1.641a3.188 3.188 0 0 0 .98-.149 2.531 2.531 0 0 0 .824-.437 2.123 2.123 0 0 0 .567-.713 2.193 2.193 0 0 0 .223-.983 2.399 2.399 0 0 0-.218-1.07 1.958 1.958 0 0 0-.586-.716 2.405 2.405 0 0 0-.873-.392 4.349 4.349 0 0 0-1.046-.13h-1.519zm1.013-3.656h.596a2.26 2.26 0 0 1 .606.08 1.514 1.514 0 0 1 .503.244 1.167 1.167 0 0 1 .34.412 1.28 1.28 0 0 1 .13.587 1.546 1.546 0 0 1-.13.658 1.127 1.127 0 0 1-.347.433 1.41 1.41 0 0 1-.518.238 2.797 2.797 0 0 1-.649.07h-.538zm4.686 3.656h1.88a2.997 2.997 0 0 0 .613-.064 1.735 1.735 0 0 0 .554-.214 1.221 1.221 0 0 0 .402-.39 1.105 1.105 0 0 0 .155-.606 1.188 1.188 0 0 0-.071-.415 1.01 1.01 0 0 0-.204-.34 1.087 1.087 0 0 0-.317-.24 1.297 1.297 0 0 0-.413-.13v-.012a1.203 1.203 0 0 0 .575-.366.962.962 0 0 0 .216-.648 1.081 1.081 0 0 0-.149-.603 1.022 1.022 0 0 0-.389-.354 1.673 1.673 0 0 0-.54-.169 4.463 4.463 0 0 0-.6-.041h-1.712zm1.011-3.734h.687a1.4 1.4 0 0 1 .24.022.748.748 0 0 1 .22.075.432.432 0 0 1 .16.147.418.418 0 0 1 .061.236.47.47 0 0 1-.055.233.433.433 0 0 1-.146.156.62.62 0 0 1-.204.084 1.058 1.058 0 0 1-.23.026h-.745zm0 1.835h.765a1.96 1.96 0 0 1 .266.02 1.015 1.015 0 0 1 .26.07.519.519 0 0 1 .204.152.406.406 0 0 1 .08.26.481.481 0 0 1-.06.253.519.519 0 0 1-.16.168.62.62 0 0 1-.217.09 1.155 1.155 0 0 1-.237.027H21.4z"/></svg>`,
  imdb: `<svg class="ext-logo" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#F5C518" d="M22.3781 0H1.6218C.7411.0583.0587.7437.0018 1.5953l-.001 20.783c.0585.8761.7125 1.543 1.5559 1.6191A.337.337 0 0 0 1.6016 24h20.7971a.4579.4579 0 0 0 .0437-.002c.8727-.0768 1.5568-.8271 1.5568-1.7085V1.7098c0-.8914-.696-1.6416-1.584-1.7078A.3294.3294 0 0 0 22.3781 0zm0 .496a1.2144 1.2144 0 0 1 1.1252 1.2139v20.5797c0 .6377-.4875 1.1602-1.1045 1.2145H1.6016c-.5967-.0543-1.0645-.5297-1.1053-1.1258V1.6284C.5371 1.0185 1.0184.5364 1.6217.496h20.7564zM4.7954 8.2603v7.3636H2.8899V8.2603h1.9055zm6.5367 0v7.3636H9.6707v-4.9704l-.6711 4.9704H7.813l-.6986-4.8618-.0066 4.8618h-1.668V8.2603h2.468c.0748.4476.1492.9694.2307 1.5734l.2712 1.8713.4407-3.4447h2.4817zm2.9772 1.3289c.0742.0404.122.108.1417.2034.0279.0953.0345.3118.0345.6442v2.8548c0 .4881-.0345.7867-.0955.8954-.0609.1152-.2304.1695-.5018.1695V9.5211c.204 0 .3457.0205.4211.0681zm-.0211 6.0347c.4543 0 .8006-.0265 1.0245-.0742.2304-.0477.4204-.1357.5694-.2648.1556-.1218.2642-.298.3251-.5219.0611-.2238.1021-.6648.1021-1.3224v-2.5832c0-.6986-.0271-1.1668-.0742-1.4039-.041-.237-.1431-.4543-.3126-.6437-.1695-.1973-.4198-.3324-.7456-.421-.3191-.0808-.8542-.1285-1.7694-.1285h-1.4244v7.3636h2.3051zm5.14-1.7827c0 .3523-.0199.5762-.0544.6708-.033.0947-.1894.1424-.3046.1424-.1086 0-.19-.0477-.2238-.1351-.041-.0887-.0609-.2986-.0609-.6238v-1.9469c0-.3324.0199-.5423.0543-.6237.0338-.0808.1086-.122.2171-.122.1153 0 .2709.0412.3114.1425.041.0947.0609.2986.0609.6032v1.8926zm-2.4747-5.5809v7.3636h1.7157l.1152-.4675c.1556.1894.3251.3324.5152.4271.1828.0881.4608.1357.678.1357.3047 0 .5629-.0748.7802-.237.2165-.1562.3589-.3462.4198-.5628.0543-.2173.0887-.543.0887-.9841v-2.0675c0-.4409-.0139-.7324-.0344-.8681-.0199-.1357-.0742-.2781-.1695-.4204-.1021-.1425-.2437-.251-.4272-.3325-.1834-.0742-.3999-.1152-.6576-.1152-.2172 0-.4952.0477-.6846.1285-.1835.0887-.353.2238-.5086.4007V8.2603h-1.8309z"/></svg>`,
  rt: `<svg class="ext-logo" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="#FA320A" d="M5.866 0L4.335 1.262l2.082 1.8c-2.629-.989-4.842 1.4-5.012 2.338 1.384-.323 2.24-.422 3.344-.335-7.042 4.634-4.978 13.148-1.434 16.094 5.784 4.612 13.77 3.202 17.91-1.316C27.26 13.363 22.993.65 10.86 2.766c.107-1.17.633-1.503 1.243-1.602-.89-1.493-3.67-.734-4.556 1.374C7.52 2.602 5.866 0 5.866 0zM4.422 7.217H6.9c2.673 0 2.898.012 3.55.202 1.06.307 1.868.973 2.313 1.904.05.106.092.206.13.305l7.623.008.027 2.912-2.745-.024v7.549l-2.982-.016v-7.522l-2.127.016a2.92 2.92 0 0 1-1.056 1.134c-.287.176-.3.19-.254.264.127.2 2.125 3.642 2.125 3.659l-3.39.019-2.013-3.376c-.034-.047-.122-.068-.344-.084l-.297-.02.037 3.48-3.075-.038zm3.016 2.288l.024.338c.014.186.024.729.024 1.206v.867l.582-.025c.32-.013.695-.049.833-.078.694-.146 1.048-.478 1.087-1.018.027-.378-.063-.636-.303-.87-.318-.309-.761-.416-1.733-.418Z"/></svg>`,
  mc: `<svg class="ext-logo" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="#FFFFFF" d="M11.99 0A12 12 0 1 0 24 12v-.014A12 12 0 0 0 11.99 0Zm-.055 2.564a9.399 9.399 0 0 1 9.407 9.389v.01a9.399 9.399 0 1 1-9.408-9.399Zm-1.61 17.198 2.046-2.046-3.94-3.94c-.165-.166-.345-.373-.442-.608-.221-.47-.318-1.203.221-1.742.664-.664 1.548-.387 2.406.47l3.788 3.788 2.046-2.046-3.954-3.954a2.48 2.48 0 0 1-.456-.622c-.263-.539-.25-1.216.235-1.7.677-.678 1.562-.429 2.544.553l3.677 3.677 2.046-2.046-3.982-3.982c-2.018-2.018-3.912-1.949-5.212-.65-.498.499-.802 1.024-.954 1.618a4.026 4.026 0 0 0-.055 1.686l-.027.028c-.996-.414-2.13-.166-3 .705-1.162 1.161-1.12 2.392-.982 3.11l-.042.043-1.009-.816-1.77 1.77a64.1 64.1 0 0 1 2.213 2.1z"/></svg>`,
  trakt: `<svg class="ext-logo" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="#ED1C24" d="m15.082 15.107-.73-.73 9.578-9.583a4.499 4.499 0 0 0-.115-.575L13.662 14.382l1.08 1.08-.73.73-1.81-1.81L23.422 3.144c-.075-.15-.155-.3-.25-.44L11.508 14.377l2.154 2.155-.73.73-7.193-7.199.73-.73 4.309 4.31L22.546 1.86A5.618 5.618 0 0 0 18.362 0H5.635A5.637 5.637 0 0 0 0 5.634V18.37A5.632 5.632 0 0 0 5.635 24h12.732C21.477 24 24 21.48 24 18.37V6.19l-8.913 8.918zm-4.314-2.155L6.814 8.988l.73-.73 3.954 3.96zm1.075-1.084-3.954-3.96.73-.73 3.959 3.96zm9.853 5.688a4.141 4.141 0 0 1-4.14 4.14H6.438a4.144 4.144 0 0 1-4.139-4.14V6.438A4.141 4.141 0 0 1 6.44 2.3h10.387v1.04H6.438c-1.71 0-3.099 1.39-3.099 3.1V17.55c0 1.71 1.39 3.105 3.1 3.105h11.117c1.71 0 3.1-1.395 3.1-3.105v-1.754h1.04v1.754z"/></svg>`,
  douban: `<svg class="ext-logo" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="#2D963D" d="M.51 3.06h22.98V.755H.51V3.06Zm20.976 2.537v9.608h-2.137l-1.669 5.76H24v2.28H0v-2.28h6.32l-1.67-5.76H2.515V5.597h18.972Zm-5.066 9.608H7.58l1.67 5.76h5.501l1.67-5.76ZM18.367 7.9H5.634v5.025h12.733V7.9Z"/></svg>`,
};

function renderExtRatings(r, opts = {}) {
  const out = [];
  if (r && r.imdb != null)
    out.push(
      `<span class="ext-rating ext-imdb" title="IMDb ${r.imdb.toFixed(1)}/10">${RATING_LOGOS.imdb}<span class="ext-score">${r.imdb.toFixed(1)}</span></span>`,
    );
  if (r && r.metacritic != null)
    out.push(
      `<span class="ext-rating ext-mc" title="Metacritic ${r.metacritic}/100">${RATING_LOGOS.mc}<span class="ext-score mc-score-${mcTier(r.metacritic)}">${r.metacritic}</span></span>`,
    );
  if (r && r.rt != null)
    out.push(
      `<span class="ext-rating ext-rt" title="Rotten Tomatoes ${r.rt}%">${RATING_LOGOS.rt}<span class="ext-score">${r.rt}%</span></span>`,
    );
  if (opts.tmdb != null) {
    const pct = Math.round(Number(opts.tmdb) * 10);
    out.push(
      `<span class="ext-rating ext-tmdb" title="TMDB User Score ${pct}%">${RATING_LOGOS.tmdb}<span class="ext-score">${pct}%</span></span>`,
    );
  }
  if (opts.trakt != null) {
    const t = Number(opts.trakt);
    const score = t <= 10 ? Math.round(t * 10) : Math.round(t);
    out.push(
      `<span class="ext-rating ext-trakt" title="Trakt ${score}%">${RATING_LOGOS.trakt}<span class="ext-score">${score}%</span></span>`,
    );
  }
  if (opts.doubanUrl)
    out.push(
      `<a class="ext-rating ext-douban" href="${esc(opts.doubanUrl)}" target="_blank" rel="noopener" title="在豆瓣搜索该片">${RATING_LOGOS.douban}<span class="ext-score">↗</span></a>`,
    );
  return out.join("");
}

async function fetchWatchlistRaw(headers, sort, userKey, debug) {
  const qs = `extended=full&images=poster`;

  const [movies, shows] = await Promise.all([
    traktGet(`${TRAKT_API}/sync/watchlist/movies?${qs}`, headers, 1, userKey),
    traktGet(`${TRAKT_API}/sync/watchlist/shows?${qs}`, headers, 1, userKey),
  ]);
  let seasons = [];
  let episodes = [];
  if (!(movies && movies.__error) && !(shows && shows.__error) && !isTraktRateLimited(userKey)) {
    const se = await Promise.all([
      traktGet(`${TRAKT_API}/sync/watchlist/seasons?${qs}`, headers, 1, userKey),
      traktGet(`${TRAKT_API}/sync/watchlist/episodes?${qs}`, headers, 1, userKey),
    ]);
    seasons = se[0];
    episodes = se[1];
  }
  if (debug) {
    debug.movies = Array.isArray(movies)
      ? movies.length
      : movies && movies.__error
        ? movies.__error
        : "null";
    debug.shows = Array.isArray(shows)
      ? shows.length
      : shows && shows.__error
        ? shows.__error
        : "null";
    debug.seasons = Array.isArray(seasons)
      ? seasons.length
      : seasons && seasons.__error
        ? seasons.__error
        : "null";
    debug.episodes = Array.isArray(episodes)
      ? episodes.length
      : episodes && episodes.__error
        ? episodes.__error
        : "null";
  }
  if (movies && movies.__error) return { __error: movies.__error };
  if (shows && shows.__error) return { __error: shows.__error };
  const merged = [];
  if (Array.isArray(movies)) for (const x of movies) merged.push(x);
  if (Array.isArray(shows)) for (const x of shows) merged.push(x);
  if (Array.isArray(seasons)) for (const x of seasons) merged.push(x);
  if (Array.isArray(episodes)) for (const x of episodes) merged.push(x);
  switch (sort) {
    case "title":
      merged.sort((a, b) =>
        String((a.movie && a.movie.title) || (a.show && a.show.title) || "")
          .toLowerCase()
          .localeCompare(
            String(
              (b.movie && b.movie.title) || (b.show && b.show.title) || "",
            ).toLowerCase(),
          ),
      );
      break;
    case "released":
      merged.sort(
        (a, b) =>
          ((b.movie && b.movie.year) || (b.show && b.show.year) || 0) -
          ((a.movie && a.movie.year) || (a.show && a.show.year) || 0),
      );
      break;
    default:
      merged.sort((a, b) =>
        (b.listed_at || "").localeCompare(a.listed_at || ""),
      );
  }
  return merged;
}

async function getWatchlist(
  headers,
  sort = "added",
  env,
  ctx,
  userKey,
  force,
  sourceTracker,
) {
  if (!env) return fetchWatchlistRaw(headers, sort, userKey);
  const prefix = userKey || "anon";
  const debug = {};
  const ver = await getWatchlistVersion(env, ctx, prefix);
  const data = await cachedJSON(
    env,
    ctx,
    CK.watchlist(prefix, ver, sort),
    () => fetchWatchlistRaw(headers, sort, userKey, debug),
    {
      ttl: WATCHLIST_KV_TTL,
      missTtl: 180,
      swr: force ? true : false,
      jitter: 300,
      bypass: !!force,
      revalidate: !!force,
      lastGoodKey: CK.lastGood.watchlist(prefix, sort),
      staleRetention: 86400,
      ...(sourceTracker ? { sourceTracker } : {}),
    },
  );
  if (sourceTracker) sourceTracker.debug = debug;
  if (Array.isArray(data)) return data;
  if (env.TMDB_CACHE && !kvIsDown()) {
    try {
      const lgKey = CK.lastGood.watchlist(prefix, sort);
      const raw = await env.TMDB_CACHE.get(lgKey, kvReadOpts());
      kvMarkUp();
      if (raw != null) {
        const v =
          typeof raw === "object" && raw.data !== undefined ? raw.data : raw;
        if (Array.isArray(v) && v.length) {
          if (sourceTracker) {
            sourceTracker.fromCache = true;
            sourceTracker.age = raw._ts
              ? Math.max(0, Math.round((Date.now() - raw._ts) / 1000))
              : 0;
          }
          return v;
        }
      }
    } catch {
      kvMarkDown();
    }
  }
  return null;
}

async function getWatchlistTmdbIds(headers, env, ctx, userKey, type) {
  const merged = await getWatchlist(headers, "added", env, ctx, userKey);
  if (!Array.isArray(merged)) return [];
  const ids = [];
  for (const x of merged) {
    const item = type === "movies" ? x.movie : x.show;
    if (item && item.ids && item.ids.tmdb != null) {
      const n = Number(item.ids.tmdb);
      if (Number.isFinite(n)) ids.push(n);
    }
  }
  return ids;
}

async function handleSearch(request, env, ctx) {
  const url = new URL(request.url),
    q = (url.searchParams.get("q") || "").trim(),
    typeFilter = url.searchParams.get("type") || "all";
  const A = await authed(request, env, ctx);
  if (!A.ok) return A.response;
  const { auth, needsCookieUpdate } = A;
  const outHeaders = {
    "Content-Type": CT_JSON,
    "Cache-Control": CC_NO_STORE,
  };
  if (needsCookieUpdate)
    outHeaders["Set-Cookie"] = buildCookie(auth, auth.trakt_id);
  if (!q) return jsonResp({ items: [] }, outHeaders);
  if (!env.TMDB_API_KEY)
    return jsonResp({ items: [], error: "no tmdb key" }, outHeaders);
  const wantMovie = typeFilter === "all" || typeFilter === "movie";
  const wantShow = typeFilter === "all" || typeFilter === "show";
  const [movieRes, tvRes] = await Promise.all([
    wantMovie
      ? tmdbGet(
          tmdbUrl("/search/movie", env, { query: q, include_adult: "false" }),
        )
      : Promise.resolve(null),
    wantShow
      ? tmdbGet(
          tmdbUrl("/search/tv", env, { query: q, include_adult: "false" }),
        )
      : Promise.resolve(null),
  ]);
  const merged = [];
  if (movieRes && Array.isArray(movieRes.results)) {
    for (const r of movieRes.results) {
      const item = mapTmdbItem(r, "movie");
      if (item) merged.push(item);
    }
  }
  if (tvRes && Array.isArray(tvRes.results)) {
    for (const r of tvRes.results) {
      const item = mapTmdbItem(r, "tv");
      if (item) merged.push(item);
    }
  }
  merged.sort((a, b) => b.popularity - a.popularity);
  return jsonResp({ items: merged.slice(0, 30) }, outHeaders);
}

async function handleReco(request, env, ctx) {
  const A = await authed(request, env, ctx, { strict: true });
  if (!A.ok) return A.response;
  const { auth, headers, needsCookieUpdate, userKey } = A;
  const url = new URL(request.url);
  const limit = Math.max(
    1,
    Math.min(20, parseInt(url.searchParams.get("limit") || "10", 10) || 10),
  );
  const force = url.searchParams.get("force") === "1";
  const cacheKey = CK.reco(userKey);
  const data = await cachedJSON(
    env,
    ctx,
    cacheKey,
    () => __buildReco(headers, userKey, limit, env, ctx),
    {
      ttl: 86400,
      missTtl: 600,
      swr: 86400,
      unwrap: true,
      jitter: 600,
      lastGoodKey: "lg:" + cacheKey,
      ...(force ? { bypass: true, revalidate: true } : {}),
    },
  );
  if (!data || data.__error || !Array.isArray(data.items) || !data.items.length) {
    return authJson(auth, needsCookieUpdate, {
      items: [],
      error: (data && data.__error) || null,
    });
  }
  return authJson(auth, needsCookieUpdate, {
    items: data.items,
    updatedAt: data.updatedAt || null,
  });
}
async function __buildReco(headers, userKey, limit, env, ctx) {
  const kinds = [
    ["movie", "movies"],
    ["show", "shows"],
  ];
  const raw = [];
  for (const [kind, path] of kinds) {

    if (isTraktRateLimited(userKey)) continue;
    const r = await traktFetch(
      `${TRAKT_API}/recommendations/${path}?limit=${limit}&ignore_collected=true`,
      headers,
      { retries: 1, timeout: 10000, userKey },
    );
    if (!r || r.__error || !Array.isArray(r)) continue;
    for (const it of r) {
      const ids = (it && it.ids) || {};
      const tmdbId = Number(ids.tmdb) || null;
      if (!tmdbId) continue;
      raw.push({
        type: kind,
        tmdbId,
        traktId: Number(ids.trakt) || null,
        title: it.title || "",
        year: Number(it.year) || null,
        poster: null,
        overview: "",
      });
    }
  }
  if (!raw.length) return { __error: "empty" };
  if (env && env.TMDB_API_KEY) {
    const capped = raw.slice(0, 20);
    const keys = capped.map(
      (it) => (it.type === "movie" ? "movie" : "tv") + ":tmdb:" + it.tmdbId,
    );
    try {
      const enriched = await enrichBatch(keys, env, ctx);
      for (let i = 0; i < capped.length; i++) {
        const v = enriched && enriched[keys[i]];
        if (!v) continue;
        if (v.title) capped[i].title = v.title;
        if (v.poster) capped[i].poster = v.poster;
        if (v.overview) capped[i].overview = v.overview;
      }
    } catch {}
    return { items: capped, updatedAt: Date.now() };
  }
  return { items: raw.slice(0, 20), updatedAt: Date.now() };
}
async function handleTrending(request, env, ctx) {
  const A = await authed(request, env, ctx);
  if (!A.ok) return A.response;
  if (!env.TMDB_API_KEY) return Response.json({ items: [] });
  const url = new URL(request.url);
  const page = Math.max(
    1,
    Math.min(5, parseInt(url.searchParams.get("page") || "1", 10) || 1),
  );
  const data = await cachedJSON(
    env,
    ctx,
    CK.trend(page),
    () => tmdbGet(tmdbUrl("/trending/all/day", env, { page })),
    {
      ttl: TREND_KV_TTL,
      missTtl: 600,
      swr: 3600,
      jitter: 600,
    },
  );
  const items = [];
  const results = data && Array.isArray(data.results) ? data.results : [];
  for (const r of results) {
    const item = mapTmdbItem(r);
    if (item) items.push(item);
  }
  return new Response(JSON.stringify({ items }), {
    headers: {
      "Content-Type": CT_JSON,
      "Cache-Control": CC_NO_STORE,
    },
  });
}

async function handleWatchlistAdd(request, env, ctx) {
  const A = await authed(request, env, ctx);
  if (!A.ok) return A.response;
  const { auth, headers, needsCookieUpdate, userKey } = A;
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.error;
  const body = parsed.body || {},
    type = body.type,
    tmdbId = body.tmdbId,
    rawId = body.id;
  if ((type !== "movie" && type !== "show") || (!tmdbId && !rawId)) {
    return authJson(auth, needsCookieUpdate, { error: "bad params" }, 400);
  }
  let traktId = null;
  if (rawId && !tmdbId) {
    const n = Number(rawId);
    if (!Number.isFinite(n) || n <= 0)
      return authJson(auth, needsCookieUpdate, { error: "bad id" }, 400);
    traktId = n;
  } else {
    traktId = await resolveTraktIdFromTmdb(tmdbId, type, headers, userKey);
    if (!traktId) {
      return authJson(
        auth,
        needsCookieUpdate,
        {
          error: "Trakt 上暂时没有对应条目，可能是新片或中文内容尚未同步",
          code: "not_found_on_trakt",
        },
        404,
      );
    }
  }
  const payload = traktSyncPayload(type, traktId);
  let r;
  try {
    r = await fetchT(
      `${TRAKT_API}/sync/watchlist`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      },
      10000,
    );
  } catch {
    return authJson(
      auth,
      needsCookieUpdate,
      { error: "请求 Trakt 失败，请稍后重试" },
      502,
    );
  }
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    return authJson(
      auth,
      needsCookieUpdate,
      { error: "HTTP " + r.status, detail: errText },
      r.status,
    );
  }
  await invalidateWatchlistCache(env, ctx, userKey);
  const result = await r.json().catch(() => null);
  return authJson(auth, needsCookieUpdate, {
    ok: true,
    traktId,
    message: "已加入待看列表",
    result,
  });
}

async function handleWatchlistRemove(request, env, ctx) {
  return traktSyncAction(request, env, ctx, {
    allowedTypes: ["movie", "show", "season", "episode"],
    endpoint: "/sync/watchlist/remove",
    buildPayload: (type, id) => traktSyncPayload(type, id),
    okMessage: "已移出待看列表",
    afterOk: async (auth, headers, env, ctx) => {
      const userKey = await getStableUserId(auth, headers, env, ctx);
      await invalidateWatchlistCache(env, ctx, userKey);
    },
  });
}

async function handleMarkWatched(request, env, ctx) {
  return traktSyncAction(request, env, ctx, {
    allowedTypes: ["movie", "episode"],
    endpoint: "/sync/history",
    buildPayload: (type, id) => traktSyncPayload(type, id),
    okMessage: (type) =>
      type === "episode"
        ? "已标记本集已看"
        : type === "movie"
          ? "已标记电影已看"
          : "已标记为已看",
    afterOk: async (auth, headers, env, ctx, body) => {
      const userKey = await getStableUserId(auth, headers, env, ctx);

      try {
        const type = body && body.type;
        const id = body && (body.id != null ? body.id : body.traktId);
        if (
          (type === "movie" || type === "episode") &&
          id != null &&
          Number(id) > 0
        ) {
          await fetchT(
            `${TRAKT_API}/sync/playback/${type}/${Number(id)}`,
            { method: "DELETE", headers },
            6000,
          ).catch(() => null);
        }
      } catch {}

      await bustHomeUserCaches(userKey, env, ctx);
      try {
        const type = body && body.type;
        const id = body && (body.id != null ? body.id : body.traktId);
        const showId =
          body && (body.showId != null ? body.showId : body.show_id);
        if (showId && Number(showId) > 0) {
          const sid = Number(showId);
          await markProgressDirtyShow(env, ctx, userKey, sid);

          try {
            await safeDeleteKvKeys(env, ctx, [
              CK.watchProgress(userKey, sid),
              CK.lastGood.watchProgress
                ? CK.lastGood.watchProgress(userKey, sid)
                : null,
            ].filter(Boolean));
          } catch {}
        }
        if (type === "episode" && Number(id) > 0) {
          const sid =
            showId && Number(showId) > 0 ? Number(showId) : null;
          const seasonN = Number(body && (body.season ?? body.seasonNumber));
          const epN = Number(body && (body.number ?? body.episodeNumber));
          const byShowAdd =
            sid && Number.isFinite(seasonN) && Number.isFinite(epN)
              ? { [String(sid)]: { [String(seasonN)]: [epN] } }
              : undefined;
          await patchWatchedEpisodes(env, ctx, userKey, {
            add: [Number(id)],
            byShowAdd,
          });
          await rememberPendingWatched(env, ctx, userKey, {
            add: [Number(id)],
            byShowAdd,
          });
        }
        if (type === "movie" && Number(id) > 0) {
          await rememberPendingWatched(env, ctx, userKey, {
            movieAdd: [Number(id)],
          });
          try {
            await safeDeleteKvKeys(env, ctx, [
              CK.movieHistory(userKey, Number(id)),
            ]);
          } catch {}
        }
      } catch {}
    },
  });
}

async function handleUnmarkWatched(request, env, ctx) {
  return traktSyncAction(request, env, ctx, {
    allowedTypes: ["movie", "episode"],
    endpoint: "/sync/history/remove",
    buildPayload: (type, id) => traktSyncPayload(type, id),
    okMessage: "已取消观看记录",
    afterOk: async (auth, headers, env, ctx, body) => {
      const userKey = await getStableUserId(auth, headers, env, ctx);
      await bustHomeUserCaches(userKey, env, ctx);
      try {
        const type = body && body.type;
        const id = body && (body.id != null ? body.id : body.traktId);
        const showId =
          body && (body.showId != null ? body.showId : body.show_id);
        if (type === "episode" && Number(id) > 0) {
          await patchWatchedEpisodes(env, ctx, userKey, {
            remove: [Number(id)],
          });
          await rememberPendingWatched(env, ctx, userKey, {
            remove: [Number(id)],
          });
          if (showId && Number(showId) > 0) {
            await markProgressDirtyShow(env, ctx, userKey, Number(showId));
            try {
              await safeDeleteKvKeys(env, ctx, [
                CK.watchProgress(userKey, Number(showId)),
              ]);
            } catch {}
          }
        }
        if (type === "movie" && Number(id) > 0) {
          await rememberPendingWatched(env, ctx, userKey, {
            movieRemove: [Number(id)],
          });
          try {
            await safeDeleteKvKeys(env, ctx, [
              CK.movieHistory(userKey, Number(id)),
            ]);
          } catch {}
        }
      } catch {}
    },
  });
}

async function handleMarkSeasonWatched(request, env, ctx) {
  const A = await authed(request, env, ctx);
  if (!A.ok) return A.response;
  const { auth, headers, needsCookieUpdate, userKey } = A;
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.error;
  const body = parsed.body || {};
  const showId = Number(body.showId),
    season = Number(body.season);
  if (!Number.isFinite(showId) || showId <= 0 || !Number.isFinite(season)) {
    return authJson(auth, needsCookieUpdate, { error: "参数无效" }, 400);
  }
  let seasonData = await cachedJSON(
    env,
    ctx,
    CK.season(showId, season),
    async () => {
      const r = await traktGet(
        `${TRAKT_API}/shows/${showId}/seasons/${season}?extended=full,episodes`,
        headers,
        2,
        userKey,
      );
      return r && !r.__error ? r : null;
    },
    { ttl: seasonTtl, missTtl: 60, swr: 3600, jitter: 300 },
  );
  if (!seasonData || !Array.isArray(seasonData.episodes)) {
    try {
      const r = await traktFetch(
        `${TRAKT_API}/shows/${showId}/seasons/${season}?extended=full,episodes`,
        headers,
        { retries: 1, timeout: 12000, userKey },
      );
      if (r && !r.__error && Array.isArray(r.episodes)) {
        seasonData = r;

        kvPutJSON(
          env,
          ctx,
          CK.season(showId, season),
          { data: r },
          seasonTtl(r),
          false,
          false,
        );
      }
    } catch {}
  }
  if (!seasonData || !Array.isArray(seasonData.episodes)) {
    try {
      const all = await traktFetch(
        `${TRAKT_API}/shows/${showId}/seasons?extended=full,episodes`,
        headers,
        { retries: 1, timeout: 15000, userKey },
      );
      if (Array.isArray(all)) {
        const found = all.find((s) => s && s.number === season);
        if (found && Array.isArray(found.episodes)) {
          seasonData = found;
          kvPutJSON(
            env,
            ctx,
            CK.season(showId, season),
            { data: found },
            seasonTtl(found),
            false,
            false,
          );
        }
      }
    } catch {}
  }
  if (!seasonData || !Array.isArray(seasonData.episodes)) {
    if (isTraktRateLimited(userKey)) {
      return authJson(
        auth,
        needsCookieUpdate,
        {
          error: "Trakt 限流中，请稍后重试",
          cooling: traktRateLimitedRemaining(userKey),
        },
        429,
      );
    }
    return authJson(
      auth,
      needsCookieUpdate,
      { error: "无法获取第 " + season + " 季的信息，请稍后重试" },
      502,
    );
  }
  const now = Date.now();
  const episodes = seasonData.episodes
    .filter((ep) => ep && ep.number != null && ep.first_aired)
    .filter((ep) => new Date(ep.first_aired).getTime() <= now)
    .map((ep) => ({ ids: { trakt: ep.ids && ep.ids.trakt } }))
    .filter((ep) => ep.ids.trakt);
  if (!episodes.length) {
    return authJson(auth, needsCookieUpdate, {
      ok: true,
      marked: 0,
      message: "本季暂无可标记的已播出集数",
    });
  }
  let r;
  try {
    r = await fetchT(
      `${TRAKT_API}/sync/history`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ episodes }),
      },
      15000,
    );
  } catch {
    return authJson(
      auth,
      needsCookieUpdate,
      { error: "网络错误，请稍后重试" },
      502,
    );
  }
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    if (r.status === 429) {
      consumeRetryAfter(r, userKey);
      return authJson(
        auth,
        needsCookieUpdate,
        {
          error: "Trakt 限流中，请稍后重试",
          cooling: traktRateLimitedRemaining(userKey),
        },
        429,
      );
    }
    return authJson(
      auth,
      needsCookieUpdate,
      { error: "Trakt 返回 HTTP " + r.status, detail: text },
      r.status,
    );
  }
  const result = await r.json().catch(() => null);
  await bustHomeUserCaches(userKey, env, ctx);

  try {
    const ids = [];
    const byShowAdd = {};
    for (const ep of seasonData.episodes) {
      const tid = ep && ep.ids && ep.ids.trakt;
      if (tid == null) continue;
      ids.push(Number(tid));
      const sn = String(Number(ep.season != null ? ep.season : season));
      const en = Number(ep.number);
      if (!Number.isFinite(en)) continue;
      if (!byShowAdd[String(showId)]) byShowAdd[String(showId)] = {};
      if (!byShowAdd[String(showId)][sn]) byShowAdd[String(showId)][sn] = [];
      byShowAdd[String(showId)][sn].push(en);
    }
    if (ids.length) {
      await patchWatchedEpisodes(env, ctx, userKey, { add: ids, byShowAdd });
    }
  } catch {}
  const seasonKey = CK.season(showId, season);
  if (env && env.TMDB_CACHE) {
    const p = env.TMDB_CACHE.delete(seasonKey).catch(() => {});
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
    await p;
  }
  return authJson(auth, needsCookieUpdate, {
    ok: true,
    marked: episodes.length,
    message: `已标记本季 ${episodes.length} 集为已看`,
    result,
  });
}

async function handleHideContinue(request, env, ctx) {
  const A = await authed(request, env, ctx);
  if (!A.ok) return A.response;
  const { auth, headers, needsCookieUpdate, userKey } = A;
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.error;
  const body = parsed.body || {};
  const showId = Number(body.id || body.showId);
  if (!Number.isFinite(showId) || showId <= 0)
    return authJson(auth, needsCookieUpdate, { error: "bad id" }, 400);
  let s = body.season != null ? Number(body.season) : null;
  let e = body.episode != null ? Number(body.episode) : null;
  if (!Number.isFinite(s)) s = 0;
  if (!Number.isFinite(e)) e = 0;
  const mediaType = (body.type || body.mediaType || "episode") + "";
  const mediaId = Number(
    body.mediaId != null
      ? body.mediaId
      : body.episodeId != null
        ? body.episodeId
        : body.movieId != null
          ? body.movieId
          : 0,
  );
  let playbackRemoved = false;
  if (mediaId > 0 && (mediaType === "episode" || mediaType === "movie")) {
    try {
      const r = await fetchT(
        `${TRAKT_API}/sync/playback/${mediaType}s/${mediaId}`,
        { method: "DELETE", headers },
        8000,
      );
      if (r && (r.ok || r.status === 404)) playbackRemoved = true;
    } catch {}
  }
  let map = {};
  try {
    map = await getCwHideMap(env, ctx, userKey);
  } catch {
    map = {};
  }
  if (!map || typeof map !== "object") map = {};
  const hideAt = Date.now();
  map[String(showId)] = { s, e, at: hideAt };
  kvRemember(CK.cwHide(userKey), { data: map, _ts: hideAt });

  await putCwHideMap(env, ctx, userKey, map);
  if (userKey) {

    bustUserStateBundle(userKey, env, ctx);

    await safeDeleteKvKeys(env, ctx, [CK.playback(userKey)]);
  }
  return authJson(auth, needsCookieUpdate, {
    ok: true,
    showId,
    s,
    e,
    playbackRemoved,
    message: playbackRemoved
      ? "已移除进度，该剧已从继续观看消失"
      : "已从继续观看移除",
  });
}

async function handleDropShow(request, env, ctx) {
  const A = await authed(request, env, ctx);
  if (!A.ok) return A.response;
  const { auth, headers, needsCookieUpdate, userKey } = A;
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.error;
  const body = parsed.body || {};
  const showId = Number(body.id || body.showId);
  if (!Number.isFinite(showId) || showId <= 0)
    return authJson(auth, needsCookieUpdate, { error: "bad id" }, 400);
  const payload = { shows: [{ ids: { trakt: showId } }] };
  let result = null;
  try {
    const r = await fetchT(
      `${TRAKT_API}/users/hidden/dropped`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      },
      10000,
    );
    const detail = await r.text().catch(() => "");
    if (!r.ok) {
      return authJson(
        auth,
        needsCookieUpdate,
        { error: "HTTP " + r.status, detail },
        r.status >= 400 && r.status < 600 ? r.status : 502,
      );
    }
    try {
      result = JSON.parse(detail);
    } catch {
      result = {};
    }
  } catch {
    return authJson(
      auth,
      needsCookieUpdate,
      { error: "请求 Trakt 失败，请稍后重试" },
      502,
    );
  }
  try {
    await fetchT(
      `${TRAKT_API}/users/hidden/calendar`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      },
      8000,
    );
  } catch {}
  if (userKey) {
    const dropKey = `dropped:${userKey || "anon"}`;
    let nextIds = [showId];
    try {

      const prevRaw =
        env && env.TMDB_CACHE && !kvIsDown()
          ? await env.TMDB_CACHE.get(dropKey, { type: "json" })
          : null;
      const prevData =
        prevRaw && prevRaw.data !== undefined ? prevRaw.data : prevRaw;
      if (prevData && Array.isArray(prevData.ids)) {
        nextIds = [...new Set(prevData.ids.map(Number).concat(showId))];
      }
    } catch {}
    __droppedShowIdsMem.set(dropKey, { ids: nextIds, ts: Date.now() });

    await kvPutJSON(
      env,
      ctx,
      dropKey,
      { data: { ids: nextIds }, _ts: Date.now() },
      1800,
      false,
      true,
    );
    if (env && env.TMDB_CACHE) {

      await safeDeleteKvKeys(env, ctx, [CK.playback(userKey)]);
      bustUserStateBundle(userKey, env, ctx);
    }
  }
  await bustHomeUserCaches(userKey, env, ctx);
  const added =
    result && result.added && result.added.shows ? result.added.shows : 0;
  return authJson(auth, needsCookieUpdate, {
    ok: true,
    added,
    showId,
    message:
      added === 0
        ? "这部剧已经在弃看列表里了"
        : "已弃看，已从日历和继续观看移除",
    result,
  });
}

async function handleShowCalendar(request, env, ctx) {
  const url = new URL(request.url),
    showId = url.searchParams.get("id"),
    tmdbId = url.searchParams.get("tmdb");
  if (!showId || !/^\d+$/.test(showId))
    return Response.json({ error: "bad params" }, { status: 400 });
  const A = await authed(request, env, ctx, { strict: true });
  if (!A.ok) return A.response;
  const { auth, headers, needsCookieUpdate, userKey } = A;
  const seasons = await traktGet(
    `${TRAKT_API}/shows/${showId}/seasons?extended=full,episodes`,
    headers,
    2,
    userKey,
  );
  if (!Array.isArray(seasons))
    return Response.json({ error: "failed" }, { status: 502 });
  const zhTitles = {};
  let zhShowTitle = "";
  if (tmdbId && /^\d+$/.test(tmdbId) && env.TMDB_API_KEY) {
    try {
      const tmdbShow = await tmdbDetailCached(`/tv/${tmdbId}`, env, ctx);
      if (tmdbShow) {
        if (tmdbShow.name) zhShowTitle = tmdbShow.name;
        if (Array.isArray(tmdbShow.seasons)) {
          const realSeasons = tmdbShow.seasons.filter(
            (s) => s.season_number > 0,
          );

          const seasonDatas = [];
          for (let i = 0; i < realSeasons.length; i += 4) {
            const batch = realSeasons.slice(i, i + 4);
            const part = await Promise.all(
              batch.map((s) =>
                tmdbDetailCached(
                  `/tv/${tmdbId}/season/${s.season_number}`,
                  env,
                  ctx,
                ).catch(() => null),
              ),
            );
            seasonDatas.push(...part);
          }
          for (const sd of seasonDatas) {
            if (!sd || !Array.isArray(sd.episodes)) continue;
            for (const ep of sd.episodes) {
              const key = ep.season_number + "-" + ep.episode_number;
              if (ep.name) zhTitles[key] = ep.name;
            }
          }
        }
      }
    } catch {}
  }
  const episodes = [];
  for (const s of seasons) {
    if (!s || s.number <= 0) continue;
    if (!Array.isArray(s.episodes)) continue;
    for (const ep of s.episodes) {
      if (!ep.first_aired) continue;
      const key = ep.season + "-" + ep.number,
        zh = zhTitles[key];
      episodes.push({
        season: ep.season,
        number: ep.number,
        title: zh || ep.title || "",
        first_aired: ep.first_aired,
      });
    }
  }
  return authResp(
    auth,
    needsCookieUpdate,
    JSON.stringify({ episodes, title: zhShowTitle }),
    {
      extra: { "Cache-Control": CC_NO_STORE },
      contentType: "application/json; charset=utf-8",
    },
  );
}

function __pickLifetimeStats(s) {
  if (!s || typeof s !== "object" || s.__error) return null;
  if (!(s.movies || s.shows || s.episodes)) return null;
  return {
    movies: Number(s.movies && s.movies.watched) || 0,
    shows: Number(s.shows && s.shows.watched) || 0,
    episodes: Number(s.episodes && s.episodes.watched) || 0,
    hours:
      s.episodes && s.episodes.minutes
        ? Math.round(Number(s.episodes.minutes) / 60) || 0
        : 0,
  };
}
async function __loadLifetimeStats(env, ctx, userKey, headers) {
  const statsKey = CK.stats(userKey);
  try {
    const hit = memCacheGet(__summaryMem, statsKey);
    const p = __pickLifetimeStats(hit);
    if (p) return p;
  } catch {}
  try {
    if (env && env.TMDB_CACHE && !kvIsDown()) {
      const raw = await env.TMDB_CACHE.get(statsKey, { type: "json" });
      if (raw && !raw.miss) {
        const v = raw.data !== undefined ? raw.data : raw;
        const p = __pickLifetimeStats(v);
        if (p) return p;
      }
      const lg = await env.TMDB_CACHE.get("lg:stats:" + userKey, { type: "json" });
      if (lg && !lg.miss) {
        const v = lg.data !== undefined ? lg.data : lg;
        const p = __pickLifetimeStats(v);
        if (p) return p;
      }
    }
  } catch {}

  if (isTraktRateLimited(userKey)) return { __error: "429 cooling" };
  try {
    const s = await traktFetch(`${TRAKT_API}/users/me/stats`, headers, {
      retries: 1,
      timeout: 8000,
      userKey,
    });
    if (s && !s.__error) {
      const p = __pickLifetimeStats(s);
      if (p) {
        try {
          kvPutJSON(env, ctx, statsKey, { data: s, _ts: Date.now() }, STATS_KV_TTL, false);
          kvPutJSON(env, ctx, "lg:stats:" + userKey, { data: s, _ts: Date.now() }, LAST_GOOD_KV_TTL, false);
          memCacheSet(__summaryMem, statsKey, s, 240);
        } catch {}
        return p;
      }
    }
  } catch {}
  return null;
}
async function handleSummary(request, env, ctx) {
  const A = await authed(request, env, ctx, { strict: true });
  if (!A.ok) return A.response;
  const { auth, headers, needsCookieUpdate, userKey } = A;
  const url = new URL(request.url);
  const period = url.searchParams.get("period") === "year" ? "year" : "month";
  const now = new Date(Date.now() + BJ_OFFSET_MS);
  let ref = (url.searchParams.get("ref") || "").trim();
  if (period === "month") {
    if (!/^\d{4}-\d{2}$/.test(ref)) ref = now.toISOString().slice(0, 7);
  } else {
    if (!/^\d{4}$/.test(ref)) ref = String(now.getUTCFullYear());
  }

  const cacheKey = `sum3:${userKey}:${period}:${ref}`;
  const force = url.searchParams.get("force") === "1";

  if (!force) {
    const hit = memCacheGet(__summaryMem, cacheKey);
    if (hit !== undefined) {
      if (!hit.lifetime) {
        try {
          hit.lifetime = await __loadLifetimeStats(env, ctx, userKey, headers);
        } catch {}
      }
      return authJson(auth, needsCookieUpdate, hit);
    }
  }

  const currentRef =
    period === "month"
      ? now.toISOString().slice(0, 7)
      : String(now.getUTCFullYear());
  const isCurrentPeriod = ref === currentRef;
  const sumTtl = isCurrentPeriod ? 86400 : 604800;
  const sumSwr = isCurrentPeriod ? 900 : 86400;
  const data = await cachedJSON(
    env,
    ctx,
    cacheKey,
    () => buildSummary(headers, period, ref, env, ctx, userKey),
    {
      ttl: sumTtl,
      missTtl: 300,
      swr: sumSwr,
      unwrap: true,
      jitter: 600,

      lastGoodKey: isCurrentPeriod ? "lg:" + cacheKey : null,
      staleRetention: isCurrentPeriod ? KV_STALE_RETENTION : 86400,
      ...(force ? { bypass: true, revalidate: true } : {}),
    },
  );
  if (!data || data.__error) {
    let lifetime = null;
    try {
      lifetime = await __loadLifetimeStats(env, ctx, userKey, headers);
    } catch {}
    return authJson(auth, needsCookieUpdate, {
      error: (data && data.__error) || "empty",
      lifetime,
    });
  }
  try {
    data.lifetime = await __loadLifetimeStats(env, ctx, userKey, headers);
  } catch {}
  memCacheSet(__summaryMem, cacheKey, data, 240);
  return authJson(auth, needsCookieUpdate, data);
}

function summaryRange(period, ref) {
  const iso = (ms) => new Date(ms).toISOString();
  if (period === "year") {
    const y = Number(ref);
    return {
      start: iso(Date.UTC(y, 0, 1, 0, 0, 0, 0) - BJ_OFFSET_MS),
      end: iso(Date.UTC(y, 11, 31, 23, 59, 59, 999) - BJ_OFFSET_MS),
      label: `${y} 年`,
    };
  }
  const [ys, m] = ref.split("-");
  const y = Number(ys), mo = Number(m);
  return {
    start: iso(Date.UTC(y, mo - 1, 1, 0, 0, 0, 0) - BJ_OFFSET_MS),
    end: iso(Date.UTC(y, mo, 0, 23, 59, 59, 999) - BJ_OFFSET_MS),
    label: `${y} 年 ${mo} 月`,
  };
}

async function fetchHistoryRange(headers, start, end, userKey) {
  const out = [];
  const limit = 100;
  for (let page = 1; page <= 3; page++) {
    if (page > 1) await sleep(80);
    if (isTraktRateLimited(userKey)) {
      return out.length ? out : { __error: "rate limited" };
    }
    const qs = `extended=full&page=${page}&limit=${limit}&start_at=${encodeURIComponent(start)}&end_at=${encodeURIComponent(end)}`;
    const data = await traktFetch(
      `${TRAKT_API}/users/me/history?${qs}`,
      headers,
      {
        retries: 0,
        timeout: 12000,
        userKey,
      },
    );
    if (!data || data.__error) {
      if (page === 1)
        return { __error: (data && data.__error) || "fetch failed" };
      break;
    }
    if (!Array.isArray(data)) return { __error: "invalid response" };
    if (!data.length) break;
    out.push(...data);
    if (data.length < limit) break;
  }
  return out;
}

async function buildSummary(headers, period, ref, env, ctx, userKey) {
  const { start, end, label } = summaryRange(period, ref);
  const items = await fetchHistoryRange(headers, start, end, userKey);
  if (!Array.isArray(items))
    return { __error: (items && items.__error) || "fetch failed" };
  const moviePlays = new Map();
  const showEpisodes = new Map();
  const dayCount = new Map();
  let totalMinutes = 0,
    episodePlays = 0;
  for (const it of items) {
    if (!it) continue;
    const watchedAt = it.watched_at || "";
    let day = "";
    if (watchedAt) {
      try {
        const d = new Date(watchedAt);
        day = new Date(d.getTime() + BJ_OFFSET_MS)
          .toISOString()
          .slice(0, 10);
      } catch {}
    }
    if (day) dayCount.set(day, (dayCount.get(day) || 0) + 1);
    if (it.type === "movie" || it.movie) {
      const m = it.movie || {};
      const traktId = m.ids && m.ids.trakt;
      const tmdbId = m.ids && m.ids.tmdb;
      const id = traktId || tmdbId || (m.ids && m.ids.imdb) || m.title;
      if (!id) continue;
      const key = String(id);
      const runtime = Number(m.runtime) || 0;
      const prev = moviePlays.get(key) || {
        title: m.title || "未知电影",
        year: m.year || "",
        plays: 0,
        minutes: 0,
        tmdb: tmdbId || null,
        traktId: traktId || null,
      };
      prev.plays += 1;
      prev.minutes += runtime;
      if (!prev.traktId && traktId) prev.traktId = traktId;
      if (!prev.tmdb && tmdbId) prev.tmdb = tmdbId;
      totalMinutes += runtime;
      moviePlays.set(key, prev);
    } else if (it.type === "episode" || it.episode || it.show) {
      const s = it.show || {},
        e = it.episode || {};
      const traktId = s.ids && s.ids.trakt,
        tmdbId = s.ids && s.ids.tmdb;
      const sid = traktId || tmdbId || s.title;
      if (!sid) continue;
      const key = String(sid);
      const runtime = Number(e.runtime) || Number(s.runtime) || 0;
      const prev = showEpisodes.get(key) || {
        title: s.title || "未知剧集",
        year: s.year || "",
        epKeys: new Set(),
        plays: 0,
        minutes: 0,
        tmdb: tmdbId || null,
        traktId: traktId || null,
      };
      const epKey =
        e.season != null && e.number != null
          ? `${e.season}-${e.number}`
          : `p${prev.plays}`;
      prev.epKeys.add(epKey);
      prev.plays += 1;
      prev.minutes += runtime;
      if (!prev.traktId && traktId) prev.traktId = traktId;
      if (!prev.tmdb && tmdbId) prev.tmdb = tmdbId;
      episodePlays += 1;
      totalMinutes += runtime;
      showEpisodes.set(key, prev);
    }
  }
  let busiest = null;
  for (const [d, n] of dayCount) {
    if (!busiest || n > busiest.count) busiest = { date: d, count: n };
  }
  let topMovies = [...moviePlays.values()]
    .sort((a, b) => b.plays - a.plays || b.minutes - a.minutes)
    .slice(0, 8);
  let topShows = [...showEpisodes.values()]
    .map((s) => ({
      title: s.title,
      year: s.year,
      episodes: s.epKeys.size,
      plays: s.plays,
      minutes: s.minutes,
      tmdb: s.tmdb,
      traktId: s.traktId,
    }))
    .sort((a, b) => b.episodes - a.episodes || b.plays - a.plays)
    .slice(0, 8);
  async function zhTitle(kind, item) {
    const fallback = item.title || "";
    if (!env || !env.TMDB_API_KEY) return fallback;
    try {
      if (item.tmdb) {
        const d = await tmdbGet(tmdbUrl(`/${kind}/${item.tmdb}`, env));
        const name = d && (d.title || d.name);
        if (name && name.trim()) return name.trim();
      }
      if (fallback) {
        const extra = { query: fallback };
        if (item.year) extra.year = item.year;
        const search = await tmdbGet(tmdbUrl(`/search/${kind}`, env, extra));
        const hit =
          search && search.results && search.results[0]
            ? search.results[0]
            : null;
        if (hit) {
          const name = hit.title || hit.name;
          if (name && name.trim()) {
            if (!item.tmdb && hit.id) item.tmdb = hit.id;
            return name.trim();
          }
        }
      }
    } catch {}
    return fallback;
  }
  await Promise.all([
    ...topMovies.map(async (m, i) => {
      topMovies[i] = { ...m, title: await zhTitle("movie", m) };
    }),
    ...topShows.map(async (s, i) => {
      topShows[i] = { ...s, title: await zhTitle("tv", s) };
    }),
  ]);
  topMovies = topMovies.map((m) => ({
    title: m.title,
    year: m.year,
    plays: m.plays,
    minutes: m.minutes,
    detailType: "movie",
    detailId: m.tmdb ? "tmdb-" + m.tmdb : m.traktId ? String(m.traktId) : null,
  }));
  topShows = topShows.map((s) => ({
    title: s.title,
    year: s.year,
    episodes: s.episodes,
    plays: s.plays,
    minutes: s.minutes,
    detailType: "show",
    detailId: s.tmdb ? "tmdb-" + s.tmdb : s.traktId ? String(s.traktId) : null,
  }));
  const days = [...dayCount.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));
  let prevRef = null,
    nextRef = null;
  if (period === "month") {
    const [y, m] = ref.split("-").map(Number);
    const prev = new Date(Date.UTC(y, m - 2, 1));
    const next = new Date(Date.UTC(y, m, 1));
    prevRef = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
    nextRef = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
  } else {
    const y = Number(ref);
    prevRef = String(y - 1);
    nextRef = String(y + 1);
  }
  return {
    period,
    ref,
    label,
    prevRef,
    nextRef,
    movies: moviePlays.size,
    moviePlays: [...moviePlays.values()].reduce((s, x) => s + x.plays, 0),
    shows: showEpisodes.size,
    episodes: episodePlays,
    uniqueEpisodes: [...showEpisodes.values()].reduce(
      (s, x) => s + x.epKeys.size,
      0,
    ),
    minutes: totalMinutes,
    hours: Math.round(totalMinutes / 60),
    busiest,
    topMovies,
    topShows,
    days,
    truncated: items.length >= 300,
    sampleSize: items.length,

    diag: {
      start,
      end,
      items: items.length,
      truncated: items.length >= 300,
    },
  };
}

async function handleHome(request, env, ctx) {
  const url = new URL(request.url);
  let initialDetail = url.searchParams.get("d");
  if (!initialDetail && url.pathname.startsWith("/detail/")) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 3) initialDetail = parts[1] + "/" + parts[2];
  }
  const cookieAuth = readAuth(request);
  if (!cookieAuth) return Response.redirect(new URL("/login", url), 302);
  const profileHint = readProfileHint(request);
  return streamHomeShell(initialDetail, profileHint);
}

function launchLinkHeader(request) {
  const parts = [
    "<https://api.trakt.tv>; rel=preconnect; crossorigin",
    "<https://api.themoviedb.org>; rel=preconnect; crossorigin",
    "<https://image.tmdb.org>; rel=preconnect",
  ];
  if (readAuth(request)) {
    parts.push(
      `</app.js?v=${APP_JS_VERSION}>; rel=preload; as=script`,
      `</app.css?v=${APP_CSS_VERSION}>; rel=preload; as=style`,
    );
  }
  return parts.join(", ");
}

function handleLaunch(request) {
  return new Response(renderLaunchPage(request), {
    headers: {
      "Content-Type": CT_HTML,
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      Link: launchLinkHeader(request),
    },
  });
}

function handleLogin(request) {
  const url = new URL(request.url);
  if (readAuth(request)) return Response.redirect(new URL("/home", url), 302);
  return html(renderLoginPage());
}

function handleAuthStatus(request) {
  const authed = !!readAuth(request);
  return new Response(JSON.stringify({ loggedIn: authed }), {
    status: authed ? 200 : 401,
    headers: {
      "Content-Type": CT_JSON,
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

function streamHomeShell(initialDetail, profileHint) {
  const cfg = {
    loggedIn: true,
    initialDetail: initialDetail || "",
    profileHint: profileHint || null,
  };
  const cfgJson = JSON.stringify(cfg).replace(/</g, "\\u003c");
  const boot = initialDetail
    ? `<script>window.__initialDetail=${jsStr(initialDetail)};<\/script>`
    : "";
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      try {
        controller.enqueue(
          enc.encode(
            `<!DOCTYPE html><html lang="zh-CN" data-theme="dark"><head>${commonHeadMeta()}<link rel="preload" href="/app.css?v=${APP_CSS_VERSION}" as="style"><link rel="modulepreload" href="/app.js?v=${APP_JS_VERSION}"><link rel="stylesheet" href="/app.css?v=${APP_CSS_VERSION}"><style>${splashCriticalCss()}</style><script>window.__splashT0=Date.now();window.__splashHidden=false;window.__primaryBootP=null;try{window.__primaryBootP=fetch('/api/home-data?part=playback',{credentials:'same-origin',cache:'no-store'}).then(function(r){if(r.status===401){location.href='/login';return null;}if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}).then(function(d){window.__primaryBoot=d;return d;}).catch(function(){return null;});}catch(e){}</script></head><body style="background:var(--bg-solid,#000000);margin:0;min-height:100vh;min-height:100dvh">${renderSplash()}`,
          ),
        );
        controller.enqueue(
          enc.encode(renderHomeSkeleton(initialDetail, profileHint)),
        );
        controller.enqueue(
          enc.encode(
            `<script>(function(){try{var v=localStorage.getItem('mt:pb');if(!v)return;var o=JSON.parse(v);if(!o||(o._exp&&o._exp<Date.now()))return;var d=o.data||o;var html=d&&d.playbackHScrollHtml;if(!html)return;var el=document.getElementById('playback-hscroll');if(el){el.innerHTML=html;window.__earlyPbApplied=1;}}catch(e){}})();<\/script>`,
          ),
        );
        controller.enqueue(
          enc.encode(
            `<script>window.__HOME_CONFIG__=${cfgJson};<\/script>${boot}` +
              pageTail(),
          ),
        );
      } catch (e) {}
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": CT_HTML,
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function getUserActivitySig(headers, env, ctx, userKey, force = false) {
  if (!userKey || userKey === "anon") return null;
  const result = await cachedJSON(
    env,
    ctx,
    `act:${userKey}`,
    async () => {
      const a = await traktFetch(`${TRAKT_API}/sync/last_activities`, headers, {
        retries: 1,
        timeout: 6000,
        userKey,
      });
      if (!a || a.__error) return null;
      const sig = [
        (a.movies && a.movies.watched_at) || "",
        (a.episodes && a.episodes.watched_at) || "",
        (a.shows && a.shows.watched_at) || "",
        (a.seasons && a.seasons.watched_at) || "",
        (a.watchlist && a.watchlist.updated_at) || "",
        (a.episodes && a.episodes.paused_at) || "",
        (a.movies && a.movies.paused_at) || "",
        (a.episodes && a.episodes.collected_at) || "",
        (a.movies && a.movies.collected_at) || "",
        (a.all && a.all) || "",
      ].join("|");
      const playbackTs =
        [
          a.episodes && a.episodes.paused_at,
          a.episodes && a.episodes.watched_at,
          a.movies && a.movies.paused_at,
          a.movies && a.movies.watched_at,
        ]
          .filter((t) => t && String(t).trim())
          .sort()
          .pop() || null;

      const watchedAt =
        [a.episodes && a.episodes.watched_at, a.movies && a.movies.watched_at]
          .filter((t) => t && String(t).trim())
          .sort()
          .pop() || null;
      return { sig, playbackTs, watchedAt };
    },
    {

      ttl: 900,
      missTtl: 90,
      swr: false,
      revalidate: false,
      jitter: 120,
      userKey,
      ...(force ? { bypass: true } : {}),
    },
  );
  return result;
}

async function __activityDiffers(headers, env, ctx, userKey) {
  if (!userKey) return false;
  try {
    const cur = await getUserActivitySig(headers, env, ctx, userKey);
    if (!cur || !cur.sig) return false;
    const syncState = await readSyncState(env, userKey);

    const lastWatched =
      syncState && typeof syncState.watchedAt === "string"
        ? syncState.watchedAt
        : null;
    if (cur.watchedAt && lastWatched) return lastWatched !== cur.watchedAt;

    const last =
      syncState && typeof syncState.sig === "string" ? syncState.sig : null;
    return !!(last && last !== cur.sig);
  } catch {
    return false;
  }
}

const __lastUserState = new Map();
const __droppedShowIdsMem = new Map();
const DROPPED_MEM_TTL = 0;
const __droppedShowIdsNegative = new Map();
const DROPPED_NEGATIVE_TTL = 5 * 60 * 1000;

async function getDroppedShowIds(headers, env, ctx, userKey) {
  const key = `dropped:${userKey || "anon"}`;
  const now = Date.now();
  const mem = __droppedShowIdsMem.get(key);
  if (mem && now - mem.ts < DROPPED_MEM_TTL)
    return new Set(mem.ids.map(Number));
  const negAt = __droppedShowIdsNegative.get(key);
  if (negAt && now - negAt < DROPPED_NEGATIVE_TTL) {
    if (mem) return new Set(mem.ids.map(Number));
    return new Set();
  }
  const data = await cachedJSON(
    env,
    ctx,
    key,
    async () => {
      if (isTraktRateLimited(userKey)) return { __error: "rate limited" };

      if (traktBudgetCheck(userKey) > 0) {
        return { __error: "budget exceeded", __cooling: 3 };
      }
      traktBudgetTake(userKey);
      const ids = new Set();
      try {

        for (let page = 1; page <= 2; page++) {
          if (page > 1) await sleep(50);
          if (isTraktRateLimited(userKey)) return { __error: "rate limited" };
          const r = await fetchT(
            `${TRAKT_API}/users/hidden/dropped?type=show&page=${page}&limit=100`,
            { headers },
            8000,
          );
          if (r.status === 429) {
            consumeRetryAfter(r, userKey);
            return { __error: "HTTP 429" };
          }
          if (!r.ok) return { __error: "HTTP " + r.status };
          const arr = await r.json();
          if (!Array.isArray(arr)) return { __error: "invalid response" };
          if (!arr.length) break;
          for (const it of arr) {
            const id = it && it.show && it.show.ids && it.show.ids.trakt;
            if (id) ids.add(Number(id));
          }
          if (arr.length < 100) break;
        }
      } catch (e) {
        return { __error: String(e) };
      } finally {

        traktBudgetRelease();
      }
      return { ids: [...ids] };
    },
    {

      ttl: 86400,
      missTtl: 300,
      swr: false,
      memOnly: false,
      jitter: 600,
      unwrap: true,
    },
  );
  if (data && Array.isArray(data.ids)) {
    const ids = data.ids.map(Number);
    __droppedShowIdsMem.set(key, { ids, ts: now });
    __droppedShowIdsNegative.delete(key);
    if (__droppedShowIdsMem.size > 500) {
      const it = __droppedShowIdsMem.keys();
      for (let i = 0; i < 100; i++) {
        const k = it.next().value;
        if (k) __droppedShowIdsMem.delete(k);
      }
    }
    return new Set(ids);
  }
  __droppedShowIdsNegative.set(key, now);
  if (__droppedShowIdsNegative.size > 500) {
    const it = __droppedShowIdsNegative.keys();
    for (let i = 0; i < 100; i++) {
      const k = it.next().value;
      if (k) __droppedShowIdsNegative.delete(k);
    }
  }
  if (mem) return new Set(mem.ids.map(Number));
  return new Set();
}
const USER_STATE_KV_TTL = 300;

async function readSyncState(env, userKey) {
  const key = CK.syncState(userKey);
  if (env && env.TMDB_CACHE && !kvIsDown()) {
    try {
      const raw = await env.TMDB_CACHE.get(key, kvReadOpts());
      kvMarkUp();
      if (raw && !raw.miss) {
        const v = raw.data !== undefined ? raw.data : raw;
        if (v && typeof v === "object" && !Array.isArray(v)) {
          kvRemember(key, { data: v, _ts: (raw && raw._ts) || Date.now() });
          return v;
        }
      }
    } catch {
      kvMarkDown();
    }
  }
  return null;
}

async function writeSyncState(env, ctx, userKey, patch, persist = true) {

  if (!persist) return;
  const key = CK.syncState(userKey);
  let prev = {};
  if (env && env.TMDB_CACHE && !kvIsDown()) {
    try {
      const raw = await env.TMDB_CACHE.get(key, kvReadOpts());
      kvMarkUp();
      const v = raw && raw.data !== undefined ? raw.data : raw;
      if (v && typeof v === "object" && !Array.isArray(v)) prev = v;
    } catch {
      kvMarkDown();
    }
  }
  const next = { ...prev, ...(patch || {}) };
  kvRemember(key, { data: next, _ts: Date.now() });
  kvPutJSON(env, ctx, key, { data: next }, 86400 * 7, false);
}

function userStateCacheKey(userKey) {
  return `us:v1:${userKey || "anon"}`;
}

function droppedStateToSet(state) {
  const arr = state && Array.isArray(state.droppedIds) ? state.droppedIds : [];
  return new Set(arr.map(Number).filter(Number.isFinite));
}

function watchedStateToSet(watched) {
  const ids =
    watched && Array.isArray(watched.ids)
      ? watched.ids
      : Array.isArray(watched)
        ? watched
        : [];
  const set = new Set(ids.map(Number).filter(Number.isFinite));
  if (watched && watched.showLastAt && typeof watched.showLastAt === "object") {
    set.__showLastAt = watched.showLastAt;
  }
  if (watched && watched.dataTs) set.__dataTs = Number(watched.dataTs) || 0;
  return set;
}

async function getUserStateBundle(headers, env, ctx, userKey, force = false) {
  const key = userStateCacheKey(userKey);
  const data = await cachedJSON(
    env,
    ctx,
    key,
    async () => {
      const [droppedSet, watchedRaw, hideMapRaw] = await Promise.all([
        getDroppedShowIds(headers, env, ctx, userKey).catch(() => new Set()),

        getWatchedEpisodeIds(headers, env, ctx, userKey, force).catch(
          () => null,
        ),
        getCwHideMap(env, ctx, userKey).catch(() => ({})),
      ]);
      let watched = { ids: [], showLastAt: {}, dataTs: 0 };
      if (watchedRaw instanceof Set) {
        watched = {
          ids: [...watchedRaw].map(Number),
          showLastAt: watchedRaw.__showLastAt || {},
          dataTs: Number(watchedRaw.__dataTs) || 0,
        };
      } else if (watchedRaw && Array.isArray(watchedRaw.ids)) {
        watched = {
          ids: watchedRaw.ids.map(Number),
          showLastAt: watchedRaw.showLastAt || {},
          dataTs: Number(watchedRaw.dataTs) || 0,
        };
      } else if (Array.isArray(watchedRaw)) {
        watched = { ids: watchedRaw.map(Number), showLastAt: {}, dataTs: 0 };
      } else {

        const prev = __lastUserState.get(userKey);
        if (prev && prev.watched) watched = prev.watched;
      }
      const bundle = {
        droppedIds: droppedSet ? [...droppedSet].map(Number) : [],
        watched,
        hideMap:
          hideMapRaw &&
          typeof hideMapRaw === "object" &&
          !Array.isArray(hideMapRaw)
            ? hideMapRaw
            : {},
      };

      if (watchedRaw) {
        __lastUserState.set(userKey, bundle);
        if (__lastUserState.size > 500) {
          const it = __lastUserState.keys();
          for (let i = 0; i < 100; i++) {
            const k = it.next().value;
            if (k) __lastUserState.delete(k);
          }
        }
      }
      return bundle;
    },
    {
      ttl: USER_STATE_KV_TTL,
      missTtl: 60,
      swr: true,
      jitter: 60,
      unwrap: true,
      bypass: !!force,
      revalidate: !!force,

      memOnly: true,
    },
  );
  if (!data) {
    return {
      droppedIds: [],
      watched: { ids: [], showLastAt: {} },
      hideMap: {},
    };
  }
  return data;
}

function bustUserStateBundle(userKey, env, ctx) {
  if (!userKey) return;
  const key = userStateCacheKey(userKey);
  __kvMemStale.delete(key);
  dropInflight(key);
  __kvLastPut.delete(key);

}

function safeDeleteKvKeys(env, ctx, keys) {
  const list = [...new Set((keys || []).filter(Boolean))];
  if (!list.length) return Promise.resolve();
  for (const k of list) {
    __kvMemStale.delete(k);
    __kvLastPut.delete(k);
    dropInflight(k);
  }
  if (!env || !env.TMDB_CACHE) return Promise.resolve();
  const p = Promise.allSettled(list.map((k) => env.TMDB_CACHE.delete(k)))
    .then(() => kvMarkUp())
    .catch(() => {
      kvMarkDown();
    });
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
  return p;
}

const __lastWatchedEp = new Map();

function rememberWatchedEp(userKey, set) {
  if (!userKey || !set) return;
  __lastWatchedEp.set(userKey, set);
  if (__lastWatchedEp.size > 500) {
    const it = __lastWatchedEp.keys();
    for (let i = 0; i < 100; i++) {
      const k = it.next().value;
      if (k) __lastWatchedEp.delete(k);
    }
  }
}

async function getWatchedMovieIds(headers, env, ctx, userKey, force = false) {
  if (!userKey) return new Set();
  const raw = await cachedJSON(
    env,
    ctx,
    CK.watchedMovies(userKey),
    async () => {
      if (isTraktRateLimited(userKey)) return { __error: "429 cooling" };
      try {
        const res = await fetchT(
          `${TRAKT_API}/sync/watched/movies`,
          { headers },
          20000,
        );
        if (res.status === 429) {
          consumeRetryAfter(res, userKey);
          return null;
        }
        if (!res.ok) return null;
        const arr = await res.json();
        if (!Array.isArray(arr)) return null;
        const ids = [];
        for (const w of arr) {
          const id = w && w.movie && w.movie.ids && w.movie.ids.trakt;
          if (id != null) ids.push(Number(id));
        }
        return { ids };
      } catch {
        return null;
      }
    },
    {
      ttl: 86400,
      missTtl: 300,
      swr: 0,
      jitter: 300,
      userKey,
      ...(force ? { bypass: true, revalidate: true } : {}),
    },
  );
  const ids = raw && Array.isArray(raw.ids) ? raw.ids : [];
  return new Set(ids.map(Number).filter(Number.isFinite));
}

async function getWatchedEpisodeIds(headers, env, ctx, userKey, force = false) {

  const src = { fromCache: null, age: 0 };
  const raw = await cachedJSON(
    env,
    ctx,
    CK.watchedEpisodes(userKey || "anon"),
    async () => {
      if (isTraktRateLimited(userKey)) return { __error: "429 cooling" };
      try {

        const epRes = await fetchT(
          `${TRAKT_API}/sync/watched/episodes`,
          { headers },
          20000,
        );
        if (epRes.status === 429) {
          consumeRetryAfter(epRes, userKey);
          return null;
        }
        if (!epRes.ok) return null;
        const arr = await epRes.json();
        if (!Array.isArray(arr)) return null;
        const out = [];
        const showLastAt = {};

        const byShow = {};
        for (const w of arr) {
          const id = w && w.episode && w.episode.ids && w.episode.ids.trakt;
          if (id != null) out.push(Number(id));
          const sid = w && w.show && w.show.ids && w.show.ids.trakt;
          const at =
            w && w.last_watched_at ? Date.parse(w.last_watched_at) : NaN;
          bumpShowLastAt(showLastAt, sid, at);
          const sn = w && w.episode && w.episode.season;
          const en = w && w.episode && w.episode.number;
          if (sid != null && sn != null && en != null) {
            const sk = String(sid);
            const seasonKey = String(Number(sn));
            const epKey = String(Number(en));
            if (!byShow[sk]) byShow[sk] = {};
            if (!byShow[sk][seasonKey]) byShow[sk][seasonKey] = {};
            byShow[sk][seasonKey][epKey] = 1;
          }
        }
        return { ids: out, showLastAt, byShow };
      } catch {
        return null;
      }
    },
    {

      ttl: 86400,
      missTtl: 300,

      swr: 0,
      jitter: 300,
      sourceTracker: src,
      userKey,

      lastGoodKey: CK.lastGood.watchedEpisodes(userKey || "anon"),

      ...(force ? { bypass: true, revalidate: true } : {}),
    },
  );

  let pending = null;
  try {
    pending = await readPendingWatched(env, userKey);
  } catch {}
  if (!raw) {
    const fallback = __lastWatchedEp.get(userKey || "anon");
    if (pending) {
      const merged = mergeWatchedPayload(
        fallback
          ? {
              ids: [...fallback],
              byShow: fallback.__byShow || {},
              showLastAt: fallback.__showLastAt || {},
            }
          : null,
        pending,
      );
      const s = new Set((merged.ids || []).map(Number));
      if (merged.byShow) s.__byShow = merged.byShow;
      if (merged.showLastAt) s.__showLastAt = merged.showLastAt;
      s.__dataTs = Date.now();
      rememberWatchedEp(userKey, s);
      return s;
    }
    return fallback || null;
  }
  const dataTs =
    src.fromCache === null
      ? 0
      : src.fromCache === false
        ? Date.now()
        : Date.now() - Math.max(0, Number(src.age) || 0) * 1000;
  const mergedRaw = pending ? mergeWatchedPayload(raw, pending) : raw;
  if (Array.isArray(mergedRaw)) {
    const s = new Set(mergedRaw.map(Number));
    s.__dataTs = dataTs;
    rememberWatchedEp(userKey, s);
    return s;
  }
  const set = new Set(
    (Array.isArray(mergedRaw.ids) ? mergedRaw.ids : []).map(Number),
  );
  if (mergedRaw.showLastAt && typeof mergedRaw.showLastAt === "object")
    set.__showLastAt = mergedRaw.showLastAt;
  if (mergedRaw.byShow && typeof mergedRaw.byShow === "object")
    set.__byShow = mergedRaw.byShow;
  set.__dataTs = dataTs;
  rememberWatchedEp(userKey, set);

  if (pending && env && userKey) {
    try {
      const payload = Array.isArray(mergedRaw)
        ? { ids: mergedRaw }
        : mergedRaw;
      kvPutJSON(
        env,
        ctx,
        CK.watchedEpisodes(userKey),
        { data: payload },
        21600,
        false,
        true,
      );
    } catch {}
  }
  return set;
}

async function patchWatchedEpisodes(env, ctx, userKey, ops = {}) {
  if (!userKey || !env || !env.TMDB_CACHE || kvIsDown()) return;
  const add = (ops.add || []).map(Number).filter(Number.isFinite);
  const remove = (ops.remove || []).map(Number).filter(Number.isFinite);
  if (!add.length && !remove.length && !ops.byShowAdd) return;
  const key = CK.watchedEpisodes(userKey);
  try {
    const raw = await env.TMDB_CACHE.get(key, { type: "json" });
    let d =
      raw && !raw.miss
        ? raw.data !== undefined
          ? raw.data
          : raw
        : null;

    if (!d) d = { ids: [], byShow: {}, showLastAt: {} };
    const baseIds = Array.isArray(d) ? d : Array.isArray(d.ids) ? d.ids : [];
    const ids = new Set(baseIds.map(Number).filter(Number.isFinite));
    for (const id of add) ids.add(id);
    for (const id of remove) ids.delete(id);
    const next = Array.isArray(d)
      ? [...ids]
      : { ...d, ids: [...ids] };

    if (ops.byShowAdd && !Array.isArray(next)) {
      const byShow = next.byShow && typeof next.byShow === "object" ? next.byShow : {};
      for (const [sk, seasons] of Object.entries(ops.byShowAdd)) {
        if (!byShow[sk]) byShow[sk] = {};
        for (const [sn, eps] of Object.entries(seasons)) {
          if (!byShow[sk][sn]) byShow[sk][sn] = {};
          for (const en of eps) byShow[sk][sn][String(en)] = 1;
        }
      }
      next.byShow = byShow;
    }
    await kvPutJSON(env, ctx, key, { data: next }, 21600, false, true);

    __kvMemStale.delete(key);
    try {
      if (ctx && ctx.__mtMemo) ctx.__mtMemo.delete(key);
    } catch {}
    dropInflight(key);
  } catch {}
}

function pendingWatchedKey(userKey) {
  return `pendingWe:${userKey}`;
}
async function rememberPendingWatched(env, ctx, userKey, ops = {}) {
  if (!userKey || !env || !env.TMDB_CACHE || kvIsDown()) return;
  try {
    const key = pendingWatchedKey(userKey);
    let cur = { ids: [], byShow: {}, at: Date.now() };
    try {
      const raw = await env.TMDB_CACHE.get(key, { type: "json" });
      if (raw && !raw.miss) {
        const d = raw.data !== undefined ? raw.data : raw;
        if (d && typeof d === "object") cur = { ...cur, ...d };
      }
    } catch {}
    const idSet = new Set((cur.ids || []).map(Number).filter(Number.isFinite));
    for (const id of ops.add || []) idSet.add(Number(id));
    for (const id of ops.remove || []) idSet.delete(Number(id));
    cur.ids = [...idSet];
    cur.at = Date.now();
    if (ops.movieAdd || ops.movieRemove) {
      const ms = new Set((cur.movieIds || []).map(Number).filter(Number.isFinite));
      for (const id of ops.movieAdd || []) ms.add(Number(id));
      for (const id of ops.movieRemove || []) ms.delete(Number(id));
      cur.movieIds = [...ms];
    }
    if (ops.byShowAdd) {
      cur.byShow =
        cur.byShow && typeof cur.byShow === "object" ? cur.byShow : {};
      for (const [sk, seasons] of Object.entries(ops.byShowAdd)) {
        if (!cur.byShow[sk]) cur.byShow[sk] = {};
        for (const [sn, eps] of Object.entries(seasons)) {
          if (!cur.byShow[sk][sn]) cur.byShow[sk][sn] = {};
          for (const en of eps) cur.byShow[sk][sn][String(en)] = 1;
        }
      }
    }
    await env.TMDB_CACHE.put(
      key,
      JSON.stringify({ data: cur, _ts: Date.now() }),
      { expirationTtl: 600 },
    );
  } catch {}
}
async function readPendingWatched(env, userKey) {
  if (!userKey || !env || !env.TMDB_CACHE || kvIsDown()) return null;
  try {
    const raw = await env.TMDB_CACHE.get(pendingWatchedKey(userKey), {
      type: "json",
    });
    if (!raw || raw.miss) return null;
    const d = raw.data !== undefined ? raw.data : raw;
    return d && typeof d === "object" ? d : null;
  } catch {
    return null;
  }
}
function mergeWatchedPayload(base, pending) {
  if (!pending) return base;
  if (!base) {
    return {
      ids: [...(pending.ids || [])],
      byShow: pending.byShow || {},
      showLastAt: {},
    };
  }
  const isArr = Array.isArray(base);
  const idSet = new Set(
    (isArr ? base : base.ids || []).map(Number).filter(Number.isFinite),
  );
  for (const id of pending.ids || []) idSet.add(Number(id));
  if (isArr) return [...idSet];
  const byShow =
    base.byShow && typeof base.byShow === "object" ? { ...base.byShow } : {};
  if (pending.byShow) {
    for (const [sk, seasons] of Object.entries(pending.byShow)) {
      if (!byShow[sk]) byShow[sk] = {};
      for (const [sn, eps] of Object.entries(seasons || {})) {
        if (!byShow[sk][sn]) byShow[sk][sn] = {};
        Object.assign(byShow[sk][sn], eps);
      }
    }
  }
  return { ...base, ids: [...idSet], byShow };
}
function mergeProgressWithPending(progress, pending, showId) {
  if (!progress || !pending) return progress;
  const showKey = showId != null ? String(showId) : null;
  const byShow = pending.byShow || {};
  const seasonMap = showKey && byShow[showKey] ? byShow[showKey] : null;
  if (!seasonMap || !Array.isArray(progress.seasons)) return progress;
  const seasons = progress.seasons.map((s) => {
    if (!s || s.number == null) return s;
    const sn = String(Number(s.number));
    const epsMark = seasonMap[sn] || seasonMap[String(s.number)];
    if (!epsMark || !Array.isArray(s.episodes)) return s;
    let added = 0;
    const episodes = s.episodes.map((ep) => {
      if (!ep || ep.number == null) return ep;
      const en = String(Number(ep.number));
      if (!epsMark[en] && !epsMark[String(ep.number)]) return ep;
      if (ep.completed) return ep;
      added++;
      return {
        ...ep,
        completed: true,
        last_watched_at: ep.last_watched_at || new Date().toISOString(),
      };
    });
    if (!added) return s;
    const completed = episodes.filter((e) => e && e.completed).length;
    return { ...s, episodes, completed };
  });
  return { ...progress, seasons };
}

async function getCwHideMap(env, ctx, userKey) {
  if (!userKey) return {};
  const raw = await cachedJSON(env, ctx, CK.cwHide(userKey), async () => ({}), {
    ttl: 86400 * 30,
    missTtl: 60,
    swr: false,
    jitter: 120,
  });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw;
}

function putCwHideMap(env, ctx, userKey, map) {
  if (!userKey) return Promise.resolve();
  const data = map && typeof map === "object" ? map : {};
  return kvPutJSON(
    env,
    ctx,
    CK.cwHide(userKey),
    { data },
    86400 * 30,
    false,
    true,
  );
}

function isCwHiddenEntry(entry, hideMap) {
  if (!entry || !hideMap || typeof hideMap !== "object") return false;
  const show = entry.show;
  const sid = show && show.ids && show.ids.trakt;
  if (sid == null) return false;
  const h = hideMap[String(sid)] || hideMap[sid];
  if (!h || typeof h !== "object") return false;
  const pausedAt = entry.paused_at ? Date.parse(entry.paused_at) : NaN;
  if (h.at && Number.isFinite(pausedAt) && pausedAt > Number(h.at)) {
    return false;
  }
  const ep =
    entry.episode || (entry.progress && entry.progress.next_episode) || null;
  if (!ep) return true;
  const s = Number(ep.season != null ? ep.season : ep.season_number);
  const n = Number(ep.number != null ? ep.number : ep.episode_number);
  const hs = Number(h.s);
  const hn = Number(h.e);
  const newer =
    Number.isFinite(s) &&
    Number.isFinite(n) &&
    Number.isFinite(hs) &&
    Number.isFinite(hn) &&
    (s > hs || (s === hs && n > hn));
  if (newer) {
    const fa = ep.first_aired ? Date.parse(ep.first_aired) : NaN;
    const lw = entry.last_watched_at
      ? Date.parse(entry.last_watched_at)
      : entry.progress && entry.progress.last_watched_at
        ? Date.parse(entry.progress.last_watched_at)
        : NaN;
    const hat = Number(h.at) || 0;
    if (Number.isFinite(fa) && fa > hat) return false;
    if (Number.isFinite(lw) && lw > hat) return false;
  }
  return true;
}

function filterCwHiddenList(list, hideMap) {
  if (!Array.isArray(list) || !list.length) return list || [];
  if (!hideMap || typeof hideMap !== "object" || !Object.keys(hideMap).length)
    return list;
  const out = [];
  const autoUnhide = [];
  for (const entry of list) {
    if (!entry) continue;
    const show = entry.show;
    const sid = show && show.ids && show.ids.trakt;
    if (sid == null) {
      out.push(entry);
      continue;
    }
    const h = hideMap[String(sid)] || hideMap[sid];
    if (!h) {
      out.push(entry);
      continue;
    }
    if (isCwHiddenEntry(entry, hideMap)) {
      continue;
    }
    autoUnhide.push(Number(sid));
    out.push(entry);
  }
  if (autoUnhide.length) {
    Object.defineProperty(out, "__autoUnhide", {
      value: autoUnhide,
      enumerable: false,
    });
  }
  return out;
}

function calendarWeekStart(today) {
  const d = new Date(String(today) + "T00:00:00Z");
  if (!Number.isFinite(d.getTime())) return String(today);
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff - 7);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// 写入与读取必须共用同一个 key，否则 peek 永远 miss
function calendarCacheKey(userKey, today) {
  return CK.calendar(userKey || "anon", "w:" + calendarWeekStart(today));
}

async function getCalendarCached(
  today,
  headers,
  env,
  ctx,
  userKey,
  force,
  sourceTracker,
) {
  const prefix = userKey || "anon";

  const startDate = calendarWeekStart(today);
  return cachedJSON(
    env,
    ctx,
    calendarCacheKey(prefix, today),
    async () => {
      const dbg = sourceTracker ? (sourceTracker.debug = {}) : {};
      try {
        if (isTraktRateLimited(userKey)) {
          dbg.rateLimited = true;
          return { __error: "rate limited" };
        }
        const r = await fetchT(
          `${TRAKT_API}/calendars/my/shows/${startDate}/21?extended=full&images=poster`,
          { headers },
          9000,
        );
        if (r.ok) {
          const data = await r.json();
          dbg.items = Array.isArray(data) ? data.length : "null";
          return data;
        }
        if (r.status === 429) {
          consumeRetryAfter(r, userKey);
          dbg.error = "HTTP 429";
          return { __error: "HTTP 429" };
        }
        dbg.error = "HTTP " + r.status;
        return { __error: "HTTP " + r.status };
      } catch (e) {
        dbg.error = String(e);
        return { __error: String(e) };
      }
    },
    {
      ttl: CALENDAR_KV_TTL,
      missTtl: 120,
      swr: force ? true : Math.floor(CALENDAR_KV_TTL * 0.45),
      jitter: 120,
      bypass: !!force,
      revalidate: true,
      lastGoodKey: CK.lastGood.calendar(prefix),
      staleRetention: 86400,
      ...(sourceTracker ? { sourceTracker } : {}),
    },
  );
}

async function peekCalendarCached(today, env, userKey) {
  // 只读缓存：key 必须与 getCalendarCached 写入的完全一致
  const key = calendarCacheKey(userKey, today);
  const lgKey = CK.lastGood.calendar(userKey || "anon");
  const memHit = (k) => {
    const st = kvMemStaleGet(k);
    return st && Array.isArray(st.data) ? st.data : null;
  };
  const readKv = async (k) => {
    if (!env || !env.TMDB_CACHE || kvIsDown()) return null;
    try {
      const raw = await env.TMDB_CACHE.get(k, kvReadOpts());
      kvMarkUp();
      if (!raw || raw.miss) return null;
      const v = raw.data !== undefined ? raw.data : raw;
      if (!Array.isArray(v)) return null;
      kvRemember(key, { data: v, _ts: (raw && raw._ts) || Date.now() });
      kvMemStaleSet(key, v, raw && raw._ts);
      return v;
    } catch {
      kvMarkDown();
      return null;
    }
  };
  const hit = memHit(key);
  if (hit) return hit;
  const fresh = await readKv(key);
  if (fresh) return fresh;
  // 回落最近一次成功的日历（lastGood），避免周键轮换/缓存过期时整块空
  const lgMem = memHit(lgKey);
  if (lgMem) return lgMem;
  return await readKv(lgKey);
}

async function handleActivitySig(request, env, ctx) {
  const A = await authed(request, env, ctx, { strict: true });
  if (!A.ok) return A.response;
  const { auth, headers, needsCookieUpdate, userKey } = A;
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const cur = await getUserActivitySig(headers, env, ctx, userKey, force);
  let last = null;
  if (userKey) {
    const syncState = await readSyncState(env, userKey);
    if (syncState && typeof syncState.sig === "string") last = syncState.sig;
  }
  return authJson(auth, needsCookieUpdate, {
    sig: cur && cur.sig ? cur.sig : null,
    last,
    changed: !!(cur && cur.sig && last && cur.sig !== last),
    noBaseline: !last,
    playbackTs: (cur && cur.playbackTs) || null,
    hint: "changed=true 表示检测到新的观看/暂停活动，下一次 home-data 刷新会自动绕过缓存拉新数据；noBaseline=true 表示还没有基线记录，首次拉取新数据后会自动建立。",
  });
}

async function handleHomeData(request, env, ctx) {
  const A = await authed(request, env, ctx, { strict: true });
  if (!A.ok) {
    return Response.json(
      { login: true },
      {
        status: 401,
        headers: { "Set-Cookie": clearCookieHeader() },
      },
    );
  }
  const { auth, headers, needsCookieUpdate, userKey } = A;
  const url = new URL(request.url);

  const kvCoolingSec = await syncTraktCooldownFromKV(env, userKey);
  const rateLimitedNow = kvCoolingSec > 0 || isTraktRateLimited(userKey);
  const today = new Date(Date.now() + BJ_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
  const part = url.searchParams.get("part") || "all";
  const force = url.searchParams.get("force") === "1";
  const liveSig = url.searchParams.get("live") === "1";
  const fetchJson = (u, retries = 1, timeout = 7000) =>
    traktFetch(u, headers, {
      retries,
      timeout,
      userKey,
      wantPageCount: true,
      backoffBase: 400,
    });
  const outHeaders = new Headers({
    "Content-Type": CT_JSON,
    "Cache-Control": CC_NO_STORE,
  });
  if (needsCookieUpdate)
    outHeaders.append("Set-Cookie", buildCookie(auth, auth.trakt_id));
  const wantPlayback = part === "playback" || part === "all";
  const wantMeta = part === "meta" || part === "all";
  const wantWatchlist = part === "watchlist" || part === "all";
  const wantCalendar = part === "calendar" || part === "all";
  const wantHistory = part === "history" || part === "all";

  const needUserSig =
    wantPlayback || wantWatchlist || wantCalendar || wantHistory;
  const actSigP = needUserSig
    ? getUserActivitySig(
        headers,
        env,
        ctx,
        userKey,
        (force || liveSig) && !rateLimitedNow,
      )
    : Promise.resolve(null);
  let pbBypass = force;
  let sigBaselineNeeded = false;
  let activityUnchanged = false;
  let pbLastCheckAt = null;
  let pbWantLive = !!force;

  let watchedBypass = false;

  let partsBypass = force && !rateLimitedNow;

  const syncState = needUserSig ? await readSyncState(env, userKey) : null;
  if (needUserSig) {
    if (syncState && Number.isFinite(Number(syncState.at))) {
      pbLastCheckAt = Number(syncState.at);
    }
    let sigChanged = false;
    let hasBaseline = false;
    try {
      const sigEarly = await actSigP;
      if (sigEarly && sigEarly.sig) {
        const last =
          syncState && typeof syncState.sig === "string" ? syncState.sig : null;
        if (last === null) {
          sigBaselineNeeded = true;
        } else {
          hasBaseline = true;
          if (last !== sigEarly.sig) sigChanged = true;
        }
      }
    } catch {}
    if (force) {
      if (rateLimitedNow) {

        pbBypass = false;
        pbWantLive = false;
        activityUnchanged = hasBaseline && !sigChanged;
        watchedBypass = false;
        partsBypass = false;
      } else {

        pbBypass = true;
        pbWantLive = true;
        activityUnchanged = hasBaseline && !sigChanged;
        watchedBypass = true;
        partsBypass = true;
      }
    } else if (sigChanged) {

      pbBypass = true;
      pbWantLive = true;
      activityUnchanged = false;
      watchedBypass = true;
      partsBypass = true;
      try {
        if (userKey && env) {
          const histKeys = [
            CK.history(userKey, 1),
            CK.history(userKey, 2),
            CK.history(userKey, 3),

            CK.stats(userKey),
          ];
          const p = safeDeleteKvKeys(env, ctx, histKeys);
          if (ctx && typeof ctx.waitUntil === "function") {
            ctx.waitUntil(
              (async () => {
                await p;
                try {
                  if (
                    env.TMDB_CACHE &&
                    typeof env.TMDB_CACHE.list === "function"
                  ) {
                    const toDel = [];
                    for (const prefix of [
                      `hist:${userKey}:`,
                      `more:hist:${userKey}:`,

                    ]) {
                      let cursor;
                      do {
                        const page = await env.TMDB_CACHE.list({
                          prefix,
                          cursor,
                          limit: 100,
                        });
                        for (const k of page.keys || []) {
                          if (k && k.name) toDel.push(k.name);
                        }
                        cursor = page.list_complete ? null : page.cursor;
                      } while (cursor);
                    }
                    if (toDel.length) await safeDeleteKvKeys(env, ctx, toDel);
                  }
                  markProgressDirty(env, ctx, userKey);
                } catch {}
              })(),
            );
          } else {
            await p;
          }
        }
      } catch {}
    } else if (sigBaselineNeeded) {

      pbBypass = true;
      pbWantLive = true;
      activityUnchanged = false;
      watchedBypass = true;
      partsBypass = true;
    } else {

      pbBypass = false;
      pbWantLive = false;
      activityUnchanged = true;
      partsBypass = false;
    }
  }

  const result = { part };
  result.activityUnchanged = activityUnchanged;

  if (rateLimitedNow) {
    result.rateLimited = true;
    result.cooling = Math.max(kvCoolingSec, traktRateLimitedRemaining(userKey));
  }
  const taskFns = [];
  let playback = null,
    profile = null,
    history = null,
    calendar = null,
    watchlist = null;
  const playbackSrc = { fromCache: true, age: 0 };
  const metaSrc = { fromCache: null, age: 0 };
  const watchlistSrc = { fromCache: true, age: 0 };
  const calendarSrc = { fromCache: true, age: 0 };
  const historySrc = { fromCache: true, age: 0 };

  const opts = (o, hard = true) =>
    force && !rateLimitedNow
      ? hard
        ? { ...o, bypass: true, revalidate: true }
        : { ...o, bypass: false, revalidate: true, swr: true }
      : force
        ? { ...o, bypass: false, revalidate: true, swr: true }
        : { ...o, revalidate: false, swr: false };
  if (wantPlayback) {
    taskFns.push(async () => {

      if (!playbackSrc.debug) playbackSrc.debug = {};

      const userStateP = getUserStateBundle(
        headers,
        env,
        ctx,
        userKey,
        watchedBypass,
      ).catch(() => null);

      const rawPb = await cachedJSON(
        env,
        ctx,
        CK.playback(userKey),
        async () => {
          const dbg = playbackSrc.debug || (playbackSrc.debug = {});
          if (isTraktRateLimited(userKey)) {
            dbg.rateLimited = true;
            dbg.cooling = traktRateLimitedRemaining(userKey);
            return {
              __error: "429 rate limited",
              __cooling: traktRateLimitedRemaining(userKey),
            };
          }

          const nitroDown = __nitroDownUntil > Date.now();
          const [paused, upNextRaw] = await Promise.all([
            fetchJson(`${TRAKT_API}/sync/playback?extended=full`, 1, 12000),
            nitroDown
              ? Promise.resolve([])
              : fetchJson(
                  `${TRAKT_API}/sync/progress/up_next_nitro?extended=full&images=poster,screenshot,fanart&limit=30&intent=continuing`,
                  1,
                  15000,
                ).catch((e) => ({ __error: String(e) })),
          ]);
          let upNext = upNextRaw;
          if (nitroDown) {
            dbg.upNextDegraded = "endpoint disabled (cached)";
          }
          if (
            upNext &&
            upNext.__error &&
            /HTTP 40[4]\b|HTTP 410\b/.test(String(upNext.__error))
          ) {
            dbg.upNextDegraded = String(upNext.__error);
            __nitroDownUntil = Date.now() + NITRO_DOWN_TTL_MS;
            upNext = [];
          }
          const pausedOk = Array.isArray(paused) ? paused : null;
          const upNextOk = Array.isArray(upNext) ? upNext : null;
          dbg.paused = pausedOk
            ? pausedOk.length
            : paused && paused.__error
              ? paused.__error
              : "null";
          dbg.upNext = upNextOk
            ? upNextOk.length
            : upNext && upNext.__error
              ? upNext.__error
              : "null";
          if (!pausedOk || !upNextOk) {
            const err =
              (paused && paused.__error) ||
              (upNext && upNext.__error) ||
              "partial fetch failed";
            return {
              __error: err,
              __cooling:
                (paused && paused.__cooling) ||
                (upNext && upNext.__cooling) ||
                undefined,
            };
          }
          return { paused: pausedOk, upNext: upNextOk };
        },
        cacheUser({
          ...(pbBypass
            ?
              { bypass: true, revalidate: true }
            : { revalidate: false, swr: false }),
          ttl: PLAYBACK_KV_TTL,
          sourceTracker: playbackSrc,
          lastGoodKey: CK.lastGood.playback(userKey),
          staleRetention: USER_SHORT_STALE_RETENTION,
        }),
      );
      try {
        const rawPaused =
          rawPb && Array.isArray(rawPb.paused) ? rawPb.paused : [];
        const rawUpNext =
          rawPb && Array.isArray(rawPb.upNext) ? rawPb.upNext : [];
        const userState2 = (await userStateP) || {
          droppedIds: [],
          watched: { ids: [], showLastAt: {} },
          hideMap: {},
        };
        const droppedSet = droppedStateToSet(userState2);
        const freshWatched = watchedStateToSet(userState2.watched);
        const hideMapRaw = userState2.hideMap || {};
        const hideMap =
          hideMapRaw &&
          typeof hideMapRaw === "object" &&
          !Array.isArray(hideMapRaw)
            ? hideMapRaw
            : {};

        let watchedMovieIds = null;
        try {
          watchedMovieIds = await getWatchedMovieIds(
            headers,
            env,
            ctx,
            userKey,
          ).catch(() => null);
        } catch {}

        playback = mergeContinueLists(
          rawPaused,
          rawUpNext,
          20,
          droppedSet,
          freshWatched,
          hideMap,
          null,
          watchedMovieIds,
        );
        const dbgPb = playbackSrc.debug || (playbackSrc.debug = {});
        dbgPb.rawPaused = rawPaused.length;
        dbgPb.rawUpNext = rawUpNext.length;
        dbgPb.merged = playback ? playback.length : 0;
        dbgPb.watchedCount = freshWatched ? freshWatched.size : null;
        dbgPb.watchedDataTs = (freshWatched && freshWatched.__dataTs) || null;
        dbgPb.droppedCount = droppedSet ? droppedSet.size : 0;
        dbgPb.hideCount = hideMap ? Object.keys(hideMap).length : 0;
        if (playback && playback.__skipStats) {
          dbgPb.skipStats = playback.__skipStats;
        }
        if (playback && playback.__autoUnhide && playback.__autoUnhide.length) {
          let changed = false;
          for (const sid of playback.__autoUnhide) {
            const k = String(sid);
            if (hideMap[k]) {

              delete hideMap[k];
              changed = true;
            }
          }
          if (changed) putCwHideMap(env, ctx, userKey, hideMap);
        }
        applyRewatchFlags(playback, freshWatched);
        dbgPb.items = playback.length;
        dbgPb.dropped = droppedSet ? droppedSet.size : 0;

        try {
          const nowTs = Date.now();
          const meta = { pauseUpdatedAt: nowTs, continueUpdatedAt: nowTs };
          kvRemember("cwmeta:" + userKey, { data: meta });

          if (!activityUnchanged) {
            kvPutJSON(
              env,
              ctx,
              "cwmeta:" + userKey,
              { data: meta },
              86400 * 14,
              false,
              true,
            );
          }
          Object.defineProperty(playback, "__cwMeta", {
            value: meta,
            enumerable: false,
          });
        } catch {}
        const todayBJ = new Date(Date.now() + BJ_OFFSET_MS)
          .toISOString()
          .slice(0, 10);

        let cal = await peekCalendarCached(todayBJ, env, userKey);
        const calRefresh = () =>
          getCalendarCached(
            todayBJ,
            headers,
            env,
            ctx,
            userKey,
            false,
            null,
          ).catch(() => null);
        if (!cal) {
          // 首次访问 / 周键轮换 / KV 过期清理时缓存为空：
          // 单独的 playback 请求同步补拉一次，part=all 则丢后台，避免抢限流额度
          if (part === "playback") cal = await calRefresh();
          else if (ctx && typeof ctx.waitUntil === "function")
            ctx.waitUntil(calRefresh());
        } else if (
          part === "playback" &&
          ctx &&
          typeof ctx.waitUntil === "function"
        ) {
          // 首页只读快照不会自己更新，这里让它按 TTL 在后台刷新，避免永远是旧日历
          ctx.waitUntil(calRefresh());
        }
        let localUpcoming = [];
        try {
          localUpcoming = calendarToLocalContinue(
            cal,
            Date.now(),
            droppedSet,
            freshWatched,
            hideMap,
          );
        } catch {}
        if (localUpcoming && localUpcoming.length) {
          playback = mergeContinueLists(
            playback,
            [],
            20,
            droppedSet,
            freshWatched,
            hideMap,
            localUpcoming,
            watchedMovieIds,
          );
        } else {
          const filtered = filterCwHiddenList(playback, hideMap);
          if (
            filtered &&
            filtered.__autoUnhide &&
            filtered.__autoUnhide.length
          ) {
            let changed = false;
            for (const sid of filtered.__autoUnhide) {
              const k = String(sid);
              if (hideMap[k]) {

                delete hideMap[k];
                changed = true;
              }
            }
            if (changed) putCwHideMap(env, ctx, userKey, hideMap);
          }
          playback = filtered;
        }
        if (Array.isArray(playback) && playback.length) {
          try {
            applyRewatchFlags(playback, freshWatched);
          } catch {}
        }
        if (Array.isArray(playback) && freshWatched) {
          const before = playback.length;
          playback = filterContinueEntries(playback, freshWatched);

          if (playback.length !== before && playbackSrc.debug) {
            playbackSrc.debug.postFilter = {
              before,
              after: playback.length,
            };
          }
        }
      } catch (e) {}
    });
  }
  if (wantHistory) {
    taskFns.push(async () => {
      history = await cachedJSON(
        env,
        ctx,
        CK.history(userKey, 1),
        async () => {
          const dbg = (historySrc.debug = {});
          if (isTraktRateLimited(userKey)) {
            dbg.rateLimited = true;
            dbg.cooling = traktRateLimitedRemaining(userKey);
            return {
              __error: "429 rate limited",
              __cooling: traktRateLimitedRemaining(userKey),
            };
          }
          const r = await fetchJson(
            `${TRAKT_API}/users/me/history?limit=${PAGE_SIZE}&page=1&extended=full&images=poster`,
          );
          if (r && r.__error) {
            dbg.error = r.__error;
            return r;
          }
          if (Array.isArray(r)) {
            dbg.items = r.length;
            dbg.pageCount = r.__pageCount || 1;
            return { items: r, pageCount: r.__pageCount || 1 };
          }
          dbg.items = "null";
          return r;
        },
        {
          ...opts({
            ...CACHE_USER_LONG,
            ttl: HISTORY_KV_TTL,
          }),
          bypass: !!(partsBypass && !activityUnchanged),
          revalidate: !activityUnchanged,
          swr:
            activityUnchanged || force
              ? false
              : Math.floor(HISTORY_KV_TTL * 0.4),
          sourceTracker: historySrc,
          lastGoodKey: CK.lastGood.history(userKey, 1),
          staleRetention: USER_SHORT_STALE_RETENTION,
        },
      );
    });
  }
  if (wantCalendar) {
    taskFns.push(async () => {
      calendar = await getCalendarCached(
        today,
        headers,
        env,
        ctx,
        userKey,

        !!(partsBypass && !activityUnchanged && !rateLimitedNow),
        calendarSrc,
      );
    });
  }
  if (wantWatchlist) {
    taskFns.push(async () => {
      try {
        const watchlistForce = !rateLimitedNow && (
        force || (partsBypass && !activityUnchanged)
      );
        watchlist = await getWatchlist(
          headers,
          "added",
          env,
          ctx,
          userKey,
          watchlistForce,
          watchlistSrc,
        );
      } catch (e) {
        watchlist = null;
      }
    });
  }
  if (wantMeta) {
    taskFns.push(async () => {
      profile = await cachedJSON(
        env,
        ctx,
        CK.profile(userKey),
        async () => {
          const p = await fetchJson(`${TRAKT_API}/users/me?extended=full`);
          return p && !p.__error ? p : null;
        },
        {
          ...opts(
            {
              ...CACHE_USER_META,
              ttl: PROFILE_KV_TTL,
            },
            false,
          ),
          sourceTracker: metaSrc,
        },
      );
    });
  }

  const concurrency = Math.min(5, Math.max(1, taskFns.length));
  const gapMs = 0;
  await runLimited(taskFns, concurrency, gapMs);
  const actSig = await actSigP.catch(() => null);

  if (wantPlayback) {
    const liveOk = playbackSrc.fromCache === false;
    const patch = {};

    if (liveOk) patch.at = Date.now();
    if (actSig && actSig.sig) patch.sig = actSig.sig;

    if (actSig && actSig.watchedAt) patch.watchedAt = actSig.watchedAt;
    if (Object.keys(patch).length) {
      try {
        const p = writeSyncState(env, ctx, userKey, patch, liveOk);
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch {}
    }
  }
  if (isTraktRateLimited(userKey)) {
    result.rateLimited = true;
    result.cooling = traktRateLimitedRemaining(userKey);
  } else {
    result.rateLimited = false;
    result.cooling = 0;
  }

  const liveSources = [
    playbackSrc,
    metaSrc,
    watchlistSrc,
    calendarSrc,
    historySrc,
  ];
  const anyLive = liveSources.some((s) => s && s.fromCache === false);
  const userUpdatedAt = anyLive ? Date.now() : null;
  if (userUpdatedAt) result.userUpdatedAt = userUpdatedAt;
  if (wantPlayback) {
    const pbList = Array.isArray(playback) ? playback : [];
    let pbHtml = "";
    try {
      if (pbList.length) {
        await attachContinueStillsForPlayback(pbList, env, ctx, userKey, {
          maxFetch: 20,
        });
        pbHtml = renderContinueItems(pbList, "hscroll");
      }
    } catch {}

    const pbEmptyHint = isTraktRateLimited(userKey)
      ? "Trakt 限流中，稍后会自动同步"
      : "";
    result.playbackHScrollHtml =
      pbHtml ||
      '<div class="empty" style="padding:50px 20px"><p style="margin:0;font-size:.92rem">' +
        (playback == null ? "继续观看加载失败，稍后重试" : "暂无继续观看") +
        "</p>" +
        (pbEmptyHint
          ? '<p style="margin:6px 0 0;font-size:.8rem;opacity:.6">' +
            pbEmptyHint +
            "</p>"
          : '<p style="margin:6px 0 0;font-size:.8rem;opacity:.6">在 Trakt 上标记看过之后会出现在这里</p>') +
        "</div>";
    result.playbackSource =
      playbackSrc.fromCache === true
        ? "cache"
        : playbackSrc.fromCache === false
          ? "live"
          : "";
    let playbackAgeSec = 0;
    let playbackDataTs = 0;
    let playbackTsSource = null;
    if (typeof playbackSrc.age === "number") {
      playbackAgeSec = playbackSrc.age || 0;
      playbackDataTs = Date.now() - playbackAgeSec * 1000;
      playbackTsSource = "age";
    }
    if (playbackSrc.fromCache === false && playbackSrc.age === 0) {
      playbackDataTs = Date.now();
      playbackAgeSec = 0;
      playbackTsSource = "live-write";
    }
    if (!playbackDataTs) {
      playbackDataTs = userUpdatedAt || Date.now();
      playbackAgeSec = Math.max(
        0,
        Math.round((Date.now() - playbackDataTs) / 1000),
      );
      playbackTsSource = "fallback";
    }
    result.playbackAgeSec = playbackAgeSec;
    result.playbackDataTs = playbackDataTs || null;
    result.playbackTsSource = playbackTsSource;

    const gotLive = playbackSrc.fromCache === false;
    const refreshFailed =
      !!(pbWantLive || force) && !gotLive && !!(playbackSrc.fromCache === true);
    if (gotLive) {

      pbLastCheckAt = Date.now();
    }
    const lastSyncAt = pbLastCheckAt || playbackDataTs || userUpdatedAt || null;
    result.pauseUpdatedAt = lastSyncAt;
    result.continueUpdatedAt = lastSyncAt;
    result.lastSyncAt = lastSyncAt;
    result.playbackDataTs = playbackDataTs || lastSyncAt || null;
    result.stale = refreshFailed;
    result.refreshFailed = refreshFailed;
    if (refreshFailed) {
      result.refreshError =
        (playbackSrc.debug &&
          (playbackSrc.debug.rateLimited
            ? "rate_limited"
            : playbackSrc.debug.error || playbackSrc.debug.paused || null)) ||
        "upstream_failed";
    }
    result.syncMeta = {
      lastSyncAt: lastSyncAt,
      dataTs: playbackDataTs || null,
      checkedAt: pbLastCheckAt || null,
      source: result.playbackSource || null,
      stale: refreshFailed,
      freshSec: PLAYBACK_FRESH_SEC,
    };
    if (url.searchParams.get("debug") === "1") {
      result.playbackDebug = {
        source: result.playbackSource || null,
        ageSec: result.playbackAgeSec,
        dataTs: result.playbackDataTs,
        tsSource: playbackTsSource,
        pauseUpdatedAt: result.pauseUpdatedAt,
        continueUpdatedAt: result.continueUpdatedAt,
        userUpdatedAt: userUpdatedAt || null,
        items: Array.isArray(playback) ? playback.length : null,
        lastActivity: actSig && actSig.playbackTs ? actSig.playbackTs : null,

        ...(playbackSrc.debug || {}),
      };
    }
  }
  if (wantMeta) {
    if (profile && !profile.__error && profile.ids && profile.ids.trakt) {
      rememberTraktUserId(auth, profile.ids.trakt);
    }
    let displayName =
      profile && !profile.__error
        ? profile.name || profile.username || ""
        : "";
    let avatarUrl = "",
      avatarAlts = [];
    try {
      const av = pickAvatar(profile);
      avatarUrl = av.url;
      avatarAlts = av.alts;
    } catch {}
    if (!displayName) {
      try {
        const hint = readProfileHint(request);
        if (hint && (hint.name || hint.username))
          displayName = hint.name || hint.username || "";
      } catch {}
    }
    if (displayName) result.name = displayName;
    result.avatar = avatarUrl || null;
    result.avatarAlt = avatarAlts;

    result.metaSource =
      metaSrc.fromCache === true
        ? "cache"
        : metaSrc.fromCache === false
          ? "live"
          : "";
    result.metaAgeSec = metaSrc.age || 0;
    try {
      const pname = displayName || "";
      const pavatar = avatarUrl || "";
      const hint = readProfileHint(request);
      if (!hint || hint.name !== pname || hint.avatar !== pavatar) {
        if (pname || pavatar)
          outHeaders.append(
            "Set-Cookie",
            buildProfileCookie({ name: pname, avatar: pavatar }),
          );
      }
    } catch {}
  }
  if (wantHistory) {
    try {
      const historyItems = Array.isArray(history)
        ? history
        : history && Array.isArray(history.items)
          ? history.items
          : null;
      await attachEntityPosters(
        historyItems,
        env,
        ctx,
        CK.histImages(userKey),
        20,
      ).catch(() => {});
      let historyPageCount = 1;
      if (history && !Array.isArray(history) && history.pageCount)
        historyPageCount = Number(history.pageCount) || 1;
      else if (historyItems && historyItems.__pageCount)
        historyPageCount = historyItems.__pageCount || 1;
      const historyHasMore =
        historyPageCount > 1 ||
        (Array.isArray(historyItems) && historyItems.length >= PAGE_SIZE);
      result.historyHtml = renderHistoryPage(historyItems, env);
      result.historyMoreHtml = historyHasMore
        ? `<div class="load-more-wrap"><button class="load-more" data-page="2" onclick="loadMoreHistory(this)">加载更多</button></div>`
        : "";
    } catch {
      result.historyHtml = emptyPaneHtml("暂时无法加载观看记录");
      result.historyMoreHtml = "";
    }
  }
  if (wantCalendar) {
    try {
      let calFiltered = calendar;
      if (Array.isArray(calendar) && calendar.length) {
        const droppedIds = await getDroppedShowIds(headers, env, ctx, userKey);
        if (droppedIds && droppedIds.size) {
          calFiltered = calendar.filter((it) => {
            const sid = it && it.show && it.show.ids && it.show.ids.trakt;
            return !(sid && droppedIds.has(Number(sid)));
          });
        }
      }
      await attachEntityPosters(
        calFiltered,
        env,
        ctx,
        CK.calImages(userKey),
        20,
      ).catch(() => {});
      await markCalendarFinales(calFiltered, env, ctx);
      result.calendarHtml = renderCalendarPage(calFiltered, env, {});
    } catch {
      result.calendarHtml = emptyPaneHtml("暂时无法加载追剧日历");
    }
  }
  if (wantWatchlist) {
    try {
      if (!Array.isArray(watchlist)) {
        result.watchlistHtml = emptyPaneHtml("暂时无法加载待看列表");
      } else if (!watchlist.length) {
        result.watchlistHtml = emptyWatchlistHtml();
      } else {
        const list = watchlist;
        await attachWatchlistStills(list, env, ctx, userKey, {
          maxFetch: WATCHLIST_PAGE_SIZE,
        });
        const firstPage = list.slice(0, WATCHLIST_PAGE_SIZE),
          hasMore = list.length > WATCHLIST_PAGE_SIZE,
          cardsHtml = renderWatchlistItems(firstPage, env),
          moreHtml = hasMore
            ? `<div class="load-more-wrap"><button class="load-more" data-page="2" data-sort="added" onclick="loadMoreWatchlist(this)">加载更多</button></div>`
            : "";
        result.watchlistHtml =
          `<div id="watchlist-grid" class="grid">${cardsHtml}</div>` + moreHtml;
      }
    } catch {
      result.watchlistHtml = emptyPaneHtml("暂时无法加载待看列表");
    }
  }
  if (wantWatchlist) {
    result.watchlistSource =
      watchlistSrc.fromCache === true
        ? "cache"
        : watchlistSrc.fromCache === false
          ? "live"
          : "";
    result.watchlistDebug = {
      source: result.watchlistSource || null,
      items: Array.isArray(watchlist) ? watchlist.length : null,
      ...(watchlistSrc.debug || {}),
    };
  }
  if (wantCalendar) {
    result.calendarSource =
      calendarSrc.fromCache === true
        ? "cache"
        : calendarSrc.fromCache === false
          ? "live"
          : "";
    result.calendarDebug = {
      source: result.calendarSource || null,
      items: Array.isArray(calendar) ? calendar.length : null,
      ...(calendarSrc.debug || {}),
    };
  }
  if (wantHistory) {
    result.historySource =
      historySrc.fromCache === true
        ? "cache"
        : historySrc.fromCache === false
          ? "live"
          : "";
    result.historyDebug = {
      source: result.historySource || null,
      items: Array.isArray(history)
        ? history.length
        : history && Array.isArray(history.items)
          ? history.items.length
          : null,
      pageCount:
        history && !Array.isArray(history) && history.pageCount
          ? history.pageCount
          : null,
      ...(historySrc.debug || {}),
    };
  }

  if (url.searchParams.get("debug") === "1") {
    result.kvStats = ctx && ctx.__kvStat ? ctx.__kvStat : null;
  }
  return jsonResp(result, outHeaders);
}
const HOME_PLATFORM_IDS = [
  "netflix",
  "disney",
  "hbomax",
  "appletv",
  "prime",
  "iqiyi",
  "youku",
  "tencent",
  "mgtv",
  "bilibili",
];
const THEATER_PLATFORMS = [
  {
    id: "X剧场",
    name: "X剧场",
    logo: "https://picui.ogmua.cn/s1/2026/10/26/6adece729dcad.webp",
  },
  {
    id: "迷雾剧场",
    name: "迷雾剧场",
    logo: "https://picui.ogmua.cn/s1/2026/10/26/6adece725757e.webp",
  },
  {
    id: "白夜剧场",
    name: "白夜剧场",
    logo: "https://picui.ogmua.cn/s1/2026/10/26/6adece7195f5a.webp",
  },
  {
    id: "正午阳光",
    name: "正午阳光",
    logo: "https://picui.ogmua.cn/s1/2026/10/26/6adece7452614.webp",
  },
  {
    id: "大家剧场",
    name: "大家剧场",
    logo: "https://picui.ogmua.cn/s1/2026/10/26/6adece757f1ff.webp",
  },
  {
    id: "微尘剧场",
    name: "微尘剧场",
    logo: "https://picui.ogmua.cn/s1/2026/10/26/6adece75743b9.webp",
  },
  {
    id: "恋恋剧场",
    name: "恋恋剧场",
    logo: "https://picui.ogmua.cn/s1/2026/10/26/6adece7551af6.webp",
  },
  {
    id: "生花剧场",
    name: "生花剧场",
    logo: "https://picui.ogmua.cn/s1/2026/10/26/6adece73ce3ac.webp",
  },
  {
    id: "板凳单元",
    name: "板凳单元",
    logo: "https://picui.ogmua.cn/s1/2026/10/26/6adece72a3dc6.webp",
  },
  {
    id: "小逗剧场",
    name: "小逗剧场",
    logo: "https://picui.ogmua.cn/s1/2026/10/26/6adece763f652.webp",
  },
  {
    id: "十分剧场",
    name: "十分剧场",
    logo: "https://picui.ogmua.cn/s1/2026/10/26/6adece76b8b4e.webp",
  },
  {
    id: "横屏短剧",
    name: "横屏短剧",
    logo: "https://picui.ogmua.cn/s1/2026/10/26/6adece7501e53.webp",
  },
  {
    id: "萤火单元",
    name: "萤火单元",
    logo: "https://picui.ogmua.cn/s1/2026/10/26/6adece733387d.webp",
  },
  {
    id: "悬疑剧",
    name: "悬疑剧",
    logo: "https://picui.ogmua.cn/s1/2026/10/26/6adece732b0ad.webp",
  },
];

function platformLogoSrc(p) {
  const t = encodeURIComponent(p.name || "");
  if (p.logo) {
    return "/logo?u=" + encodeURIComponent(p.logo) + "&t=" + t;
  }
  return "/logo?t=" + t;
}
function renderPlatformCard(p, extraAttr) {
  const attr = extraAttr || `data-platform-id="${esc(p.id)}"`;
  return `<button type="button" class="platform-card" ${attr} title="${esc(p.name)}"><div class="platform-card-left"><img class="platform-card-logo" src="${platformLogoSrc(p)}" alt="" loading="lazy" decoding="async"><span class="platform-card-name">${esc(p.name)}</span></div><div class="platform-card-right"><div class="platform-card-posters" data-plat-posters="${esc(p.id)}"><span class="platform-card-poster p0 platform-card-poster-ph"></span><span class="platform-card-poster p1 platform-card-poster-ph"></span><span class="platform-card-poster p2 platform-card-poster-ph"></span><span class="platform-card-poster p3 platform-card-poster-ph"></span></div></div></button>`;
}

function renderPlatformRows() {
  const cards = HOME_PLATFORM_IDS.map((id) => PLATFORMS[id]).filter(Boolean);
  return `<div class="platform-rows"><div class="platform-row"><div class="platform-cards">${cards.map((p) => renderPlatformCard(p)).join("")}</div></div></div>`;
}

function renderTheaterPlatformRows() {
  return `<div class="platform-rows theater-platform-rows"><div class="platform-row"><div class="platform-cards">${THEATER_PLATFORMS.map(
    (p) => renderPlatformCard(p, `data-theater-platform="${esc(p.id)}"`),
  ).join("")}</div></div></div>`;
}

function skRowHtml(n){
  var cards='';
  for(var i=0;i<(n||4);i++){
    cards+='<div class="sk-card" style="flex:0 0 92px">'
      +'<div class="sk sk-poster"></div>'
      +'<div class="sk sk-line w80"></div>'
      +'</div>';
  }
  return '<div class="sk-row" style="display:flex;gap:10px;overflow:hidden">'+cards+'</div>';
}
function skGridHtml(n){
  var cards='';
  for(var i=0;i<(n||6);i++){
    cards+='<div class="sk-card">'
      +'<div class="sk sk-poster"></div>'
      +'<div class="sk sk-line w80"></div>'
      +'<div class="sk sk-line w40"></div>'
      +'</div>';
  }
  return '<div class="sk-grid">'+cards+'</div>';
}
function renderHomeSkeleton(initialDetail, profileHint) {
  const boot = initialDetail
    ? `<script>window.addEventListener('load',()=>{const s=${jsStr(initialDetail)},idx=s.indexOf('/');if(idx>0)openDetail(s.slice(0,idx),s.slice(idx+1),false);});<\/script>`
    : "";
  const heroName =
    profileHint && (profileHint.name || profileHint.username)
      ? esc(profileHint.name || profileHint.username)
      : "…";
  const heroAvatarHtml =
    profileHint && profileHint.avatar
      ? `<img src="${esc(profileHint.avatar)}" alt="" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover;display:block">`
      : `<span class="hero-avatar-ph">👤</span>`;
  const section = (id, title, extraHtml) =>
    `<div class="home-section"><div class="home-section-head"><h2 class="home-section-title">${title}</h2><button class="home-more-btn" type="button" onclick="openListModal('${id}')"><span>查看更多</span><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button></div>${extraHtml || ""}<div class="h-scroll-wrap"><div class="h-scroll" id="${id}-hscroll"><div class="pane-loading has-sk" style="padding:10px 0">${skRowHtml(4)}</div></div></div></div>`;
  return `<div class="container"><div class="top-sticky"><header class="hero"><div class="hero-left"><button type="button" class="hero-avatar" id="hero-avatar" title="观看小结" aria-label="打开观看小结">${heroAvatarHtml}</button><div class="hero-text"><h1 class="hero-name" id="hero-name">${heroName}</h1><p class="updated-at" id="updated-at" title="最近一次有数据变化的更新"></p></div></div><div class="hero-actions"><button class="btn-action" id="btn-refresh" onclick="forceRefresh()" title="刷新观看数据（豆瓣/热榜/平台等按日缓存，到期自动更新）"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg><span>刷新</span></button><button class="btn-action" id="btn-theme" onclick="cycleTheme()" title="主题：深色" aria-label="切换主题：深色"><span class="theme-icon" id="theme-icon"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></span><span>主题</span></button><button class="btn-action" id="btn-logout" onclick="logout()" title="退出登录"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg><span>退出</span></button></div></header><!-- 累计统计在头像「观看小结」里 --></div><section id="playback" class="pane active">${section("playback", "继续观看")}<div class="home-section platform-section"><div class="home-section-head"><h2 class="home-section-title">流媒体平台</h2></div>${renderPlatformRows()}<div class="home-section theater-platform-section"><div class="home-section-head"><h2 class="home-section-title">平台剧场</h2></div>${renderTheaterPlatformRows()}</div>${section("guduo", "骨朵热榜", '<div class="theater-home-tabs" id="guduo-home-tabs" style="display:none"></div>')}${section("douban-domestic", "豆瓣热播国产剧")}${section("douban-jpkr", "豆瓣热播日韩剧")}${section("douban-western", "豆瓣热播欧美剧")}${section("douban-animation", "豆瓣热播动画")}${section("douban-variety", "豆瓣热播综艺")}${section("douban-documentary", "豆瓣热播纪录片")}</section><section id="watchlist" class="pane"><div class="pane-loading has-sk" style="padding:18px 0">${skGridHtml(6)}<div class="loading-note">正在加载待看</div></div></section><section id="calendar" class="pane"><div class="pane-loading has-sk" style="padding:18px 0">${skGridHtml(6)}<div class="loading-note">正在加载日历</div></div></section><section id="history" class="pane"><div class="grid"></div><div id="history-more"></div></section><section id="search" class="pane"><div class="search-bar"><input id="search-input" class="search-input" type="search" placeholder="搜索电影 / 剧集" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></div><div id="search-results" class="grid"></div></section><nav class="tabs"><i class="tab-pill" id="tab-pill" aria-hidden="true"></i><button class="tab active" data-tab="playback"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/></svg><span>首页</span></button><button class="tab" data-tab="calendar"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg><span>日历</span></button><button class="tab" data-tab="watchlist"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg><span>待看</span></button><button class="tab" data-tab="history"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg><span>记录</span></button><button class="tab" data-tab="search"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg><span>搜索</span></button></nav></div><div id="list-modal" class="list-modal"><div class="list-modal-backdrop" onclick="closeListModal()"></div><div class="list-modal-panel"><div class="list-modal-head"><h3 class="list-modal-title" id="list-modal-title"></h3><button type="button" class="list-modal-close" onclick="closeListModal()" aria-label="关闭">×</button></div><div class="list-modal-body" id="list-modal-body"></div></div></div><div id="summary-modal" class="summary-modal" role="dialog" aria-modal="true" aria-label="观看小结"><div class="summary-backdrop" onclick="window.__closeSummary()"></div><div class="summary-panel"><div class="summary-head"><h2 class="summary-title">观看小结</h2><button type="button" class="summary-close" onclick="window.__closeSummary()" aria-label="关闭">×</button></div><div id="summary-modal-body" class="summary-body"><div class="pane-loading has-sk" style="padding:18px 0">${skGridHtml(3)}<div class="loading-note">正在统计</div></div></div></div></div><div id="person-modal" class="person-modal"><div class="person-backdrop" onclick="closePerson()"></div><div class="person-panel"><div class="person-panel-head"><div class="person-panel-name" id="person-modal-name"></div><button class="person-close" onclick="closePerson()" aria-label="关闭">×</button></div><div class="person-panel-body" id="person-modal-body"></div></div></div><div id="confirm-modal" class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" style="display:none"><div class="confirm-backdrop"></div><div class="confirm-panel"><div class="confirm-icon" id="confirm-icon">?</div><div class="confirm-title" id="confirm-title"></div><div class="confirm-msg" id="confirm-msg"></div><div class="confirm-actions"><button class="confirm-btn confirm-cancel" id="confirm-cancel" type="button">取消</button><button class="confirm-btn confirm-ok" id="confirm-ok" type="button">确定</button></div></div></div><div id="modal" class="modal"><div class="modal-backdrop" onclick="closeDetail()"></div><div class="modal-panel"><div class="modal-shell"><button class="modal-close" onclick="closeDetail()" aria-label="关闭"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button><div class="modal-body" id="modal-body"></div></div></div></div><div id="show-cal-modal" class="show-cal-modal"><div class="show-cal-backdrop" onclick="closeShowCal()"></div><div class="show-cal-panel"><div class="show-cal-head"><div class="show-cal-name" id="show-cal-name"></div><button class="show-cal-close" onclick="closeShowCal()" aria-label="关闭">×</button></div><div class="show-cal-info" id="show-cal-info"></div><div class="show-cal-nav"><button onclick="calShiftMonth(-1)" aria-label="上个月">‹</button><div id="show-cal-month">—</div><button onclick="calShiftMonth(1)" aria-label="下个月">›</button></div><div class="show-cal-weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div><div class="show-cal-grid" id="show-cal-grid"></div><div class="show-cal-legend"><span class="legend-item"><i class="legend-dot legend-past"></i>已播出</span><span class="legend-item"><i class="legend-dot legend-today"></i>今天</span><span class="legend-item"><i class="legend-dot legend-future"></i>待播出</span></div><div class="show-cal-detail" id="show-cal-detail"></div></div></div><script src="/app.js?v=${APP_JS_VERSION}" defer><\/script>${boot}`;
}

async function handleDetailExtras(request, env, ctx) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const tmdbId = url.searchParams.get("tmdb");

  let imdbId = String(url.searchParams.get("imdb") || "").trim();
  if (/^\d+$/.test(imdbId)) imdbId = "tt" + imdbId.padStart(7, "0");
  imdbId = imdbId.toLowerCase();
  if (imdbId && !/^tt\d{1,12}$/.test(imdbId)) imdbId = "";
  if (!type || (type !== "movie" && type !== "show"))
    return new Response("bad params", { status: 400 });

  if (tmdbId && !/^\d{1,12}$/.test(tmdbId))
    return new Response("bad params", { status: 400 });
  const A = await authed(request, env, ctx);
  if (!A.ok) return A.response;
  const { auth, needsCookieUpdate } = A;
  const t = type === "movie" ? "movie" : "tv";
  const isMovie = type === "movie";
  const out = {};
  const jobs = [];
  if (tmdbId && env.TMDB_API_KEY) {
    jobs.push(
      tmdbDetailCached(
        `/${t}/${tmdbId}?append_to_response=credits,recommendations,external_ids`,
        env,
        ctx,
      )
        .then((d) => {
          out.tmdbFull = d;
        })
        .catch(() => {}),
    );
    jobs.push(
      fetchTmdbVideos(t, tmdbId, env, ctx)
        .then((v) => {
          out.videos = v;
        })
        .catch(() => {}),
    );
  }
  if (imdbId) {
    jobs.push(
      fetchOmdbRatings(imdbId, env, ctx)
        .then((r) => {
          out.omdb = r;
        })
        .catch(() => {}),
    );
  }
  await Promise.all(jobs);
  const tmdbFull = out.tmdbFull;

  if (!out.omdb && env.OMDB_API_KEY) {
    const fallbackImdb =
      (tmdbFull &&
        (tmdbFull.imdb_id ||
          (tmdbFull.external_ids && tmdbFull.external_ids.imdb_id))) ||
      null;
    if (fallbackImdb && String(fallbackImdb).toLowerCase() !== imdbId) {
      try {
        out.omdb = await fetchOmdbRatings(fallbackImdb, env, ctx);
      } catch {}
    }
  }
  const cast = (
    tmdbFull && tmdbFull.credits && Array.isArray(tmdbFull.credits.cast)
      ? tmdbFull.credits.cast
      : []
  ).slice(0, 20);
  const castHtml = cast
    .map((c) => {
      const pid = c.id ? String(c.id) : "";
      const personAttrs = pid
        ? ` data-person-id="${esc(pid)}" data-person-name="${esc(c.name || "")}" role="button" tabindex="0"`
        : "";
      const cls = "cast" + (pid ? " clickable" : "");
      return `<div class="${cls}"${personAttrs}>${c.profile_path ? `<img class="cast-img" src="${TMDB_IMG}/w342${c.profile_path}" loading="lazy" decoding="async" alt="">` : `<div class="cast-img cast-ph" aria-hidden="true"><svg class="cast-ph-icon" viewBox="0 0 24 24" width="40" height="40" fill="currentColor" aria-hidden="true"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v1.2c0 .7.5 1.2 1.2 1.2h16.8c.7 0 1.2-.5 1.2-1.2v-1.2c0-3.2-6.4-4.8-9.6-4.8z"/></svg></div>`}<div class="cast-name">${esc(c.name || "")}</div><div class="cast-role">${esc(c.character || "")}</div></div>`;
    })
    .join("");
  const videos =
    out.videos && Array.isArray(out.videos.results)
      ? out.videos.results
      : tmdbFull && tmdbFull.videos && Array.isArray(tmdbFull.videos.results)
        ? tmdbFull.videos.results
        : [];
  const trailers = videos.filter(
    (v) =>
      v &&
      v.site === "YouTube" &&
      v.key &&
      (v.type === "Trailer" || v.type === "Teaser"),
  );
  trailers.sort((a, b) => {
    const score = (v) =>
      (v.official ? 100 : 0) +
      (v.type === "Trailer" ? 50 : 0) +
      (v.iso_639_1 === "zh" ? 10 : 0) +
      (v.iso_639_1 === "en" ? 5 : 0);
    return score(b) - score(a);
  });
  const trailersHtml = trailers
    .slice(0, 4)
    .map((v) => {
      const name = v.name || (v.type === "Teaser" ? "先导预告" : "预告片");
      return `<div class="trailer-card" data-yt-key="${esc(v.key)}"><div class="trailer-frame"></div><img class="trailer-thumb" src="https://img.youtube.com/vi/${esc(v.key)}/hqdefault.jpg" loading="lazy" decoding="async" alt="" onerror="this.parentNode.classList.add('no-thumb')"><span class="trailer-play"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" stroke="none"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11.04-6.86a1 1 0 0 0 0-1.72L9.5 4.28A1 1 0 0 0 8 5.14z"/></svg></span><div class="trailer-name">${esc(name)}</div></div>`;
    })
    .join("");
  const recs = (
    tmdbFull &&
    tmdbFull.recommendations &&
    Array.isArray(tmdbFull.recommendations.results)
      ? tmdbFull.recommendations.results
      : []
  ).slice(0, 12);
  const recsHtml = recs
    .map((r, i) =>
      mediaItem({
        poster: tmdbPoster(r.poster_path),
        tag: isMovie ? "电影" : "剧集",
        tagClass: isMovie ? "movie" : "episode",
        title: r.title || r.name || "",
        line1: ((r.release_date || r.first_air_date || "") + "").slice(0, 4),
        delay: i * 20,
        detailType: isMovie ? "movie" : "show",
        detailId: "tmdb-" + r.id,
      }),
    )
    .join("");
  const tmdbRating =
    tmdbFull &&
    tmdbFull.vote_average != null &&
    Number(tmdbFull.vote_average) > 0
      ? Number(tmdbFull.vote_average)
      : null;
  const ratingsHtml =
    out.omdb || tmdbRating != null
      ? renderExtRatings(out.omdb, { tmdb: tmdbRating })
      : "";
  return authResp(
    auth,
    needsCookieUpdate,
    JSON.stringify({ castHtml, recsHtml, ratingsHtml, trailersHtml }),
    {
      contentType: "application/json; charset=utf-8",
      extra: {

        "Cache-Control": CC_NO_STORE,
      },
    },
  );
}

async function handlePerson(request, env, ctx) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id || !/^\d+$/.test(id))
    return new Response("bad params", { status: 400 });
  const A = await authed(request, env, ctx, { html: true });
  if (!A.ok) return A.response;
  const { auth, needsCookieUpdate } = A;
  if (!env.TMDB_API_KEY)
    return authResp(
      auth,
      needsCookieUpdate,
      emptyView({ text: "TMDB 未配置", error: true }),
      {
        status: 502,
      },
    );
  const person = await tmdbDetailCached(
    `/person/${id}?append_to_response=combined_credits,external_ids`,
    env,
    ctx,
  );
  if (!person)
    return authResp(
      auth,
      needsCookieUpdate,
      emptyView({ text: "加载失败，请稍后重试", error: true }),
      { status: 502 },
    );
  const name = person.name || "";
  const photo = person.profile_path
    ? `${TMDB_IMG}/w500${person.profile_path}`
    : null;
  const dept = person.known_for_department || "";
  const genderMap = { 1: "女", 2: "男" };
  const gender = genderMap[person.gender] || "";
  const birthday = person.birthday || "";
  const deathday = person.deathday || "";
  const place = person.place_of_birth || "";
  const bio = person.biography || "";
  const castCredits = [];
  const cc = person.combined_credits || {};
  if (Array.isArray(cc.cast)) {
    for (const c of cc.cast) {
      if (!c || !c.id) continue;
      const mt = c.media_type;
      if (mt !== "movie" && mt !== "tv") continue;
      castCredits.push(c);
    }
  }
  castCredits.sort((a, b) => {
    const da = a.release_date || a.first_air_date || "";
    const db = b.release_date || b.first_air_date || "";
    return String(db).localeCompare(String(da));
  });
  const creditsHtml = castCredits
    .slice(0, 30)
    .map((c, i) => {
      const isMovie = c.media_type === "movie";
      const title = isMovie
        ? c.title || c.original_title || ""
        : c.name || c.original_name || "";
      const year = ((c.release_date || c.first_air_date || "") + "").slice(
        0,
        4,
      );
      const poster = c.poster_path ? tmdbPoster(c.poster_path) : null;
      const role = c.character || "";
      return mediaItem({
        poster,
        tag: isMovie ? "电影" : "剧集",
        tagClass: isMovie ? "movie" : "episode",
        title,
        line1: year,
        line2: role,
        delay: Math.min(i, 24) * 20,
        detailType: isMovie ? "movie" : "show",
        detailId: "tmdb-" + c.id,
      });
    })
    .join("");
  const rows = [];
  if (dept) rows.push(`<div class="person-row"><b>职业</b>${esc(dept)}</div>`);
  if (gender)
    rows.push(`<div class="person-row"><b>性别</b>${esc(gender)}</div>`);
  if (birthday)
    rows.push(
      `<div class="person-row"><b>生日</b>${esc(birthday)}${deathday ? " — " + esc(deathday) : ""}</div>`,
    );
  if (place)
    rows.push(`<div class="person-row"><b>出生地</b>${esc(place)}</div>`);
  const html = `<div class="person-head">${photo ? `<img class="person-photo" src="${photo}" alt="">` : `<div class="person-photo person-photo-ph" aria-hidden="true"><svg class="cast-ph-icon" viewBox="0 0 24 24" width="40" height="40" fill="currentColor" aria-hidden="true"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v1.2c0 .7.5 1.2 1.2 1.2h16.8c.7 0 1.2-.5 1.2-1.2v-1.2c0-3.2-6.4-4.8-9.6-4.8z"/></svg></div>`}<div class="person-info"><div class="person-name">${esc(name)}</div>${rows.length ? `<div class="person-rows">${rows.join("")}</div>` : ""}</div></div>${bio ? `<div class="person-bio">${esc(bio)}</div>` : ""}${creditsHtml ? `<div class="person-credits-title">参演作品</div><div class="grid">${creditsHtml}</div>` : '<p class="person-sub">暂无参演作品信息</p>'}`;
  return authResp(auth, needsCookieUpdate, html, {

    extra: { "Cache-Control": CC_NO_STORE },
  });
}

async function handleSeason(request, env, ctx) {
  const url = new URL(request.url),
    showId = url.searchParams.get("show") || "",
    seasonNum = parseInt(url.searchParams.get("season") || "0"),
    tmdbId = url.searchParams.get("tmdb"),
    slug = url.searchParams.get("slug") || "",
    forceSeason = url.searchParams.get("force") === "1";
  if (isNaN(seasonNum) || (!showId && !tmdbId))
    return new Response("bad params", { status: 400 });
  if (tmdbId && !/^\d{1,12}$/.test(tmdbId))
    return new Response("bad params", { status: 400 });
  const A = await authed(request, env, ctx, { html: true, strict: true });
  if (!A.ok) return A.response;
  const { auth, headers, needsCookieUpdate, userKey } = A;

  const kvCoolingSec = await syncTraktCooldownFromKV(env, userKey);
  const rateLimitedNow = kvCoolingSec > 0 || isTraktRateLimited(userKey);
  let validShowId = !!(showId && /^\d+$/.test(showId));

  if (!validShowId && tmdbId) {
    try {
      const resolved = await cachedJSON(
        env,
        ctx,
        CK.traktSearch("show", tmdbId),
        async () => {
          const arr = await traktGet(
            `${TRAKT_API}/search/tmdb/${tmdbId}?type=show`,
            headers,
            2,
            userKey,
          );
          if (!Array.isArray(arr) || !arr.length) return null;
          return (
            (arr[0].show && arr[0].show.ids && arr[0].show.ids.trakt) || null
          );
        },
        { ttl: ENTITY_KV_TTL, missTtl: 120, swr: 3600, userKey },
      );
      if (resolved != null && /^\d+$/.test(String(resolved))) {
        showId = String(resolved);
        validShowId = true;
      }
    } catch {}
  }

  const freshProgressP =
    validShowId && !rateLimitedNow
      ? __activityDiffers(headers, env, ctx, userKey).catch(() => false)
      : Promise.resolve(false);
  const dirtyAtP = progressDirtyAt(env, userKey);
  const progTracker = { fromCache: null, age: 0 };
  const [progress, traktSeason, tmdbSeason, watchedEpIds] = await Promise.all([
    validShowId
      ? (async () => {
          const freshProgress = await freshProgressP;
          return cachedJSON(
            env,
            ctx,
            CK.watchProgress(userKey, showId),
            async () => {
              const r = await traktGet(
                `${TRAKT_API}/shows/${showId}/progress/watched?hidden=false&specials=false`,
                headers,
                2,
                userKey,
              );
              return r && !r.__error ? r : null;
            },
            {

              ttl: 86400,
              missTtl: 60,
              swr: 0,
              jitter: 300,
              userKey,
              sourceTracker: progTracker,
              lastGoodKey: CK.lastGood.watchProgress(userKey, showId),
              staleRetention: USER_SHORT_STALE_RETENTION,

              ...((freshProgress || forceSeason || (await dirtyAtP) > 0) &&
              !rateLimitedNow
                ? { bypass: true }
                : {}),
            },
          );
        })()
      : Promise.resolve(null),
    validShowId
      ? cachedJSON(
          env,
          ctx,
          CK.season(showId, seasonNum),
          async () => {
            const r = await traktGet(
              `${TRAKT_API}/shows/${showId}/seasons/${seasonNum}?extended=full,episodes`,
              headers,
              2,
              userKey,
            );
            return r && !r.__error ? r : null;
          },
          {
            ttl: seasonTtl,
            missTtl: 60,
            swr: 3600,
            jitter: 300,
          },
        )
      : Promise.resolve(null),
    tmdbId && env.TMDB_API_KEY
      ? tmdbDetailCached(`/tv/${tmdbId}/season/${seasonNum}`, env, ctx)
      : Promise.resolve(null),

    (async () => {
      const fresh = await freshProgressP;
      return getWatchedEpisodeIds(
        headers,
        env,
        ctx,
        userKey,
        !!forceSeason || !!fresh,
      ).catch(() => null);
    })(),
  ]);
  if (progTracker.fromCache === false) clearProgressDirty(env, ctx, userKey);

  const seasonProgress = Array.isArray(progress && progress.seasons)
    ? progress.seasons.find((s) => Number(s.number) === Number(seasonNum))
    : null;
  const traktEpisodes =
    traktSeason && Array.isArray(traktSeason.episodes)
      ? traktSeason.episodes
      : Array.isArray(traktSeason)
        ? traktSeason
        : [];
  return authResp(
    auth,
    needsCookieUpdate,
    renderSeasonEpisodes(
      seasonProgress,
      tmdbSeason,
      seasonNum,
      slug,
      traktEpisodes,
      tmdbId,
      watchedEpIds,
      progress,
      validShowId ? showId : null,

      rateLimitedNow && !seasonProgress && !watchedEpIds,
    ),
    { extra: { "Cache-Control": CC_NO_STORE } },
  );
}

async function handleWatchDiag(request, env, ctx) {
  const url = new URL(request.url);
  const showParam = url.searchParams.get("show") || "";
  const tmdbId = url.searchParams.get("tmdb") || "";
  const seasonNum = parseInt(url.searchParams.get("season") || "1", 10);
  const wantLive = url.searchParams.get("live") === "1";
  const A = await authed(request, env, ctx, { strict: true });
  if (!A.ok) return A.response;
  const { headers, userKey } = A;
  const kvCooling = await syncTraktCooldownFromKV(env, userKey);
  const coolingSec =
    kvCooling > 0 ? kvCooling : traktRateLimitedRemaining(userKey);
  let traktId = /^\d+$/.test(showParam) ? showParam : null;
  if (!traktId && /^\d{1,12}$/.test(tmdbId)) {
    const arr = await traktGet(
      `${TRAKT_API}/search/tmdb/${tmdbId}?type=show`,
      headers,
      1,
      userKey,
    );
    if (Array.isArray(arr) && arr[0] && arr[0].show && arr[0].show.ids) {
      traktId = String(arr[0].show.ids.trakt);
    }
  }

  const authInfo = {
    hasToken: !!rawTok,
    scheme: bearer ? bearer.split(/\s+/)[0] : null,
    tokenFp: rawTok ? `${rawTok.slice(0, 6)}…${rawTok.slice(-4)}` : null,
    flaggedInvalid: tokenIsKnownBad(rawTok),
    expiresInSec:
      A.auth && A.auth.expires_at
        ? Math.round((A.auth.expires_at - Date.now()) / 1000)
        : null,
    userKey: userKey || null,
  };

  const budgetInfo = traktBudgetStats(userKey);
  const out = {
    userKey: userKey || null,
    coolingSec,
    traktId,
    tmdbId: tmdbId || null,
    season: seasonNum,
    auth: authInfo,
    budget: budgetInfo,
    kv: {},
    trakt: null,
    watchedList: null,
    verdict: [],
  };
  const readKv = async (key) => {
    try {
      return await env.TMDB_CACHE.get(key, { type: "json" });
    } catch {
      return null;
    }
  };

  if (traktId) {
    const raw = await readKv(CK.watchProgress(userKey, traktId));
    if (raw && !raw.miss) {
      const d = raw.data !== undefined ? raw.data : raw;
      out.kv.progress = {
        present: true,
        ageSec: raw._ts ? Math.round((Date.now() - raw._ts) / 1000) : null,
        aired: d && d.aired,
        completed: d && d.completed,
        seasonCount: d && Array.isArray(d.seasons) ? d.seasons.length : 0,
      };
    } else {
      out.kv.progress = { present: false, miss: raw ? !!raw.miss : null };
    }
    const lg = await readKv(CK.lastGood.watchProgress(userKey, traktId));
    out.kv.progressLastGood = lg
      ? {
          present: true,
          ageSec: lg._ts ? Math.round((Date.now() - lg._ts) / 1000) : null,
          completed: lg.data && lg.data.completed,
        }
      : { present: false };
  }

  const weRaw = await readKv(CK.watchedEpisodes(userKey));
  if (weRaw && !weRaw.miss) {
    const d = weRaw.data !== undefined ? weRaw.data : weRaw;
    const ids = Array.isArray(d) ? d : (d && d.ids) || [];
    const byShow = (d && d.byShow) || {};
    const showMap = traktId ? byShow[String(traktId)] : null;
    out.kv.watched = {
      present: true,
      ageSec: weRaw._ts ? Math.round((Date.now() - weRaw._ts) / 1000) : null,
      idCount: ids.length,
      hasByShow: !!showMap,
      seasonKeys: showMap ? Object.keys(showMap).slice(0, 40) : [],
      seasonEps: showMap
        ? Object.keys(
            showMap[String(seasonNum)] || showMap[seasonNum] || {},
          ).slice(0, 200)
        : [],
    };
  } else {
    out.kv.watched = { present: false, miss: weRaw ? !!weRaw.miss : null };
  }
  const weLg = await readKv(CK.lastGood.watchedEpisodes(userKey || "anon"));
  out.kv.watchedLastGood = weLg
    ? {
        present: true,
        ageSec: weLg._ts ? Math.round((Date.now() - weLg._ts) / 1000) : null,
        idCount: weLg.data && Array.isArray(weLg.data.ids) ? weLg.data.ids.length : null,
      }
    : { present: false };

  if (traktId) {
    const r = await traktGet(
      `${TRAKT_API}/shows/${traktId}/progress/watched?hidden=false&specials=false`,
      headers,
      1,
      userKey,
    );
    if (r && !r.__error) {
      const seasons = Array.isArray(r.seasons) ? r.seasons : [];
      const sp = seasons.find((s) => Number(s.number) === Number(seasonNum));
      out.trakt = {
        aired: r.aired,
        completed: r.completed,
        last_watched_at: r.last_watched_at || null,
        seasonCount: seasons.length,
        seasonNumbers: seasons.map((s) => s.number).slice(0, 60),
        seasonHit: !!sp,
        seasonCompleted: sp ? sp.completed : null,
        seasonAired: sp ? sp.aired : null,
        seasonEpisodes: sp && Array.isArray(sp.episodes) ? sp.episodes.length : 0,
      };
    } else {
      out.trakt = { error: (r && r.__error) || "empty", cooling: r && r.__cooling };
    }
  }
  if (wantLive && traktId) {
    const epRes = await fetchT(`${TRAKT_API}/sync/watched/episodes`, { headers }, 20000).catch(() => null);
    if (epRes && epRes.ok) {
      const arr = await epRes.json().catch(() => null);
      if (Array.isArray(arr)) {
        const mine = arr.filter(
          (w) => w && w.show && w.show.ids && String(w.show.ids.trakt) === String(traktId),
        );
        out.watchedList = {
          totalEpisodes: arr.length,
          thisShowEpisodes: mine.length,
          thisSeasonEps: mine
            .filter((w) => Number(w.episode && w.episode.season) === Number(seasonNum))
            .map((w) => w.episode && w.episode.number)
            .slice(0, 200),
        };
      }
    } else if (epRes) {
      out.watchedList = { error: "HTTP " + epRes.status };
    }
  }

  const v = out.verdict;
  if (out.auth && !out.auth.hasToken)
    v.push(
      "当前请求没带 OAuth Token → Trakt 按 Client ID + 出口 IP 计限流（共享池，极小），需要重新登录拿 token",
    );
  else if (out.auth && out.auth.flaggedInvalid)
    v.push(
      "当前 token 刚被 Trakt 判过 401，已登记为失效：下一个请求会强制刷新，期间不再用坏 token 发请求（避免继续消耗共享池额度）",
    );
  else if (out.auth && out.auth.expiresInSec != null && out.auth.expiresInSec < 0)
    v.push(
      `token 已过期 ${-out.auth.expiresInSec}s，下次请求会先刷新再发；刷新失败则会短暂退回未认证请求`,
    );
  if (out.budget && out.budget.throttled)
    v.push(
      `主动限速闸门已触发（本窗口已用 ${out.budget.userUsed}/${out.budget.userMax}）→ 本轮不再发新请求，直接读缓存。这不是被 Trakt 限流，是我们自己压住的量`,
    );
  else if (out.budget && out.budget.userUsed > out.budget.userMax * 0.7)
    v.push(
      `请求预算已用到 ${out.budget.userUsed}/${out.budget.userMax}（60 秒窗口），接近闸门；再频繁操作会被主动降速`,
    );
  if (out.budget && out.budget.nitroDownFor > 0)
    v.push(
      `up_next_nitro 端点已被判定不可用，还有 ${out.budget.nitroDownFor}s 不再请求它（继续观看由 /sync/playback 支撑）`,
    );
  if (coolingSec > 0)
    v.push(
      `正在 429 冷却（剩 ${coolingSec}s），此刻所有 Trakt 请求被短路；KV 里若没有可用副本就会显示未看`,
    );
  if (!out.kv.progress || !out.kv.progress.present)
    v.push(
      "KV 里没有这部剧的进度副本（tpr）→ 被写操作删除或 TTL 过期，必须回源；回源失败即空",
    );
  else if (out.kv.progress.ageSec > 1800 + 300)
    v.push(`KV 里的 tpr 已存 ${out.kv.progress.ageSec}s，超过 30 分钟法定 TTL，下次读取必然回源`);
  if (!out.kv.watched.present)
    v.push(
      "KV 里没有已看集清单（we）→ 它 TTL 只有 15 分钟且每次标记已看后必删，回源失败即空",
    );
  if (out.trakt && !out.trakt.error) {
    if (Number(out.trakt.aired) === 0 && Number(out.trakt.completed) > 0)
      v.push(
        `Trakt 返回 aired=0 但 completed=${out.trakt.completed}：渲染层的 "aired > 0" 门槛会把它判成「尚未观看」——这是纯前端判定 bug，与风控无关`,
      );
    if (Number(out.trakt.completed) === 0 && Number(out.trakt.aired) > 0)
      v.push("Trakt 自己就认为 completed=0：记录确实没同步到 Trakt，去 trakt.tv 上核对");
    if (!out.trakt.seasonHit && out.trakt.seasonCount > 0)
      v.push(
        `第 ${seasonNum} 季在 progress 里找不到（Trakt 有 ${out.trakt.seasonNumbers.join(",")}）：季号对不上，只能靠已看清单兜底`,
      );
  }
  if (out.kv.watched.present && out.kv.watched.hasByShow && !out.kv.watched.seasonEps.length)
    v.push("已看清单里有这部剧、但这一季没有任何集号 → 该季确实没标记过，或季号编码不一致");
  if (!v.length) v.push("未发现明显断点：KV 有数据且 Trakt 也有记录，若界面仍不显示，查季号/集号与 TMDB 的对应关系");
  return new Response(JSON.stringify(out, null, 2), {
    headers: { "Content-Type": CT_JSON, "Cache-Control": CC_NO_STORE },
  });
}

async function handleApiDetail(request, env, ctx) {
  try {
    const url = new URL(request.url),
      type = url.searchParams.get("type"),
      rawId = url.searchParams.get("id"),
      forceDetail = url.searchParams.get("force") === "1";
    if (!type || !rawId || (type !== "movie" && type !== "show"))
      return new Response("bad params", { status: 400 });
    const A = await authed(request, env, ctx, { html: true, strict: true });
    if (!A.ok) return A.response;
    const { auth, headers, needsCookieUpdate, userKey } = A;
    const errResponse = (msg, status) =>
      authResp(auth, needsCookieUpdate, emptyView({ text: msg, error: true }), {
        status,
      });
    let traktId = null,
      tmdbIdHint = null;
    if (rawId.startsWith("tmdb-")) {
      const hint = rawId.slice(5);

      if (/^\d{1,12}$/.test(hint)) tmdbIdHint = hint;
      else return errResponse("参数无效", 400);
    } else if (/^\d+$/.test(rawId)) traktId = rawId;
    else return errResponse("参数无效", 400);
    const t = type === "movie" ? "movie" : "tv";

    const kvCoolingSec = await syncTraktCooldownFromKV(env, userKey);
    const rateLimitedNow =
      kvCoolingSec > 0 || isTraktRateLimited(userKey);

    const actDiffP =
      type === "show" && traktId && !rateLimitedNow
        ? __activityDiffers(headers, env, ctx, userKey).catch(() => false)
        : Promise.resolve(false);
    const entityP = traktId
      ? cachedJSON(
          env,
          ctx,
          CK.entity(type, traktId),
          async () => {
            const r = await traktGet(
              `${TRAKT_API}/${type}s/${traktId}?extended=full,images`,
              headers,
              2,
              userKey,
            );
            return r && !r.__error ? r : null;
          },
          {
            ttl: ENTITY_KV_TTL,
            missTtl: 60,
            swr: 3600,
            jitter: 300,
          },
        )
      : Promise.resolve(null);
    const resolvedP =
      !traktId && tmdbIdHint
        ? cachedJSON(
            env,
            ctx,
            CK.traktSearch(type, tmdbIdHint),
            async () => {
              const arr = await traktGet(
                `${TRAKT_API}/search/tmdb/${tmdbIdHint}?type=${type}`,
                headers,
                2,
                userKey,
              );
              if (!Array.isArray(arr) || !arr.length) return null;
              const key = type === "movie" ? "movie" : "show";
              return (
                (arr[0][key] && arr[0][key].ids && arr[0][key].ids.trakt) ||
                null
              );
            },
            { ttl: ENTITY_KV_TTL, missTtl: 120, swr: 3600 },
          )
        : Promise.resolve(null);
    let [entity, resolvedTraktId] = await Promise.all([entityP, resolvedP]);
    if (resolvedTraktId) traktId = String(resolvedTraktId);
    const tmdbId =
      (entity && entity.ids && entity.ids.tmdb) || tmdbIdHint || null;
    const tmdbBasicP =
      tmdbId && env.TMDB_API_KEY
        ? tmdbDetailCached(
            `/${t}/${tmdbId}?append_to_response=external_ids`,
            env,
            ctx,
          )
        : Promise.resolve(null);

    const dirtyAtP = progressDirtyAt(env, userKey);
    const progTracker = { fromCache: null, age: 0 };
    const userProgressP =
      type === "show" && traktId
        ? (async () =>
            cachedJSON(
              env,
              ctx,
              CK.watchProgress(userKey, traktId),
              async () => {

                let pending = null;
                try {
                  pending = await readPendingWatched(env, userKey);
                } catch {}
                const pendingFresh =
                  pending &&
                  pending.at &&
                  Date.now() - Number(pending.at) < 120000;
                if (pendingFresh) {

                  try {
                    const raw = await env.TMDB_CACHE.get(
                      CK.watchProgress(userKey, traktId),
                      { type: "json" },
                    );
                    const prev =
                      raw && !raw.miss
                        ? raw.data !== undefined
                          ? raw.data
                          : raw
                        : null;
                    if (prev) {
                      return mergeProgressWithPending(prev, pending, traktId);
                    }
                  } catch {}
                }
                const r = await traktGet(
                  `${TRAKT_API}/shows/${traktId}/progress/watched?hidden=false&specials=false`,
                  headers,
                  2,
                  userKey,
                );
                if (!r || r.__error) return null;
                try {
                  if (!pending) pending = await readPendingWatched(env, userKey);
                  return mergeProgressWithPending(r, pending, traktId);
                } catch {
                  return r;
                }
              },
              {

              ttl: 86400,
              missTtl: 60,
              swr: 0,
              jitter: 300,
              userKey,
              sourceTracker: progTracker,
                lastGoodKey: CK.lastGood.watchProgress(userKey, traktId),
                staleRetention: USER_SHORT_STALE_RETENTION,

                ...((forceDetail ||
                  (await progressDirtyAtShow(env, userKey, traktId)) > 0) &&
                !rateLimitedNow
                  ? { bypass: true }
                  : {}),
              },
            ))()
        : Promise.resolve(null);

    const pausedListP =
      type === "show" && traktId && !rateLimitedNow
        ? cachedJSON(
            env,
            ctx,
            CK.playbackList(userKey),
            async () => {
              if (isTraktRateLimited(userKey)) return { __error: "429 cooling" };
              const r = await traktGet(

                `${TRAKT_API}/sync/playback/episodes?limit=100`,
                headers,
                2,
                userKey,
              );
              return Array.isArray(r) ? r : null;
            },

            {
              ttl: 3600,
              missTtl: 300,
              swr: 0,
              jitter: 300,
              userKey,
              staleRetention: USER_SHORT_STALE_RETENTION,
            },
          )
        : Promise.resolve(null);
    const movieHistoryP =
      type === "movie" && traktId
        ? cachedJSON(
            env,
            ctx,
            CK.movieHistory(userKey, traktId),
            async () => {
              try {
                const pending = await readPendingWatched(env, userKey);
                if (
                  pending &&
                  Array.isArray(pending.movieIds) &&
                  pending.movieIds.map(Number).includes(Number(traktId))
                ) {
                  return [
                    {
                      watched_at: new Date(
                        Number(pending.at) || Date.now(),
                      ).toISOString(),
                    },
                  ];
                }
              } catch {}
              const r = await traktGet(
                `${TRAKT_API}/sync/history/movies/${traktId}?limit=1`,
                headers,
                2,
                userKey,
              );
              if (!r || r.__error) return null;

              try {
                const pending = await readPendingWatched(env, userKey);
                if (
                  pending &&
                  Array.isArray(pending.movieIds) &&
                  pending.movieIds.map(Number).includes(Number(traktId)) &&
                  (!Array.isArray(r) || !r.length)
                ) {
                  return [
                    {
                      watched_at: new Date(
                        Number(pending.at) || Date.now(),
                      ).toISOString(),
                    },
                  ];
                }
              } catch {}
              return r;
            },
            { ttl: 1800, missTtl: 60, swr: 0, jitter: 180 },
          )
        : Promise.resolve(null);

    const wlHint =
      (entity && entity.ids && entity.ids.tmdb) || tmdbIdHint || null;
    const wlIdsP =
      wlHint != null
        ? getWatchlistTmdbIds(
            headers,
            env,
            ctx,
            userKey,
            type === "movie" ? "movies" : "shows",
          ).catch(() => [])
        : Promise.resolve(null);
    const [tmdbBasic, userProgress, movieHistory, pausedList, watchedEpIds] =
      await Promise.all([
        tmdbBasicP,
        userProgressP,
        movieHistoryP,
        pausedListP,

        (async () => {
          const fresh = await actDiffP;
          return getWatchedEpisodeIds(
            headers,
            env,
            ctx,
            userKey,
            !!forceDetail || !!fresh,
          ).catch(() => null);
        })(),
      ]);

    if (progTracker.fromCache === false) {
      clearProgressDirty(env, ctx, userKey);
      try {
        if (traktId) clearProgressDirtyShow(env, ctx, userKey, traktId);
      } catch {}

      const baseP = (async () => {
        try {
          const cur = await getUserActivitySig(headers, env, ctx, userKey);
          if (!cur || !cur.sig) return;
          const patch = { sig: cur.sig };
          if (cur.watchedAt) patch.watchedAt = cur.watchedAt;
          await writeSyncState(env, ctx, userKey, patch, true);
        } catch {}
      })();
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(baseP);
    }
    const pausedEntry = pickPausedShowEntry(pausedList, traktId);
    let pausedIsRewatch = false;
    if (
      pausedEntry &&
      pausedEntry.episode &&
      pausedEntry.episode.ids &&
      pausedEntry.episode.ids.trakt != null &&
      watchedEpIds
    ) {
      pausedIsRewatch = watchedEpIds.has(Number(pausedEntry.episode.ids.trakt));
    }
    if (!entity && !tmdbBasic) {
      return errResponse(
        isTraktRateLimited(userKey)
          ? "Trakt 限流中，请稍后重试"
          : "加载失败，请稍后重试",
        502,
      );
    }
    if (!entity) {
      const genres =
        tmdbBasic && Array.isArray(tmdbBasic.genres)
          ? tmdbBasic.genres.map((g) => g.name)
          : [];
      entity = {
        title: (tmdbBasic && (tmdbBasic.title || tmdbBasic.name)) || "",
        year: (
          ((tmdbBasic && tmdbBasic.release_date) ||
            (tmdbBasic && tmdbBasic.first_air_date) ||
            "") + ""
        ).slice(0, 4),
        overview: (tmdbBasic && tmdbBasic.overview) || "",
        runtime: (tmdbBasic && tmdbBasic.runtime) || null,
        rating: null,
        tagline: (tmdbBasic && tmdbBasic.tagline) || "",
        genres,
        ids: {
          tmdb: (tmdbBasic && tmdbBasic.id) || null,
          trakt: null,
          slug: null,
          imdb:
            (tmdbBasic &&
              (tmdbBasic.imdb_id ||
                (tmdbBasic.external_ids && tmdbBasic.external_ids.imdb_id))) ||
            null,
        },
      };
    }
    let movieWatched = null;
    if (Array.isArray(movieHistory) && movieHistory.length) {
      const h = movieHistory[0];
      movieWatched = { last_watched_at: h.watched_at, plays: null };
    }
    let inWatchlist = false;
    const wlTmdbId =
      (tmdbBasic && tmdbBasic.id) ||
      (entity && entity.ids && entity.ids.tmdb) ||
      null;
    if (wlTmdbId != null) {
      try {
        const ids = await wlIdsP;
        const want = Number(wlTmdbId);
        inWatchlist = Array.isArray(ids) && ids.some((x) => Number(x) === want);
      } catch {}
    }
    let initialSeasonNum = null;
    if (type === "show") {
      const pe = pausedEntry && pausedEntry.episode;
      if (pe && pe.season != null) initialSeasonNum = pe.season;
    }
    if (type === "show" && userProgress && initialSeasonNum == null) {
      if (userProgress.next_episode && userProgress.next_episode.season)
        initialSeasonNum = userProgress.next_episode.season;
      else if (Array.isArray(userProgress.seasons)) {
        const w = userProgress.seasons.filter((s) => s.completed > 0);
        if (w.length) initialSeasonNum = w[w.length - 1].number;
      }
    }
    if (
      initialSeasonNum == null &&
      tmdbBasic &&
      tmdbBasic.seasons &&
      tmdbBasic.seasons.length
    ) {
      const real = tmdbBasic.seasons.filter((s) => s.season_number > 0);
      if (real.length) initialSeasonNum = real[0].season_number;
    }
    const imdbId =
      (tmdbBasic &&
        (tmdbBasic.imdb_id ||
          (tmdbBasic.external_ids && tmdbBasic.external_ids.imdb_id))) ||
      (entity.ids && entity.ids.imdb) ||
      null;
    let bodyHtml;
    try {
      bodyHtml = renderDetailFragment({
        type,
        entity,
        traktId,
        userProgress,
        pausedEntry,
        pausedIsRewatch,
        movieWatched,
        tmdb: tmdbBasic,
        credits: null,
        recommendations: null,
        initialSeasonNum,
        initialSeasonData: null,
        initialTraktEpisodes: [],
        thirdParty: null,
        inWatchlist,
        wlTmdbId,
        imdbId,
        deferExtras: true,
        watchedEpIds,

        progressUnknown:
          type === "show" && !!traktId && !userProgress && rateLimitedNow,
        coolingSec: rateLimitedNow
          ? traktRateLimitedRemaining(userKey)
          : 0,
      });
    } catch (renderErr) {

      const dbg =
        new URL(request.url).searchParams.get("debug") === "1";
      return new Response(
        "RENDER ERROR: " +
          (dbg ? (renderErr && renderErr.stack) || renderErr : "internal error"),
        {
          status: 500,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        },
      );
    }
    if (typeof bodyHtml !== "string") {
      return new Response(
        "RENDER RETURNED NON-STRING: " +
          Object.prototype.toString.call(bodyHtml),
        {
          status: 500,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        },
      );
    }
    return authResp(auth, needsCookieUpdate, bodyHtml, {
      extra: {

        "Cache-Control": CC_NO_STORE,
      },
    });
  } catch (e) {

    const dbg = new URL(request.url).searchParams.get("debug") === "1";
    return new Response(
      "DETAIL EXCEPTION: " + (dbg ? (e && e.stack) || e : "internal error"),
      {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      },
    );
  }
}

function pickPausedShowEntry(list, traktId) {
  if (!Array.isArray(list) || !list.length || traktId == null) return null;
  const mine = list.filter(
    (p) =>
      p &&
      p.show &&
      p.show.ids &&
      p.show.ids.trakt != null &&
      String(p.show.ids.trakt) === String(traktId),
  );
  if (!mine.length) return null;
  mine.sort((a, b) =>
    String(b.paused_at || "").localeCompare(String(a.paused_at || "")),
  );
  const top = mine[0];
  const pct = typeof top.progress === "number" ? top.progress : null;
  if (pct == null || pct <= 0 || pct >= 90) return null;
  return top;
}

function posterOfTrakt(obj) {
  if (!obj || !obj.images) return null;
  const pick = (arr) => {
    if (!arr || !Array.isArray(arr) || !arr.length) return null;
    if (typeof arr[0] === "string") return arr[0];
    if (typeof arr[0] === "object")
      return arr[0].full || arr[0].medium || arr[0].thumb || null;
    return null;
  };
  return (
    pick(obj.images.poster) ||
    pick(obj.images.screenshot) ||
    pick(obj.images.screenshots) ||
    pick(obj.images.fanart) ||
    null
  );
}

function continueImageOf(item) {
  if (!item) return null;
  return (
    posterOfTrakt(item.episode) ||
    posterOfTrakt(item.show) ||
    posterOfTrakt(item.movie) ||
    null
  );
}

function buildBaseItem(traktItem) {
  const base = {
    tag: "",
    tagClass: "",
    title: "",
    overview: "",
    poster: null,
    line1: "",
    detailType: null,
    detailId: null,
    traktId: null,
    enrichKey: null,
  };
  let kind = traktItem.type;
  if (!kind) {
    if (traktItem.show && traktItem.episode) kind = "episode";
    else if (traktItem.movie) kind = "movie";
    else if (traktItem.show) kind = "show";
  }
  if (kind === "movie" || traktItem.movie) {
    const m = traktItem.movie || {};
    base.tag = "电影";
    base.tagClass = "movie";
    base.title = m.title || "";
    base.overview = m.overview || "";
    base.poster =
      posterOfTrakt(m) || m.__posterUrl || traktItem.__posterUrl || null;
    base.line1 = m.year ? String(m.year) : "";
    base.detailType = "movie";
    base.traktId = m.ids && m.ids.trakt ? String(m.ids.trakt) : null;
    base.detailId =
      m.ids && m.ids.tmdb
        ? "tmdb-" + m.ids.tmdb
        : m.ids && m.ids.trakt
          ? String(m.ids.trakt)
          : null;
    if (m.ids && m.ids.tmdb) base.enrichKey = "movie:tmdb:" + m.ids.tmdb;
    else if (m.ids && m.ids.imdb) base.enrichKey = "movie:imdb:" + m.ids.imdb;
    else if (m.title)
      base.enrichKey = "movie:title:" + m.title + ":" + (m.year || "");
  } else if (
    kind === "episode" ||
    kind === "show" ||
    (traktItem.show && traktItem.episode)
  ) {
    const e = traktItem.episode || {},
      s = traktItem.show || {};
    base.tag = "剧集";
    base.tagClass = "episode";
    base.title = s.title || "";
    base.overview = s.overview || "";

    const showPoster =
      posterOfTrakt(s) ||
      s.__posterUrl ||
      traktItem.__posterUrl ||
      null;
    const epStill =
      (e && (e.__stillUrl || posterOfTrakt(e))) || traktItem.__stillUrl || null;
    base.poster = showPoster || epStill || null;
    base.hasPoster = !!base.poster;
    base.line1 =
      e.season != null && e.number != null
        ? `第 ${e.season} 季 第 ${e.number} 集${
            e.title && !/^Episode\s*\d+$/i.test(String(e.title).trim())
              ? " · " + e.title
              : ""
          }`
        : s.year
          ? String(s.year)
          : "";
    base.detailType = "show";
    base.traktId =
      kind === "episode" && e.ids && e.ids.trakt
        ? String(e.ids.trakt)
        : s.ids && s.ids.trakt
          ? String(s.ids.trakt)
          : null;
    base.detailId =
      s.ids && s.ids.tmdb
        ? "tmdb-" + s.ids.tmdb
        : s.ids && s.ids.trakt
          ? String(s.ids.trakt)
          : null;
    if (s.ids && s.ids.tmdb) base.enrichKey = "tv:tmdb:" + s.ids.tmdb;
    else if (s.ids && s.ids.tvdb) base.enrichKey = "tv:tvdb:" + s.ids.tvdb;
    else if (s.title)
      base.enrichKey = "tv:title:" + s.title + ":" + (s.year || "");
    if (showPoster) base.lockPoster = true;
  } else if (kind === "season") {
    const se = traktItem.season || {},
      s = traktItem.show || {};
    base.tag = "剧集";
    base.tagClass = "episode";
    base.title = s.title || "";
    base.overview = s.overview || "";
    base.poster =
      posterOfTrakt(s) || s.__posterUrl || traktItem.__posterUrl || null;
    base.line1 =
      se.number != null ? `第 ${se.number} 季` : s.year ? String(s.year) : "";
    base.detailType = "show";
    base.traktId = se.ids && se.ids.trakt ? String(se.ids.trakt) : null;
    base.detailId =
      s.ids && s.ids.tmdb
        ? "tmdb-" + s.ids.tmdb
        : s.ids && s.ids.trakt
          ? String(s.ids.trakt)
          : null;
    if (s.ids && s.ids.tmdb) base.enrichKey = "tv:tmdb:" + s.ids.tmdb;
    else if (s.ids && s.ids.tvdb) base.enrichKey = "tv:tvdb:" + s.ids.tvdb;
    else if (s.title)
      base.enrichKey = "tv:title:" + s.title + ":" + (s.year || "");
  }
  return base;
}

function parseEnrichKey(key) {
  if (!key) return null;
  const i1 = key.indexOf(":");
  if (i1 < 0) return null;
  const i2 = key.indexOf(":", i1 + 1);
  if (i2 < 0) return null;
  const kind = key.slice(0, i1),
    source = key.slice(i1 + 1, i2),
    rest = key.slice(i2 + 1);
  if (kind !== "movie" && kind !== "tv") return null;
  if (source === "title") {
    const lastColon = rest.lastIndexOf(":");
    if (lastColon > 0) {
      const maybeYear = rest.slice(lastColon + 1);
      if (/^\d{4}$/.test(maybeYear)) {
        return {
          kind,
          source,
          title: rest.slice(0, lastColon),
          year: maybeYear,
        };
      }
    }
    return { kind, source, title: rest, year: "" };
  }
  return { kind, source, value: rest };
}
const ENRICH_KEY_RE =
  /^(?:movie|tv):(?:tmdb:\d{1,10}|imdb:tt\d{1,10}|tvdb:\d{1,10}|title:[^\n\r]{1,80})$/;
const ENRICH_MISS_TTL = 600000;

async function fetchEnrichData(key, env) {
  if (!env.TMDB_API_KEY) return null;
  const parsed = parseEnrichKey(key);
  if (!parsed) return null;
  const { kind, source } = parsed;
  let d = null;
  if (source === "tmdb")
    d = await tmdbGet(tmdbUrl(`/${kind}/${parsed.value}`, env));
  else if (source === "imdb") {
    const find = await tmdbGet(
      tmdbUrl(`/find/${parsed.value}`, env, { external_source: "imdb_id" }),
    );
    if (find) {
      const arr = kind === "movie" ? find.movie_results : find.tv_results;
      if (arr && arr.length)
        d = await tmdbGet(tmdbUrl(`/${kind}/${arr[0].id}`, env));
    }
  } else if (source === "tvdb") {
    const find = await tmdbGet(
      tmdbUrl(`/find/${parsed.value}`, env, { external_source: "tvdb_id" }),
    );
    if (find && find.tv_results && find.tv_results.length)
      d = await tmdbGet(tmdbUrl(`/tv/${find.tv_results[0].id}`, env));
  } else if (source === "title") {
    const extra = { query: parsed.title };
    if (parsed.year) extra.year = parsed.year;
    const search = await tmdbGet(tmdbUrl(`/search/${kind}`, env, extra));
    if (search && search.results && search.results.length)
      d = await tmdbGet(tmdbUrl(`/${kind}/${search.results[0].id}`, env));
  }
  return d && (d.title || d.name)
    ? {
        title: d.title || d.name || "",
        overview: d.overview || "",
        poster: d.poster_path ? tmdbPoster(d.poster_path) : null,
      }
    : null;
}

function __bucketGet(items, key) {
  const rec = items[key];
  if (!rec) return undefined;
  const age = Date.now() - (Number(rec.ts) || 0);
  if (rec.m) return age < ENRICH_MISS_TTL ? null : undefined;
  if (age > ENRICH_BUCKET_TTL * 1000) return undefined;
  return { title: rec.t || "", overview: rec.o || "", poster: rec.p || null };
}

async function enrichBatch(keys, env, ctx) {
  const out = {};
  if (!env || !env.TMDB_API_KEY) {
    for (const k of keys) out[k] = null;
    return out;
  }
  const pending = [];
  const keyBucket = new Map();
  for (const key of keys) {
    keyBucket.set(key, stableJitter(key, ENRICH_BUCKETS));
    pending.push(key);
  }
  if (!pending.length) return out;
  const bucketData = new Map();
  const bucketIds = [...new Set(keyBucket.values())];
  if (bucketIds.length && env.TMDB_CACHE && !kvIsDown()) {
    await Promise.all(
      bucketIds.map(async (b) => {
        try {
          const raw = await env.TMDB_CACHE.get(CK.enrichBucket(b), {
            type: "json",
          });
          const items =
            raw && raw.items && typeof raw.items === "object" ? raw.items : {};
          bucketData.set(b, items);
          kvMarkUp();
        } catch {
          bucketData.set(b, {});
          kvMarkDown();
        }
      }),
    );
  }
  for (const b of bucketIds) if (!bucketData.has(b)) bucketData.set(b, {});
  const needFetch = [];
  for (const key of pending) {
    const hit = __bucketGet(bucketData.get(keyBucket.get(key)), key);
    if (hit !== undefined) {
      out[key] = hit;
      kvRemember(CK.enrich(key), hit);
      continue;
    }
    const parsed = parseEnrichKey(key);
    if (parsed && parsed.source === "tmdb") {
      const td = await kvGetJSON(
        env,
        CK.tmdb(`/${parsed.kind}/${parsed.value}`),
        false,
        300,
        60,
      );
      if (td && td !== KV_MISS && td !== KV_ERR) {
        const d = td.data !== undefined ? td.data : td;
        if (d && (d.title || d.name)) {
          const v = {
            title: d.title || d.name || "",
            overview: d.overview || "",
            poster: d.poster_path ? tmdbPoster(d.poster_path) : null,
          };
          out[key] = v;
          const b = keyBucket.get(key);
          if (!bucketData.has(b)) bucketData.set(b, {});
          bucketData.get(b)[key] = {
            t: v.title,
            o: v.overview,
            p: v.poster,
            ts: Date.now(),
          };
          continue;
        }
      }
    }
    needFetch.push(key);
  }
  const queue = needFetch.slice();
  const results = new Map();
  const worker = async () => {
    while (queue.length) {
      const key = queue.shift();
      try {
        results.set(key, await fetchEnrichData(key, env));
      } catch {
        results.set(key, null);
      }
    }
  };
  await Promise.all([
    worker(),
    worker(),
    worker(),
    worker(),
    worker(),
    worker(),
  ]);
  const dirty = new Set();
  for (const [key, val] of results) {
    const b = keyBucket.get(key);
    const items = bucketData.get(b) || {};
    if (val) {
      items[key] = {
        t: val.title || "",
        o: val.overview || "",
        p: val.poster || null,
        ts: Date.now(),
      };
    } else {
      items[key] = { m: 1, ts: Date.now() };
    }
    bucketData.set(b, items);
    dirty.add(b);
    out[key] = val;
    kvRemember(CK.enrich(key), val || { miss: 1 });
  }

  for (const b of dirty) {
    const items = bucketData.get(b);
    if (!items) continue;
    const ks = Object.keys(items);
    if (ks.length > ENRICH_BUCKET_MAX) {
      ks.sort((x, y) => (items[x].ts || 0) - (items[y].ts || 0));
      for (let i = 0; i < ks.length - ENRICH_BUCKET_MAX; i++)
        delete items[ks[i]];
    }
    kvPutJSON(
      env,
      ctx,
      CK.enrichBucket(b),
      { items },
      ENRICH_BUCKET_TTL,
      false,
      false,
    );
  }
  return out;
}

async function handleEnrich(request, env, ctx) {

  const A = await authed(request, env, ctx);
  if (!A.ok) return A.response;
  if (!allowEnrich(request)) {
    return Response.json({}, { status: 429 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({}, { status: 400 });
  }
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) return Response.json({});
  const seen = new Set();
  const keys = [];
  for (const it of rawItems) {
    const key = it && it.key;
    if (typeof key !== "string" || !key || key.length > 120) continue;
    if (!ENRICH_KEY_RE.test(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
    if (keys.length >= ENRICH_BATCH_MAX) break;
  }
  if (!keys.length) return Response.json({});
  const out = await enrichBatch(keys, env, ctx);
  return new Response(JSON.stringify(out), {
    headers: {
      "Content-Type": CT_JSON,

      "Cache-Control": CC_NO_STORE,
    },
  });
}

function mediaItem(opts) {
  const style =
      opts.delay != null ? ` style="animation-delay:${opts.delay}ms"` : "",
    removeHtml =
      opts.removeType && opts.removeId
        ? `<button class="wl-remove" type="button" data-wl-remove-type="${esc(opts.removeType)}" data-wl-remove-id="${esc(opts.removeId)}" aria-label="从待看列表移除" title="从待看列表移除">×</button>`
        : "",
    dropHtml = opts.posterDropShowId
      ? `<button class="wl-drop" type="button" data-drop-show-id="${esc(String(opts.posterDropShowId))}" aria-label="弃看剧集" title="弃看剧集"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>`
      : "",
    watchedHtml =
      opts.watchedType && opts.watchedId
        ? `<button class="wl-watched" type="button" data-watched-type="${esc(opts.watchedType)}" data-watched-id="${esc(opts.watchedId)}" aria-label="标记为已看" title="标记为已看">✓</button>`
        : "",
    unwatchHtml =
      opts.unwatchType && opts.unwatchId
        ? `<button class="wl-unwatch" type="button" data-unwatch-type="${esc(opts.unwatchType)}" data-unwatch-id="${esc(opts.unwatchId)}" aria-label="取消观看" title="取消观看">↺</button>`
        : "",
    rewatchBadge = opts.isRewatch
      ? `<span class="cw-badge-rewatch">重温</span>`
      : "",
    cwActionsHtml =
      opts.dropShowId && !opts.calendarShowId
        ? `<div class="cw-actions"><button type="button" class="cw-act-btn" data-cw-hide data-cw-drop-id="${esc(String(opts.dropShowId))}" data-cw-name="${esc(opts.title || "")}" data-cw-season="${esc(String(opts.cwSeason != null ? opts.cwSeason : ""))}" data-cw-episode="${esc(String(opts.cwEpisode != null ? opts.cwEpisode : ""))}" data-cw-media-type="${esc(opts.cwMediaType || "")}" data-cw-media-id="${esc(opts.cwMediaId != null ? String(opts.cwMediaId) : "")}">移除进度</button><button type="button" class="cw-act-btn danger" data-cw-drop data-cw-drop-id="${esc(String(opts.dropShowId))}" data-cw-name="${esc(opts.title || "")}">弃看剧集</button></div>`
        : "",
    playHtml = opts.playHref
      ? `<a class="poster-play" href="${esc(opts.playHref)}" rel="noopener" aria-label="在 Infuse 中播放" title="在 Infuse 中播放" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" stroke="none"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11.04-6.86a1 1 0 0 0 0-1.72L9.5 4.28A1 1 0 0 0 8 5.14z"/></svg></a>`
      : "",
    bar =
      opts.pct != null
        ? `<div class="bar"><div class="bar-fill" style="width:${opts.pct}%"></div></div>`
        : "",
    dataAttrs =
      opts.detailType && opts.detailId
        ? ` data-detail-type="${esc(opts.detailType)}" data-detail-id="${esc(opts.detailId)}" role="button" tabindex="0"`
        : "",
    enrichAttrs = opts.enrichKey
      ? ` data-enrich-key="${esc(opts.enrichKey)}"`
      : "",
    clickable = opts.detailType && opts.detailId ? " clickable" : "",
    tagHtml =
      opts.tag &&
      (opts.tagClass === "upcoming" ||
        opts.tagClass === "aired" ||
        opts.tagClass === "soon")
        ? `<span class="tag ${esc(opts.tagClass)}">（${esc(opts.tag)}）</span>`
        : "";
  let calendarBtns = "";
  if (opts.calendarShowId) {
    calendarBtns += `<button class="cal-open-btn" type="button" data-cal-show-id="${esc(opts.calendarShowId)}" data-cal-show-name="${esc(opts.calendarShowName || opts.title)}"${opts.calendarTmdbId ? ` data-cal-show-tmdb="${esc(String(opts.calendarTmdbId))}"` : ""} title="查看这部剧的播出日历"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>播出日历</button>`;
  }
  if (
    opts.dropShowId &&
    opts.cwMediaType == null &&
    opts.cwSeason == null &&
    opts.cwEpisode == null
  ) {
    calendarBtns += `<button class="cal-drop-btn" type="button" data-drop-show-id="${esc(String(opts.dropShowId))}" title="弃看剧集"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>弃看剧集</button>`;
  }
  const calendarBtnHtml = calendarBtns
    ? `<div class="cal-action-row">${calendarBtns}</div>`
    : "";
  const lockPosterAttr =
    opts.lockPoster || opts.hasPoster ? ` data-lock-poster="1"` : "";
  const timeBadgeHtml = opts.timeBadge
      ? `<span class="cal-time-badge">${esc(opts.timeBadge)}</span>`
      : "";
    const finaleBadgeHtml = opts.finaleBadge
      ? `<span class="cal-finale-badge">大结局</span>`
      : "";
  return `<div class="item${clickable}"${dataAttrs}${enrichAttrs}${lockPosterAttr}${opts.itemAttrs || ""}${style}>${removeHtml}${watchedHtml}${unwatchHtml}<div class="poster">${opts.poster ? `<img src="${opts.poster}" loading="lazy" decoding="async" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><div class="poster-ph" style="display:none"><span>${opts.tagClass === "movie" ? "🎬" : "📺"}</span></div>` : `<div class="poster-ph"><span>${opts.tagClass === "movie" ? "🎬" : "📺"}</span></div>`}${finaleBadgeHtml}${timeBadgeHtml}${playHtml}${dropHtml}</div><div class="info"><div class="name-row"><span class="name">${esc(opts.title)}</span>${rewatchBadge}${tagHtml}</div>${opts.line1 ? `<div class="meta">${esc(opts.line1)}</div>` : ""}${opts.overview ? `<div class="overview">${esc(opts.overview)}</div>` : ""}${opts.line2 ? `<div class="meta dim">${esc(opts.line2)}</div>` : ""}${bar}${cwActionsHtml}${calendarBtnHtml}</div></div>`;
}

function renderHistoryPage(items, env, isFragment) {
  if (isFragment === undefined) isFragment = false;
  if (!Array.isArray(items))
    return isFragment ? "" : emptyPaneHtml("暂时无法加载观看记录");
  if (!items.length) return isFragment ? "" : emptyView("还没有观看记录");
  const toBJDay = (iso) => {
    if (!iso) return "";
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "";
    const d = new Date(t + BJ_OFFSET_MS);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  };
  const nowBJ = new Date(Date.now() + BJ_OFFSET_MS);
  const todayStr = `${nowBJ.getUTCFullYear()}-${String(nowBJ.getUTCMonth() + 1).padStart(2, "0")}-${String(nowBJ.getUTCDate()).padStart(2, "0")}`;
  const yest = new Date(nowBJ.getTime() - 86400000);
  const yestStr = `${yest.getUTCFullYear()}-${String(yest.getUTCMonth() + 1).padStart(2, "0")}-${String(yest.getUTCDate()).padStart(2, "0")}`;
  const wdNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const monNames = [
    "一月",
    "二月",
    "三月",
    "四月",
    "五月",
    "六月",
    "七月",
    "八月",
    "九月",
    "十月",
    "十一月",
    "十二月",
  ];
  const cardOf = (item, i) => {
    const when = fmtRelative(item.watched_at),
      delay = isFragment ? 0 : Math.min(i, 24) * 20,
      e = buildBaseItem(item);
    let unwatchType = null,
      unwatchId = null;
    if (item.movie && item.movie.ids && item.movie.ids.trakt) {
      unwatchType = "movie";
      unwatchId = item.movie.ids.trakt;
    } else if (item.episode && item.episode.ids && item.episode.ids.trakt) {
      unwatchType = "episode";
      unwatchId = item.episode.ids.trakt;
    }
    return mediaItem({
      poster: e.poster,
      tag: e.tag,
      tagClass: e.tagClass,
      title: e.title,
      overview: e.overview,
      line1: e.line1,
      line2: when,
      delay,
      detailType: e.detailType,
      detailId: e.detailId,
      enrichKey: e.enrichKey,
      unwatchType,
      unwatchId,
    });
  };
  if (isFragment) {
    return items.map((item, i) => cardOf(item, i)).join("");
  }
  const groups = new Map();
  items.forEach((item) => {
    const day = toBJDay(item.watched_at) || "unknown";
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(item);
  });
  const dayKeys = [...groups.keys()].sort((a, b) => {
    if (a === "unknown") return 1;
    if (b === "unknown") return -1;
    return b.localeCompare(a);
  });
  let idx = 0;
  const sections = dayKeys.map((day) => {
    const list = groups.get(day) || [];
    let labelMain = "其它",
      labelSub = "",
      dayNum = "·";
    if (day !== "unknown") {
      const [yy, mm, dd] = day.split("-").map(Number);
      dayNum = String(dd);
      const wd = wdNames[new Date(Date.UTC(yy, mm - 1, dd)).getUTCDay()];
      if (day === todayStr) {
        labelMain = "今天";
        labelSub = monNames[mm - 1] || "";
      } else if (day === yestStr) {
        labelMain = "昨天";
        labelSub = monNames[mm - 1] || "";
      } else {
        labelMain = wd;
        labelSub = monNames[mm - 1] || "";
      }
    }
    const cards = list.map((item) => cardOf(item, idx++)).join("");
    return `<section class="hist-day" data-day="${esc(day)}"><header class="hist-day-head"><span class="hist-day-num${day === todayStr ? " is-today" : ""}">${esc(dayNum)}</span><div class="hist-day-text"><div class="hist-day-main">${esc(labelMain)}</div><div class="hist-day-sub">${esc(labelSub)}</div></div><span class="hist-day-count">${list.length} 个项目</span></header><div class="hist-day-grid grid">${cards}</div></section>`;
  });
  return `<div class="hist-days">${sections.join("")}</div>`;
}

function emptyWatchlistHtml() {
  return `<div class="empty"><svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg><p>待看列表是空的</p><p style="font-size:0.82rem;color:#5a6474;margin-top:10px;line-height:1.6;text-align:center">去 Trakt 上把想看的电影 / 剧集加入 watchlist，这里就会显示</p></div>`;
}

function renderWatchlistItems(items, env) {
  if (!Array.isArray(items) || !items.length) return "";
  return items
    .map((item, i) => {
      const e = buildBaseItem(item);
      if (!e.title || !e.detailId) return "";
      const when = item.listed_at
          ? "添加于 " + fmtRelative(item.listed_at)
          : "",
        delay = Math.min(i, 24) * 20,
        removeType = item.movie
          ? "movie"
          : item.show
            ? item.episode
              ? "episode"
              : item.season
                ? "season"
                : "show"
            : null,
        removeId = e.traktId;
      const poster =
        item.__posterUrl ||
        item.__stillUrl ||
        (item.episode && item.episode.__stillUrl) ||
        e.poster;
      const lockPoster = !!(
        item.__posterUrl ||
        item.__stillUrl ||
        (item.episode && item.episode.__stillUrl) ||
        e.lockPoster
      );
      return mediaItem({
        poster,
        tag: e.tag,
        tagClass: e.tagClass,
        title: e.title,
        overview: e.overview,
        line1: e.line1,
        line2: when,
        delay,
        detailType: e.detailType,
        detailId: e.detailId,
        enrichKey: e.enrichKey,
        removeType,
        removeId,
        lockPoster,
        hasPoster: !!poster,
      });
    })
    .filter(Boolean)
    .join("");
}

function buildInfuseHrefForContinue(item) {
  if (!item) return null;
  const pickTmdb = (...cands) => {
    for (const v of cands) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
    return null;
  };
  const movie = item.movie;
  if (movie) {
    const mid = pickTmdb(
      item.__tmdbId,
      movie.ids && movie.ids.tmdb,
      movie.tmdb,
    );
    if (mid) return `infuse://movie/${mid}?play`;
    return null;
  }
  const show = item.show || {};
  const ep =
    item.episode || (item.progress && item.progress.next_episode) || null;
  const tmdbId = pickTmdb(
    item.__tmdbId,
    show.ids && show.ids.tmdb,
    show.tmdb,
    ep && ep.ids && ep.ids.tmdb,
  );
  if (!tmdbId) return null;
  const season = ep ? (ep.season != null ? ep.season : ep.season_number) : null;
  const number = ep
    ? ep.number != null
      ? ep.number
      : ep.episode_number
    : null;
  const s = Number(season);
  const e = Number(number);
  if (Number.isFinite(s) && s >= 0 && Number.isFinite(e) && e > 0) {
    return `infuse://series/${tmdbId}-${Math.floor(s)}-${Math.floor(e)}`;
  }
  if (Number.isFinite(s) && s >= 0) {
    return `infuse://series/${tmdbId}-${Math.floor(s)}`;
  }
  return `infuse://series/${tmdbId}-1`;
}

function renderContinueItems(upNext, mode = "grid") {
  if (mode === true) mode = "fragment";
  const items = [];
  if (Array.isArray(upNext)) {
    for (let entry of upNext) {
      if (entry.episode) {
        if (typeof entry.progress === "number" && entry.progress >= 90)
          continue;
        if (
          entry.__tmdbId &&
          entry.show &&
          entry.show.ids &&
          !entry.show.ids.tmdb
        ) {

          entry = {
            ...entry,
            show: {
              ...entry.show,
              ids: { ...entry.show.ids, tmdb: entry.__tmdbId },
            },
          };
        }
        items.push({
          source: entry.__localAired ? "localair" : "playback",
          sortKey:
            entry.paused_at ||
            entry.last_watched_at ||
            entry.__firstAired ||
            "",
          raw: entry,
          stillUrl:
            entry.__stillUrl ||
            (entry.episode && entry.episode.__stillUrl) ||
            null,
          backdropUrl: entry.__backdropUrl || null,
          zhTitle: entry.__zhTitle || null,
        });
      } else if (entry.show && entry.progress && entry.progress.next_episode) {
        const completed = Number(entry.progress.completed);
        const aired = Number(entry.progress.aired);
        if (Number.isFinite(completed) && completed <= 0) continue;
        if (
          Number.isFinite(completed) &&
          Number.isFinite(aired) &&
          aired > 0 &&
          completed >= aired
        )
          continue;
        const next = entry.progress.next_episode;
        let showObj = entry.show || {};
        if (entry.__tmdbId) {

          const ids = { ...(showObj.ids || {}) };
          if (!ids.tmdb) ids.tmdb = entry.__tmdbId;
          showObj = { ...showObj, ids };
        }
        items.push({
          source: "upnext",
          sortKey:
            entry.last_watched_at || entry.progress.last_watched_at || "",
          showProgress: {
            completed: Number(entry.progress.completed) || 0,
            aired: Number(entry.progress.aired) || 0,
          },
          raw: {
            type: "episode",
            show: showObj,
            episode: next,
            progress: null,
            __stillUrl: entry.__stillUrl || (next && next.__stillUrl) || null,
            __backdropUrl: entry.__backdropUrl || null,
            __zhTitle: entry.__zhTitle || null,
            __tmdbId:
              entry.__tmdbId || (showObj.ids && showObj.ids.tmdb) || null,
          },
          stillUrl: entry.__stillUrl || (next && next.__stillUrl) || null,
          backdropUrl: entry.__backdropUrl || null,
          zhTitle: entry.__zhTitle || null,
        });
      } else if (entry.movie) {
        if (typeof entry.progress === "number" && entry.progress >= 90)
          continue;
        items.push({
          source: "playback",
          sortKey: entry.last_watched_at || entry.paused_at || "",
          raw: entry,
          stillUrl: entry.__stillUrl || null,
          backdropUrl: entry.__backdropUrl || null,
          zhTitle: entry.__zhTitle || null,
        });
      }
    }
  }
  items.sort((a, b) => {
    const loc = (x) =>
      !!(
        x &&
        x.raw &&
        (x.raw.__localUpcoming || x.raw.__localAired || x.source === "localair")
      );
    if (loc(a) !== loc(b)) return loc(a) ? 1 : -1;
    if (loc(a) && loc(b)) {
      const fa =
        Date.parse((a.raw && a.raw.__firstAired) || a.sortKey || "") || 0;
      const fb =
        Date.parse((b.raw && b.raw.__firstAired) || b.sortKey || "") || 0;
      return fa - fb;
    }
    return String(b.sortKey || "").localeCompare(String(a.sortKey || ""));
  });
  if (!items.length) {
    const emptyHtml = `<div class="empty"><svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg><p>暂时没有继续观看的内容</p><p style="font-size:0.82rem;color:#5a6474;margin-top:10px;line-height:1.6;text-align:center">去 Trakt 上标记一些已看剧集后，这里会显示下一集</p></div>`;
    if (mode === "fragment") return "";
    return emptyHtml;
  }
  const parts = items.map((it, i) => {
    const delay = Math.min(i, 24) * 20,
      item = it.raw,
      ep = item.episode || {},
      show = item.show || {},
      isMovie = !!(item.movie && !item.episode),
      playPct =
        typeof item.progress === "number" ? Math.round(item.progress) : null,
      e = buildBaseItem(item);

    let coverImg = null;
    if (mode === "grid") {
      coverImg =
        item.__posterUrl ||
        (show && show.__posterUrl) ||
        posterOfTrakt(show) ||
        (item.movie && (item.movie.__posterUrl || posterOfTrakt(item.movie))) ||
        (e && e.poster) ||
        continueImageOf(item) ||
        null;
      if (!coverImg) {
        coverImg =
          it.stillUrl ||
          item.__stillUrl ||
          (item.episode && item.episode.__stillUrl) ||
          it.backdropUrl ||
          item.__backdropUrl ||
          posterOfTrakt(item.episode) ||
          null;
      }
    } else {
      coverImg =
        it.stillUrl ||
        item.__stillUrl ||
        (item.episode && item.episode.__stillUrl) ||
        it.backdropUrl ||
        item.__backdropUrl ||
        posterOfTrakt(item.episode) ||
        null;
      if (!coverImg) {
        coverImg =
          it.backdropUrl ||
          item.__backdropUrl ||
          continueImageOf(item) ||
          e.poster;
      }
    }

    let barPct =
      typeof playPct === "number" && playPct > 0 && playPct < 100
        ? playPct
        : null;
    let epSeason = ep.season != null ? ep.season : ep.season_number;
    let epNumber = ep.number != null ? ep.number : ep.episode_number;
    if (
      it.source === "upnext" &&
      it.showProgress &&
      typeof it.showProgress.completed === "number" &&
      it.showProgress.completed >= 0 &&
      typeof it.showProgress.aired === "number" &&
      it.showProgress.aired > 0
    ) {
      const expect = it.showProgress.completed + 1;
      if (
        expect >= 1 &&
        expect <= it.showProgress.aired &&
        (epNumber == null || Number(epNumber) !== expect)
      ) {
        if (
          epNumber == null ||
          Number(epNumber) > expect ||
          Number(epNumber) > it.showProgress.aired
        ) {
          if (epSeason == null) epSeason = 1;
          epNumber = expect;
        }
      }
    }

    let epLabel = "";
    if (epSeason != null && epNumber != null) {
      epLabel = `第 ${epSeason} 季 · 第 ${epNumber} 集`;
    } else if (epNumber != null) {
      epLabel = `第 ${epNumber} 集`;
    }
    const showTitle =
      it.zhTitle ||
      item.__zhTitle ||
      e.title ||
      show.title ||
      (item.movie && item.movie.title) ||
      "";

    const epTitle = (
      (ep && (ep.__zhTitle || ep.title || ep.name)) ||
      (item.episode && (item.episode.__zhTitle || item.episode.title || item.episode.name)) ||
      ""
    ).trim();

    let runtimeMin = null;
    const rtRaw =
      (ep && ep.runtime) ||
      (item.episode && item.episode.runtime) ||
      (item.movie && item.movie.runtime) ||
      (show && show.runtime) ||
      null;
    if (rtRaw != null && Number(rtRaw) > 0) runtimeMin = Math.round(Number(rtRaw));

    let totalEps = null;
    const candidates = [];
    if (it.showProgress && Number(it.showProgress.aired) > 0)
      candidates.push(Math.floor(Number(it.showProgress.aired)));
    if (show && show.aired_episodes != null && Number(show.aired_episodes) > 0)
      candidates.push(Math.floor(Number(show.aired_episodes)));
    if (
      show &&
      show.aired_episodes == null &&
      show.episode_count != null &&
      Number(show.episode_count) > 0
    )
      candidates.push(Math.floor(Number(show.episode_count)));
    if (candidates.length) totalEps = Math.max.apply(null, candidates);
    if (totalEps != null && epNumber != null && Number(epNumber) > totalEps)
      totalEps = Math.floor(Number(epNumber));

    let remainEps = null;
    if (
      it.showProgress &&
      typeof it.showProgress.aired === "number" &&
      typeof it.showProgress.completed === "number"
    ) {
      remainEps = Math.max(
        0,
        Math.floor(it.showProgress.aired) - Math.floor(it.showProgress.completed),
      );
    }
    if (
      (remainEps == null || remainEps === 0) &&
      totalEps != null &&
      epNumber != null &&
      Number(epNumber) > 0
    ) {
      const byEp = Math.max(0, totalEps - Number(epNumber));
      if (remainEps == null) remainEps = byEp;
      else remainEps = Math.max(remainEps, byEp);
    }
    const isLocalUp = !!(
      item.__localUpcoming ||
      item.__localAired ||
      (it.raw && (it.raw.__localUpcoming || it.raw.__localAired)) ||
      it.source === "localair"
    );
    let airTimeStr = "";
    let airRemainStr = "";
    let airStatus =
      item.__localAirStatus || (it.raw && it.raw.__localAirStatus) || "";
    if (isLocalUp) {
      const faIso =
        item.__firstAired ||
        (it.raw && it.raw.__firstAired) ||
        it.sortKey ||
        "";
      const faMs = faIso ? Date.parse(faIso) : NaN;
      if (Number.isFinite(faMs)) {
        const bj = new Date(faMs + BJ_OFFSET_MS);
        airTimeStr = `${String(bj.getUTCHours()).padStart(2, "0")}:${String(bj.getUTCMinutes()).padStart(2, "0")}`;
        const nowMs = Date.now();
        if (!airStatus) {
          if (faMs > nowMs) airStatus = "upcoming";
          else if (nowMs - faMs <= 2 * 3600 * 1000) airStatus = "airing";
          else airStatus = "aired";
        }
        if (airStatus === "upcoming") {
          const diffMin = Math.max(0, Math.round((faMs - nowMs) / 60000));
          if (diffMin < 1) airRemainStr = "马上";
          else if (diffMin < 60) airRemainStr = `${diffMin}分钟后`;
          else {
            const h = Math.floor(diffMin / 60);
            const m = diffMin % 60;
            airRemainStr = m ? `${h}小时${m}分后` : `${h}小时后`;
          }
        } else if (airStatus === "airing") {
          airRemainStr = "正在播出";
        } else {
          const agoMin = Math.max(0, Math.round((nowMs - faMs) / 60000));
          if (agoMin < 60) airRemainStr = `${agoMin}分钟前`;
          else {
            const h = Math.floor(agoMin / 60);
            airRemainStr = h < 24 ? `${h}小时前` : `${Math.floor(h / 24)}天前`;
          }
        }
      }
    }

    let watchingLine = "";
    if (epLabel) {
      watchingLine =
        totalEps != null && totalEps > 0
          ? `${epLabel} · 共${totalEps}集`
          : epLabel;
    } else if (isMovie && playPct != null) {
      watchingLine = `已看 ${playPct}%`;
    } else if (it.showProgress && it.showProgress.aired > 0) {
      watchingLine = `已看 ${it.showProgress.completed}/${it.showProgress.aired} 集`;
    }

    const relTimeStr = isLocalUp
      ? ""
      : (fmtRelative(it.sortKey) || "").trim();

    let footRight = "";
    if (isLocalUp) {
      if (airStatus === "airing") footRight = "新";
      else if (airStatus === "upcoming") footRight = airRemainStr || "即将播出";
      else footRight = airRemainStr || "";
    } else if (remainEps != null && remainEps > 0) {
      footRight = `剩余 ${remainEps} 集`;
      if (relTimeStr) footRight += ` · ${relTimeStr.replace(/\s/g, "")}`;
    } else if (item.__isRewatch) {
      footRight = "重温";
      if (relTimeStr) footRight += ` · ${relTimeStr.replace(/\s/g, "")}`;
    } else if (it.source === "upnext") {
      footRight = "下一集";
    } else if (relTimeStr) {
      footRight = relTimeStr.replace(/\s/g, "");
    }
    const runtimeLabel = runtimeMin ? `${runtimeMin}分钟` : "";
    let watchedType = null,
      watchedId = null;
    if (item.movie && item.movie.ids && item.movie.ids.trakt) {
      watchedType = "movie";
      watchedId = item.movie.ids.trakt;
    } else if (item.episode && item.episode.ids && item.episode.ids.trakt) {
      watchedType = "episode";
      watchedId = item.episode.ids.trakt;
    }
    let playHref = buildInfuseHrefForContinue(item);
    if (playHref && playPct != null && playHref.indexOf("?") < 0) {
      playHref += "?play";
    }
    const dropShowId = !isMovie && show.ids && show.ids.trakt
    ? String(show.ids.trakt)
    : (isMovie && item.movie && item.movie.ids && item.movie.ids.trakt
      ? String(item.movie.ids.trakt)
      : null);
    if (mode === "hscroll" || mode === "fragment") {
      const dataAttrs =
        e.detailType && e.detailId
          ? ` data-detail-type="${esc(e.detailType)}" data-detail-id="${esc(e.detailId)}" role="button" tabindex="0"`
          : "";
      const enrichAttrs = e.enrichKey
        ? ` data-enrich-key="${esc(e.enrichKey)}"`
        : "";
      const clickable = e.detailType && e.detailId ? " clickable" : "";
      const style = delay ? ` style="animation-delay:${delay}ms"` : "";
      const posterHtml = coverImg
        ? `<img src="${coverImg}" loading="lazy" decoding="async" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><div class="poster-ph" style="display:none"><span>${isMovie ? "🎬" : "📺"}</span></div>`
        : `<div class="poster-ph"><span>${isMovie ? "🎬" : "📺"}</span></div>`;
      const playHtml = playHref
        ? `<a class="poster-play" href="${esc(playHref)}" rel="noopener" aria-label="在 Infuse 中播放" title="在 Infuse 中播放" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" stroke="none"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11.04-6.86a1 1 0 0 0 0-1.72L9.5 4.28A1 1 0 0 0 8 5.14z"/></svg></a>`
        : "";

      const footLeftHtml = runtimeLabel
        ? `<span class="cw-foot-left">${esc(runtimeLabel)}</span>`
        : "";
      const footRightHtml = footRight
        ? `<span class="cw-foot-right${footRight === "新" ? " is-new" : ""}">${esc(footRight)}</span>`
        : "";
      const footHtml =
        footLeftHtml || footRightHtml
          ? `<div class="cw-foot">${footLeftHtml}${footRightHtml}</div>`
          : "";
      const barHtml =
        barPct != null
          ? `<div class="cw-bar"><div class="cw-bar-fill" style="width:${Math.max(0, Math.min(100, barPct))}%"></div></div>`
          : "";
      const menuHtml = dropShowId
        ? `<button class="cw-more" type="button" data-cw-menu data-cw-drop-id="${esc(dropShowId)}" data-cw-name="${esc(showTitle)}" data-cw-season="${esc(String(epSeason != null ? epSeason : ""))}" data-cw-episode="${esc(String(epNumber != null ? epNumber : ""))}" data-cw-media-type="${esc(watchedType || (isMovie ? "movie" : ""))}" data-cw-media-id="${esc(watchedId != null ? String(watchedId) : dropShowId)}" aria-label="更多操作" title="更多"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="5" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/></svg></button>`
        : "";
      const lockAttr =
        item.__stillUrl ||
        (item.episode && item.episode.__stillUrl) ||
        item.__backdropUrl ||
        coverImg
          ? ` data-lock-poster="1"`
          : "";
      const rewatchBadge = item.__isRewatch
        ? `<span class="cw-badge-rewatch">重温</span>`
        : "";
      const watchedHtml =
        watchedType && watchedId
          ? `<button class="wl-watched" type="button" data-watched-type="${esc(watchedType)}" data-watched-id="${esc(String(watchedId))}" aria-label="标记为已看" title="标记为已看">✓</button>`
          : "";
      const epTitleRaw = ((ep && (ep.title || ep.name)) || "").trim();
      const npAttrs = ` data-ep-label="${esc(epLabel)}" data-ep-title="${esc(epTitleRaw)}" data-runtime="${runtimeMin || ""}" data-progress="${typeof playPct === "number" ? playPct : ""}" data-source="${esc(it.source || "")}" data-paused-at="${esc(item.paused_at || item.last_watched_at || it.sortKey || "")}"`;
      return `<div class="cw-card item${clickable}"${dataAttrs}${enrichAttrs}${lockAttr}${npAttrs}${style}><div class="cw-poster">${posterHtml}${playHtml}${footHtml}${barHtml}${watchedHtml}</div><div class="cw-info"><div class="cw-title-row"><span class="cw-title">${esc(showTitle)}</span>${rewatchBadge}${menuHtml}</div>${watchingLine ? `<div class="cw-watching">${esc(watchingLine)}</div>` : ""}${relTimeStr && !isLocalUp ? `<div class="cw-meta">${esc(relTimeStr)}</div>` : ""}</div></div>`;
    }
    return mediaItem({
      poster: coverImg || e.poster,
      tag: e.tag,
      tagClass: e.tagClass,
      title: showTitle || e.title,

      overview: e.overview || "暂无简介",
      line1:
        watchingLine || (epLabel ? `正在看 ${epLabel}` : e.line1) || "\u00A0",
      line2:
        footRight ||
        (playPct != null ? `已看 ${playPct}%` : "") ||
        "\u00A0",
      pct: barPct != null ? barPct : 0,
      delay,
      detailType: e.detailType,
      detailId: e.detailId,
      enrichKey: e.enrichKey,

      watchedType,
      watchedId,
      playHref,
      dropShowId,
      cwSeason: epSeason,
      cwEpisode: epNumber,
      cwMediaType: watchedType,
      cwMediaId: watchedId,
      isRewatch: !!item.__isRewatch,
    });
  });
  return parts.join("");
}

// 剧集是否已经「完结」：只有完结/被砍的剧才可能存在大结局。
// 连载中（周更、日更、季中）一律不算，避免把普通一集误标成「大结局」。
const CAL_FINALE_ENDED_STATUS = {
  ended: 1,
  finished: 1,
  canceled: 1,
  cancelled: 1,
  "已完结": 1,
  "已取消": 1,
};

function calShowIsFinished(show, tmdb) {
  const cands = [show && show.status, show && show.__tmdbStatus, tmdb && tmdb.status];
  for (const c of cands) {
    const raw = String(c || "").trim().toLowerCase();
    if (raw && CAL_FINALE_ENDED_STATUS[raw]) return true;
  }
  return false;
}

// 取最后一季（忽略特别篇/第 0 季）的季号与总集数
function lastSeasonMeta(seasons, numKey, countKey) {
  if (!Array.isArray(seasons)) return null;
  let best = null;
  for (const s of seasons) {
    if (!s) continue;
    const n = Number(s[numKey]);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (!best || n > best.num) best = { num: n, count: Number(s[countKey]) || 0 };
  }
  return best;
}

function isCalendarFinale(item, tmdb) {
  const ep = item && item.episode;
  if (!ep) return false;
  const season = Number(ep.season);
  const num = Number(ep.number);
  if (
    !Number.isFinite(season) ||
    !Number.isFinite(num) ||
    season <= 0 ||
    num <= 0
  )
    return false;

  const show = (item && item.show) || {};
  // 硬门槛：剧集本身必须已经完结，否则（周更/日更/连载中）不给「大结局」标
  if (!calShowIsFinished(show, tmdb)) return false;

  // 1) TMDB 季表最准：必须是最后一季的最后一集
  const tmdbSeasons = Array.isArray(tmdb && tmdb.seasons)
    ? tmdb.seasons
    : Array.isArray(show.__tmdbSeasons)
      ? show.__tmdbSeasons
      : null;
  if (tmdbSeasons) {
    const last = lastSeasonMeta(tmdbSeasons, "season_number", "episode_count");
    if (last && last.count > 0)
      return season === last.num && num === last.count;
  }

  // 2) Trakt 自带季表时同理
  if (Array.isArray(show.seasons)) {
    const last = lastSeasonMeta(
      show.seasons.map((s) => ({
        number: s && (s.number != null ? s.number : s.season_number),
        episode_count:
          s && (s.episode_count != null ? s.episode_count : s.aired_episodes),
      })),
      "number",
      "episode_count",
    );
    if (last && last.count > 0) return season === last.num && num === last.count;
  }

  // 3) 兜底：只有单季剧能判断。aired_episodes 是所有季的已播总集数，
  //    所以必须严格等于已播集数（最后一集确实已播出）；
  //    不能再用 num >= aired 这种宽松比较，否则任何一集都会被当成大结局。
  const aired = Number(
    show.aired_episodes != null ? show.aired_episodes : show.episode_count,
  );
  if (season === 1 && Number.isFinite(aired) && aired > 0) {
    if (num === aired) return true;
  }
  return false;
}

// TMDB 详情里提取只跟「是否大结局」有关的最小信息（状态 + 各季集数）
function calTmdbFinaleMeta(data) {
  if (!data || typeof data !== "object") return null;
  const status = String(data.status || "").trim();
  let seasons = null;
  if (Array.isArray(data.seasons)) {
    seasons = [];
    for (const s of data.seasons) {
      const n = Number(s && s.season_number);
      if (!Number.isFinite(n) || n <= 0) continue;
      const c = Number(s && s.episode_count) || 0;
      if (c > 0) seasons.push({ season_number: n, episode_count: c });
    }
    if (!seasons.length) seasons = null;
  }
  if (!status && !seasons) return null;
  return { status, seasons };
}

const CAL_FINALE_TMDB_LIMIT = 24;

// 判断哪些日历条目该打「大结局」标；缺季表时按需取 TMDB 详情（走同一份 KV 缓存，
// 与海报补齐共用，不会额外多打接口）
async function markCalendarFinales(items, env, ctx) {
  if (!Array.isArray(items)) return;
  for (const it of items) if (it) delete it.__finale;

  const metaByTmdb = new Map();
  if (env && env.TMDB_API_KEY) {
    const ids = [];
    for (const it of items) {
      const show = it && it.show;
      const tmdbId = show && show.ids && show.ids.tmdb;
      if (!it || !it.episode || !show || !tmdbId) continue;
      if (show.__tmdbSeasons) continue;
      const k = String(tmdbId);
      if (metaByTmdb.has(k) || ids.indexOf(k) >= 0) continue;
      if (ids.length >= CAL_FINALE_TMDB_LIMIT) break;
      ids.push(k);
    }
    for (let i = 0; i < ids.length; i += 6) {
      await Promise.all(
        ids.slice(i, i + 6).map(async (id) => {
          try {
            const data = await tmdbDetailCached(`/tv/${id}`, env, ctx);
            const meta = calTmdbFinaleMeta(data);
            if (meta) metaByTmdb.set(id, meta);
          } catch (_) {}
        }),
      );
    }
    if (metaByTmdb.size) {
      for (const it of items) {
        const show = it && it.show;
        const id = show && show.ids && show.ids.tmdb;
        const meta = id != null ? metaByTmdb.get(String(id)) : null;
        if (!meta) continue;
        if (meta.status) show.__tmdbStatus = meta.status;
        if (meta.seasons) show.__tmdbSeasons = meta.seasons;
      }
    }
  }

  for (const it of items) if (isCalendarFinale(it)) it.__finale = true;
}

function renderCalendarPage(calendar, env, zhTitles) {
  if (!Array.isArray(calendar)) return emptyPaneHtml("暂时无法加载追剧日历");
  if (!calendar.length) return emptyView("未来 30 天没有待播剧集");
  const toBeijingDay = (iso) => {
      if (!iso) return "";
      const d = new Date(new Date(iso).getTime() + BJ_OFFSET_MS);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    },
    groups = new Map();
  for (const item of calendar) {
    const day = toBeijingDay(item.first_aired);
    if (!day) continue;
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(item);
  }
  const today = toBeijingDay(new Date().toISOString());
  const allDays = Array.from(groups.keys()).sort();
  if (!allDays.length) return emptyView("未来 30 天没有待播剧集");
  function getMonday(dateStr) {
    const d = new Date(dateStr + "T00:00:00Z");
    const day = d.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    d.setUTCDate(d.getUTCDate() - diff);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  function addDays(dateStr, n) {
    const d = new Date(dateStr + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  const thisMonday = getMonday(today);
  const weekOffsets = [-7, 0, 7];
  const weekKeys = ["prev", "this", "next"];
  const weekLabels = ["上周", "本周", "下周"];
  const wdNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  function renderWeek(offset, key) {
    const startMonday = addDays(thisMonday, offset);
    const weekDays = [];
    for (let i = 0; i < 7; i++) weekDays.push(addDays(startMonday, i));
    let weekCount = 0;
    const cols = weekDays.map((day, idx) => {
    const items = groups.get(day) || [];
    items.sort((a, b) => (a.first_aired || "").localeCompare(b.first_aired || ""));
    weekCount += items.length;
    const isToday = day === today;
    const isPast = day < today;
    const num = day.slice(8);
    const parts = items.map((item) => {
      let timeStr = "", timeLabel = "";
      if (item.first_aired) {
        const bj = new Date(new Date(item.first_aired).getTime() + BJ_OFFSET_MS);
        const h = bj.getUTCHours();
        const m = String(bj.getUTCMinutes()).padStart(2, "0");
        timeStr = `${String(h).padStart(2, "0")}:${m}`;
        const period = h < 12 ? "上午" : h < 18 ? "下午" : "晚上";
        timeLabel = `${period}${h > 12 ? h - 12 : h || 12}:${m}`;
      }
      const e = buildBaseItem(item),
        showTraktId = item.show && item.show.ids ? item.show.ids.trakt : null,
        zhTitle = showTraktId != null && zhTitles ? zhTitles[showTraktId] : null,
        displayTitle = zhTitle || e.title || "未知节目";
      let posterUrl = e.poster || "";
      if (posterUrl.includes("/w185/")) posterUrl = posterUrl.replace("/w185/", "/w780/");
      else if (posterUrl.includes("/w342/")) posterUrl = posterUrl.replace("/w342/", "/w780/");
      else if (posterUrl.includes("/w500/")) posterUrl = posterUrl.replace("/w500/", "/w780/");
      else if (posterUrl.includes("/medium/")) posterUrl = posterUrl.replace("/medium/", "/full/");
      return mediaItem({
        poster: posterUrl || e.poster,
        tagClass: "upcoming",
        title: displayTitle,
        overview: "",
        line1: e.line1,
        line2: timeLabel || timeStr,
        detailType: e.detailType,
        detailId: e.detailId,
        enrichKey: e.enrichKey,
        calendarShowId: showTraktId ? String(showTraktId) : null,
        calendarShowName: displayTitle,
        calendarTmdbId: (item.show && item.show.ids && item.show.ids.tmdb) || null,
        dropShowId: showTraktId ? String(showTraktId) : null,
        timeBadge: timeLabel || timeStr,
        finaleBadge: !!item.__finale,
        itemAttrs: ` data-air-time="${esc(timeStr)}"${item.__finale ? ' data-finale="1"' : ''}`,
      });
    });
    return `<div class="cal-day-col${isToday ? " is-today" : ""}${isPast ? " is-past" : ""}" data-day="${day}"${isToday ? ' data-today="1"' : ''}>
      <div class="cal-day-header">
        <span class="cal-wd">${wdNames[idx]}</span>
        <span class="cal-num">${num}</span>
      </div>
      <div class="cal-day-items">${parts.join("") || '<div class="cal-empty-day"></div>'}</div>
    </div>`;
  });
    const strip = weekDays.map((day, idx) => {
      const n = (groups.get(day) || []).length;
      const isToday = day === today;
      return `<button type="button" class="cal-strip-day${isToday ? " is-today" : ""}" data-day="${day}"><span class="cal-strip-wd">${wdNames[idx]}</span><span class="cal-strip-num">${day.slice(8)}</span><span class="cal-strip-mon">${Number(day.slice(5, 7))}月</span>${n ? `<span class="cal-strip-dot">${n > 3 ? "• +" + (n - 1) : "•".repeat(Math.min(n, 3))}</span>` : ""}</button>`;
    }).join("");
    return { key, count: weekCount, cols: cols.join(""), strip, hidden: key !== "this" };
  }
  const weeks = weekOffsets.map((off, i) => renderWeek(off, weekKeys[i]));
  const tabs = weeks.map((w, i) => `<button type="button" class="cal-week-tab${w.key === "this" ? " is-on" : ""}" data-week="${w.key}">${weekLabels[i]}</button>`).join("");
  const panels = weeks.map((w) => `<div class="cal-week-panel${w.hidden ? "" : " is-on"}" data-week="${w.key}"><div class="cal-strip">${w.strip}</div><div class="cal-days-row">${w.cols}</div></div>`).join("");
  return `<div class="cal-week"><div class="cal-week-tabs">${tabs}</div>${panels}</div>`;
}

function firstUnwatchedEpisode(userProgress) {
  if (!userProgress || userProgress.__error) return null;
  const ne = userProgress.next_episode;
  if (ne && ne.season != null && ne.number != null) return ne;
  const seasons = Array.isArray(userProgress.seasons)
    ? userProgress.seasons
    : [];
  for (const s of seasons) {
    if (!s || !(s.number > 0) || !Array.isArray(s.episodes)) continue;
    for (const ep of s.episodes) {
      if (ep && ep.number != null && !ep.completed)
        return { season: s.number, number: ep.number };
    }
  }
  return null;
}

function renderDetailFragment(d) {
  const type = d.type,
    entity = d.entity,
    traktId = d.traktId,
    userProgress = d.userProgress,
    pausedEntry = d.pausedEntry || null,
    pausedIsRewatch = d.pausedIsRewatch === true,
    movieWatched = d.movieWatched,
    tmdb = d.tmdb,
    credits = d.credits,
    recommendations = d.recommendations,
    initialSeasonNum = d.initialSeasonNum,
    initialSeasonData = d.initialSeasonData,
    initialTraktEpisodes = d.initialTraktEpisodes || [],
    thirdParty = d.thirdParty,
    inWatchlist = d.inWatchlist,
    wlTmdbId = d.wlTmdbId,
    isMovie = type === "movie",
    imdbId = d.imdbId || null,
    deferExtras = !!d.deferExtras,
    watchedEpIds = d.watchedEpIds || null;
  const title = (tmdb && (tmdb.title || tmdb.name)) || entity.title || "",
    overview = (tmdb && tmdb.overview) || entity.overview || "",
    year =
      (
        ((tmdb && tmdb.release_date) || (tmdb && tmdb.first_air_date) || "") +
        ""
      ).slice(0, 4) || (entity.year ? String(entity.year) : ""),
    tmdbRating =
      tmdb && tmdb.vote_average != null && Number(tmdb.vote_average) > 0
        ? Number(tmdb.vote_average)
        : null,
    traktRating = entity.rating ? Number(entity.rating) : null,
    runtimeMin =
      (tmdb && tmdb.runtime) ||
      (tmdb && tmdb.episode_run_time && tmdb.episode_run_time[0]) ||
      entity.runtime ||
      0,
    runtimeStr = runtimeMin
      ? runtimeMin >= 60
        ? `${Math.floor(runtimeMin / 60)}h ${runtimeMin % 60}m`
        : `${runtimeMin}m`
      : "",
    genres =
      (tmdb && tmdb.genres && tmdb.genres.map((g) => g.name).join(" · ")) ||
      (entity.genres || []).join(" · "),
    poster =
      tmdb && tmdb.poster_path
        ? tmdbPoster(tmdb.poster_path, "w780")
        : posterOfTrakt(entity),
    backdrop =
      tmdb && tmdb.backdrop_path
        ? tmdbPoster(tmdb.backdrop_path, "w1280")
        : null,
    tagline = entity.tagline || "",
    showSlug = (entity.ids && entity.ids.slug) || "",
    doubanQuery = ((title || "") + (year ? " " + year : "")).trim(),
    doubanUrl = doubanQuery
      ? `${DOUBAN_SEARCH}?search_text=${encodeURIComponent(doubanQuery)}`
      : "";
  const finalImdbId =
    imdbId ||
    (tmdb &&
      (tmdb.imdb_id || (tmdb.external_ids && tmdb.external_ids.imdb_id))) ||
    (entity.ids && entity.ids.imdb) ||
    null;
  const pausedEpInfo = () => {
    if (!pausedEntry || !pausedEntry.episode) return null;
    const pe = pausedEntry.episode;
    const ps = pe.season != null ? pe.season : pe.season_number;
    const pn = pe.number != null ? pe.number : pe.episode_number;
    if (ps == null || pn == null) return null;
    const playPct =
      typeof pausedEntry.progress === "number"
        ? Math.round(pausedEntry.progress)
        : null;
    const verb = pausedIsRewatch ? "重温中" : "正在看";
    return { ps, pn, playPct, verb };
  };
  const pausedStatusHtml = () => {
    const pi = pausedEpInfo();
    if (!pi) return "";
    const title = `${pi.verb} 第${pi.ps}季·${pi.pn}集${pi.playPct != null ? ` · ${pi.playPct}%` : ""}`;
    const sub = pausedEntry.paused_at
      ? "上次 " + fmtRelative(pausedEntry.paused_at)
      : "";
    return `<div class="d-status done d-status-progress"><div class="d-status-row"><div class="d-status-icon">▶</div><div class="d-status-body"><div class="d-status-title">${esc(title)}</div><div class="d-status-sub">${esc(sub)}</div></div></div><div class="bar"><div class="bar-fill" style="width:${pi.playPct != null ? pi.playPct : 0}%"></div></div></div>`;
  };
  let statusHtml = "";
  if (isMovie) {
    if (movieWatched) {
      const playsPart = movieWatched.plays ? `${movieWatched.plays} 次 · ` : "";
      statusHtml = `<div class="d-status done"><div class="d-status-icon">✓</div><div class="d-status-body"><div class="d-status-title">已观看</div><div class="d-status-sub">${esc(playsPart + fmtRelative(movieWatched.last_watched_at))}</div></div></div>`;
    } else {
      statusHtml = `<div class="d-status"><div class="d-status-icon">○</div><div class="d-status-body"><div class="d-status-title">未观看</div><div class="d-status-sub">还没有在 Trakt 上标记</div></div></div>`;
    }
  } else if (
    userProgress &&
    !userProgress.__error &&

    (Number(userProgress.aired) > 0 || Number(userProgress.completed) > 0)
  ) {

    const airedBase = Number(userProgress.aired) || 0;
    const pct = airedBase > 0
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round((userProgress.completed / airedBase) * 100),
          ),
        )
      : 100;
    const pi = pausedEpInfo();
    let title,
      sub,
      barPct = pct;
    if (pi) {
      title = `${pi.verb} 第${pi.ps}季·${pi.pn}集${pi.playPct != null ? ` · ${pi.playPct}%` : ""}`;
      const parts = [];
      if (userProgress.completed > 0)
        parts.push(
          airedBase > 0
            ? `已看 ${userProgress.completed} / ${userProgress.aired} 集`
            : `已看 ${userProgress.completed} 集`,
        );
      const lastAt = pausedEntry.paused_at || userProgress.last_watched_at;
      if (lastAt) parts.push("上次 " + fmtRelative(lastAt));
      sub = parts.join(" · ");
      if (pi.playPct != null) barPct = pi.playPct;
    } else {
      title =
        airedBase > 0
          ? `已看 ${userProgress.completed} / ${userProgress.aired} 集 · ${pct}%`
          : `已看 ${userProgress.completed} 集`;
      sub = userProgress.last_watched_at
        ? "上次 " + fmtRelative(userProgress.last_watched_at)
        : "";
    }
    statusHtml = `<div class="d-status done d-status-progress"><div class="d-status-row"><div class="d-status-icon">▶</div><div class="d-status-body"><div class="d-status-title">${esc(title)}</div><div class="d-status-sub">${esc(sub)}</div></div></div><div class="bar"><div class="bar-fill" style="width:${barPct}%"></div></div></div>`;
  } else if (!isMovie && pausedEpInfo()) {
    statusHtml = pausedStatusHtml();
  } else if (!isMovie && d.progressUnknown) {

    const sec = Number(d.coolingSec) || 0;
    statusHtml = `<div class="d-status d-status-pending"><div class="d-status-icon">◌</div><div class="d-status-body"><div class="d-status-title">观看记录未同步</div><div class="d-status-sub">Trakt 限流中${sec > 0 ? `，约 ${sec} 秒后自动恢复` : "，请稍后再试"}（不是记录丢失）</div></div></div>`;
  } else if (!isMovie) {
    statusHtml = `<div class="d-status"><div class="d-status-icon">○</div><div class="d-status-body"><div class="d-status-title">尚未观看</div><div class="d-status-sub">还没有观看记录</div></div></div>`;
  }
  const iconCheck =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12.5 10 17.5 19 7"/></svg>';
  const iconBm =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h10a1 1 0 0 1 1 1v16l-6-3.5L6 20V4a1 1 0 0 1 1-1z"/></svg>';
  const iconBmFill =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" stroke="none"><path d="M7 3h10a1 1 0 0 1 1 1v16l-6-3.5L6 20V4a1 1 0 0 1 1-1z"/></svg>';
  const iconPlay =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" stroke="none"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11.04-6.86a1 1 0 0 0 0-1.72L9.5 4.28A1 1 0 0 0 8 5.14z"/></svg>';
  const iconShare =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>';
  let barBtns = "";
  if (isMovie && traktId) {
    if (movieWatched)
      barBtns += `<button class="d-act d-act-watched active" type="button" data-unmark-movie="${esc(String(traktId))}" title="取消观看">${iconCheck}</button>`;
    else
      barBtns += `<button class="d-act d-act-watched" type="button" data-mark-movie="${esc(String(traktId))}" title="标记已看">${iconCheck}</button>`;
  } else if (!isMovie && traktId && initialSeasonNum != null) {
    const seasonProgress = Array.isArray(userProgress && userProgress.seasons)
      ? userProgress.seasons.find(
          (s) => Number(s.number) === Number(initialSeasonNum),
        )
      : null;
    const seasonTotal =
      initialSeasonData && Array.isArray(initialSeasonData.episodes)
        ? initialSeasonData.episodes.length
        : 0;
    const seasonWatched = seasonProgress
      ? Number(seasonProgress.completed) || 0
      : 0;
    const seasonAllWatched = seasonTotal > 0 && seasonWatched >= seasonTotal;
    if (seasonAllWatched)
      barBtns += `<button class="d-act d-act-watched active" type="button" disabled title="本季已看完">${iconCheck}</button>`;
    else
      barBtns += `<button class="d-act d-act-watched" type="button" data-mark-season-all="${esc(String(traktId))}" data-season-num="${initialSeasonNum}" title="标记本季已看">${iconCheck}</button>`;
  }
  if (wlTmdbId) {
    if (inWatchlist)
      barBtns += `<button class="d-act d-act-wl active" type="button" disabled title="已在待看">${iconBmFill}</button>`;
    else
      barBtns += `<button class="d-act d-act-wl" type="button" data-wl-add-detail="${esc(String(wlTmdbId))}" data-wl-add-detail-type="${isMovie ? "movie" : "show"}" title="加入待看">${iconBm}</button>`;
  }
  let infuseHref = "";
  if (isMovie && tmdb && tmdb.id) {
    infuseHref = `infuse://movie/${tmdb.id}?play`;
  } else if (!isMovie && tmdb && tmdb.id) {
    let seasonForLink = 1;
    try {
      const pinfo = pausedEpInfo();
      if (pinfo && Number(pinfo.ps) > 0) {
        seasonForLink = Number(pinfo.ps);
      } else {
        const ne = firstUnwatchedEpisode(userProgress);
        const s = ne
          ? ne.season != null
            ? ne.season
            : ne.season_number
          : null;
        if (s != null && Number(s) >= 0) seasonForLink = Number(s);
        else if (userProgress && Array.isArray(userProgress.seasons)) {
          for (let i = userProgress.seasons.length - 1; i >= 0; i--) {
            const ss = userProgress.seasons[i];
            if (ss && ss.number != null && (ss.completed > 0 || ss.aired > 0)) {
              seasonForLink = Number(ss.number);
              break;
            }
          }
        }
      }
    } catch (_) {}
    infuseHref = `infuse://series/${tmdb.id}-${seasonForLink}`;
  }
  if (infuseHref)
    barBtns += `<a class="d-act d-act-play" href="${esc(infuseHref)}" rel="noopener" title="在 Infuse 中查看">${iconPlay}</a>`;
  if (tmdb && tmdb.id) {
    const tmdbUrl = isMovie
      ? `https://www.themoviedb.org/movie/${tmdb.id}`
      : `https://www.themoviedb.org/tv/${tmdb.id}`;
    barBtns += `<button class="d-act d-act-share" type="button" data-copy-url="${esc(tmdbUrl)}" title="复制 TMDB 链接">${iconShare}</button>`;
  }
  const actionsHtml = barBtns
    ? `<div class="d-action-bar">${barBtns}</div>`
    : "";
  const cast = (credits && credits.cast ? credits.cast : []).slice(0, 20);
  const castInner = cast
    .map((c) => {
      const pid = c.id ? String(c.id) : "";
      const personAttrs = pid
        ? ` data-person-id="${esc(pid)}" data-person-name="${esc(c.name || "")}" role="button" tabindex="0"`
        : "";
      const cls = "cast" + (pid ? " clickable" : "");
      return `<div class="${cls}"${personAttrs}>${c.profile_path ? `<img class="cast-img" src="${TMDB_IMG}/w342${c.profile_path}" loading="lazy" decoding="async" alt="">` : `<div class="cast-img cast-ph" aria-hidden="true"><svg class="cast-ph-icon" viewBox="0 0 24 24" width="40" height="40" fill="currentColor" aria-hidden="true"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v1.2c0 .7.5 1.2 1.2 1.2h16.8c.7 0 1.2-.5 1.2-1.2v-1.2c0-3.2-6.4-4.8-9.6-4.8z"/></svg></div>`}<div class="cast-name">${esc(c.name || "")}</div><div class="cast-role">${esc(c.character || "")}</div></div>`;
    })
    .join("");
  const recs = (
    recommendations && recommendations.results ? recommendations.results : []
  ).slice(0, 12);
  const recsInner = recs
    .map((r, i) =>
      mediaItem({
        poster: tmdbPoster(r.poster_path),
        tag: isMovie ? "电影" : "剧集",
        tagClass: isMovie ? "movie" : "episode",
        title: r.title || r.name || "",
        line1: ((r.release_date || r.first_air_date || "") + "").slice(0, 4),
        delay: i * 20,
        detailType: isMovie ? "movie" : "show",
        detailId: "tmdb-" + r.id,
      }),
    )
    .join("");
  let castSectionHtml = "";
  if (deferExtras) {
    castSectionHtml = `<section class="d-section" data-defer-parent="cast"><h2 class="d-section-title">演员</h2><div class="cast-scroll" data-defer-section="cast"><div class="pane-loading has-sk" style="padding:12px 0">${skRowHtml(4)}</div></div></section>`;
  } else if (castInner) {
    castSectionHtml = `<section class="d-section"><h2 class="d-section-title">演员</h2><div class="cast-scroll">${castInner}</div></section>`;
  }
  const trailersSectionHtml = deferExtras
    ? `<section class="d-section" data-defer-parent="trailers"><h2 class="d-section-title">预告片</h2><div class="trailer-grid" data-defer-section="trailers"><div class="pane-loading has-sk" style="padding:12px 0">${skGridHtml(3)}</div></div></section>`
    : "";
  let recsSectionHtml = "";
  if (deferExtras) {
    recsSectionHtml = `<section class="d-section" data-defer-parent="recs"><h2 class="d-section-title">相关推荐</h2><div class="grid" data-defer-section="recs"><div class="pane-loading has-sk" style="padding:12px 0">${skGridHtml(3)}</div></div></section>`;
  } else if (recsInner) {
    recsSectionHtml = `<section class="d-section"><h2 class="d-section-title">相关推荐</h2><div class="grid">${recsInner}</div></section>`;
  }
  let ratingsSectionHtml = "";
  if (deferExtras) {
    const base =
      traktRating != null || doubanUrl
        ? renderExtRatings(null, { trakt: traktRating, doubanUrl })
        : "";
    ratingsSectionHtml = `<div class="detail-ext-ratings">${base}<span data-defer-section="ratings"></span></div>`;
  } else if (
    thirdParty ||
    traktRating != null ||
    tmdbRating != null ||
    doubanUrl
  ) {
    ratingsSectionHtml = `<div class="detail-ext-ratings">${renderExtRatings(thirdParty, { trakt: traktRating, tmdb: tmdbRating, doubanUrl })}</div>`;
  }
  let seasonsHtml = "";
  if (!isMovie && tmdb && tmdb.seasons && tmdb.seasons.length) {

    const seasons = tmdb.seasons.filter((s) => s.season_number > 0);
    const progressSeasons =
      userProgress && Array.isArray(userProgress.seasons)
        ? userProgress.seasons
        : [];
    seasonsHtml = `<div class="seasons">${seasons
      .map((s) => {
        const total = s.episode_count || 0;
        const sp = progressSeasons.find(
          (x) => Number(x.number) === Number(s.season_number),
        );
        const watchedN = sp ? Number(sp.completed) || 0 : 0;
        let meta = "";
        if (total > 0 && watchedN > 0) meta = `${watchedN} / ${total} 集`;
        else if (total) meta = `共${total}集`;
        else if (watchedN > 0) meta = `已看 ${watchedN} 集`;
        return `<div class="season-item"><div class="season-head" data-show="${traktId ? esc(String(traktId)) : ""}" data-season="${s.season_number}" data-tmdb="${esc(String(tmdb.id))}" data-slug="${esc(showSlug)}" data-ep-total="${total}"><span class="season-title">${esc(s.name || "第 " + s.season_number + " 季")}</span><span class="season-meta">${meta}</span><svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></div><div class="season-body"></div></div>`;
      })
      .join("")}</div>`;
  }
  const rootAttrs = ` data-tmdb-id="${esc(String((tmdb && tmdb.id) || ""))}" data-imdb-id="${esc(String(finalImdbId || ""))}" data-douban-query="${esc(doubanQuery)}"`;
  return `<div class="detail-wrap"${rootAttrs}><div class="detail-hero">${backdrop ? `<img class="detail-bg" src="${backdrop}" alt="">` : ""}<div class="detail-inner">${poster ? `<img class="detail-poster" src="${poster}" alt="">` : `<div class="detail-poster detail-poster-ph">${isMovie ? "🎬" : "📺"}</div>`}<div class="detail-info"><h1 class="detail-title">${esc(title)}</h1>${tagline ? `<div class="detail-tagline">${esc(tagline)}</div>` : ""}<div class="detail-meta">${year ? `<span>${esc(year)}</span>` : ""}${runtimeStr ? `<span>${esc(runtimeStr)}</span>` : ""}</div>${ratingsSectionHtml}${genres ? `<div class="detail-genres">${esc(genres)}</div>` : ""}${overview ? `<p class="detail-overview" role="button" tabindex="0" title="点击展开/收起全文" onclick="this.classList.toggle('expanded')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.classList.toggle('expanded')}">${esc(overview)}</p>` : ""}${statusHtml}${actionsHtml}</div></div></div><div class="detail-body">${castSectionHtml}${trailersSectionHtml}${seasonsHtml}${recsSectionHtml}</div></div>`;
}

function renderSeasonEpisodes(
  seasonProgress,
  tmdbSeason,
  seasonNum,
  showSlug,
  traktEpisodes,
  tmdbShowId,
  watchedEpIds,
  fullProgress,
  showTraktId,
  unknownState = false,
) {
  if (
    !tmdbSeason ||
    !Array.isArray(tmdbSeason.episodes) ||
    !tmdbSeason.episodes.length
  )
    return '<div class="ep-empty">暂无剧集信息</div>';

  const watched = new Map();
  if (Array.isArray(seasonProgress && seasonProgress.episodes)) {
    for (const e of seasonProgress.episodes) {
      if (!e || e.number == null) continue;
      watched.set(Number(e.number), e);
    }
  }
  const traktMap = new Map();
  if (Array.isArray(traktEpisodes)) {
    for (const e of traktEpisodes) {
      if (!e || e.number == null) continue;
      traktMap.set(Number(e.number), e);
    }
  }
  const watchedIdSet =
    watchedEpIds instanceof Set
      ? watchedEpIds
      : watchedEpIds
        ? new Set([...watchedEpIds].map(Number))
        : null;
  const byShow =
    watchedIdSet && watchedIdSet.__byShow && typeof watchedIdSet.__byShow === "object"
      ? watchedIdSet.__byShow
      : null;
  const showKey =
    showTraktId != null && String(showTraktId) !== ""
      ? String(showTraktId)
      : null;

  const watchedNums = new Set();
  for (const [n, e] of watched) {
    if (
      e &&
      (e.completed === true ||
        e.completed === 1 ||
        e.completed === "true" ||
        (typeof e.completed === "number" && e.completed > 0) ||
        (typeof e.plays === "number" && e.plays > 0) ||
        e.last_watched_at)
    ) {
      watchedNums.add(Number(n));
    }
  }

  if (byShow && showKey && byShow[showKey]) {
    const seasonMap = byShow[showKey][String(Number(seasonNum))] || byShow[showKey][String(seasonNum)];
    if (seasonMap && typeof seasonMap === "object") {
      for (const k of Object.keys(seasonMap)) {
        const n = Number(k);
        if (Number.isFinite(n)) watchedNums.add(n);
      }
    }
  }

  const fmtAirDate = (d) => {
    if (!d) return "";
    const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return d;
    return `${m[1]} 年 ${m[2]} 月 ${m[3]} 日`;
  };

  const unknownTip = unknownState
    ? `<div class="ep-unknown-tip">Trakt 限流中，已看标记暂时无法显示。列表和播放入口不受影响，记录也没有丢失，稍后重开本页即可。</div>`
    : "";
  return (
    unknownTip +
    tmdbSeason.episodes
      .map((ep) => {
      const num = ep.episode_number != null ? Number(ep.episode_number) : null;
      const w = num != null ? watched.get(num) : null;
      const traktEp = num != null ? traktMap.get(num) : null;
      const epId =
        (traktEp && traktEp.ids && traktEp.ids.trakt) ||
        (w && w.ids && w.ids.trakt) ||
        null;

      let isWatched = false;
      if (num != null && watchedNums.has(num)) isWatched = true;
      if (
        !isWatched &&
        epId != null &&
        watchedIdSet &&
        watchedIdSet.has(Number(epId))
      )
        isWatched = true;
      if (
        !isWatched &&
        num != null &&
        byShow &&
        showKey &&
        byShow[showKey]
      ) {
        const seasonMap =
          byShow[showKey][String(Number(seasonNum))] ||
          byShow[showKey][String(seasonNum)];
        if (seasonMap && (seasonMap[String(num)] || seasonMap[num]))
          isWatched = true;
      }
      const traktUrl = showSlug
        ? `https://trakt.tv/shows/${showSlug}/seasons/${seasonNum}/episodes/${num}`
        : "";
      const clickable = traktUrl ? " clickable" : "";
      const attrs = traktUrl
        ? ` data-trakt-url="${esc(traktUrl)}" role="link" tabindex="0" title="在 Trakt 中打开"`
        : "";
      const iconPlay = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5.14v14l11-7-11-7z"/></svg>`;
      let playHtml = "";
      const sid = Number(tmdbShowId);
      if (Number.isFinite(sid) && sid > 0 && num != null) {
        const href = `infuse://series/${Math.floor(sid)}-${Number(seasonNum)}-${Number(num)}?play`;
        playHtml = `<a class="ep-play-btn" href="${esc(href)}" rel="noopener" title="在 Infuse 中播放" aria-label="播放" onclick="event.stopPropagation()">${iconPlay}</a>`;
      }

      const watchHtml = unknownState
        ? `<span class="ep-status ep-status-unknown" title="Trakt 限流中，观看状态暂时无法同步">未同步</span>`
        : isWatched
          ? `<span class="ep-status watched" title="已看">已看</span>`
          : epId
            ? `<button class="ep-status unwatched ep-watch-btn" type="button" data-episode-id="${esc(String(epId))}" data-episode-title="${esc(ep.name || "")}" data-show-id="${showTraktId != null ? esc(String(showTraktId)) : ""}" data-season="${esc(String(seasonNum))}" data-number="${ep.number != null ? esc(String(ep.number)) : ""}" title="标记本集已看">未看</button>`
            : `<span class="ep-status unwatched">未看</span>`;
      const actionHtml = `${playHtml}${watchHtml}`;
      const still = ep.still_path ? tmdbPoster(ep.still_path, "w780") : null;
      const stillHtml = still
        ? `<img class="ep-still" src="${esc(still)}" loading="lazy" decoding="async" alt="">`
        : `<div class="ep-still ep-still-ph">📺</div>`;
      let title = (ep.name || "").trim();
      if (
        !title ||
        /^Episode\s*\d+$/i.test(title) ||
        /^第\s*\d+\s*集$/.test(title)
      ) {
        title = `第 ${num} 集`;
      }
      const vote =
        typeof ep.vote_average === "number" && ep.vote_average > 0
          ? ep.vote_average.toFixed(1)
          : null;
      const runtime =
        typeof ep.runtime === "number" && ep.runtime > 0
          ? `${ep.runtime}m`
          : "";
      const air = fmtAirDate(ep.air_date);
      const metaParts = [];
      if (vote != null)
        metaParts.push(`<span class="ep-vote">★ ${vote}</span>`);
      if (air) metaParts.push(`<span>${esc(air)}</span>`);
      if (runtime) metaParts.push(`<span>${esc(runtime)}</span>`);
      const metaHtml = metaParts.length
        ? `<div class="ep-meta">${metaParts.join('<span class="ep-dot">·</span>')}</div>`
        : "";
      const titleIsGeneric =
        !title ||
        /^第\s*\d+\s*集$/.test(title) ||
        /^Episode\s*\d+$/i.test(title);
      const titleHtml = titleIsGeneric
        ? `<span class="ep-title">第 ${num} 集</span>`
        : `<span class="ep-num">${num}</span><span class="ep-title">${esc(title)}</span>`;
      return `<div class="episode${isWatched ? " watched" : ""}${clickable}"${attrs}><div class="ep-still-wrap">${stillHtml}${isWatched ? '<span class="ep-still-badge">已看</span>' : ""}</div><div class="ep-body"><div class="ep-head"><div class="ep-title-line">${titleHtml}</div><div class="ep-actions">${actionHtml}</div></div>${metaHtml}${ep.overview ? `<div class="ep-overview">${esc(ep.overview)}</div>` : ""}</div></div>`;
      })
      .join("")
  );
}

function emptyView(opts) {
  if (typeof opts === "string") opts = { text: opts };
  const text = opts.text || "";
  if (opts.error)
    return `<div class="empty" style="color:#9db5e0;padding:80px 20px"><p style="margin:0;font-size:1rem">${esc(text)}</p></div>`;
  return `<div class="empty"><svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg><p>${text}</p></div>`;
}

function emptyPaneHtml(text) {
  return `<div class="empty" style="padding:70px 20px"><p style="margin:0;font-size:.95rem">${esc(text)}</p><p style="font-size:.82rem;color:#7a8394;margin-top:10px">稍后重试即可恢复</p></div>`;
}

function randomString(len) {
  const cs =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~",
    v = new Uint8Array(len);
  crypto.getRandomValues(v);
  let s = "";
  for (let i = 0; i < len; i++) s += cs[v[i] % cs.length];
  return s;
}

async function pkceChallenge(verifier) {
  const data = new TextEncoder().encode(verifier),
    digest = await crypto.subtle.digest("SHA-256", data);
  return b64urlEncode(String.fromCharCode(...new Uint8Array(digest)), true);
}

function b64urlEncode(str, isBinary) {
  let bytes;
  if (isBinary) {
    bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
  } else {
    bytes = new TextEncoder().encode(str);
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  if (pad) b64 += "=".repeat(4 - pad);
  const bin = atob(b64),
    bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function jsStr(s) {
  return JSON.stringify(String(s == null ? "" : s))
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function pad(n) {
  return String(n == null ? 0 : n).padStart(2, "0");
}

function fmtRelative(iso) {
  if (!iso) return "";
  const d = new Date(iso),
    t = d.getTime();
  if (isNaN(t)) return "";
  const diff = Date.now() - t,
    min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return min + " 分钟前";
  const h = Math.floor(min / 60);
  if (h < 24) return h + " 小时前";
  const day = Math.floor(h / 24);
  if (day < 7) return day + " 天前";
  return d.toLocaleDateString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function html(body) {
  return new Response(body, {
    headers: {
      "Content-Type": CT_HTML,
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

async function injectLocalUpcomingIntoContinue(
  list,
  headers,
  env,
  ctx,
  userKey,
  limit = 60,
) {
  if (!Array.isArray(list)) list = [];
  list = list.filter((e) => !isLocalAirEntry(e));
  try {
    const todayBJ = new Date(Date.now() + BJ_OFFSET_MS)
      .toISOString()
      .slice(0, 10);
    const userState = await getUserStateBundle(headers, env, ctx, userKey);
    const droppedSet = droppedStateToSet(userState);
    const freshWatched = watchedStateToSet(userState.watched);
    const hideMap =
      userState.hideMap &&
      typeof userState.hideMap === "object" &&
      !Array.isArray(userState.hideMap)
        ? userState.hideMap
        : {};
    const cal = await getCalendarCached(
      todayBJ,
      headers,
      env,
      ctx,
      userKey,
      false,
      null,
    ).catch(() => null);
    applyRewatchFlags(list, freshWatched);
    const localUpcoming = calendarToLocalContinue(
      cal,
      Date.now(),
      droppedSet,
      freshWatched,
      hideMap,
    );
    const watchedMovieIds = await getWatchedMovieIds(
      headers,
      env,
      ctx,
      userKey,
    ).catch(() => null);
    if (localUpcoming && localUpcoming.length) {
      list = mergeContinueLists(
        list,
        [],
        limit,
        droppedSet,
        freshWatched,
        hideMap,
        localUpcoming,
        watchedMovieIds,
      );
    } else {
      list = mergeContinueLists(
        list,
        [],
        Math.max(limit, list.length),
        droppedSet,
        freshWatched,
        hideMap,
        null,
        watchedMovieIds,
      );
    }
    list = filterContinueEntries(list, freshWatched);
    applyRewatchFlags(list, freshWatched);
  } catch {}
  return Array.isArray(list) ? list : [];
}

async function handleMore(request, env, ctx) {
  const url = new URL(request.url),
    type = url.searchParams.get("type"),

    page = Math.min(
      500,
      Math.max(1, parseInt(url.searchParams.get("page") || "2", 10) || 1),
    ),
    limitParam = parseInt(url.searchParams.get("limit") || "0");
  const A = await authed(request, env, ctx, { html: true, strict: true });
  if (!A.ok) return A.response;
  const { auth, headers, needsCookieUpdate, userKey } = A;
  if (type === "history") {
    const data = await cachedJSON(
      env,
      ctx,
      CK.moreHistory(userKey, page),
      async () => {
        let r;
        try {
          for (let i = 0; i < 3; i++) {
            r = await fetchT(
              `${TRAKT_API}/users/me/history?limit=${PAGE_SIZE}&page=${page}&extended=full&images=poster`,
              { headers },
              9000,
            );
            if (r.status !== 429) break;
            await backoff(i, 1000, 500);
          }
        } catch (e) {
          return { __error: String(e) };
        }
        if (!r || !r.ok) return { __error: "HTTP " + ((r && r.status) || 502) };
        const items = await r.json();
        return {
          items: Array.isArray(items) ? items : [],
          pageCount:
            parseInt(r.headers.get("X-Pagination-Page-Count") || "1") || 1,
        };
      },
      { ttl: 300, missTtl: 60, swr: true, jitter: 120 },
    );
    if (!data || !Array.isArray(data.items))
      return new Response("", { status: 502 });
    const pageCount = data.pageCount || 1;
    await attachEntityPosters(
      data.items,
      env,
      ctx,
      CK.histImages(userKey),
      PAGE_SIZE,
    ).catch(() => {});
    return authResp(
      auth,
      needsCookieUpdate,
      renderHistoryPage(data.items, env, false),
      {
        extra: {
          "X-Has-More": String(page < pageCount),
          "X-Page": String(page),
          "X-Page-Count": String(pageCount),
        },
      },
    );
  }
  if (type === "playback") {
    const limit = limitParam > 0 ? Math.min(limitParam, 40) : 20;

    function asHomePlaybackList(v, flt) {
      if (Array.isArray(v)) return v.length ? v : null;
      if (v && (Array.isArray(v.paused) || Array.isArray(v.upNext))) {
        const f = flt || {};
        const merged = mergeContinueLists(
          Array.isArray(v.paused) ? v.paused : [],
          Array.isArray(v.upNext) ? v.upNext : [],
          20,
          f.dropped || null,
          f.watched || null,
          f.hideMap || null,
          null,
          f.watchedMovies || null,
        );
        return merged && merged.length ? merged : null;
      }
      return null;
    }
    async function readHomePlaybackList() {
      let flt = null;
      try {
        const userState = await getUserStateBundle(headers, env, ctx, userKey);
        const hideMapRaw = userState && userState.hideMap;
        flt = {
          dropped: droppedStateToSet(userState),
          watched: watchedStateToSet(userState.watched),
          hideMap:
            hideMapRaw &&
            typeof hideMapRaw === "object" &&
            !Array.isArray(hideMapRaw)
              ? hideMapRaw
              : {},
          watchedMovies: await getWatchedMovieIds(
            headers,
            env,
            ctx,
            userKey,
          ).catch(() => null),
        };
      } catch {}
      const tryKeys = [CK.playback(userKey), CK.lastGood.playback(userKey)];
      for (const key of tryKeys) {
        if (env && env.TMDB_CACHE && !kvIsDown()) {
          try {
            const raw = await env.TMDB_CACHE.get(key, kvReadOpts());
            if (raw && !raw.miss) {
              const hit = asHomePlaybackList(
                raw.data !== undefined ? raw.data : raw,
                flt,
              );
              if (hit) return hit;
            }
          } catch {}
        }
      }
      return null;
    }
    const data = await cachedJSON(
      env,
      ctx,
      CK.morePlayback(userKey, page, limit),
      async () => {
        let upNextItems = [];
        let pageCountInner = 0;
        let r;

        if (__nitroDownUntil > Date.now()) {
          upNextItems = [];
          r = null;
        } else {
          r = await fetchT(
            `${TRAKT_API}/sync/progress/up_next_nitro?extended=full&images=poster,screenshot,fanart&limit=${limit}&page=${page}&intent=continuing`,
            { headers },
            12000,
          );
        }
        if (r && (r.status === 404 || r.status === 410)) {

          __nitroDownUntil = Date.now() + NITRO_DOWN_TTL_MS;
          upNextItems = [];
          r = null;
        } else if (r && r.status === 429) {

          consumeRetryAfter(r, userKey);
          return {
            __error: "HTTP 429",
            __cooling: traktRateLimitedRemaining(userKey),
          };
        } else if (!r || !r.ok) {
          return { __error: "HTTP " + ((r && r.status) || 502) };
        } else {
          try {
            upNextItems = await r.json();
          } catch {
            upNextItems = [];
          }
        }
        if (!Array.isArray(upNextItems)) upNextItems = [];
        pageCountInner = r
          ? parseInt(r.headers.get("X-Pagination-Page-Count") || "0") || 0
          : 0;
        let pausedItems = [];
        if (page === 1) {
          try {
            const pr = await fetchT(
              `${TRAKT_API}/sync/playback?extended=full`,
              { headers },
              9000,
            );
            if (pr && pr.ok) {
              const pj = await pr.json();
              if (Array.isArray(pj)) pausedItems = pj;
            }
          } catch {}
        }
        let items = upNextItems;
        if (page === 1) {
          const userState = await getUserStateBundle(
            headers,
            env,
            ctx,
            userKey,
          );
          const droppedSet = droppedStateToSet(userState);
          const watchedEpIds = watchedStateToSet(userState.watched);
          const watchedMovieIds = await getWatchedMovieIds(
            headers,
            env,
            ctx,
            userKey,
          ).catch(() => null);
          const hideMap =
            userState.hideMap &&
            typeof userState.hideMap === "object" &&
            !Array.isArray(userState.hideMap)
              ? userState.hideMap
              : {};
          items = mergeContinueLists(
            pausedItems,
            upNextItems,
            limit,
            droppedSet,
            watchedEpIds,
            hideMap,
            null,
            watchedMovieIds,
          );
          if (
            items &&
            items.__autoUnhide &&
            items.__autoUnhide.length &&
            hideMap
          ) {
            let changed = false;
            for (const sid of items.__autoUnhide) {
              const k = String(sid);
              if (hideMap[k]) {

                delete hideMap[k];
                changed = true;
              }
            }
            if (changed) putCwHideMap(env, ctx, userKey, hideMap);
          }
          items = filterContinueEntries(items, watchedEpIds);
          applyRewatchFlags(items, watchedEpIds);
        } else if (Array.isArray(items) && items.length) {
          try {
            const droppedSet = await getDroppedShowIds(
              headers,
              env,
              ctx,
              userKey,
            );
            if (droppedSet && droppedSet.size) {
              items = items.filter((entry) => {
                const id =
                  entry && entry.show && entry.show.ids && entry.show.ids.trakt;
                return id == null || !droppedSet.has(Number(id));
              });
            }
          } catch {}
        }
        return {
          items: Array.isArray(items) ? items : [],
          pageCount: pageCountInner,
        };
      },
      { ttl: 300, missTtl: 60, swr: true, jitter: 150 },
    );
    let list = data && Array.isArray(data.items) ? data.items : null;
    let pageCount = (data && data.pageCount) || 0;
    let fromFallback = false;
    if ((!list || (data && data.__error)) && page === 1) {
      const homeList = await readHomePlaybackList();
      if (homeList && homeList.length) {
        list = homeList.slice();
        pageCount = 1;
        fromFallback = true;
      }
    }
    if (!list) list = [];
    if (page === 1) {
      list = await injectLocalUpcomingIntoContinue(
        list,
        headers,
        env,
        ctx,
        userKey,
        limit,
      );
    }
    const hasMore =
      !fromFallback &&
      (pageCount > 0 ? page < pageCount : list.length >= limit);
    await attachContinueStillsForPlayback(list, env, ctx, userKey, {
      maxFetch: limit,
    });
    const mode = (url.searchParams.get("mode") || "fragment").toLowerCase();
    const renderMode =
      mode === "grid" ? "grid" : mode === "hscroll" ? "hscroll" : "fragment";

    const bodyHtml = list.length
      ? renderContinueItems(list, renderMode)
      : "";
    const reallyHasMore = !!(hasMore && list.length > 0);
    return authResp(auth, needsCookieUpdate, bodyHtml || "", {
      extra: {
        "X-Has-More": String(reallyHasMore),
        "X-Page": String(page),
        "X-From-Fallback": String(!!fromFallback),
        "X-Item-Count": String(list.length),
      },
    });
  }
  if (type === "watchlist") {
    const sort = url.searchParams.get("sort") || "added",
      pageNum = Math.max(
        1,
        parseInt(url.searchParams.get("page") || "1", 10) || 1,
      ),
      merged = await getWatchlist(headers, sort, env, ctx, userKey),
      start = (pageNum - 1) * WATCHLIST_PAGE_SIZE,
      slice = Array.isArray(merged)
        ? merged.slice(start, start + WATCHLIST_PAGE_SIZE)
        : [],
      hasMore = Array.isArray(merged)
        ? start + WATCHLIST_PAGE_SIZE < merged.length
        : false;
    await attachWatchlistStills(slice, env, ctx, userKey, {
      maxFetch: WATCHLIST_PAGE_SIZE,
    });
    return authResp(auth, needsCookieUpdate, renderWatchlistItems(slice, env), {
      extra: {
        "X-Has-More": String(hasMore),
        "X-Page": String(pageNum),
        "X-Total": String(Array.isArray(merged) ? merged.length : 0),
      },
    });
  }
  return new Response("", { status: 400 });
}

function renderLoginPage() {
  return pageShell(
    `<div class="login-wrap"><div class="login-bg"></div><div class="login-card"><h1 class="login-title">MineTrakt</h1><p class="login-sub">你的追剧助手</p><div id="login-area" class="login-area"><button class="btn-primary login-btn" onclick="startLogin()">使用 Trakt 登录</button></div><p class="login-hint">登录后同步观看进度、日历和记录</p></div></div><script>
// 登录页没有公共的 __esc，这里补一个本地转义：
// 服务端返回的 error/hint/user_code 一律过转义再进 innerHTML，防止注入。
function __esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
async function startLogin(){
  var area=document.getElementById('login-area');
  window.__loginGen=(window.__loginGen||0)+1;
  var gen=window.__loginGen;
  area.innerHTML='<div class="spinner"></div>';
  var r;
  try{r=await fetch('/auth/device');}
  catch(e){
    if(gen!==window.__loginGen)return;
    area.innerHTML='<div class="err-box"><p class="err-title">网络好像断了</p><p class="err">连不上服务器，请检查网络后再试</p></div><button class="btn-primary" onclick="startLogin()">重试</button>';
    return;
  }
  if(gen!==window.__loginGen)return;
  if(!r.ok){
    var err={};
    try{err=await r.json();}catch(e){err={};}
    if(gen!==window.__loginGen)return;
    if(r.status===429||err.rateLimited){
      var wait=Number(err.retryAfter)||30;
      area.innerHTML='<div class="err-box" style="background:rgba(255,184,77,.10);border-color:rgba(255,184,77,.28)"><p class="err-title" style="color:#ffb84d">请求过于频繁</p><p class="err" style="color:#ffd693">Trakt 限流了，请 <span id="rl-count">'+wait+'</span> 秒后再试</p></div><button class="btn-primary" id="rl-btn" disabled style="opacity:.5;cursor:not-allowed">请稍候…</button>';
      var cnt=document.getElementById('rl-count'),btn=document.getElementById('rl-btn'),left=wait;
      var timer=setInterval(function(){
        if(gen!==window.__loginGen){clearInterval(timer);return;}
        left--;
        if(cnt)cnt.textContent=String(left);
        if(left<=0){clearInterval(timer);if(btn){btn.disabled=false;btn.style.opacity='';btn.style.cursor='';btn.textContent='立即重试';btn.onclick=function(){startLogin();};}}
      },1000);
      return;
    }
    area.innerHTML='<div class="err-box"><p class="err-title">没拿到验证码</p><p class="err">'+__esc((err.error&&String(err.error))||'服务器暂时没有响应，请稍后再试')+'</p>'+(err.hint?'<p class="hint">'+__esc(err.hint)+'</p>':'')+'</div><button class="btn-primary" onclick="startLogin()">重试</button>';
    return;
  }
  var d=await r.json();
  if(gen!==window.__loginGen)return;
  var activateUrl='https://trakt.tv/activate';
  area.innerHTML='<div class="device-flow">'
    +'<div class="steps">'
    +'<div class="step"><span class="n">1</span><span>打开 <a href="'+activateUrl+'" target="_blank" rel="noopener">trakt.tv/activate</a></span></div>'
    +'<div class="step"><span class="n">2</span><span>输入下方代码</span></div>'
    +'</div>'
    +'<div class="code-box">'+__esc(d.user_code)+'</div>'
    +'<button type="button" class="btn-ghost" id="refresh-code-btn" onclick="startLogin()" style="margin:4px 0 10px">换一个验证码</button>'
    +'<div class="step"><span class="n">3</span><span>在 Trakt 页面点击授权，这里会自动继续</span></div>'
    +'<p id="status" class="status" style="display:none"></p>'
    +'<details class="log-details" open><summary>调试日志</summary><div id="log" class="log-box"></div></details>'
    +'</div>';
  var logEl=document.getElementById('log');
  var waitRow=null,waitRender=null,waitDetail='',waitCls='';
  var waitFrom=Date.now();
  var interval=((d&&d.interval)||5)*1000;
  function p2(n){return (n<10?'0':'')+n;}
  function clock(){var t=new Date();return p2(t.getHours())+':'+p2(t.getMinutes())+':'+p2(t.getSeconds());}
  function waitedSec(){return Math.max(0,Math.round((Date.now()-waitFrom)/1000));}
  function logScroll(){if(!logEl)return;if(logEl.scrollHeight-logEl.scrollTop-logEl.clientHeight<24)logEl.scrollTop=logEl.scrollHeight;}
  function paintWait(){
    if(!waitRow)return;
    waitRow.className='log-row log-wait'+(waitCls?' '+waitCls:'');
    waitRow.title=waitDetail;
    waitRow.innerHTML='<span class="log-t">'+clock()+'</span><span class="log-m">'+(waitRender?waitRender():'')+'</span>';
    logScroll();
  }
  function logWait(render,detail,cls){
    if(!logEl)return;
    waitRender=(typeof render==='function')?render:function(){return String(render);};
    waitDetail=detail||'';
    waitCls=cls||'';
    if(!waitRow){waitRow=document.createElement('div');waitRow.className='log-row log-wait';logEl.appendChild(waitRow);}
    paintWait();
  }
  function logEvent(msg,cls,detail){
    if(!logEl)return;
    if(waitRow&&waitRow.parentNode){waitRow.parentNode.removeChild(waitRow);waitRow=null;waitRender=null;}
    var row=document.createElement('div');
    row.className='log-row'+(cls?' '+cls:'');
    if(detail)row.title=detail;
    row.innerHTML='<span class="log-t">'+clock()+'</span><span class="log-m">'+__esc(msg)+'</span>';
    logEl.appendChild(row);
    logScroll();
  }
  function setStatus(msg,kind){
    try{var st=document.getElementById('status');if(!st)return;st.textContent=msg;st.className='status '+(kind||'');st.style.display='';}catch(e){}
  }
  function pointToRefresh(){
    try{var rb=document.getElementById('refresh-code-btn');if(rb){rb.style.borderColor='rgba(224,85,96,.45)';rb.style.color='#ff8a8a';rb.focus();}}catch(e){}
  }
  logEvent('验证码已生成：'+d.user_code,'log-ok','user_code='+d.user_code);
  logWait(function(){return '等待你在 Trakt 页面完成授权…（已等待 '+waitedSec()+' 秒）';},'authorization_pending');
  var ticker=setInterval(function(){
    if(gen!==window.__loginGen){clearInterval(ticker);return;}
    paintWait();
  },1000);
  function stopTicker(){try{clearInterval(ticker);}catch(e){}}
  var tick=async function(){
    if(gen!==window.__loginGen){stopTicker();return;}
    var r2;
    try{
      r2=await fetch('/auth/poll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:d.state})});
    }catch(e){
      if(gen!==window.__loginGen){stopTicker();return;}
      logWait(function(){return '网络断了一下，正在重试…（已等待 '+waitedSec()+' 秒）';},String(e),'log-warn');
      setTimeout(tick,interval);
      return;
    }
    if(gen!==window.__loginGen){stopTicker();return;}
    if(r2.status===200){
      stopTicker();
      logEvent('授权成功，正在进入首页…','log-ok','HTTP 200 · ok');
      setStatus('✓ 授权成功，正在进入…','success');
      setTimeout(function(){location.href='/home';},400);
      return;
    }
    var data={},text='';
    try{text=await r2.text();}catch(e){}
    try{data=JSON.parse(text)||{};}catch(e){data={};}
    var raw='HTTP '+r2.status+(data&&(data.status||data.message)?' · '+(data.status||data.message):'');
    if(r2.status===202){
      if(data.status==='slow_down'){
        interval+=2000;
        logWait(function(){return '还在等你授权…（Trakt 说我们问得太急，已自动放慢检查节奏 已等待 '+waitedSec()+' 秒）';},raw);
      }else{
        logWait(function(){return '等待你在 Trakt 页面完成授权…（已等待 '+waitedSec()+' 秒）';},raw);
      }
      setTimeout(tick,interval);
      return;
    }
    if(r2.status===403){
      stopTicker();
      logEvent('授权没有完成 —— 你在 Trakt 页面点了「拒绝授权」。点下面的「换一个验证码」再来一次','log-err',raw);
      setStatus(data.message||'你拒绝了授权，请换一个验证码重试','error');
      pointToRefresh();
      return;
    }
    if(r2.status===410){
      stopTicker();
      logEvent('验证码失效了 —— 等得太久（超过 10 分钟），点下面的「换一个验证码」重新开始','log-err',raw);
      setStatus(data.message||'验证码无效或已过期，请换一个重试','error');
      pointToRefresh();
      return;
    }
    if(r2.status===400){
      stopTicker();
      logEvent('这个验证码已经不能用了（可能刷新过页面），点下面的「换一个验证码」重新开始','log-err',raw);
      setStatus('验证码已失效，请换一个重试','error');
      pointToRefresh();
      return;
    }
    if(r2.status===429){
      var ra=Number(data.retryAfter);
      var ms=(isFinite(ra)&&ra>0)?Math.min(300,Math.max(5,ra))*1000:Math.max(interval,5000);
      var until=Date.now()+ms;
      logWait(function(){var s=Math.max(0,Math.ceil((until-Date.now())/1000));return 'Trakt 限流了，我们安静等 '+s+' 秒再自动重试…';},raw,'log-warn');
      setTimeout(tick,ms);
      return;
    }
    if(r2.status===502||r2.status===503||r2.status===504){
      var detail=String((data&&(data.detail||data.status||data.message))||'');
      var waiting=/pending|slow_down|authorization/i.test(detail);
      logWait(function(){
        if(waiting)return '等待你在 Trakt 页面完成授权…（已等待 '+waitedSec()+' 秒）';
        return '授权检查暂时没成功，正在重试…（已等待 '+waitedSec()+' 秒）';
      },raw,'log-warn');
      setTimeout(tick,Math.max(interval,3000));
      return;
    }
    logWait(function(){return '出了点小状况，正在自动重试…（已等待 '+waitedSec()+' 秒）';},raw,'log-warn');
    setTimeout(tick,interval);
  };
  setTimeout(tick,1000);
}
<\/script><script>(function(){try{var msg=sessionStorage.getItem('mt:relogin');if(!msg)return;sessionStorage.removeItem('mt:relogin');var area=document.getElementById('login-area');if(!area)return;var p=document.createElement('p');p.className='err';p.style.cssText='margin-bottom:14px;text-align:center';p.textContent=msg;area.parentNode.insertBefore(p,area);}catch(e){}})<\/script>`,
  );
}

function renderSplash() {
  return `<div id="splash" class="splash" style="position:fixed;top:0;left:0;right:0;bottom:calc(-1 * env(safe-area-inset-bottom,0px));width:100%;min-height:100%;min-height:100dvh;min-height:-webkit-fill-available;min-height:calc(100dvh + env(safe-area-inset-bottom,0px));padding-bottom:env(safe-area-inset-bottom,0px);box-sizing:border-box;z-index:99999;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000"><div class="splash-glow"></div><div class="splash-inner"><div class="splash-logo"><img src="${SPLASH_LOGO}" alt="" width="96" height="96" loading="eager" decoding="async" style="display:block;filter:drop-shadow(0 0 22px rgba(125,157,212,.55))"></div><div class="splash-name">MineTrakt</div><div class="splash-bar"><div class="splash-bar-fill"></div></div></div></div>`;
}
const SPLASH_LOGO_IMG_RE =
  /<img src="[^"]*" alt="" width="96" height="96" loading="eager" decoding="async" style="[^"]*">/;

function launchLogoSvg() {
  return (
    `<svg viewBox="0 0 96 96" width="96" height="96" role="img" aria-label="MineTrakt" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><linearGradient id="mtg" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#a78bfa"/><stop offset="1" stop-color="#7d9dd4"/>` +
    `</linearGradient></defs>` +
    `<rect x="8" y="8" width="80" height="80" rx="22" fill="url(#mtg)" opacity="0.16"/>` +
    `<rect x="8.75" y="8.75" width="78.5" height="78.5" rx="21.25" fill="none" stroke="url(#mtg)" stroke-width="1.5" opacity="0.65"/>` +
    `<path d="M40 33.5v29l25-14.5-25-14.5z" fill="url(#mtg)"/>` +
    `</svg>`
  );
}

function launchCriticalCss() {
  const B = "box-sizing:border-box";
  return (
    `html,body{background:#000!important;color:#eef1f7;margin:0;padding:0;width:100%;height:100%;min-width:100%;min-height:100%;min-height:100vh;min-height:100dvh;min-height:-webkit-fill-available;min-height:calc(100dvh + env(safe-area-inset-bottom,0px));overflow:hidden}` +
    `*{${B}}` +
    `.splash,.splash-persist{position:fixed!important;top:0;left:0;right:0;bottom:0;bottom:calc(-1 * env(safe-area-inset-bottom,0px));width:100%;min-width:100%;height:auto;min-height:100%;min-height:100vh;min-height:100dvh;min-height:-webkit-fill-available;min-height:calc(100dvh + env(safe-area-inset-bottom,0px));padding:0;padding-bottom:env(safe-area-inset-bottom,0px);box-sizing:border-box;z-index:99999;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000;}` +
    `.splash-inner{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:16px}` +
    `.splash-persist{background:radial-gradient(140% 100% at 50% 100%,rgba(124,58,237,.38) 0%,rgba(124,58,237,0) 58%),radial-gradient(110% 85% at 50% -12%,rgba(56,97,190,.25) 0%,rgba(0,0,0,0) 55%),#050508!important}` +
    `.splash-glow{position:absolute;left:50%;top:44%;width:420px;height:420px;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle,var(--launch-glow,rgba(124,58,237,.18)) 0%,rgba(124,58,237,0) 62%);filter:blur(8px)}` +
    `.splash-logo{width:96px;height:96px;display:flex;align-items:center;justify-content:center;animation:lpUp .28s ease both,lpBreath 2.6s ease-in-out .3s infinite}` +
    `.splash-logo img{width:96px;height:96px;display:block;object-fit:contain;animation:lpGlow 2.6s ease-in-out infinite}` +
    `.splash-name{font-size:1.5rem;letter-spacing:3px;color:var(--text,#f2f4fa);font-weight:800;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;text-shadow:0 0 26px var(--accent-glow,rgba(167,139,250,.4));animation:lpUp .28s ease .07s both}` +
    `.splash-bar{width:150px;height:3px;border-radius:99px;background:var(--bar-track,rgba(255,255,255,.08));overflow:hidden;box-shadow:0 0 14px var(--accent-soft,rgba(167,139,250,.25));animation:lpUp .28s ease .12s both}` +
    `.splash-bar-fill{width:40%;height:100%;border-radius:99px;background:var(--splash-bar-fill,linear-gradient(90deg,#7c3aed,#a78bfa,#7d9dd4));box-shadow:0 0 10px var(--accent-glow,rgba(167,139,250,.65));animation:splashBar 1.1s ease-in-out infinite}` +
    `.splash-tag{font-size:.72rem;letter-spacing:4px;color:var(--text-mute,#6b7383);animation:lpUp .28s ease .18s both;padding-left:4px}` +
    `@keyframes lpUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}` +
    `@keyframes lpGlow{0%,100%{filter:drop-shadow(0 0 18px rgba(125,157,212,.45))}50%{filter:drop-shadow(0 0 36px rgba(167,139,250,.8))}}` +
    `@keyframes lpBreath{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}` +
    `@keyframes splashBar{0%{margin-left:-40%}100%{margin-left:100%}}`
  );
}

function renderLaunchPage(request) {
  const loggedIn = !!readAuth(request);
  const target = loggedIn ? "/home" : "/login";
  const warmAssets = loggedIn
    ? '<link rel="preload" as="script" href="/app.js?v=' +
      APP_JS_VERSION +
      '">' +
      '<link rel="preload" as="style" href="/app.css?v=' +
      APP_CSS_VERSION +
      '">'
    : "";
  const tail =
    "<script>(function(){" +
    "var t=" +
    JSON.stringify(target) +
    ";" +
    'try{var inner=document.querySelector(".splash-inner");if(inner){var tg=document.createElement("div");tg.className="splash-tag";tg.textContent="正在进入";inner.appendChild(tg);}}catch(e){}' +
    "setTimeout(function(){ location.replace(t); },400);" +
    "})();<\/script>";
  return (
    '<!DOCTYPE html><html lang="zh-CN" data-theme="dark"><head>' +
    '<meta charset="utf-8">' +
    THEME_BOOT_SCRIPT +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1,user-scalable=no">' +
    '<meta name="color-scheme" content="dark light">' +
    '<meta name="theme-color" content="' +
    THEME_COLOR +
    '">' +
    '<meta name="apple-mobile-web-app-capable" content="yes">' +
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">' +
    '<meta name="apple-mobile-web-app-title" content="' +
    APP_SHORT_NAME +
    '">' +
    '<meta name="mobile-web-app-capable" content="yes">' +
    "<title>" +
    APP_NAME +
    "</title>" +
    '<link rel="preload" as="image" href="' +
    SPLASH_LOGO +
    '" fetchpriority="high">' +
    warmAssets +
    "<style>" +
    launchCriticalCss() +
    "</style>" +
    '</head><body style="background:#000!important;margin:0;width:100%;height:100%;min-height:100vh;min-height:100dvh;min-height:-webkit-fill-available;overflow:hidden">' +
    renderSplash()
      .replace('class="splash"', 'class="splash splash-persist"')
      .replace(SPLASH_LOGO_IMG_RE, launchLogoSvg()) +
    tail +
    "</body></html>"
  );
}

function commonHeadMeta() {
  return `<meta charset="utf-8">${THEME_BOOT_SCRIPT}<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1,user-scalable=no"><meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate"><meta http-equiv="Pragma" content="no-cache"><meta name="color-scheme" content="dark light"><meta name="theme-color" content="${THEME_COLOR}"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="${APP_SHORT_NAME}"><meta name="mobile-web-app-capable" content="yes"><meta name="format-detection" content="telephone=no"><title>${APP_NAME}</title><link rel="icon" href="${FAVICON_URL}" type="image/png"><link rel="apple-touch-icon" href="${APPLE_ICON}"><link rel="manifest" href="/manifest.webmanifest"><link rel="preconnect" href="https://api.trakt.tv" crossorigin><link rel="preconnect" href="https://api.themoviedb.org" crossorigin><link rel="preconnect" href="https://image.tmdb.org" crossorigin>`;
}

function pageHeadEarly() {
  return `<!DOCTYPE html><html lang="zh-CN" data-theme="dark"><head>${commonHeadMeta()}<link rel="preload" as="script" href="/app.js?v=${APP_JS_VERSION}"><link rel="preload" href="/app.css?v=${APP_CSS_VERSION}" as="style"><link rel="stylesheet" href="/app.css?v=${APP_CSS_VERSION}"><style>${splashCriticalCss()}</style></head><body style="background:var(--bg-solid,#000000);margin:0;min-height:100vh;min-height:100dvh">${renderSplash()}`;
}

function pageTail() {
  const ver = `${APP_JS_VERSION}`;
  return `<script>(function(){try{if(window.__hideSplash)window.__hideSplash(true);}catch(e){}try{var s=document.getElementById('splash');if(s){s.classList.add('hide');setTimeout(function(){try{if(s&&s.parentNode)s.parentNode.removeChild(s);}catch(e){}},380);}}catch(e){}})();<\/script><script>(function(){
  var APP_V='${ver}';
  if(!('serviceWorker' in navigator))return;
  if(window.__swRegistered)return;window.__swRegistered=true;
  function regSW(){navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).then(function(r){try{r.update();}catch(e){}}).catch(function(){});}
  if(document.readyState==='complete'){setTimeout(regSW,1200);}else{window.addEventListener('load',function(){setTimeout(regSW,1200);});}
  var checking=false;
  function checkVersion(){
    if(checking)return;checking=true;
    fetch('/api/app-version',{cache:'no-store',credentials:'same-origin'})
      .then(function(r){if(!r.ok)throw 0;return r.json();})
      .then(function(d){
        checking=false;
        if(d&&d.js&&d.js!==APP_V){
          try{sessionStorage.setItem('mt:vreload','1');}catch(e){}
          location.reload();
        }
      })
      .catch(function(){checking=false;});
  }
  try{if(sessionStorage.getItem('mt:vreload')==='1'){sessionStorage.removeItem('mt:vreload');}}catch(e){}
  window.addEventListener('pageshow',function(e){if(e.persisted)checkVersion();});
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')checkVersion();});
})();<\/script></body></html>`;
}

function pageShell(body) {
  return pageHeadEarly() + body + pageTail();
}

function splashCriticalCss() {
  return `html,body{background:var(--bg-solid,#000);color:var(--text,#eef1f7);margin:0;padding:0;min-height:100%;min-height:100dvh}
*{box-sizing:border-box}
.splash{position:fixed;top:0;left:0;right:0;bottom:calc(-1 * env(safe-area-inset-bottom,0px));width:100%;min-height:100%;min-height:100dvh;min-height:-webkit-fill-available;min-height:calc(100dvh + env(safe-area-inset-bottom,0px));padding-bottom:env(safe-area-inset-bottom,0px);box-sizing:border-box;z-index:99999;display:flex;align-items:center;justify-content:center;overflow:hidden;transition:opacity .18s ease;background:var(--splash-bg,#000);}
.splash.hide{opacity:0;pointer-events:none;animation:none}
@keyframes splashAutoHide{to{opacity:0;visibility:hidden;pointer-events:none}}
.splash.splash-persist{animation:none!important;opacity:1;visibility:visible;pointer-events:auto}
.splash-logo img{width:96px;height:96px}
.splash-bar{width:132px;height:3px;border-radius:3px;background:var(--bar-track,rgba(255,255,255,.10));overflow:hidden}
.splash-bar-fill{width:40%;height:100%;border-radius:3px;background:var(--splash-bar-fill,linear-gradient(90deg,#7d9dd4,#a78bfa));animation:splashBar 1.1s ease-in-out infinite}
@keyframes splashBar{0%{margin-left:-40%}100%{margin-left:100%}}
.splash-inner{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:16px}
.splash-name{color:var(--splash-name-b,#a8b2c4);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;font-size:1.25rem;font-weight:800}
.spinner{width:28px;height:28px;border:3px solid var(--spinner-track,#212735);border-top-color:var(--spinner-active,#7d9dd4);border-radius:50%;animation:spin .8s linear infinite;margin:4px auto}
@keyframes spin{to{transform:rotate(360deg)}}
.container{max-width:none;width:100%;margin:0 auto;padding:0 16px calc(64px + env(safe-area-inset-bottom,0px))}
.hero{display:flex;justify-content:space-between;align-items:center;padding:calc(6px + env(safe-area-inset-top)) 0 4px;gap:8px}
.hero-left{display:flex;align-items:center;gap:12px;min-width:0}.hero-avatar-col{display:flex;flex-direction:column;align-items:center;gap:4px;flex-shrink:0}.hero-avatar-col .updated-times{align-items:center;text-align:center;max-width:88px}.hero-avatar-col .updated-at{font-size:.62rem;line-height:1.25;white-space:nowrap}
.hero-avatar{width:48px;height:48px;border-radius:50%;overflow:hidden;flex-shrink:0;background:var(--surface-2,#16161a);border:2px solid var(--avatar-ring,rgba(167,139,250,.45))}
.hero-name{font-size:1.3rem;font-weight:800;color:var(--text,#f4f4f5);margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.updated-times{display:flex;flex-direction:column;gap:1px;min-height:0}.updated-at{font-size:.72rem;color:var(--text-mute,#71717a);margin:0;line-height:1.35}
.tabs{position:fixed;left:0;right:0;bottom:0;z-index:50;display:flex;align-items:stretch;justify-content:space-around;gap:0;margin:0;padding:6px 4px calc(6px + env(safe-area-inset-bottom,0px));background:var(--sticky-bg,rgba(12,12,16,.92));border-top:1px solid var(--sticky-border,rgba(255,255,255,.08))}
.tab{flex:1;min-width:0;background:transparent;border:none;color:var(--text-dim,#a1a1aa);padding:6px 2px 4px;border-radius:12px;font-size:.62rem;font-weight:600;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-height:48px}
.tab.active{background:transparent;color:var(--tab-active-fg,#fff)}
.pane{display:none}.pane.active{display:block}
.home-section{margin-bottom:14px}
.home-section-title{font-size:.95rem;font-weight:700;color:var(--text,#f4f4f5);margin:0 0 8px;display:flex;align-items:center;gap:8px}.home-section-title::before{content:'';width:3px;height:14px;background:linear-gradient(180deg,#a78bfa,#7c3aed);border-radius:2px}
.h-scroll{display:flex;gap:12px;overflow-x:auto;padding:4px 0 10px;-webkit-overflow-scrolling:touch}
.pane-loading{padding:40px 20px;text-align:center}
.btn-action{display:inline-flex;align-items:center;gap:6px;background:var(--hover-bg,rgba(255,255,255,.04));color:var(--text-dim,#a1a1aa);border:1px solid var(--border,rgba(255,255,255,.08));padding:8px 12px;border-radius:10px;font-size:.8rem}
`;
}

function getBootstrapScript() {
  return `(function(){var __CFG=window.__HOME_CONFIG__||{};if(!__CFG.loggedIn)return;window.__HOME_CONFIG__=null;if(__CFG.initialDetail)window.__initialDetail=__CFG.initialDetail;if(!window.__splashT0)window.__splashT0=Date.now();window.__splashHidden=false;window.__hideSplash=function(force){try{if(window.__splashHidden)return;window.__splashHidden=true;var el=document.getElementById('splash');if(!el)return;var wait=force?0:Math.max(0,120-(Date.now()-(window.__splashT0||Date.now())));setTimeout(function(){try{el.classList.add('hide');setTimeout(function(){try{if(el&&el.parentNode)el.parentNode.removeChild(el);}catch(e){}},140);}catch(e){}},wait);}catch(e){}};setTimeout(function(){if(window.__hideSplash)window.__hideSplash();},80);function lsGet(k){try{var v=localStorage.getItem(k);if(!v)return null;var o=JSON.parse(v);if(o&&o._exp&&o._exp<Date.now()){try{localStorage.removeItem(k);}catch(e){}return null;}return o&&o.data?o.data:null;}catch(e){return null;}}function lsSet(k,d,ttlSec){try{localStorage.setItem(k,JSON.stringify({data:d,_exp:Date.now()+ttlSec*1000}));}catch(e){try{localStorage.removeItem(k);}catch(e2){}}}window.__lsGet=lsGet;window.__lsSet=lsSet;var MT_PB_SNAP_TTL=900;function setHTML(sel,html){var el=typeof sel==='string'?document.querySelector(sel):sel;if(el)el.innerHTML=html||'';}window.__setHTML=setHTML;function applyAvatar(url,alts){if(!url)return;var av=document.getElementById('hero-avatar');if(!av)return;var list=[url];if(alts&&alts.length){for(var a=0;a<alts.length;a++){if(alts[a]&&alts[a]!==url)list.push(alts[a]);}}list.push('/avatar?u='+encodeURIComponent(url));var i=0;function next(){if(i>=list.length){av.innerHTML='<span class="hero-avatar-ph">👤</span>';return;}var src=list[i++];var img=document.createElement('img');img.onerror=next;img.alt='';img.width=56;img.height=56;img.decoding='async';img.setAttribute('referrerpolicy','no-referrer');img.src=src;av.innerHTML='';av.appendChild(img);}next();}
function __fmtFull(ts){
  var d=new Date(ts);if(isNaN(d.getTime()))return'';
  var p=function(n){return(n<10?'0':'')+n;};
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes());
}
function __fmtShort(ts){
  var d=new Date(ts);
  if(isNaN(d.getTime()))return'';
  var p=function(n){return(n<10?'0':'')+n;};
  var now=new Date();
  var diff=now.getTime()-d.getTime();
  if(diff<60000) return '刚刚';
  if(diff<3600000) return Math.floor(diff/60000)+'分钟前';
  var hm=p(d.getHours())+':'+p(d.getMinutes());
  if(d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth()&&d.getDate()===now.getDate()){
    return hm;
  }
  var yesterday=new Date(now.getTime()-86400000);
  if(d.getFullYear()===yesterday.getFullYear()&&d.getMonth()===yesterday.getMonth()&&d.getDate()===yesterday.getDate()){
    return '昨天 '+hm;
  }
  if(d.getFullYear()===now.getFullYear()){
    return (d.getMonth()+1)+'月'+d.getDate()+'日';
  }
  return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();
}
window.__mtSyncAt = window.__mtSyncAt || null;
function __rememberCwTimes(d){
  if(!d)return;
  var ts = d.lastSyncAt || d.continueUpdatedAt || d.pauseUpdatedAt || d.userUpdatedAt;
  if(ts && isFinite(ts) && ts>0){
    window.__mtSyncAt = Number(ts);
    try{var payload={ts:window.__mtSyncAt, _exp:Date.now()+86400e3*30};localStorage.setItem('mt:syncAt', JSON.stringify(payload));}catch(e){}
  }
}
function __loadCwTimesFromLs(){
  try{var v=localStorage.getItem('mt:syncAt');if(!v)return;var o=JSON.parse(v);if(!o||(o._exp&&o._exp<Date.now()))return;if(o.ts&&isFinite(Number(o.ts)))window.__mtSyncAt=Number(o.ts);}catch(e){}
}
__loadCwTimesFromLs();
function __setUpdatedAt(source,ageSec,dataTs){
  var el=document.getElementById('updated-at');
  if(!el)return;
  var best=null;
  if(dataTs!=null && isFinite(Number(dataTs)) && Number(dataTs)>0){
    best=Number(dataTs);
    window.__mtSyncAt=best;
  } else if(window.__mtSyncAt){
    best=window.__mtSyncAt;
  } else {
    best=Date.now();
  }
  window.__lastDataUpdateAt=best;
  var same=source==='nochange';
  el.textContent=(same?'已是最新 · ':'进度已同步 · ')+__fmtShort(best);
  el.title=(same?'已是最新，无需更新。最后同步：':'最后同步时间：')+__fmtFull(best);
  el.classList.remove('flash','src-live','src-cache');
  void el.offsetWidth;
  el.classList.add('flash');
  if(source==='cache'||same) el.classList.add('src-cache');
  else el.classList.add('src-live');
}

document.addEventListener('click',function(e){
  var tab=e.target.closest('.cal-week-tab');
  if(tab){
    var week=tab.dataset.week;
    document.querySelectorAll('.cal-week-tab').forEach(function(x){x.classList.toggle('is-on',x===tab);});
    document.querySelectorAll('.cal-week-panel').forEach(function(p){p.classList.toggle('is-on',p.dataset.week===week);});
    if(week==='this'&&window.scrollCalendarToToday)window.scrollCalendarToToday({force:true});
    return;
  }
  var dayBtn=e.target.closest('.cal-strip-day');
  if(!dayBtn)return;
  var panel=dayBtn.closest('.cal-week-panel');
  if(!panel)return;
  panel.querySelectorAll('.cal-strip-day').forEach(function(x){x.classList.toggle('is-on',x===dayBtn);});
  var col=panel.querySelector('.cal-day-col[data-day="'+dayBtn.dataset.day+'"]');
  if(!col)return;
  var row=col.closest('.cal-days-row');
  if(row&&row.scrollWidth>row.clientWidth+2){
    __calScrollColIntoView(col,{force:true,align:'start'});
  }else{
    var headerH=document.querySelector('.top-sticky')?document.querySelector('.top-sticky').offsetHeight:60;
    var top=col.getBoundingClientRect().top+window.pageYOffset-headerH-12;
    window.scrollTo({top:Math.max(0,top),behavior:'smooth'});
  }
});

function applyPlayback(d,isCache){
  if(!d)return;
  if(d.playbackHScrollHtml){window.__lastPbHtml=d.playbackHScrollHtml;setHTML('#playback-hscroll',d.playbackHScrollHtml);}
  else{setHTML('#playback-hscroll','<div class="empty" style="padding:50px 20px"><p style="margin:0;font-size:.92rem">暂无继续观看</p></div>');}
  try{__rememberCwTimes(d);}catch(e){}
  var src=isCache?'cache':(d.playbackSource||'');
  var age=null;
  var dataTs = d.lastSyncAt || d.continueUpdatedAt || d.pauseUpdatedAt || d.userUpdatedAt || d._dataTs;
  if(dataTs) {
    try{d._dataTs=Number(dataTs);}catch(e){}
    age=Math.max(0,Math.round((Date.now()-Number(dataTs))/1000));
  } else if(d.playbackDataTs){
    try{d._dataTs=Number(d.playbackDataTs);}catch(e){}
    age=Math.max(0,Math.round((Date.now()-Number(d.playbackDataTs))/1000));
  } else if(typeof d.playbackAgeSec==='number'&&isFinite(d.playbackAgeSec)){
    age=Math.max(0,d.playbackAgeSec);
    try{d._dataTs=Date.now()-age*1000;}catch(e){}
  }
  if(isCache){
    __setUpdatedAt('cache',age,dataTs);
  } else if(window.__manualRefreshPending){
    __setUpdatedAt('manual',age,dataTs);
    window.__manualRefreshPending=false;
  } else if(d.activityUnchanged===true){
    __setUpdatedAt('nochange',age,dataTs);
  } else {
    __setUpdatedAt(src||'live',age,dataTs);
  }
  if(window.__scheduleEnrich)window.__scheduleEnrich();
}
window.__applyPlayback=applyPlayback;
try{
  if(window.__mtSyncAt) __setUpdatedAt('boot',null,window.__mtSyncAt);
  else __setUpdatedAt('boot');
}catch(e){}
function applyMeta(d,isCache){if(!d)return;var n=document.getElementById('hero-name');if(n&&d.name){var next=String(d.name).trim();var cur=(n.textContent||'').trim();if(next&&!(next==='我'&&cur&&cur!=='…'&&cur!=='我')){n.textContent=next;}}if(d.avatar)applyAvatar(d.avatar,d.avatarAlt);if(!isCache&&d.name&&String(d.name).trim()&&String(d.name).trim()!=='我'){try{lsSet('mt:meta',{name:d.name,avatar:d.avatar,avatarAlt:d.avatarAlt},604800);}catch(e){}}}window.__applyMeta=applyMeta;var __homeDataLoading=false;
function __fetchWithTimeout(url,opts,ms){
  var ctrl=(typeof AbortController!=='undefined')?new AbortController():null;
  var timer=null;
  if(ctrl){timer=setTimeout(function(){try{ctrl.abort();}catch(e){}},ms||30000);opts=opts||{};opts.signal=ctrl.signal;}
  return fetch(url,opts).then(function(r){if(timer)clearTimeout(timer);return r;},function(e){if(timer)clearTimeout(timer);throw e;});
}
var __loadedParts={};var __partInflight={};var __partDebounceAt={};var PART_DEBOUNCE_MS=8000;
function fetchPart(part,force,live){
  force=!!force;live=!!live;
  if(!force&&!live){
    if(__partInflight[part])return __partInflight[part];
    if(__loadedParts[part]&&__partDebounceAt[part]&&Date.now()-__partDebounceAt[part]<PART_DEBOUNCE_MS){
      return Promise.resolve(__loadedParts[part]);
    }
  }
  var p=__fetchWithTimeout('/api/home-data?part='+encodeURIComponent(part)+(force?'&force=1':'')+(live?'&live=1':''),{credentials:'same-origin',cache:'no-store'},30000).then(function(r){if(r.status===401){return r.json().catch(function(){return{};}).then(function(d){var msg=(d&&d.error)||'登录已失效，请重新登录';try{sessionStorage.setItem('mt:relogin',msg);}catch(e){}if(window.__toast)window.__toast(msg,{type:'warn',duration:2200});setTimeout(function(){location.href='/login';},1000);return null;});}if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}).then(function(d){if(!d)return null;if(d.login){location.href='/login';return null;}if(d&&!d.__error){__loadedParts[part]=d;__partDebounceAt[part]=Date.now();}return d;});
  if(!force&&!live){
    __partInflight[part]=p.finally(function(){try{delete __partInflight[part];}catch(e){}});
    return __partInflight[part];
  }
  return p;
}
window.__fetchPart=fetchPart;function loadPartOnce(part){if(__loadedParts[part])return Promise.resolve(__loadedParts[part]);return fetchPart(part).then(function(d){__loadedParts[part]=d;return d;});}window.__loadPartOnce=loadPartOnce;window.__loadedParts=__loadedParts;function loadHomeData(opts){
  opts=opts||{};
  var silent=!!opts.silent;
  if(__homeDataLoading&&!silent)return;
  __homeDataLoading=true;
  __lastRefreshAt=Date.now();
  var bootState='loading';
  function setBootState(s){bootState=s;try{window.__homeBootState=s;}catch(e){}}
  function finishSplash(){if(!silent&&window.__hideSplash)window.__hideSplash(true);}
  function showPlaybackError(){
    setBootState('error');
    if(silent)return;
    setHTML('#playback-hscroll','<div class="empty"><p>暂时无法从 Trakt 拉取数据<br><span style="font-size:.82rem;opacity:.75">可能是官方限流或网络异常，请过几分钟再试</span></p><p style="margin-top:12px"><button class="btn-ghost" onclick="location.reload()">重试</button></p></div>');
    finishSplash();
  }
  function onPlayback(d,from){
    if(!d)return;
    var isCache=from==='cache';
    setBootState(isCache?'cache':(from==='live'?'live':from||'live'));
    applyPlayback(d,isCache);
    if(!isCache){
      try{lsSet('mt:pb',d,MT_PB_SNAP_TTL);}catch(e){}
      if(!silent&&window.__initialDetail){
        var s=window.__initialDetail,idx=s.indexOf('/');
        if(idx>0&&window.openDetail)openDetail(s.slice(0,idx),s.slice(idx+1),false);
        window.__initialDetail=null;
      }
    }
    finishSplash();
  }
  setBootState('loading');
  if(!silent){
    var cachedPb=lsGet('mt:pb');
    if(cachedPb){try{onPlayback(cachedPb,'cache');}catch(e){}}
    else if(window.__earlyPbApplied)finishSplash();
  }
  function fetchLive(){
    return fetchPart('playback',false,true).then(function(x){onPlayback(x,'live');return x;});
  }
  var pPlayback;
  if(!silent&&window.__primaryBootP){
    pPlayback=window.__primaryBootP.then(function(d){
      window.__primaryBootP=null;
      if(d){
        onPlayback(d,d.playbackSource==='cache'?'cache':'live');
        setTimeout(function(){
          if(window.__forceRefreshing||window.__silentRefreshing)return;
          fetchLive().catch(function(){});
        },2500);
        return d;
      }
      return fetchLive();
    }).catch(function(){return fetchLive();});
  }else{
    pPlayback=fetchLive();
  }
  pPlayback=pPlayback.catch(function(){showPlaybackError();});
  Promise.resolve(pPlayback).then(function(){
    __homeDataLoading=false;
    if(!silent){
      var cachedMeta=lsGet('mt:meta');
      if(cachedMeta)setTimeout(function(){try{applyMeta(cachedMeta,true);}catch(e){}},0);
    }
    var runMeta=function(){fetchPart('meta').then(function(d){applyMeta(d,false);}).catch(function(){});};
    if(window.requestIdleCallback)requestIdleCallback(runMeta,{timeout:1500});
    else setTimeout(runMeta,200);
  });
}var __lastUserAct=Date.now(),__lastBoardReload=Date.now();['scroll','click','touchstart','keydown'].forEach(function(t){window.addEventListener(t,function(){__lastUserAct=Date.now();},{passive:true});});var __noChangeToastAt=0;
function __onNoChange(reason){
  try{__setUpdatedAt('nochange');}catch(e){}
  if(reason!=='visible')return;
  if(Date.now()-__noChangeToastAt<300000)return;
  __noChangeToastAt=Date.now();
  __toastOnce('nochange','已是最新，暂无更新',{type:'info',duration:2000});
}
function silentRefresh(reason){if(document.hidden)return;var __m=document.getElementById('modal');if(__m&&__m.classList.contains('open'))return;if(window.__forceRefreshing||window.__homeDataLoading)return;if(window.__silentRefreshing)return;
// B3: 前台可见触发至少间隔 5 分钟；定时器本身已有 REFRESH_MS
if(reason==='visible'&&Date.now()-(__lastRefreshAt||0)<5*60*1000)return;
window.__silentRefreshing=true;__lastRefreshAt=Date.now();function __applySilent(d,fromRetry){if(!d)return false;if(d.activityUnchanged===false){try{delete window.__loadedParts.history;localStorage.removeItem('mt:hist');}catch(e){}if(window.__fetchPartForTab&&!window.__histRefreshInflight){window.__histRefreshInflight=true;window.__fetchPartForTab('history').then(function(hd){if(!hd)return;try{hd.__fetchedAt=Date.now();window.__loadedParts.history=hd;if(window.__applyPart)__applyPart('history',hd);if(window.__savePartSnap)__savePartSnap('history',hd);}catch(e){}}).catch(function(){}).finally(function(){window.__histRefreshInflight=false;});}}var dataTs=d.lastSyncAt||d.continueUpdatedAt||d.pauseUpdatedAt||d.playbackDataTs||null;if(dataTs){try{var n=Number(dataTs);if(isFinite(n)&&n>0)__setUpdatedAt(d.stale||d.refreshFailed?'cache':(d.playbackSource||'live'),null,n);}catch(e){}}if(d.stale||d.refreshFailed){if(window.__toast&&(!window.__staleToastAt||Date.now()-(window.__staleToastAt||0)>120000)){window.__staleToastAt=Date.now();window.__toast(d.cooling?'同步失败（限流），仍显示缓存':'同步失败，仍显示缓存',{type:'warn',duration:2800});}try{lsSet('mt:pb',d,MT_PB_SNAP_TTL);}catch(e){}return true;}var prevHtml=window.__lastPbHtml||null;var newHtml=(d&&d.playbackHScrollHtml)||null;if(d.activityUnchanged&&newHtml&&prevHtml&&prevHtml===newHtml){try{lsSet('mt:pb',d,MT_PB_SNAP_TTL);}catch(e){}__onNoChange(reason);return true;}if(newHtml){applyPlayback(d);try{lsSet('mt:pb',d,MT_PB_SNAP_TTL);}catch(e){}if(prevHtml&&newHtml!==prevHtml&&window.__toast)window.__toast('已自动更新观看进度',{type:'success',duration:2000});return true;}return !!dataTs;}fetchPart('playback',false,true).then(function(d){__applySilent(d);}).catch(function(){return new Promise(function(r){setTimeout(r,2000);}).then(function(){return fetchPart('playback',false,true).then(function(d){if(!__applySilent(d)&&window.__toast)window.__toast('自动同步失败，请稍后手动刷新',{type:'warn',duration:2800});}).catch(function(){if(window.__toast)window.__toast('自动同步失败，请稍后手动刷新',{type:'warn',duration:2800});});});}).finally(function(){window.__silentRefreshing=false;});}window.__refreshStats=silentRefresh;
function __afterWriteSoftRefresh(){
  // 只失效播放进度内存；不要清 history 快照，否则记录栏会短暂/一直空白
  try{
    try{delete window.__loadedParts.playback;}catch(e){}
    try{if(typeof __partDebounceAt!=='undefined')delete __partDebounceAt.playback;}catch(e){}
    try{localStorage.removeItem('mt:pb');}catch(e){}
    try{window.__cwMoreCache=null;}catch(e){}
  }catch(e){}
  setTimeout(function(){
    if(document.hidden)return;
    if(window.__forceRefreshing||window.__silentRefreshing)return;
    // 详情页标记时不要强拉当前栏 history
    var tab=document.querySelector('.tab.active');
    var part=(tab&&tab.dataset&&tab.dataset.tab)||'playback';
    if(part==='search'||part==='history')part='playback';
    if(part!=='playback')return;
    fetchPart('playback',false,true).then(function(d){
      if(d&&typeof applyPlayback==='function')applyPlayback(d);
      try{if(d)lsSet('mt:pb',d,MT_PB_SNAP_TTL);}catch(e){}
    }).catch(function(){});
  },1500);
}
window.__afterWriteSoftRefresh=__afterWriteSoftRefresh;
window.forceRefresh=async function(){if(window.__forceRefreshing)return;window.__forceRefreshing=true;window.__manualRefreshPending=true;try{localStorage.removeItem('mt:pb');localStorage.removeItem('mt:meta');try{window.__cwMoreCache=null;}catch(e){}}catch(e){}var btn=document.getElementById('btn-refresh');var span=btn&&btn.querySelector('span');var oldText=span?span.textContent:'刷新';if(btn)btn.classList.add('loading');if(span)span.textContent='刷新中';var okCount=0,cacheCount=0,failCount=0,cooling=0,hitLimit=false,pbUnchanged=false,pbSeen=false;var GAP_OK=1500,GAP_LIMIT=2000;try{
// 只 force 当前栏目，避免一次打满 5 个 part
var tabEl=document.querySelector('.tab.active');
var curPart=(tabEl&&tabEl.dataset&&tabEl.dataset.tab)||'playback';
if(curPart==='search')curPart='playback';
var wanted=[curPart];
var loaded=window.__loadedParts||{};
try{if(window.__partDebounceAt)delete window.__partDebounceAt[curPart];delete(__partDebounceAt||{})[curPart];}catch(e){}
for(var i=0;i<wanted.length;i++){var part=wanted[i];if(i>0){var gap=cooling>0?Math.min(Math.max(GAP_LIMIT,cooling*1000+2000),8000):GAP_OK;await new Promise(function(r){setTimeout(r,gap);});}var d=null;try{d=await __enqueueTrakt(function(){return fetchPart(part,true);});}catch(e){d=null;}if(!d){failCount++;continue;}var isCache=false;if(part==='playback'&&d.playbackSource==='cache')isCache=true;if(part==='meta'&&d.metaSource==='cache')isCache=true;if(part==='calendar'&&d.calendarSource==='cache')isCache=true;if(part==='watchlist'&&d.watchlistSource==='cache')isCache=true;if(isCache)cacheCount++;else okCount++;if(part==='playback'){pbSeen=true;if(d&&d.activityUnchanged===true)pbUnchanged=true;applyPlayback(d);try{lsSet('mt:pb',d,MT_PB_SNAP_TTL);}catch(e){}}else if(part==='meta'){applyMeta(d,false);}else if(part==='watchlist'||part==='calendar'||part==='history'){__applyPart(part,d);__savePartSnap(part,d);}window.__loadedParts[part]=d;if(__partFailed(d)){try{delete window.__loadedParts[part];}catch(e){}}if(d.rateLimited===true||(Number(d.cooling)>0&&d.rateLimited!==false)){hitLimit=true;cooling=Math.max(cooling,Number(d.cooling)||0);}}if(failCount&&!okCount&&!cacheCount){__errToast('刷新失败',new Error('无法连接，请检查网络后重试'));}else if(hitLimit&&cooling>0){__toast('Trakt 限流约 '+cooling+' 秒，已显示缓存数据',{type:'warn',duration:4200});}else if(hitLimit){__toast('上游繁忙，已显示缓存数据',{type:'warn',duration:3200});}else if(okCount&&!failCount){__toast('已刷新观看数据',{type:'success',duration:1800});}else if(pbSeen&&pbUnchanged&&!okCount){__toast('已是最新，暂无更新',{type:'info',duration:2000});try{__setUpdatedAt('nochange');}catch(e){}}else if(failCount||cacheCount){__toast('已更新（部分来自缓存）',{type:'info',duration:2800});}else{__toast('已刷新观看数据',{type:'success',duration:1800});}if(window.__scheduleEnrich)window.__scheduleEnrich();}catch(e){__errToast('刷新失败',e);}finally{if(btn)btn.classList.remove('loading');if(span)span.textContent=oldText;window.__forceRefreshing=false;}};
function startHomeData(){loadHomeData({silent:false});}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',startHomeData);}else{startHomeData();}var REFRESH_MS=${HOME_AUTO_REFRESH_MINUTES}*60*1000;var __lastRefreshAt=Date.now();if(REFRESH_MS>0){setInterval(function(){if(Date.now()-__lastUserAct<60000)return;silentRefresh();},REFRESH_MS);document.addEventListener('visibilitychange',function(){if(document.hidden)return;if(Date.now()-__lastRefreshAt<5*60*1000)return;silentRefresh('visible');});}})();`;
}

function getClientSideScripts() {
  return (
    getBootstrapScript() +
    `function __esc(s){s=String(s==null?'':s);return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
var __toastSeen={};
function __toastOnce(key,message,opts){
  if(!message)return;
  var now=Date.now(),last=__toastSeen[key]||0;
  if(now-last<2500)return;
  __toastSeen[key]=now;
  if(Object.keys(__toastSeen).length>200)__toastSeen={};
  __toast(message,opts);
}
window.__toastOnce=__toastOnce;
async function __apiWrite(url,payload,opts){
  opts=opts||{};
  var prefix=opts.failPrefix!=null?opts.failPrefix:'操作失败';
  var r;
  try{
    r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',body:JSON.stringify(payload||{})});
  }catch(e){
    var ne=new Error('网络连接失败，请检查网络后重试');
    ne.network=1;
    if(!opts.silent)__errToast(prefix,ne);
    throw ne;
  }
  var raw='';
  try{raw=await r.text();}catch(e){}
  var data=null;
  try{data=raw?JSON.parse(raw):null;}catch(e){data=null;}
  if(!r.ok){
    if(r.status===401){
      var msg401=(data&&(data.error||data.message))||'登录已失效，请重新登录';
      try{sessionStorage.setItem('mt:relogin',msg401);}catch(e){}
      __toast(msg401,{type:'warn',duration:2200});
      setTimeout(function(){location.href='/login';},900);
      var e401=new Error(msg401);e401.relogin=1;throw e401;
    }
    var rawMsg=(data&&(data.error||data.message))||('HTTP '+r.status);
    if(!data&&raw&&!/^\s*[\[{]/.test(raw))rawMsg='服务暂时不可用（HTTP '+r.status+'）';
    var cooling=Number((data&&data.cooling)||0);
    var source=(data&&data.source)||'';
    var err=new Error(__humanizeClientError(rawMsg,cooling,source));
    err.status=r.status;err.cooling=cooling;err.source=source;
    if(!opts.silent)__errToast(prefix,err);
    throw err;
  }
  var okMsg=(data&&data.message)||opts.okMsg||'';
  if(okMsg&&!opts.silent)
    __toastOnce('ok:'+url+':'+okMsg,okMsg,{type:'success',duration:opts.okDuration||2200});
  return data;
}
window.__apiWrite=__apiWrite;
function __toast(message,opts){opts=opts||{};if(!message)return;var type=opts.type||'info';var duration=opts.duration||2600;var container=document.getElementById('toast-container');if(!container){container=document.createElement('div');container.id='toast-container';document.body.appendChild(container);}var toast=document.createElement('div');toast.className='toast toast-'+type;var icons={success:'✓',error:'✕',warn:'!',info:'i'};toast.innerHTML='<span class="toast-icon">'+(icons[type]||icons.info)+'</span><span class="toast-msg">'+__esc(message)+'</span>';container.appendChild(toast);requestAnimationFrame(function(){toast.classList.add('toast-in');});var remove=function(){if(!toast.parentNode)return;toast.classList.remove('toast-in');toast.classList.add('toast-out');setTimeout(function(){if(toast.parentNode)toast.parentNode.removeChild(toast);},260);};var timer=setTimeout(remove,duration);toast.addEventListener('click',function(){clearTimeout(timer);remove();});}window.__toast=__toast;
var __THEME_KEY='mt:theme';
var __THEME_CYCLE=['dark','light','system'];
var __THEME_LABEL={dark:'深色',light:'浅色',system:'跟随系统'};
var __THEME_ICONS={
dark:'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
light:'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>',
system:'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg>'};
function __getTheme(){try{var t=localStorage.getItem(__THEME_KEY);return __THEME_CYCLE.indexOf(t)>=0?t:'dark';}catch(e){return 'dark';}}
function __resolveDark(t){if(t==='system'){try{return !window.matchMedia||matchMedia('(prefers-color-scheme: dark)').matches;}catch(e){return true;}}return t!=='light';}
function __applyTheme(t){var dark=__resolveDark(t);var d=document.documentElement;var resolved=t==='system'?(dark?'dark':'light'):t;d.setAttribute('data-theme',resolved);d.setAttribute('data-theme-pref',t);var bg=dark?'#050505':'#ffffff';d.style.backgroundColor=bg;var tc=document.querySelector('meta[name="theme-color"]');if(tc)tc.setAttribute('content',bg);var cs=document.querySelector('meta[name="color-scheme"]');if(cs)cs.setAttribute('content',dark?'dark':'light');var sb=document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');if(sb)sb.setAttribute('content',dark?'black-translucent':'default');var icon=document.getElementById('theme-icon');if(icon)icon.innerHTML=__THEME_ICONS[t]||__THEME_ICONS.dark;var btn=document.getElementById('btn-theme');if(btn){btn.setAttribute('aria-label','切换主题：'+__THEME_LABEL[t]);btn.setAttribute('title','主题：'+__THEME_LABEL[t]);}if(t==='system'&&!window.__themeListener){try{window.__themeListener=matchMedia('(prefers-color-scheme: dark)');window.__themeListener.addEventListener('change',function(){var pref=localStorage.getItem('mt:theme')||'dark';if(pref==='system')__applyTheme('system');});}catch(e){}}}
window.__applyTheme=__applyTheme;window.__getTheme=__getTheme;
window.cycleTheme=function(){var cur=__getTheme();var next=__THEME_CYCLE[(__THEME_CYCLE.indexOf(cur)+1)%__THEME_CYCLE.length];try{localStorage.setItem(__THEME_KEY,next);}catch(e){}__applyTheme(next);if(window.__toast)__toast('已切换主题：'+__THEME_LABEL[next],{type:'info',duration:1500});};
(function(){__applyTheme(__getTheme());try{var mq=matchMedia('(prefers-color-scheme: dark)');var onChange=function(){if(__getTheme()==='system')__applyTheme('system');};if(mq.addEventListener)mq.addEventListener('change',onChange);else if(mq.addListener)mq.addListener(onChange);}catch(e){}})();
function __humanizeClientError(msg,cooling,source){msg=String(msg||'').trim();if(!msg)return'操作失败，请稍后重试';if(msg.indexOf('登录已过期')>=0||msg.indexOf('unauthorized')>=0)return'登录已过期，请重新登录';var sec=cooling&&cooling>0?Math.ceil(Number(cooling)):0;var isCf=/Cloudflare|cf-mitigated|error code:\s*1015/i.test(msg)||source==='cloudflare';var isLimit=isCf||/Trakt\s*限流|官方限流|限流|过于频繁|429|rate\s*limit/i.test(msg);if(isLimit){if(isCf){if(sec>0)return'被 Cloudflare 拦截，限流冷却中，约 '+sec+' 秒后再试（期间显示缓存，请勿反复操作）';return'被 Cloudflare 拦截，请稍后再试（当前显示缓存）';}if(sec>0)return'Trakt 限流中，约 '+sec+' 秒后再试（期间显示缓存，请勿反复操作）';return'Trakt 限流，请稍后再试（当前显示缓存）';}if(/网络|timeout|abort|Failed to fetch/i.test(msg))return'网络连接失败，请检查网络后重试';if(/^HTTP\\s*5\\d{2}/i.test(msg))return'Trakt 服务暂时不可用（5xx），请稍后重试';if(/^HTTP\\s*404/i.test(msg))return'未找到对应内容';if(/^HTTP\\s*403/i.test(msg))return'没有权限执行此操作';if(/^HTTP\\s*401/i.test(msg))return'登录已过期，请重新登录';if(/^HTTP\\s*\\d+/i.test(msg))return'请求失败，请稍后重试';if(/[\\u4e00-\\u9fff]/.test(msg))return msg;return msg;}function __errToast(prefix,err){
  if(err&&err.__toasted)return;
  if(err&&typeof err==='object'){try{err.__toasted=1;}catch(e){}}
  var msg=(err&&err.message)?err.message:String(err||'未知错误');var cooling=err&&err.cooling;var source=err&&err.source;msg=__humanizeClientError(msg,cooling,source);
  var __k='err:'+prefix+'：'+msg;
  if(__toastSeen[__k]&&Date.now()-__toastSeen[__k]<2500){return;}
  __toastSeen[__k]=Date.now();
  var t='error';if(msg.indexOf('429')>=0||msg.indexOf('限流')>=0||msg.indexOf('频繁')>=0||msg.indexOf('冷却')>=0)t='warn';if(msg.indexOf('网络')>=0||msg.indexOf('暂时不可用')>=0)t='warn';__toast((prefix?prefix+'：':'')+msg,{type:t,duration:t==='warn'?3600:2800});}window.__errToast=__errToast;
async function __apiJson(r){var data=null;try{data=await r.json();}catch(e){data=null;}if(!r.ok){if(r.status===401&&data&&data.relogin){var msg=data.error||'登录已失效，请重新登录';try{sessionStorage.setItem('mt:relogin',msg);}catch(e){}__toast(msg,{type:'warn',duration:2200});setTimeout(function(){location.href='/login';},1000);var err=new Error(msg);err.relogin=true;throw err;}var msg2=(data&&data.error)||('HTTP '+r.status);var err2=new Error(__humanizeClientError(msg2,data&&data.cooling));if(data&&data.cooling!=null)err2.cooling=data.cooling;throw err2;}return data;}window.__apiJson=__apiJson;
function __confirm(opts){opts=opts||{};return new Promise(function(resolve){var modal=document.getElementById('confirm-modal');if(!modal){resolve(window.confirm(opts.message||opts.title||'确认操作'));return;}var iconEl=document.getElementById('confirm-icon'),titleEl=document.getElementById('confirm-title'),msgEl=document.getElementById('confirm-msg'),okBtn=document.getElementById('confirm-ok'),cancelBtn=document.getElementById('confirm-cancel'),backdrop=modal.querySelector('.confirm-backdrop');iconEl.className='confirm-icon'+(opts.tone?' '+opts.tone:'');iconEl.textContent=opts.icon||'?';titleEl.textContent=opts.title||'确认操作';msgEl.textContent=opts.message||'';msgEl.style.display=opts.message?'':'none';okBtn.textContent=opts.okText||'确定';cancelBtn.textContent=opts.cancelText||'取消';okBtn.className='confirm-btn confirm-ok'+(opts.tone==='danger'?' danger':'');var settled=false;function cleanup(){okBtn.removeEventListener('click',onOk);cancelBtn.removeEventListener('click',onCancel);backdrop.removeEventListener('click',onCancel);document.removeEventListener('keydown',onKey,true);modal.classList.remove('open');modal.style.display='none';}function finish(v){if(settled)return;settled=true;cleanup();resolve(v);}function onOk(){finish(true);}function onCancel(){finish(false);}function onKey(e){if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish(false);}}okBtn.addEventListener('click',onOk);cancelBtn.addEventListener('click',onCancel);backdrop.addEventListener('click',onCancel);document.addEventListener('keydown',onKey,true);modal.style.display='block';modal.classList.add('open');setTimeout(function(){try{okBtn.focus();}catch(err){}},40);});}window.__confirm=__confirm;
var __traktChain=Promise.resolve(),__traktPending=0;
function __enqueueTrakt(fn){
  var run=function(){return __traktPending>1?new Promise(function(r){setTimeout(r,1100);}).then(fn):fn();};
  __traktPending++;
  if(__traktPending>1)
    __toastOnce('queue','已收到，正在按顺序处理前面的操作…',{type:'info',duration:1800});
  var p=__traktChain.then(run,run);
  var done=function(){__traktPending=Math.max(0,__traktPending-1);};
  p.then(done,done);
  __traktChain=p.catch(function(){});
  return p;
}
window.__enqueueTrakt=__enqueueTrakt;
window.__enqueueWrite=__enqueueTrakt;
function __fadeRemoveCard(card){if(!card)return;card.style.transition='opacity 0.25s ease, transform 0.25s ease';card.style.opacity='0';card.style.transform='scale(0.96)';setTimeout(function(){var day=card.closest('.day'),pane=card.closest('.pane');card.remove();if(day&&!day.querySelector('.item')){day.style.transition='opacity 0.2s ease';day.style.opacity='0';setTimeout(function(){if(day.parentNode)day.remove();__maybeShowEmpty(pane);if(window.__afterWriteSoftRefresh)window.__afterWriteSoftRefresh();},200);return;}__maybeShowEmpty(pane);if(window.__afterWriteSoftRefresh)window.__afterWriteSoftRefresh();},260);}
function __maybeShowEmpty(pane){if(!pane)return;setTimeout(function(){if(pane.querySelector('.item'))return;if(pane.querySelector('.empty'))return;var grid=pane.querySelector('.grid');if(!grid)return;var pid=pane.id,txt='这里暂时没有内容';if(pid==='playback')txt='暂时没有继续观看的内容';else if(pid==='watchlist')txt='待看列表是空的';else if(pid==='calendar')txt='未来 30 天没有待播剧集';else if(pid==='history')txt='还没有观看记录';grid.innerHTML='<div class="empty"><p>'+txt+'</p></div>';},120);}
function __partHtml(d){return d?String((d.watchlistHtml||'')+(d.calendarHtml||'')+(d.historyHtml||'')):'';}
function __partFailed(d){if(!d)return true;var h=__partHtml(d);if(!h&&d.historyMoreHtml==null)return true;return /暂时无法加载/.test(h);}

/* ==== 日历「今天」自动保持可见（含宽屏横向滚动） ==== */
function __calReduceMotion(){
  try{return !!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion:reduce)').matches);}catch(e){return false;}
}
// 从今天那一列向上找真正的横向滚动容器（行本身、或任何祖先 overflow-x:auto/scroll）
function __calScrollerOf(el){
  if(!el)return null;
  var node=el.parentElement;
  while(node&&node!==document.body&&node!==document.documentElement){
    var ox='';
    try{ox=window.getComputedStyle(node).overflowX;}catch(e){}
    if((ox==='auto'||ox==='scroll'||ox==='overlay')&&node.scrollWidth>node.clientWidth+2)return node;
    node=node.parentElement;
  }
  var row=el.closest?el.closest('.cal-days-row'):null;
  if(row&&row.scrollWidth>row.clientWidth+2)return row;
  return null;
}
// 记录用户手动横向滚动的时间，避免自动对齐跟用户抢滚动位置
var __calUserScrollAt=0;
try{
  document.addEventListener('scroll',function(e){
    var t=e.target;
    if(!t||!t.classList)return;
    if(t.classList.contains('cal-days-row')||t.classList.contains('cal-strip')){
      if(!t.__calAuto)__calUserScrollAt=Date.now();
    }
  },true);
}catch(e){}
// 把某一列（或日期条上的某一天）滚到可见位置；已完整可见时不动，避免每次刷新都跳
function __calScrollColIntoView(el,opts){
  opts=opts||{};
  if(!el)return false;
  var cr=el.getBoundingClientRect();
  if(!cr||!cr.width)return false;
  var sc=__calScrollerOf(el);
  if(!sc){
    // 没有横向滚动（窄屏竖排）：退化成整页纵向滚动到今天
    if(opts.noPageScroll)return false;
    var sticky=document.querySelector('.top-sticky');
    var headerH=sticky?(sticky.offsetHeight||0):0;
    var cur=window.pageYOffset||document.documentElement.scrollTop||0;
    var topY=cr.top+cur-headerH-12;
    if(Math.abs(cur-Math.max(0,topY))>4){
      try{window.scrollTo({top:Math.max(0,topY),behavior:__calReduceMotion()?'auto':'smooth'});}
      catch(e){window.scrollTo(0,Math.max(0,topY));}
    }
    return true;
  }
  var sr=sc.getBoundingClientRect();
  var fullyVisible=cr.left>=sr.left-1&&cr.right<=sr.right+1;
  if(fullyVisible&&!opts.force)return true;
  var pad=12;
  var curLeft=sc.scrollLeft;
  var left=cr.left-sr.left+curLeft;
  var maxLeft=Math.max(0,sc.scrollWidth-sc.clientWidth);
  var target=opts.align==='start'
    ? left-pad
    : left-Math.max(pad,(sc.clientWidth-cr.width)/2);
  target=Math.min(maxLeft,Math.max(0,target));
  if(Math.abs(target-curLeft)<2&&!opts.force)return true;
  try{sc.__calAuto=true;setTimeout(function(){sc.__calAuto=false;},900);}catch(e){}
  try{sc.scrollTo({left:target,behavior:__calReduceMotion()?'auto':'smooth'});}
  catch(e){sc.scrollLeft=target;}
  // smooth 被忽略、或滚动过程中布局再次变化时兜底校正
  try{clearTimeout(sc.__calFixT);}catch(e){}
  try{
    sc.__calFixT=setTimeout(function(){
      var c2=el.getBoundingClientRect(),s2=sc.getBoundingClientRect();
      if(c2.left<s2.left-2||c2.right>s2.right+2){
        try{sc.scrollTo({left:target,behavior:'auto'});}catch(e){sc.scrollLeft=target;}
      }
    },420);
  }catch(e){}
  return true;
}
function __calTodayCol(){
  var on=document.querySelectorAll('.cal-week-panel.is-on .cal-day-col.is-today');
  if(on&&on.length)return on[0];
  var any=document.querySelectorAll('.cal-day-col.is-today');
  return any&&any.length?any[0]:null;
}
// 兼容旧调用：window.scrollCalendarToToday() / ({force:true,delay:100})
window.scrollCalendarToToday=function(opts){
  opts=opts||{};
  var tries=0,maxTries=opts.attempts||8;
  function tick(){
    var pane=document.getElementById('calendar');
    if(!pane||!pane.classList.contains('active')){
      // 不在日历页时不做无谓的滚动；但如果强制要求，则仍尝试
      if(!opts.force){return;}
    }
    if(opts.respectUser&&Date.now()-__calUserScrollAt<4000)return;
    var col=__calTodayCol();
    if(!col){
      if(++tries<maxTries)setTimeout(tick,120+tries*80);
      return;
    }
    var panel=col.closest('.cal-week-panel');
    if(panel&&!panel.classList.contains('is-on'))return; // 用户正在看上周/下周，不抢滚动
    var ok=__calScrollColIntoView(col,{force:!!opts.force});
    // 顶部日期条也跟到今天
    var chip=document.querySelector('.cal-week-panel.is-on .cal-strip-day.is-today');
    if(chip)__calScrollColIntoView(chip,{noPageScroll:true});
    if(!ok&&++tries<maxTries)setTimeout(tick,150);
  }
  if(opts.delay)setTimeout(tick,opts.delay);else tick();
};
// 首次进入 / 窗口尺寸变化 / 布局变化时自动对齐
(function(){
  var t=null;
  function kick(delay,opts){
    if(t)clearTimeout(t);
    t=setTimeout(function(){
      if(window.scrollCalendarToToday)window.scrollCalendarToToday(opts||{attempts:3});
    },delay||120);
  }
  function boot(){kick(120,{attempts:4});setTimeout(function(){kick(0,{attempts:4});},700);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);
  else boot();
  window.addEventListener('load',function(){kick(150,{attempts:3});});
  window.addEventListener('resize',function(){kick(180,{attempts:3,respectUser:true});});
  window.addEventListener('orientationchange',function(){kick(320,{attempts:3,respectUser:true});});
  try{
    if(window.ResizeObserver){
      var ro=new ResizeObserver(function(){kick(150,{attempts:2,respectUser:true});});
      var pane=document.getElementById('calendar');
      if(pane)ro.observe(pane);
      var row=document.querySelector('.cal-days-row');
      if(row)ro.observe(row);
    }
  }catch(e){}
})();
function __applyPart(part,d){if(!d)return false;if(part==='watchlist'){if(d.watchlistHtml)__setHTML('#watchlist',d.watchlistHtml);}else if(part==='calendar'){try{d.__fetchedAt=Date.now();}catch(e){}if(d.calendarHtml){__setHTML('#calendar',d.calendarHtml);try{var dropped=JSON.parse(localStorage.getItem('mt:dropped')||'[]');if(Array.isArray(dropped)&&dropped.length){var cal=document.getElementById('calendar');if(cal)dropped.forEach(function(did){cal.querySelectorAll('[data-drop-show-id="'+did+'"]').forEach(function(b){var card=b.closest('.item');if(card){var day=card.closest('.day');card.remove();if(day&&!day.querySelector('.item'))day.remove();}});});}}catch(e){}try{if(window.__scheduleCalAirTick)window.__scheduleCalAirTick();}catch(e){}try{if(window.scrollCalendarToToday)window.scrollCalendarToToday({delay:60,attempts:6});}catch(e){}}}else if(part==='history'){if(d.historyHtml)__setHTML('#history .grid',d.historyHtml);if(d.historyMoreHtml!=null)__setHTML('#history-more',d.historyMoreHtml);}else{return false;}if(window.__scheduleEnrich)window.__scheduleEnrich();return true;}
window.__applyPart=__applyPart;window.__partFailed=__partFailed;
var __PART_LS={watchlist:'mt:wl',calendar:'mt:cal',history:'mt:hist'};
var __PART_SNAP_TTL=259200;
function __lsGetSafe(k){try{if(typeof window.__lsGet==='function')return window.__lsGet(k);}catch(e){}try{var v=localStorage.getItem(k);if(!v)return null;var o=JSON.parse(v);if(o&&o._exp&&o._exp<Date.now()){try{localStorage.removeItem(k);}catch(e2){}return null;}return o&&o.data?o.data:null;}catch(e){return null;}}
function __lsSetSafe(k,d,ttlSec){try{if(typeof window.__lsSet==='function'){window.__lsSet(k,d,ttlSec);return;}localStorage.setItem(k,JSON.stringify({data:d,_exp:Date.now()+ttlSec*1000}));}catch(e){}}
function __savePartSnap(part,d){var k=__PART_LS[part];if(!k||!d||__partFailed(d))return;__lsSetSafe(k,d,__PART_SNAP_TTL);}
function __loadPartSnap(part){var k=__PART_LS[part];if(!k)return null;var s=__lsGetSafe(k);return s&&!__partFailed(s)?s:null;}
window.__savePartSnap=__savePartSnap;window.__loadPartSnap=__loadPartSnap;
var __partQueue = Promise.resolve();
function __fetchPartForTab(part, retry) {
  try { delete window.__loadedParts[part]; } catch (e) {}
  var p = __partQueue.then(function () {
    return window.__loadPartOnce(part)
      .then(function (d) {
        if (__partFailed(d)) {
          try { delete window.__loadedParts[part]; } catch (e) {}
          if (retry !== false) {
            return new Promise(function (r) { setTimeout(r, 800); })
              .then(function () { return __fetchPartForTab(part, false); });
          }
          return null;
        }
        __savePartSnap(part, d);
        return d;
      })
      .catch(function () {
        try { delete window.__loadedParts[part]; } catch (e) {}
        return null;
      });
  });
  __partQueue = p.catch(function () {});
  return p;
}
window.__fetchPartForTab = __fetchPartForTab;
(function(){
  var TAB_ORDER=['playback','calendar','watchlist','history','search'];
  var lastTab='playback';
  function tabIndex(name){
    var i=TAB_ORDER.indexOf(name);
    return i<0?0:i;
  }
  function syncTabPill(){
    var pill=document.getElementById('tab-pill');
    var nav=pill&&pill.parentNode;
    if(!pill||!nav)return;
    var cur=document.querySelector('.tab.active');
    if(!cur){pill.classList.remove('is-ready');return;}
    var w=cur.offsetWidth,h=cur.offsetHeight;
    var x=cur.offsetLeft,y=cur.offsetTop;
    if(!w||!h||!isFinite(x)||!isFinite(y))return;
    pill.style.width=w+'px';
    pill.style.height=h+'px';
    pill.style.transform='translate('+x+'px,'+y+'px)';
    pill.classList.add('is-ready');
  }
  window.__syncTabPill=syncTabPill;
  var __pillRaf=0;
  function scheduleSyncTabPill(){
    if(__pillRaf)return;
    __pillRaf=requestAnimationFrame(function(){
      __pillRaf=0;
      syncTabPill();
    });
  }
  window.addEventListener('resize',scheduleSyncTabPill);
  window.addEventListener('orientationchange',scheduleSyncTabPill);
  try{
    if(document.fonts&&document.fonts.ready)document.fonts.ready.then(scheduleSyncTabPill);
  }catch(e){}
  var REDUCE_MOTION=false;
  try{
    REDUCE_MOTION=window.matchMedia&&window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  }catch(e){}
  function switchPane(tabName,dir){
    var panes=document.querySelectorAll('.pane');
    var next=document.getElementById(tabName);
    if(!next)return;
    var cur=null;
    for(var i=0;i<panes.length;i++){
      if(panes[i].classList.contains('active')){cur=panes[i];break;}
    }
    if(cur===next)return;
    // 立即切换：不再等旧页退场 130ms，避免「点了不跟手」
    var anim=REDUCE_MOTION?null:(dir>0?'pane-in-left':(dir<0?'pane-in-right':'pane-in-fade'));
    for(var i=0;i<panes.length;i++){
      panes[i].classList.remove('active','pane-in-left','pane-in-right','pane-in-fade','pane-out-left','pane-out-right');
    }
    if(anim)next.classList.add('active',anim);
    else next.classList.add('active');
    try{
      var sc=document.scrollingElement||document.documentElement;
      if(sc)sc.scrollTop=0;
      else window.scrollTo(0,0);
    }catch(e){}
    if(anim){
      setTimeout(function(){
        next.classList.remove('pane-in-left','pane-in-right','pane-in-fade');
      },200);
    }
  }
  document.querySelectorAll('.tab').forEach(function(t){
    t.addEventListener('click',function(){
      var tabName=t.dataset.tab;
      if(!tabName)return;
      if(tabName===lastTab){
        try{
          var sc=document.scrollingElement||document.documentElement;
          if(sc)sc.scrollTop=0;
          else window.scrollTo(0,0);
        }catch(e){}
        return;
      }
      var from=lastTab;
      var dir=tabIndex(tabName)-tabIndex(from);
      // 1) 先立刻改 UI（跟手）
      document.querySelectorAll('.tab').forEach(function(x){x.classList.remove('active');});
      t.classList.add('active');
      lastTab=tabName;
      switchPane(tabName,dir);if(tabName==='calendar'&&window.scrollCalendarToToday)setTimeout(window.scrollCalendarToToday,80);
      scheduleSyncTabPill();
      // 2) 数据加载放到下一帧之后，避免和切页抢主线程
      if(tabName==='search'){
        setTimeout(function(){
          var inp=document.getElementById('search-input');
          if(inp)inp.focus();
          if(inp&&!inp.value.trim()&&window.__loadTrending)window.__loadTrending();
        },80);
        return;
      }
      if(tabName==='playback')return;
      var partMap={watchlist:'watchlist',calendar:'calendar',history:'history'};
      var part=partMap[tabName];
      if(!part)return;
      setTimeout(function(){
        var loaded=window.__loadedParts||{};
        if(loaded[part]&&!__partFailed(loaded[part])){
          __applyPart(part,loaded[part]);
          if(part==='calendar'){
            try{if(window.__scheduleCalAirTick)window.__scheduleCalAirTick();}catch(e){}
            var ts=Number(loaded[part].__fetchedAt||0);
            if(!ts||Date.now()-ts>12*60*1000){
              window.__fetchPartForTab(part).then(function(d){
                if(!d)return;
                d.__fetchedAt=Date.now();
                __applyPart(part,d);
                __savePartSnap(part,d);
                window.__loadedParts[part]=d;
              }).catch(function(){});
            }
          }
          return;
        }
        var snap=__loadPartSnap(part);
        if(snap)__applyPart(part,snap);
        window.__fetchPartForTab(part).then(function(d){
          if(d){
            window.__loadedParts=window.__loadedParts||{};
            window.__loadedParts[part]=d;
            __applyPart(part,d);
            return;
          }
          var lv=snap||__loadPartSnap(part);
          if(lv){
            __applyPart(part,lv);
            if(window.__toast)window.__toast('上游暂不可用，已显示上次数据',{type:'warn',duration:1800});
            return;
          }
          var p=document.getElementById(tabName);
          if(p)p.innerHTML='<div class="empty"><p>加载失败，请稍后重试</p></div>';
        }).catch(function(){
          var lv=snap||__loadPartSnap(part);
          if(lv)__applyPart(part,lv);
        });
      },0);
    },{passive:true});
  });
  requestAnimationFrame(function(){
    syncTabPill();
    setTimeout(syncTabPill,120);
  });
})();
(function(){var order=['watchlist','calendar','history'],GAP=4000;function warm(i){if(i>=order.length||document.hidden)return;var p=order[i];function next(){setTimeout(function(){warm(i+1);},GAP);}var loaded=window.__loadedParts||{};if(loaded[p]&&!__partFailed(loaded[p])){next();return;}__fetchPartForTab(p).then(function(d){if(d)__applyPart(p,d);next();});}function start(){setTimeout(function(){warm(0);},1500);}if(window.requestIdleCallback)window.requestIdleCallback(start,{timeout:3000});else start();})();
async function logout(){
  if(!(await __confirm({icon:'➜]',title:'退出登录',message:'确定要退出当前 Trakt 账号吗？',okText:'退出',cancelText:'取消',tone:'warn'})))return;
  try{localStorage.removeItem('mt:pb');localStorage.removeItem('mt:meta');}catch(e){}
  var r;
  try{
    r=await fetch('/auth/logout',{method:'POST',credentials:'same-origin'});
  }catch(e){
    __errToast('退出失败',new Error('网络连接失败'));
    return;
  }
  if(!r.ok){
    __errToast('退出失败',new Error('HTTP '+r.status));
    return;
  }
  __toast('已退出登录',{type:'success',duration:1200});
  setTimeout(function(){location.href='/login';},350);
}
window.logout=logout;
async function loadMoreHistory(btn){return __loadMore(btn,'#history .hist-days','/api/more?type=history&page='+parseInt(btn.dataset.page||'2'));}
window.loadMoreHistory=loadMoreHistory;
async function loadMoreContinue(btn){
  if(!btn)return;
  btn.disabled=true;btn.textContent='加载中…';
  var page=parseInt(btn.dataset.page||'2',10)||2;
  try{
    if(!window.__cwMoreCache)window.__cwMoreCache={ts:Date.now(),pages:{},hasMoreAfter:{}};
    var cache=window.__cwMoreCache;
    var html='',hasMore=false;
    if(cache.pages[page]!=null&&(Date.now()-(cache.ts||0))<5*60*1000){
      html=cache.pages[page]||'';
      hasMore=!!cache.hasMoreAfter[page];
    }else{
      var r=await fetch('/api/more?type=playback&page='+page+'&limit=20&mode=grid');
      if(!r.ok)throw new Error('HTTP '+r.status);
      html=await r.text();
      hasMore=r.headers.get('X-Has-More')==='true';
      cache.pages[page]=html||'';
      cache.hasMoreAfter[page]=hasMore;
      cache.ts=Date.now();
    }
    var grid=document.getElementById('cw-modal-grid');
    if(grid&&html&&html.trim()&&html.indexOf('暂时没有继续观看')<0&&html.indexOf('class="empty"')<0){
      var tmp=document.createElement('div');tmp.innerHTML=html;
      var existing=new Set();
      grid.querySelectorAll('.cw-card .cw-title, .item .name, .cw-title').forEach(function(el){
        if(el&&el.textContent)existing.add(el.textContent.trim());
      });
      tmp.querySelectorAll('.cw-card, .item').forEach(function(card){
        var t=card.querySelector('.cw-title, .name');
        var name=t?t.textContent.trim():'';
        if(name&&existing.has(name))card.remove();
        else if(name)existing.add(name);
      });
      if(tmp.innerHTML.trim())grid.insertAdjacentHTML('beforeend',tmp.innerHTML);
    }
    if(window.__scheduleEnrich)window.__scheduleEnrich();
    if(hasMore&&html&&html.trim()){
      btn.dataset.page=String(page+1);
      btn.disabled=false;btn.textContent='加载更多';btn.style.opacity='';btn.style.cursor='';
    }else{
      btn.textContent='已经到底啦';btn.disabled=true;btn.style.opacity='0.5';btn.style.cursor='default';
    }
  }catch(e){
    btn.textContent='加载失败，点击重试';btn.disabled=false;
  }
}
window.loadMoreContinue=loadMoreContinue;
async function onWatchlistSortChange(sort){const grid=document.getElementById('watchlist-grid'),pane=document.getElementById('watchlist');if(grid)grid.innerHTML='<div class="pane-loading has-sk" style="padding:18px 0">'+__skGrid(6)+'<div class="loading-note">加载中</div></div>';const oldMore=pane?pane.querySelector('.load-more-wrap'):null;if(oldMore)oldMore.remove();try{const r=await fetch('/api/more?type=watchlist&page=1&sort='+encodeURIComponent(sort));if(!r.ok)throw new Error('HTTP '+r.status);const htmlText=await r.text();if(grid)grid.innerHTML=htmlText||emptyWatchlistInner();const hasMore=r.headers.get('X-Has-More')==='true';if(hasMore&&pane&&grid){const wrap=document.createElement('div');wrap.className='load-more-wrap';wrap.innerHTML='<button class="load-more" data-page="2" data-sort="'+sort+'" onclick="loadMoreWatchlist(this)">加载更多</button>';pane.appendChild(wrap);}if(window.__scheduleEnrich)window.__scheduleEnrich();}catch(e){if(grid)grid.innerHTML='<div class="empty"><p>加载失败，请稍后重试</p></div>';}}
window.onWatchlistSortChange=onWatchlistSortChange;
function emptyWatchlistInner(){return '<div class="empty"><p>待看列表是空的</p></div>';}
async function loadMoreWatchlist(btn){return __loadMore(btn,'#watchlist-grid','/api/more?type=watchlist&page='+parseInt(btn.dataset.page||'2')+'&sort='+encodeURIComponent(btn.dataset.sort||'added'));}
window.loadMoreWatchlist=loadMoreWatchlist;
async function __loadMore(btn,gridSel,url){btn.disabled=true;btn.textContent='加载中…';try{const r=await fetch(url);if(!r.ok)throw new Error('HTTP '+r.status);const html=await r.text();const grid=document.querySelector(gridSel);if(grid)grid.insertAdjacentHTML('beforeend',html);if(window.__scheduleEnrich)window.__scheduleEnrich();if(r.headers.get('X-Has-More')==='true'){btn.dataset.page=parseInt(btn.dataset.page||'2')+1;btn.disabled=false;btn.textContent='加载更多';}else{btn.textContent='已经到底啦';btn.disabled=true;btn.style.opacity='0.5';btn.style.cursor='default';}}catch(e){btn.textContent='加载失败，点击重试';btn.disabled=false;if(window.__toastOnce)__toastOnce('more','加载失败，请稍后重试',{type:'warn',duration:2400});}}
document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-wl-remove-id]');if(!btn)return;e.preventDefault();e.stopPropagation();if(btn.disabled)return;const type=btn.dataset.wlRemoveType,id=btn.dataset.wlRemoveId;if(!type||!id)return;const item=btn.closest('.item'),nameEl=item?item.querySelector('.name'):null,name=nameEl?nameEl.textContent:'';if(!(await __confirm({icon:'🗑',title:'移除待看',message:'确定要把「'+(name||'该条目')+'」从待看列表移除吗？',okText:'移除',tone:'danger'})))return;const prevText=btn.textContent;btn.disabled=true;btn.textContent='…';try{await __enqueueWrite(async()=>{await __apiWrite('/api/watchlist/remove',{type,id},{okMsg:'已移出待看列表',failPrefix:'移除失败'});__fadeRemoveCard(btn.closest('.item'));});}catch(err){btn.disabled=false;btn.textContent=prevText;__errToast('移除失败',err);}},true);
function __ensureCwSheet(){
  var el=document.getElementById('cw-sheet');
  if(el)return el;
  el=document.createElement('div');
  el.id='cw-sheet';
  el.className='cw-sheet';
  el.innerHTML='<div class="cw-sheet-backdrop" data-cw-sheet-close="1"></div><div class="cw-sheet-panel" role="menu"><div class="cw-sheet-title" id="cw-sheet-title"></div><button type="button" class="cw-sheet-item" id="cw-sheet-hide">移除进度</button><button type="button" class="cw-sheet-item danger" id="cw-sheet-drop">弃看剧集</button><button type="button" class="cw-sheet-item" id="cw-sheet-watched" style="display:none">标记为已看</button><button type="button" class="cw-sheet-item cw-sheet-cancel" data-cw-sheet-close="1">取消</button></div>';
  document.body.appendChild(el);
  el.addEventListener('click',function(ev){
    if(ev.target.closest('[data-cw-sheet-close]')){__closeCwSheet();return;}
  });
  var hideBtn=el.querySelector('#cw-sheet-hide');
  if(hideBtn){
    hideBtn.addEventListener('click',function(ev){
      ev.preventDefault();
      ev.stopPropagation();
      var id=el.dataset.dropShowId;
      var name=el.dataset.cwName||'';
      var season=el.dataset.cwSeason||'';
      var episode=el.dataset.cwEpisode||'';
      var mediaType=el.dataset.cwMediaType||'';
      var mediaId=el.dataset.cwMediaId||'';
      if(!id){__closeCwSheet();return;}
      __closeCwSheet();
      setTimeout(function(){
        if(typeof __hideContinueById==='function') __hideContinueById(id,name,season,episode,mediaType,mediaId);
      },80);
    });
  }
  var dropBtn=el.querySelector('#cw-sheet-drop');
  if(dropBtn){
    dropBtn.addEventListener('click',function(ev){
      ev.preventDefault();
      ev.stopPropagation();
      var id=el.dataset.dropShowId;
      var name=el.dataset.cwName||'';
      if(!id){__closeCwSheet();return;}
      __closeCwSheet();
      setTimeout(function(){
        if(typeof __dropShowById==='function') __dropShowById(id,name);
      },80);
    });
  }
  return el;
}
function __openCwSheet(id,name,season,episode,mediaType,mediaId){
  var el=__ensureCwSheet();
  el.dataset.dropShowId=id||'';
  el.dataset.cwName=name||'';
  el.dataset.cwSeason=season!=null?String(season):'';
  el.dataset.cwEpisode=episode!=null?String(episode):'';
  el.dataset.cwMediaType=mediaType||'';
  el.dataset.cwMediaId=mediaId!=null?String(mediaId):'';
  var t=el.querySelector('#cw-sheet-title');
  if(t)t.textContent=name||'更多操作';
  el.style.display='';
  el.classList.add('open');
  document.body.style.overflow='hidden';
}
function __closeCwSheet(){
  var el=document.getElementById('cw-sheet');
  if(!el)return;
  el.classList.remove('open');
  el.style.display='none';
  document.body.style.overflow='';
  requestAnimationFrame(function(){
    if(!el.classList.contains('open')) el.style.display='';
  });
}
document.addEventListener('click',function(e){
  var more=e.target.closest('.cw-more');
  if(more){
    e.preventDefault();
    e.stopPropagation();
    var id=more.getAttribute('data-cw-drop-id');
    if(!id)return;
    var name=more.getAttribute('data-cw-name')||'';
    var season=more.getAttribute('data-cw-season')||'';
    var episode=more.getAttribute('data-cw-episode')||'';
    var mediaType=more.getAttribute('data-cw-media-type')||'';
    var mediaId=more.getAttribute('data-cw-media-id')||'';
    if(!name){
      var card=more.closest('.cw-card')||more.closest('.item');
      var te=card?(card.querySelector('.cw-title')||card.querySelector('.name')):null;
      if(te)name=(te.textContent||'').trim();
    }
    if(typeof __openCwSheet==='function') __openCwSheet(id,name,season,episode,mediaType,mediaId);
    return;
  }
  var hideBtn=e.target.closest('[data-cw-hide]');
  if(hideBtn){
    e.preventDefault();
    e.stopPropagation();
    var id=hideBtn.getAttribute('data-cw-drop-id');
    if(!id)return;
    var name=hideBtn.getAttribute('data-cw-name')||'';
    var season=hideBtn.getAttribute('data-cw-season')||'';
    var episode=hideBtn.getAttribute('data-cw-episode')||'';
    var mediaType=hideBtn.getAttribute('data-cw-media-type')||'';
    var mediaId=hideBtn.getAttribute('data-cw-media-id')||'';
    if(typeof __hideContinueById==='function') __hideContinueById(id,name,season,episode,mediaType,mediaId);
    return;
  }
  var dropBtn=e.target.closest('[data-cw-drop]');
  if(dropBtn){
    e.preventDefault();
    e.stopPropagation();
    var id2=dropBtn.getAttribute('data-cw-drop-id');
    if(!id2)return;
    var name2=dropBtn.getAttribute('data-cw-name')||'';
    if(typeof __dropShowById==='function') __dropShowById(id2,name2);
    return;
  }
},true);
document.addEventListener('keydown',function(e){
  if(e.key==='Escape')__closeCwSheet();
});
async function __hideContinueById(id, name, season, episode, mediaType, mediaId){
  id=String(id||'').trim();
  if(!id)return;
  name=(name||'').trim();
  var s=season!=null&&season!==''?Number(season):0;
  var e=episode!=null&&episode!==''?Number(episode):0;
  var mt=(mediaType||'episode')+'';
  var mid=mediaId!=null&&mediaId!==''?Number(mediaId):0;
  if(!(await __confirm({icon:'⌫',title:'移除进度',message:'确定要移除「'+(name||'该剧')+'」的观看进度吗？移除后将从继续观看消失，之后再看或出新集会自动回来；日历与观看历史保留。',okText:'移除进度',tone:'warn'})))return;
  try{
    await __enqueueTrakt(async()=>{
      const payload={id:Number(id),season:s,episode:e};
      if(mid>0&&(mt==='episode'||mt==='movie')){payload.type=mt;payload.mediaId=mid;}
      await __apiWrite('/api/hide-continue',payload,{okMsg:'已移除进度',failPrefix:'移除失败'});
      document.querySelectorAll('[data-cw-drop-id="'+id+'"]').forEach(function(b){
        const card=b.closest('.item')||b.closest('.cw-card');
        if(card)__fadeRemoveCard(card);
      });
      if(window.__loadedParts){
        delete window.__loadedParts.playback;
        delete window.__loadedParts.all;
      }
      try{
        fetch('/api/home-data?part=playback',{credentials:'same-origin',cache:'no-store'})
          .then(function(r){return r.ok?r.json():null;})
          .then(function(d){
            if(!d)return;
            if(window.__applyPlayback)window.__applyPlayback(d,false);
            else if(d.playbackHScrollHtml){
              var el=document.getElementById('playback-hscroll');
              if(el)el.innerHTML=d.playbackHScrollHtml;
            }
            try{if(window.__lsSet)window.__lsSet('mt:pb',d,MT_PB_SNAP_TTL);}catch(e){}
          }).catch(function(){});
      }catch(e){}
    });
  }catch(err){
    __errToast('移除失败',err);
  }
}
function __openCwSheet(id,name,season,episode,mediaType,mediaId){
  var el=__ensureCwSheet();
  el.dataset.dropShowId=id||'';
  el.dataset.cwName=name||'';
  el.dataset.cwSeason=season!=null?String(season):'';
  el.dataset.cwEpisode=episode!=null?String(episode):'';
  el.dataset.cwMediaType=mediaType||'';
  el.dataset.cwMediaId=mediaId!=null?String(mediaId):'';
  var t=el.querySelector('#cw-sheet-title');
  if(t)t.textContent=name||'更多操作';

  var dropBtn=el.querySelector('#cw-sheet-drop');
  var watchedBtn=el.querySelector('#cw-sheet-watched');
  var isMovie=(mediaType==='movie');
  if(dropBtn) dropBtn.style.display=isMovie?'none':'';
  if(watchedBtn){
    watchedBtn.style.display=isMovie?'':'none';
    watchedBtn.onclick=function(ev){
      ev.preventDefault();ev.stopPropagation();
      __closeCwSheet();
      setTimeout(function(){
        if(typeof markWatched==='function') markWatched(mediaType,mediaId);
      },80);
    };
  }

  el.style.display='';
  el.classList.add('open');
  document.body.style.overflow='hidden';
}
async function __dropShowById(id, name){
  id=String(id||'').trim();
  if(!id)return;
  name=(name||'').trim();
  if(!(await __confirm({icon:'🗑',title:'弃看剧集',message:'确定要弃看「'+(name||'该剧')+'」吗？弃看后将从追剧日历和继续观看中移除，观看历史保留。',okText:'弃看',tone:'danger'})))return;
  try{
    await __enqueueTrakt(async()=>{
      await __apiWrite('/api/drop-show',{id:Number(id)},{okMsg:'已弃看剧集',failPrefix:'弃看失败'});
      try{
        var ds=JSON.parse(localStorage.getItem('mt:dropped')||'[]');
        if(!Array.isArray(ds))ds=[];
        if(ds.indexOf(String(id))<0)ds.push(String(id));
        localStorage.setItem('mt:dropped',JSON.stringify(ds.slice(-200)));
      }catch(e){}
      document.querySelectorAll('.cw-card [data-cw-drop-id="'+id+'"]').forEach(function(b){
        const card=b.closest('.item');
        if(card)__fadeRemoveCard(card);
      });
      document.querySelectorAll('[data-drop-show-id="'+id+'"]').forEach(function(b){
        const card=b.closest('.item');
        if(card)__fadeRemoveCard(card);
      });
      if(window.__loadedParts){
        delete window.__loadedParts.calendar;
        delete window.__loadedParts.playback;
        delete window.__loadedParts.all;
      }
      try{
        fetch('/api/home-data?part=calendar',{credentials:'same-origin',cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).then(function(d){
          if(!d||!d.calendarHtml)return;
          var cal=document.getElementById('calendar');
          if(!cal)return;
          cal.innerHTML=d.calendarHtml;
          try{
            var dropped=JSON.parse(localStorage.getItem('mt:dropped')||'[]');
            if(Array.isArray(dropped)&&dropped.length){
              dropped.forEach(function(did){
                cal.querySelectorAll('[data-drop-show-id="'+did+'"]').forEach(function(b){
                  var card=b.closest('.item');
                  if(card){
                    var day=card.closest('.day');
                    card.remove();
                    if(day&&!day.querySelector('.item'))day.remove();
                  }
                });
              });
            }
          }catch(e){}
          if(window.__scheduleEnrich)window.__scheduleEnrich();
        }).catch(function(){});
        fetch('/api/home-data?part=playback',{credentials:'same-origin',cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).then(function(d){
          if(!d||!d.playbackHScrollHtml)return;
          var el=document.getElementById('playback-hscroll');
          if(el)el.innerHTML=d.playbackHScrollHtml;
          if(window.__scheduleEnrich)window.__scheduleEnrich();
        }).catch(function(){});
      }catch(e){}
    });
  }catch(err){
    __errToast('弃看失败',err);
  }
}
window.__dropShowById=__dropShowById;
document.addEventListener('click',async(e)=>{
  const btn=e.target.closest('[data-drop-show-id]');
  if(!btn)return;
  if(btn.closest('#cw-sheet'))return;
  if(btn.style&&btn.style.opacity==='0')return;
  e.preventDefault();
  e.stopPropagation();
  if(btn.disabled)return;
  const id=btn.dataset.dropShowId;
  if(!id)return;
  const item=btn.closest('.item');
  const nameEl=item?(item.querySelector('.cw-title')||item.querySelector('.name')):null;
  const name=nameEl?nameEl.textContent.trim().split(/\s+第/)[0]:'';
  await __dropShowById(id,name);
},true);
document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-watched-id]');if(!btn)return;e.preventDefault();e.stopPropagation();if(btn.disabled)return;const type=btn.dataset.watchedType,id=btn.dataset.watchedId;if(!type||!id)return;const item=btn.closest('.item');const nameEl=item?(item.querySelector('.name')||item.querySelector('.cw-title')):null;const name=nameEl?nameEl.textContent:'';if(!(await __confirm({icon:'✓',title:'标记已看',message:'确定要把「'+(name||'该条目')+'」标记为已看吗？',okText:'标记',tone:'success'})))return;const prev=btn.textContent;btn.disabled=true;btn.textContent='…';try{await __enqueueTrakt(async()=>{await __apiWrite('/api/mark-watched',{type,id},{okMsg:'已标记为已看',failPrefix:'标记失败'});__fadeRemoveCard(btn.closest('.item'));});}catch(err){btn.disabled=false;btn.textContent=prev;__errToast('标记失败',err);}},true);
document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-unwatch-id]');if(!btn)return;e.preventDefault();e.stopPropagation();if(btn.disabled)return;const type=btn.dataset.unwatchType,id=btn.dataset.unwatchId;if(!type||!id)return;const item=btn.closest('.item'),nameEl=item?item.querySelector('.name'):null,name=nameEl?nameEl.textContent:'';if(!(await __confirm({icon:'↺',title:'取消观看',message:'确定要取消「'+(name||'该条目')+'」的观看记录吗？',okText:'取消观看',tone:'warn'})))return;const prev=btn.textContent;btn.disabled=true;btn.textContent='…';try{await __enqueueTrakt(async()=>{await __apiWrite('/api/unmark-watched',{type,id},{okMsg:'已取消观看记录',failPrefix:'取消失败'});__fadeRemoveCard(btn.closest('.item'));});}catch(err){btn.disabled=false;btn.textContent=prev;__errToast('取消失败',err);}},true);
var __searchTimer=null,__searchSeq=0;
function __renderSearchItem(it){var emoji=it.type==='movie'?'🎬':'📺';var poster=it.poster?'<img src="'+__esc(it.poster)+'" loading="lazy" decoding="async" alt="">':'<div class="poster-ph"><span>'+emoji+'</span></div>';var tag=it.type==='movie'?'电影':'剧集';var ov=it.overview?'<div class="overview">'+__esc(it.overview)+'</div>':'';return '<div class="item clickable" data-detail-type="'+it.type+'" data-detail-id="tmdb-'+it.tmdbId+'" role="button" tabindex="0"><div class="poster">'+poster+'</div><div class="info"><div class="name-row"><span class="name">'+__esc(it.title)+'</span></div><div class="meta">'+tag+(it.year?' · '+__esc(String(it.year)):'')+'</div>'+ov+'</div></div>';}
async function __doSearch(q){var box=document.getElementById('search-results');if(!box)return;if(!q){__loadTrending();return;}var seq=++__searchSeq;box.innerHTML='<div class="pane-loading has-sk" style="padding:18px 0">'+__skGrid(6)+'<div class="loading-note">加载中</div></div>';try{var r=await fetch('/api/search?q='+encodeURIComponent(q));if(seq!==__searchSeq)return;if(!r.ok)throw new Error('HTTP '+r.status);var data=await r.json();if(seq!==__searchSeq)return;var items=(data&&data.items)||[];if(!items.length){box.innerHTML='<div class="empty"><p>没有找到相关结果</p></div>';return;}box.innerHTML=items.map(__renderSearchItem).join('');}catch(err){if(seq!==__searchSeq)return;box.innerHTML='<div class="empty"><p>搜索失败：'+__esc(err.message)+'</p></div>';}}
var __trendingLoaded=false;
function __isTrendCollapsed(id){try{return localStorage.getItem('mt:trend-col:'+id)==='1';}catch(e){return false;}}
function __wrapTrendingSection(id,title,itemsHtml){var collapsed=__isTrendCollapsed(id);return '<div class="trending-section'+(collapsed?' is-collapsed':'')+'" data-trend-sec="'+id+'"><button type="button" class="trending-head" aria-expanded="'+(collapsed?'false':'true')+'"><span class="trending-head-label">'+title+'</span><svg class="trending-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button><div class="trending-body"><div class="h-scroll trending-scroll">'+itemsHtml+'</div></div></div>';}
async function __loadReco(force){try{var r=await fetch('/api/reco'+(force?'?force=1':''));if(!r.ok)return '';var d=await r.json();var items=(d&&d.items)||[];if(!items.length)return '';return __wrapTrendingSection('reco','Trakt 为你推荐',items.map(__renderSearchItem).join(''));}catch(e){return '';}}
async function __loadTrending(force){var box=document.getElementById('search-results');if(!box)return;var inp=document.getElementById('search-input');if(inp&&inp.value.trim())return;if(box.querySelector('.trending-head')&&!force)return;box.innerHTML='<div class="pane-loading has-sk" style="padding:18px 0">'+__skGrid(6)+'<div class="loading-note">正在加载趋势与推荐</div></div>';var parts=await Promise.all([__loadReco(force),(async function(){try{var r=await fetch('/api/trending');if(!r.ok)throw new Error('HTTP '+r.status);var data=await r.json();var items=(data&&data.items)||[];if(!items.length)return '';__trendingLoaded=true;return __wrapTrendingSection('tmdb','TMDB 今日趋势',items.map(__renderSearchItem).join(''));}catch(err){return '';}})()]);var html=(parts[1]||'')+(parts[0]||'');if(!html){box.innerHTML='<div class="empty"><p>暂无推荐内容</p></div>';return;}box.innerHTML=html;}
document.addEventListener('click',function(e){var head=e.target.closest('#search-results .trending-head');if(!head)return;var sec=head.closest('.trending-section');if(!sec)return;e.preventDefault();e.stopPropagation();var collapsed=sec.classList.toggle('is-collapsed');head.setAttribute('aria-expanded',collapsed?'false':'true');var id=sec.getAttribute('data-trend-sec');if(id){try{localStorage.setItem('mt:trend-col:'+id,collapsed?'1':'0');}catch(err){}}},true);
function __findHScroll(t){
  var el=t&&t.closest?t.closest('.h-scroll, .trending-scroll, .cal-days-row'):null;
  if(el)return el;
  var n=t;
  while(n&&n.nodeType===1&&n!==document.body&&n!==document.documentElement){
    if(n.scrollWidth>n.clientWidth+2){
      var ov=getComputedStyle(n).overflowX;
      if(ov==='auto'||ov==='scroll')return n;
    }
    n=n.parentElement;
  }
  return null;
}
document.addEventListener('wheel',function(e){var sc=__findHScroll(e.target);if(!sc)return;if(Math.abs(e.deltaY)<=Math.abs(e.deltaX))return;if(sc.scrollWidth<=sc.clientWidth+2)return;var atStart=sc.scrollLeft<=0,atEnd=sc.scrollLeft+sc.clientWidth>=sc.scrollWidth-2;if((e.deltaY<0&&atStart)||(e.deltaY>0&&atEnd))return;e.preventDefault();if(sc.__snapT)clearTimeout(sc.__snapT);if(!sc.__snapOff){sc.__snapOff=1;sc.style.scrollSnapType='none';}sc.scrollLeft+=e.deltaY;sc.__snapT=setTimeout(function(){sc.style.scrollSnapType='';sc.__snapOff=0;},160);},{passive:false});
document.addEventListener('scroll',function(e){
  var t=e.target;
  if(!t||!t.classList||t.nodeType!==1)return;
  var strip,row;
  if(t.classList.contains('cal-days-row')){row=t;strip=t.closest('.cal-week-panel')?t.closest('.cal-week-panel').querySelector('.cal-strip'):null;}
  else if(t.classList.contains('cal-strip')){strip=t;row=t.closest('.cal-week-panel')?t.closest('.cal-week-panel').querySelector('.cal-days-row'):null;}
  else return;
  var other=row===t?strip:row;
  if(!other||other.__calSync===t)return;
  other.__calSync=t;
  other.scrollLeft=t.scrollLeft;
  setTimeout(function(){other.__calSync=null;},0);
},true);
window.__loadTrending=__loadTrending;
(function(){var inp=document.getElementById('search-input');if(!inp)return;inp.addEventListener('input',function(){if(__searchTimer)clearTimeout(__searchTimer);var q=inp.value.trim();if(!q){__loadTrending();return;}__searchTimer=setTimeout(function(){__doSearch(q);},380);});inp.addEventListener('keydown',function(e){if(e.key==='Enter'){if(__searchTimer)clearTimeout(__searchTimer);var q=inp.value.trim();if(q)__doSearch(q);else __loadTrending(true);}});})();
document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-wl-add-detail]');if(!btn)return;e.preventDefault();e.stopPropagation();if(btn.disabled)return;const type=btn.dataset.wlAddDetailType,tmdbId=btn.dataset.wlAddDetail;if(!type||!tmdbId)return;const nameEl=document.querySelector('.detail-title');const name=nameEl?nameEl.textContent:'';if(!(await __confirm({icon:'＋',title:'加入待看',message:'确定要把「'+(name||'该条目')+'」加入待看列表吗？',okText:'加入',tone:'success'})))return;const prevHtml=btn.innerHTML;btn.disabled=true;btn.classList.add('loading');try{await __enqueueWrite(async()=>{await __apiWrite('/api/watchlist/add',{type:type,tmdbId:Number(tmdbId)||tmdbId},{okMsg:'已加入待看列表',failPrefix:'加入失败'});btn.classList.remove('loading');btn.classList.add('active');btn.disabled=true;btn.removeAttribute('data-wl-add-detail');btn.removeAttribute('data-wl-add-detail-type');btn.setAttribute('title','已在待看');btn.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" stroke="none"><path d="M7 3h10a1 1 0 0 1 1 1v16l-6-3.5L6 20V4a1 1 0 0 1 1-1z"/></svg>';__toast('已加入待看列表',{type:'success'});try{if(window.__loadedParts)delete window.__loadedParts.watchlist;}catch(e){}try{if(typeof fetchPart==='function'){fetchPart('watchlist',true).then(function(d){if(!d)return;if(window.__applyPart)window.__applyPart('watchlist',d);if(window.__savePartSnap)window.__savePartSnap('watchlist',d);if(window.__loadedParts)window.__loadedParts.watchlist=d;}).catch(function(){});}}catch(e){}if(document.getElementById('watchlist-grid')&&typeof onWatchlistSortChange==='function'){try{onWatchlistSortChange('added');}catch(e){}}if(window.__afterWriteSoftRefresh)window.__afterWriteSoftRefresh();});}catch(err){btn.disabled=false;btn.classList.remove('loading');btn.innerHTML=prevHtml;__errToast('加入失败',err);}},true);
var __listModalSections={
  playback:{title:'继续观看',kind:'playback'},
  guduo:{title:'骨朵热榜',kind:'tabsGrid',tabsApi:'/api/guduo-list?mode=categories',tabsKey:'categories',tabsParam:'category',noAll:true,defaultCat:'剧集',listApi:function(cat){return '/api/guduo-list?mode=grid&category='+encodeURIComponent(cat||'剧集');},gridId:'guduo-grid',tabsId:'guduo-filter-tabs'},
  theater:{title:'平台剧场',kind:'simpleGrid',listApi:function(){return '/api/theater-list?platform=all&mode=grid';},gridId:'theater-grid'},
  'douban-domestic':{title:'豆瓣热播国产剧',kind:'simpleGrid',listApi:function(){return '/api/douban-list?section=domestic&mode=grid';},gridId:'douban-modal-grid'},
  'douban-jpkr':{title:'豆瓣热播日韩剧',kind:'simpleGrid',listApi:function(){return '/api/douban-list?section=jpkr&mode=grid';},gridId:'douban-modal-grid'},
  'douban-western':{title:'豆瓣热播欧美剧',kind:'simpleGrid',listApi:function(){return '/api/douban-list?section=western&mode=grid';},gridId:'douban-modal-grid'},
  'douban-animation':{title:'豆瓣热播动画',kind:'simpleGrid',listApi:function(){return '/api/douban-list?section=animation&mode=grid';},gridId:'douban-modal-grid'},
  'douban-documentary':{title:'豆瓣热播纪录片',kind:'simpleGrid',listApi:function(){return '/api/douban-list?section=documentary&mode=grid';},gridId:'douban-modal-grid'},
  'douban-variety':{title:'豆瓣热播综艺',kind:'simpleGrid',listApi:function(){return '/api/douban-list?section=variety&mode=grid';},gridId:'douban-modal-grid'}
};
function __openSimpleGridModal(body,cfg){
  var gid=cfg.gridId||'list-modal-grid';
  body.innerHTML='<div id="'+gid+'" class="grid"><div class="pane-loading has-sk" style="padding:14px 0">'+__skGrid(6)+'</div></div>';
  var grid=document.getElementById(gid);
  var url=typeof cfg.listApi==='function'?cfg.listApi():cfg.listApi;
  fetch(url).then(function(r){return r.ok?r.text():'';}).then(function(html){
    if(!grid)return;
    grid.innerHTML=html||'<div class="empty"><p>暂无内容</p></div>';
    if(window.__scheduleEnrich)window.__scheduleEnrich();
  }).catch(function(){if(grid)grid.innerHTML='<div class="empty"><p>加载失败，请稍后重试</p></div>';});
}
function __openTabsGridModal(body,cfg){
  var tabsId=cfg.tabsId||'list-filter-tabs';
  var gid=cfg.gridId||'list-modal-grid';
  body.innerHTML='<div id="'+tabsId+'" class="douban-filter-tabs" style="display:none"></div><div id="'+gid+'" class="grid"><div class="pane-loading has-sk" style="padding:14px 0">'+__skGrid(6)+'</div></div>';
  var grid=document.getElementById(gid),tabsBox=document.getElementById(tabsId);
  function loadList(val){
    if(!grid)return;
    grid.innerHTML='<div class="pane-loading has-sk" style="padding:18px 0">'+__skGrid(6)+'<div class="loading-note">加载中</div></div>';
    var url=typeof cfg.listApi==='function'?cfg.listApi(val):cfg.listApi;
    fetch(url).then(function(r){return r.ok?r.text():'';}).then(function(html){
      grid.innerHTML=html||'<div class="empty"><p>暂无内容</p></div>';
      if(window.__scheduleEnrich)window.__scheduleEnrich();
    }).catch(function(){grid.innerHTML='<div class="empty"><p>加载失败，请稍后重试</p></div>';});
  }
  loadList(cfg.noAll?(cfg.defaultCat||'剧集'):'all');
  if(!cfg.tabsApi||!tabsBox)return;
  fetch(cfg.tabsApi).then(function(r){return r.ok?r.json():{};}).then(function(d){
    var list=(d&&d[cfg.tabsKey||'categories'])||[];
    if(!list.length)return;
    var counts=(d&&d.counts)||{};
    var param=cfg.tabsParam||'category';
    var defCat=cfg.defaultCat||(list[0]||'all');
    // 默认分类当天为空时，自动落到第一个有数据的分类
    if(counts&&typeof counts[defCat]==='number'&&counts[defCat]<=0){
      for(var x=0;x<list.length;x++){if(counts[list[x]]>0){defCat=list[x];break;}}
    }
    var html='';
    if(!cfg.noAll){html+='<button class="douban-filter-tab active" data-val="all">全部</button>';}
    for(var i=0;i<list.length;i++){
      var act='';
      if(cfg.noAll){
        if(list[i]===defCat)act=' active';
        else if(i===0&&list.indexOf(defCat)<0)act=' active';
      }
      var cnt=counts[list[i]];
      var isEmpty=(typeof cnt==='number'&&cnt<=0);
      html+='<button class="douban-filter-tab'+act+(isEmpty?' is-empty':'')+'" data-val="'+__esc(list[i])+'"'+(isEmpty?' title="今日暂无数据"':'')+'>'+__esc(list[i])+'</button>';
    }
    tabsBox.innerHTML=html;tabsBox.style.display='';
    if(cfg.noAll&&defCat!==(cfg.defaultCat||'剧集'))loadList(defCat);
    tabsBox.addEventListener('click',function(e){
      var btn=e.target.closest('.douban-filter-tab');if(!btn)return;
      tabsBox.querySelectorAll('.douban-filter-tab').forEach(function(b){b.classList.remove('active');});
      btn.classList.add('active');
      loadList(btn.getAttribute('data-val')||defCat);
    });
  }).catch(function(){});
}
window.openListModal=function(id){
  var cfg=__listModalSections[id];
  if(!cfg)return;
  var modal=document.getElementById('list-modal');
  var title=document.getElementById('list-modal-title');
  var body=document.getElementById('list-modal-body');
  if(!modal||!title||!body)return;
  title.textContent=cfg.title||'';
  body.innerHTML='<div class="pane-loading has-sk" style="padding:14px 0">'+__skGrid(6)+'</div>';
  modal.classList.add('open');
  document.body.style.overflow='hidden';
  if(cfg.kind==='playback'||id==='playback'){
    body.innerHTML='<div id="cw-modal-grid" class="grid cw-modal-grid"><div class="pane-loading has-sk" style="padding:14px 0">'+__skGrid(6)+'</div></div><div id="cw-modal-more-wrap" class="load-more-wrap" style="display:none"></div>';
    function __cwApplyPage1(res){
      var grid=document.getElementById('cw-modal-grid');
      var wrap=document.getElementById('cw-modal-more-wrap');
      if(!grid)return;
      if(res.html&&res.html.trim()){grid.innerHTML=res.html;}
      else{grid.innerHTML='<div class="empty"><p>暂无内容</p></div>';}
      if(res.hasMore&&wrap){
        wrap.style.display='';
        wrap.innerHTML='<button class="load-more" data-page="2" type="button" onclick="loadMoreContinue(this)">加载更多</button>';
      }else if(wrap){
        wrap.style.display=res.html&&res.html.trim()?'':'none';
        wrap.innerHTML=res.html&&res.html.trim()?'<div class="load-more-end" style="text-align:center;padding:14px 0 8px;color:var(--text-mute,#71717a);font-size:0.82rem">已经到底啦</div>':'';
      }
      if(window.__scheduleEnrich)window.__scheduleEnrich();
    }
    var cache=window.__cwMoreCache;
    var now=Date.now();
    var TTL=5*60*1000;
    if(cache&&cache.ts&&(now-cache.ts)<TTL&&cache.pages&&cache.pages[1]){
      __cwApplyPage1({html:cache.pages[1],hasMore:!!cache.hasMoreAfter[1]});
      return;
    }
    fetch('/api/more?type=playback&page=1&limit=20&mode=grid').then(function(r){
      if(!r.ok)throw new Error('HTTP '+r.status);
      return r.text().then(function(html){return{html:html,hasMore:r.headers.get('X-Has-More')==='true'};});
    }).then(function(res){
      window.__cwMoreCache={ts:Date.now(),pages:{1:res.html||''},hasMoreAfter:{1:!!res.hasMore}};
      __cwApplyPage1(res);
    }).catch(function(){
      var grid=document.getElementById('cw-modal-grid');
      if(grid)grid.innerHTML='<div class="empty"><p>加载失败，请稍后重试</p></div>';
    });
    return;
  }
  if(cfg.kind==='tabsGrid'){__openTabsGridModal(body,cfg);return;}
  if(cfg.kind==='simpleGrid'){__openSimpleGridModal(body,cfg);return;}
  if(cfg.listApi){__openSimpleGridModal(body,cfg);return;}
};
window.__platformNames={netflix:"Netflix",disney:"Disney+",appletv:"Apple TV+",hbomax:"HBO Max",prime:"Prime Video",iqiyi:"爱奇艺",youku:"优酷",tencent:"腾讯视频",mgtv:"芒果TV",bilibili:"哔哩哔哩"};
window.__platformState={id:null,media:"all",page:1,loading:false,hasMore:false};
window.openPlatformList=function(platformId){
  var name=window.__platformNames[platformId]||platformId;
  var modal=document.getElementById("list-modal");
  var title=document.getElementById("list-modal-title");
  var body=document.getElementById("list-modal-body");
  if(!modal||!title||!body)return;
  title.textContent=name;
  window.__platformState={id:platformId,media:"all",page:1,loading:false,hasMore:false};
  body.innerHTML='<div class="douban-filter-tabs" id="platform-media-tabs"><button class="douban-filter-tab active" data-media="all">全部</button><button class="douban-filter-tab" data-media="movie">电影</button><button class="douban-filter-tab" data-media="tv">剧集</button></div><div id="platform-grid" class="grid"><div class="pane-loading has-sk" style="padding:14px 0">${skGridHtml(6)}</div></div><div class="load-more-wrap" id="platform-more-wrap" style="display:none"><button type="button" class="load-more" id="platform-load-more">加载更多</button></div>';
  modal.classList.add("open");
  document.body.style.overflow="hidden";
  function setLoading(on){
    var btn=document.getElementById("platform-load-more");
    if(btn){btn.disabled=!!on;btn.textContent=on?"加载中…":"加载更多";}
    window.__platformState.loading=!!on;
  }
  function load(media,page,append){
    var st=window.__platformState;
    if(st.loading)return;
    st.media=media||st.media||"all";
    st.page=page||1;
    var grid=document.getElementById("platform-grid");
    var moreWrap=document.getElementById("platform-more-wrap");
    if(!grid)return;
    if(!append)grid.innerHTML='<div class="pane-loading has-sk" style="padding:18px 0">'+__skGrid(6)+'<div class="loading-note">加载中</div></div>';
    setLoading(true);
    fetch("/api/platform-list?id="+encodeURIComponent(st.id)+"&media="+encodeURIComponent(st.media)+"&page="+encodeURIComponent(st.page)+"&mode=grid")
      .then(function(r){return r.ok?r.text():"";})
      .then(function(html){
        setLoading(false);
        var tmp=document.createElement("div");
        tmp.innerHTML=html||"";
        var wrap=tmp.querySelector(".platform-result");
        var inner=wrap?wrap.innerHTML:(html||"");
        var hasMore=wrap&&wrap.getAttribute("data-has-more")==="1";
        var totalPages=wrap?parseInt(wrap.getAttribute("data-total-pages")||"1",10):1;
        st.hasMore=!!hasMore;
        st.page=wrap?parseInt(wrap.getAttribute("data-page")||String(st.page),10):st.page;
        if(append){
          var empty=grid.querySelector(".empty,.pane-loading");
          if(empty)empty.remove();
          grid.insertAdjacentHTML("beforeend",inner);
        }else{
          grid.innerHTML=inner||'<div class="empty"><p>暂无该平台内容</p></div>';
        }
        if(moreWrap)moreWrap.style.display=st.hasMore?"block":"none";
        if(window.__scheduleEnrich)window.__scheduleEnrich();
      })
      .catch(function(){
        setLoading(false);
        if(!append)grid.innerHTML='<div class="empty"><p>加载失败，请稍后重试</p></div>';
      });
  }
  load("all",1,false);
  var tabs=document.getElementById("platform-media-tabs");
  if(tabs){
    tabs.addEventListener("click",function(e){
      var btn=e.target.closest(".douban-filter-tab");
      if(!btn)return;
      tabs.querySelectorAll(".douban-filter-tab").forEach(function(b){b.classList.remove("active");});
      btn.classList.add("active");
      load(btn.getAttribute("data-media")||"all",1,false);
    });
  }
  var moreBtn=document.getElementById("platform-load-more");
  if(moreBtn){
    moreBtn.addEventListener("click",function(){
      var st=window.__platformState;
      if(!st.hasMore||st.loading)return;
      load(st.media,st.page+1,true);
    });
  }
};
document.addEventListener("click",function(e){
  var tBtn=e.target&&e.target.closest&&e.target.closest(".platform-card[data-theater-platform]");
  if(tBtn){
    e.preventDefault();
    e.stopPropagation();
    var tp=tBtn.getAttribute("data-theater-platform");
    if(tp&&window.openTheaterPlatformList)window.openTheaterPlatformList(tp);
    return;
  }
  var btn=e.target&&e.target.closest&&e.target.closest(".platform-card[data-platform-id]");
  if(!btn)return;
  e.preventDefault();
  e.stopPropagation();
  var id=btn.getAttribute("data-platform-id");
  if(id)window.openPlatformList(id);
});
window.openTheaterPlatformList=function(platform){
  var modal=document.getElementById("list-modal");
  var title=document.getElementById("list-modal-title");
  var body=document.getElementById("list-modal-body");
  if(!modal||!title||!body)return;
  platform=platform||"all";
  title.textContent=platform==="all"?"平台剧场":platform;
  body.innerHTML='<div id="theater-grid" class="grid"><div class="pane-loading has-sk" style="padding:14px 0">'+__skGrid(6)+'</div></div>';
  modal.classList.add("open");
  document.body.style.overflow="hidden";
  var tgrid=document.getElementById("theater-grid");
  if(!tgrid)return;
  fetch("/api/theater-list?platform="+encodeURIComponent(platform)+"&mode=grid")
    .then(function(r){return r.ok?r.text():"";})
    .then(function(html){
      tgrid.innerHTML=html||'<div class="empty"><p>暂无内容</p></div>';
      if(window.__scheduleEnrich)window.__scheduleEnrich();
    })
    .catch(function(){tgrid.innerHTML='<div class="empty"><p>加载失败，请稍后重试</p></div>';});
};
(function(){
  function paintPosters(el,posters){
    var html="",i;
    for(i=0;i<4;i++){
      if(posters&&posters[i]){
        html+='<img class="platform-card-poster p'+i+'" src="'+posters[i]+'" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">';
      }else{
        html+='<span class="platform-card-poster p'+i+' platform-card-poster-ph"></span>';
      }
    }
    el.innerHTML=html;
  }
  function loadCardPreviews(api,mapKey,filterFn){
    var busy=false;
    return function run(force){
      var all=document.querySelectorAll('[data-plat-posters]');
      var nodes=[];
      for(var i=0;i<all.length;i++){
        if(filterFn(all[i]))nodes.push(all[i]);
      }
      if(!nodes.length||busy)return;
      busy=true;
      var url=api+(force?(api.indexOf('?')>=0?'&':'?')+'force=1':'');
      fetch(url,{credentials:'same-origin'})
        .then(function(r){return r.ok?r.json():null;})
        .then(function(d){
          var map=(d&&d[mapKey])||{};
          for(var i=0;i<nodes.length;i++){
            var el=nodes[i],id=el.getAttribute('data-plat-posters');
            var posters=(id&&map[id])||[];
            el.dataset.loaded='1';
            if(posters.length)paintPosters(el,posters);
          }
        })
        .catch(function(){for(var i=0;i<nodes.length;i++)nodes[i].dataset.loaded='0';})
        .then(function(){busy=false;});
    };
  }
  var runPlatform=loadCardPreviews('/api/platform-list?mode=previews','items',function(el){return !el.closest('.theater-platform-rows');});
  var runTheater=loadCardPreviews('/api/theater-list?mode=previews','previews',function(el){return !!el.closest('.theater-platform-rows');});
  window.__reloadPlatformPreviews=function(force){runPlatform(!!force);};
  window.__reloadTheaterPreviews=function(force){runTheater(!!force);};
})();
(function(){
  function onWheel(e){
    var el=e.target&&e.target.closest&&e.target.closest(".platform-cards");
    if(!el)return;
    if(el.scrollWidth<=el.clientWidth+2)return;
    if(Math.abs(e.deltaX)>Math.abs(e.deltaY))return;
    if(!e.deltaY)return;
    e.preventDefault();
    el.scrollLeft+=e.deltaY;
  }
  document.addEventListener("wheel",onWheel,{passive:false,capture:true});
})();
window.closeListModal=function(){var modal=document.getElementById('list-modal');if(!modal)return;modal.classList.remove('open');document.body.style.overflow='';};
document.addEventListener('keydown',function(e){if(e.key==='Escape'){var m=document.getElementById('list-modal');if(m&&m.classList.contains('open')){window.closeListModal();return;}}});
async function __loadHScroll(elId,url,keepId){
  var el=document.getElementById(elId);
  if(!el)return;
  el.innerHTML='<div class="pane-loading has-sk" style="padding:14px 0">'+__skGrid(6)+'</div>';
  try{
    var r=await fetch(url);
    var html=r.ok?await r.text():'';
    if(!html){el.innerHTML='<div class="h-scroll-empty"><p>暂无内容</p></div>';return;}
    if(keepId){
      el.outerHTML=html.replace('class="h-scroll"','class="h-scroll" id="'+elId+'"');
    }else{
      var tmp=document.createElement('div');tmp.innerHTML=html;
      var inner=tmp.querySelector('.h-scroll');
      el.innerHTML=inner?inner.innerHTML:html;
    }
    if(window.__scheduleEnrich)window.__scheduleEnrich();
  }catch(e){el.innerHTML='<div class="h-scroll-empty"><p>加载失败，请稍后重试</p></div>';}
}
async function loadGuduoHScroll(category,force){category=category||'剧集';return __loadHScroll('guduo-hscroll','/api/guduo-list?mode=hscroll&category='+encodeURIComponent(category)+(force?'&force=1':''));}async function loadGuduoHomeTabs(){var tabsBox=document.getElementById('guduo-home-tabs');if(!tabsBox||tabsBox.dataset.loaded==='1')return;try{var r=await fetch('/api/guduo-list?mode=categories');var d=r.ok?await r.json():{categories:[]};var cats=(d&&d.categories)||[];var cnts=(d&&d.counts)||{};cats=cats.length?cats:['剧集','电影','动漫','综艺'];var first=-1;for(var k=0;k<cats.length;k++){if(!(typeof cnts[cats[k]]==='number'&&cnts[cats[k]]<=0)){first=k;break;}}if(first<0)first=0;var html='';for(var i=0;i<cats.length;i++){var p=cats[i];var emp=(typeof cnts[p]==='number'&&cnts[p]<=0);html+='<button class="theater-filter-tab'+(i===first?' active':'')+(emp?' is-empty':'')+'" data-category="'+__esc(p)+'"'+(emp?' title="今日暂无数据"':'')+'>'+__esc(p)+'</button>';}tabsBox.innerHTML=html;tabsBox.style.display='';tabsBox.dataset.loaded='1';tabsBox.addEventListener('click',function(e){var btn=e.target.closest('.theater-filter-tab');if(!btn)return;tabsBox.querySelectorAll('.theater-filter-tab').forEach(function(b){b.classList.remove('active');});btn.classList.add('active');loadGuduoHScroll(btn.getAttribute('data-category')||'剧集');});}catch(e){}}
(function(){
  var sections=[['douban-domestic','domestic'],['douban-jpkr','jpkr'],['douban-western','western'],['douban-animation','animation'],['douban-variety','variety'],['douban-documentary','documentary']];
  var __boardQ=[];
  var __boardActive=0;
  var BOARD_MAX_ACTIVE=3;
  var BOARD_GAP_MS=60;
  // 首页豆瓣区块批量加载（1 次请求拿全部）
  var __doubanHomeLoaded=false;
  async function loadDoubanHome(force){
    if(!force && __doubanHomeLoaded)return;
    try{
      var r=await fetch('/api/douban-list?mode=home'+(force?'&force=1':''));
      if(!r.ok)throw new Error('bad');
      var map=await r.json();
      for(var i=0;i<sections.length;i++){
        var id=sections[i][0];
        var el=document.getElementById(id+'-hscroll');
        if(!el)continue;
        var html=map[id]||'';
        if(!html){el.innerHTML='<div class="h-scroll-empty"><p>暂无内容</p></div>';continue;}
        el.outerHTML=html.replace('class="h-scroll"','class="h-scroll" id="'+id+'-hscroll"');
      }
      __doubanHomeLoaded=true;
      if(window.__scheduleEnrich)window.__scheduleEnrich();
    }catch(e){
      for(var j=0;j<sections.length;j++){
        var el2=document.getElementById(sections[j][0]+'-hscroll');
        if(el2)el2.innerHTML='<div class="h-scroll-empty"><p>加载失败，请稍后重试</p></div>';
      }
    }
  }
  function __runBoardQ(){
    while(__boardActive<BOARD_MAX_ACTIVE && __boardQ.length){
      var job=__boardQ.shift();
      __boardActive++;
      Promise.resolve()
        .then(job)
        .catch(function(){})
        .then(function(){
          __boardActive--;
          if(__boardQ.length)setTimeout(__runBoardQ,BOARD_GAP_MS);
        });
    }
  }
  function enqueue(fn){__boardQ.push(fn);__runBoardQ();}
  function loadOne(id,section,force){
    return function(){
      // 首页走批量接口，一次拿全部区块
      return loadDoubanHome(!!force);
    };
  }
  function loadGuduoBundle(force){
    return function(){
      if(force){
        var gt=document.getElementById('guduo-home-tabs');
        if(gt)gt.dataset.loaded='0';
      }
      return Promise.resolve(loadGuduoHomeTabs()).then(function(){
        var guduoTab=document.querySelector('#guduo-home-tabs .theater-filter-tab.active');
        var guduoCat=guduoTab?guduoTab.getAttribute('data-category')||'剧集':'剧集';
        return loadGuduoHScroll(guduoCat,!!force);
      });
    };
  }
  function fireTarget(t,force){
    if(!t||!t.el)return;
    if(!force && t.el.getAttribute('data-lazy-loaded')==='1')return;
    t.el.setAttribute('data-lazy-loaded','1');
    if(t.kind==='douban'){
      enqueue(loadOne(t.pair[0],t.pair[1],!!force));
    }else if(t.kind==='guduo'){
      enqueue(loadGuduoBundle(!!force));
    }else if(t.kind==='platform'){
      enqueue(function(){
        if(window.__reloadPlatformPreviews)window.__reloadPlatformPreviews(!!force);
        return Promise.resolve();
      });
    }else if(t.kind==='theater'){
      enqueue(function(){
        if(window.__reloadTheaterPreviews)window.__reloadTheaterPreviews(!!force);
        return Promise.resolve();
      });
    }
  }
  function collectTargets(){
    var targets=[];
    for(var i=0;i<sections.length;i++){
      var pair=sections[i];
      var wrap=document.getElementById(pair[0]+'-hscroll');
      if(wrap)targets.push({el:wrap,pair:pair,kind:'douban'});
    }
    var guduo=document.getElementById('guduo-hscroll');
    if(guduo)targets.push({el:guduo,kind:'guduo'});
    var plat=document.querySelector('.platform-section');
    if(plat)targets.push({el:plat,kind:'platform'});
    var theater=document.querySelector('.theater-platform-section');
    if(theater)targets.push({el:theater,kind:'theater'});
    return targets;
  }
  function loadAllNow(){
    var targets=collectTargets();
    if(!targets.length)return;
    for(var i=0;i<targets.length;i++)fireTarget(targets[i],false);
  }
  function start(force){
    if(force){
      var targets=collectTargets();
      for(var i=0;i<targets.length;i++){
        targets[i].el.setAttribute('data-lazy-loaded','0');
        fireTarget(targets[i],true);
      }
      return;
    }
    loadAllNow();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){start(false);});
  else start(false);
  window.__reloadDoubanSections=start;
})();
let modalLoadingId=0;window.__lastDetailType=null;window.__lastDetailId=null;async function openDetail(type,id,push=true,force=false){const modal=document.getElementById('modal'),body=document.getElementById('modal-body');if(!modal||!body)return;if(window.__stopTrailers)window.__stopTrailers();window.__lastDetailType=type;window.__lastDetailId=id;try{modal.style.removeProperty('display');}catch(e){}modal.classList.remove('closing');modal.classList.add('open');document.body.style.overflow='hidden';if(push&&location.pathname!=='/detail/'+type+'/'+id){try{history.replaceState({detail:true},'','/detail/'+type+'/'+id);}catch(e){}}const reqId=++modalLoadingId;body.innerHTML=__loadingBlock('detail','正在加载详情');body.scrollTop=0;try{const ctrl=typeof AbortController!=='undefined'?new AbortController():null;const timer=ctrl?setTimeout(function(){try{ctrl.abort();}catch(e){}},25000):null;const r=await fetch('/api/detail?type='+encodeURIComponent(type)+'&id='+encodeURIComponent(id)+(force?'&force=1':''),ctrl?{signal:ctrl.signal}:undefined);if(timer)clearTimeout(timer);if(reqId!==modalLoadingId)return;if(!r.ok)throw new Error('HTTP '+r.status);body.innerHTML=await r.text();
      var __runDefer=function(){if(window.__detailDeferLoad)window.__detailDeferLoad(type);};
      if(window.requestIdleCallback)requestIdleCallback(__runDefer,{timeout:600});
      else setTimeout(__runDefer,150);}catch(e){if(reqId!==modalLoadingId)return;body.innerHTML='<div class="modal-error"><p>加载失败，请稍后重试</p><button class="btn-ghost" type="button" style="margin-top:14px" onclick="window.__retryDetail&&window.__retryDetail()">重试</button></div>';}}window.openDetail=openDetail;
function __skGrid(n){
  var cards='';
  for(var i=0;i<(n||6);i++){
    cards+='<div class="sk-card">'
      +'<div class="sk sk-poster"></div>'
      +'<div class="sk sk-line w80"></div>'
      +'<div class="sk sk-line w40"></div>'
      +'</div>';
  }
  return '<div class="sk-grid">'+cards+'</div>';
}
function __skDetail(){
  return '<div class="sk-detail">'
    +'<div class="sk sk-detail-hero"></div>'
    +'<div class="sk-detail-row">'
      +'<div class="sk sk-detail-poster"></div>'
      +'<div class="sk-detail-info">'
        +'<div class="sk sk-line" style="height:18px;width:62%"></div>'
        +'<div class="sk sk-line w40"></div>'
        +'<div class="sk sk-line w80"></div>'
        +'<div class="sk sk-line w60"></div>'
      +'</div>'
    +'</div>'
    +'<div class="sk-pill-row" style="display:flex;gap:8px">'
      +'<div class="sk sk-pill"></div><div class="sk sk-pill"></div><div class="sk sk-pill"></div>'
    +'</div>'
    +'<div class="sk sk-line"></div>'
    +'<div class="sk sk-line w80"></div>'
    +'<div class="sk sk-line w60"></div>'
    +'</div>';
}
function __loadingBlock(kind,text){
  var inner = kind==='detail'
    ? __skDetail()
    : __skGrid(kind==='grid3'?3:(kind==='grid9'?9:6));
  return '<div class="modal-loading has-sk" style="padding:20px 16px">'
    +inner
    +'<div class="loading-note">'+((text||'加载中'))+'</div>'
    +'</div>';
}
function __skSummary(){
  var stats='';
  for(var i=0;i<4;i++){
    stats+='<div class="sk-sum-stat">'
      +'<div class="sk sk-line" style="width:46%;height:20px"></div>'
      +'<div class="sk sk-line w60"></div>'
      +'</div>';
  }
  var rows='';
  for(var i=0;i<3;i++){
    rows+='<div class="sk-sum-row">'
      +'<div class="sk sk-sum-rank"></div>'
      +'<div class="sk-sum-row-body">'
        +'<div class="sk sk-line w80"></div>'
        +'<div class="sk sk-line w40"></div>'
      +'</div>'
      +'</div>';
  }
  function block(titleW){
    return '<div class="sk-sum-block">'
      +'<div class="sk sk-line" style="width:'+titleW+';height:12px"></div>'
      +rows
      +'</div>';
  }
  return '<div class="sk-sum">'
    +'<div class="sk-sum-nav"><div class="sk sk-line" style="width:38%;height:26px"></div></div>'
    +'<div class="sk-sum-stats">'+stats+'</div>'
    +'<div class="sk-sum-block"><div class="sk sk-line" style="width:28%;height:12px"></div><div class="sk sk-sum-heat"></div></div>'
    +block('24%')
    +block('24%')
    +'<div class="loading-note" style="text-align:center">正在统计观看记录</div>'
    +'</div>';
}
window.__retryDetail=function(){if(window.__lastDetailType&&window.__lastDetailId)openDetail(window.__lastDetailType,window.__lastDetailId,false);};
function __loadSeasonBody(body,head){if(!body||!head)return;if(body.dataset.loaded||body.dataset.loading)return;body.dataset.loading='1';body.innerHTML=__loadingBlock('grid3','正在加载这一季');fetch('/api/season?show='+encodeURIComponent(head.dataset.show||'')+'&season='+encodeURIComponent(head.dataset.season)+'&tmdb='+encodeURIComponent(head.dataset.tmdb)+'&slug='+encodeURIComponent(head.dataset.slug||'')).then(function(r){return r.ok?r.text():'';}).then(function(html){body.innerHTML=html;body.dataset.loaded='1';delete body.dataset.loading;try{var meta=head.querySelector('.season-meta');if(meta){var total=Number(head.dataset.epTotal||0);var watched=body.querySelectorAll('.episode.watched').length;if(total>0)meta.textContent=watched+' / '+total+' 集';else if(watched)meta.textContent='已看 '+watched+' 集';}}catch(e){}}).catch(function(){body.innerHTML='<div class="modal-error" style="padding:20px">加载失败</div>';delete body.dataset.loading;});}
window.__detailDeferLoad=function(type){var wrap=document.getElementById('modal-body');if(!wrap)return;var root=wrap.querySelector('.detail-wrap')||wrap;var tmdbId=root.dataset.tmdbId||'';var imdbId=root.dataset.imdbId||'';var firstOpen=wrap.querySelector('.season-item.open .season-body');if(firstOpen&&!firstOpen.dataset.loaded&&!firstOpen.dataset.loading){var head=firstOpen.closest('.season-item').querySelector('.season-head');if(head)__loadSeasonBody(firstOpen,head);}var placeholders=wrap.querySelectorAll('[data-defer-section]');if(!placeholders.length)return;var url='/api/detail-extras?type='+encodeURIComponent(type)+'&tmdb='+encodeURIComponent(tmdbId)+'&imdb='+encodeURIComponent(imdbId);fetch(url,{credentials:'same-origin'}).then(function(r){return r.ok?r.json():null;}).then(function(data){if(!data)return;placeholders.forEach(function(el){var section=el.dataset.deferSection;var html=data[section+'Html']||'';if(section==='ratings'){if(html)el.innerHTML=html;else el.remove();return;}var parent=el.closest('.d-section')||el;if(!html){if(section==='trailers'){el.innerHTML='<p class="person-sub" style="padding:8px 0;color:var(--text-mute,#71717a);font-size:.85rem">暂无预告片</p>';el.removeAttribute('data-defer-section');}else{parent.style.display='none';}return;}el.innerHTML=html;el.removeAttribute('data-defer-section');});if(window.__scheduleEnrich)window.__scheduleEnrich();}).catch(function(){placeholders.forEach(function(el){if(el.dataset.deferSection==='ratings'){el.remove();return;}var parent=el.closest('.d-section')||el;parent.style.display='none';});});};
function __stopTrailers(){try{var root=document.getElementById('modal-body')||document.getElementById('modal')||document;var frames=root.querySelectorAll('.trailer-frame iframe, iframe[src*="youtube"]');frames.forEach(function(iframe){try{iframe.src='about:blank';}catch(e){}try{iframe.remove();}catch(e){}});var cards=root.querySelectorAll('.trailer-card.playing');cards.forEach(function(c){c.classList.remove('playing');var f=c.querySelector('.trailer-frame');if(f)f.innerHTML='';});var vids=root.querySelectorAll('video');vids.forEach(function(v){try{v.pause();v.removeAttribute('src');v.load();}catch(e){}});}catch(e){}}
function closeDetail(push=true){const modal=document.getElementById('modal');if(!modal)return;__stopTrailers();modal.classList.remove('open');document.body.style.overflow='';if(push&&location.pathname.startsWith('/detail/')){try{history.replaceState(null,'','/');}catch(e){}}}window.closeDetail=closeDetail;window.__stopTrailers=__stopTrailers;
document.addEventListener('visibilitychange',function(){if(document.hidden&&window.__stopTrailers)window.__stopTrailers();});
document.addEventListener('click',(e)=>{const el=e.target.closest('[data-detail-type]');if(!el)return;const t=el.dataset.detailType,i=el.dataset.detailId;if(!t||!i)return;if(e.target.closest('button,a,.ep-watch-btn,.d-mark-btn,.d-watchlist-btn,.poster-play,.cal-open-btn,.cal-drop-btn'))return;e.preventDefault();openDetail(t,i);});
document.addEventListener('click',(e)=>{const mb=document.getElementById('modal-body');if(!mb||!mb.contains(e.target))return;const inner=e.target.closest('.detail-hero');if(!inner)return;if(e.target.closest('button,a,.item,.episode,.season-head'))return;const rect=inner.getBoundingClientRect();const y=e.clientY-rect.top;if(y<70)closeDetail();},true);
document.addEventListener('keydown',(e)=>{if(e.key!=='Escape')return;const sc=document.getElementById('show-cal-modal');if(sc&&sc.classList.contains('open')){closeShowCal();return;}closeDetail();});
document.addEventListener('click',(e)=>{const head=e.target.closest('.season-head');if(!head)return;toggleSeason(head);});
document.addEventListener('click',(e)=>{const ep=e.target.closest('.episode');if(!ep)return;const url=ep.dataset.traktUrl;if(!url)return;if(e.target.closest('.ep-watch-btn'))return;e.preventDefault();e.stopPropagation();window.open(url,'_blank','noopener');});
async function toggleSeason(headEl){if(!headEl)return;const item=headEl.closest('.season-item');if(!item)return;const body=item.querySelector('.season-body');if(!body)return;if(item.classList.contains('open')){item.classList.remove('open');try{var meta=headEl.querySelector('.season-meta');var total=Number(headEl.dataset.epTotal||0);if(meta&&total>0)meta.textContent='共'+total+'集';}catch(e){}return;}item.classList.add('open');if(body.dataset.loaded){try{var meta2=headEl.querySelector('.season-meta');var total2=Number(headEl.dataset.epTotal||0);var watched2=body.querySelectorAll('.episode.watched').length;if(meta2&&total2>0)meta2.textContent=watched2+' / '+total2+' 集';}catch(e){}return;}__loadSeasonBody(body,headEl);}
window.addEventListener('popstate',()=>{const path=location.pathname;if(path.startsWith('/detail/')){const parts=path.split('/').filter(Boolean);if(parts.length===3)openDetail(parts[1],parts[2],false);}else{const m=document.getElementById('modal');if(m&&m.classList.contains('open'))closeDetail(false);}});
const __prefetched=new Set();
function __prefetchDetail(type,id){if(!type||!id)return;const key=type+'/'+id;if(__prefetched.has(key))return;if(__prefetched.size>=60){const first=__prefetched.values().next().value;if(first!==undefined)__prefetched.delete(first);}__prefetched.add(key);fetch('/api/detail?type='+encodeURIComponent(type)+'&id='+encodeURIComponent(id),{cache:'default'}).catch(()=>{});}
document.addEventListener('touchstart',(e)=>{const el=e.target.closest('[data-detail-type]');if(el)__prefetchDetail(el.dataset.detailType,el.dataset.detailId);},{passive:true,capture:true});
var __showCal={byDay:{},year:0,month:0};
function __pad2(n){return(n<10?'0':'')+n;}
function __bjDay(iso){if(!iso)return '';var d=new Date(new Date(iso).getTime()+${BJ_OFFSET_MS});return d.getUTCFullYear()+'-'+__pad2(d.getUTCMonth()+1)+'-'+__pad2(d.getUTCDate());}
function openShowCalendar(showId,showName,tmdbId){var modal=document.getElementById('show-cal-modal'),nameEl=document.getElementById('show-cal-name'),infoEl=document.getElementById('show-cal-info'),gridEl=document.getElementById('show-cal-grid'),detailEl=document.getElementById('show-cal-detail');if(!modal||!gridEl)return;var now=new Date();__showCal.year=now.getFullYear();__showCal.month=now.getMonth();__showCal.byDay={};modal.classList.add('open');nameEl.textContent=showName||'';infoEl.textContent='正在加载…';gridEl.innerHTML='<div class="modal-loading has-sk" style="grid-column:1/-1;padding:24px 10px">'+__skGrid(3)+'<div class="loading-note">正在加载播出日历</div></div>';detailEl.innerHTML='';renderShowCal();var apiUrl='/api/show-calendar?id='+encodeURIComponent(showId);if(tmdbId)apiUrl+='&tmdb='+encodeURIComponent(tmdbId);fetch(apiUrl).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}).then(function(data){if(data&&data.title)nameEl.textContent=data.title;var map={},eps=(data&&data.episodes)||[];for(var i=0;i<eps.length;i++){var ep=eps[i],day=__bjDay(ep.first_aired);if(!day)continue;if(!map[day])map[day]=[];map[day].push(ep);}__showCal.byDay=map;if(!eps.length){infoEl.textContent='暂无播出记录';}else{var keys=Object.keys(map).sort(),minLabel=keys[0].slice(0,7),maxLabel=keys[keys.length-1].slice(0,7);infoEl.textContent='共 '+keys.length+' 天有更新 · '+minLabel+' ~ '+maxLabel+'（点 ◀ ▶ 翻月）';}renderShowCal();}).catch(function(){infoEl.textContent='加载失败';gridEl.innerHTML='<div class="modal-error" style="grid-column:1/-1;padding:40px 10px">加载失败</div>';});}
function closeShowCal(){var modal=document.getElementById('show-cal-modal');if(modal)modal.classList.remove('open');}window.closeShowCal=closeShowCal;
function calShiftMonth(delta){var m=__showCal.month+delta,y=__showCal.year;while(m<0){m+=12;y--;}while(m>11){m-=12;y++;}__showCal.month=m;__showCal.year=y;renderShowCal();}window.calShiftMonth=calShiftMonth;
function renderShowCal(){var titleEl=document.getElementById('show-cal-month'),gridEl=document.getElementById('show-cal-grid'),detailEl=document.getElementById('show-cal-detail');if(!titleEl||!gridEl)return;var y=__showCal.year,m=__showCal.month;titleEl.textContent=y+' 年 '+(m+1)+' 月';var firstDow=new Date(Date.UTC(y,m,1)).getUTCDay(),daysInMonth=new Date(Date.UTC(y,m+1,0)).getUTCDate(),todayStr=__bjDay(new Date().toISOString()),html='',i;for(i=0;i<firstDow;i++){html+='<div class="sc-day sc-empty"></div>';}for(var d=1;d<=daysInMonth;d++){var dayStr=y+'-'+__pad2(m+1)+'-'+__pad2(d),eps=__showCal.byDay[dayStr]||[],cls='sc-day';if(eps.length){if(dayStr===todayStr)cls+=' sc-has sc-today-day';else if(dayStr<todayStr)cls+=' sc-has sc-past';else cls+=' sc-has sc-future';}var badge=eps.length?'<span class="sc-badge">'+eps.length+'</span>':'';html+='<div class="'+cls+'" data-day="'+dayStr+'"><span class="sc-num">'+d+'</span>'+badge+'</div>';}gridEl.innerHTML=html;detailEl.innerHTML='';var days=gridEl.querySelectorAll('.sc-day[data-day]');for(var j=0;j<days.length;j++){(function(el){el.addEventListener('click',function(){var day=el.getAttribute('data-day'),arr=__showCal.byDay[day]||[];if(!arr.length)return;var all=gridEl.querySelectorAll('.sc-day');for(var q=0;q<all.length;q++)all[q].classList.remove('sc-active');el.classList.add('sc-active');var dh='';for(var e=0;e<arr.length;e++){var ep=arr[e];dh+='<div class="sc-ep"><span class="sc-ep-tag">S'+__pad2(ep.season)+'E'+__pad2(ep.number)+'</span><span class="sc-ep-title">'+__esc(ep.title||'')+'</span></div>';}detailEl.innerHTML=dh;});})(days[j]);}}
document.addEventListener('click',function(e){var btn=e.target.closest('[data-cal-show-id]');if(!btn)return;e.preventDefault();e.stopPropagation();openShowCalendar(btn.getAttribute('data-cal-show-id'),btn.getAttribute('data-cal-show-name')||'',btn.getAttribute('data-cal-show-tmdb')||'');},true);

function __localWeNote(epId,watched,showId,season,number){
  try{
    var o=JSON.parse(sessionStorage.getItem('mt:localWe')||'{}');
    if(!o.ids)o.ids=[];
    var id=Number(epId);
    if(watched){if(o.ids.indexOf(id)<0)o.ids.push(id);}
    else{o.ids=o.ids.filter(function(x){return Number(x)!==id;});}
    if(showId!=null&&season!=null&&number!=null){
      o.byShow=o.byShow||{};
      var sk=String(showId),sn=String(season),en=String(number);
      o.byShow[sk]=o.byShow[sk]||{};
      o.byShow[sk][sn]=o.byShow[sk][sn]||{};
      if(watched)o.byShow[sk][sn][en]=1;else delete o.byShow[sk][sn][en];
    }
    o.at=Date.now();
    sessionStorage.setItem('mt:localWe',JSON.stringify(o));
  }catch(e){}
}
function __markEpisodeDomWatched(btn,watched){
  try{
    var ep=btn&&btn.closest('.episode');
    if(watched){
      var span=document.createElement('span');
      span.className='ep-status watched';
      span.title='已看';
      span.textContent='已看';
      if(btn&&btn.parentNode)btn.parentNode.replaceChild(span,btn);
      if(ep){
        ep.classList.add('watched');
        var wrap=ep.querySelector('.ep-still-wrap');
        if(wrap&&!wrap.querySelector('.ep-still-badge')){
          var b=document.createElement('span');
          b.className='ep-still-badge';
          b.textContent='已看';
          wrap.appendChild(b);
        }
      }
    }else{
      if(btn){
        btn.textContent='未看';
        btn.classList.add('unwatched');
        btn.classList.remove('watched','done');
        btn.disabled=false;
      }
      if(ep){
        ep.classList.remove('watched');
        var badge=ep.querySelector('.ep-still-badge');
        if(badge)badge.remove();
      }
    }
  }catch(e){}
}
document.addEventListener('click',async(e)=>{const btn=e.target.closest('.ep-watch-btn');if(!btn)return;e.preventDefault();e.stopPropagation();const episodeId=btn.dataset.episodeId;if(!episodeId)return;if(!(await __confirm({icon:'✓',title:'标记本集已看',message:'确定要把这一集标记为已看吗？',okText:'标记',tone:'success'})))return;const prev=btn.textContent;btn.disabled=true;btn.textContent='…';try{await __enqueueTrakt(async()=>{var __sid=btn.getAttribute('data-show-id')||(btn.closest('[data-show-id]')&&btn.closest('[data-show-id]').getAttribute('data-show-id'));if(!__sid&&window.__lastDetailType==='show'&&window.__lastDetailId)__sid=window.__lastDetailId;var __sn=btn.getAttribute('data-season');if(__sn==null||__sn===''){var __si=btn.closest('.season-item');var __sh=__si&&__si.querySelector('[data-season]');if(__sh)__sn=__sh.getAttribute('data-season');}var __en=btn.getAttribute('data-number')||btn.getAttribute('data-ep');await __apiWrite('/api/mark-watched',{type:'episode',id:episodeId,showId:__sid?Number(__sid):undefined,season:__sn!=null&&__sn!==''?Number(__sn):undefined,number:__en!=null&&__en!==''?Number(__en):undefined},{okMsg:'已标记本集已看',failPrefix:'标记失败'});
// 本地立即标已看，不重拉详情（避免 Trakt 进度滞后被写进 KV）
__localWeNote(episodeId,true,__sid,__sn,__en);
__markEpisodeDomWatched(btn,true);
__toast('已标记为已看',{type:'success'});
try{delete window.__loadedParts.history;localStorage.removeItem('mt:hist');window.__cwMoreCache=null;}catch(e){}
if(window.__afterWriteSoftRefresh)window.__afterWriteSoftRefresh();
});}catch(err){btn.disabled=false;btn.textContent=prev;__errToast('标记失败',err);}},true);

document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-mark-movie]');if(!btn)return;e.preventDefault();e.stopPropagation();const id=btn.dataset.markMovie;if(!id)return;if(!(await __confirm({icon:'✓',title:'标记已看',message:'确定要把这部电影标记为已看吗？',okText:'标记',tone:'success'})))return;const prevHTML=btn.innerHTML;btn.disabled=true;btn.style.opacity='0.6';try{await __enqueueTrakt(async()=>{await __apiWrite('/api/mark-watched',{type:'movie',id},{okMsg:'已标记为已看',failPrefix:'标记失败'});
// 切成「取消观看」按钮，保留图标，不要写文字（会挤成两行）
btn.removeAttribute('data-mark-movie');
btn.setAttribute('data-unmark-movie',id);
btn.classList.add('active');
btn.classList.remove('done');
btn.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12.5 10 17.5 19 7"/></svg>';
btn.title='取消观看';
btn.disabled=false;btn.style.opacity='';
try{
  var st=document.querySelector('#modal-body .d-status, .modal-body .d-status, .d-status');
  if(st){st.className='d-status done';st.innerHTML='<div class="d-status-icon">✓</div><div class="d-status-body"><div class="d-status-title">已观看</div><div class="d-status-sub">刚刚</div></div>';}
}catch(e){}
if(window.__afterWriteSoftRefresh)window.__afterWriteSoftRefresh();
});}catch(err){btn.disabled=false;btn.style.opacity='';btn.innerHTML=prevHTML;__errToast('标记失败',err);}},true);
document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-unmark-movie]');if(!btn)return;e.preventDefault();e.stopPropagation();const id=btn.dataset.unmarkMovie;if(!id)return;if(!(await __confirm({icon:'↺',title:'取消观看',message:'确定要取消这部电影的观看记录吗？',okText:'取消观看',tone:'warn'})))return;const prevHTML=btn.innerHTML;btn.disabled=true;btn.style.opacity='0.6';try{await __enqueueTrakt(async()=>{await __apiWrite('/api/unmark-watched',{type:'movie',id},{okMsg:'已取消观看记录',failPrefix:'取消失败'});
// 切回「标记已看」
btn.removeAttribute('data-unmark-movie');
btn.setAttribute('data-mark-movie',id);
btn.classList.remove('active','done');
btn.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12.5 10 17.5 19 7"/></svg>';
btn.title='标记已看';
btn.disabled=false;btn.style.opacity='';
try{
  var st=document.querySelector('#modal-body .d-status, .modal-body .d-status, .d-status');
  if(st){st.className='d-status';st.innerHTML='<div class="d-status-icon">○</div><div class="d-status-body"><div class="d-status-title">未观看</div><div class="d-status-sub">还没有在 Trakt 上标记</div></div>';}
}catch(e){}
if(window.__afterWriteSoftRefresh)window.__afterWriteSoftRefresh();
});}catch(err){btn.disabled=false;btn.style.opacity='';btn.innerHTML=prevHTML;__errToast('取消失败',err);}},true);

document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-mark-season-all]');if(!btn)return;e.preventDefault();e.stopPropagation();if(btn.disabled)return;const showId=btn.dataset.markSeasonAll,season=btn.dataset.seasonNum;if(!showId||season==null||season==='undefined')return;if(!(await __confirm({icon:'✓',title:'标记本季已看',message:'确定要把第 '+season+' 季所有已播出集数标记为已看吗？',okText:'标记',tone:'success'})))return;const prev=btn.textContent;btn.disabled=true;btn.textContent='…';try{await __enqueueTrakt(async()=>{let data=await __apiWrite('/api/mark-season-watched',{showId,season:Number(season)},{silent:true,failPrefix:'标记失败'});if(data==null)data={};if(data&&data.marked===0){btn.disabled=false;btn.textContent=prev;__toast(data.message||'本季暂无可标记的已播出集数',{type:'warn'});return;}btn.textContent='✓ 已标记';btn.classList.add('done');__toast(data.message||('已标记本季 '+(data&&data.marked?data.marked:0)+' 集'),{type:'success'});const parts=location.pathname.split('/').filter(Boolean);if(parts[0]==='detail'&&parts.length===3){/* no detail reload: avoid caching stale trakt progress */}if(window.__afterWriteSoftRefresh)window.__afterWriteSoftRefresh();});}catch(err){btn.disabled=false;btn.textContent=prev;__errToast('标记失败',err);}},true);
let __enrichTimer=null;
const __enrichPromises=new Map();
function __scheduleEnrich(){if(__enrichTimer)return;__enrichTimer=setTimeout(__runEnrich,60);}window.__scheduleEnrich=__scheduleEnrich;
async function __runEnrich(){__enrichTimer=null;const els=[...document.querySelectorAll('[data-enrich-key]')];if(!els.length)return;const byKey=new Map();for(const el of els){const k=el.dataset.enrichKey;if(!k)continue;if(!byKey.has(k))byKey.set(k,[]);byKey.get(k).push(el);el.removeAttribute('data-enrich-key');}if(!byKey.size)return;const needFetch=[];for(const[k,group]of byKey.entries()){const existing=__enrichPromises.get(k);if(existing){existing.then(d=>{if(d)group.forEach(el=>__applyEnrich(el,d));});}else{needFetch.push(k);}}if(!needFetch.length)return;for(let bi=0;bi<needFetch.length;bi+=20){const chunk=needFetch.slice(bi,bi+20);const batchPromise=fetch('/api/enrich',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:chunk.map(function(k){return{key:k};})})}).then(function(r){return r.ok?r.json():{};}).catch(function(){return{};});for(const k of chunk){const perKey=batchPromise.then(function(data){return(data&&data[k])||null;});__enrichPromises.set(k,perKey);perKey.then(function(d){var group=byKey.get(k)||[];if(d)group.forEach(function(el){__applyEnrich(el,d);});else{__enrichPromises.delete(k);group.forEach(function(el){if(!el.hasAttribute('data-enrich-key'))el.setAttribute('data-enrich-key',k);});}});}}if(__enrichPromises.size>400){const arr=[...__enrichPromises.keys()];for(let i=0;i<200;i++)__enrichPromises.delete(arr[i]);}}
function __applyEnrich(el,d){const posterBox=el.querySelector('.cw-poster')||el.querySelector('.poster');const locked=el.getAttribute('data-lock-poster')==='1';if(posterBox&&d.poster&&!locked){let cur=posterBox.querySelector('img');if(cur){if(cur.complete&&cur.naturalWidth>0)return;if(cur.src!==d.poster){cur.src=d.poster;cur.style.display='';const ph=posterBox.querySelector('.poster-ph');if(ph)ph.style.display='none';}}else{cur=posterBox.querySelector('.poster-ph');if(cur){const img=document.createElement('img');img.src=d.poster;img.loading='lazy';img.alt='';img.onerror=function(){this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='flex';};const ph=document.createElement('div');ph.className='poster-ph';ph.style.display='none';ph.innerHTML=cur.innerHTML;cur.replaceWith(img,ph);}}}if(d.title){const nameEl=el.querySelector('.name');if(nameEl)nameEl.textContent=d.title;const cwTitle=el.querySelector('.cw-title');if(cwTitle)cwTitle.textContent=d.title;}if(d.overview){const info=el.querySelector('.info');if(info){let ov=info.querySelector('.overview');if(!ov){ov=document.createElement('div');ov.className='overview';const meta=info.querySelector('.meta');if(meta&&meta.nextSibling)info.insertBefore(ov,meta.nextSibling);else info.appendChild(ov);}ov.textContent=d.overview;}}}
window.__summaryState={period:'month',ref:''};
function __sumDefaultRef(period){var d=new Date(Date.now()+${BJ_OFFSET_MS});if(period==='year')return String(d.getUTCFullYear());return d.toISOString().slice(0,7);}
function __sumHeatmax(days){var m=1;if(days)for(var i=0;i<days.length;i++)if(days[i].count>m)m=days[i].count;return m;}
function __sumRender(data){if(!data||data.error){var em=(data&&data.error==='429 cooling')?'Trakt 正在限流，请稍后再试':'小结加载失败，请稍后重试';var lt=(data&&data.lifetime)?'<div class="sum-muted" style="margin-top:8px">累计：电影 '+data.lifetime.movies+' · 剧集 '+data.lifetime.shows+' · 集数 '+data.lifetime.episodes+'</div>':'';return '<div class="empty"><p>'+em+'</p>'+lt+'<button class="btn-ghost" type="button" style="margin-top:14px" onclick="window.__loadSummary(true,true)">重新统计</button></div>';}if(!data.movies&&!data.shows&&!data.episodes&&data.diag&&data.diag.items===0){return __sumEmptyRender(data);}var max=__sumHeatmax(data.days);var heat='';if(data.days&&data.days.length){heat='<div class="sum-heat">';for(var i=0;i<data.days.length;i++){var d=data.days[i],lv=Math.min(4,Math.ceil((d.count/max)*4));heat+='<span class="sum-heat-cell lv'+lv+'" title="'+__esc(d.date)+' · '+d.count+' 次"></span>';}heat+='</div>';}else heat='<p class="sum-muted">这段时间还没有观看记录</p>';function listBlock(title,rows,kind){if(!rows||!rows.length)return '';var h='<div class="sum-block"><h3 class="sum-h3">'+title+'</h3><div class="sum-list">';for(var i=0;i<rows.length;i++){var r=rows[i],meta='';if(kind==='movie')meta=r.plays+' 次'+(r.minutes?(' · '+r.minutes+' 分钟'):'');else meta=r.episodes+' 集 · '+r.plays+' 次';var clickable=r.detailType&&r.detailId;var openAttr=clickable?(' data-sum-type="'+__esc(r.detailType)+'" data-sum-id="'+__esc(r.detailId)+'" role="button" tabindex="0"'):'';var cls='sum-row'+(clickable?' sum-row-click':'');h+='<div class="'+cls+'"'+openAttr+'><span class="sum-rank">'+(i+1)+'</span><div class="sum-row-body"><div class="sum-row-title">'+__esc(r.title)+(r.year?(' <span class="sum-year">'+r.year+'</span>'):'')+'</div><div class="sum-row-meta">'+meta+'</div></div></div>';}return h+'</div></div>';}var busiest=data.busiest?'<div class="sum-chip">最忙一天 <strong>'+__esc(data.busiest.date)+'</strong> · '+data.busiest.count+' 次</div>':'';var trunc=data.truncated?'<p class="sum-muted">记录较多，仅统计本时段前 '+data.sampleSize+' 条</p>':'';var life=data.lifetime;var lifeHtml='';if(life){lifeHtml='<div class="sum-lifetime"><div class="sum-life-title">全部累计</div><div class="sum-life-grid"><div class="sum-life-item"><div class="sum-life-num">'+(life.movies||0)+'</div><div class="sum-life-label">电影</div></div><div class="sum-life-item"><div class="sum-life-num">'+(life.shows||0)+'</div><div class="sum-life-label">剧集</div></div><div class="sum-life-item"><div class="sum-life-num">'+(life.episodes||0)+'</div><div class="sum-life-label">集数</div></div><div class="sum-life-item"><div class="sum-life-num">'+(life.hours||0)+'</div><div class="sum-life-label">小时</div></div></div></div>';}return '<div class="sum-wrap">'+lifeHtml+'<div class="sum-nav">'+'<button type="button" class="sum-nav-btn" onclick="window.__summaryNav(-1)" aria-label="上一时段">‹</button>'+'<div class="sum-nav-center">'+'<div class="sum-period-tabs">'+'<button type="button" class="sum-period-btn'+(data.period==='month'?' active':'')+'" onclick="window.__summarySetPeriod(\\'month\\')">月度</button>'+'<button type="button" class="sum-period-btn'+(data.period==='year'?' active':'')+'" onclick="window.__summarySetPeriod(\\'year\\')">年度</button>'+'</div>'+'<div class="sum-label">'+__esc(data.label)+'</div>'+'</div>'+'<button type="button" class="sum-nav-btn" onclick="window.__summaryNav(1)" aria-label="下一时段">›</button>'+'<button type="button" class="sum-nav-btn" onclick="window.__loadSummary(true,true)" aria-label="重新统计" title="重新统计">⟳</button>'+'</div>'+'<div class="sum-stats">'+'<div class="sum-stat"><div class="sum-stat-num">'+data.movies+'</div><div class="sum-stat-label">电影</div></div>'+'<div class="sum-stat"><div class="sum-stat-num">'+data.shows+'</div><div class="sum-stat-label">剧集</div></div>'+'<div class="sum-stat"><div class="sum-stat-num">'+data.episodes+'</div><div class="sum-stat-label">集数</div></div>'+'<div class="sum-stat"><div class="sum-stat-num">'+data.hours+'</div><div class="sum-stat-label">小时</div></div>'+'</div>'+busiest+trunc+'<div class="sum-block"><h3 class="sum-h3">观看热力</h3>'+heat+'</div>'+listBlock('电影 TOP',data.topMovies,'movie')+listBlock('剧集 TOP',data.topShows,'show')+'</div>';}
function __sumEmptyRender(data){var dx=data.diag||{};var note=(dx.items===0)?('Trakt 在 '+__esc(data.label||'')+' 这段时间内返回 0 条观看记录'):'';var range=dx.start&&dx.end?('<div class="sum-muted" style="margin-top:6px;font-size:.75rem">查询区间 '+__esc(String(dx.start).slice(0,10))+' ~ '+__esc(String(dx.end).slice(0,10))+'</div>'):'';var life=data.lifetime;var lifeHtml='';if(life){lifeHtml='<div class="sum-lifetime"><div class="sum-life-title">全部累计</div><div class="sum-life-grid">'+'<div class="sum-life-item"><div class="sum-life-num">'+(life.movies||0)+'</div><div class="sum-life-label">电影</div></div>'+'<div class="sum-life-item"><div class="sum-life-num">'+(life.shows||0)+'</div><div class="sum-life-label">剧集</div></div>'+'<div class="sum-life-item"><div class="sum-life-num">'+(life.episodes||0)+'</div><div class="sum-life-label">集数</div></div>'+'<div class="sum-life-item"><div class="sum-life-num">'+(life.hours||0)+'</div><div class="sum-life-label">小时</div></div>'+'</div></div>';}
var nav='<div class="sum-nav">'+'<button type="button" class="sum-nav-btn" onclick="window.__summaryNav(-1)" aria-label="上一时段">‹</button>'+'<div class="sum-nav-center"><div class="sum-period-tabs">'+'<button type="button" class="sum-period-btn'+(data.period==='month'?' active':'')+'" onclick="window.__summarySetPeriod(\\\'month\\\')">月度</button>'+'<button type="button" class="sum-period-btn'+(data.period==='year'?' active':'')+'" onclick="window.__summarySetPeriod(\\\'year\\\')">年度</button>'+'</div><div class="sum-label">'+__esc(data.label||'')+'</div></div>'+'<button type="button" class="sum-nav-btn" onclick="window.__summaryNav(1)" aria-label="下一时段">›</button>'+'<button type="button" class="sum-nav-btn" onclick="window.__loadSummary(true,true)" aria-label="重新统计" title="重新统计">⟳</button>'+'</div>';return '<div class="sum-wrap">'+lifeHtml+nav+'<div class="empty" style="padding:18px 0"><p>这段时间还没有观看记录</p>'+(note?'<p class="sum-muted">'+note+'</p>':'')+range+'<button class="btn-ghost" type="button" style="margin-top:12px" onclick="window.__loadSummary(true,true)">重新统计</button></div></div>';}
window.__summarySetPeriod=function(period){window.__summaryState.period=period;window.__summaryState.ref=__sumDefaultRef(period);window.__loadSummary(true);};
window.__summaryNav=function(dir){var st=window.__summaryState;if(!st._prevRef&&!st._nextRef)return;if(dir<0&&st._prevRef)st.ref=st._prevRef;if(dir>0&&st._nextRef)st.ref=st._nextRef;window.__loadSummary(true);};
document.addEventListener('click',function(e){var row=e.target&&e.target.closest&&e.target.closest('.sum-row-click');if(!row)return;var type=row.getAttribute('data-sum-type'),id=row.getAttribute('data-sum-id');if(!type||!id)return;e.preventDefault();if(typeof openDetail==='function')openDetail(type,id,true);});
window.__openSummary=function(){var modal=document.getElementById('summary-modal');if(!modal)return;try{modal.style.removeProperty('display');}catch(e){modal.style.display='';}modal.classList.remove('closing');modal.classList.add('open');document.body.style.overflow='hidden';
  try{
    var sumBody=document.getElementById('summary-modal-body');
    var loadedAt=Number((sumBody&&sumBody.dataset.loadedAt)||0);
    var stale=!loadedAt||(Date.now()-loadedAt>15*60*1000);
    window.__loadSummary(stale);
  }catch(err){console.error(err);}};
window.__closeSummary=function(){var modal=document.getElementById('summary-modal');if(modal){modal.classList.remove('open');}document.body.style.overflow='';};
window.__loadSummary=async function(force,hard){var body=document.getElementById('summary-modal-body');if(!body)return;if(body.dataset.loaded==='1'&&!force&&!hard)return;var st=window.__summaryState;if(!st.ref)st.ref=__sumDefaultRef(st.period);
  var had=body.dataset.loaded==='1';
  var refKey=st.period+':'+st.ref,prevRef=body.dataset.sumRef;
  body.dataset.sumRef=refKey;
  var fresh=(!had)||hard||(prevRef&&prevRef!==refKey);
  if(fresh)body.innerHTML=__skSummary();
  else if(!body.querySelector('.sum-loading'))body.insertAdjacentHTML('afterbegin','<div class="sum-loading">正在更新…</div>');
  var lsKey='mt:sum:'+st.period+':'+st.ref;
  try{
    var cached=null;
    try{var raw=localStorage.getItem(lsKey);if(raw){var o=JSON.parse(raw);if(o&&o.data&&(!o._exp||o._exp>Date.now()))cached=o.data;}}catch(e){}
    if(cached&&!cached.error&&!force){
      st.ref=cached.ref||st.ref;st.period=cached.period||st.period;
      st._prevRef=cached.prevRef||null;st._nextRef=cached.nextRef||null;
      body.innerHTML=__sumRender(cached);body.dataset.loaded='1';body.dataset.loadedAt=String(Date.now());
      body.dataset.sumRef=st.period+':'+st.ref;
    }
    var r=await fetch('/api/summary?period='+encodeURIComponent(st.period)+'&ref='+encodeURIComponent(st.ref)+(hard?'&force=1':''));
    if(!r.ok)throw new Error('HTTP '+r.status);
    var data=await r.json();
    if(data&&!data.error&&!data.__error){
      st.ref=data.ref||st.ref;st.period=data.period||st.period;
      st._prevRef=data.prevRef||null;st._nextRef=data.nextRef||null;
      body.innerHTML=__sumRender(data);body.dataset.loaded='1';body.dataset.loadedAt=String(Date.now());
      body.dataset.sumRef=st.period+':'+st.ref;
      var __cur=(st.period==='month')?__sumDefaultRef('month'):__sumDefaultRef('year');
      var __lsTtl=(st.ref===__cur)?900e3:7*86400e3;
      try{localStorage.setItem('mt:sum:'+st.period+':'+st.ref,JSON.stringify({data:data,_exp:Date.now()+__lsTtl}));}catch(e){}
    }else if(!cached&&!had){
      body.innerHTML='<div class="empty"><p>小结暂无数据</p></div>';body.dataset.loaded='0';
    }
  }catch(e){
    if(body.dataset.loaded!=='1'){
      body.innerHTML='<div class="empty"><p>小结加载失败，请稍后重试</p></div>';body.dataset.loaded='0';
    }
  }finally{
    var __ld=body.querySelector('.sum-loading');
    if(__ld)__ld.parentNode.removeChild(__ld);
  }
};
document.addEventListener('click',function(e){var av=e.target&&e.target.closest&&e.target.closest('#hero-avatar');if(av){e.preventDefault();window.__openSummary&&window.__openSummary();}});
document.addEventListener('keydown',function(e){if(e.key==='Escape'){var m=document.getElementById('summary-modal');if(m&&m.classList.contains('open'))window.__closeSummary();}});
let __personLoadingId=0;
window.__openPerson=async function(id,name){if(!id)return;const modal=document.getElementById('person-modal');const body=document.getElementById('person-modal-body');const titleEl=document.getElementById('person-modal-name');if(!modal||!body)return;if(titleEl)titleEl.textContent=name||'';modal.classList.add('open');document.body.style.overflow='hidden';const reqId=++__personLoadingId;body.innerHTML=__loadingBlock('detail','正在加载人物资料');body.scrollTop=0;try{const r=await fetch('/api/person?id='+encodeURIComponent(id));if(reqId!==__personLoadingId)return;if(!r.ok)throw new Error('HTTP '+r.status);body.innerHTML=await r.text();}catch(e){if(reqId!==__personLoadingId)return;body.innerHTML='<div class="modal-error"><p>加载失败，请稍后重试</p></div>';}};
window.closePerson=function(){const modal=document.getElementById('person-modal');if(!modal)return;modal.classList.remove('open');const d=document.getElementById('modal');if(d&&d.classList.contains('open'))return;document.body.style.overflow='';};
document.addEventListener('click',function(e){const el=e.target.closest('[data-person-id]');if(!el)return;e.preventDefault();e.stopPropagation();window.__openPerson(el.getAttribute('data-person-id'),el.getAttribute('data-person-name')||'');});
document.addEventListener('click',function(e){const el=e.target.closest('[data-detail-type]');if(!el)return;if(el.closest('#person-modal')){window.closePerson();document.body.style.overflow='hidden';}},true);
document.addEventListener('keydown',function(e){if(e.key!=='Escape')return;const pm=document.getElementById('person-modal');if(pm&&pm.classList.contains('open')){window.closePerson();e.stopPropagation();}},true);
document.addEventListener('click',async function(e){
  var btn=e.target&&e.target.closest&&e.target.closest('[data-copy-url]');
  if(!btn)return;
  e.preventDefault();e.stopPropagation();
  var url=btn.getAttribute('data-copy-url');
  if(!url)return;
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText){
      await navigator.clipboard.writeText(url);
    }else{
      var ta=document.createElement('textarea');
      ta.value=url;ta.setAttribute('readonly','');
      ta.style.cssText='position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);ta.select();
      document.execCommand('copy');document.body.removeChild(ta);
    }
    if(window.__toast)window.__toast('已复制 TMDB 链接',{type:'success',duration:1800});
  }catch(err){
    if(window.__toast)window.__toast('复制失败',{type:'error',duration:2000});
  }
},true);
document.addEventListener('click',function(e){const card=e.target.closest('.trailer-card');if(!card||card.classList.contains('playing'))return;const key=card.getAttribute('data-yt-key');if(!key)return;card.classList.add('playing');const frame=card.querySelector('.trailer-frame');if(frame){var src='https://www.youtube.com/embed/'+encodeURIComponent(key)+'?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1&enablejsapi=1';frame.innerHTML='<iframe src="'+src+'" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture;web-share" allowfullscreen playsinline referrerpolicy="strict-origin-when-cross-origin"></iframe>'+'<a class="trailer-yt-open" href="https://www.youtube.com/watch?v='+encodeURIComponent(key)+'" target="_blank" rel="noopener" onclick="event.stopPropagation()">在 YouTube 打开</a>';}});
window.addEventListener('load',()=>{setTimeout(__runEnrich,200);});
(function(){
  if(typeof MutationObserver!=='function')return;
  var SEL='.modal,.list-modal,.summary-modal,.person-modal,.confirm-modal,.show-cal-modal,.cw-sheet';
  var CLS=['modal','list-modal','summary-modal','person-modal','confirm-modal','show-cal-modal','cw-sheet'];
  var CLOSE_MS=200;
  var Z_BASE=1000,Z_STEP=10,Z_MAX=8000,zTop=Z_BASE;
  function isOverlay(el){
    if(!el||el.nodeType!==1)return false;
    for(var i=0;i<CLS.length;i++)if(el.classList.contains(CLS[i]))return true;
    return false;
  }
  function all(){
    var out=[],nodes=document.querySelectorAll(SEL);
    for(var i=0;i<nodes.length;i++)if(isOverlay(nodes[i]))out.push(nodes[i]);
    return out;
  }
  function compact(){
    var arr=all(),keep=[];
    for(var i=0;i<arr.length;i++)if(arr[i].__mtZ)keep.push(arr[i]);
    keep.sort(function(a,b){return (a.__mtZ||0)-(b.__mtZ||0);});
    zTop=Z_BASE;
    for(var i=0;i<keep.length;i++){zTop+=Z_STEP;keep[i].__mtZ=zTop;keep[i].style.zIndex=String(zTop);}
  }
  function raise(el){
    if(zTop+Z_STEP>Z_MAX)compact();
    zTop+=Z_STEP;
    el.__mtZ=zTop;
    el.style.zIndex=String(zTop);
  }
  function drop(el){
    if(!el.__mtZ)return;
    delete el.__mtZ;
    el.style.removeProperty('z-index');
  }
  function sync(){
    var arr=all(),any=false;
    for(var i=0;i<arr.length;i++){
      var el=arr[i];
      var now=el.classList.contains('open');
      var was=(el.__mtWas===true);
      var first=(el.__mtWas===undefined);
      el.__mtWas=now;
      if(first||now===was){
        if(now){if(!el.__mtZ)raise(el);any=true;}
        continue;
      }
      if(now){
        if(el.__mtT){clearTimeout(el.__mtT);el.__mtT=null;}
        el.classList.remove('closing');
        drop(el);raise(el);
        try{var pn0=el.querySelector(PANEL_SEL);if(pn0)pn0.__mtH=null;}catch(e){}
        any=true;
        continue;
      }
      el.classList.add('closing');
      any=true;
      if(el.__mtT)clearTimeout(el.__mtT);
      (function(node){
        node.__mtT=setTimeout(function(){
          node.__mtT=null;
          node.classList.remove('closing');
          drop(node);
          var rest=all(),still=false;
          for(var k=0;k<rest.length;k++){
            if(rest[k]!==node&&(rest[k].classList.contains('open')||rest[k].classList.contains('closing'))){still=true;break;}
          }
          if(!still){document.body.style.overflow='';zTop=Z_BASE;}
        },CLOSE_MS);
      })(el);
    }
    if(!any){for(var k2=0;k2<arr.length;k2++)drop(arr[k2]);zTop=Z_BASE;}
    watchPanels();
  }
  var PANEL_SEL='.modal-shell,.list-modal-panel,.summary-panel,.person-panel,.confirm-panel,.show-cal-panel';
  function panelAnim(el,from,to){
    if(el.__mtHA)return;
    el.__mtHA=1;
    var oldOverflow=el.style.overflow;
    el.style.overflow='hidden';
    el.style.height=from+'px';
    void el.offsetHeight;
    el.style.transition='height .3s cubic-bezier(.34,1.06,.5,1)';
    el.style.height=to+'px';
    var done=function(){
      if(!el.__mtHA)return;
      el.__mtHA=0;
      el.style.transition='';
      el.style.height='';
      el.style.overflow=oldOverflow;
    };
    el.addEventListener('transitionend',done,{once:true});
    setTimeout(done,420);
  }
  var ro=null;
  function watchPanels(){
    if(!ro)return;
    var ps=document.querySelectorAll(PANEL_SEL);
    for(var i=0;i<ps.length;i++){
      var el=ps[i];
      if(el.__mtW)continue;
      el.__mtW=1;
      el.__mtH=el.offsetHeight;
      ro.observe(el);
    }
  }
  if(typeof ResizeObserver==='function'){
    ro=new ResizeObserver(function(entries){
      for(var i=0;i<entries.length;i++){
        var el=entries[i].target;
        var h=(entries[i].borderBoxSize&&entries[i].borderBoxSize[0])
          ? entries[i].borderBoxSize[0].blockSize
          : el.offsetHeight;
        var prev=el.__mtH;
        el.__mtH=h;
        if(el.__mtHA)continue;
        if(prev==null||!isFinite(prev)||Math.abs(h-prev)<8)continue;
        var host=el.closest?el.closest('.modal,.list-modal,.summary-modal,.person-modal,.confirm-modal,.show-cal-modal,.cw-sheet'):null;
        if(!host||!host.classList.contains('open'))continue;
        panelAnim(el,prev,h);
      }
    });
  }
  var pending=false;
  function schedule(){
    if(pending)return;
    pending=true;
    (window.requestAnimationFrame||function(f){return setTimeout(f,16);})(function(){pending=false;sync();});
  }
  var mo=new MutationObserver(function(muts){
    for(var i=0;i<muts.length;i++){
      var m=muts[i];
      if(m.type==='attributes'){if(isOverlay(m.target)){sync();return;}}
      else if(m.target===document.body||m.target.parentNode===document.body){schedule();return;}
    }
  });
  mo.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  sync();
})();`
  );
}

let __pageStylesCache = null;

function pageStyles() {
  if (__pageStylesCache) return __pageStylesCache;
  const LIGHT_THEME_VARS = `
  --danger-fg:#ff7b85;
  --chip-bg:#f4f4f5;
  --chip-bg-hover:#e4e4e7;
  --chip-fg:#3f3f46;
  --chip-fg-hover:#18181b;
  --chip-border:rgba(0,0,0,0.1);
  --chip-accent:#7c3aed;
  --pill-bg:rgba(255,255,255,0.92);
  --pill-border:rgba(0,0,0,0.1);
  --pill-shadow:0 8px 28px rgba(0,0,0,0.08);
  --pill-fg:rgba(0,0,0,0.6);
  --pill-act-hover:rgba(0,0,0,0.06);
  --bg:#ffffff;
  --surface:#ffffff;
  --surface-2:#f7f7f8;
  --surface-3:#f1f1f3;
  --border:rgba(0,0,0,0.08);
  --border-strong:rgba(0,0,0,0.14);
  --text:#18181b;
  --text-dim:#52525b;
  --text-mute:#71717a;
  --accent:#7c3aed;
  --accent-2:#6d28d9;
  --accent-soft:rgba(124,58,237,0.09);
  --accent-glow:rgba(124,58,237,0.2);
  --success:#059669;
  --blue:#6d28d9;
  --shadow-card:0 8px 28px rgba(0,0,0,0.08);
  --bg-solid:#ffffff;
  --panel-grad:linear-gradient(165deg,#ffffff 0%,#f7f7f8 100%);
  --hover-bg:rgba(0,0,0,0.035);
  --hover-bg-strong:rgba(0,0,0,0.06);
  --sticky-bg:rgba(243,243,245,0.92);
  --sticky-border:rgba(0,0,0,0.07);
  --sticky-shadow:0 6px 20px rgba(0,0,0,0.1);
  --overlay:rgba(15,18,26,0.42);
  --overlay-strong:rgba(15,18,26,0.45);
  --modal-bg:#ffffff;
  --toast-bg:rgba(24,24,27,0.94);
  --toast-text:#ffffff;
  --bar-track:rgba(0,0,0,0.08);
  --spinner-track:#e4e4e7;
  --spinner-active:#7c3aed;
  --splash-bg:radial-gradient(circle at 50% 45%,#ffffff 0%,#f4f4f6 62%);
  --launch-splash-bg:radial-gradient(120% 90% at 50% 108%,rgba(124,58,237,0.12) 0%,rgba(124,58,237,0) 55%),radial-gradient(110% 85% at 50% -12%,rgba(56,97,190,0.1) 0%,rgba(255,255,255,0) 55%),#ffffff;
  --launch-glow:rgba(124,58,237,0.1);
  --splash-glow-color:rgba(124,58,237,0.22);
  --splash-name-b:#52525b;
  --splash-bar-fill:linear-gradient(90deg,#6d28d9,#7c3aed);
  --name-grad:linear-gradient(135deg,#18181b 20%,#7c3aed 90%);
  --num-grad:linear-gradient(180deg,#18181b 0%,#7c3aed 100%);
  --brand-grad:linear-gradient(135deg,#6d28d9 0%,#7c3aed 100%);
  --brand-grad-hover:linear-gradient(145deg,#7c3aed,#8b5cf6);
  /* 底部滑块上的文字固定白色，浅色下靠这条变量兜底对比度 */
  --tab-active-fg:#ffffff;
  --avatar-ring:rgba(124,58,237,0.4);
  --avatar-grad:linear-gradient(135deg,#ede9fe,#ddd6fe);
  --soft-card-grad:linear-gradient(135deg,#ffffff,#f1f1f3);
  --btn-hover-bg:rgba(124,58,237,0.1);
  --btn-hover-border:rgba(124,58,237,0.35);
  --btn-hover-shadow:0 4px 16px rgba(124,58,237,0.18);
  --danger-bg:rgba(248,113,113,0.16);
  --danger-border:rgba(248,113,113,0.5);
  --danger-shadow:0 4px 16px rgba(0,0,0,0.25);
  --poster-ph-bg:rgba(0,0,0,0.06);
  --platform-card-grad:linear-gradient(145deg,#f4f4f5 0%,#e9e9ec 100%);
  --platform-card-text:#3f3f46;
  --platform-shadow-hover:rgba(0,0,0,0.16);
  --scrollbar:#d4d4d8;
  --link:#6d28d9;
  --glass-bg:rgba(255,255,255,0.94);
  --glass-bg-strong:rgba(255,255,255,0.97);
  --glass-bg-soft:rgba(255,255,255,0.88);
  --glass-border:rgba(255,255,255,0.9);
  --glass-border-soft:rgba(0,0,0,0.08);
  --glass-highlight:rgba(255,255,255,1);
  --glass-shadow:0 12px 40px rgba(0,0,0,0.1),inset 0 1px 0 rgba(255,255,255,1);
  --glass-shadow-sm:0 6px 20px rgba(0,0,0,0.08),inset 0 1px 0 rgba(255,255,255,0.9);
  --glass-blur:blur(12px) saturate(165%);
  --dock-bg:rgba(255,255,255,0.92);
  --sheet-glass:rgba(255,255,255,0.96);
  --card-glass:rgba(255,255,255,0.72);
  --close-bg:rgba(255,255,255,0.75);
  --close-fg:#18181b;
  --close-border:rgba(0,0,0,0.08);
  --link-hover:#5b21b6;
  --success-fg:#059669;
  --warn-fg:#b45309;
  --cal-accent:#4a6db8;
  --cal-accent-2:#5b6b88;
  --cal-accent-3:#4a6db8;
  --cal-cell-border:#d4d9e6;
  --cal-soft:rgba(74,109,184,0.12);
  --cal-soft-border:rgba(74,109,184,0.3);
  --shadow-avatar:rgba(0,0,0,0.12);
  --shadow-login:rgba(0,0,0,0.1);
  --detail-hero-grad:linear-gradient(180deg,rgba(255,255,255,0.72),rgba(247,247,248,0.96));
  --detail-bg-filter:brightness(1.05) saturate(0.9);
`;
  __pageStylesCache = `html{color-scheme:dark;}html[data-theme="light"]{color-scheme:light;${LIGHT_THEME_VARS}}html,body{background:var(--bg-solid);color:var(--text);margin:0;padding:0;min-height:100dvh;scroll-behavior:smooth;transition:background-color 0.2s ease,color 0.2s ease;}*{box-sizing:border-box;margin:0;padding:0;}.splash{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--splash-bg);transition:opacity 0.22s ease;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-tap-highlight-color:transparent;animation:splashAutoHide 0.22s ease 0.45s forwards;}.splash.hide{opacity:0;pointer-events:none;animation:none;}@keyframes splashAutoHide{to{opacity:0;visibility:hidden;pointer-events:none}}.splash-glow{position:absolute;width:340px;height:340px;border-radius:50%;background:radial-gradient(circle,var(--splash-glow-color) 0%,rgba(125,157,212,0) 70%);animation:splashPulse 2.4s ease-in-out infinite;}.splash-inner{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:20px;}.splash-logo{color:var(--splash-name-b);animation:splashPop 0.75s cubic-bezier(0.22,1.1,0.36,1) both;}.splash-logo img{display:block;}.splash-name{font-size:1.35rem;font-weight:800;letter-spacing:0.4px;background:var(--name-grad);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation:splashFadeUp 0.6s ease 0.28s both;}.splash-bar{width:128px;height:3px;border-radius:99px;background:var(--bar-track);overflow:hidden;animation:splashFadeUp 0.6s ease 0.45s both;}.splash-bar-fill{height:100%;width:42%;border-radius:99px;background:var(--splash-bar-fill);animation:splashSlide 1.15s cubic-bezier(0.65,0,0.35,1) infinite;}@keyframes splashPulse{0%,100%{transform:scale(0.85);opacity:0.7}50%{transform:scale(1.12);opacity:1}}@keyframes splashPop{0%{opacity:0;transform:scale(0.55) rotate(-8deg)}60%{opacity:1;transform:scale(1.08) rotate(2deg)}100%{opacity:1;transform:scale(1) rotate(0)}}@keyframes splashFadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@keyframes splashSlide{0%{transform:translateX(-130%)}100%{transform:translateX(330%)}}.spinner{width:30px;height:30px;border:3px solid var(--spinner-track);border-radius:50%;animation:spin 0.8s linear infinite;margin:4px auto;}@keyframes spin{to{transform:rotate(360deg)}}:root{--bg:#050505;--surface:#0e0e10;--surface-2:#16161a;--surface-3:#1c1c22;--border:rgba(255,255,255,0.08);--border-strong:rgba(255,255,255,0.14);--text:#f4f4f5;--text-dim:#a1a1aa;--text-mute:#71717a;--accent:#a78bfa;--accent-2:#c4b5fd;--accent-soft:rgba(167,139,250,0.12);--accent-glow:rgba(167,139,250,0.28);--success:#34d399;--blue:#c4b5fd;--radius-sm:10px;--radius-md:14px;--radius-lg:18px;--radius-xl:22px;--shadow-card:0 8px 32px rgba(0,0,0,0.55);--bg-solid:#000000;--panel-grad:linear-gradient(165deg,#16161a 0%,#0e0e10 100%);--hover-bg:rgba(255,255,255,0.04);--hover-bg-strong:rgba(255,255,255,0.09);--overlay:rgba(2,4,8,0.78);--overlay-strong:rgba(0,0,0,0.78);--modal-bg:#000000;--toast-bg:rgba(20,22,28,0.96);--toast-text:#ffffff;--bar-track:rgba(255,255,255,0.1);--spinner-track:#212735;--spinner-active:#7d9dd4;--splash-bg:radial-gradient(circle at 50% 45%,#0a0a0a 0%,#000 62%);--launch-splash-bg:radial-gradient(120% 90% at 50% 108%,rgba(124,58,237,0.3) 0%,rgba(124,58,237,0) 55%),radial-gradient(110% 85% at 50% -12%,rgba(56,97,190,0.25) 0%,rgba(0,0,0,0) 55%),#000;--launch-glow:rgba(124,58,237,0.18);--splash-glow-color:rgba(125,157,212,0.55);--splash-name-b:#a8b2c4;--splash-bar-fill:linear-gradient(90deg,#7d9dd4,#a78bfa);--name-grad:linear-gradient(135deg,#fff 20%,#c4b5fd 90%);--num-grad:linear-gradient(180deg,#fff 0%,#c4b5fd 100%);--brand-grad:linear-gradient(135deg,#7c3aed 0%,#a78bfa 100%);--brand-grad-hover:linear-gradient(145deg,#8b5cf6,#a78bfa);--avatar-ring:rgba(167,139,250,0.45);--avatar-grad:linear-gradient(135deg,#1a2233,#2a3a55);--soft-card-grad:linear-gradient(135deg,#16161a,#0e0e10);--btn-hover-bg:rgba(167,139,250,0.1);--btn-hover-border:rgba(167,139,250,0.35);--btn-hover-shadow:0 4px 16px rgba(167,139,250,0.18);--danger-bg:rgba(224,85,96,0.1);--danger-border:rgba(224,85,96,0.35);--danger-shadow:0 4px 16px rgba(224,85,96,0.15);--poster-ph-bg:rgba(0,0,0,0.65);--shadow-avatar:rgba(0,0,0,0.5);--shadow-login:rgba(0,0,0,0.7);--detail-hero-grad:linear-gradient(180deg,rgba(10,14,24,0.6),rgba(10,14,24,0.95));--detail-bg-filter:brightness(0.5);--chip-bg:rgba(255,255,255,0.05);--chip-bg-hover:rgba(255,255,255,0.09);--chip-fg:#a1a1aa;--chip-fg-hover:#f4f4f5;--chip-border:rgba(255,255,255,0.08);--chip-accent:#a78bfa;--pill-bg:linear-gradient(165deg,rgba(255,255,255,0.09) 0%,rgba(255,255,255,0.04) 100%);--pill-border:rgba(255,255,255,0.12);--pill-shadow:0 8px 28px rgba(0,0,0,0.45),inset 0 1px 0 rgba(255,255,255,0.06);--pill-fg:rgba(255,255,255,0.55);--pill-act-hover:rgba(255,255,255,0.1);--platform-card-grad:linear-gradient(145deg,#1a1a1a 0%,#0a0a0a 100%);--platform-card-text:#ffffff;--platform-shadow-hover:rgba(0,0,0,0.65);--scrollbar:#2a3345;--link:#c4b5fd;--link-hover:#ddd6fe;--success-fg:#4ade80;--warn-fg:#ffb84d;--danger-fg:#ff8a8a;--cal-accent:#4a6db8;--cal-accent-2:#9db0d0;--cal-accent-3:#7d9dd4;--cal-cell-border:#3a4a68;--cal-soft:rgba(90,120,180,0.22);--cal-soft-border:rgba(140,170,220,0.35);}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;background-attachment:fixed;color:var(--text);-webkit-font-smoothing:antialiased;line-height:1.5;overflow-x:hidden;overscroll-behavior-y:none;}a{color:var(--accent-2);text-decoration:none;transition:color 0.15s;}a:hover{color:var(--link-hover);}img{display:block;max-width:100%;}.container{max-width:880px;width:100%;margin:0 auto;padding:0 16px calc(68px + env(safe-area-inset-bottom,0px));}.app-version{text-align:center;font-size:0.7rem;color:var(--text-mute);opacity:0.7;padding:8px 0 4px;letter-spacing:0.4px;user-select:none;}.pane-loading{padding:60px 20px;text-align:center;}.load-more-wrap{text-align:center;margin-top:24px;}.load-more{color:var(--text);padding:11px 32px;font-size:0.9rem;font-weight:600;cursor:pointer;font-family:inherit;}.load-more:hover:not(:disabled){border-color:rgba(91,124,250,0.45);color:var(--accent-2);box-shadow:0 4px 20px var(--accent-glow);background:var(--surface-3);}.load-more:disabled{cursor:not-allowed;}.login-wrap{min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:20px;position:relative;overflow:hidden;}.login-bg{position:absolute;inset:0;background:radial-gradient(ellipse 80% 60% at 50% 40%,rgba(124,58,237,.15),transparent 60%),radial-gradient(ellipse 60% 40% at 80% 80%,rgba(56,97,190,.1),transparent 50%),var(--bg-solid);z-index:0;}.login-card{position:relative;z-index:1;width:100%;max-width:380px;border:1px solid var(--glass-border);padding:52px 40px;text-align:center;}.login-logo{margin-bottom:24px;}.login-logo img{border-radius:22px;box-shadow:0 12px 32px rgba(124,58,237,.25);}.login-title{font-size:2rem;font-weight:800;letter-spacing:-0.5px;background:linear-gradient(135deg,#fff 0%,#c4b5fd 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;margin:0 0 8px;}.login-sub{color:var(--text-dim);font-size:0.95rem;margin:0 0 36px;}.login-btn{width:100%;padding:16px 32px;font-size:1.05rem;border-radius:16px;background:linear-gradient(135deg,#7c3aed,#a78bfa);box-shadow:0 8px 24px rgba(124,58,237,.4);}.login-btn:hover{transform:translateY(-2px);box-shadow:0 12px 32px rgba(124,58,237,.5);}.login-hint{margin-top:20px;font-size:0.78rem;color:var(--text-mute);}html[data-theme="light"] .login-title{background:linear-gradient(135deg,#18181b 0%,#7c3aed 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;}.btn-primary{background:var(--brand-grad);color:#fff;border:none;padding:13px 30px;border-radius:12px;font-size:0.95rem;font-weight:700;cursor:pointer;box-shadow:0 6px 24px var(--accent-glow);}.btn-primary:hover{filter:brightness(1.08);transform:translateY(-1px);}.btn-ghost{background:var(--chip-bg);color:var(--chip-fg);border:1px solid var(--chip-border);padding:8px 16px;border-radius:10px;font-size:0.85rem;cursor:pointer;transition:all 0.15s;font-family:inherit;}.btn-ghost:hover{color:var(--chip-fg-hover);border-color:var(--chip-border);background:var(--chip-bg-hover);}.steps{display:flex;flex-direction:column;gap:6px;}.step{display:flex;align-items:center;gap:10px;text-align:left;padding:4px 0;font-size:0.9rem;}.step .n{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;background:var(--accent);color:#fff;border-radius:50%;font-size:0.72rem;font-weight:700;flex-shrink:0;}.code-box{font-family:ui-monospace,Menlo,monospace;font-size:1.75rem;font-weight:800;color:#a8c0e8;padding:14px;margin:14px 0;user-select:all;text-align:center;}.status{display:inline-flex;align-items:center;gap:8px;font-size:0.88rem;padding:8px 16px;border-radius:20px;color:var(--text-dim);background:var(--surface-2);}.status.success{color:#4ade80;background:rgba(74,222,128,0.1);}.status.error{color:#e05560;background:rgba(224,85,96,0.12);}.err-box{background:rgba(224,85,96,0.1);border:1px solid rgba(224,85,96,0.28);border-radius:12px;padding:14px;text-align:left;margin-bottom:14px;}.err-title{font-weight:600;color:#e05560;margin-bottom:4px;font-size:0.92rem;}.err{color:#e8a3ab;font-size:0.85rem;}.hint{color:var(--text-dim);font-size:0.82rem;margin-top:6px;}.log-details{margin-top:18px;text-align:left;}.log-details summary{cursor:pointer;font-size:0.76rem;color:var(--text-dim);padding:4px 0;user-select:none;}.log-box{font-size:0.76rem;color:var(--text-dim);background:var(--surface-3);border:1px solid var(--border);border-radius:8px;padding:10px;max-height:190px;overflow:auto;margin-top:6px;line-height:1.65;}.log-row{display:flex;gap:6px;align-items:baseline;padding:1px 0;}.log-t{font-family:ui-monospace,Menlo,monospace;font-size:0.68rem;color:var(--text-mute);flex-shrink:0;font-variant-numeric:tabular-nums;}.log-m{flex:1;min-width:0;word-break:break-word;}.log-wait .log-m{color:var(--text-dim);}.log-ok .log-m{color:#4ade80;}.log-warn .log-m{color:#ffb84d;}.log-err .log-m{color:#e05560;}.hero{display:flex;justify-content:space-between;align-items:center;padding:calc(8px + env(safe-area-inset-top)) 0 6px;gap:10px;}.hero-left{display:flex;align-items:center;gap:12px;min-width:0;}.hero-avatar{width:50px;height:50px;border-radius:50%;overflow:hidden;flex-shrink:0;background:var(--surface-2);}.hero-avatar img{width:100%;height:100%;object-fit:cover;display:block;}.hero-avatar-ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.25rem;background:var(--avatar-grad);}.hero-text{min-width:0;flex:1;display:flex;flex-direction:column;align-items:flex-start;gap:1px;}.hero-name{font-size:1.45rem;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:var(--name-grad);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;}.updated-times{display:flex;flex-direction:column;gap:1px;}.updated-at{font-size:0.72rem;color:var(--text-mute);font-weight:400;letter-spacing:0.2px;transition:color 0.4s ease;line-height:1.35;}.updated-at:empty{display:none;}.updated-times:empty{display:none;}.updated-at.flash{animation:updatedFlash 1.1s ease-out;}.updated-at.src-live{color:#4ade80;}.updated-at.src-cache{color:var(--text-mute);}@keyframes updatedFlash{0%{color:var(--accent-2)}100%{color:var(--text-mute)}}.hero-actions{display:flex;gap:8px;flex-shrink:0;}.btn-action{display:inline-flex;align-items:center;gap:6px;color:var(--chip-fg);padding:8px 14px;font-size:0.82rem;font-weight:600;cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent;}.btn-action svg{flex-shrink:0;transition:transform 0.25s ease;}.btn-action:hover{color:var(--chip-fg-hover);border-color:var(--btn-hover-border);background:var(--btn-hover-bg);}.btn-action:hover svg{transform:rotate(180deg);}#btn-logout:hover{color:var(--danger-fg);background:var(--danger-bg);border-color:var(--danger-border);box-shadow:var(--danger-shadow);}#btn-logout:hover svg{transform:translateX(2px);}#btn-theme:hover{color:var(--chip-accent);}#btn-theme:hover svg{transform:none;}#btn-theme svg{transition:opacity 0.2s ease,transform 0.2s ease;}#btn-theme .theme-icon{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}@media (max-width:768px){.btn-action span{display:none;}.btn-action{padding:9px;}.hero-actions{gap:6px;}}.stats::before{content:"";position:absolute;top:0;left:10%;right:10%;height:1px;background:linear-gradient(90deg,transparent,rgba(167,139,250,0.35),transparent);}.stat:hover{background:rgba(255,255,255,0.025);}.stat + .stat::before{content:"";position:absolute;left:-4px;top:18%;bottom:18%;width:1px;background:linear-gradient(180deg,transparent,rgba(255,255,255,0.08),transparent);}.tabs{position:fixed;left:0;right:0;bottom:0;z-index:50;display:flex;align-items:stretch;justify-content:space-around;margin:0;border-top:1px solid var(--sticky-border,rgba(255,255,255,.08));}.top-sticky{position:sticky;top:0;z-index:40;margin:0 -16px;padding:0 16px;border-bottom:1px solid var(--sticky-border);box-shadow:var(--sticky-shadow);}.top-sticky .hero{padding-top:calc(20px + env(safe-area-inset-top));padding-bottom:4px;}@media (min-width:768px){.top-sticky{margin:0 -28px;padding:0 28px 8px;}}@media (min-width:1024px){.top-sticky{margin:0 -36px;padding:0 36px 8px;}}@media (min-width:1280px){.top-sticky{margin:0 -40px;padding:0 40px 8px;}}.tab{flex:1 1 0;min-width:0;background:transparent;border:none;color:var(--text-dim);padding:6px 2px 4px;border-radius:12px;font-size:0.62rem;font-weight:600;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-family:inherit;outline:none;-webkit-tap-highlight-color:transparent;min-height:48px;}.tab svg{flex-shrink:0;opacity:0.85;width:22px;height:22px;}.tab span{overflow:hidden;text-overflow:ellipsis;max-width:100%;line-height:1.1;letter-spacing:0.01em;}.tab:hover{color:var(--text);background:rgba(255,255,255,0.06);}.tab.active{background:transparent;font-weight:700;}.pane{display:none;}.pane.active{display:block;padding-top:12px;}@keyframes fadeIn{to{opacity:1;transform:translateY(0)}}.grid{display:flex;flex-direction:column;gap:10px;}.item{position:relative;display:flex;gap:14px;background:var(--panel-grad);border:1px solid var(--border);border-radius:var(--radius-lg);padding:14px 16px;transition:transform 0.2s ease,border-color 0.2s,box-shadow 0.2s;overflow:hidden;box-shadow:0 4px 20px var(--shadow-card),inset 0 1px 0 var(--hover-bg);text-decoration:none;color:inherit;}.item.clickable{cursor:pointer;}.item.clickable:active{background:var(--surface-2);}@keyframes fadeInUp{from{opacity:0;transform:translateY(10px)}}.item:hover{border-color:rgba(167,139,250,0.25);box-shadow:0 8px 28px rgba(0,0,0,0.45),0 0 0 1px rgba(167,139,250,0.08);transform:translateY(-1px);}.wl-remove,.wl-drop,.wl-watched,.wl-unwatch{position:absolute;top:6px;right:6px;width:26px;height:26px;border-radius:50%;background:rgba(0,0,0,0.65);line-height:1;cursor:pointer;z-index:3;display:flex;align-items:center;justify-content:center;padding:0;font-family:inherit;transition:background 0.15s,transform 0.15s,opacity 0.15s,color 0.15s;}.wl-remove{color:#fff;border:1px solid rgba(255,255,255,0.22);font-size:1rem;font-weight:400;opacity:0.88;}.wl-remove:hover{background:rgba(200,70,80,0.92);opacity:1;transform:scale(1.06);}.wl-drop{position:absolute;top:6px;right:6px;width:30px;height:30px;border-radius:50%;background:rgba(0,0,0,0.72);color:#ff8a8a;border:1px solid rgba(255,120,120,0.55);font-size:0.85rem;opacity:1;z-index:5;display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;}.wl-drop:hover{background:rgba(200,70,80,0.95);color:#fff;transform:scale(1.08);}.wl-drop svg{display:block;pointer-events:none;}.wl-drop:disabled{opacity:0.5;cursor:wait;}.cal-action-row{display:flex;flex-direction:row;flex-wrap:nowrap;gap:6px;margin-top:8px;align-self:stretch;width:100%;box-sizing:border-box;}.cal-open-btn,.cal-drop-btn{align-self:auto;margin-top:0;margin-left:0;flex:1 1 0;min-width:0;display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:6px 8px;border-radius:var(--r-sm,10px);font-size:0.72rem;font-weight:600;cursor:pointer;font-family:inherit;transition:all 0.15s;white-space:nowrap;box-sizing:border-box;}.cal-open-btn{background:rgba(90,120,180,0.14);border:1px solid rgba(140,170,220,0.35);color:#9db5e0;}.cal-open-btn:hover{background:rgba(120,150,210,0.28);color:#c2d4f0;border-color:rgba(140,170,220,0.65);}.cal-open-btn svg{flex-shrink:0;pointer-events:none;}.cal-drop-btn{background:rgba(224,85,96,0.14);border:1px solid rgba(224,85,96,0.4);color:#ff8a8a;}.cal-drop-btn:hover{background:rgba(224,85,96,0.3);color:#ffb3b3;border-color:rgba(224,85,96,0.65);}.cal-drop-btn svg{flex-shrink:0;pointer-events:none;}.cal-drop-btn:disabled{opacity:0.5;cursor:wait;}.wl-watched{color:#4ade80;border:1px solid rgba(74,222,128,0.45);font-size:0.85rem;font-weight:700;opacity:0.9;}.wl-watched:hover{background:rgba(74,222,128,0.95);color:#000;opacity:1;transform:scale(1.06);}.wl-unwatch{color:#ffb84d;border:1px solid rgba(255,184,77,0.45);font-size:0.9rem;font-weight:700;opacity:0.9;}.wl-unwatch:hover{background:rgba(255,184,77,0.95);color:#000;opacity:1;transform:scale(1.06);}.wl-remove:disabled,.wl-watched:disabled,.wl-unwatch:disabled{opacity:0.5;cursor:wait;}.poster{width:76px;height:114px;border-radius:10px;overflow:hidden;flex-shrink:0;background:var(--surface-2);position:relative;}.poster img{width:100%;height:100%;object-fit:cover;}.poster-ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.8rem;background:var(--soft-card-grad);color:var(--text-dim);}.poster-play{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:46px;height:46px;border-radius:50%;background:rgba(8,10,18,0.72);color:#fff;display:flex;align-items:center;justify-content:center;opacity:1;text-decoration:none;border:1px solid rgba(255,255,255,0.24);z-index:4;box-shadow:0 4px 18px rgba(0,0,0,0.55);-webkit-tap-highlight-color:transparent;}.poster-play svg{display:block;margin-left:2px;pointer-events:none;width:24px;height:24px;}.item:hover .poster-play{opacity:1;}.poster-play:hover{background:linear-gradient(145deg,#8b5cf6,#a78bfa);transform:translate(-50%,-50%) scale(1.1);color:#fff;border-color:rgba(255,255,255,0.4);box-shadow:0 8px 28px rgba(139,92,246,0.6);}.poster-play:active{transform:translate(-50%,-50%) scale(0.94);}.info{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:6px;padding-right:4px;}.name-row{display:flex;align-items:baseline;gap:0;overflow:hidden;white-space:nowrap;line-height:1.3;letter-spacing:-0.2px;}.name{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:1rem;font-weight:700;color:var(--text);}.tag{flex:0 0 auto;font-size:inherit;font-weight:inherit;letter-spacing:0;white-space:nowrap;}.tag.upcoming{color:#ffb84d;}.tag.aired{color:#4ade80;}.tag.soon{color:#fbbf24;}.overview{font-size:0.8rem;color:var(--text-dim);overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;line-height:1.45;margin-top:4px;}.meta{font-size:0.8rem;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.meta.dim{color:#7a8394;font-size:0.78rem;margin-top:2px;}.bar{height:3px;background:rgba(255,255,255,0.06);border-radius:99px;overflow:hidden;margin-top:8px;}.bar-fill{height:100%;background:linear-gradient(90deg,#7c3aed,#c4b5fd);border-radius:99px;box-shadow:0 0 10px rgba(167,139,250,0.5);}.search-bar{margin-bottom:16px;}.search-input{width:100%;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:12px 16px;border-radius:12px;font-size:0.95rem;font-family:inherit;outline:none;-webkit-appearance:none;appearance:none;}.search-input:focus{background:var(--surface-2);}.search-input::placeholder{color:var(--text-mute);}.trending-section{grid-column:1/-1;width:100%;margin:0 0 6px;min-width:0;}.trending-head{display:flex;align-items:center;gap:8px;width:100%;background:none;border:none;font:inherit;color:var(--text);cursor:pointer;font-size:0.88rem;font-weight:700;margin:0;padding:4px 2px 6px;letter-spacing:0.2px;text-align:left;-webkit-tap-highlight-color:transparent;}.trending-head::before{content:"";width:3px;height:14px;border-radius:2px;background:linear-gradient(180deg,#f97316,#ef4444);flex-shrink:0;}.trending-section[data-trend-sec="reco"] .trending-head::before{background:linear-gradient(180deg,#a78bfa,#7c3aed);}.trending-head-label{flex:1;min-width:0;}.trending-chev{flex-shrink:0;color:var(--text-dim);transition:transform .2s ease;opacity:.75;}.trending-section.is-collapsed .trending-chev{transform:rotate(-90deg);}.trending-section.is-collapsed .trending-body{display:none;}.trending-body{min-width:0;}.trending-scroll{display:flex;gap:12px;overflow-x:auto;padding:0 2px 6px;-webkit-overflow-scrolling:touch;scrollbar-width:thin;scroll-behavior:smooth;}.home-section{margin-bottom:12px;}.home-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;}.home-section-title{font-size:1rem;font-weight:700;letter-spacing:0.2px;display:flex;align-items:center;gap:8px;}.home-section-title::before{content:"";width:3px;height:16px;border-radius:2px;}.home-more-btn{background:transparent;border:none;color:var(--text-dim);font-size:0.82rem;font-weight:600;cursor:pointer;font-family:inherit;padding:6px 10px;border-radius:8px;transition:all 0.15s;display:inline-flex;align-items:center;gap:4px;}.home-more-btn:hover{color:var(--accent-2);background:rgba(167,139,250,0.1);}.home-more-btn svg{transition:transform 0.2s ease;}.platform-section{margin-bottom:14px;}.platform-rows{display:flex;flex-direction:column;gap:8px;}.platform-row{display:flex;align-items:center;gap:8px;min-width:0;}.platform-cards{display:flex;gap:10px;overflow-x:auto;padding:2px 2px 6px;-webkit-overflow-scrolling:touch;scrollbar-width:none;flex:1;min-width:0;scroll-snap-type:x proximity;}.platform-cards::-webkit-scrollbar{display:none;}.platform-card{flex:0 0 auto;width:min(62vw,232px);height:96px;border:none;border-radius:14px;background:var(--platform-card-grad);box-shadow:0 8px 20px var(--shadow-card),inset 0 1px 0 var(--hover-bg-strong);display:flex;align-items:stretch;padding:0;cursor:pointer;overflow:visible;position:relative;scroll-snap-align:start;-webkit-tap-highlight-color:transparent;font:inherit;color:var(--platform-card-text);}html[data-theme="light"] .platform-card:hover{box-shadow:0 4px 12px rgba(0,0,0,0.03),inset 0 1px 0 #ffffff;}.platform-card-left{flex:0 0 34%;max-width:34%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;z-index:2;position:relative;}.platform-card-logo{border-radius:0;object-fit:contain;object-position:center;flex-shrink:0;box-shadow:none;background:transparent;padding:0;box-sizing:border-box;display:block;}.platform-card-name{display:none;}.platform-card-right{flex:1;position:relative;min-width:0;overflow:visible;}.platform-card-posters{position:absolute;right:-4px;top:50%;transform:translateY(-50%);width:158px;height:100px;pointer-events:none;}.platform-card-poster{position:absolute;width:52px;height:74px;border-radius:8px;object-fit:cover;box-shadow:0 5px 12px rgba(0,0,0,0.32);border:1.5px solid rgba(255,255,255,0.9);background:#c5c9d0;top:50%;margin-top:-37px;transform-origin:50% 100%;}.platform-card-poster.p0{right:8px;z-index:5;transform:rotate(-6deg);}.platform-card-poster.p1{right:36px;z-index:4;transform:rotate(5deg);}.platform-card-poster.p2{right:60px;z-index:3;transform:rotate(-12deg);}.platform-card-poster.p3{right:84px;z-index:2;transform:rotate(10deg);}@media (min-width:768px){.platform-card{flex:1 1 225px;min-width:225px;width:auto;height:96px;border-radius:16px;}.platform-card-logo{border-radius:0;padding:0;}.platform-card-posters{width:168px;height:100px;}.platform-card-poster{width:60px;height:86px;margin-top:-43px;border-radius:10px;}.platform-card-poster.p0{right:10px;transform:rotate(-5deg);}.platform-card-poster.p1{right:42px;transform:rotate(4deg);}.platform-card-poster.p2{right:70px;transform:rotate(-10deg);}.platform-card-poster.p3{right:98px;transform:rotate(8deg);}.platform-cards{gap:12px;}}.h-scroll-wrap{margin:0 -16px;padding:0 16px;}.h-scroll{display:flex;gap:12px;overflow-x:auto;padding:2px 0 8px;-webkit-overflow-scrolling:touch;scrollbar-width:none;scroll-snap-type:x proximity;}.h-scroll::-webkit-scrollbar{display:none;}.h-scroll-empty{padding:30px 0;text-align:center;}.h-scroll .item{flex:0 0 auto;width:132px;display:flex;flex-direction:column;gap:0;padding:0;border-radius:12px;background:transparent;border:none;overflow:visible;box-shadow:none;scroll-snap-align:start;transform:none;}.h-scroll .item:hover{background:transparent;border:none;box-shadow:none;transform:none;}.h-scroll .item.clickable:active{transform:scale(0.96);background:transparent;}.h-scroll .item .poster{width:100%;height:auto;aspect-ratio:2/3;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.5);transition:transform 0.25s ease,box-shadow 0.25s ease;}.h-scroll .item:hover .poster{transform:translateY(-3px);box-shadow:0 12px 28px rgba(91,124,250,0.3),0 4px 16px rgba(0,0,0,0.6);}.h-scroll .item .info{display:block;padding:10px 8px 8px;flex:none;justify-content:flex-start;}.h-scroll .item .name{font-size:0.82rem;line-height:1.3;}.h-scroll .item .overview{display:none;}.h-scroll .item .meta{font-size:0.72rem;margin-top:2px;color:var(--text-dim);}.h-scroll .item .meta.dim{font-size:0.7rem;}.h-scroll .hist-days{display:flex;flex-direction:column;gap:24px;width:100%;padding-top:4px;}.hist-day-head{display:flex;align-items:center;gap:12px;margin:0 0 12px;padding:0 2px;}.hist-day-num{flex-shrink:0;width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.05rem;font-weight:800;color:var(--text);background:var(--surface-2,#1c1f2a);border:1px solid var(--border,rgba(255,255,255,.08));}.hist-day-num.is-today{background:linear-gradient(135deg,#7c3aed,#a78bfa);color:#fff;border-color:transparent;}.hist-day-text{flex:1;min-width:0;}.hist-day-main{font-size:0.95rem;font-weight:700;line-height:1.2;}.hist-day-sub{font-size:0.72rem;color:var(--text-dim);margin-top:2px;}.hist-day-count{font-size:0.72rem;color:var(--text-mute,var(--text-dim));flex-shrink:0;}.hist-day-grid{margin:0;}#history.pane{padding-top:8px;}#history>.grid{display:block;padding:20px 0 12px;}#history>.grid>.hist-days{width:100%;}.cw-card{flex:0 0 auto;width:var(--poster-card-w);max-width:var(--poster-card-w);display:flex;flex-direction:column;gap:0;padding:0;border-radius:12px;background:transparent;border:none;overflow:visible;scroll-snap-align:start;position:relative;}.h-scroll .cw-card:hover{background:transparent;border:none;box-shadow:none;transform:none;}.h-scroll .cw-card.clickable:active{transform:scale(0.97);}.cw-poster{position:relative;width:100%;aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:var(--surface-2);}html[data-theme="light"] .cw-poster{box-shadow:0 4px 12px rgba(0,0,0,0.06);}.cw-poster img{width:100%;height:100%;object-fit:cover;display:block;}.cw-poster .poster-ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2rem;color:var(--text-dim);background:var(--soft-card-grad,var(--surface-2));}.cw-overlay{position:absolute;left:8px;bottom:12px;z-index:2;font-size:0.72rem;font-weight:700;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,0.85);background:rgba(0,0,0,0.45);padding:3px 8px;border-radius:6px;max-width:calc(100% - 16px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.cw-bar{position:absolute;left:0;right:0;bottom:0;height:3px;}.cw-bar-fill{height:100%;background:linear-gradient(90deg,#a78bfa,#7c3aed);}.cw-info{padding:8px 12px 6px;min-width:0;display:flex;flex-direction:column;gap:2px;}.cw-title-row{display:flex;align-items:center;gap:4px;min-width:0;position:relative;line-height:1.25;padding-right:28px;}.cw-title{flex:1;min-width:0;font-size:0.82rem;font-weight:600;line-height:1.25;color:var(--text);display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;}.cw-badge-rewatch{display:inline-flex;align-items:center;justify-content:center;padding:0 5px;height:16px;font-size:0.62rem;font-weight:700;color:#fff;background:linear-gradient(135deg,#8b5cf6,#a78bfa);border-radius:4px;margin-left:4px;flex-shrink:0;transform:translateY(-1px);}.cw-watching{font-size:0.72rem;font-weight:500;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.cw-meta{margin-top:0;font-size:0.68rem;line-height:1.25;color:var(--text-mute,var(--text-dim));}.cw-more{position:absolute;right:-8px;top:50%;transform:translateY(-50%);width:36px;height:36px;margin:0;border:none;background:transparent;color:var(--text-dim);border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;font-family:inherit;transition:color 0.15s,background 0.15s;-webkit-tap-highlight-color:transparent;z-index:6;touch-action:manipulation;}.cw-more::before{content:"";position:absolute;inset:-6px;border-radius:50%;}.cw-more:hover,.cw-more:active{color:var(--text);background:rgba(255,255,255,0.1);}.cw-sheet{position:fixed;inset:0;z-index:500;display:none;}.cw-sheet.open{display:block;}.cw-sheet-backdrop{position:absolute;inset:0;}.cw-sheet-panel{position:absolute;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));padding:8px;animation:cwSheetIn 0.2s cubic-bezier(0.2,0.9,0.3,1);}@keyframes cwSheetIn{from{opacity:0;transform:translateY(12px)}}.cw-sheet-title{padding:8px 14px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.cw-sheet-item{display:block;width:100%;text-align:left;border:none;background:transparent;font-size:1rem;font-weight:600;font-family:inherit;padding:16px 14px;border-radius:12px;cursor:pointer;min-height:48px;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}.cw-sheet-cancel{border-top:1px solid var(--border,rgba(255,255,255,0.08));}@media (min-width:700px){.cw-sheet-panel{left:50%;right:auto;bottom:auto;top:50%;transform:translate(-50%,-50%);width:min(340px,92vw);animation:cwSheetInCenter 0.2s cubic-bezier(0.2,0.9,0.3,1);}@keyframes cwSheetInCenter{from{opacity:0;transform:translate(-50%,-48%) scale(0.96)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}}.cw-modal-grid{padding:2px 0 4px;}.cw-modal-grid .meta{min-height:1.3em;}.cw-modal-grid .overview{-webkit-line-clamp:3;line-height:1.5;min-height:calc(3 * 1.5em);flex:0 0 auto;}.cw-modal-grid .bar{min-height:3px;}@media (min-width:768px){.cw-modal-grid .item{display:flex;flex-direction:column;height:100%;}.cw-modal-grid .info{display:flex;flex-direction:column;flex:1 1 auto;min-width:0;}.cw-modal-grid .cw-actions{margin-top:auto;padding-top:10px;}.cw-modal-grid .cal-action-row{margin-top:auto;padding-top:10px;}}.cw-card .wl-watched{top:6px;right:6px;}@media (min-width:768px){.h-scroll .cw-card{width:260px;}.cw-title{font-size:0.86rem;}}.h-scroll .item .bar{margin-top:6px;}.h-scroll .item .wl-watched,.h-scroll .item .wl-remove,.h-scroll .item .wl-drop,.h-scroll .item .wl-unwatch{top:6px;right:6px;width:24px;height:24px;font-size:0.75rem;}.h-scroll .item .cal-action-row,.h-scroll .item .cal-open-btn{display:none;}.h-scroll .item .poster-play{width:46px;height:46px;opacity:1;}.h-scroll .item .poster-play svg{width:24px;height:24px;}@media (min-width:768px){.h-scroll-wrap{margin:0;padding:0;}.h-scroll .item{width:168px;}}@media (min-width:1024px){.h-scroll .item{width:188px;}}@media (min-width:1280px){.h-scroll .item{width:200px;}}@media (min-width:1600px){.h-scroll .item{width:214px;}}@media (min-width:1920px){.container{width:100%;padding-left:48px;padding-right:48px;}.h-scroll .item{width:228px;}}@media (min-width:2200px){.h-scroll .item{width:240px;}}.grid .item .cw-more{margin-left:auto;flex-shrink:0;width:28px;height:28px;border:none;background:transparent;color:var(--text-dim);border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;}.grid .item .cw-more:hover{color:var(--text);background:var(--chip-bg);}.grid .item .name-row{display:flex;align-items:center;gap:6px;}.cw-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}.cw-act-btn{flex:1 1 auto;min-width:0;padding:8px 12px;border-radius:10px;font-size:0.78rem;font-weight:600;font-family:inherit;cursor:pointer;border:1px solid var(--chip-border);background:var(--chip-bg);color:var(--chip-fg);transition:background 0.15s,border-color 0.15s,color 0.15s;-webkit-tap-highlight-color:transparent;}.cw-act-btn:hover{background:var(--chip-bg-hover);color:var(--chip-fg-hover);}.cw-act-btn.danger{border-color:rgba(224,85,96,0.35);background:rgba(224,85,96,0.1);color:#ff8a8a;}.cw-act-btn.danger:hover{background:rgba(224,85,96,0.18);color:#ffb0b0;}.h-scroll .cw-actions{flex-direction:column;gap:6px;}.h-scroll .cw-act-btn{width:100%;padding:7px 10px;font-size:0.72rem;}.list-modal{position:fixed;inset:0;z-index:150;display:none;}.list-modal.open{display:block;}.list-modal-backdrop{position:absolute;inset:0;animation:fadeIn 0.2s ease;}.list-modal-panel{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(94vw,1000px);max-height:88vh;display:flex;flex-direction:column;background:var(--panel-grad);border:1px solid var(--border-strong);border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,0.85);overflow:hidden;animation:modalIn 0.25s cubic-bezier(0.2,0.9,0.3,1);}.list-modal-head{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);flex-shrink:0;}.list-modal-title{font-size:1.05rem;font-weight:700;}.list-modal-close{width:40px;height:40px;border-radius:50%;border:1px solid var(--chip-border);background:var(--chip-bg);color:var(--chip-fg);font-size:1.2rem;cursor:pointer;font-family:inherit;line-height:1;display:flex;align-items:center;justify-content:center;transition:all 0.15s;}.list-modal-close:hover{color:#fff;border-color:var(--border-strong);background:rgba(255,255,255,0.08);}.list-modal-body{overflow-y:auto;-webkit-overflow-scrolling:touch;}.douban-filter-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;}.douban-filter-tab{background:var(--chip-bg);border:1px solid var(--chip-border);color:var(--chip-fg);padding:7px 16px;border-radius:999px;font-size:0.82rem;font-weight:600;cursor:pointer;font-family:inherit;transition:all 0.15s;-webkit-tap-highlight-color:transparent;}.douban-filter-tab:hover{color:var(--chip-fg-hover);border-color:var(--chip-border);background:var(--chip-bg-hover);}.douban-filter-tab.active{background:var(--brand-grad);color:#fff;border-color:transparent;box-shadow:0 4px 14px rgba(167,139,250,0.3);}.theater-home-tabs{display:flex;gap:8px;overflow-x:auto;padding:0 16px 12px;margin:0 -16px;scrollbar-width:none;-webkit-overflow-scrolling:touch;scroll-snap-type:x proximity;}.theater-home-tabs::-webkit-scrollbar{display:none;}.theater-filter-tab{flex-shrink:0;background:var(--chip-bg);border:1px solid var(--chip-border);color:var(--chip-fg);padding:6px 14px;border-radius:999px;font-size:0.78rem;font-weight:600;cursor:pointer;font-family:inherit;transition:all 0.15s;-webkit-tap-highlight-color:transparent;scroll-snap-align:start;}.theater-filter-tab:hover{color:var(--chip-fg-hover);border-color:var(--chip-border);background:var(--chip-bg-hover);}.theater-filter-tab.active{background:var(--brand-grad);color:#fff;border-color:transparent;box-shadow:0 4px 14px rgba(167,139,250,0.3);}@media (min-width:768px){.theater-home-tabs{margin:0;padding-left:0;padding-right:0;}}@media (max-width:599px){.list-modal-panel{top:auto;bottom:0;left:0;right:0;transform:none;width:100%;max-height:92vh;border-radius:18px 18px 0 0;}}.show-cal-modal{position:fixed;inset:0;z-index:240;display:none;}.show-cal-modal.open{display:block;}.show-cal-backdrop{position:absolute;inset:0;background:var(--overlay);animation:fadeIn 0.2s ease;}.show-cal-panel{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);overflow-y:auto;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:20px;box-shadow:0 30px 80px rgba(0,0,0,0.8);animation:modalIn 0.25s cubic-bezier(0.2,0.9,0.3,1);}.show-cal-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;}.show-cal-name{font-size:0.95rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;}.show-cal-close{width:40px;height:40px;flex-shrink:0;background:var(--chip-bg);border:1px solid var(--chip-border);color:var(--chip-fg);border-radius:50%;cursor:pointer;font-size:1.2rem;line-height:1;display:flex;align-items:center;justify-content:center;transition:all 0.15s;font-family:inherit;}.show-cal-close:hover{color:var(--chip-fg-hover);border-color:var(--chip-border);background:var(--chip-bg-hover);}.show-cal-info{font-size:0.72rem;color:var(--text-dim);margin-bottom:12px;line-height:1.4;}.show-cal-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;font-size:0.88rem;color:var(--text);font-weight:600;}.show-cal-nav button{width:30px;height:30px;background:var(--chip-bg);border:1px solid var(--chip-border);color:var(--chip-fg);border-radius:8px;cursor:pointer;font-size:1rem;line-height:1;display:flex;align-items:center;justify-content:center;transition:all 0.15s;font-family:inherit;}.show-cal-nav button:hover{color:var(--chip-fg-hover);border-color:var(--chip-border);background:var(--chip-bg-hover);}.show-cal-weekdays{display:grid;grid-template-columns:repeat(7,1fr);text-align:center;font-size:0.7rem;color:var(--text-dim);margin-bottom:6px;}.show-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);}.sc-day{position:relative;display:flex;align-items:center;justify-content:center;border-radius:8px;font-size:0.8rem;color:var(--text-dim);cursor:default;border:1px solid transparent;transition:background 0.15s,border-color 0.15s;}.sc-day.sc-has{cursor:pointer;font-weight:700;}.sc-day.sc-past{background:var(--cal-soft);color:var(--cal-accent-2);border-color:rgba(120,150,210,0.5);}.sc-day.sc-past:hover{background:var(--cal-soft-border);color:#d0dcf0;}.sc-day.sc-today-day{background:var(--cal-accent);color:#fff;border-color:#7d9dd4;box-shadow:0 0 14px rgba(125,157,212,0.7);}.sc-day.sc-today-day:hover{background:#5b7fc4;}.sc-day.sc-future{background:rgba(255,184,77,0.18);color:#ffd693;border-color:rgba(255,184,77,0.55);}.sc-day.sc-future:hover{background:rgba(255,184,77,0.4);color:#fff0d0;}.sc-day.sc-active{outline:2px solid #fff;outline-offset:-2px;}.sc-day.sc-empty{visibility:hidden;}.sc-badge{position:absolute;top:2px;right:2px;min-width:14px;height:14px;padding:0 3px;border-radius:7px;background:var(--cal-accent);color:#fff;font-size:0.6rem;font-weight:700;line-height:14px;text-align:center;}.sc-day.sc-future .sc-badge{background:#d99a3a;}.show-cal-legend{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:14px;font-size:0.7rem;color:var(--text-dim);}.legend-item{display:inline-flex;align-items:center;gap:5px;}.legend-dot{display:inline-block;width:10px;height:10px;border-radius:3px;}.legend-past{background:var(--cal-soft-border);border:1px solid rgba(140,170,220,0.8);}.legend-today{background:var(--cal-accent);border:1px solid #7d9dd4;}.legend-future{background:rgba(255,184,77,0.4);border:1px solid rgba(255,184,77,0.8);}.show-cal-detail{margin-top:14px;border-top:1px solid var(--border);padding-top:12px;min-height:20px;}.sc-ep{display:flex;gap:10px;align-items:baseline;padding:6px 0;font-size:0.82rem;}.sc-ep-tag{font-family:ui-monospace,Menlo,monospace;font-size:0.72rem;font-weight:700;color:#7d9dd4;flex-shrink:0;}.sc-ep-title{color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.ext-rating{display:inline-flex;align-items:center;justify-content:center;height:26px;box-sizing:border-box;gap:5px;padding:0 9px 0 7px;border-radius:7px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);line-height:1;font-size:0.82rem;color:var(--text);white-space:nowrap;text-decoration:none;}.ext-rating:hover{background:rgba(255,255,255,0.1);border-color:rgba(255,255,255,0.16);}.ext-logo{display:block;width:16px;height:16px;flex-shrink:0;border-radius:2px;}.ext-score{font-weight:800;letter-spacing:0.2px;font-variant-numeric:tabular-nums;}.ext-rating.ext-imdb{background:rgba(245,197,24,0.14);border-color:rgba(245,197,24,0.35);color:#f5c518;}.ext-rating.ext-imdb .ext-score{color:#f5c518;}.ext-rating.ext-rt{background:rgba(250,50,10,0.12);border-color:rgba(250,50,10,0.32);color:#ff7666;}.ext-rating.ext-rt .ext-score{color:#ff7666;}.ext-rating.ext-mc{background:rgba(255,255,255,0.05);border-color:rgba(255,255,255,0.12);color:var(--text);}.ext-rating.ext-trakt{background:rgba(237,28,36,0.12);border-color:rgba(237,28,36,0.32);color:#ff6b70;}.ext-rating.ext-trakt .ext-score{color:#ff6b70;}.ext-rating.ext-tmdb{background:rgba(1,180,228,0.12);border-color:rgba(1,180,228,0.32);color:#4dd0e1;}.ext-rating.ext-tmdb .ext-score{color:#4dd0e1;}.ext-rating.ext-douban{background:rgba(46,150,61,0.12);border-color:rgba(46,150,61,0.38);color:#4ecb71;}.ext-rating.ext-douban:hover{background:rgba(46,150,61,0.22);border-color:rgba(46,150,61,0.6);color:#6fe089;}.ext-score.mc-score-high{color:#66cc33;}.ext-score.mc-score-mid{color:#ffcc33;}.ext-score.mc-score-low{color:#ff4433;}html[data-theme="light"] .ext-rating{border-color:transparent;}html[data-theme="light"] .ext-rating:hover{filter:brightness(0.93);}html[data-theme="light"] .ext-rating.ext-imdb{background:#f5c518;color:#111;}html[data-theme="light"] .ext-rating.ext-imdb .ext-score{color:#111;}html[data-theme="light"] .ext-rating.ext-imdb .ext-logo path{fill:#111;}html[data-theme="light"] .ext-rating.ext-rt{background:#fa320a;color:#fff;}html[data-theme="light"] .ext-rating.ext-rt .ext-score{color:#fff;}html[data-theme="light"] .ext-rating.ext-rt .ext-logo path{fill:#fff;}html[data-theme="light"] .ext-rating.ext-trakt{background:#ed1c24;color:#fff;}html[data-theme="light"] .ext-rating.ext-trakt .ext-score{color:#fff;}html[data-theme="light"] .ext-rating.ext-trakt .ext-logo path{fill:#fff;}html[data-theme="light"] .ext-rating.ext-tmdb{background:#01b4e4;color:#fff;}html[data-theme="light"] .ext-rating.ext-tmdb .ext-score{color:#fff;}html[data-theme="light"] .ext-rating.ext-tmdb .ext-logo path{fill:#fff;}html[data-theme="light"] .ext-rating.ext-douban{background:#2d963d;color:#fff;}html[data-theme="light"] .ext-rating.ext-douban:hover{background:#257d32;color:#fff;}html[data-theme="light"] .ext-rating.ext-douban .ext-score{color:#fff;}html[data-theme="light"] .ext-rating.ext-douban .ext-logo path{fill:#fff;}html[data-theme="light"] .ext-rating.ext-mc{background:#26292e;border-color:transparent;color:#fff;}html[data-theme="light"] .ext-rating.ext-mc .ext-logo path{fill:#fff;}html[data-theme="light"] .ext-score.mc-score-high{color:#7ee650;}html[data-theme="light"] .ext-score.mc-score-mid{color:#ffd644;}html[data-theme="light"] .ext-score.mc-score-low{color:#ff6659;}.detail-ext-ratings{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:8px;align-items:center;}.detail-ext-ratings [data-defer-section="ratings"]{display:contents;}@media (min-width:600px){.container{padding-left:20px;padding-right:20px;}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;}.item{border-radius:14px;}.poster{width:72px;height:108px;}}@media (min-width:768px){.container{width:100%;padding:0 28px calc(68px + env(safe-area-inset-bottom,0px));}.hero{padding:12px 0 8px;gap:8px;}.hero-avatar{width:56px;height:56px;}.hero-name{font-size:1.55rem;}.tabs{padding:8px 12px calc(8px + env(safe-area-inset-bottom,0px));}.tab{flex:1 1 0;padding:8px 6px 6px;font-size:0.7rem;min-height:52px;}.tab svg{width:24px;height:24px;}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px;}.item{display:flex;flex-direction:column;gap:0;padding:0;border-radius:12px;background:transparent;border:none;overflow:visible;}.item:hover{background:transparent;border:none;}.item.clickable:active{transform:none;background:transparent;}.poster{width:100%;height:auto;aspect-ratio:2/3;border-radius:12px;transition:transform 0.25s ease,box-shadow 0.25s ease;box-shadow:0 4px 16px rgba(0,0,0,0.5);}.item:hover .poster{transform:translateY(-4px);box-shadow:0 12px 32px rgba(91,124,250,0.3),0 4px 16px rgba(0,0,0,0.6);}.info{display:block;padding:12px 14px 14px;flex:none;justify-content:flex-start;}.name{font-size:0.88rem;}.overview{-webkit-line-clamp:2;font-size:0.74rem;margin-top:6px;}.meta{font-size:0.76rem;margin-top:4px;}.meta.dim{font-size:0.72rem;margin-top:6px;}.bar{margin-top:8px;}.wl-remove,.wl-watched,.wl-unwatch{top:8px;right:8px;width:28px;height:28px;}.day-num{font-size:1.6rem;}}@media (min-width:1024px){.container{width:100%;padding:0 36px 100px;}.hero{padding:14px 0 8px;}.hero-name{font-size:1.7rem;}.grid{grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:20px;}.name{font-size:0.9rem;}.overview{-webkit-line-clamp:3;font-size:0.76rem;}.wl-remove,.wl-watched,.wl-unwatch{top:10px;right:10px;width:30px;height:30px;}.wl-watched,.wl-unwatch{font-size:0.95rem;}}@media (min-width:1280px){.container{width:100%;padding:0 40px 110px;}.grid{grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:22px;}.hero-name{font-size:1.85rem;}}@media (min-width:1600px){.container{width:100%;}.grid{grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:24px;}}.empty{text-align:center;padding:60px 20px;color:var(--text-dim);}.empty p{margin-top:12px;font-size:0.9rem;}@media (min-width:700px){.empty{padding:100px 20px;}}.modal{position:fixed;inset:0;z-index:220;display:none;}.modal.open{display:block;}.modal-backdrop{position:absolute;inset:0;background:var(--overlay-strong);animation:fadeIn 0.2s ease;}.modal-panel{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:12px;padding-top:calc(12px + env(safe-area-inset-top));padding-bottom:calc(12px + env(safe-area-inset-bottom));pointer-events:none;}.modal-shell{pointer-events:auto;position:relative;display:flex;flex-direction:column;width:100%;max-width:min(1120px,100%);max-height:100%;background:var(--modal-bg);border:1px solid var(--border);border-radius:18px;box-shadow:0 40px 100px rgba(0,0,0,0.85);animation:modalIn 0.28s cubic-bezier(0.2,0.9,0.3,1);overflow:hidden;}.modal-body{position:relative;width:100%;flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;background:var(--modal-bg);-webkit-overflow-scrolling:touch;overscroll-behavior:contain;}.modal-close{position:absolute;top:12px;right:12px;z-index:5;width:40px;height:40px;border-radius:50%;background:rgba(13,16,23,0.86);border:1px solid rgba(255,255,255,0.18);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.15s,transform 0.15s,border-color 0.15s;padding:0;box-shadow:0 4px 16px rgba(0,0,0,0.55);touch-action:manipulation;-webkit-tap-highlight-color:transparent;}.modal-close::before{content:"";position:absolute;inset:-8px;border-radius:50%;}.modal-close:hover{background:rgba(30,38,58,0.95);transform:scale(1.05);border-color:rgba(255,255,255,0.28);}.modal-close:active{transform:scale(0.94);background:rgba(50,60,88,0.95);}@media (max-width:599px){.modal-panel{padding:0;align-items:stretch;justify-content:flex-start;}.modal-shell{position:absolute;left:0;right:0;top:calc(10px + env(safe-area-inset-top));bottom:0;max-width:100%;max-height:none;width:100%;border-radius:16px 16px 0 0;border:none;border-top:1px solid var(--border);}.modal-body{padding-bottom:env(safe-area-inset-bottom);}.detail-inner{padding-top:24px;}.detail-body{padding-bottom:calc(28px + env(safe-area-inset-bottom));}.modal-close{top:12px;right:12px;width:40px;height:40px;background:rgba(13,16,23,0.94);border-color:rgba(255,255,255,0.24);box-shadow:0 6px 22px rgba(0,0,0,0.65),inset 0 1px 0 rgba(255,255,255,0.08);}.modal-close::before{inset:-12px;}.modal-close:active{transform:scale(0.9);background:rgba(50,60,88,0.96);}}@media (min-width:768px) and (max-width:1023px){.modal-shell{max-width:min(880px,92vw);}}@media (min-width:700px){.modal-panel{padding:40px 24px;}}@keyframes modalIn{from{opacity:0;transform:translateY(14px) scale(0.98)}to{opacity:1;transform:translateY(0) scale(1)}}.modal-loading{padding:100px 20px;text-align:center;}.modal-error{padding:80px 20px;text-align:center;color:#9db5e0;font-size:0.9rem;}.detail-hero{position:relative;overflow:hidden;background:var(--surface);border-radius:18px 18px 0 0;}.detail-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(30px) saturate(1.2) var(--detail-bg-filter,brightness(0.5));transform:scale(1.15);z-index:0;}.detail-hero::after{content:"";position:absolute;inset:0;z-index:1;background:var(--detail-hero-grad);}.detail-inner{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;text-align:center;gap:16px;padding:24px 20px 24px;}.detail-poster{width:min(48vw,200px);height:auto;aspect-ratio:2/3;border-radius:14px;object-fit:cover;flex-shrink:0;box-shadow:0 16px 40px var(--shadow-login);margin:0 auto;}.detail-poster-ph{display:flex;align-items:center;justify-content:center;background:var(--surface-2);font-size:2.8rem;color:var(--text-dim);width:min(48vw,200px);aspect-ratio:2/3;}.detail-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;align-items:center;width:100%;}.detail-title{font-size:1.45rem;font-weight:800;letter-spacing:-0.4px;line-height:1.25;color:var(--text);}.detail-tagline{font-size:0.85rem;color:var(--text-dim);font-style:italic;}.detail-meta{display:flex;flex-wrap:wrap;gap:10px;font-size:0.85rem;color:var(--text-dim);justify-content:center;}.detail-genres{font-size:0.82rem;color:var(--text-dim);}.detail-overview{font-size:0.88rem;color:var(--text-dim);line-height:1.55;margin-top:4px;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden;text-align:center;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:color 0.15s;}.detail-overview:active{color:var(--text);}.detail-overview.expanded{display:block;-webkit-line-clamp:unset;overflow:visible;cursor:pointer;}.d-status{display:flex;gap:12px;align-items:center;background:var(--panel-grad);border:1px solid var(--border);border-radius:14px;padding:12px 14px;margin-top:8px;width:100%;justify-content:flex-start;}.d-status.done{border-color:rgba(74,222,128,0.3);background:rgba(74,222,128,0.06);}.d-status-progress{flex-direction:column;align-items:stretch;gap:10px;}.d-status-row{display:flex;gap:12px;align-items:center;width:100%;}.d-status-icon{width:32px;height:32px;border-radius:50%;background:var(--surface-2);color:var(--text-dim);display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;font-size:0.95rem;}.d-status.done .d-status-icon{background:rgba(74,222,128,0.15);color:#4ade80;}.d-status-body{flex:1;min-width:0;text-align:left;}.d-status-title{font-size:0.88rem;font-weight:600;}.d-status-sub{font-size:0.76rem;color:var(--text-dim);margin-top:2px;}.d-action-bar{display:inline-flex;align-items:center;gap:2px;margin-top:16px;padding:4px;background:var(--pill-bg);border:1px solid var(--pill-border);border-radius:999px;box-shadow:var(--pill-shadow);}.d-act{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;border:none;background:transparent;color:var(--pill-fg);cursor:pointer;padding:0;font-family:inherit;-webkit-tap-highlight-color:transparent;text-decoration:none;flex-shrink:0;position:relative;}.d-act svg{display:block;pointer-events:none;}.d-act:hover{background:var(--pill-act-hover);color:#fff;}.d-act:active{transform:scale(0.9);}.d-act:disabled{opacity:0.5;cursor:default;pointer-events:none;}.d-act-watched.active{background:linear-gradient(145deg,#8b5cf6 0%,#a78bfa 55%,#c4b5fd 100%);color:#fff;box-shadow:0 4px 16px rgba(139,92,246,0.5),inset 0 1px 0 rgba(255,255,255,0.25);}.d-act-watched.active:hover{filter:brightness(1.1);color:#fff;}.d-act-wl.active{color:#c4b5fd;background:rgba(167,139,250,0.12);}.d-act-wl.active:hover{background:rgba(167,139,250,0.2);color:var(--accent);}.d-act-play{color:var(--pill-fg);}.d-act-play:hover{background:rgba(167,139,250,0.15);color:var(--accent);}.detail-body{padding:20px 22px 24px;}.d-section{margin-top:8px;margin-bottom:26px;}.d-section:last-child{margin-bottom:0;}.d-section-title{font-size:1rem;font-weight:700;letter-spacing:0.2px;margin-bottom:14px;color:var(--text);display:flex;align-items:center;gap:8px;}.d-section-title::before{content:"";width:3px;height:16px;border-radius:2px;background:#7d9dd4;}.cast-scroll{display:flex;gap:14px;overflow-x:auto;padding-bottom:8px;scrollbar-width:none;}.cast-scroll::-webkit-scrollbar{display:none;}.cast{flex-shrink:0;width:84px;text-align:center;}.cast-img{width:84px;height:84px;border-radius:50%;object-fit:cover;background:var(--surface-2);}.cast-ph{display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:0;font-weight:400;background:var(--soft-card-grad);}.cast-ph-icon{width:42%;height:42%;opacity:.55;display:block;}.cast-name{font-size:0.75rem;font-weight:600;margin-top:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.cast-role{font-size:0.68rem;color:var(--text-dim);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.seasons{display:flex;flex-direction:column;gap:8px;}.season-item{overflow:hidden;}.season-head{width:100%;background:none;border:none;color:inherit;display:flex;align-items:center;gap:10px;padding:14px 16px;cursor:pointer;font-family:inherit;text-align:left;transition:background 0.15s;}.season-head:hover{background:var(--surface-2);}.season-title{font-weight:600;font-size:0.9rem;flex:1;}.season-meta{font-size:0.76rem;color:var(--text-dim);}.chev{width:16px;height:16px;color:var(--text-dim);transition:transform 0.2s ease;flex-shrink:0;}.season-item.open .chev{transform:rotate(180deg);}.season-body{display:none;border-top:1px solid var(--border);background:rgba(0,0,0,0.12);}.season-item.open .season-body{display:block;}.season-body .episode:first-child{border-top:none;}.ep-empty{padding:20px;text-align:center;color:var(--text-dim);font-size:0.85rem;}.episode{display:flex;gap:14px;padding:14px;border-bottom:1px solid var(--border);align-items:stretch;}.episode:last-child{border-bottom:none;}.episode.clickable{cursor:pointer;}.episode.clickable:hover{background:var(--surface-2);}.episode.clickable:active{background:var(--surface-3);}.episode.clickable:hover .ep-title{color:#7d9dd4;}.episode.watched .ep-title{color:var(--text-dim);}.episode.watched.clickable:hover .ep-title{color:#7d9dd4;}.ep-still-wrap{position:relative;flex-shrink:0;width:140px;border-radius:10px;overflow:hidden;background:var(--surface-2);aspect-ratio:16/9;align-self:flex-start;}.ep-still{width:100%;height:100%;object-fit:cover;display:block;}.ep-still-ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.6rem;color:var(--text-dim);background:var(--soft-card-grad,var(--surface-2));}.ep-still-badge{position:absolute;top:6px;left:6px;font-size:0.65rem;font-weight:700;padding:2px 6px;border-radius:6px;background:rgba(52,211,153,0.9);color:#052e1c;}.ep-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;}.ep-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;}.ep-title-line{display:flex;align-items:baseline;gap:8px;min-width:0;flex:1;}.ep-num{font-family:ui-monospace,Menlo,monospace;font-size:0.95rem;color:var(--text-dim);font-weight:800;flex-shrink:0;letter-spacing:0.3px;}.ep-title{font-size:0.95rem;font-weight:700;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.ep-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:0.75rem;color:var(--text-dim);margin-top:2px;}.ep-vote{display:inline-flex;align-items:center;gap:3px;padding:1px 7px;border-radius:999px;background:rgba(167,139,250,0.14);color:#c4b5fd;font-weight:700;font-size:0.72rem;}.ep-dot{opacity:0.45;}.ep-overview{font-size:0.8rem;color:var(--text-dim);margin-top:4px;line-height:1.55;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}.ep-actions{flex-shrink:0;display:flex;align-items:center;gap:8px;}.ep-play-btn{width:30px;height:30px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;background:rgba(167,139,250,0.16);border:1px solid rgba(167,139,250,0.28);color:#c4b5fd;text-decoration:none;transition:background 0.15s,transform 0.12s;-webkit-tap-highlight-color:transparent;}.ep-play-btn:hover{background:rgba(167,139,250,0.28);color:#ddd6fe;}.ep-play-btn:active{transform:scale(0.94);}.ep-status{font-size:0.78rem;font-weight:600;white-space:nowrap;line-height:1;padding:0;border:none;background:none;font-family:inherit;}.ep-status.watched{color:#4ade80;cursor:default;}.ep-status.unwatched{color:var(--text-dim);}.ep-status.ep-status-unknown{color:var(--text-dim);opacity:.6;font-weight:500;cursor:default;}.ep-unknown-tip{padding:10px 14px;margin-bottom:2px;border-bottom:1px solid var(--border);color:var(--text-dim);font-size:0.78rem;line-height:1.5;}button.ep-status.unwatched{cursor:pointer;-webkit-tap-highlight-color:transparent;}button.ep-status.unwatched:hover{color:#6ee7b7;}@media (max-width:520px){.episode{gap:10px;padding:12px;}.ep-still-wrap{width:112px;}.ep-title{font-size:0.88rem;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}.ep-overview{-webkit-line-clamp:2;font-size:0.76rem;}}.ep-watch-btn:disabled{opacity:0.6;cursor:wait;}.ep-status.done,.ep-watch-btn.done{color:#4ade80;cursor:default;}.modal-body .grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px;}@media (min-width:700px){.detail-inner{flex-direction:row;align-items:flex-start;text-align:left;padding:34px;gap:30px;}.detail-poster{width:220px;height:auto;aspect-ratio:2/3;margin:0;}.detail-info{align-items:flex-start;}.detail-meta{justify-content:flex-start;}.detail-overview{text-align:left;}.detail-title{font-size:1.85rem;}.detail-overview{font-size:0.92rem;-webkit-line-clamp:6;}.detail-body{padding:30px 34px 34px;}.cast{width:96px;}.cast-img{width:96px;height:96px;}.modal-body .grid{grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:20px;}.detail-ext-ratings{justify-content:flex-start;}.d-action-bar{align-self:flex-start;}}.confirm-modal{position:fixed;inset:0;display:none;}.confirm-modal.open{display:block;}.confirm-backdrop{position:absolute;inset:0;background:var(--overlay);animation:fadeIn 0.18s ease;}.confirm-panel{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(88vw,340px);background:var(--panel-grad);border:1px solid var(--border-strong);border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,0.8);text-align:center;animation:confirmIn 0.22s cubic-bezier(0.2,0.9,0.3,1);}@keyframes confirmIn{from{opacity:0;transform:translate(-50%,-48%) scale(0.95)}}.confirm-icon{width:48px;height:48px;margin:0 auto 12px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.4rem;background:var(--accent-soft);color:var(--accent-2);}.confirm-icon.danger{background:rgba(224,85,96,0.14);color:#ff7b85;}.confirm-icon.warn{background:rgba(255,184,77,0.14);color:#ffb84d;}.confirm-icon.success{background:rgba(52,211,153,0.14);color:#34d399;}.confirm-title{font-size:1.02rem;font-weight:700;margin-bottom:6px;color:var(--text);}.confirm-msg{font-size:0.84rem;color:var(--text-dim);line-height:1.55;word-break:break-word;}.confirm-actions{display:flex;gap:10px;margin-top:20px;}.confirm-btn{flex:1;padding:11px 14px;border-radius:12px;font-size:0.88rem;font-weight:700;font-family:inherit;cursor:pointer;border:1px solid transparent;transition:all 0.15s;-webkit-tap-highlight-color:transparent;}.confirm-cancel{background:var(--chip-bg);border-color:var(--chip-border);color:var(--chip-fg);}.confirm-cancel:hover{background:var(--chip-bg-hover);color:var(--chip-fg-hover);}.confirm-ok{color:#fff;}.confirm-ok:hover{filter:brightness(1.08);}.confirm-ok.danger{background:linear-gradient(135deg,#dc2626 0%,#f87171 100%);box-shadow:0 6px 20px rgba(248,113,113,0.28);}.confirm-ok:disabled,.confirm-cancel:disabled{opacity:0.6;cursor:wait;}.hero-avatar{border:2px solid rgba(167,139,250,0.5);padding:0;cursor:pointer;font:inherit;color:inherit;}.hero-avatar:active{transform:scale(0.97);}.summary-modal{position:fixed;inset:0;z-index:160;display:none;}.summary-modal.open{display:block;}.summary-backdrop{position:absolute;inset:0;background:var(--overlay);}.summary-panel{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(94vw,480px);max-height:88vh;display:flex;flex-direction:column;background:var(--panel-grad);border:1px solid var(--border-strong);border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,0.85);overflow:hidden;}.summary-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px 10px;border-bottom:1px solid var(--border);flex-shrink:0;}.summary-title{font-size:1.05rem;font-weight:700;}.summary-close{width:40px;height:40px;border-radius:50%;border:1px solid var(--chip-border);background:var(--chip-bg);color:var(--chip-fg);font-size:1.2rem;cursor:pointer;font-family:inherit;line-height:1;}.summary-close:hover{color:#fff;border-color:var(--border-strong);}.summary-body{overflow-y:auto;padding:12px 16px 20px;-webkit-overflow-scrolling:touch;}@media (max-width:599px){.summary-panel{top:auto;bottom:0;left:0;right:0;transform:none;width:100%;max-height:92vh;border-radius:18px 18px 0 0;}}.sum-wrap{padding:4px 0 24px;}.sum-nav{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:18px;}.sum-nav-btn{width:36px;height:36px;border-radius:10px;border:1px solid var(--chip-border);background:var(--chip-bg);color:var(--text-dim);font-size:1.2rem;cursor:pointer;font-family:inherit;transition:all 0.15s;}.sum-nav-btn:hover{color:#fff;border-color:var(--border-strong);background:rgba(167,139,250,0.12);}.sum-nav-center{flex:1;text-align:center;min-width:0;}.sum-lifetime{margin:0 0 14px;padding:14px 14px 12px;border-radius:14px;background:var(--panel-grad,var(--surface-2));border:1px solid var(--border);}.sum-life-title{font-size:.78rem;font-weight:600;color:var(--text-mute);margin:0 0 10px;letter-spacing:.02em;}.sum-life-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;text-align:center;}.sum-life-num{font-size:1.15rem;font-weight:800;letter-spacing:-.4px;line-height:1.15;background:var(--num-grad,linear-gradient(135deg,#c4b5fd,#93c5fd));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;}.sum-life-label{font-size:.68rem;color:var(--text-mute);margin-top:4px;font-weight:500;}.sum-period-tabs{display:inline-flex;gap:4px;background:var(--chip-bg);border:1px solid var(--border);border-radius:999px;padding:3px;margin-bottom:8px;}.sum-period-btn{border:none;background:transparent;color:var(--text-dim);padding:6px 14px;border-radius:999px;font-size:0.8rem;font-weight:600;cursor:pointer;font-family:inherit;}.sum-period-btn.active{background:var(--brand-grad);color:#fff;}.sum-label{font-size:1.05rem;font-weight:700;letter-spacing:0.2px;}.sum-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px;}.sum-stat{text-align:center;background:var(--panel-grad);border:1px solid var(--border);border-radius:14px;padding:14px 6px;}.sum-stat-num{font-size:1.35rem;font-weight:800;letter-spacing:-0.5px;background:var(--num-grad);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;}.sum-stat-label{font-size:0.7rem;color:var(--text-mute);margin-top:2px;}.sum-chip{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:10px;background:rgba(167,139,250,0.1);border:1px solid rgba(167,139,250,0.25);color:var(--text-dim);font-size:0.82rem;margin-bottom:12px;}.sum-chip strong{color:var(--accent);}.sum-muted{font-size:0.8rem;color:var(--text-mute);margin:6px 0 12px;}.sum-block{margin-top:18px;}.sum-h3{font-size:0.92rem;font-weight:700;margin-bottom:10px;display:flex;align-items:center;gap:8px;}.sum-h3::before{content:"";width:3px;height:14px;border-radius:2px;background:linear-gradient(180deg,#a78bfa,#7c3aed);}.sum-heat{display:flex;flex-wrap:wrap;gap:4px;}.sum-heat-cell{width:12px;height:12px;border-radius:3px;background:rgba(255,255,255,0.06);}.sum-heat-cell.lv1{background:rgba(167,139,250,0.25);}.sum-heat-cell.lv2{background:rgba(167,139,250,0.45);}.sum-heat-cell.lv3{background:rgba(167,139,250,0.7);}.sum-heat-cell.lv4{background:#a78bfa;}.sum-list{display:flex;flex-direction:column;gap:8px;}.sum-row{display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--panel-grad);border:1px solid var(--border);border-radius:12px;}.sum-rank{width:22px;height:22px;border-radius:6px;background:rgba(167,139,250,0.15);color:#c4b5fd;font-size:0.72rem;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;}.sum-row-body{min-width:0;flex:1;}.sum-row-title{font-size:0.9rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.sum-year{font-weight:500;color:var(--text-mute);font-size:0.8rem;}.sum-row-meta{font-size:0.75rem;color:var(--text-dim);margin-top:2px;}@media (max-width:420px){.sum-stats{gap:6px;}.sum-stat{padding:12px 4px;}.sum-stat-num{font-size:1.15rem;}}#toast-container{position:fixed;left:50%;bottom:calc(28px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none;max-width:min(92vw,440px);width:max-content;}.toast{pointer-events:auto;display:flex;align-items:center;gap:10px;padding:11px 16px;font-size:0.86rem;font-weight:500;color:var(--toast-text);background:var(--toast-bg);opacity:0;transform:translateY(12px) scale(0.96);transition:opacity 0.22s ease,transform 0.22s ease;cursor:pointer;line-height:1.45;word-break:break-word;max-width:min(92vw,440px);}.toast.toast-in{opacity:1;transform:translateY(0) scale(1);}.toast.toast-out{opacity:0;transform:translateY(8px) scale(0.96);}.toast-icon{flex-shrink:0;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:800;line-height:1;}.toast-info .toast-icon{background:rgba(125,157,212,0.22);color:#a8c0e8;}.toast-success .toast-icon{background:rgba(52,211,153,0.22);color:#6ee7b7;}.toast-error .toast-icon{background:rgba(224,85,96,0.24);color:#ff8a8a;}.toast-warn .toast-icon{background:rgba(255,184,77,0.22);color:#ffd693;}.toast-success{border-color:rgba(52,211,153,0.35);}.toast-error{border-color:rgba(224,85,96,0.35);}.toast-warn{border-color:rgba(255,184,77,0.35);}@media (max-width:420px){.toast{font-size:0.82rem;padding:10px 14px;}}.cast.clickable{cursor:pointer;}.cast.clickable:hover .cast-img{transform:translateY(-2px) scale(1.03);box-shadow:0 8px 20px rgba(167,139,250,0.28);}.cast.clickable:hover .cast-name{color:#c4b5fd;}.cast-img{transition:transform 0.2s ease,box-shadow 0.2s ease;}.cast-name{transition:color 0.15s ease;}.trailer-grid{display:grid;grid-template-columns:1fr;gap:14px;}@media (min-width:600px){.trailer-grid{grid-template-columns:repeat(2,1fr);}}.trailer-card{position:relative;aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:linear-gradient(135deg,#1a1528 0%,#0e0e10 100%);cursor:pointer;border:1px solid var(--border);transition:border-color 0.15s,transform 0.15s;}.trailer-card:hover{border-color:rgba(167,139,250,0.4);transform:translateY(-1px);}.trailer-thumb{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;z-index:1;}.trailer-card.no-thumb .trailer-thumb{display:none;}.trailer-play{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:52px;height:52px;border-radius:50%;background:rgba(8,10,18,0.72);border:1px solid rgba(255,255,255,0.28);color:#fff;display:flex;align-items:center;justify-content:center;transition:background 0.15s,transform 0.15s;pointer-events:none;z-index:3;}.trailer-card:hover .trailer-play{background:linear-gradient(145deg,#8b5cf6,#a78bfa);transform:translate(-50%,-50%) scale(1.08);}.trailer-play svg{display:block;margin-left:2px;}.trailer-name{position:absolute;left:0;right:0;bottom:0;padding:22px 12px 9px;font-size:0.8rem;font-weight:600;color:#fff;background:linear-gradient(180deg,transparent,rgba(0,0,0,0.85));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;z-index:3;}.trailer-card.playing .trailer-thumb,.trailer-card.playing .trailer-play,.trailer-card.playing .trailer-name{display:none;}.trailer-frame{position:absolute;inset:0;width:100%;height:100%;background:var(--surface-2);z-index:2;}.trailer-frame:empty{display:none;}.trailer-frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:block;}.trailer-card.playing .trailer-thumb,.trailer-card.playing .trailer-play{opacity:0;pointer-events:none;}.trailer-yt-open{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);z-index:3;padding:6px 12px;border-radius:999px;background:rgba(0,0,0,.72);color:#fff;font-size:.75rem;text-decoration:none;border:1px solid rgba(255,255,255,.18);}.person-modal{position:fixed;inset:0;display:none;}.person-modal.open{display:block;}.person-backdrop{position:absolute;inset:0;background:var(--overlay);animation:fadeIn 0.2s ease;}.person-panel{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(94vw,760px);max-height:88vh;display:flex;flex-direction:column;background:var(--panel-grad);border:1px solid var(--border-strong);border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,0.85);overflow:hidden;animation:modalIn 0.25s cubic-bezier(0.2,0.9,0.3,1);}.person-panel-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border);flex-shrink:0;}.person-panel-name{font-size:1rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;}.person-close{width:40px;height:40px;flex-shrink:0;border-radius:50%;border:1px solid var(--chip-border);background:var(--chip-bg);color:var(--chip-fg);font-size:1.2rem;cursor:pointer;font-family:inherit;line-height:1;display:flex;align-items:center;justify-content:center;transition:all 0.15s;}.person-close:hover{color:#fff;border-color:var(--border-strong);}.person-panel-body{overflow-y:auto;padding:18px 20px 24px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;}@media (max-width:599px){.person-panel{top:auto;bottom:0;left:0;right:0;transform:none;width:100%;max-height:92vh;border-radius:18px 18px 0 0;}}.person-head{display:flex;gap:18px;margin-bottom:18px;}.person-photo{width:110px;height:165px;border-radius:12px;object-fit:cover;flex-shrink:0;background:var(--surface-2);box-shadow:0 8px 24px rgba(0,0,0,0.5);}.person-photo-ph{display:flex;align-items:center;justify-content:center;font-size:0;color:var(--text-dim);background:var(--soft-card-grad);}.person-photo-ph .cast-ph-icon{width:40%;height:40%;opacity:.5;}.person-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;}.person-name{font-size:1.3rem;font-weight:800;letter-spacing:-0.4px;line-height:1.25;}.person-sub{font-size:0.82rem;color:var(--text-dim);}.person-rows{display:flex;flex-direction:column;gap:4px;margin-top:4px;}.person-row{font-size:0.78rem;color:var(--text-dim);line-height:1.5;}.person-row b{color:var(--text);font-weight:600;margin-right:6px;}.person-bio{font-size:0.86rem;color:var(--text-dim);line-height:1.65;white-space:pre-line;margin-bottom:22px;padding-top:4px;border-top:1px solid var(--border);}.person-credits-title{font-size:0.95rem;font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:8px;}.person-credits-title::before{content:"";width:3px;height:14px;border-radius:2px;background:linear-gradient(180deg,#a78bfa,#7c3aed);}@media (max-width:480px){.person-head{flex-direction:column;align-items:center;text-align:center;gap:12px;}.person-info{align-items:center;}.person-photo{width:130px;height:195px;}.person-rows{align-items:center;}}.btn-action.loading{color:var(--accent-2);border-color:rgba(167,139,250,0.45);background:rgba(167,139,250,0.12);pointer-events:none;}.btn-action.loading svg{transform-origin:50% 50%;animation:btnSpin 0.7s linear infinite;}@keyframes btnSpin{}.btn-action.loading span::after{content:"";display:inline-block;width:0;overflow:hidden;animation:btnDots 1.2s steps(4,end) infinite;}@keyframes btnDots{0%{content:""}25%{content:"."}50%{content:".."}75%{content:"..."}}@media (max-width:767px){.h-scroll .item.cw-card{width:210px;max-width:210px;}.h-scroll .item.cw-card .cw-title{font-size:0.86rem;}.h-scroll .item.cw-card .cw-watching{font-size:0.74rem;}.h-scroll .item.cw-card .cw-meta{font-size:0.7rem;}.h-scroll .item.cw-card .cw-overlay{font-size:0.72rem;}}@media (min-width:768px){.h-scroll .item.cw-card{width:300px;max-width:300px;}.h-scroll .item.cw-card .cw-title{font-size:0.92rem;}.h-scroll .item.cw-card .cw-watching{font-size:0.8rem;}}.hist-day{margin-top:28px;}.hist-day:first-child{margin-top:4px;}.hist-day-head{margin-top:0;margin-bottom:14px;}:root{--mt-ease:cubic-bezier(.22,.68,.32,1);--mt-spring:cubic-bezier(.34,1.3,.58,1);--mt-t-fast:130ms;--mt-t-base:220ms;--mt-t-slow:360ms;}@keyframes mtFadeUp{from{opacity:0;transform:translateY(14px)}}@keyframes mtFadeDown{from{opacity:0;transform:translateY(-10px)}}@keyframes mtFadeIn{from{opacity:0}to{opacity:1}}@keyframes mtPop{0%{opacity:0;transform:scale(.94)}65%{opacity:1;transform:scale(1.012)}100%{opacity:1;transform:scale(1)}}@keyframes mtShellIn{0%{opacity:0;transform:translateY(26px) scale(.94)}55%{opacity:1;transform:translateY(-4px) scale(1.006)}100%{opacity:1;transform:translateY(0) scale(1)}}@keyframes mtShellOut{0%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(14px) scale(.965)}}@keyframes mtPanelIn{0%{opacity:0;transform:translate(-50%,-50%) scale(.9)}55%{opacity:1;transform:translate(-50%,-52%) scale(1.008)}100%{opacity:1;transform:translate(-50%,-50%) scale(1)}}@keyframes mtPanelOut{0%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-46%) scale(.94)}}@keyframes mtSheetIn{0%{opacity:0;transform:translateY(32px) scale(.98)}60%{opacity:1;transform:translateY(-3px) scale(1.004)}}@keyframes mtSheetOut{100%{opacity:0;transform:translateY(24px) scale(.98)}}@keyframes mtBackdropIn{from{opacity:0;}}@keyframes mtBackdropOut{0%{opacity:1}100%{opacity:0;}}@keyframes mtShimmer{from{background-position:130% 0}to{background-position:-130% 0}}@keyframes mtSeasonIn{from{opacity:0;transform:translateY(-6px)}}@keyframes mtTabPill{0%{transform:scale(.92)}60%{transform:scale(1.035)}100%{transform:scale(1)}}@keyframes mtCodeGlow{0%,100%{box-shadow:0 0 0 0 rgba(139,92,246,0)}50%{box-shadow:0 0 0 3px rgba(139,92,246,.16)}}.hero{animation:mtFadeDown var(--mt-t-slow) var(--mt-ease) backwards;}.tabs{animation:mtFadeUp var(--mt-t-slow) var(--mt-ease) .1s backwards;}.stat:nth-child(2){animation-delay:.04s;}.stat:nth-child(3){animation-delay:.08s;}.stat:nth-child(4){animation-delay:.12s;}.stat:hover .stat-num{color:var(--text);}.item{animation:mtFadeUp .44s var(--mt-ease) backwards;}.h-scroll .item{animation:mtFadeUp .42s var(--mt-ease) backwards;}.item:nth-child(2){animation-delay:.045s;}.item:nth-child(3){animation-delay:.09s;}.item:nth-child(4){animation-delay:.135s;}.item:nth-child(5){animation-delay:.18s;}.item:nth-child(6){animation-delay:.225s;}.item:nth-child(7){animation-delay:.27s;}.item:nth-child(8){animation-delay:.315s;}.item:nth-child(n+9){animation-delay:.36s;}.home-section{animation:mtFadeUp .5s var(--mt-ease) backwards;}.home-section:nth-child(2){animation-delay:.05s;}.home-section:nth-child(3){animation-delay:.1s;}.home-section:nth-child(4){animation-delay:.15s;}.home-section:nth-child(n+5){animation-delay:.2s;}.platform-card{animation:mtFadeUp .44s var(--mt-ease) backwards;}.platform-card:nth-child(2){animation-delay:.06s;}.platform-card:nth-child(3){animation-delay:.12s;}.platform-card:nth-child(n+4){animation-delay:.18s;}.hist-days>.hist-day{animation:mtFadeUp .45s var(--mt-ease) backwards;}.hist-days>.hist-day:nth-child(2){animation-delay:.05s;}.hist-days>.hist-day:nth-child(3){animation-delay:.1s;}.hist-days>.hist-day:nth-child(n+4){animation-delay:.15s;}.item.clickable{transition:transform var(--mt-t-base) var(--mt-ease),border-color var(--mt-t-base),box-shadow var(--mt-t-base),background var(--mt-t-base);}.item.clickable:hover{transform:translateY(-3px);}.item.clickable:active{transform:scale(.985);transition-duration:var(--mt-t-fast);}.item:hover .poster img{transform:scale(1.045);}.platform-card{transition:transform var(--mt-t-base) var(--mt-ease),border-color var(--mt-t-base),box-shadow var(--mt-t-base);}.platform-card:hover{transform:translateY(-2px);}.platform-card:active{transform:scale(.985);transition-duration:var(--mt-t-fast);}.poster-play{transition:opacity var(--mt-t-base) var(--mt-ease),transform var(--mt-t-base) var(--mt-spring),background var(--mt-t-fast),box-shadow var(--mt-t-base);}.btn-primary,.btn-ghost,.btn-action{transition:transform var(--mt-t-fast) var(--mt-ease),background var(--mt-t-fast),border-color var(--mt-t-fast),color var(--mt-t-fast),box-shadow var(--mt-t-base),opacity var(--mt-t-fast);}.btn-primary:active,.btn-ghost:active,.btn-action:active{transform:scale(.96);}.btn-primary:hover{box-shadow:0 8px 26px rgba(139,92,246,.32);}.tab.active{animation:none;}.douban-filter-tab,.theater-filter-tab,.cw-act-btn,.wl-remove,.wl-drop,.wl-watched,.wl-unwatch,.cal-open-btn,.cal-drop-btn{transition:transform var(--mt-t-fast) var(--mt-ease),background var(--mt-t-fast),border-color var(--mt-t-fast),color var(--mt-t-fast),opacity var(--mt-t-fast);}.douban-filter-tab:active,.theater-filter-tab:active,.cw-act-btn:active,.wl-remove:active,.wl-drop:active,.wl-watched:active,.wl-unwatch:active,.cal-open-btn:active,.cal-drop-btn:active{transform:scale(.94);}.hero-avatar:hover{transform:scale(1.04);}.hero-avatar img{transition:transform .5s var(--mt-ease);}.hero-avatar:hover img{transform:scale(1.07);}.search-input{transition:border-color var(--mt-t-base),box-shadow var(--mt-t-base),background var(--mt-t-base);}.modal.open .modal-backdrop{animation:mtBackdropIn .24s var(--mt-ease);}.modal.open .modal-shell{animation:mtShellIn .34s var(--mt-spring);}.list-modal.open .list-modal-backdrop{animation:mtBackdropIn .22s var(--mt-ease);}.list-modal.open .list-modal-panel{animation:mtPanelIn .3s var(--mt-spring);}.summary-modal.open .summary-backdrop{animation:mtBackdropIn .22s var(--mt-ease);}.summary-modal.open .summary-panel{animation:mtPanelIn .3s var(--mt-spring);}.person-modal.open .person-backdrop{animation:mtBackdropIn .22s var(--mt-ease);}.person-modal.open .person-panel{animation:mtPanelIn .3s var(--mt-spring);}.confirm-modal.open .confirm-backdrop{animation:mtBackdropIn .18s var(--mt-ease);}.confirm-modal.open .confirm-panel{animation:mtPanelIn .28s var(--mt-spring);}.show-cal-modal.open .show-cal-backdrop{animation:mtBackdropIn .2s var(--mt-ease);}.show-cal-modal.open .show-cal-panel{animation:mtPanelIn .28s var(--mt-spring);}.cw-sheet.open .cw-sheet-backdrop{animation:mtBackdropIn .18s var(--mt-ease);}.cw-sheet.open .cw-sheet-panel{animation:mtSheetIn .26s var(--mt-spring);}@media (max-width:599px){.list-modal.open .list-modal-panel,.summary-modal.open .summary-panel,.person-modal.open .person-panel{animation:mtSheetIn .3s var(--mt-spring);}.list-modal.closing .list-modal-panel,.summary-modal.closing .summary-panel,.person-modal.closing .person-panel{animation:mtSheetOut .16s var(--mt-ease) forwards;}}.modal.closing,.list-modal.closing,.summary-modal.closing,.person-modal.closing,.confirm-modal.closing,.show-cal-modal.closing,.cw-sheet.closing{display:block;}.modal.closing .modal-backdrop,.list-modal.closing .list-modal-backdrop,.summary-modal.closing .summary-backdrop,.person-modal.closing .person-backdrop,.confirm-modal.closing .confirm-backdrop,.show-cal-modal.closing .show-cal-backdrop,.cw-sheet.closing .cw-sheet-backdrop{animation:mtBackdropOut .16s var(--mt-ease) forwards;}.modal.closing .modal-shell{animation:mtShellOut .17s var(--mt-ease) forwards;}.list-modal.closing .list-modal-panel,.summary-modal.closing .summary-panel,.person-modal.closing .person-panel,.confirm-modal.closing .confirm-panel,.show-cal-modal.closing .show-cal-panel{animation:mtPanelOut .16s var(--mt-ease) forwards;}.cw-sheet.closing .cw-sheet-panel{animation:mtSheetOut .16s var(--mt-ease) forwards;}.modal-close,.list-modal-close,.person-close,.show-cal-close,.summary-close{transition:transform var(--mt-t-base) var(--mt-spring),background var(--mt-t-fast),color var(--mt-t-fast);}.modal-close:hover,.list-modal-close:hover,.person-close:hover,.show-cal-close:hover,.summary-close:hover{transform:rotate(90deg) scale(1.06);}.modal-close:active,.list-modal-close:active,.person-close:active,.show-cal-close:active,.summary-close:active{transform:rotate(90deg) scale(.92);}.modal.open .modal-body .detail-hero{animation:mtFadeIn .34s var(--mt-ease) .06s backwards;}.list-modal.open .list-modal-body>*:nth-child(1),.summary-modal.open .summary-body>*:nth-child(1){animation:mtFadeUp .38s var(--mt-ease) .08s backwards;}.list-modal.open .list-modal-body>*:nth-child(2),.summary-modal.open .summary-body>*:nth-child(2){animation:mtFadeUp .38s var(--mt-ease) .13s backwards;}.list-modal.open .list-modal-body>*:nth-child(n+3),.summary-modal.open .summary-body>*:nth-child(n+3){animation:mtFadeUp .38s var(--mt-ease) .18s backwards;}.modal-body .detail-hero{animation:mtFadeIn .3s var(--mt-ease);}.modal-body .detail-body>*{animation:mtFadeUp .42s var(--mt-ease) backwards;}.modal-body .detail-body>*:nth-child(2){animation-delay:.05s;}.modal-body .detail-body>*:nth-child(3){animation-delay:.1s;}.modal-body .detail-body>*:nth-child(4){animation-delay:.15s;}.modal-body .detail-body>*:nth-child(n+5){animation-delay:.2s;}.season-item.open .season-body{animation:mtSeasonIn .26s var(--mt-ease);}.episode{transition:background var(--mt-t-fast);}.episode.clickable:active{transform:scale(.997);}.cw-card:hover .cw-poster img{transform:scale(1.04);}.toast.toast-in .toast-icon{animation:mtPop .42s var(--mt-spring);}.login-card{animation:mtPop .5s var(--mt-spring);}.steps .step:nth-child(1){animation:mtFadeUp .4s var(--mt-ease) backwards;}.steps .step:nth-child(2){animation:mtFadeUp .4s var(--mt-ease) .06s backwards;}.device-flow>.step{animation:mtFadeUp .4s var(--mt-ease) .14s backwards;}.log-row{animation:mtFadeIn .26s var(--mt-ease);}.platform-card-poster-ph{background:linear-gradient(100deg,#c9cdd5 32%,#e9ecf1 50%,#c9cdd5 68%);background-size:230% 100%;animation:mtShimmer 1.6s linear infinite;}*{scrollbar-width:thin;scrollbar-color:var(--scrollbar,rgba(255,255,255,0.12)) transparent;}*::-webkit-scrollbar{width:6px;height:6px;}*::-webkit-scrollbar-track{background:transparent;}*::-webkit-scrollbar-thumb{background:var(--scrollbar,rgba(255,255,255,0.14));border-radius:99px;}*::-webkit-scrollbar-thumb:hover{background:rgba(167,139,250,0.45);}::selection{background:rgba(167,139,250,0.35);color:#fff;}html[data-theme="light"]::selection{background:rgba(139,92,246,0.28);color:#1a1a2e;}:focus-visible{outline:2px solid rgba(167,139,250,0.7);outline-offset:2px;}button:focus:not(:focus-visible),a:focus:not(:focus-visible){outline:none;}.top-sticky::after{content:"";position:absolute;left:8%;right:8%;bottom:0;height:1px;background:linear-gradient(90deg,transparent,rgba(167,139,250,0.35),transparent);pointer-events:none;opacity:0.85;}.hero-name{letter-spacing:-0.3px;}.stat:hover{transform:translateY(-2px);border-color:rgba(167,139,250,0.28);box-shadow:0 10px 28px rgba(0,0,0,0.28),0 0 0 1px rgba(167,139,250,0.08);}html[data-theme="light"] .stat:hover{box-shadow:0 8px 20px rgba(0,0,0,0.06),0 0 0 1px rgba(139,92,246,0.12);}.stat:hover .stat-icon{transform:scale(1.06);}@media (min-width:900px){.tabs{left:0;right:auto;top:0;bottom:0;flex-direction:column;justify-content:flex-start;align-items:stretch;border-top:none;}.tab{flex:0 0 auto;gap:6px;}.tab.active{background:transparent;box-shadow:none;}.container{padding-right:28px;padding-bottom:40px;max-width:1200px;margin-left:0;margin-right:auto;}.top-sticky{margin-left:0;margin-right:0;}}@media (min-width:1200px){.container{padding-right:36px;max-width:1320px;}}.tabs{gap:2px;}.tab{position:relative;}.tab.active{box-shadow:none;}.home-section-title::before,.d-section-title::before,.trending-head::before,.sum-h3::before,.person-credits-title::before{box-shadow:0 0 10px rgba(167,139,250,0.45);}.home-section-title::before{background:linear-gradient(180deg,#c4b5fd,#7c3aed);}.h-scroll .item .poster,.grid .item .poster{box-shadow:0 4px 16px rgba(0,0,0,0.45),inset 0 0 0 1px rgba(255,255,255,0.06);}html[data-theme="light"] .h-scroll .item .poster,html[data-theme="light"] .grid .item .poster{box-shadow:0 4px 14px rgba(0,0,0,0.08),inset 0 0 0 1px rgba(0,0,0,0.04);}.poster img{transition:transform .55s var(--mt-ease),filter .35s ease;}.item:hover .poster img{filter:brightness(1.04) saturate(1.06);}.bar-fill,.cw-bar-fill{position:relative;overflow:hidden;}.bar-fill::after,.cw-bar-fill::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.35),transparent);transform:translateX(-100%);}@keyframes mtBarShine{0%,60%{transform:translateX(-100%)}100%{transform:translateX(120%)}}.platform-card::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(135deg,rgba(255,255,255,0.08) 0%,transparent 42%,transparent 100%);opacity:0.9;}.platform-card:hover{box-shadow:0 16px 36px var(--platform-shadow-hover,rgba(0,0,0,0.55)),0 0 0 1px rgba(167,139,250,0.2),inset 0 1px 0 var(--hover-bg-strong,rgba(255,255,255,0.08));}.empty{position:relative;}.empty p{opacity:0.9;}.empty::before{content:none;display:none;}.spinner{border-color:rgba(167,139,250,0.12);border-top-color:#a78bfa;box-shadow:0 0 12px rgba(167,139,250,0.2);}.pane-loading{min-height:80px;display:flex;align-items:center;justify-content:center;}.btn-action:hover{box-shadow:0 4px 16px rgba(167,139,250,0.16);}.btn-primary{position:relative;overflow:hidden;}.btn-primary::after{content:"";position:absolute;inset:0;background:linear-gradient(120deg,transparent 30%,rgba(255,255,255,0.18) 50%,transparent 70%);transform:translateX(-120%);transition:transform .5s ease;}.btn-primary:hover::after{transform:translateX(120%);}.search-input:focus{border-color:rgba(124,58,237,0.5);box-shadow:0 0 0 2px rgba(124,58,237,0.16);}.d-action-bar{transition:box-shadow var(--mt-t-base),border-color var(--mt-t-base);}.d-action-bar:hover{border-color:rgba(167,139,250,0.28);box-shadow:var(--pill-shadow),0 0 0 1px rgba(167,139,250,0.1);}.sc-day.sc-has{transition:transform var(--mt-t-fast) var(--mt-ease),background var(--mt-t-fast),border-color var(--mt-t-fast);}.sc-day.sc-has:active{transform:scale(0.92);}.app-version{letter-spacing:0.4px;transition:opacity 0.2s;}.app-version:hover{opacity:1;}.updated-at{position:relative;padding-left:10px;}.updated-at:not(:empty)::before{content:"";position:absolute;left:0;top:50%;width:5px;height:5px;margin-top:-2.5px;border-radius:50%;background:#4ade80;box-shadow:0 0 0 0 rgba(74,222,128,0.45);animation:mtLiveDot 2.2s ease-out infinite;}@keyframes mtLiveDot{0%{box-shadow:0 0 0 0 rgba(74,222,128,0.5)}70%{box-shadow:0 0 0 6px rgba(74,222,128,0)}100%{box-shadow:0 0 0 0 rgba(74,222,128,0)}}.cw-poster{transition:box-shadow var(--mt-t-base) var(--mt-ease),transform var(--mt-t-base);}.cw-card:hover .cw-poster{box-shadow:0 10px 28px rgba(0,0,0,0.55),0 0 0 1px rgba(167,139,250,0.2);}.cw-poster img{transition:transform .5s var(--mt-ease);}.code-box{letter-spacing:0.12em;}.list-modal-head,.summary-head,.person-panel-head{position:relative;}.list-modal-head::after,.summary-head::after,.person-panel-head::after{content:"";position:absolute;left:12%;right:12%;bottom:0;height:1px;background:linear-gradient(90deg,transparent,rgba(167,139,250,0.25),transparent);pointer-events:none;}.tab-pill{position:absolute;top:0;left:0;width:0;height:0;border-radius:14px;background:var(--brand-grad,linear-gradient(135deg,#7c3aed,#a78bfa));box-shadow:0 6px 18px var(--accent-glow,rgba(167,139,250,.28));transition:transform .36s var(--mt-spring,cubic-bezier(.34,1.3,.58,1)),width .36s var(--mt-spring,cubic-bezier(.34,1.3,.58,1)),opacity .2s ease;opacity:0;pointer-events:none;z-index:0;}.tab-pill.is-ready{opacity:1;}.tab{position:relative;z-index:1;background:transparent;}.tab.active{background:transparent;color:var(--tab-active-fg,#fff);}.tab.active svg{transform:translateY(-1px);opacity:1;stroke-width:2.4;}.tab.active span{font-weight:700;}.tab svg{transition:transform .28s var(--mt-spring,cubic-bezier(.34,1.3,.58,1)),opacity .2s ease,stroke-width .2s ease;}.tab span{transition:font-weight .2s ease,opacity .2s ease;}@keyframes mtPaneOutLeft{from{opacity:1;transform:translateX(0)}to{opacity:0;transform:translateX(-8px)}}@keyframes mtPaneOutRight{to{opacity:0;transform:translateX(8px)}}.pane.active.pane-out-left{animation:mtPaneOutLeft .08s ease-in both;}.pane.active.pane-out-right{animation:mtPaneOutRight .08s ease-in both;}@keyframes mtPaneInLeft{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:translateX(0)}}@keyframes mtPaneInRight{from{opacity:0;transform:translateX(-12px)}}@keyframes mtPaneInFade{}.pane.active.pane-in-left{animation:mtPaneInLeft .18s ease-out both;}.pane.active.pane-in-right{animation:mtPaneInRight .18s ease-out both;}.pane.active.pane-in-fade{animation:mtPaneInFade .16s ease-out both;}@media (prefers-reduced-motion:reduce){.tab-pill{transition:none;}.pane.active.pane-out-left,.pane.active.pane-out-right,.pane.active.pane-in-left,.pane.active.pane-in-right,.pane.active.pane-in-fade{animation:none;}}@keyframes mtTabTap{0%{transform:scale(1)}40%{transform:scale(.94)}}.tab.tab-tap{animation:mtTabTap .28s var(--mt-spring,cubic-bezier(.34,1.3,.58,1));}.tab.active.tab-tap{animation:mtTabTap .28s var(--mt-spring,cubic-bezier(.34,1.3,.58,1)),mtTabPill .32s var(--mt-ease,cubic-bezier(.22,.68,.32,1));}html{transition:background-color .35s ease,color .25s ease;}body{transition:background-color .35s ease,color .25s ease;}body::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;background:radial-gradient(ellipse 80% 50% at 50% -10%,rgba(124,58,237,0.14),transparent 55%),radial-gradient(ellipse 60% 40% at 100% 20%,rgba(56,97,190,0.08),transparent 50%),radial-gradient(ellipse 50% 35% at 0% 80%,rgba(167,139,250,0.06),transparent 45%);opacity:1;}html[data-theme="light"] body::before{background:radial-gradient(ellipse 80% 50% at 50% -8%,rgba(139,92,246,0.1),transparent 55%),radial-gradient(ellipse 55% 40% at 100% 30%,rgba(99,102,241,0.06),transparent 50%),radial-gradient(ellipse 50% 35% at 0% 85%,rgba(167,139,250,0.05),transparent 45%);}.container{position:relative;z-index:1;}.modal{z-index:220;}.list-modal,.summary-modal,.cw-sheet{z-index:230;}.show-cal-modal{z-index:240;}.person-modal{z-index:250;}.confirm-modal{z-index:260;}#toast-container{z-index:99999;}.hero-name{background:var(--name-grad);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;filter:drop-shadow(0 2px 12px rgba(167,139,250,0.15));}.hero-avatar{transition:transform var(--mt-t-base) var(--mt-spring),box-shadow var(--mt-t-base) var(--mt-ease);}.hero-avatar:hover{box-shadow:0 0 0 3px rgba(167,139,250,0.55),0 10px 28px rgba(124,58,237,0.35);}@keyframes mtNumPulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.08)}}.stat:nth-child(2) .stat-num{animation-delay:.4s;}.stat:nth-child(3) .stat-num{animation-delay:.8s;}.stat:nth-child(4) .stat-num{animation-delay:1.2s;}@keyframes mtPosterShine{0%{transform:translateX(-120%) skewX(-12deg)}100%{transform:translateX(220%) skewX(-12deg)}}.poster,.cw-poster{position:relative;overflow:hidden;}.poster::after,.cw-poster::after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 40%,rgba(255,255,255,0.14) 50%,transparent 60%);transform:translateX(-120%) skewX(-12deg);pointer-events:none;opacity:0;z-index:2;}.item:hover .poster::after,.cw-card:hover .cw-poster::after{opacity:1;animation:mtPosterShine .7s ease;}.item:hover .poster,.cw-card:hover .cw-poster{transform:translateY(-3px) scale(1.02);box-shadow:0 14px 36px rgba(0,0,0,0.55),0 0 0 1px rgba(167,139,250,0.22);}html[data-theme="light"] .item:hover .poster,html[data-theme="light"] .cw-card:hover .cw-poster{box-shadow:0 12px 28px rgba(0,0,0,0.12),0 0 0 1px rgba(139,92,246,0.2);}.poster,.cw-poster{transition:transform var(--mt-t-base) var(--mt-ease),box-shadow var(--mt-t-base) var(--mt-ease);}.bar-fill,.cw-bar-fill{box-shadow:0 0 8px rgba(167,139,250,0.55);}@keyframes mtBadgeIn{from{opacity:0;transform:translateY(6px) scale(.92)}}.detail-ext-ratings .ext-rating{animation:mtBadgeIn .38s var(--mt-spring) backwards;}.detail-ext-ratings .ext-rating:nth-child(2){animation-delay:.05s;}.detail-ext-ratings .ext-rating:nth-child(3){animation-delay:.1s;}.detail-ext-ratings .ext-rating:nth-child(4){animation-delay:.15s;}.detail-ext-ratings .ext-rating:nth-child(5){animation-delay:.2s;}.detail-ext-ratings .ext-rating:nth-child(n+6){animation-delay:.25s;}.ext-rating{transition:transform var(--mt-t-fast) var(--mt-spring),box-shadow var(--mt-t-base),filter var(--mt-t-fast);}.ext-rating:hover{transform:translateY(-2px) scale(1.04);filter:brightness(1.08);}@keyframes mtBarGlow{0%,100%{box-shadow:0 0 8px rgba(167,139,250,0.35);opacity:1}50%{box-shadow:0 0 14px rgba(167,139,250,0.7);opacity:.9}}.home-section-title::before,.d-section-title::before,.trending-head::before,.sum-h3::before,.person-credits-title::before{animation:mtBarGlow 2.8s ease-in-out infinite;}.platform-card{position:relative;isolation:isolate;}.platform-card:hover{border-color:rgba(167,139,250,0.35);}@keyframes mtBtnGlow{0%,100%{box-shadow:0 6px 22px rgba(139,92,246,0.28)}50%{box-shadow:0 8px 28px rgba(139,92,246,0.42)}}.btn-primary{animation:mtBtnGlow 3.2s ease-in-out infinite;}.d-act{transition:transform var(--mt-t-fast) var(--mt-spring),background var(--mt-t-fast),color var(--mt-t-fast),box-shadow var(--mt-t-base);}.d-act:hover{box-shadow:0 0 0 4px rgba(167,139,250,0.12);}.d-act-watched.active{animation:mtPop .45s var(--mt-spring);}.toast.toast-in{animation:mtPop .4s var(--mt-spring);}@keyframes mtShimmerStrong{0%{background-position:140% 0}100%{background-position:-140% 0}}.sk{position:relative;overflow:hidden;border-radius:8px;background:var(--sk-base,rgba(255,255,255,.055));}.sk::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 20%,var(--sk-hi,rgba(167,139,250,.14)) 50%,transparent 80%);background-size:240% 100%;animation:mtSkSweep 1.5s linear infinite;}@keyframes mtSkSweep{}.sk-poster{border-radius:12px;aspect-ratio:2/3;}.sk-line{height:11px;border-radius:6px;}.sk-line.w40{width:40%;}.sk-line.w60{width:60%;}.sk-line.w80{width:80%;}.sk-pill{height:22px;width:64px;border-radius:11px;}.sk-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}.sk-card{display:flex;flex-direction:column;gap:8px;}.sk-card .sk-line+.sk-line{margin-top:6px;}.sk-detail{display:flex;flex-direction:column;gap:14px;padding:4px 0;}.sk-detail-hero{height:180px;border-radius:14px;}.sk-detail-row{display:flex;gap:12px;align-items:flex-start;}.sk-detail-poster{width:96px;flex:0 0 96px;border-radius:12px;aspect-ratio:2/3;}.sk-detail-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:9px;padding-top:4px;}.sk-sum{display:flex;flex-direction:column;gap:14px;padding:2px 0 6px;}.sk-sum-nav{display:flex;justify-content:center;padding:2px 0;}.sk-sum-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}.sk-sum-stat{display:flex;flex-direction:column;align-items:center;gap:8px;padding:13px 6px;border-radius:12px;background:var(--surface-2,rgba(255,255,255,.03));}.sk-sum-block{display:flex;flex-direction:column;gap:10px;}.sk-sum-heat{height:46px;border-radius:10px;}.sk-sum-row{display:flex;align-items:center;gap:10px;}.sk-sum-rank{width:18px;height:18px;flex:0 0 18px;border-radius:6px;}.sk-sum-row-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:7px;}.sum-loading{display:flex;align-items:center;gap:8px;margin:0 0 12px;padding:7px 12px;border-radius:10px;font-size:.76rem;color:var(--text-mute,#71717a);background:var(--surface-2,rgba(255,255,255,.04));border:1px solid var(--border,rgba(255,255,255,.07));}.sum-loading::before{content:"";width:12px;height:12px;flex:0 0 12px;border-radius:50%;border:2px solid var(--border-strong,rgba(255,255,255,.22));border-top-color:var(--accent,#a78bfa);animation:spin .7s linear infinite;}.loading-note{margin-top:12px;font-size:.78rem;color:var(--text-mute,#71717a);letter-spacing:.02em;}.loading-note::after{content:"";display:inline-block;width:0;overflow:hidden;animation:mtLoadingDots 1.3s steps(4,end) infinite;}@keyframes mtLoadingDots{}@supports ((-webkit-mask:radial-gradient(#000,#000)) or (mask:radial-gradient(#000,#000))){.spinner{border:0;background:conic-gradient(from 0deg,rgba(167,139,250,0) 0deg,rgba(167,139,250,.15) 60deg,#a78bfa 300deg,#c4b5fd 355deg,rgba(196,181,253,0) 360deg);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 3px),#000 calc(100% - 2.5px));mask:radial-gradient(farthest-side,transparent calc(100% - 3px),#000 calc(100% - 2.5px));animation:spin .85s linear infinite;box-shadow:none}}.pane-loading.has-sk .spinner,.modal-loading.has-sk .spinner{display:none;}.modal-loading,.pane-loading{text-align:center;}.modal-loading:not(.has-sk),.pane-loading:not(.has-sk){display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;}@media (prefers-reduced-motion:reduce){.sk::after{animation:none;}.loading-note::after{animation:none;content:"...";}.spinner{animation-duration:1.6s;}}.poster-ph,.cw-poster .poster-ph,.platform-card-poster-ph,.pane-loading .spinner{background-image:linear-gradient(100deg,rgba(255,255,255,0.03) 30%,rgba(167,139,250,0.12) 50%,rgba(255,255,255,0.03) 70%);background-size:220% 100%;}.poster-ph,.cw-poster .poster-ph,.platform-card-poster-ph{animation:mtShimmerStrong 1.5s linear infinite;}.season-item{transition:border-color var(--mt-t-base),box-shadow var(--mt-t-base);}.episode.clickable{position:relative;}.episode.clickable::before{content:"";position:absolute;left:0;top:12%;bottom:12%;width:2px;border-radius:2px;background:transparent;transition:background var(--mt-t-fast),box-shadow var(--mt-t-fast);}.episode.clickable:hover::before{background:linear-gradient(180deg,#a78bfa,#7c3aed);box-shadow:0 0 8px rgba(167,139,250,0.5);}.code-box{animation:mtCodeGlow 2.4s var(--mt-ease) infinite;}.load-more{transition:transform var(--mt-t-fast) var(--mt-ease),border-color var(--mt-t-base),box-shadow var(--mt-t-base),color var(--mt-t-base),background var(--mt-t-base);}.load-more:hover:not(:disabled){transform:translateY(-1px);}.load-more:active:not(:disabled){transform:scale(.97);}.empty{animation:mtFadeUp .5s var(--mt-ease);}@keyframes mtLiveDot{0%{box-shadow:0 0 0 0 rgba(74,222,128,0.55)}70%{box-shadow:0 0 0 7px rgba(74,222,128,0)}}.cw-info{transition:opacity var(--mt-t-base);}.cw-card:hover .cw-title{color:var(--accent-2);}.grid .item:hover .name{color:var(--accent-2);}.search-input:focus{box-shadow:0 0 0 2px rgba(124,58,237,0.16);}@keyframes mtCalPulse{0%,100%{box-shadow:0 0 0 0 rgba(125,157,212,0.45)}50%{box-shadow:0 0 0 6px rgba(125,157,212,0)}}.sc-day.sc-today-day{animation:mtCalPulse 2.4s ease-out infinite;}@keyframes mtSplashFloat{0%,100%{transform:translateY(0);opacity:.6}50%{transform:translateY(-6px);opacity:1}}html[data-theme="light"] .season-item{background:#fff;border-color:rgba(0,0,0,0.1);box-shadow:0 1px 3px rgba(0,0,0,0.04);}html[data-theme="light"] .season-item.open{border-color:rgba(124,58,237,0.35);box-shadow:0 4px 16px rgba(124,58,237,0.08),0 1px 3px rgba(0,0,0,0.04);}html[data-theme="light"] .season-head:hover{background:#f4f4f5;}html[data-theme="light"] .season-title{color:#18181b;}html[data-theme="light"] .season-meta,html[data-theme="light"] .chev{color:#52525b;}html[data-theme="light"] .season-body{background:#f4f4f5;border-top-color:rgba(0,0,0,0.08);}html[data-theme="light"] .episode{border-bottom-color:rgba(0,0,0,0.07);background:transparent;}html[data-theme="light"] .episode.clickable:hover{background:#ebebed;}html[data-theme="light"] .episode.clickable:active{background:#e4e4e7;}html[data-theme="light"] .ep-num{color:#3f3f46;}html[data-theme="light"] .ep-title{color:#18181b;}html[data-theme="light"] .episode.watched .ep-title{color:#71717a;}html[data-theme="light"] .episode.clickable:hover .ep-title,html[data-theme="light"] .episode.watched.clickable:hover .ep-title{color:#6d28d9;}html[data-theme="light"] .ep-meta,html[data-theme="light"] .ep-overview{color:#3f3f46;}html[data-theme="light"] .ep-vote{background:rgba(124,58,237,0.12);color:#5b21b6;border:1px solid rgba(124,58,237,0.22);}html[data-theme="light"] .ep-still-wrap{background:#e4e4e7;box-shadow:0 1px 4px rgba(0,0,0,0.06);}html[data-theme="light"] .ep-still-ph{color:#71717a;background:linear-gradient(135deg,#f4f4f5,#e4e4e7);}html[data-theme="light"] .ep-still-badge{background:#059669;color:#fff;}html[data-theme="light"] .ep-play-btn{background:rgba(124,58,237,0.1);border-color:rgba(124,58,237,0.35);color:#6d28d9;}html[data-theme="light"] .ep-play-btn:hover{background:rgba(124,58,237,0.18);color:#5b21b6;}html[data-theme="light"] .ep-status.watched{color:#047857;}html[data-theme="light"] .ep-status.unwatched,html[data-theme="light"] button.ep-status.unwatched{color:#52525b;}html[data-theme="light"] button.ep-status.unwatched:hover{color:#6d28d9;}html[data-theme="light"] .ep-empty{color:#52525b;}html[data-theme="light"] .detail-overview,html[data-theme="light"] .detail-genres,html[data-theme="light"] .detail-meta,html[data-theme="light"] .detail-tagline{color:#3f3f46;}html[data-theme="light"] .detail-title{color:#18181b;}html[data-theme="light"] .d-status{background:#f7f7f8;border-color:rgba(0,0,0,0.1);}html[data-theme="light"] .d-status-title{color:#18181b;}html[data-theme="light"] .d-status-sub{color:#52525b;}html[data-theme="light"] .d-section-title{color:#18181b;}html[data-theme="light"] .cast-name{color:#18181b;}html[data-theme="light"] .cast-role{color:#52525b;}.cw-foot{position:absolute;left:0;right:0;bottom:0;z-index:3;display:flex;align-items:center;justify-content:space-between;gap:8px;background:linear-gradient(180deg,transparent,rgba(0,0,0,0.72) 55%,rgba(0,0,0,0.88));pointer-events:none;}.cw-foot-left{flex-shrink:0;font-size:0.68rem;font-weight:700;color:#fff;background:rgba(0,0,0,0.55);border:1px solid rgba(255,255,255,0.12);padding:2px 7px;border-radius:6px;line-height:1.3;}.cw-foot-right{flex:1;min-width:0;text-align:right;font-size:0.68rem;font-weight:600;color:rgba(255,255,255,0.92);text-shadow:0 1px 3px rgba(0,0,0,0.65);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.cw-foot-right.is-new{flex:0 0 auto;background:linear-gradient(135deg,#ef4444,#f97316);color:#fff;padding:2px 8px;border-radius:6px;font-weight:800;letter-spacing:0.5px;text-shadow:none;}.cw-watching{font-size:0.72rem;font-weight:500;line-height:1.35;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}html[data-theme="light"] .cw-watching{color:#3f3f46;}:root{--glass-bg:rgba(24,24,30,0.94);--glass-bg-strong:rgba(255,255,255,0.14);--glass-bg-soft:rgba(255,255,255,0.06);--glass-border:rgba(255,255,255,0.25);--glass-border-soft:rgba(255,255,255,0.12);--glass-highlight:rgba(255,255,255,0.4);--glass-shadow:0 8px 32px rgba(0,0,0,0.25),inset 0 1px 0 rgba(255,255,255,0.2);--glass-shadow-sm:0 4px 16px rgba(0,0,0,0.15),inset 0 1px 0 rgba(255,255,255,0.12);--glass-blur:blur(12px) saturate(165%);--glass-radius:24px;--glass-radius-sm:18px;--dock-bg:rgba(15,15,21,0.95);--sheet-glass:rgba(25,25,32,0.97);--card-glass:rgba(255,255,255,0.08);}html[data-theme="light"]{--glass-bg:rgba(255,255,255,0.94);--glass-bg-strong:rgba(255,255,255,0.75);--glass-bg-soft:rgba(255,255,255,0.45);--glass-border:rgba(255,255,255,0.85);--glass-border-soft:rgba(0,0,0,0.08);--glass-highlight:rgba(255,255,255,1);--glass-shadow:0 12px 40px rgba(0,0,0,0.1),inset 0 1px 0 rgba(255,255,255,1),inset 0 -1px 0 rgba(0,0,0,0.05);--glass-shadow-sm:0 6px 20px rgba(0,0,0,0.08),inset 0 1px 0 rgba(255,255,255,0.9);--glass-blur:blur(12px) saturate(165%);--dock-bg:rgba(255,255,255,0.92);--sheet-glass:rgba(255,255,255,0.96);--card-glass:rgba(255,255,255,0.55);}body{background:radial-gradient(ellipse 90% 55% at 50% -15%,rgba(124,58,237,0.16),transparent 58%),radial-gradient(ellipse 55% 40% at 100% 10%,rgba(56,97,190,0.1),transparent 50%),radial-gradient(ellipse 50% 35% at 0% 70%,rgba(167,139,250,0.07),transparent 48%),var(--bg-solid);background-attachment:fixed;}html[data-theme="light"] body{background:radial-gradient(ellipse 90% 55% at 50% -12%,rgba(139,92,246,0.12),transparent 58%),radial-gradient(ellipse 55% 40% at 100% 15%,rgba(99,102,241,0.07),transparent 50%),radial-gradient(ellipse 50% 35% at 0% 80%,rgba(167,139,250,0.06),transparent 48%),var(--bg-solid);}.top-sticky{background:var(--glass-bg);}.tabs{left:10px;right:10px;bottom:calc(8px + env(safe-area-inset-bottom,0px));width:auto;padding:6px;border-radius:22px;}html[data-theme="light"] .tabs{box-shadow:0 10px 28px rgba(0,0,0,0.1),0 1px 0 rgba(255,255,255,0.9) inset;}.container{padding-bottom:calc(86px + env(safe-area-inset-bottom,0px));}@media (min-width:900px){.tabs{left:0;right:auto;top:0;bottom:0;border-radius:0 20px 20px 0;border:none;border-right:1px solid var(--glass-border-soft);box-shadow:10px 0 32px rgba(0,0,0,0.25);}.container{padding-right:28px;padding-bottom:40px;}}@media (min-width:1200px){.container{padding-right:36px;}}.search-input,input.search-input{background:var(--glass-bg-soft);border-radius:14px;box-shadow:0 1px 0 var(--glass-highlight) inset;transition:border-color .2s ease,box-shadow .2s ease;}.search-input:focus,input.search-input:focus{outline:none;}.search-bar,.search-row,#search-pane .search-bar{overflow:visible;padding:2px;margin-left:-2px;margin-right:-2px;}html[data-theme="light"] .search-input:focus,
html[data-theme="light"] input.search-input:focus{border-color:rgba(109,40,217,0.55);box-shadow:0 0 0 2px rgba(109,40,217,0.14);background:rgba(255,255,255,0.98);}.cw-card,.item,.platform-card,.stat{background:var(--card-glass);border:1px solid var(--glass-border-soft);border-radius:var(--glass-radius-sm);box-shadow:var(--glass-shadow-sm);transition:transform .22s cubic-bezier(.22,.68,.32,1),box-shadow .22s ease,border-color .2s ease;}.cw-card:hover,.item:hover,.platform-card:hover{border-color:var(--glass-border);box-shadow:var(--glass-shadow);transform:translateY(-2px);}.poster,.cw-poster{border-radius:14px;overflow:hidden;}.btn-action{background:var(--glass-bg-soft);border:1px solid var(--glass-border-soft);border-radius:12px;box-shadow:0 1px 0 var(--glass-highlight) inset;transition:transform .15s ease,background .15s ease;}.btn-action:active{transform:scale(.96);}.hero-avatar{box-shadow:0 0 0 2px rgba(167,139,250,0.35),0 8px 22px rgba(124,58,237,0.22);}.modal-shell,.list-modal-panel,.summary-panel,.person-panel,.confirm-panel,.show-cal-panel{background:var(--sheet-glass);border:1px solid var(--glass-border);border-radius:var(--glass-radius);box-shadow:0 28px 80px rgba(0,0,0,0.5),0 1px 0 var(--glass-highlight) inset;}.login-card{background:var(--sheet-glass);border:1px solid var(--glass-border);border-radius:26px;box-shadow:var(--glass-shadow);}.btn-primary,button.btn-primary{border:1px solid rgba(255,255,255,0.16);}.chip,.d-act,.ext-rating{background:var(--glass-bg-soft);border:1px solid var(--glass-border-soft);box-shadow:0 1px 0 rgba(255,255,255,0.06) inset;}.toast{background:var(--toast-bg);color:var(--toast-text);}html[data-theme="light"] .toast{background:rgba(24,24,27,.94);color:#fff;border-color:rgba(0,0,0,.08);box-shadow:0 12px 28px rgba(0,0,0,.16);}.season-item{background:var(--card-glass);border:1px solid var(--glass-border-soft);border-radius:14px;}.season-item.open{border-color:rgba(167,139,250,0.32);box-shadow:0 8px 24px rgba(124,58,237,0.1);}.load-more{background:var(--glass-bg-soft);border:1px solid var(--glass-border-soft);border-radius:14px;}.code-box{background:var(--glass-bg);border:1px solid var(--glass-border);border-radius:16px;}html[data-theme="light"] .cw-card,html[data-theme="light"] .item,html[data-theme="light"] .platform-card,html[data-theme="light"] .stat{background:var(--card-glass);}html[data-theme="light"]{--text:#18181b;--text-dim:#3f3f46;--text-mute:#52525b;--border:rgba(0,0,0,.1);--border-strong:rgba(0,0,0,.16);--toast-bg:rgba(24,24,27,.94);--toast-text:#fff;}html[data-theme="light"] .name,html[data-theme="light"] .cw-title{color:#18181b;}html[data-theme="light"] .meta,html[data-theme="light"] .overview,html[data-theme="light"] .cw-watching,html[data-theme="light"] .updated-at,html[data-theme="light"] .loading-note,html[data-theme="light"] .empty,html[data-theme="light"] .home-section-title,html[data-theme="light"] .d-section-title{color:#3f3f46;}html[data-theme="light"] .meta.dim{color:#52525b;}html[data-theme="light"] .btn-action{color:#18181b;background:rgba(0,0,0,.04);border-color:rgba(0,0,0,.1);}html[data-theme="light"] .search-input,html[data-theme="light"] input.search-input{color:#18181b;background:rgba(0,0,0,.04);border-color:rgba(0,0,0,.12);}html[data-theme="light"] .search-input::placeholder{color:#71717a;}html[data-theme="light"] .tab{color:#3f3f46;}html[data-theme="light"] .tab svg{opacity:1;color:#3f3f46;stroke:#3f3f46;}html[data-theme="light"] .tab span{color:#3f3f46;opacity:1;}html[data-theme="light"] .tab.active,html[data-theme="light"] .tab.active span,html[data-theme="light"] .tab.active svg{color:var(--tab-active-fg,#fff);stroke:var(--tab-active-fg,#fff);opacity:1;}html[data-theme="light"] .load-more{color:#18181b;background:rgba(0,0,0,.04);border-color:rgba(0,0,0,.12);}html[data-theme="light"] .chip,html[data-theme="light"] .d-act{color:#3f3f46;background:rgba(0,0,0,.04);border-color:rgba(0,0,0,.1);}html[data-theme="light"] .cw-card,html[data-theme="light"] .item,html[data-theme="light"] .platform-card,html[data-theme="light"] .stat,html[data-theme="light"] .season-item{background:rgba(255,255,255,.94);border-color:rgba(0,0,0,.08);color:#18181b;}html[data-theme="light"] .detail-overview,html[data-theme="light"] .detail-meta,html[data-theme="light"] .detail-genres,html[data-theme="light"] .person-bio{color:#3f3f46;}html[data-theme="light"] .tabs .tab,html[data-theme="light"] .tabs .tab span{color:#27272a;opacity:1;}html[data-theme="light"] .tabs .tab svg{opacity:1;color:#27272a;stroke:#27272a;}html[data-theme="light"] .tabs .tab.active,html[data-theme="light"] .tabs .tab.active span,html[data-theme="light"] .tabs .tab.active svg{color:var(--tab-active-fg,#fff);stroke:var(--tab-active-fg,#fff);opacity:1;}@media (prefers-reduced-transparency:reduce){.top-sticky,.tabs,.modal-shell,.list-modal-panel,.summary-panel,.person-panel,.confirm-panel,.show-cal-panel,.login-card{background:var(--surface-2);}.modal-shell,.list-modal-panel,.summary-panel,.person-panel,.confirm-panel,.login-card{background:var(--modal-bg,var(--surface));}}@media (max-width:767px){.item:not(.h-scroll .item){padding:14px 16px;}.grid .item{padding:14px 16px;}}@media (min-width:768px){.grid .item .info,.cw-modal-grid .item .info,.list-modal .item .info,.list-modal-panel .item .info{padding:12px 14px 14px;}}.h-scroll .item .info{padding:10px 8px 8px;}.cw-card .cw-info,.cw-info{padding-left:12px;padding-right:12px;}@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms;animation-delay:0ms;animation-iteration-count:1;transition-duration:.01ms;scroll-behavior:auto;}}:root{--r-sm:10px;--r-md:12px;--r-lg:16px;--r-xl:20px;--r-full:999px;--poster-sm:72px;--poster-sm-h:108px;--poster-md:140px;--poster-md-h:210px;--poster-lg:170px;--poster-lg-h:255px;--poster-xl:200px;--poster-xl-h:300px;--poster-card-w:var(--poster-md);--poster-list-w:var(--poster-sm);--poster-list-h:var(--poster-sm-h);--poster-radius:12px;--ease:cubic-bezier(.22,.68,.32,1);--t:220ms;--t-fast:140ms;--lift:translateY(-2px);--press:scale(.97);--line:1px solid rgba(255,255,255,.1);--line-strong:1px solid rgba(255,255,255,.16);--e1:0 1px 2px rgba(0,0,0,.18),0 4px 14px rgba(0,0,0,.12);--e2:0 4px 16px rgba(0,0,0,.22),0 1px 0 rgba(255,255,255,.04) inset;--e3:0 12px 40px rgba(0,0,0,.45),0 1px 0 rgba(255,255,255,.05) inset;--e-poster:0 4px 14px rgba(0,0,0,.35);--e-hover:0 8px 24px rgba(0,0,0,.28),0 0 0 1px rgba(167,139,250,.18);}@media (min-width:768px){:root{--poster-card-w:var(--poster-lg);--poster-list-w:80px;--poster-list-h:120px;}}@media (min-width:1024px){:root{--poster-card-w:180px;--poster-list-w:88px;--poster-list-h:132px;}}@media (min-width:1400px){:root{--poster-card-w:var(--poster-xl);--poster-list-w:96px;--poster-list-h:144px;}}html[data-theme="light"]{--line:1px solid rgba(0,0,0,.08);--line-strong:1px solid rgba(0,0,0,.12);--e1:0 1px 2px rgba(0,0,0,.04),0 4px 12px rgba(0,0,0,.05);--e2:0 4px 16px rgba(0,0,0,.07),0 1px 0 rgba(255,255,255,.8) inset;--e3:0 16px 48px rgba(0,0,0,.14),0 1px 0 rgba(255,255,255,.9) inset;--e-poster:0 3px 12px rgba(0,0,0,.1);--e-hover:0 8px 22px rgba(0,0,0,.1),0 0 0 1px rgba(139,92,246,.16);}.btn-primary,.btn-primary::after,.code-box{animation:none;}.btn-primary::after,.poster::after,.cw-poster::after{display:none;}.home-section-title::before,.d-section-title::before,.sum-h3::before,.person-credits-title::before,.trending-head::before{animation:none;box-shadow:none;}.bar-fill::after,.cw-bar-fill::after{animation:none;}.item,.cw-card,.platform-card,.stat,.season-item,.poster,.cw-poster,
.btn-action,.btn-ghost,.btn-primary,button.btn-primary,.load-more,.chip,
.douban-filter-tab,.theater-filter-tab,.sum-period-btn,.confirm-btn,
.cal-open-btn,.cal-drop-btn,.cw-act-btn,.d-act,.ep-play-btn,
.wl-remove,.wl-drop,.wl-watched,.wl-unwatch,.modal-close,.list-modal-close,
.person-close,.show-cal-close,.summary-close,.tab,.hero-avatar,
.search-input,input.search-input,.trending-head,.trending-chev{transition:transform var(--t) var(--ease),box-shadow var(--t) var(--ease),border-color var(--t) var(--ease),background-color var(--t-fast) var(--ease),color var(--t-fast) var(--ease),opacity var(--t-fast) var(--ease);}@media (hover:hover) and (pointer:fine){.item.clickable:hover,.platform-card:hover,.stat:hover,.cw-card:hover{transform:var(--lift);box-shadow:var(--e-hover);}.item.clickable:hover>.poster,.h-scroll .item:not(.cw-card):hover>.poster,.trending-scroll>.item:hover>.poster,.cw-card:hover .cw-poster{transform:none;}.btn-action:hover,.btn-ghost:hover,.load-more:hover:not(:disabled),.cal-open-btn:hover,.cal-drop-btn:hover,.chip:hover{transform:var(--lift);}.btn-primary:hover,button.btn-primary:hover{transform:var(--lift);filter:brightness(1.05);}}.item.clickable:active,.platform-card:active,.cw-card:active,
.btn-action:active,.btn-ghost:active,.btn-primary:active,button.btn-primary:active,
.load-more:active:not(:disabled),.douban-filter-tab:active,.theater-filter-tab:active,
.sum-period-btn:active,.confirm-btn:active,.cal-open-btn:active,.cal-drop-btn:active,
.cw-act-btn:active,.d-act:active,.tab:active,.hero-avatar:active,
.wl-remove:active,.wl-drop:active,.wl-watched:active,.wl-unwatch:active{transform:var(--press);transition-duration:var(--t-fast);}.item>.poster{width:var(--poster-list-w);height:var(--poster-list-h);max-width:var(--poster-list-w);aspect-ratio:auto;flex-shrink:0;border-radius:var(--poster-radius);overflow:hidden;box-shadow:var(--e-poster);}.item>.poster img{width:100%;height:100%;object-fit:cover;display:block;}@media (min-width:700px){.grid .item>.poster{width:100%;height:auto;max-width:none;aspect-ratio:2/3;}.grid{grid-template-columns:repeat(auto-fill,minmax(var(--poster-card-w),1fr));}}.h-scroll .item:not(.cw-card),.trending-scroll>.item{flex:0 0 auto;width:var(--poster-card-w);max-width:var(--poster-card-w);padding:0;display:flex;flex-direction:column;background:transparent;border:none;box-shadow:none;}.h-scroll .item:not(.cw-card)>.poster,.trending-scroll>.item>.poster{width:100%;height:auto;max-width:none;aspect-ratio:2/3;border-radius:var(--poster-radius);box-shadow:var(--e-poster);}.h-scroll .item:not(.cw-card) .info,.trending-scroll>.item .info{padding:8px 4px 0;}.h-scroll .item:not(.cw-card) .name,.trending-scroll>.item .name{font-size:.8rem;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:normal;}.h-scroll .item:not(.cw-card) .overview,.trending-scroll>.item .overview{display:none;}.h-scroll .item:not(.cw-card) .meta,.trending-scroll>.item .meta{font-size:.7rem;margin-top:2px;}.cw-poster,.detail-poster,.ep-still-wrap,.person-photo,.cast-img{border-radius:var(--poster-radius);overflow:hidden;}.cw-poster{box-shadow:var(--e-poster);}.item,.cw-card,.platform-card,.stat,.season-item,.sum-stat,.sum-row,.sum-lifetime{border-radius:var(--r-lg);border:var(--line);box-shadow:var(--e1);}.btn-action,.btn-ghost,.btn-primary,button.btn-primary,.load-more,.chip,.douban-filter-tab,.theater-filter-tab,.sum-period-btn,.confirm-btn,.cal-open-btn,.cal-drop-btn,.cw-act-btn,.search-input,input.search-input,.code-box{border-radius:var(--r-sm);}.btn-primary,button.btn-primary{box-shadow:0 6px 18px rgba(124,58,237,.28),0 1px 0 rgba(255,255,255,.18) inset;}.btn-action,.btn-ghost,.load-more{border:var(--line);box-shadow:none;}.douban-filter-tab,.theater-filter-tab,.sum-period-btn,.chip{border-radius:var(--r-full);}.modal-close,.list-modal-close,.person-close,.show-cal-close,.summary-close,.d-act,.ep-play-btn,.wl-remove,.wl-drop,.wl-watched,.wl-unwatch,.hero-avatar{border-radius:var(--r-full);}.modal-shell,.list-modal-panel,.summary-panel,.person-panel,.confirm-panel,.show-cal-panel,.cw-sheet-panel,.login-card{border-radius:var(--r-xl);border:var(--line-strong);box-shadow:var(--e3);}@media (max-width:599px){.list-modal-panel,.summary-panel,.person-panel,.show-cal-panel,.cw-sheet-panel,.modal-shell{border-radius:var(--r-xl) var(--r-xl) 0 0;}}.toast{border-radius:var(--r-md);border:var(--line);box-shadow:var(--e2);}.tabs{border-radius:22px;border:var(--line);box-shadow:var(--e2);}.tab-pill{border-radius:14px;}.bar,.cw-bar,.bar-fill,.cw-bar-fill{border-radius:var(--r-full);}.search-input,input.search-input{border:var(--line);}.search-input:focus,input.search-input:focus{border-color:rgba(124,58,237,.45);box-shadow:0 0 0 3px rgba(124,58,237,.14);}@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms;animation-iteration-count:1;transition-duration:.01ms;}}html[data-theme="light"] .item,html[data-theme="light"] .platform-card,html[data-theme="light"] .stat,html[data-theme="light"] .season-item{background:rgba(255,255,255,.92);}html[data-theme="light"] .cal-day-items>.item,html[data-theme="light"] .cal-day-col .item{background:transparent;background-color:transparent;border:none;box-shadow:none;}.cal-week{margin-bottom:28px;}.cal-week-head{display:flex;align-items:baseline;justify-content:space-between;padding:0 2px 12px;font-size:1.05rem;font-weight:700;}.cal-count{font-size:0.78rem;font-weight:500;color:var(--text-dim);}.cal-days-row{display:flex;gap:12px;width:100%;min-width:0;overflow-x:auto;overflow-y:visible;scroll-snap-type:x proximity;scroll-behavior:auto;touch-action:pan-x pan-y;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;padding:4px 2px 10px;align-items:flex-start;}.cal-day-col{display:flex;flex-direction:column;flex:0 0 auto;flex-shrink:0;width:calc(var(--poster-card-w) + 40px);min-width:calc(var(--poster-card-w) + 40px);max-width:none;scroll-snap-align:start;border-radius:20px;background:var(--glass-bg);border:1px solid var(--glass-border-soft);box-shadow:var(--glass-shadow-sm);overflow:visible;align-self:flex-start;content-visibility:visible;}.cal-day-col.is-today{background:linear-gradient(180deg,rgba(167,139,250,.2),rgba(167,139,250,.08));border-color:rgba(167,139,250,.4);box-shadow:0 8px 24px rgba(124,58,237,.15),inset 0 1px 0 rgba(255,255,255,.15);}.cal-day-header{display:flex;flex-direction:column;align-items:center;padding:12px 6px 8px;gap:3px;}.cal-wd{font-size:0.72rem;color:var(--text-dim);font-weight:600;}.cal-num{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:800;color:var(--text);}.cal-day-col.is-past .poster{position:relative;}.cal-day-col.is-past .poster::after{content:'';position:absolute;inset:0;background:rgba(255,255,255,.45);pointer-events:none;border-radius:inherit;}.cal-day-col.is-past .name,.cal-day-col.is-past .meta{opacity:0.6;}.cal-day-items{flex:1;display:flex;flex-direction:column;gap:12px;padding:0 10px 16px;min-height:40px;overflow:visible;}.cal-day-items>.item{flex-direction:column;gap:0;padding:0;width:100%;max-width:none;border-radius:12px;margin:0;background:transparent;border:none;box-shadow:none;overflow:visible;}.cal-day-items>.item:hover{transform:translateY(-2px);}.cal-day-items>.item>.poster{width:100%;max-width:none;min-width:0;height:auto;aspect-ratio:2/3;flex-shrink:0;border-radius:12px;overflow:hidden;position:relative;margin:0;box-shadow:0 8px 20px rgba(0,0,0,.45);}.cal-time-badge{position:absolute;left:8px;bottom:8px;z-index:2;background:rgba(0,0,0,.8);color:#fff;font-size:0.65rem;font-weight:600;padding:3px 7px;border-radius:999px;pointer-events:none;max-width:calc(100% - 16px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}.cal-day-items>.item>.poster img{width:100%;height:100%;object-fit:cover;}.cal-day-items>.item .info{padding:8px 2px 0;width:100%;}.cal-day-items>.item .name{font-size:0.85rem;font-weight:700;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}.cal-day-items>.item .meta{font-size:0.7rem;color:var(--text-dim);margin-top:2px;}.cal-day-items>.item .meta.dim{display:none;}.cal-day-items>.item .overview{display:none;}.cal-day-items>.item .cal-action-row{display:flex;gap:4px;margin-top:8px;margin-bottom:4px;width:100%;flex-wrap:wrap;}.cal-day-items>.item .cal-open-btn,.cal-day-items>.item .cal-drop-btn{flex:1 1 auto;min-width:0;font-size:0.62rem;padding:6px 6px;justify-content:center;border-radius:6px;opacity:0.95;white-space:nowrap;overflow:visible;}.cal-empty-day{height:20px;}@media (max-width:767px){.cal-week{margin-bottom:0;}.cal-week-head{display:none;}.cal-days-row{display:block;overflow:visible;padding:0;}.cal-day-col{display:block;width:100%;max-width:none;min-width:0;border:none;background:transparent;border-radius:0;margin-bottom:18px;padding:0 2px;box-shadow:none;}html[data-theme="dark"] .cal-day-col,html:not([data-theme="light"]) .cal-day-col{background:transparent;border:none;}html[data-theme="light"] .cal-day-col:not(.is-today){background:transparent;border:none;}.cal-day-col.is-today{background:transparent;border:none;}.cal-day-header{flex-direction:row;align-items:center;justify-content:flex-start;padding:0 2px 8px;gap:8px;}.cal-wd{font-size:0.9rem;font-weight:700;color:var(--text);}.cal-num{width:28px;height:28px;font-size:0.88rem;order:-1;color:var(--text);}.cal-day-col.is-today .cal-num{background:#7c3aed;color:#fff;}.cal-day-col.is-past .poster::after{background:rgba(128,128,128,.35);}.cal-day-items{flex-direction:row;overflow-x:auto;gap:12px;padding:0 0 4px;-webkit-overflow-scrolling:touch;scroll-snap-type:x proximity;touch-action:pan-x pan-y;}.cal-day-items>.item,.cal-day-items>.item.item{flex:0 0 var(--poster-card-w);width:var(--poster-card-w);max-width:var(--poster-card-w);scroll-snap-align:start;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);box-shadow:none;border-radius:14px;padding:8px 8px 10px;margin:0;}html[data-theme="light"] .cal-day-items>.item,
  html[data-theme="light"] .cal-day-items>.item.item{background:rgba(0,0,0,.03);border-color:rgba(0,0,0,.06);}.cal-day-items>.item>.poster{aspect-ratio:2/3;}.cal-day-items>.item .name{font-size:0.8rem;color:var(--text);}.cal-day-items>.item .meta{font-size:0.65rem;color:var(--text-dim);}.cal-day-items>.item .cal-action-row{margin-top:6px;gap:4px;}.cal-day-items>.item .cal-open-btn,.cal-day-items>.item .cal-drop-btn{font-size:0.58rem;padding:5px 4px;}.cal-empty-day{display:none;}}@media (min-width:768px) and (max-width:1180px){}.pane{animation:paneIn .25s ease;}@keyframes paneIn{}.modal.open .modal-shell,.list-modal.open .list-modal-panel,.show-cal-modal.open .show-cal-panel{animation:modalIn .28s cubic-bezier(.22,.68,.32,1);}@keyframes modalIn{from{opacity:0;transform:translateY(20px) scale(.96)}}.modal-backdrop,.list-modal-backdrop,.show-cal-backdrop{animation:fadeIn .2s ease;}@keyframes fadeIn{}.tab{transition:transform .15s ease,background .15s ease;}.tab:active{transform:scale(.95);}.btn-action,.btn-primary,.btn-ghost{transition:transform .15s ease,box-shadow .15s ease,filter .15s ease;}.btn-action:active,.btn-primary:active,.btn-ghost:active{transform:scale(.96);}@media (max-width:767px){#search-results .trending-scroll,#search-results .h-scroll,.hist-day-grid{display:flex;flex-direction:column;overflow:visible;gap:10px;}#search-results .trending-scroll>.item,#search-results .h-scroll>.item,.hist-day-grid .item{width:100%;max-width:none;flex-direction:row;gap:12px;padding:10px;background:var(--surface-1,rgba(255,255,255,.04));border:1px solid var(--border,rgba(255,255,255,.08));border-radius:14px;box-shadow:0 2px 8px rgba(0,0,0,.06);}#search-results .trending-scroll>.item>.poster,#search-results .h-scroll>.item>.poster,.hist-day-grid .item>.poster{width:var(--poster-list-w);height:var(--poster-list-h);max-width:var(--poster-list-w);flex-shrink:0;aspect-ratio:auto;border-radius:8px;}#search-results .trending-scroll>.item .info,#search-results .h-scroll>.item .info,.hist-day-grid .item .info{flex:1;padding:0;display:flex;flex-direction:column;justify-content:center;}#search-results .trending-scroll>.item .overview,#search-results .h-scroll>.item .overview,.hist-day-grid .item .overview{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:0.75rem;color:var(--text-dim);margin-top:4px;}html[data-theme="light"] #search-results .item,html[data-theme="light"] .hist-day-grid .item{background:rgba(255,255,255,.95);border-color:rgba(0,0,0,.06);}}@media (min-width:900px){.tabs{width:64px;padding:calc(12px + env(safe-area-inset-top,0px)) 6px 12px;gap:4px;}.tab{min-height:52px;padding:10px 4px;font-size:0.65rem;border-radius:12px;}.tab svg{width:22px;height:22px;}.container{padding-left:calc(64px + 20px);}}@media (min-width:1200px){.tabs{width:72px;padding-left:8px;padding-right:8px;}.tab{font-size:0.7rem;min-height:56px;}.container{padding-left:calc(72px + 28px);}}.modal-close,.list-modal-close,.summary-close,.person-close,.show-cal-close,.cw-sheet-cancel{box-shadow:var(--glass-shadow-sm);}html[data-theme="dark"] .modal-close,html[data-theme="dark"] .list-modal-close,html[data-theme="dark"] .summary-close,html[data-theme="dark"] .person-close,html[data-theme="dark"] .show-cal-close{color:#fff;background:rgba(255,255,255,0.12);border-color:rgba(255,255,255,0.2);}html[data-theme="light"] .modal-close,html[data-theme="light"] .list-modal-close,html[data-theme="light"] .summary-close,html[data-theme="light"] .person-close,html[data-theme="light"] .show-cal-close{color:#18181b;background:rgba(255,255,255,0.7);border-color:rgba(0,0,0,0.08);}.cw-sheet-backdrop{background:rgba(0,0,0,0.45);}.cw-sheet-panel{background:var(--sheet-glass,var(--glass-bg-strong));border:1px solid var(--glass-border);box-shadow:var(--glass-shadow);border-radius:20px;}html[data-theme="dark"] .cw-sheet-panel{background:rgba(28,28,36,0.72);border-color:rgba(255,255,255,0.18);}html[data-theme="light"] .cw-sheet-panel{background:rgba(255,255,255,0.82);border-color:rgba(0,0,0,0.08);}.cw-sheet-item:active{background:rgba(127,127,127,0.12);}.confirm-panel,.summary-panel,.person-panel,.show-cal-panel,.list-modal-panel,.modal-shell{background:var(--sheet-glass,var(--glass-bg-strong));border:1px solid var(--glass-border);box-shadow:var(--glass-shadow);}html[data-theme="dark"] .confirm-panel,html[data-theme="dark"] .summary-panel,html[data-theme="dark"] .person-panel,html[data-theme="dark"] .show-cal-panel,html[data-theme="dark"] .list-modal-panel,html[data-theme="dark"] .modal-shell{background:rgba(22,22,28,0.78);border-color:rgba(255,255,255,0.16);}html[data-theme="light"] .confirm-panel,html[data-theme="light"] .summary-panel,html[data-theme="light"] .person-panel,html[data-theme="light"] .show-cal-panel,html[data-theme="light"] .list-modal-panel,html[data-theme="light"] .modal-shell{background:rgba(255,255,255,0.88);border-color:rgba(0,0,0,0.08);}.list-modal .grid,.list-modal .cw-modal-grid,.list-modal-body .grid,.list-modal-body .cw-modal-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 10px;padding:6px 0 20px;}.list-modal .item,.list-modal .cw-card,.list-modal-body .item,.list-modal-body .cw-card{display:flex;flex-direction:column;align-items:stretch;gap:8px;padding:0;background:transparent;border:none;border-radius:0;box-shadow:none;overflow:visible;width:auto;min-width:0;}.list-modal .item>.poster,.list-modal .cw-poster,.list-modal-body .item>.poster,.list-modal-body .cw-poster{width:100%;max-width:none;height:auto;aspect-ratio:2/3;flex-shrink:0;border-radius:14px;overflow:hidden;box-shadow:0 6px 18px rgba(0,0,0,0.45);position:relative;background:#1a1a1a;}.list-modal .item>.poster img,.list-modal .cw-poster img,.list-modal-body .item>.poster img{width:100%;height:100%;object-fit:cover;display:block;}.list-modal .item .info,.list-modal .cw-info,.list-modal-body .item .info{padding:0 2px;width:100%;min-width:0;background:transparent;}.list-modal .item .name,.list-modal .cw-title,.list-modal-body .item .name{font-size:0.88rem;font-weight:650;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:normal;color:var(--text);margin:0;}.list-modal .item .meta,.list-modal .item .overview,.list-modal-body .item .meta,.list-modal-body .item .overview{font-size:0.74rem;line-height:1.35;margin-top:3px;color:var(--text-dim);background:transparent;}.list-modal .item .overview,.list-modal-body .item .overview{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}html[data-theme="dark"] .list-modal .item,html[data-theme="dark"] .list-modal .cw-card,html[data-theme="dark"] .list-modal-body .item{background:transparent;border:none;}html[data-theme="dark"] .list-modal .item .name,html[data-theme="dark"] .list-modal .cw-title{color:#f4f4f5;}html[data-theme="dark"] .list-modal .item .meta,html[data-theme="dark"] .list-modal .item .overview{color:#a1a1aa;}html[data-theme="light"] .list-modal .item,html[data-theme="light"] .list-modal .cw-card,html[data-theme="light"] .list-modal-body .item{background:transparent;border:none;}html[data-theme="light"] .list-modal .item .name,html[data-theme="light"] .list-modal .cw-title{color:#18181b;}html[data-theme="light"] .list-modal .item .meta,html[data-theme="light"] .list-modal .item .overview{color:#52525b;}@media (min-width:700px){.list-modal .grid,.list-modal .cw-modal-grid,.list-modal-body .grid{grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:18px 14px;}}.top-sticky{position:sticky;top:0;z-index:40;}html[data-theme="dark"] .top-sticky{background:rgba(12,12,16,0.75);border-bottom:1px solid rgba(255,255,255,0.08);box-shadow:0 4px 24px rgba(0,0,0,0.3);}:root{--close-bg:rgba(255,255,255,0.12);--close-fg:#fff;--close-border:rgba(255,255,255,0.2);--sticky-bg:rgba(12,12,16,0.75);--sticky-border:rgba(255,255,255,0.08);--sticky-shadow:0 4px 24px rgba(0,0,0,0.3);}html[data-theme="light"]{--close-bg:rgba(255,255,255,0.75);--close-fg:#18181b;--close-border:rgba(0,0,0,0.08);--sticky-bg:rgba(255,255,255,0.82);--sticky-border:rgba(0,0,0,0.06);--sticky-shadow:0 4px 20px rgba(0,0,0,0.08);--toast-info-bg:rgba(37,99,235,0.12);--toast-info-fg:#1d4ed8;--toast-ok-bg:rgba(5,150,105,0.12);--toast-ok-fg:#047857;--toast-err-bg:rgba(220,38,38,0.12);--toast-err-fg:#b91c1c;--toast-warn-bg:rgba(217,119,6,0.14);--toast-warn-fg:#b45309;}.top-sticky{border-bottom:1px solid var(--sticky-border);box-shadow:var(--sticky-shadow);}.modal-close,.list-modal-close,.summary-close,.person-close,.show-cal-close,.cw-sheet-cancel{background:var(--close-bg);color:var(--close-fg);border:1px solid var(--close-border);}.cw-sheet-panel,.confirm-panel,.summary-panel,.person-panel,.show-cal-panel,.list-modal-panel,.modal-shell{background:var(--sheet-glass);border:1px solid var(--glass-border-soft);box-shadow:var(--glass-shadow);}html[data-theme="light"] .toast-info .toast-icon{background:var(--toast-info-bg);color:var(--toast-info-fg);}html[data-theme="light"] .toast-success .toast-icon{background:var(--toast-ok-bg);color:var(--toast-ok-fg);}html[data-theme="light"] .toast-error .toast-icon{background:var(--toast-err-bg);color:var(--toast-err-fg);}html[data-theme="light"] .toast-warn .toast-icon{background:var(--toast-warn-bg);color:var(--toast-warn-fg);}html{scroll-behavior:smooth;-webkit-tap-highlight-color:transparent;}body{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility;}button,a,.item,.tab,.cw-card,.platform-card,.btn-action,.home-more-btn,.list-modal-close,.modal-close{touch-action:manipulation;-webkit-tap-highlight-color:transparent;}.h-scroll,.trending-scroll,.cal-days-row,.list-modal-body,.modal-body,.summary-body,.person-body,.show-cal-panel{-webkit-overflow-scrolling:touch;overscroll-behavior:contain;}.h-scroll,.trending-scroll{scroll-behavior:smooth;}.cal-days-row,.cal-strip{scroll-behavior:auto;touch-action:pan-x pan-y;}.item,.cw-card,.platform-card,.tab,.btn-action{transition:transform .16s cubic-bezier(.22,.68,.32,1),opacity .16s ease,background-color .16s ease,box-shadow .16s ease;}.item:active,.cw-card:active,.platform-card:active,.tab:active,.btn-action:active{transform:scale(.97);}.poster img,.cw-poster img{transform:translateZ(0);backface-visibility:hidden;}.top-sticky,.tabs{transform:translateZ(0);}.modal-shell,.list-modal-panel,.cw-sheet-panel,.summary-panel,.person-panel,.show-cal-panel,.confirm-panel{will-change:transform,opacity;}.pane{animation-duration:.2s;animation-timing-function:cubic-bezier(.22,.68,.32,1);}@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto;}.item:active,.cw-card:active,.platform-card:active,.tab:active{transform:none;}}.list-modal-panel,.summary-panel,.person-panel{top:50%;bottom:auto;left:50%;right:auto;transform:translate(-50%,-50%);width:min(92vw,1000px);max-height:88vh;border-radius:18px;}.list-modal.open .list-modal-panel,
.summary-modal.open .summary-panel,
.person-modal.open .person-panel{animation:mtPanelIn .28s cubic-bezier(.22,.68,.32,1);}.list-modal.closing .list-modal-panel,
.summary-modal.closing .summary-panel,
.person-modal.closing .person-panel,
.show-cal-modal.closing .show-cal-panel{animation:mtPanelOut .16s ease forwards;}.cal-finale-badge{position:absolute;left:6px;top:6px;z-index:3;background:rgba(124,58,237,.94);color:#fff;font-size:.68rem;font-weight:700;line-height:1.2;padding:3px 7px;border-radius:8px;letter-spacing:.2px;box-shadow:0 4px 12px rgba(0,0,0,.28);}.cw-poster{position:relative;}.cw-bar{position:absolute;left:0;right:0;bottom:0;height:3px;z-index:4;border-radius:0;}.cw-bar-fill{height:100%;border-radius:0;}.cw-poster .poster-play,.cw-poster .cw-foot,.cw-poster .wl-watched,.cw-poster .cw-bar{display:flex;visibility:visible;opacity:1;}.cw-poster .wl-watched{position:absolute;top:8px;right:8px;z-index:5;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(16,16,20,.55);}.cw-poster .poster-play{width:42px;height:42px;}.cw-foot{padding:16px 8px 8px;}.cw-foot-left,.cw-foot-right{font-size:.66rem;max-width:58%;}.cw-bar{height:3px;background:rgba(255,255,255,.25);}.cw-bar-fill{background:linear-gradient(90deg,#a78bfa,#7c3aed);}@media (max-width:767px){.h-scroll .cw-card .cw-poster{position:relative;overflow:hidden;}.h-scroll .cw-card .poster-play,.h-scroll .cw-card .cw-foot,.h-scroll .cw-card .wl-watched,.h-scroll .cw-card .cw-bar{display:flex;opacity:1;visibility:visible;}.h-scroll .cw-card .poster-play{width:38px;height:38px;}.h-scroll .cw-card .cw-foot{padding:14px 6px 6px;}.h-scroll .cw-card .cw-foot-left,.h-scroll .cw-card .cw-foot-right{font-size:.62rem;padding:2px 6px;}}html[data-theme="light"] .platform-card,
html[data-theme="light"] .platform-card:hover,
html[data-theme="light"] .platform-card:active{box-shadow:none;}html[data-theme="light"] .platform-card:hover{transform:translateY(-3px);}.cal-week-tabs{display:flex;gap:8px;margin:0 0 14px;}.cal-week-tab{border:1px solid var(--glass-border-soft);background:transparent;color:var(--text-dim);border-radius:999px;padding:7px 16px;font-size:.82rem;font-weight:700;}.cal-week-tab.is-on{background:#7c3aed;color:#fff;border-color:#7c3aed;box-shadow:0 6px 16px rgba(124,58,237,.28);}.cal-week-panel{display:none;}.cal-week-panel.is-on{display:block;}.cal-strip{display:flex;gap:12px;overflow-x:auto;padding:2px 2px 12px;-webkit-overflow-scrolling:touch;scroll-behavior:auto;touch-action:pan-x pan-y;overscroll-behavior-x:contain;scroll-snap-type:x proximity;}.cal-strip::-webkit-scrollbar{display:none;}.cal-strip-day{flex:0 0 calc(var(--poster-card-w) + 40px);width:calc(var(--poster-card-w) + 40px);min-width:calc(var(--poster-card-w) + 40px);max-width:calc(var(--poster-card-w) + 40px);box-sizing:border-box;border:1px solid var(--glass-border-soft);background:var(--glass-bg);border-radius:16px;padding:10px 6px 8px;display:flex;flex-direction:column;align-items:center;gap:1px;color:var(--text);box-shadow:none;transition:background .16s ease,border-color .16s ease,transform .16s ease;flex-shrink:0;}.cal-strip-day:hover{transform:translateY(-1px);}.cal-strip-day.is-today{background:rgba(124,58,237,.12);border-color:rgba(124,58,237,.28);}.cal-strip-day.is-on{background:rgba(127,127,127,.14);border-color:transparent;}.cal-strip-wd{font-size:.72rem;color:var(--text-dim);font-weight:600;}.cal-strip-num{font-size:1.35rem;font-weight:800;line-height:1.15;letter-spacing:-.3px;}.cal-strip-mon{font-size:.68rem;color:var(--text-dim);}.cal-strip-dot{margin-top:4px;font-size:.7rem;color:#7c3aed;letter-spacing:1px;line-height:1;}html[data-theme="light"] .cal-strip-day:not(.is-today){background:#fff;}@media (max-width:767px){.cal-strip-day{flex:1 1 0;min-width:72px;max-width:none;}}.cw-card,.h-scroll .item,.platform-card{content-visibility:auto;contain-intrinsic-size:auto 220px;}img{content-visibility:auto;}.top-sticky,.tabs{transform:translateZ(0);backface-visibility:hidden;}button,a,.item,.cw-card,.tab,.platform-card{touch-action:manipulation;}.h-scroll,.trending-scroll,.cal-days-row,.cal-strip{overscroll-behavior-x:contain;overscroll-behavior-y:auto;}.cw-card,html[data-theme="light"] .cw-card,html[data-theme="dark"] .cw-card{background:transparent;border:none;box-shadow:none;}.cw-card:hover,.cw-poster,.cw-card:hover .cw-poster{box-shadow:none;border:none;}html[data-theme="dark"] .confirm-panel,html[data-theme="dark"] .cw-sheet-panel,
html:not([data-theme="light"]) .confirm-panel,html:not([data-theme="light"]) .cw-sheet-panel{background:rgba(28,28,32,.96);}html[data-theme="light"] .confirm-panel,html[data-theme="light"] .cw-sheet-panel{background:rgba(255,255,255,.98);}.confirm-backdrop,.cw-sheet-backdrop{background:rgba(0,0,0,.35);}.show-cal-panel{width:min(92vw,420px);max-height:min(78vh,640px);color:var(--text);}html[data-theme="dark"] .show-cal-panel,html:not([data-theme="light"]) .show-cal-panel{background:rgba(24,24,28,.98);}html[data-theme="light"] .show-cal-panel{background:#fff;color:#18181b;}.show-cal-name,.show-cal-info,#show-cal-month,.show-cal-weekdays span,.sc-day{color:var(--text);}html[data-theme="light"] .show-cal-name,html[data-theme="light"] .show-cal-info,html[data-theme="light"] #show-cal-month,html[data-theme="light"] .show-cal-weekdays span{color:#18181b;}.sc-day{color:var(--text-dim);}.show-cal-grid{gap:6px;}.sc-day{aspect-ratio:auto;min-height:42px;height:42px;}@media (min-width:768px){html[data-theme="dark"] .confirm-panel,html[data-theme="dark"] .cw-sheet-panel,html[data-theme="dark"] .show-cal-panel,
  html:not([data-theme="light"]) .confirm-panel,html:not([data-theme="light"]) .cw-sheet-panel,html:not([data-theme="light"]) .show-cal-panel{background:rgba(28,28,32,.98);}html[data-theme="light"] .confirm-panel,html[data-theme="light"] .cw-sheet-panel,html[data-theme="light"] .show-cal-panel{background:#fff;}}.cw-sheet-panel,.confirm-panel,.show-cal-panel{filter:none;}html[data-theme="dark"] .cw-sheet-panel,html[data-theme="dark"] .confirm-panel,html[data-theme="dark"] .show-cal-panel,
html:not([data-theme="light"]) .cw-sheet-panel,html:not([data-theme="light"]) .confirm-panel,html:not([data-theme="light"]) .show-cal-panel{background:#1c1c20;color:#f4f4f5;}html[data-theme="light"] .cw-sheet-panel,html[data-theme="light"] .confirm-panel,html[data-theme="light"] .show-cal-panel{background:#ffffff;color:#18181b;}.cw-sheet-title,.cw-sheet-item,.confirm-title,.confirm-msg,.show-cal-name{color:inherit;text-shadow:none;filter:none;}.cw-sheet-title{color:#3f3f46;}html[data-theme="dark"] .cw-sheet-title{color:#d4d4d8;}html[data-theme="dark"] .cw-sheet-item{color:#fafafa;}html[data-theme="dark"] .cw-sheet-item.danger{color:#f87171;}.cw-sheet-cancel{color:#18181b;font-weight:700;}html[data-theme="dark"] .cw-sheet-cancel{color:#fafafa;}.cw-sheet-backdrop,.confirm-backdrop{background:rgba(0,0,0,.45);}#cw-sheet.open,#confirm-modal.open{display:block;position:fixed;inset:0;}#cw-sheet.open .cw-sheet-panel,#confirm-modal.open .confirm-panel,
#cw-sheet.closing .cw-sheet-panel,#confirm-modal.closing .confirm-panel{position:fixed;top:50%;left:50%;right:auto;bottom:auto;width:min(320px,calc(100vw - 32px));height:auto;margin:0;transform:translate(-50%,-50%);animation:none;will-change:auto;filter:none;border-radius:16px;box-shadow:0 12px 32px rgba(0,0,0,.28);z-index:2;}.cw-sheet-panel{padding:8px;}.confirm-panel{padding:22px 18px 16px;}html[data-theme="dark"] .cw-sheet-panel,html[data-theme="dark"] .confirm-panel,
html:not([data-theme="light"]) .cw-sheet-panel,html:not([data-theme="light"]) .confirm-panel{background:#222226;color:#fff;}html[data-theme="light"] .cw-sheet-panel,html[data-theme="light"] .confirm-panel{background:#fff;color:#111;}.cw-sheet-title{font-size:.85rem;font-weight:600;opacity:.75;}.cw-sheet-item{font-size:1rem;font-weight:600;color:inherit;position:static;width:100%;display:block;}.cw-sheet-cancel{position:static;top:auto;left:auto;right:auto;width:100%;height:auto;margin-top:6px;border-radius:12px;display:block;}.cw-sheet-item.danger{color:#e11d48;}.confirm-title,.confirm-msg{color:inherit;}.douban-filter-tab.is-empty,.theater-filter-tab.is-empty{opacity:.55;font-weight:500;}.douban-filter-tab.is-empty.active,.theater-filter-tab.is-empty.active{opacity:.88;}.douban-filter-tab.is-empty::after,.theater-filter-tab.is-empty::after{content:"";display:inline-block;width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.55;margin-left:6px;vertical-align:middle;}.board-empty{grid-column:1/-1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;padding:38px 20px;border-radius:18px;width:100%;box-sizing:border-box;background:rgba(127,127,127,.08);border:1px dashed rgba(127,127,127,.35);}.board-empty-t{font-size:.95rem;font-weight:650;color:var(--text);line-height:1.4;}.board-empty-s{font-size:.78rem;line-height:1.6;color:var(--text-dim);max-width:30em;}html[data-theme="light"] .board-empty-s{color:#52525b;}:root{--panel-bg:#17171d;--panel-bg-2:#1f1f27;--panel-border:rgba(255,255,255,0.09);--panel-accent:#8b5cf6;--panel-accent-soft:rgba(139,92,246,0.16);--panel-shadow:0 28px 80px rgba(0,0,0,0.6),0 4px 16px rgba(0,0,0,0.4);--panel-radius:20px;--scrim:rgba(8,10,16,0.62);}html[data-theme="light"]{--panel-bg:#ffffff;--panel-bg-2:#f6f6f8;--panel-border:rgba(15,10,30,0.09);--panel-accent:#7c3aed;--panel-accent-soft:rgba(124,58,237,0.1);--panel-shadow:0 28px 80px rgba(35,22,70,0.22),0 4px 14px rgba(0,0,0,0.08);--scrim:rgba(22,18,34,0.42);}.modal-backdrop,.list-modal-backdrop,.summary-backdrop,.person-backdrop,.confirm-backdrop,.show-cal-backdrop,.cw-sheet-backdrop{background:var(--scrim);}.modal-shell,.list-modal-panel,.summary-panel,.person-panel,.show-cal-panel,.login-card{background:var(--panel-bg);border:1px solid var(--panel-border);border-radius:var(--panel-radius);box-shadow:var(--panel-shadow);color:var(--text);}.cw-sheet-panel,.confirm-panel{background:var(--panel-bg);border:1px solid var(--panel-border);box-shadow:var(--panel-shadow);color:var(--text);}.list-modal-head,.summary-head,.person-panel-head,.show-cal-head{border-bottom:1px solid var(--panel-border);margin:0 -18px 10px;padding:2px 18px 12px;}.modal-close,.list-modal-close,.summary-close,.person-close,.show-cal-close{background:var(--panel-bg-2);border:1px solid var(--panel-border);color:var(--text-dim);box-shadow:0 2px 8px rgba(0,0,0,0.18);}.modal-close:hover,.list-modal-close:hover,.summary-close:hover,.person-close:hover,.show-cal-close:hover{background:var(--panel-accent-soft);border-color:var(--panel-accent);color:var(--panel-accent);transform:scale(1.06);}.list-modal-body .item,.summary-body .item{border-radius:12px;}.list-modal-body .item:hover,.summary-body .item:hover{background:var(--hover-bg,rgba(255,255,255,0.05));}html[data-theme="light"] .list-modal-body .item:hover,html[data-theme="light"] .summary-body .item:hover{background:rgba(0,0,0,0.04);}.confirm-ok{background:linear-gradient(135deg,#6d28d9,#8b5cf6);border:none;color:#fff;box-shadow:0 6px 18px rgba(124,58,237,0.35);}.confirm-ok:hover{filter:brightness(1.08);transform:translateY(-1px);}.modal-body::-webkit-scrollbar,.list-modal-body::-webkit-scrollbar,.summary-body::-webkit-scrollbar,.person-body::-webkit-scrollbar,.person-panel-body::-webkit-scrollbar,.show-cal-panel::-webkit-scrollbar{width:8px;}.modal-body::-webkit-scrollbar-thumb,.list-modal-body::-webkit-scrollbar-thumb,.summary-body::-webkit-scrollbar-thumb,.person-body::-webkit-scrollbar-thumb,.person-panel-body::-webkit-scrollbar-thumb,.show-cal-panel::-webkit-scrollbar-thumb{background:var(--scrollbar,rgba(255,255,255,0.16));border-radius:99px;}.modal-body::-webkit-scrollbar-thumb:hover,.list-modal-body::-webkit-scrollbar-thumb:hover,.summary-body::-webkit-scrollbar-thumb:hover,.person-body::-webkit-scrollbar-thumb:hover,.person-panel-body::-webkit-scrollbar-thumb:hover{background:var(--panel-accent-soft);}html[data-theme="light"] .modal-body::-webkit-scrollbar-thumb,html[data-theme="light"] .list-modal-body::-webkit-scrollbar-thumb,html[data-theme="light"] .summary-body::-webkit-scrollbar-thumb,html[data-theme="light"] .person-body::-webkit-scrollbar-thumb,html[data-theme="light"] .person-panel-body::-webkit-scrollbar-thumb,html[data-theme="light"] .show-cal-panel::-webkit-scrollbar-thumb{background:#d4d4d8;}.tabs{background:var(--dock-bg,rgba(15,15,21,0.95));}html .confirm-panel,
html .cw-sheet-panel,
html .show-cal-panel,
html[data-theme="dark"] .confirm-panel,
html[data-theme="dark"] .cw-sheet-panel,
html[data-theme="dark"] .show-cal-panel,
html:not([data-theme="light"]) .confirm-panel,
html:not([data-theme="light"]) .cw-sheet-panel,
html:not([data-theme="light"]) .show-cal-panel,
#confirm-modal .confirm-panel,
#confirm-modal.open .confirm-panel,
#cw-sheet .cw-sheet-panel,
#cw-sheet.open .cw-sheet-panel,
.show-cal-modal .show-cal-panel,
.show-cal-modal.open .show-cal-panel{background:rgba(28, 28, 36, 0.58);backdrop-filter:blur(12px) saturate(165%);-webkit-backdrop-filter:blur(12px) saturate(165%);border:1px solid rgba(255, 255, 255, 0.18);box-shadow:0 20px 60px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.15);color:var(--text);}html[data-theme="light"] .confirm-panel,
html[data-theme="light"] .cw-sheet-panel,
html[data-theme="light"] .show-cal-panel,
html[data-theme="light"] #confirm-modal .confirm-panel,
html[data-theme="light"] #cw-sheet .cw-sheet-panel,
html[data-theme="light"] .show-cal-modal .show-cal-panel{background:rgba(255, 255, 255, 0.65);border:1px solid rgba(255, 255, 255, 0.7);box-shadow:0 20px 60px rgba(0, 0, 0, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.85);}.confirm-backdrop,
.show-cal-backdrop,
.cw-sheet-backdrop{background:rgba(8, 10, 16, 0.42);}html[data-theme="light"] .confirm-backdrop,
html[data-theme="light"] .show-cal-backdrop,
html[data-theme="light"] .cw-sheet-backdrop{background:rgba(22, 18, 34, 0.28);}html:not([data-theme="light"]) .top-sticky,
html[data-theme="dark"] .top-sticky{background:rgba(18,18,24,0.62);-webkit-backdrop-filter:blur(12px) saturate(165%) brightness(0.92);backdrop-filter:blur(12px) saturate(165%) brightness(0.92);border-bottom:1px solid rgba(255,255,255,0.09);box-shadow:0 6px 24px rgba(0,0,0,0.22),inset 0 -1px 0 rgba(255,255,255,0.05);}html[data-theme="light"] .top-sticky{background:rgba(252,252,253,0.58);-webkit-backdrop-filter:blur(12px) saturate(165%);backdrop-filter:blur(12px) saturate(165%);border-bottom:1px solid rgba(255,255,255,0.7);box-shadow:0 6px 22px rgba(0,0,0,0.06),inset 0 -1px 0 rgba(0,0,0,0.05);}html:not([data-theme="light"]) .platform-card,
html[data-theme="dark"] .platform-card{background:rgba(18,18,24,0.62);-webkit-backdrop-filter:blur(12px) saturate(165%) brightness(0.92);backdrop-filter:blur(12px) saturate(165%) brightness(0.92);border:1px solid rgba(255,255,255,0.13);box-shadow:0 10px 28px rgba(0,0,0,0.34),inset 0 1px 0 rgba(255,255,255,0.14);}html[data-theme="light"] .platform-card{background:rgba(252,252,253,0.58);-webkit-backdrop-filter:blur(12px) saturate(165%);backdrop-filter:blur(12px) saturate(165%);border:1px solid rgba(255,255,255,0.8);box-shadow:0 10px 26px rgba(0,0,0,0.07),inset 0 1px 0 rgba(255,255,255,0.95);}html:not([data-theme="light"]) .platform-card:hover,
html[data-theme="dark"] .platform-card:hover{background:rgba(26,26,34,0.68);border-color:rgba(167,139,250,0.32);box-shadow:0 16px 36px rgba(0,0,0,0.45),inset 0 1px 0 rgba(255,255,255,0.2);}html[data-theme="light"] .platform-card:hover{background:rgba(255,255,255,0.68);border-color:rgba(109,40,217,0.28);}html .list-modal-panel,
html[data-theme="dark"] .list-modal-panel,
html:not([data-theme="light"]) .list-modal-panel{background:rgba(18,18,24,0.62);-webkit-backdrop-filter:blur(12px) saturate(165%) brightness(0.92);backdrop-filter:blur(12px) saturate(165%) brightness(0.92);border:1px solid rgba(255,255,255,0.14);box-shadow:0 30px 80px rgba(0,0,0,0.6),inset 0 1px 0 rgba(255,255,255,0.13);}html[data-theme="light"] .list-modal-panel{background:rgba(252,252,253,0.58);-webkit-backdrop-filter:blur(12px) saturate(165%);backdrop-filter:blur(12px) saturate(165%);border:1px solid rgba(255,255,255,0.85);box-shadow:0 30px 70px rgba(0,0,0,0.16),inset 0 1px 0 rgba(255,255,255,0.95);}.list-modal-backdrop{background:rgba(8,10,16,0.52);}html[data-theme="light"] .list-modal-backdrop{background:rgba(22,18,34,0.34);}html[data-theme="dark"] .summary-panel,
html:not([data-theme="light"]) .summary-panel{background:rgba(22,22,28,0.85);-webkit-backdrop-filter:blur(20px) saturate(165%);backdrop-filter:blur(20px) saturate(165%);border:1px solid rgba(255,255,255,0.14);box-shadow:0 28px 80px rgba(0,0,0,0.6),inset 0 1px 0 rgba(255,255,255,0.12);}html[data-theme="light"] .summary-panel{background:rgba(255,255,255,0.8);-webkit-backdrop-filter:blur(20px) saturate(165%);backdrop-filter:blur(20px) saturate(165%);border:1px solid rgba(255,255,255,0.85);box-shadow:0 28px 70px rgba(35,22,70,0.22),inset 0 1px 0 rgba(255,255,255,0.95);}.list-modal-head{gap:14px;padding:18px 20px 16px 22px;align-items:center;}.list-modal-title{flex:1 1 auto;min-width:0;margin:0;padding:0;text-indent:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.35;}.list-modal-close{flex:0 0 auto;margin:0;padding:0;}@media (max-width:420px){.list-modal-head{padding:16px 16px 14px 18px;gap:10px;}.list-modal-title{font-size:1rem;}}.summary-head h2,.person-panel-head h2,.show-cal-head h2,.modal-head h2{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.platform-card-left{padding:8px 4px 8px 12px;}.platform-card-logo{width:48px;height:48px;}@media (min-width:768px){.platform-card-left{padding:12px 6px 12px 16px;}.platform-card-logo{width:62px;height:62px;}}.platform-card-left{padding-left:14px;padding-right:6px;}@media (min-width:768px){.platform-card-left{padding-left:18px;}}.list-modal-body{padding:18px 20px 26px;}.list-modal-body .item,.list-modal-body .cw-card{padding:10px 4px 8px;}.cw-title,.cw-watching,.cw-meta{padding-left:2px;padding-right:2px;}.item .name,.item .meta{padding-left:2px;padding-right:2px;}.platform-card-name,.theater-card-name,.list-modal .name,.list-modal .meta{padding-left:2px;padding-right:2px;}@media (min-width:600px){.cal-days-row,
  .cal-strip{display:flex;gap:12px;overflow-x:auto;overflow-y:visible;scroll-snap-type:x proximity;touch-action:pan-x pan-y;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;min-width:0;scrollbar-width:none;}.cal-strip::-webkit-scrollbar,
  .cal-days-row::-webkit-scrollbar{display:none;}.cal-day-col,
  .cal-strip-day{flex:0 0 auto;flex-shrink:0;width:calc(var(--poster-card-w) + 40px);min-width:calc(var(--poster-card-w) + 40px);max-width:calc(var(--poster-card-w) + 40px);box-sizing:border-box;content-visibility:visible;}}
@media (max-width:767px){
  .cw-modal-grid,.list-modal .cw-modal-grid,.list-modal-body .cw-modal-grid{
    display:flex !important;
    flex-direction:column;
    gap:10px;
    padding:4px 0 16px;
  }
  .cw-modal-grid>.item,.cw-modal-grid>.cw-card,
  .list-modal .cw-modal-grid>.item,.list-modal-body .cw-modal-grid>.item{
    display:flex !important;
    flex-direction:row !important;
    align-items:center;
    gap:12px;
    width:100% !important;
    padding:10px 12px !important;
    background:rgba(255,255,255,.04);
    border:1px solid rgba(255,255,255,.06);
    border-radius:14px;
    box-shadow:none;
  }
  html[data-theme="light"] .cw-modal-grid>.item,
  html[data-theme="light"] .list-modal .cw-modal-grid>.item{
    background:rgba(0,0,0,.03);
    border-color:rgba(0,0,0,.06);
  }
  .cw-modal-grid>.item>.poster,.cw-modal-grid .cw-poster,
  .list-modal .cw-modal-grid>.item>.poster{
    width:72px !important;
    min-width:72px;
    max-width:72px;
    height:108px !important;
    aspect-ratio:auto !important;
    border-radius:10px;
    flex-shrink:0;
  }
  .cw-modal-grid>.item .info,.cw-modal-grid .cw-info,
  .list-modal .cw-modal-grid>.item .info{
    flex:1 1 auto;
    min-width:0;
    padding:0 !important;
    display:flex;
    flex-direction:column;
    gap:2px;
  }
  .cw-modal-grid>.item .name,.cw-modal-grid .cw-title{
    font-size:0.95rem;
    font-weight:700;
    -webkit-line-clamp:1;
  }
  .cw-modal-grid>.item .meta,.cw-modal-grid>.item .overview{
    font-size:0.75rem;
    -webkit-line-clamp:2;
    margin-top:0;
  }
  .cw-modal-grid>.item .cw-actions,.cw-modal-grid .cw-actions{
    display:flex;
    gap:6px;
    margin-top:6px;
  }
  .cw-modal-grid .cw-act-btn{
    font-size:0.72rem;
    padding:5px 10px;
    border-radius:8px;
  }
  .cw-modal-grid>.item .cw-more,.cw-modal-grid .cw-more{
    flex:0 0 auto;
    margin-left:auto;
    width:32px;
    height:32px;
    border-radius:50%;
    background:rgba(255,255,255,.08);
    display:flex;
    align-items:center;
    justify-content:center;
  }
}
@media (min-width:900px){
  .tabs{
    position:fixed;
    left:0;right:auto;top:0;bottom:0;
    width:88px;
    flex-direction:column;
    justify-content:flex-start;
    align-items:stretch;
    border-top:none;
    border-right:1px solid var(--glass-border-soft);
    border-radius:0 20px 20px 0;
    padding:calc(16px + env(safe-area-inset-top,0px)) 10px 16px;
    background:rgba(18,18,24,0.62);
    -webkit-backdrop-filter:blur(12px) saturate(165%) brightness(0.92);
    backdrop-filter:blur(12px) saturate(165%) brightness(0.92);
    box-shadow:10px 0 32px rgba(0,0,0,0.25);
    z-index:60;
  }
  html[data-theme="light"] .tabs{
    background:rgba(252,252,253,0.58);
    -webkit-backdrop-filter:blur(12px) saturate(165%);
    backdrop-filter:blur(12px) saturate(165%);
    border-right:1px solid rgba(0,0,0,0.08);
  }
  .container{
    padding-left:calc(88px + 28px);
    padding-right:28px;
  }
  .top-sticky{
    margin-left:0;
    margin-right:0;
    background:rgba(18,18,24,0.62);
    -webkit-backdrop-filter:blur(12px) saturate(165%) brightness(0.92);
    backdrop-filter:blur(12px) saturate(165%) brightness(0.92);
  }
  html[data-theme="light"] .top-sticky{
    background:rgba(252,252,253,0.58);
    -webkit-backdrop-filter:blur(12px) saturate(165%);
    backdrop-filter:blur(12px) saturate(165%);
  }
}
@media (min-width:1200px){
  .tabs{width:108px;}
  .container{padding-left:calc(108px + 36px);padding-right:36px;}
}
@media (min-width:900px){
  .tabs{z-index:80;}
  .container{
    padding-left:120px !important;
    box-sizing:border-box;
  }
  .top-sticky{
    margin-left:0 !important;
    margin-right:0 !important;
    padding-left:0 !important;
  }
  .h-scroll-wrap{
    margin-left:0 !important;
    margin-right:0 !important;
    padding-left:0 !important;
  }
  .home-section,.platform-section,.theater-platform-section{
    margin-left:0;
    padding-left:0;
  }
}
@media (min-width:1200px){
  .container{padding-left:140px !important;}
}
.list-modal .item .overview,
.list-modal-body .item .overview,
.list-modal .item .meta.dim,
.list-modal-body .item .meta.dim,
.cw-modal-grid .item .overview,
.cw-modal-grid .item .meta.dim{
  display:none !important;
}
@media (max-width:899px){
  .tabs{
    background:rgba(18,18,24,0.55);
    -webkit-backdrop-filter:blur(12px) saturate(165%);
    backdrop-filter:blur(12px) saturate(165%);
    border-top:1px solid rgba(255,255,255,0.08);
  }
  html[data-theme="light"] .tabs{
    background:rgba(252,252,253,0.62);
    -webkit-backdrop-filter:blur(12px) saturate(165%);
    backdrop-filter:blur(12px) saturate(165%);
    border-top:1px solid rgba(0,0,0,0.06);
  }
}

@media (min-width:768px){
  .cal-week-panel{overflow:visible;}
  .cal-days-row,.cal-strip{
    display:flex !important;
    flex-wrap:nowrap !important;
    overflow-x:auto !important;
    overflow-y:visible !important;
    touch-action:pan-x pan-y !important;
    -webkit-overflow-scrolling:touch !important;
    overscroll-behavior-x:contain;
    scroll-snap-type:none;
    min-width:0;
  }
  .cal-day-col,.cal-strip-day,.cal-day-items,.cal-day-items>.item{
    touch-action:pan-x pan-y;
  }
  .cal-day-col,.cal-strip-day{
    flex:0 0 auto !important;
    flex-shrink:0 !important;
  }
}

html[data-theme="light"] .platform-card,
html[data-theme="light"] .platform-card-left,
html[data-theme="light"] .platform-card-right,
html[data-theme="light"] .platform-card-posters,
html[data-theme="light"] .cal-day-col:not(.is-today),
html[data-theme="light"] .cal-strip-day:not(.is-today),
html[data-theme="light"] .cal-day-items>.item,
html[data-theme="light"] .cal-day-items>.item.item{
  background:#fff;
  background-color:#fff;
  border-color:rgba(0,0,0,.06);
  box-shadow:0 4px 14px rgba(0,0,0,.06);
}
.platform-card-poster{position:absolute !important;}
html[data-theme="light"] .cal-day-col.is-today.is-today{background:linear-gradient(180deg,rgba(167,139,250,.2),rgba(167,139,250,.08));border-color:rgba(167,139,250,.4);box-shadow:0 8px 24px rgba(124,58,237,.15),inset 0 1px 0 rgba(255,255,255,.15);}
html[data-theme="light"] .cal-day-col.is-today.is-today .cal-num{background:#7c3aed;color:#fff;}
html[data-theme="light"] .cal-strip-day.is-today.is-today{background:rgba(124,58,237,.12);border-color:rgba(124,58,237,.28);box-shadow:none;}
html[data-theme="dark"] .cal-day-col.is-today.is-today,html:not([data-theme="light"]) .cal-day-col.is-today.is-today{background:linear-gradient(180deg,rgba(167,139,250,.22),rgba(167,139,250,.08));border:1px solid rgba(167,139,250,.4);border-radius:20px;box-shadow:0 8px 24px rgba(124,58,237,.2),inset 0 1px 0 rgba(255,255,255,.12);}
html[data-theme="dark"] .cal-strip-day.is-today.is-today,html:not([data-theme="light"]) .cal-strip-day.is-today.is-today{background:rgba(124,58,237,.18);border-color:rgba(167,139,250,.45);}
html[data-theme="light"] .platform-card-logo,
html[data-theme="light"] .platform-card-poster{
  background:transparent;
}

::selection{background:rgba(124,58,237,.28);color:inherit;}
html[data-theme="light"] ::selection{background:rgba(124,58,237,.18);}
:focus-visible{outline:2px solid rgba(167,139,250,.7);outline-offset:2px;border-radius:10px;}
button:focus-visible,a:focus-visible{outline-offset:3px;}
.poster,.cw-poster,.detail-poster{position:relative;}
.poster img,.cw-poster img,.platform-card-poster{transition:transform .35s cubic-bezier(.22,.68,.32,1),filter .35s ease;}
@media (hover:hover) and (pointer:fine){
  .item.clickable:hover>.poster img,
  .h-scroll .item:hover>.poster img,
  .cw-card:hover .cw-poster img,
  .platform-card:hover .platform-card-poster{transform:scale(1.045);}
  .platform-card:hover{transform:translateY(-2px);}
  .btn-action:hover{background:var(--glass-bg-strong,rgba(255,255,255,.08));}
}
.home-section-title{letter-spacing:.2px;}
.home-section-title::before{border-radius:99px;}
.tab{position:relative;}
.tab.active{font-weight:700;}
.btn-action,.load-more,.cal-open-btn,.cal-drop-btn,.cw-act-btn{
  transition:transform .16s cubic-bezier(.22,.68,.32,1),background-color .16s ease,box-shadow .16s ease,opacity .16s ease;
}
.btn-action:active,.load-more:active,.cal-open-btn:active,.cal-drop-btn:active{transform:scale(.96);}
.empty{padding:28px 16px;}

.empty p{opacity:.8;}
img{color:transparent;}
.poster-ph,.cw-poster-ph{background:linear-gradient(160deg,rgba(167,139,250,.12),rgba(255,255,255,.04));}
html[data-theme="light"] .poster-ph,html[data-theme="light"] .cw-poster-ph{background:linear-gradient(160deg,rgba(124,58,237,.08),rgba(0,0,0,.03));}
::-webkit-scrollbar{width:10px;height:10px;}
::-webkit-scrollbar-thumb{background:rgba(127,127,127,.28);border-radius:99px;border:2px solid transparent;background-clip:padding-box;}
::-webkit-scrollbar-thumb:hover{background:rgba(167,139,250,.45);background-clip:padding-box;}
.toast{backdrop-filter:blur(12px) saturate(165%);-webkit-backdrop-filter:blur(12px) saturate(165%);}
.chip,.douban-filter-tab,.theater-filter-tab{transition:background-color .16s ease,color .16s ease,transform .16s ease;}
.person-panel{background:var(--panel-grad,linear-gradient(165deg,#16161a 0%,#0e0e10 100%))!important;border:1px solid var(--border-strong)!important;box-shadow:0 30px 80px rgba(0,0,0,0.85)!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;will-change:auto!important;}html[data-theme="dark"] .person-panel,html[data-theme="light"] .person-panel{background:var(--panel-grad,linear-gradient(165deg,#16161a 0%,#0e0e10 100%))!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;will-change:auto!important;}.person-panel,.person-panel *{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;filter:none!important;}.person-panel-head{padding:14px 20px!important;margin:0!important;}.person-panel-name{padding-left:4px;}
.chip:active,.douban-filter-tab:active,.theater-filter-tab:active{transform:scale(.97);}
`;
  return __pageStylesCache;
}
