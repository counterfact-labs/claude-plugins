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
a separate temporary HOME and a copy of the fictional agent at
`/home/user/code/counterfact-local/example-agents/bramblewood-support`. That source
path is currently fixed; it must exist on the machine running the script. Temporary
files and command process groups are removed on exit. The default deadline is
1200 seconds per command; override it with `--timeout-seconds` (1-3600).

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
orchestration without network or spending with `node --test scripts/*.test.mjs`.
