import { fetch, ProxyAgent } from 'undici';
const EVENT_ICONS = {
    task_done: '✅',
    task_failed: '❌',
    task_conflict: '⚡',
    pipeline_done: '🏁',
    pipeline_failed: '🚨',
};
const EVENT_TITLES = {
    task_done: 'Task completed',
    task_failed: 'Task FAILED',
    task_conflict: 'Merge CONFLICT',
    pipeline_done: 'Queue complete',
    pipeline_failed: 'Queue FAILED',
};
function formatMessage(event, details) {
    const icon = EVENT_ICONS[event];
    const title = EVENT_TITLES[event];
    const projectLabel = details.projectName ?? 'orc-lite';
    const lines = [`${icon} *${projectLabel}: ${title}*`];
    if (details.queueName) {
        lines.push(`Queue: ${details.queueName}`);
    }
    if (details.taskFile && details.taskIndex != null && details.totalTasks != null) {
        lines.push(`Task ${details.taskIndex + 1}/${details.totalTasks}: \`${details.taskFile}\``);
    }
    if (details.doneTasks != null && details.totalTasks != null) {
        lines.push(`Done: ${details.doneTasks}/${details.totalTasks}`);
    }
    if (details.summary) {
        lines.push(`Summary: ${details.summary}`);
    }
    if (details.durationMs != null) {
        const secs = Math.round(details.durationMs / 1000);
        lines.push(`Duration: ${secs}s`);
    }
    if (details.error) {
        lines.push(`Error: ${details.error}`);
    }
    return lines.join('\n');
}
function resolveProxy(config) {
    if (config.proxy) {
        return {
            dispatcher: new ProxyAgent(config.proxy),
            info: { active: true, url: config.proxy, source: 'config' },
        };
    }
    if (config.use_env_proxy) {
        const envUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
        if (envUrl) {
            return {
                dispatcher: new ProxyAgent(envUrl),
                info: { active: true, url: envUrl, source: 'env' },
            };
        }
    }
    return { dispatcher: undefined, info: { active: false } };
}
export class Notifier {
    config;
    dispatcher;
    proxyInfo;
    constructor(config) {
        this.config = config;
        const { dispatcher, info } = resolveProxy(config);
        this.dispatcher = dispatcher;
        this.proxyInfo = info;
    }
    async notify(event, details) {
        if (!this.config.on.includes(event))
            return;
        const message = formatMessage(event, details);
        const promises = [];
        if (this.config.telegram) {
            promises.push(this.sendTelegram(message));
        }
        if (this.config.webhook) {
            promises.push(this.sendWebhook(event, message, details));
        }
        const results = await Promise.allSettled(promises);
        for (const result of results) {
            if (result.status === 'rejected') {
                console.error(`[notifier] failed to send: ${result.reason}`);
            }
        }
    }
    async sendTelegram(text) {
        const telegramCfg = this.config.telegram;
        const bot_token = telegramCfg?.bot_token || process.env.BOT_TOKEN;
        const chat_id = telegramCfg?.chat_id || process.env.CHAT_ID;
        if (!bot_token)
            throw new Error('Telegram bot_token is not set (config or BOT_TOKEN env var)');
        if (!chat_id)
            throw new Error('Telegram chat_id is not set (config or CHAT_ID env var)');
        // Telegram-specific proxy overrides global proxy
        let dispatcher = this.dispatcher;
        if (telegramCfg?.proxy) {
            dispatcher = new ProxyAgent(telegramCfg.proxy);
        }
        else if (telegramCfg?.use_env_proxy && !this.config.proxy) {
            const envUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
            if (envUrl)
                dispatcher = new ProxyAgent(envUrl);
        }
        const url = `https://api.telegram.org/bot${bot_token}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id,
                text,
                parse_mode: 'Markdown',
            }),
            ...(dispatcher ? { dispatcher } : {}),
        });
        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Telegram API ${response.status}: ${body}`);
        }
    }
    async sendWebhook(event, message, details) {
        const response = await fetch(this.config.webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event, message, ...details }),
            ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
        });
        if (!response.ok) {
            throw new Error(`Webhook ${response.status}: ${await response.text()}`);
        }
    }
}
export function createNotifier(config) {
    if (!config)
        return null;
    return new Notifier(config);
}
//# sourceMappingURL=notifier.js.map