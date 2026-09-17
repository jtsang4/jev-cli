import type {
  Experimental_EvaluationModelV4Input as EvaluationInput,
  Experimental_EvaluationModelV4Question as EvaluationQuestion,
} from '@ai-sdk/provider';

import { validationError } from './errors.ts';

export type { EvaluationInput, EvaluationQuestion };

export const QUESTION_TYPES = ['choice', 'score', 'boolean'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

/** An input is a string, a JSON object, or a JSON array — a bare number or boolean is not. */
function checkInput(value: unknown, where: string): void {
  if (typeof value === 'string' || isPlainObject(value) || Array.isArray(value)) return;
  throw validationError(
    `${where} must be a string, JSON object, or JSON array, but got ${describe(value)}.`,
  );
}

function checkOptionalInput(value: unknown, where: string): void {
  if (value === null) return;
  checkInput(value, where);
}

function validateQuestion(id: string, raw: unknown): EvaluationQuestion {
  const where = `questions.${id}`;
  if (!isPlainObject(raw)) {
    throw validationError(`${where} must be a JSON object, but got ${describe(raw)}.`);
  }

  const { type, instructions, criteria } = raw;
  const questionType = QUESTION_TYPES.find((candidate): candidate is QuestionType => candidate === type);
  if (questionType === undefined) {
    throw validationError(
      `${where}.type must be one of ${QUESTION_TYPES.join(', ')}, but got ${
        typeof type === 'string' ? `"${type}"` : describe(type)
      }.`,
    );
  }
  checkInput(instructions, `${where}.instructions`);

  if (questionType === 'choice') {
    if (!isPlainObject(criteria)) {
      throw validationError(
        `${where}.criteria is required for choice questions and must be a JSON object mapping option names to descriptions (use null for no description).`,
      );
    }
    const options = Object.entries(criteria);
    if (options.length === 0) {
      throw validationError(`${where}.criteria must define at least one option.`);
    }
    for (const [option, description] of options) {
      checkOptionalInput(description, `${where}.criteria["${option}"]`);
    }
  } else if (questionType === 'score') {
    if (!Array.isArray(criteria)) {
      throw validationError(
        `${where}.criteria is required for score questions and must be an array of ordered levels, lowest first.`,
      );
    }
    if (criteria.length < 2) {
      throw validationError(
        `${where}.criteria must list at least two ordered levels, but got ${criteria.length}.`,
      );
    }
    criteria.forEach((level, index) => checkOptionalInput(level, `${where}.criteria[${index}]`));
  } else if (criteria !== undefined) {
    // boolean — criteria is optional and only describes the true/false sides.
    if (!isPlainObject(criteria)) {
      throw validationError(
        `${where}.criteria must be a JSON object with optional "true" and "false" keys.`,
      );
    }
    const unknownKeys = Object.keys(criteria).filter((key) => key !== 'true' && key !== 'false');
    if (unknownKeys.length > 0) {
      throw validationError(
        `${where}.criteria only accepts "true" and "false" keys, but also got ${unknownKeys
          .map((key) => `"${key}"`)
          .join(', ')}.`,
      );
    }
    if ('true' in criteria) checkOptionalInput(criteria.true, `${where}.criteria.true`);
    if ('false' in criteria) checkOptionalInput(criteria.false, `${where}.criteria.false`);
  }

  // Every field above has been checked against the provider spec; this cast is
  // the single boundary between untyped JSON and the SDK's question type.
  return raw as unknown as EvaluationQuestion;
}

export function validateQuestions(raw: unknown): Record<string, EvaluationQuestion> {
  if (!isPlainObject(raw)) {
    throw validationError(
      `questions must be a JSON object keyed by question id, but got ${describe(raw)}. ` +
        `Example: {"refunded":{"type":"boolean","instructions":"Was a refund issued?"}}`,
    );
  }
  const ids = Object.keys(raw);
  if (ids.length === 0) {
    throw validationError('questions must contain at least one question.');
  }

  const questions: Record<string, EvaluationQuestion> = {};
  for (const id of ids) {
    questions[id] = validateQuestion(id, raw[id]);
  }
  return questions;
}

export function parseQuestions(text: string, source: string): Record<string, EvaluationQuestion> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw validationError(`No questions provided (${source} was empty).`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw validationError(`${source} is not valid JSON: ${(error as Error).message}`);
  }
  return validateQuestions(parsed);
}
