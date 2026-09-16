/**
 * dsh 版本兼容性冒烟测试。
 *
 * 做什么：在临时目录里装一份**指定版本**的 dsh（默认 `next`），把本插件按 profile 的
 * 方式挂上去，用独立的 DSH_HOME 起一个 web 服务，然后断言三件事：
 *   1. 宿主半区加载成功、自带路由可用（`/novel-craft/api/state` 返回 200 与完整字段）；
 *   2. 客户端半区被名册收录（启动清单里出现 `dsh-novel-craft` 行）；
 *   3. 该半区能按要求下发（取清单给的那个 URL，内容包含插件标记）。
 *
 * 为什么要单独装一份：dsh 是一组各自独立发版的包，直接拿本机 profile 测等于自欺欺人。
 * 全程隔离（临时 DSH_HOME + 随机端口 + 独立 node_modules），跑完就删。
 *
 * 用法：
 *   node scripts/check-dsh-compat.mjs            # 测 npm 的 next
 *   node scripts/check-dsh-compat.mjs latest     # 测 npm 的 latest
 *   node scripts/check-dsh-compat.mjs 0.1.6-alpha.1
 *   node scripts/check-dsh-compat.mjs alpha --keep   # 保留现场排查
 *
 * 退出码 0 = 全通过；1 = 有断言失败（CI 里据此报警）。
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { cp, mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO_ROOT = join(import.meta.dirname, '..')
const args = process.argv.slice(2)
const KEEP = args.includes('--keep')
const spec = args.find((a) => !a.startsWith('--')) ?? 'next'
const BOOT_TIMEOUT_MS = 120_000

const checks = []
const record = (name, ok, detail) => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

/** npm 不认 SOCKS 代理（这台机器上就是这么卡住的），子进程里直接摘掉它。 */
function childEnv(extra = {}) {
  const env = { ...process.env, ...extra }
  for (const key of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) {
    if (typeof env[key] === 'string' && env[key].startsWith('socks')) delete env[key]
  }
  return env
}

const run = (cmd, argv, options = {}) =>
  new Promise((resolve) => {
    const child = spawn(cmd, argv, { env: childEnv(options.env), cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('close', (code) => resolve({ code, out, err }))
    if (options.timeoutMs) setTimeout(() => child.kill('SIGKILL'), options.timeoutMs).unref?.()
  })

const freePort = () =>
  new Promise((resolve) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })

/** 等端口能应答（任何状态码都算起来了）。 */
async function waitForServer(url, timeoutMs) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      await fetch(url, { redirect: 'manual' })
      return true
    } catch {
      await new Promise((r) => setTimeout(r, 700))
    }
  }
  return false
}

/** 新版 web 默认带 token 鉴权：先从启动日志里拿 token，再带着 cookie 访问。 */
async function authorizedFetch(base, path, log, cookie) {
  const tokenMatch = /[?&]token=([A-Za-z0-9_-]+)/.exec(log)
  const attempt = async (extraPath, headers) =>
    fetch(base + extraPath, { headers, redirect: 'manual' })
  if (cookie !== null) {
    const res = await attempt(path, { cookie })
    if (res.status < 400) return res
  }
  if (tokenMatch === null) return await attempt(path, {})
  const withToken = path + (path.includes('?') ? '&' : '?') + 'token=' + tokenMatch[1]
  const res = await attempt(withToken, {})
  const setCookie = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  const jar = setCookie.map((c) => c.split(';')[0]).join('; ')
  return { res, cookie: jar === '' ? null : jar }
}

const base = (port) => `http://127.0.0.1:${port}`

