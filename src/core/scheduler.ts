import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { SchedulerJob, SchedulerRegistry } from '../types.js'

// ─── Paths ────────────────────────────────────────────────────────────────────

export function getSchedulerDir(): string {
  return join(homedir(), '.orc-lite')
}

export function getSchedulerPath(): string {
  return join(getSchedulerDir(), 'scheduler.json')
}

export function getDaemonPidPath(): string {
  return join(getSchedulerDir(), 'daemon.pid')
}

export function isDaemonRunning(): boolean {
  const pidPath = getDaemonPidPath()
  if (!existsSync(pidPath)) return false
  const pid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10)
  if (isNaN(pid)) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    // Stale PID file — clean it up
    try { unlinkSync(pidPath) } catch { /* ignore */ }
    return false
  }
}

export function getDaemonPid(): number | null {
  const pidPath = getDaemonPidPath()
  if (!existsSync(pidPath)) return null
  const pid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10)
  return isNaN(pid) ? null : pid
}

// ─── Registry I/O ─────────────────────────────────────────────────────────────

export function loadRegistry(): SchedulerRegistry {
  const path = getSchedulerPath()
  if (!existsSync(path)) {
    return { jobs: [] }
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as SchedulerRegistry
  } catch {
    return { jobs: [] }
  }
}

export function saveRegistry(registry: SchedulerRegistry): void {
  const dir = getSchedulerDir()
  mkdirSync(dir, { recursive: true })
  writeFileSync(getSchedulerPath(), JSON.stringify(registry, null, 2) + '\n', 'utf-8')
}

// ─── Time parsing ─────────────────────────────────────────────────────────────

/**
 * Parse schedule string into an absolute Date.
 *
 * Supported formats:
 *   "2:30"                  — next occurrence of 2:30 (today or tomorrow)
 *   "14:30"                 — next occurrence of 14:30
 *   "2026-04-09"            — that date at 00:00
 *   "2026-04-09 2:30"       — that date at 2:30
 *   "2026-04-09T02:30:00"   — ISO 8601 as-is
 */
export function parseScheduleTime(input: string): Date {
  const trimmed = input.trim()

  // ISO 8601 (contains 'T')
  if (trimmed.includes('T')) {
    const d = new Date(trimmed)
    if (!isNaN(d.getTime())) return d
    throw new Error(`Invalid ISO date: ${input}`)
  }

  // "YYYY-MM-DD HH:MM" or "YYYY-MM-DD H:MM"
  const dateTimeMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})$/)
  if (dateTimeMatch) {
    const [, datePart, h, m] = dateTimeMatch
    const d = new Date(`${datePart}T${String(h).padStart(2, '0')}:${m}:00`)
    if (!isNaN(d.getTime())) return d
    throw new Error(`Invalid date: ${input}`)
  }

  // "YYYY-MM-DD"
  const dateOnlyMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})$/)
  if (dateOnlyMatch) {
    const d = new Date(`${trimmed}T00:00:00`)
    if (!isNaN(d.getTime())) return d
    throw new Error(`Invalid date: ${input}`)
  }

  // "H:MM" or "HH:MM" — next occurrence
  const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})$/)
  if (timeMatch) {
    const [, h, m] = timeMatch
    const hour = parseInt(h, 10)
    const minute = parseInt(m, 10)

    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      throw new Error(`Invalid time: ${input}`)
    }

    const now = new Date()
    const candidate = new Date(now)
    candidate.setHours(hour, minute, 0, 0)

    // If the time has already passed today, schedule for tomorrow
    if (candidate <= now) {
      candidate.setDate(candidate.getDate() + 1)
    }

    return candidate
  }

  throw new Error(
    `Cannot parse schedule time: "${input}". ` +
    `Supported formats: "2:30", "14:30", "2026-04-09", "2026-04-09 2:30", "2026-04-09T02:30:00"`,
  )
}

export function formatScheduleTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// ─── Job management ───────────────────────────────────────────────────────────

export function registerJob(params: {
  repo: string
  config?: string
  queueIndex: number
  queueName?: string
  scheduledAt: Date
}): SchedulerJob {
  const registry = loadRegistry()

  // Check if job for this repo+queue already exists
  const existing = registry.jobs.find(
    (j) => j.repo === params.repo && j.queue_index === params.queueIndex && j.status === 'scheduled',
  )
  if (existing) {
    // Update scheduled time
    existing.scheduled_at = params.scheduledAt.toISOString()
    existing.queue_name = params.queueName
    saveRegistry(registry)
    return existing
  }

  const job: SchedulerJob = {
    id: randomUUID().slice(0, 8),
    repo: params.repo,
    config: params.config,
    queue_index: params.queueIndex,
    queue_name: params.queueName,
    scheduled_at: params.scheduledAt.toISOString(),
    registered_at: new Date().toISOString(),
    status: 'scheduled',
  }

  registry.jobs.push(job)
  saveRegistry(registry)
  return job
}

export function cancelJob(id: string): boolean {
  const registry = loadRegistry()
  const before = registry.jobs.length
  registry.jobs = registry.jobs.filter((j) => j.id !== id)
  if (registry.jobs.length === before) return false
  saveRegistry(registry)
  return true
}

export function cancelJobsForRepo(repoPath: string): number {
  const registry = loadRegistry()
  const before = registry.jobs.length
  registry.jobs = registry.jobs.filter(
    (j) => !(j.repo === resolve(repoPath) && j.status === 'scheduled'),
  )
  const count = before - registry.jobs.length
  if (count > 0) saveRegistry(registry)
  return count
}

export function removeJob(id: string): void {
  const registry = loadRegistry()
  registry.jobs = registry.jobs.filter((j) => j.id !== id)
  saveRegistry(registry)
}

export function updateJobStatus(
  id: string,
  status: SchedulerJob['status'],
): void {
  const registry = loadRegistry()
  const job = registry.jobs.find((j) => j.id === id)
  if (job) {
    job.status = status
    saveRegistry(registry)
  }
}

export function getScheduledJobs(): SchedulerJob[] {
  return loadRegistry().jobs.filter((j) => j.status === 'scheduled')
}

// ─── Daemon helpers ───────────────────────────────────────────────────────────

export interface DaemonTimer {
  jobId: string
  timer: ReturnType<typeof setTimeout>
}

/**
 * Schedule all pending jobs from the registry.
 * Returns a list of active timers so they can be cancelled on reload.
 */
export function scheduleJobs(
  jobs: SchedulerJob[],
  onRun: (job: SchedulerJob) => Promise<void>,
): DaemonTimer[] {
  const now = Date.now()
  const timers: DaemonTimer[] = []

  for (const job of jobs) {
    if (job.status !== 'scheduled') continue

    const scheduledAt = new Date(job.scheduled_at).getTime()
    const delta = Math.max(0, scheduledAt - now)

    const timer = setTimeout(() => {
      void onRun(job)
    }, delta)

    timers.push({ jobId: job.id, timer })
  }

  return timers
}

export function clearTimers(timers: DaemonTimer[]): void {
  for (const { timer } of timers) {
    clearTimeout(timer)
  }
}
