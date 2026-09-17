/**
 * dsh-novel-craft — 「从立项写到完本」的阶段化流水线
 *
 * 为什么要有这一层：
 * 抽卡工作台解决的是"这一段好不好"，但作者真正会卡住的地方是"下一步该干嘛"。
 * 所以把一本书拆成 立项 → 设定 → 人物 → 大纲 → 逐章正文 → 修订 → 完本 七步：
 * 每一步都落成**产物文件**（而不是聊天记录），有文件才算做过，隔几天回来还能接着往下走。
 *
 * 门禁的取向（重要，别把它当成关卡）：
 * - error 只拦"没这个文件后面根本没法干"的事（没有大纲就写正文，纯属浪费模型额度）；
 * - warn 只提示"能往下走、但要回头补"的事（某章不到 800 字、还有批注没处理）；
 * - 作者永远可以显式放行：blocked 只是界面上的一个红灯，不是权限。
 *
 * 与三层产物的关系（见 lib/index.js 顶部）：
 * - 「作者偏好档案.md」是唯一的**口味**输入，写稿阶段只读这一份；
 * - 「证据摘录.md」里的正文原文不进写稿上下文（细则见 README 的"口径说明"）——所以逐章正文阶段只拿到已写章节的
 *   「章号 + 标题 + 字数」摘要，拿不到正文；
 * - 同理，「修订」阶段的产物只能是**修订清单**：看不到原文就不可能重写正文，
 *   硬让模型重写，它只会把自己编的前情当成真的写进去。
 *
 * 本文件刻意不 import 任何兄弟模块（core/text.js、core/plot.js 都不用）：
 * 阶段判定和提示词拼装只需要几个纯函数，自包含才能单独拿假数据写单测，
 * 也避免和并行开发的模块互相牵制。所有 IO 一律"读不到就算没有"，从不抛异常。
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'

/** 阶段 id，顺序即流程顺序。上层做路由/记忆时只该认这个常量。 */
export const STAGE_IDS = ['idea', 'setting', 'cast', 'outline', 'chapter', 'revise', 'finish']

const CHAPTERS_DIR = '章节'
const PEOPLE_DIR = '人物'
/** 一章不到这个字数，基本是占位稿或半成品：只提示，不拦。 */
const MIN_CHAPTER_CHARS = 800

/** 各阶段的产物路径。集中放这里：门禁和阶段表引用同一份，改路径不会漏改一处。 */
const FILE = {
  brief: '设定/立项.md',
  world: '设定/世界观.md',
  ledger: '设定/道具与增益台账.md',
  roster: '人物/主要人物列表.json',
  outline: '大纲.md',
  reviseList: '修订清单.md',
  finishReport: '完本报告.md',
}

/**
 * 每个阶段的 system 前半段都一样：输出纪律 + 本项目铁律。
 * 写成常量而不是七份各抄一遍，是为了保证"档案是唯一口味输入"这条铁律
 * 不会在某个阶段悄悄漏掉——那会让那个阶段开始自创风格。
 */
const SYSTEM_HEAD = [
  '你是中文网文的老责编，也是作者本人的写稿助手：熟悉起点、番茄、七猫这类平台的读者口味与上架节奏，但只为这一本书服务。',
  '',
  '输出纪律（违反就等于白写）：',
  '1. 只输出「产物文件正文」本身：不要开场白、不要寒暄、不要解释你在做什么、不要复述这些要求，也不要写"以下是……"这种过渡句；',
  '2. 不要用 markdown 代码围栏（三个反引号那种）把整份内容包起来，正文直接给；',
  '3. 不要写"我可以继续帮你……"这类收尾；写不满就写短一点，绝不注水。',
  '',
  '本项目铁律（不可违背）：',
  '- 正文原文不进上下文：你手上不会、也不该拿到任何已写正文的原文，已写章节只以「章号 + 标题 + 字数」的摘要形式出现；',
  '- 唯一的口味输入是下面这份《作者偏好档案》里的规律（{profile}）：「已验证偏好」必须做到，「避免的写法」一条都不许犯；',
  '  档案没写到的地方按中文网文的通用手感来，不要自创风格，也不要发明新名词。',
].join('\n')

/** 档案还没建立时喂给模型的话：说清"现在只能靠通用手感"，而不是留一片空白让它乱猜。 */
const PROFILE_EMPTY_HINT =
  '（作者偏好档案还没建立：作者先去工作台标注好/坏段落、蒸馏出规律再写稿；在没有档案之前，只能按中文网文的通用手感写，收敛会慢）'

/**
 * 上游产物的硬需求：缺了就该提醒作者先补，而不是让模型凭空编一份。
 * 判定方式是"上游条目的 label 里包含关键词"（label 由上层按文件类型给，如「人物卡」「分章大纲」）。
 */
const UPSTREAM_NEEDS = {
  idea: [],
  setting: ['立项'],
  cast: ['立项', '世界观'],
  outline: ['人物', '世界观'],
  chapter: ['大纲', '人物'],
  revise: ['大纲'],
  finish: ['大纲'],
}

/** 这些阶段没有偏好档案就别开工：它们直接产出读者要看的文字/判断。 */
const PROFILE_STAGES = new Set(['outline', 'chapter', 'revise'])

/**
 * 拼一个阶段定义。
 * 七份模板里有大量重复块（作品名 / 档案 / 上游 / 额外要求），统一在这里拼：
 * 免得七份各写各的，某个阶段漏掉「作者偏好档案」这一块，模型就看不到口味了。
 * @param {object} spec
 * @returns {{id: string, name: string, order: number, artifacts: object[], produce: string, hint: string, prompt: {system: string, user: string}}}
 */
