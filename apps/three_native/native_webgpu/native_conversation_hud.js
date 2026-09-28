// Camera-fixed typed conversation for Hermes. The agent and SPAOS own the
// conversation and actions; this layer only presents input and returned text.
import { wrapNativeReply } from './native_conversation_wrap.mjs';

export function createNativeConversationHud({ THREE, scene, camera, makeText, onSubmit }) {
  const root = new THREE.Group();
  camera.add(root);
  scene.add(camera);
  const background = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0x292c31, transparent: true, opacity: .84,
      depthTest: false, depthWrite: false, toneMapped: false }));
  background.renderOrder = 1100;
  root.add(background);
  const labels = [];
  let width = 720, height = 720, units = 1;
  let focus = false, text = '', answer = 'ASK WORLDOS', ready = false;
  let awaiting = false, answerScroll = 0;
  let activeInputId = null, partial = '', lastPartialDraw = 0;
  const panelWidth = () => Math.max(180, Math.min(600, width - 170));
  const panelTop = () => height - 145;
  function place(mesh, x, y) {
    mesh.position.set((x - width / 2) * units, (height / 2 - y) * units, -1.1);
  }
  function addLabel(value, x, y, size, color) {
    const { texture, width: pixels, height: pixelsHigh } = makeText(value, color);
    const pixelWidth = pixels * size / pixelsHigh;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true,
        depthTest: false, depthWrite: false, toneMapped: false }));
    mesh.scale.set(pixelWidth * units, size * units, 1);
    mesh.renderOrder = 1110;
    place(mesh, x + pixelWidth / 2, y);
    root.add(mesh);
    labels.push({ mesh, texture });
  }
  const rowLimit = () => Math.max(16, Math.floor((panelWidth() - 50) / 12.5));
  const answerRows = () => wrapNativeReply(answer, rowLimit());
  function redraw() {
    for (const { mesh, texture } of labels) {
      root.remove(mesh); texture.dispose(); mesh.material.dispose(); mesh.geometry.dispose();
    }
    labels.length = 0;
    const panel = panelWidth();
    background.scale.set(panel * units, 105 * units, 1);
    place(background, width / 2, panelTop() + 52);
    const left = (width - panel) / 2 + 18;
    addLabel(ready ? 'WORLDOS' : 'WORLDOS OFFLINE', left, panelTop() + 17, 13,
      ready ? [182, 214, 190] : [218, 170, 148]);
    const rows = answerRows();
    const start = Math.max(0, rows.length - 3 - answerScroll);
    if (rows.length > 3 && panel > 300)
      addLabel(`${start + 1}-${Math.min(start + 3, rows.length)}/${rows.length}  UP/DOWN`,
        left + panel - 178, panelTop() + 17, 11, [183, 187, 192]);
    rows.slice(start, start + 3).forEach((row, index) =>
      addLabel(row, left, panelTop() + 37 + index * 17, 17, [242, 241, 237]));
    const input = text ? text.slice(-Math.max(18, Math.floor((panel - 45) / 8.5))) :
      (focus ? 'TYPE A MESSAGE...' : 'CLICK HERE TO ASK');
    addLabel(`${focus ? '> ' : ''}${input}${focus ? '_' : ''}`, left,
      panelTop() + 88, 15, text ? [255, 255, 255] : [185, 187, 192]);
  }
  function submit() {
    const said = text.trim();
    if (!said) return false;
    text = '';
    answer = ready ? 'THINKING...' : 'THE WORLDOS MIND IS OFFLINE';
    awaiting = ready;
    partial = ''; answerScroll = 0;
    redraw();
    if (ready) {
      activeInputId = onSubmit(said);
      if (!activeInputId) {
        awaiting = false;
        answer = 'THE WORLDOS MIND DISCONNECTED';
        redraw();
      }
    }
    return true;
  }
  return {
    resize(nextWidth, nextHeight, extent) {
      width = nextWidth; height = nextHeight;
      units = 2 * extent / height;
      redraw();
    },
    pointer(x, y, clicked) {
      if (!clicked) return false;
      const inside = x >= (width - panelWidth()) / 2 &&
        x <= (width + panelWidth()) / 2 && y >= panelTop() && y <= panelTop() + 105;
      if (inside) { focus = true; redraw(); return true; }
      if (focus) { focus = false; redraw(); }
      return false;
    },
    text(input) {
      if (!focus || typeof input !== 'string') return false;
      text = (text + input).slice(0, 2000);
      redraw();
      return true;
    },
    key(kind) {
      if (!focus) return false;
      if (kind === 'enter') return submit();
      if (kind === 'backspace') { text = [...text].slice(0, -1).join(''); redraw(); return true; }
      if (kind === 'up' || kind === 'down') return this.scroll(kind === 'up' ? 1 : -1);
      return false;
    },
    scroll(amount) {
      if (!focus) return false;
      const available = Math.max(0, answerRows().length - 3);
      answerScroll = Math.max(0, Math.min(available, answerScroll + Math.sign(amount)));
      redraw();
      return true;
    },
    setReady(value) {
      if (ready === !!value) return;
      ready = !!value;
      if (!ready && awaiting) {
        answer = 'THE WORLDOS MIND DISCONNECTED'; awaiting = false;
        activeInputId = null; partial = '';
      }
      redraw();
    },
    delta(value, inputId) {
      if (!awaiting || (activeInputId && inputId !== activeInputId) ||
          typeof value !== 'string' || !value) return;
      partial = (partial + value).slice(-8000);
      answer = partial;
      answerScroll = 0;
      const now = Date.now();
      if (now - lastPartialDraw >= 80) { lastPartialDraw = now; redraw(); }
    },
    status(state) {
      if (!awaiting || !['done', 'failed', 'stopped'].includes(state)) return;
      awaiting = false;
      activeInputId = null;
      answer = partial || (state === 'done' ? 'NO REPLY' :
        state === 'stopped' ? 'REQUEST STOPPED' : 'REQUEST FAILED');
      partial = '';
      redraw();
    },
    say(value) {
      answer = String(value || '').trim() || 'NO REPLY';
      awaiting = false;
      activeInputId = null; partial = ''; answerScroll = 0;
      redraw();
    },
    isFocused: () => focus,
    blur() { if (focus) { focus = false; redraw(); return true; } return false; },
  };
}
