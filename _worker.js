/**
 * ═══════════════════════════════════════════════════════════════════════
 *  MineTrakt · Trakt 观看记录查看器 (Cloudflare Workers 单文件部署)
 * ═══════════════════════════════════════════════════════════════════════
 *  绑定：TMDB_CACHE (KV命名空间)
 *  环境变量：TRAKT_CLIENT_ID (必填), TMDB_API_KEY (必填), OMDB_API_KEY (可选)
 * ═══════════════════════════════════════════════════════════════════════
 */

const TRAKT_AUTH = 'https://auth.trakt.tv', TRAKT_API = 'https://api.trakt.tv', TMDB_API = 'https://api.themoviedb.org/3', TMDB_IMG = 'https://image.tmdb.org/t/p', ACTIVATE_URL = 'https://trakt.tv/activate', OMDB_API = 'https://www.omdbapi.com', DOUBAN_SEARCH = 'https://search.douban.com/movie/subject_search';
const APP_NAME = 'MineTrakt', APP_SHORT_NAME = 'MineTrakt', THEME_COLOR = '#050505';
const FAVICON_URL = '/assets/favicon.ico', ICON_192 = '/assets/icon-192.png', ICON_512 = '/assets/icon-512.png', APPLE_ICON = '/assets/icon-512.png', SPLASH_LOGO = '/assets/logo.png';
const ASSET_ORIGINS = {
  '/assets/favicon.ico': ['https://i.ibb.co/s9tgxVhb/Mine-Trakt-icon-32x32.png', 'image/png'],
  '/assets/icon-192.png': ['https://i.ibb.co/wZ2Z8Gkj/Mine-Trakt-logo-192x192.png', 'image/png'],
  '/assets/icon-512.png': ['https://i.ibb.co/Xx8q97CH/Mine-Trakt-logo-512x512.png', 'image/png'],
  '/assets/logo.png': ['https://i.ibb.co/0jsGWrwK/Mine-Trakt-logo.png', 'image/png'],
};
const JSON_HEADERS = { 'Content-Type': 'application/json', 'User-Agent': 'TraktViewer/1.0' };
const COOKIE_NAME = 'trakt_auth', COOKIE_MAX_AGE = 60 * 60 * 24 * 90;
const PAGE_SIZE = 12, TMDB_KV_TTL = 86400 * 7, OMDB_KV_TTL = 86400 * 7, WATCHLIST_PAGE_SIZE = 30, WATCHLIST_KV_TTL = 120, CALENDAR_KV_TTL = 600;
const HOME_AUTO_REFRESH_MINUTES = 5;
const APP_JS_VERSION = '4', APP_CSS_VERSION = '31';

async function fetchT(url, opts = {}, ms = 8000) { const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms); try { return await fetch(url, { ...opts, signal: ctrl.signal }); } finally { clearTimeout(t); } }

const KV_MEM_TTL = 30000, KV_EDGE_TTL = 60, KV_MISS = Symbol('kv-miss');
const __kvMem = new Map(), __kvMemExp = new Map(), __kvInflight = new Map();
function kvMemGet(key) { const exp = __kvMemExp.get(key); if (exp === undefined) return undefined; if (exp < Date.now()) { __kvMem.delete(key); __kvMemExp.delete(key); return undefined; } return __kvMem.get(key); }
function kvMemSet(key, val) { __kvMem.set(key, val); __kvMemExp.set(key, Date.now() + KV_MEM_TTL); if (__kvMem.size > 3000) { const now = Date.now(); for (const [k, t] of __kvMemExp) if (t < now) { __kvMem.delete(k); __kvMemExp.delete(k); } if (__kvMem.size > 3000) { let i = 0; for (const k of __kvMem.keys()) { __kvMem.delete(k); __kvMemExp.delete(k); if (++i >= 500) break; } } } }
function singleFlight(key, fn) { const existing = __kvInflight.get(key); if (existing) return existing; const p = (async () => { try { return await fn(); } finally { setTimeout(() => __kvInflight.delete(key), 200); } })(); __kvInflight.set(key, p); return p; }
async function kvGetJSON(env, key, memOnly) {
  const mem = kvMemGet(key);
  if (mem !== undefined) return mem;
  if (memOnly) return undefined;
  if (!env.TMDB_CACHE) return undefined;
  try {
    const v = await env.TMDB_CACHE.get(key, { type: 'json', cacheTtl: KV_EDGE_TTL });
    const result = (v === null || v === undefined) ? KV_MISS : v;
    kvMemSet(key, result);
    return result;
  } catch { return undefined; }
}
function kvPutJSON(env, ctx, key, payload, ttl, memOnly) {
  kvMemSet(key, payload);
  if (memOnly) return;
  if (!env.TMDB_CACHE) return;
  const p = env.TMDB_CACHE.put(key, JSON.stringify(payload), { expirationTtl: ttl }).catch(() => {});
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
}
function clearCookieHeader() { return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`; }
function invalidateWatchlistCache() { for (const k of [...__kvMem.keys()]) { if (k.startsWith('wl:')) { __kvMem.delete(k); __kvMemExp.delete(k); } } }

const SW_JS_CONTENT = String.raw`/* MineTrakt SW v14 */ const VERSION = 'v14'; const RUNTIME_CACHE = 'trakt-static-' + VERSION; self.addEventListener('install', function(){ self.skipWaiting(); }); self.addEventListener('activate', function(e){ e.waitUntil((async function(){ var keys = await caches.keys(); await Promise.all(keys.filter(function(k){ return k !== RUNTIME_CACHE; }).map(function(k){ return caches.delete(k); })); await self.clients.claim(); })()); }); self.addEventListener('fetch', function(event){ var req = event.request; if (req.method !== 'GET') return; var url; try { url = new URL(req.url); } catch(e){ return; } if (url.origin !== self.location.origin) return; if (url.pathname === '/sw.js') return; if (req.mode === 'navigate') return; if (url.pathname.indexOf('/api/') === 0) return; if (url.pathname.indexOf('/auth/') === 0) return; if (url.pathname === '/app.css' || url.pathname === '/app.js' || url.pathname === '/manifest.webmanifest' || url.pathname === '/favicon.ico' || url.pathname.indexOf('/assets/') === 0 || /\.(?:png|jpg|jpeg|svg|webp|ico|woff2?|css|js)$/i.test(url.pathname)) { event.respondWith(staleWhileRevalidate(req)); } }); async function staleWhileRevalidate(req){ var cache = await caches.open(RUNTIME_CACHE); var cached = await cache.match(req); var network = fetch(req).then(function(r){ if (r && r.ok && r.type !== 'opaque') { cache.put(req, r.clone()).catch(function(){}); } return r; }).catch(function(){ return cached; }); return cached || network; }`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url), path = url.pathname;
    if (path.startsWith('/assets/')) return handleAsset(path, ctx);
    if (path === '/app.css') return handleAppCss();
    if (path === '/app.js') return handleAppJs(request);
    if (path === '/favicon.ico') return Response.redirect(FAVICON_URL, 302);
    if (path === '/manifest.webmanifest') return handleManifest();
    if (path === '/sw.js') return handleServiceWorker();
    if (path === '/auth/device') return handleDevice(env);
    if (path === '/auth/poll' && request.method === 'POST') return handlePoll(request, env);
    if (path === '/auth/logout' && request.method === 'POST') return handleLogout();
    if (path === '/api/more') return handleMore(request, env, ctx);
    if (path === '/api/season') return handleSeason(request, env, ctx);
    if (path === '/api/detail') return handleApiDetail(request, env, ctx);
    if (path === '/api/enrich' && request.method === 'POST') return handleEnrich(request, env, ctx);
    if (path === '/api/search') return handleSearch(request, env);
    if (path === '/api/trending') return handleTrending(request, env, ctx);
    if (path === '/api/watchlist/add' && request.method === 'POST') return handleWatchlistAdd(request, env);
    if (path === '/api/watchlist/remove' && request.method === 'POST') return handleWatchlistRemove(request, env);
    if (path === '/api/mark-watched' && request.method === 'POST') return handleMarkWatched(request, env);
    if (path === '/api/unmark-watched' && request.method === 'POST') return handleUnmarkWatched(request, env);
    if (path === '/api/mark-season-watched' && request.method === 'POST') return handleMarkSeasonWatched(request, env);
    if (path === '/api/show-calendar') return handleShowCalendar(request, env, ctx);
    if (path === '/api/home-data') return handleHomeData(request, env, ctx);
    return handleHome(request, env, ctx);
  }
};

// ═══ 资产 / 静态资源 ═══
async function handleAsset(path, ctx) {
  const entry = ASSET_ORIGINS[path];
  if (!entry) return new Response('Not Found', { status: 404 });
  const [origin, type] = entry;
  const cache = caches.default;
  const cacheKey = new Request(origin, { method: 'GET' });
  let r = await cache.match(cacheKey);
  if (r) return r;
  try {
    const upstream = await fetchT(origin, {}, 6000);
    if (!upstream.ok) return new Response('', { status: 502 });
    r = new Response(upstream.body, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*' } });
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(cache.put(cacheKey, r.clone()));
    return r;
  } catch { return new Response('', { status: 502 }); }
}
function handleAppCss() {
  const css = pageStyles();
  return new Response(css, { headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable', 'ETag': `"css-v${APP_CSS_VERSION}"` } });
}
function handleAppJs(request) {
  const etag = `"js-v${APP_JS_VERSION}"`;
  const cacheHeaders = { 'Cache-Control': 'public, max-age=31536000, immutable', 'ETag': etag };
  if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers: cacheHeaders });
  return new Response(getClientSideScripts(), { headers: { 'Content-Type': 'application/javascript; charset=utf-8', ...cacheHeaders } });
}
function handleManifest() { return new Response(JSON.stringify({ name: APP_NAME, short_name: APP_SHORT_NAME, description: '继续观看 · 待看列表 · 追剧日历 · 观看记录', start_url: '/', scope: '/', display: 'standalone', orientation: 'portrait', background_color: THEME_COLOR, theme_color: THEME_COLOR, lang: 'zh-CN', icons: [{ src: ICON_192, sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: ICON_512, sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: ICON_512, sizes: '512x512', type: 'image/png', purpose: 'maskable' }] }), { headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } }); }
function handleServiceWorker() { return new Response(SW_JS_CONTENT, { headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Service-Worker-Allowed': '/' } }); }

// ═══ 鉴权辅助 ═══
async function requireAuth(request, env) {
  const cookieAuth = readAuth(request);
  if (!cookieAuth) return { ok: false };
  const auth = await refreshIfNeeded(cookieAuth, env);
  if (!auth) return { ok: false };
  return { ok: true, auth, headers: makeTraktHeaders(env, auth), needsCookieUpdate: auth.access_token !== cookieAuth.access_token };
}
function unauthorizedJson() { return Response.json({ error: 'unauthorized' }, { status: 401, headers: { 'Set-Cookie': clearCookieHeader() } }); }
function unauthorizedHtml() { return new Response('unauthorized', { status: 401, headers: { 'Set-Cookie': clearCookieHeader() } }); }

// ═══ OAuth ═══
async function handleDevice(env) {
  const codeVerifier = randomString(64), codeChallenge = await pkceChallenge(codeVerifier);
  let res; try { res = await fetchT(`${TRAKT_AUTH}/oauth/device/code`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ client_id: env.TRAKT_CLIENT_ID, code_challenge: codeChallenge, code_challenge_method: 'S256' }) }, 10000); } catch (e) { return Response.json({ error: '网络请求失败: ' + String(e) }, { status: 502 }); }
  if (!res.ok) { const errText = await res.text(); return Response.json({ error: `Trakt 返回错误 (${res.status})`, detail: errText, hint: res.status === 403 ? 'TRAKT_CLIENT_ID 可能不正确' : '' }, { status: 502 }); }
  const data = await res.json(), state = b64urlEncode(JSON.stringify({ device_code: data.device_code, code_verifier: codeVerifier }));
  return Response.json({ state, user_code: data.user_code, verification_url: ACTIVATE_URL, interval: data.interval, expires_in: data.expires_in });
}
async function handlePoll(request, env) {
  let body; try { body = await request.json(); } catch { return new Response('bad request', { status: 400 }); }
  if (!body.state) return new Response('missing state', { status: 400 });
  let decoded; try { decoded = JSON.parse(b64urlDecode(body.state)); } catch { return new Response('bad state', { status: 400 }); }
  let res; try { res = await fetchT(`${TRAKT_AUTH}/oauth/device/token`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ code: decoded.device_code, client_id: env.TRAKT_CLIENT_ID, code_verifier: decoded.code_verifier }) }, 10000); } catch (e) { return Response.json({ status: 'network_error', detail: String(e) }, { status: 502 }); }
  if (res.ok) { const data = await res.json(), auth = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000, code_verifier: decoded.code_verifier }; return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': buildCookie(auth) } }); }
  const rawText = await res.text(); let err = 'unknown'; try { err = JSON.parse(rawText).error; } catch {}
  if (err === 'authorization_pending' || err === 'slow_down') return Response.json({ status: err }, { status: 202 });
  if (err === 'access_denied') return Response.json({ status: 'denied', raw: rawText }, { status: 403 });
  if (err === 'expired_token' || err === 'already_used') return Response.json({ status: 'expired', raw: rawText }, { status: 410 });
  return Response.json({ status: 'error', detail: err, http: res.status, raw: rawText }, { status: 502 });
}
function handleLogout() { return new Response(null, { status: 204, headers: { 'Set-Cookie': clearCookieHeader() } }); }
function buildCookie(auth) { return `${COOKIE_NAME}=${b64urlEncode(JSON.stringify(auth))}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`; }
function readAuth(request) { const cookie = request.headers.get('Cookie') || ''; const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`)); if (!m) return null; try { return JSON.parse(b64urlDecode(m[1])); } catch { return null; } }
async function refreshIfNeeded(auth, env) {
  if (auth.expires_at - Date.now() > 30 * 60_000) return auth;
  let res; try { res = await fetchT(`${TRAKT_AUTH}/oauth/token`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ refresh_token: auth.refresh_token, client_id: env.TRAKT_CLIENT_ID, code_verifier: auth.code_verifier, grant_type: 'refresh_token', redirect_uri: 'urn:ietf:wg:oauth:2.0:oob' }) }, 10000); } catch { return null; }
  if (!res.ok) return null;
  const data = await res.json(); return { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000, code_verifier: auth.code_verifier };
}
function makeTraktHeaders(env, auth) { return { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': env.TRAKT_CLIENT_ID, 'Authorization': `Bearer ${auth.access_token}`, 'User-Agent': 'TraktViewer/1.0' }; }
async function traktGet(url, headers, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try { const r = await fetchT(url, { headers }, 12000); if (r.status === 429) { await new Promise(res => setTimeout(res, Math.min(1000 * Math.pow(2, i), 4000))); continue; } if (!r.ok) return { __error: `HTTP ${r.status}` }; return await r.json(); }
    catch (e) { if (i === retries) return { __error: String(e) }; await new Promise(res => setTimeout(res, 800 * (i + 1))); }
  } return { __error: 'retries exhausted' };
}
async function getStableUserId(auth, headers) {
  const memKey = `uid:${auth.access_token}`;
  const cached = kvMemGet(memKey);
  if (cached !== undefined && cached !== KV_MISS) return String(cached);
  let userId = 'anon';
  try { const u = await traktGet(`${TRAKT_API}/users/me`, headers, 0); if (u && !u.__error) userId = String((u.ids && u.ids.trakt) || u.username || 'anon'); } catch {}
  kvMemSet(memKey, userId);
  return userId;
}

// ═══ TMDB / OMDB ═══
async function tmdbGet(url) { try { const r = await fetchT(url, {}, 8000); if (!r.ok) return null; return await r.json(); } catch { return null; } }
async function tmdbDetailCached(path, env, ctx, ttl = 86400) {
  if (!env.TMDB_API_KEY) return null;
  const cacheKey = `td:${path}`, mem = kvMemGet(cacheKey);
  if (mem !== undefined) { if (mem === KV_MISS) return null; return mem.miss ? null : mem.data; }
  return singleFlight(cacheKey, async () => {
    const cached = await kvGetJSON(env, cacheKey); if (cached !== undefined && cached !== KV_MISS) return cached.miss ? null : cached.data;
    const url = `${TMDB_API}${path}${path.includes('?') ? '&' : '?'}language=zh-CN&api_key=${env.TMDB_API_KEY}`, d = await tmdbGet(url);
    kvPutJSON(env, ctx, cacheKey, d ? { data: d } : { miss: true }, ttl); return d;
  });
}
function tmdbPoster(path, size = 'w185') { return path ? `${TMDB_IMG}/${size}${path}` : null; }
async function fetchOmdbRatings(imdbId, env, ctx) {
  if (!imdbId || !env.OMDB_API_KEY) return null;
  const cacheKey = `omdb:${imdbId}`, mem = kvMemGet(cacheKey);
  if (mem !== undefined) { if (mem === KV_MISS) return null; return mem.miss ? null : mem.data; }
  return singleFlight(cacheKey, async () => {
    const cached = await kvGetJSON(env, cacheKey); if (cached !== undefined && cached !== KV_MISS) return cached.miss ? null : cached.data;
    let d = null; try { const r = await fetchT(`${OMDB_API}/${imdbId}?apikey=${env.OMDB_API_KEY}`, {}, 6000); if (r.ok) d = await r.json(); } catch {}
    let result = null;
    if (d && d.Response === 'True') { const out = {}; if (Array.isArray(d.Ratings)) for (const r of d.Ratings) { const v = parseFloat(r.Value); if (!Number.isFinite(v)) continue; if (r.Source === 'Internet Movie Database') out.imdb = v; else if (r.Source === 'Rotten Tomatoes') out.rt = Math.round(v); else if (r.Source === 'Metacritic') out.metacritic = Math.round(v); } if (out.imdb == null && d.imdbRating && d.imdbRating !== 'N/A') { const v = parseFloat(d.imdbRating); if (Number.isFinite(v)) out.imdb = v; } if (out.metacritic == null && d.Metascore && d.Metascore !== 'N/A') { const v = parseInt(d.Metascore); if (Number.isFinite(v)) out.metacritic = v; } if (Object.keys(out).length) result = out; }
    kvPutJSON(env, ctx, cacheKey, result ? { data: result } : { miss: true }, result ? OMDB_KV_TTL : 3600); return result;
  });
}
function mcColor(n) { if (n >= 61) return '#66cc33'; if (n >= 40) return '#ffcc33'; return '#ff0000'; }
function renderExtRatings(r, opts = {}) {
  const out = [];
  if (r && r.imdb != null) out.push(`<span class="ext-rating ext-imdb" title="IMDb ${r.imdb.toFixed(1)}"><span class="ext-label">IMDb</span><span class="ext-score">${r.imdb.toFixed(1)}</span></span>`);
  if (opts.trakt != null) out.push(`<span class="ext-rating ext-trakt" title="Trakt ${opts.trakt.toFixed(1)}"><span class="ext-label">Trakt</span><span class="ext-score">${opts.trakt.toFixed(1)}</span></span>`);
  if (r && r.rt != null) out.push(`<span class="ext-rating ext-rt" title="烂番茄新鲜度 ${r.rt}%"><span class="ext-label">RT</span><span class="ext-score">${r.rt}%</span></span>`);
  if (r && r.metacritic != null) out.push(`<span class="ext-rating ext-mc" title="Metacritic ${r.metacritic}"><span class="ext-label">MC</span><span class="ext-score" style="color:${mcColor(r.metacritic)}">${r.metacritic}</span></span>`);
  if (opts.tmdb != null) out.push(`<span class="ext-rating ext-tmdb" title="TMDB ${opts.tmdb.toFixed(1)}"><span class="ext-label">TMDB</span><span class="ext-score">${opts.tmdb.toFixed(1)}</span></span>`);
  if (opts.doubanUrl) out.push(`<a class="ext-rating ext-douban" href="${esc(opts.doubanUrl)}" target="_blank" rel="noopener" title="在豆瓣搜索该片"><span class="ext-label">豆瓣</span><span class="ext-score">↗</span></a>`);
  return out.join('');
}

// ═══ 通用构建 ═══
function buildBaseItem(traktItem) {
  const base = { tag: '', tagClass: '', title: '', overview: '', poster: null, line1: '', detailType: null, detailId: null, enrichKey: null };
  let kind = traktItem.type; if (!kind) { if (traktItem.show && traktItem.episode) kind = 'episode'; else if (traktItem.movie) kind = 'movie'; else if (traktItem.show) kind = 'show'; }
  if (kind === 'movie' || traktItem.movie) {
    const m = traktItem.movie || {}; base.tag = '电影'; base.tagClass = 'movie'; base.title = m.title || ''; base.overview = m.overview || ''; base.poster = posterOfTrakt(m); base.line1 = m.year ? String(m.year) : ''; base.detailType = 'movie'; base.detailId = m.ids && m.ids.trakt ? String(m.ids.trakt) : null;
    if (m.ids && m.ids.tmdb) base.enrichKey = 'movie:tmdb:' + m.ids.tmdb; else if (m.ids && m.ids.imdb) base.enrichKey = 'movie:imdb:' + m.ids.imdb; else if (m.title) base.enrichKey = 'movie:title:' + m.title + ':' + (m.year || '');
  } else if (kind === 'episode' || kind === 'show' || (traktItem.show && traktItem.episode)) {
    const e = traktItem.episode || {}, s = traktItem.show || {}; base.tag = '剧集'; base.tagClass = 'episode'; base.title = s.title || ''; base.overview = s.overview || ''; base.poster = posterOfTrakt(s); base.line1 = (e.season != null && e.number != null) ? `S${pad(e.season)}E${pad(e.number)}${e.title ? ' · ' + e.title : ''}` : (s.year ? String(s.year) : ''); base.detailType = 'show'; base.detailId = s.ids && s.ids.trakt ? String(s.ids.trakt) : null;
    if (s.ids && s.ids.tmdb) base.enrichKey = 'tv:tmdb:' + s.ids.tmdb; else if (s.ids && s.ids.tvdb) base.enrichKey = 'tv:tvdb:' + s.ids.tvdb; else if (s.title) base.enrichKey = 'tv:title:' + s.title + ':' + (s.year || '');
  } return base;
}
function parseEnrichKey(key) {
  if (!key) return null; const i1 = key.indexOf(':'); if (i1 < 0) return null; const i2 = key.indexOf(':', i1 + 1); if (i2 < 0) return null; const kind = key.slice(0, i1), source = key.slice(i1 + 1, i2), rest = key.slice(i2 + 1); if (kind !== 'movie' && kind !== 'tv') return null;
  if (source === 'title') { const lastColon = rest.lastIndexOf(':'); if (lastColon > 0) { const maybeYear = rest.slice(lastColon + 1); if (/^\d{4}$/.test(maybeYear)) return { kind, source, title: rest.slice(0, lastColon), year: maybeYear }; } return { kind, source, title: rest, year: '' }; }
  return { kind, source, value: rest };
}
async function enrichOne(key, env, ctx) {
  if (!env.TMDB_API_KEY) return null; const parsed = parseEnrichKey(key); if (!parsed) return null; const cacheKey = `e:${key}`, mem = kvMemGet(cacheKey);
  if (mem !== undefined) { if (mem === KV_MISS) return null; return mem.miss ? null : mem.data; }
  return singleFlight(cacheKey, async () => {
    const c = await kvGetJSON(env, cacheKey); if (c !== undefined && c !== KV_MISS) return c.miss ? null : c.data;
    const { kind, source } = parsed, lang = 'zh-CN', apiKey = env.TMDB_API_KEY; let d = null;
    if (source === 'tmdb') d = await tmdbGet(`${TMDB_API}/${kind}/${parsed.value}?language=${lang}&api_key=${apiKey}`);
    else if (source === 'imdb') { const find = await tmdbGet(`${TMDB_API}/find/${parsed.value}?external_source=imdb_id&language=${lang}&api_key=${apiKey}`); if (find) { const arr = kind === 'movie' ? find.movie_results : find.tv_results; if (arr && arr.length) d = await tmdbGet(`${TMDB_API}/${kind}/${arr[0].id}?language=${lang}&api_key=${apiKey}`); } }
    else if (source === 'tvdb') { const find = await tmdbGet(`${TMDB_API}/find/${parsed.value}?external_source=tvdb_id&language=${lang}&api_key=${apiKey}`); if (find && find.tv_results && find.tv_results.length) d = await tmdbGet(`${TMDB_API}/tv/${find.tv_results[0].id}?language=${lang}&api_key=${apiKey}`); }
    else if (source === 'title') { const q = encodeURIComponent(parsed.title), yp = parsed.year ? `&year=${parsed.year}` : ''; const search = await tmdbGet(`${TMDB_API}/search/${kind}?query=${q}${yp}&language=${lang}&api_key=${apiKey}`); if (search && search.results && search.results.length) d = await tmdbGet(`${TMDB_API}/${kind}/${search.results[0].id}?language=${lang}&api_key=${apiKey}`); }
    const result = (d && (d.title || d.name)) ? { title: d.title || d.name || '', overview: d.overview || '', poster: d.poster_path ? tmdbPoster(d.poster_path) : null } : null;
    kvPutJSON(env, ctx, cacheKey, result ? { data: result } : { miss: true }, result ? TMDB_KV_TTL : 3600); return result;
  });
}
async function handleEnrich(request, env, ctx) {
  let body; try { body = await request.json(); } catch { return Response.json({}, { status: 400 }); }
  const rawItems = Array.isArray(body.items) ? body.items : []; if (!rawItems.length) return Response.json({});
  const limited = rawItems.slice(0, 80), out = {}, seen = new Set(), tasks = [];
  for (const it of limited) { const key = it && it.key; if (!key || seen.has(key)) continue; seen.add(key); tasks.push(enrichOne(key, env, ctx).then(d => { out[key] = d; }).catch(() => { out[key] = null; })); }
  await Promise.all(tasks); return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=600' } });
}

// ═══ 待看列表 ═══
async function fetchWatchlistRaw(headers, sort) {
  const qs = `extended=full&images=poster&sort=${encodeURIComponent(sort)}`;
  const [movies, shows] = await Promise.all([traktGet(`${TRAKT_API}/sync/watchlist/movies?${qs}`, headers), traktGet(`${TRAKT_API}/sync/watchlist/shows?${qs}`, headers)]);
  const merged = [];
  if (Array.isArray(movies)) for (const x of movies) merged.push(x);
  if (Array.isArray(shows)) for (const x of shows) merged.push(x);
  switch (sort) {
    case 'title': merged.sort((a, b) => String((a.movie && a.movie.title) || (a.show && a.show.title) || '').toLowerCase().localeCompare(String((b.movie && b.movie.title) || (b.show && b.show.title) || '').toLowerCase())); break;
    case 'released': merged.sort((a, b) => ((b.movie && b.movie.year) || (b.show && b.show.year) || 0) - ((a.movie && a.movie.year) || (a.show && a.show.year) || 0)); break;
    default: merged.sort((a, b) => (b.listed_at || '').localeCompare(a.listed_at || ''));
  }
  return merged;
}
async function getWatchlist(headers, sort = 'added', env, ctx, userKey) {
  if (!env) return fetchWatchlistRaw(headers, sort);
  const prefix = userKey || 'anon';
  const cacheKey = `wl:${prefix}:${sort}`;
  const mem = kvMemGet(cacheKey);
  if (mem !== undefined && mem !== KV_MISS) return (mem && mem.data) || [];
  return singleFlight(cacheKey, async () => {
    const cached = await kvGetJSON(env, cacheKey, true);
    if (cached !== undefined && cached !== KV_MISS) return (cached && cached.data) || [];
    const merged = await fetchWatchlistRaw(headers, sort);
    if (merged.length) kvPutJSON(env, ctx, cacheKey, { data: merged }, WATCHLIST_KV_TTL, true);
    return merged;
  });
}

// ═══ 搜索 / 趋势 ═══
async function handleSearch(request, env) {
  const url = new URL(request.url), q = (url.searchParams.get('q') || '').trim(), typeFilter = url.searchParams.get('type') || 'all';
  const a = await requireAuth(request, env); if (!a.ok) return unauthorizedJson();
  const { auth, headers, needsCookieUpdate } = a;
  const outHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (needsCookieUpdate) outHeaders['Set-Cookie'] = buildCookie(auth);
  if (!q) return new Response(JSON.stringify({ items: [] }), { headers: outHeaders });
  if (!env.TMDB_API_KEY) return new Response(JSON.stringify({ items: [], error: 'no tmdb key' }), { headers: outHeaders });
  const lang = 'zh-CN', apiKey = env.TMDB_API_KEY;
  const wantMovie = typeFilter === 'all' || typeFilter === 'movie';
  const wantShow = typeFilter === 'all' || typeFilter === 'show';
  const [movieRes, tvRes, wlMovies, wlShows] = await Promise.all([
    wantMovie ? tmdbGet(`${TMDB_API}/search/movie?query=${encodeURIComponent(q)}&language=${lang}&api_key=${apiKey}&include_adult=false`) : Promise.resolve(null),
    wantShow ? tmdbGet(`${TMDB_API}/search/tv?query=${encodeURIComponent(q)}&language=${lang}&api_key=${apiKey}&include_adult=false`) : Promise.resolve(null),
    traktGet(`${TRAKT_API}/sync/watchlist/movies`, headers, 1),
    traktGet(`${TRAKT_API}/sync/watchlist/shows`, headers, 1),
  ]);
  const inWatchlist = new Set();
  if (Array.isArray(wlMovies)) for (const x of wlMovies) { const id = x.movie && x.movie.ids && x.movie.ids.tmdb; if (id) inWatchlist.add('movie:' + id); }
  if (Array.isArray(wlShows)) for (const x of wlShows) { const id = x.show && x.show.ids && x.show.ids.tmdb; if (id) inWatchlist.add('show:' + id); }
  const merged = [];
  if (movieRes && Array.isArray(movieRes.results)) for (const r of movieRes.results) { if (!r.id) continue; merged.push({ type: 'movie', tmdbId: r.id, title: r.title || r.original_title || '', year: (r.release_date || '').slice(0, 4), poster: r.poster_path ? tmdbPoster(r.poster_path) : null, overview: r.overview || '', popularity: r.popularity || 0, inWatchlist: inWatchlist.has('movie:' + r.id) }); }
  if (tvRes && Array.isArray(tvRes.results)) for (const r of tvRes.results) { if (!r.id) continue; merged.push({ type: 'show', tmdbId: r.id, title: r.name || r.original_name || '', year: (r.first_air_date || '').slice(0, 4), poster: r.poster_path ? tmdbPoster(r.poster_path) : null, overview: r.overview || '', popularity: r.popularity || 0, inWatchlist: inWatchlist.has('show:' + r.id) }); }
  merged.sort((a, b) => b.popularity - a.popularity);
  return new Response(JSON.stringify({ items: merged.slice(0, 30) }), { headers: outHeaders });
}
async function handleTrending(request, env, ctx) {
  const a = await requireAuth(request, env); if (!a.ok) return unauthorizedJson();
  if (!env.TMDB_API_KEY) return Response.json({ items: [] });
  const url = new URL(request.url);
  const page = Math.max(1, Math.min(5, parseInt(url.searchParams.get('page') || '1', 10) || 1));
  const cacheKey = `trend:day:${page}`;
  let data = null;
  const mem = kvMemGet(cacheKey);
  if (mem !== undefined && mem !== KV_MISS) data = mem;
  else { const cached = await kvGetJSON(env, cacheKey); if (cached !== undefined && cached !== KV_MISS) data = cached; }
  if (!data || data === KV_MISS) { data = await tmdbGet(`${TMDB_API}/trending/all/day?language=zh-CN&api_key=${env.TMDB_API_KEY}&page=${page}`); kvPutJSON(env, ctx, cacheKey, data ? { data } : { miss: true }, data ? 1800 : 300); }
  const items = [];
  const results = (data && data.data && Array.isArray(data.data.results)) ? data.data.results : (data && Array.isArray(data.results) ? data.results : []);
  for (const r of results) {
    if (!r || !r.id) continue;
    const mt = r.media_type; if (mt !== 'movie' && mt !== 'tv') continue;
    const isMovie = mt === 'movie';
    items.push({ type: isMovie ? 'movie' : 'show', tmdbId: r.id, title: r.title || r.name || '', year: (r.release_date || r.first_air_date || '').slice(0, 4), poster: r.poster_path ? tmdbPoster(r.poster_path) : null, overview: r.overview || '', popularity: r.popularity || 0 });
  }
  return new Response(JSON.stringify({ items }), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=600' } });
}

// ═══ 待看增删 ═══
async function handleWatchlistAdd(request, env) {
  const a = await requireAuth(request, env); if (!a.ok) return unauthorizedJson();
  const { auth, headers, needsCookieUpdate } = a;
  let body; try { body = await request.json(); } catch { return Response.json({ error: 'bad body' }, { status: 400 }); }
  const type = body && body.type, tmdbId = body && body.tmdbId, rawId = body && body.id;
  if ((type !== 'movie' && type !== 'show') || (!tmdbId && !rawId)) return Response.json({ error: 'bad params' }, { status: 400 });
  let traktId = null;
  if (rawId && !tmdbId) { const n = Number(rawId); if (!Number.isFinite(n) || n <= 0) return Response.json({ error: 'bad id' }, { status: 400 }); traktId = n; }
  else {
    const arr = await traktGet(`${TRAKT_API}/search/tmdb/${tmdbId}?type=${type}`, headers, 1);
    if (!Array.isArray(arr) || !arr.length) return Response.json({ error: 'Trakt 上没有对应条目' }, { status: 404 });
    const key = type === 'movie' ? 'movie' : 'show';
    traktId = arr[0][key] && arr[0][key].ids && arr[0][key].ids.trakt;
    if (!traktId) return Response.json({ error: 'Trakt 上没有对应条目' }, { status: 404 });
  }
  const payload = type === 'movie' ? { movies: [{ ids: { trakt: traktId } }] } : { shows: [{ ids: { trakt: traktId } }] };
  let r; try { r = await fetchT(`${TRAKT_API}/sync/watchlist`, { method: 'POST', headers, body: JSON.stringify(payload) }, 10000); } catch (e) { return Response.json({ error: String(e) }, { status: 502 }); }
  const respHeaders = { 'Content-Type': 'application/json; charset=utf-8' }; if (needsCookieUpdate) respHeaders['Set-Cookie'] = buildCookie(auth);
  if (!r.ok) { const text = await r.text().catch(() => ''); return new Response(JSON.stringify({ error: 'HTTP ' + r.status, detail: text }), { status: r.status, headers: respHeaders }); }
  invalidateWatchlistCache();
  const result = await r.json().catch(() => null); return new Response(JSON.stringify({ ok: true, traktId, result }), { status: 200, headers: respHeaders });
}
async function handleWatchlistRemove(request, env) {
  const a = await requireAuth(request, env); if (!a.ok) return unauthorizedJson();
  const { auth, headers, needsCookieUpdate } = a;
  let body; try { body = await request.json(); } catch { return Response.json({ error: 'bad body' }, { status: 400 }); } const type = body && body.type, id = body && body.id;
  if ((type !== 'movie' && type !== 'show') || !id) return Response.json({ error: 'bad params' }, { status: 400 }); const traktId = Number(id); if (!Number.isFinite(traktId) || traktId <= 0) return Response.json({ error: 'bad id' }, { status: 400 });
  const payload = type === 'movie' ? { movies: [{ ids: { trakt: traktId } }] } : { shows: [{ ids: { trakt: traktId } }] };
  let r; try { r = await fetchT(`${TRAKT_API}/sync/watchlist/remove`, { method: 'POST', headers, body: JSON.stringify(payload) }, 10000); } catch (e) { return Response.json({ error: String(e) }, { status: 502 }); }
  const respHeaders = { 'Content-Type': 'application/json; charset=utf-8' }; if (needsCookieUpdate) respHeaders['Set-Cookie'] = buildCookie(auth);
  if (!r.ok) { const text = await r.text().catch(() => ''); return new Response(JSON.stringify({ error: 'HTTP ' + r.status, detail: text }), { status: r.status, headers: respHeaders }); }
  invalidateWatchlistCache();
  const result = await r.json().catch(() => null); return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: respHeaders });
}

