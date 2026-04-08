import { resolve } from 'node:path'
import chalk from 'chalk'
import { loadConfig } from '../core/config.js'
import {
  parseScheduleTime,
  formatScheduleTime,
  registerJob,
  loadRegistry,
  saveRegistry,
  getSchedulerPath,
} from '../core/scheduler.js'

export interface RegisterOptions {
  config?: string
}

export async function registerCommand(options: RegisterOptions): Promise<void> {
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

  const repoPath = resolve(cwd)
  let registered = 0
  let skipped = 0
  let warnings = 0

  console.log()

  for (let i = 0; i < config.queues.length; i++) {
    const queue = config.queues[i]
    const label = queue.name ?? `#${i + 1}`

    if (!queue.schedule) continue
    if (queue.status === 'done') {
      console.log(chalk.dim(`  queue ${label}: skipped (already done)`))
      skipped++
      continue
    }

    let scheduledAt: Date
    try {
      scheduledAt = parseScheduleTime(queue.schedule)
    } catch (err) {
      console.log(chalk.yellow(`  queue ${label}: ${(err as Error).message}`))
      warnings++
      continue
    }

    if (scheduledAt < new Date()) {
      console.log(chalk.yellow(`  queue ${label}: schedule "${queue.schedule}" is in the past — skipping`))
      warnings++
      continue
    }

    const job = registerJob({
      repo: repoPath,
      config: options.config ? resolve(options.config) : undefined,
      queueIndex: i,
      queueName: queue.name,
      scheduledAt,
    })

    console.log(
      chalk.green('  ✓') +
      ` queue ${chalk.bold(label)}` +
      ` [${job.id}]` +
      chalk.dim(` → ${formatScheduleTime(scheduledAt)}`),
    )
    registered++
  }

  // Remove jobs for queues that no longer have a schedule or are done
  const registry = loadRegistry()
  let removed = 0
  registry.jobs = registry.jobs.filter((job) => {
    if (job.repo !== repoPath) return true
    if (job.status !== 'scheduled') return true

    const queue = config.queues[job.queue_index]
    if (!queue) {
      removed++
      return false
    }
    if (!queue.schedule || queue.status === 'done') {
      removed++
      return false
    }
    return true
  })
  if (removed > 0) {
    saveRegistry(registry)
    console.log(chalk.dim(`  Removed ${removed} stale job(s)`))
  }

  console.log()

  if (registered === 0 && warnings === 0) {
    console.log(chalk.dim('No queues with schedule found.'))
    console.log(chalk.dim(`Add "schedule" field to queues in ${configPath}`))
  } else {
    const parts: string[] = []
    if (registered > 0) parts.push(chalk.green(`${registered} registered`))
    if (skipped > 0) parts.push(chalk.dim(`${skipped} skipped`))
    if (warnings > 0) parts.push(chalk.yellow(`${warnings} warnings`))
    console.log(parts.join('  '))
    console.log()
    console.log(chalk.dim(`Run ${chalk.white('orc-lite daemon')} to start the scheduler`))
    console.log(chalk.dim(`Run ${chalk.white('orc-lite schedule --list')} to see all jobs`))
  }

  console.log()
  console.log(chalk.dim(`Scheduler: ${getSchedulerPath()}`))
  console.log()
}
