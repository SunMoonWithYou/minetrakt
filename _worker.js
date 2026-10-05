/**
 * ═══════════════════════════════════════════════════════════════════════
 *  MineTrakt · 观看记录查看器
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  功能概览：
 *    · Trakt OAuth 设备码登录（PKCE 流程）
 *    · 首页流式分批注入（继续观看 / 追剧日历 / 观看记录）
 *    · 详情 modal（电影 / 剧集，含演职员、季集、相关推荐）
 *    · TMDB 异步富化（海报 / 简介 / 评分）
 *    · Infuse 8 单集跳转 + Trakt 单集跳转
 *    · PWA（manifest + Service Worker + 启动动画）
 *
 *  Cloudflare 绑定：
 *    · KV 命名空间：TMDB_CACHE
 *    · 环境变量：  TRAKT_CLIENT_ID, TMDB_API_KEY
 *
 *  关键设计决策：
 *    1. splash 在骨架写入后立即淡出，不等 streamHomeData 完成
 *    2. 所有外部 fetch 加 AbortController 超时（默认 8s）
 *    3. SW 只缓存静态资源，navigate 请求完全不拦截（直连 Worker 拿流式响应）
 *    4. 桌面端 UA 不注册 SW，且主动注销旧 SW + 清缓存；移动端才注册
 *    5. TMDB 富化由 /api/enrich 异步补齐，服务端只用 Trakt 数据同步渲染卡片
 *    6. 客户端富化用 Promise cache 去重：同一 key 的卡片共享同一请求结果
 *    7. /sync/watched/shows 加 extended=full，首屏就能拿到海报
 *    8. Infuse 8 格式：infuse://series/{tmdb_id}-{season}-{episode}
 *       并在 next_episode 为空时从已看进度反推下一集
 *    9. KV 读写优化：L1 内存缓存 + singleFlight 去重 + 边缘 cacheTtl + 后台写入
 *   10. 主题配色适配 Logo：深酒红 / 暗红黑渐变
 *   11. 顶部视觉：black-translucent 状态栏 + tabs 完全透明
 */

/* ═══════════════════════════════════════════════════════════════════════
 *  常量定义
 * ═══════════════════════════════════════════════════════════════════════ */

/** Trakt OAuth 认证服务器地址 */
const TRAKT_AUTH = 'https://auth.trakt.tv';
/** Trakt 主 API 地址 */
const TRAKT_API  = 'https://api.trakt.tv';
/** TMDB API 地址 */
const TMDB_API   = 'https://api.themoviedb.org/3';
/** TMDB 图片 CDN 基础路径（拼接 size + poster_path） */
const TMDB_IMG   = 'https://image.tmdb.org/t/p';
/** Trakt 设备码激活页 */
const ACTIVATE_URL = 'https://trakt.tv/activate';

/** 应用名（用于 PWA / <title>） */
const APP_NAME       = 'MineTrakt';
/** PWA 短名（主屏图标下方文字） */
const APP_SHORT_NAME = 'MineTrakt';
/** PWA 主题色 & 状态栏颜色（深红，与 Logo 一致） */
const THEME_COLOR    = '#2c0408';
/** 站点图标 */
const FAVICON_URL    = 'https://img.helo.de5.net/1791171500831.ico';
/** PWA 图标 192×192 */
const ICON_192       = 'https://img.helo.de5.net/1791172246538.png';
/** PWA 图标 512×512 */
const ICON_512       = 'https://img.helo.de5.net/1791172247747.png';
/** iOS 添加到主屏图标 */
const APPLE_ICON     = 'https://img.helo.de5.net/1791172247747.png';

/** 通用 JSON 请求头 */
const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'TraktViewer/1.0'
};

/** 登录态 Cookie 名称 */
const COOKIE_NAME = 'trakt_auth';
/** Cookie 最大存活时间：90 天（秒） */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 90;

/** 观看记录每页条数 */
const PAGE_SIZE = 12;
/** TMDB 命中结果的 KV 缓存时间：7 天（秒） */
const TMDB_KV_TTL = 86400 * 7;
/** 首页「继续观看」最多拉取的剧集数（用于批量查进度） */
const MAX_RECENT_SHOWS = 15;

/* ═══════════════════════════════════════════════════════════════════════
 *  通用工具：带超时的 fetch
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * 带超时控制的 fetch 封装。
 * 通过 AbortController 在指定毫秒后强制中断请求，避免 Worker 挂死。
 *
 * @param {string} url  请求地址
 * @param {RequestInit} opts   fetch 选项
 * @param {number} ms   超时毫秒数（默认 8000）
 * @returns {Promise<Response>}
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

/* ═══════════════════════════════════════════════════════════════════════
 *  KV 优化层
 *  ─────────────────────────────────────────────────────────────────────
 *  目的：把 TMDB 数据的每一次 KV 访问都压到极限，且不阻塞 HTTP 响应。
 *
 *  三层缓存：
 *    L1  内存 Map（同 isolate 共享，30s TTL）——最快，无需网络
 *    L1.5 singleFlight（同 key 并发请求共享同一 Promise）——防击穿
 *    L2  KV（边缘缓存 cacheTtl=60s + 持久化）——跨 isolate 共享
 *
 *  写入策略：
 *    写完内存立即返回，KV 写入丢给 ctx.waitUntil 后台执行——不阻塞响应
 * ═══════════════════════════════════════════════════════════════════════ */

/** L1 内存缓存 TTL：30 秒 */
const KV_MEM_TTL   = 30_000;
/** KV get 的边缘缓存 TTL（Cloudflare 最小 60 秒） */
const KV_EDGE_TTL  = 60;
/** 「确认 KV 里不存在」的哨兵值，用于区分「未查询」与「查到空」 */
const KV_MISS      = Symbol('kv-miss');

/** L1 内存缓存：key -> 缓存值（对象 / KV_MISS） */
const __kvMem      = new Map();
/** L1 过期时间戳：key -> 到期毫秒数 */
const __kvMemExp   = new Map();
/** 并发去重表：key -> 正在进行的 Promise */
const __kvInflight = new Map();

/**
 * 从 L1 内存缓存读取（自动检查过期）。
 * @returns 缓存值 / KV_MISS / undefined（未命中）
 */
function kvMemGet(key) {
  const exp = __kvMemExp.get(key);
  if (exp === undefined) return undefined;
  if (exp < Date.now()) {
    __kvMem.delete(key); __kvMemExp.delete(key);
    return undefined;
  }
  return __kvMem.get(key);
}

/**
 * 写入 L1 内存缓存，并做简单的容量清理（最多 3000 条）。
 */
function kvMemSet(key, val) {
  __kvMem.set(key, val);
  __kvMemExp.set(key, Date.now() + KV_MEM_TTL);
  if (__kvMem.size > 3000) {
    // 先清过期的
    const now = Date.now();
    for (const [k, t] of __kvMemExp) if (t < now) {
      __kvMem.delete(k); __kvMemExp.delete(k);
    }
    // 还是太大就强制删最早写入的 500 条
    if (__kvMem.size > 3000) {
      let i = 0;
      for (const k of __kvMem.keys()) {
        __kvMem.delete(k); __kvMemExp.delete(k);
        if (++i >= 500) break;
      }
    }
  }
}

/**
 * 单飞（singleFlight）：同一个 key 的并发调用会共享同一个 Promise，
 * 避免 N 个并发请求同时穿透到 KV / TMDB。
 *
 * @param {string} key  去重键
 * @param {Function} fn  真正执行任务的异步函数
 */
function singleFlight(key, fn) {
  const existing = __kvInflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    try { return await fn(); }
    finally {
      // 保留 200ms 让相邻的并发调用也能命中，然后清理
      setTimeout(() => __kvInflight.delete(key), 200);
    }
  })();
  __kvInflight.set(key, p);
  return p;
}

/**
 * 读 KV（先查 L1，再查边缘缓存的 KV）。
 *
 * @returns
 *   undefined  → KV 层不可用（未绑定 / 网络错误），调用方可选择回源
 *   KV_MISS    → 已确认 KV 中不存在该 key（会写入 L1 避免重复查询）
 *   其它       → KV 中存储的 JSON 值
 */
async function kvGetJSON(env, key) {
  if (!env.TMDB_CACHE) return undefined;

  const mem = kvMemGet(key);
  if (mem !== undefined) return mem;

  try {
    const v = await env.TMDB_CACHE.get(key, { type: 'json', cacheTtl: KV_EDGE_TTL });
    const result = (v === null || v === undefined) ? KV_MISS : v;
    kvMemSet(key, result);
    return result;
  } catch {
    // 网络错误不缓存，下次调用重试
    return undefined;
  }
}

/**
 * 写 KV（同时写 L1 + 后台写 KV，不阻塞响应）。
 *
 * @param {object} env
 * @param {ExecutionContext} ctx  用于 ctx.waitUntil 挂后台任务
 * @param {string} key
 * @param {any} payload  要序列化写入的对象
 * @param {number} ttl    KV 的 expirationTtl（秒）
 */
function kvPutJSON(env, ctx, key, payload, ttl) {
  kvMemSet(key, payload);          // 立即写 L1
  if (!env.TMDB_CACHE) return;
  const p = env.TMDB_CACHE
    .put(key, JSON.stringify(payload), { expirationTtl: ttl })
    .catch(() => {});
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
}

/* ═══════════════════════════════════════════════════════════════════════
 *  Service Worker 源码（内嵌在 Worker 中，通过 /sw.js 返回）
 *  ─────────────────────────────────────────────────────────────────────
 *  策略：
 *    · navigate 请求一律不拦截（让 Worker 直接返回流式 HTML）
 *    · /api/ 与 /auth/ 一律不拦截
 *    · 只对静态资源（图标 / manifest / 字体）做 cache-first
 * ═══════════════════════════════════════════════════════════════════════ */

const SW_JS_CONTENT = String.raw`/* MineTrakt SW —— 只缓存静态资源，绝不拦截页面导航 */
const VERSION = 'v5';
const RUNTIME_CACHE = 'trakt-static-' + VERSION;

// 立即激活新版本，不等旧页面关闭
self.addEventListener('install', function(){ self.skipWaiting(); });

// 清理旧版本缓存 + 立即接管所有页面
self.addEventListener('activate', function(e){
  e.waitUntil((async function(){
    var keys = await caches.keys();
    await Promise.all(keys.filter(function(k){ return k !== RUNTIME_CACHE; })
                          .map(function(k){ return caches.delete(k); }));
    await self.clients.claim();
  })());
});

// 仅对静态资源做 cache-first
self.addEventListener('fetch', function(event){
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch(e){ return; }
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/sw.js') return;

  /* navigate 请求一律不拦截 —— 保证页面流式渲染直连 Worker */
  if (req.mode === 'navigate') return;

  /* API 与认证接口不缓存 */
  if (url.pathname.indexOf('/api/') === 0) return;
  if (url.pathname.indexOf('/auth/') === 0) return;

  /* 图标 / manifest / 字体走 cache-first */
  if (url.pathname === '/manifest.webmanifest'
      || url.pathname === '/favicon.ico'
      || /\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
  }
});

async function cacheFirst(req){
  var cached = await caches.match(req);
  if (cached) return cached;
  try {
    var r = await fetch(req);
    if (r && r.ok) {
      var c = await caches.open(RUNTIME_CACHE);
      c.put(req, r.clone()).catch(function(){});
    }
    return r;
  } catch(e) {
    return new Response('', { status: 504 });
  }
}
`;

/* ═══════════════════════════════════════════════════════════════════════
 *  路由入口
 * ═══════════════════════════════════════════════════════════════════════ */

export default {
  /**
   * Worker 主入口。根据 path 分发到不同 handler。
   * 注意：/api/season、/api/detail、/api/enrich、首页都会用到 KV，
   *      因此需要把 ctx（ExecutionContext）透传下去。
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 认证相关
    if (path === '/auth/device') return handleDevice(env);
    if (path === '/auth/poll' && request.method === 'POST') return handlePoll(request, env);
    if (path === '/auth/logout' && request.method === 'POST') return handleLogout();

    // 数据 API
    if (path === '/api/more') return handleMore(request, env);
    if (path === '/api/season') return handleSeason(request, env, ctx);
    if (path === '/api/detail') return handleApiDetail(request, env, ctx);
    if (path === '/api/enrich' && request.method === 'POST') return handleEnrich(request, env, ctx);

    // PWA 静态资源
    if (path === '/favicon.ico') return handleFavicon();
    if (path === '/manifest.webmanifest') return handleManifest();
    if (path === '/sw.js') return handleServiceWorker();

    // 默认走首页
    return handleHome(request, env, ctx);
  }
};

/* ═══════════════════════════════════════════════════════════════════════
 *  PWA 资源
 * ═══════════════════════════════════════════════════════════════════════ */

/** favicon 直接 302 跳转到外部图床 */
function handleFavicon() {
  return Response.redirect(FAVICON_URL, 302);
}

/** 返回 PWA manifest（JSON） */
function handleManifest() {
  const manifest = {
    name: APP_NAME,
    short_name: APP_SHORT_NAME,
    description: '继续观看 · 追剧日历 · 观看记录',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: THEME_COLOR,
    theme_color: THEME_COLOR,
    lang: 'zh-CN',
    icons: [
      { src: ICON_192, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: ICON_512, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: ICON_512, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
  return new Response(JSON.stringify(manifest), {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'public, max-age=86400'
    }
  });
}

/** 返回内嵌的 Service Worker 源码 */
function handleServiceWorker() {
  return new Response(SW_JS_CONTENT, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      // 不允许缓存，方便随时更新 SW
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Service-Worker-Allowed': '/'
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════
 *  Trakt 认证（OAuth Device Flow + PKCE）
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * 第一步：向 Trakt 请求设备码 + 用户码。
 * 生成 PKCE code_verifier / code_challenge 一起发送。
 * 返回给前端的 state 中携带 device_code 与 code_verifier（base64url 编码）。
 */
async function handleDevice(env) {
  const codeVerifier = randomString(64);
  const codeChallenge = await pkceChallenge(codeVerifier);

  let res;
  try {
    res = await fetchT(`${TRAKT_AUTH}/oauth/device/code`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        client_id: env.TRAKT_CLIENT_ID,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
      })
    }, 10000);
  } catch (e) {
    return Response.json({ error: '网络请求失败: ' + String(e) }, { status: 502 });
  }

  if (!res.ok) {
    const errText = await res.text();
    return Response.json({
      error: `Trakt 返回错误 (${res.status})`,
      detail: errText,
      hint: res.status === 403 ? 'TRAKT_CLIENT_ID 可能不正确' : ''
    }, { status: 502 });
  }

  const data = await res.json();
  // 把 device_code + code_verifier 打包到 state，前端轮询时带回
  const state = b64urlEncode(JSON.stringify({
    device_code: data.device_code,
    code_verifier: codeVerifier
  }));

  return Response.json({
    state,
    user_code: data.user_code,
    verification_url: ACTIVATE_URL,
    interval: data.interval,
    expires_in: data.expires_in
  });
}

/**
 * 第二步：轮询 Trakt 检查用户是否已授权。
 * 成功时把 access_token / refresh_token 打包写入 Cookie。
 *
 * 响应语义（对应前端 status 判断）：
 *   200 → 授权成功，已 Set-Cookie
 *   202 → 还在等待（authorization_pending / slow_down）
 *   403 → 用户拒绝
 *   410 → 设备码过期 / 已使用
 *   502 → 其它错误
 */
async function handlePoll(request, env) {
  let body;
  try { body = await request.json(); } catch {
    return new Response('bad request', { status: 400 });
  }
  if (!body.state) return new Response('missing state', { status: 400 });

  let decoded;
  try { decoded = JSON.parse(b64urlDecode(body.state)); }
  catch { return new Response('bad state', { status: 400 }); }

  let res;
  try {
    res = await fetchT(`${TRAKT_AUTH}/oauth/device/token`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        code: decoded.device_code,
        client_id: env.TRAKT_CLIENT_ID,
        code_verifier: decoded.code_verifier
      })
    }, 10000);
  } catch (e) {
    return Response.json({ status: 'network_error', detail: String(e) }, { status: 502 });
  }

  // 成功：写入 Cookie
  if (res.ok) {
    const data = await res.json();
    const auth = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
      code_verifier: decoded.code_verifier
    };
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': buildCookie(auth) }
    });
  }

  // 失败：解析 Trakt 的错误码
  const rawText = await res.text();
  let err = 'unknown';
  try { err = JSON.parse(rawText).error; } catch {}

  switch (err) {
    case 'authorization_pending':
    case 'slow_down':
      return Response.json({ status: err }, { status: 202 });
    case 'access_denied':
      return Response.json({ status: 'denied', raw: rawText }, { status: 403 });
    case 'expired_token':
    case 'already_used':
      return Response.json({ status: 'expired', raw: rawText }, { status: 410 });
    default:
      return Response.json({ status: 'error', detail: err, http: res.status, raw: rawText }, { status: 502 });
  }
}

