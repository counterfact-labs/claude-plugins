import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const mcp = JSON.parse(readFileSync(new URL('../.mcp.json', import.meta.url), 'utf8'));
const cliPin = mcp.mcpServers.counterfact.args.find((arg) => arg.startsWith('@counterfact-labs/cli@'));
assert.ok(cliPin, '.mcp.json must supply a CLI pin');

test('README includes the exact customer Codex config block in a TOML fence', () => {
  const configBlock = [
    '```toml',
    '[mcp_servers.counterfact]',
    'command = "npx"',
    `args = ["-y", "${cliPin}", "mcp"]`,
    'startup_timeout_sec = 120',
    'tool_timeout_sec = 900',
    'default_tools_approval_mode = "approve"',
    '```',
  ].join('\n');
  assert.ok(readme.includes(configBlock), 'README must include the exact fenced customer config block');
});

test('README Codex config block uses the CLI pin from .mcp.json', () => {
  const configBlock = readme.match(/```toml\n(\[mcp_servers\.counterfact\][\s\S]*?)\n```/)?.[1];
  assert.ok(configBlock, 'README must include the Counterfact MCP server config block');
  const documentedPin = configBlock.match(/^args = \["-y", "(@counterfact-labs\/cli@[^"\n]+)", "mcp"\]$/m)?.[1];
  assert.equal(documentedPin, cliPin);
});

test('README links to the Counterfact setup page', () => {
  assert.ok(readme.includes('[Counterfact setup page](https://counterfactlabs.com/setup)'),
    'README must link directly to the setup page');
});

test('README removes the website root pointer for Codex setup', () => {
  assert.ok(!readme.includes('[Counterfact website](https://counterfactlabs.com) for Codex setup'),
    'README must remove the website root pointer for Codex setup');
});
