import { buildPrompt } from '../../adapters/prompt-builder.js';
import { createAdapter } from '../../adapters/opencode-adapter.js';
export async function runImplementStage(ctx) {
    const { task, config, workingDir, log } = ctx;
    const startTime = Date.now();
    log.step('building prompt');
    const prompt = buildPrompt({
        taskFile: task.file,
        tasksDir: config.tasks_dir,
        systemPrompt: config.system_prompt,
        contextFiles: task.context_files,
        workingDir,
    });
    log.raw(`\n  Prompt (${prompt.length} chars): ${prompt.slice(0, 120).replace(/\n/g, ' ')}…\n`);
    const timeout = config.adapter_options.timeout ?? 600;
    log.step(`running opencode (timeout: ${timeout}s)`);
    log.openCodexFrame();
    const adapter = createAdapter(config.adapter_options);
    const adapterResult = await adapter.execute({
        prompt,
        workingDir,
        timeout,
        teeStream: log.teeStream,
        fullLogStream: log.fileStream,
    });
    log.closeCodexFrame();
    if (!adapterResult.success) {
        const error = adapterResult.exitCode === 124
            ? `timed out after ${timeout}s`
            : `opencode exited with code ${adapterResult.exitCode}`;
        log.error(`opencode failed: ${error}`);
        return {
            name: 'implement',
            success: false,
            durationMs: Date.now() - startTime,
            output: adapterResult.output,
        };
    }
    const adapterDuration = Math.round(adapterResult.durationMs / 1000);
    log.success(`opencode done (${adapterDuration}s)`);
    return {
        name: 'implement',
        success: true,
        durationMs: Date.now() - startTime,
        output: adapterResult.output,
    };
}
//# sourceMappingURL=implement.js.map