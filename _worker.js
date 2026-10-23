/* ============================================================
 * MineTrakt —— Cloudflare Workers 单文件影视追踪 PWA
 * ============================================================
 *
 * 功能：Trakt 追剧面板（继续观看 / 待看 / 日历 / 记录 / 搜索），
 *      叠加 TMDB 评分、OMDB 评分、豆瓣榜单、平台剧场、骨朵热榜。
 *
 * 环境：
 *   变量 TRAKT_CLIENT_ID（必填）、TMDB_API_KEY、OMDB_API_KEY（可选）
 *   绑定 KV 命名空间 TMDB_CACHE
 *
 * 路由：
 *   /                  启动页，按登录态跳 /home 或 /login
 *   /login             登录页（Trakt 设备码）
 *   /home              首页
 *   /api/home-data     首页数据分片
 *   /api/*             其余数据接口
 *   /app.js /app.css   前端静态资源
 *   /sw.js             Service Worker
 *   /auth/*            登录 / 登出 / 轮询
 *
 * 认证：
 *   Trakt OAuth 设备码 → Cookie(trakt_auth) 存 token + trakt_id。
 *
 * 缓存：
 *   三级：进程内存 Map → KV(TMDB_CACHE) → 上游，统一走 cachedJSON()。
 *   · force=1 绕过缓存；失败回退旧 KV，绝不写脏数据
 *   · 上游 429 时按用户标记冷却期
 *
 * v205 修订：
 *   · 修复并发拉取数据超时导致残缺数据写入 KV 的问题
 *   · 修复多端显示条数不一致的问题
 *   · 优化 UI 细节（顶部间距、移除日历多余按钮等）
 *
 * v206 修订（本轮）：
 *   · 「继续观看」弹窗改用与待看列表一致的 grid 卡片渲染
 *     （桌面竖版海报网格 / 手机紧凑列表，带移除进度、弃看剧集按钮）
 *   · 平台剧场卡片 logo 放大（手机 46→60px，桌面 56→76px）
 *   · 代码清理：删除未引用的 renderHomeShell / enrichOne、
 *     死样式 .cw-modal-list 块与 .cal-open-btn.wl-added 规则
 *   · 代码合并：__escShowCal / __sumEsc 统一并入 __esc；
 *     客户端 10 处重复的「POST + 错误解析」抽为 __traktPost()
 *   · 全文 Prettier 格式化，补全函数注释与分区横幅
 *   · 刷新按钮只强刷 Trakt 数据（playback/meta/history），
 *     豆瓣/热榜/平台/评分一律走缓存到期自动更新；提示文案同步更正
 *   · 全站提示文案统一风格：成功「已+动作」、失败「动作+失败」、
 *     确认弹窗统一「确定要…吗？」句式、空态错误统一「加载失败，请稍后重试」
 *   · 新增只读诊断接口 GET /api/activity-sig（?force=1 可绕过签名缓存），
 *     用于验证「暂停进度自动更新」的签名比对是否生效
 *   · 详情页/整季列表的「已看/未看」角标接入活跃签名：
 *     有新观看活动时打开详情页即绕过观看进度缓存，无需等 30 分钟缓存过期
 * ============================================================ */

const TRAKT_AUTH = "https://auth.trakt.tv",
  TRAKT_API = "https://api.trakt.tv",
  TMDB_API = "https://api.themoviedb.org/3",
  TMDB_IMG = "https://image.tmdb.org/t/p",
  ACTIVATE_URL = "https://trakt.tv/activate",
  OMDB_API = "https://www.omdbapi.com",
  DOUBAN_SEARCH = "https://search.douban.com/movie/subject_search",
  DOUBAN_API = "https://widget.v2too.top/data/douban.json",
  THEATER_API = "https://widget.v2too.top/data/theater.json",
  GUDUO_API = "https://widget.v2too.top/data/guduo.json";

const APP_NAME = "MineTrakt",
  APP_SHORT_NAME = "MineTrakt",
  THEME_COLOR = "#050505";

/* 主题系统：三态（dark / light / system） */
const THEME_STORAGE_KEY = "mt:theme",
  THEME_COLOR_DARK = "#050505",
  THEME_COLOR_LIGHT = "#ffffff";

/* 主题启动脚本 —— 必须内联在 <head> 最前面、同步执行，避免 FOUC */
const THEME_BOOT_SCRIPT = `<script>(function(){try{var K=${JSON.stringify(THEME_STORAGE_KEY)};var t=localStorage.getItem(K);if(t!=='light'&&t!=='dark'&&t!=='system')t='dark';var d=document.documentElement;d.setAttribute('data-theme',t);var dark=(t==='dark')||(t==='system'&&(!window.matchMedia||matchMedia('(prefers-color-scheme: dark)').matches));var c=dark?${JSON.stringify(THEME_COLOR_DARK)}:${JSON.stringify(THEME_COLOR_LIGHT)};var tc=document.querySelector('meta[name="theme-color"]');if(tc)tc.setAttribute('content',c);var cs=document.querySelector('meta[name="color-scheme"]');if(cs)cs.setAttribute('content',dark?'dark':'light');var sb=document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');if(sb)sb.setAttribute('content',dark?'black-translucent':'default');d.style.backgroundColor=c;}catch(e){}})();<\/script>`;

const FAVICON_URL = "/assets/favicon.ico",
  ICON_192 = "/assets/icon-192.png",
  ICON_512 = "/assets/icon-512.png",
  APPLE_ICON = "/assets/icon-512.png",
  SPLASH_LOGO = "/assets/logo.png";

/* 静态资源回源映射 */
const ASSET_ORIGINS = {
  "/assets/favicon.ico": ["https://i.ibb.co/s9tgxVhb/Mine-Trakt-icon-32x32.png", "image/png"],
  "/assets/icon-192.png": ["https://i.ibb.co/wZ2Z8Gkj/Mine-Trakt-logo-192x192.png", "image/png"],
  "/assets/icon-512.png": ["https://i.ibb.co/Xx8q97CH/Mine-Trakt-logo-512x512.png", "image/png"],
  "/assets/logo.png": ["https://i.ibb.co/0jsGWrwK/Mine-Trakt-logo.png", "image/png"],
};

/* Trakt UA：伪装成常见桌面 Chrome。 */

/* ============================================================
 * 一、全局配置与基础工具
 * ============================================================ */
function chromeMajorForUA() {
  const ANCHOR_MAJOR = 120;
  const ANCHOR_MS = Date.UTC(2023, 11, 1);
  const weeks = Math.floor((Date.now() - ANCHOR_MS) / (7 * 86400 * 1000));
  return Math.max(ANCHOR_MAJOR, ANCHOR_MAJOR + Math.floor(weeks / 4) - 3);
}

const TRAKT_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajorForUA()}.0.0.0 Safari/537.36`;

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": TRAKT_UA,
};

/* Cookie 配置 */
const COOKIE_NAME = "trakt_auth",
  COOKIE_MAX_AGE = 60 * 60 * 24 * 90,
  PROFILE_COOKIE = "trakt_profile";

/* 各类数据的 KV 逻辑 TTL（秒） */
const PAGE_SIZE = 20,
  TMDB_KV_TTL = 86400 * 7,
  OMDB_KV_TTL = 86400 * 7,
  WATCHLIST_PAGE_SIZE = 30,
  WATCHLIST_KV_TTL = 3600,
  CALENDAR_KV_TTL = 3600,
  TREND_KV_TTL = 21600,
  MISS_KV_TTL = 300,
  HISTORY_KV_TTL = 5400,
  PLAYBACK_KV_TTL = 5400,
  STATS_KV_TTL = 3600,
  PROFILE_KV_TTL = 7200,
  ENTITY_KV_TTL = 86400,
  SEASON_KV_TTL = 86400,
  DOUBAN_KV_TTL = 86400,
  THEATER_KV_TTL = 86400,
  GUDUO_KV_TTL = 86400,
  PLATFORM_KV_TTL = 86400;

/* KV 物理保留策略 */
const KV_STALE_RETENTION = 86400 * 7,
  LAST_GOOD_KV_TTL = 86400 * 7;

const HOME_AUTO_REFRESH_MINUTES = 10;

/* 全局版本号 */
const APP_VERSION = "206";
const APP_JS_VERSION = APP_VERSION;
const APP_CSS_VERSION = APP_VERSION;

const CC_API = "public, max-age=1800, stale-while-revalidate=600";
const CC_NO_STORE = "no-store";
const CT_JSON = "application/json; charset=utf-8";
const CT_HTML = "text/html; charset=utf-8";

const CACHE_USER_LONG = {
  missTtl: 60,
  swr: true,
  unwrap: true,
  edgeTtl: 300,
  jitter: 300,
};
const CACHE_USER_META = {
  missTtl: 180,
  swr: true,
  edgeTtl: 300,
  jitter: 300,
};

/** 构造 JSON Response（统一 Content-Type 与缓存头） */
function jsonResp(data, headers, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign(
      { "Content-Type": CT_JSON, "Cache-Control": CC_NO_STORE },
      headers || {},
    ),
  });
}

/** Cloudflare 边缘缓存（caches API）包装，带 SWR 语义 */
async function edgeCached(request, ctx, ttlSec, fn) {
  if (request.method !== "GET") return fn();
  let cache = null;
  try {
    cache = caches.default;
  } catch {
    return fn();
  }
  if (!cache) return fn();

  const url = new URL(request.url);
  const bypass = url.searchParams.get("force") === "1";
  const keyUrl = new URL(url.toString());
  keyUrl.searchParams.delete("force");
  const cacheKey = new Request(keyUrl.toString(), { method: "GET" });

  if (!bypass) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    } catch {}
  }

  const resp = await fn();
  if (resp && resp.ok && ctx && typeof ctx.waitUntil === "function" && resp.status === 200) {
    try {
      const clone = resp.clone();
      const h = new Headers(clone.headers);
      h.set("Cache-Control", `public, max-age=${ttlSec}`);
      ctx.waitUntil(cache.put(cacheKey, new Response(clone.body, { status: 200, headers: h })));
    } catch {}
  }
  return resp;
}

const __enrichHits = new Map();
const __enrichBucketMem = new Map();
/** 判断当前请求是否允许触发 enrich 补数据（带冷却防止刷接口） */
function allowEnrich(request) {
  const ip =
    request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  const now = Date.now();
  const arr = (__enrichHits.get(ip) || []).filter((t) => now - t < 60000);
  if (arr.length >= 20) {
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
  playback: (u) => `pb:${u}`,
  stats: (u) => `stats:${u}`,
  profile: (u) => `prof:${u}:me`,
  history: (u, p = 1) => `hist:${u}:p${p}`,
  calendar: (u, day) => `cal:${u}:${day}`,
  watchProgress: (u, id) => `tpr:${u}:${id}`,
  movieHistory: (u, id) => `tmh:${u}:${id}`,
  showPlayback: (u, id) => `spb:${u}:${id}`,
  watchedEpisodes: (u) => `we:${u}`,
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
  trend: (p) => `trend:day:${p}`,
  tmdb: (p) => `td:${p}`,
  douban: "douban:v1:all",
  theater: "theater:v1:all",
  guduo: "guduo:v1:all",
  platform: (id, page, media) => `plat:${id}:${media}:p${page}`,
  platformPreviews: "plat:pv:v1",
  uidRt: (rt) => `uid:rt:${rt}`,
  uidAt: (at) => `uid:at:${at}`,
  moreHistory: (u, p) => `more:hist:${u}:p${p}`,
  morePlayback: (u, p, l) => `more:pb:${u}:p${p}:l${l}`,
  lastGood: {
    playback: (u) => `lg:pb:${u}`,
    history: (u, p = 1) => `lg:hist:${u}:p${p}`,
    calendar: (u) => `lg:cal:${u}`,
    watchlist: (u, s = "added") => `lg:wl:${u}:${s}`,
  },
};

/** 带超时控制的 fetch 封装 */
async function fetchT(url, opts = {}, ms = 8000) {
  if (TRAKT_HOST_RE.test(url)) await traktGate();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const backoff = (i, base = 500, jitter = 500) => sleep(base * (i + 1) + Math.random() * jitter);

const TRAKT_HOST_RE = /^https?:\/\/api\.trakt\.tv\//i;

const TRAKT_MIN_GAP_MS = 1100;
const TRAKT_GAP_MAX_WAIT_MS = 20000;

let __traktTail = Promise.resolve(),
  __traktLast = 0;


/* ============================================================
 * 二、Trakt 上游限流（防 429）
 * ============================================================ */
function traktGate() {
  const prev = __traktTail;
  let release;
  __traktTail = new Promise((r) => (release = r));
  return prev.then(async () => {
    const wait = __traktLast + TRAKT_MIN_GAP_MS - Date.now();
    try {
      if (wait > 0) await sleep(Math.min(wait, TRAKT_GAP_MAX_WAIT_MS));
    } finally {
      __traktLast = Date.now();
      release();
    }
  });
}

const TRAKT_RATE_LIMIT_COOLDOWN = 60000;
const TRAKT_RATE_LIMIT_MAX_COOLDOWN = 300000;

const __traktRateLimitByUser = new Map();
const __traktStrikes = new Map();

/** 查询该用户是否正处于 Trakt 冷却期 */
function isTraktRateLimited(userKey) {
  const k = userKey || "__anon__";
  const until = __traktRateLimitByUser.get(k) || 0;
  return Date.now() < until;
}

/** 计算冷却期剩余毫秒数 */
function traktRateLimitedRemaining(userKey) {
  const k = userKey || "__anon__";
  const until = __traktRateLimitByUser.get(k) || 0;
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

/** 标记进入 Trakt 冷却期 */
function markTraktRateLimited(ms, userKey) {
  const k = userKey || "__anon__";
  const strikes = (__traktStrikes.get(k) || 0) + 1;
  __traktStrikes.set(k, strikes);
  const exp = Math.min(
    TRAKT_RATE_LIMIT_MAX_COOLDOWN,
    TRAKT_RATE_LIMIT_COOLDOWN * Math.pow(2, strikes - 1),
  );
  const wait = Math.max(exp, Math.min(Number(ms) || 0, TRAKT_RATE_LIMIT_MAX_COOLDOWN));
  const until = Date.now() + wait;
  const cur = __traktRateLimitByUser.get(k) || 0;
  if (until > cur) __traktRateLimitByUser.set(k, until);

  if (__traktRateLimitByUser.size > 500) {
    const now = Date.now();
    for (const [key, v] of __traktRateLimitByUser) {
      if (v < now) __traktRateLimitByUser.delete(key);
    }
  }
  if (__traktStrikes.size > 500) {
    for (const key of __traktStrikes.keys()) {
      if (!__traktRateLimitByUser.has(key)) __traktStrikes.delete(key);
    }
  }
  return wait;
}

/** 清除限流计数（成功请求后调用） */
function clearTraktStrikes(userKey) {
  const k = userKey || "__anon__";
  if (__traktStrikes.size && __traktStrikes.has(k)) __traktStrikes.delete(k);
}

/** 解析上游 Retry-After 响应头并标记冷却 */
function consumeRetryAfter(r, userKey) {
  const ra = parseInt(r.headers.get("Retry-After") || "", 10);
  const waitMs =
    Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, TRAKT_RATE_LIMIT_MAX_COOLDOWN) : 0;
  return markTraktRateLimited(waitMs, userKey);
}

/** Trakt API 统一请求入口：伪装 UA、限流检查、429 处理 */
async function traktFetch(
  url,
  headers,
  { retries = 2, timeout = 12000, userKey, wantPageCount = false, backoffBase = 500 } = {},
) {
  const errShape = wantPageCount ? { __pageCount: 1 } : {};

  if (isTraktRateLimited(userKey)) {
    return {
      __error: "429 rate limited",
      __cooling: traktRateLimitedRemaining(userKey),
      ...errShape,
    };
  }

  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetchT(url, { headers }, timeout);

      if (r.status === 429) {
        consumeRetryAfter(r, userKey);
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

const traktGet = (url, headers, retries = 2, userKey) =>
  traktFetch(url, headers, { retries, timeout: 12000, userKey });

const KV_MEM_TTL = 1800000,
  KV_EDGE_TTL = 1800,
  KV_MISS = Symbol("kv-miss"),
  KV_ERR = Symbol("kv-err"),
  KV_MIN_PUT_TTL = 30,
  KV_DOWN_COOLDOWN_MS = 30000;

const KV_MIN_PUT_INTERVAL_MS = 3600000;
const LAST_GOOD_MIN_PUT_INTERVAL_MS = 7 * 24 * 3600000;
const ENRICH_BUCKETS = 4;
const ENRICH_BUCKET_TTL = 86400 * 30;
const ENRICH_BUCKET_MAX = 500;
const ENRICH_BATCH_MAX = 20;
const ENRICH_BUCKET_MEM_TTL = 120000;
const DEFAULT_JITTER_SEC = 600;
const __KV_LASTPUT_MAX = 5000;

const __kvLastPut = new Map();
const __kvMem = new Map(),
  __kvMemExp = new Map(),
  __kvInflight = new Map();
const __kvMemStale = new Map();
const STALE_MAX_AGE = 3600000;


/* ============================================================
 * 三、三级缓存：进程内存 → KV → 上游
 * ============================================================ */
function kvMemStaleSet(key, data, dataTs) {
  __kvMemStale.set(key, {
    data,
    ts: Date.now(),
    _ts: dataTs != null ? dataTs : Date.now(),
  });
  if (__kvMemStale.size > 3000) {
    const it = __kvMemStale.keys();
    for (let i = 0; i < 800; i++) {
      const k = it.next().value;
      if (k) __kvMemStale.delete(k);
    }
  }
}

/** 进程内 stale 缓存读取 */
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

/** KV 是否处于不可用状态 */
function kvIsDown() {
  return Date.now() < __kvDownUntil;
}
/** 标记 KV 不可用 */
function kvMarkDown() {
  __kvDownUntil = Date.now() + KV_DOWN_COOLDOWN_MS;
}
/** 标记 KV 恢复可用 */
function kvMarkUp() {
  __kvDownUntil = 0;
}

/** 进程内存缓存读取（带 TTL） */
function kvMemGet(key) {
  const exp = __kvMemExp.get(key);
  if (exp === undefined) return undefined;
  if (exp < Date.now()) {
    __kvMem.delete(key);
    __kvMemExp.delete(key);
    return undefined;
  }
  return __kvMem.get(key);
}

/** 进程内存缓存写入（简易容量上限） */
function kvMemSet(key, val, ttlMs) {
  __kvMem.set(key, val);
  __kvMemExp.set(key, Date.now() + (ttlMs || KV_MEM_TTL));
  if (__kvMem.size > 4000) {
    const now = Date.now();
    for (const [k, t] of __kvMemExp) {
      if (t < now) {
        __kvMem.delete(k);
        __kvMemExp.delete(k);
      }
    }
    if (__kvMem.size > 4000) {
      let i = 0;
      for (const k of __kvMem.keys()) {
        __kvMem.delete(k);
        __kvMemExp.delete(k);
        if (++i >= 800) break;
      }
    }
  }
}

/** 并发去重：同一 key 同时只放行一个回源任务，其余共享结果 */
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

/** KV JSON 读取：内存层 → KV → 失败回退 stale 缓存 */
async function kvGetJSON(env, key, memOnly, edgeTtl, missTtl) {
  if (memOnly) return undefined;
  if (!env.TMDB_CACHE || kvIsDown()) return KV_ERR;
  try {
    const v = await env.TMDB_CACHE.get(key, {
      type: "json",
      cacheTtl: edgeTtl || KV_EDGE_TTL,
    });
    kvMarkUp();
    return v === null || v === undefined ? KV_MISS : v;
  } catch {
    kvMarkDown();
    return KV_ERR;
  }
}

/** KV JSON 写入：同时写内存层与 KV，出错时保留旧值（不写脏数据） */
function kvPutJSON(env, ctx, key, payload, ttl, memOnly, force, staleRetention) {
  const memMs =
    payload && payload.miss
      ? 30000
      : ttl
        ? Math.min(KV_MEM_TTL, Math.max(5000, ttl * 1000))
        : KV_MEM_TTL;

  if (payload && typeof payload === "object" && payload !== KV_MISS && !payload._ts)
    payload._ts = Date.now();

  kvMemSet(key, payload, memMs);
  if (memOnly) return;
  if (!env.TMDB_CACHE || kvIsDown()) return;
  if (ttl != null && ttl < KV_MIN_PUT_TTL) return;

  const now = Date.now();
  const lastPut = __kvLastPut.get(key) || 0;
  const minGap = force ? 10 * 1000 : KV_MIN_PUT_INTERVAL_MS;
  if (lastPut && now - lastPut < minGap) return;
  __kvLastPut.set(key, now);

  if (__kvLastPut.size > __KV_LASTPUT_MAX) {
    const it = __kvLastPut.keys();
    for (let i = 0; i < 1000; i++) {
      const k = it.next().value;
      if (k) __kvLastPut.delete(k);
    }
  }

  const logicalTtl = ttl || 60;
  const staleRet = staleRetention != null ? staleRetention : KV_STALE_RETENTION;
  const body = payload && typeof payload === "object" ? { ...payload, _ttl: logicalTtl } : payload;

  const p = env.TMDB_CACHE.put(key, JSON.stringify(body), {
    expirationTtl: Math.min(86400 * 30, Math.max(60, logicalTtl + staleRet)),
  })
    .then(() => kvMarkUp())
    .catch(() => {
      kvMarkDown();
    });

  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
}

/** 判断缓存中取出的内容是否为错误负载 */
function __isErrorPayload(d) {
  if (d === null || d === undefined || d === false) return true;
  if (typeof d === "object" && d) {
    if (d.__error) return true;
    if (d.__cooling != null && d.data === undefined && !Array.isArray(d)) return true;
  }
  return false;
}

/** 按 key 生成稳定随机抖动秒数，防止缓存集中过期（雪崩） */
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

/** 三级缓存核心：进程内存 → KV → 上游；支持 force、SWR、失败回退 */
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
    edgeTtl,
    jitter,
    userKey,
    bypass = false,
    preserveTs = false,
    sourceTracker = null,
    lastGoodKey = null,
    revalidate = true,
    staleRetention = null,
  } = {},
) {
  const jitterSec = stableJitter(key, jitter != null ? jitter : DEFAULT_JITTER_SEC);
  const effectiveTtl = ttl + jitterSec;
  const softAge = swr === true ? Math.floor(ttl * 0.5) : typeof swr === "number" ? swr : 0;

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

  function __stableStr(v) {
    if (v === undefined) return "null";
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(__stableStr).join(",") + "]";
    const ks = Object.keys(v).sort();
    return "{" + ks.map((k) => JSON.stringify(k) + ":" + __stableStr(v[k])).join(",") + "}";
  }

  async function prevRawForTs(prevHint) {
    if (prevHint && typeof prevHint === "object" && prevHint._ts) return prevHint;
    const mem = kvMemGet(key);
    if (mem !== undefined && mem !== KV_MISS && mem && mem._ts) return mem;
    return null;
  }

  async function writeFresh(data, { force = false, memOnlyOverride = null, prevHint = null } = {}) {
    const prev = await prevRawForTs(prevHint);
    const unchanged = !!(prev && prev._ts && __stableStr(prev.data) === __stableStr(data));
    const wts = unchanged ? prev._ts : Date.now();

    kvPutJSON(
      env,
      ctx,
      key,
      { data, _ts: wts },
      effectiveTtl,
      memOnlyOverride != null ? memOnlyOverride : memOnly,
      force,
    );
    kvMemStaleSet(key, data, wts);
    writeLastGood(data);
    return unchanged ? Math.max(0, Math.round((Date.now() - wts) / 1000)) : 0;
  }

  function tryOldNormal() {
    const mem = kvMemGet(key);
    if (mem !== undefined && mem !== KV_MISS && !mem.miss) {
      const v = unwrapVal(mem);
      if (!__isErrorPayload(v)) {
        markSource(true, mem);
        return { found: true, val: v, raw: mem };
      }
    }
    const st = kvMemStaleGet(key);
    if (st && st.data !== undefined && !__isErrorPayload(st.data)) {
      markSource(true, { _ts: st._ts });
      return { found: true, val: st.data, raw: null, ts: st._ts };
    }
    return { found: false };
  }

  async function tryLastGood() {
    if (!lastGoodKey || !env || !env.TMDB_CACHE || kvIsDown()) return { found: false };
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
    const last = __kvLastPut.get(guardKey) || 0;
    if (last && now - last < LAST_GOOD_MIN_PUT_INTERVAL_MS) return;
    __kvLastPut.set(guardKey, now);
    kvPutJSON(env, ctx, lastGoodKey, { data }, LAST_GOOD_KV_TTL, false);
  }

  async function fallbackChain() {
    const old = tryOldNormal();
    if (old.found) {
      if (old.raw && old.raw !== KV_MISS) kvMemSet(key, old.raw, KV_MEM_TTL);
      else if (old.val != null) {
        kvMemSet(key, { data: old.val, _ts: old.ts || Date.now() }, KV_MEM_TTL);
        kvMemStaleSet(key, old.val, old.ts);
      }
      return { found: true, val: old.val };
    }

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
            kvMemSet(key, memPayload, KV_MEM_TTL);
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
      kvMemSet(key, memPayload, KV_MEM_TTL);
      kvMemStaleSet(key, lg.val, (lg.raw && lg.raw._ts) || undefined);
      markSource(true, lg.raw || null);
      return { found: true, val: lg.val };
    }
    return { found: false };
  }

  if (bypass) {
    return singleFlight("force:" + key, async () => {
      let data = null;
      try {
        data = await fetcher();
      } catch {
        data = null;
      }
      if (data && (data.__error || data.__cooling != null)) data = null;
      if (!__isErrorPayload(data)) {
        const liveAge = await writeFresh(data, { force: true });
        markSource(false, null, liveAge);
        return unwrap ? data : { data };
      }

      const fb = await fallbackChain();
      if (fb.found) return unwrap ? fb.val : { data: fb.val };
      markSource(null, null);
      return null;
    });
  }

  function needRefresh(cached) {
    if (!cached || cached === KV_MISS || cached.miss || !cached._ts) return false;
    const age = ageSec(cached);
    if (age > effectiveTtl) return true;
    if (softAge > 0 && age > softAge) return true;
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

  const mem = kvMemGet(key);
  if (mem !== undefined) {
    if (mem === KV_MISS) {
      const lg = await tryLastGood();
      if (lg.found) {
        kvMemSet(key, { data: lg.val, _ts: (lg.raw && lg.raw._ts) || Date.now() }, KV_MEM_TTL);
        kvMemStaleSet(key, lg.val, (lg.raw && lg.raw._ts) || undefined);
        markSource(true, lg.raw || null);
        return unwrap ? lg.val : { data: lg.val };
      }
      markSource(null, null);
      return null;
    }
    if (revalidate && needRefresh(mem)) scheduleRefresh(mem);
    markSource(true, mem);
    if (unwrap) return unwrapVal(mem);
    return mem;
  }

  return singleFlight(key, async () => {
    const cached = await kvGetJSON(env, key, memOnly, edgeTtl, missTtl);
    if (cached !== undefined && cached !== KV_MISS && cached !== KV_ERR) {
      if (!__isErrorPayload(unwrapVal(cached))) {
        kvMemStaleSet(key, unwrapVal(cached), (cached && cached._ts) || undefined);
      }
      if (revalidate && needRefresh(cached)) {
        scheduleRefresh(cached);
      }
      markSource(true, cached);
      if (unwrap) return unwrapVal(cached);
      return cached;
    }

    const kvBroken = cached === KV_ERR || cached === undefined;
    let data = null;
    try {
      data = await fetcher();
    } catch {
      data = null;
    }
    if (data && (data.__error || data.__cooling != null)) data = null;

    if (!__isErrorPayload(data)) {
      const liveAge = await writeFresh(data, {
        memOnlyOverride: memOnly || kvBroken,
        prevHint: cached !== undefined && cached !== KV_MISS && cached !== KV_ERR ? cached : null,
      });
      markSource(false, null, liveAge);
      return unwrap ? data : { data };
    }

    const fb = await fallbackChain();
    if (fb.found) return unwrap ? fb.val : { data: fb.val };

    if (!memOnly && missTtl >= KV_MIN_PUT_TTL) {
      kvPutJSON(env, ctx, key, { miss: 1, _ts: Date.now() }, missTtl, false);
    }
    markSource(null, null);
    return null;
  });
}

const SW_JS_CONTENT = String.raw`
const VERSION = "v${APP_VERSION}";
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

/* ============================================================
 * 四、Cache API 与导航请求 SWR
 * ============================================================ */
function getCache(name) {
  if (!__cachePs[name]) __cachePs[name] = caches.open(name);
  return __cachePs[name];
}

/** 启动页（/）导航请求的 SWR 处理 */
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

/** HTML 导航请求：网络优先，失败回退缓存 */
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

/** 通用 SWR 请求处理（后台刷新 + 返回旧值） */
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

    if (path.startsWith("/assets/")) return handleAsset(path, ctx);
    if (path === "/app.css") return handleAppCss();
    if (path === "/app.js") return handleAppJs(request);
    if (path === "/favicon.ico") return Response.redirect(FAVICON_URL, 302);
    if (path === "/avatar") return handleAvatar(request, ctx);
    if (path === "/manifest.webmanifest") return handleManifest();
    if (path === "/sw.js") return handleServiceWorker();

    if (path === "/auth/device") return handleDevice(env);
    if (path === "/auth/poll" && request.method === "POST") return handlePoll(request, env, ctx);
    if (path === "/auth/logout" && request.method === "POST")
      return handleLogout(request, env, ctx);

    if (path === "/api/more") return handleMore(request, env, ctx);
    if (path === "/api/season") return handleSeason(request, env, ctx);
    if (path === "/api/detail") return handleApiDetail(request, env, ctx);
    if (path === "/api/detail-extras") return handleDetailExtras(request, env, ctx);
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
    if (path === "/api/douban-list")
      return edgeCached(request, ctx, 600, () => handleDoubanList(request, env, ctx));
    if (path === "/api/theater-list")
      return edgeCached(request, ctx, 600, () => handleTheaterList(request, env, ctx));
    if (path === "/api/guduo-list")
      return edgeCached(request, ctx, 600, () => handleGuduoList(request, env, ctx));
    if (path === "/api/platform-list")
      return edgeCached(request, ctx, 900, () => handlePlatformList(request, env, ctx));

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
    if (path === "/api/show-calendar") return handleShowCalendar(request, env, ctx);
    if (path === "/api/home-data") return handleHomeData(request, env, ctx);
    if (path === "/api/activity-sig") return handleActivitySig(request, env, ctx);
    if (path === "/api/summary") return handleSummary(request, env, ctx);
    if (path === "/api/app-version") return handleAppVersion();
    if (path === "/api/auth-status") return handleAuthStatus(request);

    if (path === "/login") return handleLogin(request, env, ctx);
    if (path === "/home") return handleHome(request, env, ctx);
    if (path === "/" || path === "") return handleLaunch(request, env, ctx);

    return handleHome(request, env, ctx);
  },
};


/* ============================================================
 * 五、静态资源与基础路由
 * ============================================================ */
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
      headers: { "User-Agent": TRAKT_UA, Referer: "https://trakt.tv/" },
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

/** /assets/*：图标等静态资源回源映射 */
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
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(cache.put(cacheKey, r.clone()));
    return r;
  } catch {
    return new Response("", { status: 502 });
  }
}

/** /app.css：前端样式响应（带版本号与缓存） */
function handleAppCss() {
  return new Response(pageStyles(), {
    headers: {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: `"css-v${APP_CSS_VERSION}"`,
    },
  });
}

/** /app.js：前端脚本响应 */
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

/** /manifest.json：PWA manifest */
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

/** /app-version：版本号查询接口 */
function handleAppVersion() {
  return new Response(JSON.stringify({ js: APP_JS_VERSION, css: APP_CSS_VERSION }), {
    headers: {
      "Content-Type": CT_JSON,
      "Cache-Control": CC_NO_STORE,
    },
  });
}

/** /sw.js：Service Worker 响应 */
function handleServiceWorker() {
  return new Response(SW_JS_CONTENT, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}


/* ============================================================
 * 六、认证与登录（Trakt 设备码 OAuth）
 * ============================================================ */
async function requireAuth(request, env) {
  const cookieAuth = readAuth(request);
  if (!cookieAuth) return { ok: false };
  const auth = await refreshIfNeeded(cookieAuth, env);
  if (!auth) return { ok: false };
  return {
    ok: true,
    auth,
    headers: makeTraktHeaders(env, auth),
    needsCookieUpdate:
      auth.access_token !== cookieAuth.access_token ||
      auth.trakt_id !== (cookieAuth.trakt_id || null),
  };
}

/** 认证 + 回源 + 缓存的统一包装（绝大多数 /api/* 的入口） */
async function authed(request, env, ctx, { html: wantHtml = false, strict = false } = {}) {
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
      a.auth.refresh_token ? String(a.auth.refresh_token) : String(a.auth.access_token),
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

/** 把上游错误码/信息转换为用户友好的中文提示 */
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
    not_found_on_trakt: "Trakt 上暂时没有对应条目，可能是新片或中文内容尚未同步",
  };
  if (map[s]) return map[s];

  if (/Cloudflare|cf-mitigated|error code:\s*1015/i.test(s)) {
    if (cooling != null && cooling > 0)
      return `被 Cloudflare 拦截，本地冷却中，约 ${cooling} 秒后再试（期间显示缓存）`;
    return "被 Cloudflare 拦截，请稍后再试（当前已用缓存数据）";
  }
  if (/^429|rate\s*limit|限流/i.test(s)) {
    if (cooling != null && cooling > 0)
      return `Trakt 官方限流，本地冷却中，约 ${cooling} 秒后再试（期间显示缓存，无需反复刷新）`;
    return "Trakt 官方限流，请稍后再试（当前已用缓存数据）";
  }
  if (/^HTTP\s*401/i.test(s)) return "登录已过期，请重新登录";
  if (/^HTTP\s*403/i.test(s)) return "没有权限执行此操作";
  if (/^HTTP\s*404/i.test(s)) return "未找到对应内容";
  if (/^HTTP\s*429/i.test(s)) {
    if (cooling != null && cooling > 0)
      return `Trakt 官方限流，本地冷却中，约 ${cooling} 秒后再试（期间显示缓存，无需反复刷新）`;
    return "Trakt 官方限流，请稍后再试（当前已用缓存数据）";
  }
  if (/^HTTP\s*5\d{2}/i.test(s))
    return "Trakt 服务暂时不可用（5xx），请稍后重试（当前可能显示缓存）";
  if (/network|fetch|abort|timeout|网络/i.test(s)) return "网络连接失败，请检查网络后重试";
  if (/[\u4e00-\u9fff]/.test(s) && s.length > 4) return s;
  return s || "操作失败，请稍后重试";
}

/** 401 JSON 响应 */
function unauthorizedJson() {
  return Response.json(
    { error: humanizeApiError("unauthorized") },
    {
      status: 401,
      headers: { "Set-Cookie": clearCookieHeader() },
    },
  );
}

/** 401 时重定向到登录页的 HTML 响应 */
function unauthorizedHtml() {
  return new Response(humanizeApiError("unauthorized"), {
    status: 401,
    headers: { "Set-Cookie": clearCookieHeader() },
  });
}

/** 带认证副作用的 JSON 响应（必要时刷新 Cookie） */
function authJson(auth, needsCookieUpdate, data, status = 200) {
  const headers = { "Content-Type": CT_JSON };
  if (needsCookieUpdate && auth) headers["Set-Cookie"] = buildCookie(auth, auth.trakt_id);
  if (data && typeof data === "object" && data.error != null) {
    data = {
      ...data,
      error: humanizeApiError(data.error, { cooling: data.cooling }),
    };
  }
  return new Response(JSON.stringify(data), { status, headers });
}

/** 带认证副作用的任意类型响应 */
function authResp(
  auth,
  needsCookieUpdate,
  body,
  { status = 200, contentType = "text/html; charset=utf-8", extra = {} } = {},
) {
  const h = { "Content-Type": contentType, ...extra };
  if (needsCookieUpdate && auth) h["Set-Cookie"] = buildCookie(auth, auth.trakt_id);
  return new Response(body, { status, headers: h });
}

/** 安全解析请求 JSON body（带大小限制） */
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

/** Trakt /sync 写操作代理：标记已看、加入待看等 */
async function traktSyncAction(
  request,
  env,
  ctx,
  { allowedTypes, idField = "id", buildPayload, endpoint, timeout = 10000, afterOk },
) {
  const A = await authed(request, env, ctx);
  if (!A.ok) return A.response;
  const { auth, headers, needsCookieUpdate } = A;

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
  if (!payload) return authJson(auth, needsCookieUpdate, { error: "bad params" }, 400);

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
    );
  } catch (e) {
    return authJson(auth, needsCookieUpdate, { error: String(e) }, 502);
  }

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    const payload = { error: "HTTP " + r.status, detail: text };
    if (r.status === 429) {
      const ra = parseInt(r.headers.get("Retry-After") || "", 10);
      const waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 0;
      const xrl = r.headers.get("X-Ratelimit") || r.headers.get("x-ratelimit") || "";
      const cfMit = r.headers.get("cf-mitigated") || "";
      let source = "unknown";
      if (xrl) source = "trakt";
      else if (cfMit) source = "cloudflare";
      else if (/error code:\s*1015/i.test(text) || /cf-ray/i.test(text)) source = "cloudflare";
      else source = "trakt";

      let uk = null;
      try {
        uk = await getStableUserId(auth, headers, env, ctx).catch(() => null);
      } catch {}
      const cooling = Math.ceil(
        markTraktRateLimited(waitMs, uk || auth.refresh_token || auth.access_token) / 1000,
      );
      payload.cooling = cooling;
      payload.source = source;
      payload.ratelimit = xrl || null;
      payload.cfMitigated = cfMit || null;
      if (source === "cloudflare") {
        payload.error = "被 Cloudflare 拦截（429），不是操作太勤，请稍后再试";
      } else {
        payload.error = "Trakt 官方限流（429），请等待冷却后再试，期间会显示缓存";
      }
    }
    return authJson(auth, needsCookieUpdate, payload, r.status);
  }

  if (typeof afterOk === "function") await afterOk(auth, headers, env, ctx, body);
  const result = await r.json().catch(() => null);
  return authJson(auth, needsCookieUpdate, { ok: true, result });
}

/** /auth/device：发起 Trakt 设备码登录 */
async function handleDevice(env) {
  const codeVerifier = randomString(64),
    codeChallenge = await pkceChallenge(codeVerifier);

  let res;
  try {
    res = await fetchT(
      `${TRAKT_AUTH}/oauth/device/code`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          client_id: env.TRAKT_CLIENT_ID,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
        }),
      },
      10000,
    );
  } catch (e) {
    return Response.json({ error: "网络请求失败，请稍后重试" }, { status: 502 });
  }

  if (!res.ok) {
    const errText = await res.text();

    if (res.status === 429) {
      const ra = parseInt(res.headers.get("Retry-After") || "", 10);
      const waitSec = Number.isFinite(ra) && ra > 0 ? Math.min(ra, 180) : 30;
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

    return Response.json({ error: "Trakt 服务暂时不可用，请稍后重试" }, { status: 502 });
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

/** /auth/poll：轮询设备码授权状态 */
async function handlePoll(request, env, ctx) {
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
        headers: JSON_HEADERS,
        body: JSON.stringify({
          code: decoded.device_code,
          client_id: env.TRAKT_CLIENT_ID,
          code_verifier: decoded.code_verifier,
        }),
      },
      10000,
    );
  } catch (e) {
    return Response.json({ status: "network_error", detail: String(e) }, { status: 502 });
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
        fetchT(`${TRAKT_API}/users/me/stats`, { headers }, 8000).catch(() => null),
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
          env.TMDB_CACHE.put(CK.profile(userKey), JSON.stringify({ data: meProfile, _ts: nowTs }), {
            expirationTtl: typeof PROFILE_KV_TTL === "number" ? PROFILE_KV_TTL : 86400,
          }).catch(() => {}),
        );
        kvMemSet(CK.profile(userKey), { data: meProfile, _ts: nowTs }, KV_MEM_TTL);
      }
      if (meStats) {
        puts.push(
          env.TMDB_CACHE.put(CK.stats(userKey), JSON.stringify({ data: meStats, _ts: nowTs }), {
            expirationTtl: typeof STATS_KV_TTL === "number" ? STATS_KV_TTL : 86400,
          }).catch(() => {}),
        );
        kvMemSet(CK.stats(userKey), { data: meStats, _ts: nowTs }, KV_MEM_TTL);
      }
    }
    if (rt) kvMemSet(CK.uidRt(rt.slice(0, 32)), traktId, KV_MEM_TTL);
    if (at) kvMemSet(CK.uidAt(at.slice(0, 24)), traktId, KV_MEM_TTL);

    try {
      const pbKey = CK.playback(userKey);
      __kvMem.delete(pbKey);
      __kvMemExp.delete(pbKey);
    } catch {}

    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(Promise.all(puts));
    else Promise.all(puts).catch(() => {});

    const cookieHeaders = [buildCookie(auth, traktId)];
    try {
      const avatarUrl = pickAvatar(meProfile).url;
      const displayName = (meProfile && (meProfile.name || meProfile.username)) || "";
      if (displayName || avatarUrl)
        cookieHeaders.push(buildProfileCookie({ name: displayName, avatar: avatarUrl }));
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

  if (err === "authorization_pending" || err === "slow_down") {
    return Response.json({ status: err }, { status: 202 });
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
    return Response.json(
      { status: "rate_limited", message: "Trakt 授权轮询被限流，请稍后再试" },
      { status: 429 },
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

/** /auth/logout：登出并清除 Cookie */
async function handleLogout(request, env, ctx) {
  try {
    const cookieAuth = readAuth(request);
    if (cookieAuth && env) {
      const auth = (await refreshIfNeeded(cookieAuth, env).catch(() => null)) || cookieAuth;
      const headers = makeTraktHeaders(env, auth);
      const userKey = await getStableUserId(auth, headers, env, ctx).catch(() => null);

      if (userKey && userKey !== "anon" && env.TMDB_CACHE) {
        const fixedKeys = [
          CK.profile(userKey),
          CK.playback(userKey),
          CK.stats(userKey),
          CK.history(userKey, 1),
          CK.watchlistVersion(userKey),
        ];
        const p = Promise.all(fixedKeys.map((k) => env.TMDB_CACHE.delete(k).catch(() => {})));
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

/** 构造 trakt_auth Cookie（token + trakt_id） */
function buildCookie(auth, traktId) {
  const payload = {
    access_token: auth.access_token,
    refresh_token: auth.refresh_token,
    expires_at: auth.expires_at,
    code_verifier: auth.code_verifier,
    trakt_id: traktId ? String(traktId) : auth.trakt_id ? String(auth.trakt_id) : null,
  };
  return `${COOKIE_NAME}=${b64urlEncode(JSON.stringify(payload))}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`;
}

/** 从 Cookie 解析登录态 */
function readAuth(request) {
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!m) return null;
  try {
    const auth = JSON.parse(b64urlDecode(m[1]));
    if (auth && !("trakt_id" in auth)) auth.trakt_id = null;
    return auth;
  } catch {
    return null;
  }
}

/** access_token 过期时自动用 refresh_token 换新 */
async function refreshIfNeeded(auth, env) {
  if (auth.expires_at - Date.now() > 30 * 60_000) return auth;

  let res;
  try {
    res = await fetchT(
      `${TRAKT_AUTH}/oauth/token`,
      {
        method: "POST",
        headers: JSON_HEADERS,
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
    return null;
  }
  if (!res.ok) return null;

  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    code_verifier: auth.code_verifier,
    trakt_id: auth.trakt_id || null,
  };
}

/** 构造 Trakt API 请求头（client_id + UA + token） */
function makeTraktHeaders(env, auth) {
  return {
    "Content-Type": "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": env.TRAKT_CLIENT_ID,
    Authorization: `Bearer ${auth.access_token}`,
    "User-Agent": TRAKT_UA,
  };
}


/* ============================================================
 * 七、用户标识与用户级缓存
 * ============================================================ */
async function getStableUserId(auth, headers, env, ctx, { strict = false } = {}) {
  if (!auth) return strict ? null : "anon";
  if (auth.trakt_id) return String(auth.trakt_id);

  const rt = auth.refresh_token ? String(auth.refresh_token) : "";
  const at = auth.access_token ? String(auth.access_token) : "";
  const memKey = rt ? CK.uidRt(rt.slice(0, 32)) : CK.uidAt(at.slice(0, 24));

  const memCached = kvMemGet(memKey);
  if (memCached !== undefined && memCached !== KV_MISS && memCached) return String(memCached);

  if (env && env.TMDB_CACHE) {
    try {
      const raw = await env.TMDB_CACHE.get(memKey, {
        type: "json",
        cacheTtl: 600,
      });
      kvMarkUp();
      if (raw != null) {
        const uid = String(typeof raw === "object" && raw.data != null ? raw.data : raw);
        if (uid && uid !== "null" && uid !== "undefined") {
          kvMemSet(memKey, uid, KV_MEM_TTL);
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

  try {
    const r = await fetchT(`${TRAKT_API}/users/me`, { headers }, 8000);
    if (r.ok) {
      const me = await r.json();
      const ids = me && me.ids ? me.ids : {};
      let uid = null;
      if (ids.trakt != null && ids.trakt !== "") uid = String(ids.trakt);
      else if (ids.slug) uid = "s:" + String(ids.slug);

      if (uid) {
        kvMemSet(memKey, uid, KV_MEM_TTL);
        if (env && env.TMDB_CACHE) {
          const putP = env.TMDB_CACHE.put(memKey, JSON.stringify({ data: uid, _ts: Date.now() }), {
            expirationTtl: 60 * 60 * 24 * 90,
          }).catch(() => {});
          if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(putP);
        }
        return uid;
      }
    } else if (r.status === 429) {
      consumeRetryAfter(r, rt || at);
      if (strict) return null;
    } else if (r.status === 401 || r.status === 403) {
      if (strict) return null;
    }
  } catch {}

  if (strict) return null;

  const userId = rt ? "r" + rt.slice(0, 20) : at ? "a" + at.slice(0, 16) : "anon";
  kvMemSet(memKey, userId, KV_MEM_TTL);
  return userId;
}

/** 记录 trakt_id → 用户名/头像的映射 */
function rememberTraktUserId(auth, traktId) {
  if (!auth || !traktId) return;
  const id = String(traktId);
  const rt = auth.refresh_token ? String(auth.refresh_token) : "";
  const at = auth.access_token ? String(auth.access_token) : "";
  if (rt) kvMemSet(CK.uidRt(rt.slice(0, 32)), id, KV_MEM_TTL);
  if (at) kvMemSet(CK.uidAt(at.slice(0, 24)), id, KV_MEM_TTL);
}

/** 生成清除 Cookie 的 Set-Cookie 头 */
function clearCookieHeader() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

/** 读取资料缓存（昵称/头像），用于首页首屏 */
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

/** 从候选列表里挑选第一个可用的头像地址 */
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

/** 构造资料 hint Cookie */
function buildProfileCookie(profile) {
  const data = { name: profile.name || "", avatar: profile.avatar || "" };
  return `${PROFILE_COOKIE}=${b64urlEncode(JSON.stringify(data))}; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`;
}

/** 读取 watchlist 数据版本号（增量刷新用） */
async function getWatchlistVersion(env, ctx, userKey) {
  if (!userKey) return "0";
  const key = CK.watchlistVersion(userKey);
  if (!env || !env.TMDB_CACHE || kvIsDown()) return "0";
  try {
    const raw = await env.TMDB_CACHE.get(key, {
      type: "json",
      cacheTtl: KV_EDGE_TTL,
    });
    kvMarkUp();
    if (raw == null) return "0";
    const v = String(typeof raw === "object" && raw.data != null ? raw.data : raw);
    return v || "0";
  } catch {
    kvMarkDown();
    return "0";
  }
}

/** 写操作后失效 watchlist 相关缓存 */
function invalidateWatchlistCache(env, ctx, userKey) {
  if (userKey) {
    const verKey = CK.watchlistVersion(userKey);
    __kvMem.delete(verKey);
    __kvMemExp.delete(verKey);
    const base = `wl:${userKey}:`;
    for (const k of [...__kvMem.keys()]) {
      if (k.startsWith(base) || k.startsWith(`wlids:${userKey}:`)) {
        __kvMem.delete(k);
        __kvMemExp.delete(k);
      }
    }
  } else {
    for (const k of [...__kvMem.keys()]) {
      if (k.startsWith("wl:") || k.startsWith("wlids:") || k.startsWith("wlv:")) {
        __kvMem.delete(k);
        __kvMemExp.delete(k);
      }
    }
  }

  if (env && env.TMDB_CACHE && userKey) {
    const verKey = CK.watchlistVersion(userKey);
    const bump = (async () => {
      let cur = 0;
      if (!kvIsDown()) {
        try {
          const raw = await env.TMDB_CACHE.get(verKey, { type: "json" });
          if (raw != null) {
            const n = typeof raw === "object" && raw.data != null ? Number(raw.data) : Number(raw);
            if (Number.isFinite(n)) cur = n;
          }
          kvMarkUp();
        } catch {
          kvMarkDown();
        }
      }
      const next = String(cur + 1);
      const payload = { data: next, _ts: Date.now(), _ttl: 86400 * 30 };
      kvMemSet(verKey, payload, KV_MEM_TTL);
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
    else bump.catch(() => {});
  }
}

/** 枚举某用户的所有缓存 key */
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
      `we:${userKey}:`,
      `cwh:${userKey}`,
      `prof:${userKey}`,
      `cal:${userKey}`,
      `act:${userKey}`,
      `pbi:${userKey}`,
    ],
  };
}

/** 写操作后清空该用户首页相关缓存 */
function bustHomeUserCaches(userKey, env, ctx) {
  if (!userKey) return;
  const { exact, prefix } = userCacheKeys(userKey);

  for (const k of [...__kvMem.keys()]) {
    if (exact.includes(k) || prefix.some((p) => k.startsWith(p))) {
      __kvMem.delete(k);
      __kvMemExp.delete(k);
    }
  }
  for (const k of [...__kvLastPut.keys()]) {
    if (exact.includes(k) || prefix.some((p) => k.startsWith(p))) {
      __kvLastPut.delete(k);
    }
  }
  for (const k of exact) {
    __kvLastPut.delete(k);
    __kvLastPut.delete("lgput:" + k);
  }

  if (env && env.TMDB_CACHE) {
    const fixedKeys = [
      CK.playback(userKey),
      CK.stats(userKey),
      CK.history(userKey, 1),
      CK.lastGood.history(userKey, 1),
      CK.lastGood.playback(userKey),
      CK.moreHistory(userKey, 1),
      CK.moreHistory(userKey, 2),
      CK.moreHistory(userKey, 3),
      CK.morePlayback(userKey, 1, 20),
      CK.morePlayback(userKey, 1, 30),
      CK.watchedEpisodes(userKey),
      CK.cwHide(userKey),
    ];
    const p = Promise.all(fixedKeys.map((k) => env.TMDB_CACHE.delete(k).catch(() => {})));
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
    else p.catch(() => {});
  }
}

/** 并发受限执行器：限制同时回源的任务数并加间隔 */
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


/* ============================================================
 * 八、TMDB 数据访问
 * ============================================================ */
async function tmdbGet(url) {
  try {
    const r = await fetchT(url, {}, 8000);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/** 拼接 TMDB 图片 URL */
function tmdbUrl(path, env, extra = {}) {
  const sep = path.includes("?") ? "&" : "?";
  const q = new URLSearchParams({
    language: "zh-CN",
    api_key: env.TMDB_API_KEY,
    ...extra,
  });
  return `${TMDB_API}${path}${sep}${q}`;
}

/** TMDB 详情查询（带缓存） */
async function tmdbDetailCached(path, env, ctx, ttl = 86400) {
  if (!env.TMDB_API_KEY) return null;
  return cachedJSON(env, ctx, CK.tmdb(path), () => tmdbGet(tmdbUrl(path, env)), {
    ttl,
    missTtl: MISS_KV_TTL,
    swr: Math.min(3600, Math.floor(ttl * 0.4)),
    edgeTtl: 900,
    jitter: 200,
  });
}

/** TMDB 海报（竖版）URL */
function tmdbPoster(path, size = "w185") {
  return path ? `${TMDB_IMG}/${size}${path}` : null;
}

/** 拉取整季剧照并生成 season→still 映射 */
async function tmdbSeasonStillMap(tmdbId, season, env, ctx) {
  if (!env || !env.TMDB_API_KEY) return null;
  const sid = Number(tmdbId),
    sn = Number(season);
  if (!Number.isFinite(sid) || sid <= 0) return null;
  if (!Number.isFinite(sn) || sn < 0) return null;
  const data = await tmdbDetailCached(`/tv/${sid}/season/${sn}`, env, ctx, 86400 * 14);
  if (!data || !Array.isArray(data.episodes)) return null;
  const map = new Map();
  for (const ep of data.episodes) {
    if (ep && ep.episode_number != null && ep.still_path) {
      map.set(Number(ep.episode_number), tmdbPoster(ep.still_path, "w500"));
    }
  }
  return map;
}

/** 查询单集剧照 */
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
    86400 * 14,
  );
  if (data && data.still_path) return tmdbPoster(data.still_path, "w500");
  return null;
}

/** 查询剧集背景图 */
async function tmdbShowBackdrop(tmdbId, env, ctx, kind) {
  if (!env || !env.TMDB_API_KEY) return null;
  const sid = Number(tmdbId);
  if (!Number.isFinite(sid) || sid <= 0) return null;
  const primary = kind === "movie" ? "movie" : "tv";
  const other = primary === "movie" ? "tv" : "movie";
  const data = await tmdbDetailCached(`/${primary}/${sid}`, env, ctx, 86400 * 7);
  if (data && data.backdrop_path) return tmdbPoster(data.backdrop_path, "w780");
  const alt = await tmdbDetailCached(`/${other}/${sid}`, env, ctx, 86400 * 7);
  if (alt && alt.backdrop_path) return tmdbPoster(alt.backdrop_path, "w780");
  return null;
}

/** 查询 TMDB 中文标题 */
async function tmdbZhTitle(kind, tmdbId, env, ctx) {
  if (!env || !env.TMDB_API_KEY || !tmdbId) return null;
  const path = kind === "movie" ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
  const data = await tmdbDetailCached(path, env, ctx, 86400 * 7);
  if (!data) return null;
  return (data.name || data.title || "").trim() || null;
}

/** 从 KV 读取图片映射（剧照/背景/中文标题） */
async function loadImageMap(env, key) {
  let map = kvMemGet(key);
  if (map === KV_MISS || (map !== undefined && typeof map !== "object")) map = undefined;
  if (map !== undefined) return map;

  let raw = null;
  if (env && env.TMDB_CACHE && !kvIsDown()) {
    try {
      raw = await env.TMDB_CACHE.get(key, { type: "json", cacheTtl: 600 });
      kvMarkUp();
    } catch {
      kvMarkDown();
    }
  }
  const v = raw && raw.items !== undefined ? raw.items : raw;
  const out = v && typeof v === "object" ? v : {};
  kvMemSet(key, out, KV_MEM_TTL);
  return out;
}

/** 把图片映射批量写入 KV */
function saveImageMap(env, ctx, key, map, ttl) {
  const ks = Object.keys(map);
  if (ks.length > 400) {
    for (let i = 0; i < ks.length - 400; i++) delete map[ks[i]];
  }
  kvPutJSON(env, ctx, key, { items: map }, ttl || 1800, false);
}


/* ============================================================
 * 九、继续观看图片补全（剧照/背景/中文标题）
 * ============================================================ */
function pbImageKey(entry) {
  if (!entry) return null;
  if (entry.movie && entry.movie.ids && entry.movie.ids.trakt != null)
    return "m:" + entry.movie.ids.trakt;
  const show = entry.show;
  if (!show || !show.ids || show.ids.trakt == null) return null;
  const ep = entry.episode || (entry.progress && entry.progress.next_episode) || null;
  const s = ep ? (ep.season != null ? ep.season : ep.season_number) : "";
  const n = ep ? (ep.number != null ? ep.number : ep.episode_number) : "";
  return "s:" + show.ids.trakt + ":" + s + ":" + n;
}

/** 给继续观看条目附加剧照/背景图/中文标题 */
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

/** 合并「正在追的剧下一集」与「看到一半」两个继续观看来源 */
function mergeContinueLists(
  playbackList,
  upNextList,
  limit = 20,
  droppedIds = null,
  watchedEpIds = null,
  hideMap = null,
) {
  const seen = new Set();
  const out = [];
  const dropped =
    droppedIds instanceof Set
      ? droppedIds
      : droppedIds
        ? new Set([...droppedIds].map(Number))
        : null;
  const autoUnhide = new Set();

  function keyOf(entry) {
    if (!entry) return null;
    if (entry.movie && entry.movie.ids && entry.movie.ids.trakt != null)
      return "m:" + entry.movie.ids.trakt;
    const show = entry.show;
    if (!show || !show.ids || show.ids.trakt == null) return null;
    const ep = entry.episode || (entry.progress && entry.progress.next_episode) || null;
    if (ep) {
      const s = ep.season != null ? ep.season : ep.season_number;
      const n = ep.number != null ? ep.number : ep.episode_number;
      return "s:" + show.ids.trakt + ":" + s + ":" + n;
    }
    return "show:" + show.ids.trakt;
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
    if (!entry || !entry.progress || typeof entry.progress !== "object") return false;
    const completed = Number(entry.progress.completed);
    const aired = Number(entry.progress.aired);
    if (!Number.isFinite(completed) || !Number.isFinite(aired) || aired <= 0) return false;
    return completed >= aired;
  }

  function shouldSkip(entry) {
    if (!entry || entry.__error) return true;
    if (isDropped(entry)) return true;
    if (hideMap && isCwHiddenEntry(entry, hideMap)) return true;
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
    if (typeof entry.progress === "number" && isFinishedPlayback(entry)) return true;
    if (entry.progress && typeof entry.progress === "object") {
      if (isCaughtUp(entry)) return true;
      const completed = entry.progress.completed;
      if (typeof completed === "number" && completed <= 0) return true;
    }
    return false;
  }

  function pushList(list) {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      if (shouldSkip(entry)) continue;
      const k = keyOf(entry);
      if (k) {
        if (seen.has(k)) continue;
        seen.add(k);
      }
      if (entry && entry.__isRewatch) delete entry.__isRewatch;
      out.push(entry);
    }
  }

  pushList(playbackList);
  pushList(upNextList);

  out.sort((a, b) => {
    const ta = a.paused_at || a.last_watched_at || (a.progress && a.progress.last_watched_at) || "";
    const tb = b.paused_at || b.last_watched_at || (b.progress && b.progress.last_watched_at) || "";
    return String(tb).localeCompare(String(ta));
  });

  const result = out.slice(0, Math.max(1, limit | 0));
  if (autoUnhide.size) {
    Object.defineProperty(result, "__autoUnhide", {
      value: [...autoUnhide],
      enumerable: false,
    });
  }
  return result;
}

/** 结合观看历史标记重温（重看）条目 */
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
    const ep = entry.episode || (entry.progress && entry.progress.next_episode) || null;
    const id = ep && ep.ids && ep.ids.trakt;
    if (id != null && set.has(Number(id))) {
      entry.__isRewatch = true;
    }
  }
  return list;
}

/** 服务端批量给 playback 条目补图（分批、限额） */
async function attachContinueStillsForPlayback(list, env, ctx, userKey) {
  if (!env || !env.TMDB_API_KEY || !Array.isArray(list) || !list.length) return list;

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
      if (!applyPbImage(j, imgMap)) normalized.push(j);
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
    const season = ep ? (ep.season != null ? ep.season : ep.season_number) : null;
    const number = ep ? (ep.number != null ? ep.number : ep.episode_number) : null;
    const j = {
      entry,
      ep,
      tmdbId,
      season,
      number,
      kind: "tv",
      k: pbImageKey(entry),
    };
    if (!applyPbImage(j, imgMap)) normalized.push(j);
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
          let still = map && map.has(Number(j.number)) ? map.get(Number(j.number)) : null;
          if (!still) {
            still = await tmdbEpisodeStill(j.tmdbId, j.season, j.number, env, ctx);
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
        const zh = await tmdbZhTitle(j.kind === "movie" ? "movie" : "tv", j.tmdbId, env, ctx);
        if (zh) j.entry.__zhTitle = zh;
      } catch (_) {}
    }),
  );

  let dirty = false;
  for (const j of normalized) {
    if (!j.k) continue;
    const rec = {};
    if (j.entry.__stillUrl) rec.s = j.entry.__stillUrl;
    if (j.entry.__backdropUrl) rec.b = j.entry.__backdropUrl;
    if (j.entry.__zhTitle) rec.t = j.entry.__zhTitle;
    if (rec.s || rec.b || rec.t) {
      imgMap[j.k] = rec;
      dirty = true;
    }
  }
  if (dirty) saveImageMap(env, ctx, imgKey, imgMap);

  return list;
}

/** 给待看列表条目补图 */
async function attachWatchlistStills(list, env, ctx, userKey) {
  if (!env || !env.TMDB_API_KEY || !Array.isArray(list) || !list.length) return list;

  const imgKey = CK.wlImages(userKey || "anon");
  const imgMap = await loadImageMap(env, imgKey);

  const jobs = [];
  for (const item of list) {
    if (!item || !item.episode || !item.show) continue;
    if (item.__stillUrl || (item.episode && item.episode.__stillUrl)) continue;
    const ep = item.episode;
    const show = item.show;
    const tmdbId = show.ids && show.ids.tmdb;
    const season = ep.season != null ? ep.season : ep.season_number;
    const number = ep.number != null ? ep.number : ep.episode_number;
    if (!tmdbId || season == null || number == null) continue;
    const k = pbImageKey(item);
    if (k && imgMap[k] && imgMap[k].s) {
      item.__stillUrl = imgMap[k].s;
      if (ep) ep.__stillUrl = imgMap[k].s;
      continue;
    }
    jobs.push({ item, ep, tmdbId, season, number, k });
  }
  const batch = 6;
  let dirty = false;
  for (let i = 0; i < jobs.length; i += batch) {
    const slice = jobs.slice(i, i + batch);
    await Promise.all(
      slice.map(async (j) => {
        try {
          const url = await tmdbEpisodeStill(j.tmdbId, j.season, j.number, env, ctx);
          if (url) {
            j.item.__stillUrl = url;
            if (j.ep) j.ep.__stillUrl = url;
            if (j.k) {
              imgMap[j.k] = { s: url };
              dirty = true;
            }
          }
        } catch (_) {}
      }),
    );
  }

  if (dirty) saveImageMap(env, ctx, imgKey, imgMap);
  return list;
}

/** TMDB 条目 → 前端卡片数据结构 */
function mapTmdbItem(r, typeHint) {
  if (!r || !r.id) return null;
  const mt = typeHint || r.media_type;
  const isMovie = mt === "movie";
  if (mt !== "movie" && mt !== "tv" && mt !== "show") return null;
  const dateStr = r.release_date || r.first_air_date || "";
  return {
    type: isMovie ? "movie" : "show",
    tmdbId: r.id,
    title: isMovie ? r.title || r.original_title || "" : r.name || r.original_name || r.title || "",
    year: dateStr.slice(0, 4),
    date: dateStr,
    poster: r.poster_path ? tmdbPoster(r.poster_path) : null,
    overview: r.overview || "",
    popularity: r.popularity || 0,
  };
}


/* ============================================================
 * 十、豆瓣榜单
 * ============================================================ */
async function getDoubanRaw(env, ctx, force) {
  return cachedJSON(
    env,
    ctx,
    CK.douban,
    async () => {
      try {
        const r = await fetchT(DOUBAN_API, {}, 10000);
        if (!r.ok) return null;
        return await r.json();
      } catch {
        return null;
      }
    },
    {
      ttl: DOUBAN_KV_TTL,
      missTtl: 600,
      swr: force ? false : 57600,
      jitter: 300,
      bypass: !!force,
      revalidate: !!force,
    },
  );
}

/** 判断是否港台剧（按地区字段） */
function isHkTw(region) {
  if (!region) return false;
  return region.indexOf("香港") >= 0 || region.indexOf("台湾") >= 0;
}

/** 豆瓣原始条目 → 前端卡片数据结构 */
function mapDoubanItem(x) {
  if (!x || !x.tmdbId) return null;
  return {
    tmdbId: x.tmdbId,
    title: x.title || "",
    year: (x.releaseDate || "").slice(0, 4),
    poster: x.posterPath ? `https://image.tmdb.org/t/p/w342${x.posterPath}` : null,
    overview: x.description || "",
    rating: Number(x.rating) || 0,
    region: x.regionTitle || "",
    genre: x.genreTitle || "",
    kind: "tv",
  };
}

/** 汇总豆瓣各分区（国产/港台/日韩/欧美） */
function collectDoubanLists(data, keys) {
  const out = [];
  if (!data) return out;
  for (const k of keys) {
    const v = data[k];
    if (Array.isArray(v)) out.push(...v);
  }
  return out;
}

/** 按参数选取豆瓣分区 */
function pickDoubanSection(data, section, filter) {
  if (!data) return [];

  const typeFilter = filter || "all";
  let tvRaw = [];

  if (section === "domestic") tvRaw = collectDoubanLists(data, ["tv_domestic"]);
  else if (section === "hktw") {
    const all = Array.isArray(data.tv) ? data.tv : [];
    tvRaw = all.filter((x) => isHkTw(x.regionTitle));
  } else if (section === "jpkr") tvRaw = collectDoubanLists(data, ["tv_japanese", "tv_korean"]);
  else if (section === "western") tvRaw = collectDoubanLists(data, ["tv_american"]);
  else tvRaw = Array.isArray(data.tv) ? data.tv : [];

  let mvRaw = [];
  if (section === "domestic")
    mvRaw = collectDoubanLists(data, ["movie_domestic", "movies_domestic"]);
  else if (section === "hktw") {
    const all = collectDoubanLists(data, ["movies", "movie"]);
    mvRaw = all.filter((x) => isHkTw(x.regionTitle));
  } else if (section === "jpkr")
    mvRaw = collectDoubanLists(data, [
      "movie_japanese",
      "movie_korean",
      "movies_japanese",
      "movies_korean",
    ]);
  else if (section === "western")
    mvRaw = collectDoubanLists(data, ["movie_american", "movies_american"]);

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

/** 渲染豆瓣分区卡片列表（hscroll / grid 两模式） */
function renderDoubanItems(items) {
  if (!Array.isArray(items) || !items.length) return "";
  return items
    .map((x, i) => {
      const isMovie = x.kind === "movie";
      return mediaItem({
        poster: x.poster,
        tag: isMovie ? "电影" : "剧集",
        tagClass: isMovie ? "movie" : "episode",
        title: x.title,
        overview: x.overview,
        line1: x.year || "",
        line2: [x.region, x.genre].filter(Boolean).join(" · "),
        delay: Math.min(i, 24) * 20,
        detailType: isMovie ? "movie" : "show",
        detailId: "tmdb-" + x.tmdbId,
      });
    })
    .join("");
}

/** /api/douban-list：豆瓣榜单接口 */
async function handleDoubanList(request, env, ctx) {
  const url = new URL(request.url);
  const section = url.searchParams.get("section") || "domestic";
  const mode = url.searchParams.get("mode") || "grid";
  const filter = url.searchParams.get("filter") || "all";
  const force = url.searchParams.get("force") === "1";

  const data = await getDoubanRaw(env, ctx, force);
  const items = pickDoubanSection(data, section, filter);
  const html = renderDoubanItems(items);

  const outHeaders = {
    "Content-Type": CT_HTML,
    "Cache-Control": CC_API,
  };
  return listResp(html, mode, outHeaders);
}


/* ============================================================
 * 十一、平台剧场
 * ============================================================ */
async function getTheaterRaw(env, ctx, force) {
  return cachedJSON(
    env,
    ctx,
    CK.theater,
    async () => {
      try {
        const r = await fetchT(THEATER_API, {}, 10000);
        if (!r.ok) return null;
        return await r.json();
      } catch {
        return null;
      }
    },
    {
      ttl: THEATER_KV_TTL,
      missTtl: 600,
      swr: force ? false : 57600,
      jitter: 300,
      bypass: !!force,
      revalidate: !!force,
    },
  );
}

/** 汇总剧场条目（含平台归一化） */
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

/** 递归遍历 JSON 节点收集条目 */
function walkNode(node, platform, out) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const x of node) {
      if (x && typeof x === "object" && (x.tmdbId || x.tmdb_id || x.tmdbid)) {
        out.push({ ...x, __platform: platform });
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

/** 从标题/标签推断所属平台 */
function theaterPlatformOf(x) {
  if (!x) return "";
  if (x.__platform) return x.__platform === "玛卡巴卡的悬疑剧" ? "悬疑剧" : x.__platform;

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
      const s = c.trim();
      return s === "玛卡巴卡的悬疑剧" ? "悬疑剧" : s;
    }
  }
  return "";
}

/** 剧场平台列表 */
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

/** 按参数选取剧场分区 */
function pickTheaterSection(data, platform) {
  const list = collectTheaterItems(data);
  const filtered =
    !platform || platform === "all" ? list : list.filter((x) => theaterPlatformOf(x) === platform);

  const seen = new Set(),
    out = [];
  for (const x of filtered) {
    const tmdbId = x.tmdbId || x.tmdb_id || x.tmdbid;
    if (!tmdbId || seen.has(tmdbId)) continue;
    seen.add(tmdbId);
    out.push({
      tmdbId: tmdbId,
      title: x.title || x.name || x.showTitle || "",
      year: String(
        x.releaseDate || x.release_date || x.firstAirDate || x.year || x.date || "",
      ).slice(0, 4),
      poster:
        x.posterPath || x.poster_path
          ? `https://image.tmdb.org/t/p/w342${x.posterPath || x.poster_path}`
          : x.poster || x.cover || x.image || null,
      overview: x.description || x.overview || x.summary || "",
      platform: theaterPlatformOf(x),
      kind: x.type === "movie" || x.media_type === "movie" || x.isMovie === true ? "movie" : "tv",
    });
    if (out.length >= 200) break;
  }
  return out;
}

/** 渲染平台剧场卡片（hscroll / grid 两模式） */
function renderTheaterItems(items) {
  if (!Array.isArray(items) || !items.length) return "";
  return items
    .map((x, i) => {
      const isMovie = x.kind === "movie";
      return mediaItem({
        poster: x.poster,
        tag: isMovie ? "电影" : "剧集",
        tagClass: isMovie ? "movie" : "episode",
        title: x.title,
        overview: x.overview,
        line1: x.year || "",
        line2: x.platform || "",
        delay: Math.min(i, 24) * 20,
        detailType: isMovie ? "movie" : "show",
        detailId: "tmdb-" + x.tmdbId,
      });
    })
    .join("");
}

/** 构造列表类 JSON 响应 */
function listResp(html, mode, headers) {
  if (mode !== "hscroll") return new Response(html, { headers });
  if (!html)
    return new Response('<div class="h-scroll-empty"><span class="spinner"></span></div>', {
      headers,
    });
  return new Response(`<div class="h-scroll">${html}</div>`, { headers });
}

/** /api/theater-list：平台剧场接口 */
async function handleTheaterList(request, env, ctx) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") || "grid";
  const platform = url.searchParams.get("platform") || "all";
  const force = url.searchParams.get("force") === "1";

  const data = await getTheaterRaw(env, ctx, force);
  const outHeaders = {
    "Content-Type": CT_HTML,
    "Cache-Control": CC_API,
  };

  if (mode === "debug") {
    const summary = { type: typeof data, keys: [], sample: null, itemCount: 0 };
    if (data && typeof data === "object") {
      summary.keys = Object.keys(data);
      summary.sample = data;
      summary.itemCount = collectTheaterItems(data).length;
      summary.shape = {};
      for (const k of summary.keys) {
        const v = data[k];
        if (Array.isArray(v)) summary.shape[k] = "array[" + v.length + "]";
        else if (v && typeof v === "object")
          summary.shape[k] = "object{" + Object.keys(v).slice(0, 5).join(",") + "}";
        else summary.shape[k] = typeof v;
      }
      const first = collectTheaterItems(data)[0];
      summary.firstItem = first || null;
    }
    return new Response(JSON.stringify(summary).slice(0, 8000), {
      headers: {
        "Content-Type": CT_JSON,
        "Cache-Control": CC_NO_STORE,
      },
    });
  }

  if (mode === "platforms") {
    return new Response(JSON.stringify({ platforms: getTheaterPlatforms(data) }), {
      headers: {
        "Content-Type": CT_JSON,
        "Cache-Control": CC_API,
      },
    });
  }

  const html = renderTheaterItems(pickTheaterSection(data, platform));
  return listResp(html, mode, outHeaders);
}


/* ============================================================
 * 十二、骨朵热榜
 * ============================================================ */
async function getGuduoRaw(env, ctx, force) {
  return cachedJSON(
    env,
    ctx,
    CK.guduo,
    async () => {
      try {
        const r = await fetchT(GUDUO_API, {}, 10000);
        if (!r.ok) return null;
        return await r.json();
      } catch {
        return null;
      }
    },
    {
      ttl: GUDUO_KV_TTL,
      missTtl: 600,
      swr: force ? false : 57600,
      jitter: 300,
      bypass: !!force,
      revalidate: !!force,
    },
  );
}

const GUDUO_CATEGORIES = ["剧集", "电影", "动漫", "综艺"];

/** 骨朵原始条目 → 前端卡片数据结构 */
function mapGuduoItem(x) {
  if (!x || !x.tmdbId) return null;
  const isMovie = x.mediaType === "movie" || x.type === "movie" || x.category === "电影";
  return {
    tmdbId: x.tmdbId,
    title: x.title || "",
    year: String(x.releaseDate || x.year || "").slice(0, 4),
    poster: x.posterPath ? `https://image.tmdb.org/t/p/w342${x.posterPath}` : x.poster || null,
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

/** 按参数选取骨朵分区 */
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

/** 渲染骨朵热榜卡片（hscroll / grid 两模式） */
function renderGuduoItems(items) {
  if (!Array.isArray(items) || !items.length) return "";
  return items
    .map((x, i) => {
      const isMovie = x.kind === "movie";
      const tag = x.category || (isMovie ? "电影" : "剧集");
      const heatLine = x.heat ? `热度 ${x.heat}` : [x.region, x.genre].filter(Boolean).join(" · ");
      return mediaItem({
        poster: x.poster,
        tag: x.rank != null ? `#${x.rank}` : tag,
        tagClass: isMovie ? "movie" : "episode",
        title: x.title,
        overview: x.overview,
        line1: [x.year, tag].filter(Boolean).join(" · "),
        line2: heatLine,
        delay: Math.min(i, 24) * 20,
        detailType: isMovie ? "movie" : "show",
        detailId: "tmdb-" + x.tmdbId,
      });
    })
    .join("");
}

/** /api/guduo-list：骨朵热榜接口 */
async function handleGuduoList(request, env, ctx) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") || "grid";
  const category = url.searchParams.get("category") || "all";
  const force = url.searchParams.get("force") === "1";

  const data = await getGuduoRaw(env, ctx, force);
  const outHeaders = {
    "Content-Type": CT_HTML,
    "Cache-Control": CC_API,
  };

  if (mode === "debug") {
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
    const list = GUDUO_CATEGORIES.filter((k) => Array.isArray(cats[k]) && cats[k].length);
    return new Response(JSON.stringify({ categories: list }), {
      headers: {
        "Content-Type": CT_JSON,
        "Cache-Control": CC_API,
      },
    });
  }

  const html = renderGuduoItems(pickGuduoSection(data, category));
  return listResp(html, mode, outHeaders);
}

const PLATFORMS = {
  hbomax: {
    id: "hbomax",
    name: "HBO Max",
    region: "国外",
    logo: "https://picui.ogmua.cn/s1/2026/10/14/6acf1d2eaeb73.webp",
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


/* ============================================================
 * 十三、平台列表（TMDB discover 聚合）
 * ============================================================ */
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

/** 拉取 TMDB discover 按平台聚合内容 */
async function fetchPlatformDiscover(plat, media, page, env) {
  if (!env.TMDB_API_KEY || !plat) return { items: [], totalPages: 1 };

  const pageNum = Math.max(1, Math.min(20, page || 1));
  const wantMovie = media === "all" || media === "movie";
  const wantTv = media === "all" || media === "tv";
  const jobs = [];

  function baseParams(extra, mediaType) {
    const today = new Date().toISOString().slice(0, 10);
    const isMovie = mediaType === "movie";
    const sortBy = isMovie ? "primary_release_date.desc" : "first_air_date.desc";
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
        tmdbGet(tmdbUrl("/discover/tv", env, baseParams({ with_networks: netStr }, "tv"))).then(
          (d) => ({ media: "tv", data: d }),
        ),
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
      if (!item || !item.tmdbId || seen.has(item.type + ":" + item.tmdbId)) continue;
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

/** 加载平台卡片的预览海报（服务端预取） */
async function loadPlatformPreviews(env, ctx, force) {
  const cacheKey = CK.platformPreviews;

  if (!force) {
    const mem = kvMemGet(cacheKey);
    if (mem && mem.items && typeof mem.items === "object") return mem.items;
    const raw = await kvGetJSON(env, cacheKey, false, 900, 600);
    if (raw && raw !== KV_MISS && raw !== KV_ERR) {
      const v = raw.data !== undefined ? raw.data : raw;
      if (v && v.items && typeof v.items === "object") {
        kvMemSet(cacheKey, v, KV_MEM_TTL);
        return v.items;
      }
    }
  }

  const items = {};
  const queue = HOME_PLATFORM_IDS.filter((pid) => PLATFORMS[pid]);
  const worker = async () => {
    while (queue.length) {
      const pid = queue.shift();
      try {
        const r = await fetchPlatformDiscover(PLATFORMS[pid], "all", 1, env);
        items[pid] = (r.items || [])
          .filter((x) => x.poster)
          .slice(0, 5)
          .map((x) => x.poster.replace("/w185", "/w342"));
      } catch {
        items[pid] = [];
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker(), worker()]);

  const payload = { items };
  kvMemSet(cacheKey, payload, KV_MEM_TTL);
  kvPutJSON(env, ctx, cacheKey, payload, PLATFORM_KV_TTL, false, !!force);
  return items;
}

/** /api/platform-list：按平台分页列表 */
async function handlePlatformList(request, env, ctx) {
  const url = new URL(request.url);
  const id = (url.searchParams.get("id") || "").trim().toLowerCase();
  const mode = url.searchParams.get("mode") || "grid";
  const rawMedia = (url.searchParams.get("media") || "all").toLowerCase();
  const media = rawMedia === "movie" || rawMedia === "tv" ? rawMedia : "all";
  const force = url.searchParams.get("force") === "1";
  const page = Math.max(1, Math.min(5, parseInt(url.searchParams.get("page") || "1", 10) || 1));

  const outHeadersHtml = {
    "Content-Type": CT_HTML,
    "Cache-Control": CC_API,
  };
  const outHeadersJson = {
    "Content-Type": CT_JSON,
    "Cache-Control": CC_API,
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
          .map((x) => x.poster.replace("/w185", "/w342"));
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
      swr: force ? false : 57600,
      jitter: 300,
      edgeTtl: 900,
      bypass: !!force,
      revalidate: !!force,
    },
  );

  const list = data && Array.isArray(data.items) ? data.items : Array.isArray(data) ? data : [];
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


/* ============================================================
 * 十四、Trakt 写操作接口
 * ============================================================ */
function traktSyncPayload(kind, id) {
  const entry = { ids: { trakt: id } };
  if (kind === "movie") return { movies: [entry] };
  if (kind === "show") return { shows: [entry] };
  if (kind === "season") return { seasons: [entry] };
  if (kind === "episode") return { episodes: [entry] };
  return null;
}

/** TMDB id → Trakt id 解析 */
async function resolveTraktIdFromTmdb(tmdbId, type, headers, userKey) {
  if (!tmdbId) return null;
  const id = String(tmdbId).trim();
  if (!/^\d+$/.test(id)) return null;

  async function tryOnce(t) {
    const qs = t ? `?type=${t}` : "";
    const arr = await traktGet(`${TRAKT_API}/search/tmdb/${id}${qs}`, headers, 1, userKey);
    if (!Array.isArray(arr) || !arr.length) return null;

    const prefer = t === "movie" ? "movie" : t === "show" ? "show" : null;
    if (prefer && arr[0][prefer] && arr[0][prefer].ids && arr[0][prefer].ids.trakt) {
      return arr[0][prefer].ids.trakt;
    }
    for (const item of arr) {
      if (item.movie && item.movie.ids && item.movie.ids.trakt) return item.movie.ids.trakt;
      if (item.show && item.show.ids && item.show.ids.trakt) return item.show.ids.trakt;
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

/** OMDB 评分查询（IMDB 评分等） */
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

/** TMDB 预告片列表 */
async function fetchTmdbVideos(type, id, env, ctx) {
  if (!env.TMDB_API_KEY) return null;

  return cachedJSON(
    env,
    ctx,
    `tv:${type}:${id}`,
    async () => {
      const mk = (lang) =>
        `${TMDB_API}/${type}/${id}/videos?language=${lang}&api_key=${env.TMDB_API_KEY}`;

      const zhRes = await tmdbGet(mk("zh-CN"));
      const zhList = zhRes && Array.isArray(zhRes.results) ? zhRes.results : [];

      const hasZhPlayable = zhList.some(
        (v) => v && v.site === "YouTube" && v.key && (v.type === "Trailer" || v.type === "Teaser"),
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
      edgeTtl: 900,
      jitter: 200,
    },
  );
}

/** 媒体评分 → 颜色（绿/黄/红） */
function mcColor(n) {
  if (n >= 61) return "#66cc33";
  if (n >= 40) return "#ffcc33";
  return "#ff0000";
}

const RATING_LOGOS = {
  tmdb: `<svg class="ext-logo" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#01B4E4" d="M6.62 12a2.291 2.291 0 0 1 2.292-2.295h-.013A2.291 2.291 0 0 1 11.189 12a2.291 2.291 0 0 1-2.29 2.291h.013A2.291 2.291 0 0 1 6.62 12zm10.72-4.062h4.266a2.291 2.291 0 0 0 2.29-2.291 2.291 2.291 0 0 0-2.29-2.296H17.34a2.291 2.291 0 0 0-2.291 2.296 2.291 2.291 0 0 0 2.29 2.29zM2.688 20.645h8.285a2.291 2.291 0 0 0 2.291-2.292 2.291 2.291 0 0 0-2.29-2.295H2.687a2.291 2.291 0 0 0-2.291 2.295 2.291 2.291 0 0 0 2.29 2.292zm10.881-6.354h.81l1.894-4.586H15.19l-1.154 3.008h-.013l-1.135-3.008h-1.154zm4.208 0h1.011V9.705h-1.011zm2.878 0h3.235v-.93h-2.223v-.933h1.99v-.934h-1.99v-.855h2.107v-.934h-3.112zM1.31 7.941h1.01V4.247h1.31v-.895H0v.895h1.31zm3.747 0h1.011V5.959h1.958v1.984h1.011v-4.59h-1.01v1.711H6.061V3.351H5.057zm5.348 0h3.242v-.933H11.41v-.934h1.99v-.933h-1.99v-.856h2.107v-.934h-3.112zM.162 14.296h1.005v-3.52h.013l1.167 3.52h.765l1.206-3.52h.013v3.52h1.011v-4.59H3.82L2.755 12.7h-.013L1.686 9.705H.156zm14.534 6.353h1.641a3.188 3.188 0 0 0 .98-.149 2.531 2.531 0 0 0 .824-.437 2.123 2.123 0 0 0 .567-.713 2.193 2.193 0 0 0 .223-.983 2.399 2.399 0 0 0-.218-1.07 1.958 1.958 0 0 0-.586-.716 2.405 2.405 0 0 0-.873-.392 4.349 4.349 0 0 0-1.046-.13h-1.519zm1.013-3.656h.596a2.26 2.26 0 0 1 .606.08 1.514 1.514 0 0 1 .503.244 1.167 1.167 0 0 1 .34.412 1.28 1.28 0 0 1 .13.587 1.546 1.546 0 0 1-.13.658 1.127 1.127 0 0 1-.347.433 1.41 1.41 0 0 1-.518.238 2.797 2.797 0 0 1-.649.07h-.538zm4.686 3.656h1.88a2.997 2.997 0 0 0 .613-.064 1.735 1.735 0 0 0 .554-.214 1.221 1.221 0 0 0 .402-.39 1.105 1.105 0 0 0 .155-.606 1.188 1.188 0 0 0-.071-.415 1.01 1.01 0 0 0-.204-.34 1.087 1.087 0 0 0-.317-.24 1.297 1.297 0 0 0-.413-.13v-.012a1.203 1.203 0 0 0 .575-.366.962.962 0 0 0 .216-.648 1.081 1.081 0 0 0-.149-.603 1.022 1.022 0 0 0-.389-.354 1.673 1.673 0 0 0-.54-.169 4.463 4.463 0 0 0-.6-.041h-1.712zm1.011-3.734h.687a1.4 1.4 0 0 1 .24.022.748.748 0 0 1 .22.075.432.432 0 0 1 .16.147.418.418 0 0 1 .061.236.47.47 0 0 1-.055.233.433.433 0 0 1-.146.156.62.62 0 0 1-.204.084 1.058 1.058 0 0 1-.23.026h-.745zm0 1.835h.765a1.96 1.96 0 0 1 .266.02 1.015 1.015 0 0 1 .26.07.519.519 0 0 1 .204.152.406.406 0 0 1 .08.26.481.481 0 0 1-.06.253.519.519 0 0 1-.16.168.62.62 0 0 1-.217.09 1.155 1.155 0 0 1-.237.027H21.4z"/></svg>`,
  imdb: `<svg class="ext-logo" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#F5C518" d="M22.3781 0H1.6218C.7411.0583.0587.7437.0018 1.5953l-.001 20.783c.0585.8761.7125 1.543 1.5559 1.6191A.337.337 0 0 0 1.6016 24h20.7971a.4579.4579 0 0 0 .0437-.002c.8727-.0768 1.5568-.8271 1.5568-1.7085V1.7098c0-.8914-.696-1.6416-1.584-1.7078A.3294.3294 0 0 0 22.3781 0zm0 .496a1.2144 1.2144 0 0 1 1.1252 1.2139v20.5797c0 .6377-.4875 1.1602-1.1045 1.2145H1.6016c-.5967-.0543-1.0645-.5297-1.1053-1.1258V1.6284C.5371 1.0185 1.0184.5364 1.6217.496h20.7564zM4.7954 8.2603v7.3636H2.8899V8.2603h1.9055zm6.5367 0v7.3636H9.6707v-4.9704l-.6711 4.9704H7.813l-.6986-4.8618-.0066 4.8618h-1.668V8.2603h2.468c.0748.4476.1492.9694.2307 1.5734l.2712 1.8713.4407-3.4447h2.4817zm2.9772 1.3289c.0742.0404.122.108.1417.2034.0279.0953.0345.3118.0345.6442v2.8548c0 .4881-.0345.7867-.0955.8954-.0609.1152-.2304.1695-.5018.1695V9.5211c.204 0 .3457.0205.4211.0681zm-.0211 6.0347c.4543 0 .8006-.0265 1.0245-.0742.2304-.0477.4204-.1357.5694-.2648.1556-.1218.2642-.298.3251-.5219.0611-.2238.1021-.6648.1021-1.3224v-2.5832c0-.6986-.0271-1.1668-.0742-1.4039-.041-.237-.1431-.4543-.3126-.6437-.1695-.1973-.4198-.3324-.7456-.421-.3191-.0808-.8542-.1285-1.7694-.1285h-1.4244v7.3636h2.3051zm5.14-1.7827c0 .3523-.0199.5762-.0544.6708-.033.0947-.1894.1424-.3046.1424-.1086 0-.19-.0477-.2238-.1351-.041-.0887-.0609-.2986-.0609-.6238v-1.9469c0-.3324.0199-.5423.0543-.6237.0338-.0808.1086-.122.2171-.122.1153 0 .2709.0412.3114.1425.041.0947.0609.2986.0609.6032v1.8926zm-2.4747-5.5809v7.3636h1.7157l.1152-.4675c.1556.1894.3251.3324.5152.4271.1828.0881.4608.1357.678.1357.3047 0 .5629-.0748.7802-.237.2165-.1562.3589-.3462.4198-.5628.0543-.2173.0887-.543.0887-.9841v-2.0675c0-.4409-.0139-.7324-.0344-.8681-.0199-.1357-.0742-.2781-.1695-.4204-.1021-.1425-.2437-.251-.4272-.3325-.1834-.0742-.3999-.1152-.6576-.1152-.2172 0-.4952.0477-.6846.1285-.1835.0887-.353.2238-.5086.4007V8.2603h-1.8309z"/></svg>`,
  rt: `<svg class="ext-logo" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="#FA320A" d="M5.866 0L4.335 1.262l2.082 1.8c-2.629-.989-4.842 1.4-5.012 2.338 1.384-.323 2.24-.422 3.344-.335-7.042 4.634-4.978 13.148-1.434 16.094 5.784 4.612 13.77 3.202 17.91-1.316C27.26 13.363 22.993.65 10.86 2.766c.107-1.17.633-1.503 1.243-1.602-.89-1.493-3.67-.734-4.556 1.374C7.52 2.602 5.866 0 5.866 0zM4.422 7.217H6.9c2.673 0 2.898.012 3.55.202 1.06.307 1.868.973 2.313 1.904.05.106.092.206.13.305l7.623.008.027 2.912-2.745-.024v7.549l-2.982-.016v-7.522l-2.127.016a2.92 2.92 0 0 1-1.056 1.134c-.287.176-.3.19-.254.264.127.2 2.125 3.642 2.125 3.659l-3.39.019-2.013-3.376c-.034-.047-.122-.068-.344-.084l-.297-.02.037 3.48-3.075-.038zm3.016 2.288l.024.338c.014.186.024.729.024 1.206v.867l.582-.025c.32-.013.695-.049.833-.078.694-.146 1.048-.478 1.087-1.018.027-.378-.063-.636-.303-.87-.318-.309-.761-.416-1.733-.418Z"/></svg>`,
  mc: `<svg class="ext-logo" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="#FFFFFF" d="M11.99 0A12 12 0 1 0 24 12v-.014A12 12 0 0 0 11.99 0Zm-.055 2.564a9.399 9.399 0 0 1 9.407 9.389v.01a9.399 9.399 0 1 1-9.408-9.399Zm-1.61 17.198 2.046-2.046-3.94-3.94c-.165-.166-.345-.373-.442-.608-.221-.47-.318-1.203.221-1.742.664-.664 1.548-.387 2.406.47l3.788 3.788 2.046-2.046-3.954-3.954a2.48 2.48 0 0 1-.456-.622c-.263-.539-.25-1.216.235-1.7.677-.678 1.562-.429 2.544.553l3.677 3.677 2.046-2.046-3.982-3.982c-2.018-2.018-3.912-1.949-5.212-.65-.498.499-.802 1.024-.954 1.618a4.026 4.026 0 0 0-.055 1.686l-.027.028c-.996-.414-2.13-.166-3 .705-1.162 1.161-1.12 2.392-.982 3.11l-.042.043-1.009-.816-1.77 1.77a64.1 64.1 0 0 1 2.213 2.1z"/></svg>`,
  trakt: `<svg class="ext-logo" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="#ED1C24" d="m15.082 15.107-.73-.73 9.578-9.583a4.499 4.499 0 0 0-.115-.575L13.662 14.382l1.08 1.08-.73.73-1.81-1.81L23.422 3.144c-.075-.15-.155-.3-.25-.44L11.508 14.377l2.154 2.155-.73.73-7.193-7.199.73-.73 4.309 4.31L22.546 1.86A5.618 5.618 0 0 0 18.362 0H5.635A5.637 5.637 0 0 0 0 5.634V18.37A5.632 5.632 0 0 0 5.635 24h12.732C21.477 24 24 21.48 24 18.37V6.19l-8.913 8.918zm-4.314-2.155L6.814 8.988l.73-.73 3.954 3.96zm1.075-1.084-3.954-3.96.73-.73 3.959 3.96zm9.853 5.688a4.141 4.141 0 0 1-4.14 4.14H6.438a4.144 4.144 0 0 1-4.139-4.14V6.438A4.141 4.141 0 0 1 6.44 2.3h10.387v1.04H6.438c-1.71 0-3.099 1.39-3.099 3.1V17.55c0 1.71 1.39 3.105 3.1 3.105h11.117c1.71 0 3.1-1.395 3.1-3.105v-1.754h1.04v1.754z"/></svg>`,
  douban: `<svg class="ext-logo" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="#2D963D" d="M.51 3.06h22.98V.755H.51V3.06Zm20.976 2.537v9.608h-2.137l-1.669 5.76H24v2.28H0v-2.28h6.32l-1.67-5.76H2.515V5.597h18.972Zm-5.066 9.608H7.58l1.67 5.76h5.501l1.67-5.76ZM18.367 7.9H5.634v5.025h12.733V7.9Z"/></svg>`,
};

/** 渲染外部评分块（TMDB/OMDB 等） */
function renderExtRatings(r, opts = {}) {
  const out = [];

  if (r && r.imdb != null)
    out.push(
      `<span class="ext-rating ext-imdb" title="IMDb ${r.imdb.toFixed(1)}/10">${RATING_LOGOS.imdb}<span class="ext-score">${r.imdb.toFixed(1)}</span></span>`,
    );
  if (r && r.metacritic != null)
    out.push(
      `<span class="ext-rating ext-mc" title="Metacritic ${r.metacritic}/100">${RATING_LOGOS.mc}<span class="ext-score" style="color:${mcColor(r.metacritic)}">${r.metacritic}</span></span>`,
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

/** 拉取 Trakt 原始 watchlist */
async function fetchWatchlistRaw(headers, sort, userKey, debug) {
  const qs = `extended=full`;
  const [movies, shows, seasons, episodes] = await Promise.all([
    traktGet(`${TRAKT_API}/sync/watchlist/movies?${qs}`, headers, 1, userKey),
    traktGet(`${TRAKT_API}/sync/watchlist/shows?${qs}`, headers, 1, userKey),
    traktGet(`${TRAKT_API}/sync/watchlist/seasons?${qs}`, headers, 1, userKey),
    traktGet(`${TRAKT_API}/sync/watchlist/episodes?${qs}`, headers, 1, userKey),
  ]);

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
            String((b.movie && b.movie.title) || (b.show && b.show.title) || "").toLowerCase(),
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
      merged.sort((a, b) => (b.listed_at || "").localeCompare(a.listed_at || ""));
  }
  return merged;
}

/** 待看列表（Trakt + TMDB 合并、排序、缓存） */
async function getWatchlist(headers, sort = "added", env, ctx, userKey, force, sourceTracker) {
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
      edgeTtl: 300,
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
      const raw = await env.TMDB_CACHE.get(lgKey, {
        type: "json",
        cacheTtl: KV_EDGE_TTL,
      });
      kvMarkUp();
      if (raw != null) {
        const v = typeof raw === "object" && raw.data !== undefined ? raw.data : raw;
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

/** 待看列表的 TMDB id 集合 */
async function getWatchlistTmdbIds(headers, env, ctx, userKey, type) {
  const merged = await getWatchlist(headers, "added", env, ctx, userKey);
  if (!Array.isArray(merged)) return [];
  const ids = [];
  for (const x of merged) {
    const item = type === "movies" ? x.movie : x.show;
    if (item && item.ids && item.ids.tmdb) ids.push(item.ids.tmdb);
  }
  return ids;
}


/* ============================================================
 * 十五、搜索与趋势
 * ============================================================ */
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
  if (needsCookieUpdate) outHeaders["Set-Cookie"] = buildCookie(auth, auth.trakt_id);

  if (!q) return jsonResp({ items: [] }, outHeaders);
  if (!env.TMDB_API_KEY) return jsonResp({ items: [], error: "no tmdb key" }, outHeaders);

  const wantMovie = typeFilter === "all" || typeFilter === "movie";
  const wantShow = typeFilter === "all" || typeFilter === "show";

  const [movieRes, tvRes] = await Promise.all([
    wantMovie
      ? tmdbGet(tmdbUrl("/search/movie", env, { query: q, include_adult: "false" }))
      : Promise.resolve(null),
    wantShow
      ? tmdbGet(tmdbUrl("/search/tv", env, { query: q, include_adult: "false" }))
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

/** /api/trending：TMDB 今日趋势 */
async function handleTrending(request, env, ctx) {
  const A = await authed(request, env, ctx);
  if (!A.ok) return A.response;
  if (!env.TMDB_API_KEY) return Response.json({ items: [] });

  const url = new URL(request.url);
  const page = Math.max(1, Math.min(5, parseInt(url.searchParams.get("page") || "1", 10) || 1));

  const data = await cachedJSON(
    env,
    ctx,
    CK.trend(page),
    () => tmdbGet(tmdbUrl("/trending/all/day", env, { page })),
    {
      ttl: TREND_KV_TTL,
      missTtl: 600,
      swr: 3600,
      edgeTtl: 3600,
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
      "Cache-Control": "public, max-age=3600",
    },
  });
}


/* ============================================================
 * 十六、待看 / 已看写接口
 * ============================================================ */
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
  } catch (e) {
    return authJson(auth, needsCookieUpdate, { error: String(e) }, 502);
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

  invalidateWatchlistCache(env, ctx, userKey);
  const result = await r.json().catch(() => null);
  return authJson(auth, needsCookieUpdate, { ok: true, traktId, result });
}

/** POST /api/watchlist/remove：从待看移除 */
async function handleWatchlistRemove(request, env, ctx) {
  return traktSyncAction(request, env, ctx, {
    allowedTypes: ["movie", "show", "season", "episode"],
    endpoint: "/sync/watchlist/remove",
    buildPayload: (type, id) => traktSyncPayload(type, id),
    afterOk: async (auth, headers, env, ctx) => {
      const userKey = await getStableUserId(auth, headers, env, ctx);
      invalidateWatchlistCache(env, ctx, userKey);
    },
  });
}

/** POST /api/mark-watched：标记为已看 */
async function handleMarkWatched(request, env, ctx) {
  return traktSyncAction(request, env, ctx, {
    allowedTypes: ["movie", "episode"],
    endpoint: "/sync/history",
    buildPayload: (type, id) => traktSyncPayload(type, id),
    afterOk: async (auth, headers, env, ctx, body) => {
      const userKey = await getStableUserId(auth, headers, env, ctx);
      try {
        const type = body && body.type;
        const id = body && (body.id != null ? body.id : body.traktId);
        if ((type === "movie" || type === "episode") && id != null && Number(id) > 0) {
          await fetchT(
            `${TRAKT_API}/sync/playback/${type}/${Number(id)}`,
            { method: "DELETE", headers },
            6000,
          ).catch(() => null);
        }
      } catch {}
      bustHomeUserCaches(userKey, env, ctx);
    },
  });
}

/** POST /api/unmark-watched：取消观看记录 */
async function handleUnmarkWatched(request, env, ctx) {
  return traktSyncAction(request, env, ctx, {
    allowedTypes: ["movie", "episode"],
    endpoint: "/sync/history/remove",
    buildPayload: (type, id) => traktSyncPayload(type, id),
    afterOk: async (auth, headers, env, ctx) => {
      const userKey = await getStableUserId(auth, headers, env, ctx);
      bustHomeUserCaches(userKey, env, ctx);
    },
  });
}

/** POST /api/mark-season-watched：标记整季已看 */
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
    { ttl: SEASON_KV_TTL, missTtl: 60, swr: 3600, edgeTtl: 1800, jitter: 300 },
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
          { data: r, _ts: Date.now() },
          SEASON_KV_TTL,
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
          kvPutJSON(env, ctx, CK.season(showId, season), { data: found }, SEASON_KV_TTL, false);
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
  } catch (e) {
    return authJson(auth, needsCookieUpdate, { error: "网络错误：" + String(e) }, 502);
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
  bustHomeUserCaches(userKey, env, ctx);

  const seasonKey = CK.season(showId, season);
  __kvMem.delete(seasonKey);
  __kvMemExp.delete(seasonKey);
  if (env && env.TMDB_CACHE) {
    const p = env.TMDB_CACHE.delete(seasonKey).catch(() => {});
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
    else p.catch(() => {});
  }

  return authJson(auth, needsCookieUpdate, {
    ok: true,
    marked: episodes.length,
    result,
  });
}

/** POST /api/hide-continue：移除继续观看进度 */
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
  kvMemSet(CK.cwHide(userKey), { data: map, _ts: hideAt }, 86400 * 30 * 1000);
  putCwHideMap(env, ctx, userKey, map);

  if (userKey) {
    for (const k of [...__kvMem.keys()]) {
      if (
        k === CK.playback(userKey) ||
        k.startsWith(`pb:${userKey}`) ||
        k.startsWith(`more:pb:${userKey}`) ||
        k.startsWith(`spb:${userKey}`)
      ) {
        __kvMem.delete(k);
        __kvMemExp.delete(k);
      }
    }
    if (env && env.TMDB_CACHE) {
      const dels = [
        CK.playback(userKey),
        CK.morePlayback(userKey, 1, 20),
        CK.morePlayback(userKey, 1, 30),
      ].map((k) => env.TMDB_CACHE.delete(k).catch(() => {}));
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(Promise.all(dels));
      else Promise.all(dels).catch(() => {});
    }
  }

  return authJson(auth, needsCookieUpdate, {
    ok: true,
    showId,
    s,
    e,
    playbackRemoved,
  });
}

/** POST /api/drop-show：弃看剧集 */
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
  } catch (e) {
    return authJson(auth, needsCookieUpdate, { error: String(e) }, 502);
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

  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

  if (userKey) {
    const dropKey = `dropped:${userKey}`;
    const calKey = CK.calendar(userKey, today);
    let nextIds = [showId];
    try {
      const prev = kvMemGet(dropKey);
      const prevData = prev && prev !== KV_MISS && prev.data !== undefined ? prev.data : prev;
      if (prevData && Array.isArray(prevData.ids)) {
        nextIds = [...new Set(prevData.ids.map(Number).concat(showId))];
      }
    } catch {}

    for (const k of [...__kvMem.keys()]) {
      if (
        k === calKey ||
        k.startsWith(`cal:${userKey}:`) ||
        k.startsWith(`pb:${userKey}`) ||
        k.startsWith(`act:${userKey}`)
      ) {
        __kvMem.delete(k);
        __kvMemExp.delete(k);
      }
    }

    kvPutJSON(env, ctx, dropKey, { data: { ids: nextIds } }, 1800, false);
    __droppedShowIdsMem.set(dropKey, { ids: nextIds, ts: Date.now() });

    if (env && env.TMDB_CACHE) {
      const dels = [calKey, CK.playback(userKey), `act:${userKey}`].map((k) =>
        env.TMDB_CACHE.delete(k).catch(() => {}),
      );
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(Promise.all(dels));
      else Promise.all(dels).catch(() => {});
    }
  }

  bustHomeUserCaches(userKey, env, ctx);

  const added = result && result.added && result.added.shows ? result.added.shows : 0;
  return authJson(auth, needsCookieUpdate, { ok: true, added, result, showId });
}

/** /api/show-calendar：某剧播出日历 */
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
  if (!Array.isArray(seasons)) return Response.json({ error: "failed" }, { status: 502 });

  const zhTitles = {};
  let zhShowTitle = "";

  if (tmdbId && /^\d+$/.test(tmdbId) && env.TMDB_API_KEY) {
    try {
      const tmdbShow = await tmdbDetailCached(`/tv/${tmdbId}`, env, ctx);
      if (tmdbShow) {
        if (tmdbShow.name) zhShowTitle = tmdbShow.name;
        if (Array.isArray(tmdbShow.seasons)) {
          const realSeasons = tmdbShow.seasons.filter((s) => s.season_number > 0);
          const seasonDatas = [];
          for (const s of realSeasons) {
            seasonDatas.push(
              await tmdbDetailCached(`/tv/${tmdbId}/season/${s.season_number}`, env, ctx),
            );
            await sleep(30);
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

  return authResp(auth, needsCookieUpdate, JSON.stringify({ episodes, title: zhShowTitle }), {
    extra: { "Cache-Control": "public, max-age=600" },
    contentType: "application/json; charset=utf-8",
  });
}

/** /api/summary：观看小结统计 */
async function handleSummary(request, env, ctx) {
  const A = await authed(request, env, ctx, { strict: true });
  if (!A.ok) return A.response;
  const { auth, headers, needsCookieUpdate, userKey } = A;

  const url = new URL(request.url);
  const period = url.searchParams.get("period") === "year" ? "year" : "month";
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  let ref = (url.searchParams.get("ref") || "").trim();

  if (period === "month") {
    if (!/^\d{4}-\d{2}$/.test(ref)) ref = now.toISOString().slice(0, 7);
  } else {
    if (!/^\d{4}$/.test(ref)) ref = String(now.getUTCFullYear());
  }

  const cacheKey = `sum2:${userKey}:${period}:${ref}`;
  const data = await cachedJSON(
    env,
    ctx,
    cacheKey,
    () => buildSummary(headers, period, ref, env, ctx, userKey),
    {
      ttl: 21600,
      missTtl: 600,
      swr: 10800,
      memOnly: true,
      jitter: 600,
    },
  );

  return authJson(auth, needsCookieUpdate, data || { error: "empty" });
}

/** 计算小结的时间范围（月/年） */
function summaryRange(period, ref) {
  if (period === "year") {
    const y = ref;
    return {
      start: `${y}-01-01T00:00:00.000+08:00`,
      end: `${y}-12-31T23:59:59.999+08:00`,
      label: `${y} 年`,
    };
  }
  const [y, m] = ref.split("-");
  const lastDay = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  const mm = m.padStart(2, "0");
  return {
    start: `${y}-${mm}-01T00:00:00.000+08:00`,
    end: `${y}-${mm}-${String(lastDay).padStart(2, "0")}T23:59:59.999+08:00`,
    label: `${y} 年 ${Number(m)} 月`,
  };
}

/** 按时间范围拉取观看历史 */
async function fetchHistoryRange(headers, start, end, userKey) {
  const out = [];
  const limit = 100;

  for (let page = 1; page <= 3; page++) {
    if (page > 1) await sleep(80);
    if (isTraktRateLimited(userKey)) {
      return out.length ? out : { __error: "rate limited" };
    }

    const qs = `extended=full&page=${page}&limit=${limit}&start_at=${encodeURIComponent(start)}&end_at=${encodeURIComponent(end)}`;
    const data = await traktFetch(`${TRAKT_API}/users/me/history?${qs}`, headers, {
      retries: 0,
      timeout: 12000,
      userKey,
    });

    if (!data || data.__error) {
      if (page === 1) return { __error: (data && data.__error) || "fetch failed" };
      break;
    }
    if (!Array.isArray(data)) return { __error: "invalid response" };
    if (!data.length) break;

    out.push(...data);
    if (data.length < limit) break;
  }
  return out;
}

/** 汇总观看统计（次数/时长/TOP 榜/热力） */
async function buildSummary(headers, period, ref, env, ctx, userKey) {
  const { start, end, label } = summaryRange(period, ref);
  const items = await fetchHistoryRange(headers, start, end, userKey);
  if (!Array.isArray(items)) return { __error: (items && items.__error) || "fetch failed" };

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
        day = new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
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
        e.season != null && e.number != null ? `${e.season}-${e.number}` : `p${prev.plays}`;
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
        const hit = search && search.results && search.results[0] ? search.results[0] : null;
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
    uniqueEpisodes: [...showEpisodes.values()].reduce((s, x) => s + x.epKeys.size, 0),
    minutes: totalMinutes,
    hours: Math.round(totalMinutes / 60),
    busiest,
    topMovies,
    topShows,
    days,
    truncated: items.length >= 300,
    sampleSize: items.length,
  };
}


/* ============================================================
 * 十七、页面路由（/ 、/home、/login）
 * ============================================================ */
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

/** 构造启动页 Link 预取头 */
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

/** GET /：启动页，按登录态跳 /home 或 /login */
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

/** GET /login：登录页 */
function handleLogin(request) {
  const url = new URL(request.url);
  if (readAuth(request)) return Response.redirect(new URL("/home", url), 302);
  return html(renderLoginPage());
}

/** /auth/status：登录状态查询 */
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

/** 流式输出首页 HTML（先骨架后数据） */
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
        controller.enqueue(enc.encode(renderHomeSkeleton(initialDetail, profileHint)));
        controller.enqueue(
          enc.encode(
            `<script>(function(){try{var v=localStorage.getItem('mt:pb');if(!v)return;var o=JSON.parse(v);if(!o||(o._exp&&o._exp<Date.now()))return;var d=o.data||o;var html=d&&d.playbackHScrollHtml;if(!html)return;var el=document.getElementById('playback-hscroll');if(el){el.innerHTML=html;window.__earlyPbApplied=1;}}catch(e){}})();<\/script>`,
          ),
        );
        controller.enqueue(
          enc.encode(`<script>window.__HOME_CONFIG__=${cfgJson};<\/script>${boot}` + pageTail()),
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

const __actSigMemCache = new Map();
const ACT_SIG_MEM_TTL = 300000;


/* ============================================================
 * 十八、用户级数据（弃看 / 移除进度 / 日历）
 * ============================================================ */
async function getUserActivitySig(headers, env, ctx, userKey, force = false) {
  if (!userKey || userKey === "anon") return null;

  const now = Date.now();
  if (!force) {
    const mem = __actSigMemCache.get(userKey);
    if (mem && now - mem.ts < ACT_SIG_MEM_TTL) return mem.val;
  }

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
        (a.watchlist && a.watchlist.updated_at) || "",
        (a.episodes && a.episodes.paused_at) || "",
        (a.movies && a.movies.paused_at) || "",
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

      return { sig, playbackTs };
    },
    {
      ttl: 600,
      missTtl: 120,
      swr: false,
      revalidate: false,
      jitter: 60,
      ...(force ? { bypass: true } : {}),
    },
  );

  if (result && result.sig) {
    __actSigMemCache.set(userKey, { val: result, ts: now });
    if (__actSigMemCache.size > 500) {
      const it = __actSigMemCache.keys();
      for (let i = 0; i < 100; i++) {
        const k = it.next().value;
        if (k) __actSigMemCache.delete(k);
      }
    }
  }
  return result;
}

/** 对比当前活跃签名与上次基线（纯 KV 读，不打 Trakt 主体接口）。
 * 供详情页等场景复用：返回 true 表示有新的观看/暂停活动，相关缓存应绕过直拉。 */
async function __activityDiffers(headers, env, ctx, userKey) {
  if (!userKey) return false;
  try {
    const cur = await getUserActivitySig(headers, env, ctx, userKey);
    if (!cur || !cur.sig) return false;
    let last = kvMemGet(`act:${userKey}:last`);
    if (typeof last !== "string") last = null;
    if (last === null && env && env.TMDB_CACHE && !kvIsDown()) {
      try {
        const raw = await env.TMDB_CACHE.get(`act:${userKey}:last`, {
          type: "json",
          cacheTtl: 600,
        });
        kvMarkUp();
        if (raw && typeof raw === "object" && typeof raw.data === "string") last = raw.data;
      } catch {
        kvMarkDown();
      }
    }
    return !!(last && last !== cur.sig);
  } catch {
    return false;
  }
}

const __droppedShowIdsMem = new Map();
const DROPPED_MEM_TTL = 300000;

/** 已弃看剧集 id 集合（localStorage 同步） */
async function getDroppedShowIds(headers, env, ctx, userKey) {
  const key = `dropped:${userKey || "anon"}`;
  const now = Date.now();
  const mem = __droppedShowIdsMem.get(key);
  if (mem && now - mem.ts < DROPPED_MEM_TTL) return new Set(mem.ids.map(Number));

  const data = await cachedJSON(
    env,
    ctx,
    key,
    async () => {
      if (isTraktRateLimited(userKey)) return { __error: "rate limited" };

      const ids = new Set();
      try {
        for (let page = 1; page <= 5; page++) {
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
      }
      return { ids: [...ids] };
    },
    {
      ttl: 1800,
      missTtl: 120,
      swr: true,
      memOnly: false,
      edgeTtl: 300,
      jitter: 60,
      unwrap: true,
    },
  );

  if (data && Array.isArray(data.ids)) {
    const ids = data.ids.map(Number);
    __droppedShowIdsMem.set(key, { ids, ts: now });
    if (__droppedShowIdsMem.size > 500) {
      const it = __droppedShowIdsMem.keys();
      for (let i = 0; i < 100; i++) {
        const k = it.next().value;
        if (k) __droppedShowIdsMem.delete(k);
      }
    }
    return new Set(ids);
  }
  return new Set();
}

/** 近期已看集 id 集合 */
async function getWatchedEpisodeIds(headers, env, ctx, userKey) {
  const ids = await cachedJSON(
    env,
    ctx,
    CK.watchedEpisodes(userKey || "anon"),
    async () => {
      if (isTraktRateLimited(userKey)) return null;
      try {
        const r = await fetchT(`${TRAKT_API}/sync/watched/episodes`, { headers }, 15000);
        if (r.status === 429) {
          consumeRetryAfter(r, userKey);
          return null;
        }
        if (!r.ok) return null;
        const arr = await r.json();
        if (!Array.isArray(arr)) return null;
        const out = [];
        for (const w of arr) {
          const id = w && w.episode && w.episode.ids && w.episode.ids.trakt;
          if (id != null) out.push(Number(id));
        }
        return out;
      } catch {
        return null;
      }
    },
    { ttl: 3600, missTtl: 300, swr: true, edgeTtl: 600, jitter: 300 },
  );
  return Array.isArray(ids) ? new Set(ids) : null;
}

/** 读取「移除进度」隐藏映射 */
async function getCwHideMap(env, ctx, userKey) {
  if (!userKey) return {};
  const raw = await cachedJSON(env, ctx, CK.cwHide(userKey), async () => ({}), {
    ttl: 86400 * 30,
    missTtl: 60,
    swr: false,
    edgeTtl: 300,
    jitter: 120,
  });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw;
}

/** 写入「移除进度」隐藏映射 */
function putCwHideMap(env, ctx, userKey, map) {
  if (!userKey) return;
  const data = map && typeof map === "object" ? map : {};
  kvPutJSON(env, ctx, CK.cwHide(userKey), { data }, 86400 * 30, false, true);
}

/** 条目是否被用户移除进度 */
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

  const ep = entry.episode || (entry.progress && entry.progress.next_episode) || null;
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

/** 过滤掉被隐藏的继续观看条目 */
function filterCwHiddenList(list, hideMap) {
  if (!Array.isArray(list) || !list.length) return list || [];
  if (!hideMap || typeof hideMap !== "object" || !Object.keys(hideMap).length) return list;
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

/** 追剧日历（带缓存） */
async function getCalendarCached(today, headers, env, ctx, userKey, force, sourceTracker) {
  const prefix = userKey || "anon";
  return cachedJSON(
    env,
    ctx,
    CK.calendar(prefix, today),
    async () => {
      const dbg = sourceTracker ? (sourceTracker.debug = {}) : {};
      try {
        if (isTraktRateLimited(userKey)) {
          dbg.rateLimited = true;
          return { __error: "rate limited" };
        }

        const r = await fetchT(
          `${TRAKT_API}/calendars/my/shows/${today}/30?extended=full&images=poster`,
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
      missTtl: 180,
      swr: force ? true : false,
      edgeTtl: 300,
      jitter: 300,
      bypass: !!force,
      revalidate: !!force,
      lastGoodKey: CK.lastGood.calendar(prefix),
      staleRetention: 86400,
      ...(sourceTracker ? { sourceTracker } : {}),
    },
  );
}


/* ============================================================
 * 十九、首页数据接口
 * ============================================================ */
/* /api/activity-sig —— 活跃签名诊断接口（只读，不影响正常刷新流程）
 * 用法：GET /api/activity-sig          读取缓存中的当前签名与上次记录，返回 changed 与否
 *       GET /api/activity-sig?force=1  强制绕过签名缓存，立即查询 Trakt（每次调用 1 次 Trakt 请求）
 * 验证方式：在 Infuse 暂停前/后各调一次 ?force=1，changed 从 false 变 true 即代表自动更新链路正常。 */
async function handleActivitySig(request, env, ctx) {
  const A = await authed(request, env, ctx, { strict: true });
  if (!A.ok) return A.response;
  const { auth, headers, needsCookieUpdate, userKey } = A;

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const cur = await getUserActivitySig(headers, env, ctx, userKey, force);

  let last = null;
  if (userKey && env && env.TMDB_CACHE && !kvIsDown()) {
    try {
      const raw = await env.TMDB_CACHE.get(`act:${userKey}:last`, {
        type: "json",
        cacheTtl: 600,
      });
      kvMarkUp();
      if (raw && typeof raw === "object" && typeof raw.data === "string") last = raw.data;
    } catch {
      kvMarkDown();
    }
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

  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

  const part = url.searchParams.get("part") || "all";
  const force = url.searchParams.get("force") === "1";

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
  if (needsCookieUpdate) outHeaders.append("Set-Cookie", buildCookie(auth, auth.trakt_id));

  const wantPlayback = part === "playback" || part === "all";
  const wantMeta = part === "meta" || part === "all";
  const wantWatchlist = part === "watchlist" || part === "all";
  const wantCalendar = part === "calendar" || part === "all";
  const wantHistory = part === "history" || part === "all";

  /* —— 暂停进度自动更新 ——
   * Trakt「活跃签名」（/sync/last_activities，带 ~10 分钟 KV 缓存）记录了最近观看/暂停时间：
   * 非强制刷新时也读取并与上次记录比对，签名有变化说明播放器端上报了新的观看/暂停，
   * 本次自动绕过 playback 的 KV 缓存直达 Trakt 拉新数据（否则静默刷新最多要等 90 分钟缓存过期）。 */
  const actSigP = wantPlayback
    ? getUserActivitySig(headers, env, ctx, userKey)
    : Promise.resolve(null);
  let pbBypass = force;
  let sigBaselineNeeded = false;
  if (wantPlayback && !force) {
    try {
      const sigEarly = await actSigP;
      if (sigEarly && sigEarly.sig) {
        let last = kvMemGet(`act:${userKey}:last`);
        if (typeof last !== "string") last = null;
        if (last === null && env && env.TMDB_CACHE && !kvIsDown()) {
          try {
            const raw = await env.TMDB_CACHE.get(`act:${userKey}:last`, {
              type: "json",
              cacheTtl: 600,
            });
            kvMarkUp();
            if (raw && typeof raw === "object" && typeof raw.data === "string") last = raw.data;
          } catch {
            kvMarkDown();
          }
        }
        if (last === null) {
          sigBaselineNeeded = true; // 首次见到签名：只建立基线，不触发绕过
        } else if (last !== sigEarly.sig) {
          pbBypass = true; // 签名变化：自动绕过缓存
        }
      }
    } catch {}
  }

  const result = { part };
  const taskFns = [];
  let playback = null,
    profile = null,
    stats = null,
    history = null,
    calendar = null,
    watchlist = null;

  const playbackSrc = { fromCache: true, age: 0 };
  const metaSrc = { fromCache: null, age: 0 };
  const watchlistSrc = { fromCache: true, age: 0 };
  const calendarSrc = { fromCache: true, age: 0 };
  const historySrc = { fromCache: true, age: 0 };

  const opts = (o) =>
    force ? { ...o, bypass: true, revalidate: true } : { ...o, revalidate: false, swr: false };

  if (wantPlayback) {
    taskFns.push(async () => {
      playback = await cachedJSON(
        env,
        ctx,
        CK.playback(userKey),
        async () => {
          const dbg = (playbackSrc.debug = {});
          if (isTraktRateLimited(userKey)) {
            dbg.rateLimited = true;
            dbg.cooling = traktRateLimitedRemaining(userKey);
            return {
              __error: "429 rate limited",
              __cooling: traktRateLimitedRemaining(userKey),
            };
          }

          // 【核心修复】改为并发请求并延长超时时间
          const [paused, upNext] = await Promise.all([
            fetchJson(`${TRAKT_API}/sync/playback?extended=full`, 1, 12000),
            fetchJson(
              `${TRAKT_API}/sync/progress/up_next_nitro?extended=full&images=poster,screenshot,fanart&limit=30&intent=continuing`,
              1,
              15000,
            ),
          ]);

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

          // 只要有任何一方失败（超时/报错），直接返回错误！
          // 绝对不允许将残缺的数据（比如只有1条）写入 KV 缓存。
          if (!pausedOk || !upNextOk) {
            const err =
              (paused && paused.__error) || (upNext && upNext.__error) || "partial fetch failed";
            return {
              __error: err,
              __cooling: (paused && paused.__cooling) || (upNext && upNext.__cooling) || undefined,
            };
          }

          let droppedSet = null;
          try {
            droppedSet = await getDroppedShowIds(headers, env, ctx, userKey);
          } catch {
            droppedSet = null;
          }
          let watchedEpIds = null;
          try {
            watchedEpIds = await getWatchedEpisodeIds(headers, env, ctx, userKey);
          } catch {
            watchedEpIds = null;
          }
          let hideMap = {};
          try {
            hideMap = await getCwHideMap(env, ctx, userKey);
          } catch {
            hideMap = {};
          }

          const merged = mergeContinueLists(
            pausedOk || [],
            upNextOk || [],
            20,
            droppedSet,
            null,
            hideMap,
          );
          if (merged && merged.__autoUnhide && merged.__autoUnhide.length && hideMap) {
            let changed = false;
            for (const sid of merged.__autoUnhide) {
              const k = String(sid);
              if (hideMap[k] || hideMap[sid]) {
                delete hideMap[k];
                delete hideMap[sid];
                changed = true;
              }
            }
            if (changed) putCwHideMap(env, ctx, userKey, hideMap);
          }
          applyRewatchFlags(merged, watchedEpIds);
          dbg.items = merged.length;
          dbg.dropped = droppedSet ? droppedSet.size : 0;
          return merged;
        },
        {
          ...(pbBypass
            ? { bypass: true, revalidate: true }
            : { revalidate: false, swr: false }),
          ...CACHE_USER_LONG,
          ttl: PLAYBACK_KV_TTL,
          sourceTracker: playbackSrc,
          lastGoodKey: CK.lastGood.playback(userKey),
        },
      );
      if (Array.isArray(playback) && playback.length) {
        try {
          const freshWatched = await getWatchedEpisodeIds(headers, env, ctx, userKey);
          applyRewatchFlags(playback, freshWatched);
        } catch {
          applyRewatchFlags(playback, null);
        }
        try {
          let hideMap = await getCwHideMap(env, ctx, userKey);
          if (!hideMap || typeof hideMap !== "object") hideMap = {};
          const filtered = filterCwHiddenList(playback, hideMap);
          if (filtered && filtered.__autoUnhide && filtered.__autoUnhide.length) {
            let changed = false;
            for (const sid of filtered.__autoUnhide) {
              const k = String(sid);
              if (hideMap[k] || hideMap[sid]) {
                delete hideMap[k];
                delete hideMap[sid];
                changed = true;
              }
            }
            if (changed) putCwHideMap(env, ctx, userKey, hideMap);
          }
          playback = filtered;
        } catch {}
      }
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
          revalidate: true,
          swr: force ? false : Math.floor(HISTORY_KV_TTL * 0.4),
          sourceTracker: historySrc,
          lastGoodKey: CK.lastGood.history(userKey, 1),
        },
      );
    });
  }

  if (wantCalendar) {
    taskFns.push(async () => {
      calendar = await getCalendarCached(today, headers, env, ctx, userKey, force, calendarSrc);
    });
  }

  if (wantWatchlist) {
    taskFns.push(async () => {
      try {
        watchlist = await getWatchlist(headers, "added", env, ctx, userKey, force, watchlistSrc);
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
          ...opts({
            ...CACHE_USER_META,
            ttl: PROFILE_KV_TTL,
          }),
          sourceTracker: metaSrc,
        },
      );
    });
    taskFns.push(async () => {
      stats = await cachedJSON(
        env,
        ctx,
        CK.stats(userKey),
        async () => {
          const s = await fetchJson(`${TRAKT_API}/users/me/stats`);
          return s && !s.__error ? s : null;
        },
        opts({
          ...CACHE_USER_META,
          ttl: STATS_KV_TTL,
        }),
      );
    });
  }

  const concurrency = 1;
  const gapMs = force ? 1200 : 50;
  await runLimited(taskFns, concurrency, gapMs);

  const actSig = await actSigP.catch(() => null);
  /* 签名持久化：手动强制刷新、本次确实拿到新数据（live）、或首次建立基线时写入；
   * 拉取失败时不更新，保证下次自动重试绕过缓存。KV 持久化使其跨进程实例生效。 */
  if (actSig && actSig.sig && (force || playbackSrc.fromCache === false || sigBaselineNeeded)) {
    kvMemSet(`act:${userKey}:last`, actSig.sig, KV_MEM_TTL);
    try {
      kvPutJSON(env, ctx, `act:${userKey}:last`, { data: actSig.sig }, 86400 * 30, false);
    } catch {}
  }

  if (isTraktRateLimited(userKey)) {
    result.rateLimited = true;
    result.cooling = traktRateLimitedRemaining(userKey);
  } else {
    result.rateLimited = false;
    result.cooling = 0;
  }

  const liveSources = [playbackSrc, metaSrc, watchlistSrc, calendarSrc, historySrc];
  const anyLive = liveSources.some((s) => s && s.fromCache === false);
  const userUpdatedAt = anyLive ? Date.now() : null;
  if (userUpdatedAt) result.userUpdatedAt = userUpdatedAt;

  if (wantPlayback) {
    const pbList = Array.isArray(playback) ? playback : [];
    try {
      await attachContinueStillsForPlayback(pbList, env, ctx, userKey);
      result.playbackHScrollHtml = renderContinueItems(pbList, "hscroll");
    } catch {
      result.playbackHScrollHtml =
        '<div class="empty" style="padding:50px 20px"><p style="margin:0;font-size:.92rem">继续观看加载失败，稍后重试</p></div>';
    }
    result.playbackSource =
      playbackSrc.fromCache === true ? "cache" : playbackSrc.fromCache === false ? "live" : "";

    let playbackAgeSec = 0;
    let playbackDataTs = 0;
    if (userUpdatedAt) {
      playbackDataTs = Number(userUpdatedAt) || 0;
      playbackAgeSec = Math.max(0, Math.round((Date.now() - playbackDataTs) / 1000));
    } else if (typeof playbackSrc.age === "number") {
      playbackAgeSec = playbackSrc.age || 0;
      playbackDataTs = Date.now() - playbackAgeSec * 1000;
    }
    try {
      const mem = kvMemGet(CK.playback(userKey));
      if (mem && mem._ts) {
        playbackDataTs = mem._ts;
        playbackAgeSec = Math.max(0, Math.round((Date.now() - mem._ts) / 1000));
      }
    } catch {}
    result.playbackAgeSec = playbackAgeSec;
    result.playbackDataTs = playbackDataTs || null;

    result.playbackDebug = {
      source: result.playbackSource || null,
      ageSec: result.playbackAgeSec,
      dataTs: result.playbackDataTs,
      userUpdatedAt: userUpdatedAt || null,
      items: Array.isArray(playback) ? playback.length : null,
      lastActivity: actSig && actSig.playbackTs ? actSig.playbackTs : null,
      ...(playbackSrc.debug || {}),
    };
  }

  if (wantMeta) {
    if (profile && !profile.__error && profile.ids && profile.ids.trakt) {
      rememberTraktUserId(auth, profile.ids.trakt);
    }

    const username = (profile && !profile.__error && profile.username) || "我",
      displayName = (profile && !profile.__error && profile.name) || username,
      movieCount = stats && !stats.__error && stats.movies ? stats.movies.watched : 0,
      episodeCount = stats && !stats.__error && stats.episodes ? stats.episodes.watched : 0,
      showCount = stats && !stats.__error && stats.shows ? stats.shows.watched : 0,
      totalHours =
        stats && !stats.__error && stats.episodes && stats.episodes.minutes
          ? Math.round(stats.episodes.minutes / 60)
          : 0;

    let avatarUrl = "",
      avatarAlts = [];
    try {
      const av = pickAvatar(profile);
      avatarUrl = av.url;
      avatarAlts = av.alts;
    } catch {}

    result.name = displayName;
    result.avatar = avatarUrl || null;
    result.avatarAlt = avatarAlts;
    result.statsHtml = renderStatsHtml({
      movie: movieCount,
      show: showCount,
      episode: episodeCount,
      hours: totalHours,
    });
    result.metaSource =
      metaSrc.fromCache === true ? "cache" : metaSrc.fromCache === false ? "live" : "";
    result.metaAgeSec = metaSrc.age || 0;

    try {
      const pname = displayName || "";
      const pavatar = avatarUrl || "";
      const hint = readProfileHint(request);
      if (!hint || hint.name !== pname || hint.avatar !== pavatar) {
        if (pname || pavatar)
          outHeaders.append("Set-Cookie", buildProfileCookie({ name: pname, avatar: pavatar }));
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

      let historyPageCount = 1;
      if (history && !Array.isArray(history) && history.pageCount)
        historyPageCount = Number(history.pageCount) || 1;
      else if (historyItems && historyItems.__pageCount)
        historyPageCount = historyItems.__pageCount || 1;

      const historyHasMore =
        historyPageCount > 1 || (Array.isArray(historyItems) && historyItems.length >= PAGE_SIZE);

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
        await attachWatchlistStills(list, env, ctx, userKey);
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
      watchlistSrc.fromCache === true ? "cache" : watchlistSrc.fromCache === false ? "live" : "";
    result.watchlistDebug = {
      source: result.watchlistSource || null,
      items: Array.isArray(watchlist) ? watchlist.length : null,
      ...(watchlistSrc.debug || {}),
    };
  }

  if (wantCalendar) {
    result.calendarSource =
      calendarSrc.fromCache === true ? "cache" : calendarSrc.fromCache === false ? "live" : "";
    result.calendarDebug = {
      source: result.calendarSource || null,
      items: Array.isArray(calendar) ? calendar.length : null,
      ...(calendarSrc.debug || {}),
    };
  }

  if (wantHistory) {
    result.historySource =
      historySrc.fromCache === true ? "cache" : historySrc.fromCache === false ? "live" : "";
    result.historyDebug = {
      source: result.historySource || null,
      items: Array.isArray(history)
        ? history.length
        : history && Array.isArray(history.items)
          ? history.items.length
          : null,
      pageCount: history && !Array.isArray(history) && history.pageCount ? history.pageCount : null,
      ...(historySrc.debug || {}),
    };
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

/** 首页平台剧场卡片行 */
function renderPlatformRows() {
  const card = (p) =>
    `<button type="button" class="platform-card" data-platform-id="${p.id}" title="${p.name}"><div class="platform-card-left"><img class="platform-card-logo" src="${p.logo}" alt="" loading="lazy"><span class="platform-card-name">${p.name}</span></div><div class="platform-card-right"><div class="platform-card-posters" data-plat-posters="${p.id}"><span class="platform-card-poster p0 platform-card-poster-ph"></span><span class="platform-card-poster p1 platform-card-poster-ph"></span><span class="platform-card-poster p2 platform-card-poster-ph"></span><span class="platform-card-poster p3 platform-card-poster-ph"></span></div></div></button>`;

  const row = (list) =>
    `<div class="platform-row"><div class="platform-cards">${list.map(card).join("")}</div></div>`;

  const cards = HOME_PLATFORM_IDS.map((id) => PLATFORMS[id]).filter(Boolean);
  return `<div class="platform-rows">${row(cards.slice(0, 5))}${row(cards.slice(5))}</div>`;
}

/** 首页骨架 HTML（含首屏占位） */
function renderHomeSkeleton(initialDetail, profileHint) {
  const boot = initialDetail
    ? `<script>window.addEventListener('load',()=>{const s=${jsStr(initialDetail)},idx=s.indexOf('/');if(idx>0)openDetail(s.slice(0,idx),s.slice(idx+1),false);});<\/script>`
    : "";

  const heroName = profileHint && profileHint.name ? esc(profileHint.name) : "…";
  const heroAvatarHtml =
    profileHint && profileHint.avatar
      ? `<img src="${esc(profileHint.avatar)}" alt="" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover;display:block">`
      : `<span class="hero-avatar-ph">👤</span>`;

  const section = (id, title, extraHtml) =>
    `<div class="home-section"><div class="home-section-head"><h2 class="home-section-title">${title}</h2><button class="home-more-btn" type="button" onclick="openListModal('${id}')"><span>查看更多</span><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button></div>${extraHtml || ""}<div class="h-scroll-wrap"><div class="h-scroll" id="${id}-hscroll"><div class="pane-loading"><div class="spinner"></div></div></div></div></div>`;

  return `<div class="container"><div class="top-sticky"><header class="hero"><div class="hero-left"><button type="button" class="hero-avatar" id="hero-avatar" title="观看小结" aria-label="打开观看小结">${heroAvatarHtml}</button><div class="hero-text"><h1 class="hero-name" id="hero-name">${heroName}</h1><p class="updated-at" id="updated-at"></p></div></div><div class="hero-actions"><button class="btn-action" id="btn-refresh" onclick="forceRefresh()" title="刷新数据"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg><span>刷新</span></button><button class="btn-action" id="btn-theme" onclick="cycleTheme()" title="主题：深色" aria-label="切换主题：深色"><span class="theme-icon" id="theme-icon"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></span><span>主题</span></button><button class="btn-action" id="btn-logout" onclick="logout()" title="退出登录"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg><span>退出</span></button></div></header><div class="stats" id="stats-box">${renderStatsHtml(null)}</div><nav class="tabs"><button class="tab active" data-tab="playback"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/></svg><span>首页</span></button><button class="tab" data-tab="watchlist"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg><span>待看</span></button><button class="tab" data-tab="calendar"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg><span>日历</span></button><button class="tab" data-tab="history"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg><span>记录</span></button><button class="tab" data-tab="search"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg><span>搜索</span></button></nav></div><section id="playback" class="pane active">${section("playback", "继续观看")}<div class="home-section platform-section"><div class="home-section-head"><h2 class="home-section-title">流媒体平台</h2></div>${renderPlatformRows()}${section("guduo", "骨朵热榜", '<div class="theater-home-tabs" id="guduo-home-tabs" style="display:none"></div>')}${section("theater", "平台剧场", '<div class="theater-home-tabs" id="theater-home-tabs" style="display:none"></div>')}${section("douban-domestic", "豆瓣热播国产剧")}${section("douban-hktw", "豆瓣热播港台剧")}${section("douban-jpkr", "豆瓣热播日韩剧")}${section("douban-western", "豆瓣热播欧美剧")}</section><section id="watchlist" class="pane"><div class="pane-loading"><div class="spinner"></div></div></section><section id="calendar" class="pane"><div class="pane-loading"><div class="spinner"></div></div></section><section id="history" class="pane"><div class="grid"></div><div id="history-more"></div></section><section id="search" class="pane"><div class="search-bar"><input id="search-input" class="search-input" type="search" placeholder="搜索电影 / 剧集" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></div><div id="search-results" class="grid"></div></section><div class="app-version">MineTrakt v${APP_JS_VERSION}</div></div><div id="list-modal" class="list-modal"><div class="list-modal-backdrop" onclick="closeListModal()"></div><div class="list-modal-panel"><div class="list-modal-head"><h3 class="list-modal-title" id="list-modal-title"></h3><button type="button" class="list-modal-close" onclick="closeListModal()" aria-label="关闭">×</button></div><div class="list-modal-body" id="list-modal-body"></div></div></div><div id="summary-modal" class="summary-modal" style="display:none" role="dialog" aria-modal="true" aria-label="观看小结"><div class="summary-backdrop" onclick="window.__closeSummary()"></div><div class="summary-panel"><div class="summary-head"><h2 class="summary-title">观看小结</h2><button type="button" class="summary-close" onclick="window.__closeSummary()" aria-label="关闭">×</button></div><div id="summary-modal-body" class="summary-body"><div class="pane-loading"><div class="spinner"></div></div></div></div></div><div id="person-modal" class="person-modal"><div class="person-backdrop" onclick="closePerson()"></div><div class="person-panel"><div class="person-panel-head"><div class="person-panel-name" id="person-modal-name"></div><button class="person-close" onclick="closePerson()" aria-label="关闭">×</button></div><div class="person-panel-body" id="person-modal-body"></div></div></div><div id="confirm-modal" class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" style="display:none"><div class="confirm-backdrop"></div><div class="confirm-panel"><div class="confirm-icon" id="confirm-icon">?</div><div class="confirm-title" id="confirm-title"></div><div class="confirm-msg" id="confirm-msg"></div><div class="confirm-actions"><button class="confirm-btn confirm-cancel" id="confirm-cancel" type="button">取消</button><button class="confirm-btn confirm-ok" id="confirm-ok" type="button">确定</button></div></div></div><div id="modal" class="modal"><div class="modal-backdrop" onclick="closeDetail()"></div><div class="modal-panel"><div class="modal-shell"><button class="modal-close" onclick="closeDetail()" aria-label="关闭"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button><div class="modal-body" id="modal-body"></div></div></div></div><div id="show-cal-modal" class="show-cal-modal"><div class="show-cal-backdrop" onclick="closeShowCal()"></div><div class="show-cal-panel"><div class="show-cal-head"><div class="show-cal-name" id="show-cal-name"></div><button class="show-cal-close" onclick="closeShowCal()" aria-label="关闭">×</button></div><div class="show-cal-info" id="show-cal-info"></div><div class="show-cal-nav"><button onclick="calShiftMonth(-1)" aria-label="上个月">‹</button><div id="show-cal-month">—</div><button onclick="calShiftMonth(1)" aria-label="下个月">›</button></div><div class="show-cal-weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div><div class="show-cal-grid" id="show-cal-grid"></div><div class="show-cal-legend"><span class="legend-item"><i class="legend-dot legend-past"></i>已播出</span><span class="legend-item"><i class="legend-dot legend-today"></i>今天</span><span class="legend-item"><i class="legend-dot legend-future"></i>待播出</span></div><div class="show-cal-detail" id="show-cal-detail"></div></div></div><script src="/app.js?v=${APP_JS_VERSION}" defer><\/script>${boot}`;
}

/** /api/detail-extras：详情页补充数据（评分/预告/演职员） */
async function handleDetailExtras(request, env, ctx) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const tmdbId = url.searchParams.get("tmdb");
  const imdbId = url.searchParams.get("imdb");

  if (!type || (type !== "movie" && type !== "show"))
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
      tmdbDetailCached(`/${t}/${tmdbId}?append_to_response=credits,recommendations`, env, ctx)
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
  const cast = (
    tmdbFull && tmdbFull.credits && Array.isArray(tmdbFull.credits.cast)
      ? tmdbFull.credits.cast
      : []
  ).slice(0, 20);

  const castHtml = cast
    .map((c) => {
      const initial = Array.from(c.name || "?")[0] || "?";
      const pid = c.id ? String(c.id) : "";
      const personAttrs = pid
        ? ` data-person-id="${esc(pid)}" data-person-name="${esc(c.name || "")}" role="button" tabindex="0"`
        : "";
      const cls = "cast" + (pid ? " clickable" : "");
      return `<div class="${cls}"${personAttrs}>${c.profile_path ? `<img class="cast-img" src="${TMDB_IMG}/w185${c.profile_path}" loading="lazy" alt="">` : `<div class="cast-img cast-ph">${esc(initial)}</div>`}<div class="cast-name">${esc(c.name || "")}</div><div class="cast-role">${esc(c.character || "")}</div></div>`;
    })
    .join("");

  const videos =
    out.videos && Array.isArray(out.videos.results)
      ? out.videos.results
      : tmdbFull && tmdbFull.videos && Array.isArray(tmdbFull.videos.results)
        ? tmdbFull.videos.results
        : [];

  const trailers = videos.filter(
    (v) => v && v.site === "YouTube" && v.key && (v.type === "Trailer" || v.type === "Teaser"),
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
      return `<div class="trailer-card" data-yt-key="${esc(v.key)}"><div class="trailer-frame"></div><img class="trailer-thumb" src="https://img.youtube.com/vi/${esc(v.key)}/hqdefault.jpg" loading="lazy" alt="" onerror="this.parentNode.classList.add('no-thumb')"><span class="trailer-play"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" stroke="none"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11.04-6.86a1 1 0 0 0 0-1.72L9.5 4.28A1 1 0 0 0 8 5.14z"/></svg></span><div class="trailer-name">${esc(name)}</div></div>`;
    })
    .join("");

  const recs = (
    tmdbFull && tmdbFull.recommendations && Array.isArray(tmdbFull.recommendations.results)
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
    tmdbFull && tmdbFull.vote_average != null && Number(tmdbFull.vote_average) > 0
      ? Number(tmdbFull.vote_average)
      : null;

  const ratingsHtml =
    out.omdb || tmdbRating != null ? renderExtRatings(out.omdb, { tmdb: tmdbRating }) : "";

  return authResp(
    auth,
    needsCookieUpdate,
    JSON.stringify({ castHtml, recsHtml, ratingsHtml, trailersHtml }),
    {
      contentType: "application/json; charset=utf-8",
      extra: {
        "Cache-Control": "private, max-age=600, stale-while-revalidate=1200",
      },
    },
  );
}

/** /api/person：人物详情 */
async function handlePerson(request, env, ctx) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id || !/^\d+$/.test(id)) return new Response("bad params", { status: 400 });

  const A = await authed(request, env, ctx, { html: true });
  if (!A.ok) return A.response;
  const { auth, needsCookieUpdate } = A;

  if (!env.TMDB_API_KEY)
    return authResp(auth, needsCookieUpdate, emptyView({ text: "TMDB 未配置", error: true }), {
      status: 502,
    });

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
  const photo = person.profile_path ? `${TMDB_IMG}/w342${person.profile_path}` : null;
  const initial = Array.from(name || "?")[0] || "?";
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
      const title = isMovie ? c.title || c.original_title || "" : c.name || c.original_name || "";
      const year = ((c.release_date || c.first_air_date || "") + "").slice(0, 4);
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
  if (gender) rows.push(`<div class="person-row"><b>性别</b>${esc(gender)}</div>`);
  if (birthday)
    rows.push(
      `<div class="person-row"><b>生日</b>${esc(birthday)}${deathday ? " — " + esc(deathday) : ""}</div>`,
    );
  if (place) rows.push(`<div class="person-row"><b>出生地</b>${esc(place)}</div>`);

  const html = `<div class="person-head">${photo ? `<img class="person-photo" src="${photo}" alt="">` : `<div class="person-photo person-photo-ph">${esc(initial)}</div>`}<div class="person-info"><div class="person-name">${esc(name)}</div>${rows.length ? `<div class="person-rows">${rows.join("")}</div>` : ""}</div></div>${bio ? `<div class="person-bio">${esc(bio)}</div>` : ""}${creditsHtml ? `<div class="person-credits-title">参演作品</div><div class="grid">${creditsHtml}</div>` : '<p class="person-sub">暂无参演作品信息</p>'}`;

  return authResp(auth, needsCookieUpdate, html, {
    extra: { "Cache-Control": "private, max-age=3600" },
  });
}

/** /api/season：整季集数列表 */
async function handleSeason(request, env, ctx) {
  const url = new URL(request.url),
    showId = url.searchParams.get("show") || "",
    seasonNum = parseInt(url.searchParams.get("season") || "0"),
    tmdbId = url.searchParams.get("tmdb"),
    slug = url.searchParams.get("slug") || "";

  if (isNaN(seasonNum) || (!showId && !tmdbId)) return new Response("bad params", { status: 400 });

  const A = await authed(request, env, ctx, { html: true, strict: true });
  if (!A.ok) return A.response;
  const { auth, headers, needsCookieUpdate, userKey } = A;

  const validShowId = showId && /^\d+$/.test(showId);

  /* 有新的观看/暂停活动时，绕过观看进度缓存，保证「已看/未看」角标即时准确 */
  const freshProgress = validShowId
    ? await __activityDiffers(headers, env, ctx, userKey)
    : false;

  const [progress, traktSeason, tmdbSeason] = await Promise.all([
    validShowId
      ? cachedJSON(
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
            ttl: 1800,
            missTtl: 60,
            swr: true,
            edgeTtl: 300,
            jitter: 180,
            ...(freshProgress ? { bypass: true } : {}),
          },
        )
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
            ttl: SEASON_KV_TTL,
            missTtl: 60,
            swr: 3600,
            edgeTtl: 1800,
            jitter: 300,
          },
        )
      : Promise.resolve(null),
    tmdbId && env.TMDB_API_KEY
      ? tmdbDetailCached(`/tv/${tmdbId}/season/${seasonNum}`, env, ctx)
      : Promise.resolve(null),
  ]);

  const seasonProgress = Array.isArray(progress && progress.seasons)
    ? progress.seasons.find((s) => s.number === seasonNum)
    : null;
  const traktEpisodes =
    traktSeason && Array.isArray(traktSeason.episodes) ? traktSeason.episodes : [];

  return authResp(
    auth,
    needsCookieUpdate,
    renderSeasonEpisodes(seasonProgress, tmdbSeason, seasonNum, slug, traktEpisodes, tmdbId),
    { extra: { "Cache-Control": CC_NO_STORE } },
  );
}


/* ============================================================
 * 二十、详情页接口
 * ============================================================ */
async function handleApiDetail(request, env, ctx) {
  try {
    const url = new URL(request.url),
      type = url.searchParams.get("type"),
      rawId = url.searchParams.get("id");

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
    if (rawId.startsWith("tmdb-")) tmdbIdHint = rawId.slice(5);
    else if (/^\d+$/.test(rawId)) traktId = rawId;
    else return errResponse("参数无效", 400);

    const t = type === "movie" ? "movie" : "tv";

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
            edgeTtl: 1800,
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
              return (arr[0][key] && arr[0][key].ids && arr[0][key].ids.trakt) || null;
            },
            { ttl: 86400 * 7, missTtl: 120, swr: 3600, edgeTtl: 3600 },
          )
        : Promise.resolve(null);

    let [entity, resolvedTraktId] = await Promise.all([entityP, resolvedP]);
    if (resolvedTraktId) traktId = String(resolvedTraktId);

    const tmdbId = (entity && entity.ids && entity.ids.tmdb) || tmdbIdHint || null;

    const tmdbBasicP =
      tmdbId && env.TMDB_API_KEY
        ? tmdbDetailCached(`/${t}/${tmdbId}?append_to_response=external_ids`, env, ctx)
        : Promise.resolve(null);

    const userProgressP =
      type === "show" && traktId
        ? cachedJSON(
            env,
            ctx,
            CK.watchProgress(userKey, traktId),
            async () => {
              const r = await traktGet(
                `${TRAKT_API}/shows/${traktId}/progress/watched?hidden=false&specials=false`,
                headers,
                2,
                userKey,
              );
              return r && !r.__error ? r : null;
            },
            {
              ttl: 1800,
              missTtl: 60,
              swr: true,
              edgeTtl: 300,
              jitter: 180,
              ...(await __activityDiffers(headers, env, ctx, userKey)
                ? { bypass: true }
                : {}),
            },
          )
        : Promise.resolve(null);

    const pausedEntryP =
      type === "show" && traktId
        ? cachedJSON(
            env,
            ctx,
            CK.showPlayback(userKey, traktId),
            async () => {
              if (isTraktRateLimited(userKey)) return null;
              const r = await traktGet(
                `${TRAKT_API}/sync/playback/episodes?extended=full&limit=100`,
                headers,
                2,
                userKey,
              );
              if (!Array.isArray(r) || !r.length) return null;
              const mine = r.filter(
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
            },
            { ttl: 600, missTtl: 120, swr: true, edgeTtl: 300, jitter: 120 },
          )
        : Promise.resolve(null);

    const movieHistoryP =
      type === "movie" && traktId
        ? cachedJSON(
            env,
            ctx,
            CK.movieHistory(userKey, traktId),
            async () => {
              const r = await traktGet(
                `${TRAKT_API}/sync/history/movies/${traktId}?limit=1`,
                headers,
                2,
                userKey,
              );
              return r && !r.__error ? r : null;
            },
            { ttl: 1800, missTtl: 60, swr: true, edgeTtl: 300, jitter: 180 },
          )
        : Promise.resolve(null);

    const [tmdbBasic, userProgress, movieHistory, pausedEntry, watchedEpIds] = await Promise.all([
      tmdbBasicP,
      userProgressP,
      movieHistoryP,
      pausedEntryP,
      getWatchedEpisodeIds(headers, env, ctx, userKey).catch(() => null),
    ]);

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
        isTraktRateLimited(userKey) ? "Trakt 限流中，请稍后重试" : "加载失败，请稍后重试",
        502,
      );
    }

    if (!entity) {
      const genres =
        tmdbBasic && Array.isArray(tmdbBasic.genres) ? tmdbBasic.genres.map((g) => g.name) : [];
      entity = {
        title: (tmdbBasic && (tmdbBasic.title || tmdbBasic.name)) || "",
        year: (
          ((tmdbBasic && tmdbBasic.release_date) || (tmdbBasic && tmdbBasic.first_air_date) || "") +
          ""
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
              (tmdbBasic.imdb_id || (tmdbBasic.external_ids && tmdbBasic.external_ids.imdb_id))) ||
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
    const wlTmdbId = type === "movie" ? tmdbBasic && tmdbBasic.id : entity.ids && entity.ids.tmdb;

    if (wlTmdbId && env.TMDB_CACHE) {
      try {
        const wlType = type === "movie" ? "movies" : "shows";
        const ids = await getWatchlistTmdbIds(headers, env, ctx, userKey, wlType);
        inWatchlist = ids.includes(wlTmdbId);
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
    if (initialSeasonNum == null && tmdbBasic && tmdbBasic.seasons && tmdbBasic.seasons.length) {
      const real = tmdbBasic.seasons.filter((s) => s.season_number > 0);
      if (real.length) initialSeasonNum = real[0].season_number;
    }

    const imdbId =
      (tmdbBasic &&
        (tmdbBasic.imdb_id || (tmdbBasic.external_ids && tmdbBasic.external_ids.imdb_id))) ||
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
      });
    } catch (renderErr) {
      return new Response("RENDER ERROR: " + ((renderErr && renderErr.stack) || renderErr), {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (typeof bodyHtml !== "string") {
      return new Response(
        "RENDER RETURNED NON-STRING: " + Object.prototype.toString.call(bodyHtml),
        {
          status: 500,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        },
      );
    }

    return authResp(auth, needsCookieUpdate, bodyHtml, {
      extra: {
        "Cache-Control": "private, max-age=120, stale-while-revalidate=300",
      },
    });
  } catch (e) {
    return new Response("DETAIL EXCEPTION: " + ((e && e.stack) || e), {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}


/* ============================================================
 * 二十一、通用条目渲染（卡片 HTML 生成）
 * ============================================================ */
function posterOfTrakt(obj) {
  if (!obj || !obj.images) return null;
  const pick = (arr) => {
    if (!arr || !Array.isArray(arr) || !arr.length) return null;
    if (typeof arr[0] === "string") return arr[0];
    if (typeof arr[0] === "object") return arr[0].full || arr[0].medium || arr[0].thumb || null;
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

/** 继续观看条目的兜底图片 */
function continueImageOf(item) {
  if (!item) return null;
  return (
    posterOfTrakt(item.episode) || posterOfTrakt(item.show) || posterOfTrakt(item.movie) || null
  );
}

/** Trakt 条目 → 通用卡片基础字段（标题/详情入口/enrich key） */
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
    base.poster = posterOfTrakt(m);
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
    else if (m.title) base.enrichKey = "movie:title:" + m.title + ":" + (m.year || "");
  } else if (kind === "episode" || kind === "show" || (traktItem.show && traktItem.episode)) {
    const e = traktItem.episode || {},
      s = traktItem.show || {};
    base.tag = "剧集";
    base.tagClass = "episode";
    base.title = s.title || "";
    base.overview = s.overview || "";
    const epPoster = (e && (e.__stillUrl || posterOfTrakt(e))) || traktItem.__stillUrl || null;
    base.poster = epPoster || posterOfTrakt(s);
    base.hasPoster = !!base.poster;
    base.line1 =
      e.season != null && e.number != null
        ? `第 ${e.season} 季 第 ${e.number} 集${
            e.title && !/^Episode\s*\d+$/i.test(String(e.title).trim()) ? " · " + e.title : ""
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
    else if (s.title) base.enrichKey = "tv:title:" + s.title + ":" + (s.year || "");
    if (epPoster) base.lockPoster = true;
  } else if (kind === "season") {
    const se = traktItem.season || {},
      s = traktItem.show || {};
    base.tag = "剧集";
    base.tagClass = "episode";
    base.title = s.title || "";
    base.overview = s.overview || "";
    base.poster = posterOfTrakt(s);
    base.line1 = se.number != null ? `第 ${se.number} 季` : s.year ? String(s.year) : "";
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
    else if (s.title) base.enrichKey = "tv:title:" + s.title + ":" + (s.year || "");
  }
  return base;
}

/** 解析 enrich key（type:source:id） */
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
        return { kind, source, title: rest.slice(0, lastColon), year: maybeYear };
      }
    }
    return { kind, source, title: rest, year: "" };
  }
  return { kind, source, value: rest };
}

const ENRICH_KEY_RE =
  /^(?:movie|tv):(?:tmdb:\d{1,10}|imdb:tt\d{1,10}|tvdb:\d{1,10}|title:[^\n\r]{1,80})$/;

const ENRICH_MISS_TTL = 600000;

/** 拉取单个 key 的补数据（海报/中文标题/简介） */
async function fetchEnrichData(key, env) {
  if (!env.TMDB_API_KEY) return null;
  const parsed = parseEnrichKey(key);
  if (!parsed) return null;

  const { kind, source } = parsed;
  let d = null;

  if (source === "tmdb") d = await tmdbGet(tmdbUrl(`/${kind}/${parsed.value}`, env));
  else if (source === "imdb") {
    const find = await tmdbGet(
      tmdbUrl(`/find/${parsed.value}`, env, { external_source: "imdb_id" }),
    );
    if (find) {
      const arr = kind === "movie" ? find.movie_results : find.tv_results;
      if (arr && arr.length) d = await tmdbGet(tmdbUrl(`/${kind}/${arr[0].id}`, env));
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

/** 按 key 分桶读取缓存，避免大 KV 值 */
function __bucketGet(items, key) {
  const rec = items[key];
  if (!rec) return undefined;
  const age = Date.now() - (Number(rec.ts) || 0);
  if (rec.m) return age < ENRICH_MISS_TTL ? null : undefined;
  if (age > ENRICH_BUCKET_TTL * 1000) return undefined;
  return { title: rec.t || "", overview: rec.o || "", poster: rec.p || null };
}

/** 批量 enrich：合并回源、分批限流 */
async function enrichBatch(keys, env, ctx) {
  const out = {};
  if (!env || !env.TMDB_API_KEY) {
    for (const k of keys) out[k] = null;
    return out;
  }

  const pending = [];
  const keyBucket = new Map();

  for (const key of keys) {
    const mem = kvMemGet(CK.enrich(key));
    if (mem !== undefined && mem !== KV_MISS) {
      out[key] = mem && mem.miss ? null : mem && mem.data !== undefined ? mem.data : mem;
      continue;
    }
    keyBucket.set(key, stableJitter(key, ENRICH_BUCKETS));
    pending.push(key);
  }
  if (!pending.length) return out;

  const bucketData = new Map();
  const bucketIds = [...new Set(keyBucket.values())];
  const nowB = Date.now();
  for (const b of bucketIds) {
    const mem = __enrichBucketMem.get(b);
    if (mem && mem.exp > nowB) bucketData.set(b, mem.items);
  }
  const missBuckets = bucketIds.filter((b) => !bucketData.has(b));
  if (missBuckets.length && env.TMDB_CACHE && !kvIsDown()) {
    await Promise.all(
      missBuckets.map(async (b) => {
        try {
          const raw = await env.TMDB_CACHE.get(CK.enrichBucket(b), {
            type: "json",
            cacheTtl: 600,
          });
          const items = raw && raw.items && typeof raw.items === "object" ? raw.items : {};
          bucketData.set(b, items);
          __enrichBucketMem.set(b, {
            items,
            exp: Date.now() + ENRICH_BUCKET_MEM_TTL,
          });
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
      kvMemSet(CK.enrich(key), hit, KV_MEM_TTL);
    } else {
      needFetch.push(key);
    }
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
  await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);

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
    kvMemSet(CK.enrich(key), val || { miss: 1 }, val ? KV_MEM_TTL : 30000);
  }

  for (const b of dirty) {
    const items = bucketData.get(b);
    const ks = Object.keys(items);
    if (ks.length > ENRICH_BUCKET_MAX) {
      ks.sort((x, y) => (items[x].ts || 0) - (items[y].ts || 0));
      for (let i = 0; i < ks.length - ENRICH_BUCKET_MAX; i++) delete items[ks[i]];
    }
    const payload = JSON.stringify({ v: 1, items });
    __enrichBucketMem.set(b, {
      items,
      exp: Date.now() + ENRICH_BUCKET_MEM_TTL,
    });
    const p = env.TMDB_CACHE
      ? env.TMDB_CACHE.put(CK.enrichBucket(b), payload, {
          expirationTtl: ENRICH_BUCKET_TTL,
        })
          .then(() => kvMarkUp())
          .catch(() => kvMarkDown())
      : Promise.resolve();
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
  }

  return out;
}

/** POST /api/enrich：客户端批量补数据接口 */
async function handleEnrich(request, env, ctx) {
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
      "Cache-Control": "private, max-age=300",
    },
  });
}

/** 通用卡片渲染：横排行卡片（手机）/竖版海报网格（桌面）共用的 HTML 结构 */
function mediaItem(opts) {
  const style = opts.delay != null ? ` style="animation-delay:${opts.delay}ms"` : "",
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
    rewatchBadge = opts.isRewatch ? `<span class="cw-badge-rewatch">重温</span>` : "",
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
    enrichAttrs = opts.enrichKey ? ` data-enrich-key="${esc(opts.enrichKey)}"` : "",
    clickable = opts.detailType && opts.detailId ? " clickable" : "",
    tagHtml =
      opts.tag && opts.tagClass === "upcoming"
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
  const calendarBtnHtml = calendarBtns ? `<div class="cal-action-row">${calendarBtns}</div>` : "";

  const lockPosterAttr = opts.lockPoster || opts.hasPoster ? ` data-lock-poster="1"` : "";
  return `<div class="item${clickable}"${dataAttrs}${enrichAttrs}${lockPosterAttr}${style}>${removeHtml}${watchedHtml}${unwatchHtml}<div class="poster">${opts.poster ? `<img src="${opts.poster}" loading="lazy" alt="">` : `<div class="poster-ph"><span>${opts.tagClass === "movie" ? "🎬" : "📺"}</span></div>`}${playHtml}${dropHtml}</div><div class="info"><div class="name-row"><span class="name">${esc(opts.title)}</span>${rewatchBadge}${tagHtml}</div>${opts.line1 ? `<div class="meta">${esc(opts.line1)}</div>` : ""}${opts.overview ? `<div class="overview">${esc(opts.overview)}</div>` : ""}${opts.line2 ? `<div class="meta dim">${esc(opts.line2)}</div>` : ""}${bar}${cwActionsHtml}${calendarBtnHtml}</div></div>`;
}

/** 观看记录页渲染 */
function renderHistoryPage(items, env, isFragment) {
  if (isFragment === undefined) isFragment = false;
  if (!Array.isArray(items)) return isFragment ? "" : emptyPaneHtml("暂时无法加载观看记录");
  if (!items.length) return isFragment ? "" : emptyView("还没有观看记录");

  return items
    .map((item, i) => {
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
    })
    .join("");
}

/** 待看列表空态 HTML */
function emptyWatchlistHtml() {
  return `<div class="empty"><svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg><p>待看列表是空的</p><p style="font-size:0.82rem;color:#5a6474;margin-top:10px;line-height:1.6;text-align:center">去 Trakt 上把想看的电影 / 剧集加入 watchlist，这里就会显示</p></div>`;
}

/** 待看列表条目渲染（grid 模式） */
function renderWatchlistItems(items, env) {
  if (!Array.isArray(items) || !items.length) return "";
  return items
    .map((item, i) => {
      const e = buildBaseItem(item);
      if (!e.title || !e.detailId) return "";

      const when = item.listed_at ? "添加于 " + fmtRelative(item.listed_at) : "",
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

      const poster = item.__stillUrl || (item.episode && item.episode.__stillUrl) || e.poster;
      const lockPoster = !!(
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

/** 生成 Infuse 播放深链 */
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
    const mid = pickTmdb(item.__tmdbId, movie.ids && movie.ids.tmdb, movie.tmdb);
    if (mid) return `infuse://movie/${mid}?play`;
    return null;
  }

  const show = item.show || {};
  const ep = item.episode || (item.progress && item.progress.next_episode) || null;
  const tmdbId = pickTmdb(
    item.__tmdbId,
    show.ids && show.ids.tmdb,
    show.tmdb,
    ep && ep.ids && ep.ids.tmdb,
  );
  if (!tmdbId) return null;

  const season = ep ? (ep.season != null ? ep.season : ep.season_number) : null;
  const number = ep ? (ep.number != null ? ep.number : ep.episode_number) : null;
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

/** 继续观看渲染：hscroll（首页横滑）/ fragment / grid（弹窗网格）三种模式 */
function renderContinueItems(upNext, mode = "grid") {
  if (mode === true) mode = "fragment";

  const items = [];
  if (Array.isArray(upNext)) {
    for (const entry of upNext) {
      if (entry.episode) {
        if (typeof entry.progress === "number" && entry.progress >= 90) continue;
        if (entry.__tmdbId && entry.show && entry.show.ids && !entry.show.ids.tmdb) {
          entry.show.ids.tmdb = entry.__tmdbId;
        }
        items.push({
          source: "playback",
          sortKey: entry.paused_at || entry.last_watched_at || "",
          raw: entry,
          stillUrl: entry.__stillUrl || (entry.episode && entry.episode.__stillUrl) || null,
          backdropUrl: entry.__backdropUrl || null,
          zhTitle: entry.__zhTitle || null,
        });
      } else if (entry.show && entry.progress && entry.progress.next_episode) {
        const completed = Number(entry.progress.completed);
        const aired = Number(entry.progress.aired);
        if (Number.isFinite(completed) && completed <= 0) continue;
        if (Number.isFinite(completed) && Number.isFinite(aired) && aired > 0 && completed >= aired)
          continue;

        const next = entry.progress.next_episode;
        const showObj = entry.show || {};
        if (entry.__tmdbId) {
          if (!showObj.ids) showObj.ids = {};
          if (!showObj.ids.tmdb) showObj.ids.tmdb = entry.__tmdbId;
        }
        items.push({
          source: "upnext",
          sortKey: entry.last_watched_at || entry.progress.last_watched_at || "",
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
            __tmdbId: entry.__tmdbId || (showObj.ids && showObj.ids.tmdb) || null,
          },
          stillUrl: entry.__stillUrl || (next && next.__stillUrl) || null,
          backdropUrl: entry.__backdropUrl || null,
          zhTitle: entry.__zhTitle || null,
        });
      } else if (entry.movie) {
        if (typeof entry.progress === "number" && entry.progress >= 90) continue;
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

  items.sort((a, b) => (b.sortKey || "").localeCompare(a.sortKey || ""));

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
      playPct = typeof item.progress === "number" ? Math.round(item.progress) : null,
      e = buildBaseItem(item),
      coverImg =
        it.stillUrl ||
        item.__stillUrl ||
        (item.episode && item.episode.__stillUrl) ||
        it.backdropUrl ||
        item.__backdropUrl ||
        posterOfTrakt(item.episode) ||
        null;

    if (!coverImg) {
      coverImg = it.backdropUrl || item.__backdropUrl || continueImageOf(item) || e.poster;
    }

    let barPct = playPct;
    if (barPct == null && it.showProgress && it.showProgress.aired > 0) {
      barPct = Math.max(
        0,
        Math.min(100, Math.round((it.showProgress.completed / it.showProgress.aired) * 100)),
      );
    }

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
      epLabel = `第${epSeason}季·${epNumber}集`;
    }

    const showTitle =
      it.zhTitle ||
      item.__zhTitle ||
      e.title ||
      show.title ||
      "" ||
      (item.movie && item.movie.title) ||
      "";

    let totalEps = null;
    if (it.showProgress && Number(it.showProgress.aired) > 0) {
      totalEps = Math.floor(Number(it.showProgress.aired));
    } else if (show && show.aired_episodes != null && Number(show.aired_episodes) > 0) {
      totalEps = Math.floor(Number(show.aired_episodes));
    }
    const totalSuffix = totalEps ? ` · 共${totalEps}集` : "";

    let watchingLine = "";
    if (epLabel) {
      if (it.source === "upnext") {
        watchingLine = `下一集 ${epLabel}${totalSuffix}`;
      } else if (item.__isRewatch) {
        watchingLine = `重温中 ${epLabel}${totalSuffix}`;
      } else {
        watchingLine = `正在看 ${epLabel}${totalSuffix}`;
      }
    } else if (isMovie && playPct != null) {
      watchingLine = `已看 ${playPct}%`;
    } else if (it.showProgress && it.showProgress.aired > 0) {
      watchingLine = `已看 ${it.showProgress.completed}/${it.showProgress.aired} 集`;
    }

    let progressLabel = "";
    if (playPct != null) {
      progressLabel = `已看 ${playPct}%`;
    } else if (it.showProgress && it.showProgress.aired > 0) {
      progressLabel = `已看 ${it.showProgress.completed}/${it.showProgress.aired} 集`;
    } else if (epLabel) {
      progressLabel = epLabel;
    }

    const relTime = fmtRelative(it.sortKey) || "";

    let watchedType = null,
      watchedId = null;
    if (item.movie && item.movie.ids && item.movie.ids.trakt) {
      watchedType = "movie";
      watchedId = item.movie.ids.trakt;
    } else if (item.episode && item.episode.ids && item.episode.ids.trakt) {
      watchedType = "episode";
      watchedId = item.episode.ids.trakt;
    }

    // 有百分比进度的条目（正在看的剧集/看到一半的电影，卡片显示「已看 x%」）：
    // 播放链接追加 ?play，点击后直接开始播放；其余条目（如「下一集」）保持原跳转不变
    let playHref = buildInfuseHrefForContinue(item);
    if (playHref && playPct != null && playHref.indexOf("?") < 0) {
      playHref += "?play";
    }

    const dropShowId = !isMovie && show.ids && show.ids.trakt ? String(show.ids.trakt) : null;

    if (mode === "hscroll" || mode === "fragment") {
      const dataAttrs =
        e.detailType && e.detailId
          ? ` data-detail-type="${esc(e.detailType)}" data-detail-id="${esc(e.detailId)}" role="button" tabindex="0"`
          : "";
      const enrichAttrs = e.enrichKey ? ` data-enrich-key="${esc(e.enrichKey)}"` : "";
      const clickable = e.detailType && e.detailId ? " clickable" : "";
      const style = delay ? ` style="animation-delay:${delay}ms"` : "";
      const posterHtml = coverImg
        ? `<img src="${esc(coverImg)}" loading="lazy" alt="">`
        : `<div class="poster-ph"><span>${isMovie ? "🎬" : "📺"}</span></div>`;
      const playHtml = playHref
        ? `<a class="poster-play" href="${esc(playHref)}" rel="noopener" aria-label="在 Infuse 中播放" title="在 Infuse 中播放" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" stroke="none"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11.04-6.86a1 1 0 0 0 0-1.72L9.5 4.28A1 1 0 0 0 8 5.14z"/></svg></a>`
        : "";
      const overlayHtml = progressLabel
        ? `<div class="cw-overlay">${esc(progressLabel)}</div>`
        : "";
      const barHtml =
        barPct != null
          ? `<div class="cw-bar"><div class="cw-bar-fill" style="width:${barPct}%"></div></div>`
          : "";
      const menuHtml = dropShowId
        ? `<button class="cw-more" type="button" data-cw-menu data-cw-drop-id="${esc(dropShowId)}" data-cw-name="${esc(showTitle)}" data-cw-season="${esc(String(epSeason != null ? epSeason : ""))}" data-cw-episode="${esc(String(epNumber != null ? epNumber : ""))}" data-cw-media-type="${esc(watchedType || "")}" data-cw-media-id="${esc(watchedId != null ? String(watchedId) : "")}" aria-label="更多操作" title="更多"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="5" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/></svg></button>`
        : "";
      const cwActionsHtml = "";
      const watchedHtml =
        watchedType && watchedId
          ? `<button class="wl-watched" type="button" data-watched-type="${esc(watchedType)}" data-watched-id="${esc(String(watchedId))}" aria-label="标记为已看" title="标记为已看">✓</button>`
          : "";

      const lockAttr =
        item.__stillUrl ||
        (item.episode && item.episode.__stillUrl) ||
        item.__backdropUrl ||
        coverImg
          ? ` data-lock-poster="1"`
          : "";

      const rewatchBadge = item.__isRewatch ? `<span class="cw-badge-rewatch">重温</span>` : "";

      return `<div class="cw-card item${clickable}"${dataAttrs}${enrichAttrs}${lockAttr}${style}>${watchedHtml}<div class="cw-poster">${posterHtml}${overlayHtml}${barHtml}${playHtml}</div><div class="cw-info"><div class="cw-title-row"><span class="cw-title">${esc(showTitle)}</span>${rewatchBadge}${menuHtml}</div>${watchingLine ? `<div class="cw-watching">${esc(watchingLine)}</div>` : ""}${relTime ? `<div class="cw-meta">${esc(relTime)}</div>` : ""}${cwActionsHtml}</div></div>`;
    }

    return mediaItem({
      poster: coverImg || e.poster,
      tag: e.tag,
      tagClass: e.tagClass,
      title: showTitle || e.title,
      overview: e.overview,
      line1: watchingLine || (epLabel ? `正在看 ${epLabel}` : e.line1),
      line2: relTime || (playPct != null ? `已看 ${playPct}%` : ""),
      pct: barPct,
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

  if (mode === "hscroll") return `<div class="h-scroll">${parts.join("")}</div>`;
  return parts.join("");
}

/** 追剧日历页渲染（按天分组） */
function renderCalendarPage(calendar, env, zhTitles) {
  if (!Array.isArray(calendar)) return emptyPaneHtml("暂时无法加载追剧日历");
  if (!calendar.length) return emptyView("未来 30 天没有待播剧集");

  const toBeijingDay = (iso) => {
      if (!iso) return "";
      const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    },
    groups = new Map();

  for (const item of calendar) {
    const day = toBeijingDay(item.first_aired);
    if (!day) continue;
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(item);
  }

  const today = toBeijingDay(new Date().toISOString()),
    out = [];

  for (const [day, items] of groups.entries()) {
    items.sort((a, b) => (a.first_aired || "").localeCompare(b.first_aired || ""));

    const d = new Date(day + "T00:00:00Z"),
      wd = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getUTCDay()],
      isToday = day === today,
      parts = items.map((item) => {
        let timeStr = "";
        if (item.first_aired) {
          const bj = new Date(new Date(item.first_aired).getTime() + 8 * 3600 * 1000);
          timeStr = `${String(bj.getUTCHours()).padStart(2, "0")}:${String(bj.getUTCMinutes()).padStart(2, "0")}`;
        }

        const e = buildBaseItem(item),
          showTraktId = item.show && item.show.ids ? item.show.ids.trakt : null,
          zhTitle = showTraktId != null && zhTitles ? zhTitles[showTraktId] : null,
          displayTitle = zhTitle || e.title || "未知节目";

        return mediaItem({
          poster: e.poster,
          tagClass: "upcoming",
          title: displayTitle,
          overview: e.overview,
          line1: e.line1,
          line2: timeStr,
          detailType: e.detailType,
          detailId: e.detailId,
          enrichKey: e.enrichKey,
          calendarShowId: showTraktId ? String(showTraktId) : null,
          calendarShowName: displayTitle,
          calendarTmdbId: (item.show && item.show.ids && item.show.ids.tmdb) || null,
          dropShowId: showTraktId ? String(showTraktId) : null,
        });
      });

    out.push(
      `<div class="day"><div class="day-head"><span class="day-num">${day.slice(8)}</span><div><div class="day-mon">${day.slice(0, 7)}</div><div class="day-wd">${wd}</div></div>${isToday ? '<span class="today">今天</span>' : ""}</div><div class="grid">${parts.join("")}</div></div>`,
    );
  }
  return out.join("");
}

/** 在整季集列表中定位第一个未看集 */
function firstUnwatchedEpisode(userProgress) {
  if (!userProgress || userProgress.__error) return null;

  const ne = userProgress.next_episode;
  if (ne && ne.season != null && ne.number != null) return ne;

  const seasons = Array.isArray(userProgress.seasons) ? userProgress.seasons : [];
  for (const s of seasons) {
    if (!s || !(s.number > 0) || !Array.isArray(s.episodes)) continue;
    for (const ep of s.episodes) {
      if (ep && ep.number != null && !ep.completed) return { season: s.number, number: ep.number };
    }
  }
  return null;
}

/** 详情页 HTML（hero、季列表、演职员等） */
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
    deferExtras = !!d.deferExtras;

  const title = (tmdb && (tmdb.title || tmdb.name)) || entity.title || "",
    overview = (tmdb && tmdb.overview) || entity.overview || "",
    year =
      (((tmdb && tmdb.release_date) || (tmdb && tmdb.first_air_date) || "") + "").slice(0, 4) ||
      (entity.year ? String(entity.year) : ""),
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
      tmdb && tmdb.poster_path ? tmdbPoster(tmdb.poster_path, "w342") : posterOfTrakt(entity),
    backdrop = tmdb && tmdb.backdrop_path ? tmdbPoster(tmdb.backdrop_path, "w780") : null,
    tagline = entity.tagline || "",
    showSlug = (entity.ids && entity.ids.slug) || "",
    doubanQuery = ((title || "") + (year ? " " + year : "")).trim(),
    doubanUrl = doubanQuery
      ? `${DOUBAN_SEARCH}?search_text=${encodeURIComponent(doubanQuery)}`
      : "";

  const finalImdbId =
    imdbId ||
    (tmdb && (tmdb.imdb_id || (tmdb.external_ids && tmdb.external_ids.imdb_id))) ||
    (entity.ids && entity.ids.imdb) ||
    null;

  const pausedEpInfo = () => {
    if (!pausedEntry || !pausedEntry.episode) return null;
    const pe = pausedEntry.episode;
    const ps = pe.season != null ? pe.season : pe.season_number;
    const pn = pe.number != null ? pe.number : pe.episode_number;
    if (ps == null || pn == null) return null;
    const playPct =
      typeof pausedEntry.progress === "number" ? Math.round(pausedEntry.progress) : null;
    const verb = pausedIsRewatch ? "重温中" : "正在看";
    return { ps, pn, playPct, verb };
  };
  const pausedStatusHtml = () => {
    const pi = pausedEpInfo();
    if (!pi) return "";
    const title = `${pi.verb} 第${pi.ps}季·${pi.pn}集${pi.playPct != null ? ` · ${pi.playPct}%` : ""}`;
    const sub = pausedEntry.paused_at ? "上次 " + fmtRelative(pausedEntry.paused_at) : "";
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
  } else if (userProgress && !userProgress.__error && userProgress.aired > 0) {
    const pct = Math.round((userProgress.completed / userProgress.aired) * 100);
    const pi = pausedEpInfo();
    let title,
      sub,
      barPct = pct;
    if (pi) {
      title = `${pi.verb} 第${pi.ps}季·${pi.pn}集${pi.playPct != null ? ` · ${pi.playPct}%` : ""}`;
      const parts = [];
      if (userProgress.completed > 0)
        parts.push(`已看 ${userProgress.completed} / ${userProgress.aired} 集`);
      const lastAt = pausedEntry.paused_at || userProgress.last_watched_at;
      if (lastAt) parts.push("上次 " + fmtRelative(lastAt));
      sub = parts.join(" · ");
      if (pi.playPct != null) barPct = pi.playPct;
    } else {
      title = `已看 ${userProgress.completed} / ${userProgress.aired} 集 · ${pct}%`;
      sub = userProgress.last_watched_at ? "上次 " + fmtRelative(userProgress.last_watched_at) : "";
    }
    statusHtml = `<div class="d-status done d-status-progress"><div class="d-status-row"><div class="d-status-icon">▶</div><div class="d-status-body"><div class="d-status-title">${esc(title)}</div><div class="d-status-sub">${esc(sub)}</div></div></div><div class="bar"><div class="bar-fill" style="width:${barPct}%"></div></div></div>`;
  } else if (!isMovie && pausedEpInfo()) {
    statusHtml = pausedStatusHtml();
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

  let barBtns = "";
  if (isMovie && traktId) {
    if (movieWatched)
      barBtns += `<button class="d-act d-act-watched active" type="button" data-unmark-movie="${esc(String(traktId))}" title="取消观看">${iconCheck}</button>`;
    else
      barBtns += `<button class="d-act d-act-watched" type="button" data-mark-movie="${esc(String(traktId))}" title="标记已看">${iconCheck}</button>`;
  } else if (!isMovie && traktId && initialSeasonNum != null) {
    const seasonProgress = Array.isArray(userProgress && userProgress.seasons)
      ? userProgress.seasons.find((s) => s.number === initialSeasonNum)
      : null;
    const seasonTotal =
      initialSeasonData && Array.isArray(initialSeasonData.episodes)
        ? initialSeasonData.episodes.length
        : 0;
    const seasonWatched = seasonProgress ? Number(seasonProgress.completed) || 0 : 0;
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
        const s = ne ? (ne.season != null ? ne.season : ne.season_number) : null;
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

  const actionsHtml = barBtns ? `<div class="d-action-bar">${barBtns}</div>` : "";

  const cast = (credits && credits.cast ? credits.cast : []).slice(0, 20);
  const castInner = cast
    .map((c) => {
      const initial = Array.from(c.name || "?")[0] || "?";
      const pid = c.id ? String(c.id) : "";
      const personAttrs = pid
        ? ` data-person-id="${esc(pid)}" data-person-name="${esc(c.name || "")}" role="button" tabindex="0"`
        : "";
      const cls = "cast" + (pid ? " clickable" : "");
      return `<div class="${cls}"${personAttrs}>${c.profile_path ? `<img class="cast-img" src="${TMDB_IMG}/w185${c.profile_path}" loading="lazy" alt="">` : `<div class="cast-img cast-ph">${esc(initial)}</div>`}<div class="cast-name">${esc(c.name || "")}</div><div class="cast-role">${esc(c.character || "")}</div></div>`;
    })
    .join("");

  const recs = (recommendations && recommendations.results ? recommendations.results : []).slice(
    0,
    12,
  );

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
    castSectionHtml = `<section class="d-section" data-defer-parent="cast"><h2 class="d-section-title">演员</h2><div class="cast-scroll" data-defer-section="cast"><div class="pane-loading" style="padding:16px 0"><div class="spinner"></div></div></div></section>`;
  } else if (castInner) {
    castSectionHtml = `<section class="d-section"><h2 class="d-section-title">演员</h2><div class="cast-scroll">${castInner}</div></section>`;
  }

  const trailersSectionHtml = deferExtras
    ? `<section class="d-section" data-defer-parent="trailers"><h2 class="d-section-title">预告片</h2><div class="trailer-grid" data-defer-section="trailers"><div class="pane-loading" style="padding:16px 0"><div class="spinner"></div></div></div></section>`
    : "";

  let recsSectionHtml = "";
  if (deferExtras) {
    recsSectionHtml = `<section class="d-section" data-defer-parent="recs"><h2 class="d-section-title">相关推荐</h2><div class="grid" data-defer-section="recs"><div class="pane-loading" style="padding:16px 0"><div class="spinner"></div></div></div></section>`;
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
  } else if (thirdParty || traktRating != null || tmdbRating != null || doubanUrl) {
    ratingsSectionHtml = `<div class="detail-ext-ratings">${renderExtRatings(thirdParty, { trakt: traktRating, tmdb: tmdbRating, doubanUrl })}</div>`;
  }

  let seasonsHtml = "";
  if (!isMovie && tmdb && tmdb.seasons && tmdb.seasons.length) {
    const progressSeasons = new Map();
    if (Array.isArray(userProgress && userProgress.seasons))
      userProgress.seasons.forEach((s) => progressSeasons.set(s.number, s));

    const seasons = tmdb.seasons.filter((s) => s.season_number > 0);
    seasonsHtml = `<div class="seasons">${seasons
      .map((s) => {
        const sp = progressSeasons.get(s.season_number),
          total = s.episode_count || 0,
          watched = sp ? sp.completed || 0 : 0,
          isOpen = s.season_number === initialSeasonNum,
          bodyContent =
            isOpen && initialSeasonData
              ? renderSeasonEpisodes(
                  sp,
                  initialSeasonData,
                  s.season_number,
                  showSlug,
                  isOpen ? initialTraktEpisodes : [],
                  tmdb && tmdb.id,
                )
              : "",
          loadedAttr = isOpen && bodyContent ? ' data-loaded="1"' : "";

        const loadingBody =
          isOpen && !bodyContent
            ? '<div class="modal-loading" style="padding:24px"><div class="spinner"></div></div>'
            : "";

        return `<div class="season-item${isOpen ? " open" : ""}"><div class="season-head" data-show="${traktId ? esc(String(traktId)) : ""}" data-season="${s.season_number}" data-tmdb="${esc(String(tmdb.id))}" data-slug="${esc(showSlug)}"><span class="season-title">${esc(s.name || "第 " + s.season_number + " 季")}</span><span class="season-meta">${watched} / ${total} 集</span><svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></div><div class="season-body"${loadedAttr}>${bodyContent || loadingBody}</div></div>`;
      })
      .join("")}</div>`;
  }

  const rootAttrs = ` data-tmdb-id="${esc(String((tmdb && tmdb.id) || ""))}" data-imdb-id="${esc(String(finalImdbId || ""))}" data-douban-query="${esc(doubanQuery)}"`;

  return `<div class="detail-wrap"${rootAttrs}><div class="detail-hero">${backdrop ? `<img class="detail-bg" src="${backdrop}" alt="">` : ""}<div class="detail-inner">${poster ? `<img class="detail-poster" src="${poster}" alt="">` : `<div class="detail-poster detail-poster-ph">${isMovie ? "🎬" : "📺"}</div>`}<div class="detail-info"><h1 class="detail-title">${esc(title)}</h1>${tagline ? `<div class="detail-tagline">${esc(tagline)}</div>` : ""}<div class="detail-meta">${year ? `<span>${esc(year)}</span>` : ""}${runtimeStr ? `<span>${esc(runtimeStr)}</span>` : ""}</div>${ratingsSectionHtml}${genres ? `<div class="detail-genres">${esc(genres)}</div>` : ""}${overview ? `<p class="detail-overview">${esc(overview)}</p>` : ""}${statusHtml}${actionsHtml}</div></div></div><div class="detail-body">${castSectionHtml}${trailersSectionHtml}${seasonsHtml}${recsSectionHtml}</div></div>`;
}

/** 某季的集列表 HTML（含已看状态与操作按钮） */
function renderSeasonEpisodes(
  seasonProgress,
  tmdbSeason,
  seasonNum,
  showSlug,
  traktEpisodes,
  tmdbShowId,
) {
  if (!tmdbSeason || !Array.isArray(tmdbSeason.episodes) || !tmdbSeason.episodes.length)
    return '<div class="ep-empty">暂无剧集信息</div>';

  const watched = new Map();
  if (Array.isArray(seasonProgress && seasonProgress.episodes))
    seasonProgress.episodes.forEach((e) => watched.set(e.number, e));

  const traktMap = new Map();
  if (Array.isArray(traktEpisodes))
    traktEpisodes.forEach((e) => {
      if (e && e.number != null) traktMap.set(e.number, e);
    });

  const fmtAirDate = (d) => {
    if (!d) return "";
    const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return d;
    return `${m[1]} 年 ${m[2]} 月 ${m[3]} 日`;
  };

  return tmdbSeason.episodes
    .map((ep) => {
      const num = ep.episode_number,
        w = watched.get(num),
        isWatched = !!(w && w.completed),
        traktEp = traktMap.get(num);

      const epId =
        (traktEp && traktEp.ids && traktEp.ids.trakt) || (w && w.ids && w.ids.trakt) || null;

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
      const watchHtml = isWatched
        ? `<span class="ep-status watched" title="已看">已看</span>`
        : epId
          ? `<button class="ep-status unwatched ep-watch-btn" type="button" data-episode-id="${esc(String(epId))}" data-episode-title="${esc(ep.name || "")}" title="标记本集已看">未看</button>`
          : `<span class="ep-status unwatched">未看</span>`;
      const actionHtml = `${playHtml}${watchHtml}`;

      const still = ep.still_path ? tmdbPoster(ep.still_path, "w300") : null;
      const stillHtml = still
        ? `<img class="ep-still" src="${esc(still)}" loading="lazy" alt="">`
        : `<div class="ep-still ep-still-ph">📺</div>`;

      let title = (ep.name || "").trim();
      if (!title || /^Episode\s*\d+$/i.test(title) || /^第\s*\d+\s*集$/.test(title)) {
        title = `第 ${num} 集`;
      }
      const vote =
        typeof ep.vote_average === "number" && ep.vote_average > 0
          ? ep.vote_average.toFixed(1)
          : null;
      const runtime = typeof ep.runtime === "number" && ep.runtime > 0 ? `${ep.runtime}m` : "";
      const air = fmtAirDate(ep.air_date);
      const metaParts = [];
      if (vote != null) metaParts.push(`<span class="ep-vote">★ ${vote}</span>`);
      if (air) metaParts.push(`<span>${esc(air)}</span>`);
      if (runtime) metaParts.push(`<span>${esc(runtime)}</span>`);
      const metaHtml = metaParts.length
        ? `<div class="ep-meta">${metaParts.join('<span class="ep-dot">·</span>')}</div>`
        : "";

      const titleIsGeneric =
        !title || /^第\s*\d+\s*集$/.test(title) || /^Episode\s*\d+$/i.test(title);
      const titleHtml = titleIsGeneric
        ? `<span class="ep-title">第 ${num} 集</span>`
        : `<span class="ep-num">${num}</span><span class="ep-title">${esc(title)}</span>`;
      return `<div class="episode${isWatched ? " watched" : ""}${clickable}"${attrs}><div class="ep-still-wrap">${stillHtml}${isWatched ? '<span class="ep-still-badge">已看</span>' : ""}</div><div class="ep-body"><div class="ep-head"><div class="ep-title-line">${titleHtml}</div><div class="ep-actions">${actionHtml}</div></div>${metaHtml}${ep.overview ? `<div class="ep-overview">${esc(ep.overview)}</div>` : ""}</div></div>`;
    })
    .join("");
}

/** 空态视图 HTML */
function emptyView(opts) {
  if (typeof opts === "string") opts = { text: opts };
  const text = opts.text || "";
  if (opts.error)
    return `<div class="empty" style="color:#9db5e0;padding:80px 20px"><p style="margin:0;font-size:1rem">${esc(text)}</p></div>`;
  return `<div class="empty"><svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg><p>${text}</p></div>`;
}

/** 面板空态/错误 HTML */
function emptyPaneHtml(text) {
  return `<div class="empty" style="padding:70px 20px"><p style="margin:0;font-size:.95rem">${esc(text)}</p><p style="font-size:.82rem;color:#7a8394;margin-top:10px">稍后重试即可恢复</p></div>`;
}

/** 生成随机字符串 */
function randomString(len) {
  const cs = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~",
    v = new Uint8Array(len);
  crypto.getRandomValues(v);
  let s = "";
  for (let i = 0; i < len; i++) s += cs[v[i] % cs.length];
  return s;
}

/** 生成 PKCE code_challenge */
async function pkceChallenge(verifier) {
  const data = new TextEncoder().encode(verifier),
    digest = await crypto.subtle.digest("SHA-256", data);
  return b64urlEncode(String.fromCharCode(...new Uint8Array(digest)), true);
}

/** base64url 编码 */
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

/** base64url 解码 */
function b64urlDecode(str) {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  if (pad) b64 += "=".repeat(4 - pad);
  const bin = atob(b64),
    bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** 服务端 HTML 转义 */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 转义为可安全内嵌 <script> 的 JS 字符串 */
function jsStr(s) {
  return JSON.stringify(String(s == null ? "" : s))
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** 数字补零 */
function pad(n) {
  return String(n == null ? 0 : n).padStart(2, "0");
}

/** 时间戳 → 相对时间文案（x分钟前 等） */
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
  return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

/** 构造 HTML Response（禁缓存头） */
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


/* ============================================================
 * 二十二、分页接口与登录 / 启动页
 * ============================================================ */
async function handleMore(request, env, ctx) {
  const url = new URL(request.url),
    type = url.searchParams.get("type"),
    page = parseInt(url.searchParams.get("page") || "2"),
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
          pageCount: parseInt(r.headers.get("X-Pagination-Page-Count") || "1") || 1,
        };
      },
      { ttl: 300, missTtl: 60, swr: true, edgeTtl: 120, jitter: 120 },
    );

    if (!data || !Array.isArray(data.items)) return new Response("", { status: 502 });
    const pageCount = data.pageCount || 1;
    return authResp(auth, needsCookieUpdate, renderHistoryPage(data.items, env, true), {
      extra: {
        "X-Has-More": String(page < pageCount),
        "X-Page": String(page),
        "X-Page-Count": String(pageCount),
      },
    });
  }

  if (type === "playback") {
    const limit = limitParam > 0 ? Math.min(limitParam, 60) : 20;
    const data = await cachedJSON(
      env,
      ctx,
      CK.morePlayback(userKey, page, limit),
      async () => {
        let upNextItems = [];
        let pageCount = 0;
        let r;
        try {
          for (let i = 0; i < 3; i++) {
            r = await fetchT(
              `${TRAKT_API}/sync/progress/up_next_nitro?extended=full&images=poster,screenshot,fanart&limit=${limit}&page=${page}&intent=continuing`,
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
        try {
          upNextItems = await r.json();
        } catch {
          upNextItems = [];
        }
        if (!Array.isArray(upNextItems)) upNextItems = [];
        pageCount = parseInt(r.headers.get("X-Pagination-Page-Count") || "0") || 0;

        let pausedItems = [];
        if (page === 1) {
          try {
            const pr = await fetchT(`${TRAKT_API}/sync/playback?extended=full`, { headers }, 9000);
            if (pr && pr.ok) {
              const pj = await pr.json();
              if (Array.isArray(pj)) pausedItems = pj;
            }
          } catch {}
        }

        let items = upNextItems;
        if (page === 1) {
          let droppedSet = null;
          try {
            droppedSet = await getDroppedShowIds(headers, env, ctx, userKey);
          } catch {
            droppedSet = null;
          }
          let watchedEpIds = null;
          try {
            watchedEpIds = await getWatchedEpisodeIds(headers, env, ctx, userKey);
          } catch {
            watchedEpIds = null;
          }
          let hideMap = {};
          try {
            hideMap = await getCwHideMap(env, ctx, userKey);
          } catch {
            hideMap = {};
          }
          items = mergeContinueLists(pausedItems, upNextItems, limit, droppedSet, null, hideMap);
          if (items && items.__autoUnhide && items.__autoUnhide.length && hideMap) {
            let changed = false;
            for (const sid of items.__autoUnhide) {
              const k = String(sid);
              if (hideMap[k] || hideMap[sid]) {
                delete hideMap[k];
                delete hideMap[sid];
                changed = true;
              }
            }
            if (changed) putCwHideMap(env, ctx, userKey, hideMap);
          }
          applyRewatchFlags(items, watchedEpIds);
        } else if (Array.isArray(items) && items.length) {
          try {
            const droppedSet = await getDroppedShowIds(headers, env, ctx, userKey);
            if (droppedSet && droppedSet.size) {
              items = items.filter((entry) => {
                const id = entry && entry.show && entry.show.ids && entry.show.ids.trakt;
                return id == null || !droppedSet.has(Number(id));
              });
            }
          } catch {}
        }
        return { items, pageCount };
      },
      { ttl: 300, missTtl: 60, swr: true, edgeTtl: 120, jitter: 150 },
    );

    if (!data || !Array.isArray(data.items)) return new Response("", { status: 502 });
    const list = data.items;
    const pageCount = data.pageCount || 0;
    const hasMore = pageCount > 0 ? page < pageCount : list.length >= limit;

    await attachContinueStillsForPlayback(list, env, ctx, userKey);
    const mode = (url.searchParams.get("mode") || "fragment").toLowerCase();
    const renderMode = mode === "grid" ? "grid" : mode === "hscroll" ? "hscroll" : "fragment";
    return authResp(auth, needsCookieUpdate, renderContinueItems(list, renderMode), {
      extra: {
        "X-Has-More": String(hasMore),
        "X-Page": String(page),
      },
    });
  }

  if (type === "watchlist") {
    const sort = url.searchParams.get("sort") || "added",
      pageNum = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1),
      merged = await getWatchlist(headers, sort, env, ctx, userKey),
      start = (pageNum - 1) * WATCHLIST_PAGE_SIZE,
      slice = Array.isArray(merged) ? merged.slice(start, start + WATCHLIST_PAGE_SIZE) : [],
      hasMore = Array.isArray(merged) ? start + WATCHLIST_PAGE_SIZE < merged.length : false;

    await attachWatchlistStills(slice, env, ctx, userKey);
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

/** 登录页 HTML（Trakt 设备码流程） */
function renderLoginPage() {
  return pageShell(
    `<div class="login-wrap"><div class="login-card"><div class="login-logo"><img src="${ICON_192}" alt="MineTrakt" width="64" height="64" style="display:block;margin:0 auto"></div><h1 class="login-title">MineTrakt</h1><p class="login-sub">首页 · 待看列表 · 追剧日历 · 观看记录</p><div id="login-area" class="login-area"><button class="btn-primary" onclick="startLogin()">使用 Trakt 登录</button></div></div></div><script>async function startLogin(){const area=document.getElementById('login-area');window.__loginGen=(window.__loginGen||0)+1;const gen=window.__loginGen;area.innerHTML='<div class="spinner"></div>';let r;try{r=await fetch('/auth/device');}catch(e){if(gen!==window.__loginGen)return;area.innerHTML='<div class="err-box"><p class="err-title">网络错误</p><p class="err">'+String(e)+'</p></div><button class="btn-primary" onclick="startLogin()">重试</button>';return;}if(gen!==window.__loginGen)return;if(!r.ok){const err=await r.json().catch(()=>({}));if(gen!==window.__loginGen)return;if(r.status===429||err.rateLimited){var wait=Number(err.retryAfter)||30;area.innerHTML='<div class="err-box" style="background:rgba(255,184,77,.10);border-color:rgba(255,184,77,.28)"><p class="err-title" style="color:#ffb84d">请求过于频繁</p><p class="err" style="color:#ffd693">Trakt 限流了，请 <span id="rl-count">'+wait+'</span> 秒后再试</p></div><button class="btn-primary" id="rl-btn" disabled style="opacity:.5;cursor:not-allowed">请稍候…</button>';var cnt=document.getElementById('rl-count'),btn=document.getElementById('rl-btn'),left=wait;var t=setInterval(function(){if(gen!==window.__loginGen){clearInterval(t);return;}left--;if(cnt)cnt.textContent=String(left);if(left<=0){clearInterval(t);if(btn){btn.disabled=false;btn.style.opacity='';btn.style.cursor='';btn.textContent='立即重试';btn.onclick=function(){startLogin();};}}},1000);return;}area.innerHTML='<div class="err-box"><p class="err-title">获取设备码失败</p><p class="err">'+(err.error||('HTTP '+r.status))+'</p>'+(err.hint?'<p class="hint">'+err.hint+'</p>':'')+'</div><button class="btn-primary" onclick="startLogin()">重试</button>';return;}const d=await r.json();if(gen!==window.__loginGen)return;const activateUrl='https://trakt.tv/activate',qr='https://api.qrserver.com/v1/create-qr-code/?size=220x220&color=4a6db8&bgcolor=ffffff&data='+encodeURIComponent(activateUrl);area.innerHTML='<div class="device-flow"><div class="steps"><div class="step"><span class="n">1</span><span>打开 <a href="'+activateUrl+'" target="_blank" rel="noopener">trakt.tv/activate</a></span></div><div class="step"><span class="n">2</span><span>输入下方代码</span></div></div><div class="code-box">'+d.user_code+'</div><button type="button" class="btn-ghost" id="refresh-code-btn" onclick="startLogin()" style="margin:4px 0 10px">换一个验证码</button><div class="step"><span class="n">3</span><span>在 Trakt 页面点击授权</span></div><div class="qr-box"><img src="'+qr+'" alt="QR"></div><p id="status" class="status" style="display:none"></p></div><details class="log-details"><summary>调试日志</summary><div id="log" class="log-box"></div></details>';let interval=(d.interval||5)*1000,attempt=0;const logEl=document.getElementById('log'),log=(s)=>{if(logEl)logEl.innerHTML+='<div>['+new Date().toLocaleTimeString()+'] '+s+'</div>';};const tick=async()=>{if(gen!==window.__loginGen)return;attempt++;let r2;try{r2=await fetch('/auth/poll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:d.state})});}catch(e){if(gen!==window.__loginGen)return;log('网络错误');setTimeout(tick,interval);return;}if(gen!==window.__loginGen)return;if(r2.status===200){try{const st=document.getElementById('status');if(st){st.innerHTML='✓ 授权成功，正在进入…';st.className='status success';st.style.display='';}}catch(e){}setTimeout(()=>location.href='/home',400);return;}let text='';try{text=await r2.text();}catch{}let data={};try{data=JSON.parse(text);}catch{}log('HTTP '+r2.status+' · '+(data.status||data.message||'未知'));if(r2.status===202){if(data.status==='slow_down')interval+=2000;setTimeout(tick,interval);return;}if(r2.status===429){setTimeout(tick,Math.max(interval,5000));return;}if(r2.status===502||r2.status===503||r2.status===504){setTimeout(tick,Math.max(interval,3000));return;}if(r2.status===403){try{const st=document.getElementById('status');if(st){st.textContent=data.message||'你拒绝了授权，请换一个验证码重试';st.className='status error';st.style.display='';}const rb=document.getElementById('refresh-code-btn');if(rb){rb.style.borderColor='rgba(224,85,96,.45)';rb.style.color='#ff8a8a';}}catch(e){}return;}if(r2.status===410){try{const st=document.getElementById('status');if(st){st.textContent=data.message||'验证码无效或已过期，请换一个重试';st.className='status error';st.style.display='';}const rb=document.getElementById('refresh-code-btn');if(rb){rb.style.borderColor='rgba(224,85,96,.45)';rb.style.color='#ff8a8a';rb.focus();}}catch(e){}return;}setTimeout(tick,interval);};setTimeout(tick,1000);}<\/script><script>(function(){try{var msg=sessionStorage.getItem('mt:relogin');if(!msg)return;sessionStorage.removeItem('mt:relogin');var area=document.getElementById('login-area');if(!area)return;var p=document.createElement('p');p.className='err';p.style.cssText='margin-bottom:14px;text-align:center';p.textContent=msg;area.parentNode.insertBefore(p,area);}catch(e){}})();<\/script>`,
  );
}

/** 启动 splash 层 HTML */
function renderSplash() {
  return `<div id="splash" class="splash" style="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--splash-bg,#000)"><div class="splash-glow"></div><div class="splash-inner"><div class="splash-logo"><img src="${SPLASH_LOGO}" alt="" width="96" height="96" loading="eager" decoding="async" style="display:block;filter:drop-shadow(0 0 22px var(--splash-glow-color,rgba(125,157,212,.55)))"></div><div class="splash-name">MineTrakt</div><div class="splash-bar"><div class="splash-bar-fill"></div></div></div></div>`;
}

const SPLASH_LOGO_IMG_RE =
  /<img src="[^"]*" alt="" width="96" height="96" loading="eager" decoding="async" style="[^"]*">/;

/** 启动页内联 SVG logo */
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

/** 启动页关键 CSS（首屏内联） */
function launchCriticalCss() {
  const B = "box-sizing:border-box";
  return (
    `html,body{background:var(--bg-solid,#000);color:var(--text,#eef1f7);margin:0;padding:0;min-height:100%;min-height:100dvh}` +
    `*{${B}}` +
    `.splash{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;overflow:hidden}` +
    `.splash-inner{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:16px}` +
    `.splash-persist{background:var(--launch-splash-bg,radial-gradient(120% 90% at 50% 108%,rgba(124,58,237,.30) 0%,rgba(124,58,237,0) 55%),radial-gradient(110% 85% at 50% -12%,rgba(56,97,190,.25) 0%,rgba(0,0,0,0) 55%),#000)}` +
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

/** 启动页完整 HTML */
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
    '</head><body style="background:var(--bg-solid,#000000);margin:0;min-height:100vh;min-height:100dvh">' +
    renderSplash()
      .replace('class="splash"', 'class="splash splash-persist"')
      .replace(SPLASH_LOGO_IMG_RE, launchLogoSvg()) +
    tail +
    "</body></html>"
  );
}


/* ============================================================
 * 二十三、页面骨架与静态资源
 * ============================================================ */
function renderStatsHtml(s) {
  const movieCount = s ? s.movie : 0,
    showCount = s ? s.show : 0,
    episodeCount = s ? s.episode : 0,
    totalHours = s ? s.hours : 0;

  const items = [
    {
      n: movieCount,
      label: "电影",
      cls: "stat-movie",
      icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="18" rx="2.5"/><path d="M7 3v18M17 3v18M2 9h5M2 15h5M17 9h5M17 15h5"/></svg>',
    },
    {
      n: showCount,
      label: "剧集",
      cls: "stat-show",
      icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2.5"/><path d="M7 3l2 4M12 3l2 4M17 3l2 4"/></svg>',
    },
    {
      n: episodeCount,
      label: "集数",
      cls: "stat-episode",
      icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2.5"/><path d="M10 9l5 3-5 3V9z" fill="currentColor" stroke="none"/></svg>',
    },
    {
      n: totalHours,
      label: "小时",
      cls: "stat-hours",
      icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    },
  ];

  return items
    .map(
      (it) =>
        `<div class="stat ${it.cls}"><div class="stat-icon">${it.icon}</div><div class="stat-num">${s ? it.n : "–"}</div><div class="stat-label">${it.label}</div></div>`,
    )
    .join("");
}

/** 公共 head meta（主题色/viewport/图标） */
function commonHeadMeta() {
  return `<meta charset="utf-8">${THEME_BOOT_SCRIPT}<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1,user-scalable=no"><meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate"><meta http-equiv="Pragma" content="no-cache"><meta name="color-scheme" content="dark light"><meta name="theme-color" content="${THEME_COLOR}"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="${APP_SHORT_NAME}"><meta name="mobile-web-app-capable" content="yes"><meta name="format-detection" content="telephone=no"><title>${APP_NAME}</title><link rel="icon" href="${FAVICON_URL}" type="image/png"><link rel="apple-touch-icon" href="${APPLE_ICON}"><link rel="manifest" href="/manifest.webmanifest"><link rel="preconnect" href="https://api.trakt.tv" crossorigin><link rel="preconnect" href="https://api.themoviedb.org" crossorigin><link rel="preconnect" href="https://image.tmdb.org" crossorigin>`;
}

/** 页面 head 前半段 */
function pageHeadEarly() {
  return `<!DOCTYPE html><html lang="zh-CN" data-theme="dark"><head>${commonHeadMeta()}<link rel="preload" as="script" href="/app.js?v=${APP_JS_VERSION}"><link rel="preload" href="/app.css?v=${APP_CSS_VERSION}" as="style"><link rel="stylesheet" href="/app.css?v=${APP_CSS_VERSION}"><style>${splashCriticalCss()}</style></head><body style="background:var(--bg-solid,#000000);margin:0;min-height:100vh;min-height:100dvh">${renderSplash()}`;
}

/** 页面收尾（脚本引入等） */
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

/** 页面外壳（head + body 模板） */
function pageShell(body) {
  return pageHeadEarly() + body + pageTail();
}

/** splash 关键 CSS */
function splashCriticalCss() {
  return `html,body{background:var(--bg-solid,#000);color:var(--text,#eef1f7);margin:0;padding:0;min-height:100%;min-height:100dvh}
*{box-sizing:border-box}
.splash{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--splash-bg,#000);transition:opacity .18s ease;animation:splashAutoHide .18s ease .35s forwards}
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
.container{max-width:none;width:100%;margin:0 auto;padding:0 16px calc(72px + env(safe-area-inset-bottom))}
.hero{display:flex;justify-content:space-between;align-items:center;padding:calc(6px + env(safe-area-inset-top)) 0 4px;gap:8px}
.hero-left{display:flex;align-items:center;gap:12px;min-width:0}
.hero-avatar{width:48px;height:48px;border-radius:50%;overflow:hidden;flex-shrink:0;background:var(--surface-2,#16161a);border:2px solid var(--avatar-ring,rgba(167,139,250,.45))}
.hero-name{font-size:1.3rem;font-weight:800;color:var(--text,#f4f4f5);margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.updated-at{font-size:.72rem;color:var(--text-mute,#71717a);margin:0}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;background:var(--surface,#0e0e10);border:1px solid var(--border,rgba(255,255,255,.08));border-radius:16px;padding:14px 8px;margin-bottom:20px;min-height:88px}
.tabs{display:flex;gap:4px;margin-bottom:2px}
.tab{flex:1;background:transparent;border:none;color:var(--text-dim,#a1a1aa);padding:9px 2px;border-radius:999px;font-size:.75rem;font-weight:600;display:flex;align-items:center;justify-content:center;gap:5px}
.tab.active{background:var(--brand-grad,linear-gradient(135deg,#7c3aed,#a78bfa));color:#fff}
.pane{display:none}.pane.active{display:block}
.home-section{margin-bottom:14px}
.home-section-title{font-size:.95rem;font-weight:700;color:var(--text,#f4f4f5);margin:0 0 6px}
.h-scroll{display:flex;gap:12px;overflow-x:auto;padding:4px 0 10px;-webkit-overflow-scrolling:touch}
.pane-loading{padding:40px 20px;text-align:center}
.btn-action{display:inline-flex;align-items:center;gap:6px;background:var(--hover-bg,rgba(255,255,255,.04));color:var(--text-dim,#a1a1aa);border:1px solid var(--border,rgba(255,255,255,.08));padding:8px 12px;border-radius:10px;font-size:.8rem}
`;
}


/* ============================================================
 * 二十四、客户端脚本（模板字符串形式内嵌到页面）
 * ============================================================ */
function getBootstrapScript() {
  return `(function(){var __CFG=window.__HOME_CONFIG__||{};if(!__CFG.loggedIn)return;window.__HOME_CONFIG__=null;if(__CFG.initialDetail)window.__initialDetail=__CFG.initialDetail;if(!window.__splashT0)window.__splashT0=Date.now();window.__splashHidden=false;window.__hideSplash=function(force){try{if(window.__splashHidden)return;window.__splashHidden=true;var el=document.getElementById('splash');if(!el)return;var wait=force?0:Math.max(0,120-(Date.now()-(window.__splashT0||Date.now())));setTimeout(function(){try{el.classList.add('hide');setTimeout(function(){try{if(el&&el.parentNode)el.parentNode.removeChild(el);}catch(e){}},280);}catch(e){}},wait);}catch(e){}};setTimeout(function(){if(window.__hideSplash)window.__hideSplash();},80);function lsGet(k){try{var v=localStorage.getItem(k);if(!v)return null;var o=JSON.parse(v);if(o&&o._exp&&o._exp<Date.now()){try{localStorage.removeItem(k);}catch(e){}return null;}return o&&o.data?o.data:null;}catch(e){return null;}}function lsSet(k,d,ttlSec){try{localStorage.setItem(k,JSON.stringify({data:d,_exp:Date.now()+ttlSec*1000}));}catch(e){try{localStorage.removeItem(k);}catch(e2){}}}window.__lsGet=lsGet;window.__lsSet=lsSet;function setHTML(sel,html){var el=typeof sel==='string'?document.querySelector(sel):sel;if(el)el.innerHTML=html||'';}window.__setHTML=setHTML;function applyAvatar(url,alts){if(!url)return;var av=document.getElementById('hero-avatar');if(!av)return;var list=[url];if(alts&&alts.length){for(var a=0;a<alts.length;a++){if(alts[a]&&alts[a]!==url)list.push(alts[a]);}}list.push('/avatar?u='+encodeURIComponent(url));var i=0;function next(){if(i>=list.length){av.innerHTML='<span class="hero-avatar-ph">👤</span>';return;}var src=list[i++];var img=document.createElement('img');img.onerror=next;img.alt='';img.width=56;img.height=56;img.decoding='async';img.setAttribute('referrerpolicy','no-referrer');img.src=src;av.innerHTML='';av.appendChild(img);}next();}function __setUpdatedAt(source,ageSec){var el=document.getElementById('updated-at');if(!el)return;var p=function(n){return(n<10?'0':'')+n;};var label='';if(typeof ageSec==='number'&&isFinite(ageSec)&&ageSec>=0){var d=new Date(Date.now()-ageSec*1000);label='更新于 '+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());}else if(source==='live'){label='已更新';}else{return;}el.textContent=label;el.classList.remove('flash','src-live','src-cache');void el.offsetWidth;el.classList.add('flash');if(source==='live')el.classList.add('src-live');else if(source==='cache')el.classList.add('src-cache');}function applyPlayback(d,isCache){if(!d)return;if(d.playbackHScrollHtml)setHTML('#playback-hscroll',d.playbackHScrollHtml);var src=isCache?'cache':(d.playbackSource||'');var age=null;if(d.playbackDataTs){age=Math.max(0,Math.round((Date.now()-Number(d.playbackDataTs))/1000));try{d._dataTs=Number(d.playbackDataTs);}catch(e){}}else if(d.userUpdatedAt){age=Math.max(0,Math.round((Date.now()-Number(d.userUpdatedAt))/1000));src=src||'cache';try{d._dataTs=Number(d.userUpdatedAt);}catch(e){}}else if(d._dataTs)age=Math.max(0,Math.round((Date.now()-d._dataTs)/1000));else if(typeof d.playbackAgeSec==='number'&&isFinite(d.playbackAgeSec)){age=Math.max(0,d.playbackAgeSec);try{d._dataTs=Date.now()-age*1000;}catch(e){}}else if(src==='live')age=0;__setUpdatedAt(src,age);if(window.__scheduleEnrich)window.__scheduleEnrich();}window.__applyPlayback=applyPlayback;function applyMeta(d,isCache){if(!d)return;var n=document.getElementById('hero-name');if(n&&d.name)n.textContent=d.name;applyAvatar(d.avatar,d.avatarAlt);if(d.statsHtml)setHTML('#stats-box',d.statsHtml);if(!isCache)try{lsSet('mt:meta',d,1800);}catch(e){}}window.__applyMeta=applyMeta;var __homeDataLoading=false;
/** （客户端）拉取单个首页数据分片，401 自动跳登录 */
function fetchPart(part,force){return fetch('/api/home-data?part='+encodeURIComponent(part)+(force?'&force=1':''),{credentials:'same-origin',cache:'no-store'}).then(function(r){if(r.status===401){return r.json().catch(function(){return{};}).then(function(d){var msg=(d&&d.error)||'登录已失效，请重新登录';try{sessionStorage.setItem('mt:relogin',msg);}catch(e){}if(window.__toast)window.__toast(msg,{type:'warn',duration:2200});setTimeout(function(){location.href='/login';},1000);return null;});}if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}).then(function(d){if(!d)return null;if(d.login){location.href='/login';return null;}return d;});}window.__fetchPart=fetchPart;var __loadedParts={};function loadPartOnce(part){if(__loadedParts[part])return Promise.resolve(__loadedParts[part]);return fetchPart(part).then(function(d){__loadedParts[part]=d;return d;});}window.__loadPartOnce=loadPartOnce;window.__loadedParts=__loadedParts;function loadHomeData(opts){opts=opts||{};var silent=!!opts.silent;if(__homeDataLoading&&!silent)return;__homeDataLoading=true;__lastRefreshAt=Date.now();function onPlayback(d,isCache){if(!d)return;applyPlayback(d,isCache);if(!isCache){try{lsSet('mt:pb',d,900);}catch(e){}if(!silent&&window.__initialDetail){var s=window.__initialDetail,idx=s.indexOf('/');if(idx>0&&window.openDetail)openDetail(s.slice(0,idx),s.slice(idx+1),false);window.__initialDetail=null;}}if(!silent&&window.__hideSplash)window.__hideSplash(true);}if(!silent){var cachedPb=lsGet('mt:pb');if(cachedPb){try{onPlayback(cachedPb,true);}catch(e){}}else if(window.__earlyPbApplied&&window.__hideSplash){window.__hideSplash(true);}}var pPlayback;if(!silent&&window.__primaryBootP){pPlayback=window.__primaryBootP.then(function(d){window.__primaryBootP=null;if(d){onPlayback(d,false);return d;}return fetchPart('playback').then(function(x){onPlayback(x,false);return x;});}).catch(function(){return fetchPart('playback').then(function(x){onPlayback(x,false);return x;});});}else{pPlayback=fetchPart('playback').then(function(x){onPlayback(x,false);return x;});}pPlayback=pPlayback.catch(function(){if(!silent){setHTML('#playback-hscroll','<div class="empty"><p>暂时无法从 Trakt 拉取数据<br><span style="font-size:.82rem;opacity:.75">可能是官方限流或网络异常，请过几分钟再试</span></p><p style="margin-top:12px"><button class="btn-ghost" onclick="location.reload()">重试</button></p></div>');if(window.__hideSplash)window.__hideSplash(true);}});Promise.resolve(pPlayback).then(function(){__homeDataLoading=false;if(!silent){var cachedMeta=lsGet('mt:meta');if(cachedMeta)setTimeout(function(){try{applyMeta(cachedMeta,true);}catch(e){}},0);}var runMeta=function(){fetchPart('meta').then(function(d){applyMeta(d,false);}).catch(function(){});};if(window.requestIdleCallback)requestIdleCallback(runMeta,{timeout:800});else setTimeout(runMeta,80);});}var __refreshTick=0,__lastUserAct=Date.now(),__lastBoardReload=Date.now();['scroll','click','touchstart','keydown'].forEach(function(t){window.addEventListener(t,function(){__lastUserAct=Date.now();},{passive:true});});function silentRefresh(){if(document.hidden)return;var __m=document.getElementById('modal');if(__m&&__m.classList.contains('open'))return;__refreshTick++;__lastRefreshAt=Date.now();fetchPart('playback').then(function(d){applyPlayback(d);try{lsSet('mt:pb',d,900);}catch(e){}}).catch(function(){});fetchPart('meta').then(function(d){applyMeta(d,false);}).catch(function(){});if(Date.now()-__lastBoardReload>86400000){__lastBoardReload=Date.now();if(window.__reloadDoubanSections)window.__reloadDoubanSections(false);if(window.__scheduleEnrich)window.__scheduleEnrich();}}window.__refreshStats=silentRefresh;
window.forceRefresh=async function(){if(window.__forceRefreshing)return;window.__forceRefreshing=true;try{localStorage.removeItem('mt:pb');localStorage.removeItem('mt:meta');}catch(e){}var btn=document.getElementById('btn-refresh');var span=btn&&btn.querySelector('span');var oldText=span?span.textContent:'刷新';if(btn)btn.classList.add('loading');if(span)span.textContent='刷新中';var okCount=0,cacheCount=0,failCount=0,cooling=0,hitLimit=false;var GAP_OK=1200,GAP_LIMIT=1500;try{var wanted=['playback','meta'];var loaded=window.__loadedParts||{};['history'].forEach(function(p){if(loaded[p])wanted.push(p);});for(var i=0;i<wanted.length;i++){if(hitLimit)break;var part=wanted[i];if(i>0){var gap=cooling>0?GAP_LIMIT:GAP_OK;await new Promise(function(r){setTimeout(r,gap);});}var d=null;try{d=await __enqueueTrakt(function(){return fetchPart(part,true);});}catch(e){d=null;}if(!d){failCount++;continue;}var isCache=false;if(part==='playback'&&d.playbackSource==='cache')isCache=true;if(part==='meta'&&d.metaSource==='cache')isCache=true;if(isCache)cacheCount++;else okCount++;if(part==='playback'){applyPlayback(d);try{lsSet('mt:pb',d,900);}catch(e){}}else if(part==='meta'){applyMeta(d,false);}else if(part==='watchlist'||part==='calendar'||part==='history'){__applyPart(part,d);__savePartSnap(part,d);}window.__loadedParts[part]=d;if(__partFailed(d)){try{delete window.__loadedParts[part];}catch(e){}}if(d.rateLimited||(d.cooling&&d.cooling>0)){hitLimit=true;cooling=Math.max(cooling,Number(d.cooling)||0);}else if(isCache&&(part==='playback'||part==='meta')){hitLimit=true;}}if(failCount&&!okCount&&!cacheCount){__errToast('刷新失败',new Error('无法连接 Trakt，请检查网络后重试'));}else if(hitLimit){var msg=cooling>0?('Trakt 官方限流，本地冷却中约 '+cooling+' 秒。期间已用缓存，请勿反复刷新'):'未能从 Trakt 拉取新数据，已显示本地缓存（可能是限流或上游暂不可用）';__toast(msg,{type:'warn',duration:4200});}else if(failCount||cacheCount){__toast('已刷新 Trakt 数据（豆瓣/热榜/评分等仍走缓存，到期自动更新）',{type:'warn',duration:2800});}else{__toast('已刷新 Trakt 数据',{type:'success',duration:1800});}if(window.__scheduleEnrich)window.__scheduleEnrich();}catch(e){__errToast('刷新失败',e);}finally{if(btn)btn.classList.remove('loading');if(span)span.textContent=oldText;window.__forceRefreshing=false;}};
/** （客户端）首页数据加载入口：先缓存后网络 */
function startHomeData(){loadHomeData({silent:false});}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',startHomeData);}else{startHomeData();}var REFRESH_MS=${HOME_AUTO_REFRESH_MINUTES}*60*1000;var __lastRefreshAt=Date.now();if(REFRESH_MS>0){setInterval(function(){if(Date.now()-__lastUserAct<60000)return;silentRefresh();},REFRESH_MS);document.addEventListener('visibilitychange',function(){if(document.hidden)return;if(Date.now()-__lastRefreshAt>=REFRESH_MS)silentRefresh();});}})();`;
}

/** 汇总输出全部客户端脚本 */
function getClientSideScripts() {
  return (
    getBootstrapScript() +
    `
/** （客户端）HTML 转义 */
function __esc(s){s=String(s==null?'':s);return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
/* 统一的 Trakt 写操作 POST 封装：非 2xx 时解析 error/cooling/source 并抛错（err.cooling / err.source），成功返回 JSON（无 body 时返回 null） */
async function __traktPost(url,payload){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload||{})});if(!r.ok){let errMsg='HTTP '+r.status,cooling=0,source='';try{const j=await r.json();errMsg=(j&&(j.error||j.message))||('HTTP '+r.status);if(j&&j.cooling)cooling=Number(j.cooling)||0;if(j&&j.source)source=j.source;}catch(e){try{const t=await r.text();if(t)errMsg+=' '+t;}catch(e2){}}if(cooling)errMsg+='（冷却 '+cooling+' 秒）';var err=new Error(errMsg);err.cooling=cooling;err.source=source;throw err;}try{return await r.json();}catch(e){return null;}}
/** （客户端）轻提示 toast */
function __toast(message,opts){opts=opts||{};if(!message)return;var type=opts.type||'info';var duration=opts.duration||2600;var container=document.getElementById('toast-container');if(!container){container=document.createElement('div');container.id='toast-container';document.body.appendChild(container);}var toast=document.createElement('div');toast.className='toast toast-'+type;var icons={success:'✓',error:'✕',warn:'!',info:'i'};toast.innerHTML='<span class="toast-icon">'+(icons[type]||icons.info)+'</span><span class="toast-msg">'+__esc(message)+'</span>';container.appendChild(toast);requestAnimationFrame(function(){toast.classList.add('toast-in');});var remove=function(){if(!toast.parentNode)return;toast.classList.remove('toast-in');toast.classList.add('toast-out');setTimeout(function(){if(toast.parentNode)toast.parentNode.removeChild(toast);},260);};var timer=setTimeout(remove,duration);toast.addEventListener('click',function(){clearTimeout(timer);remove();});}window.__toast=__toast;
var __THEME_KEY='mt:theme',__THEME_CYCLE=['dark','light','system'];
var __THEME_LABEL={dark:'深色',light:'浅色',system:'跟随系统'};
var __THEME_ICONS={
dark:'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
light:'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>',
system:'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg>'};
/** （客户端）读取主题设置（dark/light/system） */
function __getTheme(){try{var t=localStorage.getItem(__THEME_KEY);return __THEME_CYCLE.indexOf(t)>=0?t:'dark';}catch(e){return 'dark';}}
/** （客户端）当前是否深色模式 */
function __resolveDark(t){if(t==='system'){try{return !window.matchMedia||matchMedia('(prefers-color-scheme: dark)').matches;}catch(e){return true;}}return t!=='light';}
/** （客户端）应用主题到 document 与 meta */
function __applyTheme(t){var dark=__resolveDark(t);var d=document.documentElement;d.setAttribute('data-theme',t);d.style.backgroundColor=dark?'#050505':'#ffffff';var tc=document.querySelector('meta[name="theme-color"]');if(tc)tc.setAttribute('content',dark?'#050505':'#ffffff');var cs=document.querySelector('meta[name="color-scheme"]');if(cs)cs.setAttribute('content',dark?'dark':'light');var sb=document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');if(sb)sb.setAttribute('content',dark?'black-translucent':'default');var icon=document.getElementById('theme-icon');if(icon)icon.innerHTML=__THEME_ICONS[t]||__THEME_ICONS.dark;var btn=document.getElementById('btn-theme');if(btn){btn.setAttribute('aria-label','切换主题：'+__THEME_LABEL[t]);btn.setAttribute('title','主题：'+__THEME_LABEL[t]);}}
window.__applyTheme=__applyTheme;window.__getTheme=__getTheme;
window.cycleTheme=function(){var cur=__getTheme();var next=__THEME_CYCLE[(__THEME_CYCLE.indexOf(cur)+1)%__THEME_CYCLE.length];try{localStorage.setItem(__THEME_KEY,next);}catch(e){}__applyTheme(next);if(window.__toast)__toast('已切换主题：'+__THEME_LABEL[next],{type:'info',duration:1500});};
(function(){__applyTheme(__getTheme());try{var mq=matchMedia('(prefers-color-scheme: dark)');var onChange=function(){if(__getTheme()==='system')__applyTheme('system');};if(mq.addEventListener)mq.addEventListener('change',onChange);else if(mq.addListener)mq.addListener(onChange);}catch(e){}})();
/** （客户端）错误信息转友好文案 */
function __humanizeClientError(msg,cooling){msg=String(msg||'').trim();if(!msg)return'操作失败，请稍后重试';if(msg.indexOf('登录已过期')>=0||msg.indexOf('unauthorized')>=0)return'登录已过期，请重新登录';if(/Cloudflare|cf-mitigated|error code:\\s*1015/i.test(msg)){if(cooling&&cooling>0)return'被 Cloudflare 拦截，本地冷却中，约 '+cooling+' 秒后再试（期间显示缓存）';return'被 Cloudflare 拦截，请稍后再试（当前已用缓存）';}if(/Trakt 官方限流|Trakt 限流|限流|过于频繁|429/.test(msg)){if(cooling&&cooling>0)return'Trakt 官方限流，本地冷却中，约 '+cooling+' 秒后再试（期间显示缓存，无需反复刷新）';return'Trakt 官方限流，请稍后再试（当前已用缓存）';}if(/网络|timeout|abort|Failed to fetch/i.test(msg))return'网络连接失败，请检查网络后重试';if(/^HTTP\\s*5\\d{2}/i.test(msg))return'Trakt 服务暂时不可用（5xx），请稍后重试';if(/^HTTP\\s*404/i.test(msg))return'未找到对应内容';if(/^HTTP\\s*403/i.test(msg))return'没有权限执行此操作';if(/^HTTP\\s*401/i.test(msg))return'登录已过期，请重新登录';if(/^HTTP\\s*\\d+/i.test(msg))return'请求失败，请稍后重试';if(/[\\u4e00-\\u9fff]/.test(msg))return msg;return msg;}function __errToast(prefix,err){var msg=(err&&err.message)?err.message:String(err||'未知错误');var cooling=err&&err.cooling;msg=__humanizeClientError(msg,cooling);var t='error';if(msg.indexOf('429')>=0||msg.indexOf('限流')>=0||msg.indexOf('频繁')>=0||msg.indexOf('冷却')>=0)t='warn';if(msg.indexOf('网络')>=0||msg.indexOf('暂时不可用')>=0)t='warn';__toast((prefix?prefix+'：':'')+msg,{type:t,duration:t==='warn'?3600:2800});}window.__errToast=__errToast;
/** （客户端）通用 API 响应解析：401 跳登录、错误抛出 */
async function __apiJson(r){var data=null;try{data=await r.json();}catch(e){data=null;}if(!r.ok){if(r.status===401&&data&&data.relogin){var msg=data.error||'登录已失效，请重新登录';try{sessionStorage.setItem('mt:relogin',msg);}catch(e){}__toast(msg,{type:'warn',duration:2200});setTimeout(function(){location.href='/login';},1000);var err=new Error(msg);err.relogin=true;throw err;}var msg2=(data&&data.error)||('HTTP '+r.status);var err2=new Error(__humanizeClientError(msg2,data&&data.cooling));if(data&&data.cooling!=null)err2.cooling=data.cooling;throw err2;}return data;}window.__apiJson=__apiJson;
/** （客户端）Promise 化确认弹窗 */
function __confirm(opts){opts=opts||{};return new Promise(function(resolve){var modal=document.getElementById('confirm-modal');if(!modal){resolve(window.confirm(opts.message||opts.title||'确认操作'));return;}var iconEl=document.getElementById('confirm-icon'),titleEl=document.getElementById('confirm-title'),msgEl=document.getElementById('confirm-msg'),okBtn=document.getElementById('confirm-ok'),cancelBtn=document.getElementById('confirm-cancel'),backdrop=modal.querySelector('.confirm-backdrop');iconEl.className='confirm-icon'+(opts.tone?' '+opts.tone:'');iconEl.textContent=opts.icon||'?';titleEl.textContent=opts.title||'确认操作';msgEl.textContent=opts.message||'';msgEl.style.display=opts.message?'':'none';okBtn.textContent=opts.okText||'确定';cancelBtn.textContent=opts.cancelText||'取消';okBtn.className='confirm-btn confirm-ok'+(opts.tone==='danger'?' danger':'');var settled=false;function cleanup(){okBtn.removeEventListener('click',onOk);cancelBtn.removeEventListener('click',onCancel);backdrop.removeEventListener('click',onCancel);document.removeEventListener('keydown',onKey,true);modal.classList.remove('open');modal.style.display='none';}function finish(v){if(settled)return;settled=true;cleanup();resolve(v);}function onOk(){finish(true);}function onCancel(){finish(false);}function onKey(e){if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish(false);}}okBtn.addEventListener('click',onOk);cancelBtn.addEventListener('click',onCancel);backdrop.addEventListener('click',onCancel);document.addEventListener('keydown',onKey,true);modal.style.display='block';modal.classList.add('open');setTimeout(function(){try{okBtn.focus();}catch(err){}},40);});}window.__confirm=__confirm;
var __traktChain=Promise.resolve();
/** （客户端）Trakt 写操作串行队列，防止并发触发限流 */
function __enqueueTrakt(fn){
  var run=function(){return new Promise(function(r){setTimeout(r,1100);}).then(fn);};
  __traktChain=__traktChain.then(run,run);
  return __traktChain;
}
window.__enqueueTrakt=__enqueueTrakt;
window.__enqueueWrite=__enqueueTrakt;
/** （客户端）卡片淡出后移除 */
function __fadeRemoveCard(card){if(!card)return;card.style.transition='opacity 0.25s ease, transform 0.25s ease';card.style.opacity='0';card.style.transform='scale(0.96)';setTimeout(function(){var day=card.closest('.day'),pane=card.closest('.pane');card.remove();if(day&&!day.querySelector('.item')){day.style.transition='opacity 0.2s ease';day.style.opacity='0';setTimeout(function(){if(day.parentNode)day.remove();__maybeShowEmpty(pane);if(window.__refreshStats)window.__refreshStats();},200);return;}__maybeShowEmpty(pane);if(window.__refreshStats)window.__refreshStats();},260);}
/** （客户端）列表为空时显示占位 */
function __maybeShowEmpty(pane){if(!pane)return;setTimeout(function(){if(pane.querySelector('.item'))return;if(pane.querySelector('.empty'))return;var grid=pane.querySelector('.grid');if(!grid)return;var pid=pane.id,txt='这里暂时没有内容';if(pid==='playback')txt='暂时没有继续观看的内容';else if(pid==='watchlist')txt='待看列表是空的';else if(pid==='calendar')txt='未来 30 天没有待播剧集';else if(pid==='history')txt='还没有观看记录';grid.innerHTML='<div class="empty"><p>'+txt+'</p></div>';},120);}
/** （客户端）把分片数据渲染进对应面板 */
function __partHtml(d){return d?String((d.watchlistHtml||'')+(d.calendarHtml||'')+(d.historyHtml||'')):'';}
/** （客户端）判断分片数据是否为失败态 */
function __partFailed(d){if(!d)return true;var h=__partHtml(d);if(!h&&d.historyMoreHtml==null)return true;return /暂时无法加载/.test(h);}
/** （客户端）应用分片数据到 DOM */
function __applyPart(part,d){if(!d)return false;if(part==='watchlist'){if(d.watchlistHtml)__setHTML('#watchlist',d.watchlistHtml);}else if(part==='calendar'){if(d.calendarHtml){__setHTML('#calendar',d.calendarHtml);try{var dropped=JSON.parse(localStorage.getItem('mt:dropped')||'[]');if(Array.isArray(dropped)&&dropped.length){var cal=document.getElementById('calendar');if(cal)dropped.forEach(function(did){cal.querySelectorAll('[data-drop-show-id="'+did+'"]').forEach(function(b){var card=b.closest('.item');if(card){var day=card.closest('.day');card.remove();if(day&&!day.querySelector('.item'))day.remove();}});});}}catch(e){}}}else if(part==='history'){if(d.historyHtml)__setHTML('#history .grid',d.historyHtml);if(d.historyMoreHtml!=null)__setHTML('#history-more',d.historyMoreHtml);}else{return false;}if(window.__scheduleEnrich)window.__scheduleEnrich();return true;}
window.__applyPart=__applyPart;window.__partFailed=__partFailed;
var __PART_LS={watchlist:'mt:wl',calendar:'mt:cal',history:'mt:hist'},__PART_SNAP_TTL=259200;
/** （客户端）localStorage 安全读取（带过期） */
function __lsGetSafe(k){try{if(typeof window.__lsGet==='function')return window.__lsGet(k);}catch(e){}try{var v=localStorage.getItem(k);if(!v)return null;var o=JSON.parse(v);if(o&&o._exp&&o._exp<Date.now()){try{localStorage.removeItem(k);}catch(e2){}return null;}return o&&o.data?o.data:null;}catch(e){return null;}}
/** （客户端）localStorage 安全写入 */
function __lsSetSafe(k,d,ttlSec){try{if(typeof window.__lsSet==='function'){window.__lsSet(k,d,ttlSec);return;}localStorage.setItem(k,JSON.stringify({data:d,_exp:Date.now()+ttlSec*1000}));}catch(e){}}
/** （客户端）保存分片快照 */
function __savePartSnap(part,d){var k=__PART_LS[part];if(!k||!d||__partFailed(d))return;__lsSetSafe(k,d,__PART_SNAP_TTL);}
/** （客户端）读取分片快照 */
function __loadPartSnap(part){var k=__PART_LS[part];if(!k)return null;var s=__lsGetSafe(k);return s&&!__partFailed(s)?s:null;}
window.__savePartSnap=__savePartSnap;window.__loadPartSnap=__loadPartSnap;
var __partQueue = Promise.resolve();

/** （客户端）按标签页拉取分片（带缓存与降级） */
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
document.querySelectorAll('.tab').forEach(t=>{t.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.pane').forEach(x=>x.classList.remove('active'));t.classList.add('active');var tabName=t.dataset.tab,pane=document.getElementById(tabName);if(pane)pane.classList.add('active');if(tabName==='search'){setTimeout(function(){var inp=document.getElementById('search-input');if(inp)inp.focus();if(inp&&!inp.value.trim()&&window.__loadTrending)window.__loadTrending();},60);return;}if(tabName==='playback')return;var partMap={watchlist:'watchlist',calendar:'calendar',history:'history'};var part=partMap[tabName];if(!part)return;var loaded=window.__loadedParts||{};if(loaded[part]&&!__partFailed(loaded[part])){__applyPart(part,loaded[part]);return;}var snap=__loadPartSnap(part);if(snap)__applyPart(part,snap);window.__fetchPartForTab(part).then(function(d){if(d){__applyPart(part,d);return;}var lv=snap||__loadPartSnap(part);if(lv){__applyPart(part,lv);if(window.__toast)window.__toast('上游暂不可用，已显示上次数据',{type:'warn',duration:1800});return;}var p=document.getElementById(tabName);if(p)p.innerHTML='<div class="empty"><p>加载失败，请稍后重试</p></div>';});});});
(function(){var order=['watchlist','calendar','history'],GAP=4000;function warm(i){if(i>=order.length||document.hidden)return;var p=order[i];function next(){setTimeout(function(){warm(i+1);},GAP);}var loaded=window.__loadedParts||{};if(loaded[p]&&!__partFailed(loaded[p])){next();return;}__fetchPartForTab(p).then(function(d){if(d)__applyPart(p,d);next();});}function start(){setTimeout(function(){warm(0);},1500);}if(window.requestIdleCallback)window.requestIdleCallback(start,{timeout:3000});else start();})();
/** （客户端）登出 */
async function logout(){if(!(await __confirm({icon:'🚪',title:'退出登录',message:'确定要退出当前 Trakt 账号吗？',okText:'退出',cancelText:'取消',tone:'warn'})))return;try{localStorage.removeItem('mt:pb');localStorage.removeItem('mt:meta');}catch(e){}await fetch('/auth/logout',{method:'POST'});location.href='/login';}
window.logout=logout;
/** （客户端）加载更多观看记录 */
async function loadMoreHistory(btn){return __loadMore(btn,'#history .grid','/api/more?type=history&page='+parseInt(btn.dataset.page||'2'));}
window.loadMoreHistory=loadMoreHistory;
/** （客户端）待看列表排序切换 */
async function onWatchlistSortChange(sort){const grid=document.getElementById('watchlist-grid'),pane=document.getElementById('watchlist');if(grid)grid.innerHTML='<div class="pane-loading"><div class="spinner"></div></div>';const oldMore=pane?pane.querySelector('.load-more-wrap'):null;if(oldMore)oldMore.remove();try{const r=await fetch('/api/more?type=watchlist&page=1&sort='+encodeURIComponent(sort));if(!r.ok)throw new Error('HTTP '+r.status);const htmlText=await r.text();if(grid)grid.innerHTML=htmlText||emptyWatchlistInner();const hasMore=r.headers.get('X-Has-More')==='true';if(hasMore&&pane&&grid){const wrap=document.createElement('div');wrap.className='load-more-wrap';wrap.innerHTML='<button class="load-more" data-page="2" data-sort="'+sort+'" onclick="loadMoreWatchlist(this)">加载更多</button>';pane.appendChild(wrap);}if(window.__scheduleEnrich)window.__scheduleEnrich();}catch(e){if(grid)grid.innerHTML='<div class="empty"><p>加载失败，请稍后重试</p></div>';}}
window.onWatchlistSortChange=onWatchlistSortChange;
/** （客户端）待看空态内容 */
function emptyWatchlistInner(){return '<div class="empty"><p>待看列表是空的</p></div>';}
/** （客户端）待看列表加载更多 */
async function loadMoreWatchlist(btn){return __loadMore(btn,'#watchlist-grid','/api/more?type=watchlist&page='+parseInt(btn.dataset.page||'2')+'&sort='+encodeURIComponent(btn.dataset.sort||'added'));}
window.loadMoreWatchlist=loadMoreWatchlist;
/** （客户端）通用「加载更多」按钮逻辑 */
async function __loadMore(btn,gridSel,url){btn.disabled=true;btn.textContent='加载中…';try{const r=await fetch(url);if(!r.ok)throw new Error('HTTP '+r.status);const html=await r.text();const grid=document.querySelector(gridSel);if(grid)grid.insertAdjacentHTML('beforeend',html);if(window.__scheduleEnrich)window.__scheduleEnrich();if(r.headers.get('X-Has-More')==='true'){btn.dataset.page=parseInt(btn.dataset.page||'2')+1;btn.disabled=false;btn.textContent='加载更多';}else{btn.textContent='已经到底啦';btn.disabled=true;btn.style.opacity='0.5';btn.style.cursor='default';}}catch(e){btn.textContent='加载失败，点击重试';btn.disabled=false;}}
document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-wl-remove-id]');if(!btn)return;e.preventDefault();e.stopPropagation();if(btn.disabled)return;const type=btn.dataset.wlRemoveType,id=btn.dataset.wlRemoveId;if(!type||!id)return;const item=btn.closest('.item'),nameEl=item?item.querySelector('.name'):null,name=nameEl?nameEl.textContent:'';if(!(await __confirm({icon:'🗑',title:'移除待看',message:'确定要把「'+(name||'该条目')+'」从待看列表移除吗？',okText:'移除',tone:'danger'})))return;const prevText=btn.textContent;btn.disabled=true;btn.textContent='…';try{await __enqueueWrite(async()=>{await __traktPost('/api/watchlist/remove',{type,id});__fadeRemoveCard(btn.closest('.item'));__toast('已移出待看列表',{type:'success'});});}catch(err){btn.disabled=false;btn.textContent=prevText;__errToast('移除失败',err);}},true);

/** （客户端）懒创建「更多操作」底部菜单（移除进度/弃看） */
function __ensureCwSheet(){
  var el=document.getElementById('cw-sheet');
  if(el)return el;
  el=document.createElement('div');
  el.id='cw-sheet';
  el.className='cw-sheet';
  el.innerHTML='<div class="cw-sheet-backdrop" data-cw-sheet-close="1"></div><div class="cw-sheet-panel" role="menu"><div class="cw-sheet-title" id="cw-sheet-title"></div><button type="button" class="cw-sheet-item" id="cw-sheet-hide">移除进度</button><button type="button" class="cw-sheet-item danger" id="cw-sheet-drop">弃看剧集</button><button type="button" class="cw-sheet-item cw-sheet-cancel" data-cw-sheet-close="1">取消</button></div>';
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
/** （客户端）打开更多操作菜单 */
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
/** （客户端）关闭更多操作菜单 */
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


/** （客户端）移除观看进度：确认 → 调接口 → 删卡片并刷新 */
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
      await __traktPost('/api/hide-continue',payload);
      document.querySelectorAll('[data-cw-drop-id="'+id+'"]').forEach(function(b){
        const card=b.closest('.item')||b.closest('.cw-card');
        if(card)__fadeRemoveCard(card);
      });
      __toast('已移除进度',{type:'success'});
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
            try{if(window.__lsSet)window.__lsSet('mt:pb',d,1800);}catch(e){}
          }).catch(function(){});
      }catch(e){}
    });
  }catch(err){
    __errToast('移除失败',err);
  }
}

/** （客户端）弃看剧集：确认 → 调接口 → 删卡片并刷新日历/继续观看 */
async function __dropShowById(id, name){
  id=String(id||'').trim();
  if(!id)return;
  name=(name||'').trim();
  if(!(await __confirm({icon:'🗑',title:'弃看剧集',message:'确定要弃看「'+(name||'该剧')+'」吗？弃看后将从追剧日历和继续观看中移除，观看历史保留。',okText:'弃看',tone:'danger'})))return;
  try{
    await __enqueueTrakt(async()=>{
      await __traktPost('/api/drop-show',{id:Number(id)});
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
      __toast('已弃看剧集',{type:'success'});
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

/* 「弃看剧集」按钮（日历/网格卡片上的 cal-drop-btn）的委托点击处理 */
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

document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-watched-id]');if(!btn)return;e.preventDefault();e.stopPropagation();if(btn.disabled)return;const type=btn.dataset.watchedType,id=btn.dataset.watchedId;if(!type||!id)return;const item=btn.closest('.item'),nameEl=item?item.querySelector('.name'):null,name=nameEl?nameEl.textContent:'';if(!(await __confirm({icon:'✓',title:'标记已看',message:'确定要把「'+(name||'该条目')+'」标记为已看吗？',okText:'标记',tone:'success'})))return;const prev=btn.textContent;btn.disabled=true;btn.textContent='…';try{await __enqueueTrakt(async()=>{await __traktPost('/api/mark-watched',{type,id});__fadeRemoveCard(btn.closest('.item'));__toast('已标记为已看',{type:'success'});});}catch(err){btn.disabled=false;btn.textContent=prev;__errToast('标记失败',err);}},true);
document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-unwatch-id]');if(!btn)return;e.preventDefault();e.stopPropagation();if(btn.disabled)return;const type=btn.dataset.unwatchType,id=btn.dataset.unwatchId;if(!type||!id)return;const item=btn.closest('.item'),nameEl=item?item.querySelector('.name'):null,name=nameEl?nameEl.textContent:'';if(!(await __confirm({icon:'↺',title:'取消观看',message:'确定要取消「'+(name||'该条目')+'」的观看记录吗？',okText:'取消观看',tone:'warn'})))return;const prev=btn.textContent;btn.disabled=true;btn.textContent='…';try{await __enqueueTrakt(async()=>{await __traktPost('/api/unmark-watched',{type,id});__fadeRemoveCard(btn.closest('.item'));__toast('已取消观看记录',{type:'success'});});}catch(err){btn.disabled=false;btn.textContent=prev;__errToast('取消失败',err);}},true);
var __searchTimer=null,__searchSeq=0;
/** （客户端）搜索结果卡片渲染 */
function __renderSearchItem(it){var emoji=it.type==='movie'?'🎬':'📺';var poster=it.poster?'<img src="'+__esc(it.poster)+'" loading="lazy" alt="">':'<div class="poster-ph"><span>'+emoji+'</span></div>';var tag=it.type==='movie'?'电影':'剧集';var ov=it.overview?'<div class="overview">'+__esc(it.overview)+'</div>':'';return '<div class="item clickable" data-detail-type="'+it.type+'" data-detail-id="tmdb-'+it.tmdbId+'" role="button" tabindex="0"><div class="poster">'+poster+'</div><div class="info"><div class="name-row"><span class="name">'+__esc(it.title)+'</span></div><div class="meta">'+tag+(it.year?' · '+__esc(String(it.year)):'')+'</div>'+ov+'</div></div>';}
/** （客户端）执行搜索（防抖由调用方控制） */
async function __doSearch(q){var box=document.getElementById('search-results');if(!box)return;if(!q){__loadTrending();return;}var seq=++__searchSeq;box.innerHTML='<div class="pane-loading"><div class="spinner"></div></div>';try{var r=await fetch('/api/search?q='+encodeURIComponent(q));if(seq!==__searchSeq)return;if(!r.ok)throw new Error('HTTP '+r.status);var data=await r.json();if(seq!==__searchSeq)return;var items=(data&&data.items)||[];if(!items.length){box.innerHTML='<div class="empty"><p>没有找到相关结果</p></div>';return;}box.innerHTML=items.map(__renderSearchItem).join('');}catch(err){if(seq!==__searchSeq)return;box.innerHTML='<div class="empty"><p>搜索失败：'+__esc(err.message)+'</p></div>';}}
var __trendingLoaded=false;
/** （客户端）TMDB 今日趋势加载 */
async function __loadTrending(force){var box=document.getElementById('search-results');if(!box)return;var inp=document.getElementById('search-input');if(inp&&inp.value.trim())return;if(box.querySelector('.trending-head')&&!force)return;box.innerHTML='<div class="pane-loading"><div class="spinner"></div></div>';try{var r=await fetch('/api/trending');if(!r.ok)throw new Error('HTTP '+r.status);var data=await r.json();var items=(data&&data.items)||[];if(!items.length){box.innerHTML='<div class="empty"><p>暂无趋势内容</p></div>';return;}__trendingLoaded=true;box.innerHTML='<div class="trending-head">TMDB 今日趋势</div>'+items.map(__renderSearchItem).join('');}catch(err){box.innerHTML='<div class="empty"><p>趋势加载失败：'+__esc(err.message)+'</p></div>';}}
window.__loadTrending=__loadTrending;
(function(){var inp=document.getElementById('search-input');if(!inp)return;inp.addEventListener('input',function(){if(__searchTimer)clearTimeout(__searchTimer);var q=inp.value.trim();if(!q){__loadTrending();return;}__searchTimer=setTimeout(function(){__doSearch(q);},380);});inp.addEventListener('keydown',function(e){if(e.key==='Enter'){if(__searchTimer)clearTimeout(__searchTimer);var q=inp.value.trim();if(q)__doSearch(q);else __loadTrending(true);}});})();
document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-wl-add-detail]');if(!btn)return;e.preventDefault();e.stopPropagation();if(btn.disabled)return;const type=btn.dataset.wlAddDetailType,tmdbId=btn.dataset.wlAddDetail;if(!type||!tmdbId)return;const nameEl=document.querySelector('.detail-title');const name=nameEl?nameEl.textContent:'';if(!(await __confirm({icon:'＋',title:'加入待看',message:'确定要把「'+(name||'该条目')+'」加入待看列表吗？',okText:'加入',tone:'success'})))return;const prev=btn.textContent;btn.disabled=true;btn.textContent='…';try{await __enqueueWrite(async()=>{await __traktPost('/api/watchlist/add',{type,tmdbId});const span=document.createElement('span');span.className='d-watchlist-badge';span.textContent='✓ 已在待看';btn.replaceWith(span);__toast('已加入待看列表',{type:'success'});if(document.getElementById('watchlist-grid')&&typeof onWatchlistSortChange==='function'){onWatchlistSortChange('added');}if(window.__refreshStats)window.__refreshStats();});}catch(err){btn.disabled=false;btn.textContent=prev;__errToast('加入失败',err);}},true);
var __listModalSections={playback:{title:'继续观看'},guduo:{title:'骨朵热榜',section:'guduo'},theater:{title:'平台剧场',section:'theater'},'douban-domestic':{title:'豆瓣热播国产剧',section:'domestic'},'douban-hktw':{title:'豆瓣热播港台剧',section:'hktw'},'douban-jpkr':{title:'豆瓣热播日韩剧',section:'jpkr'},'douban-western':{title:'豆瓣热播欧美剧',section:'western'}};
window.openListModal=function(id){var cfg=__listModalSections[id];if(!cfg)return;var modal=document.getElementById('list-modal');var title=document.getElementById('list-modal-title');var body=document.getElementById('list-modal-body');if(!modal||!title||!body)return;title.textContent=cfg.title||'';body.innerHTML='<div class="pane-loading"><div class="spinner"></div></div>';modal.classList.add('open');document.body.style.overflow='hidden';if(id==='playback'){fetch('/api/more?type=playback&page=1&limit=60&mode=grid').then(function(r){return r.ok?r.text():'';}).then(function(html){if(html)body.innerHTML='<div class="grid cw-modal-grid">'+html+'</div>';else body.innerHTML='<div class="empty"><p>暂无内容</p></div>';if(window.__scheduleEnrich)window.__scheduleEnrich();}).catch(function(){body.innerHTML='<div class="empty"><p>加载失败，请稍后重试</p></div>';});return;}if(id==='guduo'){body.innerHTML='<div id="guduo-filter-tabs" class="douban-filter-tabs" style="display:none"></div><div id="guduo-grid" class="grid"><div class="pane-loading"><div class="spinner"></div></div></div>';var ggrid=document.getElementById('guduo-grid'),gtabs=document.getElementById('guduo-filter-tabs');function loadGuduoGrid(cat){ggrid.innerHTML='<div class="pane-loading"><div class="spinner"></div></div>';fetch('/api/guduo-list?category='+encodeURIComponent(cat)+'&mode=grid').then(function(r){return r.ok?r.text():'';}).then(function(html){ggrid.innerHTML=html||'<div class="empty"><p>暂无内容</p></div>';if(window.__scheduleEnrich)window.__scheduleEnrich();}).catch(function(){ggrid.innerHTML='<div class="empty"><p>加载失败，请稍后重试</p></div>';});}loadGuduoGrid('all');fetch('/api/guduo-list?mode=categories').then(function(r){return r.ok?r.json():{categories:[]};}).then(function(d){var cats=(d&&d.categories)||[];if(!cats.length)return;var html='<button class="douban-filter-tab active" data-category="all">全部</button>';cats.forEach(function(p){html+='<button class="douban-filter-tab" data-category="'+__esc(p)+'">'+__esc(p)+'</button>';});gtabs.innerHTML=html;gtabs.style.display='';gtabs.querySelectorAll('.douban-filter-tab').forEach(function(btn){btn.addEventListener('click',function(){gtabs.querySelectorAll('.douban-filter-tab').forEach(function(b){b.classList.remove('active');});btn.classList.add('active');loadGuduoGrid(btn.getAttribute('data-category')||'all');});});}).catch(function(){});return;}if(id==='theater'){body.innerHTML='<div id="theater-filter-tabs" class="douban-filter-tabs" style="display:none"></div><div id="theater-grid" class="grid"><div class="pane-loading"><div class="spinner"></div></div></div>';var tgrid=document.getElementById('theater-grid'),tabsBox=document.getElementById('theater-filter-tabs');function loadTheater(platform){tgrid.innerHTML='<div class="pane-loading"><div class="spinner"></div></div>';fetch('/api/theater-list?platform='+encodeURIComponent(platform)+'&mode=grid').then(function(r){return r.ok?r.text():'';}).then(function(html){tgrid.innerHTML=html||'<div class="empty"><p>暂无内容</p></div>';if(window.__scheduleEnrich)window.__scheduleEnrich();}).catch(function(){tgrid.innerHTML='<div class="empty"><p>加载失败，请稍后重试</p></div>';});}loadTheater('all');fetch('/api/theater-list?mode=platforms').then(function(r){return r.ok?r.json():{platforms:[]};}).then(function(d){var platforms=(d&&d.platforms)||[];if(!platforms.length)return;var html='<button class="douban-filter-tab active" data-platform="all">全部</button>';platforms.forEach(function(p){html+='<button class="douban-filter-tab" data-platform="'+__esc(p)+'">'+__esc(p)+'</button>';});tabsBox.innerHTML=html;tabsBox.style.display='';tabsBox.querySelectorAll('.douban-filter-tab').forEach(function(btn){btn.addEventListener('click',function(){tabsBox.querySelectorAll('.douban-filter-tab').forEach(function(b){b.classList.remove('active');});btn.classList.add('active');loadTheater(btn.dataset.platform);});});}).catch(function(){});return;}var section=cfg.section;body.innerHTML='<div id="douban-modal-grid" class="grid"><div class="pane-loading"><div class="spinner"></div></div></div>';var grid=document.getElementById('douban-modal-grid');fetch('/api/douban-list?section='+encodeURIComponent(section)+'&mode=grid').then(function(r){return r.ok?r.text():'';}).then(function(html){if(html)grid.innerHTML=html;else grid.innerHTML='<div class="empty"><p>暂无内容</p></div>';if(window.__scheduleEnrich)window.__scheduleEnrich();}).catch(function(){grid.innerHTML='<div class="empty"><p>加载失败，请稍后重试</p></div>';});};
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
  body.innerHTML='<div class="douban-filter-tabs" id="platform-media-tabs"><button class="douban-filter-tab active" data-media="all">全部</button><button class="douban-filter-tab" data-media="movie">电影</button><button class="douban-filter-tab" data-media="tv">剧集</button></div><div id="platform-grid" class="grid"><div class="pane-loading"><div class="spinner"></div></div></div><div class="load-more-wrap" id="platform-more-wrap" style="display:none"><button type="button" class="load-more" id="platform-load-more">加载更多</button></div>';
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
    if(!append)grid.innerHTML='<div class="pane-loading"><div class="spinner"></div></div>';
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
  var btn=e.target&&e.target.closest&&e.target.closest(".platform-card[data-platform-id]");
  if(!btn)return;
  e.preventDefault();
  e.stopPropagation();
  var id=btn.getAttribute("data-platform-id");
  if(id)window.openPlatformList(id);
});
(function loadPlatformPreviews(){
  var busy=false;
  function paint(el,posters){
    var html="";
    for(var i=0;i<4;i++){
      if(posters[i]){
        html+='<img class="platform-card-poster p'+i+'" src="'+posters[i]+'" alt="" loading="lazy">';
      }else{
        html+='<span class="platform-card-poster p'+i+' platform-card-poster-ph"></span>';
      }
    }
    el.innerHTML=html;
  }
  function run(force){
    var nodes=document.querySelectorAll("[data-plat-posters]");
    if(!nodes.length)return;
    var need=0;
    for(var i=0;i<nodes.length;i++){if(force||nodes[i].dataset.loaded!=="1")need++;}
    if(!need&&!force)return;
    if(busy)return;
    busy=true;
    fetch("/api/platform-list?mode=previews"+(force?"&force=1":""))
      .then(function(r){return r.ok?r.json():null;})
      .then(function(d){
        var items=(d&&d.items)||{};
        for(var i=0;i<nodes.length;i++){
          var el=nodes[i],id=el.getAttribute("data-plat-posters");
          var posters=(id&&items[id])||[];
          el.dataset.loaded="1";
          if(posters.length)paint(el,posters);
        }
      })
      .catch(function(){
        for(var i=0;i<nodes.length;i++)nodes[i].dataset.loaded="0";
      })
      .then(function(){busy=false;});
  }
  window.__reloadPlatformPreviews=function(force){run(!!force);};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",function(){run(false);});
  else run(false);
  setTimeout(function(){run(false);},1200);
  setTimeout(function(){run(false);},3000);
})();
window.closeListModal=function(){var modal=document.getElementById('list-modal');if(!modal)return;modal.classList.remove('open');document.body.style.overflow='';};
document.addEventListener('keydown',function(e){if(e.key==='Escape'){var m=document.getElementById('list-modal');if(m&&m.classList.contains('open')){window.closeListModal();return;}}});
/** （客户端）横滑区通用加载 */
async function __loadHScroll(elId,url,keepId){
  var el=document.getElementById(elId);
  if(!el)return;
  el.innerHTML='<div class="pane-loading"><div class="spinner"></div></div>';
  try{
    var r=await fetch(url);
    var html=r.ok?await r.text():'';
    if(!html){el.innerHTML='<div class="h-scroll-empty"><span class="spinner"></span></div>';return;}
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
/** （客户端）骨朵热榜横滑加载 */
async function loadGuduoHScroll(category,force){category=category||'all';return __loadHScroll('guduo-hscroll','/api/guduo-list?mode=hscroll&category='+encodeURIComponent(category)+(force?'&force=1':''));}async function loadGuduoHomeTabs(){var tabsBox=document.getElementById('guduo-home-tabs');if(!tabsBox||tabsBox.dataset.loaded==='1')return;try{var r=await fetch('/api/guduo-list?mode=categories');var d=r.ok?await r.json():{categories:[]};var cats=(d&&d.categories)||[];if(!cats.length){}cats=cats.length?cats:['剧集','电影','动漫','综艺'];var html='<button class="theater-filter-tab active" data-category="all">全部</button>';for(var i=0;i<cats.length;i++){var p=cats[i];html+='<button class="theater-filter-tab" data-category="'+__esc(p)+'">'+__esc(p)+'</button>';}tabsBox.innerHTML=html;tabsBox.style.display='';tabsBox.dataset.loaded='1';tabsBox.addEventListener('click',function(e){var btn=e.target.closest('.theater-filter-tab');if(!btn)return;tabsBox.querySelectorAll('.theater-filter-tab').forEach(function(b){b.classList.remove('active');});btn.classList.add('active');loadGuduoHScroll(btn.getAttribute('data-category')||'all');});}catch(e){}}async function loadTheaterHScroll(platform,force){platform=platform||'all';return __loadHScroll('theater-hscroll','/api/theater-list?mode=hscroll&platform='+encodeURIComponent(platform)+(force?'&force=1':''));}
/** （客户端）平台剧场 tabs 初始化 */
async function loadTheaterHomeTabs(){var tabsBox=document.getElementById('theater-home-tabs');if(!tabsBox||tabsBox.dataset.loaded==='1')return;try{var r=await fetch('/api/theater-list?mode=platforms');var d=r.ok?await r.json():{platforms:[]};var platforms=(d&&d.platforms)||[];if(!platforms.length)return;var html='<button class="theater-filter-tab active" data-platform="all">全部</button>';for(var i=0;i<platforms.length;i++){var p=platforms[i];html+='<button class="theater-filter-tab" data-platform="'+__esc(p)+'">'+__esc(p)+'</button>';}tabsBox.innerHTML=html;tabsBox.style.display='';tabsBox.dataset.loaded='1';tabsBox.addEventListener('click',function(e){var btn=e.target.closest('.theater-filter-tab');if(!btn)return;tabsBox.querySelectorAll('.theater-filter-tab').forEach(function(b){b.classList.remove('active');});btn.classList.add('active');loadTheaterHScroll(btn.dataset.platform);});}catch(e){}}
(function(){var sections=[['douban-domestic','domestic'],['douban-hktw','hktw'],['douban-jpkr','jpkr'],['douban-western','western']];function loadOne(id,section,force){return __loadHScroll(id+'-hscroll','/api/douban-list?section='+section+'&mode=hscroll'+(force?'&force=1':''),true);}function start(force){sections.forEach(function(pair){loadOne(pair[0],pair[1],force);});var guduoTab=document.querySelector('#guduo-home-tabs .theater-filter-tab.active');var guduoCat=guduoTab?guduoTab.getAttribute('data-category')||'all':'all';var theaterTab=document.querySelector('#theater-home-tabs .theater-filter-tab.active');var theaterPlat=theaterTab?theaterTab.getAttribute('data-platform')||'all':'all';loadGuduoHScroll(guduoCat,force);if(force){var gt=document.getElementById('guduo-home-tabs');if(gt)gt.dataset.loaded='0';var tt=document.getElementById('theater-home-tabs');if(tt)tt.dataset.loaded='0';}loadGuduoHomeTabs();loadTheaterHScroll(theaterPlat,force);loadTheaterHomeTabs();if(window.__reloadPlatformPreviews)window.__reloadPlatformPreviews(false);}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){start(false);});else start(false);window.__reloadDoubanSections=start;})();
let modalLoadingId=0;window.__lastDetailType=null;window.__lastDetailId=null;async function openDetail(type,id,push=true){const modal=document.getElementById('modal'),body=document.getElementById('modal-body');if(!modal||!body)return;if(window.__stopTrailers)window.__stopTrailers();window.__lastDetailType=type;window.__lastDetailId=id;modal.classList.add('open');document.body.style.overflow='hidden';if(push&&location.pathname!=='/detail/'+type+'/'+id)history.pushState({detail:true},'','/detail/'+type+'/'+id);const reqId=++modalLoadingId;body.innerHTML='<div class="modal-loading"><div class="spinner"></div></div>';body.scrollTop=0;try{const r=await fetch('/api/detail?type='+encodeURIComponent(type)+'&id='+encodeURIComponent(id));if(reqId!==modalLoadingId)return;if(!r.ok)throw new Error('HTTP '+r.status);body.innerHTML=await r.text();if(window.__detailDeferLoad)window.__detailDeferLoad(type);}catch(e){if(reqId!==modalLoadingId)return;body.innerHTML='<div class="modal-error"><p>加载失败，请稍后重试</p><button class="btn-ghost" type="button" style="margin-top:14px" onclick="window.__retryDetail&&window.__retryDetail()">重试</button></div>';}}window.openDetail=openDetail;
window.__retryDetail=function(){if(window.__lastDetailType&&window.__lastDetailId)openDetail(window.__lastDetailType,window.__lastDetailId,false);};
/** （客户端）整季集列表懒加载（展开时才拉取） */
function __loadSeasonBody(body,head){if(!body||!head)return;if(body.dataset.loaded||body.dataset.loading)return;body.dataset.loading='1';body.innerHTML='<div class="modal-loading" style="padding:24px"><div class="spinner"></div></div>';fetch('/api/season?show='+encodeURIComponent(head.dataset.show||'')+'&season='+encodeURIComponent(head.dataset.season)+'&tmdb='+encodeURIComponent(head.dataset.tmdb)+'&slug='+encodeURIComponent(head.dataset.slug||'')).then(function(r){return r.ok?r.text():'';}).then(function(html){body.innerHTML=html;body.dataset.loaded='1';delete body.dataset.loading;}).catch(function(){body.innerHTML='<div class="modal-error" style="padding:20px">加载失败</div>';delete body.dataset.loading;});}
window.__detailDeferLoad=function(type){var wrap=document.getElementById('modal-body');if(!wrap)return;var root=wrap.querySelector('.detail-wrap')||wrap;var tmdbId=root.dataset.tmdbId||'';var imdbId=root.dataset.imdbId||'';var firstOpen=wrap.querySelector('.season-item.open .season-body');if(firstOpen&&!firstOpen.dataset.loaded&&!firstOpen.dataset.loading){var head=firstOpen.closest('.season-item').querySelector('.season-head');if(head)__loadSeasonBody(firstOpen,head);}var placeholders=wrap.querySelectorAll('[data-defer-section]');if(!placeholders.length)return;var url='/api/detail-extras?type='+encodeURIComponent(type)+'&tmdb='+encodeURIComponent(tmdbId)+'&imdb='+encodeURIComponent(imdbId);fetch(url,{credentials:'same-origin'}).then(function(r){return r.ok?r.json():null;}).then(function(data){if(!data)return;placeholders.forEach(function(el){var section=el.dataset.deferSection;var html=data[section+'Html']||'';if(section==='ratings'){if(html)el.innerHTML=html;else el.parentNode&&el.remove();return;}var parent=el.closest('.d-section')||el;if(!html){if(section==='trailers'){el.innerHTML='<p class="person-sub" style="padding:8px 0;color:#71717a;font-size:.85rem">暂无预告片</p>';el.removeAttribute('data-defer-section');}else{parent.style.display='none';}return;}el.innerHTML=html;el.removeAttribute('data-defer-section');});if(window.__scheduleEnrich)window.__scheduleEnrich();}).catch(function(){placeholders.forEach(function(el){if(el.dataset.deferSection==='ratings'){el.parentNode&&el.remove();return;}var parent=el.closest('.d-section')||el;parent.style.display='none';});});};
/** （客户端）停掉所有播放中的预告/视频 */
function __stopTrailers(){try{var root=document.getElementById('modal-body')||document.getElementById('modal')||document;var frames=root.querySelectorAll('.trailer-frame iframe, iframe[src*="youtube"]');frames.forEach(function(iframe){try{iframe.src='about:blank';}catch(e){}try{iframe.remove();}catch(e){}});var cards=root.querySelectorAll('.trailer-card.playing');cards.forEach(function(c){c.classList.remove('playing');var f=c.querySelector('.trailer-frame');if(f)f.innerHTML='';});var vids=root.querySelectorAll('video');vids.forEach(function(v){try{v.pause();v.removeAttribute('src');v.load();}catch(e){}});}catch(e){}}
/** （客户端）关闭详情弹窗（含历史记录处理） */
function closeDetail(push=true){const modal=document.getElementById('modal');if(!modal)return;if(push&&location.pathname.startsWith('/detail/')){__stopTrailers();history.back();return;}__stopTrailers();modal.classList.remove('open');document.body.style.overflow='';}window.closeDetail=closeDetail;window.__stopTrailers=__stopTrailers;
document.addEventListener('visibilitychange',function(){if(document.hidden&&window.__stopTrailers)window.__stopTrailers();});
document.addEventListener('click',(e)=>{const el=e.target.closest('[data-detail-type]');if(!el)return;const t=el.dataset.detailType,i=el.dataset.detailId;if(!t||!i)return;if(e.target.closest('button,a,.ep-watch-btn,.d-mark-btn,.d-watchlist-btn,.poster-play,.cal-open-btn,.cal-drop-btn'))return;e.preventDefault();openDetail(t,i);});
document.addEventListener('click',(e)=>{const mb=document.getElementById('modal-body');if(!mb||!mb.contains(e.target))return;const inner=e.target.closest('.detail-hero');if(!inner)return;if(e.target.closest('button,a,.item,.episode,.season-head'))return;const rect=inner.getBoundingClientRect();const y=e.clientY-rect.top;if(y<70)closeDetail();},true);
document.addEventListener('keydown',(e)=>{if(e.key!=='Escape')return;const sc=document.getElementById('show-cal-modal');if(sc&&sc.classList.contains('open')){closeShowCal();return;}closeDetail();});
document.addEventListener('click',(e)=>{const head=e.target.closest('.season-head');if(!head)return;toggleSeason(head);});
document.addEventListener('click',(e)=>{const ep=e.target.closest('.episode');if(!ep)return;const url=ep.dataset.traktUrl;if(!url)return;if(e.target.closest('.ep-watch-btn'))return;e.preventDefault();e.stopPropagation();window.open(url,'_blank','noopener');});
/** （客户端）展开/收起某季 */
async function toggleSeason(headEl){if(!headEl)return;const item=headEl.closest('.season-item');if(!item)return;const body=item.querySelector('.season-body');if(!body)return;if(item.classList.contains('open')){item.classList.remove('open');return;}item.classList.add('open');if(body.dataset.loaded)return;__loadSeasonBody(body,headEl);}
window.addEventListener('popstate',()=>{const path=location.pathname;if(path.startsWith('/detail/')){const parts=path.split('/').filter(Boolean);if(parts.length===3)openDetail(parts[1],parts[2],false);}else{closeDetail(false);}});
const __prefetched=new Set();
/** （客户端）详情页预取（touch 触发） */
function __prefetchDetail(type,id){if(!type||!id)return;const key=type+'/'+id;if(__prefetched.has(key))return;if(__prefetched.size>=60){const first=__prefetched.values().next().value;if(first!==undefined)__prefetched.delete(first);}__prefetched.add(key);fetch('/api/detail?type='+encodeURIComponent(type)+'&id='+encodeURIComponent(id),{cache:'default'}).catch(()=>{});}
document.addEventListener('touchstart',(e)=>{const el=e.target.closest('[data-detail-type]');if(el)__prefetchDetail(el.dataset.detailType,el.dataset.detailId);},{passive:true,capture:true});
var __showCal={byDay:{},year:0,month:0};
/** （客户端）补零 */
function __pad2(n){return(n<10?'0':'')+n;}
/** （客户端）ISO 时间 → 北京日期字符串 */
function __bjDay(iso){if(!iso)return '';var d=new Date(new Date(iso).getTime()+8*3600*1000);return d.getUTCFullYear()+'-'+__pad2(d.getUTCMonth()+1)+'-'+__pad2(d.getUTCDate());}
/** （客户端）打开某剧播出日历弹窗 */
function openShowCalendar(showId,showName,tmdbId){var modal=document.getElementById('show-cal-modal'),nameEl=document.getElementById('show-cal-name'),infoEl=document.getElementById('show-cal-info'),gridEl=document.getElementById('show-cal-grid'),detailEl=document.getElementById('show-cal-detail');if(!modal||!gridEl)return;var now=new Date();__showCal.year=now.getFullYear();__showCal.month=now.getMonth();__showCal.byDay={};modal.classList.add('open');nameEl.textContent=showName||'';infoEl.textContent='正在加载…';gridEl.innerHTML='<div class="modal-loading" style="grid-column:1/-1;padding:40px 10px"><div class="spinner"></div></div>';detailEl.innerHTML='';renderShowCal();var apiUrl='/api/show-calendar?id='+encodeURIComponent(showId);if(tmdbId)apiUrl+='&tmdb='+encodeURIComponent(tmdbId);fetch(apiUrl).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}).then(function(data){if(data&&data.title)nameEl.textContent=data.title;var map={},eps=(data&&data.episodes)||[];for(var i=0;i<eps.length;i++){var ep=eps[i],day=__bjDay(ep.first_aired);if(!day)continue;if(!map[day])map[day]=[];map[day].push(ep);}__showCal.byDay=map;if(!eps.length){infoEl.textContent='暂无播出记录';}else{var keys=Object.keys(map).sort(),minLabel=keys[0].slice(0,7),maxLabel=keys[keys.length-1].slice(0,7);infoEl.textContent='共 '+keys.length+' 天有更新 · '+minLabel+' ~ '+maxLabel+'（点 ◀ ▶ 翻月）';}renderShowCal();}).catch(function(){infoEl.textContent='加载失败';gridEl.innerHTML='<div class="modal-error" style="grid-column:1/-1;padding:40px 10px">加载失败</div>';});}
/** （客户端）关闭播出日历弹窗 */
function closeShowCal(){var modal=document.getElementById('show-cal-modal');if(modal)modal.classList.remove('open');}window.closeShowCal=closeShowCal;
/** （客户端）日历翻月 */
function calShiftMonth(delta){var m=__showCal.month+delta,y=__showCal.year;while(m<0){m+=12;y--;}while(m>11){m-=12;y++;}__showCal.month=m;__showCal.year=y;renderShowCal();}window.calShiftMonth=calShiftMonth;
/** （客户端）渲染日历网格与选中日详情 */
function renderShowCal(){var titleEl=document.getElementById('show-cal-month'),gridEl=document.getElementById('show-cal-grid'),detailEl=document.getElementById('show-cal-detail');if(!titleEl||!gridEl)return;var y=__showCal.year,m=__showCal.month;titleEl.textContent=y+' 年 '+(m+1)+' 月';var firstDow=new Date(Date.UTC(y,m,1)).getUTCDay(),daysInMonth=new Date(Date.UTC(y,m+1,0)).getUTCDate(),todayStr=__bjDay(new Date().toISOString()),html='',i;for(i=0;i<firstDow;i++){html+='<div class="sc-day sc-empty"></div>';}for(var d=1;d<=daysInMonth;d++){var dayStr=y+'-'+__pad2(m+1)+'-'+__pad2(d),eps=__showCal.byDay[dayStr]||[],cls='sc-day';if(eps.length){if(dayStr===todayStr)cls+=' sc-has sc-today-day';else if(dayStr<todayStr)cls+=' sc-has sc-past';else cls+=' sc-has sc-future';}var badge=eps.length?'<span class="sc-badge">'+eps.length+'</span>':'';html+='<div class="'+cls+'" data-day="'+dayStr+'"><span class="sc-num">'+d+'</span>'+badge+'</div>';}gridEl.innerHTML=html;detailEl.innerHTML='';var days=gridEl.querySelectorAll('.sc-day[data-day]');for(var j=0;j<days.length;j++){(function(el){el.addEventListener('click',function(){var day=el.getAttribute('data-day'),arr=__showCal.byDay[day]||[];if(!arr.length)return;var all=gridEl.querySelectorAll('.sc-day');for(var q=0;q<all.length;q++)all[q].classList.remove('sc-active');el.classList.add('sc-active');var dh='';for(var e=0;e<arr.length;e++){var ep=arr[e];dh+='<div class="sc-ep"><span class="sc-ep-tag">S'+__pad2(ep.season)+'E'+__pad2(ep.number)+'</span><span class="sc-ep-title">'+__esc(ep.title||'')+'</span></div>';}detailEl.innerHTML=dh;});})(days[j]);}}
document.addEventListener('click',function(e){var btn=e.target.closest('[data-cal-show-id]');if(!btn)return;e.preventDefault();e.stopPropagation();openShowCalendar(btn.getAttribute('data-cal-show-id'),btn.getAttribute('data-cal-show-name')||'',btn.getAttribute('data-cal-show-tmdb')||'');},true);
document.addEventListener('click',async(e)=>{const btn=e.target.closest('.ep-watch-btn');if(!btn)return;e.preventDefault();e.stopPropagation();const episodeId=btn.dataset.episodeId;if(!episodeId)return;if(!(await __confirm({icon:'✓',title:'标记本集已看',message:'确定要把这一集标记为已看吗？',okText:'标记',tone:'success'})))return;const prev=btn.textContent;btn.disabled=true;btn.textContent='…';try{await __enqueueTrakt(async()=>{await __traktPost('/api/mark-watched',{type:'episode',id:episodeId});btn.textContent='已看';btn.classList.add('done');btn.classList.add('watched');btn.classList.remove('unwatched');btn.disabled=true;__toast('已标记为已看',{type:'success'});const parts=location.pathname.split('/').filter(Boolean);if(parts[0]==='detail'&&parts.length===3){setTimeout(()=>openDetail(parts[1],parts[2],false),400);}});}catch(err){btn.disabled=false;btn.textContent=prev;__errToast('标记失败',err);}},true);
document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-mark-movie]');if(!btn)return;e.preventDefault();e.stopPropagation();const id=btn.dataset.markMovie;if(!id)return;if(!(await __confirm({icon:'✓',title:'标记已看',message:'确定要把这部电影标记为已看吗？',okText:'标记',tone:'success'})))return;const prev=btn.textContent;btn.disabled=true;btn.textContent='…';try{await __enqueueTrakt(async()=>{await __traktPost('/api/mark-watched',{type:'movie',id});btn.textContent='✓ 已标记';btn.classList.add('done');__toast('已标记为已看',{type:'success'});const parts=location.pathname.split('/').filter(Boolean);if(parts[0]==='detail'&&parts.length===3){setTimeout(()=>openDetail(parts[1],parts[2],false),400);}if(window.__refreshStats)window.__refreshStats();});}catch(err){btn.disabled=false;btn.textContent=prev;__errToast('标记失败',err);}},true);
document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-unmark-movie]');if(!btn)return;e.preventDefault();e.stopPropagation();const id=btn.dataset.unmarkMovie;if(!id)return;if(!(await __confirm({icon:'↺',title:'取消观看',message:'确定要取消这部电影的观看记录吗？',okText:'取消观看',tone:'warn'})))return;const prev=btn.textContent;btn.disabled=true;btn.textContent='…';try{await __enqueueTrakt(async()=>{await __traktPost('/api/unmark-watched',{type:'movie',id});btn.textContent='已取消';__toast('已取消观看记录',{type:'success'});const parts=location.pathname.split('/').filter(Boolean);if(parts[0]==='detail'&&parts.length===3){setTimeout(()=>openDetail(parts[1],parts[2],false),400);}if(window.__refreshStats)window.__refreshStats();});}catch(err){btn.disabled=false;btn.textContent=prev;__errToast('取消失败',err);}},true);
document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-mark-season-all]');if(!btn)return;e.preventDefault();e.stopPropagation();if(btn.disabled)return;const showId=btn.dataset.markSeasonAll,season=btn.dataset.seasonNum;if(!showId||season==null||season==='undefined')return;if(!(await __confirm({icon:'✓',title:'标记本季已看',message:'确定要把第 '+season+' 季所有已播出集数标记为已看吗？',okText:'标记',tone:'success'})))return;const prev=btn.textContent;btn.disabled=true;btn.textContent='…';try{await __enqueueTrakt(async()=>{let data=await __traktPost('/api/mark-season-watched',{showId,season:Number(season)});if(data==null)data={};if(data&&data.marked===0){btn.disabled=false;btn.textContent=prev;__toast(data.message||'本季暂无可标记的已播出集数',{type:'warn'});return;}btn.textContent='✓ 已标记';btn.classList.add('done');__toast('已标记本季 '+(data&&data.marked?data.marked:0)+' 集',{type:'success'});const parts=location.pathname.split('/').filter(Boolean);if(parts[0]==='detail'&&parts.length===3){setTimeout(()=>openDetail(parts[1],parts[2],false),400);}if(window.__refreshStats)window.__refreshStats();});}catch(err){btn.disabled=false;btn.textContent=prev;__errToast('标记失败',err);}},true);
let __enrichTimer=null;const __enrichPromises=new Map();
/** （客户端）调度批量 enrich（60ms 去抖） */
function __scheduleEnrich(){if(__enrichTimer)return;__enrichTimer=setTimeout(__runEnrich,60);}window.__scheduleEnrich=__scheduleEnrich;
/** （客户端）批量执行 enrich：按键分组、分批请求、结果复用 */
async function __runEnrich(){__enrichTimer=null;const els=[...document.querySelectorAll('[data-enrich-key]')];if(!els.length)return;const byKey=new Map();for(const el of els){const k=el.dataset.enrichKey;if(!k)continue;if(!byKey.has(k))byKey.set(k,[]);byKey.get(k).push(el);el.removeAttribute('data-enrich-key');}if(!byKey.size)return;const needFetch=[];for(const[k,group]of byKey.entries()){const existing=__enrichPromises.get(k);if(existing){existing.then(d=>{if(d)group.forEach(el=>__applyEnrich(el,d));});}else{needFetch.push(k);}}if(!needFetch.length)return;for(let bi=0;bi<needFetch.length;bi+=20){const chunk=needFetch.slice(bi,bi+20);const batchPromise=fetch('/api/enrich',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:chunk.map(function(k){return{key:k};})})}).then(function(r){return r.ok?r.json():{};}).catch(function(){return{};});for(const k of chunk){const perKey=batchPromise.then(function(data){return(data&&data[k])||null;});__enrichPromises.set(k,perKey);perKey.then(function(d){if(d)byKey.get(k).forEach(function(el){__applyEnrich(el,d);});});}}if(__enrichPromises.size>400){const arr=[...__enrichPromises.keys()];for(let i=0;i<200;i++)__enrichPromises.delete(arr[i]);}}
/** （客户端）把 enrich 结果（海报/中文标题/简介）应用到卡片 */
function __applyEnrich(el,d){const posterBox=el.querySelector('.cw-poster')||el.querySelector('.poster');const locked=el.getAttribute('data-lock-poster')==='1';if(posterBox&&d.poster&&!locked){const cur=posterBox.querySelector('img, .poster-ph');if(cur&&cur.tagName==='IMG'){if(cur.src!==d.poster)cur.src=d.poster;}else if(cur){const img=document.createElement('img');img.src=d.poster;img.loading='lazy';img.alt='';cur.replaceWith(img);}}if(d.title){const nameEl=el.querySelector('.name');if(nameEl)nameEl.textContent=d.title;const cwTitle=el.querySelector('.cw-title');if(cwTitle)cwTitle.textContent=d.title;}if(d.overview){const info=el.querySelector('.info');if(info){let ov=info.querySelector('.overview');if(!ov){ov=document.createElement('div');ov.className='overview';const meta=info.querySelector('.meta');if(meta&&meta.nextSibling)info.insertBefore(ov,meta.nextSibling);else info.appendChild(ov);}ov.textContent=d.overview;}}}
window.__summaryState={period:'month',ref:''};
/** （客户端）小结默认时间基准 */
function __sumDefaultRef(period){var d=new Date(Date.now()+8*3600*1000);if(period==='year')return String(d.getUTCFullYear());return d.toISOString().slice(0,7);}
/** （客户端）热力图最大值 */
function __sumHeatmax(days){var m=1;if(days)for(var i=0;i<days.length;i++)if(days[i].count>m)m=days[i].count;return m;}
/** （客户端）观看小结渲染（统计卡/热力/TOP 榜） */
function __sumRender(data){if(!data||data.error)return '<div class="empty"><p>小结加载失败，请稍后重试</p></div>';var max=__sumHeatmax(data.days);var heat='';if(data.days&&data.days.length){heat='<div class="sum-heat">';for(var i=0;i<data.days.length;i++){var d=data.days[i],lv=Math.min(4,Math.ceil((d.count/max)*4));heat+='<span class="sum-heat-cell lv'+lv+'" title="'+__esc(d.date)+' · '+d.count+' 次"></span>';}heat+='</div>';}else heat='<p class="sum-muted">这段时间还没有观看记录</p>';function listBlock(title,rows,kind){if(!rows||!rows.length)return '';var h='<div class="sum-block"><h3 class="sum-h3">'+title+'</h3><div class="sum-list">';for(var i=0;i<rows.length;i++){var r=rows[i],meta='';if(kind==='movie')meta=r.plays+' 次'+(r.minutes?(' · '+r.minutes+' 分钟'):'');else meta=r.episodes+' 集 · '+r.plays+' 次';var clickable=r.detailType&&r.detailId;var openAttr=clickable?(' data-sum-type="'+__esc(r.detailType)+'" data-sum-id="'+__esc(r.detailId)+'" role="button" tabindex="0"'):'';var cls='sum-row'+(clickable?' sum-row-click':'');h+='<div class="'+cls+'"'+openAttr+'><span class="sum-rank">'+(i+1)+'</span><div class="sum-row-body"><div class="sum-row-title">'+__esc(r.title)+(r.year?(' <span class="sum-year">'+r.year+'</span>'):'')+'</div><div class="sum-row-meta">'+meta+'</div></div></div>';}return h+'</div></div>';}var busiest=data.busiest?'<div class="sum-chip">最忙一天 <strong>'+__esc(data.busiest.date)+'</strong> · '+data.busiest.count+' 次</div>':'';var trunc=data.truncated?'<p class="sum-muted">记录较多，仅统计本时段前 '+data.sampleSize+' 条</p>':'';return '<div class="sum-wrap">'+'<div class="sum-nav">'+'<button type="button" class="sum-nav-btn" onclick="window.__summaryNav(-1)" aria-label="上一时段">‹</button>'+'<div class="sum-nav-center">'+'<div class="sum-period-tabs">'+'<button type="button" class="sum-period-btn'+(data.period==='month'?' active':'')+'" onclick="window.__summarySetPeriod(\\'month\\')">月度</button>'+'<button type="button" class="sum-period-btn'+(data.period==='year'?' active':'')+'" onclick="window.__summarySetPeriod(\\'year\\')">年度</button>'+'</div>'+'<div class="sum-label">'+__esc(data.label)+'</div>'+'</div>'+'<button type="button" class="sum-nav-btn" onclick="window.__summaryNav(1)" aria-label="下一时段">›</button>'+'</div>'+'<div class="sum-stats">'+'<div class="sum-stat"><div class="sum-stat-num">'+data.movies+'</div><div class="sum-stat-label">电影</div></div>'+'<div class="sum-stat"><div class="sum-stat-num">'+data.shows+'</div><div class="sum-stat-label">剧集</div></div>'+'<div class="sum-stat"><div class="sum-stat-num">'+data.episodes+'</div><div class="sum-stat-label">集数</div></div>'+'<div class="sum-stat"><div class="sum-stat-num">'+data.hours+'</div><div class="sum-stat-label">小时</div></div>'+'</div>'+busiest+trunc+'<div class="sum-block"><h3 class="sum-h3">观看热力</h3>'+heat+'</div>'+listBlock('电影 TOP',data.topMovies,'movie')+listBlock('剧集 TOP',data.topShows,'show')+'</div>';}
window.__summarySetPeriod=function(period){window.__summaryState.period=period;window.__summaryState.ref=__sumDefaultRef(period);window.__loadSummary(true);};
window.__summaryNav=function(dir){var st=window.__summaryState;if(!st._prevRef&&!st._nextRef)return;if(dir<0&&st._prevRef)st.ref=st._prevRef;if(dir>0&&st._nextRef)st.ref=st._nextRef;window.__loadSummary(true);};
document.addEventListener('click',function(e){var row=e.target&&e.target.closest&&e.target.closest('.sum-row-click');if(!row)return;var type=row.getAttribute('data-sum-type'),id=row.getAttribute('data-sum-id');if(!type||!id)return;e.preventDefault();if(typeof openDetail==='function')openDetail(type,id,true);});
window.__openSummary=function(){var modal=document.getElementById('summary-modal');if(!modal)return;modal.classList.add('open');modal.style.display='block';document.body.style.overflow='hidden';window.__loadSummary(true);};
window.__closeSummary=function(){var modal=document.getElementById('summary-modal');if(!modal)return;modal.classList.remove('open');modal.style.display='none';document.body.style.overflow='';};
window.__loadSummary=async function(force){var body=document.getElementById('summary-modal-body');if(!body)return;if(body.dataset.loaded==='1'&&!force)return;var st=window.__summaryState;if(!st.ref)st.ref=__sumDefaultRef(st.period);body.innerHTML='<div class="pane-loading"><div class="spinner"></div></div>';try{var r=await fetch('/api/summary?period='+encodeURIComponent(st.period)+'&ref='+encodeURIComponent(st.ref));if(!r.ok)throw new Error('HTTP '+r.status);var data=await r.json();st.ref=data.ref||st.ref;st.period=data.period||st.period;st._prevRef=data.prevRef||null;st._nextRef=data.nextRef||null;body.innerHTML=__sumRender(data);body.dataset.loaded='1';}catch(e){body.innerHTML='<div class="empty"><p>小结加载失败，请稍后重试</p></div>';body.dataset.loaded='0';}};
document.addEventListener('click',function(e){var av=e.target&&e.target.closest&&e.target.closest('#hero-avatar');if(av){e.preventDefault();window.__openSummary&&window.__openSummary();}});
document.addEventListener('keydown',function(e){if(e.key==='Escape'){var m=document.getElementById('summary-modal');if(m&&m.classList.contains('open'))window.__closeSummary();}});
let __personLoadingId=0;
window.__openPerson=async function(id,name){if(!id)return;const modal=document.getElementById('person-modal');const body=document.getElementById('person-modal-body');const titleEl=document.getElementById('person-modal-name');if(!modal||!body)return;if(titleEl)titleEl.textContent=name||'';modal.classList.add('open');document.body.style.overflow='hidden';const reqId=++__personLoadingId;body.innerHTML='<div class="modal-loading"><div class="spinner"></div></div>';body.scrollTop=0;try{const r=await fetch('/api/person?id='+encodeURIComponent(id));if(reqId!==__personLoadingId)return;if(!r.ok)throw new Error('HTTP '+r.status);body.innerHTML=await r.text();}catch(e){if(reqId!==__personLoadingId)return;body.innerHTML='<div class="modal-error"><p>加载失败，请稍后重试</p></div>';}};
window.closePerson=function(){const modal=document.getElementById('person-modal');if(!modal)return;modal.classList.remove('open');const d=document.getElementById('modal');if(d&&d.classList.contains('open'))return;document.body.style.overflow='';};
document.addEventListener('click',function(e){const el=e.target.closest('[data-person-id]');if(!el)return;e.preventDefault();e.stopPropagation();window.__openPerson(el.getAttribute('data-person-id'),el.getAttribute('data-person-name')||'');});
document.addEventListener('click',function(e){const el=e.target.closest('[data-detail-type]');if(!el)return;if(el.closest('#person-modal')){window.closePerson();document.body.style.overflow='hidden';}},true);
document.addEventListener('keydown',function(e){if(e.key!=='Escape')return;const pm=document.getElementById('person-modal');if(pm&&pm.classList.contains('open')){window.closePerson();e.stopPropagation();}},true);
document.addEventListener('click',function(e){const card=e.target.closest('.trailer-card');if(!card||card.classList.contains('playing'))return;const key=card.getAttribute('data-yt-key');if(!key)return;card.classList.add('playing');const frame=card.querySelector('.trailer-frame');if(frame){frame.innerHTML='<iframe src="https://www.youtube-nocookie.com/embed/'+encodeURIComponent(key)+'?autoplay=1&rel=0&modestbranding=1" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture;web-share" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>';}});
window.addEventListener('load',()=>{setTimeout(__runEnrich,200);});`
  );
}

let __pageStylesCache = null;

/* ============================================================
 * 二十五、全站样式表
 * ============================================================ */
function pageStyles() {
  if (__pageStylesCache) return __pageStylesCache;
  __pageStylesCache = `html { color-scheme: dark; }
html[data-theme="light"] { color-scheme: light; }
@media (prefers-color-scheme: light) { html[data-theme="system"] { color-scheme: light; } }
html, body { background: var(--bg-solid); color: var(--text); margin: 0; padding: 0; min-height: 100%; min-height: 100dvh; transition: background-color 0.2s ease, color 0.2s ease; }
* { box-sizing: border-box; margin: 0; padding: 0; }
.splash { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; overflow: hidden; background: var(--splash-bg); transition: opacity 0.22s ease; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; -webkit-tap-highlight-color: transparent; animation: splashAutoHide 0.22s ease 0.45s forwards; }
.splash.hide { opacity: 0; pointer-events: none; animation: none; }
@keyframes splashAutoHide { to { opacity: 0; visibility: hidden; pointer-events: none; } }
.splash-glow { position: absolute; width: 340px; height: 340px; border-radius: 50%; background: radial-gradient(circle, var(--splash-glow-color) 0%, rgba(125, 157, 212, 0) 70%); animation: splashPulse 2.4s ease-in-out infinite; }
.splash-inner { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: 20px; }
.splash-logo { color: var(--splash-name-b); animation: splashPop 0.75s cubic-bezier(0.22, 1.1, 0.36, 1) both; }
.splash-logo img { display: block; }
.splash-name { font-size: 1.35rem; font-weight: 800; letter-spacing: 0.4px; background: var(--name-grad); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; animation: splashFadeUp 0.6s ease 0.28s both; }
.splash-bar { width: 128px; height: 3px; border-radius: 99px; background: var(--bar-track); overflow: hidden; animation: splashFadeUp 0.6s ease 0.45s both; }
.splash-bar-fill { height: 100%; width: 42%; border-radius: 99px; background: var(--splash-bar-fill); animation: splashSlide 1.15s cubic-bezier(0.65, 0, 0.35, 1) infinite; }
@keyframes splashPulse { 0%, 100% { transform: scale(0.85); opacity: 0.7; } 50% { transform: scale(1.12); opacity: 1; } }
@keyframes splashPop { 0% { opacity: 0; transform: scale(0.55) rotate(-8deg); } 60% { opacity: 1; transform: scale(1.08) rotate(2deg); } 100% { opacity: 1; transform: scale(1) rotate(0); } }
@keyframes splashFadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes splashSlide { 0% { transform: translateX(-130%); } 100% { transform: translateX(330%); } }
.spinner { width: 30px; height: 30px; border: 3px solid var(--spinner-track); border-top-color: var(--spinner-active); border-radius: 50%; animation: spin 0.8s linear infinite; margin: 4px auto; }
@keyframes spin { to { transform: rotate(360deg); } }
:root {
  --bg: #050505; --surface: #0e0e10; --surface-2: #16161a; --surface-3: #1c1c22;
  --border: rgba(255, 255, 255, 0.08); --border-strong: rgba(255, 255, 255, 0.14);
  --text: #f4f4f5; --text-dim: #a1a1aa; --text-mute: #71717a;
  --accent: #a78bfa; --accent-2: #c4b5fd; --accent-soft: rgba(167, 139, 250, 0.12); --accent-glow: rgba(167, 139, 250, 0.28);
  --success: #34d399; --blue: #c4b5fd;
  --radius-sm: 10px; --radius-md: 14px; --radius-lg: 18px; --radius-xl: 22px;
  --shadow-card: 0 8px 32px rgba(0, 0, 0, 0.55);
  --bg-solid: #000000; --panel-grad: linear-gradient(165deg, #16161a 0%, #0e0e10 100%);
  --hover-bg: rgba(255, 255, 255, 0.04); --hover-bg-strong: rgba(255, 255, 255, 0.09);
  --sticky-bg: rgba(5, 5, 5, 0.88); --sticky-border: rgba(255, 255, 255, 0.06); --sticky-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
  --overlay: rgba(2, 4, 8, 0.78); --overlay-strong: rgba(0, 0, 0, 0.78); --modal-bg: #000000;
  --toast-bg: rgba(20, 22, 28, 0.96); --toast-text: #ffffff;
  --bar-track: rgba(255, 255, 255, 0.1); --spinner-track: #212735; --spinner-active: #7d9dd4;
  --splash-bg: radial-gradient(circle at 50% 45%, #0a0a0a 0%, #000 62%);
  --launch-splash-bg: radial-gradient(120% 90% at 50% 108%, rgba(124, 58, 237, 0.3) 0%, rgba(124, 58, 237, 0) 55%), radial-gradient(110% 85% at 50% -12%, rgba(56, 97, 190, 0.25) 0%, rgba(0, 0, 0, 0) 55%), #000;
  --launch-glow: rgba(124, 58, 237, 0.18); --splash-glow-color: rgba(125, 157, 212, 0.55); --splash-name-b: #a8b2c4;
  --splash-bar-fill: linear-gradient(90deg, #7d9dd4, #a78bfa);
  --name-grad: linear-gradient(135deg, #fff 20%, #c4b5fd 90%); --num-grad: linear-gradient(180deg, #fff 0%, #c4b5fd 100%);
  --brand-grad: linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%); --brand-grad-hover: linear-gradient(145deg, #8b5cf6, #a78bfa);
  --avatar-ring: rgba(167, 139, 250, 0.45); --avatar-grad: linear-gradient(135deg, #1a2233, #2a3a55);
  --soft-card-grad: var(--soft-card-grad);
  --btn-hover-bg: rgba(167, 139, 250, 0.1); --btn-hover-border: rgba(167, 139, 250, 0.35); --btn-hover-shadow: 0 4px 16px rgba(167, 139, 250, 0.18);
  --danger-bg: rgba(224, 85, 96, 0.1); --danger-border: rgba(224, 85, 96, 0.35); --danger-shadow: 0 4px 16px rgba(224, 85, 96, 0.15);
  --poster-ph-bg: rgba(0, 0, 0, 0.65); --shadow-avatar: rgba(0, 0, 0, 0.5); --shadow-login: rgba(0, 0, 0, 0.7);
  --detail-hero-grad: linear-gradient(180deg, rgba(10, 14, 24, 0.6), rgba(10, 14, 24, 0.95)); --detail-bg-filter: brightness(0.5);
  --chip-bg: rgba(255, 255, 255, 0.05); --chip-bg-hover: rgba(255, 255, 255, 0.09); --chip-fg: #a1a1aa; --chip-fg-hover: #f4f4f5; --chip-border: rgba(255, 255, 255, 0.08); --chip-accent: #a78bfa;
  --pill-bg: linear-gradient(165deg, rgba(255, 255, 255, 0.09) 0%, rgba(255, 255, 255, 0.04) 100%); --pill-border: rgba(255, 255, 255, 0.12); --pill-shadow: 0 8px 28px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.06); --pill-fg: rgba(255, 255, 255, 0.55); --pill-act-hover: rgba(255, 255, 255, 0.1);
  --platform-card-grad: linear-gradient(145deg, #1a1a1a 0%, #0a0a0a 100%); --platform-card-text: #ffffff; --platform-shadow-hover: rgba(0, 0, 0, 0.65);
  --scrollbar: #2a3345; --link: #c4b5fd; --link-hover: #ddd6fe;
  --success-fg: #4ade80; --warn-fg: #ffb84d; --danger-fg: #ff8a8a;
  --cal-accent: #4a6db8; --cal-accent-2: #9db0d0; --cal-accent-3: #7d9dd4; --cal-cell-border: #3a4a68; --cal-soft: rgba(90, 120, 180, 0.22); --cal-soft-border: rgba(140, 170, 220, 0.35);
}
html[data-theme="light"] {
  --danger-fg: #ff7b85; --chip-bg: #f4f4f5; --chip-bg-hover: #e4e4e7; --chip-fg: #3f3f46; --chip-fg-hover: #18181b; --chip-border: rgba(0, 0, 0, 0.1); --chip-accent: #7c3aed;
  --pill-bg: rgba(255, 255, 255, 0.92); --pill-border: rgba(0, 0, 0, 0.1); --pill-shadow: 0 8px 28px rgba(0, 0, 0, 0.08); --pill-fg: rgba(0, 0, 0, 0.6); --pill-act-hover: rgba(0, 0, 0, 0.06);
  --bg: #ffffff; --surface: #ffffff; --surface-2: #f7f7f8; --surface-3: #f1f1f3;
  --border: rgba(0, 0, 0, 0.08); --border-strong: rgba(0, 0, 0, 0.14);
  --text: #18181b; --text-dim: #52525b; --text-mute: #71717a;
  --accent: #7c3aed; --accent-2: #6d28d9; --accent-soft: rgba(124, 58, 237, 0.09); --accent-glow: rgba(124, 58, 237, 0.2);
  --success: #059669; --blue: #6d28d9; --shadow-card: 0 8px 28px rgba(0, 0, 0, 0.08);
  --bg-solid: #ffffff; --panel-grad: linear-gradient(165deg, #ffffff 0%, #f7f7f8 100%);
  --hover-bg: rgba(0, 0, 0, 0.035); --hover-bg-strong: rgba(0, 0, 0, 0.06);
  --sticky-bg: rgba(243, 243, 245, 0.92); --sticky-border: rgba(0, 0, 0, 0.07); --sticky-shadow: 0 6px 20px rgba(0, 0, 0, 0.1);
  --overlay: rgba(15, 18, 26, 0.42); --overlay-strong: rgba(15, 18, 26, 0.45); --modal-bg: #ffffff;
  --toast-bg: rgba(24, 24, 27, 0.94); --toast-text: #ffffff;
  --bar-track: rgba(0, 0, 0, 0.08); --spinner-track: #e4e4e7; --spinner-active: #7c3aed;
  --splash-bg: radial-gradient(circle at 50% 45%, #ffffff 0%, #f4f4f6 62%);
  --launch-splash-bg: radial-gradient(120% 90% at 50% 108%, rgba(124, 58, 237, 0.12) 0%, rgba(124, 58, 237, 0) 55%), radial-gradient(110% 85% at 50% -12%, rgba(56, 97, 190, 0.1) 0%, rgba(255, 255, 255, 0) 55%), #ffffff;
  --launch-glow: rgba(124, 58, 237, 0.1); --splash-glow-color: rgba(124, 58, 237, 0.22); --splash-name-b: #52525b;
  --splash-bar-fill: linear-gradient(90deg, #6d28d9, #7c3aed);
  --name-grad: linear-gradient(135deg, #18181b 20%, #7c3aed 90%); --num-grad: linear-gradient(180deg, #18181b 0%, #7c3aed 100%);
  --brand-grad: linear-gradient(135deg, #6d28d9 0%, #7c3aed 100%); --brand-grad-hover: linear-gradient(145deg, #7c3aed, #8b5cf6);
  --avatar-ring: rgba(124, 58, 237, 0.4); --avatar-grad: linear-gradient(135deg, #ede9fe, #ddd6fe);
  --soft-card-grad: linear-gradient(135deg, #ffffff, #f1f1f3);
  --btn-hover-bg: rgba(124, 58, 237, 0.1); --btn-hover-border: rgba(124, 58, 237, 0.35); --btn-hover-shadow: 0 4px 16px rgba(124, 58, 237, 0.18);
  --danger-bg: rgba(248, 113, 113, 0.16); --danger-border: rgba(248, 113, 113, 0.5); --danger-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  --poster-ph-bg: rgba(0, 0, 0, 0.06);
  --platform-card-grad: linear-gradient(145deg, #f4f4f5 0%, #e9e9ec 100%); --platform-card-text: #3f3f46; --platform-shadow-hover: rgba(0, 0, 0, 0.16);
  --scrollbar: #d4d4d8; --link: #6d28d9; --link-hover: #5b21b6;
  --success-fg: #059669; --warn-fg: #b45309;
  --cal-accent: #4a6db8; --cal-accent-2: #5b6b88; --cal-accent-3: #4a6db8; --cal-cell-border: #d4d9e6; --cal-soft: rgba(74, 109, 184, 0.12); --cal-soft-border: rgba(74, 109, 184, 0.3);
  --shadow-avatar: rgba(0, 0, 0, 0.12); --shadow-login: rgba(0, 0, 0, 0.1);
  --detail-hero-grad: linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(247, 247, 248, 0.96)); --detail-bg-filter: brightness(1.05) saturate(0.9);
}
@media (prefers-color-scheme: light) {
  html[data-theme="system"] {
    --shadow-avatar: rgba(0, 0, 0, 0.12); --shadow-login: rgba(0, 0, 0, 0.1);
    --detail-hero-grad: linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(247, 247, 248, 0.96)); --detail-bg-filter: brightness(1.05) saturate(0.9);
    --danger-fg: #ff7b85; --chip-bg: #f4f4f5; --chip-bg-hover: #e4e4e7; --chip-fg: #3f3f46; --chip-fg-hover: #18181b; --chip-border: rgba(0, 0, 0, 0.1); --chip-accent: #7c3aed;
    --pill-bg: rgba(255, 255, 255, 0.92); --pill-border: rgba(0, 0, 0, 0.1); --pill-shadow: 0 8px 28px rgba(0, 0, 0, 0.08); --pill-fg: rgba(0, 0, 0, 0.6); --pill-act-hover: rgba(0, 0, 0, 0.06);
    --bg: #ffffff; --surface: #ffffff; --surface-2: #f7f7f8; --surface-3: #f1f1f3;
    --border: rgba(0, 0, 0, 0.08); --border-strong: rgba(0, 0, 0, 0.14);
    --text: #18181b; --text-dim: #52525b; --text-mute: #71717a;
    --accent: #7c3aed; --accent-2: #6d28d9; --accent-soft: rgba(124, 58, 237, 0.09); --accent-glow: rgba(124, 58, 237, 0.2);
    --success: #059669; --blue: #6d28d9; --shadow-card: 0 8px 28px rgba(0, 0, 0, 0.08);
    --bg-solid: #ffffff; --panel-grad: linear-gradient(165deg, #ffffff 0%, #f7f7f8 100%);
    --hover-bg: rgba(0, 0, 0, 0.035); --hover-bg-strong: rgba(0, 0, 0, 0.06);
    --sticky-bg: rgba(243, 243, 245, 0.92); --sticky-border: rgba(0, 0, 0, 0.07); --sticky-shadow: 0 6px 20px rgba(0, 0, 0, 0.1);
    --overlay: rgba(15, 18, 26, 0.42); --overlay-strong: rgba(15, 18, 26, 0.45); --modal-bg: #ffffff;
    --toast-bg: rgba(24, 24, 27, 0.94); --toast-text: #ffffff;
    --bar-track: rgba(0, 0, 0, 0.08); --spinner-track: #e4e4e7; --spinner-active: #7c3aed;
    --splash-bg: radial-gradient(circle at 50% 45%, #ffffff 0%, #f4f4f6 62%);
    --launch-splash-bg: radial-gradient(120% 90% at 50% 108%, rgba(124, 58, 237, 0.12) 0%, rgba(124, 58, 237, 0) 55%), radial-gradient(110% 85% at 50% -12%, rgba(56, 97, 190, 0.1) 0%, rgba(255, 255, 255, 0) 55%), #ffffff;
    --launch-glow: rgba(124, 58, 237, 0.1); --splash-glow-color: rgba(124, 58, 237, 0.22); --splash-name-b: #52525b;
    --splash-bar-fill: linear-gradient(90deg, #6d28d9, #7c3aed);
    --name-grad: linear-gradient(135deg, #18181b 20%, #7c3aed 90%); --num-grad: linear-gradient(180deg, #18181b 0%, #7c3aed 100%);
    --brand-grad: linear-gradient(135deg, #6d28d9 0%, #7c3aed 100%); --brand-grad-hover: linear-gradient(145deg, #7c3aed, #8b5cf6);
    --avatar-ring: rgba(124, 58, 237, 0.4); --avatar-grad: linear-gradient(135deg, #ede9fe, #ddd6fe);
    --soft-card-grad: linear-gradient(135deg, #ffffff, #f1f1f3);
    --btn-hover-bg: rgba(124, 58, 237, 0.1); --btn-hover-border: rgba(124, 58, 237, 0.35); --btn-hover-shadow: 0 4px 16px rgba(124, 58, 237, 0.18);
    --danger-bg: rgba(248, 113, 113, 0.16); --danger-border: rgba(248, 113, 113, 0.5); --danger-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    --poster-ph-bg: rgba(0, 0, 0, 0.06);
    --platform-card-grad: linear-gradient(145deg, #f4f4f5 0%, #e9e9ec 100%); --platform-card-text: #3f3f46; --platform-shadow-hover: rgba(0, 0, 0, 0.16);
    --scrollbar: #d4d4d8; --link: #6d28d9; --link-hover: #5b21b6;
    --success-fg: #059669; --warn-fg: #b45309;
    --cal-accent: #4a6db8; --cal-accent-2: #5b6b88; --cal-accent-3: #4a6db8; --cal-cell-border: #d4d9e6; --cal-soft: rgba(74, 109, 184, 0.12); --cal-soft-border: rgba(74, 109, 184, 0.3);
  }
}
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; background: var(--bg-solid); background-attachment: fixed; color: var(--text); -webkit-font-smoothing: antialiased; line-height: 1.5; overflow-x: hidden; overscroll-behavior-y: none; }
a { color: var(--accent-2); text-decoration: none; transition: color 0.15s; }
a:hover { color: var(--link-hover); }
img { display: block; max-width: 100%; }
.container { max-width: 880px; width: 100%; margin: 0 auto; padding: 0 16px calc(80px + env(safe-area-inset-bottom)); }
.app-version { text-align: center; font-size: 0.7rem; color: var(--text-mute); opacity: 0.7; padding: 8px 0 4px; letter-spacing: 0.4px; user-select: none; }
.pane-loading { padding: 60px 20px; text-align: center; }
.load-more-wrap { text-align: center; margin-top: 24px; }
.load-more { background: var(--surface-2); border: 1px solid var(--border); color: var(--text); padding: 11px 32px; border-radius: var(--radius-md); font-size: 0.9rem; font-weight: 600; cursor: pointer; transition: all 0.2s; font-family: inherit; }
.load-more:hover:not(:disabled) { border-color: rgba(91, 124, 250, 0.45); color: var(--accent-2); box-shadow: 0 4px 20px var(--accent-glow); background: var(--surface-3); }
.load-more:disabled { cursor: not-allowed; }
.login-wrap { min-height: 100vh; min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 20px; }
.login-card { width: 100%; max-width: 440px; background: var(--panel-grad); border: 1px solid var(--border-strong); border-radius: 24px; padding: 44px 32px; text-align: center; box-shadow: 0 24px 64px var(--shadow-login), inset 0 1px 0 var(--hover-bg-strong); }
.login-logo { color: var(--splash-name-b); margin-bottom: 16px; }
.login-title { font-size: 1.75rem; font-weight: 800; letter-spacing: -0.5px; background: var(--name-grad); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 6px; }
.login-sub { color: var(--text-dim); font-size: 0.9rem; margin-bottom: 28px; }
.btn-primary { background: var(--brand-grad); color: #fff; border: none; padding: 13px 30px; border-radius: 12px; font-size: 0.95rem; font-weight: 700; cursor: pointer; box-shadow: 0 6px 24px var(--accent-glow); }
.btn-primary:hover { filter: brightness(1.08); transform: translateY(-1px); }
.btn-ghost { background: var(--chip-bg); color: var(--chip-fg); border: 1px solid var(--chip-border); padding: 8px 16px; border-radius: 10px; font-size: 0.85rem; cursor: pointer; transition: all 0.15s; font-family: inherit; }
.btn-ghost:hover { color: var(--chip-fg-hover); border-color: var(--chip-border); background: var(--chip-bg-hover); }
.steps { display: flex; flex-direction: column; gap: 6px; }
.step { display: flex; align-items: center; gap: 10px; text-align: left; padding: 4px 0; font-size: 0.9rem; }
.step .n { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; background: var(--accent); color: #fff; border-radius: 50%; font-size: 0.72rem; font-weight: 700; flex-shrink: 0; }
.code-box { font-family: ui-monospace, Menlo, monospace; font-size: 1.75rem; font-weight: 800; letter-spacing: 6px; color: #a8c0e8; background: rgba(90, 120, 180, 0.12); border: 1px solid rgba(140, 170, 220, 0.35); border-radius: 14px; padding: 14px; margin: 14px 0; user-select: all; text-align: center; }
.qr-box { background: #fff; border-radius: 14px; padding: 10px; display: inline-block; margin: 6px 0 14px; }
.qr-box img { border-radius: 8px; }
.status { display: inline-flex; align-items: center; gap: 8px; font-size: 0.88rem; padding: 8px 16px; border-radius: 20px; color: var(--text-dim); background: var(--surface-2); }
.status.success { color: #4ade80; background: rgba(74, 222, 128, 0.1); }
.status.error { color: #e05560; background: rgba(224, 85, 96, 0.12); }
.err-box { background: rgba(224, 85, 96, 0.1); border: 1px solid rgba(224, 85, 96, 0.28); border-radius: 12px; padding: 14px; text-align: left; margin-bottom: 14px; }
.err-title { font-weight: 600; color: #e05560; margin-bottom: 4px; font-size: 0.92rem; }
.err { color: #e8a3ab; font-size: 0.85rem; }
.hint { color: var(--text-dim); font-size: 0.82rem; margin-top: 6px; }
.log-details { margin-top: 18px; text-align: left; }
.log-details summary { cursor: pointer; font-size: 0.76rem; color: var(--text-dim); padding: 4px 0; user-select: none; }
.log-box { font-family: ui-monospace, Menlo, monospace; font-size: 0.7rem; color: var(--text-dim); background: var(--surface-3); border: 1px solid var(--border); border-radius: 8px; padding: 10px; max-height: 160px; overflow: auto; margin-top: 6px; line-height: 1.6; }
.hero { display: flex; justify-content: space-between; align-items: center; padding: calc(8px + env(safe-area-inset-top)) 0 6px; gap: 10px; }
.hero-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.hero-avatar { width: 50px; height: 50px; border-radius: 50%; overflow: hidden; flex-shrink: 0; background: var(--surface-2); border: 2px solid var(--avatar-ring); box-shadow: 0 0 0 3px var(--accent-soft), 0 4px 20px var(--shadow-avatar); }
.hero-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.hero-avatar-ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 1.25rem; background: var(--avatar-grad); }
.hero-text { min-width: 0; flex: 1; display: flex; flex-direction: column; align-items: flex-start; gap: 1px; }
.hero-name { font-size: 1.45rem; font-weight: 800; letter-spacing: -0.4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: var(--name-grad); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.updated-at { font-size: 0.72rem; color: var(--text-mute); font-weight: 400; letter-spacing: 0.2px; transition: color 0.4s ease; }
.updated-at:empty { display: none; }
.updated-at.flash { animation: updatedFlash 1.1s ease-out; }
.updated-at.src-live { color: #4ade80; }
.updated-at.src-cache { color: var(--text-mute); }
@keyframes updatedFlash { 0% { color: var(--accent-2); } 100% { color: var(--text-mute); } }
.hero-actions { display: flex; gap: 8px; flex-shrink: 0; }
.btn-action { display: inline-flex; align-items: center; gap: 6px; background: var(--chip-bg); color: var(--chip-fg); border: 1px solid var(--chip-border); padding: 8px 14px; border-radius: 10px; font-size: 0.82rem; font-weight: 600; cursor: pointer; font-family: inherit; transition: all 0.18s ease; -webkit-tap-highlight-color: transparent; }
.btn-action svg { flex-shrink: 0; transition: transform 0.25s ease; }
.btn-action:hover { color: var(--chip-fg-hover); border-color: var(--btn-hover-border); background: var(--btn-hover-bg); box-shadow: var(--btn-hover-shadow); }
.btn-action:hover svg { transform: rotate(180deg); }
.btn-action:active { transform: scale(0.97); }
#btn-logout:hover { color: var(--danger-fg); background: var(--danger-bg); border-color: var(--danger-border); box-shadow: var(--danger-shadow); }
#btn-logout:hover svg { transform: translateX(2px); }
#btn-theme:hover { color: var(--chip-accent); }
#btn-theme:hover svg { transform: none; }
#btn-theme svg { transition: opacity 0.2s ease, transform 0.2s ease; }
#btn-theme .theme-icon { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
@media (max-width: 768px) { .btn-action span { display: none; } .btn-action { padding: 9px; } .hero-actions { gap: 6px; } }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; background: var(--panel-grad); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 8px 6px; margin-bottom: 8px; box-shadow: var(--shadow-card), inset 0 1px 0 rgba(255, 255, 255, 0.04); position: relative; overflow: hidden; }
.stats::before { content: ""; position: absolute; top: 0; left: 10%; right: 10%; height: 1px; background: linear-gradient(90deg, transparent, rgba(167, 139, 250, 0.35), transparent); }
.stat { position: relative; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 2px; border-radius: 12px; transition: background 0.2s ease; }
.stat:hover { background: rgba(255, 255, 255, 0.025); }
.stat + .stat::before { content: ""; position: absolute; left: -4px; top: 18%; bottom: 18%; width: 1px; background: linear-gradient(180deg, transparent, rgba(255, 255, 255, 0.08), transparent); }
.stat-icon { width: 26px; height: 26px; border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-bottom: 2px; transition: transform 0.25s ease, box-shadow 0.25s ease; }
.stat:hover .stat-icon { transform: translateY(-1px) scale(1.06); }
.stat-movie .stat-icon { background: linear-gradient(135deg, rgba(167, 139, 250, 0.18), rgba(167, 139, 250, 0.06)); color: #c4b5fd; box-shadow: 0 4px 14px rgba(167, 139, 250, 0.18), inset 0 0 0 1px rgba(167, 139, 250, 0.18); }
.stat-show .stat-icon { background: linear-gradient(135deg, rgba(96, 165, 250, 0.18), rgba(96, 165, 250, 0.06)); color: #93c5fd; box-shadow: 0 4px 14px rgba(96, 165, 250, 0.18), inset 0 0 0 1px rgba(96, 165, 250, 0.18); }
.stat-episode .stat-icon { background: linear-gradient(135deg, rgba(52, 211, 153, 0.18), rgba(52, 211, 153, 0.06)); color: #6ee7b7; box-shadow: 0 4px 14px rgba(52, 211, 153, 0.18), inset 0 0 0 1px rgba(52, 211, 153, 0.18); }
.stat-hours .stat-icon { background: linear-gradient(135deg, rgba(251, 191, 36, 0.18), rgba(251, 191, 36, 0.06)); color: #fcd34d; box-shadow: 0 4px 14px rgba(251, 191, 36, 0.18), inset 0 0 0 1px rgba(251, 191, 36, 0.18); }
.stat-num { font-size: 1.2rem; font-weight: 800; letter-spacing: -0.6px; line-height: 1.1; background: var(--num-grad); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.stat-label { font-size: 0.7rem; color: var(--text-mute); font-weight: 500; }
.tabs { display: flex; gap: 4px; margin-bottom: 0; }
.top-sticky { position: sticky; top: 0; z-index: 40; margin: 0 -16px; padding: 0 16px; background: var(--sticky-bg); backdrop-filter: blur(18px) saturate(1.2); -webkit-backdrop-filter: blur(18px) saturate(1.2); border-bottom: 1px solid var(--sticky-border); box-shadow: var(--sticky-shadow); }
.top-sticky .hero { padding-top: calc(20px + env(safe-area-inset-top)); padding-bottom: 4px; }
.top-sticky .stats { margin-bottom: 4px; }
@media (min-width: 768px) { .top-sticky { margin: 0 -28px; padding: 0 28px 8px; } }
@media (min-width: 1024px) { .top-sticky { margin: 0 -36px; padding: 0 36px 8px; } }
@media (min-width: 1280px) { .top-sticky { margin: 0 -40px; padding: 0 40px 8px; } }
.tab { flex: 1 1 0; min-width: 0; background: transparent; border: none; color: var(--text-dim); padding: 7px 2px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; display: flex; align-items: center; justify-content: center; gap: 5px; transition: color 0.2s ease, background 0.2s ease; font-family: inherit; outline: none !important; }
.tab svg { flex-shrink: 0; opacity: 0.9; }
.tab span { overflow: hidden; text-overflow: ellipsis; }
.tab:hover { color: var(--text); background: rgba(255, 255, 255, 0.06); }
.tab.active { background: var(--brand-grad); color: #fff; font-weight: 700; }
.pane { display: none; }
.pane.active { display: block; animation: fadeIn 0.3s ease; padding-top: 12px; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.grid { display: flex; flex-direction: column; gap: 10px; }
.item { position: relative; display: flex; gap: 14px; background: var(--panel-grad); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 12px; transition: transform 0.2s ease, border-color 0.2s, box-shadow 0.2s; animation: fadeInUp 0.4s ease backwards; overflow: hidden; box-shadow: 0 4px 20px var(--shadow-card), inset 0 1px 0 var(--hover-bg); text-decoration: none; color: inherit; }
.item.clickable { cursor: pointer; }
.item.clickable:active { transform: scale(0.985); background: var(--surface-2); }
@keyframes fadeInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.item:hover { border-color: rgba(167, 139, 250, 0.25); box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(167, 139, 250, 0.08); transform: translateY(-1px); }
.wl-remove, .wl-drop, .wl-watched, .wl-unwatch { position: absolute; top: 6px; right: 6px; width: 26px; height: 26px; border-radius: 50%; background: rgba(0, 0, 0, 0.65); line-height: 1; cursor: pointer; z-index: 3; display: flex; align-items: center; justify-content: center; padding: 0; font-family: inherit; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); transition: background 0.15s, transform 0.15s, opacity 0.15s, color 0.15s; }
.wl-remove { color: #fff; border: 1px solid rgba(255, 255, 255, 0.22); font-size: 1rem; font-weight: 400; opacity: 0.88; }
.wl-remove:hover { background: rgba(200, 70, 80, 0.92); opacity: 1; transform: scale(1.06); }
.wl-drop { position: absolute; top: 6px; right: 6px; width: 30px; height: 30px; border-radius: 50%; background: rgba(0, 0, 0, 0.72); color: #ff8a8a; border: 1px solid rgba(255, 120, 120, 0.55); font-size: 0.85rem; opacity: 1; z-index: 5; display: flex; align-items: center; justify-content: center; padding: 0; cursor: pointer; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.wl-drop:hover { background: rgba(200, 70, 80, 0.95); color: #fff; transform: scale(1.08); }
.wl-drop svg { display: block; pointer-events: none; }
.wl-drop:disabled { opacity: 0.5; cursor: wait; }
.cal-action-row { display: flex; gap: 8px; margin-top: 8px; align-self: flex-start; flex-wrap: wrap; }
.cal-open-btn, .cal-drop-btn { align-self: auto; margin-top: 0; margin-left: 0; display: inline-flex; align-items: center; justify-content: center; padding: 5px 12px; border-radius: 8px; font-size: 0.74rem; font-weight: 600; cursor: pointer; font-family: inherit; transition: all 0.15s; white-space: nowrap; }
.cal-open-btn { background: rgba(90, 120, 180, 0.14); border: 1px solid rgba(140, 170, 220, 0.35); color: #9db5e0; }
.cal-open-btn:hover { background: rgba(120, 150, 210, 0.28); color: #c2d4f0; border-color: rgba(140, 170, 220, 0.65); }
.cal-open-btn svg { flex-shrink: 0; pointer-events: none; }
.cal-drop-btn { background: rgba(224, 85, 96, 0.14); border: 1px solid rgba(224, 85, 96, 0.4); color: #ff8a8a; }
.cal-drop-btn:hover { background: rgba(224, 85, 96, 0.3); color: #ffb3b3; border-color: rgba(224, 85, 96, 0.65); }
.cal-drop-btn svg { flex-shrink: 0; pointer-events: none; }
.cal-drop-btn:disabled { opacity: 0.5; cursor: wait; }
.wl-watched { color: #4ade80; border: 1px solid rgba(74, 222, 128, 0.45); font-size: 0.85rem; font-weight: 700; opacity: 0.9; }
.wl-watched:hover { background: rgba(74, 222, 128, 0.95); color: #000; opacity: 1; transform: scale(1.06); }
.wl-unwatch { color: #ffb84d; border: 1px solid rgba(255, 184, 77, 0.45); font-size: 0.9rem; font-weight: 700; opacity: 0.9; }
.wl-unwatch:hover { background: rgba(255, 184, 77, 0.95); color: #000; opacity: 1; transform: scale(1.06); }
.wl-remove:disabled, .wl-watched:disabled, .wl-unwatch:disabled { opacity: 0.5; cursor: wait; }
.poster { width: 76px; height: 114px; border-radius: 10px; overflow: hidden; flex-shrink: 0; background: var(--surface-2); position: relative; }
.poster img { width: 100%; height: 100%; object-fit: cover; }
.poster-ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 1.8rem; background: var(--soft-card-grad); color: var(--text-dim); }
.poster-play { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 46px; height: 46px; border-radius: 50%; background: rgba(8, 10, 18, 0.72); color: #fff; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); opacity: 1; transition: opacity 0.2s ease, transform 0.2s ease, background 0.15s ease, box-shadow 0.2s ease; text-decoration: none; border: 1px solid rgba(255, 255, 255, 0.24); z-index: 4; box-shadow: 0 4px 18px rgba(0, 0, 0, 0.55); -webkit-tap-highlight-color: transparent; }
.poster-play svg { display: block; margin-left: 2px; pointer-events: none; width: 24px; height: 24px; }
.item:hover .poster-play { opacity: 1; }
.poster-play:hover { background: linear-gradient(145deg, #8b5cf6, #a78bfa); transform: translate(-50%, -50%) scale(1.1); color: #fff; border-color: rgba(255, 255, 255, 0.4); box-shadow: 0 8px 28px rgba(139, 92, 246, 0.6); }
.poster-play:active { transform: translate(-50%, -50%) scale(0.94); }
.info { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 4px; }
.name-row { display: flex; align-items: baseline; gap: 0; overflow: hidden; white-space: nowrap; line-height: 1.3; letter-spacing: -0.2px; }
.name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 1rem; font-weight: 700; color: var(--text); }
.tag { flex: 0 0 auto; font-size: inherit; font-weight: inherit; letter-spacing: 0; white-space: nowrap; }
.tag.upcoming { color: #ffb84d; }
.overview { font-size: 0.8rem; color: var(--text-dim); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; line-height: 1.45; margin-top: 4px; }
.meta { font-size: 0.8rem; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta.dim { color: #7a8394; font-size: 0.78rem; margin-top: 2px; }
.bar { height: 3px; background: rgba(255, 255, 255, 0.06); border-radius: 99px; overflow: hidden; margin-top: 8px; }
.bar-fill { height: 100%; background: linear-gradient(90deg, #7c3aed, #c4b5fd); border-radius: 99px; box-shadow: 0 0 10px rgba(167, 139, 250, 0.5); }
.search-bar { margin-bottom: 16px; }
.search-input { width: 100%; background: var(--surface); border: 1px solid var(--border); color: var(--text); padding: 12px 16px; border-radius: 12px; font-size: 0.95rem; font-family: inherit; outline: none; transition: border-color 0.15s, background 0.15s; -webkit-appearance: none; appearance: none; }
.search-input:focus { border-color: var(--accent); background: var(--surface-2); box-shadow: 0 0 0 3px var(--accent-soft); }
.search-input::placeholder { color: var(--text-mute); }
.trending-head { display: flex; align-items: center; gap: 8px; font-size: 0.88rem; font-weight: 700; color: var(--text); margin: 4px 0 14px; padding-left: 2px; letter-spacing: 0.2px; }
.trending-head::before { content: ""; width: 3px; height: 14px; border-radius: 2px; background: linear-gradient(180deg, #f97316, #ef4444); }
.home-section { margin-bottom: 12px; }
.home-section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.home-section-title { font-size: 1rem; font-weight: 700; letter-spacing: 0.2px; display: flex; align-items: center; gap: 8px; }
.home-section-title::before { content: ""; width: 3px; height: 16px; border-radius: 2px; background: linear-gradient(180deg, #a78bfa, #7c3aed); }
.home-more-btn { background: transparent; border: none; color: var(--text-dim); font-size: 0.82rem; font-weight: 600; cursor: pointer; font-family: inherit; padding: 6px 10px; border-radius: 8px; transition: all 0.15s; display: inline-flex; align-items: center; gap: 4px; }
.home-more-btn:hover { color: var(--accent-2); background: rgba(167, 139, 250, 0.1); }
.home-more-btn svg { transition: transform 0.2s ease; }
.platform-section { margin-bottom: 14px; }
.platform-rows { display: flex; flex-direction: column; gap: 8px; }
.platform-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.platform-cards { display: flex; gap: 10px; overflow-x: auto; padding: 2px 2px 6px; -webkit-overflow-scrolling: touch; scrollbar-width: none; flex: 1; min-width: 0; scroll-snap-type: x proximity; }
.platform-cards::-webkit-scrollbar { display: none; }
.platform-card { flex: 0 0 auto; width: min(42vw, 168px); height: 74px; border: none; border-radius: 14px; background: var(--platform-card-grad); box-shadow: 0 8px 20px var(--shadow-card), inset 0 1px 0 var(--hover-bg-strong); display: flex; align-items: stretch; padding: 0; cursor: pointer; overflow: hidden; position: relative; scroll-snap-align: start; transition: transform 0.18s ease, box-shadow 0.18s ease; -webkit-tap-highlight-color: transparent; font: inherit; color: var(--platform-card-text); }
.platform-card:hover { transform: translateY(-3px); box-shadow: 0 16px 36px var(--platform-shadow-hover), inset 0 1px 0 var(--hover-bg-strong); }
html[data-theme="light"] .platform-card:hover { box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03), inset 0 1px 0 #ffffff; }
@media (prefers-color-scheme: light) { html[data-theme="system"] .platform-card:hover { box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03), inset 0 1px 0 #ffffff; } }
.platform-card:active { transform: scale(0.985); }
.platform-card-left { flex: 0 0 40%; max-width: 40%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0; padding: 6px 2px 6px 6px; z-index: 2; position: relative; }
.platform-card-logo { width: 60px; height: 60px; border-radius: 0; object-fit: contain; object-position: center; flex-shrink: 0; box-shadow: none; background: transparent; padding: 0; box-sizing: border-box; display: block; }
.platform-card-name { display: none; }
.platform-card-right { flex: 1; position: relative; min-width: 0; overflow: hidden; }
.platform-card-posters { position: absolute; right: -4px; top: 50%; transform: translateY(-50%); width: 96px; height: 66px; }
.platform-card-poster { position: absolute; width: 32px; height: 48px; border-radius: 6px; object-fit: cover; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.28); border: 1.5px solid rgba(255, 255, 255, 0.95); background: #c5c9d0; top: 50%; margin-top: -24px; }
.platform-card-poster-ph { background: linear-gradient(145deg, #d0d4db 0%, #b8bec8 100%); }
.platform-card-poster.p0 { right: 4px; z-index: 5; transform: rotate(8deg); }
.platform-card-poster.p1 { right: 20px; z-index: 4; transform: rotate(3deg); }
.platform-card-poster.p2 { right: 36px; z-index: 3; transform: rotate(-4deg); }
.platform-card-poster.p3 { right: 52px; z-index: 2; transform: rotate(-10deg); }
@media (min-width: 768px) {
  .platform-card { flex: 1 1 260px; min-width: 260px; width: auto; height: 96px; border-radius: 16px; }
  .platform-card-logo { width: 76px; height: 76px; border-radius: 0; padding: 0; }
  .platform-card-posters { width: 140px; height: 88px; }
  .platform-card-poster { width: 48px; height: 72px; margin-top: -36px; border-radius: 8px; }
  .platform-card-poster.p0 { right: 8px; } .platform-card-poster.p1 { right: 30px; } .platform-card-poster.p2 { right: 52px; } .platform-card-poster.p3 { right: 74px; }
  .platform-cards { gap: 12px; }
}
.h-scroll-wrap { margin: 0 -16px; padding: 0 16px; }
.h-scroll { display: flex; gap: 12px; overflow-x: auto; padding: 2px 0 8px; -webkit-overflow-scrolling: touch; scrollbar-width: none; scroll-snap-type: x proximity; }
.h-scroll::-webkit-scrollbar { display: none; }
.h-scroll-empty { padding: 30px 0; text-align: center; }
.h-scroll .item { flex: 0 0 auto; width: 132px; display: flex; flex-direction: column; gap: 0; padding: 0; border-radius: 12px; background: transparent; border: none; overflow: visible; animation: none; box-shadow: none; scroll-snap-align: start; transform: none; }
.h-scroll .item:hover { background: transparent; border: none; box-shadow: none; transform: none; }
.h-scroll .item.clickable:active { transform: scale(0.96); background: transparent; }
.h-scroll .item .poster { width: 100%; height: auto; aspect-ratio: 2/3; border-radius: 12px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5); transition: transform 0.25s ease, box-shadow 0.25s ease; }
.h-scroll .item:hover .poster { transform: translateY(-3px); box-shadow: 0 12px 28px rgba(91, 124, 250, 0.3), 0 4px 16px rgba(0, 0, 0, 0.6); }
.h-scroll .item .info { display: block; padding: 8px 2px 0; flex: none; justify-content: flex-start; }
.h-scroll .item .name { font-size: 0.82rem; line-height: 1.3; }
.h-scroll .item .overview { display: none; }
.h-scroll .item .meta { font-size: 0.72rem; margin-top: 2px; color: var(--text-dim); }
.h-scroll .item .meta.dim { font-size: 0.7rem; }
.h-scroll .cw-card { flex: 0 0 auto; width: 220px; display: flex; flex-direction: column; gap: 0; padding: 0; border-radius: 12px; background: transparent; border: none; overflow: visible; scroll-snap-align: start; position: relative; }
.h-scroll .cw-card:hover { background: transparent; border: none; box-shadow: none; transform: none; }
.h-scroll .cw-card.clickable:active { transform: scale(0.97); }
.cw-poster { position: relative; width: 100%; aspect-ratio: 16/9; border-radius: 12px; overflow: hidden; background: var(--surface-2); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5); }
html[data-theme="light"] .cw-poster { box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06); }
@media (prefers-color-scheme: light) { html[data-theme="system"] .cw-poster { box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06); } }
.cw-poster img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cw-poster .poster-ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 2rem; color: var(--text-dim); background: var(--soft-card-grad, var(--surface-2)); }
.cw-overlay { position: absolute; left: 8px; bottom: 12px; z-index: 2; font-size: 0.72rem; font-weight: 700; color: #fff; text-shadow: 0 1px 4px rgba(0,0,0,0.85); background: rgba(0,0,0,0.45); padding: 3px 8px; border-radius: 6px; backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); max-width: calc(100% - 16px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cw-bar { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgba(255,255,255,0.18); z-index: 3; }
.cw-bar-fill { height: 100%; background: linear-gradient(90deg, #a78bfa, #7c3aed); border-radius: 0 2px 2px 0; }
.cw-info { padding: 6px 2px 0; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.cw-title-row { display: flex; align-items: center; gap: 4px; min-width: 0; position: relative; line-height: 1.25; padding-right: 28px; }
.cw-title { flex: 1; min-width: 0; font-size: 0.82rem; font-weight: 600; line-height: 1.25; color: var(--text); display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
.cw-badge-rewatch { display: inline-flex; align-items: center; justify-content: center; padding: 0 5px; height: 16px; font-size: 0.62rem; font-weight: 700; color: #fff; background: linear-gradient(135deg, #8b5cf6, #a78bfa); border-radius: 4px; margin-left: 4px; flex-shrink: 0; transform: translateY(-1px); }
.cw-watching { font-size: 0.72rem; font-weight: 500; line-height: 1.25; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cw-meta { margin-top: 0; font-size: 0.68rem; line-height: 1.25; color: var(--text-mute, var(--text-dim)); }
.cw-more { position: absolute; right: -8px; top: 50%; transform: translateY(-50%); width: 36px; height: 36px; margin: 0; border: none; background: transparent; color: var(--text-dim); border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; font-family: inherit; transition: color 0.15s, background 0.15s; -webkit-tap-highlight-color: transparent; z-index: 6; touch-action: manipulation; }
.cw-more::before { content: ""; position: absolute; inset: -6px; border-radius: 50%; }
.cw-more:hover, .cw-more:active { color: var(--text); background: rgba(255,255,255,0.1); }
.cw-sheet { position: fixed; inset: 0; z-index: 500; display: none; }
.cw-sheet.open { display: block; }
.cw-sheet-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.55); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
.cw-sheet-panel { position: absolute; left: 12px; right: 12px; bottom: calc(12px + env(safe-area-inset-bottom, 0px)); background: var(--panel-grad, #1a1d27); border: 1px solid var(--border-strong, rgba(255,255,255,0.12)); border-radius: 16px; box-shadow: 0 16px 48px rgba(0,0,0,0.65); padding: 8px; animation: cwSheetIn 0.2s cubic-bezier(0.2, 0.9, 0.3, 1); }
@keyframes cwSheetIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
.cw-sheet-title { font-size: 0.78rem; color: var(--text-dim); padding: 8px 14px 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cw-sheet-item { display: block; width: 100%; text-align: left; border: none; background: transparent; color: var(--text); font-size: 1rem; font-weight: 600; font-family: inherit; padding: 16px 14px; border-radius: 12px; cursor: pointer; min-height: 48px; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
.cw-sheet-item:active { background: rgba(255,255,255,0.08); }
.cw-sheet-item.danger { color: #ff8a8a; }
.cw-sheet-cancel { margin-top: 4px; border-top: 1px solid var(--border, rgba(255,255,255,0.08)); color: var(--text-dim); font-weight: 500; }
@media (min-width: 700px) { .cw-sheet-panel { left: 50%; right: auto; bottom: auto; top: 50%; transform: translate(-50%, -50%); width: min(340px, 92vw); animation: cwSheetInCenter 0.2s cubic-bezier(0.2, 0.9, 0.3, 1); } @keyframes cwSheetInCenter { from { opacity: 0; transform: translate(-50%, -48%) scale(0.96); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } } }
.cw-modal-grid { padding: 2px 0 4px; }
.cw-card .wl-watched { top: 6px; right: 6px; }
@media (min-width: 768px) { .h-scroll .cw-card { width: 260px; } .cw-title { font-size: 0.86rem; } }
.h-scroll .item .bar { margin-top: 6px; }
.h-scroll .item .wl-watched, .h-scroll .item .wl-remove, .h-scroll .item .wl-drop, .h-scroll .item .wl-unwatch { top: 6px; right: 6px; width: 24px; height: 24px; font-size: 0.75rem; }
.h-scroll .item .cal-action-row, .h-scroll .item .cal-open-btn { display: none; }
.h-scroll .item .poster-play { width: 46px; height: 46px; opacity: 1; }
.h-scroll .item .poster-play svg { width: 24px; height: 24px; }
@media (min-width: 768px) { .h-scroll-wrap { margin: 0; padding: 0; } .h-scroll .item { width: 168px; } }
@media (min-width: 1024px) { .h-scroll .item { width: 188px; } }
@media (min-width: 1280px) { .h-scroll .item { width: 200px; } }
@media (min-width: 1600px) { .h-scroll .item { width: 214px; } }
@media (min-width: 1920px) { .container { width: 100%; padding-left: 48px; padding-right: 48px; } .h-scroll .item { width: 228px; } }
@media (min-width: 2200px) { .h-scroll .item { width: 240px; } }
.grid .item .cw-more { margin-left: auto; flex-shrink: 0; width: 28px; height: 28px; border: none; background: transparent; color: var(--text-dim); border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; padding: 0; }
.grid .item .cw-more:hover { color: var(--text); background: var(--chip-bg); }
.grid .item .name-row { display: flex; align-items: center; gap: 6px; }
.cw-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.cw-act-btn { flex: 1 1 auto; min-width: 0; padding: 8px 12px; border-radius: 10px; font-size: 0.78rem; font-weight: 600; font-family: inherit; cursor: pointer; border: 1px solid var(--chip-border); background: var(--chip-bg); color: var(--chip-fg); transition: background 0.15s, border-color 0.15s, color 0.15s; -webkit-tap-highlight-color: transparent; }
.cw-act-btn:hover { background: var(--chip-bg-hover); color: var(--chip-fg-hover); }
.cw-act-btn.danger { border-color: rgba(224, 85, 96, 0.35); background: rgba(224, 85, 96, 0.1); color: #ff8a8a; }
.cw-act-btn.danger:hover { background: rgba(224, 85, 96, 0.18); color: #ffb0b0; }
.h-scroll .cw-actions { flex-direction: column; gap: 6px; }
.h-scroll .cw-act-btn { width: 100%; padding: 7px 10px; font-size: 0.72rem; }
.list-modal { position: fixed; inset: 0; z-index: 150; display: none; }
.list-modal.open { display: block; }
.list-modal-backdrop { position: absolute; inset: 0; background: rgba(2, 4, 8, 0.8); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); animation: fadeIn 0.2s ease; }
.list-modal-panel { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(94vw, 1000px); max-height: 88vh; display: flex; flex-direction: column; background: var(--panel-grad); border: 1px solid var(--border-strong); border-radius: 18px; box-shadow: 0 30px 80px rgba(0, 0, 0, 0.85); overflow: hidden; animation: modalIn 0.25s cubic-bezier(0.2, 0.9, 0.3, 1); }
.list-modal-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.list-modal-title { font-size: 1.05rem; font-weight: 700; }
.list-modal-close { width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--chip-border); background: var(--chip-bg); color: var(--chip-fg); font-size: 1.2rem; cursor: pointer; font-family: inherit; line-height: 1; display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
.list-modal-close:hover { color: #fff; border-color: var(--border-strong); background: rgba(255, 255, 255, 0.08); }
.list-modal-body { overflow-y: auto; padding: 16px 20px 24px; -webkit-overflow-scrolling: touch; }
.douban-filter-tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.douban-filter-tab { background: var(--chip-bg); border: 1px solid var(--chip-border); color: var(--chip-fg); padding: 7px 16px; border-radius: 999px; font-size: 0.82rem; font-weight: 600; cursor: pointer; font-family: inherit; transition: all 0.15s; -webkit-tap-highlight-color: transparent; }
.douban-filter-tab:hover { color: var(--chip-fg-hover); border-color: var(--chip-border); background: var(--chip-bg-hover); }
.douban-filter-tab.active { background: var(--brand-grad); color: #fff; border-color: transparent; box-shadow: 0 4px 14px rgba(167, 139, 250, 0.3); }
.theater-home-tabs { display: flex; gap: 8px; overflow-x: auto; padding: 0 16px 12px; margin: 0 -16px; scrollbar-width: none; -webkit-overflow-scrolling: touch; scroll-snap-type: x proximity; }
.theater-home-tabs::-webkit-scrollbar { display: none; }
.theater-filter-tab { flex-shrink: 0; background: var(--chip-bg); border: 1px solid var(--chip-border); color: var(--chip-fg); padding: 6px 14px; border-radius: 999px; font-size: 0.78rem; font-weight: 600; cursor: pointer; font-family: inherit; transition: all 0.15s; -webkit-tap-highlight-color: transparent; scroll-snap-align: start; }
.theater-filter-tab:hover { color: var(--chip-fg-hover); border-color: var(--chip-border); background: var(--chip-bg-hover); }
.theater-filter-tab.active { background: var(--brand-grad); color: #fff; border-color: transparent; box-shadow: 0 4px 14px rgba(167, 139, 250, 0.3); }
@media (min-width: 768px) { .theater-home-tabs { margin: 0; padding-left: 0; padding-right: 0; } }
@media (max-width: 599px) { .list-modal-panel { top: auto; bottom: 0; left: 0; right: 0; transform: none; width: 100%; max-height: 92vh; border-radius: 18px 18px 0 0; } }
.show-cal-modal { position: fixed; inset: 0; z-index: 240; display: none; }
.show-cal-modal.open { display: block; }
.show-cal-backdrop { position: absolute; inset: 0; background: var(--overlay); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); animation: fadeIn 0.2s ease; }
.show-cal-panel { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(92vw, 440px); max-height: 90vh; overflow-y: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 20px; box-shadow: 0 30px 80px rgba(0, 0, 0, 0.8); animation: modalIn 0.25s cubic-bezier(0.2, 0.9, 0.3, 1); }
.show-cal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.show-cal-name { font-size: 0.95rem; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.show-cal-close { width: 40px; height: 40px; flex-shrink: 0; background: var(--chip-bg); border: 1px solid var(--chip-border); color: var(--chip-fg); border-radius: 50%; cursor: pointer; font-size: 1.2rem; line-height: 1; display: flex; align-items: center; justify-content: center; transition: all 0.15s; font-family: inherit; }
.show-cal-close:hover { color: var(--chip-fg-hover); border-color: var(--chip-border); background: var(--chip-bg-hover); }
.show-cal-info { font-size: 0.72rem; color: var(--text-dim); margin-bottom: 12px; line-height: 1.4; }
.show-cal-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; font-size: 0.88rem; color: var(--text); font-weight: 600; }
.show-cal-nav button { width: 30px; height: 30px; background: var(--chip-bg); border: 1px solid var(--chip-border); color: var(--chip-fg); border-radius: 8px; cursor: pointer; font-size: 1rem; line-height: 1; display: flex; align-items: center; justify-content: center; transition: all 0.15s; font-family: inherit; }
.show-cal-nav button:hover { color: var(--chip-fg-hover); border-color: var(--chip-border); background: var(--chip-bg-hover); }
.show-cal-weekdays { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; font-size: 0.7rem; color: var(--text-dim); margin-bottom: 6px; }
.show-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.sc-day { position: relative; aspect-ratio: 1; display: flex; align-items: center; justify-content: center; border-radius: 8px; font-size: 0.8rem; color: var(--text-dim); cursor: default; border: 1px solid transparent; transition: background 0.15s, border-color 0.15s; }
.sc-day.sc-has { cursor: pointer; font-weight: 700; }
.sc-day.sc-past { background: var(--cal-soft); color: var(--cal-accent-2); border-color: rgba(120, 150, 210, 0.5); }
.sc-day.sc-past:hover { background: var(--cal-soft-border); color: #d0dcf0; }
.sc-day.sc-today-day { background: var(--cal-accent); color: #fff; border-color: #7d9dd4; box-shadow: 0 0 14px rgba(125, 157, 212, 0.7); }
.sc-day.sc-today-day:hover { background: #5b7fc4; }
.sc-day.sc-future { background: rgba(255, 184, 77, 0.18); color: #ffd693; border-color: rgba(255, 184, 77, 0.55); }
.sc-day.sc-future:hover { background: rgba(255, 184, 77, 0.4); color: #fff0d0; }
.sc-day.sc-active { outline: 2px solid #fff; outline-offset: -2px; }
.sc-day.sc-empty { visibility: hidden; }
.sc-badge { position: absolute; top: 2px; right: 2px; min-width: 14px; height: 14px; padding: 0 3px; border-radius: 7px; background: var(--cal-accent); color: #fff; font-size: 0.6rem; font-weight: 700; line-height: 14px; text-align: center; }
.sc-day.sc-future .sc-badge { background: #d99a3a; }
.show-cal-legend { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; margin-top: 14px; font-size: 0.7rem; color: var(--text-dim); }
.legend-item { display: inline-flex; align-items: center; gap: 5px; }
.legend-dot { display: inline-block; width: 10px; height: 10px; border-radius: 3px; }
.legend-past { background: var(--cal-soft-border); border: 1px solid rgba(140, 170, 220, 0.8); }
.legend-today { background: var(--cal-accent); border: 1px solid #7d9dd4; }
.legend-future { background: rgba(255, 184, 77, 0.4); border: 1px solid rgba(255, 184, 77, 0.8); }
.show-cal-detail { margin-top: 14px; border-top: 1px solid var(--border); padding-top: 12px; min-height: 20px; }
.sc-ep { display: flex; gap: 10px; align-items: baseline; padding: 6px 0; font-size: 0.82rem; }
.sc-ep-tag { font-family: ui-monospace, Menlo, monospace; font-size: 0.72rem; font-weight: 700; color: #7d9dd4; flex-shrink: 0; }
.sc-ep-title { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ext-rating { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px 4px 8px; border-radius: 8px; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1); line-height: 1; font-size: 0.82rem; color: var(--text); white-space: nowrap; text-decoration: none; transition: background 0.15s, border-color 0.15s, transform 0.12s; }
.ext-rating:hover { background: rgba(255, 255, 255, 0.1); border-color: rgba(255, 255, 255, 0.16); }
.ext-logo { display: block; flex-shrink: 0; border-radius: 2px; }
.ext-score { font-weight: 800; letter-spacing: 0.2px; font-variant-numeric: tabular-nums; }
.ext-rating.ext-imdb { background: rgba(245, 197, 24, 0.14); border-color: rgba(245, 197, 24, 0.35); color: #f5c518; }
.ext-rating.ext-imdb .ext-score { color: #f5c518; }
.ext-rating.ext-rt { background: rgba(250, 50, 10, 0.12); border-color: rgba(250, 50, 10, 0.32); color: #ff7666; }
.ext-rating.ext-rt .ext-score { color: #ff7666; }
.ext-rating.ext-mc { background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.12); color: var(--text); }
.ext-rating.ext-trakt { background: rgba(237, 28, 36, 0.12); border-color: rgba(237, 28, 36, 0.32); color: #ff6b70; }
.ext-rating.ext-trakt .ext-score { color: #ff6b70; }
.ext-rating.ext-tmdb { background: rgba(1, 180, 228, 0.12); border-color: rgba(1, 180, 228, 0.32); color: #4dd0e1; }
.ext-rating.ext-tmdb .ext-score { color: #4dd0e1; }
.ext-rating.ext-douban { background: rgba(46, 150, 61, 0.12); border-color: rgba(46, 150, 61, 0.38); color: #4ecb71; }
.ext-rating.ext-douban:hover { background: rgba(46, 150, 61, 0.22); border-color: rgba(46, 150, 61, 0.6); color: #6fe089; }
.detail-ext-ratings { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 8px; align-items: center; }
@media (min-width: 600px) { .container { padding-left: 20px; padding-right: 20px; } .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; } .item { border-radius: 14px; } .poster { width: 72px; height: 108px; } }
@media (min-width: 768px) { .container { width: 100%; padding: 0 28px calc(76px + env(safe-area-inset-bottom)); } .hero { padding: 12px 0 8px; gap: 8px; } .hero-avatar { width: 56px; height: 56px; } .hero-name { font-size: 1.55rem; } .stats { gap: 6px; padding: 10px 8px; margin-bottom: 8px; } .stat-num { font-size: 1.5rem; } .stat-label { font-size: 0.76rem; } .stat-icon { width: 34px; height: 34px; border-radius: 10px; } .tabs { position: relative; overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; padding-bottom: 2px; } .tabs::-webkit-scrollbar { display: none; } .tab { flex: 0 0 auto; padding: 9px 14px; font-size: 0.87rem; } .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 16px; } .item { display: flex; flex-direction: column; gap: 0; padding: 0; border-radius: 12px; background: transparent; border: none; overflow: visible; } .item:hover { background: transparent; border: none; } .item.clickable:active { transform: none; background: transparent; } .poster { width: 100%; height: auto; aspect-ratio: 2/3; border-radius: 12px; transition: transform 0.25s ease, box-shadow 0.25s ease; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5); } .item:hover .poster { transform: translateY(-4px); box-shadow: 0 12px 32px rgba(91, 124, 250, 0.3), 0 4px 16px rgba(0, 0, 0, 0.6); } .info { display: block; padding: 10px 2px 0; flex: none; justify-content: flex-start; } .name { font-size: 0.88rem; } .overview { -webkit-line-clamp: 2; font-size: 0.74rem; margin-top: 4px; } .meta { font-size: 0.76rem; margin-top: 3px; } .meta.dim { font-size: 0.72rem; } .bar { margin-top: 8px; } .wl-remove, .wl-watched, .wl-unwatch { top: 8px; right: 8px; width: 28px; height: 28px; } .day-num { font-size: 1.6rem; } }
@media (min-width: 1024px) { .container { width: 100%; padding: 0 36px 100px; } .hero { padding: 14px 0 8px; } .hero-name { font-size: 1.7rem; } .stats { gap: 8px; padding: 12px 10px; margin-bottom: 10px; } .stat-num { font-size: 1.7rem; } .stat-label { font-size: 0.78rem; } .stat-icon { width: 36px; height: 36px; } .grid { grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 20px; } .name { font-size: 0.9rem; } .overview { -webkit-line-clamp: 3; font-size: 0.76rem; } .wl-remove, .wl-watched, .wl-unwatch { top: 10px; right: 10px; width: 30px; height: 30px; } .wl-watched, .wl-unwatch { font-size: 0.95rem; } }
@media (min-width: 1280px) { .container { width: 100%; padding: 0 40px 110px; } .grid { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 22px; } .hero-name { font-size: 1.85rem; } }
@media (min-width: 1600px) { .container { width: 100%; } .grid { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 24px; } }
.day { margin-bottom: 18px; }
.day-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; padding-left: 2px; }
.day-num { font-size: 1.8rem; font-weight: 800; color: #7d9dd4; line-height: 1; letter-spacing: -1px; }
.day-mon { font-size: 0.75rem; color: var(--text-dim); }
.day-wd { font-size: 0.85rem; font-weight: 600; color: var(--text); }
.today { background: var(--accent); color: #fff; font-size: 0.68rem; padding: 3px 9px; border-radius: 999px; font-weight: 700; margin-left: auto; }
.empty { text-align: center; padding: 80px 20px; color: var(--text-dim); }
.empty p { margin-top: 14px; font-size: 0.92rem; }
@media (min-width: 700px) { .empty { padding: 120px 20px; } }
.modal { position: fixed; inset: 0; z-index: 220; display: none; }
.modal.open { display: block; }
.modal-backdrop { position: absolute; inset: 0; background: var(--overlay-strong); backdrop-filter: blur(12px) saturate(1.1); -webkit-backdrop-filter: blur(12px) saturate(1.1); animation: fadeIn 0.2s ease; }
.modal-panel { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 12px; padding-top: calc(12px + env(safe-area-inset-top)); padding-bottom: calc(12px + env(safe-area-inset-bottom)); pointer-events: none; }
.modal-shell { pointer-events: auto; position: relative; display: flex; flex-direction: column; width: 100%; max-width: min(1120px, 100%); max-height: 100%; background: var(--modal-bg); border: 1px solid var(--border); border-radius: 18px; box-shadow: 0 40px 100px rgba(0, 0, 0, 0.85); animation: modalIn 0.28s cubic-bezier(0.2, 0.9, 0.3, 1); overflow: hidden; }
.modal-body { position: relative; width: 100%; flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; background: var(--modal-bg); -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
.modal-close { position: absolute; top: 12px; right: 12px; z-index: 5; width: 40px; height: 40px; border-radius: 50%; background: rgba(13, 16, 23, 0.86); border: 1px solid rgba(255, 255, 255, 0.18); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); transition: background 0.15s, transform 0.15s, border-color 0.15s; padding: 0; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.55); touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
.modal-close::before { content: ""; position: absolute; inset: -8px; border-radius: 50%; }
.modal-close:hover { background: rgba(30, 38, 58, 0.95); transform: scale(1.05); border-color: rgba(255, 255, 255, 0.28); }
.modal-close:active { transform: scale(0.94); background: rgba(50, 60, 88, 0.95); }
@media (max-width: 599px) { .modal-panel { padding: 0; align-items: stretch; justify-content: flex-start; } .modal-shell { position: absolute; left: 0; right: 0; top: calc(10px + env(safe-area-inset-top)); bottom: 0; max-width: 100%; max-height: none; width: 100%; border-radius: 16px 16px 0 0; border: none; border-top: 1px solid var(--border); } .modal-body { padding-bottom: env(safe-area-inset-bottom); } .detail-inner { padding-top: 24px; } .detail-body { padding-bottom: calc(28px + env(safe-area-inset-bottom)); } .modal-close { top: 12px; right: 12px; width: 40px; height: 40px; background: rgba(13, 16, 23, 0.94); border-color: rgba(255, 255, 255, 0.24); box-shadow: 0 6px 22px rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.08); } .modal-close::before { inset: -12px; } .modal-close:active { transform: scale(0.9); background: rgba(50, 60, 88, 0.96); } }
@media (min-width: 768px) and (max-width: 1023px) { .modal-shell { max-width: min(880px, 92vw); } }
@media (min-width: 700px) { .modal-panel { padding: 40px 24px; } }
@keyframes modalIn { from { opacity: 0; transform: translateY(14px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
.modal-loading { padding: 100px 20px; text-align: center; }
.modal-error { padding: 80px 20px; text-align: center; color: #9db5e0; font-size: 0.9rem; }
.detail-hero { position: relative; overflow: hidden; background: var(--surface); border-radius: 18px 18px 0 0; }
.detail-bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; filter: blur(30px) saturate(1.2) var(--detail-bg-filter, brightness(0.5)); transform: scale(1.15); z-index: 0; }
.detail-hero::after { content: ""; position: absolute; inset: 0; z-index: 1; background: var(--detail-hero-grad); }
.detail-inner { position: relative; z-index: 2; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 16px; padding: 24px 20px 24px; }
.detail-poster { width: min(48vw, 200px); height: auto; aspect-ratio: 2/3; border-radius: 14px; object-fit: cover; flex-shrink: 0; box-shadow: 0 16px 40px var(--shadow-login); margin: 0 auto; }
.detail-poster-ph { display: flex; align-items: center; justify-content: center; background: var(--surface-2); font-size: 2.8rem; color: var(--text-dim); width: min(48vw, 200px); aspect-ratio: 2/3; }
.detail-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; align-items: center; width: 100%; }
.detail-title { font-size: 1.45rem; font-weight: 800; letter-spacing: -0.4px; line-height: 1.25; color: var(--text); }
.detail-tagline { font-size: 0.85rem; color: var(--text-dim); font-style: italic; }
.detail-meta { display: flex; flex-wrap: wrap; gap: 10px; font-size: 0.85rem; color: var(--text-dim); justify-content: center; }
.detail-genres { font-size: 0.82rem; color: var(--text-dim); }
.detail-overview { font-size: 0.88rem; color: var(--text-dim); line-height: 1.55; margin-top: 4px; display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; text-align: center; }
.d-status { display: flex; gap: 12px; align-items: center; background: var(--panel-grad); border: 1px solid var(--border); border-radius: 14px; padding: 12px 14px; margin-top: 8px; width: 100%; justify-content: flex-start; }
.d-status.done { border-color: rgba(74, 222, 128, 0.3); background: rgba(74, 222, 128, 0.06); }
.d-status-progress { flex-direction: column; align-items: stretch; gap: 10px; }
.d-status-row { display: flex; gap: 12px; align-items: center; width: 100%; }
.d-status-icon { width: 32px; height: 32px; border-radius: 50%; background: var(--surface-2); color: var(--text-dim); display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; font-size: 0.95rem; }
.d-status.done .d-status-icon { background: rgba(74, 222, 128, 0.15); color: #4ade80; }
.d-status-body { flex: 1; min-width: 0; text-align: left; }
.d-status-title { font-size: 0.88rem; font-weight: 600; }
.d-status-sub { font-size: 0.76rem; color: var(--text-dim); margin-top: 2px; }
.d-action-bar { display: inline-flex; align-items: center; gap: 2px; margin-top: 16px; padding: 4px; background: var(--pill-bg); border: 1px solid var(--pill-border); border-radius: 999px; box-shadow: var(--pill-shadow); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
.d-act { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 50%; border: none; background: transparent; color: var(--pill-fg); cursor: pointer; padding: 0; font-family: inherit; transition: background 0.18s ease, color 0.18s ease, transform 0.12s ease, box-shadow 0.18s ease; -webkit-tap-highlight-color: transparent; text-decoration: none; flex-shrink: 0; position: relative; }
.d-act svg { display: block; pointer-events: none; }
.d-act:hover { background: var(--pill-act-hover); color: #fff; }
.d-act:active { transform: scale(0.9); }
.d-act:disabled { opacity: 0.5; cursor: default; pointer-events: none; }
.d-act-watched.active { background: linear-gradient(145deg, #8b5cf6 0%, #a78bfa 55%, #c4b5fd 100%); color: #fff; box-shadow: 0 4px 16px rgba(139, 92, 246, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.25); }
.d-act-watched.active:hover { filter: brightness(1.1); color: #fff; }
.d-act-wl.active { color: #c4b5fd; background: rgba(167, 139, 250, 0.12); }
.d-act-wl.active:hover { background: rgba(167, 139, 250, 0.2); color: var(--accent); }
.d-act-play { color: var(--pill-fg); }
.d-act-play:hover { background: rgba(167, 139, 250, 0.15); color: var(--accent); }
.detail-body { padding: 20px 22px 24px; }
.d-section { margin-top: 8px; margin-bottom: 26px; }
.d-section:last-child { margin-bottom: 0; }
.d-section-title { font-size: 1rem; font-weight: 700; letter-spacing: 0.2px; margin-bottom: 14px; color: var(--text); display: flex; align-items: center; gap: 8px; }
.d-section-title::before { content: ""; width: 3px; height: 16px; border-radius: 2px; background: #7d9dd4; }
.cast-scroll { display: flex; gap: 14px; overflow-x: auto; padding-bottom: 8px; scrollbar-width: none; }
.cast-scroll::-webkit-scrollbar { display: none; }
.cast { flex-shrink: 0; width: 84px; text-align: center; }
.cast-img { width: 84px; height: 84px; border-radius: 50%; object-fit: cover; background: var(--surface-2); }
.cast-ph { display: flex; align-items: center; justify-content: center; color: var(--text-dim); font-size: 1.6rem; font-weight: 600; background: var(--soft-card-grad); }
.cast-name { font-size: 0.75rem; font-weight: 600; margin-top: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cast-role { font-size: 0.68rem; color: var(--text-dim); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.seasons { display: flex; flex-direction: column; gap: 8px; }
.season-item { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; transition: border-color 0.15s; }
.season-item.open { border-color: var(--scrollbar); }
.season-head { width: 100%; background: none; border: none; color: inherit; display: flex; align-items: center; gap: 10px; padding: 14px 16px; cursor: pointer; font-family: inherit; text-align: left; transition: background 0.15s; }
.season-head:hover { background: var(--surface-2); }
.season-title { font-weight: 600; font-size: 0.9rem; flex: 1; }
.season-meta { font-size: 0.76rem; color: var(--text-dim); }
.chev { width: 16px; height: 16px; color: var(--text-dim); transition: transform 0.2s ease; flex-shrink: 0; }
.season-item.open .chev { transform: rotate(180deg); }
.season-body { display: none; border-top: 1px solid var(--border); background: rgba(0,0,0,0.12); }
.season-item.open .season-body { display: block; }
.season-body .episode:first-child { border-top: none; }
.ep-empty { padding: 20px; text-align: center; color: var(--text-dim); font-size: 0.85rem; }
.episode { display: flex; gap: 14px; padding: 14px; border-bottom: 1px solid var(--border); align-items: stretch; transition: background 0.15s; }
.episode:last-child { border-bottom: none; }
.episode.clickable { cursor: pointer; }
.episode.clickable:hover { background: var(--surface-2); }
.episode.clickable:active { background: var(--surface-3); }
.episode.clickable:hover .ep-title { color: #7d9dd4; }
.episode.watched .ep-title { color: var(--text-dim); }
.episode.watched.clickable:hover .ep-title { color: #7d9dd4; }
.ep-still-wrap { position: relative; flex-shrink: 0; width: 140px; border-radius: 10px; overflow: hidden; background: var(--surface-2); aspect-ratio: 16/9; align-self: flex-start; }
.ep-still { width: 100%; height: 100%; object-fit: cover; display: block; }
.ep-still-ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 1.6rem; color: var(--text-dim); background: var(--soft-card-grad, var(--surface-2)); }
.ep-still-badge { position: absolute; top: 6px; left: 6px; font-size: 0.65rem; font-weight: 700; padding: 2px 6px; border-radius: 6px; background: rgba(52, 211, 153, 0.9); color: #052e1c; }
.ep-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.ep-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.ep-title-line { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex: 1; }
.ep-num { font-family: ui-monospace, Menlo, monospace; font-size: 0.95rem; color: var(--text-dim); font-weight: 800; flex-shrink: 0; letter-spacing: 0.3px; }
.ep-title { font-size: 0.95rem; font-weight: 700; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ep-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 0.75rem; color: var(--text-dim); margin-top: 2px; }
.ep-vote { display: inline-flex; align-items: center; gap: 3px; padding: 1px 7px; border-radius: 999px; background: rgba(167, 139, 250, 0.14); color: #c4b5fd; font-weight: 700; font-size: 0.72rem; }
.ep-dot { opacity: 0.45; }
.ep-overview { font-size: 0.8rem; color: var(--text-dim); margin-top: 4px; line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.ep-actions { flex-shrink: 0; display: flex; align-items: center; gap: 8px; }
.ep-play-btn { width: 30px; height: 30px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; background: rgba(167, 139, 250, 0.16); border: 1px solid rgba(167, 139, 250, 0.28); color: #c4b5fd; text-decoration: none; transition: background 0.15s, transform 0.12s; -webkit-tap-highlight-color: transparent; }
.ep-play-btn:hover { background: rgba(167, 139, 250, 0.28); color: #ddd6fe; }
.ep-play-btn:active { transform: scale(0.94); }
.ep-status { font-size: 0.78rem; font-weight: 600; white-space: nowrap; line-height: 1; padding: 0; border: none; background: none; font-family: inherit; }
.ep-status.watched { color: #4ade80; cursor: default; }
.ep-status.unwatched { color: var(--text-dim); }
button.ep-status.unwatched { cursor: pointer; -webkit-tap-highlight-color: transparent; }
button.ep-status.unwatched:hover { color: #6ee7b7; }
@media (max-width: 520px) { .episode { gap: 10px; padding: 12px; } .ep-still-wrap { width: 112px; } .ep-title { font-size: 0.88rem; white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; } .ep-overview { -webkit-line-clamp: 2; font-size: 0.76rem; } }
.ep-watch-btn:disabled { opacity: 0.6; cursor: wait; }
.ep-status.done, .ep-watch-btn.done { color: #4ade80 !important; cursor: default; }
.modal-body .grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 16px; }
@media (min-width: 700px) { .detail-inner { flex-direction: row; align-items: flex-start; text-align: left; padding: 34px; gap: 30px; } .detail-poster { width: 220px; height: auto; aspect-ratio: 2/3; margin: 0; } .detail-info { align-items: flex-start; } .detail-meta { justify-content: flex-start; } .detail-overview { text-align: left; } .detail-title { font-size: 1.85rem; } .detail-overview { font-size: 0.92rem; -webkit-line-clamp: 6; } .detail-body { padding: 30px 34px 34px; } .cast { width: 96px; } .cast-img { width: 96px; height: 96px; } .modal-body .grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 20px; } .detail-ext-ratings { justify-content: flex-start; } .d-action-bar { align-self: flex-start; } }
.confirm-modal { position: fixed; inset: 0; z-index: 620; display: none; }
.confirm-modal.open { display: block; }
.confirm-backdrop { position: absolute; inset: 0; background: var(--overlay); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); animation: fadeIn 0.18s ease; }
.confirm-panel { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(88vw, 340px); background: var(--panel-grad); border: 1px solid var(--border-strong); border-radius: 18px; padding: 24px 22px 18px; box-shadow: 0 30px 80px rgba(0, 0, 0, 0.8); text-align: center; animation: confirmIn 0.22s cubic-bezier(0.2, 0.9, 0.3, 1); }
@keyframes confirmIn { from { opacity: 0; transform: translate(-50%, -48%) scale(0.95); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
.confirm-icon { width: 48px; height: 48px; margin: 0 auto 12px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; background: var(--accent-soft); color: var(--accent-2); }
.confirm-icon.danger { background: rgba(224, 85, 96, 0.14); color: #ff7b85; }
.confirm-icon.warn { background: rgba(255, 184, 77, 0.14); color: #ffb84d; }
.confirm-icon.success { background: rgba(52, 211, 153, 0.14); color: #34d399; }
.confirm-title { font-size: 1.02rem; font-weight: 700; margin-bottom: 6px; color: var(--text); }
.confirm-msg { font-size: 0.84rem; color: var(--text-dim); line-height: 1.55; word-break: break-word; }
.confirm-actions { display: flex; gap: 10px; margin-top: 20px; }
.confirm-btn { flex: 1; padding: 11px 14px; border-radius: 12px; font-size: 0.88rem; font-weight: 700; font-family: inherit; cursor: pointer; border: 1px solid transparent; transition: all 0.15s; -webkit-tap-highlight-color: transparent; }
.confirm-cancel { background: var(--chip-bg); border-color: var(--chip-border); color: var(--chip-fg); }
.confirm-cancel:hover { background: var(--chip-bg-hover); color: var(--chip-fg-hover); }
.confirm-ok { background: var(--brand-grad); color: #fff; box-shadow: 0 6px 20px rgba(167, 139, 250, 0.3); }
.confirm-ok:hover { filter: brightness(1.08); }
.confirm-ok.danger { background: linear-gradient(135deg, #dc2626 0%, #f87171 100%); box-shadow: 0 6px 20px rgba(248, 113, 113, 0.28); }
.confirm-ok:disabled, .confirm-cancel:disabled { opacity: 0.6; cursor: wait; }
.hero-avatar { border: 2px solid rgba(167, 139, 250, 0.5); padding: 0; cursor: pointer; font: inherit; color: inherit; }
.hero-avatar:hover { box-shadow: 0 0 0 3px rgba(167, 139, 250, 0.28), 0 4px 20px rgba(0, 0, 0, 0.5); transform: scale(1.03); }
.hero-avatar:active { transform: scale(0.97); }
.summary-modal { position: fixed; inset: 0; z-index: 160; display: none; }
.summary-modal.open { display: block; }
.summary-backdrop { position: absolute; inset: 0; background: var(--overlay); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.summary-panel { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(94vw, 480px); max-height: 88vh; display: flex; flex-direction: column; background: var(--panel-grad); border: 1px solid var(--border-strong); border-radius: 18px; box-shadow: 0 30px 80px rgba(0, 0, 0, 0.85); overflow: hidden; }
.summary-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px 10px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.summary-title { font-size: 1.05rem; font-weight: 700; }
.summary-close { width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--chip-border); background: var(--chip-bg); color: var(--chip-fg); font-size: 1.2rem; cursor: pointer; font-family: inherit; line-height: 1; }
.summary-close:hover { color: #fff; border-color: var(--border-strong); }
.summary-body { overflow-y: auto; padding: 12px 16px 20px; -webkit-overflow-scrolling: touch; }
@media (max-width: 599px) { .summary-panel { top: auto; bottom: 0; left: 0; right: 0; transform: none; width: 100%; max-height: 92vh; border-radius: 18px 18px 0 0; } }
.sum-wrap { padding: 4px 0 24px; }
.sum-nav { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 18px; }
.sum-nav-btn { width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--chip-border); background: var(--chip-bg); color: var(--text-dim); font-size: 1.2rem; cursor: pointer; font-family: inherit; transition: all 0.15s; }
.sum-nav-btn:hover { color: #fff; border-color: var(--border-strong); background: rgba(167, 139, 250, 0.12); }
.sum-nav-center { flex: 1; text-align: center; min-width: 0; }
.sum-period-tabs { display: inline-flex; gap: 4px; background: var(--chip-bg); border: 1px solid var(--border); border-radius: 999px; padding: 3px; margin-bottom: 8px; }
.sum-period-btn { border: none; background: transparent; color: var(--text-dim); padding: 6px 14px; border-radius: 999px; font-size: 0.8rem; font-weight: 600; cursor: pointer; font-family: inherit; }
.sum-period-btn.active { background: var(--brand-grad); color: #fff; }
.sum-label { font-size: 1.05rem; font-weight: 700; letter-spacing: 0.2px; }
.sum-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
.sum-stat { text-align: center; background: var(--panel-grad); border: 1px solid var(--border); border-radius: 14px; padding: 14px 6px; }
.sum-stat-num { font-size: 1.35rem; font-weight: 800; letter-spacing: -0.5px; background: var(--num-grad); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.sum-stat-label { font-size: 0.7rem; color: var(--text-mute); margin-top: 2px; }
.sum-chip { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 10px; background: rgba(167, 139, 250, 0.1); border: 1px solid rgba(167, 139, 250, 0.25); color: var(--text-dim); font-size: 0.82rem; margin-bottom: 12px; }
.sum-chip strong { color: var(--accent); }
.sum-muted { font-size: 0.8rem; color: var(--text-mute); margin: 6px 0 12px; }
.sum-block { margin-top: 18px; }
.sum-h3 { font-size: 0.92rem; font-weight: 700; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
.sum-h3::before { content: ""; width: 3px; height: 14px; border-radius: 2px; background: linear-gradient(180deg, #a78bfa, #7c3aed); }
.sum-heat { display: flex; flex-wrap: wrap; gap: 4px; }
.sum-heat-cell { width: 12px; height: 12px; border-radius: 3px; background: rgba(255, 255, 255, 0.06); }
.sum-heat-cell.lv1 { background: rgba(167, 139, 250, 0.25); }
.sum-heat-cell.lv2 { background: rgba(167, 139, 250, 0.45); }
.sum-heat-cell.lv3 { background: rgba(167, 139, 250, 0.7); }
.sum-heat-cell.lv4 { background: #a78bfa; }
.sum-list { display: flex; flex-direction: column; gap: 8px; }
.sum-row { display: flex; align-items: center; gap: 12px; padding: 10px 12px; background: var(--panel-grad); border: 1px solid var(--border); border-radius: 12px; }
.sum-rank { width: 22px; height: 22px; border-radius: 6px; background: rgba(167, 139, 250, 0.15); color: #c4b5fd; font-size: 0.72rem; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.sum-row-body { min-width: 0; flex: 1; }
.sum-row-title { font-size: 0.9rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sum-year { font-weight: 500; color: var(--text-mute); font-size: 0.8rem; }
.sum-row-meta { font-size: 0.75rem; color: var(--text-dim); margin-top: 2px; }
@media (max-width: 420px) { .sum-stats { gap: 6px; } .sum-stat { padding: 12px 4px; } .sum-stat-num { font-size: 1.15rem; } }
#toast-container { position: fixed; left: 50%; bottom: calc(28px + env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 99999; display: flex; flex-direction: column; gap: 8px; pointer-events: none; max-width: min(92vw, 440px); width: max-content; }
.toast { pointer-events: auto; display: flex; align-items: center; gap: 10px; padding: 11px 16px; border-radius: 12px; font-size: 0.86rem; font-weight: 500; color: var(--toast-text); background: var(--toast-bg); border: 1px solid rgba(255, 255, 255, 0.1); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); opacity: 0; transform: translateY(12px) scale(0.96); transition: opacity 0.22s ease, transform 0.22s ease; cursor: pointer; line-height: 1.45; word-break: break-word; max-width: min(92vw, 440px); }
.toast.toast-in { opacity: 1; transform: translateY(0) scale(1); }
.toast.toast-out { opacity: 0; transform: translateY(8px) scale(0.96); }
.toast-icon { flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.72rem; font-weight: 800; line-height: 1; }
.toast-info .toast-icon { background: rgba(125, 157, 212, 0.22); color: #a8c0e8; }
.toast-success .toast-icon { background: rgba(52, 211, 153, 0.22); color: #6ee7b7; }
.toast-error .toast-icon { background: rgba(224, 85, 96, 0.24); color: #ff8a8a; }
.toast-warn .toast-icon { background: rgba(255, 184, 77, 0.22); color: #ffd693; }
.toast-success { border-color: rgba(52, 211, 153, 0.35); }
.toast-error { border-color: rgba(224, 85, 96, 0.35); }
.toast-warn { border-color: rgba(255, 184, 77, 0.35); }
@media (max-width: 420px) { .toast { font-size: 0.82rem; padding: 10px 14px; } }
.cast.clickable { cursor: pointer; }
.cast.clickable:hover .cast-img { transform: translateY(-2px) scale(1.03); box-shadow: 0 8px 20px rgba(167, 139, 250, 0.28); }
.cast.clickable:hover .cast-name { color: #c4b5fd; }
.cast-img { transition: transform 0.2s ease, box-shadow 0.2s ease; }
.cast-name { transition: color 0.15s ease; }
.trailer-grid { display: grid; grid-template-columns: 1fr; gap: 14px; }
@media (min-width: 600px) { .trailer-grid { grid-template-columns: repeat(2, 1fr); } }
.trailer-card { position: relative; aspect-ratio: 16/9; border-radius: 12px; overflow: hidden; background: linear-gradient(135deg, #1a1528 0%, #0e0e10 100%); cursor: pointer; border: 1px solid var(--border); transition: border-color 0.15s, transform 0.15s; }
.trailer-card:hover { border-color: rgba(167, 139, 250, 0.4); transform: translateY(-1px); }
.trailer-thumb { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; z-index: 1; }
.trailer-card.no-thumb .trailer-thumb { display: none; }
.trailer-play { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 52px; height: 52px; border-radius: 50%; background: rgba(8, 10, 18, 0.72); border: 1px solid rgba(255, 255, 255, 0.28); color: #fff; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); transition: background 0.15s, transform 0.15s; pointer-events: none; z-index: 3; }
.trailer-card:hover .trailer-play { background: linear-gradient(145deg, #8b5cf6, #a78bfa); transform: translate(-50%, -50%) scale(1.08); }
.trailer-play svg { display: block; margin-left: 2px; }
.trailer-name { position: absolute; left: 0; right: 0; bottom: 0; padding: 22px 12px 9px; font-size: 0.8rem; font-weight: 600; color: #fff; background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.85)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; z-index: 3; }
.trailer-card.playing .trailer-thumb, .trailer-card.playing .trailer-play, .trailer-card.playing .trailer-name { display: none; }
.trailer-frame { position: absolute; inset: 0; width: 100%; height: 100%; background: var(--surface-2); z-index: 2; }
.trailer-frame:empty { display: none; }
.trailer-frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block; }
.person-modal { position: fixed; inset: 0; z-index: 230; display: none; }
.person-modal.open { display: block; }
.person-backdrop { position: absolute; inset: 0; background: var(--overlay); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); animation: fadeIn 0.2s ease; }
.person-panel { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(94vw, 760px); max-height: 88vh; display: flex; flex-direction: column; background: var(--panel-grad); border: 1px solid var(--border-strong); border-radius: 18px; box-shadow: 0 30px 80px rgba(0, 0, 0, 0.85); overflow: hidden; animation: modalIn 0.25s cubic-bezier(0.2, 0.9, 0.3, 1); }
.person-panel-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.person-panel-name { font-size: 1rem; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.person-close { width: 40px; height: 40px; flex-shrink: 0; border-radius: 50%; border: 1px solid var(--chip-border); background: var(--chip-bg); color: var(--chip-fg); font-size: 1.2rem; cursor: pointer; font-family: inherit; line-height: 1; display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
.person-close:hover { color: #fff; border-color: var(--border-strong); }
.person-panel-body { overflow-y: auto; padding: 18px 20px 24px; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
@media (max-width: 599px) { .person-panel { top: auto; bottom: 0; left: 0; right: 0; transform: none; width: 100%; max-height: 92vh; border-radius: 18px 18px 0 0; } }
.person-head { display: flex; gap: 18px; margin-bottom: 18px; }
.person-photo { width: 110px; height: 165px; border-radius: 12px; object-fit: cover; flex-shrink: 0; background: var(--surface-2); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5); }
.person-photo-ph { display: flex; align-items: center; justify-content: center; font-size: 2rem; color: var(--text-dim); background: var(--soft-card-grad); }
.person-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.person-name { font-size: 1.3rem; font-weight: 800; letter-spacing: -0.4px; line-height: 1.25; }
.person-sub { font-size: 0.82rem; color: var(--text-dim); }
.person-rows { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
.person-row { font-size: 0.78rem; color: var(--text-dim); line-height: 1.5; }
.person-row b { color: var(--text); font-weight: 600; margin-right: 6px; }
.person-bio { font-size: 0.86rem; color: #c0c8d6; line-height: 1.65; white-space: pre-line; margin-bottom: 22px; padding-top: 4px; border-top: 1px solid var(--border); }
.person-credits-title { font-size: 0.95rem; font-weight: 700; margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
.person-credits-title::before { content: ""; width: 3px; height: 14px; border-radius: 2px; background: linear-gradient(180deg, #a78bfa, #7c3aed); }
@media (max-width: 480px) { .person-head { flex-direction: column; align-items: center; text-align: center; gap: 12px; } .person-info { align-items: center; } .person-photo { width: 130px; height: 195px; } .person-rows { align-items: center; } }
.btn-action.loading { color: var(--accent-2); border-color: rgba(167, 139, 250, 0.45); background: rgba(167, 139, 250, 0.12); pointer-events: none; }
.btn-action.loading svg { transform-origin: 50% 50%; animation: btnSpin 0.7s linear infinite; }
@keyframes btnSpin { to { transform: rotate(360deg); } }
.btn-action.loading span::after { content: ""; display: inline-block; width: 0; overflow: hidden; animation: btnDots 1.2s steps(4, end) infinite; }
@keyframes btnDots { 0% { content: ""; } 25% { content: "."; } 50% { content: ".."; } 75% { content: "..."; } }
`;
  return __pageStylesCache;
}
