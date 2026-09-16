/**
 * dsh-novel-craft — 每章写作包（pack）
 *
 * 这是"完整写完一本"的传动轴：写稿会话**只需要读这一个文件**。
 *
 * 为什么要它不是"把目录丢给模型"：
 * - 上下文是有限且要花钱的资源，作者应该看得见每一段吃掉了多少；
 * - 口味输入只允许来自「作者偏好档案.md」里的**规律**——标注原文、证据摘录、批注
 *   都是给人看的，绝不进模型上下文（这是本插件的铁律，写在包尾的"禁区"清单里）；
 * - 前情用**已经写好的剧情总结**（本来就是摘要），不重新读正文。
 *
 * 唯一例外：上一章的**结尾片段**会进包（接续必须要），所以它单独成节、有上限、
 * 并且只取结尾——不是把上一章整篇拖进来。
 *
 * 所有裁剪都是确定的、可解释的：`sections[].bytes / trimmed / omitted` 就是给作者看的
 * 上下文预算表。
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { charCount, clip, readTextSafe, splitSegments, statSafe } from './text.js'
import { packPathOf, stateDirOf } from './workspace.js'

/** 各节的字符上限（宁少勿多：模型补不回来的信息才是作者该操心的）。 */
export const CAP = {
  task: 1800,
  profile: 3600,
  prevEnd: 900,
  recap: 1800,
  cast: 1400,
  ledger: 1600,
  outline: 1200,
  debt: 800,
  banned: 900,
  rules: 600,
}

/** 整包上限（字符）。超过就按下面的顺序削，削到谁、削了多少，全部记进结果。 */
export const TOTAL_CHARS = 9000

/** 削减顺序：先削"补得回来"的（前情/台账/人物），后削"没它写不了"的（任务/规律）。 */
const TRIM_ORDER = ['recap', 'ledger', 'cast', 'outline', 'prevEnd', 'debt', 'task', 'profile', 'banned', 'rules']
/** 每节的底线：削到这个量就不再削（再削就没有意义了）。 */
const FLOOR = { task: 200, profile: 600, prevEnd: 200, recap: 200, cast: 0, ledger: 0, outline: 0, debt: 0, banned: 300, rules: 120 }

/** 章节设定（作者写"本章要干什么"）：自由 markdown，工作台只负责放路径与初稿。 */
export const setupPathOf = (projectDir, chapter) =>
  join(stateDirOf(projectDir), '章节设定', `第${chapter}章.md`)

export const SETUP_TEMPLATE = (chapter) =>
  [
    `# 第${chapter}章 本章设定`,
    '',
    '> 这里写"这一章要干什么"。写作包会把它放在最前面，写稿会话第一眼就看它。',
    '> 下面四节可以留空，留空的节不会进包。',
    '',
    '## 本章目标（必须发生）',
    '',
    '- ',
    '',
    '## 禁止发生',
    '',
    '- ',
    '',
    '## 出场人物',
    '',
    '- ',
    '',
    '## 本章要求',
    '',
    '- 字数：',
    '- 视角：',
    '- 其他：',
    '',
  ].join('\n')

/** 禁 AI 腔清单：从本插件的 novel-writing 技能压成一份进包用的短清单。 */
export const BANNED_LIST = [
  '先否定后转折的对比句（不是…而是…、并非…只是…）一律不用。',
  '万能过渡（值得注意的是/总而言之/与此同时/换句话说）与硬转折（然而/就在这时）不用：段落衔接靠因果。',
  '神态与情绪套话不用：嘴角勾起、眼底划过、瞳孔微缩、喉结滚动、五味杂陈、浑身一震、如坠冰窟。',
  '不直给情绪标签（他很难过/她很震惊），用动作、器物异动、对话与留白呈现。',
  '同一信息、同一画面、同一句式不重复；比喻与收尾句跨章不重复；同一高频词每章最多一次。',
  '不写无细节支撑的宏大空泛描写，不写解释动机的旁白（让动作自己说话）。',
  '人物各有腔调：不让人物说叙述者的话，口吻要跟身份、境界、处境一致。',
  '账目可复算：货币、道具、增益的数量与状态与台账自洽，正文只写与当前场景相关的一两件。',
]

/**
 * 偏好档案里的自动块（标注数/待提炼数）由工作台维护。
 * 那是账目不是规律，进上下文纯属浪费——进包之前必须档掉。
 */
