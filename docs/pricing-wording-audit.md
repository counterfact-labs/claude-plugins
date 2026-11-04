# Pricing wording audit

Prepared on 2026-11-04. Wording below awaits Arya's approval; this document does not record approval. Only the requested README sentence and skill pricing instructions are implemented. Other wording below is proposed, not applied. No publication or paid action was performed.

The read-only counterfact-local audit used `origin/main` at `13f8653d19d23008c9ac0ff1107b32d0ff5bbd8f`, using `git show` and `git grep` in `/home/user/code/counterfact-local`. That revision already mentions the free first analysis in all three `analyze_agent` descriptions and in `get_balance`; it does not call `analyze_agent` “paid”. Its `sign_in_status` result does not mention price or return free-analysis availability. The plugin still starts CLI 0.2.9. Its locally cached published package was also inspected and its MCP handler exercised with fake API responses: a free result includes `freeAnalysisAvailable: true` and the text "Your first analysis is free."; false or absent eligibility omits the structured flag and the free sentence. Both forms repeat the terminal text in `structuredContent.text`. The balance endpoint is a GET. The skill accepts either the true flag or the free sentence, including when the client exposes only text.

## Text for Arya's approval

### Implemented proposal: README.md, analysis paragraph

Before:

```text
When you ask for an analysis, Claude runs it and charges your balance.
```

After:

```text
When you ask for an analysis, Claude runs it; a new workspace's first analysis is free, and later analyses are charged to your balance.
```

Every other README sentence is unchanged, including the following sentence about prices on the top-up page.

### Implemented proposal: skills/counterfact/SKILL.md, cost questions

New paragraph, verbatim:

```text
For a cost question with unknown sign-in state, call `sign_in_status` first without `path` or `wait`. If signed out, or if that call fails, give the before-sign-in explanation below as general pricing; on failure also show the returned message. Call `get_balance` only when signed in, and do not start sign-in or an analysis just to answer a cost question.
```

### Implemented proposal: skills/counterfact/SKILL.md, before sign-in

New paragraph, verbatim:

```text
Before sign-in, say: "The first analysis on a new workspace is free; later analyses are charged to your balance, with prices on the top-up page." Never describe the cost as only "it costs money".
```

### Implemented proposal: skills/counterfact/SKILL.md, step 2

Before:

```text
After sign-in, call `waiting_fixes` if available.
```

After:

```text
After sign-in, call `get_balance` and describe the cost from its result as below, then call `waiting_fixes` if available.
```

### Implemented proposal: skills/counterfact/SKILL.md, step 5

Before:

```text
Each call runs one analysis and charges the user's balance at the listed price, so call it only when the user has asked, and don't ask them to approve a price first.
```

After:

```text
Each call runs one analysis, using the free first analysis when available and otherwise charging the user's balance, so call it only when the user has asked, and don't ask them to approve a price first.
```

### Implemented proposal: skills/counterfact/SKILL.md, balance policy

Before:

```text
Use `get_balance` when the user asks about their balance or needs a top-up link.
```

After, complete paragraph including both prescribed replies:

```text
After sign-in and before each analysis or any statement about cost, call `get_balance` and describe the cost from its result. If `freeAnalysisAvailable` is true or the result text says "Your first analysis is free.", say: "This analysis is free." Otherwise, show the returned balance and top-up link, and say: "This analysis is charged to your balance; prices are on the top-up page." If `get_balance` fails for a signed-in user, show the returned message and do not guess the cost. Also use `get_balance` when the user asks about their balance or needs a top-up link.
```

The existing low-balance instruction still shows the tool's returned message and top-up link. The existing prohibition on price approval, preview tools and `confirm` is unchanged.

### Implemented: plugin release metadata

`.claude-plugin/plugin.json`: `"version": "0.2.13"` becomes `"version": "0.2.14"`. The repository's release gate requires a version increase for skill changes so installed plugins refresh. The CLI pin remains 0.2.9. No descriptive metadata changes.

### New test diagnostic, not product output

`scripts/pricing-conversation.test.mjs`, emitted only if the offline pricing assertion fails:

```text
Signed-out pricing must explain the free first analysis, later balance charges, and prices on the top-up page.
```

`tests/integration/pricing.test.mjs`, emitted only when no already installed pinned CLI package is available:

```text
Offline integration tests require the pinned CLI package already installed; set COUNTERFACT_TEST_CLI_ROOT to its directory.
```

