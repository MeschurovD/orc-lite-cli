import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildPrompt, buildVerifyPrompt, buildTestPrompt } from '../src/adapters/prompt-builder.js'

// ─── buildPrompt ──────────────────────────────────────────────────────────────

describe('buildPrompt', () => {
  let tmpDir: string
  let tasksDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'orc-prompt-'))
    tasksDir = join(tmpDir, 'tasks')
    mkdirSync(tasksDir)
    writeFileSync(join(tasksDir, 'task.md'), '# Fix auth\n\nDo the thing.')
    writeFileSync(join(tasksDir, 'task2.md'), '# Another task')
    writeFileSync(join(tmpDir, 'ctx.md'), 'some context')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns task file content', () => {
    const prompt = buildPrompt({ taskFile: 'task.md', tasksDir, workingDir: tmpDir })
    expect(prompt).toContain('# Fix auth')
    expect(prompt).toContain('Do the thing.')
  })

  it('prepends systemPrompt when provided', () => {
    const prompt = buildPrompt({
      taskFile: 'task.md',
      tasksDir,
      workingDir: tmpDir,
      systemPrompt: 'You are a senior engineer.',
    })
    expect(prompt.startsWith('You are a senior engineer.')).toBe(true)
    expect(prompt).toContain('# Fix auth')
  })

  it('does not include system prompt header when not provided', () => {
    const prompt = buildPrompt({ taskFile: 'task.md', tasksDir, workingDir: tmpDir })
    expect(prompt.startsWith('# Fix auth')).toBe(true)
  })

  it('appends existing context files', () => {
    const prompt = buildPrompt({
      taskFile: 'task.md',
      tasksDir,
      workingDir: tmpDir,
      contextFiles: ['ctx.md'],
    })
    expect(prompt).toContain('Additional context files:')
    expect(prompt).toContain('--- ctx.md ---')
    expect(prompt).toContain('some context')
  })

  it('marks missing context files inline', () => {
    const prompt = buildPrompt({
      taskFile: 'task.md',
      tasksDir,
      workingDir: tmpDir,
      contextFiles: ['missing.md'],
    })
    expect(prompt).toContain('[context file not found: missing.md]')
  })

  it('throws when task file does not exist', () => {
    expect(() =>
      buildPrompt({ taskFile: 'nonexistent.md', tasksDir, workingDir: tmpDir }),
    ).toThrow('Task file not found')
  })

  it('trims whitespace from task content', () => {
    writeFileSync(join(tasksDir, 'padded.md'), '   \n# Title\n\ncontent   \n')
    const prompt = buildPrompt({ taskFile: 'padded.md', tasksDir, workingDir: tmpDir })
    expect(prompt.startsWith('# Title')).toBe(true)
    expect(prompt.endsWith('content')).toBe(true)
  })
})

// ─── buildVerifyPrompt ────────────────────────────────────────────────────────

describe('buildVerifyPrompt', () => {
  it('substitutes all three placeholders', () => {
    const prompt = buildVerifyPrompt('TASK', 'OUTPUT', 'DIFF')
    expect(prompt).toContain('TASK')
    expect(prompt).toContain('OUTPUT')
    expect(prompt).toContain('DIFF')
  })

  it('does not leave un-substituted placeholders in default template', () => {
    const prompt = buildVerifyPrompt('task content', 'impl output', 'git diff text')
    expect(prompt).not.toContain('{taskContent}')
    expect(prompt).not.toContain('{implementOutput}')
    expect(prompt).not.toContain('{gitDiff}')
  })

  it('uses custom template when provided', () => {
    const custom = 'Review: {taskContent} | {implementOutput} | {gitDiff}'
    const prompt = buildVerifyPrompt('T', 'O', 'D', custom)
    expect(prompt).toBe('Review: T | O | D')
  })

  it('replaces all occurrences of each placeholder', () => {
    const custom = '{taskContent} again {taskContent}'
    const prompt = buildVerifyPrompt('X', 'O', 'D', custom)
    expect(prompt).toBe('X again X')
  })

  it('default template requests JSON output', () => {
    const prompt = buildVerifyPrompt('t', 'o', 'd')
    expect(prompt).toContain('"approved"')
    expect(prompt).toContain('"score"')
  })
})

// ─── buildTestPrompt ──────────────────────────────────────────────────────────

describe('buildTestPrompt', () => {
  it('substitutes all three placeholders', () => {
    const prompt = buildTestPrompt('TASK', 'OUTPUT', 'DIFF')
    expect(prompt).toContain('TASK')
    expect(prompt).toContain('OUTPUT')
    expect(prompt).toContain('DIFF')
  })

  it('does not leave un-substituted placeholders in default template', () => {
    const prompt = buildTestPrompt('t', 'o', 'd')
    expect(prompt).not.toContain('{taskContent}')
    expect(prompt).not.toContain('{implementOutput}')
    expect(prompt).not.toContain('{gitDiff}')
  })

  it('uses custom template when provided', () => {
    const custom = 'Test: {taskContent} | {gitDiff}'
    const prompt = buildTestPrompt('T', 'O', 'D', custom)
    expect(prompt).toBe('Test: T | D')
  })

  it('default template mentions unit tests', () => {
    const prompt = buildTestPrompt('t', 'o', 'd')
    expect(prompt.toLowerCase()).toContain('тест')
  })
})
