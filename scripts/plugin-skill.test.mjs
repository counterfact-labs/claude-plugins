import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

function files(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

test('plugin instructions have no references to the retired analyze skill', () => {
  for (const path of [...files(join(root, 'skills')), ...files(join(root, 'commands'))]) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /counterfact-analyze/, path);
  }
});

test('/counterfact:counterfact resolves directly to the full workflow in one skill', () => {
  const manifest = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8'));
  const [namespace, command] = '/counterfact:counterfact'.slice(1).split(':');
  assert.equal(manifest.name, namespace);
  const path = join(root, 'skills', command, 'SKILL.md');
  assert.ok(existsSync(path), 'the namespaced skill must exist');
  assert.equal(existsSync(join(root, 'commands', command + '.md')), false, 'one owner must carry the workflow');
  const text = readFileSync(path, 'utf8');
  assert.match(text, /^name: counterfact$/m);
  assert.match(text, /^argument-hint: \[agent-folder\]$/m);
  const [, opening, body] = text.split(/^---\n[\s\S]*?\n---\n\n([^\n]+)\n\n/);
  assert.equal(opening, 'When the user runs `/counterfact:counterfact`, analyze the agent in `$ARGUMENTS`, or in the current folder when no path is supplied, starting with sign-in.');
  // The entire workflow from the pre-move skill at 3fd8e14 must stay byte for byte.
  assert.equal(createHash('sha256').update(body).digest('hex'),
    'c3b0298e80f08aa3620b9334476f0b166ab2c4b07616a54de46dc6af32ddf0ba');
});
