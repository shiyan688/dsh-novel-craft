/**
 * dsh-novel-craft 0.2 联调测试：章节看板 / 写作包 / 批注微调 / 体检 / 阶段
 *
 * 分三层测，每层都尽量打真东西：
 * 1. 纯函数：作品识别、批注核对、写作包组装——不需要宿主；
 * 2. 宿主接口：用假 ctx 把插件路由挂到真回环端口，按工作台会打的顺序打一遍；
 * 3. 客户端面板：把真组件渲染成 HTML（没有浏览器也能断言真实渲染分支）。
 *
 * 作品目录全部在临时目录里造（见 fixtures.mjs 的 createBookFixture），
 * 不碰作者本机的任何稿子。
 *
 * 跑法：node test/workbench.test.mjs
 */
import http from 'node:http'
import { existsSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { createBookFixture } from './fixtures.mjs'
import { resolveReact } from '../scripts/lib/resolve-react.mjs'

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
const plugin = await loadPlugin()
const { apply, coreWorkspace, corePack, coreAnnotate, coreText } = plugin

let failures = 0
const ok = (name, cond, detail) => {
  if (cond) console.log(`  ✅ ${name}`)
  else {
    failures += 1
    console.log(`  ❌ ${name}${detail === undefined ? '' : ' → ' + detail}`)
  }
}
const head = (name) => console.log(`\n【${name}】`)

const fx = await createBookFixture()
const bookName = fx.name
const STATE_DIR_UNDER_TEST = '.dsh-novel-craft'

// ── 一、纯函数 ──────────────────────────────────────────────────────────────

head('作品识别')
{
  const detected = await coreWorkspace.detectProject(fx.draftsDir('第2章'))
  ok('从候选稿目录认出作品根', detected.projectDir === fx.bookDir, detected.projectDir)
  ok('认出作品名', detected.name === bookName, detected.name)
  ok('候选里给了作者可选项', Array.isArray(detected.candidates) && detected.candidates.length >= 1)

  const ws = await coreWorkspace.readWorkspace(detected.projectDir, {
    name: detected.name,
    runsRoot: detected.runsRoot,
  })
  ok('章节数正确', ws.totals.chapters === 3, String(ws.totals.chapters))
  ok('全书合并稿没被当成一章', ws.chapters.every((c) => c.chars > 0 && c.file.includes('第')), ws.chapters.map((c) => c.file).join(','))
  ok('剧情总结被挂上', ws.chapters.every((c) => c.summary.exists === true))
  ok('读者评分被算出来', ws.totals.avgScore !== null && ws.totals.avgScore > 4, String(ws.totals.avgScore))
  ok('人物卡读出来（列表文件不算人物）', ws.people.length === 3, String(ws.people.length))
  ok('轮次目录被找到（还在作品根之外）', ws.runBase === fx.runs, ws.runBase)
  const ch2 = ws.chapters.find((c) => c.chapter === 2)
  ok('第2章轮次有卡池与评审记录', ch2.run.rounds.length === 2, JSON.stringify(ch2.run.rounds.map((r) => r.name)))
  ok('大纲被看见', ws.outline.exists === true)
  ok('合并稿被看见', ws.merged.exists === true)

  const detail = await coreWorkspace.readChapter(detected.projectDir, 2)
  ok('单章正文能读出来', detail.found === true && detail.segments.length > 3, String(detail.segments.length))
  ok('标题取自正文首行', detail.title === '第2章 拜师青云', detail.title)
  const missing = await coreWorkspace.readChapter(detected.projectDir, 99)
  ok('不存在的章不报错、明确返回 found:false', missing.found === false && missing.text === '')
}

head('批注与微调核对')
{
  const original = ['第一段原文。', '第二段原文，需要改。', '第三段原文。'].join('\n\n')
  const good = coreAnnotate.applyRevision(original, { 1: '第二段改好了。' }, [1])
  ok('只替换被批注的段落', coreText.splitSegments(good)[1] === '第二段改好了。')
  ok('其余段落逐字未动', coreText.splitSegments(good)[0] === '第一段原文。' && coreText.splitSegments(good)[2] === '第三段原文。')

  const check1 = coreAnnotate.verifyRevision({ originalText: original, revisedText: good, annotated: [1] })
  ok('核对通过：只改了批注过的段落', check1.ok === true && check1.changed.length === 1, JSON.stringify(check1.problems))

  const tampered = ['第一段被偷改了。', '第二段改好了。', '第三段原文。'].join('\n\n')
  const check2 = coreAnnotate.verifyRevision({ originalText: original, revisedText: tampered, annotated: [1] })
  ok('核对拦下：没批注的段落被改', check2.ok === false && check2.errors.some((p) => p.includes('没有批注却被改动')), JSON.stringify(check2.errors))

  const merged = ['第一段原文。第二段原文，需要改。', '第三段原文。'].join('\n\n')
  const check3 = coreAnnotate.verifyRevision({ originalText: original, revisedText: merged, annotated: [1] })
  ok('核对拦下：段落数变了', check3.ok === false && check3.errors.some((p) => p.includes('段落数变了')))

  const tiny = ['第一段原文。', '短。', '第三段原文。'].join('\n\n')
  const check4 = coreAnnotate.verifyRevision({ originalText: original, revisedText: tiny, annotated: [1] })
  ok('改写后字数变化大只提示、不拦写回', check4.ok === true && check4.warnings.some((p) => p.includes('字数变化较大')), JSON.stringify(check4.warnings))

  const parsed = coreAnnotate.parseRevisionOutput(
    ['[1] 甲。', '【3】乙。', '5. 丙。', '第7段：丁。', '戊的第一行', '戊的第二行'].join('\n'),
  )
  ok('解析 [n] 形式', parsed[1] === '甲。', JSON.stringify(parsed))
  ok('解析 【n】 形式', parsed[3] === '乙。')
  ok('解析 n. 形式', parsed[5] === '丙。')
  ok('解析「第n段：」形式', parsed[7].startsWith('丁。'), String(parsed[7]))
  ok('续行并入同一条', parsed[7] === '丁。\n戊的第一行\n戊的第二行', JSON.stringify(parsed[7]))
  ok('多行段落的每行都保留', coreAnnotate.parseRevisionOutput('[4] 甲行\n乙行')[4] === '甲行\n乙行')

  const diff = coreAnnotate.revisionDiff({ originalText: original, revisedText: good, annotations: [{ seg: 1, type: 'ai-tone', note: '太套话' }] })
  ok('对照清单给出前后文', diff.length === 1 && diff[0].before === '第二段原文，需要改。' && diff[0].note === '太套话')
}

head('写作包')
{
  const profileText = ['# 作者偏好档案', '', '## 已验证偏好（作者喜欢什么）', '', '- 让在场群像先静默再爆响', '', '<!-- dsh-novel-craft:auto:begin -->', '- 标注：30 段', '<!-- dsh-novel-craft:auto:end -->', ''].join('\n')
  const summaries = [{ chapter: 1, text: await readFile(join(fx.bookDir, '剧情/第 1 章 剧情总结.md'), 'utf8') }]
  const detected = await coreWorkspace.detectProject(fx.draftsDir('第2章'))
  const ws = await coreWorkspace.readWorkspace(detected.projectDir, { name: detected.name, runsRoot: detected.runsRoot })

  const ledger = await plugin.coreLedger.readLedger(detected.projectDir)
  const built = await corePack.buildPack({
    projectDir: detected.projectDir,
    chapter: 2,
    settings: { targetChapterWords: 3000 },
    profileText,
    setupText: '# 第2章 本章设定\n\n- 目标：拿下当铺的第一桶金\n',
    ledgerItems: ledger.items,
    people: ws.people,
    summaries,
    previousChapterText: await readFile(join(fx.bookDir, `${bookName}-第1章.txt`), 'utf8'),
    previousChapter: 1,
    outlineNodes: [{ chapter: 2, title: '拜师青云', goal: '进入青云宗', conflict: '灵根测试被人轻视', turn: '', plant: [], payoff: [] }],
    debts: [{ name: '青云令的来历', plantedChapter: 1, dueChapter: null, paidChapter: null, openChapters: 1 }],
    annotations: [],
  })
  const ids = built.sections.map((s) => s.id)
  ok('分节齐全', ['task', 'profile', 'prevEnd', 'recap', 'cast', 'ledger', 'outline', 'debt', 'banned', 'rules'].every((id) => ids.includes(id)), ids.join(','))
  ok('自动块没有进包', !built.text.includes('auto:begin'), '')
  ok('规律留在包里', built.text.includes('让在场群像先静默再爆响'))
  ok('上一章结尾被截断（不是整章）', built.text.includes('上一章（第1章）结尾') && built.sections.find((s) => s.id === 'prevEnd').chars <= 900)
  ok('包尾写明"不要读什么"', built.text.includes('不要读进上下文的东西') && built.text.includes('证据摘录.md'))
  ok('包大小在预算内', built.budget.ok === true && built.chars <= 9000, String(built.chars))

  const huge = await corePack.buildPack({
    projectDir: detected.projectDir,
    chapter: 2,
    profileText: '规则'.repeat(12000),
    people: [],
    summaries: [],
    outlineNodes: [],
    debts: [],
    previousChapterText: '',
  })
  const profileSection = huge.sections.find((s) => s.id === 'profile')
  ok('超长分节被裁并标记', profileSection.trimmed === true && profileSection.chars <= corePack.CAP.profile, String(profileSection.chars))
  ok('裁过之后整包仍进预算', huge.budget.ok === true, String(huge.chars))
  ok('任务缺失时给提醒而不是崩', huge.warnings.some((w) => w.includes('本章设定还没写')), huge.warnings.join('|'))

  const setup = await corePack.readSetup(detected.projectDir, 5)
  ok('没有本章设定时给模板', setup.exists === false && setup.text.includes('本章目标'))
}

// ── 二、宿主接口 ────────────────────────────────────────────────────────────

/** 假 LLM：按脚本吐文本，并把 options 记下来（微调链路要用）。 */
function fakeLlm(reply, sink = []) {
  return {
    stream: async function* (options) {
      sink.push(options)
      const text = typeof reply === 'function' ? reply(options) : reply
      for (const piece of String(text).split('\n')) yield { type: 'text-delta', index: 0, text: piece + '\n' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
}

function makeCtx(config, extras = {}) {
  const routes = new Map()
  const webServer = { register: (row) => routes.set(row.path, row.handler) }
  const scope = {
    get: () => config,
    update: async (patch) => {
      Object.assign(config, patch)
    },
  }
  const ctx = {
    inject: (deps, callback) => {
      callback({ settings: { register: () => scope }, webServer })
    },
    get: (name) => {
      if (name === 'webServer') return webServer
      if (name === 'llm') return extras.llm
      if (name === 'agentDefaultModel') return extras.agentDefaultModel
      return undefined
    },
  }
  return { ctx, routes }
}

/**
 * 假模型：按 system 提示分流，三条链路（提炼规律 / 批注微调 / 补齐来源）各有各的回复。
 * 这样能在没有真模型的情况下把"模型 → 解析 → 落盘"整条链路测通。
 */
const fakeReply = (options) => {
  const system = String(options.system ?? '')
  if (system.includes('只给"写法方向"')) {
    return [
      '- A 保守精修：以最小改动保留现有骨架，只在细节处收紧',
      '- B 配角识货：让同行配角先认出货色，主角的算计藏在他的沉默里',
      '- C 双层信息差：让掌柜也在算计，读者比主角先看出一层',
    ].join('\n')
  }
  if (system.includes('多版候选稿中的一篇')) {
    return ['第3章 望舒城', '', '西市的风把幌子吹得直响。', '', '宁陈没有急着开口，先看掌柜的手。'].join('\n')
  }
  if (system.includes('压成可复用的写作规律')) {
    return ['喜欢：', '- 让在场群像先静默再爆响（来自 1、2）', '避免：', '- 不要用比喻堆砌写人群的恐惧（来自 3）'].join('\n')
  }
  if (system.includes('对应关系')) {
    return ['R1: 1、2', 'R2: 3', 'R3: -'].join('\n')
  }
  const matched = /\[(\d+)\] 批注类型/.exec(JSON.stringify(options.messages))
  const seg = matched === null ? 1 : Number(matched[1])
  return (
    `[${seg}] ` +
    '改写后的段落：血袍魔修没有再说一句话，只把袖口往下压了半寸；宁陈盯着那半寸，喉结动了动，到底没出声。'
  )
}

const llmSink = []
const config = {
  candidateDir: fx.draftsDir('第2章'),
  enabled: true,
  distillProvider: '',
  distillModel: '',
  projectDir: '',
  targetChapterWords: 3000,
}
const { ctx, routes } = makeCtx(config, {
  llm: fakeLlm(fakeReply, llmSink),
  agentDefaultModel: { currentSelection: () => ({ provider: 'mock', model: 'cheap-1' }) },
})
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
const base = `http://127.0.0.1:${server.address().port}/novel-craft/api/`
const getJson = async (path) => {
  const res = await fetch(base + path, { headers: { accept: 'application/json' } })
  return { status: res.status, body: await res.json() }
}
const postJson = async (path, payload) => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload === undefined ? {} : payload),
  })
  return { status: res.status, body: await res.json() }
}

