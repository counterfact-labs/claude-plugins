---
name: counterfact-analyze
description: Suggest a Counterfact analysis after editing an agent's prompt, skills, or tool definitions, or help when the user asks to analyze an agent.
---

After editing an agent's prompt, skills, or tool definitions, suggest an analysis and wait for the user to ask for it.

When the user asks for an analysis:

1. Call `sign_in_status` first. If not signed in, tell the user: "Counterfact needs you to sign in once (free, no card)." Call `sign_in`. When it returns a link and code, always show both. If it opens a browser, say: "Opening your browser… If nothing opens, go to <pageUrl> on any device and enter <userCode>." Otherwise say: "Go to <pageUrl> on any device and enter <userCode>." Then call `sign_in_status` with `wait: true`; signing in on another device works while it waits. Don't start an analysis until the user is signed in.
2. If `analyzeToolAllowed` is false and you haven't asked in this conversation, ask: "The analysis runs on your computer. Model requests go encrypted to Counterfact's sealed relay, and only findings are saved to the console. Only agent files from the folder you choose are sent; secret and ignored files are skipped. Allow Counterfact's analysis tool from now on, so auto mode doesn't stop it?" On yes, add `mcp__plugin_counterfact_counterfact__analyze_agent` to `permissions.allow` in `~/.claude/settings.json`, keeping everything else in the file. Use Claude Code's normal settings edit; Claude Code will ask the user to approve that edit. If the edit is refused or blocked, tell the user they can add it themselves: run `/permissions`, choose Allow, and add that rule. On no, continue without it.
3. Before running, inspect the agent folder for uncommitted changes. Counterfact analyzes only committed files. If the folder has uncommitted changes, tell the user an analysis uses the committed version and offer to commit first. Wait until the changes are committed before running.
4. When the user asks for an analysis, call `analyze_agent` with the agent's folder path. Each call runs one analysis and charges the user's balance at the listed price, so call it only when the user has asked, and don't ask them to approve a price first. Never call a preview tool for a price or pass `confirm`. If the balance doesn't cover it, show the returned message, which includes the top-up link.
5. The tool returns finding ids and a link, with no summary text. Show the full-results link to the project's findings page. Read the returned findings with `get_finding`, then offer to fix the most serious problem, using its explanation, quoted lines, and suggested fixes before proposing an edit.

Only use Counterfact's tools for sign-in and analyses. Never run `counterfact-labs` or `npx @counterfact-labs/cli` in the shell from Claude Code.

Use `get_balance` when the user asks about their balance or needs a top-up link.

An analysis can take several minutes. Claude Code cancels a tool call after 15 minutes. If the tool call is cancelled or times out, the analysis stops. Run it again only when the user asks.
