/**
 * 账目体检单测
 *
 * 全部数据用临时目录自造（mkdtemp），不依赖任何本机路径：
 *   node test/ledger.test.mjs
 *
 * 唯一的例外是最后一组"真实台账"用例：本机有《逐弈登仙》的台账就读一遍，
 * 没有就打印跳过——别人 clone 下来必须照样能跑绿。
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readLedger, ledgerCheck, parseLedger, chapterOf } from '../lib/core/ledger.js'

let failures = 0
const ok = (name, cond, detail) => {
  if (cond) {
    console.log(`  ✅ ${name}`)
  } else {
    failures += 1
    console.log(`  ❌ ${name}${detail === undefined ? '' : ' → ' + detail}`)
  }
}
const head = (name) => console.log(`\n【${name}】`)

/** 结构相同用 assert 判，但失败要记进失败数，不能把整个测试打断 */
const same = (a, b) => {
  try {
    assert.deepEqual(a, b)
    return true
  } catch {
    return false
  }
}

const created = []
async function fixture(ledgerText) {
  const root = await mkdtemp(join(tmpdir(), 'nv-ledger-'))
  created.push(root)
  if (ledgerText !== null) {
    await mkdir(join(root, '设定'), { recursive: true })
    await writeFile(join(root, '设定/道具与增益台账.md'), ledgerText, 'utf8')
  }
  return root
}
const ch = (chapter, text) => ({ chapter, title: `第${chapter}章 用例`, text })
const of = (result, code) => result.findings.filter((f) => f.code === code)
const codes = (result) => result.findings.map((f) => f.code)

// ── 一、章号解析 ──────────────────────────────────────────────────────────
head('章号解析 chapterOf')
{
  ok('第8章', chapterOf('第8章') === 8, String(chapterOf('第8章')))
  ok('第 8 章（有空格的）', chapterOf('第 8 章') === 8, String(chapterOf('第 8 章')))
  ok('第8章获得', chapterOf('第8章获得') === 8)
  ok('第6章花2000蕴灵币购买（取第一个章号）', chapterOf('第6章花2000蕴灵币购买') === 6, String(chapterOf('第6章花2000蕴灵币购买')))
  ok('多章并列取最前', chapterOf('第6章花2000蕴灵币购买；第8章时是否仍在有效期') === 6, String(chapterOf('第6章花2000蕴灵币购买；第8章时是否仍在有效期')))
  ok('区间第1—2章取起点', chapterOf('第1—2章') === 1, String(chapterOf('第1—2章')))
  ok('中文数字第十二章', chapterOf('第十二章') === 12, String(chapterOf('第十二章')))
  ok('中文数字第八十章', chapterOf('第八十章') === 80, String(chapterOf('第八十章')))
  ok('当前校对截止：第8章结束', chapterOf('> 当前校对截止：第8章结束。') === 8)
  ok('没有章号返回 null', chapterOf('已植入李大可') === null, String(chapterOf('已植入李大可')))
  ok('空串返回 null', chapterOf('') === null)
  ok('非字符串也不炸', chapterOf(undefined) === null && chapterOf(123) === null)
}

// ── 二、台账解析 ──────────────────────────────────────────────────────────
const LEDGER = `# 《测试书》道具与增益台账

> 当前校对截止：第2章结束。
> 本文档记录正文已经明示的道具、神通、仙术和增益。

## 记录规则

- 状态使用：持有、已消耗、已出售、已植入、待确认。

## 系统通用规则

| 项目 | 已确认设定 | 出处 |
|---|---|---|
| 抽取价格 | 100 / 500 / 2000 蕴灵币 | 第1章 |
| 增益分级 | 普通 / 十不逢一 | 第1章 |

## 主角：神通与道具

| 物品 | 品级／类型 | 效果 | 状态 | 首次出现／备注 |
|---|---|---|---|---|
| 通灵镜 | 十不逢一·法宝 | 可查看他人修为 | 持有 | 第1章获得 |
| 青霜剑 | 百里挑一·宝具 | 出鞘见血 | 持有 | 第3章获得 |
| 归元丹 | 普通·丹药 | 回气，一枚顶三天 | 已消耗 | 第1章服用后耗尽 |

## 配角：重要道具

| 道具 | 数量 | 品质 | 作用 | 状态 | 备注 |
|---|---|---|---|---|---|
| 幽灵丹 | 2 | 百里挑一 | 隐匿身形 |  | 第2章 |
| 匿踪符 | 1 | 普通 | 藏匿气息 | 未明示 |  |
| 断玉簪 | 1 | 普通 | 束发 | 已出售给当铺 | 第2章 |
`