head('宿主接口：作品与看板')
{
  const project = await getJson('project')
  ok('project 认出作品根', project.body.project !== null && project.body.project.dir === fx.bookDir, JSON.stringify(project.body.project))
  ok('project 给出候选', Array.isArray(project.body.candidates) && project.body.candidates.some((c) => c.dir === fx.bookDir))

  const ws = await getJson('workspace')
  ok('workspace 200', ws.status === 200, String(ws.status))
  ok('看板给出章节', ws.body.found === true && ws.body.chapters.length === 3, String(ws.body.chapters === undefined ? '' : ws.body.chapters.length))
  ok('看板不带正文（省上下文）', ws.body.chapters.every((c) => c.text === undefined && c.path === undefined))
  ok('看板带上阶段状态', ws.body.stages !== undefined && Array.isArray(ws.body.stages.stages) && ws.body.stages.stages.length === 7)

  const chapter = await postJson('chapter', { chapter: 2 })
  ok('chapter 返回正文段落', chapter.status === 200 && chapter.body.segments.length > 3, String(chapter.body.segments === undefined ? '' : chapter.body.segments.length))
  ok('chapter 带上批注数组与类型表', Array.isArray(chapter.body.annotations) && chapter.body.annotationTypes.length === 8)
  ok('chapter 给出本章设定模板', chapter.body.setup.text.includes('本章目标'))
  const bad = await postJson('chapter', { chapter: 99 })
  ok('不存在的章返回 400 + 人话', bad.status === 400 && String(bad.body.error).includes('没有找到第99章'), JSON.stringify(bad.body))
}

