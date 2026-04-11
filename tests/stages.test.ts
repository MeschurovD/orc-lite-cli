import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseVerifyOutput } from '../src/core/stages/verify.js'

// ─── parseVerifyOutput ────────────────────────────────────────────────────────

describe('parseVerifyOutput', () => {
  it('parses new format (approved/score/reason/short_summary/full_summary/issues)', () => {
    const json = JSON.stringify({
      approved: true,
      score: 92,
      reason: null,
      short_summary: 'Looks good',
      full_summary: 'Full detailed review',
      issues: [],
    })
    const result = parseVerifyOutput(json)
    expect(result).not.toBeNull()
    expect(result!.approved).toBe(true)
    expect(result!.score).toBe(92)
    expect(result!.reason).toBeNull()
    expect(result!.short_summary).toBe('Looks good')
    expect(result!.full_summary).toBe('Full detailed review')
    expect(result!.issues).toHaveLength(0)
  })

  it('parses new format embedded in surrounding text', () => {
    const output = `Here is my review:\n${JSON.stringify({
      approved: false,
      score: 45,
      reason: 'Missing error handling',
      short_summary: 'Incomplete',
      full_summary: 'Details here',
      issues: ['No tests', 'No error handling'],
    })}\nDone.`
    const result = parseVerifyOutput(output)
    expect(result).not.toBeNull()
    expect(result!.approved).toBe(false)
    expect(result!.score).toBe(45)
    expect(result!.issues).toHaveLength(2)
  })

  it('converts legacy format (ready/score/summary/issues) to new shape', () => {
    const json = JSON.stringify({
      ready: true,
      score: 80,
      summary: 'All requirements met',
      issues: ['Minor: missing docs'],
    })
    const result = parseVerifyOutput(json)
    expect(result).not.toBeNull()
    expect(result!.approved).toBe(true)
    expect(result!.score).toBe(80)
    expect(result!.short_summary).toBe('All requirements met')
    expect(result!.full_summary).toBe('All requirements met')
    expect(result!.reason).toBeNull() // ready: true → reason null
    expect(result!.issues).toContain('Minor: missing docs')
  })

  it('legacy not-ready sets reason from summary', () => {
    const json = JSON.stringify({
      ready: false,
      score: 30,
      summary: 'Failed to implement feature X',
      issues: ['Missing feature X'],
    })
    const result = parseVerifyOutput(json)
    expect(result).not.toBeNull()
    expect(result!.approved).toBe(false)
    expect(result!.reason).toBe('Failed to implement feature X')
  })

  it('returns null for plain text output (no JSON)', () => {
    const result = parseVerifyOutput('Everything looks good! Great work.')
    expect(result).toBeNull()
  })

  it('returns null for broken JSON', () => {
    const result = parseVerifyOutput('{ "approved": true, "score": }')
    expect(result).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseVerifyOutput('')).toBeNull()
  })

  it('handles new format with issues list', () => {
    const json = JSON.stringify({
      approved: false,
      score: 55,
      reason: 'too many issues',
      short_summary: 'Needs work',
      full_summary: 'Long review...',
      issues: ['Issue A', 'Issue B', 'Issue C'],
    })
    const result = parseVerifyOutput(json)
    expect(result!.issues).toHaveLength(3)
    expect(result!.issues[0]).toBe('Issue A')
  })

  it('prefers new format over legacy when both keys present', () => {
    // JSON with "approved" should take the new-format path first
    const json = JSON.stringify({
      approved: true,
      score: 99,
      reason: null,
      short_summary: 'new',
      full_summary: 'new full',
      issues: [],
      ready: false, // legacy key also present — should be ignored
    })
    const result = parseVerifyOutput(json)
    expect(result!.approved).toBe(true)
    expect(result!.score).toBe(99)
  })
})

// ─── runVerifyStage — threshold and on_fail ───────────────────────────────────
// We mock the opencode adapter to avoid spawning real processes.

vi.mock('../src/adapters/opencode-adapter.js', () => ({
  createAdapter: vi.fn(),
}))

import { createAdapter } from '../src/adapters/opencode-adapter.js'
import { runVerifyStage } from '../src/core/stages/verify.js'
import { runTestStage } from '../src/core/stages/test.js'
import type { StageContext } from '../src/core/stages/index.js'
import type { OrcLiteConfig, TaskDefinition } from '../src/types.js'

function makeContext(overrides: Partial<StageContext> = {}): StageContext {
  return {
    task: { file: 'task.md', status: 'pending' } as TaskDefinition,
    taskIndex: 0,
    config: {
      tasks_dir: 'tasks',
      logs_dir: '.logs',
      adapter_options: {},
      git_strategy: 'none',
    } as unknown as OrcLiteConfig,
    stageConfig: undefined,
    workingDir: '/tmp/fake-work-dir',
    log: {
      step: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
      raw: vi.fn(),
      openCodexFrame: vi.fn(),
      closeCodexFrame: vi.fn(),
      close: vi.fn(),
      teeStream: { write: vi.fn() } as any,
      fileStream: undefined,
    } as any,
    implementOutput: 'impl output',
    gitDiff: 'diff text',
    taskContent: '# Task\n\nDo X',
    ...overrides,
  }
}

