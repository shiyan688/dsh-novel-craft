/**
 * dsh-novel-craft — node half（宿主半区）
 *
 * 三层产物，各司其职（这是本插件的核心约定）：
 * - `marks.json`      机器可读的好/坏标注，永不进模型上下文；
 * - `证据摘录.md`      作者标注的**原文**，给人回查、给提炼当输入，**不要读进写稿上下文**；
 * - `作者偏好档案.md`   只有**能复用的写作规律**（提炼产物），写稿时读这一份就够。
 *
 * 职责：
 * - 注册 settings 命名空间 `dsh-novel-craft`（候选目录 / 开关 / 提炼模型路由）；
 * - 经 webServer 暴露回环 HTTP API（/novel-craft/api/*），供浏览器侧「抽卡工作台」读写：
 *   GET  state    → 候选稿段落 + 标注 + 规律档案 + 证据摘录情况 + 待提炼数
 *   POST marks    → 保存作者对某段的 好/坏 标注
 *   POST evidence → 原文收录进「证据摘录.md」，档案只刷新自动块（规律区不动）
 *   POST distill  → 把待提炼的原文交给**一次便宜的辅助模型调用**，压成规律条目待采纳
 *   POST rules    → 采纳规律写进档案（幂等），并把提炼水位推到已采纳的那批标注
 *   POST profile  → 界面上直接编辑保存「作者偏好档案.md」
 *   GET  discover → 「推荐目录」：扫出含候选稿的目录（作者不必记路径）
 *   POST annotate → 给一批目录回候选稿篇数，供选择器打徽标
 * - 标注落盘在 `<候选目录>/.dsh-novel-craft/`，随作品走，不写进全局配置。
 *
 * 与 dsh-novel-solo 的关系：禁AI腔六维度改编自其 MIT 许可的 persona（见 THIRD_PARTY_NOTICES.md）。
 */
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname, basename, dirname, relative } from 'node:path'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-novel-craft'

const NS = 'dsh-novel-craft'
const API_PREFIX = '/novel-craft/api/'
const STATE_DIR = '.dsh-novel-craft'
const MARKS_FILE = 'marks.json'
const PROFILE_FILE = '作者偏好档案.md'
const TEXT_EXT = new Set(['.txt', '.md'])

// 偏好档案的自动块：提炼只重写块内，规律区是作者的，永不被覆盖
const AUTO_BEGIN = '<!-- dsh-novel-craft:auto:begin -->'
const AUTO_END = '<!-- dsh-novel-craft:auto:end -->'
/** 旧版整份自动生成的档案都带这句，用于识别并安全迁移 */
const GENERATED_HINT = '由 dsh-novel-craft 抽卡工作台自动汇总'
const MAX_PROFILE_CHARS = 1024 * 1024

// 三层产物：标注（机器）→ 证据摘录（人 / 提炼输入）→ 档案（只有规律，给模型）
const EVIDENCE_FILE = '证据摘录.md'
const RAW_OUTPUT_FILE = '提炼原始输出.md'
const DISTILL_FILE = 'distill.json'
const LEGACY_BACKUP_FILE = '作者偏好档案.旧版.md'
const RULES_GOOD_HEADING = '## 已验证偏好（作者喜欢什么）'
const RULES_BAD_HEADING = '## 避免的写法（作者不喜欢什么）'

/**
 * 提炼的输入/输出边界：原文只喂这么多，规律只要这么多。
 * reasoningEffort 必须显式关掉：这是压缩任务，不需要思考链；
 * 而默认模型带 max 档思考时，推理会先把输出预算吃光，正文一个字都留不下。
 */
const DISTILL = {
  maxSegments: 40,
  maxCharsPerSegment: 240,
  maxInputBytes: 20000,
  maxOutputTokens: 2000,
  timeoutMs: 90000,
  reasoningEffort: 'off',
}

/** 可编辑配置：候选目录 + 开关 + 提炼用的模型路由。走 dsh settings，改动即时持久化。 */
const configSchema = z.object({
  candidateDir: z.string().default(''),
  enabled: z.boolean().default(true),
  /** 留空则用 dsh 当前的默认模型；想省钱就指定一个便宜档位 */
  distillProvider: z.string().default(''),
  distillModel: z.string().default(''),
})

const stateDirOf = (dir) => join(dir, STATE_DIR)
const marksPathOf = (dir) => join(stateDirOf(dir), MARKS_FILE)
const profilePathOf = (dir) => join(stateDirOf(dir), PROFILE_FILE)
const evidencePathOf = (dir) => join(stateDirOf(dir), EVIDENCE_FILE)
const distillPathOf = (dir) => join(stateDirOf(dir), DISTILL_FILE)

