/**
 * 找到成对的 react / react-dom。
 *
 * 渲染用例与预览生成都要它。找的顺序：
 * 1. `DSH_REACT_ROOT` 环境变量（任意能 require 到 react-dom 的目录）
 * 2. 本包 devDependencies（`npm install` 之后就有）
 * 3. 部署自带的 react：顺着 peer 依赖 `@deepseek-ai/cordis` 的真实路径反推 node_modules
 * 找不到返回 null，由调用方决定是"跳过"还是报错。
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'

export function resolveReact() {
  const roots = []
  if (process.env.DSH_REACT_ROOT) roots.push(join(process.env.DSH_REACT_ROOT, 'package.json'))
  const selfPkg = join(import.meta.dirname, '../../package.json')
  roots.push(selfPkg)
  try {
    const probe = createRequire(selfPkg)
    const cordis = probe.resolve('@deepseek-ai/cordis/package.json')
    const cut = cordis.lastIndexOf('node_modules')
    const nm = cordis.slice(0, cut + 'node_modules'.length)
    roots.push(join(nm, '@deepseek-ai/dsh-client-ui-trajectory/node_modules', 'react-dom/package.json'))
    roots.push(join(nm, 'react-dom/package.json'))
  } catch {
    // 解析不到 peer 就算了，换下一个候选
  }
  for (const base of roots) {
    try {
      const req = createRequire(base)
      req.resolve('react')
      req.resolve('react-dom/server')
      return req
    } catch {
      // 这个位置没有成对的 react
    }
  }
  return null
}
