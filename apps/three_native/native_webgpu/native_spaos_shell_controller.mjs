import net from 'node:net';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { CompositorClient } from '@spaos/compositor-client';
import { PROTOCOL_VERSION } from '@spaos/shell-protocol';
import { probeSpaosCatalog } from './probe_spaos_catalog.mjs';
import { requestFromNativeUi } from './native_shell_ui_requests.mjs';

const MAX_UI_LINE = 8192;
const MAX_UI_OUTBOX = 1024 * 1024;
const log = value => process.stderr.write(`[native-shell-controller] ${value}\n`);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function shellFd() {
  const raw = required('SPAOS_SHELL_CHANNEL_FD');
  if (!/^\d{1,6}$/.test(raw) || Number(raw) < 3) throw new Error('Invalid SPAOS Shell descriptor');
  return Number(raw);
}
function catalogRows(snapshot, hostApps) {
  return [...snapshot.apps, ...hostApps].map(entry => ({
    key: entry.world ? entry.id.slice('world:'.length) : entry.id,
    name: entry.name,
    world: !!entry.world,
    ...(entry.icon ? { icon: entry.icon } : {}),
    ...(entry.worldIconDeclared ? { worldIconDeclared: true } : {}),
    ...(entry.worldIcon ? { worldIcon: entry.worldIcon } : {}),
    ...(entry.wmClass ? { appId: entry.wmClass } : {}),
  }));
}