/** 把候选稿正文切成段落：空行分段，去空段，保留原始顺序。 */
function splitSegments(text) {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

async function readMarks(dir) {
  try {
    const raw = await readFile(marksPathOf(dir), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function writeMarks(dir, marks) {
  await mkdir(stateDirOf(dir), { recursive: true })
  await writeFile(marksPathOf(dir), JSON.stringify(marks, null, 2), 'utf8')
}

/** 列出候选目录下的文本候选稿并切段。 */
async function readCandidates(dir) {
  if (dir === '' || !existsSync(dir)) return []
  const names = await readdir(dir)
  const files = names
    .filter((n) => !n.startsWith('.') && TEXT_EXT.has(extname(n).toLowerCase()))
    .sort()
  const out = []
  for (const file of files) {
    try {
      const text = await readFile(join(dir, file), 'utf8')
      out.push({ file, segments: splitSegments(text) })
    } catch {
      // 读不了就跳过这一篇，不影响其余候选
    }
  }
  return out
}

/** 档案正文 + 路径 + 更新时间：界面要能显示"这档案什么时候汇总的"。 */
async function readProfileInfo(dir) {
  const path = profilePathOf(dir)
  try {
    const [text, info] = await Promise.all([readFile(path, 'utf8'), stat(path)])
    return { text, path, updatedAt: info.mtime.toISOString() }
  } catch {
    return { text: '', path, updatedAt: '' }
  }
}

/** 证据摘录（原文）的存在情况：界面按段数和体积提示"别读进上下文"。 */
async function readEvidenceInfo(dir) {
  const path = evidencePathOf(dir)
  try {
    const [text, info] = await Promise.all([readFile(path, 'utf8'), stat(path)])
    // 只数正文小节里的引用行，页头那几行说明不算
    const firstSection = text.indexOf('\n## ')
    const body = firstSection === -1 ? '' : text.slice(firstSection)
    return { text, path, bytes: info.size, count: (body.match(/^> /gm) ?? []).length }
  } catch {
    return { text: '', path, bytes: 0, count: 0 }
  }
}

/** 提炼水位：记下"哪些标注已经进过规律"，用来算待提炼。 */
async function readDistillState(dir) {
  try {
    const parsed = JSON.parse(await readFile(distillPathOf(dir), 'utf8'))
    if (parsed !== null && typeof parsed === 'object' && typeof parsed.values === 'object' && parsed.values !== null) {
      return { values: parsed.values, model: String(parsed.model ?? ''), at: String(parsed.at ?? '') }
    }
  } catch {
    // 没有水位文件 = 一段都还没提炼
  }
  return { values: {}, model: '', at: '' }
}

async function writeDistillState(dir, state) {
  await mkdir(stateDirOf(dir), { recursive: true })
  await writeFile(distillPathOf(dir), JSON.stringify(state, null, 2), 'utf8')
}

/** 待提炼的标注：新增的，或好/坏被改过的。 */
function pendingEntries(candidates, marks, distilled) {
  const out = []
  for (const candidate of candidates) {
    const entry = marks[candidate.file]
    if (entry === null || typeof entry !== 'object') continue
    for (const [key, mark] of Object.entries(entry)) {
      if (mark !== 'good' && mark !== 'bad') continue
      const index = Number(key)
      const segment = candidate.segments[index]
      if (segment === undefined) continue
      if (distilled.values[`${candidate.file}#${index}`] === mark) continue
      out.push({ file: candidate.file, index, mark, text: segment })
    }
  }
  return out
}

/** 标注总账（好/坏/篇数/待提炼）——档案自动块和界面都用它。 */
function markStats(candidates, marks, pending, distillState) {
  let good = 0
  let bad = 0
  const files = new Set()
  for (const candidate of candidates) {
    const entry = marks[candidate.file]
    if (entry === null || typeof entry !== 'object') continue
    let touched = false
    for (const mark of Object.values(entry)) {
      if (mark === 'good') {
        good += 1
        touched = true
      } else if (mark === 'bad') {
        bad += 1
        touched = true
      }
    }
    if (touched) files.add(candidate.file)
  }
  return {
    good,
    bad,
    total: good + bad,
    files: files.size,
    pending: pending.length,
    lastDistill: distillState.model === '' ? '' : `${distillState.at.slice(0, 16).replace('T', ' ')} · ${distillState.model}`,
  }
}

/** 证据摘录正文：原文只落在这一份文件里，头部写清"别读进上下文"。 */
function buildEvidenceDoc(dir, candidates, marks, now) {
  const sections = candidates
    .filter((c) => marks[c.file] !== undefined)
    .map((c) => buildProfileSection(c.file, c.segments, marks[c.file]))
  return [
    '# 证据摘录（原文）',
    '',
    '> 这里存的是作者标注的**原文段落**：给人回查，也给提炼当输入。',
    '> ⚠️ 写稿会话请只读 `作者偏好档案.md`（规律清单），**不要把本文件读进上下文**。',
    `> 候选目录：${dir}`,
    `> 更新时间：${now}`,
    '',
    ...(sections.length === 0 ? ['（还没有标注）', ''] : sections),
  ].join('\n')
}

/**
 * 把自动块拼进档案。三种情形：
 * - 已有自动块 → 只换块内，块外（规律清单）原样保留；
 * - 空文件 / 旧版整份自动生成的档案 → 整份重建为"规律骨架"，旧文件另存备份；
 * - 作者自己写的文件 → 一个字都不动，自动块附在最后。
 */
function composeProfile({ stats, existing, dir }) {
  const managed = [
    AUTO_BEGIN,
    `- 标注：${stats.total} 段（👍 ${stats.good} / 👎 ${stats.bad}），覆盖 ${stats.files} 篇`,
    `- 待提炼：${stats.pending} 段${stats.pending > 0 ? '（原文证据见 `证据摘录.md`）' : ''}`,
    `- 最近提炼：${stats.lastDistill === '' ? '—' : stats.lastDistill}`,
    AUTO_END,
  ].join('\n')
  const begin = existing.indexOf(AUTO_BEGIN)
  const end = existing.indexOf(AUTO_END)
  if (begin !== -1 && end > begin) {
    return existing.slice(0, begin) + managed + existing.slice(end + AUTO_END.length)
  }
  if (existing.trim() === '' || existing.includes(GENERATED_HINT) || existing.startsWith('# 作者偏好档案')) {
    return [profileSkeleton(dir), managed, ''].join('\n')
  }
  return existing.replace(/\s+$/, '') + '\n\n' + managed + '\n'
}

/** 新建档案的骨架：规律区留空等提炼，自动块由工作台维护。 */
function profileSkeleton(dir) {
  return [
    '# 作者偏好档案',
    '',
    `> ${GENERATED_HINT}：这里只放**能复用的写作规律**，不放原文摘录——写稿时读这一份就够。`,
    '> 原文证据在 `证据摘录.md`（给人回查、给提炼当输入），**不要读进写稿上下文**。',
    '> 自动块（begin / end 之间）每次提炼重写；其余内容是你的，不会被覆盖。',
    `> 候选目录：${dir}`,
    '',
    RULES_GOOD_HEADING,
    '',
    RULES_BAD_HEADING,
    '',
  ].join('\n')
}

/**
 * 把规律条目写进对应小节（幂等：已存在的整条跳过）。
 * @returns 新档案正文与实际新增条数
 */
function insertRules(existing, items) {
  let text = existing
  let added = 0
  const groups = { good: [], bad: [] }
  for (const item of items) {
    const text2 = String(item.text ?? '').trim()
    if (text2 === '') continue
    const kind = item.kind === 'bad' ? 'bad' : 'good'
    groups[kind].push(text2.replace(/^[-+*]\s*/, '').trim())
  }
  for (const kind of ['good', 'bad']) {
    const heading = kind === 'good' ? RULES_GOOD_HEADING : RULES_BAD_HEADING
    for (const rule of groups[kind]) {
      const line = `- ${rule}`
      if (text.includes(line)) continue
      const at = text.indexOf(heading)
      if (at === -1) {
        // 档案里没这个小节（作者自己删了）：补一个到自动块之前
        const marker = text.indexOf(AUTO_BEGIN)
        const block = `${heading}\n\n${line}\n\n`
        text = marker === -1 ? text.replace(/\s+$/, '') + '\n\n' + block : text.slice(0, marker) + block + text.slice(marker)
      } else {
        const headEnd = text.indexOf('\n', at) + 1
        const rest = text.slice(headEnd)
        const nextSection = rest.search(/^##\s/m)
        const cut = nextSection === -1 ? rest.indexOf(AUTO_BEGIN) : nextSection
        const sectionEnd = cut === -1 ? text.length : headEnd + cut
        const before = text.slice(0, sectionEnd).replace(/\s+$/, '')
        const after = text.slice(sectionEnd)
        text = before + '\n' + line + '\n\n' + after.replace(/^\n+/, '')
      }
      added += 1
    }
  }
  return { text, added }
}

/** 把某篇候选里被标为 good 的段落，汇总成证据摘录里的条目。 */
function buildProfileSection(file, segments, marks) {
  const good = []
  const bad = []
  for (const [key, mark] of Object.entries(marks)) {
    const idx = Number(key)
    if (!Number.isInteger(idx) || segments[idx] === undefined) continue
    if (mark === 'good') good.push(segments[idx])
    if (mark === 'bad') bad.push(segments[idx])
  }
  const lines = [`## ${basename(file)}`, '']
  if (good.length > 0) {
    lines.push('### 作者选中的段落（好用）', '')
    for (const s of good) lines.push(`> ${s.replace(/\n/g, ' ')}`, '')
  }
  if (bad.length > 0) {
    lines.push('### 作者否决的段落（别再用）', '')
    for (const s of bad) lines.push(`> ${s.replace(/\n/g, ' ')}`, '')
  }
  if (good.length === 0 && bad.length === 0) lines.push('（本篇尚无标注）', '')
  return lines.join('\n')
}

// ── 提炼：把"标注原文"压成"规律" ─────────────────────────────────────────

/**
 * 惰性加载平台的 LLM 包。
 *
 * 之前这里是顶层静态 import：一旦将来某个 dsh 版本把它改名/拆包/改导出，
 * 整个宿主半区会在加载时就崩——连"点好/坏、写档案、存证据"都用不了。
 * 现在只有真的点「提炼规律」时才去加载，报错也只影响提炼这一步。
 */
let llmModule
async function loadLlmModule() {
  if (llmModule === undefined) {
    llmModule = await import('@deepseek-ai/dsh-llm').catch(() => null)
  }
  return llmModule
}
// 原文只进这一次便宜的辅助调用；作者采纳后，进档案、进下一轮上下文的只有规律。

/** 提炼的系统提示：只要规律，不要原文，句句可执行。 */
const DISTILL_SYSTEM = [
  '你是中文网文的老责编。作者在一批候选稿上手工标了"好"和"坏"的段落，',
  '你的活是把这些标注压成可复用的写作规律，供下一轮改稿直接照做。',
  '',
  '严格按下面的格式输出，不要任何别的内容（不要开场白、不要解释、不要总结）：',
  '',
  '喜欢：',
  '- 让在场群像先静默再爆响',
  '- 危险降临先写器物异动，再写人的闷哼',
  '避免：',
  '- 不要用比喻堆砌来写人群的恐惧',
  '- 不要在施法后补旁白解释动机',
  '',
  '每条规律的要求：',
  '1. 不超过 40 个字；"喜欢"写要怎么做，"避免"写不要怎么做。',
  '2. 一条只讲一件事，不要写成"A，别 B"这种对比句；避免项直接用"不要"或"别"开头。',
  '3. 严禁抄原文、严禁引用原句、严禁出现"这段/该段/第X段/作者"这类指代。',
  '4. 不要评价（"写得很好""节奏不错"），要写做法（"用干巴巴的一句话接住重击"）。',
  '5. 规律要能同时解释好几条标注；只出现一次的偶然现象不要写。',
  '6. 每节最多 8 条；证据不够就少写，不凑数。',
].join('\n')

/** 把待提炼的原文拼成有界的输入（段数与总字节都有上限）。 */
function buildDistillInput(pending) {
  const picked = pending.slice(0, DISTILL.maxSegments)
  const lines = []
  let bytes = 0
  let used = 0
  for (const entry of picked) {
    const clipped = entry.text.replace(/\s+/g, ' ').slice(0, DISTILL.maxCharsPerSegment)
    const line = `${entry.mark === 'good' ? '[好]' : '[坏]'} ${basename(entry.file)}：${clipped}`
    const size = Buffer.byteLength(line, 'utf8') + 1
    if (bytes + size > DISTILL.maxInputBytes) break
    lines.push(line)
    bytes += size
    used += 1
  }
  return { text: lines.join('\n'), used, total: pending.length }
}

/** 小节标题：`喜欢：` / `避免：`（允许 # 号、粗体、全角冒号）。 */
function sectionKindOf(line) {
  const flat = line.replace(/[#*\s]/g, '')
  if (!/[：:]$/.test(flat)) return null
  const label = flat.replace(/[：:]$/, '')
  if (label === '' || label.length > 12) return null
  if (/避免|别|忌|不要|不喜欢|删|扣分/.test(label)) return 'bad'
  if (/喜欢|偏好|要学|保留|加分|优点/.test(label)) return 'good'
  return null
}

/** 条目行：`- xxx`、`+ xxx`、`1. xxx`、`• xxx`（全角符号也算）。 */
function bulletOf(line) {
  const matched = /^([-*•·+]|[＋−－–]|\d+[.、)])\s*(.*)$/.exec(line)
  if (matched === null) return { marker: '', text: line }
  return { marker: matched[1], text: matched[2] }
}

const cleanRule = (text) =>
  String(text)
    .replace(/[`*]/g, '')
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
    .replace(/^规律[一二三四五六七八九十\d]*[：:、.]?\s*/, '')
    .replace(/\s*[（(]第[^）)]*[）)]\s*$/, '')
    .trim()

/**
 * 把模型输出解析成规律条目。两种写法都认：
 * - 分节：`喜欢：` / `避免：` 下的列表（提示词要求的格式）；
 * - 标记：行首 `+` / `-`（模型自作主张时也能救回来）。
 * 分节优先：进了小节，条目方向由小节决定，`- ` 只是列表符号。
 */
function parseDistillOutput(text) {
  const items = []
  let section = null
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\r$/, '').trim()
    if (line === '' || /^```/.test(line)) continue
    const heading = sectionKindOf(line)
    if (heading !== null) {
      section = heading
      continue
    }
    const bullet = bulletOf(line)
    const body = cleanRule(bullet.text)
    let kind = section
    if (kind === null) {
      if (bullet.marker === '+' || bullet.marker === '＋') kind = 'good'
      else if (bullet.marker === '-' || bullet.marker === '−' || bullet.marker === '－' || bullet.marker === '–') kind = 'bad'
    }
    if (kind === null) continue // 既不在小节里、也没有 +/- 标记：当解释性文字丢掉
    if (bullet.marker === '' && section === null) continue
    if (body.length < 4 || body.length > 200) continue
    items.push({ kind, text: body })
  }
  const seen = new Set()
  return items.filter((item) => {
    const key = item.kind + '|' + item.text
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** 提炼走哪条模型路由：设置里指定了就用它，否则用 dsh 当前的默认模型。 */
function resolveDistillRoute(ctx, config) {
  const provider = String(config.distillProvider ?? '').trim()
  const model = String(config.distillModel ?? '').trim()
  if (provider !== '' && model !== '') return { provider, model }
  const fallback = ctx.get('agentDefaultModel')
  if (fallback !== undefined && typeof fallback.currentSelection === 'function') {
    let selection
    try {
      selection = fallback.currentSelection()
    } catch {
      selection = undefined // 读不到默认模型就当作没有路由
    }
    const chosenProvider = selection === null || selection === undefined ? '' : String(selection.provider ?? '').trim()
    const chosenModel = selection === null || selection === undefined ? '' : String(selection.model ?? '').trim()
    if (chosenProvider !== '' && chosenModel !== '') return { provider: chosenProvider, model: chosenModel }
  }
  return null
}

/**
 * 一次性的辅助模型调用：流式收完，拼成纯文本。
 * @returns { text, finish } —— finish 用来区分"正常结束"和"被截断/报错"
 */
async function callDistillModel(llm, route, input) {
  const dshLlm = await loadLlmModule()
  if (dshLlm === null || typeof dshLlm.BlockAssembler !== 'function') {
    throw new Error('这个 dsh 的 @deepseek-ai/dsh-llm 不可用（版本不兼容？）：把「证据摘录.md」交给你的 agent 也能提炼')
  }
  const { BlockAssembler, createUserMessage, deepFreeze } = dshLlm
  const options = (withEffort) =>
    deepFreeze({
      provider: route.provider,
      model: route.model,
      system: DISTILL_SYSTEM,
      messages: [
        createUserMessage({
          content: [{ type: 'text', text: `以下是作者标注的段落，请压成规律：\n\n${input}` }],
          source: { kind: 'plugin', plugin: 'dsh-novel-craft' },
        }),
      ],
      maxTokens: DISTILL.maxOutputTokens,
      signal: AbortSignal.timeout(DISTILL.timeoutMs),
      // 压缩任务不需要思考链；不关掉的话推理会吃掉输出预算，正文可能一个字都没有
      ...(withEffort ? { reasoningEffort: DISTILL.reasoningEffort } : {}),
    })

  const run = async (withEffort) => {
    const assembler = new BlockAssembler()
    for await (const chunk of llm.stream(options(withEffort))) assembler.push(chunk)
    const finish = assembler.finish
    if (finish !== undefined && finish !== null && (finish.kind === 'error' || finish.kind === 'aborted')) {
      throw new Error(`提炼调用失败：${finish.failure === undefined ? '未知错误' : String(finish.failure.message)}`)
    }
    const text = assembler
      .blocks()
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
    return { text, finish: finish === undefined || finish === null ? 'stop' : finish.kind }
  }

  try {
    return await run(true)
  } catch (error) {
    // 换到不认这个推理档位的模型时，退一步再试一次（别的错误照抛）
    const message = error instanceof Error ? error.message : String(error)
    if (!/reasoning effort/i.test(message)) throw error
    return await run(false)
  }
}

// ── 「推荐目录」扫描 ─────────────────────────────────────────────────────
// 作者不该记路径：工作台打开时直接列出"含候选稿的目录"，点一下就选中。

/** 扫描时永不进入的目录名（依赖、缓存、版本库、构建产物）。 */
const SKIP_DIRS = new Set([
  'node_modules', 'bower_components', 'dist', 'build', 'out', 'target',
  '__pycache__', 'venv', '.venv', 'site-packages', '.cache', '.gradle',
  '.idea', '.vscode', '.next', '.nuxt', '.terraform', 'coverage',
])

/** 目录名像"候选稿"的加分项——抽卡工作台多数时候就选这类目录。 */
const CANDIDATE_HINT = /候选|抽卡|对比|三版|重写|代理稿|定稿|草稿|candidate|draft|variant/i

/** 归档/备份类目录降权：它们是证据，不是这一轮要挑的卡池。 */
const ARCHIVE_HINT = /归档|存档|历史|备份|旧稿|archive|backup|deprecated|\bold\b/i

/** 扫描边界：广度优先，深度/访问量/单目录条数都有上限，避免在工作盘上乱翻。 */
const SCAN = { maxDepth: 6, maxVisited: 2000, maxResults: 40, maxEntries: 512, cacheMs: 5000 }

/** 一个目录里"直接"放着的候选稿篇数（不递归；目录不存在或读不了就是 0）。 */
async function countDrafts(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    let count = 0
    for (const entry of entries) {
      if (entry.isFile() && TEXT_EXT.has(extname(entry.name).toLowerCase())) count += 1
    }
    return count
  } catch {
    return 0
  }
}

/**
 * 扫出含候选稿的目录。目录名像"候选稿"的排前面，其次篇数多的，
 * 再次层级浅、改动新的——顺序即工作台里「推荐」的展示顺序。
 */
async function scanDraftDirs(roots) {
  const found = []
  const queue = roots.map((root) => ({ dir: root, root, depth: 0 }))
  let visited = 0
  while (queue.length > 0 && visited < SCAN.maxVisited && found.length < SCAN.maxResults * 4) {
    const node = queue.shift()
    visited += 1
    let entries
    try {
      entries = await readdir(node.dir, { withFileTypes: true })
    } catch {
      continue // 权限、竞态、软链断裂：跳过这一支
    }
    if (entries.length > SCAN.maxEntries) continue // 超大目录基本是数据盘，不进
    const subdirs = []
    let count = 0
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
        subdirs.push(entry.name)
      } else if (entry.isFile() && TEXT_EXT.has(extname(entry.name).toLowerCase())) {
        count += 1
      }
    }
    if (count > 0) {
      let mtime = 0
      try {
        mtime = (await stat(node.dir)).mtimeMs
      } catch {
        // 拿不到时间就不参与新旧排序，不影响入选
      }
      found.push({
        path: node.dir,
        root: node.root,
        rel: relative(node.root, node.dir),
        depth: node.depth,
        count,
        mtime,
      })
    }
    if (node.depth < SCAN.maxDepth) {
      for (const name of subdirs) queue.push({ dir: join(node.dir, name), root: node.root, depth: node.depth + 1 })
    }
  }
  // 排序＝目录名像不像候选稿 ＞ 篇数 ＞ 新不新 ＞ 层级浅；归档/备份类整体降权。
  const now = Date.now()
  const DAY = 24 * 60 * 60 * 1000
  const score = (row) => {
    let total = Math.min(row.count, 60) * 10 - row.depth * 3
    if (CANDIDATE_HINT.test(basename(row.path))) total += 1000
    if (ARCHIVE_HINT.test(row.path)) total -= 400
    if (row.mtime > 0) {
      const age = now - row.mtime
      if (age < DAY) total += 40
      else if (age < 7 * DAY) total += 20
    }
    return total
  }
  found.sort((a, b) => score(b) - score(a) || b.mtime - a.mtime)
  return found.slice(0, SCAN.maxResults)
}

/**
 * 扫描根：优先当前候选目录的邻居（"我上次就在这一带"），
 * 其次 GUI 里已注册的作品目录，最后进程 cwd。不存在的一律剔除。
 */
function scanRoots(ctx, configured) {
  const out = []
  const add = (path) => {
    if (typeof path !== 'string' || path === '') return
    const clean = path.replace(/\/+$/, '') || '/'
    if (out.includes(clean) || !existsSync(clean)) return
    out.push(clean)
  }
  if (configured !== '') add(dirname(configured))
  const registry = ctx.get('workspaceRegistry')
  if (registry !== undefined && typeof registry.list === 'function') {
    try {
      for (const item of registry.list()) add(item.path)
    } catch {
      // 注册表不可用就退到 cwd
    }
  }
  add(process.cwd())
  return out.slice(0, 3)
}

/** 读取/解析 POST body（上限 4MB）。 */
function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    let tooLarge = false
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 4 * 1024 * 1024) {
        tooLarge = true
        try { req.destroy() } catch { /* 已销毁 */ }
        resolve({ __error: 'payload too large (max 4MB)' })
      }
    })
    req.on('end', () => {
      if (tooLarge) return
      try {
        resolve(raw === '' ? {} : JSON.parse(raw))
      } catch {
        resolve({ __error: 'invalid JSON body' })
      }
    })
  })
}

