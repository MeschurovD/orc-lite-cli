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
| \`orc-lite init\` | Create \`orc-lite.config.json\` interactively (supports multiple queues) |
| \`orc-lite run [N]\` | Run queue N (or first pending queue) |
| \`orc-lite run --all\` | Run all pending queues sequentially |
| \`orc-lite run --dry-run\` | Preview pipeline without executing |
| \`orc-lite status\` | Show queues and task status |
| \`orc-lite add [file]\` | Add task(s) to a queue — interactive without file arg |
| \`orc-lite reset [file]\` | Reset failed/stuck task — interactive recovery without file arg |
| \`orc-lite queue list\` | List all queues with status and configured defaults |
| \`orc-lite queue add [name]\` | Add a new queue interactively |
| \`orc-lite logs [task]\` | View task logs; --tail to follow |
| \`orc-lite validate\` | Check config, files, git, opencode availability |
| \`orc-lite schedule [N] <time>\` | Set schedule for a queue, register it, and auto-start daemon |
| \`orc-lite schedule --list\` | List all scheduled jobs (all repos) |
| \`orc-lite schedule --cancel [id]\` | Cancel scheduled job(s) |
| \`orc-lite register\` | Register queues from config into global scheduler; auto-starts daemon |
| \`orc-lite daemon\` | Start background scheduler process manually |
| \`orc-lite docs\` | Generate this reference file in the project |

## Config: \`orc-lite.config.json\`

\`\`\`json
{
  "target_branch": "main",
  "tasks_dir": "./tasks",
  "logs_dir": "./.orc-lite/logs",
  "on_failure": "stop",
  "push": "none",
  "git_strategy": "branch",
  "max_retries": 0,
  "retry": {
    "max_attempts": 3,
    "delay_seconds": 10,
    "backoff": "linear",
    "backoff_base": 30
  },
  "verification_cmd": "npm test",
  "commit_template": "task: {{task_name}}",
  "system_prompt": "Optional prompt prepended to every task.",
  "adapter_options": {
    "timeout": 600,
    "insecure_tls": false
  },
  "hooks": {
    "pre_task": "npm install",
    "post_task": "npm run lint:fix"
  },
  "stages": {
    "verify": {
      "threshold": 80,
      "on_fail": "retry",
      "max_retries": 2,
      "retry_prompt_template": null,
      "model": null,
      "timeout": 300
    },
    "test": {
      "on_fail": "continue",
      "timeout": 600
    }
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
      "tasks_dir": "tasks/auth",
      "schedule": null,
      "status": "pending",
      // Per-queue defaults — override global, task-level overrides these
      "stages": ["implement", "verify"],
      "max_retries": 2,
      "retry": { "max_attempts": 2, "delay_seconds": 10, "backoff": "linear" },
      "verification_cmd": "npm run test:auth",
      "tasks": [
        {
          "file": "fix-login.md",
          "status": "pending",
          "context_files": ["src/auth.ts"],
          // Task-level overrides queue defaults:
          "stages": ["implement", "verify", "test"],
          "retry": { "max_attempts": 3, "delay_seconds": 0 },
          "hooks": { "pre_task": "npx prisma generate" }
        }
      ]
    },
    {
      "name": "api-cleanup",
      "tasks_dir": "tasks/api",
      "schedule": null,
      "status": "pending",
      "tasks": [
        { "file": "fix-endpoint.md", "status": "pending" },
        { "file": "fix-auth-middleware.md", "status": "pending" }
      ]
    },
    {
      "name": "nightly-fixes",
      "schedule": "2:30",
      "status": "pending",
      "tasks": [
        { "file": "tasks/hotfix/urgent.md", "status": "pending" }
      ]
    }
  ]
}
\`\`\`

Backward compat: a flat \`"tasks"\` array (orc-cli format) is automatically wrapped into a single \`default\` queue.

### Task folder organisation

Tasks can be organised into subfolders two ways:

**1. Relative path in \`file\`** — works without any config changes, resolves against the global \`tasks_dir\`:
\`\`\`json
{ "file": "auth/fix-login.md", "status": "pending" }
\`\`\`
Points to \`<tasks_dir>/auth/fix-login.md\`. Branch name becomes \`task/auth-fix-login\`.

**2. Per-queue \`tasks_dir\`** — set a different base directory per queue so task \`file\` values stay short:
\`\`\`json
{
  "name": "auth-queue",
  "tasks_dir": "tasks/auth",
  "tasks": [
    { "file": "fix-login.md", "status": "pending" },
    { "file": "fix-tokens.md", "status": "pending" }
  ]
}
\`\`\`
Per-queue \`tasks_dir\` overrides the global one for that queue only. Queues without \`tasks_dir\` fall back to the global value.

## Config Fields

| Field | Type | Default | Description |
|---|---|---|---|
| \`target_branch\` | string | *required* | Branch to merge completed tasks into (can be empty string when \`git_strategy\` is not \`"branch"\`) |
| \`tasks_dir\` | string | *required* | Default directory with task \`.md\` files (overridable per queue) |
| \`logs_dir\` | string | *required* | Directory for log output |
| \`on_failure\` | \`"stop"\` | \`"stop"\` | Pipeline behavior on failure |
| \`push\` | \`"each"\` \\| \`"end"\` \\| \`"none"\` | \`"none"\` | When to push target branch to origin |
| \`git_strategy\` | \`"branch"\` \\| \`"commit"\` \\| \`"none"\` | \`"branch"\` | Git mode: branch-per-task, commit-in-place, or no git |
| \`max_retries\` | number | \`0\` | Fallback retry count (superseded by \`retry.max_attempts\` if set) |
| \`retry.max_attempts\` | number | — | Max outer retry attempts on error (takes priority over \`max_retries\`) |
| \`retry.delay_seconds\` | number | \`0\` | Base delay in seconds before each retry |
| \`retry.backoff\` | \`"none"\` \\| \`"linear"\` \\| \`"exponential"\` | \`"none"\` | Delay growth strategy between retries |
| \`retry.backoff_base\` | number | \`30\` | Seconds added per attempt: linear \`+base×N\`, exponential \`+base×2^(N-1)\` |
| \`verification_cmd\` | string | — | Shell command run after each task (non-zero exit = failure) |
| \`commit_template\` | string | \`"task: {{task_name}}"\` | Commit message template |
| \`system_prompt\` | string | — | Prompt prepended to every task |
| \`adapter_options.timeout\` | number | \`600\` | Per-task opencode timeout in seconds |
| \`adapter_options.insecure_tls\` | boolean | \`false\` | Skip TLS verification (\`NODE_TLS_REJECT_UNAUTHORIZED=0\`) |
| \`hooks.pre_task\` | string | — | Command run before opencode starts |
| \`hooks.post_task\` | string | — | Command run after opencode finishes |
| \`stages.verify.threshold\` | number | \`80\` | Min score (0–100) for verify to pass |
| \`stages.verify.on_fail\` | \`"stop"\` \\| \`"continue"\` \\| \`"retry"\` | \`"stop"\` | Action when verify fails |
| \`stages.verify.max_retries\` | number | \`2\` | Max inner verify-retry iterations (only when \`on_fail: "retry"\`) |
| \`stages.verify.retry_prompt_template\` | string | — | Custom prompt for retry implement (see variables below) |
| \`stages.verify.model\` | string | — | Override opencode model for the verify stage |
| \`stages.verify.timeout\` | number | — | Override timeout for the verify stage |
| \`stages.test.on_fail\` | \`"stop"\` \\| \`"continue"\` | \`"stop"\` | Action when test stage fails |
| \`stages.test.timeout\` | number | — | Override timeout for the test stage |
| \`daemon.poll_interval\` | number | \`60\` | Seconds between scheduler.json re-reads |
| \`daemon.log_file\` | string | — | Path for daemon log output |
| \`notifications.telegram.bot_token\` | string | — | Telegram bot token (or env var \`BOT_TOKEN\`) |
| \`notifications.telegram.chat_id\` | string | — | Telegram chat/channel ID (or env var \`CHAT_ID\`) |
| \`notifications.telegram.proxy\` | string | — | HTTP proxy for Telegram specifically (overrides global proxy) |
| \`notifications.telegram.use_env_proxy\` | boolean | \`false\` | Auto-detect proxy from env for Telegram |
| \`notifications.webhook\` | string | — | Generic webhook URL (POST with JSON payload) |
| \`notifications.proxy\` | string | — | HTTP proxy for all notifications |
| \`notifications.use_env_proxy\` | boolean | \`false\` | Auto-detect HTTPS_PROXY / HTTP_PROXY from env |
| \`notifications.on\` | string[] | — | Events to notify: \`task_done\`, \`task_failed\`, \`task_conflict\`, \`pipeline_done\`, \`pipeline_failed\` |

### Commit Template Variables

\`{{task_name}}\` — filename without .md, \`{{task_file}}\` — full filename,
\`{{first_line}}\` — first non-empty line from .md, \`{{index}}\` — task number (1-based), \`{{total}}\` — total tasks.

### Queue-Level Fields

| Field | Type | Description |
|---|---|---|
| \`name\` | string | Display name for the queue |
| \`tasks_dir\` | string | Override global \`tasks_dir\` for this queue only |
| \`schedule\` | string \\| null | When to run (see Schedule Format); \`null\` = manual only |
| \`status\` | string | Queue status (managed by orc-lite) |
| \`stages\` | string[] | Default stages for tasks in this queue |
| \`max_retries\` | number | Default max retries for tasks in this queue |
| \`retry\` | object | Default retry config for tasks in this queue |
| \`verification_cmd\` | string | Default verification command for tasks in this queue |

### Settings Fallback Chain

For \`stages\`, \`max_retries\`, \`retry\`, and \`verification_cmd\`, the first defined value wins:

\`\`\`
task-level  →  queue-level  →  global config
\`\`\`

Set queue-level defaults once; override per task only when needed.

### Task-Level Overrides

Each task can override: \`verification_cmd\`, \`max_retries\`, \`retry\`, \`hooks\`, \`branch\`, \`context_files\`, \`stages\`.

\`\`\`json
{
  "file": "critical-migration.md",
  "status": "pending",
  "branch": "feat/critical-migration",
  "context_files": ["src/db/schema.ts", "migrations/"],
  "verification_cmd": "npm run test:db",
  "stages": ["implement", "verify", "test"],
  "retry": { "max_attempts": 2, "delay_seconds": 30, "backoff": "exponential" },
  "hooks": { "pre_task": "npx prisma generate" }
}
\`\`\`

## Stages

By default each task runs only \`implement\`. Optionally add \`verify\` and/or \`test\`:

\`\`\`json
{
  "stages": ["implement", "verify", "test"]
}
\`\`\`

Stages always start with \`implement\`. Order: \`implement → verify → test\`.

### implement

Runs opencode with the task file as the prompt. Commits changes after completion.

### verify

After \`implement\`, runs opencode to assess whether the implementation fully satisfies the task requirements.
Outputs structured JSON:

\`\`\`json
{
  "approved": true,
  "score": 88,
  "reason": null,
  "short_summary": "All endpoints implemented, tests passing.",
  "full_summary": "## Review\\n...",
  "issues": []
}
\`\`\`

If \`score >= threshold\` and \`approved: true\` — stage passes.
Otherwise behaviour depends on \`on_fail\`:

| \`on_fail\` | Behaviour |
|---|---|
| \`"stop"\` (default) | Task fails; queue stops |
| \`"continue"\` | Task proceeds despite failed verify |
| \`"retry"\` | Re-runs implement with verify feedback, up to \`max_retries\` times |

#### Verify-retry loop (\`on_fail: "retry"\`)

When verify fails, orc-lite feeds the \`issues\` list and \`reason\` back into a new implement run — without resetting the git branch. The agent builds on its own previous work:

\`\`\`
implement → verify (failed, score 55)
  → issues: ["missing error handling", "no DB migration"]
  → retry implement with feedback
implement (retry 1) → verify (passed, score 91)
  → done
\`\`\`

Each inner retry commits incrementally on top of the previous state.
If all inner retries are exhausted and verify still fails, the outer retry loop (or failure) kicks in.

##### Custom retry prompt template

Use \`retry_prompt_template\` in \`stages.verify\` to override the default prompt sent on verify-retry.
Available variables:

| Variable | Description |
|---|---|
| \`{taskContent}\` | Contents of the task .md file |
| \`{implementOutput}\` | Output from the previous implement run |
| \`{gitDiff}\` | Current git diff (accumulated changes) |
| \`{verifyIssues}\` | Bulleted list of issues from the failed verify |
| \`{verifyReason}\` | Reason field from the verify JSON |
| \`{verifyScore}\` | Numeric score from the verify JSON |
| \`{attempt}\` | Current retry attempt number (1, 2, …) |

### test

After \`implement\` (and \`verify\` if present), runs opencode to write and execute tests covering the implementation.
Set \`on_fail: "continue"\` to keep the task passing even if tests fail.

## Retry Mechanism

orc-lite has two independent retry layers:

### Outer retry (general errors)

Triggered by: opencode failure, hook failure, unexpected exception.
Restarts the task **from scratch** — recreates the git branch, runs implement from the beginning.

\`\`\`json
{
  "retry": {
    "max_attempts": 3,
    "delay_seconds": 10,
    "backoff": "linear",
    "backoff_base": 30
  }
}
\`\`\`

Delay formula:
- \`"none"\`: always \`delay_seconds\`
- \`"linear"\`: \`delay_seconds + backoff_base × attempt\`
- \`"exponential"\`: \`delay_seconds + backoff_base × 2^(attempt-1)\`

\`retry.max_attempts\` takes priority over the legacy \`max_retries\` field.

### Inner verify-retry loop

Triggered by: \`stages.verify.on_fail: "retry"\` + verify fails.
Does **not** reset git — the agent continues working on top of its own changes.

\`\`\`json
{
  "stages": {
    "verify": {
      "on_fail": "retry",
      "max_retries": 2
    }
  }
}
\`\`\`

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
| \`failed\` | Failed (opencode, hook, verification, or all retries exhausted) |
| \`conflict\` | Merge conflict on target branch |
| \`skipped\` | Skipped (not applicable) |

## Queue Statuses

\`pending\` → \`in_progress\` → \`done\` / \`failed\`

## Notification Events

\`task_done\`, \`task_failed\`, \`task_conflict\`, \`pipeline_done\`, \`pipeline_failed\`

## Pipeline Flow

Behaviour depends on \`git_strategy\`:

**\`branch\` (default)** — isolated branch per task:
1. Checkout \`target_branch\`, create \`task/<name>\` (or \`branch\` if set)
2. Run \`pre_task\` hook
3. Run \`implement\` stage → commit
4. If \`verify\` in stages:
   - Run \`verify\` → commit
   - If failed and \`on_fail: "retry"\`: re-run \`implement\` with issues → re-run \`verify\` → repeat up to \`stages.verify.max_retries\` times
5. If \`test\` in stages: run \`test\` → commit
6. Run \`post_task\` hook + \`verification_cmd\`
7. Merge \`task/<name>\` into \`target_branch\`, push if \`push: "each"\`

**\`commit\`** — stay in current branch, commit after each task.
No branch creation or merge. Push if \`push: "each"\` / \`"end"\`.

**\`none\`** — no git operations at all.
Just runs opencode and leaves changes uncommitted.

If any outer step fails and retries are configured, the task restarts from step 1.
On failure or merge conflict the queue stops. Logs: \`<logs_dir>/<task-name>.log\`.

## Resuming After Failure

\`\`\`bash
# Interactive: pick failed tasks and choose recovery action
orc-lite reset

# Quick: reset a specific task
orc-lite reset fix-auth.md

# Then re-run the queue
orc-lite run
\`\`\`

**Interactive recovery actions:**

| Action | Effect |
|---|---|
| Reset | retry as-is |
| Bump timeout | doubles \`adapter_options.timeout\` globally |
| Add retries | sets \`max_retries\` on the task |
| Change stages | select new stage set |
| Mark as skipped | sets status to \`skipped\` |

The queue status (\`failed\`/\`in_progress\`) is reset to \`pending\` automatically.

## Notifications

### Telegram setup

1. Create a bot via [@BotFather](https://t.me/BotFather), copy the bot token.
2. Get your chat ID: add the bot to a chat/channel, then call \`https://api.telegram.org/bot<token>/getUpdates\`.
3. Add to config:

\`\`\`json
{
  "notifications": {
    "telegram": {
      "bot_token": "123456:ABC-DEF...",
      "chat_id": "-1001234567890"
    },
    "on": ["task_done", "task_failed", "task_conflict", "pipeline_done", "pipeline_failed"]
  }
}
\`\`\`

**Env vars instead of config** — \`bot_token\` and \`chat_id\` can be omitted if set as env variables:

\`\`\`bash
export BOT_TOKEN=123456:ABC-DEF...
export CHAT_ID=-1001234567890
\`\`\`

**Proxy** (if Telegram is blocked):

\`\`\`json
{
  "notifications": {
    "telegram": {
      "bot_token": "...",
      "chat_id": "...",
      "proxy": "http://user:pass@host:3128"
    },
    "on": ["task_failed", "pipeline_done"]
  }
}
\`\`\`

Or set \`"use_env_proxy": true\` to pick up \`HTTPS_PROXY\` / \`HTTP_PROXY\` automatically.

### Webhook

POST request with JSON body \`{ event, message, taskFile, durationMs, error, ... }\`:

\`\`\`json
{
  "notifications": {
    "webhook": "https://hooks.example.com/orc-lite",
    "on": ["pipeline_done", "pipeline_failed"]
  }
}
\`\`\`

## Scheduler Workflow (overnight)

\`\`\`bash
# Schedule a queue
orc-lite schedule 2:00

# Register queues — daemon starts automatically in background
orc-lite register

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
