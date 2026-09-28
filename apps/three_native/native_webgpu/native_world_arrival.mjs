// The native World has no flight animation. Reveal the active SPAOS space once
// it contains a mapped window; SPAOS's own hold deadline remains the fallback.
export function createNativeArrivalReveal() {
  let active = null;
  let revealed = null;
  return (spaces, sendReveal) => {
    const space = Array.isArray(spaces) ? spaces.find(item => item?.active &&
      Number.isInteger(item.id) && item.id > 0) : null;
    if (!space) {
      active = revealed = null;
      return null;
    }
    if (space.id !== active) {
      active = space.id;
      revealed = null;
    }
    if (!Number.isInteger(space.windows) || space.windows < 1 ||
        revealed === space.id || typeof sendReveal !== 'function') return null;
    if (!sendReveal(space.id)) return null;
    revealed = space.id;
    return space.id;
  };
}
