import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import chalk from 'chalk'
import { loadConfig, saveConfig } from '../core/config.js'
import type { TaskDefinition } from '../types.js'

export interface AddOptions {
  config?: string
  queue?: string
}

export function addCommand(file: string, options: AddOptions): void {
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

  // Determine queue index
  let qi: number

  if (options.queue !== undefined) {
    const n = parseInt(options.queue, 10)
    if (isNaN(n) || n < 1) {
      console.error(chalk.red(`Invalid queue number: ${options.queue}`))
      process.exit(1)
    }
    qi = n - 1
    if (qi >= config.queues.length) {
      console.error(chalk.red(`Queue #${n} not found (${config.queues.length} queues total)`))
      process.exit(1)
    }
  } else {
    qi = config.queues.findIndex((q) => q.status !== 'done')
    if (qi === -1) {
      console.error(chalk.yellow('All queues are done. Use -q to specify a queue.'))
      process.exit(1)
    }
  }

  const queue = config.queues[qi]
  const label = queue.name ?? `#${qi + 1}`

  // Check if task already in queue
  const alreadyExists = queue.tasks.some((t) => t.file === file)
  if (alreadyExists) {
    console.error(chalk.yellow(`Task "${file}" is already in queue ${label}`))
    process.exit(1)
  }

  // Create template file if it doesn't exist
  const taskPath = resolve(cwd, config.tasks_dir, file)
  if (!existsSync(taskPath)) {
    mkdirSync(dirname(taskPath), { recursive: true })
    writeFileSync(taskPath, buildTaskTemplate(file))
    console.log(chalk.dim(`  Created task file: ${taskPath}`))
  }

  const task: TaskDefinition = {
    file,
    status: 'pending',
  }

  config.queues[qi].tasks.push(task)
  saveConfig(configPath, config)

  console.log(
    chalk.green('✓') +
    ` Added "${chalk.bold(file)}" to queue ${chalk.bold(label)}` +
    chalk.dim(` (task #${queue.tasks.length})`),
  )
}

// ─── Template ─────────────────────────────────────────────────────────────────

function buildTaskTemplate(file: string): string {
  const name = basename(file, '.md').replace(/[-_]/g, ' ')
  return `# ${name}

## Goal

<!-- Describe what needs to be done -->

## Acceptance criteria

<!-- List the specific outcomes that define "done" -->
- [ ]

## Context

<!-- Any relevant files, links, or background information -->

## Notes

<!-- Additional constraints or hints for the AI -->
`
}
