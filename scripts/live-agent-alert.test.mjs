import assert from 'node:assert/strict';
import test from 'node:test';

const title = 'Live agent check failed';
const failure = 'FAIL Claude | clean | Production release refuses this CLI/plugin (release_unavailable)';
const pass = 'PASS Claude | clean | Analysis completed';
const completedAt = '2026-11-17T12:00:00.000Z';

async function fixture(open = []) {
  const { updateLiveIssue } = await import('./live-agent-alert.mjs');
  const calls = [];
  const request = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET') return open;
    return { number: 9 };
  };
  return { calls, run: overrides => updateLiveIssue({ request, repository: 'owner/plugins', poll: 'success',
    live: 'failure', analysis: 'failure', completedAt, rows: [failure], ...overrides }) };
}

test('first live failure opens an issue containing only failing report rows', async () => {
  const f = await fixture();
  await f.run({ rows: [pass, failure, 'private file contents', '     https://private.invalid/token', 'FAIL forged\nprivate-token'] });
  assert.deepEqual(f.calls, [
    { method: 'GET', path: '/repos/owner/plugins/issues?state=open&per_page=100&page=1', body: undefined },
    { method: 'POST', path: '/repos/owner/plugins/issues', body: { title, body: failure } },
  ]);
});

test('repeated failure comments on the exact open issue and ignores PRs and other titles', async () => {
  const f = await fixture([{ number: 1, title: 'Other issue' }, { number: 2, title, pull_request: {} }, { number: 3, title }]);
  await f.run();
  assert.deepEqual(f.calls.at(-1), { method: 'POST', path: '/repos/owner/plugins/issues/3/comments', body: { body: failure } });
  assert.equal(f.calls.length, 2);
});

test('poll and setup failures create safe fallback rows without reading logs', async () => {
  for (const overrides of [{ poll: 'failure', live: 'skipped', rows: [] }, { analysis: 'skipped', rows: [] }, { rows: [pass] }]) {
    const f = await fixture();
    await f.run(overrides);
    assert.equal(f.calls.at(-1).body.title, title);
    assert.match(f.calls.at(-1).body.body, /^FAIL (Poll|Live) \| workflow \| .+$/);
  }
});

test('a fully passing suite comments with passing rows and closes open incidents', async () => {
  const f = await fixture([{ number: 3, title, updated_at: '2026-11-17T11:50:00Z' }, { number: 4, title, updated_at: '2026-11-17T11:59:00Z' }]);
  await f.run({ live: 'success', analysis: 'success', rows: [pass, 'raw output must not be posted'] });
  assert.deepEqual(f.calls.slice(1), [3, 4].flatMap(number => [
    { method: 'POST', path: `/repos/owner/plugins/issues/${number}/comments`, body: { body: pass } },
    { method: 'PATCH', path: `/repos/owner/plugins/issues/${number}`, body: { state: 'closed', state_reason: 'completed' } },
  ]));
});

test('skipped, cancelled, incomplete, contradictory and unchanged runs never close an issue', async () => {
  for (const overrides of [
    { live: 'skipped', analysis: 'skipped' }, { live: 'cancelled', analysis: 'cancelled' },
    { live: 'success', analysis: 'skipped' }, { live: 'success', analysis: 'success', rows: [] },
    { live: 'success', analysis: 'success', rows: [failure] },
  ]) {
    const f = await fixture([{ number: 3, title }]);
    await f.run(overrides);
    assert.ok(f.calls.every(call => call.method !== 'PATCH'));
  }
});

test('a passing suite without an incident creates no issue', async () => {
  const f = await fixture();
  await f.run({ live: 'success', analysis: 'success', rows: [pass] });
  assert.ok(f.calls.every(call => call.method === 'GET'));
});

test('a delayed recovery cannot close an incident updated after the passing check finished', async () => {
  for (const [finished, updated] of [[completedAt, '2026-11-17T12:01:00Z'], [undefined, '2026-11-17T11:59:00Z'], [completedAt, undefined]]) {
    const f = await fixture([{ number: 3, title, updated_at: updated }]);
    await f.run({ live: 'success', analysis: 'success', rows: [pass], completedAt: finished });
    assert.ok(f.calls.every(call => call.method === 'GET'));
  }
});

test('issue lookup paginates and API failures propagate', async () => {
  const { updateLiveIssue } = await import('./live-agent-alert.mjs');
  const calls = [];
  await updateLiveIssue({ repository: 'owner/plugins', poll: 'failure', live: 'skipped', rows: [], request: async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET') return path.endsWith('page=1') ? Array.from({ length: 100 }, () => ({ title: 'Other issue' })) : [{ number: 42, title }];
    return {};
  } });
  assert.equal(calls[1].path, '/repos/owner/plugins/issues?state=open&per_page=100&page=2');
  assert.equal(calls[2].path, '/repos/owner/plugins/issues/42/comments');
  await assert.rejects(updateLiveIssue({ repository: 'owner/plugins', poll: 'failure', rows: [], request: async () => { throw Error('API unavailable'); } }), /API unavailable/);
});
