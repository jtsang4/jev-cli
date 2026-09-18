import { APICallError } from '@ai-sdk/provider';
import type {
  Experimental_EvaluationModelV4 as EvaluationModelV4,
  Experimental_EvaluationModelV4Answer as EvaluationAnswer,
  Experimental_EvaluationModelV4CallOptions as EvaluationCallOptions,
  Experimental_EvaluationModelV4Question as EvaluationQuestion,
  Experimental_EvaluationModelV4Result as EvaluationResult,
  JSONValue,
} from '@ai-sdk/provider';

import type { ResolvedProvider } from './index.ts';

/** TypeSafe AI's own API. The `/v1` suffix is part of the base URL. */
export const JEV_BASE_URL = 'https://api.typesafe.ai/v1';

/**
 * TypeSafe speaks `noul` where the AI SDK spec says `boolean`; the rest of the
 * wire format lines up field for field.
 */
const WIRE_TYPES = { choice: 'choice', score: 'score', boolean: 'noul' } as const;

function toWireQuestion(question: EvaluationQuestion): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    type: WIRE_TYPES[question.type],
    instructions: question.instructions,
  };
  // A boolean question may omit criteria entirely; choice and score may not.
  if (question.criteria !== undefined) wire.criteria = question.criteria;
  return wire;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProbabilityMap(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'number');
}

/**
 * Decimal places visible in a number, used to declare the response's precision.
 * Under-reporting only widens the tolerance core applies when it checks that a
 * distribution sums to 1, so an unparseable value degrades to "no rounding".
 */
function decimalsOf(value: number): number {
  const text = String(value);
  const dot = text.indexOf('.');
  if (dot === -1 || text.includes('e') || text.includes('E')) return 0;
  return Math.min(text.length - dot - 1, 15);
}

function answerFor(id: string, raw: unknown, body: string, url: string): EvaluationAnswer {
  const fail = (reason: string): never => {
    throw new APICallError({
      message: `TypeSafe returned an unusable answer for question "${id}": ${reason}`,
      url,
      requestBodyValues: {},
      responseBody: body,
    });
  };

  if (!isRecord(raw)) return fail('the answer is not a JSON object.');

  switch (raw.type) {
    case 'noul': {
      if (typeof raw.noul !== 'number') return fail('"noul" is missing or not a number.');
      return { type: 'boolean', probability: raw.noul };
    }
    case 'choice': {
      if (typeof raw.choice !== 'string') return fail('"choice" is missing or not a string.');
      return {
        type: 'choice',
        choice: raw.choice,
        ...(isProbabilityMap(raw.probabilities) ? { probabilities: raw.probabilities } : {}),
      };
    }
    case 'score': {
      if (typeof raw.score !== 'number') return fail('"score" is missing or not a number.');
      return {
        type: 'score',
        score: raw.score,
        ...(isProbabilityMap(raw.probabilities) ? { probabilities: raw.probabilities } : {}),
      };
    }
    default:
      return fail(`unknown answer type ${JSON.stringify(raw.type)}.`);
  }
}

/**
 * `confidence` and `legend` have no home in the SDK answer type, and they are
 * the reason to reach for Jev in the first place. Keep them under
 * providerMetadata so `eval --full` still reports them.
 */
function metadataFor(raw: unknown): Record<string, JSONValue> | undefined {
  if (!isRecord(raw)) return undefined;
  const extra: Record<string, JSONValue> = {};
  if (typeof raw.confidence === 'number') extra.confidence = raw.confidence;
  if (isRecord(raw.legend)) extra.legend = raw.legend as JSONValue;
  return Object.keys(extra).length > 0 ? extra : undefined;
}

/** Pull a usable sentence out of an error body, whatever shape it arrived in. */
function errorMessage(body: string, status: number): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body.trim() || `TypeSafe returned HTTP ${status}.`;
  }
  if (isRecord(parsed)) {
    for (const key of ['detail', 'message', 'error']) {
      const value = parsed[key];
      if (typeof value === 'string' && value.length > 0) return value;
      // 422 bodies nest the offending field under `detail`.
      if (value != null && typeof value === 'object') return JSON.stringify(value);
    }
  }
  return body.trim() || `TypeSafe returned HTTP ${status}.`;
}

