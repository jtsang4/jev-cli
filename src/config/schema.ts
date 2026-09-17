/** Providers the CLI knows about. Only `vercel` can run today. */
export const KNOWN_PROVIDERS = ['vercel', 'jev'] as const;
export type ProviderName = (typeof KNOWN_PROVIDERS)[number];

/** Providers with a working implementation. `jev` is reserved for TypeSafe's official API. */
export const IMPLEMENTED_PROVIDERS: readonly ProviderName[] = ['vercel'];

export const DEFAULT_PROVIDER: ProviderName = 'vercel';
export const DEFAULT_MODEL = 'typesafe-ai/jev';

export interface ProviderConfig {
  apiKey?: string;
  model?: string;
  baseURL?: string;
}

export interface JevCliConfig {
  provider?: string;
  providers?: Record<string, ProviderConfig>;
}

/**
 * Environment variables consulted per provider, in order, when the config file
 * has no key. `JEV_CLI_API_KEY` always wins so one variable can drive any provider.
 */
export const API_KEY_ENV_VARS: Record<string, readonly string[]> = {
  vercel: ['JEV_CLI_API_KEY', 'AI_GATEWAY_API_KEY'],
  jev: ['JEV_CLI_API_KEY', 'TYPESAFE_AI_API_KEY'],
};

/** A config key is secret when its final segment is `apiKey`. Drives masking in `config list`. */
export function isSecretKey(dottedKey: string): boolean {
  return dottedKey.split('.').at(-1) === 'apiKey';
}

/** `vck_1234…wxyz` — enough to recognise a key without disclosing it. */
export function maskSecret(value: string): string {
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}${'*'.repeat(Math.min(value.length - 8, 12))}${value.slice(-4)}`;
}

export const CONFIG_TEMPLATE = `# jev-cli configuration
# Reference: https://github.com/jtsang4/jev-cli#configuration
#
# Precedence for every value: CLI flag > environment variable > this file.

# Active provider. Only "vercel" is implemented today; "jev" is reserved for
# TypeSafe AI's official API once it becomes available.
provider: vercel

providers:
  vercel:
    # Vercel AI Gateway key: https://vercel.com/dashboard/ai-gateway
    # Environment fallback: JEV_CLI_API_KEY, then AI_GATEWAY_API_KEY.
    apiKey: ""

    # Evaluation model routed through the gateway.
    model: ${DEFAULT_MODEL}

    # Uncomment only to target a non-default gateway endpoint.
    # baseURL: https://ai-gateway.vercel.sh/v4/ai
`;
