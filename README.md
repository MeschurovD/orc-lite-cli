# orc-lite-cli

Lightweight CLI orchestrator for autonomous AI task execution using [opencode](https://opencode.ai).
Built for work projects where data security matters — **opencode** is the only adapter (your work LLM, no data leaks).

Key feature over orc-cli: **built-in scheduler** for running task queues at a set time (overnight runs, off-hours automation).

---

## Install

**Install globally from GitHub (no npm publish required):**

```bash
npm install -g github:MeschurovD/orc-lite-cli
```

npm will install dependencies and build TypeScript automatically. The `orc-lite` command will be available globally.

**Update to the latest version:**

```bash
npm install -g github:MeschurovD/orc-lite-cli
```

**Install a specific commit or tag:**

```bash
npm install -g github:MeschurovD/orc-lite-cli#abc1234
npm install -g github:MeschurovD/orc-lite-cli#v0.2.0
```

**Uninstall:**

```bash
npm uninstall -g orc-lite-cli
```

Requires: **Node.js ≥ 18**, **opencode** in PATH, **git**.

### Troubleshooting: `orc-lite: command not found` (macOS/Linux)

If installation succeeds but `orc-lite` is not found, usually your npm global bin directory is not in shell `PATH`.

Check where npm installs global binaries:

```bash
npm config get prefix
npm prefix -g
```

Then make sure `<prefix>/bin` is in your `PATH` (for `zsh`, add to `~/.zshrc`):

```bash
export PATH="$(npm config get prefix)/bin:$PATH"
source ~/.zshrc
```

> If you use **nvm**: `source ~/.zshrc` can switch Node versions and overwrite `PATH`.
> Re-run `npm config get prefix` **after** sourcing and verify it matches the directory in `PATH`.

Most common case: you install under Node 22, then `source ~/.zshrc` switches back to Node 18.
In that case `orc-lite` was installed into Node 22 prefix, but your shell uses Node 18 prefix.

Fix by using one Node version consistently:

```bash
# option A: make Node 22 default for new shells
nvm alias default 22

# option B: keep Node 18 default, but reinstall orc-lite under Node 18
nvm use 18
npm uninstall -g orc-lite-cli
npm install -g github:MeschurovD/orc-lite-cli
```

If reinstall fails with `EEXIST .../bin/orc-lite`, remove stale link and retry:

```bash
rm -f "$(npm config get prefix)/bin/orc-lite"
npm install -g github:MeschurovD/orc-lite-cli
```

Useful diagnostics:

```bash
node -v
nvm current
npm config get prefix
echo "$PATH" | tr ':' '\n' | grep "$(npm config get prefix)/bin"
```

Quick checks:

```bash
npm ls -g --depth=0 | grep orc-lite-cli
which orc-lite
```

If `which orc-lite` is empty, check executable permissions and reinstall:

```bash
ls -l "$(npm config get prefix)/lib/node_modules/orc-lite-cli/dist/index.js"
chmod +x "$(npm config get prefix)/lib/node_modules/orc-lite-cli/dist/index.js"
npm uninstall -g orc-lite-cli
npm install -g github:MeschurovD/orc-lite-cli
```

---

## Quick start

```bash
# 1. Initialize config in your project (interactive)
orc-lite init

# 2. Add tasks — interactive (select queue, pick files, configure options)
orc-lite add

# …or directly with a filename
orc-lite add fix-auth-bug.md
# → creates tasks/fix-auth-bug.md from a template, adds it to config

# 3. Edit the task file, then run
orc-lite run
```

---

## Commands

### `orc-lite run [queue] [options]`

Run a task queue immediately.

```bash
orc-lite run              # first pending queue
orc-lite run 2            # queue #2 (1-based)
orc-lite run --all        # all pending queues sequentially
orc-lite run --dry-run    # preview without making changes
```

### `orc-lite init`

Interactively create `orc-lite.config.json` in the current directory.
Prompts for git strategy, directories, and queues. Supports creating multiple
queues in one go, each with optional task defaults (stages, retries, verify command).
Auto-discovers existing `.md` files in each queue's tasks directory.

### `orc-lite status`

Show queue and task status with completion progress.

```
orc-lite status — 3/5 tasks done
target branch: main

  [1] auth-refactor (in_progress) 2/3
     1. fix-login.md             ● done    (42s)
     2. fix-tokens.md            ◑ in_progress
     3. fix-logout.md            ○ pending
```

### `orc-lite add [file]`

Add a task to a queue. Without a filename, runs full interactive mode:
select queue → checkbox file selection with live filter → optional stages/retries/context config.

```bash
orc-lite add                      # interactive: pick queue, pick files, configure
orc-lite add fix-bug.md           # quick: add to first pending queue
orc-lite add fix-bug.md -q auth   # quick: add to queue named "auth"
orc-lite add fix-bug.md -q 2      # quick: add to queue #2
```

Creates the task file from a template if it doesn't exist.

### `orc-lite reset [task-file]`

Reset a failed or stuck task back to `pending`. Without a filename, shows all
failed/stuck tasks across all queues and lets you pick a recovery action for each.

```bash
orc-lite reset                    # interactive: pick tasks, choose action
orc-lite reset fix-bug.md         # quick reset to pending
orc-lite reset fix-bug.md -q auth # if task is in queue named "auth"
```

**Recovery actions** (interactive mode):

| Action | What it does |
|---|---|
| Reset | retry as-is |
| Bump timeout | doubles `adapter_options.timeout` in config |
| Add retries | sets `max_retries` on the task |
| Change stages | checkbox to pick new stage set |
| Mark as skipped | sets status to `skipped` |

Also resets the queue status from `failed`/`in_progress` to `pending` automatically.

### `orc-lite logs [task]`

View task logs.

```bash
orc-lite logs                      # list all log files
orc-lite logs fix-bug              # print log for fix-bug task
orc-lite logs fix-bug --tail       # follow log in real-time
```

### `orc-lite validate`

Check config, task files, git repo, and opencode availability before running.

### `orc-lite queue list`

Show all queues with their status, task progress, and configured defaults.

```
#    Name                Dir                   Tasks    Status
────────────────────────────────────────────────────────────────────
1    auth-refactor       tasks/auth            2/4      pending  [stages: implement+verify, retries: 3]
2    api-cleanup         tasks/api             0/2      pending
3    nightly-fixes       tasks/                3/3      done     @ 2:30
```

### `orc-lite queue add [name]`

Add a new queue. Without a name, runs full interactive mode with prompts for
name, tasks directory, schedule, and optional task defaults (stages, retries,
backoff, verification command).

```bash
orc-lite queue add                          # fully interactive
orc-lite queue add auth --dir tasks/auth    # with flags
orc-lite queue add nightly --schedule 2:30  # with schedule
```

---

## Scheduler commands

### `orc-lite schedule [queue] <time>`

Set a schedule for a queue, save it to config, register the job in the global scheduler, and auto-start the background daemon if it isn't already running.

```bash
orc-lite schedule 2:30                   # first pending queue at 2:30 AM
orc-lite schedule 2 "14:30"             # queue #2 at 14:30
orc-lite schedule 2 "2026-04-11 5:00"  # queue #2 at specific date+time
```

**Time formats:**

| Input | Interpretation |
|-------|---------------|
| `"2:30"` | Next 2:30 (tonight if now < 2:30, tomorrow otherwise) |
| `"14:30"` | Next 14:30 |
| `"2026-04-09"` | That date at 00:00 |
| `"2026-04-09 2:30"` | That date at 2:30 |
| `"2026-04-09T02:30:00"` | ISO 8601 exact |

```bash
orc-lite schedule --list             # all jobs across all repos
orc-lite schedule --cancel           # cancel all jobs for current repo
orc-lite schedule --cancel <id>      # cancel specific job by ID
```

### `orc-lite register`

Read `orc-lite.config.json`, find queues with `schedule` field, and register them in the global scheduler (`~/.orc-lite/scheduler.json`). Also auto-starts the background daemon if it isn't already running.

Use this after editing the config manually to set schedules.

### `orc-lite daemon`

Start the background scheduler process. Monitors `~/.orc-lite/scheduler.json` and runs queues when their scheduled time arrives.

```bash
orc-lite daemon
# → orc-lite daemon running (PID 12345)
#   Scheduler: /root/.orc-lite/scheduler.json
#   Press Ctrl+C to stop
```

The daemon:
- Picks up all `scheduled` jobs on start
- Polls `scheduler.json` every `daemon.poll_interval` seconds (default: 60)
- Runs overdue jobs immediately if they're within 1 hour grace period
- Skips jobs overdue by more than 1 hour (marks as `failed`)
- Removes job from registry when queue completes successfully
- Writes a PID file at `~/.orc-lite/daemon.pid` to prevent duplicate daemons

---

## Configuration

`orc-lite.config.json` in your project root:

```jsonc
{
  "target_branch": "main",
  "tasks_dir": "tasks",
  "logs_dir": ".orc-lite/logs",
  "push": "none",            // "each" | "end" | "none"
  "git_strategy": "branch",  // "branch" | "commit" | "none"
  "max_retries": 0,          // legacy; use retry.max_attempts instead

  // Retry on error (outer loop — restarts task from scratch)
  "retry": {
    "max_attempts": 3,
    "delay_seconds": 10,
    "backoff": "linear",
    "backoff_base": 30
  },

  // Stage-level settings
  "stages": {
    "verify": {
      "threshold": 80,
      "on_fail": "retry",    // "stop" | "continue" | "retry"
      "max_retries": 2       // inner verify-retry attempts
    },
    "test": {
      "on_fail": "continue"
    }
  },

  // Optional daemon settings
  "daemon": {
    "poll_interval": 60,
    "log_file": ".orc-lite/daemon.log"
  },

  // Queues (each can have an optional schedule and task defaults)
  "queues": [
    {
      "name": "auth-refactor",
      "schedule": null,             // null = manual run only
      "status": "pending",
      "tasks_dir": "tasks/auth",    // optional: overrides global tasks_dir
      // Per-queue task defaults (override global, task-level overrides these)
      "stages": ["implement", "verify"],
      "max_retries": 2,
      "retry": { "max_attempts": 2, "delay_seconds": 10, "backoff": "linear" },
      "verification_cmd": "npm test",
      "tasks": [
        { "file": "fix-auth.md", "status": "pending" },
        { "file": "fix-tokens.md", "status": "pending" }
      ]
    },
    {
      "name": "nightly-fixes",
      "schedule": "2:30",           // runs at next 2:30 AM
      "status": "pending",
      "tasks": [
        { "file": "fix-api.md", "status": "pending" }
      ]
    }
  ]
}
```

### Task folder organisation

Tasks can be organised into subfolders in two ways:

**Relative path in `file`** — no config changes needed, resolves against the global `tasks_dir`:

```jsonc
{ "file": "auth/fix-login.md", "status": "pending" }
// → reads from <tasks_dir>/auth/fix-login.md
// → branch name: task/auth-fix-login
```

**Per-queue `tasks_dir`** — cleaner file names when a whole queue lives in one folder:

```jsonc
{
  "name": "auth-refactor",
  "tasks_dir": "tasks/auth",       // overrides global tasks_dir for this queue
  "tasks": [
    { "file": "fix-login.md", "status": "pending" },
    { "file": "fix-tokens.md", "status": "pending" }
  ]
},
{
  "name": "api-cleanup",
  "tasks_dir": "tasks/api",
  "tasks": [
    { "file": "fix-endpoint.md", "status": "pending" }
  ]
},
{
  "name": "mixed",
  // no tasks_dir → uses global tasks_dir
  "tasks": [
    { "file": "auth/special.md", "status": "pending" },
    { "file": "api/hotfix.md", "status": "pending" }
  ]
}
```

Queues without `tasks_dir` fall back to the global value. Both approaches can be mixed within the same config.

### Backward compatibility

The simple `tasks` format from orc-cli is supported and automatically wrapped in a `default` queue:

```jsonc
{
  "target_branch": "main",
  "tasks_dir": "tasks",
  "tasks": [
    { "file": "fix-something.md", "status": "pending" }
  ]
}
```

### Retry configuration

orc-lite has two independent retry layers.

**Outer retry** — restarts the task from scratch on any error (opencode failure, hook failure, etc.):

```jsonc
{
  "retry": {
    "max_attempts": 3,       // total retry attempts (takes priority over max_retries)
    "delay_seconds": 10,     // base delay before each retry
    "backoff": "linear",     // "none" | "linear" | "exponential"
    "backoff_base": 30       // seconds added per attempt
  }
}
```

Delay formula: `none` → always `delay_seconds`; `linear` → `delay + base×N`; `exponential` → `delay + base×2^(N-1)`.

`retry.max_attempts` takes priority over the legacy `max_retries` field (kept for backward compatibility).

**Inner verify-retry loop** — re-runs `implement` with feedback from a failed verify, without resetting the git branch:

```jsonc
{
  "stages": {
    "verify": {
      "threshold": 80,
      "on_fail": "retry",   // "stop" | "continue" | "retry"
      "max_retries": 2      // how many times to retry implement after failed verify
    }
  }
}
```

When verify returns `approved: false`, the issues list and reason are fed back into a new implement run:

```
implement → verify (score 55, issues: ["missing error handling", "no migration"])
  → retry implement with feedback
implement (retry 1) → verify (score 91, approved)
  → continues to test stage
```

#### Custom retry prompt template

Override the default prompt sent on verify-retry with `retry_prompt_template` in `stages.verify`.
Available variables: `{taskContent}`, `{implementOutput}`, `{gitDiff}`, `{verifyIssues}`, `{verifyReason}`, `{verifyScore}`, `{attempt}`.

### Settings fallback chain

For `stages`, `max_retries`, `retry`, and `verification_cmd`, settings are
resolved in this order — the first defined value wins:

```
task-level  →  queue-level  →  global config
```

This lets you set sensible defaults per queue and override for specific tasks
that need different behaviour.

### Per-task options

```jsonc
{
  "file": "fix-auth.md",
  "status": "pending",
  "branch": "feat/fix-auth",        // custom branch name
  "context_files": ["src/auth.ts"], // extra context for opencode
  "verification_cmd": "npm test",   // run after implementation
  "stages": ["implement", "verify", "test"],
  "max_retries": 3,                 // overrides queue and global
  "retry": { "max_attempts": 2, "delay_seconds": 0 },
  "hooks": {
    "pre_task": "git fetch origin",
    "post_task": "npm run lint"
  }
}
```

### Notifications

#### Telegram setup

1. Create a bot via [@BotFather](https://t.me/BotFather), copy the bot token.
2. Get your chat ID: add the bot to a chat/channel, then call `https://api.telegram.org/bot<token>/getUpdates`.
3. Add to config:

```jsonc
{
  "notifications": {
    "telegram": {
      "bot_token": "123456:ABC-DEF...",
      "chat_id": "-1001234567890",
      "proxy": "http://user:pass@host:3128",  // optional, if Telegram is blocked
      "use_env_proxy": false                  // or true to pick up HTTPS_PROXY from env
    },
    "on": ["task_done", "task_failed", "task_conflict", "pipeline_done", "pipeline_failed"]
  }
}
```

**`bot_token` and `chat_id` can be set via env vars instead of hardcoding in config:**

```bash
export BOT_TOKEN=123456:ABC-DEF...
export CHAT_ID=-1001234567890
```

#### Webhook

POST request with JSON body `{ event, message, taskFile, durationMs, error, ... }`:

```jsonc
{
  "notifications": {
    "webhook": "https://hooks.example.com/orc-lite",
    "on": ["pipeline_done", "pipeline_failed"]
  }
}
```

**Notification events:** `task_done`, `task_failed`, `task_conflict`, `pipeline_done`, `pipeline_failed`

---

## Typical overnight workflow

```bash
# In your work project:
orc-lite add fix-api-bug.md
orc-lite add refactor-auth.md

# Schedule to run at 2 AM — daemon starts automatically in background
orc-lite schedule 2:00

# Next morning: check results
orc-lite status
orc-lite logs
```

---

## Global scheduler file

`~/.orc-lite/scheduler.json` stores all registered jobs across all repositories:

```jsonc
{
  "jobs": [
    {
      "id": "a1b2c3d4",
      "repo": "/opt/work/project-a",
      "queue_index": 1,
      "queue_name": "nightly-fixes",
      "scheduled_at": "2026-04-09T02:00:00.000Z",
      "registered_at": "2026-04-08T19:15:00.000Z",
      "status": "scheduled"   // scheduled | running | done | failed | cancelled
    }
  ]
}
```

---

## Development

```bash
npm run build        # compile TypeScript → dist/
npm run dev          # run via tsx (no build needed)
npm run lint         # type-check only
npm test             # run test suite (vitest)
npm run test:watch   # watch mode
```
