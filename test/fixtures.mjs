/**
 * 测试用的作品目录夹具：临时造一棵"作者的稿子"目录树。
 *
 * 早期版本的测试直接指向作者本机的真实作品目录，别人 clone 下来必红，
 * 还会往人家的稿子旁边写 marks.json。现在所有测试都在临时目录里造数据：
 * 结构照真实用法来（章节正文 + factory/runs/.../候选稿 + 归档），断言才有意义。
 *
 * 用法：
 *   const ws = await createWorkspace()
 *   ws.root          → 作品根（相当于作者选中的候选目录的上级）
 *   ws.bookDir       → <root>/逐弈登仙
 *   ws.chapterDir('第9章') → <root>/factory/runs/逐弈登仙/第9章
 *   ws.draftsDir('第9章')  → <root>/factory/runs/逐弈登仙/第9章/候选稿
 *   await ws.cleanup()
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 几段像样的中文正文：够切段、够提炼，又不拖慢测试。 */
const PARAGRAPHS = [
  '男人猥琐的眼神仍在她露出的每一分肌肤上游走，此刻更是第一个发现她手上多了东西，便贴了过来，眼里发亮如抓住救命稻草，声音却压得极低格外刺耳。',
  '下一刻，雾外细碎的聊天声戛然而止。像有一只无形的手按住了整个血炼台的呼吸。随后，吼声爆开：“是谁？！”',
  '这里不过是血河宗外面一个小据点，他原本只想着凑够一炉“练气丹料”给七少爷，谁知竟有人在他眼皮底下点了青云令。',
  '血袍魔修咬牙切齿，指尖一弹，几枚血钉嗖地钉入黑石四角。血线瞬间爬开，像蛛网一样罩住圆台，雾里传来“嗡”的一声低鸣。',
  '宁陈顶着重压，硬生生把头转向了那个血袍魔修，喉结动了动，到底没出声。',
  '台面血纹亮起，有人还没反应过来，喉咙里先挤出一声闷哼，嘴角溢血；有人拼命想抬头，却又灵压按回去，额头撞在石上，声音闷得让人牙酸。',
  '苏清鸢绕到马鞍左侧抬脚踩了踩马镫，又换到右侧重复一遍，像是在确认什么。',
  '“再往前会影响马喘气。”宁陈说。',
]

const draftText = (label, extra) =>
  [`第${label}章（测试稿 ${extra}）`, '', ...PARAGRAPHS.slice(0, 6)].join('\n\n') + '\n'

/**
 * 造一棵作品目录树。默认 6 篇候选 + 归档目录（用来验证归档降权）。
 * @param {object} [options]
 * @param {string} [options.root] 指定根目录；不给就新建临时目录
 * @returns {Promise<{root: string, bookDir: string, chapterDir: Function, draftsDir: Function, cleanup: Function}>}
 */
