/**
 * 生成界面静态预览 docs/preview.html。
 *
 * 用**真实组件**渲染（不是手画的示意图）：加载 lib/client.js，喂进一段样例数据，
 * 把三个界面用 react-dom/server 渲成 HTML，再拼成一页带页签的快照。
 * 所以预览和真机长得一样——改完组件跑一下就能刷新。
 *
 * 用法：
 *   node scripts/build-preview.mjs
 *   DSH_REACT_ROOT=<含 react-dom 的目录> node scripts/build-preview.mjs
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveReact } from './lib/resolve-react.mjs'

const requireFrom = resolveReact()
if (requireFrom === null) {
  console.log('跳过：本机没有成对的 react / react-dom。先 npm install，或设置 DSH_REACT_ROOT。')
  process.exit(0)
}
const React = requireFrom('react')
const { renderToStaticMarkup } = requireFrom('react-dom/server')

const CLIENT_PATH = join(import.meta.dirname, '../lib/client.js')
const OUT_PATH = join(import.meta.dirname, '../docs/preview.html')

// ── 样例数据：一段像样的中文正文，加少量标注 ──────────────────────────────
const SEGMENTS = [
  '天蒙蒙亮，一行人踏着露水朝望舒城城门走去。',
  '为首的是金海，浅青色宗门弟子服纤尘不染。身后是李大可、杨怡、张石虎、赵文轩，还有三位自愿同行的宗门弟子，背着猎妖法器，脸上都带着未散的困倦。',
  '快到城门时，老槐树下一道苍老的声音叫住他们：“几位小友，请留步。”',
  '树下的破木桌上摆着罗盘、几枚铜钱，和一块“铁口直断，趋吉避凶”的木牌。桌后坐着个灰袍老道，头发花白，双眼却炯炯有神，笑望着他们。',
  '老道捋了捋山羊胡，叹了口气：“你性子急躁，命中带火，应是木火灵根。木能助火，本该修火系功法，却一直修青云宗亲近木水灵根的法。”',
  '宁陈站在队尾，指节在袖子里轻轻蹭了一下。',
  '“再往前会影响马喘气。”他说。',
]
const RECENTS = ['/path/to/你的作品/factory/runs/逐弈登仙/第8章/三版重写', '/path/to/你的作品/第9章/候选稿']
const CANDIDATES = ['第9章-A-保守精修.txt', '第9章-B-苏清鸢识药.txt', '第9章-C-玩家算计.txt', '第9章-D-当铺对手戏.txt']
const MARKS = { '第9章-A-保守精修.txt': { 1: 'good', 4: 'bad' } }

const state = {
  candidateDir: '/path/to/你的作品/第9章/候选稿',
  enabled: true,
  candidates: CANDIDATES.map((file) => ({ file, segments: SEGMENTS })),
  marks: MARKS,
  profile: [
    '# 作者偏好档案',
    '',
    '> 这里只放能复用的写作规律，不放原文摘录——写稿时读这一份就够。',
    '> 原文证据在 `证据摘录.md`（给人回查、给提炼当输入），不要读进写稿上下文。',
    '',
    '## 已验证偏好（作者喜欢什么）',
    '',
    '- 危险场面只写结果落到谁身上，不写招式过程',
    '- 用一句干巴巴的话接住重击，不铺排情绪',
    '- 配角先有笨拙的具体动作，再有台词',
    '',
    '## 避免的写法（作者不喜欢什么）',
    '',
    '- 不要用比喻堆砌来写人群的恐惧',
    '- 不要在施法后补旁白解释动机',
    '',
    '<!-- dsh-novel-craft:auto:begin -->',
    '- 标注：4 段（👍 2 / 👎 2），覆盖 1 篇',
    '- 待提炼：0 段',
    '- 最近提炼：2026-09-16 20:12 · deepseek-official/deepseek-v4-flash',
    '<!-- dsh-novel-craft:auto:end -->',
    '',
  ].join('\n'),
  profilePath: '/path/to/你的作品/.dsh-novel-craft/作者偏好档案.md',
  profileUpdatedAt: '2026-09-16T12:12:00.000Z',
  evidencePath: '/path/to/你的作品/.dsh-novel-craft/证据摘录.md',
  evidenceCount: 4,
  evidenceBytes: 1180,
  pending: 0,
  stats: { total: 4, good: 2, bad: 2, files: 1, pending: 0, lastDistill: '2026-09-16 20:12 · deepseek-official/deepseek-v4-flash' },
  distillRoute: 'deepseek-official/deepseek-v4-flash',
  distillReady: true,
}

const listing = {
  path: '/path/to/你的作品',
  home: '/path/to',
  crumbs: [
    { name: '/', path: '/', hidden: false },
    { name: 'path', path: '/path', hidden: false },
    { name: 'to', path: '/path/to', hidden: false },
    { name: '你的作品', path: '/path/to/你的作品', hidden: false },
  ],
  entries: [
    { name: '第9章', path: '/path/to/你的作品/第9章', hidden: false },
    { name: '第8章', path: '/path/to/你的作品/第8章', hidden: false },
    { name: 'factory', path: '/path/to/你的作品/factory', hidden: false },
    { name: '.git', path: '/path/to/你的作品/.git', hidden: true },
  ],
  truncated: false,
}
const recommended = [
  { path: '/path/to/你的作品/factory/runs/逐弈登仙/第9章/候选稿', rel: 'factory/runs/逐弈登仙/第9章/候选稿', count: 10 },
  { path: '/path/to/你的作品/factory/runs/逐弈登仙/第8章/候选稿', rel: '第8章/候选稿', count: 10 },
  { path: '/path/to/你的作品/factory/runs/逐弈登仙/第8章/三版重写', rel: '第8章/三版重写', count: 3 },
]

// ── 加载真组件 ────────────────────────────────────────────────────────────
let captured = null
globalThis.window = {
  __ModuleLoader__: { load: (definition) => { captured = definition } },
  localStorage: {
    // 预置两条"最近使用"，预览里才看得到那个入口
    store: new Map([
      [
        'dsh-novel-craft.recent-dirs',
        JSON.stringify(RECENTS),
      ],
    ]),
    getItem(k) { return this.store.has(k) ? this.store.get(k) : null },
    setItem(k, v) { this.store.set(k, v) },
    removeItem(k) { this.store.delete(k) },
  },
  addEventListener: () => {},
  removeEventListener: () => {},
}
await import(pathToFileURL(CLIENT_PATH).href)
// useState 队列：预览要把界面摆到指定状态，又不想跑浏览器
const queue = []
const ReactStub = Object.create(React)
Object.defineProperty(ReactStub, 'useState', {
  enumerable: true,
  value: (init) => React.useState(queue.length > 0 ? queue.shift() : init),
})

const exportsObj = captured.factory((name) => {
  if (name === 'react') return ReactStub
  throw new Error('client.js 出现了未预期的依赖：' + name)
})

let dict = null
const slots = new Map()
exportsObj.apply({
  effect: (fn) => fn(),
  locale: { register: (ns, d) => { dict = d; return () => {} }, bind: () => (k) => dict.zh[k] ?? k },
  slots: { inject: (name, cb) => cb(), register: (cfg, render) => slots.set(cfg.name, { cfg, render }) },
  get: () => undefined,
  settingsScope: { bind: () => ({ getSnapshot: () => ({ value: { candidateDir: state.candidateDir } }), subscribe: () => () => {}, set: async () => {} }) },
})

const fakeWs = {
  listDirectory: async () => listing,
  pickDirectory: async () => null,
  list: { getSnapshot: () => ({ items: [{ id: 'w', path: listing.path }], recentWorkspaceId: 'w' }) },
}

/**
 * CraftWorkbench 的 Hook 顺序：前 12 个是原有状态（open/dir/state/active/busy/notice/picker/
 * tab/distill/distilling/activeSeg/hoverSeg），中间 9 个是 0.2 新增的（ws/wsBusy/wsError/
 * wsNonce/chapter/checkBusy/wizard/reasonAt/reasonText），之后才是子组件的状态。
 * 加状态时只改这两个常量。
 */
