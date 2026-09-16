/**
 * dsh-novel-craft 情节体检（lib/core/plot.js）单元测试
 *
 * 全部素材自造：临时目录 + 内存里的假书，不依赖作者本机任何真实路径。
 * 末尾另有一个「真实数据只读回放」用例：本机有那部作品就读来跑一遍（只读、只打印
 * 触发了哪些 code），没有就打印跳过，不算失败。
 *
 * 跑法：node test/plot.test.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  parseOutline,
  parseSummaries,
  estimateTension,
  buildTensionSeries,
  foreshadowDebts,
  detectPlotIssues,
  readTextFile,
} from '../lib/core/plot.js'

let failures = 0
const ok = (name, cond, detail) => {
  if (cond) {
    console.log(`  ✅ ${name}`)
  } else {
    failures += 1
    console.log(`  ❌ ${name}${detail === undefined ? '' : ' → ' + detail}`)
  }
}
const eq = (name, actual, expected) => {
  try {
    assert.deepEqual(actual, expected)
    console.log(`  ✅ ${name}`)
  } catch {
    failures += 1
    console.log(`  ❌ ${name} → 实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`)
  }
}
const head = (name) => console.log(`\n【${name}】`)

// ── 假书的通用零件 ───────────────────────────────────────────────────────
/** 有冲突、有对话、有转折、章末有钩子的「有事」章节 */
const DENSE = '宁陈拔剑斩出，血光爆开，妖兽扑来。他突然问道：“你到底是谁？”苏清鸢却答不上来。'
/** 只有对话和一个小转弯的「过场」章节 */
const MEDIUM = '宁陈看着苏清鸢，轻声说道：“先歇一晚，明日再走。”她却突然摇头，说出了另一个打算。'
/** 什么都没发生的「平缓」章节 */
const CALM = '宁陈坐在窗前看着云海，苏清鸢在旁整理行囊。天色渐晚，屋里只余风声。'
const repeat = (sentence, times) => Array.from({ length: times }, () => sentence).join('')
const chapterText = (chapter, title, body) => `第${chapter}章 ${title}\n\n${body}`

// ── 一、大纲解析（两种写法都要认） ────────────────────────────────────────
head('大纲解析')
{
  const sectioned = `# 逐弈登仙 · 分章大纲

## 第1章 血炼台上
- 目标：宁陈在血炼台醒来，激活系统
- 冲突：高可儿被龙日天逼问
- 转折：龙日天现身
- 埋：青云令的来历
- 埋：龙日天的真实身份

## 第2章 拜师青云
- 目标：宁陈拜入青云宗
- 冲突：入门试炼刁难
- 转折：掌门收徒
- 收：青云令的来历

## 第3章 望舒城
- 埋：云苍山君的身份
  - 妖兽作乱的原因
  - 苏清鸢知道的旧路
`
  const parsed = parseOutline(sectioned)
  eq('小节式：认出两章', parsed.chapters.map((n) => n.chapter), [1, 2, 3])
  eq('小节式：标题、目标、冲突、转折各归其位', [parsed.chapters[0].title, parsed.chapters[0].goal, parsed.chapters[0].conflict, parsed.chapters[0].turn], ['血炼台上', '宁陈在血炼台醒来，激活系统', '高可儿被龙日天逼问', '龙日天现身'])
  eq('小节式：多条「埋」都收进来', parsed.chapters[0].plant, ['青云令的来历', '龙日天的真实身份'])
  eq('小节式：认「收」为兑现', parsed.chapters[1].payoff, ['青云令的来历'])
  eq('小节式：缩进的子项各算一条埋点', parsed.chapters[2].plant, ['云苍山君的身份', '妖兽作乱的原因', '苏清鸢知道的旧路'])
  ok('小节式：raw 保留了原文', parsed.chapters[0].raw.includes('龙日天现身'))

  const table = `## 分章大纲

| 章 | 标题 | 目标 | 冲突 | 转折 | 埋 | 收 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 血炼台上 | 宁陈在血炼台醒来 | 高可儿被逼问 | 龙日天现身 | 青云令 | — |
| 2 | 拜师青云 | 宁陈拜入青云宗 | 入门试炼 | 掌门收徒 | 龙日天的身份 | 青云令 |

| 3 | 望舒城 | 进城淘货 | 当铺压价 | 二十万成交 |
`
  const fromTable = parseOutline(table)
  eq('表格式：带表头时按表头认列', fromTable.chapters.map((n) => n.chapter), [1, 2, 3])
  eq('表格式：目标列', fromTable.chapters[0].goal, '宁陈在血炼台醒来')
  eq('表格式：埋/收列', [fromTable.chapters[0].plant, fromTable.chapters[1].payoff], [['青云令'], ['青云令']])
  ok('表格式：空占位「—」不当成条目', fromTable.chapters[0].payoff.length === 0)
  eq('表格式：无表头时按位置认列（章/标题/目标/冲突/转折）', [fromTable.chapters[2].title, fromTable.chapters[2].goal, fromTable.chapters[2].turn], ['望舒城', '进城淘货', '二十万成交'])

  const fieldHeadings = `## 第4章 猎妖
### 目标
宁陈进山救人
### 冲突
寒皋封了南麓雾道
`
  const fromHeadings = parseOutline(fieldHeadings)
  eq('小节字段式（### 目标 + 正文行）也认', [fromHeadings.chapters[0].goal, fromHeadings.chapters[0].conflict], ['宁陈进山救人', '寒皋封了南麓雾道'])

  eq('坏输入：非字符串返回空结构', parseOutline(null), { chapters: [] })
  eq('坏输入：空字符串返回空大纲', parseOutline(''), { chapters: [] })
  eq('坏输入：没有大纲格式的散文不硬凑', parseOutline('今天天气不错，我写了两千字。').chapters, [])
}

