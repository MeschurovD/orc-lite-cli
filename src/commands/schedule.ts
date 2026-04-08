import { resolve } from 'node:path'
import chalk from 'chalk'
import { loadConfig, saveConfig } from '../core/config.js'
import {
  parseScheduleTime,
  formatScheduleTime,
  registerJob,
  cancelJob,
  cancelJobsForRepo,
  loadRegistry,
  getSchedulerPath,
} from '../core/scheduler.js'

export interface ScheduleOptions {
  config?: string
  list?: boolean
  cancel?: string | boolean
}

export async function scheduleCommand(
  queueArg: string | undefined,
  timeArg: string | undefined,
  options: ScheduleOptions,
): Promise<void> {
  // ── --list ────────────────────────────────────────────────────────────────
  if (options.list) {
    listJobs()
    return
  }

  // ── --cancel ──────────────────────────────────────────────────────────────
  if (options.cancel !== undefined) {
    await handleCancel(options)
    return
  }

  // ── Set schedule ──────────────────────────────────────────────────────────
  // Args: schedule [queue] [time]  or  schedule [time]
  // Commander passes positional args as queueArg and timeArg.
  // If only one positional arg — it's the time, not the queue.
  let queueIndex: number | undefined
  let timeInput: string | undefined

  if (queueArg !== undefined && timeArg !== undefined) {
    // Both provided: queue number + time
    const n = parseInt(queueArg, 10)
    if (isNaN(n) || n < 1) {
      console.error(chalk.red(`Invalid queue number: ${queueArg}`))
      process.exit(1)
    }
    queueIndex = n - 1
    timeInput = timeArg
  } else if (queueArg !== undefined) {
    // Only one arg — could be a time string or a number
    const n = parseInt(queueArg, 10)
    if (!isNaN(n) && n >= 1 && String(n) === queueArg.trim()) {
      // Looks like a queue number but no time given
      console.error(chalk.red('Please provide a time: orc-lite schedule [queue] <time>'))
      console.error(chalk.dim('  Examples: orc-lite schedule 2:30'))
      console.error(chalk.dim('            orc-lite schedule 2 "2026-04-09 14:00"'))
      process.exit(1)
    }
    // It's a time string
    timeInput = queueArg
  } else {
    console.error(chalk.red('Usage: orc-lite schedule [queue] <time>'))
    console.error(chalk.dim('  or:   orc-lite schedule --list'))
    console.error(chalk.dim('  or:   orc-lite schedule --cancel [id]'))
    process.exit(1)
  }

  const cwd = process.cwd()

  let config: ReturnType<typeof loadConfig>['config']
  let configPath: string

  try {
    const result = loadConfig(options.config)
    config = result.config
    configPath = result.path
  } catch (err) {
    console.error(chalk.red(`Error: ${(err as Error).message}`))
    process.exit(1)
  }

  // Determine which queue
  let qi: number
  if (queueIndex !== undefined) {
    if (queueIndex >= config.queues.length) {
      console.error(chalk.red(`Queue #${queueIndex + 1} not found (${config.queues.length} queues total)`))
      process.exit(1)
    }
    qi = queueIndex
  } else {
    qi = config.queues.findIndex((q) => q.status !== 'done')
    if (qi === -1) {
      console.error(chalk.yellow('All queues are already done.'))
      process.exit(1)
    }
  }

  const queue = config.queues[qi]
  const label = queue.name ?? `#${qi + 1}`

  // Parse time
  let scheduledAt: Date
  try {
    scheduledAt = parseScheduleTime(timeInput!)
  } catch (err) {
    console.error(chalk.red(`Error: ${(err as Error).message}`))
    process.exit(1)
  }

  if (scheduledAt < new Date()) {
    console.error(chalk.yellow(`Warning: scheduled time is in the past: ${formatScheduleTime(scheduledAt)}`))
    process.exit(1)
  }

  // Update config
  config.queues[qi].schedule = timeInput!
  saveConfig(configPath, config)

  // Register in scheduler
  const job = registerJob({
    repo: resolve(cwd),
    config: options.config ? resolve(options.config) : undefined,
    queueIndex: qi,
    queueName: queue.name,
    scheduledAt,
  })

  console.log()
  console.log(
    chalk.green('✓') +
    ` Queue ${chalk.bold(label)} scheduled` +
    chalk.dim(` → ${formatScheduleTime(scheduledAt)}`) +
    chalk.dim(` [${job.id}]`),
  )
  console.log()
  console.log(chalk.dim(`Run ${chalk.white('orc-lite daemon')} to start the scheduler`))
  console.log()
}

// ─── --list ───────────────────────────────────────────────────────────────────

function listJobs(): void {
  const registry = loadRegistry()
  const jobs = registry.jobs

  console.log()
  console.log(chalk.bold(`Scheduled jobs — ${getSchedulerPath()}`))
  console.log()

  if (jobs.length === 0) {
    console.log(chalk.dim('  No jobs registered.'))
    console.log()
    return
  }

  const now = Date.now()

  for (const job of jobs) {
    const statusColor = {
      scheduled: chalk.cyan,
      running: chalk.yellow,
      done: chalk.green,
      failed: chalk.red,
      cancelled: chalk.dim,
    }[job.status] ?? chalk.dim

    const scheduledAt = new Date(job.scheduled_at)
    const delta = scheduledAt.getTime() - now
    const when = delta > 0
      ? `in ${formatDelta(delta)}`
      : delta > -3600000
        ? chalk.yellow('overdue')
        : chalk.dim('past')

    const repo = job.repo.replace(process.env['HOME'] ?? '', '~')
    const queueName = job.queue_name ?? `queue[${job.queue_index}]`

    console.log(
      `  ${chalk.dim(job.id)}  ` +
      statusColor(`${job.status.padEnd(10)}`) +
      `  ${chalk.bold(queueName.padEnd(20))}` +
      `  ${formatScheduleTime(scheduledAt).padEnd(17)}` +
      `  ${chalk.dim(when.padEnd(12))}` +
      `  ${chalk.dim(repo)}`,
    )
  }

  console.log()
}

// ─── --cancel ─────────────────────────────────────────────────────────────────

async function handleCancel(options: ScheduleOptions): Promise<void> {
  const cancelArg = options.cancel

  if (typeof cancelArg === 'string' && cancelArg.length > 0) {
    // Cancel specific job by ID
    const ok = cancelJob(cancelArg)
    if (ok) {
      console.log(chalk.green(`✓ Job ${cancelArg} cancelled`))
    } else {
      console.error(chalk.red(`Job not found: ${cancelArg}`))
      process.exit(1)
    }
  } else {
    // Cancel all jobs for current repo
    const cwd = process.cwd()
    const count = cancelJobsForRepo(cwd)
    if (count > 0) {
      console.log(chalk.green(`✓ ${count} job(s) cancelled for ${cwd}`))
    } else {
      console.log(chalk.dim('No scheduled jobs found for this repo.'))
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDelta(ms: number): string {
  const totalSec = Math.round(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)

  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${totalSec}s`
}
