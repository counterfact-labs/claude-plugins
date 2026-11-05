import assert from 'node:assert/strict';
import { Transform } from 'node:stream';

// JSON-RPC stays on an in-memory stream so a missing fake can never reach a network.
// Preview and sent-file payloads follow the shared lane interface.
export function fakeMcp({ previewAvailable = true, free = true, textOnly = false,
  previewError = false, expiredPreview = false, resultFiles = true, signedIn = false, resultKind = 'findings' } = {}) {
  const calls = [];
  const tools = ['sign_in_status', 'sign_in', 'sign_in_with_code', 'get_balance',
    ...(previewAvailable ? ['preview_analysis'] : []), 'analyze_agent'];
  const server = new Transform({
    transform(chunk, _encoding, done) {
      try {
        const request = JSON.parse(chunk.toString());
        let result;
        if (request.method === 'tools/list') {
          result = { tools: tools.map(name => ({ name, inputSchema: {
            type: 'object', properties: name === 'sign_in'
              ? { email: { type: 'string' } }
              : name === 'sign_in_with_code' ? { email: { type: 'string' }, code: { type: 'string' } }
                : { path: { type: 'string' }, proposal: { type: 'object' } },
          } })) };
        } else {
          assert.equal(request.method, 'tools/call');
          const { name, arguments: args } = request.params;
          assert.ok(tools.includes(name), 'tool must be advertised');
          calls.push({ name, args });
          let text;
          let payload;
          if (name === 'sign_in_status') {
            text = signedIn ? 'Signed in.' : 'Not signed in.';
            payload = { signedIn, analyzeToolAllowed: true };
          } else if (name === 'sign_in') {
            assert.equal(args.email, 'agent@example.test');
            text = 'Enter the code from your email.';
          } else if (name === 'sign_in_with_code') {
            assert.deepEqual(args, { email: 'agent@example.test', code: 'fictional-code' });
            signedIn = true;
            text = 'Signed in.';
          } else {
            assert.ok(signedIn, 'account tools require sign-in');
            if (name === 'get_balance') text = 'Balance: $12\n' + (free ? 'Your first analysis is free.\n' : '') + 'Top up: https://console.example.test/account#balance';
            else if (name === 'preview_analysis') {
              payload = {
                files: [{ path: 'prompt.md', bytes: 16, role: 'prompt' },
                  { path: 'lib/runtime.ts', bytes: 32, role: 'model-calling code' },
                  { path: 'AGENTS.md', bytes: 24, role: 'other' }],
                totalBytes: 72,
                cost: /** @type {{ free: boolean, balanceUsd?: number }} */ ({ free, balanceUsd: 12 }),
                notices: ['Fictional preview notice.'],
              };
              if (expiredPreview) {
                expiredPreview = false;
                signedIn = false;
                payload.cost = { free: false };
                payload.notices.push('Sign in to see whether a free analysis is available and your balance.');
              }
              text = previewError ? 'Fictional preview unavailable.' : JSON.stringify(payload);
              if (previewError) payload = undefined;
            } else {
              payload = resultFiles ? { files: [{ path: 'prompt.md', bytes: 16, role: 'prompt' },
                { path: 'lib/runtime.ts', bytes: 24, role: 'model-calling code' }] } : {};
              payload = { ...payload, kind: resultKind };
              text = resultKind === 'findings' ? 'Full results: https://console.example.test/projects/fictional/findings\nNo findings.'
                : resultKind === 'refused' ? 'Fictional analysis refused.' : 'Choose a fictional agent folder.';
            }
          }
          const structured = { ...payload, text };
          // Text-only consumers receive the same contract fields as JSON, not an invented prose preview.
          const contentText = textOnly && payload ? JSON.stringify(structured) : text;
          result = { content: [{ type: 'text', text: contentText }], isError: name === 'preview_analysis' && previewError || name === 'analyze_agent' && resultKind === 'refused',
            ...(!textOnly ? { structuredContent: structured } : {}) };
        }
        done(null, JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
      } catch (error) { done(error); }
    },
  });
  let id = 0;
  const rpc = async (method, params) => {
    const response = new Promise((resolve, reject) => {
      server.once('data', chunk => resolve(JSON.parse(chunk.toString())));
      server.once('error', reject);
    });
    server.write(JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) + '\n');
    const envelope = await response;
    assert.equal(envelope.id, id);
    assert.equal(envelope.error, undefined);
    server.removeAllListeners('error');
    return envelope.result;
  };
  return { calls, rpc, close: () => server.destroy() };
}
