# NBA Explorer · NBA 赛事与球员数据查询站

一个可本地运行的 NBA 数据网站：按赛季 / 日期 / 球队检索比赛记录与单场技术统计，查看球员生涯赛季数据、逐场日志、球队战绩与阵容。

- 纯 Python 标准库后端（无需安装任何依赖）+ 原生 HTML/CSS/JS 前端
- 数据来自 ESPN 公开接口（无需 API Key）
- 已预取 **3 个完整赛季、4,199 场比赛、约 1,700 名球员** 的赛季数据
- 未预取的日期/比赛会实时从 ESPN 抓取（有本地缓存）

## 快速开始

```powershell
cd nba-site
python server.py --port 8600
```

浏览器打开 <http://127.0.0.1:8600>。

Windows 下也可以直接双击 `start.bat`（自动打开浏览器）。

> 若本机没有 `python` 命令，可用完整解释器路径：
> `C:\Users\24031\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe server.py`

## 功能

| 页面 | 能力 |
| --- | --- |
| 总览 | 赛季概览、最近赛果、得分榜、东西部排名 |
| 赛程赛果 | 按日期、球队筛选；任意日期可查（本地没有的日期实时请求 ESPN）；点击进入单场 |
| 比赛详情 | 双方球员完整数据表（MIN/PTS/FG/3PT/FT/REB/AST/TO/STL/BLK/OREB/DREB/PF/+/-）、球队数据对比、场地与日期 |
| 球员数据 | 按球队、位置筛选，按得分/篮板/助攻/抢断/盖帽/命中率/两双排序，姓名搜索 |
| 球员主页 | 生涯赛季场均数据（可点击切换赛季）、本赛季场均卡片、近期逐场日志 |
| 球队 | 30 队卡片、分区战绩 |
| 球队主页 | 战绩、场均得失分、主客场、赛季全部赛程、赛季阵容 |
| 数据榜 | 8 个维度的联盟榜单 |

## 数据范围与更新

当前 `data/` 内置：

- `2023-24`：1,395 场（常规赛 + 季后赛），562 名球员
- `2024-25`：1,403 场，560 名球员
- `2025-26`：1,401 场，578 名球员
- 30 支球队、三个赛季的东西部排名

新增/刷新赛季：

```powershell
# 抓取某个赛季（赛季年份用结束年份，如 2026 表示 2025-26）
python prefetch.py 2026

# 同时抓多个赛季
python prefetch.py 2026 2025 2024 2023

# 只重建索引/补队标（有按天缓存，很快）
python prefetch.py 2026 2025
```

`prefetch.py` 会按天请求 ESPN 记分牌，缓存在 `data/cache/games/`，支持断点续跑：中断后重新执行即可。

## 目录结构

```
nba-site/
├─ server.py            # 本地服务：静态站点 + /api 数据接口 + ESPN 代理缓存
├─ prefetch.py          # 数据预取：球队/排名/赛程/球员赛季数据
├─ start.bat            # Windows 一键启动
├─ data/
│  ├─ teams.json        # 30 队（含队标、主色）
│  ├─ games-YYYY.json   # 赛季全部比赛（含比分、胜负、主客、场地、状态）
│  ├─ players-YYYY.json # 赛季球员场均数据
│  ├─ standings-YYYY.json
│  ├─ meta.json         # 赛季清单与数据更新时间
│  └─ cache/            # ESPN 原始响应缓存（可删除，删后自动重新请求）
└─ static/
   ├─ index.html
   ├─ app.js            # 前端路由与全部页面渲染
   └─ styles.css
```

## 主要接口

| 接口 | 说明 |
| --- | --- |
| `/api/meta` | 赛季清单、比赛/球员数量 |
| `/api/teams` | 30 支球队 |
| `/api/standings?season=2026` | 东西部排名 |
| `/api/games?season=2026&date=2026-04-13&team=GS` | 比赛列表（支持日期/球队过滤、倒序、限量） |
| `/api/game?id=401859967` | 单场详情 + box score（本地没有的比赛实时抓取） |
| `/api/players?season=2026&sort=avgPoints&limit=60&offset=0&pos=G&team=GS&q=curry` | 球员赛季数据（排序/筛选/分页） |
| `/api/leaders?season=2026&stat=avgPoints` | 榜单 |
| `/api/player?id=3975&season=2026` | 球员简介 + 生涯赛季数据 |
| `/api/gamelog?id=3975&season=2026` | 球员逐场日志 |
| `/api/roster?team=9&season=2026` | 赛季阵容 |
| `/api/search?q=curry` | 球员搜索 |

接口均返回 JSON，可单独用于做数据可视化或二次开发。

## 说明与限制

- 数据源为 ESPN 公开接口，仅供学习研究；请求带本地缓存（记分牌 120s、球员/排名 10–60min、单场 10min、阵容 30min）。
- 球员列表按“有出场数据的合格球员”统计，因此赛季阵容人数会略少于 15 人满编。
- 更早赛季（如 2010 年代）未预取，但赛程页按日期查询可实时拉取；若想离线全量可自行 `python prefetch.py 2019 2018 ...`。
- 无网络时：已预取的三个赛季的赛程、球员、排名可正常浏览；单场 box score 与更早日期需要联网。

## 新增模块（v2）

- **球员对比** `#/compare`：最多 4 人同屏，雷达图（8 项指标在联盟中的相对水平）+ 赛季数据表；输入球员名回车即可添加。
- **赛程日历** `#/calendar`：按月查看整季赛程/赛果，日期格子显示比分与胜者，点击进入当日比赛列表。
- **投篮热区** `#/shots?game=<比赛ID>`：单场逐回合投篮坐标，可切换散点/热区、球队、命中/未中、球员；比赛详情页右上角有入口。
  数据来自 ESPN summary 的 plays（`shootingPlay` + `coordinate`，单位为英尺，坐标原点在底线中点）。

## 部署上线

项目已经带好部署配置，**三种方式任选**：

### 方式 A：Render（免费，推荐，自带 HTTPS）

1. 把 `nba-site/` 推到 GitHub 仓库；
2. 打开 <https://dashboard.render.com> → **New → Blueprint**，选择该仓库（会自动读取 `render.yaml`）；
3. 确认创建即可，几分钟后得到 `https://<name>.onrender.com`。

> 免费实例会休眠，首次访问需等 30–60 秒唤醒；数据更新可在 Render 控制台点 **Manual Deploy**。

### 方式 B：任意云服务器 / 本机 Docker

```bash
docker build -t nba-explorer .
docker run -d -p 8080:8080 --name nba-explorer nba-explorer
# 访问 http://<服务器IP>:8080
```

`Dockerfile` 已内置健康检查；`PORT`、`HOST` 均可用环境变量覆盖。

### 方式 C：局域网展示（答辩/组会临时用）

```powershell
python server.py --host 0.0.0.0 --port 8600
```

同一局域网设备访问 `http://<本机IP>:8600`；Windows 首次运行需在防火墙提示中允许 Python 访问专用网络。

> 说明：站点不是纯静态页面——比赛详情、更早日期、投篮坐标都通过后端实时代理 ESPN，所以必须用 `server.py` 或容器运行，不能只把 `static/` 传到静态托管。
