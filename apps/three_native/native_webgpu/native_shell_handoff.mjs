import { randomUUID } from 'node:crypto';
import { appNameOf } from '@spaos/verbs';

const MAX_PENDING = 32;
const START_QUIET_MS = 15_000;
const FOREGROUND_TIMEOUT_MS = 10_000;
const BACKGROUND_TIMEOUT_MS = 80_000;
const HANDOFF_PREFIX = 'native-handoff-';

// A stopped app's manifest promises a Verb before its app channel exists. Hold
// that exact call while SPAOS starts the digest-bound app, then re-enter the
// compositor's invoke path so it stamps provenance and enforces user-go policy.
export function createNativeShellHandoff({ catalog, floor, starting, send, log,
  now = Date.now }) {
  const pending = new Map();
  const handedOff = new Map();
  let liveVerbs = [];

  function settle(call, result) {
    if (pending.get(call.callId) !== call) return;
    pending.delete(call.callId);
    clearTimeout(call.timer);
    if (call.handoffId) handedOff.delete(call.handoffId);
    send({ type: 'harness_result', callId: call.callId, result });
  }
  function handoff(call) {
    if (call.handoffId || !liveVerbs.some(verb =>
        verb.name === call.verb && verb.app === call.key)) return;
    call.handoffId = `${HANDOFF_PREFIX}${randomUUID()}`;
    handedOff.set(call.handoffId, call);
    send({ type: 'invoke_verb', verb: call.verb, args: call.args,
      callId: call.handoffId, driver: call.driver, agent: call.agent });
    log(`${call.verb} handed to authenticated ${call.key} app`);
  }
  function request(p) {
    const owner = catalog()?.ownerOfVerb(p.verb, p.expectedApp);
    if (!owner || !owner.launch || (owner.headless && owner.launch.format !== 3)) return false;
    if (pending.has(p.callId)) return true;
    if (pending.size >= MAX_PENDING) {
      send({ type: 'harness_result', callId: p.callId, result: {
        ok: false, verb: p.verb,
        error: { code: 'busy', message: 'Shell has too many app calls in flight', hint: '' },
        t: now(),
      } });
      return true;
    }
    const key = owner.headless ? owner.id.slice('service:'.length) : appNameOf(owner);
    const background = owner.verbActivation?.[p.verb] === 'background';
    const call = { ...p, key, handoffId: null, timer: null };
    pending.set(p.callId, call);
    call.timer = setTimeout(() => settle(call, {
      ok: false, verb: p.verb,
      error: { code: 'blocked-by-state',
        message: `${owner.name} did not come up in time to answer that`,
        hint: owner.headless ? 'Ask again after the service is ready' :
          `${key}.open opens it, and it can be asked again` },
      t: now(),
    }), background ? BACKGROUND_TIMEOUT_MS : FOREGROUND_TIMEOUT_MS);
    call.timer.unref();
    if (liveVerbs.some(verb => verb.name === p.verb && verb.app === key)) {
      handoff(call);
      return true;
    }
    if (owner.headless) {
      // SPAOS owns the service's live/start guard. Repeating this request is
      // safe and lets a failed worker be retried without a Shell restart.
      send({ type: 'launch_service', launch: owner.launch });
      log(`${p.verb} is waiting for headless ${owner.id}`);
      return true;
    }
    const mapped = floor().some(window => window.app_id === owner.wmClass);
    const startedAt = starting.get(key);
    if (!mapped && (startedAt === undefined || now() - startedAt >= START_QUIET_MS)) {
      starting.set(key, now());
      send({ type: 'launch', launch: owner.launch,
        ...(owner.singleInstance && owner.wmClass ? { only_one: owner.wmClass } : {}),
        background });
      log(`${p.verb} is waiting for ${owner.id} to register it`);
    }
    return true;
  }
  function onVerbs(verbs) {
    liveVerbs = verbs;
    for (const call of pending.values()) handoff(call);
  }
  function onResult({ callId, result }) {
    const call = handedOff.get(callId);
    if (call) settle(call, result);
    return !!call || callId.startsWith(HANDOFF_PREFIX);
  }
  function stop() {
    for (const call of pending.values()) clearTimeout(call.timer);
    pending.clear();
    handedOff.clear();
  }
  return { request, onVerbs, onResult, stop };
}
