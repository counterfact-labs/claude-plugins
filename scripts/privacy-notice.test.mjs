import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// These content contracts pin the audit's consent wording pending approval.
for (const path of ['README.md', 'skills/counterfact-analyze/SKILL.md']) {
  test(`${path} includes imported project files in the disclosed scope`, () => {
    const text = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.match(text, /Only the agent files you choose, and the project files they import, are sent\./);
    assert.doesNotMatch(text, /Only agent files from the folder you choose are sent/);
  });

  test(`${path} names the Counterfact web console as the destination`, () => {
    const text = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.match(text, /Your sign-in token, repository facts, file names and sizes, and findings with code quotes are sent to the Counterfact web console\./);
    assert.doesNotMatch(text, /sent to your console/);
  });
}

test('the skill attributes the notice without claiming a verbatim CLI quote', () => {
  const text = readFileSync(new URL('../skills/counterfact-analyze/SKILL.md', import.meta.url), 'utf8');
  assert.match(text, /first state Counterfact's privacy notice: "Counterfact says:/);
  assert.doesNotMatch(text, /verbatim/i);
});
