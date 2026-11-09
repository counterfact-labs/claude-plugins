# Consent wording audit

Prepared for Arya on November 5, 2026. Arya approved the exact repository and agent-folder metadata sentence (item 2) on November 5, 2026. Other new wording below remains a proposal.
The skill owns the live instructions. This audit records their verbatim before/after text for review.
The approved metadata sentence has been applied in README.md and skills/counterfact/SKILL.md. The website setup prompt has not been changed.
Plugin 0.2.15 remains pinned to CLI 0.2.9.

## Approved wording and text for Arya's approval

New or changed user-facing text in skills/counterfact/SKILL.md (item 2 approved by Arya on November 5, 2026; other changes remain proposals):

1. "An analysis may send the contents of the agent files you choose, the project files they import, and repository-wide files the analysis can read, encrypted to Counterfact's sealed relay."
2. "Your sign-in token; your repository's remote address, branch and commit; the agent folder's name and path within the repository, and whether it has uncommitted changes; file names and sizes; and findings with code quotes are sent to the Counterfact web console."
3. "Secret and ignored files are skipped."
4. "Files that may be sent:"
5. "File size (bytes)"
6. "Bytes sent"
7. "Proposed files:"
8. "Send these proposed files, any project files they import, and repository-wide files the analysis can read, for analysis?"
9. "Send these files for analysis?"
10. "Files sent:"
11. "The analysis result did not include a list of files sent."
12. "This analysis is free." (existing sentence, now also specified for free previews)
13. "The analysis may send a subset of this list."

The balance sentence remains unchanged. A paid preview reuses:
"This analysis is charged to your balance; prices are on the top-up page."
A sign-in preview reuses the CLI notice: "Sign in to see whether a free analysis is available and your balance."

Preview notices, free status and balance are returned by the tool. Option A provides no estimate. Preview notices are shown as returned. No price-approval prompt is introduced.

Existing CLI preview notice relevant to the pending file-hash question, not added to the skill:

```text
Counterfact also receives the names, sizes, and hashes of other files in the folder listing, without their contents.
```

Optional fallback-question replacement, not applied. The current question remains item 8 above and in skill passage 3. Proposed wording:

```text
Send these proposed files, any project files they import, and repository-wide files the analysis can read?
```

If Arya chooses this wording, update the skill, tests, workflow hash, and verbatim audit passages together.

Removed notice (previously gated on missing tool permission):

```text
Counterfact says: The analysis runs on your computer. Model requests go encrypted to Counterfact's sealed relay, which we can't read into. Your sign-in token; your repository's remote address, branch and commit; the agent folder's name and path within the repository, and whether it has uncommitted changes; file names and sizes; and findings with code quotes are sent to the Counterfact web console. Only the agent files you choose, and the project files they import, are sent. Secret and ignored files are skipped.
```

Proposed README scope replacement, not applied. In the permission setup step, replace:

```text
Only the agent files you choose, and the project files they import, are sent.
```

with:

```text
An analysis may send the agent files you choose, the project files they import, and repository-wide files the analysis can read.
```

The current sentence was approved by Arya on October 29, 2026. Leave it and its pinned test in scripts/privacy-notice.test.mjs unchanged until she decides. Keep the following sentence, "Secret and ignored files are skipped." This scope replacement is separate from the analysis-paragraph proposal below; changing that paragraph alone would leave the conflicting scope promise in place.

Proposed README replacement, not applied. Replace the first sentence of the analysis paragraph with:

```text
When you ask for an analysis, Claude shows the files that may be sent, whether the analysis is free, and your balance, then asks before sending them. Older CLI versions show proposed files and your balance; the analysis may also send project files they import and repository-wide files the analysis can read. A new workspace's first analysis is free, and later analyses are charged to your balance. When the CLI returns a sent-file list, Claude shows it under "Files sent:"; otherwise, Claude says the result did not include that list.
```

Keep the following existing balance and results wording when applying the README proposal. The replacement above includes the free-analysis wording.

New instruction sentences in scripts/live-agent-check.mjs, supplied to both coding agents for the single noninteractive analysis:

```text
Yes: send the files shown by preview_analysis for this one analysis.
If preview_analysis is unavailable, yes: send the proposed files, any project files they import, and repository-wide files the analysis can read for this one analysis.
```

