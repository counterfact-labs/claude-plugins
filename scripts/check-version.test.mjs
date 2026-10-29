import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./check-version.mjs', import.meta.url));

const cases = [
  { name: 'accepts matching versions', status: 0 },
  {
    name: 'accepts a plugin-only patch release without changing the CLI pin',
    version: '1.2.4',
    status: 0,
    stdout: 'Plugin 1.2.4 uses CLI 1.2.3; MCP pin and README versions agree.\n',
  },
  {
    name: 'accepts a plugin-only minor release',
    version: '1.10.0',
    status: 0,
    stdout: 'Plugin 1.10.0 uses CLI 1.2.3; MCP pin and README versions agree.\n',
  },
  {
    name: 'accepts a plugin-only major release',
    version: '2.0.0',
    status: 0,
    stdout: 'Plugin 2.0.0 uses CLI 1.2.3; MCP pin and README versions agree.\n',
  },
  { name: 'rejects an invalid plugin version', version: 'latest', error: /Plugin version latest.*exact X\.Y\.Z/ },
  { name: 'rejects a prerelease plugin version', version: '1.2.4-rc.1', error: /Plugin version 1\.2\.4-rc\.1.*exact X\.Y\.Z/ },
  {
    name: 'accepts the 0.2.5 plugin, CLI, and README example',
    pin: '0.2.5',
    version: '0.2.5',
    readme: 'The plugin starts `npx -y @counterfact-labs/cli@0.2.5 mcp` on your computer.',
    status: 0,
  },
  {
    name: 'accepts a future release when all three versions advance together',
    pin: '0.2.6',
    version: '0.2.6',
    readme: 'The plugin starts `npx -y @counterfact-labs/cli@0.2.6 mcp` on your computer.',
    status: 0,
  },
  { name: 'rejects latest', pin: 'latest', error: /pin latest.*exact X\.Y\.Z/ },
  { name: 'rejects a range', pin: '^1.2.3', error: /exact X\.Y\.Z/ },
  { name: 'rejects a partial version', pin: '1.2', error: /exact X\.Y\.Z/ },
  { name: 'rejects leading zeroes', pin: '01.2.3', error: /exact X\.Y\.Z/ },
  { name: 'rejects a prerelease', pin: '1.2.3-rc.1', error: /exact X\.Y\.Z/ },
  {
    name: 'rejects a plugin version older than the CLI pin',
    version: '1.2.2',
    error: /Plugin version 1\.2\.2 must be at least the CLI pin 1\.2\.3/,
  },
  {
    name: 'rejects a later mismatched README mention',
    readme: '`@counterfact-labs/cli@1.2.3` and `@counterfact-labs/cli@1.2.2`',
    error: /README\.md.*@counterfact-labs\/cli@1\.2\.2.*expected 1\.2\.3/,
  },
  { name: 'rejects latest in README', readme: '`@counterfact-labs/cli@latest`', error: /README\.md.*@latest/ },
  { name: 'rejects an empty README pin', readme: '`@counterfact-labs/cli@`', error: /README\.md/ },
  { name: 'rejects README without a startup pin', readme: 'Run `npx -y @counterfact-labs/cli login`.', error: /README\.md must include/ },
  {
    name: 'rejects an unpinned startup command even when another mention agrees',
    pin: '0.2.5',
    version: '0.2.5',
    readme: 'CLI version: `@counterfact-labs/cli@0.2.5`. Start `npx -y @counterfact-labs/cli mcp`.',
    error: /README\.md must include a pinned npx .* mcp command/,
  },
  {
    name: 'accepts punctuation after README pins',
    readme: '`npx -y @counterfact-labs/cli@1.2.3 mcp` @counterfact-labs/cli@1.2.3. (@counterfact-labs/cli@1.2.3) `@counterfact-labs/cli@1.2.3,` @counterfact-labs/cli@1.2.3; @counterfact-labs/cli@1.2.3:',
    status: 0,
  },
  {
    name: 'accepts a parenthesized README pin followed by a period',
    readme: '`npx -y @counterfact-labs/cli@1.2.3 mcp` (@counterfact-labs/cli@1.2.3).',
    status: 0,
  },
  { name: 'rejects a README pin with build metadata', readme: '`@counterfact-labs/cli@1.2.3+build`', error: /README\.md/ },
  { name: 'rejects a missing CLI argument', args: ['-y', 'mcp'], error: /missing/ },
  {
    name: 'rejects a renamed server',
    mcp: { mcpServers: { other: { args: ['-y', '@counterfact-labs/cli@1.2.3', 'mcp'] } } },
    error: /missing/,
  },
  {
    name: 'rejects string args',
    mcp: { mcpServers: { counterfact: { args: '-y @counterfact-labs/cli@1.2.3 mcp' } } },
    error: /missing/,
  },
  { name: 'rejects missing mcpServers', mcp: {}, error: /missing/ },
  { name: 'identifies invalid MCP JSON', mcp: '{', error: /Could not read \.mcp\.json: .+/ },
  {
    name: 'rejects a second CLI pin in args',
    args: ['-y', '@counterfact-labs/cli@1.2.3', '@counterfact-labs/cli@latest', 'mcp'],
    error: /\.mcp\.json.*@latest.*expected 1\.2\.3/,
  },
  {
    name: 'rejects a CLI pin in another server',
    mcp: { mcpServers: {
      counterfact: { args: ['-y', '@counterfact-labs/cli@1.2.3', 'mcp'] },
      'counterfact-dev': { args: ['-y', '@counterfact-labs/cli@latest', 'mcp'] },
    } },
    error: /\.mcp\.json.*@latest.*expected 1\.2\.3/,
  },
  {
    name: 'rejects a later pin in a nested string',
    mcp: {
      mcpServers: { counterfact: { args: ['-y', '@counterfact-labs/cli@1.2.3', 'mcp'] } },
      metadata: [null, 42, { note: '@counterfact-labs/cli@1.2.3 @counterfact-labs/cli@latest' }],
    },
    error: /\.mcp\.json.*@latest.*expected 1\.2\.3/,
  },
];

for (const fixture of cases) {
  test(fixture.name, (t) => {
    const root = mkdtempSync(join(tmpdir(), 'check-version-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, '.claude-plugin'));
    writeFileSync(join(root, '.claude-plugin/plugin.json'), JSON.stringify({
      version: fixture.version ?? '1.2.3',
    }));
    const mcp = fixture.mcp ?? {
      mcpServers: {
        counterfact: {
          args: fixture.args ?? ['-y', `@counterfact-labs/cli@${fixture.pin ?? '1.2.3'}`, 'mcp'],
        },
      },
    };
    writeFileSync(join(root, '.mcp.json'), typeof mcp === 'string' ? mcp : JSON.stringify(mcp));
    writeFileSync(join(root, 'README.md'), fixture.readme ??
      '`npx -y @counterfact-labs/cli@1.2.3 mcp` and `@counterfact-labs/cli@1.2.3`');

    // Exercise the CLI boundary; errors must be single-line and period-terminated.
    const result = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
    assert.equal(result.status, fixture.status ?? 1, result.stderr);
    if (fixture.error) {
      assert.equal(result.stdout, '');
      assert.match(result.stderr, fixture.error);
      assert.match(result.stderr, /^[^\r\n]+\.\n$/);
    } else {
      assert.equal(result.stderr, '');
      assert.equal(result.stdout, fixture.stdout ?? `Plugin, CLI pin, and README versions agree at ${fixture.pin ?? '1.2.3'}.\n`);
    }
  });
}
