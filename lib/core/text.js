/**
 * dsh-novel-craft — 共享文本工具
 *
 * 这些函数被宿主半区的多个模块共用（抽卡分段、写作包组装、账目体检、情节体检）。
 * 单独拆一个文件，是为了让 core/ 下的模块彼此不互相 import——避免环形依赖，
 * 也让每个模块都能单独拿假数据写单测。
 *
 * 约定：所有"读不到就算了"的 IO 一律返回空值而不抛异常。
 * 工作台可能运行在别人的机器上，路径不对时应该退化（少一个面板），
 * 而不是把整个宿主半区炸掉。
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname } from 'node:path'

/** 正文类扩展名：只有这些文件会被当成稿子读。 */
export const TEXT_EXT = new Set(['.txt', '.md'])

/** 把正文切成段落：空行分段，去空段，保留原始顺序。 */
export function splitSegments(text) {
  return String(text)
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * 中文正文的"字数"：去掉所有空白后的字符数。
 * 不用 Buffer.byteLength——作者关心的是字，不是字节。
 */
export function charCount(text) {
  return String(text).replace(/\s/g, '').length
}

/** 裁到 n 个字符，超出加省略号（给证据/摘要这类要进上下文的地方用）。 */
export function clip(text, n) {
  const flat = String(text).replace(/\s+/g, ' ').trim()
  if (flat.length <= n) return flat
  return flat.slice(0, n) + '…'
}

/** 读文本；文件不存在或读不了就返回 ''（调用方不必 try/catch）。 */
export async function readTextSafe(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

/** 读 JSON；坏文件/不存在都返回 null。 */
export async function readJsonSafe(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    return parsed === null ? null : parsed
  } catch {
    return null
  }
}

/** 写 JSON（自动建目录，方便调用方省一步）。 */
export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8')
  return path
}

/** 文件情况：不存在时 bytes=0、mtime=''，调用方拿它做存在性判断。 */
export async function statSafe(path) {
  try {
    const info = await stat(path)
    if (!info.isFile()) return { exists: false, bytes: 0, mtime: '' }
    return { exists: true, bytes: info.size, mtime: info.mtime.toISOString() }
  } catch {
    return { exists: false, bytes: 0, mtime: '' }
  }
}

/** 目录存在性（不需要区分文件/目录时报这个）。 */
export function exists(path) {
  return path !== '' && existsSync(path)
}

/**
 * 从文件名里解析章号。作者的命名习惯不止一种，这里一并认：
 *   `逐弈登仙-第8章.txt` / `第 8 章 血炼台上.txt` / `第008章.txt` / `chapter-8.md`
 * 全书合并稿（`逐弈登仙.txt`）不带"第N章"，因此解析结果是 null——这一点很关键，
 * 否则导出稿会被当成一个"章节"混进看板。
 */
export function chapterNumberOf(name) {
  const base = basename(String(name)).replace(/\.[^.]+$/, '')
  const cn = /第\s*([0-9〇零一二三四五六七八九十百千两]+)\s*章/.exec(base)
  if (cn !== null) {
    const n = cnNumber(cn[1])
    if (n !== null) return n
  }
  const en = /(?:^|[-_\s])(?:ch|chapter)[-_\s]*(\d+)(?:$|[-_\s])/i.exec(base)
  if (en !== null) return Number(en[1])
  return null
}

/** 中文数字 → 阿拉伯数字（支持到万位以内，够章号用）。 */
export function cnNumber(raw) {
  const s = String(raw).trim()
  if (s === '') return null
  if (/^\d+$/.test(s)) return Number(s)
  const digits = { 〇: 0, 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const units = { 十: 10, 百: 100, 千: 1000, 万: 10000 }
  let total = 0
  let section = 0
  let digit = 0
  let seen = false
  for (const ch of s) {
    if (digits[ch] !== undefined) {
      digit = digits[ch]
      seen = true
      continue
    }
    const unit = units[ch]
    if (unit === undefined) return null
    seen = true
    if (unit === 10000) {
      section = (section + digit) * unit
      total += section
      section = 0
      digit = 0
      continue
    }
    // 「十二」这种省略了前面的"一"：digit 为 0 时按 1 计
    section += (digit === 0 ? 1 : digit) * unit
    digit = 0
  }
  if (!seen) return null
  return total + section + digit
}

/** 从文件名里取"章节标题"：`逐弈登仙-第8章.txt` → ''（标题在正文首行）。 */
export function titleFromText(text) {
  for (const raw of String(text).slice(0, 400).split('\n')) {
    const line = raw.replace(/^#+\s*/, '').trim()
    if (line === '') continue
    return clip(line, 60)
  }
  return ''
}

/** 文件名去掉扩展名，用于展示。 */
export const stemOf = (name) => basename(String(name)).replace(/\.[^.]+$/, '')