Every changed skill passage, including sentences seen only by the coding agent, follows verbatim.
Unchanged sentences inside changed paragraphs are included to preserve their context.

### Skill passage 1

Before:

```text
When the user runs `/counterfact:counterfact`, analyze the agent in `$ARGUMENTS`, or in the current folder when no path is supplied, starting with sign-in.
```

After (proposal):

```text
When the user runs `/counterfact:counterfact`, analyze the agent in `$ARGUMENTS`, or in the current folder when no path is supplied, starting with the privacy explanation below before sign-in.
```

### Skill passage 2

Before:

```text
For a cost question with unknown sign-in state, call `sign_in_status` first without `path` or `wait`. If signed out, or if that call fails, give the before-sign-in explanation below as general pricing; on failure also show the returned message. Call `get_balance` only when signed in, and do not start sign-in or an analysis just to answer a cost question.
```

After (proposal):

```text
For a cost question with unknown sign-in state, call `sign_in_status` first without `path` or `wait`. If signed out, or if that call fails, give the before-sign-in pricing sentence below as general pricing; on failure also show the returned message. Call `get_balance` only when signed in, and do not start sign-in or an analysis just to answer a cost question.
```

### Skill passage 3

Before:

```text
Before analyzing, identify the agent, its folder, and its files from what you already know of the repository. Treat `CLAUDE.md`, `AGENTS.md`, and similar files as instructions for coding agents, not as the agent to analyze, and leave them out of the file list. Stop and ask which agent to analyze only if there are several candidates or none.

1. Inspect the available Counterfact tool schemas. If `sign_in` has no `email` parameter, `sign_in_with_code` is absent, or `sign_in_status` has no `path` parameter, use this browser sequence: Call `sign_in_status` first without `path`. If not signed in, tell the user: "Counterfact needs you to sign in once (free, no card)." Call `sign_in` without arguments. When it returns a link and code, always show both. If it opens a browser, say: "Opening your browser… If nothing opens, go to <pageUrl> on any device and enter <userCode>." Otherwise say: "Go to <pageUrl> on any device and enter <userCode>." Then call `sign_in_status` with `wait: true` and no `path`; signing in on another device works while it waits. Don't start an analysis until the user is signed in. If all email tools and parameters are available, call `sign_in_status` first with `path` set to the chosen agent folder. If not signed in, tell the user: "Counterfact needs you to sign in once (free, no card)." Prefer the email address you already have for the signed-in user in your own context. Otherwise use `suggestedEmail` from `sign_in_status`, when present. Do not search files, contacts, or other services for an address. Show: "By signing in, you agree to our Terms of Service (https://counterfactlabs.com/terms) and Privacy Policy (https://counterfactlabs.com/privacy)." If you have an address, ask: "Sign in to Counterfact as <address>, or use a different address?" If you have no address, ask: "What email address would you like to use to sign in to Counterfact?" Wait for the user to confirm the offered address or supply another one. Only then call `sign_in` with `email` set to that address. Never send a code just because you found an address. After a successful send, ask: "Enter the code from your email." Wait for the user's code, then call `sign_in_with_code` with the same confirmed email and that code. Never repeat the code in your messages, logs, or reports. If the code is wrong, show the returned message and ask the user for the code again; do not send another code automatically. If it expired or there were too many attempts, show the returned message and wait for the user to ask for a new code before calling `sign_in` again with the confirmed email. If sign-in is rate limited, show the returned message and wait; do not retry automatically. If email sign-in is unavailable, show the returned message and ask: "Use browser sign-in instead?" Use browser sign-in only if the user requests or accepts it: call `sign_in` without `email`. When it returns a link and code, always show both. If it opens a browser, say: "Opening your browser… If nothing opens, go to <pageUrl> on any device and enter <userCode>." Otherwise say: "Go to <pageUrl> on any device and enter <userCode>." Then call `sign_in_status` with `wait: true` and the chosen folder's `path`; signing in on another device works while it waits. After successful email sign-in, call `sign_in_status` with the chosen folder's `path` to refresh `signedIn` and `analyzeToolAllowed`. Don't start an analysis until the user is signed in.
2. After sign-in, call `get_balance` and describe the cost from its result as below, then call `waiting_fixes` if available. For a `local:<name>` key, treat the item as belonging to the open workspace when `<name>` exactly matches the chosen agent folder's name (or the launch folder's name for file inputs) or the workspace root folder's name. For an `owner/repo[/folder]` key, match `owner/repo` against the open repository's Git remote using known facts or read-only Git metadata, and require any scoped folder to be inside the open workspace. Offer only matching items, and show each item's `repoKey` exactly as returned, even when finding numbers are unique. Do not offer or claim items from another repository or with a missing `repoKey` or uncertain repository identity. If only a `waitingFixes` count is known, or no items match, skip the offer and continue with step 3. For matching items, mention them once in one line: "1 fix is waiting: F-10 <title> (<repoKey>). Fix it now?" Name each item by the number or id and title the tool's text shows; also include its project when two matching items share a number. For several matching items, put them in the same line: "2 fixes are waiting: F-10 <title> (<repoKey>), F-12 <title> (<repoKey>). Fix one now?" Wait for the user's answer to that offer. If they agree, call `claim_fix` with the selected matching item's `findingId` as `id`, then fix it as described above. Then, whether they declined or after the fix, continue with step 3 to analyze the chosen agent. Do not repeat a waiting-fix offer the user already accepted or declined in this conversation.
3. If `analyzeToolAllowed` is false and you haven't asked in this conversation, first state Counterfact's privacy notice: "Counterfact says: The analysis runs on your computer. Model requests go encrypted to Counterfact's sealed relay, which we can't read into. Your sign-in token; your repository's remote address, branch and commit; the agent folder's name and path within the repository, and whether it has uncommitted changes; file names and sizes; and findings with code quotes are sent to the Counterfact web console. Only the agent files you choose, and the project files they import, are sent. Secret and ignored files are skipped."
4. Then, under the same condition, ask separately: "Allow Counterfact's analysis tool from now on, so auto mode doesn't stop it?" On yes, add `mcp__plugin_counterfact_counterfact__analyze_agent` to `permissions.allow` in `~/.claude/settings.json`, keeping everything else in the file. Use Claude Code's normal settings edit; Claude Code will ask the user to approve that edit. If the edit is refused or blocked, tell the user they can add it themselves: run `/permissions`, choose Allow, and add that rule. On no, continue without it.
5. When the user asks for an analysis, show the agent's name and file list in a few lines, then call `analyze_agent` without asking for approval of the list, using `path` for one selected agent file or folder, or `paths` for several selected agent files, according to the available tool schema; use the agent's folder as `path` when the schema supports only folders. Pass `proposal` with `agentName` and `files`, giving each file a `path` relative to the selected folder for folder inputs or to the launch folder for file inputs, and a `role` of `prompt`, `tools`, `model-calling code`, `config`, or `other`. Counterfact treats the proposal as a strong hint and still checks every file. Each call runs one analysis, using the free first analysis when available and otherwise charging the user's balance, so call it only when the user has asked, and don't ask them to approve a price first. Never call a preview tool for a price or pass `confirm`. If the balance doesn't cover it, show the returned message, which includes the top-up link. If the tool cannot tell which folder holds the agent, ask the user which of the returned candidate folders holds it, then call `analyze_agent` again with their answer as `path`, making the proposal's paths relative to that folder and leaving out files outside it.
6. The tool returns findings and a link. Show the full-results link to the project's findings page, then list every returned finding as the tool's text lists it, keeping its order and group headings. Read a finding with `get_finding` using its returned id only when the result has no title or you need its details to judge seriousness.
7. Only after showing the full list, offer to fix the most serious finding, preferring ones that affect the agent's users. If the user agrees, fix the chosen finding as described above. Do not call `claim_fix` for new findings from an analysis.
```

