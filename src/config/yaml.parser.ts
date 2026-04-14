// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import yaml from 'js-yaml';

import { EXIT_CODES, VersioningsError } from '../core/errors';

/**
 * Parses a YAML string into a JavaScript object.
 * On syntax error, throws VersioningsError(CONFIG_ERROR) with line number and description.
 */
export function parseYaml(content: string, filePath: string): Record<string, any> {
  let parsed: unknown;
  try {
    parsed = yaml.load(content);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'mark' in err) {
      const yamlErr = err as { mark?: { line?: number }; reason?: string; message?: string };
      const line = yamlErr.mark?.line != null ? yamlErr.mark.line + 1 : undefined;
      const reason = yamlErr.reason || yamlErr.message || 'unknown YAML error';
      const lineInfo = line != null ? `line ${line}: ` : '';
      throw new VersioningsError(
        EXIT_CODES.CONFIG_ERROR,
        `Invalid YAML in ${filePath}\n  ${lineInfo}${reason}`,
        { filePath, line: line ?? null, reason },
      );
    }
    throw new VersioningsError(
      EXIT_CODES.CONFIG_ERROR,
      `Invalid YAML in ${filePath}: ${(err as Error).message || 'unknown error'}`,
      { filePath },
    );
  }

  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new VersioningsError(
      EXIT_CODES.CONFIG_ERROR,
      `Invalid YAML in ${filePath}: expected an object, got ${parsed == null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed}`,
      { filePath },
    );
  }

  return parsed as Record<string, any>;
}

/**
 * Serializes a JavaScript object to a YAML string.
 */
export function serializeYaml(obj: Record<string, any>): string {
  return yaml.dump(obj, { noRefs: true });
}