/** 登出：清空 Cookie（Max-Age=0） */
function handleLogout() {
  return new Response(null, {
    status: 204,
    headers: { 'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0` }
  });
}

/** 把 auth 对象序列化为 base64url 并写入 Cookie 头 */
function buildCookie(auth) {
  const encoded = b64urlEncode(JSON.stringify(auth));
  return `${COOKIE_NAME}=${encoded}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`;
}

/** 从请求 Cookie 中读取 auth 对象，失败返回 null */
function readAuth(request) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!m) return null;
  try { return JSON.parse(b64urlDecode(m[1])); } catch { return null; }
}

/**
 * 若 access_token 快过期（30 分钟内），用 refresh_token 换新的。
 * 成功返回新 auth 对象；失败返回 null（调用方据此判定登录失效）。
 */
async function refreshIfNeeded(auth, env) {
  if (auth.expires_at - Date.now() > 30 * 60_000) return auth;
  let res;
  try {
    res = await fetchT(`${TRAKT_AUTH}/oauth/token`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        refresh_token: auth.refresh_token,
        client_id: env.TRAKT_CLIENT_ID,
        code_verifier: auth.code_verifier,
        grant_type: 'refresh_token',
        redirect_uri: 'urn:ietf:wg:oauth:2.0:oob'
      })
    }, 10000);
  } catch { return null; }
  if (!res.ok) return null;
  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    code_verifier: auth.code_verifier
  };
}

/** 构造 Trakt API 所需的请求头 */
function makeTraktHeaders(env, auth) {
  return {
    'Content-Type': 'application/json',
    'trakt-api-version': '2',
    'trakt-api-key': env.TRAKT_CLIENT_ID,
    'Authorization': `Bearer ${auth.access_token}`,
    'User-Agent': 'TraktViewer/1.0'
  };
}

/**
 * Trakt GET 请求（带 429 重试）。
 * 失败返回 { __error: string } 以便调用方检测。
 */
async function traktGet(url, headers, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetchT(url, { headers }, 10000);
      if (r.status === 429) {
        // 指数退避：1s / 2s / 4s
        const wait = Math.min(1000 * Math.pow(2, i), 4000);
        await new Promise(res => setTimeout(res, wait));
        continue;
      }
      if (!r.ok) return { __error: `HTTP ${r.status}` };
      return await r.json();
    } catch (e) {
      if (i === retries) return { __error: String(e) };
      await new Promise(res => setTimeout(res, 800 * (i + 1)));
    }
  }
  return { __error: 'retries exhausted' };
}

/* ═══════════════════════════════════════════════════════════════════════
 *  TMDB 数据抓取（带 KV 缓存）
 * ═══════════════════════════════════════════════════════════════════════ */

/** 简单 GET TMDB，失败返回 null */
async function tmdbGet(url) {
  try {
    const r = await fetchT(url, {}, 8000);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/**
 * 带三级缓存的 TMDB 详情获取。
 *   L1 内存（30s）→ singleFlight → KV（边缘 + 持久化）→ TMDB 回源
 *
 * @param {string} path  例如 `/tv/123?append_to_response=credits,recommendations`
 * @param {object} env
 * @param {ExecutionContext} ctx
 * @param {number} ttl   KV 缓存秒数（默认 1 天）
 */
async function tmdbDetailCached(path, env, ctx, ttl = 86400) {
  if (!env.TMDB_API_KEY) return null;
  const cacheKey = `td:${path}`;

  // ① L1 内存命中
  const mem = kvMemGet(cacheKey);
  if (mem !== undefined) {
    if (mem === KV_MISS) return null;
    return mem.miss ? null : mem.data;
  }

  // ② singleFlight → KV → TMDB 回源
  return singleFlight(cacheKey, async () => {
    const cached = await kvGetJSON(env, cacheKey);
    if (cached !== undefined && cached !== KV_MISS) {
      return cached.miss ? null : cached.data;
    }

    const url = `${TMDB_API}${path}${path.includes('?') ? '&' : '?'}language=zh-CN&api_key=${env.TMDB_API_KEY}`;
    const d = await tmdbGet(url);

    // 后台写 KV + 立即写 L1
    kvPutJSON(env, ctx, cacheKey, d ? { data: d } : { miss: true }, ttl);
    return d;
  });
}

/** 拼接 TMDB 海报 URL（默认 w342） */
function tmdbPoster(path, size = 'w342') {
  if (!path) return null;
  return `${TMDB_IMG}/${size}${path}`;
}

/* ═══════════════════════════════════════════════════════════════════════
 *  卡片数据模型
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * 从 Trakt 的 history / playback / calendar 条目中提取卡片所需的通用字段。
 *
 * 返回结构：
 *   {
 *     tag, tagClass,           // 标签文案 & CSS class（movie / episode / upcoming）
 *     title, overview, poster, rating,
 *     line1,                   // 副标题（年份 或 S01E01 · 标题）
 *     detailType, detailId,    // 点击打开详情 modal 用
 *     enrichKey, enrichTitle, enrichYear  // 异步富化用
 *   }
 */
function buildBaseItem(traktItem) {
  const base = {
    tag: '', tagClass: '',
    title: '', overview: '', poster: null, rating: null,
    line1: '',
    detailType: null, detailId: null,
    enrichKey: null, enrichTitle: '', enrichYear: ''
  };

  // 判断类型：优先 type 字段，否则根据字段推断
  let kind = traktItem.type;
  if (!kind) {
    if (traktItem.show && traktItem.episode) kind = 'episode';
    else if (traktItem.movie) kind = 'movie';
  }

  if (kind === 'movie' || traktItem.movie) {
    const m = traktItem.movie || {};
    base.tag = '电影';
    base.tagClass = 'movie';
    base.title = m.title || '';
    base.overview = m.overview || '';
    base.poster = posterOfTrakt(m);
    base.line1 = m.year ? String(m.year) : '';
    base.detailType = 'movie';
    base.detailId = m.ids?.trakt ? String(m.ids.trakt) : null;
    base.enrichTitle = m.title || '';
    base.enrichYear = m.year ? String(m.year) : '';
    // 优先用 TMDB id 富化，其次 IMDb，最后标题 + 年份
    if (m.ids?.tmdb)      base.enrichKey = 'movie:tmdb:' + m.ids.tmdb;
    else if (m.ids?.imdb) base.enrichKey = 'movie:imdb:' + m.ids.imdb;
    else if (m.title)     base.enrichKey = 'movie:title:' + m.title + ':' + (m.year || '');
  } else if (kind === 'episode' || (traktItem.show && traktItem.episode)) {
    const e = traktItem.episode || {}, s = traktItem.show || {};
    base.tag = '剧集';
    base.tagClass = 'episode';
    base.title = s.title || '';
    base.overview = s.overview || '';
    base.poster = posterOfTrakt(s);
    base.line1 = `S${pad(e.season)}E${pad(e.number)}${e.title ? ' · ' + e.title : ''}`;
    base.detailType = 'show';
    base.detailId = s.ids?.trakt ? String(s.ids.trakt) : null;
    base.enrichTitle = s.title || '';
    base.enrichYear = s.year ? String(s.year) : '';
    if (s.ids?.tmdb)      base.enrichKey = 'tv:tmdb:' + s.ids.tmdb;
    else if (s.ids?.tvdb) base.enrichKey = 'tv:tvdb:' + s.ids.tvdb;
    else if (s.title)     base.enrichKey = 'tv:title:' + s.title + ':' + (s.year || '');
  }

  return base;
}

/* ═══════════════════════════════════════════════════════════════════════
 *  /api/enrich —— TMDB 异步富化
 *  ─────────────────────────────────────────────────────────────────────
 *  浏览器把卡片上的 data-enrich-key 收集起来批量 POST 到这里，
 *  服务端对每个 key 查 TMDB（带 KV 三级缓存），返回 { key: data|null }。
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * 解析 enrichKey，例如：
 *   movie:tmdb:12345         → { kind:'movie', source:'tmdb', value:'12345' }
 *   tv:imdb:tt1234567        → { kind:'tv',    source:'imdb', value:'tt1234567' }
 *   tv:title:甄嬛传:2011      → { kind:'tv',    source:'title', title:'甄嬛传', year:'2011' }
 */
function parseEnrichKey(key) {
  if (!key) return null;
  const i1 = key.indexOf(':');
  if (i1 < 0) return null;
  const i2 = key.indexOf(':', i1 + 1);
  if (i2 < 0) return null;
  const kind = key.slice(0, i1);
  const source = key.slice(i1 + 1, i2);
  const rest = key.slice(i2 + 1);
  if (kind !== 'movie' && kind !== 'tv') return null;

  // title 类型可能带年份后缀（末段 4 位数字）
  if (source === 'title') {
    const lastColon = rest.lastIndexOf(':');
    if (lastColon > 0) {
      const maybeYear = rest.slice(lastColon + 1);
      if (/^\d{4}$/.test(maybeYear)) {
        return { kind, source, title: rest.slice(0, lastColon), year: maybeYear };
      }
    }
    return { kind, source, title: rest, year: '' };
  }
  return { kind, source, value: rest };
}

/**
 * 单个 key 的富化：查 TMDB → 提取 { title, overview, poster, rating }。
 * 同样使用 L1 + singleFlight + KV 三层缓存。
 */
async function enrichOne(key, env, ctx) {
  if (!env.TMDB_API_KEY) return null;
  const parsed = parseEnrichKey(key);
  if (!parsed) return null;

  const cacheKey = `e:${key}`;

  // ① L1
  const mem = kvMemGet(cacheKey);
  if (mem !== undefined) {
    if (mem === KV_MISS) return null;
    return mem.miss ? null : mem.data;
  }

  // ② singleFlight → KV → TMDB
  return singleFlight(cacheKey, async () => {
    const c = await kvGetJSON(env, cacheKey);
    if (c !== undefined && c !== KV_MISS) {
      return c.miss ? null : c.data;
    }

    const { kind, source } = parsed;
    const lang = 'zh-CN';
    const apiKey = env.TMDB_API_KEY;
    let d = null;

    // 根据 source 选择不同查询路径
    if (source === 'tmdb') {
      d = await tmdbGet(`${TMDB_API}/${kind}/${parsed.value}?language=${lang}&api_key=${apiKey}`);
    } else if (source === 'imdb') {
      const find = await tmdbGet(`${TMDB_API}/find/${parsed.value}?external_source=imdb_id&language=${lang}&api_key=${apiKey}`);
      if (find) {
        const arr = kind === 'movie' ? find.movie_results : find.tv_results;
        if (arr && arr.length) {
          d = await tmdbGet(`${TMDB_API}/${kind}/${arr[0].id}?language=${lang}&api_key=${apiKey}`);
        }
      }
    } else if (source === 'tvdb') {
      const find = await tmdbGet(`${TMDB_API}/find/${parsed.value}?external_source=tvdb_id&language=${lang}&api_key=${apiKey}`);
      if (find && find.tv_results && find.tv_results.length) {
        d = await tmdbGet(`${TMDB_API}/tv/${find.tv_results[0].id}?language=${lang}&api_key=${apiKey}`);
      }
    } else if (source === 'title') {
      const q = encodeURIComponent(parsed.title);
      const yp = parsed.year ? `&year=${parsed.year}` : '';
      const search = await tmdbGet(`${TMDB_API}/search/${kind}?query=${q}${yp}&language=${lang}&api_key=${apiKey}`);
      if (search && search.results && search.results.length) {
        d = await tmdbGet(`${TMDB_API}/${kind}/${search.results[0].id}?language=${lang}&api_key=${apiKey}`);
      }
    }

    const result = (d && (d.title || d.name)) ? {
      title: d.title || d.name || '',
      overview: d.overview || '',
      poster: d.poster_path ? tmdbPoster(d.poster_path) : null,
      rating: d.vote_average || null
    } : null;

    // 命中缓存 7 天；miss 只缓存 1 小时，避免脏数据长期占据
    kvPutJSON(
      env, ctx, cacheKey,
      result ? { data: result } : { miss: true },
      result ? TMDB_KV_TTL : 3600
    );

    return result;
  });
}

/**
 * 批量富化入口。
 * 一次最多处理 80 个 key，返回 { [key]: 数据|null }。
 */
async function handleEnrich(request, env, ctx) {
  let body;
  try { body = await request.json(); } catch {
    return Response.json({}, { status: 400 });
  }
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) return Response.json({});

  const limited = rawItems.slice(0, 80);
  const out = {};
  const seen = new Set();
  const tasks = [];

  for (const it of limited) {
    const key = it && it.key;
    if (!key || seen.has(key)) continue;   // 去重
    seen.add(key);
    tasks.push(
      enrichOne(key, env, ctx)
        .then(d => { out[key] = d; })
        .catch(() => { out[key] = null; })
    );
  }

  await Promise.all(tasks);

  return new Response(JSON.stringify(out), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=600'
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════
 *  首页 —— 流式分批注入
 *  ─────────────────────────────────────────────────────────────────────
 *  流程：
 *    ① 写 <head> + splash 骨架
 *    ② 写首页骨架（hero / stats / tabs / pane 容器）
 *    ③ 立即隐藏 splash（不等数据）
 *    ④ streamHomeData：并发拉数据 → 分块写入 <script> 注入 DOM
 *    ⑤ 写 pageTail（SW 注册）
 *
 *  这样用户 800ms 内就能看到骨架 + 动画，数据在后续流式补齐。
 * ═══════════════════════════════════════════════════════════════════════ */

async function handleHome(request, env, ctx) {
  const url = new URL(request.url);

  // 支持 /detail/movie/123 与 ?d=movie/123 两种深链
  let initialDetail = url.searchParams.get('d');
  if (!initialDetail && url.pathname.startsWith('/detail/')) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length === 3) initialDetail = parts[1] + '/' + parts[2];
  }

  // 无 Cookie 直接给登录页
  const cookieAuth = readAuth(request);
  if (!cookieAuth) return html(renderLoginPage());

  // 登录态自动续期
  const auth = await refreshIfNeeded(cookieAuth, env);
  if (!auth) return html(renderLoginPage());

  const needsCookieUpdate = auth.access_token !== cookieAuth.access_token;

  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'X-Accel-Buffering': 'no'   // 让 Nginx / Cloudflare 不缓冲流式响应
  };
  if (needsCookieUpdate) headers['Set-Cookie'] = buildCookie(auth);

  // 创建流式管道
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const write = (s) => writer.write(enc.encode(s)).catch(() => {});

  // 后台异步写：把 HTML 分块推给浏览器
  const job = (async () => {
    try {
      await write(pageHead());

      // 触发一次 reflow 让 splash 动画开始计时
      await write(`<script>(function(){
        var s=document.getElementById('splash');
        if(s){ void s.offsetHeight; }
        window.__splashT0=Date.now();
      })();<\/script>`);

      await new Promise(r => setTimeout(r, 80));

      // 写首页骨架
      await write(renderHomeSkeleton(initialDetail));

      // 骨架写完即可隐藏 splash，不等数据
      await write(splashHideScript());

      // 流式补充数据
      await streamHomeData(env, auth, write);

      await write(pageTail());
    } catch (e) {
      // 兜底：把 splash 改成错误提示
      await write(`<script>(function(){
        var s=document.getElementById('splash');
        if(!s)return;
        s.innerHTML='<div style="color:#ff8080;font-size:.9rem;font-family:-apple-system,BlinkMacSystemFont,\\'PingFang SC\\',sans-serif">加载失败，请刷新重试</div>';
      })();<\/script>`);
      await write(pageTail());
    } finally {
      try { await writer.close(); } catch {}
    }
  })();
  ctx.waitUntil(job);

  return new Response(readable, { headers });
}

