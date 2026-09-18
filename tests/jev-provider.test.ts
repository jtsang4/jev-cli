import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { experimental_evaluate as evaluate } from 'ai';

import { createJevEvaluationModel } from '../src/providers/jev.ts';
import { toProviderError } from '../src/provider-errors.ts';
import type { ResolvedProvider } from '../src/providers/index.ts';

/**
 * The provider is a hand-written HTTP client, so the tests drive a real server
 * rather than a fetch stub: the wire format is exactly what we need to pin down.
 */
let server: ReturnType<typeof Bun.serve>;
let lastRequest: Record<string, unknown>;
let reply: { status: number; body: unknown } = { status: 200, body: {} };

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname !== '/v1/systemone') return new Response('not found', { status: 404 });
      lastRequest = {
        authorization: request.headers.get('authorization'),
        body: await request.json(),
      };
      return new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
});

afterAll(() => {
  server.stop(true);
});

function resolved(): ResolvedProvider {
  return {
    provider: 'jev',
    model: 'jev-latest',
    apiKey: 'ts_test_key',
    apiKeySource: 'test',
    baseURL: `http://localhost:${server.port}/v1`,
  };
}

function run(questions: Parameters<typeof evaluate>[0]['questions']) {
  return evaluate({ model: createJevEvaluationModel(resolved()), state: 'a state', questions });
}

describe('request mapping', () => {
  test('sends the bearer key, the model, and noul for boolean questions', async () => {
    reply = {
      status: 200,
      body: {
        model: 'jev-1.13.0',
        answers: { urgent: { type: 'noul', noul: 0.92 } },
        usage: { input_tokens: 312, output_tokens: 48 },
      },
    };

    const result = await run({
      urgent: {
        type: 'boolean',
        instructions: 'Is this urgent?',
        criteria: { true: 'time-sensitive', false: 'no urgency' },
      },
    });

    expect(lastRequest.authorization).toBe('Bearer ts_test_key');
    expect(lastRequest.body).toEqual({
      state: 'a state',
      model: 'jev-latest',
      questions: {
        urgent: {
          type: 'noul',
          instructions: 'Is this urgent?',
          criteria: { true: 'time-sensitive', false: 'no urgency' },
        },
      },
    });

    expect(result.answers.urgent).toEqual({ type: 'boolean', probability: 0.92 });
    expect(result.usage).toEqual({ inputTokens: 312, outputTokens: 48, totalTokens: 360 });
  });

  test('omits criteria when a boolean question has none', async () => {
    reply = { status: 200, body: { model: 'jev-1.13.0', answers: { q: { type: 'noul', noul: 0.1 } } } };
    await run({ q: { type: 'boolean', instructions: 'Well?' } });

    const questions = (lastRequest.body as { questions: Record<string, unknown> }).questions;
    expect(questions.q).toEqual({ type: 'noul', instructions: 'Well?' });
  });

  test('passes choice and score through unchanged', async () => {
    reply = {
      status: 200,
      body: {
        model: 'jev-1.13.0',
        answers: {
          department: {
            type: 'choice',
            choice: 'technical',
            probabilities: { billing: 0.08, technical: 0.85, sales: 0.07 },
            confidence: 0.82,
          },
        },
      },
    };

    await run({
      department: {
        type: 'choice',
        instructions: 'Which team?',
        criteria: { billing: 'Payments', technical: 'Bugs', sales: null },
      },
    });

    const questions = (lastRequest.body as { questions: Record<string, unknown> }).questions;
    expect(questions.department).toEqual({
      type: 'choice',
      instructions: 'Which team?',
      criteria: { billing: 'Payments', technical: 'Bugs', sales: null },
    });
  });
});

describe('response mapping', () => {
  test('keeps confidence and legend under providerMetadata', async () => {
    reply = {
      status: 200,
      body: {
        model: 'jev-1.13.0',
        answers: {
          frustration: {
            type: 'score',
            score: 1.6,
            legend: { '0': 'Calm', '1': 'Frustrated', '2': 'Very angry' },
            probabilities: { '0': 0.05, '1': 0.3, '2': 0.65 },
            confidence: 0.78,
          },
        },
      },
    };

    const result = await run({
      frustration: {
        type: 'score',
        instructions: 'How frustrated?',
        criteria: ['Calm', 'Frustrated', 'Very angry'],
      },
    });

    expect(result.answers.frustration).toEqual({
      type: 'score',
      score: 1.6,
      probabilities: { '0': 0.05, '1': 0.3, '2': 0.65 },
    });
    expect(result.providerMetadata?.jev).toEqual({
      model: 'jev-1.13.0',
      answers: {
        frustration: {
          confidence: 0.78,
          legend: { '0': 'Calm', '1': 'Frustrated', '2': 'Very angry' },
        },
      },
    });
    // The served version, not the alias we asked for.
    expect(result.response.modelId).toBe('jev-1.13.0');
  });

  test('declares rounding so rounded distributions are not rejected', async () => {
    reply = {
      status: 200,
      body: {
        model: 'jev-1.13.0',
        answers: {
          pick: {
            type: 'choice',
            choice: 'c',
            // Sums to 0.99 — valid only because we report two-decimal rounding.
            probabilities: { a: 0.33, b: 0.33, c: 0.33 },
          },
        },
      },
    };

    const result = await run({
      pick: { type: 'choice', instructions: 'Pick', criteria: { a: null, b: null, c: null } },
    });
    expect(result.rounding?.probabilityDecimals).toBe(2);
  });
});

describe('error mapping', () => {
  async function failure(status: number, body: unknown) {
    reply = { status, body };
    try {
      await run({ q: { type: 'boolean', instructions: 'x' } });
      throw new Error('expected the evaluation to fail');
    } catch (error) {
      return toProviderError(error, { provider: 'jev' });
    }
  }

  test('401 is a config error so the exit code points at credentials', async () => {
    const error = await failure(401, { detail: 'Invalid API key' });
    expect(error.exitCode).toBe(3);
    expect(error.message).toContain('Invalid API key');
  });

  test('422 surfaces the offending field as a runtime error', async () => {
    const error = await failure(422, { detail: 'questions.q.criteria: too few levels' });
    expect(error.exitCode).toBe(1);
    expect(error.message).toContain('too few levels');
  });
});
