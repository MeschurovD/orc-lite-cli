import { runImplementStage } from './implement.js';
import { runVerifyStage } from './verify.js';
import { runTestStage } from './test.js';
export async function runStage(name, ctx) {
    switch (name) {
        case 'implement':
            return runImplementStage(ctx);
        case 'verify':
            return runVerifyStage(ctx);
        case 'test':
            return runTestStage(ctx);
    }
}
//# sourceMappingURL=index.js.map