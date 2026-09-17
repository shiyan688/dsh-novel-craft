# DEVELOPMENT.md — 给改这个仓库的人

> 面向贡献者与后续会话的工程说明。用户向的用法在 [README.md](./README.md)。
> 这份文件**不进 npm 包**（`package.json` 的 `files` 没列它），但它在 git 里。

---

## 它是什么，以及唯一不能破的规则

一个 dsh 插件：中文网文创作工作台。核心那一件事是**作者点好/坏 → 蒸馏成可复用的写作规律**。

**铁律：进写稿上下文的只有规律。** 原文（章节正文、标注原文、证据摘录、批注）不进写稿上下文；
只有三处**用户亲手点下的按钮**会触发一次辅助调用并带上原文，各自有硬上限，并且写在 README 里。
**任何新增的模型调用都要能在这张表里找到位置；找不到就是破了铁律。**

| 调用点 | 喂进去的原文 | 上限 |
|---|---|---|
| 提炼规律 `distill` | 被标注的段落 | ≤40 段 × 240 字，总 ≤20KB |
| 补齐来源 `rule-evidence?action=backfill` | 证据摘录里的引文 | 每条 160 字 |
| 批注微调 `revise` | **被批注的段落** + 前后段各 80 字 | 每段 800 字，单次 ≤20 条 |
| 阶段起草 `stage?action=generate` | 上游设定产物（不含正文） | 每份 ≤4000 字 |
| 开新章 `newchapter`（directions / draft） | 整个写作包（只含"上一章结尾"一处正文） | 结尾 ≤900 字 |
| `merge` / `finalize` / `check` / `workspace` | **零模型调用**（纯本地） | — |

模型调用只走 `lib/core/llm.js` 的 `callModel`（全仓唯一的 `llm.stream`）。它固定了：显式关掉
`reasoningEffort`（压缩/改写任务不需要思考链，否则推理会吃光输出预算、正文一个字都不剩）、
把结束原因带回来、不认推理档位的模型退一步重试。**别绕过它。**

---

## 架构

```
lib/index.js     宿主半区：settings 命名空间 + 23 条回环 HTTP 路由 + 模型调用编排
lib/client.js    浏览器半区：全屏浮层工作台（七个页签，无 JSX，全部 React.createElement）
lib/core/*.js    十个模块，彼此只共享 text.js —— 所以每个都能单独拿假数据写单测
```

`core/` 的依赖方向是单向的：`text.js` ← 其它所有。`workspace.js` 提供路径约定，
`pack.js` / `annotate.js` 依赖它；`ledger.js` / `plot.js` / `pipeline.js` **不依赖任何模块**（只吃调用方传进来的数据）。
新增模块请保持这个形状——环形依赖会让"单独跑一个模块的测试"这件事直接失效。

### 三层产物（改任何写文件的地方前先想清楚写的是哪一层）

| 文件 | 内容 | 谁读 |
|---|---|---|
| `marks.json` | 机器可读的好/坏标注 | 工作台 |
| `证据摘录.md` | 标注**原文** | 给人回查；只有点「提炼」/「补来源」时作为输入 |
| `作者偏好档案.md` | **只有规律**，一条原文都不放 | **写稿时只读这一份** |

---

## 改代码时的四条硬规矩

### 1. 加 `CraftWorkbench` 的 `useState` → 同步两个常量

`test/client-render.test.mjs` 与 `scripts/build-preview.mjs` 里各有一对 `WB_HEAD` / `WB_EXTRA`。
测试与预览把 useState 的初值**按 Hook 顺序排队**喂进去，这两个常量是唯一的补位点。
漏了会出现"看起来只是某个面板渲染错位"的诡异症状（实际是后续状态整体偏移）。

### 2. 新面板读宿主字段一律设防

`Array.isArray(...)` / `?.` / 默认值。宿主两条路由对同一种数据给不同形状，曾经让
`undefined.slice()` 在渲染期抛错、整个浮层被 React 卸载——用户看到的是"点某页签闪退"。
`test/workbench.test.mjs` 里有专门断言"两条路由的形状必须一致"，新增同类数据时请照着加。

