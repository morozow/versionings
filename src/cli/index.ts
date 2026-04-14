// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

export { buildCli, preprocessArgv, SUBCOMMANDS, EXIT_CODES_EPILOG } from './command.router';

export { createInteractionManager } from './interaction.manager';
export type { InteractionOpts, InteractionManager } from './interaction.manager';

export {
  runChangelogCommand,
  runDoctorCommand,
  runInitCommand,
  runPlanCommand,
  runReleaseCommand,
  runRollbackCommand,
  runValidateCommand,
} from './commands';
export type {
  ChangelogCommandOpts,
  ChangelogCommandDeps,
  DoctorCommandDeps,
  DoctorResult,
  InitCommandDeps,
  PlanCommandDeps,
  ReleaseCommandOpts,
  ReleaseCommandDeps,
  RollbackCommandOpts,
  RollbackCommandDeps,
  ValidateCommandDeps,
} from './commands';