// ── 二、剧情总结解析 ─────────────────────────────────────────────────────
head('剧情总结解析')
{
  const text = `# 第 8 章 望舒城（二） - 剧情总结

## 核心剧情点
1. **西市淘宝**：宁陈用通透世界发现宝物，低价购入：
   - 【灵云匕】（百里挑一）：背刺伤害翻倍
   - 【云雷石】×10（十不逢一）：风/雷灵根修炼用
2. **当铺交易**：
   - 卖出宝物 +100 枚上品灵石
3. **信息差**：系统商城对练气期性价比不高

## 关键设定
- 蕴灵币余额：7900
- 经济流玩法展现

## 章节评分关键点
- 爽文要素：淘宝捡漏、赚差价
`
  const parsed = parseSummaries([{ chapter: 8, text }])
  eq('章号与标题', [parsed[0].chapter, parsed[0].title], [8, '望舒城（二）'])
  eq('只取「核心剧情点」下的顶级条目', parsed[0].points.length, 3)
  ok('嵌套子项并进父项（用 · 连接）', parsed[0].points[0].includes('灵云匕') && parsed[0].points[0].includes('·'), parsed[0].points[0])
  eq('「关键设定」单独成一列', parsed[0].settings, ['蕴灵币余额：7900', '经济流玩法展现'])
  ok('评分关键点不会混进剧情点', !parsed[0].points.some((point) => point.includes('爽文要素')))
  ok('raw 保留原文', parsed[0].raw.includes('核心剧情点'))

  const fallback = parseSummaries([{ chapter: 3, text: '# 第3章 血炼台上（三）\n\n## 本章都发生了什么\n- 宁陈激活系统\n- 高可儿求救\n' }])
  eq('没有约定小标题时，退而取列表项最多的那一节', fallback[0].points, ['宁陈激活系统', '高可儿求救'])

  eq('坏输入：非数组返回空数组', parseSummaries('nope'), [])
  eq('坏输入：没有章号的条目被丢掉', parseSummaries([{ text: 'x' }]), [])
}

