import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { startBridge } from '../../scripts/live-agent-bridge.mjs';

// The real stdio adapter, preload and HTTP bridge run; only npm and the remote
// console are fake. Unexpected remote requests fail rather than reach a network.
test('preview crosses the live adapter and console bridge without starting or reserving an analysis', { timeout: 10000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'live-preview-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const requests = [];
  const original = globalThis.fetch;
  let bridge;
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(String(input));
    if (bridge && url.origin === bridge.url) return original(input, options);
    assert.equal(url.origin, 'https://app.counterfactlabs.com');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.authorization, 'Bearer fictional-key');
    requests.push(url.pathname);
    if (url.pathname === '/api/cli/checks/mode') return Response.json({ mode: 'local' });
    assert.equal(url.pathname, '/api/cli/balance');
    return Response.json({ freeAnalysisAvailable: false, balanceUsd: 12 });
  });
  const budget = { used: 0, cap: 5_000_000 };
  bridge = await startBridge({ key: 'fictional-key', budget, folder: root });
  t.after(() => bridge.close());
  const npm = join(root, 'fake-npx');
  writeFileSync(npm, `#!${process.execPath}
const { createInterface } = require('node:readline');
createInterface({input:process.stdin}).on('line', async line => {
  const q = JSON.parse(line);
  const mode = await fetch('https://app.counterfactlabs.com/api/cli/checks/mode').then(r=>r.json());
  const balance = await fetch('https://app.counterfactlabs.com/api/cli/balance').then(r=>r.json());
  const result = {files:q.params.arguments.proposal.files.map(f=>({...f,bytes:16})),totalBytes:16,
    cost:{free:balance.freeAnalysisAvailable,balanceUsd:balance.balanceUsd},notices:[mode.mode]};
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{structuredContent:result,content:[]}})+'\\n');
});
`);
  chmodSync(npm, 0o755);
  const child = spawn(process.execPath, [new URL('../../scripts/live-agent-mcp.mjs', import.meta.url).pathname,
    '-y', '@counterfact-labs/cli@latest', 'mcp'], {
    cwd: root, env: { ...process.env, LIVE_AGENT_REAL_NPX: npm, LIVE_AGENT_BRIDGE: bridge.url,
      LIVE_AGENT_TOKEN: bridge.token }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => child.kill('SIGKILL'));
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const closed = once(child, 'close');
  const lines = createInterface({ input: child.stdout });
  const response = once(lines, 'line');
  const args = { path: root, proposal: { agentName: 'Fictional assistant', files: [{ path: 'prompt.md', role: 'prompt' }] } };
  child.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'preview_analysis', arguments: args } }) + '\n');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  t.after(() => clearTimeout(timer));
  const [line] = await response;
  assert.deepEqual(JSON.parse(line), { jsonrpc: '2.0', id: 1, result: { structuredContent: {
    files: [{ path: 'prompt.md', role: 'prompt', bytes: 16 }], totalBytes: 16,
    cost: { free: false, balanceUsd: 12 }, notices: ['local'],
  }, content: [] } });
  const [code] = await closed;
  assert.equal(code, 0, stderr);
  assert.deepEqual(requests, ['/api/cli/checks/mode', '/api/cli/balance']);
  assert.equal(bridge.state.attempts, 0);
  assert.equal(bridge.state.reservationRequests, 0);
  assert.equal(bridge.state.reservations.size, 0);
  assert.deepEqual(bridge.state.receipts, []);
  assert.deepEqual(bridge.state.failures, []);
  assert.deepEqual(budget, { used: 0, cap: 5_000_000 });
});
