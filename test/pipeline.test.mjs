/**
 * dsh-novel-craft 阶段化流水线单测
 *
 * 全部在临时作品目录里造数据（mkdtemp），不依赖任何本机路径：
 *   node test/pipeline.test.mjs
 *
 * 末尾有一个"真实作品目录"只读用例：目录不存在就跳过，不影响结果——
 * 它存在的意义是别让门禁只在假数据上好看（比如把全书合并稿当成一章）。
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  STAGES,
  STAGE_IDS,
  stageStatus,
  stagePrompt,
  parseOutlineNodes,
  chapterTextsPresent,
} from '../lib/core/pipeline.js'

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

/** 一句没有空白的正文（9 个字），用来精确造字数。 */
const PROSE = '宁陈抬头看了眼天。'
const longText = (chars) => PROSE.repeat(Math.ceil(chars / PROSE.length))

/** 临时作品目录：测试自己造、自己删，绝不碰作者的稿子。 */
async function makeBook(files = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-novel-craft-pipeline-'))
  const dir = join(root, '测试书')
  await mkdir(dir, { recursive: true })
  const put = async (rel, text) => {
    const path = join(dir, rel)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text, 'utf8')
    return path
  }
  for (const [rel, text] of Object.entries(files)) await put(rel, text)
  return { root, dir, put, cleanup: () => rm(root, { recursive: true, force: true }) }
}

const stageOf = (status, id) => status.stages.find((s) => s.id === id)
const gateOf = (status, id, code) => stageOf(status, id).gate.find((g) => g.code === code)

/** 现成的"完整作品"：七个阶段都齐活，用来测"产物齐全 → complete"。 */
const FULL_SETTING = { '设定/世界观.md': longText(300) }
const FULL_LEDGER = {
  '设定/道具与增益台账.md': [
    '# 道具与增益台账',
    '',
    '> 只记录正文已经明示的道具，未经正文确认的内容不自行补全。',
    '',
    '| 名称 | 状态 | 首次出现 |',
    '|---|---|---|',
    '| 灵云匕 | 已出售给乘拾当铺 | 第8章 |',
    '| 云雷石 | 已消耗 | 第8章 |',
    '| 追踪缕 | 已植入李大可 | 第6章 |',
    '',
  ].join('\n'),
}
const FULL_OUTLINE = [
  '# 大纲',
  '',
  '## 第1章 血炼台上',
  '- 目标：让宁陈第一次用通透世界看清规则',
  '- 冲突：金海抢在他前面动手',
  '- 转折：他发现自己也可能成为目标',
  '- 埋：血炼台上的第三块黑石',
  '',
  '## 第2章 拜师青云',
  '- 目标：进青云宗',
  '- 冲突：灵根太差，被外门弟子排挤',
  '',
].join('\n')

// ---------------------------------------------------------------------------
head('阶段定义表')
{
  ok('STAGES 的 id 与 STAGE_IDS 完全一致', STAGES.map((s) => s.id).join(',') === STAGE_IDS.join(','), STAGES.map((s) => s.id).join(','))
  ok('STAGE_IDS 就是七步流程', STAGE_IDS.join(',') === 'idea,setting,cast,outline,chapter,revise,finish')
  ok(
    'order 从 1 连续到 7',
    STAGES.every((s, i) => s.order === i + 1),
    STAGES.map((s) => String(s.order)).join(','),
  )
  ok(
    '中文名就是 立项/设定/人物/大纲/逐章正文/修订/完本',
    STAGES.map((s) => s.name).join('/') === '立项/设定/人物/大纲/逐章正文/修订/完本',
    STAGES.map((s) => s.name).join('/'),
  )
  ok(
    '每个阶段七个字段齐全且类型对',
    STAGES.every(
      (s) =>
        typeof s.id === 'string' &&
        typeof s.name === 'string' &&
        typeof s.order === 'number' &&
        Array.isArray(s.artifacts) &&
        typeof s.produce === 'string' &&
        s.produce !== '' &&
        typeof s.hint === 'string' &&
        s.hint !== '' &&
        typeof s.prompt?.system === 'string' &&
        s.prompt.system !== '' &&
        typeof s.prompt?.user === 'string' &&
        s.prompt.user !== '',
    ),
  )
  ok(
    '每条产物都有 path/label/minChars',
    STAGES.every((s) =>
      s.artifacts.every(
        (a) => typeof a.path === 'string' && a.path !== '' && typeof a.label === 'string' && a.label !== '' && typeof a.minChars === 'number',
      ),
    ),
    JSON.stringify(STAGES.map((s) => s.artifacts.length)),
  )
  ok(
    '七个 system 都写了"只输出产物正文"这条纪律',
    STAGES.every((s) => s.prompt.system.includes('只输出')),
  )
  ok(
    '七个 system 都带上了铁律与 {profile}',
    STAGES.every((s) => s.prompt.system.includes('正文原文不进上下文') && s.prompt.system.includes('{profile}')),
  )
  ok(
    '七个 user 都带上了档案/上游/作品名/额外要求',
    STAGES.every(
      (s) =>
        s.prompt.user.includes('{profile}') &&
        s.prompt.user.includes('{upstream}') &&
        s.prompt.user.includes('{projectName}') &&
        s.prompt.user.includes('{extra}'),
    ),
  )
  {
    // 模板里出现没实现的占位符，替换后就会原样喂给模型——这条断言专治手滑拼错
    const known = new Set(['projectName', 'profile', 'upstream', 'chapters', 'chapter', 'extra'])
    const unknown = new Set()
    for (const stage of STAGES) {
      for (const text of [stage.prompt.system, stage.prompt.user]) {
        for (const m of text.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)) {
          if (!known.has(m[1])) unknown.add(stage.id + ':' + m[1])
        }
      }
    }
    ok('模板里没有未实现的占位符', unknown.size === 0, [...unknown].join(','))
  }
}