/**
 * 返回一段 <script>，让 splash 至少显示 800ms 后再淡出。
 * 避免数据太快回来时动画一闪而过。
 */
function splashHideScript() {
  return `<script>(function(){
    var s = document.getElementById('splash');
    if (!s) return;
    var t0 = window.__splashT0 || Date.now();
    var MIN = 800;
    var wait = Math.max(0, MIN - (Date.now() - t0));
    setTimeout(function(){
      s.classList.add('hide');
      setTimeout(function(){
        if (s && s.parentNode) s.parentNode.removeChild(s);
      }, 420);
    }, wait);
  })();<\/script>`;
}

/**
 * 首页数据并发拉取 + 分块注入。
 * 每个 pane（继续观看 / 日历 / 历史）都并发：
 *   · Trakt API 数据 → 渲染 HTML 字符串
 *   · 通过 <script> 注入 innerHTML
 *
 * 任一 pane 出错不影响其它 pane。
 */
async function streamHomeData(env, auth, write) {
  const headers = makeTraktHeaders(env, auth);
  const today = new Date().toISOString().split('T')[0];

  /** 带重试的 Trakt JSON 请求（额外读取 X-Pagination-Page-Count 头） */
  const fetchJson = async (url, retries = 3) => {
    for (let i = 0; i <= retries; i++) {
      try {
        const r = await fetchT(url, { headers }, 9000);

        if (r.status === 429) {
          const retryAfter = parseInt(r.headers.get('Retry-After') || '0');
          const wait = retryAfter > 0 ? retryAfter * 1000 : Math.min(1000 * Math.pow(2, i), 8000);
          if (i < retries) {
            await new Promise(resolve => setTimeout(resolve, wait));
            continue;
          }
          return { __error: `HTTP 429`, __pageCount: 1 };
        }

        if (!r.ok) return { __error: `HTTP ${r.status}`, __pageCount: 1 };

        const data = await r.json();
        const pageCount = parseInt(r.headers.get('X-Pagination-Page-Count') || '1');
        // 把分页信息挂到数组上，方便后续「加载更多」
        if (Array.isArray(data)) {
          Object.defineProperty(data, '__pageCount', { value: pageCount, enumerable: false });
        }
        return data;
      } catch (e) {
        if (i === retries) return { __error: String(e), __pageCount: 1 };
        await new Promise(resolve => setTimeout(resolve, 800 * (i + 1)));
      }
    }
  };

  // 6 个 API 并发拉取
  const [profile, history, playback, watchedShows, calendar, stats] = await Promise.all([
    fetchJson(`${TRAKT_API}/users/me`),
    fetchJson(`${TRAKT_API}/users/me/history?limit=${PAGE_SIZE}&page=1&extended=full&images=poster`),
    fetchJson(`${TRAKT_API}/sync/playback?extended=full&images=poster`),
    fetchJson(`${TRAKT_API}/sync/watched/shows?extended=full&limit=100`),
    fetchJson(`${TRAKT_API}/calendars/my/shows/${today}/30?extended=full&images=poster`),
    fetchJson(`${TRAKT_API}/users/me/stats`)
  ]);

  // 用户信息 / 统计
  const username = (profile && !profile.__error && profile.username) || '我';
  const displayName = (profile && !profile.__error && profile.name) || username;
  const movieCount = stats && !stats.__error && stats.movies ? stats.movies.watched : 0;
  const episodeCount = stats && !stats.__error && stats.episodes ? stats.episodes.watched : 0;
  const showCount = stats && !stats.__error && stats.shows ? stats.shows.watched : 0;
  const totalHours = stats && !stats.__error && stats.episodes && stats.episodes.minutes
    ? Math.round(stats.episodes.minutes / 60) : 0;

  const statsInner = `
    <div class="stat"><div class="stat-num">${movieCount}</div><div class="stat-label">电影</div></div>
    <div class="stat"><div class="stat-num">${showCount}</div><div class="stat-label">剧集</div></div>
    <div class="stat"><div class="stat-num">${episodeCount}</div><div class="stat-label">集数</div></div>
    <div class="stat"><div class="stat-num">${totalHours}</div><div class="stat-label">小时</div></div>
  `;

  // 首屏最先注入：欢迎语 + 统计
  await write(`<script>(function(){
    var g=document.getElementById('hero-greet');
    if(g) g.textContent=${jsStr('欢迎回来 · @' + username)};
    var n=document.getElementById('hero-name');
    if(n) n.textContent=${jsStr(displayName)};
    var s=document.getElementById('stats-box');
    if(s) s.innerHTML=${jsStr(statsInner)};
  })();<\/script>`);

  const historyPageCount = history.__pageCount || 1;

  /* ── 观看记录 pane ── */
  const pushHistory = (async () => {
    try {
      const htmlOut = renderHistoryPage(history, env);
      const moreHtml = historyPageCount > 1
        ? `<div class="load-more-wrap"><button class="load-more" data-page="2" onclick="loadMoreHistory(this)">加载更多</button></div>`
        : '';
      await write(`<script>(function(){
        var el=document.querySelector('#history .grid');
        if(el) el.innerHTML=${jsStr(htmlOut)};
        var m=document.getElementById('history-more');
        if(m) m.innerHTML=${jsStr(moreHtml)};
        if (window.__scheduleEnrich) window.__scheduleEnrich();
      })();<\/script>`);
    } catch (e) {
      await write(`<script>(function(){
        var el=document.querySelector('#history .grid');
        if(el) el.innerHTML='<div class="empty"><p>观看记录加载失败</p></div>';
      })();<\/script>`);
    }
  })();

  /* ── 追剧日历 pane ── */
  const pushCalendar = (async () => {
    try {
      const htmlOut = renderCalendarPage(calendar, env);
      await write(`<script>(function(){
        var el=document.getElementById('calendar');
        if(el) el.innerHTML=${jsStr(htmlOut)};
        if (window.__scheduleEnrich) window.__scheduleEnrich();
      })();<\/script>`);
    } catch (e) {
      await write(`<script>(function(){
        var el=document.getElementById('calendar');
        if(el) el.innerHTML='<div class="empty"><p>日历加载失败</p></div>';
      })();<\/script>`);
    }
  })();

  /* ── 继续观看 pane ── */
  const pushPlayback = (async () => {
    try {
      // 取最近观看过的 15 部剧集
      const recentShows = (Array.isArray(watchedShows) ? watchedShows : [])
        .filter(w => w.show?.ids?.trakt)
        .sort((a, b) => {
          const ta = a.last_watched_at || a.last_updated_at || '';
          const tb = b.last_watched_at || b.last_updated_at || '';
          return tb.localeCompare(ta);
        })
        .slice(0, MAX_RECENT_SHOWS);

      // 并发拉取每部剧的观看进度
      const progressList = await Promise.all(recentShows.map(async w => {
        const id = w.show.ids.trakt;
        try {
          const r = await fetchT(
            `${TRAKT_API}/shows/${id}/progress/watched?hidden=false&specials=false`,
            { headers },
            8000
          );
          if (!r.ok) return null;
          const p = await r.json();
          return { show: w.show, last_watched_at: w.last_watched_at, progress: p };
        } catch { return null; }
      }));

      const htmlOut = renderContinueItems(playback, progressList, env);
      await write(`<script>(function(){
        var el=document.getElementById('playback');
        if(el) el.innerHTML=${jsStr(htmlOut)};
        if (window.__scheduleEnrich) window.__scheduleEnrich();
      })();<\/script>`);
    } catch (e) {
      await write(`<script>(function(){
        var el=document.getElementById('playback');
        if(el) el.innerHTML='<div class="empty"><p>继续观看加载失败</p></div>';
      })();<\/script>`);
    }
  })();

  await Promise.all([pushHistory, pushCalendar, pushPlayback]);
}

/* ═══════════════════════════════════════════════════════════════════════
 *  首页骨架 HTML
 *  ─────────────────────────────────────────────────────────────────────
 *  包含：hero、stats、tabs、三个 pane 容器、modal 骨架，
 *  以及所有客户端 JS（tabs 切换、modal 打开关闭、懒加载富化等）。
 * ═══════════════════════════════════════════════════════════════════════ */

