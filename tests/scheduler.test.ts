import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  parseScheduleTime,
  formatScheduleTime,
  registerJob,
  cancelJob,
  cancelJobsForRepo,
  loadRegistry,
  saveRegistry,
  updateJobStatus,
  removeJob,
  getScheduledJobs,
  scheduleJobs,
} from '../src/core/scheduler.js'
import type { SchedulerRegistry } from '../src/types.js'

// ─── parseScheduleTime ────────────────────────────────────────────────────────

describe('parseScheduleTime', () => {
  it('parses ISO 8601 with T', () => {
    const d = parseScheduleTime('2026-04-09T02:30:00')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(3) // April = 3
    expect(d.getDate()).toBe(9)
    expect(d.getHours()).toBe(2)
    expect(d.getMinutes()).toBe(30)
  })

  it('parses YYYY-MM-DD HH:MM', () => {
    const d = parseScheduleTime('2026-04-09 14:30')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(3)
    expect(d.getDate()).toBe(9)
    expect(d.getHours()).toBe(14)
    expect(d.getMinutes()).toBe(30)
  })

  it('parses YYYY-MM-DD H:MM (single digit hour)', () => {
    const d = parseScheduleTime('2026-04-09 2:05')
    expect(d.getHours()).toBe(2)
    expect(d.getMinutes()).toBe(5)
  })

  it('parses YYYY-MM-DD as midnight', () => {
    const d = parseScheduleTime('2026-04-09')
    expect(d.getHours()).toBe(0)
    expect(d.getMinutes()).toBe(0)
  })

  it('parses H:MM as next occurrence (future today or tomorrow)', () => {
    const now = new Date()
    // Use a time 2 hours from now to ensure it's always in the future today or very soon tomorrow
    const futureHour = (now.getHours() + 2) % 24
    const input = `${futureHour}:00`
    const d = parseScheduleTime(input)
    expect(d > now).toBe(true)
    expect(d.getHours()).toBe(futureHour)
    expect(d.getMinutes()).toBe(0)
  })

  it('schedules H:MM for tomorrow if time already passed today', () => {
    // Use a time in the past (hour 0:01 — likely already passed)
    const now = new Date()
    const pastHour = 0
    const pastMin = 1
    // Only test if it's past 0:01 today
    if (now.getHours() > 0 || now.getMinutes() > 1) {
      const d = parseScheduleTime('0:01')
      const tomorrow = new Date(now)
      tomorrow.setDate(tomorrow.getDate() + 1)
      expect(d.getDate()).toBe(tomorrow.getDate())
      expect(d.getHours()).toBe(pastHour)
      expect(d.getMinutes()).toBe(pastMin)
    }
  })

  it('throws on invalid ISO date', () => {
    expect(() => parseScheduleTime('2026-99-99T00:00:00')).toThrow()
  })

  it('throws on invalid time', () => {
    expect(() => parseScheduleTime('25:00')).toThrow('Invalid time')
  })

  it('throws on unrecognized format', () => {
    expect(() => parseScheduleTime('tomorrow morning')).toThrow('Cannot parse schedule time')
  })
})

// ─── formatScheduleTime ───────────────────────────────────────────────────────

describe('formatScheduleTime', () => {
  it('formats date as "YYYY-MM-DD HH:MM"', () => {
    const d = new Date('2026-04-09T02:30:00Z')
    const result = formatScheduleTime(d)
    // Result is local time — just check format pattern
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })
})

// ─── Registry I/O and job management ─────────────────────────────────────────

