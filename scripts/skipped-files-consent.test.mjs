import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('README limits the skipped-files plan explanation to files too large to read', () => {
  const text = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(text, /Each analysis in a skipped-files plan \(groups of files an earlier analysis left out because they were too large to read\) is charged separately\./);
});

test('the skill tells Claude when to disclose skipped-files charges to the user', () => {
  const text = readFileSync(new URL('../skills/counterfact-analyze/SKILL.md', import.meta.url), 'utf8');
  assert.match(text, /If `analyze_skipped_files` proposes a plan, tell the user that each analysis in the plan is charged separately to their balance\./);
  assert.doesNotMatch(text, /Each analysis in a skipped-files plan is charged separately to your balance\./);
});

test('pending charge disclosures require confirmation of unverified server billing before shipping', () => {
  const text = readFileSync(new URL('../docs/approvals-2026-10-29-consent.md', import.meta.url), 'utf8');
  const finding = text.split('## Finding 13: skipped-files charges')[1]?.split('\n## ')[0] ?? '';
  assert.match(finding, /The per-group charge is decided on the server and is unverified/);
  assert.match(finding, /audit finding 11 \/ REPORT\.md:96/);
  assert.match(finding, /Confirm the server's per-group charging behavior before either the README or skill charge disclosure ships\./);
});