function makeStage(spec) {
  const chapterBlocks = []
  if (spec.withChapterNumber === true) chapterBlocks.push('【本章章号】{chapter}')
  const chaptersBlocks = []
  if (spec.withChapters === true) {
    chaptersBlocks.push('', '【已写章节（只有章号/标题/字数，正文原文不进上下文）】', '{chapters}')
  }
  const user = [
    `【本阶段】${spec.name}（第 ${spec.order} 步 / 共 ${STAGE_IDS.length} 步）`,
    '【作品】{projectName}',
    `【本阶段产物】${spec.produce}（只写这一份文件的内容）`,
    ...chapterBlocks,
    '',
    '【作者偏好档案（只有规律，没有原文）】',
    '{profile}',
    '',
    '【上游产物（作者已确认的口径，只许沿用，不许另立一套）】',
    '{upstream}',
    ...chaptersBlocks,
    '',
    '【作者本轮额外要求（与上面的默认要求冲突时，以这里为准）】',
    '{extra}',
    '',
    '【交付要求】',
    ...spec.rules.map((rule) => '- ' + rule),
  ].join('\n')

  return {
    id: spec.id,
    name: spec.name,
    order: spec.order,
    artifacts: spec.artifacts,
    produce: spec.produce,
    hint: spec.hint,
    prompt: { system: SYSTEM_HEAD + '\n\n' + spec.system, user },
  }
}

/**
 * 阶段定义表。顺序即流程顺序。
 * 产物路径都相对作品根；`{projectName}` 在 stageStatus / stagePrompt 里换成真书名。
 */
