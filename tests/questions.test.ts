import { describe, expect, test } from 'bun:test';

import { parseQuestions, validateQuestions } from '../src/questions.ts';
import { JevCliError } from '../src/errors.ts';

function expectRejection(raw: unknown, fragment: string): void {
  let thrown: unknown;
  try {
    validateQuestions(raw);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(JevCliError);
  expect((thrown as JevCliError).exitCode).toBe(2);
  expect((thrown as JevCliError).message).toContain(fragment);
}

describe('accepts valid questions', () => {
  test('boolean without criteria', () => {
    const questions = validateQuestions({
      refunded: { type: 'boolean', instructions: 'Was a refund issued?' },
    });
    expect(questions.refunded).toEqual({ type: 'boolean', instructions: 'Was a refund issued?' });
  });

  test('boolean with true/false criteria', () => {
    expect(() =>
      validateQuestions({
        passed: {
          type: 'boolean',
          instructions: 'Did the build succeed?',
          criteria: { true: 'exit code 0', false: 'any non-zero exit code' },
        },
      }),
    ).not.toThrow();
  });

  test('choice with option descriptions, including null', () => {
    expect(() =>
      validateQuestions({
        tone: {
          type: 'choice',
          instructions: 'What tone did the agent use?',
          criteria: { warm: 'friendly and personal', curt: null },
        },
      }),
    ).not.toThrow();
  });

  test('score with two ordered levels', () => {
    expect(() =>
      validateQuestions({
        quality: { type: 'score', instructions: 'Rate the handling.', criteria: ['poor', 'great'] },
      }),
    ).not.toThrow();
  });

  test('structured instructions as object or array', () => {
    expect(() =>
      validateQuestions({
        a: { type: 'boolean', instructions: { ask: 'Was it refunded?', hint: 'look for amounts' } },
        b: { type: 'boolean', instructions: ['first', 'second'] },
      }),
    ).not.toThrow();
  });

  test('mixed types in one request', () => {
    const questions = validateQuestions({
      refunded: { type: 'boolean', instructions: 'Refunded?' },
      tone: { type: 'choice', instructions: 'Tone?', criteria: { warm: 'friendly', curt: 'terse' } },
      quality: { type: 'score', instructions: 'Rate it.', criteria: ['poor', 'ok', 'great'] },
    });
    expect(Object.keys(questions)).toEqual(['refunded', 'tone', 'quality']);
  });
});

describe('rejects invalid questions', () => {
  test('non-object payload', () => {
    expectRejection([], 'questions must be a JSON object');
  });

  test('empty question map', () => {
    expectRejection({}, 'at least one question');
  });

  test('unknown type', () => {
    expectRejection({ q: { type: 'ranking', instructions: 'x' } }, 'questions.q.type must be one of');
  });

  test('missing instructions', () => {
    expectRejection({ q: { type: 'boolean' } }, 'questions.q.instructions');
  });

  test('instructions given as a number', () => {
    expectRejection({ q: { type: 'boolean', instructions: 42 } }, 'but got number');
  });

  test('choice without criteria', () => {
    expectRejection({ q: { type: 'choice', instructions: 'x' } }, 'required for choice questions');
  });

  test('choice with empty criteria', () => {
    expectRejection({ q: { type: 'choice', instructions: 'x', criteria: {} } }, 'at least one option');
  });

  test('score without criteria', () => {
    expectRejection({ q: { type: 'score', instructions: 'x' } }, 'required for score questions');
  });

  test('score with fewer than two levels', () => {
    expectRejection(
      { q: { type: 'score', instructions: 'x', criteria: ['only one'] } },
      'at least two ordered levels, but got 1',
    );
  });

  test('score criteria given as an object', () => {
    expectRejection(
      { q: { type: 'score', instructions: 'x', criteria: { low: 'a', high: 'b' } } },
      'must be an array of ordered levels',
    );
  });

  test('boolean criteria with unexpected keys', () => {
    expectRejection(
      { q: { type: 'boolean', instructions: 'x', criteria: { true: 'a', maybe: 'b' } } },
      'only accepts "true" and "false" keys',
    );
  });
});

describe('parseQuestions', () => {
  test('parses JSON text', () => {
    const questions = parseQuestions('{"q":{"type":"boolean","instructions":"ok?"}}', '--questions');
    expect(questions.q?.type).toBe('boolean');
  });

  test('reports invalid JSON with the source name', () => {
    expect(() => parseQuestions('{not json', '--questions')).toThrow(/--questions is not valid JSON/);
  });

  test('reports empty input', () => {
    expect(() => parseQuestions('   ', '--questions')).toThrow(/was empty/);
  });
});
