import { appByName, appListResult, appNameOf, appOpenTarget, resolveShow,
  standingApps } from '@spaos/verbs';

// Keep the Shell's four floor verbs in its privileged controller. The renderer
// has snapshots for drawing but cannot send arbitrary compositor operations.
export function handleNativeShellHarness(p, { apps, spaces, floor, views, starting,
  now = Date.now() }) {
  const args = p.args && typeof p.args === 'object' && !Array.isArray(p.args) ? p.args : {};
  const error = (code, message, hint = '') => ({
    requests: [], result: { ok: false, verb: p.verb,
      error: { code, message, hint }, t: now },
  });
  const success = (outcome, narration, requests = []) => ({
    requests, result: { ok: true, verb: p.verb, outcome, narration, t: now },
  });
  if (p.verb === 'app.list') {
    return { requests: [], result: appListResult(apps, views,
      standingApps(spaces), [...starting].filter(([, at]) => now - at < 15_000)
        .map(([app]) => app), now) };
  }
  if (p.verb === 'view.show') {
    const target = typeof args.target === 'string' ? args.target : '';
    const to = resolveShow(apps, spaces, target);
    if (to.kind === 'unknown')
      return error('not-found', `nothing here is called ${target}`, 'app.list names what there is');
    if (to.kind === 'not-open')
      return error('not-found', `${to.app.name} is not open`, `${appNameOf(to.app)}.open opens it`);
    return success({ target: to.label, x: to.x, z: to.z, moved: !to.already },
      to.already ? `${to.label} is already in front of you` : `here is ${to.label}`,
      to.already ? [] : [{ type: 'enter_space_at', x: to.x, z: to.z }]);
  }
  const open = appOpenTarget(p.verb, p.expectedApp);
  if (open) {
    const entry = apps.find(app => app.world && appNameOf(app) === open);
    if (!entry?.launch)
      return error('not-found', `there is no ${open} to open`);
    // A named destination needs the app's own handler. Do not claim success for
    // a chat, URL or document that this first native harness cannot hand off.
    if (Object.keys(args).length && entry.verbs?.includes(p.verb)) return null;
    if (Object.keys(args).length)
      return error('app-unavailable', `${entry.name} cannot receive open arguments from this Shell yet`,
        'Open the app first, then use its own controls.');
    const already = floor.find(window => window.app_id === entry.wmClass);
    if (already)
      return success({ app: open, stood: false }, `${entry.name} is already open`,
        [{ type: 'focus', id: already.id }]);
    if (now - (starting.get(open) ?? -Infinity) < 15_000)
      return success({ app: open, stood: false }, `${entry.name} is coming up`);
    return { ...success({ app: open, stood: true }, `${entry.name} is coming up`,
      [{ type: 'launch', launch: entry.launch,
        ...(entry.singleInstance && entry.wmClass ? { only_one: entry.wmClass } : {}),
        background: false }]), startedApp: open };
  }
  if (p.verb !== 'app.close' && p.verb !== 'app.move') return null;
  const name = typeof args.app === 'string' ? args.app : '';
  const entry = appByName(apps, name);
  if (!entry) return error('not-found', `there is no app called ${name}`);
  const windows = floor.filter(window => window.app_id === entry.wmClass);
  if (!windows.length)
    return error('not-found', `${entry.name} is not open`, `${appNameOf(entry)}.open opens it`);
  if (p.verb === 'app.close')
    return success({ app: appNameOf(entry), windows: windows.length },
      `${entry.name} is closing`, windows.map(window => ({ type: 'close', id: window.id })));
  const x = Number(args.x);
  const z = Number(args.z);
  if (!Number.isFinite(x) || !Number.isFinite(z))
    return error('invalid-args', 'give me a square, as x and z');
  return success({ app: appNameOf(entry), windows: windows.length, x, z },
    `${entry.name} is on ${x},${z}`, windows.map(window => ({
      type: 'move_window_to_tile', window: window.id, x, z, follow: false,
    })));
}