function renderHomeSkeleton(initialDetail) {
  // 深链：直接打开详情 modal
  const boot = initialDetail ? `<script>
    window.addEventListener('load', () => {
      const s = ${jsStr(initialDetail)};
      const idx = s.indexOf('/');
      if (idx > 0) openDetail(s.slice(0, idx), s.slice(idx + 1), false);
    });
  <\/script>` : '';

  return `
    <div class="container">

      <header class="hero">
        <div class="hero-left">
          <div>
            <p class="hero-greet" id="hero-greet">欢迎回来</p>
            <h1 class="hero-name" id="hero-name">…</h1>
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn-ghost" onclick="location.reload()">刷新</button>
          <button class="btn-ghost" onclick="logout()">退出</button>
        </div>
      </header>

      <div class="stats" id="stats-box">
        <div class="stat"><div class="stat-num">–</div><div class="stat-label">电影</div></div>
        <div class="stat"><div class="stat-num">–</div><div class="stat-label">剧集</div></div>
        <div class="stat"><div class="stat-num">–</div><div class="stat-label">集数</div></div>
        <div class="stat"><div class="stat-num">–</div><div class="stat-label">小时</div></div>
      </div>

      <nav class="tabs">
        <button class="tab active" data-tab="playback">继续观看</button>
        <button class="tab" data-tab="calendar">追剧日历</button>
        <button class="tab" data-tab="history">观看记录</button>
      </nav>

      <section id="playback" class="pane active"><div class="pane-loading"><div class="spinner"></div></div></section>
      <section id="calendar" class="pane"><div class="pane-loading"><div class="spinner"></div></div></section>
      <section id="history" class="pane"><div class="grid"></div><div id="history-more"></div></section>
    </div>

    <div id="modal" class="modal">
      <div class="modal-backdrop" onclick="closeDetail()"></div>
      <div class="modal-panel">
        <div class="modal-body" id="modal-body"></div>
        <button class="modal-close" onclick="closeDetail()" aria-label="关闭">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
            <path d="M6 6l12 12M18 6L6 18"/>
          </svg>
        </button>
      </div>
    </div>

    <script>
      /* ────────── Tab 切换 ────────── */
      document.querySelectorAll('.tab').forEach(t => {
        t.addEventListener('click', () => {
          document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
          document.querySelectorAll('.pane').forEach(x => x.classList.remove('active'));
          t.classList.add('active');
          document.getElementById(t.dataset.tab).classList.add('active');
        });
      });

      /* ────────── 登出 ────────── */
      async function logout() {
        await fetch('/auth/logout', { method: 'POST' });
        location.reload();
      }

      /* ────────── 历史记录「加载更多」 ────────── */
      async function loadMoreHistory(btn) {
        const page = parseInt(btn.dataset.page || '2');
        btn.disabled = true;
        btn.textContent = '加载中…';
        try {
          const r = await fetch('/api/more?type=history&page=' + page);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const htmlText = await r.text();
          document.querySelector('#history .grid').insertAdjacentHTML('beforeend', htmlText);
          if (window.__scheduleEnrich) window.__scheduleEnrich();

          const hasMore = r.headers.get('X-Has-More') === 'true';
          if (hasMore) {
            btn.dataset.page = page + 1;
            btn.disabled = false;
            btn.textContent = '加载更多';
          } else {
            btn.textContent = '已经到底啦';
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'default';
          }
        } catch (e) {
          btn.textContent = '加载失败，点击重试';
          btn.disabled = false;
        }
      }

      /* ────────── 详情 modal ────────── */
      let modalLoadingId = 0;

      async function openDetail(type, id, push = true) {
        const modal = document.getElementById('modal');
        const body = document.getElementById('modal-body');
        if (!modal || !body) return;

        modal.classList.add('open');
        document.body.style.overflow = 'hidden';

        if (push && location.pathname !== '/detail/' + type + '/' + id) {
          history.pushState({ detail: true }, '', '/detail/' + type + '/' + id);
        }

        // 用递增 ID 做竞态保护：只有最新的一次请求才写入 DOM
        const reqId = ++modalLoadingId;
        body.innerHTML = '<div class="modal-loading"><div class="spinner"></div></div>';
        body.scrollTop = 0;

        try {
          const r = await fetch('/api/detail?type=' + encodeURIComponent(type)
                              + '&id=' + encodeURIComponent(id));
          if (reqId !== modalLoadingId) return;
          if (!r.ok) throw new Error('HTTP ' + r.status);
          body.innerHTML = await r.text();
        } catch (e) {
          if (reqId !== modalLoadingId) return;
          body.innerHTML = '<div class="modal-error">加载失败</div>';
        }
      }

      function closeDetail(push = true) {
        const modal = document.getElementById('modal');
        if (!modal) return;
        modal.classList.remove('open');
        document.body.style.overflow = '';
        if (push && location.pathname.startsWith('/detail/')) {
          history.pushState({}, '', '/');
        }
      }

      // 事件委托：任何带 data-detail-type 的元素点击都打开详情
      document.addEventListener('click', (e) => {
        const el = e.target.closest('[data-detail-type]');
        if (!el) return;
        const t = el.dataset.detailType;
        const i = el.dataset.detailId;
        if (!t || !i) return;
        e.preventDefault();
        openDetail(t, i);
      });

      // ESC 关闭
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDetail();
      });

      // 季折叠
      document.addEventListener('click', (e) => {
        const head = e.target.closest('.season-head');
        if (!head) return;
        toggleSeason(head);
      });

      // 单集点击 → 新窗口打开 Trakt 页面
      document.addEventListener('click', (e) => {
        const ep = e.target.closest('.episode');
        if (!ep) return;
        const url = ep.dataset.traktUrl;
        if (!url) return;
        e.preventDefault();
        e.stopPropagation();
        window.open(url, '_blank', 'noopener');
      });

      /** 展开/收起某一季；首次展开时懒加载剧集列表 */
      async function toggleSeason(headEl) {
        const item = headEl.closest('.season-item');
        const body = item.querySelector('.season-body');
        if (item.classList.contains('open')) {
          item.classList.remove('open');
          return;
        }
        item.classList.add('open');
        if (body.dataset.loaded) return;    // 已加载过
        body.innerHTML = '<div class="modal-loading" style="padding:24px"><div class="spinner"></div></div>';
        try {
          const r = await fetch('/api/season?show=' + encodeURIComponent(headEl.dataset.show)
                              + '&season=' + encodeURIComponent(headEl.dataset.season)
                              + '&tmdb=' + encodeURIComponent(headEl.dataset.tmdb)
                              + '&slug=' + encodeURIComponent(headEl.dataset.slug || ''));
          if (!r.ok) throw new Error('HTTP ' + r.status);
          body.innerHTML = await r.text();
          body.dataset.loaded = '1';
        } catch (e) {
          body.innerHTML = '<div class="modal-error" style="padding:20px">加载失败</div>';
        }
      }

      // 浏览器前进/后退：根据 URL 决定打开/关闭 modal
      window.addEventListener('popstate', () => {
        const path = location.pathname;
        if (path.startsWith('/detail/')) {
          const parts = path.split('/').filter(Boolean);
          if (parts.length === 3) openDetail(parts[1], parts[2], false);
        } else {
          closeDetail(false);
        }
      });

      /* ────────── 详情 modal 预取 ────────── */
      const __prefetched = new Set();
      function __prefetchDetail(type, id) {
        if (!type || !id) return;
        const key = type + '/' + id;
        if (__prefetched.has(key)) return;
        if (__prefetched.size > 60) return;
        __prefetched.add(key);
        fetch('/api/detail?type=' + encodeURIComponent(type)
            + '&id=' + encodeURIComponent(id), { cache: 'default' })
          .catch(() => {});
      }
      // 移动端：touchstart 预取（提前 100~300ms）
      document.addEventListener('touchstart', (e) => {
        const el = e.target.closest('[data-detail-type]');
        if (el) __prefetchDetail(el.dataset.detailType, el.dataset.detailId);
      }, { passive: true, capture: true });
      // 桌面端：mouseover 预取
      document.addEventListener('mouseover', (e) => {
        const el = e.target.closest('[data-detail-type]');
        if (el) __prefetchDetail(el.dataset.detailType, el.dataset.detailId);
      }, { passive: true });

      /* ══════════════════════ TMDB 异步富化 ══════════════════════
       * 收集所有 [data-enrich-key] 元素 → 批量 POST /api/enrich
       * → 结果按 key 回填到对应卡片（海报 / 标题 / 简介 / 评分）
       */
      let __enrichTimer = null;
      const __enrichPromises = new Map();

      /** 节流调度：60ms 内的多次调用只触发一次 */
      function __scheduleEnrich() {
        if (__enrichTimer) return;
        __enrichTimer = setTimeout(__runEnrich, 60);
      }
      window.__scheduleEnrich = __scheduleEnrich;

      async function __runEnrich() {
        __enrichTimer = null;
        const els = [...document.querySelectorAll('[data-enrich-key]')];
        if (!els.length) return;

        // 按 key 分组，同 key 的多个元素共享一次请求
        const byKey = new Map();
        for (const el of els) {
          const k = el.dataset.enrichKey;
          if (!k) continue;
          if (!byKey.has(k)) byKey.set(k, []);
          byKey.get(k).push(el);
          el.removeAttribute('data-enrich-key');   // 防止重复处理
        }
        if (!byKey.size) return;

        // 已经请求过的 key 直接复用 Promise
        const needFetch = [];
        for (const [k, group] of byKey.entries()) {
          const existing = __enrichPromises.get(k);
          if (existing) {
            existing.then(d => {
              if (d) group.forEach(el => __applyEnrich(el, d));
            });
          } else {
            needFetch.push(k);
          }
        }

        if (!needFetch.length) return;

        const items = needFetch.map(k => {
          const el = byKey.get(k)[0];
          return {
            key: k,
            title: el.dataset.enrichTitle || '',
            year: el.dataset.enrichYear || ''
          };
        });

        // 批量请求
        const batchPromise = fetch('/api/enrich', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items })
        })
          .then(r => (r.ok ? r.json() : {}))
          .catch(() => ({}));

        // 为每个 key 挂一个「从批量结果中提取自己」的 Promise
        for (const k of needFetch) {
          const perKey = batchPromise.then(data => (data && data[k]) || null);
          __enrichPromises.set(k, perKey);
          perKey.then(d => {
            if (d) byKey.get(k).forEach(el => __applyEnrich(el, d));
          });
        }

        // 简单的容量保护：超过 400 条时清掉最早的 200 条
        if (__enrichPromises.size > 400) {
          const arr = [...__enrichPromises.keys()];
          for (let i = 0; i < 200; i++) __enrichPromises.delete(arr[i]);
        }
      }

      /** 把富化数据应用到卡片 DOM */
      function __applyEnrich(el, d) {
        // 1) 海报
        const posterBox = el.querySelector('.poster');
        if (posterBox && d.poster) {
          const cur = posterBox.querySelector('img, .poster-ph');
          if (cur && cur.tagName === 'IMG') {
            if (cur.src !== d.poster) cur.src = d.poster;
          } else if (cur) {
            const img = document.createElement('img');
            img.src = d.poster;
            img.loading = 'lazy';
            img.alt = '';
            cur.replaceWith(img);
          }
        }
        // 2) 标题
        if (d.title) {
          const nameEl = el.querySelector('.name');
          if (nameEl && nameEl.textContent !== d.title) nameEl.textContent = d.title;
        }
        // 3) 简介（如果没有 .overview 就动态插入到 .meta 之后）
        if (d.overview) {
          const info = el.querySelector('.info');
          if (info) {
            let ov = info.querySelector('.overview');
            if (!ov) {
              ov = document.createElement('div');
              ov.className = 'overview';
              const meta = info.querySelector('.meta');
              if (meta && meta.nextSibling) {
                info.insertBefore(ov, meta.nextSibling);
              } else {
                info.appendChild(ov);
              }
            }
            ov.textContent = d.overview;
          }
        }
        // 4) 评分
        if (d.rating && posterBox) {
          let rating = posterBox.querySelector('.rating');
          if (!rating) {
            rating = document.createElement('span');
            rating.className = 'rating';
            posterBox.appendChild(rating);
          }
          rating.textContent = '★ ' + Number(d.rating).toFixed(1);
        }
      }

      // 页面完全加载后补一次富化（兜底）
      window.addEventListener('load', () => {
        setTimeout(__runEnrich, 200);
      });
    <\/script>
    ${boot}
  `;
}

/* ═══════════════════════════════════════════════════════════════════════
 *  启动动画（Splash）
 * ═══════════════════════════════════════════════════════════════════════ */

function renderSplash() {
  return `<div id="splash" class="splash" style="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;overflow:hidden;background:radial-gradient(circle at 50% 45%,#2c0408 0%,#0a0102 62%)">
  <div class="splash-glow"></div>
  <div class="splash-inner">
    <div class="splash-logo">
      <svg viewBox="0 0 24 24" width="76" height="76" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/>
        <path d="M10 8l6 4-6 4V8z" fill="currentColor"/>
      </svg>
    </div>
    <div class="splash-name">MineTrakt</div>
    <div class="splash-bar"><div class="splash-bar-fill"></div></div>
  </div>
</div>`;
}

/* ═══════════════════════════════════════════════════════════════════════
 *  /api/more —— 观看记录分页加载
 * ═══════════════════════════════════════════════════════════════════════ */

async function handleMore(request, env) {
  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  const page = parseInt(url.searchParams.get('page') || '2');

  const cookieAuth = readAuth(request);
  if (!cookieAuth) return new Response('unauthorized', { status: 401 });

  const auth = await refreshIfNeeded(cookieAuth, env);
  if (!auth) return new Response('unauthorized', { status: 401 });

  const headers = makeTraktHeaders(env, auth);

  if (type === 'history') {
    let r;
    try {
      // 429 时指数退避最多重试 3 次
      for (let i = 0; i < 3; i++) {
        r = await fetchT(`${TRAKT_API}/users/me/history?limit=${PAGE_SIZE}&page=${page}&extended=full&images=poster`, { headers }, 9000);
        if (r.status !== 429) break;
        const wait = Math.min(1000 * Math.pow(2, i), 5000);
        await new Promise(resolve => setTimeout(resolve, wait));
      }
    } catch (e) {
      return new Response('', { status: 502 });
    }
    if (!r.ok) return new Response('', { status: r.status });

    const items = await r.json();
    const pageCount = parseInt(r.headers.get('X-Pagination-Page-Count') || '1');
    const hasMore = page < pageCount;

    // 返回 HTML 片段（前端 insertAdjacentHTML）
    const bodyHtml = renderHistoryPage(items, env, true);

    const outHeaders = {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Has-More': String(hasMore),
      'X-Page': String(page),
      'X-Page-Count': String(pageCount)
    };
    if (auth.access_token !== cookieAuth.access_token) {
      outHeaders['Set-Cookie'] = buildCookie(auth);
    }
    return new Response(bodyHtml, { headers: outHeaders });
  }

  return new Response('', { status: 400 });
}

/* ═══════════════════════════════════════════════════════════════════════
 *  /api/detail —— 详情 modal 数据
 *  ─────────────────────────────────────────────────────────────────────
 *  同时拉取：
 *    · Trakt 实体（含 extended full + images）
 *    · 用户观看进度（剧集）/ 观看记录（电影）
 *    · TMDB 详情（含 credits + recommendations）
 *    · 用户当前季的剧集列表（用于首屏展开）
 * ═══════════════════════════════════════════════════════════════════════ */

