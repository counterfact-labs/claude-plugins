import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// These content contracts pin Arya's approved October 29, 2026 privacy wording.
for (const path of ['README.md', 'skills/counterfact/SKILL.md']) {
  test(`${path} includes imported project files in the disclosed scope`, () => {
    const text = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.match(text, /Only the agent files you choose, and the project files they import, are sent\. Secret and ignored files are skipped\./);
    assert.doesNotMatch(text, /Only agent files from the folder you choose are sent/);
  });

  test(`${path} names the Counterfact web console as the destination`, () => {
    const text = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.match(text, /Your sign-in token, repository facts, file names and sizes, and findings with code quotes are sent to the Counterfact web console\./);
    assert.doesNotMatch(text, /sent to your console/);
  });
}

test('the skill attributes the notice without claiming a verbatim CLI quote', () => {
  const text = readFileSync(new URL('../skills/counterfact/SKILL.md', import.meta.url), 'utf8');
  assert.match(text, /first state Counterfact's privacy notice: "Counterfact says:/);
  assert.doesNotMatch(text, /verbatim/i);
});

test('finding 27 records Arya approving the privacy notice on October 29, 2026', () => {
  const text = readFileSync(new URL('../docs/approvals-2026-10-29-consent.md', import.meta.url), 'utf8');
  const finding = text.split('## Finding 27: privacy notice')[1] ?? '';
  assert.match(finding, /Approved by Arya on October 29, 2026\./);
  assert.doesNotMatch(finding, /pending|No wording in this document is approved yet/);
});
