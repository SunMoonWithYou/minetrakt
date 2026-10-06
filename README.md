<img width="1920" height="919" alt="image" src="https://github.com/user-attachments/assets/26fd1e25-c307-415e-bf43-4374670fe44a" /># MineTrakt

在 Cloudflare Workers 上运行的 Trakt 观看记录查看器 —— 继续观看 · 追剧日历 · 观看记录 · Infuse 跳转

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Trakt API](https://img.shields.io/badge/Trakt-API-ED1C24?logo=trakt&logoColor=white)](https://trakt.docs.apiary.io/)
[![TMDB API](https://img.shields.io/badge/TMDB-API-01B4E4?logo=themoviedb&logoColor=white)](https://developers.themoviedb.org/3)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](#license)

---

项目Demo：https://trakt.yx1314.ccwu.cc

## ✨ 特性

- **继续观看** — 自动合并播放进度与已看记录，推算下一集
- **追剧日历** — 未来 30 天待播剧集，北京时间分组
- **观看记录** — 全量历史 + 无限滚动
- **详情 Modal** — 演职员 / 季集折叠 / 相关推荐
- **TMDB 富化** — 海报 / 简介 / 评分异步补齐
- **Infuse 跳转** — `infuse://series/{tmdb_id}-{season}-{episode}` 直开单集
- **PWA** — 可安装到主屏，支持离线缓存
- **流式渲染** — 骨架先出，数据分批注入，800ms 内可见

---

## 🚀 部署

### 1. 准备凭据

| 项目              | 获取地址                                                     |
| ----------------- | ------------------------------------------------------------ |
| `TRAKT_CLIENT_ID` | [trakt.tv/oauth/applications](https://trakt.tv/oauth/applications/new)（Redirect URI 填 `urn:ietf:wg:oauth:2.0:oob`） |
| `TMDB_API_KEY`    | [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api) |
| `TMDB_CACHE`      | Cloudflare Dashboard → Workers & Pages → KV → Create namespace |

### 2. 部署 Worker

Cloudflare Dashboard → Workers & Pages → Create Worker，把 `worker.js` 全文粘贴后 Save and Deploy。

或用 Wrangler：

```bash
wrangler login
wrangler deploy
```

### 3. 配置绑定

Worker → Settings → Variables and Secrets：

```
TRAKT_CLIENT_ID  = 你的 Trakt Client ID   (Secret)
TMDB_API_KEY     = 你的 TMDB API Key      (Secret)
```



KV Namespace Bindings：

```
TMDB_CACHE → 步骤 1 创建的命名空间
```



重新部署生效。

------

## 🎮 使用

1. 打开 Worker 域名 → 点击「使用 Trakt 登录」
2. 扫描二维码 / 手动打开 [trakt.tv/activate](https://trakt.tv/activate) → 输入设备码 → 授权
3. 完成，自动进入首页

**深链**：`/detail/movie/{trakt_id}` 或 `/detail/show/{trakt_id}`

------

## 🏗️ 架构

text

```
浏览器
  ├─ GET /              流式首页（骨架先出，数据后注入）
  ├─ GET /api/detail    详情（Trakt + TMDB 并发）
  ├─ POST /api/enrich   批量富化（三级缓存）
  └─ GET /api/season    季集懒加载
```



**缓存层次**

text

```
L1 内存(30s) → singleFlight 去重 → KV(边缘 60s) → TMDB 回源
```



**SW 策略**

- `navigate` / `/api/*` / `/auth/*` 一律不拦截
- 仅图片 / 图标 / 字体走 cache-first
- 桌面端主动注销 SW；移动端才注册

------

## 🎨 主题

编辑 `pageHead()` 里的 CSS 变量即可整体换肤：

css

```
:root {
  --bg: #0a0102;        /* 页面底色 */
  --surface: #150507;   /* 卡片 */
  --border: #300d12;    /* 边框 */
  --text: #f5f5f7;      /* 主文字 */
  --accent: #8f0b18;    /* 强调色（深酒红） */
  --accent-2: #b91323;  /* 悬停色 */
}
```



------

## ⚙️ 可调参数

js

```
const PAGE_SIZE = 12;            // 每页条数
const TMDB_KV_TTL = 86400 * 7;   // TMDB 缓存 7 天
const MAX_RECENT_SHOWS = 15;     // 继续观看检查最近 N 部剧
const KV_MEM_TTL = 30_000;       // L1 内存缓存 30s
const KV_EDGE_TTL = 60;          // KV 边缘缓存 60s
```



------

## ❓ FAQ

<details> <summary>登录卡在「等待授权中」</summary>

- 检查 `TRAKT_CLIENT_ID` 是否配置
- 检查 Trakt 应用 Redirect URI 是否为 `urn:ietf:wg:oauth:2.0:oob`
- 展开页面下方「调试日志」查看具体错误

</details><details> <summary>海报 / 简介不显示</summary>

- 检查 `TMDB_API_KEY` 与 `TMDB_CACHE` 绑定
- 首次加载异步富化需要几秒，稍等或刷新

</details><details> <summary>Infuse 按钮无反应</summary>

- 需要 Infuse 8+
- 必须从 Safari 打开（微信内置浏览器拦截自定义协议）

</details><details> <summary>桌面端显示旧缓存</summary>

`Ctrl+Shift+R`（Mac: `Cmd+Shift+R`）强制刷新，或 DevTools → Application → Clear site data

</details><details> <summary>KV 免费额度</summary>

每天 10 万次读、1000 次写。本应用 L1 + KV 双层缓存能挡 90%+ 请求，个人使用完全够用。

</details>

------

## 🔒 安全

- Token 存 HttpOnly Cookie，JS 无法读取
- Access Token 自动续期
- 服务端不存储用户数据、不收集日志