No existing terminal output was changed. Test names and fictional API replies are test evidence, not instructions or replies shipped in the plugin.

### Proposed only: README.md, Codex setup

Before:

```text
`default_tools_approval_mode = "approve"` lets Codex call Counterfact's tools, including the paid `analyze_agent`, without asking each time.
```

Proposed replacement:

```text
`default_tools_approval_mode = "approve"` lets Codex call Counterfact's tools, including `analyze_agent`, without asking each time.
```

This removes the unconditional “paid” description. The corrected analysis paragraph already explains the free first analysis. Left unchanged because the task requires keeping every other README sentence.

### Proposed only: docs/approvals-2026-10-29.md

The “Minor 11” Before and After blocks each contain this sentence:

```text
Each call runs one analysis and charges the user's balance at the listed price, so call it only when the user has asked, and don't ask them to approve a price first.
```

Proposed replacement whenever this text is reused as current guidance:

```text
Each call runs one analysis, using the free first analysis when available and otherwise charging the user's balance, so call it only when the user has asked, and don't ask them to approve a price first.
```

Keep the historical approval record unchanged; the implemented skill and this audit describe the current proposal. `docs/approvals-2026-10-29-consent.md` describes the withdrawn skipped-files wording and keeps prices on the console's top-up page; no replacement is needed.

### Proposed only: counterfact-local cli/mcp.ts, legacy analyze_agent

Before, at line 81:

```text
Each call runs one analysis and charges the user's balance unless a free analysis is available, so call it only when the user asks for an analysis.
```

Proposed replacement:

```text
A new workspace's first analysis is free; later analyses charge the user's balance, so call analyze_agent only when the user asks for an analysis.
```

### Proposed only: counterfact-local cli/mcp.ts, file analyze_agent

Before, in `fileAnalysisDescription` at line 43:

```text
Each call that runs an analysis charges the user's balance unless a free analysis is available, so call it only when the user asks for an analysis.
```

Proposed replacement:

```text
A new workspace's first analysis is free; later analyses charge the user's balance, so call analyze_agent only when the user asks for an analysis.
```

### Proposed only: counterfact-local cli/mcp.ts, multi-file analyze_agent

Before, in `multiAnalysisDescription` at line 50:

```text
Up to 5 agent files run as one analysis with one result list and one charge unless a free analysis is available.
```

Proposed replacement:

```text
Up to 5 agent files run as one analysis with one result list; a new workspace's first analysis is free, and later analyses charge the user's balance once.
```

For all three descriptions, append this exact sentence after the existing “A free first analysis needs no top-up.” sentence:

```text
After sign-in, call get_balance before each analysis or any statement about cost, and describe the cost from its result.
```

Retain these existing sentences exactly:

```text
A free first analysis needs no top-up.
Prices are listed on the top-up page and website.
If the balance doesn't cover the analysis, show the returned message and top-up link.
```

### Proposed only: counterfact-local cli/mcp.ts, get_balance description

Before, at line 85:

```text
Get the balance and top-up link, and whether a free first analysis is available. A free first analysis needs no top-up.
```

Proposed complete replacement:

```text
After sign-in, call this tool before each analysis or any statement about cost, and when the user asks about their balance or needs a top-up link. If freeAnalysisAvailable is true or the result text says "Your first analysis is free.", tell the user this analysis is free; otherwise show the returned balance and top-up link, with prices on the top-up page. A free first analysis needs no top-up.
```

### Proposed only: counterfact-local cli/mcp.ts, sign_in_status output

Before, at line 313:

```text
Not signed in.
```

Proposed replacement:

```text
Not signed in. The first analysis on a new workspace is free; later analyses are charged to your balance, with prices on the top-up page.
```

Before:

```text
Signed in.
```

Proposed replacement:

```text
Signed in. Call get_balance before an analysis or describing its cost.
```

The same signed-in text is returned after `sign_in_with_code`; use the same replacement there to keep both successful sign-in paths consistent. The legacy and email `sign_in_status` descriptions currently describe authentication and permissions, not price; retain them. Do not infer free availability from `signedIn` or add a price-approval step.

### Audited without replacement: counterfact-local balance results

`cli/commands/balance.ts:11-12` already prints the following free-analysis sentence only when `freeAnalysisAvailable` is true:

```text
Your first analysis is free.
```

Retain the `Balance: <amount>` and `Top up: <topUpUrl>` lines exactly. `cli/mcp.ts:427` supplies `freeAnalysisAvailable: true` in structured content only when true; otherwise the field is omitted. The skill reads the returned balance and link from text, rather than inventing structured balance fields.

