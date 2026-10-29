# Counterfact for Claude Code

Requires Node.js 22 or later.

1. Sign in (free, no card): `npx -y @counterfact-labs/cli login`. You can skip this; `/counterfact` asks the first time.

2. Install:

   ```sh
   claude plugin marketplace add counterfact-labs/claude-plugins
   claude plugin install counterfact@counterfact-labs
   ```

   If `/counterfact` doesn't show up yet, run `/reload-plugins` (or restart Claude Code).

3. Allow once, so auto mode doesn't stop analyses: in Claude Code run `/permissions`, choose Allow, and add `mcp__plugin_counterfact_counterfact__analyze_agent`. Only agent files from the folder you choose are sent; secret and ignored files are skipped. `/counterfact` offers to do this for you the first time.

   If you use Claude Code's sandbox, allow relay.counterfactlabs.com and app.counterfactlabs.com when Claude Code asks, or add both to the sandbox's allowed domains.

4. Run: `/counterfact:counterfact ./support-agent`, or ask Claude to analyze your agent.

The plugin uses `https://app.counterfactlabs.com` by default. Run the login command again after moving from the old address; saved sign-in belongs to the server address.

When you ask for an analysis, Claude runs it and charges your balance. If your balance doesn't cover it, Claude shows a link to top up; prices are on the top-up page. After results, Claude shows the full-results link and every finding, then offers to fix the most serious finding, preferring ones that affect the agent's users. It uses the finding's explanation, quoted lines, and suggested fixes. After edits, it suggests an analysis and waits for you to ask for it.

The plugin starts `npx -y @counterfact-labs/cli@0.2.9 mcp` on your computer (an exact version, updated with each release) and allows up to 15 minutes per tool call. Cancelling the tool call or reaching that limit stops the analysis. If an analysis is stopped before it finishes, run it again. Results appear on the project's findings page at the link Claude shows. The plugin version follows the CLI version, so `claude plugin update counterfact@counterfact-labs` picks up new releases.

The analysis runs on your computer. Model requests go encrypted to Counterfact's sealed relay, which we can't read into. Your sign-in token, repository facts, file names and sizes, and findings with code quotes are sent to your console.

Counterfact keeps the findings from each analysis until it or the workspace is deleted. See the [command-line package](https://www.npmjs.com/package/@counterfact-labs/cli) for commands, privacy details, and Codex setup.

The file layout follows the [Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference) and [marketplace guide](https://code.claude.com/docs/en/plugin-marketplaces). Claude Code namespaces the command as `/counterfact:counterfact`.

## Release checks

The [live agent workflow](.github/workflows/live-agent-check.yml) runs on a
published plugin release, manual `workflow_dispatch`, and Mondays at 06:23 UTC.
At minute 17 of every hour, it also reads the latest `@counterfact-labs/cli`
version from npm and runs an analysis when that version differs from the last
attempted analysis. Once the analysis step runs, its version is saved in an
Actions cache even if the analysis fails, so hourly polling does not retry the
same failing version. Weekly, manual, and release runs still retry. A missing or
evicted cache causes a new analysis. Release runs save caches on their tag ref;
scheduled runs use the default branch and cannot read those tag caches, so the
next hourly poll may analyze the same version again
([GitHub trigger reference](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule),
[cache scope reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#restrictions-for-accessing-a-cache)).

The job installs Claude Code 2.1.312 and Codex 0.165.0, uses SHA-pinned actions
with read-only repository permission, and runs the script with
`--max-dollars 5` and a 900-second deadline per command. Only the paid analysis
job enters the concurrency group; an hourly poll with no new version cannot
replace a pending analysis. GitHub allows one active job and one pending job in
the group, replacing an older pending job when another analysis arrives.
Missing required secrets produce a warning before checkout or installation;
only secret names are printed.

Configure these Actions secrets in **claude-plugins**:

| Secret | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Authenticate Claude Code with Anthropic. |
| `OPENAI_API_KEY` | Authenticate Codex with OpenAI. |
| `COUNTERFACT_LIVE_TEST_KEY` | Authenticate the Counterfact test account. |

After each CLI or plugin release, preview the live analysis with
`scripts/live-agent-check.sh check`. This prints both commands, prompts, isolation,
and cost guard without making network calls or launching coding agents.

To run it, install `claude`, `codex`, and `npx`, and provide provider credentials
through the environment (`ANTHROPIC_API_KEY` and `CODEX_API_KEY` or
`OPENAI_API_KEY`). Supply the test account's CLI key as
`COUNTERFACT_LIVE_TEST_KEY` through your environment, then run:

```sh
scripts/live-agent-check.sh run --confirm-paid --max-dollars 5
```

The script installs the Claude plugin from the published marketplace's `main`
branch and uses the published CLI's `latest` MCP server for Codex. Each agent gets
a separate temporary HOME and a copy of the source selected by `--agent-dir`.
Without that option, the source remains
`/home/user/code/counterfact-local/example-agents/bramblewood-support` for existing
local runs. Temporary files and command process groups are removed on exit.
The default deadline is 1200 seconds per command; override it with
`--timeout-seconds` (1-3600).

GitHub-hosted runners pass `--agent-dir scripts/fixtures/live-agent` to use
the [fictional agent](scripts/fixtures/live-agent/system_prompt.md) written for
this repository. It contains one prompt file, with no evals, expected answers,
or content from the private local repository. Use the same option for local
runs with this fixture.

The default $5 cap covers the combined Counterfact analysis estimates only.
Claude and Codex provider charges are separate and are not capped by this script.
The console's `create` reply (`state: quoted`) has no price field. The script must
reserve first to read `priceMicro`, so a temporary balance hold can occur before
an over-cap or invalid estimate is refused. It withholds the relay capability
and releases that hold before model work. A charge shown as
`charged (equals estimate)` is inferred from the upload's `settlement: charged`
and the reserved price; an independently reported charged amount is unavailable.

The copied example's analysis data goes to the Counterfact console and relay.
The prompts go to Anthropic and OpenAI using the provider credentials in the
environment. The test key stays in the parent process's memory, is never printed
or saved, and authenticates only console HTTPS requests. Sign-in uses a preload
that intercepts the published CLI's credential-file read and console HTTP calls.
This depends on CLI internals; a change can break the adapter. A sign-in failure
is reported separately so you can verify the test key and adapter compatibility.

Both agents must produce real MCP completion evidence, a CLI summary, a matching
console upload receipt, and the findings URL. Duplicate analysis calls and bridge
failures stop the command immediately. The script prints a compact pass/fail
report with durations and exits nonzero if either agent fails. Test the local
orchestration without network or spending with
`node --test --test-concurrency=4 scripts/*.test.mjs`. The workflow parser test
requires Python 3 with PyYAML (`python3 -m pip install PyYAML`).
