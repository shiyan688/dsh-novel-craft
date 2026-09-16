/**
 * dsh-novel-craft — 情节体检（plot）
 *
 * 作者写到一半最容易卡在「整体感觉不对，但说不清哪里不对」。这一层把四份材料放到
 * 一起做本地统计：大纲（作者的计划）、剧情总结（每章实际发生了什么）、正文（写出来的
 * 密度与冲突信号）、读者评分（效果如何），产出一份能指着具体章号说话的体检报告。
 *
 * 三条设计红线（改这个文件前先读）：
 * 1. 只做本地字符串统计，**绝不把正文送进模型**——这是本项目的铁律，而情节诊断恰恰
 *    要通读全文，所以只能靠可复现的纯函数；
 * 2. 每条结论都要把依据写进结果（张力的 why、问题的 evidence），作者能自己复核，
 *    否则他不信这份报告；
 * 3. 拿不准的一律降级成 info，并在 message 里写「需人工确认」。宁可少报，也不要给
 *    作者一屏似是而非的告警——告警一多，真问题就被淹了。
 *
 * 除了 readTextFile 这一个读文件的小封装，其余全是纯函数、无副作用、不抛异常。
 *
 * 跑法（自带单测）：node test/plot.test.mjs
 */

import { readFile } from 'node:fs/promises'

// ── 阈值：口味全集中在这里，调参只动这一段 ────────────────────────────────
const TENSION_FLAT = 2 // 张力 ≤2 视作「低」
const TENSION_HIGH = 4 // 张力 ≥4 视作「高」；全书一章都不到，就是「全程平缓」
const FLAT_RUN_MIN = 3 // 连续这么多章低张力才叫「中段塌陷」（2 章太常见，不值得报警）
const FLAT_RUN_LIST_MIN = 2 // 但归档进 metrics.arc.flatRuns 的低张力区间放宽到 2 章
const FORESHADOW_GRACE = 5 // 埋了 ≥5 章还没兑现才算「伏笔超期」：前几章欠着是正常的
// 字数失衡用「相对全书平均」而不是绝对值：网文单章字数区间差异极大，只有相对量才可比
const CHARS_LOW = 0.5
const CHARS_HIGH = 2
// 事件密度：剧情点条数要和篇幅匹配。阈值取「平均字数的 60% / 120%」而不是绝对字数，
// 是因为短篇与长篇的节奏本来就不同；点数的 5 / 1 是经验值——少于 1 个点基本是注水，
// 5 个点塞进不到六成篇幅的章里，读者来不及体会。
const DENSITY_SHORT = 0.6
const DENSITY_LONG = 1.2
const DENSITY_MIN_POINTS = 5
const DENSITY_MAX_POINTS = 1
// 大纲偏移：关键词命中率低于这个值才报。阈值压得很低是拿真实章节量出来的——作者用自己的
// 话写大纲时，同一件事实的字面重合度常常只有 25%–55%（同义改写：写「捡漏发家」，总结里
// 是「淘宝捡漏、赚差价」）。门槛放到 0.4 会把一大批正常章节报成「偏移」，只有低到 0.2 以下，
// 才基本可以断定这一章确实没写大纲说的东西。宁可漏报，也不让作者对着一屏假警报失去信任。
const OUTLINE_HIT_MIN = 0.2
const OUTLINE_MIN_WORDS = 4 // 关键词少于这么多时样本太小，不下结论
const OUTLINE_MIN_PHRASE = 3 // 最长缺失片段至少这么长才算「有内容没兑现」，零散双字词不算
const OUTLINE_ELSEWHERE = 0.35 // 别的章的命中率到这个水平，才谈得上「内容跑到别的章去了」
const OUTLINE_ELSEWHERE_GAP = 0.25 // 而且要明显比本章高，才值得说
const SCORE_DROP = 0.8 // 某章平均分比全书均值低这么多 → 评分下滑
const SCORE_STREAK_DROP = 0.15 // 连跌还要跌够这么多分才值得说；真实数据里 4.22→4.17 这种噪声不该报警
const SCORE_SMALL_SAMPLE = 5 // 评分条数少于这个数，结论降级成 info
const MIN_CHAPTERS = 3 // 章数太少的书，平均值 / 平缓 / 失衡这类判断都没有意义
const EVIDENCE_MAX = 80

// ── 词表：全是本地字符串统计的输入，不进任何模型 ──────────────────────────
/** 动作 / 战斗信号：出现得多，说明这一章「有事发生」 */
const ACTION_WORDS = [
  '拔剑', '出剑', '挥剑', '挥刀', '一刀', '剑光', '刀光', '掌风', '拳风', '厮杀', '搏杀',
  '斩杀', '击杀', '血光', '伤口', '爆开', '炸开', '冲出', '扑来', '追杀', '逃命', '斗法',
  '祭出', '重伤', '妖兽', '法术', '出拳', '一脚', '一掌', '撞开', '轰然', '灵气暴涨',
  '杀', '斩', '劈', '刺', '踢', '打', '轰', '爆', '死', '伤', '逃', '追',
]
/** 转折信号：情节「拐弯」的地方 */
const TURN_WORDS = [
  '却', '突然', '忽然', '竟', '竟然', '反而', '不料', '谁知', '哪知', '岂料', '没想到',
  '猛然', '骤然', '可是', '但是', '然而', '不过', '就在这时', '与此同时', '原来',
]
/** 章末钩子：落在最后两百字里，读者才会想点下一章 */
const HOOK_WORDS = [
  '明天', '明日', '即将', '将要', '终于', '该来', '危机', '悬念', '不知', '还没',
  '才刚开始', '刚刚开始', '下一章', '这时', '此时',
]
/** 提取大纲关键词时要剔掉的虚词、代词、常见动词：它们出现不代表内容被兑现了 */
const STOP_CHARS = new Set([
  ...'的了和与在是把被从向对就都也很还只又并而等这那有为不我你他她它们个之其所以及于至',
  ...'用说道着过会能要想去看来到去做给让使被将会已经再则便于是但并且因此',
])
const FIELD_ALIASES = {
  goal: ['目标', '本章目标', '本章目的', '剧情目标', '目的', '主线', '主线目标'],
  conflict: ['冲突', '矛盾', '危机', '对抗', '阻力', '障碍'],
  turn: ['转折', '反转', '转向', '转折点', '爆点', '爽点', '变化'],
  // 顺序有意为之：宽松匹配时先认「回收」再认「伏笔」，免得「伏笔回收」被判成埋点
  payoff: ['收', '收线', '回收', '兑现', '揭示', '揭晓', '回收伏笔', '回收点'],
  plant: ['埋', '埋下', '埋点', '埋线', '伏笔', '铺垫', '埋伏'],
}
const POINT_HEADINGS = ['核心剧情点', '剧情点', '核心事件', '剧情要点', '主要剧情', '主线剧情', '剧情概览', '本章剧情']
const SETTING_HEADINGS = ['关键设定', '本章设定', '世界观设定', '设定']

// ── 通用小工具：全部容忍坏输入，坏输入返回空值而不是抛异常 ────────────────
const isStr = (v) => typeof v === 'string'
const clip = (text, max = EVIDENCE_MAX) => {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  return s.length <= max ? s : s.slice(0, max - 1) + '…'
}
/** 正文字数口径：去掉空白后的字符数，和作者预期的「这一章多少字」一致 */
const charsOf = (text) => String(text ?? '').replace(/\s+/g, '').length

