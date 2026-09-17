import { describe, expect, test } from 'bun:test';

import { JevCliError } from '../src/errors.ts';
import { toProviderError } from '../src/provider-errors.ts';

function withStatus(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

describe('toProviderError', () => {
  test('passes JevCliError through untouched', () => {
    const original = new JevCliError('usage_error', 'nope', { exitCode: 2 });
    expect(toProviderError(original, { provider: 'vercel' })).toBe(original);
  });

  test('reports a timeout with the configured limit', () => {
    const error = toProviderError(Object.assign(new Error('aborted'), { name: 'TimeoutError' }), {
      provider: 'vercel',
      timeoutMs: 5000,
    });
    expect(error.code).toBe('timeout');
    expect(error.exitCode).toBe(1);
    expect(error.message).toContain('--timeout 5000ms');
  });

  test('401 keeps the provider message and points at the key', () => {
    const error = toProviderError(withStatus('Invalid token', 401), { provider: 'vercel' });
    expect(error.code).toBe('authentication_failed');
    expect(error.exitCode).toBe(3);
    expect(error.message).toContain('Invalid token');
    expect(error.message).toContain('config list --show-secrets');
  });

  // A 403 previously claimed the key was bad. The real gateway 403 is
  // "requires a valid credit card on file", so the provider's own message has
  // to survive or the user goes off regenerating a perfectly good key.
  test('403 surfaces the provider message and does not blame the key', () => {
    const error = toProviderError(
      withStatus('AI Gateway requires a valid credit card on file to service requests.', 403),
      { provider: 'vercel' },
    );
    expect(error.code).toBe('authorization_failed');
    expect(error.exitCode).toBe(3);
    expect(error.message).toContain('requires a valid credit card');
    expect(error.message).not.toContain('config set providers.vercel.apiKey');
  });

  test('other failures keep the status code in details', () => {
    const error = toProviderError(withStatus('upstream exploded', 500), { provider: 'vercel' });
    expect(error.code).toBe('provider_error');
    expect(error.exitCode).toBe(1);
    expect(error.details).toEqual({ statusCode: 500 });
  });

  test('non-Error values still produce a message', () => {
    expect(toProviderError('something broke', { provider: 'vercel' }).message).toBe('something broke');
  });
});
