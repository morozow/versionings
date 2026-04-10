// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * Branching Strategy Registry — data-driven mapping of `git.branching.strategy`
 * values to Branching_Strategy factory functions.
 *
 * Adding a new strategy = registering a factory in the registry.
 * No pipeline or CLI code changes required.
 */

import type { VersioningsConfig } from '../config/config.validator';
import type { Branching_Strategy } from './branching.strategy';
import { VersioningsError, EXIT_CODES } from '../core/errors';
import { createDefaultStrategy } from './strategies/default.strategy';
import { createTrunkStrategy } from './strategies/trunk.strategy';
import { createGitFlowStrategy } from './strategies/gitflow.strategy';
import { createReleaseBranchStrategy } from './strategies/release.strategy';
import { createHotfixStrategy } from './strategies/hotfix.strategy';
import { createMaintenanceStrategy } from './strategies/maintenance.strategy';

/** Factory function that creates a Branching_Strategy instance from config. */
export type StrategyFactory = (config: VersioningsConfig) => Branching_Strategy;

/** Registry interface for branching strategy lookup and registration. */
export interface Strategy_Registry {
  /** Registers (or overrides) a strategy factory for the given name. */
  register(name: string, factory: StrategyFactory): void;
  /** Returns a Branching_Strategy for the given name, created via its factory. */
  getStrategy(name: string, config: VersioningsConfig): Branching_Strategy;
  /** Returns the list of registered strategy names. */
  availableStrategies(): string[];
}

/**
 * Creates a Strategy_Registry with pre-registered placeholder strategies
 * for all supported branching workflows.
 *
 * Real strategy factories (default.strategy.ts, trunk.strategy.ts, etc.)
 * override the placeholders via `register()` when they become available.
 *
 * Throws VersioningsError(CONFIG_ERROR) when getStrategy is called
 * with an unknown strategy name, listing available strategies.
 */
export function createStrategyRegistry(): Strategy_Registry {
  const factories = new Map<string, StrategyFactory>();

  // Pre-register real strategy factories.
  factories.set('default', createDefaultStrategy);
  factories.set('trunk-based', createTrunkStrategy);
  factories.set('git-flow', createGitFlowStrategy);
  factories.set('release-branch', createReleaseBranchStrategy);
  factories.set('hotfix', createHotfixStrategy);
  factories.set('maintenance', createMaintenanceStrategy);

  return {
    register(name: string, factory: StrategyFactory): void {
      factories.set(name, factory);
    },

    getStrategy(name: string, config: VersioningsConfig): Branching_Strategy {
      const factory = factories.get(name);
      if (!factory) {
        const available = Array.from(factories.keys()).join(', ');
        throw new VersioningsError(
          EXIT_CODES.CONFIG_ERROR,
          `Unknown branching strategy "${name}". Available strategies: ${available}`,
          { strategy: name, availableStrategies: Array.from(factories.keys()) },
        );
      }
      return factory(config);
    },

    availableStrategies(): string[] {
      return Array.from(factories.keys());
    },
  };
}
