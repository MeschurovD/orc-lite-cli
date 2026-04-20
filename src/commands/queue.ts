import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import chalk from 'chalk'
import { input, confirm, checkbox, select } from '@inquirer/prompts'
import { loadConfig } from '../core/config.js'
import type { RetryConfig, StageName } from '../types.js'

export interface QueueOptions {
  config?: string
}

// ─── queue list ───────────────────────────────────────────────────────────────

export function queueListCommand(options: QueueOptions): void {
  let config: ReturnType<typeof loadConfig>['config']

  try {
    const result = loadConfig(options.config)
    config = result.config
  } catch (err) {
    console.error(chalk.red(`Error: ${(err as Error).message}`))
    process.exit(1)
  }

  if (config.queues.length === 0) {
    console.log(chalk.yellow('No queues defined.'))
    return
  }

  console.log()
  const header = `${'#'.padEnd(3)}  ${'Name'.padEnd(18)}  ${'Dir'.padEnd(20)}  ${'Tasks'.padEnd(7)}  Status`
  console.log(chalk.dim(header))
  console.log(chalk.dim('─'.repeat(header.length)))

  for (let i = 0; i < config.queues.length; i++) {
    const q = config.queues[i]
    const num = String(i + 1).padEnd(3)
    const name = (q.name ?? `queue-${i + 1}`).padEnd(18)
    const dir = (q.tasks_dir ?? config.tasks_dir).padEnd(20)
    const done = q.tasks.filter((t) => t.status === 'done').length
    const total = q.tasks.length
    const taskStr = (total === 0 ? '0' : `${done}/${total}`).padEnd(7)
    const status = statusColor(q.status)
    const schedule = q.schedule ? chalk.dim(` @ ${q.schedule}`) : ''

    // Show queue-level overrides
    const extras: string[] = []
    if (q.stages) extras.push(`stages: ${q.stages.join('+')}`)
    if (q.max_retries !== undefined) extras.push(`retries: ${q.max_retries}`)
    if (q.verification_cmd) extras.push('verify: custom')
    const extrasStr = extras.length > 0 ? chalk.dim(`  [${extras.join(', ')}]`) : ''

    console.log(`${chalk.cyan(num)}  ${name}  ${chalk.dim(dir)}  ${taskStr}  ${status}${schedule}${extrasStr}`)
  }

  console.log()
}

// ─── queue add ────────────────────────────────────────────────────────────────

export async function queueAddCommand(
  name: string | undefined,
  options: QueueOptions & { dir?: string; schedule?: string },
): Promise<void> {
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

  console.log()
  console.log(chalk.bold('orc-lite') + chalk.dim(' — add queue'))
  console.log(chalk.dim('─'.repeat(30)))
  console.log()

  const defaultQueueName = `queue-${config.queues.length + 1}`
  const queueName = name ?? (await input({
    message: 'Queue name:',
    default: defaultQueueName,
    validate: (v) => v.trim().length > 0 ? true : 'Name is required',
  })).trim()

  const dirInput = (await input({
    message: `Tasks directory ${chalk.dim(`(enter for ${config.tasks_dir})`)}:`,
  })).trim()
  const queueDir = options.dir ?? (dirInput || config.tasks_dir)

  const scheduleRaw = options.schedule ?? (await input({
    message: 'Schedule (leave empty for manual run):',
  })).trim()
  const schedule = scheduleRaw || undefined

  const resolvedDir = resolve(queueDir)
  if (!existsSync(resolvedDir)) {
    const shouldCreate = await confirm({
      message: `Directory "${queueDir}" doesn't exist. Create it?`,
      default: true,
    })
    if (shouldCreate) {
      mkdirSync(resolvedDir, { recursive: true })
      console.log(chalk.dim(`  Created: ${resolvedDir}`))
    }
  }

  // ── Queue-level defaults ───────────────────────────────────────────────────

  const defaults = await promptQueueDefaults()

  writeQueue(configPath, config.tasks_dir, queueName, queueDir, schedule, defaults)
}

// ─── Shared: interactive defaults prompt ─────────────────────────────────────

export interface QueueDefaults {
  stages?: StageName[]
  max_retries?: number
  retry?: RetryConfig
  verification_cmd?: string
}

