# Counterfact for Claude Code

Requires Node.js 20 or later. Once the npm package and marketplace are published, install from the Counterfact Labs marketplace:

```sh
claude plugin marketplace add counterfact-labs/claude-plugins
claude plugin install counterfact@counterfact-labs
```

If `/counterfact` doesn't show up yet, run `/reload-plugins` (or restart Claude Code).

```sh
npx -y @counterfact-labs/cli login
```

The plugin uses `https://app.counterfactlabs.com` by default. Run the login command again after moving from the old address; saved sign-in belongs to the server address.

In Claude Code, run `/counterfact:counterfact ./support-agent` or ask to check your agent. Claude shows the selected files and price and asks for agreement before starting, including for a free check. After results, it offers to fix the most serious problem using the finding's explanation and suggested fixes. After edits, it suggests a check and waits for you to ask for it.

The plugin starts `npx -y @counterfact-labs/cli@latest mcp` on your computer and allows up to 15 minutes per tool call. A confirmed check keeps running on the server if the local wait stops. Find its result on the console's Checks page.

Only selected agent files are uploaded; secret file names and ignored files are skipped. Uploaded files stay with the check until it or the workspace is deleted. See the [command-line package](https://www.npmjs.com/package/@counterfact-labs/cli) for commands, privacy details and Codex setup.

For local validation, run `claude plugin validate packages/claude-plugin/.claude-plugin/plugin.json` and `claude plugin validate packages/claude-plugin/.claude-plugin/marketplace.json` from the product repository root. To try the plugin before publishing, start `claude --plugin-dir ./packages/claude-plugin`; its MCP server still needs the published npm package.

To publish the marketplace, create a small public repository; the recommended name is `counterfact-labs/claude-plugins`. Copy only `.claude-plugin/`, `.mcp.json`, `commands/`, `skills/` and this README from `packages/claude-plugin/` into that repository's root. The marketplace resolves the plugin from `./`, so it works without the product source. Validate both JSON files in the copied folder before publishing. The install commands above become available after the public repository and npm package are published.

The file layout follows the [Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference) and [marketplace guide](https://code.claude.com/docs/en/plugin-marketplaces). Claude Code namespaces the command as `/counterfact:counterfact`.

To release the npm package from the product repository, set its version in `packages/cli/package.json`, commit the intended release and run `bash scripts/release-cli.sh`. The script requires a clean working tree, builds and tests the CLI, runs the plugin and release tests, checks types and lint, checks the tree again, then publishes the CLI with public access. It stops on any failed check. Publishing requires access to the `counterfact-labs` npm organisation.