After (proposal):

```text
Before analyzing, identify the agent, its folder, and its files from what you already know of the repository. Treat `CLAUDE.md`, `AGENTS.md`, and similar files as instructions for coding agents, not as the agent to analyze, and leave them out of the proposal's file list. Stop and ask which agent to analyze only if there are several candidates or none.

Before starting sign-in or the first analysis in a conversation, say: "An analysis may send the contents of the agent files you choose, the project files they import, and repository-wide files the analysis can read, encrypted to Counterfact's sealed relay. Your sign-in token; your repository's remote address, branch and commit; the agent folder's name and path within the repository, and whether it has uncommitted changes; file names and sizes; and findings with code quotes are sent to the Counterfact web console. Secret and ignored files are skipped." Give this explanation before either email or browser sign-in and even when already signed in, regardless of `analyzeToolAllowed`.

1. Inspect the available Counterfact tool schemas. If `sign_in` has no `email` parameter, `sign_in_with_code` is absent, or `sign_in_status` has no `path` parameter, use this browser sequence: Call `sign_in_status` first without `path`. If not signed in, tell the user: "Counterfact needs you to sign in once (free, no card)." Call `sign_in` without arguments. When it returns a link and code, always show both. If it opens a browser, say: "Opening your browser… If nothing opens, go to <pageUrl> on any device and enter <userCode>." Otherwise say: "Go to <pageUrl> on any device and enter <userCode>." Then call `sign_in_status` with `wait: true` and no `path`; signing in on another device works while it waits. Don't start an analysis until the user is signed in. If all email tools and parameters are available, call `sign_in_status` first with `path` set to the chosen agent folder. If not signed in, tell the user: "Counterfact needs you to sign in once (free, no card)." Prefer the email address you already have for the signed-in user in your own context. Otherwise use `suggestedEmail` from `sign_in_status`, when present. Do not search files, contacts, or other services for an address. Show: "By signing in, you agree to our Terms of Service (https://counterfactlabs.com/terms) and Privacy Policy (https://counterfactlabs.com/privacy)." If you have an address, ask: "Sign in to Counterfact as <address>, or use a different address?" If you have no address, ask: "What email address would you like to use to sign in to Counterfact?" Wait for the user to confirm the offered address or supply another one. Only then call `sign_in` with `email` set to that address. Never send a code just because you found an address. After a successful send, ask: "Enter the code from your email." Wait for the user's code, then call `sign_in_with_code` with the same confirmed email and that code. Never repeat the code in your messages, logs, or reports. If the code is wrong, show the returned message and ask the user for the code again; do not send another code automatically. If it expired or there were too many attempts, show the returned message and wait for the user to ask for a new code before calling `sign_in` again with the confirmed email. If sign-in is rate limited, show the returned message and wait; do not retry automatically. If email sign-in is unavailable, show the returned message and ask: "Use browser sign-in instead?" Use browser sign-in only if the user requests or accepts it: call `sign_in` without `email`. When it returns a link and code, always show both. If it opens a browser, say: "Opening your browser… If nothing opens, go to <pageUrl> on any device and enter <userCode>." Otherwise say: "Go to <pageUrl> on any device and enter <userCode>." Then call `sign_in_status` with `wait: true` and the chosen folder's `path`; signing in on another device works while it waits. After successful email sign-in, call `sign_in_status` with the chosen folder's `path` to refresh `signedIn` and `analyzeToolAllowed`. Don't start an analysis until the user is signed in.
2. After sign-in, call `get_balance`, then call `waiting_fixes` if available. For a `local:<name>` key, treat the item as belonging to the open workspace when `<name>` exactly matches the chosen agent folder's name (or the launch folder's name for file inputs) or the workspace root folder's name. For an `owner/repo[/folder]` key, match `owner/repo` against the open repository's Git remote using known facts or read-only Git metadata, and require any scoped folder to be inside the open workspace. Offer only matching items, and show each item's `repoKey` exactly as returned, even when finding numbers are unique. Do not offer or claim items from another repository or with a missing `repoKey` or uncertain repository identity. If only a `waitingFixes` count is known, or no items match, skip the offer and continue with step 3. For matching items, mention them once in one line: "1 fix is waiting: F-10 <title> (<repoKey>). Fix it now?" Name each item by the number or id and title the tool's text shows; also include its project when two matching items share a number. For several matching items, put them in the same line: "2 fixes are waiting: F-10 <title> (<repoKey>), F-12 <title> (<repoKey>). Fix one now?" Wait for the user's answer to that offer. If they agree, call `claim_fix` with the selected matching item's `findingId` as `id`, then fix it as described above. Then, whether they declined or after the fix, continue with step 3 to analyze the chosen agent. Do not repeat a waiting-fix offer the user already accepted or declined in this conversation.
3. If `analyzeToolAllowed` is false and you haven't asked in this conversation, ask: "Allow Counterfact's analysis tool from now on, so auto mode doesn't stop it?" On yes, add `mcp__plugin_counterfact_counterfact__analyze_agent` to `permissions.allow` in `~/.claude/settings.json`, keeping everything else in the file. Use Claude Code's normal settings edit; Claude Code will ask the user to approve that edit. If the edit is refused or blocked, tell the user they can add it themselves: run `/permissions`, choose Allow, and add that rule. On no, continue without it.
4. Before every analysis, prepare the selection using `path` for one selected agent file or folder, or `paths` for several selected agent files, according to the available tool schema; use the agent's folder as `path` when the schema supports only folders. Pass `proposal` with `agentName` and `files`, giving each file a `path` relative to the selected folder for folder inputs or to the launch folder for file inputs, and a `role` of `prompt`, `tools`, `model-calling code`, `config`, or `other`. Counterfact treats the proposal as a strong hint and still checks every file. If available, call `preview_analysis` with the same selection and proposal you will pass to `analyze_agent`, using only parameters supported by each available tool schema. It reads and selects files locally, uploads nothing and reserves nothing. Read `files` (each with `path`, `bytes`, and `role`), `totalBytes`, `cost` (`free` and optional `balanceUsd`), and `notices` from its structured result or the same data in its text result.
5. Show the agent's name and the full file list returned by `preview_analysis`, labeled "Files that may be sent:", including imported and repository-wide files. Say: "The analysis may send a subset of this list." Label preview `bytes` as "File size (bytes)". Show any `notices` returned by the preview. If a preview notice asks the user to sign in, show that notice and repeat step 1 before stating free or paid status or asking for file consent; after sign-in, repeat steps 4 and 5. Otherwise, show whether the analysis is free and the balance using the balance policy below. Do not infer a price from the balance. If `preview_analysis` is unavailable in an older CLI, show the proposal's file list labeled "Proposed files:", and the returned balance and top-up link, using the balance policy below for cost. Do not claim that a proposed list is the final list of files to send. Ask: "Send these proposed files, any project files they import, and repository-wide files the analysis can read, for analysis?" Apply step 6 before handling candidate folders or refusals from `analyze_agent`. If a preview or analysis returns candidate folders, first ask the user which of the returned candidate folders holds the agent, then use their answer as `path`, making the proposal's paths relative to that folder and leaving out files outside it; repeat steps 4 and 5. Otherwise, if `preview_analysis` fails, show the returned message and stop. Do not treat a failed preview as an unavailable tool. For a successful preview, ask: "Send these files for analysis?" Wait for an explicit yes before calling `analyze_agent` with the same selection and proposal. This consent is to sending the files for every analysis, including retries; a previous analysis request or tool permission does not replace it. If the user declines or hasn't answered, do not call `analyze_agent`. Each call runs one analysis, using the free first analysis when available and otherwise charging the user's balance, so call it only when the user has asked, and don't ask them to approve a price first. Never pass `confirm` or a price-approval flag. If the balance doesn't cover it, show the returned message, which includes the top-up link. If the selection or proposal changes, or another analysis is needed, repeat steps 4 and 5 before calling `analyze_agent` again.
6. On every `analyze_agent` return that includes `files`, including refusals and agent-choice or scope-choice results, show the list of files sent from the `analyze_agent` result under "Files sent:", using `files` from the `analyze_agent` result; each file has `path`, `bytes`, and `role`. Label result `bytes` as "Bytes sent". Use the returned sent-file list in its text when structured data is unavailable. If an older CLI omits the list, say: "The analysis result did not include a list of files sent." Never present the proposal or preview as proof of what was sent. When the tool returns findings and a link, show the full-results link to the project's findings page, then list every returned finding as the tool's text lists it, keeping its order and group headings. Read a finding with `get_finding` using its returned id only when the result has no title or you need its details to judge seriousness.
7. Only after showing the full list, offer to fix the most serious finding, preferring ones that affect the agent's users. If the user agrees, fix the chosen finding as described above. Do not call `claim_fix` for new findings from an analysis.
```

