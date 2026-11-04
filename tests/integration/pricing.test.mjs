import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cliPin } from '../../scripts/plugin-release.mjs';

const root = new URL('../../', import.meta.url);
const { version } = cliPin(fileURLToPath(root));

// Use an already installed published package; never invoke npm or fetch a model.
function publishedCli() {
  const candidates = [];
  if (process.env.COUNTERFACT_TEST_CLI_ROOT) candidates.push(process.env.COUNTERFACT_TEST_CLI_ROOT);
  try {
    candidates.push(dirname(dirname(dirname(createRequire(import.meta.url).resolve('@counterfact-labs/cli')))));
  } catch { /* An offline npm cache is also supported. */ }
  const cache = join(process.env.npm_config_cache ?? join(homedir(), '.npm'), '_npx');
  if (existsSync(cache)) {
    for (const entry of readdirSync(cache)) candidates.push(join(cache, entry, 'node_modules/@counterfact-labs/cli'));
  }
  for (const candidate of candidates) {
    const manifest = join(candidate, 'package.json');
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).version === version) return candidate;
  }
  throw Error('Offline integration tests require the pinned CLI package already installed; set COUNTERFACT_TEST_CLI_ROOT to its directory.');
}

const { serveMcp } = await import(pathToFileURL(join(publishedCli(), 'dist/cli/mcp.js')).href);
const skill = readFileSync(new URL('skills/counterfact/SKILL.md', root), 'utf8');
const baseUrl = 'https://console.example.test';
const topUpUrl = baseUrl + '/account#balance';

async function mcp(t, { tool = 'get_balance', signedIn = true, response = undefined, status = 200 }) {
  const home = mkdtempSync(join(tmpdir(), 'fictional-pricing-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  if (signedIn) {
    mkdirSync(join(home, '.config/counterfact-labs'), { recursive: true });
    writeFileSync(join(home, '.config/counterfact-labs/credentials'), JSON.stringify({ baseUrl, token: 'fictional-offline-token' }));
  }
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    // All transport is fake. Any other route or method fails before network I/O.
    assert.equal(String(url), baseUrl + '/api/cli/balance');
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    assert.equal(new Headers(options.headers).get('authorization'), 'Bearer fictional-offline-token');
    requests.push({ url: String(url), method: options.method });
    return new Response(JSON.stringify(response), { status, headers: { 'content-type': 'application/json' } });
  };
  let output = '';
  try {
    await serveMcp(Readable.from([JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: {} } }) + '\n']),
      new Writable({ write(chunk, _encoding, done) { output += chunk; done(); } }), {
        homeDir: home, cwd: home, baseUrl, emailSignIn: false,
        env: { CF_MCP_PATH_GUARD: '0' },
        findingSettings: { numbersEnabled: false, fixesEnabled: false, agentReadableResults: false },
      });
  } finally {
    globalThis.fetch = originalFetch;
  }
  const envelope = JSON.parse(output);
  assert.equal(envelope.id, 1);
  assert.equal(envelope.error, undefined);
  return { result: envelope.result, requests };
}

test('pinned CLI free balance survives a text-only MCP consumer', async t => {
  const { result, requests } = await mcp(t, { response: { balanceMicro: 0, topUpUrl, freeAnalysisAvailable: true } });
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.freeAnalysisAvailable, true);
  const textOnly = result.content[0].text;
  assert.equal(textOnly, 'Balance: $0\nYour first analysis is free.\nTop up: ' + topUpUrl + '\n');
  assert.equal(result.structuredContent.text, textOnly);
  assert.match(skill, /If `freeAnalysisAvailable` is true or the result text says "Your first analysis is free\.", say: "This analysis is free\."/);
  assert.equal(requests.length, 1);
  t.diagnostic(JSON.stringify(result));
});

for (const eligibility of [false, undefined]) {
  test('pinned CLI balance with free eligibility ' + String(eligibility) + ' preserves balance and link', async t => {
    const response = { balanceMicro: 12_000_000, topUpUrl, ...(eligibility === undefined ? {} : { freeAnalysisAvailable: eligibility }) };
    const { result, requests } = await mcp(t, { response });
    assert.equal(result.isError, false);
    assert.equal(Object.hasOwn(result.structuredContent, 'freeAnalysisAvailable'), false);
    assert.equal(result.content[0].text, 'Balance: $12\nTop up: ' + topUpUrl + '\n');
    assert.equal(requests.length, 1);
    t.diagnostic(JSON.stringify(result));
  });
}

test('an unknown sign-in cost question can resolve signed-out state without a balance request', async t => {
  assert.match(skill, /For a cost question with unknown sign-in state, call `sign_in_status` first without `path` or `wait`\./);
  assert.match(skill, /Call `get_balance` only when signed in/);
  const { result, requests } = await mcp(t, { tool: 'sign_in_status', signedIn: false });
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.signedIn, false);
  assert.equal(result.content[0].text, 'Not signed in.');
  assert.deepEqual(requests, []);
  const reply = skill.match(/Before sign-in, say: "([^"]+)"/)?.[1] ?? '';
  assert.match(reply, /first analysis on a new workspace is free/);
  assert.match(reply, /later analyses are charged to your balance/);
});

test('a signed-in balance failure returns an error without claiming free eligibility', async t => {
  const { result, requests } = await mcp(t, { response: { error: 'Fictional balance service unavailable.' }, status: 503 });
  assert.equal(result.isError, true);
  assert.notEqual(result.structuredContent.exitCode, 0);
  assert.match(result.content[0].text, /Fictional balance service unavailable\./);
  assert.equal(Object.hasOwn(result.structuredContent, 'freeAnalysisAvailable'), false);
  assert.equal(requests.length, 1);
  assert.match(skill, /If `get_balance` fails for a signed-in user, show the returned message and do not guess the cost\./);
  assert.doesNotMatch(skill, /If `get_balance` fails[^\n]*or start an analysis/);
});
