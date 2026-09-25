# Linux native Three.js / Dawn probes

These programs exercise WorldOS 3D assets on a Linux desktop with a native
Vulkan WebGPU implementation. They establish rendering and presentation pieces
for the intended Valdi Linux runtime; these Dawn probes are not Valdi apps.

| Program | JavaScript / rendering | Window and presentation |
| --- | --- | --- |
| `direct.mjs` | Three r186 `WebGPURenderer` on Dawn | SDL2 X11 window (Xwayland under GNOME Wayland); direct GPU swapchain |
| `direct.mjs --wayland` | Same Three renderer with rebuilt SDL and Dawn addons | Native SDL2 Wayland window; direct GPU swapchain |
| `direct.mjs --world-scene` | WorldOS's painted-grid TSL material and authored platter GLB | Same direct GPU swapchain; scene input and uniform animation |
| `direct.mjs --world-home` | WorldOS grid shader, tile geometry, six home app icons and Files box | Native Wayland or X11 swapchain; static home layout snapshot |
| `wayland_dawn_smoke.cpp` | Current official Dawn C API; animated clear | SDL3 native Wayland window; direct GPU swapchain |
| `run.mjs` + `viewer.cpp` | Three r186 `WebGPURenderer` on Dawn | Diagnostic SDL2 Wayland viewer; GPU readback and CPU upload every frame |

## Run the Three.js direct swapchain demo

Run in a GNOME terminal on Linux with Node.js, npm and an Xwayland display:

```sh
cd apps/three_native/linux_dawn_probe
npm ci --no-audit --no-fund
(cd node_modules/@kmamal/gpu && node scripts/install.mjs)
(cd node_modules/@kmamal/sdl && node scripts/install.mjs)
node direct.mjs --world-glass --readback-test
```

The explicit installer calls are needed when npm blocks dependency install
scripts. The prebuilt addons use SDL's X11 driver because their interop expects
Xlib handles. A GNOME Wayland session supplies these through Xwayland.
Rebuilding both addons as described below enables `--wayland`. Press Escape or
close the window to stop. Use `--frames=120`
for a bounded run. Drag with the mouse to rotate the platter, or resize the
window. The default run ends after 36,000 frames because of the addon texture
lifetime limitation. A rebuilt addon with `--recycle-surface-textures` runs
until the window is closed. `--world-glass` applies the material values in
WorldOS's platter scene. Without it, the GLB's material is used.

The frame path acquires a swapchain texture, renders the actual Three scene,
and presents it without mapping frames to CPU memory. `--readback-test` makes
one 32×32 render target readback and checks that it contains non-flat RGBA8
data. It exercises the separate readback path used by parts of WorldOS, but
does not add a readback to every presented frame.

The pinned `@kmamal/gpu` 0.2.0 binding has two lifetime/API limitations in
this demo: Three's `onuncapturederror` property is shadowed, and the unmodified
addon requires acquired swapchain texture wrappers to be retained until exit
to avoid a finalizer assertion. This is a validation program, not a Valdi
runtime.

The ownership bug is in the package's `dawn.patch`: `getCurrentTexture()`
creates a `GPUTexture` using `wgpu::Device::Acquire(_wgpuDevice)`, but
`_wgpuDevice` is borrowed from the live renderer. Dawn's `Acquire` takes over
an existing reference; it does not add one. The local patch script changes
that call to `wgpu::Device(_wgpuDevice)`, which adds a reference. It patches
the build source only; the downloaded `dawn.node` is unchanged. To build and
stress a corrected binary in a separate disposable checkout:

```sh
npm ci --no-audit --no-fund
npm run build-patched-gpu
node --expose-gc direct.mjs --world-scene --recycle-surface-textures --frames=36000
```

The build script fetches the package's pinned Dawn and depot_tools revisions,
applies the lifetime, dual X11/Wayland surface, and resize patches, then compiles with
Dawn's downloaded Clang and Go toolchains. It needs CMake, Ninja, Python,
SDL2/X11/Wayland development headers, and ample disk space. Host GCC 16 does
not compile the pinned Tint sources. Do not use `--recycle-surface-textures`
with the unmodified prebuilt addon.

To present the Three.js scene directly to a Wayland compositor, also rebuild
the pinned SDL addon. This needs `node-gyp`, `pkg-config`, and system SDL2
development headers and libraries:

```sh
npm run build-patched-sdl
export WORLD_OS_ROOT=/path/to/spaos/desktop/world_os
node direct.mjs --wayland --world-scene --readback-test --recycle-surface-textures
```

The rebuilt SDL addon tags the window handle as X11 or Wayland. The rebuilt
Dawn addon creates the matching surface descriptor. Both addons are required;
`--wayland` cannot use their prebuilt binaries. The X11 path remains available
after rebuilding. The resize patch reconfigures the existing Dawn surface
instead of creating a second surface for the same Wayland window. On the test
machine, Wayland uses mailbox presentation by default: FIFO stalls after its
initial buffers, and the driver does not support immediate mode for this
surface. Use `--present-mode=fifo` or `--present-mode=mailbox` to override the
default if the target compositor needs it.