// ── 三、张力估计 ─────────────────────────────────────────────────────────
head('张力估计')
{
  const dense = estimateTension({ chapter: 1, text: chapterText(1, '血战', repeat(DENSE, 20)), summary: { points: ['a', 'b'] } })
  const medium = estimateTension({ chapter: 2, text: chapterText(2, '过场', repeat(MEDIUM, 16)) })
  const calm = estimateTension({ chapter: 3, text: chapterText(3, '平静', repeat(CALM, 16)) })
  ok('有事发生的章节张力更高', dense.value > calm.value, `${dense.value} vs ${calm.value}`)
  ok('过场章介于两者之间', medium.value >= calm.value && medium.value <= dense.value, `${calm.value}/${medium.value}/${dense.value}`)
  ok('估计值都标着「估」', dense.why.includes('估') && dense.source === 'estimated', dense.why)
  ok('why 里写清依据（对话/叹问/战斗词/转折词/钩子/剧情点）', ['对话占比', '叹问', '战斗词', '转折词', '钩子', '剧情点'].every((key) => dense.why.includes(key)), dense.why)
  ok('依据里给出具体数字', dense.why.includes('/千字'), dense.why)

  const empty = estimateTension({ chapter: 4, text: '' })
  eq('空正文：张力取最低的 1', [empty.value, empty.source], [1, 'estimated'])
  ok('空正文：说清为什么是 1 并要人工确认', empty.why.includes('没有正文') && empty.why.includes('需人工确认'), empty.why)

  const tiny = estimateTension({ chapter: 5, text: chapterText(5, '短', '他站着。') })
  ok('超短章：封顶为 2', tiny.value <= 2, String(tiny.value))
  ok('超短章：提示太短、需人工确认', tiny.why.includes('太短') && tiny.why.includes('需人工确认'), tiny.why)

  ok('坏输入不抛异常', estimateTension(null).value === 1 && estimateTension(undefined).value === 1)
  ok('返回值可 JSON 序列化', JSON.stringify(empty) === JSON.stringify(JSON.parse(JSON.stringify(empty))))

  // 单调性：同一个章，只加战斗词，张力不该降
  const battle = '宁陈拔剑斩出，血光爆开，妖兽扑来，他一刀斩落，杀！'
  const bases = [
    ['平缓章', chapterText(6, '静', repeat(CALM, 10))],
    ['过场章', chapterText(7, '谈', repeat(MEDIUM, 12))],
    ['短章', chapterText(8, '短', repeat(CALM, 2))],
  ]
  let monotone = true
  const detail = []
  for (const [label, base] of bases) {
    const before = estimateTension({ chapter: 6, text: base })
    const after = estimateTension({ chapter: 6, text: base + '\n\n' + battle })
    if (after.value < before.value) monotone = false
    detail.push(`${label} ${before.value}→${after.value}`)
  }
  ok('单调性：加战斗词后张力不降低', monotone, detail.join('，'))
  const bare = chapterText(9, '静', repeat(CALM, 10))
  ok('单调性有牙：平缓章加战斗词确实会上去', estimateTension({ chapter: 9, text: bare + '\n\n' + battle }).value > estimateTension({ chapter: 9, text: bare }).value)
}

// ── 四、张力曲线 ─────────────────────────────────────────────────────────
head('张力曲线')
{
  const chapters = [1, 2, 3, 4].map((n) => ({ chapter: n, text: chapterText(n, '章', repeat(CALM, 10)) }))
  const summaries = [{ chapter: 1, points: ['只有一件事'] }]
  const series = buildTensionSeries({ chapters, summaries, manual: { 2: 5, 4: '3' } })
  eq('章号覆盖正文与手工标注', series.map((p) => p.chapter), [1, 2, 3, 4])
  eq('手工标的值就是手工值', [series[1].value, series[1].source], [5, 'manual'])
  eq('手工值支持字符串写法', [series[3].value, series[3].source], [3, 'manual'])
  eq('没手工标的走估计', [series[0].source, series[2].source], ['estimated', 'estimated'])
  ok('手工条目的 why 说明是作者标的', series[1].why.includes('作者手工标注'), series[1].why)
  ok('估计条目的 why 一眼看得出是估的', series[0].why.includes('自动估计'), series[0].why)
  ok('手工值与估计差距大时提醒复核', series[1].why.includes('差') && series[1].why.includes('复核'), series[1].why)
  eq('坏输入返回空数组', [buildTensionSeries().length, buildTensionSeries(null).length], [0, 0])
}