const WB_HEAD = 12
const WB_EXTRA = [null, false, '', 0, null, false, false, -1, '']

/** 渲染工作台（强制值按 Hook 顺序排队，中间补位）。 */
const render = (forced, props) => {
  const shifted = [...forced.slice(0, WB_HEAD), ...WB_EXTRA, ...forced.slice(WB_HEAD)]
  queue.length = 0
  for (const value of shifted) queue.push(value)
  const element = slots.get('shell.overlay').render({})
  return renderToStaticMarkup(React.createElement(element.type, { ...element.props, ...props }))
}

/** 新面板（章节/情节/全书）直接按 props 渲染，不走父组件的状态队列。 */
const draw = (component, props) => renderToStaticMarkup(React.createElement(component, props))
const CARDS = render([true, state.candidateDir, state, 0, false, '', false, 'cards', null, false, 3, -1], { getWs: () => fakeWs })
const PROFILE = render([true, state.candidateDir, state, 0, false, '', false, 'profile', null, false, 0, -1], { getWs: () => fakeWs })
const PICKER = render(
  // 顺序＝父组件 12 个状态 + DirPicker 的 listing/error/loading/showHidden/recents/recommended/scanning/counts/manual/draft/picking
  [
    true, state.candidateDir, state, 0, false, '', true, 'cards', null, false, 0, -1,
    listing, '', false, false, RECENTS, recommended, false, {}, false, state.candidateDir, false,
  ],
  { getWs: () => fakeWs },
)

