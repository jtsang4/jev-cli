/**
 * Providers the CLI knows about: `jev` talks to TypeSafe AI's own API,
 * `vercel` routes through the AI Gateway. Order drives the help text.
 */
export const KNOWN_PROVIDERS = ['jev', 'vercel'] as const;
export type ProviderName = (typeof KNOWN_PROVIDERS)[number];

/** Providers with a working implementation. */
export const IMPLEMENTED_PROVIDERS: readonly ProviderName[] = ['jev', 'vercel'];

/** TypeSafe's own API is the direct path to the model, so it is the default. */
export const DEFAULT_PROVIDER: ProviderName = 'jev';

/** Each provider names the same model differently: the gateway namespaces it. */
export const DEFAULT_MODELS: Record<ProviderName, string> = {
  jev: 'jev-latest',
  vercel: 'typesafe-ai/jev',
};

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
  jev: ['JEV_CLI_API_KEY', 'TYPESAFE_API_KEY', 'TYPESAFE_AI_API_KEY'],
  vercel: ['JEV_CLI_API_KEY', 'AI_GATEWAY_API_KEY'],
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

# Active provider: "jev" calls TypeSafe AI's own API, "vercel" routes through
# the Vercel AI Gateway. Only the active provider's settings are read, so both
# can stay filled in and "provider" is all you change to switch.
provider: jev

providers:
  jev:
    # TypeSafe AI key: https://console.typesafe.ai/settings/keys
    # Environment fallback: JEV_CLI_API_KEY, TYPESAFE_API_KEY, TYPESAFE_AI_API_KEY.
    apiKey: ""

    # "jev-latest" tracks the current stable release. Pin a version such as
    # "jev-1.13.0" when confidence thresholds are calibrated against it.
    model: ${DEFAULT_MODELS.jev}

    # Uncomment only to target a non-default TypeSafe endpoint.
    # baseURL: https://api.typesafe.ai/v1

  vercel:
    # Vercel AI Gateway key: https://vercel.com/dashboard/ai-gateway
    # Environment fallback: JEV_CLI_API_KEY, then AI_GATEWAY_API_KEY.
    apiKey: ""

    # Evaluation model routed through the gateway.
    model: ${DEFAULT_MODELS.vercel}

    # Uncomment only to target a non-default gateway endpoint.
    # baseURL: https://ai-gateway.vercel.sh/v4/ai
`;
