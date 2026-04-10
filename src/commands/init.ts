import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { createInterface } from 'node:readline'
import chalk from 'chalk'
import type { OrcLiteConfig, TaskDefinition, QueueDefinition } from '../types.js'
import { CONFIG_FILENAME } from '../core/config.js'

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve))
}

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

  const rl = createInterface({ input: process.stdin, output: process.stdout })

  try {
    const gitStrategyInput = (await prompt(rl, `Git strategy ${chalk.dim('(branch/commit/none) [branch]')} : `)).trim() || 'branch'
    const gitStrategy = (['branch', 'commit', 'none'].includes(gitStrategyInput) ? gitStrategyInput : 'branch') as 'branch' | 'commit' | 'none'

    let targetBranch = ''
    if (gitStrategy === 'branch') {
      targetBranch = (await prompt(rl, `Target branch ${chalk.dim('(main)')} : `)).trim() || 'main'
    }

    const tasksDir = (await prompt(rl, `Tasks directory ${chalk.dim('(./tasks)')} : `)).trim() || './tasks'
    const logsDir = (await prompt(rl, `Logs directory ${chalk.dim('(./.orc-lite/logs)')} : `)).trim() || './.orc-lite/logs'
    const verifyCmd = (await prompt(rl, `Verification command ${chalk.dim('(leave empty to skip)')} : `)).trim()
    const systemPrompt = (await prompt(rl, `System prompt ${chalk.dim('(leave empty to skip)')} : `)).trim()
    const queueName = (await prompt(rl, `First queue name ${chalk.dim('(default)')} : `)).trim() || 'default'

    // Auto-discover task files
    const tasksDirResolved = resolve(tasksDir)
    let tasks: TaskDefinition[] = []

    if (existsSync(tasksDirResolved)) {
      const files = readdirSync(tasksDirResolved)
        .filter((f) => f.endsWith('.md'))
        .sort()

      tasks = files.map((file) => ({ file, status: 'pending' as const }))

      if (tasks.length > 0) {
        console.log()
        console.log(chalk.green(`Found ${tasks.length} task file(s) in ${tasksDir}:`))
        tasks.forEach((t, i) => console.log(chalk.dim(`  ${i + 1}. ${t.file}`)))
      } else {
        console.log()
        console.log(chalk.yellow(`No .md files found in ${tasksDir}. Add task files and update ${CONFIG_FILENAME}.`))
        tasks = [{ file: 'example-task.md', status: 'pending' }]
      }
    } else {
      console.log()
      console.log(chalk.yellow(`Directory "${tasksDir}" not found. Creating it...`))
      mkdirSync(tasksDirResolved, { recursive: true })
      tasks = [{ file: 'example-task.md', status: 'pending' }]
    }

    const queue: QueueDefinition = {
      name: queueName,
      schedule: null,
      status: 'pending',
      tasks,
    }

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
      queues: [queue],
    }

    if (verifyCmd) config.verification_cmd = verifyCmd
    if (systemPrompt) config.system_prompt = systemPrompt

    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')

    console.log()
    console.log(chalk.green(`✓ Created ${CONFIG_FILENAME}`))
    console.log(chalk.dim(`  Run ${chalk.white('orc-lite run')} to start the queue`))
    console.log()
  } finally {
    rl.close()
  }
}
