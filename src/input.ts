import { readFile } from 'node:fs/promises';

import { usageError } from './errors.ts';

/** Reads stdin once and caches it, so `-` can only stand in for a single input. */
export class StdinReader {
  #content: string | undefined;
  #claimedBy: string | undefined;

  async read(claimant: string): Promise<string> {
    if (this.#claimedBy !== undefined && this.#claimedBy !== claimant) {
      throw usageError(
        `Only one input can read from stdin, but both ${this.#claimedBy} and ${claimant} requested it.`,
      );
    }
    this.#claimedBy = claimant;
    if (this.#content === undefined) {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
      }
      this.#content = Buffer.concat(chunks).toString('utf8');
    }
    return this.#content;
  }
}

/**
 * Resolve one input from either an inline value or a file. `-` means stdin in
 * both positions. Returns undefined when neither was supplied.
 */
export async function resolveInput(options: {
  inline: string | undefined;
  file: string | undefined;
  inlineFlag: string;
  fileFlag: string;
  stdin: StdinReader;
}): Promise<string | undefined> {
  const { inline, file, inlineFlag, fileFlag, stdin } = options;

  if (inline !== undefined && file !== undefined) {
    throw usageError(`Pass either ${inlineFlag} or ${fileFlag}, not both.`);
  }
  if (inline !== undefined) {
    return inline === '-' ? await stdin.read(inlineFlag) : inline;
  }
  if (file !== undefined) {
    if (file === '-') return await stdin.read(fileFlag);
    try {
      return await readFile(file, 'utf8');
    } catch (error) {
      throw usageError(`Cannot read ${fileFlag} ${file}: ${(error as Error).message}`);
    }
  }
  return undefined;
}
