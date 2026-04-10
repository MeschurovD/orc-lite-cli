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

---

## Quick start

```bash
# 1. Initialize config in your project
orc-lite init

# 2. Add task files
orc-lite add fix-auth-bug.md
# → creates tasks/fix-auth-bug.md with a template, adds it to config

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
Auto-discovers `.md` files in the tasks directory.

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

### `orc-lite add <file>`

Add a task to a queue. Creates the task file from a template if it doesn't exist.

```bash
orc-lite add fix-bug.md           # add to first pending queue
orc-lite add fix-bug.md -q 2      # add to queue #2
```

### `orc-lite reset <task-file>`

Reset a failed or stuck task back to `pending`.

```bash
orc-lite reset fix-bug.md
orc-lite reset fix-bug.md -q 2    # if task is in queue #2
```

### `orc-lite logs [task]`

View task logs.

```bash
orc-lite logs                      # list all log files
orc-lite logs fix-bug              # print log for fix-bug task
orc-lite logs fix-bug --tail       # follow log in real-time
```

### `orc-lite validate`

Check config, task files, git repo, and opencode availability before running.

---

## Scheduler commands

### `orc-lite schedule [queue] <time>`

Set a schedule for a queue and register it in the global scheduler.

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

Read `orc-lite.config.json`, find queues with `schedule` field, and register them in the global scheduler (`~/.orc-lite/scheduler.json`).

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
  "push": "none",          // "each" | "end" | "none"
  "max_retries": 1,

  // Optional daemon settings
  "daemon": {
    "poll_interval": 60,
    "log_file": ".orc-lite/daemon.log"
  },

  // Queues (each can have an optional schedule)
  "queues": [
    {
      "name": "auth-refactor",
      "schedule": null,             // null = manual run only
      "status": "pending",
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

### Per-task options

```jsonc
{
  "file": "fix-auth.md",
  "status": "pending",
  "branch": "feat/fix-auth",        // custom branch name
  "context_files": ["src/auth.ts"], // extra context for opencode
  "verification_cmd": "npm test",   // run after implementation
  "max_retries": 2,                 // override global max_retries
  "stages": ["implement", "verify", "test"],
  "hooks": {
    "pre_task": "git fetch origin",
    "post_task": "npm run lint"
  }
}
```

### Notifications (Telegram)

```jsonc
{
  "notifications": {
    "telegram": {
      "bot_token": "...",
      "chat_id": "...",
      "proxy": "http://proxy:3128",   // optional
      "use_env_proxy": false
    },
    "on": ["task_done", "task_failed", "pipeline_done", "pipeline_failed"]
  }
}
```

---

## Typical overnight workflow

```bash
# In your work project:
orc-lite add fix-api-bug.md
orc-lite add refactor-auth.md

# Schedule to run at 2 AM tonight
orc-lite schedule 2:00

# Register and start daemon (or just run daemon — it reads scheduler.json)
orc-lite register
orc-lite daemon &

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