// ---------------------------------------------------------------------------
head('门禁：空目录 / 目录不存在')
{
  const book = await makeBook()
  const status = await stageStatus({ projectDir: book.dir })
  ok('空目录：七个阶段都在，done=0', status.stages.length === 7 && status.total === 7 && status.done === 0)
  ok('空目录：current 指向第一步 idea', status.current === 'idea', String(status.current))
  ok('空目录：每个阶段都有中文 note', status.stages.every((s) => typeof s.note === 'string' && s.note !== ''))
  ok('空目录：每个阶段都不 complete', status.stages.every((s) => s.complete === false))
  {
    const idea = stageOf(status, 'idea')
    const brief = idea.artifacts[0]
    ok('空目录：立项产物 exists=false、bytes=0（不抛异常）', brief.exists === false && brief.bytes === 0 && brief.ok === false)
    ok('空目录：立项被 blocked', idea.blocked === true)
    ok(
      '空目录：立项门禁 code/level/message 一字不差',
      idea.gate.length === 1 &&
        idea.gate[0].code === 'idea-brief' &&
        idea.gate[0].level === 'error' &&
        idea.gate[0].message === '先写立项：一句话卖点、目标平台、目标字数、读者画像',
      JSON.stringify(idea.gate[0]),
    )
  }
  {
    const status2 = await stageStatus({ projectDir: join(book.root, '这个目录不存在') })
    ok('目录不存在：不抛异常，全部 exists=false', status2.current === 'idea' && status2.stages.every((s) => s.artifacts.every((a) => a.exists === false)))
    const status3 = await stageStatus({})
    ok('不传 projectDir：不抛异常', stageOf(status3, 'finish').blocked === true)
    const status4 = await stageStatus()
    ok('完全不传参数：不抛异常且可 JSON 序列化', JSON.parse(JSON.stringify(status4)).stages.length === 7)
  }
  {
    const json = JSON.parse(JSON.stringify(status))
    ok('返回值是可 JSON 序列化的普通对象', json.stages.length === 7 && typeof json.stages[0].artifacts[0].label === 'string')
  }
  await book.cleanup()
}

// ---------------------------------------------------------------------------
head('门禁：idea 立项')
{
  const short = await makeBook({ '设定/立项.md': longText(45) })
  const s1 = await stageStatus({ projectDir: short.dir })
  ok('立项不到 100 字：产物存在但不 ok、被 blocked', stageOf(s1, 'idea').artifacts[0].exists === true && stageOf(s1, 'idea').blocked === true)
  await short.cleanup()

  const full = await makeBook({ '设定/立项.md': longText(120) })
  const s2 = await stageStatus({ projectDir: full.dir })
  const idea = stageOf(s2, 'idea')
  ok('立项写够了：complete=true 且 artifacts.ok=true', idea.complete === true && idea.artifacts[0].ok === true && idea.artifacts[0].bytes > 0)
  ok('立项写够了：门禁放行并报字数', gateOf(s2, 'idea', 'idea-brief').ok === true && gateOf(s2, 'idea', 'idea-brief').message.includes('字'))
  ok('立项写够了：current 前进到设定', s2.current === 'setting' && s2.done === 1, String(s2.current))
  await full.cleanup()
}

