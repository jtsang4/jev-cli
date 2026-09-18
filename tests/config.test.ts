import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { configPath } from '../src/config/paths.ts';
import { maskSecret } from '../src/config/schema.ts';
import {
  flattenConfig,
  getConfigValue,
  loadConfigFile,
  readConfig,
  saveConfigFile,
  setConfigValue,
  unsetConfigValue,
} from '../src/config/store.ts';
import { resolveProvider } from '../src/providers/index.ts';

let home: string;
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'jev-cli-test-'));
  env = { JEV_CLI_HOME: home };
  process.env.JEV_CLI_HOME = home;
});

afterEach(async () => {
  delete process.env.JEV_CLI_HOME;
  await rm(home, { recursive: true, force: true });
});

describe('config store', () => {
  test('honours JEV_CLI_HOME', () => {
    expect(configPath(env)).toBe(join(home, 'config.yaml'));
  });

  test('reports a missing file without throwing', async () => {
    const file = await loadConfigFile(env);
    expect(file.exists).toBe(false);
    expect(await readConfig(env)).toEqual({});
  });

  test('set creates the file with 0600 permissions', async () => {
    const file = await loadConfigFile(env);
    setConfigValue(file, 'providers.vercel.apiKey', 'vck_secret_value');
    await saveConfigFile(file);

    expect((await stat(file.path)).mode & 0o777).toBe(0o600);
    expect((await stat(home)).mode & 0o777).toBe(0o700);

    const config = await readConfig(env);
    expect(config.providers?.vercel?.apiKey).toBe('vck_secret_value');
  });

  test('set preserves comments already in the file', async () => {
    await writeFile(configPath(env), '# keep this note\nprovider: vercel\n');
    const file = await loadConfigFile(env);
    setConfigValue(file, 'providers.vercel.model', 'typesafe-ai/jev');
    await saveConfigFile(file);

    const text = await Bun.file(configPath(env)).text();
    expect(text).toContain('# keep this note');
    expect(text).toContain('model: typesafe-ai/jev');
  });

  test('get and unset round-trip a dotted key', async () => {
    const file = await loadConfigFile(env);
    setConfigValue(file, 'providers.vercel.baseURL', 'https://example.test');
    expect(getConfigValue(file, 'providers.vercel.baseURL')).toBe('https://example.test');

    expect(unsetConfigValue(file, 'providers.vercel.baseURL')).toBe(true);
    expect(getConfigValue(file, 'providers.vercel.baseURL')).toBeUndefined();
    expect(unsetConfigValue(file, 'providers.vercel.baseURL')).toBe(false);
  });

  test('rejects a file that is not a mapping', async () => {
    await writeFile(configPath(env), '- just\n- a list\n');
    expect(readConfig(env)).rejects.toThrow(/must contain a YAML mapping/);
  });

  test('rejects invalid YAML', async () => {
    await writeFile(configPath(env), 'provider: [unclosed\n');
    expect(readConfig(env)).rejects.toThrow(/not valid YAML/);
  });

  test('flattens nested values to dotted keys', () => {
    expect(flattenConfig({ provider: 'vercel', providers: { vercel: { model: 'm' } } })).toEqual([
      ['provider', 'vercel'],
      ['providers.vercel.model', 'm'],
    ]);
  });
});

describe('maskSecret', () => {
  test('keeps the first and last four characters', () => {
    expect(maskSecret('vck_abcdefghijklmnop')).toBe('vck_************mnop');
  });

  test('fully masks short values', () => {
    expect(maskSecret('short')).toBe('*****');
  });
});

describe('resolveProvider', () => {
  test('defaults to vercel and the default model', () => {
    const resolved = resolveProvider({ providers: { vercel: { apiKey: 'k' } } }, {}, {});
    expect(resolved.provider).toBe('vercel');
    expect(resolved.model).toBe('typesafe-ai/jev');
    expect(resolved.apiKeySource).toContain('config file');
  });

  test('environment beats the config file', () => {
    const resolved = resolveProvider(
      { providers: { vercel: { apiKey: 'from-file' } } },
      {},
      { JEV_CLI_API_KEY: 'from-env' },
    );
    expect(resolved.apiKey).toBe('from-env');
    expect(resolved.apiKeySource).toContain('JEV_CLI_API_KEY');
  });

  test('AI_GATEWAY_API_KEY works as a fallback', () => {
    const resolved = resolveProvider({}, {}, { AI_GATEWAY_API_KEY: 'gateway-key' });
    expect(resolved.apiKey).toBe('gateway-key');
  });

  test('flags beat everything', () => {
    const resolved = resolveProvider(
      { providers: { vercel: { apiKey: 'k', model: 'from-file' } } },
      { model: 'from-flag' },
      {},
    );
    expect(resolved.model).toBe('from-flag');
  });

  test('missing key is a config error with actionable guidance', () => {
    try {
      resolveProvider({}, {}, {});
      throw new Error('expected resolveProvider to throw');
    } catch (error) {
      expect((error as { exitCode?: number }).exitCode).toBe(3);
      expect((error as Error).message).toContain('jev-cli config set providers.vercel.apiKey');
    }
  });

  test('the jev provider resolves with its own default model', () => {
    const resolved = resolveProvider({ provider: 'jev' }, {}, { TYPESAFE_API_KEY: 'ts_key' });
    expect(resolved.provider).toBe('jev');
    expect(resolved.model).toBe('jev-latest');
    expect(resolved.apiKeySource).toContain('TYPESAFE_API_KEY');
  });

  test('JEV_CLI_API_KEY still beats the provider-specific variable', () => {
    const resolved = resolveProvider(
      { provider: 'jev' },
      {},
      { JEV_CLI_API_KEY: 'shared', TYPESAFE_API_KEY: 'specific' },
    );
    expect(resolved.apiKey).toBe('shared');
  });

  test('a missing jev key names the jev config path', () => {
    try {
      resolveProvider({ provider: 'jev' }, {}, {});
      throw new Error('expected resolveProvider to throw');
    } catch (error) {
      expect((error as { exitCode?: number }).exitCode).toBe(3);
      expect((error as Error).message).toContain('jev-cli config set providers.jev.apiKey');
    }
  });

  test('both providers can be configured at once and switched between', () => {
    const config = {
      provider: 'vercel',
      providers: {
        vercel: { apiKey: 'vck_key' },
        jev: { apiKey: 'apik_key' },
      },
    };

    const viaFile = resolveProvider(config, {}, {});
    expect(viaFile.provider).toBe('vercel');
    expect(viaFile.apiKey).toBe('vck_key');

    // Switching reads the other block; neither key has to be re-entered.
    const viaFlag = resolveProvider(config, { provider: 'jev' }, {});
    expect(viaFlag.provider).toBe('jev');
    expect(viaFlag.apiKey).toBe('apik_key');
    expect(viaFlag.model).toBe('jev-latest');

    const switched = resolveProvider({ ...config, provider: 'jev' }, {}, {});
    expect(switched.apiKey).toBe('apik_key');
  });

  test('provider-specific env vars keep both providers usable from the environment', () => {
    const env = { TYPESAFE_API_KEY: 'apik_env', AI_GATEWAY_API_KEY: 'vck_env' };
    expect(resolveProvider({ provider: 'jev' }, {}, env).apiKey).toBe('apik_env');
    expect(resolveProvider({ provider: 'vercel' }, {}, env).apiKey).toBe('vck_env');
  });

  test('unknown providers are rejected', () => {
    expect(() => resolveProvider({ provider: 'openai' }, {}, { JEV_CLI_API_KEY: 'k' })).toThrow(
      /Unknown provider "openai"/,
    );
  });
});
