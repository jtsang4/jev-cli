import { JevCliError } from './errors.ts';

export function printJson(value: unknown, options: { compact?: boolean } = {}): void {
  process.stdout.write(`${JSON.stringify(value, null, options.compact ? undefined : 2)}\n`);
}

/**
 * Errors leave on stderr as JSON so a caller can parse failures the same way it
 * parses answers, while stdout stays reserved for results alone.
 */
export function printError(error: unknown, options: { compact?: boolean } = {}): void {
  const envelope =
    error instanceof JevCliError
      ? { code: error.code, message: error.message, ...(error.details == null ? {} : { details: error.details }) }
      : { code: 'internal_error', message: error instanceof Error ? error.message : String(error) };
  process.stderr.write(`${JSON.stringify({ error: envelope }, null, options.compact ? undefined : 2)}\n`);
}