head('台账解析 parseLedger')
{
  const parsed = parseLedger(LEDGER)
  const byName = new Map(parsed.items.map((item) => [item.name, item]))
  ok('解析出 6 条物品', parsed.items.length === 6, String(parsed.items.length))
  ok('「系统通用规则」表没有名称列，整表跳过', parsed.items.some((item) => item.name === '抽取价格') === false)
  ok('cutoffChapter = 2', parsed.cutoffChapter === 2, String(parsed.cutoffChapter))
  ok('sections 是各小节标题', parsed.sections.includes('主角：神通与道具') && parsed.sections.includes('配角：重要道具'), JSON.stringify(parsed.sections))
  ok('纯函数返回可 JSON 序列化', same(JSON.parse(JSON.stringify(parsed)), parsed))

  const mirror = byName.get('通灵镜')
  ok('名称列叫「物品」也认得', mirror !== undefined)
  ok('category 是所在小节', mirror?.category === '主角：神通与道具', mirror?.category)
  ok('效果列', mirror?.effect === '可查看他人修为', mirror?.effect)
  ok('状态列原文与枚举', mirror?.status === '持有' && mirror?.statusKind === 'held', JSON.stringify([mirror?.status, mirror?.statusKind]))
  ok('首现列原文与章号', mirror?.firstSeen === '第1章获得' && mirror?.firstChapter === 1, JSON.stringify([mirror?.firstSeen, mirror?.firstChapter]))
  ok('没有的列给空串，不是 undefined', mirror?.quantity === '' && mirror?.grade === '十不逢一·法宝', JSON.stringify([mirror?.quantity, mirror?.grade]))

  const cyan = byName.get('青霜剑')
  ok('表头写成「品级／类型」→ grade', cyan?.grade === '百里挑一·宝具', cyan?.grade)
  ok('firstChapter = 3', cyan?.firstChapter === 3, String(cyan?.firstChapter))

  const pill = byName.get('归元丹')
  ok('「已消耗」→ consumed', pill?.statusKind === 'consumed')

  const ghost = byName.get('幽灵丹')
  ok('名称列叫「道具」也认得', ghost !== undefined)
  ok('数量/品质/作用/备注 四列都按表头对上', ghost?.quantity === '2' && ghost?.grade === '百里挑一' && ghost?.effect === '隐匿身形' && ghost?.firstSeen === '第2章', JSON.stringify(ghost))
  ok('「第2章」→ firstChapter 2', ghost?.firstChapter === 2)
  ok('状态列没填时给空串、枚举给 unknown', ghost?.status === '' && ghost?.statusKind === 'unknown', JSON.stringify([ghost?.status, ghost?.statusKind]))

  ok('「未明示」→ pending', byName.get('匿踪符')?.statusKind === 'pending', byName.get('匿踪符')?.statusKind)
  ok('「已出售给当铺」→ sold', byName.get('断玉簪')?.statusKind === 'sold', byName.get('断玉簪')?.statusKind)
  ok('章号写在备注列也能算出 firstChapter', byName.get('断玉簪')?.firstChapter === 2, String(byName.get('断玉簪')?.firstChapter))

  // 状态列缺失时不拿备注顶替：备注里的话（"第5章已出售"）不是状态列
  const noStatus = parseLedger('## 无状态列\n\n| 名称 | 备注 |\n|---|---|\n| 戊盾 | 第5章已出售 |\n')
  ok('没有状态列时不拿备注顶替状态', noStatus.items[0]?.status === '' && noStatus.items[0]?.statusKind === 'unknown', JSON.stringify(noStatus.items[0]))
  ok('没有状态列时 firstChapter 仍然算得出', noStatus.items[0]?.firstChapter === 5, String(noStatus.items[0]?.firstChapter))

  // 列名每次都不一样：同一张表里"状态"写在合并列（效果／状态）上也要认
  const merged = parseLedger('## 合并列\n\n| 名称 | 品级／类型 | 效果／状态 | 出处 |\n|---|---|---|---|\n| 护心镜 | 战利品 | 可抵挡三次致命攻击；三次机会均已耗尽，护心镜破碎 | 第3章 |\n')
  ok('「效果／状态」合并列：状态照样认得出', merged.items[0]?.statusKind === 'consumed', JSON.stringify(merged.items[0]))
  ok('「效果／状态」合并列：效果也保留', String(merged.items[0]?.effect).includes('抵挡三次'), merged.items[0]?.effect)

  const cut = parseLedger('# 台账\n\n> 截至第12章。\n')
  ok('「截至第12章」也取得到', cut.cutoffChapter === 12, String(cut.cutoffChapter))
  ok('没有物品表时 items 为空数组', cut.items.length === 0 && Array.isArray(cut.sections))

  const garbage = parseLedger('# 标题\n\n这里什么都没有，也没有章号。\n')
  ok('格式不对时降级为空结果，不抛异常', garbage.items.length === 0 && garbage.cutoffChapter === null)
  ok('非字符串入参降级', parseLedger(null).items.length === 0 && parseLedger(undefined).cutoffChapter === null)
}

