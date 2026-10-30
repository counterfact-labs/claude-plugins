import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('git scan expands the deliberate fixture fingerprint for only the scanned commits', t => {
  const root = mkdtempSync(join(tmpdir(), 'fixture-key-scan-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const parsed = spawnSync('python3', ['-c', 'import json,sys,yaml; print(json.dumps(yaml.load(sys.stdin,Loader=yaml.BaseLoader)))'], {
    input: readFileSync(new URL('../.github/workflows/gitleaks.yml', import.meta.url), 'utf8'), encoding: 'utf8', timeout: 5000,
  });
  assert.equal(parsed.status, 0, parsed.stderr);
  const program = JSON.parse(parsed.stdout).jobs.scan.steps.find(s => s.run).run;
  const bin = join(root, 'bin'); mkdirSync(bin);
  const commit = 'b'.repeat(40);
  writeFileSync(join(bin, 'git'), '#!/bin/bash\nif [[ "$1" == rev-list ]]; then printf "%s\\n%s\\n" "$FAKE_COMMIT" "$CHANGED_COMMIT"; elif [[ "$1" == show ]]; then if [[ "$2" == c* ]]; then cat "$REPLACEMENT_FILE"; else cat "$FIXTURE_FILE"; fi; fi\n', { mode: 0o755 });
  const fixture=new URL('./fixtures/live-agent-credential/system_prompt.md',import.meta.url);
  const replacement=join(root,'replacement.md');
  writeFileSync(replacement,readFileSync(fixture,'utf8').replace(/ghp_\w+/, 'gh'+'p_'+ 'z'.repeat(36)));
  writeFileSync(join(bin, 'docker'), '#!/bin/bash\ncp .gitleaksignore "$CAPTURE"\n', { mode: 0o755 });
  writeFileSync(join(root, '.gitleaksignore'), readFileSync(new URL('../.gitleaksignore', import.meta.url)));
  const result = spawnSync('bash', ['--noprofile', '--norc', '-c', program], {
    env: { PATH: bin + ':' + process.env.PATH, BASE_SHA: 'a'.repeat(40), HEAD_SHA: commit, FAKE_COMMIT: commit, CHANGED_COMMIT:'c'.repeat(40), FIXTURE_FILE:fixture.pathname, REPLACEMENT_FILE:replacement, GITHUB_WORKSPACE: root, CAPTURE: join(root, 'captured') },
    cwd: root, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  const ignored=readFileSync(join(root,'captured'),'utf8');
  assert.ok(ignored.includes(commit + ':scripts/fixtures/live-agent-credential/system_prompt.md:github-pat:12'));
  assert.ok(!ignored.includes('c'.repeat(40)+':scripts/fixtures/live-agent-credential/system_prompt.md:github-pat:12'),'a changed credential at the same location must never be exempt');
});
