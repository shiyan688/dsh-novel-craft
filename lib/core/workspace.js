/**
 * dsh-novel-craft — 作品结构（作品 → 章节 → 轮次）
 *
 * 这个模块只做一件事：把作者已经存在的目录习惯**读**成结构化数据。
 * 它不要求作者为了用工作台重新组织文件——真实的作品目录长什么样，
 * 这里就按什么样子解析（正文 `逐弈登仙-第8章.txt`、总结 `剧情/第 8 章 剧情总结.md`、
 * 候选稿 `factory/runs/逐弈登仙/第9章/候选稿/`、评论 `评论/第8章_评论数据.json`）。
 *
 * 路径约定（新增的产物尽量放在不打扰原稿的地方）：
 *   <作品根>/.dsh-novel-craft/批注/第N章.json     ← 批注（永远不进模型上下文）
 *   <作品根>/.dsh-novel-craft/workspace.json      ← 作品级状态（阶段进度、手工张力、章节覆盖）
 *   <轮次目录>/写作包.md 或 .dsh-novel-craft/写作包/第N章 写作包.md  ← 写作包（唯一该喂给写稿会话的东西）
 */
import { readdir, mkdir } from 'node:fs/promises'
import { join, basename, dirname, resolve } from 'node:path'

import {
  TEXT_EXT,
  charCount,
  chapterNumberOf,
  readJsonSafe,
  readTextSafe,
  splitSegments,
  statSafe,
  titleFromText,
  writeJson,
} from './text.js'

export const STATE_DIR = '.dsh-novel-craft'
export const WORKSPACE_FILE = 'workspace.json'
export const ANNOTATION_DIR = '批注'
export const PACK_DIR = '写作包'

/** 轮次目录里可能是"卡池"的子目录名（作者的实际命名习惯）。 */
const ROUND_HINT = /候选|抽卡|对比|三版|重写|代理稿|定稿|草稿|draft|variant/i
export const stateDirOf = (projectDir) => join(projectDir, STATE_DIR)
export const annotationPathOf = (projectDir, chapter) =>
  join(stateDirOf(projectDir), ANNOTATION_DIR, `第${chapter}章.json`)
export const workspacePathOf = (projectDir) => join(stateDirOf(projectDir), WORKSPACE_FILE)

/** 写作包落点：优先放在本轮创作目录里（作者顺手就能看见），否则退回状态目录。 */
export function packPathOf(projectDir, chapter, runDir) {
  if (typeof runDir === 'string' && runDir !== '') return join(runDir, '写作包.md')
  return join(stateDirOf(projectDir), PACK_DIR, `第${chapter}章 写作包.md`)
}

/** 微调稿与备份（批注式微调的产物，正文被改之前必须留一份原稿）。 */
export const revisionPathOf = (projectDir, chapter) =>
  join(stateDirOf(projectDir), '微调', `第${chapter}章 微调稿.md`)
export const revisionBackupDirOf = (projectDir) => join(stateDirOf(projectDir), '微调', '原稿备份')

/** 从任意名字里宽松地取章号（评论文件名是 `第8章_评论数据.json`，带"章"字）。 */
function looseChapterOf(name) {
  const exact = chapterNumberOf(name)
  if (exact !== null) return exact
  const matched = /第\s*(\d+)\s*章/.exec(basename(String(name)))
  return matched === null ? null : Number(matched[1])
}

async function listDir(dir, withFileTypes) {
  try {
    return await readdir(dir, withFileTypes === undefined ? undefined : { withFileTypes: true })
  } catch {
    return []
  }
}

/** 一个目录里直接放着的正文篇数（不递归）。 */
async function countTexts(dir) {
  const entries = await listDir(dir, true)
  let n = 0
  for (const entry of entries) {
    if (entry.isFile() && TEXT_EXT.has(entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase())) n += 1
  }
  return n
}

/**
 * 找"作品根"：从任意起点（通常是候选稿目录）向上走，给每个祖先打分。
 *
 * 打分而不是匹配固定名字，是因为作者的作品目录千奇百怪：
 * 判据只有"像一本正在写的书"——有 `第N章` 正文、有 设定/人物/剧情 这类配套目录。
 */