// ---------------------------------------------------------------------------
head('门禁：setting 设定')
{
  const onlyWorld = await makeBook(FULL_SETTING)
  const s1 = await stageStatus({ projectDir: onlyWorld.dir })
  ok('只有世界观：被 blocked（缺台账）', stageOf(s1, 'setting').blocked === true && gateOf(s1, 'setting', 'setting-ledger').ok === false)
  await onlyWorld.cleanup()

  const noItem = await makeBook({ ...FULL_SETTING, '设定/道具与增益台账.md': '# 台账\n\n|---|---|\n' })
  const s2 = await stageStatus({ projectDir: noItem.dir })
  ok('台账没有表格行：setting-ledger-item 不过', gateOf(s2, 'setting', 'setting-ledger-item').ok === false && stageOf(s2, 'setting').blocked === true)
  ok('台账门禁带提示话术', gateOf(s2, 'setting', 'setting-ledger-item').message.includes('物品条目'))
  await noItem.cleanup()

  const full = await makeBook({ ...FULL_SETTING, ...FULL_LEDGER })
  const s3 = await stageStatus({ projectDir: full.dir })
  const setting = stageOf(s3, 'setting')
  ok('世界观 + 台账（含条目）：complete=true', setting.complete === true && setting.blocked === false)
  ok('两份产物都 ok 且报了字节数', setting.artifacts.every((a) => a.ok === true && a.bytes > 0))
  ok('台账门禁报出条目行数', gateOf(s3, 'setting', 'setting-ledger-item').message.includes('表格记录'))
  await full.cleanup()
}

// ---------------------------------------------------------------------------
head('门禁：cast 人物')
{
  const none = await makeBook({})
  const s1 = await stageStatus({ projectDir: none.dir })
  ok('没有人物目录：cast-roster 与 cast-cards 都不过', gateOf(s1, 'cast', 'cast-roster').ok === false && gateOf(s1, 'cast', 'cast-cards').ok === false)
  ok('人物阶段被 blocked', stageOf(s1, 'cast').blocked === true)
  await none.cleanup()

  const bad = await makeBook({ '人物/主要人物列表.json': '{ "小说名称": ' })
  const s2 = await stageStatus({ projectDir: bad.dir })
  ok('名单是坏 JSON：cast-roster 不过', gateOf(s2, 'cast', 'cast-roster').ok === false && stageOf(s2, 'cast').blocked === true)
  await bad.cleanup()

  const str = await makeBook({ '人物/主要人物列表.json': '"只是一句话"' })
  const s3 = await stageStatus({ projectDir: str.dir })
  ok('名单是合法 JSON 但不是数组/对象：仍然不过', gateOf(s3, 'cast', 'cast-roster').ok === false)
  await str.cleanup()

  const two = await makeBook({
    '人物/主要人物列表.json': '{"小说名称":"测试书","人物分类":{}}',
    '人物/宁陈.json': '{"姓名":"宁陈","身份":"玩家"}',
  })
  const s4 = await stageStatus({ projectDir: two.dir })
  ok('人物卡片不足 3 张：cast-cards 不过并报出张数', gateOf(s4, 'cast', 'cast-cards').ok === false && gateOf(s4, 'cast', 'cast-cards').message.includes('只有 2 张'))
  await two.cleanup()

  const full = await makeBook({
    '人物/主要人物列表.json': '{"小说名称":"测试书","人物分类":{"玩家":["宁陈"]}}',
    '人物/宁陈.json': '{"姓名":"宁陈","身份":"玩家","境界":"练气","人物关系":{"苏清鸢":"同门"}}',
    '人物/苏清鸢.json': '{"姓名":"苏清鸢","身份":"NPC","境界":"金丹","人物关系":{"宁陈":"同门"}}',
  })
  const s5 = await stageStatus({ projectDir: full.dir })
  const cast = stageOf(s5, 'cast')
  ok('名单 + 3 张卡片：complete=true', cast.complete === true && cast.blocked === false)
  ok('人物产物路径与字节数都正常', cast.artifacts[0].path === '人物/主要人物列表.json' && cast.artifacts[0].bytes > 0)
  await full.cleanup()
}

// ---------------------------------------------------------------------------
head('门禁：outline 大纲')
{
  const none = await makeBook({})
  const s1 = await stageStatus({ projectDir: none.dir })
  ok('没有大纲文件：outline-file 与 outline-node 都不过', gateOf(s1, 'outline', 'outline-file').ok === false && gateOf(s1, 'outline', 'outline-node').ok === false)
  await none.cleanup()

  const noNode = await makeBook({ '大纲.md': '# 大纲\n\n先写着，回头再补分章。\n' })
  const s2 = await stageStatus({ projectDir: noNode.dir })
  ok('大纲没有章节点：outline-node 不过并给出格式提示', gateOf(s2, 'outline', 'outline-node').ok === false && gateOf(s2, 'outline', 'outline-node').message.includes('## 第N章 标题'))
  await noNode.cleanup()

  const noEvent = await makeBook({
    '大纲.md': '# 大纲\n\n## 第1章 开局\n- 目标：见到金海\n\n## 第2章 修炼\n- 转折：他觉得该闭关了\n',
  })
  const s3 = await stageStatus({ projectDir: noEvent.dir })
  const fields = gateOf(s3, 'outline', 'outline-node-fields')
  ok('有节点没目标也没冲突：outline-node-fields 不过', fields.ok === false && stageOf(s3, 'outline').blocked === true)
  ok('缺字段的门禁点名到章号', fields.message.includes('第 2 章') && !fields.message.includes('第 1 章'), fields.message)
  await noEvent.cleanup()

  const full = await makeBook({ '大纲.md': FULL_OUTLINE })
  const s4 = await stageStatus({ projectDir: full.dir })
  const outline = stageOf(s4, 'outline')
  ok('大纲齐全：complete=true，节点数与字数字段正常', outline.complete === true && gateOf(s4, 'outline', 'outline-node').message.includes('2 个章节点'))
  ok('大纲产物 ok', outline.artifacts[0].ok === true && outline.artifacts[0].minChars === 100)
  await full.cleanup()
}