head('宿主接口：本章设定与批注')
{
  const saved = await postJson('setup', { chapter: 2, text: '# 第2章 本章设定\n\n## 本章目标（必须发生）\n\n- 拿下当铺的第一桶金\n' })
  ok('本章设定能存', saved.status === 200 && saved.body.saved === true, JSON.stringify(saved.body))
  ok('存到了作品的状态目录里', String(saved.body.path).includes('.dsh-novel-craft/章节设定'), saved.body.path)

  const added = await postJson('annotation', { chapter: 2, action: 'add', seg: 1, type: 'ai-tone', note: '这里套话了', quote: '第二段' })
  ok('批注能加', added.status === 200 && added.body.list.length === 1 && added.body.added === true)
  const again = await postJson('annotation', { chapter: 2, action: 'add', seg: 1, type: 'ai-tone', note: '改一下措辞' })
  ok('同段同类型重复提交＝更新而不是堆两条', again.body.list.length === 1 && again.body.added === false && again.body.list[0].note === '改一下措辞')
  const second = await postJson('annotation', { chapter: 2, action: 'add', seg: 2, type: 'wordy', note: '啰嗦' })
  ok('同段不同类型可以并存', second.body.list.length === 2)
  const removed = await postJson('annotation', { chapter: 2, action: 'remove', id: second.body.list[1].id })
  ok('批注能删', removed.body.list.length === 1)
  const badAction = await postJson('annotation', { chapter: 2, action: 'nope' })
  ok('未知 action 明确报错', badAction.status === 400 && String(badAction.body.error).includes('未知的 action'))

  const row = (await getJson('workspace')).body.chapters.find((c) => c.chapter === 2)
  ok('看板显示未处理批注', row.annotations.open === 1, JSON.stringify(row.annotations))
}

