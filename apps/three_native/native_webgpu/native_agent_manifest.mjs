// SPAOS owns installed-app and Shell verbs. WorldOS may also present its own
// scene-local book action; it cannot claim an app or Shell verb name.
const NAME = /^[A-Za-z0-9_.-]{1,120}$/;
const PACKAGE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

export function projectNativeAgentManifest({ apps, harness, generation,
  sceneActions = [] }) {
  if (!Number.isSafeInteger(generation) || generation < 0 ||
      !Array.isArray(apps) || !Array.isArray(harness))
    return { verbs: [], appCatalog: { generation: 0, packages: [] } };
  const packages = [];
  const verbs = [];
  const seen = new Set();
  function add(brief, packageName) {
    if (!brief || typeof brief.name !== 'string' || !NAME.test(brief.name) ||
        seen.has(brief.name)) return;
    seen.add(brief.name);
    const cls = ['observe', 'act', 'commit'].includes(brief.cls) ? brief.cls : 'act';
    const row = {
      name: brief.name, cls,
      description: typeof brief.description === 'string' ? brief.description : '',
      args: brief.args && typeof brief.args === 'object' && !Array.isArray(brief.args)
        ? brief.args : {},
      userGo: brief.userGo === true || cls === 'commit' ||
        brief.name === 'mail.compose' || brief.name === 'mail.openDraft',
      tier: 'brain',
      ...(typeof brief.aka === 'string' ? { aka: brief.aka } : {}),
      ...(packageName ? { packageName, catalogGeneration: generation } : {}),
    };
    verbs.push(row);
  }
  for (const app of apps) {
    if (!app || app.world !== true || typeof app.key !== 'string' ||
        !PACKAGE.test(app.key) || !Array.isArray(app.verbs)) continue;
    const names = [];
    for (const brief of app.verbs) {
      if (brief && typeof brief.name === 'string' && NAME.test(brief.name)) {
        names.push(brief.name);
        add(brief, app.key);
      }
    }
    packages.push({ name: app.key, displayName: String(app.name || app.key),
      ...(app.appId ? { appId: String(app.appId) } : {}), verbs: names });
  }
  for (const brief of harness) add(brief);
  if (Array.isArray(sceneActions))
    for (const brief of sceneActions)
      if (brief?.name === 'book.open') add(brief);
  return { verbs, appCatalog: { generation, packages } };
}