// ═══ 标记已看 ═══
async function handleMarkWatched(request, env) {
  const a = await requireAuth(request, env); if (!a.ok) return unauthorizedJson();
  const { auth, headers, needsCookieUpdate } = a;
  let body; try { body = await request.json(); } catch { return Response.json({ error: 'bad body' }, { status: 400 }); } const type = body && body.type, id = body && body.id;
  if ((type !== 'movie' && type !== 'episode') || !id) return Response.json({ error: 'bad params' }, { status: 400 }); const traktId = Number(id); if (!Number.isFinite(traktId) || traktId <= 0) return Response.json({ error: 'bad id' }, { status: 400 });
  const payload = type === 'movie' ? { movies: [{ ids: { trakt: traktId } }] } : { episodes: [{ ids: { trakt: traktId } }] };
  let r; try { r = await fetchT(`${TRAKT_API}/sync/history`, { method: 'POST', headers, body: JSON.stringify(payload) }, 10000); } catch (e) { return Response.json({ error: String(e) }, { status: 502 }); }
  const respHeaders = { 'Content-Type': 'application/json; charset=utf-8' }; if (needsCookieUpdate) respHeaders['Set-Cookie'] = buildCookie(auth);
  if (!r.ok) { const text = await r.text().catch(() => ''); return new Response(JSON.stringify({ error: 'HTTP ' + r.status, detail: text }), { status: r.status, headers: respHeaders }); }
  const result = await r.json().catch(() => null); return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: respHeaders });
}
async function handleUnmarkWatched(request, env) {
  const a = await requireAuth(request, env); if (!a.ok) return unauthorizedJson();
  const { auth, headers, needsCookieUpdate } = a;
  let body; try { body = await request.json(); } catch { return Response.json({ error: 'bad body' }, { status: 400 }); } const type = body && body.type, id = body && body.id;
  if ((type !== 'movie' && type !== 'episode') || !id) return Response.json({ error: 'bad params' }, { status: 400 }); const traktId = Number(id); if (!Number.isFinite(traktId) || traktId <= 0) return Response.json({ error: 'bad id' }, { status: 400 });
  const payload = type === 'movie' ? { movies: [{ ids: { trakt: traktId } }] } : { episodes: [{ ids: { trakt: traktId } }] };
  let r; try { r = await fetchT(`${TRAKT_API}/sync/history/remove`, { method: 'POST', headers, body: JSON.stringify(payload) }, 10000); } catch (e) { return Response.json({ error: String(e) }, { status: 502 }); }
  const respHeaders = { 'Content-Type': 'application/json; charset=utf-8' }; if (needsCookieUpdate) respHeaders['Set-Cookie'] = buildCookie(auth);
  if (!r.ok) { const text = await r.text().catch(() => ''); return new Response(JSON.stringify({ error: 'HTTP ' + r.status, detail: text }), { status: r.status, headers: respHeaders }); }
  const result = await r.json().catch(() => null); return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: respHeaders });
}
async function handleMarkSeasonWatched(request, env) {
  const a = await requireAuth(request, env); if (!a.ok) return unauthorizedJson();
  const { auth, headers, needsCookieUpdate } = a;
  let body; try { body = await request.json(); } catch { return Response.json({ error: 'bad body' }, { status: 400 }); }
  const showId = Number(body && body.showId), season = Number(body && body.season);
  if (!Number.isFinite(showId) || showId <= 0 || !Number.isFinite(season)) return Response.json({ error: 'bad params' }, { status: 400 });
  const seasonData = await traktGet(`${TRAKT_API}/shows/${showId}/seasons/${season}?extended=full,episodes`, headers);
  if (!seasonData || seasonData.__error || !Array.isArray(seasonData.episodes)) return Response.json({ error: '无法获取季信息' }, { status: 502 });
  const now = Date.now();
  const episodes = seasonData.episodes
    .filter(ep => ep && ep.number != null && ep.first_aired)
    .filter(ep => new Date(ep.first_aired).getTime() <= now)
    .map(ep => ({ ids: { trakt: ep.ids && ep.ids.trakt } }))
    .filter(ep => ep.ids.trakt);
  if (!episodes.length) return Response.json({ ok: true, marked: 0 });
  let r; try { r = await fetchT(`${TRAKT_API}/sync/history`, { method: 'POST', headers, body: JSON.stringify({ episodes }) }, 15000); } catch (e) { return Response.json({ error: String(e) }, { status: 502 }); }
  const respHeaders = { 'Content-Type': 'application/json; charset=utf-8' }; if (needsCookieUpdate) respHeaders['Set-Cookie'] = buildCookie(auth);
  if (!r.ok) { const text = await r.text().catch(() => ''); return new Response(JSON.stringify({ error: 'HTTP ' + r.status, detail: text }), { status: r.status, headers: respHeaders }); }
  const result = await r.json().catch(() => null); return new Response(JSON.stringify({ ok: true, marked: episodes.length, result }), { status: 200, headers: respHeaders });
}