export async function promptQueueDefaults(): Promise<QueueDefaults> {
  const configure = await confirm({
    message: 'Configure task defaults for this queue?',
    default: false,
  })

  if (!configure) return {}

  console.log()

  // Stages
  const stageChoices = await checkbox<StageName>({
    message: 'Default stages:',
    choices: [
      { name: 'implement', value: 'implement', checked: true },
      { name: 'verify  — AI reviews the implementation', value: 'verify' },
      { name: 'test    — runs tests after implement', value: 'test' },
    ],
  })

  // Always ensure implement is first
  const stages: StageName[] = ['implement', ...stageChoices.filter((s) => s !== 'implement')]

  // Retries
  const retriesRaw = (await input({
    message: 'Max retries per task (leave empty to use global):',
  })).trim()
  const max_retries = retriesRaw ? parseInt(retriesRaw, 10) : undefined

  let retry: RetryConfig | undefined

  if (max_retries !== undefined && max_retries > 0) {
    const delayRaw = (await input({
      message: 'Retry delay seconds (leave empty for 0):',
    })).trim()
    const delay_seconds = delayRaw ? parseInt(delayRaw, 10) : undefined

    const backoff = await select<'none' | 'linear' | 'exponential'>({
      message: 'Retry backoff:',
      choices: [
        { name: 'none — fixed delay', value: 'none' },
        { name: 'linear — delay × attempt', value: 'linear' },
        { name: 'exponential — delay × 2^attempt', value: 'exponential' },
      ],
    })

    retry = {
      max_attempts: max_retries,
      ...(delay_seconds ? { delay_seconds } : {}),
      backoff,
    }
  }

  // Verification command
  const verification_cmd = (await input({
    message: 'Verification command (leave empty to use global):',
  })).trim() || undefined

  const result: QueueDefaults = {}

  // Only store stages if they differ from the default ['implement']
  if (stages.length > 1 || stageChoices.includes('verify') || stageChoices.includes('test')) {
    result.stages = stages
  }
  if (max_retries !== undefined) result.max_retries = max_retries
  if (retry) result.retry = retry
  if (verification_cmd) result.verification_cmd = verification_cmd

  return result
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function writeQueue(
  configPath: string,
  globalTasksDir: string,
  name: string,
  dir: string,
  schedule: string | undefined,
  defaults: QueueDefaults,
): void {
  const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>

  const queues = Array.isArray(raw['queues']) ? raw['queues'] as unknown[] : []

  const duplicate = queues.some(
    (q) => typeof q === 'object' && q !== null && (q as Record<string, unknown>)['name'] === name,
  )
  if (duplicate) {
    console.error(chalk.red(`Queue "${name}" already exists`))
    process.exit(1)
  }

  const entry: Record<string, unknown> = {
    name,
    schedule: schedule ?? null,
    status: 'pending',
    tasks: [],
  }
  if (dir !== globalTasksDir) entry['tasks_dir'] = dir
  if (defaults.stages) entry['stages'] = defaults.stages
  if (defaults.max_retries !== undefined) entry['max_retries'] = defaults.max_retries
  if (defaults.retry) entry['retry'] = defaults.retry
  if (defaults.verification_cmd) entry['verification_cmd'] = defaults.verification_cmd

  queues.push(entry)
  raw['queues'] = queues

  writeFileSync(configPath, JSON.stringify(raw, null, 2) + '\n', 'utf-8')

  console.log()
  console.log(
    chalk.green('✓') +
    ` Queue "${chalk.bold(name)}" added` +
    (dir !== globalTasksDir ? chalk.dim(` (${dir})`) : '') +
    (schedule ? chalk.dim(` @ ${schedule}`) : ''),
  )
  if (defaults.stages && defaults.stages.length > 1) {
    console.log(chalk.dim(`  stages: ${defaults.stages.join(' → ')}`))
  }
  if (defaults.max_retries) {
    console.log(chalk.dim(`  retries: ${defaults.max_retries}${defaults.retry?.backoff ? `, ${defaults.retry.backoff} backoff` : ''}`))
  }
  if (defaults.verification_cmd) {
    console.log(chalk.dim(`  verify: ${defaults.verification_cmd}`))
  }
  console.log(chalk.dim(`  Run: orc-lite add -q ${name}`))
  console.log()
}

function statusColor(status: string): string {
  switch (status) {
    case 'done': return chalk.green('done')
    case 'in_progress': return chalk.yellow('running')
    case 'failed': return chalk.red('failed')
    default: return chalk.cyan('pending')
  }
}
