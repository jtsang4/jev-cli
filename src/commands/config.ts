import { parseArgs } from 'node:util';

import { configPath } from '../config/paths.ts';
import { CONFIG_TEMPLATE, isSecretKey, maskSecret } from '../config/schema.ts';
import {
  flattenConfig,
  getConfigValue,
  loadConfigFile,
  saveConfigFile,
  setConfigValue,
  unsetConfigValue,
} from '../config/store.ts';
import { ExitCode, usageError } from '../errors.ts';

export const CONFIG_HELP = `Manage the jev-cli configuration file.

Usage:
  jev-cli config init [--force]        Create the config file from a commented template
  jev-cli config path                  Print the config file path
  jev-cli config list [--show-secrets] List every configured value
  jev-cli config get <key>             Print one value
  jev-cli config set <key> <value>     Set one value (creates the file if needed)
  jev-cli config unset <key>           Remove one value

Keys are dotted paths and values are stored as strings:
  provider                             vercel (AI Gateway) or jev (TypeSafe AI)
  providers.<provider>.apiKey
  providers.<provider>.model
  providers.<provider>.baseURL

API keys are masked by default and the file is written with 0600 permissions.
`;

export async function runConfig(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      force: { type: 'boolean', default: false },
      'show-secrets': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  const [subcommand, ...rest] = positionals;
  if (values.help || subcommand === undefined) {
    process.stdout.write(CONFIG_HELP);
    return values.help ? ExitCode.Success : ExitCode.Usage;
  }

  switch (subcommand) {
    case 'path':
      process.stdout.write(`${configPath()}\n`);
      return ExitCode.Success;

    case 'init':
      return await initConfig(values.force);

    case 'list':
      return await listConfig(values['show-secrets']);

    case 'get':
      return await getConfig(rest);

    case 'set':
      return await setConfig(rest);

    case 'unset':
      return await unsetConfig(rest);

    default:
      throw usageError(
        `Unknown config subcommand "${subcommand}". Expected one of: init, path, list, get, set, unset.`,
      );
  }
}

async function initConfig(force: boolean): Promise<number> {
  const file = await loadConfigFile();
  if (file.exists && !force) {
    process.stderr.write(`Config already exists at ${file.path}. Pass --force to overwrite it.\n`);
    return ExitCode.Usage;
  }
  // Start from the pristine template rather than the loaded document so --force
  // genuinely resets the file.
  const { parseDocument } = await import('yaml');
  await saveConfigFile({ ...file, document: parseDocument(CONFIG_TEMPLATE) });
  process.stderr.write(`Wrote ${file.path}\nNext: jev-cli config set providers.vercel.apiKey <key>\n`);
  return ExitCode.Success;
}

async function listConfig(showSecrets: boolean): Promise<number> {
  const file = await loadConfigFile();
  if (!file.exists) {
    process.stderr.write(`No config file at ${file.path}. Create one with: jev-cli config init\n`);
    return ExitCode.Config;
  }
  const entries = flattenConfig(file.document.toJS());
  if (entries.length === 0) {
    process.stderr.write(`${file.path} is empty.\n`);
    return ExitCode.Success;
  }
  for (const [key, value] of entries) {
    const display =
      !showSecrets && isSecretKey(key) && typeof value === 'string' && value.length > 0
        ? maskSecret(value)
        : String(value ?? '');
    process.stdout.write(`${key}=${display}\n`);
  }
  return ExitCode.Success;
}

async function getConfig(rest: string[]): Promise<number> {
  const key = rest[0];
  if (key === undefined) throw usageError('config get requires a key, e.g. providers.vercel.model');

  const file = await loadConfigFile();
  const value = getConfigValue(file, key);
  if (value === undefined) return ExitCode.Config;

  process.stdout.write(`${typeof value === 'object' ? JSON.stringify(value) : String(value)}\n`);
  return ExitCode.Success;
}

async function setConfig(rest: string[]): Promise<number> {
  const [key, value] = rest;
  if (key === undefined || value === undefined) {
    throw usageError('config set requires a key and a value, e.g. providers.vercel.apiKey vck_123');
  }
  const file = await loadConfigFile();
  setConfigValue(file, key, value);
  await saveConfigFile(file);

  const display = isSecretKey(key) ? maskSecret(value) : value;
  process.stderr.write(`${key}=${display}\nSaved to ${file.path}\n`);
  return ExitCode.Success;
}

async function unsetConfig(rest: string[]): Promise<number> {
  const key = rest[0];
  if (key === undefined) throw usageError('config unset requires a key, e.g. providers.vercel.baseURL');

  const file = await loadConfigFile();
  if (!file.exists) {
    process.stderr.write(`No config file at ${file.path}.\n`);
    return ExitCode.Config;
  }
  if (!unsetConfigValue(file, key)) {
    process.stderr.write(`${key} is not set.\n`);
    return ExitCode.Config;
  }
  await saveConfigFile(file);
  process.stderr.write(`Removed ${key} from ${file.path}\n`);
  return ExitCode.Success;
}
