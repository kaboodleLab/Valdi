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
| Grid material and tile geometry | WorldOS `native-grid-scene.js`; consumed by the native bundle. Native Home now applies the browser's flat-bed setting, leaving a continuous ground surface beneath sparse occupied tiles. |
| Home camera, occupancy fit, and jar rig | WorldOS `world-home-composition.js`; both browser and native consume its camera basis, Home framing law, jar profile, tilt/spin hierarchy, landed jar/contact-shadow pose and night-lamp law. Native People-on-Home adds vertical actor bounds to the fit. |
| Jar glass and contact-shadow shaders | WorldOS `world-jar-materials.js`; browser and native import the same factories. Native scene capture and graphics adaptation are host owned. The native authored glass path is opt-in while its cost and full-scene color match are evaluated. |
| Home hole mouth | WorldOS `world-hole-bell.js` owns the bell profile, analytic rim normals, vertex shade, and geometry in both hosts. `world-home-hole-appearance.js` owns the aperture and visibility rule. Native cuts the same circular aperture through its tile and painted grid, then supplies its own tile material and dark throat. Native Home starts with the settled hole open; its tile toggles the jar for comparison. |
| Time of day | WorldOS `world-daylight.js` owns the room key palette, position and intensity for both renderers. Native `native_world_sun.mjs` projects the clock into the grid's sun-grade uniforms. The native jar uses the authored warm floor pool and local point light at night. |
| Character movement and avoidance | WorldOS `character-world.js`; native scene loads the authored character assets. The native frame pump advances Three's animation callbacks so the GPU skeleton palette follows the simulation. Native roster arrivals follow the browser character engine's golden-angle seating, and Home renders bodies at its 0.55-unit stature. |
| Encyclopedia body and Home pose | WorldOS `world-book-rig.js` owns the Home book group, tilt, rig, shadow, and pose application in both hosts. `world-book-action.js` defines native `book.open` input and pagination. Native Home prints the supplied short article, opens the cover in a focused reading view, and advances pages by click. The browser still has richer article generation, page graphics and physical page flips. |
| App catalog, spaces, window seats, previews | SPAOS World channel; native host and scene read snapshots, SPAOS composites windows. |
| App launch, enter, leave, reveal and release | Native World sends requests over its inherited privileged SPAOS channel. |
| Space dock and app controls | Native Space UI sends bounded requests through its Shell controller; SPAOS checks the latest snapshot. |
| Native HUD text | Linux host rasterizes UTF-8 with FreeType into Three textures. The WorldOS font can be supplied from the local asset root without packaging it in Valdi; installed open fonts are fallbacks. |

## Gaps against the production World on tty1

- The theme selector now exposes the browser's five named environments in
  tty2. Classic and Rolling meadow use the existing native surfaces; Desert
  dunes, Tropical island, and Lunar surface use bounded native terrain
  adapters. Those three still need the browser's scenery, water, atmospheric
  detail, transitions, and persistence. The selector is a flat native panel
  rather than the browser's spinning globe fan.
- The native app catalog now sits on the selected free world cell; the launcher
  button chooses one nearby. Its rounded slab grows and lifts with the browser's
  shared spring and tile pose. The World scene flies its orthographic camera
  toward that cell using the shared turn and target-height law, then restores
  the captured Home view on dismissal. SPAOS's authenticated `world` flag
  separates its South Park apps from host Native apps; the catalog uses the
  browser's band layout and shows prepared GLB miniatures where available.
  Its World OS band needs explicit category metadata before it can be populated.
  Search, page selection, transformed hit testing, and app launch from the
  chosen cell work on tty2. SPAOS still validates the app key and destination;
  handoff waits for the 300 ms close motion. The conversation card clears while
  the catalog is open. This is still an adaptation: the browser uses a
  perspective lens, continuous spatial scrolling, content masking, authored
  tile shader and shadows, and icon landing. Native paging and a simple ground
  shadow stand in for those effects. Long names shrink to fit their cards.
- FreeType removes the former all-caps, restricted-glyph presentation for
  Linux. The chat card now uses measured glyph widths for reply wrapping and
  input fitting. Native text still lacks complex-script shaping, color emoji,
  and browser-equivalent line height and baseline metrics.
- Home composition differs visibly. The native meadow and jar demonstration
  now shares the production camera basis and Home framing law. Its hole mouth
  has the production bell geometry, but not the browser's marble pour, memory
  passage, underworld, status controls, or bottom chat orb. The native click
  toggle is local transient state; `world.json` does not record whether the
  browser's live hole is open. Clicking the native mouth does not yet descend
  into the browser's memory level.
  Native Home can show the shared book body, a focused reading pose, and a
  short printed article from its scene-local `book.open` verb. The native mind
  supplies article prose in the verb arguments; the browser uses its own
  completion helper to write a structured article and photo after the call.
  Native pages advance on click without the browser's physical page-turn
  motion. This machine's WorldOS mind may be offline, so the GPU scene action
  can be tested directly even when live voice invocation is unavailable.
  `native_people_scene.js`
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
- The native People card and launcher work. Home uses authenticated roster
  identities and shows the local person even when network presence is off;
  remote people appear only when the roster reports them online. The authored
  sample population remains confined to the People card when live roster data
  is unavailable. Native wandering checks the camera projection, as the browser
  World does, so a framed person does not stroll offscreen. Cold model loading
  and avatar frame cost still need work.
- In the live 1440×900 tty2 Home with one authenticated avatar, an active-VT
  20-second run logged 120 presented frames about every two seconds. That is
  frame cadence, not a GPU completion or input-latency measurement. The
  inactive VT logs substantially fewer frames, so it is not a valid proxy for
  the displayed session.
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

Prioritize the shell surfaces visible on every visit: share the browser's
theme selection and transition law, refine the world-cell launcher with
continuous spatial scrolling, masking and landing, and add measured text layout
and shaping. Profile the camera flight and catalog before raising scene detail.
The native landscapes remain bounded adapters until the browser's
ground scenes can expose reusable geometry and material contracts. SPAOS
continues to own the space and window protocol. The marble pour, memory
descent, and richer book motions remain later scene-parity work.

For acceptance, capture tty1 and tty2 at the same WorldOS state, ground
selection, time of day, viewport, and camera pose. Check book/well placement,
avatar positions, app tiles and previews, HUD controls, input targets, then
repeat the launch/return and frame-timing probes. The current live visual
comparison is useful for identifying gaps, but differing live state, viewport,
camera framing and remaining host materials make a pixel-level claim premature.
