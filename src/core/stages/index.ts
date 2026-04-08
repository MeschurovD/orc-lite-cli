import type { TaskDefinition, OrcLiteConfig, StageName, StageConfig, StageResult } from '../../types.js'
import type { TaskLogger } from '../../services/logger.js'
import { runImplementStage } from './implement.js'
import { runVerifyStage } from './verify.js'
import { runTestStage } from './test.js'

export interface StageContext {
  task: TaskDefinition
  taskIndex: number
  config: OrcLiteConfig
  stageConfig?: StageConfig
  workingDir: string
  log: TaskLogger
  implementOutput: string
  gitDiff: string
  taskContent: string
}

export async function runStage(name: StageName, ctx: StageContext): Promise<StageResult> {
  switch (name) {
    case 'implement':
      return runImplementStage(ctx)
    case 'verify':
      return runVerifyStage(ctx)
    case 'test':
      return runTestStage(ctx)
  }
}
