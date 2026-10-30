// Published CLI refusal contracts; never accept a generic tool error.
export const credentialRefusalMessage = "Counterfact couldn't find an agent prompt in this folder. Pass a folder containing an agent prompt or a model call with a system prompt.";
export const credentialProposalRefusalMessage = "The proposed agent files couldn't be used, because a path is outside the folder or isn't a file Counterfact can read.";

// Expectations stay outside the copied agents: coding agents never see the answers.
export const cases = [
  { id: 'clean', directory: 'live-agent', files: ['system_prompt.md'], sources: [] },
  { id: 'planted-authority', directory: 'live-agent-authority', files: ['system_prompt.md'], sources: [['system_prompt.md', 6]] },
  { id: 'planted-credential', directory: 'live-agent-credential', files: ['system_prompt.md'], expect: 'refused', sources: [] },
  { id: 'tools-agent', directory: 'live-agent-tools', files: ['system_prompt.md', 'tools.json', 'tools.js'], sources: [['tools.json', 5], ['tools.js', 3]] },
];
function cites(finding, path, line) {
  // Real upload: counterfact-local contract/console.ts localFindingsPayloadSchema
  // -> analysis-core contracts/intake-finding.ts intakeFinding: site {path,line}
  // and otherSites [{repo,path,line,excerpt}]. codeQuotes is not a wire field.
  const sites = [finding.site, ...(finding.otherSites ?? [])].filter(Boolean);
  return sites.some(site => {
    const start = site.line ?? site.startLine, end = site.endLine ?? start;
    return site.path?.replace(/^\.\//, '') === path && Number.isSafeInteger(start) && Number.isSafeInteger(end) && start > 0 && start <= line && end >= line && end >= start;
  });
}
export function assertCase(id, { findings = [], coverageSupported = false, coverage, text = '', credentialRefused = false }) {
  const spec = cases.find(c => c.id === id);
  if (!spec) throw Error(`Unknown case: ${id}`);
  if (spec.expect === 'refused') {
    if (!credentialRefused) throw Error(`${id}: expected refusal before reservation`);
    return { reason: 'Credential-containing prompt refused before reservation; charged $0.00' };
  }
  const missing = spec.sources.filter(([path, line]) => !findings.some(f => cites(f, path, line)));
  if (missing.length) throw Error(`${id}: no finding cited ${missing.map(([path, line]) => `${path}:${line}`).join(', ')}`);
  if (id !== 'clean') return { reason: 'Planted sources cited: ' + spec.sources.map(s => s.join(':')).join(', ') };
  const statement = /(?:^|\n)\s*(?:#+\s*)?(?:what (?:was|we) checked|checked|coverage|analysis scope)(?::|\r?\n)\s*([\s\S]+)/i.exec(text);
  // empty-result-coverage-cli: cli/analysis-coverage.ts AnalysisCoverage is
  // {filesAnalyzed: number, filesSkipped?: number}; it reports files, not checks.
  const reported = value => value && Number.isSafeInteger(value.filesAnalyzed) && value.filesAnalyzed >= 0 &&
    (value.filesSkipped === undefined || Number.isSafeInteger(value.filesSkipped) && value.filesSkipped >= 0);
  const present = Boolean(statement?.[1].trim()) || reported(coverage);
  if (coverageSupported && !present) throw Error('clean: CLI reports coverage support but the result has no coverage statement');
  return { reason: present ? 'Analysis completed; coverage present' : 'Analysis completed; coverage not yet available in this CLI' };
}
