import { buildTestPrompt } from '../../adapters/prompt-builder.js'
import { createAdapter } from '../../adapters/opencode-adapter.js'
import type { StageResult } from '../../types.js'
import type { StageContext } from './index.js'

export async function runTestStage(ctx: StageContext): Promise<StageResult> {
  const { config, workingDir, log, stageConfig, implementOutput, gitDiff, taskContent } = ctx
  const startTime = Date.now()

  const onFail = stageConfig?.on_fail ?? 'stop'

  log.step('test: building prompt')
  const prompt = buildTestPrompt(
    taskContent,
    implementOutput || '(нет вывода реализации)',
    gitDiff || '(нет изменений)',
    stageConfig?.prompt_template,
  )

  const timeout = stageConfig?.timeout ?? config.adapter_options.timeout ?? 600
  log.step(`test: running opencode (timeout: ${timeout}s)`)
  log.openCodexFrame()

  const adapterOptions = stageConfig?.model
    ? { ...config.adapter_options, model: stageConfig.model }
    : config.adapter_options
  const adapter = createAdapter(adapterOptions)
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
    log.error(`test: opencode failed: ${error}`)

    if (onFail === 'continue') {
      log.raw(`  test: failed, but on_fail=continue — proceeding`)
      return {
        name: 'test',
        success: true,
        durationMs: Date.now() - startTime,
        output: adapterResult.output,
      }
    }

    return {
      name: 'test',
      success: false,
      durationMs: Date.now() - startTime,
      output: adapterResult.output,
    }
  }

  const adapterDuration = Math.round(adapterResult.durationMs / 1000)
  log.success(`test: opencode done (${adapterDuration}s)`)

  return {
    name: 'test',
    success: true,
    durationMs: Date.now() - startTime,
    output: adapterResult.output,
  }
}