head('宿主接口：写作包')
{
  const built = await postJson('pack', { chapter: 2, save: false })
  ok('写作包能生成', built.status === 200 && built.body.chars > 200, JSON.stringify(built.body.error === undefined ? built.body.chars : built.body))
  ok('save:false 不落盘', !existsSync(built.body.path), built.body.path)
  ok('包里带上作者刚写的本章设定', built.body.text.includes('拿下当铺的第一桶金'))
  ok('包里带上台账里还持有的道具', built.body.text.includes('通透世界'), '')

  const saved = await postJson('pack', { chapter: 2 })
  ok('默认会落盘', existsSync(saved.body.path), saved.body.path)
  const written = await readFile(saved.body.path, 'utf8')
  ok('落盘内容与返回值一致', written === saved.body.text, String(written.length))

  const row = (await getJson('workspace')).body.chapters.find((c) => c.chapter === 2)
  ok('看板显示写作包已生成', row.pack.exists === true && row.pack.bytes > 0)
}

head('体检数据的形状（两条路由必须一致）')
{
  const viaCheck = await postJson('check', { refresh: true })
  const viaWorkspace = await postJson('workspace', { deep: true })
  const a = viaCheck.body.plot
  const b = viaWorkspace.body.checks.plot
  ok('check 给出 plot.metrics 与 plot.findings', a.metrics !== undefined && Array.isArray(a.findings), JSON.stringify(Object.keys(a)))
  ok('workspace 给出同一形状的 plot', b !== undefined && b.metrics !== undefined && Array.isArray(b.findings), JSON.stringify(b === undefined ? null : Object.keys(b)))
  ok('两条路由的 metrics 键一致', JSON.stringify(Object.keys(a.metrics).sort()) === JSON.stringify(Object.keys(b.metrics).sort()), JSON.stringify([Object.keys(a.metrics).sort(), Object.keys(b.metrics).sort()]))
  ok('workspace 也带账目 findings', Array.isArray(viaWorkspace.body.checks.ledger.findings) && viaWorkspace.body.checks.ledger.summary !== undefined)
}

head('宿主接口：张力、体检、阶段')
{
  const tension = await postJson('tension', { chapter: 2, value: 4 })
  ok('手工张力能存', tension.status === 200 && tension.body.tension['2'] === 4, JSON.stringify(tension.body))
  const bad = await postJson('tension', { chapter: 2, value: 9 })
  ok('张力越界被拒', bad.status === 400 && String(bad.body.error).includes('1-5'))
  const row = (await getJson('workspace')).body.chapters.find((c) => c.chapter === 2)
  ok('看板显示手工张力', row.tension === 4, String(row.tension))

  const check = await postJson('check', { refresh: true })
  ok('体检能跑', check.status === 200 && check.body.ledger !== null && check.body.plot !== null, JSON.stringify(check.body.error))
  ok('体检给出账目结论', check.body.ledger.summary !== undefined && typeof check.body.ledger.summary.items === 'number', JSON.stringify(check.body.ledger.summary))
  ok('体检给出伏笔字段', Array.isArray(check.body.plot.metrics.foreshadow), JSON.stringify(check.body.plot.metrics).slice(0, 80))
  const cached = await postJson('check', {})
  ok('体检结果有缓存', cached.body.cached === true)
  const wsAfter = await getJson('workspace')
  ok('看板能看到体检摘要', wsAfter.body.checks !== null && wsAfter.body.checks.at !== '', JSON.stringify(wsAfter.body.checks))

  const status = await postJson('stage', { action: 'status' })
  ok('阶段状态有七步', status.body.stages.length === 7, String(status.body.stages.length))
  ok('阶段按顺序排好', status.body.stages.map((s) => s.id).join(',') === 'idea,setting,cast,outline,chapter,revise,finish', status.body.stages.map((s) => s.id).join(','))
  const idea = status.body.stages.find((s) => s.id === 'idea')
  ok('立项这一步在夹具里是齐的', idea.complete === true, JSON.stringify(idea.artifacts))
  const revise = status.body.stages.find((s) => s.id === 'revise')
  ok('修订阶段提醒还有未处理批注', revise.gate.some((g) => g.ok === false && g.message.includes('批注')), JSON.stringify(revise.gate))

  const savedStage = await postJson('stage', { action: 'save', stage: 'idea', text: '# 立项\n\n新的立项正文，够长够长够长够长够长够长够长够长够长够长够长。\n' })
  ok('阶段产物能写入作品目录', savedStage.status === 200 && savedStage.body.savedPath === join(fx.bookDir, '设定/立项.md'), JSON.stringify(savedStage.body.savedPath))
  ok('确实写进了文件', (await readFile(join(fx.bookDir, '设定/立项.md'), 'utf8')).includes('新的立项正文'))

  const generated = await postJson('stage', { action: 'generate', stage: 'outline' })
  ok('起草走真模型通道并落原始输出', generated.status === 200 && typeof generated.body.text === 'string' && generated.body.model === 'mock/cheap-1', JSON.stringify(generated.body).slice(0, 120))
}

