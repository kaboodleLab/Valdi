import assert from 'node:assert/strict';
import test from 'node:test';
import { wrapNativeReply, wrapNativeReplyMeasured } from './native_conversation_wrap.mjs';

test('long Hermes replies wrap without dropping words or long identifiers', () => {
  const rows = wrapNativeReply('Open Browser, Calculator, and Notes now', 14);
  assert.deepEqual(rows, ['Open Browser,', 'Calculator,', 'and Notes now']);
  assert.deepEqual(wrapNativeReply('supercalifragilistic', 6),
    ['superc', 'alifra', 'gilist', 'ic']);
  assert.ok(rows.every(row => row.length <= 14));
});

test('measured wrapping fits proportional glyphs and splits oversized tokens', () => {
  const width = value => [...value].reduce((sum, glyph) =>
    sum + (glyph === 'W' ? 5 : glyph === ' ' ? 1 : 1), 0);
  assert.deepEqual(wrapNativeReplyMeasured('WW iiiiii WWW', 10, width),
    ['WW', 'iiiiii', 'WW', 'W']);
  assert.deepEqual(wrapNativeReplyMeasured('iiii W', 10, width),
    ['iiii W']);
});
