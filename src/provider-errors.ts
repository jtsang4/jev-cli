import { ExitCode, JevCliError } from './errors.ts';

/**
 * Turn an SDK/provider failure into a CLI error.
 *
 * The provider's own message leads: a 403 can mean a revoked key, a missing
 * payment method, or a model the account cannot reach, and only the provider
 * knows which. Overriding it with a guess sends people to fix the wrong thing.
 */
export function toProviderError(
  error: unknown,
  options: { provider: string; timeoutMs?: number | undefined } = { provider: 'jev' },
): JevCliError {
  if (error instanceof JevCliError) return error;

  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new JevCliError(
      'timeout',
      options.timeoutMs === undefined
        ? 'The evaluation request was aborted.'
        : `The evaluation request exceeded --timeout ${options.timeoutMs}ms.`,
      { exitCode: ExitCode.Runtime, cause: error },
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  const status = (error as { statusCode?: number }).statusCode;

  if (status === 401) {
    return new JevCliError(
      'authentication_failed',
      `${message} (HTTP 401) — verify the key with: jev-cli config list --show-secrets`,
      { exitCode: ExitCode.Config, details: { statusCode: status }, cause: error },
    );
  }
  if (status === 403) {
    return new JevCliError(
      'authorization_failed',
      `${message} (HTTP 403) — the key authenticated, so this is usually an account, billing, or model-access problem rather than a bad key.`,
      { exitCode: ExitCode.Config, details: { statusCode: status }, cause: error },
    );
  }

  return new JevCliError('provider_error', message, {
    exitCode: ExitCode.Runtime,
    ...(status === undefined ? {} : { details: { statusCode: status } }),
    cause: error,
  });
}
