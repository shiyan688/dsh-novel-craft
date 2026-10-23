# dsh-novel-craft

[中文](../README.md) · [First-use guide (Chinese)](./getting-started.md) · [npm](https://www.npmjs.com/package/dsh-novel-craft) · [Issues](https://github.com/shiyan688/dsh-novel-craft/issues)

**A local DeepSeek Harness plugin for Chinese fiction writers who keep correcting the same stylistic problems in AI drafts.**

Mark passages you like or dislike. The plugin asks your configured model to propose reusable writing rules; only rules you explicitly adopt enter your editable preference profile. Later drafts use that profile alongside the scene brief and story context.

This is prompt-based feedback, **not model training or fine-tuning**. Whether the rules reduce editing work must be tested on your own new scenes. The project has no published evidence of improved writing quality or user retention and does not promise automatic improvement.

## Start with a small comparison

> **Release status:** the published npm version is 0.3.0. Quick trial mode, the visible preference source, and improved cross-scene profile selection described below are unreleased source changes. Installing the current npm package does not include them. Use a source checkout containing these changes to try them.

1. Open the workbench, confirm the book directory, and choose Chapters → New chapter. Describe a concrete scene; a complete outline is optional.
2. Keep **Quick trial** selected: compare two directions, each targeting about **500 Chinese characters**. Actual length and latency depend on the model.
3. Generate candidates, then open the passage picker. Use `G` to like, `B` to dislike, and Space to clear a mark. A few clear judgments are enough to start; every paragraph need not be marked.
4. Distill rules and adopt only those you agree with. Next time, use a different scene and check the displayed preference source before generating. Compare usable passages and editing time.

Uncheck Quick trial to use the book's full chapter length and choose 2–16 directions. Trial filenames are marked separately from full candidates. Writing a final chapter still requires an explicit action.

## Installation

Requires **Node.js 22 or newer, DeepSeek Harness with a working model route, and a local book directory**. The plugin is MIT licensed and free; your model service may charge for calls. No API key or inference credits are included.

Published package:

```bash
dsh plugin --profile web add dsh-novel-craft
```

Source installation:

```bash
git clone https://github.com/shiyan688/dsh-novel-craft.git
cd dsh-novel-craft
npm install
dsh plugin --profile web add <absolute-path-to-checkout>
```

Restart dsh after installing or updating. Source-only features require a branch that contains the changes. The workbench appears at the bottom of the sidebar.

To inspect the UI first, download [preview.html](./preview.html) and open it in a browser. It is a component-rendered interactive snapshot, not a hosted model demo.

## Capabilities

- Paragraph feedback, proposed rules, explicit adoption, editable profiles and rule provenance.
- Direction-first candidate drafting, progress display and saving each completed candidate.
- Annotation-scoped revision with before/after comparison, validation and backups.
- Chapter management, character and setting notes, summaries and budgeted writing packs.
- Merging selected passages with explicit transition gaps for the writer to resolve.
- Local ledger, foreshadowing and pacing checks, plus manuscript-stage checklists.

The full-book workflow remains available; trying the style loop does not require completing every stage first.

## Data and model boundaries

Drafts, feedback, evidence and profiles are stored locally with the book or candidate directory. The project does not provide cloud storage. **When you use a model feature, its inputs go to the model service configured in dsh**, under that service's data policies.

Preference profiles contain rules rather than marked quotations. Writing packs include the task, preferences, summaries, settings, characters and plot information with a default 9,000-character budget. For continuity, they may include up to 900 characters from the preceding chapter's ending. “No manuscript text ever reaches a model” is not a promise this project makes.

| Model operation | Manuscript text that may be sent |
|---|---|
| Directions / candidates | Previous chapter ending inside the writing pack, up to 900 characters |
| Rule distillation | Up to 40 marked passages × 240 characters, total input budget up to 20KB |
| Source backfill | Evidence quotations, up to 160 characters each |
| Annotation revision | Up to 20 marked passages, 800 characters each, plus 80 characters from each adjacent passage |
| Stage drafting | Upstream planning artifacts, up to 4,000 characters each; manuscript prose is not an upstream artifact |

Merging, chapter dashboards and local checks do not call a model. See [DEVELOPMENT.md](../DEVELOPMENT.md) for implementation constraints.

## FAQ

**Who is it for?** Writers with a concrete Chinese fiction task who want to compare drafts and retain control over style decisions. The UI supports Chinese and English; the writing constraints focus on Chinese prose.

**Is it a standalone app?** No. It requires dsh, Node.js and a working model. There is no hosted trial or bundled inference service.

**Does it automatically finish a novel?** It generates directions, candidates and drafts. Selection, fact checking, transitions and final approval remain the writer's work. There are no guarantees of publication, platform acceptance or commercial results.

**Which preference file does a new scene use?** Unreleased source scans the current book and its corresponding run directories within a bounded search, choosing the most recently updated profile with actual content. Empty scaffolds do not hide adopted rules. Profiles are not automatically merged; the UI shows the source, and the writing pack shows the content used.

**Why is the next draft still wrong?** The inferred rule may be wrong, the model may not follow it, or it may only fit the original scene. Check the adopted rules and source, then test a different scene. Repeating the original task alone does not establish transfer.

**What if no text is generated?** Check that the default dsh model works, or configure `distillProvider` / `distillModel`. Empty candidate replies return an error without overwriting an existing candidate. Use Node 22 or newer; some dsh versions exit silently on Node 20.

**Do tests prove better prose?** No. Seven test files cover persistence, APIs, rendered components and workflows; model-dependent tests use a substitute. Compatibility smoke tests check host loading and routes. Real writing quality, cost and repeated use need writer evaluation.

**Do plot checks understand the whole book?** They primarily inspect strings and structured records locally. They cannot guarantee detection of semantic contradictions, repetition or every unresolved plot thread.

## Development and references

```bash
npm install
npm test
node scripts/build-preview.mjs
node scripts/check-dsh-compat.mjs latest
```

[Development guide](../DEVELOPMENT.md) · [Taste calibration workflow](../skills/taste-calibration/SKILL.md) · [Writing constraints](../skills/novel-writing/SKILL.md) · [Project facts](../llms.txt) · [Releases](https://github.com/shiyan688/dsh-novel-craft/releases) · [Compatibility runs](https://github.com/shiyan688/dsh-novel-craft/actions/workflows/compat.yml)

MIT licensed. Built for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Parts of the Chinese writing checklist derive from [dsh-novel-solo](https://github.com/Tkingxiao/dsh-novel-solo). Full attribution and license texts: [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
