/**
 * dsh-novel-craft 宿主半区联调测试
 *
 * 不起 dsh：用假 ctx（settings + webServer + workspaceRegistry）挂上插件注册的路由，
 * 再放在真实 HTTP 回环端口上打——测的就是工作台会打到的那几个接口。
 *
 * 作品目录是临时造的（见 fixtures.mjs），不依赖任何本机路径：
 *   node test/host-api.test.mjs
 */
import http from 'node:http'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'

import { createWorkspace } from './fixtures.mjs'

// 直接 clone 下来还没装依赖时，别甩一个 ESM 解析错误：说清该做什么再退出
const loadPlugin = async () => {
  try {
    return await import('../lib/index.js')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('Cannot find package')) throw error
    console.log('\n跳过：缺少 peer 依赖（' + message.split("'")[1] + '）。先安装再跑：npm install')
    console.log('（真实部署里这些依赖由 dsh profile 提供，不需要手动装。）')
    process.exit(0)
  }
}
const { apply, splitSegments, buildProfileSection } = await loadPlugin()

const TEXT_EXT = new Set(['.txt', '.md'])

// 所有用例都在临时作品目录上跑：不碰本机任何真实文件
const ws = await createWorkspace()
const WORKSPACE = ws.root
const CH9 = ws.draftsDir('第9章')
const CH8 = ws.draftsDir('第8章')
// discover 的兜底扫描根就是进程 cwd：钉成作品根，测试从哪儿跑都一样
process.chdir(WORKSPACE)

/** 现算期望篇数：稿子会随创作增加，断言不该钉死数字。 */
async function draftsIn(dir) {
  const names = await readdir(dir)
  return names.filter((n) => TEXT_EXT.has(extname(n).toLowerCase())).length
}

let failures = 0
const ok = (name, cond, detail) => {
  if (cond) {
    console.log(`  ✅ ${name}`)
  } else {
    failures += 1
    console.log(`  ❌ ${name}${detail === undefined ? '' : ' → ' + detail}`)
  }
}
const head = (name) => console.log(`\n【${name}】`)

/**
 * 假 cordis ctx：只提供插件真正用到的东西。
 * `extras.llm` / `extras.agentDefaultModel` 用来替身提炼用的辅助模型调用。
 */
function makeCtx(config, extras = {}) {
  const routes = new Map()
  const webServer = { register: (row) => routes.set(row.path, row.handler) }
  const ctx = {
    // 插件现在用 inject(['settings','webServer']) 等两个服务，回调参数要一起给
    inject: (deps, callback) => {
      callback({ settings: { register: () => ({ get: () => config }) }, webServer })
    },
    get: (name) => {
      if (name === 'webServer') return webServer
      if (name === 'workspaceRegistry') {
        return { list: () => [{ path: WORKSPACE }] }
      }
      if (name === 'llm') return extras.llm
      if (name === 'agentDefaultModel') return extras.agentDefaultModel
      return undefined
    },
  }
  return { ctx, routes }
}

/**
 * 假 LLM 服务：把收到的输入记下来，按脚本逐块吐文本 + 结束原因。
 * 这样"提炼"链路（输入边界 → 调用 → 结束原因 → 解析）能全测，不用真联网。
 */
function fakeLlm(reply, sink = [], finish = 'stop') {
  return {
    stream: async function* (options) {
      sink.push(options)
      const text = typeof reply === 'function' ? reply(options) : reply
      for (const piece of String(text).split('\n')) yield { type: 'text-delta', index: 0, text: piece + '\n' }
      yield { type: 'finish', reason: { kind: finish } }
    },
  }
}

const defaultModel = { currentSelection: () => ({ provider: 'mock', model: 'cheap-1' }) }

