import { buildPrompt, buildRetryImplementPrompt } from '../../adapters/prompt-builder.js'
import { createAdapter } from '../../adapters/opencode-adapter.js'
import type { StageResult } from '../../types.js'
import type { StageContext } from './index.js'

export async function runImplementStage(ctx: StageContext): Promise<StageResult> {
  const {
    task, config, workingDir, tasksDir, log,
    isRetry, verifyIssues, verifyReason, verifyScore, verifyRetryAttempt,
    implementOutput, gitDiff, taskContent,
  } = ctx
  const startTime = Date.now()

  let prompt: string
  if (isRetry && verifyIssues && verifyIssues.length > 0) {
    log.step('building retry prompt (verify feedback)')
    const verifyRetryConfig = config.stages?.verify
    prompt = buildRetryImplementPrompt({
      taskContent,
      implementOutput,
      gitDiff,
      verifyIssues,
      verifyReason,
      verifyScore,
      attempt: verifyRetryAttempt ?? 1,
      customTemplate: verifyRetryConfig?.retry_prompt_template,
    })
  } else {
    log.step('building prompt')
    prompt = buildPrompt({
      taskFile: task.file,
      tasksDir,
      systemPrompt: config.system_prompt,
      contextFiles: task.context_files,
      workingDir,
    })
  }
  log.raw(`\n  Prompt (${prompt.length} chars): ${prompt.slice(0, 120).replace(/\n/g, ' ')}…\n`)

  const timeout = config.adapter_options.timeout ?? 600
  log.step(`running opencode (timeout: ${timeout}s)`)
  log.openCodexFrame()

  const adapter = createAdapter(config.adapter_options)
  const adapterResult = await adapter.execute({
    prompt,
    workingDir,
    timeout,
    teeStream: log.teeStream,
    fullLogStream: log.fileStream,
  })

  log.closeCodexFrame()

  if (!adapterResult.success) {
    const error =
      adapterResult.exitCode === 124
        ? `timed out after ${timeout}s`
        : `opencode exited with code ${adapterResult.exitCode}`
    log.error(`opencode failed: ${error}`)
    return {
      name: 'implement',
      success: false,
      durationMs: Date.now() - startTime,
      output: adapterResult.output,
    }
  }

  const adapterDuration = Math.round(adapterResult.durationMs / 1000)
  log.success(`opencode done (${adapterDuration}s)`)

  return {
    name: 'implement',
    success: true,
    durationMs: Date.now() - startTime,
    output: adapterResult.output,
  }
}
