import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePack } from '../server/content/validate.ts';
import { makeRng } from '../server/content/rng.ts';
import pack from '../server/content/packs/intro-probability/index.ts';

test('intro-probability pack passes validation and 1,000-sample property tests', () => {
  assert.deepEqual(validatePack(pack, 1000), []);
  assert.equal(pack.kcs.length, 16);
});

test('no correct MCQ option is tagged with a misconception', () => {
  for (const t of pack.templates) {
    if (!t.mcq) continue;
    for (let s = 0; s < 50; s++) {
      const rng = makeRng(s + 1);
      const q: { options: { misconception?: string }[]; correct: number } = t.mcq(t.params(rng));
      assert.equal(q.options[q.correct].misconception, undefined, t.meta.id);
    }
  }
});