### Skill passage 4

Before:

```text
After sign-in and before each analysis or any statement about cost, call `get_balance` and describe the cost from its result. If `freeAnalysisAvailable` is true or the result text says "Your first analysis is free.", say: "This analysis is free." Otherwise, show the returned balance and top-up link, and say: "This analysis is charged to your balance; prices are on the top-up page." If `get_balance` fails for a signed-in user, show the returned message and do not guess the cost. Also use `get_balance` when the user asks about their balance or needs a top-up link.
```

After (proposal):

```text
After sign-in and before each analysis, call `get_balance`. When `preview_analysis` is available, use its result for the files that may be sent, whether this analysis is free, and the balance. If `cost.free` is true, say: "This analysis is free." Show `cost.balanceUsd` when present, otherwise the balance from `get_balance`, and the returned top-up link. If `cost.free` is false, say: "This analysis is charged to your balance; prices are on the top-up page." For cost questions without a preview, or when `preview_analysis` is unavailable, describe the cost from `get_balance` as follows. If `freeAnalysisAvailable` is true or the result text says "Your first analysis is free.", say: "This analysis is free." Otherwise, show the returned balance and top-up link, and say: "This analysis is charged to your balance; prices are on the top-up page." If `get_balance` fails for a signed-in user, show the returned message and do not guess the cost. Also use `get_balance` when the user asks about their balance or needs a top-up link.
```

