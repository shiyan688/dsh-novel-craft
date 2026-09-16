/**
 * 账目体检 —— 台账（道具与增益）解析 + 与正文对账
 *
 * 为什么单开一个纯函数模块：台账是 markdown（各表列名还不统一），正文是自然语言，
 * 两边对账全靠启发式。把它放在 lib/core/ 下、只依赖 node 内置模块，
 * 好处是不起 dsh、不连网络就能单测（见 test/ledger.test.mjs）。
 *
 * 三条设计取舍：
 * 1. 只读不写：体检只出结论，落不落盘、怎么呈现由上层决定，本模块绝不改台账。
 * 2. 一律降级：文件读不到、格式不对、一条物品都解析不出，都返回空结果而不是抛异常——
 *    工作台少一条提示，总好过整块报错；台账为空时更是什么都不报，
 *    因为那时"未登记"对每一件东西都成立，报出来只会刷屏。
 * 3. 宁少报不多报：中文正文里"像物品名"的词远多于真物品，所以候选按来源分宽严——
 *    书名号最可信；引号里只认带物品后缀的；裸文本还要至少 3 个字、全书复现 ≥2 次。
 *    台账解析同理：只按表头认列，表头没有名称列的表整表跳过（「系统通用规则」就是这种）。
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** 台账相对作品根目录的位置：主流是 设定/，老作品可能平铺在根目录 */
const LEDGER_DIR = '设定'
const LEDGER_NAMES = ['道具与增益台账.md', '道具台账.md', '道具与增益账目.md', '增益与道具台账.md']
/** 文件名不固定时的兜底特征 */
const LEDGER_NAME_HINT = /台账|账目|道具/

/** 台账没写价格表时的兜底口径（与正文「对应价格：100 / 500 / 2000 / 5000 / 10000 / 1000」一致） */
const DEFAULT_PRICES = [100, 500, 2000, 5000, 10000, 1000]

/** 物品名常见后缀：正文里没加书名号时，只靠"名字长这样"来猜 */
const ITEM_SUFFIX = '丹符刀剑石术诀录珠玉草果币盘镜甲令'
const SUFFIX_RE = new RegExp(`[${ITEM_SUFFIX}]$`)
/** 只由这些字组成的词几乎一定是泛称（灵石／丹药／符箓／法宝／法器…），不是专名 */
const GENERIC_CHARS = new Set('灵丹药符箓法宝器术石玉珠盘镜甲令币品阶级种类份枚个张只把本卷册篇力量气方')
/** 常见姓氏：两三个字、又没有物品后缀的词，多半是人名而不是物品 */
const SURNAMES = new Set('王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤宁关文岳温常康乔安连尹')

/**
 * 虚词／代词／能愿动词：名字里出现这些字就绝不是物品名。
 * 这一条比任何词表都管用——「一柄染血的魔刀」这类窗口全靠它挡掉。
 */
const FUNCTION_CHARS = new Set('的了着过和与及或在是不没可被把给对从向为能会要想说道问看见知都也还很太更又再只才便而所以因但并且则就等们你我他她它其此')
/**
 * 裸文本往回扫词时的断点，三类：
 * 1) 虚词／代词（FUNCTION_CHARS）；
 * 2) 数词与量词——「一枚疗伤丹」要断出「疗伤丹」；
 * 3) 行文里高频的动词与结构助词——中文没有词边界，「血钉嗖地钉入黑石」这种窗口
 *    只能靠把动词当断点切短。只当断点、不进 FUNCTION_CHARS：
 *    【夺魂剑】这类名字走引号那条路照样认得，不必因为一个字就否掉整个名字。
 */
const PROSE_BREAK = '入地用拿握抓夺取打杀买卖收送找抢献注撞砸落碎破开关走去放站坐倒飞跃立出进退使将该让'
const NAME_BOUNDARY = new Set([...FUNCTION_CHARS, ...'两三四五六七八九十百千万几数枚个块张份只本卷颗支根件套瓶袋种盒片条名位柄口座门上下中前后内里边外', ...PROSE_BREAK])
/** 境界写法（练气一层／筑基七层）不是物品，虽然它也带"层" */
const LEVEL_RE = /^(练气|筑基|金丹|元婴|化神|大乘)[一二三四五六七八九十0-9]?[层阶期]$/

