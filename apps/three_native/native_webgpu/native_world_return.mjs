// A SPAOS dock switch can leave an app space without invoking World's Back
// handler. Track that return from the authoritative floor so World releases
// the compositor's linger after its newer preview is on the native tile.
export function beginReturnFromFloor(activeSpace, returningSpace, spaces,
                                     previewGenerations, cards) {
  if (returningSpace || !Number.isInteger(activeSpace) || activeSpace < 1 ||
      !Array.isArray(spaces)) return returningSpace;
  const leaving = spaces.find(space => space?.id === activeSpace &&
    space.active === false && space.lingering === true);
  if (!leaving) return null;
  return {
    id: activeSpace,
    generation: Math.max(previewGenerations.get(activeSpace) || 0,
      cards.get(activeSpace)?.generation || 0),
  };
}