// ---------------------------------------------------------------------------
head('门禁：chapter 逐章正文')
{
  const none = await makeBook({})
  const s1 = await stageStatus({ projectDir: none.dir })
  ok('没有正文：chapter-has-text 不过并被 blocked', gateOf(s1, 'chapter', 'chapter-has-text').ok === false && stageOf(s1, 'chapter').blocked === true)
  ok('正文产物通配表达式 exists=false', stageOf(s1, 'chapter').artifacts[0].exists === false)
  await none.cleanup()

  const one = await makeBook({ '测试书-第1章.txt': longText(1000) })
  const s2 = await stageStatus({ projectDir: one.dir })
  const chapter = stageOf(s2, 'chapter')
  ok('有一章正文：complete=true 且产物 ok/bytes>0', chapter.complete === true && chapter.artifacts[0].ok === true && chapter.artifacts[0].bytes > 0)
  ok('已写章数报出来', gateOf(s2, 'chapter', 'chapter-has-text').message.includes('已写 1 章'))
  ok('字数够的章不触发短章提醒', gateOf(s2, 'chapter', 'chapter-short').ok === true)
  await one.cleanup()

  const short = await makeBook({ '测试书-第1章.txt': longText(1000), '测试书-第2章.txt': longText(180) })
  const s3 = await stageStatus({ projectDir: short.dir })
  const shortGate = gateOf(s3, 'chapter', 'chapter-short')
  ok('有不到 800 字的章：报 warn 并点名章号', shortGate.ok === false && shortGate.level === 'warn' && shortGate.message.includes('第 2 章'), shortGate.message)
  ok('warn 不阻塞：依然 complete（作者可以显式放行）', stageOf(s3, 'chapter').blocked === false && stageOf(s3, 'chapter').complete === true)
  ok('阶段 note 里带着这条提醒', stageOf(s3, 'chapter').note.includes('先看一眼'))
  await short.cleanup()

  const mixed = await makeBook({
    '测试书-第1章.txt': longText(1000),
    '测试书-第2章.txt': longText(1000),
    '章节/第 3 章 猎妖.txt': longText(900),
    '测试书.txt': longText(3000),
  })
  const s4 = await stageStatus({ projectDir: mixed.dir })
  ok('章节/ 目录的正文也算已写（第 3 章）', gateOf(s4, 'chapter', 'chapter-has-text').message.includes('已写 3 章'), gateOf(s4, 'chapter', 'chapter-has-text').message)
  ok('全书合并稿不会被当成一章', !gateOf(s4, 'chapter', 'chapter-has-text').message.includes('已写 4 章'))
  ok('章节/ 布局也算进产物字节数', stageOf(s4, 'chapter').artifacts[0].bytes > 3000)
  {
    // 上层读好的正文优先：只传一章也算已写，不用重新扫盘
    const s5 = await stageStatus({ projectDir: mixed.dir, chapters: [{ chapter: 9, title: '新章', text: longText(1000) }] })
    ok('上层传进来的 chapters 也算已写章节', gateOf(s5, 'chapter', 'chapter-has-text').message.includes('已写 4 章'), gateOf(s5, 'chapter', 'chapter-has-text').message)
    const s6 = await stageStatus({ projectDir: mixed.dir, chapters: [{ chapter: 9, title: '占位', text: '   \n  ' }] })
    ok('只有空白的章不算已写', gateOf(s6, 'chapter', 'chapter-has-text').message.includes('已写 3 章'))
  }
  await mixed.cleanup()
}

