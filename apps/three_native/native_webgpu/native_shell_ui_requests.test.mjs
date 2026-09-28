import assert from 'node:assert/strict';
import test from 'node:test';
import { requestFromNativeUi } from './native_shell_ui_requests.mjs';

const state = { output: { width: 1600, height: 900 },
  windows: [{ id: 7 }], spaces: [{ id: 2 }] };

test('the renderer may operate only on the current window and space snapshot', () => {
  assert.deepEqual(requestFromNativeUi({ type: 'focus', id: 7, command: '/bin/sh' }, state),
    { type: 'focus', id: 7 });
  assert.equal(requestFromNativeUi({ type: 'close', id: 8 }, state), null);
  assert.deepEqual(requestFromNativeUi({ type: 'switch_space', id: 0 }, state),
    { type: 'switch_space', id: 0 });
  assert.equal(requestFromNativeUi({ type: 'switch_space', id: 3 }, state), null);
});

test('dock geometry is bound to SPAOS output and privileged requests are refused', () => {
  assert.deepEqual(requestFromNativeUi({ type: 'set_dock_rect', x: 1096, y: 833,
    w: 208, h: 48, home: true, command: '/bin/sh' }, state),
    { type: 'set_dock_rect', x: 1096, y: 833, w: 208, h: 48, home: true });
  assert.equal(requestFromNativeUi({ type: 'set_dock_rect', x: 0, y: 0,
    w: 1600, h: 900, home: false }, state), null);
  assert.equal(requestFromNativeUi({ type: 'launch', command: '/bin/sh' }, state), null);
  assert.equal(requestFromNativeUi({ type: 'publish_apps', apps: [] }, state), null);
});
