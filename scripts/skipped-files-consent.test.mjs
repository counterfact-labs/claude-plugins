import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('README leaves skipped-files charges to the console top-up screen', () => {
  const text = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /skipped-files plan|charged separately/);
  assert.match(text, /When you ask for an analysis, Claude runs it and charges your balance\. If your balance doesn't cover it, Claude shows a link to top up; prices are on the top-up page\./);
});

test('the skill does not instruct Claude to disclose skipped-files charges', () => {
  const text = readFileSync(new URL('../skills/counterfact-analyze/SKILL.md', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /charged separately|skipped-files plan/);
  assert.equal(text.split('\n').find((line) => line.startsWith('5. ')), "5. When the user asks for an analysis, show the agent's name and file list in a few lines, then call `analyze_agent` without asking for approval of the list, using `path` for one selected agent file or folder, or `paths` for several selected agent files, according to the available tool schema; use the agent's folder as `path` when the schema supports only folders. Pass `proposal` with `agentName` and `files`, giving each file a `path` relative to the selected folder for folder inputs or to the launch folder for file inputs, and a `role` of `prompt`, `tools`, `model-calling code`, `config`, or `other`. Counterfact treats the proposal as a strong hint and still checks every file. Each call runs one analysis and charges the user's balance at the listed price, so call it only when the user has asked, and don't ask them to approve a price first. Never call a preview tool for a price or pass `confirm`. If the balance doesn't cover it, show the returned message, which includes the top-up link. If the tool cannot tell which folder holds the agent, ask the user which of the returned candidate folders holds it, then call `analyze_agent` again with their answer as `path`, making the proposal's paths relative to that folder and leaving out files outside it.");
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