async function handleApiDetail(request, env, ctx) {
  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  const rawId = url.searchParams.get('id');

  if (!type || !rawId || (type !== 'movie' && type !== 'show')) {
    return new Response('bad params', { status: 400 });
  }

  const cookieAuth = readAuth(request);
  if (!cookieAuth) return new Response('unauthorized', { status: 401 });
  const auth = await refreshIfNeeded(cookieAuth, env);
  if (!auth) return new Response('unauthorized', { status: 401 });
  const needsCookieUpdate = auth.access_token !== cookieAuth.access_token;
  const headers = makeTraktHeaders(env, auth);

  // 若 id 是 tmdb-xxx 格式（来自推荐卡片），先反查 Trakt id
  let traktId = rawId;
  if (rawId.startsWith('tmdb-')) {
    const tmdbId = rawId.slice(5);
    const arr = await traktGet(`${TRAKT_API}/search/tmdb/${tmdbId}?type=${type}`, headers);
    if (!Array.isArray(arr) || !arr.length) {
      return new Response(simpleErr('找不到对应条目'), {
        status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    const key = type === 'movie' ? 'movie' : 'show';
    traktId = arr[0][key]?.ids?.trakt;
    if (!traktId) {
      return new Response(simpleErr('找不到对应条目'), {
        status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
  }

  // 并发拉取 Trakt 实体 / 进度 / 已看电影
  const [entity, userProgress, watchedMovies] = await Promise.all([
    traktGet(`${TRAKT_API}/${type}s/${traktId}?extended=full,images`, headers),
    type === 'show'
      ? traktGet(`${TRAKT_API}/shows/${traktId}/progress/watched?hidden=false&specials=false`, headers)
      : Promise.resolve(null),
    type === 'movie'
      ? traktGet(`${TRAKT_API}/sync/watched/movies`, headers)
      : Promise.resolve(null)
  ]);

  if (!entity || entity.__error) {
    return new Response(simpleErr('无法加载详情：' + (entity?.__error || '未知')), {
      status: 502, headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  // 电影：在已看电影列表里找当前这条
  let movieWatched = null;
  if (Array.isArray(watchedMovies)) {
    movieWatched = watchedMovies.find(x => x.movie?.ids?.trakt === entity.ids?.trakt) || null;
  }

  // 剧集：猜测用户当前正在看的季（用于默认展开）
  let guessedSeason = null;
  if (type === 'show' && userProgress && !userProgress.__error) {
    if (userProgress.next_episode?.season) {
      guessedSeason = userProgress.next_episode.season;
    } else if (Array.isArray(userProgress.seasons)) {
      const w = userProgress.seasons.filter(s => s.completed > 0);
      if (w.length) guessedSeason = w[w.length - 1].number;
    }
  }

  const tmdbId = entity.ids?.tmdb;
  const t = type === 'movie' ? 'movie' : 'tv';

  // 并发拉取 TMDB 详情 + 猜测季数据
  const [tmdbData, guessedSeasonData] = await Promise.all([
    (tmdbId && env.TMDB_API_KEY)
      ? tmdbDetailCached(`/${t}/${tmdbId}?append_to_response=credits,recommendations`, env, ctx)
      : Promise.resolve(null),
    (guessedSeason != null && tmdbId && env.TMDB_API_KEY)
      ? tmdbDetailCached(`/tv/${tmdbId}/season/${guessedSeason}`, env, ctx)
      : Promise.resolve(null)
  ]);

  let credits = null, recommendations = null;
  if (tmdbData) { credits = tmdbData.credits; recommendations = tmdbData.recommendations; }

  // 决定首屏展开的季
  let initialSeasonNum = guessedSeason;
  if (initialSeasonNum == null && tmdbData?.seasons?.length) {
    const real = tmdbData.seasons.filter(s => s.season_number > 0);
    if (real.length) initialSeasonNum = real[0].season_number;
  }

  // 如果猜测季与首屏展开季不一致，需要重新拉一次
  let initialSeasonData = guessedSeasonData;
  if (initialSeasonNum != null && guessedSeason !== initialSeasonNum && tmdbId && env.TMDB_API_KEY) {
    initialSeasonData = await tmdbDetailCached(`/tv/${tmdbId}/season/${initialSeasonNum}`, env, ctx);
  }

  const bodyHtml = await renderDetailFragment({
    type, entity, traktId,
    userProgress, movieWatched,
    tmdb: tmdbData, credits, recommendations,
    initialSeasonNum, initialSeasonData
  });

  const outHeaders = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'private, max-age=120, stale-while-revalidate=300'
  };
  if (needsCookieUpdate) outHeaders['Set-Cookie'] = buildCookie(auth);
  return new Response(bodyHtml, { headers: outHeaders });
}

/* ═══════════════════════════════════════════════════════════════════════
 *  /api/season —— 展开某一季时懒加载剧集列表
 * ═══════════════════════════════════════════════════════════════════════ */

async function handleSeason(request, env, ctx) {
  const url = new URL(request.url);
  const showId = url.searchParams.get('show');
  const seasonNum = parseInt(url.searchParams.get('season') || '0');
  const tmdbId = url.searchParams.get('tmdb');
  const slug = url.searchParams.get('slug') || '';
  if (!showId || isNaN(seasonNum)) return new Response('bad params', { status: 400 });

  const cookieAuth = readAuth(request);
  if (!cookieAuth) return new Response('unauthorized', { status: 401 });
  const auth = await refreshIfNeeded(cookieAuth, env);
  if (!auth) return new Response('unauthorized', { status: 401 });
  const needsCookieUpdate = auth.access_token !== cookieAuth.access_token;
  const headers = makeTraktHeaders(env, auth);

  // 并发拉取 Trakt 进度 + TMDB 该季详情
  const [progress, seasonData] = await Promise.all([
    traktGet(`${TRAKT_API}/shows/${showId}/progress/watched?hidden=false&specials=false`, headers),
    tmdbId && env.TMDB_API_KEY
      ? tmdbDetailCached(`/tv/${tmdbId}/season/${seasonNum}`, env, ctx)
      : Promise.resolve(null)
  ]);

  const seasonProgress = Array.isArray(progress?.seasons)
    ? progress.seasons.find(s => s.number === seasonNum)
    : null;

  const bodyHtml = renderSeasonEpisodes(seasonProgress, seasonData, seasonNum, slug);

  const outHeaders = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'private, max-age=300'
  };
  if (needsCookieUpdate) outHeaders['Set-Cookie'] = buildCookie(auth);
  return new Response(bodyHtml, { headers: outHeaders });
}

/* ═══════════════════════════════════════════════════════════════════════
 *  登录页
 * ═══════════════════════════════════════════════════════════════════════ */

function renderLoginPage() {
  return pageShell(`
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-logo">
          <svg viewBox="0 0 24 24" width="52" height="52" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
            <path d="M10 8l6 4-6 4V8z" fill="currentColor"/>
          </svg>
        </div>
        <h1 class="login-title">Trakt</h1>
        <p class="login-sub">继续观看 · 追剧日历 · 观看记录</p>
        <div id="login-area" class="login-area">
          <button class="btn-primary" onclick="startLogin()">使用 Trakt 登录</button>
        </div>
      </div>
    </div>
    <script>
      /* 设备码流程：
       *   ① GET /auth/device 拿 user_code + state
       *   ② 展示二维码 + user_code 让用户去 trakt.tv/activate 授权
       *   ③ 每 interval 秒 POST /auth/poll 轮询
       *   ④ 收到 200 → 刷新页面（此时已有 Cookie）
       */
      async function startLogin() {
        const area = document.getElementById('login-area');
        area.innerHTML = '<div class="spinner"></div>';

        let r;
        try { r = await fetch('/auth/device'); }
        catch (e) {
          area.innerHTML = '<p class="err">网络错误: ' + e + '</p>';
          return;
        }

        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          area.innerHTML =
            '<div class="err-box">' +
              '<p class="err-title">获取设备码失败</p>' +
              '<p class="err">' + (err.error || ('HTTP ' + r.status)) + '</p>' +
              (err.detail ? '<pre class="err-detail">' + err.detail + '</pre>' : '') +
              (err.hint ? '<p class="hint">' + err.hint + '</p>' : '') +
            '</div>' +
            '<button class="btn-primary" onclick="location.reload()">重试</button>';
          return;
        }

        const d = await r.json();
        const activateUrl = 'https://trakt.tv/activate';
        // 二维码指向激活页（用主题深红做前景色）
        const qr = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&color=8f0b18&bgcolor=ffffff&data='
          + encodeURIComponent(activateUrl);

        area.innerHTML =
          '<div class="device-flow">' +
            '<div class="steps">' +
              '<div class="step"><span class="n">1</span><span>打开 <a href="' + activateUrl + '" target="_blank" rel="noopener">trakt.tv/activate</a></span></div>' +
              '<div class="step"><span class="n">2</span><span>输入代码</span></div>' +
            '</div>' +
            '<div class="code-box">' + d.user_code + '</div>' +
            '<div class="step"><span class="n">3</span><span>点击授权</span></div>' +
            '<div class="qr-box"><img src="' + qr + '" alt="QR"></div>' +
            '<p id="status" class="status"><span class="pulse"></span>等待授权中…</p>' +
          '</div>' +
          '<details class="log-details"><summary>调试日志</summary><div id="log" class="log-box"></div></details>';

        let interval = (d.interval || 5) * 1000;
        let attempt = 0;
        const logEl = document.getElementById('log');
        const log = (s) => { if (logEl) logEl.innerHTML += '<div>[' + new Date().toLocaleTimeString() + '] ' + s + '</div>'; };

        // 轮询逻辑
        const tick = async () => {
          attempt++;
          let r2;
          try {
            r2 = await fetch('/auth/poll', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ state: d.state })
            });
          } catch (e) { log('网络错误'); setTimeout(tick, interval); return; }

          if (r2.status === 200) {
            document.getElementById('status').innerHTML = '✓ 授权成功，正在刷新…';
            document.getElementById('status').className = 'status success';
            setTimeout(() => location.reload(), 400);
            return;
          }

          let text = '';
          try { text = await r2.text(); } catch {}
          let data = {};
          try { data = JSON.parse(text); } catch {}
          log('HTTP ' + r2.status + ' · ' + (data.status || '未知'));

          const st = document.getElementById('status');
          if (r2.status === 202) {
            // slow_down：拉长轮询间隔
            if (data.status === 'slow_down') interval += 2000;
            st.innerHTML = '<span class="pulse"></span>等待授权中（第 ' + attempt + ' 次）';
            setTimeout(tick, interval);
            return;
          }
          st.textContent = 'HTTP ' + r2.status + ' · ' + (data.status || data.detail || '未知');
          st.className = 'status error';
          // 用户拒绝 / 过期 → 停止轮询
          if (r2.status === 403 || r2.status === 410) return;
          setTimeout(tick, interval);
        };
        setTimeout(tick, 1000);
      }
    <\/script>
  `);
}

/* ═══════════════════════════════════════════════════════════════════════
 *  卡片渲染
 * ═══════════════════════════════════════════════════════════════════════ */

/** 从 Trakt 对象的 images.poster 字段中提取海报 URL */
function posterOfTrakt(obj) {
  if (!obj || !obj.images) return null;
  const p = obj.images.poster;
  if (!p || !Array.isArray(p) || !p.length) return null;
  if (typeof p[0] === 'string') return p[0];
  if (typeof p[0] === 'object') return p[0].medium || p[0].thumb || p[0].full || null;
  return null;
}

/**
 * 生成单张卡片 HTML。
 * 若传入 detailType + detailId，卡片整体可点击打开 modal；
 * 若传入 enrichKey，卡片会被客户端富化逻辑补齐海报/简介/评分。
 */
function mediaItem({ poster, tag, tagClass, title, overview, line1, line2, rating, pct, delay,
                     detailType, detailId, enrichKey, enrichTitle, enrichYear }) {
  const style = delay != null ? ` style="animation-delay:${delay}ms"` : '';
  const bar = pct != null
    ? `<div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>`
    : '';
  const ratingHtml = rating
    ? `<span class="rating">★ ${Number(rating).toFixed(1)}</span>`
    : '';
  const dataAttrs = (detailType && detailId)
    ? ` data-detail-type="${esc(detailType)}" data-detail-id="${esc(detailId)}" role="button" tabindex="0"`
    : '';
  const enrichAttrs = enrichKey
    ? ` data-enrich-key="${esc(enrichKey)}" data-enrich-title="${esc(enrichTitle || '')}" data-enrich-year="${esc(enrichYear || '')}"`
    : '';
  const clickable = (detailType && detailId) ? ' clickable' : '';

  return `<div class="item${clickable}"${dataAttrs}${enrichAttrs}${style}>
    <div class="poster">
      ${poster
        ? `<img src="${poster}" loading="lazy" alt="">`
        : `<div class="poster-ph"><span>${tagClass === 'movie' ? '🎬' : '📺'}</span></div>`}
      <span class="tag ${tagClass}">${tag}</span>
      ${ratingHtml}
    </div>
    <div class="info">
      <div class="name">${esc(title)}</div>
      ${line1 ? `<div class="meta">${esc(line1)}</div>` : ''}
      ${overview ? `<div class="overview">${esc(overview)}</div>` : ''}
      ${line2 ? `<div class="meta dim">${esc(line2)}</div>` : ''}
      ${bar}
    </div>
  </div>`;
}

/**
 * 渲染观看记录列表。
 * @param {boolean} isFragment  片段模式（用于 /api/more 返回的 HTML）
 */
function renderHistoryPage(items, env, isFragment = false) {
  if (!Array.isArray(items)) return isFragment ? '' : errBox('观看记录', items);
  if (!items.length) return isFragment ? '' : emptyState('还没有观看记录');

  return items.map((item, i) => {
    const when = fmtRelative(item.watched_at);
    // 首屏做错峰动画；片段模式不做（避免每次加载都闪）
    const delay = isFragment ? 0 : Math.min(i, 24) * 20;
    const e = buildBaseItem(item);

    return mediaItem({
      poster: e.poster, tag: e.tag, tagClass: e.tagClass,
      title: e.title, overview: e.overview,
      line1: e.line1, line2: when, rating: e.rating, delay,
      detailType: e.detailType, detailId: e.detailId,
      enrichKey: e.enrichKey, enrichTitle: e.enrichTitle, enrichYear: e.enrichYear
    });
  }).join('');
}

/**
 * 渲染「继续观看」列表。
 * 数据来源两处：
 *   · playback      —— Trakt 记录的播放进度（未看完）
 *   · progressList  —— 每部剧集的「下一集」
 * 合并去重后按时间倒序展示。
 */
function renderContinueItems(playback, progressList, env) {
  const items = [];

  // 先塞入正在播放中的项
  if (Array.isArray(playback)) {
    for (const p of playback) {
      items.push({ source: 'playback', sortKey: p.paused_at || '', raw: p });
    }
  }

  // 再补充「下一集」
  for (const item of progressList) {
    if (!item || !item.progress) continue;
    const p = item.progress;
    const next = p.next_episode;
    if (!next) continue;
    // 全部看完 → 跳过
    if (p.aired > 0 && p.completed >= p.aired) continue;
    // 下一集还未播出 → 跳过
    if (next.first_aired && new Date(next.first_aired).getTime() > Date.now()) continue;

    // 与 playback 里的当前项重复 → 跳过
    const showId = item.show.ids.trakt;
    const dup = items.some(c =>
      c.source === 'playback' &&
      c.raw.show?.ids?.trakt === showId &&
      c.raw.episode?.season === next.season &&
      c.raw.episode?.number === next.number
    );
    if (dup) continue;

    items.push({
      source: 'next',
      sortKey: item.last_watched_at,
      raw: { type: 'episode', show: item.show, episode: next, progress: null }
    });
  }

  // 按时间倒序
  items.sort((a, b) => (b.sortKey || '').localeCompare(a.sortKey || ''));

  if (!items.length) {
    return `<div class="empty">
      <svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25">
        <circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/>
      </svg>
      <p>暂时没有继续观看的内容</p>
      <p style="font-size:0.82rem;color:#7a6266;margin-top:10px;line-height:1.6;text-align:center">
        去 Trakt 上标记一些已看剧集后，这里会显示下一集
      </p>
    </div>`;
  }

  const parts = items.map((it, i) => {
    const delay = Math.min(i, 24) * 20;
    const item = it.raw;
    const pct = typeof item.progress === 'number' ? Math.round(item.progress) : null;
    const ep = item.episode || {};

    const epTag = ep.season != null && ep.number != null ? `S${pad(ep.season)}E${pad(ep.number)}` : '';
    const subLine = pct != null ? `已看 ${pct}%` : (epTag ? `下一集 ${epTag}` : '下一集');

    const e = buildBaseItem(item);

    return mediaItem({
      poster: e.poster, tag: e.tag, tagClass: e.tagClass,
      title: e.title, overview: e.overview,
      line1: e.line1, line2: subLine, rating: e.rating, pct, delay,
      detailType: e.detailType, detailId: e.detailId,
      enrichKey: e.enrichKey, enrichTitle: e.enrichTitle, enrichYear: e.enrichYear
    });
  });

  return `<div class="grid">${parts.join('')}</div>`;
}

/**
 * 渲染追剧日历。
 * 按北京时间把剧集分组到「天」，同一天内按播出时间排序。
 */
function renderCalendarPage(calendar, env) {
  if (!Array.isArray(calendar)) return errBox('追剧日历', calendar);
  if (!calendar.length) return emptyState('未来 30 天没有待播剧集');

  /** 把 ISO 时间转成北京时间 YYYY-MM-DD */
  const toBeijingDay = (iso) => {
    if (!iso) return '';
    const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  };

  // 按天分组
  const groups = new Map();
  for (const item of calendar) {
    const day = toBeijingDay(item.first_aired);
    if (!day) continue;
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(item);
  }

  const today = toBeijingDay(new Date().toISOString());
  const out = [];

  for (const [day, items] of groups.entries()) {
    const d = new Date(day + 'T00:00:00Z');
    const wd = ['周日','周一','周二','周三','周四','周五','周六'][d.getUTCDay()];
    const isToday = day === today;

    const parts = items.map((item) => {
      let timeStr = '';
      if (item.first_aired) {
        const bj = new Date(new Date(item.first_aired).getTime() + 8 * 3600 * 1000);
        timeStr = `${String(bj.getUTCHours()).padStart(2, '0')}:${String(bj.getUTCMinutes()).padStart(2, '0')} 北京时间`;
      }

      const e = buildBaseItem(item);

      return mediaItem({
        poster: e.poster, tag: '待播', tagClass: 'upcoming',
        title: e.title || '未知节目',
        overview: e.overview,
        line1: e.line1, line2: timeStr, rating: e.rating,
        detailType: e.detailType, detailId: e.detailId,
        enrichKey: e.enrichKey, enrichTitle: e.enrichTitle, enrichYear: e.enrichYear
      });
    });

    out.push(`<div class="day">
      <div class="day-head">
        <span class="day-num">${day.slice(8)}</span>
        <div>
          <div class="day-mon">${day.slice(0,7)}</div>
          <div class="day-wd">${wd}</div>
        </div>
        ${isToday ? '<span class="today">今天</span>' : ''}
      </div>
      <div class="grid">${parts.join('')}</div>
    </div>`);
  }

  return out.join('');
}

/* ═══════════════════════════════════════════════════════════════════════
 *  详情 modal 内容
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * 渲染详情 modal 主体（电影或剧集）。
 * 包含：hero（海报 + 背景 + 元信息 + 状态 + Infuse 按钮）、
 *      演职员列表、季集折叠面板、相关推荐。
 */
async function renderDetailFragment(d) {
  const {
    type, entity, traktId, userProgress, movieWatched,
    tmdb, credits, recommendations, initialSeasonNum, initialSeasonData
  } = d;
  const isMovie = type === 'movie';

  // ── 基础字段：优先 TMDB，回落 Trakt ──
  const title    = (tmdb && (tmdb.title || tmdb.name)) || entity.title || '';
  const overview = (tmdb && tmdb.overview) || entity.overview || '';
  const year     = (((tmdb?.release_date || tmdb?.first_air_date || '') + '')).slice(0, 4)
                 || (entity.year ? String(entity.year) : '');
  const ratingRaw = tmdb?.vote_average ?? entity.rating;
  const rating   = ratingRaw ? Number(ratingRaw) : null;
  const runtimeMin = tmdb?.runtime
    || (tmdb?.episode_run_time && tmdb.episode_run_time[0])
    || entity.runtime || 0;
  const runtimeStr = runtimeMin
    ? (runtimeMin >= 60 ? `${Math.floor(runtimeMin / 60)}h ${runtimeMin % 60}m` : `${runtimeMin}m`)
    : '';
  const genres   = (tmdb?.genres?.map(g => g.name).join(' · '))
                 || (entity.genres || []).join(' · ');
  const poster   = tmdb?.poster_path ? tmdbPoster(tmdb.poster_path, 'w500') : posterOfTrakt(entity);
  const backdrop = tmdb?.backdrop_path ? tmdbPoster(tmdb.backdrop_path, 'w1280') : null;
  const tagline  = entity.tagline || '';

  const showSlug = entity.ids?.slug || '';

  /* ── 观看状态条 ── */
  let statusHtml = '';
  if (isMovie) {
    if (movieWatched) {
      statusHtml = `<div class="d-status done">
        <div class="d-status-icon">✓</div>
        <div>
          <div class="d-status-title">已观看</div>
          <div class="d-status-sub">${movieWatched.plays} 次 · ${fmtRelative(movieWatched.last_watched_at)}</div>
        </div>
      </div>`;
    } else {
      statusHtml = `<div class="d-status">
        <div class="d-status-icon">○</div>
        <div>
          <div class="d-status-title">未观看</div>
          <div class="d-status-sub">还没有在 Trakt 上标记</div>
        </div>
      </div>`;
    }
  } else if (userProgress && !userProgress.__error && userProgress.aired > 0) {
    const pct = Math.round((userProgress.completed / userProgress.aired) * 100);
    statusHtml = `<div class="d-status done" style="flex-direction:column;align-items:stretch;gap:8px">
      <div style="display:flex;gap:12px;align-items:center">
        <div class="d-status-icon">▶</div>
        <div style="flex:1">
          <div class="d-status-title">已看 ${userProgress.completed} / ${userProgress.aired} 集 · ${pct}%</div>
          <div class="d-status-sub">${userProgress.last_watched_at ? '上次 ' + fmtRelative(userProgress.last_watched_at) : ''}</div>
        </div>
      </div>
      <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  } else {
    statusHtml = `<div class="d-status">
      <div class="d-status-icon">○</div>
      <div>
        <div class="d-status-title">尚未观看</div>
        <div class="d-status-sub">还没有观看记录</div>
      </div>
    </div>`;
  }

  /* ── Infuse 跳转按钮 ──
   * 官方格式：
   *   电影：infuse://movie/{tmdb_id}
   *   剧集：infuse://series/{tmdb_id}-{season}-{episode}
   *   不加 ?play → 打开详情页；加 ?play → 自动播放
   */
  let infuseHtml = '';
  if (isMovie && tmdb?.id) {
    const movieUrl = `infuse://movie/${tmdb.id}`;
    infuseHtml = `
      <a class="infuse-btn" href="${esc(movieUrl)}" rel="noopener">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        在 Infuse 中查看
      </a>`;
  } else if (!isMovie && tmdb?.id) {
    /* 找「下一集」：
     *   优先用 Trakt 的 next_episode；
     *   若为空（例如已追完当前季但还没标记下一季），
     *   从各季已看进度反推下一集。 */
    let ne = (userProgress && !userProgress.__error) ? userProgress.next_episode : null;

    if (!ne && userProgress && !userProgress.__error && Array.isArray(userProgress.seasons)) {
      outer:
      for (let i = userProgress.seasons.length - 1; i >= 0; i--) {
        const s = userProgress.seasons[i];
        if (!s || s.completed <= 0 || !Array.isArray(s.episodes)) continue;
        for (let j = s.episodes.length - 1; j >= 0; j--) {
          const ep = s.episodes[j];
          if (ep && ep.completed) {
            ne = { season: s.number, number: ep.number + 1 };
            break outer;
          }
        }
      }
    }

    const hasEp = ne && ne.season != null && ne.number != null;
    const infuseUrl = hasEp
      ? `infuse://series/${tmdb.id}-${ne.season}-${ne.number}`
      : `infuse://series/${tmdb.id}`;
    const label = hasEp
      ? `在 Infuse 中查看 S${pad(ne.season)}E${pad(ne.number)}`
      : '在 Infuse 中查看';

    infuseHtml = `
      <a class="infuse-btn" href="${esc(infuseUrl)}" rel="noopener">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        ${esc(label)}
      </a>`;
  }

  /* ── 演职员（取前 20 位） ── */
  const cast = (credits?.cast || []).slice(0, 20);
  const castHtml = cast.map(c => `
    <div class="cast">
      ${c.profile_path
        ? `<img class="cast-img" src="${TMDB_IMG}/w185${c.profile_path}" loading="lazy" alt="">`
        : `<div class="cast-img cast-ph">${esc((c.name || '?')[0])}</div>`}
      <div class="cast-name">${esc(c.name || '')}</div>
      <div class="cast-role">${esc(c.character || '')}</div>
    </div>
  `).join('');

  /* ── 相关推荐（取前 12 条）── */
  const recs = (recommendations?.results || []).slice(0, 12);
  const recsHtml = recs.map((r, i) => mediaItem({
    poster: tmdbPoster(r.poster_path),
    tag: isMovie ? '电影' : '剧集',
    tagClass: isMovie ? 'movie' : 'episode',
    title: r.title || r.name || '',
    line1: (((r.release_date || r.first_air_date || '') + '')).slice(0, 4),
    rating: r.vote_average || null,
    delay: i * 20,
    detailType: isMovie ? 'movie' : 'episode',
    // 注意：detailType 用 movie / show，detailId 用 tmdb-xxx 让服务端反查
    detailId: 'tmdb-' + r.id
  })).join('');

  /* ── 季集折叠面板 ── */
  let seasonsHtml = '';
  if (!isMovie && tmdb?.seasons?.length) {
    // 把 Trakt 进度按季号映射，便于查找
    const progressSeasons = new Map();
    if (Array.isArray(userProgress?.seasons)) {
      userProgress.seasons.forEach(s => progressSeasons.set(s.number, s));
    }
    // 过滤掉第 0 季（特别篇）
    const seasons = tmdb.seasons.filter(s => s.season_number > 0);

    seasonsHtml = `<div class="seasons">${seasons.map(s => {
      const sp = progressSeasons.get(s.season_number);
      const total = s.episode_count || 0;
      const watched = sp?.completed || 0;
      // 首屏只展开 initialSeasonNum 那一季
      const isOpen = s.season_number === initialSeasonNum;
      const bodyContent = isOpen && initialSeasonData
        ? renderSeasonEpisodes(sp, initialSeasonData, s.season_number, showSlug)
        : '';
      return `<div class="season-item${isOpen ? ' open' : ''}">
        <button class="season-head"
                data-show="${esc(String(traktId))}"
                data-season="${s.season_number}"
                data-tmdb="${esc(String(tmdb.id))}"
                data-slug="${esc(showSlug)}">
          <span class="season-title">${esc(s.name || ('第 ' + s.season_number + ' 季'))}</span>
          <span class="season-meta">${watched} / ${total} 集</span>
          <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </button>
        <div class="season-body"${isOpen ? ' data-loaded="1"' : ''}>${bodyContent}</div>
      </div>`;
    }).join('')}</div>`;
  }

  return `
    <div class="detail-wrap">
      <div class="detail-hero">
        ${backdrop ? `<img class="detail-bg" src="${backdrop}" alt="">` : ''}
        <div class="detail-inner">
          ${poster
            ? `<img class="detail-poster" src="${poster}" alt="">`
            : `<div class="detail-poster detail-poster-ph">${isMovie ? '🎬' : '📺'}</div>`}
          <div class="detail-info">
            <h1 class="detail-title">${esc(title)}</h1>
            ${tagline ? `<div class="detail-tagline">${esc(tagline)}</div>` : ''}
            <div class="detail-meta">
              ${year ? `<span>${esc(year)}</span>` : ''}
              ${runtimeStr ? `<span>${esc(runtimeStr)}</span>` : ''}
              ${rating ? `<span class="detail-rating">★ ${rating.toFixed(1)}</span>` : ''}
            </div>
            ${genres ? `<div class="detail-genres">${esc(genres)}</div>` : ''}
            ${overview ? `<p class="detail-overview">${esc(overview)}</p>` : ''}
            ${statusHtml}
            ${infuseHtml}
          </div>
        </div>
      </div>

      <div class="detail-body">
        ${castHtml ? `<section class="d-section">
          <h2 class="d-section-title">演员</h2>
          <div class="cast-scroll">${castHtml}</div>
        </section>` : ''}

        ${seasonsHtml ? `<section class="d-section">
          <h2 class="d-section-title">季与集</h2>
          ${seasonsHtml}
        </section>` : ''}

        ${recsHtml ? `<section class="d-section">
          <h2 class="d-section-title">相关推荐</h2>
          <div class="grid">${recsHtml}</div>
        </section>` : ''}
      </div>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════════════════
 *  季集列表渲染
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * 渲染某一季的所有剧集行。
 * 已看的行会加上 watched class + ✓ 标记；
 * 若 Trakt 有 slug 则整行可点击，新窗口打开 Trakt 单集页面。
 */
function renderSeasonEpisodes(seasonProgress, tmdbSeason, seasonNum, showSlug) {
  if (!tmdbSeason || !Array.isArray(tmdbSeason.episodes) || !tmdbSeason.episodes.length) {
    return '<div class="ep-empty">暂无剧集信息</div>';
  }
  // 把已看进度按集号建索引
  const watched = new Map();
  if (Array.isArray(seasonProgress?.episodes)) {
    seasonProgress.episodes.forEach(e => watched.set(e.number, e));
  }
  return tmdbSeason.episodes.map(ep => {
    const w = watched.get(ep.episode_number);
    const isWatched = !!w?.completed;
    const traktUrl = showSlug
      ? `https://trakt.tv/shows/${showSlug}/seasons/${seasonNum}/episodes/${ep.episode_number}`
      : '';
    const clickable = traktUrl ? ' clickable' : '';
    const attrs = traktUrl
      ? ` data-trakt-url="${esc(traktUrl)}" role="link" tabindex="0" title="在 Trakt 中打开"`
      : '';
    return `<div class="episode${isWatched ? ' watched' : ''}${clickable}"${attrs}>
      <div class="ep-num">E${pad(ep.episode_number)}</div>
      <div class="ep-body">
        <div class="ep-title">${esc(ep.name || '')}</div>
        ${ep.overview ? `<div class="ep-overview">${esc(ep.overview)}</div>` : ''}
      </div>
      ${isWatched ? '<div class="ep-check">✓</div>' : ''}
    </div>`;
  }).join('');
}

/** 简单错误块（用于 modal 内） */
function simpleErr(msg) {
  return `<div style="padding:80px 20px;text-align:center">
    <p style="color:#e8a3ab;font-size:1rem">${esc(msg)}</p>
  </div>`;
}

/** 空状态块（图标 + 文案） */
function emptyState(text) {
  return `<div class="empty">
    <svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25">
      <circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/>
    </svg>
    <p>${text}</p>
  </div>`;
}

/* ═══════════════════════════════════════════════════════════════════════
 *  通用工具函数
 * ═══════════════════════════════════════════════════════════════════════ */

/** 生成指定长度的随机字符串（PKCE code_verifier 用） */
function randomString(len) {
  const cs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const v = new Uint8Array(len);
  crypto.getRandomValues(v);
  let s = '';
  for (let i = 0; i < len; i++) s += cs[v[i] % cs.length];
  return s;
}

/** 用 SHA-256 计算 PKCE code_challenge（base64url 编码） */
async function pkceChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return b64urlEncode(String.fromCharCode(...new Uint8Array(digest)), true);
}

/** base64url 编码（可选处理二进制字符串） */
function b64urlEncode(str, isBinary) {
  const raw = isBinary ? str : unescape(encodeURIComponent(str));
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url 解码（自动处理 UTF-8） */
function b64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  try { return decodeURIComponent(escape(raw)); } catch { return raw; }
}

/** HTML 转义（防止 XSS） */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 把字符串安全地嵌入到 <script> 中（JSON 编码 + 转义 `</`） */
function jsStr(s) {
  return JSON.stringify(String(s ?? '')).replace(/<\//g, '<\\/');
}

/** 两位补零 */
function pad(n) { return String(n ?? 0).padStart(2, '0'); }

/** 相对时间格式化：刚刚 / N 分钟前 / N 小时前 / N 天前 / M月D日 */
function fmtRelative(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + ' 分钟前';
  const h = Math.floor(min / 60);
  if (h < 24) return h + ' 小时前';
  const day = Math.floor(h / 24);
  if (day < 7) return day + ' 天前';
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

/** 错误卡片 */
function errBox(name, obj) {
  return `<div class="err-box"><p class="err-title">无法加载${name}</p><p class="err">${esc(obj?.__error || '未知错误')}</p></div>`;
}

/** 用 no-cache 头返回 HTML */
function html(body) {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════
 *  页面骨架（<head> + 全局样式 + splash）
 * ═══════════════════════════════════════════════════════════════════════ */

function pageHead() {
  return `<!DOCTYPE html>
<html lang="zh-CN" style="background:#2c0408">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="${THEME_COLOR}">
<meta name="apple-mobile-web-app-capable" content="yes">
<!-- black-translucent：让 iOS 状态栏透明，露出页面顶部深红渐变 -->
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${APP_SHORT_NAME}">
<meta name="mobile-web-app-capable" content="yes">
<meta name="format-detection" content="telephone=no">
<title>${APP_NAME}</title>
<link rel="icon" href="${FAVICON_URL}" type="image/x-icon">
<link rel="shortcut icon" href="${FAVICON_URL}" type="image/x-icon">
<link rel="apple-touch-icon" href="${APPLE_ICON}">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="preconnect" href="https://api.trakt.tv" crossorigin>
<link rel="preconnect" href="https://api.themoviedb.org" crossorigin>
<link rel="preconnect" href="https://image.tmdb.org" crossorigin>

<!-- ─────────── Splash 动画 ─────────── -->
<style>
  html,body{background:#2c0408;color:#f5f5f7;margin:0;padding:0}
  .splash{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;overflow:hidden;background:radial-gradient(circle at 50% 45%,#2c0408 0%,#0a0102 62%);transition:opacity .38s ease;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-tap-highlight-color:transparent}
  .splash.hide{opacity:0;pointer-events:none}
  .splash-glow{position:absolute;width:340px;height:340px;border-radius:50%;background:radial-gradient(circle,rgba(143,11,24,.30) 0%,rgba(143,11,24,0) 70%);animation:splashPulse 2.4s ease-in-out infinite}
  .splash-inner{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:20px}
  .splash-logo{color:#b91323;animation:splashPop .75s cubic-bezier(.22,1.1,.36,1) both}
  .splash-logo svg{display:block;filter:drop-shadow(0 0 22px rgba(143,11,24,.6))}
  .splash-name{font-size:1.35rem;font-weight:800;letter-spacing:.4px;background:linear-gradient(135deg,#fff 20%,#e63946);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation:splashFadeUp .6s ease .28s both}
  .splash-bar{width:128px;height:3px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden;animation:splashFadeUp .6s ease .45s both}
  .splash-bar-fill{height:100%;width:42%;border-radius:99px;background:linear-gradient(90deg,#8f0b18,#b91323);animation:splashSlide 1.15s cubic-bezier(.65,0,.35,1) infinite}
  @keyframes splashPulse{0%,100%{transform:scale(.85);opacity:.7}50%{transform:scale(1.12);opacity:1}}
  @keyframes splashPop{0%{opacity:0;transform:scale(.55) rotate(-8deg)}60%{opacity:1;transform:scale(1.08) rotate(2deg)}100%{opacity:1;transform:scale(1) rotate(0)}}
  @keyframes splashFadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  @keyframes splashSlide{0%{transform:translateX(-130%)}100%{transform:translateX(330%)}}
</style>

<!-- ─────────── 全局样式 ─────────── -->
<style>
  /* CSS 变量：与 Logo 深酒红色调一致的调色板 */
  :root {
    --bg: #0a0102;
    --surface: #150507;
    --surface-2: #20080b;
    --border: #300d12;
    --text: #f5f5f7;
    --text-dim: #a38589;
    --accent: #8f0b18;
    --accent-2: #b91323;
    --blue: #4a9eff;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { -webkit-text-size-adjust: 100%; -webkit-tap-highlight-color: transparent; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                 "PingFang SC", "Microsoft YaHei", sans-serif;
    /* 顶部增强红调，与状态栏 / Logo 呼应，避免纯黑割裂 */
    background: radial-gradient(circle at 50% 0%, #2c0408 0%, #150407 45%, var(--bg) 80%) fixed;
    background-color: var(--bg);
    color: var(--text);
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
    line-height: 1.45;
    overflow-x: hidden;
    overscroll-behavior-y: none;
  }
  a { color: var(--blue); text-decoration: none; }
  a:hover { text-decoration: underline; }
  img { display: block; max-width: 100%; }

  /* ── 布局容器 ── */
  .container { max-width: 1200px; margin: 0 auto; padding: 0 16px calc(80px + env(safe-area-inset-bottom)); }
  .pane-loading { padding: 60px 20px; text-align: center; }

  /* ── 「加载更多」按钮 ── */
  .load-more-wrap { text-align: center; margin-top: 24px; }
  .load-more {
    background: var(--surface); border: 1px solid var(--border);
    color: var(--text); padding: 11px 32px; border-radius: 10px;
    font-size: 0.9rem; font-weight: 600; cursor: pointer;
    transition: all 0.15s; font-family: inherit;
  }
  .load-more:hover:not(:disabled) {
    border-color: var(--accent-2); color: var(--accent-2);
    box-shadow: 0 4px 16px rgba(143,11,24,0.3);
  }
  .load-more:disabled { cursor: not-allowed; }

  /* ── 登录页 ── */
  .login-wrap {
    min-height: 100vh; min-height: 100dvh;
    display: flex; align-items: center; justify-content: center; padding: 20px;
  }
  .login-card {
    width: 100%; max-width: 440px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 24px; padding: 44px 32px;
    text-align: center;
    box-shadow: 0 20px 60px rgba(0,0,0,0.6);
  }
  .login-logo { color: var(--accent-2); margin-bottom: 16px; }
  .login-title {
    font-size: 1.75rem; font-weight: 800; letter-spacing: -0.5px;
    background: linear-gradient(135deg, #fff 20%, #e63946);
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent; margin-bottom: 6px;
  }
  .login-sub { color: var(--text-dim); font-size: 0.9rem; margin-bottom: 28px; }
  .btn-primary {
    background: var(--accent); color: #fff; border: none;
    padding: 13px 30px; border-radius: 12px;
    font-size: 0.95rem; font-weight: 600; cursor: pointer;
    transition: all 0.15s ease; font-family: inherit;
  }
  .btn-primary:hover { background: var(--accent-2); transform: translateY(-1px); }
  .btn-ghost {
    background: rgba(255,255,255,0.04); color: var(--text-dim);
    border: 1px solid var(--border); padding: 8px 16px;
    border-radius: 10px; font-size: 0.85rem; cursor: pointer;
    transition: all 0.15s; font-family: inherit;
  }
  .btn-ghost:hover { color: var(--text); border-color: #4a141d; }

  /* ── 设备码登录流程 ── */
  .steps { display: flex; flex-direction: column; gap: 6px; }
  .step { display: flex; align-items: center; gap: 10px; text-align: left; padding: 4px 0; font-size: 0.9rem; }
  .step .n {
    display: inline-flex; align-items: center; justify-content: center;
    width: 22px; height: 22px; background: var(--accent); color: #fff;
    border-radius: 50%; font-size: 0.72rem; font-weight: 700; flex-shrink: 0;
  }
  .code-box {
    font-family: ui-monospace, Menlo, monospace;
    font-size: 1.75rem; font-weight: 800; letter-spacing: 6px;
    color: var(--accent-2); background: rgba(143,11,24,0.15);
    border: 1px solid rgba(185,19,35,0.35); border-radius: 14px;
    padding: 14px; margin: 14px 0; user-select: all; text-align: center;
  }
  .qr-box {
    background: #fff; border-radius: 14px; padding: 10px;
    display: inline-block; margin: 6px 0 14px;
  }
  .qr-box img { border-radius: 8px; }
  .status {
    display: inline-flex; align-items: center; gap: 8px;
    font-size: 0.88rem; padding: 8px 16px; border-radius: 20px;
    color: var(--text-dim); background: var(--surface-2);
  }
  .status.success { color: #4ade80; background: rgba(74,222,128,0.1); }
  .status.error { color: var(--accent-2); background: rgba(185,19,35,0.12); }
  .pulse {
    display: inline-block; width: 8px; height: 8px;
    background: var(--accent-2); border-radius: 50%;
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.35; transform: scale(0.85); }
    50% { opacity: 1; transform: scale(1.15); }
  }
  .spinner {
    width: 30px; height: 30px; border: 3px solid var(--border);
    border-top-color: var(--accent-2); border-radius: 50%;
    animation: spin 0.8s linear infinite; margin: 4px auto;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── 错误提示 ── */
  .err-box {
    background: rgba(185,19,35,0.10); border: 1px solid rgba(185,19,35,0.28);
    border-radius: 12px; padding: 14px; text-align: left; margin-bottom: 14px;
  }
  .err-title { font-weight: 600; color: var(--accent-2); margin-bottom: 4px; font-size: 0.92rem; }
  .err { color: #e8a3ab; font-size: 0.85rem; }
  .err-detail {
    font-family: ui-monospace, Menlo, monospace; font-size: 0.72rem;
    color: var(--text-dim); background: var(--bg);
    padding: 8px 10px; border-radius: 6px; margin-top: 8px;
    white-space: pre-wrap; word-break: break-all; max-height: 120px; overflow: auto;
  }
  .hint { color: var(--text-dim); font-size: 0.82rem; margin-top: 6px; }
  .log-details { margin-top: 18px; text-align: left; }
  .log-details summary {
    cursor: pointer; font-size: 0.76rem; color: var(--text-dim);
    padding: 4px 0; user-select: none;
  }
  .log-box {
    font-family: ui-monospace, Menlo, monospace; font-size: 0.7rem;
    color: var(--text-dim); background: var(--bg);
    border: 1px solid var(--border); border-radius: 8px;
    padding: 10px; max-height: 160px; overflow: auto;
    margin-top: 6px; line-height: 1.6;
  }

  /* ── 首页 Hero ── */
  .hero {
    display: flex; justify-content: space-between; align-items: center;
    /* 顶部留出安全区（状态栏高度） */
    padding: calc(20px + env(safe-area-inset-top)) 0 20px; gap: 16px;
  }
  .hero-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .hero-greet { font-size: 0.78rem; color: var(--text-dim); }
  .hero-name {
    font-size: 1.4rem; font-weight: 800; letter-spacing: -0.3px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  /* ── 统计卡片 ── */
  .stats {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 16px; padding: 16px 8px; margin-bottom: 22px;
  }
  .stat { text-align: center; }
  .stat-num { font-size: 1.3rem; font-weight: 800; letter-spacing: -0.5px; color: #fff; }
  .stat-label { font-size: 0.72rem; color: var(--text-dim); margin-top: 2px; }

  /* ── Tabs
   *  故意不设 background / backdrop-filter / box-shadow：
   *  完全透明，避免吸顶时出现黑色横带。
   *  每个 .tab 自己有不透明背景，滚动时能独立浮在内容之上。 */
  .tabs {
    display: flex; gap: 8px; margin-bottom: 22px;
    overflow-x: auto; scrollbar-width: none; padding-bottom: 2px;
    position: sticky; top: 0; z-index: 10;
    padding-top: 8px;
  }
  .tabs::-webkit-scrollbar { display: none; }
  .tab {
    background: var(--surface); border: 1px solid var(--border);
    color: var(--text-dim); padding: 9px 18px; border-radius: 999px;
    font-size: 0.87rem; font-weight: 600; cursor: pointer;
    white-space: nowrap; transition: all 0.15s; font-family: inherit;
  }
  .tab:hover { color: var(--text); border-color: #3a1017; }
  .tab.active {
    background: var(--accent); border-color: var(--accent); color: #fff;
    box-shadow: 0 4px 16px rgba(143,11,24,0.45);
  }

  /* ── Pane 切换 ── */
  .pane { display: none; }
  .pane.active { display: block; animation: fadeIn 0.3s ease; }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* ── 卡片网格 ── */
  .grid { display: flex; flex-direction: column; gap: 10px; }

  .item {
    display: flex; gap: 14px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 16px; padding: 12px;
    transition: all 0.2s ease;
    animation: fadeInUp 0.4s ease backwards;
    overflow: hidden;
    text-decoration: none; color: inherit;
  }
  .item.clickable { cursor: pointer; }
  .item.clickable:active { transform: scale(0.985); background: var(--surface-2); }
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .item:hover { border-color: #3a1017; background: var(--surface-2); }
  .item.clickable:hover { border-color: #4a141d; }

  /* ── 海报 ── */
  .poster {
    width: 76px; height: 114px;
    border-radius: 10px; overflow: hidden; flex-shrink: 0;
    background: var(--surface-2); position: relative;
  }
  .poster img { width: 100%; height: 100%; object-fit: cover; }
  .poster-ph {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    font-size: 1.8rem;
    background: linear-gradient(135deg, var(--surface-2), #2a080e);
    color: var(--text-dim);
  }
  .tag {
    position: absolute; top: 4px; left: 4px;
    font-size: 0.55rem; font-weight: 700;
    padding: 2px 5px; border-radius: 4px;
    letter-spacing: 0.3px;
    line-height: 1.2;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  .tag.movie { background: rgba(74,158,255,0.9); color: #fff; }
  .tag.episode { background: rgba(143,11,24,0.9); color: #fff; }
  .tag.upcoming { background: rgba(255,171,0,0.9); color: #000; }

  .rating {
    position: absolute; bottom: 4px; right: 4px;
    background: rgba(0,0,0,0.78);
    color: #ffd166;
    font-size: 0.6rem; font-weight: 700;
    padding: 2px 5px; border-radius: 4px;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }

  /* ── 卡片信息区 ── */
  .info {
    flex: 1; min-width: 0;
    display: flex; flex-direction: column; justify-content: center;
    gap: 4px;
  }
  .name {
    font-size: 1rem; font-weight: 700; color: var(--text);
    overflow: hidden;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    line-height: 1.25; letter-spacing: -0.2px;
  }
  .overview {
    font-size: 0.8rem; color: var(--text-dim);
    overflow: hidden;
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
    line-height: 1.45; margin-top: 4px;
  }
  .meta {
    font-size: 0.8rem; color: var(--text-dim);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .meta.dim { color: #a38589; font-size: 0.78rem; margin-top: 2px; }
  .bar {
    height: 3px; background: rgba(255,255,255,0.06);
    border-radius: 2px; overflow: hidden; margin-top: 8px;
  }
  .bar-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    border-radius: 2px;
  }

  /* ── 平板：稍微放松间距 ── */
  @media (min-width: 700px) {
    .container { padding: 0 32px 100px; }
    .hero { padding: 40px 0 28px; }
    .hero-name { font-size: 1.7rem; }
    .stats { gap: 12px; padding: 20px 12px; margin-bottom: 28px; }
    .stat-num { font-size: 1.6rem; }
    .stat-label { font-size: 0.78rem; }
    /* 桌面端不需要吸顶 */
    .tabs { position: static; padding-top: 0; }
  }

  /* ── 桌面：卡片改为海报墙网格 ── */
  @media (min-width: 900px) {
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
      gap: 20px;
    }
    .item {
      display: flex; flex-direction: column; gap: 0;
      padding: 0; border-radius: 12px;
      background: transparent; border: none; overflow: visible;
    }
    .item:hover { background: transparent; border: none; }
    .item.clickable:active { transform: none; background: transparent; }
    .poster {
      width: 100%; height: auto; aspect-ratio: 2 / 3;
      border-radius: 12px;
      transition: transform 0.25s ease, box-shadow 0.25s ease;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    }
    .item:hover .poster {
      transform: translateY(-4px);
      box-shadow: 0 12px 32px rgba(143,11,24,0.35), 0 4px 16px rgba(0,0,0,0.6);
    }
    .tag { font-size: 0.66rem; padding: 3px 8px; top: 8px; left: 8px; border-radius: 5px; }
    .rating { font-size: 0.68rem; padding: 3px 8px; bottom: 8px; right: 8px; border-radius: 5px; }
    .info { display: block; padding: 12px 2px 0; flex: none; justify-content: flex-start; }
    .name { font-size: 0.9rem; -webkit-line-clamp: 2; min-height: 2.25em; line-height: 1.25; }
    .overview { -webkit-line-clamp: 3; font-size: 0.76rem; margin-top: 5px; }
    .meta { font-size: 0.78rem; margin-top: 4px; }
    .meta.dim { font-size: 0.74rem; margin-top: 3px; }
    .bar { margin-top: 9px; }
  }

  @media (min-width: 1100px) {
    .grid { grid-template-columns: repeat(auto-fill, minmax(185px, 1fr)); gap: 22px; }
  }

  /* ── 日历分组 ── */
  .day { margin-bottom: 26px; }
  .day-head {
    display: flex; align-items: center; gap: 12px;
    margin-bottom: 12px; padding-left: 2px;
  }
  .day-num {
    font-size: 1.8rem; font-weight: 800; color: var(--accent-2);
    line-height: 1; letter-spacing: -1px;
  }
  .day-mon { font-size: 0.75rem; color: var(--text-dim); }
  .day-wd { font-size: 0.85rem; font-weight: 600; color: var(--text); }
  .today {
    background: var(--accent); color: #fff;
    font-size: 0.68rem; padding: 3px 9px; border-radius: 999px;
    font-weight: 700; margin-left: auto;
  }

  /* ── 空状态 ── */
  .empty { text-align: center; padding: 80px 20px; color: var(--text-dim); }
  .empty p { margin-top: 14px; font-size: 0.92rem; }
  @media (min-width: 700px) { .empty { padding: 120px 20px; } }

  /* ── Modal ── */
  .modal { position: fixed; inset: 0; z-index: 100; display: none; }
  .modal.open { display: block; }
  .modal-backdrop {
    position: absolute; inset: 0;
    background: rgba(5,0,0,0.78);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    animation: fadeIn 0.2s ease;
  }
  .modal-panel {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    padding: 12px;
    padding-top: calc(12px + env(safe-area-inset-top));
    padding-bottom: calc(12px + env(safe-area-inset-bottom));
    pointer-events: none;
  }
  .modal-body {
    pointer-events: auto;
    position: relative;
    width: 100%; max-width: 880px;
    max-height: 100%;
    overflow-y: auto; overflow-x: hidden;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 18px;
    box-shadow: 0 40px 100px rgba(0,0,0,0.85);
    animation: modalIn 0.28s cubic-bezier(0.2, 0.9, 0.3, 1);
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
  }
  @keyframes modalIn {
    from { opacity: 0; transform: translateY(14px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .modal-close {
    position: fixed;
    top: max(20px, env(safe-area-inset-top));
    right: max(20px, env(safe-area-inset-right));
    z-index: 110;
    width: 38px; height: 38px; border-radius: 50%;
    background: rgba(20,5,7,0.9); border: 1px solid rgba(255,255,255,0.15);
    color: #fff; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    transition: background 0.15s, transform 0.15s;
    padding: 0;
  }
  .modal-close:hover { background: rgba(48,13,18,0.95); transform: scale(1.05); }
  .modal-loading { padding: 100px 20px; text-align: center; }
  .modal-error { padding: 80px 20px; text-align: center; color: #e8a3ab; font-size: 0.9rem; }
  @media (min-width: 700px) {
    .modal-panel { padding: 40px 24px; }
  }

  /* ── 详情 hero ── */
  .detail-hero {
    position: relative; overflow: hidden;
    background: var(--surface);
    border-radius: 18px 18px 0 0;
  }
  .detail-bg {
    position: absolute; inset: 0;
    width: 100%; height: 100%; object-fit: cover;
    filter: blur(30px) saturate(1.2) brightness(0.5);
    transform: scale(1.15);
    z-index: 0;
  }
  .detail-hero::after {
    content: ''; position: absolute; inset: 0; z-index: 1;
    background: linear-gradient(180deg, rgba(10,1,2,0.6), rgba(10,1,2,0.95));
  }
  .detail-inner {
    position: relative; z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 16px;
    padding: 24px 20px 24px;
  }
  .detail-poster {
    width: 130px; height: 195px; border-radius: 12px;
    object-fit: cover; flex-shrink: 0;
    box-shadow: 0 12px 32px rgba(0,0,0,0.7);
    margin: 0 auto;
  }
  .detail-poster-ph {
    display: flex; align-items: center; justify-content: center;
    background: var(--surface-2); font-size: 2.4rem; color: var(--text-dim);
  }
  .detail-info {
    flex: 1; min-width: 0;
    display: flex; flex-direction: column;
    gap: 8px;
    align-items: center;
    width: 100%;
  }
  .detail-title {
    font-size: 1.3rem; font-weight: 800; letter-spacing: -0.4px;
    line-height: 1.25;
  }
  .detail-tagline { font-size: 0.85rem; color: var(--text-dim); font-style: italic; }
  .detail-meta {
    display: flex; flex-wrap: wrap; gap: 10px;
    font-size: 0.85rem; color: var(--text-dim);
    justify-content: center;
  }
  .detail-rating { color: #ffd166; font-weight: 700; }
  .detail-genres { font-size: 0.82rem; color: var(--text-dim); }
  .detail-overview {
    font-size: 0.88rem; color: #d6bdc0;
    line-height: 1.55; margin-top: 4px;
    display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical;
    overflow: hidden;
    text-align: center;
  }

  /* ── 观看状态条 ── */
  .d-status {
    display: flex; gap: 12px; align-items: center;
    background: rgba(255,255,255,0.03);
    border: 1px solid var(--border);
    border-radius: 12px; padding: 10px 14px;
    margin-top: 8px;
    width: 100%;
    justify-content: center;
  }
  .d-status.done { border-color: rgba(74,222,128,0.3); background: rgba(74,222,128,0.06); }
  .d-status-icon {
    width: 32px; height: 32px; border-radius: 50%;
    background: var(--surface-2); color: var(--text-dim);
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; flex-shrink: 0; font-size: 0.95rem;
  }
  .d-status.done .d-status-icon { background: rgba(74,222,128,0.15); color: #4ade80; }
  .d-status-title { font-size: 0.88rem; font-weight: 600; }
  .d-status-sub { font-size: 0.76rem; color: var(--text-dim); margin-top: 2px; }

  /* ── Infuse 按钮 ── */
  .infuse-btn {
    display: inline-flex; align-items: center; gap: 8px;
    align-self: center;
    background: linear-gradient(135deg, #1a0a0e, #2a0d12);
    border: 1px solid rgba(185,19,35,0.4);
    color: #e8969e;
    padding: 9px 18px;
    border-radius: 10px;
    font-size: 0.85rem;
    font-weight: 600;
    text-decoration: none;
    margin-top: 10px;
    transition: all 0.2s ease;
    cursor: pointer;
    font-family: inherit;
  }
  .infuse-btn:hover {
    border-color: rgba(185,19,35,0.75);
    background: linear-gradient(135deg, #250b10, #3a1218);
    color: #ffb8c0;
    box-shadow: 0 4px 20px rgba(143,11,24,0.35);
    text-decoration: none;
  }
  .infuse-btn svg { flex-shrink: 0; }

  /* ── 详情主体 ── */
  .detail-body { padding: 20px 22px 24px; }
  .d-section { margin-top: 8px; margin-bottom: 26px; }
  .d-section:last-child { margin-bottom: 0; }
  .d-section-title {
    font-size: 1rem; font-weight: 700; letter-spacing: 0.2px;
    margin-bottom: 14px; color: var(--text);
    display: flex; align-items: center; gap: 8px;
  }
  .d-section-title::before {
    content: ''; width: 3px; height: 16px; border-radius: 2px;
    background: var(--accent-2);
  }

  /* ── 演职员横滑 ── */
  .cast-scroll {
    display: flex; gap: 14px; overflow-x: auto;
    padding-bottom: 8px; scrollbar-width: none;
  }
  .cast-scroll::-webkit-scrollbar { display: none; }
  .cast { flex-shrink: 0; width: 84px; text-align: center; }
  .cast-img {
    width: 84px; height: 84px; border-radius: 50%;
    object-fit: cover; background: var(--surface-2);
  }
  .cast-ph {
    display: flex; align-items: center; justify-content: center;
    color: var(--text-dim); font-size: 1.6rem; font-weight: 600;
    background: linear-gradient(135deg, var(--surface-2), #2a080e);
  }
  .cast-name {
    font-size: 0.75rem; font-weight: 600; margin-top: 8px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .cast-role {
    font-size: 0.68rem; color: var(--text-dim); margin-top: 1px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  /* ── 季折叠面板 ── */
  .seasons { display: flex; flex-direction: column; gap: 8px; }
  .season-item {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; overflow: hidden;
    transition: border-color 0.15s;
  }
  .season-item.open { border-color: #3a1017; }
  .season-head {
    width: 100%; background: none; border: none; color: inherit;
    display: flex; align-items: center; gap: 12px;
    padding: 14px 16px; cursor: pointer;
    font-family: inherit; text-align: left;
    transition: background 0.15s;
  }
  .season-head:hover { background: var(--surface-2); }
  .season-title { font-weight: 600; font-size: 0.9rem; flex: 1; }
  .season-meta { font-size: 0.76rem; color: var(--text-dim); }
  .chev {
    width: 16px; height: 16px; color: var(--text-dim);
    transition: transform 0.2s ease; flex-shrink: 0;
  }
  .season-item.open .chev { transform: rotate(180deg); }
  .season-body { display: none; border-top: 1px solid var(--border); }
  .season-item.open .season-body { display: block; }
  .ep-empty { padding: 20px; text-align: center; color: var(--text-dim); font-size: 0.85rem; }

  /* ── 单集行 ── */
  .episode {
    display: flex; gap: 12px; padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    align-items: flex-start;
    transition: background 0.15s;
  }
  .episode:last-child { border-bottom: none; }
  .episode.clickable { cursor: pointer; }
  .episode.clickable:hover { background: var(--surface-2); }
  .episode.clickable:active { background: #2a080e; }
  .episode.clickable:hover .ep-title { color: var(--accent-2); }
  .episode.watched .ep-title { color: var(--text-dim); }
  .episode.watched.clickable:hover .ep-title { color: var(--accent-2); }
  .ep-num {
    font-family: ui-monospace, Menlo, monospace;
    font-size: 0.76rem; color: var(--text-dim);
    font-weight: 700; flex-shrink: 0; padding-top: 3px;
    width: 32px; letter-spacing: 0.5px;
  }
  .ep-body { flex: 1; min-width: 0; }
  .ep-title { font-size: 0.86rem; font-weight: 600; line-height: 1.3; }
  .ep-overview {
    font-size: 0.76rem; color: var(--text-dim); margin-top: 4px;
    line-height: 1.45;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .ep-check {
    color: #4ade80; font-weight: 700; flex-shrink: 0;
    font-size: 0.9rem; padding-top: 2px;
  }

  /* modal 内的推荐网格更紧凑 */
  .modal-body .grid {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 16px;
  }

  /* ── 平板以上：详情 hero 横向布局 ── */
  @media (min-width: 700px) {
    .detail-inner {
      flex-direction: row;
      align-items: flex-start;
      text-align: left;
      padding: 30px;
      gap: 26px;
    }
    .detail-poster { width: 160px; height: 240px; margin: 0; }
    .detail-info { align-items: flex-start; }
    .detail-meta { justify-content: flex-start; }
    .d-status { justify-content: flex-start; }
    .infuse-btn { align-self: flex-start; }
    .detail-overview { text-align: left; }
    .detail-title { font-size: 1.85rem; }
    .detail-overview { font-size: 0.92rem; -webkit-line-clamp: 6; }
    .detail-body { padding: 26px 30px 30px; }
    .cast { width: 96px; }
    .cast-img { width: 96px; height: 96px; }
    .modal-body .grid {
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 18px;
    }
  }
</style>
</head>
<body>${renderSplash()}`;
}

/**
 * 页面尾部：splash 隐藏兜底脚本 + Service Worker 注册策略。
 *
 *  SW 注册规则：
 *    · 移动端 UA → 注册 /sw.js
 *    · 桌面端 UA → 主动注销旧 SW + 清缓存（避免缓存导致流式失效）
 */
function pageTail() {
  return `<script>(function(){
    var s = document.getElementById('splash');
    if (!s) return;
    var t0 = window.__splashT0 || Date.now();
    var MIN = 800;
    var wait = Math.max(0, MIN - (Date.now() - t0));
    setTimeout(function(){
      s.classList.add('hide');
      setTimeout(function(){
        if (s && s.parentNode) s.parentNode.removeChild(s);
      }, 420);
    }, wait);
  })();<\/script>
  <script>(function(){
    if (!('serviceWorker' in navigator)) return;

    var ua = navigator.userAgent || '';
    var isMobile = /iPhone|iPad|iPod|Android|Mobile|HarmonyOS|Windows Phone/i.test(ua);

    /* 桌面端：注销旧 SW，清缓存，然后刷新一次（去掉所有残留拦截） */
    if (!isMobile) {
      if (sessionStorage.getItem('__sw_purged')) return;
      navigator.serviceWorker.getRegistrations().then(function(rs){
        if (!rs.length) {
          sessionStorage.setItem('__sw_purged', '1');
          return;
        }
        Promise.all(rs.map(function(r){ return r.unregister(); })).then(function(){
          sessionStorage.setItem('__sw_purged', '1');
          if (window.caches) {
            caches.keys().then(function(ks){
              Promise.all(ks.map(function(k){ return caches.delete(k); }))
                .then(function(){ location.reload(); });
            });
          } else {
            location.reload();
          }
        });
      }).catch(function(){
        sessionStorage.setItem('__sw_purged', '1');
      });
      return;
    }

    /* 移动端：注册 SW 以缓存静态资源 */
    if (window.__swRegistered) return;
    window.__swRegistered = true;
    window.addEventListener('load', function(){
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function(){});
    });
  })();<\/script>
</body>
</html>`;
}

/** 组合页面 head + body + tail */
function pageShell(body) {
  return pageHead() + body + pageTail();
}
