import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  loadConfig,
  saveConfig,
  updateTaskStatus,
  updateQueueStatus,
  getTaskBranchName,
  renderCommitMessage,
} from '../src/core/config.js'

const FIXTURES = new URL('./fixtures', import.meta.url).pathname

// ─── loadConfig ───────────────────────────────────────────────────────────────

describe('loadConfig', () => {
  it('loads queues format', () => {
    const { config } = loadConfig(join(FIXTURES, 'basic-queues.json'))
    expect(config.queues).toHaveLength(2)
    expect(config.queues[0]!.name).toBe('first')
    expect(config.queues[0]!.tasks).toHaveLength(2)
    expect(config.queues[1]!.schedule).toBe('2026-12-01 02:30')
  })

  it('converts legacy tasks format to default queue', () => {
    const { config } = loadConfig(join(FIXTURES, 'legacy-tasks.json'))
    expect(config.queues).toHaveLength(1)
    expect(config.queues[0]!.name).toBe('default')
    expect(config.queues[0]!.tasks).toHaveLength(2)
    expect(config.queues[0]!.tasks[0]!.file).toBe('legacy1.md')
  })

  it('throws if file does not exist', () => {
    expect(() => loadConfig('/nonexistent/path/orc-lite.config.json'))
      .toThrow('Config file not found')
  })

  it('throws on invalid JSON', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'orc-test-'))
    const badPath = join(tmpDir, 'bad.json')
    writeFileSync(badPath, 'not valid json')

    try {
      expect(() => loadConfig(badPath)).toThrow('Failed to parse config file')
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('throws on missing required fields', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'orc-test-'))
    const badPath = join(tmpDir, 'bad.json')
    writeFileSync(badPath, JSON.stringify({ queues: [{ tasks: [{ file: 'a.md', status: 'pending' }] }] }))

    try {
      expect(() => loadConfig(badPath)).toThrow('Invalid config')
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('throws if neither queues nor tasks present', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'orc-test-'))
    const badPath = join(tmpDir, 'bad.json')
    writeFileSync(badPath, JSON.stringify({
      target_branch: 'main',
      tasks_dir: 'tasks',
      logs_dir: '.logs',
      adapter_options: {},
      push: 'none',
      max_retries: 0,
    }))

    try {
      expect(() => loadConfig(badPath)).toThrow('must have either "queues" or "tasks"')
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('applies defaults for push and max_retries', () => {
    const { config } = loadConfig(join(FIXTURES, 'basic-queues.json'))
    expect(config.push).toBe('none')
    expect(config.max_retries).toBe(0)
  })
})

// ─── saveConfig ───────────────────────────────────────────────────────────────

describe('saveConfig / loadConfig roundtrip', () => {
  let tmpDir: string
  let tmpPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'orc-test-'))
    tmpPath = join(tmpDir, 'orc-lite.config.json')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('saves and reloads config correctly', () => {
    const { config } = loadConfig(join(FIXTURES, 'basic-queues.json'))
    saveConfig(tmpPath, config)

    const { config: reloaded } = loadConfig(tmpPath)
    expect(reloaded.queues).toHaveLength(2)
    expect(reloaded.queues[0]!.tasks[0]!.file).toBe('task1.md')
  })

  it('written file ends with newline', () => {
    const { config } = loadConfig(join(FIXTURES, 'basic-queues.json'))
    saveConfig(tmpPath, config)

    const raw = readFileSync(tmpPath, 'utf-8')
    expect(raw.endsWith('\n')).toBe(true)
  })
})

// ─── updateTaskStatus ─────────────────────────────────────────────────────────

describe('updateTaskStatus', () => {
  let tmpDir: string
  let tmpPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'orc-test-'))
    tmpPath = join(tmpDir, 'orc-lite.config.json')
    const { config } = loadConfig(join(FIXTURES, 'basic-queues.json'))
    saveConfig(tmpPath, config)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('updates task status in queues format', () => {
    updateTaskStatus(tmpPath, 0, 0, {
      status: 'done',
      completed_at: '2026-04-09T10:00:00.000Z',
    })

    const { config } = loadConfig(tmpPath)
    expect(config.queues[0]!.tasks[0]!.status).toBe('done')
    expect(config.queues[0]!.tasks[0]!.completed_at).toBe('2026-04-09T10:00:00.000Z')
  })

  it('updates task status in legacy tasks format', () => {
    // Write legacy format directly
    const raw = readFileSync(join(FIXTURES, 'legacy-tasks.json'), 'utf-8')
    writeFileSync(tmpPath, raw)

    updateTaskStatus(tmpPath, 0, 0, { status: 'in_progress', started_at: '2026-04-09T08:00:00.000Z' })

    const updated = JSON.parse(readFileSync(tmpPath, 'utf-8')) as { tasks: Array<{ status: string }> }
    expect(updated.tasks[0]!.status).toBe('in_progress')
  })
})

// ─── updateQueueStatus ────────────────────────────────────────────────────────

describe('updateQueueStatus', () => {
  let tmpDir: string
  let tmpPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'orc-test-'))
    tmpPath = join(tmpDir, 'orc-lite.config.json')
    const { config } = loadConfig(join(FIXTURES, 'basic-queues.json'))
    saveConfig(tmpPath, config)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('updates queue status', () => {
    updateQueueStatus(tmpPath, 0, 'done')

    const { config } = loadConfig(tmpPath)
    expect(config.queues[0]!.status).toBe('done')
    expect(config.queues[1]!.status).toBe('pending') // others untouched
  })

  it('no-op for legacy tasks format (no queue-level status)', () => {
    const raw = readFileSync(join(FIXTURES, 'legacy-tasks.json'), 'utf-8')
    writeFileSync(tmpPath, raw)

    expect(() => updateQueueStatus(tmpPath, 0, 'done')).not.toThrow()
  })
})

// ─── getTaskBranchName ────────────────────────────────────────────────────────

describe('getTaskBranchName', () => {
  it('uses explicit branch if set', () => {
    const name = getTaskBranchName({ file: 'task.md', status: 'pending', branch: 'feat/custom' })
    expect(name).toBe('feat/custom')
  })

  it('derives branch from file path without .md', () => {
    const name = getTaskBranchName({ file: 'my-task.md', status: 'pending' })
    expect(name).toBe('task/my-task')
  })

  it('replaces special chars with dashes', () => {
    const name = getTaskBranchName({ file: 'tasks/feat/my task.md', status: 'pending' })
    expect(name).toBe('task/tasks-feat-my-task')
  })
})

// ─── renderCommitMessage ──────────────────────────────────────────────────────

describe('renderCommitMessage', () => {
  const vars = { task_name: 'auth-cleanup', task_file: 'auth-cleanup.md', first_line: 'Fix auth', index: 1, total: 5 }

  it('uses default template if none provided', () => {
    const msg = renderCommitMessage(undefined, vars)
    expect(msg).toBe('task: auth-cleanup')
  })

  it('interpolates all placeholders', () => {
    const tmpl = '{{task_name}} ({{index}}/{{total}}) — {{first_line}}'
    const msg = renderCommitMessage(tmpl, vars)
    expect(msg).toBe('auth-cleanup (1/5) — Fix auth')
  })

  it('replaces all occurrences (not just first)', () => {
    const msg = renderCommitMessage('{{task_name}} / {{task_name}}', vars)
    expect(msg).toBe('auth-cleanup / auth-cleanup')
  })
})
