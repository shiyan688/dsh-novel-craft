/**
 * dsh-novel-craft — 规律来源（规则 → 证据反查）
 *
 * 档案里的每条规律都是从作者标过的某些段落里压出来的。这一层把那个对应关系记下来，
 * 让作者能点开一条规律问："凭什么？"——看到的是他自己当时选中/否决的原文。
 *
 * 三条边界：
 * - 来源文件**只给人看**，永不进写稿上下文（写作包只读档案里的规律）；
 * - 模型没按要求写来源时，本地兜底做一个"词面重叠"的粗匹配，并明确标注 by:'auto'
 *   （推测）——宁可标成推测，也不要假装那是模型认定的证据；
 * - 规律文本是键：作者改了规律文字就等于换了一条规律，旧来源自然失配，不会张冠李戴。
 */
import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { clip, readJsonSafe, writeJson } from './text.js'
import { stateDirOf } from './workspace.js'

export const PROVENANCE_FILE = '规则来源.json'
/** 一条规律最多挂这么多条证据：再多就不是"规律"而是"摘抄"了。 */
export const MAX_MARKS_PER_RULE = 6

export const provenancePathOf = (projectDir) => join(stateDirOf(projectDir), PROVENANCE_FILE)

/** 规律文本 → 稳定键（前 12 位够用，也不会把档案正文带进文件名）。 */
export function ruleKey(text) {
  return createHash('sha1').update(String(text).trim()).digest('hex').slice(0, 12)
}

/** 读来源表（坏文件当空的：没有来源不该影响工作台其它功能）。 */
export async function readProvenance(projectDir) {
  const parsed = await readJsonSafe(provenancePathOf(projectDir))
  if (parsed === null || typeof parsed !== 'object' || typeof parsed.rules !== 'object' || parsed.rules === null) {
    return { updatedAt: '', rules: {} }
  }
  return { updatedAt: String(parsed.updatedAt ?? ''), rules: parsed.rules }
}

/** 查一条规律的来源。 */
export function evidenceFor(map, ruleText) {
  if (map === null || map === undefined || typeof map.rules !== 'object' || map.rules === null) return null
  const hit = map.rules[ruleKey(ruleText)]
  return hit === undefined ? null : hit
}

/** 中文取 2 字滑窗：粗但够用的"词面"单位。 */
function bigrams(text) {
  const clean = String(text).replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '')
  const out = new Set()
  for (let i = 0; i + 2 <= clean.length; i += 1) out.add(clean.slice(i, i + 2))
  return out
}

/** 兜底匹配用的停用词：这些 2 字组合到处都是，算进重合度只会骗人。 */
const STOP = new Set(['不要', '不能', '不用', '别用', '不要', '一个', '一下', '这个', '那个', '自己', '他们', '我们', '就是', '还是', '而是', '不是'])

/**
 * 本地兜底：模型没写来源时，用 2 字滑窗重合度找一个"最像"的证据。
 * 只在重合足够明显时才返回，并标 by:'auto'——作者一眼能看出这是推测。
 */
export function matchRefs(ruleText, refs, options) {
  const minScore = options !== undefined && typeof options.minScore === 'number' ? options.minScore : 0.34
  const ruleGrams = [...bigrams(ruleText)].filter((g) => !STOP.has(g))
  if (ruleGrams.length === 0 || refs.length === 0) return { marks: [], by: 'auto', score: 0 }
  const scored = refs.map((ref) => {
    const grams = bigrams(ref.text)
    let hit = 0
    for (const g of ruleGrams) if (grams.has(g)) hit += 1
    return { ref, score: hit / ruleGrams.length }
  })
  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]
  const picked = scored.filter((s) => s.score >= minScore).slice(0, 3)
  if (picked.length === 0) {
    if (best.score < 0.2) return { marks: [], by: 'auto', score: best.score }
    return { marks: [toMark(best.ref)], by: 'auto', score: best.score }
  }
  return { marks: picked.map((s) => toMark(s.ref)), by: 'auto', score: best.score }
}

const toMark = (ref) => ({
  file: String(ref.file ?? ''),
  index: Number(ref.index ?? 0),
  mark: ref.mark === 'bad' ? 'bad' : 'good',
  text: clip(ref.text ?? '', 200),
})

/**
 * 合并一批规律的来源。模型给了编号就用模型给的（by:'model'），没给就本地兜底。
 * @returns 新的来源表
 */
