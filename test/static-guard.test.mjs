/**
 * dsh-novel-craft 客户端半区静态守卫
 *
 * 为什么单独一个文件、还排在 npm test 第一位：
 * 「提前 return 之后又调用 Hook」这类错误，SSR 每次渲染都是新树、根本抓不到；
 * 而它一旦发生，整个工作台点开就崩（点侧栏没反应）。更糟的是，它还会让后面的
 * 渲染测试连锁崩掉、把真正的原因埋掉。所以这里直接查源码，先跑、先报。
 *
 * 跑法：node test/static-guard.test.mjs
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const CLIENT_PATH = join(import.meta.dirname, '../lib/client.js')

let failures = 0
const ok = (name, cond, detail) => {
  if (cond) console.log(`  ✅ ${name}`)
  else {
    failures += 1
    console.log(`  ❌ ${name}${detail === undefined ? '' : ' → ' + detail}`)
  }
}
const head = (name) => console.log(`\n【${name}】`)

const HOOK_CALL = /(^|[^a-zA-Z_.])(useState|useEffect|useCallback|useRef|useMemo|useReducer|useContext)\s*\(|React\.use(Ref|State|Effect)\s*\(/

/** 取一个组件函数的函数体（到缩进 4 格的收尾大括号为止）。 */
function bodyOf(lines, component) {
  const start = lines.findIndex((line) => line.includes('function ' + component + '(props)'))
  if (start === -1) return null
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i] === '    }') return lines.slice(start, i)
  }
  return lines.slice(start)
}

const source = await readFile(CLIENT_PATH, 'utf8')
const lines = source.split('\n')

head('Hook 顺序（重点：不许出现在提前 return 之后）')
for (const component of ['CraftEntry', 'CraftWorkbench', 'DirPicker', 'ProfileView', 'ChapterDetail', 'StageView']) {
  const body = bodyOf(lines, component)
  ok(component + ' 存在', body !== null)
  if (body === null) continue
  const lastHook = body.reduce((last, line, i) => (HOOK_CALL.test(line) ? i : last), -1)
  const firstTopLevelIf = body.findIndex((line) => /^ {6}if \(/.test(line))
  if (component === 'CraftEntry') continue // 只有 useOpen 一个 Hook，无需判断顺序
  // 没有提前 return 的组件天然安全（Hook 永远都会被调用到），不该因为"找不到 if"而报错
  ok(
    component + '：Hook 不晚于最早的提前 return',
    firstTopLevelIf === -1 || (lastHook !== -1 && lastHook < firstTopLevelIf),
    firstTopLevelIf === -1 ? '无提前 return' : `最后一个 Hook 在第 ${lastHook + 1} 行，最外层 if 在第 ${firstTopLevelIf + 1} 行`,
  )
}

head('词条与导出')
{
  // 词条缺失是不会报错的——界面直接显示 key 名。静态查一遍最省事。
  const dictKeys = (name) => {
    const at = source.indexOf('const ' + name + ' = {')
    if (at === -1) return []
    const block = source.slice(at, source.indexOf('\n    }', at))
    return [...block.matchAll(/^ {6}([A-Za-z][A-Za-z0-9_]*):/gm)].map((m) => m[1])
  }
  const zhKeys = dictKeys('zh')
  const enKeys = dictKeys('en')
  ok('中英词条数量一致', zhKeys.length > 40 && zhKeys.length === enKeys.length, String(zhKeys.length) + ' / ' + String(enKeys.length))
  const missingEn = zhKeys.filter((k) => !enKeys.includes(k))
  ok('每个中文词条都有英文', missingEn.length === 0, missingEn.join(','))
  const used = [...new Set([...source.matchAll(/\bt\('([A-Za-z][A-Za-z0-9_]*)'\)/g)].map((m) => m[1]))]
  const missing = used.filter((k) => !zhKeys.includes(k))
  ok('代码里用到的词条都存在（' + used.length + ' 个）', missing.length === 0, missing.join(','))
}

head('源码卫生')
ok('没有遗留的调试输出', !/console\.log\(/.test(source.split('exports.apply')[0]))
ok('导出仍挂在内核两半', /exports\.name = 'dsh-novel-craft'/.test(source) && /exports\.apply = function/.test(source))

console.log(`\n${failures === 0 ? '全部通过 ✅' : `失败 ${failures} 项 ❌`}`)
process.exit(failures === 0 ? 0 : 1)
