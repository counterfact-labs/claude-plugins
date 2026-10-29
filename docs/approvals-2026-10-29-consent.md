# Consent wording decisions for 29 October 2026

Status: Finding 13 was withdrawn by Arya; finding 27 was approved by Arya on October 29, 2026.

## Finding 13: skipped-files charges

**Withdrawn by Arya on October 29, 2026.**

The added skipped-files charge sentences are removed from README.md and skills/counterfact-analyze/SKILL.md. Their analysis paragraphs stay exactly as on main. The charge is explained on the console's top-up screen instead.

## Finding 27: privacy notice

**Approved by Arya on October 29, 2026.**

README.md, permission setup step, and skills/counterfact-analyze/SKILL.md, permission notice scope and filtering assurance.

Was:

> Only agent files from the folder you choose are sent; secret and ignored files are skipped.

Approved:

> Only the agent files you choose, and the project files they import, are sent. Secret and ignored files are skipped.

README.md, privacy paragraph, and skills/counterfact-analyze/SKILL.md, permission notice destination.

Was:

> Your sign-in token, repository facts, file names and sizes, and findings with code quotes are sent to your console.

Approved:

> Your sign-in token, repository facts, file names and sizes, and findings with code quotes are sent to the Counterfact web console.

skills/counterfact-analyze/SKILL.md, complete permission notice instruction and attribution.

Was:

> If `analyzeToolAllowed` is false and you haven't asked in this conversation, first state Counterfact's own wording verbatim: "Counterfact says: The analysis runs on your computer. Model requests go encrypted to Counterfact's sealed relay, which we can't read into. Your sign-in token, repository facts, file names and sizes, and findings with code quotes are sent to your console. Only agent files from the folder you choose are sent; secret and ignored files are skipped."

Approved:

> If `analyzeToolAllowed` is false and you haven't asked in this conversation, first state Counterfact's privacy notice: "Counterfact says: The analysis runs on your computer. Model requests go encrypted to Counterfact's sealed relay, which we can't read into. Your sign-in token, repository facts, file names and sizes, and findings with code quotes are sent to the Counterfact web console. Only the agent files you choose, and the project files they import, are sent. Secret and ignored files are skipped."

The privacy scope, console name, and Counterfact's privacy notice attribution above were approved by Arya on October 29, 2026. Retention remains unchanged.
