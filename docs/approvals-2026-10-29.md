# Plugin wording approval: 2026-10-29

Status: **Approved by Arya on October 29, 2026.**

Every changed sentence in the skill and README is included verbatim below, with its previous wording. Full affected paragraphs preserve context; approval is requested for the changed sentences. Each item is pending Arya's approval before merge or publication.

## Minor 1: waiting fixes

File: `skills/counterfact-analyze/SKILL.md`

Status: **Approved by Arya on October 29, 2026.**

Before:

```text
2. After sign-in, call `waiting_fixes` if available. If its `fixRequests` contains items, or `sign_in_status` returns `waitingFixes` > 0, mention them once in one line: "1 fix is waiting: F-10 <title>. Fix it now?" Name each item by the number or id and title the tool's text shows; include its project only when two items share a number. For several, put them in the same line: "2 fixes are waiting: F-10 <title>, F-12 <title>. Fix one now?" If only a count is known, state it without inventing a number or title. Wait for the user's answer to that offer. If they agree, call `claim_fix` with the selected item's `findingId` as `id`, then fix it as described above. Then, whether they declined or after the fix, continue with step 3 to analyze the chosen folder. Do not repeat a waiting-fix offer the user already accepted or declined in this conversation.
```

After:

```text
2. After sign-in, call `waiting_fixes` if available. For a `local:<name>` key, treat the item as belonging to the open workspace when `<name>` exactly matches the chosen agent folder's name (or the launch folder's name for file inputs) or the workspace root folder's name. For an `owner/repo[/folder]` key, match `owner/repo` against the open repository's Git remote using known facts or read-only Git metadata, and require any scoped folder to be inside the open workspace. Offer only matching items, and show each item's `repoKey` exactly as returned, even when finding numbers are unique. Do not offer or claim items from another repository or with a missing `repoKey` or uncertain repository identity. If only a `waitingFixes` count is known, or no items match, skip the offer and continue with step 3. For matching items, mention them once in one line: "1 fix is waiting: F-10 <title> (<repoKey>). Fix it now?" Name each item by the number or id and title the tool's text shows; also include its project when two matching items share a number. For several matching items, put them in the same line: "2 fixes are waiting: F-10 <title> (<repoKey>), F-12 <title> (<repoKey>). Fix one now?" Wait for the user's answer to that offer. If they agree, call `claim_fix` with the selected matching item's `findingId` as `id`, then fix it as described above. Then, whether they declined or after the fix, continue with step 3 to analyze the chosen agent. Do not repeat a waiting-fix offer the user already accepted or declined in this conversation.
```

## Minor 11: file and multi-file inputs

File: `skills/counterfact-analyze/SKILL.md`

Status: **Approved by Arya on October 29, 2026.**

Before:

```text
5. When the user asks for an analysis, show the agent's name and file list in a few lines, then call `analyze_agent` with the agent's folder as `path` without asking for approval of the list. Pass `proposal` with `agentName` and `files`, giving each file a `path` relative to the agent's folder and a `role` of `prompt`, `tools`, `model-calling code`, `config`, or `other`. Counterfact treats the proposal as a strong hint and still checks every file. Each call runs one analysis and charges the user's balance at the listed price, so call it only when the user has asked, and don't ask them to approve a price first. Never call a preview tool for a price or pass `confirm`. If the balance doesn't cover it, show the returned message, which includes the top-up link. If the tool cannot tell which folder holds the agent, ask the user which of the returned candidate folders holds it, then call `analyze_agent` again with their answer as `path`, making the proposal's paths relative to that folder and leaving out files outside it.
```

After:

```text
5. When the user asks for an analysis, show the agent's name and file list in a few lines, then call `analyze_agent` without asking for approval of the list, using `path` for one selected agent file or folder, or `paths` for several selected agent files, according to the available tool schema; use the agent's folder as `path` when the schema supports only folders. Pass `proposal` with `agentName` and `files`, giving each file a `path` relative to the selected folder for folder inputs or to the launch folder for file inputs, and a `role` of `prompt`, `tools`, `model-calling code`, `config`, or `other`. Counterfact treats the proposal as a strong hint and still checks every file. Each call runs one analysis and charges the user's balance at the listed price, so call it only when the user has asked, and don't ask them to approve a price first. Never call a preview tool for a price or pass `confirm`. If the balance doesn't cover it, show the returned message, which includes the top-up link. If the tool cannot tell which folder holds the agent, ask the user which of the returned candidate folders holds it, then call `analyze_agent` again with their answer as `path`, making the proposal's paths relative to that folder and leaving out files outside it.
```

