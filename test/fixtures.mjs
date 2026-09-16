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
