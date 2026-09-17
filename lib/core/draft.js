/**
 * dsh-novel-craft — 开新章：从"这一章要写什么"到"一批结构不同的候选稿"
 *
 * 这是抽卡工作台缺的那一环：抽卡解决"哪一段好"，但候选稿从哪来、选完之后怎么合起来，
 * 以前靠作者自己在会话里手工跑。这个模块把它补齐，并且**照抄作者真实的工作方法**
 * （见《逐弈登仙》第8章/筛选与合并记录.md）：
 *
 *   十个"场景决策"方向 → 每个方向写一篇候选（追求结构不同，不是换词）
 *   → 作者标好/坏（并写一句取用原因）→ 合并成定稿候选（取用段落表自动生成）
 *   → 写入正文 → 剩下的交给批注式微调做外科手术
 *
 * 三条边界：
 * - 写候选稿的输入只有**写作包**（里面已经是规律 + 前情 + 台账 + 情节节点，没有原文全文）；
 * - 方向与候选都是一次一篇地生成，作者随时能停、能重来某一篇；
 * - 合并是**确定性的**：只按作者选定的段落拼，缺口明写成标记，绝不偷偷让模型补写。
 */
import { clip } from './text.js'

/** 默认给多少个方向：作者第 8 章用的就是十个。 */
export const DEFAULT_DIRECTION_COUNT = 10
/** 方向数量的边界：少于三个就没得挑，多于十六个作者读不完。 */
export const MIN_DIRECTIONS = 3
export const MAX_DIRECTIONS = 16

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** 序号 → A/B/C…（超过 26 个就 AA、AB，虽然基本用不到）。 */
export function letterOf(index) {
  const n = Number(index)
  if (!Number.isInteger(n) || n < 0) return '?'
  return n < 26 ? LETTERS[n] : LETTERS[Math.floor(n / 26) - 1] + LETTERS[n % 26]
}

