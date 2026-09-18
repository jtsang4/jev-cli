import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(import.meta.dir, '..', 'src', 'cli.ts');

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'jev-cli-e2e-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

async function run(args: string[], stdin?: string) {
  const proc = Bun.spawn(['bun', 'run', CLI, ...args], {
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      JEV_CLI_HOME: home,
    },
    stdin: stdin === undefined ? 'ignore' : new TextEncoder().encode(stdin),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe('help and version', () => {
  test('--help lists the commands', async () => {
    const { stdout, exitCode } = await run(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('jev-cli <command>');
    expect(stdout).toContain('eval');
    expect(stdout).toContain('config');
    expect(stdout).toContain('doctor');
  });

  test('--version prints the package version', async () => {
    const { stdout, exitCode } = await run(['--version']);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('unknown commands exit 2', async () => {
    const { stderr, exitCode } = await run(['nope']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Unknown command "nope"');
  });
});

describe('config command', () => {
  test('path points inside JEV_CLI_HOME', async () => {
    const { stdout, exitCode } = await run(['config', 'path']);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(join(home, 'config.yaml'));
  });

  test('init then set then list masks the key', async () => {
    expect((await run(['config', 'init'])).exitCode).toBe(0);
    expect((await run(['config', 'set', 'providers.vercel.apiKey', 'vck_abcdefghijklmnop'])).exitCode).toBe(0);

    const listed = await run(['config', 'list']);
    expect(listed.exitCode).toBe(0);
    expect(listed.stdout).toContain('providers.vercel.apiKey=vck_************mnop');
    expect(listed.stdout).not.toContain('abcdefghijkl');

    const revealed = await run(['config', 'list', '--show-secrets']);
    expect(revealed.stdout).toContain('providers.vercel.apiKey=vck_abcdefghijklmnop');
  });

  test('init refuses to clobber an existing file without --force', async () => {
    await run(['config', 'init']);
    const second = await run(['config', 'init']);
    expect(second.exitCode).toBe(2);
    expect(second.stderr).toContain('--force');
  });

  test('get returns the stored value', async () => {
    await run(['config', 'set', 'providers.vercel.model', 'typesafe-ai/jev-latest']);
    const { stdout, exitCode } = await run(['config', 'get', 'providers.vercel.model']);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe('typesafe-ai/jev-latest');
  });

  test('unknown subcommands exit 2', async () => {
    const { stderr, exitCode } = await run(['config', 'frobnicate']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Unknown config subcommand');
  });
});

describe('eval input validation', () => {
  test('missing state exits 2 with a JSON error', async () => {
    const { stderr, exitCode } = await run(['eval', '-q', '{"a":{"type":"boolean","instructions":"x"}}']);
    expect(exitCode).toBe(2);
    const parsed = JSON.parse(stderr);
    expect(parsed.error.code).toBe('usage_error');
    expect(parsed.error.message).toContain('Missing state');
  });

  test('invalid questions exit 2 before any network call', async () => {
    const { stderr, exitCode } = await run([
      'eval',
      '-s',
      'some state',
      '-q',
      '{"q":{"type":"score","instructions":"x","criteria":["only one"]}}',
    ]);
    expect(exitCode).toBe(2);
    const parsed = JSON.parse(stderr);
    expect(parsed.error.code).toBe('validation_error');
    expect(parsed.error.message).toContain('at least two ordered levels');
  });

  test('a missing API key exits 3 with guidance', async () => {
    const { stderr, exitCode } = await run([
      'eval',
      '-s',
      'some state',
      '-q',
      '{"q":{"type":"boolean","instructions":"x"}}',
    ]);
    expect(exitCode).toBe(3);
    const parsed = JSON.parse(stderr);
    expect(parsed.error.code).toBe('config_error');
    expect(parsed.error.message).toContain('config set providers.jev.apiKey');
  });

  test('--provider vercel without a key exits 3 naming the vercel key', async () => {
    const { stderr, exitCode } = await run([
      'eval',
      '--provider',
      'vercel',
      '-s',
      'some state',
      '-q',
      '{"q":{"type":"boolean","instructions":"x"}}',
    ]);
    expect(exitCode).toBe(3);
    expect(JSON.parse(stderr).error.message).toContain('config set providers.vercel.apiKey');
  });

  test('questions can be read from stdin with "-"', async () => {
    const { stderr, exitCode } = await run(
      ['eval', '-s', 'some state', '-q', '-'],
      '{"q":{"type":"boolean","instructions":"x"}}',
    );
    // Validation passes, so it fails later on the missing key rather than on parsing.
    expect(exitCode).toBe(3);
    expect(JSON.parse(stderr).error.code).toBe('config_error');
  });

  test('only one input may read stdin', async () => {
    const { stderr, exitCode } = await run(['eval', '-s', '-', '-q', '-'], 'whatever');
    expect(exitCode).toBe(2);
    expect(JSON.parse(stderr).error.message).toContain('Only one input can read from stdin');
  });

  test('--timeout must be a positive number', async () => {
    const { stderr, exitCode } = await run([
      'eval',
      '-s',
      'x',
      '-q',
      '{"q":{"type":"boolean","instructions":"x"}}',
      '--timeout',
      'soon',
    ]);
    expect(exitCode).toBe(2);
    expect(JSON.parse(stderr).error.message).toContain('--timeout must be a positive number');
  });
});

describe('doctor', () => {
  test('--offline reports the missing key as exit 3', async () => {
    const { exitCode, stderr } = await run(['doctor', '--offline']);
    expect(exitCode).toBe(3);
    expect(stderr).toContain('config set providers.jev.apiKey');
  });

  test('--offline validates configuration without a network call', async () => {
    await run(['config', 'set', 'providers.jev.apiKey', 'apik_abcdefghijklmnop']);
    const { stdout, exitCode } = await run(['doctor', '--offline']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('provider      jev');
    expect(stdout).toContain('model         jev-latest');
    expect(stdout).toContain('apik************mnop');
  });

  test('--offline reports the vercel provider and its default model', async () => {
    await run(['config', 'set', 'provider', 'vercel']);
    await run(['config', 'set', 'providers.vercel.apiKey', 'vck_abcdefghijklmnop']);
    const { stdout, exitCode } = await run(['doctor', '--offline']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('provider      vercel');
    expect(stdout).toContain('model         typesafe-ai/jev');
    expect(stdout).toContain('vck_************mnop');
  });

  test('--provider overrides the configured provider', async () => {
    await run(['config', 'set', 'provider', 'jev']);
    await run(['config', 'set', 'providers.vercel.apiKey', 'vck_abcdefghijklmnop']);
    const { stdout, exitCode } = await run([
      'doctor',
      '--offline',
      '--provider',
      'vercel',
      '--model',
      'typesafe-ai/jev-preview',
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('provider      vercel');
    expect(stdout).toContain('model         typesafe-ai/jev-preview');
  });
});
