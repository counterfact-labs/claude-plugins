import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fakeMcp } from './helpers/consent-mcp.mjs';

const skill = readFileSync(new URL('../../skills/counterfact/SKILL.md', import.meta.url), 'utf8');
const selection = { path: './fictional-agent', proposal: { agentName: 'Fictional agent', files: [
  { path: 'prompt.md', role: 'prompt' },
] } };
const toolText = result => result.content.map(item => item.text ?? '').join('\n');
const data = result => result.structuredContent ?? JSON.parse(toolText(result));

// Offline contract replay only: scripted replies do not demonstrate live model
// compliance. Ordering is checked against SKILL.md itself before replaying turns.
function instructions() {
  const noticeLead = 'Before starting sign-in or the first analysis in a conversation, say:';
  const order = [noticeLead, '1. Inspect the available Counterfact tool schemas.', 'call `sign_in`',
    '2. After sign-in, call `get_balance`', 'call `preview_analysis`',
    "5. Show the agent's name and the full file list",
    'Ask: "Send these proposed files', 'ask: "Send these files for analysis?"',
    'Wait for an explicit yes before calling `analyze_agent`'];
  let previous = -1;
  for (const phrase of order) {
    const position = skill.indexOf(phrase);
    assert.ok(position > previous, 'missing or out-of-order instruction: ' + phrase);
    previous = position;
  }
  const notice = skill.match(/Before starting sign-in or the first analysis in a conversation, say: "([^"]+)"/)?.[1];
  const preview = skill.split('\n4. ')[1]?.split('\n5. ')[0] ?? '';
  const consent = skill.split('\n5. ')[1]?.split('\n6. ')[0] ?? '';
  const results = skill.split('\n6. ')[1]?.split('\n7. ')[0] ?? '';
  for (const field of ['files', 'path', 'bytes', 'role', 'totalBytes', 'cost', 'free', 'balanceUsd', 'notices']) {
    assert.ok(preview.includes('`' + field + '`'), 'preview contract must name ' + field);
  }
  assert.match(consent, /Show any `notices` returned by the preview/);
  assert.match(consent, /labeled "Files that may be sent:"/);
  assert.match(consent, /including imported and repository-wide files/);
  assert.match(consent, /analysis may send a subset/);
  assert.doesNotMatch(skill, /estimateUsd|Estimated cost:|estimated cost/);
  assert.match(consent, /If the user declines or hasn't answered, do not call `analyze_agent`/);
  assert.match(consent, /every analysis, including retries/);
  assert.match(consent, /repeat steps 4 and 5/);
  assert.match(results, /`files` from the `analyze_agent` result/);
  return {
    notice, consent, results,
    subset: consent.match(/Say: "(The analysis may send a subset of this list\.)"/)?.[1],
    question: consent.match(/ask: "(Send these files for analysis\?)"/)?.[1],
    fallbackQuestion: consent.match(/Ask: "(Send these proposed files[^"\n]+\?)"/)?.[1],
  };
}

