import assert from 'node:assert/strict';
import test from 'node:test';
import * as release from './plugin-release.mjs';

for (const [a, b, expected] of [
  ['1.2.3', '1.2.3', 0],
  ['1.2.4', '1.2.3', 1],
  ['1.2.2', '1.2.3', -1],
  ['1.10.0', '1.9.9', 1],
  ['1.9.9', '1.10.0', -1],
  ['2.0.0', '1.99.99', 1],
  ['1.99.99', '2.0.0', -1],
  ['0.2.10', '0.2.9', 1],
  ['1.2.9007199254740993', '1.2.9007199254740992', 1],
  ['1.2.9007199254740992', '1.2.9007199254740993', -1],
]) {
  test(`compareVersions orders ${a} against ${b} as ${expected}`, () => {
    assert.equal(typeof release.compareVersions, 'function');
    assert.equal(release.compareVersions(a, b), expected);
  });
}