export async function detectProject(startDir, options) {
  const maxUp = options !== undefined && Number.isInteger(options.maxUp) ? options.maxUp : 8
  const start = resolve(String(startDir === undefined || startDir === null ? '' : startDir))
  const scored = []
  let current = start
  for (let depth = 0; depth <= maxUp; depth += 1) {
    const score = await scoreAsProject(current)
    if (score.score > 0) scored.push({ dir: current, ...score, depth })
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  // runs 目录线索：`.../runs/<作品名>/第N章/...` 里的 <作品名> 就是书名。
  // 关键：作品正文**未必**在 runs 的父目录下——作者的真实布局是
  // `novel/逐弈登仙`（正文）与 `novel/factory/runs/逐弈登仙`（创作记录）平级。
  // 所以同名目录的几个常见位置都要试一遍，谁能数出真正的章节正文，谁才是作品根。
  const runsInfo = runsRootFrom(start)
  if (runsInfo !== null && runsInfo.name !== '') {
    let base = runsInfo.runsBase
    for (let level = 0; level < 4; level += 1) {
      const guessed = join(base, runsInfo.name)
      if (!scored.some((c) => c.dir === guessed)) {
        const score = await scoreAsProject(guessed)
        if (score.score > 0) scored.push({ dir: guessed, ...score, depth: 100, why: [...score.why, '同名作品目录'] })
      }
      const up = dirname(base)
      if (up === base) break
      base = up
    }
  }
  scored.sort((a, b) => b.score - a.score || a.depth - b.depth)
  const best = scored.length === 0 ? null : scored[0]
  return {
    projectDir: best === null ? '' : best.dir,
    name: best === null ? '' : basename(best.dir),
    runsRoot: runsInfo === null ? '' : runsInfo.runsBase,
    bookRunDir: runsInfo === null ? '' : join(runsInfo.runsBase, runsInfo.name),
    candidates: scored.map((c) => ({ dir: c.dir, name: basename(c.dir), score: c.score, why: c.why })),
  }
}

/** 一个目录"像作品根"的程度。 */
async function scoreAsProject(dir) {
  const why = []
  let score = 0
  const entries = await listDir(dir, true)
  if (entries.length === 0) return { score: 0, why }

  // 章节正文按"篇数"计分而不是按"有没有"：一个目录里偶然躺着一篇名字带"第N章"的
  // 文档（讲义、审稿记录）不该被当成一本书；真有十几章正文的目录要明显胜出。
  const chapterHere = entries.filter((e) => e.isFile() && chapterNumberOf(e.name) !== null).length
  if (chapterHere > 0) {
    score += Math.min(chapterHere, 12) * 2
    why.push(`${chapterHere} 章正文`)
  }
  const dirNames = new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name))
  const chapterDir = [...dirNames].find((n) => /^章节$|^正文$|^chapters?$/i.test(n))
  if (chapterDir !== undefined) {
    const nested = (await listDir(join(dir, chapterDir), true)).filter(
      (e) => e.isFile() && chapterNumberOf(e.name) !== null,
    ).length
    if (nested > 0) {
      score += Math.min(nested, 12) * 2
      why.push(`${chapterDir}/ 下 ${nested} 章`)
    }
  }
  for (const key of ['设定', '人物', '剧情', '评论']) {
    if (dirNames.has(key)) {
      score += 3
      why.push(`${key}/`)
    }
  }
  if (dirNames.has(STATE_DIR)) {
    score += 2
    why.push(STATE_DIR + '/')
  }
  if (dirNames.has('factory') || dirNames.has('runs')) {
    score += 1
    why.push('创作目录')
  }
  return { score, why }
}

/**
 * 从路径里识别 `.../runs/<作品名>/...`：
 * 返回 runs 目录本身（runsBase）与书名，上层据此去猜正文目录在哪。
 */
function runsRootFrom(start) {
  const parts = start.split('/').filter((s) => s !== '')
  for (let i = parts.length - 1; i >= 1; i -= 1) {
    if (parts[i - 1] !== 'runs') continue
    const name = parts[i]
    if (name === '' || name.startsWith('.')) continue
    return { runsBase: '/' + parts.slice(0, i).join('/'), name }
  }
  return null
}

/** 轮次根目录的几个候选位置（作者的实际布局是"作品根的同级 factory/runs/作品名"）。 */
export function runsDirCandidates(projectDir, name, runsRoot) {
  const out = []
  if (runsRoot !== '') out.push(join(runsRoot, name))
  out.push(join(projectDir, 'factory', 'runs', name))
  out.push(join(projectDir, 'runs', name))
  out.push(join(dirname(projectDir), 'factory', 'runs', name))
  out.push(join(projectDir, '..', 'factory', 'runs', name))
  return [...new Set(out.map((p) => resolve(p)))]
}

