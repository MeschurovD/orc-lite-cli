import type { AdapterExecuteParams, AdapterResult, OpenCodeAdapterOptions } from '../types.js';
export declare class OpenCodeAdapter {
    private options;
    readonly name = "opencode";
    constructor(options: OpenCodeAdapterOptions);
    isInstalled(): Promise<boolean>;
    execute(params: AdapterExecuteParams): Promise<AdapterResult>;
}
export declare function createAdapter(options: OpenCodeAdapterOptions): OpenCodeAdapter;
//# sourceMappingURL=opencode-adapter.d.ts.map