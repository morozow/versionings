// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * Resolves the CLI binary path for E2E tests.
 *
 * By default, points to the dev build at `out/dist/index.js`.
 * When `VERSIONINGS_CLI_PATH` env var is set (e.g. by the pack test
 * runner), uses that path instead — allowing the same E2E tests to
 * run against the npm-packed tarball binary.
 *
 * When running against the packed binary (`VERSIONINGS_CLI_PATH` set),
 * the build step in `beforeAll` is skipped — the binary is already built.
 */

import * as path from 'path';

export const PROJECT_ROOT = path.resolve(__dirname, '../..');

export const CLI_PATH = process.env.VERSIONINGS_CLI_PATH
  ? path.resolve(process.env.VERSIONINGS_CLI_PATH)
  : path.resolve(PROJECT_ROOT, 'out/dist/index.js');

/** True when running against a pre-built binary (pack mode). */
export const IS_PACKED = !!process.env.VERSIONINGS_CLI_PATH;
