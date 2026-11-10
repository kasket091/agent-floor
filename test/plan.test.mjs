import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan, planText } from '../server/plan.mjs';

const it = (content, status) => ({ content, status });
const three = [it('a', 'completed'), it('b', 'in_progress'), it('c', 'pending')];

test('full list sets text', () => {
  const p = applyPlan(undefined, { items: three, scope: 'first_task' });
  assert.equal(planText(p), '2/3 · b');
});

test('advance moves to next step, then completes', () => {
  let p = applyPlan(three, { advance: true });
  assert.deepEqual(p.map(i => i.status), ['completed', 'completed', 'in_progress']);
  assert.equal(planText(p), '3/3 · c');
  p = applyPlan(p, { advance: true });
  assert.ok(p.every(i => i.status === 'completed'));
  assert.equal(planText(p), undefined);
  assert.equal(three[1].status, 'in_progress'); // input not mutated
});

test('done/start are 1-based', () => {
  const p = applyPlan([it('a', 'pending'), it('b', 'in_progress'), it('c', 'pending')], { done: [1, 2], start: 3 });
  assert.deepEqual(p.map(i => i.status), ['completed', 'completed', 'in_progress']);
});

test('delta with no previous list returns []', () => {
  assert.deepEqual(applyPlan(undefined, { advance: true }), []);
  assert.deepEqual(applyPlan(undefined, { done: [1], start: 2 }), []);
});

test('out-of-range done/start ignored', () => {
  const p = applyPlan(three, { done: [0, 9], start: 7 });
  assert.deepEqual(p, three);
});
