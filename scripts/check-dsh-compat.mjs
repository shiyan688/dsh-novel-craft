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
 * Node 版本：dsh 0.2.2-rc.1 要求 >=24.9.0；旧版可用 Node 22。
 * 可用 DSH_NODE 指定解释器。DSH_BIN 可指定已安装的同版本 CLI，复用制品排查。
 *
 * 用法：
 *   node scripts/check-dsh-compat.mjs            # 测 npm 的 next
 *   node scripts/check-dsh-compat.mjs latest     # 测 npm 的 latest
 *   node scripts/check-dsh-compat.mjs 0.1.6-alpha.1
 *   node scripts/check-dsh-compat.mjs alpha --keep   # 保留现场排查
 *
 * 退出码：0 = 全通过，或"该版本在 npm 上已无法安装"（上游制品问题，按跳过处理并警告）；
 *         1 = 插件在该版本上真的失败了（CI 里据此报警）。
 * 想连"装不上"也判定失败，加 --strict。
 */
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { cp, mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** 优先使用显式指定的 Node，其次选满足当前 DSH 要求的 Node 24。 */
function resolveNode() {
  const candidates = [process.env.DSH_NODE, 'node24', process.execPath, 'node22', 'node22/bin/node'].filter(
    (x) => typeof x === 'string' && x !== '',
  )
  let fallback
  for (const candidate of candidates) {
    try {
      const out = execFileSync(candidate, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      const major = Number(out.replace(/^v/, '').split('.')[0])
      const node = { bin: candidate, version: out }
      if (candidate === process.env.DSH_NODE || major >= 24) return node
      if (major >= 22) fallback ??= node
    } catch {
      // 这个候选不存在或跑不起来：试下一个
    }
  }
  return fallback ?? { bin: process.execPath, version: process.version }
}
const NODE = resolveNode()

const REPO_ROOT = join(import.meta.dirname, '..')
const args = process.argv.slice(2)
const KEEP = args.includes('--keep')
const strict = args.includes('--strict')
const spec = args.find((a) => !a.startsWith('--')) ?? 'next'
const BOOT_TIMEOUT_MS = 120_000
const PLUGIN_TIMEOUT_MS = 45_000

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
async function waitForServer(url, timeoutMs, child) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs && child.exitCode === null && child.signalCode === null) {
    try {
      await fetch(url, { redirect: 'manual' })
      return true
    } catch {
      await new Promise((r) => setTimeout(r, 700))
    }
  }
  return false
}

/** 启动 token 只在首页兑换 Cookie。API 和客户端脚本请求直接复用 Cookie。 */
async function browserSession(origin, readLog) {
  const findToken = () => /[?&]token=([A-Za-z0-9_-]+)/.exec(readLog())?.[1]
  const deadline = Date.now() + 10_000
  let token = findToken()
  // 端口可能先开始应答，CLI 稍后才把登录 URL 写到 stdout。
  while (token === undefined && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 150))
    token = findToken()
  }
  if (token === undefined) return {}
  const res = await fetch(new URL('/?token=' + token, origin), { redirect: 'manual' })
  const cookie = res.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
  if (cookie === '') throw new Error('启动 token 未能兑换浏览器 Cookie')
  return { cookie }
}

async function waitForPlugin(check) {
  const deadline = Date.now() + PLUGIN_TIMEOUT_MS
  let result
  do {
    result = await check()
    if (result.ready) break
    await new Promise((resolve) => setTimeout(resolve, 700))
  } while (Date.now() < deadline)
  return result
}

const base = (port) => `http://127.0.0.1:${port}`

/** CI 里把结论写进 job summary，红了也不用翻日志。 */
async function writeSummary(markdown) {
  const path = process.env.GITHUB_STEP_SUMMARY
  if (path === undefined || path === '') return
  await writeFile(path, markdown, { flag: 'a' }).catch(() => {})
}

