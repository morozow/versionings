// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { VersioningsError, EXIT_CODES } from './errors';
import { AVAILABLE_SEMVERS } from './version.utils';

// ---------------------------------------------------------------------------
// Available subcommands (for help and error messages)
// ---------------------------------------------------------------------------

export const SUBCOMMANDS = ['init', 'validate', 'plan', 'release', 'rollback', 'doctor', 'changelog'];

// ---------------------------------------------------------------------------
// Argv preprocessing: legacy backward compatibility
//
// If no subcommand is present but --semver and --branch are provided,
// prepend 'release' to argv so yargs routes correctly.
// This runs BEFORE yargs parses, avoiding strictCommands conflicts.
// ---------------------------------------------------------------------------

export function preprocessArgv(argv: string[]): string[] {
  // argv from process.argv.slice(2)
  const hasSubcommand = argv.length > 0
    && !argv[0].startsWith('-')
    && SUBCOMMANDS.includes(argv[0]);

  if (hasSubcommand) return argv;

  const hasSemver = argv.some((a) => a.startsWith('--semver'));
  const hasBranch = argv.some((a) => a.startsWith('--branch'));

  if (hasSemver && hasBranch) {
    return ['release', ...argv];
  }

  return argv;
}

// ---------------------------------------------------------------------------
// Exit codes epilog for help
// ---------------------------------------------------------------------------

export const EXIT_CODES_EPILOG = [
  'Exit Codes:',
  '  0  SUCCESS                  Successful completion',
  '  1  CONFIG_ERROR             Configuration error',
  '  2  DIRTY_TREE               Uncommitted changes in working tree',
  '  3  INVALID_ARGS             Invalid CLI arguments',
  '  4  ARTIFACT_CONFLICT        Branch or tag already exists',
  '  5  COMMAND_FAILED           Git/npm command failed',
  '  6  NETWORK_ERROR            Network error',
  '  7  INCOMPLETE_ROLLBACK      Rollback could not complete all steps',
  '  8  NO_OPERATION             Nothing to rollback',
  '  9  USER_CANCELLED           User cancelled the operation',
  ' 10  POLICY_VIOLATION         Branch protection policy violated',
  ' 11  NO_CONVENTIONAL_COMMITS  No conventional commits found for auto-bump',
].join('\n');

// ---------------------------------------------------------------------------
// Build yargs instance
// ---------------------------------------------------------------------------