head('规律 → 证据反查')
{
  // 先标几段，再走一次"提炼 → 采纳"，规律应当带上来源
  const drafts = await readdir(fx.draftsDir('第2章'))
  const first = drafts.find((n) => n.endsWith('.txt'))
  for (const index of [1, 2]) await postJson('marks', { file: first, index, mark: 'good' })
  await postJson('marks', { file: first, index: 3, mark: 'bad' })

  const distilled = await postJson('distill', {})
  ok('提炼结果带上来源编号', distilled.body.items.every((i) => Array.isArray(i.sources)) && distilled.body.items[0].sources.length === 2, JSON.stringify(distilled.body.items))
  const adopted = await postJson('rules', { items: distilled.body.items, model: distilled.body.model })
  ok('采纳规律时写下来源表', adopted.body.evidence !== undefined && Object.keys(adopted.body.evidence).length >= 2, JSON.stringify(Object.keys(adopted.body.evidence ?? {})))
  const key = '让在场群像先静默再爆响'
  const entry = adopted.body.evidence[key]
  ok('来源指向真被标过的那几段', entry !== undefined && entry.by === 'model' && entry.marks.length === 2, JSON.stringify(entry))
  ok('来源里带原文与好/坏', entry.marks.every((m) => m.text.length > 0 && (m.mark === 'good' || m.mark === 'bad')), JSON.stringify(entry.marks.map((m) => m.mark)))
  ok('来源文件落在作品的状态目录', String(adopted.body.evidencePath).endsWith('规则来源.json'), adopted.body.evidencePath)

  const fetched = await getJson('rule-evidence')
  ok('界面能拉到来源表', fetched.body.count >= 2 && fetched.body.index[key] !== undefined)

  // 老档案补齐：模型给映射 → by:'model'；模型不给 → 本地匹配且标成推测
  await writeFile(
    join(fx.bookDir, STATE_DIR_UNDER_TEST, '作者偏好档案.md'),
    [
      '# 作者偏好档案',
      '',
      '## 已验证偏好（作者喜欢什么）',
      '',
      '- 让在场群像先静默再爆响',
      '- 一条全新的、还没有来源的规律',
      '',
      '## 避免的写法（作者不喜欢什么）',
      '',
      '- 不要用比喻堆砌来写人群的恐惧',
      '- 不要在施法后补旁白解释动机',
      '',
    ].join('\n'),
    'utf8',
  )
  const filled = await postJson('rule-evidence', { action: 'backfill' })
  ok('补齐来源走模型通道', filled.status === 200 && filled.body.backfilled.by === 'model', JSON.stringify(filled.body.backfilled))
  ok('已有规律补齐了来源', filled.body.index['一条全新的、还没有来源的规律'] === undefined || filled.body.index['一条全新的、还没有来源的规律'].marks.length >= 0)
  ok('补齐不会覆盖已有来源', filled.body.index[key].by === 'model' && filled.body.index[key].marks.length === 2)

  const parsedMap = plugin.coreProvenance.parseBackfillOutput('R1: 3、7\nR2: -\n噪声行\nR4：1,2')
  ok('解析补齐输出', parsedMap[1].join(',') === '3,7' && parsedMap[2].length === 0 && parsedMap[4].join(',') === '1,2', JSON.stringify(parsedMap))
  const doc = plugin.coreProvenance.parseEvidenceDoc(
    ['# 证据摘录（原文）', '', '## 甲.txt', '', '### 作者选中的段落（好用）', '', '> 好的一段', '', '### 作者否决的段落（别再用）', '', '> 坏的一段', ''].join('\n'),
  )
  ok('能从证据摘录还原标过的段落', doc.length === 2 && doc[0].mark === 'good' && doc[1].mark === 'bad' && doc[0].file === '甲.txt', JSON.stringify(doc))
  // 规律条目至少要 4 个字（太短的当噪声丢掉），所以这里用真长度的规律
  const rules = plugin.coreProvenance.rulesFromProfile(
    '# 作者偏好档案\n\n## 已验证偏好（作者喜欢什么）\n\n- 危险场面只写结果落到谁身上\n\n## 避免的写法（作者不喜欢什么）\n\n- 别堆叠宛如式的比喻\n',
  )
  ok('能从档案里取规律条目', rules.length === 2 && rules[0].kind === 'good' && rules[1].kind === 'bad', JSON.stringify(rules))
  const shortRules = plugin.coreProvenance.rulesFromProfile('## 已验证偏好（作者喜欢什么）\n\n- 好\n')
  ok('过短的条目当噪声丢掉', shortRules.length === 0, JSON.stringify(shortRules))
}

