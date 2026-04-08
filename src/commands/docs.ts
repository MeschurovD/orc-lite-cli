import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import chalk from 'chalk'

const DOCS_FILENAME = '.orc-lite.md'

const DOCS_CONTENT = `# orc-lite Reference

CLI orchestrator for autonomous sequential task execution using opencode.
Runs tasks from markdown files one by one, commits and merges results.
Supports multiple task queues with an optional scheduler for overnight runs.

## Commands

| Command | Description |
|---|---|
| \`orc-lite init\` | Create \`orc-lite.config.json\` interactively |
| \`orc-lite run [N]\` | Run queue N (or first pending queue) |
| \`orc-lite run --all\` | Run all pending queues sequentially |
| \`orc-lite run --dry-run\` | Preview pipeline without executing |
| \`orc-lite status\` | Show queues and task status |
| \`orc-lite add <file>\` | Add task file to a queue (creates template if missing) |
| \`orc-lite reset <file>\` | Reset a failed/conflict task to pending |
| \`orc-lite logs [task]\` | View task logs; --tail to follow |
| \`orc-lite validate\` | Check config, files, git, opencode availability |
| \`orc-lite schedule [N] <time>\` | Set schedule for a queue |
| \`orc-lite schedule --list\` | List all scheduled jobs (all repos) |
| \`orc-lite schedule --cancel [id]\` | Cancel scheduled job(s) |
| \`orc-lite register\` | Register queues with schedule into global scheduler |
| \`orc-lite daemon\` | Start background scheduler process |
| \`orc-lite docs\` | Generate this reference file in the project |

## Config: \`orc-lite.config.json\`

\`\`\`json
{
  "target_branch": "main",
  "tasks_dir": "./tasks",
  "logs_dir": "./.orc-lite/logs",
  "on_failure": "stop",
  "push": "none",
  "max_retries": 0,
  "verification_cmd": "npm test",
  "commit_template": "task: {{task_name}}",
  "system_prompt": "Optional prompt prepended to every task.",
  "adapter_options": {
    "timeout": 600
  },
  "hooks": {
    "pre_task": "npm install",
    "post_task": "npm run lint:fix"
  },
  "daemon": {
    "poll_interval": 60,
    "log_file": ".orc-lite/daemon.log"
  },
  "notifications": {
    "telegram": {
      "bot_token": "123456:ABC-DEF...",
      "chat_id": "-1001234567890",
      "proxy": "http://user:pass@host:port",
      "use_env_proxy": false
    },
    "on": ["task_done", "task_failed", "pipeline_done", "pipeline_failed"]
  },
  "queues": [
    {
      "name": "auth-refactor",
      "schedule": null,
      "status": "pending",
      "tasks": [
        {
          "file": "01-fix-login.md",
          "status": "pending",
          "context_files": ["src/auth.ts"],
          "verification_cmd": "npm run test:auth",
          "max_retries": 2,
          "stages": ["implement", "verify"],
          "hooks": { "pre_task": "npx prisma generate" }
        }
      ]
    },
    {
      "name": "nightly-fixes",
      "schedule": "2:30",
      "status": "pending",
      "tasks": [
        { "file": "02-fix-api.md", "status": "pending" }
      ]
    }
  ]
}
\`\`\`

Backward compat: a flat \`"tasks"\` array (orc-cli format) is automatically wrapped into a single \`default\` queue.

## Config Fields

| Field | Type | Default | Description |
|---|---|---|---|
| \`target_branch\` | string | *required* | Branch to merge completed tasks into |
| \`tasks_dir\` | string | *required* | Directory with task \`.md\` files |
| \`logs_dir\` | string | *required* | Directory for log output |
| \`on_failure\` | \`"stop"\` | \`"stop"\` | Pipeline behavior on failure |
| \`push\` | \`"each"\` \\| \`"end"\` \\| \`"none"\` | \`"none"\` | When to push target branch to origin |
| \`max_retries\` | number | \`0\` | Default retry count for failed tasks |
| \`verification_cmd\` | string | — | Command to run after each task |
| \`commit_template\` | string | \`"task: {{task_name}}"\` | Commit message template |
| \`system_prompt\` | string | — | Prompt prepended to every task |
| \`adapter_options.timeout\` | number | \`600\` | Per-task timeout in seconds |
| \`hooks.pre_task\` | string | — | Command before opencode runs |
| \`hooks.post_task\` | string | — | Command after opencode runs |
| \`daemon.poll_interval\` | number | \`60\` | Seconds between scheduler.json re-reads |
| \`daemon.log_file\` | string | — | Path for daemon log output |
| \`notifications.telegram\` | object | — | \`bot_token\` + \`chat_id\` |
| \`notifications.webhook\` | string | — | Generic webhook URL (POST with JSON) |
| \`notifications.proxy\` | string | — | HTTP proxy for notifications |
| \`notifications.use_env_proxy\` | boolean | \`false\` | Auto-detect HTTPS_PROXY from env |
| \`notifications.on\` | string[] | — | Events to notify on |

### Commit Template Variables

\`{{task_name}}\` — filename without .md, \`{{task_file}}\` — full filename,
\`{{first_line}}\` — first non-empty line from .md, \`{{index}}\` — task number (1-based), \`{{total}}\` — total tasks.

### Task-Level Overrides

Each task can override: \`verification_cmd\`, \`max_retries\`, \`hooks\`, \`branch\`, \`context_files\`, \`stages\`.

### Stages

By default each task runs only \`implement\`. Optionally add \`verify\` and \`test\`:

\`\`\`json
{
  "stages": {
    "verify": { "threshold": 80, "on_fail": "stop" },
    "test": { "timeout": 600 }
  },
  "queues": [{
    "tasks": [{
      "file": "critical.md",
      "stages": ["implement", "verify", "test"]
    }]
  }]
}
\`\`\`

After \`implement\`, the \`verify\` stage asks opencode to assess implementation completeness (outputs JSON with score 0–100).
If \`score >= threshold\` — proceeds. If below — writes \`<task-name>-review.md\` and stops/continues per \`on_fail\`.

The \`test\` stage asks opencode to write and run tests covering the implementation.

## Schedule Format

| Input | Interpretation |
|---|---|
| \`"2:30"\` | Next occurrence of 2:30 AM (tonight or tomorrow) |
| \`"14:30"\` | Next occurrence of 14:30 |
| \`"2026-04-09"\` | That date at 00:00 |
| \`"2026-04-09 2:30"\` | That date at 2:30 |
| \`"2026-04-09T02:30:00"\` | ISO 8601 exact |

Global scheduler registry: \`~/.orc-lite/scheduler.json\`

## Task Statuses

| Status | Meaning |
|---|---|
| \`pending\` | Not started |
| \`in_progress\` | Running now |
| \`done\` | Completed and merged |
| \`failed\` | Failed (opencode, hook, or verification) |
| \`conflict\` | Merge conflict on target branch |
| \`skipped\` | Skipped (not applicable) |

## Queue Statuses

\`pending\` → \`in_progress\` → \`done\` / \`failed\`

## Notification Events

\`task_done\`, \`task_failed\`, \`task_conflict\`, \`pipeline_done\`, \`pipeline_failed\`

## Pipeline Flow

1. Checkout \`target_branch\`
2. Create task branch \`task/<name>\`
3. Run \`pre_task\` hook
4. For each stage in \`task.stages\` (default: \`["implement"]\`):
   - \`implement\`: build prompt → run opencode → commit
   - \`verify\`: run opencode with implementation summary → parse score → commit if changes
   - \`test\`: run opencode → write/run tests → commit
5. Run \`post_task\` hook
6. Run \`verification_cmd\` (if configured)
7. Merge into \`target_branch\`
8. Push if \`push: "each"\` → send notification
9. Update task status → repeat for next task

If any step fails and \`max_retries > 0\`, branch is recreated and all stages retried from scratch.
On failure or merge conflict the queue stops. Logs: \`<logs_dir>/<task-name>.log\`.

## Resuming After Failure

\`\`\`bash
orc-lite reset <task-file.md>
orc-lite run
\`\`\`

## Scheduler Workflow (overnight)

\`\`\`bash
# Schedule a queue
orc-lite schedule 2:00

# Register + start daemon
orc-lite register
orc-lite daemon &

# Check results next morning
orc-lite status
orc-lite logs
\`\`\`

Daemon PID file: \`~/.orc-lite/daemon.pid\`
Overdue jobs (< 1h): run immediately. Overdue > 1h: skip with warning.

## Task File Format

Plain markdown — write like a prompt:

\`\`\`markdown
# Add user authentication

Implement JWT auth:
- POST /auth/login — email + password, returns JWT
- POST /auth/register — creates user
- Add authenticate middleware
- Protect /api/* routes

## Context

See src/auth/ for existing code. Use existing User model from src/models/user.ts.
\`\`\`
`

export function docsCommand(options: { output?: string; force?: boolean }): void {
  const outputPath = resolve(options.output ?? DOCS_FILENAME)

  if (existsSync(outputPath) && !options.force) {
    console.error(chalk.yellow(`${outputPath} already exists. Use --force to overwrite.`))
    process.exit(1)
  }

  writeFileSync(outputPath, DOCS_CONTENT, 'utf-8')
  console.log(chalk.green(`✓ Generated ${outputPath}`))
}
