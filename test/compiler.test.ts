import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coerceItem } from '../server/compiler/compiler.ts';

test('coerceItem repairs the shapes models drift into', () => {
  const free = coerceItem({
    id: 'e',
    capability: 'explain',
    widget: 'free_text',
    text: 'Why?',
    hints: ['h'],
    rubric: { expectations: ['idea one', 'idea two'], reference: 'ref' },
  });
  assert.deepEqual(
    free?.rubric?.expectations.map((e) => e.text),
    ['idea one', 'idea two'],
  );
  const mcqText = coerceItem({
    id: 'm',
    capability: 'discriminate',
    widget: 'multiple_choice',
    text: 'Which?',
    hints: ['h'],
    mcq: { options: ['A', 'B'], correct: 'B' },
  });
  assert.equal(mcqText?.mcq?.correct, 1);
  const mcqFlag = coerceItem({
    id: 'm2',
    capability: 'predict',
    widget: 'mcq',
    text: 'Which?',
    hints: ['h'],
    mcq: { options: [{ text: 'Up' }, { text: 'Down', correct: true }] },
  });
  assert.equal(mcqFlag?.mcq?.correct, 1);
  const transfer = coerceItem({
    id: 't',
    capability: 'transfer',
    widget: 'numeric',
    text: 'New setting',
    hints: ['h'],
    numeric: { answer: '0.5', answer_expr: '1/2', unit: '' },
  });
  assert.equal(transfer?.capability, 'apply');
  assert.equal(transfer?.is_transfer, true);
  assert.equal(transfer?.numeric?.answer, 0.5);
  assert.equal(
    coerceItem({ id: 'x', capability: 'apply', widget: 'mcq', text: 't', hints: ['h'], mcq: { options: ['A', 'B'] } }),
    null,
  );
});