## Questions for Arya and release limits

- Should the README's "Only the agent files" sentence change? It was approved on October 29, 2026, but contradicts
  the new notice and Option A's inclusion of repository-wide files. The separate README scope replacement above
  is proposed for approval; leave that scope sentence and its pinned privacy test unchanged until Arya decides.
  The website may need the same scope decision; its setup prompt has not been checked or changed in this round.
- Should the notice name the model provider? The README names the sealed relay, while the brief limits disclosure
  facts to README or CLI text. The proposed notice retains that destination pending Arya's decision.
- Should the pre-sign-in notice mention file hashes? The CLI preview notice quoted above includes file hashes,
  while the pre-sign-in notice says only "file names and sizes". Preview users see this notice before consent;
  fallback users do not. No hash wording has been added to the skill pending Arya's decision.
- Should the fallback question use the shorter wording proposed above? The existing question, tests and workflow
  hash remain unchanged pending Arya's decision.
- Should this plugin ship before the CLI release with preview_analysis and sent-file lists? CLI 0.2.9 has neither;
  every analysis uses the fallback and discloses missing sent-file evidence. The website release dependency is settled.
- The offline CLI 0.2.9 probe uses empty settings and puts prompt.md, README.md and AGENTS.md in the chosen folder.
  With only prompt.md proposed, the local reader and send plan also include the other files in the chosen folder.
  This does not establish that files above the chosen folder are included, and the probe performs no upload.
  Arya's Option A decision supplies the repository-wide scope used by the skill, fallback question, nightly prompt
  and README proposals. The README's current scope sentence still conflicts with that scope until a change is approved.
