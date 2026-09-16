# dsh-novel-craft — a gacha-style taste-calibration workbench for dsh

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
| `0.1.5-rc.2` (current npm `next`) | **A separate install plus an isolated DSH_HOME was booted**: the host half loaded and registered every route (`/state` → 200 with the full payload), the client half was picked up by the roster and served through the new combo-script URL (content identical to disk), and the plugin's own loopback routes are unaffected by the new token gate |

Known differences (harmless here, but worth knowing):

- **Newer dsh gates the web shell behind a token**: plain `http://127.0.0.1:<port>/` returns 401;
  use the `?token=…` URL printed at startup. Plugin routes are not gated.
- **The client bundle URL shape changed**: newer versions serve combo scripts
  (`/plugins/??a/client.js,b/client.js&rev=…`) instead of `/plugins/<id>/client.js`.

The host half loads `@deepseek-ai/dsh-llm` **lazily**, so a future rename or export change in
that package can only break the distillation step, never marking, evidence or the profile.

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