export const STAGES = [
  makeStage({
    id: 'idea',
    name: '立项',
    order: 1,
    artifacts: [{ path: FILE.brief, label: '立项（卖点/平台/字数/读者画像）', minChars: 100 }],
    produce: FILE.brief,
    hint: '一句话卖点 + 目标平台 + 目标字数 + 读者画像，写成一页作战地图',
    system:
      '本阶段你只做立项：把"这本书卖给谁、凭什么留住人、写多长"想清楚，写成作者自己看的作战地图，不写剧情细节、不写正文。',
    rules: [
      '输出结构化 markdown：一级标题 + 分节小标题，需要并列比较的地方用表格或列表（下游按小节读，别写成一大段散文）；',
      '必须写清四件事：一句话卖点、目标平台、目标字数（顺手估出每章字数与总章数）、读者画像（谁会追更、他为什么点进来）；',
      '再补四件：题材标签、核心爽点循环（主角大概每几章拿一次什么）、对标作品 2-3 本（写清对标它的哪一点）、更新节奏与完本难度；',
      '这是给作者自己看的作战地图：不写具体剧情、不写章节安排、更不要写正文片段。',
    ],
  }),
  makeStage({
    id: 'setting',
    name: '设定',
    order: 2,
    artifacts: [
      { path: FILE.world, label: '世界观设定', minChars: 200 },
      // 台账的门槛给得很低：条目够不够是门禁的活（要数表格行），
      // 这里只拦"建了个空文件"——两个检查各管一段，才不会互相打架
      { path: FILE.ledger, label: '道具与增益台账', minChars: 10 },
    ],
    produce: FILE.world,
    hint: '世界观、力量体系、经济口径，先把口径钉死再谈人物',
    system:
      '本阶段你只做设定：把力量体系、境界、经济口径、势力地理写成分节 markdown，能用表格的地方一律用表格；上游已经确认过的口径只能沿用和补充，不许改动，更不许另立一套。',
    rules: [
      '输出结构化 markdown：分节小标题 + 表格；',
      '必须有的小节：力量体系与境界划分（含升级的代价与瓶颈）、灵根/资质这类先天差异、货币与经济口径（一个什么等于几个什么）、势力与地理、金手指或系统的规则与限制、本作禁忌（明确不写什么）；',
      '凡上游台账/设定里已经确认过的口径，只能沿用：正文没出现过的等级、货币、名词一律不许发明（例如原文没有"极品灵石"这一档，就不要补一档）；',
      '每条设定后面用一句话写清"这条会在哪一章被用到"；写不出用途的设定就别写，省得以后自己绊自己；',
      '本阶段产物是设定文件；道具与增益台账若已在上下游给过，只做补充条目，不要重写作者已有的表格。',
    ],
  }),
  makeStage({
    id: 'cast',
    name: '人物',
    order: 3,
    artifacts: [{ path: FILE.roster, label: '主要人物列表', minChars: 2 }],
    produce: FILE.roster,
    hint: '主角、对手、关键配角各一张人物卡，关系要双向对得上',
    system:
      '本阶段你只做人物：输出一份 JSON（不是 markdown、不是解释），字段风格必须和既有的 人物/*.json 一致；人物关系要双向对得上，境界不许超出设定里已有的等级。',
    rules: [
      '只输出 JSON 本体：不要 markdown、不要解释、不要代码围栏；',
      '整体结构：{ "小说名称": "书名", "人物分类": { "分类名": ["姓名", "姓名"] }, "主要人物": [ 人物卡 ] }；',
      '每张人物卡字段与既有 人物/*.json 一致：姓名、身份、境界、灵根、增益、剧情重要性、状态、人物关系（对象：对方姓名 → 关系）、备注；',
      '主要人物给 6-15 个：主角、主要对手、关键配角各就各位；每个人物都要有"想要什么"和"挡谁的路"，只当背景板的人物不要写；',
      '人物关系必须双向对得上（A 的关系里有 B，B 的关系里也要有 A），境界不许超出上游设定里已有的等级。',
    ],
  }),
  makeStage({
    id: 'outline',
    name: '大纲',
    order: 4,
    artifacts: [{ path: FILE.outline, label: '分章大纲', minChars: 100 }],
    produce: FILE.outline,
    hint: '按「## 第N章 标题」分章列目标/冲突/转折/埋/收，要能被程序解析',
    system:
      '本阶段你只做大纲：输出结构化 markdown，章节点必须能被程序解析（## 第N章 标题，下面跟 - 目标：/- 冲突：/- 转折：/- 埋：/- 收：）；每一章都要有事件、有冲突，不许出现"主角修炼了一段时间"这种没有事件的节点。',
    rules: [
      '输出结构化 markdown：可选用「# 第一卷 卷名」分卷；章节点必须写成「## 第N章 标题」，一个字都不要省（下游按这个格式解析）；',
      '每个章节点下面必须有这几行，目标与冲突必填、其余按需：- 目标： / - 冲突： / - 转折： / - 埋： / - 收：；',
      '每一章都要有具体事件：不许出现"主角修炼了一段时间""一路平安无事"这种没有冲突的节点；写不出冲突，说明这章该合并；',
      '前 3 章讲清金手指与第一个爽点；每 10 章左右给一个中高潮，每卷结尾给一个卷级高潮；',
      '章数按立项里的目标字数 ÷ 每章字数估出来，不要写十章就交差。',
    ],
  }),
  makeStage({
    id: 'chapter',
    name: '逐章正文',
    order: 5,
    // 一章一个文件，静态表里列不完：用通配。前面加 * 是为了同时认
    // 逐弈登仙-第8章.txt（书名在前）和 第 8 章 血炼台上.txt（章号在前）两种写法
    artifacts: [{ path: '*第*章*.txt', label: '章节正文（作品根或 章节/ 下的「第N章」文件）', minChars: 1 }],
    // produce 里只用 {chapter} 这一个占位符：路径要由上层拼去落盘，
    // 而"书名"这种占位符上层未必认（它只替换章号），写进去就会落地成一个带花括号的文件名。
    produce: '章节/第{chapter}章.txt',
    hint: '一次写一章正文：接住上一章、兑现本章节点、结尾留钩子',
    withChapterNumber: true,
    withChapters: true,
    system:
      '本阶段你写一章正文（章号在用户消息里）：这是成稿，不是大纲也不是提要；开篇必须接住上一章的结尾，全章必须兑现本章大纲节点，结尾留一个让人想点下一章的钩子。',
    rules: [
      '输出正文本身，一章成稿 2000-4000 字（作者另有要求时以作者为准）；不要小标题、不要分节序号、不要作者旁白；',
      '开篇接住上一章的结尾：上一章发生了什么，只以【上游产物】里的剧情总结/结尾摘录为准；上游没给就先别写，把问题留给作者，绝不允许自己编前情；',
      '全章兑现本章大纲节点：目标要达成或失败得有意义，「埋」要落成具体物件或台词，「收」要给出兑现场面——埋了不收是欠读者的账；',
      '逐条对照《作者偏好档案》里的「避免的写法」，一条都不许犯；「已验证偏好」要在这一章里看得见；',
      '【已写章节】摘要只用来避免撞车（同样的桥段、同样的开场、同样的收尾），不要把摘要复述成正文；',
      '结尾留钩子：最后一两段要给出让人点下一章的理由，但不要写"且听下回分解"这种章末预告。',
    ],
  }),
  makeStage({
    id: 'revise',
    name: '修订',
    order: 6,
    // 修订阶段的产物是清单而不是改好的稿子：正文原文不进上下文，
    // 模型看不到原文就不可能重写；它能做的是"指着批注说出改哪儿、改成什么效果"。
    artifacts: [{ path: FILE.reviseList, label: '修订清单（改哪儿、改成什么效果）', minChars: 100 }],
    produce: FILE.reviseList,
    hint: '把批注和账目问题整理成修订清单，正文不进上下文',
    withChapters: true,
    system:
      '本阶段你做修订诊断：只输出"改哪儿、为什么改、改成什么效果"的清单，不重写正文——正文原文不进上下文，你看不到它，硬写的重写稿只会误导作者。',
    rules: [
      '只输出修订清单（markdown 表格或列表都行），不要重写正文：你手上的只有大纲、剧情总结和读者批注；',
      '每条写清五样：章号、问题类型（账目/人设/节奏/信息差/文风）、证据（哪一处、谁说的）、改法（具体到加什么删什么改什么）、改完的验收标准；',
      '先修会前后矛盾的问题（道具状态、境界、时间线、人物关系），再修观感问题（拖沓、解释过多、爽点不到位）；',
      '同一章的问题合并成一条，别把一个批注抄成十条；最后按优先级排序，标出"必须改 / 建议改"。',
    ],
  }),
  makeStage({
    id: 'finish',
    name: '完本',
    order: 7,
    artifacts: [{ path: '{projectName}.txt', label: '全书合并稿', minChars: 1000 }],
    produce: FILE.finishReport,
    hint: '拼全书合并稿，盘人物弧线与伏笔回收，写完结报告',
    withChapters: true,
    system:
      '本阶段你做完结收尾：只输出清单与提示（人物弧线收束、伏笔回收、账目体检提醒），不要重写任何正文，也不要假装你已经跑过账目体检。',
    rules: [
      '输出结构化 markdown：分节小标题 + 清单；',
      '必须有的小节：人物弧线收束（主角/主要对手/关键配角各自交代清楚没有）、伏笔回收台账（哪些已收、哪些还悬着、悬着的怎么补）、账目体检提醒（哪些道具状态可能对不上，请作者用工作台体检确认）、下一本的钩子与可复用设定；',
      '只做清单和提示：不要重写正文，也不要写"经体检无异常"——体检是工作台的事，你没跑过；',
      '全书合并稿 {projectName}.txt 由工作台把各章按顺序机械拼接，不用你写；',
      '如果这本书其实还没写完（缺章、关键伏笔没落），在报告开头直接写清，不要粉饰。',
    ],
  }),
]

// ---------------------------------------------------------------------------
// 纯文本工具：只保留这个模块真正用到的几个
// ---------------------------------------------------------------------------

/** 中文字数：去掉所有空白后的字符数。作者关心的是字，不是字节。 */
function charCount(text) {
  return String(text).replace(/\s/g, '').length
}

