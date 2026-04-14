// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

export { EXIT_CODES, VersioningsError } from './errors';
export type { ExitCodes } from './errors';

export { createExecutor } from './executor';
export type { ExecFn, ExecutorOpts, ExecutorResult, Executor } from './executor';

export { runPipeline, prependChangelogContent } from './pipeline';
export type { PipelineOpts, PipelineDeps } from './pipeline';

export { createReporter } from './reporter';
export type {
  ReporterOpts,
  AutoBumpInfo,
  PipelineResult,
  DryRunPlan,
  ValidateResult,
  DoctorCheck,
  Reporter,
} from './reporter';

export { createRollbackManager, STEP_TYPES } from './rollback';
export type { StepTypes, RollbackStep, RollbackResult, RollbackManager } from './rollback';

export { createArtifactChecker } from './artifact.checker';
export type { CheckUniquenessOpts, ArtifactChecker } from './artifact.checker';

export { createOperationLog, maskTokens, normalizeToV2 } from './operation.log';
export type { OperationLogEntry, AuditEntry, OperationLog } from './operation.log';

export { createStructuredLogger, generateOperationId, LOG_LEVEL_PRIORITY } from './structured.logger';
export type { LogLevel, StructuredLoggerDeps, StructuredLogger } from './structured.logger';

export { createLockManager } from './lock.manager';
export type { LockData, LockManagerDeps, LockManager } from './lock.manager';

export { resolveActorMetadata, detectCI, resolveCIActor } from './actor.resolver';
export type { ActorMetadata, ActorResolverDeps } from './actor.resolver';

export { createActionTracer } from './action.tracer';
export type { ActionTraceEntry, ActionTracer } from './action.tracer';
