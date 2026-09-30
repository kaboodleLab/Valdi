// SPAOS owns the World process. The inherited World channel is the only path
// for a native host to request its own cooperative replacement.
export function createNativeWorldLifecycle({ sendStatus, sendRestart, requestQuit, stage,
  now = Date.now }) {
  let sequence = 0;
  let statusId = null;
  let submitId = null;
  let quitting = false;
  const nextId = () => `native-world-${now()}-${++sequence}`;

  function restart() {
    if (statusId || submitId || quitting || typeof sendStatus !== 'function') return false;
    const id = nextId();
    if (!sendStatus(id)) return false;
    statusId = id;
    stage('WorldOS asked SPAOS for World restart status');
    return true;
  }

  function onMessage(message) {
    if (message.type === 'lifecycle_quit') {
      if (!quitting) {
        quitting = true;
        stage('WorldOS is closing for SPAOS World restart');
        requestQuit?.();
      }
      return true;
    }
    if (message.type !== 'lifecycle_result') return false;
    if (message.id === statusId) {
      statusId = null;
      const result = message.result;
      if (!result?.ok || !result.targets?.world?.ready ||
          typeof result.session !== 'string') {
        stage(`WorldOS restart unavailable: ${result?.error || 'World is not ready'}`);
        return true;
      }
      const id = nextId();
      if (typeof sendRestart === 'function' && sendRestart(id, result.session, id)) {
        submitId = id;
        stage('WorldOS requested a cooperative World restart from SPAOS');
      } else {
        stage('WorldOS could not send the restart request');
      }
      return true;
    }
    if (message.id === submitId) {
      submitId = null;
      if (!message.result?.ok)
        stage(`WorldOS restart refused: ${message.result?.error || 'unknown reason'}`);
      return true;
    }
    return false;
  }

  return { restart, onMessage };
}
