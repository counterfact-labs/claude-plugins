import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Scripted instruction check: no model compliance or live conversation is inferred.
function assertSignedOutPricingReply(text) {
  assert.ok(/\bfirst analysis on a new workspace is free\b/i.test(text) &&
    /\blater analyses are charged to your balance\b/i.test(text) &&
    /\bprices (?:are )?on the top-up page\b/i.test(text),
  'Signed-out pricing must explain the free first analysis, later balance charges, and prices on the top-up page.');
}

test('the prescribed signed-out pricing reply explains the free first analysis and later charges', () => {
  const skill = readFileSync(new URL('../skills/counterfact/SKILL.md', import.meta.url), 'utf8');
  const answer = skill.match(/Before sign-in, say: "([^"]+)"/)?.[1] ?? '';
  assertSignedOutPricingReply(answer);
});

for (const answer of [
  'It costs money. Each run is charged to your Counterfact balance.',
  'Signing in is free, no card. Analyses are charged to your balance.',
  'The first analysis on a new workspace is free.',
  'Every analysis is free; prices are on the top-up page.',
]) {
  test('signed-out pricing evaluation rejects an incomplete answer: ' + answer, () => {
    assert.throws(() => assertSignedOutPricingReply(answer), /signed-out pricing/i);
  });
}
