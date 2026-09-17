/**
 * Exit codes are part of the CLI contract: scripts and agents branch on them.
 *
 *   0  success
 *   1  provider/runtime failure (network, API error)
 *   2  usage or input validation failure
 *   3  missing configuration or credentials
 */
export const ExitCode = {
  Success: 0,
  Runtime: 1,
  Usage: 2,
  Config: 3,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export class JevCliError extends Error {
  readonly code: string;
  readonly exitCode: ExitCodeValue;
  readonly details: unknown;

  constructor(
    code: string,
    message: string,
    options: { exitCode?: ExitCodeValue; details?: unknown; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'JevCliError';
    this.code = code;
    this.exitCode = options.exitCode ?? ExitCode.Runtime;
    this.details = options.details;
  }
}

export function usageError(message: string, details?: unknown): JevCliError {
  return new JevCliError('usage_error', message, { exitCode: ExitCode.Usage, details });
}

export function validationError(message: string, details?: unknown): JevCliError {
  return new JevCliError('validation_error', message, { exitCode: ExitCode.Usage, details });
}

export function configError(message: string, details?: unknown): JevCliError {
  return new JevCliError('config_error', message, { exitCode: ExitCode.Config, details });
}