### 3. 任何"读-改-写 .json 状态"都必须走 `core/text.js` 的 `updateJsonFile`

它做了两件事：整段进**串行队列**、临时文件 + `rename` **原子写**。
只把"写"排进队列是不够的——读还在队列外时，两个并发请求会读到同一份旧快照并互相覆盖
（实测：按住 `G` 连标 5 段只活 1 段）。半截 JSON 更危险：下次读取会 catch 成空对象，
再写一次就把整个文件清零。

### 4. 写文件路径里的用户输入必须校验

章号一律用 `chapterArg()`（1..10⁶）；文件名用 `draft.js` 的 `safeName()`。
`stage` 保存那条路径曾经漏了校验，`chapter=../../…` 可以写到作品目录之外。

---

## 跑测试与验证

```bash
npm install
npm test                       # 7 个文件，775 条断言，全绿才放行
node test/workbench.test.mjs   # 单跑某个文件
node scripts/build-preview.mjs # 重新生成 docs/preview.html（README 链接指向它）
node scripts/check-dsh-compat.mjs [版本|npm 标签] [--keep]
```

| 文件 | 管什么 |
|---|---|
| `static-guard.test.mjs` | 静态守卫：Hook 顺序（不许出现在提前 `return` 之后）、i18n 中英词条对齐、无调试输出 |
| `host-api.test.mjs` | 抽卡主线的宿主接口（标注闭环、推荐目录、三层产物、提炼链路，用假 LLM） |
| `client-render.test.mjs` | 用真 react 把组件渲成 HTML，断言各面板分支 |
| `workbench.test.mjs` | 0.2 的能力 + **发布前审查的回归**两节 + 面板按 props 渲染 |
| `ledger` / `plot` / `pipeline`.test.mjs | 账目体检 / 情节诊断 / 阶段门禁的纯函数单测 |

测试**不依赖任何本机路径**：作品目录由 `test/fixtures.mjs` 在临时目录里造，写操作全在临时目录，
跑完就删。找不到成对的 react/react-dom 时渲染用例会打印"跳过"并以 0 退出（或用 `DSH_REACT_ROOT` 指定）。

### 关于 dsh 版本兼容

`scripts/check-dsh-compat.mjs` 会真装一份指定版本的 dsh、用独立 `DSH_HOME` 起服务，
断言宿主路由 200 + 客户端半区能下发。

> **dsh ≥ 0.1.5 需要 Node 22**：用 Node 20 跑，`dsh web` 会**静默退出**（没有输出、端口也不监听），
> 看起来像"插件不兼容"。脚本会自己找 Node 22（`DSH_NODE` → PATH 里的 `node22` → 当前进程），
> 找不到就把启动失败判成"环境问题、跳过"而不是兼容性失败。

---

## 发布一次版本

1. 改代码 + `npm test` 全绿
2. 升 `package.json` 的 `version`；更新两个 README 与能力描述
3. `node scripts/build-preview.mjs` 重建界面快照
4. `node scripts/check-dsh-compat.mjs`（用 Node 22）
5. `npm pack --dry-run` **先看包里有什么**（`lib/` 与 `skills/` 必须在，`docs/`、`test/`、`scripts/` 不该在）
6. `npm publish` → `git tag -a vX.Y.Z` → push 分支与 tag → 建 GitHub Release
7. 若已经投过聚合列表：**把列表里的条目描述本身也更新掉**（合并的是那一行），再补一条更新评论

> 若 npm 卡住不动：这台机器上可能是 SOCKS 代理导致（`socks5h://…`，npm 不认）。
> 做法是把 `http_proxy/https_proxy/all_proxy`（大小写都算）临时摘掉，并指定一个可写的 `--cache`。

---

## 提交前自查

- [ ] `npm test` 全绿；改过客户端就顺手跑 `node scripts/build-preview.mjs`
- [ ] 新增模型调用？核对上面那张"六个调用点"表，并确认上限
- [ ] 新增状态文件读写？走 `updateJsonFile`
- [ ] 新增字段？面板侧设防；两条路由给同一数据时保持同形
- [ ] 用户可见文案：中英词条都要加（静态守卫会查）
- [ ] 测试里不许出现本机绝对路径