export function attachProvenance({ existing, items, refs, at, model }) {
  const rules = { ...(existing !== null && typeof existing === 'object' && existing.rules !== undefined ? existing.rules : {}) }
  for (const item of items) {
    const text = String(item.text ?? '').trim()
    if (text === '') continue
    const numbers = Array.isArray(item.sources) ? item.sources.filter((n) => Number.isInteger(n) && n >= 1) : []
    const fromModel = numbers
      .map((n) => refs[n - 1])
      .filter((ref) => ref !== undefined)
      .slice(0, MAX_MARKS_PER_RULE)
      .map(toMark)
    const fallback = fromModel.length === 0 ? matchRefs(text, refs) : { marks: fromModel, by: 'model', score: null }
    rules[ruleKey(text)] = {
      rule: text,
      kind: item.kind === 'bad' ? 'bad' : 'good',
      at: at === undefined ? new Date().toISOString() : at,
      model: model === undefined ? '' : String(model),
      by: fallback.by,
      score: fallback.score === undefined ? null : fallback.score,
      marks: fallback.marks,
    }
  }
  return { updatedAt: new Date().toISOString(), rules }
}

/** 落盘来源表。 */
export async function writeProvenance(projectDir, map) {
  await writeJson(provenancePathOf(projectDir), map)
  return provenancePathOf(projectDir)
}

/**
 * 来源表 → 界面上按规律文本取用的字典。
 * 界面只关心"点这条规律能看到什么"，所以这里直接摊平成 rule → { by, marks }。
 */
export function provenanceIndex(map) {
  const out = {}
  if (map === null || map === undefined || typeof map.rules !== 'object' || map.rules === null) return out
  for (const entry of Object.values(map.rules)) {
    if (entry === null || typeof entry !== 'object') continue
    out[String(entry.rule ?? '')] = {
      by: entry.by === 'model' ? 'model' : 'auto',
      at: String(entry.at ?? ''),
      model: String(entry.model ?? ''),
      // 兜底匹配给的相似度：界面据此说明"这是推测"，而不是假装它来自模型
      score: typeof entry.score === 'number' ? Math.round(entry.score * 100) / 100 : null,
      marks: Array.isArray(entry.marks) ? entry.marks : [],
    }
  }
  return out
}

/**
 * 解析「证据摘录.md」，还原出作者标过的那些段落。
 *
 * 为什么需要它：来源记录是 0.2 才有的，老档案里的规律没有编号可查。
 * 有了这个解析器，就能给老规律**补**一份"来源（推测）"——作者点开至少能看到
 * 当时标过的原文，而不是一片空白。代价是段落序号无法还原（证据摘录里没记），
 * 所以这些条目的 index 记 -1，界面据此不显示"第 N 段"。
 */
export function parseEvidenceDoc(text) {
  const out = []
  let file = ''
  let mark = 'good'
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\s+$/, '').trim()
    if (line === '') continue
    if (line.startsWith('## ')) {
      file = line.slice(3).trim()
      mark = 'good'
      continue
    }
    if (line.startsWith('### ')) {
      mark = /否决|别再用|不喜欢|避免/.test(line) ? 'bad' : 'good'
      continue
    }
    const quote = /^>\s?(.*)$/.exec(line)
    if (quote === null || file === '') continue
    const body = quote[1].trim()
    if (body === '' || /^⚠️|^这里存的是|^写稿会话/.test(body)) continue
    out.push({ file, index: -1, mark, text: clip(body, 200) })
  }
  return out
}

