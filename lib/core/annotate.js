/**
 * dsh-novel-craft — 批注式微调（annotate）
 *
 * 作者在正文里读到哪儿不对，就地留一句批注；工作台把**只有被批注的段落**交给模型改写，
 * 其余段落逐字不动。这条约束是硬性的，分两道防线：
 *
 * 1. `applyRevision` 用"原文段落 + 改写表"重新拼装，模型没有机会碰到别的段落；
 * 2. `verifyRevision` 再逐段比对一次，未批注段落只要有一个字不同就报错——不信任拼装逻辑。
 *
 * 批注是**给人看的改稿清单**：它绝不进写稿上下文（写作包里只报条数），
 * 只有作者点「微调」时，被批注的那几段才进一次模型调用。
 */
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { charCount, clip, readJsonSafe, splitSegments, updateJsonFile } from './text.js'
import { annotationPathOf } from './workspace.js'

/** 批注类型：作者点标签比打字快，标签也便于以后统计"我老在哪儿翻车"。 */
export const ANNOTATION_TYPES = [
  { id: 'ai-tone', label: 'AI 腔', hint: '套话、万能过渡、句式模板' },
  { id: 'wordy', label: '啰嗦', hint: '信息重复、注水、可以砍一半' },
  { id: 'emotion', label: '情绪直给', hint: '直接贴情绪标签，没有动作支撑' },
  { id: 'flat', label: '平', hint: '该有张力的地方没绷住' },
  { id: 'ooc', label: '人物失真', hint: '口吻/境界/身份不对' },
  { id: 'logic', label: '逻辑账目', hint: '设定冲突、数值对不上、因果断了' },
  { id: 'info', label: '信息差', hint: '该隐瞒的说了、该给读者的没给' },
  { id: 'other', label: '其他', hint: '自由发挥' },
]

const TYPE_IDS = new Set(ANNOTATION_TYPES.map((t) => t.id))

/** 送进微调的每一段最多带这么多字。单换行排版的 txt 整章可能只有一段，
 *  不裁剪的话 50 万字整段进提示词，"只改被批注段落"就退化成"整章重写"。 */
export const MAX_SEGMENT_CHARS = 800

/** 一条批注最多放这么多字：批注是提示，不是重写全文。 */
export const MAX_NOTE = 300
/** 一次微调最多带这么多条批注（多了模型顾不过来，也烧钱）。 */
export const MAX_REVISE_ITEMS = 20

const normalizeType = (type) => (TYPE_IDS.has(String(type)) ? String(type) : 'other')

/** 生成稳定 id：同一段同一类型只留一条，重复添加就是更新。 */
const idOf = (seg, type) => `s${seg}-${type}`

/** 读一章的批注（坏文件当没有，不让作者因为一个坏 JSON 打不开工作台）。 */
export async function readAnnotations(projectDir, chapter) {
  const parsed = await readJsonSafe(annotationPathOf(projectDir, chapter))
  const list = parsed !== null && Array.isArray(parsed.items) ? parsed.items : []
  return list
    .filter((a) => a !== null && typeof a === 'object' && Number.isInteger(a.seg))
    .map((a) => ({
      id: typeof a.id === 'string' && a.id !== '' ? a.id : idOf(a.seg, a.type),
      chapter: Number(chapter),
      seg: a.seg,
      quote: typeof a.quote === 'string' ? a.quote : '',
      type: normalizeType(a.type),
      note: typeof a.note === 'string' ? a.note : '',
      status: a.status === 'resolved' || a.status === 'ignored' ? a.status : 'open',
      createdAt: typeof a.createdAt === 'string' ? a.createdAt : '',
      resolvedAt: typeof a.resolvedAt === 'string' ? a.resolvedAt : '',
      revision: typeof a.revision === 'number' ? a.revision : 0,
    }))
}

async function writeList(projectDir, chapter, list) {
  const path = annotationPathOf(projectDir, chapter)
  await mkdir(dirname(path), { recursive: true })
  const payload = { chapter: Number(chapter), updatedAt: new Date().toISOString(), items: list }
  await writeFile(path, JSON.stringify(payload, null, 2), 'utf8')
  return { path, list }
}

/**
 * 批注的增/改/删都是"读-改-写"，必须整段进队列 + 原子落盘：
 * 一边在正文里连点留批注、一边在右侧面板点「改好了」，两个请求会互相覆盖。
 */
