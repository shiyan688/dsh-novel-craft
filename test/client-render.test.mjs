/**
 * dsh-novel-craft 客户端半区渲染测试（无需浏览器）
 *
 * 做法：本机藏着成对的 react 19 / react-dom 19（某个客户端包的 node_modules 里），
 * 用它把 client.js 注册的组件真渲染成 HTML：
 *   真宿主半区接口（discover / state）→ 真客户端组件 → 断言 HTML。
 * useState 用"排队的强制初值"喂，绕过 useEffect（SSR 不跑副作用），
 * 所以断言的是组件真实的渲染分支，不是替身。
 *
 * 只读检查用作者真实的候选稿目录（state / 渲染）；**任何写操作都落在临时目录**，
 * 测试不许在作者的稿子旁边留下 marks.json。
 *
 * 跑法：cd /public/home/wangyg/novel && node factory/dsh-novel-craft-plugin/test/client-render.test.mjs
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { createWorkspace } from './fixtures.mjs'
import { resolveReact } from '../scripts/lib/resolve-react.mjs'

// 同上：没装依赖时给一句人话，而不是 ESM 解析栈
let applyHost
try {
  ;({ apply: applyHost } = await import('../lib/index.js'))
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (!message.includes('Cannot find package')) throw error
  console.log('\n跳过：缺少 peer 依赖（' + message.split("'")[1] + '）。先安装再跑：npm install')
  process.exit(0)
}

const CLIENT_PATH = join(import.meta.dirname, '../lib/client.js')

// 作品目录临时造，不依赖本机路径
const ws = await createWorkspace()
const WORKSPACE = ws.root
const RUNS = join(WORKSPACE, 'factory/runs/逐弈登仙')
const CH9 = ws.draftsDir('第9章')

// discover 的兜底扫描根是进程 cwd：钉成作品根，测试从哪儿跑都一样
process.chdir(WORKSPACE)

let failures = 0
const ok = (name, cond, detail) => {
  if (cond) console.log(`  ✅ ${name}`)
  else {
    failures += 1
    console.log(`  ❌ ${name}${detail === undefined ? '' : ' → ' + detail}`)
  }
}
const head = (name) => console.log(`\n【${name}】`)
const has = (html, text) => html.includes(text)

// ── 0. 一套与 dsh 同构的假环境 ─────────────────────────────────────────────

/** 假 req/res，让宿主路由能像在真 HTTP 里一样被调用。 */
function callRoute(handler, path, method, payload) {
  return new Promise((resolve) => {
    const req = new EventEmitter()
    req.method = method
    req.url = path
    req.socket = { remoteAddress: '127.0.0.1' }
    const res = {
      status: 0,
      writableEnded: false,
      writeHead(status) {
        this.status = status
        return this
      },
      end(body) {
        this.writableEnded = true
        let parsed = null
        try {
          parsed = JSON.parse(String(body))
        } catch {
          parsed = null
        }
        resolve({ status: this.status, body: parsed })
      },
    }
    handler(req, res)
    // readJsonBody 在 microtask 里才挂监听，所以数据下一拍再发
    setTimeout(() => {
      if (method === 'POST') req.emit('data', JSON.stringify(payload ?? {}))
      req.emit('end')
    }, 0)
  })
}

/** 假 LLM：只用来让 state 报出"提炼可用 + 路由是哪个"。 */
const fakeLlm = {
  stream: async function* () {
    yield { type: 'text-delta', text: '+ 用一句干巴巴的话接住重击\n- 别堆叠宛如式比喻\n' }
  },
}

/** 假 settings 作用域 + 假 webServer：把宿主半区挂起来。 */
async function mountHost(config) {
  const routes = new Map()
  const ctx = {
    inject: (deps, callback) =>
      callback({
        settings: { register: () => ({ get: () => config }) },
        webServer: { register: (row) => routes.set(row.path, row.handler) },
      }),
    get: (name) => {
      if (name === 'webServer') return { register: (row) => routes.set(row.path, row.handler) }
      if (name === 'workspaceRegistry') return { list: () => [{ path: WORKSPACE }] }
      if (name === 'llm') return fakeLlm
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'mock', model: 'cheap-1' }) }
      return undefined
    },
  }
  await applyHost(ctx)
  return {
    api: (path, method = 'GET', payload) => callRoute(routes.get('/novel-craft/api/' + path), path, method, payload),
  }
}