/** 读文本；文件不存在或读不了都返回 ''（调用方不必 try/catch——"读不到就算没有"）。 */
async function readText(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

/** 文件情况：不存在一律 {exists:false, bytes:0, mtime:''}；目录也算不存在。 */
async function statSafe(path) {
  try {
    const info = await stat(path)
    if (!info.isFile()) return { exists: false, bytes: 0, mtime: '' }
    return { exists: true, bytes: info.size, mtime: info.mtime.toISOString() }
  } catch {
    return { exists: false, bytes: 0, mtime: '' }
  }
}

/** 列目录；目录不存在就是没有产物，交给门禁去说。 */
async function listNames(dir) {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

/** 读文本的缓存：一次 stageStatus 里同一个文件常常被产物检查和门禁各读一遍。 */
function makeReader() {
  const cache = new Map()
  return (path) => {
    if (!cache.has(path)) cache.set(path, readText(path))
    return cache.get(path)
  }
}

/** JSON 解析：坏文件返回 null（不抛）。 */
function parseJsonSafe(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const CN_DIGITS = { 〇: 0, 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const CN_UNITS = { 十: 10, 百: 100, 千: 1000 }

/** 中文数字 → 阿拉伯数字（够章号用；万位以上不认，网文不会有）。 */
function cnToNumber(raw) {
  const s = String(raw ?? '').trim()
  if (s === '') return null
  if (/^\d+$/.test(s)) return Number(s)
  let section = 0
  let digit = 0
  let seen = false
  for (const ch of s) {
    if (CN_DIGITS[ch] !== undefined) {
      digit = CN_DIGITS[ch]
      seen = true
      continue
    }
    const unit = CN_UNITS[ch]
    if (unit === undefined) return null
    seen = true
    // 「十二」这种省了前面的"一"：digit 为 0 时按 1 计
    section += (digit === 0 ? 1 : digit) * unit
    digit = 0
  }
  return seen ? section + digit : null
}

/**
 * 从文件名里取章号：逐弈登仙-第8章.txt → 8；第 8 章 血炼台上.txt → 8；第一章.md → 1。
 * 全书合并稿（逐弈登仙.txt）取不到章号，返回 null——这点很关键，
 * 否则合并稿会被当成"多出来的一章"混进已写章节，缺章检查就失效了。
 */
function chapterNumberOf(name) {
  const base = String(name).replace(/\.[^.]+$/, '')
  const matched = /第\s*([0-9〇零一二三四五六七八九十百千两]+)\s*章/.exec(base)
  if (matched === null) return null
  const chapter = cnToNumber(matched[1])
  // 「第〇章」这类解析成 0 的不算章：章号从 1 开始，0 号只会在统计里添乱
  return chapter !== null && chapter >= 1 ? chapter : null
}

/** 章号列表 → 「第 1-3、7、9-11 章」：门禁提示要短，几十章不能一行铺开。 */
function fmtChapters(nums) {
  const list = [...new Set((Array.isArray(nums) ? nums : []).map(Number).filter((n) => Number.isFinite(n)))].sort(
    (a, b) => a - b,
  )
  if (list.length === 0) return '（无）'
  const parts = []
  let start = list[0]
  let prev = list[0]
  for (let i = 1; i <= list.length; i += 1) {
    const next = list[i]
    if (next !== undefined && next === prev + 1) {
      prev = next
      continue
    }
    parts.push(start === prev ? String(start) : start + '-' + prev)
    if (next === undefined) break
    start = next
    prev = next
  }
  return `第 ${parts.join('、')} 章`
}

/**
 * 台账里"至少 1 个物品条目"的粗判：数 markdown 表格行（| … |），|----| 分隔行不算。
 * 故意粗：这里只是提醒作者"台账是空的"，不是校验账目对不对——那是体检的活。
 */
function countTableRows(text) {
  let rows = 0
  for (const raw of String(text).split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('|') || !line.endsWith('|')) continue
    if (/^\|[\s:|-]+\|$/.test(line)) continue
    rows += 1
  }
  return rows
}

// ---------------------------------------------------------------------------
// 大纲解析（简化版，只够门禁和提示词用）
// ---------------------------------------------------------------------------

/** 字段别名：作者和下层的写法五花八门，能认的都认。 */
const FIELD_ALIASES = {
  goal: ['目标', '本章目标', '章节目标', 'goal'],
  conflict: ['冲突', '本章冲突', '矛盾', 'conflict'],
  turn: ['转折', '反转', 'turn'],
  plant: ['埋', '埋点', '埋伏', '伏笔', 'plant'],
  payoff: ['收', '回收', '收回', '兑现', 'payoff'],
}
const FIELD_OF = Object.fromEntries(
  Object.entries(FIELD_ALIASES).flatMap(([key, names]) => names.map((name) => [name, key])),
)

/** 节点标题行：`## 第3章 开局就要见血` / `### 第 3 章：开局`（`*` 和 `_` 是加粗残留）。 */
function parseNodeHeading(raw) {
  const text = String(raw).replace(/^[\s*_]+/, '').trim()
  const matched = /^第\s*([0-9〇零一二三四五六七八九十百千两]+)\s*章\s*([\s\S]*)$/.exec(text)
  if (matched === null) return null
  const chapter = cnToNumber(matched[1])
  // 章号从 1 开始：「第〇章」这种解析成 0 的标题不是章节点，当作普通标题放过
  if (chapter === null || chapter < 1) return null
  const title = matched[2].replace(/^[\s:：、.．\-—－)）】\]]+/, '').replace(/[\s:：]+$/, '').trim()
  return { chapter, title, goal: '', conflict: '', turn: '', plant: '', payoff: '' }
}

/** 字段行：`- 目标：x` / `**冲突**：x` / `埋（伏笔）: x`；认不出名字的行直接忽略。 */
function parseFieldLine(line) {
  const matched = /^\s*(?:[-*+]\s+)?\**\s*([^：:\n]{1,12}?)\s*\**\s*[:：]\s*(\S[\s\S]*)$/.exec(line)
  if (matched === null) return null
  const name = matched[1]
    .replace(/[（(][^）)]*[)）]/g, '')
    .replace(/\s+/g, '')
    .trim()
  const key = FIELD_OF[name]
  if (key === undefined) return null
  return { key, value: matched[2].trim() }
}

