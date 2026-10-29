import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { consoleOrigin } from './live-agent-bridge.mjs';

const bridge = process.env.LIVE_AGENT_BRIDGE;
const token = process.env.LIVE_AGENT_TOKEN;
if (!bridge || !token) throw new Error('Live transport is missing');
const credential = join(process.env.HOME, '.config/counterfact-labs/credentials');
const open = fs.open;
// Published CLI versions read this exact file through fs/promises.open. Nothing
// is created on disk, and the sentinel cannot authenticate outside the bridge.
fs.open = async function (path, ...args) {
  if (String(path) === credential) return {
    readFile: async () => JSON.stringify({ baseUrl: consoleOrigin, token: 'live-agent-memory-sign-in' }),
    close: async () => {},
  };
  return open.call(this, path, ...args);
};
const request = https.request;
https.request = function (input, options, callback) {
  const url = typeof input === 'string' || input instanceof URL ? new URL(input) : null;
  if (!url || url.origin !== consoleOrigin || !url.pathname.startsWith('/api/cli/')) return request.apply(this, arguments);
  if (typeof options === 'function') { callback = options; options = {}; }
  return http.request(new URL('/console' + url.pathname + url.search, bridge), {
    ...options, headers: { ...options?.headers, 'x-live-agent-token': token },
  }, callback);
};
const fetcher = globalThis.fetch;
globalThis.fetch = function (input, options = {}) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.origin !== consoleOrigin || !url.pathname.startsWith('/api/cli/')) return fetcher(input, options);
  const headers = new Headers(options.headers); headers.set('x-live-agent-token', token);
  return fetcher(new URL('/console' + url.pathname + url.search, bridge), { ...options, headers });
};
syncBuiltinESMExports();
