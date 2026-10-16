# MineTrakt

> 一个自托管的影视追踪 PWA，跑在 Cloudflare Workers 上，单文件部署。
> 以 Trakt 为追剧数据源，叠加 TMDB / OMDB / 豆瓣 / 骨朵 的评分与榜单。

------

## 简介

MineTrakt 是一个**单文件 Cloudflare Workers 应用**，把 Trakt 的追剧能力包装成一个现代化的 PWA：

- **继续观看** —— 从 Trakt 拉取下一集，支持 Infuse 深链播放
- **待看列表** —— Trakt watchlist 的本地镜像，支持增删、排序、分页
- **追剧日历** —— 未来 30 天待播剧集，按天分组，支持单剧播出日历
- **观看记录** —— 完整历史，支持翻页
- **搜索** —— TMDB 电影 + 剧集搜索，无结果时展示今日趋势
- **观看小结** —— 月度 / 年度统计，热力图、TOP 榜

首页额外集成：

- **豆瓣热播** —— 国产 / 港台 / 日韩 / 欧美，横向滚动卡片
- **平台剧场** —— 聚合类资源站
- **骨朵热榜** —— 剧集 / 电影 / 动漫 / 综艺
- **流媒体平台** —— Netflix / Disney+ / HBO Max / Apple TV+ / Prime Video / B站 / 爱奇艺 / 腾讯 / 优酷 / 芒果TV

所有页面均支持 **深色 / 浅色 / 跟随系统** 三态主题，带 **PWA** 安装，Service Worker 缓存静态资源。

------

## 特性

### 前端

- 移动优先，响应式布局（手机单列 → 桌面网格）
- 无框架，纯原生 JS + CSS，无构建步骤
- PWA，可安装到主屏，独立启动页
- 主题切换无首帧闪烁（`THEME_BOOT_SCRIPT` 内联同步执行）
- 骨架屏 + 流式渲染，首屏可交互时间短
- Toast / Modal / 确认框 / 底部抽屉 等一整套交互组件

### 后端

- Cloudflare Workers，**单文件部署**，无 npm 依赖
- **三级缓存**：进程内存 → KV → 上游
- **Single-flight**：同 key 并发请求复用同一 Promise
- **Stale-while-revalidate**：过期数据先返回、后台刷新
- **Trakt 出网闸门**：串行化 + 最小间隔，削峰避免风控
- **429 冷却**：按连续命中次数指数退避，per-user 隔离
- **lastGood 兜底**：上游失败时回退到「最后一次成功数据」
- **KV 写入节流**：同 key 每小时最多写一次，lg 副本 6 小时一次
- **版本号失效**：watchlist 增删 bump 版本号，旧缓存自动作废

### 数据源