export async function createWorkspace(options = {}) {
  const root = options.root ?? (await mkdtemp(join(tmpdir(), 'dsh-novel-craft-ws-')))
  const bookDir = join(root, '逐弈登仙')
  const runs = join(root, 'factory/runs/逐弈登仙')

  await mkdir(join(bookDir, '设定'), { recursive: true })
  await writeFile(join(bookDir, '逐弈登仙-第1章.txt'), draftText('1', '正文'), 'utf8')
  await writeFile(join(bookDir, '逐弈登仙-第2章.txt'), draftText('2', '正文'), 'utf8')
  await writeFile(join(bookDir, '设定/人物.md'), '# 人物设定\n\n宁陈：主角。\n', 'utf8')

  // 第9章：6 篇候选（抽卡的主战场）
  const ch9 = join(runs, '第9章/候选稿')
  await mkdir(ch9, { recursive: true })
  for (const label of ['A', 'B', 'C', 'D', 'E', 'F']) {
    await writeFile(join(ch9, `第9章-${label}-测试方向${label}.txt`), draftText('9', label), 'utf8')
  }

  // 第8章：候选 + 三版重写（选择器徽标用）
  const ch8 = join(runs, '第8章')
  await mkdir(join(ch8, '候选稿'), { recursive: true })
  await mkdir(join(ch8, '三版重写'), { recursive: true })
  await writeFile(join(ch8, '候选稿/第8章-A.txt'), draftText('8', 'A'), 'utf8')
  await writeFile(join(ch8, '候选稿/第8章-B.txt'), draftText('8', 'B'), 'utf8')
  for (const n of ['1', '2', '3']) {
    await writeFile(join(ch8, `三版重写/第8章-${n}-重写.txt`), draftText('8', n), 'utf8')
  }

  // 归档：篇数比候选稿还多，用来验证"归档降权"
  const archive = join(bookDir, '归档/第7章候选稿与评审')
  await mkdir(archive, { recursive: true })
  for (let i = 0; i < 12; i += 1) {
    await writeFile(join(archive, `旧候选-${i}.txt`), '一段已经归档的旧稿。\n', 'utf8')
  }

  return {
    root,
    bookDir,
    chapterDir: (name) => join(runs, name),
    draftsDir: (name) => join(runs, name, '候选稿'),
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

/** 一段可当"候选稿"的短文本，需要临时造文件时用。 */
export function sampleText(paragraphs = 3) {
  return PARAGRAPHS.slice(0, paragraphs).join('\n\n') + '\n'
}

/**
 * 造一棵"像真作品"的目录树，给 0.2 的章节/写作包/体检/阶段用。
 *
 * 结构照着作者真实的《逐弈登仙》来，包括几个容易踩的坑：
 * - 全书合并稿 `测试书.txt` 也在根目录，但它**不是**一章（不能被当章节读进来）；
 * - 剧情总结的文件名带空格（`第 1 章 剧情总结.md`），章号解析要认；
 * - 人物目录里有个 `主要人物列表.json`，它不是人物卡，不该算进人物；
 * - 轮次目录在**作品根之外**（`<root>/factory/runs/测试书`），作品根只能靠 runs 线索找。
 */
export async function createBookFixture(options = {}) {
  const root = options.root ?? (await mkdtemp(join(tmpdir(), 'dsh-novel-craft-book-')))
  const name = '测试书'
  const bookDir = join(root, name)
  const runs = join(root, 'factory/runs', name)

  await mkdir(join(bookDir, '设定'), { recursive: true })
  await mkdir(join(bookDir, '人物'), { recursive: true })
  await mkdir(join(bookDir, '剧情'), { recursive: true })
  await mkdir(join(bookDir, '评论'), { recursive: true })

  const chapters = [
    { n: 1, title: '第1章 血炼台上', points: ['宁陈在血炼台上醒来', '点了青云令逃生'] },
    { n: 2, title: '第2章 拜师青云', points: ['青云宗收徒', '宁陈测出地品灵根'] },
    { n: 3, title: '第3章 望舒城', points: ['西市淘宝', '当铺换灵石'] },
  ]
  for (const c of chapters) {
    const body = [c.title, '', ...PARAGRAPHS, ...PARAGRAPHS.slice(0, 2)].join('\n\n') + '\n'
    await writeFile(join(bookDir, `${name}-第${c.n}章.txt`), body, 'utf8')
    await writeFile(
      join(bookDir, '剧情', `第 ${c.n} 章 剧情总结.md`),
      [`# 第 ${c.n} 章 ${c.title.replace(/^第\d+章\s*/, '')} - 剧情总结`, '', '## 核心剧情点', '', ...c.points.map((p, i) => `${i + 1}. **${p}**`), '', '## 关键设定', '', `- 蕴灵币余额：${1000 * c.n}`, ''].join('\n'),
      'utf8',
    )
    await writeFile(
      join(bookDir, '评论', `第${c.n}章_评论数据.json`),
      JSON.stringify({ chapter: c.n, title: c.title, comments: [{ reader_id: 1, score: 4 + c.n * 0.1, comment: '还行', likes: 3 }] }, null, 2),
      'utf8',
    )
  }
  // 全书合并稿：根目录、名字里没有"第N章"，绝不能被当成一章
  await writeFile(join(bookDir, `${name}.txt`), chapters.map((c) => `${c.title}\n\n正文正文。`).join('\n\n'), 'utf8')

  await writeFile(
    join(bookDir, '大纲.md'),
    [
      '# 大纲',
      '',
      '## 第1章 血炼台上',
      '- 目标：宁陈在绝境里活下来',
      '- 冲突：血炼台上的围杀',
      '- 转折：青云令被点亮',
      '- 埋：青云令的来历',
      '',
      '## 第2章 拜师青云',
      '- 目标：进入青云宗',
      '- 冲突：灵根测试被人轻视',
      '- 收：青云令的来历',
      '',
      '## 第3章 望舒城',
      '- 目标：用信息差换第一桶金',
      '- 冲突：当铺掌柜更懂行',
      '',
    ].join('\n'),
    'utf8',
  )
  await writeFile(
    join(bookDir, '设定/立项.md'),
    [
      '# 立项',
      '',
      '## 一句话卖点',
      '',
      '凡人少年在修仙界靠信息差翻身：别人拼天赋，他拼的是看穿价格与人心。',
      '',
      '## 目标平台与字数',
      '',
      '- 目标平台：番茄小说（男频玄幻）',
      '- 目标字数：120 万字，单章 2500-3500 字',
      '- 更新节奏：日更两章',
      '',
      '## 读者画像',
      '',
      '喜欢经济流、信息差、系统流与爽点密集的男频读者；能接受慢热铺垫，但每三章要有一次实质收益。',
      '',
    ].join('\n'),
    'utf8',
  )
  await writeFile(join(bookDir, '设定/世界观.md'), '# 世界观\n\n境界：练气、筑基、金丹。系统商城只在夜间开启。\n', 'utf8')
  await writeFile(
    join(bookDir, '设定/道具与增益台账.md'),
    [
      '# 测试书 道具与增益台账',
      '',
      '> 当前校对截止：第2章结束。',
      '',
      '| 名称 | 类型／品级 | 效果 | 状态 | 首次出现／备注 |',
      '|---|---|---|---|---|',
      '| 通透世界 | 千载难逢·神通 | 查看增益与境界 | 持有 | 第1章获得 |',
      '| 追踪缕 | 追踪类法宝 | 一月内追踪目标 | 已植入李大可 | 第2章购买 |',
      '| 灵云匕 | 百里挑一 | 背刺伤害翻倍 | 已出售 | 第3章卖出 |',
      '',
    ].join('\n'),
    'utf8',
  )
  for (const person of [
    { 姓名: '宁陈', 身份: '主角·玩家', 境界: '练气三层', 灵根: '地品木灵根', 剧情重要性: '主角', 状态: '在青云宗内门', 人物关系: { 苏清鸢: '同伴' }, 备注: '靠信息差获利' },
    { 姓名: '苏清鸢', 身份: '同伴', 境界: '练气二层', 剧情重要性: '主要配角', 状态: '与宁陈同行', 人物关系: { 宁陈: '同伴' } },
    { 姓名: '李大可', 身份: '反派', 境界: '练气九层', 剧情重要性: '次要', 状态: '被追踪', 人物关系: {} },
  ]) {
    await writeFile(join(bookDir, '人物', `${person.姓名}.json`), JSON.stringify(person, null, 2), 'utf8')
  }
  await writeFile(join(bookDir, '人物/主要人物列表.json'), JSON.stringify(['宁陈', '苏清鸢'], null, 2), 'utf8')

  // 轮次目录：第2章有卡池与评审记录（看板的"轮次"列靠它）
  await mkdir(join(runs, '第2章/候选稿'), { recursive: true })
  await writeFile(join(runs, '第2章/候选稿/第2章-A-冷启动.txt'), draftText('2', 'A'), 'utf8')
  await writeFile(join(runs, '第2章/候选稿/第2章-B-热开场.txt'), draftText('2', 'B'), 'utf8')
  await writeFile(join(runs, '第2章/盲评结论.md'), '# 盲评结论\n\nA 更稳。\n', 'utf8')
  await mkdir(join(runs, '第3章/候选稿'), { recursive: true })
  await writeFile(join(runs, '第3章/候选稿/第3章-A.txt'), draftText('3', 'A'), 'utf8')

  return {
    root,
    name,
    bookDir,
    runs,
    draftsDir: (chapter) => join(runs, chapter, '候选稿'),
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}