/**
 * 大纲 markdown → 章节点数组（够门禁用，不是完整的情节体检）。
 *
 * 认这种写法：
 *   ## 第3章 开局就要见血
 *   - 目标：……
 *   - 冲突：……
 * 也认另一种：### 第 3 章 开局 + **目标**：……（无短横、字段加粗、中英文字段名都行）。
 * 同一字段写多行按「；」合并——一章常埋两条伏笔，只留最后一条会丢信息。
 * 解析不出来就是空数组，由门禁翻译成给作者看的话。
 * @param {string} text
 * @returns {{chapter: number, title: string, goal: string, conflict: string, turn: string, plant: string, payoff: string}[]}
 */
export function parseOutlineNodes(text) {
  const nodes = []
  let cur = null
  const flush = () => {
    if (cur !== null) nodes.push(cur)
    cur = null
  }
  for (const line of String(text ?? '').replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^\s{0,3}#{1,6}\s*([\s\S]*)$/.exec(line)
    if (heading !== null) {
      // 任何标题都会结束上一个节点：卷名、前言、附录一样会打断
      flush()
      cur = parseNodeHeading(heading[1])
      continue
    }
    if (cur === null) continue
    const field = parseFieldLine(line)
    if (field === null) continue
    cur[field.key] = cur[field.key] === '' ? field.value : cur[field.key] + '；' + field.value
  }
  flush()
  return nodes
}

/**
 * 粗算"哪些章真的有正文"。
 * 纯函数：刻意不碰磁盘——上层已经把正文读好了，这里再扫一遍既要处理两种命名布局、
 * 又可能和上层给的 chapters 打架。磁盘上的章节文件由 stageStatus 自己扫。
 * @param {string} projectDir 只为签名对称保留，这里不使用
 * @param {{chapter: number|string, title?: string, text?: string}[]} chapters
 * @returns {number[]} 章号升序去重
 */
export function chapterTextsPresent(projectDir, chapters) {
  return [...new Set(normalizeChapters(chapters).map((c) => c.chapter))]
}

/**
 * 只认"真的有正文"的章：一个字都没有的章等于没写（上层可能把还没写的章也传进来占位）。
 * 字数两种给法都认：
 * - 传 text：自己数（正文原文不进上下文，数完就只留数字）；
 * - 只传 chars：上层已经读过了、算好了字数，那就直接用，不必为了一行数字再传一遍原文。
 * 章号必须 ≥1：JSON 里的 null、'序章' 这类值转成数字是 0 / NaN，都不是章。
 */
function normalizeChapters(chapters) {
  return (Array.isArray(chapters) ? chapters : [])
    .filter((c) => c !== null && typeof c === 'object')
    .map((c) => {
      const text = String(c.text ?? '')
      const fromText = charCount(text)
      const declared = Number(c.chars)
      return {
        chapter: Number(c.chapter),
        title: String(c.title ?? '').trim(),
        text,
        chars: fromText > 0 ? fromText : Number.isFinite(declared) && declared > 0 ? Math.round(declared) : 0,
      }
    })
    .filter((c) => Number.isFinite(c.chapter) && c.chapter >= 1 && c.chars > 0)
    .sort((a, b) => a.chapter - b.chapter)
}

// ---------------------------------------------------------------------------
// 产物检查
// ---------------------------------------------------------------------------

/** 产物路径可能带通配符：`第*章*.txt` 一章一个文件，静态表里列不完。 */
function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 找一份产物。不带 '*' 就是普通文件；带 '*' 就在目录里按通配找，
 * 不带目录的通配（正文）在作品根和 章节/ 下都找一遍——
 * 作者两种命名习惯都有（根的 逐弈登仙-第8章.txt、章节/第 8 章 血炼台上.txt），
 * 只认一种会把另一种布局误判成"没写"。
 */
async function matchArtifact(projectDir, pattern) {
  if (!pattern.includes('*')) {
    const path = join(projectDir, pattern)
    const info = await statSafe(path)
    return { exists: info.exists, bytes: info.bytes, files: info.exists ? [path] : [] }
  }
  const cut = pattern.lastIndexOf('/')
  const head = cut === -1 ? '' : pattern.slice(0, cut)
  const wildcard = cut === -1 ? pattern : pattern.slice(cut + 1)
  const dirs = head === '' ? [projectDir, join(projectDir, CHAPTERS_DIR)] : [join(projectDir, head)]
  const re = new RegExp('^' + wildcard.split('*').map(escapeRe).join('[^/]*') + '$')
  const files = []
  let bytes = 0
  for (const dir of dirs) {
    for (const name of await listNames(dir)) {
      if (!re.test(name)) continue
      const path = join(dir, name)
      const info = await statSafe(path)
      if (!info.exists) continue
      files.push(path)
      bytes += info.bytes
    }
  }
  return { exists: files.length > 0, bytes, files }
}

/**
 * 一份产物的落地情况。
 * path 里的 {projectName} 在这里换成真书名，返回的 path 也是换好的——界面拿到就能直接开文件。
 */
async function artifactState(projectDir, artifact, projectName) {
  const pattern = String(artifact.path).replace(/\{projectName\}/g, projectName)
  const found = await matchArtifact(projectDir, pattern)
  const minChars = Number(artifact.minChars) || 0
  // 门槛是"字"不是"字节"：中文一个字 3 字节，拿字节比等于把门槛放水三倍，
  // 所以 bytes 只给界面显示，判定必须真数一遍字数。
  let chars = 0
  if (found.exists) {
    for (const file of found.files) chars += charCount(await readText(file))
  }
  return {
    path: pattern,
    label: artifact.label,
    exists: found.exists,
    bytes: found.bytes,
    minChars,
    ok: found.exists && chars >= minChars,
  }
}

/**
 * 扫"已写正文"。只认两处，都不递归：
 * - 作品根：逐弈登仙-第N章.txt（作者的主力命名）；
 * - 章节/：第 N 章 标题.txt。
 * 不递归是故意的：归档/ 里是旧稿，扫进来会让"已写章节"虚胖，缺章检查也就失效了。
 */