async function conversation(t, options = {}, answers = ['yes']) {
  const contract = instructions();
  const server = fakeMcp(options);
  t.after(server.close);
  const transcript = [];
  /** @param {{ text?: string, tool?: string, input?: object }} step */
  const turn = async ({ text, tool, input }) => {
    if (text) transcript.push({ role: 'assistant', text });
    if (!tool) return;
    transcript.push({ role: 'tool-call', name: tool, args: input });
    const result = await server.rpc('tools/call', { name: tool, arguments: input });
    transcript.push({ role: 'tool-result', name: tool, result });
    return result;
  };
  const user = text => transcript.push({ role: 'user', text });
  const { tools } = await server.rpc('tools/list');
  user('Analyze ./fictional-agent');
  await turn({ text: contract.notice });
  const signIn = async () => {
    await turn({ text: 'What email address would you like to use to sign in to Counterfact?' });
    user('agent@example.test');
    await turn({ tool: 'sign_in', input: { email: 'agent@example.test' } });
    await turn({ text: 'Enter the code from your email.' });
    user('fictional-code');
    await turn({ tool: 'sign_in_with_code', input: { email: 'agent@example.test', code: 'fictional-code' } });
    await turn({ tool: 'sign_in_status', input: { path: selection.path } });
  };
  const status = data(await turn({ tool: 'sign_in_status', input: { path: selection.path } }));
  if (!status.signedIn) await signIn();
  else assert.match(skill, /even when already signed in, regardless of `analyzeToolAllowed`/);
  for (const [run, answer] of answers.entries()) {
    if (run > 0) user('Analyze again');
    const balance = await turn({ tool: 'get_balance', input: {} });
    const hasPreview = tools.some(tool => tool.name === 'preview_analysis');
    if (hasPreview) {
      let result = await turn({ tool: 'preview_analysis', input: selection });
      if (!result.isError && data(result).notices.includes('Sign in to see whether a free analysis is available and your balance.')) {
        assert.match(contract.consent, /If a preview notice asks the user to sign in, show that notice and repeat step 1 before stating free or paid status or asking for file consent/);
        assert.match(contract.consent, /after sign-in, repeat steps 4 and 5/);
        await turn({ text: data(result).notices.join('\n') });
        await turn({ tool: 'sign_in_status', input: { path: selection.path } });
        await signIn();
        await turn({ tool: 'get_balance', input: {} });
        result = await turn({ tool: 'preview_analysis', input: selection });
      }
      if (result.isError) {
        assert.match(contract.consent, /if `preview_analysis` fails, show the returned message and stop/);
        await turn({ text: toolText(result) });
        break;
      }
      const preview = data(result);
      assert.equal(preview.totalBytes, 72);
      assert.deepEqual(preview.files, [{ path: 'prompt.md', bytes: 16, role: 'prompt' },
        { path: 'lib/runtime.ts', bytes: 32, role: 'model-calling code' },
        { path: 'AGENTS.md', bytes: 24, role: 'other' }]);
      const cost = skill.match(preview.cost.free ? /If `cost.free` is true, say: "([^"]+)"/ : /If `cost.free` is false, say: "([^"]+)"/)?.[1];
      assert.ok(cost, 'preview cost wording must be specified by the skill');
      assert.match(skill, /Show `cost.balanceUsd` when present, otherwise the balance from `get_balance`, and the returned top-up link/);
      const label = contract.consent.match(/labeled "([^"]+)"/)?.[1];
      const sizeLabel = contract.consent.match(/Label preview `bytes` as "([^"]+)"/)?.[1];
      assert.ok(sizeLabel, 'preview sizes must be distinguished from bytes sent');
      await turn({ text: selection.proposal.agentName + '\n' + label + '\n' + preview.files.map(file => '- ' + file.path + ' (' + sizeLabel + ': ' + file.bytes + ')').join('\n')
        + '\n' + contract.subset + '\n' + cost + '\nBalance: $' + preview.cost.balanceUsd + '\n' + toolText(balance).split('\n').at(-1) + '\n' + preview.notices.join('\n') });
    } else {
      assert.match(contract.consent, /If `preview_analysis` is unavailable/);
      assert.ok(contract.fallbackQuestion, 'fallback consent must include imports');
      await turn({ text: 'Proposed files:\n' + selection.proposal.files.map(file => '- ' + file.path).join('\n') + '\n' + toolText(balance) });
    }
    await turn({ text: hasPreview ? contract.question : contract.fallbackQuestion });
    if (answer === undefined) break;
    user(answer);
    if (answer !== 'yes') break;
    const result = await turn({ tool: 'analyze_agent', input: selection });
    const sent = data(result).files;
    if (sent) {
      assert.match(contract.results, /On every `analyze_agent` return that includes `files`/);
      const label = contract.results.match(/Label result `bytes` as "([^"]+)"/)?.[1];
      assert.ok(label, 'results must distinguish actual bytes sent');
      await turn({ text: 'Files sent:\n' + sent.map(file => '- ' + file.path + ' (' + label + ': ' + file.bytes + ')').join('\n') });
    }
    else {
      const missing = contract.results.match(/say: "([^"]+)"/)?.[1];
      assert.ok(missing, 'missing upload evidence must be disclosed');
      await turn({ text: missing });
    }
    await turn({ text: toolText(result) });
    if (data(result).kind !== 'findings') break;
  }
  return { transcript, calls: server.calls };
}

