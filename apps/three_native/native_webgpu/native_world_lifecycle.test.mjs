import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeWorldLifecycle } from './native_world_lifecycle.mjs';

test('native World requests a cooperative restart only after the compositor reports readiness', () => {
  const sent = [], stages = [];
  const lifecycle = createNativeWorldLifecycle({
    now: () => 100,
    sendStatus: id => { sent.push(['status', id]); return true; },
    sendRestart: (...args) => { sent.push(['restart', ...args]); return true; },
    stage: message => stages.push(message),
  });
  assert.equal(lifecycle.restart(), true);
  assert.equal(lifecycle.restart(), false);
  assert.equal(lifecycle.onMessage({ type: 'lifecycle_result', id: 'other', result: {} }), false);
  assert.equal(sent.length, 1);
  lifecycle.onMessage({ type: 'lifecycle_result', id: sent[0][1], result: {
    ok: true, session: 'session-1', targets: { world: { ready: true } },
  } });
  assert.deepEqual(sent[1], ['restart', 'native-world-100-2', 'session-1',
    'native-world-100-2']);
  assert.equal(lifecycle.restart(), false);
  lifecycle.onMessage({ type: 'lifecycle_result', id: sent[1][1], result: { ok: true } });
  assert.equal(lifecycle.restart(), true);
  assert.match(stages.join('\n'), /cooperative World restart/);
});

test('native World refuses an unavailable restart and quits once on lifecycle quit', () => {
  const sent = [], stages = [];
  let quits = 0;
  const lifecycle = createNativeWorldLifecycle({
    now: () => 200,
    sendStatus: id => { sent.push(id); return true; },
    sendRestart: () => { throw new Error('must not submit'); },
    requestQuit: () => { quits++; },
    stage: message => stages.push(message),
  });
  lifecycle.restart();
  lifecycle.onMessage({ type: 'lifecycle_result', id: sent[0], result: {
    ok: true, session: 'session-1', targets: { world: { ready: false } },
  } });
  assert.match(stages.at(-1), /unavailable/);
  lifecycle.onMessage({ type: 'lifecycle_quit' });
  lifecycle.onMessage({ type: 'lifecycle_quit' });
  assert.equal(quits, 1);
  assert.equal(lifecycle.restart(), false);
});
