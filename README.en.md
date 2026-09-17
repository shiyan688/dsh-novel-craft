# dsh-novel-craft — a novel-writing workbench that learns your taste

[![npm](https://img.shields.io/npm/v/dsh-novel-craft?color=blue)](https://www.npmjs.com/package/dsh-novel-craft)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-ff7a45)](https://github.com/topics/dsh-plugin)

A plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh),
built for one problem: **an AI can be taught to avoid "AI-sounding" prose, but only real
samples can teach it to sound like *you*.**

The loop: lay out a batch of structurally different drafts → the author taps 👍 / 👎 on
passages (no writing reviews, no rating scales) → those marks are compressed into
**reusable writing rules** → the next round of drafting converges on them.

The rule the whole plugin is built around: **only the rules reach the model's context.**
Raw quotes never do.

Since 0.2 it is also a workbench you can finish a whole book in. Each capability exists to
serve that one core loop:

| | What it does |
|---|---|
| ✍️ New chapter | Write the next chapter: ask the model for 8–12 **scene-decision directions** (not rewordings) → draft them one at a time → pick passages in the gacha view → merge into a final draft and write it into the manuscript |
| 🎴 Gacha + profile | You mark good/bad passages → they are distilled into rules → rules are the only taste input in context. Includes **rule → evidence lookup**: click a rule to see the very passages it came from. |
| 🗂 Chapter board | Finds your book root automatically (wherever chapters, setting, cast and summaries live) and shows one row per chapter: chars, rounds, marks, notes, pack, reader score, tension, findings. |
| 📦 Per-chapter writing pack | Assembles everything one chapter needs into **a single file** (chapter brief + rules + previous chapter's ending + recap + cast + ledger + plot nodes + unpaid setups + anti-AI-tone list + requirements) and reports a **context budget table**. The writing session reads only that file. |
| 💬 Note-driven revision | Read the text, click a paragraph, press `A` to leave a note. “Revise by notes” rewrites **only annotated paragraphs — every other paragraph stays byte-identical**, verified before write-back, with a per-paragraph before/after and an automatic backup. |
| 📈 Plot checks | Tension curve (hand-rated or estimated), outline drift, unpaid setups, length imbalance, event density, score decline — all local statistics, **raw text never enters a model context**. |
| 🧭 Book stages | Idea → setting → cast → outline → chapters → revise → finish: artifact checklist, gates, and one-click drafting (the model writes a first pass, you edit it). |

It reads the directory habits you already have (`书名-第8章.txt`, `剧情/第 8 章 剧情总结.md`,
`人物/*.json`, `设定/道具与增益台账.md`, `factory/runs/<book>/第N章/候选稿/`,
`评论/第N章_评论数据.json`) — no reorganising required.

## UI preview

A static snapshot rendered from the real components (not a mock-up):
[`docs/preview.html`](./docs/preview.html) — open it in a browser after cloning; tabs switch
between the reading view, the author-profile panel and the folder picker. Regenerate with
`node scripts/build-preview.mjs` after changing the components.

## Install

```sh
dsh plugin --profile web add dsh-novel-craft                     # from npm
dsh plugin --profile web add github:shiyan688/dsh-novel-craft    # or straight from GitHub
```

Published: `dsh-novel-craft@0.1.1` ([npm page](https://www.npmjs.com/package/dsh-novel-craft)).

Restart that profile once afterwards (bundle and client metadata are cached in-process).
A 「🎴 抽卡工作台」 entry appears at the bottom of the sidebar.

Requires the dsh **web** profile (`dsh-web-app`) with an **LLM service mounted**
(`ctx.llm`) for the distillation step. Without one, marking and hand-editing still work.

## Version compatibility

dsh ships as **independently versioned npm packages** — in one public release the CLI may be
`0.1.5-rc.2` while the client runtime is still `0.1.1-rc.2`. The plugin therefore pins nothing:
peer dependencies are declared as `*` and resolved from your profile at runtime (the community
convention).

| dsh version | What was verified |
|---|---|
| `0.1.0-rc.7` / packages `0.1.0-rc.8` | Development and daily use; the whole test suite runs against it |
| `0.1.2-rc.1` | Same checks (legacy regression) |
| `0.1.5-rc.1` / `0.1.5-rc.2` | Same checks (current npm `latest` / `next`) |
| `0.1.6-alpha.1` (current npm `alpha`) | Same checks; **this release exposed the "apply runs before services mount" trap**, which led to the fix below |

Every row is produced by `node scripts/check-dsh-compat.mjs <version>`: it installs a fresh dsh
of that version into a temp dir, wires the plugin the way a profile does, boots it with an
isolated `DSH_HOME`, and asserts host routes, roster discovery and bundle delivery.

> Note: the older `0.1.0-rc.x` / `0.1.1-rc.x` releases can no longer be installed fresh from npm
> (metadata resolves fine, but fetching hangs — an upstream artifact issue), so the automated
> legacy baseline is `0.1.2-rc.1`. The author's daily environment runs `0.1.0-rc.7` (CLI) /
> `0.1.0-rc.8` (packages), which covers that generation by daily use.

Known differences (harmless here, but worth knowing):

- **Newer dsh gates the web shell behind a token**: plain `http://127.0.0.1:<port>/` returns 401;
  use the `?token=…` URL printed at startup. Plugin routes are not gated.
- **The client bundle URL shape changed**: newer versions serve combo scripts
  (`/plugins/??a/client.js,b/client.js&rev=…`) instead of `/plugins/<id>/client.js`.

### Keeping up (automated)

```sh
node scripts/check-dsh-compat.mjs          # npm `next` by default
node scripts/check-dsh-compat.mjs alpha    # or latest / alpha / an exact version
```

The script installs a **fresh dsh of that version** into a temp dir, wires this plugin the way a
profile does, boots it with an isolated `DSH_HOME`, and asserts three things: the host routes
answer, the client half lands in the boot manifest, and the bundle is served with the right
content. It cleans up afterwards and never touches a running instance. CI runs it weekly for
`latest / next / alpha / 0.1.0-rc.7` (`.github/workflows/compat.yml`).

### Version policy: one line, no per-version forks

We do **not** ship separate plugin builds per dsh version — the API surface we need has been
stable between `0.1.0-rc.7` and `0.1.6-alpha.1`, and forking would only confuse installers.
Instead: acquire services lazily with feature detection, prefer compatibility code over
compatibility releases, and only if a release truly removes a capability we need, publish a
`legacy` dist-tag line and document it here.

### Two traps we hit (for fellow plugin authors)

1. **A row's `apply` can run before services are mounted**: on newer dsh a *synchronous*
   `apply` sees `ctx.get('webServer') === undefined` (verified on `0.1.6-alpha.1`). This plugin
   therefore waits via `ctx.inject(['settings', 'webServer'], …)` with a timeout fallback.
   Plugins that do "get, and silently return if missing" do nothing at all on newer builds.
2. **The client bundle URL shape changed**: newer versions serve combo scripts
   (`/plugins/??a/client.js,b/client.js&rev=…`) instead of `/plugins/<id>/client.js`. The
   plugin does not care (the manifest supplies the URL), but hand-written test URLs will look
   like "the plugin was not discovered".

The host half loads `@deepseek-ai/dsh-llm` **lazily**, so a future rename or export change in
that package can only break the distillation step, never marking, evidence or the profile.

## Writing the next chapter (the main line)

Gacha answers “which passage is good”; **New chapter** answers “where do the candidates come from,
and how do the picked passages become one draft”. Click “✍️ New chapter” on the chapter board:

1. **What this chapter does** — chapter number (defaults to the next one), chapter brief, how many directions (10 default), extra requirements.
2. **Directions** — one line each, saying what that draft tests: e.g. `A conservative polish: keep the existing skeleton`,
   `B the sidekick appraises first: the protagonist's calculation hides in his silence`. Rename, rewrite or drop any of them;
   only the ticked ones get written.
**How taste gets in**: both the directions call and the drafting call are fed only the **writing pack**,
whose section ② is the author profile (rules only — the workbench's bookkeeping block is stripped).
Drafting states it twice: the system prompt names section ② (“‘avoid’ entries are what the author has
explicitly rejected — none of them may appear”), and the end of the user prompt restates that veto list,
because a 3–4k-character pack buries the rules in the middle.

3. **Draft** — one at a time, each saved the moment it finishes to
   `factory/runs/<book>/第N章/候选稿/第N章-A-保守精修.txt`. Progress is visible, you can stop midway, and one failure only affects that piece.
   “Go pick passages” also switches the current card pool to that folder for you.
4. **Merge** — lists the passages you marked 👍 (in manuscript order) with the reason you wrote for each, forming a pick table.
   Seams between different candidates become `〔needs transition〕` markers: **the workbench never lets a model write them for you.**
   “Write into the manuscript” normalises the text to `第N章 标题` + paragraphs and backs up the previous version.

Write a one-line reason for a good passage in the gacha view (a ✎ button appears once it is marked 👍);
it lands in `筛选与合并记录.md` automatically.

## Where the new artifacts live

| File | Content | Enters context? |
|---|---|---|
| `<round dir>/写作包.md` (falls back to `.dsh-novel-craft/写作包/第N章 写作包.md`) | The **only** file a writing session should read | ✅ that is the point |
| `<book root>/.dsh-novel-craft/批注/第N章.json` | Your revision notes (machine-readable) | ❌ only the annotated paragraphs, and only when you hit “Revise” |
| `<book root>/.dsh-novel-craft/章节设定/第N章.md` | Chapter goals / must-not-happen / cast / requirements | ✅ as section ① of the pack |
| `<book root>/.dsh-novel-craft/规则来源.json` | Rule → evidence mapping | ❌ UI lookup only |
| `<book root>/.dsh-novel-craft/微调/` | Before/after revision doc, pending revision, original backups | ❌ human-facing |
| `<book root>/.dsh-novel-craft/workspace.json` | Stage progress, hand-rated tension, per-chapter overrides | ❌ |

## Note-driven revision: the model can only touch what you flagged

Two independent guards, because this writes to your manuscript:

1. **Assembly**: `applyRevision` rebuilds the chapter from “original paragraphs + rewrite table”,
   so the model never gets a chance to touch an unannotated paragraph.
2. **Verification**: `verifyRevision` compares paragraph by paragraph — if an unannotated
   paragraph differs by a single character, or the paragraph count changed, write-back is **refused**.

Findings are graded by whether you authorised the change: unauthorised edits are **errors**
(blocked); a large size change on a paragraph you did annotate is a **warning** (you may well
have written “cut this in half”) — you see the before/after and decide. The original is backed
up to `.dsh-novel-craft/微调/原稿备份/` before any write-back, and the model's raw output is
always archived for troubleshooting.

## Three artifacts, one rule

Everything lives in `<candidate dir>/.dsh-novel-craft/` and travels with the manuscript:

| File | For whom | Enters model context? |
|---|---|---|
| `marks.json` | the workbench (machine-readable good/bad marks) | ❌ never |
| `证据摘录.md` — raw evidence | human review + distillation input (**verbatim quotes**) | ❌ header says "do not read into a writing context" |
| `作者偏好档案.md` — author profile | **the only file a writing session should read** (rules only) | ✅ this one |

```
# 作者偏好档案
## 已验证偏好（作者喜欢什么）
- 让在场群像先静默再爆响
- 危险降临先写器物异动，再写人的闷哼
## 避免的写法（作者不喜欢什么）
- 不要用比喻堆砌来写人群的恐惧
- 不要在施法后补旁白解释动机

<!-- dsh-novel-craft:auto:begin -->   ← workbench bookkeeping, rewritten each distill
- 标注：30 段（👍 15 / 👎 15），覆盖 3 篇
- 待提炼：0 段
- 最近提炼：2026-09-16 17:02 · deepseek-official/deepseek-v4-flash
<!-- dsh-novel-craft:auto:end -->
```

### How rules are produced

1. The author taps 👍 / 👎 while reading → `marks.json`.
2. 「⚗️ 提炼规律」 sends **only the pending** marks (≤40 passages, ≤240 chars each,
   ≤20KB total) to **one** auxiliary model call with thinking disabled, and a system prompt
   that forbids quoting the source text.
3. The reply is parsed into candidates and **nothing is written until the author ticks them**.
   Accepted lines go into the rules sections; the watermark advances so the same passage is
   never sent twice.

The rules sections are the author's; the auto block is rewritten. Deleting a single rule is
one click (✕), and the whole file is editable in the workbench.

## Interaction notes (from actually using it)

- **Reading, not reviewing.** Continuous prose layout; mark buttons only appear on the
  cursor or hovered passage, because most paragraphs need no mark at all.
- **Keyboard first.** `j/k` (or ↑↓) move the cursor and scroll it into view, `G`/`B` mark
  and advance, `Space` clears, `n/p` switch drafts. Keyboard marking is idempotent.
- **No path memorising.** The candidate-folder picker offers suggested folders (scanned for
  folders that actually hold drafts, with counts), recents, an in-app browser, and manual
  entry as a fallback.
- **Waiting is visible.** The distill button shows elapsed seconds; every run archives the
  model's raw reply to `提炼原始输出.md` so format failures are diagnosable.

## Companion skills (optional, recommended)

The plugin lets the author mark with almost no effort; the skills tell the agent what to do
with those marks. Both live under `skills/`:

```sh
cp -r skills/taste-calibration skills/novel-writing <your-project>/.dsh/skills/
```

- `taste-calibration` — the gacha-style calibration loop this plugin is built around;
- `novel-writing` — Chinese web-fiction craft: an anti-"AI prose" checklist (six dimensions),
  multi-POV information gaps, terminology/ledger discipline, restraint.

## Tests

```sh
npm install   # dev + peer deps (a deployment supplies the peers from its profile)
npm test
```

A fresh clone without dependencies does not dump stack traces: the static guard runs and the
other two suites print a skip notice and exit 0.

- `test/static-guard.test.mjs` — source-level guard: hooks must never follow an early
  `return` (that bug makes the panel silently fail to open), i18n key parity, `t('key')`
  existence.
- `test/host-api.test.mjs` — the plugin's routes on a real loopback port: marking loop,
  suggested folders, evidence/profile split, legacy migration, distillation with a fake LLM.
- `test/client-render.test.mjs` — renders the client half to HTML with a matched
  react / react-dom pair and asserts the real branches.

No test depends on any machine-specific path: the manuscript tree is generated into a temp
directory by `test/fixtures.mjs` and deleted afterwards. When no react pair is available the
render suite prints a skip notice and exits 0 (`npm install`, or `DSH_REACT_ROOT=<dir>`).

## License

MIT. Third-party attributions in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## Credits

- The anti-"AI prose" checklist in `skills/novel-writing` is adapted from
  [dsh-novel-solo](https://github.com/Tkingxiao/dsh-novel-solo) (MIT, Copyright (c) 2026 Tkingxiao).
- Built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
  (MIT, Copyright (c) 2026 DeepSeek): public slots, client services and the LLM service are used;
  no source is copied. The one-shot auxiliary model call follows the published pattern of the
  in-tree `dsh-session-title-llm` package.
- Package layout follows the community collection
  [linxiecoder/deepseek-harness-plugins](https://github.com/linxiecoder/deepseek-harness-plugins)
  so that `dsh plugin add` works out of the box.
- "Turn reasoning off for structured output" is documented in official Discussion
  [#6857](https://github.com/deepseek-ai/deepseek-harness/discussions/6857) — we hit the same wall
  on real hardware.

Full list and license texts: [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
