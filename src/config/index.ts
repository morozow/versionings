// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

export { loadConfig } from './config.loader';
export type { ConfigLoaderDeps, ConfigLoadResult } from './config.loader';

export { mergeConfigs } from './config.merger';
export type { ConfigSource, ConfigProvenance } from './config.merger';

export { loadAndValidateConfig, validateWithProvenance } from './config.validator';
export type {
  BranchingConfig,
  BumpLevel,
  ConventionalCommitsConfig,
  ChangelogConfig,
  VersioningsConfig,
  ValidationWarning,
  ValidationResult,
} from './config.validator';

export { parseYaml, serializeYaml } from './yaml.parser';