// ═══ 播出日历 ═══
async function handleShowCalendar(request, env, ctx) {
  const url = new URL(request.url), showId = url.searchParams.get('id'), tmdbId = url.searchParams.get('tmdb'); if (!showId || !/^\d+$/.test(showId)) return Response.json({ error: 'bad params' }, { status: 400 });
  const a = await requireAuth(request, env); if (!a.ok) return unauthorizedJson();
  const { auth, headers, needsCookieUpdate } = a;
  const seasons = await traktGet(`${TRAKT_API}/shows/${showId}/seasons?extended=full,episodes`, headers, 1); if (!Array.isArray(seasons)) return Response.json({ error: 'failed' }, { status: 502 });
  const zhTitles = {}; let zhShowTitle = '';
  if (tmdbId && /^\d+$/.test(tmdbId) && env.TMDB_API_KEY) {
    try {
      const tmdbShow = await tmdbDetailCached(`/tv/${tmdbId}`, env, ctx);
      if (tmdbShow) {
        if (tmdbShow.name) zhShowTitle = tmdbShow.name;
        if (Array.isArray(tmdbShow.seasons)) {
          const realSeasons = tmdbShow.seasons.filter(s => s.season_number > 0);
          const seasonDatas = await Promise.all(realSeasons.map(s => tmdbDetailCached(`/tv/${tmdbId}/season/${s.season_number}`, env, ctx)));
          for (const sd of seasonDatas) { if (!sd || !Array.isArray(sd.episodes)) continue; for (const ep of sd.episodes) { const key = ep.season_number + '-' + ep.episode_number; if (ep.name) zhTitles[key] = ep.name; } }
        }
      }
    } catch {}
  }
  const episodes = []; for (const s of seasons) { if (!s || s.number <= 0) continue; if (!Array.isArray(s.episodes)) continue; for (const ep of s.episodes) { if (!ep.first_aired) continue; const key = ep.season + '-' + ep.number, zh = zhTitles[key]; episodes.push({ season: ep.season, number: ep.number, title: zh || ep.title || '', first_aired: ep.first_aired }); } }
  const respHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=600' }; if (needsCookieUpdate) respHeaders['Set-Cookie'] = buildCookie(auth);
  return new Response(JSON.stringify({ episodes, title: zhShowTitle }), { headers: respHeaders });
}

// ═══ 首页 ═══
async function handleHome(request, env, ctx) {
  const url = new URL(request.url); let initialDetail = url.searchParams.get('d');
  if (!initialDetail && url.pathname.startsWith('/detail/')) { const parts = url.pathname.split('/').filter(Boolean); if (parts.length === 3) initialDetail = parts[1] + '/' + parts[2]; }
  const cookieAuth = readAuth(request); if (!cookieAuth) return html(renderLoginPage());
  return html(renderHomeShell(initialDetail));
}
async function getCalendarCached(today, headers, env, ctx, userKey) {
  const prefix = userKey || 'anon';
  const cacheKey = `cal:${prefix}:${today}`;
  const mem = kvMemGet(cacheKey);
  if (mem !== undefined) { if (mem === KV_MISS) return null; return mem.miss ? null : mem.data; }
  return singleFlight(cacheKey, async () => {
    const cached = await kvGetJSON(env, cacheKey, true);
    if (cached !== undefined && cached !== KV_MISS) return cached.miss ? null : cached.data;
    let data = null;
    try { const r = await fetchT(`${TRAKT_API}/calendars/my/shows/${today}/30?extended=full&images=poster`, { headers }, 9000); if (r.ok) data = await r.json(); } catch {}
    kvPutJSON(env, ctx, cacheKey, data ? { data } : { miss: true }, data ? CALENDAR_KV_TTL : 60, true);
    return data;
  });
}
async function handleHomeData(request, env, ctx) {
  const a = await requireAuth(request, env); if (!a.ok) return Response.json({ login: true }, { status: 401, headers: { 'Set-Cookie': clearCookieHeader() } });
  const { auth, headers, needsCookieUpdate } = a;
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10), part = new URL(request.url).searchParams.get('part') || 'all';
  const userKey = await getStableUserId(auth, headers);
  const fetchJson = async (url, retries = 2) => {
    for (let i = 0; i <= retries; i++) {
      try { const r = await fetchT(url, { headers }, 7000); if (r.status === 429) { if (i < retries) { await new Promise(res => setTimeout(res, Math.min(800 * Math.pow(2, i), 4000))); continue; } return { __error: 'HTTP 429', __pageCount: 1 }; } if (!r.ok) return { __error: `HTTP ${r.status}`, __pageCount: 1 }; const data = await r.json(), pageCount = parseInt(r.headers.get('X-Pagination-Page-Count') || '1'); if (Array.isArray(data)) Object.defineProperty(data, '__pageCount', { value: pageCount, enumerable: false }); return data; } catch (e) { if (i === retries) return { __error: String(e), __pageCount: 1 }; await new Promise(res => setTimeout(res, 400 * (i + 1))); }
    }
  };
  async function getProfile() {
    const cacheKey = `prof:${userKey}:me`;
    const cached = await kvGetJSON(env, cacheKey, true);
    if (cached !== undefined && cached !== KV_MISS && cached.data) return cached.data;
    const p = await fetchJson(`${TRAKT_API}/users/me?extended=full`);
    if (p && !p.__error) kvPutJSON(env, ctx, cacheKey, { data: p }, 180, true);
    return p;
  }
  const outHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }; if (needsCookieUpdate) outHeaders['Set-Cookie'] = buildCookie(auth);
  const wantPrimary = part === 'primary' || part === 'all', wantSecondary = part === 'secondary' || part === 'all'; let profile = null, stats = null, playback = null, history = null, calendar = null, watchlist = null; const tasks = [];
  if (wantPrimary) {
    tasks.push((async () => { profile = await getProfile(); })());
    tasks.push((async () => { stats = await fetchJson(`${TRAKT_API}/users/me/stats`); })());
    tasks.push((async () => { playback = await fetchJson(`${TRAKT_API}/sync/progress/up_next_nitro?extended=full&images=poster&limit=100&intent=continuing`); })());
  }
  if (wantSecondary) {
    tasks.push((async () => { history = await fetchJson(`${TRAKT_API}/users/me/history?limit=${PAGE_SIZE}&page=1&extended=full&images=poster`); })());
    tasks.push((async () => { calendar = await getCalendarCached(today, headers, env, ctx, userKey); })());
    tasks.push((async () => { watchlist = await getWatchlist(headers, 'added', env, ctx, userKey).catch(() => []); })());
  }
  await Promise.all(tasks); const result = { part };
  if (wantPrimary) { const username = (profile && !profile.__error && profile.username) || '我', displayName = (profile && !profile.__error && profile.name) || username, movieCount = stats && !stats.__error && stats.movies ? stats.movies.watched : 0, episodeCount = stats && !stats.__error && stats.episodes ? stats.episodes.watched : 0, showCount = stats && !stats.__error && stats.shows ? stats.shows.watched : 0, totalHours = stats && !stats.__error && stats.episodes && stats.episodes.minutes ? Math.round(stats.episodes.minutes / 60) : 0; let avatarUrl = ''; try { const imgs = profile && !profile.__error && profile.images; if (imgs && imgs.avatar) avatarUrl = imgs.avatar.full || imgs.avatar.medium || imgs.avatar.thumb || ''; } catch {}
    result.name = displayName; result.avatar = avatarUrl || null; result.statsHtml = renderStatsHtml({ movie: movieCount, show: showCount, episode: episodeCount, hours: totalHours });
    try { result.playbackHtml = renderContinueItems(playback); } catch { result.playbackHtml = '<div class="empty"><p>继续观看加载失败</p></div>'; }
  }
  if (wantSecondary) {
    try { const historyPageCount = (history && history.__pageCount) || 1; result.historyHtml = renderHistoryPage(history, env); result.historyMoreHtml = historyPageCount > 1 ? `<div class="load-more-wrap"><button class="load-more" data-page="2" onclick="loadMoreHistory(this)">加载更多</button></div>` : ''; } catch { result.historyHtml = '<div class="empty"><p>观看记录加载失败</p></div>'; result.historyMoreHtml = ''; }
    try { result.calendarHtml = renderCalendarPage(calendar, env, {}); } catch { result.calendarHtml = '<div class="empty"><p>日历加载失败</p></div>'; }
    try { const list = Array.isArray(watchlist) ? watchlist : []; if (!list.length) result.watchlistHtml = emptyWatchlistHtml(); else { const firstPage = list.slice(0, WATCHLIST_PAGE_SIZE), hasMore = list.length > WATCHLIST_PAGE_SIZE, cardsHtml = renderWatchlistItems(firstPage, env), moreHtml = hasMore ? `<div class="load-more-wrap"><button class="load-more" data-page="2" data-sort="added" onclick="loadMoreWatchlist(this)">加载更多</button></div>` : ''; result.watchlistHtml = watchlistToolbarHtml('added') + `<div id="watchlist-grid" class="grid">${cardsHtml}</div>` + moreHtml; } } catch { result.watchlistHtml = '<div class="empty"><p>待看列表加载失败</p></div>'; }
  }
  return new Response(JSON.stringify(result), { headers: outHeaders });
}

// ═══ 首页渲染 ═══
function renderHomeShell(initialDetail) {
  const boot = initialDetail ? `<script>window.__initialDetail=${jsStr(initialDetail)};<\/script>` : '';
  return pageHead() + renderHomeSkeleton(initialDetail) + `<script>(function(){window.__splashT0=Date.now();window.__splashHidden=false;window.__hideSplash=function(force){if(window.__splashHidden)return;window.__splashHidden=true;var el=document.getElementById('splash');if(!el)return;var wait=force?0:Math.max(0,280-(Date.now()-(window.__splashT0||Date.now())));setTimeout(function(){el.classList.add('hide');setTimeout(function(){if(el&&el.parentNode)el.parentNode.removeChild(el);},360);},wait);};setTimeout(function(){if(window.__hideSplash)window.__hideSplash();},120);function setHTML(sel,html){var el=typeof sel==='string'?document.querySelector(sel):sel;if(el)el.innerHTML=html||'';}function applyAvatar(url){if(!url)return;var av=document.getElementById('hero-avatar');if(!av)return;var img=document.createElement('img');img.src=url;img.alt='';img.width=56;img.height=56;img.decoding='async';img.onerror=function(){av.innerHTML='<span class="hero-avatar-ph">👤</span>';};av.innerHTML='';av.appendChild(img);}function __setUpdatedAt(){var el=document.getElementById('updated-at');if(!el)return;var d=new Date(),p=function(n){return(n<10?'0':'')+n;};el.textContent='更新于 '+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());el.classList.remove('flash');void el.offsetWidth;el.classList.add('flash');}function applyPrimary(d){if(!d)return;var n=document.getElementById('hero-name');if(n&&d.name)n.textContent=d.name;applyAvatar(d.avatar);if(d.statsHtml)setHTML('#stats-box',d.statsHtml);if(d.playbackHtml)setHTML('#playback',d.playbackHtml);__setUpdatedAt();if(window.__scheduleEnrich)window.__scheduleEnrich();}function applySecondary(d){if(!d)return;if(d.historyHtml)setHTML('#history .grid',d.historyHtml);if(d.historyMoreHtml!=null)setHTML('#history-more',d.historyMoreHtml);if(d.calendarHtml)setHTML('#calendar',d.calendarHtml);if(d.watchlistHtml)setHTML('#watchlist',d.watchlistHtml);if(window.__scheduleEnrich)window.__scheduleEnrich();}var __homeDataLoading=false;function fetchPart(part){return fetch('/api/home-data?part='+encodeURIComponent(part),{credentials:'same-origin',cache:'no-store'}).then(function(r){if(r.status===401){location.href='/';return null;}if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}).then(function(d){if(!d)return null;if(d.login){location.reload();return null;}return d;});}function loadHomeData(opts){opts=opts||{};var silent=!!opts.silent;if(__homeDataLoading&&!silent)return;__homeDataLoading=true;__lastRefreshAt=Date.now();var pPrimary=fetchPart('primary').then(function(d){applyPrimary(d);if(!silent&&window.__hideSplash)window.__hideSplash(true);if(!silent&&window.__initialDetail){var s=window.__initialDetail,idx=s.indexOf('/');if(idx>0&&window.openDetail)openDetail(s.slice(0,idx),s.slice(idx+1),false);window.__initialDetail=null;}}).catch(function(){if(!silent){setHTML('#playback','<div class="empty"><p>加载失败，请点击重试</p><p style="margin-top:12px"><button class="btn-ghost" onclick="location.reload()">重试</button></p></div>');if(window.__hideSplash)window.__hideSplash(true);}});var pSecondary=fetchPart('secondary').then(function(d){applySecondary(d);}).catch(function(){if(!silent){setHTML('#history .grid','<div class="empty"><p>部分内容加载失败</p></div>');}});Promise.all([pPrimary,pSecondary]).then(function(){__homeDataLoading=false;});}var __refreshTick=0;function silentRefresh(){if(document.hidden)return;__refreshTick++;__lastRefreshAt=Date.now();fetchPart('primary').then(function(d){applyPrimary(d);}).catch(function(){});if(__refreshTick%2===0){var secActive=false;['watchlist','calendar','history'].forEach(function(id){var el=document.getElementById(id);if(el&&el.classList.contains('active'))secActive=true;});if(!secActive)fetchPart('secondary').then(function(d){applySecondary(d);}).catch(function(){});}}function startHomeData(){loadHomeData({silent:false});}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',startHomeData);}else{startHomeData();}var REFRESH_MIN=${HOME_AUTO_REFRESH_MINUTES};var REFRESH_MS=(REFRESH_MIN>0?REFRESH_MIN:0)*60*1000;var __lastRefreshAt=Date.now();if(REFRESH_MS>0){setInterval(silentRefresh,REFRESH_MS);document.addEventListener('visibilitychange',function(){if(document.hidden)return;if(Date.now()-__lastRefreshAt>=REFRESH_MS)silentRefresh();});}})();<\/script>` + pageTail();
}
function renderHomeSkeleton(initialDetail) {
  const boot = initialDetail ? `<script>window.addEventListener('load',()=>{const s=${jsStr(initialDetail)},idx=s.indexOf('/');if(idx>0)openDetail(s.slice(0,idx),s.slice(idx+1),false);});<\/script>` : '';
  return `<div class="container"><header class="hero"><div class="hero-left"><div class="hero-avatar" id="hero-avatar" aria-hidden="true"><span class="hero-avatar-ph">👤</span></div><div class="hero-text"><h1 class="hero-name" id="hero-name">…</h1><p class="updated-at" id="updated-at"></p></div></div><div class="hero-actions"><button class="btn-action" onclick="location.reload()" title="刷新数据"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg><span>刷新</span></button><button class="btn-action" onclick="logout()" title="退出登录"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg><span>退出</span></button></div></header><div class="stats" id="stats-box">${renderStatsHtml(null)}</div><nav class="tabs"><button class="tab active" data-tab="playback">继续观看</button><button class="tab" data-tab="watchlist">待看列表</button><button class="tab" data-tab="calendar">追剧日历</button><button class="tab" data-tab="history">观看记录</button><button class="tab" data-tab="search">搜索</button></nav><section id="playback" class="pane active"><div class="pane-loading"><div class="spinner"></div></div></section><section id="watchlist" class="pane"><div class="pane-loading"><div class="spinner"></div></div></section><section id="calendar" class="pane"><div class="pane-loading"><div class="spinner"></div></div></section><section id="history" class="pane"><div class="grid"></div><div id="history-more"></div></section><section id="search" class="pane"><div class="search-bar"><input id="search-input" class="search-input" type="search" placeholder="搜索电影 / 剧集" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></div><div id="search-results" class="grid"></div></section></div><div id="confirm-modal" class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" style="display:none"><div class="confirm-backdrop"></div><div class="confirm-panel"><div class="confirm-icon" id="confirm-icon">?</div><div class="confirm-title" id="confirm-title"></div><div class="confirm-msg" id="confirm-msg"></div><div class="confirm-actions"><button class="confirm-btn confirm-cancel" id="confirm-cancel" type="button">取消</button><button class="confirm-btn confirm-ok" id="confirm-ok" type="button">确定</button></div></div></div><div id="modal" class="modal"><div class="modal-backdrop" onclick="closeDetail()"></div><div class="modal-panel"><div class="modal-body" id="modal-body"></div><button class="modal-close" onclick="closeDetail()" aria-label="关闭"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div></div><div id="show-cal-modal" class="show-cal-modal"><div class="show-cal-backdrop" onclick="closeShowCal()"></div><div class="show-cal-panel"><div class="show-cal-head"><div class="show-cal-name" id="show-cal-name"></div><button class="show-cal-close" onclick="closeShowCal()" aria-label="关闭">×</button></div><div class="show-cal-info" id="show-cal-info"></div><div class="show-cal-nav"><button onclick="calShiftMonth(-1)" aria-label="上个月">‹</button><div id="show-cal-month">—</div><button onclick="calShiftMonth(1)" aria-label="下个月">›</button></div><div class="show-cal-weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div><div class="show-cal-grid" id="show-cal-grid"></div><div class="show-cal-legend"><span class="legend-item"><i class="legend-dot legend-past"></i>已播出</span><span class="legend-item"><i class="legend-dot legend-today"></i>今天</span><span class="legend-item"><i class="legend-dot legend-future"></i>待播出</span></div><div class="show-cal-detail" id="show-cal-detail"></div></div></div><script src="/app.js?v=${APP_JS_VERSION}" defer><\/script>${boot}`;
}

