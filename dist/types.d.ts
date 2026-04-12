import type { Writable } from 'node:stream';
export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'conflict' | 'skipped';
export type QueueStatus = 'pending' | 'in_progress' | 'done' | 'failed';
export interface TaskHooks {
    pre_task?: string;
    post_task?: string;
}
export interface TaskDefinition {
    file: string;
    status: TaskStatus;
    branch?: string;
    context_files?: string[];
    verification_cmd?: string;
    max_retries?: number;
    hooks?: TaskHooks;
    stages?: StageName[];
    started_at?: string;
    completed_at?: string;
    error?: string;
    retry_count?: number;
    tokens_used?: number;
    cost_usd?: number;
}
export interface QueueDefinition {
    name?: string;
    schedule?: string | null;
    status: QueueStatus;
    tasks: TaskDefinition[];
}
export type StageName = 'implement' | 'verify' | 'test';
export interface StageConfig {
    prompt_template?: string;
    model?: string;
    timeout?: number;
    threshold?: number;
    on_fail?: 'stop' | 'continue';
}
export interface StagesConfig {
    verify?: StageConfig;
    test?: StageConfig;
}
export interface StageResult {
    name: StageName;
    success: boolean;
    durationMs: number;
    output?: string;
    tokensUsed?: number;
    costUsd?: number;
    score?: number;
    reviewFile?: string;
    shortSummary?: string;
    fullSummary?: string;
}
export type NotificationEvent = 'task_done' | 'task_failed' | 'task_conflict' | 'pipeline_done' | 'pipeline_failed';
export interface TelegramConfig {
    bot_token?: string;
    chat_id?: string;
    proxy?: string;
    use_env_proxy?: boolean;
}
export interface NotificationsConfig {
    telegram?: TelegramConfig;
    webhook?: string;
    proxy?: string;
    use_env_proxy?: boolean;
    on: NotificationEvent[];
}
export interface AutoPrConfig {
    enabled: boolean;
    base_branch?: string;
    title_template?: string;
    draft?: boolean;
}
export interface DaemonConfig {
    poll_interval?: number;
    log_file?: string;
}
export type PushMode = 'each' | 'end' | 'none';
export type GitStrategy = 'branch' | 'commit' | 'none';
export interface OpenCodeAdapterOptions {
    timeout?: number;
}
export interface OrcLiteConfig {
    project_name?: string;
    target_branch: string;
    tasks_dir: string;
    logs_dir: string;
    on_failure: 'stop';
    verification_cmd?: string;
    system_prompt?: string;
    commit_template?: string;
    adapter_options: OpenCodeAdapterOptions;
    push: PushMode;
    git_strategy: GitStrategy;
    max_retries: number;
    hooks?: TaskHooks;
    stages?: StagesConfig;
    notifications?: NotificationsConfig;
    auto_pr?: AutoPrConfig;
    daemon?: DaemonConfig;
    queues: QueueDefinition[];
}
export interface AdapterExecuteParams {
    prompt: string;
    workingDir: string;
    timeout: number;
    teeStream: Writable;
    fullLogStream?: Writable;
}
export interface AdapterResult {
    exitCode: number;
    success: boolean;
    durationMs: number;
    tokensUsed?: number;
    costUsd?: number;
    output?: string;
}
export interface TaskRunResult {
    success: boolean;
    status: TaskStatus;
    durationMs?: number;
    error?: string;
    tokensUsed?: number;
    costUsd?: number;
}
export interface QueueResult {
    totalTasks: number;
    doneTasks: number;
    failedTask?: string;
    stoppedReason?: 'failed' | 'conflict';
    totalTokensUsed?: number;
    totalCostUsd?: number;
}
export interface SchedulerJob {
    id: string;
    repo: string;
    config?: string;
    queue_index: number;
    queue_name?: string;
    scheduled_at: string;
    registered_at: string;
    status: 'scheduled' | 'running' | 'done' | 'failed' | 'cancelled';
}
export interface SchedulerRegistry {
    jobs: SchedulerJob[];
}
//# sourceMappingURL=types.d.ts.map