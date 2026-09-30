import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeDockLayout } from './native_space_dock.mjs';

test('the dock stays inside the right half and reports its actual hit rectangle', () => {
  const output = { width: 1600, height: 900 };
  const dock = nativeDockLayout(output, [{ id: 4, title: 'Calculator' }]);
  assert.deepEqual([dock.x, dock.y, dock.w, dock.h, dock.home],
    [1073, 833, 254, 48, true]);
  assert.equal(dock.buttons[0].x, dock.x + 8);
  assert.equal(dock.buttons[1].x, dock.buttons[0].x + dock.buttons[0].width + 8);
  assert.ok(dock.x + dock.w <= output.width);
});

test('many windows cannot expand the dock outside its compositor input bound', () => {
  const output = { width: 1280, height: 800 };
  const dock = nativeDockLayout(output,
    Array.from({ length: 30 }, (_, index) => ({ id: index + 1, title: 'Window title' })));
  assert.ok(dock.w <= output.width / 2 - 56);
  assert.equal(dock.buttons[0].kind, 'grip');
  assert.equal(dock.buttons[1].kind, 'world');
  assert.ok(dock.buttons.length < 31);
  assert.equal(nativeDockLayout({ width: 100, height: 800 }, []), null);
});

test('a dragged pill clamps to the output and loses its home strut', () => {
  const output = { width: 1600, height: 900 };
  const dock = nativeDockLayout(output, [], { x: 2000, y: -20 });
  assert.deepEqual([dock.x, dock.y, dock.w, dock.h, dock.home],
    [1476, 0, 124, 48, false]);
});
