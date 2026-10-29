import assert from 'node:assert/strict';
import test from 'node:test';
import * as release from './plugin-release.mjs';

for (const [a, b, expected] of [
  ['0.2.10', '0.2.9', 1],
  ['0.2.9', '0.2.10', -1],
  ['1.10.0', '1.9.99', 1],
  ['1.9.99', '1.10.0', -1],
  ['2.0.0', '1.99.99', 1],
  ['1.99.99', '2.0.0', -1],
  ['0.0.0', '0.0.0', 0],
  ['1.2.3', '1.2.3', 0],
  ['1.2.9007199254740993', '1.2.9007199254740992', 1],
]) {
  test(`compares stable versions ${a} and ${b}`, () => {
    assert.equal(typeof release.compareVersions, 'function', 'release helpers must own version ordering');
    assert.equal(release.compareVersions(a, b), expected);
  });
}
