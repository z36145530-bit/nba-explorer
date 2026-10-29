# NBA Explorer · NBA 赛程与球员数据查询站

一个可本地运行、也已部署到 GitHub Pages 的 NBA 数据站：按赛季 / 日期 / 球队 / 轮次检索比赛，查看单场技术统计、球员生涯数据、逐场日志、投篮热区、球员对比、季后赛对阵图，并可跳转查看该场比赛的相关报道。

- 纯 Python 标准库后端 + 原生 HTML / CSS / JS 前端，无需安装第三方包
- 数据来源：ESPN 公开接口 + FiveThirtyEight 历史赛果（1991–1995）
- 已预取 **1990-91 赛季至今（1991–2027）全部赛季**，约 4.7 万场比赛
- 中英双语界面（球队、位置、栏目均为「中文 English」）

## 在线访问

<https://z36145530-bit.github.io/nba-explorer/>

纯静态版：前端直接读取仓库中的 JSON，并按需调用 ESPN 公开接口补全技术统计 / 球员生涯 / 投篮坐标 / 赛后战报，因此**不需要后端、不需要 API Key**。

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
| 总览 Overview | 当前赛季概览、最近赛果、得分榜、东西部排名 |
| 赛程赛果 Schedule & Results | 常规赛 / 季后赛 / 对阵图三个页签；按赛季、日期、球队筛选；支持 `#/games?season=1991` 深链 |
| 比赛详情 Box Score | 双方 player box score（MIN/PTS/FG/3PT/FT/REB/AST/TO/STL/BLK/OREB/DREB/PF/+/-）、球队数据对比、投篮热区入口、**相关报道**（ESPN 战报 + 腾讯体育 / 虎扑 / 贴吧 / 百度 / Google 搜索） |
| 球员数据 Players | 按球队、位置筛选，按任意数据排序；1991 年起每季球员均可查询 |
| 球员主页 Player | 生涯逐赛季数据、本赛季场均、近期比赛日志、点击赛季切换 |
| 球队 / 球队主页 Teams | 30 支球队、赛季战绩与阵容 |
| 数据榜 Leaders | 8 个维度的联盟榜单 |
| 球员对比 Compare | 最多 4 人，8 项指标雷达图 |
| 赛程日历 Calendar | 按月网格查看整季赛程，点击进入比赛 |
| 对阵图 Bracket | 按 1-8 / 4-5 / 3-6 / 2-7 种子对位与胜负自动重建东西部 + 总决赛；点击任一系列赛进入最后一场比赛 |
| 投篮热区 Shot Chart | 单场回合级出手坐标，散点 / 热区两种模式，按球队、球员、命中与否筛选 |

## 数据范围与来源

| 数据 | 范围 | 来源 |
| --- | --- | --- |
| 比赛结果（比分、日期、球队） | 1990-91 ～ 2026-27 | ESPN（1996 起）+ FiveThirtyEight `nbaallelo.csv`（1991–1995） |
| 单场技术统计 box score | 1996-97 ～ | ESPN summary |
| 球员赛季数据 | 1990-91 ～（`isqualified=false` 全量） | ESPN `statistics/byathlete` |
| 球员生涯 / 逐场日志 | 现役及历史球员 | ESPN athlete / gamelog |
| 投篮坐标 | 有回合数据的比赛（1996-97 ～） | ESPN summary plays |
| 赛后战报 | 部分比赛 | ESPN summary article |

说明：1996 年以前只有比分，没有逐场技术统计；对阵图在早期赛季同样按种子与胜负重建（首轮 1984–2003 为五局三胜）。

## 目录结构

```
nba-site/
  server.py              # 本地后端（可选，纯标准库）
  prefetch.py            # 抓取 ESPN 赛程 / 排名 / 球员
  prefetch_538.py        # 生成 1991–1995 比赛结果
  prefetch_players.py    # 补抓早期赛季球员数据
  rebuild_meta.py        # 重建 data/meta.json
  build_static.py        # 生成 docs/ 纯静态站点
  deploy_pages.py        # 首次部署到 GitHub Pages
  deploy_pages_fast.py   # Git Data API 单次提交
  push_one.py            # 单文件推送（Contents API）
  static/                # 前端源码（index.html / app.js / styles.css / api-static.js）
  data/                  # 赛季 JSON、球员 JSON、缓存
  docs/                  # 构建产物（GitHub Pages 根目录）
```

## 数据更新

```powershell
python prefetch.py 2026-2027     # 抓取指定赛季（可写范围，如 1996-2027）
python prefetch_players.py 1991-1995
python rebuild_meta.py           # 重建 meta.json
python build_static.py           # 生成 docs/
python deploy_pages_fast.py      # 部署（需 GITHUB_TOKEN）
```

## 已知限制

- 1996 年以前的比赛没有技术统计，详情页会提示「1996 年以前仅收录比赛结果」。
- 单场 box score、球员生涯、投篮坐标、战报为浏览器实时请求 ESPN，需要联网。
- 部分历史比赛 ESPN 没有战报，此时只提供外部搜索链接。
- 国内网络访问 ESPN 接口可能较慢或被拦截；可在本地后端代理模式下使用。

## 部署说明

已使用 GitHub Pages（仓库 `z36145530-bit/nba-explorer` 的 `docs/` 目录）。若需部署到你自己的账号：

1. 新建仓库，把 `docs/` 推到 `main`；
2. Settings → Pages → Source 选 `Deploy from a branch`，分支 `main`、目录 `/docs`；
3. 等待 1–2 分钟即可访问 `https://<用户名>.github.io/<仓库名>/`。

也可以直接 `docker build -t nba-explorer . && docker run -p 8080:8080 nba-explorer` 跑本地后端版。

## v4（2026-10-29）

- 球员姓名中英双语：data/player-name-zh.json（431 位常见/历史球员），前端按英文名归一化匹配；未收录的冷门球员保留英文名
- 年度荣誉榜 #/honors：1990-91 至 2025-26 共 36 个赛季，含 MVP、DPOY、ROY、6MOY、MIP、FMVP、全明星 MVP、最佳队友、最佳阵容、最佳防守阵容、最佳新秀阵容
- 球员主页新增「荣誉 Honors」区块，汇总该球员生涯所有获奖记录
- 荣誉数据来自 ESPN Core API：/seasons/{year}/awards（奖项）+ 每位获奖者的 athlete 详情（姓名/球队）
