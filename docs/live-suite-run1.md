# First live integration-suite run: diagnosis and harness repair

Run 41079915864, 2026-10-30, approximately 08:21 Pacific (15:21 UTC).
Incident log: `/home/user/tmp/live-suite-run1.log` (459 lines).
Git metadata stayed read-only. No workflow, paid run, deployment or publication
was triggered; no real account credentials were read. This document and the
operator text listed below await Arya's approval before merge. None is presented
as approved.

## Evidence and conclusions

| Failure | Incident log lines | Cause and classification |
| --- | --- | --- |
| Claude/Codex clean, planted-authority, tools-agent: missing matching upload receipt | 403, 404, 406; 410, 411, 413 | Harness compatibility bug. Receipt matching followed one initialized MCP server and an analysis reply with `exitCode: 0` and no `isError`. CLI 0.2.9 uploads to the bridge's `/api/cli/checks/local` endpoint but normally omits `analysisId` from its MCP reply. Comparing the missing MCP field against the upload receipt rejects a valid save. The harness now checks optional MCP identities when supplied, still requires exactly one validated upload receipt, and checks the exact findings URL. |
| Claude/Codex planted-credential: analysis did not complete | 405, 412 | Harness expectation bug plus a product message problem. Published 0.2.9 rejects the unchanged fixture's only prompt as `secret-content`. Discovery without a proposal raises the `no_agent` choice. Claude's skill-shaped proposal instead raises the proposed-files error before the choice is considered. Both paths refuse before reservation. The harness now accepts only the refusal matching the actual request shape and expected prompt path, with no reserve attempt, hold, receipt or findings. An uploaded credential prompt fails even if its planted source is cited. The historical generic error does not identify which path actually ran. |
| Claude free probe: installed MCP configuration unavailable | 402 | Harness parser bug. It required exactly `['-y', pin, 'mcp']`; #19 added `--prefix=${CLAUDE_PLUGIN_ROOT}`. The shared `cliPin` owner now expands the installed root and forwards its prefix and exact pin to startup and help/cap probes. |
| npm package page HTTP 403 | 399 | External access block incorrectly treated as a product failure. Only this exact npm package-page 403 is explicitly not checkable. npm 404/500 and other sites' 403 still fail. The earlier independent registry lookup supplied 0.2.9 and an integrity-verified archive; that establishes package existence, not human-facing page availability. |

The receipt error originates in the parent validator. The bridge checks the held
reservation, matching payload/response/reservation projects, matching check ID,
analysis ID, and one saved finding ID per submitted finding. Its matching rules
remain intact. The validator's former unconditional comparison with an optional
MCP identity was incompatible. #19's prefix does not change the upload endpoint.

Codex startup and sign-in passed (407–408), reporting server version 0.2.9.
Its cap probe skipped because the published CLI lacks `--max-dollars` (409).

## Charges and historical limits

The log contains no reservation IDs, prices, settlement receipts, completion text
or findings URLs. The amounts on line 397 are caps, not charges. Up to six priced
analyses may have run, but the receipt error also fires with zero receipts; it
establishes neither a saved-analysis count nor a charged total. Read the real
amounts in the smoke@ account's balance history for **2026-10-30, 15:21–15:28 UTC**.
That account history was not accessed during this repair.

A successful priced upload normally settles at reserved `priceMicro`; neither
that price nor `settlement: 'charged'` is logged here. Do not substitute fake-test
prices or assume the Personal price. Coding-agent provider costs are absent too.
The offline credential refusal paths make no reservation and incur no Counterfact
analysis charge, but the incident's generic error alone cannot prove those paths
ran. No paid activity occurred during either repair round.

Verified receipt amounts and saved findings URLs now survive later MCP, agent or
case-assertion failures in stdout and the job summary. If agent validation never
reported provider cost, the row says `provider not reported`.

## Product finding and coverage decision for Arya

Credential filtering is correct, but its explanation is misleading. When a valid
prompt is excluded for containing a credential, discovery says:

> Counterfact couldn't find an agent prompt in this folder. Pass a folder containing an agent prompt or a model call with a system prompt.

Claude's proposal path says:

> The proposed agent files couldn't be used, because a path is outside the folder or isn't a file Counterfact can read.

Neither tells the user that credential content caused the skip; the proposal
message suggests a path or file problem. This is a product finding demonstrated
offline. Product wording is outside this harness repair and was not changed.

The Oct 29 decision required every run to flag the planted line. This credential
fixture cannot produce a finding through today's CLI because its file is filtered
before analysis. It now guards filtering only; it no longer covers credential
finding detection. **Arya's decision: should a different fixture restore
credential-detection finding coverage in a follow-up, or should this case remain
filtering-only?** The question was raised during this fix. No fixture or product
filter was changed. Authority and both tool-source citation checks remain active.

## Published CLI evidence

The original archive and source are under `/home/user/tmp/live-suite-run1/`.
The integrity-verified archive was obtained in the prior repair; this review fix
used only local files and cached runtime dependencies, with no installation or
network request.

Published source in `package/dist/`:

- `gatekeeper/console.js:118`: intake endpoint `/api/cli/checks/local`.
- `contract/console.js:88`: upload receipt identities and settlement.
- `cli/mcp.js:242/466`: analysis ID normally absent without inactive findings.
- `cli/relay-check.js:208/217–228`: preparation precedes start/create/reserve.
- `cli/relay-preparation.js:85–89`: wholly rejected proposals throw before agent choice.
- `contract/agent-proposal.js:4`: proposed-files refusal message.
- `contract/agent-choice.js:3`: no-agent refusal message.

