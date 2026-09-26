# 红色警戒 · Red Alert Web

> 参照 [ts-redalert2](https://github.com/huangkaoya/ts-redalert2) 架构，从**原版红警2游戏文件**中提取真实素材，全新打造的网页版红色警戒。**单个 HTML 文件即可运行完整游戏**。

**[立即游玩](redalert2.html)** — 下载 `redalert2.html`（约 26MB），浏览器打开即可开战，无需安装、无需联网。

![screenshot](docs/screenshot_battle.png)

## 本次完全重构（v3）

上一版本 bug 频发无法游玩，本次以 [ts-redalert2](https://github.com/huangkaoya/ts-redalert2)（Chronodivide 架构的 TS 重写版）为参照**从零重写**：

### 素材来源：真实原版游戏文件
- 从 `download.ra2web.com/full-pack.7z`（原版红警2中文完整安装包）解出 `RA2.MIX`（282MB）
- 参照 ts-redalert2 的 `MixFile`/`Blowfish` 解密器解析嵌套 MIX 档案（Bun + three.js stub 离线运行）
- **NewTheater 命名规律**破解：建筑名第二字符为剧场占位符（`g`=通用 / `t`=温带），据此定位全部建筑图形

### 原版素材清单（834 张精灵全部离线提取）
| 类别 | 来源 | 数量 |
|---|---|---|
| 建筑 | `generic.mix` (gg\*/ng\*) + 剧场包 | 27 座（盟军/苏军全套） |
| 建造动画 | `*mk.shp` 序列帧 | 19 组 |
| 载具 | `local.mix` VXL 体素（引擎式旋转光栅化 32 朝向 + 独立炮塔） | 14 种 + 8 炮塔 |
| 步兵 | `conquer.mix` SHP（8 向站立/行走） | 14 种 |
| 地形 | `isotemp.mix` TMP 瓦片（60×30 菱形扫描序） | 523 张 |
| 矿石/宝石/树林 | `temperat.mix` overlay | 91 |
| 动画 | 爆炸/火焰/核弹/电弧/碎片 | 25 组 |
| 侧边栏图标 | `cameo.mix` | 45 |
| 原声音乐 | Frank Klepacki 原版 OST（Hell March 等） | 5 首 |
| EVA 语音 | `LANGUAGE.MIX` 语音包（ASR 逐一识别命名） | 19 条 |

### 原版数值
- `rules.ini` 直读：血量/造价/电力/速度/伤害/射程/科技树/弹头装甲修正全部采用原版数据
- `ra2.csf` 官方中文字符串：犀牛坦克、磁爆線圈、基洛夫空艇……全部原版命名

### 引擎特性（全面重写，强化稳定性）
- 固定 30fps 逻辑步 + rAF 渲染分离（杜绝时间累积错乱）
- A\* 寻路（二叉堆 + 视线平滑 + 全图连通性保证）
- 采矿经济闭环：寻矿 → 采集 → 回精炼厂卸矿 → 矿石再生
- 电力系统：低电力减速生产、雷达失效
- 战斗：弹道/即时光束（磁暴电弧、光棱）、范围杀伤、受击自动反击
- 超武：核弹（弹道+蘑菇云+范围伤害）、超时空传送、闪电风暴
- AI 指挥官：建造序列 → 采矿 → 出兵 → 攻击波次（三档难度）
- 战争迷雾 + 雷达小地图（地形/单位实时渲染）
- 框选 / 右键取消 / 攻击移动 / 维修 / 出售
- 合成音效（炮击/爆炸/磁暴）+ WebAudio 混音

## 快速开始

```bash
# 方式一：直接下载单文件
open redalert2.html        # macOS
start redalert2.html       # Windows

# 方式二：本地起服务
python3 -m http.server 8000
# 浏览器访问 http://localhost:8000/redalert2.html
```

**操作**：左键选择/建造 · 右键取消/停止 · 框选多单位 · `H` 回基地 · `S` 停止 · 方向键/屏幕边缘滚动 · 滚轮缩放

## 从源码构建

```bash
# 依赖: Bun 1.3+
bun run src/scripts/extract_sprites.ts    # MIX → PNG（需先准备 ra2assets）
bun run src/scripts/render_voxels.ts      # VXL 体素 → 32 向精灵
bun run src/scripts/parse_rules.ts        # rules.ini → game_data.json
bun run src/scripts/build_game.ts         # 打包单 HTML
```

素材准备：下载 [full-pack.7z](https://download.ra2web.com/full-pack.7z)（红警2完整安装包），解出 `RA2.MIX` / `LANGUAGE.MIX` / `THEME.MIX` 放入 `ra2assets/`，再运行 `src/scripts/extract_entry.ts` 提取嵌套档案。

## 项目结构

```
├── redalert2.html      # 单文件成品（全部素材 base64 内嵌）
├── src/
│   ├── game_src/       # 引擎源码（9 个模块）
│   │   ├── 01_core.js      # 常量/资源/音频
│   │   ├── 02_map.js       # 地图生成（温带剧场）
│   │   ├── 03_entities.js  # 建筑/单位/弹道
│   │   ├── 04_game.js      # 战斗/经济/电力/迷雾
│   │   ├── 05_ai.js        # 敌方指挥官 AI
│   │   ├── 06_render.js    # 等距渲染器
│   │   ├── 07_ui.js        # 侧边栏/输入
│   │   └── 08_main.js      # 标题/循环/结算
│   └── scripts/        # 素材提取与构建脚本
└── docs/
```

## 已验证流程

标题选阵营/难度 → 开局 → 建造（电力/矿场/兵营/战车工厂/雷达/磁爆线圈）→ 采矿经济 → 生产犀牛/动员兵 → AI 攻击波 → 反击战 → 核弹 → 胜利/失败结算 —— 全程浏览器自动化 E2E + 视觉审查通过，控制台零报错。

## 免责声明

本项目仅供学习研究。红色警戒（Red Alert）是 Electronic Arts 的注册商标，所有游戏素材版权归 EA / Westwood Studios 所有。请支持正版游戏。

## License

GPL-3.0（与参照项目一致）
