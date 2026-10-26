# byte.cloud

[Chen Wang](https://github.com/celanwang) 的个人博客源码（Astro 5 静态构建）。
UI 英文，内容中文：Notes on agentic engineering。

托管于 GitHub Pages，自有域名 <https://bytego.cloud>（源站自动构建部署，
push 到 `main` 后约 1 分钟上线，无需自有服务器）。

## 环境要求

- Node.js **20+**（仓库内置 `.nvmrc`，`nvm use` 即可；最低支持 18.20.8）
- 本机系统 Node 过旧时（CentOS 7 自带 Node 16 无法构建），可用 Docker：

```bash
cd /root/workspace/byte-cloud
docker run --rm -v "$PWD":/app -w /app node:20-bookworm-slim npm ci
docker run --rm -it -p 4321:4321 -v "$PWD":/app -w /app node:20-bookworm-slim npm run dev
docker run --rm -v "$PWD":/app -w /app node:20-bookworm-slim npm run build
```

## 常用命令

```bash
npm ci              # 安装依赖
npm run dev         # 开发预览 http://localhost:4321
npm run build       # 构建到 dist/（prebuild 钩子自动执行字体子集化）
npm run preview     # 本地预览构建产物
npm run deploy      # 构建 + rsync 到 /var/www/byte-cloud/
```

资源脚本（一般无需手动执行，`prebuild` / `predev` 会自动跑 `fonts`）：

```bash
npm run fonts       # 字体子集化：扫描 src 实际用字 → public/fonts/*.woff2
npm run images      # 图片母版 → public 原图 + 派生展示图 + og-default.jpg
```

- 字体源文件（google/fonts 固定镜像）缓存在 `scripts/fonts-src/`（已 gitignore，缺失时自动重新下载；下载失败且产物已存在时仅警告不中断构建）
- 图片母版在 `scripts/images-src/`（请提交仓库，勿删）；优化只读取母版，不反复压缩派生产物
- 每篇图文文章的 `scripts/images-src/blog/<slug>/images.json` 保存图片 alt、可选 caption 与类型（photo / graphic），供同步和图片优化共同使用
- Markdown 图片使用 `![alt](/blog/slug/image.png "可选图注")`。新增或替换图片后手动执行 `npm run images`：原图保留在 `/blog/slug/`，展示图生成到 `/blog/_derived/slug/`；派生图缺失时构建会回退到原图。图片脚本会清理 Astro 的 Markdown 缓存，确保下次构建采用最新派生路径
- 注意：Astro 会缓存 Markdown 渲染产物。修改 `src/lib/rehype-*.ts` 后若页面未更新，执行 `rm -rf node_modules/.astro .astro` 再构建

## 功能概览

- Markdown 内容集合（draft / featured / tags），UI 英文 + 正文中文
- 文章页：阅读时长、目录 TOC（滚动高亮）、标题锚点、上下篇、相关推荐、代码复制、阅读进度条
- 自托管子集化字体（Manrope / Noto Sans SC / IBM Plex Mono，woff2）
- 主题三态（light / dark / system），暗色模式单独精调
- RSS 全文输出：`/rss.xml`（已剔除复制按钮等 UI 元素）
- SEO：canonical、Open Graph、Twitter Card、JSON-LD（WebSite / BlogPosting / ProfilePage）、sitemap、robots.txt

## 发布新文章

1. 在 `src/content/blog/` 新建 Markdown，例如 `my-new-post.md`
2. 填写 frontmatter：

```md
---
title: 文章标题
description: 一句话摘要
pubDate: 2026-08-01
tags: [Go, 后端]
featured: false
---

正文从这里开始……
```

3. `npm run build`（会自动更新字体子集，覆盖新文章用字）并部署：

```bash
npm run deploy
# 或手动：rsync -a --delete dist/ /var/www/byte-cloud/
# 如有需要可 reload nginx：nginx -t && systemctl reload nginx
```

## 目录说明

| 路径 | 作用 |
| --- | --- |
| `src/content/blog/` | 文章 Markdown（只改这里） |
| `src/lib/posts.ts` | 文章工具：排序、阅读时长、相邻/相关文 |
| `src/lib/rehype-*.ts` | Markdown 渲染增强（代码块/表格/标题锚点/图片尺寸、figure 与原图链接） |
| `src/pages/` | 路由页面（含 `rss.xml.js`、`404.astro`） |
| `src/components/` | UI 组件 |
| `src/styles/global.css` | 设计变量（字阶/色板/暗色）与全局样式 |
| `scripts/subset-fonts.mjs` | 字体子集化（prebuild 自动执行） |
| `scripts/optimize-images.mjs` | 原图与派生图优化（WASM，无原生依赖） |
| `scripts/sync-feishu-posts.py` | 飞书知识库 Markdown → 文章同步（配置见下节） |
| `scripts/feishu-posts.example.json` | 同步配置示例（真实 token 放 `feishu-posts.local.json`，已 gitignore，勿提交） |
| `public/fonts/`、`public/images/` | 子集化字体与优化图片产物 |
| `public/blog/`、`public/blog/_derived/` | 高清原图与优化后的展示图 |
| `dist/` | 构建产物（同步到 nginx root） |

## 飞书同步配置

`scripts/sync-feishu-posts.py` 的 node token 属于私有信息，不入库：

1. 复制 `scripts/feishu-posts.example.json` 为 `scripts/feishu-posts.local.json`
2. 填入真实的 `token`（飞书文档 node_token）与文章元数据
3. 运行：先抓取飞书文档 JSON 到 `/tmp/feishu-sync/<token>.json`，再执行 `python3 scripts/sync-feishu-posts.py`

## 在新服务器上部署

```bash
git clone https://github.com/celanwang/byte-cloud.git
cd byte-cloud
cp scripts/feishu-posts.example.json scripts/feishu-posts.local.json  # 如需飞书同步再填 token

# 方式一：本机 Node 20+（nvm use 即可）
npm ci && npm run build

# 方式二：本机 Node 过旧时（如 CentOS 7）用 Docker 构建
docker run --rm -v "$PWD":/app -w /app node:20-bookworm-slim npm ci
docker run --rm -v "$PWD":/app -w /app node:20-bookworm-slim npm run build
```

发布到 nginx（root 指向站点目录，如 `/var/www/byte-cloud`）：

```bash
rsync -a --delete dist/ /var/www/byte-cloud/
nginx -t && systemctl reload nginx
```

`scripts/deploy.sh` 封装了以上完整流程（Docker 构建 → 备份旧目录 → rsync → reload nginx），要求目标机能运行 docker 与 nginx。
