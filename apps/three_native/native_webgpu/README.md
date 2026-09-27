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

`three_world_home.js` imports WorldOS's `native-grid-scene.js` factory at bundle
time. That factory supplies the painted-grid node material and rounded tile
geometry from the WorldOS engine. This entry loads seven authored GLBs, using
the WorldOS Files stack's `assets/media/town/Box.glb` for Files. It also uses
the production jar's lathe profile with a Three physical glass stand-in.
Embedded images are decoded ahead of time into RGBA files because Hermes has no browser
image decoder. `GLTFLoader` still parses geometry, materials and transforms.
The same preparation step decodes WorldOS's Back and launcher artwork and
rasterizes the bundled SF Pro Display font into a small glyph atlas for the
native shell controls. No browser canvas is used at runtime.

With Three r186, esbuild and sharp available in a Node package directory,
prepare a runtime directory outside the checkout. The script refuses to
overwrite an existing directory and publishes `assets/` and `world.js` only
after both have built successfully. Set `ESBUILD_BIN` if esbuild is not in the
Node directory's `.bin/` folder. `WORLD_SCENE_ROOT` must be a SPAOS checkout
containing `kernel/engine/native-grid-scene.js`; the Linux demo uses SPAOS
`codex/world-native-scene-contract` at `52f5fa66`. That scene factory is not
yet in SPAOS main.

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
rows, Left/Right change pages, and Enter opens the selected app. Clicking an
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
  geometry. New jar, prop and lighting work should move through similarly
  explicit WorldOS scene factories, then be consumed here. Keeping another
  hand-copied scene inside Valdi would make visual parity drift.
- Valdi's Linux host owns Wayland input, Hermes, Dawn and the surface lifetime.
  `native_shell_hud.js` owns the current camera-fixed controls;
  `native_world_placement.mjs` owns the free-tile choice and is tested without
  a GPU. Previews and fallback labels are disposed when SPAOS removes their
  floor object; GLB templates are cached by asset name and loaded on demand.

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
An isolated headless SPAOS session validated a freshly built bundle through
tile entry, Back, an updated preview, and release of the departing window.
The live tty2 session remains running while new bundles are checked in isolated
sessions.

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

This is still a focused native WorldOS shell slice hosted by ValdiLinux's
Hermes runtime, rather than a Valdi custom view or a full port of `World.html`.
Its volume reader covers layout and app presence; SPAOS remains the authority
for spaces, previews and app input. The native shell currently has the core
floor, previews, Back, clock and launcher. Production jar shading, the rest of
the WorldOS HUD, 3D launcher lattice, chat, voice, notifications, and all app
surfaces remain separate work.