/** 把 client.js 里注册的组件取出来。 */
async function loadClient() {
  const requireFrom = resolveReact()
  if (requireFrom === null) return null
  const React = requireFrom('react')
  const { renderToStaticMarkup } = requireFrom('react-dom/server')

  const SKIP = Symbol('skip')
  const queue = []
  const ReactStub = Object.create(React)
  Object.defineProperty(ReactStub, 'useState', {
    enumerable: true,
    value: (init) => {
      const next = queue.length > 0 ? queue.shift() : SKIP
      return React.useState(next === SKIP ? init : next)
    },
  })

  let captured = null
  globalThis.window = {
    __ModuleLoader__: { load: (definition) => { captured = definition } },
    localStorage: {
      store: new Map(),
      getItem(key) {
        return this.store.has(key) ? this.store.get(key) : null
      },
      setItem(key, value) {
        this.store.set(key, value)
      },
      removeItem(key) {
        this.store.delete(key)
      },
    },
  }
  await import(pathToFileURL(CLIENT_PATH).href)
  if (captured === null) throw new Error('client.js 没有调用 window.__ModuleLoader__.load')

  const exportsObj = captured.factory((name) => {
    if (name === 'react') return ReactStub
    throw new Error('client.js 出现了未预期的依赖：' + name)
  })

  const slots = new Map()
  let dicts = null
  const ctx = {
    effect: (fn) => {
      fn()
      return () => {}
    },
    locale: {
      register: (ns, d) => {
        dicts = d
        return () => {}
      },
      bind: () => (key) => (dicts !== null && dicts.zh[key] !== undefined ? dicts.zh[key] : key),
    },
    slots: {
      inject: (name, callback) => callback(),
      register: (cfg, render) => slots.set(cfg.name, { cfg, render }),
    },
    get: () => undefined,
    settingsScope: { bind: () => scope },
  }
  const scope = {
    getSnapshot: () => ({ value: { candidateDir: CH9, enabled: true } }),
    subscribe: () => () => {},
    set: async () => {},
  }
  exportsObj.apply(ctx)

  return {
    React,
    renderToStaticMarkup,
    internals: exportsObj.__internals,
    dicts: () => dicts,
    slots,
    scope,
    /** 渲染工作台（可排队强制 useState 初值）。 */
    render(forced, props) {
      queue.length = 0
      for (const value of forced) queue.push(value)
      const element = slots.get('shell.overlay').render({})
      return renderToStaticMarkup(React.createElement(element.type, { ...element.props, ...props }))
    },
  }
}

const fakeWs = {
  listDirectory: async (path) => listingFor(path),
  pickDirectory: async () => null,
  list: { getSnapshot: () => ({ items: [{ id: 'w1', path: WORKSPACE }], recentWorkspaceId: 'w1' }) },
}

/** 假的目录列表：真 dsh 的 listDirectory 只回子目录（含 hidden 标记）。 */
function listingFor(path) {
  const base = path === undefined || path === '' ? '/public/home/wangyg' : path
  if (base === WORKSPACE) {
    return {
      path: WORKSPACE,
      home: '/public/home/wangyg',
      crumbs: [
        { name: '/', path: '/', hidden: false },
        { name: 'public', path: '/public', hidden: false },
        { name: 'wangyg', path: '/public/home/wangyg', hidden: false },
        { name: 'novel', path: WORKSPACE, hidden: false },
      ],
      entries: [
        { name: '逐弈登仙', path: join(WORKSPACE, '逐弈登仙'), hidden: false },
        { name: 'factory', path: join(WORKSPACE, 'factory'), hidden: false },
        { name: '.git', path: join(WORKSPACE, '.git'), hidden: true },
        { name: '.dsh', path: join(WORKSPACE, '.dsh'), hidden: true },
      ],
      truncated: false,
    }
  }
  return {
    path: base,
    home: '/public/home/wangyg',
    crumbs: [
      { name: 'public', path: '/public', hidden: false },
      { name: 'wangyg', path: '/public/home/wangyg', hidden: false },
      { name: 'novel', path: WORKSPACE, hidden: false },
      { name: 'factory', path: join(WORKSPACE, 'factory'), hidden: false },
      { name: 'runs', path: join(WORKSPACE, 'factory/runs'), hidden: false },
      { name: '逐弈登仙', path: RUNS, hidden: false },
    ],
    entries: [
      { name: '第9章', path: join(RUNS, '第9章'), hidden: false },
      { name: '第8章', path: join(RUNS, '第8章'), hidden: false },
    ],
    truncated: true,
  }
}