async function main() {
  const work = await mkdtemp(join(tmpdir(), 'dsh-compat-'))
  const home = join(work, 'home')
  const install = join(work, 'dsh')
  const pluginCopy = join(work, 'plugin')
  const logPath = join(work, 'boot.log')
  await mkdir(home, { recursive: true })
  await mkdir(install, { recursive: true })

  let child = null
  let cookie = null
  try {
    console.log(`\n【准备】临时目录 ${work}`)

    // ── 1. 装一份指定版本的 dsh ────────────────────────────────────────────
    await writeFile(join(install, 'package.json'), JSON.stringify({ name: 'compat-probe', private: true }, null, 2))
    const installed = await run(
      'npm',
      ['install', `@deepseek-ai/dsh@${spec}`, '--no-audit', '--no-fund', '--cache', join(work, '.npm-cache')],
      { cwd: install, timeoutMs: 600_000 },
    )
    const binPath = join(install, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
    if (installed.code !== 0 || !existsSync(binPath)) {
      record(`安装 dsh@${spec}`, false, (installed.err || installed.out).split('\n').filter(Boolean).slice(-2).join(' '))
      throw new Error('install failed')
    }
    const version = JSON.parse(await readFile(join(install, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8')).version
    record(`安装 dsh@${spec}`, true, `实际版本 ${version}`)

    // ── 2. 第一次启动：让 dsh 自己初始化 profile ───────────────────────────
    const port = await freePort()
    const bootOnce = async () => {
      const proc = spawn(process.execPath, [binPath, 'web', '--no-open', '--port', String(port)], {
        env: childEnv({ DSH_HOME: home }),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let log = ''
      proc.stdout.on('data', (d) => (log += d))
      proc.stderr.on('data', (d) => (log += d))
      const up = await waitForServer(base(port), BOOT_TIMEOUT_MS)
      return { proc, log, up }
    }
    let boot = await bootOnce()
    if (!boot.up) {
      record('首次启动（初始化 profile）', false, boot.log.split('\n').filter(Boolean).slice(-2).join(' '))
      throw new Error('boot failed')
    }
    boot.proc.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 1500))
    const profileDir = join(home, 'profiles/web')
    record('profile 自动初始化', existsSync(join(profileDir, 'package.json')), profileDir)

    // ── 3. 把插件按 profile 的方式挂上去（等价于 dsh plugin add，但不依赖 pnpm）──
    await cp(REPO_ROOT, pluginCopy, {
      recursive: true,
      filter: (src) => !/[\\/](node_modules|\.git|docs)([\\/]|$)/.test(src) && !src.endsWith('.npm-cache'),
    })
    await mkdir(join(pluginCopy, 'node_modules'), { recursive: true })
    await cp(join(install, 'node_modules/@deepseek-ai'), join(pluginCopy, 'node_modules/@deepseek-ai'), { recursive: true, dereference: false })
    const profilePkgPath = join(profileDir, 'package.json')
    const profilePkg = JSON.parse(await readFile(profilePkgPath, 'utf8'))
    profilePkg.dependencies = { ...(profilePkg.dependencies ?? {}), 'dsh-novel-craft': `link:${pluginCopy}` }
    const bundles = profilePkg.dsh?.profile?.bundles ?? []
    if (!bundles.includes('dsh-novel-craft')) bundles.push('dsh-novel-craft')
    profilePkg.dsh = { ...(profilePkg.dsh ?? {}), profile: { ...(profilePkg.dsh?.profile ?? {}), bundles } }
    await writeFile(profilePkgPath, JSON.stringify(profilePkg, null, 2) + '\n')
    await mkdir(join(profileDir, 'node_modules'), { recursive: true })
    await rm(join(profileDir, 'node_modules/dsh-novel-craft'), { recursive: true, force: true })
    await cp(pluginCopy, join(profileDir, 'node_modules/dsh-novel-craft'), { recursive: true, dereference: false })
    record('插件写入 profile', true, 'dependencies + bundles + node_modules')

    // ── 4. 第二次启动：本次才装载插件 ──────────────────────────────────────
    const second = await freePort()
    const proc2 = spawn(process.execPath, [binPath, 'web', '--no-open', '--port', String(second)], {
      env: childEnv({ DSH_HOME: home }),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child = proc2
    let log2 = ''
    proc2.stdout.on('data', (d) => (log2 += d))
    proc2.stderr.on('data', (d) => (log2 += d))
    const up2 = await waitForServer(base(second), BOOT_TIMEOUT_MS)
    await writeFile(logPath, log2)
    record('装载插件后启动服务', up2, up2 ? base(second) : log2.split('\n').filter(Boolean).slice(-2).join(' '))
    if (!up2) throw new Error('boot failed')

    // ── 5. 断言 1：宿主半区路由（轮询：端口应答 ≠ 插件已挂载）────────────────
    let stateResponse = null
    let stateText = ''
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      const attempt = await authorizedFetch(base(second), '/novel-craft/api/state', log2, cookie)
      if (attempt.cookie !== undefined) cookie = attempt.cookie
      const res = attempt.res ?? attempt
      stateText = await res.text()
      if (res.status === 200) {
        stateResponse = res
        break
      }
      stateResponse = res
      await new Promise((r) => setTimeout(r, 1500))
    }
    let stateJson = null
    try {
      stateJson = JSON.parse(stateText)
    } catch {
      stateJson = null
    }
    record(
      '宿主 API /state 可用',
      stateResponse.status === 200 && stateJson !== null && 'stats' in stateJson && 'candidateDir' in stateJson,
      `HTTP ${stateResponse.status}` + (stateJson === null ? '' : ` · 字段 ${Object.keys(stateJson).length} 个`),
    )

    // ── 6. 断言 2/3：客户端半区被收录并能下发 ──────────────────────────────
    // 清单同理：客户端名册是按 fiber 事件增量收的，也要轮询一会儿
    let html = ''
    let rowMatch = null
    const manifestDeadline = Date.now() + 60_000
    while (Date.now() < manifestDeadline) {
      const indexRes = await authorizedFetch(base(second), '/', log2, cookie)
      if (indexRes.cookie !== undefined) cookie = indexRes.cookie
      html = await (indexRes.res ?? indexRes).text()
      rowMatch = /(\{"id":"dsh-novel-craft"[^}]*\})/.exec(html)
      if (rowMatch !== null) break
      await new Promise((r) => setTimeout(r, 1500))
    }
    record('客户端半区进入启动清单', rowMatch !== null, rowMatch === null ? '清单里没有 dsh-novel-craft' : rowMatch[1].slice(0, 90) + '…')

    if (rowMatch !== null) {
      const row = JSON.parse(rowMatch[1])
      // 新版是组合脚本 URL（/plugins/??a/client.js,b/client.js&rev=…），旧版是 /plugins/<id>/client.js
      const bundleRes = await authorizedFetch(base(second), row.url.replace(/&amp;/g, '&'), log2, cookie)
      if (bundleRes.cookie !== undefined) cookie = bundleRes.cookie
      const response = bundleRes.res ?? bundleRes
      const body = await response.text()
      record(
        '客户端半区可下发（内容含插件标记）',
        response.status === 200 && body.includes('抽卡工作台') && body.includes('__ModuleLoader__'),
        `HTTP ${response.status} · ${body.length} 字节`,
      )
    }
  } catch (error) {
    if (checks.length === 0 || !checks.some((c) => c.ok)) record('冒烟测试执行', false, String(error?.message ?? error))
  } finally {
    if (child !== null) child.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 800))
    if (KEEP) console.log(`\n现场保留在 ${work}（--keep）`)
    else await rm(work, { recursive: true, force: true }).catch(() => {})
  }

  const failed = checks.filter((c) => !c.ok)
  console.log(`\ndsh@${spec} 兼容性：${failed.length === 0 ? '全部通过 ✅' : `${failed.length} 项失败 ❌`}`)
  process.exit(failed.length === 0 ? 0 : 1)
}

await main()