// ── 五、伏笔欠账 ─────────────────────────────────────────────────────────
head('伏笔欠账')
{
  const outline = `# 大纲
## 第1章 起点
- 埋：青云令的来历
## 第2章 相遇
- 埋：铁面生的身份
## 第3章 揭晓
- 收：铁面生的身份
## 第4章 后续
- 埋：火麟石的下落（第9章前回收）
`
  // 第 3 章正文里确实提到了「铁面生」，兑现才算数（只看章号不看内容的账是假账）
  const chapters = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
    chapter: n,
    text: chapterText(n, '章', n === 3 ? '铁面生终于说出了自己的身份。' : '宁陈走在路上，看着天边的云。'),
  }))
  const debts = foreshadowDebts({ outline, chapters })
  const byName = (keyword) => debts.find((debt) => debt.name.includes(keyword))
  const qing = byName('青云令')
  const tie = byName('铁面生')
  const huo = byName('火麟石')

  eq('三条埋点都在账上', debts.length, 3)
  ok('埋了没回收 → 超期', qing.overdue === true, JSON.stringify(qing))
  eq('超期条目给出埋的章号与已欠章数', [qing.plantedChapter, qing.paidChapter, qing.openChapters], [1, null, 7])
  ok('按时回收的不算超期', tie.overdue === false && tie.paidChapter === 3, JSON.stringify(tie))
  eq('从条目里认出作者写的兑现期限', huo.dueChapter, 9)
  ok('还没到期（全书只到第 8 章）不算超期', huo.overdue === false, JSON.stringify(huo))

  // 声明了兑现章，但那一章根本没有这个词
  const brokenOutline = `## 第2章 埋
- 埋：雾锁三峰的任务
## 第5章 说是要收
- 收：雾锁三峰的任务
`
  const broken = foreshadowDebts({ outline: brokenOutline, chapters })
  ok('声明兑现却找不到线索 → 也算超期', broken[0].overdue === true && broken[0].paidChapter === null, JSON.stringify(broken[0]))

  eq('坏输入返回空数组', [foreshadowDebts().length, foreshadowDebts(null).length], [0, 0])
}

// ── 六、六个检查各来一个正例 ─────────────────────────────────────────────
/**
 * 造一本「六个毛病都占一点」的假书：
 *   1-2 章 有事 · 3-5 章 全平（中段塌陷）· 6-8 章 有事 · 8 章还特别短
 * 大纲：第 5 章写了一整套黑水寨的戏，可正文和总结里一个字都没有（大纲偏移）；
 *       第 7 章没写大纲（大纲缺失）；第 1 章埋的青云令到最后也没收（伏笔超期）。
 */
const BOOK_A = {
  chapters: [
    ...[1, 2].map((n) => ({ chapter: n, text: chapterText(n, '有事', repeat(DENSE, 20)) })),
    ...[3, 4, 5].map((n) => ({ chapter: n, text: chapterText(n, '平缓', repeat(CALM, 16)) })),
    ...[6, 7].map((n) => ({ chapter: n, text: chapterText(n, '有事', repeat(DENSE, 20)) })),
    { chapter: 8, text: chapterText(8, '短章', repeat(DENSE, 6)) },
  ],
  summaries: [
    { chapter: 1, points: ['宁陈拔剑斩出，血光爆开', '妖兽扑来'] },
    { chapter: 2, points: ['宁陈追问道你到底是谁', '苏清鸢答不上来'] },
    { chapter: 3, points: ['宁陈坐在窗前看着云海', '苏清鸢在旁整理行囊'] },
    { chapter: 4, points: ['宁陈坐在窗前看着云海'] },
    { chapter: 5, points: ['宁陈坐在窗前看着云海'] },
    { chapter: 6, points: ['宁陈拔剑斩出，血光爆开', '铁面生的身份揭晓'] },
    { chapter: 7, points: ['妖兽扑来', '血光爆开'] },
    { chapter: 8, points: ['短章第一件事', '第二件事', '第三件事', '第四件事', '第五件事'] },
  ],
  outline: `# 逐弈登仙 · 分章大纲

## 第1章 起点
- 目标：宁陈拔剑斩出，血光爆开
- 埋：青云令的来历

## 第2章 相遇
- 目标：宁陈追问道你到底是谁
- 埋：铁面生的身份

## 第3章 平静
- 目标：宁陈坐在窗前看着云海

## 第4章 平静（二）
- 目标：宁陈坐在窗前看着云海

## 第5章 黑水寨
- 目标：沈砚潜入黑水寨偷取火麟石
- 冲突：与寨主铁面生搏杀
- 转折：火麟石碎裂

## 第6章 揭晓
- 目标：宁陈拔剑斩出，血光爆开
- 收：铁面生的身份

## 第8章 短章
- 目标：短章第一件事
`,
  scores: [
    { chapter: 1, score: 4.3, count: 100 },
    { chapter: 2, score: 4.2, count: 100 },
    { chapter: 3, score: 4.1, count: 100 },
    { chapter: 4, score: 4.0, count: 100 },
    { chapter: 5, score: 3.2, count: 100 },
    { chapter: 6, score: 4.2, count: 100 },
    { chapter: 7, score: 4.2, count: 100 },
    { chapter: 8, score: 4.2, count: 100 },
  ],
}

