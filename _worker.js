/* ============================================================
 * MineTrakt Worker —— Cloudflare Workers 完整单文件
 * ------------------------------------------------------------
 * 架构概览
 *   · 认证：Trakt OAuth 设备码 → Cookie(trakt_auth) 存 token + trakt_id
 *   · 数据：Trakt / TMDB / OMDB / 豆瓣 / 剧场 → 统一走 cachedJSON
 *   · 缓存：进程内存 Map → Cloudflare KV(TMDB_CACHE) → stale 回退
 *   · 前端：/app.js + /app.css 静态；首页数据 /api/home-data JSON+HTML 片段
 *
 * 缓存与上游策略（重要）
 *   · 非 force：优先读 KV/内存；未逻辑过期不打 Trakt；过期或冷启动才请求
 *   · force=1（点刷新）：绕过缓存打上游；失败绝不写脏数据，回退旧 KV
 *   · 限流 429：标记 per-user 冷却，后续短时间短路，前端可停止后续 part
 *   · strict 鉴权：拿不到稳定身份 → 401 + 清 Cookie + relogin，回登录页
 *
 * 性能要点
 *   · 非 force 任务并行、无人为间隔；force 串行 + 动态间隔防 429
 *   · Cookie 固化 trakt_id，避免每次 authed 打 /users/me
 *   · Watchlist movies/shows 并行拉取
 * ============================================================
 *
 * 段落 1 / 4：常量 + 基础工具 + KV 缓存层 + cachedJSON
 * ============================================================ */

/* -------------------- 常量定义 -------------------- */
// Trakt / TMDB / OMDB / 豆瓣 / 剧场 等外部服务端点
const TRAKT_AUTH = "https://auth.trakt.tv",
  TRAKT_API = "https://api.trakt.tv",
  TMDB_API = "https://api.themoviedb.org/3",
  TMDB_IMG = "https://image.tmdb.org/t/p",
  ACTIVATE_URL = "https://trakt.tv/activate",
  OMDB_API = "https://www.omdbapi.com",
  DOUBAN_SEARCH = "https://search.douban.com/movie/subject_search",
  DOUBAN_API = "https://widget.v2too.top/data/douban.json",
  THEATER_API = "https://widget.v2too.top/data/theater.json";

// PWA 应用元信息
const APP_NAME = "MineTrakt",
  APP_SHORT_NAME = "MineTrakt",
  THEME_COLOR = "#050505";

// 静态资源路径
const FAVICON_URL = "/assets/favicon.ico",
  ICON_192 = "/assets/icon-192.png",
  ICON_512 = "/assets/icon-512.png",
  APPLE_ICON = "/assets/icon-512.png",
  SPLASH_LOGO = "/assets/logo.png";

// 静态资源远程回源地址（首次请求时缓存到边缘）
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

// 请求头 & Cookie 名称
const TRAKT_UA = "MineTrakt/1.0";
const JSON_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": TRAKT_UA,
};

const COOKIE_NAME = "trakt_auth",          // 认证 Cookie 名
  COOKIE_MAX_AGE = 60 * 60 * 24 * 90,      // 90 天
  PROFILE_COOKIE = "trakt_profile";        // 昵称/头像提示 Cookie（非敏感）

// 分页与缓存 TTL（秒）
const PAGE_SIZE = 20,                       // 历史记录每页条数
  TMDB_KV_TTL = 86400 * 7,                  // TMDB 详情：7 天
  OMDB_KV_TTL = 86400 * 7,                  // OMDB 评分：7 天
  WATCHLIST_PAGE_SIZE = 30,                 // watchlist 每页 30 条
  WATCHLIST_KV_TTL = 1800,                  // watchlist：30 分钟
  CALENDAR_KV_TTL = 1800,                   // 日历：30 分钟
  TREND_KV_TTL = 21600,                     // 趋势：6 小时
  MISS_KV_TTL = 300,                        // 空结果：5 分钟（防击穿）
  HISTORY_KV_TTL = 3600,                    // 历史记录：1 小时
  PLAYBACK_KV_TTL = 3600,                   // 继续观看：1 小时
  STATS_KV_TTL = 3600,                      // 统计：1 小时
  PROFILE_KV_TTL = 7200,                    // 用户资料：2 小时
  ENTITY_KV_TTL = 86400,                    // Trakt 实体：1 天
  SEASON_KV_TTL = 86400,                    // 季数据：1 天
  DOUBAN_KV_TTL = 21600,                    // 豆瓣列表：6 小时
  THEATER_KV_TTL = 21600;                   // 平台剧场：6 小时

// 首页自动刷新间隔（分钟）——只读 KV，30 分钟一次即可
const HOME_AUTO_REFRESH_MINUTES = 30;
// 前端静态资源版本（改动后 bump 触发缓存失效）
const APP_JS_VERSION = "82",
  APP_CSS_VERSION = "82";

/* 缓存 key 构造器
 * 统一管理所有 KV / 内存缓存的 key 命名，便于排查和批量失效 */
const CK = {
  playback: (u) => `pb:${u}`,                       // 继续观看
  stats: (u) => `stats:${u}`,                       // 统计
  profile: (u) => `prof:${u}:me`,                   // 用户资料
  history: (u, p = 1) => `hist:${u}:p${p}`,         // 历史记录（按页）
  calendar: (u, day) => `cal:${u}:${day}`,          // 追剧日历
  watchProgress: (u, id) => `tpr:${u}:${id}`,       // 剧集观看进度
  movieHistory: (u, id) => `tmh:${u}:${id}`,        // 电影观看历史
  entity: (t, id) => `te:${t}:${id}`,               // Trakt 实体详情
  season: (id, n) => `ts:${id}:${n}`,               // 季数据
  traktSearch: (t, id) => `tsp:${t}:${id}`,         // TMDB→Trakt ID 映射
  watchlist: (u, v, s) => `wl:${u}:${v}:${s}`,      // watchlist（含版本号）
  watchlistVersion: (u) => `wlv:${u}`,              // watchlist 版本号
  omdb: (id) => `omdb:${id}`,                       // OMDB 评分
  enrich: (k) => `e:${k}`,                          // 富化数据
  trend: (p) => `trend:day:${p}`,                   // TMDB 趋势
  tmdb: (p) => `td:${p}`,                           // TMDB 详情
  douban: "douban:v1:all",                          // 豆瓣（全局）
  theater: "theater:v1:all",                        // 剧场（全局）
  uidRt: (rt) => `uid:rt:${rt}`,                    // refresh_token → uid
  uidAt: (at) => `uid:at:${at}`,                    // access_token → uid
};

/* -------------------- 基础工具 -------------------- */

/**
 * 带超时的 fetch。
 * 使用 AbortController 在 ms 毫秒后中止请求，避免上游挂死。
 */
async function fetchT(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backoff = (i, base = 500, jitter = 500) =>
  sleep(base * (i + 1) + Math.random() * jitter);

/* -------------------- Trakt 限流管理 -------------------- */
// 单次 429 冷却时长（毫秒）
const TRAKT_RATE_LIMIT_COOLDOWN = 20000;
// userKey → 冷却截止时间戳
const __traktRateLimitByUser = new Map();

/** 判断指定用户是否处于限流冷却期 */
function isTraktRateLimited(userKey) {
  const k = userKey || "__anon__";
  const until = __traktRateLimitByUser.get(k) || 0;
  return Date.now() < until;
}

/** 返回限流剩余秒数（0 表示未限流） */
function traktRateLimitedRemaining(userKey) {
  const k = userKey || "__anon__";
  const until = __traktRateLimitByUser.get(k) || 0;
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

/** 标记用户进入限流冷却（ms 毫秒） */
function markTraktRateLimited(ms, userKey) {
  const k = userKey || "__anon__";
  const until = Date.now() + (ms || TRAKT_RATE_LIMIT_COOLDOWN);
  const cur = __traktRateLimitByUser.get(k) || 0;
  if (until > cur) __traktRateLimitByUser.set(k, until);
  // 简单 LRU：清理过期项
  if (__traktRateLimitByUser.size > 500) {
    const now = Date.now();
    for (const [key, v] of __traktRateLimitByUser) {
      if (v < now) __traktRateLimitByUser.delete(key);
    }
  }
}

/** 从 429 响应的 Retry-After 头解析冷却时长并标记 */
function consumeRetryAfter(r, userKey) {
  const ra = parseInt(r.headers.get("Retry-After") || "", 10);
  const waitMs =
    Number.isFinite(ra) && ra > 0
      ? Math.min(ra * 1000, 180000)
      : TRAKT_RATE_LIMIT_COOLDOWN;
  markTraktRateLimited(waitMs, userKey);
  return waitMs;
}

/**
 * Trakt 统一请求封装。
 * - 尊重 per-user 429 冷却（isTraktRateLimited），冷却期内不发网络请求
 * - 429 时解析 Retry-After 并 markTraktRateLimited
 * - wantPageCount：把 X-Pagination-Page-Count 挂到数组的 __pageCount（不可枚举）
 * - 返回值若失败为 { __error, __cooling? }，成功为 JSON 本体
 */
async function traktFetch(
  url,
  headers,
  {
    retries = 2,          // 重试次数
    timeout = 12000,      // 单次超时
    userKey,              // 用于限流隔离
    wantPageCount = false, // 是否附加 __pageCount
    backoffBase = 500,    // 退避基数
  } = {},
) {
  const errShape = wantPageCount ? { __pageCount: 1 } : {};

  // 冷却期内直接短路，不发请求
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

      // 429：标记冷却并返回
      if (r.status === 429) {
        consumeRetryAfter(r, userKey);
        return {
          __error: "HTTP 429",
          __cooling: traktRateLimitedRemaining(userKey),
          ...errShape,
        };
      }

      // 404：资源不存在，返回空
      if (r.status === 404) {
        return wantPageCount
          ? Object.defineProperty([], "__pageCount", {
              value: 1,
              enumerable: false,
            })
          : null;
      }

      // 403：权限问题，不重试
      if (r.status === 403) {
        return { __error: "HTTP 403", ...errShape };
      }

      // 其它非 2xx：重试
      if (!r.ok) {
        lastErr = `HTTP ${r.status}`;
        if (i === retries) return { __error: lastErr, ...errShape };
        await backoff(i, backoffBase, 500);
        continue;
      }

      // 成功：解析 JSON
      const data = await r.json();
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

/* -------------------- KV 内存 + edge 缓存层 -------------------- */
// 内存缓存默认 TTL（30 分钟）；KV edge 缓存 30 分钟
const KV_MEM_TTL = 1800000,
  KV_EDGE_TTL = 1800,
  KV_MISS = Symbol("kv-miss"),      // 表示 KV 明确返回空
  KV_ERR = Symbol("kv-err"),        // 表示 KV 读取异常
  KV_MIN_PUT_TTL = 30,              // 小于该 TTL（秒）不写 KV
  KV_DOWN_COOLDOWN_MS = 30000;      // KV 异常后冷却 30s 不再尝试

// 同一 key 的最小写入间隔（1 小时），避免频繁写 KV 浪费额度
const KV_MIN_PUT_INTERVAL_MS = 3600000;
const __KV_LASTPUT_MAX = 5000;

const __kvLastPut = new Map();                     // key → 上次写入时间
const __kvMem = new Map(),                         // 内存缓存 value
  __kvMemExp = new Map(),                          // 内存缓存过期时间
  __kvInflight = new Map();                        // single-flight 中的 Promise
const __kvMemStale = new Map();                    // 内存中的 stale 副本（兜底）
const STALE_MAX_AGE = 3600000;                     // stale 最长保留 1 小时

/** 存入 stale 副本（内存），用于 fetcher 失败时兜底 */
function kvMemStaleSet(key, data) {
  __kvMemStale.set(key, { data, ts: Date.now() });
  if (__kvMemStale.size > 3000) {
    const it = __kvMemStale.keys();
    for (let i = 0; i < 800; i++) {
      const k = it.next().value;
      if (k) __kvMemStale.delete(k);
    }
  }
}

/** 读取 stale 副本（过期自动清理） */
function kvMemStaleGet(key) {
  const e = __kvMemStale.get(key);
  if (!e) return undefined;
  if (Date.now() - e.ts > STALE_MAX_AGE) {
    __kvMemStale.delete(key);
    return undefined;
  }
  return e.data;
}

// KV 健康状态：异常时进入 30 秒冷却，避免频繁失败
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

/** 读内存缓存（过期自动清理） */
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

/** 写内存缓存，超出 4000 条时简单 LRU 清理 */
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

/** single-flight：同一 key 的并发请求复用同一个 Promise */
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

/** 读缓存：内存优先，未命中再读 KV；KV 异常时返回 KV_ERR 并短暂标记 down。 */
async function kvGetJSON(env, key, memOnly, edgeTtl) {
  const mem = kvMemGet(key);
  if (mem !== undefined) return mem;
  if (memOnly) return undefined;
  if (!env.TMDB_CACHE || kvIsDown()) return KV_ERR;
  try {
    const v = await env.TMDB_CACHE.get(key, {
      type: "json",
      cacheTtl: edgeTtl || KV_EDGE_TTL,
    });
    kvMarkUp();
    const result = v === null || v === undefined ? KV_MISS : v;
    // 用 payload._ttl 计算内存缓存时长
    const memMs =
      result && result !== KV_MISS && result._ttl
        ? Math.min(KV_MEM_TTL, Math.max(5000, result._ttl * 1000))
        : KV_MEM_TTL;
    kvMemSet(key, result, memMs);
    return result;
  } catch {
    kvMarkDown();
    return KV_ERR;
  }
}

/**
 * 写入缓存：先写内存，再异步写 KV（受 KV_MIN_PUT_INTERVAL_MS 节流，force 可跳过间隔）。
 * payload 会带 _ts / _ttl；KV 实际 expiration 会额外保留一段 stale 便于回退。
 */
function kvPutJSON(env, ctx, key, payload, ttl, memOnly, force) {
  const memMs =
    payload && payload.miss
      ? 30000
      : ttl
        ? Math.min(KV_MEM_TTL, Math.max(5000, ttl * 1000))
        : KV_MEM_TTL;
  if (payload && typeof payload === "object" && payload !== KV_MISS)
    payload._ts = Date.now();
  kvMemSet(key, payload, memMs);
  if (memOnly) return;
  if (!env.TMDB_CACHE || kvIsDown()) return;
  if (ttl != null && ttl < KV_MIN_PUT_TTL) return; // 太短不写 KV
  const now = Date.now();
  const lastPut = __kvLastPut.get(key) || 0;
  if (!force && lastPut && now - lastPut < KV_MIN_PUT_INTERVAL_MS) return;
  __kvLastPut.set(key, now);
  if (__kvLastPut.size > __KV_LASTPUT_MAX) {
    const it = __kvLastPut.keys();
    for (let i = 0; i < 1000; i++) {
      const k = it.next().value;
      if (k) __kvLastPut.delete(k);
    }
  }
  const logicalTtl = ttl || 60;
  // KV 实际 TTL = 逻辑 TTL + stale 保留期，保证过期后还能读一次兜底
  const staleRetention = Math.min(86400 * 7, Math.max(logicalTtl * 6, 1800));
  const body =
    payload && typeof payload === "object"
      ? { ...payload, _ttl: logicalTtl }
      : payload;
  const p = env.TMDB_CACHE.put(key, JSON.stringify(body), {
    expirationTtl: Math.max(60, logicalTtl + staleRetention),
  })
    .then(() => kvMarkUp())
    .catch(() => {
      kvMarkDown();
    });
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
}

/** 判断 payload 是否是错误/空数据（禁止写入 KV） */
function __isErrorPayload(d) {
  if (d === null || d === undefined || d === false) return true;
  if (typeof d === "object" && d) {
    if (d.__error) return true;
    // 仅有冷却标记、无业务数据的限流响应也视为错误
    if (d.__cooling != null && d.data === undefined && !Array.isArray(d))
      return true;
  }
  return false;
}

/* ============================================================
 * cachedJSON —— 统一缓存读取 / 写入 / 强制刷新 / SWR
 * ------------------------------------------------------------
 * ttl/jitter     逻辑过期（秒）+ 防雪崩抖动
 * swr            软过期先返回旧值并后台刷新
 * bypass         强制 fetcher（点刷新）；失败不写 KV，回退旧缓存
 * revalidate     false=有缓存就返回；true=过期才打上游
 * sourceTracker  { fromCache, age } 供前端展示来源
 * 带 __error/__cooling 的结果永不写入 KV
 * ============================================================ */
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
    sourceTracker = null,
    // revalidate=false：有缓存就直接返回（忽略逻辑 TTL / 不后台刷新），仅冷启动 miss 时才打上游
    revalidate = true,
  } = {},
) {
  // TTL 加随机抖动，避免缓存集体过期
  const jitterSec = jitter != null ? jitter : Math.floor(Math.random() * 90);
  const effectiveTtl = ttl + jitterSec;

  // 软过期阈值（swr）
  const softAge =
    swr === true ? Math.floor(ttl * 0.5) : typeof swr === "number" ? swr : 0;

  /** 拆包：从 { data, _ts, _ttl } 里取 data */
  function unwrapVal(cached) {
    if (cached === KV_MISS || cached == null) return null;
    if (cached.miss) return null;
    return cached.data !== undefined ? cached.data : cached;
  }

  /** 计算缓存年龄（秒） */
  function ageSec(cached) {
    if (!cached || cached === KV_MISS || !cached._ts) return Infinity;
    return (Date.now() - cached._ts) / 1000;
  }

  /** 记录数据来源（供前端展示 cache/live 标签） */
  function markSource(fromCache, cached) {
    if (sourceTracker && typeof sourceTracker === "object") {
      if (fromCache === null) {
        sourceTracker.fromCache = null;
        sourceTracker.age = 0;
        return;
      }
      sourceTracker.fromCache = !!fromCache;
      sourceTracker.age =
        fromCache && cached && cached._ts
          ? Math.max(0, Math.round((Date.now() - cached._ts) / 1000))
          : 0;
    }
  }

  // 内存 stale 回退（第一道）
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
    if (st !== undefined && st !== null && !__isErrorPayload(st)) {
      markSource(true, null);
      return { found: true, val: st, raw: null };
    }
    return { found: false };
  }

  /* ---------- bypass 分支：强制刷新 ----------
   * 规则：仅在拿到「正确、非错误」数据时才写 KV；
   * API 限流 / 网络失败 / 错误载荷 → 绝不污染 KV，优先回退展示旧缓存。
   * ------------------------------------------------ */
  if (bypass) {
    return singleFlight("force:" + key, async () => {
      let data = null;
      try {
        data = await fetcher();
      } catch {
        data = null;
      }
      // 统一把带 __error / 限流的结果视为失败，禁止入库
      if (data && (data.__error || data.__cooling != null)) data = null;

      // 成功：只有干净数据才允许写 KV（force=true 覆盖旧值）
      if (!__isErrorPayload(data)) {
        kvPutJSON(env, ctx, key, { data }, effectiveTtl, memOnly, true);
        kvMemStaleSet(key, data);
        markSource(false, null);
        return unwrap ? data : { data };
      }

      // —— 以下全部是刷新失败路径：只读、不写 ——

      // 失败①：内存 stale / 当前 mem
      const old = tryOldNormal();
      if (old.found) {
        // 把 stale 回填进正常 mem，方便后续非 force 请求继续命中
        if (old.raw && old.raw !== KV_MISS) {
          kvMemSet(key, old.raw, KV_MEM_TTL);
        } else if (old.val != null) {
          kvMemSet(key, { data: old.val, _ts: Date.now() }, KV_MEM_TTL);
          kvMemStaleSet(key, old.val);
        }
        return unwrap ? old.val : { data: old.val };
      }

      // 失败②：KV 兜底（只读不写，即使 memOnly 也允许读）
      if (env.TMDB_CACHE && !kvIsDown()) {
        try {
          const stale = await env.TMDB_CACHE.get(key, { type: "json" });
          if (stale && !stale.miss) {
            const v = stale.data !== undefined ? stale.data : stale;
            if (!__isErrorPayload(v)) {
              // 回填 mem，仍不写 KV（避免用 force 失败路径去改 expiration）
              const memPayload =
                stale && typeof stale === "object" && stale.data !== undefined
                  ? stale
                  : { data: v, _ts: (stale && stale._ts) || Date.now() };
              kvMemSet(key, memPayload, KV_MEM_TTL);
              kvMemStaleSet(key, v);
              markSource(true, stale);
              return unwrap ? v : { data: v };
            }
          }
        } catch {}
      }

      // 失败③：彻底无缓存可展示
      markSource(null, null);
      return null;
    });
  }

  /** 判断是否需要刷新（超过逻辑 TTL 或 swr 软过期阈值） */
  function needRefresh(cached) {
    if (!cached || cached === KV_MISS || cached.miss || !cached._ts)
      return false;
    const age = ageSec(cached);
    if (age > effectiveTtl) return true;
    if (softAge > 0 && age > softAge) return true;
    return false;
  }

  /** 后台异步刷新（SWR），失败不写 KV */
  function scheduleRefresh() {
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
        // 限流 / 错误结果绝不能写进 KV
        if (data && (data.__error || data.__cooling != null)) data = null;
        const down = kvIsDown();
        if (!__isErrorPayload(data)) {
          kvPutJSON(env, ctx, key, { data }, effectiveTtl, memOnly || down);
          kvMemStaleSet(key, data);
        }
      }),
    );
  }

  // 内存命中
  const mem = kvMemGet(key);
  if (mem !== undefined) {
    if (mem === KV_MISS) {
      markSource(null, null);
      return null;
    }
    // revalidate=false：哪怕逻辑过期也直接返回，不后台打 API
    if (revalidate && needRefresh(mem)) scheduleRefresh();
    markSource(true, mem);
    if (unwrap) return unwrapVal(mem);
    return mem;
  }

  // KV 命中 / 拉取
  return singleFlight(key, async () => {
    const cached = await kvGetJSON(env, key, memOnly, edgeTtl);
    if (cached !== undefined && cached !== KV_MISS && cached !== KV_ERR) {
      // 有 KV：默认直接返回。仅 revalidate=true 且逻辑过期时才后台/同步刷新
      if (revalidate && needRefresh(cached)) {
        // 软过期：SWR 后台刷新；硬过期且无 swr：下面会走 fetcher
        if (softAge > 0 && ageSec(cached) <= effectiveTtl) {
          scheduleRefresh();
          markSource(true, cached);
          if (unwrap) return unwrapVal(cached);
          return cached;
        }
        // 硬过期且 revalidate：继续往下打上游
      } else {
        // revalidate=false 或未过期：纯读缓存
        markSource(true, cached);
        if (unwrap) return unwrapVal(cached);
        return cached;
      }
      // revalidate + 硬过期：先记下 stale，失败可回退
      if (!__isErrorPayload(unwrapVal(cached))) {
        kvMemStaleSet(key, unwrapVal(cached));
      }
    }
    const kvBroken = cached === KV_ERR || cached === undefined;
    // revalidate=false 且没有任何缓存：仍允许冷启动拉一次（否则首屏永远空）
    // 若明确要求绝不打上游，调用方应传 bypass 以外的只读包装
    let data = null;
    try {
      data = await fetcher();
    } catch {
      data = null;
    }
    // 限流 / 错误结果绝不能写进 KV
    if (data && (data.__error || data.__cooling != null)) data = null;
    if (!__isErrorPayload(data)) {
      kvPutJSON(env, ctx, key, { data }, effectiveTtl, memOnly || kvBroken);
      kvMemStaleSet(key, data);
      markSource(false, null);
      return unwrap ? data : { data };
    }
    const old = tryOldNormal();
    if (old.found) return unwrap ? old.val : { data: old.val };
    markSource(null, null);
    return null;
  });
}
/* ============================================================
 * 段落 2 / 4：认证 / 路由 / 静态资源 / 设备码登录 / 登出
 * ------------------------------------------------------------
 * Cookie trakt_auth = b64url({
 *   access_token,
 *   refresh_token,
 *   expires_at,
 *   code_verifier,
 *   trakt_id
 * })
 * ------------------------------------------------------------
 * 鉴权设计要点：
 *   · trakt_id 一旦成功获取就固化到 Cookie，避免每次打 /users/me
 *   · strict 模式：拿不到稳定身份 → 401 + 清 Cookie + relogin
 *   · 公共数据接口不开 strict，限流时仍可用
 * ============================================================ */

/* -------------------- Service Worker 内容 -------------------- */
// 前端 SW：静态资源 stale-while-revalidate；/api/ 与导航请求不走缓存
const SW_JS_CONTENT = String.raw`/* MineTrakt SW v37 */ const VERSION = 'v37'; const RUNTIME_CACHE = 'trakt-static-' + VERSION; self.addEventListener('install', function(){ self.skipWaiting(); }); self.addEventListener('activate', function(e){ e.waitUntil((async function(){ var keys = await caches.keys(); await Promise.all(keys.filter(function(k){ return k !== RUNTIME_CACHE; }).map(function(k){ return caches.delete(k); })); await self.clients.claim(); })()); }); self.addEventListener('fetch', function(event){ var req = event.request; if (req.method !== 'GET') return; var url; try { url = new URL(req.url); } catch(e){ return; } if (url.origin !== self.location.origin) return; if (url.pathname === '/sw.js') return; if (req.mode === 'navigate') return; if (url.pathname.indexOf('/api/') === 0) return; if (url.pathname.indexOf('/auth/') === 0) return; if (url.pathname === '/app.css' || url.pathname === '/app.js' || url.pathname === '/manifest.webmanifest' || url.pathname === '/favicon.ico' || url.pathname.indexOf('/assets/') === 0 || /\.(?:png|jpg|jpeg|svg|webp|ico|woff2?|css|js)$/i.test(url.pathname)) { event.respondWith(staleWhileRevalidate(req)); } }); async function staleWhileRevalidate(req){ var cache = await caches.open(RUNTIME_CACHE); var cached = await cache.match(req); var network = fetch(req).then(function(r){ if (r && r.ok && r.type !== 'opaque') { cache.put(req, r.clone()).catch(function(){}); } return r; }).catch(function(){ return cached; }); return cached || network; }`;

/* -------------------- 主入口路由 -------------------- */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url),
      path = url.pathname;

    // 静态资源
    if (path.startsWith("/assets/")) return handleAsset(path, ctx);
    if (path === "/app.css") return handleAppCss();
    if (path === "/app.js") return handleAppJs(request);
    if (path === "/favicon.ico") return Response.redirect(FAVICON_URL, 302);
    if (path === "/manifest.webmanifest") return handleManifest();
    if (path === "/sw.js") return handleServiceWorker();

    // 认证入口
    if (path === "/auth/device") return handleDevice(env);
    if (path === "/auth/poll" && request.method === "POST")
      return handlePoll(request, env, ctx);
    if (path === "/auth/logout" && request.method === "POST")
      return handleLogout(request, env, ctx);

    // 数据 API
    if (path === "/api/more") return handleMore(request, env, ctx);
    if (path === "/api/season") return handleSeason(request, env, ctx);
    if (path === "/api/detail") return handleApiDetail(request, env, ctx);
    if (path === "/api/detail-extras")
      return handleDetailExtras(request, env, ctx);
    if (path === "/api/person") return handlePerson(request, env, ctx);
    if (path === "/api/enrich" && request.method === "POST")
      return handleEnrich(request, env, ctx);
    if (path === "/api/search") return handleSearch(request, env, ctx);
    if (path === "/api/trending") return handleTrending(request, env, ctx);
    if (path === "/api/douban-list") return handleDoubanList(request, env, ctx);
    if (path === "/api/theater-list")
      return handleTheaterList(request, env, ctx);
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
    if (path === "/api/show-calendar")
      return handleShowCalendar(request, env, ctx);
    if (path === "/api/home-data") return handleHomeData(request, env, ctx);
    if (path === "/api/summary") return handleSummary(request, env, ctx);

    // 默认：首页 / 登录页
    return handleHome(request, env, ctx);
  },
};

/* -------------------- 静态资源 / 清单 / SW -------------------- */

/**
 * 静态资源处理：回源到 ASSET_ORIGINS 指定的 URL，
 * 使用 caches.default 缓存一年。
 */
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

/** 输出内联 CSS（带版本号 ETag） */
function handleAppCss() {
  return new Response(pageStyles(), {
    headers: {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: `"css-v${APP_CSS_VERSION}"`,
    },
  });
}

/** 输出内联 JS（带版本号 ETag，支持 304） */
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

/** PWA manifest */
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

/** Service Worker 脚本，禁止缓存 */
function handleServiceWorker() {
  return new Response(SW_JS_CONTENT, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}

/* -------------------- 鉴权 -------------------- */

/**
 * 基础认证检查。
 * 流程：
 *   1. 从 Cookie 读 trakt_auth
 *   2. 必要时刷新 token
 *   3. 返回 { ok, auth, headers, needsCookieUpdate }
 *
 * 注意：不再在这里尝试补 trakt_id，交给 getStableUserId(strict) 处理，
 * 减少一次不必要的 /users/me 请求。
 */
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

/**
 * 要求登录的 API 入口助手。
 *
 * @param {Request} request
 * @param {object} env
 * @param {object} ctx
 * @param {object} opts
 * @param {boolean} opts.html   错误响应用 HTML（用于页面型 API）
 * @param {boolean} opts.strict 严格模式：
 *   · 拿不到稳定身份（限流/401/403/无 slug+无 trakt）时
 *   · 返回 401 + 清 Cookie + relogin，让前端回登录页
 *
 * @returns {{ ok:true, auth, headers, needsCookieUpdate, userKey }
 *         | { ok:false, response }}
 */
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

  // strict 模式：拿不到稳定身份 → 视为登录失败
  if (strict && !userKey) {
    const limited = isTraktRateLimited(
      a.auth.refresh_token
        ? String(a.auth.refresh_token)
        : String(a.auth.access_token),
    );
    const msg = limited
      ? "Trakt 请求过于频繁，请稍后再试"
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

/**
 * 将技术性错误码转成面向用户的中文提示。
 * 支持 extra.cooling 提示剩余冷却秒数。
 */
function humanizeApiError(codeOrMsg, extra) {
  const s = String(codeOrMsg || "").trim();
  const cooling =
    extra && extra.cooling != null ? Number(extra.cooling) : null;
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
  if (/^429|rate\s*limit|限流/i.test(s)) {
    if (cooling != null && cooling > 0)
      return `Trakt 请求过于频繁，请约 ${cooling} 秒后再试`;
    return "Trakt 请求过于频繁，请稍后再试";
  }
  if (/^HTTP\s*401/i.test(s)) return "登录已过期，请重新登录";
  if (/^HTTP\s*403/i.test(s)) return "没有权限执行此操作";
  if (/^HTTP\s*404/i.test(s)) return "未找到对应内容";
  if (/^HTTP\s*429/i.test(s)) {
    if (cooling != null && cooling > 0)
      return `Trakt 请求过于频繁，请约 ${cooling} 秒后再试`;
    return "Trakt 请求过于频繁，请稍后再试";
  }
  if (/^HTTP\s*5\d{2}/i.test(s)) return "服务暂时不可用，请稍后重试";
  if (/network|fetch|abort|timeout|网络/i.test(s))
    return "网络连接失败，请检查网络后重试";
  if (/[\u4e00-\u9fff]/.test(s) && s.length > 4) return s;
  return s || "操作失败，请稍后重试";
}

/** 未登录时的 JSON 响应（清 Cookie） */
function unauthorizedJson() {
  return Response.json(
    { error: humanizeApiError("unauthorized") },
    {
      status: 401,
      headers: { "Set-Cookie": clearCookieHeader() },
    },
  );
}

/** 未登录时的 HTML 响应（清 Cookie） */
function unauthorizedHtml() {
  return new Response(humanizeApiError("unauthorized"), {
    status: 401,
    headers: { "Set-Cookie": clearCookieHeader() },
  });
}

/**
 * 统一 JSON 响应构造器。
 * - 会自动 humanize data.error
 * - 如果 needsCookieUpdate，会下发最新 Cookie
 */
function authJson(auth, needsCookieUpdate, data, status = 200) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (needsCookieUpdate && auth)
    headers["Set-Cookie"] = buildCookie(auth, auth.trakt_id);
  if (data && typeof data === "object" && data.error != null) {
    data = {
      ...data,
      error: humanizeApiError(data.error, { cooling: data.cooling }),
    };
  }
  return new Response(JSON.stringify(data), { status, headers });
}

/**
 * 统一 HTML/文本响应构造器。
 * 支持自定义 status / contentType / extra headers。
 */
function authResp(
  auth,
  needsCookieUpdate,
  body,
  { status = 200, contentType = "text/html; charset=utf-8", extra = {} } = {},
) {
  const h = { "Content-Type": contentType, ...extra };
  if (needsCookieUpdate && auth)
    h["Set-Cookie"] = buildCookie(auth, auth.trakt_id);
  return new Response(body, { status, headers: h });
}

/** 安全解析请求体 JSON */
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

/**
 * Trakt 同步操作通用封装（watchlist / history 增删）。
 * 统一处理：鉴权、参数校验、请求发送、错误响应、afterOk 回调。
 */
async function traktSyncAction(
  request,
  env,
  ctx,
  {
    allowedTypes,       // 允许的 type 数组，如 ["movie","show"]
    idField = "id",     // 从 body 取哪个字段作为 id
    buildPayload,       // (type, traktId, body) => Trakt 请求体
    endpoint,           // Trakt API 路径，如 "/sync/watchlist/remove"
    timeout = 10000,
    afterOk,            // 成功后的回调 (auth, headers, env, ctx)
  },
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
    );
  } catch (e) {
    return authJson(auth, needsCookieUpdate, { error: String(e) }, 502);
  }
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    return authJson(
      auth,
      needsCookieUpdate,
      { error: "HTTP " + r.status, detail: text },
      r.status,
    );
  }
  if (typeof afterOk === "function") await afterOk(auth, headers, env, ctx);
  const result = await r.json().catch(() => null);
  return authJson(auth, needsCookieUpdate, { ok: true, result });
}