/** 把插件路由挂到真实回环端口，返回 base url 与关闭函数。 */
async function serve(config, extras = {}) {
  const { ctx, routes } = makeCtx(config, extras)
  await apply(ctx)
  const server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname
    const handler = routes.get(path)
    if (handler === undefined) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{"error":"no route"}')
      return
    }
    handler(req, res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  return {
    base: `http://127.0.0.1:${port}/novel-craft/api/`,
    routes: [...routes.keys()],
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

const getJson = async (url) => {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  return { status: res.status, body: await res.json() }
}
const postJson = async (url, payload) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return { status: res.status, body: await res.json() }
}

// ── 一、真实作品目录上的「推荐目录」 ────────────────────────────────────────
head('推荐目录 discover（扫作品目录）')
{
  const fixture = await mkdtemp(join(tmpdir(), 'nv-craft-'))
  const app = await serve({ candidateDir: fixture, enabled: true })
  try {
    ok('路由已注册 discover/annotate', app.routes.includes('/novel-craft/api/discover') && app.routes.includes('/novel-craft/api/annotate'))

    const { status, body } = await getJson(app.base + 'discover')
    ok('HTTP 200', status === 200, String(status))
    ok('扫描根落在作品目录', Array.isArray(body.roots) && body.roots.includes(WORKSPACE), JSON.stringify(body.roots))

    const byPath = new Map((body.dirs ?? []).map((d) => [d.path, d]))
    const expect9 = await draftsIn(CH9)
    const expect8 = await draftsIn(CH8)
    ok('扫到 第9章/候选稿', byPath.has(CH9))
    ok('扫到 第8章/候选稿', byPath.has(CH8))
    ok(`第9章篇数=${expect9}`, byPath.get(CH9)?.count === expect9, String(byPath.get(CH9)?.count))
    ok(`第8章篇数=${expect8}`, byPath.get(CH8)?.count === expect8, String(byPath.get(CH8)?.count))

    const first = body.dirs[0] ?? {}
    ok('候选稿类目录排在首位', /候选|三版|代理稿|定稿/.test(first.path ?? ''), first.path)
    // 归档目录里旧稿更多、层级更浅，但"归档"必须降权，不能压过正在写的候选稿
    const archiveAt = (body.dirs ?? []).findIndex((d) => d.path.includes('归档'))
    const draftsAt = (body.dirs ?? []).findIndex((d) => d.path === CH9)
    ok('归档目录被降权到候选稿之后', archiveAt === -1 || draftsAt < archiveAt, JSON.stringify([archiveAt, draftsAt]))
    ok('结果带相对路径便于展示', typeof first.rel === 'string' && first.rel.length > 0 && first.rel !== first.path, first.rel)

    const cached = await getJson(app.base + 'discover')
    ok('二次请求命中缓存', cached.body.cached === true && cached.body.dirs.length === body.dirs.length)
  } finally {
    await app.close()
    await rm(fixture, { recursive: true, force: true })
  }
}

// ── 二、目录徽标 annotate ──────────────────────────────────────────────────
head('目录篇数 annotate')
{
  const fixture = await mkdtemp(join(tmpdir(), 'nv-craft-'))
  const app = await serve({ candidateDir: fixture, enabled: true })
  try {
    const { body } = await postJson(app.base + 'annotate', { paths: [CH9, CH8, join(WORKSPACE, '逐弈登仙/设定'), '/nowhere/at/all'] })
    ok(`第9章=${await draftsIn(CH9)}`, body.counts[CH9] === (await draftsIn(CH9)), String(body.counts[CH9]))
    ok(`第8章=${await draftsIn(CH8)}`, body.counts[CH8] === (await draftsIn(CH8)), String(body.counts[CH8]))
    ok('不存在目录=0（不抛错）', body.counts['/nowhere/at/all'] === 0)

    const bad = await postJson(app.base + 'annotate', { paths: 'not-an-array' })
    ok('非法入参退化成空计数', bad.status === 200 && Object.keys(bad.body.counts).length === 0)
  } finally {
    await app.close()
    await rm(fixture, { recursive: true, force: true })
  }
}

// ── 三、原有闭环：state → marks → promote ─────────────────────────────────
head('标注闭环 state / marks / promote')
{
  const fixture = await mkdtemp(join(tmpdir(), 'nv-craft-'))
  await writeFile(join(fixture, '甲.txt'), '第一段。\n\n第二段。\n\n第三段。', 'utf8')
  await writeFile(join(fixture, '乙.txt'), '另一篇第一段。\n\n另一篇第二段。', 'utf8')
  const app = await serve({ candidateDir: fixture, enabled: true })
  try {
    const initial = await getJson(app.base + 'state')
    ok('读到 2 篇候选', initial.body.candidates.length === 2)
    ok('甲切 3 段', initial.body.candidates.find((c) => c.file === '甲.txt')?.segments.length === 3)

    const marked = await postJson(app.base + 'marks', { file: '甲.txt', index: 1, mark: 'good' })
    ok('标注落盘返回', marked.body.marks['甲.txt']?.['1'] === 'good')
    const markedBad = await postJson(app.base + 'marks', { file: '甲.txt', index: 2, mark: 'bad' })
    ok('坏标注并存', markedBad.body.marks['甲.txt']?.['2'] === 'bad')

    const cleared = await postJson(app.base + 'marks', { file: '甲.txt', index: 1, mark: null })
    ok('取消标注', cleared.body.marks['甲.txt']?.['1'] === undefined)
    const restored = await postJson(app.base + 'marks', { file: '甲.txt', index: 1, mark: 'good' })

    const promoted = await postJson(app.base + 'evidence', {})
    ok('收录写出档案与证据', promoted.status === 200 && existsSync(join(fixture, '.dsh-novel-craft/作者偏好档案.md')) && existsSync(join(fixture, '.dsh-novel-craft/证据摘录.md')))
    const again = await getJson(app.base + 'state')
    ok('state 里档案是规律骨架、原文在证据摘录', again.body.profile.includes('## 已验证偏好') && again.body.evidenceCount === 2, JSON.stringify([again.body.evidenceCount, again.body.profile.slice(0, 40)]))

    const illegal = await postJson(app.base + 'marks', { file: '甲.txt', index: 1, mark: 'maybe' })
    ok('非法标注被拒', illegal.status === 400 && String(illegal.body.error).includes('mark'))
    ok('坏标注未污染落盘', restored.body.marks['甲.txt']['1'] === 'good' && restored.body.marks['甲.txt']['2'] === 'bad')
  } finally {
    await app.close()
    await rm(fixture, { recursive: true, force: true })
  }
}

// ── 四、三层产物：标注 → 证据摘录（原文）→ 档案（只有规律） ────────────────
head('证据摘录与规律档案分离')
{
  const fixture = await mkdtemp(join(tmpdir(), 'nv-craft-'))
  const stateDir = join(fixture, '.dsh-novel-craft')
  const profilePath = join(stateDir, '作者偏好档案.md')
  const evidencePath = join(stateDir, '证据摘录.md')
  await writeFile(join(fixture, '甲.txt'), '好段一。\n\n坏段二。\n\n好段三。', 'utf8')
  const app = await serve({ candidateDir: fixture, enabled: true })
  try {
    const before = await getJson(app.base + 'state')
    ok('state 给出档案路径', before.body.profilePath === profilePath, before.body.profilePath)
    ok('尚未收录时档案为空', before.body.profile === '' && before.body.profileUpdatedAt === '')
    ok('state 给出证据摘录路径', before.body.evidencePath === evidencePath)

    await postJson(app.base + 'marks', { file: '甲.txt', index: 0, mark: 'good' })
    await postJson(app.base + 'marks', { file: '甲.txt', index: 1, mark: 'bad' })
    await postJson(app.base + 'marks', { file: '甲.txt', index: 2, mark: 'good' })

    const evidence = await postJson(app.base + 'evidence', {})
    ok('证据摘录收下原文', evidence.body.evidenceCount === 3 && (await readFile(evidencePath, 'utf8')).includes('好段一'))
    ok('证据摘录头部警告别读进上下文', (await readFile(evidencePath, 'utf8')).includes('不要把本文件读进上下文'))
    ok('档案里没有原文（关键）', !evidence.body.profile.includes('好段一') && !evidence.body.profile.includes('坏段二'))
    ok('档案有规律两个小节', evidence.body.profile.includes('## 已验证偏好（作者喜欢什么）') && evidence.body.profile.includes('## 避免的写法（作者不喜欢什么）'))
    ok('档案自动块统计标注数', evidence.body.profile.includes('标注：3 段（👍 2 / 👎 1）'))
    ok('state 反映待提炼数', (await getJson(app.base + 'state')).body.pending === 3)

    // 采纳规律：进档案的是规律，不是原文
    const adopt = await postJson(app.base + 'rules', {
      items: [
        { kind: 'good', text: '用一句干巴巴的话接住重击，不铺排情绪' },
        { kind: 'bad', text: '别堆叠"宛如/像是"式的比喻' },
        { kind: 'good', text: '  ' },
      ],
      model: 'mock/cheap-1',
    })
    ok('采纳写进档案', adopt.body.added === 2, String(adopt.body.added))
    ok('规律落在对应小节', adopt.body.profile.includes('- 用一句干巴巴的话接住重击，不铺排情绪'))
    ok('禁忌落在对应小节', adopt.body.profile.split('## 避免的写法')[1].includes('- 别堆叠"宛如/像是"式的比喻'))
    ok('采纳后档案仍无原文', !adopt.body.profile.includes('好段一'))
    ok('采纳后待提炼清零', adopt.body.pending === 0 && adopt.body.stats.pending === 0)
    ok('采纳后记住提炼模型与时间', adopt.body.stats.lastDistill.includes('mock/cheap-1'))

    const again = await postJson(app.base + 'rules', { items: [{ kind: 'good', text: '用一句干巴巴的话接住重击，不铺排情绪' }] })
    ok('重复采纳幂等', again.body.added === 0)

    // 界面直接改档案
    const saved = await postJson(app.base + 'profile', { content: '# 手写档案\n\n- 只留这一条规律\n' })
    ok('profile 保存生效', saved.body.profile === '# 手写档案\n\n- 只留这一条规律\n')

    // 作者自己写的档案（无自动块）：收录证据只能往后追加，不能清空
    await writeFile(profilePath, '# 我的口味笔记\n\n手写内容在此。\n', 'utf8')
    const appended = await postJson(app.base + 'evidence', {})
    ok('纯手写档案不被清空', appended.body.profile.startsWith('# 我的口味笔记'))
    ok('纯手写档案后面追加自动块', appended.body.profile.includes('auto:begin'))

    const bad = await postJson(app.base + 'profile', { content: 123 })
    ok('非字符串内容被拒', bad.status === 400 && String(bad.body.error).includes('content'))
  } finally {
    await app.close()
    await rm(fixture, { recursive: true, force: true })
  }
}

// ── 五、旧档案迁移：原文搬去证据摘录，档案重建为规律骨架 ────────────────────
head('旧档案迁移')
{
  const fixture = await mkdtemp(join(tmpdir(), 'nv-craft-'))
  const stateDir = join(fixture, '.dsh-novel-craft')
  const profilePath = join(stateDir, '作者偏好档案.md')
  await mkdir(stateDir, { recursive: true })
  await writeFile(join(fixture, '甲.txt'), '好段一。\n\n坏段二。', 'utf8')
  await writeFile(
    profilePath,
    '# 作者偏好档案\n\n> 由 dsh-novel-craft 抽卡工作台自动汇总：旧格式。\n\n## 甲.txt\n\n### 作者选中的段落（好用）\n\n> 好段一。\n',
    'utf8',
  )
  const app = await serve({ candidateDir: fixture, enabled: true })
  try {
    await postJson(app.base + 'marks', { file: '甲.txt', index: 0, mark: 'good' })
    const migrated = await postJson(app.base + 'evidence', {})
    ok('档案重建为规律骨架', migrated.body.profile.includes('## 已验证偏好（作者喜欢什么）'))
    ok('迁移后档案不含原文', !migrated.body.profile.includes('好段一'))
    ok('旧档案留了备份', (await readFile(join(stateDir, '作者偏好档案.旧版.md'), 'utf8')).includes('好段一'))
    ok('原文进了证据摘录', (await readFile(join(stateDir, '证据摘录.md'), 'utf8')).includes('好段一'))
  } finally {
    await app.close()
    await rm(fixture, { recursive: true, force: true })
  }
}

// ── 六、提炼：原文只进一次便宜的辅助调用，产出只有规律 ──────────────────────
head('提炼规律 distill')
{
  const fixture = await mkdtemp(join(tmpdir(), 'nv-craft-'))
  const stateDir = join(fixture, '.dsh-novel-craft')
  await writeFile(join(fixture, '甲.txt'), '好段一。\n\n坏段二。\n\n好段三。', 'utf8')
  const calls = []
  const reply = ['下面是规律：', '+ 用一句干巴巴的话接住重击', '- 别堆叠宛如式比喻', '+ 具体笨拙的小动作立人', '', '（完）'].join('\n')
  const app = await serve({ candidateDir: fixture, enabled: true }, { llm: fakeLlm(reply, calls), agentDefaultModel: defaultModel })
  try {
    const state = await getJson(app.base + 'state')
    ok('state 报出要用的模型路由', state.body.distillRoute === 'mock/cheap-1', state.body.distillRoute)
    ok('state 标记提炼可用', state.body.distillReady === true)

    const empty = await postJson(app.base + 'distill', {})
    ok('没有标注时明确报错', empty.status === 400 && String(empty.body.error).includes('待提炼'))

    await postJson(app.base + 'marks', { file: '甲.txt', index: 0, mark: 'good' })
    await postJson(app.base + 'marks', { file: '甲.txt', index: 1, mark: 'bad' })
    await postJson(app.base + 'marks', { file: '甲.txt', index: 2, mark: 'good' })

    const distilled = await postJson(app.base + 'distill', {})
    ok('提炼返回 3 条规律', distilled.body.items.length === 3, JSON.stringify(distilled.body.items))
    ok('方向解析正确（+/−）', distilled.body.items[0].kind === 'good' && distilled.body.items[1].kind === 'bad')
    ok('去掉了前缀与解释行', distilled.body.items.every((item) => !item.text.includes('下面是规律') && !item.text.startsWith('+ ')))
    ok('用的是一次便宜路由', distilled.body.model === 'mock/cheap-1')
    ok('原文确实喂给了辅助调用', calls.length === 1 && String(calls[0].messages[0].content[0].text).includes('好段一'))

    // 提炼不改档案：规律要作者点头才进去
    const after = await getJson(app.base + 'state')
    ok('提炼后档案仍是空的规律骨架', !after.body.profile.includes('干巴巴'))
    ok('提炼后待提炼数不变', after.body.pending === 3)

    const adopt = await postJson(app.base + 'rules', { items: distilled.body.items, model: distilled.body.model })
    ok('采纳 3 条', adopt.body.added === 3)
    ok('待提炼清零', adopt.body.pending === 0)
    const reread = await getJson(app.base + 'state')
    ok('档案只有规律、没有原文', reread.body.profile.includes('干巴巴') && !reread.body.profile.includes('好段一'))

    const nothing = await postJson(app.base + 'distill', {})
    ok('已提炼的不会被重复送去', nothing.status === 400 && String(nothing.body.error).includes('待提炼'))
  } finally {
    await app.close()
    await rm(fixture, { recursive: true, force: true })
  }
}

head('提炼的失败与边界')
{
  const fixture = await mkdtemp(join(tmpdir(), 'nv-craft-'))
  await writeFile(join(fixture, '甲.txt'), '好段一。\n\n坏段二。', 'utf8')
  const noLlm = await serve({ candidateDir: fixture, enabled: true })
  try {
    await postJson(noLlm.base + 'marks', { file: '甲.txt', index: 0, mark: 'good' })
    const { status, body } = await postJson(noLlm.base + 'distill', {})
    ok('没有 LLM 服务时给明确指引', status === 400 && String(body.error).includes('证据摘录'), String(body.error))
  } finally {
    await noLlm.close()
  }

  const gibberish = await serve({ candidateDir: fixture, enabled: true }, { llm: fakeLlm('这段写得好。不要堆比喻。'), agentDefaultModel: defaultModel })
  try {
    const { status, body } = await postJson(gibberish.base + 'distill', {})
    ok('模型不守格式时报错而不是塞垃圾', status === 400 && String(body.error).includes('格式'), String(body.error))
    ok('报错里指出去哪看模型原话', String(body.error).includes('提炼原始输出.md'))
    ok('模型原话已留档', (await readFile(join(fixture, '.dsh-novel-craft/提炼原始输出.md'), 'utf8')).includes('这段写得好'))
  } finally {
    await gibberish.close()
  }

  // 只输出思考、正文为空：这是"推理吃光输出预算"的典型症状，必须说清楚
  const thinkingOnly = await serve({ candidateDir: fixture, enabled: true }, { llm: fakeLlm(''), agentDefaultModel: defaultModel })
  try {
    const { status, body } = await postJson(thinkingOnly.base + 'distill', {})
    ok('只有思考没有正文时给出准确原因', status === 400 && String(body.error).includes('没有正文'), String(body.error))
  } finally {
    await thinkingOnly.close()
  }

  // 被长度上限截断：已解析出的条目照收，但要把"可能少了"如实告诉界面
  const truncated = await serve({ candidateDir: fixture, enabled: true }, { llm: fakeLlm('喜欢：\n- 用短句收尾', [], 'max-tokens'), agentDefaultModel: defaultModel })
  try {
    const { status, body } = await postJson(truncated.base + 'distill', {})
    ok('截断时仍给出已解析的条目', status === 200 && body.items.length === 1, JSON.stringify(body.items))
    ok('截断标志回传给界面', body.finish === 'max-tokens')
  } finally {
    await truncated.close()
  }

  // 模型不认"关思考"这个档位：应当自动去掉该参数重试一次，而不是直接失败
  const calls = []
  const picky = {
    stream: async function* (options) {
      calls.push(options)
      if (options.reasoningEffort !== undefined) {
        throw new Error('DeepSeek does not support reasoning effort "off"')
      }
      yield { type: 'text-delta', index: 0, text: '喜欢：\n- 用短句收尾\n' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const fallback = await serve({ candidateDir: fixture, enabled: true }, { llm: picky, agentDefaultModel: defaultModel })
  try {
    const { status, body } = await postJson(fallback.base + 'distill', {})
    ok('不认推理档位时自动去掉重试', status === 200 && body.items.length === 1, JSON.stringify(body))
    ok('第一次带了 reasoningEffort: off，第二次没带', calls.length === 2 && calls[0].reasoningEffort === 'off' && calls[1].reasoningEffort === undefined)
  } finally {
    await fallback.close()
  }

  // 提炼之外的接口在"LLM 包不可用"时也必须照常工作（惰性加载的意义）
  const stillWorks = await serve({ candidateDir: fixture, enabled: true })
  try {
    const state = await getJson(stillWorks.base + 'state')
    const evidence = await postJson(stillWorks.base + 'evidence', {})
    ok('没有 LLM 时标注/证据/档案照常可用', state.status === 200 && evidence.status === 200 && evidence.body.profile.includes('## 已验证偏好'))
  } finally {
    await stillWorks.close()
  }

  const noRoute = await serve({ candidateDir: fixture, enabled: true }, { llm: fakeLlm('+ xxxx') })
  try {
    const { status, body } = await postJson(noRoute.base + 'distill', {})
    ok('没有模型路由时给明确指引', status === 400 && String(body.error).includes('distillProvider'))
  } finally {
    await noRoute.close()
    await rm(fixture, { recursive: true, force: true })
  }
}

// ── 七、未配置目录时的提示 ────────────────────────────────────────────────
head('未配置目录')
{
  const app = await serve({ candidateDir: '', enabled: true })
  try {
    const state = await getJson(app.base + 'state')
    ok('state 空目录不炸', state.status === 200 && state.body.candidateDir === '')
    const marks = await postJson(app.base + 'marks', { file: 'x.txt', index: 0, mark: 'good' })
    ok('marks 明确报未配置', marks.status === 400 && String(marks.body.error).includes('candidateDir'))
    const discover = await getJson(app.base + 'discover')
    ok('无候选目录也能给推荐', discover.status === 200 && Array.isArray(discover.body.dirs))
  } finally {
    await app.close()
  }
}

// ── 八、开关关闭 ──────────────────────────────────────────────────────────
head('enabled=false')
{
  const app = await serve({ candidateDir: '', enabled: false })
  try {
    const { status, body } = await getJson(app.base + 'state')
    ok('接口整体停用', status === 503 && String(body.error).includes('disabled'))
  } finally {
    await app.close()
  }
}

// ── 九、纯函数 ────────────────────────────────────────────────────────────
head('纯函数')
{
  ok('按空行切段', splitSegments('a\n\nb\r\n\r\nc').join('|') === 'a|b|c')
  const section = buildProfileSection('x.txt', ['好段', '坏段', '冷段'], { 0: 'good', 1: 'bad', 9: 'good' })
  ok('好/坏各归其位', section.includes('好段') && section.includes('坏段') && !section.includes('冷段'))
  ok('越界下标忽略', (section.match(/>/g) ?? []).length === 2)

  const { parseDistillOutput, buildDistillInput, DISTILL_SYSTEM } = await import('../lib/index.js')
  const sec = parseDistillOutput('喜欢：\n- 危险场面只写结果落到谁身上\n- 用一句干巴巴的话接住重击\n避免：\n- 别堆叠宛如式的比喻')
  ok('分节格式：喜欢/避免 各归其位', sec.length === 3 && sec[0].kind === 'good' && sec[2].kind === 'bad', JSON.stringify(sec))
  const marked = parseDistillOutput('+ 用短句收尾\n- 别写解释性台词')
  ok('标记格式仍然认（+/-）', marked.length === 2 && marked[0].kind === 'good' && marked[1].kind === 'bad')
  const messy = parseDistillOutput('**喜欢**：\n1. `用短句收尾`\n2. 规律：别堆比喻\n避免：\n＋ 全角加号也算' )
  ok('容忍加粗/编号/反引号/全角符号', messy.length === 3 && messy[2].kind === 'bad' && messy[0].text === '用短句收尾', JSON.stringify(messy))
  ok('解释性文字被丢掉', parseDistillOutput('下面是规律：\n喜欢：\n- 用短句收尾\n（完）').length === 1)
  ok('同方向重复去重', parseDistillOutput('喜欢：\n- 用短句收尾\n- 用短句收尾').length === 1)
  ok('提示词要求两节格式', DISTILL_SYSTEM.includes('喜欢：') && DISTILL_SYSTEM.includes('避免：'))

  const capped = buildDistillInput(Array.from({ length: 60 }, (_, i) => ({ file: '甲.txt', index: i, mark: 'good', text: '第' + i + '段' })))
  ok('输入有条数上限', capped.used === 40 && capped.total === 60, JSON.stringify([capped.used, capped.total]))
}

await ws.cleanup()
console.log(`\n${failures === 0 ? '全部通过 ✅' : `失败 ${failures} 项 ❌`}`)
process.exit(failures === 0 ? 0 : 1)
