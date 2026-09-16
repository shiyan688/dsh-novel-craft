# 第三方声明（Third-Party Notices）

本仓库（`dsh-novel-craft`）包含或改编了以下第三方开源内容。
除下列条目外，`lib/` 下两个半区的代码都是本项目自己写的。

## 1. dsh-novel-solo — 禁AI腔清单（文字改编）

- 来源：https://github.com/Tkingxiao/dsh-novel-solo
- 协议：MIT License
- 版权：Copyright (c) 2026 Tkingxiao
- **使用范围**：`skills/novel-writing/SKILL.md` 中的「一、禁AI腔（六维度判定）」清单，
  改编自该项目 persona 预设的「禁AI腔」章节（句式模板 / 词汇套话 / 情绪直给 / 结构套路 /
  节奏与信息 / 视角与术语 六类判定）。
- 说明：这是**文字内容**的改编引用，不涉及代码；该 skill 文件内也写了同一行出处。

## 2. DeepSeek Harness（dsh）— 运行平台

- 来源：https://github.com/deepseek-ai/deepseek-harness
- 协议：MIT License
- 版权：Copyright (c) 2026 DeepSeek
- **使用方式（未复制其源码）**：
  - 作为插件运行在 dsh 上：`dsh.bundle.patch` 向组合树插入一行宿主插件，`dsh.client` 提供浏览器半区；
  - 目录浏览调用平台自带的客户端服务 `ctx.workspaces.listDirectory`（宿主侧 `directoryPicker`
    的 `browse` 能力），只走公开 RPC；
  - 面板挂在平台的公开插槽上（`sidebar.footer.action` / `shell.overlay`），配置走 `settingsScope`；
  - 「提炼规律」那一步的一次性辅助模型调用，写法参考了平台内 `@deepseek-ai/dsh-session-title-llm`
    的公开实现（`ctx.llm.stream` + `BlockAssembler` + 关闭推理），没有拷贝其代码。
- 平台及其组成包均为 MIT，故本项目整体以 MIT 发布是兼容的。

## 3. Cordis — 组合运行时（依赖，非改编）

- 来源：https://github.com/cordiverse/cordis
- dsh 的插件运行时。本项目把 `@deepseek-ai/cordis`、`@deepseek-ai/schemastery`、
  `@deepseek-ai/dsh-llm` 一并声明为 peer dependency，运行时从部署侧的 profile 解析，
  不重复安装、不复制源码。

## 4. 社区约定（致谢，非代码来源）

- 包布局（`package.json` 的 `dsh.bundle` / `dsh.client` / `exports["./client"]` 与
  `cordis.patch.yml` 的组合方式）遵循社区集合仓库
  [linxiecoder/deepseek-harness-plugins](https://github.com/linxiecoder/deepseek-harness-plugins)
  里既有插件的写法，这样 `dsh plugin --profile web add` 能直接装。只是约定，未复制其代码。

## 5. 实践参考

- 官方 Discussion [#6857](https://github.com/deepseek-ai/deepseek-harness/discussions/6857)
  「插件里调模型做结构化输出，请默认把推理关掉——推理 token 和正文共用一份预算」。
  本项目在真机上踩过同一个坑（提炼接口 5.6 秒返回、解析出 0 条规律），修法与这条笔记一致
  （`reasoningEffort: 'off'` + 抬高输出预算）。记在这里，算是这个坑的一个真实案例。

---

## MIT License（dsh-novel-solo 原文）

```
MIT License

Copyright (c) 2026 Tkingxiao

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