head('开新章：方向 → 候选 → 合并 → 写入正文（端到端）')
{
  const chapter = 8
  const status0 = await postJson('newchapter', { action: 'status', chapter })
  ok('status 给出建议章号', status0.status === 200 && status0.body.suggestedChapter === 4, JSON.stringify(status0.body.suggestedChapter))
  ok('status 给出候选目录与现状', typeof status0.body.candidatesDir === 'string' && status0.body.candidateCount === 0, JSON.stringify({ dir: status0.body.candidatesDir, n: status0.body.candidateCount }))

  await postJson('setup', { chapter, text: '# 第8章 本章设定\n\n- 目标：当铺换灵石，写出双层信息差' })
  const sinkBefore = llmSink.length
  const dirs = await postJson('newchapter', { action: 'directions', chapter, count: 3 })
  ok('方向生成成功', dirs.status === 200 && dirs.body.directions.length === 3, JSON.stringify(dirs.body.error === undefined ? dirs.body.directions.map((d) => d.name) : dirs.body))
  ok('方向带字母与说明', dirs.body.directions[0].letter === 'A' && dirs.body.directions[0].detail.length > 4, JSON.stringify(dirs.body.directions[0]))
  ok('方向用的输入是写作包', dirs.body.packChars > 100 && String(dirs.body.packPath).endsWith('.md'), JSON.stringify(dirs.body.packChars))

  // 偏好档案必须进提示词（这是本插件的铁律：口味输入只来自规律）
  const promptText = (options) =>
    String(options.system ?? '') +
    '\n' +
    String((options.messages ?? []).map((m) => (m.content ?? []).map((c) => c.text ?? '').join('')).join('\n'))
  const directionPrompts = llmSink.slice(sinkBefore).map(promptText)
  ok('要方向的提示词里有偏好档案', directionPrompts.every((x) => x.includes('作者偏好档案') && x.includes('已验证偏好') && x.includes('避免的写法')), String(directionPrompts.length))
  ok('要方向的提示词点明了"以作者喜欢的写法为准"', directionPrompts.every((x) => x.includes('已经验证过喜欢')), '')
  ok('提示词里没有把自动块（标注账目）带进去', directionPrompts.every((x) => !x.includes('auto:begin')), '')
  ok('方向的原始输出留档', existsSync(dirs.body.rawPath), dirs.body.rawPath)

  const draftSinkBefore = llmSink.length
  const texts = []
  for (let i = 0; i < 3; i += 1) {
    const one = await postJson('newchapter', { action: 'draft', chapter, index: i, direction: dirs.body.directions[i], directions: dirs.body.directions })
    ok('候选第 ' + (i + 1) + ' 篇落盘', one.status === 200 && one.body.chars > 10 && existsSync(one.body.path), JSON.stringify(one.body.error === undefined ? one.body.file : one.body))
    texts.push(one.body)
  }
  ok('文件名是"第N章-字母-方向名"', texts[0].file === '第8章-A-保守精修.txt', texts[0].file)
  ok('候选数量与方向一致', (await readdir(texts[0].path.replace(/\/[^/]+$/, ''))).filter((n) => n.endsWith('.txt')).length === 3)
  ok('正文里没有模型的开场白', !String((await readFile(texts[0].path, 'utf8'))).includes('好的，以下是'), '')

  const draftPrompts = llmSink.slice(draftSinkBefore).map(promptText)
  ok('写候选的提示词里有偏好档案', draftPrompts.length === 3 && draftPrompts.every((x) => x.includes('作者偏好档案') && x.includes('避免的写法')), String(draftPrompts.length))
  ok('写候选的系统提示点名了第 ② 节', draftPrompts.every((x) => x.includes('写作包第 ② 节就是')), '')
  ok('写候选的提示词末尾重申了否决清单', draftPrompts.every((x) => x.includes('作者明确否决过的写法')), '')
  ok('否决清单确实落在提示词末尾（近因）', draftPrompts.every((x) => x.length - x.indexOf('作者明确否决过的写法') < 900), '')

  // 模拟作者点「去抽卡选段」：当前卡池切到刚写出来的那个目录（工作台就是这么做的）
  const previousDir = config.candidateDir
  config.candidateDir = status0.body.candidatesDir
  const picks = []
  for (const item of texts) {
    const body = await readFile(item.path, 'utf8')
    picks.push({ file: item.file, index: 0, text: coreText.splitSegments(body)[0], reason: '标题够素' })
    picks.push({ file: item.file, index: 1, text: coreText.splitSegments(body)[1] || '第二段', reason: '开场不解释' })
  }
  // 用真实标注接口把好段标上（工作台就是这么发的：标 👍 的同时写一句取用原因）
  for (const pick of picks) {
    await postJson('marks', { file: pick.file, index: pick.index, mark: 'good', reason: pick.reason })
  }
  const merged = await postJson('newchapter', { action: 'merge', chapter, versionName: '合并稿' })
  ok('合并成功并生成取用记录', merged.status === 200 && merged.body.rows.length === picks.length, JSON.stringify(merged.body.error === undefined ? { rows: merged.body.rows.length, want: picks.length, gaps: merged.body.gaps } : merged.body))
  ok('取用原因进了记录', merged.body.mergeDoc.includes('标题够素') && merged.body.mergeDoc.includes('开场不解释'), '')
  ok('来源列是候选稿名（去掉扩展名）', merged.body.rows[0].source === '第8章-A-保守精修', merged.body.rows[0].source)
  ok('取用记录写成表格', merged.body.mergeDoc.includes('| 来源 | 取用内容 | 取用原因 |'), '')
  ok('跨稿衔接处写成缺口标记', merged.body.gaps > 0 && merged.body.text.includes('此处需过渡'), String(merged.body.gaps))
  ok('合并稿落到定稿候选目录', existsSync(merged.body.versionPath) && String(merged.body.versionPath).includes('定稿候选'), merged.body.versionPath)
  ok('合并稿不包含任何未被选中的内容', merged.body.rows.every((row) => merged.body.text.includes(row.preview.slice(0, 8))), '')

  const final = await postJson('newchapter', { action: 'finalize', chapter, text: merged.body.text })
  ok('写入正文成功', final.status === 200 && existsSync(final.body.path), JSON.stringify(final.body.error === undefined ? final.body.path : final.body))
  const written = await readFile(final.body.path, 'utf8')
  ok('正文首行是规范标题', written.startsWith('第8章'), written.slice(0, 20))
  const chapterNow = await postJson('chapter', { chapter })
  ok('看板能看到新写的这一章', chapterNow.status === 200 && chapterNow.body.chars > 10, String(chapterNow.body.chars))

  const again = await postJson('newchapter', { action: 'finalize', chapter, text: '第8章 改一遍\n\n新的正文。' })
  ok('再次写入会先备份原稿', again.body.backupPath !== '' && existsSync(again.body.backupPath), String(again.body.backupPath))
  ok('备份里是上一版正文', (await readFile(again.body.backupPath, 'utf8')).includes('西市的风'), '')

  // 真实场景：作者的标注可能落在"全局当前候选目录"那个池里（早期就是在作品根下标的），
  // 合并要能同时看两个池，取选段更多的那个。
  config.candidateDir = previousDir // 回到第2章那个池
  const crossPool = await postJson('newchapter', { action: 'merge', chapter, versionName: '跨池测试' })
  ok('两个候选池都能被合并看到', crossPool.status === 200 && crossPool.body.rows.length >= picks.length, JSON.stringify(crossPool.body.error === undefined ? { rows: crossPool.body.rows.length, want: picks.length } : crossPool.body))
  ok('合并用的还是本章自己的池', crossPool.body.rows.every((row) => row.source.startsWith('第8章-')), JSON.stringify(crossPool.body.rows.map((r) => r.source)))

  // 收尾：卡池切回原来的目录，免得影响后面的用例
  config.candidateDir = previousDir
}

