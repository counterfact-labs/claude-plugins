import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { cliPin } from './plugin-release.mjs';

const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
const { pin, version } = cliPin(pluginRoot);

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'mcp-start-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  const plugin = join(project, 'plugin directory');
  const cache = join(root, 'cache');
  for (const dir of [project, plugin, join(project, 'nested'), join(root, 'stub'), join(root, 'unrelated')]) {
    mkdirSync(dir, { recursive: true });
  }
  const env = {
    PATH: process.env.PATH,
    npm_config_cache: cache, npm_config_offline: 'true', npm_config_ignore_scripts: 'true',
    npm_config_audit: 'false', npm_config_fund: 'false',
    npm_config_registry: 'https://registry.npmjs.org/',
    npm_config_userconfig: join(root, 'npmrc'), npm_config_globalconfig: join(root, 'global-npmrc'),
  };
  writeFileSync(env.npm_config_userconfig, '');
  writeFileSync(env.npm_config_globalconfig, '');
  // Ask npm for its real entrypoint so version-manager shims also work.
  const discovery = spawnSync('npm', ['exec', '--prefix', root, '--call', 'node -p process.env.npm_execpath'], {
    cwd: root, env, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(discovery.status, 0, discovery.stderr);
  const npm = discovery.stdout.trim();
  const npx = join(dirname(npm), 'npx-cli.js');
  // Seed npm's own cache format, without a registry server or any new dependency.
  const cacache = createRequire(npm)('cacache');
  const pkg = { name: '@counterfact-labs/cli', version, bin: { 'counterfact-labs': 'bin.cjs' } };
  // The checkout declares its bin but has no built file, just like the failing CLI checkout.
  writeFileSync(join(project, 'package.json'), JSON.stringify(pkg));
  writeFileSync(join(root, 'stub/package.json'), JSON.stringify(pkg));
  writeFileSync(join(root, 'stub/bin.cjs'), '#!/usr/bin/env node\nconsole.log(JSON.stringify({ source: "packed-stub", args: process.argv.slice(2), cwd: process.cwd() }));\n');
  const pack = spawnSync(process.execPath, [npm, 'pack', '--json'], {
    cwd: join(root, 'stub'), env, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(pack.status, 0, pack.stderr);
  const [packed] = JSON.parse(pack.stdout);
  const contentCache = join(cache, '_cacache');
  const integrity = await cacache.put(contentCache, 'stub-tarball', readFileSync(join(root, 'stub', packed.filename)));
  const url = 'https://registry.npmjs.org/@counterfact-labs%2fcli';
  const manifest = { ...pkg, dist: { tarball: `https://registry.npmjs.org/@counterfact-labs/cli/-/cli-${version}.tgz`, integrity: String(integrity) } };
  // npm requests both full and abbreviated metadata; both responses stay offline.
  for (const accept of ['application/json', 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*']) {
    await cacache.put(contentCache, `make-fetch-happen:request-cache:${url}`, JSON.stringify({
      name: pkg.name, 'dist-tags': { latest: version }, versions: { [version]: manifest },
    }), { metadata: { time: Date.now(), url, reqHeaders: { accept }, resHeaders: { 'content-type': 'application/json' }, options: { compress: true } } });
  }
  return {
    root, project, plugin,
    run: (args, cwd = project) => spawnSync(process.execPath, [npx, ...args], {
      cwd, env, encoding: 'utf8', timeout: 15000,
    }),
  };
}

test('npx accepts a matching unbuilt checkout even with an explicit --package', async (t) => {
  const { run } = await fixture(t);
  for (const args of [
    ['-y', pin, 'mcp'],
    ['-y', `--package=${pin}`, 'counterfact-labs', 'mcp'],
  ]) {
    const result = run(args);
    assert.equal(result.status, 127, result.stderr);
    assert.match(result.stderr, /counterfact-labs: not found/);
  }
});

test('the plugin starts the pinned package from CLI checkouts and preserves the project cwd', async (t) => {
  const { root, project, plugin, run } = await fixture(t);
  const { command, args } = cliPin(pluginRoot, plugin);
  assert.equal(command, 'npx');
  for (const cwd of [project, join(project, 'nested'), join(root, 'unrelated')]) {
    const result = run(args, cwd);
    assert.equal(result.status, 0, `cwd=${cwd}\n${result.stderr}`);
    assert.deepEqual(JSON.parse(result.stdout), { source: 'packed-stub', args: ['mcp'], cwd });
  }
  // Even an existing project bin must not shadow the pinned package.
  mkdirSync(join(project, 'node_modules/.bin'), { recursive: true });
  writeFileSync(join(project, 'node_modules/.bin/counterfact-labs'), '#!/bin/sh\necho local-checkout\n', { mode: 0o755 });
  const result = run(args);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { source: 'packed-stub', args: ['mcp'], cwd: project });
});

test('the live MCP adapter forwards the plugin npm prefix and stdio replies', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'mcp-adapter-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const executable = join(root, 'npx');
  writeFileSync(executable, `#!${process.execPath}\nrequire('node:readline').createInterface({ input: process.stdin }).on('line', line => {
    const request = JSON.parse(line);
    console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { args: process.argv.slice(2) } }));
  });\n`, { mode: 0o755 });
  const args = ['-y', `--prefix=${join(root, 'plugin directory')}`, pin, 'mcp'];
  const events = [];
  // tools/list is observed by the adapter: a real caller must supply its bridge.
  const bridge = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    events.push({ path: request.url, token: request.headers['x-live-agent-token'], body: JSON.parse(body) });
    response.writeHead(200, { 'content-type': 'application/json' }); response.end('{}');
  });
  await new Promise(resolve => bridge.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { bridge.close(resolve); bridge.closeAllConnections(); }));
  const child = spawn(process.execPath, [fileURLToPath(new URL('./live-agent-mcp.mjs', import.meta.url)), ...args], {
    env: { PATH: process.env.PATH, HOME: root, LIVE_AGENT_REAL_NPX: executable,
      LIVE_AGENT_BRIDGE: `http://127.0.0.1:${bridge.address().port}`, LIVE_AGENT_TOKEN: 'fictional-token' },
    timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => child.kill('SIGKILL'));
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) + '\n');
  const result = { status: await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }), stdout, stderr };
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { jsonrpc: '2.0', id: 1, result: { args } });
  assert.deepEqual(events, [{ path: '/event', token: 'fictional-token', body: { kind: 'tools' } }]);
});
