import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { cliPin } from './plugin-release.mjs';

const root = process.argv[2] ?? fileURLToPath(new URL('../', import.meta.url));
const timeoutMs = Number(process.argv[3] ?? 120_000);

function skillTools(directory, tools = new Set()) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) skillTools(path, tools);
    else if (entry.name === 'SKILL.md') {
      // Skills name tools as backticked snake_case identifiers, including Claude's qualified names.
      for (const [, reference] of readFileSync(path, 'utf8').matchAll(/`([a-z][a-z0-9_]*_[a-z0-9_]+)`/g)) {
        tools.add(reference.replace(/^mcp__plugin_counterfact_counterfact__/, ''));
      }
    }
  }
  return tools;
}

async function main() {
  const { command, args, version } = cliPin(root);
  const required = skillTools(join(root, 'skills'));
  if (!required.size) throw new Error('No required tool names found in skills.');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid smoke timeout.');

  // A process group lets cleanup terminate both npx and its spawned MCP server on CI's Linux runner.
  const grouped = process.platform !== 'win32';
  const child = spawn(command, args, {
    cwd: root, detached: grouped, stdio: ['pipe', 'pipe', 'inherit'],
  });
  const pending = new Map();
  let nextId = 0;
  let rejectRun;
  const failed = new Promise((_, reject) => { rejectRun = reject; });
  const timer = setTimeout(() => rejectRun(new Error(`MCP smoke timed out after ${timeoutMs}ms.`)), timeoutMs);
  child.on('error', rejectRun);
  child.stdin.on('error', rejectRun);
  child.on('exit', (code, signal) => rejectRun(new Error(`MCP exited (${signal ?? code}) before smoke completed.`)));
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    try {
      const message = JSON.parse(line);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(`MCP RPC error: ${message.error.message}`));
      else request.resolve(message.result);
    } catch (error) {
      rejectRun(new Error(`Invalid MCP JSON: ${error.message}`));
    }
  });
  const send = (message) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    send({ id, method, params });
  });
  try {
    await Promise.race([failed, (async () => {
      const initialized = await request('initialize', {
        protocolVersion: '2024-11-05', capabilities: {},
        clientInfo: { name: 'plugin-ci-smoke', version: '1.0.0' },
      });
      if (initialized?.serverInfo?.version !== version) {
        throw new Error(`MCP server version ${initialized?.serverInfo?.version} must equal CLI pin ${version}.`);
      }
      send({ method: 'notifications/initialized' });
      const available = new Set();
      const cursors = new Set();
      let cursor;
      do {
        const page = await request('tools/list', cursor ? { cursor } : {});
        if (!Array.isArray(page?.tools)) throw new Error('Invalid tools/list response.');
        for (const tool of page.tools) available.add(tool.name);
        cursor = page.nextCursor;
        if (cursor && cursors.has(cursor)) throw new Error('Repeated tools/list cursor.');
        cursors.add(cursor);
      } while (cursor);
      const missing = [...required].filter((name) => !available.has(name));
      if (missing.length) throw new Error(`Missing required MCP tools: ${missing.join(', ')}.`);
      console.log(`CLI ${version} starts and lists all ${required.size} required tools.`);
    })()]);
  } finally {
    clearTimeout(timer);
    lines.close();
    child.stdin.destroy();
    try {
      if (grouped && child.pid) process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