/** 单章的正文候选：根目录、章节/、正文/ 三处都看，按优先级取一个当"正稿"。 */
async function chapterFilesOf(projectDir) {
  const found = new Map() // chapter → [{path, file, priority, rel}]
  const scan = async (dir, priority, rel) => {
    for (const entry of await listDir(dir, true)) {
      if (!entry.isFile()) continue
      const dot = entry.name.lastIndexOf('.')
      if (dot === -1 || !TEXT_EXT.has(entry.name.slice(dot).toLowerCase())) continue
      const chapter = chapterNumberOf(entry.name)
      if (chapter === null) continue // 全书合并稿没有"第N章"，不算章节
      const list = found.get(chapter) === undefined ? [] : found.get(chapter)
      list.push({ path: join(dir, entry.name), file: entry.name, priority, rel })
      found.set(chapter, list)
    }
  }
  await scan(projectDir, 0, '')
  for (const entry of await listDir(projectDir, true)) {
    if (!entry.isDirectory()) continue
    if (/^(章节|正文|chapters?)$/i.test(entry.name)) await scan(join(projectDir, entry.name), 1, entry.name + '/')
  }
  return found
}

/** 目录里按章号索引的文件（剧情总结 / 评论数据都用它）。 */
async function filesByChapter(dir) {
  const map = new Map()
  for (const entry of await listDir(dir, true)) {
    if (!entry.isFile()) continue
    const chapter = looseChapterOf(entry.name)
    if (chapter === null) continue
    if (!map.has(chapter)) map.set(chapter, [])
    map.get(chapter).push(entry.name)
  }
  return map
}

/** 人物卡：作者用 `人物/*.json`（字段中文）。缺目录/坏 JSON 都跳过。 */
export async function readPeople(projectDir) {
  const dir = join(projectDir, '人物')
  const out = []
  for (const entry of await listDir(dir, true)) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue
    if (/主要人物|index|列表/i.test(entry.name)) continue
    const parsed = await readJsonSafe(join(dir, entry.name))
    if (parsed === null || typeof parsed !== 'object') continue
    const name = String(parsed['姓名'] ?? parsed.name ?? '').trim()
    if (name === '') continue
    out.push({
      file: entry.name,
      name,
      identity: String(parsed['身份'] ?? '').trim(),
      realm: String(parsed['境界'] ?? '').trim(),
      importance: String(parsed['剧情重要性'] ?? '').trim(),
      status: String(parsed['状态'] ?? '').trim(),
      raw: parsed,
    })
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  return out
}

/**
 * 读一个章节目录下的标注数（抽卡工作台把 marks.json 写在各卡池目录里）。
 * 只统计这个轮次目录及其直接子目录，够用且不会翻遍磁盘。
 */
async function marksInRun(runDir) {
  const files = [join(runDir, STATE_DIR, 'marks.json')]
  for (const entry of await listDir(runDir, true)) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) files.push(join(runDir, entry.name, STATE_DIR, 'marks.json'))
  }
  let good = 0
  let bad = 0
  let pools = 0
  for (const file of files) {
    const parsed = await readJsonSafe(file)
    if (parsed === null || typeof parsed !== 'object') continue
    let touched = false
    for (const entry of Object.values(parsed)) {
      if (entry === null || typeof entry !== 'object') continue
      for (const value of Object.values(entry)) {
        if (value === 'good') {
          good += 1
          touched = true
        } else if (value === 'bad') {
          bad += 1
          touched = true
        }
      }
    }
    if (touched) pools += 1
  }
  return { good, bad, pools }
}

/** 轮次目录内容：卡池子目录 + 记录文件。 */
async function readRunDir(runDir) {
  const entries = await listDir(runDir, true)
  const rounds = []
  let drafts = 0
  for (const entry of entries) {
    if (entry.name === STATE_DIR) continue
    if (entry.isDirectory()) {
      const count = await countTexts(join(runDir, entry.name))
      drafts += count
      rounds.push({ name: entry.name, kind: 'dir', drafts: count, candidate: ROUND_HINT.test(entry.name) })
    } else if (/\.(md|txt|json)$/i.test(entry.name)) {
      const size = await statSafe(join(runDir, entry.name))
      rounds.push({ name: entry.name, kind: 'file', bytes: size.bytes })
    }
  }
  return { dir: runDir, exists: entries.length > 0, rounds, drafts }
}