/**
 * 明确"不是物品"的整词：系统面板词、等级品级词、泛称、身份称呼。
 * 只做整词匹配——包含关系交给台账词汇表（见 buildKnown），避免误伤「任务大师」这类真物品名。
 */
const STOP_WORDS = new Set([
  '增益', '神通', '仙术', '宝具', '法宝', '法器', '战利品', '系统', '系统提示', '玩家', '非玩家',
  '人物', '境界', '功法', '灵根', '品阶', '品级', '状态', '效果', '特性', '说明', '身份', '名称',
  '数量', '项目', '规则', '条件', '描述', '任务', '奖励', '惩罚', '面板', '提示', '余额', '价格',
  '汇率', '汇率说明', '对应价格', '胜利条件', '匹配成功', '副本投放', '第一幕', '第二幕',
  '普通', '十不逢一', '百里挑一', '千载难逢', '万世传说', '全随机',
  '上品', '中品', '下品', '极品', '低阶', '高阶', '一品', '二品', '三品',
  '灵石', '上品灵石', '中品灵石', '下品灵石', '极品灵石', '普通灵石', '蕴灵币', '灵币', '灵晶',
  '货币', '初始货币', '灵晶卡', '丹药', '丹方', '符箓', '符纸', '道袍', '储物袋', '储物戒', '玉瓶',
  '药田', '丹炉', '散修', '修士', '妖兽', '魔修', '弟子', '长老', '真人', '师兄', '师姐', '师妹',
  '少爷', '掌柜', '老板', '女人', '男人', '众人', '旁人', '对方', '此事', '此时', '此地', '心中',
  '可以', '没有', '不是', '就是', '于是', '但是', '因为', '所以', '已经', '开始', '结束',
  '时候', '现在', '什么', '怎么', '这个', '那个', '一个', '两个', '我们', '你们', '他们',
  '自己', '东西', '地方', '事情', '办法', '意思', '样子', '还是', '或者', '如果', '虽然',
  '然后', '这些', '那些', '所有', '全部', '最后', '之后', '以前', '一切', '有人', '身边',
])

/** 候选名前面的量词／品级修饰：抽词时剥掉，「一枚疗伤丹」要认得成「疗伤丹」 */
const MODIFIER_TOKENS = [
  '上品', '中品', '下品', '极品', '普通', '低阶', '中阶', '高阶', '高级', '初级', '中级', '劣质',
  '珍贵', '珍稀', '珍品', '那枚', '这枚', '一枚', '两枚', '三枚', '几枚', '数枚', '那柄', '这柄',
  '一柄', '那把', '这把', '那张', '这张', '那道', '这道', '二十', '三十', '四十', '五十', '六十',
  '七十', '八十', '九十', '十几', '数十', '上百', '上千', '数万',
  '十', '百', '千', '万', '一', '两', '二', '三', '四', '五', '六', '七', '八', '九', '几', '数',
  '那', '这', '其', '某', '各', '枚', '个', '块', '张', '份', '只', '把', '本', '卷', '颗', '支',
  '根', '件', '套', '瓶', '袋', '种', '盒', '片', '道', '条', '名', '位', '柄', '口', '座', '门',
].sort((a, b) => b.length - a.length)

// ── 一、纯函数：解析 ────────────────────────────────────────────────────────

const CN_DIGITS = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

/**
 * 从一段中文里解析章号。解析不出返回 null。
 * 要容忍的写法都是台账/正文里真实存在的：
 *   第8章 / 第 8 章 / 第8章获得 / 第6章花2000蕴灵币购买 / 第1—2章 / 第十二章
 */
export function chapterOf(text) {
  const source = String(text ?? '')
  if (source === '') return null
  // 区间写法「第1—2章」取起点：台账里它表达的是"最早出现在这一段的开头"
  const range = /第\s*(\d+)\s*[—\-–~～至到]\s*\d+\s*[章话回]/.exec(source)
  if (range !== null) return Number(range[1])
  const arabic = /第\s*(\d+)\s*[章话回]/.exec(source)
  if (arabic !== null) return Number(arabic[1])
  const chinese = /第\s*([零一二两三四五六七八九十百]+)\s*[章话回]/.exec(source)
  if (chinese !== null) return cnNumber(chinese[1])
  return null
}