const CN_NUM = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

function cnNumber(raw) {
  const s = String(raw)
  if (/^\d+$/.test(s)) return Number(s)
  if (s === '十') return 10
  const m = /^([一二三四五六七八九])?十([一二三四五六七八九])?$/.exec(s)
  if (m !== null) return (m[1] === undefined ? 1 : CN_NUM[m[1]]) * 10 + (m[2] === undefined ? 0 : CN_NUM[m[2]])
  if (s.length === 1 && s in CN_NUM) return CN_NUM[s]
  return null
}

/** 认章号：`第8章` / `第 8 章` / `第八章` / 数字或数字字符串。认不出返回 null。 */
function chapterOf(raw) {
  if (typeof raw === 'number') return Number.isInteger(raw) && raw > 0 ? raw : null
  if (!isStr(raw)) return null
  const text = raw.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).trim()
  const m = /第\s*([0-9]+|[一二三四五六七八九十两〇零]{1,3})\s*[章回节]/.exec(text)
  if (m !== null) return cnNumber(m[1])
  if (/^[0-9]{1,4}$/.test(text)) {
    const n = Number(text)
    return n > 0 ? n : null
  }
  return null
}

/** 去掉 markdown 装饰与首尾标点，留下作者真正写的那句话 */
function cleanInline(raw) {
  return String(raw ?? '')
    .replace(/\*\*|__|`|~~/g, '')
    .replace(/^[\s>*+\-—–·]+/, '')
    .replace(/^\d+[.、)）]\s*/, '')
    .replace(/[\s：:]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const nonEmpty = (v) => isStr(v) && v.trim() !== ''

/**
 * 入参容错：这一层是给上层随手调用的，`null`、字符串、undefined 都可能递进来。
 * 全部归一成对象，坏输入就当「这份材料没给」——体检报告不该因为参数脏就整个抛出来。
 */
const asOptions = (input) => (input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {})

const indentOf = (line) => String(line).replace(/\t/g, '  ').match(/^\s*/)[0].length
const listTextOf = (line) => {
  const m = /^\s*(?:[-*+]|\d+[.、)）])\s+(.*)$/.exec(String(line))
  return m === null ? null : m[1]
}
/** 只留下中日韩汉字，其余（标点、数字、拉丁字母）一律丢掉，方便做 n-gram 统计 */
const cjkRuns = (text) => String(text ?? '').split(/[^\u4e00-\u9fa5]+/).filter((run) => run !== '')

/**
 * 命中计数：同一位置只算一次，且优先长词（`斩杀` 不会既算「斩」又算「杀」）。
 * 不用正则是因为词表里既有单字词也有多字词，正则会重复计数。
 */
function countWords(text, words) {
  const set = new Set(words)
  let maxLen = 1
  for (const w of words) maxLen = Math.max(maxLen, w.length)
  let hits = 0
  let i = 0
  while (i < text.length) {
    let matched = 0
    for (let len = maxLen; len >= 2; len -= 1) {
      const piece = text.slice(i, i + len)
      if (piece.length === len && set.has(piece)) {
        matched = len
        break
      }
    }
    if (matched === 0 && set.has(text[i])) matched = 1
    if (matched > 0) {
      hits += 1
      i += matched
    } else {
      i += 1
    }
  }
  return hits
}

/**
 * 正文首行通常是「第8章 望舒城（二）」这样的标题：它不该算进对话密度、字数这些口径。
 * 只认「第N章…」或「短且没有句末标点」这两种形态，避免把正文第一句当标题吃掉。
 */
function stripTitleLine(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  if (lines.length < 2) return lines.join('\n')
  const first = lines[0].trim()
  const looksTitle = /第\s*[0-9一二三四五六七八九十两〇零]{1,4}\s*[章回节]/.test(first) || (first.length <= 30 && !/[。！？；]/.test(first))
  if (looksTitle) lines.shift()
  return lines.join('\n')
}

const clamp1to5 = (n) => Math.min(5, Math.max(1, Math.round(n)))
const nodeOf = (map, chapter) => {
  if (!map.has(chapter)) {
    map.set(chapter, { chapter, title: '', goal: '', conflict: '', turn: '', plant: [], payoff: [], lines: [] })
  }
  return map.get(chapter)
}
const pushUnique = (list, item) => {
  if (item !== '' && !list.includes(item)) list.push(item)
}

/**
 * 读一个文本文件（正文 / 剧情总结 / 评论 json 都行）。
 * 全文件唯一碰 IO 的函数，也是唯一 async 的：读不到就返回 ''，
 * 体检报告不该因为某个文件被改名或删掉就整个崩掉。
 */
export async function readTextFile(path) {
  if (!isStr(path) || path === '') return ''
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

// ── 大纲 ─────────────────────────────────────────────────────────────────
/** 字段行：`- 目标：xxx` / `**冲突**：xxx` / `目标: xxx` / `1. 目标：xxx`。认不出返回 null。 */
function parseFieldLine(line) {
  const m = /^(?:[-*+>]\s*|\d+[.、)）]\s*)?(?:\*\*|__)?([^：:*_]{1,12})(?:\*\*|__)?\s*[：:]\s*(.*)$/.exec(line)
  if (m === null) return null
  const key = fieldKeyOf(m[1])
  if (key === null) return null
  return { key, value: m[2] }
}

function fieldKeyOf(label) {
  const norm = String(label ?? '').replace(/[\s*＊`#>：:【】\[\]（）()]/g, '')
  if (norm === '') return null
  for (const [key, names] of Object.entries(FIELD_ALIASES)) {
    if (names.includes(norm)) return key
  }
  // 宽松一档：`本章冲突`「第3章转折」这类加了前后缀的写法也认；单字别名（埋/收）不参与宽松匹配
  for (const [key, names] of Object.entries(FIELD_ALIASES)) {
    if (names.some((name) => name.length >= 2 && (norm.startsWith(name) || norm.endsWith(name)))) return key
  }
  return null
}

/** 埋点 / 回收点这类字段里往往是一条条短条目，用顿号逗号分号切开 */
const splitItems = (text) =>
  String(text ?? '')
    .split(/[、，,；;]/)
    .map((piece) => cleanInline(piece))
    .filter((piece) => piece !== '')

function assignField(node, key, value) {
  const text = cleanInline(value)
  if (text === '') return
  if (key === 'plant' || key === 'payoff') {
    for (const item of splitItems(text)) pushUnique(node[key], item)
    return
  }
  if (node[key] === '') node[key] = text
  else if (!node[key].includes(text)) node[key] = node[key] + '；' + text
}

const isTableRow = (line) => /^\|.*\|/.test(line)
const tableCells = (line) =>
  line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
const isTableSeparator = (cells) => cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell))

/** 表头 → 列含义。认不出表头就用位置约定（第 1 列章号，第 2 列标题，之后依次目标/冲突/转折）。 */
function tableColumnMap(cells) {
  const map = {}
  cells.forEach((cell, index) => {
    if (/章/.test(cell) && chapterOf(cell) === null) {
      map.chapter = index
      return
    }
    if (/标题|章名|名称/.test(cell)) {
      map.title = index
      return
    }
    const key = fieldKeyOf(cell)
    if (key !== null) map[key] = index
  })
  return Object.keys(map).length > 0 ? map : null
}

const POSITIONAL_COLUMNS = ['chapter', 'title', 'goal', 'conflict', 'turn', 'plant', 'payoff']