- If the preview returns its sign-in notice, free status is unknown despite cost.free being false. Repeat sign-in
  and preview before showing free or paid status or asking for file consent.
- Option A returns files (path, bytes, role), totalBytes, cost (free and optional balanceUsd), and notices without an estimate.
  The may-send list includes repository-wide files available to the local reader. Results list only the files actually sent,
  a subset of the preview. Preview bytes mean file size; result bytes mean bytes actually sent.
- The release smoke exception is limited to the 0.2.9 and 0.2.11 pins (0.2.11 offers its preview only in the terminal; the owner decided on 2026-11-09 to ship it with the proposed-files fallback and add the tool in 0.2.12). Newer pins require preview_analysis, so losing it fails smoke.
- Offline integration uses an in-memory MCP fake and explicit scripted turns. It checks the skill's order: the privacy notice
  precedes sign-in, then balance and preview precede the file list and consent question, and analysis follows explicit consent.
  Scripted replay is not evidence of live model compliance. No real coding agent or model was run.
- Preview permission in auto mode still needs a live acceptance check when the CLI pin gains preview_analysis; CLI 0.2.9
  has no preview to exercise. No permission-setting changes are proposed in this revision.
- The nightly credential case still requires one analyze_agent attempt. Preview refusal handling needs to be defined and
  exercised with the actual CLI preview before adopting its release.
- The live adapter permits preview_analysis without starting an analysis. Offline adapter/bridge tests cover GET
  /api/cli/checks/mode and GET /api/cli/balance with no reservation or upload. The CLI preview release has not been adopted
  here, so its final console requests require verification before adoption.