for (const free of [true, false]) for (const textOnly of [true, false]) {
  test(`contract replay: sign-in, preview, consent, analysis (${free ? 'free' : 'paid'}, ${textOnly ? 'JSON text' : 'structured'})`, async t => {
    const { transcript, calls } = await conversation(t, { free, textOnly });
    assert.deepEqual(calls.map(call => call.name), ['sign_in_status', 'sign_in', 'sign_in_with_code',
      'sign_in_status', 'get_balance', 'preview_analysis', 'analyze_agent']);
    assert.deepEqual(calls.at(-1).args, calls.at(-2).args);
    const shown = transcript.find(event => event.role === 'assistant' && event.text.startsWith('Fictional agent\n'));
    assert.match(shown.text, /Files that may be sent:\n- prompt.md \(File size \(bytes\): 16\)\n- lib\/runtime.ts \(File size \(bytes\): 32\)\n- AGENTS.md/);
    assert.match(shown.text, free ? /This analysis is free\./ : /This analysis is charged to your balance; prices are on the top-up page\./);
    assert.match(shown.text, /The analysis may send a subset of this list\./);
    assert.match(shown.text, /Balance: \$12/);
    assert.match(shown.text, /https:\/\/console.example.test\/account#balance/);
    assert.doesNotMatch(shown.text, /Estimated cost:/);
    assert.match(shown.text, /Fictional preview notice\./);
    assert.equal(transcript.at(-2).text, 'Files sent:\n- prompt.md (Bytes sent: 16)\n- lib/runtime.ts (Bytes sent: 24)');
    const preview = data(transcript.find(event => event.role === 'tool-result' && event.name === 'preview_analysis').result);
    const sent = data(transcript.find(event => event.role === 'tool-result' && event.name === 'analyze_agent').result).files;
    assert.ok(sent.length < preview.files.length, 'the fixture must exercise a strict subset');
    for (const file of sent) assert.ok(preview.files.some(candidate => candidate.path === file.path && candidate.role === file.role), 'sent file must have been previewed: ' + file.path);
    assert.doesNotMatch(transcript.at(-2).text, /AGENTS.md/);
    const question = transcript.findIndex(event => event.text === 'Send these files for analysis?');
    const upload = transcript.findIndex(event => event.role === 'tool-call' && event.name === 'analyze_agent');
    assert.ok(transcript.indexOf(shown) < question && question < upload);
    assert.deepEqual(transcript[question + 1], { role: 'user', text: 'yes' });
    assert.match(transcript.at(-1).text, /https:\/\/console.example.test\/projects\/fictional\/findings/);
    assert.equal(calls.some(call => Object.hasOwn(call.args, 'confirm')), false);
  });
}

test('contract replay: older CLI asks consent for proposals, imports and repository-wide files', async t => {
  const { transcript, calls } = await conversation(t, { previewAvailable: false, free: false });
  assert.deepEqual(calls.slice(-2).map(call => call.name), ['get_balance', 'analyze_agent']);
  const shown = transcript.findIndex(event => event.role === 'assistant' && event.text.startsWith('Proposed files:'));
  assert.match(transcript[shown].text, /- prompt.md\nBalance: \$12/);
  assert.match(transcript[shown].text, /https:\/\/console.example.test\/account#balance/);
  assert.equal(transcript[shown + 1].text, 'Send these proposed files, any project files they import, and repository-wide files the analysis can read, for analysis?');
});

test('contract replay: already signed-in user receives the notice without signing in again', async t => {
  const { transcript, calls } = await conversation(t, { signedIn: true });
  assert.deepEqual(calls.map(call => call.name), ['sign_in_status', 'get_balance', 'preview_analysis', 'analyze_agent']);
  assert.match(transcript[1].text, /An analysis may send the contents of the agent files you choose, the project files they import, and repository-wide files the analysis can read, encrypted to Counterfact's sealed relay\./);
  assert.match(transcript[1].text, /Secret and ignored files are skipped/);
});

for (const answer of ['no', undefined]) test(`contract replay: no upload when consent is ${String(answer)}`, async t => {
  const { calls } = await conversation(t, {}, [answer]);
  assert.equal(calls.at(-1).name, 'preview_analysis');
  assert.equal(calls.some(call => call.name === 'analyze_agent'), false);
});

test('contract replay: preview failure is shown without fallback upload', async t => {
  const { transcript, calls } = await conversation(t, { previewError: true });
  assert.equal(transcript.at(-1).text, 'Fictional preview unavailable.');
  assert.equal(calls.at(-1).name, 'preview_analysis');
});

test('contract replay: each analysis needs a new preview and consent', async t => {
  const { transcript, calls } = await conversation(t, {}, ['yes', 'yes']);
  assert.deepEqual(calls.slice(-6).map(call => call.name), ['get_balance', 'preview_analysis', 'analyze_agent',
    'get_balance', 'preview_analysis', 'analyze_agent']);
  assert.equal(transcript.filter(event => event.text === 'Send these files for analysis?').length, 2);
});

test('contract replay: older result without files discloses missing evidence', async t => {
  const { transcript } = await conversation(t, { resultFiles: false });
  assert.equal(transcript.at(-2).text, 'The analysis result did not include a list of files sent.');
  assert.doesNotMatch(transcript.at(-1).text, /Files sent:|prompt.md|runtime.ts/);
});

for (const resultKind of ['refused', 'choose_agent', 'choose_scope']) {
  test(`contract replay: sent files precede ${resultKind} handling`, async t => {
    const { transcript, calls } = await conversation(t, { resultKind });
    assert.equal(calls.at(-1).name, 'analyze_agent');
    assert.equal(transcript.at(-2).text, 'Files sent:\n- prompt.md (Bytes sent: 16)\n- lib/runtime.ts (Bytes sent: 24)');
    assert.equal(transcript.at(-1).text, resultKind === 'refused' ? 'Fictional analysis refused.' : 'Choose a fictional agent folder.');
  });
}


for (const textOnly of [false, true]) test(`contract replay: expired sign-in refreshes eligibility before cost or consent (${textOnly ? 'JSON text' : 'structured'})`, async t => {
  const { transcript, calls } = await conversation(t, { signedIn: true, expiredPreview: true, textOnly });
  const notice = transcript.findIndex(event => event.role === 'assistant' && event.text.includes('Sign in to see whether a free analysis is available and your balance.'));
  assert.ok(notice >= 0, 'show the returned sign-in notice');
  assert.deepEqual(calls.map(call => call.name), ['sign_in_status', 'get_balance', 'preview_analysis',
    'sign_in_status', 'sign_in', 'sign_in_with_code', 'sign_in_status', 'get_balance', 'preview_analysis', 'analyze_agent']);
  const refresh = transcript.findIndex((event, index) => index > notice && event.role === 'tool-result' && event.name === 'preview_analysis');
  assert.ok(refresh > notice);
  for (const event of transcript.slice(notice, refresh)) {
    if (event.role === 'assistant') assert.doesNotMatch(event.text, /This analysis is free|This analysis is charged|Send these files/);
  }
  const shown = transcript.find(event => event.role === 'assistant' && event.text.startsWith('Fictional agent\n'));
  assert.match(shown.text, /This analysis is free\./);
  assert.doesNotMatch(transcript.filter(event => event.role === 'assistant').map(event => event.text).join('\n'), /This analysis is charged/);
});
