const DOCK_HEIGHT = 64;

// The renderer's socket is deliberately less powerful than SPAOS's Shell
// capability. Reconstruct each allowed request from a compositor snapshot.
export function requestFromNativeUi(value, { output, windows, spaces }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  switch (value.type) {
    case 'reserve_space_ui':
      return value.height === DOCK_HEIGHT
        ? { type: 'reserve_space_ui', height: DOCK_HEIGHT } : null;
    case 'set_dock_rect':
      return output && value.home === false && value.x === 0 &&
        value.y === output.height - DOCK_HEIGHT && value.w === output.width &&
        value.h === DOCK_HEIGHT
        ? { type: 'set_dock_rect', x: 0, y: output.height - DOCK_HEIGHT,
          w: output.width, h: DOCK_HEIGHT, home: false } : null;
    case 'focus':
    case 'close':
      return Number.isSafeInteger(value.id) && windows.some(window => window.id === value.id)
        ? { type: value.type, id: value.id } : null;
    case 'switch_space':
      return Number.isSafeInteger(value.id) && (value.id === 0 ||
        spaces.some(space => space.id === value.id))
        ? { type: 'switch_space', id: value.id } : null;
    default:
      return null;
  }
}
