# Linux native Three.js / Dawn probes

These programs exercise the WorldOS platter GLB on a Linux desktop with a
native Vulkan WebGPU implementation. They establish two pieces of the intended
Valdi Linux runtime, but neither is a Valdi application yet.

| Program | JavaScript / rendering | Window and presentation |
| --- | --- | --- |
| `direct.mjs` | Three r186 `WebGPURenderer` on Dawn | SDL2 X11 window (Xwayland under GNOME Wayland); direct GPU swapchain |
| `direct.mjs --world-scene` | WorldOS's painted-grid TSL material and authored platter GLB | Same direct GPU swapchain; scene input and uniform animation |
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
scripts. The demo selects SDL's X11 driver because this version of the Node
Dawn/SDL interop expects Xlib handles. A GNOME Wayland session supplies these
through Xwayland. Press Escape or close the window to stop. Use `--frames=120`
for a bounded run. Drag with the mouse to rotate the platter, or resize the
window. The default run ends after 36,000 frames because of the addon texture
lifetime limitation; `--world-glass` applies the material values in WorldOS's
platter scene. Without it, the GLB's material is used.

The frame path acquires a swapchain texture, renders the actual Three scene,
and presents it without mapping frames to CPU memory. `--readback-test` makes
one 32×32 render target readback and checks that it contains non-flat RGBA8
data. It exercises the separate readback path used by parts of WorldOS, but
does not add a readback to every presented frame.

The pinned `@kmamal/gpu` 0.2.0 binding has two lifetime/API limitations in
this demo: Three's `onuncapturederror` property is shadowed, and acquired
swapchain texture wrappers are retained until process exit to avoid an addon
finalizer assertion. This is a validation program, not a long-running
production runtime. The current Dawn/Valdi binding must own surface textures
correctly.

The ownership bug is in the package's `dawn.patch`: `getCurrentTexture()`
creates a `GPUTexture` using `wgpu::Device::Acquire(_wgpuDevice)`, but
`_wgpuDevice` is borrowed from the live renderer. Dawn's `Acquire` takes over
an existing reference; it does not add one. The local patch script changes
that call to `wgpu::Device(_wgpuDevice)`, which adds a reference. It patches
the build source only; the downloaded `dawn.node` is unchanged. To build and
stress a corrected binary in a separate disposable checkout:

```sh
npm ci --no-audit --no-fund
npm run patch-gpu-lifetime
(cd node_modules/@kmamal/gpu && npm run build)
node --expose-gc direct.mjs --world-scene --recycle-surface-textures --frames=36000
```

The package build fetches its pinned Dawn and depot_tools revisions and needs
CMake, Ninja, a C++ compiler, SDL/X11 development headers, and ample disk
space. The locally patched source has been verified against 0.2.0; the rebuilt
binary and recycling stress run still need verification. Do not use
`--recycle-surface-textures` with the unmodified prebuilt addon.

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
`codex/world-native-scene-contract` checkout at `c1759c9f`; the earlier `0f494e94`
snapshot does not have this API.
The diagnostic enables the painted lattice path and twilight values so the
cell shading and animated wave are visible. Mouse movement updates the real
hover uniforms; clicking restarts the wave at that cell; dragging orbits the
camera. The tile material uses a simple physical stand-in: WorldOS's full
tile node lighting, shadow pipeline, and shell layout are not in this host.

This is a genuine WorldOS shader/asset slice running on native WebGPU. It is
still hosted by Node and Xwayland. The DOM HUD, app surfaces, image decoding,
services, and Valdi/Wayland binding remain separate integration work.

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
changes. Its render pass only clears the swapchain; Three.js is not connected
to this native Wayland host yet.

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
and expose a `GPUCanvasContext` backed by the same native Dawn surface as the
Linux window. React Native WebGPU's JSI/Dawn layer is a candidate to adapt;
its React Native scheduler and surface ownership cannot be used unchanged.
Valdi's Linux bootstrap currently has no display host. SnapDrawing can
remain the native 2D UI layer, while Dawn presents Three's 3D scene.

The platter asset is used for local validation. Its distribution license has
not been resolved.