On the Linux Intel PTL/Vulkan host, the corrected addon rendered 36,000
WorldOS scene frames in 11 minutes 37 seconds with forced GC every 30 frames.
The 32×32 readback passed, the process exited cleanly, and systemd measured
a 112.9 MiB memory peak. Omitting `--frames` with the corrected addon keeps
the window running until it is closed.

With both patched addons, the same Intel PTL/Vulkan host also presented 120
WorldOS scene frames directly to GNOME's `wayland-0` socket. The targeted
readback passed with 104 distinct red values. This is native Wayland
presentation through SDL2 and Dawn, with no per-frame CPU image transfer.

## Run the WorldOS scene slice

With a matching SPAOS source checkout and the dependencies above installed:

```sh
export WORLD_OS_ROOT=/path/to/spaos/desktop/world_os
npm run world-scene
```

This run imports WorldOS's `native-grid-scene.js` from `WORLD_OS_ROOT`.
That factory assembles `grid-material.js`, `grid-surface-source.js`,
`tile-geometry.js`, and `world-render-constants.js`; the production engine
uses those same lower-level factories. The native host keeps no parsed or
copied shader, tile geometry, or palette. Use the companion SPAOS
`codex/world-native-scene-contract` checkout, which includes
`native-grid-scene.js`; the earlier `0f494e94` snapshot lacks this API.
The diagnostic enables the painted lattice path and twilight values so the
cell shading and animated wave are visible. Mouse movement updates the real
hover uniforms; clicking restarts the wave at that cell; dragging orbits the
camera. The tile material uses a simple physical stand-in: WorldOS's full
tile node lighting, shadow pipeline, and shell layout are not in this host.

This is a genuine WorldOS shader/asset slice running on native WebGPU. It is
still hosted by Node, using Xwayland by default or native Wayland with the
rebuilt addons. The DOM HUD, app surfaces, services, and Valdi binding remain
separate integration work.

## Run the native home scene slice

The `--world-home` mode adds six app icon GLBs from WorldOS's home defaults
at `world_os` commit `631663cb1`, the Files box GLB, and their occupied tiles.
It decodes the embedded JPEG and WebP textures with `sharp` and uploads them through
Three's WebGPU `DataTexture` path. Each icon must have a decoded texture or
startup fails. Set the asset root to a WorldOS checkout containing
`assets/media/appicons/`:

```sh
export WORLD_OS_ROOT=/path/to/spaos/desktop/world_os
export WORLD_OS_ASSET_ROOT=/path/to/world_os
node direct.mjs --wayland --world-home --readback-test \
  --recycle-surface-textures --capture=/tmp/world-home.png --frames=120
```

On the Intel Linux Wayland host, this presented 120 frames and passed the
targeted GPU readback with 190 distinct red values. The capture is a separate
one-time GPU readback for visual validation; normal presentation has no CPU
frame copy. The home positions are a pinned snapshot, not the live persisted
layout. The jar, the stack's paper sheets, DOM HUD, app screens and WorldOS
engine state are not yet in the native process. This mode is a scene slice,
not the running shell.

## Build the native Wayland surface host

Install SDL3 development headers, `pkg-config`, and a C++20 compiler. Extract
the Linux Release archive from an [official Dawn release](https://github.com/google/dawn/releases),
then run:

```sh
cd apps/three_native/linux_dawn_probe
./build_wayland_smoke.sh /path/to/extracted/Dawn-Linux-Release
SDL_VIDEODRIVER=wayland ./wayland_dawn_smoke 120
```

The GNOME terminal supplies `XDG_RUNTIME_DIR` and `WAYLAND_DISPLAY`. On the
test machine, the official Dawn `v20260923.214225` release presented 120
frames directly to `wayland-0`. The source also handles window pixel-size
changes. Its render pass only clears the swapchain; use the rebuilt Node addons
above for the Three.js scene on Wayland.

## Earlier offscreen diagnostic

```sh
(cd node_modules/webgpu && node build/postinstall.js)
node run.mjs
g++ -O2 -std=c++17 viewer.cpp -o viewer $(pkg-config --cflags --libs sdl2)
node run.mjs --stream | ./viewer
```

`run.mjs` writes `linux-dawn-platter.ppm`. The viewer copies every frame from
the GPU and uploads it to SDL; it is useful for diagnostics, not for measuring
the native runtime's performance.

## Runtime boundary

The next integration must install a WebGPU binding in Valdi's Hermes runtime
and expose a `GPUCanvasContext` backed by a native Dawn surface. React Native
WebGPU's JSI/Dawn layer is a candidate to adapt; its React Native scheduler and
surface ownership cannot be used unchanged. Valdi's Linux bootstrap currently
has no display host. SnapDrawing can remain the native 2D UI layer, while Dawn
presents Three's 3D scene.

The platter asset is used for local validation. Its distribution license has
not been resolved.
