// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

export type {
  StrategyParams,
  StrategyValidationResult,
  BranchResult,
  Branching_Strategy,
} from './branching.strategy';

export { checkPolicy } from './policy.checker';
export type { PolicyCheckResult, BranchProtectionInfo, PolicyCheckerDeps } from './policy.checker';

export { createStrategyRegistry } from './strategy.registry';
export type { StrategyFactory, Strategy_Registry } from './strategy.registry';

export {
  createDefaultStrategy,
  createGitFlowStrategy,
  createHotfixStrategy,
  createMaintenanceStrategy,
  createReleaseBranchStrategy,
  createTrunkStrategy,
} from './strategies';
