import assert from 'node:assert/strict';
import test from 'node:test';
import { wrapNativeReply } from './native_conversation_wrap.mjs';

test('long Hermes replies wrap without dropping words or long identifiers', () => {
  const rows = wrapNativeReply('Open Browser, Calculator, and Notes now', 14);
  assert.deepEqual(rows, ['Open Browser,', 'Calculator,', 'and Notes now']);
  assert.deepEqual(wrapNativeReply('supercalifragilistic', 6),
    ['superc', 'alifra', 'gilist', 'ic']);
  assert.ok(rows.every(row => row.length <= 14));
});