head('综合诊断：六个检查各一个正例')
{
  const report = detectPlotIssues(BOOK_A)
  const codes = report.findings.map((item) => item.code)
  const pick = (code) => report.findings.filter((item) => item.code === code)

  ok('中段塌陷：连续 3 章低张力且后面还有高潮 → warn', pick('中段塌陷').length === 1 && pick('中段塌陷')[0].level === 'warn', JSON.stringify(codes))
  const collapse = pick('中段塌陷')[0]
  ok('中段塌陷：message 给出章号区间与可执行建议', collapse.message.includes('第 3–5 章') && /合并|补一个|提前/.test(collapse.message), collapse.message)
  ok('中段塌陷：evidence 摆出各章张力值', collapse.evidence.includes('张力') && collapse.evidence.length <= 80, collapse.evidence)
  ok('张力确实起来了 → 不报全程平缓', pick('全程平缓').length === 0, JSON.stringify(codes))

  ok('大纲偏移：warn，且指出没兑现的关键词', pick('大纲偏移').length === 1 && pick('大纲偏移')[0].level === 'warn', JSON.stringify(pick('大纲偏移')))
  ok('大纲偏移：evidence 写出那个词', pick('大纲偏移')[0].evidence.includes('火麟石'), pick('大纲偏移')[0].evidence)
  ok('大纲偏移：点的是第 5 章', pick('大纲偏移')[0].chapter === 5, String(pick('大纲偏移')[0].chapter))

  ok('大纲缺失：info，汇总一条并列出章号', pick('大纲缺失').length === 1 && pick('大纲缺失')[0].level === 'info' && pick('大纲缺失')[0].message.includes('第 7 章'), JSON.stringify(pick('大纲缺失')))

  ok('伏笔超期：warn，点出埋的章号与欠了多少章', pick('伏笔超期').length === 1 && pick('伏笔超期')[0].level === 'warn', JSON.stringify(pick('伏笔超期')))
  ok('伏笔超期：说的是青云令', pick('伏笔超期')[0].message.includes('青云令') && pick('伏笔超期')[0].message.includes('7 章'), pick('伏笔超期')[0].message)
  ok('按时回收的铁面生不算超期', !pick('伏笔超期').some((item) => item.message.includes('铁面生')))

  ok('字数失衡：info，列出偏短的章号', pick('字数失衡').length === 1 && pick('字数失衡')[0].level === 'info' && pick('字数失衡')[0].message.includes('第 8 章'), JSON.stringify(pick('字数失衡')))

  const density = pick('事件密度异常')
  ok('事件密度异常：info，字少事多', density.length === 1 && density[0].level === 'info' && density[0].chapter === 8, JSON.stringify(density))
  ok('事件密度异常：说清字数和剧情点条数', density[0].evidence.includes('240') && density[0].evidence.includes('5'), density[0].evidence)

  const drop = pick('评分下滑')
  ok('评分下滑：连续下跌 → warn', drop.length >= 1 && drop.every((item) => item.level === 'warn'), JSON.stringify(drop))
  ok('评分下滑：说清是连续下降', drop.some((item) => item.message.includes('连续下降')), JSON.stringify(drop.map((item) => item.message)))
  ok('评分下滑：也说清比均值低了多少', drop.some((item) => item.message.includes('比全书均值')), JSON.stringify(drop.map((item) => item.message)))

  ok('六个 code 一个不少', ['中段塌陷', '大纲偏移', '大纲缺失', '伏笔超期', '字数失衡', '事件密度异常', '评分下滑'].every((code) => codes.includes(code)), JSON.stringify(codes))

  // 每条 finding 的形状与「说人话」要求
  ok('finding 形状统一', report.findings.every((item) => ['error', 'warn', 'info'].includes(item.level) && typeof item.code === 'string' && (item.chapter === null || Number.isInteger(item.chapter)) && item.message.length > 10 && item.evidence.length <= 80))
  ok('message 都说清了「哪里不对 + 怎么办」', report.findings.every((item) => /建议|可以试试|要么/.test(item.message)))

  // metrics
  const metrics = report.metrics
  eq('metrics.chapterCount / totalChars / avgChars', [metrics.chapterCount, metrics.totalChars, metrics.avgChars], [8, 5024, 628])
  eq('metrics.tension 逐章给出', metrics.tension.map((point) => [point.chapter, point.value]), [[1, 5], [2, 5], [3, 1], [4, 1], [5, 1], [6, 5], [7, 5], [8, 5]])
  ok('metrics.tension 标明来源是估的', metrics.tension.every((point) => point.source === 'estimated'))
  eq('metrics.arc：峰、谷、连续低张力区间', [metrics.arc.peak, metrics.arc.trough, metrics.arc.flatRuns], [1, 3, [[3, 5]]])
  eq('metrics.density 逐章给出剧情点与字数', metrics.density.map((item) => [item.chapter, item.points, item.chars]), [[1, 2, 800], [2, 2, 800], [3, 2, 528], [4, 1, 528], [5, 1, 528], [6, 2, 800], [7, 2, 800], [8, 5, 240]])
  ok('metrics.foreshadow 给出欠账', metrics.foreshadow.some((debt) => debt.name.includes('青云令') && debt.overdue === true))
  ok('报告可 JSON 序列化且往返不变', JSON.stringify(JSON.parse(JSON.stringify(report))) === JSON.stringify(report))
}