function mockAdapter(adapterResult: object) {
  vi.mocked(createAdapter).mockReturnValue({
    execute: vi.fn().mockResolvedValue(adapterResult),
    isInstalled: vi.fn().mockResolvedValue(true),
  } as any)
}

describe('runVerifyStage — threshold logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns success when approved=true and score >= threshold (default 80)', async () => {
    const output = JSON.stringify({
      approved: true, score: 85, reason: null,
      short_summary: 'LGTM', full_summary: 'All good', issues: [],
    })
    mockAdapter({ success: true, exitCode: 0, durationMs: 1000, output })

    const result = await runVerifyStage(makeContext())
    expect(result.success).toBe(true)
    expect(result.score).toBe(85)
  })

  it('returns failure when score < threshold even if approved=true', async () => {
    const output = JSON.stringify({
      approved: true, score: 70, reason: null,
      short_summary: 'Almost', full_summary: 'Almost there', issues: [],
    })
    mockAdapter({ success: true, exitCode: 0, durationMs: 1000, output })

    const result = await runVerifyStage(makeContext())
    expect(result.success).toBe(false)
    expect(result.score).toBe(70)
  })

  it('returns failure when approved=false even if score >= threshold', async () => {
    const output = JSON.stringify({
      approved: false, score: 90, reason: 'wrong approach',
      short_summary: 'Rejected', full_summary: 'Bad design', issues: ['wrong approach'],
    })
    mockAdapter({ success: true, exitCode: 0, durationMs: 1000, output })

    const result = await runVerifyStage(makeContext())
    expect(result.success).toBe(false)
  })

  it('respects custom threshold from stageConfig', async () => {
    const output = JSON.stringify({
      approved: true, score: 60, reason: null,
      short_summary: 'OK', full_summary: 'OK full', issues: [],
    })
    mockAdapter({ success: true, exitCode: 0, durationMs: 1000, output })

    const ctx = makeContext({ stageConfig: { threshold: 50 } })
    const result = await runVerifyStage(ctx)
    expect(result.success).toBe(true) // 60 >= 50
  })

  it('on_fail=continue returns success=true even when score below threshold', async () => {
    const output = JSON.stringify({
      approved: false, score: 20, reason: 'bad',
      short_summary: 'Bad', full_summary: 'Very bad', issues: ['issue1'],
    })
    mockAdapter({ success: true, exitCode: 0, durationMs: 1000, output })

    const ctx = makeContext({ stageConfig: { on_fail: 'continue' } })
    const result = await runVerifyStage(ctx)
    expect(result.success).toBe(true) // on_fail=continue
  })

  it('returns failure when opencode exits with non-zero', async () => {
    mockAdapter({ success: false, exitCode: 1, durationMs: 500, output: '' })

    const result = await runVerifyStage(makeContext())
    expect(result.success).toBe(false)
    expect(result.score).toBeUndefined()
  })

  it('treats unparseable output as score=0, approved=false → failure', async () => {
    mockAdapter({ success: true, exitCode: 0, durationMs: 1000, output: 'No JSON here' })

    const result = await runVerifyStage(makeContext())
    expect(result.success).toBe(false)
    expect(result.score).toBe(0)
  })

  it('reports timeout error message when exitCode=124', async () => {
    mockAdapter({ success: false, exitCode: 124, durationMs: 600000, output: '' })

    const ctx = makeContext()
    const result = await runVerifyStage(ctx)
    expect(result.success).toBe(false)
    // log.error should have been called with a timeout message
    expect((ctx.log.error as ReturnType<typeof vi.fn>).mock.calls.some(
      (args: unknown[]) => String(args[0]).includes('timed out'),
    )).toBe(true)
  })
})

// ─── runTestStage — on_fail logic ─────────────────────────────────────────────

describe('runTestStage — on_fail logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns success when opencode exits 0', async () => {
    mockAdapter({ success: true, exitCode: 0, durationMs: 2000, output: 'Tests written' })

    const result = await runTestStage(makeContext())
    expect(result.success).toBe(true)
    expect(result.name).toBe('test')
  })

  it('returns failure when opencode exits non-zero (default on_fail=stop)', async () => {
    mockAdapter({ success: false, exitCode: 1, durationMs: 500, output: '' })

    const result = await runTestStage(makeContext())
    expect(result.success).toBe(false)
  })

  it('on_fail=continue returns success=true even on adapter failure', async () => {
    mockAdapter({ success: false, exitCode: 1, durationMs: 500, output: '' })

    const ctx = makeContext({ stageConfig: { on_fail: 'continue' } })
    const result = await runTestStage(ctx)
    expect(result.success).toBe(true)
  })

  it('reports timeout in log when exitCode=124', async () => {
    mockAdapter({ success: false, exitCode: 124, durationMs: 600000, output: '' })

    const ctx = makeContext()
    await runTestStage(ctx)
    expect((ctx.log.error as ReturnType<typeof vi.fn>).mock.calls.some(
      (args: unknown[]) => String(args[0]).includes('timed out'),
    )).toBe(true)
  })
})