/**
 * 解析大纲。作者怎么写都得认，所以同时支持两种写法：
 *   (a) 小节式：`## 第3章 标题` 里用 `- 目标：xxx` / `- 冲突：xxx` / `- 埋：xxx` 这类字段行；
 *   (b) 表格式：`| 3 | 标题 | 目标 | 冲突 | 转折 |`（有表头就按表头认列，没表头按位置认）。
 * 认不出的行直接忽略——大纲是作者手写的，宽松比严格有用。
 */
export function parseOutline(text) {
  if (!isStr(text)) return { chapters: [] }
  const nodes = new Map()
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let node = null
  let field = null // 正在收集的字段：`### 目标` 那种小节写法要靠它把后续行收进来
  let columnMap = null

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    if (trimmed === '') continue

    if (isTableRow(trimmed)) {
      const cells = tableCells(trimmed)
      if (isTableSeparator(cells)) continue
      if (columnMap === null) {
        const head = tableColumnMap(cells)
        // 表头行的章号列一定不是数字；data 行第一格（或表头指定列）一定是章号
        const guess = chapterOf(cells[0] ?? '')
        if (head !== null && guess === null) {
          columnMap = head
          continue
        }
      }
      const map = columnMap ?? Object.fromEntries(POSITIONAL_COLUMNS.map((key, index) => [key, index]))
      const chapter = chapterOf(cells[map.chapter ?? 0] ?? '')
      if (chapter === null) continue
      const row = nodeOf(nodes, chapter)
      row.lines.push(rawLine)
      for (const [key, index] of Object.entries(map)) {
        if (key === 'chapter') continue
        if (key === 'title') {
          if (row.title === '') row.title = cleanInline(cells[index] ?? '')
          continue
        }
        assignField(row, key, cells[index] ?? '')
      }
      node = row
      continue
    }

    const heading = /^(#{1,6})\s*(.+?)\s*$/.exec(trimmed)
    if (heading !== null) {
      field = null
      const chapter = chapterOf(heading[2])
      if (chapter !== null) {
        node = nodeOf(nodes, chapter)
        node.lines.push(rawLine)
        if (node.title === '') node.title = cleanInline(heading[2].replace(/第\s*[0-9一二三四五六七八九十两〇零]{1,4}\s*[章回节]/, ''))
        continue
      }
      const key = fieldKeyOf(heading[2])
      if (key !== null && node !== null) field = key
      continue
    }

    if (node === null) continue
    const parsed = parseFieldLine(trimmed)
    if (parsed !== null) {
      field = parsed.key
      assignField(node, parsed.key, parsed.value)
      node.lines.push(rawLine)
      continue
    }
    // 没有字段名的续行 / 子项：算进当前字段（`- 埋：云苍山君` 下面缩进的几条子项就是这么收进来的）
    if (field !== null) {
      assignField(node, field, listTextOf(trimmed) ?? trimmed)
      node.lines.push(rawLine)
    }
  }

  const chapters = [...nodes.values()]
    .sort((a, b) => a.chapter - b.chapter)
    .map((entry) => ({
      chapter: entry.chapter,
      title: entry.title,
      goal: entry.goal,
      conflict: entry.conflict,
      turn: entry.turn,
      plant: entry.plant.slice(),
      payoff: entry.payoff.slice(),
      raw: entry.lines.join('\n'),
    }))
  return { chapters }
}