/** 文件名里不能出现的字符，以及会干扰排序的空格。 */
export function safeName(text, fallback) {
  const clean = String(text === undefined || text === null ? '' : text)
    .replace(/[\\/:*?"<>|\n\r\t]/g, '')
    .replace(/\s+/g, '')
    .replace(/^[.．]+/, '')
    .trim()
  const out = clean === '' ? fallback : clean
  return out.slice(0, 24)
}

/** 候选稿文件名：`第13章-A-保守精修.txt`（与作者既有命名一致）。 */
export function candidateFileName({ chapter, index, name }) {
  return `第${chapter}章-${letterOf(index)}-${safeName(name, '方向' + letterOf(index))}.txt`
}

// ── 方向：一次便宜的调用，产出"这一篇试什么" ────────────────────────────

export function directionsSystemPrompt() {
  return [
    '你是中文网文的老责编，正在帮作者准备一章的多版候选稿。',
    '',
    '你这一步**不写正文**，只给"写法方向"：每个方向都要改变一个**叙事决策**，',
    '而不是换词、换形容、换句式。同一组核心事实下，变化的是：视角归属、开场方式、',
    '信息差放在谁身上、对手戏怎么摆、节奏与留白、卡片/面板化程度、场景数量、收束方式、',
    '喜剧感或冷硬感的来源、生活流细节的密度……',
    '',
    '严格按下面的格式输出，一行一个方向，不要任何别的内容（不要开场白、不要总结、不要代码围栏）：',
    '',
    '- A 保守精修：以最小改动保留现有骨架，只在细节处收紧',
    '- B 配角识货：让同行配角先认出货色，主角的算计藏在他的沉默里',
    '',
    '每个方向的要求：',
    '1. 名称不超过 6 个字（它会进文件名），冒号后一句话说清"这一篇试什么"以及"为什么值得试"。',
    '2. 方向之间必须互斥：任意两个方向不能只是程度不同，要换掉某个具体决策。',
    '3. 至少有一个方向是"保守精修"（给作者一个基准版），其余都要有明确取舍。',
    '4. 不要评价、不要写"这样可以提升阅读体验"这类空话，只写做法。',
  ].join('\n')
}

/**
 * 方向生成的输入：写作包（唯一的口味与前情来源）+ 作者本轮的额外要求。
 */
export function buildDirectionsPrompt({ pack, extra, count, chapter }) {
  const n = Number.isInteger(count) ? Math.min(MAX_DIRECTIONS, Math.max(MIN_DIRECTIONS, count)) : DEFAULT_DIRECTION_COUNT
  const lines = [
    `【作品与本章】`,
    '',
    String(pack === undefined || pack === null ? '' : pack).trim(),
    '',
    '【这一步的任务】',
    '',
    `请给第${chapter}章 ${n} 个"场景决策"方向（编号从 A 开始，按上面的格式）。`,
  ]
  const liked = []
  let inside = false
  for (const raw of String(pack === undefined || pack === null ? '' : pack).split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (/^#{1,6}\s/.test(line)) {
      inside = /已验证偏好|喜欢什么|要学/.test(line)
      continue
    }
    if (!inside) continue
    const item = /^[-*]\s+(.*)$/.exec(line.trim())
    if (item !== null && item[1].trim().length >= 4) liked.push(item[1].replace(/[`*]/g, '').trim())
  }
  if (liked.length > 0) {
    lines.push(
      '',
      '【注意】方向要落在作者**已经验证过喜欢**的那一类写法附近（偏好档案里的"已验证偏好"），',
      '而不是他已经否决过的那一类。换句话说：这些方向是"同一个作者会写出的不同选择"，不是"不同作者的选择"。',
    )
  }
  if (typeof extra === 'string' && extra.trim() !== '') {
    lines.push('', '【作者本轮的额外要求】', '', extra.trim())
  }
  return { text: lines.join('\n'), count: n, liked: liked.length }
}

/**
 * 解析方向清单。作者用的模型五花八门，这里尽量宽容：
 *   `- A 保守精修：…` / `A、保守精修：…` / `**A 保守精修**：…` / `1. 保守精修：…`
 */
export function parseDirections(text) {
  const out = []
  for (const raw of String(text === undefined || text === null ? '' : text).split('\n')) {
    const line = raw.replace(/\s+$/, '').trim()
    if (line === '' || /^```/.test(line)) continue
    // 去掉列表符号与加粗
    const body = line.replace(/^[-*•·＋+]\s*/, '').replace(/^\d{1,2}\s*[.、)]\s*/, '').replace(/[*`]/g, '')
    // 名称：字母开头，或「名称：」直接开头
    const matched = /^(?:([A-Za-z]{1,2})[\s.、:：)\]]+)?\s*([^：:]{1,12})\s*[：:]\s*(.+)$/.exec(body)
    if (matched === null) continue
    const name = matched[2].trim()
    const detail = matched[3].trim()
    if (name === '' || detail.length < 4) continue
    out.push({
      index: out.length,
      letter: matched[1] === undefined || matched[1] === '' ? letterOf(out.length) : matched[1].toUpperCase(),
      name: safeName(name, '方向' + letterOf(out.length)),
      detail: clip(detail, 120),
    })
    if (out.length >= MAX_DIRECTIONS) break
  }
  const seen = new Set()
  return out.filter((item) => {
    const key = item.name
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * 从写作包里抽出「避免的写法」条目。
 *
 * 为什么要单独抽：写作包有三四千字，规律在小两百字的位置——放在中间，模型读完后面的
 * 前情、台账、情节节点之后容易"忘了前头"。所以拼提示词时把它**再在末尾提醒一遍**：
 * 这几条是作者明确否决过的写法，代价只有两三百字，收益是它不会飘。
 */
export function vetoListOf(packText) {
  const out = []
  let inside = false
  for (const raw of String(packText === undefined || packText === null ? '' : packText).split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (/^#{1,6}\s/.test(line)) {
      // 进「避免的写法」小节；遇到下一个小节就出来
      inside = /避免的写法|不喜欢什么|不要做/.test(line)
      continue
    }
    if (!inside) continue
    const item = /^[-*]\s+(.*)$/.exec(line.trim())
    if (item === null) continue
    const body = item[1].replace(/[`*]/g, '').trim()
    if (body.length < 4) continue
    out.push(body)
  }
  return out
}

// ── 候选稿：一次一篇 ────────────────────────────────────────────────────

export function draftSystemPrompt() {
  return [
    '你是中文网文写手，正在为某一章写**多版候选稿中的一篇**。',
    '',
    '铁律：',
    '1. 只输出这一章的正文本身：首行是章节标题（形如 `第13章 标题`），下面是正文段落，段落之间空一行。',
    '2. 不要写任何解释、评语、写作说明、markdown 代码围栏、小标题。',
    '3. **整篇只贯彻分配给这一篇的那一个写法方向**，不要混入别的方向；这一篇与同章其它候选稿的差别是结构性的。',
    '4. 写作包第 ② 节就是**作者偏好档案**（只有规律）："已验证偏好"是他验证过喜欢的手法，',
    '   "避免的写法"是他明确否决过的——那条清单里的写法一条都不要出现。',
    '   除此之外还要遵守第 ⑨ 节的禁 AI 腔清单（不要万能过渡、不要情绪直给、不要解释动机、不要堆比喻）。',
    '5. 字数按写作包里的要求；宁可写够，不要草草收尾。',
    '6. 写作包里**没有**的东西不要自己发明：不新增设定、道具、人物、地名。',
    '6b. 不要把面板、账目、抽卡结果逐项复述；只写与当前场景相关的一两件。',
  ].join('\n')
}

/** 这一篇的输入：写作包 + 本篇方向 + 同章其它方向（用来确保不撞车）。 */
export function buildDraftPrompt({ pack, direction, others, chapter }) {
  const lines = [
    String(pack === undefined || pack === null ? '' : pack).trim(),
    '',
    '【本篇的写法方向】',
    '',
    `${direction.letter} ${direction.name}：${direction.detail}`,
  ]
  const list = Array.isArray(others) ? others : []
  if (list.length > 0) {
    lines.push(
      '',
      '【同章其它候选稿的方向（本篇要与它们错开，不要写重）】',
      '',
      ...list.map((item) => `- ${item.letter} ${item.name}：${item.detail}`),
    )
  }
  const veto = vetoListOf(pack)
  if (veto.length > 0) {
    lines.push(
      '',
      '【写之前最后过一眼：作者明确否决过的写法】',
      '',
      ...veto.map((rule) => '- ' + rule),
      '',
      '这几条是硬约束：写的时候不要出现，写完自己再看一遍有没有漏。',
    )
  }
  lines.push('', `请写出第${chapter}章这一篇的完整正文。`)
  return { text: lines.join('\n'), veto }
}

/** 生成的正文做一次轻整理：去掉代码围栏、去掉模型爱加的开场白。 */
export function cleanDraftText(text) {
  const raw = String(text === undefined || text === null ? '' : text).replace(/\r\n/g, '\n')
  const lines = raw.split('\n')
  const out = []
  let inFence = false
  let started = false
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (!started) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      // 模型常见的开场白：直接丢掉，直到第一行像标题/正文
      if (/^(好的|以下是|这是|下面|已按|根据)/.test(trimmed) && trimmed.length < 40) continue
      started = true
    }
    out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ── 合并：只按作者选的段落拼，缺口明写 ──────────────────────────────────

/** 取用段落表里"来源"那列写什么：文件名去掉扩展名，够短就行。 */
export function sourceLabel(file) {
  return String(file === undefined || file === null ? '' : file).replace(/\.[^.]+$/, '')
}

/**
 * 把作者选定的段落拼成一篇合并稿。
 *
 * 为什么缺口要明写成标记：候选稿是同一章的不同写法，跨篇取段之间往往接不上。
 * 让模型"顺手补一句过渡"就等于把原文交给它改写——这个插件不做这种事。
 * 标记落在稿子里，作者在批注式微调里一处一处处理。
 */
export function mergeSelection({ picks, marker }) {
  const list = (Array.isArray(picks) ? picks : []).filter((p) => p !== null && typeof p === 'object' && typeof p.text === 'string' && p.text.trim() !== '')
  const gap = typeof marker === 'string' && marker !== '' ? marker : '〔此处需过渡：上一段与下一段来自不同候选稿〕'
  const out = []
  const rows = []
  let gaps = 0
  list.forEach((pick, i) => {
    const previous = list[i - 1]
    if (previous !== undefined && sourceLabel(previous.file) !== sourceLabel(pick.file)) {
      out.push(gap)
      gaps += 1
    }
    out.push(pick.text.trim())
    rows.push({
      file: String(pick.file ?? ''),
      index: Number(pick.index ?? -1),
      source: sourceLabel(pick.file),
      reason: typeof pick.reason === 'string' ? pick.reason : '',
      preview: clip(pick.text, 40),
      chars: pick.text.replace(/\s/g, '').length,
    })
  })
  return { text: out.join('\n\n'), rows, gaps, picked: list.length }
}

/** 合并记录文档：照作者《第8章 筛选与合并记录.md》的样子写。 */
export function buildMergeDoc({ chapter, versionName, rows, gaps, chars, at, note }) {
  const lines = [
    `# 第${chapter}章 ${versionName === undefined || versionName === '' ? '合并稿' : versionName} 取用记录`,
    '',
    `> 由 dsh-novel-craft 工作台生成 · ${at === undefined ? new Date().toISOString() : at}`,
    `> 合并方式：只拼接作者在抽卡页选中的段落，跨稿衔接处写成 〔此处需过渡〕标记（共 ${gaps} 处），`,
    '> 不自动补写、不改写任何选中的段落。',
    '',
    '## 取用段落',
    '',
    '| 来源 | 取用内容 | 取用原因 | 字数 |',
    '|---|---|---|---:|',
  ]
  if (rows.length === 0) lines.push('| — | （还没有选中的段落） | — | 0 |')
  for (const row of rows) {
    lines.push(`| ${row.source} | ${row.preview.replace(/\|/g, '／')} | ${(row.reason === '' ? '—' : row.reason).replace(/\|/g, '／')} | ${row.chars} |`)
  }
  lines.push('', `本篇合计 ${chars} 字（不含标记）。`)
  if (typeof note === 'string' && note.trim() !== '') lines.push('', '## 本轮备注', '', note.trim())
  lines.push('')
  return lines.join('\n')
}

/**
 * 定稿写入前的整理：保证首行是 `第N章 标题`，段落之间恰好一个空行。
 * 作者要的是能直接替换正文的文件，不是"看起来差不多"。
 */
/** 标题里不能出现的东西：换行会让首行标题变成两行，斜杠/控制符则纯属脏数据。 */
export function cleanChapterTitle(title) {
  return String(title === undefined || title === null ? '' : title)
    .replace(/[\r\n\t\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
}

export function normalizeChapterText(text, { chapter, title }) {
  const body = String(text === undefined || text === null ? '' : text).replace(/\r\n/g, '\n').trim()
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
  const headingRe = /^第\s*[\d〇零一二三四五六七八九十一二百千两]+\s*章/
  // 首段如果本来就是标题行，把它取下来当副标题用——不能只是丢掉：
  // 丢掉的话「第2章 拜师青云」会被压成光秃秃的「第2章」（发布前测试抓到的回归）。
  let fromFirst = ''
  if (paragraphs.length > 0 && headingRe.test(paragraphs[0]) && paragraphs[0].length <= 40) {
    fromFirst = cleanChapterTitle(paragraphs[0].replace(headingRe, ''))
    paragraphs.shift()
  }
  const explicit = cleanChapterTitle(title).replace(headingRe, '')
  const finalTitle = explicit !== '' ? explicit : fromFirst
  const heading = `第${chapter}章${finalTitle === '' ? '' : ' ' + finalTitle}`
  if (paragraphs.length === 0) return heading + '\n'
  return [heading, '', ...paragraphs.flatMap((p) => [p, ''])].join('\n').replace(/\n+$/, '\n')
}
