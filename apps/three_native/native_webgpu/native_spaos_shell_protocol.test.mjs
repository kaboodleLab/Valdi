import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeSpaosShellProtocol } from './native_spaos_shell_protocol.mjs';

function harness() {
  const sent = [];
  const states = [];
  let quits = 0;
  const shell = createNativeSpaosShellProtocol({ protocolVersion: 20,
    send: line => { sent.push(JSON.parse(line)); return true; },
    onState: state => states.push(state), onQuit: () => { ++quits; } });
  return { shell, sent, states, get quits() { return quits; } };
}

test('a matching SPAOS hello authorizes the dock and its output rectangle', () => {
  const h = harness();
  assert.equal(h.shell.focus(4), false);
  h.shell.ingest('{"type":"hello","protocol":20,"output":{"width":1600,"height":900,"scale":1}}\n');
  assert.deepEqual(h.sent, [
    { type: 'reserve_space_ui', height: 64 },
    { type: 'set_dock_rect', x: 0, y: 836, w: 1600, h: 64, home: false },
  ]);
  h.shell.ingest('{"type":"output","output":{"width":1280,"height":800,"scale":1.5}}\n');
  assert.deepEqual(h.sent.at(-1),
    { type: 'set_dock_rect', x: 0, y: 736, w: 1280, h: 64, home: false });
  assert.equal(h.states.at(-1).output.width, 1280);
});

test('window and space actions are bounded to the latest compositor snapshot', () => {
  const h = harness();
  h.shell.ingest('{"type":"hello","protocol":20,"output":{"width":1600,"height":900}}\n');
  h.shell.ingest('{"type":"windows","windows":[{"id":4,"title":"Editor"}]}\n' +
    '{"type":"spaces","spaces":[{"id":2,"active":true}]}\n');
  assert.equal(h.shell.focus(4), true);
  assert.equal(h.shell.close(5), false);
  assert.equal(h.shell.switchSpace(2), true);
  assert.equal(h.shell.switchSpace(0), true);
  assert.deepEqual(h.sent.slice(-3), [{ type: 'focus', id: 4 },
    { type: 'switch_space', id: 2 }, { type: 'switch_space', id: 0 }]);
  h.shell.ingest('{"type":"windows","windows":[]}\n');
  assert.equal(h.shell.close(4), false);
});

test('mismatched protocol fails closed and quit stops processing', () => {
  const mismatch = harness();
  assert.throws(() => mismatch.shell.ingest('{"type":"hello","protocol":19,"output":{"width":1600,"height":900}}\n'),
    /mismatch/);
  assert.deepEqual(mismatch.sent, []);
  const h = harness();
  h.shell.ingest('{"type":"hello","protocol":20,"output":{"width":1600,"height":900}}\n');
  h.shell.ingest('{"type":"lifecycle_quit"}\n');
  assert.equal(h.quits, 1);
  h.shell.ingest('{"type":"output","output":{"width":800,"height":600}}\n');
  assert.equal(h.sent.length, 2);
});