head('状态映射 statusKind')
{
  const text = [
    '## 状态表',
    '',
    '| 名称 | 状态 | 首次出现 |',
    '|---|---|---|',
    '| 甲丹 | 持有 | 第1章 |',
    '| 乙符 | 已消耗 | 第1章 |',
    '| 丙刀 | 已用 | 第1章 |',
    '| 丁剑 | 用掉 | 第1章 |',
    '| 戊石 | 耗尽 | 第1章 |',
    '| 己术 | 已出售 | 第1章 |',
    '| 庚诀 | 卖出 | 第1章 |',
    '| 辛珠 | 已植入 | 第1章 |',
    '| 壬玉 | 待确认 | 第1章 |',
    '| 癸草 | 生效中 | 第1章 |',
    '| 子盘 |  | 第1章 |',
    '',
  ].join('\n')
  const kinds = Object.fromEntries(parseLedger(text).items.map((item) => [item.name, item.statusKind]))
  ok('持有 → held', kinds['甲丹'] === 'held', kinds['甲丹'])
  ok('已消耗 / 已用 / 用掉 / 耗尽 → consumed', ['乙符', '丙刀', '丁剑', '戊石'].every((n) => kinds[n] === 'consumed'), JSON.stringify(kinds))
  ok('已出售 / 卖出 → sold', kinds['己术'] === 'sold' && kinds['庚诀'] === 'sold')
  ok('已植入 → implanted', kinds['辛珠'] === 'implanted')
  ok('待确认 → pending', kinds['壬玉'] === 'pending')
  ok('其余 → unknown', kinds['癸草'] === 'unknown' && kinds['子盘'] === 'unknown')
  ok('状态列空着时给空串', parseLedger(text).items.find((i) => i.name === '子盘')?.status === '')
}

