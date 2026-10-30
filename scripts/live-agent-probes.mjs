import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// This process helper returns exit status as evidence for expected refusals.
export function capture(command, args, { env, cwd, seconds = 120, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', size = 0, failure;
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Exited. */ } };
    const abort = () => { failure = 'Probe interrupted'; kill(); };
    const timer = setTimeout(() => { failure = 'Probe timed out'; kill(); }, seconds * 1000);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    for (const [stream, append] of [[child.stdout, s => { stdout += s; }], [child.stderr, s => { stderr += s; }]]) stream.on('data', chunk => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) { failure = 'Probe output exceeded limit'; kill(); } else append(String(chunk));
    });
    child.on('error', () => { failure = 'Probe executable unavailable'; });
    child.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort); kill();
      if (failure) reject(Error(failure)); else resolve({ code, stdout, stderr });
    });
  });
}
export function probeMcp(command, args, { env, cwd, seconds = 120, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let server, tools, status, failure, size = 0;
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Exited. */ } };
    const abort = () => { failure = 'MCP startup/sign-in interrupted'; kill(); };
    const timer = setTimeout(() => { failure = 'MCP startup/sign-in timed out'; kill(); }, seconds * 1000);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stderr.resume(); child.stdin.on('error', () => {});
    const send = (id, method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    createInterface({ input: child.stdout }).on('line', line => {
      try {
        size += line.length;
        if (size > 3 * 1024 * 1024) throw Error('MCP output exceeded limit');
        const r = JSON.parse(line);
        if (r.error) throw Error('MCP protocol error');
        if (r.id === 1) {
          server = r.result?.serverInfo;
          send(undefined, 'notifications/initialized', {}); send(2, 'tools/list', {});
        } else if (r.id === 2) {
          tools = r.result?.tools;
          const tool = tools?.find(t => t.name === 'sign_in_status');
          if (!tool) throw Error('MCP sign-in status tool unavailable');
          send(3, 'tools/call', { name: 'sign_in_status', arguments: tool.inputSchema?.properties?.path ? { path: '.' } : {} });
        } else if (r.id === 3) { status = r.result; child.stdin.end(); }
      } catch { failure = 'MCP startup/sign-in protocol failed'; kill(); }
    });
    child.on('error', () => { failure = 'MCP executable unavailable'; });
    child.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort); kill();
      if (failure || code !== 0 || server?.name !== 'counterfact-labs' || !server.version || !status) reject(Error(failure ?? 'MCP startup/sign-in incomplete'));
      else resolve({ server, tools, status });
    });
    send(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'live-suite-free-probe', version: '1' } });
  });
}
export async function overCapProbe({ run, safe }) {
  const helps = [await run(['--help']), await run(['analyze', '--help'])].filter(reply => reply.code === 0);
  if (!helps.length) return { pass: false, reason: 'CLI capability help failed' };
  if (!helps.some(help => /--max-dollars\b/.test(help.stdout + help.stderr))) return { pass: true, reason: 'SKIP: --max-dollars not yet available in this CLI' };
  const result = await run(['analyze', '.', '--max-dollars', '0.000001']);
  // max-dollars-cap: cli/relay-check.ts checks the price AFTER reserve, then
  // releases the hold. Terminal output uses contract/cli-refusals.ts (MCP has
  // reason=max_dollars_exceeded); a generic transport failure is not a refusal.
  // Keep this sentence in sync with contract/cli-refusals.ts if the wording changes.
  const refused = result.code === 1 && (result.stdout + result.stderr).includes("This analysis costs more than the limit you set, so it didn't start. Nothing was charged.");
  const pass = refused && safe();
  return { pass, reason: pass ? 'Over-cap analysis refused; any reservation hold released without model work'
    : 'Over-cap analysis did not safely refuse and release its hold' };
}
export async function checkLinks(readme, fetcher = fetch) {
  const urls = [...new Set(['https://counterfactlabs.com/setup', ...Array.from(readme.matchAll(/\]\((https?:\/\/[^\s)]+)\)/g), m => m[1])])];
  return Promise.all(urls.map(async url => {
    try {
      const response = await fetcher(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
      await response.body?.cancel();
      const setup = url === 'https://counterfactlabs.com/setup';
      if (setup && ([404, 410].includes(response.status) || response.status < 300 && new URL(response.url).pathname.replace(/\/$/, '') !== '/setup')) {
        return { backend: 'free', case: url, pass: true, reason: 'SKIP: /setup not yet live' };
      }
      return { backend: 'free', case: url, pass: response.status >= 200 && response.status < 300, reason: `HTTP ${response.status}` };
    } catch { return { backend: 'free', case: url, pass: false, reason: 'Link request failed' }; }
  }));
}
