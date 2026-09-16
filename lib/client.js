/**
 * dsh-novel-craft — client half（浏览器半区 = 抽卡工作台）
 *
 * 形态（对照 dsh-novel-writing 的工作台做法）：
 * - 侧栏入口：sidebar.footer.action（id=novel-craft）→ 开/关工作台；
 * - 全屏浮层：shell.overlay（id=nv-craft）→ 抽卡工作台面板；
 * - 候选目录不再是"手填绝对路径"，而是选择器：推荐（宿主半区扫出含候选稿的目录）
 *   → 最近使用（localStorage）→ 浏览（平台的 ctx.workspaces.listDirectory）
 *   → 手动输入（兜底）。浏览走的是 dsh 自带的目录浏览 RPC，因此改这里刷新页面即生效。
 * - 候选目录落 settingsScope 持久化；标注与汇总走 /novel-craft/api/*。
 *
 * 作者只需点「好 / 坏」，不用写评语——这是本插件自研的抽卡式校准核心。
 */
window.__ModuleLoader__.load({
  id: 'dsh-novel-craft',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { useState, useEffect, useCallback } = React

    const NS = 'dsh-novel-craft'
    const API = '/novel-craft/api/'

    const zh = {
      entry: '抽卡工作台',
      title: '抽卡工作台',
      dirPlaceholder: '候选稿目录（绝对路径）',
      pickDir: '选择候选稿目录',
      pickDirTitle: '选择候选稿目录',
      pickHint: '点这里挑目录，不用记路径',
      load: '重新载入',
      close: '关闭',
      markGood: '好',
      markBad: '坏',
      clear: '取消标注',
      empty: '该目录下还没有候选稿（.txt / .md）',
      changeDir: '换个目录',
      noDir: '还没挑候选稿目录',
      loading: '载入中…',
      savedGood: '已标为「好」',
      savedBad: '已标为「坏」',
      profile: '偏好档案摘要',
      segUnit: '段',
      recent: '最近使用',
      clearRecent: '清空',
      recommended: '推荐（扫到有候选稿的目录）',
      scanning: '扫描中…',
      rescan: '重扫',
      noRecommend: '没扫到现成的候选稿目录，用下面的「浏览」自己挑',
      browse: '浏览',
      home: '主目录',
      workspace: '作品目录',
      up: '上一级',
      showHidden: '显示隐藏目录',
      hideHidden: '收起隐藏目录',
      useDir: '就用这个目录',
      manual: '⌨ 手动输入路径',
      manualHide: '收起手动输入',
      manualOk: '确定',
      noBrowse: '这个 dsh 没提供目录浏览，改用「手动输入路径」',
      systemPick: '用系统对话框选择',
      draftUnit: '篇',
      candidateTag: '候选目录',
      emptyDir: '（空）',
      truncated: '目录太多，只显示了一部分',
      dirLag: '目录已切换，但宿主还没跟上，点「↻」重载一下',
      tabCards: '抽卡',
      tabProfile: '偏好档案',
      profileTitle: '作者偏好档案',
      profileFile: '档案文件',
      updatedAt: '更新于',
      copyPath: '复制路径',
      copied: '路径已复制',
      edit: '编辑',
      save: '保存',
      cancel: '取消',
      saving: '保存中…',
      savedOk: '档案已保存',
      markedSegments: '已标注段落',
      fromFiles: '来源',
      jumpToSource: '回到这篇',
      noMarksYet: '当前目录还没有任何标注',
      editHint: '直接改这份 Markdown（规律区归你）。自动块（begin / end 之间）下次提炼会被重写。',
      pickDirFirst: '先选候选目录，才有档案可看',
      emptyDoc: '（档案是空的）',
      hostTooOld: '保存需要新版宿主半区：重启一次 dsh 后就能直接改档案',
      autoBegin: '工作台自动块 · 每次提炼重写',
      autoEnd: '工作台自动块结束',
      hostOldBanner: '宿主半区还是旧版：现在显示的是旧版原文档案。「提炼规律 / 证据摘录 / 规律档案」重启一次 dsh 后生效。',
      hostOldShort: '宿主半区待重启',
      firstRunHint: '读一遍就好：觉得好的按 G，别扭的按 B（也可以点段落右边的按钮），大部分段落不用标。标完点下面「⚗️ 提炼规律」。',
      keyHints: 'j / k 换段 · G 标好 · B 标坏 · 空格 取消 · n / p 换篇',
      removeRule: '删掉这条规律',
      truncatedHint: '这次模型输出被长度上限截断了，可能少了几条规律：换个更便宜/更快的模型，或分两批提炼。',
      distill: '提炼规律',
      distilling: '提炼中…',
      distillPending: '段待提炼',
      distillWith: '用',
      distillReview: '提炼出的规律（勾选后采纳；没勾的丢掉）',
      adoptSelected: '采纳选中',
      selectNone: '全不选',
      selectAll: '全选',
      discardCandidates: '丢弃',
      adoptedN: '已采纳',
      rulesEmpty: '还没有规律：点上面的「提炼规律」，把标注压成可复用的写法',
      rulesOnlyHint: '这份档案只放规律（写稿时读它就够）；原文证据在下面的「证据摘录」，别读进上下文。',
      evidenceSection: '证据摘录（原文）',
      evidenceUnit: '段',
      evidenceWarn: '给人回查、给提炼当输入 —— 不要读进写稿上下文',
      evidenceShow: '展开看原文',
      evidenceHide: '收起原文',
      evidenceRefresh: '更新证据摘录',
      evidenceUpdated: '证据摘录已更新',
      noPending: '没有待提炼的新标注',
      cappedHint: '原文较多，这次只送出了前',
      distillNoRoute: '没有可用的模型路由：给 dsh-novel-craft 填 distillProvider / distillModel，或把证据摘录交给你的 agent',
      lastDistill: '最近提炼',
      pendingChip: '待提炼',
      markedChip: '标注',
      hostTooOld: '保存需要新版宿主半区：重启一次 dsh 后就能直接改档案',
    }
    const en = {
      entry: 'Gacha workbench',
      title: 'Gacha Workbench',
      dirPlaceholder: 'Candidate directory (absolute path)',
      pickDir: 'Choose candidate directory',
      pickDirTitle: 'Choose Candidate Directory',
      pickHint: 'Pick a folder — no path memorizing',
      load: 'Reload',
      close: 'Close',
      markGood: 'Good',
      markBad: 'Bad',
      clear: 'Clear mark',
      empty: 'No candidate drafts (.txt / .md) in this directory',
      changeDir: 'Change folder',
      noDir: 'No candidate directory yet',
      loading: 'Loading…',
      savedGood: 'Marked good',
      savedBad: 'Marked bad',
      profile: 'Profile summary',
      segUnit: 'segments',
      recent: 'Recent',
      clearRecent: 'Clear',
      recommended: 'Suggested (folders holding drafts)',
      scanning: 'Scanning…',
      rescan: 'Rescan',
      noRecommend: 'No ready-made draft folder found — browse below',
      browse: 'Browse',
      home: 'Home',
      workspace: 'Project',
      up: 'Up',
      showHidden: 'Show hidden folders',
      hideHidden: 'Hide hidden folders',
      useDir: 'Use this folder',
      manual: '⌨ Type a path',
      manualHide: 'Hide path input',
      manualOk: 'OK',
      noBrowse: 'This dsh exposes no directory browsing; type the path instead',
      systemPick: 'Use the system dialog',
      draftUnit: 'files',
      candidateTag: 'drafts',
      emptyDir: '(empty)',
      truncated: 'Too many folders — only part is shown',
      dirLag: 'Directory switched but the host has not caught up — press ↻ to reload',
      tabCards: 'Cards',
      tabProfile: 'Author profile',
      profileTitle: 'Author Profile',
      profileFile: 'Profile file',
      updatedAt: 'updated',
      copyPath: 'Copy path',
      copied: 'Path copied',
      edit: 'Edit',
      save: 'Save',
      cancel: 'Cancel',
      saving: 'Saving…',
      savedOk: 'Profile saved',
      markedSegments: 'marked segments',
      fromFiles: 'Sources',
      jumpToSource: 'Back to this draft',
      noMarksYet: 'No marks in this directory yet',
      editHint: 'Edit the Markdown directly (the rules sections are yours). The auto block between begin / end is rewritten on each distill.',
      pickDirFirst: 'Pick a candidate directory first',
      emptyDoc: '(the file is empty)',
      hostTooOld: 'Saving needs the updated host half: restart dsh once to edit the profile in-app',
      autoBegin: 'workbench block · rewritten on each distill',
      autoEnd: 'end of workbench block',
      hostOldBanner: 'The host half is still the old build: what you see is the legacy quote file. Restart dsh once to enable rules-only profiles, evidence files and distillation.',
      hostOldShort: 'restart dsh',
      firstRunHint: 'Just read: press G for a passage you like, B for one that grates (or click the buttons on the right) — most paragraphs need no mark. Then hit “Distill rules”.',
      keyHints: 'j / k move · G good · B bad · Space clear · n / p switch draft',
      removeRule: 'Remove this rule',
      truncatedHint: 'The model output hit the length cap and may be missing rules — try another model or distill in two rounds.',
      distill: 'Distill rules',
      distilling: 'Distilling…',
      distillPending: 'to distill',
      distillWith: 'via',
      distillReview: 'Distilled rules (checked ones get adopted)',
      adoptSelected: 'Adopt checked',
      selectNone: 'Uncheck all',
      selectAll: 'Check all',
      discardCandidates: 'Discard',
      adoptedN: 'adopted',
      rulesEmpty: 'No rules yet — press “Distill rules” to compress the marks into reusable guidance',
      rulesOnlyHint: 'This file holds rules only (that is all a writing session needs); raw evidence lives in the evidence file below.',
      evidenceSection: 'Evidence (raw text)',
      evidenceUnit: 'segments',
      evidenceWarn: 'for human review and distillation only — never read it into a writing context',
      evidenceShow: 'Show raw text',
      evidenceHide: 'Hide raw text',
      evidenceRefresh: 'Refresh evidence',
      evidenceUpdated: 'Evidence updated',
      noPending: 'No new marks to distill',
      cappedHint: 'Lots of raw text — only the first',
      distillNoRoute: 'No model route: set distillProvider / distillModel for dsh-novel-craft, or hand the evidence file to your agent',
      lastDistill: 'last distilled',
      pendingChip: 'pending',
      markedChip: 'marks',
      hostTooOld: 'Saving needs the updated host half: restart dsh once to edit the profile in-app',
    }

    // ── 目录选择器的小工具：路径显示、最近使用（localStorage） ─────────────
    const RECENT_KEY = 'dsh-novel-craft.recent-dirs'
    const MAX_RECENT = 8
    /** 目录名像"候选稿"的，在浏览列表里打标——作者一眼认得出卡池在哪。 */
    const CANDIDATE_HINT = /候选|抽卡|对比|三版|重写|代理稿|定稿|草稿|candidate|draft|variant/i

    const shortPath = (path, limit) => {
      if (typeof path !== 'string' || path === '') return ''
      const max = limit === undefined ? 46 : limit
      if (path.length <= max) return path
      const parts = path.replace(/\/+$/, '').split('/').filter((s) => s !== '')
      return '…/' + parts.slice(-3).join('/')
    }
    /** 候选文件的短标签：末两段（`第8章-A-保守精修.txt` → `A · 保守精修`），完整名留在 tooltip。 */
    const candidateLabel = (file) => {
      const base = String(file).replace(/\.[^.]+$/, '')
      const parts = base.split(/[-–—_\s]+/).filter((part) => part !== '')
      if (parts.length <= 1) return base
      return parts.slice(-2).join(' · ')
    }
    /**
     * 一批候选的短标签：先剥掉所有文件共有的前缀（同目录里 `第9章-` 是纯噪音），
     * 再取末两段。所以 `第9章-A/第9章-B` → `A` / `B`，`第8章-A-保守精修` → `A · 保守精修`。
     */
    const candidateLabels = (files) => {
      const tokenLists = files.map((file) =>
        String(file)
          .replace(/\.[^.]+$/, '')
          .split(/[-–—_\s]+/)
          .filter((part) => part !== ''),
      )
      let common = 0
      if (tokenLists.length > 1) {
        while (tokenLists.every((tokens) => tokens.length > common + 1 && tokens[common] === tokenLists[0][common])) common += 1
      }
      return files.map((file, i) => {
        const rest = tokenLists[i].slice(common)
        const tokens = rest.length > 0 ? rest : tokenLists[i]
        const label = tokens.slice(-2).join(' · ')
        return label === '' ? String(file).replace(/\.[^.]+$/, '') : label
      })
    }
    /** 正文长度（按字算，空白不计）：作者是按字数判断篇幅的。 */
    const charCount = (text) => String(text).replace(/\s/g, '').length
    const formatChars = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k字' : n + '字')
    /** 键盘流：读稿时手不用离开键盘。返回动作名或 null。 */
    const keyToAction = (key) => {
      switch (key) {
        case 'j':
        case 'J':
        case 'ArrowDown':
          return 'next'
        case 'k':
        case 'K':
        case 'ArrowUp':
          return 'prev'
        case 'g':
        case 'G':
          return 'good'
        case 'b':
        case 'B':
          return 'bad'
        case ' ':
        case 'Spacebar':
          return 'clear'
        case 'n':
        case 'N':
          return 'nextFile'
        case 'p':
        case 'P':
          return 'prevFile'
        default:
          return null
      }
    }
    /** 焦点在输入类控件里时，快捷键让位给打字。 */
    const isTypingTarget = (target) => {
      if (target === null || target === undefined || typeof target !== 'object') return false
      const tag = typeof target.tagName === 'string' ? target.tagName.toLowerCase() : ''
      return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable === true
    }
    const formatBytes = (n) => {
      const size = typeof n === 'number' && n > 0 ? n : 0
      if (size < 1024) return size + ' B'
      if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB'
      return (size / 1024 / 1024).toFixed(1) + ' MB'
    }
    const baseNameOf = (path) => {
      if (typeof path !== 'string') return ''
      const trimmed = path.replace(/\/+$/, '')
      const cut = trimmed.lastIndexOf('/')
      return cut === -1 ? trimmed : trimmed.slice(cut + 1)
    }
    const readRecents = () => {
      try {
        const raw = window.localStorage.getItem(RECENT_KEY)
        const parsed = raw === null ? [] : JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string' && x !== '').slice(0, MAX_RECENT) : []
      } catch {
        return []
      }
    }
    const rememberDir = (path) => {
      const next = [path].concat(readRecents().filter((x) => x !== path)).slice(0, MAX_RECENT)
      try {
        window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      } catch {
        // 隐私模式/存储被禁：最近使用降级为本次会话内有效
      }
      return next
    }
    /** discover 的响应可能是 SPA 的 HTML（旧宿主半区），一律收敛成数组。 */
    const dirsFromDiscover = (data) => (data !== null && typeof data === 'object' && Array.isArray(data.dirs) ? data.dirs : [])

    // 偏好档案的自动块标记（与宿主半区同名常量）：块内会被汇总重写，块外是作者手写
    const AUTO_BEGIN = '<!-- dsh-novel-craft:auto:begin -->'
    const AUTO_END = '<!-- dsh-novel-craft:auto:end -->'

    /** 行内 **粗体** 与 `代码`：档案是 Markdown，但只用得上这两档。 */
    const inlineEls = (text, keyPrefix) => {
      const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter((part) => part !== '')
      if (parts.length <= 1) return text
      return parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return React.createElement('strong', { key: keyPrefix + '-' + i }, part.slice(2, -2))
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return React.createElement(
            'code',
            {
              key: keyPrefix + '-' + i,
              style: {
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 12,
                background: 'rgba(127,127,127,0.14)',
                padding: '1px 4px',
                borderRadius: 4,
              },
            },
            part.slice(1, -1),
          )
        }
        return part
      })
    }

    /**
     * 把档案 Markdown 渲染成可读的块：标题 / 引用（=证据卡）/ 列表 / 分隔线。
     * 不做完整 Markdown 解析——档案是工作台生成的，只有这几档结构。
     */
    function renderProfileDoc(text, t, options) {
      const lines = String(typeof text === 'string' ? text : '')
        .replace(/\r\n/g, '\n')
        .split('\n')
      const out = []
      let quote = []
      let seq = 0
      let insideAuto = false // 自动块里的账目行不是规律，不给删
      const flushQuote = () => {
        if (quote.length === 0) return
        seq += 1
        out.push(
          React.createElement(
            'div',
            {
              key: 'q' + seq,
              style: {
                borderLeft: '3px solid ' + C.accent,
                background: 'rgba(10,132,255,0.05)',
                borderRadius: '0 8px 8px 0',
                padding: '9px 13px',
                margin: '8px 0',
                fontSize: 14,
                lineHeight: 1.85,
                whiteSpace: 'pre-wrap',
              },
            },
            quote.join('\n\n'),
          ),
        )
        quote = []
      }
      const marker = (key, label) =>
        React.createElement(
          'div',
          { key, style: { display: 'flex', alignItems: 'center', gap: 8, margin: '18px 0 8px', color: C.sub, fontSize: 11 } },
          React.createElement('div', { style: { flex: 1, borderTop: '1px dashed ' + C.border } }),
          React.createElement('span', { style: { whiteSpace: 'nowrap' } }, label),
          React.createElement('div', { style: { flex: 1, borderTop: '1px dashed ' + C.border } }),
        )

      for (const raw of lines) {
        seq += 1
        const key = 'p' + seq
        const line = raw.replace(/\s+$/, '')
        if (line.startsWith('> ') || line === '>') {
          quote.push(line === '>' ? '' : line.slice(2))
          continue
        }
        flushQuote()
        if (line === '') continue
        if (line === AUTO_BEGIN) {
          insideAuto = true
          out.push(marker(key, t('autoBegin')))
          continue
        }
        if (line === AUTO_END) {
          insideAuto = false
          out.push(marker(key, t('autoEnd')))
          continue
        }
        const heading = /^(#{1,6})\s+(.*)$/.exec(line)
        if (heading !== null) {
          const level = heading[1].length
          const content = heading[2]
          const tone =
            /好用|选中|喜欢|已验证/.test(content) ? C.ok : /别再用|否决|避免|不喜欢/.test(content) ? C.danger : C.text
          const sizes = { 1: 19, 2: 16, 3: 14, 4: 13, 5: 12.5, 6: 12.5 }
          out.push(
            React.createElement(
              'div',
              {
                key,
                style: {
                  fontSize: sizes[level],
                  fontWeight: 700,
                  color: tone,
                  margin: level <= 2 ? '18px 0 6px' : '14px 0 4px',
                  borderTop: level === 2 ? '1px solid ' + C.border : 'none',
                  paddingTop: level === 2 ? 12 : 0,
                },
              },
              inlineEls(content, key),
            ),
          )
          continue
        }
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
          out.push(
            React.createElement('hr', { key, style: { border: 'none', borderTop: '1px solid ' + C.border, margin: '16px 0' } }),
          )
          continue
        }
        const item = /^[-*]\s+(.*)$/.exec(line)
        if (item !== null) {
          // 规律条目：作者可以一条一条否决，不必去改整份 Markdown
          const removable =
            insideAuto !== true &&
            options !== undefined &&
            options !== null &&
            typeof options.onRemoveRule === 'function'
          out.push(
            React.createElement(
              'div',
              { key, style: { display: 'flex', gap: 8, margin: '4px 0', fontSize: 13.5, lineHeight: 1.8, alignItems: 'flex-start' } },
              React.createElement('span', { style: { color: C.sub, flexShrink: 0 } }, '•'),
              React.createElement('span', { style: { flex: 1, minWidth: 0 } }, inlineEls(item[1], key)),
              removable
                ? React.createElement(
                    'button',
                    {
                      onClick: () => options.onRemoveRule(item[1]),
                      title: t('removeRule'),
                      style: {
                        flexShrink: 0,
                        border: 'none',
                        background: 'transparent',
                        color: C.sub,
                        cursor: 'pointer',
                        fontSize: 12,
                        padding: '0 2px',
                        lineHeight: 1.6,
                      },
                    },
                    '✕',
                  )
                : null,
            ),
          )
          continue
        }
        out.push(
          React.createElement('p', { key, style: { margin: '8px 0', fontSize: 13.5, lineHeight: 1.8 } }, inlineEls(line, key)),
        )
      }
      flushQuote()
      return out
    }

    // ── 工作台开关：模块级共享给两端注册点 ───────────────────────────────
    const listeners = new Set()
    let openState = false
    const setOpen = (v) => {
      openState = v
      for (const fn of listeners) fn(v)
    }
    const useOpen = () => {
      const [v, setV] = useState(openState)
      useEffect(() => {
        const fn = (nv) => setV(nv)
        listeners.add(fn)
        return () => listeners.delete(fn)
      }, [])
      return v
    }

    const C = {
      bg: 'var(--dsh-alias-bg, #f2f2f7)',
      card: 'var(--dsh-alias-bg-elevated, #ffffff)',
      text: 'var(--dsh-alias-text, #1c1c1e)',
      sub: 'var(--dsh-alias-text-secondary, #6b6b70)',
      border: 'var(--dsh-alias-border, rgba(0,0,0,0.10))',
      accent: '#0a84ff',
      ok: '#34c759',
      danger: '#ff3b30',
    }

    const btn = (extra) => ({
      border: '1px solid ' + C.border,
      background: 'transparent',
      color: 'inherit',
      borderRadius: 8,
      padding: '4px 10px',
      fontSize: 12,
      cursor: 'pointer',
      lineHeight: 1.4,
      ...extra,
    })

    /** 侧栏入口：一行可点标题 */
    function CraftEntry(props) {
      const open = useOpen()
      const t = props.t
      return React.createElement(
        'button',
        {
          onClick: () => setOpen(!open),
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '8px 12px',
            background: open ? 'rgba(10,132,255,0.10)' : 'transparent',
            border: 'none',
            color: 'inherit',
            cursor: 'pointer',
            fontSize: 13,
            textAlign: 'left',
          },
        },
        React.createElement('span', null, '🎴'),
        React.createElement('span', null, t('entry')),
      )
    }

    /** 抽卡工作台面板 */
    function CraftWorkbench(props) {
      const open = useOpen()
      const { t, scope, getWs } = props
      const [dir, setDir] = useState('')
      const [state, setState] = useState(null)
      const [active, setActive] = useState(0)
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState('')
      const [picker, setPicker] = useState(false)
      const [tab, setTab] = useState('cards')
      const [distillResult, setDistillResult] = useState(null) // 提炼出的规律，等作者勾选
      const [distilling, setDistilling] = useState(false)
      const [activeSeg, setActiveSeg] = useState(0) // 阅读光标：读到第几段
      const [hoverSeg, setHoverSeg] = useState(-1) // 鼠标停在哪段（那种段落才浮出标记按钮）

      // 配置里的候选目录同步到工作台
      useEffect(() => {
        if (scope === undefined || scope === null) return
        const sync = () => {
          const snap = scope.getSnapshot()
          const v = snap && snap.value && typeof snap.value === 'object' ? snap.value.candidateDir : ''
          setDir(typeof v === 'string' ? v : '')
        }
        sync()
        return scope.subscribe(sync)
      }, [scope])

      const fetchState = useCallback(async () => {
        const r = await fetch(API + 'state', { headers: { accept: 'application/json' } })
        return await r.json()
      }, [])

      /** 重新拉状态；切目录后宿主配置可能还在落盘，对不上就再等一拍。 */
      const reload = useCallback(
        async (expect) => {
          setBusy(true)
          setNotice(t('loading'))
          try {
            let data = await fetchState()
            let stale = false
            if (typeof expect === 'string' && expect !== '' && data.candidateDir !== expect) {
              await new Promise((resolve) => setTimeout(resolve, 150))
              data = await fetchState()
              stale = data.candidateDir !== expect
            }
            setState(data)
            setActive(0)
            setActiveSeg(0)
            // 宁可提示"没跟上"，也不要让界面安静地显示上一个目录的候选稿
            setNotice(stale ? t('dirLag') : '')
          } catch (e) {
            setNotice(String(e && e.message ? e.message : e))
          } finally {
            setBusy(false)
          }
        },
        [fetchState, t],
      )

      useEffect(() => {
        if (open && state === null) void reload()
      }, [open, state, reload])

      /** 选择器选定目录：存进设置（随作品走）再重新载入。 */
      const applyDir = useCallback(
        async (path) => {
          if (scope !== undefined && scope !== null) {
            try {
              await scope.set('candidateDir', path)
            } catch (e) {
              setNotice(String(e && e.message ? e.message : e))
            }
          }
          setDir(path)
          await reload(path)
        },
        [reload, scope],
      )

      const mark = async (file, index, value, options) => {
        const current = state && state.marks && state.marks[file] ? state.marks[file][String(index)] : undefined
        // 鼠标点：再点一次取消（toggle）；键盘连标：一律置成目标值，免得一路标一路被切掉
        const toggle = options === undefined || options.toggle !== false
        const next = toggle && current === value ? null : value
        setBusy(true)
        try {
          const r = await fetch(API + 'marks', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ file, index, mark: next }),
          })
          const data = await r.json()
          if (data.error !== undefined) throw new Error(data.error)
          setState((prev) => (prev === null ? prev : { ...prev, marks: data.marks }))
          setNotice(next === 'good' ? t('savedGood') : next === 'bad' ? t('savedBad') : '')
        } catch (e) {
          setNotice(String(e && e.message ? e.message : e))
        } finally {
          setBusy(false)
        }
      }

      /** 提炼规律：原文只进这一次便宜的辅助调用，产出条目给作者勾选。 */
      const runDistill = async (mode) => {
        if (mode === 'discard') {
          setDistillResult(null)
          setNotice('')
          return
        }
        setDistilling(true)
        setNotice(t('distilling'))
        try {
          const r = await fetch(API + 'distill', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          })
          const data = await r.json().catch(() => null)
          if (data === null) throw new Error(t('hostTooOld'))
          if (data.error !== undefined) throw new Error(data.error)
          setDistillResult(data)
          setNotice('')
        } catch (e) {
          setNotice(String(e && e.message ? e.message : e))
        } finally {
          setDistilling(false)
        }
      }

      /** 采纳勾选的规律：写进档案（只有规律），水位推到已采纳的标注。 */
      const adoptRules = async (items, model) => {
        setBusy(true)
        try {
          const r = await fetch(API + 'rules', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ items, model }),
          })
          const data = await r.json().catch(() => null)
          if (data === null) throw new Error(t('hostTooOld'))
          if (data.error !== undefined) throw new Error(data.error)
          setDistillResult(null)
          setNotice(t('adoptedN') + ' ' + data.added + ' / ' + items.length)
          await reload()
        } catch (e) {
          setNotice(String(e && e.message ? e.message : e))
        } finally {
          setBusy(false)
        }
      }

      /** 收录证据：原文写进「证据摘录.md」，档案只刷新自动块。 */
      const updateEvidence = async () => {
        setBusy(true)
        try {
          const r = await fetch(API + 'evidence', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          })
          const data = await r.json().catch(() => null)
          if (data === null) throw new Error(t('hostTooOld'))
          if (data.error !== undefined) throw new Error(data.error)
          setNotice(t('evidenceUpdated') + ' · ' + data.evidenceCount + ' ' + t('evidenceUnit'))
          await reload()
        } catch (e) {
          setNotice(String(e && e.message ? e.message : e))
        } finally {
          setBusy(false)
        }
      }

      /** 展开看原文时才拉正文：几 KB 的东西不必每次首屏都拖着。 */
      const fetchEvidenceDoc = async () => {
        try {
          const r = await fetch(API + 'evidence-text', { headers: { accept: 'application/json' } })
          const data = await r.json().catch(() => null)
          if (data === null || data.error !== undefined) return ''
          return typeof data.text === 'string' ? data.text : ''
        } catch {
          return ''
        }
      }

      // 读稿是连续动作，键盘优先：j/k 换段、G 标好、B 标坏、空格取消、n/p 换篇。
      // 输入框里打字、开着目录选择器、或不在「抽卡」页时一律让位。
      useEffect(() => {
        if (!open || tab !== 'cards' || picker || typeof window === 'undefined' || window.addEventListener === undefined) return undefined
        const onKey = (event) => {
          if (event.metaKey || event.ctrlKey || event.altKey) return
          if (isTypingTarget(event.target)) return
          const action = keyToAction(event.key)
          if (action === null) return
          const list = state !== null && Array.isArray(state.candidates) ? state.candidates : []
          const file = list[active]
          if (file === undefined) return
          const total = Array.isArray(file.segments) ? file.segments.length : 0
          event.preventDefault()
          if (action === 'next') setActiveSeg((prev) => Math.min(prev + 1, Math.max(total - 1, 0)))
          else if (action === 'prev') setActiveSeg((prev) => Math.max(prev - 1, 0))
          else if (action === 'good' || action === 'bad') {
            void mark(file.file, activeSeg, action === 'good' ? 'good' : 'bad', { toggle: false })
            setActiveSeg((prev) => Math.min(prev + 1, Math.max(total - 1, 0)))
          } else if (action === 'clear') {
            // 没标过的段落就别写了（省一次落盘，也免得刷出"已取消"的空提示）
            const entry = state !== null && state.marks !== null && typeof state.marks === 'object' ? state.marks[file.file] : undefined
            const existing = entry !== undefined && entry !== null && typeof entry === 'object' ? entry[String(activeSeg)] : undefined
            if (existing !== undefined) void mark(file.file, activeSeg, null)
          }
          else if (action === 'nextFile') {
            setActive(Math.min(active + 1, list.length - 1))
            setActiveSeg(0)
          } else if (action === 'prevFile') {
            setActive(Math.max(active - 1, 0))
            setActiveSeg(0)
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      })

      // 光标换段时把它带进视野中间，读长稿不用自己找位置
      useEffect(() => {
        if (!open || tab !== 'cards' || typeof document === 'undefined') return
        const node = document.querySelector('[data-seg="' + String(activeSeg) + '"]')
        if (node !== null && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' })
      }, [activeSeg, active, open, tab])

      if (!open) return null

      const candidates = state && Array.isArray(state.candidates) ? state.candidates : []
      const current = candidates[active]
      const marks = state && state.marks ? state.marks : {}
      const markOf = (file, i) => (marks[file] ? marks[file][String(i)] : undefined)
      const labels = candidateLabels(candidates.map((c) => c.file))

      /** 界面里保存档案正文；成功返回 true，好让编辑态退出。 */
      const saveProfile = async (content) => {
        setBusy(true)
        try {
          const r = await fetch(API + 'profile', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ content }),
          })
          // 旧宿主半区没有这个接口：会回 SPA 的 HTML 或 405，别把解析错误甩给作者
          const data = await r.json().catch(() => null)
          if (data === null) throw new Error(t('hostTooOld'))
          if (data.error !== undefined) throw new Error(data.error)
          setState((prev) =>
            prev === null ? prev : { ...prev, profile: data.profile, profileUpdatedAt: data.profileUpdatedAt },
          )
          setNotice(t('savedOk'))
          return true
        } catch (e) {
          setNotice(String(e && e.message ? e.message : e))
          return false
        } finally {
          setBusy(false)
        }
      }

      /** 从档案的"来源"点回抽卡视图的那一篇。 */
      const jumpToFile = (file) => {
        const index = candidates.findIndex((c) => c.file === file)
        if (index === -1) return
        setActive(index)
        setTab('cards')
      }

      const hostReady = state !== null && state.stats !== null && typeof state.stats === 'object'
      const pendingCount = hostReady && typeof state.stats.pending === 'number' ? state.stats.pending : 0


      // 已标注段数：tab 上带个数字，一眼知道档案攒了多少证据
      let markedCount = 0
      for (const entry of Object.values(marks)) {
        if (entry === null || typeof entry !== 'object') continue
        for (const value of Object.values(entry)) {
          if (value === 'good' || value === 'bad') markedCount += 1
        }
      }
      const tabBtn = (id, label) =>
        React.createElement(
          'button',
          {
            onClick: () => setTab(id),
            style: {
              border: 'none',
              borderBottom: '2px solid ' + (tab === id ? C.accent : 'transparent'),
              background: 'transparent',
              color: tab === id ? C.text : C.sub,
              fontWeight: tab === id ? 600 : 400,
              fontSize: 13,
              padding: '7px 10px',
              cursor: 'pointer',
            },
          },
          label,
        )

      return React.createElement(
        'div',
        {
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: 900,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          },
          onMouseDown: (e) => {
            if (e.target === e.currentTarget) setOpen(false)
          },
        },
        React.createElement(
          'div',
          {
            style: {
              width: 'min(1040px, 100%)',
              height: 'min(760px, 100%)',
              background: C.bg,
              color: C.text,
              borderRadius: 16,
              border: '1px solid ' + C.border,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              boxShadow: '0 20px 60px rgba(0,0,0,0.28)',
            },
          },
          // 顶部栏
          React.createElement(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '14px 18px',
                borderBottom: '1px solid ' + C.border,
                background: C.card,
              },
            },
            React.createElement('div', { style: { fontSize: 17, fontWeight: 700 } }, '🎴 ' + t('title')),
            // 候选目录：点开选择器，不再手填绝对路径
            React.createElement(
              'button',
              {
                onClick: () => setPicker(true),
                title: (dir === '' ? t('pickHint') : dir) + '\n' + t('pickHint'),
                style: btn({
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 12px',
                  fontSize: 13,
                  textAlign: 'left',
                }),
              },
              React.createElement('span', { style: { flexShrink: 0 } }, '📁'),
              React.createElement(
                'span',
                {
                  style: {
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: dir === '' ? C.sub : 'inherit',
                  },
                },
                dir === '' ? t('pickDir') : shortPath(dir, 52),
              ),
              React.createElement('span', { style: { flexShrink: 0, color: C.sub, fontSize: 11 } }, '▾'),
            ),
            React.createElement('button', { onClick: () => void reload(), disabled: busy, title: t('load'), style: btn() }, '↻'),
            React.createElement(
              'button',
              { onClick: () => setOpen(false), style: btn({ padding: '4px 12px', fontSize: 15 }) },
              '✕',
            ),
          ),
          // 视图切换：抽卡 / 偏好档案
          React.createElement(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '0 18px',
                borderBottom: '1px solid ' + C.border,
                background: C.card,
              },
            },
            tabBtn('cards', '🎴 ' + t('tabCards')),
            tabBtn('profile', '📋 ' + t('tabProfile') + (markedCount > 0 ? ' · ' + markedCount : '')),
          ),
          tab === 'profile'
            ? React.createElement(ProfileView, {
                t,
                state,
                dir,
                busy,
                distill: distillResult,
                distilling,
                onDistill: (mode) => void runDistill(mode),
                onAdopt: adoptRules,
                onEvidenceDoc: fetchEvidenceDoc,
                onEvidence: () => void updateEvidence(),
                onSave: saveProfile,
                onJump: jumpToFile,
                onPickDir: () => setPicker(true),
              })
            : null,
          // 当前目录全路径：看得见，但不用敲
          tab !== 'cards' || dir === ''
            ? null
            : React.createElement(
                'div',
                {
                  style: {
                    padding: '5px 18px',
                    borderBottom: '1px solid ' + C.border,
                    background: C.card,
                    fontSize: 11,
                    color: C.sub,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    userSelect: 'text',
                  },
                },
                '📂 ' + dir,
              ),
          // 候选切换
          tab !== 'cards' || candidates.length === 0
            ? null
            : React.createElement(
                'div',
                {
                  style: {
                    display: 'flex',
                    gap: 8,
                    padding: '10px 18px',
                    overflowX: 'auto',
                    borderBottom: '1px solid ' + C.border,
                    background: C.card,
                  },
                },
                ...candidates.map((c, i) => {
                  const marks = c.file !== undefined && state.marks !== null && typeof state.marks === 'object' ? state.marks[c.file] : undefined
                  let markedHere = 0
                  if (marks !== null && marks !== undefined && typeof marks === 'object') markedHere = Object.keys(marks).length
                  const chars = c.segments.reduce((sum, seg) => sum + charCount(seg), 0)
                  const isCurrent = i === active
                  return React.createElement(
                    'button',
                    {
                      key: c.file,
                      onClick: () => {
                        setActive(i)
                        setActiveSeg(0)
                      },
                      title: c.file,
                      style: btn(
                        isCurrent
                          ? { background: C.accent, color: '#fff', borderColor: C.accent }
                          : { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, lineHeight: 1.35 },
                      ),
                    },
                    React.createElement(
                      'span',
                      { style: { fontWeight: isCurrent ? 600 : 500, fontSize: 12.5 } },
                      labels[i],
                    ),
                    React.createElement(
                      'span',
                      {
                        style: {
                          fontSize: 10.5,
                          color: isCurrent ? 'rgba(255,255,255,0.85)' : C.sub,
                          whiteSpace: 'nowrap',
                        },
                      },
                      formatChars(chars) + (markedHere > 0 ? ' · 标 ' + markedHere : ''),
                    ),
                  )
                }),
              ),
          // 段落区
          // 读稿区：连续正文 + 左侧标注色条，按钮只在光标/悬停处浮出（读起来像读小说，不是审表格）
          React.createElement(
            'div',
            { style: { flex: 1, overflow: 'auto', padding: '14px 18px', display: tab === 'cards' ? 'block' : 'none' } },
            state === null
              ? React.createElement(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, paddingTop: 64 } },
                  React.createElement('div', { style: { color: C.sub, fontSize: 14 } }, dir === '' ? t('noDir') : t('loading')),
                  React.createElement(
                    'button',
                    {
                      onClick: () => setPicker(true),
                      style: btn({
                        background: C.accent,
                        borderColor: C.accent,
                        color: '#fff',
                        fontWeight: 600,
                        fontSize: 14,
                        padding: '10px 18px',
                      }),
                    },
                    '📁 ' + t('pickDir'),
                  ),
                  React.createElement('div', { style: { color: C.sub, fontSize: 12 } }, t('pickHint')),
                )
              : current === undefined
                ? React.createElement(
                    'div',
                    { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, paddingTop: 56 } },
                    React.createElement('div', { style: { color: C.sub, fontSize: 13 } }, t('empty')),
                    React.createElement(
                      'button',
                      { onClick: () => setPicker(true), style: btn({ fontSize: 13, padding: '8px 16px' }) },
                      '📁 ' + t('changeDir'),
                    ),
                  )
                : React.createElement(
                    'div',
                    { style: { display: 'flex', flexDirection: 'column', maxWidth: 780, margin: '0 auto' } },
                    markedCount === 0
                      ? React.createElement(
                          'div',
                          {
                            style: {
                              fontSize: 12,
                              color: C.sub,
                              lineHeight: 1.8,
                              marginBottom: 10,
                              padding: '6px 10px',
                              border: '1px dashed ' + C.border,
                              borderRadius: 8,
                            },
                          },
                          t('firstRunHint'),
                        )
                      : null,
                    ...current.segments.map((seg, i) => {
                      const m = markOf(current.file, i)
                      const isCurrent = i === activeSeg
                      const showButtons = isCurrent || hoverSeg === i || m !== undefined
                      const buttons = []
                      buttons.push(
                        React.createElement(
                          'button',
                          {
                            key: 'good',
                            onClick: (e) => {
                              e.stopPropagation()
                              void mark(current.file, i, 'good')
                            },
                            disabled: busy,
                            title: t('markGood') + '（G）',
                            style: btn({
                              fontSize: 13,
                              padding: '1px 6px',
                              opacity: m === 'good' ? 1 : 0.55,
                              background: m === 'good' ? C.ok : 'transparent',
                              borderColor: m === 'good' ? C.ok : C.border,
                              color: m === 'good' ? '#fff' : 'inherit',
                            }),
                          },
                          '👍',
                        ),
                      )
                      buttons.push(
                        React.createElement(
                          'button',
                          {
                            key: 'bad',
                            onClick: (e) => {
                              e.stopPropagation()
                              void mark(current.file, i, 'bad')
                            },
                            disabled: busy,
                            title: t('markBad') + '（B）',
                            style: btn({
                              fontSize: 13,
                              padding: '1px 6px',
                              opacity: m === 'bad' ? 1 : 0.55,
                              background: m === 'bad' ? C.danger : 'transparent',
                              borderColor: m === 'bad' ? C.danger : C.border,
                              color: m === 'bad' ? '#fff' : 'inherit',
                            }),
                          },
                          '👎',
                        ),
                      )
                      return React.createElement(
                        'div',
                        {
                          key: String(i),
                          'data-seg': i,
                          onMouseEnter: () => setHoverSeg(i),
                          onMouseLeave: () => setHoverSeg((prev) => (prev === i ? -1 : prev)),
                          onClick: () => setActiveSeg(i),
                          style: {
                            display: 'flex',
                            gap: 10,
                            alignItems: 'flex-start',
                            padding: '6px 10px 6px 12px',
                            borderRadius: '0 8px 8px 0',
                            borderLeft:
                              '3px solid ' +
                              (m === 'good' ? C.ok : m === 'bad' ? C.danger : isCurrent ? 'rgba(127,127,127,0.4)' : 'transparent'),
                            background:
                              m === 'good'
                                ? 'rgba(52,199,89,0.07)'
                                : m === 'bad'
                                  ? 'rgba(255,59,48,0.06)'
                                  : isCurrent
                                    ? 'rgba(127,127,127,0.06)'
                                    : 'transparent',
                          },
                        },
                        React.createElement(
                          'div',
                          { style: { flex: 1, minWidth: 0, fontSize: 15.5, lineHeight: 1.95, whiteSpace: 'pre-wrap' } },
                          seg,
                        ),
                        React.createElement(
                          'div',
                          {
                            style: {
                              display: 'flex',
                              gap: 3,
                              flexShrink: 0,
                              paddingTop: 3,
                              opacity: showButtons ? 1 : 0,
                              pointerEvents: showButtons ? 'auto' : 'none',
                              transition: 'opacity 0.12s',
                            },
                          },
                          ...buttons,
                        ),
                      )
                    }),
                  ),
          ),
          // 阅读状态条：光标在哪、有哪些快捷键，就在眼皮底下
          tab !== 'cards' || current === undefined
            ? null
            : React.createElement(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '4px 18px 6px',
                    fontSize: 11,
                    color: C.sub,
                    background: C.card,
                    flexShrink: 0,
                  },
                },
                React.createElement(
                  'span',
                  { style: { fontVariantNumeric: 'tabular-nums' } },
                  activeSeg + 1 + ' / ' + current.segments.length + ' ' + t('segUnit'),
                ),
                React.createElement(
                  'span',
                  { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                  t('keyHints'),
                ),
              ),
          // 底部栏
          React.createElement(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 18px',
                borderTop: '1px solid ' + C.border,
                background: C.card,
              },
            },
            // 旧宿主半区没有提炼接口：按钮不摆出来，免得按了没反应
            state !== null && !hostReady
              ? React.createElement('span', { style: { fontSize: 11.5, color: C.danger, flexShrink: 0 } }, t('hostOldShort'))
              : React.createElement(
              'button',
              {
                onClick: () => {
                  setTab('profile')
                  void runDistill()
                },
                disabled: busy || distilling || pendingCount === 0,
                style: btn({
                  background: pendingCount === 0 ? 'transparent' : C.accent,
                  borderColor: pendingCount === 0 ? C.border : C.accent,
                  color: pendingCount === 0 ? C.sub : '#fff',
                  fontWeight: 600,
                  padding: '8px 16px',
                  opacity: busy || distilling ? 0.6 : 1,
                }),
              },
              '⚗️ ' + (distilling ? t('distilling') : t('distill')) + (pendingCount > 0 ? '（' + pendingCount + '）' : ''),
            ),
            React.createElement(
              'div',
              { style: { flex: 1, minWidth: 0, color: C.sub, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              notice,
            ),
            state && state.profile
              ? React.createElement(
                  'button',
                  {
                    onClick: () => {
                      setTab('profile')
                      setNotice('')
                    },
                    style: btn({ fontSize: 12 }),
                  },
                  '📋 ' + t('tabProfile'),
                )
              : null,
          ),
          // 目录选择器（点顶部「📁」打开）
          picker
            ? React.createElement(DirPicker, {
                t,
                current: dir,
                getWs,
                onPick: async (path) => {
                  await applyDir(path)
                  setPicker(false)
                },
                onClose: () => setPicker(false),
              })
            : null,
        ),
      )
    }

    /**
     * 目录选择器：三个入口（推荐 / 最近 / 浏览）+ 手动输入兜底。
     * 浏览用平台自带的 ctx.workspaces.listDirectory（宿主侧 directoryPicker），
     * 因此不需要本插件宿主半区提供列目录能力。
     */
    function DirPicker(props) {
      const { t, current, getWs, onPick, onClose } = props
      const [listing, setListing] = useState(null)
      const [error, setError] = useState('')
      const [loading, setLoading] = useState(true)
      const [showHidden, setShowHidden] = useState(false)
      const [recents, setRecents] = useState(readRecents)
      const [recommended, setRecommended] = useState(null)
      const [scanning, setScanning] = useState(false)
      const [counts, setCounts] = useState({})
      const [manual, setManual] = useState(false)
      const [draft, setDraft] = useState(typeof current === 'string' ? current : '')
      const [picking, setPicking] = useState(false)
      const seq = React.useRef(0)
      const annotateOff = React.useRef(false)

      // 宿主半区较新时才有 /annotate：给每个子目录回候选稿篇数，没有就静默降级
      const annotate = useCallback(async (data) => {
        if (annotateOff.current || data === null || !Array.isArray(data.entries)) return
        const paths = data.entries.map((e) => e.path).slice(0, 60)
        if (paths.length === 0) return
        try {
          const res = await fetch(API + 'annotate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ paths }),
          })
          if (!res.ok) {
            annotateOff.current = true
            return
          }
          const out = await res.json()
          if (out !== null && typeof out.counts === 'object' && out.counts !== null) {
            setCounts((prev) => ({ ...prev, ...out.counts }))
          }
        } catch {
          annotateOff.current = true
        }
      }, [])

      const browse = useCallback(
        async (target) => {
          const ws = getWs()
          if (ws === undefined || ws === null || typeof ws.listDirectory !== 'function') {
            setError(t('noBrowse'))
            setLoading(false)
            setManual(true)
            return
          }
          const mine = seq.current + 1
          seq.current = mine
          setLoading(true)
          setError('')
          try {
            const data =
              target === undefined || target === null || target === ''
                ? await ws.listDirectory()
                : await ws.listDirectory(target)
            if (seq.current !== mine) return
            setListing(data)
            void annotate(data)
          } catch (e) {
            if (seq.current !== mine) return
            setError(String(e && e.message ? e.message : e))
          } finally {
            if (seq.current === mine) setLoading(false)
          }
        },
        [annotate, getWs, t],
      )

      /** 当前会话所在的作品目录——第一次打开时从这儿起步，比主目录近得多。 */
      const workspacePath = useCallback(() => {
        const ws = getWs()
        if (ws === undefined || ws === null || ws.list === undefined) return ''
        try {
          const snap = ws.list.getSnapshot()
          const items = snap !== null && snap !== undefined && Array.isArray(snap.items) ? snap.items : []
          const recent = items.find((w) => w.id === snap.recentWorkspaceId)
          const pick = recent === undefined ? items[0] : recent
          return pick !== undefined && typeof pick.path === 'string' ? pick.path : ''
        } catch {
          return ''
        }
      }, [getWs])

      /** 拉一次「推荐目录」。刚抽完新一轮候选时可手动重扫（宿主侧有 5 秒缓存）。 */
      const scan = useCallback(async () => {
        setScanning(true)
        try {
          const res = await fetch(API + 'discover', { headers: { accept: 'application/json' } })
          const data = res.ok ? await res.json() : null
          // 宿主半区还没升级时，未知路径会回 SPA 的 HTML（200 但不是 JSON）：
          // dirsFromDiscover 一律收敛成数组，UI 显示"自己挑"，而不是永远转圈。
          setRecommended(dirsFromDiscover(data))
        } catch {
          setRecommended([])
        } finally {
          setScanning(false)
        }
      }, [])

      useEffect(() => {
        let alive = true
        const start = async () => {
          await scan()
          if (!alive) return
          await browse(typeof current === 'string' && current !== '' ? current : workspacePath())
        }
        void start()
        return () => {
          alive = false
        }
      }, [browse, current, scan, workspacePath])

      const home = listing !== null && typeof listing.home === 'string' ? listing.home : ''
      const entries = listing !== null && Array.isArray(listing.entries) ? listing.entries : []
      const visible = entries.filter((e) => showHidden || e.hidden !== true)
      const crumbs = listing !== null && Array.isArray(listing.crumbs) ? listing.crumbs : []
      const trail = crumbs.length > 5 ? crumbs.slice(-5) : crumbs
      const listed = listing !== null && typeof listing.path === 'string' ? listing.path : ''
      const wsPath = workspacePath()
      const countOf = (path) => (typeof counts[path] === 'number' ? counts[path] : 0)

      const choose = async (path) => {
        if (typeof path !== 'string' || path.trim() === '') return
        const clean = path.trim()
        setPicking(true)
        setRecents(rememberDir(clean))
        await onPick(clean)
        setPicking(false)
      }

      const rowStyle = {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        textAlign: 'left',
        padding: '7px 10px',
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        borderRadius: 8,
        fontSize: 13,
        lineHeight: 1.5,
      }
      const dirRow = (opts) =>
        React.createElement(
          'button',
          {
            key: opts.key,
            onClick: opts.onClick,
            title: opts.title === undefined ? opts.label : opts.title,
            disabled: picking,
            style: { ...rowStyle, background: opts.strong === true ? 'rgba(10,132,255,0.08)' : 'transparent' },
            onMouseEnter: (e) => {
              e.currentTarget.style.background = 'rgba(10,132,255,0.12)'
            },
            onMouseLeave: (e) => {
              e.currentTarget.style.background = opts.strong === true ? 'rgba(10,132,255,0.08)' : 'transparent'
            },
          },
          React.createElement('span', { style: { flexShrink: 0, opacity: 0.8 } }, opts.icon === undefined ? '📁' : opts.icon),
          React.createElement(
            'span',
            { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            opts.label,
          ),
          opts.badge === undefined || opts.badge === null
            ? null
            : React.createElement(
                'span',
                {
                  style: {
                    flexShrink: 0,
                    fontSize: 11,
                    padding: '1px 7px',
                    borderRadius: 99,
                    border: '1px solid ' + C.border,
                    color: C.sub,
                    whiteSpace: 'nowrap',
                  },
                },
                opts.badge,
              ),
        )
      const sectionTitle = (text) =>
        React.createElement(
          'div',
          { style: { margin: '12px 0 2px', fontSize: 11, fontWeight: 700, letterSpacing: 0.3, color: C.sub } },
          text,
        )

      const sections = []

      // ① 推荐：宿主半区扫出来的、真的装着候选稿的目录
      sections.push(
        React.createElement(
          'div',
          { key: 'rec-head', style: { display: 'flex', alignItems: 'center', gap: 8 } },
          sectionTitle(t('recommended')),
          React.createElement('div', { style: { flex: 1 } }),
          React.createElement(
            'button',
            { onClick: () => void scan(), disabled: scanning, style: btn({ fontSize: 11, padding: '1px 8px', color: C.sub }) },
            scanning ? t('scanning') : t('rescan'),
          ),
        ),
      )
      if (recommended === null) {
        sections.push(React.createElement('div', { key: 'rec-wait', style: { fontSize: 12, color: C.sub, padding: '4px 10px' } }, t('scanning')))
      } else if (recommended.length === 0) {
        sections.push(React.createElement('div', { key: 'rec-none', style: { fontSize: 12, color: C.sub, padding: '4px 10px' } }, t('noRecommend')))
      } else {
        for (const dir of recommended.slice(0, 12)) {
          sections.push(
            dirRow({
              key: 'rec-' + dir.path,
              icon: '🎴',
              label: shortPath(dir.rel === '' ? dir.path : dir.rel, 40),
              title: dir.path,
              badge: dir.count + ' ' + t('draftUnit'),
              strong: dir.path === current,
              onClick: () => void choose(dir.path),
            }),
          )
        }
      }

      // ② 最近使用：localStorage，纯客户端，第二次来就是一次点击
      if (recents.length > 0) {
        sections.push(
          React.createElement(
            'div',
            { key: 'recent-head', style: { display: 'flex', alignItems: 'center', gap: 8 } },
            sectionTitle(t('recent')),
            React.createElement('div', { style: { flex: 1 } }),
            React.createElement(
              'button',
              {
                onClick: () => {
                  try {
                    window.localStorage.removeItem(RECENT_KEY)
                  } catch {
                    // 忽略：清不掉就只是留着几行记录
                  }
                  setRecents([])
                },
                style: btn({ fontSize: 11, padding: '1px 8px', color: C.sub }),
              },
              t('clearRecent'),
            ),
          ),
        )
        for (const path of recents) {
          sections.push(
            dirRow({
              key: 'recent-' + path,
              icon: '🕘',
              label: shortPath(path, 48),
              title: path,
              strong: path === current,
              onClick: () => void choose(path),
            }),
          )
        }
      }

      // ③ 浏览：面包屑 + 子目录。列目录走平台 RPC，本插件不碰文件系统
      sections.push(sectionTitle(t('browse')))
      sections.push(
        React.createElement(
          'div',
          { key: 'browse-head', style: { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 6px', flexWrap: 'wrap' } },
          React.createElement(
            'button',
            {
              onClick: () => void browse(home === '' ? undefined : home),
              style: btn({ fontSize: 11, padding: '1px 8px' }),
              title: t('home'),
            },
            '🏠 ' + t('home'),
          ),
          wsPath === ''
            ? null
            : React.createElement(
                'button',
                {
                  onClick: () => void browse(wsPath),
                  style: btn({ fontSize: 11, padding: '1px 8px' }),
                  title: wsPath,
                },
                '📚 ' + t('workspace'),
              ),
          React.createElement('div', { style: { flex: 1 } }),
          entries.length === 0
            ? null
            : React.createElement(
                'button',
                { onClick: () => setShowHidden(!showHidden), style: btn({ fontSize: 11, padding: '1px 8px' }) },
                showHidden ? t('hideHidden') : t('showHidden'),
              ),
        ),
      )
      sections.push(
        React.createElement(
          'div',
          {
            key: 'crumbs',
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              padding: '4px 8px',
              fontSize: 12,
              overflowX: 'auto',
              whiteSpace: 'nowrap',
              background: 'rgba(127,127,127,0.06)',
              borderRadius: 8,
              margin: '2px 0',
            },
          },
          crumbs.length > 5 ? React.createElement('span', { style: { color: C.sub } }, '… / ') : null,
          ...trail.map((crumb, i) =>
            React.createElement(
              'span',
              { key: 'crumb-' + crumb.path, style: { display: 'inline-flex', alignItems: 'center', gap: 2 } },
              i > 0 || crumbs.length > 5 ? React.createElement('span', { style: { color: C.sub } }, '/') : null,
              React.createElement(
                'button',
                {
                  onClick: () => void browse(crumb.path),
                  title: crumb.path,
                  style: {
                    border: 'none',
                    background: 'transparent',
                    color: i === trail.length - 1 ? C.text : C.sub,
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: i === trail.length - 1 ? 600 : 400,
                    padding: '1px 3px',
                    maxWidth: 150,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  },
                },
                crumb.name === '' ? crumb.path : crumb.name,
              ),
            ),
          ),
        ),
      )
      if (error !== '') {
        sections.push(
          React.createElement(
            'div',
            { key: 'browse-error', style: { fontSize: 12, color: C.danger, padding: '4px 10px' } },
            error,
            React.createElement(
              'button',
              {
                onClick: async () => {
                  const ws = getWs()
                  if (ws === undefined || ws === null || typeof ws.pickDirectory !== 'function') return
                  try {
                    const picked = await ws.pickDirectory()
                    if (typeof picked === 'string' && picked !== '') await choose(picked)
                  } catch (e) {
                    setError(String(e && e.message ? e.message : e))
                  }
                },
                style: btn({ fontSize: 11, padding: '1px 8px', marginLeft: 8 }),
              },
              t('systemPick'),
            ),
          ),
        )
      }
      if (loading) {
        sections.push(React.createElement('div', { key: 'browse-loading', style: { fontSize: 12, color: C.sub, padding: '6px 10px' } }, t('loading')))
      } else if (error === '') {
        if (visible.length === 0) {
          sections.push(React.createElement('div', { key: 'browse-empty', style: { fontSize: 12, color: C.sub, padding: '6px 10px' } }, t('emptyDir')))
        }
        for (const entry of visible) {
          const direct = countOf(entry.path)
          sections.push(
            dirRow({
              key: 'entry-' + entry.path,
              label: entry.name,
              title: entry.path,
              badge: direct > 0 ? direct + ' ' + t('draftUnit') : CANDIDATE_HINT.test(entry.name) ? t('candidateTag') : undefined,
              onClick: () => void browse(entry.path),
            }),
          )
        }
        if (listing !== null && listing.truncated === true) {
          sections.push(React.createElement('div', { key: 'browse-trunc', style: { fontSize: 11, color: C.sub, padding: '4px 10px' } }, t('truncated')))
        }
      }

      return React.createElement(
        'div',
        {
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: 950,
            background: 'rgba(0,0,0,0.28)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          },
          onMouseDown: (e) => {
            if (e.target === e.currentTarget) onClose()
          },
        },
        React.createElement(
          'div',
          {
            style: {
              width: 'min(620px, 100%)',
              maxHeight: 'min(580px, 100%)',
              background: C.card,
              color: C.text,
              borderRadius: 14,
              border: '1px solid ' + C.border,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            },
          },
          React.createElement(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '13px 16px 10px',
                borderBottom: '1px solid ' + C.border,
              },
            },
            React.createElement('div', { style: { fontSize: 15, fontWeight: 700 } }, '📁 ' + t('pickDirTitle')),
            React.createElement('div', { style: { flex: 1 } }),
            React.createElement('button', { onClick: onClose, style: btn({ fontSize: 14, padding: '2px 10px' }) }, '✕'),
          ),
          React.createElement('div', { style: { flex: 1, overflow: 'auto', padding: '4px 12px 12px' } }, ...sections),
          React.createElement(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '11px 16px',
                borderTop: '1px solid ' + C.border,
                background: 'rgba(127,127,127,0.05)',
              },
            },
            React.createElement(
              'button',
              {
                onClick: () => void choose(listed),
                disabled: picking || listed === '',
                style: btn({
                  background: C.accent,
                  borderColor: C.accent,
                  color: '#fff',
                  fontWeight: 600,
                  padding: '7px 14px',
                  opacity: picking || listed === '' ? 0.5 : 1,
                }),
              },
              t('useDir') + (listed === '' ? '' : '：' + (baseNameOf(listed) === '' ? listed : baseNameOf(listed))),
            ),
            React.createElement('div', { style: { flex: 1 } }),
            React.createElement('button', { onClick: () => setManual(!manual), style: btn({ fontSize: 11, padding: '2px 8px' }) }, manual ? t('manualHide') : t('manual')),
          ),
          manual
            ? React.createElement(
                'div',
                { style: { display: 'flex', gap: 8, padding: '0 16px 12px' } },
                React.createElement('input', {
                  value: draft,
                  placeholder: t('dirPlaceholder'),
                  autoFocus: true,
                  onChange: (e) => setDraft(e.target.value),
                  onKeyDown: (e) => {
                    if (e.key === 'Enter') void choose(draft)
                  },
                  style: {
                    flex: 1,
                    minWidth: 0,
                    padding: '7px 10px',
                    borderRadius: 8,
                    border: '1px solid ' + C.border,
                    background: 'transparent',
                    color: 'inherit',
                    fontSize: 12,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  },
                }),
                React.createElement('button', { onClick: () => void choose(draft), disabled: picking, style: btn() }, t('manualOk')),
              )
            : null,
        ),
      )
    }

    /**
     * 作者偏好档案面板。这里的契约是：
     * **档案只放能复用的写作规律**（写稿时读它就够），原文退到折叠的「证据摘录」。
     * 规律由「提炼」产生：原文只进一次便宜的辅助调用，产出条目由作者勾选采纳。
     */
    function ProfileView(props) {
      const {
        t,
        state,
        dir,
        busy,
        distill,
        distilling,
        onDistill,
        onAdopt,
        onEvidenceDoc,
        onEvidence,
        onSave,
        onJump,
        onPickDir,
      } = props
      const [editing, setEditing] = useState(false)
      const [draft, setDraft] = useState('')
      const [saving, setSaving] = useState(false)
      const [copied, setCopied] = useState(false)
      const [skipped, setSkipped] = useState({}) // 审阅时取消勾选的条目标号
      const [showEvidence, setShowEvidence] = useState(false)
      const [evidenceText, setEvidenceText] = useState('')
      const [evidenceBusy, setEvidenceBusy] = useState(false)
      const [elapsed, setElapsed] = useState(0)

      const profile = state !== null && typeof state.profile === 'string' ? state.profile : ''
      const profilePath =
        state !== null && typeof state.profilePath === 'string' && state.profilePath !== ''
          ? state.profilePath
          : dir === ''
            ? ''
            : dir.replace(/\/+$/, '') + '/.dsh-novel-craft/作者偏好档案.md'
      const updatedAt = state !== null && typeof state.profileUpdatedAt === 'string' ? state.profileUpdatedAt : ''
      const evidencePath =
        state !== null && typeof state.evidencePath === 'string' && state.evidencePath !== ''
          ? state.evidencePath
          : dir === ''
            ? ''
            : dir.replace(/\/+$/, '') + '/.dsh-novel-craft/证据摘录.md'
      const evidenceCount = state !== null && typeof state.evidenceCount === 'number' ? state.evidenceCount : 0
      const evidenceBytes = state !== null && typeof state.evidenceBytes === 'number' ? state.evidenceBytes : 0
      const distillRoute = state !== null && typeof state.distillRoute === 'string' ? state.distillRoute : ''
      const distillReady = state !== null && state.distillReady === true
      // 宿主半区还是旧版（没有 stats/evidence/pending 这些字段）：别显示错的数字，
      // 也别给一个按不动的提炼按钮，直接说清"重启一次就有了"。
      const hostReady = state !== null && state.stats !== null && typeof state.stats === 'object'
      const items = distill !== null && distill !== undefined && Array.isArray(distill.items) ? distill.items : []
      const candidates = state !== null && Array.isArray(state.candidates) ? state.candidates : []
      const marks = state !== null && state.marks !== null && typeof state.marks === 'object' ? state.marks : {}

      // 统计：新版宿主直接给；旧版宿主就用本地 marks 现算，至少数字是对的
      const localStats = (() => {
        let good = 0
        let bad = 0
        const files = new Set()
        for (const [file, entry] of Object.entries(marks)) {
          if (entry === null || typeof entry !== 'object') continue
          let touched = false
          for (const value of Object.values(entry)) {
            if (value === 'good') {
              good += 1
              touched = true
            } else if (value === 'bad') {
              bad += 1
              touched = true
            }
          }
          if (touched) files.add(file)
        }
        return { total: good + bad, good, bad, files: files.size, pending: 0, lastDistill: '' }
      })()
      const stats = hostReady ? state.stats : localStats
      const pending = typeof stats.pending === 'number' ? stats.pending : 0

      // 台面上有没有"规律"：把自动块和标题、说明行剔掉之后还剩不剩正文。
      // 只要作者写过东西就一定渲染，绝不因为格式判断把人的内容藏起来。
      const begin = profile.indexOf(AUTO_BEGIN)
      const end = profile.indexOf(AUTO_END)
      const rulesArea = begin !== -1 && end > begin ? profile.slice(0, begin) + profile.slice(end + AUTO_END.length) : profile
      const hasRules = rulesArea
        .split('\n')
        .map((line) => line.trim())
        .some((line) => line !== '' && !line.startsWith('#') && !line.startsWith('>'))

      // 标注来源：每篇各有多少好/坏，能点回「抽卡」定位到那一篇
      const sources = []
      for (const file of Object.keys(marks)) {
        const entry = marks[file] !== null && typeof marks[file] === 'object' ? marks[file] : {}
        let good = 0
        let bad = 0
        for (const value of Object.values(entry)) {
          if (value === 'good') good += 1
          else if (value === 'bad') bad += 1
        }
        if (good + bad === 0) continue
        sources.push({ file, good, bad })
      }
      sources.sort((a, b) => b.good + b.bad - (a.good + a.bad))

      const chip = (key, text, tone) =>
        React.createElement(
          'span',
          {
            key,
            style: {
              fontSize: 11.5,
              padding: '2px 8px',
              borderRadius: 99,
              border: '1px solid ' + (tone === undefined ? C.border : tone),
              color: tone === undefined ? C.sub : tone,
              whiteSpace: 'nowrap',
            },
          },
          text,
        )

      // 提炼是一次模型调用，通常十几秒：把已用时间显示出来，作者才知道没卡死
      useEffect(() => {
        if (distilling !== true) {
          setElapsed(0)
          return undefined
        }
        const started = Date.now()
        const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000)
        return () => clearInterval(timer)
      }, [distilling])

      const startEdit = () => {
        setDraft(profile)
        setEditing(true)
      }
      const save = async () => {
        setSaving(true)
        const done = await onSave(draft)
        setSaving(false)
        if (done) setEditing(false)
      }
      /** 删掉一条规律：只动那一行，其余原样。作者对规律有最终否决权。 */
      const removeRule = async (ruleText) => {
        const lines = profile.split('\n')
        const at = lines.findIndex((line) => line.trim() === '- ' + ruleText || line.trim() === ruleText)
        if (at === -1) return
        const next = lines.slice(0, at).concat(lines.slice(at + 1)).join('\n')
        await onSave(next)
      }
      const copyPath = async () => {
        try {
          await navigator.clipboard.writeText(profilePath)
          setCopied(true)
        } catch {
          setCopied(false) // 拿不到剪贴板也不影响：路径本身可选中复制
        }
      }
      const toggleEvidence = async () => {
        const next = !showEvidence
        setShowEvidence(next)
        if (next && evidenceText === '') {
          setEvidenceBusy(true)
          const text = await onEvidenceDoc()
          setEvidenceBusy(false)
          setEvidenceText(typeof text === 'string' ? text : '')
        }
      }
      const adopt = async () => {
        if (items.length === 0) return
        const chosen = items.filter((item, i) => skipped[i] !== true)
        if (chosen.length === 0) return
        await onAdopt(chosen, distill !== null && typeof distill.model === 'string' ? distill.model : '')
        setSkipped({})
      }

      // 还没选目录：这里没什么可看的
      if (dir === '') {
        return React.createElement(
          'div',
          { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, paddingTop: 64 } },
          React.createElement('div', { style: { color: C.sub, fontSize: 13 } }, t('pickDirFirst')),
          React.createElement(
            'button',
            { onClick: onPickDir, style: btn({ fontSize: 13, padding: '8px 16px' }) },
            '📁 ' + t('pickDir'),
          ),
        )
      }

      const hostBanner = hostReady
        ? null
        : React.createElement(
            'div',
            {
              style: {
                flexShrink: 0,
                fontSize: 11.5,
                lineHeight: 1.7,
                color: C.danger,
                border: '1px solid ' + C.danger,
                borderRadius: 8,
                padding: '6px 10px',
                marginBottom: 8,
              },
            },
            t('hostOldBanner'),
          )

      const head = React.createElement(
        'div',
        { style: { padding: '2px 0 8px', flexShrink: 0 } },
        React.createElement(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          React.createElement('div', { style: { fontSize: 15, fontWeight: 700 } }, '📋 ' + t('profileTitle')),
          chip('c-marked', stats.total + ' ' + t('markedChip')),
          chip('c-good', '👍 ' + stats.good, C.ok),
          chip('c-bad', '👎 ' + stats.bad, C.danger),
          chip('c-pending', pending + ' ' + t('pendingChip'), pending > 0 ? C.accent : undefined),
          React.createElement('div', { style: { flex: 1 } }),
          editing
            ? React.createElement(
                React.Fragment,
                null,
                React.createElement('button', { onClick: () => setEditing(false), disabled: saving, style: btn({ fontSize: 12 }) }, t('cancel')),
                React.createElement(
                  'button',
                  {
                    onClick: () => void save(),
                    disabled: saving,
                    style: btn({ background: C.accent, borderColor: C.accent, color: '#fff', fontWeight: 600, fontSize: 12 }),
                  },
                  saving ? t('saving') : t('save'),
                ),
              )
            : React.createElement(
                React.Fragment,
                null,
                React.createElement('button', { onClick: () => void copyPath(), style: btn({ fontSize: 12 }) }, copied ? '✓ ' + t('copied') : t('copyPath')),
                React.createElement('button', { onClick: startEdit, style: btn({ fontSize: 12 }) }, t('edit')),
              ),
        ),
        React.createElement(
          'div',
          {
            style: {
              marginTop: 6,
              fontSize: 11,
              color: C.sub,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              wordBreak: 'break-all',
              userSelect: 'text',
            },
          },
          '📄 ' + profilePath + (updatedAt === '' ? '' : '  ·  ' + t('updatedAt') + ' ' + updatedAt.slice(0, 19).replace('T', ' ')),
        ),
        React.createElement(
          'div',
          { style: { marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
          React.createElement('span', { style: { fontSize: 11, color: C.sub } }, t('fromFiles')),
          ...sources.map((row) =>
            React.createElement(
              'button',
              {
                key: 'src-' + row.file,
                onClick: () => onJump(row.file),
                title: t('jumpToSource'),
                style: btn({ fontSize: 11, padding: '1px 8px' }),
              },
              baseNameOf(row.file) + ' 👍' + row.good + ' 👎' + row.bad,
            ),
          ),
        ),
      )

      /** 提炼条：一个按钮 + 会用到哪条模型路由 + 证据摘录入口。 */
      const distillBar = React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            padding: '8px 10px',
            margin: '6px 0',
            borderRadius: 10,
            border: '1px solid ' + C.border,
            background: 'rgba(127,127,127,0.05)',
            flexShrink: 0,
          },
        },
        React.createElement(
          'button',
          {
            onClick: onDistill,
            disabled: busy || distilling || pending === 0,
            style: btn({
              background: pending === 0 ? 'transparent' : C.accent,
              borderColor: pending === 0 ? C.border : C.accent,
              color: pending === 0 ? C.sub : '#fff',
              fontWeight: 600,
              fontSize: 12.5,
              padding: '6px 12px',
              opacity: busy || distilling ? 0.6 : 1,
            }),
          },
          distilling
            ? '⚗️ ' + t('distilling') + (elapsed > 0 ? ' ' + elapsed + 's' : '')
            : '⚗️ ' + t('distill') + (pending > 0 ? '（' + pending + '）' : ''),
        ),
        pending === 0 && items.length === 0
          ? React.createElement('span', { style: { fontSize: 11.5, color: C.sub } }, t('noPending'))
          : null,
        distillRoute === '' || !distillReady
          ? React.createElement('span', { style: { fontSize: 11.5, color: C.danger } }, t('distillNoRoute'))
          : React.createElement('span', { style: { fontSize: 11.5, color: C.sub } }, t('distillWith') + ' ' + distillRoute),
        React.createElement('div', { style: { flex: 1 } }),
        React.createElement(
          'button',
          { onClick: () => void onEvidence(), disabled: busy, style: btn({ fontSize: 11.5, padding: '3px 9px' }) },
          t('evidenceRefresh'),
        ),
      )

      /** 提炼结果审阅：勾上的才会进档案。 */
      const review =
        items.length === 0
          ? null
          : React.createElement(
              'div',
              {
                style: {
                  flexShrink: 0,
                  border: '1px solid ' + C.accent,
                  borderRadius: 10,
                  padding: '10px 12px',
                  margin: '2px 0 10px',
                  background: 'rgba(10,132,255,0.05)',
                },
              },
              React.createElement(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
                React.createElement('div', { style: { fontSize: 12.5, fontWeight: 700 } }, t('distillReview')),
                React.createElement('div', { style: { flex: 1 } }),
                typeof distill.model === 'string' && distill.model !== ''
                  ? React.createElement('span', { style: { fontSize: 11, color: C.sub } }, distill.model)
                  : null,
              ),
              distill.capped === true
                ? React.createElement(
                    'div',
                    { style: { fontSize: 11, color: C.sub, marginBottom: 6 } },
                    t('cappedHint') + ' ' + String(distill.used) + ' / ' + String(distill.pending) + ' ' + t('evidenceUnit'),
                  )
                : null,
              distill.finish === 'max-tokens'
                ? React.createElement('div', { style: { fontSize: 11, color: C.danger, marginBottom: 6 } }, t('truncatedHint'))
                : null,
              React.createElement(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflow: 'auto' } },
                ...items.map((item, i) =>
                  React.createElement(
                    'label',
                    {
                      key: 'cand-' + i,
                      style: {
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                        fontSize: 13,
                        lineHeight: 1.7,
                        cursor: 'pointer',
                        opacity: skipped[i] === true ? 0.45 : 1,
                      },
                    },
                    React.createElement('input', {
                      type: 'checkbox',
                      checked: skipped[i] !== true,
                      onChange: () => setSkipped((prev) => ({ ...prev, [i]: !(prev[i] === true) })),
                      style: { marginTop: 4, flexShrink: 0 },
                    }),
                    React.createElement(
                      'span',
                      { style: { color: item.kind === 'bad' ? C.danger : C.ok, fontWeight: 700, flexShrink: 0 } },
                      item.kind === 'bad' ? '−' : '+',
                    ),
                    React.createElement('span', { style: { flex: 1, minWidth: 0 } }, item.text),
                  ),
                ),
              ),
              React.createElement(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 } },
                React.createElement(
                  'button',
                  {
                    onClick: () => void adopt(),
                    disabled: busy,
                    style: btn({ background: C.accent, borderColor: C.accent, color: '#fff', fontWeight: 600, fontSize: 12 }),
                  },
                  t('adoptSelected'),
                ),
                React.createElement(
                  'button',
                  { onClick: () => setSkipped({}), style: btn({ fontSize: 11.5 }) },
                  t('selectAll'),
                ),
                React.createElement(
                  'button',
                  {
                    onClick: () => {
                      const next = {}
                      items.forEach((item, i) => {
                        next[i] = true
                      })
                      setSkipped(next)
                    },
                    style: btn({ fontSize: 11.5 }),
                  },
                  t('selectNone'),
                ),
                React.createElement('div', { style: { flex: 1 } }),
                React.createElement('button', { onClick: () => onDistill('discard'), style: btn({ fontSize: 11.5 }) }, t('discardCandidates')),
              ),
            )

      /** 原文证据：默认折叠，展开才读。 */
      const evidenceBlock = React.createElement(
        'div',
        { style: { flexShrink: 0, marginTop: 10, borderTop: '1px solid ' + C.border, paddingTop: 8 } },
        React.createElement(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          React.createElement(
            'button',
            { onClick: () => void toggleEvidence(), style: btn({ fontSize: 11.5, padding: '3px 9px' }) },
            '📄 ' + t('evidenceSection') + '（' + evidenceCount + ' ' + t('evidenceUnit') + ' · ' + formatBytes(evidenceBytes) + '）',
          ),
          React.createElement('span', { style: { fontSize: 11, color: C.danger } }, t('evidenceWarn')),
          React.createElement('div', { style: { flex: 1 } }),
          React.createElement(
            'span',
            { style: { fontSize: 10.5, color: C.sub, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } },
            evidencePath,
          ),
        ),
        showEvidence
          ? React.createElement(
              'div',
              {
                style: {
                  marginTop: 8,
                  maxHeight: 300,
                  overflow: 'auto',
                  border: '1px solid ' + C.border,
                  borderRadius: 10,
                  padding: '8px 12px',
                  background: C.card,
                },
              },
              evidenceBusy
                ? React.createElement('div', { style: { fontSize: 12, color: C.sub } }, t('loading'))
                : evidenceText === ''
                  ? React.createElement('div', { style: { fontSize: 12, color: C.sub } }, t('emptyDoc'))
                  : React.createElement(React.Fragment, null, ...renderProfileDoc(evidenceText, t)),
            )
          : null,
      )

      const bodyStyle = { flex: 1, minHeight: 0, overflow: 'auto', padding: '2px 2px 12px' }

      if (editing) {
        return React.createElement(
          'div',
          { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
          head,
          React.createElement('div', { style: { fontSize: 11.5, color: C.sub, marginBottom: 6 } }, t('editHint')),
          React.createElement('textarea', {
            value: draft,
            onChange: (e) => setDraft(e.target.value),
            spellCheck: false,
            style: {
              flex: 1,
              minHeight: 240,
              width: '100%',
              boxSizing: 'border-box',
              resize: 'vertical',
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid ' + C.border,
              background: C.card,
              color: 'inherit',
              fontSize: 12.5,
              lineHeight: 1.7,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            },
          }),
        )
      }

      return React.createElement(
        'div',
        { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
        head,
        hostBanner,
        hostReady ? distillBar : null,
        hostReady ? review : null,
        React.createElement(
          'div',
          { style: bodyStyle },
          !hasRules
            ? React.createElement(
                'div',
                { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, paddingTop: 32 } },
                React.createElement('div', { style: { color: C.sub, fontSize: 14 } }, t('rulesEmpty')),
                React.createElement(
                  'div',
                  { style: { color: C.sub, fontSize: 12, textAlign: 'center', maxWidth: 460, lineHeight: 1.8 } },
                  stats.total === 0 ? t('noMarksYet') : t('rulesOnlyHint'),
                ),
              )
            : React.createElement(
                React.Fragment,
                null,
                React.createElement('div', { style: { fontSize: 11.5, color: C.sub, marginBottom: 6 } }, t('rulesOnlyHint')),
                ...renderProfileDoc(profile, t, { onRemoveRule: (rule) => void removeRule(rule) }),
              ),
        ),
        hostReady ? evidenceBlock : null,
      )
    }

    exports.name = 'dsh-novel-craft'
    exports.inject = ['slots', 'locale', 'settingsScope']
    // 纯逻辑出口：浏览器端模块没法直接单测，这几个函数靠它跑断言
    exports.__internals = {
      shortPath,
      baseNameOf,
      dirsFromDiscover,
      readRecents,
      rememberDir,
      renderProfileDoc,
      candidateLabel,
      candidateLabels,
      charCount,
      formatChars,
      keyToAction,
      isTypingTarget,
      CANDIDATE_HINT,
      RECENT_KEY,
    }

    exports.apply = function (ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-novel-craft: i18n')
      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          { name: 'sidebar.footer.action', id: 'novel-craft', order: 9, label: () => ctx.locale.bind(NS)('entry') },
          (props) =>
            React.createElement(CraftEntry, {
              ...props,
              t: ctx.locale.bind(NS),
            }),
        ),
      )
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          { name: 'shell.overlay', id: 'nv-craft', order: 25 },
          (props) =>
            React.createElement(CraftWorkbench, {
              ...props,
              t: ctx.locale.bind(NS),
              scope: ctx.settingsScope.bind({ namespace: NS }),
              // 目录浏览走平台自带服务：取的时候现查，服务缺席也不拖垮工作台
              getWs: () => ctx.get('workspaces'),
            }),
        ),
      )
    }

    return module.exports
  },
})
