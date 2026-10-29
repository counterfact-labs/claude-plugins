# Consent wording proposals for 29 October 2026

Status: **Pending Arya's approval for every sentence below.** These repository proposals are not approval to merge or publish.

## Finding 13: skipped-files charges

Fact to confirm: The per-group charge is decided on the server and is unverified (audit finding 11 / REPORT.md:96). Starting one client run per group does not establish how the server charges those runs. Confirm the server's per-group charging behavior before either the README or skill charge disclosure ships. Arya's wording approval alone does not confirm this billing fact.

README.md, analysis paragraph.

Was:

> When you ask for an analysis, Claude runs it and charges your balance.

Recommended option (pending):

> When you ask for an analysis, Claude runs it and charges your balance. Each analysis in a skipped-files plan (groups of files an earlier analysis left out because they were too large to read) is charged separately.

Alternative with the balance named (pending):

> When you ask for an analysis, Claude runs it and charges your balance. Each analysis in a skipped-files plan (groups of files an earlier analysis left out because they were too large to read) is charged separately to your balance.

The recommended option avoids repeating "your balance" in adjacent sentences. Both options refer to files omitted because of size or reading limits; they do not include secret or ignored files.

skills/counterfact-analyze/SKILL.md, analysis step. Both options are pending. Place the added sentence at the end of step 5 to keep the `analyze_agent` instructions together.

Was:

> Each call runs one analysis and charges the user's balance at the listed price, so call it only when the user has asked, and don't ask them to approve a price first.

Recommended instruction (pending):

> If `analyze_skipped_files` proposes a plan, tell the user that each analysis in the plan is charged separately to their balance.

Alternative statement (pending):

> Each analysis in a skipped-files plan is charged separately to your balance.

The recommended instruction tells Claude when to explain the charge and whose balance is charged. Neither option adds a price approval prompt.

## Plugin-only release wording

The proposed policy allows plugin and CLI versions to advance separately. Plugin 0.2.10 runs CLI 0.2.9. The validator requires a stable plugin version at least as new as the CLI pin, rather than requiring equality. This policy change also needs Arya's decision; the wording below is pending.

README.md, startup sentence.

Was:

> The plugin starts `npx -y @counterfact-labs/cli@0.2.9 mcp` on your computer (an exact version, updated with each release) and allows up to 15 minutes per tool call.

Proposed (pending):

> The plugin starts `npx -y @counterfact-labs/cli@0.2.9 mcp` on your computer (an exact version) and allows up to 15 minutes per tool call.

README.md, plugin-update sentence.

Was:

> The plugin version follows the CLI version, so `claude plugin update counterfact@counterfact-labs` picks up new releases.

Proposed (pending):

> Run `claude plugin update counterfact@counterfact-labs` to pick up new plugin releases.

## Finding 27: privacy notice

README.md, permission setup step, and skills/counterfact-analyze/SKILL.md, permission notice scope and filtering assurance.

Was:

> Only agent files from the folder you choose are sent; secret and ignored files are skipped.

Proposed (pending):

> Only the agent files you choose, and the project files they import, are sent. Secret and ignored files are skipped.

README.md, privacy paragraph, and skills/counterfact-analyze/SKILL.md, permission notice destination.

Was:

> Your sign-in token, repository facts, file names and sizes, and findings with code quotes are sent to your console.

Proposed (pending):

> Your sign-in token, repository facts, file names and sizes, and findings with code quotes are sent to the Counterfact web console.

skills/counterfact-analyze/SKILL.md, complete permission notice instruction and attribution.

Was:

> If `analyzeToolAllowed` is false and you haven't asked in this conversation, first state Counterfact's own wording verbatim: "Counterfact says: The analysis runs on your computer. Model requests go encrypted to Counterfact's sealed relay, which we can't read into. Your sign-in token, repository facts, file names and sizes, and findings with code quotes are sent to your console. Only agent files from the folder you choose are sent; secret and ignored files are skipped."

Proposed (pending):

> If `analyzeToolAllowed` is false and you haven't asked in this conversation, first state Counterfact's privacy notice: "Counterfact says: The analysis runs on your computer. Model requests go encrypted to Counterfact's sealed relay, which we can't read into. Your sign-in token, repository facts, file names and sizes, and findings with code quotes are sent to the Counterfact web console. Only the agent files you choose, and the project files they import, are sent. Secret and ignored files are skipped."

The privacy scope and console name follow audit finding 27's proposed wording. Retention remains unchanged. No wording in this document is approved yet.
