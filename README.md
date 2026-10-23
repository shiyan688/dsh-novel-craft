# dsh-novel-craft

[English](https://github.com/shiyan688/dsh-novel-craft/blob/main/docs/README.en.md) · [首次使用](https://github.com/shiyan688/dsh-novel-craft/blob/main/docs/getting-started.md) · [npm](https://www.npmjs.com/package/dsh-novel-craft) · [反馈](https://github.com/shiyan688/dsh-novel-craft/issues)

**给正在用 AI 写中文小说、却反复改同一种文风问题的作者。**

读候选稿时给段落点赞、点踩，插件将这些判断提炼成可编辑的写作规则。你逐条采纳，后续候选稿使用这份偏好档案。它是运行在 **DeepSeek Harness（dsh）** 上的本地开源插件，不是独立在线写作网站。

例如，你不必先说清“少一点解释感”：标出不喜欢的段落后，模型可能提议“人物做完动作后，不再补旁白解释动机”。认可才写入档案；不认可就改或删。

这是提示词层面的偏好反馈，**不是训练或微调模型**。规则是否减少修改，需要用你的新场景验证；本项目不承诺越用越好，也没有公开的留存或文风提升数据。

## 从一次短试写开始

> **版本说明：** npm 已发布版本为 0.3.0。本文的“快速试写”、偏好来源显示与跨场景档案选择改进属于待发布源码；普通 npm 安装目前不会获得这些改动。希望试用这些功能，请用下方源码安装方式。

1. 打开「抽卡工作台」→「章节」，确认作品根目录，点「开新章」。没有大纲也可以先写一个明确场景。
2. 保持「快速试写」勾选：选两个不同方向，每份候选目标约 **500 字**。实际篇幅与等待时间取决于模型。
3. 点「去抽卡选段」，只标出几处明确喜欢/不喜欢的段落：`G` 赞、`B` 踩、空格取消。不必逐段标满。
4. 点「提炼规律」，逐条采纳认同的规则。下一次打开「开新章」，换一个新场景，检查偏好来源，再比较可用段落与修改时间。

取消「快速试写」即可恢复作品设置中的完整章节篇幅，并自选 2–16 个方向。试写稿文件名带“试写”，与完整候选区分；写入正文仍需要你明确采纳。

详细操作、目录例子与第二次使用的检查方法见[首次使用指南](https://github.com/shiyan688/dsh-novel-craft/blob/main/docs/getting-started.md)。

## 安装

需要 **Node.js 22 或更高版本、已配置可用模型的 DeepSeek Harness，以及本地作品目录**。插件免费，模型服务可能收费。插件没有附送 API Key 或推理额度。

安装 npm 已发布版本：

```bash
dsh plugin --profile web add dsh-novel-craft
```

试用当前源码的待发布改动：

```bash
git clone https://github.com/shiyan688/dsh-novel-craft.git
cd dsh-novel-craft
npm install
```

然后用克隆目录的**绝对路径**安装：

```bash
dsh plugin --profile web add <克隆目录绝对路径>
```

安装或更新后重启一次 dsh，再打开网页。侧栏底部出现「抽卡工作台」。源码功能只有在相应改动合入你克隆的分支后才可用。

只看界面可以下载并在浏览器中打开 [docs/preview.html](https://github.com/shiyan688/dsh-novel-craft/blob/main/docs/preview.html)：它是组件渲染的交互快照，不会调用模型，也不是在线试用服务。

## 已有能力

| 任务 | 工作台提供什么 |
|---|---|
| 表达文风偏好 | 段落点赞/点踩、提炼提议、逐条采纳、可编辑档案与规则来源 |
| 比较不同写法 | 先选叙事方向，再生成候选；支持暂停，逐篇保存 |
| 控制改稿范围 | 按批注修改指定段落，前后对照，核对后写回并备份 |
| 管理连载 | 章节看板、人物与设定、前情摘要、写作包与上下文预算 |
| 选段定稿 | 合并已选段落，跨稿衔接标为待过渡，由作者处理 |
| 检查全书 | 本地台账、伏笔和节奏统计；立项到完本的产物检查 |

全书流程可以逐步使用。首次比较文风不需要先填完所有阶段。

## 数据与模型调用边界

候选稿、标注、证据和偏好文件保存在本地作品/候选目录；不上传到本项目的云端。**点击模型功能时，相关输入会发送给你在 dsh 配置的模型服务**，其数据处理规则由该服务决定。

偏好档案保存规则，不保存标注原句。写作包包含任务、规则、设定、摘要、人物、台账等，默认总预算为 9000 字符；为接续需要，另含上一章结尾，最多 900 字符。因此“所有正文永不发给模型”不是本项目的承诺。

| 模型功能 | 可能发送的正文 |
|---|---|
| 生成方向/候选 | 写作包内的上一章结尾，最多 900 字符 |
| 提炼规律 | 已标注段落，最多 40 段 × 240 字符，总预算不超过 20KB |
| 补齐规则来源 | 每条证据引文最多 160 字符 |
| 按批注微调 | 被批注段落每段最多 800 字符，前后段各 80 字符，单次最多 20 条 |
| 阶段起草 | 上游设定产物，每份最多 4000 字符；正文不作为上游输入 |

合并、章节看板、情节统计不调用模型。完整约束与实现入口见 [DEVELOPMENT.md](https://github.com/shiyan688/dsh-novel-craft/blob/main/DEVELOPMENT.md)。

## 常见问题

**适合谁？** 已有具体中文小说/网文任务，愿意读候选并做取舍的作者。第一次试写也可以用，但需要自己判断规则是否符合意图。

**是独立应用吗？** 不是。需要 dsh、Node.js 和可用模型路由。若你不打算安装这些依赖，目前不适合直接使用。

**能自动写完一本书吗？** 能生成方向、候选和初稿；选段、事实核对、衔接与最终定稿仍由作者完成。不保证出版、平台审核或商业成绩。

**为什么下一轮还不对味？** 规则可能提炼错、模型可能没有遵守，或者偏好只适用于原场景。先核对「开新章」显示的档案来源，再查看「写作包」中的规则。不要只在原题重试，应换场景比较。

**有多份档案怎么办？** 待发布源码会在当前作品及对应轮次目录中，有界查找最近更新且有实际内容的档案；空骨架不遮住已有规则。不自动合并不同档案，界面显示选用来源，可在写作包核对具体内容。

**模型没有输出/无法调用怎么办？** 先确认 dsh 默认模型能独立完成一次请求，或在插件设置中指定 `distillProvider` / `distillModel`。空候选不会覆盖已有稿件。Node 20 启动部分 dsh 版本可能静默退出，请用 Node 22 或更高版本。

**测试证明文风提升了吗？** 没有。现有 7 个测试文件覆盖数据保存、接口、组件渲染与工作流；模型部分使用替身。兼容冒烟检查宿主加载和路由。实际写作质量、成本和复用意愿需要真实作者验证。

**长篇检查会理解全文吗？** 情节体检主要是本地字符串与结构统计，不能保证发现语义矛盾、重复或所有伏笔问题。

## 开发、文档与来源

```bash
npm install
npm test
node scripts/build-preview.mjs
node scripts/check-dsh-compat.mjs latest
```

- [开发与数据安全约定](https://github.com/shiyan688/dsh-novel-craft/blob/main/DEVELOPMENT.md)
- [偏好校准工作流](https://github.com/shiyan688/dsh-novel-craft/blob/main/skills/taste-calibration/SKILL.md)
- [中文小说写作约束](https://github.com/shiyan688/dsh-novel-craft/blob/main/skills/novel-writing/SKILL.md)
- [机器可读项目摘要](https://github.com/shiyan688/dsh-novel-craft/blob/main/llms.txt)
- [发行记录](https://github.com/shiyan688/dsh-novel-craft/releases)与[兼容测试记录](https://github.com/shiyan688/dsh-novel-craft/actions/workflows/compat.yml)

MIT 许可。运行平台为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。中文写作约束部分改编自 [dsh-novel-solo](https://github.com/Tkingxiao/dsh-novel-solo)，完整归属和许可证见 [THIRD_PARTY_NOTICES.md](https://github.com/shiyan688/dsh-novel-craft/blob/main/THIRD_PARTY_NOTICES.md)。
