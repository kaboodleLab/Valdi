# Native WorldOS shell parity

The Linux tty2 experiment is already a real SPAOS session: SPAOS owns the
compositor, app windows, spaces, privileged app catalog, and window previews.
Valdi/Hermes runs a Three r186 scene on Dawn/WebGPU for World, plus a separate
transparent Three Space UI surface. A real Calculator opened from the native
launcher, mapped in its own SPAOS space, and returned through both the SPAOS
World dock and World's Back button on 2026-09-28. Space and window arrival
holds were revealed before their one-second deadlines; the departing space
was released after a fresh preview, before its two-second deadline. Leaving
an empty space releases it immediately because there is no preview to await.

## What is shared today

| Concern | Authority and current implementation |
| --- | --- |
| Grid material and tile geometry | WorldOS `native-grid-scene.js`; consumed by the native bundle. |
| Time of day | Native `native_world_sun.mjs` projects WorldOS's clock into the shared grid uniforms and meadow light. |
| Character movement and avoidance | WorldOS `character-world.js`; native scene loads the authored character assets. |
| App catalog, spaces, window seats, previews | SPAOS World channel; native host and scene read snapshots, SPAOS composites windows. |
| App launch, enter, leave, reveal and release | Native World sends requests over its inherited privileged SPAOS channel. |
| Space dock and app controls | Native Space UI sends bounded requests through its Shell controller; SPAOS checks the latest snapshot. |

## Gaps against the production World on tty1

- Home composition differs visibly. The native meadow and jar demonstration
  does not reproduce the production room's book, well, lighting, camera,
  status controls, and bottom orb. `native_people_scene.js` contains a small
  book/well approximation for its People view; that is not a reusable WorldOS
  home scene owner. The production owners are in `02-stage-and-camera.js`,
  `08-jar.js`, `20-holes-and-labels.js`, and `characters.js`.
- The native shell can launch apps and switch spaces, but the production World
  also has flight animation, tray behavior, furniture interactions, and other
  overlays. The native renderer currently reveals mapped windows immediately
  because it has no flight animation. SPAOS deadlines remain in force.
- The native People card and launcher work; the live roster on this test
  machine currently reports zero members, so the authored sample population
  appears. Presence must remain sourced from the authenticated roster when it
  has members, with no fabricated live status.
- With the 11 sample avatars visible on the Linux test GPU, 120-frame native
  intervals were around 22 ms p50 and 25 ms p95. Meadow-only intervals were
  around 16.6 ms p50 and 17.3 ms p95. Avatar and scene cost needs profiling
  before claiming a 60 fps shell.

## Next extraction boundary

Extract the production home composition and camera as a WorldOS-owned Three
scene factory, following `native-grid-scene.js`. It should accept authored
state and return scene nodes, update hooks, picking targets, and a disposal
function. The browser World should consume the same factory first; then the
native bundle can import it through `build_world_runtime.sh`. Keep SPAOS's
space and window protocol separate from scene creation. This avoids growing a
second hand-copied World inside Valdi.

For acceptance, capture tty1 and tty2 at the same WorldOS state, ground
selection, time of day, viewport, and camera pose. Check book/well placement,
avatar positions, app tiles and previews, HUD controls, input targets, then
repeat the launch/return and frame-timing probes. The current live visual
comparison is useful for identifying gaps, but its different ground settings
make a pixel-level claim premature.