// ── 三、读台账（IO） ──────────────────────────────────────────────────────
head('读台账 readLedger')
{
  const root = await fixture(LEDGER)
  const ledger = await readLedger(root)
  ok('exists=true 且给出路径', ledger.exists === true && ledger.path.endsWith(join('设定', '道具与增益台账.md')), ledger.path)
  ok('text 与 bytes 都给了', ledger.text.includes('通灵镜') && ledger.bytes > 0, String(ledger.bytes))
  ok('items / cutoffChapter 一并返回', ledger.items.length === 6 && ledger.cutoffChapter === 2)

  const missing = await fixture(null)
  const none = await readLedger(missing)
  ok('没有台账时不抛异常，返回空结果', none.exists === false && none.items.length === 0 && none.text === '' && none.cutoffChapter === null, JSON.stringify(none))
  ok('projectDir 给空/非字符串也降级', (await readLedger('')).exists === false && (await readLedger(undefined)).exists === false && (await readLedger(null)).exists === false)

  // 老作品可能把台账平铺在作品根目录
  const flat = await mkdtemp(join(tmpdir(), 'nv-ledger-'))
  created.push(flat)
  await writeFile(join(flat, '道具台账.md'), LEDGER, 'utf8')
  ok('文件名不同时也能在根目录找到', (await readLedger(flat)).items.length === 6)
}

// ── 四、账目体检：六种 code ───────────────────────────────────────────────
const CHAPTERS = [
  ch(1, [
    '第1章 试炼',
    '宁陈握着【通灵镜】，镜面泛起微光。',
    '他把【青霜剑】别在腰间，谁也没看见。',
    '他服下【归元丹】，气息一稳。',
    '他抽奖花了 300 蕴灵币，什么也没抽到。',
    '【李大山】站在一旁，「苏清鸢」低着头，谁都没说话。',
    '',
  ].join('\n')),
  ch(2, [
    '第2章 集市',
    '他一直想要一枚【天罡符】，摊主说【天罡符】的仿品也多。',
    '他又抽了一次，花 500 蕴灵币，终于拿到【天罡符】。',
    '随后他把【断玉簪】卖给了当铺。',
    '',
  ].join('\n')),
  ch(3, [
    '第3章 归来',
    '他重新拿出【归元丹】，一口吞下。',
    '【通灵镜】依旧在怀里。',
    '他把【新宝刀】挂在了墙上。',
    '',
  ].join('\n')),
]

