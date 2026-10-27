import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const mcp = read('.mcp.json', true);
const readme = read('README.md');

const prefix = '@counterfact-labs/cli@';
const args = mcp?.mcpServers?.counterfact?.args;
const pin = Array.isArray(args)
  ? args.find((arg) => typeof arg === 'string' && arg.startsWith(prefix))
  : undefined;
if (!pin) fail('The Counterfact CLI argument is missing from .mcp.json.');

const version = pin.slice(prefix.length);
// The plugin ships stable releases only, so exact prerelease pins are rejected too.
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  fail(`The Counterfact CLI pin ${version} must be an exact X.Y.Z version.`);
}

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

// Claude Code caches plugins by their own version, so a CLI bump must bump both.
if (plugin?.version !== version) {
  fail(`plugin.json version ${plugin?.version} must match the CLI pin ${version}.`);
}
// Login is version-independent, so its unpinned README command is allowed.
// Users copy versioned commands; those must match the CLI the plugin runs.
for (const mention of readme.matchAll(/@counterfact-labs\/cli@([^\s`'"]*?)(?=[.,;:)]*(?:\s|$|[`'"]))/g)) {
  if (mention[1] !== version) {
    fail(`README.md mentions @counterfact-labs/cli@${mention[1]}; expected ${version}.`);
  }
}
// A missing startup pin would hide drift even when every remaining mention agrees.
if (!readme.includes('`npx -y ' + prefix + version + ' mcp`')) {
  fail(`README.md must include a pinned npx ${prefix}${version} mcp command.`);
}
console.log(`Plugin, CLI pin, and README versions agree at ${version}.`);