function getClientSideScripts() {
  return `function __esc(s){s=String(s==null?'':s);return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}function __confirm(opts){opts=opts||{};return new Promise(function(resolve){var modal=document.getElementById('confirm-modal');if(!modal){resolve(window.confirm(opts.message||opts.title||'确认操作'));return;}var iconEl=document.getElementById('confirm-icon'),titleEl=document.getElementById('confirm-title'),msgEl=document.getElementById('confirm-msg'),okBtn=document.getElementById('confirm-ok'),cancelBtn=document.getElementById('confirm-cancel'),backdrop=modal.querySelector('.confirm-backdrop');iconEl.className='confirm-icon'+(opts.tone?' '+opts.tone:'');iconEl.textContent=opts.icon||'?';titleEl.textContent=opts.title||'确认操作';msgEl.textContent=opts.message||'';msgEl.style.display=opts.message?'':'none';okBtn.textContent=opts.okText||'确定';cancelBtn.textContent=opts.cancelText||'取消';okBtn.className='confirm-btn confirm-ok'+(opts.tone==='danger'?' danger':'');var settled=false;function cleanup(){okBtn.removeEventListener('click',onOk);cancelBtn.removeEventListener('click',onCancel);backdrop.removeEventListener('click',onCancel);document.removeEventListener('keydown',onKey,true);modal.classList.remove('open');modal.style.display='none';}function finish(v){if(settled)return;settled=true;cleanup();resolve(v);}function onOk(){finish(true);}function onCancel(){finish(false);}function onKey(e){if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish(false);}}okBtn.addEventListener('click',onOk);cancelBtn.addEventListener('click',onCancel);backdrop.addEventListener('click',onCancel);document.addEventListener('keydown',onKey,true);modal.style.display='block';modal.classList.add('open');setTimeout(function(){try{okBtn.focus();}catch(err){}},40);});}window.__confirm=__confirm;function __fadeRemoveCard(card){if(!card)return;card.style.transition='opacity 0.25s ease, transform 0.25s ease';card.style.opacity='0';card.style.transform='scale(0.96)';setTimeout(function(){var day=card.closest('.day'),pane=card.closest('.pane');card.remove();if(day&&!day.querySelector('.item')){day.style.transition='opacity 0.2s ease';day.style.opacity='0';setTimeout(function(){if(day.parentNode)day.remove();__maybeShowEmpty(pane);},200);return;}__maybeShowEmpty(pane);},260);}function __maybeShowEmpty(pane){if(!pane)return;setTimeout(function(){if(pane.querySelector('.item'))return;if(pane.querySelector('.empty'))return;var grid=pane.querySelector('.grid');if(!grid)return;var pid=pane.id,txt='这里暂时没有内容';if(pid==='playback')txt='暂时没有继续观看的内容';else if(pid==='watchlist')txt='待看列表是空的';else if(pid==='calendar')txt='未来 30 天没有待播剧集';else if(pid==='history')txt='还没有观看记录';grid.innerHTML='<div class="empty"><p>'+txt+'</p></div>';},120);}document.querySelectorAll('.tab').forEach(t=>{t.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.pane').forEach(x=>x.classList.remove('active'));t.classList.add('active');var pane=document.getElementById(t.dataset.tab);if(pane)pane.classList.add('active');if(t.dataset.tab==='search'){setTimeout(function(){var inp=document.getElementById('search-input');if(inp)inp.focus();if(inp&&!inp.value.trim()&&window.__loadTrending)window.__loadTrending();},60);}});});async function logout(){if(!(await __confirm({icon:'🚪',title:'退出登录',message:'确定要退出当前 Trakt 账号吗？',okText:'退出',cancelText:'取消',tone:'warn'})))return;await fetch('/auth/logout',{method:'POST'});location.reload();}async function loadMoreHistory(btn){const page=parseInt(btn.dataset.page||'2');btn.disabled=true;btn.textContent='加载中…';try{const r=await fetch('/api/more?type=history&page='+page);if(!r.ok)throw new Error('HTTP '+r.status);const htmlText=await r.text();document.querySelector('#history .grid').insertAdjacentHTML('beforeend',htmlText);if(window.__scheduleEnrich)window.__scheduleEnrich();const hasMore=r.headers.get('X-Has-More')==='true';if(hasMore){btn.dataset.page=page+1;btn.disabled=false;btn.textContent='加载更多';}else{btn.textContent='已经到底啦';btn.disabled=true;btn.style.opacity='0.5';btn.style.cursor='default';}}catch(e){btn.textContent='加载失败，点击重试';btn.disabled=false;}}async function onWatchlistSortChange(sort){const grid=document.getElementById('watchlist-grid'),pane=document.getElementById('watchlist');if(grid)grid.innerHTML='<div class="pane-loading"><div class="spinner"></div></div>';const oldMore=pane?pane.querySelector('.load-more-wrap'):null;if(oldMore)oldMore.remove();try{const r=await fetch('/api/more?type=watchlist&page=1&sort='+encodeURIComponent(sort));if(!r.ok)throw new Error('HTTP '+r.status);const htmlText=await r.text();if(grid)grid.innerHTML=htmlText||emptyWatchlistInner();const hasMore=r.headers.get('X-Has-More')==='true';if(hasMore&&pane&&grid){const wrap=document.createElement('div');wrap.className='load-more-wrap';wrap.innerHTML='<button class="load-more" data-page="2" data-sort="'+sort+'" onclick="loadMoreWatchlist(this)">加载更多</button>';pane.appendChild(wrap);}if(window.__scheduleEnrich)window.__scheduleEnrich();}catch(e){if(grid)grid.innerHTML='<div class="empty"><p>加载失败</p></div>';}}function emptyWatchlistInner(){return '<div class="empty"><p>待看列表是空的</p></div>';}async function loadMoreWatchlist(btn){const page=parseInt(btn.dataset.page||'2'),sort=btn.dataset.sort||(document.getElementById('wl-sort')&&document.getElementById('wl-sort').value)||'added';btn.disabled=true;btn.textContent='加载中…';try{const r=await fetch('/api/more?type=watchlist&page='+page+'&sort='+encodeURIComponent(sort));if(!r.ok)throw new Error('HTTP '+r.status);const htmlText=await r.text();const grid=document.getElementById('watchlist-grid');if(grid)grid.insertAdjacentHTML('beforeend',htmlText);if(window.__scheduleEnrich)window.__scheduleEnrich();const hasMore=r.headers.get('X-Has-More')==='true';if(hasMore){btn.dataset.page=page+1;btn.disabled=false;btn.textContent='加载更多';}else{btn.textContent='已经到底啦';btn.disabled=true;btn.style.opacity='0.5';btn.style.cursor='default';}}catch(e){btn.textContent='加载失败，点击重试';btn.disabled=false;}}document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-wl-remove-id]');if(!btn)return;e.preventDefault();e.stopPropagation();if(btn.disabled)return;const type=btn.dataset.wlRemoveType,id=btn.dataset.wlRemoveId;if(!type||!id)return;const item=btn.closest('.item'),nameEl=item?item.querySelector('.name'):null,name=nameEl?nameEl.textContent:'';if(!(await __confirm({icon:'🗑',title:'移除待看',message:'确定要把「'+(name||'该条目')+'」从待看列表移除吗？',okText:'移除',tone:'danger'})))return;const prevText=btn.textContent;btn.disabled=true;btn.textContent='…';try{const r=await fetch('/api/watchlist/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,id})});if(!r.ok)throw new Error('HTTP '+r.status);__fadeRemoveCard(btn.closest('.item'));}catch(err){btn.disabled=false;btn.textContent=prevText;alert('移除失败：'+err.message);}},true);document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-watched-id]');if(!btn)return;e.preventDefault();e.stopPropagation();if(btn.disabled)return;const type=btn.dataset.watchedType,id=btn.dataset.watchedId;if(!type||!id)return;const item=btn.closest('.item'),nameEl=item?item.querySelector('.name'):null,name=nameEl?nameEl.textContent:'';if(!(await __confirm({icon:'✓',title:'标记为已观看',message:'确定要把「'+(name||'该条目')+'」标记为已观看吗？',okText:'标记',tone:'success'})))return;const prev=btn.textContent;btn.disabled=true;btn.textContent='…';try{const r=await fetch('/api/mark-watched',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,id})});if(!r.ok)throw new Error('HTTP '+r.status);__fadeRemoveCard(btn.closest('.item'));}catch(err){btn.disabled=false;btn.textContent=prev;alert('标记失败：'+err.message);}},true);document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-unwatch-id]');if(!btn)return;e.preventDefault();e.stopPropagation();if(btn.disabled)return;const type=btn.dataset.unwatchType,id=btn.dataset.unwatchId;if(!type||!id)return;const item=btn.closest('.item'),nameEl=item?item.querySelector('.name'):null,name=nameEl?nameEl.textContent:'';if(!(await __confirm({icon:'↺',title:'取消观看',message:'确定要取消「'+(name||'该条目')+'」的观看记录吗？',okText:'取消观看',tone:'warn'})))return;const prev=btn.textContent;btn.disabled=true;btn.textContent='…';try{const r=await fetch('/api/unmark-watched',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,id})});if(!r.ok)throw new Error('HTTP '+r.status);__fadeRemoveCard(btn.closest('.item'));}catch(err){btn.disabled=false;btn.textContent=prev;alert('取消失败：'+err.message);}},true);var __searchTimer=null,__searchSeq=0;function __renderSearchItem(it){var emoji=it.type==='movie'?'🎬':'📺';var poster=it.poster?'<img src="'+__esc(it.poster)+'" loading="lazy" alt="">':'<div class="poster-ph"><span>'+emoji+'</span></div>';var tag=it.type==='movie'?'电影':'剧集';var meta=tag+(it.year?' · '+__esc(String(it.year)):'');var btn=it.inWatchlist?'<button class="cal-open-btn wl-added" type="button" disabled>✓ 已在待看</button>':'<button class="cal-open-btn" type="button" data-wl-add-tmdb="'+it.tmdbId+'" data-wl-add-type="'+it.type+'">+ 加入待看</button>';var ov=it.overview?'<div class="overview">'+__esc(it.overview)+'</div>':'';return '<div class="item clickable" data-detail-type="'+it.type+'" data-detail-id="tmdb-'+it.tmdbId+'" role="button" tabindex="0"><div class="poster">'+poster+'</div><div class="info"><div class="name-row"><span class="name">'+__esc(it.title)+'</span></div><div class="meta">'+meta+'</div>'+ov+btn+'</div></div>';}async function __doSearch(q){var box=document.getElementById('search-results');if(!box)return;if(!q){__loadTrending();return;}var seq=++__searchSeq;box.innerHTML='<div class="pane-loading"><div class="spinner"></div></div>';try{var r=await fetch('/api/search?q='+encodeURIComponent(q));if(seq!==__searchSeq)return;if(!r.ok)throw new Error('HTTP '+r.status);var data=await r.json();if(seq!==__searchSeq)return;var items=(data&&data.items)||[];if(!items.length){box.innerHTML='<div class="empty"><p>没有找到相关结果</p></div>';return;}box.innerHTML=items.map(__renderSearchItem).join('');}catch(err){if(seq!==__searchSeq)return;box.innerHTML='<div class="empty"><p>搜索失败：'+__esc(err.message)+'</p></div>';}}var __trendingLoaded=false;async function __loadTrending(force){var box=document.getElementById('search-results');if(!box)return;var inp=document.getElementById('search-input');if(inp&&inp.value.trim())return;if(box.querySelector('.trending-head')&&!force)return;box.innerHTML='<div class="pane-loading"><div class="spinner"></div></div>';try{var r=await fetch('/api/trending');if(!r.ok)throw new Error('HTTP '+r.status);var data=await r.json();var items=(data&&data.items)||[];if(!items.length){box.innerHTML='<div class="empty"><p>暂无趋势内容</p></div>';return;}__trendingLoaded=true;box.innerHTML='<div class="trending-head">TMDB 今日趋势</div>'+items.map(__renderSearchItem).join('');}catch(err){box.innerHTML='<div class="empty"><p>趋势加载失败：'+__esc(err.message)+'</p></div>';}}window.__loadTrending=__loadTrending;(function(){var inp=document.getElementById('search-input');if(!inp)return;inp.addEventListener('input',function(){if(__searchTimer)clearTimeout(__searchTimer);var q=inp.value.trim();if(!q){__loadTrending();return;}__searchTimer=setTimeout(function(){__doSearch(q);},380);});inp.addEventListener('keydown',function(e){if(e.key==='Enter'){if(__searchTimer)clearTimeout(__searchTimer);var q=inp.value.trim();if(q)__doSearch(q);else __loadTrending(true);}});})();document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-wl-add-tmdb]');if(!btn)return;e.preventDefault();e.stopPropagation();if(btn.disabled)return;const type=btn.dataset.wlAddType,tmdbId=btn.dataset.wlAddTmdb;if(!type||!tmdbId)return;const item=btn.closest('.item'),nameEl=item?item.querySelector('.name'):null,name=nameEl?nameEl.textContent:'';if(!(await __confirm({icon:'＋',title:'加入待看',message:'确定要把「'+(name||'该条目')+'」加入待看列表吗？',okText:'加入',tone:'success'})))return;const prev=btn.textContent;btn.disabled=true;btn.textContent='…';try{const r=await fetch('/api/watchlist/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,tmdbId})});if(!r.ok)throw new Error('HTTP '+r.status);btn.textContent='✓ 已在待看';btn.classList.add('wl-added');btn.disabled=true;}catch(err){btn.disabled=false;btn.textContent=prev;alert('加入失败：'+err.message);}},true);let modalLoadingId=0;async function openDetail(type,id,push=true){const modal=document.getElementById('modal'),body=document.getElementById('modal-body');if(!modal||!body)return;modal.classList.add('open');document.body.style.overflow='hidden';if(push&&location.pathname!=='/detail/'+type+'/'+id)history.pushState({detail:true},'','/detail/'+type+'/'+id);const reqId=++modalLoadingId;body.innerHTML='<div class="modal-loading"><div class="spinner"></div></div>';body.scrollTop=0;try{const r=await fetch('/api/detail?type='+encodeURIComponent(type)+'&id='+encodeURIComponent(id));if(reqId!==modalLoadingId)return;if(!r.ok)throw new Error('HTTP '+r.status);body.innerHTML=await r.text();}catch(e){if(reqId!==modalLoadingId)return;body.innerHTML='<div class="modal-error">加载失败</div>';}}function closeDetail(push=true){const modal=document.getElementById('modal');if(!modal)return;if(push&&location.pathname.startsWith('/detail/')){history.back();return;}modal.classList.remove('open');document.body.style.overflow='';}document.addEventListener('click',(e)=>{const el=e.target.closest('[data-detail-type]');if(!el)return;const t=el.dataset.detailType,i=el.dataset.detailId;if(!t||!i)return;if(e.target.closest('button,a,.ep-watch-btn,.d-mark-btn'))return;e.preventDefault();openDetail(t,i);});document.addEventListener('click',(e)=>{const mb=document.getElementById('modal-body');if(!mb||!mb.contains(e.target))return;const inner=e.target.closest('.detail-hero');if(!inner)return;if(e.target.closest('button,a,.item,.episode,.season-head'))return;const rect=inner.getBoundingClientRect();const y=e.clientY-rect.top;if(y<70)closeDetail();},true);document.addEventListener('keydown',(e)=>{if(e.key!=='Escape')return;const sc=document.getElementById('show-cal-modal');if(sc&&sc.classList.contains('open')){closeShowCal();return;}closeDetail();});document.addEventListener('click',(e)=>{const head=e.target.closest('.season-head');if(!head)return;toggleSeason(head);});document.addEventListener('click',(e)=>{const ep=e.target.closest('.episode');if(!ep)return;const url=ep.dataset.traktUrl;if(!url)return;if(e.target.closest('.ep-watch-btn'))return;e.preventDefault();e.stopPropagation();window.open(url,'_blank','noopener');});async function toggleSeason(headEl){if(!headEl)return;const item=headEl.closest('.season-item');if(!item)return;const body=item.querySelector('.season-body');if(!body)return;if(item.classList.contains('open')){item.classList.remove('open');return;}item.classList.add('open');if(body.dataset.loaded)return;body.innerHTML='<div class="modal-loading" style="padding:24px"><div class="spinner"></div></div>';try{const r=await fetch('/api/season?show='+encodeURIComponent(headEl.dataset.show)+'&season='+encodeURIComponent(headEl.dataset.season)+'&tmdb='+encodeURIComponent(headEl.dataset.tmdb)+'&slug='+encodeURIComponent(headEl.dataset.slug||''));if(!r.ok)throw new Error('HTTP '+r.status);body.innerHTML=await r.text();body.dataset.loaded='1';}catch(e){body.innerHTML='<div class="modal-error" style="padding:20px">加载失败</div>';}}window.addEventListener('popstate',()=>{const path=location.pathname;if(path.startsWith('/detail/')){const parts=path.split('/').filter(Boolean);if(parts.length===3)openDetail(parts[1],parts[2],false);}else{closeDetail(false);}});const __prefetched=new Set();function __prefetchDetail(type,id){if(!type||!id)return;const key=type+'/'+id;if(__prefetched.has(key))return;if(__prefetched.size>=60){const first=__prefetched.values().next().value;if(first!==undefined)__prefetched.delete(first);}__prefetched.add(key);fetch('/api/detail?type='+encodeURIComponent(type)+'&id='+encodeURIComponent(id),{cache:'default'}).catch(()=>{});}document.addEventListener('touchstart',(e)=>{const el=e.target.closest('[data-detail-type]');if(el)__prefetchDetail(el.dataset.detailType,el.dataset.detailId);},{passive:true,capture:true});document.addEventListener('mouseover',(e)=>{const el=e.target.closest('[data-detail-type]');if(el)__prefetchDetail(el.dataset.detailType,el.dataset.detailId);},{passive:true});var __showCal={byDay:{},year:0,month:0};function __pad2(n){return(n<10?'0':'')+n;}function __escShowCal(s){s=String(s==null?'':s);return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}function __bjDay(iso){if(!iso)return '';var d=new Date(new Date(iso).getTime()+8*3600*1000);return d.getUTCFullYear()+'-'+__pad2(d.getUTCMonth()+1)+'-'+__pad2(d.getUTCDate());}function openShowCalendar(showId,showName,tmdbId){var modal=document.getElementById('show-cal-modal'),nameEl=document.getElementById('show-cal-name'),infoEl=document.getElementById('show-cal-info'),gridEl=document.getElementById('show-cal-grid'),detailEl=document.getElementById('show-cal-detail');if(!modal||!gridEl)return;var now=new Date();__showCal.year=now.getFullYear();__showCal.month=now.getMonth();__showCal.byDay={};modal.classList.add('open');nameEl.textContent=showName||'';infoEl.textContent='正在加载…';gridEl.innerHTML='<div class="modal-loading" style="grid-column:1/-1;padding:40px 10px"><div class="spinner"></div></div>';detailEl.innerHTML='';renderShowCal();var apiUrl='/api/show-calendar?id='+encodeURIComponent(showId);if(tmdbId)apiUrl+='&tmdb='+encodeURIComponent(tmdbId);fetch(apiUrl).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}).then(function(data){if(data&&data.title)nameEl.textContent=data.title;var map={},eps=(data&&data.episodes)||[];for(var i=0;i<eps.length;i++){var ep=eps[i],day=__bjDay(ep.first_aired);if(!day)continue;if(!map[day])map[day]=[];map[day].push(ep);}__showCal.byDay=map;if(!eps.length){infoEl.textContent='暂无播出记录';}else{var keys=Object.keys(map).sort(),minLabel=keys[0].slice(0,7),maxLabel=keys[keys.length-1].slice(0,7);infoEl.textContent='共 '+keys.length+' 天有更新 · '+minLabel+' ~ '+maxLabel+'（点 ◀ ▶ 翻月）';}renderShowCal();}).catch(function(){infoEl.textContent='加载失败';gridEl.innerHTML='<div class="modal-error" style="grid-column:1/-1;padding:40px 10px">加载失败</div>';});}function closeShowCal(){var modal=document.getElementById('show-cal-modal');if(modal)modal.classList.remove('open');}function calShiftMonth(delta){var m=__showCal.month+delta,y=__showCal.year;while(m<0){m+=12;y--;}while(m>11){m-=12;y++;}__showCal.month=m;__showCal.year=y;renderShowCal();}function renderShowCal(){var titleEl=document.getElementById('show-cal-month'),gridEl=document.getElementById('show-cal-grid'),detailEl=document.getElementById('show-cal-detail');if(!titleEl||!gridEl)return;var y=__showCal.year,m=__showCal.month;titleEl.textContent=y+' 年 '+(m+1)+' 月';var firstDow=new Date(Date.UTC(y,m,1)).getUTCDay(),daysInMonth=new Date(Date.UTC(y,m+1,0)).getUTCDate(),todayStr=__bjDay(new Date().toISOString()),html='',i;for(i=0;i<firstDow;i++){html+='<div class="sc-day sc-empty"></div>';}for(var d=1;d<=daysInMonth;d++){var dayStr=y+'-'+__pad2(m+1)+'-'+__pad2(d),eps=__showCal.byDay[dayStr]||[],cls='sc-day';if(eps.length){if(dayStr===todayStr)cls+=' sc-has sc-today-day';else if(dayStr<todayStr)cls+=' sc-has sc-past';else cls+=' sc-has sc-future';}var badge=eps.length?'<span class="sc-badge">'+eps.length+'</span>':'';html+='<div class="'+cls+'" data-day="'+dayStr+'"><span class="sc-num">'+d+'</span>'+badge+'</div>';}gridEl.innerHTML=html;detailEl.innerHTML='';var days=gridEl.querySelectorAll('.sc-day[data-day]');for(var j=0;j<days.length;j++){(function(el){el.addEventListener('click',function(){var day=el.getAttribute('data-day'),arr=__showCal.byDay[day]||[];if(!arr.length)return;var all=gridEl.querySelectorAll('.sc-day');for(var q=0;q<all.length;q++)all[q].classList.remove('sc-active');el.classList.add('sc-active');var dh='';for(var e=0;e<arr.length;e++){var ep=arr[e];dh+='<div class="sc-ep"><span class="sc-ep-tag">S'+__pad2(ep.season)+'E'+__pad2(ep.number)+'</span><span class="sc-ep-title">'+__escShowCal(ep.title||'')+'</span></div>';}detailEl.innerHTML=dh;});})(days[j]);}}document.addEventListener('click',function(e){var btn=e.target.closest('[data-cal-show-id]');if(!btn)return;e.preventDefault();e.stopPropagation();openShowCalendar(btn.getAttribute('data-cal-show-id'),btn.getAttribute('data-cal-show-name')||'',btn.getAttribute('data-cal-show-tmdb')||'');},true);document.addEventListener('click',async(e)=>{const btn=e.target.closest('.ep-watch-btn');if(!btn)return;e.preventDefault();e.stopPropagation();const episodeId=btn.dataset.episodeId;if(!episodeId)return;if(!(await __confirm({icon:'✓',title:'标记本集已看',message:'确定要把这一集标记为已看吗？',okText:'标记',tone:'success'})))return;const prev=btn.textContent;btn.disabled=true;btn.textContent='…';try{const r=await fetch('/api/mark-watched',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'episode',id:episodeId})});if(!r.ok)throw new Error('HTTP '+r.status);btn.textContent='✓';btn.classList.add('done');}catch(err){btn.disabled=false;btn.textContent=prev;alert('标记失败：'+err.message);}},true);document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-mark-movie]');if(!btn)return;e.preventDefault();e.stopPropagation();const id=btn.dataset.markMovie;if(!id)return;if(!(await __confirm({icon:'✓',title:'标记已观看',message:'确定要把这部电影标记为已观看吗？',okText:'标记',tone:'success'})))return;const prev=btn.textContent;btn.disabled=true;btn.textContent='…';try{const r=await fetch('/api/mark-watched',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'movie',id})});if(!r.ok)throw new Error('HTTP '+r.status);btn.textContent='✓ 已标记';btn.classList.add('done');const parts=location.pathname.split('/').filter(Boolean);if(parts[0]==='detail'&&parts.length===3){setTimeout(()=>openDetail(parts[1],parts[2],false),350);}}catch(err){btn.disabled=false;btn.textContent=prev;alert('标记失败：'+err.message);}},true);document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-unmark-movie]');if(!btn)return;e.preventDefault();e.stopPropagation();const id=btn.dataset.unmarkMovie;if(!id)return;if(!(await __confirm({icon:'↺',title:'取消观看',message:'确定要取消这部电影的观看记录吗？',okText:'取消观看',tone:'warn'})))return;const prev=btn.textContent;btn.disabled=true;btn.textContent='…';try{const r=await fetch('/api/unmark-watched',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'movie',id})});if(!r.ok)throw new Error('HTTP '+r.status);btn.textContent='已取消';const parts=location.pathname.split('/').filter(Boolean);if(parts[0]==='detail'&&parts.length===3){setTimeout(()=>openDetail(parts[1],parts[2],false),350);}}catch(err){btn.disabled=false;btn.textContent=prev;alert('取消失败：'+err.message);}},true);document.addEventListener('click',async(e)=>{const btn=e.target.closest('[data-mark-season-all]');if(!btn)return;e.preventDefault();e.stopPropagation();const showId=btn.dataset.markSeasonAll,season=btn.dataset.seasonNum;if(!showId||season==null)return;if(!(await __confirm({icon:'✓',title:'标记本季已看',message:'确定要把第 '+season+' 季所有已播出集数标记为已看吗？',okText:'标记',tone:'success'})))return;const prev=btn.textContent;btn.disabled=true;btn.textContent='…';try{const r=await fetch('/api/mark-season-watched',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({showId,season})});if(!r.ok)throw new Error('HTTP '+r.status);btn.textContent='✓ 已标记';btn.classList.add('done');const parts=location.pathname.split('/').filter(Boolean);if(parts[0]==='detail'&&parts.length===3){setTimeout(()=>openDetail(parts[1],parts[2],false),350);}}catch(err){btn.disabled=false;btn.textContent=prev;alert('标记失败：'+err.message);}},true);let __enrichTimer=null;const __enrichPromises=new Map();function __scheduleEnrich(){if(__enrichTimer)return;__enrichTimer=setTimeout(__runEnrich,60);}window.__scheduleEnrich=__scheduleEnrich;async function __runEnrich(){__enrichTimer=null;const els=[...document.querySelectorAll('[data-enrich-key]')];if(!els.length)return;const byKey=new Map();for(const el of els){const k=el.dataset.enrichKey;if(!k)continue;if(!byKey.has(k))byKey.set(k,[]);byKey.get(k).push(el);el.removeAttribute('data-enrich-key');}if(!byKey.size)return;const needFetch=[];for(const[k,group]of byKey.entries()){const existing=__enrichPromises.get(k);if(existing){existing.then(d=>{if(d)group.forEach(el=>__applyEnrich(el,d));});}else{needFetch.push(k);}}if(!needFetch.length)return;const items=needFetch.map(k=>({key:k}));const batchPromise=fetch('/api/enrich',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items})}).then(r=>(r.ok?r.json():{})).catch(()=>({}));for(const k of needFetch){const perKey=batchPromise.then(data=>(data&&data[k])||null);__enrichPromises.set(k,perKey);perKey.then(d=>{if(d)byKey.get(k).forEach(el=>__applyEnrich(el,d));});}if(__enrichPromises.size>400){const arr=[...__enrichPromises.keys()];for(let i=0;i<200;i++)__enrichPromises.delete(arr[i]);}}function __applyEnrich(el,d){const posterBox=el.querySelector('.poster');if(posterBox&&d.poster){const cur=posterBox.querySelector('img, .poster-ph');if(cur&&cur.tagName==='IMG'){if(cur.src!==d.poster)cur.src=d.poster;}else if(cur){const img=document.createElement('img');img.src=d.poster;img.loading='lazy';img.alt='';cur.replaceWith(img);}}if(d.title){const nameEl=el.querySelector('.name');if(nameEl)nameEl.textContent=d.title;}if(d.overview){const info=el.querySelector('.info');if(info){let ov=info.querySelector('.overview');if(!ov){ov=document.createElement('div');ov.className='overview';const meta=info.querySelector('.meta');if(meta&&meta.nextSibling)info.insertBefore(ov,meta.nextSibling);else info.appendChild(ov);}ov.textContent=d.overview;}}}window.addEventListener('load',()=>{setTimeout(__runEnrich,200);});`;
}

