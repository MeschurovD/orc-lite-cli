import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import chalk from 'chalk'
import { select, checkbox, confirm, input } from '@inquirer/prompts'
import { loadConfig, saveConfig } from '../core/config.js'
import type { TaskDefinition } from '../types.js'

export interface AddOptions {
  config?: string
  queue?: string
}

export async function addCommand(file: string | undefined, options: AddOptions): Promise<void> {
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

  if (file === undefined) {
    await interactiveAdd(config, configPath, cwd, options)
  } else {
    await quickAdd(file, config, configPath, cwd, options)
  }
}

// ─── Quick add (file argument provided) ───────────────────────────────────────

async function quickAdd(
  file: string,
  config: ReturnType<typeof loadConfig>['config'],
  configPath: string,
  cwd: string,
  options: AddOptions,
): Promise<void> {
  const qi = resolveQueueIndex(config, options.queue)
  if (qi === -1) {
    console.error(chalk.yellow('All queues are done. Use -q to specify a queue.'))
    process.exit(1)
  }

  const queue = config.queues[qi]
  const label = queue.name ?? `#${qi + 1}`
  const tasksDir = queue.tasks_dir ?? config.tasks_dir

  const alreadyExists = queue.tasks.some((t) => t.file === file)
  if (alreadyExists) {
    console.error(chalk.yellow(`Task "${file}" is already in queue ${label}`))
    process.exit(1)
  }

  createTaskFile(cwd, tasksDir, file)

  const task: TaskDefinition = { file, status: 'pending' }
  config.queues[qi].tasks.push(task)
  saveConfig(configPath, config)

  console.log(
    chalk.green('✓') +
    ` Added "${chalk.bold(file)}" to queue ${chalk.bold(label)}` +
    chalk.dim(` (task #${queue.tasks.length})`),
  )
}

// ─── Interactive add (no file argument) ───────────────────────────────────────

