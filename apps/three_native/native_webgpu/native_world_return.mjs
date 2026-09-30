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

export function canReleaseReturn(returningSpace, space, card) {
  return returningSpace?.id === space?.id && space.active === false &&
    (space.windows === 0 || (Number.isInteger(space.windows) &&
      space.windows > 0 && card?.generation > returningSpace.generation));
}

// Back and a foreground scene action leave through the same World-only door.
// The departing space keeps its windows; World releases the linger after a
// newer preview, exactly as for a dock return.
export function returnForLeave(leavingSpace, previewGenerations, cards) {
  if (!Number.isInteger(leavingSpace) || leavingSpace < 1) return null;
  return {
    id: leavingSpace,
    generation: Math.max(previewGenerations.get(leavingSpace) || 0,
      cards.get(leavingSpace)?.generation || 0),
  };
}

// A person's own book.open must be visible, so it brings World forward from
// an app space. A task's call never moves the person, matching WorldOS's
// browser book.open, which focuses its tile only without a taskId.
//
// An entry World asked for may still be in flight. SPAOS applies a leave
// before an enter handled in the same dispatch, so leaving now could lose to
// that entry. Instead remember that exact space and leave once the floor
// reports it entered. The bound runs from the entry request and outlasts
// SPAOS's longest arrival hold, during which the hidden World may not draw;
// an older request is stale, so it never pulls a later entry back.
//
// The floor may still report the space World left before that request. It is
// left again at once in case it really is current, and its snapshots do not
// cancel the wait for the requested space.
export const SCENE_RETURN_MS = 5000;

const isSpace = space => Number.isInteger(space) && space >= 1;

export function planSceneActionReturn(call, activeSpace, requestedSpace,
                                      requestedAt, now) {
  if (call?.taskId != null) return { leaveNow: false, pending: null };
  const until = requestedAt + SCENE_RETURN_MS;
  const fresh = isSpace(requestedSpace) && requestedSpace !== activeSpace &&
    Number.isFinite(requestedAt) && now <= until;
  return { leaveNow: isSpace(activeSpace), pending: fresh ?
    { space: requestedSpace, until, stale: isSpace(activeSpace) ? activeSpace : null } :
    null };
}

// Runs on each floor snapshot. Only the remembered entry is pulled back;
// another space becoming active, or the deadline passing, drops the intent.
export function settleSceneActionReturn(pending, activeSpace, now) {
  if (!pending || now > pending.until) return { leave: false, pending: null };
  if (activeSpace === pending.space) return { leave: true, pending: null };
  if (activeSpace === null || activeSpace === pending.stale)
    return { leave: false, pending };
  return { leave: false, pending: null };
}
