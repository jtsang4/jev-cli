import type { Experimental_EvaluationModelV4 as EvaluationModelV4 } from '@ai-sdk/provider';

import { configError, usageError } from '../errors.ts';
import {
  API_KEY_ENV_VARS,
  DEFAULT_MODELS,
  DEFAULT_PROVIDER,
  IMPLEMENTED_PROVIDERS,
  KNOWN_PROVIDERS,
  type JevCliConfig,
  type ProviderName,
} from '../config/schema.ts';
import { configPath } from '../config/paths.ts';
import { createJevEvaluationModel } from './jev.ts';
import { createVercelEvaluationModel } from './vercel.ts';

export interface ResolvedProvider {
  provider: string;
  model: string;
  apiKey: string;
  baseURL?: string;
  /** Where the key came from — surfaced by `doctor`, never the key itself. */
  apiKeySource: string;
}

export interface ProviderOverrides {
  provider?: string | undefined;
  model?: string | undefined;
}

/**
 * Collapse config file, environment, and CLI flags into one provider.
 * Precedence throughout: CLI flag > environment > config file > default.
 */
export function resolveProvider(
  config: JevCliConfig,
  overrides: ProviderOverrides = {},
  env: NodeJS.ProcessEnv = process.env,
): ResolvedProvider {
  const provider = overrides.provider ?? config.provider ?? DEFAULT_PROVIDER;

  if (!(KNOWN_PROVIDERS as readonly string[]).includes(provider)) {
    throw usageError(
      `Unknown provider "${provider}". Known providers: ${KNOWN_PROVIDERS.join(', ')}.`,
    );
  }
  if (!(IMPLEMENTED_PROVIDERS as readonly string[]).includes(provider)) {
    throw usageError(
      `Provider "${provider}" is reserved but not implemented yet. Use ${IMPLEMENTED_PROVIDERS.map(
        (name) => `"${name}"`,
      ).join(' or ')} for now.`,
    );
  }

  const settings = config.providers?.[provider] ?? {};
  const model = overrides.model ?? settings.model ?? DEFAULT_MODELS[provider as ProviderName];

  const envVars = API_KEY_ENV_VARS[provider] ?? [];
  let apiKey = '';
  let apiKeySource = '';
  for (const name of envVars) {
    const value = env[name]?.trim();
    if (value) {
      apiKey = value;
      apiKeySource = `environment (${name})`;
      break;
    }
  }
  if (!apiKey) {
    const fromFile = settings.apiKey?.trim();
    if (fromFile) {
      apiKey = fromFile;
      apiKeySource = `config file (providers.${provider}.apiKey)`;
    }
  }
  if (!apiKey) {
    throw configError(
      `No API key for provider "${provider}". Set one with:\n` +
        `  jev-cli config set providers.${provider}.apiKey <key>\n` +
        `or export ${envVars[0] ?? 'JEV_CLI_API_KEY'}. Config file: ${configPath(env)}`,
    );
  }

  const baseURL = settings.baseURL?.trim();
  return {
    provider,
    model,
    apiKey,
    apiKeySource,
    ...(baseURL ? { baseURL } : {}),
  };
}

export function createEvaluationModel(resolved: ResolvedProvider): EvaluationModelV4 {
  switch (resolved.provider) {
    case 'vercel':
      return createVercelEvaluationModel(resolved);
    case 'jev':
      return createJevEvaluationModel(resolved);
    default:
      throw usageError(`Provider "${resolved.provider}" is not implemented.`);
  }
}
