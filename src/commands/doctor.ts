import { parseArgs } from 'node:util';
import { experimental_evaluate as evaluate } from 'ai';

import { maskSecret } from '../config/schema.ts';
import { loadConfigFile, readConfig } from '../config/store.ts';
import { ExitCode, JevCliError } from '../errors.ts';
import { createEvaluationModel, resolveProvider } from '../providers/index.ts';

export const DOCTOR_HELP = `Check the configuration and, by default, the credentials.

Usage:
  jev-cli doctor [--offline] [--show-secrets]

Options:
      --offline        Validate configuration only; make no network request
      --show-secrets   Print the API key in full instead of masking it
  -h, --help           Show this help

The live check sends one tiny boolean evaluation to confirm the key and model work.
`;

export async function runDoctor(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      offline: { type: 'boolean', default: false },
      'show-secrets': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    process.stdout.write(DOCTOR_HELP);
    return ExitCode.Success;
  }

  const out = process.stdout;
  const file = await loadConfigFile();
  out.write(`config file   ${file.path}${file.exists ? '' : '  (missing)'}\n`);

  const config = await readConfig();
  let resolved;
  try {
    resolved = resolveProvider(config, {});
  } catch (error) {
    out.write(`provider      unresolved\n\n`);
    throw error;
  }

  out.write(`provider      ${resolved.provider}\n`);
  out.write(`model         ${resolved.model}\n`);
  if (resolved.baseURL !== undefined) out.write(`baseURL       ${resolved.baseURL}\n`);
  out.write(`api key       ${values['show-secrets'] ? resolved.apiKey : maskSecret(resolved.apiKey)}\n`);
  out.write(`key source    ${resolved.apiKeySource}\n`);

  if (values.offline) {
    out.write(`\nConfiguration looks valid. Re-run without --offline to verify the credentials.\n`);
    return ExitCode.Success;
  }

  out.write(`\nRunning a live check...\n`);
  const model = createEvaluationModel(resolved);
  const started = Date.now();
  try {
    const result = await evaluate({
      model,
      state: 'The deployment finished with exit code 0.',
      questions: {
        succeeded: { type: 'boolean', instructions: 'Did the deployment succeed?' },
      },
      abortSignal: AbortSignal.timeout(30_000),
    });
    out.write(
      `live check    ok (${Date.now() - started}ms, P(true)=${result.answers.succeeded.probability})\n`,
    );
    return ExitCode.Success;
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    const message = error instanceof Error ? error.message : String(error);
    out.write(`live check    failed\n`);
    if (status === 401 || status === 403) {
      throw new JevCliError(
        'authentication_failed',
        `The provider rejected the API key (HTTP ${status}). Update it with: jev-cli config set providers.${resolved.provider}.apiKey <key>`,
        { exitCode: ExitCode.Config, cause: error },
      );
    }
    throw new JevCliError('provider_error', message, {
      exitCode: ExitCode.Runtime,
      ...(status === undefined ? {} : { details: { statusCode: status } }),
      cause: error,
    });
  }
}
