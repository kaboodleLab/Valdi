import assert from 'node:assert/strict';
import test from 'node:test';
import { launcherBand, sortLauncherApps } from './native_launcher_catalog.mjs';

test('the SPAOS catalog keeps South Park, World OS, and host apps in separate bands', () => {
  const rows = [
    { key: 'terminal', name: 'Terminal', world: false },
    { key: 'calendar', name: 'Calendar', spaosWorldOs: true },
    { key: 'calculator', name: 'Calculator', world: true },
    { key: 'browser', name: 'Browser', spaosWorldOs: true },
    { key: 'clock', name: 'Clock', world: true },
  ];
  assert.deepEqual(sortLauncherApps(rows).map(app => app.key),
    ['calculator', 'clock', 'browser', 'calendar', 'terminal']);
  assert.deepEqual(rows.map(launcherBand), [2, 1, 0, 1, 0]);
  assert.equal(rows[0].world, false);
});