async function run() {
  const fd = shellFd();
  const desktopRoot = required('SPAOS_DESKTOP_ROOT');
  const electronBinary = required('SPAOS_ELECTRON_BINARY');
  const nativeBinary = required('VALDI_SHELL_BINARY');
  const bundle = required('VALDI_SHELL_BUNDLE');
  required('WORLD_OS_NATIVE_ASSETS');
  const runtimeRoot = process.env.XDG_RUNTIME_DIR || path.join('/run/user', String(process.getuid()));
  const privateDir = await mkdtemp(path.join(runtimeRoot, 'valdi-shell-'));
  const socketPath = path.join(privateDir, 'ui.sock');
  const token = randomBytes(32).toString('hex');
  const expected = Buffer.from(token, 'ascii');
  const client = new CompositorClient(fd);
  let connected = false;
  let ui = null;
  let uiAuthenticated = false;
  let uiReady = false;
  let reportedReady = false;
  let child = null;
  let closed = false;
  let catalogPromise = null;
  let catalog = null;
  let hostApps = [];
  let publishedGeneration = 0;
  let instanceName = null;
  const sendUi = message => {
    if (!uiAuthenticated || !ui || ui.destroyed) return;
    if (ui.writableLength > MAX_UI_OUTBOX) {
      log('renderer channel exceeded its output bound');
      ui.destroy();
      return;
    }
    ui.write(JSON.stringify(message) + '\n');
  };
  const greetUi = () => {
    if (!connected || !uiAuthenticated || !client.output) return;
    sendUi({ type: 'hello', protocol: PROTOCOL_VERSION, output: client.output });
    sendUi({ type: 'windows', windows: client.windows });
    sendUi({ type: 'spaces', spaces: client.spaces });
  };
  const publish = async () => {
    if (!instanceName) throw new Error('SPAOS did not provide a Package Manager instance');
    let snapshot;
    if (!catalog) {
      const loaded = await probeSpaosCatalog({ desktopRoot, electronBinary, instanceName,
        report: log });
      catalog = loaded.catalog;
      hostApps = loaded.host;
      snapshot = loaded.snapshot;
    } else snapshot = await catalog.refresh();
    if (snapshot.generation === publishedGeneration) return;
    client.send({ type: 'publish_apps', catalogGeneration: snapshot.generation,
      verbOwners: snapshot.verbOwners, apps: catalogRows(snapshot, hostApps), harness: [] });
    publishedGeneration = snapshot.generation;
    log(`published ${snapshot.apps.length} authenticated SPAOS apps, ${hostApps.length} host apps, ` +
      `and ${snapshot.verbOwners.length} verb reservations`);
  };
  const refresh = () => {
    if (!catalogPromise) catalogPromise = publish().finally(() => { catalogPromise = null; });
    return catalogPromise;
  };
  const reportReady = () => {
    if (!connected || !uiReady || reportedReady) return;
    client.send({ type: 'lifecycle_ready' });
    reportedReady = true;
    log('native Space UI frame presented; Shell lifecycle ready');
  };
  const handleUiRequest = value => {
    if (value?.type === 'lifecycle_ready') { uiReady = true; reportReady(); return; }
    if (!connected) return;
    const request = requestFromNativeUi(value,
      { output: client.output, windows: client.windows, spaces: client.spaces });
    if (request) client.send(request);
    else log(`refused renderer request ${String(value?.type).slice(0, 40)}`);
  };
  const server = net.createServer(socket => {
    if (ui && !ui.destroyed) { socket.destroy(); return; }
    ui = socket;
    uiAuthenticated = false;
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > MAX_UI_LINE * 2) { socket.destroy(); return; }
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (line.length > MAX_UI_LINE) { socket.destroy(); return; }
        let value;
        try { value = JSON.parse(line); } catch { socket.destroy(); return; }
        if (!uiAuthenticated) {
          const supplied = typeof value?.token === 'string' ? Buffer.from(value.token, 'ascii') : null;
          if (value?.type !== 'ui_auth' || !supplied || supplied.length !== expected.length ||
              !timingSafeEqual(supplied, expected)) { socket.destroy(); return; }
          uiAuthenticated = true;
          greetUi();
        } else handleUiRequest(value);
      }
    });
    socket.on('close', () => {
      if (ui === socket) { ui = null; uiAuthenticated = false; }
    });
    socket.on('error', error => log(`renderer channel: ${error.message}`));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => { server.off('error', reject); resolve(); });
  });
  async function shutdown() {
    if (closed) return;
    closed = true;
    child?.kill('SIGTERM');
    ui?.destroy();
    server.close();
    client.close();
    await rm(privateDir, { recursive: true, force: true });
  }
  client.on('log', log);
  client.on('error', error => { log(error.stack || error); shutdown().then(() => { process.exitCode = 1; }); });
  client.on('disconnected', () => { log('compositor disconnected'); shutdown(); });
  client.on('lifecycleQuit', () => shutdown());
  client.on('hello', hello => { instanceName = hello.instanceName; });
  client.on('connected', () => {
    connected = true;
    greetUi();
    reportReady();
    refresh().catch(error => log(`catalog refresh failed: ${String(error)}`));
  });
  client.on('windows', windows => sendUi({ type: 'windows', windows }));
  client.on('spaces', spaces => sendUi({ type: 'spaces', spaces }));
  client.on('output', output => { if (connected) sendUi({ type: 'output', output }); });
  client.on('open-app', (name, at, background) => {
    refresh().then(() => {
      const wanted = String(name).toLowerCase();
      const host = hostApps.find(entry => entry.id.toLowerCase() === wanted) ??
        (() => {
          const labels = hostApps.filter(entry => entry.name.toLowerCase() === wanted);
          return labels.length === 1 ? labels[0] : undefined;
        })();
      const entry = catalog.resolve(name) ?? host;
      if (!entry) { log(`refusing unknown app ${String(name).slice(0, 80)}`); return; }
      client.send({ type: 'launch', ...(entry.launch ? { launch: entry.launch } : { command: entry.exec }),
        ...(at ? { at } : {}),
        ...(entry.singleInstance && entry.wmClass ? { only_one: entry.wmClass } : {}),
        background: !!background });
      log(`requested ${entry.launch ? 'digest-bound' : 'host'} launch of ${entry.id}`);
    }).catch(error => log(`could not resolve ${String(name)}: ${String(error)}`));
  });
  client.on('present-app', (name, anchor) => {
    refresh().then(() => {
      const entry = catalog.resolve(name);
      if (!entry?.launch) {
        log(`refusing presentation of unknown installed app ${String(name).slice(0, 80)}`);
        return;
      }
      client.send({ type: 'present', launch: entry.launch,
        ...(entry.singleInstance && entry.wmClass ? { only_one: entry.wmClass } : {}),
        ...(anchor ? { anchor } : {}) });
      log(`requested digest-bound presentation of ${entry.id}`);
    }).catch(error => log(`could not present ${String(name)}: ${String(error)}`));
  });
  client.connect();
  const childEnv = { ...process.env, SDL_VIDEODRIVER: 'wayland',
    VALDI_SHELL_UI_SOCKET: socketPath, VALDI_SHELL_UI_TOKEN: token };
  if (process.env.VALDI_SHELL_CAPTURE)
    childEnv.THREE_NATIVE_LINUX_CAPTURE = process.env.VALDI_SHELL_CAPTURE;
  delete childEnv.SPAOS_SHELL_CHANNEL_FD;
  delete childEnv.SPAOS_APP_CHANNEL_FD;
  child = spawn(nativeBinary, ['--interactive', '--shell-client', bundle],
    { env: childEnv, stdio: 'inherit' });
  child.on('error', error => { log(`native renderer failed: ${error.message}`); shutdown(); });
  child.on('exit', (code, signal) => {
    log(`native renderer exited: ${code ?? signal}`);
    const expectedStop = closed;
    shutdown().then(() => { process.exitCode = expectedStop ? 0 : code || 1; });
  });
  const refreshTimer = setInterval(() => {
    if (connected) refresh().catch(error => log(`catalog refresh failed: ${String(error)}`));
  }, 60_000);
  refreshTimer.unref();
  process.on('SIGTERM', () => shutdown());
  process.on('SIGINT', () => shutdown());
}

run().catch(error => { log(error?.stack || error); process.exitCode = 1; });