// ── 测试正文 ──────────────────────────────────────────────────────────────

const client = await loadClient()
if (client === null) {
  await ws.cleanup()
  console.log('\n跳过：本机没有成对的 react / react-dom，渲染用例无法运行。')
  console.log('装上再跑：npm install（或用 DSH_REACT_ROOT=<含 react-dom 的目录> node test/client-render.test.mjs）')
  process.exit(0)
}
const host = await mountHost({ candidateDir: CH9, enabled: true })

head('客户端半区装载')
{
  ok('注册了侧栏入口', client.slots.has('sidebar.footer.action'))
  ok('注册了工作台浮层', client.slots.has('shell.overlay'))
  const zh = client.dicts().zh
  const en = client.dicts().en
  const zhKeys = Object.keys(zh).sort()
  const enKeys = Object.keys(en).sort()
  ok('中英文键完全对齐', zhKeys.join(',') === enKeys.join(','), zhKeys.filter((k) => !enKeys.includes(k)).join(','))
  const entry = client.slots.get('sidebar.footer.action').cfg.label()
  ok('侧栏标题走 i18n', entry === '抽卡工作台', entry)
}

head('真接口 → 真渲染：候选稿摊开在面板里')
{
  const state = await host.api('state')
  ok('state 读到第9章候选稿', state.body.candidates.length > 0, String(state.body.candidates.length))
  const html = client.render([true, CH9, state.body], { getWs: () => fakeWs })
  const first = state.body.candidates[0].file
  ok('渲染出候选篇切换按钮', has(html, first), first)
  const chipLabels = client.internals.candidateLabels(state.body.candidates.map((c) => c.file))
  ok(
    '候选条给短标签（剥掉同批前缀），全名退到 tooltip',
    chipLabels[0].length < first.length && !chipLabels[0].includes('.txt') && has(html, 'title="' + first + '"') && has(html, '>' + chipLabels[0] + '<'),
    chipLabels[0] + ' vs ' + first,
  )
  ok('候选条给字数', /\d+(\.\d+)?k?字/.test(html))
  ok('第 1 段（光标所在）浮出标记按钮', has(html, 'title="好（G）"') && has(html, 'title="坏（B）"'))
  ok('每段都在阅读流里（带 data-seg）', (html.match(/data-seg="/g) ?? []).length === state.body.candidates[0].segments.length)
  ok('非当前段的按钮是淡出的（不是每段都抢眼）', has(html, 'opacity:0'))
  ok('给出一条三段式引导', has(html, '按 G') && has(html, '按 B'))
  ok('状态条给光标位置与快捷键', has(html, '1 / ' + state.body.candidates[0].segments.length + ' 段') && has(html, '空格 取消'))
  ok('渲染出提炼按钮', has(html, '⚗️ 提炼规律'))
  ok('顶栏是选择按钮而非输入框', has(html, '选择候选稿目录') || has(html, '第9章'), '')
  ok('全路径可见但不用敲', has(html, '📂 ' + CH9))
  ok('没有残留的绝对路径输入框', !html.includes('placeholder="候选稿目录（绝对路径）"'))
}

head('选择器：推荐 / 最近 / 浏览 三个入口都渲染')
{
  const discover = await host.api('discover')
  ok('宿主 discover 扫到第9章候选稿', discover.body.dirs.some((d) => d.path === CH9))
  const html = client.render(
    [
      true, // open
      CH9, // dir
      { candidateDir: CH9, enabled: true, candidates: [], marks: {}, profile: '' }, // state
      0, // active
      false, // busy
      '', // notice
      true, // picker ← 打开选择器
      'cards', // tab
      null, // distillResult
      false, // distilling
      0, // activeSeg
      -1, // hoverSeg
      listingFor(WORKSPACE), // listing
      '', // error
      false, // loading
      false, // showHidden
      [join(RUNS, '第8章/三版重写')], // recents
      discover.body.dirs, // recommended ← 真扫描结果
      false, // scanning
      {}, // counts
      false, // manual
      CH9, // draft
      false, // picking
    ],
    { getWs: () => fakeWs },
  )
  ok('标题是「选择候选稿目录」', has(html, '📁 选择候选稿目录'))
  ok('有「推荐」区', has(html, '推荐（扫到有候选稿的目录）'))
  ok('推荐里出现真扫到的目录', has(html, '第9章/候选稿'))
  ok('推荐行带篇数徽标', /\d+ 篇/.test(html), (html.match(/\d+ 篇/g) ?? []).slice(0, 3).join(' '))
  ok('推荐区可手动重扫', has(html, '重扫'))
  ok('有「最近使用」区', has(html, '最近使用'))
  ok('最近使用带清空', has(html, '清空'))
  ok('有「浏览」区', has(html, '浏览'))
  ok('面包屑最后一段是作品目录', has(html, 'novel'))
  ok('列出子目录', has(html, '逐弈登仙') && has(html, 'factory'))
  ok('默认不显示隐藏目录（.git/.dsh 被过滤）', !has(html, '>.git<') && !has(html, '/novel/.dsh'))
  ok('有「显示隐藏目录」开关', has(html, '显示隐藏目录'))
  ok('有「主目录」「作品目录」快捷入口', has(html, '🏠 主目录') && has(html, '📚 作品目录'))
  ok('有「就用这个目录」确认键', has(html, '就用这个目录'))
  ok('有「手动输入路径」兜底', has(html, '⌨ 手动输入路径'))
  ok('没有残留的旧「载入」按钮', !has(html, '>载入<'))
}

head('目录层级很深 / 列表被截断')
{
  const truncated = listingFor(RUNS) // truncated: true，面包屑 6 层
  const html = client.render(
    [true, CH9, { candidateDir: CH9, candidates: [], marks: {}, profile: '' }, 0, false, '', true, 'cards', null, false, 0, -1, truncated, '', false, false, [], [], false, {}, false, CH9, false],
    { getWs: () => fakeWs },
  )
  ok('列出该层子目录', has(html, '第9章') && has(html, '第8章'))
  ok('截断时给出提示', has(html, '只显示了一部分'))
  ok('面包屑过长时省略开头', has(html, '… /'), '')
  ok('面包屑末段仍是当前目录', has(html, '逐弈登仙'))
}

head('选择器的降级路径')
{
  // 宿主半区还是老版本：discover 404 → 推荐区显示"没扫到"而不是崩
  const html = client.render(
    [true, CH9, { candidateDir: CH9, candidates: [], marks: {}, profile: '' }, 0, false, '', true, 'cards', null, false, 0, -1, listingFor(WORKSPACE), '', false, false, [], [], false, {}, false, CH9, false],
    { getWs: () => fakeWs },
  )
  ok('无推荐数据时给引导文案', has(html, '没扫到现成的候选稿目录'))

  // 平台没有 workspaces 服务：浏览不可用，自动展开手动输入
  const noWs = client.render(
    [true, CH9, { candidateDir: CH9, candidates: [], marks: {}, profile: '' }, 0, false, '', true, 'cards', null, false, 0, -1, null, '这个 dsh 没提供目录浏览，改用「手动输入路径」', false, false, [], null, false, {}, true, CH9, false],
    { getWs: () => undefined },
  )
  ok('浏览不可用时给出手动输入框', has(noWs, 'name="candidate"') || has(noWs, 'placeholder="候选稿目录（绝对路径）"'))
  ok('浏览不可用时不崩', has(noWs, '就用这个目录'))
}

head('首次进入：一眼就能点，不用记路径')
{
  const html = client.render([true, '', null, 0, false, '', false], { getWs: () => fakeWs })
  ok('空态给「选择候选稿目录」大按钮', has(html, '📁 选择候选稿目录'))
  ok('空态说明为什么', has(html, '还没挑候选稿目录'))
  ok('空态提示不用记路径', has(html, '点这里挑目录，不用记路径'))
}

head('偏好档案面板：只有规律在台面上，原文退到折叠区')
{
  // 单独一间临时目录：这一段全是写操作，绝不碰任何已有数据
  const fixture = await mkdtemp(join(tmpdir(), 'nv-craft-ui-'))
  await writeFile(join(fixture, '甲.txt'), '好段一。\n\n坏段二。\n\n好段三。', 'utf8')
  const app = await mountHost({ candidateDir: fixture, enabled: true })
  try {
    // 真宿主跑一遍：点两段 → 收录证据 → 提炼 → 采纳
    await app.api('marks', 'POST', { file: '甲.txt', index: 0, mark: 'good' })
    await app.api('marks', 'POST', { file: '甲.txt', index: 2, mark: 'bad' })
    const evidence = await app.api('evidence', 'POST', {})
    ok('宿主已收录证据', typeof evidence.body.profile === 'string' && evidence.body.profile.includes('auto:begin'))
    const state = (await app.api('state')).body
    ok('档案里没有原文（关键）', !state.profile.includes('好段一'))
    ok('state 报出待提炼数与模型路由', state.pending === 2 && state.distillRoute === 'mock/cheap-1', JSON.stringify([state.pending, state.distillRoute]))

    const html = client.render([true, fixture, state, 0, false, '', false, 'profile'], { getWs: () => fakeWs })
    ok('面板标题是「作者偏好档案」', has(html, '作者偏好档案'))
    ok('显示档案文件路径', has(html, '📄 ' + state.profilePath))
    ok('统计标注与待提炼', has(html, '2 标注') && has(html, '2 待提炼'))
    ok('好/坏各计数', has(html, '👍 1') && has(html, '👎 1'))
    ok('来源可点回抽卡', has(html, '甲.txt 👍1 👎1'))
    ok('有「复制路径」「编辑」', has(html, '复制路径') && has(html, '编辑'))
    ok('有「提炼规律」主按钮', has(html, '⚗️ 提炼规律（2）'))
    ok('标明用哪条模型路由', has(html, 'mock/cheap-1'))
    ok('有「更新证据摘录」', has(html, '更新证据摘录'))
    ok('没有规律时给空态引导', has(html, '还没有规律'))
    ok('原文证据是折叠的、带警告', has(html, '证据摘录（原文）') && has(html, '不要读进写稿上下文'))
    ok('Markdown 标记没有漏出来', !has(html, '&gt; ') && !has(html, 'auto:begin'))

    // 提炼结果审阅：勾选后采纳
    const distill = { items: [{ kind: 'good', text: '用一句干巴巴的话接住重击' }, { kind: 'bad', text: '别堆叠宛如式比喻' }], model: 'mock/cheap-1', pending: 2, used: 2, capped: false }
    const review = client.render([true, fixture, state, 0, false, '', false, 'profile', distill, false], { getWs: () => fakeWs })
    ok('审阅区标题', has(review, '提炼出的规律'))
    ok('逐条给出规律与方向', has(review, '用一句干巴巴的话接住重击') && has(review, '别堆叠宛如式比喻'))
    ok('有勾选框', (review.match(/type="checkbox"/g) ?? []).length === 2)
    ok('有采纳/全选/丢弃', has(review, '采纳选中') && has(review, '全选') && has(review, '丢弃'))
    ok('引导说明"没勾的丢掉"', has(review, '没勾的丢掉'))

    // 采纳之后：规律进档案，原文仍在折叠区之外
    const adopted = await app.api('rules', 'POST', { items: distill.items, model: distill.model })
    ok('采纳写进档案', adopted.body.added === 2)
    const state2 = (await app.api('state')).body
    const after = client.render([true, fixture, state2, 0, false, '', false, 'profile'], { getWs: () => fakeWs })
    ok('档案区渲染出规律', has(after, '用一句干巴巴的话接住重击') && has(after, '别堆叠宛如式比喻'))
    ok('采纳后待提炼归零', has(after, '0 待提炼'))
    ok('规律排在自动块之前（台面先给规律）', after.indexOf('用一句干巴巴的话接住重击') < after.indexOf('工作台自动块'))
    ok('工作台自动块边界有说明', has(after, '工作台自动块'))
  ok('每条规律可以单独删掉', (after.match(/title="删掉这条规律"/g) ?? []).length === 2)
  ok('自动块里的账目行不算规律、不给删', !/删掉这条规律[^>]*>[^<]*<\/button>[^]{0,200}标注：2 段/.test(after))
    // 抽卡页是 display:none 挂在 DOM 里的，不能拿"原文没出现在 HTML"当断言；
    // 档案里没有原文由宿主侧断言保证，这里只断言"证据正文默认没被加载"
    ok('证据正文默认不加载', !has(after, '这里存的是作者标注'))

    // 一键删掉一条规律（客户端本地改文本 → 走同一个保存接口）
    const removed = await app.api('profile', 'POST', {
      content: state2.profile.split('\n').filter((line) => line.trim() !== '- 别堆叠宛如式比喻').join('\n'),
    })
    ok('删一条规律后只剩另一条', removed.body.profile.includes('干巴巴') && !removed.body.profile.includes('宛如'))

    // 编辑态
    const editing = client.render([true, fixture, state2, 0, false, '', false, 'profile', null, false, 0, -1, true, state2.profile], { getWs: () => fakeWs })
    ok('编辑态给出保存/取消', has(editing, '保存') && has(editing, '取消'))
    ok('编辑框里有整份 Markdown', has(editing, 'auto:begin') && has(editing, '<textarea'))

    // 没有模型路由时：明确告诉作者怎么办
    const noRoute = client.render(
      [true, fixture, { candidateDir: fixture, candidates: [], marks: { '甲.txt': { 0: 'good' } }, profile: '## 已验证偏好（作者喜欢什么）\n', profilePath: '', profileUpdatedAt: '', evidencePath: '', evidenceCount: 0, evidenceBytes: 0, pending: 1, stats: { total: 1, good: 1, bad: 0, files: 1, pending: 1, lastDistill: '' }, distillRoute: '', distillReady: false }, 0, false, '', false, 'profile'],
      { getWs: () => fakeWs },
    )
    ok('没有模型路由时给指引', has(noRoute, 'distillProvider'))

    // 一段都没标
    const noMarks = client.render(
      [true, fixture, { candidateDir: fixture, candidates: [], marks: {}, profile: '', profilePath: '', profileUpdatedAt: '', stats: { total: 0, good: 0, bad: 0, files: 0, pending: 0, lastDistill: '' } }, 0, false, '', false, 'profile'],
      { getWs: () => fakeWs },
    )
    ok('无标注时提示先去抽卡点', has(noMarks, '当前目录还没有任何标注'))
    ok('无标注时提炼按钮不可用', has(noMarks, '没有待提炼的新标注'))
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }

  // 宿主半区还是旧版（state 里没有 stats）：数字用本地标注现算，并明说重启才有新功能
  const oldHost = client.render(
    [true, CH9, { candidateDir: CH9, candidates: [], marks: { '逐弈登仙-第1章.txt': { 0: 'good', 1: 'good', 2: 'bad' } }, profile: '# 作者偏好档案\n\n> 旧版原文档案\n', profilePath: '', profileUpdatedAt: '' }, 0, false, '', false, 'profile'],
    { getWs: () => fakeWs },
  )
  ok('旧宿主时统计仍然正确', has(oldHost, '3 标注') && has(oldHost, '👍 2') && has(oldHost, '👎 1'))
  ok('旧宿主时明说要重启', has(oldHost, '宿主半区还是旧版'))
  ok('旧宿主时不显示提炼按钮', !has(oldHost, '⚗️ 提炼规律'))
  ok('旧宿主时不显示证据区', !has(oldHost, '证据摘录（原文）'))

  // 没选目录
  const noDir = client.render([true, '', null, 0, false, '', false, 'profile'], { getWs: () => fakeWs })
  ok('未选目录时给提示', has(noDir, '先选候选目录，才有档案可看'))
}

head('纯逻辑：候选短标签、字数、键盘映射')
{
  const { candidateLabel, charCount, formatChars, keyToAction, isTypingTarget } = client.internals
  ok('第8章-A-保守精修 → A · 保守精修', candidateLabel('第8章-A-保守精修.txt') === 'A · 保守精修', candidateLabel('第8章-A-保守精修.txt'))
  ok('第9章-A → 第9章 · A', candidateLabel('第9章-A.txt') === '第9章 · A', candidateLabel('第9章-A.txt'))
  ok('逐弈登仙-第1章 → 可区分每章', candidateLabel('逐弈登仙-第1章.txt') === '逐弈登仙 · 第1章', candidateLabel('逐弈登仙-第1章.txt'))
  ok('无分隔符文件名原样', candidateLabel('README.md') === 'README')
  const { candidateLabels } = client.internals
  ok('同批剥掉共有前缀：第9章-A/B → A/B', candidateLabels(['第9章-A.txt', '第9章-B.txt']).join(',') === 'A,B', candidateLabels(['第9章-A.txt', '第9章-B.txt']).join(','))
  ok('保留有区分度的后两段', candidateLabels(['第8章-A-保守精修.txt', '第8章-B-苏清鸢识药.txt']).join(',') === 'A · 保守精修,B · 苏清鸢识药', candidateLabels(['第8章-A-保守精修.txt', '第8章-B-苏清鸢识药.txt']).join(','))
  ok('单文件时不剥前缀', candidateLabels(['逐弈登仙-第1章.txt']).join(',') === '逐弈登仙 · 第1章', candidateLabels(['逐弈登仙-第1章.txt']).join(','))
  ok('字数不计空白', charCount('一二三 四五\n六') === 6, String(charCount('一二三 四五\n六')))
  ok('字数按 k 显示', formatChars(2100) === '2.1k字' && formatChars(860) === '860字')
  ok('j/k 上下段、G/B 标记、空格取消、n/p 换篇', keyToAction('j') === 'next' && keyToAction('k') === 'prev' && keyToAction('G') === 'good' && keyToAction('b') === 'bad' && keyToAction(' ') === 'clear' && keyToAction('n') === 'nextFile' && keyToAction('p') === 'prevFile')
  ok('方向键同样可用', keyToAction('ArrowDown') === 'next' && keyToAction('ArrowUp') === 'prev')
  ok('无关按键不吞', keyToAction('x') === null && keyToAction('Enter') === null)
  ok('输入框里让位给打字', isTypingTarget({ tagName: 'TEXTAREA' }) === true && isTypingTarget({ tagName: 'DIV' }) === false)
}

head('纯逻辑：路径显示与最近使用')
{
  const { shortPath, baseNameOf, dirsFromDiscover, readRecents, rememberDir, RECENT_KEY } = client.internals
  ok('短路径原样返回', shortPath('/public/home/wangyg/novel', 60) === '/public/home/wangyg/novel')
  ok('恰好等于上限时不截断', shortPath('/a/b/c/d/e/f/第9章/候选稿', 20) === '/a/b/c/d/e/f/第9章/候选稿')
  ok('长路径保尾部三段', shortPath(CH9, 30) === '…/逐弈登仙/第9章/候选稿', shortPath(CH9, 30))
  ok('取末段名', baseNameOf('/a/b/候选稿/') === '候选稿')
  ok('根目录末段安全', baseNameOf('/') === '')

  // 旧宿主半区：discover 会回 SPA 的 HTML → 必须收敛成空数组，否则永远"正在扫描"
  ok('HTML 响应收敛为空数组', dirsFromDiscover(null).length === 0)
  ok('非 JSON 对象收敛为空数组', dirsFromDiscover({ dirs: 'oops' }).length === 0)
  ok('正常响应透传', dirsFromDiscover({ dirs: [{ path: '/x' }] }).length === 1)

  window.localStorage.removeItem(RECENT_KEY)
  rememberDir('/first')
  rememberDir('/second')
  rememberDir('/first')
  ok('最近使用去重且最新在前', readRecents().join(',') === '/first,/second', readRecents().join(','))
  for (let i = 0; i < 12; i += 1) rememberDir('/pad-' + i)
  ok('最近使用最多 8 条', readRecents().length === 8, String(readRecents().length))
  window.localStorage.removeItem(RECENT_KEY)
  ok('清空后为空', readRecents().length === 0)
}

await ws.cleanup()
console.log(`\n${failures === 0 ? '全部通过 ✅' : `失败 ${failures} 项 ❌`}`)
process.exit(failures === 0 ? 0 : 1)