/* -------------------- 设备码 / 轮询 / 登出 -------------------- */

/**
 * 设备码授权：第一步
 * 请求 Trakt /oauth/device/code，返回 user_code、state（含 device_code+PKCE）。
 *
 * 错误处理：
 *   · 429 → { error, rateLimited: true, retryAfter } + 429 状态码
 *   · 403 → CLIENT_ID 配错提示
 *   · 5xx → 通用中文提示
 */
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
    return Response.json(
      { error: "网络请求失败，请稍后重试" },
      { status: 502 },
    );
  }

  if (!res.ok) {
    const errText = await res.text();

    // 429：Trakt 限流，让前端等一下再试
    if (res.status === 429) {
      const ra = parseInt(res.headers.get("Retry-After") || "", 10);
      const waitSec =
        Number.isFinite(ra) && ra > 0 ? Math.min(ra, 180) : 30;
      return Response.json(
        {
          error: `请求过于频繁，请 ${waitSec} 秒后再试`,
          rateLimited: true,
          retryAfter: waitSec,
        },
        { status: 429, headers: { "Retry-After": String(waitSec) } },
      );
    }

    // 403：CLIENT_ID 配错
    if (res.status === 403) {
      return Response.json(
        {
          error: "Trakt 拒绝了请求",
          hint: "TRAKT_CLIENT_ID 可能不正确",
        },
        { status: 502 },
      );
    }

    // 其它：上游异常
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

/**
 * 设备码授权：第二步（轮询）
 *
 * 关键改动（本轮）：
 *   · 登录成功后必须拿到 traktId（数字 trakt_id 或 slug）
 *   · 拿不到则拒绝下发 Cookie，返回 relogin 让前端重试
 *   · 所有错误分支都返回中文 message，前端直接显示
 *
 * Trakt 可能的响应：
 *   202 authorization_pending / slow_down  → 继续等待
 *   403 access_denied                       → 用户拒绝
 *   410 expired_token / already_used        → 授权码失效
 *   429                                     → 限流
 *   5xx                                     → 上游异常
 */
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

    /* ---------- 尝试获取稳定身份 ---------- */
    // 登录后必须拿到 trakt_id 或 slug，否则视为登录失败
    let traktId = null;
    let meStatus = 0;
    try {
      const headers = makeTraktHeaders(env, auth);
      // 登录后只取 ids，不需要 extended=full
      const meRes = await fetchT(`${TRAKT_API}/users/me`, { headers }, 8000);
      meStatus = meRes.status;
      if (meRes.ok) {
        const me = await meRes.json();
        const ids = me && me.ids ? me.ids : {};
        if (ids.trakt != null && ids.trakt !== "") traktId = String(ids.trakt);
        else if (ids.slug) traktId = "s:" + String(ids.slug);
      }
    } catch {}

    // 拿不到 → 不下发 Cookie，返回失败让前端重试
    if (!traktId) {
      const limited = meStatus === 429;
      return Response.json(
        {
          ok: false,
          relogin: true,
          error: limited
            ? "Trakt 请求过于频繁，请稍后再试"
            : "无法获取账号信息，请重新登录",
        },
        { status: limited ? 429 : 502 },
      );
    }

    /* ---------- 成功：固化 trakt_id 到 Cookie + KV ---------- */
    if (traktId) {
      auth.trakt_id = traktId;
      const rt = auth.refresh_token ? String(auth.refresh_token) : "";
      const at = auth.access_token ? String(auth.access_token) : "";
      const puts = [];
      // 把 token → uid 映射写 KV（90 天），后续可用于跨节点一致性
      if (env && env.TMDB_CACHE) {
        if (rt)
          puts.push(
            env.TMDB_CACHE.put(
              CK.uidRt(rt.slice(0, 32)),
              JSON.stringify({ data: traktId, _ts: Date.now() }),
              { expirationTtl: 60 * 60 * 24 * 90 },
            ).catch(() => {}),
          );
        if (at)
          puts.push(
            env.TMDB_CACHE.put(
              CK.uidAt(at.slice(0, 24)),
              JSON.stringify({ data: traktId, _ts: Date.now() }),
              { expirationTtl: 60 * 60 * 24 * 90 },
            ).catch(() => {}),
          );
      }
      if (ctx && typeof ctx.waitUntil === "function")
        ctx.waitUntil(Promise.all(puts));
      // 同时写内存
      if (rt) kvMemSet(CK.uidRt(rt.slice(0, 32)), traktId, KV_MEM_TTL);
      if (at) kvMemSet(CK.uidAt(at.slice(0, 24)), traktId, KV_MEM_TTL);
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": buildCookie(auth, traktId),
      },
    });
  }

  /* ============================================================
   * 轮询结果处理
   * ------------------------------------------------------------
   * 统一返回 { status, message } 结构：
   *   · status  给前端做分支判断（字符串枚举）
   *   · message 面向用户的中文提示，前端直接显示
   * 不再返回原始 HTTP 状态码和 raw 文本，避免前端拼出
   * “HTTP 502 · error” 这类让用户困惑的提示。
   * ============================================================ */
  const rawText = await res.text();
  let err = "unknown";
  try {
    err = JSON.parse(rawText).error;
  } catch {}

  // 202：仍在等待用户授权（正常流程，继续轮询）
  if (err === "authorization_pending" || err === "slow_down") {
    return Response.json({ status: err }, { status: 202 });
  }

  // 403：用户主动拒绝授权（停止轮询，需重新扫码）
  if (err === "access_denied") {
    return Response.json(
      { status: "denied", message: "你拒绝了授权，请重新登录" },
      { status: 403 },
    );
  }

  // 410：设备码过期或已被使用（停止轮询，需重新获取）
  if (err === "expired_token" || err === "already_used") {
    return Response.json(
      { status: "expired", message: "授权码已过期，请重新获取" },
      { status: 410 },
    );
  }

  // 429：Trakt 限流（前端稍后自动重试）
  if (res.status === 429) {
    return Response.json(
      { status: "rate_limited", message: "请求过于频繁，请稍后再试" },
      { status: 429 },
    );
  }

  // 其它（502/500/网络层）：上游服务异常（前端稍后自动重试）
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

/**
 * 登出：清 Cookie，并异步清理该用户的 KV 缓存。
 * 失败不阻断登出流程。
 */
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
  } catch {
    // 忽略清理失败
  }
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": clearCookieHeader() },
  });
}

/* -------------------- Cookie 读写 / token 刷新 -------------------- */

/** 构造认证 Cookie：b64url(JSON) + HttpOnly + Secure + SameSite=Lax */
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
  return `${COOKIE_NAME}=${b64urlEncode(JSON.stringify(payload))}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`;
}

/** 读取认证 Cookie，解析失败返回 null */
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

/**
 * 检查 token 是否即将过期，如果剩余 < 30 分钟就刷新。
 * 刷新失败返回 null，调用方按未登录处理。
 */
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

/** 构造 Trakt API 请求头 */
function makeTraktHeaders(env, auth) {
  return {
    "Content-Type": "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": env.TRAKT_CLIENT_ID,
    Authorization: `Bearer ${auth.access_token}`,
    "User-Agent": TRAKT_UA,
  };
}

/**
 * 稳定用户键：缓存与限流隔离都依赖此 ID。
 *
 * 优先级：
 *   1. Cookie.trakt_id（登录成功后已固化，最高优先级，零成本）
 *   2. 内存映射（rt/at → uid）
 *   3. KV 映射（rt/at → uid）
 *   4. GET /users/me 拉取（成功会写 KV，90 天有效）
 *   5. 降级：rt/at 前缀 / anon
 *
 * strict=true 时：
 *   · 限流 / 401 / 403 / 无法获取 → 返回 null，绝不降级
 *   · 调用方（authed）据此判定登录失败
 *
 * 注意：Trakt 的用户 IDs 可能只有 slug（无数字 trakt），
 * 此时用 "s:<slug>" 作为 uid，保证稳定性。
 */
async function getStableUserId(auth, headers, env, ctx, { strict = false } = {}) {
  if (!auth) return strict ? null : "anon";
  // 最高优先级：Cookie 内已固化（登录成功时写入，避免每次打 API）
  if (auth.trakt_id) return String(auth.trakt_id);

  const rt = auth.refresh_token ? String(auth.refresh_token) : "";
  const at = auth.access_token ? String(auth.access_token) : "";
  const memKey = rt ? CK.uidRt(rt.slice(0, 32)) : CK.uidAt(at.slice(0, 24));

  // 内存
  const memCached = kvMemGet(memKey);
  if (memCached !== undefined && memCached !== KV_MISS && memCached)
    return String(memCached);

  // KV 映射
  if (env && env.TMDB_CACHE) {
    try {
      const raw = await env.TMDB_CACHE.get(memKey, {
        type: "json",
        cacheTtl: 600,
      });
      kvMarkUp();
      if (raw != null) {
        const uid = String(
          typeof raw === "object" && raw.data != null ? raw.data : raw,
        );
        if (uid && uid !== "null" && uid !== "undefined") {
          kvMemSet(memKey, uid, KV_MEM_TTL);
          return uid;
        }
      }
    } catch {
      kvMarkDown();
    }
  }

  // 已知限流：strict 直接判失败，不再打 /users/me
  if (isTraktRateLimited(rt || at)) {
    if (strict) return null;
  }

  // Trakt API 拉稳定 ID（无需 extended=full，减小响应）
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
          const putP = env.TMDB_CACHE.put(
            memKey,
            JSON.stringify({ data: uid, _ts: Date.now() }),
            { expirationTtl: 60 * 60 * 24 * 90 },
          ).catch(() => {});
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

  // 最终降级
  if (strict) return null;
  const userId = rt
    ? "r" + rt.slice(0, 20)
    : at
      ? "a" + at.slice(0, 16)
      : "anon";
  kvMemSet(memKey, userId, KV_MEM_TTL);
  return userId;
}

/**
 * 仅写内存的映射缓存（用于已验证过的 traktId 快速复用）。
 * 不做 KV 写入，避免污染。
 */
function rememberTraktUserId(auth, traktId) {
  if (!auth || !traktId) return;
  const id = String(traktId);
  const rt = auth.refresh_token ? String(auth.refresh_token) : "";
  const at = auth.access_token ? String(auth.access_token) : "";
  if (rt) kvMemSet(CK.uidRt(rt.slice(0, 32)), id, KV_MEM_TTL);
  if (at) kvMemSet(CK.uidAt(at.slice(0, 24)), id, KV_MEM_TTL);
}
/* ============================================================
 * 段落 3 / 4：外部数据源 + 用户同步写操作
 * ------------------------------------------------------------
 * · 公共数据（TMDB / 豆瓣 / 剧场）走长 TTL 缓存
 * · 写操作（watchlist / history / drop）后必须 bust 用户缓存
 * · 用户数据（summary / calendar）走 strict 鉴权
 * ============================================================ */

/* -------------------- 用户缓存清理 -------------------- */

/** 清 Cookie 的响应头 */
function clearCookieHeader() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

/** 从 Cookie 读用户资料提示（昵称+头像，用于骨架秒出） */
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

/** 写用户资料提示 Cookie（非敏感，不带 HttpOnly） */
function buildProfileCookie(profile) {
  const data = { name: profile.name || "", avatar: profile.avatar || "" };
  return `${PROFILE_COOKIE}=${b64urlEncode(JSON.stringify(data))}; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`;
}

/**
 * 读取 watchlist 版本号。
 * 每次增删 watchlist 会 bump 版本号，用来让旧缓存自动失效。
 */
async function getWatchlistVersion(env, ctx, userKey) {
  if (!userKey) return "0";
  const key = CK.watchlistVersion(userKey);
  const mem = kvMemGet(key);
  if (mem !== undefined && mem !== KV_MISS) {
    const v =
      mem && typeof mem === "object" && mem.data != null ? mem.data : mem;
    if (v != null && v !== "") return String(v);
  }
  if (!env || !env.TMDB_CACHE || kvIsDown()) return "0";
  try {
    const raw = await env.TMDB_CACHE.get(key, {
      type: "json",
      cacheTtl: KV_EDGE_TTL,
    });
    kvMarkUp();
    let v = "0";
    if (raw != null)
      v = String(typeof raw === "object" && raw.data != null ? raw.data : raw);
    kvMemSet(key, { data: v, _ts: Date.now() }, KV_MEM_TTL);
    return v || "0";
  } catch {
    kvMarkDown();
    return "0";
  }
}

/**
 * 让 watchlist 缓存失效。
 * 1) 清掉内存中所有 wl: / wlids: 前缀
 * 2) bump 版本号（写 KV + 内存）
 * 版本号变化后，CK.watchlist(u, ver, sort) 的 key 就会变化，自动 miss。
 */
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
      if (
        k.startsWith("wl:") ||
        k.startsWith("wlids:") ||
        k.startsWith("wlv:")
      ) {
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

/** 用户缓存 key 清单（用于批量清理） */
function userCacheKeys(userKey) {
  return {
    exact: [CK.playback(userKey), CK.stats(userKey)],
    prefix: [
      `hist:${userKey}:`,
      `sum2:${userKey}:`,
      `tpr:${userKey}:`,
      `tmh:${userKey}:`,
      `prof:${userKey}`,
      `cal:${userKey}`,
      `act:${userKey}`,
    ],
  };
}

/** 清除首页数据相关的用户缓存（内存 + KV） */
function bustHomeUserCaches(userKey, env, ctx) {
  if (!userKey) return;
  const { exact, prefix } = userCacheKeys(userKey);
  for (const k of [...__kvMem.keys()]) {
    if (exact.includes(k) || prefix.some((p) => k.startsWith(p))) {
      __kvMem.delete(k);
      __kvMemExp.delete(k);
    }
  }
  if (env && env.TMDB_CACHE) {
    const fixedKeys = [
      CK.playback(userKey),
      CK.stats(userKey),
      CK.profile(userKey),
      CK.history(userKey, 1),
    ];
    const p = Promise.all(
      fixedKeys.map((k) => env.TMDB_CACHE.delete(k).catch(() => {})),
    );
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
    else p.catch(() => {});
  }
}

/**
 * 并发受限的任务执行器。
 * @param {Array<() => Promise>} taskFns  任务工厂（调用时才执行）
 * @param {number} concurrency           最大并行数
 * @param {number} delayMs               启动下一个任务前的间隔（读缓存时应为 0）
 */
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

/* -------------------- TMDB 辅助 -------------------- */

/** 带异常的 TMDB GET（失败返回 null） */
async function tmdbGet(url) {
  try {
    const r = await fetchT(url, {}, 8000);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/** 构造 TMDB 请求 URL（默认 zh-CN） */
function tmdbUrl(path, env, extra = {}) {
  const sep = path.includes("?") ? "&" : "?";
  const q = new URLSearchParams({
    language: "zh-CN",
    api_key: env.TMDB_API_KEY,
    ...extra,
  });
  return `${TMDB_API}${path}${sep}${q}`;
}

/** 带缓存的 TMDB 详情（默认 1 天 TTL） */
async function tmdbDetailCached(path, env, ctx, ttl = 86400) {
  if (!env.TMDB_API_KEY) return null;
  return cachedJSON(
    env,
    ctx,
    CK.tmdb(path),
    () => tmdbGet(tmdbUrl(path, env)),
    {
      ttl,
      missTtl: MISS_KV_TTL,
      swr: Math.min(3600, Math.floor(ttl * 0.4)),
      edgeTtl: 900,
      jitter: 200,
    },
  );
}

/** 拼 TMDB 图片 URL */
function tmdbPoster(path, size = "w185") {
  return path ? `${TMDB_IMG}/${size}${path}` : null;
}

/** 归一化 TMDB 结果为统一 item 结构 */
function mapTmdbItem(r, typeHint) {
  if (!r || !r.id) return null;
  const mt = typeHint || r.media_type;
  const isMovie = mt === "movie";
  if (mt !== "movie" && mt !== "tv" && mt !== "show") return null;
  return {
    type: isMovie ? "movie" : "show",
    tmdbId: r.id,
    title: isMovie
      ? r.title || r.original_title || ""
      : r.name || r.original_name || r.title || "",
    year: (r.release_date || r.first_air_date || "").slice(0, 4),
    poster: r.poster_path ? tmdbPoster(r.poster_path) : null,
    overview: r.overview || "",
    popularity: r.popularity || 0,
  };
}

/* -------------------- 豆瓣数据 -------------------- */

/** 拉豆瓣列表（走 6 小时缓存） */
async function getDoubanRaw(env, ctx) {
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
    { ttl: DOUBAN_KV_TTL, missTtl: 600, swr: 3600, jitter: 300 },
  );
}

/** 判断是否为港台地区 */
function isHkTw(region) {
  if (!region) return false;
  return region.indexOf("香港") >= 0 || region.indexOf("台湾") >= 0;
}

/** 归一化豆瓣单条 */
function mapDoubanItem(x) {
  if (!x || !x.tmdbId) return null;
  return {
    tmdbId: x.tmdbId,
    title: x.title || "",
    year: (x.releaseDate || "").slice(0, 4),
    poster: x.posterPath
      ? `https://image.tmdb.org/t/p/w342${x.posterPath}`
      : null,
    overview: x.description || "",
    rating: Number(x.rating) || 0,
    region: x.regionTitle || "",
    genre: x.genreTitle || "",
    kind: "tv",
  };
}

/** 从 data 中按 keys 提取并摊平数组 */
function collectDoubanLists(data, keys) {
  const out = [];
  if (!data) return out;
  for (const k of keys) {
    const v = data[k];
    if (Array.isArray(v)) out.push(...v);
  }
  return out;
}

/**
 * 从豆瓣原始数据中按 section + 类型过滤。
 * section: domestic / hktw / jpkr / western
 * filter:  all / movie / tv
 */
function pickDoubanSection(data, section, filter) {
  if (!data) return [];
  const typeFilter = filter || "all";
  let tvRaw = [];
  if (section === "domestic") tvRaw = collectDoubanLists(data, ["tv_domestic"]);
  else if (section === "hktw") {
    const all = Array.isArray(data.tv) ? data.tv : [];
    tvRaw = all.filter((x) => isHkTw(x.regionTitle));
  } else if (section === "jpkr")
    tvRaw = collectDoubanLists(data, ["tv_japanese", "tv_korean"]);
  else if (section === "western")
    tvRaw = collectDoubanLists(data, ["tv_american"]);
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

/** 渲染豆瓣列表为 HTML 片段 */
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

/**
 * 豆瓣列表 API。
 * mode=grid    返回纯卡片 HTML
 * mode=hscroll 返回包裹 .h-scroll 的 HTML
 */
async function handleDoubanList(request, env, ctx) {
  const url = new URL(request.url);
  const section = url.searchParams.get("section") || "domestic";
  const mode = url.searchParams.get("mode") || "grid";
  const filter = url.searchParams.get("filter") || "all";
  const data = await getDoubanRaw(env, ctx);
  const items = pickDoubanSection(data, section, filter);
  const html = renderDoubanItems(items);
  const outHeaders = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=1800, stale-while-revalidate=600",
  };
  if (mode === "hscroll") {
    if (!html)
      return new Response(
        '<div class="h-scroll-empty"><span class="spinner"></span></div>',
        { headers: outHeaders },
      );
    return new Response(`<div class="h-scroll">${html}</div>`, {
      headers: outHeaders,
    });
  }
  return new Response(html, { headers: outHeaders });
}

/* -------------------- 平台剧场 -------------------- */

/** 拉剧场列表（走 6 小时缓存） */
async function getTheaterRaw(env, ctx) {
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
    { ttl: THEATER_KV_TTL, missTtl: 600, swr: 3600, jitter: 300 },
  );
}

/** 遍历剧场数据结构，收集所有带 tmdbId 的条目 */
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

/** 递归遍历任意嵌套结构，收集条目 */
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

/** 提取条目的平台名称（多字段兜底） */
function theaterPlatformOf(x) {
  if (!x) return "";
  if (x.__platform)
    return x.__platform === "玛卡巴卡的悬疑剧" ? "悬疑剧" : x.__platform;
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

/** 提取所有平台名（去重，"悬疑剧" 固定放最后） */
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

/** 按平台过滤并归一化剧场条目 */
function pickTheaterSection(data, platform) {
  const list = collectTheaterItems(data);
  const filtered =
    !platform || platform === "all"
      ? list
      : list.filter((x) => theaterPlatformOf(x) === platform);
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
        x.releaseDate ||
          x.release_date ||
          x.firstAirDate ||
          x.year ||
          x.date ||
          "",
      ).slice(0, 4),
      poster:
        x.posterPath || x.poster_path
          ? `https://image.tmdb.org/t/p/w342${x.posterPath || x.poster_path}`
          : x.poster || x.cover || x.image || null,
      overview: x.description || x.overview || x.summary || "",
      platform: theaterPlatformOf(x),
      kind:
        x.type === "movie" || x.media_type === "movie" || x.isMovie === true
          ? "movie"
          : "tv",
    });
    if (out.length >= 200) break;
  }
  return out;
}

/** 渲染剧场列表为 HTML */
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

/**
 * 剧场列表 API。
 * mode=grid      纯卡片 HTML
 * mode=hscroll   包裹 .h-scroll
 * mode=platforms 返回平台列表 JSON
 * mode=debug     返回数据结构摘要（排查用）
 */
async function handleTheaterList(request, env, ctx) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") || "grid";
  const platform = url.searchParams.get("platform") || "all";
  const data = await getTheaterRaw(env, ctx);
  const outHeaders = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=1800, stale-while-revalidate=600",
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
          summary.shape[k] =
            "object{" + Object.keys(v).slice(0, 5).join(",") + "}";
        else summary.shape[k] = typeof v;
      }
      const first = collectTheaterItems(data)[0];
      summary.firstItem = first || null;
    }
    return new Response(JSON.stringify(summary).slice(0, 8000), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
  if (mode === "platforms") {
    return new Response(
      JSON.stringify({ platforms: getTheaterPlatforms(data) }),
      {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=1800, stale-while-revalidate=600",
        },
      },
    );
  }
  const html = renderTheaterItems(pickTheaterSection(data, platform));
  if (mode === "hscroll") {
    if (!html)
      return new Response(
        '<div class="h-scroll-empty"><span class="spinner"></span></div>',
        { headers: outHeaders },
      );
    return new Response(`<div class="h-scroll">${html}</div>`, {
      headers: outHeaders,
    });
  }
  return new Response(html, { headers: outHeaders });
}

/* -------------------- Trakt ID 解析 / 同步载荷 -------------------- */

/** 构造 Trakt sync 请求体 */
function traktSyncPayload(kind, id) {
  const entry = { ids: { trakt: id } };
  if (kind === "movie") return { movies: [entry] };
  if (kind === "show") return { shows: [entry] };
  if (kind === "episode") return { episodes: [entry] };
  return null;
}

/**
 * 通过 TMDB ID 反查 Trakt ID。
 * 依次尝试 type、反向 type、无类型。
 */
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

/* -------------------- OMDB / 预告片 -------------------- */

/** 拉 OMDB 评分（IMDb / RT / Metacritic） */
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

/** 拉 TMDB 预告片（优先中文，其次英文） */
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
      edgeTtl: 900,
      jitter: 200,
    },
  );
}

/** Metacritic 分数颜色 */
function mcColor(n) {
  if (n >= 61) return "#66cc33";
  if (n >= 40) return "#ffcc33";
  return "#ff0000";
}

/* -------------------- 评分 Logo（SVG）-------------------- */
// 每个评分平台的品牌 SVG（内联，无外部依赖）
const RATING_LOGOS = {
  tmdb: `<svg class="ext-logo" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#01B4E4" d="M6.62 12a2.291 2.291 0 0 1 2.292-2.295h-.013A2.291 2.291 0 0 1 11.189 12a2.291 2.291 0 0 1-2.29 2.291h.013A2.291 2.291 0 0 1 6.62 12zm10.72-4.062h4.266a2.291 2.291 0 0 0 2.29-2.291 2.291 2.291 0 0 0-2.29-2.296H17.34a2.291 2.291 0 0 0-2.291 2.296 2.291 2.291 0 0 0 2.29 2.29zM2.688 20.645h8.285a2.291 2.291 0 0 0 2.291-2.292 2.291 2.291 0 0 0-2.29-2.295H2.687a2.291 2.291 0 0 0-2.291 2.295 2.291 2.291 0 0 0 2.29 2.292zm10.881-6.354h.81l1.894-4.586H15.19l-1.154 3.008h-.013l-1.135-3.008h-1.154zm4.208 0h1.011V9.705h-1.011zm2.878 0h3.235v-.93h-2.223v-.933h1.99v-.934h-1.99v-.855h2.107v-.934h-3.112zM1.31 7.941h1.01V4.247h1.31v-.895H0v.895h1.31zm3.747 0h1.011V5.959h1.958v1.984h1.011v-4.59h-1.01v1.711H6.061V3.351H5.057zm5.348 0h3.242v-.933H11.41v-.934h1.99v-.933h-1.99v-.856h2.107v-.934h-3.112zM.162 14.296h1.005v-3.52h.013l1.167 3.52h.765l1.206-3.52h.013v3.52h1.011v-4.59H3.82L2.755 12.7h-.013L1.686 9.705H.156zm14.534 6.353h1.641a3.188 3.188 0 0 0 .98-.149 2.531 2.531 0 0 0 .824-.437 2.123 2.123 0 0 0 .567-.713 2.193 2.193 0 0 0 .223-.983 2.399 2.399 0 0 0-.218-1.07 1.958 1.958 0 0 0-.586-.716 2.405 2.405 0 0 0-.873-.392 4.349 4.349 0 0 0-1.046-.13h-1.519zm1.013-3.656h.596a2.26 2.26 0 0 1 .606.08 1.514 1.514 0 0 1 .503.244 1.167 1.167 0 0 1 .34.412 1.28 1.28 0 0 1 .13.587 1.546 1.546 0 0 1-.13.658 1.127 1.127 0 0 1-.347.433 1.41 1.41 0 0 1-.518.238 2.797 2.797 0 0 1-.649.07h-.538zm4.686 3.656h1.88a2.997 2.997 0 0 0 .613-.064 1.735 1.735 0 0 0 .554-.214 1.221 1.221 0 0 0 .402-.39 1.105 1.105 0 0 0 .155-.606 1.188 1.188 0 0 0-.071-.415 1.01 1.01 0 0 0-.204-.34 1.087 1.087 0 0 0-.317-.24 1.297 1.297 0 0 0-.413-.13v-.012a1.203 1.203 0 0 0 .575-.366.962.962 0 0 0 .216-.648 1.081 1.081 0 0 0-.149-.603 1.022 1.022 0 0 0-.389-.354 1.673 1.673 0 0 0-.54-.169 4.463 4.463 0 0 0-.6-.041h-1.712zm1.011-3.734h.687a1.4 1.4 0 0 1 .24.022.748.748 0 0 1 .22.075.432.432 0 0 1 .16.147.418.418 0 0 1 .061.236.47.47 0 0 1-.055.233.433.433 0 0 1-.146.156.62.62 0 0 1-.204.084 1.058 1.058 0 0 1-.23.026h-.745zm0 1.835h.765a1.96 1.96 0 0 1 .266.02 1.015 1.015 0 0 1 .26.07.519.519 0 0 1 .204.152.406.406 0 0 1 .08.26.481.481 0 0 1-.06.253.519.519 0 0 1-.16.168.62.62 0 0 1-.217.09 1.155 1.155 0 0 1-.237.027H21.4z"/></svg>`,
  imdb: `<svg class="ext-logo" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#F5C518" d="M22.3781 0H1.6218C.7411.0583.0587.7437.0018 1.5953l-.001 20.783c.0585.8761.7125 1.543 1.5559 1.6191A.337.337 0 0 0 1.6016 24h20.7971a.4579.4579 0 0 0 .0437-.002c.8727-.0768 1.5568-.8271 1.5568-1.7085V1.7098c0-.8914-.696-1.6416-1.584-1.7078A.3294.3294 0 0 0 22.3781 0zm0 .496a1.2144 1.2144 0 0 1 1.1252 1.2139v20.5797c0 .6377-.4875 1.1602-1.1045 1.2145H1.6016c-.5967-.0543-1.0645-.5297-1.1053-1.1258V1.6284C.5371 1.0185 1.0184.5364 1.6217.496h20.7564zM4.7954 8.2603v7.3636H2.8899V8.2603h1.9055zm6.5367 0v7.3636H9.6707v-4.9704l-.6711 4.9704H7.813l-.6986-4.8618-.0066 4.8618h-1.668V8.2603h2.468c.0748.4476.1492.9694.2307 1.5734l.2712 1.8713.4407-3.4447h2.4817zm2.9772 1.3289c.0742.0404.122.108.1417.2034.0279.0953.0345.3118.0345.6442v2.8548c0 .4881-.0345.7867-.0955.8954-.0609.1152-.2304.1695-.5018.1695V9.5211c.204 0 .3457.0205.4211.0681zm-.0211 6.0347c.4543 0 .8006-.0265 1.0245-.0742.2304-.0477.4204-.1357.5694-.2648.1556-.1218.2642-.298.3251-.5219.0611-.2238.1021-.6648.1021-1.3224v-2.5832c0-.6986-.0271-1.1668-.0742-1.4039-.041-.237-.1431-.4543-.3126-.6437-.1695-.1973-.4198-.3324-.7456-.421-.3191-.0808-.8542-.1285-1.7694-.1285h-1.4244v7.3636h2.3051zm5.14-1.7827c0 .3523-.0199.5762-.0544.6708-.033.0947-.1894.1424-.3046.1424-.1086 0-.19-.0477-.2238-.1351-.041-.0887-.0609-.2986-.0609-.6238v-1.9469c0-.3324.0199-.5423.0543-.6237.0338-.0808.1086-.122.2171-.122.1153 0 .2709.0412.3114.1425.041.0947.0609.2986.0609.6032v1.8926zm-2.4747-5.5809v7.3636h1.7157l.1152-.4675c.1556.1894.3251.3324.5152.4271.1828.0881.4608.1357.678.1357.3047 0 .5629-.0748.7802-.237.2165-.1562.3589-.3462.4198-.5628.0543-.2173.0887-.543.0887-.9841v-2.0675c0-.4409-.0139-.7324-.0344-.8681-.0199-.1357-.0742-.2781-.1695-.4204-.1021-.1425-.2437-.251-.4272-.3325-.1834-.0742-.3999-.1152-.6576-.1152-.2172 0-.4952.0477-.6846.1285-.1835.0887-.353.2238-.5086.4007V8.2603h-1.8309z"/></svg>`,
  rt: `<svg class="ext-logo" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="#FA320A" d="M5.866 0L4.335 1.262l2.082 1.8c-2.629-.989-4.842 1.4-5.012 2.338 1.384-.323 2.24-.422 3.344-.335-7.042 4.634-4.978 13.148-1.434 16.094 5.784 4.612 13.77 3.202 17.91-1.316C27.26 13.363 22.993.65 10.86 2.766c.107-1.17.633-1.503 1.243-1.602-.89-1.493-3.67-.734-4.556 1.374C7.52 2.602 5.866 0 5.866 0zM4.422 7.217H6.9c2.673 0 2.898.012 3.55.202 1.06.307 1.868.973 2.313 1.904.05.106.092.206.13.305l7.623.008.027 2.912-2.745-.024v7.549l-2.982-.016v-7.522l-2.127.016a2.92 2.92 0 0 1-1.056 1.134c-.287.176-.3.19-.254.264.127.2 2.125 3.642 2.125 3.659l-3.39.019-2.013-3.376c-.034-.047-.122-.068-.344-.084l-.297-.02.037 3.48-3.075-.038zm3.016 2.288l.024.338c.014.186.024.729.024 1.206v.867l.582-.025c.32-.013.695-.049.833-.078.694-.146 1.048-.478 1.087-1.018.027-.378-.063-.636-.303-.87-.318-.309-.761-.416-1.733-.418Z"/></svg>`,
  mc: `<svg class="ext-logo" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="#FFFFFF" d="M11.99 0A12 12 0 1 0 24 12v-.014A12 12 0 0 0 11.99 0Zm-.055 2.564a9.399 9.399 0 0 1 9.407 9.389v.01a9.399 9.399 0 1 1-9.408-9.399Zm-1.61 17.198 2.046-2.046-3.94-3.94c-.165-.166-.345-.373-.442-.608-.221-.47-.318-1.203.221-1.742.664-.664 1.548-.387 2.406.47l3.788 3.788 2.046-2.046-3.954-3.954a2.48 2.48 0 0 1-.456-.622c-.263-.539-.25-1.216.235-1.7.677-.678 1.562-.429 2.544.553l3.677 3.677 2.046-2.046-3.982-3.982c-2.018-2.018-3.912-1.949-5.212-.65-.498.499-.802 1.024-.954 1.618a4.026 4.026 0 0 0-.055 1.686l-.027.028c-.996-.414-2.13-.166-3 .705-1.162 1.161-1.12 2.392-.982 3.11l-.042.043-1.009-.816-1.77 1.77a64.1 64.1 0 0 1 2.213 2.1z"/></svg>`,
  trakt: `<svg class="ext-logo" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="#ED1C24" d="m15.082 15.107-.73-.73 9.578-9.583a4.499 4.499 0 0 0-.115-.575L13.662 14.382l1.08 1.08-.73.73-1.81-1.81L23.422 3.144c-.075-.15-.155-.3-.25-.44L11.508 14.377l2.154 2.155-.73.73-7.193-7.199.73-.73 4.309 4.31L22.546 1.86A5.618 5.618 0 0 0 18.362 0H5.635A5.637 5.637 0 0 0 0 5.634V18.37A5.632 5.632 0 0 0 5.635 24h12.732C21.477 24 24 21.48 24 18.37V6.19l-8.913 8.918zm-4.314-2.155L6.814 8.988l.73-.73 3.954 3.96zm1.075-1.084-3.954-3.96.73-.73 3.959 3.96zm9.853 5.688a4.141 4.141 0 0 1-4.14 4.14H6.438a4.144 4.144 0 0 1-4.139-4.14V6.438A4.141 4.141 0 0 1 6.44 2.3h10.387v1.04H6.438c-1.71 0-3.099 1.39-3.099 3.1V17.55c0 1.71 1.39 3.105 3.1 3.105h11.117c1.71 0 3.1-1.395 3.1-3.105v-1.754h1.04v1.754z"/></svg>`,
  douban: `<svg class="ext-logo" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="#2D963D" d="M.51 3.06h22.98V.755H.51V3.06Zm20.976 2.537v9.608h-2.137l-1.669 5.76H24v2.28H0v-2.28h6.32l-1.67-5.76H2.515V5.597h18.972Zm-5.066 9.608H7.58l1.67 5.76h5.501l1.67-5.76ZM18.367 7.9H5.634v5.025h12.733V7.9Z"/></svg>`,
};

