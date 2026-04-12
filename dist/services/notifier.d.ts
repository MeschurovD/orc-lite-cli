import type { NotificationsConfig, NotificationEvent } from '../types.js';
export interface NotificationDetails {
    taskFile?: string;
    taskIndex?: number;
    totalTasks?: number;
    durationMs?: number;
    error?: string;
    doneTasks?: number;
    summary?: string;
    projectName?: string;
    queueName?: string;
}
export interface ProxyInfo {
    active: boolean;
    url?: string;
    source?: 'config' | 'env';
}
export declare class Notifier {
    private config;
    private dispatcher;
    readonly proxyInfo: ProxyInfo;
    constructor(config: NotificationsConfig);
    notify(event: NotificationEvent, details: NotificationDetails): Promise<void>;
    private sendTelegram;
    private sendWebhook;
}
export declare function createNotifier(config: NotificationsConfig | undefined): Notifier | null;
//# sourceMappingURL=notifier.d.ts.map