/** 回环判定：只服务本机浏览器，避免把作品目录暴露到网络。 */
function isLoopback(req) {
  const addr = String(req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '').toLowerCase()
  return addr === '127.0.0.1' || addr === '::1' || addr === 'localhost'
}

/**
 * 等一批服务就绪。
 *
 * 实机踩到的问题：在较新的 dsh 里，插件行的 apply **可能早于服务挂载**——
 * 同步 apply 里 `ctx.get('webServer')` 会拿到 undefined，于是插件静默什么都不做。
 * 所以这里改用 `ctx.inject` 等它们到位；等不到（例如 headless profile 没有 web 服务）
 * 就按"本插件无事可做"退出，而不是永远挂着。
 */
async function awaitServices(ctx, names, timeoutMs) {
  return await new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    try {
      ctx.inject(names, (ready) => finish(ready))
    } catch {
      finish(null)
    }
    setTimeout(() => finish(null), timeoutMs).unref?.()
  })
}

export async function apply(ctx) {
  const ready = await awaitServices(ctx, ['settings', 'webServer'], 15000)
  if (ready === null || ready.settings === undefined || ready.webServer === undefined) return
  const scope = await ready.settings.register(NS, configSchema)
  const cfg = () => scope.get()
  const dirOf = () => String(cfg().candidateDir ?? '')

  /** 汇总/提炼的公共上下文：标注、待提炼、证据文件、档案。 */
  const gather = async (dir) => {
    const [candidates, marks, distilled, profile, evidence] = await Promise.all([
      readCandidates(dir),
      readMarks(dir),
      readDistillState(dir),
      readProfileInfo(dir),
      readEvidenceInfo(dir),
    ])
    const pending = pendingEntries(candidates, marks, distilled)
    return {
      candidates,
      marks,
      distilled,
      profile,
      evidence,
      pending,
      stats: markStats(candidates, marks, pending, distilled),
    }
  }

  /** 写证据摘录 + 刷新档案自动块；旧版整份自动生成的档案顺带备份并迁移。 */
  const refreshArtifacts = async (dir, data) => {
    await mkdir(stateDirOf(dir), { recursive: true })
    const now = new Date().toISOString()
    await writeFile(evidencePathOf(dir), buildEvidenceDoc(dir, data.candidates, data.marks, now), 'utf8')
    await writeFile(profilePathOf(dir), composeProfile({ stats: data.stats, existing: data.profile.text, dir }), 'utf8')
    if (data.profile.text.includes(GENERATED_HINT) && !data.profile.text.includes(AUTO_BEGIN)) {
      // 旧档案（整份都是原文摘录）：原文已在证据摘录里，这里留个备份就走
      await writeFile(join(stateDirOf(dir), LEGACY_BACKUP_FILE), data.profile.text, 'utf8')
    }
    return { now, evidence: await readEvidenceInfo(dir), profile: await readProfileInfo(dir) }
  }

  /** 「推荐目录」的短时缓存：同一批扫描根 5 秒内复用，避免连点重扫。 */
  let discoverCache = { key: '', at: 0, dirs: [] }

  const webServer = ready.webServer
  if (typeof webServer.register !== 'function') return

  const route = (path, handler) => {
    webServer.register({
      kind: 'exact',
      path: API_PREFIX + path,
      handler: (req, res) => {
        const send = (status, body) => {
          res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify(body))
        }
        if (!isLoopback(req)) {
          send(403, { error: 'novel-craft api is loopback-only' })
          return
        }
        if (cfg().enabled === false) {
          send(503, { error: 'novel-craft disabled' })
          return
        }
        Promise.resolve()
          .then(async () => {
            const body = req.method === 'POST' ? await readJsonBody(req) : {}
            if (body.__error !== undefined) {
              send(413, { error: body.__error })
              return
            }
            const result = await handler(body)
            if (!res.writableEnded) send(200, result)
          })
          .catch((error) => {
            if (!res.writableEnded) send(400, { error: error instanceof Error ? error.message : String(error) })
          })
      },
    })
  }

  // 工作台首屏：候选段落 + 标注 + 规律档案 + 证据摘录 + 待提炼
  route('state', async () => {
    const dir = dirOf()
    const data = dir === '' ? null : await gather(dir)
    const route = resolveDistillRoute(ctx, cfg())
    return {
      candidateDir: dir,
      enabled: cfg().enabled !== false,
      candidates: data === null ? [] : data.candidates,
      marks: data === null ? {} : data.marks,
      profile: data === null ? '' : data.profile.text,
      profilePath: dir === '' ? '' : profilePathOf(dir),
      profileUpdatedAt: data === null ? '' : data.profile.updatedAt,
      evidencePath: dir === '' ? '' : evidencePathOf(dir),
      evidenceCount: data === null ? 0 : data.evidence.count,
      evidenceBytes: data === null ? 0 : data.evidence.bytes,
      pending: data === null ? 0 : data.pending.length,
      stats: data === null ? { total: 0, good: 0, bad: 0, files: 0, pending: 0, lastDistill: '' } : data.stats,
      distillRoute: route === null ? '' : `${route.provider}/${route.model}`,
      distillReady: route !== null && ctx.get('llm') !== undefined,
      rawOutputPath: dir === '' ? '' : join(stateDirOf(dir), RAW_OUTPUT_FILE),
    }
  })

  // 作者点 好/坏：把某篇某段落的标注落盘
  route('marks', async (body) => {
    const dir = dirOf()
    if (dir === '') throw new Error('candidateDir 未配置：请先在工作台里填写候选目录')
    const { file, index, mark } = body
    if (typeof file !== 'string' || !Number.isInteger(index)) throw new Error('file/index 参数不合法')
    if (mark !== 'good' && mark !== 'bad' && mark !== null) throw new Error('mark 只能是 good / bad / null')
    const marks = await readMarks(dir)
    const entry = marks[file] !== undefined && typeof marks[file] === 'object' ? marks[file] : {}
    if (mark === null) delete entry[String(index)]
    else entry[String(index)] = mark
    if (Object.keys(entry).length === 0) delete marks[file]
    else marks[file] = entry
    await writeMarks(dir, marks)
    return { marks }
  })

  // 自动发现：把"含候选稿的目录"直接端给工作台，作者不用记路径
  route('discover', async () => {
    const roots = scanRoots(ctx, dirOf())
    const key = roots.join('|')
    const now = Date.now()
    if (discoverCache.key === key && now - discoverCache.at < SCAN.cacheMs) {
      return { roots, dirs: discoverCache.dirs, cached: true }
    }
    const dirs = await scanDraftDirs(roots)
    discoverCache = { key, at: now, dirs }
    return { roots, dirs, cached: false }
  })

  // 目录徽标：给选择器里每个子目录回一个候选稿篇数
  route('annotate', async (body) => {
    const paths = Array.isArray(body.paths)
      ? body.paths.filter((p) => typeof p === 'string' && p !== '').slice(0, 60)
      : []
    const counts = {}
    for (const path of paths) counts[path] = await countDrafts(path)
    return { counts }
  })

  // 收录证据：原文写进「证据摘录.md」，档案只刷新自动块（规律区不动）
  route('evidence', async () => {
    const dir = dirOf()
    if (dir === '') throw new Error('candidateDir 未配置：请先选候选目录')
    const data = await gather(dir)
    if (data.stats.total === 0) throw new Error('还没有任何标注，先把候选稿读一遍再点好/坏')
    const written = await refreshArtifacts(dir, data)
    return {
      evidencePath: written.evidence.path,
      evidenceCount: written.evidence.count,
      evidenceBytes: written.evidence.bytes,
      profile: written.profile.text,
      profileUpdatedAt: written.profile.updatedAt,
      stats: data.stats,
    }
  })

  // 提炼规律：把待提炼的标注原文交给一次便宜的辅助调用，压成规律条目待采纳
  route('distill', async () => {
    const dir = dirOf()
    if (dir === '') throw new Error('candidateDir 未配置：请先选候选目录')
    const data = await gather(dir)
    if (data.pending.length === 0) throw new Error('没有待提炼的新标注：先去「抽卡」点几段好/坏')
    const llm = ctx.get('llm')
    if (llm === undefined || typeof llm.stream !== 'function') {
      throw new Error('这个 dsh 没挂 LLM 服务：把「证据摘录.md」交给你的 agent 提炼也行')
    }
    const route = resolveDistillRoute(ctx, cfg())
    if (route === null) throw new Error('没有可用的模型路由：在设置里填 dsh-novel-craft 的 distillProvider / distillModel')
    await refreshArtifacts(dir, data) // 先把原文落到证据摘录，再送去提炼
    const input = buildDistillInput(data.pending)
    const answer = await callDistillModel(llm, route, input.text)
    // 模型原话一律留档：格式没对上时，作者和我都靠它排查
    const rawPath = join(stateDirOf(dir), RAW_OUTPUT_FILE)
    await writeFile(
      rawPath,
      [
        '# 提炼原始输出',
        '',
        `> 模型：${route.provider}/${route.model} · 结束原因：${answer.finish} · 时间：${new Date().toISOString()}`,
        '> 工作台每次提炼都会覆盖本文件；写稿会话不用读它。',
        '',
        answer.text === '' ? '（模型没有输出正文）' : answer.text,
        '',
      ].join('\n'),
      'utf8',
    )
    const items = parseDistillOutput(answer.text)
    if (items.length === 0) {
      const why =
        answer.finish === 'max-tokens'
          ? '模型输出被长度上限截断'
          : answer.text.trim() === ''
            ? '模型只输出了思考、没有正文'
            : '模型没按「喜欢：/ 避免：」的格式输出'
      const snippet = answer.text.replace(/\s+/g, ' ').trim().slice(0, 80)
      throw new Error(`${why}（原话见 .dsh-novel-craft/${RAW_OUTPUT_FILE}${snippet === '' ? '' : '：' + snippet}）`)
    }
    return {
      items,
      model: `${route.provider}/${route.model}`,
      pending: data.pending.length,
      used: input.used,
      capped: input.used < input.total,
      evidencePath: evidencePathOf(dir),
      rawPath,
      finish: answer.finish,
    }
  })

  // 采纳规律：写进档案的规律区（幂等），并把水位推到已采纳的那批标注
  route('rules', async (body) => {
    const dir = dirOf()
    if (dir === '') throw new Error('candidateDir 未配置：请先选候选目录')
    const items = Array.isArray(body.items)
      ? body.items
          .filter((item) => item !== null && typeof item === 'object' && typeof item.text === 'string')
          .slice(0, 60)
      : []
    if (items.length === 0) throw new Error('没有要采纳的规律条目')
    const data = await gather(dir)
    const written = await refreshArtifacts(dir, data)
    const { text, added } = insertRules(written.profile.text, items)
    await writeFile(profilePathOf(dir), text, 'utf8')
    const values = { ...data.distilled.values }
    for (const entry of data.pending) values[`${entry.file}#${entry.index}`] = entry.mark
    const at = new Date().toISOString()
    const model = typeof body.model === 'string' ? body.model : ''
    await writeDistillState(dir, { values, model, at })
    const after = await gather(dir)
    const info = await readProfileInfo(dir)
    return {
      added,
      profile: info.text,
      profileUpdatedAt: info.updatedAt,
      stats: after.stats,
      pending: after.pending.length,
    }
  })

  // 读证据摘录正文：界面上"展开看原文"用（不进 state，免得每次首屏都拖着几 KB）
  route('evidence-text', async () => {
    const dir = dirOf()
    if (dir === '') throw new Error('candidateDir 未配置：请先选候选目录')
    const info = await readEvidenceInfo(dir)
    return { text: info.text, path: info.path, count: info.count, bytes: info.bytes }
  })

  // 界面上直接改档案：作者追记的话不该只在编辑器里存在
  route('profile', async (body) => {
    const dir = dirOf()
    if (dir === '') throw new Error('candidateDir 未配置：请先选候选目录')
    const { content } = body
    if (typeof content !== 'string') throw new Error('content 必须是字符串')
    if (content.length > MAX_PROFILE_CHARS) throw new Error(`档案太大（上限 ${MAX_PROFILE_CHARS} 字符）`)
    await mkdir(stateDirOf(dir), { recursive: true })
    await writeFile(profilePathOf(dir), content, 'utf8')
    const info = await readProfileInfo(dir)
    return { path: info.path, profile: info.text, profileUpdatedAt: info.updatedAt }
  })
}

// 纯函数导出，便于单测与复用（工作台分段、偏好档案生成、推荐目录扫描）
// 纯函数导出，便于单测与复用（分段、规律写入、证据摘录、推荐目录、提炼解析）
export {
  splitSegments,
  buildProfileSection,
  composeProfile,
  insertRules,
  profileSkeleton,
  buildEvidenceDoc,
  buildDistillInput,
  parseDistillOutput,
  pendingEntries,
  markStats,
  scanDraftDirs,
  scanRoots,
  countDrafts,
  AUTO_BEGIN,
  AUTO_END,
  DISTILL_SYSTEM,
}