/**
 * 渲染外部评分徽章（IMDb / RT / MC / TMDB / Trakt / 豆瓣）。
 * 传入 null/undefined 的字段会自动跳过。
 */
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

/* -------------------- Watchlist -------------------- */

/**
 * 直接从 Trakt 拉 watchlist（不分页，一次拉全）。
 * movies / shows 并行。
 */
async function fetchWatchlistRaw(headers, sort, userKey) {
  const qs = `extended=full&images=poster&sort=${encodeURIComponent(sort)}`;
  const [movies, shows] = await Promise.all([
    traktGet(`${TRAKT_API}/sync/watchlist/movies?${qs}`, headers, 1, userKey),
    traktGet(`${TRAKT_API}/sync/watchlist/shows?${qs}`, headers, 1, userKey),
  ]);
  if (movies && movies.__error) return { __error: movies.__error };
  if (shows && shows.__error) return { __error: shows.__error };
  const merged = [];
  if (Array.isArray(movies)) for (const x of movies) merged.push(x);
  if (Array.isArray(shows)) for (const x of shows) merged.push(x);
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

/**
 * 带缓存的 watchlist 拉取。
 * key 含版本号，写入 watchlist 后 bump 版本号即可让旧缓存自动失效。
 * force=1 时 bypass 缓存直接打 Trakt。
 */
async function getWatchlist(headers, sort = "added", env, ctx, userKey, force) {
  if (!env) return fetchWatchlistRaw(headers, sort, userKey);
  const prefix = userKey || "anon";
  const ver = await getWatchlistVersion(env, ctx, prefix);
  const data = await cachedJSON(
    env,
    ctx,
    CK.watchlist(prefix, ver, sort),
    () => fetchWatchlistRaw(headers, sort, userKey),
    {
      ttl: WATCHLIST_KV_TTL,
      missTtl: 180,
      swr: false,
      edgeTtl: 300,
      jitter: 120,
      bypass: !!force,
      revalidate: true,
    },
  );
  return Array.isArray(data) ? data : null;
}

/** 提取 watchlist 中所有条目的 TMDB ID */
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

/* -------------------- 搜索 / 趋势 -------------------- */

/**
 * 搜索 API：TMDB 搜索 movie + tv，合并按 popularity 排序。
 * 不依赖用户身份，所以不开启 strict。
 */
async function handleSearch(request, env, ctx) {
  const url = new URL(request.url),
    q = (url.searchParams.get("q") || "").trim(),
    typeFilter = url.searchParams.get("type") || "all";
  const A = await authed(request, env, ctx);
  if (!A.ok) return A.response;
  const { auth, needsCookieUpdate } = A;
  const outHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
  if (needsCookieUpdate)
    outHeaders["Set-Cookie"] = buildCookie(auth, auth.trakt_id);
  if (!q)
    return new Response(JSON.stringify({ items: [] }), { headers: outHeaders });
  if (!env.TMDB_API_KEY)
    return new Response(JSON.stringify({ items: [], error: "no tmdb key" }), {
      headers: outHeaders,
    });

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
  return new Response(JSON.stringify({ items: merged.slice(0, 30) }), {
    headers: outHeaders,
  });
}

/** TMDB 今日趋势，走 6 小时缓存 */
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
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

/* -------------------- Watchlist 增删 -------------------- */

/**
 * 加入待看。
 * 优先使用 tmdbId（会反查 Trakt ID）；rawId 直接作为 Trakt ID 使用。
 */
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

/** 从待看移除 */
async function handleWatchlistRemove(request, env, ctx) {
  return traktSyncAction(request, env, ctx, {
    allowedTypes: ["movie", "show"],
    endpoint: "/sync/watchlist/remove",
    buildPayload: (type, id) => traktSyncPayload(type, id),
    afterOk: async (auth, headers, env, ctx) => {
      const userKey = await getStableUserId(auth, headers, env, ctx);
      invalidateWatchlistCache(env, ctx, userKey);
    },
  });
}

/** 标记已看（movie / episode） */
async function handleMarkWatched(request, env, ctx) {
  return traktSyncAction(request, env, ctx, {
    allowedTypes: ["movie", "episode"],
    endpoint: "/sync/history",
    buildPayload: (type, id) => traktSyncPayload(type, id),
    afterOk: async (auth, headers, env, ctx) => {
      const userKey = await getStableUserId(auth, headers, env, ctx);
      bustHomeUserCaches(userKey, env, ctx);
    },
  });
}

/** 取消已看 */
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

/* -------------------- 标记整季已看 -------------------- */

/**
 * 把某季所有已播出集数标记为已看。
 * 流程：
 *   1. 拉季数据（优先缓存）
 *   2. 过滤出已播出的集
 *   3. 批量 POST /sync/history
 *   4. bust 用户缓存
 */
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

  // 1) 尝试从缓存拿季数据
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

  // 2) 缓存拿不到，直接打 Trakt
  if (!seasonData || !Array.isArray(seasonData.episodes)) {
    try {
      const r = await traktFetch(
        `${TRAKT_API}/shows/${showId}/seasons/${season}?extended=full,episodes`,
        headers,
        {
          retries: 1,
          timeout: 12000,
          userKey,
        },
      );
      if (r && !r.__error && Array.isArray(r.episodes)) {
        seasonData = r;
        kvPutJSON(
          env,
          ctx,
          CK.season(showId, season),
          { data: r },
          SEASON_KV_TTL,
          false,
        );
      }
    } catch {}
  }

  // 3) 还拿不到，从整剧的 seasons 中找
  if (!seasonData || !Array.isArray(seasonData.episodes)) {
    try {
      const all = await traktFetch(
        `${TRAKT_API}/shows/${showId}/seasons?extended=full,episodes`,
        headers,
        {
          retries: 1,
          timeout: 15000,
          userKey,
        },
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
            SEASON_KV_TTL,
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

  // 4) 过滤出已播出的集
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

  // 5) 批量标记
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
    return authJson(
      auth,
      needsCookieUpdate,
      { error: "网络错误：" + String(e) },
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

  // 6) bust 用户缓存
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

/* -------------------- 弃剧 -------------------- */

/**
 * 弃剧：加入 Trakt hidden/dropped + hidden/calendar。
 * 同时清掉本地日历缓存，让弃剧马上从追剧日历消失。
 */
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
  // 顺便把日历也隐藏
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

  // 本地记录弃剧 ID，用于过滤首页日历
  const today = new Date(Date.now() + 8 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  if (userKey) {
    const dropKey = `dropped:${userKey}`;
    const calKey = CK.calendar(userKey, today);
    let nextIds = [showId];
    try {
      const prev = kvMemGet(dropKey);
      const prevData =
        prev && prev !== KV_MISS && prev.data !== undefined ? prev.data : prev;
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
      if (ctx && typeof ctx.waitUntil === "function")
        ctx.waitUntil(Promise.all(dels));
      else Promise.all(dels).catch(() => {});
    }
  }
  bustHomeUserCaches(userKey, env, ctx);
  const added =
    result && result.added && result.added.shows ? result.added.shows : 0;
  return authJson(auth, needsCookieUpdate, { ok: true, added, result, showId });
}

/* -------------------- 剧集播出日历 -------------------- */

/**
 * 单剧播出日历 API。
 * 返回所有季所有已定档集数的 first_aired，供前端渲染日历。
 *
 * strict: true —— 依赖用户身份，拿不到就回登录页。
 */
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

  // 尝试用 TMDB 拿中文集标题
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
          for (const s of realSeasons) {
            seasonDatas.push(
              await tmdbDetailCached(
                `/tv/${tmdbId}/season/${s.season_number}`,
                env,
                ctx,
              ),
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

  return authResp(
    auth,
    needsCookieUpdate,
    JSON.stringify({ episodes, title: zhShowTitle }),
    {
      extra: { "Cache-Control": "public, max-age=600" },
      contentType: "application/json; charset=utf-8",
    },
  );
}

/* -------------------- 观看小结 -------------------- */

/**
 * 观看小结 API。
 * period=month|year，ref=YYYY-MM 或 YYYY。
 * 数据走 memOnly 缓存（6 小时），不写 KV。
 *
 * strict: true —— 纯用户数据。
 */
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

/** 计算周期的起止时间（+08:00） */
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

/**
 * 拉指定时间段的历史记录（最多 3 页）。
 * 用于观看小结统计。
 */
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

/**
 * 构造观看小结。
 * 输入时间段，聚合出：电影数、剧集数、集数、总时长、最忙一天、
 * 电影 TOP8、剧集 TOP8、每日热力。
 * 中文标题通过 TMDB 补全。
 */
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

  // 遍历历史，聚合统计
  for (const it of items) {
    if (!it) continue;
    const watchedAt = it.watched_at || "";
    let day = "";
    if (watchedAt) {
      try {
        const d = new Date(watchedAt);
        day = new Date(d.getTime() + 8 * 3600 * 1000)
          .toISOString()
          .slice(0, 10);
      } catch {}
    }
    if (day) dayCount.set(day, (dayCount.get(day) || 0) + 1);

    if (it.type === "movie" || it.movie) {
      // 电影
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
      // 剧集
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

  // 最忙一天
  let busiest = null;
  for (const [d, n] of dayCount) {
    if (!busiest || n > busiest.count) busiest = { date: d, count: n };
  }

  // 排序 TOP8
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

  // 通过 TMDB 补中文标题
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

  // 输出格式统一
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

  // 前后周期
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
  };
}
/* ============================================================
 * 段落 4 / 4：
 * handleHomeData（含 strict 鉴权）
 * 首页 shell / 骨架 HTML
 * 详情 API / 演员 API / 季 API
 * ============================================================ */

/* -------------------- 首页 shell / 数据聚合 -------------------- */

/** 首页路由：有 Cookie 走 shell，否则走登录页 */
async function handleHome(request, env, ctx) {
  const url = new URL(request.url);
  let initialDetail = url.searchParams.get("d");
  if (!initialDetail && url.pathname.startsWith("/detail/")) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 3) initialDetail = parts[1] + "/" + parts[2];
  }
  const cookieAuth = readAuth(request);
  if (!cookieAuth) return html(renderLoginPage());
  const profileHint = readProfileHint(request);
  return streamHomeShell(initialDetail, profileHint);
}

/**
 * 流式输出首页 shell。
 * 分块 enqueue，让浏览器尽早开始渲染骨架和启动 primaryBoot。
 */
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
            `<!DOCTYPE html><html lang="zh-CN" style="background:#000000"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1,user-scalable=no"><meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate"><meta http-equiv="Pragma" content="no-cache"><meta name="color-scheme" content="dark"><meta name="theme-color" content="${THEME_COLOR}"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="${APP_SHORT_NAME}"><meta name="mobile-web-app-capable" content="yes"><meta name="format-detection" content="telephone=no"><title>${APP_NAME}</title><link rel="icon" href="${FAVICON_URL}" type="image/png"><link rel="apple-touch-icon" href="${APPLE_ICON}"><link rel="manifest" href="/manifest.webmanifest"><link rel="preconnect" href="https://api.trakt.tv" crossorigin><link rel="preconnect" href="https://api.themoviedb.org" crossorigin><link rel="preconnect" href="https://image.tmdb.org" crossorigin><link rel="preload" href="/app.css?v=${APP_CSS_VERSION}" as="style"><link rel="modulepreload" href="/app.js?v=${APP_JS_VERSION}"><link rel="stylesheet" href="/app.css?v=${APP_CSS_VERSION}"><style>${splashCriticalCss()}</style><script>window.__splashT0=Date.now();window.__splashHidden=false;window.__primaryBootP=null;try{window.__primaryBootP=fetch('/api/home-data?part=playback',{credentials:'same-origin',cache:'no-store'}).then(function(r){if(r.status===401){location.href='/';return null;}if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}).then(function(d){window.__primaryBoot=d;return d;}).catch(function(){return null;});}catch(e){}</script></head><body style="background:#000000;margin:0;min-height:100vh;min-height:100dvh">${renderSplash()}`,
          ),
        );
        controller.enqueue(
          enc.encode(renderHomeSkeleton(initialDetail, profileHint)),
        );
        // 回访秒开：localStorage 回填进度条
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
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** 用户活动签名缓存（内存 5 分钟） */
const __actSigMemCache = new Map();
const ACT_SIG_MEM_TTL = 300000;

/**
 * 拉 sync/last_activities 生成签名。
 * 用于判断用户数据是否有变化，是缓存失效的辅助信号。
 */
async function getUserActivitySig(headers, env, ctx, userKey) {
  if (!userKey || userKey === "anon") return null;
  const now = Date.now();
  const mem = __actSigMemCache.get(userKey);
  if (mem && now - mem.ts < ACT_SIG_MEM_TTL) return { sig: mem.sig };

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
        a.paused_at || "",
      ].join("|");
      return { sig };
    },
    { ttl: 600, missTtl: 120, swr: false, memOnly: true, jitter: 60 },
  );

  if (result && result.sig) {
    __actSigMemCache.set(userKey, { sig: result.sig, ts: now });
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

/** 弃剧 ID 内存缓存 */
const __droppedShowIdsMem = new Map();
const DROPPED_MEM_TTL = 300000;

/**
 * 拉取用户弃剧的 show ID 集合。
 * 用于过滤追剧日历中已弃剧的条目。
 */
async function getDroppedShowIds(headers, env, ctx, userKey) {
  const key = `dropped:${userKey || "anon"}`;
  const now = Date.now();
  const mem = __droppedShowIdsMem.get(key);
  if (mem && now - mem.ts < DROPPED_MEM_TTL)
    return new Set(mem.ids.map(Number));

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
      swr: false,
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

/** 带缓存的追剧日历拉取 */
async function getCalendarCached(today, headers, env, ctx, userKey, force) {
  const prefix = userKey || "anon";
  return cachedJSON(
    env,
    ctx,
    CK.calendar(prefix, today),
    async () => {
      try {
        if (isTraktRateLimited(userKey)) {
          return { __error: "rate limited" };
        }
        const r = await fetchT(
          `${TRAKT_API}/calendars/my/shows/${today}/30?extended=full&images=poster`,
          { headers },
          9000,
        );
        if (r.ok) return await r.json();
        if (r.status === 429) {
          consumeRetryAfter(r, userKey);
          return { __error: "HTTP 429" };
        }
        return { __error: "HTTP " + r.status };
      } catch (e) {
        return { __error: String(e) };
      }
    },
    {
      ttl: CALENDAR_KV_TTL,
      missTtl: 180,
      swr: false,
      edgeTtl: 300,
      jitter: 120,
      bypass: !!force,
      revalidate: true,
    },
  );
}

/* ============================================================
 * handleHomeData —— 首页分片数据
 * Query: part=playback|meta|history|watchlist|calendar|all
 *        force=1 仅刷新按钮使用，绕过缓存打 Trakt
 * 返回 HTML 片段 + playbackSource/metaSource + rateLimited/cooling
 * strict 鉴权：拿不到稳定身份 → 401 + relogin
 * ============================================================ */
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
  const today = new Date(Date.now() + 8 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const part = url.searchParams.get("part") || "all";
  const force = url.searchParams.get("force") === "1";

  // force 时少重试，失败尽快回退 KV
  const fetchJson = (u, retries = 1) =>
    traktFetch(u, headers, {
      retries,
      timeout: 7000,
      userKey,
      wantPageCount: true,
      backoffBase: 400,
    });

  const outHeaders = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  if (needsCookieUpdate)
    outHeaders.append("Set-Cookie", buildCookie(auth, auth.trakt_id));

  const wantPlayback = part === "playback" || part === "all";
  const wantMeta = part === "meta" || part === "all";
  const wantWatchlist = part === "watchlist" || part === "all";
  const wantCalendar = part === "calendar" || part === "all";
  const wantHistory = part === "history" || part === "all";

  // 并行启动活动签名查询
  const actSigP =
    wantMeta || wantWatchlist || wantHistory
      ? getUserActivitySig(headers, env, ctx, userKey)
      : Promise.resolve(null);

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

  // force：bypass；非 force：只读 KV，未过期绝不打 API
  const opts = (o) =>
    force
      ? { ...o, bypass: true, revalidate: true }
      : { ...o, swr: false, revalidate: true };

  // 继续观看
  if (wantPlayback) {
    taskFns.push(async () => {
      playback = await cachedJSON(
        env,
        ctx,
        CK.playback(userKey),
        async () => {
          if (isTraktRateLimited(userKey)) {
            return {
              __error: "429 rate limited",
              __cooling: traktRateLimitedRemaining(userKey),
            };
          }
          const r = await fetchJson(
            `${TRAKT_API}/sync/progress/up_next_nitro?extended=full&images=poster&limit=20&intent=continuing`,
          );
          if (r && r.__error) return r;
          return r;
        },
        {
          ...opts({
            ttl: PLAYBACK_KV_TTL,
            missTtl: 60,
            swr: true,
            unwrap: true,
            edgeTtl: 300,
            jitter: 120,
          }),
          sourceTracker: playbackSrc,
        },
      );
    });
  }

  // 观看历史（第一页）
  if (wantHistory) {
    taskFns.push(async () => {
      history = await cachedJSON(
        env,
        ctx,
        CK.history(userKey, 1),
        async () => {
          if (isTraktRateLimited(userKey)) {
            return {
              __error: "429 rate limited",
              __cooling: traktRateLimitedRemaining(userKey),
            };
          }
          const r = await fetchJson(
            `${TRAKT_API}/users/me/history?limit=${PAGE_SIZE}&page=1&extended=full&images=poster`,
          );
          if (r && r.__error) return r;
          // 包装为对象，保证 pageCount 经 JSON/KV 往返后仍保留
          if (Array.isArray(r)) {
            return {
              items: r,
              pageCount: r.__pageCount || 1,
            };
          }
          return r;
        },
        opts({
          ttl: HISTORY_KV_TTL,
          missTtl: 60,
          swr: true,
          unwrap: true,
          edgeTtl: 300,
          jitter: 120,
        }),
      );
    });
  }

  // 追剧日历
  if (wantCalendar) {
    taskFns.push(async () => {
      calendar = await getCalendarCached(
        today,
        headers,
        env,
        ctx,
        userKey,
        force,
      );
    });
  }

  // 待看列表
  if (wantWatchlist) {
    taskFns.push(async () => {
      try {
        watchlist = await getWatchlist(
          headers,
          "added",
          env,
          ctx,
          userKey,
          force,
        );
      } catch (e) {
        watchlist = null;
      }
    });
  }

  // 用户资料 + 统计
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
            ttl: PROFILE_KV_TTL,
            missTtl: 180,
            swr: true,
            edgeTtl: 300,
            jitter: 200,
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
          ttl: STATS_KV_TTL,
          missTtl: 180,
          swr: true,
          edgeTtl: 300,
          jitter: 120,
        }),
      );
    });
  }

  // force：串行 + 短间隔防 429；非 force：高并行
  const concurrency = force ? 1 : Math.min(6, Math.max(1, taskFns.length));
  const gapMs = force ? 300 : 0;
  await runLimited(taskFns, concurrency, gapMs);
  const actSig = await actSigP.catch(() => null);
  if (actSig && actSig.sig)
    kvMemSet(`act:${userKey}:last`, actSig.sig, KV_MEM_TTL);

  // 回传限流状态给前端
  if (isTraktRateLimited(userKey)) {
    result.rateLimited = true;
    result.cooling = traktRateLimitedRemaining(userKey);
  } else {
    result.rateLimited = false;
    result.cooling = 0;
  }

  // 组装 playback HTML
  if (wantPlayback) {
    const pbList = Array.isArray(playback) ? playback : [];
    try {
      result.playbackHScrollHtml = renderContinueItems(pbList, "hscroll");
    } catch {
      result.playbackHScrollHtml =
        '<div class="empty" style="padding:50px 20px"><p style="margin:0;font-size:.92rem">继续观看加载失败，稍后重试</p></div>';
    }
    result.playbackSource =
      playbackSrc.fromCache === true
        ? "cache"
        : playbackSrc.fromCache === false
          ? "live"
          : "";
    result.playbackAgeSec = playbackSrc.age || 0;
  }

  // 组装 meta（用户资料 + 统计）
  if (wantMeta) {
    if (profile && !profile.__error && profile.ids && profile.ids.trakt) {
      rememberTraktUserId(auth, profile.ids.trakt);
    }
    const username = (profile && !profile.__error && profile.username) || "我",
      displayName = (profile && !profile.__error && profile.name) || username,
      movieCount =
        stats && !stats.__error && stats.movies ? stats.movies.watched : 0,
      episodeCount =
        stats && !stats.__error && stats.episodes ? stats.episodes.watched : 0,
      showCount =
        stats && !stats.__error && stats.shows ? stats.shows.watched : 0,
      totalHours =
        stats && !stats.__error && stats.episodes && stats.episodes.minutes
          ? Math.round(stats.episodes.minutes / 60)
          : 0;

    let avatarUrl = "";
    try {
      const imgs = profile && !profile.__error && profile.images;
      if (imgs && imgs.avatar)
        avatarUrl =
          imgs.avatar.full || imgs.avatar.medium || imgs.avatar.thumb || "";
    } catch {}

    result.name = displayName;
    result.avatar = avatarUrl || null;
    result.statsHtml = renderStatsHtml({
      movie: movieCount,
      show: showCount,
      episode: episodeCount,
      hours: totalHours,
    });
    result.metaSource =
      metaSrc.fromCache === true
        ? "cache"
        : metaSrc.fromCache === false
          ? "live"
          : "";
    result.metaAgeSec = metaSrc.age || 0;

    // 写 profile hint Cookie
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

  // 组装 history
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

  // 组装 calendar（过滤弃剧）
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

  // 组装 watchlist
  if (wantWatchlist) {
    try {
      if (!Array.isArray(watchlist)) {
        result.watchlistHtml = emptyPaneHtml("暂时无法加载待看列表");
      } else if (!watchlist.length) {
        result.watchlistHtml = emptyWatchlistHtml();
      } else {
        const list = watchlist,
          firstPage = list.slice(0, WATCHLIST_PAGE_SIZE),
          hasMore = list.length > WATCHLIST_PAGE_SIZE,
          cardsHtml = renderWatchlistItems(firstPage, env),
          moreHtml = hasMore
            ? `<div class="load-more-wrap"><button class="load-more" data-page="2" data-sort="added" onclick="loadMoreWatchlist(this)">加载更多</button></div>`
            : "";
        result.watchlistHtml =
          watchlistToolbarHtml("added") +
          `<div id="watchlist-grid" class="grid">${cardsHtml}</div>` +
          moreHtml;
      }
    } catch {
      result.watchlistHtml = emptyPaneHtml("暂时无法加载待看列表");
    }
  }

  return new Response(JSON.stringify(result), { headers: outHeaders });
}

/* -------------------- 骨架 & 基础 HTML -------------------- */

/** 非流式渲染首页 shell（保留兼容） */
function renderHomeShell(initialDetail, profileHint) {
  const cfg = {
    loggedIn: true,
    initialDetail: initialDetail || "",
    profileHint: profileHint || null,
  };
  return (
    pageHeadEarly() +
    renderHomeSkeleton(initialDetail, profileHint) +
    `<script>window.__HOME_CONFIG__=${JSON.stringify(cfg).replace(/</g, "\\u003c")};<\/script>` +
    pageTail()
  );
}

/** 首页骨架 HTML（含所有模态框容器） */
function renderHomeSkeleton(initialDetail, profileHint) {
  const boot = initialDetail
    ? `<script>window.addEventListener('load',()=>{const s=${jsStr(initialDetail)},idx=s.indexOf('/');if(idx>0)openDetail(s.slice(0,idx),s.slice(idx+1),false);});<\/script>`
    : "";
  const heroName =
    profileHint && profileHint.name ? esc(profileHint.name) : "…";
  const heroAvatarHtml =
    profileHint && profileHint.avatar
      ? `<img src="${esc(profileHint.avatar)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">`
      : `<span class="hero-avatar-ph">👤</span>`;

  const section = (id, title, extraHtml) =>
    `<div class="home-section"><div class="home-section-head"><h2 class="home-section-title">${title}</h2><button class="home-more-btn" type="button" onclick="openListModal('${id}')"><span>查看更多</span><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button></div>${extraHtml || ""}<div class="h-scroll-wrap"><div class="h-scroll" id="${id}-hscroll"><div class="pane-loading"><div class="spinner"></div></div></div></div></div>`;

  return `<div class="container"><header class="hero"><div class="hero-left"><button type="button" class="hero-avatar" id="hero-avatar" title="观看小结" aria-label="打开观看小结">${heroAvatarHtml}</button><div class="hero-text"><h1 class="hero-name" id="hero-name">${heroName}</h1><p class="updated-at" id="updated-at"></p></div></div><div class="hero-actions"><button class="btn-action" id="btn-refresh" onclick="forceRefresh()" title="刷新数据"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg><span>刷新</span></button><button class="btn-action" onclick="logout()" title="退出登录"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg><span>退出</span></button></div></header><div class="stats" id="stats-box">${renderStatsHtml(null)}</div><nav class="tabs"><button class="tab active" data-tab="playback">首页</button><button class="tab" data-tab="watchlist">待看列表</button><button class="tab" data-tab="calendar">追剧日历</button><button class="tab" data-tab="history">观看记录</button><button class="tab" data-tab="search">搜索</button></nav><section id="playback" class="pane active">${section("playback", "继续观看")}${section("theater", "平台剧场", '<div class="theater-home-tabs" id="theater-home-tabs" style="display:none"></div>')}${section("douban-domestic", "豆瓣热播国产剧")}${section("douban-hktw", "豆瓣热播港台剧")}${section("douban-jpkr", "豆瓣热播日韩剧")}${section("douban-western", "豆瓣热播欧美剧")}</section><section id="watchlist" class="pane"><div class="pane-loading"><div class="spinner"></div></div></section><section id="calendar" class="pane"><div class="pane-loading"><div class="spinner"></div></div></section><section id="history" class="pane"><div class="grid"></div><div id="history-more"></div></section><section id="search" class="pane"><div class="search-bar"><input id="search-input" class="search-input" type="search" placeholder="搜索电影 / 剧集" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></div><div id="search-results" class="grid"></div></section></div><div id="list-modal" class="list-modal"><div class="list-modal-backdrop" onclick="closeListModal()"></div><div class="list-modal-panel"><div class="list-modal-head"><h3 class="list-modal-title" id="list-modal-title"></h3><button type="button" class="list-modal-close" onclick="closeListModal()" aria-label="关闭">×</button></div><div class="list-modal-body" id="list-modal-body"></div></div></div><div id="summary-modal" class="summary-modal" style="display:none" role="dialog" aria-modal="true" aria-label="观看小结"><div class="summary-backdrop" onclick="window.__closeSummary()"></div><div class="summary-panel"><div class="summary-head"><h2 class="summary-title">观看小结</h2><button type="button" class="summary-close" onclick="window.__closeSummary()" aria-label="关闭">×</button></div><div id="summary-modal-body" class="summary-body"><div class="pane-loading"><div class="spinner"></div></div></div></div></div><div id="person-modal" class="person-modal"><div class="person-backdrop" onclick="closePerson()"></div><div class="person-panel"><div class="person-panel-head"><div class="person-panel-name" id="person-modal-name"></div><button class="person-close" onclick="closePerson()" aria-label="关闭">×</button></div><div class="person-panel-body" id="person-modal-body"></div></div></div><div id="confirm-modal" class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" style="display:none"><div class="confirm-backdrop"></div><div class="confirm-panel"><div class="confirm-icon" id="confirm-icon">?</div><div class="confirm-title" id="confirm-title"></div><div class="confirm-msg" id="confirm-msg"></div><div class="confirm-actions"><button class="confirm-btn confirm-cancel" id="confirm-cancel" type="button">取消</button><button class="confirm-btn confirm-ok" id="confirm-ok" type="button">确定</button></div></div></div><div id="modal" class="modal"><div class="modal-backdrop" onclick="closeDetail()"></div><div class="modal-panel"><div class="modal-shell"><button class="modal-close" onclick="closeDetail()" aria-label="关闭"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button><div class="modal-body" id="modal-body"></div></div></div></div><div id="show-cal-modal" class="show-cal-modal"><div class="show-cal-backdrop" onclick="closeShowCal()"></div><div class="show-cal-panel"><div class="show-cal-head"><div class="show-cal-name" id="show-cal-name"></div><button class="show-cal-close" onclick="closeShowCal()" aria-label="关闭">×</button></div><div class="show-cal-info" id="show-cal-info"></div><div class="show-cal-nav"><button onclick="calShiftMonth(-1)" aria-label="上个月">‹</button><div id="show-cal-month">—</div><button onclick="calShiftMonth(1)" aria-label="下个月">›</button></div><div class="show-cal-weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div><div class="show-cal-grid" id="show-cal-grid"></div><div class="show-cal-legend"><span class="legend-item"><i class="legend-dot legend-past"></i>已播出</span><span class="legend-item"><i class="legend-dot legend-today"></i>今天</span><span class="legend-item"><i class="legend-dot legend-future"></i>待播出</span></div><div class="show-cal-detail" id="show-cal-detail"></div></div></div><script src="/app.js?v=${APP_JS_VERSION}" defer><\/script>${boot}`;
}

