// Native World's main-process companion. SPAOS's existing frontend transport
// authenticates this World to its own agent service; the renderer only sees a
// private, read-only projection of the roster, never an attachment credential.
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const assets = process.env.WORLD_OS_NATIVE_ASSETS;
const stateFile = process.env.WORLD_OS_NATIVE_STATE;
const worldRoot = process.env.SPAOS_WORLD_OS_ROOT;
if (!assets || !stateFile || !worldRoot || !stateFile.endsWith('/State/world.json'))
  throw new Error('Native People roster needs assets, State/world.json and SPAOS_WORLD_OS_ROOT');
const home = join(dirname(dirname(stateFile)), 'Home');
const state = dirname(stateFile);
const clientModule = resolve(worldRoot, '../../agent/world/services/world-service-client.mjs');
const { startWorldFrontend } = await import(pathToFileURL(clientModule).href);
const WebSocket = createRequire(clientModule)('ws');
const output = join(assets, 'live-roster.json');
let frontend, socket, snapshot = null, receivedAt = 0, connected = false;
let closing = false, retry, heartbeat;
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
  if (!connected) {
    socket?.terminate();
    socket = null;
    snapshot = null;
    receivedAt = 0;
    publish();
  } else queueMicrotask(dial);
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
  socket?.terminate();
  await frontend.close();
  await writes;
  await unlink(output).catch(() => {});
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => { void close().then(() => process.exit(0)); });