const mutateList = (projectDir, chapter, mutator) => {
  const path = annotationPathOf(projectDir, chapter)
  return updateJsonFile(
    path,
    (doc) => {
      const items = Array.isArray(doc.items) ? doc.items : []
      const next = mutator(items)
      if (next === undefined) return undefined
      if (next.length === 0) {
        // 删空就把文件清掉，不留空壳（与 removeAnnotation 的行为一致）
        return { chapter: Number(chapter), updatedAt: new Date().toISOString(), items: [] }
      }
      return { chapter: Number(chapter), updatedAt: new Date().toISOString(), items: next }
    },
    { fallback: { items: [] } },
  ).then(() => ({ path }))
}

/**
 * 加/改一条批注。同一段同一类型重复提交视为更新批注文字（作者改主意的常见情形），
 * 而不是堆两条。
 */
export async function addAnnotation(projectDir, chapter, input) {
  const seg = Number(input.seg)
  if (!Number.isInteger(seg) || seg < 0) throw new Error('批注必须指定段落序号')
  const type = normalizeType(input.type)
  const note = String(input.note === undefined ? '' : input.note).slice(0, MAX_NOTE)
  const id = idOf(seg, type)
  const at = new Date().toISOString()
  let added = false
  await mutateList(projectDir, chapter, (items) => {
    const existing = items.find((a) => a.id === id)
    if (existing === undefined) {
      added = true
      items.push({
        id,
        chapter: Number(chapter),
        seg,
        quote: clip(input.quote === undefined ? '' : input.quote, 60),
        type,
        note,
        status: 'open',
        createdAt: at,
        resolvedAt: '',
        revision: 0,
      })
    } else {
      existing.note = note
      if (typeof input.quote === 'string' && input.quote !== '') existing.quote = clip(input.quote, 60)
      existing.status = 'open'
      existing.resolvedAt = ''
    }
    items.sort((a, b) => a.seg - b.seg)
    return items
  })
  return { added, list: await readAnnotations(projectDir, chapter), path: annotationPathOf(projectDir, chapter) }
}

/** 改状态（解决 / 忽略 / 重新打开）或改批注文字。 */
export async function updateAnnotation(projectDir, chapter, id, patch) {
  let found = false
  await mutateList(projectDir, chapter, (items) => {
    const target = items.find((a) => a.id === id)
    if (target === undefined) return undefined
    found = true
    if (patch.status === 'open' || patch.status === 'resolved' || patch.status === 'ignored') {
      target.status = patch.status
      target.resolvedAt = patch.status === 'open' ? '' : new Date().toISOString()
    }
    if (typeof patch.note === 'string') target.note = patch.note.slice(0, MAX_NOTE)
    if (patch.type !== undefined) target.type = normalizeType(patch.type)
    return items
  })
  if (!found) throw new Error('没有这条批注：' + String(id))
  return { list: await readAnnotations(projectDir, chapter), path: annotationPathOf(projectDir, chapter) }
}

/** 删除一条批注。整章批注删空时把文件也清掉，不留空壳。 */
export async function removeAnnotation(projectDir, chapter, id) {
  const written = await mutateList(projectDir, chapter, (items) => items.filter((a) => a.id !== id))
  const list = await readAnnotations(projectDir, chapter)
  if (list.length === 0) await unlink(annotationPathOf(projectDir, chapter)).catch(() => {})
  return { list, path: written.path }
}

/** 汇总全书的批注（作品看板只显示条数）。 */
export async function annotationStats(projectDir, chapters) {
  const out = []
  for (const chapter of chapters) {
    const list = await readAnnotations(projectDir, chapter)
    out.push(...list)
  }
  return {
    total: out.length,
    open: out.filter((a) => a.status === 'open').length,
    resolved: out.filter((a) => a.status === 'resolved').length,
    ignored: out.filter((a) => a.status === 'ignored').length,
    byType: out.reduce((acc, a) => {
      acc[a.type] = (acc[a.type] === undefined ? 0 : acc[a.type]) + 1
      return acc
    }, {}),
  }
}

