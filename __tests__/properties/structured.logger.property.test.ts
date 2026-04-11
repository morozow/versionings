// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as fc from 'fast-check';
import { createStructuredLogger, LOG_LEVEL_PRIORITY } from '../../src/core/structured.logger';
import type { LogLevel } from '../../src/core/structured.logger';

/**
 * Helper: create an array-backed writable stream that captures written chunks.
 */
function createCapture(): { stream: NodeJS.WritableStream; lines: string[] } {
  const lines: string[] = [];
  const stream = {
    write(chunk: string): boolean {
      lines.push(chunk);
      return true;
    },
  } as unknown as NodeJS.WritableStream;
  return { stream, lines };
}

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;

/** Arbitrary for a valid log level */
const arbLogLevel: fc.Arbitrary<LogLevel> = fc.constantFrom(...LOG_LEVELS);

/** Arbitrary for a non-empty message string (JSON-safe) */
const arbMessage = fc.string({ minLength: 1, maxLength: 200 });

/** Arbitrary for a UUID-like operationId */
const arbOperationId = fc.uuid();

/** Arbitrary for optional context object */
const arbContext: fc.Arbitrary<Record<string, unknown> | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.dictionary(
    fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /^[a-zA-Z]/.test(s)),
    fc.oneof(fc.string({ maxLength: 50 }), fc.integer(), fc.boolean()),
  ),
);

/** Arbitrary for optional actor string */
const arbActor: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.string({ minLength: 1, maxLength: 50 }),
);

/** Arbitrary for optional ci boolean */
const arbCi: fc.Arbitrary<boolean | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.constant(true),
  fc.constant(false),
);


/**
 * Property 1: Структура лог-сообщения
 *
 * For any valid set of inputs (level, message, operationId, context, actor, ci),
 * calling the corresponding Structured Logger method SHALL produce a string that,
 * when parsed as JSON, contains: timestamp (valid ISO 8601), level, message, operationId.
 * Actor is present when level >= info AND actor is set.
 * ci is present when ci === true.
 *
 * **Validates: Requirements 1.1, 2.2, 3.6, 9.5**
 */
describe('Feature: operational-hardening, Property 1: Структура лог-сообщения', () => {
  test('output parses as JSON and contains timestamp (ISO 8601), level, message, operationId', () => {
    fc.assert(
      fc.property(
        arbLogLevel,
        arbMessage,
        arbOperationId,
        arbContext,
        arbActor,
        arbCi,
        (msgLevel, message, operationId, context, actor, ci) => {
          const { stream, lines } = createCapture();

          // Configure logger at 'debug' so all messages pass through
          const logger = createStructuredLogger({
            output: stream,
            level: 'debug',
            operationId,
            actor,
            ci,
          });

          // Call the method matching msgLevel
          logger[msgLevel](message, context);

          // Exactly one line should be written
          expect(lines).toHaveLength(1);

          // Must parse as JSON
          const entry = JSON.parse(lines[0]);

          // timestamp must be a valid ISO 8601 string
          expect(typeof entry.timestamp).toBe('string');
          expect(ISO_8601_REGEX.test(entry.timestamp)).toBe(true);
          // Verify it's a valid date
          expect(Number.isNaN(Date.parse(entry.timestamp))).toBe(false);

          // level must match the called method
          expect(entry.level).toBe(msgLevel);

          // message must match the input
          expect(entry.message).toBe(message);

          // operationId must match the input
          expect(entry.operationId).toBe(operationId);

          // context: if provided, must be present
          if (context !== undefined) {
            expect(entry.context).toEqual(context);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test('actor is present when level >= info AND actor is set', () => {
    fc.assert(
      fc.property(
        arbLogLevel,
        arbMessage,
        arbOperationId,
        arbActor,
        arbCi,
        (msgLevel, message, operationId, actor, ci) => {
          const { stream, lines } = createCapture();

          const logger = createStructuredLogger({
            output: stream,
            level: 'debug',
            operationId,
            actor,
            ci,
          });

          logger[msgLevel](message);

          expect(lines).toHaveLength(1);
          const entry = JSON.parse(lines[0]);

          const msgPriority = LOG_LEVEL_PRIORITY[msgLevel];
          const infoPriority = LOG_LEVEL_PRIORITY['info'];

          if (msgPriority >= infoPriority && actor !== undefined) {
            // actor SHOULD be present
            expect(entry.actor).toBe(actor);
          } else {
            // actor SHOULD NOT be present
            expect(entry).not.toHaveProperty('actor');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test('ci is present when ci === true', () => {
    fc.assert(
      fc.property(
        arbLogLevel,
        arbMessage,
        arbOperationId,
        arbActor,
        arbCi,
        (msgLevel, message, operationId, actor, ci) => {
          const { stream, lines } = createCapture();

          const logger = createStructuredLogger({
            output: stream,
            level: 'debug',
            operationId,
            actor,
            ci,
          });

          logger[msgLevel](message);

          expect(lines).toHaveLength(1);
          const entry = JSON.parse(lines[0]);

          if (ci === true) {
            expect(entry.ci).toBe(true);
          } else {
            // ci should NOT be present when ci is false or undefined
            expect(entry).not.toHaveProperty('ci');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


/**
 * Property 2: Фильтрация по уровню логирования
 *
 * For any configured log level and any message log level, the message SHALL be
 * output if and only if priority[messageLevel] >= priority[configuredLevel].
 * When verbose=true (level='debug'), all messages are output.
 *
 * **Validates: Requirements 1.4, 1.5, 13.5**
 */
describe('Feature: operational-hardening, Property 2: Фильтрация по уровню логирования', () => {
  test('message is output ⟺ priority[messageLevel] >= priority[configuredLevel]', () => {
    fc.assert(
      fc.property(
        arbLogLevel,
        arbLogLevel,
        arbMessage,
        arbOperationId,
        (configuredLevel, messageLevel, message, operationId) => {
          const { stream, lines } = createCapture();

          const logger = createStructuredLogger({
            output: stream,
            level: configuredLevel,
            operationId,
          });

          logger[messageLevel](message);

          const configuredPriority = LOG_LEVEL_PRIORITY[configuredLevel];
          const messagePriority = LOG_LEVEL_PRIORITY[messageLevel];

          if (messagePriority >= configuredPriority) {
            // Message SHOULD be output
            expect(lines).toHaveLength(1);
            const entry = JSON.parse(lines[0]);
            expect(entry.level).toBe(messageLevel);
            expect(entry.message).toBe(message);
          } else {
            // Message SHOULD NOT be output
            expect(lines).toHaveLength(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test('when verbose=true (level="debug"), all messages are output', () => {
    fc.assert(
      fc.property(
        arbLogLevel,
        arbMessage,
        arbOperationId,
        (messageLevel, message, operationId) => {
          const { stream, lines } = createCapture();

          // verbose=true means configuredLevel='debug' (priority 0)
          const logger = createStructuredLogger({
            output: stream,
            level: 'debug',
            operationId,
          });

          logger[messageLevel](message);

          // All messages must pass through when level is 'debug'
          expect(lines).toHaveLength(1);
          const entry = JSON.parse(lines[0]);
          expect(entry.level).toBe(messageLevel);
          expect(entry.message).toBe(message);
        },
      ),
      { numRuns: 100 },
    );
  });
});
