import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// README contracts preserve the approved scope; the skill notice is a new proposal.
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('README includes imported project files in the disclosed scope', () => {
  assert.match(readme, /Only the agent files you choose, and the project files they import, are sent\. Secret and ignored files are skipped\./);
  assert.doesNotMatch(readme, /Only agent files from the folder you choose are sent/);
});

test('README names the Counterfact web console as the destination', () => {
  assert.match(readme, /Your sign-in token, repository facts, file names and sizes, and findings with code quotes are sent to the Counterfact web console\./);
  assert.doesNotMatch(readme, /sent to your console/);
});

test('the skill explains sharing in three sentences before either sign-in flow regardless of tool permission', () => {
  const text = readFileSync(new URL('../skills/counterfact/SKILL.md', import.meta.url), 'utf8');
  const notice = text.match(/Before starting sign-in or the first analysis in a conversation, say: "([^"]+)"/)?.[1] ?? '';
  assert.equal(notice.split('.').filter(sentence => sentence.trim()).length, 3);
  assert.match(notice, /An analysis may send the contents of the agent files you choose, the project files they import, and repository-wide files the analysis can read, encrypted to Counterfact's sealed relay/);
  assert.match(notice, /Your sign-in token, repository facts, file names and sizes, and findings with code quotes are sent to the Counterfact web console/);
  assert.match(notice, /Secret and ignored files are skipped/);
  assert.ok(text.indexOf('Before starting sign-in or the first analysis in a conversation, say:') < text.indexOf('1. Inspect the available Counterfact tool schemas.'));
  assert.match(text, /regardless of `analyzeToolAllowed`/);
  assert.doesNotMatch(notice, /zero data retention|stores nothing/i);
});

test('finding 27 records Arya approving the privacy notice on October 29, 2026', () => {
  const text = readFileSync(new URL('../docs/approvals-2026-10-29-consent.md', import.meta.url), 'utf8');
  const finding = text.split('## Finding 27: privacy notice')[1] ?? '';
  assert.match(finding, /Approved by Arya on October 29, 2026\./);
  assert.doesNotMatch(finding, /pending|No wording in this document is approved yet/);
});

test('already signed-in users receive the notice before the first analysis', () => {
  const text = readFileSync(new URL('../skills/counterfact/SKILL.md', import.meta.url), 'utf8');
  assert.match(text, /Before starting sign-in or the first analysis in a conversation, say:/);
  assert.match(text, /even when already signed in, regardless of `analyzeToolAllowed`/);
});
