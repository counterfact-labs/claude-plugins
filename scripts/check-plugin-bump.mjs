import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isStableVersion } from './plugin-release.mjs';

const root = process.argv[2] ?? fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function versionParts(version) {
  if (!isStableVersion(version)) {
    throw new Error(`Plugin version ${version} must be an exact X.Y.Z version.`);
  }
  return version.split('.').map(BigInt);
}

try {
  const base = process.env.PLUGIN_BASE_REF;
  // Reject missing history rather than silently accepting a release without a comparison.
  if (!base || !/^[a-f\d]{40}$|^[a-f\d]{64}$/i.test(base) || /^0+$/.test(base)) {
    throw new Error('A nonzero base revision SHA is required for the plugin bump check.');
  }
  // A PR is compared to its branch point, so unrelated changes on main do not require a bump.
  const comparison = process.env.GITHUB_EVENT_NAME === 'pull_request'
    ? git('merge-base', base, 'HEAD').trim()
    : base;
  // Disabling rename detection includes deletions at protected paths when files move elsewhere.
  const paths = git('diff', '--name-only', '-z', '--no-renames', comparison, 'HEAD', '--').split('\0').filter(Boolean);
  const protectedChange = paths.some((path) => path === '.mcp.json'
    || ['skills/', 'commands/', '.claude-plugin/'].some((prefix) => path.startsWith(prefix)));
  if (!protectedChange) {
    console.log('No plugin release content changed.');
  } else {
    const readVersion = (ref) => JSON.parse(git('show', `${ref}:.claude-plugin/plugin.json`)).version;
    // The target may have released another version since the PR branched.
    const previous = readVersion(base);
    const current = readVersion('HEAD');
    const oldParts = versionParts(previous);
    const newParts = versionParts(current);
    const different = newParts.findIndex((part, index) => part !== oldParts[index]);
    if (different === -1 || newParts[different] < oldParts[different]) {
      throw new Error(`Plugin content changed; plugin version must increase from ${previous} (found ${current}).`);
    }
    console.log(`Plugin content changed with a version increase from ${previous} to ${current}.`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
