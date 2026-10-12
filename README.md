# Counterfact for Claude Code

Check an agent's prompt, skills and tools with [Counterfact](https://counterfactlabs.com/product) without leaving Claude Code. Requires Node.js 20 or later.

```sh
claude plugin marketplace add counterfact-labs/claude-plugins
claude plugin install counterfact@counterfact-labs
npx -y @counterfact-labs/cli login
```

In Claude Code, run `/counterfact:counterfact ./support-agent` or ask to check your agent. Claude shows the selected files and the price and asks before starting, including for a free check. After the results, it offers to fix the most serious problem. After you edit an agent, it suggests a check and waits for you to ask.

The plugin runs `npx -y @counterfact-labs/cli@latest mcp` on your computer. A confirmed check keeps running on the server if the local wait stops; find its result on the console's Checks page.

Only the agent's selected files are uploaded. Secret file names and ignored files are skipped. Uploaded files stay with the check until you delete it or your workspace. See the [command-line package](https://www.npmjs.com/package/@counterfact-labs/cli) for commands and Codex setup, and the [privacy policy](https://counterfactlabs.com/privacy).
