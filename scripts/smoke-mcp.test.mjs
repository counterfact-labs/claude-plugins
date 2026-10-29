import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./smoke-mcp.mjs', import.meta.url));

// Only the external npm executable is replaced; the real smoke client uses stdio.
const server = `#!${process.execPath}
const { createInterface } = require('node:readline');
const assert = require('node:assert/strict');
assert.deepEqual(process.argv.slice(2), ['-y', '@counterfact-labs/cli@1.2.3', 'mcp']);
const mode = process.env.FAKE_MCP_MODE;
if (mode === 'unpublished') process.exit(1);
if (mode === 'hang') setInterval(() => {}, 1000);
let initialized = false;
const send = (id, result) => {
  const response = JSON.stringify({ jsonrpc: '2.0', id, result });
  // Responses can span arbitrary chunks on the pipe.
  process.stdout.write(response.slice(0, 8));
  setImmediate(() => process.stdout.write(response.slice(8) + '\\n'));
};
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  if (mode === 'hang') return;
  if (mode === 'malformed') { process.stdout.write('not JSON\\n'); return; }
  if (mode === 'rpc-error') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'broken startup' } }) + '\\n');
    return;
  }
  if (request.method === 'initialize') {
    assert.deepEqual(request.params, {
      protocolVersion: '2024-11-05', capabilities: {},
      clientInfo: { name: 'plugin-ci-smoke', version: '1.0.0' },
    });
    send(request.id, {
      protocolVersion: '2024-11-05', capabilities: { tools: {} },
      serverInfo: { name: 'fixture', version: mode === 'wrong-version' ? '1.2.2' : '1.2.3' },
    });
  } else if (request.method === 'notifications/initialized') {
    initialized = true;
  } else if (request.method === 'tools/list') {
    assert.equal(initialized, true);
    if (mode === 'missing-tool') { send(request.id, { tools: [] }); return; }
    if (!request.params?.cursor) {
      send(request.id, { tools: [{ name: 'get_finding', inputSchema: { type: 'object' } }], nextCursor: 'page2' });
    } else {
      assert.equal(request.params.cursor, 'page2');
      send(request.id, { tools: [{ name: 'analyze_agent', inputSchema: { type: 'object' } }] });
    }
  } else {
    // In particular, no tool may be called by this smoke test.
    throw new Error('Unexpected method: ' + request.method);
  }
});
`;

function run(t, mode = 'ok', skill = 'Use `get_finding` and `mcp__plugin_counterfact_counterfact__analyze_agent`.', args = ['-y', '@counterfact-labs/cli@1.2.3', 'mcp']) {
  const root = mkdtempSync(join(tmpdir(), 'smoke-mcp-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'bin'));
  mkdirSync(join(root, 'skills/nested'), { recursive: true });
  writeFileSync(join(root, 'bin/npx'), server);
  chmodSync(join(root, 'bin/npx'), 0o755);
  writeFileSync(join(root, '.mcp.json'), JSON.stringify({
    mcpServers: { counterfact: { command: 'npx', args } },
  }));
  writeFileSync(join(root, 'skills/nested/SKILL.md'), skill);
  return spawnSync(process.execPath, [script, root, mode === 'hang' ? '500' : '2000'], {
    env: { ...process.env, PATH: join(root, 'bin'), FAKE_MCP_MODE: mode },
    encoding: 'utf8', timeout: 5000,
  });
}

test('starts the exact npm pin and completes initialize and paginated tools/list', (t) => {
  const result = run(t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1\.2\.3.*2 required tools/);
});

test('finds the CLI pin when args also contains non-string values', (t) => {
  const result = run(t, 'ok', undefined, [null, 42, {}, '-y', '@counterfact-labs/cli@1.2.3', 'mcp']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1\.2\.3.*2 required tools/);
});

test('rejects non-array args with the shared missing-pin diagnostic', (t) => {
  const result = run(t, 'ok', undefined, '-y @counterfact-labs/cli@1.2.3 mcp');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /CLI argument is missing from \.mcp\.json/);
});

for (const pin of ['^1.2.3', '1.2.3-rc.1', '01.2.3']) {
  test(`rejects unstable CLI pin ${pin} before starting npx`, (t) => {
    const result = run(t, 'ok', undefined, ['-y', `@counterfact-labs/cli@${pin}`, 'mcp']);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /CLI pin .* must be an exact X\.Y\.Z version/);
  });
}

for (const [mode, error] of [
  ['unpublished', /exited/],
  ['wrong-version', /version.*1\.2\.2.*1\.2\.3/],
  ['missing-tool', /Missing.*get_finding.*analyze_agent/],
  ['rpc-error', /broken startup/],
  ['malformed', /JSON/],
  ['hang', /timed out/],
]) {
  test(`rejects ${mode}`, (t) => {
    const result = run(t, mode);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, error);
  });
}

test('discovers new skill tool references rather than using a fixed tool allowlist', (t) => {
  const result = run(t, 'ok', 'Use `get_finding`, `analyze_agent`, and `new_tool`.');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Missing.*new_tool/);
});

test('fails closed when the skill names no tools', (t) => {
  const result = run(t, 'ok', 'No tools documented.');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /No.*tool/);
});
