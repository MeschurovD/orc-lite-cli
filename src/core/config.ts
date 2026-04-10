import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { OrcLiteConfig, TaskDefinition, QueueDefinition } from '../types.js'

export const CONFIG_FILENAME = 'orc-lite.config.json'

// ─── Schema ──────────────────────────────────────────────────────────────────

const hooksSchema = z.object({
  pre_task: z.string().optional(),
  post_task: z.string().optional(),
}).optional()

const stageConfigSchema = z.object({
  prompt_template: z.string().optional(),
  model: z.string().optional(),
  timeout: z.number().positive().optional(),
  threshold: z.number().min(0).max(100).optional(),
  on_fail: z.enum(['stop', 'continue']).optional(),
}).optional()

const stagesConfigSchema = z.object({
  verify: stageConfigSchema,
  test: stageConfigSchema,
}).optional()

const taskSchema = z.object({
  file: z.string().min(1),
  status: z.enum(['pending', 'in_progress', 'done', 'failed', 'conflict', 'skipped']),
  branch: z.string().optional(),
  context_files: z.array(z.string()).optional(),
  verification_cmd: z.string().optional(),
  max_retries: z.number().int().min(0).optional(),
  hooks: hooksSchema,
  stages: z.array(z.enum(['implement', 'verify', 'test']))
    .refine(
      (stages) => stages.length === 0 || stages[0] === 'implement',
      { message: 'stages[0] must be "implement"' },
    )
    .optional(),
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
  error: z.string().optional(),
  retry_count: z.number().int().min(0).optional(),
  tokens_used: z.number().int().min(0).optional(),
  cost_usd: z.number().min(0).optional(),
})

const queueSchema = z.object({
  name: z.string().optional(),
  schedule: z.string().nullable().optional(),
  status: z.enum(['pending', 'in_progress', 'done', 'failed']).default('pending'),
  tasks: z.array(taskSchema).min(1, 'queue tasks must not be empty'),
})

const notificationsSchema = z.object({
  telegram: z.object({
    bot_token: z.string().optional(),
    chat_id: z.string().optional(),
    proxy: z.string().optional(),
    use_env_proxy: z.boolean().optional(),
  }).optional(),
  webhook: z.string().url().optional(),
  proxy: z.string().optional(),
  use_env_proxy: z.boolean().optional(),
  on: z.array(z.enum([
    'task_done',
    'task_failed',
    'task_conflict',
    'pipeline_done',
    'pipeline_failed',
  ])),
}).optional()

const autoPrSchema = z.object({
  enabled: z.boolean(),
  base_branch: z.string().optional(),
  title_template: z.string().optional(),
  draft: z.boolean().optional(),
}).optional()

const daemonSchema = z.object({
  poll_interval: z.number().int().positive().optional(),
  log_file: z.string().optional(),
}).optional()

const baseSchema = z.object({
  project_name: z.string().optional(),
  target_branch: z.string().default(''),
  tasks_dir: z.string().min(1, 'tasks_dir is required'),
  logs_dir: z.string().min(1, 'logs_dir is required'),
  on_failure: z.literal('stop').default('stop'),
  verification_cmd: z.string().optional(),
  system_prompt: z.string().optional(),
  commit_template: z.string().optional(),
  adapter_options: z.object({
    timeout: z.number().positive().optional(),
  }).default({}),
  push: z.enum(['each', 'end', 'none']).default('none'),
  git_strategy: z.enum(['branch', 'commit', 'none']).default('branch'),
  max_retries: z.number().int().min(0).default(0),
  hooks: hooksSchema,
  stages: stagesConfigSchema,
  notifications: notificationsSchema,
  auto_pr: autoPrSchema,
  daemon: daemonSchema,
})

// Raw config can have either "queues" or legacy "tasks"
const rawConfigSchema = baseSchema.extend({
  queues: z.array(queueSchema).optional(),
  tasks: z.array(taskSchema).optional(),
}).superRefine((data, ctx) => {
  if (data.git_strategy === 'branch' && !data.target_branch) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['target_branch'],
      message: 'target_branch is required when git_strategy is "branch"',
    })
  }
})