### Proposed only: counterfact-local README.md, Codex setup and charges

Before, at line 61:

```text
This setting lets Codex call Counterfact's tools, including paid analysis, without asking each time.
```

Proposed replacement:

```text
This setting lets Codex call Counterfact's tools, including analysis, without asking each time.
```

Before, at line 67:

```text
An analysis charges the balance directly; it has no price confirmation step.
```

Proposed replacement:

```text
A new workspace's first analysis is free. Later analyses charge the balance directly; there is no price confirmation step.
```

Retain the next sentence, with its existing line wrapping:

```text
Prices belong on the website and top-up page; an uncovered balance refuses with a top-up link.
```

### Proposed only: live-suite estimates in docs and workflow comments

`docs/live-suite-run1.md:68-69`:

```text
The suite keeps three paid cases per coding agent: six analyses, about $12 per run, with a $15 aggregate cap and the existing $5 per-analysis ceiling.
```

Proposed replacement if reused as current operating guidance:

```text
The suite runs three analysis cases per coding agent: six analyses, with a $15 aggregate cap and a $5 per-analysis ceiling; actual Counterfact charges come from reservation receipts, and a free first analysis may reduce the total.
```

`.github/workflows/live-agent-check.yml:2-3`, also quoted in `docs/live-suite-run1.md:238-239`:

```text
# Three paid cases and one free credential refusal in BOTH Claude Code and Codex:
# six paid analyses, about $12 per run (about $2 each today).
```

Proposed replacement:

```text
# Three analysis cases and one free credential refusal in BOTH Claude Code and Codex:
# six analyses; actual charges come from reservation receipts and may include a free first analysis.
```

No workflow or historical report was edited. These estimates concern the release test account, not a product price promise.

### Audited without replacement: live-suite operator output

These sentences describe actual receipts, caps, or refusal probes, not an unconditional charge for a new workspace. Keep them unchanged. Interpolated amounts below show the existing default $15 aggregate and $5 per-analysis caps.

`scripts/live-agent-check.mjs:63,69-70,78-79`:

```text
Total Counterfact analysis estimate cap: $15.00.
Per-analysis ceiling $5.00; up to six analyses.
run requires --confirm-paid and COUNTERFACT_LIVE_TEST_KEY.
Withhold each reservation capability until its priceMicro is a nonnegative safe integer and the combined price fits the cap; otherwise release the hold before model work.
A temporary balance hold may occur before the price is available.
Coding-agent provider costs are separate and are not bounded by this Counterfact cap.
Free probes every run: sign-in status, installed MCP startup inside package @counterfact-labs/cli, supported over-cap refusal, /setup and README links.
Print one-screen PASS/FAIL rows with duration, estimated/charged Counterfact amount, and provider cost if reported; fail the process if either agent fails.
```

`scripts/live-agent-probes.mjs:71`, the existing refusal contract matched by the probe:

```text
This analysis costs more than the limit you set, so it didn't start.
Nothing was charged.
```

`scripts/live-agent-cases.mjs`, existing credential refusal result:

```text
Credential-containing prompt refused before reservation; charged $0.00
```

The remaining live-suite report price references are historical evidence, quoted terminal output, receipt-derived amounts, provider-cost availability, and test results. Proposed replacement: retain each as recorded. They do not establish the price or free eligibility of a new user's analysis. Existing operator-only flags and budget controls were not changed; no product price prompt, approval flag, or approval error code was added.

## Audit coverage and limits

- No `commands/` directory exists. The skill is the sole workflow owner.
- Manifests, `.mcp.json`, fixture agents, and the MCP transport adapter contain no other product pricing guidance. Test fakes and assertions are not product guidance.
- The signed-out pricing test checks the prescribed instruction and its completeness. It does not measure a model's compliance. Offline integration tests exercise the pinned CLI's API client, balance formatter, and MCP result envelope; API responses are fake and no model is called.
- The balance-read failure rule applies to signed-in users and limits cost claims. It does not add a condition blocking a requested analysis. Sign-in failure during a cost question falls back to general pricing without claiming account-specific eligibility.
- The README sentence beginning "If your balance doesn't cover it" is unchanged as required by the brief. Arya can decide whether its reference to "it" needs a separate wording change.
- Historical approvals and recorded outputs are unchanged. Proposed changes in counterfact-local are listed here only; that repository is read-only for this task.
