// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau
// Feature: branching-policy-enforcement, Properties 10–13: Template Renderer

import * as fc from 'fast-check';
import { parseTemplate, formatTemplate, renderTemplate, TEMPLATE_VARIABLES, INVALID_BRANCH_CHARS } from '../../template.renderer';
import { EXIT_CODES, VersioningsError } from '../../errors';
import type { TemplateContext } from '../../template.renderer';

// --- Generators ---

/** Generate a literal segment: alphanumeric + `/` + `-` + `.`, non-empty */
const arbLiteralSegment = fc
  .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789/-.'.split('')), { minLength: 1, maxLength: 10 })
  .filter((s) => s.length > 0);

/** Generate a variable reference wrapped in {} from TEMPLATE_VARIABLES */
const arbVariableSegment = fc.constantFrom(...TEMPLATE_VARIABLES).map((v) => `{${v}}`);

/** Generate a valid template by combining literal segments and variable references */
const arbTemplate = fc
  .array(fc.oneof(arbLiteralSegment, arbVariableSegment), { minLength: 1, maxLength: 8 })
  .map((parts) => parts.join(''));

/** Generate a safe string for TemplateContext values: alphanumeric + `-` + `.`, no forbidden chars */
const arbSafeValue = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-.'.split('')),
  { minLength: 1, maxLength: 20 },
);

/** Generate a TemplateContext where all values are safe strings */
const arbTemplateContext: fc.Arbitrary<TemplateContext> = fc.record({
  version: arbSafeValue,
  major: arbSafeValue,
  minor: arbSafeValue,
  patch: arbSafeValue,
  semver: arbSafeValue,
  comment: arbSafeValue,
  branchType: arbSafeValue,
});

/** Generate a string NOT in TEMPLATE_VARIABLES (for unknown variable testing) */
const arbInvalidVarName = fc
  .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 1, maxLength: 15 })
  .filter((s) => !(TEMPLATE_VARIABLES as readonly string[]).includes(s));

// --- Property 10: Round-trip of naming templates ---
// Feature: branching-policy-enforcement, Property 10: Round-trip of naming templates — formatTemplate(parseTemplate(t)) === t

describe('Property 10: Round-trip of naming templates', () => {
  it('formatTemplate(parseTemplate(template)) === template for any valid template', () => {
    fc.assert(
      fc.property(arbTemplate, (template: string) => {
        const parts = parseTemplate(template);
        const roundTripped = formatTemplate(parts);
        expect(roundTripped).toBe(template);
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 11: Rendered template produces valid Git ref name ---
// Feature: branching-policy-enforcement, Property 11: Rendered template produces valid Git ref name (no forbidden chars, no leading/trailing / or -)

describe('Property 11: Rendered template produces valid Git ref name', () => {
  it('renderTemplate result does NOT contain INVALID_BRANCH_CHARS and does NOT start/end with / or -', () => {
    fc.assert(
      fc.property(arbTemplate, arbTemplateContext, (template: string, context: TemplateContext) => {
        const result = renderTemplate(template, context);
        // No forbidden characters
        expect(INVALID_BRANCH_CHARS.test(result)).toBe(false);
        // Does not start with / or -
        expect(result.startsWith('/')).toBe(false);
        expect(result.startsWith('-')).toBe(false);
        // Does not end with / or -
        expect(result.endsWith('/')).toBe(false);
        expect(result.endsWith('-')).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 12: Error on unknown variable in template ---
// Feature: branching-policy-enforcement, Property 12: Error on unknown variable in template

describe('Property 12: Error on unknown variable in template', () => {
  it('parseTemplate throws VersioningsError(CONFIG_ERROR) for template containing {unknownVar}', () => {
    fc.assert(
      fc.property(arbInvalidVarName, (unknownVar: string) => {
        const template = `prefix/{${unknownVar}}/suffix`;
        try {
          parseTemplate(template);
          throw new Error('Expected VersioningsError to be thrown');
        } catch (err: any) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
          expect(err.message).toContain(unknownVar);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 13: All variables in template are substituted ---
// Feature: branching-policy-enforcement, Property 13: All variables in template are substituted (no {varName} remains in output)

describe('Property 13: All variables in template are substituted', () => {
  it('renderTemplate result does NOT contain {variableName} substrings', () => {
    fc.assert(
      fc.property(arbTemplate, arbTemplateContext, (template: string, context: TemplateContext) => {
        const result = renderTemplate(template, context);
        // No unsubstituted variable placeholders should remain
        for (const varName of TEMPLATE_VARIABLES) {
          expect(result).not.toContain(`{${varName}}`);
        }
        // Also check with a general regex for any {word} pattern
        expect(result).not.toMatch(/\{[a-zA-Z]+\}/);
      }),
      { numRuns: 100 },
    );
  });
});