async function scanChapterFiles(projectDir) {
  const found = new Map()
  if (projectDir === '') return found
  for (const dir of [projectDir, join(projectDir, CHAPTERS_DIR)]) {
    for (const name of await listNames(dir)) {
      if (extname(name).toLowerCase() !== '.txt') continue
      const chapter = chapterNumberOf(name)
      if (chapter === null) continue
      const path = join(dir, name)
      const info = await statSafe(path)
      if (!info.exists) continue
      const prev = found.get(chapter)
      // 同一章有两份（根目录一份、章节/ 一份）：留大的，作者可能正在迁目录
      if (prev === undefined || info.bytes > prev.bytes) {
        found.set(chapter, { chapter, path, bytes: info.bytes, mtime: info.mtime })
      }
    }
  }
  return found
}

/** 合并"上层读好的正文"和"磁盘上的章节文件"，得到每章的字数，供短章检查用。 */
async function chapterInfoOf(chapters, disk) {
  const info = new Map()
  for (const chapter of normalizeChapters(chapters)) {
    info.set(chapter.chapter, { chapter: chapter.chapter, title: chapter.title, chars: chapter.chars, path: '' })
  }
  for (const [chapter, file] of disk) {
    const prev = info.get(chapter)
    if (prev !== undefined) {
      prev.path = file.path
      continue
    }
    // 上层只读了部分章（比如只读最近几章）：剩下这些自己读一遍数字数，别让短章检查漏掉
    info.set(chapter, { chapter, title: '', chars: charCount(await readText(file.path)), path: file.path })
  }
  return info
}

// ---------------------------------------------------------------------------
// 门禁
// ---------------------------------------------------------------------------

async function gateIdea(ctx) {
  const chars = charCount(await ctx.reader(join(ctx.projectDir, FILE.brief)))
  const ok = chars >= 100
  return [
    {
      code: 'idea-brief',
      ok,
      level: 'error',
      message: ok ? `立项已就绪（${chars} 字）` : '先写立项：一句话卖点、目标平台、目标字数、读者画像',
    },
  ]
}

async function gateSetting(ctx) {
  const world = await statSafe(join(ctx.projectDir, FILE.world))
  const ledger = await statSafe(join(ctx.projectDir, FILE.ledger))
  const items = countTableRows(await ctx.reader(join(ctx.projectDir, FILE.ledger)))
  return [
    {
      code: 'setting-world',
      ok: world.exists,
      level: 'error',
      message: world.exists ? '世界观已落地' : '还缺 设定/世界观.md：先把力量体系与境界定下来，再谈人物和大纲',
    },
    {
      code: 'setting-ledger',
      ok: ledger.exists,
      level: 'error',
      message: ledger.exists ? '道具与增益台账已落地' : '还缺 设定/道具与增益台账.md：正文里出现的道具和增益要有账可查',
    },
    {
      code: 'setting-ledger-item',
      ok: items >= 1,
      level: 'error',
      message:
        items >= 1
          ? `台账里已有 ${items} 行表格记录`
          : '台账里还没有物品条目：用 | 表格记下已出现的道具/增益，并写清状态（持有/已消耗/已出售）',
    },
  ]
}

async function gateCast(ctx) {
  const rosterText = await ctx.reader(join(ctx.projectDir, FILE.roster))
  const roster = parseJsonSafe(rosterText)
  const rosterOk = roster !== null && typeof roster === 'object'
  const cards = (await listNames(join(ctx.projectDir, PEOPLE_DIR))).filter((n) => extname(n).toLowerCase() === '.json')
  return [
    {
      code: 'cast-roster',
      ok: rosterOk,
      level: 'error',
      message: rosterOk ? '主要人物列表是合法 JSON' : '人物/主要人物列表.json 不存在或不是合法 JSON 数组/对象：先给这本书一张人物名单',
    },
    {
      code: 'cast-cards',
      ok: cards.length >= 3,
      level: 'error',
      message:
        cards.length >= 3
          ? `人物卡片已有 ${cards.length} 张`
          : `人物/*.json 只有 ${cards.length} 张（至少 3 张）：主角、对手、关键配角各给一张卡片`,
    },
  ]
}

async function gateOutline(ctx) {
  const text = await ctx.reader(join(ctx.projectDir, FILE.outline))
  const fileOk = (await statSafe(join(ctx.projectDir, FILE.outline))).exists
  const nodes = parseOutlineNodes(text)
  const noEvent = nodes.filter((n) => n.goal.trim() === '' && n.conflict.trim() === '')
  return [
    {
      code: 'outline-file',
      ok: fileOk,
      level: 'error',
      message: fileOk ? '大纲已落地' : '还没有 大纲.md：分章节点写成「## 第N章 标题」',
    },
    {
      code: 'outline-node',
      ok: nodes.length >= 1,
      level: 'error',
      message:
        nodes.length >= 1
          ? `大纲里解析出 ${nodes.length} 个章节点`
          : '大纲里没解析出章节点：每个节点写成「## 第N章 标题」，字段用「- 目标：」这种行',
    },
    {
      code: 'outline-node-fields',
      ok: noEvent.length === 0,
      level: 'error',
      message:
        noEvent.length === 0
          ? '每个章节点都有目标或冲突'
          : `这些章节点既没写目标也没写冲突：${fmtChapters(noEvent.map((n) => n.chapter))}——这章要干什么都说不清，写正文只会注水`,
    },
  ]
}

async function gateChapter(ctx) {
  const written = [...ctx.chapterInfo.keys()].sort((a, b) => a - b)
  const short = written.filter((n) => ctx.chapterInfo.get(n).chars < MIN_CHAPTER_CHARS)
  return [
    {
      code: 'chapter-has-text',
      ok: written.length >= 1,
      level: 'error',
      message:
        written.length >= 1
          ? `已写 ${written.length} 章：${fmtChapters(written)}`
          : '还没有任何正文：先把第 1 章写出来（作品根或 章节/ 目录下带「第N章」的 .txt 都认）',
    },
    {
      code: 'chapter-short',
      ok: short.length === 0,
      level: 'warn',
      message:
        short.length === 0
          ? `已写章节都在 ${MIN_CHAPTER_CHARS} 字以上`
          : `这些章不到 ${MIN_CHAPTER_CHARS} 字：${fmtChapters(short)}（大概是占位或半成品，别急着往下写）`,
    },
  ]
}

