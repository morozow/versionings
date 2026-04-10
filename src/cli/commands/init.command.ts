// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import Ajv from 'ajv';

import { InteractionManager } from '../interaction.manager';
import { Executor } from '../../core/executor';
import { serializeYaml } from '../../config/yaml.parser';
import { schema } from '../../config/config.validator';
import { EXIT_CODES, VersioningsError } from '../../core/errors';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface InitCommandDeps {
  interactionManager: InteractionManager;
  executor: Executor;
  cwd: string;
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  existsSync?: (p: string) => boolean;
  writeFileSync?: (p: string, data: string) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLATFORMS: readonly string[] = ['github', 'bitbucket'];
const DEFAULT_PR_TARGET = 'main';
const JSON_FORMAT = 'json' as const;
const YAML_FORMAT = 'yaml' as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Infer git platform from a repository URL.
 * Returns 'github' or 'bitbucket' if detectable, undefined otherwise.
 */
function inferPlatform(url: string): string | undefined {
  const lower = url.toLowerCase();
  if (lower.includes('github.com') || lower.includes('github')) {
    return 'github';
  }
  if (lower.includes('bitbucket.org') || lower.includes('bitbucket')) {
    return 'bitbucket';
  }
  return undefined;
}

/**
 * Determine the output file name based on format.
 */
function getFileName(format: 'json' | 'yaml'): string {
  return format === 'yaml' ? '.versioningsrc.yml' : 'version.json';
}

/**
 * Build a minimal valid config object from user inputs.
 */
function buildConfig(platform: string, url: string, prTarget: string): Record<string, any> {
  return {
    git: {
      platform,
      url,
      pr: {
        target: prTarget,
      },
    },
  };
}

/**
 * Validate config against the JSON Schema. Throws VersioningsError on failure.
 */
function validateConfig(config: Record<string, any>): void {
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);
  const valid = validate(config);
  if (!valid && validate.errors) {
    const errors = validate.errors.map((err) => ({
      path: err.instancePath || '/',
      message: err.message,
      params: err.params,
    }));
    throw new VersioningsError(
      EXIT_CODES.CONFIG_ERROR,
      'Generated configuration does not match schema.',
      { validationErrors: errors },
    );
  }
}

/**
 * Serialize config to the chosen format.
 */
function serializeConfig(config: Record<string, any>, format: 'json' | 'yaml'): string {
  if (format === 'yaml') {
    return serializeYaml(config);
  }
  return JSON.stringify(config, null, 2) + '\n';
}

/**
 * Try to auto-detect the repository URL from `git remote get-url origin`.
 */