export const AUTO_BEGIN = '<!-- dsh-novel-craft:auto:begin -->'
export const AUTO_END = '<!-- dsh-novel-craft:auto:end -->'

export function stripAutoBlock(text, begin, end) {
  const b0 = typeof begin === 'string' && begin !== '' ? begin : AUTO_BEGIN
  const e0 = typeof end === 'string' && end !== '' ? end : AUTO_END
  const b = text.indexOf(b0)
  const e = text.indexOf(e0)
  if (b === -1 || e === -1 || e < b) return text.trim()
  return (text.slice(0, b) + text.slice(e + e0.length)).replace(/\n{3,}/g, '\n\n').trim()
}

/** 从第 N 章剧情总结里取「核心剧情点」的条目（只取一层，够用且短）。 */
export function summaryPoints(text, limit) {
  const out = []
  const lines = String(text).split('\n')
  let inside = false
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (/^#{1,6}\s/.test(line)) {
      inside = /核心剧情点|剧情点|本章要点|主要内容/.test(line)
      continue
    }
    if (!inside) continue
    const item = /^\s*(?:[-*]|\d+[.、)])\s*(.+)$/.exec(line)
    if (item === null) continue
    const body = clip(item[1].replace(/[`*]/g, ''), 80)
    if (body.length < 2) continue
    out.push(body)
    if (out.length >= limit) break
  }
  return out
}

/** 段落级截尾：从结尾往回取到不超过 n 字，且尽量落在段落边界。 */
export function tailSegments(text, n) {
  const segments = splitSegments(text)
  const picked = []
  let total = 0
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const size = charCount(segments[i])
    if (total + size > n && picked.length > 0) break
    picked.unshift(segments[i])
    total += size
    if (total >= n) break
  }
  return picked.join('\n\n')
}

/** 台账条目压成一行（够模型知道"这东西现在在哪、什么状态"）。 */
function ledgerLine(item) {
  const bits = [item.category === undefined || item.category === '' ? '' : item.category]
  const parts = []
  if (item.grade !== undefined && item.grade !== '') parts.push(item.grade)
  if (item.effect !== undefined && item.effect !== '') parts.push(clip(item.effect, 40))
  if (item.status !== undefined && item.status !== '') parts.push('状态：' + clip(item.status, 24))
  if (item.firstChapter !== null && item.firstChapter !== undefined) parts.push(`第${item.firstChapter}章`)
  const head = item.name === undefined ? '' : item.name
  return `- ${head}${parts.length === 0 ? '' : '｜' + parts.join('｜')}`
}

/** 人物一行：`- 宁陈（主角/练气三层）：状态…`。 */
function castLine(person) {
  const tags = [person.identity, person.realm].filter((x) => typeof x === 'string' && x !== '').join('/')
  const bits = [person.name === undefined ? '' : person.name]
  const parts = [tags === '' ? '' : tags]
  if (person.status !== undefined && person.status !== '') parts.push(person.status)
  if (person.importance !== undefined && person.importance !== '') parts.push(person.importance)
  return `- ${bits[0]}${parts.filter((x) => x !== '').length === 0 ? '' : '（' + parts.filter((x) => x !== '').join('；') + '）'}`
}

/** 大纲一行。 */
function outlineLine(node) {
  const bits = []
  if (node.goal !== undefined && node.goal !== '') bits.push('目标：' + node.goal)
  if (node.conflict !== undefined && node.conflict !== '') bits.push('冲突：' + node.conflict)
  if (node.turn !== undefined && node.turn !== '') bits.push('转折：' + node.turn)
  const title = node.title === undefined || node.title === '' ? '' : ' ' + node.title
  return `### 第${node.chapter}章${title}\n${bits.map((b) => '- ' + b).join('\n')}`
}

/**
 * 组装写作包。
 *
 * 输入尽量由上层（宿主半区）已经读好的数据传进来，这既省 IO，也方便单测：
 * profile / people / ledger / outlineNodes / debts / previousChapterText 都是可选输入，
 * 缺哪一节就少哪一节，并在 warnings 里说明原因——而不是凭空编或者直接失败。
 */
export async function buildPack(input) {
  const {
    projectDir,
    chapter,
    settings = {},
    profileText = '',
    profilePath = '',
    setupText,
    people = [],
    ledgerItems = [],
    ledgerPath = '',
    outlineNodes = [],
    debts = [],
    previousChapterText = '',
    previousChapter = chapter - 1,
    autoEnd = '',
    autoBegin = '',
    runDir = '',
    annotations = [],
    summaries = [],
  } = input

  const warnings = []
  const sections = []

  // ① 本章任务：作者自己写的，永远第一顺位
  let task = typeof setupText === 'string' ? setupText : await readTextSafe(setupPathOf(projectDir, chapter))
  if (task.trim() === '') {
    warnings.push('本章设定还没写：包里的"本章任务"是空的，写稿会话会自己编目标。建议先在「章节」页填这一章要干什么。')
  } else {
    // 去掉说明性的引用块与一级标题，只留有信息量的部分
    task = task
      .split('\n')
      .filter((line) => !/^>\s?/.test(line) && !/^#\s/.test(line))
      .join('\n')
      .trim()
  }

  // ② 口味输入：只有规律
  const profile = stripAutoBlock(String(profileText), autoBegin, autoEnd)
  if (profile.trim() === '') {
    warnings.push('作者偏好档案还是空的：这一轮没有口味输入，写出来的只会是"合格的普通稿"。先去抽卡标几段。')
  }

  const keyText = [task, ...outlineNodes.map((n) => `${n.goal} ${n.conflict} ${n.turn}`)].join(' ')

  // ③ 上一章结尾：接续必需，只取结尾
  const prevTail = previousChapterText === '' ? '' : tailSegments(previousChapterText, CAP.prevEnd)
  if (previousChapterText === '') warnings.push(`没读到第${previousChapter}章的正文：包里没有"上一章结尾"，接续容易断。`)

  // ④ 前情提要：用现成的剧情总结，不重读正文
  const recapLines = []
  for (const item of summaries) {
    if (item === null || typeof item !== 'object') continue
    const points = summaryPoints(String(item.text ?? ''), 5)
    if (points.length === 0) continue
    recapLines.push(`**第${item.chapter}章**`, ...points.map((p) => '- ' + p))
  }
  if (recapLines.length === 0) warnings.push('没找到前几章的剧情总结（`剧情/第 N 章 剧情总结.md`）：包里只有上一章结尾，没有前情提要。')

  // ⑤ 本章人物：优先"在任务/大纲里被点名的人"，其次是主要人物
  const cast = pickCast(people, keyText, chapter)
  if (cast.length === 0) warnings.push('人物目录是空的（`人物/*.json`）：包里没有人物卡，口吻与境界容易写飘。')

  // ⑥ 台账：优先"这章要用的"，其次"当前还持有的"
  const ledger = pickLedger(ledgerItems, keyText, chapter)

  // ⑦ 情节约束：上一章 / 本章 / 下一章的大纲节点
  const outline = outlineNodes.filter((n) => n.chapter >= chapter - 1 && n.chapter <= chapter + 1).sort((a, b) => a.chapter - b.chapter)

  // ⑧ 伏笔欠账：到期或超期的才进包
  const debt = debts.filter((d) => d.paidChapter === null || d.paidChapter === undefined).slice(0, 8)

  // ⑨ 写作要求
  const target = Number.isInteger(settings.targetChapterWords) ? settings.targetChapterWords : 3000
  const slack = Math.round(target * 0.25)
  const rules = [
    `字数：${target - slack}–${target + slack} 字（目标 ${target} 字）。`,
    '视角：全章保持同一视角，不跳视角；信息差靠角色隐瞒，不靠叙述者解释。',
    '收尾：章末留钩子，但不要用"然而/就在这时"这类硬转折起头。',
    typeof settings.extraRules === 'string' && settings.extraRules !== '' ? settings.extraRules : '',
  ]
    .filter((x) => x !== '')
    .join('\n')

  const push = (id, label, source, text, note) => {
    if (String(text).trim() === '') return
    sections.push({ id, label, source: source === undefined ? '' : source, text: String(text).trim(), note: note === undefined ? '' : note })
  }

  push('task', '① 本章任务（作者指定）', setupText === undefined ? setupPathOf(projectDir, chapter) : setupPathOf(projectDir, chapter), task)
  push('profile', '② 作者偏好档案（只有规律，没有原文）', profilePath, profile)
  push('prevEnd', `③ 上一章（第${previousChapter}章）结尾`, '', prevTail, '只取结尾，用于接续')
  push('recap', '④ 前情提要（来自各章剧情总结）', '', recapLines.join('\n'))
  push('cast', '⑤ 本章人物', join(projectDir, '人物'), cast.map(castLine).join('\n'))
  push('ledger', '⑥ 道具与增益台账（相关条目）', ledgerPath, ledger.map(ledgerLine).join('\n'))
  push('outline', '⑦ 情节节点（上一章 / 本章 / 下一章）', join(projectDir, '大纲.md'), outline.map(outlineLine).join('\n\n'))
  push(
    'debt',
    '⑧ 未兑现的伏笔',
    '',
    debt.map((d) => `- ${d.name}（第${d.plantedChapter}章埋下，已欠 ${d.openChapters} 章${d.dueChapter === null || d.dueChapter === undefined ? '' : `，计划第${d.dueChapter}章收`}）`).join('\n'),
  )
  push('banned', '⑨ 禁 AI 腔清单（本插件 novel-writing 技能的简版）', '', BANNED_LIST.map((x) => '- ' + x).join('\n'))
  push('rules', '⑩ 本章写作要求', '', rules)

  // 预算：先按各节上限裁，再把总量压进整包上限
  for (const section of sections) {
    const cap = CAP[section.id] === undefined ? 2000 : CAP[section.id]
    if (charCount(section.text) > cap) {
      section.text = clipTo(section.text, cap)
      section.trimmed = true
      section.note = (section.note === '' ? '' : section.note + '；') + `已裁到 ${cap} 字`
    }
  }
  const budget = applyBudget(sections)

  // 尾部"禁区"：把"不要读什么"写进包里，避免下一次又把证据摘录拖进上下文
  const openAnnotations = annotations.filter((a) => a.status !== 'resolved' && a.status !== 'ignored').length
  const footer = [
    '---',
    '',
    '## 不要读进上下文的东西',
    '',
    `- \`.dsh-novel-craft/证据摘录.md\`：标注原文，给人回查、给提炼当输入，**不要读**。`,
    `- \`.dsh-novel-craft/marks.json\`、\`.dsh-novel-craft/distill.json\`：机器账目，**不要读**。`,
    `- \`.dsh-novel-craft/批注/*.json\`：批注是给人的改稿清单，用「微调」按钮走，**不要整份读**。`,
    `- 全书合并稿 \`${basename(projectDir)}.txt\`：一次读整本会把上下文吃光，**不要读**。`,
    '',
    openAnnotations === 0
      ? '本章当前没有未处理批注。'
      : `本章还有 ${openAnnotations} 条未处理批注：改稿时先处理它们，再考虑新写。`,
    '',
  ].join('\n')

  const text = [
    `# 第${chapter}章 写作包`,
    '',
    '> 本文件是写稿会话**唯一**需要读的东西：口味来自「作者偏好档案」的规律，前情来自剧情总结，',
    '> 原文不进上下文。整包一起读，不要再去读目录里的其他文件。',
    `> 作品：${basename(projectDir)} · 生成时间：${new Date().toISOString()}`,
    '',
    ...sections.map((s) => ['## ' + s.label, '', s.text, ''].join('\n')),
    footer,
  ].join('\n')

  const path = packPathOf(projectDir, chapter, runDir)
  return {
    chapter,
    path,
    text,
    chars: charCount(text),
    bytes: Buffer.byteLength(text, 'utf8'),
    sections: sections.map((s) => ({
      id: s.id,
      label: s.label,
      source: s.source,
      chars: charCount(s.text),
      bytes: Buffer.byteLength(s.text, 'utf8'),
      trimmed: s.trimmed === true,
      omitted: s.omitted === true,
      note: s.note,
    })),
    budget,
    warnings,
  }
}

/** 按上限裁：优先在段落/行边界断开，且**裁完不超上限**（省略号算在里面）。 */
export function clipTo(text, cap) {
  const s = String(text)
  if (charCount(s) <= cap) return s
  const marker = '\n…（已裁）'
  const room = Math.max(1, cap - charCount(marker))
  const out = []
  let total = 0
  for (const line of s.split('\n')) {
    const size = charCount(line)
    if (total + size > room) break
    out.push(line)
    total += size
  }
  // clip 自己会补一个省略号，这里再让一格，保证"裁完不超上限"是真的
  if (out.length === 0) return clip(s, Math.max(1, room - 1)) + marker
  return out.join('\n') + marker
}

/** 总量预算：按 TRIM_ORDER 依次减半，直到进得去或全部触底。 */
function applyBudget(sections) {
  const total = () => sections.reduce((sum, s) => sum + charCount(s.text), 0)
  let guard = 0
  while (total() > TOTAL_CHARS && guard < 40) {
    guard += 1
    let changed = false
    for (const id of TRIM_ORDER) {
      const section = sections.find((s) => s.id === id)
      if (section === undefined || section.omitted === true) continue
      const floor = FLOOR[id] === undefined ? 0 : FLOOR[id]
      const size = charCount(section.text)
      if (size <= floor) continue
      const next = Math.max(floor, Math.floor(size / 2))
      if (next >= size) continue
      section.text = clipTo(section.text, next)
      section.trimmed = true
      section.note = (section.note === '' ? '' : section.note + '；') + `预算不足，裁到 ${next} 字`
      changed = true
      if (total() <= TOTAL_CHARS) break
    }
    // 全部触底还超：把"补得回来"的整节去掉
    if (!changed) {
      for (const id of TRIM_ORDER) {
        const section = sections.find((s) => s.id === id)
        if (section === undefined || section.omitted === true) continue
        if ((FLOOR[id] === undefined ? 0 : FLOOR[id]) > 0) continue
        section.omitted = true
        section.text = ''
        section.note = '超出整包预算，本节已省略'
        changed = true
        break
      }
      if (!changed) break
    }
  }
  const chars = total()
  return { chars, limit: TOTAL_CHARS, ok: chars <= TOTAL_CHARS, trimmed: sections.some((s) => s.trimmed === true) }
}

/** 挑本章人物：任务/大纲里点名的人优先，否则按"剧情重要性"取前几个。 */
export function pickCast(people, keyText, chapter, max) {
  const limit = max === undefined ? 8 : max
  const named = people.filter((p) => p.name !== undefined && p.name !== '' && String(keyText).includes(p.name))
  const rest = people
    .filter((p) => !named.includes(p))
    .sort((a, b) => importanceRank(a) - importanceRank(b))
  return [...named, ...rest].slice(0, limit)
}

function importanceRank(person) {
  const text = `${person.importance ?? ''}${person.identity ?? ''}`
  if (/主角|男主|女主/.test(text)) return 0
  if (/主要|核心/.test(text)) return 1
  if (/配角|次要/.test(text)) return 2
  return 3
}

/** 挑台账条目：本章要用的优先，其次"当前持有"。 */
export function pickLedger(items, keyText, chapter, max) {
  const limit = max === undefined ? 12 : max
  const used = items.filter((i) => i.name !== undefined && i.name !== '' && String(keyText).includes(i.name))
  const held = items.filter(
    (i) => !used.includes(i) && (i.statusKind === 'held' || i.statusKind === 'implanted') && (i.firstChapter === null || i.firstChapter === undefined || i.firstChapter <= chapter),
  )
  return [...used, ...held].slice(0, limit)
}

/** 落盘 + 返回结果（工作台点「生成写作包」走这里）。 */
export async function writePack(result) {
  await mkdir(dirname(result.path), { recursive: true })
  await writeFile(result.path, result.text, 'utf8')
  const info = await statSafe(result.path)
  return { ...result, bytes: info.bytes, mtime: info.mtime }
}

/** 章节设定模板：文件不存在时先给作者一份骨架（不落盘，界面里显示）。 */
export async function readSetup(projectDir, chapter) {
  const path = setupPathOf(projectDir, chapter)
  const text = await readTextSafe(path)
  return { path, exists: text.trim() !== '', text: text.trim() === '' ? SETUP_TEMPLATE(chapter) : text }
}

/** 保存章节设定。 */
export async function writeSetup(projectDir, chapter, text) {
  const path = setupPathOf(projectDir, chapter)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, String(text), 'utf8')
  return { path, exists: String(text).trim() !== '' }
}

/** 供测试与外部复用的默认参数。 */
export const PACK_DEFAULTS = { CAP, TOTAL_CHARS, BANNED_LIST }
