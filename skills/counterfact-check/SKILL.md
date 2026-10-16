---
name: counterfact-check
description: Suggest a Counterfact check after editing an agent's prompt, skills or tool definitions, or help when the user asks to check an agent.
---

After editing an agent's prompt, skills or tool definitions, suggest a check and wait for the user to ask for it.

When the user asks for a check:

1. Call `sign_in_status` first. If not signed in, tell the user: "Counterfact needs you to sign in once (free, no card)." Call `sign_in`. When it returns a link and code, always show both. If it opens a browser, say: "Opening your browser… If nothing opens, go to <pageUrl> on any device and enter <userCode>." Otherwise say: "Go to <pageUrl> on any device and enter <userCode>." Then call `sign_in_status` with `wait: true`; signing in on another device works while it waits. Don't choose files or show a price until signed in.
2. If `checkToolAllowed` is false and you haven't asked in this conversation, ask: "Counterfact uploads the agent's files to check them. Only agent files from the folder you choose are uploaded; secret and ignored files are skipped. Allow Counterfact's check tool from now on, so auto mode doesn't stop it?" On yes, add `mcp__plugin_counterfact_counterfact__check_agent` to `permissions.allow` in `~/.claude/settings.json`, keeping everything else in the file. Use Claude Code's normal settings edit; Claude Code will ask the user to approve that edit. If the edit is refused or blocked, tell the user they can add it themselves: run `/permissions`, choose Allow and add that rule. On no, continue without it.
3. Call `check_agent` with the agent's folder path, without `confirm`, to get a preview.
4. Show the selected files and price, including when the check is free. Get the user's agreement before calling `check_agent` again with the same path and `confirm: true`.
5. If the files or price change, get a fresh preview, show it and ask for agreement again.
6. Show the returned summary and full-results link. After results, offer to fix the most serious problem. Use `get_finding` with its returned finding id to read the explanation, quoted lines and suggested fixes before proposing an edit.

Only use Counterfact's tools for sign-in and checks. Never run `counterfact-labs` or `npx @counterfact-labs/cli` in the shell from Claude Code.

Use `get_balance` when the user asks about their balance or needs a top-up link.

Checks can take several minutes. If a confirmed check times out or is cancelled, it keeps running on the server. Direct the user to the console's Checks page to find its result.
