import { readFileSync, writeFileSync } from 'node:fs'
import chalk from 'chalk'
import { checkbox, select, input } from '@inquirer/prompts'
import { loadConfig, updateTaskStatus, updateQueueStatus } from '../core/config.js'
import type { TaskDefinition, StageName } from '../types.js'

export interface ResetOptions {
  config?: string
  queue?: string
}

export async function resetCommand(taskFile: string | undefined, options: ResetOptions): Promise<void> {
  if (taskFile === undefined) {
    await interactiveReset(options)
  } else {
    quickReset(taskFile, options)
  }
}

// ─── Quick reset (file argument provided) ─────────────────────────────────────

function quickReset(taskFile: string, options: ResetOptions): void {
  try {
    const { config, path: configPath } = loadConfig(options.config)

    const { qi, ti } = findTask(taskFile, config.queues, options.queue)

    const task = config.queues[qi].tasks[ti]
    if (task.status === 'done') {
      console.error(chalk.yellow(`Task "${taskFile}" is already done. Use --force or edit the config manually.`))
      process.exit(1)
    }

    applyReset(configPath, qi, ti, task)
    maybeResetQueue(configPath, qi, config.queues[qi])

    const queueLabel = config.queues[qi].name ?? `#${qi + 1}`
    console.log(chalk.green(`✓ Task "${taskFile}" reset to pending (queue: ${queueLabel})`))
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`)
    process.exit(1)
  }
}

// ─── Interactive reset ─────────────────────────────────────────────────────────

async function interactiveReset(options: ResetOptions): Promise<void> {
  const { config, path: configPath } = loadConfig(options.config)

  // Collect all failed / stuck tasks
  const candidates: Array<{
    qi: number
    ti: number
    task: TaskDefinition
    queueName: string
  }> = []

  for (let qi = 0; qi < config.queues.length; qi++) {
    const q = config.queues[qi]
    const queueName = q.name ?? `#${qi + 1}`
    for (let ti = 0; ti < q.tasks.length; ti++) {
      const task = q.tasks[ti]
      if (task.status === 'failed' || task.status === 'in_progress') {
        candidates.push({ qi, ti, task, queueName })
      }
    }
  }

  if (candidates.length === 0) {
    console.log(chalk.dim('No failed or stuck tasks found.'))
    return
  }

  console.log()
  console.log(chalk.bold('orc-lite') + chalk.dim(' — recover tasks'))
  console.log(chalk.dim('─'.repeat(34)))
  console.log()

  // Multi-select tasks to recover
  const taskChoices = candidates.map((c) => {
    const statusBadge = c.task.status === 'failed'
      ? chalk.red('failed')
      : chalk.yellow('stuck')
    const errorSnip = c.task.error
      ? chalk.dim(`  ${truncate(c.task.error, 50)}`)
      : ''
    const age = c.task.completed_at
      ? chalk.dim(`  ${timeAgo(c.task.completed_at)}`)
      : ''
    return {
      name: `${c.task.file}  ${chalk.dim(c.queueName)}  ${statusBadge}${errorSnip}${age}`,
      value: c,
      short: c.task.file,
    }
  })

  const selected = await checkbox({
    message: 'Select tasks to recover:',
    choices: taskChoices,
  })

  if (selected.length === 0) {
    console.log(chalk.yellow('Nothing selected.'))
    return
  }

  // For each selected task, pick an action
  for (const { qi, ti, task, queueName } of selected) {
    console.log()
    console.log(chalk.bold(`  ${task.file}`) + chalk.dim(`  (queue: ${queueName})`))
    if (task.error) {
      console.log(chalk.dim(`  Error: ${task.error}`))
    }
    if (task.started_at && task.completed_at) {
      const dur = Math.round((new Date(task.completed_at).getTime() - new Date(task.started_at).getTime()) / 1000)
      console.log(chalk.dim(`  Ran:   ${dur}s`))
    }
    console.log()

    const currentTimeout = config.adapter_options.timeout ?? 600
    const currentRetries = task.max_retries ?? config.queues[qi].max_retries ?? config.max_retries ?? 0
    const currentStages = task.stages ?? config.queues[qi].stages ?? ['implement']

    const action = await select<'reset' | 'timeout' | 'retries' | 'stages' | 'skip'>({
      message: 'Action:',
      choices: [
        { name: 'Reset  (retry as-is)', value: 'reset' },
        { name: `Bump timeout  (${currentTimeout}s → ${currentTimeout * 2}s)`, value: 'timeout' },
        { name: `Add retries  (currently ${currentRetries})`, value: 'retries' },
        { name: `Change stages  (currently: ${currentStages.join(' → ')})`, value: 'stages' },
        { name: 'Mark as skipped', value: 'skip' },
      ],
    })

    if (action === 'skip') {
      updateTaskStatus(configPath, qi, ti, {
        status: 'skipped',
        error: undefined,
        started_at: undefined,
        completed_at: undefined,
        retry_count: undefined,
      })
      console.log(chalk.dim(`  ✓ ${task.file} marked as skipped`))
      continue
    }

    // Apply reset (common to all non-skip actions)
    applyReset(configPath, qi, ti, task)

    if (action === 'timeout') {
      const newTimeout = currentTimeout * 2
      updateGlobalTimeout(configPath, newTimeout)
      // Refresh in-memory so subsequent iterations see the new value
      config.adapter_options.timeout = newTimeout
      console.log(chalk.green(`  ✓ Reset — timeout: ${currentTimeout}s → ${newTimeout}s`))

    } else if (action === 'retries') {
      const raw = (await input({
        message: 'Max retries:',
        default: String(Math.max(currentRetries + 2, 3)),
        validate: (v) => /^\d+$/.test(v.trim()) ? true : 'Enter a number',
      })).trim()
      const newRetries = parseInt(raw, 10)
      updateTaskStatus(configPath, qi, ti, { max_retries: newRetries })
      console.log(chalk.green(`  ✓ Reset — max_retries: ${currentRetries} → ${newRetries}`))

    } else if (action === 'stages') {
      const stageChoices = await checkbox<StageName>({
        message: 'Stages:',
        choices: [
          { name: 'implement', value: 'implement', checked: currentStages.includes('implement') },
          { name: 'verify', value: 'verify', checked: currentStages.includes('verify') },
          { name: 'test', value: 'test', checked: currentStages.includes('test') },
        ],
      })
      const newStages: StageName[] = ['implement', ...stageChoices.filter((s) => s !== 'implement')]
      updateTaskStatus(configPath, qi, ti, { stages: newStages })
      console.log(chalk.green(`  ✓ Reset — stages: ${newStages.join(' → ')}`))

    } else {
      console.log(chalk.green(`  ✓ ${task.file} reset to pending`))
    }

    maybeResetQueue(configPath, qi, config.queues[qi])
  }

  console.log()
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findTask(
  taskFile: string,
  queues: ReturnType<typeof loadConfig>['config']['queues'],
  queueOption?: string,
): { qi: number; ti: number } {
  if (queueOption !== undefined) {
    const n = parseInt(queueOption, 10)
    const qi = !isNaN(n) && n >= 1
      ? n - 1
      : queues.findIndex((q) => q.name?.toLowerCase() === queueOption.toLowerCase())

    if (qi < 0 || qi >= queues.length) {
      console.error(chalk.red(`Queue "${queueOption}" not found`))
      process.exit(1)
    }
    const ti = queues[qi].tasks.findIndex((t) => t.file === taskFile)
    if (ti === -1) {
      console.error(chalk.red(`Task "${taskFile}" not found in queue ${queueOption}`))
      process.exit(1)
    }
    return { qi, ti }
  }

  for (let qi = 0; qi < queues.length; qi++) {
    const ti = queues[qi].tasks.findIndex((t) => t.file === taskFile)
    if (ti !== -1) return { qi, ti }
  }

  console.error(chalk.red(`Task not found: ${taskFile}`))
  process.exit(1)
}

function applyReset(configPath: string, qi: number, ti: number, _task: TaskDefinition): void {
  updateTaskStatus(configPath, qi, ti, {
    status: 'pending',
    error: undefined,
    started_at: undefined,
    completed_at: undefined,
    retry_count: undefined,
  })
}

function maybeResetQueue(
  configPath: string,
  qi: number,
  queue: ReturnType<typeof loadConfig>['config']['queues'][number],
): void {
  if (queue.status === 'failed' || queue.status === 'in_progress') {
    updateQueueStatus(configPath, qi, 'pending')
  }
}

function updateGlobalTimeout(configPath: string, newTimeout: number): void {
  const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>
  const adapterOptions = (raw['adapter_options'] ?? {}) as Record<string, unknown>
  adapterOptions['timeout'] = newTimeout
  raw['adapter_options'] = adapterOptions
  writeFileSync(configPath, JSON.stringify(raw, null, 2) + '\n', 'utf-8')
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  return `${Math.round(mins / 60)}h ago`
}