| 来源                                | 用途                           | 需要 Key               |
| :---------------------------------- | :----------------------------- | :--------------------- |
| [Trakt](https://trakt.tv/)          | 追剧数据、用户进度、历史       | `TRAKT_CLIENT_ID`      |
| [TMDB](https://www.themoviedb.org/) | 元数据、中文标题、海报、预告片 | `TMDB_API_KEY`         |
| [OMDb](https://www.omdbapi.com/)    | IMDb / RT / Metacritic 评分    | `OMDB_API_KEY`（可选） |
| [豆瓣榜单]()                        | 热播国产 / 港台 / 日韩 / 欧美  | —                      |
| [平台剧场]()                        | 聚合资源站                     | —                      |
| [骨朵热榜]()                        | 剧集 / 电影 / 动漫 / 综艺      | —                      |

------

## 项目预览

<details>
<summary>项目介绍</summary>


### 🌐 在线体验

**在线地址：**
https://trakt.yx1314.ccwu.cc

### 🎬 演示视频

点击下方按钮即可观看 Demo：

[▶️ 点击观看演示视频](https://yourimageshare.com/ib/QyuHyTRdUv.mp4)

### ✨ 项目功能

![项目功能 1](https://i.ibb.co/NnLgcPGQ/20261006154814.png)

![项目功能 2](https://i.ibb.co/4Zv1MqxT/20261006154829.png)

![项目功能 3](https://i.ibb.co/b5ThQrz0/20261006154845.png)

![项目功能 4](https://i.ibb.co/8nW8VYrM/20261006154859.png)

![项目功能 5](https://i.ibb.co/k26zfdsV/20261006154911.png)

![项目功能 6](https://i.ibb.co/60rZWsb4/20261006154922.png)

</details>

## 部署

### 前置条件

- Cloudflare 账号（免费版即可）
- Trakt 账号 + [API 应用](https://trakt.tv/oauth/applications)
- TMDB 账号 + [API Key](https://www.themoviedb.org/settings/api)

### 1. 创建 Trakt API 应用

到 https://trakt.tv/oauth/applications/new 创建一个应用：

- **Name**：随便填，如 `MineTrakt`
- **Redirect URI**：`urn:ietf:wg:oauth:2.0:oob`
- **Permissions**：勾选全部（至少需要 read / checkin / sync）

创建后会得到 **Client ID** 和 **Client Secret**，本项目只需要 **Client ID**。

### 2. 创建 KV 命名空间

Cloudflare Dashboard → **Workers & Pages** → **KV** → **Create namespace**。

命名空间名字随便（如 `TMDB_CACHE`），创建后记下 ID。

### 3. 部署 Worker

**方式 A：Dashboard 粘贴（最简）**

1. Workers & Pages → **Create** → **Create Worker**
2. 把 `_worker.js` 的全部内容粘贴进去
3. 保存并部署

**方式 B：Wrangler CLI**

bash

```
npm i -g wrangler
wrangler login

# 创建 wrangler.toml
cat > wrangler.toml <<EOF
name = "minetrakt"
main = "_worker.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "TMDB_CACHE"
id = "<你的 KV 命名空间 ID>"
EOF

wrangler deploy
```



### 4. 配置环境变量

Dashboard → 你的 Worker → **Settings** → **Variables and Secrets**，添加：

| 变量名            | 必填 | 说明                                |
| :---------------- | :--- | :---------------------------------- |
| `TRAKT_CLIENT_ID` | ✅    | Trakt 应用的 Client ID              |
| `TMDB_API_KEY`    | ✅    | TMDB API Key                        |
| `OMDB_API_KEY`    | ⬜    | OMDb API Key，用于 IMDb / RT 评分   |
| `TMDB_CACHE`      | ✅    | KV 命名空间绑定（不是变量，是绑定） |

> ⚠️ `TMDB_CACHE` 是 **KV Namespace Binding**，在 **Settings → Bindings** 里添加，不是环境变量。变量名必须完全一致。

### 5. 访问

打开 Worker 的 URL（`https://..workers.dev`），会跳转到登录页，按提示用 Trakt 设备码登录。

------

## 路由

| 路径                       | 方法 | 说明                                                         |
| :------------------------- | :--- | :----------------------------------------------------------- |
| `/`                        | GET  | 启动页，按登录态跳 `/home` 或 `/login`                       |
| `/login`                   | GET  | 登录页（Trakt 设备码）                                       |
| `/home`                    | GET  | 首页                                                         |
| `/detail/:type/:id`        | GET  | 详情深链（客户端路由）                                       |
| `/app.js` `/app.css`       | GET  | 内联前端资源（带版本 ETag）                                  |
| `/sw.js`                   | GET  | Service Worker                                               |
| `/manifest.webmanifest`    | GET  | PWA manifest                                                 |
| `/assets/*`                | GET  | 图标（回源到图床）                                           |
| `/auth/device`             | GET  | 获取设备码                                                   |
| `/auth/poll`               | POST | 轮询授权状态                                                 |
| `/auth/logout`             | POST | 登出                                                         |
| `/api/home-data`           | GET  | 首页数据分片（`?part=playback|meta|watchlist|calendar|history|all`） |
| `/api/detail`              | GET  | 详情                                                         |
| `/api/detail-extras`       | GET  | 详情懒加载（演员 / 预告 / 推荐 / 评分）                      |
| `/api/season`              | GET  | 某季剧集列表                                                 |
| `/api/person`              | GET  | 演员详情                                                     |
| `/api/search`              | GET  | TMDB 搜索                                                    |
| `/api/trending`            | GET  | TMDB 今日趋势                                                |
| `/api/more`                | GET  | 分页（`?type=history|playback|watchlist`）                   |
| `/api/summary`             | GET  | 观看小结（`?period=month|year&ref=...`）                     |
| `/api/douban-list`         | GET  | 豆瓣列表                                                     |
| `/api/theater-list`        | GET  | 平台剧场                                                     |
| `/api/guduo-list`          | GET  | 骨朵热榜                                                     |
| `/api/platform-list`       | GET  | 流媒体平台（TMDB discover）                                  |
| `/api/show-calendar`       | GET  | 单剧播出日历                                                 |
| `/api/watchlist/add`       | POST | 加入待看                                                     |
| `/api/watchlist/remove`    | POST | 从待看移除                                                   |
| `/api/mark-watched`        | POST | 标记已看                                                     |
| `/api/unmark-watched`      | POST | 取消已看                                                     |
| `/api/mark-season-watched` | POST | 整季标记已看                                                 |
| `/api/drop-show`           | POST | 弃剧                                                         |
| `/api/enrich`              | POST | 批量富化（补中文标题 / 海报）                                |
| `/api/auth-status`         | GET  | 轻量登录态探测                                               |
| `/api/app-version`         | GET  | 版本对账（前端回前台时检查更新）                             |

------

## 架构

text

```
                         ┌───────────────────────────┐
   Browser ──── / ──────▶│  Launch  (splash + JS)    │
                         └───────────────────────────┘
                                     │
                         ┌───────────┴───────────┐
                         ▼                       ▼
                  /login (OAuth)          /home (PWA shell)
                                                 │
                         ┌───────────────────────┼───────────────────────┐
                         ▼                       ▼                       ▼
                    /api/home-data         /api/detail            /api/douban-list
                    (part 分片)             (实体 + 进度)           (热播榜)
                         │                       │                       │
                         ▼                       ▼                       ▼
              ┌──────────────────────────────────────────────────────────────┐
              │                    cachedJSON  (三级缓存统一入口)             │
              │                                                              │
              │  ┌─────────┐    ┌──────────────┐    ┌─────────────────┐    │
              │  │ 内存Map │──▶│ KV(TMDB_CACHE)│──▶│ Upstream fetch  │    │
              │  │ 30 min │    │  TTL + 7d    │    │ Trakt/TMDB/...  │    │
              │  └─────────┘    └──────────────┘    └─────────────────┘    │
              │       │                │                     │              │
              │       └─── SWR ───────┴──── lastGood ───────┘              │
              └──────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
              ┌──────────────────────────────────────────────────────────────┐
              │                    Trakt 出网闸门                            │
              │  FIFO 队列 · 最小间隔 1s · 429 冷却（指数退避）· per-user    │
              └──────────────────────────────────────────────────────────────┘
```



### 缓存层级

| 层                       | 生命周期            | 作用                                                         |
| :----------------------- | :------------------ | :----------------------------------------------------------- |
| **内存 Map** (`__kvMem`) | 30 分钟             | 单实例内复用，绝大多数请求在这里命中                         |
| **KV** (`TMDB_CACHE`)    | 逻辑 TTL + 7 天物理 | 跨实例共享，冷启动 / 多 colo 兜底                            |
| **上游**                 | —                   | Trakt / TMDB / OMDB / [widget.v2too.top](https://widget.v2too.top/) |

### 关键设计

**`cachedJSON()`** —— 唯一的缓存读写入口，所有业务数据都过它。

- `ttl` / `jitter`：逻辑过期 + 防雪崩抖动（同一 key 恒定偏移）
- `swr`：软过期先返回旧值、后台刷新
- `bypass`：强制刷新（点刷新按钮），失败不写 KV
- `revalidate: false`：有缓存就返回，不打上游
- `lastGoodKey`：兜底副本，主 key 换名后仍能读
- 带 `__error` / `__cooling` 的结果**永不写入 KV**

**Trakt 出网闸门** —— 所有 `api.trakt.tv` 请求经 `traktGate()`：

js

```
TRAKT_MIN_GAP_MS = 1000      // 两次请求最小间隔 1 秒
traktGate()                   // FIFO 队列，串行化
```



配合 per-user 429 冷却（连续命中按 2 的幂退避，成功清零），避免风控。

**KV 写入节流** —— `kvPutJSON()` 里：

- 同 key **1 小时**内最多写一次
- lastGood 副本单独 **6 小时**节流
- `force=1`（手动刷新）绕过节流
- KV 报错后 30 秒熔断，只写内存

**版本号失效** —— watchlist 每次增删 bump `wlv:${user}`，key 从 `wl:u:5:added` 变 `wl:u:6:added`，旧缓存自然作废。

------

## 本地开发

本项目**没有构建步骤**，编辑 `_worker.js` 即生效。

bash

```
# 本地运行（需 wrangler）
wrangler dev

# 部署
wrangler deploy

# 查看实时日志
wrangler tail
```



### 改代码须知

| 改了什么                                                   | 必须做什么                          |
| :--------------------------------------------------------- | :---------------------------------- |
| 客户端 JS（`getClientSideScripts` / `getBootstrapScript`） | bump `APP_JS_VERSION`               |
| 样式（`pageStyles`）                                       | bump `APP_CSS_VERSION`              |
| 任意改动                                                   | 同步 `SW_JS_CONTENT` 里的 `VERSION` |
| 模板字符串里的 ``                                          | 必须写成 `<\/script>`               |

版本号 bump 后，浏览器会通过 ETag 拿到新资源，前端在 `visibilitychange` 时调 `/api/app-version` 对账，发现不一致自动 `location.reload()`。

### 调试技巧

| 需求                | 做法                                                         |
| :------------------ | :----------------------------------------------------------- |
| 看 Trakt 是否被限流 | 首页刷新按钮会显示冷却剩余秒数                               |
| 看缓存来源          | `/api/home-data` 响应里有 `playbackSource` / `metaSource` 等字段 |
| 看剧场数据结构      | `/api/theater-list?mode=debug`                               |
| 看骨朵数据结构      | `/api/guduo-list?mode=debug`                                 |
| 绕过缓存打上游      | 请求加 `?force=1`                                            |

------

## 环境变量一览

| 变量              | 必填 | 默认 | 说明                                           |
| :---------------- | :--- | :--- | :--------------------------------------------- |
| `TRAKT_CLIENT_ID` | ✅    | —    | Trakt 应用 Client ID                           |
| `TMDB_API_KEY`    | ✅    | —    | TMDB API Key                                   |
| `OMDB_API_KEY`    | ⬜    | —    | OMDb API Key，不填则不显示 IMDb / RT / MC 评分 |
| `TMDB_CACHE`      | ✅    | —    | KV 命名空间绑定                                |

------

## 常见问题

**Q：登录后一直卡在登录页？**

检查 `TRAKT_CLIENT_ID` 是否正确。可以访问 `/auth/device` 看返回：如果是 `403`，说明 Client ID 配错了。

**Q：详情页没有演员 / 预告片？**

这两块是懒加载的，会走 `/api/detail-extras`。如果 TMDB Key 未配置或超时，对应板块会隐藏。

**Q：首页提示「Trakt 限流」？**

Trakt 免费账号有速率限制。程序已内置出网闸门和指数退避，等冷却结束即可。频繁刷新会加重限流。

**Q：KV 写入费用会不会超？**

免费版每天 1000 次写入。程序已做多层节流（同 key 1 小时一次、lastGood 6 小时一次），常态下 10~15 个活跃用户不会超。如果用户多，可调 `KV_MIN_PUT_INTERVAL_MS` / `LAST_GOOD_MIN_PUT_INTERVAL_MS`。

**Q：想换图标？**

修改 `ASSET_ORIGINS` 里的图床 URL，或把图标放到自己的域名。`/assets/favicon.ico` 等路径会回源到对应 URL 并缓存一年。

**Q：可以用自己的域名吗？**

可以。Worker 支持自定义域名，Dashboard → Worker → **Settings** → **Triggers** → **Custom Domains** 添加即可。

------

## 技术栈

- **运行时**：Cloudflare Workers（V8 isolate）
- **存储**：Cloudflare KV
- **前端**：原生 JS + CSS，无框架、无构建
- **认证**：Trakt OAuth Device Code + PKCE（S256）
- **PWA**：Manifest + Service Worker（stale-while-revalidate）
- **图标**：内联 SVG（评分徽章 / 启动 logo）+ 图床（PWA 图标）

------

## 许可

MIT

------

## 致谢

- [Trakt](https://trakt.tv/) —— 追剧数据
- [TMDB](https://www.themoviedb.org/) —— 元数据与海报
- [OMDb](https://www.omdbapi.com/) —— 第三方评分