async function detectRemoteUrl(executor: Executor): Promise<string | undefined> {
  try {
    const result = await executor.run('git remote get-url origin');
    const url = result.stdout.trim();
    return url.length > 0 ? url : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Interactive prompt helpers
// ---------------------------------------------------------------------------

function createRl(
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
): readline.Interface {
  return readline.createInterface({
    input: stdin,
    output: stdout,
    terminal: false,
  });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

// ---------------------------------------------------------------------------
// Interactive wizard
// ---------------------------------------------------------------------------

async function runWizard(
  rl: readline.Interface,
  stdout: NodeJS.WritableStream,
  detectedUrl: string | undefined,
  formatFromFlag: 'json' | 'yaml' | undefined,
): Promise<{ platform: string; url: string; prTarget: string; format: 'json' | 'yaml' }> {
  // 1. Git platform
  const platformPrompt = `Git platform (${PLATFORMS.join('/')}): `;
  let platform = '';
  while (!PLATFORMS.includes(platform)) {
    platform = (await ask(rl, platformPrompt)).toLowerCase();
    if (!PLATFORMS.includes(platform)) {
      stdout.write(`Invalid platform. Choose one of: ${PLATFORMS.join(', ')}\n`);
    }
  }

  // 2. Repository URL
  const urlDefault = detectedUrl ? ` [${detectedUrl}]` : '';
  const urlPrompt = `Repository URL${urlDefault}: `;
  const urlAnswer = await ask(rl, urlPrompt);
  const url = urlAnswer.length > 0 ? urlAnswer : (detectedUrl || '');
  if (url.length === 0) {
    throw new VersioningsError(
      EXIT_CODES.INVALID_ARGS,
      'Repository URL is required.',
    );
  }

  // 3. PR target branch
  const prPrompt = `PR target branch [${DEFAULT_PR_TARGET}]: `;
  const prAnswer = await ask(rl, prPrompt);
  const prTarget = prAnswer.length > 0 ? prAnswer : DEFAULT_PR_TARGET;

  // 4. File format (skip if --format was provided)
  let format: 'json' | 'yaml';
  if (formatFromFlag) {
    format = formatFromFlag;
  } else {
    const formatPrompt = `Config format (json/yaml) [json]: `;
    const formatAnswer = (await ask(rl, formatPrompt)).toLowerCase();
    format = formatAnswer === 'yaml' ? YAML_FORMAT : JSON_FORMAT;
  }

  return { platform, url, prTarget, format };
}

// ---------------------------------------------------------------------------
// Overwrite confirmation
// ---------------------------------------------------------------------------

async function confirmOverwrite(
  rl: readline.Interface,
  filePath: string,
  interactive: boolean,
): Promise<boolean> {
  if (!interactive) {
    // Non-interactive: overwrite without asking
    return true;
  }
  const answer = await ask(rl, `File ${filePath} already exists. Overwrite? [y/N] `);
  const lower = answer.toLowerCase();
  return lower === 'y' || lower === 'yes';
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Interactive wizard for creating a versionings configuration file.
 * In non-interactive mode, generates a file with defaults.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */
export async function runInitCommand(
  opts: { format?: 'json' | 'yaml' },
  deps: InitCommandDeps,
): Promise<void> {
  const exists = deps.existsSync ?? fs.existsSync;
  const writeFile = deps.writeFileSync ?? fs.writeFileSync;
  const interactive = deps.interactionManager.isInteractive();

  // Auto-detect remote URL
  const detectedUrl = await detectRemoteUrl(deps.executor);

  let platform: string;
  let url: string;
  let prTarget: string;
  let format: 'json' | 'yaml' = opts.format ?? JSON_FORMAT;

  if (interactive) {
    const rl = createRl(deps.stdin, deps.stdout);
    try {
      const result = await runWizard(rl, deps.stdout, detectedUrl, opts.format);
      platform = result.platform;
      url = result.url;
      prTarget = result.prTarget;
      format = result.format;
    } finally {
      rl.close();
    }
  } else {
    // Non-interactive: use defaults + auto-detected values
    url = detectedUrl || '';
    platform = inferPlatform(url) || 'github';
    prTarget = DEFAULT_PR_TARGET;

    if (url.length === 0) {
      throw new VersioningsError(
        EXIT_CODES.CONFIG_ERROR,
        'Cannot detect repository URL. Provide git remote or run in interactive mode.',
      );
    }
  }

  // Build config
  const config = buildConfig(platform, url, prTarget);

  // Validate against schema before writing
  validateConfig(config);

  // Determine output file
  const fileName = getFileName(format);
  const filePath = path.join(deps.cwd, fileName);

  // Check for existing file
  if (exists(filePath)) {
    if (interactive) {
      const rl = createRl(deps.stdin, deps.stdout);
      try {
        const overwrite = await confirmOverwrite(rl, fileName, interactive);
        if (!overwrite) {
          throw new VersioningsError(
            EXIT_CODES.USER_CANCELLED,
            'Init cancelled by user.',
          );
        }
      } finally {
        rl.close();
      }
    }
    // Non-interactive: overwrite silently
  }

  // Serialize and write
  const content = serializeConfig(config, format);
  writeFile(filePath, content);

  deps.stdout.write(`Created ${fileName}\n`);
}