/* -------------------- 详情扩展（懒加载演员/推荐/预告片/评分） -------------------- */

/**
 * 详情扩展 API。
 * 懒加载演员、推荐、预告片、第三方评分，减少首次详情体积。
 * 不依赖用户身份，不开启 strict。
 */
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
      tmdbDetailCached(
        `/${t}/${tmdbId}?append_to_response=credits,recommendations`,
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
      return `<div class="trailer-card" data-yt-key="${esc(v.key)}"><div class="trailer-frame"></div><img class="trailer-thumb" src="https://img.youtube.com/vi/${esc(v.key)}/hqdefault.jpg" loading="lazy" alt="" onerror="this.parentNode.classList.add('no-thumb')"><span class="trailer-play"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" stroke="none"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11.04-6.86a1 1 0 0 0 0-1.72L9.5 4.28A1 1 0 0 0 8 5.14z"/></svg></span><div class="trailer-name">${esc(name)}</div></div>`;
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
    JSON.stringify({
      castHtml,
      recsHtml,
      ratingsHtml,
      trailersHtml,
    }),
    {
      contentType: "application/json; charset=utf-8",
      extra: {
        "Cache-Control": "private, max-age=600, stale-while-revalidate=1200",
      },
    },
  );
}

/* -------------------- 演员详情 -------------------- */

/** 演员详情页（公共数据，不 strict） */
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
      { status: 502 },
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
    ? `${TMDB_IMG}/w342${person.profile_path}`
    : null;
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

  const html = `<div class="person-head">${photo ? `<img class="person-photo" src="${photo}" alt="">` : `<div class="person-photo person-photo-ph">${esc(initial)}</div>`}<div class="person-info"><div class="person-name">${esc(name)}</div>${rows.length ? `<div class="person-rows">${rows.join("")}</div>` : ""}</div></div>${bio ? `<div class="person-bio">${esc(bio)}</div>` : ""}${creditsHtml ? `<div class="person-credits-title">参演作品</div><div class="grid">${creditsHtml}</div>` : '<p class="person-sub">暂无参演作品信息</p>'}`;

  return authResp(auth, needsCookieUpdate, html, {
    extra: { "Cache-Control": "private, max-age=3600" },
  });
}

/* -------------------- 季剧集 -------------------- */

/**
 * 季剧集 API。
 * strict: true —— 依赖用户观看进度。
 */
async function handleSeason(request, env, ctx) {
  const url = new URL(request.url),
    showId = url.searchParams.get("show") || "",
    seasonNum = parseInt(url.searchParams.get("season") || "0"),
    tmdbId = url.searchParams.get("tmdb"),
    slug = url.searchParams.get("slug") || "";
  if (isNaN(seasonNum) || (!showId && !tmdbId))
    return new Response("bad params", { status: 400 });

  const A = await authed(request, env, ctx, { html: true, strict: true });
  if (!A.ok) return A.response;
  const { auth, headers, needsCookieUpdate, userKey } = A;

  const validShowId = showId && /^\d+$/.test(showId);
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
          { ttl: 1800, missTtl: 60, swr: false, edgeTtl: 300, jitter: 120 },
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
    traktSeason && Array.isArray(traktSeason.episodes)
      ? traktSeason.episodes
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
    ),
    {
      extra: { "Cache-Control": "no-store" },
    },
  );
}

/* -------------------- 详情主渲染 API -------------------- */

/**
 * 详情 API。
 * strict: true —— 依赖用户进度/watchlist。
 */
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

    // 并行拉实体 / 搜索映射
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
              return (
                (arr[0][key] && arr[0][key].ids && arr[0][key].ids.trakt) ||
                null
              );
            },
            { ttl: 86400 * 7, missTtl: 120, swr: 3600, edgeTtl: 3600 },
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

    // 用户进度（剧集） / 电影历史
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
            { ttl: 1800, missTtl: 60, swr: false, edgeTtl: 300, jitter: 120 },
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
            { ttl: 1800, missTtl: 60, swr: false, edgeTtl: 300, jitter: 120 },
          )
        : Promise.resolve(null);

    const [tmdbBasic, userProgress, movieHistory] = await Promise.all([
      tmdbBasicP,
      userProgressP,
      movieHistoryP,
    ]);

    if (!entity && !tmdbBasic) {
      return errResponse(
        isTraktRateLimited(userKey)
          ? "Trakt 限流中，请稍后重试"
          : "加载失败，请稍后重试",
        502,
      );
    }

    // 没有 Trakt 实体时用 TMDB 兜底构造
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
      type === "movie"
        ? tmdbBasic && tmdbBasic.id
        : entity.ids && entity.ids.tmdb;
    if (wlTmdbId && env.TMDB_CACHE) {
      try {
        const wlType = type === "movie" ? "movies" : "shows";
        const ids = await getWatchlistTmdbIds(
          headers,
          env,
          ctx,
          userKey,
          wlType,
        );
        inWatchlist = ids.includes(wlTmdbId);
      } catch {}
    }

    // 计算初始季
    let initialSeasonNum = null;
    if (type === "show" && userProgress) {
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
      return new Response(
        "RENDER ERROR: " + ((renderErr && renderErr.stack) || renderErr),
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
 * 段落 5 / 6：
 * 页面渲染函数 + 富化 + handleMore + 工具函数
 * ============================================================ */

/* -------------------- 列表项基础解析 -------------------- */

/** 从 Trakt 实体的 images.poster 中提取海报 URL */
function posterOfTrakt(obj) {
  if (!obj || !obj.images) return null;
  const p = obj.images.poster;
  if (!p || !Array.isArray(p) || !p.length) return null;
  if (typeof p[0] === "string") return p[0];
  if (typeof p[0] === "object")
    return p[0].medium || p[0].thumb || p[0].full || null;
  return null;
}

/**
 * 归一化 Trakt 列表项（history / watchlist / calendar / continue watching）。
 * 输出统一结构：{ tag, tagClass, title, overview, poster, line1,
 *              detailType, detailId, traktId, enrichKey }
 */
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
    // 电影
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
    // enrichKey 用于后续 TMDB 富化（补中文标题/海报）
    if (m.ids && m.ids.tmdb) base.enrichKey = "movie:tmdb:" + m.ids.tmdb;
    else if (m.ids && m.ids.imdb) base.enrichKey = "movie:imdb:" + m.ids.imdb;
    else if (m.title)
      base.enrichKey = "movie:title:" + m.title + ":" + (m.year || "");
  } else if (
    kind === "episode" ||
    kind === "show" ||
    (traktItem.show && traktItem.episode)
  ) {
    // 剧集
    const e = traktItem.episode || {},
      s = traktItem.show || {};
    base.tag = "剧集";
    base.tagClass = "episode";
    base.title = s.title || "";
    base.overview = s.overview || "";
    base.poster = posterOfTrakt(s);
    base.line1 =
      e.season != null && e.number != null
        ? `S${pad(e.season)}E${pad(e.number)}${e.title ? " · " + e.title : ""}`
        : s.year
          ? String(s.year)
          : "";
    base.detailType = "show";
    base.traktId = s.ids && s.ids.trakt ? String(s.ids.trakt) : null;
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

/**
 * 解析 enrichKey，返回 { kind, source, value/title/year }。
 * enrichKey 格式：
 *   "movie:tmdb:123"
 *   "tv:imdb:tt123456"
 *   "movie:title:中文名:2024"
 */
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

/**
 * 富化单条：通过 TMDB 补中文标题、海报、简介。
 * 按 enrichKey 的 source 分别走 tmdb / imdb / tvdb / title 搜索。
 */
async function enrichOne(key, env, ctx) {
  if (!env.TMDB_API_KEY) return null;
  const parsed = parseEnrichKey(key);
  if (!parsed) return null;
  return cachedJSON(
    env,
    ctx,
    CK.enrich(key),
    async () => {
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
    },
    { ttl: TMDB_KV_TTL, missTtl: 3600 },
  );
}

/**
 * 批量富化 API。
 * 前端一次性把所有 data-enrich-key 元素提交，后端并发处理。
 */
async function handleEnrich(request, env, ctx) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({}, { status: 400 });
  }
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) return Response.json({});
  const limited = rawItems.slice(0, 80),
    out = {},
    seen = new Set(),
    tasks = [];
  for (const it of limited) {
    const key = it && it.key;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    tasks.push(
      enrichOne(key, env, ctx)
        .then((d) => {
          out[key] = d;
        })
        .catch(() => {
          out[key] = null;
        }),
    );
  }
  await Promise.all(tasks);
  return new Response(JSON.stringify(out), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=600",
    },
  });
}

/* -------------------- 单个媒体卡片渲染 -------------------- */

/**
 * 渲染单个媒体卡片（.item）。
 * 支持：海报、标签、播放按钮、移除/标记/弃剧按钮、
 *       观看进度条、日历按钮、详情点击、富化标记。
 */
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
      opts.tag && opts.tagClass === "upcoming"
        ? `<span class="tag ${esc(opts.tagClass)}">（${esc(opts.tag)}）</span>`
        : "";
  let calendarBtns = "";
  if (opts.calendarShowId) {
    calendarBtns += `<button class="cal-open-btn" type="button" data-cal-show-id="${esc(opts.calendarShowId)}" data-cal-show-name="${esc(opts.calendarShowName || opts.title)}"${opts.calendarTmdbId ? ` data-cal-show-tmdb="${esc(String(opts.calendarTmdbId))}"` : ""} title="查看这部剧的播出日历"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>播出日历</button>`;
  }
  if (opts.dropShowId) {
    calendarBtns += `<button class="cal-drop-btn" type="button" data-drop-show-id="${esc(String(opts.dropShowId))}" title="弃看剧集"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>弃看剧集</button>`;
  }
  const calendarBtnHtml = calendarBtns
    ? `<div class="cal-action-row">${calendarBtns}</div>`
    : "";
  return `<div class="item${clickable}"${dataAttrs}${enrichAttrs}${style}>${removeHtml}${watchedHtml}${unwatchHtml}<div class="poster">${opts.poster ? `<img src="${opts.poster}" loading="lazy" alt="">` : `<div class="poster-ph"><span>${opts.tagClass === "movie" ? "🎬" : "📺"}</span></div>`}${playHtml}${dropHtml}</div><div class="info"><div class="name-row"><span class="name">${esc(opts.title)}</span>${tagHtml}</div>${opts.line1 ? `<div class="meta">${esc(opts.line1)}</div>` : ""}${opts.overview ? `<div class="overview">${esc(opts.overview)}</div>` : ""}${opts.line2 ? `<div class="meta dim">${esc(opts.line2)}</div>` : ""}${bar}${calendarBtnHtml}</div></div>`;
}

/* -------------------- 观看记录渲染 -------------------- */

/**
 * 渲染观看记录列表。
 * @param {Array} items Trakt history 原始数组
 * @param {object} env
 * @param {boolean} isFragment 加载更多片段时为 true（无 empty 兜底）
 */
function renderHistoryPage(items, env, isFragment) {
  if (isFragment === undefined) isFragment = false;
  if (!Array.isArray(items))
    return isFragment ? "" : emptyPaneHtml("暂时无法加载观看记录");
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

/* -------------------- Watchlist 渲染 -------------------- */

/** watchlist 排序工具栏 */
function watchlistToolbarHtml(currentSort) {
  const opts = [
      ["added", "按添加时间"],
      ["released", "按发行年份"],
      ["title", "按标题"],
    ],
    options = opts
      .map(
        ([v, t]) =>
          `<option value="${v}"${v === currentSort ? " selected" : ""}>${t}</option>`,
      )
      .join("");
  return `<div class="wl-toolbar"><label class="wl-sort-label">排序<select id="wl-sort" class="wl-sort" onchange="onWatchlistSortChange(this.value)">${options}</select></label></div>`;
}

/** watchlist 空状态 */
function emptyWatchlistHtml() {
  return `<div class="empty"><svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg><p>待看列表是空的</p><p style="font-size:0.82rem;color:#5a6474;margin-top:10px;line-height:1.6;text-align:center">去 Trakt 上把想看的电影 / 剧集加入 watchlist，这里就会显示</p></div>`;
}

/** 渲染 watchlist 卡片 */
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
        removeType = item.movie ? "movie" : item.show ? "show" : null,
        removeId = e.traktId;
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
        removeType,
        removeId,
      });
    })
    .filter(Boolean)
    .join("");
}

/* -------------------- 继续观看渲染 -------------------- */

/** 构造 Infuse 深链 */
function buildInfuseHrefForContinue(item) {
  if (!item) return null;
  const movie = item.movie;
  if (movie && movie.ids && movie.ids.tmdb) {
    return `infuse://movie/${movie.ids.tmdb}`;
  }
  const show = item.show;
  const tmdbId = show && show.ids && show.ids.tmdb;
  if (!tmdbId) return null;
  const ep =
    item.episode || (item.progress && item.progress.next_episode) || null;
  const season = ep ? (ep.season != null ? ep.season : ep.season_number) : null;
  const number = ep
    ? ep.number != null
      ? ep.number
      : ep.episode_number
    : null;
  if (season != null && number != null) {
    return `infuse://series/${tmdbId}-${season}-${number}`;
  }
  return `infuse://series/${tmdbId}`;
}

/**
 * 渲染继续观看列表。
 * mode: "grid" | "hscroll" | "fragment"
 * 支持两种数据结构：
 *   · up_next_nitro 的原始数据（含 episode / movie / progress）
 *   · 派生出的 upnext 结构（含 next_episode）
 */
function renderContinueItems(upNext, mode = "grid") {
  if (mode === true) mode = "fragment";
  const items = [];
  if (Array.isArray(upNext)) {
    for (const entry of upNext) {
      if (entry.episode) {
        items.push({
          source: "playback",
          sortKey: entry.paused_at || entry.last_watched_at || "",
          raw: entry,
        });
      } else if (entry.show && entry.progress && entry.progress.next_episode) {
        const completed = entry.progress.completed;
        if (typeof completed === "number" && completed <= 0) continue;
        const next = entry.progress.next_episode;
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
            show: entry.show,
            episode: next,
            progress: null,
          },
        });
      } else if (entry.movie) {
        items.push({
          source: "playback",
          sortKey: entry.last_watched_at || "",
          raw: entry,
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
      epTag =
        ep.season != null && ep.number != null
          ? `S${pad(ep.season)}E${pad(ep.number)}`
          : "",
      playPct =
        typeof item.progress === "number" ? Math.round(item.progress) : null,
      e = buildBaseItem(item);
    let barPct = playPct;
    if (barPct == null && it.showProgress && it.showProgress.aired > 0) {
      barPct = Math.max(
        0,
        Math.min(
          100,
          Math.round((it.showProgress.completed / it.showProgress.aired) * 100),
        ),
      );
    }
    const subLine =
      it.showProgress && it.showProgress.aired > 0
        ? `已看 ${it.showProgress.completed} / ${it.showProgress.aired} 集`
        : playPct != null
          ? `已看 ${playPct}%`
          : epTag
            ? `下一集 ${epTag}`
            : "下一集";
    let watchedType = null,
      watchedId = null;
    if (item.movie && item.movie.ids && item.movie.ids.trakt) {
      watchedType = "movie";
      watchedId = item.movie.ids.trakt;
    } else if (item.episode && item.episode.ids && item.episode.ids.trakt) {
      watchedType = "episode";
      watchedId = item.episode.ids.trakt;
    }
    const playHref = buildInfuseHrefForContinue(item);
    return mediaItem({
      poster: e.poster,
      tag: e.tag,
      tagClass: e.tagClass,
      title: e.title,
      overview: e.overview,
      line1: e.line1,
      line2: subLine,
      pct: barPct,
      delay,
      detailType: e.detailType,
      detailId: e.detailId,
      enrichKey: e.enrichKey,
      watchedType,
      watchedId,
      playHref,
    });
  });
  if (mode === "fragment") return parts.join("");
  if (mode === "hscroll")
    return `<div class="h-scroll">${parts.join("")}</div>`;
  return `<div class="grid">${parts.join("")}</div>`;
}

/* -------------------- 追剧日历渲染 -------------------- */

/**
 * 渲染追剧日历。
 * 按播出日期分组，每组一个 .day 区块。
 */
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
    items.sort((a, b) =>
      (a.first_aired || "").localeCompare(b.first_aired || ""),
    );
    const d = new Date(day + "T00:00:00Z"),
      wd = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][
        d.getUTCDay()
      ],
      isToday = day === today,
      parts = items.map((item) => {
        let timeStr = "";
        if (item.first_aired) {
          const bj = new Date(
            new Date(item.first_aired).getTime() + 8 * 3600 * 1000,
          );
          timeStr = `${String(bj.getUTCHours()).padStart(2, "0")}:${String(bj.getUTCMinutes()).padStart(2, "0")}`;
        }
        const e = buildBaseItem(item),
          showTraktId = item.show && item.show.ids ? item.show.ids.trakt : null,
          zhTitle =
            showTraktId != null && zhTitles ? zhTitles[showTraktId] : null,
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
          calendarTmdbId:
            (item.show && item.show.ids && item.show.ids.tmdb) || null,
          dropShowId: showTraktId ? String(showTraktId) : null,
        });
      });
    out.push(
      `<div class="day"><div class="day-head"><span class="day-num">${day.slice(8)}</span><div><div class="day-mon">${day.slice(0, 7)}</div><div class="day-wd">${wd}</div></div>${isToday ? '<span class="today">今天</span>' : ""}</div><div class="grid">${parts.join("")}</div></div>`,
    );
  }
  return out.join("");
}

/* -------------------- 未看集数推导 -------------------- */

/** 从用户进度中推导第一个未看的集数 */
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
        return {
          season: s.number,
          number: ep.number,
        };
    }
  }
  return null;
}

/* -------------------- 详情主渲染 -------------------- */

/**
 * 渲染详情页主 HTML 片段。
 * 输入 Trakt 实体 + TMDB 数据 + 用户进度等，输出完整 HTML。
 */
function renderDetailFragment(d) {
  const type = d.type,
    entity = d.entity,
    traktId = d.traktId,
    userProgress = d.userProgress,
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
        ? tmdbPoster(tmdb.poster_path, "w342")
        : posterOfTrakt(entity),
    backdrop =
      tmdb && tmdb.backdrop_path
        ? tmdbPoster(tmdb.backdrop_path, "w780")
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

  // 状态块
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
    statusHtml = `<div class="d-status done d-status-progress"><div class="d-status-row"><div class="d-status-icon">▶</div><div class="d-status-body"><div class="d-status-title">已看 ${userProgress.completed} / ${userProgress.aired} 集 · ${pct}%</div><div class="d-status-sub">${userProgress.last_watched_at ? "上次 " + fmtRelative(userProgress.last_watched_at) : ""}</div></div></div><div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div></div>`;
  } else if (!isMovie) {
    statusHtml = `<div class="d-status"><div class="d-status-icon">○</div><div class="d-status-body"><div class="d-status-title">尚未观看</div><div class="d-status-sub">还没有观看记录</div></div></div>`;
  }

  // 图标
  const iconCheck =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12.5 10 17.5 19 7"/></svg>';
  const iconBm =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h10a1 1 0 0 1 1 1v16l-6-3.5L6 20V4a1 1 0 0 1 1-1z"/></svg>';
  const iconBmFill =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" stroke="none"><path d="M7 3h10a1 1 0 0 1 1 1v16l-6-3.5L6 20V4a1 1 0 0 1 1-1z"/></svg>';
  const iconPlay =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" stroke="none"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11.04-6.86a1 1 0 0 0 0-1.72L9.5 4.28A1 1 0 0 0 8 5.14z"/></svg>';

  // 操作按钮
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
    infuseHref = `infuse://movie/${tmdb.id}`;
  } else if (!isMovie && tmdb && tmdb.id) {
    const ne = firstUnwatchedEpisode(userProgress);
    const neSeason = ne
      ? ne.season != null
        ? ne.season
        : ne.season_number
      : null;
    const neNumber = ne
      ? ne.number != null
        ? ne.number
        : ne.episode_number
      : null;
    infuseHref =
      neSeason != null && neNumber != null
        ? `infuse://series/${tmdb.id}-${neSeason}-${neNumber}`
        : `infuse://series/${tmdb.id}`;
  }
  if (infuseHref)
    barBtns += `<a class="d-act d-act-play" href="${esc(infuseHref)}" rel="noopener" title="在 Infuse 中查看">${iconPlay}</a>`;
  const actionsHtml = barBtns
    ? `<div class="d-action-bar">${barBtns}</div>`
    : "";

  // 演员
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

  // 延迟加载区块（deferExtras）
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
  } else if (
    thirdParty ||
    traktRating != null ||
    tmdbRating != null ||
    doubanUrl
  ) {
    ratingsSectionHtml = `<div class="detail-ext-ratings">${renderExtRatings(thirdParty, { trakt: traktRating, tmdb: tmdbRating, doubanUrl })}</div>`;
  }

  // 季列表
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

/* -------------------- 季剧集列表渲染 -------------------- */

/** 渲染某一季的集数列表 */
function renderSeasonEpisodes(
  seasonProgress,
  tmdbSeason,
  seasonNum,
  showSlug,
  traktEpisodes,
) {
  if (
    !tmdbSeason ||
    !Array.isArray(tmdbSeason.episodes) ||
    !tmdbSeason.episodes.length
  )
    return '<div class="ep-empty">暂无剧集信息</div>';
  const watched = new Map();
  if (Array.isArray(seasonProgress && seasonProgress.episodes))
    seasonProgress.episodes.forEach((e) => watched.set(e.number, e));
  const traktMap = new Map();
  if (Array.isArray(traktEpisodes))
    traktEpisodes.forEach((e) => {
      if (e && e.number != null) traktMap.set(e.number, e);
    });
  return tmdbSeason.episodes
    .map((ep) => {
      const num = ep.episode_number,
        w = watched.get(num),
        isWatched = !!(w && w.completed),
        traktEp = traktMap.get(num);
      const epId =
        (traktEp && traktEp.ids && traktEp.ids.trakt) ||
        (w && w.ids && w.ids.trakt) ||
        null;
      const traktUrl = showSlug
        ? `https://trakt.tv/shows/${showSlug}/seasons/${seasonNum}/episodes/${num}`
        : "";
      const clickable = traktUrl ? " clickable" : "";
      const attrs = traktUrl
        ? ` data-trakt-url="${esc(traktUrl)}" role="link" tabindex="0" title="在 Trakt 中打开"`
        : "";
      const actionHtml = isWatched
        ? '<div class="ep-check">✓</div>'
        : epId
          ? `<button class="ep-watch-btn" type="button" data-episode-id="${esc(String(epId))}" data-episode-title="${esc(ep.name || "")}" title="标记本集已看">标记已看</button>`
          : "";
      return `<div class="episode${isWatched ? " watched" : ""}${clickable}"${attrs}><div class="ep-num">E${pad(num)}</div><div class="ep-body"><div class="ep-title">${esc(ep.name || "")}</div>${ep.overview ? `<div class="ep-overview">${esc(ep.overview)}</div>` : ""}</div><div class="ep-actions">${actionHtml}</div></div>`;
    })
    .join("");
}

/* -------------------- 空状态 -------------------- */

/** 空视图（通用或错误） */
function emptyView(opts) {
  if (typeof opts === "string") opts = { text: opts };
  const text = opts.text || "";
  if (opts.error)
    return `<div class="empty" style="color:#9db5e0;padding:80px 20px"><p style="margin:0;font-size:1rem">${esc(text)}</p></div>`;
  return `<div class="empty"><svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg><p>${text}</p></div>`;
}

/** 面板空视图（带重试提示） */
function emptyPaneHtml(text) {
  return `<div class="empty" style="padding:70px 20px"><p style="margin:0;font-size:.95rem">${esc(text)}</p><p style="font-size:.82rem;color:#7a8394;margin-top:10px">稍后重试即可恢复</p></div>`;
}

/* -------------------- 工具函数 -------------------- */

/** 生成指定长度的随机串（PKCE verifier 用） */
function randomString(len) {
  const cs =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~",
    v = new Uint8Array(len);
  crypto.getRandomValues(v);
  let s = "";
  for (let i = 0; i < len; i++) s += cs[v[i] % cs.length];
  return s;
}

/** 计算 PKCE code_challenge（S256） */
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

/** HTML 转义 */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** JS 字符串转义（用于内联 script） */
function jsStr(s) {
  return JSON.stringify(String(s == null ? "" : s))
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** 补零 */
function pad(n) {
  return String(n == null ? 0 : n).padStart(2, "0");
}

/** 相对时间格式化 */
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
    month: "numeric",
    day: "numeric",
  });
}

/** 返回 HTML 响应 */
function html(body) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

/* -------------------- 更多加载（strict 鉴权） -------------------- */

/**
 * 加载更多 API。
 * type=history  观看记录翻页
 * type=playback 继续观看翻页
 * type=watchlist 待看列表翻页（走完整 getWatchlist 缓存）
 *
 * strict: true —— 依赖用户身份。
 */
