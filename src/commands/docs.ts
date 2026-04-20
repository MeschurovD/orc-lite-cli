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

const DOCS_FILENAME_RU = '.orc-lite.ru.md'

const DOCS_CONTENT_RU = `# orc-lite — Справочник

CLI-оркестратор для автономного последовательного выполнения задач через opencode.
Запускает задачи из markdown-файлов по очереди, коммитит и мёрджит результаты.
Поддерживает несколько очередей задач с опциональным планировщиком для ночных запусков.

## Команды

| Команда | Описание |
|---|---|
| \`orc-lite init\` | Интерактивное создание \`orc-lite.config.json\` (поддерживает несколько очередей) |
| \`orc-lite run [N]\` | Запустить очередь N (или первую ожидающую) |
| \`orc-lite run --all\` | Запустить все ожидающие очереди последовательно |
| \`orc-lite run --dry-run\` | Предпросмотр пайплайна без выполнения |
| \`orc-lite status\` | Показать статус очередей и задач |
| \`orc-lite add [file]\` | Добавить задачу в очередь — интерактивный режим без аргумента |
| \`orc-lite reset [file]\` | Сбросить упавшую/зависшую задачу — интерактивное восстановление без аргумента |
| \`orc-lite queue list\` | Список всех очередей со статусом и настройками |
| \`orc-lite queue add [name]\` | Добавить новую очередь интерактивно |
| \`orc-lite logs [task]\` | Просмотр логов задачи; --tail для слежения в реальном времени |
| \`orc-lite validate\` | Проверить конфиг, файлы, git и доступность opencode |
| \`orc-lite schedule [N] <time>\` | Задать расписание очереди, зарегистрировать и авто-запустить daemon |
| \`orc-lite schedule --list\` | Список всех запланированных задач (все репозитории) |
| \`orc-lite schedule --cancel [id]\` | Отменить запланированную задачу |
| \`orc-lite register\` | Зарегистрировать очереди из конфига в планировщике; авто-запускает daemon |
| \`orc-lite daemon\` | Запустить фоновый процесс планировщика вручную |
| \`orc-lite docs\` | Сгенерировать этот справочный файл в проекте |

## Конфиг: \`orc-lite.config.json\`

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
  "system_prompt": "Опциональный промпт, добавляемый перед каждой задачей.",
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
    "on": ["task_done", "task_failed", "task_conflict", "pipeline_done", "pipeline_failed"]
  },
  "queues": [
    {
      "name": "auth-refactor",
      "tasks_dir": "tasks/auth",
      "schedule": null,
      "status": "pending",
      "stages": ["implement", "verify"],
      "max_retries": 2,
      "retry": { "max_attempts": 2, "delay_seconds": 10, "backoff": "linear" },
      "verification_cmd": "npm run test:auth",
      "tasks": [
        {
          "file": "fix-login.md",
          "status": "pending",
          "context_files": ["src/auth.ts"],
          "stages": ["implement", "verify", "test"],
          "retry": { "max_attempts": 3, "delay_seconds": 0 },
          "hooks": { "pre_task": "npx prisma generate" }
        }
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

Обратная совместимость: плоский массив \`"tasks"\` (формат orc-cli) автоматически оборачивается в очередь \`default\`.

### Организация папки задач

Задачи можно организовывать в подпапки двумя способами:

**1. Относительный путь в \`file\`** — работает без изменений конфига, разрешается относительно глобального \`tasks_dir\`:
\`\`\`json
{ "file": "auth/fix-login.md", "status": "pending" }
\`\`\`
Указывает на \`<tasks_dir>/auth/fix-login.md\`. Ветка: \`task/auth-fix-login\`.

**2. \`tasks_dir\` на уровне очереди** — отдельная базовая директория для очереди, файлы задач остаются короткими:
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
\`tasks_dir\` очереди перекрывает глобальный только для этой очереди.

## Поля конфига

| Поле | Тип | По умолчанию | Описание |
|---|---|---|---|
| \`target_branch\` | string | *обязательно* | Ветка для мёрджа завершённых задач (может быть пустой строкой при \`git_strategy\` не \`"branch"\`) |
| \`tasks_dir\` | string | *обязательно* | Директория с \`.md\` файлами задач (переопределяется на уровне очереди) |
| \`logs_dir\` | string | *обязательно* | Директория для логов |
| \`on_failure\` | \`"stop"\` | \`"stop"\` | Поведение при ошибке |
| \`push\` | \`"each"\` \\| \`"end"\` \\| \`"none"\` | \`"none"\` | Когда пушить целевую ветку в origin |
| \`git_strategy\` | \`"branch"\` \\| \`"commit"\` \\| \`"none"\` | \`"branch"\` | Git-режим: ветка на задачу, коммит на месте, или без git |
| \`max_retries\` | number | \`0\` | Запасное число повторов (перекрывается \`retry.max_attempts\`) |
| \`retry.max_attempts\` | number | — | Макс. повторов при ошибке (приоритет над \`max_retries\`) |
| \`retry.delay_seconds\` | number | \`0\` | Базовая задержка в секундах перед повтором |
| \`retry.backoff\` | \`"none"\` \\| \`"linear"\` \\| \`"exponential"\` | \`"none"\` | Стратегия нарастания задержки |
| \`retry.backoff_base\` | number | \`30\` | Секунд добавляется за попытку: linear \`+base×N\`, exponential \`+base×2^(N-1)\` |
| \`verification_cmd\` | string | — | Shell-команда после каждой задачи (ненулевой код = ошибка) |
| \`commit_template\` | string | \`"task: {{task_name}}"\` | Шаблон сообщения коммита |
| \`system_prompt\` | string | — | Промпт, добавляемый перед каждой задачей |
| \`adapter_options.timeout\` | number | \`600\` | Таймаут opencode на задачу в секундах |
| \`adapter_options.insecure_tls\` | boolean | \`false\` | Отключить проверку TLS (\`NODE_TLS_REJECT_UNAUTHORIZED=0\`) |
| \`hooks.pre_task\` | string | — | Команда перед запуском opencode |
| \`hooks.post_task\` | string | — | Команда после завершения opencode |
| \`stages.verify.threshold\` | number | \`80\` | Минимальный score (0–100) для прохождения verify |
| \`stages.verify.on_fail\` | \`"stop"\` \\| \`"continue"\` \\| \`"retry"\` | \`"stop"\` | Действие при провале verify |
| \`stages.verify.max_retries\` | number | \`2\` | Макс. итераций verify-retry (только при \`on_fail: "retry"\`) |
| \`stages.verify.retry_prompt_template\` | string | — | Кастомный промпт для retry-implement (переменные — ниже) |
| \`stages.verify.model\` | string | — | Переопределить модель opencode для стадии verify |
| \`stages.verify.timeout\` | number | — | Переопределить таймаут для стадии verify |
| \`stages.test.on_fail\` | \`"stop"\` \\| \`"continue"\` | \`"stop"\` | Действие при провале стадии test |
| \`stages.test.timeout\` | number | — | Переопределить таймаут для стадии test |
| \`daemon.poll_interval\` | number | \`60\` | Секунд между перечитываниями scheduler.json |
| \`daemon.log_file\` | string | — | Путь для лога daemon |
| \`notifications.telegram.bot_token\` | string | — | Токен Telegram-бота (или env-переменная \`BOT_TOKEN\`) |
| \`notifications.telegram.chat_id\` | string | — | ID чата/канала (или env-переменная \`CHAT_ID\`) |
| \`notifications.telegram.proxy\` | string | — | HTTP-прокси для Telegram (перекрывает глобальный) |
| \`notifications.telegram.use_env_proxy\` | boolean | \`false\` | Брать прокси из env для Telegram |
| \`notifications.webhook\` | string | — | URL вебхука (POST с JSON) |
| \`notifications.proxy\` | string | — | HTTP-прокси для всех уведомлений |
| \`notifications.use_env_proxy\` | boolean | \`false\` | Брать HTTPS_PROXY / HTTP_PROXY из env |
| \`notifications.on\` | string[] | — | События: \`task_done\`, \`task_failed\`, \`task_conflict\`, \`pipeline_done\`, \`pipeline_failed\` |

### Переменные шаблона коммита

\`{{task_name}}\` — имя файла без .md, \`{{task_file}}\` — полное имя файла,
\`{{first_line}}\` — первая непустая строка из .md, \`{{index}}\` — номер задачи (с 1), \`{{total}}\` — всего задач.

### Поля на уровне очереди

| Поле | Тип | Описание |
|---|---|---|
| \`name\` | string | Отображаемое имя очереди |
| \`tasks_dir\` | string | Переопределить глобальный \`tasks_dir\` для этой очереди |
| \`schedule\` | string \\| null | Время запуска (см. Форматы расписания); \`null\` = только вручную |
| \`status\` | string | Статус очереди (управляется orc-lite) |
| \`stages\` | string[] | Стадии по умолчанию для задач в очереди |
| \`max_retries\` | number | Макс. повторов по умолчанию для задач очереди |
| \`retry\` | object | Конфиг повторов по умолчанию для задач очереди |
| \`verification_cmd\` | string | Команда верификации по умолчанию для задач очереди |

### Приоритет настроек

Для \`stages\`, \`max_retries\`, \`retry\` и \`verification_cmd\` используется первое определённое значение:

\`\`\`
задача  →  очередь  →  глобальный конфиг
\`\`\`

### Переопределения на уровне задачи

Каждая задача может переопределить: \`verification_cmd\`, \`max_retries\`, \`retry\`, \`hooks\`, \`branch\`, \`context_files\`, \`stages\`.

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

## Стадии

По умолчанию каждая задача выполняет только \`implement\`. Опционально добавьте \`verify\` и/или \`test\`:

\`\`\`json
{
  "stages": ["implement", "verify", "test"]
}
\`\`\`

Стадии всегда начинаются с \`implement\`. Порядок: \`implement → verify → test\`.

### implement

Запускает opencode с файлом задачи как промптом. Коммитит изменения после завершения.

### verify

После \`implement\` запускает opencode для оценки — полностью ли реализация соответствует задаче.
Возвращает структурированный JSON:

\`\`\`json
{
  "approved": true,
  "score": 88,
  "reason": null,
  "short_summary": "Все эндпоинты реализованы, тесты проходят.",
  "full_summary": "## Ревью\\n...",
  "issues": []
}
\`\`\`

Если \`score >= threshold\` и \`approved: true\` — стадия пройдена.
Иначе поведение определяется \`on_fail\`:

| \`on_fail\` | Поведение |
|---|---|
| \`"stop"\` (по умолчанию) | Задача проваливается; очередь останавливается |
| \`"continue"\` | Задача продолжается несмотря на провал verify |
| \`"retry"\` | Перезапускает implement с обратной связью от verify, до \`max_retries\` раз |

#### Цикл verify-retry (\`on_fail: "retry"\`)

При провале verify orc-lite передаёт список \`issues\` и \`reason\` в новый запуск implement — без сброса git-ветки:

\`\`\`
implement → verify (провал, score 55)
  → issues: ["нет обработки ошибок", "нет миграции БД"]
  → retry implement с обратной связью
implement (retry 1) → verify (пройден, score 91)
  → готово
\`\`\`

Каждый внутренний retry коммитит поверх предыдущего состояния.

##### Кастомный шаблон промпта retry

Используйте \`retry_prompt_template\` в \`stages.verify\` для переопределения промпта при verify-retry.
Доступные переменные:

| Переменная | Описание |
|---|---|
| \`{taskContent}\` | Содержимое .md файла задачи |
| \`{implementOutput}\` | Вывод предыдущего запуска implement |
| \`{gitDiff}\` | Текущий git diff (накопленные изменения) |
| \`{verifyIssues}\` | Список проблем из провального verify |
| \`{verifyReason}\` | Поле reason из JSON verify |
| \`{verifyScore}\` | Числовой score из JSON verify |
| \`{attempt}\` | Номер текущей попытки retry (1, 2, …) |

### test

После \`implement\` (и \`verify\` если есть) запускает opencode для написания и выполнения тестов.
Установите \`on_fail: "continue"\` чтобы задача считалась успешной даже при провале тестов.

## Механизм повторов

orc-lite имеет два независимых слоя повторов:

### Внешний retry (общие ошибки)

Триггер: ошибка opencode, хука, неожиданное исключение.
Перезапускает задачу **с нуля** — пересоздаёт git-ветку, запускает implement заново.

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

Формула задержки:
- \`"none"\`: всегда \`delay_seconds\`
- \`"linear"\`: \`delay_seconds + backoff_base × attempt\`
- \`"exponential"\`: \`delay_seconds + backoff_base × 2^(attempt-1)\`

\`retry.max_attempts\` имеет приоритет над устаревшим полем \`max_retries\`.

### Внутренний цикл verify-retry

Триггер: \`stages.verify.on_fail: "retry"\` + verify провален.
**Не сбрасывает** git — агент продолжает работу поверх своих изменений.

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

## Форматы расписания

| Ввод | Интерпретация |
|---|---|
| \`"2:30"\` | Следующее 2:30 (сегодня ночью или завтра) |
| \`"14:30"\` | Следующее 14:30 |
| \`"2026-04-09"\` | Эта дата в 00:00 |
| \`"2026-04-09 2:30"\` | Эта дата в 2:30 |
| \`"2026-04-09T02:30:00"\` | ISO 8601 точное |

Время отображается и интерпретируется в **локальном часовом поясе**.
Глобальный реестр: \`~/.orc-lite/scheduler.json\`

## Статусы задач

| Статус | Значение |
|---|---|
| \`pending\` | Не начата |
| \`in_progress\` | Выполняется |
| \`done\` | Завершена и смёрджена |
| \`failed\` | Провалена (opencode, хук, верификация или все повторы исчерпаны) |
| \`conflict\` | Конфликт мёрджа в целевой ветке |
| \`skipped\` | Пропущена |

## Статусы очередей

\`pending\` → \`in_progress\` → \`done\` / \`failed\`

## Уведомления

### Настройка Telegram

1. Создайте бота через [@BotFather](https://t.me/BotFather), скопируйте токен.
2. Получите chat_id: добавьте бота в чат/канал, затем вызовите \`https://api.telegram.org/bot<token>/getUpdates\`.
3. Добавьте в конфиг:

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

**Env-переменные вместо конфига** — \`bot_token\` и \`chat_id\` можно не указывать, если заданы:

\`\`\`bash
export BOT_TOKEN=123456:ABC-DEF...
export CHAT_ID=-1001234567890
\`\`\`

**Прокси** (если Telegram заблокирован):

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

Или \`"use_env_proxy": true\` для автоматического подхвата \`HTTPS_PROXY\` / \`HTTP_PROXY\` из env.

### Вебхук

POST-запрос с JSON-телом \`{ event, message, taskFile, durationMs, error, ... }\`:

\`\`\`json
{
  "notifications": {
    "webhook": "https://hooks.example.com/orc-lite",
    "on": ["pipeline_done", "pipeline_failed"]
  }
}
\`\`\`

## Пайплайн

Поведение зависит от \`git_strategy\`:

**\`branch\` (по умолчанию)** — изолированная ветка на каждую задачу:
1. Checkout \`target_branch\`, создать \`task/<name>\` (или \`branch\` если задан)
2. Запустить хук \`pre_task\`
3. Запустить стадию \`implement\` → коммит
4. Если \`verify\` в стадиях:
   - Запустить \`verify\` → коммит
   - При провале и \`on_fail: "retry"\`: перезапустить \`implement\` с проблемами → перезапустить \`verify\` → повторять до \`stages.verify.max_retries\` раз
5. Если \`test\` в стадиях: запустить \`test\` → коммит
6. Запустить хук \`post_task\` + \`verification_cmd\`
7. Смёрджить \`task/<name>\` в \`target_branch\`, запушить если \`push: "each"\`

**\`commit\`** — оставаться в текущей ветке, коммитить после каждой задачи.
Без создания ветки и мёрджа. Пуш если \`push: "each"\` / \`"end"\`.

**\`none\`** — без git-операций.
Просто запускает opencode и оставляет изменения незакоммиченными.

При любой ошибке внешнего шага, если настроены повторы, задача перезапускается с шага 1.
При ошибке или конфликте мёрджа очередь останавливается. Логи: \`<logs_dir>/<task-name>.log\`.

## Восстановление после сбоя

\`\`\`bash
# Интерактивно: выбрать упавшие задачи и действие восстановления
orc-lite reset

# Быстро: сбросить конкретную задачу
orc-lite reset fix-auth.md

# Затем перезапустить очередь
orc-lite run
\`\`\`

**Действия восстановления (интерактивный режим):**

| Действие | Эффект |
|---|---|
| Reset | повтор как есть |
| Bump timeout | удваивает \`adapter_options.timeout\` глобально |
| Add retries | устанавливает \`max_retries\` на задачу |
| Change stages | выбор нового набора стадий |
| Mark as skipped | устанавливает статус \`skipped\` |

Статус очереди (\`failed\`/\`in_progress\`) автоматически сбрасывается до \`pending\`.

## Ночной сценарий работы

\`\`\`bash
# Задать расписание — daemon запускается автоматически
orc-lite schedule 2:00

# Утром: проверить результаты
orc-lite status
orc-lite logs
\`\`\`

PID-файл daemon: \`~/.orc-lite/daemon.pid\`
Просроченные задачи (< 1ч): выполняются немедленно. Просроченные > 1ч: пропускаются с предупреждением.

## Формат файла задачи

Обычный markdown — пишите как промпт:

\`\`\`markdown
# Добавить аутентификацию пользователей

Реализовать JWT-аутентификацию:
- POST /auth/login — email + пароль, возвращает JWT
- POST /auth/register — создаёт пользователя
- Добавить middleware аутентификации
- Защитить маршруты /api/*

## Контекст

Смотри src/auth/ для существующего кода. Используй модель User из src/models/user.ts.
\`\`\`
`

export function docsCommand(options: { output?: string; force?: boolean; lang?: string }): void {
  const isRu = options.lang === 'ru'
  const defaultFilename = isRu ? DOCS_FILENAME_RU : DOCS_FILENAME
  const content = isRu ? DOCS_CONTENT_RU : DOCS_CONTENT
  const outputPath = resolve(options.output ?? defaultFilename)

  if (existsSync(outputPath) && !options.force) {
    console.error(chalk.yellow(`${outputPath} already exists. Use --force to overwrite.`))
    process.exit(1)
  }

  writeFileSync(outputPath, content, 'utf-8')
  console.log(chalk.green(`✓ Generated ${outputPath}`))
}
