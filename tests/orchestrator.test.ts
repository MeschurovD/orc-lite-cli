import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadConfig, saveConfig } from '../src/core/config.js'
import { runQueue, runAllQueues } from '../src/core/orchestrator.js'

const FIXTURES = new URL('./fixtures', import.meta.url).pathname

// ─── Dry-run E2E: runQueue ────────────────────────────────────────────────────
// These tests run against the actual orc-lite-cli repo (a real git repo),
// using dry-run mode so no opencode or git mutations happen.

const REPO_DIR = new URL('..', import.meta.url).pathname

describe('runQueue dry-run', () => {
  let tmpDir: string
  let configPath: string
  let tasksDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'orc-e2e-'))
    configPath = join(tmpDir, 'orc-lite.config.json')
    tasksDir = join(tmpDir, 'tasks')
    mkdirSync(tasksDir)

    // Write a task file
    writeFileSync(join(tasksDir, 'task1.md'), '# Fix something\n\nDo the thing.')
    writeFileSync(join(tasksDir, 'task2.md'), '# Another task\n\nDo another thing.')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns result with pending tasks listed', async () => {
    writeFileSync(configPath, JSON.stringify({
      target_branch: 'main',
      tasks_dir: tasksDir,
      logs_dir: join(tmpDir, 'logs'),
      adapter_options: {},
      push: 'none',
      max_retries: 0,
      on_failure: 'stop',
      queues: [{
        name: 'test-queue',
        status: 'pending',
        tasks: [
          { file: 'task1.md', status: 'pending' },
          { file: 'task2.md', status: 'pending' },
        ],
      }],
    }))

    const result = await runQueue({
      configPath,
      cwd: REPO_DIR,
      dryRun: true,
    })

    expect(result.totalTasks).toBe(2)
    expect(result.doneTasks).toBe(0)
    expect(result.stoppedReason).toBeUndefined()
  })

  it('skips done tasks in dry-run', async () => {
    writeFileSync(configPath, JSON.stringify({
      target_branch: 'main',
      tasks_dir: tasksDir,
      logs_dir: join(tmpDir, 'logs'),
      adapter_options: {},
      push: 'none',
      max_retries: 0,
      on_failure: 'stop',
      queues: [{
        name: 'test-queue',
        status: 'pending',
        tasks: [
          { file: 'task1.md', status: 'done' },
          { file: 'task2.md', status: 'pending' },
        ],
      }],
    }))

    const result = await runQueue({
      configPath,
      cwd: REPO_DIR,
      dryRun: true,
    })

    expect(result.totalTasks).toBe(2)
    expect(result.doneTasks).toBe(1)
  })

  it('selects queue by explicit index', async () => {
    writeFileSync(configPath, JSON.stringify({
      target_branch: 'main',
      tasks_dir: tasksDir,
      logs_dir: join(tmpDir, 'logs'),
      adapter_options: {},
      push: 'none',
      max_retries: 0,
      on_failure: 'stop',
      queues: [
        { name: 'done-queue', status: 'done', tasks: [{ file: 'task1.md', status: 'done' }] },
        { name: 'pending-queue', status: 'pending', tasks: [{ file: 'task2.md', status: 'pending' }] },
      ],
    }))

    const result = await runQueue({
      configPath,
      queueIndex: 1,
      cwd: REPO_DIR,
      dryRun: true,
    })

    expect(result.totalTasks).toBe(1)
  })

  it('returns done immediately when all queues are done', async () => {
    const { config } = loadConfig(join(FIXTURES, 'all-done.json'))
    saveConfig(configPath, config)

    const result = await runQueue({
      configPath,
      cwd: REPO_DIR,
      dryRun: true,
    })

    expect(result.totalTasks).toBe(0)
    expect(result.doneTasks).toBe(0)
  })

  it('throws on invalid queue index', async () => {
    writeFileSync(configPath, JSON.stringify({
      target_branch: 'main',
      tasks_dir: tasksDir,
      logs_dir: join(tmpDir, 'logs'),
      adapter_options: {},
      push: 'none',
      max_retries: 0,
      on_failure: 'stop',
      queues: [{
        name: 'q',
        status: 'pending',
        tasks: [{ file: 'task1.md', status: 'pending' }],
      }],
    }))

    await expect(
      runQueue({ configPath, queueIndex: 5, cwd: REPO_DIR, dryRun: true }),
    ).rejects.toThrow('out of range')
  })
})

