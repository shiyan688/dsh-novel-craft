/**
 * dsh-novel-craft — 通用的一次性模型调用
 *
 * 提炼规律、批注微调、阶段起草都用这条通道：一次调用、流式收完、拼成纯文本。
 * 三个调用点共用它的理由不是省代码，而是**行为必须一致**：
 * - 都要能把 reasoningEffort 显式关掉（这是压缩/改写任务，思考链会吃光输出预算，
 *   症状是"模型想了一堆、正文一个字都没有"）；
 * - 都要能把"被截断/被中止"这两种结束原因带回来，让上层给出人话错误；
 * - 都要在模型不认这个推理档位时自动退一步重试，而不是直接把作者卡住。
 *
 * 惰性加载平台的 LLM 包：一旦将来某个 dsh 版本改名/拆包，只有"用模型"的那几个按钮
 * 会报错，标注、写作包、看板这些本地能力照常可用。
 */
export const LLM_DEFAULTS = {
  maxTokens: 2400,
  timeoutMs: 120000,
  reasoningEffort: 'off',
}

let llmModule
export async function loadLlmModule() {
  if (llmModule === undefined) {
    llmModule = await import('@deepseek-ai/dsh-llm').catch(() => null)
  }
  return llmModule
}

/**
 * 走哪条模型路由：设置里指定了就用它，否则用 dsh 当前的默认模型。
 * 没配置又不认默认模型时返回 null，由上层给出"去哪填"的提示。
 */
export function resolveRoute(ctx, config) {
  const provider = String((config === undefined ? {} : config).provider ?? '').trim()
  const model = String((config === undefined ? {} : config).model ?? '').trim()
  if (provider !== '' && model !== '') return { provider, model }
  const fallback = ctx.get('agentDefaultModel')
  if (fallback !== undefined && typeof fallback.currentSelection === 'function') {
    let selection
    try {
      selection = fallback.currentSelection()
    } catch {
      selection = undefined // 读不到默认模型就当作没有路由
    }
    const chosenProvider = selection === null || selection === undefined ? '' : String(selection.provider ?? '').trim()
    const chosenModel = selection === null || selection === undefined ? '' : String(selection.model ?? '').trim()
    if (chosenProvider !== '' && chosenModel !== '') return { provider: chosenProvider, model: chosenModel }
  }
  return null
}

/**
 * 一次性的辅助模型调用：流式收完，拼成纯文本。
 * @returns { text, finish } —— finish 用来区分"正常结束"和"被截断/报错"
 */
export async function callModel(llm, route, request) {
  const dshLlm = await loadLlmModule()
  if (dshLlm === null || typeof dshLlm.BlockAssembler !== 'function') {
    throw new Error('这个 dsh 的 @deepseek-ai/dsh-llm 不可用（版本不兼容？）：本地能力照常可用，这一步改用别的模型手动做')
  }
  const { BlockAssembler, createUserMessage, deepFreeze } = dshLlm
  const options = (withEffort) =>
    deepFreeze({
      provider: route.provider,
      model: route.model,
      system: request.system,
      messages: [
        createUserMessage({
          content: [{ type: 'text', text: request.user }],
          source: { kind: 'plugin', plugin: 'dsh-novel-craft' },
        }),
      ],
      maxTokens: Number.isInteger(request.maxTokens) ? request.maxTokens : LLM_DEFAULTS.maxTokens,
      signal: AbortSignal.timeout(Number.isInteger(request.timeoutMs) ? request.timeoutMs : LLM_DEFAULTS.timeoutMs),
      // 压缩/改写任务不需要思考链；不关掉的话推理会吃掉输出预算，正文可能一个字都没有
      ...(withEffort ? { reasoningEffort: request.reasoningEffort ?? LLM_DEFAULTS.reasoningEffort } : {}),
    })

  const run = async (withEffort) => {
    const assembler = new BlockAssembler()
    for await (const chunk of llm.stream(options(withEffort))) assembler.push(chunk)
    const finish = assembler.finish
    if (finish !== undefined && finish !== null && (finish.kind === 'error' || finish.kind === 'aborted')) {
      throw new Error(`模型调用失败：${finish.failure === undefined ? '未知错误' : String(finish.failure.message)}`)
    }
    const text = assembler
      .blocks()
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
    return { text, finish: finish === undefined || finish === null ? 'stop' : finish.kind }
  }

  try {
    return await run(true)
  } catch (error) {
    // 换到不认这个推理档位的模型时，退一步再试一次（别的错误照抛）
    const message = error instanceof Error ? error.message : String(error)
    if (!/reasoning effort/i.test(message)) throw error
    return await run(false)
  }
}

/** 把结束原因翻译成人话，供上层拼错误提示。 */
export function finishReason(finish, text) {
  if (finish === 'max-tokens') return '模型输出被长度上限截断'
  if (String(text).trim() === '') return '模型只输出了思考、没有正文'
  return ''
}
