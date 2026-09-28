// The Shell capability is the inherited SPAOS_SHELL_CHANNEL_FD. Keep protocol
// handling separate from the GPU scene so reconnect, launch and input work can
// be tested without a Wayland compositor.
export function createNativeSpaosShellProtocol({ protocolVersion, send, onState, onQuit,
  dockHeight = 64 }) {
  let ready = false;
  let output = null;
  let windows = [];
  let spaces = [];
  let stopped = false;

  const request = value => send(JSON.stringify(value));
  function placeDock() {
    if (!output) return;
    request({ type: 'set_dock_rect', x: 0, y: output.height - dockHeight,
      w: output.width, h: dockHeight, home: false });
  }
  function publish() {
    onState({ output, windows, spaces, ready });
  }
  function acceptOutput(value) {
    if (!Number.isInteger(value?.width) || !Number.isInteger(value?.height) ||
        value.width < 1 || value.height < dockHeight) return false;
    output = { width: value.width, height: value.height,
      scale: Number.isFinite(value.scale) && value.scale > 0 ? value.scale : 1 };
    return true;
  }
  function ingest(lines) {
    if (stopped) return;
    for (const line of lines.split('\n')) {
      if (!line) continue;
      let event;
      try { event = JSON.parse(line); }
      catch { throw new Error('SPAOS sent malformed shell JSON'); }
      if (!ready) {
        if (event?.type !== 'hello' || event.protocol !== protocolVersion ||
            !acceptOutput(event.output))
          throw new Error('SPAOS shell protocol or output mismatch');
        ready = true;
        request({ type: 'reserve_space_ui', height: dockHeight });
        placeDock();
        publish();
        continue;
      }
      if (event.type === 'hello') throw new Error('SPAOS repeated the shell hello');
      if (event.type === 'lifecycle_quit') {
        stopped = true;
        onQuit();
        return;
      }
      if (event.type === 'output' && acceptOutput(event.output)) {
        placeDock();
        publish();
      } else if (event.type === 'windows' && Array.isArray(event.windows)) {
        windows = event.windows.filter(window => Number.isSafeInteger(window?.id) && window.id > 0);
        publish();
      } else if (event.type === 'spaces' && Array.isArray(event.spaces)) {
        spaces = event.spaces.filter(space => Number.isSafeInteger(space?.id) && space.id > 0);
        publish();
      }
    }
  }
  function focus(id) {
    if (!ready || !windows.some(window => window.id === id)) return false;
    return request({ type: 'focus', id });
  }
  function close(id) {
    if (!ready || !windows.some(window => window.id === id)) return false;
    return request({ type: 'close', id });
  }
  function switchSpace(id) {
    if (!ready || (id !== 0 && !spaces.some(space => space.id === id))) return false;
    return request({ type: 'switch_space', id });
  }
  return { ingest, focus, close, switchSpace, getState: () => ({ output, windows, spaces, ready }) };
}
