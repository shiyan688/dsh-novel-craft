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
 * 0.2 起，工作台不再只管"抽卡"这一件事，而是能陪着把一本书写完：
 *   GET  project    → 自动认出"作品根"（正文/设定/人物/剧情/轮次的共同上级），作者只需确认
 *   GET  workspace  → 章节看板：每章字数、轮次、标注、批注、写作包、评分、张力
 *   POST chapter    → 单章详情（正文段落 + 批注 + 本章设定 + 写作包情况）
 *   POST annotation → 正文里就地留批注（加/改/删）
 *   POST pack       → 生成/刷新「写作包.md」：写稿会话唯一需要读的文件
 *   POST revise     → 按批注生成微调稿：**只改被批注的段落**，逐字核对后才落盘
 *   POST revise-apply → 采纳微调稿写回正文（原稿自动备份），批注标记为已解决
 *   POST tension    → 作者手工标本章张力（1-5），供情节曲线使用
 *   POST check      → 账目体检 + 情节体检（本地规则，正文不进模型上下文）
 *   POST stage      → 阶段门禁与阶段产物起草（立项/设定/人物/大纲/正文/修订/完本）
 *
 * 三层产物与批注的关系：批注是**给人的改稿清单**，只有作者点「微调」时，
 * 被批注的那几段才进一次模型调用；写作包里只报"还有几条未处理批注"。
 *
 * 与 dsh-novel-solo 的关系：禁AI腔六维度改编自其 MIT 许可的 persona（见 THIRD_PARTY_NOTICES.md）。
 */
import { readFile, writeFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname, basename, dirname, relative } from 'node:path'
import z from '@deepseek-ai/schemastery'

// 0.2 的核心能力拆在 lib/core/ 下，各模块之间只共享 text.js：
// 这样每个模块都能单独拿假数据写单测，也不会为了一个功能改动去动另一个。
import { TEXT_EXT, charCount, clip, readJsonSafe, readTextSafe, splitSegments, statSafe, writeJson } from './core/text.js'
import * as W from './core/workspace.js'
import * as PACK from './core/pack.js'
import * as ANN from './core/annotate.js'
import * as LEDGER from './core/ledger.js'
import * as PLOT from './core/plot.js'
import * as PIPE from './core/pipeline.js'
import * as PROV from './core/provenance.js'
import * as DRAFT from './core/draft.js'
import { callModel, finishReason, resolveRoute } from './core/llm.js'

export const name = 'dsh-novel-craft'

const NS = 'dsh-novel-craft'
const API_PREFIX = '/novel-craft/api/'
const STATE_DIR = '.dsh-novel-craft'
const MARKS_FILE = 'marks.json'
const PROFILE_FILE = '作者偏好档案.md'

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
/** 抽卡页给"选中段落"写的一句取用原因：合并时直接进「取用段落表」。 */
const REASONS_FILE = '取用理由.json'
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
  /** 作品根（含正文/设定/人物/剧情的那一层）。留空＝从候选目录自动推导。 */
  projectDir: z.string().default(''),
  /** 单章目标字数：写作包里按 ±25% 给出字数要求 */
  targetChapterWords: z.number().default(3000),
})

const stateDirOf = (dir) => join(dir, STATE_DIR)
const marksPathOf = (dir) => join(stateDirOf(dir), MARKS_FILE)
const profilePathOf = (dir) => join(stateDirOf(dir), PROFILE_FILE)
const evidencePathOf = (dir) => join(stateDirOf(dir), EVIDENCE_FILE)
const distillPathOf = (dir) => join(stateDirOf(dir), DISTILL_FILE)

