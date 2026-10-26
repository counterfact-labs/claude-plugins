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

When you ask for an analysis, Claude runs it and charges your balance. If your balance doesn't cover it, Claude shows a link to top up; prices are on the top-up page. After results, Claude offers to fix the most serious problem using the finding's explanation, quoted lines, and suggested fixes. After edits, it suggests an analysis and waits for you to ask for it.

Counterfact analyzes only committed files. If the folder has uncommitted changes, Claude offers to commit them first.

The plugin starts `npx -y @counterfact-labs/cli@0.2.2 mcp` on your computer (an exact version, updated with each release) and allows up to 15 minutes per tool call. Cancelling the tool call or reaching that limit stops the analysis. If an analysis is stopped before it finishes, run it again. Results appear on the project's findings page at the link Claude shows.

The analysis runs on your computer. Model requests go encrypted to Counterfact's sealed relay, which we can't read into. Your sign-in token, repository facts, file names and sizes, and findings with code quotes are sent to your console.

Counterfact keeps the findings from each analysis until it or the workspace is deleted. See the [command-line package](https://www.npmjs.com/package/@counterfact-labs/cli) for commands, privacy details, and Codex setup.

The file layout follows the [Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference) and [marketplace guide](https://code.claude.com/docs/en/plugin-marketplaces). Claude Code namespaces the command as `/counterfact:counterfact`.
