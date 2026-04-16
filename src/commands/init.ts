import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import chalk from 'chalk'
import { select, input, confirm } from '@inquirer/prompts'
import type { OrcLiteConfig, TaskDefinition, QueueDefinition } from '../types.js'
import { CONFIG_FILENAME } from '../core/config.js'

export async function initCommand(): Promise<void> {
  const configPath = resolve(CONFIG_FILENAME)

  if (existsSync(configPath)) {
    console.error(chalk.red(`${CONFIG_FILENAME} already exists. Remove it first to re-initialize.`))
    process.exit(1)
  }

  console.log()
  console.log(chalk.bold('orc-lite init'))
  console.log(chalk.dim(`Create ${CONFIG_FILENAME} for this project`))
  console.log()

  // ── Git strategy ──────────────────────────────────────────────────────────────

  const gitStrategy = await select<'branch' | 'commit' | 'none'>({
    message: 'Git strategy:',
    choices: [
      { name: 'branch — create a branch per task', value: 'branch' },
      { name: 'commit — commit directly to target branch', value: 'commit' },
      { name: 'none — no git operations', value: 'none' },
    ],
  })

  let targetBranch = ''
  if (gitStrategy === 'branch') {
    targetBranch = (await input({
      message: 'Target branch:',
      default: 'main',
    })).trim() || 'main'
  }

  // ── Directories ───────────────────────────────────────────────────────────────

  const tasksDir = (await input({
    message: 'Global tasks directory:',
    default: './tasks',
  })).trim() || './tasks'

  const logsDir = (await input({
    message: 'Logs directory:',
    default: './.orc-lite/logs',
  })).trim() || './.orc-lite/logs'

  // ── Optional settings ─────────────────────────────────────────────────────────

  const verifyCmd = (await input({
    message: 'Verification command (leave empty to skip):',
  })).trim()

  const systemPrompt = (await input({
    message: 'System prompt (leave empty to skip):',
  })).trim()

  // ── Queues ────────────────────────────────────────────────────────────────────

  const queueMode = await select<'single' | 'multiple'>({
    message: 'Queue setup:',
    choices: [
      { name: '1 queue (simple)', value: 'single' },
      { name: 'Multiple queues', value: 'multiple' },
    ],
  })

  const queues: QueueDefinition[] = []

  if (queueMode === 'single') {
    const queueName = (await input({
      message: 'Queue name:',
      default: 'default',
    })).trim() || 'default'

    queues.push(buildQueue(queueName, tasksDir, tasksDir))
  } else {
    let queueNum = 1
    let addMore = true

    while (addMore) {
      console.log()
      console.log(chalk.dim(`Queue ${queueNum}:`))

      const queueName = (await input({
        message: `  Name:`,
        default: queueNum === 1 ? 'default' : `queue-${queueNum}`,
      })).trim() || `queue-${queueNum}`

      const queueDir = (await input({
        message: `  Tasks directory ${chalk.dim(`(enter for ${tasksDir})`)}:`,
      })).trim() || tasksDir

      queues.push(buildQueue(queueName, queueDir, tasksDir))
      queueNum++

      addMore = await confirm({ message: 'Add another queue?', default: false })
    }
  }

  // ── Write config ──────────────────────────────────────────────────────────────

  const config: OrcLiteConfig = {
    project_name: basename(resolve('.')),
    target_branch: targetBranch,
    tasks_dir: tasksDir,
    logs_dir: logsDir,
    on_failure: 'stop',
    adapter_options: { timeout: 600 },
    push: 'none',
    git_strategy: gitStrategy,
    max_retries: 0,
    queues,
  }

  if (verifyCmd) config.verification_cmd = verifyCmd
  if (systemPrompt) config.system_prompt = systemPrompt

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')

  console.log()
  console.log(chalk.green(`✓ Created ${CONFIG_FILENAME}`))
  console.log(chalk.dim(`  ${queues.length} queue${queues.length !== 1 ? 's' : ''} configured`))
  console.log(chalk.dim(`  Run ${chalk.white('orc-lite add')} to add tasks`))
  console.log()
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildQueue(name: string, dir: string, globalTasksDir: string): QueueDefinition {
  const resolvedDir = resolve(dir)
  let tasks: TaskDefinition[] = []

  if (existsSync(resolvedDir)) {
    const files = readdirSync(resolvedDir).filter((f) => f.endsWith('.md')).sort()
    tasks = files.map((file) => ({ file, status: 'pending' as const }))

    if (tasks.length > 0) {
      console.log(chalk.green(`  Found ${tasks.length} task file(s) in ${dir}`))
    } else {
      console.log(chalk.yellow(`  No .md files found in ${dir}`))
    }
  } else {
    console.log(chalk.yellow(`  Directory "${dir}" not found — creating...`))
    mkdirSync(resolvedDir, { recursive: true })
  }

  const queue: QueueDefinition = {
    name,
    schedule: null,
    status: 'pending',
    tasks,
  }

  // Only set tasks_dir if it differs from global
  if (dir !== globalTasksDir) queue.tasks_dir = dir

  return queue
}
