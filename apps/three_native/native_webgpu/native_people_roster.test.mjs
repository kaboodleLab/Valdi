import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectPeopleRoster } from './native_people_roster.mjs';

test('live roster uses service identities and avoids duplicate self', () => {
  const snapshot = { type: 'roster', status: { state: 'online', name: 'local' },
    self: { id: 'a', name: 'Alice', character: 'andrew' }, members: [
      { id: 'b', name: 'Bob', character: 'unknown' },
      { id: 'a', name: 'Alice', character: 'andrew' },
    ] };
  const rows = projectPeopleRoster(snapshot);
  assert.deepEqual(rows.map(row => [row.id, row.name, row.model]), [
    ['b', 'Bob', 'person-worker'], ['a', 'Me', 'person-andrew'],
  ]);
  assert.deepEqual([rows[0].x, rows[0].z], [2.8, 0]);
  assert.notDeepEqual([rows[0].x, rows[0].z], [rows[1].x, rows[1].z]);
  assert.deepEqual(projectPeopleRoster(snapshot), rows);
});

test('offline, malformed and disabled snapshots keep the sample scene', () => {
  assert.equal(projectPeopleRoster(null), null);
  assert.equal(projectPeopleRoster({ type: 'roster', members: [], status: { state: 'online', name: 'off' } }), null);
});

test('connecting roster keeps the local person without inventing remote presence', () => {
  const rows = projectPeopleRoster({ type: 'roster', status: { state: 'connecting', name: 'ably' },
    self: { id: 'me', name: 'Local', character: 'will' },
    members: [{ id: 'other', name: 'Other', character: 'matt' }] });
  assert.deepEqual(rows.map(row => [row.id, row.name, row.model]),
    [['me', 'Me', 'person-will']]);
  assert.deepEqual([rows[0].x, rows[0].z], [2.8, 0]);
});

test('disabled presence still shows self without claiming remote people are present', () => {
  const rows = projectPeopleRoster({ type: 'roster', status: { state: 'online', name: 'off' },
    self: { id: 'me', name: 'Local', character: 'will' },
    members: [{ id: 'other', name: 'Other', character: 'matt' }] });
  assert.deepEqual(rows.map(row => [row.id, row.name, row.model]),
    [['me', 'Me', 'person-will']]);
});
