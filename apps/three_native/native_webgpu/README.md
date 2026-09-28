# Valdi Linux WebGPU binding

The `vendor/` directory contains the MIT-licensed C++ JSI WebGPU layer from
[`react-native-webgpu`](https://github.com/wcandillon/react-native-webgpu),
pinned to commit `e2735d77720b9903772d4d9e5d83bc3a3a27498c`. See
`vendor/NOTICE.md` for changes made for Valdi. It uses Dawn's native WebGPU
implementation and Valdi's Hermes JSI runtime. The native Wayland probe is
`//apps/three_native:three_native_linux_webgpu_surface_probe`.

## Dawn SDK for the Valdi Linux ABI

The pinned Dawn source revision is
`9de0fd67086127228e8aa28e69616da37220cfc3`. Use its official Linux
release archive for headers. Build the static library from that exact source
revision with the **same Clang/libc++ ABI as Valdi**. The official release's
GCC/libstdc++ archive is incompatible with this Valdi Bazel toolchain.

On the Linux demo host, the source build was:

```sh
DAWN_SRC=/home/bjdodson/valdi-dawn-hermes-build/dawn-src
DAWN_BUILD=/home/bjdodson/valdi-dawn-hermes-build/build
LLVM_ROOT=/home/bjdodson/.cache/bazel/_bazel_bjdodson/fc0ab638be7e9ef9d8055b3a0669fbdf/external/+valdi_toolchains+llvm_toolchain_llvm
export PATH=/home/bjdodson/valdi-dawn-lifetime-build/.venv/bin:$PATH
export LD_LIBRARY_PATH="$LLVM_ROOT/lib/x86_64-unknown-linux-gnu:/home/bjdodson/valdi-linux-host-build/lib"
cmake -S "$DAWN_SRC" -B "$DAWN_BUILD" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_COMPILER="$LLVM_ROOT/bin/clang" \
  -DCMAKE_CXX_COMPILER="$LLVM_ROOT/bin/clang++" \
  -DCMAKE_CXX_FLAGS=-stdlib=libc++ \
  -DCMAKE_EXE_LINKER_FLAGS=-stdlib=libc++ \
  -DDAWN_FETCH_DEPENDENCIES=ON -DDAWN_ENABLE_INSTALL=ON \
  -DDAWN_BUILD_SAMPLES=OFF -DDAWN_BUILD_TESTS=OFF \
  -DDAWN_BUILD_MONOLITHIC_LIBRARY=STATIC \
  -DDAWN_ENABLE_VULKAN=ON -DDAWN_ENABLE_DESKTOP_GL=OFF \
  -DDAWN_ENABLE_OPENGLES=OFF -DDAWN_ENABLE_NULL=OFF
cmake --build "$DAWN_BUILD" --target webgpu_dawn -j 8
```

The source tree must be checked out at the revision above; Dawn's dependency
fetch uses the source tree's pinned dependency list. The official release
headers reside in the archive's `include/` directory. Install both pieces:

```sh
bash apps/three_native/native_webgpu/prepare_sdk.sh \
  /path/to/Dawn-9de0fd67086127228e8aa28e69616da37220cfc3-ubuntu-latest-Release \
  "$DAWN_BUILD/src/dawn/native/libwebgpu_dawn.a"
```

The SDK files under `sdk/` are local build artifacts, excluded from Git. The
script verifies the release header revision and libc++ archive ABI. It does
not prove that an arbitrary libc++ archive has the matching Dawn revision;
build it from the pinned source tree as shown.

## Running the probes

From the Valdi checkout on the Linux Wayland desktop:

```sh
bazel build //apps/three_native:three_native_linux_webgpu_probe \
  //apps/three_native:three_native_linux_webgpu_surface_probe
XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0 SDL_VIDEODRIVER=wayland \
  bazel-bin/apps/three_native/three_native_linux_webgpu_surface_probe
```

The surface probe creates a Wayland window, requests a Dawn/Vulkan adapter
and device from Hermes, clears and presents the swapchain, then reads one GPU
pixel back. Passing a bundled JavaScript file to the probe runs that file in
the same Valdi/Hermes runtime after the WebGPU binding and surface are installed.
The `three_scene.js` entry is an initial Three r186 bundle for that path.

### WorldOS home scene

`three_world_home.js` imports WorldOS's `native-grid-scene.js` and
`world-home-composition.js` at bundle time. These supply the painted-grid node
material, rounded tile geometry, Home camera/framing law and jar rig from the
WorldOS engine. This entry loads seven authored GLBs, using
the WorldOS Files stack's `assets/media/town/Box.glb` for Files. It also uses
the production jar's lathe profile and tilt/spin hierarchy. Its landed pose
and blue contact shadow use the shared WorldOS calculation and material. The
native tile top is at local `TILE.H`; the adapter converts the browser pose
from `WORLD_HOME.gridY` to that local datum before placing both meshes. The
default glass uses a Three physical material; prefixing the bundle with
`globalThis.__nativeWorldJarMaterial='authored';` selects WorldOS's shared
`world-jar-materials.js` glass shader through its `home-material.js` graphics adapter.
That mode captures the background at half resolution and refreshes it on
scene/camera changes and at least every 24 frames while people wander. It is
currently slower on the Linux test GPU; see `PARITY.md` for measurements and
remaining visual work. When people stand on Home, their vertical bounds
extend the shared camera fit so standing bodies stay inside the viewport.
The home floor and People preview are separate scene groups. The bottom-left
People control opens the eleven members of WorldOS's own `apps/people/roster.mjs`
sample, using authored character GLBs and the worker's retargeted `StandingIdle`
and `Walk` animations; Back returns to the home floor. The sample is visibly marked.
Movement, pathfinding, crowd avoidance and arrival/departure state come from
WorldOS's pure `character-world.js`, bundled into Hermes with a native Three
visual adapter. The adapter shares equivalent skeleton palettes inside each
avatar, as WorldOS does. In the People view, the People control opens a native
roster panel. A person row or visible body selects that person; Find on Grid
reframes the camera around them. Pause Wandering calls the shared character
simulation's pause door. The panel marks simulated and live presence distinctly.
Gestures, conversations and portal interactions are still browser-World features.
The SPAOS floor and app channel continue updating while People is open.

An opt-in `globalThis.__nativeWorldGround = 'meadow'` bundle prefix now selects
a bounded native Rolling meadow adapter. Its hill, seed, lowland and color-noise
arithmetic follows WorldOS `ground-scenes.js`; 25,921 terrain vertices and
331,776 tapered blade instances draw in 36 culled patches. SPAOS's current
tile cells clear the grass, and the live jar cell moves the lowland. The native
terrain extends beyond the grass patches so a wide camera cannot reveal the
white grid underneath at the viewport corners. The native
adapter currently rebuilds geometry when floor occupancy changes and has no
production wind, shader caches, theme transitions or shadow pass. The native
World samples the local clock and feeds WorldOS's elevation palette, floor
luminance, gradient direction and footprint into the shared grid material;
the meadow's ambient and key lights follow its day/night value. This does not
yet include the production sun and moon bodies or their full lighting rig.
The grid remains the default for an unprefixed bundle. A meadow-only tty2 run
at 2880×1800 measured steady frame interval p50 16.6 ms and p95 17.3–17.6 ms
across several 120-frame windows. The isolated
SPAOS mind-call test and a live typed Hermes reply passed with that scene.
An additional `globalThis.__nativeWorldPeopleOnHome = true` prefix draws the
WorldOS character simulation over that home floor, with feet following the
meadow height, readable name labels, and a click that opens the People card
over the same scene. Back closes the card before leaving the World.
This uses the authored sample team until an authenticated live roster arrives.
The combined scene on tty2 measured interval p50 about 22 ms and p95 about
25 ms with 11 animated people and full grass detail; avatar rendering is the
next performance target. The standalone GPU probe's fixed frame deadline can
expire while loading all 11 models, so compare its frame logs and capture
separately from its exit code for this scene.
When `SPAOS_WORLD_OS_ROOT` points to the WorldOS tree of the running SPAOS
agent service and `SPAOS_AGENT_SERVICE=1`, `run_spaos_world.sh` starts a
companion process with the native host. It authenticates through SPAOS's
existing World frontend transport, subscribes to `/ws/roster`, and writes a
private, per-World snapshot under `XDG_RUNTIME_DIR`. The wrapper gives the
companion and native host the same `WORLD_OS_NATIVE_ROSTER` path. The host
exposes only a bounded read of that file to Hermes; prepared assets stay
read-only and separate sessions cannot overwrite each other's roster. The
renderer shows live members when the provider is online. A provider
that is off uses the marked sample. The attachment credential never enters
Hermes or the snapshot file. The companion exits with the native World.

The same companion now carries the production WorldOS mind socket over a
second private Unix socket. It closes its inherited SPAOS World descriptor;
only the Valdi host can call the compositor. The native World presents an
authenticated, generation-bound app catalog to the mind and shows a typed
conversation field over its Three scene. Long replies retain every wrapped
line; Up/Down or the wheel scrolls a focused reply. A mind action returns to the Valdi
host and crosses SPAOS's World channel, where SPAOS checks the installed owner,
stamps provenance and applies its normal app Verb policy. Headless service
calls use SPAOS's separate service call type. The native renderer receives no
agent attachment token. A dropped mind connection is shown as offline and a
call that cannot be forwarded receives an explicit error. The typed view is a
first conversation surface; streaming text layout, voice and the rest of the
production HUD are still separate parity work. SPAOS currently stamps native
typed calls as agent calls; person-only commit verbs remain denied until SPAOS
can attest typed input from its own seat.
Embedded images are decoded ahead of time into RGBA files because Hermes has no browser
image decoder. `GLTFLoader` still parses geometry, materials and transforms.
The asset builder repacks each native GLB with valid one-pixel embedded images
after decoding the real images to RGBA. It preserves geometry, skin and
animation buffer views; the native texture loader uses the decoded RGBA files.
The original WorldOS GLBs remain in the source tree. On the Linux probe build,
this reduced the prepared asset directory from 367 MiB to 192 MiB with four
People bodies; the eleven-person sample's extra rigs bring it to 218 MiB.
The same preparation step decodes WorldOS's Back and launcher artwork and
rasterizes the bundled SF Pro Display font into a small glyph atlas for the
native shell controls. No browser canvas is used at runtime.

With Three r186, esbuild and sharp available in a Node package directory,
prepare a runtime directory outside the checkout. The script refuses to
overwrite an existing directory and publishes `assets/`, `world.js`, and
`shell.js` only after all have built successfully. Set `ESBUILD_BIN` if esbuild is not in the
Node directory's `.bin/` folder. `WORLD_SCENE_ROOT` must be a SPAOS checkout
containing `kernel/engine/native-grid-scene.js` and
`kernel/engine/world-home-composition.js`. For a staged scene source, set
`WORLD_HOME_COMPOSITION_SOURCE` to the absolute path of the shared leaf.
`WORLD_OS_ROOT` must have
`kernel/engine/character-world.js` and the sibling `apps/people/roster.mjs`
source. The Linux demo uses SPAOS branch `codex/world-native-scene-contract`;
that scene factory has not landed in SPAOS main. The builder imports WorldOS
`world-jar-materials.js` and `home-material.js` too. If those modules are staged
outside `WORLD_SCENE_ROOT`, set `WORLD_JAR_MATERIALS_SOURCE` and
`WORLD_HOME_MATERIAL_SOURCE` to their paths.
The shell bundle also reads the sibling SPAOS shell protocol
source so its version matches the compositor. If the scene was staged without
that sibling tree, set `SPAOS_SHELL_PROTOCOL_SOURCE` to the matching
`desktop/shell/src/shared/protocol.ts` before building.

```sh
WORLD_OS_ROOT=/path/to/world_os
WORLD_SCENE_ROOT=/path/to/spaos/desktop/world_os
THREE_NODE_MODULES=/path/to/node_modules
WORLD_RUNTIME=/path/to/native-world-runtime
apps/three_native/native_webgpu/build_world_runtime.sh \
  "$WORLD_OS_ROOT" "$WORLD_SCENE_ROOT" "$THREE_NODE_MODULES" "$WORLD_RUNTIME"
WORLD_OS_NATIVE_ASSETS="$WORLD_RUNTIME/assets" \
XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0 SDL_VIDEODRIVER=wayland \
  bazel-bin/apps/three_native/three_native_linux_webgpu_surface_probe \
  --frames=120 "$WORLD_RUNTIME/world.js"
```

Use `--interactive` in place of `--frames=120` to keep the window open. Mouse
motion updates the grid hover cell and clicking starts its lattice wave; Escape
closes the window. `THREE_NATIVE_LINUX_CAPTURE=/tmp/world-home.ppm` captures the
first swapchain frame by GPU readback for visual inspection. The host follows
Wayland pixel-size changes, including SPAOS fullscreen, and updates the Three
camera and WebGPU drawing buffer.
For an isolated People capture, prefix the bundle with
`globalThis.__nativeWorldStartView='people'; globalThis.__worldCaptureFrame=180;`
and run for at least 181 frames. The first rendered frame is also captured, so
the later frame overwrites the same PPM after the character models load.

The normal bundle paces draw starts at 60 Hz, accounting for the synchronous
draw work before scheduling the next callback. Jar and click-wave motion use
elapsed time, so changing frame cadence does not change animation speed.
For an isolated comparison,
prepend configuration to the bundled `world.js` before launching it. This
prefix enables 120-frame timing reports without changing the normal schedule:

```js
globalThis.__worldFrameTiming = true;
```

To restore the previous post-draw 16 ms timer for comparison, prepend:

```js
globalThis.__worldFrameTiming = true;
globalThis.__worldFramePacing = 'legacy';
```

The `WorldOS frame timing` stage line reports p50, p95 and maximum values in
milliseconds for callback intervals, timer wake lateness, state/HUD updates,
the synchronous `renderer.render()` call, the `context.present()` call, and
total synchronous draw work. Timing starts at the third frame because the
first frame performs GPU readback. With timing enabled, a click also logs
`WorldOS input to present`, measured from its JavaScript pointer handler to
the next `context.present()` call. These JS-side spans do not measure GPU
completion or scanout. Compare variants using the same scene, assets, GPU and
compositor session.

On the Linux test GPU at 1596×876, the eleven-person moving sample measured
about 21 ms median and 25 ms p95 frame interval after loading. A synthetic
two-person live roster measured about 17 ms median and 21 ms p95. Cold model
parse and GPU upload still cause visible one-time hitches. These numbers are
local JS-side timings, not a full display latency measurement.

To follow an active SPAOS WorldOS volume, set `WORLD_OS_NATIVE_STATE` to its
`WorldOS/State/world.json` path. The native host reads that file without writing
to it. The scene polls its `rev`, places the jar from `layout.jar`, places
authored app props from the layout, and recognizes SPAOS app rows in `props`.
Saved SPAOS placements remain visible as launchable icons in a fresh compositor;
a live preview card replaces an icon at the same tile when its window appears.
It updates the visible scene when the volume revision changes. On the demo
host, the active clean volume had jar `[1,0]` and a browser prop `[2,0]`;
the native window rendered those positions. An isolated 360-frame fixture run
observed a revision change from 1 to 2 and added a browser tile during the
same process. A full GPU frame from the active volume was inspected.

The optional `WORLD_OS_NATIVE_FLOOR` input reads a compositor `SpaceOnFloor`
snapshot. With `WORLD_OS_NATIVE_PREVIEWS` set to a directory of raw RGBA
window pictures, the scene shows the first available window on each space's
tile and updates its texture by preview generation. The native host restricts
reads to numeric `<space>.<window>.rgba` names and verifies the byte count
against the compositor's dimensions. A synthetic browser picture was rendered
through Hermes, Three and Dawn on the Linux host and visually inspected.
The SPAOS World client now consumes `spaces` and `apps` snapshots from its
inherited private World channel. A new floor snapshot is applied on the next
draw rather than waiting for the one-second state-file poll. Preview images
remain compositor-owned files named by the authenticated floor metadata.
`WORLD_OS_NATIVE_FLOOR` is a standalone-probe fallback; a live SPAOS session
does not need `SPAOS_NATIVE_FLOOR_OUT`.

To start this renderer as SPAOS's **World client**, use `run_spaos_world.sh` as
the compositor's `--world-command`. It keeps SPAOS's inherited private World
channel and Wayland socket, supplies the metadata and preview paths, and ignores
the Electron flags that SPAOS appends to World commands. Example for an isolated
nested session (use absolute paths):

```sh
export WORLD_OS_NATIVE_ASSETS=/path/to/prepared-assets
export WORLD_OS_NATIVE_STATE=/path/to/WorldOS/State/world.json
export VALDI_WORLD_BUNDLE=/path/to/valdi-three-world-home-bundle.js
export SPAOS_WORLD_OS_X11=0
spaos-compositor --new-window \
  --world-command /path/to/Valdi/apps/three_native/native_webgpu/run_spaos_world.sh
```

The native World scene reads SPAOS's app catalog and draws a camera-fixed
clock, Back button and app launcher over the Three scene. Back and launcher
use WorldOS's authored control artwork. Clicking free ground opens the launcher
for that exact tile; the launcher button finds nearby free ground. A pick
rechecks occupancy before asking SPAOS to open the app. Up/Down select launcher
rows, Left/Right change pages, and Enter opens the selected app. Typing while
the launcher is open filters SPAOS's authenticated catalog by name or key;
Backspace edits the search. A search with no matches shows an empty result.
Clicking an
occupied floor tile enters its space. Escape or Back leaves the active space;
after leaving, the renderer waits for a newer preview before releasing SPAOS's
departing window. With the launcher closed, the wheel zooms, arrow keys pan,
and Home recenters on the live floor. Space and app requests use the inherited
private World socket; camera and launcher navigation stay in the renderer. A
standalone window without that socket remains a visual probe.

The asset preparation step decodes the available WorldOS app-icon GLBs, while
the runtime loads an icon only when a live space or saved app prop needs it.
An app with no matching artwork gets a text label from the same WorldOS font
atlas as the native HUD. Removed spaces and props release their scene nodes,
preview textures and labels. The prepared asset directory
currently occupies about 196 MiB for 40 GLBs and their decoded textures on
the Linux host, so a production package should avoid duplicating these files
when it also ships the browser World assets.
The Linux asset reader permits up to 64 MiB per file so the authored Dinner
GLB (about 53 MiB) can load when needed.

### Ownership while the port grows

- SPAOS's World channel owns the app catalog, spaces and active space; its
  preview files own the window pixels. The volume is a read-only source of
  WorldOS prop placement. The native scene never writes either authority.
- WorldOS's shared `native-grid-scene.js` owns the grid material and tile
  geometry; `world-home-composition.js` owns the camera fit and jar rig. New
  prop and lighting work should move through similarly
  explicit WorldOS scene factories, then be consumed here. Keeping another
  hand-copied scene inside Valdi would make visual parity drift.
- Valdi's Linux host owns Wayland input, Hermes, Dawn and the surface lifetime.
  `native_shell_hud.js` owns the current camera-fixed controls;
  `native_world_placement.mjs` owns the free-tile choice and is tested without
  a GPU. Previews and fallback labels are disposed when SPAOS removes their
  floor object; GLB templates are cached by asset name and loaded on demand.
- SPAOS's World channel also owns transition holds. The native host services
  its authenticated floor socket on SDL's thread while WebGPU presentation is
  blocked by a hidden World surface. It reveals the active space and each
  mapped window seat as soon as the floor reports them; it retains every event
  for Hermes. The JavaScript reveal path covers frames that read a floor event
  first. On return, `native_world_return.mjs` detects both Back and SPAOS dock
  switches and releases the departing space after a newer window preview has
  been installed on the native tile, or immediately if its last window closed.
  SPAOS deadlines remain crash fallbacks.

On the Linux host, an isolated SPAOS session delivered its actual app catalog
to Hermes and opened the native launcher. A second isolated session
used a synthetic three-app catalog; clicking its launcher entry reached
SPAOS's World `open` handler at the chosen tile. Its screenshot contains only
synthetic app data and was visually checked. The native scene also passed a
synthetic preview tile, enter, Back, updated preview, and window-release run.

```sh
WORLD_OS_NATIVE_ASSETS=/path/to/native-world-runtime/assets \
WORLD_OS_NATIVE_STATE=/path/to/WorldOS/State/world.json \
WORLD_OS_NATIVE_FLOOR=/path/to/floor.json \
WORLD_OS_NATIVE_PREVIEWS=/path/to/preview-directory \
XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0 SDL_VIDEODRIVER=wayland \
  bazel-bin/apps/three_native/three_native_linux_webgpu_surface_probe \
  --interactive /path/to/native-world-runtime/world.js
```

On the Linux demo host, tty2 runs SPAOS with this renderer as its fullscreen
World client. Its clean WorldOS volume, app catalog, live window previews,
Back, and launcher are visible; SPAOS still owns compositing and app windows.
With the lifecycle-capable native host, the World client reports readiness to
SPAOS after its first GPU frame. Ctrl+F5 requests a World-only restart through
the inherited SPAOS channel; on `lifecycle_quit`, the host releases its WebGPU
surface and exits so the compositor can replace only World. The request checks
the compositor's current session and World readiness before submitting. It does
not require the optional external-agent lifecycle socket or token.
The Linux lifecycle regression runs the compiled host on an isolated Wayland
display with a private socket pair. It checks `hello`, readiness after a GPU
frame, mapped space and window reveals from a synthetic SPAOS floor, status
and restart requests, `lifecycle_quit`, and a clean exit:

```sh
XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-2 \
  python3 apps/three_native/native_webgpu/test_native_world_lifecycle.py \
  bazel-bin/apps/three_native/three_native_linux_webgpu_surface_probe \
  /path/to/native-world-runtime/world.js /path/to/native-world-runtime/assets
```

That probe passed on the Linux test GPU. The live tty2 session also runs this
lifecycle-capable host.
The end-to-end acceptance test starts a separate SPAOS compositor under an
isolated Wayland display. Its first World calls `__worldRestart()` from Hermes;
the test checks that SPAOS replaces the World process, maps the replacement,
and reports it ready. The test terminates only the compositor it starts:

```sh
XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-2 \
  python3 apps/three_native/native_webgpu/test_native_spaos_lifecycle.py \
  /path/to/spaos-compositor \
  bazel-bin/apps/three_native/three_native_linux_webgpu_surface_probe \
  /path/to/native-world-runtime/world.js /path/to/native-world-runtime/assets \
  --state /path/to/WorldOS/State/world.json
```

This passed on the Linux test host: the first native World requested its own
restart and SPAOS marked the replacement `succeeded` after it mapped.
An isolated headless SPAOS session validated a freshly built bundle through
tile entry, Back, an updated preview, and release of the departing window.
New bundles are checked in isolated sessions before tty2 is updated.

The previous live tty2 session used the native World scene and native SPAOS Space UI
under the SPAOS compositor. Its home contains the authored jar and meadow,
eleven WorldOS People avatars driven by the shared character simulation, a
People card, launcher, WorldOS chat, and a dock. A real Calculator launch from
the native launcher maps an Electron app into SPAOS's space. In the September
2026 live test, the mapped app window and space were revealed 29 ms after the
window mapped; returning with the SPAOS World dock refreshed the tile preview
and released the linger 76 ms after the space switch. Neither transition
reached SPAOS's hold deadline. With the avatars visible, 120-frame steady-state
intervals measured about 22 ms at p50 and 25 ms at p95 on the test GPU. This is
functional parity work, not yet the full production WorldOS room or animation.

On 2026-09-28, a separate headless 1600×900 SPAOS session validated the
shared Home camera/rig bundle with meadow and all 11 avatars. The corrected
vertical fit kept the full roster in frame. Settled 120-frame intervals across
two runs ranged from 28.06–34.15 ms p50 and 34.32–40.14 ms p95. tty2 was
inactive during these runs, so this
bundle has not been installed as a persistent physical-console session.

The parity-v8 bundle passed isolated GPU fixtures with lazily loaded
Calculator and Settings models, saved Music and Dinner props, and a Console
label. Dinner verifies the 64 MiB native asset-reader bound. A preview missing
at startup recovered when its RGBA file appeared; its retry log remained
bounded.
A scripted click on tile `(9,0)`, keyboard selection of Calculator, and an
`open` request for `(9,0)` passed. A full isolated SPAOS session delivered 39
visible apps over the private World channel. The final C++ bridge and asset
reader rebuilt successfully on Linux, and the rebuilt binary passed the GPU
fixtures. Physical wheel and key injection remain to be checked interactively.

`test_native_app_search.py` sends a synthetic three-app catalog over a private
World channel, types a search into the native launcher, and checks that Enter
requests Calculator rather than its neighboring Calendar entry. It passed on
the Linux GPU with the compiled host and prepared assets:

```sh
XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-2 \
  python3 apps/three_native/native_webgpu/test_native_app_search.py \
  bazel-bin/apps/three_native/three_native_linux_webgpu_surface_probe \
  /path/to/native-world-runtime/world.js /path/to/native-world-runtime/assets
```

This is still a focused native WorldOS shell slice hosted by ValdiLinux's
Hermes runtime, rather than a Valdi custom view or a full port of `World.html`.
Its volume reader covers layout and app presence; SPAOS remains the authority
for spaces, previews and app input. The native shell currently has the core
floor, previews, Back, clock and launcher. Production jar shading is available
as an opt-in path. The rest of the WorldOS HUD, 3D launcher lattice, full chat
presentation, voice, notifications and app surfaces remain separate work.

### Native SPAOS Shell capability slice

`native_spaos_shell.js` is a separate Valdi/Hermes/Three/Dawn Space UI. It
maps the transparent `spaos-space-ui` Wayland surface and draws a 48-pixel
floating dock that rests in the right half of the output. World, focus, and
close buttons request compositor actions. Its grip drags the pill within the
output; double-clicking the grip returns it home. The dock's visible bounds
and SPAOS input rectangle share one geometry calculation. The controller
accepts only the exact current size, with the home position or an in-bounds
dragged position. A compositor snapshot refresh resolves startup races between
output resize and the first window list. The native host enables SDL's focus
click-through hint so the first press on the dock reaches its button or grip.
SPAOS still owns window management and composition. The World client remains
a distinct process and channel. The production window-management card remains
to be ported.

`run_spaos_shell_controller.sh` starts a plain Node controller that owns
`SPAOS_SHELL_CHANNEL_FD`. It reuses SPAOS's `CompositorClient`,
`InstalledAppSource`, `AppCatalog`, Package Manager client, manifest and
receipt binding, and XDG desktop scanner. It publishes the authenticated app
catalog and all verb-owner reservations, resolves World `open_app` and
`present_app` against that catalog, and sends digest-bound launch records to
SPAOS. Host desktop entries use the existing native command path. The
controller spawns Valdi with no Shell capability descriptor. The renderer
authenticates over a private local socket and can request only current window
and space actions and the bounded dock geometry. `run_spaos_shell.sh` remains
a direct-capability probe for comparison, not the controller configuration.
The controller reports Shell lifecycle readiness to SPAOS only after the
authenticated Valdi renderer has completed its first GPU frame. A native
renderer startup failure therefore cannot mark the Shell ready merely because
the controller connected.

The Linux headless test runs an isolated Sway and SPAOS session through
`test_native_shell_headless.sh`. It verifies the Shell handshake, role mapping,
and a GPU readback with a transparent field and visible dock. The v17 fixture
passed at 1600×900, with alpha 0 in the field and nonzero alpha in the pill.
Existing tty sessions are left alone.

`build_spaos_shell_controller.sh` bundles the controller and a read-only
`probe_spaos_catalog.mjs` CLI from the matching SPAOS shell TypeScript. The
probe reports counts and IDs, never the private token or launch commands.
The build needs the same Electron binary path currently used for legacy app
launch records, but neither the controller nor Valdi starts Electron to draw
the shell. SPAOS apps may still use Electron when launched.

```sh
ESBUILD_BIN=/path/to/esbuild \
  apps/three_native/native_webgpu/build_spaos_shell_controller.sh \
  /path/to/spaos/desktop/shell/src /tmp/spaos-shell-controller
SPAOS_PRODUCT_SLUG=spaos-clean node /tmp/spaos-shell-controller/probe_spaos_catalog.cjs \
  /path/to/spaos/desktop /path/to/spaos/desktop/shell/node_modules/electron/dist/electron clean
```

In the isolated clean-instance run, the controller published 28 authenticated
SPAOS apps, 12 host apps and 456 verb reservations; WorldOS received 40
visible app rows. A World `open` request started Calculator through a verified
digest-bound runtime record, and its Wayland window mapped in its own SPAOS
space. A separate temporary XDG desktop entry exercised
the host command path with `/usr/bin/true`. The GPU frame showed alpha 0 above
the taskbar and 224 inside it. Existing tty sessions remained running.
`test_native_spaos_shell_lifecycle.py` runs a separate SPAOS session with both
native World and native Space UI, requests a Shell-only restart, and checks
that two Shell processes each report readiness after their first GPU frame
while the same World process stays ready. This passed on the Linux test host.
With `--expect-shell-unready` and a nonexistent Shell bundle, the same harness
checks that World becomes ready while Shell stays unready. With
`--test-host-refresh`, it installs, hides, unhides and removes a temporary XDG
desktop entry. It checks that the controller republishes each change and World's
visible app count follows. Both cases passed in isolated Linux sessions.
With `--test-harness`, the test opens SPAOS's test-only World door, checks that
the Shell publishes its four floor verbs and each installed app's opener, then
calls `app.list`, `calculator.open`, `app.move`, `view.show`, and `app.close` through
the compositor. It verifies Calculator maps on the requested tile and a repeated
open focuses that copy. This passed with all 28 installed SPAOS apps authenticated.
It also hands a named WhatsApp opener to the app; the unlinked test account
returned WhatsApp's own `not-linked` answer. With `--test-handoff`, a stopped
Calculator receives `calculator.evaluate` after it registers its Verb, a second
call uses its live channel, and the headless System Info worker answers
`system.machine`. The controller publishes the one authenticated service with
the same catalog generation as the app roster. Both handoffs passed on Linux.
With `--test-agent-call`, a private Unix socket stands in for the mind, waits
for the renderer's authenticated catalog, calls `app.list` through native
World and SPAOS Shell, and sends a reply back to the renderer. With
`--test-agent --world-runner run_spaos_world.sh`, a separate temporary Home
and State volume starts a real agent service and verifies its authenticated
World handshake. Both passed on Linux. The temporary service has no model key;
the live tty2 service reported Hermes ready and answered a typed app question
through the native chat field. The v7 runtime passed the isolated agent-call
test, then a live Hermes reply on tty2 and keyboard scrolling were checked
with screenshots. Tty2 v15 uses native Valdi processes for both World and
Space UI. It launches Calculator through SPAOS's authenticated app catalog,
shows the real app through the transparent Space UI, and passes pointer input
to Calculator. The Linux WebGPU canvas bridge now forwards Three's
premultiplied alpha mode to Dawn, and the shell surface is borderless. A live
screenshot showed Calculator above the native meadow with the native dock; a
click on Calculator's 4 button changed its display to 4. The v15 floating dock
was checked with a real Calculator launch, a floor-tile return, a World switch,
and a Calculator close. SPAOS remains the compositor, and tty1's production
session was not changed.
The Electron argument must be the exact installed executable path used in the
Package Manager launch records; a CLI shim changes the launch digest and correctly
causes the catalog to reject those app presentations.
`test_native_shell_headless.sh` accepts `SHELL_BUNDLE` for testing a versioned
Space UI bundle alongside a versioned World bundle.

The controller now answers the Shell-owned floor verbs and app openers from
the current authenticated catalog. It publishes installed app and service Verb
metadata, starts a stopped owner from its digest-bound record, waits for its
registration, and re-enters the compositor's invoke path so the compositor
applies its usual provenance and user-go policy. A call that times out receives
an explicit refusal. Native WorldOS now has a typed mind transport and a
bounded compositor Verb return path. Full conversation and voice presentation, backdrop and
room-light presentation, and windowed titlebar remain. The controller refreshes both host
desktop entries and the Package Manager catalog every minute, and republishes
when either launcher roster or hidden-app settings change. It reads those
settings from the file SPAOS gives it over the Shell channel. The native taskbar is a
functional first surface, not visual parity with SPAOS's existing Space UI.
Keep testing it in isolated sessions until those owner duties and UI surfaces
are ported and reviewed.