/** 作品级状态：阶段进度、手工张力、章节覆盖。作者没动过时返回空骨架。 */
export async function readWorkspaceState(projectDir) {
  const parsed = await readJsonSafe(workspacePathOf(projectDir))
  const base = { stage: '', stages: {}, tension: {}, chapterStatus: {}, updatedAt: '' }
  if (parsed === null || typeof parsed !== 'object') return base
  return {
    stage: typeof parsed.stage === 'string' ? parsed.stage : '',
    stages: parsed.stages !== null && typeof parsed.stages === 'object' ? parsed.stages : {},
    tension: parsed.tension !== null && typeof parsed.tension === 'object' ? parsed.tension : {},
    chapterStatus: parsed.chapterStatus !== null && typeof parsed.chapterStatus === 'object' ? parsed.chapterStatus : {},
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    notes: typeof parsed.notes === 'string' ? parsed.notes : '',
  }
}

/** 合并式写作品级状态（只覆盖传进来的字段）。 */
export async function writeWorkspaceState(projectDir, patch) {
  const current = await readWorkspaceState(projectDir)
  const next = {
    stage: typeof patch.stage === 'string' ? patch.stage : current.stage,
    stages: patch.stages === undefined ? current.stages : { ...current.stages, ...patch.stages },
    tension: patch.tension === undefined ? current.tension : { ...current.tension, ...patch.tension },
    chapterStatus:
      patch.chapterStatus === undefined ? current.chapterStatus : { ...current.chapterStatus, ...patch.chapterStatus },
    notes: typeof patch.notes === 'string' ? patch.notes : current.notes,
    updatedAt: new Date().toISOString(),
  }
  await mkdir(stateDirOf(projectDir), { recursive: true })
  await writeJson(workspacePathOf(projectDir), next)
  return next
}

/** 章节状态：有正文 = written；只有轮次产物 = draft；都没有 = none。 */
function chapterStatus(row) {
  if (row.chars > 0) return 'written'
  if (row.run.exists && row.run.drafts > 0) return 'draft'
  return 'none'
}

/**
 * 读整本作品：章节看板 + 汇总。
 *
 * `annotationsFor(chapter)` 由上层注入（批注模块的路径约定只有一处实现），
 * 这样本模块不需要反向依赖 annotate.js。
 */
