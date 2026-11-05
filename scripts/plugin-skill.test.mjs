import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const costQuestionRouting = 'For a cost question with unknown sign-in state, call `sign_in_status` first without `path` or `wait`. If signed out, or if that call fails, give the before-sign-in pricing sentence below as general pricing; on failure also show the returned message. Call `get_balance` only when signed in, and do not start sign-in or an analysis just to answer a cost question.';
const beforeSignInPricing = 'Before sign-in, say: "The first analysis on a new workspace is free; later analyses are charged to your balance, with prices on the top-up page." Never describe the cost as only "it costs money".';
const balancePolicy = 'After sign-in and before each analysis, call `get_balance`. When `preview_analysis` is available, use its result for the files that may be sent, whether this analysis is free, and the balance. If `cost.free` is true, say: "This analysis is free." Show `cost.balanceUsd` when present, otherwise the balance from `get_balance`, and the returned top-up link. If `cost.free` is false, say: "This analysis is charged to your balance; prices are on the top-up page." For cost questions without a preview, or when `preview_analysis` is unavailable, describe the cost from `get_balance` as follows. If `freeAnalysisAvailable` is true or the result text says "Your first analysis is free.", say: "This analysis is free." Otherwise, show the returned balance and top-up link, and say: "This analysis is charged to your balance; prices are on the top-up page." If `get_balance` fails for a signed-in user, show the returned message and do not guess the cost. Also use `get_balance` when the user asks about their balance or needs a top-up link.';

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
  assert.match(opening, /privacy explanation below before sign-in/);
  // Pin the full workflow so unrelated authentication instructions cannot drift.
  assert.equal(createHash('sha256').update(body).digest('hex'),
    'fc20136c120e49f58ff46c5ef2bd1aa20ee438dbf9e6357c0c14a9101a17c9f7');
  assert.match(body, /Pass `proposal` with `agentName` and `files`/);
  assert.match(body, /Never run `counterfact-labs` or `npx @counterfact-labs\/cli` in the shell/);
  assert.match(body, /then list every returned finding as the tool's text lists it, keeping its order and group headings/);
  assert.match(body, /Only after showing the full list, offer to fix the most serious finding/);
});