async function gateRevise(ctx) {
  const open = ctx.annotations.filter((a) => a !== null && typeof a === 'object' && a.status === 'open')
  const chapters = [...new Set(open.map((a) => Number(a.chapter)).filter((n) => Number.isFinite(n)))].sort((a, b) => a - b)
  const ok = open.length === 0
  return [
    {
      code: 'revise-open',
      ok,
      level: 'warn',
      message: ok
        ? ctx.annotations.length === 0
          ? '没读到批注数据（没有批注就没有要修的；先去工作台给这一轮打批注）'
          : '批注都处理完了'
        : `还有 ${open.length} 条批注没处理：${fmtChapters(chapters)}`,
    },
  ]
}

async function gateFinish(ctx) {
  const merged = ctx.projectName === '' ? { exists: false } : await statSafe(join(ctx.projectDir, ctx.projectName + '.txt'))
  const written = [...ctx.chapterInfo.keys()].sort((a, b) => a - b)
  const max = written.length === 0 ? 0 : written[written.length - 1]
  const missing = []
  for (let n = 1; n <= max; n += 1) {
    if (!ctx.chapterInfo.has(n)) missing.push(n)
  }

  // 体检信号：只做提示，不重新体检（账目对不对、伏笔收没收，是体检模块的活）
  const signals = []
  const openAnnotations = ctx.annotations.filter((a) => a !== null && typeof a === 'object' && a.status === 'open').length
  if (openAnnotations > 0) signals.push(`还有 ${openAnnotations} 条批注没处理`)
  if (ctx.ledgerMtime !== '' && ctx.newestChapterMtime !== '' && ctx.ledgerMtime < ctx.newestChapterMtime) {
    signals.push('道具与增益台账比最新一章正文还旧，可能没跟上')
  }

  return [
    {
      code: 'finish-merged',
      ok: merged.exists === true,
      level: 'error',
      message:
        merged.exists === true
          ? `${ctx.projectName}.txt 已就绪`
          : `还没有全书合并稿 ${ctx.projectName}.txt：完本前把各章按顺序拼成一个文件（作者的真实作品里就是这种合并稿）`,
    },
    {
      code: 'finish-chapter-gap',
      ok: written.length > 0 && missing.length === 0,
      level: 'warn',
      message:
        written.length === 0
          ? '一章正文都没读到，无法判断有没有缺章'
          : missing.length === 0
            ? `正文从第 1 章连到第 ${max} 章`
            : `还有章节缺正文：${fmtChapters(missing)}`,
    },
    {
      code: 'finish-health',
      ok: signals.length === 0,
      level: 'warn',
      message:
        signals.length === 0
          ? '没看到账目/伏笔过期的信号（这里只做提示，不重新体检；完本前仍建议跑一次体检）'
          : `完本前先处理：${signals.join('；')}——伏笔与账目体检请用工作台的体检功能，这里只做提示`,
    },
  ]
}

const GATES = {
  idea: gateIdea,
  setting: gateSetting,
  cast: gateCast,
  outline: gateOutline,
  chapter: gateChapter,
  revise: gateRevise,
  finish: gateFinish,
}

/** 阶段相对作品根的整体状态：给界面一句话说明"这一步现在什么情况"。 */
function noteOf(artifacts, gate, complete) {
  const failed = (level) => gate.find((g) => g.level === level && !g.ok)
  const error = failed('error')
  if (error !== undefined) return '这一步没做完：' + error.message
  const warn = failed('warn')
  if (warn !== undefined) return '可以往下走，但先看一眼：' + warn.message
  if (complete) return '产物齐了，可以进入下一步'
  return '还差产物：' + artifacts.filter((a) => !a.ok).map((a) => a.label).join('、')
}

/**
 * 阶段状态 + 门禁。
 * @param {object} input
 * @param {string} input.projectDir 作品根（含 设定/、人物/、正文 txt 的那一层）
 * @param {{chapter: number|string, title?: string, text?: string}[]} [input.chapters] 上层已读好的正文
 * @param {{chapter: number|string, status: 'open'|'resolved'|'ignored'}[]} [input.annotations] 批注（修订阶段用）
 * @returns {Promise<{stages: object[], current: string|null, done: number, total: number}>}
 */
export async function stageStatus(input = {}) {
  const projectDir = typeof input?.projectDir === 'string' ? input.projectDir : ''
  const chapters = Array.isArray(input?.chapters) ? input.chapters : []
  const annotations = Array.isArray(input?.annotations) ? input.annotations : []
  // 书名就是目录名：作者的真实作品目录是 逐弈登仙/，合并稿是 逐弈登仙.txt
  const projectName = projectDir === '' ? '' : basename(projectDir.replace(/[/\\]+$/, ''))

  const reader = makeReader()
  const disk = await scanChapterFiles(projectDir)
  const chapterInfo = await chapterInfoOf(chapters, disk)
  let newestChapterMtime = ''
  for (const file of disk.values()) {
    if (file.mtime > newestChapterMtime) newestChapterMtime = file.mtime
  }
  const ledger = await statSafe(join(projectDir, FILE.ledger))

  const ctx = {
    projectDir,
    projectName,
    reader,
    annotations,
    chapterInfo,
    ledgerMtime: ledger.exists ? ledger.mtime : '',
    newestChapterMtime,
  }

  const stages = []
  for (const stage of STAGES) {
    const artifacts = []
    for (const artifact of stage.artifacts) {
      artifacts.push(await artifactState(projectDir, artifact, projectName))
    }
    const gate = await GATES[stage.id](ctx)
    // 门禁有 error 没通过就不算做完——但仍然把产物情况原样报出去，
    // 界面要能同时显示"差哪个文件"和"哪条门禁没过"。
    const blocked = gate.some((g) => g.level === 'error' && !g.ok)
    const complete = artifacts.every((a) => a.ok) && !blocked
    stages.push({
      id: stage.id,
      name: stage.name,
      order: stage.order,
      artifacts,
      complete,
      gate,
      blocked,
      note: noteOf(artifacts, gate, complete),
    })
  }

  const done = stages.filter((s) => s.complete).length
  const current = stages.find((s) => !s.complete)?.id ?? null
  return { stages, current, done, total: STAGES.length }
}