export async function readWorkspace(projectDir, options) {
  const opts = options === undefined ? {} : options
  const name = typeof opts.name === 'string' && opts.name !== '' ? opts.name : basename(projectDir)
  const runsRoot = typeof opts.runsRoot === 'string' ? opts.runsRoot : ''
  const state = await readWorkspaceState(projectDir)

  const chapterFiles = await chapterFilesOf(projectDir)
  const summaries = await filesByChapter(join(projectDir, '剧情'))
  const comments = await filesByChapter(join(projectDir, '评论'))

  // 轮次目录：第一个存在的候选就是它
  let runBase = ''
  for (const candidate of runsDirCandidates(projectDir, name, runsRoot)) {
    const entries = await listDir(candidate, true)
    if (entries.length > 0) {
      runBase = candidate
      break
    }
  }

  const rows = []
  for (const chapter of [...chapterFiles.keys()].sort((a, b) => a - b)) {
    const files = chapterFiles.get(chapter).sort((a, b) => a.priority - b.priority || a.file.localeCompare(b.file, 'zh'))
    const primary = files[0]
    const text = await readTextSafe(primary.path)
    const size = await statSafe(primary.path)
    const summaryNames = summaries.get(chapter) === undefined ? [] : summaries.get(chapter)
    const commentNames = comments.get(chapter) === undefined ? [] : comments.get(chapter)
    const commentPath = commentNames.length === 0 ? '' : join(projectDir, '评论', commentNames[0])
    let score = null
    let commentCount = 0
    if (commentPath !== '') {
      const parsed = await readJsonSafe(commentPath)
      const list = parsed !== null && Array.isArray(parsed.comments) ? parsed.comments : []
      const scored = list.filter((c) => c !== null && typeof c === 'object' && typeof c.score === 'number')
      if (scored.length > 0) {
        score = Math.round((scored.reduce((sum, c) => sum + c.score, 0) / scored.length) * 10) / 10
        commentCount = scored.length
      }
    }
    const runDir = runBase === '' ? '' : join(runBase, `第${chapter}章`)
    const run = runDir === '' ? { dir: '', exists: false, rounds: [], drafts: 0 } : await readRunDir(runDir)
    const marks = runDir === '' ? { good: 0, bad: 0, pools: 0 } : await marksInRun(runDir)
    const packPath = packPathOf(projectDir, chapter, run.exists ? run.dir : '')
    const pack = await statSafe(packPath)
    const annotationList = typeof opts.annotationsFor === 'function' ? await opts.annotationsFor(chapter) : []
    const open = annotationList.filter((a) => a.status !== 'resolved' && a.status !== 'ignored').length
    const resolved = annotationList.length - open
    const row = {
      chapter,
      title: titleFromText(text) === '' ? primary.file.replace(/\.[^.]+$/, '') : titleFromText(text),
      file: primary.file,
      path: primary.path,
      chars: charCount(text),
      bytes: size.bytes,
      segments: splitSegments(text).length,
      altFiles: files.slice(1).map((f) => ({ file: f.file, rel: f.rel, path: f.path })),
      summary: {
        path: summaryNames.length === 0 ? '' : join(projectDir, '剧情', summaryNames[0]),
        files: summaryNames,
        exists: summaryNames.length > 0,
      },
      comment: { path: commentPath, exists: commentPath !== '', score, count: commentCount },
      run,
      marks,
      annotations: { open, resolved, total: annotationList.length },
      pack: { path: packPath, exists: pack.exists, bytes: pack.bytes, mtime: pack.mtime },
      tension: typeof state.tension[String(chapter)] === 'number' ? state.tension[String(chapter)] : null,
      override: typeof state.chapterStatus[String(chapter)] === 'string' ? state.chapterStatus[String(chapter)] : '',
    }
    row.status = row.override === '' ? chapterStatus(row) : row.override
    rows.push(row)
  }

  const totals = {
    chapters: rows.length,
    written: rows.filter((r) => r.chars > 0).length,
    chars: rows.reduce((sum, r) => sum + r.chars, 0),
    good: rows.reduce((sum, r) => sum + r.marks.good, 0),
    bad: rows.reduce((sum, r) => sum + r.marks.bad, 0),
    openAnnotations: rows.reduce((sum, r) => sum + r.annotations.open, 0),
    packs: rows.filter((r) => r.pack.exists).length,
    scored: rows.filter((r) => r.comment.score !== null).length,
    avgScore:
      rows.filter((r) => r.comment.score !== null).length === 0
        ? null
        : Math.round(
            (rows.filter((r) => r.comment.score !== null).reduce((sum, r) => sum + r.comment.score, 0) /
              rows.filter((r) => r.comment.score !== null).length) *
              10,
          ) / 10,
  }

  const people = await readPeople(projectDir)
  const outline = await statSafe(join(projectDir, '大纲.md'))
  const merged = await statSafe(join(projectDir, `${name}.txt`))

  return {
    projectDir,
    name,
    runsRoot: runBase === '' ? runsRoot : dirname(runBase),
    runBase,
    chapters: rows,
    totals,
    state: { stage: state.stage, stages: state.stages, updatedAt: state.updatedAt },
    people: people.map((p) => ({ file: p.file, name: p.name, identity: p.identity, realm: p.realm, importance: p.importance })),
    outline: { path: join(projectDir, '大纲.md'), exists: outline.exists, bytes: outline.bytes },
    merged: { path: join(projectDir, `${name}.txt`), exists: merged.exists, bytes: merged.bytes },
  }
}

/** 单章详情：正文段落 + 落点路径（工作台读稿区与批注都用它）。 */
export async function readChapter(projectDir, chapter, options) {
  const opts = options === undefined ? {} : options
  const files = await chapterFilesOf(projectDir)
  const list = files.get(Number(chapter))
  if (list === undefined) {
    return { chapter: Number(chapter), found: false, text: '', segments: [], path: '', file: '' }
  }
  const primary = list.sort((a, b) => a.priority - b.priority)[0]
  const text = await readTextSafe(primary.path)
  return {
    chapter: Number(chapter),
    found: true,
    text,
    segments: splitSegments(text),
    path: primary.path,
    file: primary.file,
    title: titleFromText(text),
    alternates: list.slice(1).map((f) => ({ file: f.file, path: f.path, rel: f.rel })),
    annotationPath: annotationPathOf(projectDir, Number(chapter)),
    revisionPath: revisionPathOf(projectDir, Number(chapter)),
    summaryPath: opts.summaryPath === undefined ? '' : opts.summaryPath,
  }
}

/** 归档目录里的章节（只做提示：这些不是本轮卡池）。 */
export async function readArchive(projectDir) {
  const dir = join(projectDir, '归档')
  const out = []
  for (const entry of await listDir(dir, true)) {
    if (!entry.isDirectory()) continue
    out.push({ name: entry.name, chapter: looseChapterOf(entry.name) })
  }
  return out
}