/** 从档案正文里取规律条目（两个小节下的 `- xxx`）。 */
export function rulesFromProfile(text) {
  const out = []
  let kind = null
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (/^##\s/.test(line)) {
      if (/避免|不喜欢|不要做/.test(line)) kind = 'bad'
      else if (/喜欢|偏好|要学/.test(line)) kind = 'good'
      else kind = null
      continue
    }
    if (kind === null) continue
    const item = /^[-*]\s+(.*)$/.exec(line.trim())
    if (item === null) continue
    const body = item[1].replace(/[`*]/g, '').trim()
    if (body.length < 4) continue
    out.push({ kind, text: body, sources: [] })
  }
  return out
}

/**
 * 给还没有来源记录的规律补一份（本地匹配，一律标 by:'auto'）。
 * @returns { map, added, skipped }
 */
export function backfillProvenance({ existing, rules, refs, at }) {
  const base = existing !== null && typeof existing === 'object' && existing.rules !== undefined ? existing.rules : {}
  const rulesMap = { ...base }
  let added = 0
  let skipped = 0
  for (const rule of rules) {
    const text = String(rule.text ?? '').trim()
    if (text === '') continue
    const key = ruleKey(text)
    const hit = rulesMap[key]
    if (hit !== undefined && Array.isArray(hit.marks) && hit.marks.length > 0) {
      skipped += 1
      continue
    }
    const matched = matchRefs(text, refs)
    if (matched.marks.length === 0) {
      skipped += 1
      continue
    }
    rulesMap[key] = {
      rule: text,
      kind: rule.kind === 'bad' ? 'bad' : 'good',
      at: at === undefined ? new Date().toISOString() : at,
      model: '',
      by: 'auto',
      score: matched.score,
      backfilled: true,
      marks: matched.marks,
    }
    added += 1
  }
  return { map: { updatedAt: new Date().toISOString(), rules: rulesMap }, added, skipped }
}

// ── 补齐来源的模型通道 ───────────────────────────────────────────────────
//
// 本地 2 字滑窗对不上"规律"这种抽象语言（规律本来就是从原文里抽出来的，
// 词面早就不重合了）。所以补齐来源走一次很便宜的模型调用：把编号后的原文与规律
// 一起给它，只让它做一件事——指出每条规律对应哪几段。答案对不对，作者点开就能核。

export function backfillSystemPrompt() {
  return [
    '你在帮一位中文网文作者整理"写作规律 → 证据"的对应关系。',
    '',
    '下面会给你两组东西：编号的原文段落（作者当初标了好/坏），编号的写作规律（从这些段落里总结出来的）。',
    '你的任务是判断每条规律主要是从哪几段原文里看出来的。',
    '',
    '要求：',
    '1. 只输出对应关系，一行一条，格式严格是：R1: 3、7',
    '2. 没有把握的写：R1: -（宁缺勿滥，不要硬凑）。',
    '3. 一条规律最多给 4 个编号；编号必须存在于原文列表里。',
    '4. 不要输出任何别的内容：不要解释、不要总结、不要抄原文。',
  ].join('\n')
}

/** 拼出补齐来源的输入：先原文（编号），后规律（R 编号）。 */
export function buildBackfillInput({ rules, refs }) {
  const lines = ['【原文段落】', '']
  refs.forEach((ref, i) => {
    lines.push(`${i + 1}. [${ref.mark === 'bad' ? '坏' : '好'}] ${ref.file}：${clip(ref.text, 160)}`)
  })
  lines.push('', '【写作规律】', '')
  rules.forEach((rule, i) => {
    lines.push(`R${i + 1}. [${rule.kind === 'bad' ? '避免' : '喜欢'}] ${rule.text}`)
  })
  lines.push('', '请按格式输出每条规律对应的原文编号。')
  return { text: lines.join('\n'), ruleCount: rules.length, refCount: refs.length }
}

/** 解析 `R1: 3、7` / `R1：-` 这类输出。 */
export function parseBackfillOutput(text) {
  const out = {}
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\s+$/, '').trim()
    const matched = /^R\s*(\d{1,3})\s*[:：]\s*(.*)$/i.exec(line)
    if (matched === null) continue
    const index = Number(matched[1])
    const body = matched[2].trim()
    if (body === '' || body === '-' || body === '—' || body === '无') {
      out[index] = []
      continue
    }
    out[index] = body
      .split(/[,，、\s]+/)
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isInteger(n) && n >= 1)
      .slice(0, 4)
  }
  return out
}

/**
 * 用模型的对应关系补来源。
 * @returns { map, added, skipped, unmatched }
 */
export function attachBackfill({ existing, rules, refs, mapping, at, model }) {
  const base = existing !== null && typeof existing === 'object' && existing.rules !== undefined ? existing.rules : {}
  const rulesMap = { ...base }
  let added = 0
  let skipped = 0
  let unmatched = 0
  rules.forEach((rule, i) => {
    const text = String(rule.text ?? '').trim()
    if (text === '') return
    const key = ruleKey(text)
    const hit = rulesMap[key]
    if (hit !== undefined && Array.isArray(hit.marks) && hit.marks.length > 0) {
      skipped += 1
      return
    }
    const numbers = Array.isArray(mapping[i + 1]) ? mapping[i + 1] : []
    const marks = numbers
      .map((n) => refs[n - 1])
      .filter((ref) => ref !== undefined)
      .slice(0, MAX_MARKS_PER_RULE)
      .map(toMark)
    if (marks.length === 0) {
      unmatched += 1
      const local = matchRefs(text, refs)
      if (local.marks.length === 0) return
      rulesMap[key] = {
        rule: text,
        kind: rule.kind === 'bad' ? 'bad' : 'good',
        at: at === undefined ? new Date().toISOString() : at,
        model: '',
        by: 'auto',
        score: local.score,
        backfilled: true,
        marks: local.marks,
      }
      added += 1
      return
    }
    rulesMap[key] = {
      rule: text,
      kind: rule.kind === 'bad' ? 'bad' : 'good',
      at: at === undefined ? new Date().toISOString() : at,
      model: model === undefined ? '' : String(model),
      by: 'model',
      score: null,
      backfilled: true,
      marks,
    }
    added += 1
  })
  return { map: { updatedAt: new Date().toISOString(), rules: rulesMap }, added, skipped, unmatched }
}