async function main() {
  const work = await mkdtemp(join(tmpdir(), 'dsh-compat-'))
  const home = join(work, 'home')
  const install = join(work, 'dsh')
  const pluginCopy = join(work, 'plugin')
  const logPath = join(work, 'boot.log')
  await mkdir(home, { recursive: true })
  await mkdir(install, { recursive: true })

  let child = null
  let pluginLog = ''
  try {
    console.log(`\n【准备】临时目录 ${work}`)
    console.log(`        Node ${NODE.version}（${NODE.bin}）`)

    // ── 1. 装一份指定版本的 dsh ────────────────────────────────────────────
    await writeFile(join(install, 'package.json'), JSON.stringify({ name: 'compat-probe', private: true }, null, 2))
    const binPath = resolve(process.env.DSH_BIN ?? join(install, 'node_modules/@deepseek-ai/dsh/lib/bin.js'))
    const installed = process.env.DSH_BIN === undefined
      ? await run(
        'npm',
        ['install', `@deepseek-ai/dsh@${spec}`, '--no-audit', '--no-fund', '--cache', join(work, '.npm-cache')],
        { cwd: install, timeoutMs: 300_000 },
      )
      : { code: 0, err: '', out: '' }
    if (installed.code !== 0 || !existsSync(binPath)) {
      // 老版本（0.1.0-rc.x / 0.1.1-rc.x 等）现在从 npm 全新安装会卡死/失败，
      // 这是上游制品的问题，不代表插件不兼容——按"跳过"处理，但要把话说清楚。
      const tail = (installed.err || installed.out).split('\n').filter(Boolean).slice(-2).join(' ')
      console.log(`  ⚠️  跳过 dsh@${spec}：这个版本在 npm 上已无法全新安装（上游制品问题）`)
      if (tail !== '') console.log(`      ${tail}`)
      await writeSummary(`## dsh@${spec} — 跳过\n\n该版本在 npm 上无法全新安装（安装退出码 ${installed.code}），属上游制品问题，未被判定为兼容性失败。\n`)
      console.log(`\ndsh@${spec} 兼容性：跳过 ⚠️（版本装不上，非插件问题）`)
      process.exitCode = strict || process.env.DSH_BIN !== undefined ? 1 : 0
      return
    }
    const namespace = dirname(dirname(dirname(binPath)))
    const version = JSON.parse(await readFile(join(namespace, 'dsh/package.json'), 'utf8')).version
    if (process.env.DSH_BIN !== undefined && /^\d/.test(spec) && spec !== version) {
      throw new Error(`DSH_BIN 的版本是 ${version}，预期 ${spec}`)
    }
    const [major, minor] = version.split('.').map(Number)
    const expectShared = major > 0 || minor >= 2
    record(`安装 dsh@${spec}`, true, `实际版本 ${version}`)

    // ── 2. 第一次启动：让 dsh 自己初始化 profile ───────────────────────────
    const port = await freePort()
    const bootOnce = async () => {
      const proc = spawn(NODE.bin, [binPath, 'web', '--no-open', '--port', String(port)], {
        env: childEnv({ DSH_HOME: home }),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let log = ''
      proc.stdout.on('data', (d) => (log += d))
      proc.stderr.on('data', (d) => (log += d))
      child = proc
      const up = await waitForServer(base(port), BOOT_TIMEOUT_MS, proc)
      return { proc, log, up }
    }
    let boot = await bootOnce()
    if (!boot.up) {
      const detail = boot.log.split('\n').filter(Boolean).slice(-2).join(' ') || '（没有任何输出）'
      const nodeMajor = Number(NODE.version.replace(/^v/, '').split('.')[0])
      if (nodeMajor < 22) {
        // Node 20 起 dsh 0.1.5+ 会静默退出：这是环境问题，不该记成插件不兼容
        console.log(`  ⚠️  跳过 dsh@${spec}：dsh 需要 Node 22，当前用的是 ${NODE.version}（${NODE.bin}）`)
        console.log('      设 DSH_NODE=/path/to/node22 再跑，或直接用 node22 执行本脚本。')
        await writeSummary(`## dsh@${spec} — 跳过（Node 版本不足）\n\n本机用的是 ${NODE.version}，dsh >= 0.1.5 需要 Node 22；启动失败是环境问题，未被判定为兼容性失败。\n`)
        console.log(`\ndsh@${spec} 兼容性：跳过 ⚠️（Node ${NODE.version} 跑不起 dsh）`)
        process.exitCode = strict ? 1 : 0
        return
      }
      record('首次启动（初始化 profile）', false, detail)
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
    await cp(namespace, join(pluginCopy, 'node_modules/@deepseek-ai'), { recursive: true, dereference: false })
    const profilePkgPath = join(profileDir, 'package.json')
    const profilePkg = JSON.parse(await readFile(profilePkgPath, 'utf8'))
    profilePkg.dependencies = { ...(profilePkg.dependencies ?? {}), 'dsh-novel-craft': `link:${pluginCopy}` }
    const bundles = profilePkg.dsh?.profile?.bundles ?? []
    if (!bundles.includes('dsh-novel-craft')) bundles.push('dsh-novel-craft')
    profilePkg.dsh = { ...(profilePkg.dsh ?? {}), profile: { ...(profilePkg.dsh?.profile ?? {}), bundles } }
    // 旧版发布包的 live 监视器依赖未随 profile 加载的 Cordis HMR。
    // 此处只改隔离 profile，按重启安装流程验证旧入口。
    if (!expectShared) profilePkg.dsh.profile.patchReload = 'startup'
    await writeFile(profilePkgPath, JSON.stringify(profilePkg, null, 2) + '\n')
    await mkdir(join(profileDir, 'node_modules'), { recursive: true })
    await rm(join(profileDir, 'node_modules/dsh-novel-craft'), { recursive: true, force: true })
    await cp(pluginCopy, join(profileDir, 'node_modules/dsh-novel-craft'), { recursive: true, dereference: false })
    record('插件写入 profile', true, 'dependencies + bundles + node_modules')

    // ── 4. 第二次启动：本次才装载插件 ──────────────────────────────────────
    const second = await freePort()
    const proc2 = spawn(NODE.bin, [binPath, 'web', '--no-open', '--port', String(second)], {
      env: childEnv({ DSH_HOME: home }),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child = proc2
    proc2.stdout.on('data', (d) => (pluginLog += d))
    proc2.stderr.on('data', (d) => (pluginLog += d))
    const origin = base(second)
    const up2 = await waitForServer(origin, BOOT_TIMEOUT_MS, proc2)
    record('装载插件后启动服务', up2, up2 ? base(second) : pluginLog.split('\n').filter(Boolean).slice(-2).join(' '))
    if (!up2) throw new Error('boot failed')

    const session = await browserSession(origin, () => pluginLog)
    const request = (path, options = {}) => fetch(new URL(path, origin), {
      ...options,
      headers: { ...session, ...options.headers },
      redirect: 'manual',
    })

    // 断言宿主 API。早期宿主没有共享 Fetch 路由。
    const shared = '/api/novel-craft/'
    const legacy = '/novel-craft/api/'
    const probe = await waitForPlugin(async () => {
      const state = await request(shared + 'state')
      const data = await state.json().catch(() => null)
      if (state.status === 404 || (state.ok && data === null)) {
        const old = await request(legacy + 'state')
        const payload = await old.json().catch(() => null)
        // 当前版本必须通过新认证通道，避免客户端静默退回旧入口。
        return { prefix: legacy, state: old, payload, ready: !expectShared && old.ok && payload !== null }
      }
      return { prefix: shared, state, payload: data, ready: state.ok && data !== null }
    })
    const { prefix, state, payload } = probe
    record(
      '宿主 API /state 可用',
      probe.ready && 'stats' in payload && 'candidateDir' in payload,
      `${prefix}state · HTTP ${state.status}`,
    )

    if (prefix === shared && session.cookie !== undefined) {
      const guest = await fetch(new URL(prefix + 'state', origin))
      record('共享 API 拒绝未登录访问', guest.status === 401, `HTTP ${guest.status}`)
    }
    if (probe.ready && prefix === shared) {
      const drafts = join(work, 'drafts')
      await mkdir(drafts)
      await writeFile(join(drafts, '第1章-A.txt'), '远山起雾。\n\n一盏灯还亮着。')
      const saved = await request(prefix + 'config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patch: { candidateDir: drafts } }),
      })
      const configured = await saved.json().catch(() => null)
      record('通过 API 保存候选目录', saved.ok && configured?.value?.candidateDir === drafts, `HTTP ${saved.status}`)
      const { ready, status } = await waitForPlugin(async () => {
        const reloaded = await request(prefix + 'state')
        const updated = await reloaded.json().catch(() => null)
        return {
          ready: reloaded.ok && updated?.candidateDir === drafts && updated?.candidates?.[0]?.file === '第1章-A.txt',
          status: reloaded.status,
        }
      })
      record(
        '重载后从新目录读取候选稿',
        ready,
        `HTTP ${status}`,
      )
    }

    // 客户端名册里的 URL 可能是相对路径，也可能是多个模块的合并 URL。
    const { clientUrl } = await waitForPlugin(async () => {
      const html = await (await request('/')).text()
      const row = /({"id":"dsh-novel-craft"[^}]*})/.exec(html)
      // 旧版把预加载的客户端直接拼进脚本地址，不提供单独的清单行。
      const bundled = /<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']*dsh-novel-craft\/client\.js[^"']*)["']/i.exec(html)
      const clientUrl = row === null ? bundled?.[1] : JSON.parse(row[1]).url
      return { ready: clientUrl !== undefined, clientUrl }
    })
    record('客户端半区进入启动清单', clientUrl !== undefined)
    if (clientUrl !== undefined) {
      const response = await request(clientUrl.replace(/&amp;/g, '&'))
      const body = await response.text()
      record(
        '客户端半区可下发（内容含插件标记）',
        response.ok && body.includes('抽卡工作台') && body.includes('__ModuleLoader__'),
        `HTTP ${response.status} · ${Buffer.byteLength(body)} 字节`,
      )
    }
  } catch (error) {
    const detail = error?.cause?.code ?? error?.cause?.message
    record('冒烟测试执行', false, String(error?.message ?? error) + (detail ? ' · ' + detail : ''))
  } finally {
    if (child !== null) child.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 800))
    if (KEEP) await writeFile(logPath, pluginLog)
    if (KEEP) console.log(`\n现场保留在 ${work}（--keep）`)
    else await rm(work, { recursive: true, force: true }).catch(() => {})
  }

  const failed = checks.filter((c) => !c.ok)
  const lines = checks.map((c) => `| ${c.name} | ${c.ok ? '✅' : '❌'} | ${c.detail ?? ''} |`).join('\n')
  await writeSummary(
    `## dsh@${spec} — ${failed.length === 0 ? '通过 ✅' : `${failed.length} 项失败 ❌`}\n\n| 检查 | 结果 | 说明 |\n| --- | --- | --- |\n${lines}\n`,
  )
  console.log(`\ndsh@${spec} 兼容性：${failed.length === 0 ? '全部通过 ✅' : `${failed.length} 项失败 ❌`}`)
  process.exitCode = failed.length === 0 ? 0 : 1
}

await main()