// ─── Public API ──────────────────────────────────────────────────────────────

export function loadConfig(configPath?: string): { config: OrcLiteConfig; path: string } {
  const resolvedPath = resolve(configPath ?? CONFIG_FILENAME)

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(resolvedPath, 'utf-8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Config file not found: ${resolvedPath}`)
    }
    throw new Error(`Failed to parse config file: ${(err as Error).message}`)
  }

  const result = rawConfigSchema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid config:\n${issues}`)
  }

  const data = result.data

  // Backward compat: if only "tasks" is present, wrap into default queue
  let queues: QueueDefinition[]
  if (data.queues && data.queues.length > 0) {
    queues = data.queues as QueueDefinition[]
  } else if (data.tasks && data.tasks.length > 0) {
    queues = [{ name: 'default', schedule: null, status: 'pending', tasks: data.tasks as TaskDefinition[] }]
  } else {
    throw new Error('Config must have either "queues" or "tasks" array')
  }

  const config: OrcLiteConfig = {
    project_name: data.project_name,
    target_branch: data.target_branch,
    tasks_dir: data.tasks_dir,
    logs_dir: data.logs_dir,
    on_failure: data.on_failure,
    verification_cmd: data.verification_cmd,
    system_prompt: data.system_prompt,
    commit_template: data.commit_template,
    adapter_options: data.adapter_options,
    push: data.push,
    git_strategy: data.git_strategy,
    max_retries: data.max_retries,
    hooks: data.hooks,
    stages: data.stages,
    notifications: data.notifications,
    auto_pr: data.auto_pr,
    daemon: data.daemon,
    queues,
  }

  return { config, path: resolvedPath }
}

export function saveConfig(configPath: string, config: OrcLiteConfig): void {
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

export function updateTaskStatus(
  configPath: string,
  queueIndex: number,
  taskIndex: number,
  updates: Partial<TaskDefinition>,
): void {
  const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>

  // Handle both formats in the raw file
  if (Array.isArray(raw['queues'])) {
    const queues = raw['queues'] as Array<{ tasks: TaskDefinition[] }>
    queues[queueIndex].tasks[taskIndex] = {
      ...queues[queueIndex].tasks[taskIndex],
      ...updates,
    }
  } else if (Array.isArray(raw['tasks'])) {
    // Legacy format: single queue
    const tasks = raw['tasks'] as TaskDefinition[]
    tasks[taskIndex] = { ...tasks[taskIndex], ...updates }
  }

  writeFileSync(configPath, JSON.stringify(raw, null, 2) + '\n', 'utf-8')
}

export function updateQueueStatus(
  configPath: string,
  queueIndex: number,
  status: 'pending' | 'in_progress' | 'done' | 'failed',
): void {
  const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>

  if (Array.isArray(raw['queues'])) {
    const queues = raw['queues'] as Array<{ status: string }>
    queues[queueIndex].status = status
  }
  // Legacy format has no queue-level status, skip

  writeFileSync(configPath, JSON.stringify(raw, null, 2) + '\n', 'utf-8')
}

export function getTaskBranchName(task: TaskDefinition): string {
  if (task.branch) return task.branch
  const base = task.file.replace(/\.md$/i, '').replace(/[^a-zA-Z0-9_-]/g, '-')
  return `task/${base}`
}

export function renderCommitMessage(template: string | undefined, vars: {
  task_name: string
  task_file: string
  first_line: string
  index: number
  total: number
}): string {
  const tmpl = template ?? 'task: {{task_name}}'
  return tmpl
    .replace(/\{\{task_name\}\}/g, vars.task_name)
    .replace(/\{\{task_file\}\}/g, vars.task_file)
    .replace(/\{\{first_line\}\}/g, vars.first_line)
    .replace(/\{\{index\}\}/g, String(vars.index))
    .replace(/\{\{total\}\}/g, String(vars.total))
}