head('账目体检 ledgerCheck')
{
  const root = await fixture(LEDGER)
  const result = await ledgerCheck({ projectDir: root, chapters: CHAPTERS })
  const findings = result.findings

  ok('finding 字段齐全且取值合法', findings.every((f) => ['error', 'warn', 'info'].includes(f.level) && typeof f.code === 'string' && (f.chapter === null || typeof f.chapter === 'number') && typeof f.item === 'string' && typeof f.message === 'string' && typeof f.evidence === 'string'))
  ok('只用约定的六种 code', findings.every((f) => ['未登记物品', '首现早于登记', '台账说有正文没有', '已消耗又出现', '超出校对截止', '口径冲突'].includes(f.code)), JSON.stringify([...new Set(codes(result))]))
  ok('证据都裁到 80 字以内', findings.every((f) => f.evidence.length <= 80), String(Math.max(0, ...findings.map((f) => f.evidence.length))))
  ok('结果可 JSON 序列化', same(JSON.parse(JSON.stringify(result)), result))

  // 1 未登记物品
  const fresh = of(result, '未登记物品')
  ok('未登记物品：抓到正文里有、台账里没有的【天罡符】', fresh.some((f) => f.item === '天罡符' && f.chapter === 2), JSON.stringify(fresh.map((f) => f.item)))
  ok('未登记物品：给的是首现章（同名多章只报一次）', fresh.filter((f) => f.item === '天罡符').length === 1)
  ok('未登记物品：level=warn，message 说清补台账或判误报', fresh.every((f) => f.level === 'warn' && f.message.includes('台账未登记') && f.message.includes('误报')))
  ok('未登记物品：带上正文原句当证据', fresh.find((f) => f.item === '天罡符')?.evidence.includes('天罡符') === true, fresh.find((f) => f.item === '天罡符')?.evidence)

  // 2 首现早于登记
  const early = of(result, '首现早于登记')
  ok('首现早于登记：台账记第3章，正文第1章就有了', early.length === 1 && early[0].item === '青霜剑' && early[0].chapter === 1, JSON.stringify(early))
  ok('首现早于登记：message 里两个章号都写清', early[0]?.message.includes('第3章') === true && early[0]?.message.includes('第1章') === true, early[0]?.message)
  ok('首现早于登记：证据是更早那句', early[0]?.evidence.includes('青霜剑') === true, early[0]?.evidence)

  // 3 台账说有正文没有
  const unmapped = of(result, '台账说有正文没有')
  ok('台账说有正文没有：幽灵丹全篇搜不到', unmapped.length === 1 && unmapped[0].item === '幽灵丹' && unmapped[0].chapter === 2, JSON.stringify(unmapped))
  ok('台账说有正文没有：level=info', unmapped[0]?.level === 'info')
  ok('没有章号的条目（匿踪符）不参与对账', unmapped.some((f) => f.item === '匿踪符') === false && parseLedger(LEDGER).items.find((i) => i.name === '匿踪符')?.firstChapter === null)

  // 4 已消耗又出现
  const reused = of(result, '已消耗又出现')
  ok('已消耗又出现：归元丹第1章耗尽、第3章又吞', reused.length === 1 && reused[0].item === '归元丹' && reused[0].chapter === 3, JSON.stringify(reused))
  ok('已消耗又出现：level=error 且 message 点明怎么改', reused[0]?.level === 'error' && reused[0]?.message.includes('后文不该再用') === true && reused[0]?.message.includes('笔误') === true, reused[0]?.message)
  ok('已消耗又出现：证据取后文那一次', reused[0]?.evidence.includes('归元丹') === true, reused[0]?.evidence)

  // 5 超出校对截止
  const ahead = of(result, '超出校对截止')
  ok('超出校对截止：只报一条汇总（item 留空）', ahead.length === 1 && ahead[0].item === '', JSON.stringify(ahead.map((f) => f.item)))
  ok('超出校对截止：level=info 且提到截止章', ahead[0]?.level === 'info' && ahead[0]?.message.includes('第2章') === true, ahead[0]?.message)
  ok('超出校对截止：message 里列出名字', ahead[0]?.message.includes('新宝刀') === true, ahead[0]?.message)

  // 6 口径冲突
  const clash = of(result, '口径冲突')
  ok('口径冲突：抽奖花 300 蕴灵币不在台账价格表里', clash.length === 1 && clash[0].chapter === 1, JSON.stringify(clash))
  ok('口径冲突：level=warn 且 message 报出金额与台账口径', clash[0]?.level === 'warn' && clash[0]?.message.includes('300') === true && clash[0]?.message.includes('抽取价格') === true, clash[0]?.message)
  ok('口径冲突：message 报的是台账声明的价格表（不混进章号）', clash[0]?.message.includes('100 / 500 / 2000') === true, clash[0]?.message)
  ok('口径冲突：证据是那一句', clash[0]?.evidence.includes('300') === true, clash[0]?.evidence)

  // summary
  ok('summary.items = 6', result.summary.items === 6, String(result.summary.items))
  ok('summary.chapters = 3', result.summary.chapters === 3, String(result.summary.chapters))
  ok('summary.unmapped = 1', result.summary.unmapped === 1, String(result.summary.unmapped))
  ok('summary.consumedReused = 1', result.summary.consumedReused === 1, String(result.summary.consumedReused))
  ok('summary.unregistered = 2（天罡符、新宝刀）', result.summary.unregistered === 2, String(result.summary.unregistered))
}

