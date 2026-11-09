import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('README leaves skipped-files charges to the console top-up screen', () => {
  const text = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /skipped-files plan|charged separately/);
  assert.match(text, /When you ask for an analysis, Claude runs it; a new workspace's first analysis is free, and later analyses are charged to your balance\. If your balance doesn't cover it, Claude shows a link to top up; prices are on the top-up page\./);
});

test('the skill does not instruct Claude to disclose skipped-files charges', () => {
  const text = readFileSync(new URL('../skills/counterfact/SKILL.md', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /charged separately|skipped-files plan/);
  assert.match(text, /Each call runs one analysis, using the free first analysis when available and otherwise charging the user's balance/);
  assert.match(text, /don't ask them to approve a price first/);
  assert.match(text, /If the balance doesn't cover it, show the returned message, which includes the top-up link/);
});

test('finding 13 records Arya withdrawing plugin charge wording in favor of the console top-up screen', () => {
  const text = readFileSync(new URL('../docs/approvals-2026-10-29-consent.md', import.meta.url), 'utf8');
  const finding = text.split('## Finding 13: skipped-files charges')[1]?.split('\n## ')[0] ?? '';
  assert.match(finding, /Withdrawn by Arya on October 29, 2026\./);
  assert.match(finding, /console's top-up screen/);
  assert.doesNotMatch(finding, /pending|Recommended|Alternative/);
});

test('README preserves the approved plugin release wording from #15 and links to the Codex setup page', () => {
  const text = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(text, /\(an exact version, updated when the plugin adopts a new CLI release\)/);
  assert.match(text, /The plugin version also advances for skill changes without changing the CLI pin, so `claude plugin update counterfact@counterfact-labs` picks up those releases\./);
  assert.match(text, /See the \[command-line package\]\(https:\/\/www\.npmjs\.com\/package\/@counterfact-labs\/cli\) for commands and privacy details, and the \[Counterfact setup page\]\(https:\/\/counterfactlabs\.com\/setup\) for Codex setup\./);
});

test('the consent decisions do not duplicate the plugin release approval from #15', () => {
  const text = readFileSync(new URL('../docs/approvals-2026-10-29-consent.md', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /Plugin-only release wording|plugin-only release wording|pending/);
});