head('宿主接口：批注式微调（端到端）')
{
  const before = await readFile(join(fx.bookDir, `${bookName}-第2章.txt`), 'utf8')
  const run = await postJson('revise', { chapter: 2 })
  ok('微调能跑通', run.status === 200 && run.body.diff.length === 1, JSON.stringify(run.body.error === undefined ? run.body.problems : run.body))
  ok('只改了被批注的那一段', run.body.diff[0].seg === 1, JSON.stringify(run.body.diff.map((d) => d.seg)))
  ok('核对通过', run.body.ok === true, JSON.stringify(run.body.problems))
  ok('微调也留了模型原始输出', existsSync(run.body.rawPath))

  const apply1 = await postJson('revise-apply', { chapter: 2 })
  ok('采纳写回成功', apply1.status === 200 && apply1.body.changed === 1, JSON.stringify(apply1.body.error === undefined ? apply1.body : apply1.body))
  const after = await readFile(join(fx.bookDir, `${bookName}-第2章.txt`), 'utf8')
  const beforeSegs = coreText.splitSegments(before)
  const afterSegs = coreText.splitSegments(after)
  ok('正文确实被改了那一段', afterSegs[1].includes('改写后的段落') && beforeSegs[1] !== afterSegs[1])
  ok('其余段落逐字未动', beforeSegs[0] === afterSegs[0] && beforeSegs.slice(2).join('|') === afterSegs.slice(2).join('|'))
  const backups = await readdir(coreWorkspace.revisionBackupDirOf(fx.bookDir))
  ok('原稿被备份成文件', backups.length === 1 && backups[0].startsWith('第2章'), backups.join(','))
  const backupText = await readFile(join(coreWorkspace.revisionBackupDirOf(fx.bookDir), backups[0]), 'utf8')
  ok('备份里是改动前的原文', backupText === before, String(backupText.length))
  const again = await postJson('revise-apply', { chapter: 2 })
  ok('采纳过就不能再采纳一次', again.status === 400 && String(again.body.error).includes('没有待采纳'), JSON.stringify(again.body))
  const chapter = await postJson('chapter', { chapter: 2 })
  ok('批注标成已处理', chapter.body.annotations.every((a) => a.status !== 'open'), JSON.stringify(chapter.body.annotations))
}

// ── 三、客户端面板渲染 ──────────────────────────────────────────────────────