// ---------------------------------------------------------------------------
head('门禁：revise 修订')
{
  const book = await makeBook({
    '测试书-第1章.txt': longText(1000),
    '大纲.md': FULL_OUTLINE,
    '修订清单.md': longText(200),
  })
  const open = await stageStatus({
    projectDir: book.dir,
    annotations: [
      { chapter: 1, status: 'open' },
      { chapter: 1, status: 'resolved' },
      { chapter: 3, status: 'open' },
      { chapter: 5, status: 'ignored' },
    ],
  })
  const gate = gateOf(open, 'revise', 'revise-open')
  ok('有 open 批注：报 warn 且不 blocked', gate.ok === false && gate.level === 'warn' && stageOf(open, 'revise').blocked === false)
  ok('warn 不拦"做完"：修订清单在，阶段仍算 complete', stageOf(open, 'revise').complete === true)
  ok('批注门禁报出条数并列出章号', gate.message.includes('还有 2 条批注没处理') && gate.message.includes('第 1、3 章'), gate.message)

  const done = await stageStatus({ projectDir: book.dir, annotations: [{ chapter: 1, status: 'resolved' }] })
  ok('批注都处理完了：门禁放行', gateOf(done, 'revise', 'revise-open').ok === true && gateOf(done, 'revise', 'revise-open').message.includes('处理完'))

  const empty = await stageStatus({ projectDir: book.dir })
  ok('没有批注数据：也放行，但说清是没读到数据', gateOf(empty, 'revise', 'revise-open').ok === true && gateOf(empty, 'revise', 'revise-open').message.includes('没读到批注数据'))
  ok('修订的产物就是它的 produce（修订清单.md）', stageOf(empty, 'revise').artifacts[0].path === '修订清单.md' && stageOf(empty, 'revise').artifacts[0].ok === true)

  const noList = await makeBook({ '测试书-第1章.txt': longText(1000), '大纲.md': FULL_OUTLINE })
  const s = await stageStatus({ projectDir: noList.dir })
  ok('没有修订清单：阶段不 complete，但不 blocked（作者可显式放行）', stageOf(s, 'revise').complete === false && stageOf(s, 'revise').blocked === false)
  ok('没有修订清单：note 说清差什么', stageOf(s, 'revise').note.includes('修订清单'), stageOf(s, 'revise').note)
  await noList.cleanup()
  await book.cleanup()
}

