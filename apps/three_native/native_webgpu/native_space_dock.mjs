// Keep the compositor's hit rectangle and the Three scene on the same geometry.
// These are logical output pixels, as reported in SPAOS's Shell hello.
export const DOCK_HEIGHT = 48;
export const DOCK_BOTTOM_INSET = 19;

export function nativeDockLayout(output, windows, position = null) {
  if (!output || !Number.isInteger(output.width) || !Number.isInteger(output.height) ||
      output.width < 240 || output.height < DOCK_HEIGHT + DOCK_BOTTOM_INSET ||
      !Array.isArray(windows)) return null;
  const limit = Math.max(96, Math.floor(output.width / 2) - 56);
  const buttons = [{ kind: 'grip', width: 24 },
    { kind: 'world', id: 0, label: 'WORLD', width: 76 }];
  let width = 16 + 24 + 8 + 76;
  for (const window of windows) {
    if (!Number.isSafeInteger(window?.id) || window.id < 1) continue;
    const label = String(window.title || window.app_id || `WINDOW ${window.id}`).slice(0, 22);
    const taskWidth = Math.min(184, Math.max(108, label.length * 8 + 42));
    if (width + 8 + taskWidth > limit) break;
    buttons.push({ kind: 'window', id: window.id, label, width: taskWidth });
    width += 8 + taskWidth;
  }
  const homeX = Math.max(0, Math.min(output.width - width,
    Math.round(output.width * .75 - width / 2)));
  const homeY = output.height - DOCK_BOTTOM_INSET - DOCK_HEIGHT;
  const away = Number.isFinite(position?.x) && Number.isFinite(position?.y);
  const x = away ? Math.round(Math.max(0, Math.min(output.width - width, position.x))) : homeX;
  const y = away ? Math.round(Math.max(0, Math.min(output.height - DOCK_HEIGHT, position.y))) : homeY;
  let buttonX = x + 8;
  for (const button of buttons) {
    button.x = buttonX;
    buttonX += button.width + 8;
  }
  return { x, y, w: width, h: DOCK_HEIGHT, home: !away, buttons };
}
