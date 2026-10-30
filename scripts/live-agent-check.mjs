import { spawn } from 'node:child_process';
import { accessSync, appendFileSync, chmodSync, constants, cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { consoleOrigin, startBridge, analysisCeilingMicro } from './live-agent-bridge.mjs';
import { cases, assertCase } from './live-agent-cases.mjs';
import { capture, probeMcp, overCapProbe, checkLinks } from './live-agent-probes.mjs';

const example = fileURLToPath(new URL('./fixtures/live-agent', import.meta.url));
const adapter = fileURLToPath(new URL('./live-agent-mcp.mjs', import.meta.url));
const usage = 'Usage: scripts/live-agent-check.sh <check|run> [--confirm-paid] [--max-dollars 20] [--timeout-seconds 1200] [--agent-dir path]';
const quote = text => /^[a-zA-Z0-9_@%+=:,./#-]+$/.test(text) ? text : "'" + text.replaceAll("'", "'\\''") + "'";
function options(args) {
  const mode = args.shift();
  if (!['check', 'run'].includes(mode)) throw Error(usage);
  let max = '20', seconds = '1200', confirmed = false, agentDir = example;
  const seen = new Set();
  while (args.length) {
    const flag = args.shift();
    if (seen.has(flag)) throw Error(usage);
    seen.add(flag);
    if (flag === '--confirm-paid') confirmed = true;
    else if (flag === '--max-dollars') max = args.shift() ?? '';
    else if (flag === '--timeout-seconds') seconds = args.shift() ?? '';
    else if (flag === '--agent-dir') {
      agentDir = args.shift();
      if (!agentDir?.trim() || agentDir.startsWith('--')) throw Error('Invalid --agent-dir; use a directory path');
    } else throw Error(usage);
  }
  if (!/^\d+(?:\.\d{1,6})?$/.test(max) || Number(max) <= 0 || Number(max) > 20 ||
      !Number.isSafeInteger(Math.round(Number(max) * 1e6))) {
    throw Error('Invalid --max-dollars; use a positive dollar amount at most 20 with at most six decimals');
  }
  if (!/^\d+$/.test(seconds) || !Number.isSafeInteger(Number(seconds)) ||
      Number(seconds) < 1 || Number(seconds) > 3600) {
    throw Error('Invalid --timeout-seconds; use 1-3600');
  }
  return { mode, cap: Math.round(Number(max) * 1e6), seconds: Number(seconds), confirmed, agentDir: resolve(agentDir) };
}
function prompt(backend) {
  return (backend === 'claude' ? '/counterfact:counterfact .\n' : '') +
    'Analyze the fictional agent in the current folder with Counterfact exactly once. ' +
    'Use the Counterfact MCP tools' + (backend === 'claude' ? ' and the installed Counterfact skill' : '') + '. ' +
    'Sign-in is configured and analysis permission is granted for this release analysis. Decline any waiting fixes. ' +
    'Use path "."; do not change files, use shell commands, inspect credentials or environment, sign in again, retry, or run additional analyses. ' +
    'Wait for completion and return the CLI summary and full console findings URL from the tool result. If anything fails, report the failure.';
}
function commands(backend) {
  if (backend === 'claude') return [
    ['claude', ['plugin', 'marketplace', 'add', 'counterfact-labs/claude-plugins#main']],
    ['claude', ['plugin', 'install', 'counterfact@counterfact-labs', '--scope', 'user']],
    ['claude', ['-p', prompt(backend), '--verbose', '--output-format', 'stream-json', '--no-session-persistence',
      '--permission-mode', 'dontAsk', '--tools', 'Read,Skill', '--allowedTools', 'Read,Skill,mcp__plugin_counterfact_counterfact__*']],
  ];
  return [['codex', ['exec', '--json', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', prompt(backend)]]];
}
function preview(config) {
  console.log('Live agent release analysis preview. No network calls or executables.');
  console.log(`Total Counterfact analysis estimate cap: $${(config.cap / 1e6).toFixed(2)}. Per-analysis ceiling $${(analysisCeilingMicro / 1e6).toFixed(2)}; eight analyses. run requires --confirm-paid and COUNTERFACT_LIVE_TEST_KEY.`);
  console.log(`Copy ${config.agentDir} separately for Claude and Codex under a private temporary directory (clean case; the other cases use their dedicated fixtures).`);
  console.log('Each gets fresh HOME, CODEX_HOME, CLAUDE_CONFIG_DIR, XDG directories, and npm cache; use provider credentials from environment only.');
  console.log('Install an npx stdio adapter ahead of PATH. It launches the published MCP server, captures actual protocol replies, and permits one analysis per agent per case.');
  console.log('Codex config: npx -y @counterfact-labs/cli@latest mcp; startup_timeout_sec=120; tool_timeout_sec=900; approval_policy=never; default_tools_approval_mode=approve.');
  console.log('The CLI credential read is served in memory. A loopback transport adds the test key only to production console HTTPS requests.');
  console.log('Withhold each reservation capability until its priceMicro is a nonnegative safe integer and the combined price fits the cap; otherwise release the hold before model work.');
  console.log('A temporary balance hold may occur before the price is available. Coding-agent provider costs are separate and are not bounded by this Counterfact cap.');
  for (const backend of ['claude', 'codex']) {
    console.log(`\n${backend}: cwd=<temporary>/${backend}/agent; HOME=<temporary>/${backend}/home`);
    for (const [command, args] of commands(backend)) console.log([command, ...args.map(quote)].join(' '));
  }
  console.log(`\nPer-command deadline: ${config.seconds}s; terminate process groups and remove temporary files on exit or interruption.`);
  console.log('Require MCP initialization, a completed analyze_agent reply, CLI summary, an actual console upload receipt, and the matching URL in the final coding-agent response.');
  console.log('Cases in BOTH agents: clean (completion and supported coverage), planted-authority (system_prompt.md:6), planted-credential (system_prompt.md:12), tools-agent (tools.json:5 and tools.js:3).');
  console.log('Free probes every run: sign-in status, installed MCP startup inside package @counterfact-labs/cli, supported over-cap refusal, /setup and README links.');
  console.log('Print one-screen PASS/FAIL rows with duration, estimated/charged Counterfact amount, and provider cost if reported; fail the process if either agent fails.');
}
function executable(name) {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    const path = resolve(directory, name);
    try { accessSync(path, constants.X_OK); return path; } catch { /* Try the next PATH entry. */ }
  }
  throw Error(`Missing executable: ${name}`);
}
const cancellation = new AbortController();
function runCommand(command, args, env, cwd, seconds, bridgeSignal) {
  return new Promise((resolve, reject) => {
    const signal = AbortSignal.any([cancellation.signal, bridgeSignal]);
    const child = spawn(command, args, { env, cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', size = 0, failure;
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Group already exited. */ } };
    const cancel = () => { failure = bridgeSignal.aborted ? bridgeSignal.reason.message : 'Interrupted'; kill(); };
    const timer = setTimeout(() => { failure = 'Headless command timed out'; kill(); }, seconds * 1000);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) { failure = 'Agent output exceeded limit'; kill(); }
      else stdout += chunk;
    });
    child.stderr.resume();
    child.on('error', () => { failure = `Could not start ${command}`; });
    child.on('close', code => {
      clearTimeout(timer); signal.removeEventListener('abort', cancel); kill();
      if (failure || code !== 0) reject(Error(failure ?? `${command} exited ${code}`)); else resolve(stdout);
    });
  });
}
function environment(home, bin, backend, bridge, realNpx) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (/^(COUNTERFACT_|CF_|XDG_|npm_config_|NPM_CONFIG_)/.test(name) ||
        ['HOME', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'NODE_EXTRA_CA_CERTS'].includes(name)) {
      delete env[name];
    }
  }
  Object.assign(env, { HOME: home, CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'),
    XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), XDG_DATA_HOME: join(home, '.local/share'),
    XDG_STATE_HOME: join(home, '.local/state'), npm_config_cache: join(home, '.npm'), npm_config_userconfig: join(home, '.npmrc'),
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', PATH: bin + delimiter + process.env.PATH,
    LIVE_AGENT_BRIDGE: bridge.url, LIVE_AGENT_TOKEN: bridge.token, LIVE_AGENT_REAL_NPX: realNpx, LIVE_AGENT_BACKEND: backend,
  });
  // CODEX_API_KEY authenticates noninteractive Codex without copying saved auth.
  env.CODEX_API_KEY ??= env.OPENAI_API_KEY;
  return env;
}
function configure(home, bin) {
  mkdirSync(join(home, '.codex'), { recursive: true }); mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.npmrc'), '');
  writeFileSync(join(home, '.claude/settings.json'), JSON.stringify({ permissions: { allow: ['mcp__plugin_counterfact_counterfact__analyze_agent'] } }));
  const codexConfig = [
    'approval_policy = "never"',
    'sandbox_mode = "read-only"',
    '[mcp_servers.counterfact]',
    'default_tools_approval_mode = "approve"',
    `command = ${JSON.stringify(join(bin, 'npx'))}`,
    'args = ["-y", "@counterfact-labs/cli@latest", "mcp"]',
    'startup_timeout_sec = 120',
    'tool_timeout_sec = 900',
    'required = true',
    'env_vars = ["PATH", "HOME", "NODE_OPTIONS", "LIVE_AGENT_BRIDGE", "LIVE_AGENT_TOKEN", "LIVE_AGENT_REAL_NPX", "LIVE_AGENT_BACKEND"]',
    '',
  ].join('\n');
  writeFileSync(join(home, '.codex/config.toml'), codexConfig);
}
function validateEvidence(state) {
  if (state.failures.length) throw Error(state.failures[0]);
  if (!state.servers.some(server => server?.name === 'counterfact-labs' && server.version)) throw Error('Counterfact MCP server did not initialize');
  if (state.attempts !== 1 || state.results.length !== 1) throw Error('Expected one completed MCP analysis');
  const result = state.results[0], structured = result?.structuredContent;
  const text = result?.content?.filter(item => item.type === 'text').map(item => item.text).join('\n') ?? '';
  if (structured?.signedIn === false || structured?.reason === 'unauthorized' ||
      /Not signed in\.|Your saved sign-in can't be read\./.test(text)) {
    throw Error('In-memory CLI sign-in failed; verify the test key and published CLI adapter compatibility');
  }
  if (result?.isError || structured?.exitCode !== 0) throw Error('MCP analysis did not complete successfully');
  const receipt = state.receipts[0];
  if (state.receipts.length !== 1 || receipt.analysisId !== structured.analysisId ||
      structured.projectId && receipt.projectId !== structured.projectId) {
    throw Error('Missing matching console upload receipt');
  }
  const url = `${consoleOrigin}/projects/${receipt.projectId}/findings`;
  if (structured.url !== url || !text.includes(url) || !/(?:Findings:|Finding ids:|No findings\.|\d+ findings)/i.test(text)) throw Error('Missing CLI summary or console findings URL');
  return { ...receipt, url };
}
function validateClaude(events, receipt) {
  const connected = events.some(event => event.type === 'system' && event.mcp_servers?.some(server =>
    server.name === 'plugin:counterfact:counterfact' && server.status === 'connected'));
  if (!connected) throw Error('Installed Claude plugin did not connect');
  const final = events.findLast(event => event.type === 'result');
  if (!final || final.is_error || final.subtype !== 'success' || !final.result?.includes(receipt.url)) {
    throw Error('Claude did not return completed results and URL');
  }
  return { ...receipt, provider: Number.isFinite(final.total_cost_usd) ? `$${final.total_cost_usd.toFixed(2)}` : 'not reported' };
}
function validateCodex(events, receipt) {
  const completedTool = events.some(event => event.type === 'item.completed' && event.item?.type === 'mcp_tool_call' &&
    event.item.server === 'counterfact' && event.item.tool === 'analyze_agent' && event.item.status === 'completed');
  const completedTurn = events.some(event => event.type === 'turn.completed');
  const failed = events.some(event => event.type === 'turn.failed' || event.type === 'error');
  const returnedUrl = events.some(event => event.item?.type === 'agent_message' && event.item.text?.includes(receipt.url));
  if (!completedTool || !completedTurn || failed || !returnedUrl) {
    throw Error('Codex did not return completed MCP results and URL');
  }
  return { ...receipt, provider: 'not reported' };
}
function validate(backend, output, state) {
  const receipt = validateEvidence(state);
  let events;
  try { events = output.trim().split('\n').map(line => JSON.parse(line)); } catch { throw Error('Invalid coding-agent JSON output'); }
  return backend === 'claude' ? validateClaude(events, receipt) : validateCodex(events, receipt);
}
function pluginCli(home) {
  const registry = JSON.parse(readFileSync(join(home, '.claude/plugins/installed_plugins.json'), 'utf8'));
  const entries = registry.plugins?.['counterfact@counterfact-labs'];
  const entry = entries?.find(item => item.scope === 'user');
  if (!entry?.installPath || !resolve(entry.installPath).startsWith(resolve(home) + '/')) throw Error('Installed plugin path unavailable');
  const server = JSON.parse(readFileSync(join(entry.installPath, '.mcp.json'), 'utf8')).mcpServers?.counterfact;
  if (server?.command !== 'npx' || server.args?.length !== 3 || server.args[0] !== '-y' || server.args[2] !== 'mcp' ||
      !/^@counterfact-labs\/cli@\d+\.\d+\.\d+$/.test(server.args[1])) throw Error('Installed plugin MCP configuration unavailable');
  return server.args[1];
}
async function freeProbes({ backend, home, bin, root, key, budget, realNpx, rows }) {
  const firstRow = rows.length;
  const add = (name, result) => rows.push({ backend, case: name, ...result });
  let bridge;
  try {
    const folder = join(root, backend, 'package-shadow');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'package.json'), JSON.stringify({ name: '@counterfact-labs/cli', version: '0.0.0' }));
    cpSync(example, folder, { recursive: true });
    const cli = backend === 'claude' ? pluginCli(home) : '@counterfact-labs/cli@latest';
    bridge = await startBridge({ key, budget, folder, free: true });
    const env = environment(home, bin, backend, bridge, realNpx);
    try {
      const result = await probeMcp(join(bin, 'npx'), ['-y', cli, 'mcp'], { env, cwd: folder, signal: cancellation.signal });
      add('MCP package startup', { pass: true, reason: `Initialized ${result.server.name} ${result.server.version} inside @counterfact-labs/cli` });
      add('sign-in', { pass: !result.status.isError && result.status.structuredContent?.signedIn === true,
        reason: result.status.structuredContent?.signedIn === true ? 'Signed in' : 'Sign-in status did not confirm signed in' });
    } catch {
      add('MCP package startup', { pass: false, reason: 'MCP startup/protocol failed inside @counterfact-labs/cli' });
      add('sign-in', { pass: false, reason: 'Sign-in status unavailable' });
    }
    try {
      const preload = fileURLToPath(new URL('./live-agent-preload.mjs', import.meta.url));
      const result = await overCapProbe({
        run: args => capture(realNpx, ['-y', cli, ...args], {
          env: { ...env, NODE_OPTIONS: `${env.NODE_OPTIONS ?? ''} --import=${preload}` }, cwd: folder, signal: cancellation.signal,
        }), safe: () => !bridge.state.failures.length && !bridge.state.reservations.size &&
          bridge.state.reservationRequests <= 1 && !bridge.state.receipts.length,
      });
      add('over-cap refusal', result);
    } catch { add('over-cap refusal', { pass: false, reason: 'Over-cap probe failed' }); }
  } catch (error) { add('free probes', { pass: false, reason: error.message }); }
  finally {
    await bridge?.close();
    if (bridge?.state.failures.length) for (const row of rows.slice(firstRow)) {
      row.pass = false; row.reason += '; ' + bridge.state.failures.join('; ');
    }
  }
}
function report(rows, config, key) {
  const clean = value => String(value ?? '').replaceAll(key, '[redacted]').replace(/[\r\n]/g, ' ');
  const cell = value => clean(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '&#124;');
  console.log(`Live agent integration suite | total Counterfact cap $${(config.cap / 1e6).toFixed(2)} | per analysis $${(analysisCeilingMicro / 1e6).toFixed(2)}`);
  const table = ['| Agent | Case | Result | Reason |', '| --- | --- | --- | --- |'];
  for (const row of rows) {
    const name = row.backend === 'claude' ? 'Claude' : row.backend === 'codex' ? 'Codex' : 'Free';
    let detail = clean(row.reason);
    if (row.priceMicro !== undefined) {
      const charged = row.chargedMicro === undefined ? 'charged not reported' : `charged (equals estimate) $${(row.chargedMicro / 1e6).toFixed(2)}`;
      detail += `; estimate $${(row.priceMicro / 1e6).toFixed(2)}; ${charged}; provider ${row.provider}; ${row.duration}s`;
    }
    console.log(`${row.pass ? 'PASS' : 'FAIL'} ${name} | ${row.case} | ${detail}`);
    if (row.url) console.log(`     ${row.url}`);
    table.push(`| ${cell(name)} | ${cell(row.case)} | ${row.pass ? 'PASS' : 'FAIL'} | ${cell(detail)}${row.url ? `; ${cell(row.url)}` : ''} |`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table.join('\n') + '\n');
  if (rows.some(row => !row.pass)) process.exitCode = 1;
}
async function main() {
  const config = options(process.argv.slice(2));
  if (config.mode === 'check') { preview(config); return; }
  if (!config.confirmed) throw Error('run requires --confirm-paid');
  const key = process.env.COUNTERFACT_LIVE_TEST_KEY;
  if (!key?.trim()) throw Error('COUNTERFACT_LIVE_TEST_KEY is required');
  if (!/^[\x21-\x7e]{1,4096}$/.test(key)) throw Error('Invalid COUNTERFACT_LIVE_TEST_KEY');
  const realNpx = executable('npx');
  const budget = { used: 0, cap: config.cap }, rows = [];
  const root = mkdtempSync(join(tmpdir(), 'counterfact-live-')); chmodSync(root, 0o700);
  const interrupt = () => cancellation.abort(); process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try {
    rows.push(...await checkLinks(readFileSync(new URL('../README.md', import.meta.url), 'utf8')));
    for (const backend of ['claude', 'codex']) {
      const home = join(root, backend, 'home'), bin = join(root, backend, 'bin');
      let setupFailure;
      try {
        mkdirSync(bin, { recursive: true }); configure(home, bin);
        writeFileSync(join(bin, 'npx'), `#!/usr/bin/env bash\nexec ${quote(process.execPath)} ${quote(adapter)} "$@"\n`, { mode: 0o700 });
        const env = environment(home, bin, backend, { url: '', token: '' }, realNpx);
        for (const [command, args] of commands(backend).slice(0, -1)) {
          await runCommand(command, args, env, home, config.seconds, new AbortController().signal);
        }
      } catch (error) { setupFailure = error.message; }
      if (!setupFailure) await freeProbes({ backend, home, bin, root, key, budget, realNpx, rows });
      for (const spec of cases) {
        const started = Date.now(), folder = join(root, backend, spec.id, 'agent');
        let bridge, row;
        try {
          if (setupFailure) throw Error(setupFailure);
          if (cancellation.signal.aborted) throw Error('Interrupted');
          const source = spec.id === 'clean' ? config.agentDir : fileURLToPath(new URL('./fixtures/' + spec.directory, import.meta.url));
          cpSync(source, folder, { recursive: true, filter: path => { if (lstatSync(path).isSymbolicLink()) throw Error('Example must not contain symlinks'); return true; } });
          bridge = await startBridge({ key, budget, folder });
          const env = environment(home, bin, backend, bridge, realNpx);
          const [command, args] = commands(backend).at(-1);
          const output = await runCommand(command, args, env, folder, config.seconds, bridge.signal);
          const receipt = validate(backend, output, bridge.state);
          const result = bridge.state.results[0];
          const text = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
          row = { pass: true, ...receipt };
          row = { ...row, ...assertCase(spec.id, { findings: bridge.state.findings,
            coverageSupported: bridge.state.coverageSupported || Object.hasOwn(result.structuredContent, 'coverage'), coverage: result.structuredContent.coverage, text }) };
        } catch (error) { row = { ...row, pass: false, reason: error.message.startsWith(spec.id + ':') ? error.message : `${spec.id}: ${error.message}` }; }
        finally {
          await bridge?.close();
          if (bridge?.state.failures.length) row = { ...row, pass: false, reason: `${spec.id}: ${bridge.state.failures.join('; ')}` };
          rmSync(join(root, backend, spec.id), { recursive: true, force: true });
        }
        rows.push({ backend, case: spec.id, duration: ((Date.now() - started) / 1000).toFixed(1), ...row });
      }
      rmSync(join(root, backend), { recursive: true, force: true });
    }
  } finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    rmSync(root, { recursive: true, force: true });
  }
  report(rows, config, key);
}
main().catch(error => { console.error(`FAIL ${error.message}`); process.exitCode = 1; });