/** 只处理到 99 的常见中文数字：台账里出现「第十二章」这种写法就够用了 */
function cnNumber(text) {
  const source = String(text ?? '')
  const tens = /^([一二两三四五六七八九])?十([一二两三四五六七八九])?$/.exec(source)
  if (tens !== null) return (tens[1] === undefined ? 1 : CN_DIGITS[tens[1]]) * 10 + (tens[2] === undefined ? 0 : CN_DIGITS[tens[2]])
  let value = 0
  for (const char of source) {
    if (CN_DIGITS[char] === undefined) return null
    value = value * 10 + CN_DIGITS[char]
  }
  return value
}

/**
 * 解析台账正文（纯函数，方便单测与复用）。
 * → { cutoffChapter: number|null, items: LedgerItem[], sections: string[] }
 */
export function parseLedger(text) {
  const source = typeof text === 'string' ? text : ''
  const { items, sections } = parseTables(source)
  return { cutoffChapter: parseCutoff(source), items, sections }
}

/** 头部「当前校对截止：第8章结束」「截至第N章」里的数字 */
function parseCutoff(source) {
  for (const line of String(source ?? '').split(/\r?\n/)) {
    if (/校对(?:截止|至)|截止|截至/.test(line) === false) continue
    const n = chapterOf(line)
    if (n !== null) return n
  }
  return null
}

/**
 * 表头 → 列下标。各表列名不统一，所以只认"表头里写了什么"，绝不按固定下标取列。
 * 表头里用 ／ 并列多个角色时（如「效果／状态」）按各段分别认领，一列可以兼两职。
 */
const COLUMN_ROLES = [
  ['name', /名称|物品|道具|法宝名|宝具名/],
  ['status', /状态/],
  ['firstSeen', /首次|首现|出处|来源|备注|获得|登场/],
  ['effect', /效果|作用|用途|说明|描述/],
  ['quantity', /数量|数目/],
  ['grade', /品级|品质|类型|品阶|等级/],
]

function columnsOf(cells) {
  const columns = {}
  cells.forEach((cell, index) => {
    for (const token of String(cell ?? '').split(/[／/|、·]/)) {
      for (const [role, pattern] of COLUMN_ROLES) {
        if (columns[role] === undefined && pattern.test(token)) columns[role] = index
      }
    }
  })
  return columns
}

