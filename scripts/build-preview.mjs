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

const render = (forced, props) => {
  queue.length = 0
  for (const value of forced) queue.push(value)
  const element = slots.get('shell.overlay').render({})
  return renderToStaticMarkup(React.createElement(element.type, { ...element.props, ...props }))
}

// 父组件状态顺序：open, dir, state, active, busy, notice, picker, tab, distill, distilling, activeSeg, hoverSeg
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
  <h1>🎴 dsh-novel-craft · 抽卡工作台</h1>
  <p class="note">静态快照，由真实组件渲染生成（<code>node scripts/build-preview.mjs</code>）。点页签切换三个界面。</p>
</header>
<div class="tabs">
  <button aria-selected="true" onclick="show(0)">🎴 抽卡（阅读视图）</button>
  <button aria-selected="false" onclick="show(1)">📋 偏好档案</button>
  <button aria-selected="false" onclick="show(2)">📁 目录选择器</button>
</div>
<div class="pane" data-active="true">${CARDS}</div>
<div class="pane" data-active="false">${PROFILE}</div>
<div class="pane" data-active="false">${PICKER}</div>
<p class="hint">预览里的按钮是静态的（没有跑浏览器）：真机上悬停/光标所在段落会浮出 👍/👎，键盘 j/k/G/B/空格/n/p 可用。</p>
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
