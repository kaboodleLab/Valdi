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
| Home camera, occupancy fit, and jar rig | WorldOS `world-home-composition.js`; both browser and native consume its camera basis, Home framing law, jar profile, tilt/spin hierarchy, landed jar/contact-shadow pose and night-lamp law. Native People-on-Home adds vertical actor bounds to the fit. |
| Jar glass and contact-shadow shaders | WorldOS `world-jar-materials.js`; browser and native import the same factories. Native scene capture and graphics adaptation are host owned. The native authored glass path is opt-in while its cost and full-scene color match are evaluated. |
| Time of day | WorldOS `world-daylight.js` owns the room key palette, position and intensity for both renderers. Native `native_world_sun.mjs` projects the clock into the grid's sun-grade uniforms. The native jar uses the authored warm floor pool and local point light at night. |
| Character movement and avoidance | WorldOS `character-world.js`; native scene loads the authored character assets. The native frame pump advances Three's animation callbacks so the GPU skeleton palette follows the simulation. |
| Encyclopedia body and Home pose | WorldOS `world-book-rig.js` now owns the Home book group, tilt, rig, shadow, and pose application in both hosts. Each renderer supplies its own materials. Native Home draws a closed book on a free tile from a local Book control. The browser still owns article print, page motion and full interaction. |
| App catalog, spaces, window seats, previews | SPAOS World channel; native host and scene read snapshots, SPAOS composites windows. |
| App launch, enter, leave, reveal and release | Native World sends requests over its inherited privileged SPAOS channel. |
| Space dock and app controls | Native Space UI sends bounded requests through its Shell controller; SPAOS checks the latest snapshot. |

## Gaps against the production World on tty1

- Home composition differs visibly. The native meadow and jar demonstration
  now shares the production camera basis and Home framing law, but does not
  reproduce the production room's well, status controls, and bottom orb.
  Native Home can now show the shared closed book body and pose from explicit
  transient state, with a native Book control; it does not yet open articles,
  turn pages, or receive the browser's `book.open` action. `native_people_scene.js`
  also contains a small book/well display for its People view. The book now
  has a WorldOS-owned scene factory, but Home as a whole does not. The production owners are in `02-stage-and-camera.js`,
  `08-jar.js`, `20-holes-and-labels.js`, and `characters.js`.
  The browser book's active flag and tile live in `20-holes-and-labels.js` and
  are not `world.json` book props on this WorldOS revision. A native renderer
  driven only by saved props cannot infer when the real Home book is present.
  The native control owns its local transient presence until the World scene
  action channel can deliver the same event to both hosts.
- The production jar shader is shared, but the native authored mode uses a
  half-resolution scene capture refreshed on state or camera changes and at
  least every 24 frames for moving people. In repeated 1600×900 meadow plus
  11-avatar runs on this Linux GPU, settled authored windows ranged from
  41.3–48.6 ms p50 and 52.4–64.1 ms p95; the later physical run ranged from
  46.0–48.5 ms p50 and 53.7–58.4 ms p95. These runs preceded the GPU skeleton
  fix. The sequential runs do not establish
  a stable material-only cost: frame time drifted during the experiment. An
  earlier version that captured every frame reached 74.1 ms p50. The authored
  mode has a visible dark rim and pale body in the current native scene; a
  matched production scene/color comparison is still needed. Keep the physical
  material as the default for interactive use until that visual match is proved.
- The native shell can launch apps and switch spaces, but the production World
  also has flight animation, tray behavior, furniture interactions, and other
  overlays. The native renderer currently reveals mapped windows immediately
  because it has no flight animation. SPAOS deadlines remain in force.
- The native People card and launcher work; the live roster on this test
  machine currently reports zero members, so the authored sample population
  appears. Presence must remain sourced from the authenticated roster when it
  has members, with no fabricated live status.
- In earlier isolated 1600×900 Linux compositor runs with meadow and 11 sample
  avatars, the corrected shared frame kept every avatar visible. Settled
  120-frame intervals ranged from 28.06–34.15 ms p50 and 34.32–40.14 ms p95
  across two runs (render time 22.45–27.63 ms p50). Those runs preceded the
  native frame-pump fix and did not animate the GPU skeletons. After the fix,
  settled live tty2 120-frame windows at 1600×900 with meadow and 11 people
  measured about 33 ms p50 and 34 ms p95. The sustained follow-up
  above was slower, so the benchmark remains sensitive to machine state.
  Boot-time model loading produces much
  longer outliers. Earlier
  lower-resolution runs measured about 22/25 ms p50/p95 with avatars and
  16.6/17.3 ms with meadow alone. This scene is below a 60 fps target on the
  test GPU and needs profiling before being considered a production default.

## Next extraction boundary

Carry the Home book pattern to the next visible scene object, then add a shared
World action boundary for transient Home events such as `book.open`. The shared
scene leaf should own hierarchy, pose, pick targets, and disposal; the browser
and native hosts should supply materials and route input. Keep SPAOS's space
and window protocol separate from scene creation. This avoids growing a
second hand-copied World inside Valdi.

For acceptance, capture tty1 and tty2 at the same WorldOS state, ground
selection, time of day, viewport, and camera pose. Check book/well placement,
avatar positions, app tiles and previews, HUD controls, input targets, then
repeat the launch/return and frame-timing probes. The current live visual
comparison is useful for identifying gaps, but its different ground settings
make a pixel-level claim premature.
