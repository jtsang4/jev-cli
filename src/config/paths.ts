import { homedir } from 'node:os';
import { join } from 'node:path';

/** Config directory. `JEV_CLI_HOME` overrides it, which keeps tests off the real config. */
export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.JEV_CLI_HOME?.trim();
  return override ? override : join(homedir(), '.jev-cli');
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), 'config.yaml');
}
