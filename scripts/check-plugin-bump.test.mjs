import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./check-plugin-bump.mjs', import.meta.url));
const base = 'a'.repeat(40);
const ancestor = 'b'.repeat(40);

// Git output is the external boundary. No test creates commits or changes this repository's index.
const git = `#!${process.execPath}
const assert = require('node:assert/strict');
const fixture = JSON.parse(process.env.FAKE_GIT_FIXTURE);
const args = process.argv.slice(2);
const base = '${base}';
const ancestor = '${ancestor}';
if (fixture.unavailable) process.exit(128);
if (args[0] === 'merge-base') {
  assert.deepEqual(args, ['merge-base', base, 'HEAD']);
  console.log(ancestor);
} else if (args[0] === 'diff') {
  assert.deepEqual(args, ['diff', '--name-only', '-z', '--no-renames', fixture.event === 'pull_request' ? ancestor : base, 'HEAD', '--']);
  process.stdout.write(fixture.paths.join('\\0') + (fixture.paths.length ? '\\0' : ''));
} else if (args[0] === 'show') {
  const ref = args[1];
  assert.deepEqual(args, ['show', ref]);
  assert.ok([base + ':.claude-plugin/plugin.json', ancestor + ':.claude-plugin/plugin.json', 'HEAD:.claude-plugin/plugin.json'].includes(ref));
  console.log(JSON.stringify({ version: ref.startsWith('HEAD:') ? fixture.version : ref.startsWith(base + ':') ? (fixture.targetVersion ?? fixture.previous) : fixture.previous }));
} else {
  throw new Error('Unexpected git command: ' + args.join(' '));
}
`;

function run(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'plugin-bump-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'bin/git'), git);
  chmodSync(join(root, 'bin/git'), 0o755);
  const fixture = { paths: ['skills/example/SKILL.md'], previous: '1.2.3', version: '1.2.3', event: 'pull_request', ...options };
  return spawnSync(process.execPath, [script, root], {
    encoding: 'utf8', timeout: 5000,
    env: { ...process.env, PATH: join(root, 'bin'), GITHUB_EVENT_NAME: fixture.event,
      PLUGIN_BASE_REF: options.base ?? base, FAKE_GIT_FIXTURE: JSON.stringify(fixture) },
  });
}

for (const path of ['skills/example/SKILL.md', 'commands/example.md', '.mcp.json', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json']) {
  test(`rejects ${path} changes with no version increase`, (t) => {
    const result = run(t, { paths: [path] });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Plugin content changed.*version.*1\.2\.3/);
  });
}

for (const [name, options] of [
  ['patch bump', { version: '1.2.4' }],
  ['minor bump', { version: '1.10.0', previous: '1.9.9' }],
  ['major bump', { version: '2.0.0' }],
  ['unrelated changes', { paths: ['README.md', 'scripts/check-version.mjs', '.github/workflows/version.yml'] }],
  ['no changes', { paths: [] }],
  ['push with bump', { event: 'push', version: '1.2.4' }],
]) {
  test(`accepts ${name}`, (t) => {
    const result = run(t, options);
    assert.equal(result.status, 0, result.stderr);
  });
}

for (const [name, options, error] of [
  ['push without a bump', { event: 'push' }, /Plugin content changed/],
  ['version downgrade', { version: '1.2.2' }, /must increase/],
  ['rename out of a protected path', { paths: ['skills/old/SKILL.md', 'archive/SKILL.md'] }, /Plugin content changed/],
  ['protected filename with a newline', { paths: ['skills/new\nname/SKILL.md'] }, /Plugin content changed/],
  ['missing baseline', { base: '' }, /base revision/],
  ['all-zero baseline', { base: '0'.repeat(40) }, /base revision/],
  ['invalid baseline', { base: '--help' }, /base revision/],
  ['unavailable history', { unavailable: true }, /git/],
  ['malformed version', { version: 'latest' }, /version.*X\.Y\.Z/],
]) {
  test(`rejects ${name}`, (t) => {
    const result = run(t, options);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, error);
  });
}

for (const targetVersion of ['1.2.4', '1.2.5']) {
  test(`rejects a PR bump already superseded by target version ${targetVersion}`, (t) => {
    const result = run(t, { previous: '1.2.3', version: '1.2.4', targetVersion });
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /Plugin content changed.*must increase/);
  });
}
