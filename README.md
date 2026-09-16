# dsh-novel-craft · 抽卡工作台

> English: a gacha-style taste-calibration workbench for
> [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).
> A batch of structurally different draft variants is laid out as continuous prose;
> the author only taps 👍 / 👎 on passages. The marks are then **compressed into reusable
> writing rules** — the raw quotes stay out of the model context. See [README.en.md](./README.en.md).

把一轮里「结构不同」的候选稿摊开，作者只点 👍好 / 👎坏；标注被压成**可复用的写作规律**
写进 `作者偏好档案.md`，驱动下一轮收敛。原文另存，**不进模型上下文**。

工作台是 dsh 的真插件：侧栏入口 + 全屏浮层，浏览器半区（界面）与宿主半区
（读写文件、回环 HTTP API）分离。

## 安装

```sh
dsh plugin --profile web add dsh-novel-craft          # 从 npm（若已发布）
dsh plugin --profile web add github:shiyan688/dsh-novel-craft   # 或直接从 GitHub
```

装完**重启一次该 profile**（bundle 与 client 元数据在进程内缓存）。重启后侧栏底部
出现「🎴 抽卡工作台」。

要求：dsh 的 web profile（`dsh-web-app`），并且**挂载了 LLM 服务**（`ctx.llm`）——
「提炼规律」那一步要调一次辅助模型。没挂也能用：标注照点，档案照编辑，只是不能自动提炼。

## 30 秒上手

1. 侧栏点「🎴 抽卡工作台」→ 顶栏「📁」挑候选稿目录（推荐/最近/浏览/手动四种入口）；
2. 读：连续正文，`j/k` 换段、`G` 标好、`B` 标坏、`空格` 取消、`n/p` 换篇；
3. 点「📋 偏好档案」→「⚗️ 提炼规律」→ 勾选采纳 → 档案里只留下规律。

## 用了什么

| 位置 | 做什么 |
|---|---|
| 侧栏底部「🎴 抽卡工作台」 | 开/关面板 |
| 顶栏「📁 …」 | **目录选择器**：推荐 / 最近使用 / 浏览 / 手动输入 |
| 「🎴 抽卡」页 | **连续正文阅读视图**：段落之间不打断，标记按钮只在光标/悬停的那段浮出；键盘流 `j/k` 换段、`G` 标好、`B` 标坏、`空格` 取消、`n/p` 换篇 |
| 「📋 偏好档案」页 | **只要规律**：规律清单 + 提炼审阅 + 标注统计 + 来源回跳 + 就地编辑；原文证据收在折叠区 |
| 底部「⚗️ 提炼规律」 | 标注原文 → 规律条目，勾选后写进 `<候选目录>/.dsh-novel-craft/作者偏好档案.md` |

标注落在 `<候选目录>/.dsh-novel-craft/marks.json`，**随作品走**，不写全局配置。
候选稿目录存在 dsh settings 的 `dsh-novel-craft` 命名空间里（`candidateDir`）。

## 交互上的几个刻意选择

- **阅读优先，不是表格**：候选稿按连续正文排版（字号 15.5 / 行高 1.95），标注状态用左侧 3px 色条 + 淡底色表达。
  大部分段落本来就不用标，所以标记按钮只在**光标所在段或鼠标悬停的那段**浮出，不抢注意力。
- **手不用离开键盘**：`j/k`（或 ↑↓）换段并把光标带进视野，`G`/`B` 标好/坏后自动前进，`空格` 取消，`n/p` 换篇。
  键盘标记是幂等的（不会把刚标好的又切掉）；输入框里打字时快捷键自动让位。
- **一眼知道读到哪**：底部状态条写「第 7 / 28 段」+ 快捷键；候选条给的是**短标签 + 字数 + 本篇标注数**，
  同批目录共有的前缀（`第9章-`）会被剥掉，所以是 `A · 1.2k字 · 标 3` 而不是一长串文件名。
- **规律可以一条一条否决**：每条规律后面有个 ✕，点了就删（自动块里的账目行不给删）。
- **提炼有等待感**：提炼按钮显示已用秒数。
- 第一次打开会给一句三段式引导，标过任何一段之后就不再出现。

## 三层产物：标注 / 证据摘录 / 规律档案

这是本插件的核心约定——**进模型上下文的只有规律**：

| 文件（都在 `<候选目录>/.dsh-novel-craft/`） | 给谁看 | 会不会进上下文 |
|---|---|---|
| `marks.json` | 工作台（机器可读的好/坏标注） | ❌ 永不 |
| `证据摘录.md` | 人回查 + 提炼的输入（**原文**） | ❌ 文件头就写着"不要读进写稿上下文" |
| `作者偏好档案.md` | **写稿会话只读这一份**（**只有规律**） | ✅ 就它 |

