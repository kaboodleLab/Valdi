// Native World's main-process companion. SPAOS's existing frontend transport
// authenticates this World to its own agent service; the renderer only sees a
// private, read-only projection of the roster, never an attachment credential.
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import net from 'node:net';
import { closeSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { projectNativeAgentManifest } from './native_agent_manifest.mjs';

// The companion only owns the authenticated agent transport. The native host
// alone holds SPAOS's World channel, so close its inherited descriptor here.
const inheritedWorldFd = process.env.SPAOS_APP_CHANNEL_FD;
if (/^\d+$/.test(inheritedWorldFd || '') && Number(inheritedWorldFd) >= 3) {
  try { closeSync(Number(inheritedWorldFd)); } catch {}
  delete process.env.SPAOS_APP_CHANNEL_FD;
}

const output = process.env.WORLD_OS_NATIVE_ROSTER;
const runtime = process.env.XDG_RUNTIME_DIR;
const stateFile = process.env.WORLD_OS_NATIVE_STATE;
const worldRoot = process.env.SPAOS_WORLD_OS_ROOT;
const agentSocket = process.env.WORLD_OS_NATIVE_AGENT_SOCKET;
if (!output || !runtime || !resolve(output).startsWith(resolve(runtime) + sep) ||
    !stateFile || !worldRoot || !stateFile.endsWith('/State/world.json') ||
    !agentSocket || !resolve(agentSocket).startsWith(resolve(runtime) + sep))
  throw new Error('Native People roster needs a private runtime path, State/world.json and SPAOS_WORLD_OS_ROOT');
const home = join(dirname(dirname(stateFile)), 'Home');
const state = dirname(stateFile);
const clientModule = resolve(worldRoot, '../../agent/world/services/world-service-client.mjs');
const { startWorldFrontend } = await import(pathToFileURL(clientModule).href);
const WebSocket = createRequire(clientModule)('ws');
let frontend, socket, snapshot = null, receivedAt = 0, connected = false;
let closing = false, retry, heartbeat, worldId = null;
let agent = null, agentRetry = null, agentReady = false;
let native = null, nativeBuffer = '';
let manifest = { verbs: [], appCatalog: { generation: 0, packages: [] } };
const pending = new Set();
const MAX_LINE = 256 * 1024;
const sendNative = value => {
  if (!native || native.destroyed) return false;
  const body = JSON.stringify(value) + '\n';
  const bytes = Buffer.byteLength(body);
  if (bytes > MAX_LINE || native.writableLength + bytes > 1024 * 1024) {
    native.destroy();
    return false;
  }
  native.write(body);
  return true;
};
const sendAgent = value => {
  if (!agent || agent.readyState !== WebSocket.OPEN) return false;
  const body = JSON.stringify(value);
  const bytes = Buffer.byteLength(body);
  if (bytes > MAX_LINE || agent.bufferedAmount + bytes > 1024 * 1024) return false;
  agent.send(body);
  return true;
};
const status = () => sendNative({ type: 'agent_status', connected: !!agent &&
  agent.readyState === WebSocket.OPEN, ready: agentReady });
function dialAgent() {
  if (closing || !connected || !worldId || agent || !frontend) return;
  // The attached host accepts only the World identity it authenticated.
  const sid = worldId;
  const peer = agent = new WebSocket(frontend.url.replace('http:', 'ws:') +
    '/ws/agent?sid=' + encodeURIComponent(sid),
    { origin: frontend.url, handshakeTimeout: 5000, maxPayload: 1024 * 1024 });
  peer.on('open', () => {
    sendAgent({ t: 'hello', worldSid: sid, ...manifest, lanes: [] });
    status();
  });
  peer.on('message', raw => {
    let value;
    try { value = JSON.parse(String(raw)); } catch { return; }
    if (value?.t === 'hello-ack' || value?.t === 'runtime-changed') {
      agentReady = value.agent === true || value.ready === true;
      if (value.t === 'hello-ack')
        console.error(`[native-agent] WorldOS mind hello acknowledged (${agentReady ? 'ready' : 'offline'})`);
      status();
    } else if (value?.t === 'call') {
      if (typeof value.callId !== 'string' || pending.size >= 32 ||
          !sendNative({ type: 'agent_call', call: value })) {
        sendAgent({ t: 'result', callId: value.callId, result: { ok: false,
          verb: value.verb, error: { code: 'world-detached',
            message: 'Native World cannot receive this call' } } });
      } else pending.add(value.callId);
    } else if (['say', 'say-delta', 'status', 'state', 'thought'].includes(value?.t)) {
      sendNative({ type: 'agent_frame', frame: value });
    }
  });
  peer.on('error', error => console.error('[native-agent] socket:', error.message));
  peer.on('close', () => {
    if (agent !== peer) return;
    agent = null;
    agentReady = false;
    pending.clear();
    status();
    if (!closing && connected) agentRetry = setTimeout(dialAgent, 1000);
  });
}
function onNativeLine(line) {
  let value;
  try { value = JSON.parse(line); } catch { return; }
  if (value?.type === 'catalog') {
    manifest = projectNativeAgentManifest(value);
    console.error(`[native-agent] published ${manifest.verbs.length} installed app and floor verbs ` +
      `(generation ${manifest.appCatalog.generation})`);
    if (agent?.readyState === WebSocket.OPEN) sendAgent({ t: 'hello',
      worldSid: worldId, ...manifest, lanes: [] });
  } else if (value?.type === 'utterance') {
    const text = typeof value.text === 'string' ? value.text.trim() : '';
    if (!agentReady || !text || text.length > 2000 ||
        !sendAgent({ t: 'utterance', text, tile: null, source: 'typed',
          inputId: typeof value.inputId === 'string' ? value.inputId : randomUUID() }))
      sendNative({ type: 'agent_frame', frame: { t: 'say',
        text: 'The WorldOS mind is unavailable. Please try again when it reconnects.' } });
  } else if (value?.type === 'result' && typeof value.callId === 'string' &&
             pending.delete(value.callId)) {
    sendAgent({ t: 'result', callId: value.callId, result: value.result });
  }
}
const agentServer = net.createServer(peer => {
  if (native) { peer.destroy(); return; }
  native = peer;
  nativeBuffer = '';
  peer.setNoDelay(true);
  peer.on('data', chunk => {
    nativeBuffer += chunk.toString('utf8');
    if (Buffer.byteLength(nativeBuffer) > MAX_LINE) { peer.destroy(); return; }
    let end;
    while ((end = nativeBuffer.indexOf('\n')) >= 0) {
      const line = nativeBuffer.slice(0, end);
      nativeBuffer = nativeBuffer.slice(end + 1);
      onNativeLine(line);
    }
  });
  peer.on('close', () => { if (native === peer) native = null; });
  status();
});
await new Promise((resolve, reject) => {
  agentServer.once('error', reject);
  agentServer.listen(agentSocket, resolve);
});
let writes = Promise.resolve();
function publish() {
  const body = JSON.stringify({ receivedAt, snapshot: connected ? snapshot : null });
  writes = writes.then(async () => {
    const temp = `${output}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, body, { mode: 0o600, flag: 'wx' });
      await rename(temp, output);
    } finally { await unlink(temp).catch(() => {}); }
  }).catch(error => console.error('[native-roster] snapshot write:', error.message));
}
function dial() {
  if (closing || !connected || socket || !frontend) return;
  const peer = socket = new WebSocket(frontend.url.replace('http:', 'ws:') + '/ws/roster',
    { origin: frontend.url, handshakeTimeout: 5000, maxPayload: 1024 * 1024 });
  peer.on('message', data => {
    try {
      const value = JSON.parse(String(data));
      if (value?.type !== 'roster' || !Array.isArray(value.members)) return;
      snapshot = value;
      receivedAt = Date.now();
      publish();
    } catch {}
  });
  peer.on('error', error => console.error('[native-roster] socket:', error.message));
  peer.on('close', () => {
    if (socket !== peer) return;
    socket = null;
    if (!closing && connected) retry = setTimeout(dial, 1000);
  });
}
frontend = await startWorldFrontend({ home, state, handlers: {}, onStatus(status) {
  connected = status.connected === true;
  worldId = connected ? status.worldId : null;
  if (!connected) {
    socket?.terminate();
    socket = null;
    snapshot = null;
    receivedAt = 0;
    publish();
    agent?.terminate();
  } else queueMicrotask(() => { dial(); dialAgent(); });
} });
heartbeat = setInterval(() => {
  if (socket?.readyState === WebSocket.OPEN && snapshot) {
    receivedAt = Date.now();
    publish();
  }
}, 4000);
publish();
async function close() {
  if (closing) return;
  closing = true;
  clearInterval(heartbeat);
  clearTimeout(retry);
  clearTimeout(agentRetry);
  socket?.terminate();
  agent?.terminate();
  native?.destroy();
  await new Promise(resolve => agentServer.close(resolve));
  await unlink(agentSocket).catch(() => {});
  await frontend.close();
  await writes;
  await unlink(output).catch(() => {});
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => { void close().then(() => process.exit(0)); });