async function readMarks(dir) {
  try {
    const raw = await readFile(marksPathOf(dir), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** 取用理由：单独一个文件，不动 marks.json 的形状（老版本读它也不会坏）。 */
async function readReasons(dir) {
  try {
    const parsed = JSON.parse(await readFile(join(stateDirOf(dir), REASONS_FILE), 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function writeReasons(dir, reasons) {
  await mkdir(stateDirOf(dir), { recursive: true })
  await writeFile(join(stateDirOf(dir), REASONS_FILE), JSON.stringify(reasons, null, 2), 'utf8')
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
      return {
        values: parsed.values,
        model: String(parsed.model ?? ''),
        at: String(parsed.at ?? ''),
        // 上次提炼时"编号 → 标注"的对照表：采纳规律时用它写「规则来源」
        refs: Array.isArray(parsed.refs) ? parsed.refs : [],
      }
    }
  } catch {
    // 没有水位文件 = 一段都还没提炼
  }
  return { values: {}, model: '', at: '', refs: [] }
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

// 原文只进这一次便宜的辅助调用；作者采纳后，进档案、进下一轮上下文的只有规律。
// 具体的调用实现（含"关掉思考链""被截断的原因带回来""不认 reasoningEffort 时退一步"）
// 统一放在 core/llm.js，提炼、批注微调、阶段起草三条路径共用同一套行为。

/** 提炼的系统提示：只要规律，不要原文，句句可执行。 */
const DISTILL_SYSTEM = [
  '你是中文网文的老责编。作者在一批候选稿上手工标了"好"和"坏"的段落，',
  '你的活是把这些标注压成可复用的写作规律，供下一轮改稿直接照做。',
  '',
  '严格按下面的格式输出，不要任何别的内容（不要开场白、不要解释、不要总结）：',
  '',
  '喜欢：',
  '- 让在场群像先静默再爆响（来自 2、5、9）',
  '- 危险降临先写器物异动，再写人的闷哼（来自 1、7）',
  '避免：',
  '- 不要用比喻堆砌来写人群的恐惧（来自 3、4、11）',
  '- 不要在施法后补旁白解释动机（来自 6、10）',
  '',
  '每条规律的要求：',
  '1. 不超过 40 个字；"喜欢"写要怎么做，"避免"写不要怎么做。',
  '2. 一条只讲一件事，不要写成"A，别 B"这种对比句；避免项直接用"不要"或"别"开头。',
  '3. 严禁抄原文、严禁引用原句、严禁出现"这段/该段/第X段/作者"这类指代。',
  '4. 不要评价（"写得很好""节奏不错"），要写做法（"用干巴巴的一句话接住重击"）。',
  '5. 规律要能同时解释好几条标注；只出现一次的偶然现象不要写。',
  '6. 每节最多 8 条；证据不够就少写，不凑数。',
  '7. 每条末尾必须用「（来自 3、7）」注明它是从输入里哪几条标注看出来的——只写编号，',
  '   不要写文件名、不要抄原文。作者会点开这条规律回看那几段原文，编号错了他一眼就发现。',
].join('\n')

/**
 * 把待提炼的原文拼成有界的输入（段数与总字节都有上限）。
 *
 * 每行带序号：模型被要求在每条规律末尾写「（来自 3、7）」，
 * 这样"规律 → 证据"的反查才成立（refs 就是序号到标注的对照表）。
 */
function buildDistillInput(pending) {
  const picked = pending.slice(0, DISTILL.maxSegments)
  const lines = []
  const refs = []
  let bytes = 0
  let used = 0
  for (const entry of picked) {
    const clipped = entry.text.replace(/\s+/g, ' ').slice(0, DISTILL.maxCharsPerSegment)
    const line = `${used + 1}. ${entry.mark === 'good' ? '[好]' : '[坏]'} ${basename(entry.file)}：${clipped}`
    const size = Buffer.byteLength(line, 'utf8') + 1
    if (bytes + size > DISTILL.maxInputBytes) break
    lines.push(line)
    refs.push({ file: entry.file, index: entry.index, mark: entry.mark, text: clipped })
    bytes += size
    used += 1
  }
  return { text: lines.join('\n'), used, total: pending.length, refs }
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

/** 规律末尾的来源标注：`（来自 3、7）` / `(来源：3,7)` / `【证据 3、7】`。 */
const SOURCE_RE = /[（(【\[]\s*(?:来自|来源|证据|依据)\s*[:：]?\s*([0-9,，、\s]+)\s*[）)】\]]\s*$/

/** 从一条规律里拆出正文与来源编号。 */
function splitSources(text) {
  const raw = String(text)
  const matched = SOURCE_RE.exec(raw)
  if (matched === null) return { text: raw, sources: [] }
  const sources = matched[1]
    .split(/[,，、\s]+/)
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1)
  return { text: raw.slice(0, matched.index).trim(), sources }
}

const cleanRule = (text) =>
  String(text)
    .replace(/[`*]/g, '')
    .replace(/^\d{1,3}\s*[.、)]\s*/, '')
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
    const split = splitSources(bullet.text)
    const body = cleanRule(split.text)
    let kind = section
    if (kind === null) {
      if (bullet.marker === '+' || bullet.marker === '＋') kind = 'good'
      else if (bullet.marker === '-' || bullet.marker === '−' || bullet.marker === '－' || bullet.marker === '–') kind = 'bad'
    }
    if (kind === null) continue // 既不在小节里、也没有 +/- 标记：当解释性文字丢掉
    if (bullet.marker === '' && section === null) continue
    if (body.length < 4 || body.length > 200) continue
    items.push({ kind, text: body, sources: split.sources })
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
  return resolveRoute(ctx, { provider: config.distillProvider, model: config.distillModel })
}

/**
 * 提炼调用：一次便宜的辅助调用，把标注原文压成规律。
 * 行为细节（思考链、超时、重试）都在 core/llm.js 里，与批注微调共用。
 */
async function callDistillModel(llm, route, input) {
  return callModel(llm, route, {
    system: DISTILL_SYSTEM,
    user: `以下是作者标注的段落，请压成规律：\n\n${input}`,
    maxTokens: DISTILL.maxOutputTokens,
    timeoutMs: DISTILL.timeoutMs,
    reasoningEffort: DISTILL.reasoningEffort,
  })
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

  /**
   * 找「作者偏好档案.md」。
   *
   * 抽卡时它的落点是"候选目录/.dsh-novel-craft/"；而作品级功能（写作包、情节体检）
   * 是从作品根出发的——作者完全可能把候选目录设在 `…/第9章/候选稿`，
   * 于是档案在子目录、作品根下反而没有。所以按 作品根 → 候选目录 → 有界扫描 找一遍，
   * 扫描时取**最近改过**的那一份（多份时以最新的为准，并把它报给界面）。
   */
  const findProfile = async (projectDir, candidateDir, runsBase) => {
    const direct = [join(projectDir, STATE_DIR, PROFILE_FILE), candidateDir === '' ? '' : join(candidateDir, STATE_DIR, PROFILE_FILE)]
    for (const path of direct) {
      if (path === '') continue
      const info = await readProfileInfo(dirname(dirname(path)))
      if (info.text.trim() !== '') return info
    }
    let best = { text: '', path: direct[0], updatedAt: '' }
    const roots = [projectDir, candidateDir, runsBase].filter((x) => typeof x === 'string' && x !== '')
    let visited = 0
    for (const root of roots) {
      const queue = [{ dir: root, depth: 0 }]
      while (queue.length > 0 && visited < 200) {
        const node = queue.shift()
        visited += 1
        const info = await readProfileInfo(node.dir)
        if (info.text.trim() !== '' && (best.text === '' || info.updatedAt > best.updatedAt)) best = info
        if (node.depth >= 3) continue
        try {
          for (const entry of await readdir(node.dir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue
            if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
            queue.push({ dir: join(node.dir, entry.name), depth: node.depth + 1 })
          }
        } catch {
          // 读不了的目录跳过：找档案不该让整个请求失败
        }
      }
    }
    return best
  }

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

  // 工作台首屏：候选段落 + 标注 + 规律档案 + 证据摘录 + 待提炼 + 作品标识
  route('state', async () => {
    const dir = dirOf()
    const data = dir === '' ? null : await gather(dir)
    const route = resolveDistillRoute(ctx, cfg())
    const project = await projectOf(false)
    return {
      candidateDir: dir,
      // 只给标识：章节明细由 workspace 路由按需取，免得每次打开工作台都扫全书
      project:
        project === null
          ? null
          : { dir: project.projectDir, name: project.name, source: project.source },
      targetChapterWords: cfg().targetChapterWords,
      enabled: cfg().enabled !== false,
      candidates: data === null ? [] : data.candidates,
      marks: data === null ? {} : data.marks,
      reasons: dir === '' ? {} : await readReasons(dir),
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
    // 取用原因（可选）：合并时进「取用段落表」，不写也不影响标注本身
    if (typeof body.reason === 'string') {
      const reasons = await readReasons(dir)
      const key = `${file}#${index}`
      if (body.reason.trim() === '') delete reasons[key]
      else reasons[key] = clip(body.reason.trim(), 200)
      await writeReasons(dir, reasons)
    }
    return { marks, reasons: await readReasons(dir) }
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
    // 编号表要留到"采纳"那一步：规律写进档案时才知道它的来源是哪几段
    await writeDistillState(dir, { ...data.distilled, refs: input.refs })
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
    // 采纳之后就把编号表作废（水位已经推到这个批次了）
    await writeDistillState(dir, { values, model, at, refs: [] })

    // 规律 → 证据：模型给了编号就用它；没给就本地兜底并标成"推测"
    const refs = data.distilled.refs.length > 0 ? data.distilled.refs : buildDistillInput(data.pending).refs
    const before = await PROV.readProvenance(dir)
    const map = PROV.attachProvenance({ existing: before, items, refs, at, model })
    await PROV.writeProvenance(dir, map)

    const after = await gather(dir)
    const info = await readProfileInfo(dir)
    return {
      added,
      profile: info.text,
      profileUpdatedAt: info.updatedAt,
      stats: after.stats,
      pending: after.pending.length,
      evidence: PROV.provenanceIndex(map),
      evidencePath: PROV.provenancePathOf(dir),
    }
  })

  // 规律 → 证据反查：界面点某条规律的「证据」时拉，一次拿全（十几条规律、几 KB）
  route('rule-evidence', async (body) => {
    const dir = dirOf()
    if (dir === '') throw new Error('candidateDir 未配置：请先选候选目录')
    const map = await PROV.readProvenance(dir)
    // 补齐来源：老档案里的规律没有编号可查，就用证据摘录做一次本地匹配（标成"推测"）
    if (String(body.action ?? '') === 'backfill') {
      const info = await readProfileInfo(dir)
      const evidence = await readEvidenceInfo(dir)
      const rules = PROV.rulesFromProfile(info.text)
      const refs = PROV.parseEvidenceDoc(evidence.text)
      if (refs.length === 0) throw new Error('「证据摘录.md」还是空的：先去抽卡标几段，来源才有东西可对')
      if (rules.length === 0) throw new Error('档案里还没有规律：先提炼并采纳几条再来补来源')
      const llm = ctx.get('llm')
      const route = llm === undefined ? null : resolveDistillRoute(ctx, cfg())
      let filled = null
      let filledBy = 'local'
      if (llm !== undefined && typeof llm.stream === 'function' && route !== null) {
        // 规律是抽象语言，词面早就对不上原文了——这一步交给模型判断，作者点开就能核
        const input = PROV.buildBackfillInput({ rules, refs })
        try {
          const answer = await callModel(llm, route, {
            system: PROV.backfillSystemPrompt(),
            user: input.text,
            maxTokens: 1200,
            timeoutMs: 120000,
          })
          const mapping = PROV.parseBackfillOutput(answer.text)
          if (Object.keys(mapping).length > 0) {
            filled = PROV.attachBackfill({ existing: map, rules, refs, mapping, model: `${route.provider}/${route.model}` })
            filledBy = 'model'
          }
        } catch {
          // 模型这条路不通（没路由/报错）就退回本地匹配，别让作者卡在这
        }
      }
      if (filled === null) filled = PROV.backfillProvenance({ existing: map, rules, refs })
      await PROV.writeProvenance(dir, filled.map)
      const index = PROV.provenanceIndex(filled.map)
      return {
        updatedAt: filled.map.updatedAt,
        path: PROV.provenancePathOf(dir),
        index,
        count: Object.keys(index).length,
        backfilled: {
          by: filledBy,
          added: filled.added,
          skipped: filled.skipped,
          unmatched: filled.unmatched === undefined ? 0 : filled.unmatched,
          rules: rules.length,
          refs: refs.length,
        },
      }
    }
    const index = PROV.provenanceIndex(map)
    return {
      updatedAt: map.updatedAt,
      path: PROV.provenancePathOf(dir),
      index,
      count: Object.keys(index).length,
      // 没有来源记录的规律也报个数：让作者知道"哪些规律是在记来源之前提炼的"
      missing: 0,
    }
  })

  // 读证据摘录正文：界面上"展开看原文"用（不进 state，免得每次首屏都拖着几 KB）
  route('evidence-text', async () => {
    const dir = dirOf()
    if (dir === '') throw new Error('candidateDir 未配置：请先选候选目录')
    const info = await readEvidenceInfo(dir)
    return { text: info.text, path: info.path, count: info.count, bytes: info.bytes }
  })

  // ══ 0.2：作品 → 章节 → 轮次 ═══════════════════════════════════════════
  //
  // 抽卡解决"这一段好不好"，解决不了"这本书写到哪儿了、下一章写什么"。
  // 下面这一组路由此负责：先认出作品根，再把每一章的状态摊开。

  /** 作品根：设置里填了就用它，否则从候选目录向上认（认出来的结果会缓存 30 秒）。 */
  let projectCache = { key: '', at: 0, value: null }
  const projectOf = async (force) => {
    const configured = String(cfg().projectDir ?? '').trim()
    if (configured !== '' && existsSync(configured)) {
      return { projectDir: configured, name: basename(configured), runsRoot: '', source: 'setting', candidates: [] }
    }
    const start = dirOf()
    if (start === '') return null
    const now = Date.now()
    if (!force && projectCache.key === start && now - projectCache.at < 30000 && projectCache.value !== null) {
      return projectCache.value
    }
    const detected = await W.detectProject(start)
    const value =
      detected.projectDir === ''
        ? null
        : {
            projectDir: detected.projectDir,
            name: detected.name,
            runsRoot: detected.runsRoot,
            source: 'auto',
            candidates: detected.candidates.slice(0, 8),
          }
    projectCache = { key: start, at: now, value }
    return value
  }

  /** 全书正文：体检要读，看板不要读（不然每开一次面板就把整本书拖进内存）。 */
  const chaptersWithText = async (projectDir, rows) => {
    const out = []
    let chars = 0
    for (const row of rows) {
      if (chars > 3_000_000) break
      const text = await readTextSafe(row.path)
      chars += charCount(text)
      out.push({ chapter: row.chapter, title: row.title, text })
    }
    return out
  }

  /** 体检结果缓存：同一作品 10 分钟内复用，避免连点重算。 */
  let checkCache = { key: '', at: 0, value: null }

  const runChecks = async (projectDir, rows, force) => {
    const key = projectDir + '|' + rows.length
    const now = Date.now()
    if (!force && checkCache.key === key && now - checkCache.at < 600000 && checkCache.value !== null) {
      return { ...checkCache.value, cached: true }
    }
    const chapters = await chaptersWithText(projectDir, rows)
    const ledger = await LEDGER.ledgerCheck({ projectDir, chapters })
    const outline = await readTextSafe(join(projectDir, '大纲.md'))
    const summaries = []
    for (const row of rows) {
      if (row.summary.exists) summaries.push({ chapter: row.chapter, text: await readTextSafe(row.summary.path) })
    }
    const scores = rows
      .filter((r) => r.comment.score !== null)
      .map((r) => ({ chapter: r.chapter, score: r.comment.score, count: r.comment.count }))
    const outlineNodes = outline.trim() === '' ? [] : PLOT.parseOutline(outline).chapters
    const manual = {}
    for (const row of rows) if (row.tension !== null) manual[String(row.chapter)] = row.tension
    const tensions = PLOT.buildTensionSeries({ chapters, outline: outlineNodes, summaries, manual })
    const plot = PLOT.detectPlotIssues({ chapters, outline: outlineNodes, summaries, tensions, scores })
    const value = {
      at: new Date().toISOString(),
      outlineMissing: outline.trim() === '',
      ledger: { findings: ledger.findings.slice(0, 200), summary: ledger.summary },
      plot: { findings: plot.findings.slice(0, 200), metrics: plot.metrics },
    }
    checkCache = { key, at: now, value }
    return { ...value, cached: false }
  }

  /** 每章挂了哪些体检问题（看板里显示成小徽标）。 */
  const findingsByChapter = (data) => {
    const map = new Map()
    const add = (finding) => {
      if (finding === null || finding === undefined || finding.chapter === null || finding.chapter === undefined) return
      const list = map.get(finding.chapter) === undefined ? [] : map.get(finding.chapter)
      list.push({ level: finding.level, code: finding.code, message: finding.message })
      map.set(finding.chapter, list)
    }
    if (data === null) return map
    for (const f of data.ledger.findings) add(f)
    for (const f of data.plot.findings) add(f)
    return map
  }

  // 作品根：GET 看认出来的结果与候选，POST 时确认下来（写进设置，之后不再猜）
  route('project', async (body) => {
    const action = String(body.action === undefined ? 'detect' : body.action)
    if (typeof scope.update !== 'function' && action !== 'detect') {
      throw new Error('这个 dsh 的 settings 不支持写入：请在设置里手填 dsh-novel-craft 的 projectDir')
    }
    if (action === 'set') {
      const dir = String(body.dir ?? '').trim()
      if (dir === '') throw new Error('目录不能为空')
      if (!existsSync(dir)) throw new Error('这个目录不存在：' + dir)
      await scope.update({ projectDir: dir })
      projectCache = { key: '', at: 0, value: null }
      return { projectDir: dir, name: basename(dir), source: 'setting', saved: true }
    }
    if (action === 'clear') {
      await scope.update({ projectDir: '' })
      projectCache = { key: '', at: 0, value: null }
      return { cleared: true }
    }
    const project = await projectOf(true)
    return {
      project: project === null ? null : { dir: project.projectDir, name: project.name, source: project.source },
      candidates: project === null ? [] : project.candidates,
      candidateDir: dirOf(),
    }
  })

  // 章节看板：这本书写到哪儿了。带上体检摘要与阶段状态，但正文一个字都不带。
  route('workspace', async (body) => {
    const project = await projectOf(false)
    if (project === null) {
      return { found: false, candidateDir: dirOf(), chapters: [], totals: null, hint: '还没认出作品目录：先在顶部选候选目录，或直接指定作品根' }
    }
    const ws = await W.readWorkspace(project.projectDir, {
      name: project.name,
      runsRoot: project.runsRoot,
      annotationsFor: (chapter) => ANN.readAnnotations(project.projectDir, chapter),
    })
    const checks = body.deep === true ? await runChecks(project.projectDir, ws.chapters, false) : checkCache.value
    const byChapter = findingsByChapter(checks)
    const stages = await PIPE.stageStatus({
      projectDir: project.projectDir,
      chapters: ws.chapters.map((r) => ({ chapter: r.chapter, title: r.title, chars: r.chars, text: '' })),
      annotations: ws.chapters.flatMap((r) => Array.from({ length: r.annotations.open }, () => ({ chapter: r.chapter, status: 'open' }))),
    })
    return {
      found: true,
      projectDir: project.projectDir,
      name: project.name,
      source: project.source,
      runBase: ws.runBase,
      chapters: ws.chapters.map((row) => ({
        ...row,
        path: undefined,
        findings: byChapter.get(row.chapter) === undefined ? [] : byChapter.get(row.chapter),
      })),
      totals: ws.totals,
      people: ws.people,
      outline: ws.outline,
      merged: ws.merged,
      state: ws.state,
      stages: { stages: stages.stages, current: stages.current, done: stages.done, total: stages.total },
      // 体检结果两条路由（workspace / check）必须是**同一个形状**：
      // 客户端面板按 checks.plot.metrics / checks.plot.findings 读，
      // 之前 workspace 这里把 metrics 拍平了，情节页一进去就崩。
      checks:
        checks === null
          ? null
          : {
              at: checks.at,
              cached: checks.cached === true,
              outlineMissing: checks.outlineMissing === true,
              ledger: { summary: checks.ledger.summary, findings: checks.ledger.findings },
              plot: { metrics: checks.plot.metrics, findings: checks.plot.findings },
            },
    }
  })

  // 单章详情：正文段落 + 批注 + 本章设定 + 写作包
  route('chapter', async (body) => {
    const project = await projectOf(false)
    if (project === null) throw new Error('还没认出作品目录：先在顶部选候选目录，或指定作品根')
    const chapter = Number(body.chapter)
    if (!Number.isInteger(chapter)) throw new Error('chapter 必须是整数')
    const detail = await W.readChapter(project.projectDir, chapter)
    if (!detail.found) throw new Error(`没有找到第${chapter}章的正文（文件名里要带"第${chapter}章"）`)
    const annotations = await ANN.readAnnotations(project.projectDir, chapter)
    const setup = await PACK.readSetup(project.projectDir, chapter)
    const rows = (await W.readWorkspace(project.projectDir, { name: project.name, runsRoot: project.runsRoot })).chapters
    const row = rows.find((r) => r.chapter === chapter)
    const summaryText = row !== undefined && row.summary.exists ? await readTextSafe(row.summary.path) : ''
    return {
      chapter,
      title: detail.title,
      file: detail.file,
      path: detail.path,
      text: detail.text,
      segments: detail.segments,
      chars: charCount(detail.text),
      annotations,
      annotationTypes: ANN.ANNOTATION_TYPES,
      setup,
      summary: { text: summaryText, path: row === undefined ? '' : row.summary.path },
      pack: row === undefined ? null : row.pack,
      run: row === undefined ? null : row.run,
      marks: row === undefined ? { good: 0, bad: 0 } : row.marks,
      tension: row === undefined ? null : row.tension,
      revisionPath: W.revisionPathOf(project.projectDir, chapter),
      pendingRevision: await readJsonSafe(join(W.stateDirOf(project.projectDir), '微调', `第${chapter}章 待采纳.json`)),
    }
  })

  // 批注：加 / 改 / 删。批注只落盘，永不进模型上下文（微调时才取被批注的那几段）
  route('annotation', async (body) => {
    const project = await projectOf(false)
    if (project === null) throw new Error('还没认出作品目录')
    const chapter = Number(body.chapter)
    if (!Number.isInteger(chapter)) throw new Error('chapter 必须是整数')
    const action = String(body.action === undefined ? 'add' : body.action)
    if (action === 'add') {
      const written = await ANN.addAnnotation(project.projectDir, chapter, {
        seg: body.seg,
        type: body.type,
        note: body.note,
        quote: body.quote,
      })
      return { list: written.list, added: written.added, path: written.path }
    }
    if (action === 'update') {
      const written = await ANN.updateAnnotation(project.projectDir, chapter, String(body.id ?? ''), {
        status: body.status,
        note: body.note,
        type: body.type,
      })
      return { list: written.list, path: written.path }
    }
    if (action === 'remove') {
      const written = await ANN.removeAnnotation(project.projectDir, chapter, String(body.id ?? ''))
      return { list: written.list, path: written.path }
    }
    throw new Error('未知的 action：' + action)
  })

  /**
   * 组装某一章的写作包（pack 路由与「开新章」共用）。
   *
   * 注意 row 可能是 undefined：写**还没存在**的新章时它本来就没有行，
   * 所以这里不依赖 row，只有"轮次目录放哪"才用它。
   */
  const packFor = async (project, chapter, options) => {
    const opts = options === undefined ? {} : options
    const rows = (await W.readWorkspace(project.projectDir, { name: project.name, runsRoot: project.runsRoot })).chapters
    const row = rows.find((r) => r.chapter === chapter)
    const profileInfo = await findProfile(project.projectDir, dirOf(), project.runsRoot)
    const people = await W.readPeople(project.projectDir)
    const ledger = await LEDGER.readLedger(project.projectDir)
    const outlineText = await readTextSafe(join(project.projectDir, '大纲.md'))
    const outlineNodes = outlineText.trim() === '' ? [] : PLOT.parseOutline(outlineText).chapters
    const summaries = []
    for (const item of rows) {
      if (item.chapter >= chapter - 3 && item.chapter < chapter && item.summary.exists) {
        summaries.push({ chapter: item.chapter, text: await readTextSafe(item.summary.path) })
      }
    }
    const prevPath = (rows.find((r) => r.chapter === chapter - 1) ?? { path: '' }).path
    const prevText = chapter <= 1 ? '' : await readTextSafe(prevPath)
    const debts =
      outlineNodes.length === 0
        ? []
        : PLOT.foreshadowDebts({
            outline: outlineNodes,
            chapters: [],
            summaries: summaries.map((s) => ({ chapter: s.chapter, text: s.text })),
          })
    const result = await PACK.buildPack({
      projectDir: project.projectDir,
      chapter,
      settings: { targetChapterWords: cfg().targetChapterWords },
      profileText: profileInfo.text,
      profilePath: profileInfo.path,
      setupText: typeof opts.setupText === 'string' ? opts.setupText : undefined,
      people,
      ledgerItems: ledger.items,
      ledgerPath: ledger.path,
      outlineNodes,
      debts,
      summaries,
      previousChapterText: prevText,
      previousChapter: chapter - 1,
      runDir: row !== undefined && row.run.exists ? row.run.dir : '',
      annotations: await ANN.readAnnotations(project.projectDir, chapter),
    })
    if (opts.save === true) await PACK.writePack(result)
    return result
  }

  // 写作包：写稿会话唯一要读的文件。返回逐节字数，作者看得见上下文花在哪儿
  route('pack', async (body) => {
    const project = await projectOf(false)
    if (project === null) throw new Error('还没认出作品目录')
    const chapter = Number(body.chapter)
    if (!Number.isInteger(chapter)) throw new Error('chapter 必须是整数')
    const result = await packFor(project, chapter, { save: body.save !== false })
    return {
      chapter,
      path: result.path,
      text: result.text,
      chars: result.chars,
      bytes: result.bytes,
      sections: result.sections,
      budget: result.budget,
      warnings: result.warnings,
      saved: body.save !== false,
    }
  })

  // 微调：把**被批注的段落**交给模型改写，其余段落逐字不动，核对通过才落盘
  route('revise', async (body) => {
    const project = await projectOf(false)
    if (project === null) throw new Error('还没认出作品目录')
    const chapter = Number(body.chapter)
    if (!Number.isInteger(chapter)) throw new Error('chapter 必须是整数')
    const detail = await W.readChapter(project.projectDir, chapter)
    if (!detail.found) throw new Error(`没有找到第${chapter}章的正文`)
    const annotations = await ANN.readAnnotations(project.projectDir, chapter)
    const open = annotations.filter((a) => a.status === 'open')
    if (open.length === 0) throw new Error('这一章还没有待处理的批注：先在正文里选段、留批注')

    const profileInfo = await findProfile(project.projectDir, dirOf(), project.runsRoot)
    const input = ANN.buildRevisionInput({
      segments: detail.segments,
      annotations,
      profile: PACK.stripAutoBlock(profileInfo.text),
    })
    if (input.used === 0) throw new Error('批注指向的段落找不到了（正文改过？）：请重新标注')

    const llm = ctx.get('llm')
    if (llm === undefined || typeof llm.stream !== 'function') {
      throw new Error('这个 dsh 没挂 LLM 服务：批注清单在工作台里能看能改，但微调要模型')
    }
    const route = resolveDistillRoute(ctx, cfg())
    if (route === null) throw new Error('没有可用的模型路由：在设置里填 dsh-novel-craft 的 distillProvider / distillModel')

    const answer = await callModel(llm, route, {
      system: ANN.revisionSystemPrompt(input.profile),
      user: ANN.revisionUserPrompt(input),
      maxTokens: 3000,
      timeoutMs: 150000,
    })
    // 模型原话一律留档：格式没对上时，作者和我都靠它排查（提炼吃过这个亏）
    const rawPath = join(W.stateDirOf(project.projectDir), '微调', `第${chapter}章 原始输出.md`)
    await mkdir(dirname(rawPath), { recursive: true })
    await writeFile(
      rawPath,
      [
        `# 第${chapter}章 微调原始输出`,
        '',
        `> 模型：${route.provider}/${route.model} · 结束原因：${answer.finish} · 时间：${new Date().toISOString()}`,
        '> 工作台每次微调都会覆盖本文件；写稿会话不用读它。',
        '',
        answer.text === '' ? '（模型没有输出正文）' : answer.text,
        '',
      ].join('\n'),
      'utf8',
    )

    const parsed = ANN.parseRevisionOutput(answer.text)
    const allowed = new Set(input.indexes)
    const revised = {}
    for (const [key, value] of Object.entries(parsed)) {
      const index = Number(key)
      if (allowed.has(index)) revised[index] = value
    }
    const rebuilt = ANN.applyRevision(detail.text, revised, input.indexes)
    const check = ANN.verifyRevision({ originalText: detail.text, revisedText: rebuilt, annotated: input.indexes })
    const diff = ANN.revisionDiff({ originalText: detail.text, revisedText: rebuilt, annotations })
    const doc = ANN.buildRevisionDoc({
      chapter,
      diff,
      model: `${route.provider}/${route.model}`,
      at: new Date().toISOString(),
      problems: check.errors,
      warnings: check.warnings,
    })
    const path = W.revisionPathOf(project.projectDir, chapter)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, doc, 'utf8')
    // 待采纳的改写表单独存：采纳时按**当时的正文**重新拼装并再核对一次
    await writeJson(join(W.stateDirOf(project.projectDir), '微调', `第${chapter}章 待采纳.json`), {
      chapter,
      at: new Date().toISOString(),
      model: `${route.provider}/${route.model}`,
      indexes: input.indexes,
      revised,
    })

    const why = diff.length === 0 ? finishReason(answer.finish, answer.text) : ''
    return {
      ok: check.ok,
      problems: check.errors,
      warnings: check.warnings,
      diff,
      path,
      rawPath,
      model: `${route.provider}/${route.model}`,
      used: input.used,
      total: input.total,
      capped: input.used < input.total,
      finish: answer.finish,
      hint: diff.length === 0 ? why === '' ? '模型没有改动任何段落' : why : '',
    }
  })

  // 采纳微调：写回正文（原稿先备份），并把这一批批注标成已解决
  route('revise-apply', async (body) => {
    const project = await projectOf(false)
    if (project === null) throw new Error('还没认出作品目录')
    const chapter = Number(body.chapter)
    if (!Number.isInteger(chapter)) throw new Error('chapter 必须是整数')
    const pending = await readJsonSafe(join(W.stateDirOf(project.projectDir), '微调', `第${chapter}章 待采纳.json`))
    if (pending === null || typeof pending.revised !== 'object') {
      throw new Error('没有待采纳的微调稿：先点「按批注微调」生成一版')
    }
    const detail = await W.readChapter(project.projectDir, chapter)
    if (!detail.found) throw new Error(`没有找到第${chapter}章的正文`)
    const indexes = Array.isArray(pending.indexes) ? pending.indexes : Object.keys(pending.revised).map(Number)
    const rebuilt = ANN.applyRevision(detail.text, pending.revised, indexes)
    const check = ANN.verifyRevision({ originalText: detail.text, revisedText: rebuilt, annotated: indexes })
    if (!check.ok) {
      throw new Error('核对没通过，拒绝写回：' + check.problems.join('；') + '。正文可能已经被改过，请重新微调。')
    }
    // 原稿备份：改名这类动作一律可回退
    const backupDir = W.revisionBackupDirOf(project.projectDir)
    await mkdir(backupDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await writeFile(join(backupDir, `第${chapter}章 ${stamp}.md`), detail.text, 'utf8')
    await writeFile(detail.path, rebuilt, 'utf8')
    // 待采纳的改写表是一次性凭据：采纳过就删掉，免得同一个 diff 被再写一遍
    await rm(join(W.stateDirOf(project.projectDir), '微调', `第${chapter}章 待采纳.json`), { force: true })
    const annotations = await ANN.readAnnotations(project.projectDir, chapter)
    let resolved = 0
    for (const item of annotations) {
      if (item.status !== 'open') continue
      await ANN.updateAnnotation(project.projectDir, chapter, item.id, { status: 'resolved' })
      resolved += 1
    }
    return {
      chapter,
      path: detail.path,
      backupDir,
      chars: charCount(rebuilt),
      changed: check.changed.length,
      resolved,
      segments: splitSegments(rebuilt),
    }
  })

  // 手工张力：作者比任何启发式都准，标一次就能用来看曲线
  route('tension', async (body) => {
    const project = await projectOf(false)
    if (project === null) throw new Error('还没认出作品目录')
    const chapter = Number(body.chapter)
    const value = Number(body.value)
    if (!Number.isInteger(chapter)) throw new Error('chapter 必须是整数')
    if (!Number.isInteger(value) || value < 0 || value > 5) throw new Error('张力只能是 0（未标）或 1-5')
    const next = await W.writeWorkspaceState(project.projectDir, {
      tension: { [String(chapter)]: value === 0 ? null : value },
    })
    return { tension: next.tension }
  })

  // 体检：账目 + 情节。全部是本地规则，正文不进模型上下文
  route('check', async (body) => {
    const project = await projectOf(false)
    if (project === null) throw new Error('还没认出作品目录')
    const force = body.refresh === true
    const rows = (await W.readWorkspace(project.projectDir, { name: project.name, runsRoot: project.runsRoot })).chapters
    const data = await runChecks(project.projectDir, rows, force)
    const scope = String(body.scope === undefined ? 'all' : body.scope)
    return {
      at: data.at,
      cached: data.cached,
      outlineMissing: data.outlineMissing,
      ledger: scope === 'plot' ? null : data.ledger,
      plot: scope === 'ledger' ? null : data.plot,
    }
  })

  // 阶段：立项 → 设定 → 人物 → 大纲 → 逐章正文 → 修订 → 完本
  route('stage', async (body) => {
    const project = await projectOf(false)
    if (project === null) throw new Error('还没认出作品目录')
    const action = String(body.action === undefined ? 'status' : body.action)
    const rows = (await W.readWorkspace(project.projectDir, { name: project.name, runsRoot: project.runsRoot })).chapters

    if (action === 'set') {
      const stage = String(body.stage ?? '')
      if (!PIPE.STAGE_IDS.includes(stage) && stage !== '') throw new Error('未知阶段：' + stage)
      const next = await W.writeWorkspaceState(project.projectDir, { stage })
      return { stage: next.stage }
    }

    const annotations = []
    for (const row of rows) {
      const list = await ANN.readAnnotations(project.projectDir, row.chapter)
      annotations.push(...list.map((a) => ({ chapter: row.chapter, status: a.status })))
    }
    const status = await PIPE.stageStatus({
      projectDir: project.projectDir,
      chapters: rows.map((r) => ({ chapter: r.chapter, title: r.title, chars: r.chars, text: '' })),
      annotations,
    })
    if (action === 'status') return status

    const stageId = String(body.stage ?? status.current ?? '')
    const stage = PIPE.STAGES.find((s) => s.id === stageId)
    if (stage === undefined) throw new Error('未知阶段：' + stageId)

    if (action === 'save') {
      const text = String(body.text ?? '')
      if (text.trim() === '') throw new Error('内容为空，没有可保存的东西')
      const target = stage.produce.includes('{chapter}')
        ? join(project.projectDir, stage.produce.replace('{chapter}', String(body.chapter ?? rows.length + 1)))
        : join(project.projectDir, stage.produce)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, text, 'utf8')
      const after = await PIPE.stageStatus({
        projectDir: project.projectDir,
        chapters: rows.map((r) => ({ chapter: r.chapter, title: r.title, chars: r.chars, text: '' })),
        annotations,
      })
      return { savedPath: target, stages: after.stages, current: after.current, done: after.done, total: after.total }
    }

    if (action === 'generate') {
      const profileInfo = await findProfile(project.projectDir, dirOf(), project.runsRoot)
      const upstream = []
      for (const item of PIPE.STAGES) {
        if (item.order >= stage.order) continue
        for (const artifact of item.artifacts) {
          const path = join(project.projectDir, artifact.path)
          const text = await readTextSafe(path)
          if (text.trim() === '') continue
          upstream.push({ label: artifact.label, text: clip(text, 4000) })
        }
      }
      if (stage.id === 'chapter') {
        const chapter = Number(body.chapter ?? rows.length + 1)
        const setup = await PACK.readSetup(project.projectDir, chapter)
        upstream.push({ label: `第${chapter}章 本章设定（作者指定）`, text: clip(setup.text, 2000) })
        const prev = rows.find((r) => r.chapter === chapter - 1)
        if (prev !== undefined) upstream.push({ label: `第${chapter - 1}章 结尾`, text: PACK.tailSegments(await readTextSafe(prev.path), 900) })
      }
      const prompt = PIPE.stagePrompt(stage.id, {
        projectName: project.name,
        profile: PACK.stripAutoBlock(profileInfo.text),
        upstream,
        chapters: rows.map((r) => ({ chapter: r.chapter, title: r.title, chars: r.chars, text: '' })),
        chapter: Number.isInteger(Number(body.chapter)) ? Number(body.chapter) : null,
        extra: String(body.extra ?? ''),
      })
      const llm = ctx.get('llm')
      if (llm === undefined || typeof llm.stream !== 'function') throw new Error('这个 dsh 没挂 LLM 服务：起草要模型')
      const route = resolveDistillRoute(ctx, cfg())
      if (route === null) throw new Error('没有可用的模型路由：在设置里填 distillProvider / distillModel')
      const answer = await callModel(llm, route, {
        system: prompt.system,
        user: prompt.user,
        maxTokens: stage.id === 'chapter' ? 6000 : 3000,
        timeoutMs: 240000,
      })
      const rawPath = join(W.stateDirOf(project.projectDir), '阶段原始输出', `${stage.id}.md`)
      await mkdir(dirname(rawPath), { recursive: true })
      await writeFile(
        rawPath,
        [
          `# ${stage.name} 阶段 · 原始输出`,
          '',
          `> 模型：${route.provider}/${route.model} · 结束原因：${answer.finish} · 时间：${new Date().toISOString()}`,
          '',
          answer.text === '' ? '（模型没有输出正文）' : answer.text,
          '',
        ].join('\n'),
        'utf8',
      )
      const why = finishReason(answer.finish, answer.text)
      return {
        stage: stage.id,
        text: answer.text,
        model: `${route.provider}/${route.model}`,
        finish: answer.finish,
        rawPath,
        missing: prompt.missing,
        produce: stage.produce,
        hint: answer.text.trim() === '' ? why : '',
      }
    }
    throw new Error('未知的 action：' + action)
  })

  // ══ 开新章：从"这一章要写什么"到"一批结构不同的候选稿"，再到合并定稿 ══
  //
  // 抽卡解决"哪一段好"，可候选稿从哪来、选完怎么合起来，以前得作者自己在会话里跑。
  // 这一组路由把作者真实的工作方法固化下来（见《第8章 筛选与合并记录.md》）：
  //   十个场景决策方向 → 一次一篇写候选 → 作者标好/坏并写取用原因 → 合并 → 写入正文。

  /** 新章的落点：优先用作者既有的轮次目录，没有就退到作品的状态目录。 */
  const newChapterPaths = async (project, chapter) => {
    const ws = await W.readWorkspace(project.projectDir, { name: project.name, runsRoot: project.runsRoot })
    const runDir = ws.runBase === '' ? '' : join(ws.runBase, `第${chapter}章`)
    const candidatesDir = runDir === '' ? join(W.stateDirOf(project.projectDir), '候选稿', `第${chapter}章`) : join(runDir, '候选稿')
    return {
      runDir,
      candidatesDir,
      mergeDocPath: runDir === '' ? join(candidatesDir, '筛选与合并记录.md') : join(runDir, '筛选与合并记录.md'),
      versionDir: runDir === '' ? join(candidatesDir, '定稿候选') : join(runDir, '定稿候选'),
      runBase: ws.runBase,
    }
  }

  /** 从标注 + 取用理由推出"作者选了哪些段"（按稿件顺序）。界面与合并共用这一个推导。 */
  const picksOf = async (dir, chapter, candidates) => {
    const marks = await readMarks(dir)
    const reasons = await readReasons(dir)
    const picks = []
    for (const candidate of candidates) {
      const entry = marks[candidate.file]
      if (entry === null || typeof entry !== 'object') continue
      const indexes = Object.keys(entry)
        .map((k) => Number(k))
        .filter((i) => Number.isInteger(i) && entry[String(i)] === 'good')
        .sort((a, b) => a - b)
      for (const index of indexes) {
        const text = candidate.segments[index]
        if (text === undefined) continue
        picks.push({
          file: candidate.file,
          index,
          text,
          reason: reasons[`${candidate.file}#${index}`] === undefined ? '' : reasons[`${candidate.file}#${index}`],
        })
      }
    }
    return picks
  }

  route('newchapter', async (body) => {
    const project = await projectOf(false)
    if (project === null) throw new Error('还没认出作品目录：先在顶部选候选目录，或指定作品根')
    const action = String(body.action === undefined ? 'status' : body.action)
    const chapter = Number(body.chapter)
    if (!Number.isInteger(chapter) || chapter < 1) throw new Error('chapter 必须是从 1 开始的整数')
    const paths = await newChapterPaths(project, chapter)
    const rows = (await W.readWorkspace(project.projectDir, { name: project.name, runsRoot: project.runsRoot })).chapters
    const existing = rows.find((r) => r.chapter === chapter)

    // 开新章之前的现状：这一章有没有正文、有没有候选、章号建议
    if (action === 'status') {
      const candidates = await readCandidates(paths.candidatesDir)
      const poolDir = paths.candidatesDir
      const nextChapter = rows.length === 0 ? 1 : Math.max(...rows.map((r) => r.chapter)) + 1
      const setup = await PACK.readSetup(project.projectDir, chapter)
      const outlineText = await readTextSafe(join(project.projectDir, '大纲.md'))
      const nodes = outlineText.trim() === '' ? [] : PLOT.parseOutline(outlineText).chapters
      return {
        chapter,
        suggestedChapter: nextChapter,
        candidatesDir: paths.candidatesDir,
        runDir: paths.runDir,
        candidateCount: candidates.length,
        candidates: candidates.map((c) => ({ file: c.file, segments: c.segments.length })),
        hasText: existing !== undefined && existing.chars > 0,
        chars: existing === undefined ? 0 : existing.chars,
        setup,
        outlineNode: nodes.find((n) => n.chapter === chapter) ?? null,
        picks: await picksOf(candidates.length > 0 ? paths.candidatesDir : dirOf() === '' ? paths.candidatesDir : dirOf(), chapter, candidates),
      }
    }

    // ① 方向：一次便宜的调用，产出"这一篇试什么"
    if (action === 'directions') {
      const setupText = typeof body.setupText === 'string' ? body.setupText : undefined
      const pack = await packFor(project, chapter, { save: false, setupText })
      const prompt = DRAFT.buildDirectionsPrompt({
        pack: pack.text,
        extra: typeof body.extra === 'string' ? body.extra : '',
        count: Number.isInteger(body.count) ? body.count : undefined,
        chapter,
      })
      const llm = ctx.get('llm')
      if (llm === undefined || typeof llm.stream !== 'function') throw new Error('这一步要模型：这个 dsh 没挂 LLM 服务')
      const route = resolveDistillRoute(ctx, cfg())
      if (route === null) throw new Error('没有可用的模型路由：在设置里填 dsh-novel-craft 的 distillProvider / distillModel')
      const answer = await callModel(llm, route, {
        system: DRAFT.directionsSystemPrompt(),
        user: prompt.text,
        maxTokens: 1600,
        timeoutMs: 120000,
      })
      const rawPath = join(W.stateDirOf(project.projectDir), '开新章原始输出', `第${chapter}章-方向.md`)
      await mkdir(dirname(rawPath), { recursive: true })
      await writeFile(
        rawPath,
        [`# 第${chapter}章 方向 · 原始输出`, '', `> 模型：${route.provider}/${route.model} · 结束原因：${answer.finish} · ${new Date().toISOString()}`, '', answer.text === '' ? '（模型没有输出正文）' : answer.text, ''].join('\n'),
        'utf8',
      )
      const directions = DRAFT.parseDirections(answer.text)
      if (directions.length === 0) {
        throw new Error(`没解析出方向（${finishReason(answer.finish, answer.text) || '格式没对上'}）：原话见 ${rawPath}`)
      }
      return {
        chapter,
        directions,
        model: `${route.provider}/${route.model}`,
        packChars: pack.chars,
        packPath: pack.path,
        packWarnings: pack.warnings,
        rawPath,
      }
    }

    // ② 候选：一次一篇（客户端循环，看得见进度、单篇失败可以只重来这一篇）
    if (action === 'draft') {
      const direction = body.direction
      if (direction === null || typeof direction !== 'object' || typeof direction.detail !== 'string') {
        throw new Error('要指定这一篇的写法方向')
      }
      const index = Number.isInteger(body.index) ? body.index : 0
      const all = Array.isArray(body.directions) ? body.directions : []
      const setupText = typeof body.setupText === 'string' ? body.setupText : undefined
      const pack = await packFor(project, chapter, { save: false, setupText })
      const llm = ctx.get('llm')
      if (llm === undefined || typeof llm.stream !== 'function') throw new Error('这一步要模型：这个 dsh 没挂 LLM 服务')
      const route = resolveDistillRoute(ctx, cfg())
      if (route === null) throw new Error('没有可用的模型路由：在设置里填 distillProvider / distillModel')
      const prompt = DRAFT.buildDraftPrompt({
        pack: pack.text,
        direction: { letter: DRAFT.letterOf(index), name: String(direction.name ?? '方向'), detail: direction.detail },
        others: all.filter((d, i) => i !== index).map((d, i) => ({ letter: DRAFT.letterOf(i >= index ? i + 1 : i), name: String(d.name ?? ''), detail: String(d.detail ?? '') })),
        chapter,
      })
      const answer = await callModel(llm, route, {
        system: DRAFT.draftSystemPrompt(),
        user: prompt.text,
        maxTokens: Math.max(3000, Number(cfg().targetChapterWords) * 2),
        timeoutMs: 300000,
      })
      const text = DRAFT.cleanDraftText(answer.text)
      const warning = finishReason(answer.finish, text)
      const fileName = DRAFT.candidateFileName({ chapter, index, name: String(direction.name ?? '方向') })
      const path = join(paths.candidatesDir, fileName)
      await mkdir(paths.candidatesDir, { recursive: true })
      await writeFile(path, text + (text.endsWith('\n') ? '' : '\n'), 'utf8')
      const info = await statSafe(path)
      return {
        chapter,
        file: fileName,
        path,
        chars: charCount(text),
        bytes: info.bytes,
        letter: DRAFT.letterOf(index),
        model: `${route.provider}/${route.model}`,
        finish: answer.finish,
        warning,
        candidatesDir: paths.candidatesDir,
      }
    }

    // ③ 合并：只按作者选中的段落拼（跨稿处写成缺口标记），并生成取用记录
    if (action === 'merge') {
      /**
       * 候选池可能有两个：这一章自己的 `…/第N章/候选稿/`，和全局"当前候选目录"。
       * 作者的实际情况是两者都出现过（早期在作品根下标注，后来按章分目录），
       * 而标注（marks.json）跟着各自的 .dsh-novel-craft/ 走，所以两个池都要试，
       * 取"能选出段落更多"的那个——不做文件名跨目录合并，免得张冠李戴。
       */
      const pools = [...new Set([paths.candidatesDir, dirOf()].filter((d) => typeof d === 'string' && d !== ''))]
      let dir = paths.candidatesDir
      let candidates = []
      let picks = Array.isArray(body.picks) && body.picks.length > 0 ? body.picks : []
      if (picks.length === 0) {
        let best = -1
        for (const pool of pools) {
          const found = await readCandidates(pool)
          if (found.length === 0) continue
          const rows = await picksOf(pool, chapter, found)
          if (rows.length > best) {
            best = rows.length
            dir = pool
            candidates = found
            picks = rows
          }
        }
        if (candidates.length === 0 && pools.length > 0) {
          dir = pools[0]
          candidates = await readCandidates(dir)
        }
      }
      if (picks.length === 0) throw new Error('还没有选中的段落：先去「抽卡」把好的段标上 👍（顺手写一句取用原因更好）')
      const merged = DRAFT.mergeSelection({ picks })
      const versionName = String(body.versionName ?? '合并稿')
      const doc = DRAFT.buildMergeDoc({
        chapter,
        versionName,
        rows: merged.rows,
        gaps: merged.gaps,
        chars: charCount(merged.text),
        note: typeof body.note === 'string' ? body.note : '',
      })
      await mkdir(paths.versionDir, { recursive: true })
      const versionPath = join(paths.versionDir, `第${chapter}章-${DRAFT.safeName(versionName, '合并稿')}.txt`)
      await writeFile(versionPath, merged.text.endsWith('\n') ? merged.text : merged.text + '\n', 'utf8')
      await mkdir(dirname(paths.mergeDocPath), { recursive: true })
      await writeFile(paths.mergeDocPath, doc, 'utf8')
      return {
        chapter,
        text: merged.text,
        rows: merged.rows,
        gaps: merged.gaps,
        chars: charCount(merged.text),
        versionPath,
        mergeDocPath: paths.mergeDocPath,
        mergeDoc: doc,
      }
    }

    // ④ 定稿：把合并稿（或作者改过的稿）写进正文，备份原稿，补上章节标题
    if (action === 'finalize') {
      const text = String(body.text ?? '')
      if (text.trim() === '') throw new Error('要写入的正文是空的')
      const detail = await W.readChapter(project.projectDir, chapter)
      const title = typeof body.title === 'string' ? body.title : ''
      const normalized = DRAFT.normalizeChapterText(text, { chapter, title })
      let target = detail.found ? detail.path : join(project.projectDir, `${project.name}-第${chapter}章.txt`)
      let backupPath = ''
      if (detail.found && detail.text.trim() !== '') {
        const backupDir = join(W.stateDirOf(project.projectDir), '备份')
        await mkdir(backupDir, { recursive: true })
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        backupPath = join(backupDir, `第${chapter}章 ${stamp}.txt`)
        await writeFile(backupPath, detail.text, 'utf8')
      }
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, normalized, 'utf8')
      if (paths.runDir !== '') await mkdir(paths.runDir, { recursive: true })
      return {
        chapter,
        path: target,
        backupPath,
        chars: charCount(normalized),
        segments: splitSegments(normalized).length,
        created: detail.found !== true,
      }
    }

    throw new Error('未知的 action：' + action)
  })

  // 本章设定：作者写"这一章要干什么"。它既是写作包的第①节，也是起草正文的输入
  route('setup', async (body) => {
    const project = await projectOf(false)
    if (project === null) throw new Error('还没认出作品目录')
    const chapter = Number(body.chapter)
    if (!Number.isInteger(chapter)) throw new Error('chapter 必须是整数')
    if (typeof body.text === 'string') {
      const written = await PACK.writeSetup(project.projectDir, chapter, body.text)
      return { path: written.path, saved: true, exists: written.exists }
    }
    return PACK.readSetup(project.projectDir, chapter)
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
// 0.2 的能力都在 lib/core/ 下，用命名空间再导出一次：
// 单测可以直接 import { corePack } 拿纯函数，不必知道内部文件怎么切。
export * as coreText from './core/text.js'
export * as coreWorkspace from './core/workspace.js'
export * as corePack from './core/pack.js'
export * as coreAnnotate from './core/annotate.js'
export * as coreLedger from './core/ledger.js'
export * as corePlot from './core/plot.js'
export * as corePipeline from './core/pipeline.js'
export * as coreProvenance from './core/provenance.js'
export * as coreDraft from './core/draft.js'

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