/** 一次微调的输入：编号 + 批注 + 上下文 + 作者口味规律（只有规律）。 */
export function buildRevisionInput({ segments, annotations, profile = '', maxItems }) {
  const limit = maxItems === undefined ? MAX_REVISE_ITEMS : maxItems
  const open = annotations.filter((a) => a.status === 'open' && segments[a.seg] !== undefined)
  const picked = open.slice(0, limit)
  const lines = []
  let used = 0
  for (const a of picked) {
    // 邻段只取**头部** 80 字：原来标签写的是"上一段结尾"，取的却是开头——
    // 现在标签改成"上一段开头"，与实现一致（审查发现的措辞 bug）。
    const before = segments[a.seg - 1] === undefined ? '' : clip(segments[a.seg - 1], 80)
    const after = segments[a.seg + 1] === undefined ? '' : clip(segments[a.seg + 1], 80)
    const label = ANNOTATION_TYPES.find((t) => t.id === a.type)
    lines.push(
      `[${a.seg}] 批注类型：${label === undefined ? '其他' : label.label}` +
        (a.note === '' ? '' : `；批注：${a.note}`) +
        (before === '' ? '' : `\n（上一段开头：…${before}）`) +
        (after === '' ? '' : `\n（下一段开头：${after}…）`) +
        `\n原文：${clip(segments[a.seg], MAX_SEGMENT_CHARS)}`,
    )
    used += 1
  }
  return {
    text: lines.join('\n\n'),
    indexes: picked.map((a) => a.seg),
    used,
    total: open.length,
    profile: clip(profile, 3000),
  }
}

/**
 * 解析模型的改写输出。作者用的模型五花八门，这里尽量宽容：
 *   `[3] 新文本` / `【3】新文本` / `3. 新文本` / `第3段：新文本`
 * 后跟若干续行都算这一段的内容（直到下一个编号出现）。
 */
