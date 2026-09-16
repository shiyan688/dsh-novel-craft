/**
 * dsh-novel-craft — client half（浏览器半区 = 抽卡工作台）
 *
 * 形态（用的是 dsh 自己的公开插槽与客户端服务，未复制任何第三方插件代码）：
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
      tabChapters: '章节',
      tabPlot: '情节',
      tabStage: '全书',
      wProject: '作品',
      wAutoProject: '自动识别',
      wSetProject: '指定作品根',
      wNoProject: '还没认出作品目录',
      wNoProjectHint: '先在顶部选候选目录，或者把作品根直接指出来：作品根＝放着正文、设定、人物、剧情的那一层目录。',
      wBoardTitle: '章节看板',
      wBoardHint: '这本书写到哪儿了、哪一章还有没结的事，一眼看完。点章节标题进正文。',
      wChapters: '章',
      wWords: '字',
      wOpenNotes: '未处理批注',
      wStatusNone: '未写',
      wStatusDraft: '只有候选稿',
      wStatusWritten: '有正文',
      wColChapter: '章',
      wColTitle: '标题',
      wColWords: '字数',
      wColState: '状态',
      wColRounds: '轮次',
      wColMarks: '标注',
      wColNotes: '批注',
      wColPack: '写作包',
      wColScore: '评分',
      wColTension: '张力',
      wColIssues: '体检',
      wPacks: '写作包',
      wMarksShort: '标',
      wNone: '—',
      wRefresh: '刷新',
      wBack: '← 回到看板',
      wSetup: '本章设定',
      wSetupHint: '这一章要干什么：目标、必须发生、禁止发生。写作包会把它放在最前面。',
      wSetupSave: '保存本章设定',
      wSetupSaved: '已保存',
      wPack: '写作包',
      wPackBuild: '生成写作包',
      wPackBuildHint: '把这一章要用的东西组装成一个文件：写稿会话只读它。',
      wPackBudget: '上下文预算',
      wPackTotal: '整包',
      wPackWarnings: '提醒',
      wPackSection: '分节',
      wPackChars: '字数',
      wPackSource: '来源',
      wPackCopy: '复制全文',
      wPackCopied: '已复制到剪贴板',
      wPackPath: '文件位置',
      wNotes: '批注',
      wNotesHint: '读到哪儿不对就点那一段，按 A 留一句。批注是给你自己看的改稿清单，不会进写稿上下文。',
      wNotesEmpty: '这一章还没有批注。点一段正文，按 A 就能留。',
      wNoteAdd: '留批注',
      wNotePlaceholder: '哪里不对？（可只选标签）',
      wNoteSave: '保存批注',
      wNoteCancel: '取消',
      wNoteResolve: '改好了',
      wNoteReopen: '重新打开',
      wNoteDelete: '删除',
      wNoteJump: '跳到这一段',
      wNoteOnSeg: '第 {n} 段',
      wNoteOpen: '待处理',
      wNoteResolved: '已处理',
      wNoteIgnored: '已忽略',
      wNotesOpenCount: '待处理 {n} 条',
      wRevise: '按批注微调',
      wReviseHint: '只改被批注的段落，其余段落逐字不动——核对通过才允许写回。',
      wReviseRun: '生成微调稿',
      wReviseRunning: '模型正在改…',
      wReviseAdopt: '采纳并写回正文',
      wReviseAdopting: '正在写回…',
      wReviseAdopted: '已写回正文，原稿已备份（批注标为已处理）',
      wReviseEmpty: '模型没有改动任何段落',
      wReviseProblems: '核对发现的问题',
      wReviseModel: '模型',
      wReviseUsed: '这次带了 {n} 条批注',
      wReviseCapped: '还有 {n} 条没带上（一次最多 20 条）',
      wPlot: '情节体检',
      wPlotHint: '章节之间的节奏、主线偏移、伏笔欠账。全部是本地统计，正文不进模型上下文。',
      wPlotTension: '张力曲线',
      wPlotScore: '读者评分',
      wPlotEstimated: '虚线＝按正文估的；实线＝你手工标的',
      wPlotManual: '手工标张力',
      wPlotFindings: '问题清单',
      wPlotNone: '没有发现问题',
      wPlotRun: '重跑体检',
      wPlotRunning: '正在体检…',
      wPlotNever: '还没体检过：点「重跑体检」算一遍',
      wPlotOutlineMissing: '还没写 大纲.md：有了大纲才能查"这一章是不是跑偏了"',
      wPlotDebt: '未兑现伏笔',
      wPlotDebtNone: '没有欠着的伏笔',
      wPlotDebtRow: '第 {a} 章埋下 · 已欠 {n} 章',
      wStage: '全书阶段',
      wStageHint: '立项 → 设定 → 人物 → 大纲 → 逐章正文 → 修订 → 完本。产物缺了就提示，作者可以显式放行。',
      wStageCurrent: '当前阶段',
      wStageGate: '门禁',
      wStageArtifacts: '需要的产物',
      wStageMissing: '缺的上游输入',
      wStageGenerate: '起草本阶段产物',
      wStageGenerating: '模型正在起草…',
      wStageSave: '写入作品目录',
      wStageSaved: '已写入',
      wStageDraft: '起草结果（改完再写入）',
      wStageBlocked: '还不能进入',
      wStageOk: '这一步齐了',
      wStageNext: '设为当前阶段',
      wStageTarget: '将写入',
      wStageNoModel: '这一步要模型：确认模型路由已配置',
      wIssues: '问题',
      wError: '出错',
      wBusy: '读取中…',
      wRuleEvidence: '证据',
      wRuleEvidenceTitle: '这条规律是从哪几段来的',
      wRuleEvidenceNone: '这条规律还没有来源记录（提炼时模型没标编号，本地也没匹配上）。',
      wRuleEvidenceAuto: '推测匹配',
      wRuleEvidenceAutoHint: '模型没有按要求标编号，这是按词面相似度猜的——只作参考',
      wRuleEvidenceModel: '模型标注的来源',
      wRuleEvidenceCount: '{n} 段',
      wRuleEvidenceHint: '点规律后面的「证据」，看它当时是从哪几段原文里看出来的。原文只在这里显示，不进写稿上下文。',
      wRuleEvidencePath: '来源文件',
      wRetry: '重试',
      wStageBackfill: '这本书是在没有立项/设定/大纲的情况下写起来的？没关系：这些产物现在补也来得及，补完门禁就绿了。老书补票不是返工，是给后面的章节留一份可查的依据。',
      wStageBlockedHint: '有几步是红的：它们是"下一本书别再跳过"的检查，不是拦着你改这一本。',
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
      tabChapters: 'Chapters',
      tabPlot: 'Plot',
      tabStage: 'Book',
      wProject: 'Work',
      wAutoProject: 'auto-detected',
      wSetProject: 'Set book root',
      wNoProject: 'No book directory found yet',
      wNoProjectHint: 'Pick a draft folder at the top, or point at the book root — the folder that holds your chapters, setting, cast and summaries.',
      wBoardTitle: 'Chapter board',
      wBoardHint: 'Where the book stands and what is still open, at a glance. Click a chapter title to open the text.',
      wChapters: 'chapters',
      wWords: 'chars',
      wOpenNotes: 'open notes',
      wStatusNone: 'not started',
      wStatusDraft: 'drafts only',
      wStatusWritten: 'has text',
      wColChapter: 'Ch',
      wColTitle: 'Title',
      wColWords: 'Chars',
      wColState: 'Status',
      wColRounds: 'Rounds',
      wColMarks: 'Marks',
      wColNotes: 'Notes',
      wColPack: 'Pack',
      wColScore: 'Score',
      wColTension: 'Tension',
      wColIssues: 'Checks',
      wPacks: 'packs',
      wMarksShort: 'marked',
      wNone: '—',
      wRefresh: 'Refresh',
      wBack: '← Back to board',
      wSetup: 'Chapter brief',
      wSetupHint: 'What this chapter must do: goals, must-happen, must-not-happen. The pack puts it first.',
      wSetupSave: 'Save brief',
      wSetupSaved: 'Saved',
      wPack: 'Writing pack',
      wPackBuild: 'Build writing pack',
      wPackBuildHint: 'Assemble everything this chapter needs into one file — the writing session reads only that.',
      wPackBudget: 'Context budget',
      wPackTotal: 'whole pack',
      wPackWarnings: 'Warnings',
      wPackSection: 'Section',
      wPackChars: 'Chars',
      wPackSource: 'Source',
      wPackCopy: 'Copy all',
      wPackCopied: 'Copied',
      wPackPath: 'File',
      wNotes: 'Notes',
      wNotesHint: 'When a passage is wrong, click it and press A. Notes are your own revision list — they never enter the writing context.',
      wNotesEmpty: 'No notes for this chapter yet. Click a paragraph and press A.',
      wNoteAdd: 'Add note',
      wNotePlaceholder: 'What is wrong? (a label alone is fine)',
      wNoteSave: 'Save note',
      wNoteCancel: 'Cancel',
      wNoteResolve: 'Fixed',
      wNoteReopen: 'Reopen',
      wNoteDelete: 'Delete',
      wNoteJump: 'Jump to paragraph',
      wNoteOnSeg: '¶{n}',
      wNoteOpen: 'open',
      wNoteResolved: 'done',
      wNoteIgnored: 'ignored',
      wNotesOpenCount: '{n} open',
      wRevise: 'Revise by notes',
      wReviseHint: 'Only annotated paragraphs are rewritten; every other paragraph stays byte-identical — verified before any write-back.',
      wReviseRun: 'Generate revision',
      wReviseRunning: 'Model is rewriting…',
      wReviseAdopt: 'Accept and write back',
      wReviseAdopting: 'Writing back…',
      wReviseAdopted: 'Written back; the original was backed up (notes marked done)',
      wReviseEmpty: 'The model changed nothing',
      wReviseProblems: 'Verification problems',
      wReviseModel: 'Model',
      wReviseUsed: '{n} notes sent',
      wReviseCapped: '{n} more not sent (20 max per run)',
      wPlot: 'Plot checks',
      wPlotHint: 'Pacing across chapters, drift from your outline, unpaid setups. All local statistics — raw text never enters a model context.',
      wPlotTension: 'Tension curve',
      wPlotScore: 'Reader score',
      wPlotEstimated: 'dashed = estimated from the text; solid = your own rating',
      wPlotManual: 'Rate tension',
      wPlotFindings: 'Findings',
      wPlotNone: 'No problems found',
      wPlotRun: 'Run checks',
      wPlotRunning: 'Running…',
      wPlotNever: 'Not checked yet: hit “Run checks”',
      wPlotOutlineMissing: 'No 大纲.md yet: an outline is what makes “drifted off plan” detectable',
      wPlotDebt: 'Unpaid setups',
      wPlotDebtNone: 'Nothing is owed',
      wPlotDebtRow: 'planted in ch.{a} · {n} chapters overdue',
      wStage: 'Book stages',
      wStageHint: 'Idea → Setting → Cast → Outline → Chapters → Revise → Finish. Missing artifacts are reported; you can still pass on explicitly.',
      wStageCurrent: 'Current stage',
      wStageGate: 'Gate',
      wStageArtifacts: 'Required artifacts',
      wStageMissing: 'Missing inputs',
      wStageGenerate: 'Draft this stage',
      wStageGenerating: 'Model is drafting…',
      wStageSave: 'Write into the book',
      wStageSaved: 'Written',
      wStageDraft: 'Draft (edit before writing)',
      wStageBlocked: 'Blocked',
      wStageOk: 'This step is complete',
      wStageNext: 'Set as current stage',
      wStageTarget: 'Will write to',
      wStageNoModel: 'This step needs a model: make sure a route is configured',
      wIssues: 'issues',
      wError: 'Error',
      wBusy: 'Loading…',
      wRuleEvidence: 'Evidence',
      wRuleEvidenceTitle: 'Which passages produced this rule',
      wRuleEvidenceNone: 'No source recorded for this rule (the model did not tag indexes, and no local match was found).',
      wRuleEvidenceAuto: 'guessed',
      wRuleEvidenceAutoHint: 'The model did not tag source indexes; this is a word-overlap guess — treat it as a hint only',
      wRuleEvidenceModel: 'Tagged by the model',
      wRuleEvidenceCount: '{n} passages',
      wRuleEvidenceHint: 'Click “Evidence” after a rule to see which passages it came from. The raw text shows up only here — it never enters the writing context.',
      wRuleEvidencePath: 'Source file',
      wRetry: 'Retry',
      wStageBackfill: 'Started this book without a brief, world bible or outline? That is fine — writing them now still counts, and the gates go green. Backfilling is not rework; it gives the later chapters something to check against.',
      wStageBlockedHint: 'Some steps are red: those checks are about not skipping them on the next book, not about blocking this one.',
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
          // 规律 → 证据：这条规律当时是从哪几段原文里看出来的（模型标的，或是本地推测）
          const ruleText = item[1].trim()
          const prov =
            options !== undefined && options !== null && options.evidence !== undefined && options.evidence !== null
              ? options.evidence[ruleText]
              : undefined
          const expanded = options !== undefined && options !== null && options.expandedRule === ruleText
          out.push(
            React.createElement(
              'div',
              { key, style: { margin: '4px 0' } },
              React.createElement(
                'div',
                { style: { display: 'flex', gap: 8, fontSize: 13.5, lineHeight: 1.8, alignItems: 'flex-start' } },
                React.createElement('span', { style: { color: C.sub, flexShrink: 0 } }, '•'),
                React.createElement('span', { style: { flex: 1, minWidth: 0 } }, inlineEls(item[1], key)),
                prov !== undefined && typeof options.onEvidenceRule === 'function'
                  ? React.createElement(
                      'button',
                      {
                        onClick: () => options.onEvidenceRule(expanded ? '' : ruleText),
                        title: t('wRuleEvidenceTitle'),
                        style: {
                          flexShrink: 0,
                          border: '1px solid ' + (prov.by === 'model' ? C.border : TONE.warn + '55'),
                          background: 'transparent',
                          color: prov.by === 'model' ? C.sub : TONE.warn,
                          cursor: 'pointer',
                          fontSize: 11,
                          padding: '0 6px',
                          borderRadius: 999,
                          lineHeight: '17px',
                        },
                      },
                      '🔍 ' + t('wRuleEvidence') + (prov.marks.length === 0 ? '' : ' ' + String(prov.marks.length)),
                    )
                  : null,
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
              expanded && prov !== undefined
                ? React.createElement(
                    'div',
                    {
                      style: {
                        margin: '2px 0 6px 16px',
                        padding: '7px 9px',
                        border: '1px solid ' + C.border,
                        borderLeft: '3px solid ' + (prov.by === 'model' ? C.accent : TONE.warn),
                        borderRadius: 8,
                        background: C.card,
                      },
                    },
                    React.createElement(
                      'div',
                      { style: { fontSize: 11.5, color: C.sub, marginBottom: 4 } },
                      prov.by === 'model'
                        ? t('wRuleEvidenceModel')
                        : t('wRuleEvidenceAuto') + '（' + String(prov.score === null ? '' : prov.score) + '）· ' + t('wRuleEvidenceAutoHint'),
                    ),
                    prov.marks.length === 0
                      ? React.createElement('div', { style: { fontSize: 12, color: C.sub } }, t('wRuleEvidenceNone'))
                      : React.createElement(
                          'div',
                          null,
                          ...prov.marks.map((m, mi) =>
                            React.createElement(
                              'div',
                              { key: 'm' + String(mi), style: { fontSize: 12.5, lineHeight: 1.8, marginBottom: 4 } },
                              React.createElement(
                                'span',
                                { style: { color: m.mark === 'bad' ? TONE.error : TONE.ok, marginRight: 4 } },
                                (m.mark === 'bad' ? '👎 ' : '👍 ') + String(m.file) + ' · 第' + String(m.index + 1) + '段',
                              ),
                              React.createElement('div', { style: { color: C.sub } }, '「' + String(m.text) + '」'),
                            ),
                          ),
                        ),
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
      // 0.2：作品看板 / 当前打开的章节。章节、情节、全书三个面板共用一份看板数据。
      const [ws, setWs] = useState(null)
      const [wsBusy, setWsBusy] = useState(false)
      const [wsError, setWsError] = useState('')
      const [wsNonce, setWsNonce] = useState(0)
      const [chapter, setChapter] = useState(null)
      const [checkBusy, setCheckBusy] = useState(false)

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
      // 换了目录就等于换了一本书：旧看板立刻作废，免得显示上一本的章节
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
          setWs(null)
          setChapter(null)
          setWsNonce((n) => n + 1)
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

      /** 看板刷新：改完批注、生成写作包、体检之后都调它。 */
      const reloadWorkspace = useCallback(() => setWsNonce((n) => n + 1), [])

      // 作品看板按需拉取：只在切到章节/情节/全书时才打这一个接口，
      // 拉一次三个面板共用；正文与全书体检都不在首屏成本里。
      useEffect(() => {
        if (!open) return undefined
        if (tab === 'cards' || tab === 'profile') return undefined
        let alive = true
        setWsBusy(true)
        // 情节页要的是体检结论：首访时顺便算一遍（本地统计，读的是各章正文，不进模型上下文）
        postJson('workspace', { deep: tab === 'plot' })
          .then((data) => {
            if (!alive) return
            setWs(data)
            setWsError('')
          })
          .catch((e) => {
            if (alive) setWsError(String(e && e.message ? e.message : e))
          })
          .finally(() => {
            if (alive) setWsBusy(false)
          })
        return () => {
          alive = false
        }
      }, [open, tab, wsNonce])

      /** 体检是显式动作：点一次算一遍，结果由宿主半区缓存十分钟。 */
      const runChecks = async () => {
        setCheckBusy(true)
        try {
          await postJson('check', { refresh: true })
          setWsNonce((n) => n + 1)
        } catch (e) {
          setWsError(String(e && e.message ? e.message : e))
        } finally {
          setCheckBusy(false)
        }
      }

      const setTension = async (chapterNo, value) => {
        try {
          await postJson('tension', { chapter: chapterNo, value })
          setWsNonce((n) => n + 1)
        } catch (e) {
          setWsError(String(e && e.message ? e.message : e))
        }
      }

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
            tabBtn('chapters', '🗂 ' + t('tabChapters')),
            tabBtn('plot', '📈 ' + t('tabPlot')),
            tabBtn('stage', '🧭 ' + t('tabStage')),
            tabBtn('profile', '📋 ' + t('tabProfile') + (markedCount > 0 ? ' · ' + markedCount : '')),
          ),
          // 章节 / 情节 / 全书：都靠同一份看板数据；没认出作品根时给一条明确的出路
          tab === 'cards' || tab === 'profile'
            ? null
            : wsError !== ''
              ? React.createElement(
                  'div',
                  { style: { flex: 1, overflow: 'auto', padding: '16px 18px' } },
                  React.createElement('div', { style: { color: TONE.error, fontSize: 13, marginBottom: 8 } }, t('wError') + '：' + wsError),
                  React.createElement('button', { onClick: reloadWorkspace, style: btn({ fontSize: 12.5 }) }, t('wRetry')),
                  React.createElement('div', { style: { marginTop: 10 } }, React.createElement('button', { onClick: () => setPicker(true), style: btn({ fontSize: 12.5 }) }, '📁 ' + t('wSetProject'))),
                )
              : tab === 'chapters'
                ? chapter === null
                  ? React.createElement(ChapterBoard, {
                      t,
                      ws,
                      busy: wsBusy,
                      onOpen: (n) => setChapter(n),
                      onRefresh: reloadWorkspace,
                      onTension: (n, v) => void setTension(n, v),
                      onPickDir: () => setPicker(true),
                    })
                  : React.createElement(ChapterDetail, {
                      t,
                      chapter,
                      onBack: () => setChapter(null),
                      onChanged: reloadWorkspace,
                    })
                : tab === 'plot'
                  ? React.createElement(PlotView, {
                      t,
                      ws,
                      busy: checkBusy,
                      onRunChecks: () => void runChecks(),
                      onOpenChapter: (n) => {
                        setChapter(n)
                        setTab('chapters')
                      },
                    })
                  : React.createElement(StageView, { t, ws, onReload: reloadWorkspace }),
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
    // ── 0.2：章节 / 情节 / 全书三个面板的公用零件 ─────────────────────────
    //
    // 这三个面板共用同一份「作品看板」数据（宿主半区一次读好），
    // 所以这里只放纯展示零件；取数、缓存、刷新都归 CraftWorkbench 管。

    /** 带占位符的词条：tf(t, 'wNoteOnSeg', { n: 3 })。 */
    const tf = (t, key, vars) => {
      let text = String(t(key))
      for (const [name, value] of Object.entries(vars === undefined ? {} : vars)) {
        text = text.split('{' + name + '}').join(String(value))
      }
      return text
    }

    /** 工作台与宿主半区之间的两个小封装：出错一律抛成人话。 */
    const getJson = async (path) => {
      const r = await fetch(API + path, { headers: { accept: 'application/json' } })
      const data = await r.json().catch(() => null)
      if (!r.ok || data === null || data.error !== undefined) {
        throw new Error(data !== null && data.error !== undefined ? String(data.error) : 'HTTP ' + String(r.status))
      }
      return data
    }
    const postJson = async (path, body) => {
      const r = await fetch(API + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body === undefined ? {} : body),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok || data === null || data.error !== undefined) {
        throw new Error(data !== null && data.error !== undefined ? String(data.error) : 'HTTP ' + String(r.status))
      }
      return data
    }

    const TONE = {
      error: '#d9534f',
      warn: '#d99000',
      info: '#5b8def',
      ok: '#2e9e6b',
    }
    const LEVEL_ORDER = { error: 0, warn: 1, info: 2 }
    const NOTE_TONE = {
      'ai-tone': '#d9534f',
      wordy: '#d99000',
      emotion: '#c46bd0',
      flat: '#5b8def',
      ooc: '#2e9e6b',
      logic: '#8a6d3b',
      info: '#3aa7a0',
      other: '#8a8f98',
    }
    const noteTone = (type) => (NOTE_TONE[type] === undefined ? NOTE_TONE.other : NOTE_TONE[type])
    const statusText = (t, status) =>
      status === 'written' ? t('wStatusWritten') : status === 'draft' ? t('wStatusDraft') : t('wStatusNone')

    /** 小标签：章节看板里到处都是这种"一眼看状态"的东西。 */
    const Chip = (props) =>
      React.createElement(
        'span',
        {
          title: props.title,
          onClick: props.onClick,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            padding: '1px 7px',
            borderRadius: 999,
            fontSize: 11,
            lineHeight: '17px',
            color: props.tone === undefined ? C.sub : props.tone,
            background: (props.tone === undefined ? C.sub : props.tone) + '18',
            border: '1px solid ' + (props.tone === undefined ? C.border : props.tone + '44'),
            cursor: props.onClick === undefined ? 'default' : 'pointer',
            whiteSpace: 'nowrap',
          },
        },
        props.children,
      )

    const Empty = (props) =>
      React.createElement(
        'div',
        { style: { padding: '22px 4px', color: C.sub, fontSize: 13, lineHeight: 1.8 } },
        props.children,
      )

    const SectionTitle = (props) =>
      React.createElement(
        'div',
        { style: { fontSize: 12.5, fontWeight: 600, color: C.text, margin: '14px 0 6px' } },
        props.children,
      )

    /**
     * 张力曲线：横轴章节、纵轴 1-5。
     * 手工标的画实线圆点，按正文估的画虚线方点——作者一眼能分清哪些数是他自己给的。
     */
    function TensionChart(props) {
      const t = props.t
      const series = Array.isArray(props.series) ? props.series : []
      if (series.length === 0) return React.createElement(Empty, null, t('wPlotNever'))
      const W = 720
      const H = 170
      const padL = 26
      const padR = 12
      const padT = 12
      const padB = 24
      const step = series.length <= 1 ? 0 : (W - padL - padR) / (series.length - 1)
      const x = (i) => padL + i * step
      const y = (v) => padT + (H - padT - padB) * (1 - (Math.max(1, Math.min(5, v)) - 1) / 4)
      const scoreSeries = Array.isArray(props.scores) ? props.scores : []
      const scoreAt = (chapter) => {
        const hit = scoreSeries.find((s) => s.chapter === chapter)
        return hit === undefined || hit.score === null || hit.score === undefined ? null : Number(hit.score)
      }
      const yScore = (v) => padT + (H - padT - padB) * (1 - (Math.max(2, Math.min(5, v)) - 2) / 3)
      const manualPts = []
      const estPts = []
      series.forEach((point, i) => {
        if (point.source === 'manual') manualPts.push(String(x(i)) + ',' + String(y(point.value)))
        else estPts.push(String(x(i)) + ',' + String(y(point.value)))
      })
      const scoreLine = series
        .map((point, i) => {
          const s = scoreAt(point.chapter)
          return s === null ? null : String(x(i)) + ',' + String(yScore(s))
        })
        .filter((v) => v !== null)
      const grid = [1, 2, 3, 4, 5].map((v) =>
        React.createElement('line', {
          key: 'g' + String(v),
          x1: padL,
          x2: W - padR,
          y1: y(v),
          y2: y(v),
          stroke: C.border,
          strokeWidth: v === 3 ? 1 : 0.5,
          strokeDasharray: v === 3 ? '4 4' : undefined,
        }),
      )
      return React.createElement(
        'div',
        { style: { background: C.card, border: '1px solid ' + C.border, borderRadius: 10, padding: 10 } },
        React.createElement(
          'svg',
          { viewBox: '0 0 ' + String(W) + ' ' + String(H), width: '100%', height: 170 },
          grid,
          scoreLine.length > 1
            ? React.createElement('polyline', {
                points: scoreLine.join(' '),
                fill: 'none',
                stroke: TONE.ok,
                strokeWidth: 1.4,
                strokeDasharray: '2 3',
                opacity: 0.9,
              })
            : null,
          estPts.length > 1
            ? React.createElement('polyline', {
                points: estPts.join(' '),
                fill: 'none',
                stroke: C.sub,
                strokeWidth: 1.6,
                strokeDasharray: '5 4',
              })
            : null,
          manualPts.length > 1
            ? React.createElement('polyline', {
                points: manualPts.join(' '),
                fill: 'none',
                stroke: C.accent,
                strokeWidth: 2.2,
              })
            : null,
          ...series.map((point, i) =>
            React.createElement(
              'g',
              { key: 'p' + String(point.chapter), onClick: () => props.onPick(point.chapter) },
              point.source === 'manual'
                ? React.createElement('circle', {
                    cx: x(i),
                    cy: y(point.value),
                    r: 3.6,
                    fill: C.accent,
                    stroke: C.accent,
                    strokeWidth: 1.4,
                    style: { cursor: 'pointer' },
                  })
                : React.createElement('rect', {
                    x: x(i) - 3.2,
                    y: y(point.value) - 3.2,
                    width: 6.4,
                    height: 6.4,
                    fill: C.card,
                    stroke: C.sub,
                    strokeWidth: 1.4,
                    style: { cursor: 'pointer' },
                  }),
              React.createElement(
                'text',
                {
                  x: x(i),
                  y: H - 8,
                  textAnchor: 'middle',
                  fontSize: 10,
                  fill: C.sub,
                },
                String(point.chapter),
              ),
            ),
          ),
        ),
        React.createElement('div', { style: { fontSize: 11, color: C.sub, padding: '2px 4px 0' } }, t('wPlotEstimated')),
      )
    }

    /** 章节看板：一行一章。 */
    function ChapterBoard(props) {
      const t = props.t
      const ws = props.ws
      const chapters = ws !== null && Array.isArray(ws.chapters) ? ws.chapters : []
      const cell = { padding: '7px 8px', fontSize: 12.5, borderBottom: '1px solid ' + C.border, verticalAlign: 'top' }
      const head = (label, extra) =>
        React.createElement(
          'th',
          {
            style: {
              textAlign: 'left',
              padding: '6px 8px',
              fontSize: 11,
              color: C.sub,
              fontWeight: 500,
              borderBottom: '1px solid ' + C.border,
              whiteSpace: 'nowrap',
              ...(extra === undefined ? {} : extra),
            },
          },
          label,
        )
      if (ws === null || ws.found !== true) {
        return React.createElement(
          'div',
          { style: { flex: 1, overflow: 'auto', padding: '16px 18px' } },
          React.createElement('div', { style: { fontWeight: 600, marginBottom: 6 } }, '🗂 ' + t('wNoProject')),
          React.createElement('div', { style: { color: C.sub, fontSize: 13, lineHeight: 1.9 } }, t('wNoProjectHint')),
          React.createElement(
            'div',
            { style: { color: C.sub, fontSize: 12, marginTop: 12 } },
            (ws !== null && ws.candidateDir !== undefined && ws.candidateDir !== '' ? '候选目录：' + ws.candidateDir + '　' : '') +
              (ws !== null && ws.hint !== undefined ? String(ws.hint) : ''),
          ),
        )
      }
      const totals = ws.totals === null || ws.totals === undefined ? {} : ws.totals
      const stages = ws.stages === undefined ? null : ws.stages
      return React.createElement(
        'div',
        { style: { flex: 1, overflow: 'auto', padding: '12px 18px' } },
        React.createElement(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          React.createElement('div', { style: { fontWeight: 700, fontSize: 15 } }, '🗂 ' + t('wBoardTitle')),
          React.createElement(Chip, { tone: C.accent, title: ws.projectDir }, ws.name),
          React.createElement(Chip, null, String(totals.chapters === undefined ? 0 : totals.chapters) + ' ' + t('wChapters')),
          React.createElement(Chip, null, formatChars(totals.chars === undefined ? 0 : totals.chars)),
          React.createElement(Chip, null, t('wPacks') + ' ' + String(totals.packs === undefined ? 0 : totals.packs)),
          React.createElement(Chip, null, t('wMarksShort') + ' ' + String((totals.good === undefined ? 0 : totals.good) + (totals.bad === undefined ? 0 : totals.bad))),
          totals.openAnnotations > 0 ? React.createElement(Chip, { tone: TONE.warn }, t('wOpenNotes') + ' ' + String(totals.openAnnotations)) : null,
          totals.avgScore === null || totals.avgScore === undefined ? null : React.createElement(Chip, { tone: TONE.ok }, t('wColScore') + ' ' + String(totals.avgScore)),
          stages === null || stages.current === null || stages.current === undefined || stages.current === ''
            ? null
            : React.createElement(Chip, { tone: TONE.info }, t('wStageCurrent') + ' ' + String(stages.done) + '/' + String(stages.total)),
          React.createElement(
            'button',
            { onClick: props.onRefresh, style: btn({ marginLeft: 'auto', fontSize: 12 }) },
            t('wRefresh'),
          ),
        ),
        React.createElement('div', { style: { color: C.sub, fontSize: 12, margin: '6px 0 10px' } }, t('wBoardHint')),
        React.createElement(
          'table',
          { style: { width: '100%', borderCollapse: 'collapse' } },
          React.createElement(
            'thead',
            null,
            React.createElement(
              'tr',
              null,
              head(t('wColChapter')),
              head(t('wColTitle')),
              head(t('wColWords'), { textAlign: 'right' }),
              head(t('wColState')),
              head(t('wColRounds')),
              head(t('wColMarks')),
              head(t('wColNotes')),
              head(t('wColPack')),
              head(t('wColScore')),
              head(t('wColTension')),
              head(t('wColIssues')),
            ),
          ),
          React.createElement(
            'tbody',
            null,
            ...chapters.map((row) => {
              const issues = Array.isArray(row.findings) ? row.findings : []
              const worst = issues.slice().sort((a, b) => (LEVEL_ORDER[a.level] === undefined ? 3 : LEVEL_ORDER[a.level]) - (LEVEL_ORDER[b.level] === undefined ? 3 : LEVEL_ORDER[b.level]))[0]
              return React.createElement(
                'tr',
                { key: 'c' + String(row.chapter) },
                React.createElement('td', { style: { ...cell, color: C.sub } }, String(row.chapter)),
                React.createElement(
                  'td',
                  { style: cell },
                  React.createElement(
                    'span',
                    {
                      onClick: () => props.onOpen(row.chapter),
                      style: { cursor: 'pointer', color: C.accent, borderBottom: '1px dashed ' + C.accent + '66' },
                    },
                    row.title === '' ? '第' + String(row.chapter) + '章' : row.title,
                  ),
                ),
                React.createElement('td', { style: { ...cell, textAlign: 'right', color: C.sub } }, formatChars(row.chars)),
                React.createElement(
                  'td',
                  { style: cell },
                  React.createElement(
                    Chip,
                    { tone: row.status === 'written' ? TONE.ok : row.status === 'draft' ? TONE.warn : C.sub },
                    statusText(t, row.status),
                  ),
                ),
                React.createElement(
                  'td',
                  { style: cell },
                  row.run !== undefined && row.run.exists
                    ? React.createElement(Chip, { title: row.run.rounds.map((r) => r.name).join('\n') }, String(row.run.rounds.length))
                    : React.createElement('span', { style: { color: C.sub } }, t('wNone')),
                ),
                React.createElement(
                  'td',
                  { style: cell },
                  row.marks.good + row.marks.bad === 0
                    ? React.createElement('span', { style: { color: C.sub } }, t('wNone'))
                    : React.createElement(Chip, null, '👍' + String(row.marks.good) + ' 👎' + String(row.marks.bad)),
                ),
                React.createElement(
                  'td',
                  { style: cell },
                  row.annotations.total === 0
                    ? React.createElement('span', { style: { color: C.sub } }, t('wNone'))
                    : React.createElement(
                        Chip,
                        { tone: row.annotations.open > 0 ? TONE.warn : TONE.ok },
                        String(row.annotations.open) + '/' + String(row.annotations.total),
                      ),
                ),
                React.createElement(
                  'td',
                  { style: cell },
                  row.pack.exists
                    ? React.createElement(Chip, { tone: TONE.info, title: row.pack.path }, formatBytes(row.pack.bytes))
                    : React.createElement('span', { style: { color: C.sub } }, t('wNone')),
                ),
                React.createElement(
                  'td',
                  { style: cell },
                  row.comment.score === null || row.comment.score === undefined
                    ? React.createElement('span', { style: { color: C.sub } }, t('wNone'))
                    : React.createElement('span', { title: String(row.comment.count) + ' 条读者评论' }, String(row.comment.score)),
                ),
                React.createElement(
                  'td',
                  { style: cell },
                  ...[1, 2, 3, 4, 5].map((v) =>
                    React.createElement(
                      'span',
                      {
                        key: 't' + String(v),
                        onClick: () => props.onTension(row.chapter, row.tension === v ? 0 : v),
                        title: t('wPlotManual'),
                        style: {
                          cursor: 'pointer',
                          fontSize: 12,
                          color: row.tension !== null && row.tension >= v ? C.accent : C.border,
                        },
                      },
                      '●',
                    ),
                  ),
                ),
                React.createElement(
                  'td',
                  { style: cell },
                  issues.length === 0
                    ? React.createElement('span', { style: { color: C.sub } }, t('wNone'))
                    : React.createElement(
                        Chip,
                        { tone: TONE[worst.level] === undefined ? C.sub : TONE[worst.level], title: issues.map((f) => f.message).join('\n') },
                        String(issues.length) + ' ' + t('wIssues'),
                      ),
                ),
              )
            }),
          ),
        ),
      )
    }

    /** 写作包面板：分节预算 + 提醒 + 全文。 */
    function PackPanel(props) {
      const t = props.t
      const pack = props.pack
      if (props.busy === true)
        return React.createElement(Empty, null, t('wBusy'))
      if (pack === null)
        return React.createElement(
          'div',
          null,
          React.createElement('div', { style: { color: C.sub, fontSize: 12.5, lineHeight: 1.8 } }, t('wPackBuildHint')),
          React.createElement(
            'button',
            { onClick: props.onBuild, style: btn({ marginTop: 8, background: C.accent, borderColor: C.accent, color: '#fff' }) },
            '📦 ' + t('wPackBuild'),
          ),
        )
      return React.createElement(
        'div',
        null,
        React.createElement(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          React.createElement('div', { style: { fontWeight: 600, fontSize: 13 } }, '📦 ' + t('wPack')),
          React.createElement(Chip, { tone: pack.budget !== undefined && pack.budget.ok ? TONE.ok : TONE.warn }, formatChars(pack.chars)),
          React.createElement(
            'button',
            { onClick: props.onBuild, style: btn({ fontSize: 11.5, padding: '3px 8px' }) },
            t('wRefresh'),
          ),
          React.createElement(
            'button',
            {
              onClick: () => {
                if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) void navigator.clipboard.writeText(String(pack.text))
                props.onCopied()
              },
              style: btn({ fontSize: 11.5, padding: '3px 8px' }),
            },
            props.copied === true ? t('wPackCopied') : t('wPackCopy'),
          ),
        ),
        React.createElement('div', { style: { fontSize: 11, color: C.sub, marginTop: 5, wordBreak: 'break-all' } }, t('wPackPath') + '：' + String(pack.path)),
        React.createElement(SectionTitle, null, t('wPackBudget')),
        React.createElement(
          'table',
          { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
          React.createElement(
            'tbody',
            null,
            ...(Array.isArray(pack.sections) ? pack.sections : []).map((s) =>
              React.createElement(
                'tr',
                { key: s.id, title: s.source + (s.note === '' ? '' : '｜' + s.note) },
                React.createElement(
                  'td',
                  { style: { padding: '4px 0', borderBottom: '1px solid ' + C.border } },
                  s.label,
                  s.trimmed === true ? React.createElement('span', { style: { color: TONE.warn, fontSize: 11 } }, ' · 已裁') : null,
                ),
                React.createElement(
                  'td',
                  { style: { padding: '4px 0', borderBottom: '1px solid ' + C.border, textAlign: 'right', color: C.sub, whiteSpace: 'nowrap' } },
                  String(s.chars) + ' ' + t('wWords'),
                ),
              ),
            ),
          ),
        ),
        Array.isArray(pack.warnings) && pack.warnings.length > 0
          ? React.createElement(
              'div',
              { style: { marginTop: 10 } },
              React.createElement(SectionTitle, null, '⚠️ ' + t('wPackWarnings')),
              ...pack.warnings.map((w, i) =>
                React.createElement('div', { key: 'w' + String(i), style: { fontSize: 12, color: TONE.warn, lineHeight: 1.8 } }, '· ' + String(w)),
              ),
            )
          : null,
        React.createElement(SectionTitle, null, t('wPack')),
        React.createElement(
          'pre',
          {
            style: {
              margin: 0,
              padding: 10,
              background: C.card,
              border: '1px solid ' + C.border,
              borderRadius: 8,
              fontSize: 11.5,
              lineHeight: 1.75,
              whiteSpace: 'pre-wrap',
              maxHeight: 320,
              overflow: 'auto',
              userSelect: 'text',
            },
          },
          String(pack.text),
        ),
      )
    }

    /** 批注面板：列表 + 新增。 */
    function NotePanel(props) {
      const t = props.t
      const notes = Array.isArray(props.annotations) ? props.annotations : []
      const types = Array.isArray(props.types) ? props.types : []
      const open = notes.filter((a) => a.status === 'open')
      const done = notes.filter((a) => a.status !== 'open')
      const line = (a) =>
        React.createElement(
          'div',
          {
            key: a.id,
            style: {
              border: '1px solid ' + C.border,
              borderLeft: '3px solid ' + noteTone(a.type),
              borderRadius: 8,
              padding: '7px 9px',
              marginBottom: 7,
              background: a.status === 'open' ? C.card : 'transparent',
              opacity: a.status === 'resolved' ? 0.6 : 1,
            },
          },
          React.createElement(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: C.sub } },
            React.createElement(Chip, { tone: noteTone(a.type) }, (() => {
              const hit = types.find((x) => x.id === a.type)
              return hit === undefined ? a.type : hit.label
            })()),
            React.createElement(
              'span',
              { onClick: () => props.onJump(a.seg), style: { cursor: 'pointer', borderBottom: '1px dashed ' + C.sub } },
              tf(t, 'wNoteOnSeg', { n: a.seg + 1 }),
            ),
            React.createElement('span', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
              React.createElement(
                'span',
                { onClick: () => props.onStatus(a.id, a.status === 'open' ? 'resolved' : 'open'), style: { cursor: 'pointer' } },
                a.status === 'open' ? t('wNoteResolve') : t('wNoteReopen'),
              ),
              React.createElement('span', { onClick: () => props.onDelete(a.id), style: { cursor: 'pointer' } }, t('wNoteDelete')),
            ),
          ),
          a.quote === '' ? null : React.createElement('div', { style: { fontSize: 11.5, color: C.sub, marginTop: 3 } }, '「' + a.quote + '」'),
          a.note === '' ? null : React.createElement('div', { style: { fontSize: 12.5, marginTop: 3, lineHeight: 1.7 } }, a.note),
        )
      return React.createElement(
        'div',
        null,
        React.createElement(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement('div', { style: { fontWeight: 600, fontSize: 13 } }, '💬 ' + t('wNotes')),
          React.createElement(Chip, { tone: open.length > 0 ? TONE.warn : TONE.ok }, tf(t, 'wNotesOpenCount', { n: open.length })),
        ),
        React.createElement('div', { style: { fontSize: 11.5, color: C.sub, margin: '5px 0 9px', lineHeight: 1.7 } }, t('wNotesHint')),
        props.composer === null || props.composer === undefined
          ? null
          : React.createElement(
              'div',
              { style: { border: '1px solid ' + C.accent + '88', borderRadius: 8, padding: 9, marginBottom: 10, background: C.card } },
              React.createElement('div', { style: { fontSize: 11.5, color: C.sub, marginBottom: 6 } }, tf(t, 'wNoteOnSeg', { n: props.composer.seg + 1 })),
              React.createElement(
                'div',
                { style: { display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 7 } },
                ...(Array.isArray(props.types) ? props.types : []).map((type2) =>
                  React.createElement(
                    'span',
                    {
                      key: type2.id,
                      onClick: () => props.onComposerType(type2.id),
                      title: type2.hint,
                      style: {
                        cursor: 'pointer',
                        fontSize: 11.5,
                        padding: '2px 8px',
                        borderRadius: 999,
                        color: props.composer.type === type2.id ? '#fff' : noteTone(type2.id),
                        background: props.composer.type === type2.id ? noteTone(type2.id) : noteTone(type2.id) + '18',
                        border: '1px solid ' + noteTone(type2.id) + '55',
                      },
                    },
                    type2.label,
                  ),
                ),
              ),
              React.createElement('textarea', {
                value: props.composer.note,
                onChange: (e) => props.onComposerNote(e.target.value),
                placeholder: t('wNotePlaceholder'),
                rows: 2,
                style: {
                  width: '100%',
                  boxSizing: 'border-box',
                  resize: 'vertical',
                  background: C.bg,
                  color: C.text,
                  border: '1px solid ' + C.border,
                  borderRadius: 6,
                  padding: '6px 8px',
                  fontSize: 12.5,
                  fontFamily: 'inherit',
                },
              }),
              React.createElement(
                'div',
                { style: { display: 'flex', gap: 8, marginTop: 7 } },
                React.createElement(
                  'button',
                  { onClick: props.onComposerSave, style: btn({ background: C.accent, borderColor: C.accent, color: '#fff', fontSize: 12 }) },
                  t('wNoteSave'),
                ),
                React.createElement('button', { onClick: props.onComposerCancel, style: btn({ fontSize: 12 }) }, t('wNoteCancel')),
              ),
            ),
        open.length === 0 && done.length === 0 ? React.createElement(Empty, null, t('wNotesEmpty')) : null,
        ...open.map(line),
        done.length === 0 ? null : React.createElement(SectionTitle, null, t('wNoteResolved')),
        ...done.map(line),
      )
    }

    /** 微调面板：模型只改被批注的段落，这里给作者逐段对照。 */
    function RevisionPanel(props) {
      const t = props.t
      const result = props.result
      return React.createElement(
        'div',
        null,
        React.createElement('div', { style: { fontWeight: 600, fontSize: 13 } }, '✍️ ' + t('wRevise')),
        React.createElement('div', { style: { fontSize: 11.5, color: C.sub, margin: '5px 0 9px', lineHeight: 1.7 } }, t('wReviseHint')),
        React.createElement(
          'button',
          {
            onClick: props.onRun,
            disabled: props.busy === true || props.openNotes === 0,
            style: btn({
              background: props.openNotes === 0 ? 'transparent' : C.accent,
              borderColor: props.openNotes === 0 ? C.border : C.accent,
              color: props.openNotes === 0 ? C.sub : '#fff',
              fontSize: 12.5,
            }),
          },
          props.busy === true ? t('wReviseRunning') : '✍️ ' + t('wReviseRun'),
        ),
        result === null || result === undefined
          ? null
          : React.createElement(
              'div',
              { style: { marginTop: 10 } },
              React.createElement(
                'div',
                { style: { fontSize: 11.5, color: C.sub } },
                t('wReviseModel') + '：' + String(result.model === undefined ? '' : result.model) + '　' + tf(t, 'wReviseUsed', { n: result.used }),
                result.capped === true ? '　' + tf(t, 'wReviseCapped', { n: result.total - result.used }) : '',
              ),
              Array.isArray(result.problems) && result.problems.length > 0
                ? React.createElement(
                    'div',
                    { style: { marginTop: 8, padding: 8, border: '1px solid ' + TONE.error + '55', borderRadius: 8, background: TONE.error + '10' } },
                    React.createElement('div', { style: { fontSize: 12, fontWeight: 600, color: TONE.error } }, t('wReviseProblems')),
                    ...result.problems.map((p, i) =>
                      React.createElement('div', { key: 'p' + String(i), style: { fontSize: 12, color: TONE.error, lineHeight: 1.7 } }, '· ' + String(p)),
                    ),
                  )
                : null,
              Array.isArray(result.warnings) && result.warnings.length > 0
                ? React.createElement(
                    'div',
                    { style: { marginTop: 8, padding: 8, border: '1px solid ' + TONE.warn + '55', borderRadius: 8, background: TONE.warn + '10' } },
                    React.createElement('div', { style: { fontSize: 12, fontWeight: 600, color: TONE.warn } }, '⚠️ ' + t('wPackWarnings')),
                    ...result.warnings.map((p, i) =>
                      React.createElement('div', { key: 'n' + String(i), style: { fontSize: 12, color: TONE.warn, lineHeight: 1.7 } }, '· ' + String(p)),
                    ),
                  )
                : null,
              result.diff === undefined || result.diff.length === 0
                ? React.createElement(Empty, null, (result.hint === undefined || result.hint === '' ? t('wReviseEmpty') : String(result.hint)))
                : React.createElement(
                    'div',
                    null,
                    ...result.diff.map((item) =>
                      React.createElement(
                        'div',
                        { key: 'd' + String(item.seg), style: { border: '1px solid ' + C.border, borderRadius: 8, padding: 9, marginTop: 9, background: C.card } },
                        React.createElement(
                          'div',
                          { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 11.5, color: C.sub } },
                          React.createElement(Chip, { tone: noteTone(item.type) }, item.type),
                          React.createElement('span', { onClick: () => props.onJump(item.seg), style: { cursor: 'pointer' } }, tf(t, 'wNoteOnSeg', { n: item.seg + 1 })),
                          React.createElement('span', { style: { marginLeft: 'auto' } }, String(item.charsBefore) + ' → ' + String(item.charsAfter) + ' ' + t('wWords')),
                        ),
                        item.note === '' ? null : React.createElement('div', { style: { fontSize: 11.5, color: C.sub, marginTop: 4 } }, '批注：' + item.note),
                        React.createElement('div', { style: { fontSize: 12.5, marginTop: 6, lineHeight: 1.8, color: C.sub, textDecoration: 'line-through' } }, item.before),
                        React.createElement('div', { style: { fontSize: 12.5, marginTop: 6, lineHeight: 1.8 } }, item.after),
                      ),
                    ),
                    React.createElement(
                      'button',
                      {
                        onClick: props.onAdopt,
                        disabled: props.adopting === true || props.ok !== true,
                        style: btn({
                          marginTop: 10,
                          background: props.ok === true ? TONE.ok : 'transparent',
                          borderColor: props.ok === true ? TONE.ok : C.border,
                          color: props.ok === true ? '#fff' : C.sub,
                          fontSize: 12.5,
                        }),
                      },
                      props.adopting === true ? t('wReviseAdopting') : '✅ ' + t('wReviseAdopt'),
                    ),
                    React.createElement('div', { style: { fontSize: 11, color: C.sub, marginTop: 5 } }, t('wReviseHint')),
                  ),
            ),
      )
    }

    /** 单章详情：左边读正文、右边批注/写作包/微调/设定。 */
    function ChapterDetail(props) {
      const t = props.t
      const chapter = props.chapter
      const [detail, setDetail] = useState(null)
      const [error, setError] = useState('')
      const [loading, setLoading] = useState(true)
      const [cursor, setCursor] = useState(0)
      const [panel, setPanel] = useState('notes')
      const [composer, setComposer] = useState(null)
      const [pack, setPack] = useState(null)
      const [packBusy, setPackBusy] = useState(false)
      const [packCopied, setPackCopied] = useState(false)
      const [revise, setRevise] = useState(null)
      const [reviseBusy, setReviseBusy] = useState(false)
      const [adopting, setAdopting] = useState(false)
      const [setupDraft, setSetupDraft] = useState('')
      const [setupDirty, setSetupDirty] = useState(false)
      const [notice, setNotice] = useState('')

      const load = useCallback(async () => {
        setLoading(true)
        setError('')
        try {
          const data = await postJson('chapter', { chapter })
          setDetail(data)
          setSetupDraft(data.setup === undefined ? '' : data.setup.text)
          setSetupDirty(false)
          setComposer(null)
          setRevise(null)
          setPack(null)
          setCursor(0)
        } catch (e) {
          setError(String(e && e.message ? e.message : e))
        } finally {
          setLoading(false)
        }
      }, [chapter])

      useEffect(() => {
        void load()
      }, [load])

      // 读正文也是键盘优先：j/k 走段、A 留批注、Esc 收起批注框
      useEffect(() => {
        if (typeof window === 'undefined' || window.addEventListener === undefined) return undefined
        const onKey = (event) => {
          if (event.metaKey || event.ctrlKey || event.altKey) return
          if (isTypingTarget(event.target)) {
            if (event.key === 'Escape') setComposer(null)
            return
          }
          const segments = detail !== null && Array.isArray(detail.segments) ? detail.segments : []
          if (event.key === 'j' || event.key === 'J') {
            event.preventDefault()
            setCursor((prev) => Math.min(prev + 1, Math.max(segments.length - 1, 0)))
          } else if (event.key === 'k' || event.key === 'K') {
            event.preventDefault()
            setCursor((prev) => Math.max(prev - 1, 0))
          } else if (event.key === 'a' || event.key === 'A') {
            event.preventDefault()
            setPanel('notes')
            setComposer({ seg: cursor, type: 'ai-tone', note: '' })
          } else if (event.key === 'Escape') {
            setComposer(null)
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      })

      const segments = detail !== null && Array.isArray(detail.segments) ? detail.segments : []
      const notes = detail !== null && Array.isArray(detail.annotations) ? detail.annotations : []
      const openNotes = notes.filter((a) => a.status === 'open')
      const notesAt = (seg) => notes.filter((a) => a.seg === seg)

      const saveComposer = async () => {
        if (composer === null) return
        try {
          const data = await postJson('annotation', {
            chapter,
            action: 'add',
            seg: composer.seg,
            type: composer.type,
            note: composer.note,
            quote: (segments[composer.seg] === undefined ? '' : segments[composer.seg]).slice(0, 60),
          })
          setDetail({ ...detail, annotations: data.list })
          setComposer(null)
          setNotice(data.added ? '批注已保存' : '批注已更新')
          props.onChanged()
        } catch (e) {
          setNotice(String(e && e.message ? e.message : e))
        }
      }

      const setNoteStatus = async (id, status) => {
        try {
          const data = await postJson('annotation', { chapter, action: 'update', id, status })
          setDetail({ ...detail, annotations: data.list })
          props.onChanged()
        } catch (e) {
          setNotice(String(e && e.message ? e.message : e))
        }
      }

      const deleteNote = async (id) => {
        try {
          const data = await postJson('annotation', { chapter, action: 'remove', id })
          setDetail({ ...detail, annotations: data.list })
          props.onChanged()
        } catch (e) {
          setNotice(String(e && e.message ? e.message : e))
        }
      }

      const buildPack = async () => {
        setPackBusy(true)
        setNotice('')
        try {
          const data = await postJson('pack', { chapter })
          setPack(data)
        } catch (e) {
          setNotice(String(e && e.message ? e.message : e))
        } finally {
          setPackBusy(false)
        }
      }

      const runRevise = async () => {
        setReviseBusy(true)
        setNotice('')
        setPanel('revise')
        try {
          const data = await postJson('revise', { chapter })
          setRevise(data)
        } catch (e) {
          setNotice(String(e && e.message ? e.message : e))
        } finally {
          setReviseBusy(false)
        }
      }

      const adopt = async () => {
        setAdopting(true)
        setNotice('')
        try {
          const data = await postJson('revise-apply', { chapter })
          setNotice(t('wReviseAdopted'))
          setRevise(null)
          await load()
          props.onChanged()
          void data
        } catch (e) {
          setNotice(String(e && e.message ? e.message : e))
        } finally {
          setAdopting(false)
        }
      }

      const saveSetup = async () => {
        try {
          await postJson('setup', { chapter, text: setupDraft })
          setNotice(t('wSetupSaved'))
          setSetupDirty(false)
        } catch (e) {
          setNotice(String(e && e.message ? e.message : e))
        }
      }

      const panelBtn = (id, label, badge) =>
        React.createElement(
          'button',
          {
            key: id,
            onClick: () => setPanel(id),
            style: {
              border: 'none',
              borderBottom: '2px solid ' + (panel === id ? C.accent : 'transparent'),
              background: 'transparent',
              color: panel === id ? C.text : C.sub,
              fontWeight: panel === id ? 600 : 400,
              fontSize: 12.5,
              padding: '6px 8px',
              cursor: 'pointer',
            },
          },
          label + (badge === undefined || badge === 0 ? '' : ' · ' + String(badge)),
        )

      return React.createElement(
        'div',
        { style: { flex: 1, display: 'flex', minHeight: 0 } },
        React.createElement(
          'div',
          { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' } },
          React.createElement(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderBottom: '1px solid ' + C.border, background: C.card, flexWrap: 'wrap' } },
            React.createElement('button', { onClick: props.onBack, style: btn({ fontSize: 12 }) }, t('wBack')),
            React.createElement('div', { style: { fontWeight: 600, fontSize: 13.5 } }, detail === null ? '第' + String(chapter) + '章' : detail.title),
            detail === null
              ? null
              : React.createElement(Chip, null, formatChars(detail.chars)),
            openNotes.length > 0 ? React.createElement(Chip, { tone: TONE.warn }, t('wNotes') + ' ' + String(openNotes.length)) : null,
            notice === '' ? null : React.createElement('span', { style: { fontSize: 11.5, color: C.sub } }, notice),
          ),
          React.createElement(
            'div',
            { style: { flex: 1, overflow: 'auto', padding: '10px 14px' } },
            loading === true
              ? React.createElement(Empty, null, t('wBusy'))
              : error !== ''
                ? React.createElement(Empty, null, t('wError') + '：' + error + '　' + React.createElement('span', { onClick: () => void load(), style: { color: C.accent, cursor: 'pointer' } }, t('wRetry')))
                : React.createElement(
                    'div',
                    null,
                    React.createElement(
                      'div',
                      { style: { fontSize: 11.5, color: C.sub, marginBottom: 8 } },
                      'j / k 换段 · A 留批注 · 点段落也能选',
                    ),
                    ...segments.map((text, i) => {
                      const here = notesAt(i)
                      const bar = here.find((a) => a.status === 'open') === undefined ? null : here.find((a) => a.status === 'open')
                      return React.createElement(
                        'div',
                        {
                          key: 'seg' + String(i),
                          'data-cseg': String(i),
                          onClick: () => setCursor(i),
                          onDoubleClick: () => {
                            setPanel('notes')
                            setComposer({ seg: i, type: 'ai-tone', note: '' })
                          },
                          style: {
                            position: 'relative',
                            padding: '7px 10px 7px 14px',
                            marginBottom: 2,
                            borderRadius: 6,
                            borderLeft: '3px solid ' + (bar === null ? 'transparent' : noteTone(bar.type)),
                            background: cursor === i ? C.accent + '14' : 'transparent',
                            fontSize: 14,
                            lineHeight: 1.95,
                            cursor: 'text',
                            userSelect: 'text',
                          },
                        },
                        text,
                        here.length === 0
                          ? null
                          : React.createElement(
                              'div',
                              { style: { marginTop: 4, fontSize: 11.5, color: noteTone(here[0].type), lineHeight: 1.7 } },
                              ...here.map((a) =>
                                React.createElement(
                                  'div',
                                  { key: a.id, style: { opacity: a.status === 'open' ? 1 : 0.5 } },
                                  '💬 ' + (a.note === '' ? (detail.annotationTypes.find((x) => x.id === a.type) === undefined ? a.type : detail.annotationTypes.find((x) => x.id === a.type).label) : a.note),
                                ),
                              ),
                            ),
                      )
                    }),
                  ),
          ),
        ),
        React.createElement(
          'div',
          { style: { width: 396, flexShrink: 0, borderLeft: '1px solid ' + C.border, display: 'flex', flexDirection: 'column', background: C.card } },
          React.createElement(
            'div',
            { style: { display: 'flex', gap: 2, padding: '0 10px', borderBottom: '1px solid ' + C.border, flexWrap: 'wrap' } },
            panelBtn('notes', '💬 ' + t('wNotes'), openNotes.length),
            panelBtn('pack', '📦 ' + t('wPack')),
            panelBtn('revise', '✍️ ' + t('wRevise')),
            panelBtn('setup', '📝 ' + t('wSetup')),
          ),
          React.createElement(
            'div',
            { style: { flex: 1, overflow: 'auto', padding: '10px 12px' } },
            panel === 'notes'
              ? React.createElement(NotePanel, {
                  t,
                  annotations: notes,
                  types: detail === null ? [] : detail.annotationTypes,
                  composer,
                  onComposerType: (type) => setComposer({ ...composer, type }),
                  onComposerNote: (note) => setComposer({ ...composer, note }),
                  onComposerSave: () => void saveComposer(),
                  onComposerCancel: () => setComposer(null),
                  onStatus: (id, status) => void setNoteStatus(id, status),
                  onDelete: (id) => void deleteNote(id),
                  onJump: (seg) => {
                    setCursor(seg)
                    const node = document.querySelector('[data-cseg="' + String(seg) + '"]')
                    if (node !== null && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'center' })
                  },
                })
              : null,
            panel === 'pack'
              ? React.createElement(PackPanel, {
                  t,
                  pack,
                  busy: packBusy,
                  copied: packCopied,
                  onBuild: () => void buildPack(),
                  onCopied: () => {
                    setPackCopied(true)
                    setTimeout(() => setPackCopied(false), 1600)
                  },
                })
              : null,
            panel === 'revise'
              ? React.createElement(RevisionPanel, {
                  t,
                  result: revise,
                  busy: reviseBusy,
                  adopting,
                  ok: revise === null ? false : revise.ok,
                  openNotes: openNotes.length,
                  onRun: () => void runRevise(),
                  onAdopt: () => void adopt(),
                  onJump: (seg) => {
                    setCursor(seg)
                    const node = document.querySelector('[data-cseg="' + String(seg) + '"]')
                    if (node !== null && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'center' })
                  },
                })
              : null,
            panel === 'setup'
              ? React.createElement(
                  'div',
                  null,
                  React.createElement('div', { style: { fontWeight: 600, fontSize: 13 } }, '📝 ' + t('wSetup')),
                  React.createElement('div', { style: { fontSize: 11.5, color: C.sub, margin: '5px 0 8px', lineHeight: 1.7 } }, t('wSetupHint')),
                  React.createElement('textarea', {
                    value: setupDraft,
                    onChange: (e) => {
                      setSetupDraft(e.target.value)
                      setSetupDirty(true)
                    },
                    rows: 18,
                    style: {
                      width: '100%',
                      boxSizing: 'border-box',
                      background: C.bg,
                      color: C.text,
                      border: '1px solid ' + C.border,
                      borderRadius: 8,
                      padding: 9,
                      fontSize: 12.5,
                      lineHeight: 1.8,
                      fontFamily: 'inherit',
                      resize: 'vertical',
                    },
                  }),
                  React.createElement(
                    'div',
                    { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 } },
                    React.createElement(
                      'button',
                      { onClick: () => void saveSetup(), disabled: setupDirty === false, style: btn({ background: setupDirty ? C.accent : 'transparent', borderColor: setupDirty ? C.accent : C.border, color: setupDirty ? '#fff' : C.sub, fontSize: 12.5 }) },
                      t('wSetupSave'),
                    ),
                    setupDirty === true ? React.createElement('span', { style: { fontSize: 11.5, color: TONE.warn } }, '未保存') : null,
                  ),
                  detail !== null && detail.setup !== undefined
                    ? React.createElement('div', { style: { fontSize: 11, color: C.sub, marginTop: 8, wordBreak: 'break-all' } }, detail.setup.path)
                    : null,
                )
              : null,
          ),
        ),
      )
    }

    /** 情节体检：张力曲线 + 问题清单 + 伏笔欠账。 */
    function PlotView(props) {
      const t = props.t
      const ws = props.ws
      const checks = ws !== null && ws.checks !== undefined && ws.checks !== null ? ws.checks : null
      const metrics = checks === null || checks.plot === null || checks.plot === undefined ? null : checks.plot.metrics
      const findings = checks === null || checks.plot === null || checks.plot === undefined ? [] : checks.plot.findings
      const chapters = ws !== null && Array.isArray(ws.chapters) ? ws.chapters : []
      const series = metrics === null || !Array.isArray(metrics.tension) ? [] : metrics.tension
      const scores = chapters.filter((c) => c.comment.score !== null).map((c) => ({ chapter: c.chapter, score: c.comment.score }))
      const sorted = findings.slice().sort((a, b) => (LEVEL_ORDER[a.level] === undefined ? 3 : LEVEL_ORDER[a.level]) - (LEVEL_ORDER[b.level] === undefined ? 3 : LEVEL_ORDER[b.level]))
      const jump = (chapter) => {
        if (chapter === null || chapter === undefined) return
        props.onOpenChapter(chapter)
      }
      if (ws === null || ws.found !== true) return React.createElement(Empty, null, t('wNoProjectHint'))
      return React.createElement(
        'div',
        { style: { flex: 1, overflow: 'auto', padding: '12px 18px' } },
        React.createElement(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          React.createElement('div', { style: { fontWeight: 700, fontSize: 15 } }, '📈 ' + t('wPlot')),
          checks === null ? null : React.createElement(Chip, null, String(checks.at).slice(0, 16).replace('T', ' ') + (checks.cached === true ? ' · 缓存' : '')),
          React.createElement(
            'button',
            { onClick: props.onRunChecks, disabled: props.busy === true, style: btn({ marginLeft: 'auto', fontSize: 12 }) },
            props.busy === true ? t('wPlotRunning') : '🔍 ' + t('wPlotRun'),
          ),
        ),
        React.createElement('div', { style: { color: C.sub, fontSize: 12, margin: '6px 0 12px' } }, t('wPlotHint')),
        ws.outline !== undefined && ws.outline.exists !== true
          ? React.createElement(
              'div',
              { style: { fontSize: 12, color: TONE.warn, marginBottom: 10 } },
              '· ' + t('wPlotOutlineMissing') + '（' + String(ws.outline.path) + '）',
            )
          : null,
        React.createElement(SectionTitle, null, '📉 ' + t('wPlotTension')),
        checks === null
          ? React.createElement(Empty, null, t('wPlotNever'))
          : React.createElement(TensionChart, { t, series, scores, onPick: jump }),
        React.createElement(SectionTitle, null, '🧾 ' + t('wPlotFindings') + (sorted.length === 0 ? '' : ' · ' + String(sorted.length))),
        sorted.length === 0
          ? React.createElement(Empty, null, checks === null ? t('wPlotNever') : t('wPlotNone'))
          : React.createElement(
              'div',
              null,
              ...sorted.map((f, i) =>
                React.createElement(
                  'div',
                  {
                    key: 'f' + String(i),
                    style: {
                      border: '1px solid ' + C.border,
                      borderLeft: '3px solid ' + (TONE[f.level] === undefined ? C.sub : TONE[f.level]),
                      borderRadius: 8,
                      padding: '7px 10px',
                      marginBottom: 6,
                      background: C.card,
                    },
                  },
                  React.createElement(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: C.sub } },
                    React.createElement(Chip, { tone: TONE[f.level] === undefined ? C.sub : TONE[f.level] }, String(f.code)),
                    f.chapter === null || f.chapter === undefined
                      ? null
                      : React.createElement(
                          'span',
                          { onClick: () => jump(f.chapter), style: { cursor: 'pointer', color: C.accent } },
                          '第' + String(f.chapter) + '章',
                        ),
                  ),
                  React.createElement('div', { style: { fontSize: 12.5, marginTop: 4, lineHeight: 1.8 } }, String(f.message)),
                  f.evidence === '' || f.evidence === undefined
                    ? null
                    : React.createElement('div', { style: { fontSize: 11.5, color: C.sub, marginTop: 3 } }, '「' + String(f.evidence) + '」'),
                ),
              ),
            ),
        React.createElement(SectionTitle, null, '🪝 ' + t('wPlotDebt')),
        metrics === null || !Array.isArray(metrics.foreshadow) || metrics.foreshadow.length === 0
          ? React.createElement(Empty, null, t('wPlotDebtNone'))
          : React.createElement(
              'table',
              { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 } },
              React.createElement(
                'tbody',
                null,
                ...metrics.foreshadow.map((d, i) =>
                  React.createElement(
                    'tr',
                    { key: 'd' + String(i) },
                    React.createElement('td', { style: { padding: '5px 0', borderBottom: '1px solid ' + C.border } }, String(d.name)),
                    React.createElement(
                      'td',
                      { style: { padding: '5px 0', borderBottom: '1px solid ' + C.border, color: C.sub, textAlign: 'right' } },
                      tf(t, 'wPlotDebtRow', { a: d.plantedChapter, n: d.openChapters }),
                    ),
                  ),
                ),
              ),
            ),
      )
    }

    /** 全书阶段：立项 → … → 完本。产物、门禁、起草都在这里。 */
    function StageView(props) {
      const t = props.t
      const ws = props.ws
      const [stageId, setStageId] = useState('')
      const [draft, setDraft] = useState('')
      const [busy, setBusy] = useState(false)
      const [saving, setSaving] = useState(false)
      const [notice, setNotice] = useState('')
      const [missing, setMissing] = useState([])
      const [target, setTarget] = useState('')
      const stages = ws !== null && ws.stages !== undefined && ws.stages !== null && Array.isArray(ws.stages.stages) ? ws.stages.stages : []
      const current = ws !== null && ws.stages !== undefined && ws.stages !== null ? ws.stages.current : null
      const activeId = stageId === '' ? (current === null || current === undefined ? (stages.length === 0 ? '' : stages[0].id) : current) : stageId
      const active = stages.find((s) => s.id === activeId)

      const generate = async () => {
        setBusy(true)
        setNotice('')
        try {
          const data = await postJson('stage', { action: 'generate', stage: activeId })
          setDraft(data.text === undefined ? '' : data.text)
          setTarget(data.produce === undefined ? '' : data.produce)
          setMissing(Array.isArray(data.missing) ? data.missing : [])
          if (data.hint !== undefined && data.hint !== '') setNotice(String(data.hint))
        } catch (e) {
          setNotice(String(e && e.message ? e.message : e))
        } finally {
          setBusy(false)
        }
      }

      const save = async () => {
        setSaving(true)
        setNotice('')
        try {
          const data = await postJson('stage', { action: 'save', stage: activeId, text: draft })
          setNotice(t('wStageSaved') + '：' + String(data.savedPath))
          props.onReload()
        } catch (e) {
          setNotice(String(e && e.message ? e.message : e))
        } finally {
          setSaving(false)
        }
      }

      const setCurrent = async (id) => {
        try {
          await postJson('stage', { action: 'set', stage: id })
          props.onReload()
        } catch (e) {
          setNotice(String(e && e.message ? e.message : e))
        }
      }

      if (ws === null || ws.found !== true) return React.createElement(Empty, null, t('wNoProjectHint'))
      return React.createElement(
        'div',
        { style: { flex: 1, overflow: 'auto', padding: '12px 18px' } },
        React.createElement(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          React.createElement('div', { style: { fontWeight: 700, fontSize: 15 } }, '🧭 ' + t('wStage')),
          ws.stages === undefined || ws.stages === null
            ? null
            : React.createElement(Chip, { tone: TONE.info }, String(ws.stages.done) + '/' + String(ws.stages.total)),
        ),
        React.createElement('div', { style: { color: C.sub, fontSize: 12, margin: '6px 0 12px', lineHeight: 1.8 } }, t('wStageHint')),
        // 老书补票：一步都没齐的时候，红灯会把第一次打开的人劝退，这里先把话说清楚
        stages.length > 0 && stages.filter((x) => x.blocked === true).length >= 2
          ? React.createElement(
              'div',
              { style: { fontSize: 12, color: TONE.warn, lineHeight: 1.8, marginBottom: 10, padding: '7px 10px', border: '1px solid ' + TONE.warn + '44', borderRadius: 8, background: TONE.warn + '10' } },
              '📌 ' + t('wStageBlockedHint') + ' ' + t('wStageBackfill'),
            )
          : null,
        React.createElement(
          'div',
          { style: { display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' } },
          React.createElement(
            'div',
            { style: { flex: '1 1 380px', minWidth: 320 } },
            ...stages.map((stage) =>
              React.createElement(
                'div',
                {
                  key: stage.id,
                  onClick: () => setStageId(stage.id),
                  style: {
                    border: '1px solid ' + (stage.id === activeId ? C.accent : C.border),
                    borderRadius: 10,
                    padding: '9px 11px',
                    marginBottom: 8,
                    background: C.card,
                    cursor: 'pointer',
                  },
                },
                React.createElement(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' } },
                  React.createElement('span', { style: { fontSize: 13, fontWeight: 600 } }, stage.name),
                  stage.complete === true
                    ? React.createElement(Chip, { tone: TONE.ok }, '✓ ' + t('wStageOk'))
                    : stage.blocked === true
                      ? React.createElement(Chip, { tone: TONE.error }, t('wStageBlocked'))
                      : React.createElement(Chip, { tone: TONE.warn }, '…'),
                  stage.id === current ? React.createElement(Chip, { tone: TONE.info }, t('wStageCurrent')) : null,
                ),
                React.createElement(
                  'div',
                  { style: { fontSize: 11.5, color: C.sub, marginTop: 5, lineHeight: 1.7 } },
                  ...stage.artifacts.map((a) =>
                    React.createElement('div', { key: a.path }, (a.ok === true ? '✓ ' : '· ') + a.label + '　' + a.path + (a.exists === true ? '（' + formatBytes(a.bytes) + '）' : '')),
                  ),
                ),
                ...stage.gate.filter((g) => g.ok !== true).map((g, i) =>
                  React.createElement(
                    'div',
                    { key: 'g' + String(i), style: { fontSize: 11.5, marginTop: 4, color: g.level === 'error' ? TONE.error : TONE.warn } },
                    (g.level === 'error' ? '⛔ ' : '⚠️ ') + g.message,
                  ),
                ),
              ),
            ),
          ),
          React.createElement(
            'div',
            { style: { flex: '1 1 420px', minWidth: 340 } },
            React.createElement(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
              React.createElement('div', { style: { fontWeight: 600, fontSize: 13 } }, active === undefined ? '' : active.name),
              React.createElement(
                'button',
                { onClick: () => void generate(), disabled: busy === true, style: btn({ background: busy ? 'transparent' : C.accent, borderColor: busy ? C.border : C.accent, color: busy ? C.sub : '#fff', fontSize: 12 }) },
                busy === true ? t('wStageGenerating') : '✨ ' + t('wStageGenerate'),
              ),
              active === undefined || active.id === current ? null : React.createElement('button', { onClick: () => void setCurrent(active.id), style: btn({ fontSize: 12 }) }, t('wStageNext')),
            ),
            target === ''
              ? null
              : React.createElement('div', { style: { fontSize: 11, color: C.sub, marginTop: 6, wordBreak: 'break-all' } }, t('wStageTarget') + '：' + target),
            missing.length === 0
              ? null
              : React.createElement(
                  'div',
                  { style: { fontSize: 11.5, color: TONE.warn, marginTop: 6, lineHeight: 1.7 } },
                  t('wStageMissing') + '：' + missing.join('、'),
                ),
            notice === '' ? null : React.createElement('div', { style: { fontSize: 11.5, color: C.sub, marginTop: 6 } }, notice),
            React.createElement('textarea', {
              value: draft,
              onChange: (e) => setDraft(e.target.value),
              rows: 18,
              placeholder: t('wStageDraft'),
              style: {
                width: '100%',
                boxSizing: 'border-box',
                marginTop: 8,
                background: C.bg,
                color: C.text,
                border: '1px solid ' + C.border,
                borderRadius: 8,
                padding: 9,
                fontSize: 12.5,
                lineHeight: 1.85,
                fontFamily: 'inherit',
                resize: 'vertical',
              },
            }),
            React.createElement(
              'button',
              { onClick: () => void save(), disabled: draft.trim() === '' || saving === true, style: btn({ marginTop: 8, background: draft.trim() === '' ? 'transparent' : TONE.ok, borderColor: draft.trim() === '' ? C.border : TONE.ok, color: draft.trim() === '' ? C.sub : '#fff', fontSize: 12.5 }) },
              saving === true ? '…' : '💾 ' + t('wStageSave'),
            ),
          ),
        ),
      )
    }

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
      // 规律 → 证据：点某条规律后面的「证据」，就地展开它当时是从哪几段来的
      const [prov, setProv] = useState(null)
      const [provPath, setProvPath] = useState('')
      const [provRule, setProvRule] = useState('')

      useEffect(() => {
        if (dir === '') return undefined
        let alive = true
        getJson('rule-evidence')
          .then((data) => {
            if (!alive) return
            setProv(data.index === undefined ? {} : data.index)
            setProvPath(data.path === undefined ? '' : String(data.path))
          })
          .catch(() => {
            // 没有来源文件（老档案）就当没有：不给作者弹错误，也不挡别的功能
            if (alive) setProv({})
          })
        return () => {
          alive = false
        }
      }, [dir, state])

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
                ...renderProfileDoc(profile, t, {
                  onRemoveRule: (rule) => void removeRule(rule),
                  evidence: prov,
                  expandedRule: provRule,
                  onEvidenceRule: (rule) => setProvRule(rule),
                }),
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
      // 0.2 的面板：单测直接按 props 渲染它们，比排队强制 useState 稳得多
      tf,
      noteTone,
      statusText,
      Chip,
      TensionChart,
      ChapterBoard,
      ChapterDetail,
      PackPanel,
      NotePanel,
      RevisionPanel,
      PlotView,
      StageView,
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
