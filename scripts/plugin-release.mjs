import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function isStableVersion(version) {
  // The plugin ships stable releases only, so exact prerelease pins are rejected too.
  return typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version);
}

// Callers validate stable X.Y.Z versions before comparing them.
export function compareVersions(a, b) {
  const aParts = a.split('.').map(BigInt);
  const bParts = b.split('.').map(BigInt);
  const difference = aParts.findIndex((part, index) => part !== bParts[index]);
  return difference === -1 ? 0 : aParts[difference] > bParts[difference] ? 1 : -1;
}

export function cliPin(root) {
  let mcp;
  try {
    mcp = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8'));
  } catch (error) {
    throw new Error(`Could not read .mcp.json: ${error.message}.`);
  }

  const prefix = '@counterfact-labs/cli@';
  const args = mcp?.mcpServers?.counterfact?.args;
  const pin = Array.isArray(args)
    ? args.find((arg) => typeof arg === 'string' && arg.startsWith(prefix))
    : undefined;
  if (!pin) throw new Error('The Counterfact CLI argument is missing from .mcp.json.');

  const version = pin.slice(prefix.length);
  if (!isStableVersion(version)) {
    throw new Error(`The Counterfact CLI pin ${version} must be an exact X.Y.Z version.`);
  }
  return { mcp, pin, version };
}