export function buildCli(argv: string[]) {
  const yargs = require('yargs')(argv);

  return yargs
    .scriptName('versionings')
    .usage('Usage: $0 <command> [options]')

    // ---- Global options ----
    .option('json', {
      type: 'boolean',
      default: false,
      global: true,
      describe: 'Output in JSON format',
    })
    .option('verbose', {
      type: 'boolean',
      default: false,
      global: true,
      describe: 'Enable verbose output',
    })
    .option('ci', {
      type: 'boolean',
      default: false,
      global: true,
      describe: 'Run in CI mode (non-interactive, no prompts)',
    })
    .option('non-interactive', {
      type: 'boolean',
      default: false,
      global: true,
      describe: 'Disable interactive prompts',
    })
    .option('yes', {
      alias: 'y',
      type: 'boolean',
      default: false,
      global: true,
      describe: 'Auto-confirm all prompts',
    })
    .option('strict', {
      type: 'boolean',
      default: false,
      global: true,
      describe: 'Treat unknown config fields as errors',
    })
    .option('print-config', {
      type: 'boolean',
      default: false,
      global: true,
      describe: 'Print resolved config with provenance and exit',
    })

    // ---- Subcommand: init ----
    .command('init', 'Generate a configuration file', (y: any) => {
      return y
        .option('format', {
          type: 'string',
          choices: ['json', 'yaml'],
          describe: 'Output format for the config file',
        })
        .example('$0 init', 'Interactive config wizard')
        .example('$0 init --format=yaml', 'Generate YAML config')
        .example('$0 init --format=json --non-interactive', 'Generate JSON config in CI');
    })

    // ---- Subcommand: validate ----
    .command('validate', 'Validate configuration and environment', (y: any) => {
      return y
        .example('$0 validate', 'Check config and git setup')
        .example('$0 validate --json', 'JSON output for CI')
        .example('$0 validate --strict', 'Fail on unknown config fields');
    })

    // ---- Subcommand: plan ----
    .command('plan', 'Show execution plan without making changes (dry-run)', (y: any) => {
      return y
        .option('semver', {
          type: 'string',
          choices: AVAILABLE_SEMVERS,
          demandOption: true,
          describe: 'Semantic version type (patch, minor, major, auto, ...)',
        })
        .option('branch', {
          type: 'string',
          demandOption: true,
          describe: 'Branch comment / description',
        })
        .option('push', {
          type: 'boolean',
          default: false,
          describe: 'Include push step in plan',
        })
        .option('preid', {
          type: 'string',
          describe: 'Prerelease identifier',
        })
        .option('pr-mode', {
          type: 'string',
          choices: ['auto', 'api', 'url'],
          default: 'auto',
          describe: 'PR creation mode: auto (API with fallback), api (API only), url (URL only)',
        })
        .option('no-pr', {
          type: 'boolean',
          default: false,
          describe: 'Skip PR/MR creation',
        })
        .example('$0 plan --semver=patch --branch=fix-login', 'Preview patch release')
        .example('$0 plan --semver=minor --branch=new-feature --json', 'JSON plan for CI');
    })

    // ---- Subcommand: release ----
    .command('release', 'Execute the versioning workflow', (y: any) => {
      return y
        .option('semver', {
          type: 'string',
          choices: AVAILABLE_SEMVERS,
          demandOption: true,
          describe: 'Semantic version type (patch, minor, major, auto, ...)',
        })
        .option('branch', {
          type: 'string',
          demandOption: true,
          describe: 'Branch comment / description',
        })
        .option('push', {
          type: 'boolean',
          default: false,
          describe: 'Push branch and tags to remote',
        })
        .option('preid', {
          type: 'string',
          describe: 'Prerelease identifier',
        })
        .option('dry-run', {
          type: 'boolean',
          default: false,
          describe: 'Show plan without executing',
        })
        .option('pr-mode', {
          type: 'string',
          choices: ['auto', 'api', 'url'],
          default: 'auto',
          describe: 'PR creation mode: auto (API with fallback), api (API only), url (URL only)',
        })
        .option('no-pr', {
          type: 'boolean',
          default: false,
          describe: 'Skip PR/MR creation',
        })
        .example('$0 release --semver=patch --branch=fix-login', 'Patch release (interactive)')
        .example('$0 release --semver=minor --branch=feat --push --yes', 'Minor release, push, no prompt')
        .example('$0 release --semver=patch --branch=fix --ci', 'Release in CI mode');
    })

    // ---- Subcommand: rollback ----
    .command('rollback', 'Rollback the last versioning operation', (y: any) => {
      return y
        .option('from', {
          type: 'string',
          describe: 'Path to a specific operation log file',
        })
        .example('$0 rollback', 'Rollback last operation')
        .example('$0 rollback --from=.versionings/operations/2025-01-15.json', 'Rollback specific operation')
        .example('$0 rollback --yes', 'Rollback without confirmation');
    })

    // ---- Subcommand: doctor ----
    .command('doctor', 'Diagnose environment and configuration', (y: any) => {
      return y
        .example('$0 doctor', 'Run all diagnostics')
        .example('$0 doctor --json', 'JSON diagnostics for CI');
    })

    // ---- Subcommand: changelog ----
    .command('changelog', 'Generate changelog from commit history', (y: any) => {
      return y
        .option('from', {
          type: 'string',
          describe: 'Start tag or commit SHA',
        })
        .option('to', {
          type: 'string',
          default: 'HEAD',
          describe: 'End tag or commit SHA',
        })
        .option('output', {
          type: 'string',
          describe: 'Write changelog to file',
        })
        .option('format', {
          type: 'string',
          choices: ['markdown', 'plain'],
          default: 'markdown',
          describe: 'Output format for changelog',
        })
        .example('$0 changelog', 'Generate changelog to stdout')
        .example('$0 changelog --output=CHANGELOG.md', 'Write to file')
        .example('$0 changelog --from=v1.0.0 --to=v2.0.0', 'Specific range')
        .example('$0 changelog --json', 'Structured JSON output');
    })

    .strictCommands()
    .epilog(EXIT_CODES_EPILOG)
    .fail((msg: string | null, err: Error | null, yargsInstance: any) => {
      if (err) throw err;
      // Unknown command or validation error from yargs
      if (msg) {
        const availableList = SUBCOMMANDS.map((c) => `  ${c}`).join('\n');
        throw new VersioningsError(
          EXIT_CODES.INVALID_ARGS,
          `${msg}\n\nAvailable commands:\n${availableList}`,
        );
      }
    })
    .help()
    .version(false);
}
