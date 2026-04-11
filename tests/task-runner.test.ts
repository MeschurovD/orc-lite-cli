import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../src/adapters/opencode-adapter.js', () => ({
  createAdapter: vi.fn(),
}))

vi.mock('../src/services/git.js', () => ({
  GitService: vi.fn(),
}))

// Mock logger so tests don't produce output
vi.mock('../src/services/logger.js', () => ({
  pipelineLogger: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    separator: vi.fn(),
  },
  createTaskLogger: vi.fn().mockReturnValue({
    step: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    raw: vi.fn(),
    openCodexFrame: vi.fn(),
    closeCodexFrame: vi.fn(),
    close: vi.fn(),
    teeStream: { write: vi.fn() },
    fileStream: undefined,
  }),
}))

// Mock notifier
vi.mock('../src/services/notifier.js', () => ({
  createNotifier: vi.fn().mockReturnValue(null),
}))

// Mock config updaters to avoid file I/O
vi.mock('../src/core/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/config.js')>()
  return {
    ...actual,
    updateTaskStatus: vi.fn(),
    updateQueueStatus: vi.fn(),
  }
})

import { createAdapter } from '../src/adapters/opencode-adapter.js'
import { GitService } from '../src/services/git.js'
import { runTask } from '../src/core/task-runner.js'
import type { OrcLiteConfig, TaskDefinition } from '../src/types.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<OrcLiteConfig> = {}): OrcLiteConfig {
  return {
    target_branch: 'main',
    tasks_dir: 'tasks',
    logs_dir: '.logs',
    on_failure: 'stop',
    adapter_options: {},
    push: 'none',
    git_strategy: 'none',  // no git operations by default in tests
    max_retries: 0,
    queues: [],
    ...overrides,
  } as OrcLiteConfig
}

function makeTask(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    file: 'task.md',
    status: 'pending',
    ...overrides,
  }
}

function mockAdapter(result: { success: boolean; exitCode: number; output?: string; durationMs?: number }) {
  vi.mocked(createAdapter).mockReturnValue({
    execute: vi.fn().mockResolvedValue({
      durationMs: 1000,
      output: '',
      ...result,
    }),
    isInstalled: vi.fn().mockResolvedValue(true),
  } as any)
}

function mockGit(overrides: Partial<{
  hasChanges: boolean
  getDiff: string
  getCurrentBranch: string
}> = {}) {
  const mockInstance = {
    checkoutBranch: vi.fn().mockResolvedValue(undefined),
    branchExists: vi.fn().mockResolvedValue(false),
    createAndCheckoutBranch: vi.fn().mockResolvedValue(undefined),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    hasChanges: vi.fn().mockResolvedValue(overrides.hasChanges ?? false),
    getDiff: vi.fn().mockResolvedValue(overrides.getDiff ?? ''),
    stageAndCommit: vi.fn().mockResolvedValue(undefined),
    mergeBranch: vi.fn().mockResolvedValue({ success: true, conflict: false }),
    pushBranch: vi.fn().mockResolvedValue(undefined),
    getCurrentBranch: vi.fn().mockResolvedValue(overrides.getCurrentBranch ?? 'main'),
    ensureGitRepo: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockResolvedValue({ isClean: () => true, files: [] }),
  }
  vi.mocked(GitService).mockImplementation(function() { return mockInstance } as any)
  return mockInstance
}

// ─── Setup ────────────────────────────────────────────────────────────────────

let tmpDir: string
let tasksDir: string
let configPath: string

