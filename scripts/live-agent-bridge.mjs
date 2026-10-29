import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

export const consoleOrigin = 'https://app.counterfactlabs.com';

const fixedEndpoints = new Map([
  ['/api/cli/checks', '/api/cli/checks'], ['/api/cli/checks/mode', '/api/cli/checks/mode'],
  ['/api/cli/checks/local', '/api/cli/checks/local'], ['/api/cli/relay-reservations', '/api/cli/relay-reservations'],
  ['/api/cli/balance', '/api/cli/balance'], ['/api/cli/fix-requests', '/api/cli/fix-requests'],
]);
export function consoleUrl(path) {
  const [route, query = ''] = String(path).split('?', 2);
  let endpoint = fixedEndpoints.get(route);
  const finding = /^\/api\/cli\/findings\/([\w-]+)$/.exec(route);
  if (!endpoint && finding) endpoint = '/api/cli/findings/' + encodeURIComponent(finding[1]);
  if (!endpoint || (query && route !== '/api/cli/fix-requests')) throw new Error('Unexpected console endpoint');
  const search = new URLSearchParams();
  for (const [name, value] of new URLSearchParams(query)) search.append(name, value);
  const text = search.toString();
  return consoleOrigin + endpoint + (text ? '?' + text : '');
}

// The account key lives only here. MCP gets a sentinel credential; this transport
// attaches the real bearer token only to the production console's HTTPS requests.
export async function startBridge({ key, budget, folder }) {
  const token = randomBytes(32).toString('hex');
  const failure = new AbortController();
  const pendingRequests = new Set();
  const state = { attempts: 0, servers: [], results: [], receipts: [], reservations: new Map(), failures: [] };
  const fail = message => {
    state.failures.push(message);
    failure.abort(new Error(message));
    return new Error(message);
  };
  const upstream = async (path, method, body, headers = {}) => {
    // Only known console API endpoints may carry the account key. The URL is rebuilt
    // from constants plus encoded segments, so no caller value reaches it verbatim.
    const response = await fetch(consoleUrl(path), {
      method, headers: { ...headers, authorization: `Bearer ${key}` },
      ...(method === 'GET' ? {} : { body }), redirect: 'error', signal: AbortSignal.timeout(20_000),
    });
    const text = (await response.text()).replaceAll(key, '[redacted]');
    if (text.length > 3 * 1024 * 1024) throw fail('Console response too large');
    return { status: response.status, text, value: JSON.parse(text) };
  };
  async function release(id) {
    try {
      const result = await upstream('/api/cli/relay-reservations', 'POST',
        JSON.stringify({ action: 'fail', reservationId: id }), { 'content-type': 'application/json' });
      if (result.status >= 300 || !['released', 'unheld'].includes(result.value.settlement)) {
        throw Error('Release refused');
      }
      state.reservations.delete(id);
    } catch {
      // Network errors and timeouts must be recorded without provider details.
      throw fail('Could not release refused reservation hold');
    }
  }
  const handleRequest = async (request, response) => {
    const reply = (status, value) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
    try {
      if (request.headers['x-live-agent-token'] !== token) { reply(403, { error: 'Forbidden' }); return; }
      let text = '';
      for await (const chunk of request) { text += chunk; if (text.length > 3 * 1024 * 1024) throw fail('Request too large'); }
      const body = text ? JSON.parse(text) : {};
      if (request.url === '/begin') {
        state.attempts++;
        if (state.attempts !== 1 || typeof body.path !== 'string' || resolve(folder, body.path) !== folder || body.paths) {
          throw fail('Only one analysis of the copied agent is allowed');
        }
        reply(200, {}); return;
      }
      if (request.url === '/event') {
        if (body.kind === 'initialize') state.servers.push(body.result?.serverInfo);
        else if (body.kind === 'analysis') state.results.push(body.result);
        else throw fail(body.message || 'MCP protocol failed');
        reply(200, {}); return;
      }
      const path = request.url?.slice('/console'.length);
      if (!request.url?.startsWith('/console/api/cli/') || !/^\/api\/cli\/(checks(?:\/mode|\/local)?|relay-reservations|balance|findings\/[\w-]+|fix-requests(?:\?.*)?)$/.test(path)) {
        throw fail('Unexpected console endpoint');
      }
      if (path === '/api/cli/relay-reservations' && body.action === 'reserve' &&
          (state.attempts !== 1 || state.reservations.size)) throw fail('Unexpected additional reservation');
      const headers = {};
      for (const [name, value] of Object.entries(request.headers)) {
        if (!['host', 'connection', 'content-length', 'authorization', 'x-live-agent-token'].includes(name)) headers[name] = value;
      }
      const result = await upstream(path, request.method, text, headers);
      if (path === '/api/cli/relay-reservations' && body.action === 'reserve' && result.status < 300) {
        const { priceMicro, reservationId } = result.value;
        // Reserve places a hold. Withhold its relay capability until the price
        // passes; releasing a refusal happens before the CLI can call a model.
        const valid = result.value.state === 'reserved' && result.value.settlement === 'held' &&
          typeof reservationId === 'string' && reservationId === body.reservationId && Number.isSafeInteger(priceMicro) && priceMicro >= 0;
        if (!valid || budget.used + priceMicro > budget.cap) {
          // Recording a failure stops the agent and starts bridge cleanup.
          // Finish releasing its hold before that cleanup can write the report.
          await release(body.reservationId);
          fail(!valid ? 'Analysis estimate/price is missing or invalid' : 'Total analysis estimate exceeds the cap');
          reply(403, { code: 'not_allowed', error: state.failures[0] }); return;
        }
        budget.used += priceMicro;
        state.reservations.set(reservationId, { priceMicro, projectId: result.value.projectId });
      }
      if (path === '/api/cli/checks/local' && result.status < 300) {
        const reservation = state.reservations.get(body.reservationId);
        const receipt = result.value;
        if (!reservation || receipt.projectId !== body.projectId || receipt.projectId !== reservation.projectId || receipt.checkId !== body.checkId ||
            typeof receipt.analysisId !== 'string' || !Array.isArray(receipt.findingIds)) throw fail('Invalid console upload receipt');
        state.receipts.push({ analysisId: receipt.analysisId, projectId: receipt.projectId,
          priceMicro: reservation.priceMicro, chargedMicro: receipt.settlement === 'charged' ? reservation.priceMicro : undefined });
        state.reservations.delete(body.reservationId);
      }
      response.writeHead(result.status, { 'content-type': 'application/json' }); response.end(result.text);
    } catch (error) {
      // Do not echo network/provider errors, which can contain credentials.
      if (!state.failures.length) fail('Live transport or protocol failed');
      if (!response.headersSent) reply(502, { error: 'Live transport or protocol failed' });
      else response.destroy();
    }
  };
  const server = createServer((request, response) => {
    const pending = handleRequest(request, response);
    pendingRequests.add(pending);
    const complete = () => pendingRequests.delete(pending);
    pending.then(complete, complete);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    state, signal: failure.signal, url: `http://127.0.0.1:${server.address().port}`, token,
    async close() {
      // Stop new requests, then drain existing ones: a late reserve response
      // may still need to release a hold before the report reads failures.
      const closed = new Promise(resolve => server.close(resolve));
      await Promise.allSettled(pendingRequests);
      for (const id of state.reservations.keys()) { try { await release(id); } catch { /* Failure is retained in state. */ } }
      server.closeAllConnections();
      await closed;
    },
  };
}
