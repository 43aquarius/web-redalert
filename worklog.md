# Worklog - web-redalert 项目

---
Task ID: 1
Agent: 主Agent (Super Z)
Task: 在 Web 上极致还原《红色警戒》(Red Alert 1)，使用原版音乐/音频素材，推送至 github.com/43aquarius/web-redalert

Work Log:
- 网络搜寻原版素材: GitHub 代码搜索 + archive.org 节点直连
  - fbunau/openpeon-red-alert-1-eva → 47条 RA1 EVA 语音 WAV
  - mgmobrien/red-alert-sounds → 164 条单位语音/死亡音/特殊语音
  - ravidorr/cnc-red-alert-soundboard → 199 个战斗/系统音效 WAV
  - archive.org/red_alert_soundtrack-1996 → 14 首完整原版 OST MP3 (Frank Klepacki)
  - 素材整理为 public/audio/{music,eva,voices,sfx} 共 196 文件 117MB
- 游戏引擎 (Next.js 16 + TypeScript + Canvas 2D, 零框架依赖):
  - data.ts: RA1 风格数值表 (16建筑/20单位/19武器/伤害矩阵)
  - sprites_*.ts: 程序化等距精灵 (8朝向坦克+独立炮塔/8向2帧步兵/建筑细节/雷达碟/建造图标/动画光标)
  - map.ts: 96x96 战场生成 (湖泊/矿区/宝石/树林/迷雾), ore grow/canPlace/scorch
  - entities.ts: Unit/Building 状态机 (移动/攻击/attackMove/采矿6态/占领/维修/医疗/猛犸自愈)
  - pathfind.ts: A*+二叉堆+视线平滑; fx.ts: 弹道/爆炸/特斯拉闪电/蘑菇云/核闪
  - ai.ts: 敌方指挥官 (建造序列/防御配额/进攻波次/核弹); 三档难度
  - sidebar.ts: RA经典侧边栏 (信用点LED滚动/电力条/雷达小地图/四标签建造栏/进度conic/READY闪烁/维修出售)
  - game.ts: 主循环30fps逻辑/生产队列/伤害结算/胜负; render.ts: 等距渲染器
  - title.ts: 标题画面/打字机简报/结算画面; GameShell.tsx: React流程编排+暂停菜单
- 浏览器实测 (agent-browser + VLM 视觉审查) 修复的关键 Bug:
  1. TILE_W 导入错误 (编译失败)
  2. 矿区贴脸基地+矿石疯长堵死建造 → 矿区移远+净空区+生长避开建筑
  3. AI 把建筑盖在精炼厂卸矿泊位 → 泊位保护+备用停靠位+自愈
  4. 采矿车不自动寻矿/满载不回厂 → updateIdle 采矿分支
  5. posVol 引用不存在的 game.camX → NaN 音量报错 1000+ 次
  6. 语音表引用 14 个不存在文件 → 全部校验修正 (scripts/verify_audio.js)
  7. 核弹飞行不可见 → 来袭导弹渲染+警示环; 核弹威力 900→4000
  8. 核弹充能速度错误 (12分钟) → 修正为6分钟
- 全链路验证通过: 标题→简报→建造→放置→战斗→采矿经济→AI进攻波→核弹→胜利/失败结算→再战一局; lint 0 错误; 页面 0 错误

Stage Summary:
- 产出: 完整可玩的 RA1 Web 复刻 (苏军/盟军双阵营、核弹、AI、原版全套音频)
- 验证: agent-browser E2E + VLM 截图审查 + 回归脚本 scripts/regression_test.sh
- 待办: 推送 GitHub → 43aquarius/web-redalert

---
Task ID: 2
Agent: 主Agent (Super Z)
Task: 推送代码至 GitHub 并完成收尾

Work Log:
- git 历史清理: 发现脚手架 Initial commit 携带 .env 与 download/README.md
  → git rm --cached + orphan 分支重建单次干净提交 + force push
- 推送 github.com/43aquarius/web-redalert (main, 单commit, 297文件, ~119MB)
- 远程验证: 根目录干净 (无 .env/download), README/LICENSE/源码/音频齐全
- 推送后清理 remote URL 中的 token
- 最终验证: 游戏运行正常(entities=10), 页面错误数 0, lint 0 错误

Stage Summary:
- 交付: https://github.com/43aquarius/web-redalert 完整可玩的红警Web复刻
- 仓库结构: src/game 引擎源码 + public/audio 原版素材 + scripts 工具脚本 + README/LICENSE

---
Task ID: 3
Agent: 主Agent (Super Z)
Task: 素材完全原版化 + 细节优化 + 彻底bug检查 (用户反馈: 素材不够还原/优化细节/检查bug)

Work Log:
- 素材获取 (archive.org 主站宕机, 走节点直连):
  - 发现 red-alert-counterstrike (CS光盘) → MAIN.MIX (236MB) 解密成功
  - 实现 MIX 加密头破解: RSA公钥(0x10001)→Blowfish密钥→索引解密 (mixlib.py)
  - 解出 conquer.mix (230文件: 全部车辆/建筑/特效SHp) / temperat.mix (331文件: 地形模板)
  - 原版调色板 temperat.pal 从 ZgblKylin/RA2 仓库 LFS 获取