async function handleMore(request, env, ctx) {
  const url = new URL(request.url),
    type = url.searchParams.get("type"),
    page = parseInt(url.searchParams.get("page") || "2"),
    limitParam = parseInt(url.searchParams.get("limit") || "0");
  const A = await authed(request, env, ctx, { html: true, strict: true });
  if (!A.ok) return A.response;
  const { auth, headers, needsCookieUpdate, userKey } = A;

  if (type === "history") {
    let r;
    try {
      for (let i = 0; i < 3; i++) {
        r = await fetchT(
          `${TRAKT_API}/users/me/history?limit=${PAGE_SIZE}&page=${page}&extended=full&images=poster`,
          {
            headers,
          },
          9000,
        );
        if (r.status !== 429) break;
        await backoff(i, 1000, 500);
      }
    } catch (e) {
      return new Response("", { status: 502 });
    }
    if (!r.ok) return new Response("", { status: r.status });
    const items = await r.json(),
      pageCount = parseInt(r.headers.get("X-Pagination-Page-Count") || "1"),
      hasMore = page < pageCount;
    return authResp(
      auth,
      needsCookieUpdate,
      renderHistoryPage(items, env, true),
      {
        extra: {
          "X-Has-More": String(hasMore),
          "X-Page": String(page),
          "X-Page-Count": String(pageCount),
        },
      },
    );
  }

  if (type === "playback") {
    const limit = limitParam > 0 ? Math.min(limitParam, 60) : 20;
    let r;
    try {
      for (let i = 0; i < 3; i++) {
        r = await fetchT(
          `${TRAKT_API}/sync/progress/up_next_nitro?extended=full&images=poster&limit=${limit}&page=${page}&intent=continuing`,
          {
            headers,
          },
          9000,
        );
        if (r.status !== 429) break;
        await backoff(i, 1000, 500);
      }
    } catch (e) {
      return new Response("", { status: 502 });
    }
    if (!r || !r.ok)
      return new Response("", { status: (r && r.status) || 502 });
    const items = await r.json();
    const list = Array.isArray(items) ? items : [];
    const pageCount =
      parseInt(r.headers.get("X-Pagination-Page-Count") || "0") || 0;
    const hasMore = pageCount > 0 ? page < pageCount : list.length >= limit;
    return authResp(
      auth,
      needsCookieUpdate,
      renderContinueItems(list, "fragment"),
      {
        extra: {
          "X-Has-More": String(hasMore),
          "X-Page": String(page),
        },
      },
    );
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

/* -------------------- 登录页 -------------------- */

/**
 * 渲染登录页。
 *
 * 状态气泡（#status）显示策略：
 *   · 初始隐藏：style="display:none"
 *   · 202/网络错误/429/5xx → 静默重试，不动气泡
 *   · 403/410 → 显示气泡提示，停止轮询
 *   · 200 → 显示"✓ 授权成功"
 *
 * startLogin 里的 429：
 *   · 显示倒计时，N 秒后自动启用"立即重试"按钮
 */
function renderLoginPage() {
  return pageShell(
    `<div class="login-wrap"><div class="login-card"><div class="login-logo"><img src="${ICON_192}" alt="MineTrakt" width="64" height="64" style="display:block;margin:0 auto"></div><h1 class="login-title">MineTrakt</h1><p class="login-sub">首页 · 待看列表 · 追剧日历 · 观看记录</p><div id="login-area" class="login-area"><button class="btn-primary" onclick="startLogin()">使用 Trakt 登录</button></div></div></div><script>async function startLogin(){const area=document.getElementById('login-area');area.innerHTML='<div class="spinner"></div>';let r;try{r=await fetch('/auth/device');}catch(e){area.innerHTML='<div class="err-box"><p class="err-title">网络错误</p><p class="err">'+String(e)+'</p></div><button class="btn-primary" onclick="startLogin()">重试</button>';return;}if(!r.ok){const err=await r.json().catch(()=>({}));if(r.status===429||err.rateLimited){var wait=Number(err.retryAfter)||30;area.innerHTML='<div class="err-box" style="background:rgba(255,184,77,.10);border-color:rgba(255,184,77,.28)"><p class="err-title" style="color:#ffb84d">请求过于频繁</p><p class="err" style="color:#ffd693">Trakt 限流了，请 <span id="rl-count">'+wait+'</span> 秒后再试</p></div><button class="btn-primary" id="rl-btn" disabled style="opacity:.5;cursor:not-allowed">请稍候…</button>';var cnt=document.getElementById('rl-count'),btn=document.getElementById('rl-btn'),left=wait;var t=setInterval(function(){left--;if(cnt)cnt.textContent=String(left);if(left<=0){clearInterval(t);if(btn){btn.disabled=false;btn.style.opacity='';btn.style.cursor='';btn.textContent='立即重试';btn.onclick=function(){startLogin();};}}},1000);return;}area.innerHTML='<div class="err-box"><p class="err-title">获取设备码失败</p><p class="err">'+(err.error||('HTTP '+r.status))+'</p>'+(err.hint?'<p class="hint">'+err.hint+'</p>':'')+'</div><button class="btn-primary" onclick="startLogin()">重试</button>';return;}const d=await r.json(),activateUrl='https://trakt.tv/activate',qr='https://api.qrserver.com/v1/create-qr-code/?size=220x220&color=4a6db8&bgcolor=ffffff&data='+encodeURIComponent(activateUrl);area.innerHTML='<div class="device-flow"><div class="steps"><div class="step"><span class="n">1</span><span>打开 <a href="'+activateUrl+'" target="_blank" rel="noopener">trakt.tv/activate</a></span></div><div class="step"><span class="n">2</span><span>输入代码</span></div></div><div class="code-box">'+d.user_code+'</div><div class="step"><span class="n">3</span><span>点击授权</span></div><div class="qr-box"><img src="'+qr+'" alt="QR"></div><p id="status" class="status" style="display:none"></p></div><details class="log-details"><summary>调试日志</summary><div id="log" class="log-box"></div></details>';let interval=(d.interval||5)*1000,attempt=0;const logEl=document.getElementById('log'),log=(s)=>{if(logEl)logEl.innerHTML+='<div>['+new Date().toLocaleTimeString()+'] '+s+'</div>';};const tick=async()=>{attempt++;let r2;try{r2=await fetch('/auth/poll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:d.state})});}catch(e){log('网络错误');setTimeout(tick,interval);return;}if(r2.status===200){try{const st=document.getElementById('status');if(st){st.innerHTML='✓ 授权成功，正在刷新…';st.className='status success';st.style.display='';}}catch(e){}setTimeout(()=>location.reload(),400);return;}let text='';try{text=await r2.text();}catch{}let data={};try{data=JSON.parse(text);}catch{}log('HTTP '+r2.status+' · '+(data.status||data.message||'未知'));if(r2.status===202){if(data.status==='slow_down')interval+=2000;setTimeout(tick,interval);return;}if(r2.status===429){setTimeout(tick,Math.max(interval,5000));return;}if(r2.status===502||r2.status===503||r2.status===504){setTimeout(tick,Math.max(interval,3000));return;}if(r2.status===403){try{const st=document.getElementById('status');if(st){st.textContent=data.message||'授权被拒绝，请重新登录';st.className='status error';st.style.display='';}}catch(e){}return;}if(r2.status===410){try{const st=document.getElementById('status');if(st){st.textContent=data.message||'授权码已过期，请重新获取';st.className='status error';st.style.display='';}}catch(e){}return;}setTimeout(tick,interval);};setTimeout(tick,1000);}<\/script><script>(function(){try{var msg=sessionStorage.getItem('mt:relogin');if(!msg)return;sessionStorage.removeItem('mt:relogin');var area=document.getElementById('login-area');if(!area)return;var p=document.createElement('p');p.className='err';p.style.cssText='margin-bottom:14px;text-align:center';p.textContent=msg;area.parentNode.insertBefore(p,area);}catch(e){}})();<\/script>`,
  );
}

/* ============================================================
 * 段落 6 / 6：
 * 页面基础 HTML / 启动脚本 / 客户端脚本 / 样式
 * ============================================================ */

/* -------------------- 启动页 / 骨架 -------------------- */

/** 启动页 splash（黑底 + logo + 进度条） */
function renderSplash() {
  return `<div id="splash" class="splash" style="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000;background:radial-gradient(circle at 50% 45%,#0a0a0a 0%,#000000 62%)"><div class="splash-glow"></div><div class="splash-inner"><div class="splash-logo"><img src="${SPLASH_LOGO}" alt="" width="96" height="96" loading="eager" decoding="async" style="display:block;filter:drop-shadow(0 0 22px rgba(125,157,212,.55))"></div><div class="splash-name">MineTrakt</div><div class="splash-bar"><div class="splash-bar-fill"></div></div></div></div>`;
}

/* -------------------- 统计块渲染 -------------------- */

/** 渲染顶部 4 格统计（电影/剧集/集数/小时） */
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

/* -------------------- 页面头 / 尾 -------------------- */

/** 页面 <head> 早期部分（包含 splash 和关键 CSS） */
function pageHeadEarly() {
  return `<!DOCTYPE html><html lang="zh-CN" style="background:#000000"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1,user-scalable=no"><meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate"><meta http-equiv="Pragma" content="no-cache"><meta name="color-scheme" content="dark"><meta name="theme-color" content="${THEME_COLOR}"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="${APP_SHORT_NAME}"><meta name="mobile-web-app-capable" content="yes"><meta name="format-detection" content="telephone=no"><title>${APP_NAME}</title><link rel="icon" href="${FAVICON_URL}" type="image/png"><link rel="apple-touch-icon" href="${APPLE_ICON}"><link rel="manifest" href="/manifest.webmanifest"><link rel="preconnect" href="https://api.trakt.tv" crossorigin><link rel="preconnect" href="https://api.themoviedb.org" crossorigin><link rel="preconnect" href="https://image.tmdb.org" crossorigin><link rel="preload" as="script" href="/app.js?v=${APP_JS_VERSION}"><link rel="preload" href="/app.css?v=${APP_CSS_VERSION}" as="style"><link rel="stylesheet" href="/app.css?v=${APP_CSS_VERSION}"><style>${splashCriticalCss()}</style></head><body style="background:#000000;margin:0;min-height:100vh;min-height:100dvh">${renderSplash()}`;
}

/** 页面 </body> 前脚本（隐藏 splash + 注册 SW） */
function pageTail() {
  return `<script>(function(){try{if(window.__hideSplash)window.__hideSplash(true);}catch(e){}try{var s=document.getElementById('splash');if(s){s.classList.add('hide');setTimeout(function(){try{if(s&&s.parentNode)s.parentNode.removeChild(s);}catch(e){}},380);}}catch(e){}})();<\/script><script>(function(){if(!('serviceWorker' in navigator))return;if(window.__swRegistered)return;window.__swRegistered=true;var regSW=function(){navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).catch(function(){});};if(document.readyState==='complete'){setTimeout(regSW,4000);}else{window.addEventListener('load',function(){setTimeout(regSW,4000);});}})();<\/script></body></html>`;
}

/** 完整页面壳（head + body + tail） */
function pageShell(body) {
  return pageHeadEarly() + body + pageTail();
}

/* -------------------- 启动页关键 CSS -------------------- */

/** 关键路径 CSS（内联到 <head>，避免首屏闪烁） */
function splashCriticalCss() {
  return `html,body{background:#000!important;color:#eef1f7;margin:0;padding:0;min-height:100%;min-height:100dvh}
*{box-sizing:border-box}
.splash{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000;transition:opacity .18s ease;animation:splashAutoHide .18s ease .35s forwards}
.splash.hide{opacity:0;pointer-events:none;animation:none}
@keyframes splashAutoHide{to{opacity:0;visibility:hidden;pointer-events:none}}
.splash-inner{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:16px}
.splash-name{color:#a8b2c4;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;font-size:1.25rem;font-weight:800}
.spinner{width:28px;height:28px;border:3px solid #212735;border-top-color:#7d9dd4;border-radius:50%;animation:spin .8s linear infinite;margin:4px auto}
@keyframes spin{to{transform:rotate(360deg)}}
.container{max-width:1200px;margin:0 auto;padding:0 16px calc(80px + env(safe-area-inset-bottom))}
.hero{display:flex;justify-content:space-between;align-items:center;padding:calc(16px + env(safe-area-inset-top)) 0 16px;gap:12px}
.hero-left{display:flex;align-items:center;gap:12px;min-width:0}
.hero-avatar{width:48px;height:48px;border-radius:50%;overflow:hidden;flex-shrink:0;background:#16161a;border:2px solid rgba(167,139,250,.45)}
.hero-name{font-size:1.3rem;font-weight:800;color:#f4f4f5;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.updated-at{font-size:.72rem;color:#71717a;margin:0}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;background:#0e0e10;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:14px 8px;margin-bottom:20px;min-height:88px}
.tabs{display:flex;gap:4px;margin-bottom:18px}
.tab{flex:1;background:transparent;border:none;color:#a1a1aa;padding:9px 2px;border-radius:999px;font-size:.75rem;font-weight:600}
.tab.active{background:linear-gradient(135deg,#7c3aed,#a78bfa);color:#fff}
.pane{display:none}.pane.active{display:block}
.home-section{margin-bottom:20px}
.home-section-title{font-size:.95rem;font-weight:700;color:#f4f4f5;margin:0 0 10px}
.h-scroll{display:flex;gap:12px;overflow-x:auto;padding:4px 0 10px;-webkit-overflow-scrolling:touch}
.pane-loading{padding:40px 20px;text-align:center}
.btn-action{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.04);color:#a1a1aa;border:1px solid rgba(255,255,255,.08);padding:8px 12px;border-radius:10px;font-size:.8rem}
`;
}

/* ============================================================
 * getBootstrapScript —— 启动脚本
 * ------------------------------------------------------------
 * · 前端启动主逻辑：本地缓存回填 → 拉取首页数据 → 更新 UI
 * · fetchPart 支持 relogin 识别（401 时跳登录页）
 * · forceRefresh 手动刷新：串行 + 动态间隔防 429
 * ============================================================ */
function getBootstrapScript() {
  return `(function(){var __CFG=window.__HOME_CONFIG__||{};if(!__CFG.loggedIn)return;window.__HOME_CONFIG__=null;if(__CFG.initialDetail)window.__initialDetail=__CFG.initialDetail;if(!window.__splashT0)window.__splashT0=Date.now();window.__splashHidden=false;window.__hideSplash=function(force){try{if(window.__splashHidden)return;window.__splashHidden=true;var el=document.getElementById('splash');if(!el)return;var wait=force?0:Math.max(0,120-(Date.now()-(window.__splashT0||Date.now())));setTimeout(function(){try{el.classList.add('hide');setTimeout(function(){try{if(el&&el.parentNode)el.parentNode.removeChild(el);}catch(e){}},280);}catch(e){}},wait);}catch(e){}};setTimeout(function(){if(window.__hideSplash)window.__hideSplash();},80);function lsGet(k){try{var v=localStorage.getItem(k);if(!v)return null;var o=JSON.parse(v);if(o&&o._exp&&o._exp<Date.now()){try{localStorage.removeItem(k);}catch(e){}return null;}return o&&o.data?o.data:null;}catch(e){return null;}}function lsSet(k,d,ttlSec){try{localStorage.setItem(k,JSON.stringify({data:d,_exp:Date.now()+ttlSec*1000}));}catch(e){try{localStorage.removeItem(k);}catch(e2){}}}window.__lsGet=lsGet;window.__lsSet=lsSet;function setHTML(sel,html){var el=typeof sel==='string'?document.querySelector(sel):sel;if(el)el.innerHTML=html||'';}window.__setHTML=setHTML;function applyAvatar(url){if(!url)return;var av=document.getElementById('hero-avatar');if(!av)return;var img=document.createElement('img');img.src=url;img.alt='';img.width=56;img.height=56;img.decoding='async';img.onerror=function(){av.innerHTML='<span class="hero-avatar-ph">👤</span>';};av.innerHTML='';av.appendChild(img);}function __setUpdatedAt(source){var el=document.getElementById('updated-at');if(!el)return;var d=new Date(),p=function(n){return(n<10?'0':'')+n;};var label='更新于 '+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());if(source==='live')label+=' · 实时';else if(source==='cache')label+=' · 缓存';el.textContent=label;el.classList.remove('flash','src-live','src-cache');void el.offsetWidth;el.classList.add('flash');if(source==='live')el.classList.add('src-live');else if(source==='cache')el.classList.add('src-cache');}function applyPlayback(d,isCache){if(!d)return;if(d.playbackHScrollHtml)setHTML('#playback-hscroll',d.playbackHScrollHtml);var src=isCache?'cache':(d.playbackSource||'');__setUpdatedAt(src);if(window.__scheduleEnrich)window.__scheduleEnrich();}window.__applyPlayback=applyPlayback;function applyMeta(d,isCache){if(!d)return;var n=document.getElementById('hero-name');if(n&&d.name)n.textContent=d.name;applyAvatar(d.avatar);if(d.statsHtml)setHTML('#stats-box',d.statsHtml);if(!isCache)try{lsSet('mt:meta',d,1800);}catch(e){}}window.__applyMeta=applyMeta;var __homeDataLoading=false;
/* fetchPart：401 时读 relogin 跳登录页 */
function fetchPart(part,force){return fetch('/api/home-data?part='+encodeURIComponent(part)+(force?'&force=1':''),{credentials:'same-origin',cache:'no-store'}).then(function(r){if(r.status===401){return r.json().catch(function(){return{};}).then(function(d){var msg=(d&&d.error)||'登录已失效，请重新登录';try{sessionStorage.setItem('mt:relogin',msg);}catch(e){}if(window.__toast)window.__toast(msg,{type:'warn',duration:2200});setTimeout(function(){location.href='/';},1000);return null;});}if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}).then(function(d){if(!d)return null;if(d.login){location.reload();return null;}return d;});}window.__fetchPart=fetchPart;var __loadedParts={};function loadPartOnce(part){if(__loadedParts[part])return Promise.resolve(__loadedParts[part]);return fetchPart(part).then(function(d){__loadedParts[part]=d;return d;});}window.__loadPartOnce=loadPartOnce;window.__loadedParts=__loadedParts;function loadHomeData(opts){opts=opts||{};var silent=!!opts.silent;if(__homeDataLoading&&!silent)return;__homeDataLoading=true;__lastRefreshAt=Date.now();function onPlayback(d,isCache){if(!d)return;applyPlayback(d,isCache);if(!isCache){try{lsSet('mt:pb',d,900);}catch(e){}if(!silent&&window.__initialDetail){var s=window.__initialDetail,idx=s.indexOf('/');if(idx>0&&window.openDetail)openDetail(s.slice(0,idx),s.slice(idx+1),false);window.__initialDetail=null;}}if(!silent&&window.__hideSplash)window.__hideSplash(true);}if(!silent){var cachedPb=lsGet('mt:pb');if(cachedPb){try{onPlayback(cachedPb,true);}catch(e){}}else if(window.__earlyPbApplied&&window.__hideSplash){window.__hideSplash(true);}}var pPlayback;if(!silent&&window.__primaryBootP){pPlayback=window.__primaryBootP.then(function(d){window.__primaryBootP=null;if(d){onPlayback(d,false);return d;}return fetchPart('playback').then(function(x){onPlayback(x,false);return x;});}).catch(function(){return fetchPart('playback').then(function(x){onPlayback(x,false);return x;});});}else{pPlayback=fetchPart('playback').then(function(x){onPlayback(x,false);return x;});}pPlayback=pPlayback.catch(function(){if(!silent){setHTML('#playback-hscroll','<div class="empty"><p>请求过于频繁或网络异常，请稍后重试</p><p style="margin-top:12px"><button class="btn-ghost" onclick="location.reload()">重试</button></p></div>');if(window.__hideSplash)window.__hideSplash(true);}});Promise.resolve(pPlayback).then(function(){__homeDataLoading=false;if(!silent){var cachedMeta=lsGet('mt:meta');if(cachedMeta)setTimeout(function(){try{applyMeta(cachedMeta,true);}catch(e){}},0);}var runMeta=function(){fetchPart('meta').then(function(d){applyMeta(d,false);}).catch(function(){});};if(window.requestIdleCallback)requestIdleCallback(runMeta,{timeout:800});else setTimeout(runMeta,80);});}var __refreshTick=0;function silentRefresh(){if(document.hidden)return;var __m=document.getElementById('modal');if(__m&&__m.classList.contains('open'))return;__refreshTick++;__lastRefreshAt=Date.now();fetchPart('playback').then(function(d){applyPlayback(d);try{lsSet('mt:pb',d,900);}catch(e){}}).catch(function(){});if(__refreshTick%4===0)fetchPart('meta').then(function(d){applyMeta(d,false);}).catch(function(){});}window.__refreshStats=silentRefresh;
window.forceRefresh=async function(){if(window.__forceRefreshing)return;window.__forceRefreshing=true;try{localStorage.removeItem('mt:pb');localStorage.removeItem('mt:meta');}catch(e){}var btn=document.getElementById('btn-refresh');var span=btn&&btn.querySelector('span');var oldText=span?span.textContent:'刷新';if(btn)btn.classList.add('loading');if(span)span.textContent='刷新中';var okCount=0,cacheCount=0,failCount=0,cooling=0,hitLimit=false;var GAP_OK=300,GAP_LIMIT=1000;try{var wanted=['playback','meta'];var loaded=window.__loadedParts||{};['history'].forEach(function(p){if(loaded[p])wanted.push(p);});for(var i=0;i<wanted.length;i++){if(hitLimit)break;var part=wanted[i];if(i>0){var gap=cooling>0?GAP_LIMIT:GAP_OK;await new Promise(function(r){setTimeout(r,gap);});}var d=null;try{d=await fetchPart(part,true);}catch(e){d=null;}if(!d){failCount++;continue;}var isCache=false;if(part==='playback'&&d.playbackSource==='cache')isCache=true;if(part==='meta'&&d.metaSource==='cache')isCache=true;if(isCache)cacheCount++;else okCount++;if(part==='playback'){applyPlayback(d);try{lsSet('mt:pb',d,900);}catch(e){}}else if(part==='meta'){applyMeta(d,false);}else if(part==='watchlist'&&d.watchlistHtml){__setHTML('#watchlist',d.watchlistHtml);}else if(part==='calendar'&&d.calendarHtml){__setHTML('#calendar',d.calendarHtml);}else if(part==='history'){if(d.historyHtml)__setHTML('#history .grid',d.historyHtml);if(d.historyMoreHtml!=null)__setHTML('#history-more',d.historyMoreHtml);}window.__loadedParts[part]=d;if(d.rateLimited||(d.cooling&&d.cooling>0)){hitLimit=true;cooling=Math.max(cooling,Number(d.cooling)||0);}else if(isCache&&(part==='playback'||part==='meta')){hitLimit=true;}}if(failCount&&!okCount&&!cacheCount){__errToast('刷新失败',new Error('Trakt 或网络不可用'));}else if(hitLimit){var msg=cooling>0?('Trakt 限流，已展示缓存（约 '+cooling+' 秒后再试）'):'已用缓存数据（上游暂不可用）';__toast(msg,{type:'warn',duration:2200});}else if(failCount||cacheCount){__toast('已刷新（部分数据来自缓存）',{type:'warn',duration:1800});}else{__toast('已刷新',{type:'success',duration:1200});}if(window.__scheduleEnrich)window.__scheduleEnrich();}catch(e){__errToast('刷新失败',e);}finally{if(btn)btn.classList.remove('loading');if(span)span.textContent=oldText;window.__forceRefreshing=false;}};
function startHomeData(){loadHomeData({silent:false});}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',startHomeData);}else{startHomeData();}var REFRESH_MS=${HOME_AUTO_REFRESH_MINUTES}*60*1000;var __lastRefreshAt=Date.now();if(REFRESH_MS>0){setInterval(silentRefresh,REFRESH_MS);document.addEventListener('visibilitychange',function(){if(document.hidden)return;if(Date.now()-__lastRefreshAt>=REFRESH_MS)silentRefresh();});}})();`;
}

/* -------------------- 客户端主体脚本 -------------------- */

/**
 * 客户端完整脚本（bootstrap + 事件处理 + UI 逻辑）。
 * __apiJson 支持 relogin 识别。
 */
function getClientSideScripts() {
  return (
    getBootstrapScript() +
    `
function __esc(s){s=String(s==null?'':s);return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function __toast(message,opts){opts=opts||{};if(!message)return;var type=opts.type||'info';var duration=opts.duration||2600;var container=document.getElementById('toast-container');if(!container){container=document.createElement('div');container.id='toast-container';document.body.appendChild(container);}var toast=document.createElement('div');toast.className='toast toast-'+type;var icons={success:'✓',error:'✕',warn:'!',info:'i'};toast.innerHTML='<span class="toast-icon">'+(icons[type]||icons.info)+'</span><span class="toast-msg">'+__esc(message)+'</span>';container.appendChild(toast);requestAnimationFrame(function(){toast.classList.add('toast-in');});var remove=function(){if(!toast.parentNode)return;toast.classList.remove('toast-in');toast.classList.add('toast-out');setTimeout(function(){if(toast.parentNode)toast.parentNode.removeChild(toast);},260);};var timer=setTimeout(remove,duration);toast.addEventListener('click',function(){clearTimeout(timer);remove();});}window.__toast=__toast;
function __humanizeClientError(msg,cooling){msg=String(msg||'').trim();if(!msg)return'操作失败，请稍后重试';if(msg.indexOf('登录已过期')>=0||msg.indexOf('unauthorized')>=0)return'登录已过期，请重新登录';if(/限流|过于频繁|429/.test(msg)){if(cooling&&cooling>0)return'Trakt 请求过于频繁，请约 '+cooling+' 秒后再试';return'Trakt 请求过于频繁，请稍后再试';}if(/网络|timeout|abort|Failed to fetch/i.test(msg))return'网络连接失败，请检查网络后重试';if(/^HTTP\\s*5\\d{2}/i.test(msg))return'服务暂时不可用，请稍后重试';if(/^HTTP\\s*404/i.test(msg))return'未找到对应内容';if(/^HTTP\\s*403/i.test(msg))return'没有权限执行此操作';if(/^HTTP\\s*401/i.test(msg))return'登录已过期，请重新登录';if(/^HTTP\\s*\\d+/i.test(msg))return'请求失败，请稍后重试';if(/[\\u4e00-\\u9fff]/.test(msg))return msg;return msg;}function __errToast(prefix,err){var msg=(err&&err.message)?err.message:String(err||'未知错误');var cooling=err&&err.cooling;msg=__humanizeClientError(msg,cooling);var t='error';if(msg.indexOf('429')>=0||msg.indexOf('限流')>=0||msg.indexOf('频繁')>=0||msg.indexOf('冷却')>=0)t='warn';if(msg.indexOf('网络')>=0||msg.indexOf('暂时不可用')>=0)t='warn';__toast((prefix?prefix+'：':'')+msg,{type:t,duration:t==='warn'?3600:2800});}window.__errToast=__errToast;
/* __apiJson：401 relogin 时跳登录页 */
async function __apiJson(r){var data=null;try{data=await r.json();}catch(e){data=null;}if(!r.ok){if(r.status===401&&data&&data.relogin){var msg=data.error||'登录已失效，请重新登录';try{sessionStorage.setItem('mt:relogin',msg);}catch(e){}__toast(msg,{type:'warn',duration:2200});setTimeout(function(){location.href='/';},1000);var err=new Error(msg);err.relogin=true;throw err;}var msg2=(data&&data.error)||('HTTP '+r.status);var err2=new Error(__humanizeClientError(msg2,data&&data.cooling));if(data&&data.cooling!=null)err2.cooling=data.cooling;throw err2;}return data;}window.__apiJson=__apiJson;
function __confirm(opts){opts=opts||{};return new Promise(function(resolve){var modal=document.getElementById('confirm-modal');if(!modal){resolve(window.confirm(opts.message||opts.title||'确认操作'));return;}var iconEl=document.getElementById('confirm-icon'),titleEl=document.getElementById('confirm-title'),msgEl=document.getElementById('confirm-msg'),okBtn=document.getElementById('confirm-ok'),cancelBtn=document.getElementById('confirm-cancel'),backdrop=modal.querySelector('.confirm-backdrop');iconEl.className='confirm-icon'+(opts.tone?' '+opts.tone:'');iconEl.textContent=opts.icon||'?';titleEl.textContent=opts.title||'确认操作';msgEl.textContent=opts.message||'';msgEl.style.display=opts.message?'':'none';okBtn.textContent=opts.okText||'确定';cancelBtn.textContent=opts.cancelText||'取消';okBtn.className='confirm-btn confirm-ok'+(opts.tone==='danger'?' danger':'');var settled=false;function cleanup(){okBtn.removeEventListener('click',onOk);cancelBtn.removeEventListener('click',onCancel);backdrop.removeEventListener('click',onCancel);document.removeEventListener('keydown',onKey,true);modal.classList.remove('open');modal.style.display='none';}function finish(v){if(settled)return;settled=true;cleanup();resolve(v);}function onOk(){finish(true);}function onCancel(){finish(false);}function onKey(e){if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish(false);}}okBtn.addEventListener('click',onOk);cancelBtn.addEventListener('click',onCancel);backdrop.addEventListener('click',onCancel);document.addEventListener('keydown',onKey,true);modal.style.display='block';modal.classList.add('open');setTimeout(function(){try{okBtn.focus();}catch(err){}},40);});}window.__confirm=__confirm;
function __fadeRemoveCard(card){if(!card)return;card.style.transition='opacity 0.25s ease, transform 0.25s ease';card.style.opacity='0';card.style.transform='scale(0.96)';setTimeout(function(){var day=card.closest('.day'),pane=card.closest('.pane');card.remove();if(day&&!day.querySelector('.item')){day.style.transition='opacity 0.2s ease';day.style.opacity='0';setTimeout(function(){if(day.parentNode)day.remove();__maybeShowEmpty(pane);if(window.__refreshStats)window.__refreshStats();},200);return;}__maybeShowEmpty(pane);if(window.__refreshStats)window.__refreshStats();},260);}
function __maybeShowEmpty(pane){if(!pane)return;setTimeout(function(){if(pane.querySelector('.item'))return;if(pane.querySelector('.empty'))return;var grid=pane.querySelector('.grid');if(!grid)return;var pid=pane.id,txt='这里暂时没有内容';if(pid==='playback')txt='暂时没有继续观看的内容';else if(pid==='watchlist')txt='待看列表是空的';else if(pid==='calendar')txt='未来 30 天没有待播剧集';else if(pid==='history')txt='还没有观看记录';grid.innerHTML='<div class="empty"><p>'+txt+'</p></div>';},120);}
document.querySelectorAll('.tab').forEach(t=>{t.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.pane').forEach(x=>x.classList.remove('active'));t.classList.add('active');var tabName=t.dataset.tab,pane=document.getElementById(tabName);if(pane)pane.classList.add('active');if(tabName==='search'){setTimeout(function(){var inp=document.getElementById('search-input');if(inp)inp.focus();if(inp&&!inp.value.trim()&&window.__loadTrending)window.__loadTrending();},60);return;}if(tabName==='playback')return;var partMap={watchlist:'watchlist',calendar:'calendar',history:'history'};var part=partMap[tabName];if(!part)return;var loaded=window.__loadedParts||{};if(loaded[part])return;window.__loadPartOnce(part).then(function(d){if(!d)return;if(part==='watchlist'){if(d.watchlistHtml)__setHTML('#watchlist',d.watchlistHtml);}else if(part==='calendar'){if(d.calendarHtml){__setHTML('#calendar',d.calendarHtml);try{var dropped=JSON.parse(localStorage.getItem('mt:dropped')||'[]');if(Array.isArray(dropped)&&dropped.length){var cal=document.getElementById('calendar');if(cal)dropped.forEach(function(did){cal.querySelectorAll('[data-drop-show-id="'+did+'"]').forEach(function(b){var card=b.closest('.item');if(card){var day=card.closest('.day');card.remove();if(day&&!day.querySelector('.item'))day.remove();}});});}}catch(e){}}}else if(part==='history'){if(d.historyHtml)__setHTML('#history .grid',d.historyHtml);if(d.historyMoreHtml!=null)__setHTML('#history-more',d.historyMoreHtml);}if(window.__scheduleEnrich)window.__scheduleEnrich();}).catch(function(){var p=document.getElementById(tabName);if(p)p.innerHTML='<div class="empty"><p>加载失败，请稍后重试</p></div>';});});});
async function logout(){if(!(await __confirm({icon:'🚪',title:'退出登录',message:'确定要退出当前 Trakt 账号吗？',okText:'退出',cancelText:'取消',tone:'warn'})))return;try{localStorage.removeItem('mt:pb');localStorage.removeItem('mt:meta');}catch(e){}await fetch('/auth/logout',{method:'POST'});location.reload();}
window.logout=logout;
async function loadMoreHistory(btn){const page=parseInt(btn.dataset.page||'2');btn.disabled=true;btn.textContent='加载中…';try{const r=await fetch('/api/more?type=history&page='+page);if(!r.ok)throw new Error('HTTP '+r.status);const htmlText=await r.text();document.querySelector('#history .grid').insertAdjacentHTML('beforeend',htmlText);if(window.__scheduleEnrich)window.__scheduleEnrich();const hasMore=r.headers.get('X-Has-More')==='true';if(hasMore){btn.dataset.page=page+1;btn.disabled=false;btn.textContent='加载更多';}else{btn.textContent='已经到底啦';btn.disabled=true;btn.style.opacity='0.5';btn.style.cursor='default';}}catch(e){btn.textContent='加载失败，点击重试';btn.disabled=false;}}
window.loadMoreHistory=loadMoreHistory;
async function onWatchlistSortChange(sort){const grid=document.getElementById('watchlist-grid'),pane=document.getElementById('watchlist');if(grid)grid.innerHTML='<div class="pane-loading"><div class="spinner"></div></div>';const oldMore=pane?pane.querySelector('.load-more-wrap'):null;if(oldMore)oldMore.remove();try{const r=await fetch('/api/more?type=watchlist&page=1&sort='+encodeURIComponent(sort));if(!r.ok)throw new Error('HTTP '+r.status);const htmlText=await r.text();if(grid)grid.innerHTML=htmlText||emptyWatchlistInner();const hasMore=r.headers.get('X-Has-More')==='true';if(hasMore&&pane&&grid){const wrap=document.createElement('div');wrap.className='load-more-wrap';wrap.innerHTML='<button class="load-more" data-page="2" data-sort="'+sort+'" onclick="loadMoreWatchlist(this)">加载更多</button>';pane.appendChild(wrap);}if(window.__scheduleEnrich)window.__scheduleEnrich();}catch(e){if(grid)grid.innerHTML='<div class="empty"><p>加载失败</p></div>';}}
window.onWatchlistSortChange=onWatchlistSortChange;
function emptyWatchlistInner(){return '<div class="empty"><p>待看列表是空的</p></div>';}
async function loadMoreWatchlist(btn){const page=parseInt(btn.dataset.page||'2'),sort=btn.dataset.sort||(document.getElementById('wl-sort')&&document.getElementById('wl-sort').value)||'added';btn.disabled=true;btn.textContent='加载中…';try{const r=await fetch('/api/more?type=watchlist&page='+page+'&sort='+encodeURIComponent(sort));if(!r.ok)throw new Error('HTTP '+r.status);const htmlText=await r.text();const grid=document.getElementById('watchlist-grid');if(grid)grid.insertAdjacentHTML('beforeend',htmlText);if(window.__scheduleEnrich)window.__scheduleEnrich();const hasMore=r.headers.get('X-Has-More')==='true';if(hasMore){btn.dataset.page=page+1;btn.disabled=false;btn.textContent='加载更多';}else{btn.textContent='已经到底啦';btn.disabled=true;btn.style.opacity='0.5';btn.style.cursor='default';}}catch(e){btn.textContent='加载失败，点击重试';btn.disabled=false;}}
window.loadMoreWatchlist=loadMoreWatchlist;
document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-wl-remove-id]');if(!btn)return;e.preventDefault();e.stopPropagation();if(btn.disabled)return;const type=btn.dataset.wlRemoveType,id=btn.dataset.wlRemoveId;if(!type||!id)return;const item=btn.closest('.item'),nameEl=item?item.querySelector('.name'):null,name=nameEl?nameEl.textContent:'';if(!(await __confirm({icon:'🗑',title:'移除待看',message:'确定要把「'+(name||'该条目')+'」从待看列表移除吗？',okText:'移除',tone:'danger'})))return;const prevText=btn.textContent;btn.disabled=true;btn.textContent='…';try{const r=await fetch('/api/watchlist/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,id})});if(!r.ok)throw new Error('HTTP '+r.status);__fadeRemoveCard(btn.closest('.item'));__toast('已从待看列表移除',{type:'success'});}catch(err){btn.disabled=false;btn.textContent=prevText;__errToast('移除失败',err);}},true);
document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-drop-show-id]');if(!btn)return;e.preventDefault();e.stopPropagation();if(btn.disabled)return;const id=btn.dataset.dropShowId;if(!id)return;const item=btn.closest('.item'),nameEl=item?item.querySelector('.name'):null,name=nameEl?nameEl.textContent.trim():'';if(!(await __confirm({icon:'🗑',title:'弃看剧集',message:'确定要弃看「'+(name||'该剧')+'」吗？它将从追剧日历和继续观看中移除，观看历史会保留。',okText:'弃看',tone:'danger'})))return;btn.disabled=true;btn.style.opacity='0.5';try{const r=await fetch('/api/drop-show',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:Number(id)})});if(!r.ok){const t=await r.text().catch(()=>'');throw new Error('HTTP '+r.status+(t?' '+t:''));}try{var ds=JSON.parse(localStorage.getItem('mt:dropped')||'[]');if(!Array.isArray(ds))ds=[];if(ds.indexOf(String(id))<0)ds.push(String(id));localStorage.setItem('mt:dropped',JSON.stringify(ds.slice(-200)));}catch(e){}const pane=document.getElementById('calendar')||document;const cards=pane.querySelectorAll('[data-drop-show-id="'+id+'"]');cards.forEach(function(b){const card=b.closest('.item');if(card)__fadeRemoveCard(card);});__toast('已弃看该剧集',{type:'success'});if(window.__loadedParts){delete window.__loadedParts.calendar;delete window.__loadedParts.playback;delete window.__loadedParts.all;}try{fetch('/api/home-data?part=calendar',{credentials:'same-origin',cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).then(function(d){if(!d||!d.calendarHtml)return;var cal=document.getElementById('calendar');if(!cal)return;cal.innerHTML=d.calendarHtml;try{var dropped=JSON.parse(localStorage.getItem('mt:dropped')||'[]');if(Array.isArray(dropped)&&dropped.length){dropped.forEach(function(did){cal.querySelectorAll('[data-drop-show-id="'+did+'"]').forEach(function(b){var card=b.closest('.item');if(card){var day=card.closest('.day');card.remove();if(day&&!day.querySelector('.item'))day.remove();}});});}}catch(e){}if(window.__scheduleEnrich)window.__scheduleEnrich();}).catch(function(){});}catch(e){}}catch(err){btn.disabled=false;btn.style.opacity='';__errToast('弃看失败',err);}},true);
document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-watched-id]');if(!btn)return;e.preventDefault();e.stopPropagation();if(btn.disabled)return;const type=btn.dataset.watchedType,id=btn.dataset.watchedId;if(!type||!id)return;const item=btn.closest('.item'),nameEl=item?item.querySelector('.name'):null,name=nameEl?nameEl.textContent:'';if(!(await __confirm({icon:'✓',title:'标记为已观看',message:'确定要把「'+(name||'该条目')+'」标记为已观看吗？',okText:'标记',tone:'success'})))return;const prev=btn.textContent;btn.disabled=true;btn.textContent='…';try{const r=await fetch('/api/mark-watched',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,id})});if(!r.ok)throw new Error('HTTP '+r.status);__fadeRemoveCard(btn.closest('.item'));__toast('已标记为已观看',{type:'success'});}catch(err){btn.disabled=false;btn.textContent=prev;__errToast('标记失败',err);}},true);
document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-unwatch-id]');if(!btn)return;e.preventDefault();e.stopPropagation();if(btn.disabled)return;const type=btn.dataset.unwatchType,id=btn.dataset.unwatchId;if(!type||!id)return;const item=btn.closest('.item'),nameEl=item?item.querySelector('.name'):null,name=nameEl?nameEl.textContent:'';if(!(await __confirm({icon:'↺',title:'取消观看',message:'确定要取消「'+(name||'该条目')+'」的观看记录吗？',okText:'取消观看',tone:'warn'})))return;const prev=btn.textContent;btn.disabled=true;btn.textContent='…';try{const r=await fetch('/api/unmark-watched',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,id})});if(!r.ok)throw new Error('HTTP '+r.status);__fadeRemoveCard(btn.closest('.item'));__toast('已取消观看记录',{type:'success'});}catch(err){btn.disabled=false;btn.textContent=prev;__errToast('取消失败',err);}},true);
var __searchTimer=null,__searchSeq=0;
function __renderSearchItem(it){var emoji=it.type==='movie'?'🎬':'📺';var poster=it.poster?'<img src="'+__esc(it.poster)+'" loading="lazy" alt="">':'<div class="poster-ph"><span>'+emoji+'</span></div>';var tag=it.type==='movie'?'电影':'剧集';var ov=it.overview?'<div class="overview">'+__esc(it.overview)+'</div>':'';return '<div class="item clickable" data-detail-type="'+it.type+'" data-detail-id="tmdb-'+it.tmdbId+'" role="button" tabindex="0"><div class="poster">'+poster+'</div><div class="info"><div class="name-row"><span class="name">'+__esc(it.title)+'</span></div><div class="meta">'+tag+(it.year?' · '+__esc(String(it.year)):'')+'</div>'+ov+'</div></div>';}
async function __doSearch(q){var box=document.getElementById('search-results');if(!box)return;if(!q){__loadTrending();return;}var seq=++__searchSeq;box.innerHTML='<div class="pane-loading"><div class="spinner"></div></div>';try{var r=await fetch('/api/search?q='+encodeURIComponent(q));if(seq!==__searchSeq)return;if(!r.ok)throw new Error('HTTP '+r.status);var data=await r.json();if(seq!==__searchSeq)return;var items=(data&&data.items)||[];if(!items.length){box.innerHTML='<div class="empty"><p>没有找到相关结果</p></div>';return;}box.innerHTML=items.map(__renderSearchItem).join('');}catch(err){if(seq!==__searchSeq)return;box.innerHTML='<div class="empty"><p>搜索失败：'+__esc(err.message)+'</p></div>';}}
var __trendingLoaded=false;
async function __loadTrending(force){var box=document.getElementById('search-results');if(!box)return;var inp=document.getElementById('search-input');if(inp&&inp.value.trim())return;if(box.querySelector('.trending-head')&&!force)return;box.innerHTML='<div class="pane-loading"><div class="spinner"></div></div>';try{var r=await fetch('/api/trending');if(!r.ok)throw new Error('HTTP '+r.status);var data=await r.json();var items=(data&&data.items)||[];if(!items.length){box.innerHTML='<div class="empty"><p>暂无趋势内容</p></div>';return;}__trendingLoaded=true;box.innerHTML='<div class="trending-head">TMDB 今日趋势</div>'+items.map(__renderSearchItem).join('');}catch(err){box.innerHTML='<div class="empty"><p>趋势加载失败：'+__esc(err.message)+'</p></div>';}}
window.__loadTrending=__loadTrending;
(function(){var inp=document.getElementById('search-input');if(!inp)return;inp.addEventListener('input',function(){if(__searchTimer)clearTimeout(__searchTimer);var q=inp.value.trim();if(!q){__loadTrending();return;}__searchTimer=setTimeout(function(){__doSearch(q);},380);});inp.addEventListener('keydown',function(e){if(e.key==='Enter'){if(__searchTimer)clearTimeout(__searchTimer);var q=inp.value.trim();if(q)__doSearch(q);else __loadTrending(true);}});})();
document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-wl-add-detail]');if(!btn)return;e.preventDefault();e.stopPropagation();if(btn.disabled)return;const type=btn.dataset.wlAddDetailType,tmdbId=btn.dataset.wlAddDetail;if(!type||!tmdbId)return;const nameEl=document.querySelector('.detail-title');const name=nameEl?nameEl.textContent:'';if(!(await __confirm({icon:'＋',title:'加入待看',message:'确定要把「'+(name||'该条目')+'」加入待看列表吗？',okText:'加入',tone:'success'})))return;const prev=btn.textContent;btn.disabled=true;btn.textContent='…';try{const r=await fetch('/api/watchlist/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,tmdbId})});let errMsg='';if(!r.ok){try{const j=await r.json();errMsg=(j&&(j.error||j.message))||('HTTP '+r.status);}catch(e){errMsg='HTTP '+r.status;}throw new Error(errMsg);}const span=document.createElement('span');span.className='d-watchlist-badge';span.textContent='✓ 已在待看';btn.replaceWith(span);__toast('已加入待看列表',{type:'success'});if(document.getElementById('watchlist-grid')&&typeof onWatchlistSortChange==='function'){const sort=(document.getElementById('wl-sort')&&document.getElementById('wl-sort').value)||'added';onWatchlistSortChange(sort);}if(window.__refreshStats)window.__refreshStats();}catch(err){btn.disabled=false;btn.textContent=prev;__errToast('加入失败',err);}},true);
var __listModalSections={playback:{title:'继续观看'},theater:{title:'平台剧场',section:'theater'},'douban-domestic':{title:'豆瓣热播国产剧',section:'domestic'},'douban-hktw':{title:'豆瓣热播港台剧',section:'hktw'},'douban-jpkr':{title:'豆瓣热播日韩剧',section:'jpkr'},'douban-western':{title:'豆瓣热播欧美剧',section:'western'}};
window.openListModal=function(id){var cfg=__listModalSections[id];if(!cfg)return;var modal=document.getElementById('list-modal');var title=document.getElementById('list-modal-title');var body=document.getElementById('list-modal-body');if(!modal||!title||!body)return;title.textContent=cfg.title||'';body.innerHTML='<div class="pane-loading"><div class="spinner"></div></div>';modal.classList.add('open');document.body.style.overflow='hidden';if(id==='playback'){fetch('/api/more?type=playback&page=1&limit=60&mode=grid').then(function(r){return r.ok?r.text():'';}).then(function(html){if(html)body.innerHTML='<div class="grid">'+html+'</div>';else body.innerHTML='<div class="empty"><p>暂无内容</p></div>';if(window.__scheduleEnrich)window.__scheduleEnrich();}).catch(function(){body.innerHTML='<div class="empty"><p>加载失败</p></div>';});return;}if(id==='theater'){body.innerHTML='<div id="theater-filter-tabs" class="douban-filter-tabs" style="display:none"></div><div id="theater-grid" class="grid"><div class="pane-loading"><div class="spinner"></div></div></div>';var tgrid=document.getElementById('theater-grid'),tabsBox=document.getElementById('theater-filter-tabs');function loadTheater(platform){tgrid.innerHTML='<div class="pane-loading"><div class="spinner"></div></div>';fetch('/api/theater-list?platform='+encodeURIComponent(platform)+'&mode=grid').then(function(r){return r.ok?r.text():'';}).then(function(html){tgrid.innerHTML=html||'<div class="empty"><p>暂无内容</p></div>';if(window.__scheduleEnrich)window.__scheduleEnrich();}).catch(function(){tgrid.innerHTML='<div class="empty"><p>加载失败</p></div>';});}loadTheater('all');fetch('/api/theater-list?mode=platforms').then(function(r){return r.ok?r.json():{platforms:[]};}).then(function(d){var platforms=(d&&d.platforms)||[];if(!platforms.length)return;var html='<button class="douban-filter-tab active" data-platform="all">全部</button>';platforms.forEach(function(p){html+='<button class="douban-filter-tab" data-platform="'+__esc(p)+'">'+__esc(p)+'</button>';});tabsBox.innerHTML=html;tabsBox.style.display='';tabsBox.querySelectorAll('.douban-filter-tab').forEach(function(btn){btn.addEventListener('click',function(){tabsBox.querySelectorAll('.douban-filter-tab').forEach(function(b){b.classList.remove('active');});btn.classList.add('active');loadTheater(btn.dataset.platform);});});}).catch(function(){});return;}var section=cfg.section;body.innerHTML='<div id="douban-modal-grid" class="grid"><div class="pane-loading"><div class="spinner"></div></div></div>';var grid=document.getElementById('douban-modal-grid');fetch('/api/douban-list?section='+encodeURIComponent(section)+'&mode=grid').then(function(r){return r.ok?r.text():'';}).then(function(html){if(html)grid.innerHTML=html;else grid.innerHTML='<div class="empty"><p>暂无内容</p></div>';if(window.__scheduleEnrich)window.__scheduleEnrich();}).catch(function(){grid.innerHTML='<div class="empty"><p>加载失败</p></div>';});};
window.closeListModal=function(){var modal=document.getElementById('list-modal');if(!modal)return;modal.classList.remove('open');document.body.style.overflow='';};
document.addEventListener('keydown',function(e){if(e.key==='Escape'){var m=document.getElementById('list-modal');if(m&&m.classList.contains('open')){window.closeListModal();return;}}});
async function loadTheaterHScroll(platform){platform=platform||'all';var el=document.getElementById('theater-hscroll');if(!el)return;el.innerHTML='<div class="pane-loading"><div class="spinner"></div></div>';try{var r=await fetch('/api/theater-list?mode=hscroll&platform='+encodeURIComponent(platform));var html=r.ok?await r.text():'';var tmp=document.createElement('div');tmp.innerHTML=html;var inner=tmp.querySelector('.h-scroll');if(inner)el.innerHTML=inner.innerHTML;else if(html)el.innerHTML=html;else el.innerHTML='<div class="h-scroll-empty"><span class="spinner"></span></div>';if(window.__scheduleEnrich)window.__scheduleEnrich();}catch(e){el.innerHTML='<div class="h-scroll-empty"><p>加载失败</p></div>';}}
async function loadTheaterHomeTabs(){var tabsBox=document.getElementById('theater-home-tabs');if(!tabsBox||tabsBox.dataset.loaded==='1')return;try{var r=await fetch('/api/theater-list?mode=platforms');var d=r.ok?await r.json():{platforms:[]};var platforms=(d&&d.platforms)||[];if(!platforms.length)return;var html='<button class="theater-filter-tab active" data-platform="all">全部</button>';for(var i=0;i<platforms.length;i++){var p=platforms[i];html+='<button class="theater-filter-tab" data-platform="'+__esc(p)+'">'+__esc(p)+'</button>';}tabsBox.innerHTML=html;tabsBox.style.display='';tabsBox.dataset.loaded='1';tabsBox.addEventListener('click',function(e){var btn=e.target.closest('.theater-filter-tab');if(!btn)return;tabsBox.querySelectorAll('.theater-filter-tab').forEach(function(b){b.classList.remove('active');});btn.classList.add('active');loadTheaterHScroll(btn.dataset.platform);});}catch(e){}}
(function(){var sections=[['douban-domestic','domestic'],['douban-hktw','hktw'],['douban-jpkr','jpkr'],['douban-western','western']];function loadOne(id,section){var el=document.getElementById(id+'-hscroll');if(!el)return;fetch('/api/douban-list?section='+section+'&mode=hscroll').then(function(r){return r.ok?r.text():'';}).then(function(html){if(html)el.outerHTML=html.replace('class="h-scroll"','class="h-scroll" id="'+id+'-hscroll"');if(window.__scheduleEnrich)window.__scheduleEnrich();}).catch(function(){});}function start(){sections.forEach(function(pair){loadOne(pair[0],pair[1]);});loadTheaterHScroll('all');loadTheaterHomeTabs();}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();window.__reloadDoubanSections=start;})();
let modalLoadingId=0;window.__lastDetailType=null;window.__lastDetailId=null;async function openDetail(type,id,push=true){const modal=document.getElementById('modal'),body=document.getElementById('modal-body');if(!modal||!body)return;window.__lastDetailType=type;window.__lastDetailId=id;modal.classList.add('open');document.body.style.overflow='hidden';if(push&&location.pathname!=='/detail/'+type+'/'+id)history.pushState({detail:true},'','/detail/'+type+'/'+id);const reqId=++modalLoadingId;body.innerHTML='<div class="modal-loading"><div class="spinner"></div></div>';body.scrollTop=0;try{const r=await fetch('/api/detail?type='+encodeURIComponent(type)+'&id='+encodeURIComponent(id));if(reqId!==modalLoadingId)return;if(!r.ok)throw new Error('HTTP '+r.status);body.innerHTML=await r.text();if(window.__detailDeferLoad)window.__detailDeferLoad(type);}catch(e){if(reqId!==modalLoadingId)return;body.innerHTML='<div class="modal-error"><p>加载失败，请稍后重试</p><button class="btn-ghost" type="button" style="margin-top:14px" onclick="window.__retryDetail&&window.__retryDetail()">重试</button></div>';}}window.openDetail=openDetail;
window.__retryDetail=function(){if(window.__lastDetailType&&window.__lastDetailId)openDetail(window.__lastDetailType,window.__lastDetailId,false);};
function __loadSeasonBody(body,head){if(!body||!head)return;if(body.dataset.loaded||body.dataset.loading)return;body.dataset.loading='1';body.innerHTML='<div class="modal-loading" style="padding:24px"><div class="spinner"></div></div>';fetch('/api/season?show='+encodeURIComponent(head.dataset.show||'')+'&season='+encodeURIComponent(head.dataset.season)+'&tmdb='+encodeURIComponent(head.dataset.tmdb)+'&slug='+encodeURIComponent(head.dataset.slug||'')).then(function(r){return r.ok?r.text():'';}).then(function(html){body.innerHTML=html;body.dataset.loaded='1';delete body.dataset.loading;}).catch(function(){body.innerHTML='<div class="modal-error" style="padding:20px">加载失败</div>';delete body.dataset.loading;});}
window.__detailDeferLoad=function(type){var wrap=document.getElementById('modal-body');if(!wrap)return;var root=wrap.querySelector('.detail-wrap')||wrap;var tmdbId=root.dataset.tmdbId||'';var imdbId=root.dataset.imdbId||'';var firstOpen=wrap.querySelector('.season-item.open .season-body');if(firstOpen&&!firstOpen.dataset.loaded&&!firstOpen.dataset.loading){var head=firstOpen.closest('.season-item').querySelector('.season-head');if(head)__loadSeasonBody(firstOpen,head);}var placeholders=wrap.querySelectorAll('[data-defer-section]');if(!placeholders.length)return;var url='/api/detail-extras?type='+encodeURIComponent(type)+'&tmdb='+encodeURIComponent(tmdbId)+'&imdb='+encodeURIComponent(imdbId);fetch(url,{credentials:'same-origin'}).then(function(r){return r.ok?r.json():null;}).then(function(data){if(!data)return;placeholders.forEach(function(el){var section=el.dataset.deferSection;var html=data[section+'Html']||'';if(section==='ratings'){if(html)el.innerHTML=html;else el.parentNode&&el.remove();return;}var parent=el.closest('.d-section')||el;if(!html){if(section==='trailers'){el.innerHTML='<p class="person-sub" style="padding:8px 0;color:#71717a;font-size:.85rem">暂无预告片</p>';el.removeAttribute('data-defer-section');}else{parent.style.display='none';}return;}el.innerHTML=html;el.removeAttribute('data-defer-section');});if(window.__scheduleEnrich)window.__scheduleEnrich();}).catch(function(){placeholders.forEach(function(el){if(el.dataset.deferSection==='ratings'){el.parentNode&&el.remove();return;}var parent=el.closest('.d-section')||el;parent.style.display='none';});});};
function closeDetail(push=true){const modal=document.getElementById('modal');if(!modal)return;if(push&&location.pathname.startsWith('/detail/')){history.back();return;}modal.classList.remove('open');document.body.style.overflow='';}window.closeDetail=closeDetail;
document.addEventListener('click',(e)=>{const el=e.target.closest('[data-detail-type]');if(!el)return;const t=el.dataset.detailType,i=el.dataset.detailId;if(!t||!i)return;if(e.target.closest('button,a,.ep-watch-btn,.d-mark-btn,.d-watchlist-btn,.poster-play,.cal-open-btn,.cal-drop-btn'))return;e.preventDefault();openDetail(t,i);});
document.addEventListener('click',(e)=>{const mb=document.getElementById('modal-body');if(!mb||!mb.contains(e.target))return;const inner=e.target.closest('.detail-hero');if(!inner)return;if(e.target.closest('button,a,.item,.episode,.season-head'))return;const rect=inner.getBoundingClientRect();const y=e.clientY-rect.top;if(y<70)closeDetail();},true);
document.addEventListener('keydown',(e)=>{if(e.key!=='Escape')return;const sc=document.getElementById('show-cal-modal');if(sc&&sc.classList.contains('open')){closeShowCal();return;}closeDetail();});
document.addEventListener('click',(e)=>{const head=e.target.closest('.season-head');if(!head)return;toggleSeason(head);});
document.addEventListener('click',(e)=>{const ep=e.target.closest('.episode');if(!ep)return;const url=ep.dataset.traktUrl;if(!url)return;if(e.target.closest('.ep-watch-btn'))return;e.preventDefault();e.stopPropagation();window.open(url,'_blank','noopener');});
async function toggleSeason(headEl){if(!headEl)return;const item=headEl.closest('.season-item');if(!item)return;const body=item.querySelector('.season-body');if(!body)return;if(item.classList.contains('open')){item.classList.remove('open');return;}item.classList.add('open');if(body.dataset.loaded)return;__loadSeasonBody(body,headEl);}
window.addEventListener('popstate',()=>{const path=location.pathname;if(path.startsWith('/detail/')){const parts=path.split('/').filter(Boolean);if(parts.length===3)openDetail(parts[1],parts[2],false);}else{closeDetail(false);}});
const __prefetched=new Set();
function __prefetchDetail(type,id){if(!type||!id)return;const key=type+'/'+id;if(__prefetched.has(key))return;if(__prefetched.size>=60){const first=__prefetched.values().next().value;if(first!==undefined)__prefetched.delete(first);}__prefetched.add(key);fetch('/api/detail?type='+encodeURIComponent(type)+'&id='+encodeURIComponent(id),{cache:'default'}).catch(()=>{});}
document.addEventListener('touchstart',(e)=>{const el=e.target.closest('[data-detail-type]');if(el)__prefetchDetail(el.dataset.detailType,el.dataset.detailId);},{passive:true,capture:true});
var __showCal={byDay:{},year:0,month:0};
function __pad2(n){return(n<10?'0':'')+n;}
function __escShowCal(s){s=String(s==null?'':s);return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function __bjDay(iso){if(!iso)return '';var d=new Date(new Date(iso).getTime()+8*3600*1000);return d.getUTCFullYear()+'-'+__pad2(d.getUTCMonth()+1)+'-'+__pad2(d.getUTCDate());}
function openShowCalendar(showId,showName,tmdbId){var modal=document.getElementById('show-cal-modal'),nameEl=document.getElementById('show-cal-name'),infoEl=document.getElementById('show-cal-info'),gridEl=document.getElementById('show-cal-grid'),detailEl=document.getElementById('show-cal-detail');if(!modal||!gridEl)return;var now=new Date();__showCal.year=now.getFullYear();__showCal.month=now.getMonth();__showCal.byDay={};modal.classList.add('open');nameEl.textContent=showName||'';infoEl.textContent='正在加载…';gridEl.innerHTML='<div class="modal-loading" style="grid-column:1/-1;padding:40px 10px"><div class="spinner"></div></div>';detailEl.innerHTML='';renderShowCal();var apiUrl='/api/show-calendar?id='+encodeURIComponent(showId);if(tmdbId)apiUrl+='&tmdb='+encodeURIComponent(tmdbId);fetch(apiUrl).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}).then(function(data){if(data&&data.title)nameEl.textContent=data.title;var map={},eps=(data&&data.episodes)||[];for(var i=0;i<eps.length;i++){var ep=eps[i],day=__bjDay(ep.first_aired);if(!day)continue;if(!map[day])map[day]=[];map[day].push(ep);}__showCal.byDay=map;if(!eps.length){infoEl.textContent='暂无播出记录';}else{var keys=Object.keys(map).sort(),minLabel=keys[0].slice(0,7),maxLabel=keys[keys.length-1].slice(0,7);infoEl.textContent='共 '+keys.length+' 天有更新 · '+minLabel+' ~ '+maxLabel+'（点 ◀ ▶ 翻月）';}renderShowCal();}).catch(function(){infoEl.textContent='加载失败';gridEl.innerHTML='<div class="modal-error" style="grid-column:1/-1;padding:40px 10px">加载失败</div>';});}
function closeShowCal(){var modal=document.getElementById('show-cal-modal');if(modal)modal.classList.remove('open');}window.closeShowCal=closeShowCal;
function calShiftMonth(delta){var m=__showCal.month+delta,y=__showCal.year;while(m<0){m+=12;y--;}while(m>11){m-=12;y++;}__showCal.month=m;__showCal.year=y;renderShowCal();}window.calShiftMonth=calShiftMonth;
function renderShowCal(){var titleEl=document.getElementById('show-cal-month'),gridEl=document.getElementById('show-cal-grid'),detailEl=document.getElementById('show-cal-detail');if(!titleEl||!gridEl)return;var y=__showCal.year,m=__showCal.month;titleEl.textContent=y+' 年 '+(m+1)+' 月';var firstDow=new Date(Date.UTC(y,m,1)).getUTCDay(),daysInMonth=new Date(Date.UTC(y,m+1,0)).getUTCDate(),todayStr=__bjDay(new Date().toISOString()),html='',i;for(i=0;i<firstDow;i++){html+='<div class="sc-day sc-empty"></div>';}for(var d=1;d<=daysInMonth;d++){var dayStr=y+'-'+__pad2(m+1)+'-'+__pad2(d),eps=__showCal.byDay[dayStr]||[],cls='sc-day';if(eps.length){if(dayStr===todayStr)cls+=' sc-has sc-today-day';else if(dayStr<todayStr)cls+=' sc-has sc-past';else cls+=' sc-has sc-future';}var badge=eps.length?'<span class="sc-badge">'+eps.length+'</span>':'';html+='<div class="'+cls+'" data-day="'+dayStr+'"><span class="sc-num">'+d+'</span>'+badge+'</div>';}gridEl.innerHTML=html;detailEl.innerHTML='';var days=gridEl.querySelectorAll('.sc-day[data-day]');for(var j=0;j<days.length;j++){(function(el){el.addEventListener('click',function(){var day=el.getAttribute('data-day'),arr=__showCal.byDay[day]||[];if(!arr.length)return;var all=gridEl.querySelectorAll('.sc-day');for(var q=0;q<all.length;q++)all[q].classList.remove('sc-active');el.classList.add('sc-active');var dh='';for(var e=0;e<arr.length;e++){var ep=arr[e];dh+='<div class="sc-ep"><span class="sc-ep-tag">S'+__pad2(ep.season)+'E'+__pad2(ep.number)+'</span><span class="sc-ep-title">'+__escShowCal(ep.title||'')+'</span></div>';}detailEl.innerHTML=dh;});})(days[j]);}}
document.addEventListener('click',function(e){var btn=e.target.closest('[data-cal-show-id]');if(!btn)return;e.preventDefault();e.stopPropagation();openShowCalendar(btn.getAttribute('data-cal-show-id'),btn.getAttribute('data-cal-show-name')||'',btn.getAttribute('data-cal-show-tmdb')||'');},true);
document.addEventListener('click',async(e)=>{const btn=e.target.closest('.ep-watch-btn');if(!btn)return;e.preventDefault();e.stopPropagation();const episodeId=btn.dataset.episodeId;if(!episodeId)return;if(!(await __confirm({icon:'✓',title:'标记本集已看',message:'确定要把这一集标记为已看吗？',okText:'标记',tone:'success'})))return;const prev=btn.textContent;btn.disabled=true;btn.textContent='…';try{const r=await fetch('/api/mark-watched',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'episode',id:episodeId})});if(!r.ok)throw new Error('HTTP '+r.status);btn.textContent='✓';btn.classList.add('done');__toast('已标记本集',{type:'success'});const parts=location.pathname.split('/').filter(Boolean);if(parts[0]==='detail'&&parts.length===3){setTimeout(()=>openDetail(parts[1],parts[2],false),400);}}catch(err){btn.disabled=false;btn.textContent=prev;__errToast('标记失败',err);}},true);
document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-mark-movie]');if(!btn)return;e.preventDefault();e.stopPropagation();const id=btn.dataset.markMovie;if(!id)return;if(!(await __confirm({icon:'✓',title:'标记已观看',message:'确定要把这部电影标记为已观看吗？',okText:'标记',tone:'success'})))return;const prev=btn.textContent;btn.disabled=true;btn.textContent='…';try{const r=await fetch('/api/mark-watched',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'movie',id})});if(!r.ok)throw new Error('HTTP '+r.status);btn.textContent='✓ 已标记';btn.classList.add('done');__toast('已标记为已观看',{type:'success'});const parts=location.pathname.split('/').filter(Boolean);if(parts[0]==='detail'&&parts.length===3){setTimeout(()=>openDetail(parts[1],parts[2],false),400);}if(window.__refreshStats)window.__refreshStats();}catch(err){btn.disabled=false;btn.textContent=prev;__errToast('标记失败',err);}},true);
document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-unmark-movie]');if(!btn)return;e.preventDefault();e.stopPropagation();const id=btn.dataset.unmarkMovie;if(!id)return;if(!(await __confirm({icon:'↺',title:'取消观看',message:'确定要取消这部电影的观看记录吗？',okText:'取消观看',tone:'warn'})))return;const prev=btn.textContent;btn.disabled=true;btn.textContent='…';try{const r=await fetch('/api/unmark-watched',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'movie',id})});if(!r.ok)throw new Error('HTTP '+r.status);btn.textContent='已取消';__toast('已取消观看记录',{type:'success'});const parts=location.pathname.split('/').filter(Boolean);if(parts[0]==='detail'&&parts.length===3){setTimeout(()=>openDetail(parts[1],parts[2],false),400);}if(window.__refreshStats)window.__refreshStats();}catch(err){btn.disabled=false;btn.textContent=prev;__errToast('取消失败',err);}},true);
document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-mark-season-all]');if(!btn)return;e.preventDefault();e.stopPropagation();if(btn.disabled)return;const showId=btn.dataset.markSeasonAll,season=btn.dataset.seasonNum;if(!showId||season==null||season==='undefined')return;if(!(await __confirm({icon:'✓',title:'标记本季已看',message:'确定要把第 '+season+' 季所有已播出集数标记为已看吗？',okText:'标记',tone:'success'})))return;const prev=btn.textContent;btn.disabled=true;btn.textContent='…';try{const r=await fetch('/api/mark-season-watched',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({showId,season:Number(season)})});let data={};try{data=await r.json();}catch(e){}if(!r.ok){let errMsg=(data&&data.error)||('HTTP '+r.status);if(data&&data.cooling)errMsg+='（冷却 '+data.cooling+' 秒）';throw new Error(errMsg);}if(data&&data.marked===0){btn.disabled=false;btn.textContent=prev;__toast(data.message||'本季暂无可标记的已播出集数',{type:'warn'});return;}btn.textContent='✓ 已标记';btn.classList.add('done');__toast('已标记本季 '+(data&&data.marked?data.marked:0)+' 集',{type:'success'});const parts=location.pathname.split('/').filter(Boolean);if(parts[0]==='detail'&&parts.length===3){setTimeout(()=>openDetail(parts[1],parts[2],false),400);}if(window.__refreshStats)window.__refreshStats();}catch(err){btn.disabled=false;btn.textContent=prev;__errToast('标记失败',err);}},true);
let __enrichTimer=null;const __enrichPromises=new Map();
function __scheduleEnrich(){if(__enrichTimer)return;__enrichTimer=setTimeout(__runEnrich,60);}window.__scheduleEnrich=__scheduleEnrich;
async function __runEnrich(){__enrichTimer=null;const els=[...document.querySelectorAll('[data-enrich-key]')];if(!els.length)return;const byKey=new Map();for(const el of els){const k=el.dataset.enrichKey;if(!k)continue;if(!byKey.has(k))byKey.set(k,[]);byKey.get(k).push(el);el.removeAttribute('data-enrich-key');}if(!byKey.size)return;const needFetch=[];for(const[k,group]of byKey.entries()){const existing=__enrichPromises.get(k);if(existing){existing.then(d=>{if(d)group.forEach(el=>__applyEnrich(el,d));});}else{needFetch.push(k);}}if(!needFetch.length)return;const items=needFetch.map(k=>({key:k}));const batchPromise=fetch('/api/enrich',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items})}).then(r=>(r.ok?r.json():{})).catch(()=>({}));for(const k of needFetch){const perKey=batchPromise.then(data=>(data&&data[k])||null);__enrichPromises.set(k,perKey);perKey.then(d=>{if(d)byKey.get(k).forEach(el=>__applyEnrich(el,d));});}if(__enrichPromises.size>400){const arr=[...__enrichPromises.keys()];for(let i=0;i<200;i++)__enrichPromises.delete(arr[i]);}}
function __applyEnrich(el,d){const posterBox=el.querySelector('.poster');if(posterBox&&d.poster){const cur=posterBox.querySelector('img, .poster-ph');if(cur&&cur.tagName==='IMG'){if(cur.src!==d.poster)cur.src=d.poster;}else if(cur){const img=document.createElement('img');img.src=d.poster;img.loading='lazy';img.alt='';cur.replaceWith(img);}}if(d.title){const nameEl=el.querySelector('.name');if(nameEl)nameEl.textContent=d.title;}if(d.overview){const info=el.querySelector('.info');if(info){let ov=info.querySelector('.overview');if(!ov){ov=document.createElement('div');ov.className='overview';const meta=info.querySelector('.meta');if(meta&&meta.nextSibling)info.insertBefore(ov,meta.nextSibling);else info.appendChild(ov);}ov.textContent=d.overview;}}}
window.__summaryState={period:'month',ref:''};
function __sumEsc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function __sumDefaultRef(period){var d=new Date(Date.now()+8*3600*1000);if(period==='year')return String(d.getUTCFullYear());return d.toISOString().slice(0,7);}
function __sumHeatmax(days){var m=1;if(days)for(var i=0;i<days.length;i++)if(days[i].count>m)m=days[i].count;return m;}
function __sumRender(data){if(!data||data.error)return '<div class="empty"><p>小结加载失败</p></div>';var max=__sumHeatmax(data.days);var heat='';if(data.days&&data.days.length){heat='<div class="sum-heat">';for(var i=0;i<data.days.length;i++){var d=data.days[i],lv=Math.min(4,Math.ceil((d.count/max)*4));heat+='<span class="sum-heat-cell lv'+lv+'" title="'+__sumEsc(d.date)+' · '+d.count+' 次"></span>';}heat+='</div>';}else heat='<p class="sum-muted">这段时间还没有观看记录</p>';function listBlock(title,rows,kind){if(!rows||!rows.length)return '';var h='<div class="sum-block"><h3 class="sum-h3">'+title+'</h3><div class="sum-list">';for(var i=0;i<rows.length;i++){var r=rows[i],meta='';if(kind==='movie')meta=r.plays+' 次'+(r.minutes?(' · '+r.minutes+' 分钟'):'');else meta=r.episodes+' 集 · '+r.plays+' 次';var clickable=r.detailType&&r.detailId;var openAttr=clickable?(' data-sum-type="'+__sumEsc(r.detailType)+'" data-sum-id="'+__sumEsc(r.detailId)+'" role="button" tabindex="0"'):'';var cls='sum-row'+(clickable?' sum-row-click':'');h+='<div class="'+cls+'"'+openAttr+'><span class="sum-rank">'+(i+1)+'</span><div class="sum-row-body"><div class="sum-row-title">'+__sumEsc(r.title)+(r.year?(' <span class="sum-year">'+r.year+'</span>'):'')+'</div><div class="sum-row-meta">'+meta+'</div></div></div>';}return h+'</div></div>';}var busiest=data.busiest?'<div class="sum-chip">最忙一天 <strong>'+__sumEsc(data.busiest.date)+'</strong> · '+data.busiest.count+' 次</div>':'';var trunc=data.truncated?'<p class="sum-muted">记录较多，仅统计本时段前 '+data.sampleSize+' 条</p>':'';return '<div class="sum-wrap">'+'<div class="sum-nav">'+'<button type="button" class="sum-nav-btn" onclick="window.__summaryNav(-1)" aria-label="上一时段">‹</button>'+'<div class="sum-nav-center">'+'<div class="sum-period-tabs">'+'<button type="button" class="sum-period-btn'+(data.period==='month'?' active':'')+'" onclick="window.__summarySetPeriod(\\'month\\')">月度</button>'+'<button type="button" class="sum-period-btn'+(data.period==='year'?' active':'')+'" onclick="window.__summarySetPeriod(\\'year\\')">年度</button>'+'</div>'+'<div class="sum-label">'+__sumEsc(data.label)+'</div>'+'</div>'+'<button type="button" class="sum-nav-btn" onclick="window.__summaryNav(1)" aria-label="下一时段">›</button>'+'</div>'+'<div class="sum-stats">'+'<div class="sum-stat"><div class="sum-stat-num">'+data.movies+'</div><div class="sum-stat-label">电影</div></div>'+'<div class="sum-stat"><div class="sum-stat-num">'+data.shows+'</div><div class="sum-stat-label">剧集</div></div>'+'<div class="sum-stat"><div class="sum-stat-num">'+data.episodes+'</div><div class="sum-stat-label">集数</div></div>'+'<div class="sum-stat"><div class="sum-stat-num">'+data.hours+'</div><div class="sum-stat-label">小时</div></div>'+'</div>'+busiest+trunc+'<div class="sum-block"><h3 class="sum-h3">观看热力</h3>'+heat+'</div>'+listBlock('电影 TOP',data.topMovies,'movie')+listBlock('剧集 TOP',data.topShows,'show')+'</div>';}
window.__summarySetPeriod=function(period){window.__summaryState.period=period;window.__summaryState.ref=__sumDefaultRef(period);window.__loadSummary(true);};
window.__summaryNav=function(dir){var st=window.__summaryState;if(!st._prevRef&&!st._nextRef)return;if(dir<0&&st._prevRef)st.ref=st._prevRef;if(dir>0&&st._nextRef)st.ref=st._nextRef;window.__loadSummary(true);};
document.addEventListener('click',function(e){var row=e.target&&e.target.closest&&e.target.closest('.sum-row-click');if(!row)return;var type=row.getAttribute('data-sum-type'),id=row.getAttribute('data-sum-id');if(!type||!id)return;e.preventDefault();if(typeof openDetail==='function')openDetail(type,id,true);});
window.__openSummary=function(){var modal=document.getElementById('summary-modal');if(!modal)return;modal.classList.add('open');modal.style.display='block';document.body.style.overflow='hidden';window.__loadSummary(true);};
window.__closeSummary=function(){var modal=document.getElementById('summary-modal');if(!modal)return;modal.classList.remove('open');modal.style.display='none';document.body.style.overflow='';};
window.__loadSummary=async function(force){var body=document.getElementById('summary-modal-body');if(!body)return;if(body.dataset.loaded==='1'&&!force)return;var st=window.__summaryState;if(!st.ref)st.ref=__sumDefaultRef(st.period);body.innerHTML='<div class="pane-loading"><div class="spinner"></div></div>';try{var r=await fetch('/api/summary?period='+encodeURIComponent(st.period)+'&ref='+encodeURIComponent(st.ref));if(!r.ok)throw new Error('HTTP '+r.status);var data=await r.json();st.ref=data.ref||st.ref;st.period=data.period||st.period;st._prevRef=data.prevRef||null;st._nextRef=data.nextRef||null;body.innerHTML=__sumRender(data);body.dataset.loaded='1';}catch(e){body.innerHTML='<div class="empty"><p>小结加载失败，请关闭后重试</p></div>';body.dataset.loaded='0';}};
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

/* ============================================================
 * pageStyles —— 完整样式
 * ============================================================ */
let __pageStylesCache = null;
function pageStyles() {
  if (__pageStylesCache) return __pageStylesCache;
  __pageStylesCache = `html,body{background:#000!important;color:#eef1f7;margin:0;padding:0;min-height:100%;min-height:100dvh}*{box-sizing:border-box;margin:0;padding:0}.splash{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000;background:radial-gradient(circle at 50% 45%,#0a0a0a 0%,#000 62%);transition:opacity .22s ease;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-tap-highlight-color:transparent;animation:splashAutoHide .22s ease .45s forwards}.splash.hide{opacity:0;pointer-events:none;animation:none}@keyframes splashAutoHide{to{opacity:0;visibility:hidden;pointer-events:none}}.splash-glow{position:absolute;width:340px;height:340px;border-radius:50%;background:radial-gradient(circle,rgba(125,157,212,.25) 0%,rgba(125,157,212,0) 70%);animation:splashPulse 2.4s ease-in-out infinite}.splash-inner{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:20px}.splash-logo{color:#a8b2c4;animation:splashPop .75s cubic-bezier(.22,1.1,.36,1) both}.splash-logo img{display:block}.splash-name{font-size:1.35rem;font-weight:800;letter-spacing:.4px;background:linear-gradient(135deg,#fff 20%,#7d9dd4);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation:splashFadeUp .6s ease .28s both}.splash-bar{width:128px;height:3px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden;animation:splashFadeUp .6s ease .45s both}.splash-bar-fill{height:100%;width:42%;border-radius:99px;background:#fff;animation:splashSlide 1.15s cubic-bezier(.65,0,.35,1) infinite}@keyframes splashPulse{0%,100%{transform:scale(.85);opacity:.7}50%{transform:scale(1.12);opacity:1}}@keyframes splashPop{0%{opacity:0;transform:scale(.55) rotate(-8deg)}60%{opacity:1;transform:scale(1.08) rotate(2deg)}100%{opacity:1;transform:scale(1) rotate(0)}}@keyframes splashFadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@keyframes splashSlide{0%{transform:translateX(-130%)}100%{transform:translateX(330%)}}.spinner{width:30px;height:30px;border:3px solid #212735;border-top-color:#7d9dd4;border-radius:50%;animation:spin .8s linear infinite;margin:4px auto}@keyframes spin{to{transform:rotate(360deg)}}:root{--bg:#050505;--surface:#0e0e10;--surface-2:#16161a;--surface-3:#1c1c22;--border:rgba(255,255,255,.08);--border-strong:rgba(255,255,255,.14);--text:#f4f4f5;--text-dim:#a1a1aa;--text-mute:#71717a;--accent:#a78bfa;--accent-2:#c4b5fd;--accent-soft:rgba(167,139,250,.12);--accent-glow:rgba(167,139,250,.28);--success:#34d399;--blue:#c4b5fd;--radius-sm:10px;--radius-md:14px;--radius-lg:18px;--radius-xl:22px;--shadow-card:0 8px 32px rgba(0,0,0,.55)}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;background:radial-gradient(ellipse 120% 70% at 50% -20%,#1a1528 0%,transparent 50%),radial-gradient(ellipse 50% 40% at 100% 0%,rgba(167,139,250,.08) 0%,transparent 45%),radial-gradient(ellipse 40% 30% at 0% 100%,rgba(52,211,153,.04) 0%,transparent 40%),#050505;background-attachment:fixed;color:var(--text);-webkit-font-smoothing:antialiased;line-height:1.5;overflow-x:hidden;overscroll-behavior-y:none}a{color:var(--accent-2);text-decoration:none;transition:color .15s}a:hover{color:#ddd6fe}img{display:block;max-width:100%}.container{max-width:1200px;margin:0 auto;padding:0 16px calc(80px + env(safe-area-inset-bottom))}.pane-loading{padding:60px 20px;text-align:center}.load-more-wrap{text-align:center;margin-top:24px}.load-more{background:var(--surface-2);border:1px solid var(--border);color:var(--text);padding:11px 32px;border-radius:var(--radius-md);font-size:.9rem;font-weight:600;cursor:pointer;transition:all .2s;font-family:inherit}.load-more:hover:not(:disabled){border-color:rgba(91,124,250,.45);color:var(--accent-2);box-shadow:0 4px 20px var(--accent-glow);background:var(--surface-3)}.load-more:disabled{cursor:not-allowed}.login-wrap{min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:20px}.login-card{width:100%;max-width:440px;background:linear-gradient(165deg,#16161a 0%,#0e0e10 100%);border:1px solid var(--border-strong);border-radius:24px;padding:44px 32px;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.05)}.login-logo{color:#a8b2c4;margin-bottom:16px}.login-title{font-size:1.75rem;font-weight:800;letter-spacing:-.5px;background:linear-gradient(135deg,#fff 20%,#7d9dd4);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:6px}.login-sub{color:var(--text-dim);font-size:.9rem;margin-bottom:28px}.btn-primary{background:linear-gradient(135deg,#7c3aed 0%,#a78bfa 100%);color:#fff;border:none;padding:13px 30px;border-radius:12px;font-size:.95rem;font-weight:700;cursor:pointer;box-shadow:0 6px 24px rgba(167,139,250,.35)}.btn-primary:hover{filter:brightness(1.08);transform:translateY(-1px)}.btn-ghost{background:rgba(255,255,255,.04);color:var(--text-dim);border:1px solid var(--border);padding:8px 16px;border-radius:10px;font-size:.85rem;cursor:pointer;transition:all .15s;font-family:inherit}.btn-ghost:hover{color:#fff;border-color:var(--border-strong);background:rgba(255,255,255,.08)}.steps{display:flex;flex-direction:column;gap:6px}.step{display:flex;align-items:center;gap:10px;text-align:left;padding:4px 0;font-size:.9rem}.step .n{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;background:var(--accent);color:#fff;border-radius:50%;font-size:.72rem;font-weight:700;flex-shrink:0}.code-box{font-family:ui-monospace,Menlo,monospace;font-size:1.75rem;font-weight:800;letter-spacing:6px;color:#a8c0e8;background:rgba(90,120,180,.12);border:1px solid rgba(140,170,220,.35);border-radius:14px;padding:14px;margin:14px 0;user-select:all;text-align:center}.qr-box{background:#fff;border-radius:14px;padding:10px;display:inline-block;margin:6px 0 14px}.qr-box img{border-radius:8px}.status{display:inline-flex;align-items:center;gap:8px;font-size:.88rem;padding:8px 16px;border-radius:20px;color:var(--text-dim);background:var(--surface-2)}.status.success{color:#4ade80;background:rgba(74,222,128,.1)}.status.error{color:#e05560;background:rgba(224,85,96,.12)}.pulse{display:inline-block;width:8px;height:8px;background:#7d9dd4;border-radius:50%;animation:pulse 1.4s ease-in-out infinite}@keyframes pulse{0%,100%{opacity:.35;transform:scale(.85)}50%{opacity:1;transform:scale(1.15)}}.err-box{background:rgba(224,85,96,.10);border:1px solid rgba(224,85,96,.28);border-radius:12px;padding:14px;text-align:left;margin-bottom:14px}.err-title{font-weight:600;color:#e05560;margin-bottom:4px;font-size:.92rem}.err{color:#e8a3ab;font-size:.85rem}.err-detail{font-family:ui-monospace,Menlo,monospace;font-size:.72rem;color:var(--text-dim);background:#000;padding:8px 10px;border-radius:6px;margin-top:8px;white-space:pre-wrap;word-break:break-all;max-height:120px;overflow:auto}.hint{color:var(--text-dim);font-size:.82rem;margin-top:6px}.log-details{margin-top:18px;text-align:left}.log-details summary{cursor:pointer;font-size:.76rem;color:var(--text-dim);padding:4px 0;user-select:none}.log-box{font-family:ui-monospace,Menlo,monospace;font-size:.7rem;color:var(--text-dim);background:#000;border:1px solid var(--border);border-radius:8px;padding:10px;max-height:160px;overflow:auto;margin-top:6px;line-height:1.6}.hero{display:flex;justify-content:space-between;align-items:center;padding:calc(20px + env(safe-area-inset-top)) 0 20px;gap:16px}.hero-left{display:flex;align-items:center;gap:12px;min-width:0}.hero-avatar{width:50px;height:50px;border-radius:50%;overflow:hidden;flex-shrink:0;background:var(--surface-2);border:2px solid rgba(167,139,250,.5);box-shadow:0 0 0 3px rgba(167,139,250,.12),0 4px 20px rgba(0,0,0,.5)}.hero-avatar img{width:100%;height:100%;object-fit:cover;display:block}.hero-avatar-ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.25rem;background:linear-gradient(135deg,#1a2233,#2a3a55)}.hero-text{min-width:0;flex:1;display:flex;flex-direction:column;align-items:flex-start;gap:1px}.hero-name{font-size:1.45rem;font-weight:800;letter-spacing:-.4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:linear-gradient(135deg,#fff 20%,#c4b5fd 90%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}.updated-at{font-size:.72rem;color:var(--text-mute);font-weight:400;letter-spacing:.2px;transition:color .4s ease}.updated-at:empty{display:none}.updated-at.flash{animation:updatedFlash 1.1s ease-out}.updated-at.src-live{color:#4ade80}.updated-at.src-cache{color:var(--text-mute)}@keyframes updatedFlash{0%{color:var(--accent-2)}100%{color:var(--text-mute)}}.hero-actions{display:flex;gap:8px;flex-shrink:0}.btn-action{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.04);color:var(--text-dim);border:1px solid var(--border);padding:8px 14px;border-radius:10px;font-size:.82rem;font-weight:600;cursor:pointer;font-family:inherit;transition:all .18s ease;-webkit-tap-highlight-color:transparent}.btn-action svg{flex-shrink:0;transition:transform .25s ease}.btn-action:hover{color:#fff;border-color:var(--border-strong);background:rgba(167,139,250,.10);box-shadow:0 4px 16px rgba(167,139,250,.18)}.btn-action:hover svg{transform:rotate(180deg)}.btn-action:active{transform:scale(.97)}.btn-action:last-child:hover{background:rgba(224,85,96,.10);border-color:rgba(224,85,96,.35);box-shadow:0 4px 16px rgba(224,85,96,.15)}.btn-action:last-child:hover svg{transform:translateX(2px)}@media (max-width:420px){.btn-action span{display:none}.btn-action{padding:9px}.hero-actions{gap:6px}}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;background:linear-gradient(165deg,#16161a 0%,#0e0e10 100%);border:1px solid var(--border);border-radius:var(--radius-lg);padding:18px 10px;margin-bottom:24px;box-shadow:var(--shadow-card),inset 0 1px 0 rgba(255,255,255,.04);position:relative;overflow:hidden}.stats::before{content:'';position:absolute;top:0;left:10%;right:10%;height:1px;background:linear-gradient(90deg,transparent,rgba(167,139,250,.35),transparent)}.stat{position:relative;text-align:center;display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 2px;border-radius:12px;transition:background .2s ease}.stat:hover{background:rgba(255,255,255,.025)}.stat+.stat::before{content:'';position:absolute;left:-4px;top:18%;bottom:18%;width:1px;background:linear-gradient(180deg,transparent,rgba(255,255,255,.08),transparent)}.stat-icon{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;margin-bottom:4px;transition:transform .25s ease,box-shadow .25s ease}.stat:hover .stat-icon{transform:translateY(-1px) scale(1.06)}.stat-movie .stat-icon{background:linear-gradient(135deg,rgba(167,139,250,.18),rgba(167,139,250,.06));color:#c4b5fd;box-shadow:0 4px 14px rgba(167,139,250,.18),inset 0 0 0 1px rgba(167,139,250,.18)}.stat-show .stat-icon{background:linear-gradient(135deg,rgba(96,165,250,.18),rgba(96,165,250,.06));color:#93c5fd;box-shadow:0 4px 14px rgba(96,165,250,.18),inset 0 0 0 1px rgba(96,165,250,.18)}.stat-episode .stat-icon{background:linear-gradient(135deg,rgba(52,211,153,.18),rgba(52,211,153,.06));color:#6ee7b7;box-shadow:0 4px 14px rgba(52,211,153,.18),inset 0 0 0 1px rgba(52,211,153,.18)}.stat-hours .stat-icon{background:linear-gradient(135deg,rgba(251,191,36,.18),rgba(251,191,36,.06));color:#fcd34d;box-shadow:0 4px 14px rgba(251,191,36,.18),inset 0 0 0 1px rgba(251,191,36,.18)}.stat-num{font-size:1.35rem;font-weight:800;letter-spacing:-.6px;line-height:1.15;background:linear-gradient(180deg,#fff 0%,#c4b5fd 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}.stat-label{font-size:.7rem;color:var(--text-mute);font-weight:500}.tabs{display:flex;gap:4px;margin-bottom:22px;position:sticky;top:0;z-index:10}.tab{flex:1 1 0;min-width:0;background:transparent;border:none;color:var(--text-dim);padding:9px 2px;border-radius:999px;font-size:.75rem;font-weight:600;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;transition:color .2s ease,background .2s ease;font-family:inherit;outline:none!important}.tab:hover{color:var(--text);background:rgba(255,255,255,.06)}.tab.active{background:linear-gradient(135deg,#7c3aed 0%,#a78bfa 100%);color:#fff;font-weight:700}.pane{display:none}.pane.active{display:block;animation:fadeIn .3s ease}@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}.grid{display:flex;flex-direction:column;gap:10px}.item{position:relative;display:flex;gap:14px;background:linear-gradient(160deg,#141416 0%,#0e0e10 100%);border:1px solid var(--border);border-radius:var(--radius-lg);padding:12px;transition:transform .2s ease,border-color .2s,box-shadow .2s;animation:fadeInUp .4s ease backwards;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.03);text-decoration:none;color:inherit}.item.clickable{cursor:pointer}.item.clickable:active{transform:scale(.985);background:var(--surface-2)}@keyframes fadeInUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}.item:hover{border-color:rgba(167,139,250,.25);box-shadow:0 8px 28px rgba(0,0,0,.45),0 0 0 1px rgba(167,139,250,.08);transform:translateY(-1px)}.wl-remove,.wl-drop,.wl-watched,.wl-unwatch{position:absolute;top:6px;right:6px;width:26px;height:26px;border-radius:50%;background:rgba(0,0,0,.65);line-height:1;cursor:pointer;z-index:3;display:flex;align-items:center;justify-content:center;padding:0;font-family:inherit;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);transition:background .15s,transform .15s,opacity .15s,color .15s}.wl-remove{color:#fff;border:1px solid rgba(255,255,255,.22);font-size:1rem;font-weight:400;opacity:.88}.wl-remove:hover{background:rgba(200,70,80,.92);opacity:1;transform:scale(1.06)}.wl-drop{position:absolute;top:6px;right:6px;width:30px;height:30px;border-radius:50%;background:rgba(0,0,0,.72);color:#ff8a8a;border:1px solid rgba(255,120,120,.55);font-size:.85rem;opacity:1;z-index:5;display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}.wl-drop:hover{background:rgba(200,70,80,.95);color:#fff;transform:scale(1.08)}.wl-drop svg{display:block;pointer-events:none}.wl-drop:disabled{opacity:.5;cursor:wait}.cal-action-row{display:flex;gap:8px;margin-top:8px;align-self:flex-start;flex-wrap:wrap}.cal-open-btn,.cal-drop-btn{align-self:auto;margin-top:0;margin-left:0;display:inline-flex;align-items:center;justify-content:center;padding:5px 12px;border-radius:8px;font-size:.74rem;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap}.cal-open-btn{background:rgba(90,120,180,.14);border:1px solid rgba(140,170,220,.35);color:#9db5e0}.cal-open-btn:hover{background:rgba(120,150,210,.28);color:#c2d4f0;border-color:rgba(140,170,220,.65)}.cal-open-btn svg{flex-shrink:0;pointer-events:none}.cal-open-btn.wl-added{background:rgba(74,222,128,.14)!important;border-color:rgba(74,222,128,.38)!important;color:#4ade80!important;cursor:default!important}.cal-drop-btn{background:rgba(224,85,96,.14);border:1px solid rgba(224,85,96,.4);color:#ff8a8a}.cal-drop-btn:hover{background:rgba(224,85,96,.3);color:#ffb3b3;border-color:rgba(224,85,96,.65)}.cal-drop-btn svg{flex-shrink:0;pointer-events:none}.cal-drop-btn:disabled{opacity:.5;cursor:wait}.wl-watched{color:#4ade80;border:1px solid rgba(74,222,128,.45);font-size:.85rem;font-weight:700;opacity:.9}.wl-watched:hover{background:rgba(74,222,128,.95);color:#000;opacity:1;transform:scale(1.06)}.wl-unwatch{color:#ffb84d;border:1px solid rgba(255,184,77,.45);font-size:.9rem;font-weight:700;opacity:.9}.wl-unwatch:hover{background:rgba(255,184,77,.95);color:#000;opacity:1;transform:scale(1.06)}.wl-remove:disabled,.wl-watched:disabled,.wl-unwatch:disabled{opacity:.5;cursor:wait}.wl-toolbar{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-bottom:14px}.wl-sort-label{display:inline-flex;align-items:center;gap:8px;font-size:.82rem;color:var(--text-dim)}.wl-sort{background:var(--surface);border:1px solid var(--border);color:var(--text);padding:7px 12px;border-radius:8px;font-size:.82rem;font-family:inherit;cursor:pointer;outline:none;transition:border-color .15s}.wl-sort:hover{border-color:#2a3345}.wl-sort:focus{border-color:#7d9dd4}.poster{width:76px;height:114px;border-radius:10px;overflow:hidden;flex-shrink:0;background:var(--surface-2);position:relative}.poster img{width:100%;height:100%;object-fit:cover}.poster-ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.8rem;background:linear-gradient(135deg,var(--surface-2),#1a2233);color:var(--text-dim)}.poster-play{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:46px;height:46px;border-radius:50%;background:rgba(8,10,18,.72);color:#fff;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);opacity:1;transition:opacity .2s ease,transform .2s ease,background .15s ease,box-shadow .2s ease;text-decoration:none;border:1px solid rgba(255,255,255,.24);z-index:4;box-shadow:0 4px 18px rgba(0,0,0,.55);-webkit-tap-highlight-color:transparent}.poster-play svg{display:block;margin-left:2px;pointer-events:none;width:24px;height:24px}.item:hover .poster-play{opacity:1}.poster-play:hover{background:linear-gradient(145deg,#8b5cf6,#a78bfa);transform:translate(-50%,-50%) scale(1.1);color:#fff;border-color:rgba(255,255,255,.4);box-shadow:0 8px 28px rgba(139,92,246,.6)}.poster-play:active{transform:translate(-50%,-50%) scale(.94)}.info{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:4px}.name-row{display:flex;align-items:baseline;gap:0;overflow:hidden;white-space:nowrap;line-height:1.3;letter-spacing:-.2px}.name{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:1rem;font-weight:700;color:var(--text)}.tag{flex:0 0 auto;font-size:inherit;font-weight:inherit;letter-spacing:0;white-space:nowrap}.tag.upcoming{color:#ffb84d}.overview{font-size:.8rem;color:var(--text-dim);overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;line-height:1.45;margin-top:4px}.meta{font-size:.8rem;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.meta.dim{color:#7a8394;font-size:.78rem;margin-top:2px}.bar{height:3px;background:rgba(255,255,255,.06);border-radius:99px;overflow:hidden;margin-top:8px}.bar-fill{height:100%;background:linear-gradient(90deg,#7c3aed,#c4b5fd);border-radius:99px;box-shadow:0 0 10px rgba(167,139,250,.5)}.search-bar{margin-bottom:16px}.search-input{width:100%;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:12px 16px;border-radius:12px;font-size:.95rem;font-family:inherit;outline:none;transition:border-color .15s,background .15s;-webkit-appearance:none;appearance:none}.search-input:focus{border-color:var(--accent);background:var(--surface-2);box-shadow:0 0 0 3px var(--accent-soft)}.search-input::placeholder{color:var(--text-mute)}.trending-head{display:flex;align-items:center;gap:8px;font-size:.88rem;font-weight:700;color:var(--text);margin:4px 0 14px;padding-left:2px;letter-spacing:.2px}.trending-head::before{content:'';width:3px;height:14px;border-radius:2px;background:linear-gradient(180deg,#f97316,#ef4444)}.home-section{margin-bottom:24px}.home-section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.home-section-title{font-size:1rem;font-weight:700;letter-spacing:.2px;display:flex;align-items:center;gap:8px}.home-section-title::before{content:'';width:3px;height:16px;border-radius:2px;background:linear-gradient(180deg,#a78bfa,#7c3aed)}.home-more-btn{background:transparent;border:none;color:var(--text-dim);font-size:.82rem;font-weight:600;cursor:pointer;font-family:inherit;padding:6px 10px;border-radius:8px;transition:all .15s;display:inline-flex;align-items:center;gap:4px}.home-more-btn:hover{color:var(--accent-2);background:rgba(167,139,250,.1)}.home-more-btn svg{transition:transform .2s ease}.h-scroll-wrap{margin:0 -16px;padding:0 16px}.h-scroll{display:flex;gap:12px;overflow-x:auto;padding:4px 0 12px;-webkit-overflow-scrolling:touch;scrollbar-width:none;scroll-snap-type:x proximity}.h-scroll::-webkit-scrollbar{display:none}.h-scroll-empty{padding:30px 0;text-align:center}.h-scroll .item{flex:0 0 auto;width:132px;display:flex;flex-direction:column;gap:0;padding:0;border-radius:12px;background:transparent;border:none;overflow:visible;animation:none;box-shadow:none;scroll-snap-align:start;transform:none}.h-scroll .item:hover{background:transparent;border:none;box-shadow:none;transform:none}.h-scroll .item.clickable:active{transform:scale(.96);background:transparent}.h-scroll .item .poster{width:100%;height:auto;aspect-ratio:2/3;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.5);transition:transform .25s ease,box-shadow .25s ease}.h-scroll .item:hover .poster{transform:translateY(-3px);box-shadow:0 12px 28px rgba(91,124,250,.3),0 4px 16px rgba(0,0,0,.6)}.h-scroll .item .info{display:block;padding:8px 2px 0;flex:none;justify-content:flex-start}.h-scroll .item .name{font-size:.82rem;line-height:1.3}.h-scroll .item .overview{display:none}.h-scroll .item .meta{font-size:.72rem;margin-top:2px;color:var(--text-dim)}.h-scroll .item .meta.dim{font-size:.7rem}.h-scroll .item .bar{margin-top:6px}.h-scroll .item .wl-watched,.h-scroll .item .wl-remove,.h-scroll .item .wl-drop,.h-scroll .item .wl-unwatch{top:6px;right:6px;width:24px;height:24px;font-size:.75rem}.h-scroll .item .cal-action-row,.h-scroll .item .cal-open-btn{display:none}.h-scroll .item .poster-play{width:46px;height:46px;opacity:1}.h-scroll .item .poster-play svg{width:24px;height:24px}@media (min-width:768px){.h-scroll-wrap{margin:0;padding:0}.h-scroll .item{width:160px}}@media (min-width:1024px){.h-scroll .item{width:172px}}.list-modal{position:fixed;inset:0;z-index:150;display:none}.list-modal.open{display:block}.list-modal-backdrop{position:absolute;inset:0;background:rgba(2,4,8,.8);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);animation:fadeIn .2s ease}.list-modal-panel{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(94vw,1000px);max-height:88vh;display:flex;flex-direction:column;background:linear-gradient(165deg,#16161a 0%,#0e0e10 100%);border:1px solid var(--border-strong);border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.85);overflow:hidden;animation:modalIn .25s cubic-bezier(.2,.9,.3,1)}.list-modal-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border);flex-shrink:0}.list-modal-title{font-size:1.05rem;font-weight:700}.list-modal-close{width:40px;height:40px;border-radius:50%;border:1px solid var(--border);background:rgba(255,255,255,.04);color:var(--text-dim);font-size:1.2rem;cursor:pointer;font-family:inherit;line-height:1;display:flex;align-items:center;justify-content:center;transition:all .15s}.list-modal-close:hover{color:#fff;border-color:var(--border-strong);background:rgba(255,255,255,.08)}.list-modal-body{overflow-y:auto;padding:16px 20px 24px;-webkit-overflow-scrolling:touch}.douban-filter-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}.douban-filter-tab{background:rgba(255,255,255,.04);border:1px solid var(--border);color:var(--text-dim);padding:7px 16px;border-radius:999px;font-size:.82rem;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;-webkit-tap-highlight-color:transparent}.douban-filter-tab:hover{color:var(--text);border-color:var(--border-strong);background:rgba(255,255,255,.07)}.douban-filter-tab.active{background:linear-gradient(135deg,#7c3aed 0%,#a78bfa 100%);color:#fff;border-color:transparent;box-shadow:0 4px 14px rgba(167,139,250,.3)}.theater-home-tabs{display:flex;gap:8px;overflow-x:auto;padding:0 16px 12px;margin:0 -16px;scrollbar-width:none;-webkit-overflow-scrolling:touch;scroll-snap-type:x proximity}.theater-home-tabs::-webkit-scrollbar{display:none}.theater-filter-tab{flex-shrink:0;background:rgba(255,255,255,.04);border:1px solid var(--border);color:var(--text-dim);padding:6px 14px;border-radius:999px;font-size:.78rem;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;-webkit-tap-highlight-color:transparent;scroll-snap-align:start}.theater-filter-tab:hover{color:var(--text);border-color:var(--border-strong);background:rgba(255,255,255,.07)}.theater-filter-tab.active{background:linear-gradient(135deg,#7c3aed 0%,#a78bfa 100%);color:#fff;border-color:transparent;box-shadow:0 4px 14px rgba(167,139,250,.3)}@media (min-width:768px){.theater-home-tabs{margin:0;padding-left:0;padding-right:0}}@media (max-width:599px){.list-modal-panel{top:auto;bottom:0;left:0;right:0;transform:none;width:100%;max-height:92vh;border-radius:18px 18px 0 0}}.show-cal-modal{position:fixed;inset:0;z-index:240;display:none}.show-cal-modal.open{display:block}.show-cal-backdrop{position:absolute;inset:0;background:rgba(2,4,8,.78);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);animation:fadeIn .2s ease}.show-cal-panel{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(92vw,440px);max-height:90vh;overflow-y:auto;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:20px;box-shadow:0 30px 80px rgba(0,0,0,.8);animation:modalIn .25s cubic-bezier(.2,.9,.3,1)}.show-cal-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}.show-cal-name{font-size:.95rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}.show-cal-close{width:40px;height:40px;flex-shrink:0;background:rgba(255,255,255,.04);border:1px solid var(--border);color:var(--text-dim);border-radius:50%;cursor:pointer;font-size:1.2rem;line-height:1;display:flex;align-items:center;justify-content:center;transition:all .15s;font-family:inherit}.show-cal-close:hover{color:var(--text);border-color:#3a4a68}.show-cal-info{font-size:.72rem;color:var(--text-dim);margin-bottom:12px;line-height:1.4}.show-cal-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;font-size:.88rem;color:var(--text);font-weight:600}.show-cal-nav button{width:30px;height:30px;background:rgba(255,255,255,.04);border:1px solid var(--border);color:var(--text-dim);border-radius:8px;cursor:pointer;font-size:1rem;line-height:1;display:flex;align-items:center;justify-content:center;transition:all .15s;font-family:inherit}.show-cal-nav button:hover{color:var(--text);border-color:#3a4a68}.show-cal-weekdays{display:grid;grid-template-columns:repeat(7,1fr);text-align:center;font-size:.7rem;color:var(--text-dim);margin-bottom:6px}.show-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}.sc-day{position:relative;aspect-ratio:1;display:flex;align-items:center;justify-content:center;border-radius:8px;font-size:.8rem;color:var(--text-dim);cursor:default;border:1px solid transparent;transition:background .15s,border-color .15s}.sc-day.sc-has{cursor:pointer;font-weight:700}.sc-day.sc-past{background:rgba(90,120,180,.22);color:#9db0d0;border-color:rgba(120,150,210,.5)}.sc-day.sc-past:hover{background:rgba(120,150,210,.4);color:#d0dcf0}.sc-day.sc-today-day{background:#4a6db8;color:#fff;border-color:#7d9dd4;box-shadow:0 0 14px rgba(125,157,212,.7)}.sc-day.sc-today-day:hover{background:#5b7fc4}.sc-day.sc-future{background:rgba(255,184,77,.18);color:#ffd693;border-color:rgba(255,184,77,.55)}.sc-day.sc-future:hover{background:rgba(255,184,77,.4);color:#fff0d0}.sc-day.sc-active{outline:2px solid #fff;outline-offset:-2px}.sc-day.sc-empty{visibility:hidden}.sc-badge{position:absolute;top:2px;right:2px;min-width:14px;height:14px;padding:0 3px;border-radius:7px;background:#4a6db8;color:#fff;font-size:.6rem;font-weight:700;line-height:14px;text-align:center}.sc-day.sc-future .sc-badge{background:#d99a3a}.show-cal-legend{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:14px;font-size:.7rem;color:var(--text-dim)}.legend-item{display:inline-flex;align-items:center;gap:5px}.legend-dot{display:inline-block;width:10px;height:10px;border-radius:3px}.legend-past{background:rgba(90,120,180,.5);border:1px solid rgba(140,170,220,.8)}.legend-today{background:#4a6db8;border:1px solid #7d9dd4}.legend-future{background:rgba(255,184,77,.4);border:1px solid rgba(255,184,77,.8)}.show-cal-detail{margin-top:14px;border-top:1px solid var(--border);padding-top:12px;min-height:20px}.sc-ep{display:flex;gap:10px;align-items:baseline;padding:6px 0;font-size:.82rem}.sc-ep-tag{font-family:ui-monospace,Menlo,monospace;font-size:.72rem;font-weight:700;color:#7d9dd4;flex-shrink:0}.sc-ep-title{color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ext-rating{display:inline-flex;align-items:center;gap:6px;padding:4px 10px 4px 8px;border-radius:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);line-height:1;font-size:.82rem;color:var(--text);white-space:nowrap;text-decoration:none;transition:background .15s,border-color .15s,transform .12s}.ext-rating:hover{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.16)}.ext-logo{display:block;flex-shrink:0;border-radius:2px}.ext-score{font-weight:800;letter-spacing:.2px;font-variant-numeric:tabular-nums}.ext-rating.ext-imdb{background:rgba(245,197,24,.14);border-color:rgba(245,197,24,.35);color:#f5c518}.ext-rating.ext-imdb .ext-score{color:#f5c518}.ext-rating.ext-rt{background:rgba(250,50,10,.12);border-color:rgba(250,50,10,.32);color:#ff7666}.ext-rating.ext-rt .ext-score{color:#ff7666}.ext-rating.ext-mc{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.12);color:var(--text)}.ext-rating.ext-trakt{background:rgba(237,28,36,.12);border-color:rgba(237,28,36,.32);color:#ff6b70}.ext-rating.ext-trakt .ext-score{color:#ff6b70}.ext-rating.ext-tmdb{background:rgba(1,180,228,.12);border-color:rgba(1,180,228,.32);color:#4dd0e1}.ext-rating.ext-tmdb .ext-score{color:#4dd0e1}.ext-rating.ext-douban{background:rgba(46,150,61,.12);border-color:rgba(46,150,61,.38);color:#4ecb71}.ext-rating.ext-douban:hover{background:rgba(46,150,61,.22);border-color:rgba(46,150,61,.6);color:#6fe089}.detail-ext-ratings{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:8px;align-items:center}@media (min-width:600px){.container{padding-left:20px;padding-right:20px}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.item{border-radius:14px}.poster{width:72px;height:108px}}@media (min-width:768px){.container{max-width:1000px;padding:0 28px calc(88px + env(safe-area-inset-bottom))}.hero{padding:28px 0 22px;gap:12px}.hero-avatar{width:56px;height:56px}.hero-name{font-size:1.55rem}.stats{gap:10px;padding:18px 12px;margin-bottom:24px}.stat-num{font-size:1.5rem}.stat-label{font-size:.76rem}.stat-icon{width:34px;height:34px;border-radius:10px}.tabs{position:static}.tab{flex:0 0 auto;padding:9px 18px;font-size:.87rem}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px}.item{display:flex;flex-direction:column;gap:0;padding:0;border-radius:12px;background:transparent;border:none;overflow:visible}.item:hover{background:transparent;border:none}.item.clickable:active{transform:none;background:transparent}.poster{width:100%;height:auto;aspect-ratio:2/3;border-radius:12px;transition:transform .25s ease,box-shadow .25s ease;box-shadow:0 4px 16px rgba(0,0,0,.5)}.item:hover .poster{transform:translateY(-4px);box-shadow:0 12px 32px rgba(91,124,250,.3),0 4px 16px rgba(0,0,0,.6)}.info{display:block;padding:10px 2px 0;flex:none;justify-content:flex-start}.name{font-size:.88rem}.overview{-webkit-line-clamp:2;font-size:.74rem;margin-top:4px}.meta{font-size:.76rem;margin-top:3px}.meta.dim{font-size:.72rem}.bar{margin-top:8px}.wl-remove,.wl-watched,.wl-unwatch{top:8px;right:8px;width:28px;height:28px}.day-num{font-size:1.6rem}}@media (min-width:1024px){.container{max-width:1120px;padding:0 32px 100px}.hero{padding:36px 0 26px}.hero-name{font-size:1.7rem}.stats{gap:12px;padding:20px 14px;margin-bottom:28px}.stat-num{font-size:1.7rem}.stat-label{font-size:.78rem}.stat-icon{width:36px;height:36px}.grid{grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:20px}.name{font-size:.9rem}.overview{-webkit-line-clamp:3;font-size:.76rem}.wl-remove,.wl-watched,.wl-unwatch{top:10px;right:10px;width:30px;height:30px}.wl-watched,.wl-unwatch{font-size:.95rem}}@media (min-width:1280px){.container{max-width:1280px;padding:0 40px 110px}.grid{grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:22px}.hero-name{font-size:1.85rem}}@media (min-width:1600px){.container{max-width:1440px}.grid{grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:24px}}.day{margin-bottom:26px}.day-head{display:flex;align-items:center;gap:12px;margin-bottom:12px;padding-left:2px}.day-num{font-size:1.8rem;font-weight:800;color:#7d9dd4;line-height:1;letter-spacing:-1px}.day-mon{font-size:.75rem;color:var(--text-dim)}.day-wd{font-size:.85rem;font-weight:600;color:var(--text)}.today{background:var(--accent);color:#fff;font-size:.68rem;padding:3px 9px;border-radius:999px;font-weight:700;margin-left:auto}.empty{text-align:center;padding:80px 20px;color:var(--text-dim)}.empty p{margin-top:14px;font-size:.92rem}@media (min-width:700px){.empty{padding:120px 20px}}.modal{position:fixed;inset:0;z-index:220;display:none}.modal.open{display:block}.modal-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(12px) saturate(1.1);-webkit-backdrop-filter:blur(12px) saturate(1.1);animation:fadeIn .2s ease}.modal-panel{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:12px;padding-top:calc(12px + env(safe-area-inset-top));padding-bottom:calc(12px + env(safe-area-inset-bottom));pointer-events:none}.modal-shell{pointer-events:auto;position:relative;display:flex;flex-direction:column;width:100%;max-width:min(1120px,100%);max-height:100%;background:#000;border:1px solid var(--border);border-radius:18px;box-shadow:0 40px 100px rgba(0,0,0,.85);animation:modalIn .28s cubic-bezier(.2,.9,.3,1);overflow:hidden}.modal-body{position:relative;width:100%;flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;background:#000;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}.modal-close{position:absolute;top:12px;right:12px;z-index:5;width:40px;height:40px;border-radius:50%;background:rgba(13,16,23,.86);border:1px solid rgba(255,255,255,.18);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);transition:background .15s,transform .15s,border-color .15s;padding:0;box-shadow:0 4px 16px rgba(0,0,0,.55);touch-action:manipulation;-webkit-tap-highlight-color:transparent}.modal-close::before{content:'';position:absolute;inset:-8px;border-radius:50%}.modal-close:hover{background:rgba(30,38,58,.95);transform:scale(1.05);border-color:rgba(255,255,255,.28)}.modal-close:active{transform:scale(.94);background:rgba(50,60,88,.95)}@media (max-width:599px){.modal-panel{padding:0;align-items:stretch;justify-content:flex-start}.modal-shell{position:absolute;left:0;right:0;top:calc(10px + env(safe-area-inset-top));bottom:0;max-width:100%;max-height:none;width:100%;border-radius:16px 16px 0 0;border:none;border-top:1px solid var(--border)}.modal-body{padding-bottom:env(safe-area-inset-bottom)}.detail-inner{padding-top:24px}.detail-body{padding-bottom:calc(28px + env(safe-area-inset-bottom))}.modal-close{top:12px;right:12px;width:40px;height:40px;background:rgba(13,16,23,.94);border-color:rgba(255,255,255,.24);box-shadow:0 6px 22px rgba(0,0,0,.65),inset 0 1px 0 rgba(255,255,255,.08)}.modal-close::before{inset:-12px}.modal-close:active{transform:scale(.9);background:rgba(50,60,88,.96)}}@media (min-width:768px) and (max-width:1023px){.modal-shell{max-width:min(880px,92vw)}}@media (min-width:700px){.modal-panel{padding:40px 24px}}@keyframes modalIn{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}.modal-loading{padding:100px 20px;text-align:center}.modal-error{padding:80px 20px;text-align:center;color:#9db5e0;font-size:.9rem}.detail-hero{position:relative;overflow:hidden;background:var(--surface);border-radius:18px 18px 0 0}.detail-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(30px) saturate(1.2) brightness(.5);transform:scale(1.15);z-index:0}.detail-hero::after{content:'';position:absolute;inset:0;z-index:1;background:linear-gradient(180deg,rgba(10,14,24,.6),rgba(10,14,24,.95))}.detail-inner{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;text-align:center;gap:16px;padding:24px 20px 24px}.detail-poster{width:min(48vw,200px);height:auto;aspect-ratio:2/3;border-radius:14px;object-fit:cover;flex-shrink:0;box-shadow:0 16px 40px rgba(0,0,0,.75);margin:0 auto}.detail-poster-ph{display:flex;align-items:center;justify-content:center;background:var(--surface-2);font-size:2.8rem;color:var(--text-dim);width:min(48vw,200px);aspect-ratio:2/3}.detail-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;align-items:center;width:100%}.detail-title{font-size:1.45rem;font-weight:800;letter-spacing:-.4px;line-height:1.25}.detail-tagline{font-size:.85rem;color:var(--text-dim);font-style:italic}.detail-meta{display:flex;flex-wrap:wrap;gap:10px;font-size:.85rem;color:var(--text-dim);justify-content:center}.detail-genres{font-size:.82rem;color:var(--text-dim)}.detail-overview{font-size:.88rem;color:#c0c8d6;line-height:1.55;margin-top:4px;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden;text-align:center}.d-status{display:flex;gap:12px;align-items:center;background:linear-gradient(135deg,#16161a,#0e0e10);border:1px solid var(--border);border-radius:14px;padding:12px 14px;margin-top:8px;width:100%;justify-content:flex-start}.d-status.done{border-color:rgba(74,222,128,.3);background:rgba(74,222,128,.06)}.d-status-progress{flex-direction:column;align-items:stretch;gap:10px}.d-status-row{display:flex;gap:12px;align-items:center;width:100%}.d-status-icon{width:32px;height:32px;border-radius:50%;background:var(--surface-2);color:var(--text-dim);display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;font-size:.95rem}.d-status.done .d-status-icon{background:rgba(74,222,128,.15);color:#4ade80}.d-status-body{flex:1;min-width:0;text-align:left}.d-status-title{font-size:.88rem;font-weight:600}.d-status-sub{font-size:.76rem;color:var(--text-dim);margin-top:2px}.d-action-bar{display:inline-flex;align-items:center;gap:2px;margin-top:16px;padding:4px;background:linear-gradient(165deg,rgba(255,255,255,.09) 0%,rgba(255,255,255,.04) 100%);border:1px solid rgba(255,255,255,.12);border-radius:999px;box-shadow:0 8px 28px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.06);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}.d-act{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;border:none;background:transparent;color:rgba(255,255,255,.55);cursor:pointer;padding:0;font-family:inherit;transition:background .18s ease,color .18s ease,transform .12s ease,box-shadow .18s ease;-webkit-tap-highlight-color:transparent;text-decoration:none;flex-shrink:0;position:relative}.d-act svg{display:block;pointer-events:none}.d-act:hover{background:rgba(255,255,255,.1);color:#fff}.d-act:active{transform:scale(.9)}.d-act:disabled{opacity:.5;cursor:default;pointer-events:none}.d-act-watched.active{background:linear-gradient(145deg,#8b5cf6 0%,#a78bfa 55%,#c4b5fd 100%);color:#fff;box-shadow:0 4px 16px rgba(139,92,246,.5),inset 0 1px 0 rgba(255,255,255,.25)}.d-act-watched.active:hover{filter:brightness(1.1);color:#fff}.d-act-wl.active{color:#c4b5fd;background:rgba(167,139,250,.12)}.d-act-wl.active:hover{background:rgba(167,139,250,.2);color:#ddd6fe}.d-act-play{color:rgba(255,255,255,.7)}.d-act-play:hover{background:rgba(167,139,250,.15);color:#ddd6fe}.detail-body{padding:20px 22px 24px}.d-section{margin-top:8px;margin-bottom:26px}.d-section:last-child{margin-bottom:0}.d-section-title{font-size:1rem;font-weight:700;letter-spacing:.2px;margin-bottom:14px;color:var(--text);display:flex;align-items:center;gap:8px}.d-section-title::before{content:'';width:3px;height:16px;border-radius:2px;background:#7d9dd4}.cast-scroll{display:flex;gap:14px;overflow-x:auto;padding-bottom:8px;scrollbar-width:none}.cast-scroll::-webkit-scrollbar{display:none}.cast{flex-shrink:0;width:84px;text-align:center}.cast-img{width:84px;height:84px;border-radius:50%;object-fit:cover;background:var(--surface-2)}.cast-ph{display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:1.6rem;font-weight:600;background:linear-gradient(135deg,var(--surface-2),#1a2233)}.cast-name{font-size:.75rem;font-weight:600;margin-top:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cast-role{font-size:.68rem;color:var(--text-dim);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.seasons{display:flex;flex-direction:column;gap:8px}.season-item{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;transition:border-color .15s}.season-item.open{border-color:#2a3345}.season-head{width:100%;background:none;border:none;color:inherit;display:flex;align-items:center;gap:10px;padding:14px 16px;cursor:pointer;font-family:inherit;text-align:left;transition:background .15s}.season-head:hover{background:var(--surface-2)}.season-title{font-weight:600;font-size:.9rem;flex:1}.season-meta{font-size:.76rem;color:var(--text-dim)}.chev{width:16px;height:16px;color:var(--text-dim);transition:transform .2s ease;flex-shrink:0}.season-item.open .chev{transform:rotate(180deg)}.season-body{display:none;border-top:1px solid var(--border)}.season-item.open .season-body{display:block}.ep-empty{padding:20px;text-align:center;color:var(--text-dim);font-size:.85rem}.episode{display:flex;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);align-items:flex-start;transition:background .15s}.episode:last-child{border-bottom:none}.episode.clickable{cursor:pointer}.episode.clickable:hover{background:var(--surface-2)}.episode.clickable:active{background:#1a2233}.episode.clickable:hover .ep-title{color:#7d9dd4}.episode.watched .ep-title{color:var(--text-dim)}.episode.watched.clickable:hover .ep-title{color:#7d9dd4}.ep-num{font-family:ui-monospace,Menlo,monospace;font-size:.76rem;color:var(--text-dim);font-weight:700;flex-shrink:0;padding-top:3px;width:32px;letter-spacing:.5px}.ep-body{flex:1;min-width:0}.ep-title{font-size:.86rem;font-weight:600;line-height:1.3}.ep-overview{font-size:.76rem;color:var(--text-dim);margin-top:4px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.ep-check{color:#4ade80;font-weight:700;flex-shrink:0;font-size:.9rem;padding-top:2px}.ep-actions{flex-shrink:0;display:flex;align-items:center}.ep-watch-btn{background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.35);color:#6ee7b7;padding:3px 9px;border-radius:7px;font-size:.7rem;font-weight:700;cursor:pointer;font-family:inherit;transition:all .15s}.ep-watch-btn:hover{background:rgba(52,211,153,.25);color:#a7f3d0}.ep-watch-btn:disabled{opacity:.6;cursor:wait}.ep-watch-btn.done{background:rgba(52,211,153,.2);color:#34d399;cursor:default}.modal-body .grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px}@media (min-width:700px){.detail-inner{flex-direction:row;align-items:flex-start;text-align:left;padding:34px;gap:30px}.detail-poster{width:220px;height:auto;aspect-ratio:2/3;margin:0}.detail-info{align-items:flex-start}.detail-meta{justify-content:flex-start}.detail-overview{text-align:left}.detail-title{font-size:1.85rem}.detail-overview{font-size:.92rem;-webkit-line-clamp:6}.detail-body{padding:30px 34px 34px}.cast{width:96px}.cast-img{width:96px;height:96px}.modal-body .grid{grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:20px}.detail-ext-ratings{justify-content:flex-start}.d-action-bar{align-self:flex-start}}.confirm-modal{position:fixed;inset:0;z-index:320;display:none}.confirm-modal.open{display:block}.confirm-backdrop{position:absolute;inset:0;background:rgba(2,4,8,.7);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:fadeIn .18s ease}.confirm-panel{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(88vw,340px);background:linear-gradient(165deg,#16161a 0%,#0e0e10 100%);border:1px solid var(--border-strong);border-radius:18px;padding:24px 22px 18px;box-shadow:0 30px 80px rgba(0,0,0,.8);text-align:center;animation:confirmIn .22s cubic-bezier(.2,.9,.3,1)}@keyframes confirmIn{from{opacity:0;transform:translate(-50%,-48%) scale(.95)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}.confirm-icon{width:48px;height:48px;margin:0 auto 12px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.4rem;background:var(--accent-soft);color:var(--accent-2)}.confirm-icon.danger{background:rgba(224,85,96,.14);color:#ff7b85}.confirm-icon.warn{background:rgba(255,184,77,.14);color:#ffb84d}.confirm-icon.success{background:rgba(52,211,153,.14);color:#34d399}.confirm-title{font-size:1.02rem;font-weight:700;margin-bottom:6px;color:var(--text)}.confirm-msg{font-size:.84rem;color:var(--text-dim);line-height:1.55;word-break:break-word}.confirm-actions{display:flex;gap:10px;margin-top:20px}.confirm-btn{flex:1;padding:11px 14px;border-radius:12px;font-size:.88rem;font-weight:700;font-family:inherit;cursor:pointer;border:1px solid transparent;transition:all .15s;-webkit-tap-highlight-color:transparent}.confirm-cancel{background:rgba(255,255,255,.05);border-color:var(--border);color:var(--text-dim)}.confirm-cancel:hover{background:rgba(255,255,255,.09);color:#fff}.confirm-ok{background:linear-gradient(135deg,#7c3aed 0%,#a78bfa 100%);color:#fff;box-shadow:0 6px 20px rgba(167,139,250,.3)}.confirm-ok:hover{filter:brightness(1.08)}.confirm-ok.danger{background:linear-gradient(135deg,#dc2626 0%,#f87171 100%);box-shadow:0 6px 20px rgba(248,113,113,.28)}.confirm-ok:disabled,.confirm-cancel:disabled{opacity:.6;cursor:wait}.hero-avatar{border:2px solid rgba(167,139,250,.5);padding:0;cursor:pointer;font:inherit;color:inherit}.hero-avatar:hover{box-shadow:0 0 0 3px rgba(167,139,250,.28),0 4px 20px rgba(0,0,0,.5);transform:scale(1.03)}.hero-avatar:active{transform:scale(.97)}.summary-modal{position:fixed;inset:0;z-index:160;display:none}.summary-modal.open{display:block}.summary-backdrop{position:absolute;inset:0;background:rgba(2,4,8,.78);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}.summary-panel{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(94vw,480px);max-height:88vh;display:flex;flex-direction:column;background:linear-gradient(165deg,#16161a 0%,#0e0e10 100%);border:1px solid var(--border-strong);border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.85);overflow:hidden}.summary-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px 10px;border-bottom:1px solid var(--border);flex-shrink:0}.summary-title{font-size:1.05rem;font-weight:700}.summary-close{width:40px;height:40px;border-radius:50%;border:1px solid var(--border);background:rgba(255,255,255,.04);color:var(--text-dim);font-size:1.2rem;cursor:pointer;font-family:inherit;line-height:1}.summary-close:hover{color:#fff;border-color:var(--border-strong)}.summary-body{overflow-y:auto;padding:12px 16px 20px;-webkit-overflow-scrolling:touch}@media (max-width:599px){.summary-panel{top:auto;bottom:0;left:0;right:0;transform:none;width:100%;max-height:92vh;border-radius:18px 18px 0 0}}.sum-wrap{padding:4px 0 24px}.sum-nav{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:18px}.sum-nav-btn{width:36px;height:36px;border-radius:10px;border:1px solid var(--border);background:rgba(255,255,255,.04);color:var(--text-dim);font-size:1.2rem;cursor:pointer;font-family:inherit;transition:all .15s}.sum-nav-btn:hover{color:#fff;border-color:var(--border-strong);background:rgba(167,139,250,.12)}.sum-nav-center{flex:1;text-align:center;min-width:0}.sum-period-tabs{display:inline-flex;gap:4px;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:999px;padding:3px;margin-bottom:8px}.sum-period-btn{border:none;background:transparent;color:var(--text-dim);padding:6px 14px;border-radius:999px;font-size:.8rem;font-weight:600;cursor:pointer;font-family:inherit}.sum-period-btn.active{background:linear-gradient(135deg,#7c3aed 0%,#a78bfa 100%);color:#fff}.sum-label{font-size:1.05rem;font-weight:700;letter-spacing:.2px}.sum-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}.sum-stat{text-align:center;background:linear-gradient(165deg,#16161a 0%,#0e0e10 100%);border:1px solid var(--border);border-radius:14px;padding:14px 6px}.sum-stat-num{font-size:1.35rem;font-weight:800;letter-spacing:-.5px;background:linear-gradient(180deg,#fff 0%,#c4b5fd 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}.sum-stat-label{font-size:.7rem;color:var(--text-mute);margin-top:2px}.sum-chip{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:10px;background:rgba(167,139,250,.1);border:1px solid rgba(167,139,250,.25);color:var(--text-dim);font-size:.82rem;margin-bottom:12px}.sum-chip strong{color:#ddd6fe}.sum-muted{font-size:.8rem;color:var(--text-mute);margin:6px 0 12px}.sum-block{margin-top:18px}.sum-h3{font-size:.92rem;font-weight:700;margin-bottom:10px;display:flex;align-items:center;gap:8px}.sum-h3::before{content:'';width:3px;height:14px;border-radius:2px;background:linear-gradient(180deg,#a78bfa,#7c3aed)}.sum-heat{display:flex;flex-wrap:wrap;gap:4px}.sum-heat-cell{width:12px;height:12px;border-radius:3px;background:rgba(255,255,255,.06)}.sum-heat-cell.lv1{background:rgba(167,139,250,.25)}.sum-heat-cell.lv2{background:rgba(167,139,250,.45)}.sum-heat-cell.lv3{background:rgba(167,139,250,.7)}.sum-heat-cell.lv4{background:#a78bfa}.sum-list{display:flex;flex-direction:column;gap:8px}.sum-row{display:flex;align-items:center;gap:12px;padding:10px 12px;background:linear-gradient(160deg,#141416 0%,#0e0e10 100%);border:1px solid var(--border);border-radius:12px}.sum-rank{width:22px;height:22px;border-radius:6px;background:rgba(167,139,250,.15);color:#c4b5fd;font-size:.72rem;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0}.sum-row-body{min-width:0;flex:1}.sum-row-title{font-size:.9rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sum-year{font-weight:500;color:var(--text-mute);font-size:.8rem}.sum-row-meta{font-size:.75rem;color:var(--text-dim);margin-top:2px}@media (max-width:420px){.sum-stats{gap:6px}.sum-stat{padding:12px 4px}.sum-stat-num{font-size:1.15rem}}
#toast-container{position:fixed;left:50%;bottom:calc(28px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none;max-width:min(92vw,440px);width:max-content}
.toast{pointer-events:auto;display:flex;align-items:center;gap:10px;padding:11px 16px;border-radius:12px;font-size:.86rem;font-weight:500;color:#fff;background:rgba(20,22,28,.96);border:1px solid rgba(255,255,255,.1);box-shadow:0 12px 32px rgba(0,0,0,.55);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);opacity:0;transform:translateY(12px) scale(.96);transition:opacity .22s ease,transform .22s ease;cursor:pointer;line-height:1.45;word-break:break-word;max-width:min(92vw,440px)}
.toast.toast-in{opacity:1;transform:translateY(0) scale(1)}
.toast.toast-out{opacity:0;transform:translateY(8px) scale(.96)}
.toast-icon{flex-shrink:0;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:800;line-height:1}
.toast-info .toast-icon{background:rgba(125,157,212,.22);color:#a8c0e8}
.toast-success .toast-icon{background:rgba(52,211,153,.22);color:#6ee7b7}
.toast-error .toast-icon{background:rgba(224,85,96,.24);color:#ff8a8a}
.toast-warn .toast-icon{background:rgba(255,184,77,.22);color:#ffd693}
.toast-success{border-color:rgba(52,211,153,.35)}
.toast-error{border-color:rgba(224,85,96,.35)}
.toast-warn{border-color:rgba(255,184,77,.35)}
@media (max-width:420px){.toast{font-size:.82rem;padding:10px 14px}}
.cast.clickable{cursor:pointer}
.cast.clickable:hover .cast-img{transform:translateY(-2px) scale(1.03);box-shadow:0 8px 20px rgba(167,139,250,.28)}
.cast.clickable:hover .cast-name{color:#c4b5fd}
.cast-img{transition:transform .2s ease,box-shadow .2s ease}
.cast-name{transition:color .15s ease}
.trailer-grid{display:grid;grid-template-columns:1fr;gap:14px}
@media (min-width:600px){.trailer-grid{grid-template-columns:repeat(2,1fr)}}
.trailer-card{position:relative;aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:linear-gradient(135deg,#1a1528 0%,#0e0e10 100%);cursor:pointer;border:1px solid var(--border);transition:border-color .15s,transform .15s}
.trailer-card:hover{border-color:rgba(167,139,250,.4);transform:translateY(-1px)}
.trailer-thumb{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;z-index:1}
.trailer-card.no-thumb .trailer-thumb{display:none}
.trailer-play{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:52px;height:52px;border-radius:50%;background:rgba(8,10,18,.72);border:1px solid rgba(255,255,255,.28);color:#fff;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);transition:background .15s,transform .15s;pointer-events:none;z-index:3}
.trailer-card:hover .trailer-play{background:linear-gradient(145deg,#8b5cf6,#a78bfa);transform:translate(-50%,-50%) scale(1.08)}
.trailer-play svg{display:block;margin-left:2px}
.trailer-name{position:absolute;left:0;right:0;bottom:0;padding:22px 12px 9px;font-size:.8rem;font-weight:600;color:#fff;background:linear-gradient(180deg,transparent,rgba(0,0,0,.85));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;z-index:3}
.trailer-card.playing .trailer-thumb,.trailer-card.playing .trailer-play,.trailer-card.playing .trailer-name{display:none}
.trailer-frame{position:absolute;inset:0;width:100%;height:100%;background:#000;z-index:2}
.trailer-frame:empty{display:none}
.trailer-frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:block}
.person-modal{position:fixed;inset:0;z-index:230;display:none}
.person-modal.open{display:block}
.person-backdrop{position:absolute;inset:0;background:rgba(2,4,8,.78);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);animation:fadeIn .2s ease}
.person-panel{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(94vw,760px);max-height:88vh;display:flex;flex-direction:column;background:linear-gradient(165deg,#16161a 0%,#0e0e10 100%);border:1px solid var(--border-strong);border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.85);overflow:hidden;animation:modalIn .25s cubic-bezier(.2,.9,.3,1)}
.person-panel-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border);flex-shrink:0}
.person-panel-name{font-size:1rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.person-close{width:40px;height:40px;flex-shrink:0;border-radius:50%;border:1px solid var(--border);background:rgba(255,255,255,.04);color:var(--text-dim);font-size:1.2rem;cursor:pointer;font-family:inherit;line-height:1;display:flex;align-items:center;justify-content:center;transition:all .15s}
.person-close:hover{color:#fff;border-color:var(--border-strong)}
.person-panel-body{overflow-y:auto;padding:18px 20px 24px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
@media (max-width:599px){.person-panel{top:auto;bottom:0;left:0;right:0;transform:none;width:100%;max-height:92vh;border-radius:18px 18px 0 0}}
.person-head{display:flex;gap:18px;margin-bottom:18px}
.person-photo{width:110px;height:165px;border-radius:12px;object-fit:cover;flex-shrink:0;background:var(--surface-2);box-shadow:0 8px 24px rgba(0,0,0,.5)}
.person-photo-ph{display:flex;align-items:center;justify-content:center;font-size:2rem;color:var(--text-dim);background:linear-gradient(135deg,var(--surface-2),#1a2233)}
.person-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.person-name{font-size:1.3rem;font-weight:800;letter-spacing:-.4px;line-height:1.25}
.person-sub{font-size:.82rem;color:var(--text-dim)}
.person-rows{display:flex;flex-direction:column;gap:4px;margin-top:4px}
.person-row{font-size:.78rem;color:var(--text-dim);line-height:1.5}
.person-row b{color:var(--text);font-weight:600;margin-right:6px}
.person-bio{font-size:.86rem;color:#c0c8d6;line-height:1.65;white-space:pre-line;margin-bottom:22px;padding-top:4px;border-top:1px solid var(--border)}
.person-credits-title{font-size:.95rem;font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:8px}
.person-credits-title::before{content:'';width:3px;height:14px;border-radius:2px;background:linear-gradient(180deg,#a78bfa,#7c3aed)}
@media (max-width:480px){.person-head{flex-direction:column;align-items:center;text-align:center;gap:12px}.person-info{align-items:center}.person-photo{width:130px;height:195px}.person-rows{align-items:center}}
.btn-action.loading {color: var(--accent-2);border-color: rgba(167,139,250,.45);background: rgba(167,139,250,.12);pointer-events: none;}
.btn-action.loading svg {transform-origin: 50% 50%;animation: btnSpin .7s linear infinite;}
@keyframes btnSpin {to { transform: rotate(360deg); }}
.btn-action.loading span::after {content: '';display: inline-block;width: 0;overflow: hidden;animation: btnDots 1.2s steps(4, end) infinite;}
@keyframes btnDots {0% { content: ''; }25% { content: '.'; }50% { content: '..'; }75% { content: '...'; }}
`;
  return __pageStylesCache;
}