async function interactiveAdd(
  config: ReturnType<typeof loadConfig>['config'],
  configPath: string,
  cwd: string,
  _options: AddOptions,
): Promise<void> {
  console.log()
  console.log(chalk.bold('orc-lite') + chalk.dim(' — add tasks'))
  console.log(chalk.dim('─'.repeat(30)))
  console.log()

  // ── 1. Select queue ──────────────────────────────────────────────────────────

  const queueChoices = config.queues.map((q, i) => {
    const name = q.name ?? `Queue #${i + 1}`
    const dir = q.tasks_dir ?? config.tasks_dir
    const total = q.tasks.length
    const done = q.tasks.filter((t) => t.status === 'done').length
    const taskLabel = total === 1 ? '1 task' : `${total} tasks`
    const doneLabel = done > 0 ? chalk.dim(` (${done} done)`) : ''
    const statusLabel = q.status === 'done' ? chalk.dim('done') : chalk.cyan('pending')
    return {
      name: `${name}   ${chalk.dim(dir)}   ${chalk.dim(taskLabel)}   ${statusLabel}${doneLabel}`,
      value: i,
      short: name,
    }
  })

  const qi: number = await select({
    message: 'Select queue:',
    choices: queueChoices,
  })

  const queue = config.queues[qi]
  const tasksDir = queue.tasks_dir ?? config.tasks_dir
  const resolvedDir = resolve(cwd, tasksDir)

  // ── 2. Collect available files ───────────────────────────────────────────────

  const existingFiles = new Set(queue.tasks.map((t) => t.file))
  let availableFiles: string[] = []

  if (existsSync(resolvedDir)) {
    availableFiles = readdirSync(resolvedDir)
      .filter((f) => f.endsWith('.md'))
      .sort()
  }

  const fileChoices = availableFiles.map((f) => ({
    name: f,
    value: f,
    disabled: existingFiles.has(f) ? chalk.dim('(already added)') : false,
  }))

  // Add a separator and "new file" option
  fileChoices.push({
    name: chalk.dim('+ Enter new filename'),
    value: '__new__',
    disabled: false,
  })

  let selectedFiles: string[] = []

  if (fileChoices.length <= 1) {
    // No existing md files — go straight to new filename
    console.log(chalk.dim(`  No .md files found in ${tasksDir}`))
  } else {
    selectedFiles = await checkbox({
      message: 'Select files to add:',
      choices: fileChoices,
    })
  }

  // Handle "new file" option
  if (selectedFiles.includes('__new__') || selectedFiles.length === 0) {
    selectedFiles = selectedFiles.filter((f) => f !== '__new__')
    const newFile = (await input({
      message: 'New filename:',
      validate: (v) => v.endsWith('.md') ? true : 'Must end with .md',
    })).trim()
    if (newFile) selectedFiles.push(newFile)
  }

  if (selectedFiles.length === 0) {
    console.log(chalk.yellow('No files selected.'))
    return
  }

  // ── 3. Optional task options ─────────────────────────────────────────────────

  const configureOpts = await confirm({
    message: 'Configure options for selected tasks?',
    default: false,
  })

  let taskStages: string[] | undefined
  let contextFiles: string | undefined
  let retries: string | undefined

  if (configureOpts) {
    const stageChoices = await checkbox({
      message: 'Stages:',
      choices: [
        { name: 'implement', value: 'implement', checked: true },
        { name: 'verify', value: 'verify' },
        { name: 'test', value: 'test' },
      ],
    })
    taskStages = stageChoices.length > 0 ? stageChoices : undefined

    contextFiles = (await input({
      message: 'Context files (comma-separated, leave empty to skip):',
    })).trim()

    retries = (await input({
      message: 'Max retries (leave empty to skip):',
    })).trim()
  }

  // ── 4. Add tasks ─────────────────────────────────────────────────────────────

  const label = queue.name ?? `#${qi + 1}`
  let added = 0

  for (const f of selectedFiles) {
    if (existingFiles.has(f)) {
      console.log(chalk.yellow(`  Skipped "${f}" (already in queue)`))
      continue
    }

    createTaskFile(cwd, tasksDir, f)

    const task: TaskDefinition = { file: f, status: 'pending' }

    if (taskStages && taskStages.length > 0) {
      task.stages = taskStages as ('implement' | 'verify' | 'test')[]
    }
    if (contextFiles) {
      task.context_files = contextFiles.split(',').map((s) => s.trim()).filter(Boolean)
    }
    if (retries) {
      const n = parseInt(retries, 10)
      if (!isNaN(n)) task.max_retries = n
    }

    config.queues[qi].tasks.push(task)
    added++
  }

  saveConfig(configPath, config)

  console.log()
  console.log(
    chalk.green('✓') +
    ` Added ${added} task${added !== 1 ? 's' : ''} to queue ${chalk.bold(label)}`,
  )
  console.log()
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveQueueIndex(
  config: ReturnType<typeof loadConfig>['config'],
  queueOption: string | undefined,
): number {
  if (queueOption === undefined) {
    return config.queues.findIndex((q) => q.status !== 'done')
  }

  const n = parseInt(queueOption, 10)
  if (!isNaN(n) && n >= 1) {
    const qi = n - 1
    return qi < config.queues.length ? qi : -2
  }

  // By name
  const qi = config.queues.findIndex(
    (q) => q.name?.toLowerCase() === queueOption.toLowerCase(),
  )
  if (qi === -1) {
    console.error(chalk.red(`Queue "${queueOption}" not found`))
    process.exit(1)
  }
  return qi
}

function createTaskFile(cwd: string, tasksDir: string, file: string): void {
  const taskPath = resolve(cwd, tasksDir, file)
  if (!existsSync(taskPath)) {
    mkdirSync(dirname(taskPath), { recursive: true })
    writeFileSync(taskPath, buildTaskTemplate(file))
    console.log(chalk.dim(`  Created: ${taskPath}`))
  }
}

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
