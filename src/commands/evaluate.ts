import { parseArgs } from 'node:util';
import { experimental_evaluate as evaluate } from 'ai';

import { readConfig } from '../config/store.ts';
import { ExitCode, JevCliError, usageError, validationError } from '../errors.ts';
import { StdinReader, resolveInput } from '../input.ts';
import { printJson } from '../output.ts';
import { parseQuestions } from '../questions.ts';
import { createEvaluationModel, resolveProvider } from '../providers/index.ts';

export const EVALUATE_HELP = `Evaluate typed questions against one shared state.

Usage:
  jev-cli eval --state <text> --questions <json> [options]

Input (use "-" to read from stdin; only one input may do so):
  -s, --state <text>            State to evaluate against
      --state-file <path>       Read the state from a file
      --state-json              Parse the state as JSON instead of plain text
  -q, --questions <json>        Questions object, keyed by question id
      --questions-file <path>   Read the questions JSON from a file

Options:
      --provider <name>         Override the configured provider
      --model <id>              Override the evaluation model id
      --timeout <ms>            Abort the request after this many milliseconds
      --full                    Include usage, warnings, and provider metadata
      --compact                 Emit single-line JSON
  -h, --help                    Show this help

Question types:
  choice    requires "criteria": object of option name -> description (or null)
  score     requires "criteria": array of at least two ordered levels, lowest first
  boolean   optional "criteria": { "true": ..., "false": ... }; answers give P(true)

Example:
  jev-cli eval -s "The agent issued a full refund." -q '{
    "refunded": {"type":"boolean","instructions":"Was a refund issued?"}
  }'
`;

export async function runEvaluate(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      state: { type: 'string', short: 's' },
      'state-file': { type: 'string' },
      'state-json': { type: 'boolean', default: false },
      questions: { type: 'string', short: 'q' },
      'questions-file': { type: 'string' },
      provider: { type: 'string' },
      model: { type: 'string' },
      timeout: { type: 'string' },
      full: { type: 'boolean', default: false },
      compact: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    process.stdout.write(EVALUATE_HELP);
    return ExitCode.Success;
  }

  const stdin = new StdinReader();
  const stateText = await resolveInput({
    inline: values.state,
    file: values['state-file'],
    inlineFlag: '--state',
    fileFlag: '--state-file',
    stdin,
  });
  const questionsText = await resolveInput({
    inline: values.questions,
    file: values['questions-file'],
    inlineFlag: '--questions',
    fileFlag: '--questions-file',
    stdin,
  });

  if (stateText === undefined) {
    throw usageError('Missing state. Pass --state <text> or --state-file <path>.');
  }
  if (questionsText === undefined) {
    throw usageError('Missing questions. Pass --questions <json> or --questions-file <path>.');
  }

  let state: unknown = stateText;
  if (values['state-json']) {
    try {
      state = JSON.parse(stateText.trim());
    } catch (error) {
      throw validationError(`--state-json was set but the state is not valid JSON: ${(error as Error).message}`);
    }
    if (typeof state !== 'string' && (typeof state !== 'object' || state === null)) {
      throw validationError('A JSON state must be a string, object, or array.');
    }
  }

  const questions = parseQuestions(questionsText, '--questions');

  let timeoutMs: number | undefined;
  if (values.timeout !== undefined) {
    timeoutMs = Number(values.timeout);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw usageError(`--timeout must be a positive number of milliseconds, got "${values.timeout}".`);
    }
  }

  const config = await readConfig();
  const resolved = resolveProvider(config, { provider: values.provider, model: values.model });
  const model = createEvaluationModel(resolved);

  let result: Awaited<ReturnType<typeof evaluate>>;
  try {
    result = await evaluate({
      model,
      state: state as Parameters<typeof evaluate>[0]['state'],
      questions,
      ...(timeoutMs === undefined ? {} : { abortSignal: AbortSignal.timeout(timeoutMs) }),
    });
  } catch (error) {
    throw toEvaluationError(error, timeoutMs);
  }

  if (values.full) {
    printJson(
      {
        answers: result.answers,
        provider: resolved.provider,
        model: resolved.model,
        usage: result.usage,
        ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
        ...(result.providerMetadata === undefined ? {} : { providerMetadata: result.providerMetadata }),
      },
      { compact: values.compact },
    );
  } else {
    printJson(result.answers, { compact: values.compact });
  }
  return ExitCode.Success;
}

/** Turn SDK/provider failures into CLI errors with a useful exit code. */
function toEvaluationError(error: unknown, timeoutMs: number | undefined): JevCliError {
  if (error instanceof JevCliError) return error;

  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new JevCliError(
      'timeout',
      timeoutMs === undefined ? 'The evaluation request was aborted.' : `The evaluation request exceeded --timeout ${timeoutMs}ms.`,
      { exitCode: ExitCode.Runtime, cause: error },
    );
  }

  const status = (error as { statusCode?: number }).statusCode;
  if (status === 401 || status === 403) {
    return new JevCliError(
      'authentication_failed',
      `The provider rejected the API key (HTTP ${status}). Check it with: jev-cli config list --show-secrets`,
      { exitCode: ExitCode.Config, cause: error },
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  return new JevCliError('provider_error', message, {
    exitCode: ExitCode.Runtime,
    ...(status === undefined ? {} : { details: { statusCode: status } }),
    cause: error,
  });
}