function renderSplash() { return `<div id="splash" class="splash" style="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;overflow:hidden;background:radial-gradient(circle at 50% 45%,#0a0a0a 0%,#000000 62%)"><div class="splash-glow"></div><div class="splash-inner"><div class="splash-logo"><img src="${SPLASH_LOGO}" alt="MineTrakt" width="96" height="96" style="display:block;filter:drop-shadow(0 0 22px rgba(125,157,212,.55))"></div><div class="splash-name">MineTrakt</div><div class="splash-bar"><div class="splash-bar-fill"></div></div></div></div>`; }

function renderStatsHtml(s) {
  const movieCount = s ? s.movie : 0, showCount = s ? s.show : 0, episodeCount = s ? s.episode : 0, totalHours = s ? s.hours : 0;
  const items = [
    { n: movieCount, label: '电影', cls: 'stat-movie', icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="18" rx="2.5"/><path d="M7 3v18M17 3v18M2 9h5M2 15h5M17 9h5M17 15h5"/></svg>' },
    { n: showCount, label: '剧集', cls: 'stat-show', icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2.5"/><path d="M7 3l2 4M12 3l2 4M17 3l2 4"/></svg>' },
    { n: episodeCount, label: '集数', cls: 'stat-episode', icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2.5"/><path d="M10 9l5 3-5 3V9z" fill="currentColor" stroke="none"/></svg>' },
    { n: totalHours, label: '小时', cls: 'stat-hours', icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>' },
  ];
  return items.map(it => `<div class="stat ${it.cls}"><div class="stat-icon">${it.icon}</div><div class="stat-num">${s ? it.n : '–'}</div><div class="stat-label">${it.label}</div></div>`).join('');
}

// ═══ 分页 ═══
async function handleMore(request, env, ctx) {
  const url = new URL(request.url), type = url.searchParams.get('type'), page = parseInt(url.searchParams.get('page') || '2');
  const a = await requireAuth(request, env); if (!a.ok) return unauthorizedHtml();
  const { auth, headers, needsCookieUpdate } = a;
  const userKey = await getStableUserId(auth, headers);
  if (type === 'history') { let r; try { for (let i = 0; i < 3; i++) { r = await fetchT(`${TRAKT_API}/users/me/history?limit=${PAGE_SIZE}&page=${page}&extended=full&images=poster`, { headers }, 9000); if (r.status !== 429) break; await new Promise(resolve => setTimeout(resolve, Math.min(1000 * Math.pow(2, i), 5000))); } } catch (e) { return new Response('', { status: 502 }); } if (!r.ok) return new Response('', { status: r.status }); const items = await r.json(), pageCount = parseInt(r.headers.get('X-Pagination-Page-Count') || '1'), hasMore = page < pageCount, bodyHtml = renderHistoryPage(items, env, true); const outHeaders = { 'Content-Type': 'text/html; charset=utf-8', 'X-Has-More': String(hasMore), 'X-Page': String(page), 'X-Page-Count': String(pageCount) }; if (needsCookieUpdate) outHeaders['Set-Cookie'] = buildCookie(auth); return new Response(bodyHtml, { headers: outHeaders }); }
  if (type === 'watchlist') { const sort = url.searchParams.get('sort') || 'added', pageNum = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1), merged = await getWatchlist(headers, sort, env, ctx, userKey), start = (pageNum - 1) * WATCHLIST_PAGE_SIZE, slice = merged.slice(start, start + WATCHLIST_PAGE_SIZE), hasMore = start + WATCHLIST_PAGE_SIZE < merged.length, bodyHtml = renderWatchlistItems(slice, env); const outHeaders = { 'Content-Type': 'text/html; charset=utf-8', 'X-Has-More': String(hasMore), 'X-Page': String(pageNum), 'X-Total': String(merged.length) }; if (needsCookieUpdate) outHeaders['Set-Cookie'] = buildCookie(auth); return new Response(bodyHtml, { headers: outHeaders }); }
  return new Response('', { status: 400 });
}

// ═══ 详情 ═══
async function handleApiDetail(request, env, ctx) {
  const url = new URL(request.url), type = url.searchParams.get('type'), rawId = url.searchParams.get('id');
  if (!type || !rawId || (type !== 'movie' && type !== 'show')) return new Response('bad params', { status: 400 });
  const a = await requireAuth(request, env); if (!a.ok) return unauthorizedHtml();
  const { auth, headers, needsCookieUpdate } = a;
  const errResponse = (msg, status) => { const h = { 'Content-Type': 'text/html; charset=utf-8' }; if (needsCookieUpdate) h['Set-Cookie'] = buildCookie(auth); return new Response(emptyView({ text: msg, error: true }), { status, headers: h }); };
  let traktId = rawId;
  if (rawId.startsWith('tmdb-')) {
    const tmdbId = rawId.slice(5), arr = await traktGet(`${TRAKT_API}/search/tmdb/${tmdbId}?type=${type}`, headers);
    if (!Array.isArray(arr) || !arr.length) return errResponse('找不到对应条目', 404);
    const key = type === 'movie' ? 'movie' : 'show';
    traktId = arr[0][key] && arr[0][key].ids && arr[0][key].ids.trakt;
    if (!traktId) return errResponse('找不到对应条目', 404);
  }
  const [entity, userProgress, movieHistory] = await Promise.all([
    traktGet(`${TRAKT_API}/${type}s/${traktId}?extended=full,images`, headers),
    type === 'show' ? traktGet(`${TRAKT_API}/shows/${traktId}/progress/watched?hidden=false&specials=false`, headers) : Promise.resolve(null),
    type === 'movie' ? traktGet(`${TRAKT_API}/sync/history/movies/${traktId}?limit=1`, headers) : Promise.resolve(null)
  ]);
  if (!entity || entity.__error) return errResponse('无法加载详情：' + (entity && entity.__error ? entity.__error : '未知'), 502);
  let movieWatched = null;
  if (Array.isArray(movieHistory) && movieHistory.length) { const h = movieHistory[0]; movieWatched = { last_watched_at: h.watched_at, plays: null }; }
  let guessedSeason = null;
  if (type === 'show' && userProgress && !userProgress.__error) {
    if (userProgress.next_episode && userProgress.next_episode.season) guessedSeason = userProgress.next_episode.season;
    else if (Array.isArray(userProgress.seasons)) { const w = userProgress.seasons.filter(s => s.completed > 0); if (w.length) guessedSeason = w[w.length - 1].number; }
  }
  const tmdbId = entity.ids && entity.ids.tmdb, t = type === 'movie' ? 'movie' : 'tv';
  const [tmdbData, guessedSeasonData] = await Promise.all([
    (tmdbId && env.TMDB_API_KEY) ? tmdbDetailCached(`/${t}/${tmdbId}?append_to_response=credits,recommendations,external_ids`, env, ctx) : Promise.resolve(null),
    (guessedSeason != null && tmdbId && env.TMDB_API_KEY) ? tmdbDetailCached(`/tv/${tmdbId}/season/${guessedSeason}`, env, ctx) : Promise.resolve(null)
  ]);
  let credits = null, recommendations = null;
  if (tmdbData) { credits = tmdbData.credits; recommendations = tmdbData.recommendations; }
  const imdbId = (tmdbData && tmdbData.imdb_id) || (tmdbData && tmdbData.external_ids && tmdbData.external_ids.imdb_id) || (entity.ids && entity.ids.imdb) || null, thirdParty = imdbId ? await fetchOmdbRatings(imdbId, env, ctx) : null;
  let initialSeasonNum = guessedSeason;
  if (initialSeasonNum == null && tmdbData && tmdbData.seasons && tmdbData.seasons.length) {
    const real = tmdbData.seasons.filter(s => s.season_number > 0);
    if (real.length) initialSeasonNum = real[0].season_number;
  }
  let initialSeasonData = guessedSeasonData, initialTraktEpisodes = [];
  const needSecondSeasonData = initialSeasonNum != null && guessedSeason !== initialSeasonNum && tmdbId && env.TMDB_API_KEY;
  const needTraktEpisodes = type === 'show' && initialSeasonNum != null;
  if (needSecondSeasonData || needTraktEpisodes) {
    const [secondSeasonData, traktSeasonData] = await Promise.all([
      needSecondSeasonData ? tmdbDetailCached(`/tv/${tmdbId}/season/${initialSeasonNum}`, env, ctx) : Promise.resolve(null),
      needTraktEpisodes ? traktGet(`${TRAKT_API}/shows/${traktId}/seasons/${initialSeasonNum}?extended=full,episodes`, headers) : Promise.resolve(null)
    ]);
    if (secondSeasonData) initialSeasonData = secondSeasonData;
    if (traktSeasonData && !traktSeasonData.__error && Array.isArray(traktSeasonData.episodes)) initialTraktEpisodes = traktSeasonData.episodes;
  }
  const bodyHtml = await renderDetailFragment({ type, entity, traktId, userProgress, movieWatched, tmdb: tmdbData, credits, recommendations, initialSeasonNum, initialSeasonData, initialTraktEpisodes, thirdParty });
  const outHeaders = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, max-age=120, stale-while-revalidate=300' };
  if (needsCookieUpdate) outHeaders['Set-Cookie'] = buildCookie(auth);
  return new Response(bodyHtml, { headers: outHeaders });
}
async function handleSeason(request, env, ctx) {
  const url = new URL(request.url),
    showId = url.searchParams.get('show'),
    seasonNum = parseInt(url.searchParams.get('season') || '0'),
    tmdbId = url.searchParams.get('tmdb'),
    slug = url.searchParams.get('slug') || '';
  if (!showId || isNaN(seasonNum)) return new Response('bad params', { status: 400 });
  const a = await requireAuth(request, env); if (!a.ok) return unauthorizedHtml();
  const { auth, headers, needsCookieUpdate } = a;
  const [progress, traktSeason, tmdbSeason] = await Promise.all([
    traktGet(`${TRAKT_API}/shows/${showId}/progress/watched?hidden=false&specials=false`, headers),
    traktGet(`${TRAKT_API}/shows/${showId}/seasons/${seasonNum}?extended=full,episodes`, headers),
    (tmdbId && env.TMDB_API_KEY) ? tmdbDetailCached(`/tv/${tmdbId}/season/${seasonNum}`, env, ctx) : Promise.resolve(null)
  ]);
  const seasonProgress = Array.isArray(progress && progress.seasons) ? progress.seasons.find(s => s.number === seasonNum) : null;
  const traktEpisodes = (traktSeason && !traktSeason.__error && Array.isArray(traktSeason.episodes)) ? traktSeason.episodes : [];
  const bodyHtml = renderSeasonEpisodes(seasonProgress, tmdbSeason, seasonNum, slug, traktEpisodes);
  const outHeaders = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
  if (needsCookieUpdate) outHeaders['Set-Cookie'] = buildCookie(auth);
  return new Response(bodyHtml, { headers: outHeaders });
}

// ═══ 登录页 ═══
function renderLoginPage() { return pageShell(`<div class="login-wrap"><div class="login-card"><div class="login-logo"><img src="${ICON_192}" alt="MineTrakt" width="64" height="64" style="display:block;margin:0 auto"></div><h1 class="login-title">MineTrakt</h1><p class="login-sub">继续观看 · 待看列表 · 追剧日历 · 观看记录</p><div id="login-area" class="login-area"><button class="btn-primary" onclick="startLogin()">使用 Trakt 登录</button></div></div></div><script>async function startLogin(){const area=document.getElementById('login-area');area.innerHTML='<div class="spinner"></div>';let r;try{r=await fetch('/auth/device');}catch(e){area.innerHTML='<p class="err">网络错误: '+e+'</p>';return;}if(!r.ok){const err=await r.json().catch(()=>({}));area.innerHTML='<div class="err-box"><p class="err-title">获取设备码失败</p><p class="err">'+(err.error||('HTTP '+r.status))+'</p>'+(err.detail?'<pre class="err-detail">'+err.detail+'</pre>':'')+(err.hint?'<p class="hint">'+err.hint+'</p>':'')+'</div><button class="btn-primary" onclick="location.reload()">重试</button>';return;}const d=await r.json(),activateUrl='https://trakt.tv/activate',qr='https://api.qrserver.com/v1/create-qr-code/?size=220x220&color=4a6db8&bgcolor=ffffff&data='+encodeURIComponent(activateUrl);area.innerHTML='<div class="device-flow"><div class="steps"><div class="step"><span class="n">1</span><span>打开 <a href="'+activateUrl+'" target="_blank" rel="noopener">trakt.tv/activate</a></span></div><div class="step"><span class="n">2</span><span>输入代码</span></div></div><div class="code-box">'+d.user_code+'</div><div class="step"><span class="n">3</span><span>点击授权</span></div><div class="qr-box"><img src="'+qr+'" alt="QR"></div><p id="status" class="status"><span class="pulse"></span>等待授权中…</p></div><details class="log-details"><summary>调试日志</summary><div id="log" class="log-box"></div></details>';let interval=(d.interval||5)*1000,attempt=0;const logEl=document.getElementById('log'),log=(s)=>{if(logEl)logEl.innerHTML+='<div>['+new Date().toLocaleTimeString()+'] '+s+'</div>';};const tick=async()=>{attempt++;let r2;try{r2=await fetch('/auth/poll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:d.state})});}catch(e){log('网络错误');setTimeout(tick,interval);return;}if(r2.status===200){document.getElementById('status').innerHTML='✓ 授权成功，正在刷新…';document.getElementById('status').className='status success';setTimeout(()=>location.reload(),400);return;}let text='';try{text=await r2.text();}catch{}let data={};try{data=JSON.parse(text);}catch{}log('HTTP '+r2.status+' · '+(data.status||'未知'));const st=document.getElementById('status');if(r2.status===202){if(data.status==='slow_down')interval+=2000;st.innerHTML='<span class="pulse"></span>等待授权中（第 '+attempt+' 次）';setTimeout(tick,interval);return;}st.textContent='HTTP '+r2.status+' · '+(data.status||data.detail||'未知');st.className='status error';if(r2.status===403||r2.status===410)return;setTimeout(tick,interval);};setTimeout(tick,1000);}<\/script>`); }

// ═══ 渲染辅助 ═══
function posterOfTrakt(obj) { if (!obj || !obj.images) return null; const p = obj.images.poster; if (!p || !Array.isArray(p) || !p.length) return null; if (typeof p[0] === 'string') return p[0]; if (typeof p[0] === 'object') return p[0].medium || p[0].thumb || p[0].full || null; return null; }
function mediaItem(opts) {
  const style = opts.delay != null ? ` style="animation-delay:${opts.delay}ms"` : '', removeHtml = (opts.removeType && opts.removeId) ? `<button class="wl-remove" type="button" data-wl-remove-type="${esc(opts.removeType)}" data-wl-remove-id="${esc(opts.removeId)}" aria-label="从待看列表移除" title="从待看列表移除">×</button>` : '', watchedHtml = (opts.watchedType && opts.watchedId) ? `<button class="wl-watched" type="button" data-watched-type="${esc(opts.watchedType)}" data-watched-id="${esc(opts.watchedId)}" aria-label="标记为已看" title="标记为已看">✓</button>` : '', unwatchHtml = (opts.unwatchType && opts.unwatchId) ? `<button class="wl-unwatch" type="button" data-unwatch-type="${esc(opts.unwatchType)}" data-unwatch-id="${esc(opts.unwatchId)}" aria-label="取消观看" title="取消观看">↺</button>` : '', bar = opts.pct != null ? `<div class="bar"><div class="bar-fill" style="width:${opts.pct}%"></div></div>` : '', dataAttrs = (opts.detailType && opts.detailId) ? ` data-detail-type="${esc(opts.detailType)}" data-detail-id="${esc(opts.detailId)}" role="button" tabindex="0"` : '', enrichAttrs = opts.enrichKey ? ` data-enrich-key="${esc(opts.enrichKey)}"` : '', clickable = (opts.detailType && opts.detailId) ? ' clickable' : '', tagHtml = opts.tag && opts.tagClass === 'upcoming' ? `<span class="tag ${esc(opts.tagClass)}">（${esc(opts.tag)}）</span>` : '', calendarBtnHtml = opts.calendarShowId ? `<button class="cal-open-btn" type="button" data-cal-show-id="${esc(opts.calendarShowId)}" data-cal-show-name="${esc(opts.calendarShowName || opts.title)}"${opts.calendarTmdbId ? ` data-cal-show-tmdb="${esc(String(opts.calendarTmdbId))}"` : ''} title="查看这部剧的播出日历"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>播出日历</button>` : '';
  return `<div class="item${clickable}"${dataAttrs}${enrichAttrs}${style}>${removeHtml}${watchedHtml}${unwatchHtml}<div class="poster">${opts.poster ? `<img src="${opts.poster}" loading="lazy" alt="">` : `<div class="poster-ph"><span>${opts.tagClass === 'movie' ? '🎬' : '📺'}</span></div>`}</div><div class="info"><div class="name-row"><span class="name">${esc(opts.title)}</span>${tagHtml}</div>${opts.line1 ? `<div class="meta">${esc(opts.line1)}</div>` : ''}${opts.overview ? `<div class="overview">${esc(opts.overview)}</div>` : ''}${opts.line2 ? `<div class="meta dim">${esc(opts.line2)}</div>` : ''}${bar}${calendarBtnHtml}</div></div>`;
}
function renderHistoryPage(items, env, isFragment) {
  if (isFragment === undefined) isFragment = false; if (!Array.isArray(items)) return isFragment ? '' : errBox('观看记录', items); if (!items.length) return isFragment ? '' : emptyView('还没有观看记录');
  return items.map((item, i) => { const when = fmtRelative(item.watched_at), delay = isFragment ? 0 : Math.min(i, 24) * 20, e = buildBaseItem(item); let unwatchType = null, unwatchId = null; if (item.movie && item.movie.ids && item.movie.ids.trakt) { unwatchType = 'movie'; unwatchId = item.movie.ids.trakt; } else if (item.episode && item.episode.ids && item.episode.ids.trakt) { unwatchType = 'episode'; unwatchId = item.episode.ids.trakt; } return mediaItem({ poster: e.poster, tag: e.tag, tagClass: e.tagClass, title: e.title, overview: e.overview, line1: e.line1, line2: when, delay, detailType: e.detailType, detailId: e.detailId, enrichKey: e.enrichKey, unwatchType, unwatchId }); }).join('');
}
function watchlistToolbarHtml(currentSort) { const opts = [['added', '按添加时间'], ['released', '按发行年份'], ['title', '按标题']], options = opts.map(([v, t]) => `<option value="${v}"${v === currentSort ? ' selected' : ''}>${t}</option>`).join(''); return `<div class="wl-toolbar"><label class="wl-sort-label">排序<select id="wl-sort" class="wl-sort" onchange="onWatchlistSortChange(this.value)">${options}</select></label></div>`; }
function emptyWatchlistHtml() { return `<div class="empty"><svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg><p>待看列表是空的</p><p style="font-size:0.82rem;color:#5a6474;margin-top:10px;line-height:1.6;text-align:center">去 Trakt 上把想看的电影 / 剧集加入 watchlist，这里就会显示</p></div>`; }
function renderWatchlistItems(items, env) { if (!Array.isArray(items) || !items.length) return ''; return items.map((item, i) => { const e = buildBaseItem(item); if (!e.title || !e.detailId) return ''; const when = item.listed_at ? '添加于 ' + fmtRelative(item.listed_at) : '', delay = Math.min(i, 24) * 20, removeType = item.movie ? 'movie' : (item.show ? 'show' : null), removeId = e.detailId; return mediaItem({ poster: e.poster, tag: e.tag, tagClass: e.tagClass, title: e.title, overview: e.overview, line1: e.line1, line2: when, delay, detailType: e.detailType, detailId: e.detailId, enrichKey: e.enrichKey, removeType, removeId }); }).filter(Boolean).join(''); }
function renderContinueItems(upNext) {
  const items = [];
  if (Array.isArray(upNext)) {
    for (const entry of upNext) {
      if (entry.episode) { items.push({ source: 'playback', sortKey: entry.paused_at || entry.last_watched_at || '', raw: entry }); }
      else if (entry.show && entry.progress && entry.progress.next_episode) {
        const completed = entry.progress.completed;
        if (typeof completed === 'number' && completed <= 0) continue;
        const next = entry.progress.next_episode;
        items.push({ source: 'upnext', sortKey: entry.last_watched_at || entry.progress.last_watched_at || '', raw: { type: 'episode', show: entry.show, episode: next, progress: null } });
      } else if (entry.movie) { items.push({ source: 'playback', sortKey: entry.last_watched_at || '', raw: entry }); }
    }
  }
  items.sort((a, b) => (b.sortKey || '').localeCompare(a.sortKey || ''));
  if (!items.length) return `<div class="empty"><svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg><p>暂时没有继续观看的内容</p><p style="font-size:0.82rem;color:#5a6474;margin-top:10px;line-height:1.6;text-align:center">去 Trakt 上标记一些已看剧集后，这里会显示下一集</p></div>`;
  const parts = items.map((it, i) => { const delay = Math.min(i, 24) * 20, item = it.raw, pct = typeof item.progress === 'number' ? Math.round(item.progress) : null, ep = item.episode || {}, epTag = ep.season != null && ep.number != null ? `S${pad(ep.season)}E${pad(ep.number)}` : '', subLine = pct != null ? `已看 ${pct}%` : (epTag ? `下一集 ${epTag}` : '下一集'), e = buildBaseItem(item); let watchedType = null, watchedId = null; if (item.movie && item.movie.ids && item.movie.ids.trakt) { watchedType = 'movie'; watchedId = item.movie.ids.trakt; } else if (item.episode && item.episode.ids && item.episode.ids.trakt) { watchedType = 'episode'; watchedId = item.episode.ids.trakt; } return mediaItem({ poster: e.poster, tag: e.tag, tagClass: e.tagClass, title: e.title, overview: e.overview, line1: e.line1, line2: subLine, pct, delay, detailType: e.detailType, detailId: e.detailId, enrichKey: e.enrichKey, watchedType, watchedId }); });
  return `<div class="grid">${parts.join('')}</div>`;
}
function renderCalendarPage(calendar, env, zhTitles) {
  if (!Array.isArray(calendar)) return errBox('追剧日历', calendar); if (!calendar.length) return emptyView('未来 30 天没有待播剧集');
  const toBeijingDay = (iso) => { if (!iso) return ''; const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }, groups = new Map();
  for (const item of calendar) { const day = toBeijingDay(item.first_aired); if (!day) continue; if (!groups.has(day)) groups.set(day, []); groups.get(day).push(item); }
  const today = toBeijingDay(new Date().toISOString()), out = [];
  for (const [day, items] of groups.entries()) { items.sort((a, b) => (a.first_aired || '').localeCompare(b.first_aired || '')); const d = new Date(day + 'T00:00:00Z'), wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getUTCDay()], isToday = day === today, parts = items.map((item) => { let timeStr = ''; if (item.first_aired) { const bj = new Date(new Date(item.first_aired).getTime() + 8 * 3600 * 1000); timeStr = `${String(bj.getUTCHours()).padStart(2, '0')}:${String(bj.getUTCMinutes()).padStart(2, '0')}`; } const e = buildBaseItem(item), showTraktId = (item.show && item.show.ids) ? item.show.ids.trakt : null, zhTitle = (showTraktId != null && zhTitles) ? zhTitles[showTraktId] : null, displayTitle = zhTitle || e.title || '未知节目'; return mediaItem({ poster: e.poster, tagClass: 'upcoming', title: displayTitle, overview: e.overview, line1: e.line1, line2: timeStr, detailType: e.detailType, detailId: e.detailId, enrichKey: e.enrichKey, calendarShowId: e.detailId, calendarShowName: displayTitle, calendarTmdbId: (item.show && item.show.ids && item.show.ids.tmdb) || null }); }); out.push(`<div class="day"><div class="day-head"><span class="day-num">${day.slice(8)}</span><div><div class="day-mon">${day.slice(0, 7)}</div><div class="day-wd">${wd}</div></div>${isToday ? '<span class="today">今天</span>' : ''}</div><div class="grid">${parts.join('')}</div></div>`); }
  return out.join('');
}

// ═══ 详情片段 ═══
async function renderDetailFragment(d) {
  const type = d.type, entity = d.entity, traktId = d.traktId, userProgress = d.userProgress, movieWatched = d.movieWatched, tmdb = d.tmdb, credits = d.credits, recommendations = d.recommendations, initialSeasonNum = d.initialSeasonNum, initialSeasonData = d.initialSeasonData, initialTraktEpisodes = d.initialTraktEpisodes || [], thirdParty = d.thirdParty, isMovie = type === 'movie';
  const title = (tmdb && (tmdb.title || tmdb.name)) || entity.title || '', overview = (tmdb && tmdb.overview) || entity.overview || '', year = (((tmdb && tmdb.release_date) || (tmdb && tmdb.first_air_date) || '') + '').slice(0, 4) || (entity.year ? String(entity.year) : ''), tmdbRating = (tmdb && tmdb.vote_average != null && Number(tmdb.vote_average) > 0) ? Number(tmdb.vote_average) : null, traktRating = entity.rating ? Number(entity.rating) : null, runtimeMin = (tmdb && tmdb.runtime) || (tmdb && tmdb.episode_run_time && tmdb.episode_run_time[0]) || entity.runtime || 0, runtimeStr = runtimeMin ? (runtimeMin >= 60 ? `${Math.floor(runtimeMin / 60)}h ${runtimeMin % 60}m` : `${runtimeMin}m`) : '', genres = (tmdb && tmdb.genres && tmdb.genres.map(g => g.name).join(' · ')) || (entity.genres || []).join(' · '), poster = (tmdb && tmdb.poster_path) ? tmdbPoster(tmdb.poster_path, 'w342') : posterOfTrakt(entity), backdrop = (tmdb && tmdb.backdrop_path) ? tmdbPoster(tmdb.backdrop_path, 'w780') : null, tagline = entity.tagline || '', showSlug = (entity.ids && entity.ids.slug) || '', doubanQuery = ((title || '') + (year ? ' ' + year : '')).trim(), doubanUrl = doubanQuery ? `${DOUBAN_SEARCH}?search_text=${encodeURIComponent(doubanQuery)}` : '';
  let statusHtml = '';
  if (isMovie) {
    if (movieWatched) { const playsPart = movieWatched.plays ? `${movieWatched.plays} 次 · ` : ''; statusHtml = `<div class="d-status done"><div class="d-status-icon">✓</div><div class="d-status-body"><div class="d-status-title">已观看</div><div class="d-status-sub">${esc(playsPart + fmtRelative(movieWatched.last_watched_at))}</div></div><button class="d-mark-btn unwatch" type="button" data-unmark-movie="${esc(String(traktId))}" title="取消观看">取消观看</button></div>`; }
    else { statusHtml = `<div class="d-status"><div class="d-status-icon">○</div><div class="d-status-body"><div class="d-status-title">未观看</div><div class="d-status-sub">还没有在 Trakt 上标记</div></div><button class="d-mark-btn" type="button" data-mark-movie="${esc(String(traktId))}" title="标记已看">✓ 标记已看</button></div>`; }
  }
  else if (userProgress && !userProgress.__error && userProgress.aired > 0) {
    const pct = Math.round((userProgress.completed / userProgress.aired) * 100);
    const allWatched = userProgress.completed >= userProgress.aired;
    let markSeasonBtn = '';
    if (initialSeasonNum != null) {
      if (allWatched) markSeasonBtn = `<button class="d-mark-btn done" type="button" disabled>✓ 已看完</button>`;
      else markSeasonBtn = `<button class="d-mark-btn" type="button" data-mark-season-all="${esc(String(traktId))}" data-season-num="${initialSeasonNum}" title="标记本季已看">✓ 标记本季已看</button>`;
    }
    statusHtml = `<div class="d-status done" style="flex-direction:column;align-items:stretch;gap:10px"><div class="d-status-row"><div class="d-status-icon">▶</div><div class="d-status-body"><div class="d-status-title">已看 ${userProgress.completed} / ${userProgress.aired} 集 · ${pct}%</div><div class="d-status-sub">${userProgress.last_watched_at ? '上次 ' + fmtRelative(userProgress.last_watched_at) : ''}</div></div>${markSeasonBtn}</div><div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div></div>`;
  }
  else {
    let markSeasonBtn = '';
    if (initialSeasonNum != null) markSeasonBtn = `<button class="d-mark-btn" type="button" data-mark-season-all="${esc(String(traktId))}" data-season-num="${initialSeasonNum}" title="标记本季已看">✓ 标记本季已看</button>`;
    statusHtml = `<div class="d-status"><div class="d-status-icon">○</div><div class="d-status-body"><div class="d-status-title">尚未观看</div><div class="d-status-sub">还没有观看记录</div></div>${markSeasonBtn}</div>`;
  }
  let infuseHtml = '';
  if (isMovie && tmdb && tmdb.id) { infuseHtml = `<a class="infuse-btn" href="${esc(`infuse://movie/${tmdb.id}`)}" rel="noopener"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>在 Infuse 中查看</a>`; }
  else if (!isMovie && tmdb && tmdb.id) { let ne = (userProgress && !userProgress.__error) ? userProgress.next_episode : null; if (!ne && userProgress && !userProgress.__error && Array.isArray(userProgress.seasons)) { outer: for (let i = userProgress.seasons.length - 1; i >= 0; i--) { const s = userProgress.seasons[i]; if (!s || s.completed <= 0 || !Array.isArray(s.episodes)) continue; for (let j = s.episodes.length - 1; j >= 0; j--) { const ep = s.episodes[j]; if (ep && ep.completed) { ne = { season: s.number, number: ep.number + 1 }; break outer; } } } } const hasEp = ne && ne.season != null && ne.number != null, infuseUrl = hasEp ? `infuse://series/${tmdb.id}-${ne.season}-${ne.number}` : `infuse://series/${tmdb.id}`, label = hasEp ? `在 Infuse 中查看 S${pad(ne.season)}E${pad(ne.number)}` : '在 Infuse 中查看'; infuseHtml = `<a class="infuse-btn" href="${esc(infuseUrl)}" rel="noopener"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>${esc(label)}</a>`; }
  const cast = (credits && credits.cast ? credits.cast : []).slice(0, 20), castHtml = cast.map(c => { const initial = Array.from(c.name || '?')[0] || '?'; return `<div class="cast">${c.profile_path ? `<img class="cast-img" src="${TMDB_IMG}/w185${c.profile_path}" loading="lazy" alt="">` : `<div class="cast-img cast-ph">${esc(initial)}</div>`}<div class="cast-name">${esc(c.name || '')}</div><div class="cast-role">${esc(c.character || '')}</div></div>`; }).join('');
  const recs = (recommendations && recommendations.results ? recommendations.results : []).slice(0, 12), recsHtml = recs.map((r, i) => mediaItem({ poster: tmdbPoster(r.poster_path), tag: isMovie ? '电影' : '剧集', tagClass: isMovie ? 'movie' : 'episode', title: r.title || r.name || '', line1: (((r.release_date || r.first_air_date || '') + '')).slice(0, 4), delay: i * 20, detailType: isMovie ? 'movie' : 'show', detailId: 'tmdb-' + r.id })).join('');
  let seasonsHtml = '';
  if (!isMovie && tmdb && tmdb.seasons && tmdb.seasons.length) {
    const progressSeasons = new Map();
    if (Array.isArray(userProgress && userProgress.seasons)) userProgress.seasons.forEach(s => progressSeasons.set(s.number, s));
    const seasons = tmdb.seasons.filter(s => s.season_number > 0);
    seasonsHtml = `<div class="seasons">${seasons.map(s => {
      const sp = progressSeasons.get(s.season_number), total = s.episode_count || 0, watched = sp ? (sp.completed || 0) : 0, isOpen = s.season_number === initialSeasonNum, bodyContent = isOpen && initialSeasonData ? renderSeasonEpisodes(sp, initialSeasonData, s.season_number, showSlug, isOpen ? initialTraktEpisodes : []) : '', loadedAttr = (isOpen && bodyContent) ? ' data-loaded="1"' : '';
      return `<div class="season-item${isOpen ? ' open' : ''}"><div class="season-head" data-show="${esc(String(traktId))}" data-season="${s.season_number}" data-tmdb="${esc(String(tmdb.id))}" data-slug="${esc(showSlug)}"><span class="season-title">${esc(s.name || ('第 ' + s.season_number + ' 季'))}</span><span class="season-meta">${watched} / ${total} 集</span><svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></div><div class="season-body"${loadedAttr}>${bodyContent}</div></div>`;
    }).join('')}</div>`;
  }
  return `<div class="detail-wrap"><div class="detail-hero">${backdrop ? `<img class="detail-bg" src="${backdrop}" alt="">` : ''}<div class="detail-inner">${poster ? `<img class="detail-poster" src="${poster}" alt="">` : `<div class="detail-poster detail-poster-ph">${isMovie ? '🎬' : '📺'}</div>`}<div class="detail-info"><h1 class="detail-title">${esc(title)}</h1>${tagline ? `<div class="detail-tagline">${esc(tagline)}</div>` : ''}<div class="detail-meta">${year ? `<span>${esc(year)}</span>` : ''}${runtimeStr ? `<span>${esc(runtimeStr)}</span>` : ''}</div>${(thirdParty || traktRating != null || tmdbRating != null || doubanUrl) ? `<div class="detail-ext-ratings">${renderExtRatings(thirdParty, { trakt: traktRating, tmdb: tmdbRating, doubanUrl })}</div>` : ''}${genres ? `<div class="detail-genres">${esc(genres)}</div>` : ''}${overview ? `<p class="detail-overview">${esc(overview)}</p>` : ''}${statusHtml}${infuseHtml}</div></div></div><div class="detail-body">${castHtml ? `<section class="d-section"><h2 class="d-section-title">演员</h2><div class="cast-scroll">${castHtml}</div></section>` : ''}${seasonsHtml ? `<section class="d-section"><h2 class="d-section-title">季与集</h2>${seasonsHtml}</section>` : ''}${recsHtml ? `<section class="d-section"><h2 class="d-section-title">相关推荐</h2><div class="grid">${recsHtml}</div></section>` : ''}</div></div>`;
}
function renderSeasonEpisodes(seasonProgress, tmdbSeason, seasonNum, showSlug, traktEpisodes) {
  if (!tmdbSeason || !Array.isArray(tmdbSeason.episodes) || !tmdbSeason.episodes.length) return '<div class="ep-empty">暂无剧集信息</div>';
  const watched = new Map();
  if (Array.isArray(seasonProgress && seasonProgress.episodes)) seasonProgress.episodes.forEach(e => watched.set(e.number, e));
  const traktMap = new Map();
  if (Array.isArray(traktEpisodes)) traktEpisodes.forEach(e => { if (e && e.number != null) traktMap.set(e.number, e); });
  return tmdbSeason.episodes.map(ep => {
    const num = ep.episode_number, w = watched.get(num), isWatched = !!(w && w.completed), traktEp = traktMap.get(num);
    const epId = (traktEp && traktEp.ids && traktEp.ids.trakt) || (w && w.ids && w.ids.trakt) || null;
    const traktUrl = showSlug ? `https://trakt.tv/shows/${showSlug}/seasons/${seasonNum}/episodes/${num}` : '';
    const clickable = traktUrl ? ' clickable' : '';
    const attrs = traktUrl ? ` data-trakt-url="${esc(traktUrl)}" role="link" tabindex="0" title="在 Trakt 中打开"` : '';
    const actionHtml = isWatched ? '<div class="ep-check">✓</div>' : (epId ? `<button class="ep-watch-btn" type="button" data-episode-id="${esc(String(epId))}" data-episode-title="${esc(ep.name || '')}" title="标记本集已看">标记已看</button>` : '');
    return `<div class="episode${isWatched ? ' watched' : ''}${clickable}"${attrs}><div class="ep-num">E${pad(num)}</div><div class="ep-body"><div class="ep-title">${esc(ep.name || '')}</div>${ep.overview ? `<div class="ep-overview">${esc(ep.overview)}</div>` : ''}</div><div class="ep-actions">${actionHtml}</div></div>`;
  }).join('');
}

// ═══ 通用工具 ═══
function emptyView(opts) {
  if (typeof opts === 'string') opts = { text: opts };
  const text = opts.text || '';
  if (opts.error) return `<div class="empty" style="color:#9db5e0;padding:80px 20px"><p style="margin:0;font-size:1rem">${esc(text)}</p></div>`;
  return `<div class="empty"><svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg><p>${text}</p></div>`;
}
function errBox(name, obj) { return `<div class="err-box"><p class="err-title">无法加载${name}</p><p class="err">${esc((obj && obj.__error) || '未知错误')}</p></div>`; }
function randomString(len) { const cs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~', v = new Uint8Array(len); crypto.getRandomValues(v); let s = ''; for (let i = 0; i < len; i++) s += cs[v[i] % cs.length]; return s; }
async function pkceChallenge(verifier) { const data = new TextEncoder().encode(verifier), digest = await crypto.subtle.digest('SHA-256', data); return b64urlEncode(String.fromCharCode(...new Uint8Array(digest)), true); }
function b64urlEncode(str, isBinary) { let bytes; if (isBinary) { bytes = new Uint8Array(str.length); for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff; } else { bytes = new TextEncoder().encode(str); } let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64urlDecode(str) { let b64 = str.replace(/-/g, '+').replace(/_/g, '/'); const pad = b64.length % 4; if (pad) b64 += '='.repeat(4 - pad); const bin = atob(b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function jsStr(s) { return JSON.stringify(String(s == null ? '' : s)).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }
function pad(n) { return String(n == null ? 0 : n).padStart(2, '0'); }
function fmtRelative(iso) { if (!iso) return ''; const d = new Date(iso), t = d.getTime(); if (isNaN(t)) return ''; const diff = Date.now() - t, min = Math.floor(diff / 60000); if (min < 1) return '刚刚'; if (min < 60) return min + ' 分钟前'; const h = Math.floor(min / 60); if (h < 24) return h + ' 小时前'; const day = Math.floor(h / 24); if (day < 7) return day + ' 天前'; return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }); }
function html(body) { return new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' } }); }

// ═══ 页面 ═══
function pageHeadEarly() {
  return `<!DOCTYPE html><html lang="zh-CN" style="background:#000000"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1,user-scalable=no"><meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate"><meta http-equiv="Pragma" content="no-cache"><meta name="color-scheme" content="dark"><meta name="theme-color" content="${THEME_COLOR}"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="${APP_SHORT_NAME}"><meta name="mobile-web-app-capable" content="yes"><meta name="format-detection" content="telephone=no"><title>${APP_NAME}</title><link rel="icon" href="${FAVICON_URL}" type="image/png"><link rel="apple-touch-icon" href="${APPLE_ICON}"><link rel="manifest" href="/manifest.webmanifest"><link rel="preconnect" href="https://api.trakt.tv" crossorigin><link rel="preconnect" href="https://api.themoviedb.org" crossorigin><link rel="preconnect" href="https://image.tmdb.org" crossorigin><link rel="stylesheet" href="/app.css?v=${APP_CSS_VERSION}"></head><body style="background:#000000;margin:0;min-height:100vh;min-height:100dvh">${renderSplash()}`;
}
function pageHead() { return pageHeadEarly(); }
function pageTail() { return `<script>(function(){if(window.__hideSplash)window.__hideSplash(true);var s=document.getElementById('splash');if(s){s.classList.add('hide');setTimeout(function(){if(s&&s.parentNode)s.parentNode.removeChild(s);},380);}})();<\/script><script>(function(){if(!('serviceWorker' in navigator))return;if(window.__swRegistered)return;window.__swRegistered=true;var regSW=function(){navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).catch(function(){});};if(document.readyState==='complete'){setTimeout(regSW,1500);}else{window.addEventListener('load',function(){setTimeout(regSW,1500);});}})();<\/script></body></html>`; }
function pageShell(body) { return pageHead() + body + pageTail(); }

// ═══ CSS ═══
function pageStyles() {
  return `html,body{background:#000000!important;color:#eef1f7;margin:0;padding:0;min-height:100%;min-height:100dvh}*{box-sizing:border-box;margin:0;padding:0}
.splash{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000;background:radial-gradient(circle at 50% 45%,#0a0a0a 0%,#000000 62%);transition:opacity .38s ease;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-tap-highlight-color:transparent}
.splash.hide{opacity:0;pointer-events:none}
.splash-glow{position:absolute;width:340px;height:340px;border-radius:50%;background:radial-gradient(circle,rgba(125,157,212,.25) 0%,rgba(125,157,212,0) 70%);animation:splashPulse 2.4s ease-in-out infinite}
.splash-inner{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:20px}
.splash-logo{color:#a8b2c4;animation:splashPop .75s cubic-bezier(.22,1.1,.36,1) both}
.splash-logo img{display:block}
.splash-name{font-size:1.35rem;font-weight:800;letter-spacing:.4px;background:linear-gradient(135deg,#fff 20%,#7d9dd4);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation:splashFadeUp .6s ease .28s both}
.splash-bar{width:128px;height:3px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden;animation:splashFadeUp .6s ease .45s both}
.splash-bar-fill{height:100%;width:42%;border-radius:99px;background:#fff;animation:splashSlide 1.15s cubic-bezier(.65,0,.35,1) infinite}
@keyframes splashPulse{0%,100%{transform:scale(.85);opacity:.7}50%{transform:scale(1.12);opacity:1}}
@keyframes splashPop{0%{opacity:0;transform:scale(.55) rotate(-8deg)}60%{opacity:1;transform:scale(1.08) rotate(2deg)}100%{opacity:1;transform:scale(1) rotate(0)}}
@keyframes splashFadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes splashSlide{0%{transform:translateX(-130%)}100%{transform:translateX(330%)}}
.spinner{width:30px;height:30px;border:3px solid #212735;border-top-color:#7d9dd4;border-radius:50%;animation:spin .8s linear infinite;margin:4px auto}
@keyframes spin{to{transform:rotate(360deg)}}
:root{--bg:#050505;--surface:#0e0e10;--surface-2:#16161a;--surface-3:#1c1c22;--border:rgba(255,255,255,0.08);--border-strong:rgba(255,255,255,0.14);--text:#f4f4f5;--text-dim:#a1a1aa;--text-mute:#71717a;--accent:#a78bfa;--accent-2:#c4b5fd;--accent-soft:rgba(167,139,250,0.12);--accent-glow:rgba(167,139,250,0.28);--success:#34d399;--blue:#c4b5fd;--radius-sm:10px;--radius-md:14px;--radius-lg:18px;--radius-xl:22px;--shadow-card:0 8px 32px rgba(0,0,0,0.55)}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;background:radial-gradient(ellipse 120% 70% at 50% -20%,#1a1528 0%,transparent 50%),radial-gradient(ellipse 50% 40% at 100% 0%,rgba(167,139,250,0.08) 0%,transparent 45%),radial-gradient(ellipse 40% 30% at 0% 100%,rgba(52,211,153,0.04) 0%,transparent 40%),#050505;background-attachment:fixed;color:var(--text);-webkit-font-smoothing:antialiased;line-height:1.5;overflow-x:hidden;overscroll-behavior-y:none}
a{color:var(--accent-2);text-decoration:none;transition:color .15s}a:hover{color:#ddd6fe}img{display:block;max-width:100%}
.container{max-width:1200px;margin:0 auto;padding:0 16px calc(80px + env(safe-area-inset-bottom))}
.pane-loading{padding:60px 20px;text-align:center}
.load-more-wrap{text-align:center;margin-top:24px}.load-more{background:var(--surface-2);border:1px solid var(--border);color:var(--text);padding:11px 32px;border-radius:var(--radius-md);font-size:.9rem;font-weight:600;cursor:pointer;transition:all .2s;font-family:inherit}.load-more:hover:not(:disabled){border-color:rgba(91,124,250,.45);color:var(--accent-2);box-shadow:0 4px 20px var(--accent-glow);background:var(--surface-3)}.load-more:disabled{cursor:not-allowed}
.login-wrap{min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:20px}.login-card{width:100%;max-width:440px;background:linear-gradient(165deg,#16161a 0%,#0e0e10 100%);border:1px solid var(--border-strong);border-radius:24px;padding:44px 32px;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.05)}.login-logo{color:#a8b2c4;margin-bottom:16px}.login-title{font-size:1.75rem;font-weight:800;letter-spacing:-.5px;background:linear-gradient(135deg,#fff 20%,#7d9dd4);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:6px}.login-sub{color:var(--text-dim);font-size:.9rem;margin-bottom:28px}
.btn-primary{background:linear-gradient(135deg,#7c3aed 0%,#a78bfa 100%);color:#fff;border:none;padding:13px 30px;border-radius:12px;font-size:.95rem;font-weight:700;cursor:pointer;box-shadow:0 6px 24px rgba(167,139,250,.35)}.btn-primary:hover{filter:brightness(1.08);transform:translateY(-1px)}
.btn-ghost{background:rgba(255,255,255,.04);color:var(--text-dim);border:1px solid var(--border);padding:8px 16px;border-radius:10px;font-size:.85rem;cursor:pointer;transition:all .15s;font-family:inherit}.btn-ghost:hover{color:#fff;border-color:var(--border-strong);background:rgba(255,255,255,.08)}
.steps{display:flex;flex-direction:column;gap:6px}.step{display:flex;align-items:center;gap:10px;text-align:left;padding:4px 0;font-size:.9rem}.step .n{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;background:var(--accent);color:#fff;border-radius:50%;font-size:.72rem;font-weight:700;flex-shrink:0}
.code-box{font-family:ui-monospace,Menlo,monospace;font-size:1.75rem;font-weight:800;letter-spacing:6px;color:#a8c0e8;background:rgba(90,120,180,.12);border:1px solid rgba(140,170,220,.35);border-radius:14px;padding:14px;margin:14px 0;user-select:all;text-align:center}
.qr-box{background:#fff;border-radius:14px;padding:10px;display:inline-block;margin:6px 0 14px}.qr-box img{border-radius:8px}
.status{display:inline-flex;align-items:center;gap:8px;font-size:.88rem;padding:8px 16px;border-radius:20px;color:var(--text-dim);background:var(--surface-2)}.status.success{color:#4ade80;background:rgba(74,222,128,.1)}.status.error{color:#e05560;background:rgba(224,85,96,.12)}
.pulse{display:inline-block;width:8px;height:8px;background:#7d9dd4;border-radius:50%;animation:pulse 1.4s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:.35;transform:scale(.85)}50%{opacity:1;transform:scale(1.15)}}
.err-box{background:rgba(224,85,96,.10);border:1px solid rgba(224,85,96,.28);border-radius:12px;padding:14px;text-align:left;margin-bottom:14px}.err-title{font-weight:600;color:#e05560;margin-bottom:4px;font-size:.92rem}.err{color:#e8a3ab;font-size:.85rem}.err-detail{font-family:ui-monospace,Menlo,monospace;font-size:.72rem;color:var(--text-dim);background:#000;padding:8px 10px;border-radius:6px;margin-top:8px;white-space:pre-wrap;word-break:break-all;max-height:120px;overflow:auto}.hint{color:var(--text-dim);font-size:.82rem;margin-top:6px}
.log-details{margin-top:18px;text-align:left}.log-details summary{cursor:pointer;font-size:.76rem;color:var(--text-dim);padding:4px 0;user-select:none}.log-box{font-family:ui-monospace,Menlo,monospace;font-size:.7rem;color:var(--text-dim);background:#000;border:1px solid var(--border);border-radius:8px;padding:10px;max-height:160px;overflow:auto;margin-top:6px;line-height:1.6}
.hero{display:flex;justify-content:space-between;align-items:center;padding:calc(20px + env(safe-area-inset-top)) 0 20px;gap:16px}.hero-left{display:flex;align-items:center;gap:12px;min-width:0}
.hero-avatar{width:50px;height:50px;border-radius:50%;overflow:hidden;flex-shrink:0;background:var(--surface-2);border:2px solid rgba(167,139,250,.5);box-shadow:0 0 0 3px rgba(167,139,250,.12),0 4px 20px rgba(0,0,0,.5)}.hero-avatar img{width:100%;height:100%;object-fit:cover;display:block}
.hero-avatar-ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.25rem;background:linear-gradient(135deg,#1a2233,#2a3a55)}
.hero-text{min-width:0;flex:1;display:flex;flex-direction:column;align-items:flex-start;gap:1px}
.hero-name{font-size:1.45rem;font-weight:800;letter-spacing:-.4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:linear-gradient(135deg,#fff 20%,#c4b5fd 90%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.updated-at{font-size:.72rem;color:var(--text-mute);font-weight:400;letter-spacing:.2px;transition:color .4s ease}.updated-at:empty{display:none}.updated-at.flash{animation:updatedFlash 1.1s ease-out}
@keyframes updatedFlash{0%{color:var(--accent-2)}100%{color:var(--text-mute)}}
.hero-actions{display:flex;gap:8px;flex-shrink:0}
.btn-action{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.04);color:var(--text-dim);border:1px solid var(--border);padding:8px 14px;border-radius:10px;font-size:.82rem;font-weight:600;cursor:pointer;font-family:inherit;transition:all .18s ease;-webkit-tap-highlight-color:transparent}
.btn-action svg{flex-shrink:0;transition:transform .25s ease}.btn-action:hover{color:#fff;border-color:var(--border-strong);background:rgba(167,139,250,.10);box-shadow:0 4px 16px rgba(167,139,250,.18)}.btn-action:hover svg{transform:rotate(180deg)}.btn-action:active{transform:scale(.97)}.btn-action:last-child:hover{background:rgba(224,85,96,.10);border-color:rgba(224,85,96,.35);box-shadow:0 4px 16px rgba(224,85,96,.15)}.btn-action:last-child:hover svg{transform:translateX(2px)}
@media (max-width:420px){.btn-action span{display:none}.btn-action{padding:9px}.hero-actions{gap:6px}}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;background:linear-gradient(165deg,#16161a 0%,#0e0e10 100%);border:1px solid var(--border);border-radius:var(--radius-lg);padding:18px 10px;margin-bottom:24px;box-shadow:var(--shadow-card),inset 0 1px 0 rgba(255,255,255,.04);position:relative;overflow:hidden}
.stats::before{content:'';position:absolute;top:0;left:10%;right:10%;height:1px;background:linear-gradient(90deg,transparent,rgba(167,139,250,.35),transparent)}
.stat{position:relative;text-align:center;display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 2px;border-radius:12px;transition:background .2s ease}.stat:hover{background:rgba(255,255,255,.025)}
.stat+.stat::before{content:'';position:absolute;left:-4px;top:18%;bottom:18%;width:1px;background:linear-gradient(180deg,transparent,rgba(255,255,255,.08),transparent)}
.stat-icon{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;margin-bottom:4px;transition:transform .25s ease,box-shadow .25s ease}.stat:hover .stat-icon{transform:translateY(-1px) scale(1.06)}
.stat-movie .stat-icon{background:linear-gradient(135deg,rgba(167,139,250,.18),rgba(167,139,250,.06));color:#c4b5fd;box-shadow:0 4px 14px rgba(167,139,250,.18),inset 0 0 0 1px rgba(167,139,250,.18)}
.stat-show .stat-icon{background:linear-gradient(135deg,rgba(96,165,250,.18),rgba(96,165,250,.06));color:#93c5fd;box-shadow:0 4px 14px rgba(96,165,250,.18),inset 0 0 0 1px rgba(96,165,250,.18)}
.stat-episode .stat-icon{background:linear-gradient(135deg,rgba(52,211,153,.18),rgba(52,211,153,.06));color:#6ee7b7;box-shadow:0 4px 14px rgba(52,211,153,.18),inset 0 0 0 1px rgba(52,211,153,.18)}
.stat-hours .stat-icon{background:linear-gradient(135deg,rgba(251,191,36,.18),rgba(251,191,36,.06));color:#fcd34d;box-shadow:0 4px 14px rgba(251,191,36,.18),inset 0 0 0 1px rgba(251,191,36,.18)}
.stat-num{font-size:1.35rem;font-weight:800;letter-spacing:-.6px;line-height:1.15;background:linear-gradient(180deg,#fff 0%,#c4b5fd 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.stat-label{font-size:.7rem;color:var(--text-mute);font-weight:500}
.tabs{display:flex;gap:4px;margin-bottom:22px;position:sticky;top:0;z-index:10}
.tab{flex:1 1 0;min-width:0;background:transparent;border:none;color:var(--text-dim);padding:9px 2px;border-radius:999px;font-size:.75rem;font-weight:600;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;transition:color .2s ease,background .2s ease;font-family:inherit;outline:none!important}
.tab:hover{color:var(--text);background:rgba(255,255,255,.06)}.tab.active{background:linear-gradient(135deg,#7c3aed 0%,#a78bfa 100%);color:#fff;font-weight:700}
.pane{display:none}.pane.active{display:block;animation:fadeIn .3s ease}@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.grid{display:flex;flex-direction:column;gap:10px}
.item{position:relative;display:flex;gap:14px;background:linear-gradient(160deg,#141416 0%,#0e0e10 100%);border:1px solid var(--border);border-radius:var(--radius-lg);padding:12px;transition:transform .2s ease,border-color .2s,box-shadow .2s;animation:fadeInUp .4s ease backwards;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.03);text-decoration:none;color:inherit}
.item.clickable{cursor:pointer}.item.clickable:active{transform:scale(.985);background:var(--surface-2)}
@keyframes fadeInUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.item:hover{border-color:rgba(167,139,250,.25);box-shadow:0 8px 28px rgba(0,0,0,.45),0 0 0 1px rgba(167,139,250,.08);transform:translateY(-1px)}
.wl-remove,.wl-watched,.wl-unwatch{position:absolute;top:6px;right:6px;width:26px;height:26px;border-radius:50%;background:rgba(0,0,0,.65);line-height:1;cursor:pointer;z-index:3;display:flex;align-items:center;justify-content:center;padding:0;font-family:inherit;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);transition:background .15s,transform .15s,opacity .15s,color .15s}
.wl-remove{color:#fff;border:1px solid rgba(255,255,255,.22);font-size:1rem;font-weight:400;opacity:.88}.wl-remove:hover{background:rgba(200,70,80,.92);opacity:1;transform:scale(1.06)}
.wl-watched{color:#4ade80;border:1px solid rgba(74,222,128,.45);font-size:.85rem;font-weight:700;opacity:.9}.wl-watched:hover{background:rgba(74,222,128,.95);color:#000;opacity:1;transform:scale(1.06)}
.wl-unwatch{color:#ffb84d;border:1px solid rgba(255,184,77,.45);font-size:.9rem;font-weight:700;opacity:.9}.wl-unwatch:hover{background:rgba(255,184,77,.95);color:#000;opacity:1;transform:scale(1.06)}
.wl-remove:disabled,.wl-watched:disabled,.wl-unwatch:disabled{opacity:.5;cursor:wait}
.wl-toolbar{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-bottom:14px}.wl-sort-label{display:inline-flex;align-items:center;gap:8px;font-size:.82rem;color:var(--text-dim)}
.wl-sort{background:var(--surface);border:1px solid var(--border);color:var(--text);padding:7px 12px;border-radius:8px;font-size:.82rem;font-family:inherit;cursor:pointer;outline:none;transition:border-color .15s}.wl-sort:hover{border-color:#2a3345}.wl-sort:focus{border-color:#7d9dd4}
.poster{width:76px;height:114px;border-radius:10px;overflow:hidden;flex-shrink:0;background:var(--surface-2);position:relative}.poster img{width:100%;height:100%;object-fit:cover}
.poster-ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.8rem;background:linear-gradient(135deg,var(--surface-2),#1a2233);color:var(--text-dim)}
.info{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:4px}
.name-row{display:flex;align-items:baseline;gap:0;overflow:hidden;white-space:nowrap;line-height:1.3;letter-spacing:-.2px}
.name{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:1rem;font-weight:700;color:var(--text)}
.tag{flex:0 0 auto;font-size:inherit;font-weight:inherit;letter-spacing:0;white-space:nowrap}.tag.upcoming{color:#ffb84d}
.overview{font-size:.8rem;color:var(--text-dim);overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;line-height:1.45;margin-top:4px}
.meta{font-size:.8rem;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.meta.dim{color:#7a8394;font-size:.78rem;margin-top:2px}
.bar{height:3px;background:rgba(255,255,255,.06);border-radius:99px;overflow:hidden;margin-top:8px}.bar-fill{height:100%;background:linear-gradient(90deg,#7c3aed,#c4b5fd);border-radius:99px;box-shadow:0 0 10px rgba(167,139,250,.5)}
.cal-open-btn{align-self:flex-start;margin-top:8px;background:rgba(90,120,180,.14);border:1px solid rgba(140,170,220,.35);color:#9db5e0;padding:5px 12px;border-radius:8px;font-size:.74rem;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;display:inline-flex;align-items:center;gap:5px}
.cal-open-btn:hover{background:rgba(120,150,210,.28);color:#c2d4f0;border-color:rgba(140,170,220,.65)}.cal-open-btn svg{flex-shrink:0}
.cal-open-btn.wl-added{background:rgba(74,222,128,.14)!important;border-color:rgba(74,222,128,.38)!important;color:#4ade80!important;cursor:default!important}
.search-bar{margin-bottom:16px}
.search-input{width:100%;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:12px 16px;border-radius:12px;font-size:.95rem;font-family:inherit;outline:none;transition:border-color .15s,background .15s;-webkit-appearance:none;appearance:none}
.search-input:focus{border-color:var(--accent);background:var(--surface-2);box-shadow:0 0 0 3px var(--accent-soft)}.search-input::placeholder{color:var(--text-mute)}
.trending-head{display:flex;align-items:center;gap:8px;font-size:.88rem;font-weight:700;color:var(--text);margin:4px 0 14px;padding-left:2px;letter-spacing:.2px}
.trending-head::before{content:'';width:3px;height:14px;border-radius:2px;background:linear-gradient(180deg,#f97316,#ef4444)}
.show-cal-modal{position:fixed;inset:0;z-index:130;display:none}.show-cal-modal.open{display:block}
.show-cal-backdrop{position:absolute;inset:0;background:rgba(2,4,8,.78);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);animation:fadeIn .2s ease}
.show-cal-panel{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(92vw,440px);max-height:90vh;overflow-y:auto;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:20px;box-shadow:0 30px 80px rgba(0,0,0,.8);animation:modalIn .25s cubic-bezier(.2,.9,.3,1)}
.show-cal-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}
.show-cal-name{font-size:.95rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.show-cal-close{width:32px;height:32px;flex-shrink:0;background:rgba(255,255,255,.04);border:1px solid var(--border);color:var(--text-dim);border-radius:50%;cursor:pointer;font-size:1.1rem;line-height:1;display:flex;align-items:center;justify-content:center;transition:all .15s;font-family:inherit}.show-cal-close:hover{color:var(--text);border-color:#3a4a68}
.show-cal-info{font-size:.72rem;color:var(--text-dim);margin-bottom:12px;line-height:1.4}
.show-cal-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;font-size:.88rem;color:var(--text);font-weight:600}
.show-cal-nav button{width:30px;height:30px;background:rgba(255,255,255,.04);border:1px solid var(--border);color:var(--text-dim);border-radius:8px;cursor:pointer;font-size:1rem;line-height:1;display:flex;align-items:center;justify-content:center;transition:all .15s;font-family:inherit}.show-cal-nav button:hover{color:var(--text);border-color:#3a4a68}
.show-cal-weekdays{display:grid;grid-template-columns:repeat(7,1fr);text-align:center;font-size:.7rem;color:var(--text-dim);margin-bottom:6px}
.show-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.sc-day{position:relative;aspect-ratio:1;display:flex;align-items:center;justify-content:center;border-radius:8px;font-size:.8rem;color:var(--text-dim);cursor:default;border:1px solid transparent;transition:background .15s,border-color .15s}.sc-day.sc-has{cursor:pointer;font-weight:700}
.sc-day.sc-past{background:rgba(90,120,180,.22);color:#9db0d0;border-color:rgba(120,150,210,.5)}.sc-day.sc-past:hover{background:rgba(120,150,210,.4);color:#d0dcf0}
.sc-day.sc-today-day{background:#4a6db8;color:#fff;border-color:#7d9dd4;box-shadow:0 0 14px rgba(125,157,212,.7)}.sc-day.sc-today-day:hover{background:#5b7fc4}
.sc-day.sc-future{background:rgba(255,184,77,.18);color:#ffd693;border-color:rgba(255,184,77,.55)}.sc-day.sc-future:hover{background:rgba(255,184,77,.4);color:#fff0d0}
.sc-day.sc-active{outline:2px solid #fff;outline-offset:-2px}.sc-day.sc-empty{visibility:hidden}
.sc-badge{position:absolute;top:2px;right:2px;min-width:14px;height:14px;padding:0 3px;border-radius:7px;background:#4a6db8;color:#fff;font-size:.6rem;font-weight:700;line-height:14px;text-align:center}.sc-day.sc-future .sc-badge{background:#d99a3a}
.show-cal-legend{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:14px;font-size:.7rem;color:var(--text-dim)}.legend-item{display:inline-flex;align-items:center;gap:5px}.legend-dot{display:inline-block;width:10px;height:10px;border-radius:3px}
.legend-past{background:rgba(90,120,180,.5);border:1px solid rgba(140,170,220,.8)}.legend-today{background:#4a6db8;border:1px solid #7d9dd4}.legend-future{background:rgba(255,184,77,.4);border:1px solid rgba(255,184,77,.8)}
.show-cal-detail{margin-top:14px;border-top:1px solid var(--border);padding-top:12px;min-height:20px}
.sc-ep{display:flex;gap:10px;align-items:baseline;padding:6px 0;font-size:.82rem}.sc-ep-tag{font-family:ui-monospace,Menlo,monospace;font-size:.72rem;font-weight:700;color:#7d9dd4;flex-shrink:0}.sc-ep-title{color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ext-rating{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:6px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);line-height:1;font-size:.78rem;color:var(--text);white-space:nowrap}
.ext-label{font-size:.68rem;font-weight:800;letter-spacing:.4px;text-transform:uppercase;opacity:.92}.ext-score{font-weight:800;letter-spacing:.2px}
.ext-rating.ext-imdb{background:#f5c518;border-color:#d4a800;color:#000}.ext-rating.ext-rt{background:rgba(250,50,10,.16);border-color:rgba(250,50,10,.35);color:#ff7666}.ext-rating.ext-mc{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.12);color:var(--text)}.ext-rating.ext-trakt{background:rgba(237,28,36,.16);border-color:rgba(237,28,36,.38);color:#ff6b70}.ext-rating.ext-tmdb{background:rgba(1,180,228,.16);border-color:rgba(1,180,228,.38);color:#4dd0e1}
.ext-rating.ext-douban{background:rgba(46,150,61,.16);border-color:rgba(46,150,61,.42);color:#4ecb71;text-decoration:none;transition:background .15s,border-color .15s,color .15s}.ext-rating.ext-douban:hover{background:rgba(46,150,61,.30);border-color:rgba(46,150,61,.70);color:#6fe089;text-decoration:none}
.detail-ext-ratings{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:6px}
@media (min-width:600px){.container{padding-left:20px;padding-right:20px}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.item{border-radius:14px}.poster{width:72px;height:108px}}
@media (min-width:768px){.container{max-width:1000px;padding:0 28px calc(88px + env(safe-area-inset-bottom))}.hero{padding:28px 0 22px;gap:12px}.hero-avatar{width:56px;height:56px}.hero-name{font-size:1.55rem}.stats{gap:10px;padding:18px 12px;margin-bottom:24px}.stat-num{font-size:1.5rem}.stat-label{font-size:.76rem}.stat-icon{width:34px;height:34px;border-radius:10px}.tabs{position:static}.tab{flex:0 0 auto;padding:9px 18px;font-size:.87rem}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px}.item{display:flex;flex-direction:column;gap:0;padding:0;border-radius:12px;background:transparent;border:none;overflow:visible}.item:hover{background:transparent;border:none}.item.clickable:active{transform:none;background:transparent}.poster{width:100%;height:auto;aspect-ratio:2/3;border-radius:12px;transition:transform .25s ease,box-shadow .25s ease;box-shadow:0 4px 16px rgba(0,0,0,.5)}.item:hover .poster{transform:translateY(-4px);box-shadow:0 12px 32px rgba(91,124,250,.3),0 4px 16px rgba(0,0,0,.6)}.info{display:block;padding:10px 2px 0;flex:none;justify-content:flex-start}.name{font-size:.88rem}.overview{-webkit-line-clamp:2;font-size:.74rem;margin-top:4px}.meta{font-size:.76rem;margin-top:3px}.meta.dim{font-size:.72rem}.bar{margin-top:8px}.wl-remove,.wl-watched,.wl-unwatch{top:8px;right:8px;width:28px;height:28px}.day-num{font-size:1.6rem}}
@media (min-width:1024px){.container{max-width:1120px;padding:0 32px 100px}.hero{padding:36px 0 26px}.hero-name{font-size:1.7rem}.stats{gap:12px;padding:20px 14px;margin-bottom:28px}.stat-num{font-size:1.7rem}.stat-label{font-size:.78rem}.stat-icon{width:36px;height:36px}.grid{grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:20px}.name{font-size:.9rem}.overview{-webkit-line-clamp:3;font-size:.76rem}.wl-remove,.wl-watched,.wl-unwatch{top:10px;right:10px;width:30px;height:30px}.wl-watched,.wl-unwatch{font-size:.95rem}}
@media (min-width:1280px){.container{max-width:1280px;padding:0 40px 110px}.grid{grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:22px}.hero-name{font-size:1.85rem}}
@media (min-width:1600px){.container{max-width:1440px}.grid{grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:24px}}
.day{margin-bottom:26px}.day-head{display:flex;align-items:center;gap:12px;margin-bottom:12px;padding-left:2px}.day-num{font-size:1.8rem;font-weight:800;color:#7d9dd4;line-height:1;letter-spacing:-1px}.day-mon{font-size:.75rem;color:var(--text-dim)}.day-wd{font-size:.85rem;font-weight:600;color:var(--text)}.today{background:var(--accent);color:#fff;font-size:.68rem;padding:3px 9px;border-radius:999px;font-weight:700;margin-left:auto}
.empty{text-align:center;padding:80px 20px;color:var(--text-dim)}.empty p{margin-top:14px;font-size:.92rem}
@media (min-width:700px){.empty{padding:120px 20px}}
.modal{position:fixed;inset:0;z-index:100;display:none}.modal.open{display:block}
.modal-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(12px) saturate(1.1);-webkit-backdrop-filter:blur(12px) saturate(1.1);animation:fadeIn .2s ease}
.modal-panel{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:12px;padding-top:calc(12px + env(safe-area-inset-top));padding-bottom:calc(12px + env(safe-area-inset-bottom));pointer-events:none}
.modal-body{pointer-events:auto;position:relative;width:100%;max-width:min(880px,100%);max-height:100%;overflow-y:auto;overflow-x:hidden;background:#000;border:1px solid var(--border);border-radius:18px;box-shadow:0 40px 100px rgba(0,0,0,.85);animation:modalIn .28s cubic-bezier(.2,.9,.3,1);-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
@media (max-width:599px){.modal-panel{padding:0;align-items:stretch;justify-content:flex-start}.modal-body{position:absolute;left:0;right:0;top:calc(10px + env(safe-area-inset-top));bottom:0;max-width:100%;max-height:none;width:100%;border-radius:16px 16px 0 0;border:none;border-top:1px solid var(--border);padding-bottom:env(safe-area-inset-bottom)}.modal-close{top:calc(14px + env(safe-area-inset-top));right:max(14px,env(safe-area-inset-right));width:44px;height:44px}.modal-close::before{inset:-12px}.detail-inner{padding-top:16px}.detail-body{padding-bottom:calc(28px + env(safe-area-inset-bottom))}}
@media (min-width:768px) and (max-width:1023px){.modal-body{max-width:min(720px,92vw)}}
@keyframes modalIn{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
.modal-close{position:fixed;top:max(14px,env(safe-area-inset-top));right:max(14px,env(safe-area-inset-right));z-index:130;width:44px;height:44px;border-radius:50%;background:rgba(13,16,23,.92);border:1px solid rgba(255,255,255,.18);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);transition:background .15s,transform .15s,border-color .15s;padding:0;box-shadow:0 4px 16px rgba(0,0,0,.55);touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.modal-close::before{content:'';position:absolute;inset:-10px;border-radius:50%}.modal-close:hover{background:rgba(30,38,58,.95);transform:scale(1.05);border-color:rgba(255,255,255,.28)}.modal-close:active{transform:scale(.94);background:rgba(50,60,88,.95)}
.modal-loading{padding:100px 20px;text-align:center}.modal-error{padding:80px 20px;text-align:center;color:#9db5e0;font-size:.9rem}
@media (min-width:700px){.modal-panel{padding:40px 24px}}
.detail-hero{position:relative;overflow:hidden;background:var(--surface);border-radius:18px 18px 0 0}.detail-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(30px) saturate(1.2) brightness(.5);transform:scale(1.15);z-index:0}.detail-hero::after{content:'';position:absolute;inset:0;z-index:1;background:linear-gradient(180deg,rgba(10,14,24,.6),rgba(10,14,24,.95))}
.detail-inner{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;text-align:center;gap:16px;padding:24px 20px 24px}
.detail-poster{width:min(48vw,200px);height:auto;aspect-ratio:2/3;border-radius:14px;object-fit:cover;flex-shrink:0;box-shadow:0 16px 40px rgba(0,0,0,.75);margin:0 auto}.detail-poster-ph{display:flex;align-items:center;justify-content:center;background:var(--surface-2);font-size:2.8rem;color:var(--text-dim);width:min(48vw,200px);aspect-ratio:2/3}
.detail-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;align-items:center;width:100%}.detail-title{font-size:1.45rem;font-weight:800;letter-spacing:-.4px;line-height:1.25}.detail-tagline{font-size:.85rem;color:var(--text-dim);font-style:italic}.detail-meta{display:flex;flex-wrap:wrap;gap:10px;font-size:.85rem;color:var(--text-dim);justify-content:center}.detail-genres{font-size:.82rem;color:var(--text-dim)}.detail-overview{font-size:.88rem;color:#c0c8d6;line-height:1.55;margin-top:4px;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden;text-align:center}
.d-status{display:flex;gap:12px;align-items:center;background:linear-gradient(135deg,#16161a,#0e0e10);border:1px solid var(--border);border-radius:14px;padding:12px 14px;margin-top:8px;width:100%;justify-content:flex-start}.d-status.done{border-color:rgba(74,222,128,.3);background:rgba(74,222,128,.06)}.d-status-row{display:flex;gap:12px;align-items:center;width:100%}
.d-status-icon{width:32px;height:32px;border-radius:50%;background:var(--surface-2);color:var(--text-dim);display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;font-size:.95rem}.d-status.done .d-status-icon{background:rgba(74,222,128,.15);color:#4ade80}
.d-status-body{flex:1;min-width:0;text-align:left}.d-status-title{font-size:.88rem;font-weight:600}.d-status-sub{font-size:.76rem;color:var(--text-dim);margin-top:2px}
.d-mark-btn{flex-shrink:0;background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.35);color:#6ee7b7;padding:8px 14px;border-radius:10px;font-size:.78rem;font-weight:700;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap}.d-mark-btn:hover{background:rgba(52,211,153,.25);color:#a7f3d0}.d-mark-btn:disabled{opacity:.6;cursor:wait}.d-mark-btn.done{background:rgba(52,211,153,.2);color:#34d399;cursor:default}.d-mark-btn.unwatch{background:rgba(255,184,77,.12);border-color:rgba(255,184,77,.35);color:#ffb84d}.d-mark-btn.unwatch:hover{background:rgba(255,184,77,.25);color:#ffd693}
.infuse-btn{display:inline-flex;align-items:center;gap:8px;align-self:center;background:linear-gradient(135deg,#7c3aed 0%,#a78bfa 100%);border:1px solid transparent;color:#fff;padding:10px 20px;border-radius:12px;font-size:.85rem;font-weight:700;text-decoration:none;margin-top:10px;box-shadow:0 6px 22px rgba(167,139,250,.3);transition:all .2s ease;cursor:pointer;font-family:inherit}.infuse-btn:hover{border-color:rgba(125,157,212,.75);background:linear-gradient(135deg,#15203a,#233258);color:#d0dcf0;box-shadow:0 4px 20px rgba(90,130,200,.35);text-decoration:none}.infuse-btn svg{flex-shrink:0}
.detail-body{padding:20px 22px 24px}.d-section{margin-top:8px;margin-bottom:26px}.d-section:last-child{margin-bottom:0}.d-section-title{font-size:1rem;font-weight:700;letter-spacing:.2px;margin-bottom:14px;color:var(--text);display:flex;align-items:center;gap:8px}.d-section-title::before{content:'';width:3px;height:16px;border-radius:2px;background:#7d9dd4}
.cast-scroll{display:flex;gap:14px;overflow-x:auto;padding-bottom:8px;scrollbar-width:none}.cast-scroll::-webkit-scrollbar{display:none}.cast{flex-shrink:0;width:84px;text-align:center}.cast-img{width:84px;height:84px;border-radius:50%;object-fit:cover;background:var(--surface-2)}.cast-ph{display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:1.6rem;font-weight:600;background:linear-gradient(135deg,var(--surface-2),#1a2233)}.cast-name{font-size:.75rem;font-weight:600;margin-top:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cast-role{font-size:.68rem;color:var(--text-dim);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.seasons{display:flex;flex-direction:column;gap:8px}.season-item{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;transition:border-color .15s}.season-item.open{border-color:#2a3345}
.season-head{width:100%;background:none;border:none;color:inherit;display:flex;align-items:center;gap:10px;padding:14px 16px;cursor:pointer;font-family:inherit;text-align:left;transition:background .15s}.season-head:hover{background:var(--surface-2)}
.season-title{font-weight:600;font-size:.9rem;flex:1}.season-meta{font-size:.76rem;color:var(--text-dim)}
.chev{width:16px;height:16px;color:var(--text-dim);transition:transform .2s ease;flex-shrink:0}.season-item.open .chev{transform:rotate(180deg)}
.season-body{display:none;border-top:1px solid var(--border)}.season-item.open .season-body{display:block}.ep-empty{padding:20px;text-align:center;color:var(--text-dim);font-size:.85rem}
.episode{display:flex;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);align-items:flex-start;transition:background .15s}.episode:last-child{border-bottom:none}.episode.clickable{cursor:pointer}.episode.clickable:hover{background:var(--surface-2)}.episode.clickable:active{background:#1a2233}.episode.clickable:hover .ep-title{color:#7d9dd4}.episode.watched .ep-title{color:var(--text-dim)}.episode.watched.clickable:hover .ep-title{color:#7d9dd4}
.ep-num{font-family:ui-monospace,Menlo,monospace;font-size:.76rem;color:var(--text-dim);font-weight:700;flex-shrink:0;padding-top:3px;width:32px;letter-spacing:.5px}.ep-body{flex:1;min-width:0}.ep-title{font-size:.86rem;font-weight:600;line-height:1.3}.ep-overview{font-size:.76rem;color:var(--text-dim);margin-top:4px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.ep-check{color:#4ade80;font-weight:700;flex-shrink:0;font-size:.9rem;padding-top:2px}
.ep-actions{flex-shrink:0;display:flex;align-items:center}.ep-watch-btn{background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.35);color:#6ee7b7;padding:3px 9px;border-radius:7px;font-size:.7rem;font-weight:700;cursor:pointer;font-family:inherit;transition:all .15s}.ep-watch-btn:hover{background:rgba(52,211,153,.25);color:#a7f3d0}.ep-watch-btn:disabled{opacity:.6;cursor:wait}.ep-watch-btn.done{background:rgba(52,211,153,.2);color:#34d399;cursor:default}
.modal-body .grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px}
@media (min-width:700px){.detail-inner{flex-direction:row;align-items:flex-start;text-align:left;padding:30px;gap:26px}.detail-poster{width:180px;height:auto;aspect-ratio:2/3;margin:0}.detail-info{align-items:flex-start}.detail-meta{justify-content:flex-start}.infuse-btn{align-self:flex-start}.detail-overview{text-align:left}.detail-title{font-size:1.85rem}.detail-overview{font-size:.92rem;-webkit-line-clamp:6}.detail-body{padding:26px 30px 30px}.cast{width:96px}.cast-img{width:96px;height:96px}.modal-body .grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:18px}.detail-ext-ratings{justify-content:flex-start}}
.confirm-modal{position:fixed;inset:0;z-index:200;display:none}.confirm-modal.open{display:block}
.confirm-backdrop{position:absolute;inset:0;background:rgba(2,4,8,.7);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:fadeIn .18s ease}
.confirm-panel{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(88vw,340px);background:linear-gradient(165deg,#16161a 0%,#0e0e10 100%);border:1px solid var(--border-strong);border-radius:18px;padding:24px 22px 18px;box-shadow:0 30px 80px rgba(0,0,0,.8);text-align:center;animation:confirmIn .22s cubic-bezier(.2,.9,.3,1)}
@keyframes confirmIn{from{opacity:0;transform:translate(-50%,-48%) scale(.95)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
.confirm-icon{width:48px;height:48px;margin:0 auto 12px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.4rem;background:var(--accent-soft);color:var(--accent-2)}.confirm-icon.danger{background:rgba(224,85,96,.14);color:#ff7b85}.confirm-icon.warn{background:rgba(255,184,77,.14);color:#ffb84d}.confirm-icon.success{background:rgba(52,211,153,.14);color:#34d399}
.confirm-title{font-size:1.02rem;font-weight:700;margin-bottom:6px;color:var(--text)}.confirm-msg{font-size:.84rem;color:var(--text-dim);line-height:1.55;word-break:break-word}.confirm-actions{display:flex;gap:10px;margin-top:20px}
.confirm-btn{flex:1;padding:11px 14px;border-radius:12px;font-size:.88rem;font-weight:700;font-family:inherit;cursor:pointer;border:1px solid transparent;transition:all .15s;-webkit-tap-highlight-color:transparent}
.confirm-cancel{background:rgba(255,255,255,.05);border-color:var(--border);color:var(--text-dim)}.confirm-cancel:hover{background:rgba(255,255,255,.09);color:#fff}
.confirm-ok{background:linear-gradient(135deg,#7c3aed 0%,#a78bfa 100%);color:#fff;box-shadow:0 6px 20px rgba(167,139,250,.3)}.confirm-ok:hover{filter:brightness(1.08)}.confirm-ok.danger{background:linear-gradient(135deg,#dc2626 0%,#f87171 100%);box-shadow:0 6px 20px rgba(248,113,113,.28)}.confirm-ok:disabled,.confirm-cancel:disabled{opacity:.6;cursor:wait}`;
}