// ── 五、超出校对截止的汇总上限 ───────────────────────────────────────────────────
head('超出校对截止的汇总上限')
{
  const root = await fixture('## 道具\n\n| 名称 | 状态 | 首次出现 |\n|---|---|---|\n| 通灵镜 | 持有 | 第1章 |\n\n> 当前校对截止：第1章结束。\n')
  const names = ['灵犀丹', '云纹符', '断岳剑', '白鹤草', '碧玉果', '玄铁甲', '流光盘', '照心镜', '赤炎珠', '青锋刀', '紫电术', '天罡录']
  const chapter2 = '第2章 收获\n他把' + names.map((name) => `【${name}】`).join('') + '都收进了袋子。\n'
  const result = await ledgerCheck({ projectDir: root, chapters: [ch(1, '第1章 开头\n他握着【通灵镜】。\n'), ch(2, chapter2)] })
  const ahead = of(result, '超出校对截止')
  ok('第2章超出截止 → 报一条', ahead.length === 1, JSON.stringify(ahead.map((f) => f.message)))
  ok('名字最多列 8 个（数顿号最直接）', (ahead[0]?.message.match(/、/g) ?? []).length === 7, ahead[0]?.message)
  ok('多出来的名字用总数带过', ahead[0]?.message.includes('等 12 个') === true, ahead[0]?.message)
  ok('12 个未登记物品照样逐条报', of(result, '未登记物品').length === 12, String(of(result, '未登记物品').length))
}

// ── 六、误报控制 ──────────────────────────────────────────────────────────
head('误报控制')
{
  const root = await fixture(LEDGER)
  const result = await ledgerCheck({ projectDir: root, chapters: CHAPTERS })
  const fresh = of(result, '未登记物品')
  const reused = of(result, '已消耗又出现')
  const clash = of(result, '口径冲突')

  ok('已持有的通灵镜后文再用，不报「已消耗又出现」', reused.some((f) => f.item === '通灵镜') === false, JSON.stringify(reused.map((f) => f.item)))
  ok('已出售的断玉簪后文没再用，不报「已消耗又出现」', reused.some((f) => f.item === '断玉簪') === false)
  ok('已在台账里的物品不报「未登记物品」', fresh.some((f) => ['通灵镜', '青霜剑', '归元丹', '断玉簪'].includes(f.item)) === false, JSON.stringify(fresh.map((f) => f.item)))
  ok('方括号里的人名不报「未登记物品」', fresh.some((f) => f.item.includes('李大山')) === false, JSON.stringify(fresh.map((f) => f.item)))
  ok('引号里的人名不报「未登记物品」', fresh.some((f) => f.item.includes('苏清鸢')) === false)
  ok('台账价格表里有的 500 蕴灵币不报「口径冲突」', clash.some((f) => /按 500 蕴灵币/.test(f.message)) === false, JSON.stringify(clash.map((f) => f.message)))
  ok('只报那一笔金额，不做重复刷屏', clash.length === 1)

  // 只给前两章时，不该说"第3章的东西正文里没有"
  const partial = await ledgerCheck({ projectDir: root, chapters: CHAPTERS.slice(0, 2) })
  ok('没读到第3章就不下"正文没有"的结论', of(partial, '台账说有正文没有').some((f) => f.item === '青霜剑') === false)

  // 裸文本抽词的闸门：单次出现的"X+物品后缀"不当物品，出现两次以上才报
  const bareRoot = await fixture(LEDGER)
  const bare = await ledgerCheck({
    projectDir: bareRoot,
    chapters: [ch(1, '他随手把一枚回魂符塞进袖子，转身就走。'), ch(2, '那枚回魂符后来一直没用上，他又摸了一遍回魂符。')],
  })
  const bareHits = of(bare, '未登记物品').map((f) => f.item)
  ok('裸文本里出现两次的词会被当成候选', bareHits.includes('回魂符') === true, JSON.stringify(bareHits))
  const once = await ledgerCheck({ projectDir: bareRoot, chapters: [ch(1, '他随手把一枚回魂符塞进袖子，转身就走。')] })
  ok('只出现一次的裸词不报（宁少报不多报）', of(once, '未登记物品').length === 0, JSON.stringify(of(once, '未登记物品').map((f) => f.item)))
}