```
# 作者偏好档案
> 这里只放能复用的写作规律，不放原文摘录——写稿时读这一份就够。
> 原文证据在 `证据摘录.md`（给人回查、给提炼当输入），不要读进写稿上下文。

## 已验证偏好（作者喜欢什么）
- 危险场面只写结果落到谁身上，不写招式过程
- 用一句干巴巴的话接住重击，不铺排情绪

## 避免的写法（作者不喜欢什么）
- 别堆叠"宛如/像是"式的比喻
- 别让角色用解释性台词交代设定

<!-- dsh-novel-craft:auto:begin -->   ← 工作台维护的账目，每次提炼重写
- 标注：30 段（👍 15 / 👎 15），覆盖 3 篇
- 待提炼：0 段
- 最近提炼：2026-09-16 17:02 · deepseek-official/deepseek-v4-flash
<!-- dsh-novel-craft:auto:end -->
```

### 规律是怎么来的：一次便宜的辅助调用

1. 作者在「抽卡」页点好/坏 → 落 `marks.json`；
2. 「📄 更新证据摘录」把原文收进 `证据摘录.md`（也可由提炼自动触发）；
3. 「⚗️ 提炼规律」把**待提炼**的原文（默认最多 40 段、每段 240 字、总 20KB）
   交给**一次**辅助模型调用，系统提示强制它只输出 `+ 规律` / `- 禁忌`，禁止抄原文；
4. 结果**不直接进档案**，而是列出来让作者逐条勾选，「采纳选中」才写进规律区，
   并把提炼水位推到这批标注（下次不会再送一遍）。

- 用哪条模型路由：默认取 dsh 当前的默认模型；想指定便宜档位就在设置里填
  `dsh-novel-craft` 的 `distillProvider` / `distillModel`。
- 不想让任何模型碰原文？跳过第 3 步，把 `证据摘录.md` 交给你的 agent 也可以——
  反正进档案的只有规律。
- 没有规律区内容的档案会显示空态引导；作者手写的任何内容都会被完整渲染、不会被隐藏或覆盖。
- 自动块（begin / end 之间）每次提炼重写；规律区是作者的，**永远不动**。

## 宿主半区 HTTP API（回环限定）

全部在 `/novel-craft/api/` 下，只服务 `127.0.0.1`，`enabled: false` 时整体 503：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `state` | 候选稿段落 + 标注 + 规律档案 + 证据摘录情况 + 待提炼数 + 模型路由 |
| POST | `marks` | 存某篇某段的 好/坏/取消 |
| POST | `evidence` | 原文收录进「证据摘录.md」，档案只刷新自动块 |
| POST | `distill` | 待提炼原文 → 一次辅助模型调用 → 规律条目（待采纳） |
| POST | `rules` | 采纳规律写进档案（幂等），水位推到这批标注 |
| POST | `profile` | 保存界面上改过的档案正文 |
| GET | `evidence-text` | 读证据摘录正文（展开看原文时才拉） |
| GET | `discover` | 推荐目录（含篇数、相对路径；5 秒短缓存） |
| POST | `annotate` | 给一批目录回候选稿篇数，供浏览列表打徽标 |

## 改代码后怎么生效

- **浏览器半区 `lib/client.js`**：dsh 按请求现读文件下发（`cache-control: no-cache`），
  **刷新页面即生效**，不必重启。
- **宿主半区 `lib/index.js`**：在 dsh 启动时装载，**必须重启 dsh 才生效**。
  客户端对"宿主半区还没有新接口"做了降级：`discover` 拿到非 JSON（SPA 的 HTML）
  一律当空数组，推荐区显示"自己挑"，不会卡在转圈。

## 测试

都不需要浏览器、也不需要起 dsh：假 ctx 挂上真插件，真跑一遍。

```bash
npm test    # 或 node --run test：静态守卫 → 宿主接口 → 客户端真渲染
```

- `host-api.test.mjs`：把插件注册的路由放到真实回环端口上打，覆盖标注闭环、
  推荐目录、篇数徽标、档案三层产物、旧档案迁移、提炼链路（用假 LLM 验输入边界与
  输出解析）、未配置/停用等分支。
- `client-render.test.mjs`：借成对的 react / react-dom 把 `client.js` 的组件
  **真渲染成 HTML**，断言选择器四个入口、隐藏目录过滤、面包屑省略、档案面板各分支；
  纯逻辑（路径缩写、最近使用去重、discover 降级）走 `exports.__internals` 断言。
  档案面板用例是"真宿主生成档案 → 真渲染"，不是替身数据。

两个测试都**不依赖任何本机路径**：作品目录由 `test/fixtures.mjs` 临时造（含候选稿、
归档目录等），写操作全在临时目录里，跑完就删。找不到成对的 react 时渲染用例会打印
「跳过」并以 0 退出，不给别人一堆看不懂的红；`npm install` 装上 devDependencies
（或用 `DSH_REACT_ROOT=<含 react-dom 的目录>`）即可跑全。

## 目录结构

```
dsh-novel-craft-plugin/
├── package.json         # dsh.bundle.patch + dsh.client.platform=web（插件与 skill 的分水岭）
├── cordis.patch.yml     # 安装时把插件行插进 profile 组合
├── lib/index.js         # 宿主半区：settings + 回环 HTTP API + 提炼调用
├── lib/client.js        # 浏览器半区：★ 抽卡工作台本体
├── test/                # static-guard / host-api / client-render（都不依赖本机路径）
└── LICENSE, THIRD_PARTY_NOTICES.md
```

第三方来源与许可见 `THIRD_PARTY_NOTICES.md`（MIT）。
