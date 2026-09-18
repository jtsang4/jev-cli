import pkg from '../package.json' with { type: 'json' };

import { CONFIG_HELP, runConfig } from './commands/config.ts';
import { DOCTOR_HELP, runDoctor } from './commands/doctor.ts';
import { EVALUATE_HELP, runEvaluate } from './commands/evaluate.ts';
import { ExitCode, JevCliError, usageError } from './errors.ts';
import { printError } from './output.ts';

const HELP = `jev-cli ${pkg.version} — evaluate typed questions against shared state with TypeSafe AI's Jev.

Usage:
  jev-cli <command> [options]

Commands:
  eval       Evaluate questions against a state and print the answers as JSON
  config     Manage ~/.jev-cli/config.yaml (init, path, list, get, set, unset)
  doctor     Check the configuration and credentials

Options:
  -h, --help       Show this help
  -v, --version    Show the version

Getting started:
  jev-cli config init
  jev-cli config set provider jev
  jev-cli config set providers.jev.apiKey <typesafe-api-key>
  jev-cli doctor
  jev-cli eval -s "The agent issued a full refund." \\
    -q '{"refunded":{"type":"boolean","instructions":"Was a refund issued?"}}'

Providers:
  jev       TypeSafe AI's own API (keys from https://typesafe.ai)
  vercel    Vercel AI Gateway (default)

Run "jev-cli <command> --help" for command-specific options.
Docs: ${pkg.homepage}
`;

const COMMAND_HELP: Record<string, string> = {
  eval: EVALUATE_HELP,
  evaluate: EVALUATE_HELP,
  config: CONFIG_HELP,
  doctor: DOCTOR_HELP,
};

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    // `help <command>` should show that command's help, not the overview.
    const topic = command === 'help' ? rest[0] : undefined;
    process.stdout.write(topic !== undefined ? (COMMAND_HELP[topic] ?? HELP) : HELP);
    return ExitCode.Success;
  }
  if (command === '--version' || command === '-v') {
    process.stdout.write(`${pkg.version}\n`);
    return ExitCode.Success;
  }

  switch (command) {
    case 'eval':
    case 'evaluate':
      return await runEvaluate(rest);
    case 'config':
      return await runConfig(rest);
    case 'doctor':
      return await runDoctor(rest);
    default:
      throw usageError(
        `Unknown command "${command}". Expected one of: eval, config, doctor. Run "jev-cli --help".`,
      );
  }
}

const argv = process.argv.slice(2);
const command = argv[0];

try {
  process.exitCode = await main(argv);
} catch (error) {
  // `eval` is the machine-facing command, so its failures stay parseable JSON.
  // The human-facing commands get a plain sentence instead.
  if (command === 'eval' || command === 'evaluate') {
    printError(error);
  } else {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`jev-cli: ${message}\n`);
  }
  process.exitCode = error instanceof JevCliError ? error.exitCode : ExitCode.Runtime;
}
