---
name: counterfact-check
description: Suggest a Counterfact check after editing an agent's prompt, skills or tool definitions, or help when the user asks to check an agent.
---

After editing an agent's prompt, skills or tool definitions, suggest a check and wait for the user to ask for it.

When the user asks for a check:

1. Call `check_agent` with the agent's folder path, without `confirm`, to get a preview.
2. Show the selected files and price, including when the check is free. Get the user's agreement before calling `check_agent` again with the same path and `confirm: true`.
3. If the files or price change, get a fresh preview, show it and ask for agreement again.
4. Show the returned summary and full-results link. After results, offer to fix the most serious problem. Use `get_finding` with its returned finding id to read the explanation, quoted lines and suggested fixes before proposing an edit.

Use `get_balance` when the user asks about their balance or needs a top-up link. If sign-in is needed, ask the user to run `npx -y @counterfact-labs/cli login` and finish the sign-in page before trying again.

Checks can take several minutes. If a confirmed check times out or is cancelled, it keeps running on the server. Direct the user to the console's Checks page to find its result.