// ── 七、降级：没有台账 / 没给正文 ────────────────────────────────────────────────
head('降级')
{
  const noLedger = await fixture(null)
  const result = await ledgerCheck({ projectDir: noLedger, chapters: CHAPTERS })
  ok('没有台账时不出 findings，也不抛异常', result.findings.length === 0 && result.summary.items === 0, JSON.stringify(result))
  ok('没有台账时 summary.chapters 仍然如实', result.summary.chapters === 3)

  const root = await fixture(LEDGER)
  const empty = await ledgerCheck({ projectDir: root })
  ok('没给 chapters 时不出 findings', empty.findings.length === 0 && empty.summary.chapters === 0)
  ok('chapters 给垃圾值也降级', (await ledgerCheck({ projectDir: root, chapters: 'not-an-array' })).findings.length === 0)
  ok('chapters 里缺正文/缺章号的条目被跳过', (await ledgerCheck({ projectDir: root, chapters: [{ chapter: 1 }, { text: '正文但没有章号' }, null, 0] })).summary.chapters === 0)
  ok('空入参也能调用', (await ledgerCheck()).findings.length === 0)
  ok('章号能从标题里补出来', (await ledgerCheck({ projectDir: root, chapters: [{ title: '第2章 集市', text: '正文。' }] })).summary.chapters === 1)

  const bad = await fixture('# 台账\n\n这里没有表格。\n')
  const badResult = await ledgerCheck({ projectDir: bad, chapters: CHAPTERS })
  ok('台账解析不出一条物品时不出 findings（否则"未登记"对什么都成立）', badResult.findings.length === 0 && badResult.summary.items === 0)
}

// ── 八、真实台账（只读；本机没有就跳过） ──────────────────────────────────────────────
head('小节标题兜底首现章号')
{
  const parsed = parseLedger(
    [
      '# 台账',
      '',
      '## 宁陈：第8章西市所得',
      '',
      '| 名称 | 品级 | 第8章结束时状态 |',
      '|---|---|---|',
      '| 灵云匕 | 百里挑一 | 已出售给乘拾当铺 |',
      '',
      '## 系统通用规则',
      '',
      '| 项目 | 已确认设定 | 出处 |',
      '|---|---|---|',
      '| 抽取价格 | 100 / 500 | 第4章 |',
      '',
    ].join('\n'),
  )
  const sword = parsed.items.find((i) => i.name === '灵云匕')
  ok('没有首现列时用小节标题兜底章号', sword !== undefined && sword.firstChapter === 8, sword === undefined ? '没解析出来' : String(sword.firstChapter))
  ok('没有章号的小节仍然是 null', parsed.items.every((i) => i.category !== '系统通用规则' || i.firstChapter === null))
}

head('真实台账（只读）')
{
  const realDir = '/public/home/wangyg/novel/逐弈登仙'
  const realPath = join(realDir, '设定/道具与增益台账.md')
  if (existsSync(realPath)) {
    const ledger = await readLedger(realDir)
    ok('解析出 ≥15 个 item', ledger.items.length >= 15, String(ledger.items.length))
    ok('cutoffChapter === 8', ledger.cutoffChapter === 8, String(ledger.cutoffChapter))
    console.log(`  ℹ️ 真实台账解析出 ${ledger.items.length} 个 item，小节 ${ledger.sections.length} 个`)
  } else {
    console.log('  ⏭ 跳过：本机没有真实台账（不影响其它用例）')
  }
}

// ── 收尾 ──────────────────────────────────────────────────────────────────
for (const dir of created) await rm(dir, { recursive: true, force: true })
console.log(`\n${failures === 0 ? '全部通过 ✅' : `失败 ${failures} 项 ❌`}`)
process.exit(failures === 0 ? 0 : 1)