// ─── Dry-run E2E: runAllQueues ────────────────────────────────────────────────

describe('runAllQueues dry-run', () => {
  let tmpDir: string
  let configPath: string
  let tasksDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'orc-e2e-'))
    configPath = join(tmpDir, 'orc-lite.config.json')
    tasksDir = join(tmpDir, 'tasks')
    mkdirSync(tasksDir)
    writeFileSync(join(tasksDir, 'task1.md'), '# T1')
    writeFileSync(join(tasksDir, 'task2.md'), '# T2')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('processes all pending queues', async () => {
    writeFileSync(configPath, JSON.stringify({
      target_branch: 'main',
      tasks_dir: tasksDir,
      logs_dir: join(tmpDir, 'logs'),
      adapter_options: {},
      push: 'none',
      max_retries: 0,
      on_failure: 'stop',
      queues: [
        { name: 'q1', status: 'pending', tasks: [{ file: 'task1.md', status: 'pending' }] },
        { name: 'q2', status: 'pending', tasks: [{ file: 'task2.md', status: 'pending' }] },
      ],
    }))

    // Should not throw
    await expect(
      runAllQueues({ configPath, cwd: REPO_DIR, dryRun: true }),
    ).resolves.toBeUndefined()
  })

  it('skips already done queues', async () => {
    writeFileSync(configPath, JSON.stringify({
      target_branch: 'main',
      tasks_dir: tasksDir,
      logs_dir: join(tmpDir, 'logs'),
      adapter_options: {},
      push: 'none',
      max_retries: 0,
      on_failure: 'stop',
      queues: [
        { name: 'done-q', status: 'done', tasks: [{ file: 'task1.md', status: 'done' }] },
        { name: 'pending-q', status: 'pending', tasks: [{ file: 'task2.md', status: 'pending' }] },
      ],
    }))

    await expect(
      runAllQueues({ configPath, cwd: REPO_DIR, dryRun: true }),
    ).resolves.toBeUndefined()
  })
})

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('Edge cases', () => {
  let tmpDir: string
  let configPath: string
  let tasksDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'orc-edge-'))
    configPath = join(tmpDir, 'orc-lite.config.json')
    tasksDir = join(tmpDir, 'tasks')
    mkdirSync(tasksDir)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('dry-run handles missing task files gracefully (shows ✗)', async () => {
    // Task file does NOT exist — dry-run should show error but not throw
    writeFileSync(configPath, JSON.stringify({
      target_branch: 'main',
      tasks_dir: tasksDir,
      logs_dir: join(tmpDir, 'logs'),
      adapter_options: {},
      push: 'none',
      max_retries: 0,
      on_failure: 'stop',
      queues: [{
        name: 'q',
        status: 'pending',
        tasks: [{ file: 'nonexistent.md', status: 'pending' }],
      }],
    }))

    const result = await runQueue({
      configPath,
      cwd: REPO_DIR,
      dryRun: true,
    })

    // Dry-run returns result even if file is missing (shows warning in output)
    expect(result.totalTasks).toBe(1)
  })

  it('dry-run respects context_files listing', async () => {
    writeFileSync(join(tasksDir, 'task.md'), '# Task')
    writeFileSync(configPath, JSON.stringify({
      target_branch: 'main',
      tasks_dir: tasksDir,
      logs_dir: join(tmpDir, 'logs'),
      adapter_options: {},
      push: 'none',
      max_retries: 0,
      on_failure: 'stop',
      queues: [{
        name: 'q',
        status: 'pending',
        tasks: [{
          file: 'task.md',
          status: 'pending',
          context_files: ['package.json'],
          stages: ['implement', 'verify'],
        }],
      }],
    }))

    const result = await runQueue({
      configPath,
      cwd: REPO_DIR,
      dryRun: true,
    })

    expect(result.totalTasks).toBe(1)
  })
})