// ---------------------------------------------------------------------------
// 起草提示词
// ---------------------------------------------------------------------------

/**
 * 填占位符。分两遍是有意的：
 * 1. 先把模板里**不认识**的 {xxx} 抹掉——名字拼错时，不该把 {upstram} 原样喂给模型
 *    （认得的占位符就是 values 的键）；
 * 2. 再一次性替换认得的占位符。用函数式 replace，替换进去的正文不会被二次扫描，
 *    否则上游产物里只要出现 "{extra}" 这种字眼，就会被再塞一遍作者要求。
 */
function fillTemplate(template, values) {
  const cleaned = String(template).replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (raw, key) => (key in values ? raw : ''))
  return cleaned.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (raw, key) => (key in values ? String(values[key]) : raw))
}

/** 只留"真有内容"的上游条目：占位的空条目等于没给，不该被当成"已提供"。 */
function upstreamItems(upstream) {
  return (Array.isArray(upstream) ? upstream : []).filter(
    (item) => item !== null && typeof item === 'object' && String(item.text ?? '').trim() !== '',
  )
}

/** 上游产物拼块：每个条目都已被上层截断过，这里只管排版。 */
function upstreamBlock(upstream) {
  const list = upstreamItems(upstream)
  if (list.length === 0) {
    return '（上游产物是空的：先回上一步补齐，不要凭空编世界观、人物和前情）'
  }
  return list.map((item) => `### ${String(item.label ?? '上游产物')}\n${String(item.text).trim()}`).join('\n\n')
}

/**
 * 已写章节摘要：只有章号 + 标题 + 字数，**永远不带正文**。
 * 标题也不从正文首行去猜——首行很可能是正文的第一句，猜标题就等于把原文带进上下文了。
 */
function chaptersSummary(chapters) {
  const list = normalizeChapters(chapters)
  if (list.length === 0) return '（还没有已写章节：这可能是第 1 章，不要假设前文存在）'
  return list.map((c) => `- 第${c.chapter}章${c.title === '' ? '' : ' ' + c.title}（约 ${c.chars} 字）`).join('\n')
}

/**
 * 本该有但现在没有的上游输入。
 * 上层拿到就能提醒作者"先去补人物卡"，而不是让模型凭空编一套人物出来。
 */
function missingInputs(stage, ctx) {
  const missing = []
  const items = upstreamItems(ctx.upstream)
  for (const need of UPSTREAM_NEEDS[stage.id] ?? []) {
    if (!items.some((item) => String(item.label ?? '').includes(need))) missing.push(need)
  }
  if (PROFILE_STAGES.has(stage.id) && ctx.profile === '') missing.push('作者偏好档案')
  if (stage.id === 'chapter') {
    if (ctx.chapter === null) {
      missing.push('章号')
    } else if (ctx.chapter > 1) {
      // 正文原文不进上下文，所以"上一章发生了什么"必须由上游给（剧情总结/结尾摘录），
      // 给不了就该提醒作者补，而不是让模型自由发挥前情。
      const prev = String(ctx.chapter - 1)
      const hasPrev = items.some(
        (item) => String(item.label ?? '').includes('第' + prev + '章') || /剧情|总结|上一章|上一节|前情|回顾/.test(String(item.label ?? '')),
      )
      if (!hasPrev) missing.push(`第${prev}章的剧情总结（接上一章结尾用，正文原文不进上下文）`)
    }
  }
  return missing
}

/**
 * 起草提示词：把模板占位符填成真实内容。
 * @param {string} stageId
 * @param {object} [context]
 * @param {string} [context.projectName]
 * @param {string} [context.profile] 《作者偏好档案.md》正文（只有规律，没有原文）
 * @param {{label: string, text: string}[]} [context.upstream] 上游产物（上层已截断）
 * @param {{chapter: number|string, title?: string, text?: string}[]} [context.chapters] 已写正文（只用标题和字数）
 * @param {number|null} [context.chapter] 当前章号（逐章正文阶段）
 * @param {string} [context.extra] 作者本轮的额外要求
 * @returns {{system: string, user: string, missing: string[]}}
 */
export function stagePrompt(stageId, context = {}) {
  const stage = STAGES.find((s) => s.id === stageId)
  if (stage === undefined) {
    // 旧版前端可能还在传已经改名的阶段 id：不抛异常，返回空提示 + 说明，让上层能提示作者升级
    return { system: '', user: '', missing: ['未知阶段：' + String(stageId)] }
  }
  const raw = context !== null && typeof context === 'object' ? context : {}
  const chapterNumber = Number(raw.chapter)
  const ctx = {
    projectName: String(raw.projectName ?? '').trim(),
    profile: String(raw.profile ?? '').trim(),
    upstream: raw.upstream,
    chapters: raw.chapters,
    chapter: Number.isFinite(chapterNumber) && chapterNumber > 0 ? chapterNumber : null,
    extra: String(raw.extra ?? '').trim(),
  }
  const values = {
    projectName: ctx.projectName === '' ? '（未命名作品）' : ctx.projectName,
    // 档案为空就明说，而不是留一片空白让模型以为"没有要求"
    profile: ctx.profile === '' ? PROFILE_EMPTY_HINT : ctx.profile,
    upstream: upstreamBlock(ctx.upstream),
    chapters: chaptersSummary(ctx.chapters),
    chapter: ctx.chapter === null ? '（待定）' : String(ctx.chapter),
    extra: ctx.extra === '' ? '（作者本轮没有额外要求）' : ctx.extra,
  }
  return {
    system: fillTemplate(stage.prompt.system, values),
    user: fillTemplate(stage.prompt.user, values),
    missing: missingInputs(stage, ctx),
  }
}
