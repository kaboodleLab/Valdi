import assert from 'node:assert/strict';
import test from 'node:test';
import { projectNativeAgentManifest } from './native_agent_manifest.mjs';

test('native mind catalog retains hidden app ownership and authenticated generation', () => {
  const projected = projectNativeAgentManifest({ generation: 17, apps: [
    { key: 'calculator', name: 'Calculator', world: true, hidden: true,
      verbs: [{ name: 'calculator.evaluate', cls: 'observe', description: 'Evaluate',
        args: { expression: { type: 'string' } } }] },
    { key: 'untrusted', world: false, verbs: [{ name: 'untrusted.act' }] },
  ], harness: [{ name: 'calculator.open', description: 'Open Calculator' }] });
  assert.deepEqual(projected.appCatalog, { generation: 17, packages: [
    { name: 'calculator', displayName: 'Calculator', verbs: ['calculator.evaluate'] },
  ] });
  assert.equal(projected.verbs.length, 2);
  assert.equal(projected.verbs[0].packageName, 'calculator');
  assert.equal(projected.verbs[0].catalogGeneration, 17);
  assert.deepEqual(projected.verbs[0].args, { expression: { type: 'string' } });
  assert.equal(projected.verbs[1].name, 'calculator.open');
  assert.equal(projected.verbs[1].packageName, undefined);
});

test('native mind projection refuses stale catalogs and conservatively classifies verbs', () => {
  assert.deepEqual(projectNativeAgentManifest({ generation: undefined, apps: [], harness: [] }),
    { verbs: [], appCatalog: { generation: 0, packages: [] } });
  const projected = projectNativeAgentManifest({ generation: 2, apps: [
    { key: 'mail', world: true, verbs: [{ name: 'mail.compose' },
      { name: 'mail.send', cls: 'commit' }, { name: '../bad' }] },
  ], harness: [] });
  assert.equal(projected.verbs.length, 2);
  assert.equal(projected.verbs[0].userGo, true);
  assert.equal(projected.verbs[1].userGo, true);
  assert.equal(projected.verbs[0].cls, 'act');
});

test('only the owned scene action may join the native mind catalog', () => {
  const book = { name: 'book.open', cls: 'act', args: { subject: { type: 'string' } } };
  const projected = projectNativeAgentManifest({ generation: 3, apps: [], harness: [],
    sceneActions: [book, { name: 'mail.send', cls: 'commit' }] });
  assert.deepEqual(projected.verbs.map(verb => verb.name), ['book.open']);
  assert.equal(projected.verbs[0].packageName, undefined);
  const owned = projectNativeAgentManifest({ generation: 3, apps: [],
    harness: [book], sceneActions: [book] });
  assert.equal(owned.verbs.length, 1, 'an authenticated Shell owner takes precedence');
});
