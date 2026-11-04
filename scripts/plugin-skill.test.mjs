import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const costQuestionRouting = 'For a cost question with unknown sign-in state, call `sign_in_status` first without `path` or `wait`. If signed out, or if that call fails, give the before-sign-in explanation below as general pricing; on failure also show the returned message. Call `get_balance` only when signed in, and do not start sign-in or an analysis just to answer a cost question.';
const beforeSignInPricing = 'Before sign-in, say: "The first analysis on a new workspace is free; later analyses are charged to your balance, with prices on the top-up page." Never describe the cost as only "it costs money".';
const balancePolicy = 'After sign-in and before each analysis or any statement about cost, call `get_balance` and describe the cost from its result. If `freeAnalysisAvailable` is true or the result text says "Your first analysis is free.", say: "This analysis is free." Otherwise, show the returned balance and top-up link, and say: "This analysis is charged to your balance; prices are on the top-up page." If `get_balance` fails for a signed-in user, show the returned message and do not guess the cost. Also use `get_balance` when the user asks about their balance or needs a top-up link.';

function files(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

test('plugin instructions have no references to the retired analyze skill', () => {
  for (const path of [...files(join(root, 'skills')), ...files(join(root, 'commands'))]) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /counterfact-analyze/, path);
  }
});

test('/counterfact:counterfact resolves directly to the full workflow in one skill', () => {
  const manifest = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8'));
  const [namespace, command] = '/counterfact:counterfact'.slice(1).split(':');
  assert.equal(manifest.name, namespace);
  const path = join(root, 'skills', command, 'SKILL.md');
  assert.ok(existsSync(path), 'the namespaced skill must exist');
  assert.equal(existsSync(join(root, 'commands', command + '.md')), false, 'one owner must carry the workflow');
  const text = readFileSync(path, 'utf8');
  assert.match(text, /^name: counterfact$/m);
  assert.match(text, /^argument-hint: \[agent-folder\]$/m);
  const [, opening, body] = text.split(/^---\n[\s\S]*?\n---\n\n([^\n]+)\n\n/);
  assert.equal(opening, 'When the user runs `/counterfact:counterfact`, analyze the agent in `$ARGUMENTS`, or in the current folder when no path is supplied, starting with sign-in.');
  // Normalize pricing and authentication routing so the remaining analysis workflow stays pinned.
  const originalWorkflow = body.replace(costQuestionRouting + '\n\n', '')
    .replace(beforeSignInPricing + '\n\n', '')
    .replace('After sign-in, call `get_balance` and describe the cost from its result as below, then call `waiting_fixes` if available.', 'After sign-in, call `waiting_fixes` if available.')
    .replace("Each call runs one analysis, using the free first analysis when available and otherwise charging the user's balance, so call it only when the user has asked, and don't ask them to approve a price first.", "Each call runs one analysis and charges the user's balance at the listed price, so call it only when the user has asked, and don't ask them to approve a price first.")
    .replace(balancePolicy, 'Use `get_balance` when the user asks about their balance or needs a top-up link.');
  assert.equal(createHash('sha256').update(originalWorkflow).digest('hex'),
    'c3b0298e80f08aa3620b9334476f0b166ab2c4b07616a54de46dc6af32ddf0ba');
});

test('the skill requires get_balance after sign-in before analysis or describing cost', () => {
  const text = readFileSync(join(root, 'skills/counterfact/SKILL.md'), 'utf8');
  assert.ok(text.includes(balancePolicy), 'cost statements must use the returned free availability, balance and top-up link');
  const balanceStep = text.indexOf('2. After sign-in, call `get_balance`');
  assert.ok(balanceStep > text.indexOf('1. Inspect the available Counterfact tool schemas.'));
  assert.ok(balanceStep < text.indexOf('5. When the user asks for an analysis'));
  assert.doesNotMatch(text, /Each call runs one analysis and charges the user's balance at the listed price/);
});

test('the skill explains free availability before sign-in without a price approval prompt', () => {
  const text = readFileSync(join(root, 'skills/counterfact/SKILL.md'), 'utf8');
  assert.ok(text.includes(beforeSignInPricing));
  assert.match(text, /don't ask them to approve a price first/);
  assert.match(text, /Never call a preview tool for a price or pass `confirm`/);
});

test('a cost question checks unknown sign-in state before any account-specific balance read', () => {
  const text = readFileSync(join(root, 'skills/counterfact/SKILL.md'), 'utf8');
  assert.ok(text.includes(costQuestionRouting), 'cost questions need their own sign-in status route');
  assert.ok(text.indexOf(costQuestionRouting) < text.indexOf('When the user asks for an analysis:'));
});

test('free eligibility can come from the balance text when the structured flag is absent', () => {
  const text = readFileSync(join(root, 'skills/counterfact/SKILL.md'), 'utf8');
  assert.match(text, /If `freeAnalysisAvailable` is true or the result text says "Your first analysis is free\.", say: "This analysis is free\."/);
});

test('a balance failure limits cost claims for signed-in users without blocking a requested analysis', () => {
  const text = readFileSync(join(root, 'skills/counterfact/SKILL.md'), 'utf8');
  assert.match(text, /If `get_balance` fails for a signed-in user, show the returned message and do not guess the cost\./);
  assert.doesNotMatch(text, /If `get_balance` fails[^\n]*or start an analysis/);
});
