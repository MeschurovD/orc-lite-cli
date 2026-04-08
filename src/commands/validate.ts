import { accessSync, constants, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import chalk from 'chalk'
import { loadConfig } from '../core/config.js'
import { GitService } from '../services/git.js'
import { createAdapter } from '../adapters/opencode-adapter.js'

function ok(msg: string): void {
  console.log(`${chalk.green('✓')} ${msg}`)
}

function fail(msg: string): void {
  console.log(`${chalk.red('✗')} ${msg}`)
}

export async function validateCommand(options: { config?: string }): Promise<void> {
  const cwd = process.cwd()
  let hasErrors = false

  console.log()

  // ── 1. Config loads & validates ──────────────────────────────────────────────
  let config: ReturnType<typeof loadConfig>['config'] | null = null
  let resolvedConfigPath: string
  try {
    const result = loadConfig(options.config)
    config = result.config
    resolvedConfigPath = result.path
    ok(`Config valid: ${resolvedConfigPath}`)
  } catch (err) {
    fail(`Config invalid: ${(err as Error).message}`)
    console.log()
    process.exit(1)
  }

  // ── 2. Queues exist and have tasks ───────────────────────────────────────────
  const totalQueues = config.queues.length
  ok(`${totalQueues} queue${totalQueues !== 1 ? 's' : ''} found`)

  // ── 3. Task files exist ──────────────────────────────────────────────────────
  let missingTasks = 0
  let totalTasks = 0
  for (const queue of config.queues) {
    for (const task of queue.tasks) {
      totalTasks++
      const taskPath = resolve(cwd, config.tasks_dir, task.file)
      if (!existsSync(taskPath)) {
        fail(`Task file not found: ${config.tasks_dir}/${task.file}`)
        missingTasks++
        hasErrors = true
      }
    }
  }
  if (missingTasks === 0) {
    ok(`${totalTasks} task file${totalTasks !== 1 ? 's' : ''} found`)
  }

  // ── 4. Context files exist ───────────────────────────────────────────────────
  let missingContext = 0
  let totalContextFiles = 0
  for (const queue of config.queues) {
    for (const task of queue.tasks) {
      if (!task.context_files?.length) continue
      for (const ctxFile of task.context_files) {
        totalContextFiles++
        if (!existsSync(resolve(cwd, ctxFile))) {
          fail(`Context file not found: ${ctxFile} (referenced by ${task.file})`)
          missingContext++
          hasErrors = true
        }
      }
    }
  }
  if (missingContext === 0 && totalContextFiles > 0) {
    ok(`${totalContextFiles} context file${totalContextFiles !== 1 ? 's' : ''} found`)
  }

  // ── 5. Target branch exists ──────────────────────────────────────────────────
  const git = new GitService(cwd)
  try {
    await git.ensureGitRepo()
    await git.ensureBranchExists(config.target_branch)
    ok(`Target branch "${config.target_branch}" exists`)
  } catch (err) {
    fail((err as Error).message)
    hasErrors = true
  }

  // ── 6. Working tree is clean ─────────────────────────────────────────────────
  try {
    await git.ensureCleanWorkingTree()
    ok('Working tree clean')
  } catch {
    fail('Working tree has uncommitted changes')
    hasErrors = true
  }

  // ── 7. opencode installed ────────────────────────────────────────────────────
  const adapter = createAdapter(config.adapter_options)
  const installed = await adapter.isInstalled()
  if (installed) {
    ok('opencode CLI found')
  } else {
    fail('opencode CLI not found in PATH')
    hasErrors = true
  }

  // ── 8. Logs directory writable ───────────────────────────────────────────────
  const logsDir = resolve(cwd, config.logs_dir)
  try {
    mkdirSync(logsDir, { recursive: true })
    accessSync(logsDir, constants.W_OK)
    ok(`Logs directory writable: ${config.logs_dir}`)
  } catch {
    fail(`Logs directory not writable: ${logsDir}`)
    hasErrors = true
  }

  console.log()

  if (hasErrors) {
    console.log(chalk.red('Validation failed — fix the issues above before running.'))
    console.log()
    process.exit(1)
  } else {
    console.log(chalk.green('✓ Ready to run'))
    console.log()
  }
}