describe('Scheduler registry', () => {
  // Redirect scheduler to a temp dir during tests
  let tmpDir: string
  let originalEnv: string | undefined

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'orc-lite-test-'))
    originalEnv = process.env['HOME']
    process.env['HOME'] = tmpDir
  })

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['HOME'] = originalEnv
    }
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('loadRegistry returns empty jobs if file does not exist', () => {
    const reg = loadRegistry()
    expect(reg.jobs).toHaveLength(0)
  })

  it('saveRegistry / loadRegistry roundtrip', () => {
    const reg: SchedulerRegistry = {
      jobs: [{
        id: 'abc123',
        repo: '/opt/work/project',
        queue_index: 0,
        queue_name: 'test',
        scheduled_at: '2026-04-09T02:30:00.000Z',
        registered_at: new Date().toISOString(),
        status: 'scheduled',
      }],
    }
    saveRegistry(reg)
    const loaded = loadRegistry()
    expect(loaded.jobs).toHaveLength(1)
    expect(loaded.jobs[0]!.id).toBe('abc123')
    expect(loaded.jobs[0]!.queue_name).toBe('test')
  })

  it('registerJob creates a new job', () => {
    const scheduledAt = new Date('2026-12-01T02:30:00Z')
    const job = registerJob({
      repo: '/opt/work/project-a',
      queueIndex: 1,
      queueName: 'nightly',
      scheduledAt,
    })

    expect(job.id).toBeTruthy()
    expect(job.repo).toBe('/opt/work/project-a')
    expect(job.queue_index).toBe(1)
    expect(job.queue_name).toBe('nightly')
    expect(job.status).toBe('scheduled')

    const reg = loadRegistry()
    expect(reg.jobs).toHaveLength(1)
  })

  it('registerJob updates existing scheduled job for same repo+queue', () => {
    const t1 = new Date('2026-12-01T02:00:00Z')
    const t2 = new Date('2026-12-02T03:00:00Z')

    const job1 = registerJob({ repo: '/opt/work/p', queueIndex: 0, scheduledAt: t1 })
    const job2 = registerJob({ repo: '/opt/work/p', queueIndex: 0, scheduledAt: t2 })

    expect(job1.id).toBe(job2.id) // same job, updated

    const reg = loadRegistry()
    expect(reg.jobs).toHaveLength(1)
    expect(reg.jobs[0]!.scheduled_at).toBe(t2.toISOString())
  })

  it('cancelJob marks job as cancelled', () => {
    const job = registerJob({
      repo: '/opt/work/p',
      queueIndex: 0,
      scheduledAt: new Date('2026-12-01T02:00:00Z'),
    })

    const ok = cancelJob(job.id)
    expect(ok).toBe(true)

    const reg = loadRegistry()
    expect(reg.jobs[0]!.status).toBe('cancelled')
  })

  it('cancelJob returns false for unknown id', () => {
    const ok = cancelJob('nonexistent')
    expect(ok).toBe(false)
  })

  it('cancelJobsForRepo cancels all scheduled jobs for repo', () => {
    const repo = '/opt/work/project'
    registerJob({ repo, queueIndex: 0, scheduledAt: new Date('2026-12-01T01:00:00Z') })
    registerJob({ repo, queueIndex: 1, scheduledAt: new Date('2026-12-01T02:00:00Z') })
    registerJob({ repo: '/opt/work/other', queueIndex: 0, scheduledAt: new Date('2026-12-01T03:00:00Z') })

    const count = cancelJobsForRepo(repo)
    expect(count).toBe(2)

    const reg = loadRegistry()
    const repoJobs = reg.jobs.filter((j) => j.repo === repo)
    expect(repoJobs.every((j) => j.status === 'cancelled')).toBe(true)

    // Other repo untouched
    const otherJobs = reg.jobs.filter((j) => j.repo !== repo)
    expect(otherJobs[0]!.status).toBe('scheduled')
  })

  it('removeJob deletes job from registry', () => {
    const job = registerJob({
      repo: '/opt/work/p',
      queueIndex: 0,
      scheduledAt: new Date('2026-12-01T02:00:00Z'),
    })

    removeJob(job.id)

    const reg = loadRegistry()
    expect(reg.jobs).toHaveLength(0)
  })

  it('updateJobStatus changes job status', () => {
    const job = registerJob({
      repo: '/opt/work/p',
      queueIndex: 0,
      scheduledAt: new Date('2026-12-01T02:00:00Z'),
    })

    updateJobStatus(job.id, 'running')

    const reg = loadRegistry()
    expect(reg.jobs[0]!.status).toBe('running')
  })

  it('getScheduledJobs returns only scheduled status', () => {
    registerJob({ repo: '/opt/work/p', queueIndex: 0, scheduledAt: new Date('2026-12-01T01:00:00Z') })
    const job2 = registerJob({ repo: '/opt/work/p', queueIndex: 1, scheduledAt: new Date('2026-12-01T02:00:00Z') })
    cancelJob(job2.id)

    const scheduled = getScheduledJobs()
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]!.queue_index).toBe(0)
  })
})

// ─── scheduleJobs timer logic ─────────────────────────────────────────────────

describe('scheduleJobs', () => {
  it('fires callback for overdue jobs immediately', async () => {
    const ran: string[] = []
    const jobs = [{
      id: 'past1',
      repo: '/r',
      queue_index: 0,
      scheduled_at: new Date(Date.now() - 10000).toISOString(), // 10s ago
      registered_at: new Date().toISOString(),
      status: 'scheduled' as const,
    }]

    const timers = scheduleJobs(jobs, async (job) => {
      ran.push(job.id)
    })

    // Wait for the setTimeout(0) to fire
    await new Promise((r) => setTimeout(r, 50))

    expect(ran).toContain('past1')

    // Cleanup
    for (const t of timers) clearTimeout(t.timer)
  })

  it('does not fire for non-scheduled jobs', async () => {
    const ran: string[] = []
    const jobs = [{
      id: 'cancelled1',
      repo: '/r',
      queue_index: 0,
      scheduled_at: new Date(Date.now() - 1000).toISOString(),
      registered_at: new Date().toISOString(),
      status: 'cancelled' as const,
    }]

    const timers = scheduleJobs(jobs, async (job) => { ran.push(job.id) })
    await new Promise((r) => setTimeout(r, 50))
    expect(ran).toHaveLength(0)

    for (const t of timers) clearTimeout(t.timer)
  })
})