## Plugin-only release wording

File: `README.md`

Status: **Approved by Arya on October 29, 2026.**

Before:

```text
The plugin starts `npx -y @counterfact-labs/cli@0.2.9 mcp` on your computer (an exact version, updated with each release) and allows up to 15 minutes per tool call. Cancelling the tool call or reaching that limit stops the analysis. If an analysis is stopped before it finishes, run it again. Results appear on the project's findings page at the link Claude shows. The plugin version follows the CLI version, so `claude plugin update counterfact@counterfact-labs` picks up new releases.
```

After:

```text
The plugin starts `npx -y @counterfact-labs/cli@0.2.9 mcp` on your computer (an exact version, updated when the plugin adopts a new CLI release) and allows up to 15 minutes per tool call. Cancelling the tool call or reaching that limit stops the analysis. If an analysis is stopped before it finishes, run it again. Results appear on the project's findings page at the link Claude shows. The plugin version also advances for skill changes without changing the CLI pin, so `claude plugin update counterfact@counterfact-labs` picks up those releases.
```

## Minor 14: Codex setup link

File: `README.md`

Status: **Approved by Arya on October 29, 2026.**

Before:

```text
Counterfact keeps the findings from each analysis until it or the workspace is deleted. See the [command-line package](https://www.npmjs.com/package/@counterfact-labs/cli) for commands, privacy details, and Codex setup.
```

After:

```text
Counterfact keeps the findings from each analysis until it or the workspace is deleted. See the [command-line package](https://www.npmjs.com/package/@counterfact-labs/cli) for commands and privacy details, and the [Counterfact website](https://counterfactlabs.com) for Codex setup.
```

## Review questions for Arya

All questions remain pending; implementing the proposed wording does not approve it.

- Local repository identity: Should a fix for a different agent folder in the same repository be offered? The CLI's `local:<name>` key contains only the analysed folder's name for folder inputs, or the launch folder's name for file inputs. It has no repository identity or full folder path, so it cannot establish whether another named agent folder belongs to the same repository, or distinguish folders with the same name in different checkouts. The proposed rule accepts the chosen agent folder's name (the launch folder's name for file inputs) or the workspace root folder's name; other names and missing keys are skipped. This behavior remains pending Arya's decision.
- Minor 11 wording: Where is the one-sentence replacement referenced as “docs #2”? It was not found in the inspected documentation. The proposed step 5 changes two sentences: input selection and proposal path coordinates. Please confirm both sentences or supply the intended one-sentence replacement.
- Minor 11 defaults: The inspected audit CLI source, `counterfact-local/.worktrees/au-cli-core/packages/core/src/settings.ts:7`, enables file scope only when `CF_FILE_SCOPE === "1"` and `CF_LOCAL_IMPORT_RESOLUTION !== "0"`. Multi-entry mode also depends on that switch. This contradicts the audit's “on by default” premise; the proposed skill follows the available tool schema.
- Remaining folder wording: `skills/counterfact-analyze/SKILL.md:12` still says “outside the chosen folder”; step 1 at line 18 still supplies the chosen agent folder to sign-in status; `README.md:16` still says “Only agent files from the folder you choose are sent”. These are known gaps for file mode and need a separate wording decision. Step 3 is the CLI's verbatim disclosure and remains unchanged.
- Codex setup destination: Please confirm the website root linked above contains the intended Codex setup steps. The link follows the brief; no live website request was made during this fix.

## Skill scenario evidence limitation

The offline consumer scenarios and their saved observations live under the untracked `.artifacts/au-minors-plugin/` directory and are not intended for commit. They provide red/green evidence for this fix round, including local keys and missing keys, but there is no lasting automated regression test for the skill's behavior in the repository's CI suite.
