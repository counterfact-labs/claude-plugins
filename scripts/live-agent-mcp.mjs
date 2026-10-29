import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
if (args.length !== 3 || args[0] !== '-y' || !/^@counterfact-labs\/cli@(?:latest|\d+\.\d+\.\d+)$/.test(args[1]) || args[2] !== 'mcp') {
  console.error('Only the published Counterfact MCP server may use this adapter'); process.exit(1);
}
const event = async (path, body) => {
  const response = await fetch(process.env.LIVE_AGENT_BRIDGE + path, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-live-agent-token': process.env.LIVE_AGENT_TOKEN },
    body: JSON.stringify(body), signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error('Live MCP guard refused the request');
};
const preload = pathToFileURL(fileURLToPath(new URL('./live-agent-preload.mjs', import.meta.url))).href;
const child = spawn(process.env.LIVE_AGENT_REAL_NPX, args, {
  env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${preload}` }, stdio: ['pipe', 'pipe', 'pipe'],
});
const pending = new Map();
let inputQueue = Promise.resolve(), outputQueue = Promise.resolve(), failed = false;
const failure = async reason => {
  if (failed) return;
  failed = true;
  input.close();
  process.stdin.pause();
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 500);
  timer.unref();
  const message = typeof reason === 'string' ? reason : 'MCP server or protocol failed';
  try { await event('/event', { kind: 'failure', message }); } catch { /* Parent also requires evidence. */ }
};
child.on('error', failure); child.stdin.on('error', failure);
// Provider stderr is intentionally discarded: the final report uses validated
// facts, and an unexpected dependency must not persist account credentials.
child.stderr.resume();
const input = createInterface({ input: process.stdin });
input.on('line', line => {
  inputQueue = inputQueue.then(async () => {
    let message, refusal;
    try {
      message = JSON.parse(line);
      if (failed) throw new Error('MCP adapter stopped');
      if (message.method === 'tools/call') {
        if (message.params?.name === 'analyze_agent') {
          await event('/begin', message.params.arguments ?? {});
        } else if (!['sign_in_status', 'get_balance', 'get_finding', 'waiting_fixes'].includes(message.params?.name)) {
          const name = message.params?.name;
          refusal = `Refused MCP tool: ${typeof name === 'string' ? name.slice(0, 80) : '(missing name)'}`;
          throw new Error('Unexpected tool');
        }
      }
      if (message.id !== undefined) pending.set(message.id, message);
      child.stdin.write(line + '\n');
    } catch {
      // A refused request still needs a reply, even as the server shuts down.
      if (message?.id !== undefined) process.stdout.write(JSON.stringify({
        jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'Live MCP guard refused the request' },
      }) + '\n');
      await failure(refusal);
    }
  }).catch(failure);
}).on('close', () => { inputQueue.then(() => child.stdin.end()); });
createInterface({ input: child.stdout }).on('line', line => {
  outputQueue = outputQueue.then(async () => {
    const message = JSON.parse(line), request = pending.get(message.id);
    if (request?.method === 'initialize') await event('/event', { kind: 'initialize', result: message.result });
    if (request?.method === 'tools/call' && request.params?.name === 'analyze_agent') {
      await event('/event', { kind: 'analysis', result: message.result });
    }
    pending.delete(message.id); process.stdout.write(line + '\n');
  }).catch(failure);
});
child.on('close', async code => {
  input.close();
  process.stdin.pause();
  await inputQueue;
  await outputQueue;
  process.exitCode = failed ? 1 : code ?? 1;
});