- 格式解析器 (全部自研 Python):
  - shplib.py: SHP (LCW/XOR-delta 解压, 0x20/0x40/0x80 格式)
  - tmplib.py: TMP-RA 地形模板 (24x24瓦片 + 索引区)
  - iso_extract.py: Mode2 CD 扇区解析
  - build_atlas.py: 调色板队伍色重映射(80-95) + 图集打包 + JSON manifest
- 引擎改造:
  - 等距投影 → 原版 24px 方块网格 (toScreen/screenToWorld/相机/边缘滚动)
  - 车辆/炮塔升级 32 朝向 (RA 原版), 步兵 8 向
  - 地形分块缓存 (FNV哈希增量失效) + 调色板轮转水面动画(4帧) + 14种海岸过渡
  - 原版特效: 爆炸(fball/artexp/vehhit)/火焰/核弹atomsfx/moveflsh移动闪烁
  - 建筑: 建造渐显/工厂动画/受损状态/炮塔32向/agun炮塔/围墙
  - 侧边栏图标: 原版精灵渲染
  - 新增建筑: 火焰塔(苏)/碉堡(盟) + AI 使用
- Bug 修复 (用户要求的彻底检查):
  1. 采矿交付 Math.min(cap, credits+amount) 会抹掉超额资金 → 只增不减
  2. gotoRefineryExternal 方法不存在 (点击精炼厂报错) → 公开 gotoRefinery
  3. sprites_buildings default 分支引用未定义 bc → 修复
  4. 鼠标初始(0,0)触发边缘滚动 → 屏外初始化
  5. 缺失的镜头滚动功能 → 方向键/WASD/边缘滚动 + 相机边界钳制
  6. 矿仓提示误报刷屏 → 条件收紧
  7. title.ts 类型错误群 → 修复
  8. flame 音效引用不存在的 firebl3 → flame-1
  9. creditCap 基础 500 过低 + 精炼厂无储量 → 2000/4000
- 验证: tsc 0错误 / eslint 0错误 / 60fps 满帧 / E2E全流程(标题→简报→建造→生产→放置→采矿经济→战斗→防御→核弹→胜利→结算) 浏览器0报错 / VLM视觉审查: 地形/建筑/坦克/水面/矿石/树木/防御/核爆 全部通过

Stage Summary:
- 原版图形素材管线完整建立: MIX→SHP/TMP→PNG图集 (2.7MB, 含队伍色变体)
- 渲染器全面原版化: 方块网格+原版精灵+地形动画
- 步兵精灵暂缺 (本体RA.MIX所在archive.org节点宕机, 管线已就绪: data.ts 加 spriteKey 即可接入)
- 待: 推送 GitHub

---
Task ID: 4
Agent: 主Agent (Super Z)
Task: RA2 原版素材管线重建 (参照 ra2web.nipao.com)

Work Log:
- 参照站源码克隆 (research/ra2src): Vite+Three.js RA2 引擎, 全套格式解析器
- CDN 素材 22 个 mix 下载齐 (vxl/anims/snow/isotemp/temperat/comeo/ui/sounds/eva-ally/eva-sov/ini/strings...)
- 格式解析器完善 (scripts/): mix2.py(TS MIX+CRC hash) ra2lib.py(SHP/VXL/HVA/TMP/CSF/PAL) vxlrender.py(RA2相机α30°β45°投影+HVA+z-buffer splat超采样)
- CSF 中文修复: vlen是字符数非字节数(原解析截断一半) → 原版简中全量字符串 (4480条)
- rules.ini/art.ini/eva.ini/sound.ini/theme.ini 解析 → rules_data.json (45步兵/55载具/8飞机/296建筑/178武器/71弹头+1300素材映射)
- 音频提取: audio.idx+bag 1153条音效(裸IMA ADPCM→构造WAV头→ffmpeg OGG 48k), EVA 222条(ceva/csof), THEME.MIX损坏(全零, ra2web full-pack源头问题)
- VXL 单位图集: 17载具×32朝向(+炮塔9种)×5队色, z-buffer+splat覆盖+2x超采样 → Production-Ready (VLM审查通过)
- 步兵 SHP: 13单位 stand/walk48/fire/die 帧序列(art.ini Sequence解析)
- 建筑 SHP: 24建筑(剧场通用,在snow.mix, isotope调色板; Tesla/Prism用unittem)
- 地形: 191 tiles (clear/water14/shore42/cliff42/ramp10/pave/LAT) 60x30 iso
- Cameo 28个 + 矿石/宝石/围墙 overlay 27个 (temperat.pal)
- 音乐获取失败记录: THEME.MIX损坏×2处, archive.org主站+节点不可达, YouTube需登录(bot检测,cookies无效), Invidious/Piped全挂, SoundCloud不通

Stage Summary:
- assets_ra2/ 完整图形+音频素材就绪 (~26MB): 图集+manifest 全部 VLM 审查通过
- 待: 单HTML引擎重写 → E2E测试 → 推送GitHub
