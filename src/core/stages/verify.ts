import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { buildVerifyPrompt } from '../../adapters/prompt-builder.js'
import { createAdapter } from '../../adapters/opencode-adapter.js'
import type { StageResult } from '../../types.js'
import type { StageContext } from './index.js'

const DEFAULT_THRESHOLD = 80

export interface VerifyOutput {
  approved: boolean
  score: number
  reason: string | null
  short_summary: string
  full_summary: string
  issues: string[]
}

export function parseVerifyOutput(output: string): VerifyOutput | null {
  const newMatch = output.match(/\{[\s\S]*"approved"[\s\S]*"score"[\s\S]*\}/)
  if (newMatch) {
    try {
      return JSON.parse(newMatch[0]) as VerifyOutput
    } catch { /* fall through */ }
  }

  const oldMatch = output.match(/\{[\s\S]*"ready"[\s\S]*"score"[\s\S]*\}/)
  if (oldMatch) {
    try {
      const old = JSON.parse(oldMatch[0]) as { ready: boolean; score: number; summary: string; issues: string[] }
      return {
        approved: old.ready,
        score: old.score,
        reason: old.ready ? null : (old.summary ?? 'not approved'),
        short_summary: old.summary ?? '',
        full_summary: old.summary ?? '',
        issues: old.issues ?? [],
      }
    } catch { /* fall through */ }
  }

  return null
}

function appendFullSummaryToTaskFile(
  taskFilePath: string,
  score: number,
  threshold: number,
  approved: boolean,
  fullSummary: string,
): void {
  try {
    const existing = existsSync(taskFilePath) ? readFileSync(taskFilePath, 'utf-8') : ''
    const timestamp = new Date().toISOString()
    const approvedLabel = approved ? 'yes' : 'no'
    const appendix = [
      '',
      '---',
      '',
      `## Verify Review (${timestamp})`,
      '',
      `**Score**: ${score}/100 | **Approved**: ${approvedLabel}`,
      '',
      fullSummary,
    ].join('\n')
    writeFileSync(taskFilePath, existing + appendix, 'utf-8')
  } catch { /* non-blocking */ }
}

export async function runVerifyStage(ctx: StageContext): Promise<StageResult> {
  const { task, config, workingDir, tasksDir, log, stageConfig, implementOutput, gitDiff, taskContent } = ctx
  const startTime = Date.now()

  const threshold = stageConfig?.threshold ?? DEFAULT_THRESHOLD
  const onFail = stageConfig?.on_fail ?? 'stop'

  log.step('verify: building prompt')
  const prompt = buildVerifyPrompt(
    taskContent,
    implementOutput || '(нет вывода реализации)',
    gitDiff || '(нет изменений)',
    stageConfig?.prompt_template,
  )

  const timeout = stageConfig?.timeout ?? config.adapter_options.timeout ?? 600
  log.step(`verify: running opencode (timeout: ${timeout}s)`)
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
    log.error(`verify: opencode failed: ${error}`)
    return {
      name: 'verify',
      success: false,
      durationMs: Date.now() - startTime,
      output: adapterResult.output,
    }
  }

  const parsed = parseVerifyOutput(adapterResult.output ?? '')
  const score = parsed?.score ?? 0
  const approved = parsed?.approved ?? false
  const passed = approved && score >= threshold

  log.success(`verify: score ${score}/100 (threshold: ${threshold}) — ${passed ? 'PASSED' : 'FAILED'}`)
  if (parsed?.short_summary) {
    log.raw(`  Summary: ${parsed.short_summary}`)
  }
  if (parsed?.reason) {
    log.raw(`  Reason: ${parsed.reason}`)
  }
  if (parsed?.issues && parsed.issues.length > 0) {
    log.raw(`  Issues:`)
    for (const issue of parsed.issues) {
      log.raw(`    - ${issue}`)
    }
  }

  if (parsed?.full_summary) {
    const taskFilePath = resolve(workingDir, tasksDir, task.file)
    appendFullSummaryToTaskFile(taskFilePath, score, threshold, approved, parsed.full_summary)
  }

  let reviewFile: string | undefined
  if (!passed || (parsed?.issues && parsed.issues.length > 0)) {
    const taskName = task.file.replace(/\.md$/i, '')
    const logsDir = resolve(workingDir, config.logs_dir)
    mkdirSync(logsDir, { recursive: true })
    reviewFile = join(logsDir, `${taskName}-review.md`)

    const reviewContent = [
      `# Verify Review: ${task.file}`,
      ``,
      `**Score**: ${score}/100 (threshold: ${threshold})`,
      `**Status**: ${passed ? 'PASSED' : 'FAILED'}`,
      ``,
      `## Summary`,
      parsed?.short_summary ?? '(не удалось распарсить вывод)',
      ``,
      ...(parsed?.reason ? [`## Reason`, parsed.reason, ``] : []),
      `## Issues`,
      ...(parsed?.issues?.map((i) => `- ${i}`) ?? ['(нет)']),
      ``,
      `## Raw Output`,
      '```',
      (adapterResult.output ?? '').slice(0, 4000),
      '```',
    ].join('\n')

    writeFileSync(reviewFile, reviewContent, 'utf-8')
    log.raw(`  Review file: ${reviewFile}`)
  }

  if (!passed) {
    if (onFail === 'continue') {
      log.raw(`  verify: score below threshold or not approved, but on_fail=continue — proceeding`)
      return {
        name: 'verify',
        success: true,
        durationMs: Date.now() - startTime,
        output: adapterResult.output,
        score,
        reviewFile,
        shortSummary: parsed?.short_summary,
        fullSummary: parsed?.full_summary,
        issues: parsed?.issues,
        reason: parsed?.reason ?? undefined,
      }
    }
    if (onFail === 'retry') {
      log.raw(`  verify: failed — will retry implement with feedback`)
    } else {
      log.error(`verify: score ${score} below threshold ${threshold} or not approved — stopping`)
    }
    return {
      name: 'verify',
      success: false,
      durationMs: Date.now() - startTime,
      output: adapterResult.output,
      score,
      reviewFile,
      shortSummary: parsed?.short_summary,
      fullSummary: parsed?.full_summary,
      issues: parsed?.issues,
      reason: parsed?.reason ?? undefined,
    }
  }

  return {
    name: 'verify',
    success: true,
    durationMs: Date.now() - startTime,
    output: adapterResult.output,
    score,
    reviewFile,
    shortSummary: parsed?.short_summary,
    fullSummary: parsed?.full_summary,
    issues: parsed?.issues,
    reason: parsed?.reason ?? undefined,
  }
}
