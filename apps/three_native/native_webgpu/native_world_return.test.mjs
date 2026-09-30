import assert from 'node:assert/strict';
import test from 'node:test';
import { beginReturnFromFloor, canReleaseReturn, returnForLeave, planSceneActionReturn,
  settleSceneActionReturn, SCENE_RETURN_MS } from './native_world_return.mjs';

test('dock return tracks the previous preview until a newer one is ready', () => {
  const previews = new Map([[1, 2]]);
  const cards = new Map([[1, { generation: 3 }]]);
  const pending = beginReturnFromFloor(1, null,
    [{ id: 1, active: false, lingering: true }], previews, cards);
  assert.deepEqual(pending, { id: 1, generation: 3 });
  assert.equal(beginReturnFromFloor(1, pending, [], previews, cards), pending);
});

test('ordinary floor changes do not start a return', () => {
  const empty = new Map();
  assert.equal(beginReturnFromFloor(1, null,
    [{ id: 1, active: false, lingering: false }], empty, empty), null);
  assert.equal(beginReturnFromFloor(1, null,
    [{ id: 1, active: true, lingering: false }], empty, empty), null);
});

test('empty departing spaces release immediately; occupied spaces wait for a newer preview', () => {
  const returning = { id: 2, generation: 4 };
  assert.equal(canReleaseReturn(returning, { id: 2, active: false, windows: 0 }, null), true);
  assert.equal(canReleaseReturn(returning, { id: 2, active: false, windows: 1 },
    { generation: 4 }), false);
  assert.equal(canReleaseReturn(returning, { id: 2, active: false, windows: 1 },
    { generation: 5 }), true);
  assert.equal(canReleaseReturn(returning, { id: 2, active: true, windows: 0 }, null), false);
});

test('a leave tracks the departing space and its newest preview', () => {
  const previews = new Map([[3, 6]]);
  const cards = new Map([[3, { generation: 4 }]]);
  assert.deepEqual(returnForLeave(3, previews, cards), { id: 3, generation: 6 });
  assert.deepEqual(returnForLeave(5, previews, cards), { id: 5, generation: 0 });
  assert.equal(returnForLeave(null, previews, cards), null);
  assert.equal(returnForLeave(0, previews, cards), null);
});

const book = { t: 'call', callId: 'c1', verb: 'book.open', args: { subject: 'Saturn' } };

// SPAOS main.rs drains one dispatch's World requests with leaves before enters.
function spaosDispatch(entered, queue) {
  let space = entered;
  if (queue.includes('leave')) space = null;
  for (const request of queue) if (request !== 'leave') space = request.enter;
  queue.length = 0;
  return space;
}

test('a foreground scene action leaves an app space at once', () => {
  assert.deepEqual(planSceneActionReturn(book, 2, null, -Infinity, 0),
    { leaveNow: true, pending: null });
  assert.deepEqual(planSceneActionReturn(book, null, null, -Infinity, 0),
    { leaveNow: false, pending: null });
});

test('book.open during an in-flight entry ends at World even when SPAOS handles both together', () => {
  // The first change's immediate leave loses: the enter lands after it.
  assert.equal(spaosDispatch(null, [{ enter: 3 }, 'leave']), 3);

  const queue = [{ enter: 3 }];
  const plan = planSceneActionReturn(book, null, 3, 100, 150);
  assert.deepEqual(plan, { leaveNow: false,
    pending: { space: 3, until: 100 + SCENE_RETURN_MS, stale: null } });
  let entered = spaosDispatch(null, queue);
  assert.equal(entered, 3);
  // A snapshot published before the enter keeps waiting; the entry's own
  // snapshot sends exactly one leave, which SPAOS applies on its own.
  let settled = settleSceneActionReturn(plan.pending, null, 180);
  assert.deepEqual(settled, { leave: false, pending: plan.pending });
  settled = settleSceneActionReturn(settled.pending, entered, 220);
  assert.deepEqual(settled, { leave: true, pending: null });
  queue.push('leave');
  entered = spaosDispatch(entered, queue);
  assert.equal(entered, null);
});

test('book.open with a stale active space and a fresh entry still ends at World', () => {
  // Floor still reports space 2, which World has already left; the person then
  // picked space 3, whose enter is in flight with this leave.
  const plan = planSceneActionReturn(book, 2, 3, 100, 150);
  assert.deepEqual(plan, { leaveNow: true,
    pending: { space: 3, until: 100 + SCENE_RETURN_MS, stale: 2 } });
  const queue = [{ enter: 3 }, 'leave'];
  let entered = spaosDispatch(null, queue);
  assert.equal(entered, 3);
  // Snapshots from before the enter, still naming space 2 or none, keep waiting.
  let settled = settleSceneActionReturn(plan.pending, 2, 170);
  assert.deepEqual(settled, { leave: false, pending: plan.pending });
  settled = settleSceneActionReturn(settled.pending, null, 190);
  assert.deepEqual(settled, { leave: false, pending: plan.pending });
  settled = settleSceneActionReturn(settled.pending, 2, 200);
  assert.deepEqual(settled, { leave: false, pending: plan.pending });
  settled = settleSceneActionReturn(settled.pending, entered, 230);
  assert.deepEqual(settled, { leave: true, pending: null });
  queue.push('leave');
  entered = spaosDispatch(entered, queue);
  assert.equal(entered, null);
  // A third space is a different entry and cancels the wait.
  assert.deepEqual(settleSceneActionReturn(plan.pending, 4, 240),
    { leave: false, pending: null });
});

test('a pending return never pulls back an unrelated or later entry', () => {
  const pending = planSceneActionReturn(book, null, 3, 100, 150).pending;
  assert.deepEqual(settleSceneActionReturn(pending, 5, 200),
    { leave: false, pending: null });
  assert.deepEqual(settleSceneActionReturn(pending, 3, 100 + SCENE_RETURN_MS + 1),
    { leave: false, pending: null });
  // An entry request older than the bound is stale and arms nothing.
  assert.deepEqual(planSceneActionReturn(book, null, 3, 100, 100 + SCENE_RETURN_MS + 1),
    { leaveNow: false, pending: null });
  assert.deepEqual(planSceneActionReturn(book, null, 3, -Infinity, 0),
    { leaveNow: false, pending: null });
  assert.deepEqual(settleSceneActionReturn(null, 3, 200), { leave: false, pending: null });
});

test('a task scene action never moves the person', () => {
  for (const taskId of ['task-7', 0])
    assert.deepEqual(planSceneActionReturn({ ...book, taskId }, 2, 3, 100, 150),
      { leaveNow: false, pending: null });
});