// ── 剧情总结 ─────────────────────────────────────────────────────────────
function sectionsOf(text) {
  const out = []
  let current = null
  for (const line of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^(#{1,6})\s*(.+?)\s*$/.exec(line.trim())
    if (m !== null) {
      current = { heading: m[2], lines: [] }
      out.push(current)
      continue
    }
    if (current === null) {
      current = { heading: '', lines: [] }
      out.push(current)
    }
    current.lines.push(line)
  }
  return out
}

const normHeading = (heading) => String(heading ?? '').replace(/[\s#*：:]/g, '')
const sectionMatching = (sections, names) =>
  sections.find((section) => names.some((name) => normHeading(section.heading).includes(name)))

/**
 * 取列表项，并把缩进的子项并进父项（用 · 连接）。
 * 为什么合并而不是各算一条：剧情点条数要拿来算「事件密度」，子项属于父事件的细节，
 * 各算一条会让写了细节的章节凭空显得事件更多。
 */
function listItems(lines) {
  const items = []
  for (const line of lines) {
    const text = listTextOf(line)
    if (text === null) continue
    const cleaned = cleanInline(text)
    if (cleaned === '') continue
    items.push({ indent: indentOf(line), text: cleaned })
  }
  if (items.length === 0) return []
  const base = Math.min(...items.map((item) => item.indent))
  const out = []
  for (const item of items) {
    const last = out.length === 0 ? null : out[out.length - 1]
    if (last !== null && item.indent > base) last.text = last.text + ' · ' + item.text
    else out.push({ text: item.text })
  }
  return out.map((item) => item.text)
}

function titleOfSummary(text) {
  const heading = String(text ?? '').match(/^#{1,6}\s*(.+?)\s*$/m)
  if (heading === null) return ''
  return cleanInline(
    heading[1]
      .replace(/第\s*[0-9一二三四五六七八九十两〇零]{1,4}\s*[章回节]/, '')
      .replace(/[-—_–\s]*剧情总结.*$/, '')
      .replace(/^[-—_–\s]+/, ''),
  ) || ''
}

/**
 * 解析剧情总结。list = [{ chapter, text }]，text 是那一章总结的 markdown。
 * 章号取调用方给的 chapter（文件名里已经带过了），标题从首个 `#` 标题里抠。
 */
export function parseSummaries(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const item of list) {
    if (item === null || typeof item !== 'object') continue
    const chapter = chapterOf(item.chapter)
    if (chapter === null) continue
    const text = isStr(item.text) ? item.text : ''
    const sections = sectionsOf(text)
    let points = []
    const pointSection = sectionMatching(sections, POINT_HEADINGS)
    if (pointSection !== undefined) {
      points = listItems(pointSection.lines)
    } else {
      // 总结没按约定写小标题时，退而取「列表项最多的那一节」——比全文档瞎抓准得多，
      // 也能避开「关键设定」那节把设定条目混进剧情点
      let best = []
      for (const section of sections) {
        const items = listItems(section.lines)
        if (items.length > best.length) best = items
      }
      points = best
    }
    const settingSection = sectionMatching(sections, SETTING_HEADINGS)
    out.push({
      chapter,
      title: titleOfSummary(text),
      points,
      settings: settingSection === undefined ? [] : listItems(settingSection.lines),
      raw: text,
    })
  }
  return out.sort((a, b) => a.chapter - b.chapter)
}

/** 剧情总结入参兼容两种形态：parseSummaries 的产物，或者原始的 [{ chapter, text }]。 */
function normalizeSummaries(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const item of list) {
    if (item === null || typeof item !== 'object') continue
    const chapter = chapterOf(item.chapter)
    if (chapter === null) continue
    if (Array.isArray(item.points)) {
      out.push({
        chapter,
        title: isStr(item.title) ? item.title : '',
        points: item.points.filter(nonEmpty).map((point) => cleanInline(point)),
        settings: Array.isArray(item.settings) ? item.settings.filter(nonEmpty).map((s) => cleanInline(s)) : [],
        raw: isStr(item.raw) ? item.raw : isStr(item.text) ? item.text : '',
      })
      continue
    }
    out.push(...parseSummaries([{ chapter, text: isStr(item.text) ? item.text : isStr(item.raw) ? item.raw : '' }]))
  }
  return out.sort((a, b) => a.chapter - b.chapter)
}

/** 正文入参：只认 [{ chapter, text }]，顺手把正文主体和字数算好（后面全都要用）。 */
function normalizeChapters(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const item of list) {
    if (item === null || typeof item !== 'object') continue
    const chapter = chapterOf(item.chapter)
    if (chapter === null) continue
    const text = isStr(item.text) ? item.text : ''
    const body = stripTitleLine(text)
    out.push({ chapter, text, body, chars: charsOf(body) })
  }
  return out.sort((a, b) => a.chapter - b.chapter)
}

/** 大纲入参兼容：markdown 字符串 / { chapters } / 节点数组。 */
function normalizeOutline(outline) {
  if (isStr(outline)) return parseOutline(outline).chapters
  if (Array.isArray(outline)) return outline.filter((node) => node !== null && typeof node === 'object')
  if (outline !== null && typeof outline === 'object' && Array.isArray(outline.chapters)) return outline.chapters
  return []
}

// ── 张力 ─────────────────────────────────────────────────────────────────
/**
 * 单章张力估计。全部依据都摆在返回值里（signals + why），因为这是**估**的：
 * 作者一旦看到「估」字和依据，就知道该不该信它。
 *
 * 打分 = 各信号加权求和（每项先做饱和，避免长章被字数放大）：
 *   对话占比 / 叹问密度 / 战斗词密度 / 转折词密度 / 章末钩子 / 该章剧情点条数
 * 权重按「对读者体感的影响」拍：战斗与冲突信号最重，钩子次之，问号感叹号最轻。
 */
export function estimateTension(input = {}) {
  const { chapter, text, summary } = asOptions(input)
  const body = stripTitleLine(isStr(text) ? text : '')
  const chars = charsOf(body)
  const quoteChars = (body.match(/[“「][^”」]*[”」]/g) ?? []).reduce((sum, piece) => Math.max(0, sum + piece.length - 2), 0)
  const dialogueRatio = chars === 0 ? 0 : quoteChars / chars
  const exclaim = (body.match(/[？！?!]/g) ?? []).length
  const action = countWords(body, ACTION_WORDS)
  const turn = countWords(body, TURN_WORDS)
  const tail = body.slice(-240)
  const hookHits = (tail.match(/[？！]/g) ?? []).length + HOOK_WORDS.filter((word) => tail.includes(word)).length
  const points = summary !== null && typeof summary === 'object' && Array.isArray(summary.points) ? summary.points.length : 0
  const per1000 = (n) => (chars === 0 ? 0 : (n * 1000) / chars)
  const signals = {
    chars,
    dialogueRatio: Number(dialogueRatio.toFixed(3)),
    exclaimRate: Number(per1000(exclaim).toFixed(1)),
    actionRate: Number(per1000(action).toFixed(1)),
    turnRate: Number(per1000(turn).toFixed(1)),
    hook: hookHits > 0,
    points,
  }

  const sat = (ratio) => Math.min(1, Math.max(0, ratio))
  // 权重与饱和点都是拿真实章节（逐弈登仙 1–12 章）试出来的：战斗/转折这类「有事发生」的
  // 信号最重，问号感叹号最轻；饱和点定在「这一项满格需要多密」，避免长章被字数放大。
  const score =
    0.8 * sat(dialogueRatio / 0.25) +
    0.7 * sat(signals.exclaimRate / 18) +
    1.5 * sat(signals.actionRate / 12) +
    0.9 * sat(signals.turnRate / 8) +
    (signals.hook ? 0.6 : 0) +
    0.6 * sat(points / 8)

  let value = score < 0.9 ? 1 : score < 1.9 ? 2 : score < 2.9 ? 3 : score < 3.9 ? 4 : 5
  const notes = []
  if (chars === 0) {
    value = 1
    notes.push('这一章没有正文（可能还没写，或文件没读到），按最低张力 1 计，需人工确认')
  } else if (chars < 200) {
    // 两百字以下不足以判断节奏：封顶 2，并明确告诉作者这个数不可靠
    value = Math.min(value, 2)
    notes.push(`正文只有 ${chars} 字，太短无法判断节奏，已封顶为 2，需人工确认`)
  }
  const basis =
    `对话占比 ${Math.round(dialogueRatio * 100)}%、叹问 ${signals.exclaimRate}/千字、战斗词 ${signals.actionRate}/千字、` +
    `转折词 ${signals.turnRate}/千字、章末${signals.hook ? '有' : '没有'}钩子、剧情点 ${points} 条`
  const why = (notes.length === 0 ? '' : notes.join('；') + '。') + `估 ${value} 分（自动估计，不是作者标的）：${basis}`
  return { chapter: chapterOf(chapter), value, source: 'estimated', why, signals }
}

/** 手工标注入参兼容：{ '8': 4 }（章号 → 1..5）或 [{ chapter, value }]。 */
function normalizeManual(manual) {
  const out = new Map()
  const put = (chapter, value) => {
    const num = chapterOf(chapter)
    const val = Number(value)
    if (num === null || !Number.isFinite(val) || val < 1 || val > 5) return
    out.set(num, clamp1to5(val))
  }
  if (Array.isArray(manual)) {
    for (const item of manual) {
      if (item !== null && typeof item === 'object') put(item.chapter, item.value)
    }
    return out
  }
  if (manual !== null && typeof manual === 'object') {
    for (const [chapter, value] of Object.entries(manual)) put(chapter, value)
  }
  return out
}

/**
 * 张力曲线：作者手工标的优先，其余按 estimateTension 估。
 * 估出来的条目 source 是 'estimated'，why 里也写着「估」——上层 UI 该把它们画成虚线，
 * 别让作者以为那是自己标过的数据。
 */
export function buildTensionSeries(input = {}) {
  const { chapters, outline, summaries, manual } = asOptions(input)
  const chs = normalizeChapters(chapters)
  const sums = normalizeSummaries(summaries)
  const marks = normalizeManual(manual)
  const nodes = normalizeOutline(outline)

  const chaptersInPlay = new Set()
  for (const entry of chs) chaptersInPlay.add(entry.chapter)
  for (const entry of sums) chaptersInPlay.add(entry.chapter)
  for (const chapter of marks.keys()) chaptersInPlay.add(chapter)
  // 有成文正文的章一定要出现；只有大纲还没写的章不进曲线，免得凭空多出一排「1 分」
  const list = [...chaptersInPlay].sort((a, b) => a - b)

  const summaryMap = new Map(sums.map((entry) => [entry.chapter, entry]))
  const chapterMap = new Map(chs.map((entry) => [entry.chapter, entry]))
  const nodeMap = new Map()
  for (const node of nodes) {
    const chapter = chapterOf(node.chapter)
    if (chapter !== null) nodeMap.set(chapter, node)
  }

  return list.map((chapter) => {
    const chapterEntry = chapterMap.get(chapter)
    const estimated = estimateTension({ chapter, text: chapterEntry === undefined ? '' : chapterEntry.text, summary: summaryMap.get(chapter) })
    const manualValue = marks.get(chapter)
    if (manualValue !== undefined) {
      const gap = Math.abs(manualValue - estimated.value)
      const note = gap >= 2 ? `（自动估计是 ${estimated.value} 分，与你标的手工值差 ${gap} 分，建议复核这一章）` : ''
      return { chapter, value: manualValue, source: 'manual', why: `作者手工标注 ${manualValue} 分${note}` }
    }
    // 大纲是作者的计划，正文是事实。计划里明明写了冲突/转折、正文里却一点信号都没有，
    // 这句话只能由「大纲 + 正文」两份材料合起来说，所以放在这里补进依据里。
    const node = nodeMap.get(chapter)
    const planned = node !== undefined && (nonEmpty(node.conflict) || nonEmpty(node.turn))
    const hint = planned && estimated.value <= TENSION_FLAT ? '（大纲里写了冲突/转折，正文里却没看到对应信号，需人工确认）' : ''
    return { chapter, value: estimated.value, source: 'estimated', why: estimated.why + hint }
  })
}

// ── 伏笔 ─────────────────────────────────────────────────────────────────
/** 去掉书名号、括号、标点，留下可比对的「核」 */
const coreOf = (text) =>
  String(text ?? '').replace(/[【】「」『』《》〈〉（）()\[\]{}“”"'’‘\s，,。.；;：:、·\-—_!！?？]/g, '')

/**
 * 一个伏笔名字的「线索词」：整名，外加用 的 / 之 切出来的每一段（≥2 字）。
 * 为什么要切开：`铁面生的身份` 这一章只要提到「铁面生」就算有线索了。
 * 兑现判定最容易误报，作者换了说法不该被算成没兑现，所以这里故意放宽。
 */
function clueWordsOf(name) {
  const core = coreOf(name)
  if (core === '') return []
  const words = [core]
  for (const piece of core.split(/[的之]/)) {
    if (piece.length >= 2 && !words.includes(piece)) words.push(piece)
  }
  return words
}

/** 这一段材料里有没有这个伏笔的线索词 */
function hasClue(wordList, haystack) {
  return wordList.some((word) => haystack.includes(word))
}

/** 两个伏笔是不是同一件事：核相同，或短的那个完整包含在长的里面（且短的至少有 2 个字） */
function sameThing(a, b) {
  const x = coreOf(a)
  const y = coreOf(b)
  if (x === '' || y === '') return false
  if (x === y) return true
  const shorter = x.length <= y.length ? x : y
  const longer = x.length <= y.length ? y : x
  return shorter.length >= 2 && longer.includes(shorter)
}

/** 从伏笔条目里认作者手写的兑现期限：`（第20章收）` / `20章内兑现`。认不出返回 null。 */
function dueFromText(text) {
  const m = /(?:第)?\s*(\d{1,3})\s*章\s*(?:前|内|之前|以内)?\s*(?:收|还|兑现|回收|揭晓|揭开)/.exec(String(text ?? ''))
  return m === null ? null : Number(m[1])
}

const displayName = (text) => {
  const clean = cleanInline(text)
  return clean.length <= 40 ? clean : clean.slice(0, 39) + '…'
}

/**
 * 伏笔总账。配对规则刻意保守——这一项最容易误报，所以：
 * - 明账：大纲里 plant 的条目，和之后某个章节 payoff 里能对上的，直接算兑现；
 * - 暗账：return 里没声明兑现章，但之后的剧情总结 / 正文里确实提到了这个名字，也算兑现
 *   （作者可能忘了回填大纲）；只在「之后」找，避免同章自证；
 * - 声明了兑现章却在那一章找不到线索的，单独算「该收没收」；
 * - 只有到大结局还毫无踪迹、且已经欠过 FORESHADOW_GRACE 章，才判超期。
 */
function analyzeForeshadows(input = {}) {
  const { outline, chapters, summaries } = asOptions(input)
  const nodes = normalizeOutline(outline)
  const chs = normalizeChapters(chapters)
  const sums = normalizeSummaries(summaries)
  const chapterMap = new Map(chs.map((entry) => [entry.chapter, entry]))
  const summaryMap = new Map(sums.map((entry) => [entry.chapter, entry]))

  const lastKnown = Math.max(
    0,
    ...nodes.map((node) => chapterOf(node.chapter) ?? 0),
    ...chs.map((entry) => entry.chapter),
    ...sums.map((entry) => entry.chapter),
  )

  const plants = []
  const payoffs = []
  for (const node of nodes) {
    const chapter = chapterOf(node.chapter)
    if (chapter === null) continue
    for (const item of Array.isArray(node.plant) ? node.plant : []) {
      if (nonEmpty(item)) plants.push({ name: displayName(item), chapter, due: dueFromText(item) })
    }
    for (const item of Array.isArray(node.payoff) ? node.payoff : []) {
      if (nonEmpty(item)) payoffs.push({ name: displayName(item), chapter })
    }
  }
  plants.sort((a, b) => a.chapter - b.chapter)

  /** 之后的某一章里有没有这个名字的踪迹：总结优先（说明这章在处理它），其次正文 */
  const trackLater = (name, from) => {
    const words = clueWordsOf(name)
    if (words.length === 0) return null
    const later = [...new Set([...summaryMap.keys(), ...chapterMap.keys()])].filter((chapter) => chapter > from).sort((a, b) => a - b)
    for (const chapter of later) {
      const summary = summaryMap.get(chapter)
      const summaryText = summary === undefined ? '' : summary.points.join(' ') + ' ' + summary.raw
      if (hasClue(words, summaryText)) return chapter
    }
    for (const chapter of later) {
      const entry = chapterMap.get(chapter)
      if (entry !== undefined && hasClue(words, entry.text)) return chapter
    }
    return null
  }

  const out = []
  const seen = new Set()
  const details = []
  for (const plant of plants) {
    const key = coreOf(plant.name)
    if (key === '' || seen.has(key)) continue
    seen.add(key)

    const declared = payoffs
      .filter((payoff) => payoff.chapter >= plant.chapter && sameThing(payoff.name, plant.name))
      .sort((a, b) => a.chapter - b.chapter)[0]
    let paidChapter = null
    let declaredPayoff = null
    let reason = null

    if (declared !== undefined) {
      declaredPayoff = declared.chapter
      const summary = summaryMap.get(declared.chapter)
      const entry = chapterMap.get(declared.chapter)
      const haystack = (summary === undefined ? '' : summary.points.join(' ') + ' ' + summary.raw) + ' ' + (entry === undefined ? '' : entry.text)
      // 有材料才查；这一章一个字都没有时不下结论（宁可不报）
      if ((summary === undefined && entry === undefined) || hasClue(clueWordsOf(plant.name), haystack)) paidChapter = declared.chapter
      else reason = 'no-clue'
    } else {
      const found = trackLater(plant.name, plant.chapter)
      if (found !== null) {
        paidChapter = found
        reason = 'late'
      }
    }

    const dueChapter = plant.due !== null ? plant.due : declaredPayoff
    const closed = paidChapter !== null ? paidChapter : dueChapter !== null ? Math.min(dueChapter, lastKnown) : lastKnown
    const openChapters = Math.max(0, closed - plant.chapter)
    const overdue =
      reason === 'no-clue' ||
      paidChapter === null && lastKnown - plant.chapter >= FORESHADOW_GRACE ||
      paidChapter !== null && dueChapter !== null && paidChapter > dueChapter
    if (reason === 'late' && !overdue) reason = null

    out.push({
      name: plant.name,
      plantedChapter: plant.chapter,
      dueChapter,
      paidChapter,
      openChapters,
      overdue,
    })
    details.push({
      ...out[out.length - 1],
      declaredPayoff,
      lastKnown,
      reason,
    })
  }
  return { debts: out, details }
}

/** 伏笔欠账：从 outline 的 plant/payoff 里配对，再把「该收没收」的挑出来。 */
export function foreshadowDebts(input = {}) {
  const { outline, chapters, summaries } = asOptions(input)
  return analyzeForeshadows({ outline, chapters, summaries }).debts
}

// ── 大纲关键词 ───────────────────────────────────────────────────────────
/**
 * 从大纲字段里抽 2 字关键词（孪生词组）。
 * 为什么用双字词而不是「名词短语」：中文没有分词器就要靠词典，而词典必然漏人名、
 * 门派名、道具名这些本书自造的词；双字滑窗不吃词典，人名（宁陈）和自造词（通透世界
 * 里的 通透/透世/世界）照样能被覆盖。自带一点噪声——虚词已被停用字表滤掉，
 * 剩下的噪声只会稀释命中率，不会凭空报错（某个词若整体命中，它的所有双字切分也都命中）。
 */
function keywordsOf(text) {
  const words = []
  const seen = new Set()
  for (const run of cjkRuns(text)) {
    for (let i = 0; i + 1 < run.length; i += 1) {
      const word = run.slice(i, i + 2)
      if ([...word].some((ch) => STOP_CHARS.has(ch))) continue
      if (seen.has(word)) continue
      seen.add(word)
      words.push(word)
    }
  }
  return words
}

/** 在原文里找「所有双字词都缺失」的最长连续片段，作为给人看的证据（比裸双字词好读）。 */
function missingPhraseOf(fieldText, missing) {
  const missSet = new Set(missing)
  let best = ''
  for (const run of cjkRuns(fieldText)) {
    for (let i = 0; i + 1 < run.length; i += 1) {
      if (!missSet.has(run.slice(i, i + 2))) continue
      let end = i + 2
      while (end < run.length && missSet.has(run.slice(end - 1, end + 1))) end += 1
      const piece = run.slice(i, end)
      if (piece.length > best.length) best = piece
    }
  }
  return best
}

/** 关键词在总结里有没有着落：整词命中算 1，只有 2 字切片命中算 0.5（部分兑现） */
function keywordHits(words, haystack) {
  let hit = 0
  const missing = []
  for (const word of words) {
    if (haystack.includes(word)) {
      hit += 1
      continue
    }
    let partial = false
    for (let i = 0; i + 1 < word.length; i += 1) {
      if (haystack.includes(word.slice(i, i + 2))) partial = true
    }
    if (partial) hit += 0.5
    else missing.push(word)
  }
  return { hit, missing }
}

// ── 综合诊断 ─────────────────────────────────────────────────────────────
const finding = (level, code, chapter, message, evidence) => ({
  level,
  code,
  chapter,
  message,
  evidence: clip(evidence),
})

/** 连续区间 → 人能读的章号串：`3、4、5` / `1、7、9` */
const chapterList = (chapters) => chapters.join('、')

function flatRunsOf(series, min) {
  const runs = []
  let run = []
  for (const point of series) {
    const prev = run.length === 0 ? null : run[run.length - 1].chapter
    // 只把「章号连续」的算作一段：1、5、9 都低不等于中间塌了一整段
    if (point.value <= TENSION_FLAT && (prev === null || point.chapter === prev + 1)) {
      run.push(point)
      continue
    }
    if (run.length >= min) runs.push([run[0].chapter, run[run.length - 1].chapter])
    run = point.value <= TENSION_FLAT ? [point] : []
  }
  if (run.length >= min) runs.push([run[0].chapter, run[run.length - 1].chapter])
  return runs
}

/**
 * 综合诊断：把张力、大纲、伏笔、字数、事件密度、读者评分六件事各查一遍。
 * 所有输入都可缺省——缺哪份材料就少查哪一项，绝不用别处的数据硬凑。
 */
export function detectPlotIssues(input = {}) {
  const { chapters, outline, summaries, tensions, scores } = asOptions(input)
  const chs = normalizeChapters(chapters)
  const nodes = normalizeOutline(outline)
  const sums = normalizeSummaries(summaries)
  const findings = []

  // 张力：优先用上层给的那条曲线（可能带着作者手工标注），没给就自己估
  let series = []
  if (Array.isArray(tensions)) {
    const seen = new Set()
    for (const item of tensions) {
      if (item === null || typeof item !== 'object') continue
      const chapter = chapterOf(item.chapter)
      const value = Number(item.value)
      if (chapter === null || !Number.isFinite(value) || seen.has(chapter)) continue
      seen.add(chapter)
      series.push({
        chapter,
        value: clamp1to5(value),
        source: item.source === 'manual' ? 'manual' : 'estimated',
        why: isStr(item.why) ? item.why : '',
      })
    }
    series.sort((a, b) => a.chapter - b.chapter)
  }
  if (series.length === 0 && (chs.length > 0 || sums.length > 0)) {
    series = buildTensionSeries({ chapters: chs, outline: nodes, summaries: sums })
    // 一章正文都没有时，估出来的张力必然全是 1——那是「没材料」，不是「书很平」。
    // 这种时候宁可把曲线留空（等于「这项没数据」），也不能报一条假的「全程平缓」。
    if (!chs.some((entry) => entry.chars > 0)) series = []
  }

  const chapterMap = new Map(chs.map((entry) => [entry.chapter, entry]))
  const summaryMap = new Map(sums.map((entry) => [entry.chapter, entry]))
  const chapterCount = chs.length > 0 ? chs.length : new Set([...sums.map((entry) => entry.chapter), ...nodes.map((node) => chapterOf(node.chapter)).filter((n) => n !== null)]).size
  const totalChars = chs.reduce((sum, entry) => sum + entry.chars, 0)
  const avgChars = chapterCount === 0 ? 0 : Math.round(totalChars / chapterCount)

  // ── 1. 中段塌陷 / 全程平缓 ──
  const flatRuns = series.length === 0 ? [] : flatRunsOf(series, FLAT_RUN_LIST_MIN)
  const peak = series.length === 0 ? null : series.reduce((best, point) => (point.value > best.value ? point : best), series[0])
  const trough = series.length === 0 ? null : series.reduce((best, point) => (point.value < best.value ? point : best), series[0])
  if (chapterCount >= MIN_CHAPTERS && series.length >= MIN_CHAPTERS) {
    for (const [from, to] of flatRunsOf(series, FLAT_RUN_MIN)) {
      const inside = series.filter((point) => point.chapter >= from && point.chapter <= to)
      const runMax = Math.max(...inside.map((point) => point.value))
      const later = series.filter((point) => point.chapter > to)
      const laterMax = later.length === 0 ? 0 : Math.max(...later.map((point) => point.value))
      // 「塌陷」的前提是后文还能起来：后面没有明显更高的张力，那就只是整体平缓，
      // 不该报成中段问题（否则一本书会被同时报成「塌陷」和「平缓」，作者只会觉得报告在骂人）
      if (later.length === 0 || laterMax < 3 || laterMax <= runMax) continue
      const laterPoint = later.find((point) => point.value === laterMax)
      findings.push(
        finding(
          'warn',
          '中段塌陷',
          to,
          `第 ${from}–${to} 章连续 ${to - from + 1} 章张力都 ≤${runMax}（各章 ${inside.map((p) => p.value).join('/')}），` +
            `而第 ${laterPoint.chapter} 章的张力回到 ${laterMax}：这段更像「中段塌陷」，不是全书本来就平。` +
            `可以试试：把这几章里能并的事件并成一章、给主线补一个当章就爆的冲突，或把后面某条伏笔提前到这段兑现。`,
          `第 ${from}–${to} 章张力 ${inside.map((p) => p.chapter + ':' + p.value).join(' ')}，后面第 ${laterPoint.chapter} 章为 ${laterMax}`,
        ),
      )
    }
    const top = Math.max(...series.map((point) => point.value))
    if (top < TENSION_HIGH) {
      findings.push(
        finding(
          'info',
          '全程平缓',
          peak === null ? null : peak.chapter,
          `全书没有一章的张力到 ${TENSION_HIGH}（最高的第 ${peak === null ? '?' : peak.chapter} 章只有 ${top} 分）：` +
            `读者容易觉得「一直在铺垫」。建议挑最该爆的那一章明显加码，或在章末留更硬的钩子。` +
            `需人工确认——张力是按正文里的冲突信号估的，不代表你的判断。`,
          `最高张力 ${top} 分（第 ${peak === null ? '?' : peak.chapter} 章）`,
        ),
      )
    }
  }

  // ── 2. 大纲偏移 / 大纲缺失 ──
  const nodeChapters = new Set()
  for (const node of nodes) {
    const chapter = chapterOf(node.chapter)
    if (chapter === null) continue
    nodeChapters.add(chapter)
    const summary = summaryMap.get(chapter)
    const entry = chapterMap.get(chapter)
    if (summary === undefined && entry === undefined) continue // 还没写到这一章，无从对账
    const fields = [node.goal, node.conflict, node.turn].filter(nonEmpty).map((field) => cleanInline(field))
    if (fields.length === 0) continue
    const summaryText = summary === undefined ? '' : summary.title + ' ' + summary.points.join(' ') + ' ' + summary.settings.join(' ')
    const words = []
    const seenWord = new Set()
    for (const field of fields) {
      for (const word of keywordsOf(field)) {
        if (seenWord.has(word)) continue
        seenWord.add(word)
        words.push(word)
      }
    }
    if (words.length < OUTLINE_MIN_WORDS) continue // 关键词太少，样本不够，不下结论
    const { hit, missing } = keywordHits(words, summaryText)
    const rate = hit / words.length
    if (missing.length === 0 || rate >= OUTLINE_HIT_MIN) continue
    const phrase = missingPhraseOf(fields.join('。'), missing)
    if (phrase.length < OUTLINE_MIN_PHRASE) continue // 只有零星双字词对不上，不够格下结论
    // 总结是「这一章写了什么」的账本，先拿它对账。但正文才是事实：正文能对上、
    // 只是总结没写全时，问题在总结而不在章节，这种情况不该报「大纲偏移」（宁可少报）。
    const bodyHit = entry === undefined ? 0 : keywordHits(words, entry.text).hit
    if (entry !== undefined && bodyHit / words.length >= OUTLINE_HIT_MIN) continue
    const bodyPart = entry === undefined ? '正文无文本可对照' : `正文 ${bodyHit}/${words.length}`

    // 这段大纲内容是不是跑到别的章去了？挪章、并章是常见操作，报成「没兑现」会误导作者
    let best = null
    for (const [otherChapter, other] of summaryMap) {
      if (otherChapter === chapter) continue
      const otherRate = keywordHits(words, other.title + ' ' + other.points.join(' ') + ' ' + other.settings.join(' ')).hit / words.length
      if (best === null || otherRate > best.rate) best = { chapter: otherChapter, rate: otherRate }
    }
    const moved = best !== null && best.rate >= OUTLINE_ELSEWHERE && best.rate - rate >= OUTLINE_ELSEWHERE_GAP
    if (moved) {
      findings.push(
        finding(
          'info',
          '大纲偏移',
          chapter,
          `第 ${chapter} 章的大纲写的是「${clip(fields.join(' / '), 40)}」，但这一章只有 ${Math.round(rate * 100)}% 的关键词能对上，` +
            `而第 ${best.chapter} 章的剧情总结能对上 ${Math.round(best.rate * 100)}%：要么大纲的章号写错了，要么这段内容被挪到了第 ${best.chapter} 章。` +
            `建议核对一下章号。需人工确认——这是按字面重合度找的，不全可靠。`,
          `大纲说第 ${chapter} 章，第 ${best.chapter} 章总结最像`,
        ),
      )
      continue
    }
    findings.push(
      finding(
        'warn',
        '大纲偏移',
        chapter,
        `第 ${chapter} 章的大纲写了「${clip(fields.join(' / '), 40)}」这类内容，但这一章只有 ${Math.round(rate * 100)}% 的关键词能对上` +
          `（剧情总结 ${hit}/${words.length}、${bodyPart}）：要么这章没兑现大纲，要么大纲已经过期。` +
          `建议核对一下是哪一份没跟上。需人工确认——关键词命中率是词面统计，换了说法就不算命中。`,
        `大纲里的「${phrase}」在正文与总结里找不到`,
      ),
    )
  }
  const missingOutline = chs.map((entry) => entry.chapter).filter((chapter) => !nodeChapters.has(chapter))
  if (nodes.length > 0 && missingOutline.length > 0) {
    const shown = missingOutline.slice(0, 10)
    findings.push(
      finding(
        'info',
        '大纲缺失',
        null,
        `第 ${chapterList(shown)}${missingOutline.length > shown.length ? ' 等' : ''} 章有正文但没有大纲节点（共 ${missingOutline.length} 章）：` +
          `可能是漏补大纲，也可能是临时插进来的支线。建议回填大纲，或明确把它们标成支线。需人工确认。`,
        `有正文无大纲：第 ${chapterList(shown)} 章`,
      ),
    )
  }

  // ── 3. 伏笔超期 ──
  const foreshadow = analyzeForeshadows({ outline: nodes, chapters: chs, summaries: sums })
  for (const debt of foreshadow.details) {
    if (!debt.overdue) continue
    if (debt.reason === 'no-clue') {
      findings.push(
        finding(
          'warn',
          '伏笔超期',
          debt.declaredPayoff,
          `「${debt.name}」在第 ${debt.plantedChapter} 章埋下，大纲声明第 ${debt.declaredPayoff} 章兑现，` +
            `但那一章的剧情总结和正文里都找不到这个词：可能是兑现写丢了，也可能是大纲没跟上。建议回看第 ${debt.declaredPayoff} 章。` +
            `需人工确认——同一个东西换了叫法，也会被算成没兑现。`,
          `第 ${debt.declaredPayoff} 章找不到「${debt.name}」`,
        ),
      )
      continue
    }
    const late = debt.paidChapter !== null && debt.dueChapter !== null && debt.paidChapter > debt.dueChapter
    const tail = debt.paidChapter === null ? `到第 ${debt.lastKnown} 章（全书最后一章）还没看到兑现，已经欠了 ${debt.openChapters} 章` : `拖到第 ${debt.paidChapter} 章才兑现，比计划的第 ${debt.dueChapter} 章晚了 ${debt.paidChapter - debt.dueChapter} 章`
    findings.push(
      finding(
        'warn',
        '伏笔超期',
        debt.paidChapter === null ? debt.plantedChapter : debt.paidChapter,
        `「${debt.name}」在第 ${debt.plantedChapter} 章埋下，${tail}。` +
          (late ? '建议把兑现提前，或说明它本来就只是氛围铺垫。' : '建议：要么尽快安排兑现，要么明确它只是氛围铺垫，别让读者以为你要收。') +
          `需人工确认——名字对不上（换了叫法）也会被算成没兑现。`,
        `第 ${debt.plantedChapter} 章埋下，欠 ${debt.openChapters} 章未兑现`,
      ),
    )
  }

  // ── 4. 字数失衡 ──
  if (chapterCount >= MIN_CHAPTERS && avgChars > 0) {
    const shorts = chs.filter((entry) => entry.chars < avgChars * CHARS_LOW).sort((a, b) => a.chars - b.chars)
    const longs = chs.filter((entry) => entry.chars > avgChars * CHARS_HIGH).sort((a, b) => b.chars - a.chars)
    if (shorts.length > 0) {
      findings.push(
        finding(
          'info',
          '字数失衡',
          shorts[0].chapter,
          `第 ${chapterList(shorts.map((entry) => entry.chapter))} 章明显偏短（最短的第 ${shorts[0].chapter} 章 ${shorts[0].chars} 字，` +
            `全书平均 ${avgChars} 字，不到一半）：短章会让读者觉得赶。建议补一点具体的场面或感受。需人工确认——字数只是信号，不是标准。`,
          `第 ${shorts[0].chapter} 章 ${shorts[0].chars} 字 / 平均 ${avgChars} 字`,
        ),
      )
    }
    if (longs.length > 0) {
      findings.push(
        finding(
          'info',
          '字数失衡',
          longs[0].chapter,
          `第 ${chapterList(longs.map((entry) => entry.chapter))} 章明显偏长（最长的第 ${longs[0].chapter} 章 ${longs[0].chars} 字，` +
            `全书平均 ${avgChars} 字的 ${(longs[0].chars / avgChars).toFixed(1)} 倍）：长章中段容易疲软。建议拆章或砍掉次要段落。需人工确认。`,
          `第 ${longs[0].chapter} 章 ${longs[0].chars} 字 / 平均 ${avgChars} 字`,
        ),
      )
    }
  }

  // ── 5. 事件密度异常 ──
  if (sums.length > 0 && chs.length > 0 && avgChars > 0) {
    for (const entry of chs) {
      const summary = summaryMap.get(entry.chapter)
      if (summary === undefined || summary.points.length === 0) continue
      const points = summary.points.length
      if (points >= DENSITY_MIN_POINTS && entry.chars < avgChars * DENSITY_SHORT) {
        findings.push(
          finding(
            'info',
            '事件密度异常',
            entry.chapter,
            `第 ${entry.chapter} 章只有 ${entry.chars} 字（全书平均 ${avgChars} 字），却写了 ${points} 个剧情点：事件太密，` +
              `读者来不及体会就被推到下一件事。建议拆章，或把次要事件压成一句话带过。需人工确认。`,
            `第 ${entry.chapter} 章 ${entry.chars} 字 / ${points} 个剧情点`,
          ),
        )
      } else if (points <= DENSITY_MAX_POINTS && entry.chars > avgChars * DENSITY_LONG) {
        findings.push(
          finding(
            'info',
            '事件密度异常',
            entry.chapter,
            `第 ${entry.chapter} 章有 ${entry.chars} 字（全书平均 ${avgChars} 字），剧情点却只有 ${points} 个：内容偏稀，` +
              `有可能是注水。建议把某件事写实，或把这一章并进相邻章。需人工确认。`,
            `第 ${entry.chapter} 章 ${entry.chars} 字 / ${points} 个剧情点`,
          ),
        )
      }
    }
  }

  // ── 6. 评分下滑 ──
  const scoreList = []
  if (Array.isArray(scores)) {
    for (const item of scores) {
      if (item === null || typeof item !== 'object') continue
      const chapter = chapterOf(item.chapter)
      const score = Number(item.score)
      if (chapter === null || !Number.isFinite(score)) continue
      scoreList.push({ chapter, score, count: Number.isFinite(Number(item.count)) ? Number(item.count) : null })
    }
    scoreList.sort((a, b) => a.chapter - b.chapter)
  }
  if (scoreList.length >= MIN_CHAPTERS) {
    // 连跌：至少 2 章都在跌（也就是连着 3 章往下走）。只跌一次太正常了，不值得报警。
    let streakStart = -1
    const flushStreak = (end) => {
      if (streakStart === -1) return
      const run = scoreList.slice(streakStart, end + 1)
      const drop = run[0].score - run[run.length - 1].score
      // 跌够幅度才算数：连续几章各掉 0.01 分是噪声，读者其实没换态度
      if (run.length >= 3 && drop >= SCORE_STREAK_DROP) {
        const last = run[run.length - 1]
        findings.push(
          finding(
            'warn',
            '评分下滑',
            last.chapter,
            `第 ${chapterList(run.map((entry) => entry.chapter))} 章的读者平均分连续下降（${run.map((entry) => entry.score.toFixed(1)).join(' → ')}）：` +
              `从第 ${run[1].chapter} 章起就有读者不买账了，建议回看这 ${run.length} 章的爽点强度和信息量，对照前几章找差异。`,
            `第 ${chapterList(run.map((entry) => entry.chapter))} 章：${run.map((entry) => entry.score.toFixed(2)).join(' → ')}`,
          ),
        )
      }
      streakStart = -1
    }
    for (let i = 1; i < scoreList.length; i += 1) {
      if (scoreList[i].score < scoreList[i - 1].score) {
        if (streakStart === -1) streakStart = i - 1
      } else {
        flushStreak(i - 1)
      }
    }
    flushStreak(scoreList.length - 1)

    const mean = scoreList.reduce((sum, entry) => sum + entry.score, 0) / scoreList.length
    for (const entry of scoreList) {
      if (mean - entry.score < SCORE_DROP) continue
      const small = entry.count !== null && entry.count < SCORE_SMALL_SAMPLE
      findings.push(
        finding(
          small ? 'info' : 'warn',
          '评分下滑',
          entry.chapter,
          `第 ${entry.chapter} 章读者平均分 ${entry.score.toFixed(2)}，比全书均值 ${mean.toFixed(2)} 低 ${(mean - entry.score).toFixed(2)}：` +
            `这一章明显掉队，建议对照相邻章找差异（爽点被谁抢了、信息量是不是太少）。` +
            (small ? `需人工确认——只有 ${entry.count} 条评分，样本太少，可能是噪声。` : ''),
          `第 ${entry.chapter} 章均分 ${entry.score.toFixed(2)}，全书均值 ${mean.toFixed(2)}`,
        ),
      )
    }
  }

  const metrics = {
    chapterCount,
    totalChars,
    avgChars,
    tension: series.map((point) => ({ chapter: point.chapter, value: point.value, source: point.source })),
    arc: {
      peak: peak === null ? null : peak.chapter,
      trough: trough === null ? null : trough.chapter,
      flatRuns,
    },
    foreshadow: foreshadow.debts,
    density: [...new Set([...chs.map((entry) => entry.chapter), ...sums.map((entry) => entry.chapter)])]
      .sort((a, b) => a - b)
      .map((chapter) => {
        const entry = chapterMap.get(chapter)
        const summary = summaryMap.get(chapter)
        return {
          chapter,
          points: summary === undefined ? 0 : summary.points.length,
          chars: entry === undefined ? 0 : entry.chars,
        }
      }),
  }

  return { findings, metrics }
}