export function parseRevisionOutput(text) {
  const out = {}
  let current = null
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (/^\s*```/.test(line)) continue
    const marker = /^\s*(?:[[【(（]\s*(?:第)?\s*(\d{1,4})\s*[\]】)）]|第\s*(\d{1,4})\s*段\s*[.、:：]?|(\d{1,4})\s*[.、:：])\s*(.*)$/.exec(line)
    if (marker !== null) {
      const raw1 = marker[1] === undefined ? (marker[2] === undefined ? marker[3] : marker[2]) : marker[1]
      current = Number(raw1)
      // 「第7段：正文」与「[7] 正文」都要能拿到正文本身，别把分隔符带进去
      out[current] = marker[4].replace(/^[.、:：]\s*/, '').trim()
      continue
    }
    if (current !== null && line.trim() !== '') out[current] = (out[current] + '\n' + line.trim()).trim()
  }
  const clean = {}
  for (const [key, value] of Object.entries(out)) {
    const body = String(value).replace(/^["'“”]+|["'“”]+$/g, '').trim()
    if (body !== '') clean[Number(key)] = body
  }
  return clean
}

/**
 * 按"原文段落 + 改写表"重新拼装：只有批注过的段落会被替换。
 * 这是第一道防线——模型拿不到改写其他段落的能力。
 */
export function applyRevision(originalText, revised, annotated) {
  const segments = splitSegments(originalText)
  const allowed = new Set(annotated.map((x) => Number(x)))
  const out = segments.map((segment, index) => {
    if (!allowed.has(index)) return segment
    const next = revised[index]
    return typeof next === 'string' && next.trim() !== '' ? next.trim() : segment
  })
  return out.join('\n\n')
}

/**
 * 第二道防线：逐段核对。分成两档，界线是"作者有没有授权"：
 *
 * - **error（拦住写回）**：没批注的段落被改动了、段落数变了。这属于"模型越权"，
 *   绝对不能落到作者的正文里。
 * - **warn（只提示）**：批注过的段落字数变化过大。作者本来就可能在批注里写
 *   "这段砍一半"，所以这是作者自己的判断，不该由工作台替他拒绝——把前后对照摆出来，让他决定。
 */
export function verifyRevision({ originalText, revisedText, annotated }) {
  const before = splitSegments(originalText)
  const after = splitSegments(revisedText)
  const allowed = new Set(annotated.map((x) => Number(x)))
  const errors = []
  const warnings = []
  const changed = []
  if (before.length !== after.length) {
    errors.push(`段落数变了（${before.length} → ${after.length}）：微调只允许替换段落内容，不允许增删段落。`)
  }
  const n = Math.min(before.length, after.length)
  for (let i = 0; i < n; i += 1) {
    const same = before[i] === after[i]
    if (!allowed.has(i)) {
      if (!same) errors.push(`第 ${i} 段没有批注却被改动了。`)
      continue
    }
    if (same) continue
    changed.push(i)
    const sizeBefore = charCount(before[i])
    const sizeAfter = charCount(after[i])
    if (sizeAfter === 0) {
      warnings.push(`第 ${i} 段被改成了空段（已按原文保留）。`)
      continue
    }
    if (sizeBefore > 0 && (sizeAfter < sizeBefore * 0.4 || sizeAfter > sizeBefore * 2.5)) {
      warnings.push(`第 ${i} 段字数变化较大（${sizeBefore} → ${sizeAfter} 字）：如果批注里没要求增删这么多，建议手动改回来。`)
    }
  }
  return { ok: errors.length === 0, errors, warnings, problems: errors, changed, annotatedCount: allowed.size }
}

/** 把改写表落成对作者友好的"前后对照"清单（界面用，不含全文）。 */
export function revisionDiff({ originalText, revisedText, annotations }) {
  const before = splitSegments(originalText)
  const after = splitSegments(revisedText)
  const byId = new Map(annotations.map((a) => [a.seg, a]))
  const changed = []
  const n = Math.max(before.length, after.length)
  for (let i = 0; i < n; i += 1) {
    if (before[i] === after[i]) continue
    const a = byId.get(i)
    changed.push({
      seg: i,
      before: before[i] === undefined ? '' : before[i],
      after: after[i] === undefined ? '' : after[i],
      charsBefore: before[i] === undefined ? 0 : charCount(before[i]),
      charsAfter: after[i] === undefined ? 0 : charCount(after[i]),
      type: a === undefined ? 'other' : a.type,
      note: a === undefined ? '' : a.note,
    })
  }
  return changed
}

/** 微调稿文档：给人看、可回查，不进上下文。 */
export function buildRevisionDoc({ chapter, diff, model, at, problems, warnings }) {
  const lines = [
    `# 第${chapter}章 微调稿`,
    '',
    '> 只改被批注的段落，其余段落逐字未动（已逐段核对）。',
    `> 模型：${model === undefined || model === '' ? '—' : model} · 时间：${at}`,
    '> 采纳之前请自己读一遍：模型改对了才写回正文，写回时原稿会自动备份。',
    '',
  ]
  if (problems !== undefined && problems.length > 0) {
    lines.push('## 核对发现的问题（这些会拦住写回）', '', ...problems.map((p) => '- ' + p), '')
  }
  if (warnings !== undefined && warnings.length > 0) {
    lines.push('## 提醒（不拦写回，自己判断）', '', ...warnings.map((w) => '- ' + w), '')
  }
  for (const item of diff) {
    lines.push(`## 第 ${item.seg} 段（${item.type}${item.note === '' ? '' : '：' + item.note}）`, '', '**原文**', '', item.before, '', '**改后**', '', item.after, '')
  }
  if (diff.length === 0) lines.push('（模型没有改动任何段落）', '')
  return lines.join('\n')
}

/** 生成模型可见的改写指令（system 提示）。 */
export function revisionSystemPrompt(profile) {
  return [
    '你是中文网文的老责编，正在按作者的批注做**最小改动**的微调。',
    '',
    '铁律：',
    '1. 只改被批注的段落，一个字都不要碰其他段落；不要顺手动"读起来也别扭"的地方。',
    '2. 不要增删段落，不要改变段落顺序，不要把一段拆成两段或合成一段。',
    '3. 改写后的段落字数与原段相当（±50% 以内），除非批注明确要求删减或扩写。',
    '4. 保持原文的人称、视角、时态、术语口径；不要引入新的设定、人物、道具。',
    '5. 不要写解释、不要写评语、不要输出 markdown 代码围栏。',
    '',
    '输出格式（每段一条，编号必须与输入一致，正文可以多行）：',
    '[段号] 改写后的段落正文',
    '',
    profile === '' || profile === undefined ? '' : '作者的写作规律（必须遵守）：\n' + profile,
  ]
    .filter((x) => x !== '')
    .join('\n')
}

/** 微调调用的用户消息。 */
export function revisionUserPrompt(input) {
  return [
    '下面是需要微调的段落（编号 = 段落在本章中的序号），以及作者的批注：',
    '',
    input.text,
    '',
    '请按格式逐段输出改写结果。',
  ].join('\n')
}