/** 逐行扫 markdown 表格；表头没有名称列的表（如「系统通用规则」）整表跳过 */
function parseTables(source) {
  const items = []
  const sections = []
  let section = ''
  let columns = null
  for (const line of String(source ?? '').split(/\r?\n/)) {
    const trimmed = line.trim()
    const heading = /^(#{1,6})\s*(.+?)\s*#*$/.exec(trimmed)
    if (heading !== null) {
      section = heading[2].trim()
      sections.push(section)
      columns = null
      continue
    }
    if (trimmed.startsWith('|') === false) {
      columns = null
      continue
    }
    const cells = splitRow(trimmed)
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue
    if (columns === null) {
      const found = columnsOf(cells)
      columns = found.name === undefined ? {} : found
      continue
    }
    if (columns.name === undefined) continue
    const cell = (role) => (columns[role] === undefined ? '' : cleanCell(cells[columns[role]]))
    const name = cell('name')
    if (name === '' || /^[-—:：]+$/.test(name)) continue
    const status = cell('status')
    const firstSeen = cell('firstSeen')
    items.push({
      name,
      category: section,
      effect: cell('effect'),
      status,
      statusKind: statusKindOf(status),
      firstSeen,
      // 首现章号优先取「首次出现／备注」列与「状态」列；
      // 这两个地方都没有时（真实台账里「第8章西市所得」这类小节压根没有首现列，
      // 章号只写在小节标题里），拿小节标题兜底——否则"已消耗/已出售之后又出现"
      // 这类检查会因为 firstChapter 为 null 而整类失效。
      firstChapter: chapterOf(firstSeen) ?? chapterOf(status) ?? chapterOf(section),
      quantity: cell('quantity'),
      grade: cell('grade'),
    })
  }
  return { items, sections }
}

function splitRow(line) {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

/** 单元格清洗：markdown 强调、行内代码、包裹的引号都不算名字的一部分 */
function cleanCell(value) {
  return String(value ?? '').replace(/[`*]/g, '').replace(/^["'“”「」]+|["'“”「」]+$/g, '').trim()
}

/** 状态列原文 → 枚举。顺序即优先级：「已出售但某某仍持有」这种含糊写法按"持有"算。 */
function statusKindOf(status) {
  const source = String(status ?? '')
  if (source === '') return 'unknown'
  if (/持有/.test(source)) return 'held'
  if (/已消耗|已用|用掉|耗尽/.test(source)) return 'consumed'
  if (/已出售|卖出|已卖/.test(source)) return 'sold'
  if (/已植入|植入/.test(source)) return 'implanted'
  if (/待确认|未明示|未确认/.test(source)) return 'pending'
  return 'unknown'
}

/** 台账里声明的抽取价格表；没有这一行就用兜底口径 */
function declaredPrices(source) {
  for (const line of String(source ?? '').split(/\r?\n/)) {
    if (line.includes('抽取价格') === false) continue
    // 先把「第4章」这种出处去掉，否则它的章号会被当成一档价格
    const numbers = line.replace(/第\s*\d+\s*[章话回]/g, '').match(/\d+/g)
    if (numbers === null) continue
    const prices = numbers.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
    if (prices.length > 0) return prices
  }
  return DEFAULT_PRICES
}

// ── 二、候选物品名抽取（启发式，宁少报不多报） ──────────────────────────────

function hasSuffix(name) {
  return SUFFIX_RE.test(name)
}

function isGeneric(name) {
  if (name.length === 0) return true
  for (const char of name) {
    if (GENERIC_CHARS.has(char) === false) return false
  }
  return true
}

/** 剥掉前导量词/品级修饰：「一枚疗伤丹」→「疗伤丹」，「上品灵石」→「灵石」 */
function stripModifiers(name) {
  let rest = name
  for (let guard = 0; guard < 6; guard += 1) {
    const hit = MODIFIER_TOKENS.find((token) => token.length < rest.length && rest.startsWith(token))
    if (hit === undefined) break
    rest = rest.slice(hit.length)
  }
  return rest
}

/**
 * 台账里的"词汇表"：小节标题、物品名、品级/类型。
 * 用来排掉两类噪音——「宁陈」这类出现在小节标题里的人名，
 * 以及「任务大师加成生效」这种把真物品名包在里面的面板句子。
 * chapters 用来统计裸文本候选的复现次数（见 bareNames）。
 */
function buildKnown(ledger, chapters = []) {
  const names = new Set()
  const words = new Set()
  const add = (value) => {
    const word = String(value ?? '').trim()
    if (word.length >= 2) words.add(word)
  }
  for (const item of ledger.items ?? []) {
    names.add(item.name)
    for (const part of String(item.name).split(/[／/|、·]+/)) if (part.trim().length >= 2) names.add(part.trim())
    add(item.name)
    for (const part of String(item.name).split(/[／/|、·]+/)) add(part)
    for (const part of String(item.grade ?? '').split(/[／/|、·]+/)) add(part)
  }
  for (const section of ledger.sections ?? []) {
    add(section)
    for (const token of String(section).split(/[^\u4e00-\u9fa5A-Za-z0-9]+|的|与|和|及|等|类/)) add(token)
  }
  // 裸文本候选的复现次数：中文没有词边界，单次出现的裸词几乎都是行文顺手写的泛称
  const counts = new Map()
  for (const chapter of chapters) {
    for (const name of bareNames(chapter.text)) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return { names, words, counts }
}

/**
 * 只做"严格包含"的词汇过滤：等于某个台账词不算命中——
 * 否则已登记的物品名会把自己过滤掉，且那一步该由 names 精确匹配负责。
 */
function inVocabulary(name, known) {
  for (const word of known.words) {
    if (word === name) continue
    if (word.length >= 2 && (name.includes(word) || word.includes(name))) return true
  }
  return false
}

/** 统一成 { raw, name }：raw 是正文里原样，name 是剥掉量词后的名字 */
function normalizeCandidate(value) {
  // 内部带空白的不算名字（「第一幕 魔宗血炼」「匹配成功 10/10」），所以只去首尾引号、不去空白
  const raw = String(value ?? '').trim().replace(/^["'“”‘’「」]+|["'“”‘’「」]+$/g, '')
  if (raw.length < 2 || raw.length > 8) return null
  if (/\s/.test(raw)) return null
  // 只认纯汉字：带数字、标点、字母的（面板句子、章号、"10/10"）一律不是物品名
  if (/^[\u4e00-\u9fa5]+$/.test(raw) === false) return null
  const name = stripModifiers(raw)
  if (name.length < 2) return null
  return { raw, name }
}

function acceptCandidate(candidate, known) {
  if (candidate === null) return false
  const { raw, name } = candidate
  if (hasFunctionChar(name) || hasFunctionChar(raw)) return false
  if (LEVEL_RE.test(name) || LEVEL_RE.test(raw)) return false
  if (STOP_WORDS.has(name) || STOP_WORDS.has(raw)) return false
  if (isGeneric(name) || isGeneric(raw)) return false
  if (inVocabulary(name, known) || inVocabulary(raw, known)) return false
  // 两三个字、又没有物品后缀、还以常见姓氏开头：当人名处理（【龙日天】【苏清鸢】）
  if (raw.length <= 3 && hasSuffix(raw) === false && SURNAMES.has(raw[0])) return false
  return true
}

function hasFunctionChar(name) {
  for (const char of name) {
    if (FUNCTION_CHARS.has(char)) return true
  }
  return false
}

/**
 * 裸文本切出来的"动词+名字"（「点青云令」）：它的尾段本身就是更常见的候选（「青云令」），
 * 那就只留尾段。比往断点表里堆动词安全——真正的名字（夺魂剑/炼魂丹）不会被这条例误伤。
 */
function isFragmentOf(name, counts) {
  const own = counts.get(name) ?? 0
  for (let cut = 1; cut <= name.length - 3; cut += 1) {
    const tail = name.slice(cut)
    if ((counts.get(tail) ?? 0) >= own) return true
  }
  return false
}

/**
 * 裸文本候选：从"物品后缀字"往回取一段名字，遇到虚词/量词就断。
 * 为什么不用一条长正则整段吃：中文没有词边界，一条 `[汉字]{1,7}[后缀]` 会把
 * 「己正跪在一方黑石」整段当成名字；往回扫 + 断点至少切得出「黑石」这种形状正确的最小词。
 * 这个函数同时用于"抽候选"和"统计复现次数"——两处口径必须一致，否则出现次数对不上名字。
 */
function bareNames(text) {
  const source = String(text ?? '')
  const out = []
  for (let index = 0; index < source.length; index += 1) {
    if (SUFFIX_RE.test(source[index]) === false) continue
    let start = index
    while (start > 0 && index - start < 6) {
      const prev = source[start - 1]
      if (/[\u4e00-\u9fa5]/.test(prev) === false || NAME_BOUNDARY.has(prev)) break
      start -= 1
    }
    const candidate = normalizeCandidate(source.slice(start, index + 1))
    if (candidate !== null) out.push(candidate.name)
  }
  return out
}

/**
 * 抽疑似物品名（不去重登记的），按出现顺序返回 [{ name, sentence }]。
 * 三个来源可信度不同，所以收得宽严不同：
 * - 【】「」《》 是系统面板/强调，最可信，形状对就收；
 * - “” 在正文里绝大多数是台词，只有带物品后缀才收；
 * - 裸文本最不可信（「一柄染血的魔刀」也"以刀结尾"），所以加两道闸：
 *   至少 3 个字，且同一个词全书出现过 ≥2 次——只说一次的裸词多半是行文顺手写的泛称。
 */
function extractNames(text, known) {
  const source = String(text ?? '')
  const out = []
  const seen = new Set()
  const push = (value, bare = false) => {
    const candidate = normalizeCandidate(value)
    if (acceptCandidate(candidate, known) === false) return
    if (bare && (candidate.name.length < 3 || (known.counts?.get(candidate.name) ?? 0) < 2)) return
    if (bare && isFragmentOf(candidate.name, known.counts ?? new Map())) return
    if (seen.has(candidate.name)) return
    seen.add(candidate.name)
    out.push({ name: candidate.name, sentence: sentenceOf(source, candidate.name) })
  }
  for (const match of source.matchAll(/[【「《]([^】」》\n]{1,12})[】」》]/g)) push(match[1])
  for (const match of source.matchAll(/[“"]([^”"\n]{1,12})[”"]/g)) {
    if (hasSuffix(match[1]) && /\s/.test(match[1]) === false) push(match[1])
  }
  for (const name of bareNames(source)) push(name, true)
  return out
}

/** 正文里出现、台账里没有的疑似物品（每条只报一次，交给调用方按章去重） */
function suspectItems(text, known) {
  return extractNames(text, known).filter((hit) => known.names.has(hit.name) === false)
}

/** 同一轮里已经报过更长的写法（「入门炼气诀」），就别再报它的尾段（「炼气诀」） */
function isTailOf(name, reported) {
  for (const seen of reported) {
    if (seen !== name && seen.endsWith(name)) return true
  }
  return false
}

// ── 三、正文小工具 ──────────────────────────────────────────────────────────

const SENTENCE_BREAK = ['。', '！', '？', '；', '\n']

/** 取出包含 needle 的那一句，供 finding 当证据（面板整行自带换行，天然成句） */
function sentenceOf(text, needle) {
  const source = String(text ?? '')
  if (needle === '' || source === '') return ''
  const at = source.indexOf(needle)
  if (at === -1) return ''
  const before = source.slice(0, at)
  let start = -1
  for (const mark of SENTENCE_BREAK) start = Math.max(start, before.lastIndexOf(mark))
  let end = source.length
  for (const mark of SENTENCE_BREAK) {
    const hit = source.indexOf(mark, at + needle.length)
    if (hit !== -1 && hit < end) end = hit
  }
  return clip(source.slice(start + 1, end))
}

/** 证据一句话就够，裁到 80 字以内，超了给省略号 */
function clip(text, max = 80) {
  const one = String(text ?? '').replace(/\s+/g, ' ').trim()
  return one.length <= max ? one : one.slice(0, max - 1) + '…'
}

/** 台账名字里可能并列多个写法（「血河功法残卷·其一／其二」），对账时逐个试 */
function aliasesOf(name) {
  const parts = String(name ?? '')
    .split(/[／/|、·,，;；]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
  return parts.length > 0 ? parts : [String(name ?? '')]
}

function hitsOf(chapters, name) {
  const aliases = aliasesOf(name)
  const out = []
  for (const chapter of chapters) {
    if (aliases.some((alias) => chapter.text.includes(alias))) out.push(chapter)
  }
  return out
}

function evidenceOf(chapter, name) {
  for (const alias of aliasesOf(name)) {
    const sentence = sentenceOf(chapter.text, alias)
    if (sentence !== '') return sentence
  }
  return ''
}

/** 上层的章号可能是数字也可能是标题里的「第9章」；缺章号又缺标题的稿子直接忽略 */
function normalizeChapters(chapters) {
  if (Array.isArray(chapters) === false) return []
  const out = []
  for (const raw of chapters) {
    if (raw === null || typeof raw !== 'object') continue
    const text = typeof raw.text === 'string' ? raw.text : ''
    if (text.trim() === '') continue
    const title = typeof raw.title === 'string' ? raw.title : ''
    const given = typeof raw.chapter === 'number' ? raw.chapter : Number.parseInt(raw.chapter, 10)
    const chapter = Number.isFinite(given) ? given : chapterOf(title)
    if (chapter === null || Number.isFinite(chapter) === false) continue
    out.push({ chapter: Number(chapter), title, text })
  }
  return out.sort((a, b) => a.chapter - b.chapter)
}

function rangeLabel(from, to) {
  return from === to ? `第${from}章` : `第${from}—${to}章`
}

// ── 四、IO 封装 ─────────────────────────────────────────────────────────────

/** 读并解析台账。projectDir 是作品根目录（含 设定/ 那一层）。读不到就返回空结果，不抛。 */
export async function readLedger(projectDir) {
  const empty = { path: '', exists: false, text: '', cutoffChapter: null, items: [], sections: [], bytes: 0 }
  const base = typeof projectDir === 'string' ? projectDir.replace(/[\\/]+$/, '') : ''
  if (base === '') return empty
  const path = await resolveLedgerPath(base)
  if (path === '') return empty
  let text = ''
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return empty
  }
  const parsed = parseLedger(text)
  return {
    path,
    exists: true,
    text,
    cutoffChapter: parsed.cutoffChapter,
    items: parsed.items,
    sections: parsed.sections,
    bytes: Buffer.byteLength(text, 'utf8'),
  }
}

async function resolveLedgerPath(base) {
  for (const name of LEDGER_NAMES) {
    for (const candidate of [join(base, LEDGER_DIR, name), join(base, name)]) {
      if (await isFile(candidate)) return candidate
    }
  }
  // 文件名不按约定来时退一步：设定/（其次根目录）里第一个像台账的 md
  for (const dir of [join(base, LEDGER_DIR), base]) {
    let names = []
    try {
      names = await readdir(dir)
    } catch {
      continue
    }
    const hit = names.find((name) => name.endsWith('.md') && LEDGER_NAME_HINT.test(name))
    if (hit !== undefined) return join(dir, hit)
  }
  return ''
}

async function isFile(path) {
  try {
    const info = await stat(path)
    return info.isFile()
  } catch {
    return false
  }
}

// ── 五、账目体检 ────────────────────────────────────────────────────────────

/**
 * 账目体检。chapters 由上层传入（已读好的正文），避免重复 IO，也让测试能直接喂夹具。
 * chapters = [{ chapter: number, title: string, text: string }]
 * → { findings: Finding[], summary: { items, chapters, unmapped, consumedReused, unregistered } }
 */
export async function ledgerCheck(input = {}) {
  const { projectDir, chapters } = input ?? {}
  const ledger = await readLedger(projectDir)
  const list = normalizeChapters(chapters)
  const known = buildKnown(ledger, list)
  const findings = []
  const summary = { items: ledger.items.length, chapters: list.length, unmapped: 0, consumedReused: 0, unregistered: 0 }
  const add = (level, code, chapter, item, message, evidence) => {
    findings.push({ level, code, chapter: chapter ?? null, item: item ?? '', message, evidence: clip(evidence) })
  }
  // 台账读不到、解析不出、或一条物品都没有时，什么都不报：
  // 这种时候"未登记"对每一件东西都成立，报出来只会刷屏。
  if (list.length === 0 || ledger.exists === false || ledger.items.length === 0) return { findings, summary }

  // 1. 未登记物品：正文里像物品、台账里没有。同名只报首现章，否则同一件东西会在几十章里刷屏。
  const reported = new Set()
  for (const chapter of list) {
    for (const hit of suspectItems(chapter.text, known)) {
      if (reported.has(hit.name) || isTailOf(hit.name, reported)) continue
      reported.add(hit.name)
      summary.unregistered += 1
      add(
        'warn',
        '未登记物品',
        chapter.chapter,
        hit.name,
        `第${chapter.chapter}章出现「${hit.name}」，台账未登记，确认后补进去或判定为误报`,
        hit.sentence,
      )
    }
  }

  // 2/3/4. 逐条台账与正文对账
  for (const item of ledger.items) {
    if (item.firstChapter === null) continue
    const hits = hitsOf(list, item.name)
    if (hits.length === 0) {
      // 只给了前几章时不做"正文没有"的判断——没读到不等于没写
      if (list.some((chapter) => chapter.chapter >= item.firstChapter)) {
        summary.unmapped += 1
        add(
          'info',
          '台账说有正文没有',
          item.firstChapter,
          item.name,
          `台账记「${item.name}」出现在第${item.firstChapter}章，但已读的 ${list.length} 章正文里搜不到这个名字；确认是台账笔误，还是正文漏写了`,
          item.firstSeen,
        )
      }
      continue
    }
    const earliest = hits[0]
    if (earliest.chapter < item.firstChapter) {
      add(
        'warn',
        '首现早于登记',
        earliest.chapter,
        item.name,
        `台账记「${item.name}」首次出现在第${item.firstChapter}章，但第${earliest.chapter}章正文里就有了；把首次出现改成第${earliest.chapter}章，或核对是否改过稿`,
        evidenceOf(earliest, item.name),
      )
    }
    if (item.statusKind === 'consumed' || item.statusKind === 'sold') {
      const later = hits.find((hit) => hit.chapter > item.firstChapter)
      if (later !== undefined) {
        summary.consumedReused += 1
        add(
          'error',
          '已消耗又出现',
          later.chapter,
          item.name,
          `台账记「${item.name}」状态为「${item.status}」（第${item.firstChapter}章），第${later.chapter}章正文里又出现了；若已消耗/出售，后文不该再用；若是笔误请修正台账`,
          evidenceOf(later, item.name),
        )
      }
    }
  }

  // 5. 超出校对截止：截止章之后的内容还没进台账，报一条汇总（名字最多列 8 个）
  if (ledger.cutoffChapter !== null) {
    const ahead = list.filter((chapter) => chapter.chapter > ledger.cutoffChapter)
    const spotted = []
    const spottedNames = new Set()
    for (const chapter of ahead) {
      for (const hit of extractNames(chapter.text, known)) {
        if (spottedNames.has(hit.name) || isTailOf(hit.name, spottedNames)) continue
        spottedNames.add(hit.name)
        spotted.push({ name: hit.name, chapter: chapter.chapter, sentence: hit.sentence })
      }
    }
    if (spotted.length > 0) {
      const names = spotted.slice(0, 8).map((one) => one.name).join('、')
      const tail = spotted.length > 8 ? `${names} 等 ${spotted.length} 个` : names
      const from = ahead[0].chapter
      const to = ahead[ahead.length - 1].chapter
      add(
        'info',
        '超出校对截止',
        from,
        '',
        `台账只校对到第${ledger.cutoffChapter}章，${rangeLabel(from, to)}还没进账：这些章里出现 ${spotted.length} 个疑似物品（${tail}）；把台账补到最新章，或更新头部的「当前校对截止」`,
        spotted[0].sentence,
      )
    }
  }

  // 6. 口径冲突：只查"最明显"的一种——同句里抽取/抽奖/兑换，却用了台账价格表里没有的金额
  const prices = new Set(declaredPrices(ledger.text))
  const priceLabel = [...prices].join(' / ')
  const conflicts = new Set()
  for (const chapter of list) {
    for (const sentence of splitSentences(chapter.text)) {
      if (/抽取|抽奖|兑换/.test(sentence) === false) continue
      if (sentence.includes('蕴灵币') === false) continue
      for (const amount of amountsIn(sentence)) {
        if (prices.has(amount) || conflicts.has(amount)) continue
        conflicts.add(amount)
        add(
          'warn',
          '口径冲突',
          chapter.chapter,
          '',
          `第${chapter.chapter}章这句按 ${amount} 蕴灵币抽取/兑换，但台账「抽取价格」只声明了 ${priceLabel}；改正文金额，或把这档价格补进台账`,
          sentence,
        )
      }
    }
  }

  return { findings, summary }
}

function splitSentences(text) {
  return String(text ?? '')
    .split(/(?<=[。！？；!?;\n])/)
    .map((one) => one.trim())
    .filter((one) => one !== '')
}

/** 「2000枚蕴灵币」「蕴灵币×2000」两种写法都要认 */
function amountsIn(sentence) {
  const out = []
  for (const match of String(sentence ?? '').matchAll(/(\d{1,7})\s*[枚个块]?\s*蕴灵币/g)) out.push(Number(match[1]))
  for (const match of String(sentence ?? '').matchAll(/蕴灵币\s*[×xX*]\s*(\d{1,7})/g)) out.push(Number(match[1]))
  return out
}
