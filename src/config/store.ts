import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Document, parseDocument } from 'yaml';
import { configError } from '../errors.ts';
import { CONFIG_TEMPLATE, type JevCliConfig, type ProviderConfig } from './schema.ts';
import { configPath } from './paths.ts';

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export interface ConfigFile {
  path: string;
  /** False when nothing is on disk yet; the document then holds the default template. */
  exists: boolean;
  document: Document;
}

/**
 * Parse the config file into a yaml Document. The Document (rather than a plain
 * object) is what lets `config set` rewrite one value while leaving the
 * template's explanatory comments intact.
 */
export async function loadConfigFile(env: NodeJS.ProcessEnv = process.env): Promise<ConfigFile> {
  const path = configPath(env);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { path, exists: false, document: parseDocument(CONFIG_TEMPLATE) };
    }
    throw configError(`Cannot read ${path}: ${(error as Error).message}`);
  }

  const document = parseDocument(raw);
  if (document.errors.length > 0) {
    throw configError(`${path} is not valid YAML: ${document.errors[0]?.message ?? 'parse error'}`);
  }
  // An empty file parses to null contents; setIn builds the mapping from scratch.
  return { path, exists: true, document };
}

export async function saveConfigFile(file: ConfigFile): Promise<void> {
  await mkdir(dirname(file.path), { recursive: true, mode: DIR_MODE });
  // The file holds an API key, so keep it owner-only. writeFile's mode applies
  // only on creation; chmod covers files that already existed.
  await writeFile(file.path, file.document.toString(), { mode: FILE_MODE });
  await chmod(file.path, FILE_MODE);
}

/** Read the config as a plain object, validating the shape we depend on. */
export async function readConfig(env: NodeJS.ProcessEnv = process.env): Promise<JevCliConfig> {
  const file = await loadConfigFile(env);
  if (!file.exists) return {};

  const value = file.document.toJS() as unknown;
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw configError(`${file.path} must contain a YAML mapping at the top level.`);
  }

  const config = value as Record<string, unknown>;
  if (config.provider != null && typeof config.provider !== 'string') {
    throw configError(`${file.path}: "provider" must be a string.`);
  }
  if (
    config.providers != null &&
    (typeof config.providers !== 'object' || Array.isArray(config.providers))
  ) {
    throw configError(`${file.path}: "providers" must be a mapping of provider name to settings.`);
  }

  return {
    provider: config.provider as string | undefined,
    providers: config.providers as Record<string, ProviderConfig> | undefined,
  };
}

function splitKey(dottedKey: string): string[] {
  const parts = dottedKey.split('.').filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw configError(`"${dottedKey}" is not a valid config key. Use dotted paths, e.g. providers.vercel.apiKey`);
  }
  return parts;
}

export function getConfigValue(file: ConfigFile, dottedKey: string): unknown {
  return file.document.getIn(splitKey(dottedKey), false);
}

/**
 * Values are always stored as strings. Every key the CLI understands is a
 * string, and string-only storage keeps `config set` free of surprising coercion.
 */
export function setConfigValue(file: ConfigFile, dottedKey: string, value: string): void {
  file.document.setIn(splitKey(dottedKey), value);
}

export function unsetConfigValue(file: ConfigFile, dottedKey: string): boolean {
  const path = splitKey(dottedKey);
  if (file.document.getIn(path, false) === undefined) return false;
  file.document.deleteIn(path);
  return true;
}

/** Flatten to `dotted.key -> scalar` pairs for `config list`. */
export function flattenConfig(value: unknown, prefix = ''): Array<[string, unknown]> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [[prefix, value]] : [];
  }
  const entries: Array<[string, unknown]> = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    entries.push(...flattenConfig(child, prefix ? `${prefix}.${key}` : key));
  }
  return entries;
}