// ── 0.2 的三个新面板：用一份"像真作品"的看板数据渲染 ──────────────────────
const BOARD_WS = {
  found: true,
  projectDir: '/path/to/你的作品/逐弈登仙',
  name: '逐弈登仙',
  source: 'auto',
  runBase: '/path/to/你的作品/factory/runs/逐弈登仙',
  people: [{ file: '宁陈.json', name: '宁陈', identity: '主角', realm: '练气三层', importance: '主角' }],
  outline: { path: '/path/to/你的作品/逐弈登仙/大纲.md', exists: true, bytes: 2048 },
  merged: { path: '/path/to/你的作品/逐弈登仙/逐弈登仙.txt', exists: true, bytes: 97480 },
  totals: { chapters: 12, written: 12, chars: 31529, good: 15, bad: 15, openAnnotations: 2, packs: 3, scored: 11, avgScore: 4.2 },
  stages: { current: 'chapter', done: 3, total: 7 },
  state: { stage: 'chapter', stages: {}, updatedAt: '' },
  checks: null,
  chapters: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => ({
    chapter: n,
    title: `第${n}章 ` + ['血炼台上', '拜师青云', '灵根测试', '西市淘宝', '当铺交易', '夜探藏经阁', '望舒城（一）', '望舒城（二）', '猎妖（一）', '猎妖（二）', '猎妖（三）', '猎妖（四）'][n - 1],
    file: `逐弈登仙-第${n}章.txt`,
    chars: [3830, 2482, 3320, 3019, 2414, 2426, 2190, 3682, 2916, 2145, 2378, 727][n - 1],
    segments: 42,
    altFiles: [],
    summary: { path: '', files: [], exists: n !== 12 },
    comment: { path: '', exists: n !== 1 && n !== 12, score: n === 1 || n === 12 ? null : 4.2, count: 20 },
    run: { dir: '', exists: n === 8 || n === 9, rounds: n === 8 ? [{ name: '候选稿', kind: 'dir', drafts: 10 }, { name: '三版重写', kind: 'dir', drafts: 3 }, { name: '盲评结论.md', kind: 'file' }] : n === 9 ? [{ name: '候选稿', kind: 'dir', drafts: 10 }] : [], drafts: n === 8 ? 13 : n === 9 ? 10 : 0 },
    marks: { good: n === 9 ? 15 : 0, bad: n === 9 ? 15 : 0, pools: n === 9 ? 3 : 0 },
    annotations: { open: n === 8 ? 2 : 0, resolved: n === 8 ? 1 : 0, total: n === 8 ? 3 : 0 },
    pack: { path: '', exists: n === 9, bytes: n === 9 ? 7807 : 0, mtime: '' },
    tension: n === 4 ? 2 : n === 5 || n === 7 || n === 8 || n === 11 ? 3 : 4,
    override: '',
    status: 'written',
    findings: n === 12 ? [{ level: 'info', code: '字数失衡', message: '第 12 章明显偏短：短章会让读者觉得赶。' }] : [],
  })),
}
const BOARD_CHECKS = {
  at: '2026-09-17T01:20:00.000Z',
  cached: false,
  outlineMissing: false,
  ledger: { findings: [{ level: 'warn', code: '未登记物品', chapter: 1, item: '青云令', message: '第1章出现「青云令」，台账未登记，确认后补进去或判定为误报', evidence: '' }], summary: { items: 28, chapters: 12, unmapped: 1, consumedReused: 0, unregistered: 7 } },
  plot: {
    findings: [
      { level: 'info', code: '字数失衡', chapter: 12, message: '第 12 章明显偏短（727 字，全书平均 2618 字，不到一半）：短章会让读者觉得赶。', evidence: '' },
      { level: 'warn', code: '伏笔超期', chapter: 3, message: '「青云令的来历」第 3 章埋下，已经欠了 8 章还没收：要么尽快兑现，要么明确放弃。', evidence: '' },
    ],
    metrics: {
      chapterCount: 12,
      totalChars: 31529,
      avgChars: 2627,
      tension: BOARD_WS.chapters.map((c) => ({ chapter: c.chapter, value: c.tension, source: c.chapter === 4 || c.chapter === 5 ? 'manual' : 'estimated', why: '估 ' + c.tension + ' 分（自动估计，不是作者标的）' })),
      arc: { peak: 4, trough: 2, flatRuns: [] },
      foreshadow: [{ name: '青云令的来历', plantedChapter: 3, dueChapter: null, paidChapter: null, openChapters: 8, overdue: true }],
      density: [],
    },
  },
}
const BOARD = draw(exportsObj.__internals.ChapterBoard, { t: (k) => dict.zh[k] ?? k, ws: BOARD_WS, busy: false, onOpen: () => {}, onRefresh: () => {}, onTension: () => {}, onPickDir: () => {} })
const PLOT = draw(exportsObj.__internals.PlotView, { t: (k) => dict.zh[k] ?? k, ws: { ...BOARD_WS, checks: BOARD_CHECKS }, busy: false, onRunChecks: () => {}, onOpenChapter: () => {} })
const STAGE = draw(exportsObj.__internals.StageView, {
  t: (k) => dict.zh[k] ?? k,
  onReload: () => {},
  ws: {
    found: true,
    stages: {
      current: 'idea',
      done: 3,
      total: 7,
      stages: [
        { id: 'idea', name: '立项', order: 1, complete: false, blocked: true, note: '', artifacts: [{ path: '设定/立项.md', label: '立项（卖点/平台/字数/读者画像）', exists: false, bytes: 0, ok: false }], gate: [{ code: 'idea-brief', ok: false, level: 'error', message: '先写立项：一句话卖点、目标平台、目标字数、读者画像' }] },
        { id: 'setting', name: '设定', order: 2, complete: false, blocked: true, note: '', artifacts: [{ path: '设定/世界观.md', label: '世界观', exists: false, bytes: 0, ok: false }, { path: '设定/道具与增益台账.md', label: '道具与增益台账', exists: true, bytes: 4096, ok: true }], gate: [{ code: 'setting-world', ok: false, level: 'error', message: '还没有 设定/世界观.md' }] },
        { id: 'cast', name: '人物', order: 3, complete: true, blocked: false, note: '', artifacts: [{ path: '人物/主要人物列表.json', label: '主要人物列表', exists: true, bytes: 512, ok: true }], gate: [] },
        { id: 'outline', name: '大纲', order: 4, complete: false, blocked: false, note: '', artifacts: [{ path: '大纲.md', label: '分章大纲', exists: true, bytes: 2048, ok: true }], gate: [{ code: 'outline-node-fields', ok: false, level: 'warn', message: '第 6、11 章的大纲节点缺「目标」或「冲突」' }] },
        { id: 'chapter', name: '逐章正文', order: 5, complete: true, blocked: false, note: '', artifacts: [{ path: '*第*章*.txt', label: '章节正文', exists: true, bytes: 97480, ok: true }], gate: [{ code: 'chapter-short', ok: false, level: 'warn', message: '第 12 章不足 800 字' }] },
        { id: 'revise', name: '修订', order: 6, complete: false, blocked: false, note: '', artifacts: [{ path: '修订清单.md', label: '修订清单', exists: false, bytes: 0, ok: false }], gate: [{ code: 'revise-open', ok: false, level: 'warn', message: '还有 2 条批注没处理（第 8 章）' }] },
        { id: 'finish', name: '完本', order: 7, complete: true, blocked: false, note: '', artifacts: [{ path: '逐弈登仙.txt', label: '全书合并稿', exists: true, bytes: 97480, ok: true }], gate: [] },
      ],
    },
  },
})