head('综合诊断：手工张力曲线优先，平缓与塌陷不混报')
{
  const chapters = [1, 2, 3, 4, 5].map((n) => ({ chapter: n, text: chapterText(n, '章', repeat(CALM, 10)) }))
  const flat = detectPlotIssues({ chapters, tensions: [3, 3, 2, 3, 3].map((value, index) => ({ chapter: index + 1, value, source: 'manual' })) })
  ok('全程平缓：全书没有一章到 4 → info', flat.findings.some((item) => item.code === '全程平缓' && item.level === 'info'))
  ok('全程平缓时不再报中段塌陷（同一件事不骂两遍）', !flat.findings.some((item) => item.code === '中段塌陷'))
  eq('手工曲线原样进 metrics，并标成 manual', flat.metrics.tension.map((point) => point.source), ['manual', 'manual', 'manual', 'manual', 'manual'])

  const dip = detectPlotIssues({ chapters, tensions: [4, 2, 2, 2, 4].map((value, index) => ({ chapter: index + 1, value, source: 'manual' })) })
  ok('后面能起来的低张力段才叫塌陷', dip.findings.some((item) => item.code === '中段塌陷' && item.chapter === 4))
}

head('综合诊断：大纲偏移的两档，以及同义改写的容忍')
{
  const moved = detectPlotIssues({
    summaries: [
      { chapter: 1, points: ['宁陈拜入青云宗', '入门试炼刁难'] },
      { chapter: 2, points: ['沈砚潜入黑水寨偷取火麟石', '与寨主铁面生搏杀'] },
    ],
    outline: '## 第1章 甲\n- 目标：沈砚潜入黑水寨偷取火麟石\n',
  })
  const movedFinding = moved.findings.find((item) => item.code === '大纲偏移')
  ok('内容明显是跑到别的章去了 → info，而不是「没兑现」', movedFinding !== undefined && movedFinding.level === 'info', JSON.stringify(moved.findings))
  ok('并指出最像的是哪一章', movedFinding.message.includes('第 2 章'), movedFinding.message)

  // 同义改写不该被报成偏移：这条大纲与总结的重合度约 43%（真实章节量出来的典型水平）
  const paraphrase = detectPlotIssues({
    summaries: [{ chapter: 1, title: '望舒城（二）', points: ['西市淘宝：宁陈用通透世界发现宝物，低价购入', '当铺交易：二十万灵石成交'] }],
    outline: '## 第1章 望舒城\n- 目标：宁陈在望舒城捡漏发家\n',
  })
  ok('换了说法写的大纲不报偏移（宁可漏报，也不误报）', !paraphrase.findings.some((item) => item.code === '大纲偏移'), JSON.stringify(paraphrase.findings))
}