// ---------------------------------------------------------------------------
head('门禁：finish 完本')
{
  const noMerged = await makeBook({ '测试书-第1章.txt': longText(1000), '测试书-第3章.txt': longText(1000) })
  const s1 = await stageStatus({ projectDir: noMerged.dir })
  const merged = gateOf(s1, 'finish', 'finish-merged')
  ok('没有全书合并稿：error 且 blocked', merged.ok === false && merged.level === 'error' && stageOf(s1, 'finish').blocked === true)
  ok('合并稿门禁报出书名文件名', merged.message.includes('测试书.txt'), merged.message)
  const gap = gateOf(s1, 'finish', 'finish-chapter-gap')
  ok('缺章报 warn 并点名第 2 章', gap.ok === false && gap.level === 'warn' && gap.message.includes('第 2 章'), gap.message)
  ok('缺章 warn 不阻塞（blocked 只因合并稿）', stageOf(s1, 'finish').artifacts[0].ok === false && s1.current === 'idea')
  await noMerged.cleanup()

  const book = await makeBook({
    '测试书-第1章.txt': longText(1000),
    '测试书-第2章.txt': longText(1000),
    '测试书.txt': longText(1200),
    ...FULL_LEDGER,
  })
  const s2 = await stageStatus({ projectDir: book.dir })
  const finish = stageOf(s2, 'finish')
  ok('有合并稿：finish 不再 blocked 且产物 ok', finish.blocked === false && finish.artifacts[0].ok === true)
  ok('产物路径里的 {projectName} 被换成真书名', finish.artifacts[0].path === '测试书.txt', finish.artifacts[0].path)
  ok('正文连续：缺章门禁放行', gateOf(s2, 'finish', 'finish-chapter-gap').ok === true)

  // 台账比最新正文旧 → 体检提示亮起（用显式 mtime，别靠文件创建顺序）
  const ledgerPath = join(book.dir, '设定/道具与增益台账.md')
  await utimes(ledgerPath, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'))
  const s3 = await stageStatus({ projectDir: book.dir })
  const health = gateOf(s3, 'finish', 'finish-health')
  ok('台账比正文旧：体检提示报 warn', health.ok === false && health.level === 'warn' && health.message.includes('台账'), health.message)
  ok('体检提示只做提示，不阻塞', stageOf(s3, 'finish').blocked === false)

  const s4 = await stageStatus({ projectDir: book.dir, annotations: [{ chapter: 1, status: 'open' }] })
  ok('还有批注没处理：完本前也会提示', gateOf(s4, 'finish', 'finish-health').message.includes('批注'))
  await book.cleanup()
}

// ---------------------------------------------------------------------------
head('与上层的接口形状（上层只传 chars、不传正文也要能跑）')
{
  const book = await makeBook({ '测试书-第1章.txt': longText(1000), '测试书-第2章.txt': longText(1000) })
  const declared = [
    { chapter: 1, title: '开局', chars: 1200, text: '' },
    { chapter: 2, title: '拜师', chars: 300, text: '' },
    { chapter: 6, title: '还没写', chars: 0, text: '' },
  ]
  const status = await stageStatus({ projectDir: book.dir, chapters: declared })
  const hasText = gateOf(status, 'chapter', 'chapter-has-text')
  ok('只给 chars 的章也算已写（上层已经把正文读过了）', hasText.message.includes('已写 2 章'), hasText.message)
  ok('chars 为 0 的章不算已写', !hasText.message.includes('6'), hasText.message)
  ok('短章检查用上层给的字数', gateOf(status, 'chapter', 'chapter-short').message.includes('第 2 章'), gateOf(status, 'chapter', 'chapter-short').message)

  // 上游按上层真实拼法给：分章大纲 + 人物卡 + 上一章结尾，缺一不可（正文原文不进上下文）
  const prompt = stagePrompt('chapter', {
    projectName: '测试书',
    profile: '## 避免的写法\n- 不要写解释性旁白',
    upstream: [
      { label: '分章大纲', text: '## 第4章 开局\n- 目标：进城' },
      { label: '主要人物列表', text: '宁陈：玩家' },
      { label: '第3章 结尾', text: '他推开门。' },
    ],
    chapters: declared,
    chapter: 4,
  })
  ok(
    '提示词里的已写章节摘要用的是上层给的字数',
    prompt.user.includes('第1章 开局（约 1200 字）') && prompt.user.includes('第2章 拜师（约 300 字）'),
    prompt.user.split('\n').find((line) => line.includes('第1章')),
  )
  ok('只传 chars 也不会把正文带进上下文', !prompt.user.includes(PROSE) && prompt.missing.length === 0, JSON.stringify(prompt.missing))
  await book.cleanup()
}
{
  const chapter = STAGES.find((s) => s.id === 'chapter')
  ok('逐章正文的 produce 只留 {chapter}，不给上层留替换不掉的花括号', !chapter.produce.includes('{projectName}') && chapter.produce.includes('{chapter}'), chapter.produce)
  ok('按上层的方式只是替换章号，路径依然干净', chapter.produce.replace('{chapter}', '8') === '章节/第8章.txt', chapter.produce)
  const finish = STAGES.find((s) => s.id === 'finish')
  ok('完本的合并稿由 stageStatus 自己把 {projectName} 换掉（上层不拼它）', finish.artifacts[0].path === '{projectName}.txt')
}

// ---------------------------------------------------------------------------
head('stagePrompt 提示词')
{
  const context = () => ({
    projectName: '测试书',
    profile: '# 作者偏好档案\n\n## 已验证偏好\n- 多用对话推进\n\n## 避免的写法\n- 不要写解释性旁白',
    upstream: [{ label: '分章大纲', text: '## 第1章 开局\n- 目标：见到金海' }],
    chapters: [{ chapter: 1, title: '开局', text: longText(1200) }],
    chapter: 2,
    extra: '这一章要出现第三个玩家',
  })
  const RESERVED = ['{profile}', '{upstream}', '{chapter}', '{chapters}', '{projectName}', '{extra}']

  for (const stage of STAGES) {
    const prompt = stagePrompt(stage.id, context())
    const residue = [...RESERVED.filter((t) => prompt.user.includes(t) || prompt.system.includes(t))]
    const anyBrace = /\{[A-Za-z][A-Za-z0-9_]*\}/.exec(prompt.user + prompt.system)
    if (anyBrace !== null) residue.push(anyBrace[0])
    ok(`stagePrompt(${stage.id})：占位符替换干净，没有 {xxx} 残留`, residue.length === 0, residue.join(','))
    ok(
      `stagePrompt(${stage.id})：档案/上游/作品名/额外要求都进了 user`,
      prompt.user.includes('不要写解释性旁白') &&
        prompt.user.includes('分章大纲') &&
        prompt.user.includes('见到金海') &&
        prompt.user.includes('测试书') &&
        prompt.user.includes('这一章要出现第三个玩家'),
    )
    const expectedProduce = stage.produce.replace('{projectName}', '测试书').replace('{chapter}', '2')
    ok(`stagePrompt(${stage.id})：产物路径写进了 user`, prompt.user.includes(expectedProduce), expectedProduce)
    ok(`stagePrompt(${stage.id})：system 不为空`, prompt.system.length > 100)
  }

  {
    const chapter = stagePrompt('chapter', context())
    ok('逐章正文：user 带上了本章章号', chapter.user.includes('【本章章号】2'), chapter.user.split('\n')[3])
    ok(
      '逐章正文：user 带上了已写章节摘要',
      chapter.user.includes(`第1章 开局（约 ${longText(1200).length} 字）`),
      chapter.user.split('\n').find((line) => line.includes('第1章')),
    )
    ok('逐章正文：已写章节只给摘要，正文一个字都不进上下文', !chapter.user.includes(PROSE))
    ok('逐章正文：system 强调接住上一章与兑现本章节点', chapter.system.includes('接住上一章') && chapter.system.includes('兑现本章大纲节点'))
    ok(
      '逐章正文：交付要求里点名偏好档案的「避免」条目',
      chapter.user.includes('避免的写法') && chapter.user.includes('偏好档案'),
    )
  }
  {
    const idea = stagePrompt('idea', context())
    ok('立项：要求结构化 markdown', idea.user.includes('结构化 markdown'))
    ok('立项：missing 为空（立项本来就不需要上游）', idea.missing.length === 0, JSON.stringify(idea.missing))
    const outline = stagePrompt('outline', { ...context(), upstream: [] })
    ok('起草大纲但没给人物：missing 点名人物', outline.missing.includes('人物'), JSON.stringify(outline.missing))
    ok('起草大纲但没给世界观：missing 点名世界观', outline.missing.includes('世界观'))
    ok('上游是空的时候 user 里写明"不要凭空编"', outline.user.includes('不要凭空编'))
    const outlineFull = stagePrompt('outline', { ...context(), upstream: [{ label: '人物卡', text: '宁陈：玩家' }, { label: '世界观设定', text: '境界：练气' }] })
    ok('上游补齐后 missing 清空', outlineFull.missing.length === 0, JSON.stringify(outlineFull.missing))
    const outlineEmptyText = stagePrompt('outline', { ...context(), upstream: [{ label: '人物卡', text: '   ' }, { label: '世界观设定', text: '境界：练气' }] })
    ok('上游条目只有空白＝没给：missing 仍然点名人物', outlineEmptyText.missing.includes('人物'))
  }
  {
    const noPrev = stagePrompt('chapter', { ...context(), upstream: [{ label: '分章大纲', text: '大纲正文' }] })
    ok('写第 2 章却没有上一章剧情总结：missing 提醒', noPrev.missing.some((m) => m.includes('第1章')), JSON.stringify(noPrev.missing))
    const withPrev = stagePrompt('chapter', { ...context(), upstream: [{ label: '分章大纲', text: '大纲正文' }, { label: '第1章剧情总结', text: '宁陈进了城' }] })
    ok('给了上一章剧情总结：missing 不再提', !withPrev.missing.some((m) => m.includes('第1章')), JSON.stringify(withPrev.missing))
    const keywordPrev = stagePrompt('chapter', { ...context(), chapter: 5, upstream: [{ label: '大纲', text: '大纲正文' }, { label: '上一章结尾摘录', text: '他推开门' }] })
    ok('上一章结尾摘录也算（label 含"上一章"）', !keywordPrev.missing.some((m) => m.includes('第4章')), JSON.stringify(keywordPrev.missing))
    const noChapter = stagePrompt('chapter', { ...context(), chapter: null })
    ok('没给章号：missing 点名章号，user 里也不留空占位', noChapter.missing.includes('章号') && noChapter.user.includes('（待定）'))
    const noProfile = stagePrompt('chapter', { ...context(), profile: '' })
    ok('没有偏好档案：missing 点名「作者偏好档案」', noProfile.missing.includes('作者偏好档案'))
    ok('没有偏好档案：user 里说清现在只能靠通用手感', noProfile.user.includes('作者偏好档案还没建立'))
  }
  {
    const unknown = stagePrompt('不存在的阶段', context())
    ok('未知阶段 id：不抛异常，返回空提示 + 说明', unknown.system === '' && unknown.user === '' && unknown.missing[0].includes('未知阶段'))
    const noArgs = stagePrompt('idea')
    ok('不传 context：也不抛异常，占位符照样替换干净', noArgs.user.length > 100 && !noArgs.user.includes('{extra}'))
    const nullContext = stagePrompt('idea', null)
    ok('context 传 null：不抛异常', nullContext.user.includes('（未命名作品）'))
  }
}

// ---------------------------------------------------------------------------
head('parseOutlineNodes 大纲解析')
{
  const dashed = parseOutlineNodes(FULL_OUTLINE)
  ok('写法一（## 第N章 + 短横字段）：解析出 2 个节点', dashed.length === 2, String(dashed.length))
  ok(
    '写法一：章号/标题/目标/冲突/埋都对',
    dashed[0].chapter === 1 && dashed[0].title === '血炼台上' && dashed[0].goal.includes('通透世界') && dashed[0].conflict.includes('金海') && dashed[0].plant.includes('第三块黑石'),
    JSON.stringify(dashed[0]),
  )
  ok('写法一：没写的字段是空字符串而不是 undefined', dashed[1].turn === '' && dashed[0].payoff === '')

  const bold = parseOutlineNodes(
    ['# 大纲', '', '### 第 2 章 拜师青云', '**目标**：进青云宗', '**冲突**：灵根太差', '埋（伏笔）：半块木牌', '收（伏笔）：第 9 章兑现', ''].join('\n'),
  )
  ok('写法二（### 第 N 章 + 加粗字段）：解析出 1 个节点', bold.length === 1, String(bold.length))
  ok(
    '写法二：字段名带括号/加粗也能认',
    bold[0].chapter === 2 && bold[0].title === '拜师青云' && bold[0].goal === '进青云宗' && bold[0].plant === '半块木牌' && bold[0].payoff === '第 9 章兑现',
    JSON.stringify(bold[0]),
  )

  const merged = parseOutlineNodes(['## 第3章 猎妖', '- 埋：追踪缕', '- 埋：听风吟', '- 目标：追上狼妖', ''].join('\n'))
  ok('同一字段多行按「；」合并（一章埋两条不丢）', merged[0].plant === '追踪缕；听风吟', merged[0].plant)

  ok('空文本 → 空数组', parseOutlineNodes('').length === 0 && parseOutlineNodes(undefined).length === 0)
  ok('没有章节点 → 空数组', parseOutlineNodes('# 大纲\n\n随便写点东西。\n').length === 0)
  {
    // 卷名这种标题会打断节点：它下面的字段不该被塞进上一个节点
    const withVolume = parseOutlineNodes(['## 第1章 开局', '- 目标：见到金海', '', '## 第一卷 卷尾说明', '- 目标：这行属于卷名，不该算进第 1 章', ''].join('\n'))
    ok('卷名标题打断节点，后续字段不归上一章', withVolume.length === 1 && withVolume[0].goal === '见到金海', JSON.stringify(withVolume))
  }
  {
    const cn = parseOutlineNodes('## 第一章 血炼台上\n- 目标：活下来\n')
    ok('中文数字章号也能解析', cn.length === 1 && cn[0].chapter === 1)
  }
}

// ---------------------------------------------------------------------------
head('chapterTextsPresent 边界')
{
  ok('空数组 → 空结果', chapterTextsPresent('/tmp/随便', []).length === 0)
  ok('不是数组 → 空结果', chapterTextsPresent('/tmp/随便', undefined).length === 0 && chapterTextsPresent('/tmp/随便', null).length === 0)
  ok('只有空白的章不算已写', chapterTextsPresent('/tmp/随便', [{ chapter: 1, text: '  \n\t ' }]).length === 0)
  ok('没有 text 字段的章不算已写', chapterTextsPresent('/tmp/随便', [{ chapter: 1, title: '占位' }]).length === 0)
  ok('只给 chars（上层已经数好字数）的章算已写', chapterTextsPresent('/tmp/随便', [{ chapter: 3, chars: 900, text: '' }]).join(',') === '3')
  ok('chars 为 0 的不算已写', chapterTextsPresent('/tmp/随便', [{ chapter: 3, chars: 0, text: '' }]).length === 0)
  ok('章号是字符串也认', chapterTextsPresent('/tmp/随便', [{ chapter: '3', text: '正文' }]).join(',') === '3')
  ok('章号不是数字的条目直接丢掉', chapterTextsPresent('/tmp/随便', [{ chapter: '序章', text: '正文' }, { chapter: null, text: '正文' }]).length === 0)
  ok('重复章号去重', chapterTextsPresent('/tmp/随便', [{ chapter: 3, text: '正文' }, { chapter: 3, text: '另一份' }]).join(',') === '3')
  ok('返回升序章号', chapterTextsPresent('/tmp/随便', [{ chapter: 5, text: 'a' }, { chapter: 2, text: 'b' }, { chapter: 11, text: 'c' }]).join(',') === '2,5,11')
  ok('纯函数：目录不存在也不报错（不碰磁盘）', chapterTextsPresent('/绝对不存在的目录/xyz', [{ chapter: 1, text: '正文' }]).join(',') === '1')
}

// ---------------------------------------------------------------------------
head('真实作品目录（只读，缺了就跳过）')
{
  const REAL = '/public/home/wangyg/novel/逐弈登仙'
  if (!existsSync(REAL)) {
    console.log('  ⏭️  本机没有真实作品目录，跳过（不判失败）')
  } else {
    const status = await stageStatus({ projectDir: REAL })
    ok('真实作品：七个阶段都在', status.stages.length === 7)
    ok('真实作品：章节门禁认出了正文', gateOf(status, 'chapter', 'chapter-has-text').ok === true, gateOf(status, 'chapter', 'chapter-has-text').message)
    ok('真实作品：全书合并稿没被当成一章', !gateOf(status, 'chapter', 'chapter-has-text').message.includes('已写 0 章'))
    ok('真实作品：合并稿 逐弈登仙.txt 被 finish 认可', gateOf(status, 'finish', 'finish-merged').ok === true, gateOf(status, 'finish', 'finish-merged').message)
    console.log(`     · 当前阶段：${String(status.current)}；完成 ${status.done}/${status.total} 步`)
  }
}

console.log(`\n${failures === 0 ? '全部通过 ✅' : `失败 ${failures} 项 ❌`}`)
process.exit(failures === 0 ? 0 : 1)
