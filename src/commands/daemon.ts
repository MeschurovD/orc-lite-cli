import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  appendFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import chalk from 'chalk'
import {
  loadRegistry,
  scheduleJobs,
  clearTimers,
  updateJobStatus,
  removeJob,
  getSchedulerDir,
  type DaemonTimer,
} from '../core/scheduler.js'
import { runQueue } from '../core/orchestrator.js'
import type { SchedulerJob } from '../types.js'

const PID_FILE = resolve(getSchedulerDir(), 'daemon.pid')
const DEFAULT_POLL_INTERVAL_S = 60

export interface DaemonOptions {
  config?: string
}

export async function daemonCommand(options: DaemonOptions): Promise<void> {
  // ── Check for existing daemon ─────────────────────────────────────────────
  if (existsSync(PID_FILE)) {
    const existingPid = readFileSync(PID_FILE, 'utf-8').trim()
    if (isProcessRunning(existingPid)) {
      console.error(chalk.red(`Daemon is already running (PID ${existingPid})`))
      console.error(chalk.dim(`  PID file: ${PID_FILE}`))
      process.exit(1)
    }
    // Stale PID file — remove it
    unlinkSync(PID_FILE)
  }

  // ── Write PID file ────────────────────────────────────────────────────────
  mkdirSync(getSchedulerDir(), { recursive: true })
  writeFileSync(PID_FILE, String(process.pid), 'utf-8')

  // ── Determine log file and poll interval ─────────────────────────────────
  let logFile: string | undefined
  let pollIntervalS = DEFAULT_POLL_INTERVAL_S

  if (options.config) {
    try {
      const { loadConfig } = await import('../core/config.js')
      const { config } = loadConfig(options.config)
      if (config.daemon?.log_file) logFile = resolve(config.daemon.log_file)
      if (config.daemon?.poll_interval) pollIntervalS = config.daemon.poll_interval
    } catch {
      // config optional for daemon
    }
  }

  const log = makeLogger(logFile)

  log(`orc-lite daemon started (PID ${process.pid})`)
  log(`Scheduler: ${resolve(getSchedulerDir(), 'scheduler.json')}`)
  log(`Poll interval: ${pollIntervalS}s`)

  // ── Job runner ────────────────────────────────────────────────────────────
  const runJob = async (job: SchedulerJob): Promise<void> => {
    log(`Running job ${job.id}: queue "${job.queue_name ?? job.queue_index}" in ${job.repo}`)

    updateJobStatus(job.id, 'running')

    try {
      const result = await runQueue({
        configPath: job.config,
        queueIndex: job.queue_index,
        cwd: job.repo,
      })

      if (result.stoppedReason) {
        updateJobStatus(job.id, 'failed')
        log(`Job ${job.id} FAILED: queue stopped (${result.stoppedReason})`)
      } else {
        removeJob(job.id)
        log(`Job ${job.id} completed: ${result.doneTasks}/${result.totalTasks} tasks done`)
      }
    } catch (err) {
      updateJobStatus(job.id, 'failed')
      log(`Job ${job.id} ERROR: ${(err as Error).message}`)
    }
  }

  // ── Initial scheduling ────────────────────────────────────────────────────
  let activeTimers: DaemonTimer[] = []

  const reload = (): void => {
    clearTimers(activeTimers)
    const jobs = loadRegistry().jobs.filter((j) => j.status === 'scheduled')

    if (jobs.length === 0) {
      log('No scheduled jobs found')
    } else {
      log(`Loaded ${jobs.length} scheduled job(s)`)
      for (const job of jobs) {
        const delta = new Date(job.scheduled_at).getTime() - Date.now()
        const when = delta <= 0 ? 'now' : `in ${Math.round(delta / 1000)}s`
        log(`  ${job.id}: ${job.queue_name ?? `queue[${job.queue_index}]`} @ ${job.scheduled_at} (${when})`)
      }
    }

    // Handle overdue jobs (within 1 hour grace period)
    const now = Date.now()
    const oneHour = 60 * 60 * 1000
    for (const job of jobs) {
      const scheduledAt = new Date(job.scheduled_at).getTime()
      const overdue = now - scheduledAt
      if (overdue > 0 && overdue <= oneHour) {
        log(`Job ${job.id} is overdue by ${Math.round(overdue / 1000)}s — running immediately`)
      } else if (overdue > oneHour) {
        log(`Job ${job.id} is overdue by ${Math.round(overdue / 60000)}min — skipping (>1h grace period)`)
        updateJobStatus(job.id, 'failed')
        continue
      }
    }

    const schedulableJobs = jobs.filter((j) => {
      const overdue = Date.now() - new Date(j.scheduled_at).getTime()
      return overdue <= 60 * 60 * 1000  // within grace period
    })

    activeTimers = scheduleJobs(schedulableJobs, runJob)
  }

  reload()

  // ── Poll loop ─────────────────────────────────────────────────────────────
  const pollInterval = setInterval(() => {
    log('Polling scheduler.json...')
    reload()
  }, pollIntervalS * 1000)

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = (sig: string): void => {
    log(`Received ${sig} — shutting down daemon`)
    clearTimers(activeTimers)
    clearInterval(pollInterval)

    try {
      if (existsSync(PID_FILE)) unlinkSync(PID_FILE)
    } catch { /* best effort */ }

    log('Daemon stopped')
    process.exit(0)
  }

  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))

  console.log(chalk.green(`orc-lite daemon running (PID ${process.pid})`))
  console.log(chalk.dim(`  Scheduler: ${resolve(getSchedulerDir(), 'scheduler.json')}`))
  if (logFile) console.log(chalk.dim(`  Log: ${logFile}`))
  console.log(chalk.dim('  Press Ctrl+C to stop'))
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isProcessRunning(pid: string): boolean {
  try {
    process.kill(parseInt(pid, 10), 0)
    return true
  } catch {
    return false
  }
}

function makeLogger(logFile?: string): (msg: string) => void {
  return (msg: string): void => {
    const ts = new Date().toISOString().slice(0, 19).replace('T', ' ')
    const line = `[${ts}] ${msg}`
    console.log(line)
    if (logFile) {
      try {
        appendFileSync(logFile, line + '\n', 'utf-8')
      } catch { /* best effort */ }
    }
  }
}