beforeEach(() => {
  vi.clearAllMocks()
  tmpDir = mkdtempSync(join(tmpdir(), 'orc-task-runner-'))
  tasksDir = join(tmpDir, 'tasks')
  mkdirSync(tasksDir)
  writeFileSync(join(tasksDir, 'task.md'), '# Fix something\n\nDo the thing.')
  configPath = join(tmpDir, 'orc-lite.config.json')
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

// ─── Single-stage implement ───────────────────────────────────────────────────

describe('runTask — single stage implement', () => {
  it('returns success=true when opencode exits 0', async () => {
    mockGit()
    mockAdapter({ success: true, exitCode: 0, output: 'Done' })

    const result = await runTask(
      makeTask(), 0, 0,
      makeConfig({ tasks_dir: tasksDir, logs_dir: join(tmpDir, 'logs') }),
      configPath, tmpDir, 1, null,
    )

    expect(result.success).toBe(true)
    expect(result.status).toBe('done')
  })

  it('returns success=false when opencode exits non-zero', async () => {
    mockGit()
    mockAdapter({ success: false, exitCode: 1, output: 'Error occurred' })

    const result = await runTask(
      makeTask(), 0, 0,
      makeConfig({ tasks_dir: tasksDir, logs_dir: join(tmpDir, 'logs') }),
      configPath, tmpDir, 1, null,
    )

    expect(result.success).toBe(false)
    expect(result.status).toBe('failed')
  })

  it('retries on failure up to max_retries', async () => {
    mockGit()
    const executeMock = vi.fn()
      .mockResolvedValueOnce({ success: false, exitCode: 1, durationMs: 100, output: '' })
      .mockResolvedValueOnce({ success: false, exitCode: 1, durationMs: 100, output: '' })
      .mockResolvedValueOnce({ success: true,  exitCode: 0, durationMs: 100, output: 'done' })

    vi.mocked(createAdapter).mockReturnValue({
      execute: executeMock,
      isInstalled: vi.fn().mockResolvedValue(true),
    } as any)

    const result = await runTask(
      makeTask(), 0, 0,
      makeConfig({ tasks_dir: tasksDir, logs_dir: join(tmpDir, 'logs'), max_retries: 2 }),
      configPath, tmpDir, 1, null,
    )

    expect(result.success).toBe(true)
    expect(executeMock).toHaveBeenCalledTimes(3)
  })

  it('returns failed after exhausting all retries', async () => {
    mockGit()
    mockAdapter({ success: false, exitCode: 1, output: '' })

    const result = await runTask(
      makeTask(), 0, 0,
      makeConfig({ tasks_dir: tasksDir, logs_dir: join(tmpDir, 'logs'), max_retries: 2 }),
      configPath, tmpDir, 1, null,
    )

    expect(result.success).toBe(false)
    expect(result.status).toBe('failed')
    expect(vi.mocked(createAdapter)().execute).toHaveBeenCalledTimes(3)
  })
})

// ─── Multi-stage pipeline ─────────────────────────────────────────────────────

describe('runTask — multi-stage pipeline', () => {
  it('runs implement then verify; returns success when both pass', async () => {
    mockGit()

    const verifyJson = JSON.stringify({
      approved: true, score: 90, reason: null,
      short_summary: 'LGTM', full_summary: 'All good', issues: [],
    })

    const executeMock = vi.fn()
      .mockResolvedValueOnce({ success: true, exitCode: 0, durationMs: 1000, output: 'impl done' })
      .mockResolvedValueOnce({ success: true, exitCode: 0, durationMs: 1000, output: verifyJson })

    vi.mocked(createAdapter).mockReturnValue({
      execute: executeMock,
      isInstalled: vi.fn().mockResolvedValue(true),
    } as any)

    const result = await runTask(
      makeTask({ stages: ['implement', 'verify'] }), 0, 0,
      makeConfig({ tasks_dir: tasksDir, logs_dir: join(tmpDir, 'logs') }),
      configPath, tmpDir, 1, null,
    )

    expect(result.success).toBe(true)
    expect(executeMock).toHaveBeenCalledTimes(2)
  })

  it('stops pipeline when verify fails (score below threshold)', async () => {
    mockGit()

    const verifyJsonFail = JSON.stringify({
      approved: false, score: 40, reason: 'incomplete',
      short_summary: 'Fail', full_summary: 'Not done', issues: ['missing X'],
    })

    const executeMock = vi.fn()
      .mockResolvedValueOnce({ success: true, exitCode: 0, durationMs: 1000, output: 'impl done' })
      .mockResolvedValueOnce({ success: true, exitCode: 0, durationMs: 1000, output: verifyJsonFail })

    vi.mocked(createAdapter).mockReturnValue({
      execute: executeMock,
      isInstalled: vi.fn().mockResolvedValue(true),
    } as any)

    const result = await runTask(
      makeTask({ stages: ['implement', 'verify'] }), 0, 0,
      makeConfig({ tasks_dir: tasksDir, logs_dir: join(tmpDir, 'logs') }),
      configPath, tmpDir, 1, null,
    )

    expect(result.success).toBe(false)
    expect(result.status).toBe('failed')
  })

  it('runs implement then test; returns success when both pass', async () => {
    mockGit()

    const executeMock = vi.fn()
      .mockResolvedValueOnce({ success: true, exitCode: 0, durationMs: 1000, output: 'impl done' })
      .mockResolvedValueOnce({ success: true, exitCode: 0, durationMs: 1000, output: 'tests written' })

    vi.mocked(createAdapter).mockReturnValue({
      execute: executeMock,
      isInstalled: vi.fn().mockResolvedValue(true),
    } as any)

    const result = await runTask(
      makeTask({ stages: ['implement', 'test'] }), 0, 0,
      makeConfig({ tasks_dir: tasksDir, logs_dir: join(tmpDir, 'logs') }),
      configPath, tmpDir, 1, null,
    )

    expect(result.success).toBe(true)
    expect(executeMock).toHaveBeenCalledTimes(2)
  })
})

// ─── git_strategy ─────────────────────────────────────────────────────────────

describe('runTask — git_strategy', () => {
  it('git_strategy=none: does not call checkoutBranch or createAndCheckoutBranch', async () => {
    const git = mockGit()
    mockAdapter({ success: true, exitCode: 0, output: 'done' })

    await runTask(
      makeTask(), 0, 0,
      makeConfig({ tasks_dir: tasksDir, logs_dir: join(tmpDir, 'logs'), git_strategy: 'none' }),
      configPath, tmpDir, 1, null,
    )

    expect(git.checkoutBranch).not.toHaveBeenCalled()
    expect(git.createAndCheckoutBranch).not.toHaveBeenCalled()
  })

  it('git_strategy=branch: checkouts target branch and creates task branch', async () => {
    const git = mockGit()
    mockAdapter({ success: true, exitCode: 0, output: 'done' })

    await runTask(
      makeTask(), 0, 0,
      makeConfig({
        tasks_dir: tasksDir,
        logs_dir: join(tmpDir, 'logs'),
        git_strategy: 'branch',
        target_branch: 'main',
      }),
      configPath, tmpDir, 1, null,
    )

    expect(git.checkoutBranch).toHaveBeenCalledWith('main')
    expect(git.createAndCheckoutBranch).toHaveBeenCalled()
  })

  it('git_strategy=commit: commits changes but does not create branches', async () => {
    const git = mockGit({ hasChanges: true })
    mockAdapter({ success: true, exitCode: 0, output: 'done' })

    await runTask(
      makeTask(), 0, 0,
      makeConfig({
        tasks_dir: tasksDir,
        logs_dir: join(tmpDir, 'logs'),
        git_strategy: 'commit',
      }),
      configPath, tmpDir, 1, null,
    )

    expect(git.checkoutBranch).not.toHaveBeenCalled()
    expect(git.stageAndCommit).toHaveBeenCalled()
  })
})

// ─── Verification command ──────────────────────────────────────────────────────

describe('runTask — verification_cmd', () => {
  it('succeeds when verification_cmd exits 0', async () => {
    mockGit()
    mockAdapter({ success: true, exitCode: 0, output: 'done' })

    const result = await runTask(
      makeTask({ verification_cmd: 'true' }), 0, 0,
      makeConfig({ tasks_dir: tasksDir, logs_dir: join(tmpDir, 'logs') }),
      configPath, tmpDir, 1, null,
    )

    expect(result.success).toBe(true)
  })

  it('fails when verification_cmd exits non-zero', async () => {
    mockGit()
    mockAdapter({ success: true, exitCode: 0, output: 'done' })

    const result = await runTask(
      makeTask({ verification_cmd: 'false' }), 0, 0,
      makeConfig({ tasks_dir: tasksDir, logs_dir: join(tmpDir, 'logs') }),
      configPath, tmpDir, 1, null,
    )

    expect(result.success).toBe(false)
    expect(result.status).toBe('failed')
  })

  it('inherits verification_cmd from config when not set on task', async () => {
    mockGit()
    mockAdapter({ success: true, exitCode: 0, output: 'done' })

    const result = await runTask(
      makeTask(), 0, 0,
      makeConfig({
        tasks_dir: tasksDir,
        logs_dir: join(tmpDir, 'logs'),
        verification_cmd: 'true',
      }),
      configPath, tmpDir, 1, null,
    )

    expect(result.success).toBe(true)
  })
})