// ── 开新章向导：摆到"方向"这一步（这是这批新能力里最要紧的一屏）──────────
const DIRECTIONS = [
  { index: 0, letter: 'A', name: '保守精修', detail: '以最小改动保留现有骨架，只在细节处收紧，给作者一个基准版' },
  { index: 1, letter: 'B', name: '配角识货', detail: '让同行配角先认出货色，主角的算计藏在他的沉默里' },
  { index: 2, letter: 'C', name: '双层信息差', detail: '让当铺掌柜也在算计，读者比主角先看出一层' },
  { index: 3, letter: 'D', name: '对手戏前置', detail: '把议价过程写成可见的对手行为，价格一寸一寸推上去' },
  { index: 4, letter: 'E', name: '轻喜剧动作', detail: '笑点来自人物当下的算计，不额外安排悬疑' },
  { index: 5, letter: 'F', name: '生活流', detail: '用市井细节承担信息，账目只在器物上体现' },
  { index: 6, letter: 'G', name: '最少卡片', detail: '用一段话收束抽卡结果，避免正文变成面板日志' },
]
const WIZARD_STATUS = {
  chapter: 13,
  suggestedChapter: 13,
  candidatesDir: '/path/to/你的作品/factory/runs/逐弈登仙/第13章/候选稿',
  candidateCount: 0,
  setup: { path: '', exists: true, text: '# 第13章 本章设定\n\n## 本章目标（必须发生）\n- 宁陈第一次动用追踪缕的因果牵引\n- 让李大可察觉自己被盯着，但不知道是谁\n' },
  outlineNode: { chapter: 13, goal: '第一次主动用信息差设局', conflict: '李大可开始反查', turn: '追踪缕暴露了一角', plant: [], payoff: [] },
  picks: [],
}
const WIZARD = (() => {
  queue.length = 0
  const picked = {}
  for (const d of DIRECTIONS) picked[d.index] = d.index !== 5
  for (const value of [13, 'directions', WIZARD_STATUS, WIZARD_STATUS.setup.text, 10, '', DIRECTIONS, picked, '', '', [], { done: 0, total: 0, current: '' }, null, '合并稿', '']) {
    queue.push(value)
  }
  return renderToStaticMarkup(
    React.createElement(exportsObj.__internals.NewChapterWizard, {
      t: (k) => dict.zh[k] ?? k,
      chapter: 13,
      onBack: () => {},
      onDone: () => {},
      onGoCards: () => {},
    }),
  )
})()

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>dsh-novel-craft · 抽卡工作台 界面预览</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin: 0; background: #f2f2f7; font: 14px/1.6 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #1c1c1e; }
  header { padding: 18px 24px 6px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.note { color: #6b6b70; font-size: 12.5px; margin: 0 0 14px; }
  .tabs { display: flex; gap: 6px; padding: 0 24px; }
  .tabs button { border: 1px solid rgba(0,0,0,0.1); background: #fff; border-radius: 8px 8px 0 0; padding: 7px 14px; font-size: 13px; cursor: pointer; }
  .tabs button[aria-selected="true"] { background: #0a84ff; border-color: #0a84ff; color: #fff; font-weight: 600; }
  .pane { display: none; margin: 0 24px 24px; background: #fff; border: 1px solid rgba(0,0,0,0.1); border-radius: 0 12px 12px 12px; overflow: hidden; }
  .pane[data-active="true"] { display: block; }
  /* 组件在真机上是全屏浮层；预览里要把它摊平放进页签，所以中和掉固定定位与遮罩 */
  .pane [style*="position:fixed"] { position: static !important; inset: auto !important; background: none !important; padding: 0 !important; z-index: auto !important; display: block !important; }
  .pane [style*="position:fixed"] > div { max-width: 100% !important; height: auto !important; box-shadow: none !important; }
  .pane > div { min-height: 560px; }
  .hint { margin: 0 24px 20px; color: #6b6b70; font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>🎴 dsh-novel-craft · 小说创作工作台</h1>
  <p class="note">静态快照，由真实组件渲染生成（<code>node scripts/build-preview.mjs</code>）。点页签切换七个界面。</p>
</header>
<div class="tabs">
  <button aria-selected="true" onclick="show(0)">🎴 抽卡（阅读视图）</button>
  <button aria-selected="false" onclick="show(6)">✍️ 开新章向导</button>
  <button aria-selected="false" onclick="show(1)">🗂 章节看板</button>
  <button aria-selected="false" onclick="show(2)">📈 情节体检</button>
  <button aria-selected="false" onclick="show(3)">🧭 全书阶段</button>
  <button aria-selected="false" onclick="show(4)">📋 偏好档案</button>
  <button aria-selected="false" onclick="show(5)">📁 目录选择器</button>
</div>
<div class="pane" data-active="true">${CARDS}</div>
<div class="pane" data-active="false">${BOARD}</div>
<div class="pane" data-active="false">${PLOT}</div>
<div class="pane" data-active="false">${STAGE}</div>
<div class="pane" data-active="false">${PROFILE}</div>
<div class="pane" data-active="false">${PICKER}</div>
<div class="pane" data-active="false">${WIZARD}</div>
<p class="hint">预览里的按钮是静态的（没有跑浏览器）：真机上悬停/光标所在段落会浮出 👍/👎，键盘 j/k/G/B/空格/n/p 可用；单章视图里点一段按 A 就能留批注。章节/情节/全书三页用的是样例作品《逐弈登仙》的数据。</p>
<script>
  function show(i) {
    document.querySelectorAll('.pane').forEach(function (pane, j) { pane.dataset.active = String(i === j) })
    document.querySelectorAll('.tabs button').forEach(function (btn, j) { btn.setAttribute('aria-selected', String(i === j)) })
  }
</script>
</body>
</html>
`

await mkdir(join(import.meta.dirname, '../docs'), { recursive: true })
await writeFile(OUT_PATH, html, 'utf8')
console.log('已生成 docs/preview.html（' + Buffer.byteLength(html, 'utf8') + ' 字节）')