head('客户端面板')
{
  const requireFrom = resolveReact()
  if (requireFrom === null) {
    console.log('  · 跳过：本机没有成对的 react / react-dom（从任何目录跑都不该失败）')
  } else {
    const React = requireFrom('react')
    const { renderToStaticMarkup } = requireFrom('react-dom/server')
    // useState 排队替身：把组件摆到指定状态再渲染（预览脚本用的是同一招）
    const queue = []
    const SKIP = Symbol('skip')
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
      __ModuleLoader__: { load: (definition) => (captured = definition) },
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    }
    await import(pathToFileURL(join(import.meta.dirname, '../lib/client.js')).href)
    const exportsObj = captured.factory((name) => {
      if (name === 'react') return ReactStub
      throw new Error('client.js 出现了未预期的依赖：' + name)
    })
    const dicts = { zh: {}, en: {} }
    const fakeScope = { getSnapshot: () => ({ value: {} }), subscribe: () => () => {}, set: async () => {} }
    exportsObj.apply({
      effect: (fn) => {
        fn()
        return () => {}
      },
      locale: {
        register: (ns, d) => {
          dicts.zh = d.zh
          dicts.en = d.en
          return () => {}
        },
        bind: () => (key) => (dicts.zh[key] !== undefined ? dicts.zh[key] : key),
      },
      slots: { inject: (name, cb) => cb(), register: () => {} },
      get: () => undefined,
      settingsScope: { bind: () => fakeScope },
    })
    const t = (key) => (dicts.zh[key] !== undefined ? dicts.zh[key] : key)
    const I = exportsObj.__internals
    const draw = (component, props, forced) => {
      queue.length = 0
      for (const value of forced === undefined ? [] : forced) queue.push(value)
      return renderToStaticMarkup(React.createElement(component, props))
    }

    // 先留一条新批注：微调那一段已经把上一批批注结清了，看板要断言的是"有未处理批注"的状态
    await postJson('annotation', { chapter: 3, action: 'add', seg: 1, type: 'wordy', note: '这章开头有点拖' })
    const wsBody = (await getJson('workspace')).body
    const board = draw(I.ChapterBoard, { t, ws: wsBody, busy: false, onOpen: () => {}, onRefresh: () => {}, onTension: () => {}, onPickDir: () => {} })
    ok('看板渲染出作品名', board.includes(bookName), '')
    ok('看板渲染出章节标题', board.includes('第2章 拜师青云'), '')
    ok('看板显示未处理批注', board.includes('未处理批注'), '')
    const emptyBoard = draw(I.ChapterBoard, { t, ws: { found: false, candidateDir: '', hint: '' }, busy: false, onOpen: () => {}, onRefresh: () => {}, onTension: () => {}, onPickDir: () => {} })
    ok('没认出作品根时给明确出路', emptyBoard.includes('还没认出作品目录') && emptyBoard.includes('作品根'))

    // 关键：喂给面板的就是 workspace 路由**真实返回**的那份 payload。
    // （曾经这里用过 check 路由的形状，结果形状一不一致就把情节页点崩了。）
    const boardWs = (await postJson('workspace', { deep: true })).body
    const plot = draw(I.PlotView, { t, ws: boardWs, busy: false, onRunChecks: () => {}, onOpenChapter: () => {} })
    ok('情节面板能吃 workspace 的原样 payload', plot.length > 200, String(plot.length))
    ok('情节面板画出张力曲线', plot.includes('<svg') && plot.includes('<polyline'), '')
    ok('情节面板列出伏笔欠账区', plot.includes('未兑现伏笔'), '')
    ok('情节面板列出账目体检区', plot.includes('道具与增益台账'), '')
    ok('情节面板显示章号刻度', plot.includes('>2<'), '')

    // 形状退化也不许崩：缺 findings / metrics 被拍平，两种历史形状都要能渲染
    const flat = draw(I.PlotView, {
      t,
      ws: { ...boardWs, checks: { at: 'x', ledger: { summary: { items: 3 } }, plot: { tension: [], foreshadow: [] } } },
      busy: false,
      onRunChecks: () => {},
      onOpenChapter: () => {},
    })
    ok('metrics 被拍平时也能渲染', flat.includes('张力曲线'), String(flat.length))
    const noChecks = draw(I.PlotView, { t, ws: { ...boardWs, checks: null }, busy: false, onRunChecks: () => {}, onOpenChapter: () => {} })
    ok('没有体检数据时也能渲染', noChecks.includes('还没体检过'), '')

    const stage = draw(I.StageView, { t, ws: wsBody, onReload: () => {} })
    ok('阶段面板渲染七步', ['立项', '设定', '人物', '大纲', '逐章正文', '修订', '完本'].every((name) => stage.includes(name)), '')
    ok('阶段面板给出产物路径', stage.includes('设定/立项.md'), '')

    const notes = draw(I.NotePanel, { t, annotations: [{ id: 'x', seg: 1, type: 'ai-tone', note: '这里套话了', quote: '第二段', status: 'open' }], types: [{ id: 'ai-tone', label: 'AI 腔', hint: '' }], composer: null, onStatus: () => {}, onDelete: () => {}, onJump: () => {} })
    ok('批注面板显示批注正文与引用', notes.includes('这里套话了') && notes.includes('第二段'), '')

    const revision = draw(I.RevisionPanel, { t, result: { ok: true, problems: [], model: 'mock/cheap-1', used: 1, total: 1, diff: [{ seg: 1, before: '旧句子。', after: '新句子。', charsBefore: 4, charsAfter: 4, type: 'ai-tone', note: '套话' }] }, busy: false, adopting: false, openNotes: 1, onRun: () => {}, onAdopt: () => {}, onJump: () => {} })
    ok('微调面板给出前后对照', revision.includes('旧句子。') && revision.includes('新句子。'), '')
    ok('微调面板给出采纳按钮', revision.includes('采纳并写回正文'), '')

    const pack = draw(I.PackPanel, { t, pack: (await postJson('pack', { chapter: 2, save: false })).body, busy: false, copied: false, onBuild: () => {}, onCopied: () => {} })

    // 开新章向导：① 起点 ② 方向清单 ④ 合并（把组件摆到各步再渲染）
    const wizardProps = { t, chapter: 8, onBack: () => {}, onDone: () => {}, onGoCards: () => {} }
    const w1 = draw(I.NewChapterWizard, wizardProps)
    ok('向导第一步问"这一章要写什么"', w1.includes('这一章要写什么') && w1.includes('本章设定'), '')
    const DIRS = [
      { index: 0, letter: 'A', name: '保守精修', detail: '以最小改动保留现有骨架' },
      { index: 1, letter: 'B', name: '配角识货', detail: '让同行配角先认出货色' },
    ]
    const wStatus = { chapter: 8, suggestedChapter: 8, candidatesDir: '/tmp/x', candidateCount: 0, setup: { path: '', exists: false, text: '模板' }, outlineNode: null, picks: [] }
    const w2 = draw(I.NewChapterWizard, wizardProps, [8, 'directions', wStatus, '模板', 10, '', DIRS, { 0: true, 1: true }, '', '', [], { done: 0, total: 0, current: '' }, null, '合并稿', ''])
    ok('向导第二步列出方向并可勾选', w2.includes('保守精修') && w2.includes('配角识货') && w2.includes('开始写候选'), '')
    const mergeRows = [{ file: '第8章-A-保守精修.txt', index: 1, source: '第8章-A-保守精修', reason: '以小场景代替概述', preview: '木匣与断符的具体还价', chars: 40 }]
    const w3 = draw(I.NewChapterWizard, wizardProps, [
      8,
      'merge',
      wStatus,
      '模板',
      10,
      '',
      DIRS,
      {},
      '',
      '',
      [],
      { done: 0, total: 0, current: '' },
      { text: '第8章 正文\n\n〔此处需过渡〕\n\n下一段', rows: mergeRows, picks: [{ file: '第8章-A-保守精修.txt', index: 1, text: '木匣与断符的具体还价', reason: '以小场景代替概述' }], gaps: 1, chars: 20, versionPath: '/tmp/v.txt', mergeDocPath: '/tmp/记录.md', mergeDoc: '' },
      '合并稿',
      '第8章 正文',
    ])
    ok('向导第四步给出取用段落表', w3.includes('第8章-A-保守精修') && w3.includes('以小场景代替概述'), '')
    ok('向导第四步能写入正文并提示缺口', w3.includes('写入正文') && w3.includes('处缺口'), '')
    ok('写作包面板给出分节预算', pack.includes('上下文预算') && pack.includes('本章任务（作者指定）'), '')
  }
}

await new Promise((resolve) => server.close(resolve))
await fx.cleanup()

console.log(`\n${failures === 0 ? '全部通过 ✅' : `失败 ${failures} 项 ❌`}`)
process.exit(failures === 0 ? 0 : 1)
