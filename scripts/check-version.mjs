import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cliPin, compareVersions, isStableVersion } from './plugin-release.mjs';

// The optional root lets tests point the script at a fixture directory.
const root = process.argv[2] ?? fileURLToPath(new URL('../', import.meta.url));
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const read = (path, parseJson = false) => {
  try {
    const contents = readFileSync(join(root, path), 'utf8');
    return parseJson ? JSON.parse(contents) : contents;
  } catch (error) {
    fail(`Could not read ${path}: ${error.message}.`);
  }
};

const plugin = read('.claude-plugin/plugin.json', true);
let release;
try {
  release = cliPin(root);
} catch (error) {
  fail(error.message);
}
const { mcp, pin, version } = release;
const readme = read('README.md');

function* strings(value) {
  if (typeof value === 'string') yield value;
  else if (value && typeof value === 'object') {
    for (const child of Object.values(value)) yield* strings(child);
  }
}
for (const value of strings(mcp)) {
  for (const mention of value.matchAll(/@counterfact-labs\/cli@(\S+)/g)) {
    if (mention[1] !== version) {
      fail(`.mcp.json mentions @counterfact-labs/cli@${mention[1]}; expected ${version}.`);
    }
  }
}

// Wording-only releases bump Claude Code's plugin cache without changing the CLI.
if (!isStableVersion(plugin?.version)) {
  fail(`Plugin version ${plugin?.version} must be an exact X.Y.Z version.`);
}
if (compareVersions(plugin.version, version) < 0) {
  fail(`Plugin version ${plugin.version} must be at least the CLI pin ${version}.`);
}
// Login is version-independent, so its unpinned README command is allowed.
// Users copy versioned commands; those must match the CLI the plugin runs.
for (const mention of readme.matchAll(/@counterfact-labs\/cli@([^\s`'"]*?)(?=[.,;:)]*(?:\s|$|[`'"]))/g)) {
  if (mention[1] !== version) {
    fail(`README.md mentions @counterfact-labs/cli@${mention[1]}; expected ${version}.`);
  }
}
// A missing startup pin would hide drift even when every remaining mention agrees.
if (!readme.includes('`npx -y ' + pin + ' mcp`')) {
  fail(`README.md must include a pinned npx ${pin} mcp command.`);
}
console.log(plugin.version === version
  ? `Plugin, CLI pin, and README versions agree at ${version}.`
  : `Plugin ${plugin.version} uses CLI ${version}; MCP pin and README versions agree.`);