The extended offline probe and output are:
`/tmp/live-suite-run1-review/published-cli-evidence.mjs` and
`/tmp/live-suite-run1-review/published-cli-evidence.txt`.
It reads both clean and credential fixtures, with and without
`{agentName, files:[{path:'system_prompt.md', role:'prompt'}]}`. It executes real
published preparation for the filtered cases and asserts the exact thrown errors.
Claude's proposal yields `fromProposal: 0`, `rejected: 1`, reason `secret-content`,
and an ordinary Error, without `kind: 'no_agent'`. Discovery yields AgentChoiceError
with the empty no-agent choice. Fetch is disabled; no CLI command, model, relay or
account is invoked. The updated probe lives in writable `/tmp`, leaving the
original evidence under `/home/user/tmp` untouched.

## Changed files

- `scripts/live-agent-check.mjs`: optional MCP IDs, request-aware refusal validation,
  successful agent turns without refusal echo requirements, installed launch
  forwarding, verified costs/URLs after failures, provider fallback, preview text.
- `scripts/live-agent-cases.mjs`: published refusal messages and the single
  `expect: 'refused'` credential expectation, consumed by validation and assertions.
- `scripts/live-agent-bridge.mjs`: retains the actual analysis proposal for refusal
  validation; transport and billing guards are unchanged.
- `scripts/live-agent-cases.test.mjs`: refusal required even with a cited credential.
- `scripts/live-agent-check.test.mjs`: scripted agents/npm/console test proposal and
  discovery paths, paraphrases, failed turns, missing tool events, incorrect
  refusals, invalid or unrelated proposal paths, admitted credential uploads, and
  complete failed cost rows. The normal
  fake matrix now mirrors filtering: eight case rows, six analyses, two refusals.
  The aggregate-cap negative control uses six potential prices that exceed its cap.
- `scripts/live-agent-probes.mjs` and `.test.mjs`: narrow npm-page block handling.
- `scripts/mcp-start.test.mjs`: existing prefix test uses a local telemetry bridge
  instead of an unavailable port and verifies the acknowledged event. Production
  adapter behavior is unchanged.
- `docs/live-suite-run1.md`: this report, product finding and approval status.

No product source, plugin configuration, workflow, fixture, recording, dependency,
Git metadata or secret was changed. No off switch is needed for harness-only fixes.

## Test evidence

Historical initial-fix evidence remains in `/home/user/tmp/live-suite-run1/`:
`red.txt` (9 failures of 12), `green.txt` (12 passed), `full-offline-initial.txt`
(222/223), `red-mcp-start.txt`, `green-mcp-start.txt`, and `full-offline.txt`
(223/223). The startup test repair addresses the lone initial-suite failure.

Review-fix evidence is in `/tmp/live-suite-run1-review/`:

- `red.txt`: 15 selected tests, 9 expected failures, 6 guards passed.
- `green-initial.txt`: 14 selected tests passed. One obsolete missing-credential-finding
  test was removed; the admitted-and-cited credential rejection tests replace it.
- `red-proposal.txt`: 3 tests, 2 expected failures for invalid/unrelated proposals
  that falsely passed, and 1 passing guard for a harmless relative dot prefix.
- `full-offline-initial.txt`: 227/228 passed. Credential filtering exposed a fake-only
  hang: the deliberate bridge-failure pause also ran after a refusal that never
  triggered a bridge failure. The pause now applies only to non-credential prompts.
- `green.txt`: all 18 final selected tests passed, including both proposal-path
  negatives and the repaired bridge-failure fake. A read-only review identified
  the proposal-path gap; its follow-up found no further material concerns.
- `full-offline.txt`: **231/231 passed**, 0 failures, 0 skips (exit 0), using
  `node --test --test-concurrency=4`. This includes every affected test file.
- `syntax.txt`: `node --check` passed for all 8 changed JavaScript files.
  `git diff --check` passed.
- `tsc.txt`: `npx --offline tsc --noEmit` could not resolve an offline tsc package.
  Running the existing TypeScript 6.0.3 compiler directly (`tsc-existing.txt`) also
  exits 1 because this repository has no tsconfig/project inputs.
- `lint.txt`: `npm run lint` exits 254 because this plugin repository has no
  package.json or lint script. No dependencies or build configuration were added.

## Operator text awaiting Arya approval, verbatim

These initial-fix CI strings remain unapproved:

```text
Total Counterfact analysis estimate cap: $20.00. Per-analysis ceiling $5.00; up to eight analyses. run requires --confirm-paid and COUNTERFACT_LIVE_TEST_KEY.
Cases in BOTH agents: clean (completion and supported coverage), planted-authority (system_prompt.md:6), planted-credential (credential filtering before reservation), tools-agent (tools.json:5 and tools.js:3).
Credential-containing prompt refused before reservation; charged $0.00
SKIP: npm package page not checkable (HTTP 403; external access block)
```

This review fix adds a failure reason:

```text
planted-credential: expected refusal before reservation
```

Failed rows with a verified receipt but no validated provider cost now use the
existing fallback text `provider not reported`, replacing unintended
`provider undefined`. For example (fake-test amounts and illustrative duration):

```text
FAIL Claude | clean | clean: MCP analysis did not complete successfully; estimate $1.00; charged (equals estimate) $1.00; provider not reported; 0.3s
```

The full existing estimate/charged/provider/duration fields and saved URLs can now
appear on failed rows, too. Product refusal messages are validation constants;
product wording is unchanged. This report is also new visible text awaiting approval.
