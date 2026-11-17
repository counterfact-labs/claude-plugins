import { pathToFileURL } from 'node:url';

const title = 'Live agent check failed';

export async function updateLiveIssue({ request, repository, poll, live, analysis, completedAt, rows = [] }) {
  // Input comes exclusively from the harness's redacted row export, never logs.
  const safe = Array.isArray(rows) ? rows.filter(row => typeof row === 'string' &&
    /^(PASS|FAIL) (Claude|Codex|Free) \| [^\r\n]+ \| [^\r\n]+$/.test(row)) : [];
  const failed = poll === 'failure' || live === 'failure';
  const passed = poll === 'success' && live === 'success' && analysis === 'success' &&
    safe.length > 0 && safe.every(row => row.startsWith('PASS '));
  if (!failed && !passed) return;

  const base = `/repos/${repository}/issues`;
  const open = [];
  for (let page = 1; ; page++) {
    const issues = await request('GET', `${base}?state=open&per_page=100&page=${page}`);
    open.push(...issues.filter(issue => issue.title === title && !issue.pull_request));
    if (issues.length < 100) break;
  }
  if (failed) {
    const failing = safe.filter(row => row.startsWith('FAIL '));
    if (poll === 'failure') failing.push('FAIL Poll | workflow | Release identity poll failed; inspect the workflow run');
    else if (!failing.length) failing.push('FAIL Live | workflow | Live analysis job failed; inspect the workflow run');
    const body = failing.join('\n');
    if (open.length) await request('POST', `${base}/${open[0].number}/comments`, { body });
    else await request('POST', base, { title, body });
  } else {
    for (const issue of open) {
      // Alerts are serialized, but a recovery can wait for a runner while a newer
      // failure is reported. Never let that older check resolve the new incident.
      if (!(Date.parse(issue.updated_at) <= Date.parse(completedAt))) continue;
      await request('POST', `${base}/${issue.number}/comments`, { body: safe.join('\n') });
      await request('PATCH', `${base}/${issue.number}`, { state: 'closed', state_reason: 'completed' });
    }
  }
}

async function main() {
  const request = async (method, path, body) => {
    const response = await fetch(`https://api.github.com${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json',
        'content-type': 'application/json', 'x-github-api-version': '2022-11-28' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw Error(`GitHub issue request failed (HTTP ${response.status})`);
    return response.json();
  };
  await updateLiveIssue({ request, repository: process.env.GITHUB_REPOSITORY, poll: process.env.POLL_RESULT,
    live: process.env.LIVE_RESULT, analysis: process.env.ANALYSIS_OUTCOME, completedAt: process.env.CHECK_COMPLETED_AT,
    rows: JSON.parse(process.env.LIVE_AGENT_ROWS || '[]') });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Live agent issue reporting failed'); process.exitCode = 1; });
}
