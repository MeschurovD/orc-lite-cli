import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import chalk from 'chalk'
import { select, checkbox, input } from '@inquirer/prompts'
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
  console.log(chalk.bold('orc-lite') + chalk.dim(' — add / remove / reorder tasks'))
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

  // ── 2. File selection — check to add, uncheck to remove ─────────────────────

  const tasksByFile = new Map(queue.tasks.map((t) => [t.file, t]))
  const isRemovable = (t: TaskDefinition) => t.status === 'pending' || t.status === 'failed'

  const diskFiles: string[] = existsSync(resolvedDir)
    ? readdirSync(resolvedDir).filter((f) => f.endsWith('.md')).sort()
    : []

  type FileChoice = { name: string; value: string; checked?: boolean; disabled?: string | false }
  const fileChoices: FileChoice[] = []

  // Existing queue tasks (in queue order): removable = checked, others = disabled
  for (const task of queue.tasks) {
    if (isRemovable(task)) {
      const suffix = task.status === 'failed' ? chalk.red(' (failed)') : ''
      fileChoices.push({ name: task.file + suffix, value: task.file, checked: true })
    } else {
      fileChoices.push({ name: task.file, value: task.file, disabled: chalk.dim(`(${task.status})`) })
    }
  }

  // Files on disk not yet in queue
  for (const f of diskFiles) {
    if (!tasksByFile.has(f)) {
      fileChoices.push({ name: f, value: f, checked: false })
    }
  }

  // New file option
  fileChoices.push({ name: chalk.dim('+ Enter new filename'), value: '__new__' })

  let selectedFiles: string[] = []

  if (fileChoices.length <= 1) {
    console.log(chalk.dim(`  No .md files found in ${tasksDir}`))
  } else {
    selectedFiles = await checkbox({
      message: 'Queue tasks  ' + chalk.dim('(space = toggle, uncheck to remove)') + ':',
      choices: fileChoices,
    })
  }

  // Determine what changed
  const checkedSet = new Set(selectedFiles.filter((f) => f !== '__new__'))
  const toRemove = queue.tasks.filter((t) => isRemovable(t) && !checkedSet.has(t.file))
  const toAdd = [...checkedSet].filter((f) => !tasksByFile.has(f))

  // Handle new file input
  let newFiles: string[] = []
  if (selectedFiles.includes('__new__')) {
    const newFile = (await input({
      message: 'New filename:',
      validate: (v) => v.endsWith('.md') ? true : 'Must end with .md',
    })).trim()
    if (newFile) newFiles = [newFile]
  } else if (selectedFiles.length === 0 && queue.tasks.length === 0) {
    const newFile = (await input({
      message: 'New filename:',
      validate: (v) => v.endsWith('.md') ? true : 'Must end with .md',
    })).trim()
    if (newFile) newFiles = [newFile]
  }

  const allToAdd = [...toAdd, ...newFiles]

  if (toRemove.length === 0 && allToAdd.length === 0) {
    console.log(chalk.yellow('No changes.'))
    return
  }

  // ── 3. Configure options for newly added tasks ───────────────────────────────

  let taskStages: string[] | undefined
  let contextFiles: string | undefined
  let retries: string | undefined

  if (allToAdd.length > 0) {
    const configureOpts = await select({
      message: 'Task options for new tasks:',
      choices: [
        { name: 'Skip — add with defaults', value: false },
        { name: 'Configure — set stages, retries, context files', value: true },
      ],
    })

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
  }

  // ── 4. Apply changes ─────────────────────────────────────────────────────────

  const label = queue.name ?? `#${qi + 1}`

  // Remove unchecked tasks
  if (toRemove.length > 0) {
    const removeSet = new Set(toRemove.map((t) => t.file))
    config.queues[qi].tasks = config.queues[qi].tasks.filter((t) => !removeSet.has(t.file))
  }

  // Add new tasks
  let added = 0
  for (const f of allToAdd) {
    createTaskFile(cwd, tasksDir, f)
    const task: TaskDefinition = { file: f, status: 'pending' }
    if (taskStages && taskStages.length > 0) task.stages = taskStages as ('implement' | 'verify' | 'test')[]
    if (contextFiles) task.context_files = contextFiles.split(',').map((s) => s.trim()).filter(Boolean)
    if (retries) { const n = parseInt(retries, 10); if (!isNaN(n)) task.max_retries = n }
    config.queues[qi].tasks.push(task)
    added++
  }

  // ── 5. Reorder pending tasks ─────────────────────────────────────────────────

  const pendingCount = config.queues[qi].tasks.filter((t) => t.status === 'pending').length
  if (pendingCount > 1) {
    const shouldReorder = await select({
      message: 'Reorder pending tasks?',
      choices: [
        { name: 'No — keep current order', value: false },
        { name: 'Yes — pick execution order', value: true },
      ],
    })

    if (shouldReorder) {
      config.queues[qi].tasks = await reorderPendingTasks(config.queues[qi].tasks)
    }
  }

  saveConfig(configPath, config)

  console.log()
  if (toRemove.length > 0) {
    console.log(chalk.red('✓') + ` Removed ${toRemove.length} task${toRemove.length !== 1 ? 's' : ''} from queue ${chalk.bold(label)}`)
  }
  if (added > 0) {
    console.log(chalk.green('✓') + ` Added ${added} task${added !== 1 ? 's' : ''} to queue ${chalk.bold(label)}`)
  }
  console.log()
}

// ─── Reorder pending tasks interactively ──────────────────────────────────────

async function reorderPendingTasks(tasks: TaskDefinition[]): Promise<TaskDefinition[]> {
  const pool = tasks.filter((t) => t.status === 'pending')
  const ordered: TaskDefinition[] = []

  console.log()
  while (pool.length > 1) {
    const pos = ordered.length + 1
    const total = ordered.length + pool.length
    const idx = await select({
      message: `Position ${pos} of ${total}:`,
      choices: pool.map((t, i) => ({ name: t.file, value: i })),
    })
    ordered.push(pool[idx])
    pool.splice(idx, 1)
  }
  ordered.push(pool[0])
  console.log()

  // Replace pending slots in-place (preserves positions of done/failed/etc. tasks)
  const result = [...tasks]
  const pendingSlots: number[] = []
  result.forEach((t, i) => { if (t.status === 'pending') pendingSlots.push(i) })
  pendingSlots.forEach((slotIdx, i) => { result[slotIdx] = ordered[i] })

  return result
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