head('综合诊断：缺材料 / 坏输入')
{
  const empty = detectPlotIssues()
  eq('什么都不给：空的 findings 与 metrics', [empty.findings.length, empty.metrics.chapterCount, empty.metrics.avgChars, empty.metrics.tension.length, empty.metrics.foreshadow.length, empty.metrics.density.length], [0, 0, 0, 0, 0, 0])
  eq('arc 的空值形状', empty.metrics.arc, { peak: null, trough: null, flatRuns: [] })
  eq('null 入参不抛异常', detectPlotIssues(null).findings.length, 0)

  const onlyOutline = detectPlotIssues({ outline: '## 第1章 甲\n- 目标：做点什么' })
  ok('只有大纲：不硬凑结论', onlyOutline.findings.length === 0, JSON.stringify(onlyOutline.findings))

  const onlySummaries = detectPlotIssues({
    summaries: [1, 2, 3, 4].map((n) => ({ chapter: n, points: [`第${n}章第一件事`, `第${n}章第二件事`] })),
  })
  eq('只有剧情总结、没有正文：这条曲线留空（等于这项没数据）', onlySummaries.metrics.tension, [])
  ok('只有剧情总结、没有正文：不报平缓 / 塌陷（那是没材料，不是书平）', onlySummaries.findings.length === 0, JSON.stringify(onlySummaries.findings))
  eq('没有正文时 arc 也是空的', onlySummaries.metrics.arc, { peak: null, trough: null, flatRuns: [] })

  const onlyOneChapter = detectPlotIssues({ chapters: [{ chapter: 1, text: repeat(CALM, 20) }] })
  ok('只有一章：不报平缓 / 失衡（样本太小）', onlyOneChapter.findings.length === 0, JSON.stringify(onlyOneChapter.findings))
}

// ── 七、误报控制：正常的一本书不该被报警 ─────────────────────────────────
head('误报控制（正常的一本书）')
{
  const chapters = Array.from({ length: 12 }, (_, index) => {
    const n = index + 1
    const body = n % 2 === 0 ? repeat(DENSE, 20) : repeat(MEDIUM, 16)
    return { chapter: n, text: chapterText(n, `第${n}章`, body) }
  })
  const summaries = chapters.map((entry) => ({
    chapter: entry.chapter,
    // 第 6 章点一下第 2 章埋的伏笔，让账目是平的
    points:
      entry.chapter === 6
        ? ['宁陈拔剑斩出，血光爆开', '黑水寨的地图到手', '妖兽扑来']
        : [`第${entry.chapter}章第一件事`, `第${entry.chapter}章第二件事`, `第${entry.chapter}章第三件事`],
  }))
  const outline = chapters
    .map((entry) => {
      const points = summaries.find((item) => item.chapter === entry.chapter).points
      const extra = entry.chapter === 2 ? '\n- 埋：黑水寨的地图' : entry.chapter === 6 ? '\n- 收：黑水寨的地图' : ''
      return `## 第${entry.chapter}章 标题\n- 目标：${points[0]}\n- 冲突：${points[1]}\n- 转折：${points[2]}${extra}`
    })
    .join('\n\n')
  const scores = [4.2, 4.25, 4.18, 4.22, 4.19, 4.24, 4.17, 4.21, 4.23, 4.16, 4.2, 4.22].map((score, index) => ({ chapter: index + 1, score, count: 100 }))

  const tensions = buildTensionSeries({ chapters, summaries, outline })
  ok('前提：每章张力都 ≥3（这是本正常书的设定）', tensions.every((point) => point.value >= 3), JSON.stringify(tensions.map((p) => p.value)))

  const report = detectPlotIssues({ chapters, outline, summaries, scores })
  ok('正常的一本书：一条告警都不报', report.findings.length === 0, JSON.stringify(report.findings.map((item) => item.code + ':' + item.message)))
  ok('正常的一本书：不报中段塌陷', !report.findings.some((item) => item.code === '中段塌陷'))
  ok('正常的一本书：不报全程平缓', !report.findings.some((item) => item.code === '全程平缓'))
  ok('正常的一本书：伏笔账是平的', report.metrics.foreshadow.length === 1 && report.metrics.foreshadow[0].overdue === false, JSON.stringify(report.metrics.foreshadow))
}

