// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { EXIT_CODES, VersioningsError } from '../core/errors';

export interface TemplatePart {
  type: 'literal' | 'variable';
  value: string;  // for literal — text, for variable — variable name without {}
}

export interface TemplateContext {
  version: string;
  major: string;
  minor: string;
  patch: string;
  semver: string;
  comment: string;
  branchType: string;
}

export const TEMPLATE_VARIABLES: readonly string[] = [
  'version', 'major', 'minor', 'patch', 'semver', 'comment', 'branchType',
];

// Characters invalid in Git branch names: spaces, ~, ^, :, ?, *, [, \
export const INVALID_BRANCH_CHARS: RegExp = /[\s~^:?*\[\\]/;

/**
 * Parses a naming template into a structured representation.
 * Throws VersioningsError(CONFIG_ERROR) on unknown variable.
 */
export function parseTemplate(template: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  const regex = /\{([^}]+)\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(template)) !== null) {
    // Add literal part before this variable (if any)
    if (match.index > lastIndex) {
      parts.push({ type: 'literal', value: template.slice(lastIndex, match.index) });
    }

    const varName = match[1];
    if (!TEMPLATE_VARIABLES.includes(varName)) {
      throw new VersioningsError(
        EXIT_CODES.CONFIG_ERROR,
        `Unknown template variable "{${varName}}". Available variables: ${TEMPLATE_VARIABLES.map(v => `{${v}}`).join(', ')}`,
      );
    }

    parts.push({ type: 'variable', value: varName });
    lastIndex = regex.lastIndex;
  }

  // Add trailing literal (if any)
  if (lastIndex < template.length) {
    parts.push({ type: 'literal', value: template.slice(lastIndex) });
  }

  return parts;
}

/**
 * Formats a structured representation back into a template string.
 * Round-trip: formatTemplate(parseTemplate(t)) === t
 */
export function formatTemplate(parts: TemplatePart[]): string {
  return parts
    .map(part => (part.type === 'variable' ? `{${part.value}}` : part.value))
    .join('');
}

/**
 * Renders a template by substituting variables from context.
 * Trims leading/trailing '/' and '-'.
 * Throws VersioningsError(INVALID_ARGS) on invalid characters in result.
 */
export function renderTemplate(template: string, context: TemplateContext): string {
  const parts = parseTemplate(template);

  const rendered = parts
    .map(part => {
      if (part.type === 'variable') {
        return context[part.value as keyof TemplateContext];
      }
      return part.value;
    })
    .join('');

  // Trim leading/trailing '/' and '-'
  const trimmed = rendered.replace(/^[/\-]+/, '').replace(/[/\-]+$/, '');

  if (INVALID_BRANCH_CHARS.test(trimmed)) {
    const invalidChars = trimmed
      .split('')
      .filter(ch => INVALID_BRANCH_CHARS.test(ch))
      .filter((ch, i, arr) => arr.indexOf(ch) === i);
    throw new VersioningsError(
      EXIT_CODES.INVALID_ARGS,
      `Rendered template contains invalid branch characters: ${invalidChars.map(c => JSON.stringify(c)).join(', ')}`,
    );
  }

  return trimmed;
}
