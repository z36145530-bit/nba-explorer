# NBA Explorer · NBA 赛程与球员数据查询站

一个可本地运行、也已部署到 GitHub Pages 的 NBA 数据站：按赛季 / 日期 / 球队检索比赛，查看单场技术统计、球员生涯数据、逐场日志、投篮热区与球员对比。

- 纯 Python 标准库：无需安装任何第三方包
- 原始 HTML / CSS / JS 前端，无需构建工具
- 数据来源：ESPN 公开接口 + FiveThirtyEight 历史赛果
- 已预取 **1990-91 赛季至今（1991–2027）全部赛季**，约 4.7 万场比赛、数千名球员

## 在线访问

<https://z36145530-bit.github.io/nba-explorer/>

纯静态版：前端直接读取仓库中的 JSON，并按需调用 ESPN 公开接口补全技术统计 / 球员生涯 / 投篮坐标，因此**不需要后端、不需要 API Key**。

## 本地运行

```powershell
cd nba-site
python server.py --port 8600
```

打开 <http://127.0.0.1:8600>。Windows 也可以双击 `start.bat`。

> 若系统没有 `python` 命令，可用完整路径：
> `C:\Users\24031\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe server.py`

本地版带磁盘缓存，ESPN 请求会落到 `data/cache/`，断网也能浏览已缓存内容。

## 页面与功能

| 页面 | 内容 |
| --- | --- |
| 总览 | 当前赛季概览、最近赛果、得分榜、东西部排名 |
| 赛程赛果 | 按赛季、日期、球队筛选；支持 `#/games?season=1991` 深链；点击任意比赛查看单场技术统计 |
| 比赛详情 | 双方 box score（MIN/PTS/FG/3PT/FT/REB/AST/TO/STL/BLK/OREB/DREB/PF/+/-）、球队数据对比、跳转投篮热区 |
| 球员数据 | 按球队、位置筛选，按场均得分/篮板/助攻/抢断/盖帽/失误/两双排序 |
| 球员主页 | 生涯逐赛季数据、本赛季场均、近期比赛日志、点击赛季切换 |
| 球队 / 球队主页 | 30 支球队、赛季战绩与阵容 |
| 数据榜 | 8 个维度的联盟榜单 |
| 球员对比 | 最多 4 人，8 项指标雷达图 |
| 赛程日历 | 按月网格查看整季赛程，点击进入比赛 |
| 投篮热区 | 单场回合级出手坐标，散点 / 热区两种模式，按球队、球员、命中与否筛选 |

## 数据范围与来源

`data/` 下按赛季分文件：

- `1990-91`（1991）至 `1994-95`（1995）：比赛结果来自 FiveThirtyEight `nbaallelo.csv`，**仅含比分与胜负**，无逐场技术统计
- `1995-96`（1996）至今：ESPN 公开接口，含比赛结果、单场 box score、球员赛季数据、投篮坐标
- `1998-99` 为停摆赛季（792 场），属正常现象
- `standings-YYYY.json`：东西部排名；`teams.json`：30 支球队与队标

> 赛季 `year` 表示赛季结束年份：`year=2026` 即 2025-26 赛季。

## 更新数据

```powershell
cd nba-site

# 1) ESPN 覆盖的赛季（1996 及以后），可一次给多个年份或范围
python prefetch.py 1996-2027

# 2) 1991-1995 历史赛果（FiveThirtyEight）
python prefetch_538.py

# 3) 重建 meta.json
python rebuild_meta.py

# 4) 生成静态站点 docs/
python build_static.py

# 5) 发布到 GitHub Pages（需要仓库写权限的 token）
$env:GH_TOKEN = "ghp_xxx"
python deploy_pages.py
```

`prefetch.py` 会按天缓存 ESPN 响应到 `data/cache/games/`，支持中断后重跑续传。

## 目录结构

```
nba-site/
├─ server.py            # 本地服务：静态站 + /api 数据接口 + ESPN 代理与缓存
├─ prefetch.py          # 预取赛季赛程 / 排名 / 球员数据（ESPN）
├─ prefetch_538.py      # 生成 1991-1995 赛果（FiveThirtyEight）
├─ rebuild_meta.py      # 重建 data/meta.json
├─ build_static.py      # 生成 GitHub Pages 用的 docs/（含 search-index）
├─ deploy_pages.py      # 通过 GitHub API 上传 docs/ 并启用 Pages
├─ start.bat            # Windows 一键启动
├─ data/                # 各赛季 JSON 数据（serve 与 docs 共用）
│  ├─ teams.json
│  ├─ games-YYYY.json
│  ├─ players-YYYY.json
│  ├─ standings-YYYY.json
│  ├─ search-index.json
│  ├─ meta.json
│  └─ cache/            # ESPN 原始响应缓存，可删
├─ static/              # 前端源码
│  ├─ index.html
│  ├─ app.js
│  ├─ api-static.js     # 纯静态版的数据层（docs 中被 index.html 引用）
│  └─ styles.css
└─ docs/                # build_static.py 生成，GitHub Pages 发布目录
```

## 已知限制

- 1995-96 以前的赛季只有比分，比赛详情页会提示“暂无本场技术统计”
- 部分老赛季的球员名单 / 球员头像不完整，属 ESPN 数据缺失
- 球队历史缩写已做映射（NJN→BKN、SEA→OKC、CHH→CHA、VAN→MEM、NOH→NOP、WSB→WAS、KCK→SAC、SDC/BUF→LAC），因此老比赛按现用队标展示
- 纯静态版依赖浏览器直连 ESPN；接口变动或网络受限时，比赛详情可能降级为“仅比分”
