import { readFileSync } from 'node:fs';

// Exercise the actual trust relationship even in a dry run. The exchanged
// credential stays in memory and is never printed, persisted, or used to publish.
async function readJson(response, operation) {
  if (!response.ok) {
    throw new Error(`${operation} failed (HTTP ${response.status}). Check npm's Trusted Publisher settings for this repository and publish.yml.`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${operation} returned invalid JSON.`);
  }
}

async function main() {
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (process.env.GITHUB_ACTIONS !== 'true' || !requestUrl || !requestToken) {
    throw new Error('This check requires a GitHub-hosted Actions job with id-token: write.');
  }
  const { name } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const url = new URL(requestUrl);
  url.searchParams.set('audience', 'npm:registry.npmjs.org');
  const identity = await readJson(await fetch(url, {
    headers: { Authorization: `Bearer ${requestToken}` },
    signal: AbortSignal.timeout(30_000),
  }), 'GitHub OIDC identity request');
  if (typeof identity.value !== 'string' || !identity.value) throw new Error('GitHub did not return an OIDC identity token.');

  const exchange = await readJson(await fetch(
    `https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/${encodeURIComponent(name)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${identity.value}`, Accept: 'application/json' },
      body: '',
      signal: AbortSignal.timeout(30_000),
    },
  ), 'npm trusted-publisher token exchange');
  if (typeof exchange.token !== 'string' || !exchange.token) throw new Error('npm did not return a scoped publish credential.');
  console.log(`npm accepted this workflow's OIDC identity for ${name}. No package was published by this check.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'npm trust verification failed.');
  process.exitCode = 1;
});