class JevEvaluationModel implements EvaluationModelV4 {
  readonly specificationVersion = 'v4' as const;
  readonly provider = 'jev';
  readonly supportedQuestionTypes = ['choice', 'score', 'boolean'] as const;

  readonly #url: string;
  readonly #apiKey: string;

  constructor(
    readonly modelId: string,
    options: { baseURL: string; apiKey: string },
  ) {
    this.#url = `${options.baseURL.replace(/\/+$/, '')}/systemone`;
    this.#apiKey = options.apiKey;
  }

  async doEvaluate(options: EvaluationCallOptions): Promise<EvaluationResult> {
    const body = {
      state: options.state,
      model: this.modelId,
      questions: Object.fromEntries(
        Object.entries(options.questions).map(([id, question]) => [id, toWireQuestion(question)]),
      ),
    };

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.#apiKey}`,
      'content-type': 'application/json',
    };
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      if (value !== undefined) headers[name] = value;
    }

    const response = await fetch(this.#url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      ...(options.abortSignal === undefined ? {} : { signal: options.abortSignal }),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new APICallError({
        message: errorMessage(text, response.status),
        url: this.#url,
        // The state can be large and is echoed nowhere useful on failure.
        requestBodyValues: { model: this.modelId, questions: Object.keys(options.questions) },
        statusCode: response.status,
        responseHeaders: Object.fromEntries(response.headers.entries()),
        responseBody: text,
      });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new APICallError({
        message: `TypeSafe returned a body that is not JSON: ${(error as Error).message}`,
        url: this.#url,
        requestBodyValues: {},
        statusCode: response.status,
        responseBody: text,
      });
    }

    if (!isRecord(payload) || !isRecord(payload.answers)) {
      throw new APICallError({
        message: 'TypeSafe returned a response without an "answers" object.',
        url: this.#url,
        requestBodyValues: {},
        statusCode: response.status,
        responseBody: text,
      });
    }

    const answers: Record<string, EvaluationAnswer> = {};
    const perAnswerMetadata: Record<string, JSONValue> = {};
    let probabilityDecimals = 0;
    let scoreDecimals = 0;

    for (const [id, raw] of Object.entries(payload.answers)) {
      const answer = answerFor(id, raw, text, this.#url);
      answers[id] = answer;

      const extra = metadataFor(raw);
      if (extra !== undefined) perAnswerMetadata[id] = extra;

      if (answer.type === 'score') {
        scoreDecimals = Math.max(scoreDecimals, decimalsOf(answer.score));
      }
      if (answer.type !== 'boolean' && answer.probabilities !== undefined) {
        for (const probability of Object.values(answer.probabilities)) {
          probabilityDecimals = Math.max(probabilityDecimals, decimalsOf(probability));
        }
      }
    }

    const metadata: Record<string, JSONValue> = {};
    if (typeof payload.model === 'string') metadata.model = payload.model;
    if (Object.keys(perAnswerMetadata).length > 0) metadata.answers = perAnswerMetadata;

    const usage = isRecord(payload.usage) ? payload.usage : undefined;

    return {
      answers,
      // Declaring the precision we actually received keeps core's distribution
      // checks from rejecting answers the API legitimately rounded.
      rounding: { probabilityDecimals, scoreDecimals },
      ...(usage === undefined
        ? {}
        : {
            usage: {
              ...(typeof usage.input_tokens === 'number' ? { inputTokens: usage.input_tokens } : {}),
              ...(typeof usage.output_tokens === 'number'
                ? { outputTokens: usage.output_tokens }
                : {}),
            },
          }),
      warnings: [],
      ...(Object.keys(metadata).length > 0 ? { providerMetadata: { jev: metadata } } : {}),
      response: {
        modelId: typeof payload.model === 'string' ? payload.model : this.modelId,
        headers: Object.fromEntries(response.headers.entries()),
        body: payload,
      },
    };
  }
}

/** TypeSafe AI's official API. Talks to `/v1/systemone` directly. */
export function createJevEvaluationModel(resolved: ResolvedProvider): EvaluationModelV4 {
  return new JevEvaluationModel(resolved.model, {
    baseURL: resolved.baseURL ?? JEV_BASE_URL,
    apiKey: resolved.apiKey,
  });
}
