// Test-only wire fixtures, following counterfact-local contract/console.ts
// localFindingsPayloadSchema and analysis-core contracts/intake-finding.ts.
export function uploadFinding(path, line, otherSites = []) {
  return {
    kind: 'safety', severity: 'high', title: 'Fictional unsafe operation',
    cause: 'The fictional operation bypasses a required guard.', summary: null,
    category: null, question: null, siteRepo: 'local:fictional-warehouse',
    site: { path, line }, excerpt: 'Fictional source evidence', otherSites,
    fixes: [{ title: 'Add the guard', approach: 'Validate the request before acting.', kind: 'code',
      targetFiles: [{ path, create: false }], expectedOutcome: 'The operation requires validation.',
      summary: null, impact: null, confidence: null, objective: null, status: null,
      blockedBy: null, alsoFixes: [], delta: null }],
  };
}
export function uploadPayload(findings) {
  return {
    reservationId: '00000000-0000-4000-8000-000000000001',
    checkId: '00000000-0000-4000-8000-000000000002',
    projectId: '00000000-0000-4000-8000-000000000003',
    agent: { repository: 'local:fictional-warehouse', commit: null,
      files: [{ path: 'system_prompt.md', hash: 'a'.repeat(64) },
        { path: 'tools.json', hash: 'b'.repeat(64) }, { path: 'tools.js', hash: 'c'.repeat(64) }] },
    bundleVersion: 'test', relayVersion: 'test', counterfactLocalVersion: '0.2.9', findings,
  };
}
