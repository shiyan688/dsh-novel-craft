# dsh-novel-craft

[![npm](https://img.shields.io/npm/v/dsh-novel-craft?color=blue)](https://www.npmjs.com/package/dsh-novel-craft)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](../LICENSE)
[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-ff7a45)](https://github.com/topics/dsh-plugin)

**Purpose: make an AI write prose that sounds right to *you*.**

**Method: you only tap 👍 or 👎 — the model does the summarising.**

Tap while you read a round of candidate drafts. Then let the model turn those taps into a handful of lines you can actually follow, stored in one file. The next draft carries that file; you tap again, it summarises again. What it produces looks like this (my own file):

```
## 已验证偏好（作者喜欢什么）   what the author likes
- 让在场群像先静默再爆响        let the crowd go silent first, then erupt
## 避免的写法（作者不喜欢什么）  what to avoid
- 不要用比喻堆砌来写人群的恐惧   don't pile up metaphors for a crowd's fear
```

I didn't write those. I tapped them out. Each one has an 「🔍 Evidence」 button showing which passages it was summarised from — anything you disagree with, delete it.

**The file holds rules and nothing else — not one quote.** That is what makes the method work at all: a round of raw text is thousands of characters, and two rounds fill the context. Rules are a few hundred bytes (mine is 714), so they ride along in every drafting call — and the model remembers *how to write*, not *what those sentences looked like*. The former transfers to a new chapter; the latter just gets copied. So it can keep going round after round, **getting closer to your taste each time**.

**Why we built it**

Because both of the obvious routes are exhausting.

**Write better prompts.** "Don't be so heavy-handed" means nothing to it. So you iterate, you tune — and the next conversation, you start over.

**Write critiques, paragraph by paragraph.** A round is eight to ten drafts, two or three thousand characters each. Then you're supposed to say what's good. You can't; you just know "this one feels right." What you can squeeze out — "more delicate," "good pacing," "a bit forced" — translates back into writing as nothing at all, and by round three it has the same problem in new words.

The short version: **judging is easy, articulating is hard.** Tapping takes a second; explaining what you want, you can do ten times, not a hundred. So don't make yourself articulate — let the model summarise.

---

## Install

```bash
dsh plugin --profile web add dsh-novel-craft
```

Restart dsh once afterwards (the host half loads at startup). A 「🎴 抽卡工作台」 entry appears at the bottom of the sidebar.

Not ready to install? Open [`docs/preview.html`](./preview.html) in a browser — a static snapshot rendered from the real components, all seven tabs.

---

## Using it

### 1. Tap one round, it learns one round

Pick a folder holding draft variants (the picker recommends folders, remembers recent ones, and browses — you never type a path). Then read, with the keyboard:

`j`/`k` paragraph · `G` good · `B` bad · `Space` clear · `n`/`p` next/previous draft

Then press 「⚗️ Distill rules」. It turns that batch of taps into lines you tick one by one; only the ticked ones enter the file. **You never have to write a sentence** — but you can always veto what it got wrong.

That's the whole ritual. One round at a time.

### 2. Write the next chapter (it writes the candidates too)

「🗂 Chapters」 → 「✍️ New chapter」. Four steps.

**Say what the chapter must do** — number, chapter brief (goals, must-happen, must-not-happen), how many directions (10 by default).

**Pick directions.** You get 8–12 *scene-decision* directions. Note what they are not: ten rewordings. They change **how the story is told**:

```
A 保守精修   conservative polish: keep the skeleton, tighten the details
B 配角识货   the sidekick appraises first: the protagonist's calculation hides in his silence
C 双层信息差 double information gap: the shopkeeper is scheming too
```

Rename them, rewrite them, untick what you don't want — only the ticked ones get written. This step matters: ask for "ten versions" and you get ten drafts with different adjectives and identical decisions, which is no choice at all.

**Draft them, one at a time.** Each piece is saved the moment it finishes (`第13章-A-保守精修.txt`, your naming habit). You see "3/10", you can stop midway, one failure only affects that piece. Then 「🎴 Go pick passages」 switches the card pool to that fresh folder — and you're back at step one: read, tap, tap.

**Merge into a final draft.** The passages you marked 👍 are listed in manuscript order with the reason you wrote for each. Where two candidates don't join up, it inserts a `〔needs transition〕` marker — **it does not write that for you.** Those seams are exactly where prose stops being either thing, and they're yours. Writing into the manuscript backs up the previous version.

### 3. Revise — and it can only touch what you flagged

Click a paragraph, press `A`, leave a note (AI-tone / wordy / emotion stated outright / flat / out of character / logic-ledger / information gap / other, plus a line of your own — you *can* write here, because pointing at one spot is far cheaper than writing a general critique, and you're saying "this is wrong" rather than explaining "what I want").

「Revise by notes」 rewrites **only the annotated paragraphs**. Two guards:

1. The model is handed those paragraphs and nothing else — it has no access to the rest.
2. Afterwards every paragraph is compared character by character. If an unannotated paragraph differs by one character, or the paragraph count changed, write-back is **refused**.

You see a per-paragraph before/after before accepting, and the original is backed up. The old horror story — flag three spots, get a rewritten chapter in someone else's voice — is closed off.

### 4. See the whole book

At 100k+ words, "where did it sag?" isn't something memory can answer. The plot tab gives you a tension curve (click 1–5 to rate it yourself; estimated points are dashed, each stating its reasoning), outline drift, unpaid setups, chapter-length imbalance, event density, score decline.

Plus a stages tab: idea → setting → cast → outline → chapters → revise → finish, with the artifacts each step needs and one-click drafting.

---

## The line I don't cross: only the rules reach the writing context

This is the foundation of the "keeps learning" claim above, not a purism:

- When drafting (or asking for directions, or writing candidates), the model receives one **writing pack**, which contains no chapter text except **the previous chapter's ending** (≤900 characters, required for continuity, and labelled as such inside the pack).
- The passages you tapped, the evidence file, your notes — all of it stays local. You can go back and check any of it. Drafting never reads it.
- So the context holds a few hundred bytes of rules plus the recap and setting it genuinely needs. That's what makes carrying your taste from round to round affordable.

But I won't overstate it. Three buttons you press yourself do send raw text to one auxiliary call, each with a hard cap:

| Button | What goes in | Cap |
|---|---|---|
| Distill rules | the passages you tapped | ≤40 × 240 chars, ≤20KB |
| Backfill sources | quotes from the evidence file | 160 chars each |
| Revise by notes | annotated paragraphs + 80 chars of each neighbour | 800 chars each, ≤20 per run |

No other code path feeds manuscript text to a model. I used to write "raw text never enters a model context" — that was overstated, since "backfill sources" does send quotes and my copy didn't say so. The caps are listed now, **because a promise should be verifiable line by line.**

The **writing pack** is the only file a drafting session should read. Ten sections: chapter brief · author rules · previous chapter's ending · recap (from your chapter summaries, not the manuscripts) · cast · item/buff ledger · plot nodes · unpaid setups · anti-AI-tone list · requirements.

Every section has a cap; the whole pack defaults to a 9,000-character budget. When it must trim, it cuts what can be recovered first and reports **which section was cut and by how much**, with a fixed "do not read these into context" list at the end (evidence file, marks, notes, merged manuscript).

---

## What it deliberately doesn't do

- **It won't write your prose.** It writes candidates and first passes; choosing and fixing is yours. Design premise, not modesty.
- **It won't "read your whole book with AI."** That's the line above, so the plot checks are local string statistics — they cannot detect semantic repetition. That's the cost, and I accept it.
- **No cover art, typesetting, publishing or scraping**, and no promise about platform review.
- **It won't decide your pacing.** The tension curve takes your ratings; estimates are dashed lines for reference.

---

## Is it any good?

**775 assertions across 7 test files**, each capability covered with real-data cases (no browser, no running dsh needed). The tests assert how an author actually uses it: the revision test requires "only the annotated paragraph changed, every other paragraph is byte-identical"; the new-chapter test requires "the previous manuscript is backed up before writing."

Before 0.2.0 I had three independent passes over the host half, the browser half, and the promise above. **Four high-severity findings were reproduced before being fixed**, and each reproduction became a regression test:

- chunked requests silently turned CJK characters in the manuscript into replacement characters (measured: 2 per 40,000-char chapter)
- holding `G` to mark quickly made marks overwrite each other (measured: 5 concurrent marks, 1 survived)
- a hand-written profile file was replaced by an empty skeleton, losing every rule
- an unvalidated save path allowed writing outside the book directory

The first two never raise an error. They just quietly lose things — which is why each now has a test standing over it.

Details in [`DEVELOPMENT.md`](../DEVELOPMENT.md) (read before changing the code) and the commit history.

---

## Compatibility

dsh is a set of independently versioned packages — in one public release the CLI can be `0.1.5-rc.2` while the client runtime is still `0.1.1-rc.2`. So this plugin pins nothing: peer dependencies are `*`, resolved from your profile at runtime.

Verified working: `0.1.0-rc.7` (the author's daily driver), `0.1.2-rc.1`, `0.1.5-rc.1` (`latest`), `0.1.5-rc.2` (`next`), `0.1.6-alpha.1`.

```bash
node scripts/check-dsh-compat.mjs next    # or latest / alpha / a specific version
```

It installs a real copy of that dsh in a temp directory, wires the plugin in the profile way, boots it with an isolated `DSH_HOME`, then asserts the host routes answer, the client half is in the manifest, and the half is delivered correctly. It cleans up after itself and never touches your running instance.

> **dsh ≥ 0.1.5 needs Node 22.** On Node 20, `dsh web` exits silently — no output, no listening port — which looks exactly like "the plugin is incompatible." The compat script finds Node 22 itself and treats a boot failure on older Node as an environment problem, not a compatibility failure.

Two traps for plugin authors: **a row's `apply` can run before services are mounted** (`ctx.get('webServer')` is `undefined` in a synchronous `apply`; this plugin uses `ctx.inject` plus a timeout), and **the client bundle URL changed** (newer dsh serves a combined script `/plugins/??a/client.js,b/client.js&rev=…`).

---

## Credits

- The **anti-AI-tone checklist** (six dimensions, `skills/novel-writing`) is adapted from [dsh-novel-solo](https://github.com/Tkingxiao/dsh-novel-solo) (MIT, Copyright (c) 2026 Tkingxiao)
- Runs on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (MIT): it uses the platform's public slots, client services and LLM service, and copies none of its source; the auxiliary model call follows the publicly visible shape of `dsh-session-title-llm`
- The insight that **reasoning effort must be turned off** for compression tasks came from Discussion [#6857](https://github.com/deepseek-ai/deepseek-harness/discussions/6857) — we hit the same wall: the model thought a great deal and left no prose at all
- Package layout follows the community collection [linxiecoder/deepseek-harness-plugins](https://github.com/linxiecoder/deepseek-harness-plugins) so `dsh plugin add` works directly

Full list and license texts: [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

---

<details>
<summary><b>For the curious: where files land, the API, the layout</b></summary>

### Where files land

| File | What it is | Enters context? |
|---|---|---|
| `写作包.md` (in the round directory, else `.dsh-novel-craft/写作包/`) | the only file a drafting session should read | ✅ |
| `.dsh-novel-craft/作者偏好档案.md` | rules only | ✅ |
| `.dsh-novel-craft/证据摘录.md` | the raw text you tapped | ❌ only on 「Distill」/「Backfill」 |
| `.dsh-novel-craft/marks.json` | machine-readable good/bad | ❌ same |
| `.dsh-novel-craft/批注/第N章.json` | your revision notes | ❌ only on 「Revise」, and only the annotated paragraphs |
| `.dsh-novel-craft/章节设定/第N章.md` | chapter goals / must-not-happen / cast | ✅ as pack section 1 |
| `.dsh-novel-craft/规则来源.json` | rule → evidence mapping | ❌ UI lookup only |
| `.dsh-novel-craft/微调/` | before/after, pending rewrite, backups | ❌ human-facing |
| `.dsh-novel-craft/取用理由.json` | why each picked passage was picked | ❌ |
| `.dsh-novel-craft/workspace.json` | stage progress, hand-rated tension | ❌ |
| `候选稿/`, `定稿候选/`, `筛选与合并记录.md` | candidates, merged draft, pick record | ❌ (pack only, when drafting) |

Marks travel with the book; the candidate directory lives in dsh settings under the `dsh-novel-craft` namespace.

### How rules are produced

You tap good/bad → `marks.json` → 「Update evidence」 files the raw text into `证据摘录.md` → 「Distill」 sends the pending text (≤40 × 240 chars, ≤20KB) to **one** auxiliary call whose system prompt forbids quoting and requires two sections (`喜欢：` / `避免：`) → the result does **not** enter the profile directly; you tick what you agree with, and the watermark advances so it isn't sent again.

- Model route: the dsh default unless you set `distillProvider` / `distillModel` in the plugin settings
- Don't want any model touching your text? Skip 「Distill」 and hand `证据摘录.md` to your own agent — only the rules reach the profile either way
- The auto block (`auto:begin`/`auto:end`) is bookkeeping, rewritten each time; the rules section is yours and is never touched
- Anything you hand-write is rendered as-is, never hidden or overwritten

### Some deliberate interaction choices

- **Reading, not a spreadsheet**: candidates are continuous prose (15.5px / 1.95 line-height) with a 3px colour bar on the left. Most paragraphs need no marking, so buttons surface only on the cursor or hovered paragraph
- **Hands stay on the keyboard**: `G`/`B` advance automatically; keyboard marking is idempotent; shortcuts yield while you type in a field
- **You always know where you are**: the footer reads "7 / 28" plus shortcuts; candidate chips show short label + length + marks in that piece, with the shared prefix (`第9章-`) stripped
- **Rules can be rejected one at a time**: each has an ✕ (bookkeeping lines can't be deleted)
- **First run** shows a three-step hint that disappears after the first tap

### Host HTTP API (loopback only)

Under `/novel-craft/api/`, serving `127.0.0.1` only; everything returns 503 when `enabled: false`. There are 23 routes; the main ones:

| Method | Path | Purpose |
|---|---|---|
| GET | `state` | candidates + marks + profile + evidence info + pending count + model route |
| POST | `marks` / `evidence` / `distill` / `rules` / `profile` | the tapping loop's writes |
| GET | `discover` | recommended folders (with draft counts, 5s cache) |
| GET/POST | `project` | detect / confirm the book root |
| GET | `workspace` | chapter board (**no chapter text**) |
| POST | `chapter` / `setup` | one chapter's detail, chapter brief |
| POST | `annotation` | add/update/remove notes |
| POST | `pack` | build the writing pack (`save:false` previews) |
| POST | `revise` / `revise-apply` | generate a revision / accept it (backup first; refuses on failed verification) |
| POST | `tension` / `check` | hand-rated tension / ledger + plot checks |
| POST | `stage` | stage status / draft / write an artifact |
| POST | `newchapter` | `status` / `directions` / `draft` / `merge` / `finalize` |
| GET/POST | `rule-evidence` | rule sources; `action:'backfill'` fills old profiles |

### What takes effect when

- **Browser half**: read per request (`no-cache`) — **refresh the page**
- **Host half**: loaded at dsh startup — **restart dsh**

### Tests

```bash
npm install
npm test        # 7 files, 775 assertions
```

Individual: `node test/workbench.test.mjs`, `node test/ledger.test.mjs`, `node test/plot.test.mjs`, `node test/pipeline.test.mjs`.

No test depends on a machine-specific path: the book fixture is built in a temp directory by `test/fixtures.mjs`, all writes stay there, and everything is cleaned up. On a fresh clone without dependencies the render tests print "skipped" instead of a wall of red.

### Layout

```
dsh-novel-craft-plugin/
├── package.json         # dsh.bundle.patch + dsh.client.platform=web
├── cordis.patch.yml      # inserts the plugin row into the profile composition
├── lib/index.js         # host half: settings + 23 loopback routes + model calls
├── lib/client.js        # browser half: the workbench (seven tabs, no JSX)
├── lib/core/            # ten modules sharing only text.js
│   ├── text.js          #   segmentation, safe IO, chapter parsing, write queue + atomic writes
│   ├── workspace.js     #   book-root detection, chapter board, cast, round dirs
│   ├── pack.js          #   writing pack + context budget
│   ├── annotate.js      #   notes + revision assembly and character-exact verification
│   ├── ledger.js        #   item/buff ledger parsing + checks
│   ├── plot.js          #   tension curve + unpaid setups + plot diagnostics
│   ├── pipeline.js      #   seven stages, artifact checks, gates, drafting prompts
│   ├── provenance.js    #   rule → evidence
│   ├── draft.js         #   new chapter: directions, candidates, merge, finalisation
│   └── llm.js           #   one-shot model calls (shared by all six call sites)
├── test/                # 7 test files
├── DEVELOPMENT.md       # read before changing code (not in the npm package)
└── LICENSE, THIRD_PARTY_NOTICES.md
```

</details>