test('the skill requires get_balance after sign-in before analysis or describing cost', () => {
  const text = readFileSync(join(root, 'skills/counterfact/SKILL.md'), 'utf8');
  assert.ok(text.includes(balancePolicy), 'cost statements must use the returned free availability, balance and top-up link');
  const balanceStep = text.indexOf('2. After sign-in, call `get_balance`');
  assert.ok(balanceStep > text.indexOf('1. Inspect the available Counterfact tool schemas.'));
  assert.ok(balanceStep < text.indexOf('4. Before every analysis'));
  assert.doesNotMatch(text, /Each call runs one analysis and charges the user's balance at the listed price/);
});

test('the skill explains free availability before sign-in without a price approval prompt', () => {
  const text = readFileSync(join(root, 'skills/counterfact/SKILL.md'), 'utf8');
  assert.ok(text.includes(beforeSignInPricing));
  assert.match(text, /don't ask them to approve a price first/);
  assert.match(text, /Never pass `confirm` or a price-approval flag/);
  assert.doesNotMatch(text, /without asking for approval of the list|Never call a preview tool/);
});

test('every analysis previews its selection and waits for file-sharing consent, including retries', () => {
  const text = readFileSync(join(root, 'skills/counterfact/SKILL.md'), 'utf8');
  const preview = text.split('\n4. ')[1]?.split('\n5. ')[0] ?? '';
  const consent = text.split('\n5. ')[1]?.split('\n6. ')[0] ?? '';
  assert.match(preview, /Before every analysis/);
  assert.match(preview, /call `preview_analysis`/);
  assert.match(preview, /same selection and proposal/);
  assert.match(preview, /available tool schema/);
  assert.match(consent, /full file list returned by `preview_analysis`/);
  assert.match(consent, /whether the analysis is free and the balance/);
  assert.match(consent, /labeled "Files that may be sent:"/);
  assert.match(consent, /including imported and repository-wide files/);
  assert.match(consent, /analysis may send a subset/);
  assert.match(consent, /Label preview `bytes` as "File size \(bytes\)"/);
  assert.match(consent, /ask: "Send these files for analysis\?"/i);
  assert.match(consent, /Wait for an explicit yes before calling `analyze_agent`/);
  assert.match(consent, /every analysis, including retries/);
  assert.match(consent, /If the user declines or hasn't answered, do not call `analyze_agent`/);
  assert.match(consent, /repeat steps 4 and 5/);
});

test('older CLIs disclose a proposed list and balance, while preview errors stop the upload', () => {
  const text = readFileSync(join(root, 'skills/counterfact/SKILL.md'), 'utf8');
  assert.match(text, /If `preview_analysis` is unavailable[^\n]*proposal's file list[^\n]*proposed[^\n]*balance/);
  assert.match(text, /if `preview_analysis` fails, show the returned message and stop/);
  assert.match(text, /Do not treat a failed preview as an unavailable tool/);
});

test('results disclose the returned files and never substitute the proposed list for missing evidence', () => {
  const text = readFileSync(join(root, 'skills/counterfact/SKILL.md'), 'utf8');
  const results = text.split('\n6. ')[1]?.split('\n7. ')[0] ?? '';
  assert.match(results, /list of files sent from the `analyze_agent` result/);
  assert.match(results, /Files sent:/);
  assert.match(results, /If an older CLI omits the list/);
  assert.match(results, /Never present the proposal or preview as proof of what was sent/);
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

// These positions come from the shipped instructions, not an authored replay.
test('the skill orders disclosure, sign-in, balance, preview, file display, consent and upload', () => {
  const text = readFileSync(join(root, 'skills/counterfact/SKILL.md'), 'utf8');
  const instructions = [
    'Before starting sign-in or the first analysis in a conversation, say:',
    '1. Inspect the available Counterfact tool schemas.',
    'call `sign_in`',
    '2. After sign-in, call `get_balance`',
    'call `preview_analysis`',
    "5. Show the agent's name and the full file list",
    'Ask: "Send these proposed files, any project files they import, and repository-wide files the analysis can read, for analysis?"',
    'ask: "Send these files for analysis?"',
    'Wait for an explicit yes before calling `analyze_agent`',
  ];
  const positions = instructions.map(instruction => {
    const position = text.indexOf(instruction);
    assert.ok(position >= 0, 'missing instruction: ' + instruction);
    return position;
  });
  for (let i = 1; i < positions.length; i++) {
    assert.ok(positions[i - 1] < positions[i], instructions[i - 1] + ' must precede ' + instructions[i]);
  }
});

test('the preview contract names every agreed field and shows notices', () => {
  const text = readFileSync(join(root, 'skills/counterfact/SKILL.md'), 'utf8');
  const preview = text.split('\n4. ')[1]?.split('\n5. ')[0] ?? '';
  for (const field of ['files', 'path', 'bytes', 'role', 'totalBytes', 'cost', 'free', 'balanceUsd', 'notices']) {
    assert.ok(preview.includes('`' + field + '`'), 'missing preview field: ' + field);
  }
  assert.match(preview, /uploads nothing and reserves nothing/);
  assert.match(text, /Show any `notices` returned by the preview/);
  assert.match(text, /`files` from the `analyze_agent` result/);
});

test('fallback consent includes imports and repository-wide files', () => {
  const text = readFileSync(join(root, 'skills/counterfact/SKILL.md'), 'utf8');
  assert.match(text, /Ask: "Send these proposed files, any project files they import, and repository-wide files the analysis can read, for analysis\?"/);
});

test('a paid preview uses the balance sentence without claiming free eligibility', () => {
  const text = readFileSync(join(root, 'skills/counterfact/SKILL.md'), 'utf8');
  assert.match(text, /If `cost.free` is false, say: "This analysis is charged to your balance; prices are on the top-up page\."/);
  assert.match(text, /Do not infer a price from the balance/);
});

test('option A uses free status and balance without estimate handling', () => {
  const text = readFileSync(join(root, 'skills/counterfact/SKILL.md'), 'utf8');
  assert.ok(text.includes('If `cost.free` is true, say: "This analysis is free."'));
  assert.match(text, /Show `cost.balanceUsd` when present, otherwise the balance from `get_balance`, and the returned top-up link/);
  assert.doesNotMatch(text, /estimateUsd|Estimated cost:|estimated cost/);
});

test('candidate-folder clarification precedes the generic preview failure stop', () => {
  const text = readFileSync(join(root, 'skills/counterfact/SKILL.md'), 'utf8');
  const consent = text.split('\n5. ')[1]?.split('\n6. ')[0] ?? '';
  const folder = consent.indexOf('If a preview or analysis returns candidate folders, first ask');
  const stop = consent.indexOf('if `preview_analysis` fails, show the returned message and stop');
  assert.ok(folder >= 0 && stop > folder, 'candidate folders must be handled before generic preview failures');
  assert.match(consent.slice(folder, stop), /repeat steps 4 and 5/);
});

test('sent-file disclosure applies before choices and refusals on every analysis return', () => {
  const text = readFileSync(join(root, 'skills/counterfact/SKILL.md'), 'utf8');
  const consent = text.split('\n5. ')[1]?.split('\n6. ')[0] ?? '';
  const results = text.split('\n6. ')[1]?.split('\n7. ')[0] ?? '';
  assert.match(consent, /Apply step 6 before handling candidate folders or refusals from `analyze_agent`/);
  assert.doesNotMatch(consent, /On every `analyze_agent` return/);
  assert.match(results, /On every `analyze_agent` return that includes `files`/);
  assert.match(results, /including refusals and agent-choice or scope-choice results/);
  assert.match(results, /Label result `bytes` as "Bytes sent"/);
});

test('coding-agent instructions are excluded only from the proposal, not the may-send list', () => {
  const text = readFileSync(join(root, 'skills/counterfact/SKILL.md'), 'utf8');
  assert.match(text, /Treat `CLAUDE.md`, `AGENTS.md`, and similar files[^.]*leave them out of the proposal's file list/);
});


test('a sign-in notice takes precedence over the preview free flag and consent', () => {
  const text = readFileSync(join(root, 'skills/counterfact/SKILL.md'), 'utf8');
  const consent = text.split('\n5. ')[1]?.split('\n6. ')[0] ?? '';
  assert.match(consent, /If a preview notice asks the user to sign in, show that notice and repeat step 1 before stating free or paid status or asking for file consent/);
  assert.match(consent, /after sign-in, repeat steps 4 and 5/);
});
