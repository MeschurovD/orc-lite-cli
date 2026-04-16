import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import chalk from 'chalk'
import { input, confirm } from '@inquirer/prompts'
import { loadConfig } from '../core/config.js'
import type { QueueDefinition } from '../types.js'

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

    console.log(`${chalk.cyan(num)}  ${name}  ${chalk.dim(dir)}  ${taskStr}  ${status}${schedule}`)
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

  // Non-interactive if all args provided
  if (name !== undefined && options.dir !== undefined) {
    writeQueue(configPath, config.tasks_dir, name, options.dir, options.schedule)
    return
  }

  console.log()
  console.log(chalk.bold('orc-lite') + chalk.dim(' — add queue'))
  console.log(chalk.dim('─'.repeat(30)))
  console.log()

  const queueName = name ?? (await input({
    message: 'Queue name:',
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

  writeQueue(configPath, config.tasks_dir, queueName, queueDir, schedule)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function writeQueue(
  configPath: string,
  globalTasksDir: string,
  name: string,
  dir: string,
  schedule?: string,
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
