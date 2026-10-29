# Counterfact for Claude Code

Requires Node.js 22 or later.

1. Sign in (free, no card): `npx -y @counterfact-labs/cli login`. You can skip this; `/counterfact` asks the first time.

2. Install:

   ```sh
   claude plugin marketplace add counterfact-labs/claude-plugins
   claude plugin install counterfact@counterfact-labs
   ```

   If `/counterfact` doesn't show up yet, run `/reload-plugins` (or restart Claude Code).

3. Allow once, so auto mode doesn't stop analyses: in Claude Code run `/permissions`, choose Allow, and add `mcp__plugin_counterfact_counterfact__analyze_agent`. Only the agent files you choose, and the project files they import, are sent. Secret and ignored files are skipped. `/counterfact` offers to do this for you the first time.

   If you use Claude Code's sandbox, allow relay.counterfactlabs.com and app.counterfactlabs.com when Claude Code asks, or add both to the sandbox's allowed domains.

4. Run: `/counterfact:counterfact ./support-agent`, or ask Claude to analyze your agent.

The plugin uses `https://app.counterfactlabs.com` by default. Run the login command again after moving from the old address; saved sign-in belongs to the server address.

When you ask for an analysis, Claude runs it and charges your balance. Each analysis in a skipped-files plan (groups of files an earlier analysis left out because they were too large to read) is charged separately. If your balance doesn't cover it, Claude shows a link to top up; prices are on the top-up page. After results, Claude shows the full-results link and every finding, then offers to fix the most serious finding, preferring ones that affect the agent's users. It uses the finding's explanation, quoted lines, and suggested fixes. After edits, it suggests an analysis and waits for you to ask for it.

The plugin starts `npx -y @counterfact-labs/cli@0.2.9 mcp` on your computer (an exact version) and allows up to 15 minutes per tool call. Cancelling the tool call or reaching that limit stops the analysis. If an analysis is stopped before it finishes, run it again. Results appear on the project's findings page at the link Claude shows. Run `claude plugin update counterfact@counterfact-labs` to pick up new plugin releases.

The analysis runs on your computer. Model requests go encrypted to Counterfact's sealed relay, which we can't read into. Your sign-in token, repository facts, file names and sizes, and findings with code quotes are sent to the Counterfact web console.

Counterfact keeps the findings from each analysis until it or the workspace is deleted. See the [command-line package](https://www.npmjs.com/package/@counterfact-labs/cli) for commands, privacy details, and Codex setup.

The file layout follows the [Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference) and [marketplace guide](https://code.claude.com/docs/en/plugin-marketplaces). Claude Code namespaces the command as `/counterfact:counterfact`.