// ── 八、读文件的小封装（临时目录，不碰本机任何真实路径） ──────────────────
head('读文件封装')
{
  const root = await mkdtemp(join(tmpdir(), 'plot-test-'))
  try {
    await mkdir(join(root, '剧情'), { recursive: true })
    await writeFile(join(root, '剧情', '第 9 章 剧情总结.md'), '# 第 9 章 猎妖（一） - 剧情总结\n\n## 核心剧情点\n- 宁陈进山\n', 'utf8')
    await writeFile(join(root, '作品-第9章.txt'), '第9章 猎妖（一）\n\n' + repeat(DENSE, 6), 'utf8')

    const summaryText = await readTextFile(join(root, '剧情', '第 9 章 剧情总结.md'))
    const chapterBody = await readTextFile(join(root, '作品-第9章.txt'))
    ok('读得到总结正文', summaryText.includes('核心剧情点'))
    eq('读到的总结能直接解析', parseSummaries([{ chapter: 9, text: summaryText }])[0].points, ['宁陈进山'])
    ok('读得到本章正文', chapterBody.includes('宁陈'))
    eq('读不到的文件返回空串而不是抛异常', await readTextFile(join(root, '没有这个文件.txt')), '')
    eq('坏路径参数返回空串', await readTextFile(null), '')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

// ── 九、真实数据只读回放（本机没有就跳过，不算失败） ─────────────────────
head('真实数据只读回放')
{
  const REAL = '/public/home/wangyg/novel/逐弈登仙'
  if (!existsSync(join(REAL, '逐弈登仙-第1章.txt'))) {
    console.log('  ⏭️  跳过：本机没有这部作品的真实数据（只读用例，不影响结果）')
  } else {
    const chapters = []
    for (let n = 1; n <= 30; n += 1) {
      const text = await readTextFile(join(REAL, `逐弈登仙-第${n}章.txt`))
      if (text !== '') chapters.push({ chapter: n, text })
    }
    const rawSummaries = []
    for (let n = 1; n <= 30; n += 1) {
      const text = await readTextFile(join(REAL, '剧情', `第 ${n} 章 剧情总结.md`))
      if (text !== '') rawSummaries.push({ chapter: n, text })
    }
    const scores = []
    for (let n = 1; n <= 30; n += 1) {
      const text = await readTextFile(join(REAL, '评论', `第${n}章_评论数据.json`))
      if (text === '') continue
      try {
        const parsed = JSON.parse(text)
        const list = Array.isArray(parsed.comments) ? parsed.comments.map((c) => Number(c.score)).filter(Number.isFinite) : []
        if (list.length > 0) scores.push({ chapter: n, score: list.reduce((a, b) => a + b, 0) / list.length, count: list.length })
      } catch {
        // 评论文件坏了就跳过这一章，只读回放不该因为脏数据中断
      }
    }

    const summaries = parseSummaries(rawSummaries)
    const report = detectPlotIssues({ chapters, outline: '', summaries, scores })
    const codes = [...new Set(report.findings.map((item) => item.code))]
    console.log(`  ℹ️  真实数据：${chapters.length} 章正文 / ${summaries.length} 份剧情总结 / ${scores.length} 章评分`)
    console.log(`  ℹ️  张力曲线：${report.metrics.tension.map((p) => p.chapter + ':' + p.value).join(' ')}`)
    console.log(`  ℹ️  触发的 code：${codes.length === 0 ? '（无）' : codes.join('、')}`)
    for (const item of report.findings) console.log(`      · [${item.level}] ${item.code} 第${item.chapter}章：${item.evidence}`)

    ok('真实数据跑得通（有章就有张力曲线）', report.metrics.chapterCount === chapters.length && report.metrics.tension.length === chapters.length)
    ok('真实数据下的 finding 形状依然合法', report.findings.every((item) => typeof item.message === 'string' && item.evidence.length <= 80))
    ok('只读回放不写任何文件', true)
  }
}

console.log(`\n${failures === 0 ? '全部通过 ✅' : `失败 ${failures} 项 ❌`}`)
process.exit(failures === 0 ? 0 : 1)
